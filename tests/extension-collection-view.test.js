// Ma collection filtrée (onglet Prix, page Collection) : critères cumulables et prix de vente ;
// mise en vente et défausse d'un exemplaire par carte, une à une ou par lot. Jamais un favori, une
// requête par carte, arrêt à la première erreur, jamais d'écriture rejouée ; l'exemplaire traité
// quitte la liste.
const test = require("node:test");
const assert = require("node:assert/strict");
const {loadExtensionModule, response, fakeJwt, sessionCookie} = require("./helpers/extension");
const core = require("../core");

// Réponse de /api/marketplace/cards/<id>/price-history : {RARETÉ: [moyenne, ventes]} pour la semaine en cours
const history = (byRarity) => {
  const start = core.weekStart(new Date()).toISOString().slice(0, 10);
  return {
    computed_at: new Date(Date.now() - 3600e3).toISOString(),
    by_rarity: Object.fromEntries(Object.entries(byRarity).map(([r, [avg, count]]) => [r, {weekly: [{start, avg, min: avg, max: avg, count}], monthly: [{start: start.slice(0, 8) + "01", avg, min: avg, max: avg, count}]}])),
  };
};

function fakeBrowser() {
  const target = new EventTarget();
  globalThis.window = globalThis;
  globalThis.addEventListener = target.addEventListener.bind(target);
  globalThis.removeEventListener = target.removeEventListener.bind(target);
  globalThis.dispatchEvent = target.dispatchEvent.bind(target);
  globalThis.document = {addEventListener() {}, visibilityState: "visible", cookie: ""};
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

// reply(url) → réponse, ou erreur levée par fetch
function scriptedFetch(reply) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({url, method: init.method, body: init.body});
    const r = typeof reply === "function" ? reply(url) : reply;
    if (r instanceof Error) throw r;
    return r;
  };
  return calls;
}

const copies = [
  {id: "uc-fav", card_id: "c1", rarity: "C", count: 1, starred: true, card: {id: "c1", wikipedia_title: "Gears"}},
  {id: "uc-shiny", card_id: "c1", rarity: "C", count: 1, is_shiny: true, card: {id: "c1", wikipedia_title: "Gears"}},
  {id: "uc-1", card_id: "c1", rarity: "C", count: 2, card: {id: "c1", wikipedia_title: "Gears"}},
  {id: "uc-2", card_id: "c2", rarity: "R", count: 1, card: {id: "c2", wikipedia_title: "Odense"}},
  {id: "uc-3", card_id: "c3", rarity: "PC", count: 1, card: {id: "c3", wikipedia_title: "Macka B"}},
  {id: "uc-locked", card_id: "c4", rarity: "C", count: 1, starred: true, card: {id: "c4", wikipedia_title: "Favori"}},
];

function setup() {
  fakeBrowser();
  const view = loadExtensionModule("extension/src/content/features/collection-view.js");
  view.cardsState.set({copies, loading: false});
  // Groupes à jour, comme la liste affichée
  const group = (cardId) => core.groupCopies(view.cardsState.get().copies).find((g) => g.card_id === cardId);
  const ids = () => view.cardsState.get().copies.map((c) => `${c.id}×${c.count}`);
  return {view, group, ids};
}

test("collection filtrée : défausse d'un exemplaire, jamais un favori, une shiny en dernier", async () => {
  const {view, group, ids} = setup();
  const calls = scriptedFetch(response(200, {success: true}));
  await view.discardGroup(group("c1"));
  assert.deepEqual(calls, [{url: "/api/user-cards/uc-1/discard", method: "POST", body: undefined}]);
  assert.deepEqual(ids(), ["uc-fav×1", "uc-shiny×1", "uc-1×1", "uc-2×1", "uc-3×1", "uc-locked×1"], "un exemplaire de moins, la collection en cache n'est pas modifiée");
  await view.discardGroup(group("c1"));
  await view.discardGroup(group("c1"));
  assert.equal(calls[2].url, "/api/user-cards/uc-shiny/discard");
  // Il ne reste que le favori : plus aucune requête
  await assert.rejects(view.discardGroup(group("c1")), /favori/);
  await assert.rejects(view.discardGroup(group("c4")), /favori/);
  assert.equal(calls.length, 3);
});

test("collection filtrée : défausse des cartes cochées, une requête par carte, arrêt à la première erreur", async () => {
  const {view, group, ids} = setup();
  const calls = scriptedFetch((url) => (url.includes("uc-2") ? response(400, {error: "Carte engagée dans un échange"}) : response(200, {success: true})));
  const progress = [];
  await assert.rejects(
    view.discardGroups([group("c3"), group("c2"), group("c1")], {onProgress: (n) => progress.push(n)}),
    (e) => e.done === 1 && /échange/.test(e.message),
  );
  assert.deepEqual(calls.map((c) => c.url), ["/api/user-cards/uc-3/discard", "/api/user-cards/uc-2/discard"], "rien après l'échec");
  assert.deepEqual(progress, [1]);
  assert.ok(!ids().includes("uc-3×1") && ids().includes("uc-2×1"), "seule la carte défaussée quitte la liste");
  // Annulation : rien n'est envoyé après l'arrêt demandé
  const abort = new AbortController();
  abort.abort();
  assert.equal(await view.discardGroups([group("c1")], {signal: abort.signal}), 0);
  assert.equal(calls.length, 2);
});

test("collection filtrée : défausse sans réponse → jamais rejouée, collection relue", async () => {
  const {view, group} = setup();
  const calls = scriptedFetch(new TypeError("fetch failed"));
  await assert.rejects(view.discardGroups([group("c2"), group("c3")]), (e) => e.uncertain && e.done === 0);
  assert.equal(calls.filter((c) => c.url.includes("/discard")).length, 1);
  assert.equal(view.cardsState.get().loading, true, "la collection est relue avant toute nouvelle action");
});

test("collection filtrée : mise aux enchères des cartes cochées, id de l'exemplaire, même mise pour toutes", async () => {
  const {view, group, ids} = setup();
  const calls = scriptedFetch((url) => (url === "/api/marketplace" ? response(200, {auction_id: "a1"}) : response(200, {sellingCount: 1, maxConcurrentAuctions: 5})));
  assert.equal(await view.sellGroups([group("c1"), group("c2")], {baseAmount: 25, durationMinutes: 180}), 2);
  const posts = calls.filter((c) => c.method === "POST");
  assert.deepEqual(
    posts.map((c) => JSON.parse(c.body)),
    [
      {card_id: "uc-1", base_amount: 25, duration_minutes: 180},
      {card_id: "uc-2", base_amount: 25, duration_minutes: 180},
    ],
  );
  assert.deepEqual(ids(), ["uc-fav×1", "uc-shiny×1", "uc-1×1", "uc-3×1", "uc-locked×1"], "l'exemplaire en vente quitte la liste");
  // Fenêtre de mise en vente d'une seule carte : vente faite → retirée ; annulée → rien ne change
  view.afterSell("uc-3", null);
  assert.ok(ids().includes("uc-3×1"));
  view.afterSell("uc-3", {baseAmount: 10, durationMinutes: 60});
  assert.ok(!ids().includes("uc-3×1"));
});

test("collection filtrée : mise aux enchères refusée → arrêt, rien n'est retiré de la liste", async () => {
  const {view, group, ids} = setup();
  const calls = scriptedFetch(response(400, {error: "Nombre maximum d'enchères simultanées atteint"}));
  await assert.rejects(view.sellGroups([group("c2"), group("c3")], {baseAmount: 10, durationMinutes: 60}), (e) => e.done === 0 && /maximum/.test(e.message));
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
  assert.ok(ids().includes("uc-2×1"));
});

test("filtre : critères cumulés, jamais vendues dans aucune rareté ou dans la sienne, intervalle de prix", () => {
  fakeBrowser();
  const m = loadExtensionModule({
    view: "extension/src/content/features/collection-view.js",
    bus: "extension/src/content/lib/bus.js",
    prices: "extension/src/content/state/prices.js",
    settings: "extension/src/content/state/settings.js",
  });
  const copy = (id, card_id, rarity, title, image_url, count = 1) => ({id, card_id, rarity, count, card: {id: card_id, wikipedia_title: title, image_url, hide_image: false}});
  const owned = [
    copy("u1", "a", "C", "Abeille", null),
    copy("u2", "a", "R", "Abeille", null),
    copy("u3", "b", "C", "Basion", "https://upload.wikimedia.org/b.gif"),
    copy("u4", "c", "PC", "Castor", "https://upload.wikimedia.org/c.jpg", 2),
    copy("u5", "d", "C", "Dune", "https://upload.wikimedia.org/d.jpg"),
    copy("u6", "e", "C", "Écureuil", "https://upload.wikimedia.org/e.jpg"),
  ];
  // Ventes lues : a vendue en C seulement, b jamais, c en PC, e une seule fois (trop peu pour un
  // prix fiable) ; d pas encore lue
  // Historique chargé par le site (onglet Marché d'une fiche) : {RARETÉ: [moyenne, ventes]} cette semaine
  const sales = (id, byRarity) => m.bus.emit("price-history", {data: history(byRarity), match: [null, id]});
  sales("a", {C: [3, 4]});
  sales("b", {});
  sales("c", {PC: [40, 5]});
  sales("e", {C: [2, 1]});
  let views = m.view.viewGroups(owned, m.prices.priceVersion.get().v);
  const list = (filter) => m.view.filterGroups(views, filter).map((g) => `${g.card.wikipedia_title} ${g.rarity}`);

  assert.deepEqual(list({}), ["Abeille R", "Castor PC", "Abeille C", "Basion C", "Dune C", "Écureuil C"], "toutes, les plus rares d'abord");
  assert.deepEqual(list({kinds: ["doubles"]}), ["Abeille R", "Castor PC", "Abeille C"]);
  assert.deepEqual(list({kinds: ["doubles", "none"]}), ["Abeille R", "Abeille C"], "critères cumulés");
  assert.deepEqual(list({kinds: ["none", "gif"]}), []);
  assert.deepEqual(list({sale: "never"}), ["Basion C"], "aucune vente, dans aucune rareté ; prix non lu : écartée ; une seule vente : vendue");
  assert.deepEqual(list({sale: "never", anyRarity: false}), ["Abeille R", "Basion C"], "jamais vendue dans la rareté de l'exemplaire");
  assert.deepEqual(list({kinds: ["none"], sale: "never", anyRarity: false}), ["Abeille R"]);
  assert.deepEqual(list({sale: "range", max: 50}), ["Castor PC", "Abeille C"], "prix du marché fiable dans la rareté de l'exemplaire, sans minimum");
  assert.deepEqual(list({sale: "range", min: 5, max: 50}), ["Castor PC"]);
  assert.deepEqual(list({sale: "range", min: 3, max: 3}), ["Abeille C"], "bornes incluses");
  assert.deepEqual(list({sale: "range", min: 50, max: 5}), ["Castor PC"], "bornes saisies à l'envers : échangées");
  assert.deepEqual(list({sale: "range", min: 41}), [], "sans maximum");
  assert.deepEqual(list({sale: "range"}), ["Castor PC", "Abeille C"], "sans borne : toutes les cartes au prix fiable");
  assert.deepEqual(list({kinds: ["gif"], sale: "range", max: 50}), []);
  assert.deepEqual(views.unknown.map((g) => g.card.wikipedia_title), ["Dune"]);

  // Réglage abaissé à une vente : le prix d'Écureuil compte, et les vues sont recalculées
  const before = m.prices.priceVersion.get().v;
  m.settings.settings.set({minSales: 1});
  assert.ok(m.prices.priceVersion.get().v > before, "réglage modifié : prix recalculés");
  views = m.view.viewGroups(owned, m.prices.priceVersion.get().v);
  assert.deepEqual(list({sale: "range", max: 2}), ["Écureuil C"]);
  assert.equal(m.prices.priceStatus("e", "C"), "ok");
  m.settings.settings.set({minSales: 3});
  assert.equal(m.prices.priceStatus("e", "C"), "few");
  assert.deepEqual(m.prices.pricing("e", "C").price, 2, "prix indicatif affiché");
  assert.match(m.prices.pricing("e", "C").uncertain, /1 vente sur les 12 dernières semaines, il en faut 3/);
  assert.deepEqual(m.prices.pricing("c", "PC"), {price: 40});
});

test("prix : historique du site lu par carte, une seule tentative, réponse inattendue signalée", async () => {
  fakeBrowser();
  const m = loadExtensionModule({bus: "extension/src/content/lib/bus.js", prices: "extension/src/content/state/prices.js"});
  await m.prices.ready;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return String(url).includes("/k/") ? response(200, history({C: [11, 4]})) : response(503, {});
  };
  await m.prices.loadPrices([{id: "k", rarity: "C"}, {id: "z", rarity: "L"}]);
  assert.deepEqual(urls, ["/api/marketplace/cards/z/price-history", "/api/marketplace/cards/k/price-history"], "route du site, la plus rare d'abord, une requête par carte sans réessai");
  assert.deepEqual([m.prices.priceOf("k", "C"), m.prices.priceStatus("k", "C"), m.prices.priceStatus("k", "R")], [11, "ok", "none"]);
  assert.equal(m.prices.priceStatus("z", "L"), "error", "nouvel essai plus tard");
  assert.equal(m.prices.hasFreshPrice("k"), true, "prix récent : pas relu");
  await m.prices.loadPrices(["k"]);
  assert.equal(urls.length, 2, "prix frais : pas de nouvelle lecture");
  // Format changé : plus aucune lecture jusqu'au rechargement, message clair
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return response(200, {summary: {}});
  };
  await m.prices.loadPrices(["x1", "x2"], {force: true});
  assert.equal(m.prices.priceSource.get().broken, true);
  assert.match(m.prices.priceSource.get().message, /mise à jour de la Toolbox/);
  const n = urls.length;
  m.prices.requestPrice("x3");
  assert.equal(urls.length, n, "source cassée : plus de requête");
});

test("prix : relu après 10 min dans une fiche ouverte, après 3 h sur une carte affichée", async () => {
  fakeBrowser();
  const m = loadExtensionModule({bus: "extension/src/content/lib/bus.js", prices: "extension/src/content/state/prices.js"});
  await m.prices.ready;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return response(200, history({C: [11, 4]}));
  };
  await m.prices.loadPrices(["k"]);
  assert.equal(urls.length, 1);
  // 11 min plus tard (dernière étape du test : l'horloge avancée fausse ensuite les délais d'attente)
  const realNow = Date.now;
  Date.now = () => realNow() + 11 * 60e3;
  try {
    m.prices.requestPrice("k");
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(urls.length, 1, "carte affichée : prix gardé 3 h");
    m.prices.requestPrice("k", {detail: true});
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(urls.length, 2, "fiche ouverte : prix de plus de 10 min relu, comme l'onglet Marché");
  } finally {
    Date.now = realNow;
  }
});

test("liste de la page Collection : un filtre l'ouvre depuis la grille du site, à partir du filtre par défaut", () => {
  fakeBrowser();
  const {collectionView, setCollectionView} = loadExtensionModule("extension/src/content/features/collection-view.js");
  setCollectionView({kinds: ["gif"], sale: "range", min: 5, max: 25});
  assert.deepEqual(collectionView.get(), {open: true, kinds: ["gif"], sale: "range", min: 5, max: 25, anyRarity: true});
  setCollectionView({kinds: []});
  assert.deepEqual(collectionView.get().kinds, []);
  assert.equal(collectionView.get().sale, "range", "liste ouverte : seul le critère changé");
  setCollectionView(null);
  assert.equal(collectionView.get().open, false);
  setCollectionView({sale: "never"});
  assert.deepEqual(collectionView.get(), {open: true, kinds: [], sale: "never", min: 5, max: 25, anyRarity: true}, "rouverte : filtre par défaut, dernier intervalle gardé");
});

test("mots-clés : au moins un mot inclus (ou tous), aucun mot exclu, sans casse ni accents, « -mot » exclu", () => {
  fakeBrowser();
  const {matchKeywords, parseKeyword} = loadExtensionModule("extension/src/content/features/collection-view.js");
  const cards = [
    {card: {id: "1", wikipedia_title: "Neymar", category: "footballeur brésilien"}},
    {card: {id: "2", wikipedia_title: "Kylian Mbappé", category: "footballeur français"}},
    {card: {id: "3", wikipedia_title: "Tony Parker", category: "joueur de basket-ball français"}},
    {card: {id: "4", wikipedia_title: "Odense", category: null}},
  ];
  const titles = (words, options) => cards.filter(matchKeywords(words, options)).map((g) => g.card.wikipedia_title);
  const inc = (text) => ({text, out: false});
  const exc = (text) => ({text, out: true});

  assert.deepEqual(titles([]), ["Neymar", "Kylian Mbappé", "Tony Parker", "Odense"]);
  assert.deepEqual(titles([inc("FOOT")]), ["Neymar", "Kylian Mbappé"], "partie de mot, sans casse");
  assert.deepEqual(titles([inc("bresilien")]), ["Neymar"], "sans accents");
  assert.deepEqual(titles([inc("mbappe")]), ["Kylian Mbappé"], "dans le titre");
  assert.deepEqual(titles([inc("footballeur"), inc("basket")]), ["Neymar", "Kylian Mbappé", "Tony Parker"], "au moins un mot inclus");
  assert.deepEqual(titles([inc("footballeur"), inc("français")], {all: true}), ["Kylian Mbappé"], "tous les mots inclus");
  assert.deepEqual(titles([exc("français")]), ["Neymar", "Odense"], "mot exclu seul");
  assert.deepEqual(titles([inc("footballeur"), exc("francais")]), ["Neymar"]);

  assert.deepEqual(parseKeyword("  foot "), {text: "foot", out: false});
  assert.deepEqual(parseKeyword("-français"), {text: "français", out: true});
  assert.deepEqual(parseKeyword("− basket"), {text: "basket", out: true}, "signe moins typographique, espace");
  assert.equal(parseKeyword(" - "), null);
  assert.equal(parseKeyword(""), null);
});

test("collection : tri par valeur, cartes sans prix à la fin, ordre par rareté gardé à prix égal", () => {
  const {view} = setup();
  const groups = ["a", "b", "c", "d", "e"].map((id) => ({card_id: id}));
  const prices = {a: 10, b: null, c: 50, d: 10, e: 3};
  const order = (o) => view.sortGroups(groups, o, (g) => prices[g.card_id]).map((g) => g.card_id).join("");
  assert.equal(order("value-desc"), "cadeb");
  assert.equal(order("value-asc"), "eadcb");
  assert.equal(order("rarity"), "abcde");
  assert.deepEqual(view.ORDERS.map((o) => o.id), ["rarity", "value-desc", "value-asc"]);
});

test("collection : filtre des favoris, sur les exemplaires d'une carte dans une rareté", () => {
  const {view} = setup();
  const group = (id, ...starred) => ({card_id: id, rows: starred.map((s, i) => ({id: `${id}${i}`, rarity: "C", starred: s}))});
  const groups = [group("a", false), group("b", true), group("c", true, false), group("d", true, true)];
  const keep = (mode) => groups.filter(view.byStarred(mode)).map((g) => g.card_id).join("");
  assert.equal(keep("all"), "abcd");
  assert.equal(keep("free"), "ac", "au moins un exemplaire à vendre ou défausser");
  assert.equal(keep("starred"), "bcd", "au moins un exemplaire en favori");
  assert.deepEqual(view.STARRED.map((o) => o.id), ["all", "free", "starred"]);
});

test("collection : filtre par étiquette, sur les exemplaires d'une carte dans une rareté", () => {
  const {view} = setup();
  const links = new Map([
    ["a0", new Set(["t1"])],
    ["c0", new Set(["t2"])],
    ["d0", new Set(["t1", "t2"])],
    ["d1", new Set()],
  ]);
  const group = (id, n) => ({card_id: id, rows: Array.from({length: n}, (_, i) => ({id: `${id}${i}`, rarity: "C"}))});
  const groups = [group("a", 1), group("b", 1), group("c", 2), group("d", 2)];
  const keep = (tag) => groups.filter(view.byTag(tag, links)).map((g) => g.card_id).join("");
  assert.equal(keep(""), "abcd");
  assert.equal(keep("any"), "acd", "au moins un exemplaire étiqueté");
  assert.equal(keep("none"), "bcd", "au moins un exemplaire sans étiquette");
  assert.equal(keep("t1"), "ad");
  assert.equal(keep("t2"), "cd");
  assert.equal(keep("t3"), "");
  assert.deepEqual(view.TAGGED.map((o) => o.id), ["", "any", "none"]);
});

test("collection : étiquettes lues une par une, gardées en mémoire, oubliées avec la collection", async () => {
  fakeBrowser();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  globalThis.document.cookie = sessionCookie({userId: "me", token: fakeJwt({sub: "me", exp}), expiresAt: exp});
  const state = loadExtensionModule("extension/src/content/state/collection.js");
  const calls = scriptedFetch((url) => {
    url = String(url);
    if (url.includes("/tags?")) return response(200, [{id: 1, name: "Favoris", color: "#fff"}, {id: 2, name: "Sports", color: "#000"}]);
    if (url.includes("tag_id=eq.1") && url.includes("offset=0")) return response(200, [{user_card_id: "u1"}, {user_card_id: "u2"}]);
    if (url.includes("tag_id=eq.2") && url.includes("offset=0")) return response(200, [{user_card_id: "u2"}]);
    if (url.includes("/user_card_tags?")) return response(200, []);
    return response(404, {});
  });
  const {tags, links} = await state.loadCollectionTags();
  assert.deepEqual(tags.map((x) => [x.id, x.name]), [["1", "Favoris"], ["2", "Sports"]]);
  assert.deepEqual([...links.get("u1")], ["1"]);
  assert.deepEqual([...links.get("u2")].sort(), ["1", "2"]);
  const reads = calls.filter((c) => String(c.url).includes("/user_card_tags?"));
  assert.ok(reads.every((c) => /tag_id=eq\.\d+&order=user_card_id\.asc/.test(c.url)), "jamais user_card_tags sans filtre, ordre stable");
  const before = calls.length;
  await state.loadCollectionTags();
  assert.equal(calls.length, before, "en mémoire");
  state.invalidateCollection();
  await state.loadCollectionTags();
  assert.ok(calls.length > before, "relue après invalidation");
});
