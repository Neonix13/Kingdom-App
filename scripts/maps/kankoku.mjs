// Generates data/maps/kankoku.json — "Col de Kankoku": a pass closed by Qin's fortified gate.
// West: Qin basin, fortress courtyard and the road to the capital. Centre: the gorge, the walls (wall-walk hexes two
// levels above the floor, cliffs on their outer face) and the double gate (barriers). East: the plain where the coalition
// camps, crossed by a river (one bridge). North of the gorge: a plateau overlooking the walls. South: a forested
// mountain trail around the fortress, crossing the wall line by a ladder (infantry only).
// A continuous cliff line runs along the wall through both massifs: the gate and the ladder are the only crossings.
// Usage: node scripts/maps/kankoku.mjs [--out data/maps/kankoku.json]
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? resolve(process.argv[outArg + 1]) : join(ROOT, 'data', 'maps', 'kankoku.json');

const W = 64, H = 40;
const S3 = Math.sqrt(3);
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const key = (q, r) => `${q},${r}`;
const qr = (c, j) => [c, j - Math.floor(c / 2)];
const kcj = (c, j) => key(...qr(c, j));
// canonical edge key, same order as segmentEdgeKey (game/HexUtils.js): smaller q first, then smaller r
const edgeKey = (a, b) => {
  const [q1, r1] = a.split(',').map(Number), [q2, r2] = b.split(',').map(Number);
  return q1 < q2 || (q1 === q2 && r1 < r2) ? `${a}|${b}` : `${b}|${a}`;
};
const smooth = (a, b, t) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
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
  hexes.set(key(q, r), { q, r, c, j, x: 1.5 * q, z: S3 * (r + q / 2), h: 0, terrain: 'plain' });
}
const at = (c, j) => hexes.get(kcj(c, j));
const neighbors = (h) => DIRS.map(([dq, dr]) => hexes.get(key(h.q + dq, h.r + dr))).filter(Boolean);
const segments = {};
const setSeg = (a, b, t) => { segments[edgeKey(key(a.q, a.r), key(b.q, b.r))] = t; };

// --- valley shape ---
const GATE_C = 24;
const zc = (x) => 34.5 + 2.2 * Math.sin(x / 15) * smooth(40, 60, x);
function halfWidth(x) {
  if (x < 26) return lerp(12.5, 9, smooth(0, 26, x));
  if (x < 36) return lerp(9, 4.6, smooth(26, 36, x));
  if (x < 52) return lerp(4.6, 6.5, smooth(36, 52, x));
  return lerp(6.5, 25, smooth(52, 74, x));
}
function floorH(x, z) {
  if (x < 37) return 3;
  if (x < 52) return x < 46 ? 3 : 2;
  return 2 + (fbm(x * 0.09, z * 0.09) > 0.68 ? 1 : 0);
}
const GATE_X = 1.5 * GATE_C;
const gateJ = Math.round(zc(GATE_X) / S3 - (GATE_C & 1) / 2);
const gate = at(GATE_C, gateJ);

const fixed = new Set();            // heights the relaxation must not change
const cliffEdges = new Set();       // edges allowed to keep a drop >= 2

for (const h of hexes.values()) {
  const d = Math.abs(h.z - zc(h.x)) - halfWidth(h.x);
  h.valley = d <= 0.35;
  const fl = floorH(h.x, h.z);
  if (h.valley) h.h = fl;
  else {
    const ridge = 1 - Math.abs(fbm(h.x * 0.07 + 3, h.z * 0.07) * 2 - 1);
    h.h = Math.min(11, Math.round(fl + 1 + d * 0.5 + ridge * 3 + fbm(h.x * 0.2, h.z * 0.2) * 1.5));
  }
}

// --- gorge cliffs: sheer walls between the floor and the massifs around the gate ---
for (const h of hexes.values()) {
  if (!h.valley || h.x < 28 || h.x > 49) continue;
  for (const n of neighbors(h)) {
    if (n.valley) continue;
    n.h = Math.max(n.h, h.h + 3);
    cliffEdges.add(edgeKey(key(h.q, h.r), key(n.q, n.r)));
    setSeg(h, n, 'cliff');
  }
}

// --- north plateau overlooking the gate (east of the wall line), reached by a slope from the plain ---
const plateau = [];
for (const h of hexes.values()) {
  const dz = zc(h.x) - halfWidth(h.x) - h.z;
  if (h.x >= 39 && h.x <= 46.5 && dz > 1.2 && dz < 6.5) { h.h = 6; h.valley = false; fixed.add(key(h.q, h.r)); plateau.push(h); }
}

// --- wall line: ramparts, terrace, gate ---
const ramparts = [];
for (let j = 0; j < H; j++) {
  const h = at(GATE_C, j);
  if (!h.valley || h === gate) continue;
  h.h = gate.h + 2;
  fixed.add(key(h.q, h.r));
  ramparts.push(h);
}
const rampartSet = new Set(ramparts.map((h) => key(h.q, h.r)));
for (const r of ramparts) for (const n of neighbors(r)) {
  if (n.c === GATE_C - 1 && n.valley && n.j !== gateJ) { n.h = gate.h + 1; fixed.add(key(n.q, n.r)); n.terrace = true; }
}
fixed.add(key(gate.q, gate.r));
gate.terrain = 'road';

// continuous cliff line between column GATE_C and GATE_C + 1 (both massifs), gate = barriers
const line = [];
for (const h of hexes.values()) {
  if (h.c !== GATE_C) continue;
  for (const n of neighbors(h)) if (n.c === GATE_C + 1) line.push([h, n]);
}
for (const [a, b] of line) { setSeg(a, b, 'cliff'); cliffEdges.add(edgeKey(key(a.q, a.r), key(b.q, b.r))); }
for (const n of neighbors(gate)) {
  if (n.c !== gate.c) { setSeg(gate, n, 'barriere'); n.terrain = 'road'; }
  else { setSeg(gate, n, 'cliff'); cliffEdges.add(edgeKey(key(gate.q, gate.r), key(n.q, n.r))); }
}
for (const r of ramparts) for (const n of neighbors(r)) {
  if (n.c === GATE_C + 1) { cliffEdges.add(edgeKey(key(r.q, r.r), key(n.q, n.r))); }
}

// --- southern trail: east trailhead -> summit -> ladder over the wall line -> Qin basin ---
const trailWaypoints = [[50, 29], [46, 31], [41, 33], [36, 34], [31, 34], [27, 33], [25, 32], [24, 32], [22, 31], [19, 28], [16, 24]];
const trail = [];
function linePath(a, b) {
  const A = at(...a), B = at(...b);
  const out = [];
  let cur = A;
  out.push(cur);
  let guard = 0;
  while (cur !== B && guard++ < 200) {
    let best = null, bd = Infinity;
    for (const n of neighbors(cur)) {
      const d = Math.hypot(n.x - B.x, n.z - B.z);
      if (d < bd) { bd = d; best = n; }
    }
    cur = best;
    out.push(cur);
  }
  return out;
}
for (let i = 0; i < trailWaypoints.length - 1; i++) {
  for (const h of linePath(trailWaypoints[i], trailWaypoints[i + 1])) if (!trail.includes(h)) trail.push(h);
}
const summitIdx = trail.findIndex((h) => h.c === 31);
const startH = at(50, 29).h;
trail.forEach((h, i) => {
  let v;
  if (i <= summitIdx) v = Math.round(lerp(Math.min(startH, 3), 8, smooth(0, summitIdx, i)));
  else v = Math.round(lerp(8, 3, smooth(summitIdx, trail.length - 1, i)));
  h.h = v;
  h.trail = true;
  fixed.add(key(h.q, h.r));
});
// smooth the profile so no step climbs more than one level
for (let pass = 0; pass < 4; pass++) for (let i = 1; i < trail.length; i++) {
  const a = trail[i - 1], b = trail[i];
  if (b.h - a.h > 1) b.h = a.h + 1;
  if (a.h - b.h > 1) a.h = b.h + 1;
}
// ladder where the trail crosses the cliff line
let ladder = null;
for (let i = 1; i < trail.length; i++) {
  const a = trail[i - 1], b = trail[i];
  const lo = a.c < b.c ? a : b, hi = a.c < b.c ? b : a;
  if (lo.c === GATE_C && hi.c === GATE_C + 1) { setSeg(lo, hi, 'echelle'); ladder = [lo, hi]; break; }
}
if (!ladder) throw new Error('le sentier ne traverse pas la ligne de falaises');

// --- river: from the north edge through a cleft, across the plain (one bridge on the road), out by the south edge ---
const riverWay = [[52, 0], [52, 8], [53, 16], [54, 22], [56, 28], [58, 33], [59, 39]];
const river = [];
for (let i = 0; i < riverWay.length - 1; i++) for (const h of linePath(riverWay[i], riverWay[i + 1])) if (!river.includes(h)) river.push(h);
for (const h of river) { h.h = 1; h.terrain = 'river'; fixed.add(key(h.q, h.r)); h.valleyRiver = true; }
// low banks at the water's level: the water surface then runs continuously from hex to hex
for (const h of river) for (const n of neighbors(h)) if (n.terrain !== 'river' && !fixed.has(key(n.q, n.r))) { n.h = 1; fixed.add(key(n.q, n.r)); }

// --- road: west edge -> gate -> plain -> camp (east edge) ---
const road = [];
const roadWay = [[0, Math.round(zc(0) / S3)], [12, Math.round(zc(18) / S3) - 6], [GATE_C - 2, gateJ], [GATE_C, gateJ], [GATE_C + 2, gateJ], [40, Math.round(zc(60) / S3 - 0.5)], [52, Math.round(zc(78) / S3)], [63, Math.round(zc(94) / S3)]];
for (let i = 0; i < roadWay.length - 1; i++) for (const h of linePath(roadWay[i], roadWay[i + 1])) if (!road.includes(h)) road.push(h);
for (const h of road) {
  if (rampartSet.has(key(h.q, h.r))) continue;
  if (h.terrain === 'river') { h.terrain = 'bridge'; continue; }
  if (!h.trail) h.terrain = 'road';
}
const bridge = road.find((h) => h.terrain === 'bridge');

// --- relaxation: at most one level between neighbours, except across cliffs ---
for (let it = 0; it < 30; it++) {
  let changed = false;
  for (const h of hexes.values()) {
    for (const n of neighbors(h)) {
      if (cliffEdges.has(edgeKey(key(h.q, h.r), key(n.q, n.r)))) continue;
      if (h.h - n.h > 1 && !fixed.has(key(h.q, h.r))) { h.h = n.h + 1; changed = true; }
    }
  }
  if (!changed) break;
}
// trail and plateau edges against higher mountain: keep climbable by lowering the mountain side (already done), and
// mark any remaining >= 2 drop as cliff so the rules and the editor agree
for (const h of hexes.values()) for (const n of neighbors(h)) {
  if (h.h - n.h >= 2) {
    const ek = edgeKey(key(h.q, h.r), key(n.q, n.r));
    if (!segments[ek]) { segments[ek] = 'cliff'; }
  }
}

// --- terrain: forests on the slopes, the trail through the woods, villages, fortress buildings ---
for (const h of hexes.values()) {
  if (h.terrain !== 'plain') continue;
  if (rampartSet.has(key(h.q, h.r)) || h.terrace) continue;
  if (h.trail) { h.terrain = 'forest'; continue; }
  const n = fbm(h.x * 0.11 + 7, h.z * 0.11 + 2);
  if (!h.valley && h.h >= 4 && h.h <= 8 && n > 0.45) h.terrain = 'forest';
  else if (h.valley && h.x > 60 && n > 0.66) h.terrain = 'forest';
  else if (h.valley && h.x < 20 && n > 0.72) h.terrain = 'forest';
}
const buildings = [[20, gateJ - 5], [20, gateJ - 4], [21, gateJ - 5], [20, gateJ + 4], [21, gateJ + 4], [20, gateJ + 5], [54, gateJ - 4], [55, gateJ - 4], [55, gateJ - 5], [6, gateJ - 3], [7, gateJ - 3]];
for (const [c, j] of buildings) { const h = at(c, j); if (h && h.valley && h.terrain !== 'road' && h.terrain !== 'river' && h.terrain !== 'bridge') { h.terrain = 'building'; h.h = Math.round(h.h); } }
for (const b of buildings) { const h = at(...b); if (h && h.terrain === 'building') for (const n of neighbors(h)) if (n.terrain === 'building') n.h = h.h; }

// --- decor ---
const fields = [];
for (const h of hexes.values()) {
  if (h.terrain !== 'plain' || !h.valley) continue;
  const n = fbm(h.x * 0.15 + 11, h.z * 0.15 + 5);
  if ((h.x < 18 && h.z < zc(h.x) - 2 && n > 0.5) || (h.x > 64 && h.x < 82 && h.z > zc(h.x) + 3 && n > 0.55)) fields.push(key(h.q, h.r));
}
const props = [];
const prop = (type, c, j, rot, label) => { const h = at(c, j); if (h) props.push({ type, q: h.q, r: h.r, ...(rot != null ? { rot } : {}), ...(label ? { label } : {}) }); };
props.push({ type: 'porte', q: gate.q, r: gate.r, rot: 0 });
const rampSorted = [...ramparts].sort((a, b) => a.j - b.j);
prop('tour', rampSorted[0].c, rampSorted[0].j);
prop('tour', rampSorted[rampSorted.length - 1].c, rampSorted[rampSorted.length - 1].j);
const north = rampSorted.filter((h) => h.j < gateJ), south = rampSorted.filter((h) => h.j > gateJ);
if (north.length > 3) prop('tour', GATE_C, north[Math.floor(north.length / 2)].j);
if (south.length > 3) prop('tour', GATE_C, south[Math.floor(south.length / 2)].j);
// Qin banners and camp behind the gate
prop('banniere', GATE_C - 2, gateJ - 1, null, '秦');
prop('banniere', GATE_C - 2, gateJ + 1, null, '秦');
for (const [c, j] of [[13, gateJ - 2], [14, gateJ - 2], [13, gateJ + 2], [15, gateJ + 2], [11, gateJ + 2]]) prop('tente', c, j, 3);
prop('feu', 14, gateJ + 3);
prop('feu', 12, gateJ - 1);
// trail: stairs on its steepest steps, summit banner
for (let i = 1; i < trail.length - 1; i++) {
  const a = trail[i - 1], b = trail[i], c = trail[i + 1];
  if (Math.abs(c.h - a.h) >= 2 && i % 2 === 0) {
    const d = DIRS.findIndex(([dq, dr]) => b.q + dq === c.q && b.r + dr === c.r);
    props.push({ type: 'escalier', q: b.q, r: b.r, rot: c.h > a.h ? Math.max(0, d) : (Math.max(0, d) + 3) % 6 });
  }
}
const summit = trail[summitIdx];
props.push({ type: 'banniere', q: summit.q, r: summit.r, label: '峠' });
// coalition camp: rows of tents, command tent, banners of the allied kingdoms, fires, palisade toward the pass
const campC = 58, campJ = Math.round(zc(1.5 * 58) / S3);
for (const [dc, dj] of [[-2, -4], [-1, -4], [0, -4], [-2, 4], [-1, 4], [0, 4], [2, -3], [3, -3], [2, 3], [3, 3], [4, -1], [4, 2]]) prop('tente', campC + dc, campJ + dj, 3);
prop('tente_cmd', campC + 2, campJ, 3);
const kingdoms = ['楚', '趙', '魏', '韓', '燕'];
[[-2, -2], [-2, 2], [0, -2], [0, 2], [2, -1]].forEach(([dc, dj], i) => prop('banniere', campC + dc, campJ + dj, null, kingdoms[i]));
prop('feu', campC - 1, campJ - 3);
prop('feu', campC - 1, campJ + 3);
prop('feu', campC + 3, campJ + 1);
// palisade: barriers on the west edges of the camp column, with a gap on the road
const palC = campC - 4;
for (let dj = -6; dj <= 6; dj++) {
  const h = at(palC, campJ + dj);
  if (!h || !h.valley || h.terrain === 'road' || h.terrain === 'river' || h.terrain === 'bridge') continue;
  for (const n of neighbors(h)) if (n.c === palC - 1 && !segments[edgeKey(key(h.q, h.r), key(n.q, n.r))]) setSeg(h, n, Math.abs(dj) === 2 ? 'chevaux_de_frise' : 'barriere');
}

// --- deployment zones (order: Qin gate, coalition camp, coalition north, Qin rear) ---
const zoneOf = (pred) => [...hexes.values()].filter((h) => h.valley && !['river', 'bridge'].includes(h.terrain) && pred(h)).map((h) => key(h.q, h.r));
const zones = [
  { name: 'Qin — forteresse', tiles: [...zoneOf((h) => h.c >= 17 && h.c <= 23 && Math.abs(h.z - zc(h.x)) <= 8), ...ramparts.map((h) => key(h.q, h.r))] },
  { name: 'Coalition — camp', tiles: zoneOf((h) => h.c >= 56 && h.c <= 62 && Math.abs(h.z - zc(h.x)) <= 7) },
  { name: 'Coalition — plaine nord', tiles: zoneOf((h) => h.c >= 47 && h.c <= 57 && h.z < zc(h.x) - 12 && h.z > zc(h.x) - 24) },
  { name: 'Qin — arrière', tiles: zoneOf((h) => h.c >= 2 && h.c <= 9 && Math.abs(h.z - zc(h.x)) <= 7) },
];

// --- objectives ---
const plateauTop = plateau.reduce((a, h) => (!a || Math.hypot(h.x - gate.x, h.z - gate.z) < Math.hypot(a.x - gate.x, a.z - gate.z) ? h : a), null);
const objectives = [
  { id: 'porte', q: gate.q, r: gate.r, type: 'fort', points: 3, name: 'Porte de Kankoku' },
  { id: 'sommet', q: summit.q, r: summit.r, type: 'colline', points: 1, name: 'Sommet du sentier' },
  { id: 'guet', q: plateauTop.q, r: plateauTop.r, type: 'colline', points: 1, name: 'Hauteur du guet' },
  { id: 'camp', q: at(campC + 2, campJ).q, r: at(campC + 2, campJ).r, type: 'camp', points: 2, name: 'Camp de la coalition' },
];
if (bridge) objectives.push({ id: 'pont', q: bridge.q, r: bridge.r, type: 'pont', points: 1, name: 'Pont de la plaine' });

const height = {}, terrain = {};
for (const h of hexes.values()) {
  height[key(h.q, h.r)] = h.h;
  if (h.terrain !== 'plain') terrain[key(h.q, h.r)] = h.terrain;
}
const map = {
  format: 2,
  id: 'kankoku',
  name: 'Col de Kankoku',
  description: "Une passe étroite entre deux massifs, fermée par la grande porte fortifiée de Qin. À l'est, la plaine où campe la coalition, traversée par une rivière ; au nord, une hauteur domine les remparts ; au sud, un sentier de montagne contourne la forteresse à pied (échelle, infanterie seulement).",
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
console.log('remparts', ramparts.length, 'porte', key(gate.q, gate.r), 'échelle', ladder.map((h) => key(h.q, h.r)).join(' / '), 'sentier', trail.length, 'cases');
console.log('zones', zones.map((z) => `${z.name}: ${z.tiles.length}`).join(' · '));
console.log('objectifs', objectives.map((o) => `${o.name} ${o.q},${o.r}`).join(' · '));
