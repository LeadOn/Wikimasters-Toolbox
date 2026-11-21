// Verrou partagé entre les onglets WikiMasters (et dans l'onglet) : une seule écriture lourde à la
// fois (tri, paquets…). wait : attendre la fin de l'opération en cours au lieu d'échouer.
import {L} from "../../shared/i18n";
import {load, save, remove, onChange} from "./storage";
import {extensionAlive} from "./ext";

// Firefox : le navigator.locks d'un script de contenu est celui de la page, et sa promesse est
// rejetée (« Permission denied to access property "then" ») dès que le rappel vient du script,
// quelle que soit sa valeur de retour. On passe donc par le navigator.locks de la page
// (wrappedJSObject), avec un rappel exporté (exportFunction) qui rend une promesse de la page,
// résolue sans valeur à la fin de l'opération ; le résultat et l'erreur passent par la promesse
// du script. callback rend la promesse de l'opération, ou undefined quand le verrou est pris.
function requestLock(key, options, callback) {
  const page = typeof exportFunction === "function" ? window.wrappedJSObject : null;
  if (!page?.navigator?.locks) return navigator.locks.request(key, options, callback);
  const pageCallback = (lock) => {
    const run = callback(lock);
    if (!run) return undefined;
    const settle = (resolve) => run.then(() => resolve(), () => resolve());
    return new page.Promise(exportFunction(settle, page));
  };
  return page.navigator.locks.request(key, cloneInto(options, page), exportFunction(pageCallback, page));
}

// Rôle de meneur tenu par un seul onglet WikiMasters à la fois, coordonné par un bail enregistré
// dans le stockage de l'extension :
// - un onglet resté ouvert après un rechargement de l'extension perd son accès au stockage
//   (extensionAlive() faux) : son bail expire au lieu de bloquer les autres onglets ;
// - un onglet visible reprend aussitôt le relais sur un onglet caché (que le navigateur bride) ;
// - à la fermeture (pagehide), le bail est libéré tout de suite ;
// - take() reprend le relais dans cet onglet s'il y a plusieurs fenêtres visibles.
export function electLeader(name, onLeader, {heartbeatMs = 5000, ttlMs = 15000} = {}) {
  const key = `leader:${name}`;
  const tab = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const isVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
  const isStale = (lease, now = Date.now()) => !lease || !lease.tab || !(now - lease.at < ttlMs);
  const canTake = (lease, now, force) => force || isStale(lease, now) || lease.tab === tab || (isVisible() && !lease.visible);

  let leader = false;
  let claiming = false;
  let pendingForce = false;
  let stopped = false;

  const setLeader = (next) => {
    if (next === leader) return;
    leader = next;
    onLeader(leader);
  };

  async function tryClaim({force = false} = {}) {
    if (stopped) return;
    if (claiming) {
      if (force) pendingForce = true;
      return;
    }
    if (!extensionAlive()) return stop();
    claiming = true;
    try {
      const current = await load(key, null);
      if (stopped) return;
      if (!canTake(current, Date.now(), force)) {
        setLeader(false);
        return;
      }
      await save(key, {tab, visible: isVisible(), at: Date.now()});
      const verify = await load(key, null);
      if (!stopped) setLeader(verify?.tab === tab);
    } catch {
      if (!extensionAlive()) stop();
    } finally {
      claiming = false;
      if (pendingForce && !stopped) {
        pendingForce = false;
        tryClaim({force: true});
      }
    }
  }

  async function tick() {
    if (stopped) return;
    if (!extensionAlive()) return stop();
    if (!leader) return tryClaim();
    try {
      const current = await load(key, null);
      if (stopped) return;
      if (current && current.tab !== tab && !canTake(current, Date.now(), false)) {
        setLeader(false);
        return;
      }
      await save(key, {tab, visible: isVisible(), at: Date.now()});
    } catch {
      if (!extensionAlive()) stop();
    }
  }

  const offChange = onChange(key, (lease) => {
    if (stopped) return;
    if (lease?.tab === tab) {
      if (!claiming) setLeader(true);
    } else if (leader && lease?.tab && lease.tab !== tab) {
      setLeader(false);
    } else if (canTake(lease, Date.now(), false)) {
      tryClaim();
    }
  });

  const onVisibility = () => {
    if (stopped) return;
    if (leader) tick();
    else if (isVisible()) tryClaim();
  };

  const onPageHide = () => {
    if (!leader) return;
    setLeader(false);
    remove(key).catch(() => {});
  };

  globalThis.document?.addEventListener?.("visibilitychange", onVisibility);
  globalThis.window?.addEventListener?.("pagehide", onPageHide);
  const timer = setInterval(tick, heartbeatMs);
  timer?.unref?.();

  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    offChange();
    globalThis.document?.removeEventListener?.("visibilitychange", onVisibility);
    globalThis.window?.removeEventListener?.("pagehide", onPageHide);
    const wasLeader = leader;
    setLeader(false);
    if (wasLeader && extensionAlive()) remove(key).catch(() => {});
  }

  tryClaim();
  return {take: () => tryClaim({force: true}), stop};
}

export async function withLock(name, fn, {wait = false} = {}) {
  if (!navigator.locks) return fn();
  let run = null;
  const callback = (lock) => {
    if (!lock) return undefined;
    run = (async () => fn())();
    return run;
  };
  await requestLock(`wmt:${name}`, wait ? {} : {ifAvailable: true}, callback);
  if (!run) throw new Error(L("Une opération du même type est déjà en cours (dans cet onglet ou un autre onglet WikiMasters). Réessayez quand elle sera terminée.", "An operation of the same kind is already running (in this tab or another WikiMasters tab). Try again once it has finished."));
  return run;
}
