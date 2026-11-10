# Firefox Add-ons (AMO)

Fiche publique : <https://addons.mozilla.org/fr/firefox/addon/wikimasters-toolbox/>
Tableau de bord : <https://addons.mozilla.org/developers/addon/wikimasters-toolbox/edit>

## Fiche

| Champ | Valeur |
|---|---|
| Nom | WikiMasters Toolbox |
| URL | `wikimasters-toolbox` |
| Résumé anglais (250 car. max) | Unofficial tools for WikiMasters: card sorting, market prices, filters, trades, auctions, packs, families and achievements. |
| Résumé français | Outils non officiels pour WikiMasters : tri des cartes, prix du marché, filtres, échanges, enchères, paquets, familles et succès. |
| Description | « Detailed description (English) » puis « Description détaillée (français) » de `fiche.md` (texte brut) |
| Catégories | Jeux et divertissements (Firefox et Firefox pour Android) |
| Page d'accueil | https://github.com/LeadOn/Wikimasters-Toolbox |
| Assistance | https://github.com/LeadOn/Wikimasters-Toolbox/issues |
| Politique de confidentialité | contenu de `../PRIVACY.md` |
| Captures d'écran | `images/capture-1.png` à `capture-5.png`, légendes de `fiche.md` |
| Compatibilité | Firefox 128+ et Firefox pour Android (`strict_min_version` dans `extension/build.mjs`) |
| Collecte de données | aucune (`data_collection_permissions: {required: ["none"]}` dans le manifeste) |

## Publier une nouvelle version

1. Augmenter `version` dans `package.json` (AMO refuse un numéro déjà publié), puis
   `npm test && npm run package` → `dist/wikimasters-toolbox-firefox-<version>.zip`.
2. Archive des sources, une fois la version commitée (le code publié est minifié : AMO demande les
   sources) :
   `git archive --format=zip -o dist/wikimasters-toolbox-source-<version>.zip HEAD`.
3. Tableau de bord → *Importer une nouvelle version* → le `.zip` Firefox ; plateformes Firefox et
   Firefox pour Android.
4. *Code source* : **Oui**, joindre l'archive des sources.
5. *Notes de version* : section « Firefox Add-ons » de la version dans `notes-de-version.md` (anglais,
   puis français via le sélecteur de langue).
6. *Notes pour les examinateurs* : le texte ci-dessous.
7. Si la description a changé (`fiche.md`), mettre à jour la fiche (*Modifier la fiche du produit*) dans
   les deux langues.

### Notes pour les examinateurs

```
Unofficial companion extension for wiki-masters.com (a Wikipedia card collecting game). It only runs on wiki-masters.com.

Build from the attached source archive (Node.js 18 or later, npm):
  npm ci
  npm run build
The Firefox build is written to dist/firefox (npm run package also zips it as dist/wikimasters-toolbox-firefox-<version>.zip). The code is bundled and minified with esbuild (extension/build.mjs), not obfuscated. No remote code, no eval.

Network: the extension talks only to wiki-masters.com and the Supabase project the site itself uses (same requests as the site, with the player's own session), and, for the optional "missing images" feature, to the Wikipedia and Wikidata APIs. No data is sent anywhere else; settings and caches stay in browser.storage.local.

Writes to the player's account (sorting tags, selling, discarding, opening packs, claiming achievements) only happen on an explicit click, except two automatic options that are off by default and that the player turns on.
```
