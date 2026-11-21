// Page « Stonks » : journal tiré de mes enchères du marché et de mes notifications de vente et
// d'achat, lecture seule, pagination stable, cartes encore en stock d'après ma collection.
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

const at = (day) => `2026-10-${String(day).padStart(2, "0")}T12:00:00Z`;
const auction = (id, card, price, day, side, extra = {}) => ({
  id,
  card_id: card,
  status: "settled_sold",
  snapshot_rarity: "C",
  final_price: price,
  settled_at: at(day),
  is_shiny: false,
  seller_id: side === "sell" ? "me" : "other",
  winner_id: side === "buy" ? "me" : "other",
  ...extra,
});
// Mes enchères du marché (50 dernières de chaque) : une vente, un achat ; une enchère invendue ignorée
const MINE = {
  history: [auction("s1", "a", 150, 3, "sell"), auction("u1", "a", null, 5, "sell", {status: "settled_unsold", winner_id: null})],
  won: [auction("b1", "a", 100, 1, "buy")],
};
// Notifications : plus anciennes que mes enchères du marché, sans rareté
const note = (id, type, auctionId, card, price, day) => ({id, type, created_at: at(day), data: {auction_id: auctionId, card_id: card, final_price: price}});
const NOTES = [note("n1", "marketplace_auction_won", "b2", "b", 60, 2), note("n2", "marketplace_auction_won", "b3", "c", 30, 2), note("n3", "marketplace_auction_sold", "s2", "z", 40, 4), note("n4", "marketplace_auction_sold", "s1", "a", 150, 3)];
const CARDS = ["a", "b", "c", "z"].map((id) => ({id, wikipedia_title: `Carte ${id}`, rarity: id === "z" ? "R" : "C", image_url: "x.jpg", hide_image: id === "b"}));
// Ma collection : la carte b est toujours là, la carte c a été défaussée
const COPIES = [{id: "u1", card_id: "b", count: 1, starred: false, is_shiny: false, snapshot_rarity: "C", obtained_at: at(2), cards: CARDS[1]}];

function scripted({fail} = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    calls.push({url: u, method: init.method || "GET"});
    if (fail && u.includes("/notifications")) return response(400, {message: "requête refusée"});
    if (u.startsWith("/api/marketplace?")) return response(200, MINE);
    if (u.includes("/notifications?")) return response(200, u.includes("created_at=gte") ? [] : NOTES);
    if (u.includes("/cards?")) return response(200, CARDS.filter((c) => u.includes(c.id)));
    if (u.includes("/user_cards")) return response(200, COPIES);
    return response(200, {});
  };
  return calls;
}

test("stonks : journal tiré de mes enchères et de mes notifications, ventes rapprochées des achats, sans écriture", async () => {
  fakeBrowser();
  const calls = scripted();
  const {stonksState, loadStonks} = loadExtensionModule("extension/src/content/features/stonks.js");
  await loadStonks();
  const s = stonksState.get();
  assert.equal(s.error, null);
  assert.ok(calls.some((c) => c.url === "/api/marketplace?page=1&limit=50&sort=recent&mine=1"), "mes enchères, avec les paramètres du site");
  const notes = calls.find((c) => c.url.includes("/notifications?"));
  assert.match(notes.url, /type=in\.\(marketplace_auction_sold,marketplace_auction_won\)/);
  assert.match(notes.url, /order=created_at\.asc,id\.asc/, "ordre stable pour la pagination");
  assert.ok(!calls.some((c) => c.url.includes("/auctions")), "la table auctions n'est plus lue");
  assert.ok(calls.every((c) => c.method === "GET"), "lecture seule");
  const byId = Object.fromEntries(s.ops.map((op) => [op.id, op]));
  assert.equal(Object.keys(byId).length, 5, "s1 vu deux fois (enchère et notification) compte une fois ; l'invendue est ignorée");
  assert.equal(byId.s1.profit, 50, "vendue 150, achetée 100");
  assert.equal(byId.s2.cost, null, "carte jamais achetée");
  assert.equal(byId.s2.rarity, "R", "notification : rareté de la carte");
  assert.equal(s.cards.get("b").image_url, null, "image masquée par le site : pas d'image");
  assert.deepEqual(
    s.open.map((op) => op.id),
    ["b2"],
    "en stock : achetée, pas revendue, toujours dans la collection (c a été défaussée)",
  );
});

test("stonks : historique gardé quelques minutes, relu depuis la dernière notification ; une panne est signalée", async () => {
  fakeBrowser();
  let calls = scripted();
  const {stonksState, loadStonks} = loadExtensionModule("extension/src/content/features/stonks.js");
  await loadStonks();
  const n = calls.length;
  await loadStonks();
  assert.equal(calls.length, n, "pas de nouvelle lecture");
  calls = scripted();
  await loadStonks({force: true});
  const again = calls.find((c) => c.url.includes("/notifications?"));
  assert.match(again.url, /created_at=gte\.2026-10-04T12:00:00Z/, "seulement les notifications depuis la dernière lue");
  assert.ok(!calls.some((c) => c.url.startsWith("/api/marketplace?")), "mes enchères relues au plus toutes les 10 min");
  assert.equal(stonksState.get().ops.length, 5, "le journal garde ce qui a déjà été vu");
  calls = scripted({fail: true});
  await loadStonks({force: true});
  assert.match(stonksState.get().error, /./);
  assert.equal(stonksState.get().ops.length, 5, "l'historique déjà lu reste affiché");
  assert.equal(stonksState.get().loading, false);
});
