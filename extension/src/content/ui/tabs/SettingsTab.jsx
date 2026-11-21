// Onglet « Réglages » : fonctionnalités, thèmes de tri, caches.
import {Fragment} from "preact";
import {useState, useEffect, useRef} from "preact/hooks";
import {useStore} from "../../lib/store";
import {keysWithPrefix, remove} from "../../lib/storage";
import {settings, settingsFocus, FEATURES, DEFAULT_SETTINGS, PRICE_QUOTA_LIMITS, clampQuota} from "../../state/settings";
import {recentFeatures} from "../../state/news";
import {clearPrices, slowBudget, priceQuota, recentReadsCount} from "../../state/prices";
import {Toggle, FileButton, fmt, plural} from "../components";
import {confirmAction, toast} from "../feedback";
import {ThemeEditor} from "../ThemeEditor";
import {defaultThemeList, storeThemes} from "../../../../../core";
import {L} from "../../../shared/i18n";
import {rouletteSound, importSound, resetSound, previewTick, MAX_SOUND_BYTES} from "../../features/roulette-sound";

// Nombre entier saisi, borné ; champ vide ou illisible : valeur par défaut
const count = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  return value === "" || !Number.isFinite(n) ? fallback : Math.min(max, Math.max(min, n));
};

// Recherche : majuscules et accents ignorés, tous les mots exigés
const fold = (t) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const matches = (f, words) => words.every((w) => fold(`${f.label} ${f.help} ${f.group}`).includes(w));
const TIMING_SEARCH = fold(
  L(
    "Prix et délais ventes minimum prix fiable quota appels requêtes lectures rafale limite alerte fin enchère",
    "Prices and timing minimum sales reliable price quota calls requests reads burst limit auction ending alert",
  ),
);

export function SettingsTab() {
  const s = useStore(settings);
  const budget = useStore(slowBudget);
  const {key: focus} = useStore(settingsFocus);
  const [query, setQuery] = useState("");
  const root = useRef(null);
  const recent = recentFeatures();
  const words = fold(query).split(/\s+/).filter(Boolean);
  // Pendant une recherche, seules les options qui correspondent restent ; les autres blocs sont
  // masqués (pas retirés : une modification en cours de l'éditeur de thèmes est gardée)
  const shown = words.length ? FEATURES.filter((f) => matches(f, words)) : FEATURES;
  const searching = words.length > 0;
  const showTiming = !searching || words.every((w) => TIMING_SEARCH.includes(w));
  const groups = [...new Set(shown.map((f) => f.group))];
  const setFeature = (key, on) => settings.set((st) => ({...st, features: {...st.features, [key]: on}}));
  const quota = priceQuota();
  const customQuota = quota.window !== DEFAULT_SETTINGS.priceQuotaWindow || quota.burst !== DEFAULT_SETTINGS.priceQuotaBurst;
  const effWindow = Math.max(1, Math.floor(quota.window / (budget.halved ? 2 : 1)));
  const effBurst = Math.max(1, Math.floor(quota.burst / (budget.halved ? 2 : 1)));
  const setQuota = (key, bounds) => (e) => {
    const v = clampQuota(e.currentTarget.value, bounds);
    e.currentTarget.value = String(v);
    settings.set({[key]: v});
  };
  // Option montrée par une nouveauté : amenée à l'écran et soulignée un instant
  useEffect(() => {
    if (!focus) return;
    setQuery("");
    requestAnimationFrame(() => root.current?.querySelector(`[data-key="${focus}"]`)?.scrollIntoView({block: "center"}));
    const t = setTimeout(() => settingsFocus.set({key: null}), 1600);
    return () => clearTimeout(t);
  }, [focus]);

  return (
    <div class="stack" ref={root}>
      <div class="page-head">
        <div>
          <h2>{L("Réglages", "Settings")}</h2>
          <p>{L("Activez seulement ce qui vous sert. Les réglages sont enregistrés dans votre navigateur.", "Turn on only what you need. Settings are stored in your browser.")}</p>
        </div>
      </div>
      <div class="settings-search">
        <input type="search" value={query} placeholder={L("Chercher une option (prix, paquet, favori…)", "Search for an option (price, pack, favorite…)")} aria-label={L("Chercher une option", "Search for an option")} onInput={(e) => setQuery(e.currentTarget.value)} />
        {searching && <span class="small muted">{shown.length ? plural(shown.length, "option") : showTiming ? L("Prix et délais", "Prices and timing") : L("Aucune option ne correspond.", "No option matches.")}</span>}
      </div>
      <div class="grid-2">
        {groups.map((g) => (
          <div class="box" key={g}>
            <h3>{g}</h3>
            {shown.filter((f) => f.group === g).map((f) => (
              <Fragment key={f.key}>
                <div class={`setting${focus === f.key ? " focus" : ""}`} data-key={f.key}>
                  <div class="txt">
                    <strong>
                      {f.label}
                      {recent.has(f.key) && <span class="chip accent">{L("Nouveau", "New")}</span>}
                    </strong>
                    <span>{f.help}</span>
                  </div>
                  {f.choices ? (
                    <select class={`mini-select${s[f.key] !== DEFAULT_SETTINGS[f.key] ? " on" : ""}`} aria-label={f.label} value={s[f.key]} onChange={(e) => settings.set({[f.key]: e.currentTarget.value})}>
                      {f.choices.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Toggle checked={s.features[f.key] !== false} label={f.label} onChange={(on) => setFeature(f.key, on)} />
                  )}
                </div>
                {f.key === "packRoulette" && s.features.packRoulette && <RouletteSound />}
              </Fragment>
            ))}
          </div>
        ))}
        <div class="box stack" hidden={!showTiming}>
          <h3>{L("Prix et délais", "Prices and timing")}</h3>
          <label class="field">
            <span>{L("Ventes minimum sur 12 semaines pour un prix fiable", "Minimum sales over 12 weeks for a reliable price")}</span>
            <input type="number" min="1" max="50" value={s.minSales} onChange={(e) => settings.set({minSales: count(e.currentTarget.value, 1, 50, DEFAULT_SETTINGS.minSales)})} />
          </label>
          <p class="help">
            {L(
              "Le prix est le prix moyen de la semaine, celui de l'onglet Marché de la fiche d'une carte sur le site (dernier prix connu pour une semaine sans vente). Il est relu quand il a plus de 10 minutes dans la fiche d'une carte, plus de 3 heures sur une carte simplement affichée. Avec moins de ventes que ce minimum sur les 12 dernières semaines, le prix est affiché « ≈ » à titre indicatif : il ne compte ni dans les totaux, ni dans les mises de départ proposées, ni dans les bonnes affaires.",
              "The price is the week's average price, the one in the Market tab of a card's page on the site (last known price for a week without sales). It is read again when more than 10 minutes old in a card's page, more than 3 hours old on a card that is just shown. With fewer sales than this minimum over the last 12 weeks, the price is shown with \"≈\" as a rough guide: it does not count in totals, suggested starting bids or deals.",
            )}
          </p>
          <label class="field">
            <span>{L("Quota de lectures de prix (par 10 minutes)", "Price read quota (per 10 minutes)")}</span>
            <input type="number" min={PRICE_QUOTA_LIMITS.window.min} max={PRICE_QUOTA_LIMITS.window.max} value={quota.window} onChange={setQuota("priceQuotaWindow", PRICE_QUOTA_LIMITS.window)} />
          </label>
          <label class="field">
            <span>{L("Rafale de lectures de prix (par 30 secondes)", "Price read burst (per 30 seconds)")}</span>
            <input type="number" min={PRICE_QUOTA_LIMITS.burst.min} max={PRICE_QUOTA_LIMITS.burst.max} value={quota.burst} onChange={setQuota("priceQuotaBurst", PRICE_QUOTA_LIMITS.burst)} />
          </label>
          <div class="row">
            <span class="small muted">
              {L(
                `${fmt(recentReadsCount())} / ${fmt(effWindow)} lectures sur les 10 dernières min${budget.halved ? ` (réduit de moitié jusqu'à demain : ${fmt(effWindow)} / 10 min, ${fmt(effBurst)} / 30 s)` : ""}`,
                `${fmt(recentReadsCount())} / ${fmt(effWindow)} reads in the last 10 min${budget.halved ? ` (halved until tomorrow: ${fmt(effWindow)} / 10 min, ${fmt(effBurst)} / 30 s)` : ""}`,
              )}
            </span>
            {customQuota && (
              <button
                class="btn ghost sm"
                onClick={() => settings.set({priceQuotaWindow: DEFAULT_SETTINGS.priceQuotaWindow, priceQuotaBurst: DEFAULT_SETTINGS.priceQuotaBurst})}
              >
                {L("Valeurs par défaut", "Defaults")}
              </button>
            )}
          </div>
          <p class="help">
            {L(
              `Partagé entre tous vos onglets WikiMasters (${DEFAULT_SETTINGS.priceQuotaWindow} / 10 min et ${DEFAULT_SETTINGS.priceQuotaBurst} / 30 s par défaut). La moitié est réservée aux cartes que vous tirez ou ouvrez ; l'autre sert aux cartes affichées et à l'indexation, dont la cadence suit ce quota. Augmenter ces valeurs expose davantage aux refus temporaires du site ; au premier refus, les lectures de prix se mettent en pause 15 minutes et le quota est réduit de moitié jusqu'au lendemain.`,
              `Shared across all your WikiMasters tabs (${DEFAULT_SETTINGS.priceQuotaWindow} / 10 min and ${DEFAULT_SETTINGS.priceQuotaBurst} / 30 s by default). Half is reserved for cards you pull or open; the other half is used for cards on screen and indexing, whose pace scales with this quota. Raising these values makes temporary site refusals more likely; on the first refusal, price reads pause for 15 minutes and the quota is halved until the next day.`,
            )}
          </p>
          <label class="field">
            <span>{L("Alerte de fin d'enchère (minutes avant la fin)", "Auction ending alert (minutes before the end)")}</span>
            <input type="number" min="1" max="60" value={s.bidAlertMinutes} onChange={(e) => settings.set({bidAlertMinutes: Math.max(1, Number(e.currentTarget.value) || 2)})} />
          </label>
        </div>
      </div>

      <div hidden={searching}>
        <ThemeEditor />
      </div>

      <div class="box stack" hidden={searching}>
        <h3>{L("Données", "Data")}</h3>
        <div class="row">
          <button
            class="btn"
            onClick={async () => {
              if (!(await confirmAction({title: L("Vider le cache des prix ?", "Clear the price cache?"), confirm: L("Vider", "Clear")}))) return;
              await clearPrices();
              toast(L("Cache des prix vidé.", "Price cache cleared."), {type: "ok"});
            }}
          >
            {L("Vider le cache des prix", "Clear the price cache")}
          </button>
          <button
            class="btn"
            onClick={async () => {
              const keys = await keysWithPrefix("friend:");
              for (const k of keys) await remove(k);
              toast(L(`${keys.length} collection(s) d'amis oubliée(s).`, `${keys.length} friend collection(s) forgotten.`), {type: "ok"});
            }}
          >
            {L("Oublier les collections d'amis", "Forget friend collections")}
          </button>
          <button
            class="btn ghost"
            onClick={async () =>
              (await confirmAction({
                title: L("Réinitialiser les réglages ?", "Reset settings?"),
                body: L("Les thèmes de tri reviennent aussi à la liste par défaut ; leurs étiquettes suivent au prochain tri.", "Sort themes also revert to the default list; their tags follow at the next sort."),
                confirm: L("Réinitialiser", "Reset"),
                danger: true,
              })) &&
              // Les étiquettes des thèmes renommés ou supprimés restent notées pour le prochain tri
              settings.set((st) => ({...DEFAULT_SETTINGS, themes: storeThemes(defaultThemeList(), st.themes)}))
            }
          >
            {L("Réinitialiser les réglages", "Reset settings")}
          </button>
        </div>
        <p class="small muted">WikiMasters Toolbox {__VERSION__} · {L("données gardées dans votre navigateur uniquement, aucun serveur tiers.", "data kept in your browser only, no third-party server.")}</p>
      </div>
    </div>
  );
}

// Son du cliquetis de la roulette : clic par défaut ou fichier importé par le joueur
function RouletteSound() {
  const sound = useStore(rouletteSound);
  const pick = async (file) => {
    try {
      await importSound(file);
      toast(L("Son de la roulette enregistré.", "Roulette sound saved."), {type: "ok"});
      previewTick();
    } catch (e) {
      toast(e.message, {type: "error"});
    }
  };
  return (
    <div class="setting sub">
      <div class="txt">
        <strong>{L("Son du cliquetis", "Click sound")}</strong>
        <span>
          {sound.data
            ? L(`Votre son : ${sound.name}. Joué à chaque dos qui passe (0,6 s au plus), gardé dans votre navigateur uniquement.`, `Your sound: ${sound.name}. Played for each back that passes (0.6 s at most), kept in your browser only.`)
            : L("Clic mécanique de la Toolbox. Vous pouvez importer votre propre son (fichier audio court, 300 Ko au plus), gardé dans votre navigateur uniquement.", "The Toolbox's mechanical click. You can import your own sound (short audio file, 300 KB max), kept in your browser only.")}
        </span>
        <div class="row">
          <button class="btn" onClick={previewTick}>
            {L("Écouter", "Play")}
          </button>
          <FileButton label={sound.data ? L("Changer de son", "Change sound") : L("Importer un son", "Import a sound")} accept="audio/*" maxSize={MAX_SOUND_BYTES} onFile={pick} onError={() => toast(L("Son trop volumineux (300 Ko au plus).", "Sound too large (300 KB max)."), {type: "error"})} />
          {sound.data && (
            <button class="btn ghost" onClick={resetSound}>
              {L("Son par défaut", "Default sound")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
