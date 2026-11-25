// Échanges, prix, familles et codes de partage.
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core");
const {BUILTIN_PROFILES} = require("../core/builtin-profiles");

const card = (id, title, category, rarity = "C", extra = {}) => ({id, wikipedia_title: title, category, rarity, summary: "", ...extra});

test("recherche d'échanges : à demander, à proposer, tri", () => {
  const me = {name: "Moi", rules: [{theme: "Sports"}]};
  const ami = {name: "Ami", rules: [{theme: "Astronomie & Espace"}]};
  const mine = [
    {id: "m1", card_id: "a", cards: card("a", "Saturne", "planète du Système solaire")},
    {id: "m2", card_id: "b", cards: card("b", "Lyon", "commune française")},
    {id: "m3", card_id: "b", cards: card("b", "Lyon", "commune française")},
  ];
  const friendItems = [
    {id: "f1", card_id: "z", count: 1, card: card("z", "Zinédine Zidane", "footballeur français", "SR")},
    {id: "f2", card_id: "y", count: 2, card: card("y", "Teddy Riner", "judoka français", "C")},
    {id: "f3", card_id: "x", count: 1, card: card("x", "Le Penseur", "sculpture d'Auguste Rodin", "UR")},
    {id: "f4", card_id: "a", count: 1, card: card("a", "Saturne", "planète du Système solaire")},
  ];
  const r = core.findTrades({mine, friendItems, wanted: ["Pour : Moi"], friendTag: "Pour : Ami", profiles: [me, ami], wishlist: new Set(["x"])});
  assert.deepEqual(r.toAsk.map((c) => c.card_id), ["x", "y", "z"], "souhaits, puis doublons de l'ami, puis rareté");
  const locked = core.findTrades({mine, friendItems: friendItems.map((it) => (it.card_id === "x" ? {...it, starred: true} : it)), wanted: ["Pour : Moi"], friendTag: "Pour : Ami", profiles: [me, ami], wishlist: new Set(["x"])});
  assert.deepEqual(locked.toAsk.map((c) => c.card_id), ["y", "z", "x"], "un favori de l'ami (verrouillé) passe en fin de liste");
  assert.deepEqual(r.toOffer.map((c) => c.card_id), [], "Saturne est déjà chez l'ami");
  const r2 = core.findTrades({mine, friendItems: friendItems.slice(0, 3), wanted: ["Pour : Moi"], friendTag: null, profiles: [me]});
  assert.deepEqual(r2.toOffer.map((c) => c.card_id), ["b"], "sans profil d'ami : mes doublons qu'il n'a pas");
});

test("offre équilibrée", () => {
  const cands = [
    {card_id: "a", price: 100, spare: true},
    {card_id: "b", price: 60, spare: false},
    {card_id: "c", price: 30, spare: true},
    {card_id: "d", price: 0, spare: true},
  ];
  const {chosen, total} = core.balanceOffer(120, cands);
  assert.ok(total >= 108 && total <= 160, String(total));
  assert.ok(chosen.every((c) => c.price > 0));
  assert.equal(chosen[0].card_id, "a", "doublons d'abord");
});

test("bilan d'une proposition : totaux avec WB, différence, prix manquants et cartes non vues", () => {
  const b = core.offerBalance({cards: [{price: 800}, {price: 300}], wb: 150}, {cards: [{price: 1500}]});
  assert.equal(b.give.total, 1250);
  assert.equal(b.get.total, 1500);
  assert.equal(b.diff, 250);
  assert.equal(b.pct, 20);
  assert.equal(b.exact, true);

  const partial = core.offerBalance({cards: [{price: 200}, {price: null}, {loading: true}]}, {cards: [{price: 100}], count: 3, wb: 50});
  assert.deepEqual([partial.give.total, partial.give.missing, partial.give.loading], [200, 1, 1], "seuls les prix fiables entrent dans le total");
  assert.equal(partial.get.unseen, 2, "cartes choisies que l'extension n'a pas encore vues");
  assert.equal(partial.get.total, 150);
  assert.equal(partial.exact, false);
  assert.equal(core.offerBalance({cards: []}, {cards: [{price: 10}]}).pct, null, "rien donné : pas de pourcentage");
});

const HISTORY = require("./fixtures/price-history.json");
// Semaine : [lundi AAAA-MM-JJ, moyenne, ventes, min, max]
const week = ([start, avg, count, min = avg, max = avg]) => ({start, avg, min, max, count});
const history = (computedAt, byRarity) => ({computed_at: computedAt, by_rarity: Object.fromEntries(Object.entries(byRarity).map(([r, weeks]) => [r, {weekly: weeks.map(week), monthly: []}]))});

test("prix : identique à l'onglet Marché du site (réponses réelles du 21/11/2026)", () => {
  // Fiche du site ce jour-là : 2 838, +8,1 % cette semaine, plus bas 550, plus haut 4 800, 649 ventes
  const L = core.summarizeHistory(HISTORY.legendary).L;
  assert.deepEqual([L.price, L.carried, L.low, L.high, L.sales, L.lastSale], [2838, false, 550, 4800, 649, "2026-11-16"]);
  assert.equal(Math.round(L.change * 1000) / 10, 8.1);
  assert.equal(L.total, 661, "toutes les ventes connues (séries mensuelles)");
  // Semaine sans vente : dernier prix moyen connu
  const R = core.summarizeHistory(HISTORY.sparse).R;
  assert.deepEqual([R.price, R.carried, R.sales, R.lastSale, R.change], [4, true, 9, "2026-11-02", null]);
  const few = core.summarizeHistory(HISTORY.fewSales).R;
  assert.deepEqual([few.price, few.carried, few.sales, few.low4, few.high4], [10, true, 2, null, null], "aucune vente sur 4 semaines : pas de fourchette");
  assert.deepEqual(core.summarizeHistory({computed_at: "2026-11-21T04:00:00Z", by_rarity: {}}), {}, "jamais vendue");
});

test("prix : semaines de Paris, date de référence, prix reporté et arrondi", () => {
  // Dimanche 22/11 à 23:30 UTC = lundi 23/11 à Paris : semaine du 23/11
  assert.equal(core.weekStart(new Date("2026-11-22T23:30:00Z")).toISOString().slice(0, 10), "2026-11-23");
  assert.equal(core.weekStart(new Date("2026-11-22T22:30:00Z")).toISOString().slice(0, 10), "2026-11-16");
  const h = history("2026-11-21T04:00:00Z", {
    UR: [["2026-07-06", 900, 4], ["2026-11-09", 100.4, 2, 80, 120], ["2026-11-16", 0.4, 1]],
    SR: [["2026-06-01", 50, 3]],
  });
  const s = core.summarizeHistory(h, {now: Date.parse("2026-12-30T00:00:00Z")});
  // La date de référence est le calcul du site (21/11), pas « maintenant » : la semaine du 16/11 reste la dernière
  assert.equal(s.UR.carried, false);
  assert.equal(s.UR.price, 1, "arrondi, au moins 1");
  assert.equal(s.UR.sales, 3, "la vente de juillet est hors des 12 semaines");
  assert.deepEqual([s.UR.low, s.UR.high], [0.4, 120]);
  assert.equal(s.UR.change < 0, true);
  // Dernière vente avant la fenêtre : son prix est reporté, sans vente sur 12 semaines
  assert.deepEqual([s.SR.price, s.SR.carried, s.SR.sales, s.SR.lastSale], [50, true, 0, "2026-06-01"]);
  // computed_at absent ou dans le futur : maintenant
  const future = core.summarizeHistory({...h, computed_at: "2027-01-01T00:00:00Z"}, {now: Date.parse("2026-11-25T12:00:00Z")});
  assert.equal(future.UR.carried, true, "semaine du 23/11 sans vente");
  assert.equal(future.UR.price, 1);

  // Reconstitution depuis les 5 dernières ventes (route /sales de l'onglet Marché) : identique à
  // price-history sur une vraie réponse du site (4 ventes en C)
  const now = Date.parse("2026-11-23T07:50:00Z");
  const sales = [
    {id: "1", final_price: 3, settled_at: "2026-11-20T03:36:15.504596+00:00", rarity: "C"},
    {id: "2", final_price: 11, settled_at: "2026-11-18T10:12:57.970009+00:00", rarity: "C"},
    {id: "3", final_price: 2, settled_at: "2026-11-01T09:47:40.389493+00:00", rarity: "C"},
    {id: "4", final_price: 2, settled_at: "2026-08-20T21:20:51.086532+00:00", rarity: "C"},
  ];
  const fromSales = core.summarizeSales(sales, {now});
  assert.equal(fromSales.complete, true, "moins de 5 ventes : tout l'historique de la carte est connu");
  const fromHist = core.summarizeHistory(
    {
      computed_at: "2026-11-23T07:50:00.052295+00:00",
      by_rarity: {
        C: {
          weekly: [
            {start: "2026-08-17", avg: 2, min: 2, max: 2, count: 1},
            {start: "2026-10-26", avg: 2, min: 2, max: 2, count: 1},
            {start: "2026-11-16", avg: 7, min: 3, max: 11, count: 2},
          ],
          monthly: [
            {start: "2026-08-01", avg: 2, min: 2, max: 2, count: 1},
            {start: "2026-11-01", avg: 5, min: 2, max: 11, count: 3},
          ],
        },
      },
    },
    {now},
  );
  assert.deepEqual(fromSales.summary, fromHist);
  const recentFive = [...sales.slice(0, 3), {id: "4b", final_price: 5, settled_at: "2026-10-20T12:00:00Z", rarity: "C"}, {id: "5", final_price: 9, settled_at: "2026-10-15T12:00:00Z", rarity: "C"}];
  assert.equal(core.summarizeSales(recentFive, {now}).complete, false, "5 ventes dans les 12 dernières semaines : historique potentiellement tronqué");
  assert.equal(core.summarizeSales([...sales, {id: "5", final_price: 9, settled_at: "2026-08-01T12:00:00Z", rarity: "C"}], {now}).complete, true, "5e vente antérieure aux 12 semaines dans une seule rareté : la série de 12 semaines est complète");
});

test("prix : fiabilité, valeur d'une collection, cartes jamais vendues", () => {
  const summary = core.summarizeHistory(history("2026-11-21T04:00:00Z", {UR: [["2026-11-16", 300, 5]], SR: [["2026-11-16", 200, 2]], L: [["2026-11-09", 480, 4]]}));
  assert.equal(core.priceInfo(summary, "UR").reliable, true);
  assert.equal(core.marketPrice(summary, "UR"), 300);
  assert.equal(core.priceInfo(summary, "SR").reliable, false, "2 ventes sur 12 semaines");
  assert.equal(core.marketPrice(summary, "SR"), null);
  assert.equal(core.marketPrice(summary, "SR", {minSales: 2}), 200);
  assert.equal(core.priceInfo(summary, "C"), null, "jamais vendue dans cette rareté");
  assert.equal(core.marketPrice(summary, "L", {shiny: true}), 480, "le site ne distingue pas les ventes shiny");

  const prices = new Map([["a", summary]]);
  const copies = [{card_id: "a", rarity: "UR", count: 2}, {card_id: "a", rarity: "SR"}, {card_id: "a", rarity: "L", is_shiny: true}, {card_id: "b", rarity: "C"}];
  assert.deepEqual(core.collectionValue(copies, prices), {value: 600 + 480, priced: 3, total: 5});
  assert.deepEqual(core.collectionValue(copies, prices, {minSales: 1}), {value: 600 + 200 + 480, priced: 4, total: 5});
  const owned = [{card_id: "a", rarity: "UR"}, {card_id: "a", rarity: "C"}, {card_id: "z", rarity: "C"}, {card_id: "b", rarity: "C"}];
  const sold = new Map([["a", summary], ["z", {}]]);
  const inRarity = core.unsoldCopies(owned, sold);
  assert.deepEqual(inRarity.unsold.map((c) => `${c.card_id}|${c.rarity}`), ["a|C", "z|C"]);
  assert.deepEqual(inRarity.unknown.map((c) => c.card_id), ["b"]);
  assert.deepEqual(core.unsoldCopies(owned, sold, {anyRarity: true}).unsold.map((c) => c.card_id), ["z"]);
  assert.equal(core.soldIn(summary, "SR"), true);
});

test("prix : âge maximal selon le contexte, cadence de l'indexation", () => {
  const H = 3600e3;
  const t = Date.parse("2026-11-21T10:00:00Z");
  const c = "2026-11-21T04:05:00Z";
  assert.deepEqual(core.PRICE_MAX_AGE, {detail: 10 * 60e3, display: 3 * H}, "fiche ouverte : 10 min, comme l'onglet Marché ; carte affichée : 3 h");
  const sold = {c, t, s: {L: {total: 3}}};
  assert.equal(core.indexDueAt(sold, "L"), t + 24 * H, "rareté haute : chaque jour");
  assert.equal(core.indexDueAt(sold, "SR"), t + 72 * H);
  assert.equal(core.indexDueAt(sold, "R"), t + 7 * 24 * H);
  assert.equal(core.indexDueAt(sold, "C"), t + 30 * 24 * H);
  assert.equal(core.indexDueAt({c, t, s: {}}, "L"), t + 30 * 24 * H, "jamais vendue : tous les 30 jours");
  assert.equal(core.indexDueAt(null, "L"), 0, "jamais lue : tout de suite");
});

test("exemplaires : regroupement, exemplaire à vendre, doublons", () => {
  // Regroupement par carte et rareté ; exemplaire à vendre ou défausser : jamais un favori, shiny en dernier
  const groups = core.groupCopies([{id: "u1", card_id: "a", rarity: "C", count: 2}, {id: "u2", card_id: "a", rarity: "R"}, {id: "u3", card_id: "a", rarity: "C"}]);
  assert.deepEqual(groups.map((g) => [g.card_id, g.rarity, g.count, g.rows.map((r) => r.id)]), [["a", "C", 3, ["u1", "u3"]], ["a", "R", 1, ["u2"]]]);
  assert.equal(core.freeCopy([{id: "u1", starred: true}, {id: "u2", is_shiny: true}, {id: "u3"}]).id, "u3");
  assert.equal(core.freeCopy([{id: "u1", starred: true}]), null);
  const spares = core.spareCards([{id: "u1", card_id: "a", rarity: "SR"}, {id: "u2", card_id: "a", rarity: "UR", starred: true}, {id: "u3", card_id: "b"}]);
  assert.equal(spares.length, 1);
  assert.equal(spares[0].spare, 1);
  assert.equal(spares[0].rarity, "SR", "on vend d'abord l'exemplaire le moins rare");
  assert.equal(spares[0].sellCopyId, "u1", "le site attend l'id de l'exemplaire");
  // Jamais un favori, même moins rare ; une shiny en dernier ; plusieurs exemplaires sur une ligne (count)
  const [a] = core.spareCards([{id: "u1", card_id: "a", rarity: "C", starred: true}, {id: "u2", card_id: "a", rarity: "R", is_shiny: true}, {id: "u3", card_id: "a", rarity: "R"}]);
  assert.deepEqual([a.sellCopyId, a.rarity], ["u3", "R"]);
  const [b] = core.spareCards([{id: "u1", card_id: "a", rarity: "C", count: 3}]);
  assert.deepEqual([b.sellCopyId, b.spare], ["u1", 2]);
  // Tous en favori : rien à mettre en vente
  const [c] = core.spareCards([{id: "u1", card_id: "a", rarity: "C", starred: true}, {id: "u2", card_id: "a", rarity: "R", starred: true}]);
  assert.deepEqual([c.sellCopyId, c.rarity], [null, "C"]);
});

test("familles : règle, progression, partage", async () => {
  const rule = {query: "star wars", keywords: "jedi, sith", exclude: "jeu vidéo", rarities: ["UR", "SR"]};
  assert.ok(core.matchesFamilyRule(card("1", "Yoda", "personnage jedi de Star Wars", "UR"), rule));
  assert.ok(!core.matchesFamilyRule(card("2", "Yoda", "personnage jedi de Star Wars", "C"), rule));
  assert.ok(!core.matchesFamilyRule(card("3", "Jedi Knight", "jeu vidéo jedi", "SR"), rule));
  const family = {name: "Star Wars", kind: "smart", rule, cards: [core.compactCard(card("1", "Yoda", "personnage", "UR")), core.compactCard(card("4", "Dark Vador", "sith", "SR"))], cover: "1"};
  assert.deepEqual(core.familyProgress(family, new Set(["1"])), {owned: 1, total: 2, missing: 1, percent: 50});
  const code = await core.encodeShareCode("F", core.familyToShare(family));
  assert.match(code, /^WMT-F1\./);
  const back = core.familyFromShare((await core.decodeShareCode(code, "F")).payload);
  assert.deepEqual(back.cards, family.cards);
  assert.deepEqual(back.rule, {...rule, themes: []}, "règle normalisée à l'import");
  await assert.rejects(core.decodeShareCode(code, "P"), /pas un code de profil/);
  await assert.rejects(core.decodeShareCode("WMT-P1.abc!", "P"), /Code invalide/);
  await assert.rejects(core.decodeShareCode("WMT-P1.AAAA", "P"), /incomplet/);
});

test("familles : recherche au mot exact dans le titre", () => {
  const t = core.titleHasWords;
  for (const title of ["Mars", "Bruno Mars", "Mars (planète)", "10 mars 1837"]) assert.ok(t(title, "MARS"), title);
  for (const title of ["Marseille", "Champ-de-Mars", "(6736) Lièvredemars"]) assert.ok(!t(title, "mars"), title);
  assert.ok(t("Star Wars, épisode IV : Un nouvel espoir", "star  wars"));
  assert.ok(!t("Star Warsaw", "star wars"));
  assert.ok(t("L’Étranger", "l'étranger"));
  // Caractères spéciaux pris tels quels, pas comme une expression régulière
  assert.ok(t("C++", "c++"));
  assert.ok(!t("Mars", "m.rs"));
  assert.ok(!t("Mars", "  "));
});

test("codes de profil : aller-retour sans perte", async () => {
  for (const p of BUILTIN_PROFILES) {
    const {payload} = await core.decodeShareCode(await core.encodeShareCode("P", p), "P");
    assert.deepEqual(payload, p);
  }
});

test("nouveautés d'un paquet", () => {
  const cards = [{id: "a"}, {id: "b"}, {id: "a"}, {id: "c"}];
  // a : 2 exemplaires après le tirage (tous deux tirés) ; b : 3 (2 d'avant) ; c : inconnu (pas encore lu)
  const copies = new Map([["a", 2], ["b", 3]]);
  assert.deepEqual(core.packNovelty(cards, copies), [true, false, false, true]);
});

test("import d'une famille : champs vérifiés un à un", () => {
  const back = core.familyFromShare({
    name: "  Mix  ",
    kind: "smart",
    rule: {query: 42, keywords: "a", themes: ["Sports", 3], rarities: ["UR", "ZZ"]},
    cards: [
      ["1", "Yoda", "UR", "personnage", "javascript:alert(1)", 1],
      "pas une carte",
      [null, "sans id"],
      ["1", "Yoda bis"],
      ["2", "Vador", "XX", 5, "https://x/y.png"],
      ["3", "Leia", "R", "", "", 0],
      ["4", "Han", "R", "", "", "oui"],
    ],
    cover: "inconnue",
  });
  assert.equal(back.name, "Mix");
  assert.deepEqual(back.rule, {query: "", keywords: "a", exclude: "", themes: ["Sports"], rarities: ["UR"]});
  // 6e valeur : image masquée (1) ou visible (0) ; absente (ancien code) ou invalide → inconnue
  assert.deepEqual(back.cards, [
    {id: "1", title: "Yoda", rarity: "UR", category: "personnage", image_url: null, hide_image: true},
    {id: "2", title: "Vador", rarity: null, category: "", image_url: "https://x/y.png", hide_image: null},
    {id: "3", title: "Leia", rarity: "R", category: "", image_url: null, hide_image: false},
    {id: "4", title: "Han", rarity: "R", category: "", image_url: null, hide_image: null},
  ]);
  assert.equal(back.cover, null);
  assert.throws(() => core.familyFromShare({name: "", cards: []}), /illisible/);
  assert.throws(() => core.familyFromShare(null), /illisible/);
});

test("codes de partage : contenu illisible ou anormalement volumineux refusé", async () => {
  // JSON invalide une fois décompressé
  const notJson = `WMT-P1.${core.bytesToBase64Url(new Uint8Array(await new Response(new Blob([new TextEncoder().encode("{pas du json")]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()))}`;
  await assert.rejects(core.decodeShareCode(notJson, "P"), /incomplet ou abîmé/);
  // Quelques Ko qui se décompressent en plusieurs Mo
  const huge = await core.encodeShareCode("P", {name: "x", pad: "a".repeat(3 * 1024 * 1024)});
  assert.ok(huge.length < 20000);
  await assert.rejects(core.decodeShareCode(huge, "P"), /volumineux/);
});

test("recherche d'échanges : un exemplaire avec count > 1 compte comme doublon", () => {
  const mine = [{id: "m1", card_id: "b", count: 3, cards: card("b", "Lyon", "commune française")}];
  const r = core.findTrades({mine, friendItems: [], wanted: ["Sports"], friendTag: null});
  assert.deepEqual(r.toOffer.map((c) => [c.card_id, c.copies]), [["b", 3]]);
});

test("recherche d'échanges : toutes mes cartes à proposer, suggérées d'abord, favoris verrouillés", () => {
  const mine = [
    {id: "m1", card_id: "a", cards: card("a", "Paris", "capitale de la France", "R")},
    {id: "m2", card_id: "b", count: 2, cards: card("b", "Lyon", "commune française")},
    {id: "m3", card_id: "c", starred: true, cards: card("c", "Nantes", "commune française", "UR")},
    {id: "m4", card_id: "d", cards: card("d", "Brest", "commune française")},
  ];
  const friendItems = [{id: "f1", card_id: "d", count: 1, card: card("d", "Brest", "commune française")}];
  const base = {mine, friendItems, wanted: ["Sports"], friendTag: null};
  assert.deepEqual(core.findTrades(base).toOffer.map((c) => c.card_id), ["b"], "sans offerAll : seulement les suggestions");
  const all = core.findTrades({...base, offerAll: true}).toOffer;
  assert.deepEqual(all.map((c) => c.card_id), ["b", "a", "c"], "suggérées, puis non verrouillées, jamais une carte qu'il a");
  assert.deepEqual(all.map((c) => [c.suggested, c.locked]), [[true, false], [false, false], [false, true]]);
  const {chosen} = core.balanceOffer(1000, all.map((c, i) => ({...c, price: 100 * (i + 1)})));
  assert.ok(!chosen.some((c) => c.card_id === "c"), "une carte verrouillée n'entre jamais dans l'offre équilibrée");
});

test("couleurs des raretés : celles du site, identiques dans l'extension", () => {
  assert.deepEqual(Object.keys(core.RARITY_COLORS), core.RARITIES);
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "../extension/src/content/ui/panel.css"), "utf8");
  for (const [r, color] of Object.entries(core.RARITY_COLORS)) assert.match(css, new RegExp(`--r-${r}: ${color};`), `--r-${r} dans panel.css`);
});

test("familles : ordre par nom, complétion, modification, et déplacement", () => {
  const f = (id, name, cards, updatedAt) => ({id, name, updatedAt, cards: cards.map((c) => ({id: c}))});
  const list = [f("a", "Zoo", ["1", "2"], 3), f("b", "écoles", ["3"], 1), f("c", "Rois 10", ["4", "5", "6", "7"], 2), f("d", "Rois 9", [], 4), f("e", "Avions", ["8", "9"], 5)];
  const owned = new Set(["1", "3", "4", "5", "6", "8"]);
  assert.deepEqual(core.sortFamilies(list, "name").map((x) => x.id), ["e", "b", "d", "c", "a"], "accents ignorés, nombres dans l'ordre naturel");
  assert.deepEqual(core.sortFamilies(list, "progress", owned).map((x) => x.id), ["b", "c", "e", "a", "d"], "100 %, 75 %, puis 50 % (moins de manquantes, puis nom), famille vide en dernier");
  assert.deepEqual(core.sortFamilies(list, "recent").map((x) => x.id), ["e", "d", "a", "c", "b"]);
  assert.deepEqual(core.sortFamilies(list, "manual").map((x) => x.id), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(list.map((x) => x.id), ["a", "b", "c", "d", "e"], "la liste n'est pas modifiée");
  assert.deepEqual(core.moveItem(list, "d", 0).map((x) => x.id), ["d", "a", "b", "c", "e"]);
  assert.deepEqual(core.moveItem(list, "a", 99).map((x) => x.id), ["b", "c", "d", "e", "a"], "position bornée");
  assert.equal(core.moveItem(list, "c", 2), list, "rien ne change : même liste");
  assert.equal(core.moveItem(list, "zz", 0), list);
});

test("cartes d'une famille : ordre par nom, rareté, prix, et rangement gardé à l'actualisation", () => {
  const c = (id, title, rarity) => ({id, title, rarity});
  const cards = [c("1", "Yoda", "UR"), c("2", "Anakin", "C"), c("3", "Dark Vador", "L"), c("4", "Boba Fett", "UR"), c("5", "Ewok", "SR")];
  const prices = {1: 300, 2: 5, 3: null, 4: 300, 5: 40};
  assert.deepEqual(core.sortFamilyCards(cards, "name").map((x) => x.id), ["2", "4", "3", "5", "1"]);
  assert.deepEqual(core.sortFamilyCards(cards, "rarity").map((x) => x.id), ["3", "4", "1", "5", "2"], "L, puis UR par nom, SR, C");
  assert.deepEqual(core.sortFamilyCards(cards, "price", {priceOf: (x) => prices[x.id]}).map((x) => x.id), ["4", "1", "5", "2", "3"], "les plus chères, égalité départagée par le nom, sans prix à la fin");
  assert.deepEqual(core.sortFamilyCards(cards, "manual").map((x) => x.id), ["1", "2", "3", "4", "5"]);
  // Actualisation d'une famille intelligente : 3 a disparu, 6 est nouvelle
  const found = [c("6", "Jabba", "R"), c("1", "Yoda", "UR"), c("5", "Ewok", "SR"), c("2", "Anakin", "C"), c("4", "Boba Fett", "UR")];
  const arranged = [cards[4], cards[0], cards[3], cards[1], cards[2]]; // 5, 1, 4, 2, 3
  assert.deepEqual(core.keepCardOrder(arranged, found).map((x) => x.id), ["5", "1", "4", "2", "6"]);
});
