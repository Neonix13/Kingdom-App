import { mtof, smoothstep, removeDC } from './dsp.js';

function gustCurve(k, dur, n = 200, slow = [0.03, 0.12]) {
  const fr = [k.r(slow[0], slow[1]), k.r(slow[0], slow[1]), k.r(slow[1], slow[1] * 2.5)];
  const ph = fr.map(() => k.r(0, Math.PI * 2));
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * dur;
    let v = 0.5 * Math.sin(2 * Math.PI * fr[0] * t + ph[0]) + 0.3 * Math.sin(2 * Math.PI * fr[1] * t + ph[1]) + 0.2 * Math.sin(2 * Math.PI * fr[2] * t + ph[2]);
    c[i] = smoothstep(-0.9, 0.9, v);
  }
  return c;
}

function randCurve(k, n, lo, hi, smooth = 0.3) {
  const c = new Float32Array(n);
  let v = k.r(lo, hi);
  for (let i = 0; i < n; i++) { v += smooth * (k.r(lo, hi) - v); c[i] = v; }
  return c;
}

function armor(k, t, n, spread, amp, dest) {
  for (let i = 0; i < n; i++) {
    const tt = t + Math.pow(k.rnd(), 1.4) * spread;
    k.clink(tt, k.r(2300, 4200), amp * k.r(0.4, 1), k.r(0.03, 0.08), dest);
  }
}

function cluster(k, n, a, b) {
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(k.r(a, b));
  return arr.sort((x, y) => x - y);
}

const PENTA = [0, 2, 4, 7, 9];

export const SFX = {
  ui_click: {
    dur: 0.12, variants: 3, level: -20, detune: 0.04, maxVoices: 3, minInterval: 0.03,
    build(k) {
      k.modal(0.002, [{ f: k.r(1700, 1900), a: 0.5, d: 0.035 }, { f: k.r(2800, 3100), a: 0.25, d: 0.02 }, { f: k.r(900, 1000), a: 0.3, d: 0.04 }]);
      k.burst(0.001, { filt: [['bandpass', 3000, 1.2]], a: 0.0005, d: 0.008, amp: 0.4 });
    },
  },
  ui_hover: {
    dur: 0.08, variants: 2, level: -34, detune: 0.03, maxVoices: 2, minInterval: 0.06,
    build(k) {
      const lp = k.f('lowpass', 3500, 0.5); lp.connect(k.out);
      k.tone(0.002, { f: k.r(1500, 1700), f1: 1900, sweep: 0.03, a: 0.006, d: 0.05, amp: 0.4, dest: lp });
      k.burst(0.002, { filt: [['bandpass', 2500, 1]], a: 0.004, d: 0.02, amp: 0.08, dest: lp });
    },
  },
  select_unit: {
    dur: 0.6, variants: 3, level: -12, send: 0.1,
    build(k) {
      const lp = k.f('lowpass', 7500, 0.5); lp.connect(k.out);
      armor(k, 0.01, 8, 0.12, 0.8, lp);
      armor(k, k.r(0.16, 0.22), 7, 0.16, 0.55, lp);
      k.burst(0.0, { type: 'pink', filt: [['bandpass', 700, 0.8]], a: 0.03, d: 0.15, amp: 0.25, dest: lp });
      k.burst(0.02, { type: 'pink', filt: [['bandpass', 380, 1]], a: 0.01, d: 0.12, amp: 0.4, dest: lp });
    },
  },
  deploy_place: {
    dur: 0.8, variants: 3, level: -10, send: 0.1,
    build(k) {
      const lp = k.f('lowpass', 6500, 0.5); lp.connect(k.out);
      k.thump(0, k.r(105, 125), 48, 0.28, 1, lp);
      k.burst(0, { type: 'brown', filt: [['lowpass', 400, 0.7]], a: 0.003, d: 0.22, amp: 1.2, dest: lp });
      k.burst(0.003, { type: 'pink', filt: [['bandpass', 1500, 1]], a: 0.002, d: 0.06, amp: 0.25, dest: lp });
      armor(k, 0.035, 9, 0.18, 0.45, lp);
    },
  },
  hit_impact: {
    dur: 0.5, variants: 4, level: -9, send: 0.08,
    build(k) {
      const lp = k.f('lowpass', 7000, 0.5); lp.connect(k.out);
      k.thump(0, k.r(130, 160), 55, 0.18, 1, lp);
      k.burst(0, { type: 'pink', filt: [['bandpass', k.r(900, 1400), 1]], a: 0.001, d: 0.05, amp: 0.7, dest: lp });
      k.burst(0, { type: 'brown', filt: [['lowpass', 500, 0.7]], a: 0.002, d: 0.12, amp: 0.9, dest: lp });
      k.clink(0.004, k.r(2500, 3500), 0.35, 0.06, lp);
    },
  },
  unit_death: {
    dur: 1.4, variants: 3, level: -9, send: 0.12,
    build(k) {
      const lp = k.f('lowpass', 5000, 0.5); lp.connect(k.out);
      const t2 = k.r(0.11, 0.18);
      k.thump(0, 95, 50, 0.2, 0.55, lp);
      k.burst(0, { type: 'brown', filt: [['lowpass', 350, 0.7]], a: 0.004, d: 0.15, amp: 0.6, dest: lp });
      k.thump(t2, 80, 40, 0.35, 1, lp);
      k.burst(t2, { type: 'brown', filt: [['lowpass', 300, 0.7]], a: 0.004, d: 0.3, amp: 1.2, dest: lp });
      armor(k, t2 + 0.01, 6, 0.25, 0.35, lp);
      k.burst(t2 + 0.03, { type: 'pink', filt: [['bandpass', 1100, 0.6]], a: 0.08, d: 0.7, amp: 0.12, dest: lp });
    },
  },
  move_march: {
    dur: 4, loop: true, xf: 0.6, ch: 2, variants: 1, level: -14,
    build(k) {
      const cadence = 0.5;
      const lp = k.f('lowpass', 6000, 0.5); lp.connect(k.out);
      const total = 4 + 0.7;
      for (let s = 0; s * cadence < total; s++) {
        const t0 = s * cadence;
        for (let i = 0; i < 9; i++) {
          const p = k.pan(k.r(-0.8, 0.8), lp);
          k.step(t0 + k.r(-0.035, 0.035) + 0.02, k.r(0.25, 0.5), p, { crunch: 0.3 });
          if (k.rnd() < 0.3) k.clink(t0 + k.r(0.02, 0.12), k.r(2600, 4000), 0.12, 0.04, p);
        }
      }
      const bed = k.pan(0, lp);
      k.burst(0, { type: 'pink', filt: [['bandpass', 600, 0.6]], a: 0.2, d: 1, hold: total, amp: 0.05, dest: bed });
    },
  },
  move_gallop: {
    dur: 3.36, loop: true, xf: 0.5, ch: 2, variants: 1, level: -13,
    build(k) {
      const stride = 0.42;
      const lp = k.f('lowpass', 6000, 0.5); lp.connect(k.out);
      const horses = 6;
      const offs = [0, 0.075, 0.16, 0.23];
      for (let h = 0; h < horses; h++) {
        const p = k.pan(k.r(-0.8, 0.8), lp);
        const ph = k.r(0, stride);
        const a = k.r(0.35, 0.7);
        for (let s = -1; s * stride < 3.36 + 0.6; s++) {
          offs.forEach((o, j) => {
            const t = s * stride + ph + o + k.r(-0.008, 0.008);
            if (t >= 0) k.hoof(t, a * (j === 3 ? 1 : 0.75), p);
          });
          if (s >= 0 && k.rnd() < 0.4) k.clink(s * stride + ph + k.r(0, 0.3), k.r(3000, 4500), 0.08, 0.05, p);
        }
      }
      k.burst(0, { type: 'brown', filt: [['lowpass', 180, 0.7]], a: 0.2, d: 1, hold: 4, amp: 0.25, dest: k.pan(0, lp) });
    },
  },
  chariot_rumble: {
    dur: 4, loop: true, xf: 0.6, ch: 2, variants: 1, level: -12,
    build(k) {
      const total = 4.7;
      const lp = k.f('lowpass', 5000, 0.5); lp.connect(k.out);
      for (const pn of [-0.4, 0.4]) {
        const p = k.pan(pn, lp);
        const g = k.g(0);
        const n = 200;
        const c = new Float32Array(n);
        const wf = 2.5, ph = k.r(0, 6.28);
        for (let i = 0; i < n; i++) {
          const t = (i / (n - 1)) * total;
          c[i] = 0.45 + 0.25 * Math.sin(2 * Math.PI * wf * t + ph) + 0.15 * k.rnd();
        }
        g.gain.setValueCurveAtTime(c, 0, total);
        const s = k.src('brown', 0, total);
        k.chain(s, k.f('lowpass', 220, 0.8), g, p);
        for (let b = 0; b < 9; b++) k.thump(k.r(0, total), k.r(70, 110), 45, 0.15, k.r(0.2, 0.45), p);
        for (let b = 0; b < 6; b++) k.burst(k.r(0, total), { filt: [['bandpass', k.r(700, 1100), 6]], a: 0.04, d: 0.25, amp: 0.15, dest: p });
      }
      const stride = 0.6;
      for (let h = 0; h < 4; h++) {
        const p = k.pan(k.r(-0.5, 0.5), lp);
        const ph = k.r(0, stride);
        for (let s = 0; s * stride < total; s++) {
          k.hoof(s * stride + ph, 0.3, p);
          k.hoof(s * stride + ph + stride / 2 + k.r(-0.01, 0.01), 0.25, p);
        }
      }
      for (let i = 0; i < 10; i++) k.clink(k.r(0, total), k.r(2400, 3600), 0.1, 0.05, k.pan(k.r(-0.5, 0.5), lp));
    },
  },
  attack_clash: {
    dur: 2.4, variants: 3, level: -8, send: 0.15, maxVoices: 3,
    build(k) {
      const lp = k.f('lowpass', 8000, 0.5); lp.connect(k.out);
      for (const t of cluster(k, 8, 0.02, 1.6)) k.blade(t, k.r(1100, 2300), k.r(0.4, 0.9), k.r(0.12, 0.35), lp);
      for (const t of cluster(k, 5, 0.05, 1.7)) {
        k.thump(t, k.r(140, 180), 70, 0.1, 0.5, lp);
        k.burst(t, { type: 'pink', filt: [['lowpass', 900, 0.7]], a: 0.002, d: 0.08, amp: 0.6, dest: lp });
      }
      const roar = k.f('lowpass', 2200, 0.5); roar.connect(lp);
      for (let i = 0; i < 6; i++) {
        const t = k.r(0, 1.4), d = k.r(0.3, 0.6);
        const f1 = k.r(550, 850), f2 = k.r(1100, 1500);
        const g = k.g(1); g.connect(roar);
        k.burst(t, { type: 'pink', filt: [['bandpass', f1, 4]], a: d * 0.35, d, amp: 0.35, dest: g, sweep: f1 * 1.25, sweepFrac: 0.6 });
        k.burst(t, { type: 'pink', filt: [['bandpass', f2, 5]], a: d * 0.35, d, amp: 0.2, dest: g, sweep: f2 * 1.2, sweepFrac: 0.6 });
      }
      k.burst(0, { type: 'pink', filt: [['bandpass', 500, 0.5]], a: 0.25, d: 0.9, hold: 0.8, amp: 0.12, dest: lp });
    },
  },
  arrow_volley: {
    dur: 3.0, variants: 2, level: -9, send: 0.18, maxVoices: 2,
    build(k) {
      const lp = k.f('lowpass', 8000, 0.5); lp.connect(k.out);
      for (let i = 0; i < 9; i++) {
        const t = k.r(0, 0.16);
        const p = k.pan(k.r(-0.6, 0.6), lp);
        k.pluck(t, k.r(85, 140), 0.35, { t60: 0.25, brightness: 0.4, amp: 0.22 }, p);
        k.burst(t, { filt: [['bandpass', 1800, 1.5]], a: 0.0005, d: 0.012, amp: 0.15, dest: p });
      }
      for (let i = 0; i < 14; i++) {
        const t = k.r(0.18, 0.7), d = k.r(0.7, 1.1);
        const f0 = k.r(1700, 2600);
        const p = k.pan(k.r(-0.9, 0.9), lp);
        k.burst(t, { filt: [['bandpass', f0, k.r(12, 22)]], a: d * 0.55, d: d * 0.6, amp: k.r(0.5, 1.1), dest: p, sweep: f0 * 0.55, sweepFrac: 1.5 });
      }
      for (let i = 0; i < 16; i++) {
        const t = k.r(1.35, 2.2);
        const p = k.pan(k.r(-0.9, 0.9), lp);
        if (k.rnd() < 0.6) {
          k.burst(t, { type: 'pink', filt: [['bandpass', k.r(400, 900), 1]], a: 0.001, d: 0.06, amp: 0.4, dest: p });
          k.thump(t, 160, 90, 0.05, 0.2, p);
        } else {
          k.modal(t, [{ f: k.r(600, 900), a: 0.15, d: 0.06 }, { f: k.r(1500, 2000), a: 0.08, d: 0.04 }], p);
          k.burst(t, { filt: [['bandpass', 2500, 1]], a: 0.0005, d: 0.01, amp: 0.15, dest: p });
        }
      }
    },
  },
  unit_rout: {
    dur: 3.0, ch: 2, variants: 2, level: -10, send: 0.15,
    build(k) {
      for (let i = 0; i < 40; i++) {
        const t = Math.pow(k.rnd(), 1.3) * 2.3;
        const away = t / 2.3;
        const lp = k.f('lowpass', 6000 * Math.pow(0.15, away), 0.5); lp.connect(k.out);
        const side = k.rnd() < 0.5 ? -1 : 1;
        const p = k.pan(side * (0.15 + 0.75 * away) * k.r(0.6, 1), lp);
        k.step(t, 0.45 * (1 - 0.7 * away), p, { crunch: 0.35 });
      }
      for (let i = 0; i < 4; i++) {
        const t = k.r(0.05, 0.9);
        const p = k.pan(k.r(-0.6, 0.6));
        k.clink(t, k.r(1800, 3000), 0.5, 0.12, p);
        k.thump(t, 220, 120, 0.06, 0.2, p);
      }
      for (let i = 0; i < 4; i++) {
        const t = k.r(0, 1.0), d = k.r(0.4, 0.7);
        const p = k.pan(k.r(-0.7, 0.7), k.f('lowpass', 1800, 0.5));
        p.connect(k.out);
        k.burst(t, { type: 'pink', filt: [['bandpass', k.r(600, 900), 4]], a: 0.08, d, amp: 0.25, dest: p, sweep: 1200, sweepFrac: 0.4 });
      }
    },
  },
  general_duel: {
    dur: 3.4, variants: 2, level: -6, send: 0.3, maxVoices: 1,
    build(k) {
      const times = k.rnd() < 0.5 ? [0.2, 0.75, 1.25] : [0.2, 0.5, 1.3];
      times.forEach((t, i) => {
        const big = i === times.length - 1 ? 1 : 0.75;
        k.burst(t - 0.16, { type: 'pink', filt: [['bandpass', 500, 1.5]], a: 0.13, d: 0.06, amp: 0.25, dest: k.out, sweep: 2600, sweepFrac: 1 });
        k.blade(t, k.r(700, 1100), big, k.r(0.9, 1.6) * big, k.out);
        k.blade(t + 0.004, k.r(1500, 2100), big * 0.6, k.r(0.5, 0.9), k.out);
        k.thump(t, 75, 38, 0.6, big * 0.9, k.out);
        k.burst(t, { type: 'brown', filt: [['lowpass', 200, 0.7]], a: 0.003, d: 0.5, amp: big * 0.7 });
      });
    },
  },
  horn_turn_start: {
    dur: 3.2, variants: 2, level: -8, send: 0.35, maxVoices: 1,
    build(k) {
      const f0 = k.r(96, 104);
      k.horn(0.02, f0, 2.9, 0.8, k.out, { a: 0.45, rel: 0.8, bright: 6, glide: [[0.9, f0 * 1.5, 0.22]] });
      k.horn(0.06, f0 / 2, 2.8, 0.35, k.out, { a: 0.5, rel: 0.8, bright: 5, glide: [[0.9, f0 * 0.75, 0.22]] });
    },
  },
  drum_roll_initiative: {
    dur: 3.0, variants: 2, level: -7, send: 0.2, maxVoices: 1,
    build(k) {
      let t = 0.02, i = 0;
      while (t < 1.75) {
        const prog = t / 1.75;
        k.taiko(t, 0.25 + 0.5 * prog, (i % 2 ? 128 : 136) * k.r(0.98, 1.02), k.out, { d: 0.35, skin: 700, slap: 0.8 });
        t += 0.17 * (1 - prog) + 0.05;
        i++;
      }
      k.taiko(1.85, 1, 62, k.out, { d: 1.1, skin: 400 });
      k.taiko(1.855, 0.6, 128, k.out, { d: 0.4 });
    },
  },
  gong: {
    dur: 6.5, variants: 1, level: -9, send: 0.3, maxVoices: 2,
    build(k) {
      const lp = k.f('lowpass', 6000, 0.5); lp.connect(k.out);
      const f0 = 98;
      const base = [1, 1.52, 1.83, 2.36, 2.68, 3.13, 3.6, 4.12, 4.55, 5.22];
      base.forEach((r, i) => {
        const pf = f0 * r * k.r(0.995, 1.005);
        k.tone(0, { f: pf, a: 0.004, d: 5.5 - i * 0.35, amp: 0.25 / (1 + i * 0.35), dest: lp });
        k.tone(0, { f: pf * 1.0015, a: 0.004, d: 5 - i * 0.35, amp: 0.12 / (1 + i * 0.35), dest: lp });
      });
      for (let i = 0; i < 26; i++) {
        const pf = Math.exp(k.r(Math.log(500), Math.log(3800)));
        k.tone(0, { f: pf, a: k.r(0.25, 0.9), d: k.r(1.5, 3.5), amp: k.r(0.01, 0.035), dest: lp });
      }
      k.thump(0, 90, 50, 0.4, 0.5, lp);
      k.burst(0, { type: 'pink', filt: [['lowpass', 900, 0.7]], a: 0.002, d: 0.15, amp: 0.4, dest: lp });
    },
  },
  victory_fanfare: {
    dur: 5.2, variants: 1, level: -7, send: 0.35, maxVoices: 1,
    build(k) {
      const D = mtof(50), A = mtof(57);
      [[0, 0.32], [0.38, 0.32], [0.76, 2.6]].forEach(([t, d], i) => {
        k.horn(t, D, d, i === 2 ? 0.6 : 0.45, k.out, { a: 0.08, rel: i === 2 ? 0.9 : 0.12, bright: 7 });
        k.horn(t + 0.01, A, d, i === 2 ? 0.5 : 0.35, k.out, { a: 0.08, rel: i === 2 ? 0.9 : 0.12, bright: 7 });
      });
      k.horn(0.76, D * 2, 2.6, 0.25, k.out, { a: 0.4, rel: 0.9, bright: 5 });
      [0, 0.38, 0.76, 3.0].forEach((t, i) => k.taiko(t, i >= 2 ? 1 : 0.6, 64, k.out, { d: 1 }));
      const g = k.g(0.5); g.connect(k.out);
      for (let i = 0; i < 12; i++) {
        const m = 62 + PENTA[i % 5] + 12 * Math.floor(i / 5);
        k.pluck(1.0 + i * 0.055, mtof(m), 2.5, { t60: 2, brightness: 0.6, amp: 0.35 }, g);
      }
      k.bell(3.0, mtof(86), 0.15, 2, k.out);
    },
  },
  defeat: {
    dur: 5.5, variants: 1, level: -8, send: 0.35, maxVoices: 1,
    build(k) {
      const A = mtof(45);
      k.horn(0.05, A, 3.6, 0.6, k.out, { a: 0.6, rel: 1.4, bright: 4.5, vib: 10, glide: [[1.3, mtof(42), 0.6], [2.4, mtof(38), 0.8]] });
      k.taiko(0.05, 0.8, 55, k.out, { d: 1.3, lp: 1500 });
      k.taiko(2.4, 0.5, 52, k.out, { d: 1.3, lp: 1200 });
      const g = k.g(0.6); g.connect(k.out);
      k.pluck(2.6, mtof(38), 3, { t60: 3, brightness: 0.25, amp: 0.6 }, g);
    },
  },
  ping: {
    dur: 1.6, variants: 1, level: -18, send: 0.25, detune: 0.0,
    build(k) { k.bell(0.001, 1320, 1, 1.4); },
  },
  notification: {
    dur: 1.8, variants: 1, level: -16, send: 0.25, detune: 0,
    build(k) {
      k.bell(0.001, mtof(81), 0.8, 1.1);
      k.bell(0.13, mtof(86), 0.9, 1.5);
    },
  },
};

export const AMB = {
  amb_wind_low: {
    rate: 11025, dur: 24, loop: true, xf: 2.5, ch: 2,
    build(k) {
      const T = 26.5;
      for (const side of [k.L, k.R]) {
        const g = gustCurve(k, T);
        const s2 = k.src('brown', 0, T);
        const f = k.f('lowpass', 300, 0.6);
        const v = k.g(0);
        f.frequency.setValueCurveAtTime(g.map((x) => 160 + 520 * x), 0, T);
        v.gain.setValueCurveAtTime(g.map((x) => 0.3 + 0.7 * x), 0, T);
        k.chain(s2, f, v, side);
        const s3 = k.src('pink', 0, T);
        const f3 = k.f('bandpass', 400, 0.7);
        const v3 = k.g(0);
        f3.frequency.setValueCurveAtTime(g.map((x) => 250 + 600 * x), 0, T);
        v3.gain.setValueCurveAtTime(g.map((x) => 0.04 + 0.22 * x * x), 0, T);
        k.chain(s3, f3, v3, side);
      }
    },
  },
  amb_wind_whistle: {
    rate: 16000, dur: 17, loop: true, xf: 2, ch: 2,
    build(k) {
      const T = 19;
      for (const side of [k.L, k.R]) {
        const g = gustCurve(k, T, 160, [0.05, 0.16]);
        const base = k.r(520, 760);
        const s = k.src('pink', 0, T);
        const f = k.f('bandpass', base, 9);
        const v = k.g(0);
        f.frequency.setValueCurveAtTime(g.map((x) => base * (0.8 + 0.7 * x)), 0, T);
        v.gain.setValueCurveAtTime(g.map((x) => x * x * x), 0, T);
        k.chain(s, f, v, side);
      }
    },
  },
  amb_forest: {
    rate: 22050, dur: 13, loop: true, xf: 1.5, ch: 2,
    build(k) {
      const T = 14.5;
      for (const side of [k.L, k.R]) {
        const g = gustCurve(k, T, 120, [0.06, 0.2]);
        const flutter = randCurve(k, Math.floor(T * 25), 0.2, 1, 0.45);
        const s = k.src('white', 0, T);
        const v = k.g(0), v2 = k.g(0);
        v.gain.setValueCurveAtTime(g.map((x) => 0.15 + 0.85 * x), 0, T);
        v2.gain.setValueCurveAtTime(flutter, 0, T);
        k.chain(s, k.f('highpass', 1600, 0.6), k.f('peaking', 3800, 0.8, 4), k.f('lowpass', 7500, 0.5), v, v2, side);
      }
      for (let i = 0; i < 5; i++) {
        const p = k.pan(k.r(-0.8, 0.8));
        k.burst(k.r(0, T), { filt: [['bandpass', k.r(2500, 4500), 2]], a: 0.05, d: 0.25, amp: 0.15, dest: p });
      }
    },
  },
  amb_river: {
    rate: 16000, dur: 11, loop: true, xf: 1.5, ch: 2,
    build(k) {
      const T = 12.5, sr = k.sr, L = Math.floor(T * sr);
      for (const side of [k.L, k.R]) {
        k.chain(k.src('brown', 0, T), k.f('lowpass', 450, 0.6), k.g(0.5), side);
        k.chain(k.src('pink', 0, T), k.f('bandpass', 1600, 0.6), k.g(0.06), side);
      }
      const chL = new Float32Array(L), chR = new Float32Array(L);
      let t = 0;
      while (t < T) {
        const burst = k.rnd() < 0.15 ? 6 : 1;
        for (let b = 0; b < burst; b++) {
          const f0 = Math.exp(k.r(Math.log(350), Math.log(1700)));
          const tau = k.r(0.006, 0.02) * (700 / f0) ** 0.5;
          const dur = tau * 6;
          const amp = k.r(0.05, 0.25) * Math.sqrt(500 / f0);
          const pan = k.r(-0.8, 0.8);
          const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
          const rise = k.r(0.15, 0.5);
          const st = Math.floor((t + b * k.r(0.005, 0.03)) * sr);
          let ph = 0;
          const n = Math.floor(dur * sr);
          for (let i = 0; i < n && st + i < L; i++) {
            const tt = i / sr;
            const f = f0 * (1 + rise * tt / dur);
            ph += 2 * Math.PI * f / sr;
            const att = Math.min(1, i / (0.0015 * sr));
            const v = Math.sin(ph) * Math.exp(-tt / tau) * amp * att;
            chL[st + i] += v * gl; chR[st + i] += v * gr;
          }
        }
        t += -Math.log(1 - k.rnd()) / 45;
      }
      removeDC(chL); removeDC(chR);
      const m = k.ctx.createChannelSplitter(2);
      const lp = k.f('lowpass', 3500, 0.5);
      k.buf([chL, chR], 0, lp);
      lp.connect(m);
      m.connect(k.L, 0); m.connect(k.R, 1);
    },
  },
  amb_crickets: {
    rate: 16000, dur: 9, loop: true, xf: 1, ch: 2,
    build(k) {
      const T = 10, sr = k.sr, L = Math.floor(T * sr);
      const chL = new Float32Array(L), chR = new Float32Array(L);
      for (let c = 0; c < 6; c++) {
        const fc = k.r(3900, 5200);
        const pan = k.r(-0.9, 0.9);
        const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
        const amp = k.r(0.15, 0.5);
        const trill = c >= 4;
        const pulse = k.r(0.012, 0.018), gap = k.r(0.012, 0.02);
        const period = k.r(0.55, 0.95);
        let t = k.r(0, period);
        const pulses = [];
        while (t < T) {
          if (trill) {
            const len = k.r(1.5, 3);
            for (let x = 0; x < len; x += pulse + gap) pulses.push(t + x);
            t += len + k.r(0.8, 2);
          } else {
            const np = 3 + Math.floor(k.rnd() * 2);
            for (let p = 0; p < np; p++) pulses.push(t + p * (pulse + gap));
            t += period * k.r(0.9, 1.1);
          }
        }
        const n = Math.floor(pulse * sr);
        for (const pt of pulses) {
          const st = Math.floor(pt * sr);
          const ph0 = k.r(0, 6.28);
          for (let i = 0; i < n && st + i < L; i++) {
            const e = Math.sin(Math.PI * i / n) ** 2;
            const ph = ph0 + 2 * Math.PI * fc * i / sr;
            const v = (Math.sin(ph) + 0.08 * Math.sin(2 * ph)) * e * amp;
            chL[st + i] += v * gl; chR[st + i] += v * gr;
          }
        }
      }
      const m = k.ctx.createChannelSplitter(2);
      const lp = k.f('lowpass', 6500, 0.5);
      k.buf([chL, chR], 0, lp);
      lp.connect(m);
      m.connect(k.L, 0); m.connect(k.R, 1);
    },
  },
  amb_murmur: {
    rate: 8000, dur: 12, loop: true, xf: 1.5, ch: 2,
    build(k) {
      const T = 13.5;
      const lp = k.f('lowpass', 1500, 0.5); lp.connect(k.out);
      for (let v = 0; v < 7; v++) {
        const p = k.pan(k.r(-0.8, 0.8), lp);
        const n = Math.floor(T * 8);
        const f1c = new Float32Array(n), f2c = new Float32Array(n), ac = new Float32Array(n);
        let talking = k.rnd() < 0.5, left = k.r(0.5, 2.5), a = 0, F1 = 600, F2 = 1300;
        for (let i = 0; i < n; i++) {
          left -= 1 / 8;
          if (left <= 0) { talking = !talking; left = talking ? k.r(1, 3) : k.r(0.6, 2.5); }
          if (k.rnd() < 0.5) { F1 = k.r(450, 800); F2 = k.r(1000, 1800); }
          const target = talking ? k.r(0.3, 1) : 0;
          a += 0.5 * (target - a);
          f1c[i] = F1; f2c[i] = F2; ac[i] = a;
        }
        const g = k.g(0); g.gain.setValueCurveAtTime(ac, 0, T); g.connect(p);
        const pitch = k.r(0.8, 1.25);
        const b1 = k.f('bandpass', 600, 5), b2 = k.f('bandpass', 1300, 6);
        b1.frequency.setValueCurveAtTime(f1c.map((x) => x * pitch), 0, T);
        b2.frequency.setValueCurveAtTime(f2c.map((x) => x * pitch), 0, T);
        const s = k.src('pink', 0, T);
        s.connect(b1); s.connect(b2);
        const g2 = k.g(0.5); b2.connect(g2);
        b1.connect(g); g2.connect(g);
      }
    },
  },
  amb_bird: {
    dur: 2.4, variants: 6,
    build(k, v) {
      const lp = k.f('lowpass', 8500, 0.5); lp.connect(k.out);
      const ch = (t, f0, f1, d, amp) => {
        k.tone(t, { f: f0, f1, sweep: d, a: d * 0.2, d: d * 0.9, amp, dest: lp });
        k.tone(t, { f: f0 * 2, f1: f1 * 2, sweep: d, a: d * 0.2, d: d * 0.6, amp: amp * 0.06, dest: lp });
      };
      if (v === 0) {
        let t = 0.02;
        const n = 6 + Math.floor(k.rnd() * 5);
        for (let i = 0; i < n; i++) { ch(t, k.r(4600, 5400), k.r(2900, 3300), 0.045, 0.5); t += k.r(0.06, 0.085); }
        for (let i = 0; i < 8; i++) { ch(t, 4200, 3800, 0.022, 0.35); t += 0.035; }
      } else if (v === 1) {
        let t = 0.02;
        const notes = [[1900, 2300], [2300, 1700], [2100, 2500]];
        for (const [a, b] of notes) { ch(t, a, b, 0.24, 0.6); t += k.r(0.26, 0.34); }
      } else if (v === 2) {
        const t = 0.02, d = k.r(0.6, 0.9);
        const o = k.ctx.createOscillator(); o.frequency.value = k.r(4000, 4600);
        const am = k.ctx.createOscillator(); am.frequency.value = k.r(22, 28);
        const ag = k.g(0.5); am.connect(ag);
        const vca = k.g(0.5); ag.connect(vca.gain);
        const env = k.g(0); k.env(env.gain, t, 0.08, d, 0.5, d * 0.5);
        k.chain(o, vca, env, lp);
        o.start(t); am.start(t); o.stop(t + d * 2); am.stop(t + d * 2);
      } else if (v === 3) {
        let t = 0.02;
        const n = 2 + Math.floor(k.rnd() * 3);
        for (let i = 0; i < n; i++) {
          const f = k.r(2900, 3400);
          k.tone(t, { f, f1: f * 1.4, sweep: 0.025, a: 0.008, d: 0.06, amp: 0.5, dest: lp });
          k.tone(t + 0.03, { f: f * 1.4, f1: f * 0.95, sweep: 0.035, a: 0.004, d: 0.05, amp: 0.4, dest: lp });
          t += k.r(0.14, 0.2);
        }
      } else if (v === 4) {
        const f = k.r(480, 560);
        [[0.02, 0.35, 0.4], [0.5, 0.55, 0.6], [1.15, 0.35, 0.4]].forEach(([t, d, a]) => {
          k.tone(t, { f: f * 0.92, f1: f, sweep: d * 0.3, a: d * 0.35, d: d * 0.8, amp: a, dest: lp });
          k.tone(t, { f: f * 2 * 0.92, f1: f * 2, sweep: d * 0.3, a: d * 0.35, d: d * 0.6, amp: a * 0.05, dest: lp });
        });
      } else {
        let t = 0.02;
        for (let i = 0; i < 6; i++) {
          const f = k.r(2200, 4000);
          const d = k.r(0.07, 0.14);
          ch(t, f, f * k.r(0.85, 1.15), d, 0.45);
          if (k.rnd() < 0.4) { ch(t + d, f * 1.2, f, d * 0.6, 0.3); t += d * 0.6; }
          t += d + k.r(0.04, 0.12);
        }
      }
    },
  },
  amb_owl: {
    dur: 2.6, variants: 2,
    build(k, v) {
      const lp = k.f('lowpass', 1500, 0.5); lp.connect(k.out);
      const f = k.r(350, 400);
      const pat = v === 0 ? [[0, 0.45], [0.95, 0.18], [1.2, 0.18], [1.45, 0.7]] : [[0, 0.5], [0.8, 0.8]];
      for (const [t, d] of pat) {
        k.tone(t + 0.02, { f: f * 1.03, f1: f * 0.94, sweep: d, a: d * 0.35, d: d * 0.9, hold: d * 0.2, amp: 0.6, dest: lp });
        k.tone(t + 0.02, { f: f * 2.06, f1: f * 1.88, sweep: d, a: d * 0.35, d: d * 0.6, amp: 0.04, dest: lp });
        k.burst(t + 0.02, { type: 'pink', filt: [['bandpass', f, 6]], a: d * 0.35, d: d * 0.8, amp: 0.25, dest: lp });
      }
    },
  },
  amb_hammer: {
    dur: 2.6, variants: 3,
    build(k) {
      const lp = k.f('lowpass', 3500, 0.5); lp.connect(k.out);
      const f0 = k.r(1050, 1450);
      let t = 0.02;
      const n = 2 + Math.floor(k.rnd() * 3);
      for (let i = 0; i < n; i++) {
        const a = i === n - 1 ? 0.5 : 1;
        k.modal(t, [1, 2.4, 3.9, 5.3].map((r, j) => ({ f: f0 * r * k.r(0.99, 1.01), a: a * [0.5, 0.3, 0.18, 0.1][j], d: k.r(0.25, 0.5) * (1 - j * 0.15) })), lp);
        k.burst(t, { type: 'pink', filt: [['lowpass', 900, 0.7]], a: 0.001, d: 0.05, amp: 0.4 * a, dest: lp });
        t += k.r(0.45, 0.6);
      }
    },
  },
  amb_chicken: {
    dur: 1.8, variants: 2,
    build(k) {
      const lp = k.f('lowpass', 2800, 0.5); lp.connect(k.out);
      const bp1 = k.f('bandpass', 1100, 3), bp2 = k.f('bandpass', 2400, 4);
      const mix = k.g(1); bp1.connect(mix); bp2.connect(mix); mix.connect(lp);
      const cl = (t, f, d, amp, f1) => {
        const o = k.ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f1 || f * 0.8, t + d);
        const g = k.g(0); k.env(g.gain, t, 0.008, d, amp);
        o.connect(g); g.connect(bp1); g.connect(bp2);
        o.start(t); o.stop(t + d * 1.4);
      };
      let t = 0.02;
      const n = 3 + Math.floor(k.rnd() * 3);
      for (let i = 0; i < n; i++) { cl(t, k.r(380, 460), 0.07, 0.4); t += k.r(0.13, 0.22); }
      if (k.rnd() < 0.7) cl(t + 0.1, 480, 0.35, 0.45, 650);
    },
  },
};

const ZHENG = [50, 56, 62, 68, 74, 80];
const PIPA = [45, 51, 57, 63, 69];
const QIN = [33, 39, 45, 51];
const QINH = [62, 68, 74, 80];

export const MUSIC_BASES = { zheng: ZHENG, pipa: PIPA, qin: QIN, qinh: QINH };

export const MUS = {};
for (const m of ZHENG) MUS['m_zheng_' + m] = {
  dur: 3.6, build(k) {
    const f = mtof(m);
    const out = k.f('lowpass', 7000, 0.5); out.connect(k.out);
    const body = k.f('peaking', 230, 1, 3); const sp = k.f('peaking', 2600, 1, 2);
    k.chain(body, sp, out);
    k.pluck(0, f, 3.6, { t60: 3.2 - (m - 50) / 30, brightness: 0.6, pluckPos: 0.13, amp: 0.8 }, body);
    k.burst(0, { filt: [['highpass', 3000, 0.7]], a: 0.0005, d: 0.005, amp: 0.08, dest: out });
  },
};
for (const m of PIPA) MUS['m_pipa_' + m] = {
  dur: 1.9, build(k) {
    const out = k.f('lowpass', 6500, 0.5); out.connect(k.out);
    const body = k.f('peaking', 420, 1.2, 4); const sp = k.f('peaking', 3000, 1, 3);
    k.chain(body, sp, out);
    k.pluck(0, mtof(m), 1.9, { t60: 1.1, brightness: 0.75, pluckPos: 0.1, amp: 0.8 }, body);
    k.burst(0, { filt: [['highpass', 2500, 0.7]], a: 0.0005, d: 0.006, amp: 0.15, dest: out });
  },
};
for (const m of QIN) MUS['m_qin_' + m] = {
  rate: 16000, dur: 5.5, build(k) {
    const out = k.f('lowpass', 2400, 0.5); out.connect(k.out);
    const body = k.f('peaking', 180, 1, 3);
    body.connect(out);
    k.pluck(0, mtof(m), 5.5, { t60: 5, brightness: 0.3, pluckPos: 0.22, stretch: 0.4, amp: 0.9 }, body);
    k.burst(0, { type: 'pink', filt: [['bandpass', 1200, 1]], a: 0.002, d: 0.03, amp: 0.05, dest: out });
  },
};
for (const m of QINH) MUS['m_qinh_' + m] = {
  rate: 16000, dur: 4.2, build(k) {
    const f = mtof(m);
    k.modal(0, [{ f, a: 0.5, d: 3.8 }, { f: f * 2, a: 0.04, d: 1.8 }, { f: f * 3, a: 0.02, d: 1 }], k.out, 0.004);
    k.burst(0, { type: 'pink', filt: [['bandpass', f, 3]], a: 0.002, d: 0.04, amp: 0.05 });
  },
};
Object.assign(MUS, {
  m_taiko_lo: { rate: 16000, dur: 1.6, build(k) { k.taiko(0, 1, 58, k.out, { d: 1.3, skin: 400, lp: 2000 }); } },
  m_taiko_mid: { dur: 1.0, build(k) { k.taiko(0, 1, 95, k.out, { d: 0.7, skin: 600, lp: 2600 }); } },
  m_drum_hi: {
    dur: 0.5, build(k) {
      k.taiko(0, 0.8, 230, k.out, { d: 0.25, skin: 1400, slap: 1, lp: 5000 });
    },
  },
  m_wood: {
    dur: 0.3, build(k) {
      k.modal(0, [{ f: 880, a: 0.5, d: 0.08 }, { f: 2350, a: 0.2, d: 0.04 }, { f: 3900, a: 0.08, d: 0.02 }]);
      k.burst(0, { filt: [['bandpass', 2000, 1]], a: 0.0005, d: 0.01, amp: 0.2 });
    },
  },
});

export const ALL = { ...SFX, ...AMB, ...MUS };
