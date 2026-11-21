// Indexation des prix de la collection : désactivée par défaut, une lecture à la fois par la voie
// lente, les cartes jamais lues d'abord (les plus rares en tête), plafond journalier, arrêt et
// désactivation au premier refus du site.
const test = require("node:test");
const assert = require("node:assert/strict");
const {loadExtensionModule, response, fakeJwt, sessionCookie} = require("./helpers/extension");
const core = require("../core");

function fakeBrowser() {
  // Un seul « onglet » par test : sans navigator.locks, il est meneur tout de suite (Node garderait
  // le verrou du test précédent, comme un autre onglet resté ouvert)
  Object.defineProperty(globalThis.navigator, "locks", {value: undefined, configurable: true});
  const target = new EventTarget();
  globalThis.window = globalThis;
  globalThis.addEventListener = target.addEventListener.bind(target);
  globalThis.removeEventListener = target.removeEventListener.bind(target);
  globalThis.dispatchEvent = target.dispatchEvent.bind(target);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  globalThis.document = {addEventListener() {}, visibilityState: "visible", cookie: sessionCookie({userId: "me", token: fakeJwt({sub: "me", exp}), expiresAt: exp})};
  const data = {};
  globalThis.chrome = {
    runtime: {id: "test"},
    storage: {
      local: {
        get: async (key) => Object.fromEntries([].concat(key).filter((k) => k in data).map((k) => [k, data[k]])),
        set: async (obj) => Object.assign(data, structuredClone(obj)),
        remove: async (key) => [].concat(key).forEach((k) => delete data[k]),
      },
      onChanged: {addListener() {}, removeListener() {}},
    },
  };
}

const history = () => {
  const start = core.weekStart(new Date()).toISOString().slice(0, 10);
  return {computed_at: new Date(Date.now() - 3600e3).toISOString(), by_rarity: {C: {weekly: [{start, avg: 5, min: 5, max: 5, count: 3}], monthly: []}}};
};
// Ma collection : c (C, 3 exemplaires), r (R), l (L), c2 (C, 1 exemplaire)
const COPIES = [
  {id: "u1", card_id: "c", count: 3, snapshot_rarity: "C", cards: {id: "c", rarity: "C", wikipedia_title: "C"}},
  {id: "u2", card_id: "r", count: 1, snapshot_rarity: "R", cards: {id: "r", rarity: "R", wikipedia_title: "R"}},
  {id: "u3", card_id: "l", count: 1, snapshot_rarity: "L", cards: {id: "l", rarity: "L", wikipedia_title: "L"}},
  {id: "u4", card_id: "c2", count: 1, snapshot_rarity: "C", cards: {id: "c2", rarity: "C", wikipedia_title: "C2"}},
];

function load({reply} = {}) {
  fakeBrowser();
  const reads = [];
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.includes("/user_cards?")) return response(200, url.includes("offset=0") ? COPIES : []);
    const m = /\/api\/marketplace\/cards\/([^/]+)\/price-history$/.exec(url);
    if (m) {
      reads.push(m[1]);
      return reply ? reply(m[1]) : response(200, history());
    }
    return response(404, {});
  };
  const mods = loadExtensionModule({
    bus: "extension/src/content/lib/bus.js",
    prices: "extension/src/content/state/prices.js",
    index: "extension/src/content/state/price-index.js",
    settings: "extension/src/content/state/settings.js",
  });
  // Intervalle de la voie lente raccourci pour les tests
  mods.prices.SLOW_SPEEDS.normal.gap = 5;
  return {...mods, reads};
}
const until = async (check, ms = 3000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
};

test("indexation : désactivée par défaut, puis toute la collection, la plus rare d'abord, doublons avant", async () => {
  const m = load();
  await Promise.all([m.settings.settings.ready, m.prices.ready]);
  assert.equal(m.settings.isOn("priceIndex"), false, "désactivée pour une nouvelle installation");
  m.index.startPriceIndex();
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(m.reads, [], "rien sans l'accord du joueur");
  m.settings.settings.set({features: {...m.settings.settings.get().features, priceIndex: true}});
  await until(() => m.reads.length >= 4);
  assert.deepEqual(m.reads, ["l", "r", "c", "c2"]);
  const p = m.index.indexProgress();
  assert.deepEqual([p.total, p.read, p.due], [4, 4, 0]);
  assert.ok(p.next > Date.now(), "prochaine relecture plus tard");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(m.reads.length, 4, "à jour : plus de lecture");
  assert.equal(m.prices.slowBudget.get().count, 4, "lectures du jour comptées");
});

test("indexation : plafond du jour respecté", async () => {
  const m = load();
  await Promise.all([m.settings.settings.ready, m.prices.ready]);
  m.prices.SLOW_SPEEDS.normal.cap = 2;
  m.settings.settings.set({features: {...m.settings.settings.get().features, priceIndex: true}});
  m.index.startPriceIndex();
  await until(() => m.reads.length >= 2);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(m.reads.length, 2);
  assert.equal(m.prices.slowCapReached(), true);
});

test("indexation : vérification anti-robot demandée → arrêt, réglage désactivé, message", async () => {
  const m = load({reply: () => response(403, {code: "human_verification_required"})});
  await Promise.all([m.settings.settings.ready, m.prices.ready]);
  const events = [];
  m.bus.on("price-index-stopped", () => events.push("stopped"));
  m.settings.settings.set({features: {...m.settings.settings.get().features, priceIndex: true}});
  m.index.startPriceIndex();
  await until(() => events.length > 0);
  assert.deepEqual(m.reads, ["l"], "une seule lecture refusée, puis plus rien");
  assert.equal(m.settings.isOn("priceIndex"), false, "le joueur la réactive lui-même");
  assert.ok(m.prices.slowStoppedBy());
  m.prices.requestPrice("x");
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(m.reads, ["l"], "plus aucune lecture de prix jusqu'au rechargement");
});

test("budget des prix : cartes affichées sur la moitié de la rafale, cartes tirées lues tout de suite", async () => {
  const m = load();
  await Promise.all([m.settings.settings.ready, m.prices.ready]);
  const half = m.prices.PRICE_BUDGET.BURST_MAX / 2;
  for (let i = 0; i < 12; i++) m.prices.requestPrice(`tile${i}`);
  await until(() => m.reads.length >= half, 1000);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(m.reads.length, half, "cartes affichées : la moitié de la rafale");
  assert.ok(m.prices.isQueued("tile11"), "les autres attendent leur tour");
  // Cartes tirées : la moitié réservée, lues tout de suite malgré la file des cartes affichées
  const pulled = ["p1", "p2", "p3", "p4", "p5"];
  const loaded = m.prices.loadPrices(pulled, {priority: true});
  await until(() => pulled.every((id) => m.reads.includes(id)), 1000);
  assert.deepEqual(m.reads.slice(half), pulled, "les cinq cartes du paquet, sans attendre");
  await loaded;
  m.prices.requestPrice("opened", {detail: true});
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!m.reads.includes("opened"), "rafale entière utilisée : la fiche attend le prochain créneau");
});

test("budget des prix : refus du site → pause des seules lectures de prix, carte gardée en file", async () => {
  const {AutomationBlockedError} = loadExtensionModule("extension/src/content/lib/http.js");
  const m = load({reply: () => response(403, {code: "automation_limit", error: "Trop de requêtes automatisées. L'automatisation n'est pas autorisée."})});
  await Promise.all([m.settings.settings.ready, m.prices.ready]);
  const paused = [];
  m.bus.on("prices-paused", (e) => paused.push(e));
  m.prices.requestPrice("a", {detail: true});
  await until(() => paused.length > 0);
  assert.ok(AutomationBlockedError);
  assert.equal(paused.length, 1);
  assert.ok(m.prices.pricesPausedUntil() > Date.now() + 14 * 60e3, "pause d'un quart d'heure");
  assert.equal(m.prices.slowBudget.get().halved, true, "budget réduit jusqu'au lendemain");
  assert.ok(m.prices.isQueued("a"), "la carte sera lue à la reprise");
  m.prices.requestPrice("b", {detail: true});
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(m.reads, ["a"], "plus de lecture de prix pendant la pause");
  assert.match(m.prices.priceWaitNote(), /pause jusqu'à/);
});
