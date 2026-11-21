// Page « Stonks » : historique de mes achats et ventes au marché, plus-value de l'achat-revente et
// cartes encore en stock. Lecture seule sur le site : rien n'y est écrit. La page s'ouvre par
// l'entrée « Stonks » du menu du site et s'affiche à la place du contenu de la page en cours
// (adresse terminée par #stonks).
//
// La table auctions n'est plus lisible (novembre 2026) : l'historique est tenu dans un journal local
// permanent (stonks-journal, par joueur), alimenté par
// - mes enchères du marché (/api/marketplace?…&mine=1 : `history` pour mes ventes, `won` pour mes
//   achats, les 50 derniers de chaque, avec rareté et version), lues par le site ou par la Toolbox ;
// - mes notifications de vente et d'achat (table notifications : carte, enchère, prix), relues
//   depuis la dernière lecture ; elles ne remontent qu'à quelques semaines, et sans rareté (celle
//   de la carte est alors reprise).
// Ce qui est vu une fois reste dans le journal, même quand le site l'oublie.
import {fetchAll, restIn} from "../api/supabase";
import {site} from "../api/site";
import {createStore} from "../lib/store";
import {readSession} from "../lib/session";
import {update, load} from "../lib/storage";
import {on} from "../lib/bus";
import {loadMyCollection} from "../state/collection";
import {loadPrices} from "../state/prices";
import {ledger, matchTrades} from "../../../../core";

const CARD_FIELDS = "id,wikipedia_title,category,rarity,image_url,wikipedia_url,hide_image";
const JOURNAL_KEY = "stonks-journal";
const NOTE_TYPES = {marketplace_auction_sold: "sell", marketplace_auction_won: "buy"};
// Au-delà, l'historique est relu à l'ouverture de la page
const MAX_AGE = 5 * 60 * 1000;
// Mes enchères du marché relues par la Toolbox au plus toutes les 10 min (le site les lit aussi)
const MINE_EVERY = 10 * 60 * 1000;

// ops : opérations appariées (core/stonks.js) ; open : achats pas encore revendus et toujours dans ma
// collection (null pendant la lecture de la collection, false si elle a échoué : openError) ;
// cards : id → carte
export const stonksState = createStore({ops: null, open: null, openError: null, cards: new Map(), loading: false, error: null, at: 0, user: null});

// --- Journal : {[joueur]: {rows: {id d'enchère: ligne}, notesSince, mineAt}}. Une ligne a la forme
// attendue par ledger() (core/stonks.js) : {id, card_id, snapshot_rarity, final_price, settled_at,
// is_shiny, seller_id, winner_id} ; snapshot_rarity null : venue d'une notification
const settled = (a) => a?.id && a.card_id && a.final_price != null && a.settled_at;
const fromAuction = (a) => ({id: a.id, card_id: a.card_id, snapshot_rarity: a.snapshot_rarity || null, final_price: a.final_price, settled_at: a.settled_at, is_shiny: Boolean(a.is_shiny), seller_id: a.seller_id || null, winner_id: a.winner_id || null});
function fromNote(n, me) {
  const side = NOTE_TYPES[n?.type];
  const d = n?.data;
  if (!side || !d?.auction_id || !d.card_id || d.final_price == null || !n.created_at) return null;
  return {id: d.auction_id, card_id: d.card_id, snapshot_rarity: null, final_price: Number(d.final_price), settled_at: n.created_at, is_shiny: false, seller_id: side === "sell" ? me : null, winner_id: side === "buy" ? me : null};
}
// Une ligne venue de mes enchères (rareté, version, date exacte) l'emporte sur celle d'une notification
function merge(rows, row) {
  const old = rows[row.id];
  if (!old || (!old.snapshot_rarity && row.snapshot_rarity)) rows[row.id] = row;
}

// Lignes de mes enchères du marché (réponse de /api/marketplace?…&mine=1)
function mineRows(data, me) {
  const sold = (data?.history || []).filter((a) => a.status === "settled_sold" && a.seller_id === me && settled(a));
  const won = (data?.won || []).filter((a) => a.winner_id === me && settled(a));
  return [...sold, ...won].map(fromAuction);
}

async function addToJournal(me, rows, patch = {}) {
  let journal = null;
  await update(JOURNAL_KEY, {}, (all) => {
    const mine = all[me] || {rows: {}, notesSince: null, mineAt: 0};
    for (const row of rows) merge(mine.rows, row);
    all[me] = {...mine, ...patch};
    journal = all[me];
    return all;
  });
  return journal;
}

// Mes enchères lues par le site (page Marché) : reprises dans le journal, historique à relire
on("marketplace", ({data, path}) => {
  const me = readSession()?.userId;
  if (!me || !path.includes("mine=1")) return;
  const rows = mineRows(data, me);
  if (rows.length) addToJournal(me, rows, {mineAt: Date.now()}).catch(() => {});
  stonksState.set({at: 0});
});
// Mes dernières notifications lues par le site
on("notifications", ({data}) => {
  const me = readSession()?.userId;
  const rows = me ? (data?.notifications || []).map((n) => fromNote(n, me)).filter(Boolean) : [];
  if (rows.length) addToJournal(me, rows).then(() => stonksState.set({at: 0}), () => {});
});

// Achats encore en stock : un achat dont l'exemplaire a quitté la collection hors du marché
// (défausse, échange) n'est plus une position ouverte. Par carte, rareté et version, les plus
// récents sont gardés, dans la limite des exemplaires possédés.
function stillOwned(open, copies) {
  const key = (cardId, rarity, shiny) => `${cardId}|${rarity || ""}|${shiny ? 1 : 0}`;
  const left = new Map();
  for (const c of copies) left.set(key(c.card_id, c.rarity, c.is_shiny), (left.get(key(c.card_id, c.rarity, c.is_shiny)) || 0) + c.count);
  return [...open]
    .sort((a, b) => b.at - a.at)
    .filter((op) => {
      const k = key(op.cardId, op.rarity, op.shiny);
      const n = left.get(k) || 0;
      if (!n) return false;
      left.set(k, n - 1);
      return true;
    });
}

export async function loadStonks({force = false} = {}) {
  const me = readSession()?.userId;
  const s = stonksState.get();
  if (!me || s.loading) return;
  if (!force && s.ops && s.user === me && Date.now() - s.at < MAX_AGE) return;
  stonksState.set({loading: true, error: null});
  try {
    const saved = (await load(JOURNAL_KEY, {}))[me] || {rows: {}, notesSince: null, mineAt: 0};
    // Mes enchères du marché, si le site ne les a pas lues récemment
    const fresh = [];
    let mineAt = saved.mineAt || 0;
    if (Date.now() - mineAt > MINE_EVERY) {
      fresh.push(...mineRows(await site.marketplaceMine(), me));
      mineAt = Date.now();
    }
    // Mes notifications de vente et d'achat depuis la dernière lecture, triées sur une clé unique
    const since = saved.notesSince ? `&created_at=gte.${encodeURIComponent(saved.notesSince)}` : "";
    const notes = await fetchAll(`notifications?select=id,type,data,created_at&user_id=eq.${me}&type=in.(${Object.keys(NOTE_TYPES).join(",")})${since}&order=created_at.asc,id.asc`, {key: "id"});
    fresh.push(...notes.map((n) => fromNote(n, me)).filter(Boolean));
    const latest = notes.reduce((m, n) => (n.created_at > m ? n.created_at : m), saved.notesSince || "");
    const journal = await addToJournal(me, fresh, {mineAt, notesSince: latest || null});
    const rows = Object.values(journal.rows);
    const cards = new Map(stonksState.get().cards);
    const missing = [...new Set(rows.map((r) => r.card_id))].filter((id) => !cards.has(id));
    for (const c of await restIn(`cards?select=${CARD_FIELDS}`, "id", missing, {retries: 3})) cards.set(c.id, {...c, image_url: c.hide_image ? null : c.image_url});
    // Rareté inconnue (notification) : celle de la carte
    const complete = rows.map((r) => (r.snapshot_rarity ? r : {...r, snapshot_rarity: cards.get(r.card_id)?.rarity || null}));
    const {ops, open} = matchTrades(ledger(complete, me));
    stonksState.set({ops, open: null, cards, at: Date.now(), user: me});
    // Positions ouvertes : selon ma collection, puis valorisées au prix du marché
    let copies;
    try {
      copies = await loadMyCollection();
    } catch (e) {
      stonksState.set({open: false, openError: e.message});
      return;
    }
    const held = stillOwned(open, copies);
    stonksState.set({open: held, openError: null});
    loadPrices(held.map((op) => ({id: op.cardId, rarity: op.rarity})));
  } catch (e) {
    stonksState.set({error: e.message});
  } finally {
    stonksState.set({loading: false});
  }
}

// --- Ouverture de la page
// Ouverte par l'entrée du menu : #stonks est ajouté à l'adresse de la page en cours (le site n'a pas
// de route pour elle), ce qui sert au bouton Retour et au rechargement. Elle est ouverte tant que
// l'adresse se termine par #stonks : Retour, ou un lien du site (même vers la page en cours), la ferme.
const HASH = "#stonks";
export const stonksPage = createStore({open: false});
export const isStonksOpen = () => stonksPage.get().open && location.hash === HASH;

export function openStonks() {
  if (location.hash !== HASH) history.pushState(null, "", HASH);
  stonksPage.set({open: true});
}

// Fermeture par un lien du site : l'adresse perd #stonks (le site ne navigue pas vers la page
// où l'on est déjà, son lien n'aurait sinon aucun effet)
export function closeStonks() {
  if (location.hash === HASH) history.replaceState(history.state, "", location.pathname + location.search);
  stonksPage.set({open: false});
}

export function startStonksRoute() {
  const sync = () => stonksPage.get().open !== (location.hash === HASH) && stonksPage.set({open: location.hash === HASH});
  addEventListener("popstate", sync);
  addEventListener("hashchange", sync);
  // Navigation du site (pushState, sans événement) : vue au changement d'adresse
  on("route", sync);
  sync();
}
