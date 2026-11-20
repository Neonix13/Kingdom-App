// Exports the generative music (public/js/audio/music.js) as MIDI files, one per music state.
// Usage: node scripts/export-midi.mjs [--out DIR] [--bars 32] [--seed 1234]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Music } from '../public/js/audio/music.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));
const OUT = resolve(args.out || join(homedir(), 'Downloads', 'Kingdom-MIDI'));
const BARS = Math.max(4, parseInt(args.bars, 10) || 32);
const SEED = parseInt(args.seed, 10) || 1234;
const PPQ = 480;

const TRACKS = {
  zheng: { name: 'Guzheng', ch: 0, program: 107, ref: 0.6, beats: 2 },
  pipa: { name: 'Pipa', ch: 1, program: 106, ref: 0.24, beats: 0.5 },
  qin: { name: 'Guqin', ch: 2, program: 24, ref: 0.5, beats: 4 },
  qinh: { name: 'Guqin (harmoniques)', ch: 3, program: 46, ref: 0.22, beats: 3 },
  dizi: { name: 'Dizi', ch: 4, program: 77, ref: 0.2 },
  m_taiko_lo: { name: 'Taiko grave', ch: 9, drum: 35, ref: 0.6 },
  m_taiko_mid: { name: 'Taiko médium', ch: 9, drum: 47, ref: 0.35 },
  m_drum_hi: { name: 'Tambour aigu', ch: 9, drum: 50, ref: 0.18 },
  m_wood: { name: 'Bloc de bois', ch: 9, drum: 76, ref: 0.12 },
};

const PIECES = [
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

const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
const node = () => ({ gain: param(), connect() {}, disconnect() {} });

function record(piece) {
  const events = [];
  const bars = [];
  const engine = {
    ctx: { createGain: node, createPeriodicWave: () => ({}) },
    buses: { music: node() },
    now: () => 0,
    note(name, rate, t, o = {}) { if (TRACKS[name]) events.push({ track: name, t, gain: o.gain ?? 0.5 }); return null; },
  };
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
  const n = piece.bars || BARS;
  m.set(piece.state);
  if (piece.intensity) { m.intensity = piece.intensity(0, n); m.targetIntensity = m.intensity; }
  let t = 0;
  while (bars.length < n) {
    if (piece.intensity) m.targetIntensity = piece.intensity(bars.length, n);
    m.scheduleWindow(t, t + 0.05);
    t += 0.05;
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
  const vel = (gain, ref) => Math.max(24, Math.min(127, Math.round(40 + 87 * Math.min(1, gain / ref))));

  const tracks = [];
  const tempo = [];
  let lastBeat = null;
  bars.forEach((b, i) => {
    if (lastBeat === null || Math.abs(b.beat - lastBeat) > 1e-6) {
      const us = Math.round(b.beat * 1e6);
      tempo.push({ tick: i * 4 * PPQ, data: [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255] });
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
    for (const e of evs) {
      const on = tick(e.t);
      const v = vel(e.gain, def.ref);
      if (def.drum != null) { notes.push({ on, off: on + PPQ / 8, pitch: def.drum, v }); continue; }
      let off;
      if (e.dur != null) off = tick(e.t + e.dur);
      else if (e.stopAt != null) off = tick(e.stopAt);
      else off = on + def.beats * PPQ;
      if (e.bend && Math.abs(e.bend[1]) >= 1.5) {
        const [at, semis] = e.bend;
        const mainOn = tick(e.t + at);
        notes.push({ on, off: Math.max(on + 10, mainOn), pitch: e.midi, v: Math.round(v * 0.8) });
        notes.push({ on: mainOn, off: Math.max(off, mainOn + PPQ / 2), pitch: e.midi + Math.round(semis), v });
        continue;
      }
      notes.push({ on, off, pitch: e.midi, v });
      if (e.bend) {
        const [at, semis, dur] = e.bend;
        const steps = 8;
        const bendAt = (k, s) => ({ tick: tick(e.t + at) + Math.round(k * secs(dur, e.t) / steps), data: pb(def.ch, s) });
        for (let k = 0; k <= steps; k++) out.push(bendAt(k, (semis * k) / steps));
        let back = tick(e.t + at + dur);
        if (e.bendBack) {
          const [hold, bdur] = e.bendBack;
          const s0 = tick(e.t + at + dur + hold);
          const span = secs(bdur, e.t);
          for (let k = 0; k <= steps; k++) out.push({ tick: s0 + Math.round((k * span) / steps), data: pb(def.ch, semis * (1 - k / steps)) });
          back = s0 + span;
        }
        out.push({ tick: Math.max(back, off), data: pb(def.ch, 0) });
      }
    }
    notes.sort((a, b) => a.on - b.on);
    const lastOn = new Map();
    for (const n of notes) {
      const prev = lastOn.get(n.pitch);
      if (prev && prev.off > n.on) prev.off = Math.max(prev.on + 1, n.on);
      lastOn.set(n.pitch, n);
    }
    const endTick = tick(end);
    for (const n of notes) {
      out.push({ tick: n.on, data: [0x90 | def.ch, n.pitch, n.v], order: 2 });
      out.push({ tick: Math.min(n.off, endTick + 4 * PPQ), data: [0x80 | def.ch, n.pitch, 0], order: 0 });
    }
    tracks.push(out);
  }

  const chunks = tracks.map((evs) => {
    evs.sort((a, b) => a.tick - b.tick || (a.order ?? 1) - (b.order ?? 1));
    const bytes = [];
    let last = 0;
    for (const e of evs) { bytes.push(...vlq(e.tick - last), ...e.data); last = e.tick; }
    bytes.push(0, 0xff, 0x2f, 0);
    return Buffer.concat([Buffer.from('MTrk'), u32(bytes.length), Buffer.from(bytes)]);
  });
  const header = Buffer.concat([Buffer.from('MThd'), u32(6), u16(1), u16(chunks.length), u16(PPQ)]);
  return Buffer.concat([header, ...chunks]);
}

function text(str) {
  const b = [...Buffer.from(str)];
  return [0xff, 0x03, ...vlq(b.length), ...b];
}
function pb(ch, semis) {
  const v = Math.max(0, Math.min(16383, Math.round(8192 + (semis / 2) * 8191)));
  return [0xe0 | ch, v & 127, (v >> 7) & 127];
}
function vlq(n) {
  const out = [n & 127];
  while ((n >>= 7)) out.unshift((n & 127) | 128);
  return out;
}
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };

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
