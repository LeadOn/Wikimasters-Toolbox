// Avertissement à accepter avant que la Toolbox ne démarre : choix enregistré, nouvelle version du
// texte redemandée ; réponses du site gardées (les dernières) sans être transmises tant qu'il n'est pas
// accepté, puis transmises à l'acceptation.
const test = require("node:test");
const assert = require("node:assert/strict");
const {loadExtensionModule} = require("./helpers/extension");

function fakeBrowser(saved = {}) {
  const target = new EventTarget();
  globalThis.window = globalThis;
  globalThis.addEventListener = target.addEventListener.bind(target);
  globalThis.removeEventListener = target.removeEventListener.bind(target);
  globalThis.dispatchEvent = target.dispatchEvent.bind(target);
  globalThis.document = {addEventListener() {}, visibilityState: "visible", cookie: ""};
  const data = structuredClone(saved);
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
  return data;
}

const flush = () => new Promise((r) => setTimeout(r, 450)); // écritures regroupées du stockage

test("avertissement : à demander au premier lancement, choix enregistré, nouvelle version redemandée", async () => {
  const data = fakeBrowser();
  let d = loadExtensionModule("extension/src/content/state/disclaimer.js");
  await d.disclaimer.ready;
  assert.equal(d.isAccepted(), false);
  assert.equal(d.mustAsk(), true, "premier lancement : affiché d'office");
  d.disclaimerView.set({open: true});
  d.acceptDisclaimer();
  assert.equal(d.isAccepted(), true);
  assert.equal(d.disclaimerView.get().open, false);
  await flush();
  assert.equal(data.disclaimer.version, d.DISCLAIMER_VERSION);

  // Rechargement : accepté une fois pour toutes
  fakeBrowser(data);
  d = loadExtensionModule("extension/src/content/state/disclaimer.js");
  await d.disclaimer.ready;
  assert.equal(d.isAccepted(), true);
  assert.equal(d.mustAsk(), false);

  // Refus : inactive, et l'avertissement ne revient pas de lui-même
  d.refuseDisclaimer();
  assert.equal(d.isAccepted(), false);
  assert.equal(d.mustAsk(), false);

  // Texte d'une version antérieure accepté : redemandé
  fakeBrowser({disclaimer: {version: d.DISCLAIMER_VERSION - 1, acceptedAt: 1, refusedAt: null}});
  d = loadExtensionModule("extension/src/content/state/disclaimer.js");
  await d.disclaimer.ready;
  assert.equal(d.isAccepted(), false);
  assert.equal(d.mustAsk(), true);
});

test("pont du hook : rien n'est transmis avant l'acceptation, les réponses gardées le sont ensuite", () => {
  fakeBrowser();
  const bus = loadExtensionModule("extension/src/content/lib/bus.js");
  const seen = [];
  bus.on("wikibidous", ({data}) => seen.push(data.balance));
  let allowed = false;
  const flushHook = bus.startHookBridge(() => allowed);
  const post = (balance) => {
    const e = new Event("message");
    Object.assign(e, {source: globalThis, data: {__wmt: "hook", type: "response", path: "/api/wikibidous", method: "GET", status: 200, data: {balance}}});
    globalThis.dispatchEvent(e);
  };
  post(1);
  post(2);
  flushHook();
  assert.deepEqual(seen, [], "pas accepté : rien n'est transmis, même au vidage");
  allowed = true;
  flushHook();
  assert.deepEqual(seen, [1, 2], "accepté : les réponses gardées sont transmises");
  post(3);
  assert.deepEqual(seen, [1, 2, 3], "puis chaque nouvelle réponse");
  flushHook();
  assert.deepEqual(seen, [1, 2, 3], "rien n'est transmis deux fois");

  // Une action faite avant l'acceptation (paquet ouvert) ne déclenche rien après coup
  const bus3 = loadExtensionModule("extension/src/content/lib/bus.js");
  const opened = [];
  bus3.on("pack-opened", () => opened.push(1));
  let allowed3 = false;
  const flush3 = bus3.startHookBridge(() => allowed3);
  const e = new Event("message");
  Object.assign(e, {source: globalThis, data: {__wmt: "hook", type: "response", path: "/api/packs/open", method: "POST", status: 200, data: {cards: []}}});
  globalThis.dispatchEvent(e);
  allowed3 = true;
  flush3();
  assert.deepEqual(opened, [], "paquet ouvert avant l'acceptation : ni récapitulatif ni tri");

  // Au plus les 100 dernières réponses gardées
  const bus2 = loadExtensionModule("extension/src/content/lib/bus.js");
  const seen2 = [];
  bus2.on("wikibidous", ({data}) => seen2.push(data.balance));
  let allowed2 = false;
  const flush2 = bus2.startHookBridge(() => allowed2);
  for (let i = 0; i < 120; i++) post(i);
  allowed2 = true;
  flush2();
  assert.equal(seen2.length, 100);
  assert.equal(seen2[0], 20, "les plus anciennes sont oubliées");
});
