// Script du « monde principal » de la page : observe les réponses que le site reçoit déjà
// (collection, paquets, échanges, marché…) et les transmet à l'extension par window.postMessage.
// Aucune requête supplémentaire n'est faite ici. Seule modification : le son de la Légendaire du
// site est retenu tant que la Toolbox cache la carte (voir « Son de la Légendaire » plus bas).
(() => {
  if (window.__wmtHook) return;
  window.__wmtHook = true;

  // Réponses utiles à l'extension (chemin relatif au site, ou API Supabase)
  const WATCHED = [
    /^\/api\/my-collection(?:\/stats)?(?:\?|$)/,
    /^\/api\/profile\/[^/]+\/collection(?:\?|$)/,
    /^\/api\/cards(?:\?|$)/,
    /^\/api\/marketplace(?:\?|$|\/[0-9a-f-]{36}$)/,
    /^\/api\/marketplace\/cards\/[0-9a-f-]{36}\/sales\?scope=summary$/,
    /^\/api\/trades(?:\?|$)/,
    /^\/api\/packs\/(?:open|pro-daily|special)$/,
    /^\/api\/notifications$/,
    /^\/api\/wikibidous$/,
    /^\/api\/user-cards\/[^/]+\/discard$/,
    /^\/rest\/v1\/rpc\/sync_profile_packs$/,
  ];
  // Mise aux enchères par le site : seule la requête dit quel exemplaire est mis en vente (card_id)
  const withRequest = (path, method) => path === "/api/marketplace" && String(method).toUpperCase() === "POST";

  function relative(url) {
    try {
      const u = new URL(url, location.href);
      if (u.origin === location.origin || u.hostname.endsWith(".supabase.co")) return u.pathname + u.search;
    } catch {}
    return null;
  }

  const isWatched = (path) => path && WATCHED.some((re) => re.test(path));

  function post(message) {
    try {
      window.postMessage({__wmt: "hook", ...message}, location.origin);
    } catch {}
  }

  // La clé publique Supabase (« apikey ») est relevée dans les requêtes du site.
  let apikeySent = null;
  function noteHeaders(url, headers) {
    try {
      if (!String(url).includes(".supabase.co/")) return;
      const key = new Headers(headers || {}).get("apikey");
      if (key && key !== apikeySent) {
        apikeySent = key;
        post({type: "apikey", apikey: key});
      }
    } catch {}
  }

  const parse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };

  // body : corps de la requête, transmis seulement quand la réponse ne suffit pas (withRequest)
  function emit(path, method, status, text, body) {
    const data = text ? parse(text) : undefined;
    if (data === undefined) return;
    const request = withRequest(path, method) && typeof body === "string" ? parse(body) : undefined;
    post({type: "response", path, method: (method || "GET").toUpperCase(), status, data, request});
  }

  // --- Son de la Légendaire. Le site joue « legendary-reveal » (Web Audio) dès qu'on passe à une
  // Légendaire, dans le clic, avant même d'afficher la carte : pendant le suspense ou la roulette,
  // il dévoilerait la rareté. Le script de contenu demande de le retenir (hold) tant qu'une
  // Légendaire du paquet doit encore être cachée ou que la carte affichée l'est ; levée la
  // retenue, le son retenu est joué (à la révélation). Le son est reconnu à son fichier : ses
  // octets, puis le tampon décodé, sont marqués. Rien d'autre n'est retenu ; un son arrêté par le
  // site pendant la retenue (carte quittée) est oublié. arm : retenue posée dès l'ouverture d'un
  // paquet (suspense ou roulette activés), le temps que le script de contenu lise le paquet.
  const LEGENDARY_SOUND = /\/audio\/legendary-reveal\.mp3(?:[?#]|$)/;
  const PACK_OPEN = /^\/api\/packs\/(?:open|pro-daily|special)$/;
  const soundBytes = new WeakSet();
  const soundBuffers = new WeakSet();
  const heldNodes = new Set();
  let holdSound = false;
  let armOnPack = false;
  let holdTimer = null;
  const Source = window.AudioBufferSourceNode?.prototype;
  const startSource = Source?.start;
  const stopSource = Source?.stop;
  function setSoundHold(on) {
    holdSound = on;
    clearTimeout(holdTimer);
    // Filet de sécurité : jamais retenu plus de 10 minutes sans nouvelle du script de contenu
    if (on) holdTimer = setTimeout(() => setSoundHold(false), 10 * 60 * 1000);
    else {
      for (const node of heldNodes)
        try {
          startSource.call(node);
        } catch {}
      heldNodes.clear();
    }
  }
  if (Source && startSource && stopSource) {
    Source.start = function () {
      if (holdSound && this.buffer && soundBuffers.has(this.buffer)) return void heldNodes.add(this);
      return startSource.apply(this, arguments);
    };
    Source.stop = function () {
      if (heldNodes.delete(this)) return;
      return stopSource.apply(this, arguments);
    };
    const Ctx = (window.BaseAudioContext || window.AudioContext)?.prototype;
    const decode = Ctx?.decodeAudioData;
    if (decode)
      Ctx.decodeAudioData = function (bytes) {
        const mark = bytes && soundBytes.has(bytes);
        const result = decode.apply(this, arguments);
        return mark && result?.then ? result.then((buffer) => (soundBuffers.add(buffer), buffer)) : result;
      };
  }
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (event.source !== window || !msg || msg.__wmt !== "toolbox" || msg.type !== "legendary-sound") return;
    armOnPack = Boolean(msg.arm);
    setSoundHold(Boolean(msg.hold));
  });

  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url;
    const method = init?.method || (typeof input === "object" && input?.method) || "GET";
    noteHeaders(url, init?.headers || (typeof input === "object" ? input?.headers : null));
    const promise = originalFetch.apply(this, arguments);
    const path = relative(url);
    if (armOnPack && path && PACK_OPEN.test(path) && String(method).toUpperCase() === "POST") setSoundHold(true);
    if (path && LEGENDARY_SOUND.test(path))
      // Avant les .then du site : ses octets sont marqués dès leur lecture
      promise
        .then((res) => {
          const read = res.arrayBuffer;
          res.arrayBuffer = function () {
            return read.apply(this, arguments).then((bytes) => (soundBytes.add(bytes), bytes));
          };
        })
        .catch(() => {});
    if (isWatched(path)) {
      promise
        .then((res) => {
          res
            .clone()
            .text()
            .then((text) => emit(path, method, res.status, text, init?.body))
            .catch(() => {});
        })
        .catch(() => {});
    }
    return promise;
  };

  const XHR = window.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    const setHeader = XHR.prototype.setRequestHeader;
    XHR.prototype.open = function (method, url) {
      this.__wmt = {method, url: String(url), headers: {}};
      return open.apply(this, arguments);
    };
    XHR.prototype.setRequestHeader = function (name, value) {
      if (this.__wmt) this.__wmt.headers[name] = value;
      return setHeader.apply(this, arguments);
    };
    XHR.prototype.send = function (body) {
      const info = this.__wmt;
      if (info) {
        noteHeaders(info.url, info.headers);
        const path = relative(info.url);
        if (isWatched(path))
          this.addEventListener("load", () => {
            if (this.responseType === "" || this.responseType === "text") emit(path, info.method, this.status, this.responseText, body);
          });
      }
      return send.apply(this, arguments);
    };
  }
})();
