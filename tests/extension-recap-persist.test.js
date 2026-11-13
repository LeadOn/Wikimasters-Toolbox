// Dernier récapitulatif de paquet gardé dans le stockage de l'extension : repris après un
// rechargement de la page, allégé, jamais écrasé par un paquet plus ancien.
const test = require("node:test");
const assert = require("node:assert/strict");
const {loadExtensionModule} = require("./helpers/extension");

// Stockage d'extension en mémoire, partagé entre deux chargements du module (deux pages)
function fakeBrowser() {
  const target = new EventTarget();
  globalThis.window = globalThis;
  globalThis.addEventListener = target.addEventListener.bind(target);
  globalThis.removeEventListener = target.removeEventListener.bind(target);
  globalThis.dispatchEvent = target.dispatchEvent.bind(target);
  globalThis.document = {addEventListener() {}, visibilityState: "visible", cookie: ""};
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.fetch = async () => {
    throw new Error("hors ligne");
  };
  const data = {};
  globalThis.chrome = {
    runtime: {id: "test"},
    storage: {
      local: {
        get: async (key) => Object.fromEntries([].concat(key).filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
        set: async (obj) => Object.assign(data, structuredClone(obj)),
        remove: async (key) => [].concat(key).forEach((k) => delete data[k]),
      },
      onChanged: {addListener() {}, removeListener() {}},
    },
  };
  return data;
}

const loadPacks = async () => {
  const packs = loadExtensionModule("extension/src/content/features/packs.js");
  await packs.lastRecap.ready;
  return packs;
};
const flush = () => new Promise((r) => setTimeout(r, 450)); // écritures regroupées du stockage

const cards = [
  {id: "c1", wikipedia_title: "Gears", category: "jeu vidéo", summary: "x".repeat(2000), rarity: "SR", user_card_id: "uc-1", isNew: true, atk: 12, pageviews: 999, created_at: "2026-04-01"},
  {id: "c2", wikipedia_title: "Macka B", rarity: "PC", user_card_id: "uc-2", isNew: false, action: {kind: "discarded"}},
];

test("le récapitulatif gardé ne contient que l'utile, sans tri en cours", async () => {
  fakeBrowser();
  const {recapSnapshot} = await loadPacks();
  const snap = recapSnapshot({cards, packs: 1, at: 5, source: "reveal", phase: "revealing", pricesLoading: true, sort: {status: "running"}});
  assert.equal(snap.cards[0].summary.length, 600);
  // Attaque, défense, Q-Score et vues sont montrés dans le détail d'une carte : gardés
  assert.equal(snap.cards[0].atk, 12);
  assert.equal(snap.cards[0].pageviews, 999);
  assert.equal(snap.cards[0].created_at, undefined);
  assert.equal(snap.cards[0].category, "jeu vidéo");
  assert.deepEqual(snap.cards[1].action, {kind: "discarded"});
  assert.equal(snap.sort, null);
  assert.equal("phase" in snap || "pricesLoading" in snap, false);
  const done = {status: "done", byIndex: [{status: "sorted", tags: ["Sports"]}]};
  assert.deepEqual(recapSnapshot({cards, packs: 1, at: 5, sort: done}).sort, done);
});

test("après un rechargement, le dernier récapitulatif revient, prêt à afficher", async () => {
  const data = fakeBrowser();
  const first = await loadPacks();
  first.recapState.set({cards, packs: 1, at: 7, phase: "revealing", source: "reveal", dismissed: false, sort: null});
  await flush();
  assert.equal(data.lastRecap.at, 7);

  const second = await loadPacks();
  const r = second.recapState.get();
  assert.equal(r.at, 7);
  assert.equal(r.phase, "ready", "rechargé pendant la révélation : affiché directement");
  assert.equal(r.cards.length, 2);
  assert.equal(r.cards[1].action.kind, "discarded");
  await flush();
  assert.equal(second.recapState.get().pricesLoading, false, "prix indisponibles : le chargement se termine quand même");
});

test("un récapitulatif fermé reste fermé après un rechargement", async () => {
  fakeBrowser();
  const first = await loadPacks();
  first.recapState.set({cards, packs: 1, at: 8, phase: "ready", source: "reveal", dismissed: false});
  first.dismissRecap();
  await flush();
  const second = await loadPacks();
  assert.equal(second.recapState.get().dismissed, true);
});

test("un paquet ouvert entre-temps n'est pas remplacé, et un ancien n'écrase pas un plus récent", async () => {
  fakeBrowser();
  const packs = await loadPacks();
  packs.recapState.set({cards, packs: 1, at: 20, phase: "ready", source: "reveal"});
  await flush();
  assert.equal(packs.restoreRecap({cards: [cards[0]], packs: 1, at: 3, source: "openAll"}), false);
  assert.equal(packs.recapState.get().at, 20);
  // Un autre onglet a gardé un paquet plus récent : un changement de notre ancien récapitulatif ne l'écrase pas
  packs.lastRecap.set(() => ({cards: [cards[0]], packs: 1, at: 30, source: "reveal", dismissed: false, sort: null}));
  packs.recapState.set({pricesLoading: false, cards: [...cards]});
  await flush();
  assert.equal(packs.lastRecap.get().at, 30);
});
