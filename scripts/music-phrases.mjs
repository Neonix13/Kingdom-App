// Exports the generative music as pools of independent phrases to render in a DAW (Ableton), then re-import
// with scripts/music-import.mjs. One MIDI file per music state; phrases are laid out one per "slot":
// [1 bar of pre-roll][PHRASE_BARS bars][TAIL_BARS bars of tail], back to back, at the state's fixed tempo.
// Usage: node scripts/music-phrases.mjs [--out DIR] [--phrases 24] [--seed 1234] [--states battle,menu]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Music } from '../public/js/audio/music.js';
import { STEM_STATES, PHRASE_BARS, TAIL_BARS, PRE_BARS } from '../public/js/audio/stemLayout.js';
import { PPQ, TRACKS, text, tempoEvent, noteEvents, convertEvent, writeMidi, parseArgs, mockEngine } from './lib/midi.mjs';

const args = parseArgs(process.argv.slice(2));
const OUT = resolve(args.out || join(homedir(), 'Downloads', 'Kingdom-Phrases'));
const PHRASES = Math.max(2, parseInt(args.phrases, 10) || 24);
const SEED = parseInt(args.seed, 10) || 1234;
const ONLY = typeof args.states === 'string' ? args.states.split(',') : Object.keys(STEM_STATES);
const SLOT_BARS = PRE_BARS + PHRASE_BARS + TAIL_BARS;

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Records one phrase (or the victory/defeat intro) as events with times relative to its first bar.
function recordPhrase(key, seed, intro) {
  const st = STEM_STATES[key];
  const layered = st.layers.length > 1;
  const barSec = 240 / st.bpm;
  const events = [];
  let barT = 0;
  const drumLayer = (name, t) => {
    if (!layered) return 'mix';
    const eighth = (t - barT) / (barSec / 8);
    const onStrong = Math.abs(eighth) < 0.3 || Math.abs(eighth - 4) < 0.3;
    return name === 'm_wood' || (name === 'm_taiko_lo' && onStrong) ? 'leger' : 'lourd';
  };
  const engine = mockEngine((name, t, o) => { if (TRACKS[name]) events.push({ track: name, t, gain: o.gain ?? 0.5, layer: drumLayer(name, t) }); });
  const bars = [];
  class Recorder extends Music {
    inst(name, midi, t, o = {}) {
      events.push({ track: name, midi: Math.round(midi), t, gain: o.gain ?? 0.5, bend: o.bend, bendBack: o.bendBack, stopAt: o.stopAt, layer: layered ? (name === 'pipa' ? 'pipa' : 'melodie') : 'mix' });
      return null;
    }
    flute(notes, bus, gain = 0.2) {
      notes.forEach((n, i) => events.push({ track: 'dizi', midi: Math.round(n.m), t: n.t, dur: n.dur, gain: gain * (i === 0 || n.dur > 0.6 ? 1.05 : 0.9), layer: layered ? 'melodie' : 'mix' }));
    }
    barLen() { return barSec; }
    bar(g, t, beat) {
      bars.push(t);
      barT = t;
      if (!layered) return super.bar(g, t, beat);
      this.battleDrums(g, t, beat, 1);
      if (g.bar % 2 === 0) this.qin(g, t, 0.8, beat);
      this.pipa(g, t, beat, 1);
      if (this.rnd() < 0.4) this.zhengPhrase(g, t, beat, 0.8);
      if (t >= g.fluteUntil && this.rnd() < 0.18) g.fluteUntil = this.flutePhrase(g, t + beat, beat, 0.8) + beat;
    }
  }
  const m = new Recorder(engine, seed);
  m.set(key);
  if (!intro) m.gens[0].stinger = false;
  const want = intro ? 1 : PHRASE_BARS;
  let t = 0;
  while (bars.length < want) { m.scheduleWindow(t, t + 0.05); t += 0.05; }
  const t0 = bars[0];
  const rel = events.map((e) => ({ ...e, t: e.t - t0, stopAt: e.stopAt != null ? e.stopAt - t0 : undefined }));
  let bars2 = PHRASE_BARS;
  if (intro) {
    const end = Math.max(...rel.map((e) => e.t + (e.dur || 0)));
    bars2 = Math.max(2, Math.ceil(end / barSec + 0.25));
    return { events: rel, bars: bars2, barSec };
  }
  return { events: rel.filter((e) => e.t < PHRASE_BARS * barSec - 0.02), bars: bars2, barSec };
}

function exportState(key) {
  const st = STEM_STATES[key];
  const barSec = 240 / st.bpm;
  const slots = [];
  let bar = 0;
  const all = [];
  const add = (rec, type, index) => {
    const slotBars = PRE_BARS + rec.bars + TAIL_BARS;
    const start = (bar + PRE_BARS) * barSec;
    const end = (bar + slotBars) * barSec - barSec / 8;
    for (const e of rec.events) {
      if (e.t < -PRE_BARS * barSec) continue;
      const ev = { ...e, t: start + e.t, slotEnd: end };
      if (ev.dur != null) ev.dur = Math.min(ev.dur, end - ev.t);
      if (ev.stopAt != null) ev.stopAt = Math.min(start + e.stopAt, end);
      all.push(ev);
    }
    slots.push({ type, index, startBar: bar, phraseBar: bar + PRE_BARS, bars: rec.bars, slotBars });
    bar += slotBars;
  };
  if (st.intro) add(recordPhrase(key, SEED, true), 'intro', 0);
  const count = st.intro ? Math.max(4, Math.round(PHRASES / 3)) : PHRASES;
  for (let i = 0; i < count; i++) add(recordPhrase(key, SEED + 7919 * (i + 1), false), 'phrase', i + 1);
  const totalBars = bar;

  const tick = (t) => Math.max(0, Math.round((t / barSec) * 4 * PPQ));
  const secs = (s) => Math.round((s / barSec) * 4 * PPQ);
  const tempo = [tempoEvent(0, barSec / 4), { tick: 0, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] }, { tick: 0, data: text(`${st.folder} ${st.bpm} bpm`) }];
  for (const s of slots) {
    const label = s.type === 'intro' ? 'Intro' : `Phrase ${String(s.index).padStart(2, '0')}`;
    const b = [...Buffer.from(label)];
    tempo.push({ tick: s.phraseBar * 4 * PPQ, data: [0xff, 0x06, b.length, ...b] });
  }
  tempo.push({ tick: totalBars * 4 * PPQ, data: [0xff, 0x01, 3, ...Buffer.from('fin')] });
  const tracks = [tempo];
  const groups = new Map();
  for (const e of all) {
    const k = `${e.layer}|${e.track}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const order = (k) => { const [layer, track] = k.split('|'); return st.layers.indexOf(layer) * 100 + Object.keys(TRACKS).indexOf(track); };
  let ch = 0;
  const trackNames = [];
  for (const k of [...groups.keys()].sort((a, b) => order(a) - order(b))) {
    const [layer, track] = k.split('|');
    const def0 = TRACKS[track];
    const name = layer === 'mix' ? def0.name : (layer === 'pipa' && track === 'pipa' ? 'pipa' : `${layer}-${slug(def0.name)}`);
    const channel = def0.drum != null ? 9 : ch++;
    if (ch === 9) ch++;
    const def = { ...def0, ch: channel };
    const out = [{ tick: 0, data: text(name) }];
    if (def.program != null) out.push({ tick: 0, data: [0xc0 | def.ch, def.program] });
    const notes = [];
    for (const e of groups.get(k)) {
      const before = notes.length;
      convertEvent(e, def, tick, secs, notes, out);
      for (let i = before; i < notes.length; i++) notes[i].off = Math.min(notes[i].off, tick(e.slotEnd));
    }
    out.push(...noteEvents(def.ch, notes));
    tracks.push(out);
    trackNames.push(name);
  }
  const file = `${st.folder}.mid`;
  writeFileSync(join(OUT, file), writeMidi(tracks));
  return { key, folder: st.folder, bpm: st.bpm, layers: st.layers, midi: file, totalBars, seconds: +(totalBars * barSec).toFixed(2), slots, tracks: trackNames };
}

mkdirSync(OUT, { recursive: true });
const layout = { format: 'kb-music-phrases-1', seed: SEED, phraseBars: PHRASE_BARS, tailBars: TAIL_BARS, preBars: PRE_BARS, states: {} };
for (const key of ONLY) {
  if (!STEM_STATES[key]) { console.warn('état inconnu', key); continue; }
  const s = exportState(key);
  layout.states[key] = s;
  const min = Math.floor(s.seconds / 60), sec = Math.round(s.seconds % 60);
  console.log(`${s.midi.padEnd(18)} ${s.bpm} bpm  ${s.slots.length} emplacements  ${s.totalBars} mesures (${min} min ${sec} s)  pistes : ${s.tracks.join(', ')}`);
}
writeFileSync(join(OUT, 'layout.json'), JSON.stringify(layout, null, 1));

const lines = [
  '# Kingdom Battleground — phrases à rendre dans Ableton',
  '',
  'Chaque fichier MIDI contient une suite de phrases indépendantes. Le jeu les rejouera dans un ordre aléatoire.',
  `Chaque emplacement = 1 mesure d'amorce + ${PHRASE_BARS} mesures de phrase + ${TAIL_BARS} mesures de queue (réverbération). Ne déplacez rien dans le temps.`,
  '',
  '| Fichier | Tempo à régler dans Live | Durée à exporter |',
  '|---|---|---|',
  ...Object.values(layout.states).map((s) => `| ${s.midi} | ${s.bpm} BPM | mesures 1 à ${s.totalBars + 1} (${s.totalBars} mesures) |`),
  '',
  '## Dans Ableton Live (un set par fichier)',
  '1. Nouveau set. Réglez le **tempo** indiqué ci-dessus (Live n\'importe pas le tempo des fichiers MIDI), mesure 4/4.',
  '2. Glissez le fichier `.mid` dans la vue Arrangement, **au tout début (1.1.1)** : Live crée une piste MIDI par piste du fichier.',
  '3. Chargez vos instruments, mixez, ajoutez la réverbération que vous voulez (les queues tiennent dans les 2 mesures prévues).',
  '   Évitez un limiteur ou compresseur qui « pompe » sur le master : le jeu superpose la queue d\'une phrase au début de la suivante.',
  '4. **bataille.mid** : gardez les 4 familles séparées. Les noms de pistes commencent par `melodie-`, `pipa`, `leger-`, `lourd-`.',
  '   Le jeu monte ou baisse chaque famille selon l\'intensité du combat (`leger` = taiko sur les temps forts et bloc de bois, `lourd` = le reste des percussions).',
  '   Pas d\'effet partagé entre familles (pas de sidechain, pas de bus de réverbération commun), sinon chaque famille exportée seule sonne différemment.',
  '5. Fichier › Exporter audio/vidéo :',
  '   - Piste rendue : **Toutes les pistes individuelles** pour bataille ; **Master** (ou Main) pour les autres ;',
  '   - Début 1.1.1, longueur = le nombre de mesures du tableau (sélectionnez de la mesure 1 à la mesure indiquée dans l\'arrangement avant d\'exporter) ;',
  '   - WAV, 24 bits ou 32 bits flottant, 44,1 ou 48 kHz, **Normaliser : non**, rendu en boucle : non.',
  '   - Enregistrez dans un dossier par état, nommé comme le fichier : `Rendus/bataille/`, `Rendus/menu/`, `Rendus/calme/`, `Rendus/deploiement/`, `Rendus/victoire/`, `Rendus/defaite/`.',
  '   - Pour bataille, si vous avez regroupé les pistes dans des pistes de groupe, nommez les groupes `melodie`, `pipa`, `leger`, `lourd` : le script prend le groupe s\'il existe, sinon il additionne les pistes de la famille.',
  '',
  '## Retour dans le jeu',
  '```',
  'npm run music-import -- --dir "/chemin/vers/Rendus"',
  '```',
  'Le script découpe les rendus, égalise le volume par état, encode en AAC (ffmpeg) dans `public/audio/music/` et écrit `manifest.json`.',
  'Un état non rendu garde la musique synthétisée. Vous pouvez faire un état à la fois.',
];
writeFileSync(join(OUT, 'LISEZMOI.md'), lines.join('\n') + '\n');
console.log('→', OUT);
