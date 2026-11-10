// Emplacement d'un bloc de la page Paquets (récapitulatif, taux de drop) : marge gauche, sous le
// contenu, marge droite (features/pack-dock.js). Sans assez de place, le bloc reste dessous.
import {useStore} from "../lib/store";
import {settings} from "../state/settings";
import {dockRoom, DOCK_MIN, setDock} from "../features/pack-dock";
import {Icon} from "./components";
import {L} from "../../shared/i18n";

const SIDES = [
  ["left", "dock-left", () => L("À gauche", "On the left")],
  ["below", "dock-below", () => L("Dessous", "Below")],
  ["right", "dock-right", () => L("À droite", "On the right")],
];

export function DockPicker({block}) {
  const s = useStore(settings);
  const room = useStore(dockRoom);
  const current = s.packDock?.[block] || "below";
  return (
    <div class="seg dock-picker" role="group" aria-label={L("Emplacement du bloc", "Block position")}>
      {SIDES.map(([side, icon, label]) => {
        const tight = side !== "below" && room[side] < DOCK_MIN[block];
        const title = tight ? L(`${label()} : pas assez de place à côté du contenu sur cet écran`, `${label()}: not enough room beside the content on this screen`) : label();
        return (
          <button key={side} type="button" class={current === side ? "on" : ""} aria-pressed={current === side} disabled={tight && current !== side} title={title} aria-label={title} onClick={() => setDock(block, side)}>
            <Icon name={icon} size={14} />
          </button>
        );
      })}
    </div>
  );
}
