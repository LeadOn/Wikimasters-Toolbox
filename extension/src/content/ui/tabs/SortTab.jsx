// Onglet « Tri » : trier les nouvelles cartes, doublons, retri complet.
import {useState, useMemo} from "preact/hooks";
import {useStore} from "../../lib/store";
import {sortState, planSort, applySort} from "../../features/sorter";
import {activeProfiles} from "../../state/profiles";
import {settings, isOn} from "../../state/settings";
import {Progress, Notice, ThemeChip, fmt, plural, timeAgo} from "../components";
import {confirmAction, toast, errorMessage} from "../feedback";
import {DOUBLON, FAVORI, groupCardChanges, changeKey} from "../../../../../core";

// Pastille d'une étiquette gérée qui n'est pas un thème : Doublon, Favori, « Pour : … »
const chipClass = (name) => (name === DOUBLON ? "danger" : name === FAVORI ? "warn" : "accent");
import {isTheme} from "../../state/themes";
import {L, LOCALE} from "../../../shared/i18n";

function TagCounts({counts}) {
  const max = Math.max(1, ...counts.map((c) => c.count));
  return (
    <table class="list">
      <tbody>
        {counts.map(({name, count}) => (
          <tr key={name}>
            <td style={{width: "45%"}}>{isTheme(name) ? <ThemeChip theme={name} /> : <span class={`chip ${chipClass(name)}`}>{name}</span>}</td>
            <td>
              <div class="bar" style={{width: `${(100 * count) / max}%`}} />
            </td>
            <td class="num" style={{width: "70px"}}>{fmt(count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const tagChip = (t) => (isTheme(t) ? <ThemeChip key={t} theme={t} /> : <span key={t} class={`chip ${chipClass(t)}`}>{t}</span>);

// Aperçu d'un tri (nouvelles cartes ou retri complet) : les cartes dont les étiquettes changent,
// étiquettes retirées (avant) et ajoutées (après). Toute la collection peut changer (thèmes modifiés) : les changements sont d'abord
// regroupés par transition (« Sports → Histoire » : 1 234 cartes), un clic sur une transition en
// liste les cartes, 10 par page.
const PAGE = 10;
const TOP_GROUPS = 8;
const tagsOrNone = (names) => (names.length ? names.map(tagChip) : <span class="muted">—</span>);

function ChangeList({changes}) {
  const [filter, setFilter] = useState("");
  const [group, setGroup] = useState(null); // clé d'une transition (changeKey de core/tag-sync.js)
  const [allGroups, setAllGroups] = useState(false);
  const [page, setPage] = useState(0);
  // Une fois par aperçu : transitions, ordre alphabétique et texte de recherche de chaque carte
  const groups = useMemo(() => groupCardChanges(changes), [changes]);
  const rows = useMemo(() => {
    const collator = new Intl.Collator(LOCALE);
    return changes
      .map((c) => ({...c, key: changeKey(c), text: `${c.title} ${c.category} ${c.removed.join(" ")} ${c.added.join(" ")}`.toLowerCase()}))
      .sort((a, b) => collator.compare(a.title, b.title));
  }, [changes]);
  const q = filter.trim().toLowerCase();
  const shown = useMemo(() => rows.filter((c) => (!group || c.key === group) && (!q || c.text.includes(q))), [rows, group, q]);
  const pages = Math.ceil(shown.length / PAGE);
  // Autre transition ou autre filtre : retour à la première page
  const pick = (key) => {
    setGroup((g) => (g === key ? null : key));
    setPage(0);
  };
  const listed = allGroups ? groups : groups.slice(0, TOP_GROUPS);
  return (
    <div class="box stack">
      <h3>{L(`Cartes modifiées · ${fmt(changes.length)}`, `Changed cards · ${fmt(changes.length)}`)}</h3>
      {groups.length > 1 && (
        <div class="stack">
          <table class="list">
            <thead>
              <tr><th>{L("Avant", "Before")}</th><th>{L("Après", "After")}</th><th class="num">{L("Cartes", "Cards")}</th></tr>
            </thead>
            <tbody>
              {listed.map((g) => (
                <tr key={g.key} class={group === g.key ? "on" : ""}>
                  <td><div class="chips">{tagsOrNone(g.removed)}</div></td>
                  <td><div class="chips">{tagsOrNone(g.added)}</div></td>
                  <td class="num" style={{width: "90px"}}>
                    <button class="btn sm ghost" aria-pressed={group === g.key} title={group === g.key ? L("Toutes les cartes modifiées", "All changed cards") : L("Voir ces cartes", "Show these cards")} onClick={() => pick(g.key)}>
                      {fmt(g.count)}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {groups.length > TOP_GROUPS && (
            <div class="row">
              <button class="btn sm ghost" onClick={() => setAllGroups(!allGroups)}>
                {allGroups ? L("Moins de changements", "Fewer changes") : L(`Tous les changements (${fmt(groups.length)})`, `All changes (${fmt(groups.length)})`)}
              </button>
            </div>
          )}
        </div>
      )}
      <div class="row">
        <p class="small muted" style={{flex: 1}}>
          {group
            ? L(`${plural(shown.length, "carte")} pour ce changement.`, `${fmt(shown.length)} ${shown.length === 1 ? "card" : "cards"} for this change.`)
            : q
              ? L(`${plural(shown.length, "carte trouvée", "cartes trouvées")}.`, `${fmt(shown.length)} ${shown.length === 1 ? "card" : "cards"} found.`)
              : L("Toutes les cartes modifiées, par nom.", "All changed cards, by name.")}
          {group && (
            <button class="btn sm ghost" onClick={() => pick(group)}>
              {L("Toutes les cartes", "All cards")}
            </button>
          )}
        </p>
        {changes.length > 10 && <input type="search" placeholder={L("Filtrer…", "Filter…")} style={{maxWidth: "240px"}} value={filter} onInput={(e) => {
          setFilter(e.currentTarget.value);
          setPage(0);
        }} />}
      </div>
      {shown.length > 0 && (
        <table class="list">
          <thead>
            <tr><th>{L("Carte", "Card")}</th><th>{L("Avant", "Before")}</th><th>{L("Après", "After")}</th></tr>
          </thead>
          <tbody>
            {shown.slice(page * PAGE, (page + 1) * PAGE).map((c) => (
              <tr key={c.userCardId}>
                <td>
                  <div style={{fontWeight: 600}}>{c.title}</div>
                  <div class="small muted">{c.category}</div>
                </td>
                <td><div class="chips">{tagsOrNone(c.removed)}</div></td>
                <td><div class="chips">{tagsOrNone(c.added)}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pages > 1 && (
        <div class="row" style={{justifyContent: "center"}}>
          <button class="btn sm" disabled={!page} onClick={() => setPage(page - 1)}>{L("Précédent", "Previous")}</button>
          <span class="small muted num">{L(`Page ${fmt(page + 1)} sur ${fmt(pages)}`, `Page ${fmt(page + 1)} of ${fmt(pages)}`)}</span>
          <button class="btn sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>{L("Suivant", "Next")}</button>
        </div>
      )}
    </div>
  );
}

const retiredList = (retired) => retired.map((t) => `${t.name} (${plural(t.count, L("carte", "card"))})`).join(", ");

function PlanView({plan}) {
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();
  const cards = q ? plan.cards.filter((c) => `${c.title} ${c.tags.join(" ")}`.toLowerCase().includes(q)) : plan.cards;
  const showChanges = plan.changes?.length > 0;
  const nothing = !plan.insertCount && !plan.deleteCount && !plan.extraTagIds.length && !plan.renamed?.length;
  return (
    <div class="stack">
      <div class="grid-stats">
        <div class="stat"><div class="k">{plan.withThemes === false ? L("Cartes concernées", "Cards involved") : plan.newOnly ? L("Cartes non triées", "Unsorted cards") : L("Cartes classées", "Cards sorted")}</div><div class="v">{fmt(plan.scopedCount)}</div></div>
        <div class="stat"><div class="k">{L("Étiquettes à ajouter", "Tags to add")}</div><div class="v">{fmt(plan.insertCount)}</div></div>
        <div class="stat"><div class="k">{L("Étiquettes à retirer", "Tags to remove")}</div><div class="v">{fmt(plan.deleteCount)}</div></div>
        <div class="stat"><div class="k">{L("Collection", "Collection")}</div><div class="v">{fmt(plan.total)}</div></div>
      </div>
      {plan.withThemes === false && (
        <Notice>
          {L(
            "Étiquettes de thème désactivées (Réglages → Tri) : seuls Doublon et les étiquettes « Pour : … » sont posés. Les étiquettes de thème déjà présentes ne sont pas touchées.",
            'Theme tags are off (Settings → Sorting): only Doublon and the "Pour : …" tags are set. Theme tags already present are not touched.',
          )}
        </Notice>
      )}
      {plan.frozenCount > 0 && <p class="small muted">{L(`${plural(plan.frozenCount, "exemplaire en favori exclu", "exemplaires en favori exclus")} du tri (Réglages → Tri).`, `${plural(plan.frozenCount, "favorite copy", "favorite copies")} left out of sorting (Settings → Sorting).`)}</p>}
      {nothing && <Notice type="ok">{L("Tout est déjà à jour : rien à écrire.", "Everything is up to date: nothing to write.")}</Notice>}
      {plan.upserts.create.length > 0 && (
        <Notice>{L("Étiquettes créées : ", "Tags created: ")}{plan.upserts.create.map((t) => t.name).join(", ")}.</Notice>
      )}
      {plan.renamed?.length > 0 && <Notice>{L("Étiquettes renommées (thèmes renommés dans les réglages) : ", "Tags renamed (themes renamed in settings): ")}{plan.renamed.map((r) => `${r.from} → ${r.to}`).join(", ")}.</Notice>}
      {plan.retired?.length > 0 &&
        (plan.newOnly ? (
          <Notice>
            {L(
              `Étiquettes de thèmes supprimés, laissées en place : ${retiredList(plan.retired)}. Leurs cartes comptent comme triées ; le retri complet les reclasse et retire ces étiquettes.`,
              `Tags of deleted themes, left in place: ${retiredList(plan.retired)}. Their cards count as sorted; a full re-sort re-sorts them and removes these tags.`,
            )}
          </Notice>
        ) : (
          <Notice type="warn">{L(`Étiquettes de thèmes supprimés, retirées puis supprimées : ${retiredList(plan.retired)}. Leurs cartes reçoivent un thème de votre liste.`, `Tags of deleted themes, removed then deleted: ${retiredList(plan.retired)}. Their cards get a theme from your list.`)}</Notice>
        ))}
      {plan.unmanaged.length > 0 && <p class="small muted">{L("Vos étiquettes personnelles ne seront pas touchées : ", "Your personal tags will not be touched: ")}{plan.unmanaged.join(", ")}.</p>}
      {showChanges && <ChangeList changes={plan.changes} />}
      {/* Doublon et Favori figurent dans les cartes modifiées, sans liste de noms à rallonge */}
      {!showChanges && (plan.doublonAdds.length > 0 || plan.doublonDels.length > 0) && (
        <div class="box">
          <h3>{L("Doublons", "Duplicates")}</h3>
          {plan.doublonAdds.length > 0 && <p class="small">+ {plan.doublonAdds.join(", ")}</p>}
          {plan.doublonDels.length > 0 && <p class="small muted">− {plan.doublonDels.join(", ")}</p>}
        </div>
      )}
      {!showChanges && (plan.favoriAdds?.length > 0 || plan.favoriDels?.length > 0) && (
        <div class="box">
          <h3>{L("Favoris", "Favorites")}</h3>
          {plan.favoriAdds.length > 0 && <p class="small">+ {plan.favoriAdds.join(", ")}</p>}
          {plan.favoriDels.length > 0 && <p class="small muted">− {plan.favoriDels.join(", ")}</p>}
        </div>
      )}
      {plan.counts.length > 0 && (
        <div class="box">
          <h3>{L("Répartition", "Breakdown")}</h3>
          <TagCounts counts={plan.counts} />
        </div>
      )}
      {/* Nouvelles cartes : toutes dans les cartes modifiées ; retri complet : toute la collection, modifiée ou non */}
      {plan.cards.length > 0 && !(plan.newOnly && showChanges) && (
        <div class="box stack">
          <div class="row">
            <h3 style={{flex: 1}}>{L("Détail par carte", "Per-card details")}</h3>
            <input type="search" placeholder={L("Filtrer…", "Filter…")} style={{maxWidth: "240px"}} value={filter} onInput={(e) => setFilter(e.currentTarget.value)} />
          </div>
          <table class="list">
            <thead>
              <tr><th>{L("Carte", "Card")}</th><th>{L("Étiquettes", "Tags")}</th></tr>
            </thead>
            <tbody>
              {cards.slice(0, 300).map((c) => (
                <tr key={c.id}>
                  <td>
                    <div style={{fontWeight: 600}}>{c.title}</div>
                    <div class="small muted">{c.category}</div>
                  </td>
                  <td>
                    <div class="chips">
                      {c.tags.map(tagChip)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cards.length > 300 && <p class="small muted">{L(`… et ${fmt(cards.length - 300)} autres.`, `… and ${fmt(cards.length - 300)} more.`)}</p>}
        </div>
      )}
    </div>
  );
}

export function SortTab() {
  const s = useStore(sortState);
  useStore(settings);
  const profiles = activeProfiles();

  const preview = async (newOnly) => {
    try {
      await planSort({newOnly});
    } catch (e) {
      toast(errorMessage(e), {type: "error"});
    }
  };

  const apply = async () => {
    const plan = s.plan;
    if (!plan.newOnly) {
      const ok = await confirmAction({
        title: L("Appliquer le retri complet ?", "Apply the full re-sort?"),
        body: L(
          `Toute la collection est resynchronisée : ${plural(plan.changes?.length || 0, "carte modifiée", "cartes modifiées")}, ${fmt(plan.insertCount)} étiquette(s) ajoutée(s), ${fmt(plan.deleteCount)} retirée(s). Les corrections faites à la main sur une étiquette gérée (thème, « Pour : … », Doublon) seront écrasées.${
            plan.retired?.length ? ` Étiquettes de thèmes supprimés, supprimées : ${retiredList(plan.retired)}.` : ""
          } Vos étiquettes personnelles ne sont jamais touchées.`,
          `The whole collection is resynced: ${fmt(plan.changes?.length || 0)} changed card(s), ${fmt(plan.insertCount)} tag(s) added, ${fmt(plan.deleteCount)} removed. Manual fixes to a managed tag (theme, "Pour : …", Doublon) will be overwritten.${
            plan.retired?.length ? ` Tags of deleted themes, deleted: ${retiredList(plan.retired)}.` : ""
          } Your personal tags are never touched.`,
        ),
        confirm: L("Appliquer", "Apply"),
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const r = await applySort(plan);
      toast(
        L(
          `Tri terminé : ${plan.newOnly ? plural(r.sorted, "carte triée", "cartes triées") : "collection resynchronisée"}${r.failed ? `, ${r.failed} échec(s)` : ""}.`,
          `Sort complete: ${plan.newOnly ? plural(r.sorted, "card sorted", "cards sorted") : "collection resynced"}${r.failed ? `, ${r.failed} failure(s)` : ""}.`,
        ),
        {type: r.failed ? "error" : "ok"});
    } catch (e) {
      toast(errorMessage(e), {type: "error"});
    }
  };

  return (
    <div class="stack">
      <div class="page-head">
        <div>
          <h2>{L("Tri automatique", "Automatic sort")}</h2>
          <p>
            {isOn("favoriteTag")
              ? L("Un thème par carte, les étiquettes « Pour : … » de vos profils d'intérêts, l'étiquette Doublon et l'étiquette Favori. Vos étiquettes personnelles ne sont jamais modifiées.", 'One theme per card, the "Pour : …" tags of your interest profiles, the Doublon tag and the Favori tag. Your personal tags are never changed.')
              : L("Un thème par carte, les étiquettes « Pour : … » de vos profils d'intérêts et l'étiquette Doublon. Vos étiquettes personnelles ne sont jamais modifiées.", 'One theme per card, the "Pour : …" tags of your interest profiles and the Doublon tag. Your personal tags are never changed.')}
          </p>
        </div>
      </div>

      <div class="grid-2">
        <div class="box stack">
          <div>
            <h3>{L("Trier mes nouvelles cartes", "Sort my new cards")}</h3>
            <p class="help">
              {isOn("favoriteTag")
                ? L("Classe les cartes qui n'ont encore aucun thème et met à jour les doublons et les favoris. Les cartes déjà triées, et vos corrections, ne sont pas modifiées.", "Sorts the cards that have no theme yet and updates duplicates and favorites. Cards already sorted, and your fixes, are left unchanged.")
                : L("Classe les cartes qui n'ont encore aucun thème et met à jour les doublons. Les cartes déjà triées, et vos corrections, ne sont pas modifiées.", "Sorts the cards that have no theme yet and updates duplicates. Cards already sorted, and your fixes, are left unchanged.")}
            </p>
          </div>
          <div class="row">
            <button class="btn primary" disabled={s.running} onClick={() => preview(true)}>{L("Aperçu du tri", "Preview sort")}</button>
          </div>
        </div>
        <div class="box stack">
          <div>
            <h3>{L("Retri complet", "Full re-sort")}</h3>
            <p class="help">{L("Resynchronise toute la collection sur le moteur actuel, par exemple après avoir modifié vos profils ou mis à jour l'extension. Les étiquettes gérées qui ne correspondent plus sont retirées.", "Resyncs the whole collection with the current engine, for example after editing your profiles or updating the extension. Managed tags that no longer match are removed.")}</p>
          </div>
          <div class="row">
            <button class="btn" disabled={s.running} onClick={() => preview(false)}>{L("Aperçu du retri complet", "Preview full re-sort")}</button>
          </div>
        </div>
      </div>

      <p class="small muted">
        {L("Profils appliqués : ", "Profiles applied: ")}
        {profiles.length ? profiles.map((p) => p.name).join(", ") : L("aucun (ajoutez-en dans l'onglet Profils)", "none (add some in the Profiles tab)")}
        {!isOn("sortThemes") && L(" · Étiquettes de thème désactivées", " · Theme tags off")}
        {isOn("skipStarred") && L(" · Favoris exclus", " · Favorites left out")}
        {isOn("favoriteTag") && L(" · Étiquette Favori", " · Favori tag")}
        {s.lastRun && L(` · Dernier tri ${timeAgo(s.lastRun.at)} (${plural(s.lastRun.sorted, "carte")})`, ` · Last sort ${timeAgo(s.lastRun.at)} (${plural(s.lastRun.sorted, "card")})`)}
      </p>

      {s.running && (
        <div class="box">
          <Progress done={s.progress?.done || 0} total={s.progress?.total} label={s.step || L("En cours…", "In progress…")} />
          <p class="small muted" style={{marginTop: "8px"}}>{L("La base de WikiMasters est lente : comptez une à deux minutes.", "The WikiMasters database is slow: allow one to two minutes.")}</p>
        </div>
      )}
      {s.error && !s.running && <Notice type="error">{s.error}</Notice>}
      {s.result && !s.plan && (
        <Notice type="ok">
          {L(
            `Terminé : ${fmt(s.result.inserted)} étiquette(s) ajoutée(s), ${fmt(s.result.deleted)} retirée(s)${s.result.failed ? `, ${s.result.failed} échec(s)` : ""}.`,
            `Done: ${fmt(s.result.inserted)} tag(s) added, ${fmt(s.result.deleted)} removed${s.result.failed ? `, ${s.result.failed} failure(s)` : ""}.`,
          )}
        </Notice>
      )}
      {s.plan && !s.running && (
        <div class="stack">
          <div class="row">
            <h3 class="section-title" style={{flex: 1}}>{s.plan.newOnly ? L("Aperçu : nouvelles cartes", "Preview: new cards") : L("Aperçu : retri complet", "Preview: full re-sort")}</h3>
            <button class="btn ghost" onClick={() => sortState.set({plan: null})}>{L("Annuler", "Cancel")}</button>
            <button
              class={`btn ${s.plan.newOnly ? "primary" : "danger"}`}
              disabled={!s.plan.insertCount && !s.plan.deleteCount && !s.plan.upserts.recolor.length && !s.plan.upserts.create.length && !s.plan.extraTagIds.length && !s.plan.renamed?.length}
              onClick={apply}
            >
              {L("Appliquer", "Apply")}
            </button>
          </div>
          <PlanView plan={s.plan} />
        </div>
      )}
    </div>
  );
}
