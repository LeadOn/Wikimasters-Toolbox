// Roulette de la dernière carte (option packRoulette) : à la place du suspense, la dernière carte
// d'un paquet est révélée comme une caisse qu'on ouvre. Une bande de dos de cartes (texture de
// rareté du site) défile sous un repère, ralentit et s'arrête sur le dos de la rareté de la carte ;
// le dos grandit à la place de la carte, puis se révèle comme au suspense (ENTER de suspense.js).
// Les dos de la bande sont tirés selon les taux de drop du joueur (dropCounts de packs.js).
// features/site-dom.js retient la carte du site (startSuspense) ; ui/islands/Roulette.jsx anime.
import {ENTER, RANKS} from "./suspense";

// Nombre de dos de la bande, place de la carte tirée (assez loin pour un long défilement, assez de
// dos après elle pour remplir la bande à l'arrêt)
export const STRIP_LENGTH = 56;
export const WIN_INDEX = 48;

// Taux de drop tant que ni les tirages ni la collection ne sont connus (approximation)
const DEFAULT_COUNTS = {C: 550, PC: 240, R: 120, SR: 60, UR: 24, L: 6};

// Défilement (ralentissement continu jusqu'à l'arrêt, n'importe où sur le dos, souvent près d'un
// bord), arrêt sur place, recentrage, le dos grandit à la place de la carte, court arrêt avant la
// révélation
export const ROULETTE = {spinMs: 5400, stopMs: 420, settleMs: 320, growMs: 420, holdMs: 160};

// Arrêt au plus à cette fraction de la largeur du dos de part et d'autre de son centre (le repère
// reste sur le dos, sans toucher l'espace entre deux dos)
export const MAX_OFFSET = 0.46;

// Courbe du défilement : départ à pleine vitesse, longue décélération
export const spinEase = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 4);

// Déroulé (ms) : `total` = attente avant la révélation, `releaseMs` = durée de la révélation
export function rouletteTimeline(rarity) {
  const r = rarity in ENTER ? rarity : "C";
  const {spinMs, stopMs, settleMs, growMs, holdMs} = ROULETTE;
  return {spinMs, landMs: spinMs + stopMs + settleMs, growMs, total: spinMs + stopMs + settleMs + growMs + holdMs, releaseMs: ENTER[r].total};
}

// Bande : `items` (une rareté par dos), `win` (place de la carte tirée), `offset` (arrêt par rapport
// au centre du dos, en fraction de sa largeur : de part et d'autre, plus souvent loin du centre, à
// un cheveu du dos d'avant ou d'après). Les autres dos sont tirés selon `counts` ; une fois
// sur deux, le dos juste après la carte (celui qu'un peu plus d'élan aurait donné) est plus rare
// qu'elle, s'il en existe une plus rare.
export function buildStrip(rarity, counts, rand = Math.random) {
  const win = RANKS.includes(rarity) ? rarity : "C";
  const weights = RANKS.map((r) => Math.max(0, Number(counts?.[r]) || 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const w = total > 0 ? weights : RANKS.map((r) => DEFAULT_COUNTS[r]);
  const sum = w.reduce((a, b) => a + b, 0);
  const draw = () => {
    let x = rand() * sum;
    for (let i = 0; i < RANKS.length; i++) if ((x -= w[i]) < 0) return RANKS[i];
    return RANKS[0];
  };
  const items = Array.from({length: STRIP_LENGTH}, (_, i) => (i === WIN_INDEX ? win : draw()));
  const rank = RANKS.indexOf(win);
  if (rank < RANKS.length - 1 && rand() < 0.5) items[WIN_INDEX + 1] = RANKS[rank + 1 + Math.floor(rand() * Math.min(2, RANKS.length - 1 - rank))];
  const side = rand() < 0.5 ? -1 : 1;
  return {items, win: WIN_INDEX, offset: side * MAX_OFFSET * Math.sqrt(rand())};
}
