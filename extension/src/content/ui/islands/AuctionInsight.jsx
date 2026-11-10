// Bloc de la Toolbox sur la page d'une enchère : prix du marché, écart entre la mise et ce prix,
// carte déjà possédée ou non, amis intéressés, mises déjà faites sur une autre enchère de la même
// carte, autres enchères en cours de la carte (fenêtre ui/CardAuctions.jsx). Lecture seule : la mise
// se fait avec le formulaire du site.
import {useEffect, useState} from "preact/hooks";
import {useStore} from "../../lib/store";
import {owned} from "../../state/collection";
import {priceOf, priceVersion} from "../../state/prices";
import {auctionById, auctionVersion, loadAuction, nextBid, isLeading, isMySale, msLeft, cardMarket} from "../../features/market";
import {openCardAuctions} from "../CardAuctions";
import {Icon, Mark, Money, duration, fmt} from "../components";
import {PriceLine, Interest} from "./shared";
import {L} from "../../../shared/i18n";

// Écart d'une mise au prix du marché (fiable seulement), en %
const gapOf = (amount, avg) => (avg ? Math.round((100 * (amount - avg)) / avg) : null);

function Gap({gap}) {
  if (gap == null) return null;
  if (gap <= -20) return <span class="chip ok">{L(`${-gap} % sous le prix du marché`, `${-gap}% below market price`)}</span>;
  if (gap >= 20) return <span class="chip warn">{L(`${gap} % au-dessus du prix du marché`, `${gap}% above market price`)}</span>;
  return <span class="chip">{L(`proche du prix du marché (${gap > 0 ? "+" : ""}${gap} %)`, `close to market price (${gap > 0 ? "+" : ""}${gap}%)`)}</span>;
}

// Enchères en cours de la carte et mes mises dessus (features/market.js, cardMarket), lues une fois
// par page : null pendant la lecture, {error} si elle échoue
function useCardMarket(cardId) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!cardId) return undefined;
    let live = true;
    setState(null);
    cardMarket(cardId)
      .then((res) => live && setState(res))
      .catch(() => live && setState({error: true}));
    return () => {
      live = false;
    };
  }, [cardId]);
  return state;
}

// Je mise déjà sur une autre enchère de cette carte (ou j'en vends un exemplaire) : signalé en tête
// du bloc, pour ne pas en gagner deux sans le vouloir
const SHOWN_BIDS = 3;
function AlreadyBidding({market, auctionId}) {
  if (!market?.auctions) return null;
  const others = market.auctions.filter((a) => a.id !== auctionId);
  const bidding = others.filter((a) => market.myBids.has(a.id));
  const selling = others.filter(isMySale);
  if (!bidding.length && !selling.length) return null;
  return (
    <div class="already">
      {bidding.length > 0 && (
        <>
          <div class="already-title">
            <Icon name="alert" size={14} />
            {L(
              bidding.length === 1 ? "Vous misez déjà sur une autre enchère de cette carte" : `Vous misez déjà sur ${bidding.length} autres enchères de cette carte`,
              bidding.length === 1 ? "You are already bidding on another auction for this card" : `You are already bidding on ${bidding.length} other auctions for this card`,
            )}
          </div>
          {bidding.slice(0, SHOWN_BIDS).map((a) => (
            <div key={a.id} class="already-row">
              {isLeading(a) ? <span class="chip me">{L("En tête", "Leading")}</span> : <span class="chip warn">{L("Surenchéri", "Outbid")}</span>}
              <span class="small">
                {L("votre mise", "your bid")} <Money v={market.myBids.get(a.id)} />
                {!isLeading(a) && a.current_bid != null && (
                  <>
                    {" · "}
                    {L("actuelle", "current")} <Money v={a.current_bid} />
                  </>
                )}
                {` · ${L("fin dans", "ends in")} ${duration(msLeft(a))}`}
              </span>
              <a class="btn sm" href={`/marketplace/${a.id}`}>
                {L("Voir", "View")}
              </a>
            </div>
          ))}
          {bidding.length > SHOWN_BIDS && <span class="small muted">{L(`et ${bidding.length - SHOWN_BIDS} de plus`, `and ${bidding.length - SHOWN_BIDS} more`)}</span>}
        </>
      )}
      {selling.length > 0 && (
        <div class="already-title soft">
          <Icon name="info" size={14} />
          {L(selling.length === 1 ? "Vous vendez déjà un exemplaire de cette carte" : `Vous vendez déjà ${selling.length} exemplaires de cette carte`, selling.length === 1 ? "You are already selling a copy of this card" : `You are already selling ${selling.length} copies of this card`)}
        </div>
      )}
    </div>
  );
}

// Autres enchères en cours de la carte : comptées à l'ouverture de la page, détaillées dans une fenêtre
function OtherAuctions({card, auctionId, market}) {
  const count = market == null ? null : market.error ? -1 : market.auctions.filter((a) => a.id !== auctionId).length;
  const open = () => openCardAuctions({card, currentId: auctionId});
  return (
    <div class="kv">
      <span class="k">{L("Marché", "Market")}</span>
      {count == null ? (
        <span class="spinner" aria-label={L("Lecture des autres enchères", "Reading other auctions")} />
      ) : count === 0 ? (
        <span class="muted small">{L("Aucune autre enchère en cours pour cette carte", "No other ongoing auction for this card")}</span>
      ) : (
        <button class="btn sm" onClick={open}>
          <Icon name="market" size={14} />
          {count > 0 ? L(`Prochaines enchères de cette carte (${count})`, `Upcoming auctions for this card (${count})`) : L("Prochaines enchères de cette carte", "Upcoming auctions for this card")}
        </button>
      )}
    </div>
  );
}

export function AuctionInsight({auctionId}) {
  useStore(auctionVersion);
  useStore(priceVersion);
  const {ids, loadedAt} = useStore(owned);
  const [failed, setFailed] = useState(false);
  const loaded = auctionById(auctionId);
  const market = useCardMarket(loaded?.card ? loaded.card_id || loaded.card.id : null);
  useEffect(() => {
    setFailed(false);
    if (!auctionById(auctionId)?.card) loadAuction(auctionId).catch(() => setFailed(true));
  }, [auctionId]);

  const a = auctionById(auctionId);
  if (!a?.card)
    return failed ? null : (
      <section class="island compact">
        <div class="row">
          <div class="spinner" />
          <span class="muted small">{L("Analyse de l'enchère…", "Analyzing the auction…")}</span>
        </div>
      </section>
    );
  const cardId = a.card_id || a.card.id;
  const rarity = a.snapshot_rarity || a.card.rarity;
  const current = a.current_bid ?? a.base_amount;
  const next = nextBid(a);
  const avg = priceOf(cardId, rarity, {shiny: a.is_shiny});
  const ownedCard = loadedAt ? ids.has(cardId) : null;
  return (
    <section class="island compact" aria-label={L("Analyse WikiMasters Toolbox", "WikiMasters Toolbox analysis")}>
      <div class="island-head">
        <Mark size={20} />
        <span class="island-title">{L("Analyse Toolbox", "Toolbox analysis")}</span>
        {isLeading(a) && <span class="chip ok">{L("Vous êtes en tête", "You are leading")}</span>}
      </div>
      <AlreadyBidding market={market} auctionId={auctionId} />
      <PriceLine cardId={cardId} rarity={rarity} shiny={Boolean(a.is_shiny)} />
      {avg != null && current != null && (
        <div class="kv">
          <span class="k">{a.current_bid != null ? L("Enchère actuelle", "Current bid") : L("Mise de départ", "Starting bid")}</span>
          <strong>
            <Money v={current} />
          </strong>
          <Gap gap={gapOf(current, avg)} />
          {next !== current && <span class="muted small">{L(`prochaine mise : ${fmt(next)} ₩ (${gapOf(next, avg) > 0 ? "+" : ""}${gapOf(next, avg)} %)`, `next bid: ${fmt(next)} ₩ (${gapOf(next, avg) > 0 ? "+" : ""}${gapOf(next, avg)}%)`)}</span>}
        </div>
      )}
      {ownedCard != null && (
        <div class="kv">
          <span class="k">{L("Collection", "Collection")}</span>
          {ownedCard ? (
            <span class="chip">
              <Icon name="check" size={12} /> {L("Vous l'avez déjà", "You already have it")}
            </span>
          ) : (
            <span class="chip ok">{L("Nouvelle pour vous", "New for you")}</span>
          )}
        </div>
      )}
      <OtherAuctions card={{id: cardId, title: a.card.wikipedia_title}} auctionId={auctionId} market={market} />
      <Interest card={{title: a.card.wikipedia_title, category: a.card.category, summary: a.card.summary, image_url: a.card.hide_image ? null : a.card.image_url}} />
    </section>
  );
}
