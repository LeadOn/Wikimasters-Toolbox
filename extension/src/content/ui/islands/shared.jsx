// Éléments communs aux blocs intégrés aux pages : prix du marché d'une carte, thème et amis intéressés.
import {useEffect} from "preact/hooks";
import {useStore} from "../../lib/store";
import {readSession} from "../../lib/session";
import {priceInfo, priceStatus, requestPrice, priceVersion, priceSource, uncertainNote, weekLabel} from "../../state/prices";
import {profiles, activeProfiles} from "../../state/profiles";
import {Icon, Money, ThemeChip, plural} from "../components";
import {FRIEND_PREFIX, RARITY_LABEL} from "../../../../../core";
import {classify} from "../../state/themes";
import {L, LOCALE} from "../../../shared/i18n";

export const PRICE_TITLE = L("Prix moyen de la semaine, comme dans l'onglet Marché de la fiche de la carte sur le site", "The week's average price, as in the Market tab of the card's page on the site");
const percent = (v) => v.toLocaleString(LOCALE, {style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero"});

// Ce qui fonde le prix, comme l'onglet Marché du site : ventes sur 12 semaines, fourchette sur
// 4 semaines, variation de la semaine ; semaine sans vente : dernier prix connu
export function SalesNote({info, shiny = false}) {
  return (
    <span class="muted small">
      {L(`${plural(info.sales, "vente")} sur 12 semaines`, `${plural(info.sales, "sale")} in 12 weeks`)}
      {info.carried && info.lastSale && L(` · dernier prix connu (semaine du ${weekLabel(info.lastSale)})`, ` · last known price (week of ${weekLabel(info.lastSale)})`)}
      {info.change != null && !info.carried && L(` · ${percent(info.change)} cette semaine`, ` · ${percent(info.change)} this week`)}
      {info.low4 != null && info.high4 != null && info.low4 !== info.high4 && (
        <>
          {L(" · sur 4 semaines ", " · over 4 weeks ")}
          <Money v={info.low4} />–<Money v={info.high4} />
        </>
      )}
      {shiny && L(" · le site ne distingue pas les ventes shiny", " · the site does not separate shiny sales")}
    </span>
  );
}

// Prix du marché pour la rareté (fiche ouverte, page d'une enchère), relu dès l'affichage s'il a plus de
// 10 min, comme l'onglet Marché du site (instantané sinon).
// Le site ne distingue pas les ventes shiny : une shiny a le prix de sa rareté.
export function PriceLine({cardId, rarity, shiny = false}) {
  useStore(priceVersion);
  useStore(priceSource);
  useEffect(() => {
    if (cardId) requestPrice(cardId, {detail: true});
  }, [cardId, rarity]);
  const label = L(`Prix du marché${RARITY_LABEL[rarity] ? ` ${RARITY_LABEL[rarity]}` : ""}`, `${RARITY_LABEL[rarity] ? `${RARITY_LABEL[rarity]} ` : ""}market price`);
  if (!cardId)
    return (
      <div class="kv">
        <span class="k">{label}</span>
        <span class="spinner" aria-label={L("Recherche de la carte", "Looking up the card")} />
      </div>
    );
  const status = priceStatus(cardId, rarity);
  const info = priceInfo(cardId, rarity);
  const source = priceSource.get();
  return (
    <div class="kv">
      <span class="k">{label}</span>
      {status === "ok" ? (
        <>
          <span title={PRICE_TITLE}>
            <Money v={info.price} class="price-big" />
          </span>
          <SalesNote info={info} shiny={shiny} />
        </>
      ) : status === "few" ? (
        <>
          <Money v={info.price} class="price-big" approx title={uncertainNote(info)} />
          <span class="chip warn" title={uncertainNote(info)}>
            {L("indicatif", "tentative")}
          </span>
          <SalesNote info={info} shiny={shiny} />
        </>
      ) : status === "unknown" ? (
        source.broken ? (
          <span class="muted small">{source.message}</span>
        ) : (
          <span class="spinner" aria-label={L("Chargement du prix", "Loading price")} />
        )
      ) : status === "error" ? (
        <span class="muted small">{L("serveur indisponible, nouvel essai dans quelques minutes", "server unavailable, retrying in a few minutes")}</span>
      ) : (
        <span class="muted small">{L("jamais vendue dans cette rareté", "never sold in this rarity")}</span>
      )}
    </div>
  );
}

// Thème calculé par le moteur et profils d'intérêts concernés (« Pour : … »)
export function Interest({card}) {
  useStore(profiles);
  const me = readSession()?.username;
  const tags = classify(
    {wikipedia_title: card.title, category: card.category || "", summary: card.summary || "", image_url: card.image_url},
    {profiles: activeProfiles()},
  );
  const fans = tags.slice(1).map((t) => t.slice(FRIEND_PREFIX.length));
  return (
    <>
      <div class="kv">
        <span class="k">{L("Thème", "Theme")}</span>
        <ThemeChip theme={tags[0]} />
      </div>
      {fans.length > 0 && (
        <div class="kv">
          <span class="k">{L("Intéresse", "Wanted by")}</span>
          <div class="chips">
            {fans.map((name) => (
              <span key={name} class={`chip ${name === me ? "me" : ""}`}>
                {name === me ? (
                  <>
                    <Icon name="star" size={12} /> {L("Vous", "You")}
                  </>
                ) : (
                  name
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
