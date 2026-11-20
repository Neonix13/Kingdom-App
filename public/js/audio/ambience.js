import { clamp, smoothstep, dbToGain, rng } from './dsp.js';

const BEDS = {
  amb_wind_low: { level: -15, ground: false },
  amb_wind_whistle: { level: -27, ground: false },
  amb_forest: { level: -24, ground: true, panKey: 'forestPan' },
  amb_river: { level: -18, ground: true, panKey: 'waterPan' },
  amb_crickets: { level: -30, ground: true, panKey: 'forestPan' },
  amb_murmur: { level: -33, ground: true, panKey: 'villagePan' },
};

const EVENTS = {
  amb_bird: { level: -24, dist: [0.15, 0.85], panKey: 'forestPan' },
  amb_owl: { level: -24, dist: [0.3, 0.8], panKey: 'forestPan' },
  amb_hammer: { level: -31, dist: [0.45, 0.85], panKey: 'villagePan' },
  amb_chicken: { level: -34, dist: [0.5, 0.9], panKey: 'villagePan' },
};

export class Ambience {
  constructor(engine, o = {}) {
    this.e = engine;
    this.rnd = rng(o.seed ?? 4242);
    this.range = o.cameraHeightRange || [3, 150];
    this.p = { enabled: false, timeOfDay: 12, nearWater: 0, nearForest: 0, nearVillage: 0, cameraHeight: null, waterPan: 0, forestPan: 0, villagePan: 0 };
    this.beds = {};
    this.next = {};
    this.applied = {};
    this.mix = null;
  }

  set(params = {}) {
    for (const k of Object.keys(this.p)) if (params[k] != null && (k === 'enabled' || Number.isFinite(+params[k]))) this.p[k] = k === 'enabled' ? !!params[k] : +params[k];
  }

  heightNorm() {
    const h = this.p.cameraHeight;
    if (h == null) return 0.3;
    const [a, b] = this.range;
    return clamp(Math.log(Math.max(h, a) / a) / Math.log(b / a), 0, 1);
  }

  compute() {
    const p = this.p;
    const t = ((p.timeOfDay % 24) + 24) % 24;
    const sun = smoothstep(5, 7, t) * (1 - smoothstep(18.5, 20.5, t));
    const night = 1 - sun;
    const g = (x, c, s) => Math.exp(-(((x - c) / s) ** 2));
    const dawn = g(t, 6.5, 1.3) + 0.5 * g(t, 19, 1);
    const h = this.heightNorm();
    const ground = 1 - 0.75 * h;
    const W = clamp(p.nearWater, 0, 1), F = clamp(p.nearForest, 0, 1), V = clamp(p.nearVillage, 0, 1);
    const on = p.enabled ? 1 : 0;
    const social = smoothstep(6.5, 8.5, t) * (1 - smoothstep(21, 23, t));
    return {
      lp: 16000 * Math.pow(0.1, h),
      near: { amb_forest: F, amb_river: W, amb_crickets: 0.5 + 0.5 * F, amb_murmur: V },
      beds: {
        amb_wind_low: on * (0.45 + 0.55 * h) * (1 + 0.15 * night),
        amb_wind_whistle: on * (0.12 + 0.88 * h * h),
        amb_forest: on * F * ground,
        amb_river: on * W * ground,
        amb_crickets: on * night * ground * (0.55 + 0.45 * F) * (1 - 0.5 * V),
        amb_murmur: on * V * ground * (0.25 + 0.75 * social),
      },
      rates: {
        amb_bird: on * sun * (0.06 + 0.3 * dawn) * (0.35 + 0.65 * F) * ground,
        amb_owl: on * night * ground * (F / 22 + 1 / 140),
        amb_hammer: on * V * sun * ground / 9,
        amb_chicken: on * V * sun * ground / 45,
      },
    };
  }

  ensureBed(name) {
    if (this.beds[name] || !this.e.bank.has(name)) return this.beds[name];
    const ctx = this.e.ctx;
    const buf = this.e.bank.get(name)[0];
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.5; lp.frequency.value = 16000;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    src.connect(lp); lp.connect(gain); gain.connect(pan); pan.connect(this.e.buses.amb);
    src.start(this.e.now(), this.rnd() * buf.duration);
    this.beds[name] = { src, lp, gain, pan };
    return this.beds[name];
  }

  setParam(key, param, value, tc, immediate) {
    const prev = this.applied[key];
    if (!immediate && prev != null && Math.abs(prev - value) <= Math.max(0.002, Math.abs(prev) * 0.02)) return;
    this.applied[key] = value;
    const t = this.e.now();
    if (immediate) { param.setValueAtTime(value, t); return; }
    param.setTargetAtTime(value, t, tc);
  }

  update(immediate = false) {
    const m = this.compute();
    this.mix = m;
    for (const [name, cfg] of Object.entries(BEDS)) {
      const target = m.beds[name] * dbToGain(cfg.level);
      if (target < 1e-4 && !this.beds[name]) continue;
      const b = this.ensureBed(name);
      if (!b) { this.e.bank.render(name); continue; }
      this.setParam(name, b.gain.gain, target, 1.2, immediate);
      if (cfg.ground) this.setParam(name + ':lp', b.lp.frequency, m.lp * Math.pow(0.12, 1 - clamp(m.near[name] ?? 1, 0, 1)), 1.2, immediate);
      if (cfg.panKey) this.setParam(name + ':pan', b.pan.pan, clamp(this.p[cfg.panKey], -1, 1) * 0.7, 0.8, immediate);
    }
  }

  scheduleWindow(t0, t1) {
    const m = this.mix || this.compute();
    for (const [name, cfg] of Object.entries(EVENTS)) {
      const rate = m.rates[name];
      if (!(rate > 1e-4)) { this.next[name] = null; continue; }
      if (this.next[name] == null || this.next[name] < t0 - 1) this.next[name] = t0 + this.expo(rate);
      while (this.next[name] < t1) {
        const t = this.next[name];
        const pc = clamp(this.p[cfg.panKey] || 0, -1, 1);
        const dist = cfg.dist[0] + (cfg.dist[1] - cfg.dist[0]) * this.rnd();
        this.e.play(name, { pan: clamp(pc * 0.6 + (this.rnd() * 2 - 1) * 0.7, -1, 1), distance: dist, volume: dbToGain(cfg.level + 12), bus: 'amb' }, t);
        this.next[name] = t + this.expo(rate);
      }
    }
  }

  expo(rate) { return Math.max(0.4, -Math.log(1 - this.rnd()) / rate); }

  stop() {
    for (const b of Object.values(this.beds)) {
      try { b.src.stop(); b.pan.disconnect(); } catch (e) { }
    }
    this.beds = {};
    this.applied = {};
  }
}
