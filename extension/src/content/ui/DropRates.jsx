// Taux de drop par rareté, sur l'écran « Ouvrir un paquet ».
// Deux sources : mes tirages comptés par l'extension, ou la répartition de toute ma collection
// (proche des taux de drop, la plupart des cartes venant des paquets) en attendant assez de tirages.
// L'interrupteur « Aujourd'hui » (gardé d'une visite à l'autre) montre les seuls tirages du jour.
// Barres aux couleurs de rareté du site ; la rareté est aussi portée par son libellé.
import {useState} from "preact/hooks";
import {useStore} from "../lib/store";
import {pullStats, collectionRarity, MIN_PULLED, todayPulls} from "../features/packs";
import {persistentStore} from "../lib/storage";
import {RARITIES, RARITY_LABEL} from "../../../../core";
import {Mark, Toggle, fmt, plural} from "./components";
import {mountIsland} from "./islands/mount";
import {DockPicker} from "./DockPicker";
import {L, LOCALE} from "../../shared/i18n";

const pct = (n, total) => {
  if (!total) return "—";
  if (!n) return L("0 %", "0%");
  const p = (100 * n) / total;
  const v = p.toLocaleString(LOCALE, {maximumFractionDigits: p < 1 ? 2 : 1, minimumFractionDigits: p < 1 && p > 0 ? 2 : 1});
  return L(`${v} %`, `${v}%`);
};

export const dailyRates = persistentStore("dropRatesDaily", {on: false});

export function DropRatesView() {
  const stats = useStore(pullStats);
  const coll = useStore(collectionRarity);
  const daily = useStore(dailyRates).on;
  const [choice, setChoice] = useState(null);
  const today = todayPulls(stats);
  const source = daily ? "today" : choice || (stats.cards >= MIN_PULLED || !coll.total ? "pulls" : "collection");
  const counts = source === "today" ? today.byRarity : source === "pulls" ? stats.byRarity : coll.counts;
  const total = RARITIES.reduce((n, r) => n + (Number(counts[r]) || 0), 0);
  const max = Math.max(1, ...RARITIES.map((r) => Number(counts[r]) || 0));
  const caption =
    source === "today"
      ? today.cards
        ? L(`Aujourd'hui : ${plural(today.packs, "paquet")} · ${plural(today.cards, "carte")}`, `Today: ${plural(today.packs, "pack")} · ${plural(today.cards, "card")}`)
        : L("Aucun paquet ouvert aujourd'hui.", "No pack opened today.")
      : source === "pulls"
      ? stats.cards
        ? L(
            `${fmt(stats.packs)} paquet${stats.packs > 1 ? "s" : ""} · ${fmt(stats.cards)} cartes depuis le ${new Date(stats.since).toLocaleDateString(LOCALE)}`,
            `${plural(stats.packs, "pack")} · ${plural(stats.cards, "card")} since ${new Date(stats.since).toLocaleDateString(LOCALE)}`,
          )
        : L("Ouvre un paquet : les tirages seront comptés ici.", "Open a pack: your pulls will be counted here.")
      : L(`Toute ta collection (${fmt(total)} cartes), proche des taux de drop`, `Your whole collection (${plural(total, "card")}), close to the drop rates`);

  return (
    <section class="rates" aria-label={L("Taux de drop par rareté", "Drop rates by rarity")}>
      <header class="rates-head">
        <Mark size={18} />
        <span class="rates-title">{L("Taux de drop", "Drop rates")}</span>
        <label class="rates-daily" title={L("Taux de drop des seuls paquets ouverts aujourd'hui", "Drop rates of the packs opened today only")}>
          <Toggle checked={daily} onChange={(on) => dailyRates.set({on})} label={L("Taux de drop du jour", "Today's drop rates")} />
          <span aria-hidden="true">{L("Aujourd'hui", "Today")}</span>
        </label>
        <div class="seg" role="tablist" hidden={daily}>
          <button role="tab" aria-selected={source === "pulls"} class={source === "pulls" ? "on" : ""} onClick={() => setChoice("pulls")}>
            {L("Mes paquets", "My packs")}
          </button>
          <button role="tab" aria-selected={source === "collection"} class={source === "collection" ? "on" : ""} disabled={!coll.total} onClick={() => setChoice("collection")}>
            {L("Ma collection", "My collection")}
          </button>
        </div>
        <DockPicker block="rates" />
      </header>
      {total ? (
        <ul class="rates-list">
          {RARITIES.map((r) => {
            const n = Number(counts[r]) || 0;
            return (
              <li key={r} class="rates-row" style={{"--rc": `var(--r-${r})`}} title={L(`${RARITY_LABEL[r]} : ${fmt(n)} carte${n > 1 ? "s" : ""} sur ${fmt(total)} (${pct(n, total)})`, `${RARITY_LABEL[r]}: ${plural(n, "card")} out of ${fmt(total)} (${pct(n, total)})`)}>
                <span class={`rarity ${r}`}>{r}</span>
                <span class="rates-name">{RARITY_LABEL[r]}</span>
                <span class="rates-track">
                  <span class="rates-bar" style={{width: n ? `max(4px, ${(100 * n) / max}%)` : "0"}} />
                </span>
                <span class="rates-pct">{pct(n, total)}</span>
                <span class="rates-n">{fmt(n)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="rates-empty">{source === "today" ? L("Aucun tirage compté aujourd'hui.", "No pulls counted today.") : source === "pulls" ? L("Aucun tirage compté pour l'instant.", "No pulls counted yet.") : L("Répartition indisponible.", "Breakdown unavailable.")}</p>
      )}
      <p class="rates-caption">{caption}</p>
    </section>
  );
}

export function mountDropRates(host) {
  mountIsland(host, DropRatesView)({});
}
