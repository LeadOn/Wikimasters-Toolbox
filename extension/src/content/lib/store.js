// Petit gestionnaire d'état réactif pour Preact (sans dépendance).
import {useEffect, useReducer} from "preact/hooks";

export function createStore(initial) {
  let state = initial;
  const subscribers = new Set();
  return {
    get: () => state,
    set(patch) {
      state = typeof patch === "function" ? patch(state) : {...state, ...patch};
      for (const fn of subscribers) fn(state);
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}

export function useStore(store, selector = (s) => s) {
  const [, rerender] = useReducer((n) => n + 1, 0);
  const rendered = store.get();
  useEffect(() => {
    const off = store.subscribe(rerender);
    // Modifié entre le premier rendu et l'abonnement (les effets passent après l'affichage) : sans
    // ce rattrapage, un message envoyé au démarrage n'apparaîtrait jamais
    if (store.get() !== rendered) rerender();
    return off;
  }, [store]);
  return selector(rendered);
}
