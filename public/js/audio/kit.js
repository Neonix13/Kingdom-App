import { noiseBuffer, rr, makeBuffer, ksPluck } from './dsp.js';

export class Kit {
  constructor(ctx, out, rnd, nch = 1) {
    this.ctx = ctx;
    this.out = out;
    this.rnd = rnd;
    this.sr = ctx.sampleRate;
    this.nb = {};
    if (nch === 2) {
      const m = ctx.createChannelMerger(2);
      m.connect(out);
      this.L = this.g(1); this.L.connect(m, 0, 0);
      this.R = this.g(1); this.R.connect(m, 0, 1);
    }
  }

  r(a, b) { return rr(this.rnd, a, b); }

  nbuf(type) {
    if (!this.nb[type]) this.nb[type] = noiseBuffer(this.ctx, 3, type, this.rnd);
    return this.nb[type];
  }

  src(type, t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.nbuf(type);
    s.loop = true;
    s.start(t, this.rnd() * 2.5);
    s.stop(t + dur + 0.05);
    return s;
  }

  g(v = 1) { const n = this.ctx.createGain(); n.gain.value = v; return n; }

  f(type, freq, Q = 0.707, gain = 0) {
    const n = this.ctx.createBiquadFilter();
    n.type = type; n.frequency.value = freq; n.Q.value = Q; n.gain.value = gain;
    return n;
  }

  pan(p, dest) {
    const n = this.ctx.createStereoPanner();
    n.pan.value = Math.max(-1, Math.min(1, p));
    n.connect(dest || this.out);
    return n;
  }

  chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[0];
  }

  env(param, t, a, d, peak, hold = 0) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    if (hold > 0) param.setValueAtTime(peak, t + a + hold);
    param.setTargetAtTime(0, t + a + hold, d / 6.9);
  }

  burst(t, o = {}) {
    t = Math.max(0, t);
    const a = o.a ?? 0.002, d = o.d ?? 0.1, hold = o.hold ?? 0;
    const s = this.src(o.type || 'white', t, a + hold + d * 1.2);
    const g = this.g(0);
    this.env(g.gain, t, a, d, o.amp ?? 1, hold);
    let node = s;
    for (const [ft, fr, q, gn] of (o.filt || [['bandpass', 1000, 1]])) {
      const fl = this.f(ft, fr, q, gn || 0);
      if (o.sweep && fl.type !== 'highpass') fl.frequency.exponentialRampToValueAtTime(o.sweep, t + a + hold + d * (o.sweepFrac ?? 0.5));
      node.connect(fl); node = fl;
    }
    node.connect(g); g.connect(o.dest || this.out);
    return g;
  }

  tone(t, o = {}) {
    t = Math.max(0, t);
    const a = o.a ?? 0.002, d = o.d ?? 0.3, hold = o.hold ?? 0;
    const osc = this.ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + (o.sweep ?? d * 0.5));
    if (o.detune) osc.detune.value = o.detune;
    const g = this.g(0);
    this.env(g.gain, t, a, d, o.amp ?? 1, hold);
    osc.connect(g); g.connect(o.dest || this.out);
    osc.start(t);
    osc.stop(t + a + hold + d * 1.3 + 0.02);
    return { osc, g };
  }

  modal(t, parts, dest, a = 0.0008) {
    for (const p of parts) this.tone(t, { f: p.f, a: p.at ?? a, d: p.d, amp: p.a, dest, hold: p.hold || 0 });
  }

  buf(chans, t, dest, rate = 1) {
    t = Math.max(0, t);
    const s = this.ctx.createBufferSource();
    s.buffer = makeBuffer(this.ctx, chans);
    s.playbackRate.value = rate;
    s.connect(dest || this.out);
    s.start(t);
    return s;
  }

  pluck(t, freq, dur, o = {}, dest) {
    const arr = ksPluck(this.sr, freq, dur, this.rnd, o);
    const g = this.g(o.amp ?? 1);
    g.connect(dest || this.out);
    this.buf([arr], t, g);
    return g;
  }

  thump(t, f0, f1, d, amp, dest) {
    return this.tone(t, { f: f0, f1, sweep: d * 0.4, a: 0.003, d, amp, dest });
  }

  clink(t, f0, amp, decay, dest) {
    const rat = [1, 1.58, 2.46, 3.3, 4.4];
    const am = [1, 0.6, 0.4, 0.25, 0.12];
    const parts = rat.map((r, i) => ({ f: f0 * r * this.r(0.97, 1.03), a: am[i] * amp * 0.3, d: decay * (1 - i * 0.15) }));
    this.modal(t, parts, dest);
    this.burst(t, { filt: [['highpass', 3500, 0.7]], a: 0.0005, d: 0.006, amp: amp * 0.25, dest });
  }

  blade(t, f0, amp, decay, dest) {
    const lp = this.f('lowpass', 8500, 0.5);
    lp.connect(dest || this.out);
    const rat = [1, 2.09, 2.83, 3.93, 5.21, 6.49];
    const am = [1, 0.7, 0.55, 0.4, 0.28, 0.18];
    const parts = [];
    rat.forEach((r, i) => {
      const f = f0 * r * this.r(0.98, 1.02);
      const dd = decay * (1 - i * 0.12) * this.r(0.8, 1.2);
      parts.push({ f, a: am[i] * amp * 0.16, d: dd });
      parts.push({ f: f + this.r(1.5, 4), a: am[i] * amp * 0.1, d: dd * 0.9 });
    });
    this.modal(t, parts, lp);
    this.burst(t, { filt: [['bandpass', 3200, 0.7]], a: 0.0005, d: 0.02, amp: amp * 0.9, dest: lp });
    this.burst(t, { type: 'pink', filt: [['lowpass', 1200, 0.7]], a: 0.001, d: 0.05, amp: amp * 0.5, dest: lp });
  }

  step(t, amp, dest, o = {}) {
    const bp = o.bp ?? this.r(380, 700);
    this.burst(t, { type: 'pink', filt: [['bandpass', bp, 1.1]], a: 0.004, d: this.r(0.05, 0.09), amp: amp * 1.2, dest });
    this.burst(t + 0.004, { filt: [['highpass', 1800, 0.7], ['lowpass', 5000, 0.7]], a: 0.002, d: this.r(0.02, 0.05), amp: amp * (o.crunch ?? 0.25), dest });
    this.thump(t, this.r(85, 105), 55, 0.07, amp * 0.6, dest);
  }

  hoof(t, amp, dest) {
    this.burst(t, { filt: [['bandpass', this.r(1100, 1900), 2]], a: 0.0008, d: 0.025, amp: amp * 0.7, dest });
    this.thump(t, this.r(130, 160), 85, 0.08, amp * 0.8, dest);
    this.burst(t + 0.005, { type: 'pink', filt: [['lowpass', 650, 0.7]], a: 0.003, d: 0.08, amp: amp * 0.8, dest });
  }

  taiko(t, amp, f0, dest, o = {}) {
    const lp = this.f('lowpass', o.lp ?? 2800, 0.6);
    lp.connect(dest || this.out);
    const d = o.d ?? 0.9;
    this.tone(t, { f: f0 * 1.6, f1: f0, sweep: 0.07, a: 0.002, d, amp: amp, dest: lp });
    this.tone(t, { f: f0 * 1.59 * 1.3, f1: f0 * 1.59, sweep: 0.05, a: 0.002, d: d * 0.45, amp: amp * 0.35, dest: lp });
    this.tone(t, { f: f0 * 2.14, a: 0.002, d: d * 0.25, amp: amp * 0.15, dest: lp });
    this.burst(t, { type: 'pink', filt: [['bandpass', o.skin ?? 500, 0.9]], a: 0.001, d: 0.07, amp: amp * (o.slap ?? 0.6), dest: lp });
    this.burst(t, { filt: [['highpass', 2000, 0.7]], a: 0.0005, d: 0.01, amp: amp * 0.15, dest: lp });
  }

  bell(t, f0, amp, decay, dest) {
    const rat = [1, 2.0, 2.76, 4.07, 5.4];
    const am = [1, 0.22, 0.32, 0.1, 0.06];
    this.modal(t, rat.map((r, i) => ({ f: f0 * r, a: am[i] * amp * 0.5, d: decay * [1, 0.6, 0.45, 0.3, 0.2][i] })), dest, 0.002);
  }

  horn(t, f0, dur, amp, dest, o = {}) {
    const ctx = this.ctx;
    const out = this.g(1);
    const pk1 = this.f('peaking', 520, 1.2, 4);
    const pk2 = this.f('peaking', 1250, 1.5, 2);
    const hp = this.f('highpass', 60, 0.7);
    const lp = this.f('lowpass', f0 * 1.5, 1.1);
    this.chain(lp, pk1, pk2, hp, out);
    out.connect(dest || this.out);
    const a = o.a ?? 0.35, rel = o.rel ?? 0.6;
    const end = t + dur;
    const vca = this.g(0);
    vca.connect(lp);
    vca.gain.setValueAtTime(0, t);
    vca.gain.linearRampToValueAtTime(amp * 0.7, t + a * 0.4);
    vca.gain.linearRampToValueAtTime(amp, t + a);
    vca.gain.setValueAtTime(amp, end - rel);
    vca.gain.linearRampToValueAtTime(0, end);
    const bright = o.bright ?? 7;
    lp.frequency.setValueAtTime(f0 * 1.5, t);
    lp.frequency.linearRampToValueAtTime(f0 * bright, t + a);
    lp.frequency.setTargetAtTime(f0 * bright * 0.7, t + a, 0.4);
    lp.frequency.setValueAtTime(f0 * bright * 0.7, end - rel);
    lp.frequency.linearRampToValueAtTime(f0 * 1.2, end);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 4.6;
    const lg = this.g(0);
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(o.vib ?? 7, t + Math.min(dur, 1.2));
    lfo.connect(lg);
    lfo.start(t); lfo.stop(end + 0.1);
    for (const det of [-6, 0, 5]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f0 * Math.pow(2, -1.2 / 12), t);
      osc.frequency.exponentialRampToValueAtTime(f0, t + 0.16);
      let prev = f0;
      if (o.glide) for (const [gt, gf, gd] of o.glide) {
        osc.frequency.setValueAtTime(prev, t + gt);
        osc.frequency.exponentialRampToValueAtTime(gf, t + gt + (gd ?? 0.25));
        prev = gf;
      }
      osc.detune.value = det;
      lg.connect(osc.detune);
      const og = this.g(0.33);
      osc.connect(og); og.connect(vca);
      osc.start(t); osc.stop(end + 0.05);
    }
    this.burst(t, { type: 'pink', filt: [['bandpass', f0 * 4, 1.5]], a: a, d: rel, hold: Math.max(0, dur - a - rel), amp: amp * 0.05, dest: out });
  }
}
