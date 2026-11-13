// Onglet « Réglages » : fonctionnalités, thèmes de tri, caches.
import {Fragment} from "preact";
import {useState, useEffect, useRef} from "preact/hooks";
import {useStore} from "../../lib/store";
import {keysWithPrefix, remove} from "../../lib/storage";
import {settings, settingsFocus, FEATURES, DEFAULT_SETTINGS} from "../../state/settings";
import {recentFeatures} from "../../state/news";
import {clearPrices} from "../../state/prices";
import {Toggle, FileButton, plural} from "../components";
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

export function SettingsTab() {
  const s = useStore(settings);
  const {key: focus} = useStore(settingsFocus);
  const [query, setQuery] = useState("");
  const root = useRef(null);
  const recent = recentFeatures();
  const words = fold(query).split(/\s+/).filter(Boolean);
  // Pendant une recherche, seules les options qui correspondent restent ; les autres blocs sont
  // masqués (pas retirés : une modification en cours de l'éditeur de thèmes est gardée)
  const shown = words.length ? FEATURES.filter((f) => matches(f, words)) : FEATURES;
  const searching = words.length > 0;
  const groups = [...new Set(shown.map((f) => f.group))];
  const setFeature = (key, on) => settings.set((st) => ({...st, features: {...st.features, [key]: on}}));
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
        {searching && <span class="small muted">{shown.length ? plural(shown.length, "option") : L("Aucune option ne correspond.", "No option matches.")}</span>}
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
                  <Toggle checked={s.features[f.key] !== false} label={f.label} onChange={(on) => setFeature(f.key, on)} />
                </div>
                {f.key === "packRoulette" && s.features.packRoulette && <RouletteSound />}
              </Fragment>
            ))}
          </div>
        ))}
        <div class="box stack" hidden={searching}>
          <h3>{L("Prix et délais", "Prices and timing")}</h3>
          <label class="field">
            <span>{L("Durée de validité d'un prix (heures)", "How long a price stays valid (hours)")}</span>
            <input type="number" min="1" max="720" value={s.priceMaxAgeHours} onChange={(e) => settings.set({priceMaxAgeHours: Math.max(1, Number(e.currentTarget.value) || 48)})} />
          </label>
          <label class="field">
            <span>{L("Ventes minimum pour un prix fiable", "Minimum sales for a reliable price")}</span>
            <input type="number" min="1" max="50" value={s.minSales} onChange={(e) => settings.set({minSales: count(e.currentTarget.value, 1, 50, DEFAULT_SETTINGS.minSales)})} />
          </label>
          <label class="field">
            <span>{L("Premières ventes ignorées, par carte et par rareté", "First sales ignored, per card and rarity")}</span>
            <input type="number" min="0" max="20" value={s.skipFirstSales} onChange={(e) => settings.set({skipFirstSales: count(e.currentTarget.value, 0, 20, DEFAULT_SETTINGS.skipFirstSales)})} />
          </label>
          <p class="help">
            {L(
              "Une carte vendue une ou deux fois n'a pas de prix représentatif, et ses toutes premières ventes se font souvent à un prix sans rapport avec le marché. En dessous du minimum, le prix est affiché « ≈ » à titre indicatif : il ne compte ni dans les totaux, ni dans les mises de départ proposées, ni dans les bonnes affaires.",
              'A card sold once or twice has no representative price, and its very first sales often go at a price unrelated to the market. Below the minimum, the price is shown with "≈" as a rough guide: it does not count in totals, suggested starting bids or deals.',
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
