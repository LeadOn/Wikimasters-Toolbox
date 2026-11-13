// Nouveautés : journal des versions (extension/changelog.json) bien formé et écrit pour les joueurs,
// versions pas encore vues, options récentes, premier lancement, liens vers le guide.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {loadExtensionModule} = require("./helpers/extension");

const root = path.join(__dirname, "..");
const changelog = require("../extension/changelog.json");
const pkg = require("../package.json");

// Stockage d'extension en mémoire
function fakeBrowser(initial = {}) {
  const data = structuredClone(initial);
  globalThis.window = globalThis;
  globalThis.chrome = {
    runtime: {id: "test"},
    storage: {
      local: {
        get: async (key) => (key == null ? structuredClone(data) : Object.fromEntries([].concat(key).filter((k) => k in data).map((k) => [k, structuredClone(data[k])]))),
        set: async (obj) => Object.assign(data, structuredClone(obj)),
        remove: async (key) => [].concat(key).forEach((k) => delete data[k]),
      },
      onChanged: {addListener() {}, removeListener() {}},
    },
  };
  return data;
}

const load = () => loadExtensionModule({news: "extension/src/content/state/news.js", settings: "extension/src/content/state/settings.js"});
const panelTabs = () => [...fs.readFileSync(path.join(root, "extension/src/content/ui/App.jsx"), "utf8").matchAll(/\{id: "([a-z]+)", label:/g)].map((m) => m[1]);

test("journal : versions de la plus récente à la plus ancienne, version en cours décrite", () => {
  const {news} = load();
  const versions = changelog.releases.map((r) => r.version);
  for (const v of versions) assert.match(v, /^\d+\.\d+\.\d+$/);
  assert.equal(new Set(versions).size, versions.length, "version en double");
  for (let i = 1; i < versions.length; i++) assert.ok(news.compareVersions(versions[i - 1], versions[i]) > 0, `${versions[i - 1]} doit précéder ${versions[i]}`);
  assert.ok(versions.includes(pkg.version), `extension/changelog.json n'a pas d'entrée pour la version ${pkg.version} de package.json`);
});

test("journal : chaque nouveauté a ses deux langues, une rubrique, un réglage et un onglet qui existent", () => {
  const {settings} = load();
  const features = new Set(settings.FEATURES.map((f) => f.key));
  const tabs = new Set(panelTabs());
  assert.ok(tabs.has("news") && tabs.has("settings"));
  for (const r of changelog.releases) {
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, r.version);
    assert.ok(r.items.length, `${r.version} : aucune nouveauté`);
    for (const item of r.items) {
      const where = `${r.version} : ${item.fr}`;
      assert.deepEqual(Object.keys(item).filter((k) => !["area", "fr", "en", "feature", "tab"].includes(k)), [], where);
      assert.ok(item.fr?.trim() && item.en?.trim(), where);
      assert.ok(item.area in changelog.areas, `${where} : rubrique inconnue ${item.area}`);
      if (item.feature) assert.ok(features.has(item.feature), `${where} : réglage inconnu ${item.feature}`);
      if (item.tab) assert.ok(tabs.has(item.tab), `${where} : onglet inconnu ${item.tab}`);
    }
  }
});

// Les nouveautés s'adressent aux joueurs : ce qu'ils voient ou peuvent faire, pas comment c'est fait
const TECHNICAL = [
  [/`/, "code entre accents graves"],
  [/\.(m?js|jsx|css|json|html)\b/, "nom de fichier"],
  [/\w\(\)|=>|\w_\w/, "code"],
  [/\b(?!Wiki(?:Masters|Bidous?)\b)[a-z]+[A-Z]\w*/, "identifiant en camelCase"],
  [/\/api\b|\b(API|commit|refactor\w*|hook|bundle|endpoint|regex|null|undefined|console|DOM|cookie|token)\b/i, "terme technique"],
];

test("journal : nouveautés écrites pour les joueurs, sans terme technique, en une ou deux phrases", () => {
  for (const r of changelog.releases)
    for (const item of r.items)
      for (const lang of ["fr", "en"]) {
        const text = item[lang];
        for (const [re, what] of TECHNICAL) assert.doesNotMatch(text, re, `${r.version} (${lang}) : ${what} dans « ${text} »`);
        assert.ok(text.length <= 320, `${r.version} (${lang}) : trop long (${text.length} caractères), « ${text} »`);
      }
});

test("versions non vues, publiées seulement", () => {
  const {news} = load();
  const log = [
    {version: "2.5.0", items: []},
    {version: "2.4.0", items: []},
    {version: "2.3.1", items: []},
    {version: "2.3.0", items: []},
  ];
  assert.deepEqual(news.unseenReleases("2.3.0", "2.4.0", log).map((r) => r.version), ["2.4.0", "2.3.1"]);
  assert.deepEqual(news.unseenReleases("2.4.0", "2.4.0", log), []);
  // Retour à une version plus ancienne : rien de nouveau
  assert.deepEqual(news.unseenReleases("2.5.0", "2.4.0", log), []);
  assert.ok(news.compareVersions("2.10.0", "2.9.9") > 0);
});

test("options récentes : citées par les deux dernières versions mineures publiées", () => {
  const {news} = load();
  const log = [
    {version: "2.5.0", items: [{feature: "future"}]},
    {version: "2.4.1", items: [{feature: "a"}]},
    {version: "2.4.0", items: [{feature: "b"}, {}]},
    {version: "2.3.0", items: [{feature: "c"}]},
    {version: "2.2.0", items: [{feature: "d"}]},
  ];
  assert.deepEqual([...news.recentFeatures("2.4.1", log)].sort(), ["a", "b", "c"]);
});

test("premier lancement : nouvelle installation sans annonce, mise à jour annoncée", async () => {
  fakeBrowser();
  let {news} = load();
  const fresh = await news.initNews("2.4.0");
  assert.deepEqual(fresh, {seen: "2.4.0", notified: "2.4.0", welcome: true});

  // Joueur qui avait déjà la Toolbox (réglages enregistrés), avant l'onglet Nouveautés :
  // seule la version installée est nouvelle
  fakeBrowser({settings: {features: {}}});
  ({news} = load());
  const updated = await news.initNews(changelog.releases[0].version);
  assert.equal(updated.welcome, false);
  assert.equal(updated.seen, changelog.releases[1].version);
  assert.deepEqual(news.unseenReleases(updated.seen, changelog.releases[0].version).map((r) => r.version), [changelog.releases[0].version]);

  // Déjà initialisé : rien ne change
  fakeBrowser({settings: {}, news: {seen: "2.2.0", notified: "2.2.0", welcome: false}});
  ({news} = load());
  assert.equal((await news.initNews("2.4.0")).seen, "2.2.0");
});

// Ancres des titres d'un fichier markdown, calculées comme GitHub (doublons suffixés -1, -2…)
function githubAnchors(markdown) {
  const seen = new Map();
  const anchors = new Set();
  for (const [, title] of markdown.matchAll(/^#{1,6} (.+)$/gm)) {
    const slug = title
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s/g, "-");
    const n = seen.get(slug) || 0;
    seen.set(slug, n + 1);
    anchors.add(n ? `${slug}-${n}` : slug);
  }
  return anchors;
}

test("guide : chaque onglet du panneau renvoie à une section du guide qui existe", () => {
  const {news} = load();
  const anchors = githubAnchors(fs.readFileSync(path.join(root, "docs/guide.md"), "utf8"));
  for (const tab of panelTabs()) {
    const anchor = news.GUIDE_ANCHORS[tab];
    assert.ok(anchor, `onglet ${tab} sans section du guide`);
    assert.ok(anchors.has(anchor), `onglet ${tab} : ancre #${anchor} absente de docs/guide.md`);
  }
});
