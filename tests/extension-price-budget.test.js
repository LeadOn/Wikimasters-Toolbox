// Budget des lectures de prix partagé entre onglets : comptage exact malgré la synchronisation
// chrome.storage, respect de la rafale et de la fenêtre réglées dans les paramètres, mise à
// l'échelle de la cadence lente et bornage des valeurs enregistrées.
const test = require("node:test");
const assert = require("node:assert/strict");
const {loadExtensionModule, response} = require("./helpers/extension");

function setup({initial = {}, delayMs = 0} = {}) {
  Object.defineProperty(globalThis.navigator, "locks", {value: undefined, configurable: true});
  const target = new EventTarget();
  globalThis.window = globalThis;
  globalThis.addEventListener = target.addEventListener.bind(target);
  globalThis.removeEventListener = target.removeEventListener.bind(target);
  globalThis.document = {addEventListener() {}, visibilityState: "visible", cookie: ""};
  const data = structuredClone(initial);
  const listeners = [];
  globalThis.chrome = {
    runtime: {id: "test"},
    storage: {
      local: {
        get: async (key) => Object.fromEntries([].concat(key).filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
        // Chaque écriture prévient aussitôt les écouteurs, avec une copie de la valeur
        set: async (obj) => {
          const changes = {};
          for (const [k, v] of Object.entries(obj)) {
            data[k] = structuredClone(v);
            changes[k] = {newValue: structuredClone(v)};
          }
          for (const listener of listeners) listener(changes, "local");
        },
        remove: async () => {},
      },
      onChanged: {addListener: (l) => listeners.push(l), removeListener() {}},
    },
  };
  const reads = [];
  globalThis.fetch = async (url) => {
    reads.push(String(url));
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return response(200, {computed_at: null, by_rarity: {}});
  };
  const mods = loadExtensionModule({
    prices: "extension/src/content/state/prices.js",
    settings: "extension/src/content/state/settings.js",
  });
  return {...mods, reads, data};
}

const until = async (check, ms = 2000) => {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
};

test("budget des prix : lectures simultanées toutes comptées, rafale respectée malgré la synchronisation entre onglets", async () => {
  const {prices, settings, reads} = setup({delayMs: 100});
  await Promise.all([settings.settings.ready, prices.ready]);
  for (let i = 0; i < 20; i++) prices.requestPrice(`c${i}`);
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal(reads.length, prices.PRICE_BUDGET.BURST_MAX / 2, "cartes affichées : la moitié de la rafale");
  assert.equal(prices.slowBudget.get().reads.length, reads.length, "chaque lecture comptée, même deux dans la même milliseconde");
});

test("budget des prix : quota et rafale réglés dans les paramètres appliqués tout de suite", async () => {
  const {prices, settings, reads} = setup();
  await Promise.all([settings.settings.ready, prices.ready]);
  // Rafale baissée à 4 : 2 cartes affichées au plus
  settings.settings.set({priceQuotaWindow: 60, priceQuotaBurst: 4});
  for (let i = 0; i < 10; i++) prices.requestPrice(`d${i}`);
  await until(() => reads.length >= 2);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(reads.length, 2, "moitié de la rafale configurée (4 / 2 = 2)");
  // Augmentation en direct à 16 : la file en attente repart jusqu'à 8 (16 / 2)
  settings.settings.set({priceQuotaBurst: 16});
  await until(() => reads.length >= 8);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(reads.length, 8, "relance immédiate après hausse de la rafale");
  // Fenêtre plus basse que la rafale : la fenêtre limite les lectures prioritaires
  settings.settings.set({priceQuotaWindow: 10, priceQuotaBurst: 40});
  for (let i = 0; i < 5; i++) prices.requestPrice(`h${i}`, {detail: true});
  await until(() => reads.length >= 10);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(reads.length, 10, "la fenêtre de 10 min plafonne même avec une rafale plus haute");
});

test("budget des prix : cadence de la voie lente proportionnelle au quota, valeurs hors bornes ramenées dans les limites", async () => {
  const {prices, settings} = setup({initial: {settings: {priceQuotaWindow: 99999, priceQuotaBurst: 0}}});
  await Promise.all([settings.settings.ready, prices.ready]);
  assert.deepEqual(prices.priceQuota(), {
    window: settings.PRICE_QUOTA_LIMITS.window.max,
    burst: settings.PRICE_QUOTA_LIMITS.burst.min,
  });
  // Quota par défaut (60)
  settings.settings.set({priceQuotaWindow: 60, priceQuotaBurst: 10});
  assert.deepEqual(prices.slowSpeed("normal"), {gap: 60000, cap: 1440});
  assert.deepEqual(prices.slowSpeed("fast"), {gap: 30000, cap: 2880});
  // Quota doublé (120) : écart divisé par 2, plafond doublé
  settings.settings.set({priceQuotaWindow: 120});
  assert.deepEqual(prices.slowSpeed("normal"), {gap: 30000, cap: 2880});
  assert.deepEqual(prices.slowSpeed("fast"), {gap: 15000, cap: 5760});
  // Quota divisé par 2 (30)
  settings.settings.set({priceQuotaWindow: 30});
  assert.deepEqual(prices.slowSpeed("normal"), {gap: 120000, cap: 720});
  assert.deepEqual(prices.slowSpeed("fast"), {gap: 60000, cap: 1440});
  // Valeur illisible ou vide → défaut
  assert.equal(settings.clampQuota("", settings.PRICE_QUOTA_LIMITS.window), 60);
  assert.equal(settings.clampQuota("abc", settings.PRICE_QUOTA_LIMITS.burst), 10);
});
