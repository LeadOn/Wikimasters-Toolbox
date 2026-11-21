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
import { priceInfo as computePriceInfo, summarizeHistory, PRICE_MAX_AGE, rarityRank } from "../../../../core/prices";
import { L, LOCALE } from "../../shared/i18n";

// Format changé (historique du site au lieu des ventes une à une) : les anciens caches sont abandonnés
const KEY = "prices-v3";
// Dernières entrées écrites, pour les autres onglets (le cache complet est trop gros pour être relu à chaque fois)
const DELTA_KEY = "prices-v3-delta";
remove("prices");
remove("prices-v2");
// Le serveur renvoie parfois des erreurs passagères : un prix en échec est redemandé après 5 min
const ERROR_RETRY = 5 * 60 * 1000;
// Au-delà, une entrée est oubliée (le cache ne grossit pas indéfiniment)
const MAX_KEEP = 30 * 24 * 3600 * 1000;
// Lectures simultanées (demandes prioritaires et cartes affichées)
const NOW_CONCURRENCY = 2;
// loadPrices sans priorité : au-delà de ce nombre de cartes, le reste passe par la voie lente
const NOW_BATCH = 50;
// Voie lente (listes longues, indexation) : écart et plafond par jour au quota par défaut
// (60 / 10 min), mis à l'échelle par slowSpeed() selon le quota réglé par le joueur
export const SLOW_SPEEDS = { normal: { gap: 60 * 1000, cap: 1440 }, fast: { gap: 30 * 1000, cap: 2880 } };
// Pauses des lectures de prix : refus du site pour automatisation, trop de requêtes, erreurs répétées
const PAUSE_BLOCKED = 15 * 60 * 1000;
const PAUSE_429 = 60 * 1000;
const PAUSE_ERRORS = 15 * 60 * 1000;
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
onChange(DELTA_KEY, (delta) => {
  if (!delta || delta.tab === TAB) return;
  let changed = false;
  for (const [id, entry] of Object.entries(delta.entries || {})) {
    if (entry && !(cache.get(id)?.t >= entry.t)) {
      cache.set(id, entry);
      changed = true;
    }
  }
  if (changed) bump();
});

export const ready = load(KEY, {}).then((saved) => {
  const cutoff = Date.now() - MAX_KEEP;
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

// maxAge : PRICE_MAX_AGE.display (cartes affichées, listes) ou .detail (fiche ouverte)
const isFresh = (entry, maxAge = PRICE_MAX_AGE.display) => Boolean(entry) && Date.now() - entry.t < (entry.err ? ERROR_RETRY : maxAge);

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
function markError(cardId) {
  cache.set(cardId, { s: cache.get(cardId)?.s || null, c: cache.get(cardId)?.c || null, t: Date.now(), err: true });
  touch(cardId);
}
const validHistory = (data) => data && typeof data === "object" && data.by_rarity && typeof data.by_rarity === "object" && !Array.isArray(data.by_rarity);

// Historique chargé par le site lui-même (onglet Marché d'une fiche) : gratuit
on("price-history", ({ data, match }) => {
  if (validHistory(data)) store(match[1], data);
});

// --- Budget de lecture des prix, partagé entre onglets. La route des prix du site est limitée en
// volume par compte (refus « automation_limit » vu après ~100 lectures en 10 min, dont une rafale) :
// toutes les lectures de la Toolbox (affichage, listes, indexation) restent sous le quota réglé par
// le joueur (par défaut WINDOW_MAX par WINDOW_MS, BURST_MAX par BURST_MS). Les demandes prioritaires
// (cartes tirées, fiche ouverte…) gardent toujours la moitié de la fenêtre et de la rafale : les
// cartes affichées et la voie lente ne partent que tant que le total reste sous la moitié. Refus du
// site : pause des seules lectures de prix (PAUSE_BLOCKED), puis budget réduit de moitié jusqu'au
// lendemain.
export const PRICE_BUDGET = {
  WINDOW_MS: 10 * 60 * 1000,
  WINDOW_MAX: PRICE_QUOTA_LIMITS.window.default,
  BURST_MS: 30 * 1000,
  BURST_MAX: PRICE_QUOTA_LIMITS.burst.default,
};
const PARIS_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const siteDay = (t = Date.now()) => PARIS_DAY.format(new Date(t));
// reads : dates des lectures de la fenêtre (tous onglets) ; count : lectures lentes du jour ;
// pausedUntil : pause des lectures de prix ; halved : budget réduit jusqu'au lendemain
export const slowBudget = createStore({ day: siteDay(), count: 0, pausedUntil: 0, halved: false, reads: [] });
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
  slowBudget.set({
    count: today ? Math.max(b.count, saved.count || 0) : b.count,
    halved: (today && saved.halved) || b.halved,
    pausedUntil: Math.max(b.pausedUntil, saved.pausedUntil || 0),
    reads: recent(mergeReads(b.reads, saved.reads || [])),
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
function countRead(slow) {
  const b = budget();
  slowBudget.set({ reads: [...recent(b.reads), Date.now()], ...(slow && { count: b.count + 1 }) });
  saveBudget();
}
function pausePrices(ms, { halve = false } = {}) {
  slowBudget.set({ pausedUntil: Date.now() + ms, ...(halve && { halved: true }) });
  saveBudget();
}
// Attente (ms) avant qu'une lecture de priorité prio puisse partir (0 : tout de suite)
function budgetWait(prio, now) {
  const b = budget();
  if (b.pausedUntil > now) return b.pausedUntil - now;
  const reads = recent(b.reads, now);
  // Priorité haute : tout le budget ; cartes affichées et voie lente : la moitié (le reste est réservé)
  const share = prio === PRIO.high ? 1 : 0.5;
  const limit = Math.max(1, Math.floor(windowMax() * share));
  const burstLimit = Math.min(limit, Math.max(1, Math.floor(burstMax() * share)));
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

async function fetchOne(cardId, slow) {
  inflight.add(cardId);
  countRead(slow);
  try {
    // Une seule tentative : une carte en échec est relue 5 min plus tard (ERROR_RETRY)
    const data = await site.priceHistory(cardId, { retries: 1 });
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
      // Limite de la route des prix : pause, budget réduit, indexation désactivée (price-index.js)
      const first = !pricesPausedUntil();
      pausePrices(PAUSE_BLOCKED, { halve: true });
      if (first) emit("prices-paused", { until: pricesPausedUntil(), message: e.message });
    } else if (e instanceof HumanCheckError) {
      if (!slowStopped) emit("prices-stopped", { message: e.message, error: e });
      slowStopped = e;
      stopAll();
    } else if (siteBlocked()) {
      stopAll();
    } else if (e.status === 403 || e.status === 404) {
      priceSource.set({ broken: true, message: L("Prix indisponibles : le site refuse désormais leur lecture, une mise à jour de la Toolbox est nécessaire.", "Prices unavailable: the site now refuses to serve them, a Toolbox update is needed.") });
      stopAll();
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
    // En pause après un refus : la carte reste en file, elle sera lue à la reprise
    if (!(queue.has(cardId) && pricesPausedUntil() && !stopped() && !cache.get(cardId)?.err && !isFresh(cache.get(cardId)))) settle(cardId);
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
  // Demandes prioritaires puis cartes affichées, deux à la fois, dans le budget
  for (const prio of [PRIO.high, PRIO.display]) {
    while (inflight.size < NOW_CONCURRENCY) {
      const id = pick(prio);
      if (!id) break;
      const wait = budgetWait(prio, now);
      if (wait > 0) return wake(wait);
      fetchOne(id, false);
    }
    if (pick(prio)) return; // en attente d'une place
  }
  // Voie lente (listes longues, indexation) : une à la fois, quand rien d'autre n'attend
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
  const slowWait = lastSlowAt ? lastSlowAt + slowGap() - now : 0;
  const wait = Math.max(slowWait, budgetWait(PRIO.slow, now));
  if (wait > 0) {
    if (slowWaiting || indexSource) wake(wait);
    return;
  }
  const id = pick(PRIO.slow) || indexSource?.() || null;
  if (!id) {
    // Indexation : rien à relire maintenant, nouvel essai dans une minute
    if (indexSource) wake(60000);
    return;
  }
  if (isFresh(cache.get(id)) && !queue.has(id)) {
    // Déjà lue entre-temps (affichage, autre onglet) : on passe à la suivante
    return wake(0);
  }
  lastSlowAt = now;
  fetchOne(id, true);
}

// Quota ou vitesse modifiés dans les réglages : la file reprend tout de suite avec les nouvelles bornes
const quotaSig = () => {
  const s = settings.get();
  return `${s.priceQuotaWindow}|${s.priceQuotaBurst}|${s.priceIndexSpeed}`;
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

export async function clearPrices() {
  cache.clear();
  dirty.clear();
  await save(KEY, {});
  touch();
}

