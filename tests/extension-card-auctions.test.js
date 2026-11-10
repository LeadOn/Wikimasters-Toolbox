// Prochaines enchères d'une carte (analyse d'une enchère) : lecture exacte par l'id de la carte,
// de la fin la plus proche à la plus lointaine, sans les enchères terminées mais pas encore réglées.
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

test("enchères d'une carte : par son id, actives et pas encore finies", async () => {
  fakeBrowser();
  const now = Date.parse("2026-11-10T12:00:00Z");
  const rows = [
    {id: "old", card_id: "c1", end_at: "2026-11-10T11:59:00Z", seller_id: "x"},
    {id: "a1", card_id: "c1", end_at: "2026-11-10T12:05:00Z", seller_id: "me"},
    {id: "a2", card_id: "c1", end_at: "2026-11-10T18:00:00Z", seller_id: "y", current_bidder_id: "me"},
  ];
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({url: String(url), method: init.method || "GET"});
    return response(200, rows);
  };
  const market = loadExtensionModule("extension/src/content/features/market.js");
  const list = await market.cardAuctions("c1", {now});
  assert.deepEqual(list.map((a) => a.id), ["a1", "a2"], "l'enchère finie mais pas encore réglée est écartée");
  const url = decodeURIComponent(calls.find((c) => c.url.includes("/auctions?")).url);
  assert.match(url, /card_id=eq\.c1/);
  assert.match(url, /status=eq\.active/);
  assert.match(url, /order=end_at\.asc,id\.asc/, "tri stable, fin la plus proche d'abord");
  assert.ok(calls.every((c) => c.method === "GET"), "lecture seule");
  assert.equal(market.isMySale(list[0]), true);
  assert.equal(market.isLeading(list[1]), true);
});

test("enchères d'une carte : réponse inattendue signalée", async () => {
  fakeBrowser();
  globalThis.fetch = async () => response(200, {message: "?"});
  const market = loadExtensionModule("extension/src/content/features/market.js");
  await assert.rejects(market.cardAuctions("c1"), /Réponse inattendue/);
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
    if (url.includes("/auctions?")) return response(200, auctions);
    return response(404, {});
  };
  const market = loadExtensionModule("extension/src/content/features/market.js");
  const res = await market.cardMarket("c1");
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
    return response(200, []);
  };
  const market = loadExtensionModule("extension/src/content/features/market.js");
  const res = await market.cardMarket("c1");
  assert.equal(res.auctions.length, 0);
  assert.equal(res.myBids.size, 0);
  assert.ok(!calls.some((u) => u.includes("/auction_bids?")));
});
