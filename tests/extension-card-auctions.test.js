// Prochaines enchères d'une carte (analyse d'une enchère) : recherche du marché par titre, gardées
// pour l'id de la carte, de la fin la plus proche à la plus lointaine, sans les enchères terminées.
const test = require("node:test");
const assert = require("node:assert/strict");
const {loadExtensionModule, response, fakeJwt, sessionCookie} = require("./helpers/extension");

function fakeBrowser() {
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

test("enchères d'une carte : recherche du marché par titre, gardées pour l'id, actives et pas encore finies", async () => {
  fakeBrowser();
  const now = Date.parse("2026-11-10T12:00:00Z");
  const pages = {
    1: {auctions: [
      {id: "old", card_id: "c1", status: "active", end_at: "2026-11-10T11:59:00Z", seller_id: "x"},
      {id: "a2", card_id: "c1", status: "active", end_at: "2026-11-10T18:00:00Z", seller_id: "y", current_bidder_id: "me"},
      {id: "other", card_id: "c9", status: "active", end_at: "2026-11-10T12:01:00Z"},
    ], hasMore: true},
    2: {auctions: [{id: "a1", card_id: "c1", status: "active", end_at: "2026-11-10T12:05:00Z", seller_id: "me"}], hasMore: false},
  };
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    calls.push({url, method: init.method || "GET"});
    return response(200, pages[new URL(url, "https://www.wiki-masters.com").searchParams.get("page")]);
  };
  const market = loadExtensionModule("extension/src/content/features/market.js");
  const list = await market.cardAuctions({id: "c1", title: "Gundam"}, {now});
  assert.deepEqual(list.map((a) => a.id), ["a1", "a2"], "fin la plus proche d'abord ; finie mais pas réglée écartée ; autre carte écartée");
  assert.equal(calls.length, 2, "page suivante tant que le site en annonce une");
  const q = new URL(calls[0].url, "https://www.wiki-masters.com").searchParams;
  assert.equal(q.get("q"), "Gundam");
  assert.equal(q.get("limit"), "50", "seule taille de page acceptée par le site");
  assert.equal(q.get("sort"), "ending_soon");
  assert.ok(calls.every((c) => c.url.startsWith("/api/marketplace?") && c.method === "GET"), "lecture seule, routes du site");
  assert.equal(market.isMySale(list[0]), true);
  assert.equal(market.isLeading(list[1]), true);
});

test("enchères d'une carte : au plus 3 pages, réponse inattendue signalée", async () => {
  fakeBrowser();
  let n = 0;
  globalThis.fetch = async () => {
    n++;
    return response(200, {auctions: [], hasMore: true});
  };
  const market = loadExtensionModule("extension/src/content/features/market.js");
  assert.deepEqual(await market.cardAuctions({id: "c1", wikipedia_title: "Paris"}), []);
  assert.equal(n, 3);
  globalThis.fetch = async () => response(200, {message: "?"});
  await assert.rejects(market.cardAuctions({id: "c1", title: "X"}), /Réponse inattendue/);
});

test("mes mises sur les enchères d'une carte : les miennes seulement, la plus haute par enchère", async () => {
  fakeBrowser();
  const future = new Date(Date.now() + 3600e3).toISOString();
  const auctions = [
    {id: "a1", card_id: "c1", end_at: future, current_bidder_id: "me"},
    {id: "a2", card_id: "c1", end_at: future, current_bidder_id: "x"},
    {id: "a3", card_id: "c1", end_at: future},
  ];
  const bids = [
    {auction_id: "a1", amount: 100},
    {auction_id: "a2", amount: 80},
    {auction_id: "a2", amount: 120},
  ];
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    calls.push({url, method: init.method || "GET"});
    if (url.includes("/auction_bids?")) return response(200, bids);
    if (url.startsWith("/api/marketplace?")) return response(200, {auctions, hasMore: false});
    return response(404, {});
  };
  const market = loadExtensionModule("extension/src/content/features/market.js");
  const res = await market.cardMarket({id: "c1", title: "Carte"});
  assert.deepEqual(res.auctions.map((a) => a.id), ["a1", "a2", "a3"]);
  assert.deepEqual([...res.myBids], [["a1", 100], ["a2", 120]], "la plus haute de mes mises par enchère");
  const url = decodeURIComponent(calls.find((c) => c.url.includes("/auction_bids?")).url);
  assert.match(url, /bidder_id=eq\.me/, "mes mises seulement");
  assert.match(url, /auction_id=in\.\(a1,a2,a3\)/, "sur les enchères en cours de la carte");
  assert.ok(calls.every((c) => c.method === "GET"), "lecture seule");
});

test("mes mises : aucune enchère en cours, aucune lecture des mises", async () => {
  fakeBrowser();
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return response(200, String(url).startsWith("/api/marketplace?") ? {auctions: [], hasMore: false} : []);
  };
  const market = loadExtensionModule("extension/src/content/features/market.js");
  const res = await market.cardMarket({id: "c1", title: "Carte"});
  assert.equal(res.auctions.length, 0);
  assert.equal(res.myBids.size, 0);
  assert.ok(!calls.some((u) => u.includes("/auction_bids?")));
});
