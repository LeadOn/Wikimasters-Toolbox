// Nouveautés : journal des versions écrit pour les joueurs (extension/changelog.json), versions pas
// encore vues, options apparues récemment et liens vers le guide de l'utilisateur.
import changelog from "../../../changelog.json";
import {persistentStore, keysWithPrefix} from "../lib/storage";
import {LANG} from "../../shared/i18n";

// Versions, la plus récente en premier
export const CHANGELOG = changelog.releases;

const tr = (t) => (LANG === "en" ? t.en : t.fr);

// Libellés des rubriques d'une nouveauté (champ `area`)
export const AREAS = Object.fromEntries(Object.entries(changelog.areas).map(([k, t]) => [k, tr(t)]));

export const itemText = tr;

// Comparaison de deux versions x.y.z (négatif : a avant b)
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

// Versions publiées jusqu'à la version installée (le journal peut déjà décrire la suivante)
export const releases = (current = __VERSION__, log = CHANGELOG) => log.filter((r) => compareVersions(r.version, current) <= 0);

// Versions installées depuis la dernière visite de l'onglet Nouveautés
export const unseenReleases = (seen, current = __VERSION__, log = CHANGELOG) => releases(current, log).filter((r) => !seen || compareVersions(r.version, seen) > 0);

// Options (clés de FEATURES) citées par les deux dernières versions mineures : « Nouveau » dans les réglages
export function recentFeatures(current = __VERSION__, log = CHANGELOG, minors = 2) {
  const minor = (v) => v.split(".").slice(0, 2).join(".");
  const list = releases(current, log);
  const keep = [...new Set(list.map((r) => minor(r.version)))].slice(0, minors);
  return new Set(list.filter((r) => keep.includes(minor(r.version))).flatMap((r) => r.items.map((i) => i.feature).filter(Boolean)));
}

// seen : dernière version dont le joueur a vu les nouveautés ; notified : dernière version annoncée
// par un message ; welcome : bloc d'accueil d'une nouvelle installation, jusqu'à ce qu'il le masque
export const news = persistentStore("news", {seen: null, notified: null, welcome: false});

// Premier lancement avec les Nouveautés. Nouvelle installation (rien d'enregistré) : rien à signaler,
// bloc d'accueil. Mise à jour depuis une version qui ne les avait pas : seule la version installée est
// signalée, les précédentes restent consultables dans l'onglet.
export async function initNews(current = __VERSION__, log = CHANGELOG) {
  await news.ready;
  if (news.get().seen) return news.get();
  const existing = (await keysWithPrefix("")).some((k) => k !== "news");
  const previous = log.find((r) => compareVersions(r.version, current) < 0)?.version || "0.0.0";
  news.set(existing ? {seen: previous} : {seen: current, notified: current, welcome: true});
  return news.get();
}

export const hasNews = (state = news.get()) => Boolean(state.seen) && unseenReleases(state.seen).length > 0;
export const markSeen = () => news.set({seen: __VERSION__});

// Guide de l'utilisateur (en français) : section qui décrit chaque onglet du panneau.
// Ancres des titres de docs/guide.md telles que GitHub les calcule (vérifiées par les tests).
export const GUIDE_URL = "https://github.com/LeadOn/Wikimasters-Toolbox/blob/main/docs/guide.md";
export const GUIDE_ANCHORS = {
  sort: "tri",
  profiles: "profils",
  trades: "échanges",
  prices: "prix",
  market: "marché",
  packs: "paquets",
  families: "familles",
  images: "images",
  achievements: "succès",
  settings: "réglages-1",
  news: "nouveautés",
};
export const guideUrl = (tab) => (GUIDE_ANCHORS[tab] ? `${GUIDE_URL}#${GUIDE_ANCHORS[tab]}` : GUIDE_URL);
