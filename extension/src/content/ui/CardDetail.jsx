// Fenêtre de détail d'une carte tirée (récapitulatif d'un paquet), sur le modèle de la fenêtre d'une
// carte du site : la carte en grand (ui/SiteCard.jsx) et, à côté, son titre, sa rareté, sa
// description, ses étiquettes, attaque et défense, Q-Score, vues sur 30 jours, prix du marché et lien
// vers l'article. Attaque, défense, Q-Score et vues viennent de la réponse du site à l'ouverture du
// paquet ; s'ils manquent (récapitulatif d'une version précédente), ils sont relus dans la table
// `cards`. Les actions (vendre, défausser) sont celles du récapitulatif, avec leurs confirmations.
import {useEffect, useState} from "preact/hooks";
import {useStore} from "../lib/store";
import {rest} from "../api/supabase";
import {priceInfo, priceVersion, uncertainNote} from "../state/prices";
import {SiteCard} from "./SiteCard";
import {Icon, Modal, Money, fmt} from "./components";
import {RARITY_LABEL} from "../../../../core";
import {L, LOCALE} from "../../shared/i18n";

const STAT_FIELDS = ["atk", "def", "q_score", "pageviews"];
const extras = new Map(); // id de carte → champs relus

function useStats(card) {
  const missing = card.id && STAT_FIELDS.some((k) => card[k] == null);
  const [read, setRead] = useState(() => extras.get(card.id) || null);
  useEffect(() => {
    if (!missing || extras.has(card.id)) return;
    let alive = true;
    rest(`cards?select=${STAT_FIELDS.join(",")}&id=eq.${card.id}`, {retries: 2})
      .then((rows) => {
        const row = Array.isArray(rows) ? rows[0] || {} : {};
        extras.set(card.id, row);
        if (alive) setRead(row);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [card.id, missing]);
  return missing && read ? {...card, ...Object.fromEntries(STAT_FIELDS.filter((k) => card[k] == null && read[k] != null).map((k) => [k, read[k]]))} : card;
}

// Prix du marché de la carte dans sa rareté (celui des shiny pour une shiny) et ce qui le fonde
function MarketPrice({card}) {
  useStore(priceVersion);
  const info = priceInfo(card.id, card.rarity, {shiny: card.is_shiny});
  if (!info || info.price == null) return <span class="muted small">{L(`Jamais vendue${card.is_shiny ? " en shiny" : ""} dans cette rareté`, `Never sold${card.is_shiny ? " as shiny" : ""} in this rarity`)}</span>;
  return (
    <span class="cd-price">
      <Money v={info.price} approx={!info.reliable} class="price-big" title={info.reliable ? undefined : uncertainNote(info)} />
      <span class="small muted">
        {L(`${fmt(info.sales)} vente${info.sales > 1 ? "s" : ""} prise${info.sales > 1 ? "s" : ""} en compte`, `${fmt(info.sales)} sale${info.sales !== 1 ? "s" : ""} counted`)}
        {info.latest != null && ` · ${L("dernière", "latest")} ${fmt(info.latest)} ₩`}
      </span>
    </span>
  );
}

// card : carte tirée du récapitulatif ; badges : pastilles de la carte ; tags : étiquettes à montrer ;
// actions : boutons (vendre, défausser) ; onClose : ferme la fenêtre
export function CardDetail({card: base, badges = [], tags = null, actions = null, onClose}) {
  const card = useStats(base);
  const r = card.rarity || "C";
  const wiki = card.wikipedia_url || (card.wikipedia_title ? `https://fr.wikipedia.org/wiki/${encodeURIComponent(card.wikipedia_title.replace(/ /g, "_"))}` : null);
  return (
    <Modal title={card.wikipedia_title} wide onClose={onClose}>
      <div class="cd">
        <div class="cd-card">
          <SiteCard card={card} large />
        </div>
        <div class="cd-info">
          <div class="cd-chips">
            <span class="cd-rarity" style={{"--rc": `var(--r-${r})`}}>{RARITY_LABEL[r] || r}</span>
            {badges.filter(Boolean).map((b) => (
              <span key={b.label} class={`chip ${b.type || ""}`}>
                {b.icon && <Icon name={b.icon} size={12} />}
                {b.label}
              </span>
            ))}
          </div>
          {card.category && <p class="cd-desc">{card.category}</p>}
          {tags && (
            <div class="cd-block">
              <span class="eyebrow">{L("Étiquettes", "Tags")}</span>
              <div class="cd-tags">{tags}</div>
            </div>
          )}
          {card.atk != null && card.def != null && (
            <div class="cd-stats">
              <div class="cd-stat atk">
                <span class="v">
                  <Icon name="atk" size={16} /> {fmt(card.atk)}
                </span>
                <span class="k">ATK</span>
              </div>
              <div class="cd-stat def">
                <span class="v">
                  <Icon name="def" size={16} /> {fmt(card.def)}
                </span>
                <span class="k">DEF</span>
              </div>
            </div>
          )}
          <dl class="cd-facts">
            {card.q_score != null && (
              <>
                <dt>Q-Score</dt>
                <dd>{Number(card.q_score).toLocaleString(LOCALE, {maximumFractionDigits: 2})}</dd>
              </>
            )}
            {card.pageviews != null && (
              <>
                <dt>{L("Vues (30 j)", "Views (30 d)")}</dt>
                <dd>{fmt(card.pageviews)}</dd>
              </>
            )}
            <dt>{L("Prix du marché", "Market price")}</dt>
            <dd>
              <MarketPrice card={card} />
            </dd>
          </dl>
          {wiki && (
            <a class="cd-wiki" href={wiki} target="_blank" rel="noopener noreferrer">
              {L("Voir l'article sur Wikipédia", "See the Wikipedia article")} →
            </a>
          )}
          {actions && <div class="actions cd-actions">{actions}</div>}
        </div>
      </div>
    </Modal>
  );
}
