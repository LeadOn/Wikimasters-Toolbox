// Scène de « Tout ouvrir » : au lieu d'un bouton qui compte les paquets, chaque paquet ouvert est
// distribué sur la table, face cachée, puis ses cartes se retournent l'une après l'autre. À partir de
// Super Rare, le dos se charge à la couleur de la rareté avant de se retourner (aura, tremblement,
// texture du site) ; la carte arrive avec un éclair, des ondes et un reflet, et, à partir d'Ultra
// Rare, se soulève dans un halo (rayons pour une Légendaire). Les cartes des paquets précédents
// rejoignent la pile du bas ; les compteurs par rareté ne comptent que les cartes retournées.
// Les paquets arrivent au rythme imposé par le site (features/packs.js) : la scène les montre l'un
// après l'autre, plus vite si elle a du retard. Un clic sur la table retourne tout le paquet.
// Le prix du marché de chaque carte s'affiche une fois retournée, et la valeur des cartes retournées
// s'ajoute aux compteurs (prix fiables seulement, comme le récapitulatif).
// À la fin : les meilleures cartes, puis le récapitulatif habituel (page Paquets ou onglet Paquets).
// La scène peut être réduite à tout moment, l'ouverture continue (le bouton « Tout ouvrir » la rouvre).
// Exception à la charte, comme la révélation d'un paquet : lueurs et dégradés aux couleurs des raretés.
import {useEffect, useMemo, useRef, useState} from "preact/hooks";
import {createStore, useStore} from "../lib/store";
import {emit} from "../lib/bus";
import {openAllState, stopOpenAll} from "../features/packs";
import {reducedMotion} from "../features/suspense";
import {rarityTexture, siteLogo} from "../features/site-assets";
import {isOn} from "../state/settings";
import {priceInfo, priceOf, priceStatus, priceVersion} from "../state/prices";
import {CardArt, Icon, Mark, Money, Notice, Rarity, fmt, plural} from "./components";
import {packTimeline, bestCards, cardRank as rank, FAST} from "../features/open-all";
import {RARITIES, RARITY_LABEL} from "../../../../core";
import {L} from "../../shared/i18n";

export const openAllStage = createStore({open: false});
export const showOpenAllStage = () => openAllStage.set({open: true});
const hideStage = () => openAllStage.set({open: false});

const art = (card) => ({...card, image_url: card.hide_image ? null : card.image_url});
const shinyOf = (card) => ({shiny: Boolean(card.is_shiny)});

// Prix du marché d'une carte de la scène : fiable, indicatif (« ≈ »), en cours de lecture, ou rien
function StagePrice({card}) {
  const status = priceStatus(card.id, card.rarity, shinyOf(card));
  if (status === "unknown") return <span class="oa-price wait" aria-label={L("Chargement du prix", "Loading price")}>…</span>;
  const info = priceInfo(card.id, card.rarity, shinyOf(card));
  if (info?.price == null) return null;
  return <Money v={info.price} approx={!info.reliable} class="oa-price" />;
}
const priceText = (card) => {
  const info = priceInfo(card.id, card.rarity, shinyOf(card));
  return info?.price == null ? "" : ` · ${info.reliable ? "" : "≈ "}${fmt(info.price)} ₩`;
};

// Face d'une carte : image, rareté, nouvelle, titre ; reflet irisé pour une shiny
function Face({card}) {
  return (
    <div class="oa-face">
      <CardArt card={art(card)} rarity={card.rarity} class="oa-art" />
      {card.is_shiny && <div class="oa-holo" />}
      <div class="oa-badges">
        <Rarity r={card.rarity} />
        {card.is_shiny && (
          <span class="oa-badge shiny" title="Shiny">
            <Icon name="shine" size={11} />
          </span>
        )}
        {card.isNew === true && <span class="oa-badge new">{L("Nouvelle", "New")}</span>}
      </div>
      <div class="oa-caption">
        <div class="oa-name" title={card.wikipedia_title}>{card.wikipedia_title}</div>
        <StagePrice card={card} />
      </div>
      <div class="oa-flash" />
      <div class="oa-sheen" />
    </div>
  );
}

// Carte de la table : dos (texture Commune, puis celle de sa rareté pendant la charge) → face.
// step : délais de packTimeline ; null : carte posée face visible (meilleures cartes de la fin).
function TableCard({card, step, index}) {
  const r = rank(card);
  // Carte posée face visible : ses effets (aura, reflet) se jouent à son arrivée
  const s = step || {deal: index * 90, chargeAt: index * 90, charge: 0, flipAt: index * 90};
  const style = {"--rc": `var(--r-${card.rarity || "C"})`, "--deal": `${s.deal}ms`, "--charge-at": `${s.chargeAt}ms`, "--charge": `${s.charge || 1}ms`, "--flip-at": `${s.flipAt}ms`};
  return (
    <div class={`oa-card r-${r}${step ? "" : " shown"}${card.is_shiny ? " is-shiny" : ""}`} style={style} title={card.wikipedia_title}>
      {r >= 4 && <div class="oa-halo" aria-hidden="true" />}
      {r >= 5 && (
        <div class="oa-rays" aria-hidden="true">
          <i />
        </div>
      )}
      <div class="oa-lift">
        <div class="oa-glow" aria-hidden="true" />
        {r >= 3 && step && (
          <>
            <div class="oa-ring" aria-hidden="true" />
            <div class="oa-ring late" aria-hidden="true" />
          </>
        )}
        <div class="oa-shake">
          <div class="oa-inner">
            <div class="oa-back" aria-hidden="true">
              <div class="oa-tex" style={{backgroundImage: `url("${rarityTexture("C")}")`}} />
              {r >= 3 && <div class="oa-tex hot" style={{backgroundImage: `url("${rarityTexture(card.rarity)}")`}} />}
              <img src={siteLogo()} alt="" onError={(e) => (e.currentTarget.hidden = true)} />
            </div>
            <Face card={card} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Paquet scellé, avant la première réponse du site
const SealedPack = () => (
  <div class="oa-sealed" aria-hidden="true">
    {[0, 1, 2].map((i) => (
      <div key={i} class="oa-back" style={{"--i": i}}>
        <div class="oa-tex" style={{backgroundImage: `url("${rarityTexture("C")}")`}} />
        <img src={siteLogo()} alt="" onError={(e) => (e.currentTarget.hidden = true)} />
      </div>
    ))}
  </div>
);

// Vignette de la pile ; i : place dans son paquet (apparition décalée)
const Mini = ({card, i}) => (
  <li class="oa-mini" style={{"--rc": `var(--r-${card.rarity || "C"})`, "--i": i}} title={`${card.wikipedia_title} · ${RARITY_LABEL[card.rarity] || card.rarity}${priceText(card)}`}>
    <CardArt card={art(card)} rarity={card.rarity} class="oa-mini-art" />
    {card.is_shiny && <span class="oa-mini-dot" />}
  </li>
);

export function OpenAllStage() {
  const {open} = useStore(openAllStage);
  const state = useStore(openAllState);
  useStore(priceVersion);
  const {running, batches, opened, total, stopping, error} = state;
  // shown : paquet sur la table ; done : ses cartes sont toutes retournées ; skip : retourné d'un clic
  const [view, setView] = useState({shown: -1, done: true, skip: false, speed: 1});
  const timer = useRef(0);
  const stageRef = useRef(null);

  // Nouvelle ouverture : la table repart de zéro
  const runKey = batches[0];
  useEffect(() => {
    clearTimeout(timer.current);
    setView({shown: -1, done: true, skip: false, speed: 1});
  }, [runKey]);

  // Paquet suivant dès que le précédent est révélé
  useEffect(() => {
    if (!view.done || view.shown >= batches.length - 1) return;
    const shown = view.shown + 1;
    const late = batches.length - 1 - shown;
    const speed = reducedMotion() ? 0 : late > 0 ? FAST : 1;
    setView({shown, done: false, skip: false, speed});
    timer.current = setTimeout(() => setView((v) => (v.shown === shown ? {...v, done: true} : v)), packTimeline(batches[shown], speed).total);
  }, [view.done, view.shown, batches.length]);
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (open) stageRef.current?.focus();
  }, [open]);

  const current = batches[view.shown] || [];
  const timeline = useMemo(() => packTimeline(current, view.speed), [current, view.speed]);
  const finished = !running && view.done && view.shown >= batches.length - 1;
  const revealed = useMemo(() => batches.slice(0, view.shown + (view.done ? 1 : 0)).flat(), [batches, view.shown, view.done]);
  const pile = useMemo(() => (finished ? batches : batches.slice(0, Math.max(0, view.shown))).flatMap((b, p) => b.map((c, i) => ({c, i, key: `${p}-${i}`}))).reverse(), [batches, view.shown, finished]);
  const best = useMemo(() => (finished ? bestCards(batches.flat()) : []), [finished, batches]);

  if (!open || (!running && !batches.length && !error)) return null;

  const counts = {};
  for (const c of revealed) counts[c.rarity] = (counts[c.rarity] || 0) + 1;
  const fresh = revealed.filter((c) => c.isNew === true).length;
  // Valeur des cartes retournées : prix fiables seulement ; lecture en cours tant qu'un prix manque
  const value = revealed.reduce((n, c) => n + (priceOf(c.id, c.rarity, shinyOf(c)) || 0), 0);
  const reading = revealed.some((c) => priceStatus(c.id, c.rarity, shinyOf(c)) === "unknown");
  const known = revealed.some((c) => c.isNew != null);
  const packNo = view.shown + 1;
  const waiting = running && view.done && view.shown >= batches.length - 1;
  const pct = total ? Math.min(100, (100 * (view.shown + (view.done ? 1 : 0))) / total) : null;

  const skip = () => {
    if (view.done || view.skip) return;
    clearTimeout(timer.current);
    setView((v) => ({...v, skip: true, done: true}));
  };
  const close = () => hideStage();
  const showRecap = () => {
    hideStage();
    const recap = location.pathname.startsWith("/pulls") && isOn("packRecap") ? document.querySelector(".wmt-recap-host") : null;
    if (recap) recap.scrollIntoView({behavior: reducedMotion() ? "auto" : "smooth", block: "center"});
    else emit("open-panel", {tab: "packs"});
  };

  const title = finished
    ? opened
      ? L(`${plural(opened, "paquet ouvert", "paquets ouverts")}`, `${plural(opened, "pack")} opened`)
      : L("Aucun paquet ouvert", "No pack opened")
    : L("Ouverture des paquets", "Opening packs");
  const sub = finished
    ? L(`${plural(revealed.length, "carte")}`, `${plural(revealed.length, "card")}`)
    : packNo > 0
      ? `${L("Paquet", "Pack")} ${fmt(packNo)}${total ? ` / ${fmt(total)}` : ""}`
      : L("Premier paquet…", "First pack…");

  return (
    <div class="oa-wrap" onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), close())}>
      <section class="oa" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={stageRef}>
        <header class="oa-head">
          <Mark size={22} />
          <div class="oa-heading">
            <div class="oa-title">{title}</div>
            <div class="oa-sub" aria-live="polite">
              {sub}
              {known && revealed.length > 0 && ` · ${L(plural(fresh, "nouvelle", "nouvelles"), `${fmt(fresh)} new`)}`}
            </div>
          </div>
          {running && (
            <button class="btn sm ghost" disabled={stopping} title={L("Termine le paquet en cours sans en ouvrir d'autre", "Finishes the current pack without opening any other")} onClick={stopOpenAll}>
              {stopping ? L("Arrêt après ce paquet…", "Stopping after this pack…") : L("Arrêter", "Stop")}
            </button>
          )}
          <button class="icon-btn" aria-label={running ? L("Réduire (l'ouverture continue)", "Minimize (opening continues)") : L("Fermer", "Close")} title={running ? L("Réduire : l'ouverture continue", "Minimize: opening continues") : L("Fermer", "Close")} onClick={close}>
            <Icon name="close" size={16} />
          </button>
        </header>
        {!finished && (
          <div class={`progress${pct == null ? " indeterminate" : ""}`}>
            <div style={{width: `${pct ?? 35}%`}} />
          </div>
        )}
        <div class="oa-counts">
          {RARITIES.map((r) => (
            <span key={r} class={`oa-count${counts[r] ? "" : " zero"}`} style={{"--rc": `var(--r-${r})`}} title={RARITY_LABEL[r]}>
              <Rarity r={r} />
              <span class="n" key={counts[r] || 0}>{fmt(counts[r] || 0)}</span>
            </span>
          ))}
          {revealed.length > 0 && (
            <span class="oa-value" title={L("Valeur des cartes retournées au prix du marché (prix fiables seulement)", "Value of the flipped cards at market price (reliable prices only)")}>
              <span class="k">{L("Valeur", "Value")}</span>
              <Money v={value} class="v" />
              {reading && <span class="spinner sm" aria-label={L("Lecture des prix", "Reading prices")} />}
            </span>
          )}
        </div>

        <div
          class={`oa-table${view.done ? "" : " revealing"}${view.skip ? " skip" : ""}${view.speed === 0 ? " still" : ""}`}
          onClick={skip}
          title={!view.done ? L("Cliquez pour retourner tout le paquet", "Click to flip the whole pack") : undefined}
        >
          {finished ? (
            best.length ? (
              <>
                <div class="eyebrow oa-table-label">{L("Vos meilleures cartes", "Your best cards")}</div>
                <div class="oa-row" key="best">
                  {best.map((c, i) => (
                    <TableCard key={i} card={c} index={i} step={null} />
                  ))}
                </div>
              </>
            ) : null
          ) : view.shown < 0 ? (
            <div class="oa-row" key="sealed">
              <SealedPack />
            </div>
          ) : (
            <div class="oa-row" key={`pack-${view.shown}`}>
              {current.map((c, i) => (
                <TableCard key={i} card={c} index={i} step={timeline.steps[i]} />
              ))}
            </div>
          )}
          {waiting && (
            <div class="oa-next">
              <span class="spinner sm" /> {L("Paquet suivant…", "Next pack…")}
            </div>
          )}
        </div>

        {error && <Notice type="warn">{error}</Notice>}

        {pile.length > 0 && (
          <div class="oa-pile">
            <div class="eyebrow">
              {finished ? L("Toutes les cartes", "All cards") : L("Déjà ouvertes", "Already opened")} · {fmt(pile.length)}
            </div>
            <ul class="oa-mosaic">
              {pile.map(({c, i, key}) => (
                <Mini key={key} card={c} i={i} />
              ))}
            </ul>
          </div>
        )}

        {finished && (
          <footer class="oa-foot">
            <button class="btn ghost" onClick={close}>{L("Fermer", "Close")}</button>
            {opened > 0 && (
              <button class="btn primary" autoFocus onClick={showRecap}>
                {L("Voir le récapitulatif", "See the summary")}
              </button>
            )}
          </footer>
        )}
      </section>
    </div>
  );
}
