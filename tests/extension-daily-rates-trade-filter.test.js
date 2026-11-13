// Taux de drop du jour (statistiques de tirage par jour local) et filtre par prix de la fenêtre
// « Échanger avec … » (mêmes règles que la ligne « Ventes » des filtres de la collection).
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadExtensionModule, response } = require("./helpers/extension");

// Environnement de page minimal : le module des paquets lit le stockage de l'extension au chargement
function fakeBrowser() {
  const target = new EventTarget();
  globalThis.window = globalThis;
  globalThis.addEventListener = target.addEventListener.bind(target);
  globalThis.removeEventListener = target.removeEventListener.bind(target);
  globalThis.dispatchEvent = target.dispatchEvent.bind(target);
  globalThis.document = { addEventListener() { }, visibilityState: "visible", cookie: "" };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  const data = {};
  globalThis.chrome = {
    runtime: { id: "test" },
    storage: {
      local: {
        get: async (key) => Object.fromEntries([].concat(key).filter((k) => k in data).map((k) => [k, data[k]])),
        set: async (obj) => Object.assign(data, structuredClone(obj)),
        remove: async (key) => [].concat(key).forEach((k) => delete data[k]),
      },
      onChanged: { addListener() { }, removeListener() { } },
    },
  };
}

const cards = (...rarities) => rarities.map((rarity, i) => ({ id: `c${i}`, rarity }));

test("taux de drop du jour : comptés par jour local, remis à zéro le lendemain", () => {
  fakeBrowser();
  const { packs } = loadExtensionModule({ packs: "extension/src/content/features/packs.js" });
  const day1 = new Date(2026, 10, 12, 23, 50).getTime();
  const day2 = new Date(2026, 10, 13, 0, 5).getTime();
  assert.equal(packs.dayKey(day1), "2026-11-12");

  let s = { since: 0, packs: 0, cards: 0, byRarity: {}, today: null };
  assert.deepEqual(packs.todayPulls(s, day1), { day: "2026-11-12", packs: 0, cards: 0, byRarity: {} });
  s = packs.addPulls(s, cards("C", "C", "R"), 1, day1);
  s = packs.addPulls(s, cards("C", "L"), 2, day1);
  assert.deepEqual(packs.todayPulls(s, day1), { day: "2026-11-12", packs: 3, cards: 5, byRarity: { C: 3, R: 1, L: 1 } });

  // Le lendemain : plus rien pour le jour, les statistiques depuis le début gardent tout
  assert.equal(packs.todayPulls(s, day2).cards, 0);
  s = packs.addPulls(s, cards("SR"), 1, day2);
  assert.deepEqual(packs.todayPulls(s, day2), { day: "2026-11-13", packs: 1, cards: 1, byRarity: { SR: 1 } });
  assert.equal(s.packs, 4);
  assert.deepEqual(s.byRarity, { C: 3, R: 1, L: 1, SR: 1 });
});

test("taux de drop du jour : statistiques enregistrées avant la version qui les compte", () => {
  fakeBrowser();
  const { packs } = loadExtensionModule({ packs: "extension/src/content/features/packs.js" });
  const old = { since: 0, packs: 10, cards: 50, byRarity: { C: 50 } };
  assert.equal(packs.todayPulls(old).cards, 0);
  const s = packs.addPulls(old, cards("C"), 1);
  assert.equal(s.cards, 51);
  assert.equal(packs.todayPulls(s).cards, 1);
});

test("filtre de prix d'un échange : tous les prix, jamais vendues, vendues entre", () => {
  const f = loadExtensionModule("extension/src/content/features/trade-filter.js");
  const ok = (price) => ({ status: "ok", price });
  const all = { sale: null, min: null, max: null };
  assert.equal(f.matchesPrice({ status: "unknown", price: null }, all), true, "sans filtre, tout passe");

  const never = { sale: "never", min: null, max: null };
  assert.equal(f.matchesPrice({ status: "none", price: null }, never), true);
  assert.equal(f.matchesPrice(ok(12), never), false);
  assert.equal(f.matchesPrice({ status: "few", price: null }, never), false, "vendue, même trop peu");
  assert.equal(f.matchesPrice({ status: "unknown", price: null }, never), null, "prix pas encore lu");

  const range = (min, max) => ({ sale: "range", min, max });
  assert.equal(f.matchesPrice(ok(10), range(6, 10)), true, "bornes incluses");
  assert.equal(f.matchesPrice(ok(11), range(6, 10)), false);
  assert.equal(f.matchesPrice(ok(500), range(101, null)), true, "à partir de");
  assert.equal(f.matchesPrice(ok(3), range(null, 5)), true, "jusqu'à");
  assert.equal(f.matchesPrice(ok(8), range(10, 6)), true, "bornes à l'envers remises dans l'ordre");
  assert.equal(f.matchesPrice({ status: "few", price: null }, range(null, null)), false, "prix indicatif : hors intervalle");
  assert.equal(f.matchesPrice({ status: "error", price: null }, range(0, 100)), false);
  assert.equal(f.matchesPrice({ status: "unknown", price: null }, range(0, 100)), null);
});

test("filtre de prix d'un échange : remis à « Tous les prix »", () => {
  fakeBrowser();
  const f = loadExtensionModule("extension/src/content/features/trade-filter.js");
  f.setTradeFilter({ sale: "range", min: 6, max: 10, rarities: ["L"] });
  assert.equal(f.isFiltering(f.tradeFilter.get()), true);
  f.resetTradeFilter();
  assert.deepEqual(f.tradeFilter.get(), f.NO_TRADE_FILTER);
  assert.equal(f.tradeSide.get().status, "idle");
});

test("filtre de prix d'un échange : toute la collection, raretés, ordre", () => {
  fakeBrowser();
  const f = loadExtensionModule("extension/src/content/features/trade-filter.js");
  // Raretés lues : toutes ([]) couvrent n'importe quel choix ; une partie ne couvre pas « toutes »
  assert.equal(f.covers([], ["L"]), true);
  assert.equal(f.covers(["L", "UR"], ["L"]), true);
  assert.equal(f.covers(["L"], ["L", "UR"]), false);
  assert.equal(f.covers(["L"], []), false);

  const items = [
    { key: "a", card_id: "a", title: "Alpha", rarity: "C" },
    { key: "b", card_id: "b", title: "Bravo", rarity: "L" },
    { key: "c", card_id: "c", title: "Charlie", rarity: "UR" },
    { key: "d", card_id: "d", title: "Delta", rarity: "R" },
    { key: "e", card_id: "e", title: "Echo", rarity: "SR" },
  ];
  const prices = { a: { status: "ok", price: 4 }, b: { status: "ok", price: 9800 }, c: { status: "ok", price: 1450 }, d: { status: "none", price: null }, e: { status: "unknown", price: null } };
  const priced = (it) => prices[it.card_id];
  const keys = (list) => list.map((it) => it.key).join("");
  assert.equal(keys(f.filterTradeItems(items, { sale: "range", min: null, max: null, rarities: [] }, priced)), "bca", "les plus chères d'abord, prix non lus écartés");
  assert.equal(keys(f.filterTradeItems(items, { sale: "range", min: 5, max: 2000, rarities: [] }, priced)), "c");
  assert.equal(keys(f.filterTradeItems(items, { sale: "range", min: null, max: null, rarities: ["L", "C"] }, priced)), "ba");
  assert.equal(keys(f.filterTradeItems(items, { sale: "never", min: null, max: null, rarities: [] }, priced)), "d");
});

test("collection d'un ami : pages lues avec latence entre chaque appel", async () => {
  fakeBrowser();
  const { friendCollection } = loadExtensionModule("extension/src/content/features/trades.js");
  const card = (n) => ({ id: `uc-${n}`, card_id: `c-${n}`, count: 1, card: { id: `c-${n}`, wikipedia_title: `Carte ${n}`, rarity: "L" } });
  const pages = [Array.from({ length: 50 }, (_, i) => card(i)), Array.from({ length: 50 }, (_, i) => card(50 + i)), [card(100), card(101)]];
  const calls = [];
  let active = 0;
  let maxActive = 0;
  globalThis.fetch = async (url) => {
    active++;
    maxActive = Math.max(maxActive, active);
    calls.push({ url: String(url), at: Date.now() });
    await new Promise((r) => setTimeout(r, 10));
    active--;
    const p = Number(new URL(url, "https://www.wiki-masters.com").searchParams.get("page"));
    return response(200, { collection: pages[p] || [], total: 102, pendingTradeCardIds: ["c-50"] });
  };
  const res = await friendCollection("Alice", { rarities: ["L"], pageDelay: 35 });
  assert.equal(calls.length, 3);
  assert.ok(maxActive <= 2, `au plus 2 pages simultanées : ${maxActive}`);
  assert.ok(calls[1].at - calls[0].at >= 30, `latence 1→2 : ${calls[1].at - calls[0].at} ms`);
  assert.ok(calls[2].at - calls[1].at >= 25, `latence 2→3 : ${calls[2].at - calls[1].at} ms`);
  assert.equal(res.items.length, 102);
});
