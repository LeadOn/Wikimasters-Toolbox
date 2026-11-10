// Liste rangée à la main (familles, cartes d'une famille) : chaque élément se déplace en le faisant
// glisser par sa poignée, à la souris ou au doigt, ou avec les flèches du clavier sur la poignée.
// - événements de pointeur suivis sur toute la fenêtre : l'élément glissé change de place dans la
//   grille pendant le glisser, et sa poignée perdrait alors le pointeur ;
// - l'élément glissé prend la place de celui qu'il survole (attribut data-sort-id), l'ordre
//   provisoire n'est enregistré (commit) qu'au lâcher ; Échap l'annule sans fermer le panneau
//   (écouté avant lui, en phase de capture) ;
// - au clavier, la poignée garde le focus après chaque déplacement.
import {useEffect, useRef, useState} from "preact/hooks";
import {moveItem} from "../../../../core";
import {L} from "../../shared/i18n";

// items : liste complète [{id}] dans l'ordre enregistré ; commit(id, index) : nouvelle place dans
// items ; visible : éléments affichés (liste filtrée), pour que les flèches passent d'un voisin
// visible à l'autre. Renvoie {grid (ref du conteneur), order (ordre provisoire pendant un glisser,
// sinon items), dragId, grip(id, label) : propriétés de la poignée}
export function useSortable(items, commit, {visible = items} = {}) {
  const [drag, setDrag] = useState(null); // {id, order}
  const current = useRef(null);
  const grid = useRef(null);
  const update = (next) => {
    current.current = next;
    setDrag(next);
  };

  useEffect(() => {
    if (!drag) return undefined;
    const move = (e) => {
      const d = current.current;
      if (!d || !grid.current) return;
      const over = [...grid.current.querySelectorAll("[data-sort-id]")].find((el) => {
        const r = el.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      });
      const overId = over?.dataset.sortId;
      if (overId && overId !== d.id) update({...d, order: moveItem(d.order, d.id, d.order.findIndex((x) => x.id === overId))});
    };
    const drop = () => {
      const d = current.current;
      if (d) commit(d.id, d.order.findIndex((x) => x.id === d.id));
      update(null);
      // Le navigateur envoie ensuite un clic à l'élément désormais sous le pointeur (l'élément
      // glissé a changé de place) : ce clic est ignoré, il ouvrirait la famille lâchée
      const swallow = (e) => {
        e.stopPropagation();
        e.preventDefault();
      };
      window.addEventListener("click", swallow, true);
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    };
    const cancel = () => update(null);
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      cancel();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", drop);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", drop);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [Boolean(drag)]);

  const grip = (id, label) => {
    const at = visible.findIndex((x) => x.id === id);
    return {
      type: "button",
      class: "sort-grip",
      title: L("Glisser pour ranger (ou flèches du clavier)", "Drag to reorder (or arrow keys)"),
      "aria-label": L(`Déplacer « ${label} », position ${at + 1} sur ${visible.length}`, `Move "${label}", position ${at + 1} of ${visible.length}`),
      onClick: (e) => e.stopPropagation(),
      onPointerDown: (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        update({id, order: items});
      },
      onKeyDown: (e) => {
        const step = {ArrowLeft: at - 1, ArrowUp: at - 1, ArrowRight: at + 1, ArrowDown: at + 1, Home: 0, End: visible.length - 1}[e.key];
        if (step == null) return;
        e.preventDefault();
        e.stopPropagation();
        // Place du voisin visible visé, dans la liste complète
        const neighbor = visible[Math.max(0, Math.min(visible.length - 1, step))];
        commit(id, items.findIndex((x) => x.id === neighbor.id));
        requestAnimationFrame(() => grid.current?.querySelector(`[data-sort-id="${CSS.escape(id)}"] .sort-grip`)?.focus());
      },
    };
  };

  return {grid, order: drag?.order || items, dragId: drag?.id || null, grip};
}
