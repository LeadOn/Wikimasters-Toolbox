// Bloc de la Toolbox dans la fenêtre « Échanger avec … » du site, sous sa recherche : filtres sur la
// collection entière de l'onglet ouvert (cartes de l'ami ou les miennes) — prix (mêmes choix que la
// ligne « Ventes » des filtres de la collection), raretés, mots du nom ou de la description, thème,
// cartes que je n'ai pas, hors favoris, doublons — et ordre de la liste. Dès qu'un critère est choisi,
// la liste des cartes qui le passent remplace la grille du site (une page de cartes, masquée par
// features/site-dom.js). Chaque carte dit si elle est en favori (verrouillée : le site ne l'échange
// pas) et si je la possède déjà. « Ajouter » la choisit dans la grille du site, comme un clic du
// joueur ; un échec s'affiche sur la ligne. La liste s'affiche dès la collection lue ; ses prix ne
// sont lus que pour un filtre de prix ou sur un clic (« Lire les prix »), et leur lecture s'arrête sans
// perdre la liste. Un échange préparé dans l'onglet « Échanges » avec cet ami (features/trades.js)
// montre en tête les cartes choisies de l'onglet ouvert, à ajouter de la même façon. L'offre part
// toujours avec le bouton du site.
import {useEffect, useState} from "preact/hooks";
import {useStore} from "../../lib/store";
import {tradeFilter, setTradeFilter, tradeSide, loadTradeSide, loadSidePrices, stopSidePrices, stopTradeSide, isActive, covers, matchesPrice, filterTradeItems, itemPrice, itemMatcher, ownedByMe, themeOfItem} from "../../features/trade-filter";
import {preparedTrade, loadPreparedTrade, clearPreparedTrade, preparedFor} from "../../features/trades";
import {themeNames} from "../../state/themes";
import {priceOf, priceVersion} from "../../state/prices";
import {normTitle} from "../../lib/registry";
import {RANGES, PriceInput} from "../CollectionCards";
import {CardRow, Icon, Mark, Paged, Progress, Rarity, fmt, plural} from "../components";
import {errorMessage} from "../feedback";
import {RARITIES} from "../../../../../core";
import {L} from "../../../shared/i18n";

const Count = ({n}) => (n == null ? null : <span class="n">{fmt(n)}</span>);
const sideOf = (friend, theirs) => (theirs ? `friend:${friend.toLowerCase()}` : "mine");

// Bouton d'ajout à l'offre : « Choisie » quand la carte est déjà dans les cartes choisies de l'onglet ;
// désactivé pour un exemplaire en favori (verrouillé par le site) ; l'échec s'affiche dessous
function AddButton({it, chosen, onAdd}) {
  const [state, setState] = useState({busy: false, error: null});
  if (chosen)
    return (
      <span class="chip accent">
        <Icon name="check" size={12} /> {L("Choisie", "Selected")}
      </span>
    );
  const add = async () => {
    setState({busy: true, error: null});
    try {
      await onAdd({title: it.title, rarity: it.rarity, shiny: it.shiny});
      setState({busy: false, error: null});
    } catch (e) {
      setState({busy: false, error: errorMessage(e)});
    }
  };
  return (
    <span class="tf-add">
      <button
        class="btn sm"
        disabled={state.busy || it.starred === true}
        title={it.starred ? L("En favori : exemplaire verrouillé, le site ne permet pas de l'échanger", "Favorite: locked copy, the site does not allow trading it") : L("Choisir cette carte dans l'offre (grille du site)", "Select this card in the offer (site grid)")}
        onClick={add}
      >
        {state.busy ? <span class="spinner sm" aria-label={L("Ajout en cours", "Adding")} /> : <Icon name="plus" size={12} />}
        {L("Ajouter", "Add")}
      </button>
      {state.error && (
        <span class="tf-error" role="alert">
          {state.error}
        </span>
      )}
    </span>
  );
}

// Cartes de l'échange préparé dans l'onglet « Échanges », pour l'onglet ouvert de la fenêtre
function PreparedCards({trade, theirs, friend, chosen, onAdd}) {
  const cards = theirs ? trade.ask : trade.offer;
  const other = theirs ? trade.offer.length : trade.ask.length;
  const added = cards.filter((c) => chosen.has(`${normTitle(c.title)}|${c.rarity}`)).length;
  return (
    <div class="tf-prepared">
      <div class="trade-filter-count small">
        <span>
          <strong>{theirs ? L("À demander", "To ask for") : L("À proposer", "To offer")}</strong>
          <span class="muted">
            {" · "}
            {L(`préparé dans la Toolbox, ${fmt(added)} sur ${fmt(cards.length)} dans l'offre`, `prepared in the Toolbox, ${fmt(added)} of ${fmt(cards.length)} in the offer`)}
            {other > 0 &&
              (theirs
                ? L(` · ${plural(other, "carte")} à proposer dans « Mes cartes »`, ` · ${plural(other, "card")} to offer under "Mes cartes"`)
                : L(` · ${plural(other, "carte")} à demander dans « Cartes de ${friend} »`, ` · ${plural(other, "card")} to ask for under "Cartes de ${friend}"`))}
          </span>
        </span>
        <button class="btn sm ghost" title={L("Retirer cet échange préparé (les cartes déjà ajoutées restent dans l'offre)", "Drop this prepared trade (cards already added stay in the offer)")} onClick={() => clearPreparedTrade()}>
          {L("Oublier", "Forget")}
        </button>
      </div>
      {cards.length > 0 && (
        <Paged
          items={cards}
          pageSize={30}
          class="mini trade-filter-list"
          render={(c) => (
            <CardRow
              key={`${c.card_id}|${c.shiny}`}
              card={c.card}
              rarity={c.rarity}
              price={priceOf(c.card_id, c.rarity, {shiny: c.shiny})}
              badges={[c.shiny && {label: "Shiny", type: "warn", icon: "shine"}]}
              action={<AddButton it={c} chosen={chosen.has(`${normTitle(c.title)}|${c.rarity}`)} onAdd={onAdd} />}
            />
          )}
        />
      )}
    </div>
  );
}

const ORDERS = [
  {id: "price-desc", label: L("Prix décroissant", "Price, high to low")},
  {id: "price-asc", label: L("Prix croissant", "Price, low to high")},
  {id: "rarity", label: L("Rareté", "Rarity")},
];

// friend : pseudo ; theirs : onglet « Cartes de … » ouvert ; selected : [{title, rarity}] cartes
// choisies de l'onglet ; onAdd({title, rarity, shiny}) : choisit la carte dans la grille du site
export function TradeFilter({friend, theirs, selected = [], onAdd}) {
  const f = useStore(tradeFilter);
  const side = useStore(tradeSide);
  const prepared = preparedFor(useStore(preparedTrade).trade, friend);
  useStore(priceVersion);
  const filtering = isActive(f);
  const wantedSide = sideOf(friend, theirs);
  const loaded = side.side === wantedSide && side.status !== "idle" && covers(side.read, theirs ? f.rarities : []);
  const read = (refresh = false) => loadTradeSide({friend, theirs, rarities: f.rarities, refresh, withPrices: Boolean(f.sale) || side.prices === "done"});

  useEffect(() => {
    loadPreparedTrade();
  }, []);
  // Mes cartes : lues d'office (rapide) ; celles de l'ami sur clic. Une lecture en cours qui ne
  // correspond plus à l'onglet ou aux raretés choisies est arrêtée.
  useEffect(() => {
    if (filtering && !theirs && !loaded) read();
    else if (side.status === "loading" && (!filtering || !loaded)) stopTradeSide();
  }, [filtering, theirs, loaded, side.status]);
  // Prix : lus d'office pour un filtre de prix (sauf si le joueur a arrêté leur lecture), arrêtés
  // quand plus aucun critère n'est choisi
  useEffect(() => {
    if (!filtering) stopSidePrices("idle");
    else if (f.sale && loaded && side.status === "ready" && side.prices === "idle") loadSidePrices();
  }, [filtering, f.sale, loaded, side.status, side.prices]);

  const ready = loaded && side.items.length > 0;
  // Cartes qui passent les critères autres que le prix (les nombres des choix de prix en partent)
  const others = ready ? side.items.filter(itemMatcher(f)) : [];
  const count = (filter) => (ready ? others.filter((it) => matchesPrice(itemPrice(it), filter) === true).length : null);
  const list = ready && filtering ? filterTradeItems(side.items, f) : [];
  const unread = ready && f.sale ? others.filter((it) => itemPrice(it).status === "unknown").length : 0;
  const themeCounts = new Map();
  if (ready) for (const it of side.items.filter(itemMatcher(f, {skip: "theme"}))) themeCounts.set(themeOfItem(it), (themeCounts.get(themeOfItem(it)) || 0) + 1);
  const toggle = (k) => setTradeFilter({[k]: !f[k]});
  const chosen = new Set(selected.map((s) => `${normTitle(s.title)}|${s.rarity}`));
  const isRange = (r) => r.min === f.min && r.max === f.max;
  const custom = !RANGES.some(isRange);
  const toggleRarity = (r) => setTradeFilter({rarities: f.rarities.includes(r) ? f.rarities.filter((x) => x !== r) : [...f.rarities, r]});
  const whose = theirs ? L(`collection de ${friend}`, `${friend}'s collection`) : L("ma collection", "my collection");

  return (
    <section class="island compact trade-filter" aria-label={L("Filtrer les cartes par prix (WikiMasters Toolbox)", "Filter the cards by price (WikiMasters Toolbox)")}>
      {prepared && <PreparedCards trade={prepared} theirs={theirs} friend={friend} chosen={chosen} onAdd={onAdd} />}
      <div class="filters">
        <div class="filter-row">
          <span class="trade-filter-head">
            <Mark size={16} />
            <span class="filter-k">{L("Prix", "Price")}</span>
          </span>
          <div class="seg" role="group" aria-label={L(`Prix · ${whose}`, `Price · ${whose}`)}>
            <button class={!f.sale ? "on" : ""} aria-pressed={!f.sale} onClick={() => setTradeFilter({sale: null})}>
              {L("Tous les prix", "Any price")}
            </button>
            <button class={f.sale === "never" ? "on" : ""} aria-pressed={f.sale === "never"} onClick={() => setTradeFilter({sale: "never"})}>
              {L("Jamais vendues", "Never sold")} <Count n={count({sale: "never"})} />
            </button>
            <button class={f.sale === "range" ? "on" : ""} aria-pressed={f.sale === "range"} onClick={() => setTradeFilter({sale: "range"})}>
              {L("Vendues entre…", "Sold between…")}
            </button>
          </div>
        </div>
        <div class="filter-row">
          <span class="filter-k">{L("Cartes", "Cards")}</span>
          <input
            class="tf-search"
            type="search"
            value={f.q}
            placeholder={L("Nom ou description (-mot : exclure)", "Name or description (-word: exclude)")}
            aria-label={L("Mots du nom ou de la description, tous exigés ; -mot pour l'exclure", "Words of the name or description, all required; -word to exclude it")}
            onInput={(e) => setTradeFilter({q: e.currentTarget.value})}
          />
          <select class="mini-select" aria-label={L("Thème", "Theme")} value={f.theme} onChange={(e) => setTradeFilter({theme: e.currentTarget.value})}>
            <option value="">{L("Tous les thèmes", "All themes")}</option>
            {themeNames().map((t) => (
              <option key={t} value={t}>
                {t}
                {ready ? ` (${fmt(themeCounts.get(t) || 0)})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div class="filter-row">
          <span class="filter-k" aria-hidden="true" />
          <div class="chips" role="group" aria-label={L("Raretés (aucune : toutes)", "Rarities (none: all)")}>
            {RARITIES.map((r) => {
              const on = f.rarities.includes(r);
              return (
                <button key={r} class={`chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggleRarity(r)}>
                  <Rarity r={r} />
                </button>
              );
            })}
          </div>
          <div class="chips" role="group" aria-label={L("Critères cumulables", "Filters that can be combined")}>
            {theirs && (
              <button class={`chip${f.missing ? " on" : ""}`} aria-pressed={f.missing} onClick={() => toggle("missing")}>
                {f.missing && <Icon name="check" size={12} />}
                {L("Je ne l'ai pas", "I don't have it")}
              </button>
            )}
            <button class={`chip${f.unstarred ? " on" : ""}`} aria-pressed={f.unstarred} onClick={() => toggle("unstarred")}>
              {f.unstarred && <Icon name="check" size={12} />}
              {L("Hors favoris", "No favorites")}
            </button>
            <button class={`chip${f.doubles ? " on" : ""}`} aria-pressed={f.doubles} onClick={() => toggle("doubles")}>
              {f.doubles && <Icon name="check" size={12} />}
              {L("Doublons", "Duplicates")}
            </button>
          </div>
        </div>
        {f.sale === "range" && (
          <div class="filter-row">
            <span class="filter-k" aria-hidden="true" />
            <div class={`chip price-range${custom ? " on" : ""}`} role="group" aria-label={L("Prix du marché, bornes incluses", "Market price, bounds included")}>
              <span>{L("de", "from")}</span>
              <PriceInput value={f.min} onValue={(min) => setTradeFilter({min})} label={L("Prix minimum, en WikiBidous", "Minimum price, in WikiBidous")} placeholder="min" />
              <span>{L("à", "to")}</span>
              <PriceInput value={f.max} onValue={(max) => setTradeFilter({max})} label={L("Prix maximum, en WikiBidous", "Maximum price, in WikiBidous")} placeholder="max" />
              <span>₩</span>
            </div>
            <div class="chips" role="group" aria-label={L("Tranches de prix", "Price ranges")}>
              {RANGES.map((r) => (
                <button key={r.label} class={`chip${isRange(r) ? " on" : ""}`} aria-pressed={isRange(r)} onClick={() => setTradeFilter({min: r.min, max: r.max})}>
                  {r.label} <Count n={count({sale: "range", min: r.min, max: r.max})} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {filtering && !loaded && theirs && (
        <div class="trade-filter-read">
          <span class="small muted">
            {L(
              `Les filtres portent sur toute la ${whose}, lue par pages de 50 cartes et gardée 12 h. Ses prix ne sont lus que pour un filtre de prix, ou sur demande. Choisir des raretés accélère la lecture.`,
              `The filters cover ${whose} as a whole, read 50 cards at a time and kept 12 h. Its prices are only read for a price filter, or on request. Picking rarities makes it faster.`,
            )}
          </span>
          <button class="btn sm primary" onClick={() => read()}>
            {L(`Lire sa collection${f.rarities.length ? ` (${f.rarities.join(", ")})` : ""}`, `Read their collection${f.rarities.length ? ` (${f.rarities.join(", ")})` : ""}`)}
          </button>
        </div>
      )}
      {filtering && loaded && side.status === "loading" && (
        <div class="trade-filter-read">
          <div style={{flex: 1, minWidth: 0}}>{side.progress ? <Progress done={side.progress.done} total={side.progress.total} label={side.step} /> : <span class="small muted">{side.step}</span>}</div>
          <button class="btn sm ghost" onClick={stopTradeSide}>
            {L("Arrêter", "Stop")}
          </button>
        </div>
      )}
      {filtering && loaded && side.status === "error" && (
        <div class="trade-filter-read">
          <span class="small" style={{color: "var(--danger)"}}>{side.error}</span>
          <button class="btn sm" onClick={() => read()}>{L("Réessayer", "Retry")}</button>
        </div>
      )}
      {filtering && loaded && side.status === "ready" && side.prices === "loading" && (
        <div class="trade-filter-read">
          <div style={{flex: 1, minWidth: 0}}>
            <Progress done={side.priceProgress?.done || 0} total={side.priceProgress?.total} label={L("Lecture des prix (la liste reste utilisable)", "Reading prices (the list stays usable)")} />
          </div>
          <button class="btn sm ghost" title={L("Arrêter la lecture des prix : les prix déjà lus restent affichés", "Stop reading prices: prices already read stay shown")} onClick={() => stopSidePrices()}>
            {L("Arrêter les prix", "Stop prices")}
          </button>
        </div>
      )}
      {filtering && ready && side.status === "ready" && (
        <>
          <div class="trade-filter-count small muted" aria-live="polite">
            <span>
              {L(`${plural(list.length, "carte")} sur ${fmt(side.items.length)}`, `${plural(list.length, "card")} out of ${fmt(side.items.length)}`)}
              {theirs && side.total > side.items.length && !side.read.length && ` · ${L(`${fmt(side.total)} au total`, `${fmt(side.total)} in total`)}`}
              {unread > 0 &&
                ` · ${side.prices === "done" ? L(plural(unread, "prix illisible", "prix illisibles"), plural(unread, "unreadable price")) : L(plural(unread, "prix non lu", "prix non lus"), plural(unread, "price not read", "prices not read"))}`}
            </span>
            <select class="mini-select" aria-label={L("Ordre", "Order")} value={f.order} onChange={(e) => setTradeFilter({order: e.currentTarget.value})}>
              {ORDERS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {side.prices !== "loading" && side.prices !== "done" && (
              <button class="btn sm ghost" title={L("Lire les prix de ces cartes, pour les filtrer ou les trier par prix", "Read these cards' prices, to filter or sort them by price")} onClick={() => loadSidePrices()}>
                {L("Lire les prix", "Read prices")}
              </button>
            )}
            <button class="btn sm ghost" title={L("Relire la collection", "Read the collection again")} onClick={() => read(true)}>
              <Icon name="refresh" size={12} /> {L("Actualiser", "Refresh")}
            </button>
          </div>
          <Paged
            items={list}
            pageSize={30}
            class="mini trade-filter-list"
            empty={L("Aucune carte ne passe ce filtre.", "No card matches this filter.")}
            render={(it) => (
              <CardRow
                key={it.key}
                card={it.card}
                rarity={it.rarity}
                price={itemPrice(it).price}
                badges={[
                  it.starred && {label: L("Favori", "Favorite"), type: "warn", icon: "star"},
                  theirs && ownedByMe(it) === true && {label: L("Possédée", "Owned"), type: "ok", icon: "check"},
                  theirs && ownedByMe(it) === false && {label: L("Nouvelle", "New"), type: "accent"},
                  it.shiny && {label: "Shiny", type: "warn", icon: "shine"},
                  it.count > 1 && {label: `×${it.count}`},
                  it.pending && {label: L("en échange", "in a trade"), type: "warn"},
                ]}
                action={<AddButton it={it} chosen={chosen.has(`${normTitle(it.title)}|${it.rarity}`)} onAdd={onAdd} />}
              />
            )}
          />
        </>
      )}
    </section>
  );
}
