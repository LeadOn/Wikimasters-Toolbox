// Routes /api du site WikiMasters (authentifiées par les cookies de session, même origine).
// Voir docs/site-api.md. Les lectures sont réessayées ; les écritures jamais automatiquement.
import { request, createLimiter, AutomationBlockedError } from "../lib/http";
import { emit } from "../lib/bus";
import { L } from "../../shared/i18n";

export const SITE_DELAY = 120;
const limit = createLimiter(3, SITE_DELAY);

// Refus du site pour automatisation (lib/http.js) : plus aucune lecture n'est envoyée jusqu'au
// rechargement de la page (les lectures en attente échouent sans requête), et le joueur est prévenu
// une fois. Ses propres actions (écritures, sur clic) restent possibles : le site en reste juge.
let blocked = null;
export const siteBlocked = () => blocked;
const noteBlock = (e) => {
  if (e instanceof AutomationBlockedError && !blocked) {
    blocked = e;
    emit("site-blocked", { message: e.message });
  }
  throw e;
};

// localBlock : un refus pour automatisation ne vaut que pour cette route (prix : limite propre à la
// route, gérée par state/prices.js) ; les autres lectures du site continuent.
// priority : lecture déclenchée par une action directe du joueur (paquet ouvert, fiche de carte) —
// part tout de suite sans attendre derrière la file des lectures de fond.
export const siteGet = (path, { localBlock = false, priority = false, ...opts } = {}) => {
  const run = () => {
    if (blocked) throw blocked;
    return request(path, { ...opts, credentials: "include" });
  };
  return (priority ? run() : limit(run)).catch(localBlock ? (e) => Promise.reject(e) : noteBlock);
};

const sitePost = (path, body, opts = {}) =>
  request(path, {
    method: "POST",
    credentials: "include",
    ...(body !== undefined && { body, headers: { "content-type": "application/json" } }),
    ...opts,
  }).catch(noteBlock);

const qs = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    for (const item of [].concat(v)) q.append(k, String(item));
  }
  return q.toString();
};

export const site = {
  friends: () => siteGet("/api/friends"),
  // 50 cartes par page (~300 ms depuis novembre 2026, jusqu'à 30 s avant)
  profileCollection: (username, page, { rarities = [], stats = false, signal } = {}) =>
    siteGet(
      `/api/profile/${encodeURIComponent(username)}/collection?${qs({ page, sort: "rarity", stats: stats ? 1 : 0, pending: 1, rarity: rarities })}`,
      { timeout: 90000, retries: 8, signal },
    ),
  myCollectionStats: () => siteGet("/api/my-collection/stats?sort=rarity"),
  searchCards: ({ q, page = 0, rarities = [], sort = "rarity", signal } = {}) =>
    siteGet(`/api/cards?${qs({ page, q, sort, rarity: rarities })}`, { signal }),
  // Historique des ventes d'une carte, toutes raretés : {computed_at, by_rarity: {R: {weekly, monthly}}}
  // (onglet Marché de la fiche ; recalculé par le site au fil de la journée, gardé 5 min en cache)
  // Limitée en volume par compte : refus « automation_limit » propre à cette route (localBlock)
  priceHistory: (cardId, { retries, signal, priority } = {}) => siteGet(`/api/marketplace/cards/${encodeURIComponent(cardId)}/price-history`, { retries, signal, priority, localBlock: true }),
  // 5 dernières ventes conclues d'une carte (onglet Marché de la fiche) : {recent: [{id, final_price, settled_at, rarity}]}.
  // Sans rarity, renvoie les 5 dernières ventes toutes raretés confondues (donc tout l'historique si < 5 ventes).
  cardSales: (cardId, { rarity, retries, signal } = {}) =>
    siteGet(`/api/marketplace/cards/${encodeURIComponent(cardId)}/sales${rarity ? `?${qs({ rarity })}` : ""}`, { retries, signal, localBlock: true }),
  // Marché : 50 enchères par page, seule taille acceptée (une autre valeur de limit est refusée comme
  // automatisation) ; sort parmi les valeurs du site (recent, price_asc, price_desc, ending_soon)
  marketplaceSearch: ({ q, page = 1, rarities = [], sort = "recent" } = {}) => siteGet(`/api/marketplace?${qs({ page, limit: 50, sort, q, rarity: rarities })}`),
  marketplaceMine: () => siteGet("/api/marketplace?page=1&limit=50&sort=recent&mine=1"),
  marketplaceQuota: () => siteGet("/api/marketplace/mine"),
  auction: (id) => siteGet(`/api/marketplace/${id}`),
  wikibidous: () => siteGet("/api/wikibidous"),
  trades: () => siteGet("/api/trades"),
  // Synchronisation des succès (appelée par la page Succès du site à chaque visite) : débloque les
  // succès atteints, renvoie {unlocked, progress: [{code, current, target}]}
  achievementsCheck: () => sitePost("/api/achievements/check", { event: "achievements_sync" }),
  // Écritures : chacune est déclenchée par un clic du joueur
  // Malgré son nom, card_id attend l'id de l'EXEMPLAIRE (user_cards.id), comme le formulaire du site
  createAuction: ({ userCardId, baseAmount, durationMinutes }) =>
    sitePost("/api/marketplace", { card_id: userCardId, base_amount: baseAmount, duration_minutes: durationMinutes }),
  bid: (auctionId, amount) => sitePost(`/api/marketplace/${auctionId}/bid`, { amount }),
  // Défausse d'un exemplaire (id de user_cards) contre 1 WikiBidou ; refusée pour un favori ou une carte en échange
  discard: (userCardId) => sitePost(`/api/user-cards/${encodeURIComponent(userCardId)}/discard`),
  // Récompense d'un succès débloqué : {claimed_at, amount} ou {already_claimed}
  claimAchievement: (achievementId) => sitePost("/api/achievements/claim", { achievement_id: achievementId }),
  openPack: () => sitePost("/api/packs/open", undefined, { timeout: 60000 }),
};

export const AUCTION_DURATIONS = [
  { minutes: 10, label: "10 min" },
  { minutes: 30, label: "30 min" },
  { minutes: 60, label: L("1 h", "1 hour") },
  { minutes: 180, label: L("3 h", "3 hours") },
  { minutes: 360, label: L("6 h", "6 hours") },
  { minutes: 720, label: L("12 h", "12 hours") },
];
