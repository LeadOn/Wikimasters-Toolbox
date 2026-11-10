// Étiquettes et favori d'un exemplaire tiré, en un clic : à côté de la carte pendant la révélation
// (RevealSide, ui/islands/RevealSide.jsx) et dans les lignes du récapitulatif du paquet.
// Écritures dans features/quick-tags.js, toujours sur clic du joueur.
import {useState} from "preact/hooks";
import {useStore} from "../lib/store";
import {pulledTags, recentTags, toggleTag, toggleStar, tagColorOf, TAG_NAME_MAX} from "../features/quick-tags";
import {isOn} from "../state/settings";
import {classify, isTheme, themeNames} from "../state/themes";
import {DOUBLON, FAVORI} from "../../../../core";

// Étiquettes posées par le tri selon l'état de la collection (exemplaires, étoile) : pas d'ajout à la main
const automatic = (n) => n === DOUBLON || n === FAVORI;
import {Icon} from "./components";
import {toast, errorMessage} from "./feedback";
import {L} from "../../shared/i18n";

const SUGGESTED = 5;
const run = (p) => p.catch((e) => toast(errorMessage(e), {type: "error", duration: 10000}));

function TagButton({name, on, disabled, onClick}) {
  return (
    <button
      type="button"
      class={`chip theme qt-tag${on ? " on" : ""}`}
      style={{"--c": tagColorOf(name)}}
      disabled={disabled}
      aria-pressed={on}
      title={on ? L(`Retirer l'étiquette « ${name} »`, `Remove the "${name}" tag`) : L(`Ajouter l'étiquette « ${name} »`, `Add the "${name}" tag`)}
      onClick={onClick}
    >
      <span class="lbl">{name}</span>
      <Icon name={on ? "close" : "plus"} size={10} />
    </button>
  );
}

// Toutes les étiquettes connues (celles du joueur et les thèmes pas encore créés) qui contiennent `query`
function searchNames(query, tags, have) {
  const q = query.trim().toLocaleLowerCase();
  const names = [...new Set([...tags.map((t) => t.name), ...(isOn("sortThemes") ? themeNames() : [])])];
  // Les noms qui commencent par la recherche d'abord
  const rank = (n) => (n.toLocaleLowerCase().startsWith(q) ? 0 : 1);
  return names.filter((n) => !automatic(n) && !have.includes(n) && (!q || n.toLocaleLowerCase().includes(q))).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function TagPicker({card, userCardId}) {
  const st = useStore(pulledTags);
  const recent = useStore(recentTags);
  const [search, setSearch] = useState(null); // texte de la recherche, null : fermée
  if (!userCardId) return <span class="chip warn">{L("Exemplaire introuvable", "Copy not found")}</span>;
  if (st.status === "error")
    return (
      <span class="chip warn" title={st.error}>
        {L("Étiquettes indisponibles", "Tags unavailable")}
      </span>
    );
  if (st.status !== "ready" || !(userCardId in st.links))
    return (
      <span class="chip">
        <span class="spinner sm" /> {L("étiquettes…", "tags…")}
      </span>
    );
  const have = st.links[userCardId].filter((n) => !automatic(n));
  const busy = Boolean(st.busy[userCardId]);
  const toggle = (name, on) => run(toggleTag(userCardId, name, on));
  const theme = isOn("sortThemes") ? classify(card)[0] : null;
  const hasTheme = have.some(isTheme);
  const suggested = [...new Set([...(theme && !hasTheme ? [theme] : []), ...recent.names])].filter((n) => !automatic(n) && !have.includes(n)).slice(0, SUGGESTED);
  const found = search == null ? [] : searchNames(search, st.tags, have);
  const typed = search?.trim() || "";
  const canCreate = typed && typed.length <= TAG_NAME_MAX && !found.some((n) => n.toLocaleLowerCase() === typed.toLocaleLowerCase()) && !have.includes(typed);

  return (
    <div class="qt" aria-busy={busy}>
      <div class="qt-chips">
        {have.map((n) => (
          <TagButton key={n} name={n} on disabled={busy} onClick={() => toggle(n, false)} />
        ))}
        {suggested.map((n) => (
          <TagButton key={n} name={n} disabled={busy} onClick={() => toggle(n, true)} />
        ))}
        {search == null && (
          <button type="button" class="chip qt-more" disabled={busy} title={L("Chercher ou créer une étiquette", "Find or create a tag")} onClick={() => setSearch("")}>
            <Icon name="tag" size={11} /> {L("Ajouter…", "Add…")}
          </button>
        )}
        {busy && <span class="spinner sm" aria-label={L("Enregistrement", "Saving")} />}
      </div>
      {search != null && (
        <div class="qt-search">
          <input
            type="text"
            value={search}
            maxLength={TAG_NAME_MAX}
            placeholder={L("Nom de l'étiquette", "Tag name")}
            ref={(el) => el && !el.dataset.focused && ((el.dataset.focused = "1"), el.focus())}
            onInput={(e) => setSearch(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearch(null);
              if (e.key === "Enter" && (found[0] || canCreate)) {
                toggle(found[0] || typed, true);
                setSearch(null);
              }
            }}
          />
          <div class="qt-found">
            {found.slice(0, 12).map((n) => (
              <TagButton
                key={n}
                name={n}
                disabled={busy}
                onClick={() => {
                  toggle(n, true);
                  setSearch(null);
                }}
              />
            ))}
            {canCreate && (
              <button
                type="button"
                class="chip accent"
                disabled={busy}
                onClick={() => {
                  toggle(typed, true);
                  setSearch(null);
                }}
              >
                <Icon name="plus" size={10} /> {L(`Créer « ${typed} »`, `Create "${typed}"`)}
              </button>
            )}
            {!found.length && !canCreate && <span class="small muted">{L("Aucune étiquette", "No tag")}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// Étoile des favoris d'un exemplaire tiré (index dans le paquet)
export function StarButton({card, index, label = false}) {
  const st = useStore(pulledTags);
  const id = card.user_card_id;
  if (!id || st.status !== "ready") return null;
  const on = Boolean(st.starred[id]);
  const title = on ? L("Retirer des favoris (déverrouille la carte)", "Remove from favorites (unlocks the card)") : L("Ajouter aux favoris (verrouille la carte : ni défausse, ni vente, ni échange)", "Add to favorites (locks the card: no discard, sale or trade)");
  return (
    <button type="button" class={`btn sm ghost qt-star${on ? " on" : ""}`} aria-pressed={on} title={title} aria-label={title} disabled={Boolean(st.busy[id])} onClick={() => run(toggleStar(index))}>
      <Icon name="star" size={14} />
      {label && <span class="label">{L("Favori", "Favorite")}</span>}
    </button>
  );
}
