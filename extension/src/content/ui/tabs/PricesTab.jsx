// Onglet « Prix » : prix du marché, valeur de ma collection, classement des plus chères et
// collection filtrée par vente (jamais vendues, vendues entre X et Y ₩ : à mettre aux enchères ou
// à défausser).
import {useState, useEffect, useMemo} from "preact/hooks";
import {useStore} from "../../lib/store";
import {loadMyCollection} from "../../state/collection";
import {priceOf, priceStatus, priceOptions, priceVersion, priceSource, slowBudget, slowSpeed, slowStoppedBy, priceQuota, PRICE_BUDGET} from "../../state/prices";
import {siteBlocked} from "../../api/site";
import {indexState, indexProgress, loadIndexList, takePriceIndexLead} from "../../state/price-index";
import {settings} from "../../state/settings";
import {CardRow, Money, Paged, Progress, Notice, Toggle, fmt, plural} from "../components";
import {CollectionFilters, CollectionCards} from "../CollectionCards";
import {DEFAULT_FILTER} from "../../features/collection-view";
import {errorMessage} from "../feedback";
import {RARITIES, RARITY_LABEL} from "../../../../../core";
import {themeMemo} from "../../state/themes";
import {L, LOCALE} from "../../../shared/i18n";

// Indexation des prix de toute la collection (state/price-index.js) : interrupteur, vitesse,
// avancement par rareté et état (autre onglet, pause, plafond du jour, refus du site)
const duration = (ms) => {
  const min = Math.ceil(ms / 60000);
  return min < 60 ? `${min} min` : L(`${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`, `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`);
};
const clock = (t) => new Date(t).toLocaleString(LOCALE, {weekday: "short", hour: "2-digit", minute: "2-digit"});
const every = (ms) => {
  if (ms >= 60000 && ms % 60000 === 0) {
    const min = ms / 60000;
    return min === 1 ? L("par minute", "per minute") : L(`toutes les ${fmt(min)} min`, `every ${fmt(min)} min`);
  }
  const sec = Math.round(ms / 100) / 10;
  const label = Number.isInteger(sec) ? fmt(sec) : sec.toLocaleString(LOCALE, {maximumFractionDigits: 1});
  return L(`toutes les ${label} s`, `every ${label} s`);
};

function IndexBox() {
  const s = useStore(settings);
  const {leader, error} = useStore(indexState);
  const budget = useStore(slowBudget);
  const source = useStore(priceSource);
  useStore(priceVersion);
  useEffect(() => {
    loadIndexList();
  }, []);
  const on = s.features.priceIndex === true;
  const p = indexProgress();
  const quota = priceQuota();
  const normal = slowSpeed("normal");
  const fast = slowSpeed("fast");
  const speed = slowSpeed();
  const stopped = slowStoppedBy() || siteBlocked();
  const burst = Math.max(1, Math.floor(quota.burst / (budget.halved ? 2 : 1)));
  const gap = Math.max(speed.gap * (budget.halved ? 2 : 1), Math.round(PRICE_BUDGET.BURST_MS / Math.max(1, Math.floor(burst * 0.5))));
  const setOn = (value) => settings.set((st) => ({...st, features: {...st.features, priceIndex: value}}));
  let status;
  let showTakeover = false;
  if (source.broken) status = source.message;
  else if (stopped) status = stopped.message;
  else if (error) status = L(`Lecture de la collection impossible (${error}) : nouvel essai dans quelques minutes.`, `Could not read the collection (${error}): retrying in a few minutes.`);
  else if (!leader) {
    status = L("Un autre onglet WikiMasters indexe déjà les prix : celui-ci prendra le relais si vous le fermez.", "Another WikiMasters tab is already indexing prices: this one takes over if you close it.");
    showTakeover = true;
  } else if (budget.count >= speed.cap) status = L(`Plafond du jour atteint (${fmt(budget.count)} lectures) : reprise demain.`, `Daily cap reached (${fmt(budget.count)} reads): resumes tomorrow.`);
  else if (budget.pausedUntil > Date.now()) status = L(`En pause jusqu'à ${clock(budget.pausedUntil)} : le site limite les lectures ou ne répond pas.`, `Paused until ${clock(budget.pausedUntil)}: the site is limiting reads or not responding.`);
  else if (p.total == null) status = L("Lecture de votre collection…", "Reading your collection…");
  else if (p.due > 0)
    status = L(
      `${plural(p.due, "carte à lire", "cartes à lire")}, fin estimée dans ${duration(p.due * gap)} d'onglet ouvert · ${fmt(budget.count)} / ${fmt(speed.cap)} lectures aujourd'hui.`,
      `${plural(p.due, "card")} to read, done in about ${duration(p.due * gap)} with the tab open · ${fmt(budget.count)} / ${fmt(speed.cap)} reads today.`,
    );
  else status = L(`Tous les prix sont à jour.${p.next ? ` Prochaine relecture : ${clock(p.next)}.` : ""}`, `All prices are up to date.${p.next ? ` Next read: ${clock(p.next)}.` : ""}`);
  return (
    <div class="box stack">
      <div class="row">
        <h3 style={{flex: 1}}>{L("Indexer les prix de ma collection", "Index my collection's prices")}</h3>
        <Toggle checked={on} label={L("Indexer les prix de ma collection", "Index my collection's prices")} onChange={setOn} />
      </div>
      <p class="help">
        {L(
          `Tient à jour en arrière-plan le prix de chaque carte de votre collection, tant qu'une page WikiMasters est ouverte : une lecture à la fois, après les cartes affichées, les plus rares d'abord. Chaque carte est relue régulièrement (L et UR chaque jour, SR tous les 3 jours, R chaque semaine, PC et C chaque mois) ; une carte que vous ouvrez est relue si son prix a plus de 10 minutes. La Toolbox reste sous ${fmt(quota.window)} lectures en 10 minutes (réglable dans Réglages) et en garde la moitié pour les cartes que vous tirez ou ouvrez. Au premier refus du site, l'indexation s'arrête et se désactive.`,
          `Keeps the price of every card in your collection up to date in the background, as long as a WikiMasters page is open: one read at a time, after the cards on screen, rarest first. Each card is read again regularly (L and UR every day, SR every 3 days, R every week, PC and C every month); a card you open is read again if its price is more than 10 minutes old. The Toolbox stays under ${fmt(quota.window)} reads in 10 minutes (configurable in Settings) and keeps half of them for the cards you pull or open. As soon as the site refuses, indexing stops and turns itself off.`,
        )}
      </p>
      <label class="field">
        <span>{L("Vitesse", "Speed")}</span>
        <select class="mini-select" value={s.priceIndexSpeed} onChange={(e) => settings.set({priceIndexSpeed: e.currentTarget.value})}>
          <option value="normal">{L(`Normale : une lecture ${every(normal.gap)}, ${fmt(normal.cap)} par jour au plus`, `Normal: one read ${every(normal.gap)}, at most ${fmt(normal.cap)} a day`)}</option>
          <option value="fast">{L(`Rapide : une lecture ${every(fast.gap)}, ${fmt(fast.cap)} par jour au plus`, `Fast: one read ${every(fast.gap)}, at most ${fmt(fast.cap)} a day`)}</option>
        </select>
      </label>
      {p.total != null && <Progress done={p.read} total={p.total} label={L("Cartes de la collection avec un prix lu", "Collection cards with a price read")} />}
      {p.total != null && (
        <div class="chips">
          {RARITIES.filter((r) => p.byRarity[r]).map((r) => (
            <span key={r} class="chip">
              {RARITY_LABEL[r]} · {fmt(p.byRarity[r].read)} / {fmt(p.byRarity[r].total)}
            </span>
          ))}
        </div>
      )}
      {on && status && (
        <div class="row">
          <p class="small muted">{status}</p>
          {showTakeover && (
            <button class="btn sm" onClick={takePriceIndexLead}>
              {L("Indexer dans cet onglet", "Index in this tab")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function PricesTab() {
  useStore(priceVersion);
  const [copies, setCopies] = useState(null);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState(null);
  const [view, setView] = useState("top"); // "top" : les plus chères ; "filter" : collection filtrée
  const [filter, setFilter] = useState({...DEFAULT_FILTER, sale: "never"});

  useEffect(() => {
    loadMyCollection()
      .then(setCopies)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  // Exemplaires regroupés par carte, rareté et version (même prix, la version reste affichée)
  const unique = useMemo(() => {
    if (!copies) return [];
    const m = new Map();
    for (const c of copies) {
      const key = `${c.card_id}|${c.rarity}|${c.is_shiny ? 1 : 0}`;
      const prev = m.get(key);
      m.set(key, prev ? {...prev, count: prev.count + c.count} : {...c});
    }
    return [...m.values()];
  }, [copies]);

  const valued = unique.map((c) => ({...c, price: priceOf(c.card_id, c.rarity, {shiny: c.is_shiny})}));
  const total = valued.reduce((n, c) => n + (c.price || 0) * c.count, 0);
  const pricedCopies = valued.filter((c) => c.price != null).reduce((n, c) => n + c.count, 0);
  // Vendus, mais trop peu de fois pour un prix fiable : hors de la valeur et du classement
  const fewCopies = valued.filter((c) => priceStatus(c.card_id, c.rarity, {shiny: c.is_shiny}) === "few").reduce((n, c) => n + c.count, 0);
  const allCopies = valued.reduce((n, c) => n + c.count, 0);
  const byRarity = RARITIES.map((r) => {
    const list = valued.filter((c) => c.rarity === r);
    return {r, copies: list.reduce((n, c) => n + c.count, 0), priced: list.filter((c) => c.price != null).length, value: list.reduce((n, c) => n + (c.price || 0) * c.count, 0)};
  });
  // Thème de chaque carte, calculé une seule fois (le classement est recalculé à chaque prix reçu)
  const themeCache = useMemo(() => themeMemo(), [copies]);
  const themeOf = (card) => themeCache(card.id, card);
  const ranking = useMemo(
    () =>
      valued
        .filter((c) => c.price != null)
        .map((c) => ({...c, theme: themeOf(c.card)}))
        .sort((a, b) => b.price - a.price),
    [copies, priceVersion.get().v],
  );
  const themes = [...new Set(ranking.map((c) => c.theme))].sort();

  return (
    <div class="stack">
      <div class="page-head">
        <div>
          <h2>{L("Prix", "Prices")}</h2>
          <p>
            {L(
              `Prix du marché de chaque exemplaire dans sa rareté : le prix moyen de la semaine, comme dans l'onglet Marché de la fiche d'une carte sur le site (le site ne distingue pas les shiny). Un prix n'est retenu qu'à partir de ${plural(priceOptions().minSales, "vente")} sur les 12 dernières semaines (onglet Réglages). Les prix sont gardés dans votre navigateur et affichés sur les cartes du site.`,
              `Market price of each copy in its rarity: the week's average price, as in the Market tab of a card's page on the site (the site does not separate shiny cards). A price is only used from ${plural(priceOptions().minSales, "sale")} in the last 12 weeks (Settings tab). Prices are kept in your browser and shown on the site's cards.`,
            )}
          </p>
        </div>
      </div>
      {error && <Notice type="error">{error}</Notice>}
      {!copies && !error && <Progress label={L("Lecture de votre collection", "Reading your collection")} done={0} />}
      {copies && (
        <>
          <div class="grid-stats">
            <div class="stat"><div class="k">{L("Valeur estimée", "Estimated value")}</div><div class="v"><Money v={total} /></div></div>
            <div class="stat"><div class="k">{L("Exemplaires avec un prix", "Copies with a price")}</div><div class="v">{fmt(pricedCopies)} / {fmt(allCopies)}</div></div>
            {fewCopies > 0 && (
              <div class="stat" title={L("Vendus trop peu de fois pour un prix fiable : ils ne comptent pas dans la valeur estimée", "Sold too few times for a reliable price: not counted in the estimated value")}>
                <div class="k">{L("Prix incertain", "Uncertain price")}</div>
                <div class="v">{fmt(fewCopies)}</div>
              </div>
            )}
            {byRarity.filter((b) => b.copies).slice(0, 4).map((b) => (
              <div class="stat" key={b.r}><div class="k">{RARITY_LABEL[b.r]}</div><div class="v"><Money v={b.value} /></div></div>
            ))}
          </div>

          <IndexBox />

          <div class="box stack">
            <div class="row">
              <h3 style={{flex: 1}}>{view === "filter" ? L("Filtrer ma collection", "Filter my collection") : L("Mes cartes les plus chères", "My most valuable cards")}</h3>
              <div class="seg" role="tablist">
                <button role="tab" aria-selected={view === "top"} class={view === "top" ? "on" : ""} onClick={() => setView("top")}>
                  {L("Les plus chères", "Most valuable")}
                </button>
                <button role="tab" aria-selected={view === "filter"} class={view === "filter" ? "on" : ""} onClick={() => setView("filter")}>
                  {L("Filtrer", "Filter")}
                </button>
              </div>
            </div>
            {view === "filter" ? (
              <>
                <CollectionFilters filter={filter} onChange={(patch) => setFilter((f) => ({...f, ...patch}))} />
                <CollectionCards filter={filter} />
              </>
            ) : (
              <>
                <div class="chips">
                  {themes.map((t) => (
                    <button key={t} class={`chip${theme === t ? " on" : ""}`} onClick={() => setTheme(theme === t ? null : t)}>
                      {t}
                    </button>
                  ))}
                </div>
                <Paged
                  items={theme ? ranking.filter((c) => c.theme === theme) : ranking}
                  pageSize={30}
                  empty={L("Aucun prix chargé pour l'instant.", "No prices loaded yet.")}
                  render={(c) => (
                    <CardRow
                      key={`${c.card_id}|${c.rarity}|${c.is_shiny ? 1 : 0}`}
                      card={c.card}
                      rarity={c.rarity}
                      theme={c.theme}
                      price={c.price}
                      badges={[c.count > 1 && {label: `×${c.count}`, type: "ok"}, c.is_shiny && {label: "shiny", type: "warn", icon: "shine"}]}
                    />
                  )}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
