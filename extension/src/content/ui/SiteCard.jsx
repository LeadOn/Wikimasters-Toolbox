// Carte dessinée comme sur le site (sa fenêtre d'une carte, sa grille) : image en haut, texture de
// la rareté du site en fond, lettre de rareté, titre et résumé de l'article par-dessus la texture,
// attaque et défense en bas (quand la carte les porte : atk, def). La Toolbox y ajoute le prix du
// marché, entre l'attaque et la défense, et ses pastilles (nouvelle, doublon, shiny) en haut à droite.
// Les textures sont celles du site (features/site-assets.js) ; reflet irisé pour une shiny.
import {rarityTexture} from "../features/site-assets";
import {CardArt, Icon, fmt} from "./components";
import {RARITY_LABEL} from "../../../../core";

// card : carte du site ({wikipedia_title, category, summary, image_url, hide_image, rarity, is_shiny}) ;
// badges : [{label, type, icon}] ; price : élément affiché en bas (prix) ; selected : carte cochée ;
// large : grande carte (fenêtre de détail), résumé moins tronqué
export function SiteCard({card, badges = [], price = null, selected = false, large = false}) {
  const r = card.rarity || "C";
  const text = card.summary || card.category || "";
  const stats = card.atk != null && card.def != null;
  return (
    <div class={`site-card${selected ? " sel" : ""}${card.is_shiny ? " is-shiny" : ""}${large ? " large" : ""}`} style={{"--rc": `var(--r-${r})`, backgroundImage: `url("${rarityTexture(r)}")`}}>
      <div class="site-card-art">
        <CardArt card={{...card, image_url: card.hide_image ? null : card.image_url}} rarity={r} class="site-card-img" />
        <span class="site-card-r" title={RARITY_LABEL[r] || r}>
          {r}
        </span>
        <div class="site-card-badges">
          {badges.filter(Boolean).map((b) => (
            <span key={b.label} class={`site-card-badge ${b.type || ""}`}>
              {b.icon && <Icon name={b.icon} size={10} />}
              {b.label}
            </span>
          ))}
        </div>
        {selected && (
          <span class="site-card-pick" aria-hidden="true">
            <Icon name="check" size={12} />
          </span>
        )}
      </div>
      <div class="site-card-body">
        <div class="site-card-title" title={card.wikipedia_title}>
          {card.wikipedia_title}
        </div>
        {text && <p class="site-card-text">{text}</p>}
        {(price || stats) && (
          <div class="site-card-foot">
            {stats && (
              <span class="site-card-stat atk" title="ATK">
                <Icon name="atk" size={12} />
                {fmt(card.atk)}
              </span>
            )}
            {price}
            {stats && (
              <span class="site-card-stat def" title="DEF">
                <Icon name="def" size={12} />
                {fmt(card.def)}
              </span>
            )}
          </div>
        )}
      </div>
      {card.is_shiny && <div class="site-card-holo" aria-hidden="true" />}
    </div>
  );
}
