// Export / import des prix dans l'extension : le fichier reprend le cache du navigateur, l'import ne
// garde que les prix plus récents, les enregistre, prévient les autres onglets et ne lit rien sur le site.
const test = require("node:test");
const assert = require("node:assert/strict");
const {loadExtensionModule, response, fakeJwt, sessionCookie} = require("./helpers/extension");
const core = require("../core");

const HOUR = 3600e3;
const DAY = 24 * HOUR;

// Résumé d'une carte vendue 4 fois cette semaine au prix moyen `avg`, dans la rareté `rarity`
function entry(t, avg = 120, rarity = "SR") {
  const start = core.weekStart(new Date()).toISOString().slice(0, 10);
  const history = {computed_at: new Date(t).toISOString(), by_rarity: {[rarity]: {weekly: [{start, avg, min: avg, max: avg, count: 4}], monthly: []}}};
  return {s: core.summarizeHistory(history), c: history.computed_at, t};
}

function load(stored = {}) {
  const target = new EventTarget();
  globalThis.window = globalThis;
  globalThis.addEventListener = target.addEventListener.bind(target);
  globalThis.removeEventListener = target.removeEventListener.bind(target);
  globalThis.dispatchEvent = target.dispatchEvent.bind(target);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  globalThis.document = {addEventListener() {}, visibilityState: "visible", cookie: sessionCookie({userId: "me", token: fakeJwt({sub: "me", exp}), expiresAt: exp})};
  const data = structuredClone(stored);
  const listeners = [];
  const fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return response(404, {});
  };
  globalThis.chrome = {
    runtime: {id: "test"},
    storage: {
      local: {
        get: async (key) => Object.fromEntries([].concat(key).filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
        set: async (obj) => Object.assign(data, structuredClone(obj)),
        remove: async (key) => [].concat(key).forEach((k) => delete data[k]),
      },
      onChanged: {addListener: (fn) => listeners.push(fn), removeListener() {}},
    },
  };
  const mods = loadExtensionModule({prices: "extension/src/content/state/prices.js"});
  // Écriture faite par un autre onglet : valeur enregistrée, puis événement du stockage
  const fromOtherTab = (key, value) => {
    data[key] = structuredClone(value);
    for (const fn of listeners) fn({[key]: {newValue: structuredClone(value)}}, "local");
  };
  return {...mods.prices, data, fetched, fromOtherTab};
}
const until = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
};

test("export : le cache du navigateur, sans les lectures en échec ni les résumés provisoires", async () => {
  const now = Date.now();
  const m = load({
    "prices-v3": {
      sold: entry(now - HOUR),
      never: {s: {}, c: null, t: now - DAY},
      failed: {s: null, c: null, t: now, err: true},
      partial: {...entry(now - HOUR), partial: true},
    },
  });
  await m.ready;
  const file = m.exportPriceFile();
  assert.equal(file.format, "wikimasters-toolbox/prices");
  assert.deepEqual(Object.keys(file.prices).sort(), ["never", "sold"]);
  // Le fichier se relit tel quel
  const back = core.importPrices(JSON.stringify(file));
  assert.equal(back.error, null);
  assert.deepEqual(back.entries.get("sold"), entry(now - HOUR));
});

test("import : prix plus récents repris, affichés, enregistrés, sans aucune requête au site", async () => {
  const now = Date.now();
  const m = load({"prices-v3": {mine: entry(now - HOUR, 50), stale: entry(now - 5 * DAY, 50)}});
  await m.ready;
  assert.equal(m.priceOf("mine", "SR"), 50);
  const file = core.exportPrices(
    new Map([
      ["mine", entry(now - DAY, 999)],
      ["stale", entry(now - DAY, 80)],
      ["fresh", entry(now - 2 * HOUR, 300, "L")],
    ]),
  );
  const {entries, error} = core.importPrices(JSON.stringify(file));
  assert.equal(error, null);
  const preview = m.previewPriceImport(entries);
  assert.deepEqual([preview.added, preview.updated, preview.kept], [1, 1, 1]);
  // L'aperçu ne change rien
  assert.equal(m.priceOf("stale", "SR"), 50);
  assert.equal(m.priceStatus("fresh", "L"), "unknown");

  const version = m.priceVersion.get().v;
  assert.equal(await m.applyPriceImport(entries), 2);
  assert.equal(m.priceOf("mine", "SR"), 50, "mon prix, plus récent, est gardé");
  assert.equal(m.priceOf("stale", "SR"), 80);
  assert.equal(m.priceOf("fresh", "L"), 300);
  assert.ok(m.priceVersion.get().v > version, "l'affichage est recalculé");
  // Un prix importé garde sa date de lecture : frais s'il a moins de 3 h, à relire sinon
  assert.equal(m.hasFreshPrice("fresh"), true);
  assert.equal(m.hasFreshPrice("stale"), false);
  assert.deepEqual(m.data["prices-v3"].stale, entry(now - DAY, 80));
  assert.deepEqual(m.data["prices-v3"].fresh, entry(now - 2 * HOUR, 300, "L"));
  assert.deepEqual(m.data["prices-v3"].mine, entry(now - HOUR, 50));
  // Les autres onglets sont prévenus sans recevoir tout le fichier
  assert.ok(m.data["prices-v3-delta"].reload > 0);
  assert.equal(m.data["prices-v3-delta"].entries, undefined);
  assert.deepEqual(m.fetched, []);
  // Second import du même fichier : plus rien à reprendre
  assert.equal(await m.applyPriceImport(entries), 0);
});

test("import : un prix plus récent écrit entre-temps par un autre onglet est gardé", async () => {
  const now = Date.now();
  const m = load();
  await m.ready;
  // L'autre onglet a enregistré un prix que celui-ci n'a pas encore repris
  m.data["prices-v3"] = {card: entry(now - HOUR, 70)};
  assert.equal(await m.applyPriceImport(new Map([["card", entry(now - DAY, 10)]])), 1);
  assert.deepEqual(m.data["prices-v3"].card, entry(now - HOUR, 70));
});

test("import dans un autre onglet : le cache enregistré est relu", async () => {
  const now = Date.now();
  const m = load({"prices-v3": {mine: entry(now - HOUR, 50)}});
  await m.ready;
  m.data["prices-v3"] = {mine: entry(now - DAY, 999), other: entry(now - 2 * HOUR, 300, "L")};
  m.fromOtherTab("prices-v3-delta", {tab: "autre", reload: now});
  await until(() => m.priceOf("other", "L") === 300);
  assert.equal(m.priceOf("other", "L"), 300);
  assert.equal(m.priceOf("mine", "SR"), 50, "le prix plus récent de cet onglet est gardé");
});
