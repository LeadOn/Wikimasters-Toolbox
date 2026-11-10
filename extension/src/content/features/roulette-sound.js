// Cliquetis de la roulette (features/roulette.js), à chaque dos qui passe sous le repère : un clic
// mécanique synthétisé par l'extension, ou le son importé par le joueur (onglet Réglages), gardé
// dans le stockage de l'extension (jamais inclus dans l'extension publiée). Le navigateur peut
// couper le son si la page n'a pas reçu de geste récent.
import {persistentStore} from "../lib/storage";
import {L} from "../../shared/i18n";

// Son importé : nom du fichier et contenu (data: URL) ; null : clic synthétisé
export const rouletteSound = persistentStore("rouletteSound", {name: null, data: null});

export const MAX_SOUND_BYTES = 300 * 1024;
// Un son importé est coupé au-delà (les clics se suivent de près au début du défilement)
const MAX_PLAY_S = 0.6;

let audio = null;
const context = () => {
  audio ||= new AudioContext();
  if (audio.state === "suspended") audio.resume().catch(() => {});
  return audio;
};

// Bruit blanc (base du clic), créé une fois
let noise = null;
function noiseBuffer(ctx) {
  if (noise) return noise;
  noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.08), ctx.sampleRate);
  const ch = noise.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  return noise;
}

// Enveloppe : attaque quasi immédiate, décroissance exponentielle
function envelope(ctx, t, peak, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  return g;
}

// Clic mécanique : attaque sèche (bruit aigu, quelques ms), corps résonant (bruit filtré autour de
// 3,3 kHz, comme une languette de plastique sur un cran) et un « toc » très court. Hauteur
// légèrement différente à chaque cran, pour éviter l'effet mitraillette.
function synthTick(ctx) {
  const t = ctx.currentTime;
  const pitch = 0.96 + Math.random() * 0.08;
  const out = ctx.createGain();
  out.gain.value = 0.55;
  out.connect(ctx.destination);

  const snap = ctx.createBufferSource();
  snap.buffer = noiseBuffer(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 5000 * pitch;
  snap.connect(hp).connect(envelope(ctx, t, 0.35, 0.009)).connect(out);
  snap.start(t);
  snap.stop(t + 0.02);

  const body = ctx.createBufferSource();
  body.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 3300 * pitch;
  bp.Q.value = 14;
  body.connect(bp).connect(envelope(ctx, t, 1.6, 0.045)).connect(out);
  body.start(t);
  body.stop(t + 0.06);

  const thock = ctx.createOscillator();
  thock.type = "sine";
  thock.frequency.setValueAtTime(1000 * pitch, t);
  thock.frequency.exponentialRampToValueAtTime(480 * pitch, t + 0.02);
  thock.connect(envelope(ctx, t, 0.12, 0.025)).connect(out);
  thock.start(t);
  thock.stop(t + 0.03);
}

// Son importé, décodé une fois (relu si le joueur en importe un autre)
let decoded = {data: null, buffer: null};
// data: URL → octets, sans fetch (la politique de sécurité de la page pourrait le refuser)
export function dataUrlBytes(data) {
  const bin = atob(String(data).slice(String(data).indexOf(",") + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
const decode = (ctx, data) => ctx.decodeAudioData(dataUrlBytes(data));
function customBuffer(ctx) {
  const {data} = rouletteSound.get();
  if (!data) return null;
  if (decoded.data !== data) {
    decoded = {data, buffer: null};
    decode(ctx, data).then(
      (buffer) => decoded.data === data && (decoded.buffer = buffer),
      () => {},
    );
  }
  return decoded.buffer;
}
// Décodé d'avance au début de la roulette, pour que le premier cran ait déjà le bon son
export function prepareTick() {
  try {
    customBuffer(context());
  } catch {}
}

export function tick() {
  try {
    const ctx = context();
    const buffer = customBuffer(ctx);
    if (!buffer) {
      // Son importé pas encore décodé : rien plutôt que le clic par défaut
      if (!rouletteSound.get().data) synthTick(ctx);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(ctx.currentTime, 0, Math.min(buffer.duration, MAX_PLAY_S));
  } catch {}
}

// Écoute dans les réglages : trois crans de plus en plus espacés, comme à la fin du défilement
export function previewTick() {
  prepareTick();
  [0, 180, 420].forEach((ms) => setTimeout(tick, ms + 60));
}

// Fichier choisi par le joueur : vérifié (type, taille, décodable) avant d'être enregistré.
// Lève une erreur au message montrable au joueur.
export async function importSound(file) {
  if (!/^audio\//.test(file.type || "")) throw new Error(L("Ce fichier n'est pas un son.", "This file is not a sound."));
  if (file.size > MAX_SOUND_BYTES) throw new Error(L("Son trop volumineux (300 Ko au plus).", "Sound too large (300 KB max)."));
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  try {
    await decode(context(), data);
  } catch {
    throw new Error(L("Ce son ne peut pas être lu par le navigateur.", "The browser cannot play this sound."));
  }
  rouletteSound.set({name: file.name.slice(0, 120), data});
}

export const resetSound = () => rouletteSound.set({name: null, data: null});
