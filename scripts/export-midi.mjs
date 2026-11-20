// Exports the generative music (public/js/audio/music.js) as MIDI files, one per music state.
// Usage: node scripts/export-midi.mjs [--out DIR] [--bars 32] [--seed 1234] [--minutes 20]
// --minutes: one long take per state (battle also as a variable-intensity take); victory/defeat stay short cues.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Music } from '../public/js/audio/music.js';
import { PPQ, TRACKS, text, tempoEvent, noteEvents, convertEvent, writeMidi, parseArgs, mockEngine } from './lib/midi.mjs';

const args = parseArgs(process.argv.slice(2));
const MINUTES = parseFloat(args.minutes) || 0;
const OUT = resolve(args.out || join(homedir(), 'Downloads', MINUTES ? `Kingdom-MIDI-${MINUTES}min` : 'Kingdom-MIDI'));
const BARS = Math.max(4, parseInt(args.bars, 10) || 32);
const SEED = parseInt(args.seed, 10) || 1234;
function wander(seed) {
  let x = seed >>> 0;
  const rnd = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
  const plateaus = [];
  return (bar) => {
    const i = Math.floor(bar / 16);
    while (plateaus.length <= i) plateaus.push(plateaus.length === 0 ? 0.1 : Math.min(1, Math.max(0.05, plateaus[plateaus.length - 1] + (rnd() - 0.45) * 0.7)));
    return plateaus[i];
  };
}

const PIECES = MINUTES ? [
  { file: '01-menu', state: 'menu', minutes: MINUTES },
  { file: '02-calme', state: 'calm', minutes: MINUTES },
  { file: '03-deploiement', state: 'deploy', minutes: MINUTES },
  { file: '04-bataille-faible', state: 'battle', minutes: MINUTES, intensity: () => 0.2 },
  { file: '05-bataille-moyenne', state: 'battle', minutes: MINUTES, intensity: () => 0.5 },
  { file: '06-bataille-intense', state: 'battle', minutes: MINUTES, intensity: () => 0.9 },
  { file: '07-bataille-variable', state: 'battle', minutes: MINUTES, intensity: wander(SEED) },
  { file: '08-victoire', state: 'victory', bars: Math.max(8, Math.round(BARS * 0.75)) },
  { file: '09-defaite', state: 'defeat', bars: Math.max(8, Math.round(BARS * 0.75)) },
] : [
  { file: '01-menu', state: 'menu' },
  { file: '02-calme', state: 'calm' },
  { file: '03-deploiement', state: 'deploy' },
  { file: '04-bataille-faible', state: 'battle', intensity: () => 0.2 },
  { file: '05-bataille-moyenne', state: 'battle', intensity: () => 0.5 },
  { file: '06-bataille-intense', state: 'battle', intensity: () => 0.9 },
  { file: '07-bataille-montee', state: 'battle', bars: BARS * 2, intensity: (bar, n) => bar / Math.max(1, n - 1) },
  { file: '08-victoire', state: 'victory', bars: Math.max(8, Math.round(BARS * 0.75)) },
  { file: '09-defaite', state: 'defeat', bars: Math.max(8, Math.round(BARS * 0.75)) },
];

function record(piece) {
  const events = [];
  const bars = [];
  const engine = mockEngine((name, t, o) => { if (TRACKS[name]) events.push({ track: name, t, gain: o.gain ?? 0.5 }); });
  class Recorder extends Music {
    inst(name, midi, t, o = {}) {
      events.push({ track: name, midi: Math.round(midi), t, gain: o.gain ?? 0.5, bend: o.bend, bendBack: o.bendBack, stopAt: o.stopAt });
      return null;
    }
    flute(notes, bus, gain = 0.2) {
      notes.forEach((n, i) => events.push({ track: 'dizi', midi: Math.round(n.m), t: n.t, dur: n.dur, gain: gain * (i === 0 || n.dur > 0.6 ? 1.05 : 0.9) }));
    }
    bar(g, t, beat) {
      bars.push({ t, beat });
      super.bar(g, t, beat);
    }
  }
  const m = new Recorder(engine, SEED);
  let n = piece.minutes ? Infinity : piece.bars || BARS;
  m.set(piece.state);
  if (piece.intensity) { m.intensity = piece.intensity(0, n); m.targetIntensity = m.intensity; }
  let t = 0;
  while (bars.length < n) {
    if (piece.intensity) m.targetIntensity = piece.intensity(bars.length, n);
    m.scheduleWindow(t, t + 0.05);
    t += 0.05;
    const lb = bars[bars.length - 1];
    if (piece.minutes && lb && lb.t + 4 * lb.beat - bars[0].t >= piece.minutes * 60) n = bars.length;
  }
  const end = bars[n - 1].t + 4 * bars[n - 1].beat;
  return { events: events.filter((e) => e.t < end), bars: bars.slice(0, n), end };
}

function toMidi({ events, bars, end }) {
  const tick = (t) => {
    let i = 0;
    while (i + 1 < bars.length && bars[i + 1].t <= t) i++;
    const b = bars[i];
    return Math.max(0, Math.round(i * 4 * PPQ + ((t - b.t) / b.beat) * PPQ));
  };
  const secs = (s, at) => {
    const b = bars.find((x, i) => i + 1 >= bars.length || bars[i + 1].t > at) || bars[0];
    return Math.round((s / b.beat) * PPQ);
  };

  const tracks = [];
  const tempo = [];
  let lastBeat = null;
  bars.forEach((b, i) => {
    if (lastBeat === null || Math.abs(b.beat - lastBeat) > 1e-6) {
      tempo.push(tempoEvent(i * 4 * PPQ, b.beat));
      lastBeat = b.beat;
    }
  });
  tempo.push({ tick: 0, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] });
  tempo.push({ tick: 0, data: text('Tempo') });
  tracks.push(tempo);

  for (const [key, def] of Object.entries(TRACKS)) {
    const evs = events.filter((e) => e.track === key);
    if (!evs.length) continue;
    const out = [{ tick: 0, data: text(def.name) }];
    if (def.program != null) out.push({ tick: 0, data: [0xc0 | def.ch, def.program] });
    const notes = [];
    for (const e of evs) convertEvent(e, def, tick, secs, notes, out);
    out.push(...noteEvents(def.ch, notes, tick(end) + 4 * PPQ));
    tracks.push(out);
  }

  return writeMidi(tracks);
}

mkdirSync(OUT, { recursive: true });
for (const piece of PIECES) {
  const rec = record(piece);
  writeFileSync(join(OUT, piece.file + '.mid'), toMidi(rec));
  const bpms = [...new Set(rec.bars.map((b) => Math.round(60 / b.beat)))];
  const counts = {};
  for (const e of rec.events) counts[e.track] = (counts[e.track] || 0) + 1;
  console.log(`${piece.file}.mid  ${rec.bars.length} mesures, ${bpms.length > 1 ? bpms[0] + '→' + bpms[bpms.length - 1] : bpms[0]} bpm, ${Math.round(rec.end - rec.bars[0].t)} s  ${Object.entries(counts).map(([k, v]) => `${TRACKS[k].name}:${v}`).join(' ')}`);
}
console.log('→', OUT);
