// Indexation des prix de toute ma collection (réglage priceIndex, désactivé par défaut) : le prix de
// chaque carte distincte de la collection est tenu à jour en arrière-plan, par la voie lente de
// state/prices.js (une lecture à la fois, à intervalle fixe, après les cartes affichées, plafond
// journalier). Un seul onglet WikiMasters indexe à la fois (verrou « meneur »).
// Voir docs/cahier-des-charges-2026-11.md, § 4.1 bis.
//
// Ordre : les cartes jamais lues (de la plus rare à la plus commune, doublons d'abord), puis celles à
// relire selon la cadence de core/prices.js (indexDueAt), la plus en retard d'abord. Une carte lue
// par l'affichage ou vue dans l'onglet Marché du site compte : même cache.
import { createStore } from "../lib/store";
import { electLeader } from "../lib/locks";
import { on, emit } from "../lib/bus";
import { settings, isOn, normalizeIndexRarities } from "./settings";
import { loadMyCollection } from "./collection";
import { entryOf, isQueued, setIndexSource, slowStoppedBy, priceSource, priceVersion, ready as pricesReady } from "./prices";
import { indexDueAt, RARITY_RANK, rarityRank } from "../../../../core/prices";

// Liste des cartes de la collection relue toutes les 30 min (cartes défaussées, vendues, échangées)
const REFRESH = 30 * 60 * 1000;
// Une lecture en échec est retentée après 5 min (comme dans state/prices.js)
const ERROR_RETRY = 5 * 60 * 1000;

// leader : cet onglet indexe ; total : cartes distinctes de la collection ; error : lecture de la collection impossible
export const indexState = createStore({ leader: false, total: null, error: null });

let cards = null; // [{id, rarity: la plus haute possédée, copies}], de la plus rare à la plus commune
let listAt = 0;
let loading = null;

const byValue = (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || b.copies - a.copies;

function refreshList() {
  loading ||= loadMyCollection()
    .then((copies) => {
      const byCard = new Map();
      for (const c of copies) {
        const e = byCard.get(c.card_id) || byCard.set(c.card_id, { id: c.card_id, rarity: c.rarity, copies: 0 }).get(c.card_id);
        if (rarityRank(c.rarity) > rarityRank(e.rarity)) e.rarity = c.rarity;
        e.copies += c.count;
      }
      cards = [...byCard.values()].sort(byValue);
      listAt = Date.now();
      indexState.set({ total: cards.length, error: null });
      // Liste prête : la file reprend tout de suite (elle attendait faute de carte à proposer)
      apply();
    })
    .catch((e) => {
      // Nouvel essai dans 5 min
      listAt = Date.now() - REFRESH + ERROR_RETRY;
      indexState.set({ error: e.message || String(e) });
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

// Date à partir de laquelle relire une carte (0 : jamais lue, ou lecture partielle par /sales à
// compléter par price-history)
function dueAt(card, route = "history") {
  const entry = entryOf(card.id);
  if (entry?.err) return entry.t + ERROR_RETRY;
  if (entry?.partial && route === "history") return 0;
  return indexDueAt(entry, card.rarity);
}

const active = () => isOn("priceIndex") && indexState.get().leader && priceVersion.get().loaded && !slowStoppedBy() && !priceSource.get().broken;
export const indexedRarities = () => new Set(normalizeIndexRarities(settings.get().priceIndexRarities));

// Carte suivante à lire sur la route demandée ("history" ou "sales"), ou null (appelée par
// state/prices.js quand la voie lente est libre). Seules les raretés choisies dans
// settings.priceIndexRarities sont indexées. La route /sales traite en priorité les cartes R, PC et C
// (qui ont presque toujours moins de 5 ventes, donc un historique complet en un appel), pendant que
// price-history traite les L, UR, SR et complète les cartes où /sales a trouvé 5 ventes.
function nextCard(route = "history") {
  if (!active()) return null;
  if (!loading && (!cards || Date.now() - listAt > REFRESH)) refreshList();
  if (!cards) return null;
  const now = Date.now();
  const allowed = indexedRarities();
  const scoped = cards.filter((c) => allowed.has(c.rarity));
  const list =
    route === "sales"
      ? [...scoped.filter((c) => rarityRank(c.rarity) <= RARITY_RANK.R), ...scoped.filter((c) => rarityRank(c.rarity) > RARITY_RANK.R)]
      : scoped;
  let best = null;
  let bestDue = Infinity;
  for (const card of list) {
    if (isQueued(card.id)) continue;
    const due = dueAt(card, route);
    if (due === 0) return card.id;
    if (due <= now && due < bestDue) {
      best = card.id;
      bestDue = due;
    }
  }
  return best;
}

function apply() {
  setIndexSource(active() ? nextCard : null);
}

// Avancement, pour l'onglet Prix et la popup : cartes lues (au moins une fois, sans erreur ni
// lecture partielle en attente de complément) par rareté ; total, read, due et next portent sur les
// seules raretés sélectionnées pour l'indexation (byRarity détaille toutes les raretés possédées).
export function indexProgress() {
  const byRarity = {};
  const allowed = indexedRarities();
  let total = 0;
  let read = 0;
  let due = 0;
  let next = Infinity;
  const now = Date.now();
  for (const card of cards || []) {
    const r = (byRarity[card.rarity] ||= { total: 0, read: 0 });
    r.total++;
    const entry = entryOf(card.id);
    const done = Boolean(entry && !entry.err && !entry.partial);
    if (done) r.read++;
    if (!allowed.has(card.rarity)) continue;
    total++;
    if (done) read++;
    const at = dueAt(card, "history");
    if (at <= now) due++;
    else next = Math.min(next, at);
  }
  return { total: cards ? total : null, read, due, next: next === Infinity ? null : next, byRarity };
}

let lead = null;

export function takePriceIndexLead() {
  lead?.take();
}

export function startPriceIndex() {
  if (lead) return;
  lead = electLeader("price-index", (leader) => {
    indexState.set({ leader });
    apply();
  });
  pricesReady.then(apply);
  settings.subscribe(apply);
  priceSource.subscribe(apply);
  // Cartes tirées : indexées au plus tôt (elles n'ont encore aucune lecture)
  on("pack-opened", ({ data, method }) => {
    if (method !== "POST" || !cards) return;
    const known = new Set(cards.map((c) => c.id));
    for (const c of data?.cards || []) if (c?.id && !known.has(c.id)) cards.push({ id: c.id, rarity: c.rarity, copies: 1 });
    cards.sort(byValue);
    indexState.set({ total: cards.length });
  });
  // Vérification anti-robot demandée par le site : l'indexation est désactivée, le joueur la réactive
  // lui-même (une simple pause temporaire 403 reprend d'elle-même après 1 min)
  const stop = () => {
    if (!isOn("priceIndex")) return;
    settings.set({ features: { ...settings.get().features, priceIndex: false } });
    emit("price-index-stopped", {});
  };
  on("prices-stopped", stop);
}

// Liste chargée tout de suite (onglet Prix ouvert avant la première lecture)
export const loadIndexList = () => (cards ? Promise.resolve() : refreshList());
