// Line of sight on the hex grid (RULES.vision.los): a straight sight line from the observer's eye to the target
// hex, traced through every hex and edge it crosses (two lines nudged to either side so a ray grazing a corner
// is clear if either side is), blocked by relief higher than the line, forest canopies, buildings and walls.
const { RULES } = require('./rules');

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const NUDGE = 1e-4;

// Dense per-map grid: heights, flags (1 on map, 2 forest, 4 building) and the top of sight-blocking segments per edge
function buildGrid(room) {
  const L = RULES.vision.los;
  let q0 = Infinity, q1 = -Infinity, r0 = Infinity, r1 = -Infinity;
  for (const k of Object.keys(room.hexMap)) {
    const h = room.hexMap[k];
    if (h.q < q0) q0 = h.q; if (h.q > q1) q1 = h.q;
    if (h.r < r0) r0 = h.r; if (h.r > r1) r1 = h.r;
  }
  if (q0 === Infinity) { q0 = q1 = r0 = r1 = 0; }
  const W = q1 - q0 + 1, Hh = r1 - r0 + 1;
  const height = new Float32Array(W * Hh);
  const flags = new Uint8Array(W * Hh);
  const edge = new Float32Array(W * Hh * 6).fill(-Infinity);
  const idx = (q, r) => (q < q0 || q > q1 || r < r0 || r > r1) ? -1 : (q - q0) + (r - r0) * W;
  for (const k of Object.keys(room.hexMap)) {
    const { q, r } = room.hexMap[k];
    const i = idx(q, r);
    height[i] = room.heightData[k] || 0;
    const t = room.terrainData[k] || 'plain';
    flags[i] = 1 | (L.canopyTerrains.includes(t) ? 2 : 0) | (L.buildingTerrains.includes(t) ? 4 : 0);
  }
  const segDefs = room._segments();
  for (const [ek, type] of Object.entries(room.segmentData || {})) {
    let extra = L.segmentHeights[type];
    if (extra == null) {
      const def = segDefs[type];
      extra = def && def.infranchissable && !L.terrainSegments.includes(type) ? L.defaultWallHeight : null;
    }
    if (extra == null) continue;
    const [a, b] = ek.split('|').map((s) => s.split(',').map(Number));
    const ia = idx(a[0], a[1]), ib = idx(b[0], b[1]);
    if (ia < 0 || ib < 0) continue;
    const top = Math.max(height[ia], height[ib]) + extra;
    const da = DIRS.findIndex(([dq, dr]) => a[0] + dq === b[0] && a[1] + dr === b[1]);
    if (da < 0) continue;
    edge[ia * 6 + da] = top;
    edge[ib * 6 + ((da + 3) % 6)] = top;
  }
  return { q0, q1, r0, r1, W, height, flags, edge, idx };
}

function grid(room) {
  if (!room._losGrid) room._losGrid = buildGrid(room);
  return room._losGrid;
}

const dirIndex = (dq, dr) => {
  for (let d = 0; d < 6; d++) if (DIRS[d][0] === dq && DIRS[d][1] === dr) return d;
  return -1;
};

// One nudged sight line: true if nothing blocks it
function traceLine(G, o, t, n, s, nudge) {
  const L = RULES.vision.los;
  const ax = o.q + nudge, az = o.r + 2 * nudge, ay = -ax - az;
  const bx = t.q + nudge, bz = t.r + 2 * nudge, by = -bx - bz;
  let pq = o.q, pr = o.r, pi = G.idx(o.q, o.r);
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    let x = ax + (bx - ax) * f, y = ay + (by - ay) * f, z = az + (bz - az) * f;
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy > dz) ry = -rx - rz; else rz = -rx - ry;
    const q = rx, r = rz;
    const ci = G.idx(q, r);
    // edge crossed between the previous hex and this one (walls, palisades)
    const d = dirIndex(q - pq, r - pr);
    if (d >= 0 && pi >= 0) {
      const top = G.edge[pi * 6 + d];
      if (top > -Infinity && top > s.z0 + (s.z1 - s.z0) * ((i - 0.5) / n) + 1e-6) return false;
    }
    if (i < n && ci >= 0) {
      const line = s.z0 + (s.z1 - s.z0) * f;
      const fl = G.flags[ci];
      let b = G.height[ci];
      if (fl & 4) {
        if (s.inBuilding) return false;
        b += L.buildingHeight;
      }
      if ((fl & 2) && !(n <= s.forestSight) && !(s.seesOverLowerForest && G.height[ci] < s.h0)) b += L.canopyHeight;
      if (b > line + 1e-6) return false;
    }
    pq = q; pr = r; pi = ci;
  }
  return true;
}

// Can an observer at o (with sight options) see hex t? n = hex distance
function canSeeHex(room, o, t, n, sight) {
  if (n === 0) return true;
  const G = grid(room);
  const io = G.idx(o.q, o.r), it = G.idx(t.q, t.r);
  if (io < 0 || it < 0) return false;
  const L = RULES.vision.los;
  const s = {
    h0: G.height[io],
    z0: G.height[io] + L.eyeHeight,
    z1: G.height[it] + L.targetHeight,
    forestSight: sight.forestSight,
    seesOverLowerForest: !!sight.seesOverLowerForest,
    inBuilding: !!(G.flags[io] & 4),
  };
  return traceLine(G, o, t, n, s, NUDGE) || traceLine(G, o, t, n, s, -NUDGE);
}

function resetLos(room) {
  room._losGrid = null;
  room._losCache = null;
}

module.exports = { canSeeHex, resetLos, buildGrid };
