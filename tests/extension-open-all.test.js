// Scène de « Tout ouvrir » : déroulé d'un paquet (distribution, charge des cartes rares,
// retournement) et meilleures cartes montrées à la fin.
const test = require("node:test");
const assert = require("node:assert/strict");
const {loadExtensionModule} = require("./helpers/extension");

const load = () => loadExtensionModule("extension/src/content/features/open-all.js");
const card = (rarity, extra = {}) => ({id: rarity, rarity, ...extra});

test("déroulé : distribution décalée, retournements dans l'ordre, charge avant une carte rare", () => {
  const {packTimeline} = load();
  const {steps, total} = packTimeline([card("C"), card("R"), card("SR"), card("L"), card("PC")]);
  assert.deepEqual(steps.map((s) => s.deal), [0, 70, 140, 210, 280]);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i].flipAt > steps[i - 1].flipAt, "une carte après l'autre");
  assert.ok(steps.every((s) => s.flipAt >= steps.at(-1).deal), "retournées une fois tout distribué");
  assert.deepEqual(steps.map((s) => s.charge), [0, 0, 360, 820, 0], "charge à partir de Super Rare, plus longue avec la rareté");
  assert.equal(steps[3].flipAt - steps[3].chargeAt, 820);
  assert.ok(total > steps.at(-1).flipAt, "les effets de la dernière carte ont le temps de se jouer");
});

test("déroulé : une Légendaire laisse plus de temps qu'un paquet ordinaire ; accéléré en cas de retard", () => {
  const {packTimeline, FAST} = load();
  const plain = packTimeline([card("C"), card("C"), card("PC")]);
  const legend = packTimeline([card("C"), card("C"), card("L")]);
  assert.ok(legend.total > plain.total + 800);
  const fast = packTimeline([card("C"), card("C"), card("L")], FAST);
  assert.ok(fast.total < legend.total * 0.5);
  assert.equal(packTimeline([card("SR")], 0).total, 0, "moins d'animations : rien n'attend");
});

test("meilleures cartes : rareté, puis shiny, puis nouvelle, puis ordre d'ouverture", () => {
  const {bestCards} = load();
  const cards = [card("C", {id: "a"}), card("SR", {id: "b"}), card("SR", {id: "c", isNew: true}), card("SR", {id: "d", is_shiny: true}), card("UR", {id: "e"}), card("R", {id: "f"}), card("SR", {id: "g"})];
  assert.deepEqual(bestCards(cards).map((c) => c.id), ["e", "d", "c", "b", "g"]);
  assert.deepEqual(bestCards(cards, 2).map((c) => c.id), ["e", "d"]);
  assert.deepEqual(bestCards([]), []);
});
