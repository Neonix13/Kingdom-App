// Imports music rendered in a DAW from the MIDI files of scripts/music-phrases.mjs:
// cuts every phrase out of the long renders, levels each state, encodes AAC with ffmpeg into public/audio/music/
// and writes public/audio/music/manifest.json for public/js/audio/stemMusic.js.
// Usage: node scripts/music-import.mjs --dir RENDERS [--layout ~/Downloads/Kingdom-Phrases/layout.json] [--target public/audio/music] [--bitrate 112k] [--states battle,menu]
// RENDERS holds one sub-folder per state, named like its MIDI file (bataille/, menu/, calme/, deploiement/, victoire/, defaite/), with WAV files inside.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync, openSync, writeSync, closeSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib/midi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = parseArgs(process.argv.slice(2));
const expand = (p) => resolve(String(p).replace(/^~(?=$|\/)/, homedir()));
if (!args.dir) { console.error('Usage : npm run music-import -- --dir "/chemin/vers/Rendus"  (voir LISEZMOI.md du dossier Kingdom-Phrases)'); process.exit(1); }
const DIR = expand(args.dir);
const LAYOUT = expand(args.layout || join(homedir(), 'Downloads', 'Kingdom-Phrases', 'layout.json'));
const TARGET = expand(args.target || join(ROOT, 'public', 'audio', 'music'));
const BITRATE = args.bitrate || '112k';
const ONLY = typeof args.states === 'string' ? args.states.split(',') : null;
const TARGET_RMS_DB = -20;

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\.(wav|wave)$/, '').trim();

export function readWav(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path} : pas un fichier WAV`);
  let p = 12, fmt = null, dataOff = -1, dataLen = 0;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4);
    let len = b.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      let tag = b.readUInt16LE(p + 8);
      const ch = b.readUInt16LE(p + 10), sr = b.readUInt32LE(p + 12), bits = b.readUInt16LE(p + 22);
      if (tag === 0xfffe) tag = b.readUInt16LE(p + 32);
      fmt = { tag, ch, sr, bits };
    } else if (id === 'data') {
      dataOff = p + 8;
      dataLen = Math.min(len, b.length - dataOff);
      break;
    }
    p += 8 + len + (len & 1);
  }
  if (!fmt || dataOff < 0) throw new Error(`${path} : WAV incomplet`);
  const { tag, ch, sr, bits } = fmt;
  const bps = bits / 8;
  const frames = Math.floor(dataLen / (bps * ch));
  let read;
  if (tag === 3 && bits === 32) read = (o) => b.readFloatLE(o);
  else if (tag === 3 && bits === 64) read = (o) => b.readDoubleLE(o);
  else if (tag === 1 && bits === 16) read = (o) => (((b[o] | (b[o + 1] << 8)) << 16) >> 16) / 32768;
  else if (tag === 1 && bits === 24) read = (o) => (((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) << 8) >> 8) / 8388608;
  else if (tag === 1 && bits === 32) read = (o) => b.readInt32LE(o) / 2147483648;
  else throw new Error(`${path} : format WAV non géré (code ${tag}, ${bits} bits)`);
  return { sr, ch, frames, sample: (f, c) => read(dataOff + (f * ch + Math.min(c, ch - 1)) * bps) };
}

function pickFiles(files, layer, layered) {
  const named = files.map((f) => ({ f, n: norm(f) }));
  if (!layered) {
    const master = named.filter((x) => /(^|[^a-z])(master|main)$/.test(x.n));
    if (master.length) return [master[0].f];
    if (named.length > 1) console.warn(`  ${named.length} fichiers sans « Master » : ils sont additionnés`);
    return named.map((x) => x.f);
  }
  const group = named.filter((x) => new RegExp(`(^|[^a-z])${layer}$`).test(x.n));
  if (group.length) return [group[0].f];
  return named.filter((x) => new RegExp(`(^|[^a-z])${layer}-`).test(x.n)).map((x) => x.f);
}

function importState(key, st, phraseBarsDefault) {
  const dir = join(DIR, st.folder);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => /\.wave?$/i.test(f));
  if (!files.length) { console.warn(`${st.folder} : aucun WAV`); return null; }
  console.log(`${st.folder} (${st.bpm} BPM)`);
  const layered = st.layers.length > 1;
  const barSec = 240 / st.bpm;
  const preRoll = barSec / 4;
  const tail = st.slots[0].slotBars - st.slots[0].bars - (st.slots[0].phraseBar - st.slots[0].startBar);
  const tmp = mkdtempSync(join(tmpdir(), 'kb-music-'));
  const pieces = [];
  let sr = 0, chans = 2;
  const layerStats = {};
  for (const layer of st.layers) {
    const chosen = pickFiles(files, layer, layered);
    if (!chosen.length) throw new Error(`${st.folder} : aucun fichier pour la famille « ${layer} » (attendu : un groupe « ${layer} » ou des pistes « ${layer}-… »)`);
    console.log(`  ${layer} ← ${chosen.join(' + ')}`);
    const wavs = chosen.map((f) => readWav(join(dir, f)));
    sr = wavs[0].sr;
    chans = Math.min(2, Math.max(...wavs.map((w) => w.ch)));
    for (const w of wavs) if (w.sr !== sr) throw new Error(`${st.folder} : fréquences d'échantillonnage différentes (${w.sr} / ${sr})`);
    const needed = Math.round(st.totalBars * barSec * sr);
    const shortest = Math.min(...wavs.map((w) => w.frames));
    if (shortest < needed - barSec * sr * 0.5) throw new Error(`${st.folder} : rendu trop court (${(shortest / sr).toFixed(1)} s au lieu de ${(needed / sr).toFixed(1)} s, soit ${st.totalBars} mesures à ${st.bpm} BPM)`);
    let sumSq = 0, count = 0, peak = 0, preE = 0, phraseE = 0;
    for (const slot of st.slots) {
      const phraseStart = slot.phraseBar * barSec;
      const startF = Math.max(0, Math.round((phraseStart - preRoll) * sr));
      const lenF = Math.round((preRoll + (slot.bars + tail) * barSec) * sr);
      const buf = new Float32Array(lenF * chans);
      for (const w of wavs) {
        const n = Math.min(lenF, w.frames - startF);
        for (let i = 0; i < n; i++) for (let c = 0; c < chans; c++) buf[i * chans + c] += w.sample(startF + i, c);
      }
      for (let i = 0; i < buf.length; i++) { const v = buf[i]; sumSq += v * v; const a = v < 0 ? -v : v; if (a > peak) peak = a; }
      count += buf.length;
      const pre0 = Math.round(slot.startBar * barSec * sr), pre1 = Math.round((phraseStart - preRoll) * sr);
      for (const w of wavs) {
        for (let i = pre0; i < pre1 && i < w.frames; i += 8) preE += w.sample(i, 0) ** 2 * 8;
        const p0 = Math.round(phraseStart * sr), p1 = Math.min(w.frames, p0 + Math.round(barSec * sr * 0.75));
        for (let i = p0; i < p1; i += 8) phraseE += w.sample(i, 0) ** 2 * 8;
      }
      const name = slot.type === 'intro' ? `${layer}-intro` : `${layer}-${String(slot.index).padStart(2, '0')}`;
      const raw = join(tmp, name + '.f32');
      const fd = openSync(raw, 'w');
      writeSync(fd, Buffer.from(buf.buffer));
      closeSync(fd);
      pieces.push({ raw, name, seconds: lenF / sr });
    }
    layerStats[layer] = { ms: sumSq / Math.max(1, count), peak };
    if (phraseE > 0 && preE / phraseE > 0.25) console.warn(`  ⚠ ${layer} : beaucoup de son juste avant les phrases. L'export commence-t-il bien à 1.1.1 et au bon tempo ?`);
  }
  const rms = Math.sqrt(Object.values(layerStats).reduce((a, s) => a + s.ms, 0));
  const maxPeak = Math.max(...Object.values(layerStats).map((s) => s.peak));
  let gain = rms > 0 ? Math.pow(10, TARGET_RMS_DB / 20) / rms : 1;
  if (maxPeak * gain > 0.95) gain = 0.95 / maxPeak;
  console.log(`  niveau : ${(20 * Math.log10(rms || 1e-9)).toFixed(1)} dB RMS → gain ${(20 * Math.log10(gain)).toFixed(1)} dB`);

  const outDir = join(TARGET, st.folder);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const p of pieces) {
    const fadeOut = Math.min(0.3, p.seconds / 4);
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'f32le', '-ar', String(sr), '-ac', String(chans), '-i', p.raw,
      '-af', `volume=${gain.toFixed(5)},afade=t=in:d=0.004,afade=t=out:st=${(p.seconds - fadeOut).toFixed(4)}:d=${fadeOut.toFixed(4)}`,
      '-c:a', 'aac', '-b:a', BITRATE, '-movflags', '+faststart', join(outDir, p.name + '.m4a')], { stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.error || r.status !== 0) throw new Error(`ffmpeg a échoué (${r.error ? r.error.message : 'code ' + r.status}). Installez-le avec : brew install ffmpeg`);
  }
  rmSync(tmp, { recursive: true, force: true });
  const intro = st.slots.find((s) => s.type === 'intro');
  const phrases = st.slots.filter((s) => s.type === 'phrase').length;
  console.log(`  ${pieces.length} fichiers → ${outDir}`);
  return { folder: st.folder, bpm: st.bpm, phraseBars: st.slots.find((s) => s.type === 'phrase')?.bars || phraseBarsDefault, tailBars: tail,
    preRoll: +preRoll.toFixed(5), phrases, layers: st.layers, intro: intro ? { bars: intro.bars } : null, ext: 'm4a', gain: 1 };
}

if (!existsSync(LAYOUT)) { console.error(`layout.json introuvable : ${LAYOUT} (relancez npm run music-phrases, ou passez --layout)`); process.exit(1); }
const layout = JSON.parse(readFileSync(LAYOUT, 'utf8'));
const manifestPath = join(TARGET, 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { format: 'kb-music-1', states: {} };
let done = 0;
for (const [key, st] of Object.entries(layout.states)) {
  if (ONLY && !ONLY.includes(key)) continue;
  try {
    const entry = importState(key, st, layout.phraseBars);
    if (entry) { manifest.states[key] = { ...entry, gain: manifest.states[key]?.gain ?? 1 }; done++; }
  } catch (e) { console.error(`✗ ${e.message}`); process.exitCode = 1; }
}
mkdirSync(TARGET, { recursive: true });
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + '\n');
console.log(done ? `${done} état(s) importé(s). Manifeste : ${manifestPath}` : `Aucun état trouvé dans ${DIR} (sous-dossiers attendus : ${Object.values(layout.states).map((s) => s.folder).join(', ')})`);
