# WikiMasters Toolbox — Cahier des charges

Extension de navigateur (Chrome, Edge, Brave, Opera, Firefox) qui regroupe tous les outils de ce dépôt
(tri automatique, doublons, recherche d'échanges) et les meilleures idées des extensions existantes,
pour que n'importe quel joueur puisse s'en servir sans Node, sans token et sans agent IA.

Toute l'implémentation est originale : aucune ligne n'est reprise d'une autre extension.

## 1. Décisions

| Sujet | Décision |
|---|---|
| Nom | **WikiMasters Toolbox** |
| Interface | Intégrée au site : entrée « Toolbox » dans le menu de wiki-masters.com, badges et boutons dans les pages, popup d'extension pour les actions rapides |
| Données partagées | Aucun serveur pour l'instant : tout reste dans le navigateur ; le partage passe par des **codes** à copier-coller (profils d'intérêts, familles) |
| Ouverture automatique des paquets sans clic | **Exclue** (comportement de bot, risque pour le compte). « Tout ouvrir » reste déclenché par un clic, avec confirmation |
| Moteur de tri | Un seul moteur (`core/`), partagé par l'extension, les scripts Node et les tests |
| Distribution | `.zip` installé en mode développeur d'abord, stores ensuite |
| Langue | Interface en français ou en anglais selon la langue du navigateur (première langue prise en charge de sa liste, anglais à défaut), sans réglage. Noms d'étiquettes (thèmes, `Doublon`, `Pour : …`) jamais traduits : ce sont des données du compte. Scripts Node et documentation en français |

## 2. Principes

1. **Aucune écriture sans clic explicite** du joueur (tags, ventes, enchères, paquets). Toute écriture
   importante est précédée d'un aperçu. Exceptions : les options désactivées par défaut que le joueur
   active lui-même (tri des cartes tirées, réclamation des succès).
2. **Pas de token à manipuler** : la session est lue dans les cookies du site, la clé publique Supabase
   est observée dans les requêtes du site.
3. **Respect du serveur** : concurrence limitée, réessais avec délai croissant, réponses 429 respectées,
   un `POST` n'est jamais rejoué automatiquement, lecture passive des réponses que le site reçoit déjà.
4. **Les tags personnels ne sont jamais touchés** : seuls les tags gérés par la Toolbox (thèmes,
   `Pour : …`, `Doublon`) sont créés, modifiés ou retirés.
5. **Chaque fonctionnalité se désactive** dans les réglages.
6. **Robuste aux changements du site** : sélecteurs d'interface regroupés, repli silencieux si un
   élément n'est pas trouvé, interface de la Toolbox isolée dans un Shadow DOM.

## 3. Fonctionnalités

Priorité : **P1** indispensable · **P2** important · **P3** bonus.

### 3.1 Socle

| # | Exigence | Prio |
|---|---|---|
| S1 | Session lue dans les cookies `sb-…-auth-token.N` (access token + id du joueur), relue avant chaque appel | P1 |
| S2 | Lecture passive des réponses du site (collection, paquets ouverts, échanges, annonces) pour alimenter les caches | P1 |
| S3 | Stockage dans `chrome.storage.local` (illimité), jamais dans le `localStorage` du site | P1 |
| S4 | Tâches longues reprenables : progression enregistrée, reprise après rechargement | P1 |
| S5 | File réseau : concurrence limitée, délais croissants, 429/5xx gérés, pas de `POST` rejoué | P1 |
| S6 | Verrou entre onglets pour les écritures (tri, paquets) | P1 |
| S7 | Réglages : un interrupteur par fonctionnalité, couleurs des tags | P1 |
| S8 | Entrée « Toolbox » dans le menu du site + popup d'extension | P1 |
| S9 | Tests automatisés (`node --test`) sans réseau, jeu de cartes étiquetées pour le moteur | P1 |
| S10 | Paquets `.zip` Chrome et Firefox générés par `npm run build` | P2 |
| S11 | Interface bilingue français / anglais (panneau, blocs intégrés, popup, messages, nombres et dates), description du manifeste traduite (`_locales`) | P2 |

### 3.2 Tri automatique et tags

| # | Fonctionnalité | Prio |
|---|---|---|
| T1 | **Trier mes nouvelles cartes** : thème + tags `Pour : …` pour les cartes sans tag de thème ; aperçu puis application | P1 |
| T2 | **Doublon** recalculé sur toute la collection à chaque tri | P1 |
| T3 | **Retri complet** (options avancées) : resynchronise toute la collection, avertit que les corrections manuelles d'un tag géré sont écrasées, aperçu obligatoire | P1 |
| T4 | Pastille du thème sur les cartes affichées par le site | P2 |
| T5 | Après l'ouverture d'un paquet, proposition de trier immédiatement les nouvelles cartes | P2 |
| T6 | « Mauvais thème ? » : génère un rapport à copier (carte, thème obtenu, thème attendu) pour enrichir le jeu de test | P3 |
| T7 | **Thèmes personnalisés** : chaque joueur renomme, recolore, modifie (mots-clés), ajoute ou supprime des thèmes dans les réglages ; retour aux thèmes par défaut ; import / export en JSON ; étiquettes renommées au tri suivant, celles des thèmes supprimés retirées au retri complet après confirmation | P2 |
| T8 | **Reprendre ses étiquettes** : les étiquettes posées à la main deviennent des thèmes (nouveau thème, ou nom donné à un thème existant), pour ne pas retrier une collection déjà classée | P2 |
| T9 | **Tri sans thèmes** (réglage) : seulement `Doublon` et « Pour : … » ; les étiquettes de thème existantes ne sont plus touchées | P2 |
| T10 | **Favoris exclus du tri** (réglage, désactivé par défaut) : un exemplaire en favori ne reçoit ni ne perd aucune étiquette, `Doublon` compris | P2 |
| T11 | **Étiquette Favori** (réglage, désactivé par défaut) : `Favori` sur les exemplaires en favori, retirée quand l'étoile l'est, pour filtrer ses favoris dans la collection du site | P2 |

### 3.3 Profils d'intérêts (« Pour : … »)

Remplacent les règles codées en dur pour chaque ami.

| # | Fonctionnalité | Prio |
|---|---|---|
| I1 | **Mon profil** : ce que je collectionne (thèmes génériques, mots-clés, exclusions) | P1 |
| I2 | **Profils de mes amis** : chaque profil génère le tag `Pour : <pseudo>` lors du tri | P1 |
| I3 | Éditeur simple (thèmes + mots-clés séparés par des virgules, `*` pour un préfixe) et éditeur avancé (règles) | P1 |
| I4 | Partage par code : j'exporte mon profil, mes amis l'importent | P1 |
| I5 | Export / import JSON de tous les profils (le mien et ceux de mes amis), avec résumé avant import ; les profils de la bande ne sont plus fournis avec l'extension publiée (ils restent pour les scripts Node) | P2 |
| I6 | Test d'un profil sur ma collection : nombre de cartes concernées, exemples | P2 |

### 3.4 Échanges

| # | Fonctionnalité | Prio |
|---|---|---|
| E1 | **Trouver des échanges avec un ami** : ses cartes que je n'ai pas et qui correspondent à mon profil ou à ma liste de souhaits ; mes cartes qui correspondent à son profil (ou mes doublons) ; filtres thème / rareté / recherche | P1 |
| E2 | Collection de l'ami en cache (12 h), téléchargement reprenable, filtre de rareté côté serveur | P1 |
| E3 | Valeur d'un échange en cours : prix du marché de chaque carte et total de chaque côté (WikiBidous compris) | P2 |
| E4 | Proposition équilibrée : sélection de cartes à proposer pour une valeur proche de celle demandée | P2 |
| E5 | Cartes engagées dans un échange en cours signalées | P2 |

### 3.5 Prix et marché

| # | Fonctionnalité | Prio |
|---|---|---|
| P1 | Prix du marché par carte (par rareté), en badge sur les cartes, mis en cache. Robuste aux ventes aberrantes (médiane des 30 dernières ventes), prix à part pour les shiny, fiable seulement à partir d'un nombre de ventes réglable (3 par défaut), sans les toutes premières ventes de la carte (1 par défaut, réglable) ; un prix non fiable reste affiché « ≈ » mais n'entre dans aucun calcul | P1 |
| P2 | Chargement des prix en masse, par rareté (« seulement les cartes sans prix » possible) | P1 |
| P3 | Valeur estimée de ma collection | P2 |
| P4 | Classement de mes cartes les plus chères, filtrable par tag | P2 |
| P5 | **Mes doublons** : liste des exemplaires en trop triés par valeur (un exemplaire est toujours conservé), mise en vente ou défausse (1 WikiBidou) en un clic avec confirmation | P2 |
| P6 | **Mes enchères** : enchères en cours, temps restant, surenchère en un clic avec confirmation (à la mise minimum du site : +10 % arrondi au supérieur, au moins +1), alerte quand une enchère se termine bientôt | P2 |
| P9 | Liste filtrée de la collection triée par rareté ou par valeur (croissante, décroissante) | P2 |
| P7 | **Stonks** : page du menu du site, historique de mes achats et ventes aux enchères par jour, semaine ou mois ; plus-value de l'achat-revente, flux net, cartes achetées encore en stock ; vue « achat-revente » limitée aux cartes achetées puis revendues. Historique seulement, aucune action | P2 |
| P8 | **Enchère dans le titre de l'onglet** : sur la page d'une enchère, temps restant, position (en tête, surenchéri), mise actuelle ; signal visible depuis un autre onglet à chaque nouvelle mise | P2 |
| P10 | **Prochaines enchères d'une carte** : dans l'analyse d'une enchère, bouton qui ouvre une fenêtre avec toutes les enchères en cours de la même carte (rareté, mise, prochaine mise, écart au prix du marché, temps restant, position, lien) ; en tête du bloc, avertissement quand je mise déjà sur une autre enchère de cette carte (en tête ou surenchéri) ou que j'en vends un exemplaire | P2 |

### 3.6 Paquets

| # | Fonctionnalité | Prio |
|---|---|---|
| K1 | Récapitulatif après un paquet : cartes, nouveautés, doublons, prix du marché, valeur totale | P1 |
| K2 | Statistiques de tirage : répartition des raretés, réinitialisables | P2 |
| K3 | « Tout ouvrir » : ouvre tous les paquets disponibles sans animation, sur clic + confirmation, en respectant le délai du site entre deux paquets (429 « trop rapide » : attente puis même paquet redemandé) ; s'arrête à toute autre erreur et à la vérification anti-robot, laissée au joueur | P2 |
| K4 | Étiquettes et favori de chaque carte tirée en un clic, à côté de la carte pendant la révélation et dans le récapitulatif | P2 |
| K5 | Suspense à la révélation, plus long pour une carte plus rare (option) | P3 |
| K7 | Roulette façon ouverture de caisse pour la dernière carte d'un paquet, à la place du suspense (option) | P3 |
| K8 | Le son de la Légendaire du site ne dévoile pas une carte encore cachée par le suspense ou la roulette | P2 |
| K6 | Récapitulatif et taux de drop placés à gauche, dessous ou à droite ; récapitulatif gardé après « Continuer » | P2 |

### 3.7 Familles

| # | Fonctionnalité | Prio |
|---|---|---|
| F1 | Familles manuelles : groupes de cartes choisies dans le catalogue, avec progression « X / Y possédées » | P2 |
| F2 | **Familles intelligentes** : définies par une règle (thème, mots-clés, rareté), remplies automatiquement depuis le catalogue | P2 |
| F3 | Cartes manquantes d'une famille actuellement en vente sur le marché | P3 |
| F4 | Partage d'une famille par code | P2 |
| F8 | Ordre de la liste des familles : rangement libre (glisser-déposer), nom, complétion, dernière modification ; même chose pour les cartes d'une famille (rangement libre, nom, rareté, prix) ; choix gardés | P2 |
| F5 | Transformer une famille en tag Wikimasters (et l'inverse) | P3 |
| F6 | Cartes manquantes d'une famille ajoutées à la liste de souhaits du site, en un clic après confirmation | P2 |
| F7 | Ajout de cartes à une famille : recherche au mot exact (titre exact et homonymes en tête, puis mots entiers du titre) | P2 |

### 3.8 Cartes et confort

| # | Fonctionnalité | Prio |
|---|---|---|
| C1 | Lien Wikipédia sur les cartes | P1 |
| C2 | Badge « possédée / manquante » sur les cartes vues hors de ma collection | P2 |
| C3 | Image de remplacement (Wikipédia / Wikimedia Commons) pour les cartes sans image | P3 |
| C4 | Son discret à l'arrivée d'une notification | P3 |
| C5 | **Succès** : liste et progression des succès du site, réclamation de toutes les récompenses disponibles en un clic ; option (désactivée par défaut) de réclamation automatique | P2 |

### 3.9 Intégration dans les pages du site

Les fonctions courantes sont accessibles là où le joueur en a besoin, sans ouvrir la Toolbox. Chaque bloc
(« îlot ») est isolé dans un Shadow DOM, se désactive dans les réglages (groupe « Pages du site ») et
partage son état avec l'onglet correspondant du panneau.

| # | Fonctionnalité | Prio |
|---|---|---|
| D1 | **Collection** : barre sous les filtres — « Trier les nouvelles cartes » (aperçu sur place : cartes à classer, étiquettes, doublons ; « Appliquer » sur clic), raccourcis Doublons et Prix | P2 |
| D2 | **Fiche d'une carte** (fenêtre ouverte au clic, sur toutes les pages) : prix du marché de la rareté (instantané si en cache), thème, amis intéressés (« Pour : … »), possession, ajout à une famille | P2 |
| D3 | **Page d'une enchère** : prix du marché, écart entre la mise et ce prix, carte déjà possédée ou nouvelle, amis intéressés | P2 |
| D4 | **Marché** : pastille « −X % » sur une enchère qui se termine dans moins de 15 min sous le prix du marché, « +X % » quand la mise minimale dépasse nettement ce prix (prix fiable seulement) | P3 |
| D5 | **Profil d'un ami** : recherche d'échanges sur place (raretés au choix), aperçu des cartes à demander et à proposer | P2 |

## 4. Hors périmètre (pour l'instant)

- Ouverture automatique des paquets sans clic, ou tout ce qui imite un comportement humain.
- Serveur partagé (instantanés de collection, bibliothèque publique de familles) : reporté.
- Toute action déclenchée sans geste du joueur, hors options désactivées par défaut qu'il active lui-même (tri des cartes tirées, réclamation des succès).

## 5. Architecture

Un moteur partagé sans dépendance (`core/`), utilisé par l'extension (`extension/`), les scripts Node (`scripts/`) et les tests (`tests/`). Arborescence commentée et circulation des données : [architecture.md](architecture.md).

## 6. Jalons

1. **J1** — `core/` extrait, scripts Node branchés dessus, score du jeu de test inchangé.
2. **J2** — Socle de l'extension (S1-S9) + tri (T1-T3) + profils (I1-I4).
3. **J3** — Échanges (E1-E2, E5), prix (P1-P4), paquets (K1-K2), cartes (C1-C2), pastilles (T4).
4. **J4** — Marché (P5-P6), échanges avancés (E3-E4), paquets (K3), familles (F1-F4), confort.

## 7. État d'implémentation (v0.1.0)

Toutes les fonctionnalités des sections 3.1 à 3.9 sont implémentées. Écarts et précisions :

| # | Précision |
|---|---|
| S4 | Les tâches longues sont reprenables : la collection d'un ami est enregistrée page par page ; le tri recalcule son plan depuis la base (ajouts idempotents avant suppressions), il suffit de le relancer. |
| S5 | Lectures réessayées (délai croissant, `Retry-After`), écritures jamais rejouées sauf idempotentes ; une écriture sans réponse est signalée « peut-être prise en compte ». Une page HTML reçue au lieu de JSON est une erreur. Session relue au moment d'envoyer, renouvelée une fois après un 401. |
| S6 | Verrou `navigator.locks` pour le tri et « Tout ouvrir » ; le tri des cartes tirées et « famille → étiquette » attendent leur tour sur le même verrou (une étiquette n'est jamais créée deux fois). |
| S9 | Tests sans réseau du moteur, de l'écriture des étiquettes (`core/tag-writer.js`, reprise après panne) et de la couche réseau / stockage de l'extension (`fetch` et `chrome.storage` simulés). |
| K1 | Récapitulatif intégré à la page Paquets (pas de fenêtre) : il attend que le site ait révélé la dernière carte (bouton « Continuer ») et, avec le suspense (K5) ou la roulette (K7), la fin de sa révélation, puis s'affiche dessous, puis reste sous le bouton « Ouvrir ». Prix chargés dès l'ouverture, avec indicateur de chargement par carte et pour le total. Nouveautés calculées par une requête sur les exemplaires possédés. Paquet normal, PRO du jour et spéciaux. Après « Continuer », il reste sur l'écran « Ouvrir un paquet » (« Paquet précédent ») jusqu'au paquet suivant ou à sa fermeture ; pendant l'ouverture d'un paquet, il attend la révélation (aucune carte dévoilée à l'avance). Gardé dans `chrome.storage.local` (`lastRecap` : champs affichés ou utiles au classement, résumé tronqué à 600 caractères, résultat du tri automatique s'il est terminé) et repris au chargement de la page s'il n'y a pas de paquet plus récent ; rechargé pendant la révélation, il s'affiche directement ; nouveautés recalculées si le rechargement les a interrompues. Un onglet ne remplace jamais le récapitulatif gardé par un paquet plus ancien. |
| K4 | Panneau placé dans le bloc de la carte révélée (après le compteur « Carte n / N », carte = index dans la réponse du site), dessous s'il n'y a pas 280 px à droite. Étiquettes relues à chaque paquet puis à la fin du tri automatique ; écritures sous le verrou `sort` par `core/tag-writer.js` ; un seul thème par carte (ajout du nouveau, puis retrait de l'ancien). Étoile : bouton du site quand la carte est affichée (le site garde son état), sinon `PATCH user_cards.starred` comme le site. |
| K5 | Rien n'est posé sur la carte (un rideau opaque a été essayé puis écarté) : la carte du site est cachée avant son premier affichage (style en ligne `animation: none; opacity: 0`, qui l'emporte sur `animate-card-flip…`), une fois par carte et par paquet, puis entre avec une animation de la Toolbox selon sa rareté (`wmt-enter-*` de `ui/site.css`, délai et durée `ENTER` de `features/suspense.js`), qui remplace le retournement du site : mettre seulement en pause celui du site faisait jouer les deux animations l'une après l'autre. L'animation reste en ligne sur l'élément jusqu'à ce que le site le remplace (sinon le retournement du site rejouerait) ; les effets du site liés à la fin de son retournement (gerbe de la Légendaire, reflet shiny) ne se jouent donc plus, remplacés par ceux de la Toolbox. Les sons du site ne sont pas modifiés, sauf celui de la Légendaire (voir plus bas). À sa place, un dos de carte (première version, contour en pointillés et échelle de lettres, jugée peu spectaculaire) : texture de rareté et logo du site (`site-assets.js`, textures chargées d'avance), anneau de 6 segments, nom de la rareté. Paliers identiques pour toutes les raretés (120 ms d'apparition, puis 180 à 320 ms, de plus en plus lents), arrêt de 120 à 210 ms, charge de 0 (C, PC) à 400 ms (L), 160 ms de plus pour une shiny : 0,24 s pour une Commune, 1,9 s pour une Légendaire, 2,1 s au plus (des versions de 0,46 à 3,7 s puis de 0,32 à 2,5 s ont été jugées trop lentes). Révélation de 0,28 s (C) à 1,25 s (L). Effets liés au palier atteint, pas à la rareté finale (le suspense reste entier) : battement, onde et reflet à chaque palier, aura croissante, rayons (SR, masqués sur la carte), lumière de la page baissée, flottement et braises (UR). Charge : tremblement, dos assombri, fissures (SR), particules aspirées (UR). Révélation : jusqu'à SR, le dos se retourne (`back` ms) et la carte du site enchaîne de -90° à 0 ; à partir d'UR, le dos devient lumière et la carte sort d'un flash, surexposée (`filter: brightness`). Ondes de choc, gerbe, aura qui revient (éteinte pendant le retournement : la place vide se verrait), reflet sur la carte (irisé pour une shiny). Le panneau K4 attend la fin (`total` de `ENTER`). Un composant neuf par carte. Petit écran : hôte en `overflow: clip` (marge de 14 px), sans rayons, aura resserrée (pas de défilement horizontal). Exception à la charte, réservée à ce moment : lueurs, dégradés et lumière aux couleurs des raretés. `prefers-reduced-motion` respecté. |
| K7 | Option `packRoulette`, désactivée par défaut, indépendante de `packSuspense` : même rétention de la carte du site que K5 (`startSuspense`, une fois par carte et par paquet, `prefers-reduced-motion` respecté), pour la carte d'index `total - 1` du compteur « Carte n / N » seulement ; même hôte que le suspense (classe `wmt-roulette`), élargi autour de la carte sans sortir de l'écran (`--half` : 560 px au plus de chaque côté, marge de 8 px ; `--cw`, `--ch` : taille de la carte, posées par `site-dom.js` seulement quand elles changent). Bande de 56 dos (texture de rareté du site, 48 % de la carte, 40 % sur un petit écran), carte tirée au 49e : dos tirés selon `dropCounts()` de `packs.js` (mes tirages à partir de 50 cartes, sinon la répartition de la collection, comme K2 ; approximation fixe à défaut), quasi-raté une fois sur deux (dos suivant d'une à deux raretés au-dessus, s'il en existe). Arrêt n'importe où sur un dos, à ±46 % de sa largeur autour de son centre (côté tiré à pile ou face, distance `0,46 × √u` : plus souvent loin du centre), immobile 0,42 s, puis recentrage. Défilement de 5,4 s (`1 - (1 - t)^4`, piloté par `requestAnimationFrame` : position calculée à chaque image, cliquetis à chaque dos qui passe sous le repère : clic synthétisé par Web Audio dans `roulette-sound.js`, bruit aigu de 9 ms, bruit filtré résonant vers 3,3 kHz, « toc » de 25 ms (1 kHz → 480 Hz), hauteur ±4 % par cran ; ou son importé par le joueur dans *Réglages*, vérifié avant d'être gardé (type `audio/*`, 300 Ko au plus, décodable par le navigateur), gardé en data: URL dans `chrome.storage.local` (`rouletteSound`), jamais inclus dans l'extension, joué 0,6 s au plus, décodé sans `fetch`), arrêt sur place 0,42 s, recentrage 0,32 s, le dos grandit à la taille de la carte en 0,42 s, arrêt 0,16 s, puis révélation `ENTER` de K5 (retournement ou flash, ondes de choc). Les effets ne dépendent que de la rareté de la carte et la bande en montre les dos à l'approche : c'est le principe d'une ouverture de caisse, différent du suspense K5. Pas de visuel, de son ni de nom repris d'un jeu existant : textures et logo du site, repère à la couleur d'accent de la Toolbox. |
| K8 | Son de la Légendaire du site pendant K5 et K7 : le site (Web Audio, `playSound` de son module de sons : `pack-rip`, `card-flip`, `legendary-reveal` dans `/audio/*.mp3`) joue `legendary-reveal` dans le clic qui passe à une Légendaire (ou à l'affichage de la première carte), avant que la carte soit affichée : il dévoilait la rareté pendant l'attente, surtout pendant les 6 à 7 s de la roulette. `card-flip`, joué pour chaque carte, ne dit rien de la rareté et n'est pas touché. `hook/main-world.js` reconnaît le son à son fichier (octets lus par `fetch(…).arrayBuffer()` marqués, puis le tampon rendu par `decodeAudioData`) et retient son `AudioBufferSourceNode.start()` tant que le script de contenu le demande (`legendary-sound` : `hold`) ; à la levée, le nœud retenu est démarré ; arrêté par le site entre-temps (`stop()`, carte quittée), il est oublié. La retenue est posée d'avance (le son part avant l'affichage) : tant qu'une Légendaire du paquet, animée (suspense, ou roulette si c'est la dernière carte) et pas encore jouée, reste à révéler, ou que la carte affichée est retenue (`holdsLegendarySound` de `suspense.js`) ; et dès la requête d'ouverture d'un paquet (`arm` : suspense ou roulette activés), le temps que le script de contenu lise le paquet. Filet de sécurité : levée au bout de 10 min sans nouvelle. `prefers-reduced-motion` : jamais retenu. |
| K6 | Colonnes fixes dans la marge de `<main>`, de part et d'autre du contenu centré (largeur mesurée à chaque passage et au redimensionnement), sous le solde de WikiBidous ; sous le minimum (340 px récapitulatif, 280 px taux), le bloc revient dessous. |
| K2 | Graphique des taux de drop par rareté sur l'écran « Ouvrir un paquet » : mes tirages comptés par l'extension, ou la répartition de toute ma collection tant qu'il y a moins de 50 cartes tirées. Barres aux couleurs de rareté du site, rareté aussi portée par le libellé. |
| T5 | Option « Trier automatiquement les cartes tirées » (désactivée par défaut) : dès l'ouverture d'un paquet, les exemplaires tirés (identifiés par `user_card_id` dans la réponse du site) reçoivent thème, « Pour : … » et Doublon, en quelques requêtes ; un exemplaire qui a déjà un thème n'est pas modifié, rien n'est supprimé. Le récapitulatif affiche les étiquettes posées. Sans l'option, il propose « Trier les nouvelles cartes ». |
| T6 | Non implémenté (P3) : la correction passe par les profils ou par l'ajout de la carte au jeu de test. |
| P1-P2 | Prix calculés à partir des ventes conclues (table `auctions`), lues par lots : toute une collection (~7 600 cartes) en ~5 min, au lieu de ~12 s par carte avec la route du site, gardée en dernier recours. Médiane plutôt que moyenne : sur 75 000 ventes (600 cartes, octobre 2026), elle prédit mieux la vente suivante (écart typique ×1,56 contre ×1,72, 1 cas sur 10 au-delà de ×4,1 contre ×5,7). Le site exclut les ventes shiny de sa moyenne : la Toolbox aussi, avec un prix shiny à part. Remplacer un prix peu fiable par celui de la rareté a été écarté : il prédit plus mal, la carte comptant bien plus que sa rareté. |
| P4 | Classement filtrable par thème calculé (lire les étiquettes de 7 000 cartes à chaque affichage serait trop lent). |
| P6 | Alerte par message et son ; vérification toutes les 60 s (20 s dans les 5 dernières minutes) tant qu'une enchère est en cours et l'onglet visible. |
| P8 | Le site ne relit pas l'enchère affichée : l'extension la relit toutes les 30 s, 15 s dans les 10 dernières minutes, 5 s dans les 2 dernières, et au retour sur l'onglet. Symbole en tête du titre (✓ en tête, ✗ surenchéri, ↑ nouvelle mise) pour rester lisible dans un onglet étroit ; le titre clignote jusqu'à ce que l'onglet soit revu. Titre du site rendu en quittant la page. |
| P10 | Lues dans la table `auctions` par l'id de la carte (`card_id=eq.…&status=eq.active&order=end_at.asc,id.asc`) : exact et en une requête, là où la recherche du marché par titre (celle des familles) peut en manquer pour un titre courant. Une enchère encore `active` dont la fin est passée (pas encore réglée) est écartée. Comptées à l'ouverture de la page (nombre sur le bouton), relues à l'ouverture de la fenêtre ; temps restant mis à jour toutes les 15 s. Fenêtre affichée par la Toolbox (comme la mise en vente), donc par-dessus la page et hors du bloc. Mes mises : table `auction_bids` filtrée sur moi et sur les enchères en cours de la carte (chacun ne lit que ses propres mises), plus haute mise par enchère ; exact, alors que la liste « mes enchères » du site (`mine=1`) est limitée à 50 par page. Lecture seule. |
| C5 | Lecture dans Supabase (`achievements`, `user_achievements`) après la synchronisation du site (`POST /api/achievements/check`, que sa page Succès fait à chaque visite). Réclamations une à une sous le verrou `achievements`, arrêt à la première erreur. Option automatique : au chargement, toutes les 15 min (onglet visible), 5 s après un paquet ou un échange (au plus une passe par minute). |
| P7 | Ventes rapprochées des achats « premier entré, premier sorti », par carte, rareté et version shiny (un exemplaire n'a pas d'identifiant propre : `user_cards` regroupe les exemplaires par `count`). Une vente sans achat correspondant compte dans les ventes et le flux net, pas dans la plus-value. Page ouverte par `#stonks` sur la page en cours, faute de route sur le site. |
| E3 | Valeur des échanges : encart flottant sur la page Échanges + détail dans l'onglet Échanges (le rendu des échanges du site varie trop pour y greffer des badges). |
| F2 | Le catalogue compte ~2,8 millions de cartes : une famille intelligente part d'une recherche du site (10 pages de 50 cartes au plus), filtrée ensuite par mots-clés, exclusions, thèmes et raretés. |
| F8 | Ordre calculé par `sortFamilies` / `sortFamilyCards` (`core/families.js`, testés) sans modifier la liste ; « Mon ordre » est l'ordre de la liste enregistrée (`moveItem`) ; ordre des cartes gardé dans la famille (`cardSort`), rangement sans changer `updatedAt` ; actualisation d'une famille intelligente : `keepCardOrder` (cartes déjà présentes à leur place, nouvelles à la fin). Glisser commun aux deux listes : `ui/sortable.js` ; le clic que le navigateur envoie après le lâcher (à l'élément désormais sous le pointeur) est ignoré, sinon il ouvrirait la famille lâchée ; avec un filtre, les flèches passent d'une carte affichée à la suivante. Glisser-déposer par événements de pointeur (souris et doigt, Firefox Android compris), suivis sur toute la fenêtre : la famille glissée change de place dans la grille pendant le glisser, et sa poignée perdrait le pointeur. Alternative au clavier sur la poignée (flèches, Début, Fin), focus rendu après chaque déplacement. Échap annule un glisser ou ferme une fenêtre de la Toolbox sans fermer le panneau (écouté en phase de capture). |
| C2 | Badge « ✓ » (possédée) partout hors collection, « Nouvelle » sur le marché et les profils ; rien sur la collection globale, qui l'affiche déjà. |
