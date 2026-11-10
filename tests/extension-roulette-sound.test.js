// Son de la roulette importé par le joueur : vérifié (type, taille, décodable) avant d'être gardé.
const test = require("node:test");
const assert = require("node:assert/strict");
const {loadExtensionModule} = require("./helpers/extension");

function setup() {
  const data = {};
  globalThis.chrome = {
    runtime: {id: "test"},
    storage: {
      local: {
        get: async (key) => Object.fromEntries([].concat(key).filter((k) => k in data).map((k) => [k, data[k]])),
        set: async (obj) => Object.assign(data, obj),
        remove: async () => {},
      },
      onChanged: {addListener() {}, removeListener() {}},
    },
  };
  // Le navigateur ne lit que de vrais sons : ici, un contenu qui commence par « BAD » est illisible
  globalThis.AudioContext = class {
    state = "running";
    decodeAudioData(bytes) {
      const head = Buffer.from(bytes).subarray(0, 3).toString();
      return head === "BAD" ? Promise.reject(new Error("decode")) : Promise.resolve({duration: 0.1});
    }
  };
  globalThis.FileReader = class {
    readAsDataURL(file) {
      file.arrayBuffer().then((b) => {
        this.result = `data:${file.type};base64,${Buffer.from(b).toString("base64")}`;
        this.onload();
      });
    }
  };
  return loadExtensionModule("extension/src/content/features/roulette-sound.js");
}

const file = (content, type, name = "clic.ogg") => new File([content], name, {type});

test("un son valide est gardé, avec son nom ; « Son par défaut » le retire", async () => {
  const m = setup();
  await m.importSound(file("OggS-son", "audio/ogg"));
  const saved = m.rouletteSound.get();
  assert.equal(saved.name, "clic.ogg");
  assert.equal(Buffer.from(m.dataUrlBytes(saved.data)).toString(), "OggS-son");
  m.resetSound();
  assert.deepEqual(m.rouletteSound.get(), {name: null, data: null});
});

test("refusés : autre chose qu'un son, fichier trop lourd, son illisible", async () => {
  const m = setup();
  await assert.rejects(m.importSound(file("{}", "application/json", "x.json")), /pas un son/);
  await assert.rejects(m.importSound(file(Buffer.alloc(m.MAX_SOUND_BYTES + 1), "audio/mpeg")), /trop volumineux/);
  await assert.rejects(m.importSound(file("BAD!", "audio/wav")), /ne peut pas être lu/);
  assert.equal(m.rouletteSound.get().data, null, "rien n'est gardé");
});
