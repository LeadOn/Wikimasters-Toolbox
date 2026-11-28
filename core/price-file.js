// Export / import des prix en JSON : les prix lus sur un appareil se reprennent sur un autre, sans
// refaire l'indexation de la collection.
//
// Fichier :
//   {format: "wikimasters-toolbox/prices", version: 1, exported_at: date ISO,
//    prices: {card_id: {t: lu le (ms), c: computed_at du site ou null, s: résumé}}}
//   s : résumé de summarizeHistory (core/prices.js), {RARETÉ: {price, carried, sales, total, low,
//       high, low4, high4, change, lastSale}} ; {} pour une carte jamais vendue.
// Une entrée du cache de l'extension a la même forme, avec en plus err (lecture en échec) et partial
// (résumé provisoire tiré des dernières ventes) : ces deux-là ne sont ni exportées ni importées.
//
// Un fichier importé n'est jamais repris tel quel : chaque entrée est reconstruite champ par champ
// (champs connus seulement, types et bornes vérifiés), une entrée illisible est écartée.
"use strict";

const {RARITY_RANK, PRICE_MAX_KEEP} = require("./prices");
const {L} = require("./i18n");

const PRICES_FORMAT = "wikimasters-toolbox/prices";
const PRICES_VERSION = 1;
// Taille du fichier (caractères) et nombre de cartes acceptés : une collection de 30 000 cartes
// indexées pèse une dizaine de Mo
const MAX_PRICES_IMPORT = 50e6;
const MAX_PRICES = 200000;
const MAX_AMOUNT = 1e9;
// Identifiant de carte : lettres, chiffres et tirets (jamais « __proto__ »)
const CARD_ID = /^[A-Za-z0-9-]{1,64}$/;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const amount = (v) => finite(v) && v >= 0 && v <= MAX_AMOUNT;
const count = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_AMOUNT;

// Entrée complète : lue sans erreur, résumé définitif
const exportable = (entry) => isObject(entry) && !entry.err && !entry.partial && isObject(entry.s) && finite(entry.t) && entry.t > 0;

// entries : cache des prix, Map ou liste de [card_id, {s, c, t, err?, partial?}] → objet à
// enregistrer en JSON. Les lectures en échec et les résumés provisoires sont laissés de côté.
function exportPrices(entries, {now = Date.now()} = {}) {
  const prices = {};
  for (const [id, entry] of entries) {
    if (!CARD_ID.test(id) || !exportable(entry)) continue;
    prices[id] = {t: entry.t, c: entry.c || null, s: entry.s};
  }
  return {format: PRICES_FORMAT, version: PRICES_VERSION, exported_at: new Date(now).toISOString(), prices};
}

// Résumé d'une rareté relu champ par champ, null s'il est illisible
function cleanRarity(raw) {
  if (!isObject(raw)) return null;
  const optional = (v, ok) => v == null || ok(v);
  if (!finite(raw.price) || raw.price < 1 || raw.price > MAX_AMOUNT) return null;
  if (!count(raw.sales) || !count(raw.total)) return null;
  for (const key of ["low", "high", "low4", "high4"]) if (!optional(raw[key], amount)) return null;
  if (!optional(raw.change, (v) => finite(v) && Math.abs(v) <= MAX_AMOUNT)) return null;
  if (!optional(raw.lastSale, (v) => typeof v === "string" && DAY_KEY.test(v))) return null;
  return {
    price: Math.round(raw.price),
    carried: raw.carried === true,
    sales: raw.sales,
    total: raw.total,
    low: raw.low ?? null,
    high: raw.high ?? null,
    low4: raw.low4 ?? null,
    high4: raw.high4 ?? null,
    change: raw.change ?? null,
    lastSale: raw.lastSale ?? null,
  };
}

// Entrée d'une carte relue champ par champ, null si elle est illisible. Une date de lecture dans le
// futur (horloge de l'autre appareil en avance) est ramenée à maintenant.
function cleanEntry(raw, now) {
  if (!isObject(raw) || raw.err || raw.partial || !isObject(raw.s)) return null;
  if (!finite(raw.t) || raw.t <= 0) return null;
  const s = {};
  for (const [rarity, value] of Object.entries(raw.s)) {
    if (!Object.prototype.hasOwnProperty.call(RARITY_RANK, rarity)) return null;
    const clean = cleanRarity(value);
    if (!clean) return null;
    s[rarity] = clean;
  }
  const c = typeof raw.c === "string" && raw.c.length <= 40 && Number.isFinite(Date.parse(raw.c)) ? raw.c : null;
  return {s, c, t: Math.min(raw.t, now)};
}

// Texte JSON → {entries: Map(card_id → {s, c, t}), total, rejected, expired, exportedAt, error}.
//   total    : cartes du fichier ; rejected : entrées illisibles, écartées ;
//   expired  : entrées lues il y a plus de PRICE_MAX_KEEP (le cache les oublierait aussitôt), écartées ;
//   exportedAt : date de l'export (ms), null si absente.
function importPrices(text, {now = Date.now()} = {}) {
  const fail = (error) => ({entries: new Map(), total: 0, rejected: 0, expired: 0, exportedAt: null, error});
  if (typeof text !== "string") return fail(L("Fichier vide.", "Empty file."));
  if (text.length > MAX_PRICES_IMPORT) return fail(L("Fichier trop volumineux pour une liste de prix.", "File too large for a price list."));
  if (!text.trim()) return fail(L("Fichier vide.", "Empty file."));
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return fail(L("JSON illisible.", "Unreadable JSON."));
  }
  const notPrices = L("Ce fichier n'est pas un export de prix de la Toolbox.", "This file is not a Toolbox price export.");
  if (!isObject(data) || data.format !== PRICES_FORMAT) return fail(notPrices);
  if (!Number.isInteger(data.version) || data.version < 1) return fail(notPrices);
  if (data.version > PRICES_VERSION)
    return fail(L("Ce fichier vient d'une version plus récente de la Toolbox : mettez-la à jour sur cet appareil.", "This file comes from a newer version of the Toolbox: update it on this device."));
  if (!isObject(data.prices)) return fail(L("Aucune liste « prices » dans ce fichier.", 'No "prices" list in this file.'));
  const list = Object.entries(data.prices);
  if (list.length > MAX_PRICES) return fail(L(`Trop de cartes (${MAX_PRICES} au plus).`, `Too many cards (${MAX_PRICES} max).`));

  const entries = new Map();
  const cutoff = now - PRICE_MAX_KEEP;
  let rejected = 0;
  let expired = 0;
  for (const [id, raw] of list) {
    const entry = CARD_ID.test(id) ? cleanEntry(raw, now) : null;
    if (!entry) rejected++;
    else if (!(entry.t > cutoff)) expired++;
    else entries.set(id, entry);
  }
  const at = typeof data.exported_at === "string" ? Date.parse(data.exported_at) : NaN;
  return {entries, total: list.length, rejected, expired, exportedAt: Number.isFinite(at) ? at : null, error: null};
}

// Prix importés à reprendre : ceux d'une carte sans prix ici, ou lus plus récemment que le prix
// gardé ici ; une lecture en échec ici cède toujours la place.
// localOf(card_id) : entrée du cache, ou rien. → {apply: Map des entrées à écrire, added, updated, kept}
//   added : cartes sans prix ici ; updated : prix plus récents que les miens ; kept : les miens,
//   aussi récents ou plus récents, sont gardés.
function mergePrices(localOf, imported) {
  const apply = new Map();
  let added = 0;
  let updated = 0;
  let kept = 0;
  for (const [id, entry] of imported) {
    const local = localOf(id);
    if (local && !local.err && local.t >= entry.t) {
      kept++;
      continue;
    }
    if (local?.s) updated++;
    else added++;
    apply.set(id, entry);
  }
  return {apply, added, updated, kept};
}

module.exports = {
  PRICES_FORMAT,
  MAX_PRICES_IMPORT,
  exportPrices,
  importPrices,
  mergePrices,
};
