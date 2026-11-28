// Prix du marché : résumé par carte et par rareté, mis en cache dans le navigateur.
//
// Source : l'historique des ventes que le site publie pour chaque carte
// (/api/marketplace/cards/<id>/price-history), une requête par carte, toutes raretés comprises,
// résumé par core/prices.js (« prix moyen de la semaine », comme l'onglet Marché de la fiche).
// Le site le recalcule tout au long de la journée : un prix est relu quand il a plus de 10 min dans une
// fiche ouverte, plus de 3 h sur une carte simplement affichée (PRICE_MAX_AGE).
//
// Toutes les lectures passent par une file à budget (voir « Budget de lecture des prix ») : demandes
// prioritaires (cartes tirées, fiche ouverte, échange, vente), puis cartes affichées, puis voie lente
// (listes longues, indexation de la collection par state/price-index.js, une lecture à la fois à
// intervalle fixe, plafond journalier). Voir docs/cahier-des-charges-2026-11.md (§ 4.1, § 5).
// Les réponses que le site charge lui-même (onglet Marché d'une fiche) sont reprises sans requête.
import { site, siteBlocked } from "../api/site";
import { createStore } from "../lib/store";
import { HumanCheckError, AutomationBlockedError } from "../lib/http";
import { load, update, remove, onChange, save } from "../lib/storage";
import { on, emit } from "../lib/bus";
import { lookupId } from "../lib/registry";
import { settings, PRICE_QUOTA_LIMITS, clampQuota } from "./settings";
import { priceInfo as computePriceInfo, summarizeHistory, summarizeSales, RECENT_SALES_LIMIT, PRICE_MAX_AGE, PRICE_MAX_KEEP, RARITY_RANK, rarityRank } from "../../../../core/prices";
import { exportPrices, mergePrices } from "../../../../core/price-file";
import { L, LOCALE } from "../../shared/i18n";

// Format changé (historique du site au lieu des ventes une à une) : les anciens caches sont abandonnés
const KEY = "prices-v3";
// Dernières entrées écrites, pour les autres onglets (le cache complet est trop gros pour être relu à chaque fois)
const DELTA_KEY = "prices-v3-delta";
remove("prices");
remove("prices-v2");
// Le serveur renvoie parfois des erreurs passagères : un prix en échec est redemandé après 5 min
const ERROR_RETRY = 5 * 60 * 1000;
// Au-delà de PRICE_MAX_KEEP (30 jours), une entrée est oubliée : le cache ne grossit pas indéfiniment
// Lectures simultanées : les 5 cartes d'un paquet ouvert (ou d'une fiche) partent toutes ensemble ;
// les pastilles des cartes affichées dans une grille sont lues 2 par 2.
const HIGH_CONCURRENCY = 5;
const NOW_CONCURRENCY = 2;
// loadPrices sans priorité : au-delà de ce nombre de cartes, le reste passe par la voie lente
const NOW_BATCH = 50;
// Voie lente (listes longues, indexation) : répartie entre les deux routes de l'onglet Marché
// d'une carte (/price-history et /sales). En normale : 1 lecture toutes les 4 s (soit 1 toutes les
// 8 s par route, ~900 / h) ; en rapide : 1 toutes les 2 s (soit 1 toutes les 4 s par route,
// ~1 800 / h), mis à l'échelle par slowSpeed() selon le quota réglé par le joueur.
export const SLOW_SPEEDS = { normal: { gap: 4 * 1000, cap: 21600 }, fast: { gap: 2 * 1000, cap: 43200 } };
// Pauses des lectures de prix : refus temporaire du site (1 min), trop de requêtes (1 min), erreurs répétées (2 min)
const PAUSE_BLOCKED = 60 * 1000;
const PAUSE_429 = 60 * 1000;
const PAUSE_ERRORS = 2 * 60 * 1000;
const ERROR_STREAK = 5;

const cache = new Map(); // card_id → {s: résumé, c: computed_at, t: lu le, err?}
export const priceVersion = createStore({ v: 0, loaded: false });
// État de la source : broken (le site a changé, plus de lecture jusqu'au rechargement), message
export const priceSource = createStore({ broken: false, message: null });

// --- Cache : enregistrement groupé, partagé entre onglets
// Au plus toutes les 2 s, y compris pendant un long chargement. Seules les entrées modifiées sont
// écrites, fusionnées avec le cache enregistré ; elles sont aussi publiées dans DELTA_KEY pour que
// les autres onglets les reprennent sans relire tout le cache.
const TAB = Math.random().toString(36).slice(2);
const dirty = new Set();
let flushTimer = null;
const bump = () => priceVersion.set((s) => ({ ...s, v: s.v + 1 }));
function touch(cardId) {
  bump();
  if (cardId) dirty.add(cardId);
  flushTimer ||= setTimeout(flush, 2000);
}
async function flush() {
  flushTimer = null;
  if (!dirty.size) return;
  const ids = [...dirty];
  dirty.clear();
  const entries = {};
  for (const id of ids) if (cache.has(id)) entries[id] = cache.get(id);
  await update(KEY, {}, (stored) => {
    for (const [id, entry] of Object.entries(entries)) if (!(stored[id]?.t > entry.t)) stored[id] = entry;
    return stored;
  }).catch(() => {});
  save(DELTA_KEY, { tab: TAB, entries }).catch(() => {});
}
// Dernier enregistrement quand l'onglet est fermé ou caché
addEventListener("pagehide", flush);
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
// Entrées venues d'un autre onglet : reprises quand elles sont plus récentes, sans être réécrites
function takeNewer(entries) {
  let changed = false;
  for (const [id, entry] of Object.entries(entries || {})) {
    if (entry && !(cache.get(id)?.t >= entry.t)) {
      cache.set(id, entry);
      changed = true;
    }
  }
  if (changed) bump();
}
onChange(DELTA_KEY, (delta) => {
  if (!delta || delta.tab === TAB) return;
  // Fichier de prix importé dans un autre onglet : trop d'entrées pour être publiées ici, le cache
  // enregistré est relu
  if (delta.reload) load(KEY, {}).then(takeNewer);
  else takeNewer(delta.entries);
});

export const ready = load(KEY, {}).then((saved) => {
  const cutoff = Date.now() - PRICE_MAX_KEEP;
  const expired = [];
  for (const [id, v] of Object.entries(saved || {})) {
    if (!v || !(v.t > cutoff)) expired.push(id);
    else if (!cache.has(id)) cache.set(id, v);
  }
  priceVersion.set((s) => ({ v: s.v + 1, loaded: true }));
  if (expired.length)
    update(KEY, {}, (stored) => {
      for (const id of expired) if (!(stored[id]?.t > cutoff)) delete stored[id];
      return stored;
    }).catch(() => {});
});

// maxAge : PRICE_MAX_AGE.display (cartes affichées, listes) ou .detail (fiche ouverte). Une entrée
// partielle (issue de /sales avec 5 ventes) reste à compléter par price-history.
const isFresh = (entry, maxAge = PRICE_MAX_AGE.display) => Boolean(entry) && !entry.partial && Date.now() - entry.t < (entry.err ? ERROR_RETRY : maxAge);

// Réglage de fiabilité des prix, à passer aux fonctions de core/prices.js
export const priceOptions = () => ({ minSales: settings.get().minSales });
// Réglage modifié : les prix affichés sont recalculés
let rule = priceOptions().minSales;
settings.subscribe(() => {
  if (priceOptions().minSales !== rule) {
    rule = priceOptions().minSales;
    bump();
  }
});

export const summaryOf = (cardId) => cache.get(cardId)?.s || null;
// Entrée brute du cache (indexation) : {s, c, t, err?} ou undefined
export const entryOf = (cardId) => cache.get(cardId);
// {price, sales, total, reliable, carried, lastSale, low, high, low4, high4, change} (core/prices.js),
// null si jamais vendue dans cette rareté ou pas encore lue. Le site ne distingue pas les ventes
// shiny : une carte shiny a le prix de sa rareté.
export const priceInfo = (cardId, rarity) => computePriceInfo(summaryOf(cardId), rarity, priceOptions());
// Prix fiable (assez de ventes récentes), ou null : le seul qui entre dans les totaux et les décisions
export function priceOf(cardId, rarity) {
  const info = priceInfo(cardId, rarity);
  return info?.reliable ? info.price : null;
}
export const hasFreshPrice = (cardId) => isFresh(cache.get(cardId));
// "ok" (prix fiable), "few" (vendue, mais trop peu de ventes récentes), "none" (aucune vente pour
// cette rareté), "error" (lecture impossible), "unknown" (pas encore lu)
export function priceStatus(cardId, rarity) {
  const entry = cache.get(cardId);
  if (!entry) return "unknown";
  if (entry.s && priceInfo(cardId, rarity)) return priceInfo(cardId, rarity).reliable ? "ok" : "few";
  return entry.err ? "error" : "none";
}
// Prix à afficher sur une carte (props de CardRow) : le prix fiable, sinon le prix indicatif signalé
// comme tel (uncertain : explication), sinon rien
export function pricing(cardId, rarity) {
  const info = priceInfo(cardId, rarity);
  if (!info || info.price == null) return { price: null };
  if (info.reliable) return { price: info.price };
  return { price: info.price, uncertain: uncertainNote(info) };
}
// Lundi AAAA-MM-JJ → « 16 nov. »
export const weekLabel = (start) => (start ? new Date(`${start}T00:00:00Z`).toLocaleDateString(LOCALE, { day: "numeric", month: "short", timeZone: "UTC" }) : "");
export function uncertainNote(info) {
  const min = priceOptions().minSales;
  const last = info.carried && info.lastSale ? L(` Dernière vente : semaine du ${weekLabel(info.lastSale)}.`, ` Last sale: week of ${weekLabel(info.lastSale)}.`) : "";
  return L(
    `Prix indicatif : ${info.sales} vente${info.sales > 1 ? "s" : ""} sur les 12 dernières semaines, il en faut ${min} pour un prix fiable.${last}`,
    `Estimated price: ${info.sales} sale${info.sales !== 1 ? "s" : ""} in the last 12 weeks; ${min} are needed for a reliable price.${last}`,
  );
}
export const priceMap = () => new Map([...cache].map(([id, v]) => [id, v.s]));

function store(cardId, history) {
  cache.set(cardId, { s: summarizeHistory(history), c: history.computed_at || null, t: Date.now() });
  touch(cardId);
}
// Ventes issues de /sales : résumé complet quand < 5 ventes (toutes raretés confondues), sinon résumé
// provisoire (partial: true) en attendant que la voie price-history complète les 12 semaines.
function storeSales(cardId, recent, { forcePartial = false } = {}) {
  const { summary, complete } = summarizeSales(recent);
  const partial = forcePartial || !complete;
  cache.set(cardId, { s: summary, c: null, t: Date.now(), ...(partial && { partial: true }) });
  touch(cardId);
  return !partial;
}
function markError(cardId) {
  cache.set(cardId, { s: cache.get(cardId)?.s || null, c: cache.get(cardId)?.c || null, t: Date.now(), err: true });
  touch(cardId);
}
const validHistory = (data) => data && typeof data === "object" && data.by_rarity && typeof data.by_rarity === "object" && !Array.isArray(data.by_rarity);
const validSales = (data) => data && typeof data === "object" && Array.isArray(data.recent);

// Historique ou ventes chargés par le site lui-même (onglet Marché d'une fiche) : gratuits.
// Si le site reçoit lui-même price-history, le blocage temporaire est levé : la file reprend.
on("price-history", ({ data, match }) => {
  if (!validHistory(data)) return;
  store(match[1], data);
  if (slowBudget.get().pausedUntil > Date.now()) {
    slowBudget.set({ pausedUntil: 0 });
    saveBudget();
    pump();
  }
});
on("card-sales", ({ data, match }) => {
  if (!validSales(data)) return;
  const [, cardId, rarity] = match;
  const prev = cache.get(cardId);
  if (prev && !prev.err && isFresh(prev)) return;
  if (!rarity && data.recent.length < RECENT_SALES_LIMIT) storeSales(cardId, data.recent);
  else if (!prev?.s) storeSales(cardId, data.recent, { forcePartial: true });
});

// --- Budget de lecture des prix, partagé entre onglets. L'onglet Marché d'une carte sur le site
// s'appuie sur deux routes (/price-history et /sales), chacune limitée séparément par le serveur :
// la Toolbox suit le quota réglé par le joueur sur chaque route (reads pour price-history,
// salesReads pour sales). Sur price-history, la moitié de la rafale de 30 s reste réservée aux
// demandes prioritaires (cartes tirées, fiche ouverte…) ; la voie lente alterne entre price-history
// (cartes L/UR/SR et compléments) et sales (cartes R/PC/C, résolues en un appel dès qu'elles ont
// moins de 5 ventes). Refus du site : pause des seules lectures de prix (PAUSE_BLOCKED), puis budget
// réduit de moitié jusqu'au lendemain.
export const PRICE_BUDGET = {
  WINDOW_MS: 10 * 60 * 1000,
  WINDOW_MAX: PRICE_QUOTA_LIMITS.window.default,
  BURST_MS: 30 * 1000,
  BURST_MAX: PRICE_QUOTA_LIMITS.burst.default,
};
const PARIS_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const siteDay = (t = Date.now()) => PARIS_DAY.format(new Date(t));
// reads : dates des lectures price-history de la fenêtre ; salesReads : celles de /sales ;
// count : lectures lentes du jour ; pausedUntil : pause des lectures de prix ; halved : budget réduit jusqu'au lendemain
export const slowBudget = createStore({ day: siteDay(), count: 0, pausedUntil: 0, halved: false, reads: [], salesReads: [] });
const BUDGET_KEY = "price-budget";
const recent = (reads, now = Date.now()) => (reads || []).filter((t) => t > now - PRICE_BUDGET.WINDOW_MS && t <= now + 1000);
// Fusion de deux listes de dates de lecture : deux lectures parties dans la même milliseconde ont la
// même date, chacune compte (nombre d'occurrences le plus grand des deux listes)
function mergeReads(a, b) {
  const count = (list) => list.reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map());
  const ca = count(a);
  const cb = count(b);
  const out = [];
  for (const t of new Set([...ca.keys(), ...cb.keys()])) for (let i = Math.max(ca.get(t) || 0, cb.get(t) || 0); i > 0; i--) out.push(t);
  return out.sort((x, y) => x - y);
}
function adopt(saved) {
  if (!saved) return;
  const b = slowBudget.get();
  const today = saved.day === siteDay();
  const maxPause = Date.now() + PAUSE_BLOCKED;
  slowBudget.set({
    count: today ? Math.max(b.count, saved.count || 0) : b.count,
    halved: (today && saved.halved) || b.halved,
    pausedUntil: Math.min(maxPause, Math.max(b.pausedUntil, saved.pausedUntil || 0)),
    reads: recent(mergeReads(b.reads, saved.reads || [])),
    salesReads: recent(mergeReads(b.salesReads || [], saved.salesReads || [])),
  });
}
load(BUDGET_KEY, null).then(adopt);
onChange(BUDGET_KEY, (saved) => {
  adopt(saved);
  pump();
});
function budget() {
  const b = slowBudget.get();
  if (b.day !== siteDay()) slowBudget.set({ day: siteDay(), count: 0, halved: false });
  return slowBudget.get();
}
const saveBudget = () => save(BUDGET_KEY, slowBudget.get()).catch(() => {});
export function priceQuota() {
  const s = settings.get();
  return {
    window: clampQuota(s.priceQuotaWindow, PRICE_QUOTA_LIMITS.window),
    burst: clampQuota(s.priceQuotaBurst, PRICE_QUOTA_LIMITS.burst),
  };
}
export function slowSpeed(mode = settings.get().priceIndexSpeed) {
  const base = SLOW_SPEEDS[mode] || SLOW_SPEEDS.normal;
  const scale = priceQuota().window / PRICE_BUDGET.WINDOW_MAX;
  return {
    gap: Math.max(1, Math.round(base.gap / scale)),
    cap: Math.max(1, Math.round(base.cap * scale)),
  };
}
export const slowCapReached = () => budget().count >= slowSpeed().cap;
export const pricesPausedUntil = () => (budget().pausedUntil > Date.now() ? budget().pausedUntil : 0);
const windowMax = () => Math.max(1, Math.floor(priceQuota().window / (budget().halved ? 2 : 1)));
const burstMax = () => Math.max(1, Math.floor(priceQuota().burst / (budget().halved ? 2 : 1)));
export const recentReadsCount = (now = Date.now()) => recent(budget().reads, now).length;
export const recentSalesReadsCount = (now = Date.now()) => recent(budget().salesReads, now).length;
function countRead(slow, route = "history") {
  const b = budget();
  const now = Date.now();
  // La voie lente est cadencée par slowGap() et son plafond journalier : elle ne consomme pas la
  // rafale d'affichage (reads), afin que les cartes visibles à l'écran et les paquets tirés partent
  // toujours tout de suite même pendant une longue indexation.
  slowBudget.set({
    ...(slow
      ? { count: b.count + 1, ...(route === "sales" && { salesReads: [...recent(b.salesReads, now), now] }) }
      : { reads: [...recent(b.reads, now), now] }),
  });
  saveBudget();
}
function uncountSalesRead(slow) {
  const b = budget();
  const salesReads = [...recent(b.salesReads)];
  salesReads.pop();
  slowBudget.set({ salesReads, ...(slow && b.count > 0 && { count: b.count - 1 }) });
  saveBudget();
}
function pausePrices(ms, { halve = false } = {}) {
  slowBudget.set({ pausedUntil: Date.now() + ms, ...(halve && { halved: true }) });
  saveBudget();
}
// Attente (ms) avant qu'une lecture de priorité prio puisse partir sur route (0 : tout de suite).
// Les demandes prioritaires (PRIO.high : paquet que le joueur vient d'ouvrir, fiche de carte,
// fenêtre d'échange ou de vente) partent toujours immédiatement (hors pause imposée par le serveur),
// tout en étant comptées dans reads pour que les pastilles de fond (PRIO.display) ralentissent ensuite.
function budgetWait(prio, now, route = "history") {
  const b = budget();
  if (b.pausedUntil > now) return b.pausedUntil - now;
  if (prio === PRIO.high) return 0;
  const reads = recent(route === "sales" ? b.salesReads : b.reads, now);
  const wMax = windowMax();
  const bMax = burstMax();
  const burstShare = route === "sales" ? 1 : 0.5;
  const burstLimit = Math.min(wMax, Math.max(1, Math.floor(bMax * burstShare)));
  const reserve = route === "sales" ? 0 : Math.min(Math.floor(wMax * 0.5), Math.ceil(bMax * 0.5));
  const limit = Math.max(1, wMax - reserve);
  const burst = reads.filter((t) => t > now - PRICE_BUDGET.BURST_MS);
  let wait = 0;
  if (reads.length >= limit) wait = reads[reads.length - limit] + PRICE_BUDGET.WINDOW_MS - now;
  if (burst.length >= burstLimit) wait = Math.max(wait, burst[burst.length - burstLimit] + PRICE_BUDGET.BURST_MS - now);
  return Math.max(0, Math.ceil(wait));
}

// --- File de lecture
// queue : card_id → {prio, rarity, waiters: Set(fn)} ; prio : PRIO.high (cartes tirées, fiche ouverte,
// échange, vente), PRIO.display (cartes affichées), PRIO.slow (listes longues). Les cartes de
// l'indexation ne sont pas en file : state/price-index.js les fournit une à une (setIndexSource).
export const PRIO = { slow: 0, display: 1, high: 2 };
const queue = new Map();
const inflight = new Set();
let indexSource = null;
let lastSlowAt = 0;
let lastSlowRoute = null;
let salesBroken = false;
let pumpTimer = null;
let errorStreak = 0;
// Vérification anti-robot demandée par le site : plus aucune lecture de prix jusqu'au rechargement
let slowStopped = null;

export function setIndexSource(fn) {
  indexSource = fn;
  pump();
}
export const slowStoppedBy = () => slowStopped;
export const isQueued = (cardId) => queue.has(cardId) || inflight.has(cardId);
const slowGap = () => slowSpeed().gap * (budget().halved ? 2 : 1);

function settle(cardId) {
  const q = queue.get(cardId);
  queue.delete(cardId);
  for (const fn of q?.waiters || []) fn();
}

// Lectures arrêtées : les listes en attente se terminent sans prix.
function stopAll() {
  for (const id of [...queue.keys()]) if (!inflight.has(id)) settle(id);
}
const stopped = () => priceSource.get().broken || Boolean(slowStopped) || Boolean(siteBlocked());

// Raison pour laquelle un prix demandé n'est pas encore là (récapitulatif, pastilles)
export function priceWaitNote() {
  if (priceSource.get().broken) return priceSource.get().message;
  if (slowStopped || siteBlocked()) return (slowStopped || siteBlocked()).message;
  const until = pricesPausedUntil();
  if (until)
    return L(
      `Lectures de prix en pause jusqu'à ${new Date(until).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })} : le site limite leur nombre.`,
      `Price reads paused until ${new Date(until).toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit" })}: the site limits how many are allowed.`,
    );
  return L("Prix en attente : la Toolbox étale ses lectures pour rester sous la limite du site.", "Price pending: the Toolbox spreads its reads to stay under the site's limit.");
}

async function fetchOne(cardId, slow, route = "history", priority = false) {
  inflight.add(cardId);
  countRead(slow, route);
  let fallbackToHistory = false;
  try {
    // Une seule tentative : une carte en échec est relue 5 min plus tard (ERROR_RETRY)
    if (route === "sales") {
      const data = await site.cardSales(cardId, { retries: 1 });
      if (!validSales(data)) {
        salesBroken = true;
        fallbackToHistory = true;
        uncountSalesRead(slow);
        lastSlowAt = 0;
        return;
      }
      errorStreak = 0;
      storeSales(cardId, data.recent);
      return;
    }
    const data = await site.priceHistory(cardId, { retries: 1, priority });
    if (!validHistory(data)) {
      priceSource.set({
        broken: true,
        message: L(
          "Prix indisponibles : le site a changé le format de ses prix, une mise à jour de la Toolbox est nécessaire.",
          "Prices unavailable: the site changed how it serves prices, a Toolbox update is needed.",
        ),
      });
      return stopAll();
    }
    errorStreak = 0;
    store(cardId, data);
  } catch (e) {
    if (e instanceof AutomationBlockedError) {
      // Limite temporaire de la route des prix : pause d'une minute et budget réduit. Pour une
      // demande prioritaire (paquet ouvert, fiche), on tente aussitôt la route /sales en repli.
      const first = !pricesPausedUntil();
      pausePrices(PAUSE_BLOCKED, { halve: true });
      if (first) emit("prices-paused", { until: pricesPausedUntil(), message: e.message });
      if (priority && route === "history" && !salesBroken) {
        try {
          const sales = await site.cardSales(cardId, { retries: 1 });
          if (validSales(sales)) storeSales(cardId, sales.recent);
          else salesBroken = true;
        } catch {}
      }
    } else if (e instanceof HumanCheckError) {
      if (!slowStopped) emit("prices-stopped", { message: e.message, error: e });
      slowStopped = e;
      stopAll();
    } else if (siteBlocked()) {
      stopAll();
    } else if (e.status === 403 || e.status === 404) {
      if (route === "sales") {
        // La route /sales n'est pas disponible : repli transparent sur price-history
        salesBroken = true;
        fallbackToHistory = true;
        uncountSalesRead(slow);
        lastSlowAt = 0;
      } else {
        priceSource.set({ broken: true, message: L("Prix indisponibles : le site refuse désormais leur lecture, une mise à jour de la Toolbox est nécessaire.", "Prices unavailable: the site now refuses to serve them, a Toolbox update is needed.") });
        stopAll();
      }
    } else {
      markError(cardId);
      if (e.status === 429) pausePrices(PAUSE_429, { halve: true });
      else if (++errorStreak >= ERROR_STREAK) {
        errorStreak = 0;
        pausePrices(PAUSE_ERRORS);
      }
    }
  } finally {
    inflight.delete(cardId);
    // En pause après un refus (ou repli de /sales vers price-history) : la carte reste en file
    if (!fallbackToHistory && !(queue.has(cardId) && pricesPausedUntil() && !stopped() && !cache.get(cardId)?.err && !isFresh(cache.get(cardId)))) settle(cardId);
    pump();
  }
}

// Carte suivante d'une priorité donnée : la plus rare d'abord, puis l'ordre d'arrivée
function pick(prio) {
  let best = null;
  for (const [id, q] of queue) {
    if (q.prio !== prio || inflight.has(id)) continue;
    if (!best || rarityRank(q.rarity) > rarityRank(queue.get(best).rarity)) best = id;
  }
  return best;
}

// Carte de la file lente adaptée à la route /sales : R, PC et C d'abord (presque toujours < 5 ventes)
function pickSlowSales() {
  let best = null;
  for (const [id, q] of queue) {
    if (q.prio !== PRIO.slow || inflight.has(id) || cache.get(id)?.partial) continue;
    if (!best) best = id;
    else {
      const rA = rarityRank(q.rarity) <= RARITY_RANK.R;
      const rB = rarityRank(queue.get(best).rarity) <= RARITY_RANK.R;
      if (rA !== rB ? rA : rarityRank(q.rarity) > rarityRank(queue.get(best).rarity)) best = id;
    }
  }
  return best;
}

// Prochain passage de la file (au plus une minute d'attente) ; la minuterie ne retient pas un
// processus Node (tests : des cartes peuvent rester en attente de budget)
function wake(ms) {
  clearTimeout(pumpTimer);
  pumpTimer = setTimeout(pump, Math.max(0, Math.min(ms, 60000)));
  pumpTimer?.unref?.();
}

function pump() {
  clearTimeout(pumpTimer);
  pumpTimer = null;
  if (stopped()) return stopAll();
  const now = Date.now();
  // Demandes prioritaires (paquet ouvert, fiche de carte) : jusqu'à 5 en parallèle tout de suite ;
  // puis cartes affichées dans une grille (2 à la fois, dans le budget de price-history).
  for (const [prio, concurrency] of [[PRIO.high, HIGH_CONCURRENCY], [PRIO.display, NOW_CONCURRENCY]]) {
    while (inflight.size < concurrency) {
      const id = pick(prio);
      if (!id) break;
      const wait = budgetWait(prio, now, "history");
      if (wait > 0) return wake(wait);
      fetchOne(id, false, "history", prio === PRIO.high);
    }
    if (pick(prio)) return; // en attente d'une place
  }
  // Voie lente (listes longues, indexation) : une à la fois, en alternant entre price-history et sales
  if (inflight.size) return;
  const b = budget();
  const slowWaiting = [...queue.values()].some((q) => q.prio === PRIO.slow);
  if (b.count >= slowSpeed().cap) {
    // Plafond du jour atteint : les listes longues en attente s'arrêtent là ; l'indexation reprend
    // le lendemain (vérifié chaque minute)
    for (const [id, q] of [...queue]) if (q.prio === PRIO.slow) settle(id);
    if (indexSource) wake(60000);
    return;
  }
  if (b.pausedUntil > now) {
    if (slowWaiting || indexSource) wake(b.pausedUntil - now);
    return;
  }
  const slowWait = lastSlowAt ? lastSlowAt + slowGap() - now : 0;
  if (slowWait > 0) {
    if (slowWaiting || indexSource) wake(slowWait);
    return;
  }
  const routes = salesBroken ? ["history"] : lastSlowRoute === "history" ? ["sales", "history"] : ["history", "sales"];
  for (const route of routes) {
    const id = (route === "sales" ? pickSlowSales() : pick(PRIO.slow)) || indexSource?.(route) || null;
    if (!id) continue;
    if (isFresh(cache.get(id)) && !queue.has(id)) {
      // Déjà lue entre-temps (affichage, autre onglet) : on passe à la suivante
      return wake(0);
    }
    lastSlowAt = now;
    lastSlowRoute = route;
    fetchOne(id, true, route);
    return;
  }
  // Indexation : rien à relire maintenant, nouvel essai dans une minute
  if (indexSource) wake(60000);
}

// Quota, vitesse ou raretés modifiés dans les réglages : la file reprend tout de suite avec les nouvelles bornes
const quotaSig = () => {
  const s = settings.get();
  return `${s.priceQuotaWindow}|${s.priceQuotaBurst}|${s.priceIndexSpeed}|${(s.priceIndexRarities || []).join(",")}`;
};
let lastQuotaSig = quotaSig();
settings.subscribe(() => {
  const next = quotaSig();
  if (next === lastQuotaSig) return;
  lastQuotaSig = next;
  pump();
});

function enqueue(cardId, prio, rarity, waiter) {
  const q = queue.get(cardId);
  if (q) {
    q.prio = Math.max(q.prio, prio);
    q.rarity ||= rarity;
    if (waiter) q.waiters.add(waiter);
  } else {
    queue.set(cardId, { prio, rarity, waiters: new Set(waiter ? [waiter] : []) });
  }
}

// Rareté connue d'une carte, pour lire les plus précieuses d'abord
const rarityOf = (id, rarity) => rarity || lookupId(id)?.rarity || null;
const toItems = (list) => list.map((x) => (typeof x === "string" ? { id: x, rarity: rarityOf(x) } : { id: x.id, rarity: rarityOf(x.id, x.rarity) }));

// --- Demande ponctuelle d'une carte affichée. detail : fiche ouverte, demande prioritaire, prix relu
// s'il a plus de 10 min (sinon 3 h) ; priority : demande prioritaire (fenêtre d'échange…), même durée
export function requestPrice(cardId, { force = false, detail = false, priority = false, rarity = null } = {}) {
  if (!cardId || stopped()) return;
  if (!force && isFresh(cache.get(cardId), detail ? PRICE_MAX_AGE.detail : PRICE_MAX_AGE.display)) return;
  if (inflight.has(cardId) && !queue.has(cardId)) return;
  enqueue(cardId, detail || priority ? PRIO.high : PRIO.display, rarityOf(cardId, rarity));
  pump();
}

// Chargement d'une liste avec progression. items : ids, ou {id, rarity} (les plus rares d'abord).
// priority : true pour ce que le joueur regarde en ce moment (cartes tirées, échange, vente) ; sinon
// les NOW_BATCH premières passent comme des cartes affichées, les suivantes par la voie lente
// (plafond journalier compris). Renvoie le nombre de cartes traitées ; annulable (signal).
export async function loadPrices(items, { force = false, priority = false, onProgress, signal } = {}) {
  const seen = new Set();
  const todo = toItems(items)
    .filter((it) => {
      if (!it.id || seen.has(it.id)) return false;
      seen.add(it.id);
      return force || !isFresh(cache.get(it.id));
    })
    .sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity));
  if (!todo.length || stopped()) return 0;
  let done = 0;
  onProgress?.(0, todo.length);
  const waiters = new Map();
  await new Promise((resolve) => {
    const finish = () => {
      for (const [id, fn] of waiters) {
        const q = queue.get(id);
        if (!q) continue;
        q.waiters.delete(fn);
        // Plus personne n'attend cette carte de la liste : elle quitte la file
        if (!q.waiters.size && !inflight.has(id)) queue.delete(id);
      }
      resolve();
    };
    signal?.addEventListener("abort", finish, { once: true });
    todo.forEach((it, i) => {
      const fn = () => {
        waiters.delete(it.id);
        done++;
        onProgress?.(done, todo.length);
        if (done === todo.length) finish();
      };
      waiters.set(it.id, fn);
      enqueue(it.id, priority ? PRIO.high : i < NOW_BATCH ? PRIO.display : PRIO.slow, it.rarity, fn);
    });
    pump();
  });
  if (signal?.aborted) throw new DOMException(L("Annulé", "Cancelled"), "AbortError");
  return done;
}

// --- Export / import en JSON (core/price-file.js) : les prix lus sur un appareil se reprennent sur
// un autre, sans refaire l'indexation. Aucune requête au site : seul le cache du navigateur change.
// Objet à enregistrer dans le fichier (lectures en échec et résumés provisoires laissés de côté)
export const exportPriceFile = () => exportPrices(cache);
// Ce qu'un import changerait ici. entries : Map de importPrices → {apply, added, updated, kept}
export const previewPriceImport = (entries) => mergePrices((id) => cache.get(id), entries);
// Reprend les prix importés plus récents que ceux d'ici, les enregistre (un prix plus récent écrit
// entre-temps par un autre onglet est gardé) et prévient les autres onglets. Renvoie le nombre de
// prix repris ; lève une erreur si l'enregistrement échoue, sans rien changer à l'affichage.
export async function applyPriceImport(entries) {
  await ready;
  const { apply } = previewPriceImport(entries);
  if (!apply.size) return 0;
  await update(KEY, {}, (stored) => {
    const storedOf = (id) => (Object.hasOwn(stored, id) ? stored[id] : undefined);
    for (const [id, entry] of mergePrices(storedOf, apply).apply) stored[id] = entry;
    return stored;
  });
  for (const [id, entry] of apply) {
    cache.set(id, entry);
    dirty.delete(id);
  }
  bump();
  save(DELTA_KEY, { tab: TAB, reload: Date.now() }).catch(() => {});
  return apply.size;
}

export async function clearPrices() {
  cache.clear();
  dirty.clear();
  await save(KEY, {});
  touch();
}

