# WikiMasters Toolbox — Cahier des charges : adaptation au site de novembre 2026

Relevé du 21/11/2026 sur le site en production (compte connecté, **lectures seulement** : aucune écriture,
aucun paquet ouvert). Il remplace, pour tout ce qui touche aux sources de données, les parties
correspondantes de `docs/cahier-des-charges.md` et de `docs/site-api.md`.

Origine : issues GitHub n°5 et n°6 (prix absents, « jamais vendue dans cette rareté », « serveur
indisponible », « permission denied for table auctions »).

## 1. Constat

### 1.1 Ce qui a changé côté site

| # | Changement | Effet sur la Toolbox |
|---|---|---|
| C1 | Table Supabase `auctions` fermée : `403 {"code":"42501","message":"permission denied for table auctions"}` pour **toute** lecture (ventes conclues comme enchères en cours) | Plus aucun prix ; « Prochaines enchères de la carte » en erreur ; page Stonks vide |
| C2 | `GET /api/marketplace/cards/{id}/sales` ne renvoie plus `{summary: {RARETÉ: {average, count, latest}}}` mais `{recent: [5 dernières ventes {id, final_price, settled_at, rarity}]}` ; `scope=summary` est ignoré, `rarity=X` filtre ; ~200 ms au lieu de ~12 s | Le repli de `state/prices.js` enregistre un résumé vide : « jamais vendue dans cette rareté » |
| C3 | Nouvelle route `GET /api/marketplace/cards/{id}/price-history` : `{computed_at, by_rarity: {RARETÉ: {weekly: [{start, avg, min, max, count}], monthly: [...]}}}`, tout l'historique, recalculé au fil de la journée (`computed_at` avance comme l'heure, avec ~6 h 15 de retard ; corrigé le 21/11/2026 : il ne s'agit pas d'un calcul quotidien), `cache-control: private, max-age=300`, ~160-250 ms | Nouvelle source de prix, **une requête par carte** (plus de lecture par lots) |
| C4 | La fiche d'une carte du site a deux onglets, **Détails** / **Marché** ; l'onglet Marché affiche « Prix moyen de la semaine », plus bas, plus haut, nombre de ventes, graphique, 5 dernières ventes (requêtes : `price-history` + `sales?rarity=`) | Le joueur voit désormais un prix du site : celui de la Toolbox doit être cohérent avec lui |
| C5 | Anti-automatisation côté serveur : `403 {"code":"automation_limit","error":"Trop de requêtes automatisées. L'automatisation n'est pas autorisée — voir le règlement."}` ; déclenché au minimum par un paramètre que le site n'envoie jamais (`/api/marketplace?limit=100`) | Toute requête doit reprendre **exactement** les paramètres du site ; le seuil de débit est inconnu |
| C6 | Table `profiles` : `select=*` refusé (42501), colonnes `id, is_pro, is_admin` lisibles | Aucun (la Toolbox ne lit pas `profiles`) |
| C7 | `GET /api/marketplace?…&mine=1` : `selling`, `bidding`, `won`, `history` limités aux **50 derniers**, sans pagination (`page=2&mine=1` renvoie les mêmes) | Stonks ne peut plus relire tout l'historique par cette route |
| C8 | Lectures de `user_card_tags` par étiquette devenues rapides (150-260 ms au lieu de plusieurs secondes) ; jointure `user_cards?select=…,user_card_tags(tag_id)` possible (1 000 lignes en ~1,2 s) | Tri plus rapide possible |
| C9 | `GET /api/profile/{u}/collection` : ~300 ms par page de 50 (au lieu de 30 s), champs `starred` et `owned_by_viewer` présents | Recherche d'échanges bien plus rapide |
| C11 | **`price-history` est limitée en volume par compte** (relevé du 21/11/2026, vers 11:20) : après environ 90 à 100 lectures en une dizaine de minutes, dont une cinquantaine en rafale (une par carte visible sur la page Marché, 2 par seconde), le site répond `403 {"code":"automation_limit"}` sur cette route seulement (les autres routes répondent toujours). Seuil et durée du blocage inconnus. 6 lectures espacées de 2 s juste avant étaient passées | Rythmes du § 5 revus le 21/11/2026 : budget commun de 60 lectures par 10 min (10 par 30 s), moitié réservée aux cartes tirées et fiches ouvertes, pause de 15 min des seules lectures de prix après un refus (voir § 5) |
| C10 | Nouvelles pages et routes : guildes (`/api/guilds/*`, liste de souhaits de guilde, dons), duels (`/api/battles`), messages (`/api/chat`), vitrine (`/api/showcase`), collection globale, `my-collection?owned_by=<ami>` (champ `owned_by_peer`) | Hors périmètre (§ 8), opportunités |

### 1.2 Règlement du site (mis à jour le 20/07/2026, page `/rules`)

- **§ 3** : pas de bots, scripts, macros « visant à jouer, ouvrir des paquets, échanger ou interagir à
  votre place » ; pas de modification ni d'interception du trafic « pour obtenir un avantage ».
- **§ 8** : ne pas perturber le service (« surcharge, … contournement des limites techniques »).

La fermeture de `auctions` est donc à traiter comme une **décision du site**, pas comme une panne :
la Toolbox ne cherche pas d'accès détourné aux données retirées (aucune table fermée, aucune route
non utilisée par le site). Elle lit les données que le site expose lui-même (`price-history`), avec les
paramètres du site, à un débit fixe, bas et plafonné.

Risque assumé (décision du 21/11/2026) : l'indexation des prix de toute la collection (§ 4.1 bis)
fait des milliers de lectures par jour au rythme fixe d'une machine. Le site peut un jour la détecter
comme de l'automatisation (`automation_limit`, sanction du compte). Le débit par défaut, l'arrêt net au
premier signal et l'indexation désactivable limitent ce risque sans l'annuler ; le guide le dit au
joueur qui l'active.

Décisions arrêtées :
- **aucun serveur** : tout cache (prix compris) reste dans le navigateur du joueur ;
- **aucun contact avec l'équipe du site**, sous aucun prétexte (ni pour annoncer la Toolbox, ni pour
  demander des limites ou un accès).

### 1.3 Ce qui fonctionne toujours (vérifié le 21/11/2026)

**DOM** : tous les sélecteurs de `SEL` (`features/site-dom.js`) testés sont valides :
- menu (`nav` avec `/leaderboard`, 14 liens, `a[href="/marketplace"]`) ;
- cartes (`div[class*="glow-"][class*="rounded-2xl"]`, `h3`, texture `:scope > img`, `span[style]`, `svg.lucide-swords` / `lucide-shield`, `img[alt="WikiMasters"]`) ;
- collection (`main h1`, recherche « Rechercher par titre ou catégorie... », `aria-label="Trier la collection"` avec les options Rareté / Nom / Favoris / Date d'ajout) ;
- fiche d'une carte (`div.fixed.inset-0`, `h2`, grande carte `glow-*`) ;
- marché (50 cartes reliées à `/marketplace/{uuid}`) et page d'une enchère (`main h1`, carte `glow-*`) ;
- paquets (bouton « Ouvrir », compteur « 20 / 20 paquets disponibles » juste après) ;
- profil d'un ami (`main h1`, onglets Vitrine / Collection) ;
- fenêtre d'échange (« Moi : 0 cartes », « <ami> : 0 cartes », onglet « Mes cartes » en `border-b-2`, « Rechercher... »).

Le code client contient toujours `legendary-reveal`, `decodeAudioData`, `createBufferSource`,
`animate-card-flip`, `aria-busy`, « Encore », « Continuer », « Ouverture », les libellés des favoris et
`human_verification_required`.

**Non vérifié** (demande d'ouvrir un paquet ou d'écrire) : déroulé de la révélation, réponse de
`POST /api/packs/open`, réponses d'erreur `rate_limit_daily` / `retry_after` (absentes du code
client : à revérifier à la prochaine ouverture faite par le joueur), écritures d'étiquettes, ventes,
mises, défausses, réclamation des succès.

## 2. Sources de données (relevé du 21/11/2026)

### 2.1 Routes du site (cookies de session, `Bearer` refusé)

| Route | Réponse utile | Délai mesuré | Usage cible |
|---|---|---|---|
| `GET /api/marketplace/cards/{card}/price-history` | `computed_at`, `by_rarity.R.weekly[] / monthly[]` (`start, avg, min, max, count`) | 160-250 ms | **Prix** (§ 4.1) |
| `GET /api/marketplace/cards/{card}/sales[?rarity=R]` | `recent[5]` (`id, final_price, settled_at, rarity`) | 180-300 ms | Dernières ventes dans la fiche (à la demande seulement) |
| `GET /api/marketplace?page=N&limit=50&sort=recent\|price_asc\|price_desc\|ending_soon[&q=…][&rarity=X…][&mine=1]` | `auctions[]` (avec `card`, `owned`, `is_shiny`, `snapshot_rarity`, `end_at`), `hasMore` ; avec `mine=1` : `selling, bidding, won, history` (50 derniers chacun), `maxConcurrentAuctions` | ~290 ms | Marché, prochaines enchères d'une carte (`q`), mes enchères, Stonks (partiel) |
| `GET /api/marketplace/{id}` | `{auction, bids}` | ~270 ms | Analyse d'une enchère, titre de l'onglet |
| `GET /api/marketplace/mine` | `sellingCount, maxConcurrentAuctions` | ~250 ms | Fenêtre de vente |
| `GET /api/my-collection?sort=…&page=N&stats=0[&q][&rarity][&tag_id]` | `collection[]` (`id, card, tags, count, starred, is_shiny, obtained_at`) | ~620 ms | Observé passivement seulement |
| `GET /api/my-collection/stats?sort=…` | `total, rarityCounts, tagOptions[{id, name, color, cardCount}]` | ~190 ms | Statistiques de tirage ; **détection de changement de la collection** (§ 4.4) |
| `GET /api/my-collection?…&untagged=1` | `504`, `57014` après ~9 s | — | **À ne pas utiliser** |
| `GET /api/profile/{u}/collection?page=N&sort=rarity&stats=1\|0&pending=1[&rarity=X]` | `collection[]` (+ `starred`, `owned_by_viewer`), `pendingTradeCardIds` | 300-950 ms | Recherche d'échanges |
| `GET /api/cards?page=N&q=…&sort=…&rarity=…` | `cards[]`, `searchHasMore`, `ownedCardIds`, `friendOwners`, `wishlistCardIds` | ~1,1 s | Familles |
| `GET /api/trades[?active=1]` | `trades[]` | 190-780 ms | Échanges en cours |
| `GET /api/friends` | `friendships[]`, `counts` | ~190 ms | Liste d'amis |
| `GET /api/wikibidous` | `balance` | ~230 ms | Solde ; rafraîchit les cookies de session |
| `GET /api/notifications` | 50 dernières `notifications[]` | ~280 ms | Observé passivement |
| `POST /api/packs/open`, `/api/marketplace`, `/api/marketplace/{id}/bid`, `/api/user-cards/{id}/discard`, `/api/achievements/check`, `/api/achievements/claim` | inchangés dans le code client | — | Écritures (non testées) |

### 2.2 Supabase REST (`apikey` anonyme + `Bearer`)

| Table | Accès | Délai mesuré | Remarque |
|---|---|---|---|
| `auctions` | **403** | — | Fermée |
| `profiles` | colonnes seulement | — | `select=*` refusé |
| `user_cards` (+ `cards(…)`) | OK | 1 000 lignes en ~365 ms | Collection |
| `user_cards` + `user_card_tags(tag_id)` | OK | 1 000 lignes en ~1,2 s | Collection et étiquettes en une passe |
| `user_card_tags?tag_id=eq.X` | OK | 150-260 ms | |
| `user_card_tags?user_card_id=in.(100)` | OK | ~290 ms | |
| `user_card_tags` sans filtre | **57014 après ~8 s** | — | À ne jamais faire |
| `tags`, `cards`, `wishlist_items`, `achievements`, `user_achievements`, `friendships`, `trades`, `auction_bids` (mes mises), `notifications` | OK | ~125-130 ms (`notifications` : 1 000 lignes en ~1 s) | |

## 3. Principes (s'ajoutent à ceux de `docs/cahier-des-charges.md` § 2)

1. **Deux voies pour les prix.** La voie *affichage* lit tout de suite le prix de ce que le joueur
   regarde (cartes à l'écran, fiche, enchère, récapitulatif, échange, vente), qu'il possède la carte
   ou non. La voie *indexation* tient à jour, en arrière-plan et à débit fixe, le prix de **toutes**
   les cartes de sa collection (§ 4.1 bis). L'affichage passe toujours avant l'indexation.
2. **Passif d'abord.** Toute réponse que le site charge lui-même (fiche « Marché », listes du marché,
   enchère, collection, échanges, notifications) alimente les caches avant toute requête de la Toolbox.
3. **Paramètres du site uniquement.** Chaque route appelée a une liste blanche de paramètres et de
   valeurs relevée dans le code client du site (`limit=50` seulement, `sort` parmi les valeurs du
   site…). Une requête hors liste est refusée par la couche réseau et par les tests.
4. **Budget réseau global**, partagé par toutes les fonctionnalités et tous les onglets (§ 5).
5. **Cache aligné sur l'usage.** `price-history` est recalculée au fil de la journée : un prix est relu
   quand il a plus de 10 min dans une fiche ouverte (comme l'onglet Marché, que le site garde 5 min en
   cache), plus de 3 h sur une carte simplement affichée.
6. **Arrêt net.** `automation_limit`, `human_verification_required` ou 429 arrêtent les lectures
   (de toute la Toolbox pour `automation_limit`) ; aucun contournement, message clair au joueur.
7. **Rien d'irréversible n'est perdu.** Ce que le site oublie (historique des ventes au-delà de 50,
   notifications anciennes) est conservé localement dès qu'il est vu.

## 4. Fonctionnalités : implémentation cible

### 4.1 Prix du marché

**Source.** `price-history` (une requête donne toutes les raretés d'une carte).

**Définition du prix : le « prix moyen de la semaine » du site** (D1, décision du 21/11/2026). La
Toolbox affiche exactement le chiffre de l'onglet Marché de la fiche. Calcul relevé dans le code client
du site (composant `PriceSnapshot`, relevé du 21/11/2026), à reproduire dans `core/prices.js`
(fonction pure `priceFromHistory(history, rarity, options)`) :

1. **Date de référence** `ref` : `computed_at` de la réponse s'il est valide et antérieur à
   maintenant, sinon maintenant. Le prix ne bouge donc pas entre deux calculs du site.
2. **Semaine** : la date est ramenée au jour calendaire **de Paris** (`Intl.DateTimeFormat("en-CA",
   {timeZone: "Europe/Paris"})`), puis au **lundi** de sa semaine ; clé `AAAA-MM-JJ` (celle de
   `weekly[].start`).
3. **Série** : toutes les semaines de `lundi(ref − 84 jours)` à `lundi(ref)` (13 semaines). Une semaine
   présente dans `weekly` garde ses valeurs ; une semaine absente reprend la dernière moyenne connue
   (`carried`, `count: 0`), y compris une moyenne antérieure à la fenêtre. S'il n'y a aucune semaine
   avant la fenêtre, la série commence à la première semaine avec ventes.
4. **Prix** = moyenne de la **dernière semaine de la série**, arrondie, au moins 1
   (`Math.max(1, Math.round(avg))`).
5. **Libellé** : « prix moyen de la semaine » si la dernière semaine a des ventes, sinon « dernier prix
   moyen connu », avec la date de la dernière semaine vendue (prise dans tout `weekly`).
6. **Autres valeurs**, celles de l'onglet Marché :
   - plus bas / plus haut / ventes : `min`, `max`, `Σ count` des semaines vendues de la série (12 semaines) ;
   - fourchette sur 4 semaines : plus bas / plus haut des 4 dernières semaines ;
   - variation : entre la dernière semaine vendue et la précédente de la série, seulement si la
     dernière semaine vendue est la semaine en cours ou la précédente.
7. Aucune entrée `weekly` pour la rareté : « jamais vendue dans cette rareté ».

**Fiabilité** (prix pris dans les totaux, la valeur de la collection et les mises de départ proposées) :
au moins `minSales` ventes (réglage conservé, 3 par défaut) sur les 12 semaines de la série. En dessous,
le prix s'affiche avec « ≈ » et une explication (« 1 vente en 12 semaines », « dernière vente le … »),
hors des totaux. Le réglage `skipFirstSales` disparaît (on ne voit plus les ventes une à une ;
migration : clé supprimée des réglages).

Conséquence assumée : le prix suit le site, donc il est volatil (une seule vente dans la semaine fait le
prix). La fourchette sur 4 semaines et le nombre de ventes s'affichent au survol pour le relativiser.

**Shiny.** On ne sait pas encore si `price-history` mélange les ventes shiny (le code client ne les
distingue pas). À vérifier sur une carte L avec ventes shiny connues (§ 10). D'ici là : pas de prix
shiny séparé, mention « prix des exemplaires non shiny » sur une carte shiny.

**Cache** (`prices-v3`, remplace `prices-v2`) :
- entrée par carte : `{s: résumé par rareté (prix, ventes, fourchettes, variation, dernière semaine vendue), c: computed_at, t: lu le, err?}` ; le résumé est calculé une fois, à la lecture, puisqu'il ne dépend que de la réponse (date de référence = son `computed_at`) ;
- fraîche 10 min dans une fiche ouverte (fenêtre d'une carte, page d'une enchère, mise aux enchères,
  détail d'une carte du récapitulatif), 3 h ailleurs (`PRICE_MAX_AGE` de `core/prices.js` ; le réglage
  `priceMaxAgeHours` disparaît) ;
- au-delà : affichée telle quelle (stale-while-revalidate), relue seulement si la carte est de nouveau
  affichée ;
- erreur : nouvel essai après 5 min, l'ancien prix reste affiché ; conservation 30 jours ;
- partagée entre onglets : écriture fusionnée (comme aujourd'hui) et mise à jour des autres onglets par
  `chrome.storage.onChanged`.

**Lecture passive.** Le hook observe `GET /api/marketplace/cards/{id}/price-history` et
`/sales(?rarity=X)` : ouvrir l'onglet Marché d'une fiche met le prix en cache sans requête de la
Toolbox. Les regex du hook (`main-world.js`) et du bus (`bus.js`) sont à corriger (aujourd'hui
`?scope=summary$` exact).

**Quand lire (priorités, § 5)** :

| Contexte | Cartes | Priorité | Plafond |
|---|---|---|---|
| Fiche d'une carte ouverte, page d'une enchère, fenêtre de vente | 1 | haute | — |
| Récapitulatif d'un paquet, fenêtre d'échange (cartes choisies) | ≤ 10 | haute | — |
| Cartes visibles à l'écran (pastilles de prix), sur la liste du marché, la collection, un profil | celles dans la fenêtre (IntersectionObserver), après 300 ms d'affichage stable | normale | annulées si elles sortent de l'écran |
| « Bonnes affaires » du marché | enchères qui finissent dans les 15 min, rareté ≥ R | normale | 10 par page affichée |
| Cartes de ma collection (valeur, onglet Prix, tri par prix, Stonks, cartes en double à vendre) | toutes | basse : indexation (§ 4.1 bis) | débit fixe et plafond journalier (§ 5) |
| Liste de cartes ouverte dans le panneau (famille, liste Collection triée par prix, échange en cours) | celles de la liste sans prix frais | normale | passent devant l'indexation |

**Supprimé** : `readSales`, `priceBatches` et ses poids, `summarizeSales` (sauf s'il sert encore à
Stonks), `directSource`, `site.salesSummary`, l'évènement `sales-summary` dans sa forme actuelle.

**Messages.** « serveur indisponible » ne s'affiche que pour une vraie panne réseau ; un `403` ou un
format inattendu affiche « Prix indisponibles : le site a changé, une mise à jour de la Toolbox est
nécessaire » et coupe les lectures de prix jusqu'au rechargement.

**Coût de la voie affichage.** 0 à 1 requête par fiche ouverte (0 si l'onglet Marché du site l'a déjà
chargée ou si l'indexation a déjà lu la carte), ≤ 10 par paquet, quelques dizaines par écran de liste,
une fois toutes les 3 h par carte au plus (10 min pour une fiche ouverte). Les cartes que je ne possède pas (marché, profils, catalogue,
échanges) passent uniquement par cette voie ; leur prix est gardé 30 jours.

### 4.1 bis Indexation des prix de toute ma collection

Objectif : connaître en permanence le prix de chaque carte de ma collection (valeur totale, onglet
Prix, tri par prix, Stonks, doublons à vendre) sans attendre qu'elle passe à l'écran.

**Périmètre.** Les cartes distinctes (`card_id`) de ma collection, toutes raretés (~15 000 pour la plus
grosse collection mesurée). Une lecture de `price-history` donne toutes les raretés d'une carte : deux
exemplaires de raretés différentes coûtent une seule requête.

**Où.** Dans l'onglet meneur (§ 5), tant qu'un onglet de wiki-masters.com est ouvert (pas de service
worker qui interroge le site). L'état est enregistré (`price-index` dans `chrome.storage.local`) :
l'indexation reprend où elle s'était arrêtée, après un rechargement comme le lendemain.

**Réglages.**
- `priceIndex` : « Indexer les prix de ma collection », désactivé pour une nouvelle installation
  (lecture de masse : le joueur choisit), activable dans les Réglages ou par le bouton « Indexer ma
  collection » de l'onglet Prix.
- `priceIndexSpeed` : *normale* (une lecture toutes les 2 s, défaut) ou *rapide* (une par seconde,
  signalée comme plus visible pour le site).

**Ordre.** File recalculée à chaque passage :
1. cartes jamais lues, par rareté décroissante de mon exemplaire le plus rare (L, UR, SR, R, PC, C),
   puis par nombre d'exemplaires décroissant (doublons à vendre d'abord) ;
2. cartes périmées selon la cadence ci-dessous, la plus ancienne d'abord.

**Cadence.** Délai depuis la dernière lecture (une fiche ouverte relit en plus un prix de plus de 10 min) :

| Mon exemplaire le plus rare | Relue au plus tôt |
|---|---|
| L, UR, SR | 1 jour après |
| R | 3 jours après |
| PC, C | 7 jours après |
| Carte jamais vendue dans aucune rareté | 14 jours après |

Un prix lu par la voie affichage ou vu passivement (onglet Marché du site) compte comme une lecture
d'indexation : même cache, pas de doublon. Une carte nouvellement tirée entre dans la file
(priorité 1) ; une carte qui quitte la collection en sort.

**Rythme.**
- une lecture à la fois, à intervalle fixe ;
- la voie affichage passe toujours devant : l'indexation attend que la file d'affichage soit vide ;
- pas d'aléa ajouté pour paraître humain (règle du dépôt : rien qui imite un humain) ;
- plafond journalier : 6 000 lectures en normale, 12 000 en rapide, remis à zéro chaque jour (jour de Paris) ;
- onglet caché : l'indexation continue, mais Chrome bride les minuteurs des onglets cachés
  (un réveil par minute après 5 min) ; le rôle de meneur passe de préférence à un onglet visible.

**Durées attendues** (collection de 15 000 cartes distinctes) :
- première indexation : ~8 h d'onglet ouvert en normale, ~4 h en rapide, réparties sur plusieurs
  jours si besoin ; les cartes L / UR / SR passent en premier (prêtes en moins d'une heure pour
  quelques centaines à 1 500 cartes) ;
- entretien quotidien : (L + UR + SR) + R / 3 + (PC + C) / 7 lectures, de l'ordre de 2 000 à 3 000
  par jour, soit 1 h à 1 h 40 d'onglet ouvert en normale.

**Arrêt net.**
- `automation_limit` ou `human_verification_required` : indexation arrêtée et réglage `priceIndex`
  remis sur désactivé (le joueur le réactive lui-même), message expliquant pourquoi ;
- `429` : pause jusqu'à `Retry-After`, puis vitesse divisée par deux jusqu'au lendemain ;
- 5 erreurs serveur ou délais dépassés de suite : pause de 15 min ;
- session expirée : pause jusqu'au retour d'une session valide.

**Interface.**
- Onglet Prix : barre d'indexation (cartes lues / total, détail par rareté, lectures du jour /
  plafond, prochaine relecture, *Pause* / *Reprendre*), qui remplace le bouton actuel de chargement par
  raretés ; la valeur de la collection affiche sa couverture (« valeur calculée sur 14 200 cartes sur
  15 000 ») ;
- popup : état de l'indexation (en cours, en pause, terminée pour aujourd'hui) ;
- le guide explique le risque du § 1.2 avant l'activation.

**Stockage.** Cache `prices-v3` compact (résumé par rareté vendue) : de l'ordre de 200 octets par
carte, ~3 Mo pour 15 000 cartes (`unlimitedStorage` déjà demandé). Écriture groupée toutes les 2 s ;
les entrées écrites sont aussi publiées dans `prices-v3-delta`, que les autres onglets reprennent
sans relire tout le cache.

### 4.2 Analyse d'une enchère (« Prochaines enchères de la carte », « vous misez déjà »)

- Enchères en cours de la carte : `GET /api/marketplace?page=1&limit=50&sort=ending_soon&q=<titre
  exact>&rarity=<rareté>`, filtrées sur `card_id` côté Toolbox ; page 2 seulement si `hasMore` et
  qu'aucune enchère de la carte n'a encore été trouvée dans la page 1 (plafond 2 pages).
- Mes mises : `bidding` de `mine=1` (déjà lu par les alertes d'enchère, cache 60 s) ; `auction_bids`
  (REST, toujours lisible pour mes lignes) seulement si `bidding` est absent du cache.
- Lecture à l'ouverture de la page d'une enchère, mémorisée 60 s ; « Rafraîchir » manuel.

### 4.3 Page Stonks (historique d'achats et de ventes)

Trois sources fusionnées par `auction_id`, dans un **journal local permanent** (`stonks-journal`,
`chrome.storage.local`, entrées `{auction_id, card_id, side: sold|bought, price, at, rarity?, shiny?}`) :
1. `GET /api/marketplace?…&mine=1` : `history` (statut `settled_sold`) et `won`, avec rareté et shiny,
   lus passivement quand le joueur ouvre le marché, et au plus une fois toutes les 10 min par la Toolbox ;
2. Supabase `notifications?select=type,data,created_at&user_id=eq.{moi}&type=in.(marketplace_auction_sold,marketplace_auction_won)&order=created_at.asc,id.asc`
   (`data`: `auction_id, card_id, card_title, final_price`) : reprise complète une fois, puis
   incrémentale (`created_at=gt.<dernier>`) ; les notifications ne remontent qu'à début octobre 2026 ;
3. `GET /api/notifications` observé passivement.

La rareté manquante se complète par `cards?select=id,rarity,…&id=in.(…)` (rareté actuelle de la carte,
signalée « approximative »). L'historique antérieur à la plus ancienne notification est perdu pour un
joueur qui ne l'avait pas déjà ; la page l'indique (« historique depuis le … »).

### 4.4 Collection, tri et étiquettes

- **Détection de changement** : `GET /api/my-collection/stats` (190 ms) donne `total`, `rarityCounts`
  et le nombre de cartes par étiquette (`tagOptions[].cardCount`) ; la collection en cache n'est relue
  que si ces valeurs changent (ou après paquet, défausse, vente, écriture), au lieu de l'expiration
  fixe de 10 min.
- **Lecture** : une seule passe `user_cards?select=id,card_id,count,starred,is_shiny,snapshot_rarity,obtained_at,cards(…),user_card_tags(tag_id)&order=obtained_at.desc,id.asc`
  par pages de 1 000 (~18 requêtes pour 17 000 exemplaires au lieu de 18 + une par étiquette).
  En cas de `57014`, repli sur la lecture par étiquette actuelle. À mesurer sur la plus grosse
  collection de la bande avant d'adopter (le `select` avec `summary` est plus lourd : le résumé n'est
  lu que pour les cartes à classer, par `cards?id=in.(100)`).
- Jamais `user_card_tags` sans filtre, jamais `my-collection?untagged=1`.
- Écritures inchangées (`core/tag-writer.js`), à revérifier sur un premier tri réel.

### 4.5 Échanges

- `profile/{u}/collection` : concurrence 2, 150 ms entre pages (inchangé, la route est 100 fois plus
  rapide qu'avant : une collection de 16 000 cartes passe en ~2-3 min au lieu de ~20 min).
- Filtre de rareté côté serveur par défaut (L / UR / SR), « toutes les raretés » en option.
- Garder `starred` et `owned_by_viewer` dans `compact()` (`features/trades.js`) : le filtre
  « hors favoris » et la mention « possédée » de la fenêtre d'échange les lisent mais ils sont
  aujourd'hui perdus.
- Cache 12 h inchangé ; une lecture partielle reprend où elle s'est arrêtée.
- `scripts/trade_finder.js` : concurrence 8 → 2, mêmes règles.

### 4.6 Familles, marché, paquets, succès, intégration aux pages

- Familles : inchangées (`/api/cards`, `cards`, `wishlist_items`, `/api/marketplace?q=`).
  « Manquantes en vente » : plafond de 40 cartes conservé, concurrence 1.
- Alertes d'enchère : inchangées (`mine=1` toutes les 60 s, 20 s en fin d'enchère), mais assurées par
  **un seul onglet** (§ 5).
- Titre de l'onglet d'une enchère : inchangé (une seule enchère, onglet visible).
- Ouverture des paquets, récapitulatif, suspense, roulette, son de la Légendaire : inchangés ; à
  revérifier sur une vraie ouverture (§ 10).
- Succès : inchangés ; vérification automatique par un seul onglet.
- Fiche d'une carte : le bloc Toolbox reste dans l'onglet **Détails** ; son prix est celui du § 4.1
  (mêmes données que l'onglet Marché, définition affichée au survol) ; lien « Voir l'évolution » qui
  ouvre l'onglet Marché du site.

## 5. Couche réseau : budget, priorités, onglets

**File des prix** (`state/prices.js`, en place depuis la 2.7.0 ; révisée le 21/11/2026 après le
constat C11) :
- budget commun à tous les onglets (`price-budget` dans `chrome.storage.local`) : au plus
  **60 lectures de prix par fenêtre glissante de 10 min** et **10 par 30 s** ;
- priorités : *haute* (cartes tirées, fiche ou enchère ouverte, fenêtre d'échange, mise aux enchères,
  prochaines enchères d'une carte), qui garde toujours la moitié de la fenêtre et de la rafale ;
  *affichage* (cartes à l'écran, 50 premières cartes d'une liste) et *lente* (suite des listes,
  indexation), qui ne partent que tant que le total reste sous la moitié ; la voie lente, une à la fois, 1 lecture / 60 s (normale, 1 440 par jour) ou
  / 30 s (rapide, 2 880 par jour) ; dans chaque priorité, la carte la plus rare d'abord ;
- deux lectures simultanées au plus, une seule tentative par lecture ;
- `automation_limit` sur la route des prix : pause de 15 min des seules lectures de prix (les autres
  routes du site continuent : `siteGet(…, {localBlock: true})`), budget réduit de moitié jusqu'au
  lendemain, indexation désactivée, message ; les cartes demandées restent en file ;
- `human_verification_required` : plus aucune lecture de prix jusqu'au rechargement ;
- 429 : pause d'une minute, budget réduit de moitié ; 5 erreurs serveur de suite : pause de 15 min.

**Plus tard (2.8.0)** : même principe pour toutes les routes (liste blanche des paramètres, compteurs
par fonctionnalité visibles dans les Réglages).

**Entre onglets** :
- un onglet **meneur** (verrou `wmt:leader` de `lib/locks.js`, repris à la fermeture) fait les
  lectures périodiques : indexation des prix, alertes d'enchère, succès, journal Stonks ;
- caches partagés par `chrome.storage.onChanged` (prix, collection, journal) ;
- le budget du § 5 est commun (compteur dans `chrome.storage.session` ou piloté par le meneur).

## 6. Hook et bus

| Évènement | Motif à observer | Usage |
|---|---|---|
| `price-history` (nouveau) | `^/api/marketplace/cards/([0-9a-f-]{36})/price-history$` | Cache des prix |
| ~~`recent-sales`~~ | — | Non retenu en 2.7.0 : l'onglet Marché du site affiche déjà les 5 dernières ventes ; `sales-summary` est supprimé |
| `marketplace` | inchangé (dont `history` / `won` de `mine=1` → journal Stonks) | |
| `notifications` | inchangé (ventes / achats → journal Stonks) | |
| `my-collection-stats` | inchangé (+ `tagOptions` → détection de changement) | |
| `auction` | `^/api/marketplace/([0-9a-f-]{36})$` (inchangé) | |

## 7. Code et documentation à changer

| Fichier | Changement |
|---|---|
| `core/prices.js` | `priceFromHistory`, suppression de `summarizeSales` / `priceBatches` / `RECENT_SALES` / `SITE_WINDOW` / `skipFirst` ; tests sur des réponses réelles anonymisées (`tests/fixtures/price-history/*.json`) |
| `extension/src/content/state/prices.js` | Réécrit : source `price-history`, cache `prices-v3`, priorités, lecture passive |
| `extension/src/content/state/price-index.js` (nouveau) | Indexation de la collection (§ 4.1 bis) : file, cadence, plafond, état enregistré, arrêt net |
| `extension/src/content/state/settings.js` | Retrait de `priceMaxAgeHours` et `skipFirstSales` (migration) ; ajout de `priceIndex` (désactivé par défaut) et `priceIndexSpeed` |
| `extension/src/content/ui/tabs/PricesTab.jsx`, `popup/` | Barre d'indexation, couverture de la valeur, état dans la popup |
| `extension/src/content/api/site.js` | `priceHistory(id)`, `recentSales(id, rarity)`, `marketSearch({q, rarity, sort, page})` avec liste blanche ; retrait de `salesSummary` et `profile` (inutilisé) |
| `extension/src/content/lib/http.js` | Planificateur (§ 5) |
| `extension/src/content/features/market.js` | `cardAuctions` par `q` (§ 4.2) |
| `extension/src/content/features/stonks.js` | Journal local et sources du § 4.3 |
| `extension/src/content/features/trades.js` | `compact()` garde `starred`, `owned_by_viewer` |
| `extension/src/content/state/collection.js`, `features/sorter.js` | Détection de changement, lecture jointe (§ 4.4) |
| `extension/src/content/features/site-dom.js` | Pastilles de prix des cartes visibles seulement ; « bonnes affaires » plafonnées |
| `extension/src/hook/main-world.js`, `content/lib/bus.js` | Motifs du § 6 |
| UI (`ui/islands/shared.jsx`, `CardDetail.jsx`, `PackRecap.jsx`, `SellDialog.jsx`, onglet Prix) | Nouvelle définition du prix, « ancien » avec date, messages du § 4.1 |
| `scripts/trade_finder.js` | Concurrence 2 |
| `docs/site-api.md` | Réécrit d'après le § 2 (avec dates de vérification) |
| `docs/guide.md`, `README.md` | Prix, Stonks, échanges |
| `extension/changelog.json` | Version 2.7.0 (texte pour les joueurs, § 11) |

## 8. Hors périmètre (pour l'instant)

Guildes (liste de souhaits de guilde, dons), duels, messages, vitrine, collection globale. Seule piste
à étudier plus tard : signaler dans la Toolbox les cartes demandées par la guilde que je possède en
double (`/api/guilds/home` → `wishlist[]`, une lecture à l'ouverture de la page Guilde).

## 9. Décisions

| # | Question | Décision |
|---|---|---|
| D1 | Définition du prix | **Arrêtée (21/11/2026)** : le « prix moyen de la semaine » du site, calculé comme lui (§ 4.1) |
| D2 | Prix de toute la collection | **Arrêtée (21/11/2026)** : indexation complète en arrière-plan (§ 4.1 bis), et prix des cartes affichées même hors collection (§ 4.1) |
| D3 | Cache de prix sur un serveur | **Arrêtée (21/11/2026)** : jamais ; tout reste dans le navigateur |
| D4 | Contact avec l'équipe du site | **Arrêtée (21/11/2026)** : jamais, sous aucun prétexte |

## 10. Points à vérifier avant publication

1. `price-history` et `sales` comptent-ils les ventes shiny ? (carte L avec ventes shiny connues)
2. Réponse de `POST /api/packs/open` et déroulé de la révélation (suspense, roulette, son, étoile) à
   la prochaine ouverture **faite par le joueur**.
3. Premier tri appliqué (écritures d'étiquettes) sur le compte de test, avec accord.
4. Lecture jointe `user_cards` + `user_card_tags` sur la plus grosse collection disponible.
5. Rétention des notifications (la plus ancienne vue : 06/10/2026).
6. Seuil réel de l'anti-automatisation : inconnu ; ne pas le chercher par essais. Rester sous le § 5.

## 11. Jalons

| Version | Contenu | Priorité |
|---|---|---|
| 2.7.0 (fait le 21/11/2026) | § 4.1 (prix par `price-history`, lecture passive, cartes affichées), § 4.1 bis (indexation de la collection) avec la file des prix de `state/prices.js` : voie affichage (2 à la fois, rafale de 6 puis 2 lectures/s, une seule tentative), voie lente (une à la fois, 2 s ou 1 s, plafond journalier, pauses), arrêt net, onglet meneur ; listes longues (`loadPrices`) : 50 premières cartes par la voie affichage, les suivantes par la voie lente ; § 4.2, § 4.3, § 6, messages ; tests ; `site-api.md` | Urgent : corrige les deux issues |
| 2.8.0 | Planificateur complet (§ 5 : tous les hôtes et fonctionnalités, liste blanche, compteurs), détection de changement et lecture jointe (§ 4.4), `compact()` des échanges (§ 4.5), `trade_finder.js` | Important |
| plus tard | § 8 | Bonus |

Texte de nouveauté proposé (2.7.0) :
- FR : « Les prix du marché fonctionnent de nouveau : c'est le prix moyen de la semaine, le même que
  dans l'onglet Marché de la fiche d'une carte. Les cartes affichées à l'écran ont leur prix tout de
  suite, et l'onglet Prix peut indexer en arrière-plan toute votre collection et la tenir à jour. »
- EN : “Market prices work again: they show the week's average price, the same as in the Market tab
  of a card's page. Cards shown on screen get their price right away, and the Prices tab can index
  your whole collection in the background and keep it up to date.”
