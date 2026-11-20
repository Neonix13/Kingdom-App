export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function makeNoise2D(seed = 1) {
  const rnd = makeRng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const GX = [1, -1, 1, -1, 1, -1, 0, 0];
  const GY = [1, 1, -1, -1, 0, 0, 1, -1];
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;

  return function noise(x, y) {
    const s = (x + y) * F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = perm[ii + perm[jj]] & 7; t0 *= t0; n += t0 * t0 * (GX[g] * x0 + GY[g] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = perm[ii + i1 + perm[jj + j1]] & 7; t1 *= t1; n += t1 * t1 * (GX[g] * x1 + GY[g] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = perm[ii + 1 + perm[jj + 1]] & 7; t2 *= t2; n += t2 * t2 * (GX[g] * x2 + GY[g] * y2); }
    return 70 * n;
  };
}

export function fbm2(noise, x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function ridged2(noise, x, y, octaves = 6) {
  let sum = 0, amp = 0.5, freq = 1, weight = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise(x * freq, y * freq));
    n *= n;
    n *= weight;
    weight = Math.min(1, Math.max(0, n * 2));
    sum += n * amp;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

// Tileable RGBA fbm value-noise (one independent pattern per channel)
export function makeTileableNoiseData(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const channels = [
    { seed: 11, base: 4, oct: 5 },
    { seed: 23, base: 8, oct: 4 },
    { seed: 37, base: 16, oct: 3 },
    { seed: 51, base: 6, oct: 5 },
  ];
  const tmp = new Float32Array(size * size);
  channels.forEach((ch, c) => {
    const rng = makeRng(ch.seed);
    const lattices = [];
    for (let o = 0; o < ch.oct; o++) {
      const n = ch.base << o;
      const arr = new Float32Array(n * n);
      for (let i = 0; i < n * n; i++) arr[i] = rng();
      lattices.push({ n, arr });
    }
    let mn = Infinity, mx = -Infinity;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0, amp = 1, norm = 0;
        for (const { n, arr } of lattices) {
          const fx = x / size * n, fy = y / size * n;
          const ix = Math.floor(fx), iy = Math.floor(fy);
          const tx = fx - ix, ty = fy - iy;
          const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
          const x0 = ix % n, x1 = (ix + 1) % n, y0 = iy % n, y1 = (iy + 1) % n;
          const a = arr[y0 * n + x0], b = arr[y0 * n + x1];
          const c0 = arr[y1 * n + x0], d = arr[y1 * n + x1];
          const top = a + (b - a) * sx, bot = c0 + (d - c0) * sx;
          sum += amp * (top + (bot - top) * sy);
          norm += amp;
          amp *= 0.5;
        }
        const v = sum / norm;
        tmp[y * size + x] = v;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    for (let i = 0; i < size * size; i++) {
      data[i * 4 + c] = Math.round((tmp[i] - mn) / (mx - mn) * 255);
    }
  });
  return data;
}
