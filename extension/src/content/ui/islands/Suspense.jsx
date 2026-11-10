// Suspense de la révélation (features/suspense.js) : à la place de la carte du site, un dos de carte
// qui se charge palier par palier, de Commune à la rareté de la carte. À chaque palier : texture de
// la rareté atteinte (celle du site), un segment de plus sur l'anneau autour du logo, son nom, un
// battement, une onde et un reflet. L'aura grandit ; à partir de Super Rare, des rayons tournent
// autour de la carte ; à partir d'Ultra Rare, la lumière de la page baisse et des braises montent.
// Tout dépend du palier atteint : on ne sait pas où la montée s'arrêtera.
// Arrêtée, la carte se charge (fissures de lumière, particules aspirées), puis se révèle (classe
// .release) : le dos se retourne et la carte du site enchaîne le retournement, ou, à partir d'Ultra
// Rare, le dos se dissout dans un flash d'où sort la carte ; onde de choc, gerbe, puis un reflet
// balaie la carte (irisé pour une shiny).
// Exception à la charte, réservée à ce moment : lumière, lueurs et dégradés aux couleurs des raretés.
import {useEffect, useMemo, useRef, useState} from "preact/hooks";
import {RARITY_LABEL} from "../../../../../core";
import {ENTER, RANKS, suspenseTimeline} from "../../features/suspense";
import {rarityTexture, siteLogo} from "../../features/site-assets";
import {L} from "../../../shared/i18n";

// Particules par rareté : braises pendant l'attente (palier UR, L), aspirées pendant la charge,
// gerbe de la révélation ; fissures de lumière sur le dos pendant la charge
const EMBERS = {4: 14, 5: 24};
const SUCK = {4: 16, 5: 26};
const BURST = {3: 12, 4: 24, 5: 44};
const CRACKS = {3: 3, 4: 5, 5: 8};
const RINGS = {2: 1, 3: 1, 4: 2, 5: 3};
// Étoiles d'une shiny, en % de la place de la carte
const SPARKLES = [
  [12, 18, 14],
  [86, 12, 10],
  [92, 58, 16],
  [8, 74, 11],
  [60, 92, 13],
  [38, 6, 9],
  [70, 40, 8],
];

// Pseudo-hasard stable : mêmes particules à chaque rendu de la même carte
function seeded(seed) {
  let x = 0;
  for (const ch of seed) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

// Point du contour de la carte dans la direction `angle` (en % de sa place)
function edgePoint(angle) {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const m = Math.max(Math.abs(ux), Math.abs(uy));
  return {left: `${50 + (50 * ux) / m}%`, top: `${50 + (50 * uy) / m}%`};
}

// Particules parties du contour (ou arrivant sur lui) : position, déplacement, délai, taille, couleur
function particles(id, kind, n, top) {
  const rand = seeded(`${id}-${kind}`);
  return Array.from({length: n}, (_, i) => {
    const angle = (i / n) * 2 * Math.PI + rand() * 0.5;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    if (kind === "ember") {
      // Le long des côtés et du bas, montent en dérivant
      const side = i % 2 ? 1 : -1;
      return {left: `${side > 0 ? 100 - rand() * 6 : rand() * 6}%`, top: `${30 + rand() * 70}%`, x: Math.round(side * (6 + rand() * 26)), y: -Math.round(50 + rand() * 110), d: Math.round(rand() * 1200), s: 2 + Math.round(rand() * 2)};
    }
    const dist = kind === "suck" ? 70 + rand() * 90 : (top >= 5 ? 120 : 80) + rand() * (top >= 5 ? 170 : 100);
    return {
      ...edgePoint(angle),
      x: Math.round(ux * dist),
      y: Math.round(uy * dist),
      d: Math.round(rand() * (kind === "suck" ? 360 : top >= 5 ? 180 : 90)),
      s: kind === "suck" ? 3 : top >= 5 ? (i % 3 ? 5 : 9) : i % 3 ? 4 : 6,
      c: top >= 5 && kind === "burst" ? RANKS[i % 6] : null,
    };
  });
}

// Fissures du dos : lignes brisées du centre vers le bord (repère 100 × 140)
function cracks(id, n) {
  const rand = seeded(`${id}-crack`);
  return Array.from({length: n}, (_, i) => {
    const angle = (i / n) * 2 * Math.PI + rand() * 0.6;
    const points = [[50 + Math.cos(angle) * 6, 70 + Math.sin(angle) * 6]];
    for (let k = 1; k <= 5; k++) {
      const r = 6 + k * 15;
      const a = angle + (rand() - 0.5) * 0.5;
      points.push([50 + Math.cos(a) * r * 0.9, 70 + Math.sin(a) * r * 1.25]);
    }
    return {points: points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "), d: ((i / n) * 0.55).toFixed(2)};
  });
}

const Dots = ({kind, list}) => (
  <div class={`sx-dots sx-${kind}`} aria-hidden="true">
    {list.map((p, i) => (
      <i key={i} style={{left: p.left, top: p.top, "--x": `${p.x}px`, "--y": `${p.y}px`, "--d": `${p.d}ms`, "--s": `${p.s}px`, ...(p.c ? {"--c": `var(--r-${p.c})`} : {})}} />
    ))}
  </div>
);

// Anneau autour du logo : un segment par rareté, allumés jusqu'au palier atteint
const ARC = (2 * Math.PI * 46) / 6;
const Dial = ({level}) => (
  <svg class="sx-dial" viewBox="0 0 100 100" aria-hidden="true">
    {RANKS.map((r, i) => (
      <circle key={r} class={i <= level ? "on" : ""} cx="50" cy="50" r="46" pathLength={6 * ARC} stroke-dasharray={`${ARC - 4} ${5 * ARC + 4}`} stroke-dashoffset={-(i * ARC) - 2} />
    ))}
  </svg>
);

// id : carte affichée (paquet + index), rarity, shiny ; onRelease : la carte peut entrer ;
// onDone : fin de la révélation. Un composant neuf par carte : rien de la précédente ne s'affiche,
// même le temps d'une image.
export const SuspenseLadder = (props) => (props.id ? <Charge key={props.id} {...props} /> : null);

function Charge({id, rarity, shiny, onRelease, onDone}) {
  const plan = suspenseTimeline(rarity, shiny);
  const top = plan.steps;
  const [level, setLevel] = useState(0);
  const [phase, setPhase] = useState("climb"); // climb (arrêt compris) → shiny → charge → release
  const timers = useRef([]);
  const fx = useMemo(
    () => ({
      embers: {4: particles(id, "ember", EMBERS[4]), 5: particles(id, "ember", EMBERS[5])},
      suck: particles(id, "suck", SUCK[top] || 0, top),
      burst: particles(id, "burst", BURST[top] || 0, top),
      cracks: cracks(id, CRACKS[top] || 0),
    }),
    [id, top],
  );

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const later = (ms, fn) => timers.current.push(setTimeout(fn, ms));
  const release = () => {
    clear();
    setLevel(top);
    setPhase("release");
    onRelease?.();
    later(plan.releaseMs, () => onDone?.());
  };

  useEffect(() => {
    plan.at.forEach((t, i) => later(t, () => setLevel(i + 1)));
    let t = (plan.at.at(-1) || 0) + plan.pauseMs;
    if (plan.shinyMs) later(t, () => setPhase("shiny"));
    t += plan.shinyMs;
    if (plan.chargeMs) later(t, () => setPhase("charge"));
    later(plan.total, release);
    // Textures du site : chargées d'avance, pour que chaque palier change le dos sans attendre
    for (const r of RANKS.slice(1, top + 1)) new Image().src = rarityTexture(r);
    return clear;
  }, []);

  const releasing = phase === "release";
  const waiting = !releasing;
  const enter = ENTER[RANKS[top]];
  const label = L("Révéler la carte", "Reveal the card");
  const skip = () => (releasing ? (clear(), onDone?.()) : release());
  return (
    <div
      class={`sx lvl-${level} ${phase}${shiny ? " is-shiny" : ""}`}
      style={{"--rc": `var(--r-${RANKS[level]})`, "--out": `${enter.back}ms`, "--face": `${enter.ms}ms`, "--charge": `${plan.chargeMs || 1}ms`}}
      role="button"
      tabIndex={0}
      title={label}
      aria-label={label}
      onClick={skip}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), skip())}
    >
      <div class="sx-dim" aria-hidden="true" />
      <div class="sx-rays" aria-hidden="true">
        <i />
      </div>
      <div class="sx-glow" aria-hidden="true" />
      {waiting && level >= 4 && <Dots kind="ember" key={`e${level}`} list={fx.embers[level]} />}
      {phase === "charge" && fx.suck.length > 0 && <Dots kind="suck" list={fx.suck} />}
      {level > 0 && waiting && <div class="sx-pulse" key={`p${level}`} aria-hidden="true" />}

      <div class="sx-card" aria-hidden="true">
        <div class="sx-shake">
          <div class="sx-back">
            {RANKS.slice(0, top + 1).map((r, i) => (
              <div key={r} class={`sx-tex${i <= level ? " on" : ""}`} style={{backgroundImage: `url("${rarityTexture(r)}")`}} />
            ))}
            <div class="sx-shade" />
            {level > 0 && <div class="sx-sheen" key={`s${level}`} />}
            {shiny && (phase === "shiny" || phase === "charge" || releasing) && <div class="sx-holo" />}
            <div class="sx-emblem">
              <Dial level={level} />
              <img src={siteLogo()} alt="" onError={(e) => (e.currentTarget.hidden = true)} />
            </div>
            <div class="sx-name">
              <span key={level}>{RARITY_LABEL[RANKS[level]]}</span>
            </div>
            {(phase === "charge" || releasing) && fx.cracks.length > 0 && (
              <svg class="sx-cracks" viewBox="0 0 100 140" preserveAspectRatio="none">
                {fx.cracks.map((c, i) => (
                  <g key={i} style={{"--d": c.d}}>
                    <polyline class="halo" points={c.points} pathLength="1" />
                    <polyline class="core" points={c.points} pathLength="1" />
                  </g>
                ))}
              </svg>
            )}
            <div class="sx-light" />
          </div>
        </div>
      </div>

      {releasing && (
        <>
          <div class="sx-flash" aria-hidden="true" />
          {Array.from({length: RINGS[top] || 0}, (_, i) => (
            <div key={i} class="sx-ring" style={{"--d": `${i * 80}ms`}} aria-hidden="true" />
          ))}
          {fx.burst.length > 0 && <Dots kind="burst" list={fx.burst} />}
          {top >= 2 && (
            <div class="sx-glare" aria-hidden="true">
              <i />
            </div>
          )}
        </>
      )}
      {shiny && (phase === "shiny" || phase === "charge" || releasing) && (
        <div class="sx-stars" aria-hidden="true">
          {SPARKLES.map(([x, y, s], i) => (
            <i key={i} style={{left: `${x}%`, top: `${y}%`, "--s": `${s}px`, "--d": `${i * 120}ms`}} />
          ))}
        </div>
      )}
    </div>
  );
}
