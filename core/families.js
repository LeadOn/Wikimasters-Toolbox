// Familles : groupes de cartes à collectionner. Manuelles (cartes choisies une à une) ou
// intelligentes (définies par une règle, remplies depuis une recherche dans le catalogue).
"use strict";

const {categorize} = require("./categorize");
const {themeSetOf, themeAliases} = require("./theme-set");
const {hasKeyword, normalize} = require("./text");
const {keywordsToPattern} = require("./profiles");
const {RARITIES, rarityRank} = require("./prices");
const {L} = require("./i18n");

// rule : {query, themes: [], keywords: "…", exclude: "…", rarities: []}
// Une carte du catalogue entre dans une famille intelligente si elle passe tous les filtres présents.
// themes : liste de thèmes du joueur (core/theme-set.js) ; par défaut, celle de core/themes.js.
function matchesFamilyRule(card, rule, {themes = null} = {}) {
  if (rule.rarities?.length && !rule.rarities.includes(card.rarity)) return false;
  const text = normalize(`${card.wikipedia_title || ""} ${card.category || ""} ${(card.summary || "").split(/\n/)[0].slice(0, 400)}`);
  const kw = keywordsToPattern(rule.keywords);
  if (kw && !hasKeyword(text, kw)) return false;
  const ex = keywordsToPattern(rule.exclude);
  if (ex && hasKeyword(text, ex)) return false;
  if (rule.themes?.length) {
    const set = themeSetOf(themes);
    const names = themeAliases(set, categorize(card, {themes: set})[0]);
    if (!rule.themes.some((t) => names.includes(t))) return false;
  }
  return true;
}

// Recherche au mot exact : le titre contient la recherche en mots entiers (« Mars » trouve « Mars »,
// « Bruno Mars », « Mars (planète) », pas « Marseille » ni « Champ-de-Mars »), sans tenir compte des
// majuscules.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function titleHasWords(title, query) {
  const q = normalize(query);
  return Boolean(q) && hasKeyword(normalize(title), escapeRegex(q));
}

// Carte réduite à ce qu'une famille conserve
// hide_image : image masquée par le site (true), visible (false) ou inconnu (null). Une carte sans
// image n'est complétée par une image de Wikimedia que si l'on sait qu'elle n'a pas été masquée.
const hidden = (v) => (v == null ? null : Boolean(v));

const compactCard = (c) => ({
  id: c.id || c.card_id,
  title: c.wikipedia_title || c.title,
  rarity: c.rarity || null,
  category: c.category || "",
  image_url: c.image_url || null,
  hide_image: hidden(c.hide_image),
});

function familyProgress(family, ownedCardIds) {
  const total = family.cards.length;
  const owned = family.cards.filter((c) => ownedCardIds.has(c.id)).length;
  return {owned, total, missing: total - owned, percent: total ? Math.round((100 * owned) / total) : 0};
}

// Ordre d'affichage des familles. "manual" : l'ordre de la liste, rangée par le joueur (glisser-
// déposer) ; "name" : alphabétique (accents et casse ignorés, nombres dans l'ordre naturel) ;
// "progress" : les plus complètes d'abord (puis le moins de cartes manquantes, puis le nom) ;
// "recent" : modifiées le plus récemment d'abord. Ne modifie pas la liste.
const FAMILY_SORTS = ["manual", "name", "progress", "recent"];
const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, {sensitivity: "base", numeric: true});
function sortFamilies(list, sort, ownedCardIds = new Set()) {
  const items = [...list];
  if (sort === "name") return items.sort(byName);
  if (sort === "recent") return items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || byName(a, b));
  if (sort === "progress") {
    const p = new Map(items.map((f) => [f.id, familyProgress(f, ownedCardIds)]));
    // Une famille vide passe après les autres (0 % sans rien à compléter)
    const rate = (f) => (p.get(f.id).total ? p.get(f.id).owned / p.get(f.id).total : -1);
    return items.sort((a, b) => rate(b) - rate(a) || p.get(a.id).missing - p.get(b.id).missing || byName(a, b));
  }
  return items;
}

// Ordre des cartes dans une famille. "manual" : l'ordre de la famille, rangée par le joueur ;
// "name" : alphabétique ; "rarity" : les plus rares d'abord ; "price" : les plus chères d'abord
// (prix du marché donné par priceOf(carte), les cartes sans prix à la fin). Ne modifie pas la liste.
const CARD_SORTS = ["manual", "name", "rarity", "price"];
const byTitle = (a, b) => String(a.title || "").localeCompare(String(b.title || ""), undefined, {sensitivity: "base", numeric: true});
function sortFamilyCards(cards, sort, {priceOf = () => null} = {}) {
  const items = [...cards];
  if (sort === "name") return items.sort(byTitle);
  if (sort === "rarity") return items.sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity) || byTitle(a, b));
  if (sort === "price") {
    const price = new Map(items.map((c) => [c.id, priceOf(c)]));
    const value = (c) => (price.get(c.id) == null ? -1 : price.get(c.id));
    return items.sort((a, b) => value(b) - value(a) || rarityRank(b.rarity) - rarityRank(a.rarity) || byTitle(a, b));
  }
  return items;
}

// Cartes d'une famille intelligente après une nouvelle recherche : celles qui y étaient déjà gardent
// la place où le joueur les a rangées, les nouvelles suivent dans l'ordre de la recherche
function keepCardOrder(previous, found) {
  const at = new Map(previous.map((c, i) => [c.id, i]));
  const kept = found.filter((c) => at.has(c.id)).sort((a, b) => at.get(a.id) - at.get(b.id));
  return [...kept, ...found.filter((c) => !at.has(c.id))];
}

// Déplace l'élément d'identifiant `id` à la position `to` (bornée) ; même liste si rien ne change
function moveItem(list, id, to) {
  const from = list.findIndex((x) => x.id === id);
  if (from < 0) return list;
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (target === from) return list;
  const items = [...list];
  const [item] = items.splice(from, 1);
  items.splice(target, 0, item);
  return items;
}

// Charge utile d'un code de partage (sans possessions)
function familyToShare(family) {
  return {
    v: 1,
    name: family.name,
    kind: family.kind,
    rule: family.kind === "smart" ? family.rule : undefined,
    // 6e valeur : image masquée (1), visible (0), inconnue (absente) ; ignorée par les anciennes versions
    cards: family.cards.map((c) => [c.id, c.title, c.rarity || "", c.category || "", c.image_url || "", ...(c.hide_image == null ? [] : [c.hide_image ? 1 : 0])]),
    cover: family.cover || null,
  };
}

// Le code vient d'un autre joueur : chaque champ est vérifié et ramené au format attendu.
const text = (v, max = 500) => (typeof v === "string" ? v.slice(0, max) : "");
const httpUrl = (v) => (typeof v === "string" && /^https?:\/\//i.test(v) ? v : null);
const stringList = (v, allowed) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && (!allowed || allowed.includes(x))) : []);

function familyFromShare(payload) {
  const name = text(payload?.name, 80).trim();
  if (!name || !Array.isArray(payload.cards)) throw new Error(L("Code de famille illisible.", "Unreadable family code."));
  const cards = [];
  const seen = new Set();
  for (const entry of payload.cards) {
    if (!Array.isArray(entry)) continue;
    const [id, title, rarity, category, image_url, hideImage] = entry;
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    cards.push({id, title: text(title), rarity: RARITIES.includes(rarity) ? rarity : null, category: text(category), image_url: httpUrl(image_url), hide_image: hideImage === 1 ? true : hideImage === 0 ? false : null});
  }
  const smart = payload.kind === "smart";
  const rule = smart && payload.rule && typeof payload.rule === "object" ? payload.rule : null;
  return {
    name,
    kind: smart ? "smart" : "manual",
    rule: rule && {
      query: text(rule.query, 200),
      keywords: text(rule.keywords, 2000),
      exclude: text(rule.exclude, 2000),
      themes: stringList(rule.themes),
      rarities: stringList(rule.rarities, RARITIES),
    },
    cards,
    cover: typeof payload.cover === "string" && seen.has(payload.cover) ? payload.cover : null,
  };
}

module.exports = {matchesFamilyRule, titleHasWords, compactCard, familyProgress, FAMILY_SORTS, sortFamilies, CARD_SORTS, sortFamilyCards, keepCardOrder, moveItem, familyToShare, familyFromShare};
