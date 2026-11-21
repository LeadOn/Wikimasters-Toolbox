// Fenêtre d'avertissement (state/disclaimer.js) : seule interface de la Toolbox tant qu'elle n'est
// pas acceptée. Accepter demande de cocher la case ; refuser laisse la Toolbox inactive.
import {useState} from "preact/hooks";
import {useStore} from "../lib/store";
import {disclaimerView, acceptDisclaimer, refuseDisclaimer} from "../state/disclaimer";
import {Mark} from "../../shared/Brand";
import {L} from "../../shared/i18n";

export function Disclaimer() {
  const {open} = useStore(disclaimerView);
  const [checked, setChecked] = useState(false);
  if (!open) return null;
  return (
    <div class="modal-wrap">
      <div class="modal disclaimer" role="dialog" aria-modal="true" aria-label={L("Avant d'utiliser WikiMasters Toolbox", "Before using WikiMasters Toolbox")}>
        <h3 style={{display: "flex", alignItems: "center", gap: "8px"}}>
          <Mark size={18} /> {L("Avant d'utiliser WikiMasters Toolbox", "Before using WikiMasters Toolbox")}
        </h3>
        <div class="stack">
          <p>
            {L(
              "WikiMasters Toolbox est une extension non officielle, faite par des joueurs. Elle n'est ni développée ni approuvée par WikiMasters.",
              "WikiMasters Toolbox is an unofficial extension made by players. It is neither developed nor endorsed by WikiMasters.",
            )}
          </p>
          <p>
            {L(
              "Les règles de la communauté de WikiMasters interdisent les bots, scripts et outils qui jouent, ouvrent des paquets, échangent ou interagissent à votre place, ainsi que la modification ou l'interception du trafic du site. Ses conditions d'utilisation prévoient la suspension ou le bannissement d'un compte, notamment en cas d'utilisation d'automatisation. Utiliser la Toolbox peut donc être considéré comme contraire à ces règles.",
              "WikiMasters' community rules forbid bots, scripts and tools that play, open packs, trade or interact on your behalf, as well as modifying or intercepting the site's traffic. Its terms of use provide for suspending or banning an account, in particular when automation is used. Using the Toolbox may therefore be considered a breach of these rules.",
            )}
          </p>
          <p>
            {L(
              "Une sanction peut aller jusqu'au bannissement définitif, avec la perte du compte et de tout ce qu'il contient.",
              "A sanction can go as far as a permanent ban, with the loss of the account and everything in it.",
            )}
          </p>
          <p>
            <strong>
              {L(
                "En activant la Toolbox, vous choisissez de l'utiliser en connaissance de cause. Vous êtes seul responsable de son utilisation et de ses conséquences pour votre compte, y compris en cas de sanction ou de bannissement ; le ou les développeurs de l'extension ne peuvent en être tenus responsables.",
                "By turning on the Toolbox, you choose to use it knowingly. You alone are responsible for using it and for the consequences for your account, including a sanction or a ban; the extension's developer or developers cannot be held responsible.",
              )}
            </strong>
          </p>
          <p class="help">{L("L'extension est fournie telle quelle, sans aucune garantie.", "The extension is provided as is, without any warranty.")}</p>
          <label class="check">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.currentTarget.checked)} />{" "}
            {L("J'ai lu cet avertissement et j'accepte d'utiliser la Toolbox sous ma seule responsabilité.", "I have read this warning and agree to use the Toolbox at my own risk.")}
          </label>
          <div class="row" style={{justifyContent: "flex-end"}}>
            <button class="btn" onClick={refuseDisclaimer}>
              {L("Refuser", "Decline")}
            </button>
            <button class="btn primary" disabled={!checked} onClick={acceptDisclaimer}>
              {L("Accepter et activer la Toolbox", "Accept and turn on the Toolbox")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
