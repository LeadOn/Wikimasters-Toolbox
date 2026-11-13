// Onglet « Paquets » : statistiques de tirage, « Tout ouvrir », dernier récapitulatif.
import {useStore} from "../../lib/store";
import {pullStats, resetPullStats, packsStatus, openAllState, todayPulls} from "../../features/packs";
import {PackRecapView} from "../PackRecap";
import {dailyRates} from "../DropRates";
import {emit} from "../../lib/bus";
import {Notice, Rarity, Toggle, fmt, plural, timeAgo} from "../components";
import {confirmAction} from "../feedback";
import {RARITIES, RARITY_LABEL} from "../../../../../core";
import {L, LOCALE} from "../../../shared/i18n";

export function PacksTab() {
  const all = useStore(pullStats);
  const daily = useStore(dailyRates).on;
  const status = useStore(packsStatus);
  const openAll = useStore(openAllState);
  // Interrupteur « Aujourd'hui », le même que celui du bloc Taux de drop de la page Paquets
  const stats = daily ? todayPulls(all) : all;
  const max = Math.max(1, ...RARITIES.map((r) => stats.byRarity[r] || 0));

  return (
    <div class="stack">
      <div class="page-head">
        <div>
          <h2>{L("Paquets", "Packs")}</h2>
          <p>{L("Statistiques de vos tirages et ouverture groupée. L'ouverture ne se fait jamais toute seule : seulement quand vous cliquez.", "Your pull statistics and bulk opening. Packs are never opened on their own: only when you click.")}</p>
        </div>
      </div>
      <div class="grid-2">
        <div class="box stack">
          <h3>{L("Tout ouvrir", "Open all")}</h3>
          <p class="help">
            {L(
              "Ouvre tous les paquets disponibles l'un après l'autre, au rythme du site : les cartes de chaque paquet sont distribuées puis révélées au fur et à mesure, et le récapitulatif s'affiche à la fin. S'arrête à la première erreur, ou si le site demande une vérification anti-robot (à faire vous-même sur la page Paquets).",
              "Opens all available packs one after another, at the site's pace: each pack's cards are dealt and revealed as they come, and the summary is shown at the end. Stops at the first error, or if the site asks for a bot check (complete it yourself on the Packs page).",
            )}
          </p>
          <div class="row">
            <button class="btn primary" title={openAll.running ? L("Voir l'ouverture en cours", "Watch the opening in progress") : undefined} onClick={() => emit("confirm-open-all", {})}>
              {openAll.running ? L(`Ouverture… (${openAll.opened})`, `Opening… (${openAll.opened})`) : L("Tout ouvrir", "Open all")}
            </button>
            <span class="small muted">{status.remaining != null
                ? L(`${plural(status.remaining, "paquet disponible", "paquets disponibles")} (${timeAgo(status.at)})`, `${plural(status.remaining, "pack", "packs")} available (${timeAgo(status.at)})`)
                : L("Ouvrez la page Paquets pour voir le nombre disponible.", "Open the Packs page to see how many are available.")}</span>
          </div>
          {openAll.error && <Notice type="warn">{openAll.error}</Notice>}
        </div>
        <div class="box stack">
          <div class="row">
            <h3 style={{flex: 1}}>{L("Statistiques de tirage", "Pull statistics")}</h3>
            <label class="rates-daily" title={L("Seulement les paquets ouverts aujourd'hui", "Only the packs opened today")}>
              <Toggle checked={daily} onChange={(on) => dailyRates.set({on})} label={L("Statistiques du jour", "Today's statistics")} />
              <span aria-hidden="true">{L("Aujourd'hui", "Today")}</span>
            </label>
            <button
              class="btn sm ghost"
              onClick={async () => (await confirmAction({title: L("Réinitialiser les statistiques ?", "Reset the statistics?"), confirm: L("Réinitialiser", "Reset"), danger: true})) && resetPullStats()}
            >
              {L("Réinitialiser", "Reset")}
            </button>
          </div>
          <p class="small muted">
            {daily ? L("Aujourd'hui", "Today") : `${L("Depuis le", "Since")} ${new Date(all.since).toLocaleDateString(LOCALE)}`} · {plural(stats.packs, L("paquet", "pack"))} · {plural(stats.cards, L("carte", "card"))}
          </p>
          <table class="list">
            <tbody>
              {RARITIES.map((r) => {
                const n = stats.byRarity[r] || 0;
                return (
                  <tr key={r}>
                    <td style={{width: "130px"}}>
                      <Rarity r={r} /> <span class="small">{RARITY_LABEL[r]}</span>
                    </td>
                    <td><div class="bar" style={{width: `${(100 * n) / max}%`, background: `var(--r-${r})`}} /></td>
                    <td class="num" style={{width: "60px"}}>{fmt(n)}</td>
                    <td class="num muted" style={{width: "60px"}}>{stats.cards ? L(`${((100 * n) / stats.cards).toFixed(1)} %`, `${((100 * n) / stats.cards).toFixed(1)}%`) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <PackRecapView />
    </div>
  );
}
