// Ordre par défaut de la page Collection : l'option choisie dans les réglages est sélectionnée dans le
// menu du site une fois par visite ; un ordre choisi ensuite par le joueur est gardé.
const test = require("node:test");
const assert = require("node:assert/strict");
const {loadExtensionModule} = require("./helpers/extension");

const LABELS = ["Rareté", "Nom", "Favoris", "Date d'ajout"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Menu du site : un bouton au libellé de l'ordre affiché, qui ouvre (aria-expanded) ou referme une
// liste d'options ; openDelayMs : menu qui met du temps à s'ouvrir
function fakeMenu({labels = LABELS, interactive = true, openDelayMs = 0} = {}) {
  const menu = {opened: 0, picked: []};
  let list = null;
  const button = {
    textContent: "Rareté",
    getAttribute: (name) => ({"aria-controls": "menu-list", "aria-expanded": String(Boolean(list))})[name] ?? null,
    click() {
      if (!interactive) return;
      if (list) return void (list = null);
      menu.opened++;
      const open = () => (list = {querySelectorAll: () => options});
      if (openDelayMs) setTimeout(open, openDelayMs);
      else open();
    },
  };
  const options = labels.map((label) => ({
    textContent: ` ${label} `,
    click() {
      menu.picked.push(label);
      button.textContent = label;
      list = null;
    },
  }));
  globalThis.document = {getElementById: (id) => (id === "menu-list" ? list : null)};
  menu.button = button;
  menu.isOpen = () => Boolean(list);
  return menu;
}

const load = () => loadExtensionModule("extension/src/content/features/collection-order.js");
const page = (menu, wanted, onPage = true) => ({onPage, button: onPage ? menu.button : null, wanted, optionSelector: '[role="option"]'});

test("ordre choisi : sélectionné une fois par visite, l'ordre choisi ensuite par le joueur est gardé", async () => {
  const {ensureCollectionOrder} = load();
  const menu = fakeMenu();
  assert.equal(await ensureCollectionOrder(page(menu, "Date d'ajout")), true);
  assert.deepEqual(menu.picked, ["Date d'ajout"]);
  assert.equal(menu.isOpen(), false);

  // Le joueur repasse par rareté : rien n'est changé pendant la visite
  menu.button.textContent = "Rareté";
  assert.equal(await ensureCollectionOrder(page(menu, "Date d'ajout")), false);
  assert.deepEqual(menu.picked, ["Date d'ajout"]);

  // Visite suivante : l'ordre est de nouveau posé
  await ensureCollectionOrder(page(menu, "Date d'ajout", false));
  assert.equal(await ensureCollectionOrder(page(menu, "Date d'ajout")), true);
  assert.deepEqual(menu.picked, ["Date d'ajout", "Date d'ajout"]);
});

test("réglage changé pendant la visite : le nouvel ordre est appliqué tout de suite", async () => {
  const {ensureCollectionOrder} = load();
  const menu = fakeMenu();
  await ensureCollectionOrder(page(menu, "Date d'ajout"));
  assert.equal(await ensureCollectionOrder(page(menu, "Nom")), true);
  assert.deepEqual(menu.picked, ["Date d'ajout", "Nom"]);
  // Retour à l'ordre du site : rien n'est choisi pour le joueur
  assert.equal(await ensureCollectionOrder(page(menu, null)), false);
  assert.equal(menu.opened, 2);
});

test("ordre du site ou déjà affiché : le menu n'est pas ouvert", async () => {
  const {ensureCollectionOrder} = load();
  const menu = fakeMenu();
  assert.equal(await ensureCollectionOrder(page(menu, null)), false);
  assert.equal(menu.opened, 0);

  menu.button.textContent = "Date d'ajout";
  const other = load();
  assert.equal(await other.ensureCollectionOrder(page(menu, "Date d'ajout")), false);
  assert.equal(menu.opened, 0);
});

test("menu pas encore interactif : nouvel essai, trois au plus", async () => {
  const {ensureCollectionOrder} = load();
  const menu = fakeMenu({interactive: false});
  for (let i = 0; i < 5; i++) assert.equal(await ensureCollectionOrder(page(menu, "Date d'ajout")), false);
  assert.equal(menu.opened, 0);
});

test("menu lent à s'ouvrir : le passage suivant s'en sert sans le refermer", async () => {
  const {ensureCollectionOrder} = load();
  const menu = fakeMenu({openDelayMs: 1200});
  assert.equal(await ensureCollectionOrder(page(menu, "Date d'ajout")), false);
  await sleep(300);
  assert.equal(menu.isOpen(), true);
  assert.equal(await ensureCollectionOrder(page(menu, "Date d'ajout")), true);
  assert.equal(menu.opened, 1);
  assert.deepEqual(menu.picked, ["Date d'ajout"]);
  assert.equal(menu.isOpen(), false);
});

test("joueur parti pendant l'attente du menu : pas d'erreur, rien n'est choisi", async () => {
  const {ensureCollectionOrder} = load();
  const menu = fakeMenu({openDelayMs: 500});
  const pending = ensureCollectionOrder(page(menu, "Date d'ajout"));
  await sleep(100);
  assert.equal(await ensureCollectionOrder(page(menu, "Date d'ajout", false)), false);
  assert.equal(await pending, false);
  assert.deepEqual(menu.picked, []);
});

test("option absente du menu : menu refermé, ordre du site gardé, pas de nouvel essai", async () => {
  const {ensureCollectionOrder} = load();
  const menu = fakeMenu({labels: ["Rareté", "Nom"]});
  assert.equal(await ensureCollectionOrder(page(menu, "Date d'ajout")), false);
  assert.equal(menu.isOpen(), false);
  assert.equal(await ensureCollectionOrder(page(menu, "Date d'ajout")), false);
  assert.equal(menu.opened, 1);
  assert.equal(menu.button.textContent, "Rareté");
});

test("réglage : ordre du site par défaut, hors des interrupteurs", () => {
  const {DEFAULT_SETTINGS, FEATURES} = loadExtensionModule("extension/src/content/state/settings.js");
  assert.equal(DEFAULT_SETTINGS.collectionOrder, "rarity");
  assert.equal("collectionOrder" in DEFAULT_SETTINGS.features, false);
  const feature = FEATURES.find((f) => f.key === "collectionOrder");
  assert.deepEqual(feature.choices.map((c) => c.id), ["rarity", "name", "favorites", "added"]);
});
