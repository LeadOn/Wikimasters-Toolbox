// Étiquettes et favori des exemplaires tirés, en un clic (à côté de la carte pendant la révélation,
// et dans le récapitulatif du paquet). Option « revealTags ».
// - les étiquettes et l'étoile des exemplaires du dernier paquet sont relues à chaque paquet, puis
//   à la fin du tri automatique des cartes tirées ;
// - un clic ajoute ou retire une étiquette (core/tag-writer.js, verrou « sort ») ; une carte n'a
//   qu'un thème : en choisir un autre retire l'ancien, après l'ajout ;
// - l'étoile passe par le bouton du site quand la carte est affichée par la révélation (le site
//   garde ainsi son état), sinon par la base, comme le fait le site (user_cards.starred).
import {rest, restIn, tagClient} from "../api/supabase";
import {ensureSession} from "../lib/session";
import {withLock} from "../lib/locks";
import {createStore} from "../lib/store";
import {persistentStore} from "../lib/storage";
import {isOn} from "../state/settings";
import {isTheme, tagColor} from "../state/themes";
import {invalidateCollection} from "../state/collection";
import {ensureTags, insertLinks} from "../../../../core";
import {recapState} from "./packs";
import {L} from "../../shared/i18n";

const PERSONAL_COLOR = "#64748b";
const RECENT_MAX = 8;
export const TAG_NAME_MAX = 40;

// status : "idle" | "loading" | "ready" | "error" ; tags : étiquettes du joueur [{id, name, color}] ;
// links : {userCardId: [noms]} ; starred : {userCardId: bool} ; busy : {userCardId: true} pendant une écriture
export const pulledTags = createStore({at: 0, status: "idle", error: null, tags: [], links: {}, starred: {}, busy: {}});
// Étiquettes posées en un clic, la plus récente d'abord : proposées en premier
export const recentTags = persistentStore("recentTags", {names: []});

let loadedKey = "";
let edits = 0; // écritures faites pendant une lecture : son résultat serait périmé

const copiesOf = (r) => [...new Set(r.cards.map((c) => c.user_card_id).filter(Boolean))];

async function load() {
  const r = recapState.get();
  const ids = copiesOf(r);
  // Pendant le tri automatique, on attend sa fin (une seule lecture, déjà triée)
  if (!isOn("revealTags") || !ids.length || r.sort?.status === "running") return;
  const key = `${r.at}:${r.sort?.status || ""}`;
  if (key === loadedKey) return;
  loadedKey = key;
  const startEdits = edits;
  if (pulledTags.get().at !== r.at) pulledTags.set({at: r.at, status: "loading", error: null, links: {}, starred: {}, busy: {}});
  try {
    const session = await ensureSession();
    const [tags, links, copies] = await Promise.all([
      rest(`tags?select=id,name,color&user_id=eq.${session.userId}`, {retries: 3}),
      restIn("user_card_tags?select=user_card_id,tag_id", "user_card_id", ids, {retries: 3}),
      restIn("user_cards?select=id,starred", "id", ids, {retries: 3}),
    ]);
    if (recapState.get().at !== r.at || edits !== startEdits) return;
    const nameOf = new Map(tags.map((t) => [t.id, t.name]));
    const byCopy = Object.fromEntries(ids.map((id) => [id, []]));
    for (const l of links) if (nameOf.has(l.tag_id)) byCopy[l.user_card_id]?.push(nameOf.get(l.tag_id));
    pulledTags.set({at: r.at, status: "ready", error: null, tags, links: byCopy, starred: Object.fromEntries(copies.map((c) => [c.id, Boolean(c.starred)]))});
  } catch (e) {
    if (recapState.get().at !== r.at) return;
    loadedKey = "";
    pulledTags.set({status: "error", error: e.message || String(e)});
  }
}

export const reloadPulledTags = () => {
  loadedKey = "";
  load();
};

recapState.subscribe(() => load());

export const tagColorOf = (name, tags = pulledTags.get().tags) => (isTheme(name) ? tagColor(name) : tags.find((t) => t.name === name)?.color || PERSONAL_COLOR);

const setBusy = (id, on) => pulledTags.set((s) => ({...s, busy: {...s.busy, [id]: on || undefined}}));

function remember(name) {
  recentTags.set((s) => ({names: [name, ...s.names.filter((n) => n !== name)].slice(0, RECENT_MAX)}));
}

// Ajoute (on) ou retire une étiquette d'un exemplaire tiré, sur clic du joueur
export async function toggleTag(userCardId, rawName, on) {
  const name = String(rawName || "").trim();
  if (!userCardId || !name) return;
  if (name.length > TAG_NAME_MAX) throw new Error(L(`Nom d'étiquette trop long (${TAG_NAME_MAX} caractères au plus).`, `Tag name too long (${TAG_NAME_MAX} characters at most).`));
  if (pulledTags.get().busy[userCardId]) return;
  edits++;
  setBusy(userCardId, true);
  try {
    await withLock(
      "sort",
      async () => {
        const session = await ensureSession();
        const client = tagClient(session.userId);
        const known = pulledTags.get().tags;
        const have = pulledTags.get().links[userCardId] || [];
        if (on) {
          const color = tagColorOf(name, known);
          const ids = await ensureTags(client, {[name]: color}, {known});
          const tagId = ids.get(name);
          if (!known.some((t) => t.id === tagId)) pulledTags.set((s) => ({...s, tags: [...s.tags, {id: tagId, name, color}]}));
          await insertLinks(client, [{user_card_id: userCardId, tag_id: tagId}]);
          // Un seul thème par carte : l'ancien est retiré après l'ajout (au pire, deux thèmes un instant)
          const replaced = isTheme(name) ? have.filter((n) => n !== name && isTheme(n)) : [];
          const idOf = new Map(pulledTags.get().tags.map((t) => [t.name, t.id]));
          for (const old of replaced) if (idOf.has(old)) await client.deleteLinks(idOf.get(old), [userCardId]);
          pulledTags.set((s) => ({...s, links: {...s.links, [userCardId]: [...(s.links[userCardId] || []).filter((n) => n !== name && !replaced.includes(n)), name]}}));
          remember(name);
        } else {
          const tagId = known.find((t) => t.name === name)?.id;
          if (tagId) await client.deleteLinks(tagId, [userCardId]);
          pulledTags.set((s) => ({...s, links: {...s.links, [userCardId]: (s.links[userCardId] || []).filter((n) => n !== name)}}));
        }
      },
      {wait: true},
    );
    invalidateCollection();
  } finally {
    setBusy(userCardId, false);
  }
}

// --- Favori
// Révélation affichée : la Toolbox passe par le bouton étoile du site (features/site-dom.js), qui
// renvoie true s'il a pu cliquer sur celui de cette carte.
let starProxy = () => false;
export const setStarProxy = (fn) => (starProxy = fn);
// État lu sur le bouton du site pendant la révélation
export function noteStarred(userCardId, starred) {
  if (!userCardId || pulledTags.get().starred[userCardId] === starred) return;
  pulledTags.set((s) => ({...s, starred: {...s.starred, [userCardId]: starred}}));
}

export async function toggleStar(index) {
  const card = recapState.get().cards[index];
  const id = card?.user_card_id;
  if (!id || pulledTags.get().busy[id]) return;
  if (starProxy(index)) return;
  const next = !pulledTags.get().starred[id];
  edits++;
  setBusy(id, true);
  try {
    const session = await ensureSession();
    // Écriture d'une valeur (idempotente) : peut être réessayée
    await rest(`user_cards?id=eq.${id}&user_id=eq.${session.userId}`, {method: "PATCH", body: {starred: next}, retries: 2});
    noteStarred(id, next);
    invalidateCollection();
  } finally {
    setBusy(id, false);
  }
}
