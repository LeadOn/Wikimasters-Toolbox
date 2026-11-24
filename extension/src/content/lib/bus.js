// Bus d'événements de l'extension, alimenté notamment par les réponses observées par le hook.
const listeners = new Map();

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}

export function emit(type, payload) {
  for (const fn of listeners.get(type) || []) {
    try {
      fn(payload);
    } catch (e) {
      console.error("[WikiMasters Toolbox]", type, e);
    }
  }
}

// Messages du script de page (hook/main-world.js) → événements typés
const ROUTES = [
  ["my-collection", /^\/api\/my-collection(?:\?|$)/],
  ["my-collection-stats", /^\/api\/my-collection\/stats/],
  ["friend-collection", /^\/api\/profile\/([^/]+)\/collection/],
  ["catalog", /^\/api\/cards(?:\?|$)/],
  ["price-history", /^\/api\/marketplace\/cards\/([0-9a-f-]{36})\/price-history$/],
  ["card-sales", /^\/api\/marketplace\/cards\/([0-9a-f-]{36})\/sales(?:\?rarity=([A-Z]+))?$/],
  ["auction", /^\/api\/marketplace\/([0-9a-f-]{36})$/],
  ["marketplace", /^\/api\/marketplace(?:\?|$)/],
  ["trades", /^\/api\/trades/],
  ["pack-opened", /^\/api\/packs\/(?:open|pro-daily|special)$/],
  ["notifications", /^\/api\/notifications$/],
  ["wikibidous", /^\/api\/wikibidous$/],
  ["copy-discarded", /^\/api\/user-cards\/([^/]+)\/discard$/],
  ["packs-status", /^\/rest\/v1\/rpc\/sync_profile_packs$/],
];

// Message au script du monde principal (hook/main-world.js)
export function tellHook(type, data) {
  try {
    window.postMessage({__wmt: "toolbox", type, ...data}, location.origin);
  } catch {}
}

function deliver(msg) {
  if (msg.type === "apikey" && typeof msg.apikey === "string") return emit("apikey", msg.apikey);
  if (msg.type !== "response" || typeof msg.path !== "string" || msg.status < 200 || msg.status >= 300) return;
  for (const [type, re] of ROUTES) {
    const m = re.exec(msg.path);
    if (m) return emit(type, {data: msg.data, path: msg.path, method: msg.method, match: m, request: msg.request});
  }
}

// Réponses gardées au plus tant qu'elles ne peuvent pas être transmises
const PENDING_MAX = 100;

// allowed() : true pour transmettre les réponses du site ; sinon elles sont gardées en mémoire (les
// PENDING_MAX dernières), sans que rien n'en soit fait. Renvoie flush(), qui transmet celles gardées
// si allowed() est devenu vrai (avertissement accepté : la page affichée est reconnue sans recharger).
export function startHookBridge(allowed = () => true) {
  const pending = [];
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (event.source !== window || !msg || msg.__wmt !== "hook") return;
    if (allowed()) return deliver(msg);
    pending.push(msg);
    if (pending.length > PENDING_MAX) pending.shift();
  });
  // Seules les lectures sont transmises après coup : une action faite avant (paquet ouvert, défausse…)
  // ne déclenche rien a posteriori
  return () => {
    if (!allowed()) return;
    for (const msg of pending.splice(0)) if (msg.type === "apikey" || String(msg.method || "GET").toUpperCase() === "GET") deliver(msg);
  };
}
