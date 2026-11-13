// Notes de version de Firefox Add-ons (texte brut, anglais puis français), tirées de extension/changelog.json :
// les mêmes textes que l'onglet Nouveautés de l'extension.
//   npm run release-notes [-- <version>]   (version de package.json par défaut)
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const {areas, releases} = read("extension/changelog.json");
const version = process.argv[2] || read("package.json").version;
const release = releases.find((r) => r.version === version);
if (!release) {
  console.error(`Aucune entrée pour la version ${version} dans extension/changelog.json.`);
  process.exit(1);
}

const TITLE = {en: `What's new in ${version}`, fr: `Nouveautés de la ${version}`};

function notes(lang) {
  // Rubriques dans l'ordre de leur première nouveauté
  const blocks = [...new Set(release.items.map((i) => i.area))]
    .map((a) => [areas[a][lang], ...release.items.filter((i) => i.area === a).map((i) => `- ${i[lang]}`)].join("\n"));
  return [TITLE[lang], ...blocks].join("\n\n");
}

for (const [lang, label] of [["en", "anglais"], ["fr", "français"]]) {
  console.log(`### Firefox Add-ons : notes de version (${label})\n\n\`\`\`\n${notes(lang)}\n\`\`\`\n`);
}
