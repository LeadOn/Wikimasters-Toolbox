// À droite de la carte révélée (option revealTags) : prix, nouveauté, étoile des favoris et
// étiquettes de l'exemplaire, pour le classer en un clic pendant la révélation.
import {useStore} from "../../lib/store";
import {recapState} from "../../features/packs";
import {priceVersion} from "../../state/prices";
import {Price} from "../PackRecap";
import {StarButton, TagPicker} from "../QuickTags";
import {Icon} from "../components";
import {L} from "../../../shared/i18n";

export function RevealSide({at, index}) {
  const recap = useStore(recapState);
  useStore(priceVersion);
  const card = recap.at === at ? recap.cards[index] : null;
  if (!card) return null;
  return (
    <aside class="reveal-side" aria-label={L("Carte révélée : favori et étiquettes", "Revealed card: favorite and tags")}>
      <div class="reveal-side-head">
        {card.isNew === true && <span class="chip ok">{L("Nouvelle", "New")}</span>}
        {card.isNew === false && <span class="chip danger">{L("Doublon", "Duplicate")}</span>}
        {card.is_shiny && (
          <span class="chip warn">
            <Icon name="shine" size={12} /> Shiny
          </span>
        )}
        <span class="grow" />
        <Price card={card} loading={recap.pricesLoading} />
      </div>
      <StarButton card={card} index={index} label />
      <div class="eyebrow">{L("Étiquettes", "Tags")}</div>
      <TagPicker card={card} userCardId={card.user_card_id} />
    </aside>
  );
}
