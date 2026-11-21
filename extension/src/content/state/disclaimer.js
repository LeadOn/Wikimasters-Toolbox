// Avertissement à accepter une fois avant que la Toolbox ne fasse quoi que ce soit : le règlement de
// WikiMasters interdit l'automatisation, et le joueur qui active l'extension en assume seul les
// conséquences pour son compte. Tant qu'il n'est pas accepté, rien ne démarre (index.jsx) : ni bloc
// dans les pages, ni lecture du site, ni indexation. Une nouvelle version du texte le redemande.
import {persistentStore} from "../lib/storage";
import {createStore} from "../lib/store";

export const DISCLAIMER_VERSION = 1;

// version : version du texte acceptée ; acceptedAt / refusedAt : date du choix (ms)
export const disclaimer = persistentStore("disclaimer", {version: 0, acceptedAt: null, refusedAt: null});

export const isAccepted = () => disclaimer.get().version === DISCLAIMER_VERSION && Boolean(disclaimer.get().acceptedAt);
// Fenêtre affichée : au premier lancement (ni accepté ni refusé), ou à la demande (popup)
export const disclaimerView = createStore({open: false});

export function acceptDisclaimer() {
  disclaimer.set({version: DISCLAIMER_VERSION, acceptedAt: Date.now(), refusedAt: null});
  disclaimerView.set({open: false});
}

// Refus : la Toolbox reste inactive ; la fenêtre ne revient pas d'elle-même (popup pour la rouvrir)
export function refuseDisclaimer() {
  disclaimer.set({version: DISCLAIMER_VERSION, acceptedAt: null, refusedAt: Date.now()});
  disclaimerView.set({open: false});
}

// À afficher d'office : jamais répondu pour cette version du texte
export const mustAsk = () => disclaimer.get().version !== DISCLAIMER_VERSION;
