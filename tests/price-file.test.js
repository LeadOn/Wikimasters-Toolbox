// Export / import des prix en JSON (core/price-file.js) : aller-retour, fichier vérifié champ par
// champ, entrées illisibles ou trop anciennes écartées, fusion avec les prix gardés ici.
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core");

const NOW = Date.parse("2026-11-28T12:00:00Z");
const HOUR = 3600e3;
const DAY = 24 * HOUR;
const ID = "0b9d6c1e-5a1f-4a53-9d0e-3f6a2f1c7b11";

// Résumé réel : celui du moteur sur une réponse du site
const history = (avg = 120) => ({
  computed_at: new Date(NOW - HOUR).toISOString(),
  by_rarity: {SR: {weekly: [{start: core.weekStart(new Date(NOW)).toISOString().slice(0, 10), avg, min: avg - 20, max: avg + 30, count: 4}], monthly: []}},
});
const entry = (t = NOW - HOUR, avg) => ({s: core.summarizeHistory(history(avg), {now: NOW}), c: history().computed_at, t});
const file = (prices, extra = {}) => JSON.stringify({format: core.PRICES_FORMAT, version: 1, exported_at: new Date(NOW).toISOString(), prices, ...extra});
const read = (text) => core.importPrices(text, {now: NOW});

test("export puis import : mêmes prix, jamais vendues comprises", () => {
  const cache = new Map([
    [ID, entry()],
    ["never-sold", {s: {}, c: null, t: NOW - 2 * DAY}],
  ]);
  const out = core.exportPrices(cache, {now: NOW});
  assert.equal(out.format, "wikimasters-toolbox/prices");
  assert.equal(out.version, 1);
  assert.equal(out.exported_at, new Date(NOW).toISOString());
  const back = read(JSON.stringify(out));
  assert.equal(back.error, null);
  assert.deepEqual([back.total, back.rejected, back.expired, back.exportedAt], [2, 0, 0, NOW]);
  assert.deepEqual(Object.fromEntries(back.entries), Object.fromEntries(cache));
  // Le prix relu est celui de l'appareil d'origine
  assert.equal(core.marketPrice(back.entries.get(ID).s, "SR"), 120);
});

test("export : lectures en échec et résumés provisoires laissés de côté", () => {
  const cache = new Map([
    ["ok", entry()],
    ["failed", {...entry(), err: true}],
    ["failed-empty", {s: null, c: null, t: NOW, err: true}],
    ["partial", {...entry(), partial: true}],
    ["__proto__", entry()],
  ]);
  assert.deepEqual(Object.keys(core.exportPrices(cache, {now: NOW}).prices), ["ok"]);
});

test("import : fichier refusé s'il n'est pas un export de prix lisible", () => {
  const error = (text) => read(text).error;
  assert.match(error(""), /vide/);
  assert.match(error("  \n"), /vide/);
  assert.match(error(null), /vide/);
  assert.match(error("{"), /JSON illisible/);
  assert.match(error("[]"), /pas un export de prix/);
  assert.match(error(JSON.stringify({prices: {}})), /pas un export de prix/);
  assert.match(error(JSON.stringify({format: "wikimasters-toolbox/profiles", version: 1, profiles: []})), /pas un export de prix/);
  assert.match(error(JSON.stringify({format: core.PRICES_FORMAT, prices: {}})), /pas un export de prix/);
  assert.match(error(file({}, {version: 2})), /version plus récente/);
  assert.match(error(file([])), /Aucune liste/);
  assert.match(error(" ".repeat(core.MAX_PRICES_IMPORT + 1)), /trop volumineux/);
  assert.equal(read(file({})).error, null);
  assert.equal(read(file({})).entries.size, 0);
});

test("import : une entrée illisible est écartée, les autres sont gardées", () => {
  const good = entry();
  const sr = good.s.SR;
  const withRarity = (patch) => ({...good, s: {SR: {...sr, ...patch}}});
  const bad = {
    "pas-un-objet": 12,
    "sans-resume": {t: NOW},
    "sans-date": {s: {}},
    "date-texte": {s: {}, t: "hier"},
    "date-negative": {s: {}, t: -5},
    "en-echec": {...good, err: true},
    provisoire: {...good, partial: true},
    "rarete-inconnue": {...good, s: {XX: sr}},
    "prix-texte": withRarity({price: "120"}),
    "prix-nul": withRarity({price: 0}),
    "prix-infini": withRarity({price: 1e12}),
    "ventes-negatives": withRarity({sales: -1}),
    "ventes-decimales": withRarity({total: 1.5}),
    "bas-texte": withRarity({low: "5"}),
    "variation-texte": withRarity({change: "+10 %"}),
    "semaine-illisible": withRarity({lastSale: "lundi"}),
    "id avec espace": good,
    ["x".repeat(65)]: good,
  };
  const result = read(file({...bad, ok: good}));
  assert.equal(result.error, null);
  assert.deepEqual([...result.entries.keys()], ["ok"]);
  assert.equal(result.rejected, Object.keys(bad).length);
  assert.equal(result.total, Object.keys(bad).length + 1);
  // Clé « __proto__ » : écartée, sans toucher au prototype des objets
  const proto = read(`{"format":"${core.PRICES_FORMAT}","version":1,"prices":{"__proto__":${JSON.stringify(good)},"ok":${JSON.stringify(good)}}}`);
  assert.deepEqual([...proto.entries.keys()], ["ok"]);
  assert.equal(proto.rejected, 1);
  assert.equal({}.t, undefined);
});

test("import : seuls les champs connus sont repris, les champs absents valent null", () => {
  const good = entry();
  const {low, high, low4, high4, change, lastSale, ...minimal} = good.s.SR;
  const result = read(
    file({
      a: {...good, evil: "<script>", s: {SR: {...good.s.SR, extra: 1, carried: "oui"}}},
      b: {t: NOW - HOUR, c: "pas une date", s: {SR: minimal}},
    }),
  );
  assert.deepEqual(result.entries.get("a"), {...good, s: {SR: {...good.s.SR, carried: false}}});
  assert.deepEqual(result.entries.get("b"), {t: NOW - HOUR, c: null, s: {SR: {...minimal, low: null, high: null, low4: null, high4: null, change: null, lastSale: null}}});
});

test("import : prix de plus de 30 jours ignorés, date de lecture future ramenée à maintenant", () => {
  const result = read(file({old: entry(NOW - 31 * DAY), edge: entry(NOW - 29 * DAY), future: entry(NOW + 5 * DAY)}));
  assert.deepEqual([...result.entries.keys()], ["edge", "future"]);
  assert.equal(result.expired, 1);
  assert.equal(result.rejected, 0);
  assert.equal(result.entries.get("future").t, NOW);
});

test("fusion : carte sans prix ici, prix plus récent, prix d'ici gardé, lecture en échec remplacée", () => {
  const local = new Map([
    ["older-here", entry(NOW - 3 * DAY, 100)],
    ["newer-here", entry(NOW - HOUR, 100)],
    ["same", entry(NOW - DAY, 100)],
    ["failed-here", {s: null, c: null, t: NOW, err: true}],
    ["failed-with-price", {...entry(NOW, 100), err: true}],
  ]);
  const imported = new Map([
    ["new", entry(NOW - DAY, 200)],
    ["older-here", entry(NOW - DAY, 200)],
    ["newer-here", entry(NOW - DAY, 200)],
    ["same", entry(NOW - DAY, 200)],
    ["failed-here", entry(NOW - DAY, 200)],
    ["failed-with-price", entry(NOW - DAY, 200)],
  ]);
  const merge = core.mergePrices((id) => local.get(id), imported);
  assert.deepEqual([...merge.apply.keys()], ["new", "older-here", "failed-here", "failed-with-price"]);
  assert.deepEqual([merge.added, merge.updated, merge.kept], [2, 2, 2]);
  assert.equal(merge.apply.get("older-here"), imported.get("older-here"));
});
