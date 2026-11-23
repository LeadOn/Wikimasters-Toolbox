# WikiMasters Toolbox

![WikiMasters Toolbox](store/images/promo-440x280.png)

Extension de navigateur **non officielle** pour [WikiMasters](https://www.wiki-masters.com/), faite par des joueurs pour des joueurs : tri automatique des cartes, prix du marché, échanges, paquets, familles et succès, directement dans les pages du site.

> **Avertissement.** Les règles de la communauté de WikiMasters interdisent les bots, scripts et outils qui jouent ou interagissent à votre place, ainsi que la modification ou l'interception du trafic du site, et ses conditions d'utilisation prévoient la suspension ou le bannissement d'un compte, notamment en cas d'utilisation d'automatisation. Utiliser cette extension peut donc être considéré comme contraire à ces règles. Le joueur qui choisit de l'utiliser le fait en connaissance de cause et sous sa seule responsabilité, y compris en cas de sanction ou de bannissement de son compte ; le ou les développeurs ne peuvent en être tenus responsables. L'extension est fournie telle quelle, sans garantie, et demande d'accepter cet avertissement avant de démarrer.

*[English summary below](#english)*

---

## Fonctionnalités

- **Tri automatique** : un thème par carte (Histoire, Sciences, Sports, Pop-Culture…) posé en étiquette WikiMasters, l'étiquette `Doublon` sur les cartes en plusieurs exemplaires, et une étiquette « Pour : pseudo » pour chaque ami qu'une carte intéresse. Liste de thèmes modifiable (noms, couleurs, mots-clés, ajout, suppression), à partager en JSON, ou reprise de vos propres étiquettes ; tri sans thèmes (seulement `Doublon` et « Pour : … »), favoris exclus du tri et étiquette `Favori` sur vos cartes en favori (pour les filtrer dans la collection) en option. Aperçu avant chaque tri ; vos étiquettes personnelles et vos corrections ne sont jamais touchées.
- **Prix** : prix du marché de chaque carte dans sa rareté (le prix moyen de la semaine, comme l'onglet Marché du site, « ≈ » quand la carte s'est vendue trop peu de fois ; minimum de ventes réglable), affiché sur les cartes du site, dans leur fiche et sur les enchères ; indexation en arrière-plan des prix de toute votre collection (option). Valeur de votre collection, classement de vos cartes les plus chères, et filtres de toute la collection, cumulables (doublons, sans image, GIF) et par vente (jamais vendues, vendues entre X et Y ₩), affinés par mots-clés à inclure ou exclure ou par étiquette (avec, sans, ou l'une des vôtres) et triés par rareté ou par valeur, sur la page Collection et dans l'onglet Prix : les cartes trouvées, affichées en grand comme dans la grille du site, se mettent aux enchères ou se défaussent une à une ou en lot.
- **Marché** : pastilles « bonne affaire » et « trop cher », analyse de chaque enchère avec la liste des autres enchères en cours de la même carte, suivi de vos enchères avec surenchère en un clic et alerte avant la fin, temps restant et position (en tête, surenchéri) dans le titre de l'onglet d'une enchère, vente ou défausse de vos doublons.
- **Stonks** : une page du menu du site avec l'historique de vos achats et ventes aux enchères par jour, semaine ou mois, la plus-value de l'achat-revente (chaque vente rapprochée de son achat, avec une vue qui n'affiche que les cartes achetées puis revendues), le flux net et vos cartes achetées encore en stock avec leur plus-value latente.
- **Échanges** : profils d'intérêts partageables par code ou en JSON ; sur le profil d'un ami, ses cartes qui vous intéressent, les vôtres qui l'intéressent, et une offre équilibrée en prix du marché. Bilan de l'offre en cours de composition (valeur de chaque côté, différence) et filtres sur toute la collection de l'ami (ou la vôtre) dans la fenêtre d'échange (prix, nom ou description, thème, raretés, cartes que vous n'avez pas, hors favoris, doublons), favoris et cartes déjà possédées signalés, ajout à l'offre en un clic et valeur de chaque côté des échanges en cours.
- **Paquets** : récapitulatif après chaque paquet (nouveautés, doublons, prix, valeur totale), en lignes ou en cartes comme sur le site, détail de chaque carte comme la fenêtre du site (attaque, défense, Q-Score, vues, prix), où les cartes cochées se défaussent ensemble pour 1 WikiBidou chacune et où chaque carte se met aux enchères, « Ouvrir le prochain » pour enchaîner les paquets, étiquettes et favori en un clic à côté de chaque carte révélée, suspense à la révélation selon la rareté (option), roulette façon ouverture de caisse pour la dernière carte (option), récapitulatif et taux de drop à placer à gauche, dessous ou à droite, taux de drop par rareté (depuis le début ou du jour), « Tout ouvrir » sur votre clic, avec ses cartes distribuées puis retournées paquet après paquet, leur prix et la valeur cumulée, effets selon la rareté et meilleures cartes à la fin.
- **Familles** : groupes de cartes à compléter, choisies une à une ou remplies par une recherche, rangées à votre goût (glisser-déposer) ou triées par nom, complétion ou date, comme les cartes de chaque famille (nom, rareté, prix), avec les cartes manquantes en vente ou ajoutées en un clic à votre liste de souhaits.
- **Succès** : vos succès, leur progression et leurs récompenses, toutes réclamées en un clic, ou automatiquement dès qu'un succès est débloqué (option).
- **Images** : n'afficher que vos cartes sans image, ou celles dont l'image est un GIF, sur toute la collection (onglet Images et page Collection).
- **Sur les cartes** : un nouvel affichage, avec l'image sur toute la carte et un cadre aux couleurs de la rareté ; les images manquantes cherchées sur Wikimedia (Wikipédia, Wikidata et ses éléments liés), sinon la carte sans image du site ; thème, prix, possédée ou nouvelle, lien vers l'article Wikipédia ; la page Collection dans l'ordre de votre choix à chaque visite (date d'ajout, nom…).
- **Nouveautés** : après chaque mise à jour, ce qui a changé, avec un bouton pour activer chaque nouvelle option ; recherche dans les réglages et lien vers la section du guide de chaque onglet.

L'interface s'adapte aux petits écrans (navigateur mobile qui accepte les extensions, fenêtre étroite) : panneau en plein écran, fenêtres ouvertes depuis le bas, boutons à la taille du doigt. Elle est en français ou en anglais, selon la langue du navigateur.

Chaque fonction se désactive dans les réglages. Rien n'est écrit sur votre compte sans un clic de votre part (sauf les options automatiques que vous activez : tri des cartes tirées, réclamation des succès), et aucune donnée ne quitte votre navigateur en dehors de WikiMasters.

**Tout est expliqué dans le [guide de l'utilisateur](docs/guide.md).**

---

## Installation

**Chrome, Edge, Brave, Opera** : installez *WikiMasters Toolbox* depuis le [Chrome Web Store](https://chromewebstore.google.com/detail/wikimasters-toolbox/akiompkjikkfmmmgekgficomoahhhajh), puis rechargez wiki-masters.com. L'entrée **Toolbox** apparaît dans le menu du site, et l'icône de l'extension ouvre les actions rapides.

**Firefox** : installez *WikiMasters Toolbox* depuis [Firefox Add-ons](https://addons.mozilla.org/fr/firefox/addon/wikimasters-toolbox/), puis rechargez wiki-masters.com.

**Depuis le code source** (Chrome 120+ ou Firefox 128+) :

1. `npm install`, puis `npm run build`.
2. Chrome et dérivés : `chrome://extensions` → *Mode développeur* → *Charger l'extension non empaquetée* → dossier `dist/chrome`.
   Firefox : `about:debugging#/runtime/this-firefox` → *Charger un module complémentaire temporaire* → `dist/firefox/manifest.json`.
3. Rechargez wiki-masters.com.

---

## Vos données

L'extension n'a ni serveur, ni compte, ni publicité, ni statistiques d'usage. Elle utilise votre session WikiMasters pour parler à WikiMasters, comme le site lui-même, et garde tout le reste dans votre navigateur. Voir la [politique de confidentialité](PRIVACY.md).

---

## Documentation

| Document | Pour qui | Contenu |
|---|---|---|
| [Guide de l'utilisateur](docs/guide.md) | Joueurs | Chaque fonction, page par page et onglet par onglet, réglages, questions fréquentes |
| [Scripts Node](docs/scripts.md) | Joueurs avancés | Trier et chercher des échanges en ligne de commande, faire évoluer les règles de tri |
| [Structure du projet](docs/architecture.md) | Contributeurs | Arborescence commentée, moteur, extension, tests, build |
| [Routes du site](docs/site-api.md) | Contributeurs | API de wiki-masters.com utilisée par l'extension |
| [Cahier des charges](docs/cahier-des-charges.md) | Contributeurs | Décisions, principes, fonctionnalités prévues et réalisées |
| [AGENTS.md](AGENTS.md) | Agents IA et contributeurs | Règles du projet, fonctionnement du tri, charte graphique |
| [Publication](store/README.md) | Mainteneurs | Mise en ligne sur le Chrome Web Store |

---

## Développement

```bash
npm install
npm run watch   # build continu dans dist/
npm test        # tests du moteur et de l'extension, sans réseau
npm run eval    # qualité du classement sur le jeu de cartes étiquetées
```

Le dépôt contient un moteur de tri partagé (`core/`), l'extension (`extension/`), des scripts Node (`scripts/`) et les tests (`tests/`) : voir la [structure du projet](docs/architecture.md). Un problème ou une idée : [issues](https://github.com/LeadOn/Wikimasters-Toolbox/issues).

---

## English

> **Warning.** WikiMasters' community rules forbid bots, scripts and tools that play or interact on your behalf, as well as modifying or intercepting the site's traffic, and its terms of use provide for suspending or banning an account, in particular when automation is used. Using this extension may therefore be considered a breach of these rules. Players who choose to use it do so knowingly and at their own risk, including if their account is sanctioned or banned; the developer or developers cannot be held responsible. The extension is provided as is, without warranty, and asks you to accept this warning before it starts.

WikiMasters Toolbox is an **unofficial** browser extension for [WikiMasters](https://www.wiki-masters.com/), made by players for players. Right inside the site's pages, it adds:

- **Automatic sorting**: one theme per card stored as a WikiMasters tag, a `Doublon` tag on cards you own more than once, and a "Pour : name" tag for each friend a card would interest. The theme list is yours to edit and share as JSON, or to build from your own tags; sorting without themes (only `Doublon` and "Pour : …") and leaving favorites out are options. Every sort is previewed first; your own tags and manual fixes are never touched.
- **Prices**: each card's average price for the week in its rarity (as in the site's Market tab), on cards, in their detail window and on auctions; optional background indexing of your whole collection's prices; collection value, most valuable cards, and your collection ordered by value.
- **Market**: "good deal" and "overpriced" badges, your auctions with one-click outbid and an ending alert, time left and whether you lead or were outbid in an auction's browser tab title, selling or discarding your duplicates.
- **Stonks**: a page in the site menu with your auction purchases and sales by day, week or month, the profit of each resale (every sale matched with its purchase, with a view limited to cards bought then resold), net cash flow, and the cards you bought and still hold with their unrealized profit.
- **Trades**: interest profiles shareable by code or JSON; on a friend's profile, the cards you want from them, the cards they want from you, and a balanced offer.
- **Packs**: a recap after each pack (new cards, duplicates, prices, total value) where each card can be put up for auction or discarded for 1 WikiBidou, drop rates, and "Open all" on your click.
- **Families**: sets of cards to complete, hand-picked or filled from a search; missing cards can be added to your wishlist in one click.
- **Achievements**: your achievements, their progress and rewards, all claimed in one click, or automatically as soon as one is unlocked (option).
- **Cards**: a new card layout with a full-bleed image and a rarity-colored frame; missing images looked up on Wikimedia (Wikipedia, Wikidata and its linked items); the Collection page in the order of your choice on every visit (date added, name…).
- **What's new**: after each update, what changed, with a button to turn each new option on; search in the settings and a link to the guide section of each tab.

The interface adapts to small screens (mobile browsers that support extensions, narrow windows).

Every feature can be turned off. Nothing is written to your account without a click (except the automatic options you turn on: sorting pulled cards, claiming achievements), there is no third-party server, and your data stays in your browser ([privacy policy](PRIVACY.md)). The interface is in English unless your browser is set to French; the default theme and tag names (`Doublon`, "Pour : …") stay in French, and themes can be renamed in the settings. The documentation is in French: see the [user guide](docs/guide.md).

Install it from the [Chrome Web Store](https://chromewebstore.google.com/detail/wikimasters-toolbox/akiompkjikkfmmmgekgficomoahhhajh) (Chrome, Edge, Brave, Opera) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/wikimasters-toolbox/), then reload wiki-masters.com.

To build from source: `npm install && npm run build`, then load `dist/chrome` as an unpacked extension (`chrome://extensions`, developer mode) or `dist/firefox/manifest.json` as a temporary add-on in Firefox 128+.
