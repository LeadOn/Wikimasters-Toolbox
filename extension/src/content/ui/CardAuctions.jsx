// Prochaines enchères d'une carte : fenêtre ouverte depuis l'analyse d'une enchère (bouton de
// ui/islands/AuctionInsight.jsx), affichée par la Toolbox comme la fenêtre de mise en vente. Toutes
// les enchères en cours de la carte, de la fin la plus proche à la plus lointaine, avec la mise
// actuelle, son écart au prix du marché de sa rareté et un lien vers chacune. Lecture seule : la
// mise se fait sur la page de l'enchère, avec le formulaire du site.
import {useEffect, useState} from "preact/hooks";
import {createStore, useStore} from "../lib/store";
import {cardMarket, isLeading, isMySale, msLeft, nextBid} from "../features/market";
import {loadPrices, priceOf, priceVersion} from "../state/prices";
import {Icon, Modal, Money, Notice, Rarity, duration, fmt, plural} from "./components";
import {errorMessage} from "./feedback";
import {L} from "../../shared/i18n";

const cardAuctionsDialog = createStore({current: null});

// card : {id, title} ; currentId : enchère de la page (signalée, sans lien)
export const openCardAuctions = (options) => cardAuctionsDialog.set({current: options});
const close = () => cardAuctionsDialog.set({current: null});

// Écart d'un montant au prix du marché, en % (prix fiable seulement)
const gapOf = (amount, avg) => (avg ? Math.round((100 * (amount - avg)) / avg) : null);
function Gap({gap}) {
  if (gap == null) return <span class="muted small">—</span>;
  const sign = gap > 0 ? "+" : "";
  const label = L(`${sign}${gap} %`, `${sign}${gap}%`);
  return <span class={`chip${gap <= -20 ? " ok" : gap >= 20 ? " warn" : ""}`}>{label}</span>;
}

// myBid : ma plus haute mise sur cette enchère (auction_bids), sinon undefined
function Status({auction, current, myBid}) {
  const chips = [];
  if (current) chips.push(<span key="current" class="chip accent">{L("Cette enchère", "This auction")}</span>);
  if (isMySale(auction)) chips.push(<span key="sale" class="chip">{L("Votre vente", "Your sale")}</span>);
  else if (isLeading(auction)) chips.push(<span key="lead" class="chip me">{L("Vous êtes en tête", "You are leading")}</span>);
  else if (myBid)
    chips.push(
      <span key="outbid" class="chip warn" title={L(`Votre mise : ${fmt(myBid)} ₩`, `Your bid: ${fmt(myBid)} ₩`)}>
        {L("Surenchéri", "Outbid")}
      </span>,
    );
  return chips;
}

function CardAuctionsDialog({card, currentId}) {
  useStore(priceVersion);
  const [state, setState] = useState({list: null, myBids: new Map(), error: null});
  const [, tick] = useState(0);
  useEffect(() => {
    let live = true;
    cardMarket(card.id)
      .then(({auctions: list, myBids}) => {
        if (!live) return;
        setState({list, myBids, error: null});
        loadPrices(list.map((a) => ({id: a.card_id, rarity: a.snapshot_rarity}))).catch(() => {});
      })
      .catch((e) => live && setState({list: null, myBids: new Map(), error: errorMessage(e)}));
    // Temps restant mis à jour toutes les 15 s
    const timer = setInterval(() => tick((n) => n + 1), 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [card.id]);

  const list = (state.list || []).filter((a) => msLeft(a) > 0);
  const others = list.filter((a) => a.id !== currentId).length;
  return (
    <Modal title={L(`Enchères en cours · ${card.title}`, `Ongoing auctions · ${card.title}`)} wide onClose={close}>
      {state.error && <Notice type="error">{state.error}</Notice>}
      {!state.list && !state.error && (
        <div class="row">
          <div class="spinner" />
          <span class="muted small">{L("Lecture des enchères de la carte…", "Reading the card's auctions…")}</span>
        </div>
      )}
      {state.list && !list.length && <p class="help">{L("Aucune enchère en cours pour cette carte.", "No ongoing auction for this card.")}</p>}
      {list.length > 0 && (
        <>
          <p class="small muted">
            {others
              ? L(`${plural(others, "autre enchère", "autres enchères")} en cours, de la fin la plus proche à la plus lointaine.`, `${plural(others, "other auction")} in progress, from the soonest to end to the latest.`)
              : L("Aucune autre enchère en cours pour cette carte.", "No other ongoing auction for this card.")}
          </p>
          <div class="table-scroll" style={{maxHeight: "55vh", overflowY: "auto"}}>
            <table class="list card-auctions">
              <thead>
                <tr>
                  <th>{L("Rareté", "Rarity")}</th>
                  <th class="num">{L("Mise", "Bid")}</th>
                  <th class="num">{L("Prochaine", "Next")}</th>
                  <th>{L("Prix du marché", "Market price")}</th>
                  <th class="num">{L("Fin dans", "Ends in")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((a) => {
                  const current = a.id === currentId;
                  const bid = a.current_bid ?? a.base_amount;
                  const avg = priceOf(a.card_id, a.snapshot_rarity, {shiny: a.is_shiny});
                  return (
                    <tr key={a.id} class={current ? "current" : ""}>
                      <td>
                        <span class="row-inline">
                          <Rarity r={a.snapshot_rarity} />
                          {a.is_shiny && (
                            <span class="chip warn">
                              <Icon name="shine" size={12} /> Shiny
                            </span>
                          )}
                        </span>
                      </td>
                      <td class="num">
                        <Money v={bid} />
                        {a.current_bid == null && <div class="small muted">{L("départ", "start")}</div>}
                      </td>
                      <td class="num">
                        <Money v={nextBid(a)} />
                      </td>
                      <td>
                        <span class="row-inline">
                          {avg != null && <Money v={avg} />}
                          <Gap gap={gapOf(bid, avg)} />
                        </span>
                      </td>
                      <td class="num">{duration(msLeft(a))}</td>
                      <td class="act">
                        <span class="row-inline">
                          <Status auction={a} current={current} myBid={state.myBids.get(a.id)} />
                          {!current && (
                            <a class="btn sm" href={`/marketplace/${a.id}`}>
                              {L("Voir", "View")}
                            </a>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p class="small muted">{L("Écart calculé sur la mise actuelle (ou de départ), par rapport au prix du marché de la rareté de chaque enchère.", "Gap computed on the current (or starting) bid, against the market price of each auction's rarity.")}</p>
      <div class="actions">
        <button class="btn" onClick={close}>
          {L("Fermer", "Close")}
        </button>
      </div>
    </Modal>
  );
}

export function CardAuctionsHost() {
  const {current} = useStore(cardAuctionsDialog);
  return current ? <CardAuctionsDialog key={`${current.card.id}-${current.currentId}`} {...current} /> : null;
}
