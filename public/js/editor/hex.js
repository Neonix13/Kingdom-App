// Flat-top axial hex math in editor world units (hex radius = 1). Same conventions as public/js/hexGrid.js.
export const SQRT3 = Math.sqrt(3);
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export const key = (q, r) => q + ',' + r;
export function parseKey(k) {
  const i = k.indexOf(',');
  return [+k.slice(0, i), +k.slice(i + 1)];
}

export function center(q, r) {
  return { x: 1.5 * q, y: SQRT3 / 2 * q + SQRT3 * r };
}

export function round(fq, fr) {
  const fs = -fq - fr;
  let q = Math.round(fq), r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return [q, r];
}

export function fromPoint(x, y) {
  return round(2 / 3 * x, -1 / 3 * x + SQRT3 / 3 * y);
}

export function distance(q1, r1, q2, r2) {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

export function neighbors(q, r) {
  return DIRS.map(([dq, dr]) => [q + dq, r + dr]);
}

export function isAdjacent(q1, r1, q2, r2) {
  const dq = q2 - q1, dr = r2 - r1;
  return DIRS.some(([a, b]) => a === dq && b === dr);
}

export function inRadius(q, r, rad) {
  const out = [];
  for (let dq = -rad; dq <= rad; dq++) {
    const lo = Math.max(-rad, -dq - rad), hi = Math.min(rad, -dq + rad);
    for (let dr = lo; dr <= hi; dr++) out.push([q + dq, r + dr]);
  }
  return out;
}

// Canonical segment key (same rule as game/HexUtils.js segmentEdgeKey)
export function edgeKey(q1, r1, q2, r2) {
  if (q1 < q2 || (q1 === q2 && r1 < r2)) return `${q1},${r1}|${q2},${r2}`;
  return `${q2},${r2}|${q1},${r1}`;
}

export function parseEdge(k) {
  const i = k.indexOf('|');
  if (i < 0) return null;
  const a = k.slice(0, i), b = k.slice(i + 1);
  const [q1, r1] = parseKey(a), [q2, r2] = parseKey(b);
  return { a, b, q1, r1, q2, r2 };
}

// Edge endpoints from the two hex centers: midpoint ± perpendicular * 0.5
export function edgeEnds(q1, r1, q2, r2) {
  const c1 = center(q1, r1), c2 = center(q2, r2);
  const mx = (c1.x + c2.x) / 2, my = (c1.y + c2.y) / 2;
  const dx = c2.x - c1.x, dy = c2.y - c1.y;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len * 0.5, py = dx / len * 0.5;
  return [mx + px, my + py, mx - px, my - py];
}

// Nearest hex edge to a world point: returns { q1, r1, q2, r2, dist }
export function nearestEdge(x, y) {
  const [q, r] = fromPoint(x, y);
  const c = center(q, r);
  let best = null, bd = Infinity;
  for (const [dq, dr] of DIRS) {
    const n = center(q + dq, r + dr);
    const d = Math.hypot((c.x + n.x) / 2 - x, (c.y + n.y) / 2 - y);
    if (d < bd) { bd = d; best = [q + dq, r + dr]; }
  }
  return { q1: q, r1: r, q2: best[0], r2: best[1], dist: bd };
}

export const CORNERS = Array.from({ length: 6 }, (_, i) => [Math.cos(Math.PI / 3 * i), Math.sin(Math.PI / 3 * i)]);

export function addHexPath(path, cx, cy, s = 1) {
  path.moveTo(cx + CORNERS[0][0] * s, cy + CORNERS[0][1] * s);
  for (let i = 1; i < 6; i++) path.lineTo(cx + CORNERS[i][0] * s, cy + CORNERS[i][1] * s);
  path.closePath();
}

// Rectangle of W columns x H rows (flat-top, offset rows so the shape is rectangular)
export function rectangle(w, h) {
  const out = [];
  for (let q = 0; q < w; q++) {
    const off = Math.floor(q / 2);
    for (let row = 0; row < h; row++) out.push([q, row - off]);
  }
  return out;
}
