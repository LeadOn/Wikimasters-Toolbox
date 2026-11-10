// Roulette de la dernière carte (features/roulette.js) : une bande de dos de cartes défile sous un
// repère (un cliquetis à chaque dos qui passe : features/roulette-sound.js), ralentit et s'arrête un peu à côté du centre d'un
// dos, se recentre ; les autres dos s'effacent et celui de la carte grandit à sa place, puis se
// révèle comme au suspense : il se retourne et la carte du site enchaîne (jusqu'à Super Rare), ou il
// se dissout dans un flash d'où sort la carte (Ultra Rare, Légendaire).
// Taille de la carte (--cw, --ch) et demi-largeur de la bande (--half) : posées par site-dom.js.
// Exception à la charte, réservée à ce moment : lueurs aux couleurs des raretés.
import {useEffect, useMemo, useRef, useState} from "preact/hooks";
import {RARITY_LABEL} from "../../../../../core";
import {ENTER, RANKS} from "../../features/suspense";
import {ROULETTE, buildStrip, rouletteTimeline, spinEase} from "../../features/roulette";
import {dropCounts} from "../../features/packs";
import {prepareTick, tick} from "../../features/roulette-sound";
import {rarityTexture, siteLogo} from "../../features/site-assets";
import {L} from "../../../shared/i18n";

const RINGS = {2: 1, 3: 1, 4: 2, 5: 3};

// id : carte affichée (paquet + index), rarity, shiny ; onRelease : la carte peut entrer ;
// onDone : fin de la révélation
export function Roulette({id, rarity, shiny, onRelease, onDone}) {
  const rank = Math.max(0, RANKS.indexOf(rarity));
  const r = RANKS[rank];
  const plan = rouletteTimeline(r);
  const strip = useMemo(() => buildStrip(r, dropCounts()), [id]);
  const [phase, setPhase] = useState("spin"); // spin → settle → grow → release
  const stripRef = useRef(null);
  const run = useRef({raf: 0, timers: [], geo: null});

  const clear = () => {
    cancelAnimationFrame(run.current.raf);
    run.current.timers.forEach(clearTimeout);
    run.current.timers = [];
  };
  const later = (ms, fn) => run.current.timers.push(setTimeout(fn, ms));
  // Position de la bande : `x` (px depuis son bord gauche) sous le repère
  const place = (x, ms = 0) => {
    const el = stripRef.current;
    if (!el) return;
    el.style.transition = ms ? `transform ${ms}ms cubic-bezier(0.45, 0, 0.25, 1)` : "none";
    el.style.transform = `translateX(${-x}px)`;
  };
  const center = () => strip.win * run.current.geo.pitch + run.current.geo.w / 2;
  const release = () => {
    clear();
    setPhase("release");
    onRelease?.();
    later(plan.releaseMs, () => onDone?.());
  };
  const grow = () => {
    setPhase("grow");
    later(plan.growMs + ROULETTE.holdMs, release);
  };
  const land = () => {
    clear();
    place(center(), ROULETTE.settleMs);
    setPhase("settle");
    later(ROULETTE.settleMs, grow);
  };

  useEffect(() => {
    const [a, b] = stripRef.current.children;
    const ra = a.getBoundingClientRect();
    const geo = {w: ra.width, pitch: b.getBoundingClientRect().left - ra.left};
    run.current.geo = geo;
    const start = 2 * geo.pitch + geo.w / 2;
    const end = center() + strip.offset * geo.w;
    place(start);
    prepareTick();
    let under = Math.floor(start / geo.pitch);
    const t0 = performance.now();
    const frame = (now) => {
      const t = (now - t0) / plan.spinMs;
      const x = start + (end - start) * spinEase(t);
      place(x);
      const i = Math.floor(x / geo.pitch);
      if (i !== under) {
        under = i;
        tick();
      }
      if (t < 1) run.current.raf = requestAnimationFrame(frame);
      else land();
    };
    run.current.raf = requestAnimationFrame(frame);
    for (const rr of new Set(strip.items)) new Image().src = rarityTexture(rr);
    return clear;
  }, []);

  const enter = ENTER[r];
  const label = L("Révéler la carte", "Reveal the card");
  const skip = () => {
    if (phase === "release") return clear(), onDone?.();
    if (phase === "grow") return release();
    clear();
    place(center());
    grow();
  };
  const landed = phase !== "spin";
  return (
    <div
      class={`ro ${phase} top-${rank}${shiny ? " is-shiny" : ""}`}
      style={{"--rc": `var(--r-${r})`, "--out": `${enter.back}ms`, "--face": `${enter.ms}ms`, "--grow": `${plan.growMs}ms`}}
      role="button"
      tabIndex={0}
      title={label}
      aria-label={label}
      onClick={skip}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), skip())}
    >
      <div class="ro-dim" aria-hidden="true" />
      <div class="ro-band" aria-hidden="true" />
      <div class="ro-view" aria-hidden="true">
        <div class="ro-strip" ref={stripRef}>
          {strip.items.map((ir, i) => (
            <div key={i} class={`ro-item${i === strip.win ? " win" : ""}`} style={{"--ic": `var(--r-${ir})`}}>
              <div class="ro-face" style={{"--tx": `url("${rarityTexture(ir)}")`}}>
                <img src={siteLogo()} alt="" onError={(e) => (e.currentTarget.hidden = true)} />
                {i === strip.win && landed && (
                  <>
                    {shiny && <div class="ro-holo" />}
                    <div class="ro-name">
                      <span>{RARITY_LABEL[r]}</span>
                    </div>
                    <div class="ro-light" />
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div class="ro-marker" aria-hidden="true" />
      {phase === "release" && (
        <div class="ro-slot" aria-hidden="true">
          <div class="ro-flash" />
          {Array.from({length: RINGS[rank] || 0}, (_, i) => (
            <div key={i} class="ro-ring" style={{"--d": `${i * 80}ms`}} />
          ))}
        </div>
      )}
    </div>
  );
}
