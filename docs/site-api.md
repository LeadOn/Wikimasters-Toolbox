# API de wiki-masters.com (relevée le 12/10/2026)

Routes observées dans le trafic du site et dans son code client. Elles ne sont pas documentées par
le site et peuvent changer sans préavis : l'extension les regroupe dans `extension/src/content/api/`.

## Authentification

- Session `@supabase/ssr` dans les cookies `sb-cyrxjeppjqsxxjayfrur-auth-token.0`, `.1`, … :
  concaténation = `base64-` + JSON de session en base64url (`access_token`, `user.id`).
  Le pseudo est dans `user.user_metadata.username` (et dans les claims du JWT).
- Routes `/api/...` du site : cookies de session (même origine), le header `Bearer` n'est pas accepté.
- Supabase REST (`https://cyrxjeppjqsxxjayfrur.supabase.co/rest/v1/`) : headers `apikey` (clé publique
  « anon », présente dans le code du site) et `Authorization: Bearer <access_token>`. La RLS limite
  `user_cards` au joueur connecté.
- Plusieurs écritures peuvent répondre `{code: "human_verification_required"}` : le site affiche alors
  une vérification Cloudflare Turnstile (`POST /api/human-check {token}`). L'extension s'arrête et
  demande au joueur de faire la vérification sur le site.

## Collection

| Route | Réponse |
|---|---|
| `GET /api/my-collection?sort=rarity&page=N&stats=0[&tag=…][&q=…]` | `{collection: [{id, card_id, count, starred, is_shiny, obtained_at, tags: [...], card: {...}}], pendingTradeCardIds}` (50 / page) |
| `GET /api/my-collection/stats?sort=rarity` | `{total, totalUnique, rarityCounts, tagOptions: [{id, name, color, cardCount}]}` |
| Supabase `user_cards?select=*,cards(*)` | exemplaires du joueur avec la carte complète (résumé compris) |
| Supabase `tags`, `user_card_tags`, `wishlist_items` | étiquettes, associations, liste de souhaits (ajout en lot comme le site : `POST wishlist_items?on_conflict=user_id,card_id`, `Prefer: resolution=ignore-duplicates`, lignes `{user_id, card_id}` ; le site notifie `marketplace_wishlist_listed` quand une carte souhaitée est mise en vente) |
| `POST /api/user-cards/{id}/discard` (sans corps, `id` d'un exemplaire `user_cards`) | défausse contre 1 WikiBidou ; réponse JSON, `{error}` si refusée (favori verrouillé, carte engagée dans un échange…). Utilisée par le récapitulatif de paquet et les doublons du Marché |
| `POST /api/user-cards/bulk-discard {card_ids}` | défausse groupée : `{discarded_count, failed}` (non utilisé) |

## Catalogue

| Route | Réponse |
|---|---|
| `GET /api/cards?page=N&sort=…&q=…&rarity=…[&wishlist=1]` | `{cards, total, rarityCounts, friendOwners: {card_id: [{username, rarities}]}, ownedCardIds, wishlistCardIds}` — ~2,8 millions de cartes |

Recherche `q` (relevé en novembre 2026) : morceau du titre seulement (« mars » trouve « Marston »), résultats par ordre alphabétique du titre quel que soit `sort`, 50 par page, `total` vide et `searchHasMore` pour la suite. Pour un titre exact, la table `cards` de Supabase répond en ~0,2 s (`wikipedia_title=in.(…)`), et en ~1,5 s pour les homonymes (`wikipedia_title=like.Mars (*`) ; une recherche insensible à la casse (`ilike`) prend ~4 s (pas d'index).

## Amis

| Route | Réponse |
|---|---|
| `GET /api/friends` | `{friendships: [{status, requester: {id, username}, addressee: {...}}]}` |
| `GET /api/profile/{pseudo}` | `{profile, isFriend, …}` |
| `GET /api/profile/{pseudo}/collection?page=N&sort=rarity&stats=0|1&pending=1[&rarity=L…]` | `{collection: [{…, starred, owned_by_viewer}], total, rarityCounts, tagOptions, pendingTradeCardIds}` — 50 / page, ~300 ms depuis novembre 2026 (jusqu'à 30 s avant) |

## Marché

Relevé du 21/11/2026 : la table Supabase `auctions` n'est plus lisible (`403 permission denied for table auctions`, ventes conclues comme enchères en cours) ; tout le marché passe par les routes du site. Une valeur de paramètre que le site n'envoie jamais est refusée comme automatisation : `/api/marketplace?limit=100` → `403 {"code": "automation_limit", "error": "Trop de requêtes automatisées. L'automatisation n'est pas autorisée — voir le règlement."}`. N'appeler une route qu'avec les paramètres et valeurs relevés dans le code client du site.

| Route | Réponse |
|---|---|
| `GET /api/marketplace?page=N&limit=50&sort=recent\|price_asc\|price_desc\|ending_soon[&q=…][&rarity=X…][&mine=1]` | `{auctions, page, limit, hasMore}` (enchères avec `card`, `owned`, `is_shiny`, `snapshot_rarity`, `end_at`, `seller_id`, `current_bidder_id`) ; `limit=50` seulement ; `rarity` répétable ; `card_id` ignoré. `q` cherche dans le titre et la description (le titre exact trouve la carte) : prochaines enchères d'une carte (`sort=ending_soon`, gardées pour son id, 3 pages au plus). Avec `mine=1` (le site l'envoie sur sa première page, `page=1&limit=50&sort=recent&mine=1`) : `selling`, `bidding`, `won`, `history` (mes enchères terminées, `settled_sold` et `settled_unsold`), **50 derniers chacun, sans pagination**, `maxConcurrentAuctions` ; ~290 ms |
| `GET /api/marketplace/mine` | `{sellingCount, maxConcurrentAuctions}` |
| `GET /api/marketplace/{id}` | `{auction, bids}` |
| `POST /api/marketplace {card_id, base_amount, duration_minutes}` | `{auction_id}` — **`card_id` est l'id de l'exemplaire (`user_cards.id`)**, pas celui de la carte (relevé dans le formulaire du site : `userCardId` → `card_id`) ; avec un id de carte, le site répond que la carte n'est pas possédée. Un favori ne peut pas être mis en vente. Durées : 10, 30, 60, 180, 360, 720 |
| `POST /api/marketplace/{id}/bid {amount}` | erreurs : `bid_too_low` (+ `min`), `insufficient_balance`, `human_verification_required`. Mise minimum (code client du site, relevé en novembre 2026) : `Math.max(Math.ceil(1.1 * current_bid), current_bid + 1)`, ou `base_amount` sans enchère |
| `GET /api/marketplace/cards/{card_id}/price-history` | `{computed_at, by_rarity: {RARETÉ: {weekly: [{start, avg, min, max, count}], monthly: [...]}}}` : tout l'historique des ventes de la carte, par semaine (`start` = lundi, jour de Paris) et par mois ; `{by_rarity: {}}` si jamais vendue. Recalculé au fil de la journée (`computed_at` avance de quelques minutes en quelques minutes, avec ~6 h 15 de retard sur l'heure UTC ; le site s'en sert comme date de référence et affiche un bandeau si `now − computed_at > 12 h`). `cache-control: private, max-age=300`, cache mémoire client de 10 min (`MARKET_CACHE_TTL_MS = 600000`), ~160-280 ms. **Limitée en volume** : environ 90 à 100 lectures en 10 min (dont une rafale de ~50) → `403 automation_limit` sur cette route seulement, levé ~10 min plus tard. Le site ne distingue pas les ventes shiny. Reproduit par `core/prices.js` → `summarizeHistory` |
| `GET /api/marketplace/cards/{card_id}/sales[?rarity=X]` | `{recent: [{id, final_price, settled_at, rarity}]}` : les 5 dernières ventes conclues (de la rareté `X`, ou toutes raretés confondues sans `rarity`), de la plus récente à la plus ancienne. `cache-control: public, max-age=0, must-revalidate`, cache mémoire client de 10 min par clé `cardId:rarity\|all`, ~200-350 ms sur une carte peu vendue (jusqu'à ~1,7 s sur une Légendaire à ~900 ventes). Quand `recent` sans `rarity` contient moins de 5 ventes (`0` à `4`), ce sont **toutes** les ventes de l'histoire de la carte toutes raretés confondues : `core/prices.js` (`historyFromSales` / `summarizeSales`) en tire exactement le même résumé hebdomadaire et mensuel que `price-history`, ce qui permet d'indexer en parallèle sur les deux routes |

### Onglet *Marché* de la fiche d'une carte (relevé le 23/11/2026)

L'onglet **Marché** de la fenêtre d'une carte (et l'aperçu `PriceSnapshot` de la fenêtre *Mettre aux enchères*) s'appuie sur deux requêtes enchaînées, chacune gardée 10 min en mémoire côté client (`createExpiringCache(6e5)`) :

1. **Chargement de l'historique** : `usePriceHistory(cardId)` appelle `GET /api/marketplace/cards/{card_id}/price-history` dès l'ouverture de l'onglet (toutes les raretés de la carte en une seule réponse).
2. **Sélection de la rareté et chargement des 5 dernières ventes** : une fois `price-history` reçu, le composant détermine les raretés vendues `X` (`by_rarity[r].weekly.length > 0`, dans l'ordre `C, PC, R, SR, UR, L`) et la sélection initiale :
   - `null` si aucune rareté n'a de vente (*« Aucune vente pour l'instant. »*) ;
   - `initialRarity` (la rareté de l'exemplaire cliqué) si elle figure dans `X` ;
   - `"any"` (*Comparer*) si plusieurs raretés ont des ventes et que `initialRarity` n'est pas fournie ou pas dans `X` ;
   - `X[0]` s'il n'y a qu'une seule rareté vendue.
   Il appelle alors `GET /api/marketplace/cards/{card_id}/sales?rarity={rareté}` lorsqu'une rareté précise est sélectionnée, ou `GET /api/marketplace/cards/{card_id}/sales` (sans `rarity`) en mode *Toutes* (`"all"`), *Comparer* (`"any"`) ou sans vente (`null`). Changer de rareté dans l'onglet relance uniquement `/sales?rarity=…` (si non présent dans le cache de 10 min).
3. **Section « Évolution des prix »** :
   - **Date de référence** `réf` : `computed_at` s'il est valide et passé, sinon maintenant. Si `maintenant − computed_at > 12 h` (`43200000` ms), affiche un bandeau ambre *« Données à jour jusqu'au \<date\> (mise à jour en cours). »*.
   - **Sélecteur de rareté** : un bouton par rareté vendue, précédés de **Toutes** (`"all"`) et **Comparer** (`"any"`) dès que `X.length > 1`.
   - **Sélecteur de période** : **3 mois** (`"3m"`, série hebdomadaire sur 13 semaines de `lundi(réf − 84 j)` à `lundi(réf)`, fuseau `Europe/Paris` ; une semaine sans vente reporte la dernière moyenne connue `carried: true, count: 0`, même antérieure aux 84 jours) ou **Tout** (`"all"`, série mensuelle `by_rarity[r].monthly`, désactivé tant qu'aucune vente ne précède `lundi(réf − 84 j)`).
   - **Trois modes d'affichage** :
     - *Rareté unique* : en-tête **Prix moyen · \<Rareté\>** avec la moyenne de la dernière semaine (ou du dernier mois), arrondie (`Math.max(1, Math.round(avg))`, atténuée si `carried`), pastille de variation hebdomadaire (`(dernière − précédente) / précédente` sur la série hebdomadaire complète si la dernière vente date de *cette semaine* ou de la *sem. dernière*, *Stable* sous 0,5 %), sous-titre (*« Moyenne de la semaine »* ou *« Pas de vente cette semaine · dernier prix : sem. du … »*), grille **Plus bas** / **Plus haut** / **Ventes** cumulées sur la période affichée, et graphique Recharts (`ComposedChart` : aire + courbe pleine des semaines vendues, courbe pointillée des semaines reportées, barres verticales `min – max` et barres de volume en fond ; le survol d'un point affiche ses valeurs dans l'en-tête).
     - *Toutes* (`"all"`) : agrège toutes les raretés vendues par semaine ou par mois (`avg = Math.round(Σ(avg × count) / Σ count)`, `min`, `max`, `Σ count`) et trace la courbe globale sans barres `min – max`.
     - *Comparer* (`"any"`) : superpose les courbes de chaque rareté vendue sur une échelle logarithmique (`YAxis scale="log"`) et affiche sous le graphique un tableau récapitulatif de chaque rareté (de la plus rare à la plus commune : nombre de ventes sur la période, variation hebdomadaire en `%` et prix moyen actuel ou de la semaine survolée).
   - **Encart `PriceSnapshot`** (fenêtre *Mettre aux enchères*) : reprend la série de 13 semaines de la rareté de l'exemplaire, affiche le prix moyen (`Prix moyen de la semaine` ou `Dernier prix moyen connu`), la variation hebdomadaire, une mini-courbe SVG (`240×40`) et la **Fourchette sur 4 semaines** (`min – max` des 4 dernières semaines de la série).
4. **Section « 5 dernières ventes · \<Rareté | Toutes raretés\> »** : liste les ventes renvoyées par `/sales` (date et prix final, avec pastille de rareté quand toutes les raretés sont affichées).
| Supabase `auction_bids?select=auction_id,amount&bidder_id=eq.{moi}&auction_id=in.(…)` | mes mises (colonnes `id, auction_id, bidder_id, amount, placed_at`) : chaque joueur ne lit que les siennes (toujours lisible le 21/11/2026). Sert à signaler une autre enchère de la même carte sur laquelle je mise déjà |
| Supabase `notifications?select=id,type,data,created_at&user_id=eq.{moi}&type=in.(marketplace_auction_sold,marketplace_auction_won)&order=created_at.asc,id.asc` | mes ventes et achats conclus (`data` : `auction_id, card_id, card_title, final_price`, sans rareté) : historique de la page Stonks avec `history` / `won` de `mine=1`. Les plus anciennes notifications vues le 21/11/2026 datent du 06/10/2026. Pas de commission sur les ventes : le vendeur reçoit `final_price` (vérifié le 15/10/2026). Autres types : `marketplace_auction_unsold`, `marketplace_outbid`, `marketplace_wishlist_listed`, `trade_*`, `battle_*`, `friend_request`, `guild_invite`, `chat_message` |
| `GET /api/wikibidous` | `{balance}` |

## Échanges

| Route | Réponse |
|---|---|
| `GET /api/trades[?active=1]` | `{trades: [{id, status, initiator_id, recipient_id, initiator_wikibidous, recipient_wikibidous, items: [{card_id, user_card_id, offered_by, snapshot_rarity, card}]}]}` |
| `POST /api/trades {recipient_id, items: [{user_card_id, card_id, offered_by}], initiator_wikibidous, recipient_wikibidous}` | création |
| `PATCH /api/trades/{id} {action: "accept"|"cancel"|…}` | réponse |

## Paquets

| Route | Réponse |
|---|---|
| Supabase `POST rpc/sync_profile_packs` | profil avec `packs_remaining`, `packs_last_regen_at` (appelé par la page /pulls) |
| `POST /api/packs/open` (sans corps), `/api/packs/pro-daily`, `/api/packs/special` | `{cards: [{…carte, summary, user_card_id}], packs_remaining, owned_copies}` ou `{error, human_verification_required}`. La page révèle les cartes une à une ; le bouton du bas affiche « Encore N cartes » puis « Continuer ». |
| `POST /api/packs/open` trop tôt (relevé le 13/10/2026) | moins de 2 s après l'ouverture précédente : **429** `{error: "Ouverture trop rapide…", rate_limited: true, rate_limit_daily, retry_after: <date ISO>, packs_remaining}` + `Retry-After: 1`, sans consommer de paquet. Une ouverture en série espacée de 2,4 s a reçu un **403** `{human_verification_required: true}` au 2e paquet ; la page affiche alors une vérification Turnstile (`POST /api/human-check {token}`) puis relance l'ouverture. Une fois la vérification faite par le joueur, 7 paquets ont été ouverts à la suite, 2,4 s d'écart, sans nouvelle demande. |

Sons de la révélation (code client, relevé le 10/11/2026) : module `playSound(nom, {allowLate})` / `stopSound(nom)`, Web Audio
(`fetch` → `arrayBuffer()` → `decodeAudioData`, puis un `createBufferSource()` par lecture, `start()` sans argument).
Sons : `pack-rip` (`/audio/pack-rip.mp3`, volume 0,5), `card-flip` (`/audio/card-flip.mp3`, 0,35), `legendary-reveal`
(`/audio/legendary-reveal.mp3`, 0,45). À l'affichage de la première carte : `pack-rip`, plus `legendary-reveal` si c'est une
Légendaire. Au passage à une autre carte (clic, flèches, balayage), **avant** son affichage : `stopSound("legendary-reveal")`,
`card-flip`, puis `legendary-reveal` si la carte est une Légendaire. Sons coupés par le joueur : `localStorage`
`wiki-masters-sound` = `off`.

## Succès

| Route | Réponse |
|---|---|
| Supabase `achievements?select=*` | `[{id, code, title, description, icon, wikibidous_reward}]` — 51 succès (relevé le 30/10/2026) |
| Supabase `user_achievements?select=*&user_id=eq.{moi}` | `[{user_id, achievement_id, unlocked_at, claimed_at}]` : une ligne par succès débloqué ; `claimed_at` nul tant que la récompense n'est pas réclamée |
| `POST /api/achievements/check {event: "achievements_sync"}` | `{unlocked: [...], progress: [{code, current, target}]}` (succès pas encore débloqués). Appelée par la page `/achievements` à chaque visite : débloque les succès atteints |
| `POST /api/achievements/claim {achievement_id}` | `{claimed_at, amount}` ; `{already_claimed: true, claimed_at}` si déjà réclamée (idempotente). La page relit ensuite le solde (`wikimasters:wikibidous-balance-refresh`) |

## Interface (pour les badges)

- Une carte affichée : `div` dont la classe contient `glow-<rareté>` (`glow-l`, `glow-ur`, …) et
  `rounded-2xl`, avec le titre dans un `h3`. Pas d'identifiant dans le DOM : la carte est retrouvée
  par son titre dans les réponses observées.
- Menu : `nav a[href="/collection"]`, `/trades`, `/marketplace`, `/pulls`, `/global-collection`, … L'entrée active
  porte la classe `bg-[var(--color-accent)]/10 text-[var(--color-accent)]`. Le contenu des pages défile dans `<main>`
  (pas dans la fenêtre) ; une page met son titre à 24 px du bord et 44 px du haut. Sur mobile, la barre du bas
  (`nav` : Paquets, Collection, Échanges, Marché) a un bouton *Plus* qui rend, dans le même `nav`, les autres
  entrées (Profil… Classement, Paramètres) ; ce menu se ferme sur un appui en dehors.
- Fenêtre de proposition d'échange (*Proposer un échange*) : voile `div.fixed.inset-0`, titre
  « Échanger avec <ami> » en `h2` ; sous l'en-tête, une barre « Moi : 2 cartes · 150 wb ⇆ <ami> : 0 cartes »
  (un `span` par côté, WikiBidous ajoutés seulement s'il y en a) ; onglets « Mes cartes » / « Cartes de <ami> »,
  l'actif souligné (`border-b-2`). Seules les cartes choisies de l'onglet ouvert sont dans le DOM, sous un
  `p` « Sélectionnées (n) ». Rien n'est envoyé avant *Envoyer l'offre* (`POST /api/trades`) ; fermer la
  fenêtre avec une sélection demande une confirmation (« Modifications non enregistrées »).
- Solde de WikiBidous : pastille fixée en haut à droite (38 px de haut).
- Solde de WikiBidous affiché : le site le relit quand `window` reçoit l'événement
  `wikimasters:wikibidous-balance-refresh` (`window.dispatchEvent(new CustomEvent(…))`, ce qu'il fait
  lui-même après une défausse ou la réclamation d'un succès). L'extension l'émet après chaque défausse et chaque réclamation.
