export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const rr = (rnd, a, b) => a + (b - a) * rnd();
export const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(1e-12, g));

export function fillNoise(arr, type, rnd) {
  if (type === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < arr.length; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      arr[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else if (type === 'brown') {
    let b = 0;
    for (let i = 0; i < arr.length; i++) {
      b = (b + 0.02 * (rnd() * 2 - 1)) / 1.02;
      arr[i] = b * 3.5;
    }
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = rnd() * 2 - 1;
  }
  return arr;
}

export function removeDC(arr) {
  let m = 0;
  for (let i = 0; i < arr.length; i++) m += arr[i];
  m /= arr.length || 1;
  for (let i = 0; i < arr.length; i++) arr[i] -= m;
  return arr;
}

export function ksPluck(sr, freq, dur, rnd, o = {}) {
  const L = Math.max(1, Math.floor(dur * sr));
  const y = new Float32Array(L);
  const t60 = o.t60 ?? 3;
  const bright = o.brightness ?? 0.5;
  const s = o.stretch ?? 0.5;
  const D0 = sr / freq - s;
  const N = Math.ceil(D0) + 2;
  const exc = new Float32Array(N);
  let lp = 0;
  const a = 0.05 + 0.9 * bright;
  for (let i = 0; i < N; i++) { lp += a * ((rnd() * 2 - 1) - lp); exc[i] = lp; }
  removeDC(exc);
  const pp = Math.max(1, Math.floor((o.pluckPos ?? 0.18) * D0));
  const ex2 = new Float32Array(N);
  for (let i = 0; i < N; i++) ex2[i] = exc[i] - (i >= pp ? exc[i - pp] : 0);
  let pk = 0;
  for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(ex2[i]));
  const g = Math.pow(10, -3 / (t60 * freq));
  const bend = o.bend || 0, bendAt = o.bendAt ?? 0.15, bendTime = o.bendTime ?? 0.12;
  const excLen = Math.floor(D0);
  for (let n = 0; n < L; n++) {
    let D = D0;
    if (bend) {
      const t = n / sr;
      const k = clamp((t - bendAt) / bendTime, 0, 1);
      D = sr / (freq * Math.pow(2, bend * k * k * (3 - 2 * k) / 12)) - s;
    }
    const r = n - D;
    let fb = 0;
    if (r >= 1) {
      const i0 = Math.floor(r), f = r - i0;
      const v0 = y[i0] + f * ((i0 + 1 < n ? y[i0 + 1] : 0) - y[i0]);
      const v1 = y[i0 - 1] + f * (y[i0] - y[i0 - 1]);
      fb = g * ((1 - s) * v0 + s * v1);
    }
    y[n] = (n < excLen ? ex2[n] / (pk || 1) : 0) + fb;
  }
  removeDC(y);
  return y;
}

export function makeBuffer(ctx, channels) {
  const buf = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate);
  channels.forEach((c, i) => buf.copyToChannel(c, i));
  return buf;
}

export function noiseBuffer(ctx, seconds, type, rnd, nch = 1) {
  const L = Math.max(1, Math.floor(seconds * ctx.sampleRate));
  const chans = [];
  for (let c = 0; c < nch; c++) chans.push(fillNoise(new Float32Array(L), type, rnd));
  return makeBuffer(ctx, chans);
}

export function softClipCurve(ceiling = 0.88, n = 4096) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * 2 - 1;
    c[i] = ceiling * Math.tanh((2 * u) / ceiling);
  }
  return c;
}

export function reverbIR(ctx, seconds, rnd, decay = 2.6) {
  const sr = ctx.sampleRate;
  const L = Math.floor(seconds * sr);
  const chans = [new Float32Array(L), new Float32Array(L)];
  for (let c = 0; c < 2; c++) {
    const a = chans[c];
    let lp = 0;
    for (let i = 0; i < L; i++) {
      const t = i / sr;
      const coef = 0.85 - 0.8 * Math.min(1, t / seconds);
      lp += coef * ((rnd() * 2 - 1) - lp);
      const pre = t < 0.012 ? t / 0.012 : 1;
      a[i] = lp * Math.exp(-decay * t) * pre;
    }
    for (let k = 0; k < 6; k++) {
      const idx = Math.floor(rr(rnd, 0.008, 0.06) * sr);
      if (idx < L) a[idx] += rr(rnd, -0.5, 0.5);
    }
    removeDC(a);
  }
  return makeBuffer(ctx, chans);
}
