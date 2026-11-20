function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

export function spectrum(x, sr, N = 4096) {
  const hop = N / 2;
  const pow = new Float64Array(N / 2);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  let frames = 0;
  for (let s = 0; s + N <= x.length || (frames === 0 && s === 0); s += hop) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (x[s + i] || 0) * win[i];
    fft(re, im);
    for (let k = 0; k < N / 2; k++) pow[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
    if (s + N > x.length) break;
  }
  return { pow, binHz: sr / N };
}

const db = (g) => 20 * Math.log10(Math.max(1e-12, g));
const r1 = (v) => Math.round(v * 10) / 10;

export function metrics(buffer, o = {}) {
  const sr = buffer.sampleRate;
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  const n = buffer.length;
  let peak = 0, sum2 = 0, clipped = 0, nan = 0, lastAudible = 0;
  const dc = [];
  for (const y of chans) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const v = y[i];
      if (!Number.isFinite(v)) { nan++; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
      if (a > 0.001) lastAudible = Math.max(lastAudible, i);
      sum2 += v * v; s += v;
    }
    dc.push(s / n);
  }
  const mono = new Float32Array(n);
  for (const y of chans) for (let i = 0; i < n; i++) mono[i] += y[i] / chans.length;
  const { pow, binHz } = spectrum(mono, sr);
  let tot = 0, cen = 0, lg = 0, cnt = 0;
  for (let k = 1; k < pow.length; k++) {
    const f = k * binHz;
    if (f < 30 || f > Math.min(16000, sr / 2 - 500)) continue;
    tot += pow[k]; cen += f * pow[k]; lg += Math.log(pow[k] + 1e-20); cnt++;
  }
  const flat = Math.exp(lg / cnt) / (tot / cnt);
  const res = {
    dur: r1(n / sr * 100) / 100,
    audible: Math.round(lastAudible / sr * 100) / 100,
    peakDb: r1(db(peak)),
    rmsDb: r1(db(Math.sqrt(sum2 / (n * chans.length)))),
    dc: Math.max(...dc.map(Math.abs)).toExponential(1),
    clipped, nan,
    edge: chans.map((y) => Math.max(Math.abs(y[0]), Math.abs(y[n - 1])).toFixed(4)).join('/'),
    centroid: Math.round(cen / tot),
    flatness: Math.round(flat * 1000) / 1000,
  };
  if (o.f0) {
    let e = 0;
    const bw = o.bw || Math.max(15, o.f0 * 0.03);
    for (let h = 1; h <= (o.harmonics || 8); h++) {
      const fc = o.f0 * h;
      for (let k = Math.floor((fc - bw) / binHz); k <= Math.ceil((fc + bw) / binHz); k++) if (k > 0 && k < pow.length) e += pow[k];
    }
    let all = 0;
    for (let k = 1; k < pow.length; k++) all += pow[k];
    res.harmonicRatio = Math.round(e / all * 1000) / 1000;
  }
  if (o.loop) {
    let md = 0;
    const diffs = [];
    for (const y of chans) {
      for (let i = 1; i < n; i += 97) diffs.push(Math.abs(y[i] - y[i - 1]));
      md = Math.max(md, Math.abs(y[0] - y[n - 1]));
    }
    diffs.sort((a, b) => a - b);
    res.seamJump = md.toFixed(4);
    res.typStep = diffs[Math.floor(diffs.length * 0.99)].toFixed(4);
  }
  return res;
}

export function peakFrequency(buffer, lo = 50, hi = 8000) {
  const y = buffer.getChannelData(0);
  const { pow, binHz } = spectrum(y, buffer.sampleRate, 8192);
  let best = 0, bk = 0;
  for (let k = Math.ceil(lo / binHz); k < Math.min(pow.length, hi / binHz); k++) if (pow[k] > best) { best = pow[k]; bk = k; }
  return Math.round(bk * binHz);
}
