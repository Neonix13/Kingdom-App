// Generates data/maps/kokuyou.json — "Colline de Kokuyou": a wooded hill country where Qin (west) and Zhao (east)
// fight for six hills: a dominant central hill and five smaller hills around it. Dense forests hide units (ambushes),
// summits are clearings, a small river runs along the south with a village on each bank side, and each army has a
// fortified rear camp in a clearing. Heights change by at most one level between neighbours: every slope is a gentle
// ramp and no cliff is needed. The layout is mirrored left/right so both sides get the same ground.
// Usage: node scripts/maps/kokuyou.mjs [--out data/maps/kokuyou.json]
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? resolve(process.argv[outArg + 1]) : join(ROOT, 'data', 'maps', 'kokuyou.json');

const W = 60, H = 44;
const S3 = Math.sqrt(3);
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const key = (q, r) => `${q},${r}`;
const qr = (c, j) => [c, j - Math.floor(c / 2)];
const edgeKey = (a, b) => {
  const [q1, r1] = a.split(',').map(Number), [q2, r2] = b.split(',').map(Number);
  return q1 < q2 || (q1 === q2 && r1 < r2) ? `${a}|${b}` : `${b}|${a}`;
};
const lerp = (a, b, t) => a + (b - a) * t;

// deterministic value noise
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
}
const fbm = (x, y) => vnoise(x, y) * 0.6 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.1;

// --- hex grid ---
const hexes = new Map();
for (let c = 0; c < W; c++) for (let j = 0; j < H; j++) {
  const [q, r] = qr(c, j);
  hexes.set(key(q, r), { q, r, c, j, x: 1.5 * q, z: S3 * (r + q / 2), h: 1, terrain: 'plain' });
}
const all = [...hexes.values()];
const XC = (1.5 * (W - 1)) / 2;            // mirror axis (Qin west, Zhao east)
const ZC = (S3 * (H - 0.5)) / 2;
const mx = (x) => Math.abs(x - XC);          // mirrored x: symmetric noise and features
const neighbors = (h) => DIRS.map(([dq, dr]) => hexes.get(key(h.q + dq, h.r + dr))).filter(Boolean);
const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
const nearest = (x, z) => all.reduce((best, h) => (Math.hypot(h.x - x, h.z - z) < Math.hypot(best.x - x, best.z - z) ? h : best), all[0]);
const segments = {};
const setSeg = (a, b, t) => { segments[edgeKey(key(a.q, a.r), key(b.q, b.r))] = t; };
function linePath(A, B) {
  const out = [A];
  let cur = A, guard = 0;
  while (cur !== B && guard++ < 400) {
    let best = null, bd = Infinity;
    for (const n of neighbors(cur)) { const d = Math.hypot(n.x - B.x, n.z - B.z); if (d < bd) { bd = d; best = n; } }
    cur = best;
    out.push(cur);
  }
  return out;
}
const way = (pts) => {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) for (const h of linePath(nearest(...pts[i]), nearest(...pts[i + 1]))) if (!out.includes(h)) out.push(h);
  return out;
};
const mirrorPts = (pts) => pts.map(([x, z]) => [2 * XC - x, z]);

// --- hills: broad cones whose height drops one level every `k` hexes (gentle ramps, no cliffs) ---
// Pentagon of five hills around the central one, mirrored left/right.
const R = 26;
const ring = [0, 72, 144].map((deg) => [Math.sin(deg * Math.PI / 180) * R, -Math.cos(deg * Math.PI / 180) * R]);
const hillDefs = [
  { id: 'centre', name: 'Colline de Kokuyou', x: XC, z: ZC, peak: 6, top: 2, k: 2, points: 3 },
  { id: 'nord', name: 'Butte du Nord', x: XC, z: ZC + ring[0][1], peak: 4, top: 1, k: 2, points: 1 },
  { id: 'pins', name: 'Colline des Pins', x: XC - ring[1][0], z: ZC + ring[1][1], peak: 4, top: 1, k: 2, points: 1 },
  { id: 'corbeaux', name: 'Colline des Corbeaux', x: XC + ring[1][0], z: ZC + ring[1][1], peak: 4, top: 1, k: 2, points: 1 },
  { id: 'gue', name: 'Tertre du Gué', x: XC - ring[2][0], z: ZC + ring[2][1], peak: 3, top: 1, k: 2, points: 1 },
  { id: 'moulin', name: 'Tertre du Moulin', x: XC + ring[2][0], z: ZC + ring[2][1], peak: 3, top: 1, k: 2, points: 1 },
];
const hills = hillDefs.map((d) => ({ ...d, hex: nearest(d.x, d.z) }));
// low swells in the woods and the camps' mounds (mirrored pairs)
const swells = [];
for (const [x, z, peak, top, k] of [[24, 14, 2, 2, 3], [18, 52, 2, 1, 3], [9, ZC, 2, 3, 3], [30, 70, 2, 1, 2]]) {
  swells.push({ hex: nearest(x, z), peak, top, k });
  swells.push({ hex: nearest(2 * XC - x, z), peak, top, k });
}
const cone = (h, s) => s.peak - Math.floor(Math.max(0, hexDist(h, s.hex) - s.top) / s.k);
for (const h of all) h.h = Math.max(1, ...hills.map((s) => cone(h, s)), ...swells.map((s) => cone(h, s)));

// --- river along the south: from the west edge to the east edge, mirrored meanders ---
const riverZ = (x) => ZC * 2 - 7.5 + 2.2 * Math.cos((x - XC) / 7.5);
const riverPts = [];
for (let x = 0; x <= 1.5 * (W - 1) + 0.01; x += 4.5) riverPts.push([x, riverZ(x)]);
const river = way(riverPts);
for (const h of river) { h.terrain = 'river'; h.h = 0; }

// --- relaxation: at most one level between neighbours (river banks and hill flanks) ---
for (let it = 0; it < 40; it++) {
  let changed = false;
  for (const h of all) for (const n of neighbors(h)) if (h.h - n.h > 1) { h.h = n.h + 1; changed = true; }
  if (!changed) break;
}

// --- roads: each camp to the central hill's foot, camps to their village, villages along the river, north woods to camp ---
const CAMP_X = 10, VILLAGE = [XC - 27, riverZ(XC - 27) - 5.5];
const roadPts = [
  [[0, ZC], [CAMP_X, ZC], [XC - 18, ZC + 1.5], [XC - 9, ZC]],
  [[CAMP_X, ZC], [CAMP_X + 4, ZC + 12], VILLAGE, [XC - 12, riverZ(XC - 12) - 3.5], [XC, riverZ(XC) - 3.5]],
  [[CAMP_X + 2, 10], [CAMP_X + 1, ZC - 10], [CAMP_X, ZC]],
];
const road = [];
for (const pts of roadPts) for (const p of [pts, mirrorPts(pts)]) for (const h of way(p)) if (!road.includes(h)) road.push(h);
for (const h of road) h.terrain = h.terrain === 'river' ? 'bridge' : 'road';

// --- villages on the north bank, mirrored: buildings on flat ground, fields around ---
const villages = [VILLAGE, [2 * XC - VILLAGE[0], VILLAGE[1]]].map(([x, z]) => nearest(x, z));
const buildingHexes = new Set();
for (const v of villages) {
  const cluster = [v, ...neighbors(v)].filter((h) => h.terrain === 'plain').slice(0, 5);
  for (const b of cluster) { b.terrain = 'building'; buildingHexes.add(b); }
  const lvl = Math.min(...cluster.map((b) => b.h));
  for (const b of cluster) b.h = lvl;
}

// --- camps: clearings with a palisade toward the woods (gaps on the roads) ---
const camps = [nearest(CAMP_X, ZC), nearest(2 * XC - CAMP_X, ZC)];
const inCamp = (h) => camps.some((c) => hexDist(h, c) <= 5);

// --- forests: dense woods everywhere except camps, summits, roads, villages, river, and a few clearings ---
for (const h of all) {
  if (h.terrain !== 'plain') continue;
  if (inCamp(h)) continue;
  if (hills.some((s) => hexDist(h, s.hex) <= s.top + 1)) continue;
  if (villages.some((v) => hexDist(h, v) <= 3)) continue;
  if (neighbors(h).some((n) => n.terrain === 'river')) continue;
  const wood = fbm(mx(h.x) * 0.13 + 5, h.z * 0.13 + 3);
  const glade = fbm(mx(h.x) * 0.31 + 17, h.z * 0.31 + 11);
  const upper = h.h >= 4;   // upper hill slopes: open woods, so the crowns read from afar
  if (wood > (upper ? 0.58 : 0.36) && glade > 0.3) h.terrain = 'forest';
}
// re-flatten re-checked: buildings keep the relaxation guarantee
for (let it = 0; it < 10; it++) {
  let changed = false;
  for (const h of all) for (const n of neighbors(h)) if (h.h - n.h > 1) { h.h = n.h + 1; changed = true; }
  if (!changed) break;
}
for (const h of all) for (const n of neighbors(h)) if (Math.abs(h.h - n.h) >= 2) setSeg(h, n, 'cliff');

// palisades: barriers on the camp's outer ring facing the battlefield, leaving the roads open
for (const camp of camps) {
  const east = camp.x < XC ? 1 : -1;
  for (const h of all) {
    if (hexDist(h, camp) !== 5 || (h.x - camp.x) * east < 3) continue;
    for (const n of neighbors(h)) {
      if (hexDist(n, camp) !== 6 || road.includes(n) || road.includes(h)) continue;
      setSeg(h, n, Math.abs(h.z - camp.z) < 3 ? 'chevaux_de_frise' : 'barriere');
    }
  }
}

// --- decor ---
const fields = [];
for (const v of villages) for (const h of all) {
  const d = hexDist(h, v);
  if (d >= 2 && d <= 4 && h.terrain === 'plain' && fbm(mx(h.x) * 0.4 + 2, h.z * 0.4) > 0.42) fields.push(key(h.q, h.r));
}
const props = [];
const prop = (type, h, rot, label) => { if (h) props.push({ type, q: h.q, r: h.r, ...(rot != null ? { rot } : {}), ...(label ? { label } : {}) }); };
const off = (h, dx, dz) => nearest(h.x + dx, h.z + dz);
camps.forEach((camp, i) => {
  const s = camp.x < XC ? 1 : -1;
  const flag = i === 0 ? '秦' : '趙';
  const face = s > 0 ? 0 : 3;
  prop('tente_cmd', off(camp, -1.5 * s, 0), face);
  for (const [dx, dz] of [[-4.5, -5], [-4.5, 5], [-1.5, -6.5], [-1.5, 6.5], [1.5, -5], [1.5, 5], [-6, 0]]) prop('tente', off(camp, dx * s, dz), face);
  for (const [dx, dz] of [[0, -3], [0, 3]]) prop('banniere', off(camp, dx * s, dz), null, flag);
  prop('feu', off(camp, -3 * s, -2.5));
  prop('feu', off(camp, -3 * s, 2.5));
  for (const dz of [-8, 8]) prop('tour', off(camp, 5 * s, dz));
});
// a watchtower on the central hill, an old shrine-like tower on the north butte
const centre = hills[0].hex;
prop('tour', neighbors(centre).find((n) => n.terrain === 'plain') || centre);
prop('tour', neighbors(hills[1].hex).find((n) => n.terrain === 'plain') || hills[1].hex);
for (const v of villages) prop('feu', neighbors(v).find((n) => n.terrain === 'plain'));

// --- deployment zones (order: Qin camp, Zhao camp, Qin north woods, Zhao north woods) ---
const zoneOf = (pred) => all.filter((h) => !['river', 'bridge'].includes(h.terrain) && pred(h)).map((h) => key(h.q, h.r));
const west = (h) => h.x < XC;
const zones = [
  { name: 'Qin — camp ouest', tiles: zoneOf((h) => west(h) && hexDist(h, camps[0]) <= 4) },
  { name: 'Zhao — camp est', tiles: zoneOf((h) => !west(h) && hexDist(h, camps[1]) <= 4) },
  { name: 'Qin — bois du nord', tiles: zoneOf((h) => west(h) && h.x >= 4 && h.x <= 20 && h.z >= 4 && h.z <= 16) },
  { name: 'Zhao — bois du nord', tiles: zoneOf((h) => !west(h) && mx(h.x) <= XC - 4 && mx(h.x) >= XC - 20 && h.z >= 4 && h.z <= 16) },
];
const objectives = hills.map((s) => ({ id: s.id, q: s.hex.q, r: s.hex.r, type: 'colline', points: s.points, name: s.name }));

const height = {}, terrain = {};
for (const h of all) {
  height[key(h.q, h.r)] = h.h;
  if (h.terrain !== 'plain') terrain[key(h.q, h.r)] = h.terrain;
}
const map = {
  format: 2,
  id: 'kokuyou',
  name: 'Colline de Kokuyou',
  description: "Un pays de collines couvert de forêts profondes, où Qin (à l'ouest) et Zhao (à l'est) se disputent six hauteurs : la grande colline de Kokuyou au centre et cinq collines plus basses autour d'elle. Les sommets sont des clairières d'où l'on voit loin ; tout le reste se joue sous les arbres, où les embuscades décident des combats. Au sud, une petite rivière longe deux villages ; chaque armée tient un camp fortifié dans une clairière à l'arrière.",
  author: 'Kingdom Battleground',
  updatedAt: new Date().toISOString(),
  background: null,
  height, terrain, segments,
  decor: { fields, ramparts: [], props },
  zones, objectives,
};
writeFileSync(OUT, JSON.stringify(map));
const count = (o) => Object.values(o).reduce((a, v) => ((a[v] = (a[v] || 0) + 1), a), {});
console.log(`${OUT}\n${hexes.size} cases, hauteurs ${Math.min(...Object.values(height))}–${Math.max(...Object.values(height))}`);
console.log('terrains', count(terrain), '\nsegments', count(segments));
console.log('zones', zones.map((z) => `${z.name}: ${z.tiles.length}`).join(' · '));
console.log('objectifs', objectives.map((o) => `${o.name} ${o.q},${o.r} (h${height[key(o.q, o.r)]})`).join(' · '));
