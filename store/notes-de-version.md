# Notes de version

Une section par version, la plus récente en premier. Pour chaque version :

- **Note complète** : message du commit de version (`vX.Y.Z : …`) et description de la release GitHub.
- **Firefox Add-ons** : à coller dans *Notes de version* au dépôt du paquet (texte brut, une langue par
  champ : anglais par défaut, puis français).
- Le Chrome Web Store n'a pas de champ de notes de version : rien à saisir.

## 2.2.2

### Note complète

```
v2.2.2 : récapitulatif après la roulette, arrêt de la roulette n'importe où sur le dos

Paquets
- Le récapitulatif du paquet s'affichait dès le passage du bouton du site à « Continuer », donc pendant
  la roulette ou le suspense de la dernière carte, qu'il dévoilait. Il attend maintenant la fin de sa
  révélation (ensureRevealExtras rend l'état de la carte cachée à ensurePullsWidgets).
- Roulette : le repère s'arrête n'importe où sur le dos de la carte (±46 % de sa largeur, plus souvent
  loin du centre, parfois à un cheveu du dos d'avant ou d'après) au lieu de ±40 %, et la bande reste
  immobile 0,42 s à l'endroit de l'arrêt (phase « stop ») avant de se recentrer. Environ 7 s en tout.

Tests (169), guide, cahier des charges (K1, K7) et notes de version mis à jour.
```

### Firefox Add-ons : notes de version (anglais)

```
Changed in 2.2.2

Packs
- The pack summary now appears only once the last card has been revealed, after the roulette or the suspense.
- The roulette can stop anywhere on the card back, often close to an edge, and pauses there for a moment before centering.
```

### Firefox Add-ons : notes de version (français)

```
Modifié dans la 2.2.2

Paquets
- Le récapitulatif du paquet n'apparaît qu'une fois la dernière carte révélée, après la roulette ou le suspense.
- La roulette peut s'arrêter n'importe où sur le dos de la carte, souvent près d'un bord, et y reste un instant avant de se recentrer.
```

## 2.2.1

### Note complète

```
v2.2.1 : le son de la Légendaire ne dévoile plus la carte pendant la roulette ou le suspense

Paquets
- Le site joue son son de Légendaire (legendary-reveal) dans le clic qui passe à la carte, avant de
  l'afficher : pendant la roulette (6 s) ou le suspense, il dévoilait la rareté. Le script de la page
  (hook/main-world.js) reconnaît ce son à son fichier et le retient tant que la Toolbox cache la carte,
  puis le joue à la révélation ; quitter la carte avant l'oublie. Retenue posée d'avance tant qu'une
  Légendaire du paquet reste à révéler (holdsLegendarySound de features/suspense.js, syncLegendarySound
  de site-dom.js) et dès l'ouverture d'un paquet. Les autres sons du site ne changent pas.

Tests (168), guide, architecture, site-api (sons du site), cahier des charges (K8) et AGENTS.md mis à jour.
```

### Firefox Add-ons : notes de version (anglais)

```
Fixed in 2.2.1

Packs
- The site's Legendary sound no longer gives the card away during the roulette or the suspense: it now plays when the card is revealed.
```

### Firefox Add-ons : notes de version (français)

```
Corrigé dans la 2.2.1

Paquets
- Le son de la Légendaire du site ne dévoile plus la carte pendant la roulette ou le suspense : il est joué à sa révélation.
```

## 2.2.0

### Note complète

```
v2.2.0 : roulette pour la dernière carte d'un paquet, avec son cliquetis ou un son importé

Paquets
- Roulette pour la dernière carte (option, désactivée par défaut) : la dernière carte d'un paquet est
  révélée comme une caisse qu'on ouvre, à la place du suspense (les autres cartes le gardent). La lumière
  de la page baisse ; une bande de 56 dos de cartes (texture de rareté et logo du site, liseré de rareté)
  défile sous un repère, ralentit pendant 5,4 s et s'arrête sur le dos de la rareté de la carte, souvent
  un peu à côté de son centre, avant de s'y recentrer. Dos tirés selon les taux de drop du joueur (ses
  tirages, sinon la répartition de sa collection) ; une fois sur deux, le dos suivant est plus rare
  (quasi-raté). Le dos de la carte grandit à sa place avec le nom de sa rareté (irisé pour une shiny),
  puis se révèle comme au suspense (retournement, ou flash dès Ultra Rare). Environ 6 s ; un clic passe le
  défilement, un deuxième la révélation ; rien ne se joue si le système demande moins d'animations.
  features/roulette.js, ui/islands/Roulette.jsx.
- Cliquetis à chaque dos qui passe : clic mécanique synthétisé par la Toolbox, ou son importé par le
  joueur dans les réglages (« Son du cliquetis » : écouter, importer un fichier audio de 300 Ko au plus,
  revenir au son par défaut). Le son importé est vérifié, gardé dans le navigateur uniquement et joué
  0,6 s au plus. features/roulette-sound.js.

Tests (163), README, guide, architecture, cahier des charges, AGENTS.md et fiches des stores mis à jour.
```

### Firefox Add-ons : notes de version (anglais)

```
New in 2.2.0

Packs
- Roulette for the last card (option, off by default): the last card of a pack is revealed like a case being opened. A strip of card backs, drawn from your drop rates, scrolls under a marker with a clicking sound, slows down and stops on the card's rarity, which is then revealed. Replaces the suspense for that card only. One click skips the wait.
- Click sound: the Toolbox's mechanical click, or import your own short sound in the settings (kept in your browser only).
```

### Firefox Add-ons : notes de version (français)

```
Nouveautés de la 2.2.0

Paquets
- Roulette pour la dernière carte (option, désactivée par défaut) : la dernière carte d'un paquet se révèle comme une caisse qu'on ouvre. Une bande de dos de cartes, tirés selon vos taux de drop, défile sous un repère avec un cliquetis, ralentit et s'arrête sur la rareté de la carte, qui se révèle. Remplace le suspense pour cette carte seulement. Un clic passe l'attente.
- Son du cliquetis : le clic mécanique de la Toolbox, ou votre propre son court importé dans les réglages (gardé dans votre navigateur uniquement).
```

## 2.1.0

### Note complète

```
v2.1.0 : suspense à la révélation, étiquettes pendant la révélation, récapitulatif gardé, enchères d'une même carte, rangement des familles, étiquette Favori

Paquets
- Suspense à la révélation (activé par défaut sur une nouvelle installation ; option à activer dans les
  réglages après une mise à jour). Chaque carte jamais vue reste face cachée : son dos (texture de rareté
  et logo du site) se charge palier par palier, de Commune jusqu'à sa rareté (texture, anneau de six
  segments, nom de la rareté, battement, onde, reflet). Aura croissante, rayons dès Super Rare, lumière de
  la page baissée, flottement et braises dès Ultra Rare. Paliers de même durée quelle que soit la rareté
  finale : on ne sait pas où la montée s'arrête. Puis charge (tremblement, fissures de lumière, particules
  aspirées) et révélation : jusqu'à Super Rare, le dos se retourne et la carte enchaîne le retournement ;
  en Ultra Rare et Légendaire, la carte sort surexposée d'un flash, avec ondes de choc et gerbe. Reflet
  final sur la carte, irisé pour une shiny. De 0,24 s (Commune) à 1,9 s (Légendaire) d'attente ; un clic
  passe l'attente ; rien ne se joue si le système demande moins d'animations. Remplace l'animation du site
  (ses sons sont gardés). features/suspense.js, ui/islands/Suspense.jsx.
- Étiquettes et favori à côté de la carte révélée (option, activée) : nouveauté, prix, étoile du site et
  étiquettes en un clic (thème calculé, dernières étiquettes utilisées, recherche ou création). Les mêmes
  boutons dans chaque ligne du récapitulatif. features/quick-tags.js, ui/QuickTags.jsx.
- Récapitulatif gardé après « Continuer » (« Paquet précédent ») jusqu'au paquet suivant ou à sa
  fermeture, y compris après un rechargement de la page ou un redémarrage du navigateur.
- Récapitulatif et taux de drop à placer à gauche, dessous ou à droite : à côté du contenu, le bloc reste
  fixe dans la marge ; il revient dessous faute de place. features/pack-dock.js, ui/DockPicker.jsx.
- « Doublons » ne coche plus les cartes mises en favori.

Marché
- Analyse d'une enchère : prévient quand vous misez déjà sur une autre enchère de la même carte (en tête
  ou surenchéri, mises, temps restant, lien) et quand vous vendez déjà un exemplaire.
- « Prochaines enchères de cette carte » : toutes les enchères en cours de la carte, de la fin la plus
  proche à la plus lointaine, avec mise, prochaine mise possible, prix du marché, écart, temps restant et
  votre position. ui/CardAuctions.jsx.

Tri
- Réglage « Étiquette Favori » (désactivé par défaut) : `Favori` sur les exemplaires mis en favori,
  retirée quand l'étoile l'est, recalculée à chaque tri comme `Doublon`, pour filtrer ses favoris dans la
  collection du site. Nom réservé. core/tag-sync.js : withFavorites.

Familles
- Ordre de la liste : mon ordre (glisser-déposer par une poignée, à la souris, au doigt ou au clavier),
  nom, complétion, récentes.
- Ordre des cartes d'une famille : mon ordre, nom, rareté, prix. Le rangement fait partie du code de
  partage et survit à l'actualisation d'une famille intelligente. ui/sortable.js.

Tests (156), README, guide, architecture, site-api, cahier des charges, AGENTS.md et fiches des stores
mis à jour.
```

### Firefox Add-ons : notes de version (anglais)

```
New in 2.1.0

Packs
- Suspense on reveal: each new card stays face down and charges up rarity by rarity, then bursts open with an effect that grows with its rarity (flash, shockwaves, light rays; iridescent sheen for shiny cards). On by default for new installs; turn it on in the settings after an update. One click skips the wait.
- Tags and favorite next to the revealed card: tag a card or star it in one click while the pack is revealed, and from each row of the recap.
- The pack recap stays on screen as "Previous pack" after the site's "Continuer" button, even after reloading the page.
- Place the recap and drop rates on the left, below or on the right.
- "Duplicates" no longer selects starred cards.

Market
- An auction's analysis warns you when you already bid on another auction of the same card, or already sell a copy of it.
- "Upcoming auctions for this card": every running auction of the card, with bids, market price and time left.

Sorting
- Optional "Favori" tag on your starred cards, to filter them in your collection.

Families
- Order families and the cards in a family your way (drag and drop) or by name, completion, rarity or price.
```

### Firefox Add-ons : notes de version (français)

```
Nouveautés de la 2.1.0

Paquets
- Suspense à la révélation : chaque nouvelle carte reste face cachée et se charge de rareté en rareté, puis éclate avec un effet qui grandit avec sa rareté (flash, ondes de choc, rayons ; reflet irisé pour une shiny). Activé par défaut sur une nouvelle installation ; à activer dans les réglages après une mise à jour. Un clic passe l'attente.
- Étiquettes et favori à côté de la carte révélée : étiquetez ou mettez en favori en un clic pendant la révélation, et depuis chaque ligne du récapitulatif.
- Le récapitulatif du paquet reste affiché après « Continuer », même après un rechargement de la page.
- Récapitulatif et taux de drop à placer à gauche, dessous ou à droite.
- « Doublons » ne coche plus les cartes en favori.

Marché
- L'analyse d'une enchère prévient si vous misez déjà sur une autre enchère de la même carte, ou si vous en vendez déjà un exemplaire.
- « Prochaines enchères de cette carte » : toutes les enchères en cours de la carte, avec mises, prix du marché et temps restant.

Tri
- Étiquette « Favori » en option sur vos cartes en favori, pour les filtrer dans votre collection.

Familles
- Familles et cartes d'une famille rangées à votre goût (glisser-déposer) ou par nom, complétion, rareté ou prix.
```
