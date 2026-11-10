// Déroulé de la scène de « Tout ouvrir » (ui/OpenAllStage.jsx) : délais de distribution, de charge
// et de retournement de chaque carte d'un paquet, et meilleures cartes montrées à la fin.
import {RARITY_RANK} from "../../../../core/prices";

// Déroulé d'un paquet (ms) : distribution des dos, puis retournement de chaque carte ; à partir de
// Super Rare, charge du dos avant le retournement (plus longue avec la rareté)
const DEAL_STAGGER = 70;
const DEAL_MS = 280;
const FLIP_GAP = 240;
const FLIP_MS = 460;
const CHARGE_MS = {3: 360, 4: 560, 5: 820};
// Effets après le retournement de la dernière carte, avant le paquet suivant
const SETTLE_MS = {0: 380, 1: 380, 2: 520, 3: 700, 4: 900, 5: 1200};
// En retard de plus d'un paquet : déroulé accéléré
export const FAST = 0.45;
export const BEST = 5;

export const cardRank = (c) => RARITY_RANK[c.rarity] ?? 0;

// Délais de chaque carte d'un paquet, et durée totale
export function packTimeline(cards, speed = 1) {
  let t = (cards.length - 1) * DEAL_STAGGER + DEAL_MS;
  const steps = cards.map((c, i) => {
    const r = cardRank(c);
    const charge = CHARGE_MS[r] || 0;
    const step = {deal: i * DEAL_STAGGER, chargeAt: t, charge, flipAt: t + charge};
    t += charge + FLIP_GAP;
    return step;
  });
  const top = Math.max(0, ...cards.map(cardRank));
  const total = (steps.length ? steps.at(-1).flipAt + FLIP_MS : 0) + SETTLE_MS[top];
  const scale = (ms) => Math.round(ms * speed);
  return {steps: steps.map((s) => ({deal: scale(s.deal), chargeAt: scale(s.chargeAt), charge: scale(s.charge), flipAt: scale(s.flipAt)})), total: scale(total)};
}

// Meilleures cartes de l'ouverture : rareté, puis shiny, puis nouvelle
export function bestCards(cards, n = BEST) {
  return cards
    .map((c, i) => ({c, i}))
    .sort((a, b) => cardRank(b.c) - cardRank(a.c) || Boolean(b.c.is_shiny) - Boolean(a.c.is_shiny) || (b.c.isNew === true) - (a.c.isNew === true) || a.i - b.i)
    .slice(0, n)
    .map(({c}) => c);
}
