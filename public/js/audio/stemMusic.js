import { layerGains } from './stemLayout.js';

// Music rendered in a DAW (scripts/music-phrases.mjs → DAW → scripts/music-import.mjs), played as random phrases on the bar grid.
export async function loadStemLibrary(ctx, base = '/audio/music/') {
  try {
    const r = await fetch(base + 'manifest.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    const m = await r.json();
    if (!m || !m.states || !Object.keys(m.states).length) return null;
    return new StemLibrary(ctx, base, m);
  } catch (e) { return null; }
}

export class StemLibrary {
  constructor(ctx, base, manifest) { this.ctx = ctx; this.base = base; this.m = manifest; }
  has(state) { const s = this.m.states[state]; return !!(s && s.phrases > 0 && s.layers && s.layers.length); }
  cfg(state) { return this.m.states[state]; }
  url(state, layer, which) {
    const s = this.cfg(state);
    return `${this.base}${s.folder}/${layer}-${which === 'intro' ? 'intro' : String(which).padStart(2, '0')}.${s.ext || 'm4a'}`;
  }
  async load(state, which) {
    const s = this.cfg(state);
    const pairs = await Promise.all(s.layers.map(async (layer) => {
      const r = await fetch(this.url(state, layer, which));
      if (!r.ok) throw new Error(`${r.status} ${this.url(state, layer, which)}`);
      return [layer, await this.ctx.decodeAudioData(await r.arrayBuffer())];
    }));
    return Object.fromEntries(pairs);
  }
}

// One playing state: loads the next phrase while the current one plays, starts it on the bar grid, mixes layers by intensity.
export class StemTrack {
  constructor(music, lib, state, bus) {
    this.music = music;
    this.lib = lib;
    this.state = state;
    this.s = lib.cfg(state);
    this.ctx = music.ctx;
    this.barSec = 240 / this.s.bpm;
    this.layers = {};
    for (const l of this.s.layers) { const g = this.ctx.createGain(); g.gain.value = 0; g.connect(bus); this.layers[l] = g; }
    this.recent = [];
    this.sources = [];
    this.next = null;
    this.ready = null;
    this.pending = null;
    this.failures = 0;
    this.played = [];
    this.applyGains(true);
    this.queue(this.s.intro ? 'intro' : this.pick());
  }

  pick() {
    const n = this.s.phrases;
    const avoid = Math.min(Math.floor(n / 2), 6);
    let i, guard = 0;
    do { i = 1 + Math.floor(this.music.rnd() * n); } while (this.recent.includes(i) && guard++ < 30);
    this.recent.push(i);
    if (this.recent.length > avoid) this.recent.shift();
    return i;
  }

  queue(which) {
    this.ready = null;
    const p = this.lib.load(this.state, which).then(
      (buffers) => { if (this.pending === p) this.ready = { which, buffers }; },
      (e) => {
        if (this.pending !== p) return;
        console.warn('[audio] phrase introuvable', e.message);
        if (++this.failures < 4) this.queue(this.pick());
      });
    this.pending = p;
  }

  applyGains(immediate) {
    const g = layerGains(this.state, this.music.targetIntensity);
    const t = this.ctx.currentTime;
    for (const [l, node] of Object.entries(this.layers)) {
      const v = (g[l] ?? 1) * (this.s.gain ?? 1);
      if (immediate) node.gain.setValueAtTime(v, t);
      else node.gain.setTargetAtTime(v, t, 1.5);
    }
  }

  schedule(t0, t1) {
    this.applyGains(false);
    if (!this.ready) return;
    const pre = this.s.preRoll || 0;
    const now = this.ctx.currentTime;
    if (this.next == null || this.next - pre < now - 0.02) this.next = Math.max(t0, now) + pre + 0.05;
    const start = this.next - pre;
    if (start >= t1) return;
    const off = Math.max(0, now - start);
    for (const [l, buf] of Object.entries(this.ready.buffers)) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.layers[l]);
      src.start(Math.max(now, start), off);
      src.onended = () => {
        const i = this.sources.indexOf(src);
        if (i >= 0) this.sources.splice(i, 1);
        try { src.disconnect(); } catch (e) { }
      };
      this.sources.push(src);
    }
    this.played.push({ which: this.ready.which, at: this.next });
    if (this.played.length > 32) this.played.shift();
    this.next += (this.ready.which === 'intro' ? this.s.intro.bars : this.s.phraseBars) * this.barSec;
    this.queue(this.pick());
  }

  stop() {
    this.pending = null;
    for (const src of this.sources) { try { src.stop(); src.disconnect(); } catch (e) { } }
    this.sources = [];
    for (const g of Object.values(this.layers)) { try { g.disconnect(); } catch (e) { } }
  }
}
