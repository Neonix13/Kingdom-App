import { MUSIC_BASES } from './recipes.js';
import { rng, mtof, clamp, smoothstep } from './dsp.js';

const MODES = { gong: [0, 2, 4, 7, 9], shang: [0, 2, 5, 7, 10], jue: [0, 3, 5, 8, 10], zhi: [0, 2, 5, 7, 9], yu: [0, 3, 5, 7, 10] };

export const MUSIC_STATES = {
  menu: { tonic: 50, mode: 'gong', bpm: 58, fadeIn: 3, fadeOut: 3, l: { zheng: 0.7, flute: 0.3, qin: 0.6, qinh: 0.35, rest: 0.2 } },
  calm: { tonic: 55, mode: 'zhi', bpm: 52, fadeIn: 4, fadeOut: 4, l: { zheng: 0.45, flute: 0.18, qin: 0.4, qinh: 0.5, rest: 0.4 } },
  deploy: { tonic: 47, mode: 'yu', bpm: 74, fadeIn: 2.5, fadeOut: 2.5, l: { zheng: 0.35, flute: 0.12, qin: 0.5, qinh: 0.15, pipa: 0.45, drums: 0.4, rest: 0.1 } },
  battle: { tonic: 45, mode: 'yu', bpm: 84, fadeIn: 2, fadeOut: 2.5, battle: true, l: { qin: 0.7, qinh: 0.1 } },
  victory: { tonic: 50, mode: 'gong', bpm: 64, fadeIn: 0.4, fadeOut: 3, stinger: 'victory', l: { zheng: 0.55, flute: 0.3, qin: 0.4, qinh: 0.3, rest: 0.3 } },
  defeat: { tonic: 45, mode: 'jue', bpm: 50, fadeIn: 0.4, fadeOut: 3, stinger: 'defeat', l: { zheng: 0.2, flute: 0.25, qin: 0.5, qinh: 0.2, rest: 0.5 } },
};

const CELLS = [[2, 1, 1], [1, 1, 2], [3, 1], [1.5, 0.5, 2], [1, 1, 1, 1], [2, 2], [0.5, 0.5, 1, 2], [4]];

export class Music {
  constructor(engine, seed = 1234) {
    this.e = engine;
    this.ctx = engine.ctx;
    this.rnd = rng(seed);
    this.gens = [];
    this.state = 'off';
    this.intensity = 0;
    this.targetIntensity = 0;
    const n = 8, re = new Float32Array(n), im = new Float32Array(n);
    [0, 1, 0.3, 0.11, 0.05, 0.025, 0.012, 0.006].forEach((v, i) => { im[i] = v; });
    this.fluteWave = this.ctx.createPeriodicWave(re, im);
  }

  r(a, b) { return a + (b - a) * this.rnd(); }

  set(state) {
    if (state === this.state) return;
    const now = this.e.now();
    for (const g of this.gens) if (!g.dying) {
      g.dying = true;
      g.dieAt = now + g.cfg.fadeOut * 2.5;
      g.bus.gain.cancelScheduledValues(now);
      g.bus.gain.setValueAtTime(g.bus.gain.value, now);
      g.bus.gain.setTargetAtTime(0, now, g.cfg.fadeOut / 3);
    }
    this.state = state;
    const cfg = MUSIC_STATES[state];
    if (!cfg) return;
    const bus = this.ctx.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.setTargetAtTime(1, now, cfg.fadeIn / 3);
    bus.connect(this.e.buses.music);
    this.gens.push({ cfg, bus, next: now + 0.15, bar: 0, deg: 5, fluteUntil: 0, stinger: !!cfg.stinger, dying: false });
  }

  setIntensity(x) { this.targetIntensity = clamp(+x || 0, 0, 1); }

  scheduleWindow(t0, t1) {
    for (let i = this.gens.length - 1; i >= 0; i--) {
      const g = this.gens[i];
      if (g.dying) {
        if (t0 > g.dieAt) { try { g.bus.disconnect(); } catch (e) { } this.gens.splice(i, 1); }
        continue;
      }
      if (g.next < t0 - 0.05) g.next = t0 + 0.05;
      while (g.next < t1) {
        this.intensity += (this.targetIntensity - this.intensity) * 0.6;
        const len = this.barLen(g);
        this.bar(g, g.next, len / 4);
        g.next += len;
        g.bar++;
      }
    }
  }

  barLen(g) {
    const bpm = g.cfg.battle ? g.cfg.bpm + 26 * this.intensity : g.cfg.bpm;
    return 4 * 60 / bpm;
  }

  midi(g, deg) {
    const m = MODES[g.cfg.mode];
    const o = Math.floor(deg / 5);
    return g.cfg.tonic + 12 * o + m[((deg % 5) + 5) % 5];
  }

  inst(name, midi, t, o = {}) {
    const bases = MUSIC_BASES[name];
    let b = bases[0];
    for (const x of bases) if (Math.abs(x - midi) < Math.abs(b - midi)) b = x;
    const rate = Math.pow(2, (midi - b) / 12);
    return this.e.note('m_' + name + '_' + b, rate, t, o);
  }

  hit(name, t, gain, o = {}) { return this.e.note(name, o.rate || 1, t, { gain, pan: o.pan || 0, bus: o.bus, send: o.send }); }

  walk(g, lo, hi) {
    const x = this.rnd();
    const step = x < 0.55 ? 1 : x < 0.82 ? 2 : x < 0.93 ? 0 : 3;
    let d = g.deg + (this.rnd() < 0.5 ? -step : step);
    if (d < lo) d = lo + (lo - d);
    if (d > hi) d = hi - (d - hi);
    g.deg = clamp(d, lo, hi);
    return g.deg;
  }

  zhengPhrase(g, t, beat, level) {
    const cell = CELLS[Math.floor(this.rnd() * CELLS.length)];
    let x = 0;
    cell.forEach((dur, i) => {
      const deg = this.walk(g, 4, 12);
      const m = this.midi(g, deg);
      const tt = t + x * beat + this.r(-0.01, 0.01);
      const vel = level * this.r(0.28, 0.5) * (i === 0 ? 1.15 : 1);
      const pan = this.r(-0.4, -0.1);
      const orn = this.rnd();
      if (orn < 0.18 && dur >= 1) {
        const below = this.midi(g, deg - 1);
        this.inst('zheng', below, tt, { gain: vel, pan, bus: g.bus, bend: [0.06, m - below, 0.12] });
      } else if (orn < 0.3 && dur >= 1.5) {
        this.inst('zheng', m, tt, { gain: vel, pan, bus: g.bus, bend: [dur * beat * 0.45, 0.5, 0.2], bendBack: [0.05, 0.2] });
      } else if (orn < 0.4) {
        this.inst('zheng', m - 12, tt - 0.06, { gain: vel * 0.6, pan, bus: g.bus });
        this.inst('zheng', m, tt, { gain: vel, pan, bus: g.bus });
      } else {
        this.inst('zheng', m, tt, { gain: vel, pan, bus: g.bus });
      }
      x += dur;
    });
  }

  flutePhrase(g, t, beat, level) {
    const notes = [];
    let x = 0;
    const len = 4 + Math.floor(this.rnd() * 5);
    let deg = 5 + Math.floor(this.rnd() * 4);
    for (let i = 0; i < len; i++) {
      const last = i === len - 1;
      const dur = last ? this.r(2, 4) : [0.5, 1, 1, 1.5, 2][Math.floor(this.rnd() * 5)];
      const x2 = this.rnd();
      deg += x2 < 0.6 ? (this.rnd() < 0.5 ? -1 : 1) : x2 < 0.85 ? (this.rnd() < 0.5 ? -2 : 2) : 0;
      deg = clamp(deg, 5, 12);
      if (last && deg % 5 !== 0 && deg % 5 !== 3) deg += deg % 5 < 3 ? -(deg % 5) : 3 - (deg % 5);
      notes.push({ m: this.midi(g, deg) + (g.cfg.tonic < 50 ? 12 : 0), t: t + x * beat, dur: Math.max(0.3, dur * beat) });
      x += dur;
    }
    this.flute(notes, g.bus, level * 0.2, this.r(0.1, 0.35));
    return t + x * beat;
  }

  flute(notes, bus, gain = 0.2, pan = 0.2) {
    const ctx = this.ctx;
    const start = notes[0].t, last = notes[notes.length - 1], end = last.t + last.dur;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.fluteWave);
    const lfo = ctx.createOscillator(); lfo.frequency.value = this.r(4.8, 5.6);
    const vib = ctx.createGain(); vib.gain.value = 0;
    lfo.connect(vib); vib.connect(osc.detune);
    const amp = ctx.createGain(); amp.gain.value = 0;
    const noise = ctx.createBufferSource(); noise.buffer = this.e.noise; noise.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 5;
    const bg = ctx.createGain(); bg.gain.value = 0.1;
    const air = ctx.createBiquadFilter(); air.type = 'highpass'; air.frequency.value = 5000;
    const ag = ctx.createGain(); ag.gain.value = 0.012;
    noise.connect(bp); bp.connect(bg); bg.connect(amp);
    noise.connect(air); air.connect(ag); ag.connect(amp);
    const tone = ctx.createGain(); tone.gain.value = 1;
    osc.connect(tone); tone.connect(amp);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5200; lp.Q.value = 0.5;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    const send = ctx.createGain(); send.gain.value = 0.35;
    amp.connect(lp); lp.connect(p); p.connect(bus); p.connect(send); send.connect(this.e.reverb);
    let prev = null;
    notes.forEach((n, i) => {
      const f = mtof(n.m);
      if (i === 0) {
        osc.frequency.setValueAtTime(f * 0.985, n.t);
        osc.frequency.exponentialRampToValueAtTime(f, n.t + 0.07);
        amp.gain.setValueAtTime(0, n.t);
        amp.gain.linearRampToValueAtTime(gain * 0.8, n.t + 0.09);
        amp.gain.linearRampToValueAtTime(gain, n.t + 0.25);
      } else {
        osc.frequency.setValueAtTime(prev, n.t - 0.05);
        osc.frequency.exponentialRampToValueAtTime(f, n.t + 0.03);
        amp.gain.setValueAtTime(gain, n.t - 0.04);
        amp.gain.linearRampToValueAtTime(gain * 0.7, n.t);
        amp.gain.linearRampToValueAtTime(gain, n.t + 0.07);
      }
      bp.frequency.setValueAtTime(f, n.t);
      bg.gain.setValueAtTime(0.32, n.t);
      bg.gain.setTargetAtTime(0.1, n.t, 0.05);
      vib.gain.setValueAtTime(0, n.t);
      if (n.dur > 0.6) {
        vib.gain.setValueAtTime(0, n.t + n.dur * 0.35);
        vib.gain.linearRampToValueAtTime(16, n.t + n.dur * 0.85);
      }
      prev = f;
    });
    amp.gain.setValueAtTime(gain, end - Math.min(0.6, last.dur * 0.6));
    amp.gain.linearRampToValueAtTime(gain * 0.55, end - 0.05);
    amp.gain.linearRampToValueAtTime(0, end + 0.12);
    for (const s of [osc, lfo, noise]) { if (s === noise) s.start(Math.max(0, start - 0.01), this.rnd() * 1.5); else s.start(Math.max(0, start - 0.01)); s.stop(end + 0.25); }
    osc.onended = () => { try { p.disconnect(); send.disconnect(); } catch (e) { } };
  }

  qin(g, t, level, beat) {
    const deg = this.rnd() < 0.7 ? 0 : 3;
    const m = this.midi(g, deg) - 12;
    const o = { gain: level * 0.55, pan: -0.1, bus: g.bus };
    if (this.rnd() < 0.3) { o.bend = [beat * 1.5, -0.6, 0.25]; o.bendBack = [0.05, 0.3]; }
    this.inst('qin', m, t, o);
  }

  qinh(g, t, beat, level) {
    const n = 1 + Math.floor(this.rnd() * 2);
    for (let i = 0; i < n; i++) {
      const deg = 10 + Math.floor(this.rnd() * 5);
      this.inst('qinh', this.midi(g, deg), t + Math.floor(this.rnd() * 4) * beat, { gain: level * 0.22, pan: this.r(-0.5, 0.5), bus: g.bus, send: 0.2 });
    }
  }

  pipa(g, t, beat, level) {
    const pat = [0, 0, 3, 0, 4, 0, 3, 2];
    pat.forEach((d, i) => {
      const m = this.midi(g, d) + (g.cfg.tonic < 48 ? 12 : 0);
      this.inst('pipa', m, t + i * beat / 2 + this.r(-0.006, 0.006), { gain: level * (i % 2 ? 0.14 : 0.24), pan: 0.3, bus: g.bus, stopAt: t + (i + 1) * beat / 2 + 0.05 });
    });
  }

  stinger(g, t, beat) {
    if (g.cfg.stinger === 'victory') {
      this.hit('m_taiko_lo', t, 0.7, { bus: g.bus });
      for (let i = 0; i < 11; i++) this.inst('zheng', this.midi(g, 2 + i), t + 0.05 + i * 0.06, { gain: 0.3, pan: -0.2, bus: g.bus });
      const degs = [5, 7, 8, 7, 10];
      const durs = [0.5, 0.5, 0.5, 0.5, 3];
      let x = t + 0.9;
      this.flute(degs.map((d, i) => { const n = { m: this.midi(g, d) + 12, t: x, dur: durs[i] * beat * 1.4 }; x += n.dur; return n; }), g.bus, 0.22, 0.2);
      g.fluteUntil = x + 1;
    } else {
      this.hit('m_taiko_lo', t, 0.6, { bus: g.bus });
      this.inst('qin', this.midi(g, 0) - 12, t + 0.02, { gain: 0.6, bus: g.bus, bend: [1.2, -1, 0.8] });
      const degs = [9, 8, 7, 5];
      let x = t + 1.2;
      this.flute(degs.map((d, i) => { const n = { m: this.midi(g, d) + 12, t: x, dur: (i === 3 ? 3.5 : 1.2) * beat }; x += n.dur; return n; }), g.bus, 0.2, 0.15);
      g.fluteUntil = x + 1;
    }
  }

  battleDrums(g, t, beat, I) {
    const e = beat / 2;
    const hum = () => this.r(-0.008, 0.008);
    const h = (n, tt, gain, pan = 0) => this.e.note(n, 1, tt, { gain, pan, bus: g.bus });
    const lv = 0.4 + 0.6 * I;
    if (I > 0.03) h('m_taiko_lo', t, 0.6 * lv);
    if (I > 0.35) h('m_taiko_lo', t + 4 * e + hum(), 0.45 * lv);
    if (I > 0.7) { h('m_taiko_lo', t + 6 * e + hum(), 0.35 * lv); h('m_taiko_lo', t + 7 * e + hum(), 0.45 * lv); }
    if (I > 0.45) for (const s of [2, 6]) if (this.rnd() < 0.85) h('m_taiko_mid', t + s * e + hum(), 0.35 * lv, 0.2);
    if (I > 0.25) for (const s of [3, 7]) h('m_wood', t + s * e + hum(), 0.12 * lv, -0.3);
    const p = I * I * 0.6;
    for (let s = 0; s < 8; s++) if (this.rnd() < p) h('m_drum_hi', t + s * e + hum(), (s % 2 ? 0.1 : 0.18) * lv, 0.35);
    if (I > 0.6 && g.bar % 4 === 3) for (let s = 0; s < 8; s++) h('m_taiko_mid', t + 4 * e + s * e / 2 + hum(), (0.12 + 0.03 * s) * lv, 0.1);
  }

  bar(g, t, beat) {
    const L = g.cfg.l;
    const bus = g.bus;
    if (g.stinger) {
      g.stinger = false;
      this.stinger(g, t, beat);
      if (L.qin) this.qinh(g, t + 2 * beat, beat, 0.6);
      return;
    }
    if (g.cfg.battle) {
      const I = this.intensity;
      this.battleDrums(g, t, beat, I);
      if (g.bar % 2 === 0) this.qin(g, t, 0.8, beat);
      const pl = 0.25 + 0.75 * smoothstep(0.1, 0.8, I);
      this.pipa(g, t, beat, pl);
      if (I > 0.8 && this.rnd() < 0.5) this.pipa(g, t + beat * 0.25, beat, pl * 0.4);
      if (this.rnd() < 0.4 * (1 - 0.6 * I)) this.zhengPhrase(g, t, beat, 0.8);
      if (t >= g.fluteUntil && this.rnd() < 0.18 * (1 - I)) g.fluteUntil = this.flutePhrase(g, t + beat, beat, 0.8) + beat;
      return;
    }
    const rest = this.rnd() < (L.rest || 0);
    if (L.qin && g.bar % 2 === 0 && this.rnd() < L.qin + 0.2) this.qin(g, t, 0.9, beat);
    if (L.drums) {
      this.e.note('m_taiko_lo', 1, t, { gain: 0.45 * L.drums * 1.6, bus });
      if (this.rnd() < 0.5) this.e.note('m_taiko_lo', 1, t + 2 * beat, { gain: 0.2 * L.drums * 1.6, bus });
      this.e.note('m_wood', 1, t + 3.5 * beat, { gain: 0.1, pan: -0.3, bus });
    }
    if (L.pipa) this.pipa(g, t, beat, L.pipa);
    if (rest) return;
    if (L.qinh && this.rnd() < L.qinh) this.qinh(g, t, beat, 1);
    if (t >= g.fluteUntil && L.flute && this.rnd() < L.flute) {
      g.fluteUntil = this.flutePhrase(g, t + beat * Math.floor(this.rnd() * 2), beat, 1) + beat * 2;
      return;
    }
    if (L.zheng && this.rnd() < L.zheng) this.zhengPhrase(g, t, beat, t < g.fluteUntil ? 0.6 : 1);
  }
}
