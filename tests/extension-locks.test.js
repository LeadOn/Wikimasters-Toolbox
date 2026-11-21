// Verrou entre onglets (navigator.locks) : résultat et erreur de l'opération transmis, opération
// refusée quand le verrou est pris, et cas de Firefox (comportement relevé dans Firefox 159) : le
// navigator.locks d'un script de contenu est celui de la page, et sa promesse est rejetée
// (« Permission denied to access property "then" ») quel que soit le retour du rappel ; seul le
// navigator.locks de la page (wrappedJSObject) appelé avec un rappel exporté fonctionne, à
// condition que ce rappel rende une promesse de la page.
const test = require("node:test");
const assert = require("node:assert/strict");
const {loadExtensionModule} = require("./helpers/extension");

// Promesses et fonctions « de la page » (Firefox)
class PagePromise extends Promise {}
const exported = new WeakSet();
const DENIED = 'Permission denied to access property "then"';

// page : navigator.locks de la page vu par wrappedJSObject (Firefox) ; content : celui que voit le
// script de contenu sous Firefox, toujours rejeté.
function fakeLocks({firefox = false, page = false} = {}) {
  if (firefox && !page) {
    return {request: (name, opts, cb) => Promise.resolve().then(() => (typeof opts === "function" ? opts : cb)({name})).then(() => Promise.reject(new Error(DENIED)))};
  }
  const held = new Map(); // nom → file des rappels en attente
  async function run(name, cb) {
    try {
      if (page && !exported.has(cb)) throw new Error("Permission denied to access object");
      const value = cb({name});
      if (page && value && typeof value.then === "function" && !(value instanceof PagePromise)) {
        throw new Error(DENIED);
      }
      return await value;
    } finally {
      const queue = held.get(name);
      const next = queue.shift();
      if (next) next();
      else held.delete(name);
    }
  }
  return {
    request(name, opts, cb) {
      if (typeof opts === "function") [opts, cb] = [{}, opts];
      if (held.has(name)) {
        if (opts.ifAvailable) return Promise.resolve().then(() => cb(null));
        return new Promise((resolve) => held.get(name).push(resolve)).then(() => run(name, cb));
      }
      held.set(name, []);
      return run(name, cb);
    },
  };
}

function setup({firefox = false} = {}) {
  globalThis.window = globalThis;
  Object.defineProperty(globalThis, "navigator", {value: {languages: ["fr-FR"], locks: fakeLocks({firefox})}, configurable: true, writable: true});
  if (firefox) {
    globalThis.wrappedJSObject = {Promise: PagePromise, navigator: {locks: fakeLocks({firefox, page: true})}};
    globalThis.exportFunction = (fn) => (exported.add(fn), fn);
    globalThis.cloneInto = (value) => structuredClone(value);
  } else {
    delete globalThis.wrappedJSObject;
    delete globalThis.exportFunction;
    delete globalThis.cloneInto;
  }
  return loadExtensionModule("extension/src/content/lib/locks.js");
}

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return {promise, resolve};
};

for (const firefox of [false, true]) {
  const browser = firefox ? "Firefox" : "Chrome";

  test(`${browser} : le résultat et l'erreur de l'opération sont transmis`, async () => {
    const {withLock} = setup({firefox});
    assert.equal(await withLock("sort", async () => 42), 42);
    assert.equal(await withLock("sort", async () => "attendu", {wait: true}), "attendu");
    await assert.rejects(withLock("sort", async () => Promise.reject(new Error("panne"))), /panne/);
    await assert.rejects(withLock("sort", () => {
      throw new Error("synchrone");
    }), /synchrone/);
  });

  test(`${browser} : une opération du même type est refusée, ou attend avec wait`, async () => {
    const {withLock} = setup({firefox});
    const gate = deferred();
    const order = [];
    const first = withLock("packs", async () => {
      await gate.promise;
      order.push("premier");
    });
    await new Promise((r) => setTimeout(r, 0));
    await assert.rejects(withLock("packs", async () => order.push("refusé")), /déjà en cours/);
    const waiting = withLock("packs", async () => order.push("après"), {wait: true});
    assert.equal(await withLock("sort", async () => "autre verrou"), "autre verrou");
    gate.resolve();
    await Promise.all([first, waiting]);
    assert.deepEqual(order, ["premier", "après"]);
  });
}

test("sans navigator.locks, l'opération est lancée directement", async () => {
  const {withLock} = setup();
  globalThis.navigator.locks = undefined;
  assert.equal(await withLock("sort", async () => "direct"), "direct");
});

// Stockage partagé simulé pour tester l'élection d'un onglet meneur (electLeader)
function sharedStorage(initial = {}) {
  const data = structuredClone(initial);
  const listeners = new Set();
  const notify = (changes) => {
    for (const fn of [...listeners]) fn(structuredClone(changes), "local");
  };
  return {
    data,
    chrome: {
      runtime: {id: "test"},
      storage: {
        local: {
          get: async (key) => Object.fromEntries([].concat(key).filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
          set: async (obj) => {
            const changes = {};
            for (const [k, v] of Object.entries(obj)) {
              data[k] = structuredClone(v);
              changes[k] = {newValue: structuredClone(v)};
            }
            notify(changes);
          },
          remove: async (key) => {
            const changes = {};
            for (const k of [].concat(key)) {
              delete data[k];
              changes[k] = {newValue: undefined};
            }
            notify(changes);
          },
        },
        onChanged: {
          addListener: (l) => listeners.add(l),
          removeListener: (l) => listeners.delete(l),
        },
      },
    },
  };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("electLeader : un onglet visible reprend le relais sur un onglet caché ou un bail expiré", async () => {
  const store = sharedStorage({
    "leader:idx": {tab: "hidden-tab", visible: false, at: Date.now()},
  });
  const doc = new EventTarget();
  doc.visibilityState = "visible";
  const win = new EventTarget();
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.chrome = store.chrome;
  const {electLeader} = loadExtensionModule("extension/src/content/lib/locks.js");
  const states = [];
  const handle = electLeader("idx", (on) => states.push(on), {heartbeatMs: 40, ttlMs: 120});
  await wait(30);
  assert.deepEqual(states, [true], "un onglet visible reprend immédiatement le relais d'un onglet caché");
  assert.notEqual(store.data["leader:idx"].tab, "hidden-tab");
  handle.stop();
  assert.deepEqual(states, [true, false]);
  assert.equal(store.data["leader:idx"], undefined, "bail libéré à l'arrêt");

  // Bail visible expiré (onglet figé ou contexte invalidé après rechargement) : repris automatiquement
  store.data["leader:idx"] = {tab: "stale-tab", visible: true, at: Date.now() - 500};
  const states2 = [];
  const handle2 = electLeader("idx", (on) => states2.push(on), {heartbeatMs: 40, ttlMs: 120});
  await wait(30);
  assert.deepEqual(states2, [true], "un bail expiré est repris automatiquement");
  handle2.stop();
});

test("electLeader : deux onglets visibles ne se battent pas, take() transfère le relais proprement", async () => {
  const store = sharedStorage({
    "leader:idx2": {tab: "other-visible", visible: true, at: Date.now()},
  });
  const doc = new EventTarget();
  doc.visibilityState = "visible";
  const win = new EventTarget();
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.chrome = store.chrome;
  const {electLeader} = loadExtensionModule("extension/src/content/lib/locks.js");
  const states = [];
  const handle = electLeader("idx2", (on) => states.push(on), {heartbeatMs: 500, ttlMs: 2000});
  await wait(30);
  assert.deepEqual(states, [], "un autre onglet visible garde le relais");
  await handle.take();
  assert.deepEqual(states, [true], "take() force la reprise dans cet onglet");
  const myTab = store.data["leader:idx2"].tab;
  assert.notEqual(myTab, "other-visible");
  // Un autre onglet reprend le relais via le stockage : cet onglet s'efface aussitôt
  await store.chrome.storage.local.set({"leader:idx2": {tab: "third-tab", visible: true, at: Date.now()}});
  assert.deepEqual(states, [true, false], "cède dès qu'un autre onglet écrit son bail");
  // Fermeture de l'autre onglet (bail supprimé) : reprise immédiate
  await store.chrome.storage.local.remove("leader:idx2");
  await wait(30);
  assert.deepEqual(states, [true, false, true], "reprend aussitôt quand l'autre onglet ferme");
  handle.stop();
});
