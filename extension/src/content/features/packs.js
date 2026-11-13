// Paquets : récapitulatif, statistiques de tirage et « Tout ouvrir » (sur clic, après confirmation).
import {site} from "../api/site";
import {restIn} from "../api/supabase";
import {withLock} from "../lib/locks";
import {createStore} from "../lib/store";
import {persistentStore} from "../lib/storage";
import {on, emit} from "../lib/bus";
import {sleep, HumanCheckError} from "../lib/http";
import {isOn} from "../state/settings";
import {owned, addOwned, removeOwned, invalidateCollection, discardCopy} from "../state/collection";
import {loadPrices} from "../state/prices";
import {packNovelty} from "../../../../core/prices";
import {sortPulledCards} from "./autosort";
import {L} from "../../shared/i18n";

export const packsStatus = createStore({remaining: null, at: 0});
// Récapitulatif du dernier paquet, affiché dans la page (pas de fenêtre) :
// phase "revealing" : le site révèle les cartes une à une, le récapitulatif attend la dernière ;
// phase "ready"     : toutes les cartes ont été vues (ou paquets ouverts sans animation).
// source "reveal" : paquet ouvert sur le site (le récapitulatif disparaît au retour sur l'accueil) ;
// source "openAll" : « Tout ouvrir », sans révélation (il reste sur l'accueil jusqu'au paquet suivant).
// sort : tri automatique des cartes tirées (option) — {status: "running"|"done"|"error", byIndex, error}
// cards[i].action : ce que le joueur en a fait depuis le récapitulatif — {kind: "discarded"},
// {kind: "listed", baseAmount, durationMinutes}, ou {kind: "uncertain", what: "discard"|"sell"} (sans réponse du site)
export const recapState = createStore({cards: [], packs: 0, at: 0, phase: null, source: null, pricesLoading: false, dismissed: false, sort: null});

// Dernier récapitulatif gardé dans le stockage de l'extension : après un rechargement de la page
// (ou du navigateur), il revient sur l'écran d'ouverture (« Paquet précédent ») jusqu'au paquet
// suivant ou à sa fermeture. Seuls les champs affichés ou utiles au classement sont gardés (résumé
// tronqué), pour qu'un « Tout ouvrir » de centaines de cartes reste léger.
const KEPT_FIELDS = ["id", "user_card_id", "wikipedia_title", "wikipedia_url", "category", "image_url", "hide_image", "rarity", "is_shiny", "lang", "atk", "def", "q_score", "pageviews", "isNew", "action"];
const SUMMARY_MAX = 600;
export const lastRecap = persistentStore("lastRecap", {cards: [], packs: 0, at: 0, source: null, dismissed: false, sort: null});

export function recapSnapshot(r) {
  const cards = r.cards.map((c) => {
    const kept = Object.fromEntries(KEPT_FIELDS.filter((k) => c[k] !== undefined).map((k) => [k, c[k]]));
    if (c.summary) kept.summary = String(c.summary).slice(0, SUMMARY_MAX);
    return kept;
  });
  // Le tri automatique en cours ne reprendra pas : seul son résultat est gardé
  const sort = r.sort?.status === "done" ? r.sort : null;
  return {cards, packs: r.packs, at: r.at, source: r.source, dismissed: Boolean(r.dismissed), sort};
}

// Récapitulatif repris au chargement de la page, s'il n'y en a pas déjà un (paquet ouvert entre-temps)
export function restoreRecap(saved) {
  if (!saved?.cards?.length || recapState.get().cards.length) return false;
  // Rechargé pendant la révélation : le site l'a abandonnée, le récapitulatif s'affiche directement
  recapState.set({...saved, phase: "ready", pricesLoading: true});
  // Rechargé avant la fin du calcul des nouveautés : il est refait (même résultat, le paquet compté une fois)
  if (saved.cards.some((c) => c.isNew == null)) markNovelty(saved.at, saved.cards);
  loadPrices(saved.cards.map((c) => ({id: c.id, rarity: c.rarity})))
    .catch(() => {})
    .finally(() => {
      if (recapState.get().at === saved.at) recapState.set({pricesLoading: false});
    });
  return true;
}

let lastSaved = "";
function saveRecap(r) {
  // Un autre onglet a gardé un paquet plus récent : on ne l'écrase pas avec un ancien
  if (!r.cards.length || r.at < lastRecap.get().at) return;
  const snapshot = recapSnapshot(r);
  const key = JSON.stringify(snapshot);
  if (key === lastSaved) return;
  lastSaved = key;
  lastRecap.set(() => snapshot);
}

// Répartition des raretés de toute ma collection (/api/my-collection/stats), pour le graphique des taux
export const collectionRarity = persistentStore("collectionRarity", {counts: {}, total: 0, at: 0});
const setCollectionRarity = (data) =>
  data?.rarityCounts && Object.keys(data.rarityCounts).length && collectionRarity.set({counts: data.rarityCounts, total: Number(data.total) || 0, at: Date.now()});
on("my-collection-stats", ({data}) => setCollectionRarity(data));
// Relue au plus toutes les 30 min ; en cas d'échec (route souvent lente ou en erreur), nouvel essai après 2 min
let lastRarityAttempt = 0;
export async function refreshCollectionRarity() {
  if (Date.now() - collectionRarity.get().at < 30 * 60 * 1000 || Date.now() - lastRarityAttempt < 2 * 60 * 1000) return;
  lastRarityAttempt = Date.now();
  try {
    setCollectionRarity(await site.myCollectionStats());
  } catch {}
}
// « Tout ouvrir » : opened = paquets ouverts, total = paquets à ouvrir (ouverts + restants, null si
// inconnu), batches = cartes de chaque paquet dans l'ordre d'ouverture (isNew : estimation avec la
// collection en mémoire, affinée ensuite par le récapitulatif), stopping = arrêt demandé par le joueur
// après le paquet en cours. Montré pendant l'ouverture par ui/OpenAllStage.jsx.
export const openAllState = createStore({running: false, opened: 0, total: null, batches: [], stopping: false, error: null});
// today : tirages du jour (date locale du navigateur), remis à zéro au premier paquet d'un autre jour
export const pullStats = persistentStore("pullStats", {since: Date.now(), packs: 0, cards: 0, byRarity: {}, today: null});

// Jour local d'une date, « AAAA-MM-JJ »
export const dayKey = (date = new Date()) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const NO_PULLS = {packs: 0, cards: 0, byRarity: {}};
// Tirages du jour de `now` : ceux gardés s'ils datent de ce jour, sinon aucun
export const todayPulls = (stats, now = Date.now()) => (stats?.today?.day === dayKey(now) ? stats.today : {day: dayKey(now), ...NO_PULLS});
// Statistiques après un paquet (ou un « Tout ouvrir ») : depuis le début et pour le jour de `now`
export function addPulls(stats, cards, packs = 1, now = Date.now()) {
  const add = (s) => {
    const byRarity = {...s.byRarity};
    for (const c of cards) byRarity[c.rarity] = (byRarity[c.rarity] || 0) + 1;
    return {packs: s.packs + packs, cards: s.cards + cards.length, byRarity};
  };
  return {...stats, ...add(stats), today: {day: dayKey(now), ...add(todayPulls(stats, now))}};
}
// En dessous de ce nombre de cartes tirées, la répartition de la collection estime mieux les taux de drop
export const MIN_PULLED = 50;
// Nombre de cartes par rareté qui estime le mieux les taux de drop (mes tirages, sinon ma collection)
export function dropCounts() {
  const stats = pullStats.get();
  const coll = collectionRarity.get();
  return stats.cards >= MIN_PULLED || !coll.total ? stats.byRarity : coll.counts;
}

on("packs-status", ({data}) => typeof data?.packs_remaining === "number" && packsStatus.set({remaining: data.packs_remaining, at: Date.now()}));

// Cartes d'un paquet → statistiques, récapitulatif, proposition de tri
function handleOpened(cards, {packs = 1, wasOwned, revealing = false}) {
  if (isOn("pullStats")) pullStats.set((s) => addPulls(s, cards, packs));
  // Sans collection connue (jamais chargée), on ne sait pas quelles cartes sont nouvelles
  const known = owned.get().loadedAt > 0;
  const enriched = cards.map((c) => ({...c, isNew: known ? !wasOwned.has(c.id) : null}));
  const at = Date.now();
  const autoSort = isOn("autoSortPulls");
  recapState.set({cards: enriched, packs, at, phase: revealing ? "revealing" : "ready", source: revealing ? "reveal" : "openAll", pricesLoading: true, dismissed: false, sort: autoSort ? {status: "running"} : null});
  // Tri automatique pendant la révélation : seuls les exemplaires tirés sont classés
  if (autoSort)
    sortPulledCards(cards)
      .then((res) => recapState.get().at === at && recapState.set({sort: {status: "done", byIndex: res.byIndex}}))
      .catch((e) => recapState.get().at === at && recapState.set({sort: {status: "error", error: e.message || String(e)}}));
  markNovelty(at, cards);
  // Prix chargés tout de suite, pendant que le joueur découvre ses cartes
  loadPrices(cards.map((c) => ({id: c.id, rarity: c.rarity}))).finally(() => {
    if (recapState.get().at === at) recapState.set({pricesLoading: false});
  });
  emit("cards-added", {count: cards.length, recap: isOn("packRecap"), sorted: autoSort});
}

// Nouveautés exactes : une carte est un doublon si je possède plus d'exemplaires que le paquet
// n'en apporte (une requête pour tout le paquet, la collection en mémoire peut être absente ou ancienne).
async function markNovelty(at, cards) {
  try {
    const rows = await restIn("user_cards?select=card_id,count", "card_id", cards.map((c) => c.id), {retries: 3});
    const copies = new Map();
    for (const r of rows) copies.set(r.card_id, (copies.get(r.card_id) || 0) + Math.max(1, Number(r.count) || 1));
    const novelty = packNovelty(cards, copies);
    const updated = cards.map((c, i) => ({...c, isNew: novelty[i]}));
    if (recapState.get().at === at) recapState.set({cards: updated});
  } catch {
    // Sans réponse, on garde l'estimation faite avec la collection en mémoire
  }
}

// --- Actions sur une carte du récapitulatif, déclenchées par un clic du joueur après confirmation.
// at : identifiant du récapitulatif, pour ne pas modifier celui d'un paquet ouvert entre-temps.
function setCardAction(at, index, action) {
  if (recapState.get().at !== at) return;
  recapState.set((s) => ({...s, cards: s.cards.map((c, i) => (i === index ? {...c, action} : c))}));
}

// Défausse l'exemplaire tiré contre 1 WikiBidou. Si le tri automatique des cartes tirées est en
// cours, la défausse attend qu'il ait fini d'étiqueter cet exemplaire (discardCopy).
export async function discardPulled(at, index) {
  // Récapitulatif remplacé par un autre paquet : l'index désignerait une autre carte
  if (recapState.get().at !== at) throw new Error(L("Un autre paquet a été ouvert entre-temps : rien n'a été défaussé.", "Another pack was opened in the meantime: nothing was discarded."));
  const card = recapState.get().cards[index];
  if (!card?.user_card_id) throw new Error(L("Exemplaire introuvable : défaussez cette carte depuis votre collection.", "Copy not found: discard this card from your collection."));
  try {
    await discardCopy(card.user_card_id);
  } catch (e) {
    if (e.uncertain) setCardAction(at, index, {kind: "uncertain", what: "discard"});
    throw e;
  }
  setCardAction(at, index, {kind: "discarded"});
  const otherCopy = recapState.get().cards.some((c, i) => i !== index && c.id === card.id && c.action?.kind !== "discarded");
  if (card.isNew === true && !otherCopy) removeOwned([card.id]);
}

// Défausse les exemplaires cochés, l'un après l'autre, et s'arrête à la première erreur : une
// défausse refusée ou sans réponse n'est jamais rejouée. onProgress(n) après chaque défausse.
// L'erreur porte le nombre de cartes déjà défaussées (e.discarded).
export async function discardPulledMany(at, indexes, onProgress) {
  let done = 0;
  for (const index of indexes) {
    try {
      await discardPulled(at, index);
    } catch (e) {
      e.discarded = done;
      throw e;
    }
    done++;
    onProgress?.(done);
  }
  return done;
}

// Résultat de la fenêtre de mise aux enchères (ui/SellDialog.jsx)
export const markListed = (at, index, sale) => sale && setCardAction(at, index, sale.uncertain ? {kind: "uncertain", what: "sell"} : {kind: "listed", ...sale});

// Le site a fini de révéler les cartes (bouton « Continuer ») : le récapitulatif peut s'afficher
export const markRevealed = () => recapState.get().phase === "revealing" && recapState.set({phase: "ready"});
export const dismissRecap = () => recapState.set({dismissed: true});

// Exemplaires tirés par le dernier « Tout ouvrir ». Quand le script de contenu partage le fetch de
// la page (injection de test), le hook voit aussi ces réponses, parfois après la fin de « Tout
// ouvrir » : elles ne doivent ni remplacer son récapitulatif ni compter deux fois dans les statistiques.
let openedByAll = new Set();

// Paquet ouvert par le joueur sur le site (réponse observée)
on("pack-opened", ({data, method}) => {
  if (method !== "POST" || !Array.isArray(data?.cards) || !data.cards.length) return;
  if (typeof data.packs_remaining === "number") packsStatus.set({remaining: data.packs_remaining, at: Date.now()});
  if (openAllState.get().running || data.cards.every((c) => openedByAll.has(c.user_card_id))) return;
  const wasOwned = new Set(owned.get().ids);
  addOwned(data.cards.map((c) => c.id));
  // Le site anime l'ouverture : le récapitulatif attend la dernière carte
  handleOpened(data.cards, {wasOwned, revealing: true});
});

// Le site refuse deux ouvertures à moins de 2 s d'écart : 429 « Ouverture trop rapide » avec
// {rate_limited, rate_limit_daily, retry_after (date)}, sans consommer de paquet. « Tout ouvrir »
// espace donc ses ouvertures et, après un tel refus, attend l'heure indiquée avant de redemander
// le même paquet. Limite quotidienne (rate_limit_daily) : arrêt.
const PACK_INTERVAL = 2200;
const RATE_LIMIT_RETRIES = 5;

// Attente demandée par un refus « trop rapide » (ms), ou null si l'erreur n'en est pas un
export function rateLimitWait(e, now = Date.now()) {
  if (e?.status !== 429 || e.data?.rate_limit_daily) return null;
  const until = Date.parse(e.data?.retry_after);
  return Number.isFinite(until) ? Math.min(60000, Math.max(1000, until - now + 300)) : PACK_INTERVAL;
}

async function openPackPolitely() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await site.openPack();
    } catch (e) {
      const wait = rateLimitWait(e);
      if (wait == null || attempt >= RATE_LIMIT_RETRIES) throw e;
      await sleep(wait);
    }
  }
}

// Ouvre tous les paquets disponibles, un par un, et s'arrête à la première erreur
// (dont une vérification anti-robot demandée par le site, à faire par le joueur).
export async function openAllPacks() {
  return withLock("packs", async () => {
    const remaining = packsStatus.get().remaining;
    openAllState.set({running: true, opened: 0, total: remaining || null, batches: [], stopping: false, error: null});
    const wasOwned = new Set(owned.get().ids);
    // Cartes déjà vues (collection + paquets précédents de cette ouverture), pour signaler les nouvelles
    const known = owned.get().loadedAt > 0;
    const seen = new Set(wasOwned);
    const all = [];
    let packs = 0;
    openedByAll = new Set();
    try {
      for (let guard = 0; guard < 100 && !openAllState.get().stopping; guard++) {
        const res = await openPackPolitely();
        // Réponse sans cartes (erreur rendue en 200, format changé) : on s'arrête sans rien supposer
        if (!Array.isArray(res?.cards) || !res.cards.length) throw new Error(res?.error ? String(res.error) : L("réponse du site sans cartes", "site response without cards"));
        packs++;
        all.push(...res.cards);
        for (const c of res.cards) if (c.user_card_id) openedByAll.add(c.user_card_id);
        const batch = res.cards.map((c) => {
          const isNew = known ? !seen.has(c.id) : null;
          seen.add(c.id);
          return {...c, isNew};
        });
        const total = typeof res.packs_remaining === "number" ? packs + res.packs_remaining : openAllState.get().total;
        openAllState.set((s) => ({...s, opened: packs, total, batches: [...s.batches, batch]}));
        // Prix lus dès l'arrivée du paquet, pour les montrer sur la scène pendant la révélation
        loadPrices(res.cards.map((c) => ({id: c.id, rarity: c.rarity}))).catch(() => {});
        if (typeof res.packs_remaining === "number") packsStatus.set({remaining: res.packs_remaining, at: Date.now()});
        if (!res.packs_remaining) break;
        await sleep(PACK_INTERVAL);
      }
    } catch (e) {
      // Message du site s'il en donne un (limite quotidienne, plus de paquet…)
      const reason = e.data?.error || e.message;
      openAllState.set({
        error:
          e instanceof HumanCheckError
            ? L(
                `Arrêt après ${packs} paquet(s) : WikiMasters demande une vérification anti-robot. Ouvrez le paquet suivant avec le bouton « Ouvrir » du site, qui l'affiche, puis relancez « Tout ouvrir ».`,
                `Stopped after ${packs} pack(s): WikiMasters is asking for a bot check. Open the next pack with the site's "Ouvrir" button, which shows it, then run "Open all" again.`,
              )
            : L(`Arrêt après ${packs} paquet(s) : ${reason}`, `Stopped after ${packs} pack(s): ${reason}`),
      });
    } finally {
      openAllState.set({running: false, stopping: false});
      if (all.length) {
        // Ces ouvertures ne passent pas par la page : la collection en mémoire n'est plus à jour
        invalidateCollection();
        addOwned(all.map((c) => c.id));
        handleOpened(all, {packs, wasOwned});
      }
    }
    return {packs, cards: all.length};
  });
}

// Arrêt demandé par le joueur : le paquet en cours se termine, aucun autre n'est ouvert
export const stopOpenAll = () => openAllState.get().running && openAllState.set({stopping: true});

// Garde le récapitulatif à chaque changement (cartes, nouveautés, défausses, ventes, tri terminé,
// fermeture), et le reprend une fois le stockage lu
lastRecap.ready.then(() => {
  restoreRecap(lastRecap.get());
  recapState.subscribe(saveRecap);
});

export const resetPullStats = () => pullStats.set({since: Date.now(), packs: 0, cards: 0, byRarity: {}, today: null});
