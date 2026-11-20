import { softClipCurve, reverbIR, rng, dbToGain, clamp } from './dsp.js';

const MAX_SFX = 28;
const MAX_MUSIC = 64;

export class Engine {
  constructor(ctx, bank) {
    this.ctx = ctx;
    this.bank = bank;
    this.vnow = null;
    this.rnd = rng(0x5eed ^ Math.floor(Math.random() * 1e9));
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };

    this.master = g(0.64);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 6;
    comp.attack.value = 0.004; comp.release.value = 0.25;
    const pre = g(0.5);
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve(0.88);
    shaper.oversample = 'none';
    this.master.connect(comp); comp.connect(pre); pre.connect(shaper); shaper.connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = reverbIR(ctx, 2.6, rng(77));
    const rvOut = g(0.5);
    this.reverb.connect(rvOut); rvOut.connect(this.master);

    this.buses = {};
    for (const [name, send] of [['music', 0.32], ['sfx', 0.12], ['amb', 0.1]]) {
      const bus = g(1);
      bus.connect(this.master);
      const s = g(send);
      bus.connect(s); s.connect(this.reverb);
      this.buses[name] = bus;
    }
    this.sfxVoices = [];
    this.musicVoices = [];
    this.loops = new Map();
    this.loopId = 0;
    this.lastPlay = {};
    this.lastVariant = {};
    const nl = Math.floor(ctx.sampleRate * 2);
    this.noise = ctx.createBuffer(1, nl, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nl; i++) nd[i] = this.rnd() * 2 - 1;
  }

  now() { return this.vnow ?? this.ctx.currentTime; }

  ramp(param, value, tc = 0.05, at) {
    const t = at ?? this.now();
    if (this.vnow != null) { param.setValueAtTime(value, t); return; }
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.setTargetAtTime(value, t, tc);
  }

  setVolumes({ master, music, sfx, ambience, muted }, tc = 0.08) {
    const sq = (v) => clamp(v, 0, 1) ** 2;
    this.ramp(this.master.gain, muted ? 0 : sq(master) * 2, tc);
    this.ramp(this.buses.music.gain, sq(music), tc);
    this.ramp(this.buses.sfx.gain, sq(sfx), tc);
    this.ramp(this.buses.amb.gain, sq(ambience), tc);
  }

  pickVariant(name, list) {
    if (list.length === 1) return list[0];
    let i = Math.floor(this.rnd() * list.length);
    if (i === this.lastVariant[name]) i = (i + 1) % list.length;
    this.lastVariant[name] = i;
    return list[i];
  }

  voice(buffer, o) {
    const ctx = this.ctx;
    const t = o.when ?? this.now();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = !!o.loop;
    src.playbackRate.value = o.rate || 1;
    const d = clamp(o.distance || 0, 0, 1);
    let node = src;
    let lp = null;
    if (d > 0.02 || o.lowpass) {
      lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.lowpass || 16000 * Math.pow(0.07, d);
      lp.Q.value = 0.5;
      node.connect(lp); node = lp;
    }
    const gain = ctx.createGain();
    const level = (o.gain ?? 1) / (1 + 4 * Math.pow(d, 1.5));
    if (o.fadeIn) {
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(level, t + o.fadeIn);
    } else gain.gain.value = level;
    node.connect(gain);
    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp(o.pan || 0, -1, 1);
    gain.connect(pan);
    pan.connect(o.bus || this.buses.sfx);
    let send = null;
    const sendAmt = (o.send || 0) + 0.35 * d;
    if (sendAmt > 0.005) {
      send = ctx.createGain();
      send.gain.value = sendAmt;
      pan.connect(send); send.connect(this.reverb);
    }
    src.start(t, o.offset || 0);
    const v = { src, gain, pan, lp, send, t, name: o.name, level, end: o.loop ? Infinity : t + buffer.duration / (o.rate || 1) };
    src.onended = () => {
      v.done = true;
      try { pan.disconnect(); send && send.disconnect(); } catch (e) { }
    };
    return v;
  }

  kill(v, fade = 0.03) {
    if (v.done || v.killed) return;
    v.killed = true;
    const t = this.now();
    try {
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0, t + fade);
      v.src.stop(t + fade + 0.01);
    } catch (e) { }
  }

  oldestStarted(list) {
    const t = this.now();
    let best = null;
    for (const v of list) if (v.t <= t && !v.killed && (!best || v.t < best.t)) best = v;
    return best;
  }

  prune(list) {
    const t = this.now();
    for (let i = list.length - 1; i >= 0; i--) if (list[i].done || list[i].killed || list[i].end < t) list.splice(i, 1);
  }

  play(name, o = {}, when) {
    const meta = this.bank.meta(name);
    if (!meta) { console.warn('[audio] son inconnu', name); return null; }
    const list = this.bank.get(name);
    if (!list) { this.bank.render(name); return null; }
    const t = when ?? this.now();
    if (meta.minInterval && this.lastPlay[name] != null && t - this.lastPlay[name] < meta.minInterval && t >= this.lastPlay[name]) return null;
    this.lastPlay[name] = t;
    this.prune(this.sfxVoices);
    const same = this.sfxVoices.filter((v) => v.name === name);
    if (same.length >= (meta.maxVoices || 4)) { const v = this.oldestStarted(same); if (v) this.kill(v); }
    if (this.sfxVoices.length >= MAX_SFX) { const v = this.oldestStarted(this.sfxVoices); if (v) this.kill(v); }
    const jitter = meta.detune ?? 0.03;
    const v = this.voice(this.pickVariant(name, list), {
      name, when: t, pan: o.pan, distance: o.distance,
      gain: dbToGain(meta.level ?? -12) * (o.volume ?? 1),
      rate: (o.rate || 1) * (1 + (this.rnd() * 2 - 1) * jitter),
      send: meta.send || 0, bus: o.bus ? this.buses[o.bus] : this.buses.sfx,
    });
    this.sfxVoices.push(v);
    return v;
  }

  startLoop(name, o = {}) {
    const meta = this.bank.meta(name);
    if (!meta) { console.warn('[audio] son inconnu', name); return null; }
    const id = ++this.loopId;
    const entry = { id, name, o: { ...o }, v: null, stopped: false };
    this.loops.set(id, entry);
    const begin = (list) => {
      if (entry.stopped || entry.v) return;
      const buf = list[0];
      entry.v = this.voice(buf, {
        name, loop: true, pan: o.pan, distance: o.distance, offset: this.rnd() * buf.duration,
        gain: dbToGain(meta.level ?? -12) * (o.volume ?? 1), fadeIn: o.fadeIn ?? 0.4,
        bus: o.bus ? this.buses[o.bus] : this.buses.sfx, send: meta.send || 0, lowpass: 16000 * Math.pow(0.07, clamp(o.distance || 0, 0, 1)),
        rate: o.rate || 1,
      });
    };
    const list = this.bank.get(name);
    if (list) begin(list); else this.bank.render(name).then(begin, () => { });
    return id;
  }

  updateLoop(id, o = {}) {
    const e = this.loops.get(id);
    if (!e) return;
    Object.assign(e.o, o);
    if (!e.v) return;
    const meta = this.bank.meta(e.name);
    const d = clamp(e.o.distance || 0, 0, 1);
    if (o.pan != null) this.ramp(e.v.pan.pan, clamp(o.pan, -1, 1), 0.1);
    if (o.volume != null || o.distance != null) this.ramp(e.v.gain.gain, dbToGain(meta.level ?? -12) * (e.o.volume ?? 1) / (1 + 4 * Math.pow(d, 1.5)), 0.15);
    if (o.distance != null && e.v.lp) this.ramp(e.v.lp.frequency, 16000 * Math.pow(0.07, d), 0.15);
    if (o.rate != null) this.ramp(e.v.src.playbackRate, o.rate, 0.2);
  }

  stopLoop(id, fade = 0.6) {
    const e = this.loops.get(id);
    if (!e) return;
    e.stopped = true;
    this.loops.delete(id);
    if (e.v) this.kill(e.v, fade);
  }

  stopAllLoops(fade = 0.4) { for (const id of [...this.loops.keys()]) this.stopLoop(id, fade); }

  note(name, rate, t, o = {}) {
    const list = this.bank.get(name);
    if (!list) { this.bank.render(name); return null; }
    this.prune(this.musicVoices);
    if (this.musicVoices.length >= MAX_MUSIC) { const v = this.oldestStarted(this.musicVoices); if (v) this.kill(v, 0.08); }
    const v = this.voice(list[0], { name, when: t, rate, pan: o.pan, gain: o.gain ?? 0.5, bus: o.bus || this.buses.music, send: o.send || 0, distance: o.distance });
    if (o.bend) {
      const [at, semis, dur] = o.bend;
      const r2 = rate * Math.pow(2, semis / 12);
      v.src.playbackRate.setValueAtTime(rate, t + at);
      v.src.playbackRate.linearRampToValueAtTime(r2, t + at + dur);
      if (o.bendBack) {
        v.src.playbackRate.setValueAtTime(r2, t + at + dur + o.bendBack[0]);
        v.src.playbackRate.linearRampToValueAtTime(rate, t + at + dur + o.bendBack[0] + o.bendBack[1]);
      }
    }
    if (o.stopAt) { v.gain.gain.setTargetAtTime(0, o.stopAt, 0.03); v.src.stop(o.stopAt + 0.2); }
    this.musicVoices.push(v);
    return v;
  }
}
