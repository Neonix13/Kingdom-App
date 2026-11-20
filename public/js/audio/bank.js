import { ALL, SFX, AMB, MUS } from './recipes.js';
import { Kit } from './kit.js';
import { rng, hashSeed, removeDC } from './dsp.js';

const FIRST = ['ui_click', 'ui_hover', 'select_unit', 'ping', 'notification', 'deploy_place', 'hit_impact', 'attack_clash'];

export class Bank {
  constructor({ sampleRate = 32000 } = {}) {
    this.sampleRate = sampleRate;
    this.buffers = new Map();
    this.pending = new Map();
    this.order = [...new Set([...FIRST, ...Object.keys(AMB), ...Object.keys(MUS), ...Object.keys(SFX)])];
    this._warm = null;
  }

  meta(name) { return ALL[name]; }
  has(name) { return this.buffers.has(name); }
  get(name) { return this.buffers.get(name); }
  names() { return Object.keys(ALL); }

  render(name) {
    if (this.buffers.has(name)) return Promise.resolve(this.buffers.get(name));
    if (this.pending.has(name)) return this.pending.get(name);
    const r = ALL[name];
    if (!r) return Promise.reject(new Error('Son inconnu : ' + name));
    const p = (async () => {
      const list = [];
      for (let v = 0; v < (r.variants || 1); v++) list.push(await this._renderOne(name, r, v));
      this.buffers.set(name, list);
      this.pending.delete(name);
      return list;
    })();
    p.catch((e) => { this.pending.delete(name); console.warn('[audio] rendu échoué', name, e); });
    this.pending.set(name, p);
    return p;
  }

  warm(names = this.order) {
    if (this._warm && names === this.order) return this._warm;
    const run = (async () => {
      for (const n of names) {
        try { await this.render(n); } catch (e) { }
        await new Promise((res) => setTimeout(res, 0));
      }
    })();
    if (names === this.order) this._warm = run;
    return run;
  }

  async _renderOne(name, r, v) {
    const sr = Math.min(r.rate || this.sampleRate, this.sampleRate);
    const ch = r.ch || 1;
    const xf = r.loop ? (r.xf ?? 0.5) : 0;
    const total = Math.ceil((r.dur + xf) * sr);
    const ctx = new OfflineAudioContext(ch, total, sr);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 22; hp.Q.value = 0.6;
    hp.connect(ctx.destination);
    const k = new Kit(ctx, hp, rng(hashSeed(name + ':' + v)), ch);
    r.build(k, v);
    const rendered = await ctx.startRendering();
    let chans = [];
    for (let c = 0; c < ch; c++) chans.push(rendered.getChannelData(c).slice());
    chans.forEach(removeDC);
    if (r.loop) {
      const N = Math.floor(r.dur * sr), X = Math.floor(xf * sr);
      chans = chans.map((y) => {
        const o = y.slice(0, N);
        for (let i = 0; i < X; i++) {
          const w = (i / X) * Math.PI / 2;
          o[i] = y[i] * Math.sin(w) + y[N + i] * Math.cos(w);
        }
        return o;
      });
    } else {
      let peak = 0;
      for (const y of chans) for (let i = 0; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]));
      const thr = peak * 0.0004;
      let last = 0;
      for (const y of chans) for (let i = y.length - 1; i > last; i--) if (Math.abs(y[i]) > thr) { last = i; break; }
      const len = Math.min(total, last + Math.floor(0.03 * sr));
      chans = chans.map((y) => y.slice(0, len));
      const fo = Math.min(len, Math.floor(0.02 * sr)), fi = Math.min(len, Math.floor(0.0008 * sr));
      for (const y of chans) {
        for (let i = 0; i < fo; i++) y[len - 1 - i] *= i / fo;
        for (let i = 0; i < fi; i++) y[i] *= i / fi;
      }
    }
    let peak = 0;
    for (const y of chans) for (let i = 0; i < y.length; i++) {
      if (!Number.isFinite(y[i])) y[i] = 0;
      peak = Math.max(peak, Math.abs(y[i]));
    }
    const s = peak > 0 ? 0.891 / peak : 1;
    for (const y of chans) for (let i = 0; i < y.length; i++) y[i] *= s;
    const buf = new AudioBuffer({ numberOfChannels: ch, length: chans[0].length, sampleRate: sr });
    chans.forEach((y, i) => buf.copyToChannel(y, i));
    return buf;
  }
}

let shared = null;
export function sharedBank(sampleRate = 32000) {
  if (!shared || shared.sampleRate !== sampleRate) shared = new Bank({ sampleRate });
  return shared;
}
