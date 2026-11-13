// Le site revient à « Rareté » à chaque visite : l'ordre du réglage collectionOrder est choisi dans son menu, une fois par visite.
import {sleep} from "../lib/http";

// Menu pas encore utilisable (page pas encore interactive) : nouvel essai au passage suivant, borné
const MAX_TRIES = 3;
const MENU_WAIT_MS = 1000;
let visit = null;

// Liste des options, si le menu est ouvert
const openList = (button) => (button.getAttribute("aria-expanded") === "true" ? document.getElementById(button.getAttribute("aria-controls")) : null);

/**
 * Appelée à chaque mise à jour de la page.
 * @param {{onPage: boolean, button: HTMLElement|null, wanted: string|null, optionSelector: string}} page
 *   onPage : page Collection affichée ; button : bouton du menu d'ordre du site (aria-controls → liste
 *   d'options) ; wanted : libellé de l'option voulue, null pour garder l'ordre du site
 * @return {Promise<boolean>} true si l'option a été sélectionnée
 */
export async function ensureCollectionOrder({onPage, button, wanted, optionSelector}) {
  if (!onPage) {
    visit = null;
    return false;
  }
  // Réglage changé pendant la visite : le nouvel ordre est appliqué tout de suite
  if (visit?.wanted !== wanted) visit = {wanted, tries: 0, done: false, waiting: false};
  const current = visit;
  if (current.done || current.waiting || !button) return false;
  if (!wanted || button.textContent.trim() === wanted) {
    current.done = true;
    return false;
  }
  // Un menu ouvert par un essai précédent, trop lent à répondre, sert à celui-ci : pas de second clic qui le refermerait
  let list = openList(button);
  if (!list) {
    if (current.tries >= MAX_TRIES) {
      current.done = true;
      return false;
    }
    current.tries++;
    current.waiting = true;
    button.click();
    for (let waitedMs = 0; !list && waitedMs < MENU_WAIT_MS; waitedMs += 50) {
      await sleep(50);
      list = openList(button);
    }
    current.waiting = false;
    // Joueur parti, ou réglage changé, pendant l'attente : cette visite n'est plus la bonne
    if (!list || current !== visit) return false;
  }
  current.done = true;
  const option = [...list.querySelectorAll(optionSelector)].find((o) => o.textContent.trim() === wanted);
  // Option absente (libellé changé par le site) : menu refermé, ordre du site gardé
  (option || button).click();
  return Boolean(option);
}
