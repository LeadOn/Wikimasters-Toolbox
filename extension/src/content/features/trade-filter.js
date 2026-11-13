// Filtre par prix de la fenêtre « Échanger avec … » du site, sur la collection entière de l'onglet
// ouvert (cartes de l'ami ou les miennes), et non sur la seule page de 50 cartes que le site affiche.
// Mêmes choix que la ligne « Ventes » des filtres de la collection : tous les prix, jamais vendues
// (dans la rareté de l'exemplaire), ou vendues entre deux prix (prix du marché fiable, bornes
// incluses, bornes saisies à l'envers remises dans l'ordre), plus raretés, mots du nom ou de la
// description, thème, cartes que je n'ai pas, hors favoris (exemplaires verrouillés), doublons, et
// l'ordre de la liste.
// La collection de l'ami est lue par la même route et le même cache (12 h) que la recherche
// d'échanges (features/trades.js) ; la mienne, comme partout dans la Toolbox. La liste des cartes
// qui passent le filtre est montrée par ui/islands/TradeFilter.jsx ; une carte n'est ajoutée à
// l'offre que par un clic du joueur, avec la grille du site (features/site-dom.js → addToOffer).
import {createStore} from "../lib/store";
import {owned} from "../state/collection";
import {themeMemo} from "../state/themes";
import {matchKeywords, parseKeyword} from "./collection-view";
import {friendCollection} from "./trades";
import {loadMyCollection} from "../state/collection";
import {loadPrices, priceOf, priceStatus} from "../state/prices";
import {RARITY_RANK} from "../../../../core/prices";
import {L} from "../../shared/i18n";

// rarities : raretés montrées (vide : toutes) ; pour l'ami, aussi celles lues (lecture plus rapide) ;
// q : mots du nom ou de la description (tous exigés, « -mot » l'exclut) ; theme : thème calculé ;
// missing : cartes que je n'ai pas (onglet de l'ami) ; unstarred : hors favoris ; doubles : en
// plusieurs exemplaires ; order : "price-desc" | "price-asc" | "rarity"
export const NO_TRADE_FILTER = {sale: null, min: null, max: null, rarities: [], q: "", theme: "", missing: false, unstarred: false, doubles: false, order: "price-desc"};
// Remis à zéro à la fermeture de la fenêtre
export const tradeFilter = createStore(NO_TRADE_FILTER);
export const setTradeFilter = (patch) => tradeFilter.set(patch);
export const isFiltering = (f) => f.sale === "never" || f.sale === "range";
// Un critère est choisi : la liste de la Toolbox remplace la grille du site
export const isActive = (f) => isFiltering(f) || Boolean(f.q?.trim() || f.theme || f.missing || f.unstarred || f.doubles || f.rarities?.length);

// Cartes de l'onglet ouvert, collection entière. side : "mine" ou "friend:<pseudo>" ;
// read : raretés lues ([] : toutes) ; status : "idle" | "loading" | "ready" | "error" ;
// items : [{key, card_id, title, rarity, shiny, count, pending, card}] ; total : cartes de la collection
const IDLE = {side: null, read: [], status: "idle", step: "", progress: null, items: [], total: 0, pricesAt: 0, error: null};
export const tradeSide = createStore(IDLE);
let controller = null;

export function resetTradeFilter() {
  controller?.abort();
  controller = null;
  tradeFilter.set(NO_TRADE_FILTER);
  tradeSide.set(IDLE);
}

// Une carte passe-t-elle le filtre de prix ? status : priceStatus (state/prices.js) dans la rareté de
// l'exemplaire ; price : son prix fiable (priceOf) ou null. Renvoie null tant que le prix n'est pas lu.
export function matchesPrice({status, price}, f) {
  if (!isFiltering(f)) return true;
  if (status === "unknown") return null;
  if (f.sale === "never") return status === "none";
  const [lo, hi] = f.min != null && f.max != null && f.min > f.max ? [f.max, f.min] : [f.min, f.max];
  return price != null && (lo == null || price >= lo) && (hi == null || price <= hi);
}

// Raretés lues (read, vide : toutes) qui couvrent celles voulues (wanted, vide : toutes)
export const covers = (read, wanted) => !read.length || (wanted.length > 0 && wanted.every((r) => read.includes(r)));

const fromFriend = (it, pending) => ({
  key: it.id,
  card_id: it.card_id,
  title: it.card?.wikipedia_title || "",
  rarity: it.card?.rarity || null,
  shiny: Boolean(it.is_shiny),
  count: it.count || 1,
  pending: pending.has(it.card_id),
  starred: it.starred ?? null,
  owned: it.owned ?? null,
  card: {...it.card, id: it.card_id},
});
const fromMine = (c) => ({key: c.id, card_id: c.card_id, title: c.card?.wikipedia_title || "", rarity: c.rarity, shiny: c.is_shiny, count: c.count, pending: false, starred: Boolean(c.starred), owned: true, card: c.card});

// Je possède la carte : d'après le site (owned_by_viewer), sinon d'après ma collection en mémoire ;
// null si on ne sait pas
export function ownedByMe(it) {
  if (it.owned != null) return it.owned;
  const o = owned.get();
  return o.loadedAt > 0 ? o.ids.has(it.card_id) : null;
}
const themes = themeMemo();
export const themeOfItem = (it) => themes(it.card_id, {...it.card, wikipedia_title: it.title});
// Mots saisis → [{text, out}] (séparés par des espaces)
export const wordsOf = (q) => (q || "").split(/\s+/).map(parseKeyword).filter(Boolean);

// Lit la collection de l'onglet ouvert, puis les prix de ses cartes. Une lecture en cours pour un
// autre onglet (ou d'autres raretés) est abandonnée. refresh : ignore le cache de la collection.
export async function loadTradeSide({friend, theirs, rarities = [], refresh = false}) {
  const side = theirs ? `friend:${friend.toLowerCase()}` : "mine";
  const read = theirs ? [...rarities].sort() : [];
  controller?.abort();
  const ctrl = (controller = new AbortController());
  const {signal} = ctrl;
  const current = () => controller === ctrl;
  tradeSide.set({...IDLE, side, read, status: "loading", step: L("Lecture de la collection", "Reading the collection")});
  try {
    let items;
    let total;
    if (theirs) {
      const report = (step, progress) => current() && tradeSide.set({step, progress});
      const res = await friendCollection(friend, {rarities: read, refresh, signal, report});
      const pending = new Set(res.cache.pendingTradeCardIds || []);
      items = res.items.map((it) => fromFriend(it, pending));
      total = res.cache.total;
    } else {
      const copies = await loadMyCollection({force: refresh});
      items = copies.map(fromMine);
      total = items.length;
    }
    if (!current()) return;
    tradeSide.set({items, total, step: L("Lecture des prix", "Reading prices"), progress: {done: 0, total: 1}});
    await loadPrices(
      items.map((it) => ({id: it.card_id, rarity: it.rarity})),
      {signal, onProgress: (done, n) => current() && tradeSide.set({progress: {done, total: n}})},
    );
    if (current()) tradeSide.set({status: "ready", step: "", progress: null, pricesAt: Date.now()});
  } catch (e) {
    if (current()) tradeSide.set(e.name === "AbortError" ? IDLE : {status: "error", error: e.message || String(e), step: "", progress: null});
  }
}
export const stopTradeSide = () => {
  controller?.abort();
  controller = null;
  tradeSide.set(IDLE);
};

// Prix d'une carte de la liste dans la rareté (et la version) de l'exemplaire
export const itemPrice = (it) => ({status: priceStatus(it.card_id, it.rarity, {shiny: it.shiny}), price: priceOf(it.card_id, it.rarity, {shiny: it.shiny})});

// Critères autres que le prix (raretés, mots, thème, possession, favoris, doublons) → it => booléen.
// skip : critère ignoré (pour compter les cartes de chaque choix d'un critère)
export function itemMatcher(f, {mine = ownedByMe, themeOf = themeOfItem, skip = null} = {}) {
  const rarities = new Set(skip === "rarities" ? [] : f.rarities || []);
  const words = matchKeywords(wordsOf(f.q), {all: true});
  return (it) =>
    (!rarities.size || rarities.has(it.rarity)) &&
    words({card: {id: it.key, wikipedia_title: it.title, category: it.card?.category}}) &&
    (skip === "theme" || !f.theme || themeOf(it) === f.theme) &&
    (!f.missing || mine(it) === false) &&
    (!f.unstarred || !it.starred) &&
    (!f.doubles || it.count > 1);
}

// Cartes qui passent le filtre, dans l'ordre choisi : prix décroissant (par défaut) ou croissant,
// les cartes sans prix à la fin, ou rareté. priced(it) → {status, price} ; avec un filtre de prix,
// seules les cartes dont le prix est lu sont gardées.
export function filterTradeItems(items, f, priced = itemPrice, options) {
  const match = itemMatcher(f, options);
  const kept = [];
  for (const it of items) {
    if (!match(it)) continue;
    const p = priced(it);
    if (matchesPrice(p, f) === true) kept.push({it, p: p.price});
  }
  const rank = (it) => RARITY_RANK[it.rarity] ?? 0;
  const sign = f.order === "price-asc" ? 1 : -1;
  const byPrice = (a, b) => (a.p == null) - (b.p == null) || (a.p != null && b.p != null ? sign * (a.p - b.p) : 0);
  const byRarity = (a, b) => rank(b.it) - rank(a.it);
  kept.sort((a, b) => (f.order === "rarity" ? byRarity(a, b) || byPrice(a, b) : byPrice(a, b) || byRarity(a, b)) || a.it.title.localeCompare(b.it.title));
  return kept.map((k) => k.it);
}
