// Generates data/maps/bayou.json — "Plaine de Bayou": a walled Qin town on the edge of wide rolling plains.
// West: the town of Bayou inside a ring of ramparts (wall-walk two levels above the streets, stone stairs up from the
// inside), a double gate to the east and a postern to the west; fields and the Qin relief camp to the south-west.
// Centre: a river running north-south in front of the town, crossed by the road bridge and two narrow fords.
// East: open rolling plains for cavalry, a central ridge and a low north-east ridge as high ground, a village, the Zhao
// camp at the east edge. North: the mountain edge with forested foothills; south-east: thick woods where a hidden army
// can wait. Slopes stay gentle (at most one level between neighbours) except the town walls (cliff faces).
// Usage: node scripts/maps/bayou.mjs [--out data/maps/bayou.json]
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? resolve(process.argv[outArg + 1]) : join(ROOT, 'data', 'maps', 'bayou.json');

const W = 60, H = 40;
const S3 = Math.sqrt(3);
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const key = (q, r) => `${q},${r}`;
const qr = (c, j) => [c, j - Math.floor(c / 2)];
const edgeKey = (a, b) => {
  const [q1, r1] = a.split(',').map(Number), [q2, r2] = b.split(',').map(Number);
  return q1 < q2 || (q1 === q2 && r1 < r2) ? `${a}|${b}` : `${b}|${a}`;
};
const smooth = (a, b, t) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
}
const fbm = (x, y) => vnoise(x, y) * 0.6 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.1;
const hexDist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;

// --- hex grid ---
const hexes = new Map();
for (let c = 0; c < W; c++) for (let j = 0; j < H; j++) {
  const [q, r] = qr(c, j);
  hexes.set(key(q, r), { q, r, c, j, x: 1.5 * q, z: S3 * (r + q / 2), h: 2, terrain: 'plain' });
}
const at = (c, j) => hexes.get(key(...qr(c, j)));
const byQR = (q, r) => hexes.get(key(q, r));
const neighbors = (h) => DIRS.map(([dq, dr]) => byQR(h.q + dq, h.r + dr)).filter(Boolean);
const segments = {};
const setSeg = (a, b, t) => { segments[edgeKey(key(a.q, a.r), key(b.q, b.r))] = t; };
const fixed = new Set();
const cliffEdges = new Set();
function linePath(A, B) {
  const out = [A];
  let cur = A, guard = 0;
  while (cur !== B && guard++ < 300) {
    let best = null, bd = Infinity;
    for (const n of neighbors(cur)) { const d = Math.hypot(n.x - B.x, n.z - B.z); if (d < bd) { bd = d; best = n; } }
    cur = best;
    out.push(cur);
  }
  return out;
}
function wayPath(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) for (const h of linePath(at(...points[i]), at(...points[i + 1]))) if (!out.includes(h)) out.push(h);
  return out;
}
// distance from point (x, z) to segment AB
function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}

// --- relief: flat plains at level 2, broad smooth hills, the mountain edge in the north (east of the town) ---
const ridges = [
  { a: [52, 47], b: [68, 56], w: 5.5, amp: 2.4, name: 'centre' },     // central ridge in the plain
  { a: [64, 14], b: [76, 22], w: 4.5, amp: 1.4, name: 'nord-est' },    // low north-east ridge
  { a: [6, 52], b: [16, 58], w: 4.5, amp: 1.2, name: 'sud-ouest' },    // gentle rise south-west of the town
  { a: [74, 58], b: [86, 66], w: 6, amp: 1.6, name: 'bois' },          // wooded hills in the south-east
];
for (const h of hexes.values()) {
  let v = 2;
  for (const r of ridges) {
    const d = segDist(h.x, h.z, ...r.a, ...r.b);
    v += r.amp * Math.exp(-(d * d) / (2 * r.w * r.w));
  }
  // mountain edge: rises toward the north edge, mostly east of the river, with a ragged foot
  const foot = 15 + 4 * (fbm(h.x * 0.06 + 2, 1.3) - 0.5) - 6 * (1 - smooth(20, 40, h.x));
  const m = Math.max(0, foot - h.z);
  if (m > 0) v += 5.2 * (1 - Math.exp(-m / 6)) + (fbm(h.x * 0.17 + 5, h.z * 0.17) - 0.35) * 4 * smooth(1, 8, m);
  h.h = Math.max(2, Math.round(v));
  h.mount = m > 1;
}

// --- town of Bayou: a ring of ramparts around flat streets ---
const centre = at(13, 20);
const R = 5;
const ring = [], inside = [];
for (const h of hexes.values()) {
  const d = hexDist(h, centre);
  if (d === R) ring.push(h);
  else if (d < R) inside.push(h);
}
const glacis = [...hexes.values()].filter((h) => { const d = hexDist(h, centre); return d > R && d <= R + 2; });
for (const h of [...inside, ...glacis]) { h.h = 2; fixed.add(key(h.q, h.r)); }
const eastGates = [byQR(centre.q + R, centre.r), byQR(centre.q + R, centre.r - 1)];
const westGate = byQR(centre.q - R, centre.r + 1);
const gates = [...eastGates, westGate];
const gateSet = new Set(gates.map((h) => key(h.q, h.r)));
const ramparts = ring.filter((h) => !gateSet.has(key(h.q, h.r)));
const rampartSet = new Set(ramparts.map((h) => key(h.q, h.r)));
for (const g of gates) { g.h = 2; g.terrain = 'road'; fixed.add(key(g.q, g.r)); }
for (const r of ramparts) { r.h = 4; fixed.add(key(r.q, r.r)); }
// the wall is sheer on every side; gates: barriers on their through edges, cliffs against the wall-walk
for (const r of ramparts) for (const n of neighbors(r)) {
  const nk = key(n.q, n.r);
  if (rampartSet.has(nk)) continue;
  setSeg(r, n, 'cliff');
  cliffEdges.add(edgeKey(key(r.q, r.r), nk));
}
for (const g of gates) for (const n of neighbors(g)) {
  const nk = key(n.q, n.r);
  if (rampartSet.has(nk) || gateSet.has(nk)) continue;
  setSeg(g, n, 'barriere');
}
// stone stairs from the streets up to the wall-walk: one in the middle of every side of the ring
const corners = DIRS.map(([dq, dr]) => byQR(centre.q + dq * R, centre.r + dr * R));
const cornerSet = new Set(corners.map((h) => key(h.q, h.r)));
const stairs = [];
for (let s = 0; s < 6; s++) {
  const a = corners[s], b = corners[(s + 1) % 6];
  const side = ramparts.filter((h) => !cornerSet.has(key(h.q, h.r)) && hexDist(h, a) + hexDist(h, b) === R);
  const mid = side.sort((x, y) => Math.abs(hexDist(x, a) - hexDist(x, b)) - Math.abs(hexDist(y, a) - hexDist(y, b)))[0];
  if (!mid || neighbors(mid).some((n) => gateSet.has(key(n.q, n.r)))) continue;
  const n = neighbors(mid).find((x) => hexDist(x, centre) === R - 1);
  if (!n) continue;
  setSeg(mid, n, 'escalier');
  stairs.push([n, mid]);
}
// streets: the main street between the gates, buildings around a central square
const mainStreet = linePath(westGate, eastGates[0]);
for (const h of mainStreet) if (!rampartSet.has(key(h.q, h.r))) h.terrain = 'road';
for (const h of inside) {
  if (h.terrain === 'road' || h === centre) continue;
  const d = hexDist(h, centre);
  if (d >= 1 && d <= R - 1 && neighbors(h).every((n) => !gateSet.has(key(n.q, n.r))) && fbm(h.x * 0.5, h.z * 0.5) > 0.34) h.terrain = 'building';
}
for (const [n] of stairs) if (n.terrain === 'building') n.terrain = 'plain';

// --- river: north edge -> in front of the town -> south edge; two hexes wide except at the fords and the bridge ---
const riverPath = wayPath([[24, 0], [23, 7], [25, 13], [24, 19], [22, 26], [23, 32], [25, 39]]);
const fordNorth = riverPath.find((h) => h.j === 10) || riverPath[10];
const fordSouth = riverPath.find((h) => h.j === 30) || riverPath[30];
const roadWest = wayPath([[0, 21], [westGate.c, westGate.j]]);
const roadEast = wayPath([[eastGates[0].c, eastGates[0].j], [30, 21], [42, 22], [52, 21], [59, 20]]);
const roadSet = new Set([...roadWest, ...roadEast].map((h) => key(h.q, h.r)));
const river = new Set();
for (const h of riverPath) river.add(h);
for (const h of riverPath) {
  if (h === fordNorth || h === fordSouth || roadSet.has(key(h.q, h.r))) continue;
  const east = neighbors(h).find((n) => n.c === h.c + 1 && !roadSet.has(key(n.q, n.r)));
  if (east && hexDist(east, centre) > R + 2) river.add(east);
}
for (const h of river) { h.h = 1; h.terrain = 'river'; fixed.add(key(h.q, h.r)); }
// low banks at water level so the water surface runs continuously from hex to hex
for (const h of river) for (const n of neighbors(h)) if (!river.has(n) && !fixed.has(key(n.q, n.r))) { n.h = 1; fixed.add(key(n.q, n.r)); }
const fords = [fordNorth, fordSouth];

// --- roads: west edge -> west gate; east gate -> bridge -> plain -> Zhao camp; tracks to the fords and the village ---
for (const h of [...roadWest, ...roadEast]) {
  if (rampartSet.has(key(h.q, h.r))) continue;
  h.terrain = river.has(h) ? 'bridge' : 'road';
}
const bridge = roadEast.find((h) => h.terrain === 'bridge');
const village = at(44, 11);
const tracks = [
  wayPath([[eastGates[1].c, eastGates[1].j - 1], [fordNorth.c - 1, fordNorth.j], [fordNorth.c + 1, fordNorth.j], [village.c, village.j]]),
  wayPath([[13, 27], [fordSouth.c - 1, fordSouth.j], [fordSouth.c + 1, fordSouth.j], [40, 30], [52, 27]]),
];
for (const t of tracks) for (const h of t) {
  if (rampartSet.has(key(h.q, h.r)) || river.has(h) || h.terrain === 'bridge' || inside.includes(h) || gateSet.has(key(h.q, h.r))) continue;
  if (h.mount) continue;
  h.terrain = 'road';
}

// --- relaxation: at most one level between neighbours, except across the town walls ---
for (let it = 0; it < 40; it++) {
  let changed = false;
  for (const h of hexes.values()) for (const n of neighbors(h)) {
    if (cliffEdges.has(edgeKey(key(h.q, h.r), key(n.q, n.r)))) continue;
    if (h.h - n.h > 1 && !fixed.has(key(h.q, h.r))) { h.h = n.h + 1; changed = true; }
  }
  if (!changed) break;
}
// roads and fords stay level with their neighbours where possible (no bumps on the tracks)
for (const h of hexes.values()) if (h.terrain === 'road' && !fixed.has(key(h.q, h.r))) {
  const lv = neighbors(h).filter((n) => n.terrain === 'road').map((n) => n.h);
  if (lv.length) { const m = Math.round(lv.reduce((a, b) => a + b, 0) / lv.length); if (neighbors(h).every((n) => Math.abs(n.h - m) <= 1 || cliffEdges.has(edgeKey(key(h.q, h.r), key(n.q, n.r))))) h.h = m; }
}
for (const h of hexes.values()) for (const n of neighbors(h)) {
  if (Math.abs(h.h - n.h) >= 2) {
    const ek = edgeKey(key(h.q, h.r), key(n.q, n.r));
    if (!segments[ek]) throw new Error(`dénivelé de ${Math.abs(h.h - n.h)} sans falaise en ${ek}`);
  }
}

// --- vegetation: forested foothills, the south-east woods (ambush), copses on the flanks ---
const villageHexes = new Set([village, ...neighbors(village)].map((h) => key(h.q, h.r)));
for (const h of hexes.values()) {
  if (h.terrain !== 'plain' || rampartSet.has(key(h.q, h.r)) || inside.includes(h) || glacis.includes(h) || villageHexes.has(key(h.q, h.r))) continue;
  if (h.c >= 35 && h.c <= 47 && h.j >= 3 && h.j <= 9) continue;          // clearing in the foothills (north Zhao camp)
  const n = fbm(h.x * 0.13 + 7, h.z * 0.13 + 2);
  if (h.mount && h.h >= 3 && h.h <= 7 && n > 0.42) h.terrain = 'forest';
  else if (h.x > 64 && h.z > 50 && n > 0.36) h.terrain = 'forest';            // south-east woods
  else if (h.x < 12 && h.z < 22 && n > 0.5) h.terrain = 'forest';             // north-west copses
  else if (h.x > 36 && h.x < 52 && h.z > 58 && n > 0.62) h.terrain = 'forest';
  else if (h.x > 74 && h.z < 30 && h.z > 18 && n > 0.66) h.terrain = 'forest';
}
// village of the plain, and a hamlet south of the town
for (const h of [village, ...neighbors(village).slice(0, 4)]) if (h.terrain !== 'road') h.terrain = 'building';
const hamlet = at(16, 34);
for (const h of [hamlet, neighbors(hamlet)[0], neighbors(hamlet)[3]]) if (h && h.terrain !== 'road' && h.terrain !== 'river') h.terrain = 'building';
for (const h of hexes.values()) if (h.terrain === 'building') {
  const lv = neighbors(h).filter((n) => n.terrain === 'building').map((n) => n.h);
  for (const v of lv) if (Math.abs(v - h.h) > 1) throw new Error('bâtiments sur une pente');
}

// --- decor ---
const fields = [];
for (const h of hexes.values()) {
  if (h.terrain !== 'plain' || h.mount || rampartSet.has(key(h.q, h.r)) || inside.includes(h)) continue;
  const n = fbm(h.x * 0.16 + 11, h.z * 0.16 + 5);
  const nearTown = hexDist(h, centre) <= R + 6 && h.c < 22;
  const nearVillage = hexDist(h, village) <= 4;
  const nearHamlet = hexDist(h, hamlet) <= 3;
  if ((nearTown && n > 0.46) || (nearVillage && n > 0.4) || (nearHamlet && n > 0.42)) fields.push(key(h.q, h.r));
}
const props = [];
const prop = (type, h, rot, label) => { if (h) props.push({ type, q: h.q, r: h.r, ...(rot != null ? { rot } : {}), ...(label ? { label } : {}) }); };
for (const g of eastGates) prop('porte', g, 0);
prop('porte', westGate, 3);
for (const c of corners) if (rampartSet.has(key(c.q, c.r)) && !neighbors(c).some((n) => gateSet.has(key(n.q, n.r)))) prop('tour', c);
for (const r of ramparts) if (neighbors(r).some((n) => gateSet.has(key(n.q, n.r))) && eastGates.some((g) => hexDist(g, r) === 1)) prop('banniere', r, null, '秦');
prop('banniere', westGate === null ? null : ramparts.find((r) => hexDist(r, westGate) === 1), null, '秦');
// Qin relief camp (south-west)
const qinCamp = at(8, 34);
for (const [dc, dj] of [[-2, -1], [0, -2], [2, -1], [-2, 2], [2, 2]]) prop('tente', at(qinCamp.c + dc, qinCamp.j + dj), 0);
prop('tente_cmd', qinCamp, 0);
prop('banniere', at(qinCamp.c + 1, qinCamp.j), null, '秦');
prop('feu', at(qinCamp.c - 1, qinCamp.j + 1));
// Zhao camp (east edge), palisade toward the plain
const zhaoCamp = at(56, 20);
for (const [dc, dj] of [[-1, -4], [0, -4], [1, -4], [-1, 4], [0, 4], [1, 4], [2, -2], [2, 2], [-2, -2], [-2, 2]]) prop('tente', at(zhaoCamp.c + dc, zhaoCamp.j + dj), 3);
prop('tente_cmd', at(zhaoCamp.c + 1, zhaoCamp.j - 1), 3);
for (const [dc, dj] of [[-2, -1], [-2, 3], [0, -2], [0, 2]]) prop('banniere', at(zhaoCamp.c + dc, zhaoCamp.j + dj), null, '趙');
prop('feu', at(zhaoCamp.c - 1, zhaoCamp.j - 3));
prop('feu', at(zhaoCamp.c - 1, zhaoCamp.j + 3));
const palC = zhaoCamp.c - 4;
for (let dj = -6; dj <= 6; dj++) {
  const h = at(palC, zhaoCamp.j + dj);
  if (!h || h.terrain === 'road' || h.terrain === 'river' || h.terrain === 'bridge') continue;
  for (const n of neighbors(h)) if (n.c === palC - 1 && !segments[edgeKey(key(h.q, h.r), key(n.q, n.r))]) setSeg(h, n, Math.abs(dj) === 3 ? 'chevaux_de_frise' : 'barriere');
}
// lookout on the central ridge, banner on the highest foothill
const ridgeTop = [...hexes.values()].filter((h) => !h.mount && h.x > 48 && h.x < 72 && h.z > 40 && h.z < 60).sort((a, b) => b.h - a.h || a.x - b.x)[0];
if (ridgeTop.terrain === 'forest') ridgeTop.terrain = 'plain';
const foothill = [...hexes.values()].filter((h) => h.mount && h.terrain !== 'forest' && h.x > 40 && h.x < 70 && neighbors(h).every((n) => n.h <= h.h)).sort((a, b) => b.h - a.h)[0];
if (foothill) prop('banniere', foothill, null, '趙');

// --- deployment zones (order: Qin town, Zhao camp, Zhao north foothills, Qin relief south-west) ---
const okTile = (h) => !['river', 'bridge', 'forest', 'building'].includes(h.terrain) && !rampartSet.has(key(h.q, h.r)) && !gateSet.has(key(h.q, h.r));
const zoneOf = (pred) => [...hexes.values()].filter((h) => okTile(h) && pred(h)).map((h) => key(h.q, h.r));
const zones = [
  { name: 'Qin — Bayou', tiles: zoneOf((h) => hexDist(h, centre) <= R - 1 || (h.c >= 2 && h.c <= 9 && h.j >= 14 && h.j <= 26 && hexDist(h, centre) > R)) },
  { name: 'Zhao — camp de l\'est', tiles: zoneOf((h) => h.c >= 51 && h.c <= 59 && h.j >= 14 && h.j <= 26) },
  { name: 'Zhao — monts du nord', tiles: zoneOf((h) => h.c >= 34 && h.c <= 48 && h.j >= 3 && h.j <= 9 && h.h <= 6) },
  { name: 'Qin — renforts du sud', tiles: zoneOf((h) => h.c >= 3 && h.c <= 13 && h.j >= 31 && h.j <= 39) },
];

// --- objectives ---
const forestCentre = [...hexes.values()].filter((h) => h.terrain === 'forest' && h.x > 66 && h.z > 52).sort((a, b) => Math.hypot(a.x - 76, a.z - 60) - Math.hypot(b.x - 76, b.z - 60))[0];
const objectives = [
  { id: 'porte', q: eastGates[0].q, r: eastGates[0].r, type: 'fort', points: 3, name: 'Porte de Bayou' },
  { id: 'pont', q: bridge.q, r: bridge.r, type: 'pont', points: 1, name: 'Pont de Bayou' },
  { id: 'gue', q: fordNorth.q, r: fordNorth.r, type: 'pont', points: 1, name: 'Gué du nord' },
  { id: 'colline', q: ridgeTop.q, r: ridgeTop.r, type: 'colline', points: 2, name: 'Colline centrale' },
  { id: 'bois', q: forestCentre.q, r: forestCentre.r, type: 'bois', points: 1, name: 'Bois du sud-est' },
  { id: 'village', q: village.q, r: village.r, type: 'village', points: 1, name: 'Village de la plaine' },
];

const height = {}, terrain = {};
for (const h of hexes.values()) {
  height[key(h.q, h.r)] = h.h;
  if (h.terrain !== 'plain') terrain[key(h.q, h.r)] = h.terrain;
}
const map = {
  format: 2,
  id: 'bayou',
  name: 'Plaine de Bayou',
  description: "La ville fortifiée de Bayou, ceinte de remparts (porte double à l'est, poterne à l'ouest, escaliers vers le chemin de ronde), garde une rivière franchie par un pont et deux gués. À l'est s'étend une vaste plaine vallonnée, faite pour la cavalerie, avec une colline centrale et un village ; au nord, le pied des montagnes et ses forêts ; au sud-est, des bois épais où une armée peut attendre son heure.",
  author: 'Kingdom Battleground',
  updatedAt: new Date().toISOString(),
  background: null,
  height, terrain, segments,
  decor: { fields, ramparts: ramparts.map((h) => key(h.q, h.r)), props },
  zones, objectives,
};
writeFileSync(OUT, JSON.stringify(map));
const count = (o) => Object.values(o).reduce((a, v) => ((a[v] = (a[v] || 0) + 1), a), {});
console.log(`${OUT}\n${hexes.size} cases, hauteurs ${Math.min(...Object.values(height))}–${Math.max(...Object.values(height))}`);
console.log('terrains', count(terrain), '\nsegments', count(segments));
console.log('remparts', ramparts.length, 'portes', gates.map((h) => key(h.q, h.r)).join(' '), 'escaliers', stairs.length, 'gués', fords.map((h) => key(h.q, h.r)).join(' '), 'pont', key(bridge.q, bridge.r));
console.log('zones', zones.map((z) => `${z.name}: ${z.tiles.length}`).join(' · '));
console.log('objectifs', objectives.map((o) => `${o.name} ${o.q},${o.r}`).join(' · '));
