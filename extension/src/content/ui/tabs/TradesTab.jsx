// Onglet « Échanges » : trouver quoi échanger avec un ami, choisir les cartes de chaque côté (offre
// équilibrée en un clic), préparer l'échange pour la fenêtre « Échanger avec … » du site (rien n'est
// envoyé : le joueur y ajoute les cartes et envoie l'offre avec le bouton du site), échanges en cours.
import {useState, useEffect, useMemo, useRef} from "preact/hooks";
import {useStore} from "../../lib/store";
import {readSession} from "../../lib/session";
import {friendsState, tradeState, loadFriends, findTradesWith, activeTrades, refreshTrades, preparedTrade, prepareTrade, clearPreparedTrade, loadPreparedTrade, preparedFor} from "../../features/trades";
import {profileFor} from "../../state/profiles";
import {priceOf, priceVersion, loadPrices} from "../../state/prices";
import {CardRow, Paged, Progress, Notice, fmt, plural, timeAgo} from "../components";
import {toast, errorMessage} from "../feedback";
import {RARITIES, balanceOffer} from "../../../../../core";
import {themeNames} from "../../state/themes";
import {L} from "../../../shared/i18n";

function countBy(list, key) {
  const m = new Map();
  for (const x of list) m.set(key(x), (m.get(key(x)) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

function Section({title, items, render, extra, help}) {
  const [theme, setTheme] = useState(null);
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase();
    return items.filter((c) => (!theme || c.theme === theme) && (!text || `${c.card.wikipedia_title} ${c.card.category || ""}`.toLowerCase().includes(text)));
  }, [items, theme, q]);
  return (
    <div class="box stack">
      <div class="row">
        <h3 style={{flex: 1}}>{title} <span class="muted">({fmt(items.length)})</span></h3>
        {extra}
        <input type="search" placeholder={L("Filtrer…", "Filter…")} style={{maxWidth: "220px"}} value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      </div>
      {help && <p class="help">{help}</p>}
      <div class="chips">
        {countBy(items, (c) => c.theme).map(([t, n]) => (
          <button key={t} class={`chip${theme === t ? " on" : ""}`} onClick={() => setTheme(theme === t ? null : t)}>
            {t} · {n}
          </button>
        ))}
      </div>
      <Paged items={filtered} render={render} empty={L("Aucune carte ne correspond.", "No matching cards.")} />
    </div>
  );
}

function ActiveTrades() {
  const {list, at} = useStore(activeTrades);
  useStore(priceVersion);
  const me = readSession()?.userId;
  useEffect(() => {
    if (!list) refreshTrades().catch(() => {});
  }, []);
  const pending = (list || []).filter((t) => t.status === "pending");
  useEffect(() => {
    const items = pending.flatMap((t) => (t.items || []).map((i) => ({id: i.card_id, rarity: i.snapshot_rarity || i.card?.rarity})));
    if (items.length) loadPrices(items);
  }, [list]);
  // Prix fiable de l'exemplaire échangé (shiny ou non), null sinon
  const itemPrice = (i) => priceOf(i.card_id, i.snapshot_rarity || i.card?.rarity, {shiny: i.is_shiny});
  const side = (t, userId) => {
    const items = (t.items || []).filter((i) => i.offered_by === userId);
    const total = items.reduce((n, i) => n + (itemPrice(i) || 0), 0);
    const bidous = userId === t.initiator_id ? t.initiator_wikibidous || 0 : t.recipient_wikibidous || 0;
    return {items, total: total + bidous, bidous, unknown: items.filter((i) => itemPrice(i) == null).length};
  };
  return (
    <div class="box stack">
      <div class="row">
        <h3 style={{flex: 1}}>{L("Échanges en cours", "Active trades")}</h3>
        <span class="small muted">{at ? L(`mis à jour ${timeAgo(at)}`, `updated ${timeAgo(at)}`) : ""}</span>
        <button class="btn sm" onClick={() => refreshTrades().catch((e) => toast(errorMessage(e), {type: "error"}))}>{L("Actualiser", "Refresh")}</button>
      </div>
      {!pending.length && <p class="help">{L("Aucun échange en attente.", "No pending trades.")}</p>}
      {pending.map((t) => {
        const other = t.initiator_id === me ? t.recipient : t.initiator;
        const mineSide = side(t, me);
        const theirSide = side(t, other?.id);
        const diff = theirSide.total - mineSide.total;
        return (
          <div key={t.id} class="stack" style={{gap: "6px", paddingTop: "8px", borderTop: "1px solid var(--line)"}}>
            <div class="row">
              <strong style={{flex: 1}}>{t.initiator_id === me ? L(`Envoyé à ${other?.username}`, `Sent to ${other?.username}`) : L(`Reçu de ${other?.username}`, `Received from ${other?.username}`)}</strong>
              <span class={`chip ${diff >= 0 ? "ok" : "warn"}`}>{diff >= 0 ? "+" : ""}{fmt(diff)} ₩ {L("pour moi", "for me")}</span>
            </div>
            <div class="grid-2" style={{gap: "8px"}}>
              <div class="small">
                <div class="muted">{L("Je donne", "I give")} · {fmt(mineSide.total)} ₩{mineSide.unknown ? L(` (${mineSide.unknown} sans prix fiable)`, ` (${mineSide.unknown} without a reliable price)`) : ""}</div>
                {mineSide.items.map((i) => <div key={i.id}>{i.card?.wikipedia_title || i.card_id} <span class="muted">{i.snapshot_rarity}{i.is_shiny ? " shiny" : ""}</span> · {fmt(itemPrice(i))} ₩</div>)}
                {mineSide.bidous > 0 && <div>+ {fmt(mineSide.bidous)} WikiBidous</div>}
              </div>
              <div class="small">
                <div class="muted">{L("Je reçois", "I get")} · {fmt(theirSide.total)} ₩{theirSide.unknown ? L(` (${theirSide.unknown} sans prix fiable)`, ` (${theirSide.unknown} without a reliable price)`) : ""}</div>
                {theirSide.items.map((i) => <div key={i.id}>{i.card?.wikipedia_title || i.card_id} <span class="muted">{i.snapshot_rarity}{i.is_shiny ? " shiny" : ""}</span> · {fmt(itemPrice(i))} ₩</div>)}
                {theirSide.bidous > 0 && <div>+ {fmt(theirSide.bidous)} WikiBidous</div>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function TradesTab() {
  const friends = useStore(friendsState);
  const s = useStore(tradeState);
  useStore(priceVersion);
  const [friend, setFriend] = useState("");
  const [useThemes, setUseThemes] = useState(false);
  const [themes, setThemes] = useState([]);
  const [rarities, setRarities] = useState([]);
  // Cartes choisies : à demander (id de l'exemplaire de l'ami), à proposer (card_id)
  const [selected, setSelected] = useState(new Set());
  const [offerSel, setOfferSel] = useState(new Set());
  const [offerScope, setOfferScope] = useState("suggested");
  // Dernière offre équilibrée : ses cartes passent en tête de la liste
  const [balance, setBalance] = useState(null);
  const prepared = useStore(preparedTrade).trade;
  const abort = useRef(null);
  const me = readSession()?.username;

  useEffect(() => {
    if (!friends.list && !friends.loading) loadFriends().catch(() => {});
    loadPreparedTrade();
  }, []);
  useEffect(() => {
    setSelected(new Set());
    setOfferSel(new Set());
    setBalance(null);
  }, [s.result]);

  const start = async (refresh = false) => {
    const f = friends.list?.find((x) => x.username === friend);
    if (!f) return;
    abort.current = new AbortController();
    try {
      await findTradesWith(f, {themes: useThemes ? themes : null, rarities, refresh, signal: abort.current.signal});
    } catch (e) {
      if (e.name !== "AbortError") toast(errorMessage(e), {type: "error"});
    }
  };

  const r = s.result;
  // Prix recalculé à chaque affichage : les prix arrivent après la recherche, et les réglages peuvent changer
  const price = (c) => priceOf(c.card_id, c.card.rarity, {shiny: c.is_shiny});
  const askCards = r ? r.toAsk.filter((c) => selected.has(c.id)) : [];
  const offerCards = r ? r.toOffer.filter((c) => offerSel.has(c.card_id)) : [];
  const target = askCards.reduce((n, c) => n + (price(c) || 0), 0);
  const offerValue = offerCards.reduce((n, c) => n + (price(c) || 0), 0);
  const suggestedCount = r ? r.toOffer.filter((c) => c.suggested).length : 0;
  const offerPool = useMemo(() => (r ? (offerScope === "all" ? r.toOffer : r.toOffer.filter((c) => c.suggested)) : []), [r, offerScope]);
  const offerItems = useMemo(() => (balance ? [...offerPool].sort((a, b) => balance.has(b.card_id) - balance.has(a.card_id)) : offerPool), [offerPool, balance]);
  const preparedHere = r ? preparedFor(prepared, r.friend) : null;
  const toggle = (set, setter, key) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    setter(next);
  };
  const clearSelection = () => {
    setSelected(new Set());
    setOfferSel(new Set());
    setBalance(null);
  };
  const suggestOffer = () => {
    const {chosen} = balanceOffer(target, offerPool.map((c) => ({...c, price: price(c)})));
    const ids = new Set(chosen.map((c) => c.card_id));
    setOfferSel(ids);
    setBalance(ids);
    if (!chosen.length) toast(L("Aucune de ces cartes n'a de prix fiable : chargez les prix, ou choisissez vos cartes à la main.", "None of these cards has a reliable price: load prices, or pick your cards by hand."));
  };
  const prepare = async () => {
    await prepareTrade(r.friend, {ask: askCards, offer: offerCards});
    toast(L(`Échange préparé avec ${r.friend} : ouvrez « Proposer un échange » sur le site.`, `Trade with ${r.friend} prepared: open "Proposer un échange" on the site.`), {type: "ok"});
  };

  const loadVisiblePrices = () => {
    const items = [...r.toAsk, ...r.toOffer].map((c) => ({id: c.card_id, rarity: c.card.rarity}));
    loadPrices(items);
    const n = new Set(items.map((x) => x.id)).size;
    toast(L(`Chargement des prix de ${plural(n, "carte")}…`, `Loading prices for ${plural(n, "card")}…`));
  };

  return (
    <div class="stack">
      <div class="page-head">
        <div>
          <h2>{L("Échanges", "Trades")}</h2>
          <p>
            {L(
              "Les cartes d'un ami qui vous intéressent (votre profil ou votre liste de souhaits), et les vôtres qui l'intéressent (son profil, sinon vos doublons qu'il n'a pas).",
              "A friend's cards that interest you (your profile or wishlist), and yours that interest them (their profile, or else your duplicates they don't have).",
            )}
          </p>
        </div>
      </div>

      <div class="box stack">
        <div class="row" style={{alignItems: "flex-end"}}>
          <label class="field" style={{minWidth: "220px", flex: 1}}>
            <span>{L("Ami", "Friend")}</span>
            <select value={friend} onChange={(e) => setFriend(e.currentTarget.value)}>
              <option value="">{friends.loading ? L("Chargement…", "Loading…") : L("Choisir un ami", "Choose a friend")}</option>
              {(friends.list || []).map((f) => (
                <option key={f.id} value={f.username}>
                  {f.username}
                  {profileFor(f.username) ? "" : L(" (sans profil)", " (no profile)")}
                </option>
              ))}
            </select>
          </label>
          <div class="field">
            <span style={{fontWeight: 600, fontSize: "13px"}}>{L("Raretés lues (vide = toutes)", "Rarities to read (empty = all)")}</span>
            <div class="chips" style={{marginTop: "5px"}}>
              {RARITIES.map((x) => (
                <button key={x} class={`chip${rarities.includes(x) ? " on" : ""}`} onClick={() => setRarities(rarities.includes(x) ? rarities.filter((y) => y !== x) : [...rarities, x])}>
                  {x}
                </button>
              ))}
            </div>
          </div>
        </div>
        <label class="check">
          <input type="checkbox" checked={useThemes} onChange={(e) => setUseThemes(e.currentTarget.checked)} />
          {L("Chercher des thèmes précis plutôt que mon profil", "Search for specific themes instead of my profile")}
          {!profileFor(me) && !useThemes ? L(" (vous n'avez pas encore de profil)", " (you don't have a profile yet)") : ""}
        </label>
        {useThemes && (
          <div class="chips">
            {themeNames().map((t) => (
              <button key={t} class={`chip${themes.includes(t) ? " on" : ""}`} onClick={() => setThemes(themes.includes(t) ? themes.filter((x) => x !== t) : [...themes, t])}>
                {t}
              </button>
            ))}
          </div>
        )}
        <div class="row">
          {!s.running ? (
            <>
              <button class="btn primary" disabled={!friend || (useThemes && !themes.length)} onClick={() => start(false)}>{L("Chercher", "Search")}</button>
              {r && r.friend === friend && <button class="btn ghost" onClick={() => start(true)}>{L("Relire sa collection", "Reload their collection")}</button>}
            </>
          ) : (
            <button class="btn danger" onClick={() => abort.current?.abort()}>{L("Arrêter", "Stop")}</button>
          )}
          <span class="small muted">
            {L(
              "La collection d'un ami est lue page par page puis gardée 12 h. Une lecture interrompue reprend où elle s'était arrêtée. Filtrer les raretés accélère la lecture.",
              "A friend's collection is read page by page, then kept for 12 hours. An interrupted read resumes where it stopped. Filtering rarities speeds it up.",
            )}
          </span>
        </div>
        {s.running && <Progress done={s.progress?.done || 0} total={s.progress?.total} label={s.step} />}
        {s.error && !s.running && <Notice type="error">{s.error}</Notice>}
      </div>

      {r && !s.running && (
        <>
          <div class="row small muted">
            {L(
              `Collection de ${r.friend} lue ${timeAgo(r.fetchedAt)} (${fmt(r.total)} cartes${r.rarities.length ? `, raretés ${r.rarities.join(", ")}` : ""}) · recherché : ${r.wanted.join(", ")}`,
              `${r.friend}'s collection read ${timeAgo(r.fetchedAt)} (${fmt(r.total)} cards${r.rarities.length ? `, rarities ${r.rarities.join(", ")}` : ""}) · searched for: ${r.wanted.join(", ")}`,
            )}
            <span class="spacer" />
            <button class="btn sm" onClick={loadVisiblePrices}>{L("Charger les prix", "Load prices")}</button>
          </div>
          {(selected.size > 0 || offerSel.size > 0) && (
            <div class="box row">
              <span style={{flex: 1}}>
                {L(`Je demande ${plural(askCards.length, "carte")} (${fmt(target)} ₩) · je propose ${plural(offerCards.length, "carte")} (${fmt(offerValue)} ₩)`, `I ask for ${plural(askCards.length, "card")} (${fmt(target)} ₩) · I offer ${plural(offerCards.length, "card")} (${fmt(offerValue)} ₩)`)}
                {askCards.length > 0 && offerCards.length > 0 && (
                  <span class="muted">
                    {" · "}
                    {L(`écart ${target - offerValue >= 0 ? "+" : ""}${fmt(target - offerValue)} ₩ pour moi`, `difference ${target - offerValue >= 0 ? "+" : ""}${fmt(target - offerValue)} ₩ for me`)}
                  </span>
                )}
              </span>
              <button class="btn sm ghost" onClick={clearSelection}>{L("Effacer", "Clear")}</button>
              <button class="btn sm" disabled={!target} title={L("Choisit parmi les cartes à proposer affichées un lot de valeur équivalente", "Picks a lot of equal value among the cards to offer shown")} onClick={suggestOffer}>
                {L("Proposer une offre équilibrée", "Suggest a balanced offer")}
              </button>
              <button class="btn sm primary" title={L("Les cartes choisies vous attendront dans la fenêtre « Échanger avec … » du site", "The selected cards will wait for you in the site's \"Échanger avec …\" window")} onClick={prepare}>
                {L("Préparer l'échange", "Prepare the trade")}
              </button>
            </div>
          )}
          {preparedHere && (
            <Notice type="ok">
              <div class="row">
                <span style={{flex: 1}}>
                  {L(
                    `Échange préparé avec ${preparedHere.friend} (${plural(preparedHere.ask.length, "carte")} à demander, ${plural(preparedHere.offer.length, "carte")} à proposer). Sur la page Échanges du site, ouvrez « Proposer un échange » avec ${preparedHere.friend} : dans chaque onglet de la fenêtre, la Toolbox liste ces cartes avec un bouton Ajouter. L'offre part avec le bouton du site.`,
                    `Trade with ${preparedHere.friend} prepared (${plural(preparedHere.ask.length, "card")} to ask for, ${plural(preparedHere.offer.length, "card")} to offer). On the site's Trades page, open "Proposer un échange" with ${preparedHere.friend}: in each tab of the window, the Toolbox lists these cards with an Add button. The offer is sent with the site's button.`,
                  )}
                </span>
                <a class="btn sm" href="/trades">{L("Page Échanges du site", "Site's Trades page")}</a>
                <button class="btn sm ghost" onClick={() => clearPreparedTrade()}>{L("Oublier", "Forget")}</button>
              </div>
            </Notice>
          )}
          <Section
            title={L(`À demander à ${r.friend}`, `To ask ${r.friend} for`)}
            items={r.toAsk}
            help={L("Cliquez sur une carte pour la demander. Une carte en favori chez votre ami est verrouillée par le site.", "Click a card to ask for it. A card your friend marked as favorite is locked by the site.")}
            render={(c) => (
              <CardRow
                key={c.id}
                card={c.card}
                theme={c.theme}
                price={price(c)}
                selected={selected.has(c.id)}
                onClick={c.starred ? undefined : () => toggle(selected, setSelected, c.id)}
                badges={[
                  c.starred && {label: L("Favori", "Favorite"), type: "warn", icon: "star"},
                  c.wished && {label: L("souhaitée", "wishlisted"), type: "danger", icon: "heart"},
                  c.spare && {label: L(`${c.count} ex.`, `${c.count} copies`), type: "ok"},
                  c.is_shiny && {label: "shiny", type: "warn", icon: "shine"},
                  c.pending && {label: L("échange en cours", "trade pending"), type: "warn"},
                ]}
              />
            )}
          />
          <Section
            title={L(`À proposer à ${r.friend}`, `To offer ${r.friend}`)}
            items={offerItems}
            extra={
              <div class="seg" role="group" aria-label={L("Cartes à proposer", "Cards to offer")}>
                <button class={offerScope === "suggested" ? "on" : ""} aria-pressed={offerScope === "suggested"} onClick={() => (setOfferScope("suggested"), setBalance(null))}>
                  {r.friendTag ? L("Son profil", "Their profile") : L("Mes doublons", "My duplicates")} <span class="n">{fmt(suggestedCount)}</span>
                </button>
                <button class={offerScope === "all" ? "on" : ""} aria-pressed={offerScope === "all"} onClick={() => (setOfferScope("all"), setBalance(null))}>
                  {L("Tout ce qu'il n'a pas", "All they lack")} <span class="n">{fmt(r.toOffer.length)}</span>
                </button>
              </div>
            }
            help={L("Cliquez sur une carte pour la proposer. Une carte dont tous vos exemplaires sont en favori est verrouillée par le site.", "Click a card to offer it. A card whose copies are all favorites is locked by the site.")}
            render={(c) => (
              <CardRow
                key={c.card_id}
                card={c.card}
                theme={c.theme}
                price={price(c)}
                selected={offerSel.has(c.card_id)}
                onClick={c.locked ? undefined : () => toggle(offerSel, setOfferSel, c.card_id)}
                badges={[
                  c.spare && {label: L(`${c.copies} ex. chez moi`, `I own ${c.copies}`), type: "ok"},
                  c.locked && {label: L("Favori", "Favorite"), type: "warn", icon: "star"},
                ]}
              />
            )}
          />
        </>
      )}

      <ActiveTrades />
    </div>
  );
}
