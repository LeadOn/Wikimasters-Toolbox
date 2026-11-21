// Point d'entrée de WikiMasters Toolbox dans les pages wiki-masters.com (monde isolé).
import {render} from "preact";
import {useStore} from "./lib/store";
import {ext, extensionAlive} from "./lib/ext";
import {startHookBridge, emit} from "./lib/bus";
import {startRegistry} from "./lib/registry";
import {readSession} from "./lib/session";
import {settings} from "./state/settings";
import {profiles} from "./state/profiles";
import {packsStatus} from "./features/packs";
import {startBidAlerts} from "./features/market";
import {startAuctionTab} from "./features/auction-tab";
import {startAchievements} from "./features/achievements";
import {startSiteDom, watchRoute} from "./features/site-dom";
import {startNotificationSound} from "./features/notify";
import {startStonksRoute} from "./features/stonks";
import {planSort} from "./features/sorter";
import {startPriceIndex, indexProgress, indexState} from "./state/price-index";
import {isOn} from "./state/settings";
import {slowBudget, slowSpeed, slowStoppedBy} from "./state/prices";
import {disclaimer, disclaimerView, isAccepted, mustAsk} from "./state/disclaimer";
import {App, openPanel} from "./ui/App";
import {Disclaimer} from "./ui/Disclaimer";
import {announceNews} from "./ui/tabs/NewsTab";
import {hasNews} from "./state/news";
import {toast, errorMessage} from "./ui/feedback";
import panelCss from "./ui/panel.css";

if (!window.__wmtContent) {
  window.__wmtContent = true;

  // À document_start : écouter le hook avant que le site ne fasse ses premières requêtes. Tant que
  // l'avertissement (state/disclaimer.js) n'est pas accepté, les réponses du site ne sont transmises à
  // aucune fonctionnalité : les dernières sont seulement gardées, et transmises à l'acceptation.
  let choiceKnown = false;
  const flushHook = startHookBridge(() => choiceKnown && isAccepted());
  startRegistry();
  disclaimer.ready.then(() => {
    choiceKnown = true;
    flushHook();
  });

  // Fonctionnalités qui agissent d'elles-mêmes : démarrées une fois l'avertissement accepté
  let started = false;
  const startFeatures = () => {
    if (started) return;
    started = true;
    flushHook();
    startNotificationSound();
    startSiteDom();
    watchRoute();
    startStonksRoute();
    startBidAlerts();
    startAuctionTab();
    startAchievements();
    startPriceIndex();
    announceNews().catch((e) => console.warn("[WikiMasters Toolbox] nouveautés", e));
  };

  // Panneau et blocs de la Toolbox seulement après acceptation ; avant, la fenêtre d'avertissement
  const Root = () => {
    useStore(disclaimer);
    return (
      <>
        <Disclaimer />
        {isAccepted() && <App />}
      </>
    );
  };

  const boot = async () => {
    await Promise.all([settings.ready, profiles.ready, disclaimer.ready]);
    const host = document.createElement("div");
    host.id = "wikimasters-toolbox";
    const attach = () => host.isConnected || (document.body || document.documentElement).append(host);
    attach();
    const root = host.attachShadow({mode: "open"});
    const style = document.createElement("style");
    style.textContent = panelCss;
    root.append(style);
    const mount = document.createElement("div");
    root.append(mount);
    render(<Root />, mount);
    // Si le site reconstruit le <body> (erreur de rendu, changement de mise en page), la Toolbox
    // est raccrochée telle quelle, avec son état
    setInterval(attach, 1500);
    if (isAccepted()) startFeatures();
    else {
      // Premier lancement (ou nouvelle version du texte) : l'avertissement s'affiche d'office
      if (mustAsk()) disclaimerView.set({open: true});
      disclaimer.subscribe(() => isAccepted() && startFeatures());
    }
  };
  // Après le chargement complet : le site (React) doit avoir fini d'hydrater la page avant
  // qu'on y ajoute quoi que ce soit, sinon React signale un décalage et re-rend tout.
  const start = () => setTimeout(() => boot().catch((e) => console.error("[WikiMasters Toolbox] démarrage impossible", e)), 300);
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, {once: true});

  // Messages de la popup d'extension
  if (extensionAlive())
    ext.runtime.onMessage.addListener((msg, _sender, reply) => {
      // Avertissement pas encore accepté : la popup ne peut que le rouvrir
      if (!isAccepted()) {
        if (msg?.type === "status") {
          const s = readSession();
          reply({connected: Boolean(s), username: s?.username || null, accepted: false});
          return;
        }
        disclaimerView.set({open: true});
        reply({ok: true});
        return;
      }
      if (msg?.type === "status") {
        const s = readSession();
        const p = indexProgress();
        const priceIndex = isOn("priceIndex")
          ? {leader: indexState.get().leader, total: p.total, read: p.read, due: p.due, today: slowBudget.get().count, cap: slowSpeed().cap, stopped: Boolean(slowStoppedBy())}
          : null;
        reply({connected: Boolean(s), username: s?.username || null, accepted: true, packs: packsStatus.get().remaining, news: hasNews(), priceIndex});
        return;
      }
      if (msg?.type === "open-panel") {
        openPanel(msg.tab);
        reply({ok: true});
        return;
      }
      if (msg?.type === "sort-new") {
        openPanel("sort");
        planSort({newOnly: true}).catch((e) => toast(errorMessage(e), {type: "error"}));
        reply({ok: true});
        return;
      }
      if (msg?.type === "open-all") {
        emit("confirm-open-all", {});
        reply({ok: true});
      }
    });
}
