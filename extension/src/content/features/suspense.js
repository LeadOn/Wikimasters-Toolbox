// Suspense de la révélation (option packSuspense) : chaque carte jamais vue du paquet reste face
// cachée le temps que sa rareté monte, de Commune à la sienne ; plus elle est rare, plus l'attente
// est longue. features/site-dom.js cache la carte du site (son retournement est retiré) et affiche à
// sa place un dos de carte (ui/islands/Suspense.jsx) qui se charge palier par palier : texture de
// la rareté atteinte, anneau qui se remplit, aura, rayons, lumière de la page qui baisse. Les effets
// dépendent du palier atteint, pas de la rareté finale : on ne sait pas où la montée s'arrêtera.
// Arrêtée, la carte se charge (fissures de lumière), puis se révèle : le dos se retourne et la carte
// du site enchaîne le retournement (wmt-enter-<rareté> de ui/site.css), ou, à partir d'Ultra Rare,
// le dos se dissout dans un flash d'où sort la carte. Le panneau d'à côté est caché jusqu'à la fin
// (il dévoilerait la carte). Un clic passe l'attente ; rien ne se joue si le système demande moins
// d'animations.
import {createStore} from "../lib/store";

export const RANKS = ["C", "PC", "R", "SR", "UR", "L"];

// Apparition du dos ; montée d'un palier (vers PC, R, SR, UR, L : de plus en plus lente) ; arrêt sur
// la rareté atteinte (assez court pour sentir que la montée s'arrête) ; charge avant la révélation
const INTRO_MS = 120;
const STEP_MS = [180, 200, 230, 270, 320];
const PAUSE_MS = [120, 150, 170, 190, 210, 200];
const CHARGE_MS = [0, 0, 90, 170, 270, 400];
const SHINY_MS = 160;

// Révélation, par rareté : `back` = sortie du dos (la carte du site attend ce délai), `ms` = entrée
// de la carte du site (animation wmt-enter-<rareté> de ui/site.css), `total` = fin des effets
export const ENTER = {
  C: {back: 90, ms: 170, total: 280},
  PC: {back: 100, ms: 190, total: 330},
  R: {back: 110, ms: 250, total: 470},
  SR: {back: 120, ms: 330, total: 650},
  UR: {back: 140, ms: 450, total: 900},
  L: {back: 170, ms: 620, total: 1250},
};

// Déroulé (ms) : `steps` paliers au-dessus de Commune, montés à `at[i]` ; arrêt, temps de plus pour
// une shiny, charge ; `total` = attente avant la révélation, `releaseMs` = durée de la révélation
export function suspenseTimeline(rarity, shiny = false) {
  const steps = Math.max(0, RANKS.indexOf(rarity));
  const at = [];
  let t = INTRO_MS;
  for (let i = 0; i < steps; i++) at.push((t += STEP_MS[i]));
  const pauseMs = PAUSE_MS[steps];
  const shinyMs = shiny ? SHINY_MS : 0;
  const chargeMs = CHARGE_MS[steps];
  const total = t + pauseMs + shinyMs + chargeMs;
  return {steps, at, pauseMs, shinyMs, chargeMs, total, releaseMs: ENTER[RANKS[steps]].total};
}

// at : paquet en cours ; played : index déjà joués (une carte revue n'est plus retenue) ;
// active : index de la carte en cours d'effet ; released : retournement rendu au site (révélation)
export const suspense = createStore({at: 0, played: new Set(), active: null, released: false});

export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// La carte `index` du paquet `at` est affichée : "hold" (retournement retenu), "release" (révélation,
// la carte entre) ou null (rien : déjà vue, ou moins d'animations demandées)
export function startSuspense(at, index) {
  let s = suspense.get();
  if (s.at !== at) {
    s = {at, played: new Set(), active: null, released: false};
    suspense.set(() => s);
  }
  if (s.active === index) return s.released ? "release" : "hold";
  if (s.played.has(index)) {
    if (s.active != null) suspense.set({active: null, released: false});
    return null;
  }
  s.played.add(index);
  if (reducedMotion()) return null;
  suspense.set({active: index, released: false});
  return "hold";
}

export function releaseSuspense() {
  const s = suspense.get();
  if (s.active != null && !s.released) suspense.set({released: true});
}
export const endSuspense = () => suspense.get().active != null && suspense.set({active: null, released: false});
