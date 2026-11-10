// Son de la Légendaire du site retenu par le script de la page (hook/main-world.js) tant que la
// Toolbox cache la carte : reproduit la lecture du site (fetch → arrayBuffer → decodeAudioData →
// createBufferSource().start()), sans navigateur.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "extension/src/hook/main-world.js"), "utf8");

function page() {
  const played = [];
  const listeners = [];
  class AudioBufferSourceNode {
    start() {
      played.push(this.buffer.name);
    }
    stop() {
      throw new Error("InvalidStateError");
    }
  }
  class BaseAudioContext {
    decodeAudioData(bytes) {
      return Promise.resolve({name: bytes.name});
    }
    createBufferSource() {
      return new AudioBufferSourceNode();
    }
  }
  const window = {
    location: {href: "https://www.wiki-masters.com/pulls", origin: "https://www.wiki-masters.com"},
    AudioBufferSourceNode,
    BaseAudioContext,
    AudioContext: class extends BaseAudioContext {},
    addEventListener: (type, fn) => type === "message" && listeners.push(fn),
    postMessage() {},
    fetch: async (url) => ({arrayBuffer: async () => ({name: String(url).split("/").pop()}), clone() {}}),
    setTimeout,
    clearTimeout,
  };
  window.window = window;
  const ctx = vm.createContext({window, URL, Headers, location: window.location, setTimeout, clearTimeout, Promise});
  vm.runInContext(source, ctx);
  const toolbox = (data) => listeners.forEach((fn) => fn({source: window, data: {__wmt: "toolbox", type: "legendary-sound", ...data}}));
  // Lecture comme le site : décodage une fois, puis un nœud par lecture
  const buffers = {};
  const load = async (name) => (buffers[name] = await new window.AudioContext().decodeAudioData(await (await window.fetch(`/audio/${name}`)).arrayBuffer()));
  const play = (name) => {
    const node = new window.AudioContext().createBufferSource();
    node.buffer = buffers[name];
    node.start();
    return node;
  };
  return {window, played, toolbox, load, play};
}

test("retenu pendant que la carte est cachée, joué à la levée de la retenue", async () => {
  const p = page();
  await p.load("legendary-reveal.mp3");
  await p.load("card-flip.mp3");
  p.toolbox({arm: true, hold: true});
  p.play("card-flip.mp3");
  p.play("legendary-reveal.mp3");
  assert.deepEqual(p.played, ["card-flip.mp3"], "seul le son de la Légendaire attend");
  p.toolbox({arm: true, hold: false});
  assert.deepEqual(p.played, ["card-flip.mp3", "legendary-reveal.mp3"]);
});

test("sans retenue, le son est joué tout de suite ; un son arrêté par le site est oublié", async () => {
  const p = page();
  await p.load("legendary-reveal.mp3");
  p.play("legendary-reveal.mp3");
  assert.deepEqual(p.played, ["legendary-reveal.mp3"]);
  p.toolbox({arm: true, hold: true});
  const node = p.play("legendary-reveal.mp3");
  node.stop();
  p.toolbox({arm: true, hold: false});
  assert.deepEqual(p.played, ["legendary-reveal.mp3"], "carte quittée avant la révélation");
});

test("retenue posée dès l'ouverture d'un paquet, si la Toolbox l'a demandé (arm)", async () => {
  const p = page();
  await p.load("legendary-reveal.mp3");
  p.toolbox({arm: true, hold: false});
  await p.window.fetch("https://www.wiki-masters.com/api/packs/open", {method: "POST"});
  p.play("legendary-reveal.mp3");
  assert.deepEqual(p.played, [], "paquet ouvert : retenu");
  p.toolbox({arm: false, hold: false});
  assert.deepEqual(p.played, ["legendary-reveal.mp3"]);
  await p.window.fetch("https://www.wiki-masters.com/api/packs/open", {method: "POST"});
  p.play("legendary-reveal.mp3");
  assert.equal(p.played.length, 2, "suspense et roulette désactivés : rien n'est retenu");
});
