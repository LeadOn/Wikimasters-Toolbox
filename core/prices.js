// Prix de marché et valeurs dérivées.
//
// Source : l'historique des ventes que le site publie par carte (route price-history : moyenne, plus
// bas, plus haut et nombre de ventes par semaine et par mois, pour chaque rareté). Le prix retenu est
// celui que le site affiche dans l'onglet Marché de la fiche d'une carte, le « prix moyen de la
// semaine », calculé de la même façon. Il n'est fiable qu'à partir d'un nombre minimum de ventes sur
// les 12 dernières semaines (réglage `minSales`).
"use strict";

const {L} = require("./i18n");

const RARITIES = ["L", "UR", "SR", "R", "PC", "C"];
const RARITY_RANK = {L: 5, UR: 4, SR: 3, R: 2, PC: 1, C: 0};
// Nom de chaque rareté dans la langue courante (core/i18n.js)
const RARITY_NAMES = {L: ["Légendaire", "Legendary"], UR: ["Ultra Rare", "Ultra Rare"], SR: ["Super Rare", "Super Rare"], R: ["Rare", "Rare"], PC: ["Peu commune", "Uncommon"], C: ["Commune", "Common"]};
const RARITY_LABEL = Object.defineProperties({}, Object.fromEntries(Object.entries(RARITY_NAMES).map(([r, [fr, en]]) => [r, {get: () => L(fr, en), enumerable: true}])));
// Couleurs des raretés sur wiki-masters.com (badges, filtres et lueur des cartes), relevées le 13/10/2026.
// Reprises telles quelles dans extension/src/content/ui/panel.css (--r-L, …) et le rapport de trade_finder.js.
const RARITY_COLORS = {L: "#ffe144", UR: "#fa9931", SR: "#ed6fa3", R: "#c6a7f2", PC: "#b1cff2", C: "#b8f2d5"};
const rarityRank = (r) => RARITY_RANK[r] ?? -1;

// L'historique des ventes est recalculé par le site tout au long de la journée (`computed_at` avance
// de quelques minutes en quelques minutes, avec un décalage de plusieurs heures sur l'heure réelle)
const DAY = 864e5;
const WEEK = 7 * DAY;
// Réglage par défaut (modifiable dans l'extension) : ventes sur 12 semaines nécessaires pour un prix fiable
const PRICE_DEFAULTS = {minSales: 3};

const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

// Semaines du site : lundi de la semaine, jour calendaire de Paris (clé AAAA-MM-JJ de weekly[].start)
const PARIS_DAY = new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit"});
const dayKey = (d) => d.toISOString().slice(0, 10);
const utcDay = (key) => new Date(`${key}T00:00:00Z`);
function weekStart(date) {
  const d = utcDay(PARIS_DAY.format(date));
  return new Date(d.getTime() - DAY * ((d.getUTCDay() + 6) % 7));
}

// Date de référence du site : le calcul de l'historique s'il est valide et passé, sinon maintenant
function referenceDate(history, now = Date.now()) {
  const at = Date.parse(history?.computed_at);
  return new Date(Number.isFinite(at) && at > 0 && at < now ? at : now);
}

// Semaines de `from` (ou de la première semaine vendue) à la semaine de `ref`, comme le graphique du
// site : une semaine sans vente reprend la dernière moyenne connue (carried), même antérieure à `from`.
function weeklySeries(weekly, ref, from = null) {
  const sorted = (weekly || []).filter((w) => w?.start && num(w.avg) != null).sort((a, b) => a.start.localeCompare(b.start));
  if (!sorted.length) return [];
  const byStart = new Map(sorted.map((w) => [w.start, w]));
  const first = utcDay(sorted[0].start);
  const end = weekStart(ref);
  let cursor = from ? weekStart(from) : first;
  let carry = null;
  for (const w of sorted) {
    if (w.start < dayKey(cursor)) carry = num(w.avg);
    else break;
  }
  if (carry === null && cursor < first) cursor = first;
  const series = [];
  for (; cursor <= end; cursor = new Date(cursor.getTime() + WEEK)) {
    const w = byStart.get(dayKey(cursor));
    if (w) {
      series.push({start: w.start, avg: num(w.avg), min: num(w.min), max: num(w.max), count: num(w.count) || 0, carried: false});
      carry = num(w.avg);
    } else if (carry !== null) {
      series.push({start: dayKey(cursor), avg: carry, min: null, max: null, count: 0, carried: true});
    }
  }
  return series;
}

function spread(series) {
  let low = null;
  let high = null;
  let sales = 0;
  for (const w of series) {
    sales += w.count;
    if (w.min != null) low = low === null ? w.min : Math.min(low, w.min);
    if (w.max != null) high = high === null ? w.max : Math.max(high, w.max);
  }
  return {low, high, sales};
}

// Prix d'une rareté à partir de son historique {weekly, monthly} (route price-history du site) : le
// « prix moyen de la semaine » de l'onglet Marché de la fiche d'une carte, calculé comme le site
// (relevé dans son code client le 21/11/2026). null si la rareté n'a jamais été vendue.
//   price        : moyenne de la dernière semaine de la série (13 semaines jusqu'à la date de
//                  référence), arrondie, au moins 1 ; carried : cette semaine n'a pas de vente
//   sales        : ventes des 12 dernières semaines (« Ventes » du site) ; low / high : plus bas / plus haut
//   low4 / high4 : fourchette sur 4 semaines ; change : variation par rapport à la semaine précédente
//   total        : toutes les ventes connues ; lastSale : semaine (lundi) de la dernière vente
function rarityPrice(entry, ref) {
  const weekly = entry?.weekly || [];
  const series = weeklySeries(weekly, ref, new Date(ref.getTime() - 84 * DAY));
  if (!series.length) return null;
  const last = series[series.length - 1];
  const {low, high, sales} = spread(series);
  const four = spread(series.slice(-4));
  // Variation : dernière semaine vendue contre la précédente, si elle est la semaine en cours ou la précédente
  const full = weeklySeries(weekly, ref);
  let n = full.length - 1;
  while (n >= 0 && full[n].carried) n--;
  const prev = n >= 1 ? full[n - 1].avg : null;
  const change = n >= 1 && full.length - 1 - n <= 1 && prev > 0 ? (full[n].avg - prev) / prev : null;
  const sold = weekly.filter((w) => num(w?.count) > 0 && w.start).map((w) => w.start).sort();
  const monthly = (entry?.monthly || []).reduce((s, m) => s + (num(m?.count) || 0), 0);
  const total = monthly || weekly.reduce((s, w) => s + (num(w?.count) || 0), 0);
  return {
    price: Math.max(1, Math.round(last.avg)),
    carried: last.carried,
    sales,
    total,
    low,
    high,
    low4: four.low,
    high4: four.high,
    change,
    lastSale: sold.length ? sold[sold.length - 1] : null,
  };
}

// Nombre maximum de ventes renvoyées par la route /sales de l'onglet Marché d'une carte. En dessous
// de ce seuil (sans filtre de rareté), la réponse contient toutes les ventes de l'histoire de la
// carte, toutes raretés confondues : on en reconstitue exactement le même historique hebdomadaire et
// mensuel que price-history.
const RECENT_SALES_LIMIT = 5;

// Reconstitue un objet {computed_at, by_rarity: {R: {weekly, monthly}}} identique à celui de la route
// price-history à partir d'une liste de ventes [{final_price, settled_at, rarity}] (route /sales).
function historyFromSales(recent, {now = Date.now()} = {}) {
  const byRarity = {};
  for (const sale of Array.isArray(recent) ? recent : []) {
    const rarity = sale?.rarity;
    const price = num(sale?.final_price);
    const at = Date.parse(sale?.settled_at);
    if (!Object.prototype.hasOwnProperty.call(RARITY_RANK, rarity) || price == null || price < 0 || !Number.isFinite(at) || at <= 0) continue;
    const date = new Date(at);
    const wKey = dayKey(weekStart(date));
    const mKey = `${PARIS_DAY.format(date).slice(0, 7)}-01`;
    const r = (byRarity[rarity] ||= {weekly: new Map(), monthly: new Map()});
    for (const [map, key] of [[r.weekly, wKey], [r.monthly, mKey]]) {
      const b = map.get(key) || map.set(key, {sum: 0, min: price, max: price, count: 0}).get(key);
      b.sum += price;
      b.min = Math.min(b.min, price);
      b.max = Math.max(b.max, price);
      b.count++;
    }
  }
  const toBuckets = (map) =>
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([start, b]) => ({start, avg: Math.round(b.sum / b.count), min: b.min, max: b.max, count: b.count}));
  const out = {};
  for (const [rarity, r] of Object.entries(byRarity)) out[rarity] = {weekly: toBuckets(r.weekly), monthly: toBuckets(r.monthly)};
  return {computed_at: new Date(now).toISOString(), by_rarity: out};
}

// Résumé tiré de la route /sales ({recent}) : {summary, complete}. complete vaut true quand la liste
// (sans filtre de rareté) compte moins de RECENT_SALES_LIMIT ventes, ou que les 5 ventes portent sur
// une seule rareté et remontent au-delà de la fenêtre de 12 semaines (toutes les ventes des 12
// dernières semaines et le prix reporté antérieur sont alors connus).
function summarizeSales(recent, {now = Date.now()} = {}) {
  const list = Array.isArray(recent) ? recent : [];
  const history = historyFromSales(list, {now});
  const rarities = Object.keys(history.by_rarity);
  const cutoff = weekStart(new Date(now - 84 * DAY)).getTime();
  const oldest = list.reduce((min, s) => {
    const at = Date.parse(s?.settled_at);
    return Number.isFinite(at) && at > 0 ? Math.min(min, at) : min;
  }, Infinity);
  const complete = list.length < RECENT_SALES_LIMIT || (rarities.length === 1 && oldest < cutoff);
  return {
    summary: summarizeHistory(history, {now}),
    complete,
  };
}

// Résumé de toutes les raretés d'une réponse price-history : {RARETÉ: rarityPrice}, {} si jamais vendue.
// Il ne dépend que de la réponse (date de référence = son computed_at) : il se calcule une fois, à la lecture.
function summarizeHistory(history, {now = Date.now()} = {}) {
  const ref = referenceDate(history, now);
  const out = {};
  for (const [rarity, entry] of Object.entries(history?.by_rarity || {})) {
    const p = rarityPrice(entry, ref);
    if (p) out[rarity] = p;
  }
  return out;
}

// Prix d'une carte dans une rareté. summary : celui de summarizeHistory. Le site ne distingue pas les
// ventes shiny : une carte shiny reçoit le prix de sa rareté (option shiny acceptée, sans effet).
// → null si jamais vendue dans cette rareté, sinon le résumé de la rareté et reliable : au moins
//   minSales ventes sur les 12 dernières semaines.
function priceInfo(summary, rarity, {minSales = PRICE_DEFAULTS.minSales} = {}) {
  const s = summary?.[rarity];
  if (!s || s.price == null) return null;
  return {...s, reliable: s.sales >= Math.max(1, minSales)};
}

// Prix fiable, ou null (jamais vendue, ou trop peu de ventes récentes). Seul ce prix entre dans
// les totaux, les comparaisons et les mises de départ proposées.
function marketPrice(summary, rarity, options) {
  const info = priceInfo(summary, rarity, options);
  return info?.reliable ? info.price : null;
}

// Âge maximal d'un prix avant relecture : fiche ouverte (comme l'onglet Marché du site, que le site
// garde 5 min en cache) ou carte simplement affichée (pastilles, listes)
const PRICE_MAX_AGE = {detail: 10 * 60 * 1000, display: 3 * 3600 * 1000};
// Au-delà, un prix est oublié : le cache de l'extension ne grossit pas indéfiniment, et un fichier
// de prix importé (core/price-file.js) ne ramène pas de prix plus anciens
const PRICE_MAX_KEEP = 30 * DAY;

// Cadence de l'indexation des prix de la collection : jours entre deux lectures selon la rareté de
// l'exemplaire le plus rare possédé (la route des prix est limitée en volume : environ 1 100 lectures
// par jour pour entretenir une collection de 15 000 cartes)
const INDEX_CADENCE_DAYS = {L: 1, UR: 1, SR: 3, R: 7, PC: 30, C: 30};
const UNSOLD_CADENCE_DAYS = 30;
// Date à partir de laquelle une carte de la collection est à relire (0 : jamais lue).
// entry : {t: lue le, s: résumé}
function indexDueAt(entry, rarity) {
  if (!entry?.t) return 0;
  const sold = Object.keys(entry.s || {}).length > 0;
  const days = sold ? INDEX_CADENCE_DAYS[rarity] ?? 7 : UNSOLD_CADENCE_DAYS;
  return entry.t + days * DAY;
}

// Au moins une vente conclue dans cette rareté, quels que soient les réglages
const soldIn = (summary, rarity) => Boolean(Number(summary?.[rarity]?.total));

// Valeur d'une liste d'exemplaires : [{card_id, rarity, count?, is_shiny?}] ; prices : Map(card_id → summary) ;
// options : réglages de priceInfo. Seuls les prix fiables comptent.
function collectionValue(copies, prices, options = {}) {
  let value = 0;
  let priced = 0;
  let total = 0;
  for (const c of copies) {
    const n = Math.max(1, Number(c.count) || 1);
    total += n;
    const p = marketPrice(prices.get(c.card_id), c.rarity, {...options, shiny: Boolean(c.is_shiny)});
    if (p == null) continue;
    value += p * n;
    priced += n;
  }
  return {value, priced, total};
}

// Exemplaires jamais vendus sur le marché : aucune vente conclue dans leur rareté, ou dans aucune
// rareté (anyRarity). prices : Map(card_id → summary) ; une carte sans résumé n'a pas encore été lue.
// Renvoie {unsold, unknown} : les exemplaires jamais vendus, et ceux dont on ne sait encore rien.
function unsoldCopies(copies, prices, {anyRarity = false} = {}) {
  const unsold = [];
  const unknown = [];
  for (const c of copies) {
    const summary = prices.get(c.card_id);
    if (!summary) unknown.push(c);
    else if (anyRarity ? !Object.keys(summary).some((r) => soldIn(summary, r)) : !soldIn(summary, c.rarity)) unsold.push(c);
  }
  return {unsold, unknown};
}

// Exemplaires regroupés par carte et par rareté : [{card_id, rarity, card, count, rows}], dans l'ordre
// de première apparition. rows : les exemplaires (id de user_cards) de ce groupe.
function groupCopies(copies) {
  const groups = new Map();
  for (const c of copies) {
    const key = `${c.card_id}|${c.rarity}`;
    const group = groups.get(key) || groups.set(key, {card_id: c.card_id, rarity: c.rarity, card: c.card, count: 0, rows: []}).get(key);
    group.count += Math.max(1, Number(c.count) || 1);
    group.rows.push(c);
  }
  return [...groups.values()];
}

// Exemplaire à mettre en vente ou à défausser : le moins rare, jamais un favori (le site les
// verrouille : ni vente, ni défausse, ni échange), une carte shiny en dernier. null si tous sont en favori.
function freeCopy(rows) {
  const free = rows.filter((r) => !r.starred).sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity) || Boolean(a.is_shiny) - Boolean(b.is_shiny));
  return free[0] || null;
}

// Cartes possédées en plusieurs exemplaires, avec le nombre d'exemplaires vendables (on en garde un).
// copies : [{id, card_id, count?, starred?, rarity, …}] → [{card_id, copies, spare, rarity, starred, rows}]
// La rareté retenue est celle du plus petit exemplaire (celui qu'on vendrait en premier).
function spareCards(copies) {
  const byCard = new Map();
  for (const c of copies) {
    const entry = byCard.get(c.card_id) || byCard.set(c.card_id, {card_id: c.card_id, copies: 0, rows: [], starred: false}).get(c.card_id);
    entry.copies += Math.max(1, Number(c.count) || 1);
    entry.rows.push(c);
    entry.starred ||= Boolean(c.starred);
  }
  const spares = [];
  const byRarity = (a, b) => rarityRank(a.rarity) - rarityRank(b.rarity);
  for (const e of byCard.values()) {
    if (e.copies < 2) continue;
    // sellCopyId : l'id de user_cards attendu par le site ; null si tous les exemplaires sont en favori
    const free = freeCopy(e.rows);
    const rarity = (free || [...e.rows].sort(byRarity)[0])?.rarity || null;
    spares.push({...e, spare: e.copies - 1, rarity, sellCopyId: free?.id || null});
  }
  return spares;
}

// Nouveautés d'un paquet. cards : cartes tirées (dans l'ordre) ; copies : Map(card_id → exemplaires
// possédés après le tirage). Une carte est nouvelle si aucun exemplaire n'existait avant ; si elle
// sort plusieurs fois, seul le premier exemplaire est nouveau.
function packNovelty(cards, copies) {
  const pulled = new Map();
  for (const c of cards) pulled.set(c.id, (pulled.get(c.id) || 0) + 1);
  const seen = new Map();
  return cards.map((c) => {
    const before = (copies.get(c.id) ?? pulled.get(c.id)) - pulled.get(c.id);
    const rank = (seen.get(c.id) || 0) + 1;
    seen.set(c.id, rank);
    return before <= 0 && rank === 1;
  });
}

module.exports = {
  RARITIES,
  RARITY_RANK,
  RARITY_LABEL,
  RARITY_COLORS,
  rarityRank,
  PRICE_DEFAULTS,
  RECENT_SALES_LIMIT,
  weekStart,
  weeklySeries,
  historyFromSales,
  summarizeSales,
  summarizeHistory,
  priceInfo,
  marketPrice,
  PRICE_MAX_AGE,
  PRICE_MAX_KEEP,
  indexDueAt,
  soldIn,
  collectionValue,
  unsoldCopies,
  groupCopies,
  freeCopy,
  spareCards,
  packNovelty,
};
