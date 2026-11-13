// Onglet « Nouveautés » : ce qui change à chaque version, écrit pour les joueurs (extension/changelog.json),
// accueil d'une nouvelle installation, et message après une mise à jour.
import {useState, useEffect} from "preact/hooks";
import {useStore} from "../../lib/store";
import {emit} from "../../lib/bus";
import {settings, settingsFocus, FEATURES} from "../../state/settings";
import {news, releases, unseenReleases, initNews, markSeen, itemText, AREAS, GUIDE_URL} from "../../state/news";
import {Icon, plural} from "../components";
import {toast} from "../feedback";
import {L, LOCALE} from "../../../shared/i18n";

const openTab = (tab) => emit("open-panel", {tab});
const featureOf = (key) => FEATURES.find((f) => f.key === key);
const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(LOCALE, {day: "numeric", month: "long", year: "numeric"});

// Après le démarrage : accueil d'une nouvelle installation, ou nouveautés de la version installée,
// annoncées une fois par version
export async function announceNews() {
  await news.ready;
  const install = !news.get().seen;
  const state = await initNews();
  if (install && state.welcome) return welcomeToast();
  if (state.notified === __VERSION__) return;
  const count = unseenReleases(state.seen).reduce((n, r) => n + r.items.length, 0);
  news.set({notified: __VERSION__});
  if (!count) return;
  toast(L(`La Toolbox passe en version ${__VERSION__} : ${plural(count, "nouveauté")}.`, `The Toolbox is now version ${__VERSION__}: ${plural(count, "new change", "new changes")}.`), {
    duration: 15000,
    action: {label: L("Voir", "View"), run: () => openTab("news")},
  });
}

function welcomeToast() {
  toast(L("La Toolbox est installée. Ouvrez-la depuis l'entrée « Toolbox » du menu du site.", 'The Toolbox is installed. Open it from the "Toolbox" entry in the site menu.'), {
    duration: 15000,
    action: {label: L("Découvrir", "Discover"), run: () => openTab("news")},
  });
}

function NewsItem({item}) {
  const s = useStore(settings);
  const feature = item.feature && featureOf(item.feature);
  const off = feature && s.features[feature.key] === false;
  const see = () => {
    if (item.tab) return openTab(item.tab);
    settingsFocus.set({key: feature.key});
    openTab("settings");
  };
  return (
    <li class="news-item">
      <span class="txt">{itemText(item)}</span>
      {(feature || item.tab) && (
        <span class="acts">
          {off && (
            <button
              class="btn sm"
              title={feature.label}
              onClick={() => {
                settings.set((st) => ({...st, features: {...st.features, [feature.key]: true}}));
                toast(L(`Option activée : ${feature.label}.`, `Option turned on: ${feature.label}.`), {type: "ok"});
              }}
            >
              {L("Activer", "Turn on")}
            </button>
          )}
          <button class="btn sm ghost" onClick={see}>
            {L("Voir", "View")}
          </button>
        </span>
      )}
    </li>
  );
}

function Release({release, fresh}) {
  // Rubriques dans l'ordre de leur première nouveauté (la plus importante en tête)
  const areas = [...new Set(release.items.map((i) => i.area))];
  return (
    <section class="box stack news-release">
      <div class="row">
        <h3>{L(`Version ${release.version}`, `Version ${release.version}`)}</h3>
        {fresh && <span class="chip accent">{L("Nouveau pour vous", "New for you")}</span>}
        <span class="spacer" />
        <span class="small muted">{fmtDate(release.date)}</span>
      </div>
      {areas.map((a) => (
        <div key={a} class="news-area">
          <div class="eyebrow">{AREAS[a]}</div>
          <ul class="news-items">
            {release.items
              .filter((i) => i.area === a)
              .map((item, n) => (
                <NewsItem key={n} item={item} />
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

// Premiers pas d'une nouvelle installation
const START = [
  {tab: "sort", fr: "Triez votre collection : chaque carte reçoit l'étiquette de son thème (Sports, Histoire…), visible et filtrable sur la page Collection du site.", en: "Sort your collection: each card gets its theme tag (Sports, Histoire…), visible and filterable on the site's Collection page."},
  {tab: "packs", fr: "Ouvrez un paquet : un récapitulatif donne les nouveautés, les doublons et le prix de chaque carte.", en: "Open a pack: a recap shows new cards, duplicates and the price of each card."},
  {tab: "trades", fr: "Préparez vos échanges : la Toolbox trouve les cartes d'un ami qui vous intéressent, et les vôtres qui l'intéressent.", en: "Prepare your trades: the Toolbox finds a friend's cards you want, and your cards they want."},
  {tab: "settings", fr: "Choisissez ce que la Toolbox affiche : chaque fonction se désactive dans les réglages, et certaines options sont à activer vous-même.", en: "Choose what the Toolbox shows: each feature can be turned off in the settings, and some options are yours to turn on."},
];

function Welcome() {
  return (
    <section class="box stack">
      <div>
        <h3>{L("Bienvenue dans la Toolbox", "Welcome to the Toolbox")}</h3>
        <p class="help">
          {L(
            "La Toolbox ajoute des informations aux pages du site (prix du marché, thèmes, récapitulatif des paquets…) et rassemble ses outils dans ce panneau. Rien n'est écrit sur votre compte sans un clic de votre part.",
            "The Toolbox adds information to the site's pages (market prices, themes, pack recaps…) and gathers its tools in this panel. Nothing is written to your account without a click from you.",
          )}
        </p>
      </div>
      <ul class="news-items">
        {START.map((s) => (
          <li key={s.tab} class="news-item">
            <span class="txt">{L(s.fr, s.en)}</span>
            <span class="acts">
              <button class="btn sm ghost" onClick={() => openTab(s.tab)}>
                {L("Voir", "View")}
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div class="row">
        <a class="btn" href={GUIDE_URL} target="_blank" rel="noopener noreferrer">
          <Icon name="help" size={16} /> {L("Lire le guide", "Read the guide (in French)")}
        </a>
        <button class="btn ghost" onClick={() => news.set({welcome: false})}>
          {L("Masquer", "Hide")}
        </button>
      </div>
    </section>
  );
}

export function NewsTab() {
  const {welcome} = useStore(news);
  // Versions nouvelles pour le joueur à l'ouverture de l'onglet, marquées vues aussitôt
  const [fresh] = useState(() => new Set(unseenReleases(news.get().seen).map((r) => r.version)));
  useEffect(markSeen, []);
  const list = releases();
  // Versions nouvelles (au moins la dernière) en entier, les précédentes repliées
  const shown = Math.max(1, fresh.size);
  return (
    <div class="stack">
      <div class="page-head">
        <div>
          <h2>{L("Nouveautés", "What's new")}</h2>
          <p>
            {L(
              "Ce qui change à chaque version de la Toolbox. Une nouvelle option est souvent désactivée au départ : « Activer » l'allume, « Voir » montre où elle se trouve.",
              'What changes in each version of the Toolbox. A new option is often off at first: "Turn on" switches it on, "View" shows where it is.',
            )}
          </p>
        </div>
      </div>
      {welcome && <Welcome />}
      {list.slice(0, shown).map((r) => (
        <Release key={r.version} release={r} fresh={fresh.has(r.version)} />
      ))}
      {list.length > shown && (
        <details class="news-older">
          <summary>{L("Versions précédentes", "Previous versions")}</summary>
          <div class="stack">
            {list.slice(shown).map((r) => (
              <Release key={r.version} release={r} fresh={false} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
