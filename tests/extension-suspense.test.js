// Suspense de la révélation : durée selon la rareté, une seule fois par carte et par paquet,
// rien quand le système demande moins d'animations.
const test = require("node:test");
const assert = require("node:assert/strict");
const {loadExtensionModule} = require("./helpers/extension");

const load = (reduced = false) => {
  globalThis.matchMedia = () => ({matches: reduced});
  return loadExtensionModule("extension/src/content/features/suspense.js");
};

test("plus la carte est rare, plus l'attente est longue", () => {
  const {suspenseTimeline, RANKS} = load();
  const totals = RANKS.map((r) => suspenseTimeline(r).total);
  for (let i = 1; i < totals.length; i++) assert.ok(totals[i] > totals[i - 1], `${RANKS[i]} > ${RANKS[i - 1]}`);
  assert.equal(suspenseTimeline("C").steps, 0);
  assert.equal(suspenseTimeline("L").steps, 5);
  assert.ok(suspenseTimeline("C").total <= 300, "une Commune ne fait presque pas attendre");
  assert.ok(suspenseTimeline("L", true).total > suspenseTimeline("L").total);
  assert.ok(suspenseTimeline("L", true).total <= 2200, "pas plus de 2,2 s");
  // Rareté inconnue : comme une commune
  assert.equal(suspenseTimeline("?").total, suspenseTimeline("C").total);
});

test("chaque palier monte plus lentement que le précédent, et tout se joue avant la révélation", () => {
  const {suspenseTimeline} = load();
  const {at, total} = suspenseTimeline("L", true);
  assert.equal(at.length, 5);
  const gaps = at.map((t, i) => t - (i ? at[i - 1] : 0)).slice(1);
  for (let i = 1; i < gaps.length; i++) assert.ok(gaps[i] > gaps[i - 1]);
  assert.ok(at.at(-1) < total);
  // Les mêmes paliers pour toutes les raretés : la durée d'un palier ne trahit pas la rareté finale
  assert.deepEqual(suspenseTimeline("SR").at, at.slice(0, 3));
});

test("révélation : la carte du site attend la sortie du dos, effets de plus en plus longs", () => {
  const {suspenseTimeline, ENTER, RANKS} = load();
  assert.deepEqual(Object.keys(ENTER).sort(), [...RANKS].sort());
  for (const r of RANKS) assert.ok(ENTER[r].back + ENTER[r].ms <= ENTER[r].total, r);
  for (let i = 1; i < RANKS.length; i++) {
    assert.ok(ENTER[RANKS[i]].ms > ENTER[RANKS[i - 1]].ms, `${RANKS[i]} > ${RANKS[i - 1]}`);
    assert.ok(suspenseTimeline(RANKS[i]).releaseMs > suspenseTimeline(RANKS[i - 1]).releaseMs);
  }
});

test("une carte n'est retenue qu'à sa première apparition dans le paquet, puis rendue au site", () => {
  const {startSuspense, releaseSuspense, endSuspense, suspense} = load();
  assert.equal(startSuspense(1, 0), "hold");
  assert.equal(startSuspense(1, 0), "hold", "toujours retenue pendant l'attente");
  releaseSuspense();
  assert.equal(startSuspense(1, 0), "release", "révélation : la carte du site entre");
  endSuspense();
  assert.equal(suspense.get().active, null);
  assert.equal(startSuspense(1, 0), null, "revue : plus retenue");
  assert.equal(startSuspense(1, 1), "hold");
  assert.equal(startSuspense(1, 0), null, "retour en arrière pendant l'attente : l'effet est retiré");
  assert.equal(suspense.get().active, null);
  assert.equal(startSuspense(2, 0), "hold", "paquet suivant : tout recommence");
});

test("aucun effet quand le système demande moins d'animations", () => {
  const {startSuspense, suspense} = load(true);
  assert.equal(startSuspense(1, 0), null);
  assert.equal(suspense.get().active, null);
});

test("son de la Légendaire : retenu tant qu'une Légendaire du paquet reste à révéler", () => {
  const {holdsLegendarySound, startSuspense, releaseSuspense, endSuspense} = load();
  const cards = [{rarity: "C"}, {rarity: "L"}, {rarity: "R"}];
  const all = () => true;
  assert.equal(holdsLegendarySound(1, cards, {current: null, animated: all}), true, "avant même d'arriver sur la Légendaire");
  assert.equal(holdsLegendarySound(1, cards, {current: null, animated: (i) => i === 2}), false, "Légendaire pas animée (roulette sur la dernière seulement)");
  assert.equal(holdsLegendarySound(1, [{rarity: "C"}], {current: "hold", animated: all}), true, "carte affichée cachée");
  startSuspense(1, 0);
  endSuspense();
  assert.equal(startSuspense(1, 1), "hold");
  assert.equal(holdsLegendarySound(1, cards, {current: "hold", animated: all}), true);
  releaseSuspense();
  assert.equal(holdsLegendarySound(1, cards, {current: "release", animated: all}), false, "révélée : le son est joué");
  assert.equal(holdsLegendarySound(2, cards, {current: null, animated: all}), true, "paquet suivant");
});

test("son de la Légendaire : jamais retenu quand le système demande moins d'animations", () => {
  const {holdsLegendarySound} = load(true);
  assert.equal(holdsLegendarySound(1, [{rarity: "L"}], {current: null, animated: () => true}), false);
});
