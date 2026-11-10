// Page Paquets : récapitulatif et taux de drop dans la marge, à gauche ou à droite du contenu centré
// du site (réglage packDock, choisi depuis l'en-tête de chaque bloc). Chaque côté est une colonne
// fixe qui ne défile pas avec la page. Sans assez de place à côté du contenu (petit écran, mobile),
// les blocs reviennent sous le contenu.
import {createStore} from "../lib/store";
import {settings} from "../state/settings";

const EDGE = 16; // écart avec le bord de la zone de la page
const TOP = 56; // sous le solde de WikiBidous, affiché par le site en haut à droite
const GAP = 24; // écart minimal avec le contenu du site
// Largeur d'un bloc dans la marge : en dessous du minimum, il reste sous le contenu
export const DOCK_MIN = {recap: 340, rates: 280};
const DOCK_MAX = {recap: 460, rates: 420};

// Place libre de chaque côté du contenu (px), pour les boutons d'emplacement des blocs
export const dockRoom = createStore({left: 0, right: 0});

const columns = {};
function column(side) {
  let el = columns[side];
  if (!el) {
    el = columns[side] = document.createElement("div");
    el.className = `wmt-dock wmt-dock-${side}`;
  }
  if (!el.isConnected) document.body.append(el);
  return el;
}

// Rectangle occupé par le contenu du site : enfants du bloc central, nos blocs exclus, mais
// le panneau posé à droite de la carte révélée compris
function contentBox(container) {
  let left = Infinity;
  let right = -Infinity;
  const take = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
  };
  for (const child of container.children) if (!/\bwmt-/.test(child.className)) take(child);
  for (const side of container.querySelectorAll(".wmt-reveal-side")) take(side);
  return Number.isFinite(left) ? {left, right} : null;
}

function measure(container) {
  const main = (container.closest("main") || document.documentElement).getBoundingClientRect();
  const area = {left: Math.max(0, main.left), right: Math.min(main.right, document.documentElement.clientWidth), top: Math.max(0, main.top)};
  const box = contentBox(container);
  if (!box) return {left: 0, right: 0, area};
  return {
    left: Math.max(0, Math.floor(box.left - area.left - EDGE - GAP)),
    right: Math.max(0, Math.floor(area.right - box.right - EDGE - GAP)),
    area,
  };
}

// container : bloc central de la page (écran d'ouverture ou de révélation) ;
// items : [{key: "recap" | "rates", host, below()}] dans l'ordre d'affichage. below() place le bloc
// sous le contenu ; il est appelé dans l'ordre, un bloc peut donc se placer sous le précédent.
export function placeBlocks(container, items) {
  const room = measure(container);
  const current = dockRoom.get();
  if (current.left !== room.left || current.right !== room.right) dockRoom.set({left: room.left, right: room.right});
  const prefs = settings.get().packDock || {};
  const docked = {left: [], right: []};
  for (const it of items) {
    const side = prefs[it.key];
    if ((side === "left" || side === "right") && room[side] >= DOCK_MIN[it.key]) docked[side].push(it);
    else it.below();
  }
  for (const side of ["left", "right"]) {
    if (!docked[side].length) {
      columns[side]?.remove();
      continue;
    }
    const el = column(side);
    const width = Math.min(room[side], Math.max(...docked[side].map((it) => DOCK_MAX[it.key])));
    const top = room.area.top + TOP;
    const x = side === "left" ? room.area.left + EDGE : document.documentElement.clientWidth - room.area.right + EDGE;
    const css = `${side}: ${x}px; top: ${top}px; width: ${width}px; max-height: calc(100vh - ${top + EDGE}px);`;
    if (el.style.cssText !== css) el.style.cssText = css;
    docked[side].forEach((it, i) => el.children[i] !== it.host && el.insertBefore(it.host, el.children[i] || null));
  }
}

export function clearBlocks() {
  columns.left?.remove();
  columns.right?.remove();
}

export const setDock = (key, side) => settings.set((st) => ({...st, packDock: {...st.packDock, [key]: side}}));
