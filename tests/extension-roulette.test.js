// Roulette de la dernière carte : bande tirée selon les taux de drop, arrêt sur la rareté de la
// carte, déroulé.
const test = require("node:test");
const assert = require("node:assert/strict");
const {loadExtensionModule} = require("./helpers/extension");

const load = () => loadExtensionModule("extension/src/content/features/roulette.js");

// Pseudo-hasard reproductible
function seeded(seed = 1) {
  let x = seed;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

test("la bande s'arrête sur la rareté de la carte", () => {
  const {buildStrip, STRIP_LENGTH, WIN_INDEX} = load();
  for (const r of ["C", "PC", "R", "SR", "UR", "L"]) {
    const strip = buildStrip(r, {C: 10, PC: 5}, seeded(r.length));
    assert.equal(strip.items.length, STRIP_LENGTH);
    assert.equal(strip.win, WIN_INDEX);
    assert.equal(strip.items[WIN_INDEX], r);
    assert.ok(Math.abs(strip.offset) <= 0.46, "arrêt sur le dos, pas sur le suivant");
  }
  assert.equal(buildStrip("?", {}, seeded()).items[WIN_INDEX], "C", "rareté inconnue : Commune");
});

test("arrêt n'importe où sur le dos, des deux côtés, souvent loin du centre", () => {
  const {buildStrip, MAX_OFFSET} = load();
  const rand = seeded(11);
  const offsets = Array.from({length: 400}, () => buildStrip("R", {C: 1}, rand).offset);
  assert.ok(offsets.every((o) => Math.abs(o) <= MAX_OFFSET));
  const before = offsets.filter((o) => o < 0).length;
  assert.ok(before > 140 && before < 260, `des deux côtés (${before} / 400 avant le centre)`);
  const far = offsets.filter((o) => Math.abs(o) > MAX_OFFSET / 2).length;
  assert.ok(far > 260, `plus souvent loin du centre (${far} / 400)`);
  assert.ok(offsets.some((o) => Math.abs(o) > 0.42), "parfois à un cheveu du bord");
});

test("les autres dos suivent les taux de drop", () => {
  const {buildStrip, WIN_INDEX} = load();
  const rand = seeded(7);
  const seen = {};
  for (let k = 0; k < 400; k++) {
    buildStrip("C", {C: 900, PC: 0, R: 100, SR: 0, UR: 0, L: 0}, rand).items.forEach((r, i) => {
      if (i !== WIN_INDEX && i !== WIN_INDEX + 1) seen[r] = (seen[r] || 0) + 1;
    });
  }
  assert.deepEqual(Object.keys(seen).sort(), ["C", "R"], "jamais une rareté à 0 %");
  const share = seen.R / (seen.C + seen.R);
  assert.ok(share > 0.08 && share < 0.12, `≈ 10 % de Rares (${share})`);
});

test("quasi-raté : le dos d'après est parfois plus rare, jamais pour une Légendaire", () => {
  const {buildStrip, WIN_INDEX} = load();
  const rand = seeded(3);
  const ranks = ["C", "PC", "R", "SR", "UR", "L"];
  let rarer = 0;
  for (let k = 0; k < 200; k++) {
    const next = buildStrip("R", {C: 1}, rand).items[WIN_INDEX + 1];
    if (next !== "C") {
      rarer++;
      assert.ok(["SR", "UR"].includes(next));
    }
  }
  assert.ok(rarer > 60 && rarer < 140, `une fois sur deux environ (${rarer} / 200)`);
  for (let k = 0; k < 50; k++) assert.ok(ranks.includes(buildStrip("L", {C: 1}, rand).items[WIN_INDEX + 1]));
});

test("sans taux de drop connus, la bande est quand même remplie", () => {
  const {buildStrip} = load();
  const strip = buildStrip("SR", {}, seeded(5));
  assert.ok(strip.items.every((r) => ["C", "PC", "R", "SR", "UR", "L"].includes(r)));
  assert.ok(new Set(strip.items).size > 1);
});

test("déroulé : défilement, arrêt, puis révélation selon la rareté", () => {
  const {rouletteTimeline, spinEase, ROULETTE} = load();
  const c = rouletteTimeline("C");
  const l = rouletteTimeline("L");
  assert.equal(c.total, l.total, "même attente quelle que soit la rareté");
  assert.equal(c.total, ROULETTE.spinMs + ROULETTE.stopMs + ROULETTE.settleMs + ROULETTE.growMs + ROULETTE.holdMs);
  assert.ok(c.total <= 7000, "pas plus de 7 s");
  assert.ok(l.releaseMs > c.releaseMs);
  assert.equal(rouletteTimeline("?").releaseMs, c.releaseMs);
  assert.equal(spinEase(0), 0);
  assert.equal(spinEase(1), 1);
  assert.equal(spinEase(2), 1);
  assert.ok(spinEase(0.5) > 0.9, "l'essentiel du chemin au début, longue décélération ensuite");
});
