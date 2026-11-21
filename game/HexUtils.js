// Axial coordinate hex utilities (flat-top hexagons)
// 1 hex = 100m

const maps = require('./maps');
const SEGMENT_DEFS = require('./data/segments');
const rules = require('./rules');

function getTerrainData(map = maps.getMap('default')) {
  return maps.terrainLookup(map);
}

function getSegmentData(map = maps.getMap('default')) {
  return map.segments || {};
}

function segmentEdgeKey(q1, r1, q2, r2) {
  if (q1 < q2 || (q1 === q2 && r1 < r2)) return `${q1},${r1}|${q2},${r2}`;
  return `${q2},${r2}|${q1},${r1}`;
}

const HEX_DIRECTIONS = [
  [1, 0], [1, -1], [0, -1],
  [-1, 0], [-1, 1], [0, 1],
];

function hexDistance(q1, r1, q2, r2) {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

function hexKey(q, r) {
  return `${q},${r}`;
}

function hexNeighbors(q, r) {
  return HEX_DIRECTIONS.map(([dq, dr]) => [q + dq, r + dr]);
}

// Get all hexes within radius from center
function hexesInRange(q, r, radius) {
  const results = [];
  for (let dq = -radius; dq <= radius; dq++) {
    const r1 = Math.max(-radius, -dq - radius);
    const r2 = Math.min(radius, -dq + radius);
    for (let dr = r1; dr <= r2; dr++) {
      results.push([q + dq, r + dr]);
    }
  }
  return results;
}

// Playable hexes of a map: exactly the keys of map.height, terrain defaulting to plain
function buildHexMap(map) {
  const hexes = {};
  for (const key of Object.keys(map.height)) {
    const [q, r] = key.split(',').map(Number);
    hexes[key] = { q, r, terrain: map.terrain[key] || 'plain', height: map.height[key] || 0 };
  }
  return hexes;
}

function generateHexMap() {
  return buildHexMap(maps.getMap('default'));
}

// Shortest path within maxSpeed using the shared movement rules (public/js/rules.js).
// blocked(key) decides which hexes cannot be entered (default: any unit in unitMap).
// Returns { path: [[q, r], ...], cost } or null.
function findPathCost(hexMap, unitMap, q1, r1, q2, r2, maxSpeed, unit, segMap = getSegmentData(), blocked = null, table = null, minStep = false, transit = null) {
  if (q1 === q2 && r1 === r2) return { path: [], cost: 0 };
  const { dist, prev } = rules.reachable(table || rules.MOVE_TABLE, {
    start: { q: q1, r: r1 },
    maxCost: maxSpeed,
    minStep,
    mounted: rules.isMounted(unit),
    hexAt: (k) => hexMap[k] || null,
    blocked: blocked || ((k) => !!unitMap[k]),
    transit,
    segAt: (a, b, c, d) => segMap[segmentEdgeKey(a, b, c, d)] || null,
  });
  const key = hexKey(q2, r2);
  const path = rules.pathFromPrev(prev, hexKey(q1, r1), key);
  return path ? { path, cost: dist.get(key) } : null;
}

function findPath(hexMap, unitMap, q1, r1, q2, r2, maxSpeed, playerId, unit, segMap = getSegmentData(), blocked = null) {
  const res = findPathCost(hexMap, unitMap, q1, r1, q2, r2, maxSpeed, unit, segMap, blocked);
  return res ? res.path : null;
}

// Coût terrain pour le déploiement : base radiale + léger modificateur terrain
// La distance au centre est le facteur dominant → forme circulaire
// Le modificateur terrain est faible → légère préférence plaines/routes
const DEPLOY_INTER_ZONE_EXCLUSION = 8;

function fixedZones(numPlayers, zones, td) {
  if (!Array.isArray(zones) || zones.length < numPlayers) return null;
  const picked = zones.slice(0, numPlayers).map((z, i) => {
    const tiles = (z.tiles || [])
      .filter((k) => typeof k === 'string' && td[k] && td[k] !== 'river')
      .map((k) => { const [q, r] = k.split(',').map(Number); return { q, r }; });
    if (!tiles.length) return null;
    const cq = tiles.reduce((s, t) => s + t.q, 0) / tiles.length;
    const cr = tiles.reduce((s, t) => s + t.r, 0) / tiles.length;
    let center = tiles[0], best = Infinity;
    for (const t of tiles) {
      const d = hexDistance(t.q, t.r, Math.round(cq), Math.round(cr));
      if (d < best) { best = d; center = t; }
    }
    return { q: center.q, r: center.r, tiles, mapZone: i };
  });
  return picked.every(Boolean) ? picked : null;
}

// map: a registry map (game/maps.js). Fixed map.zones are used when there are enough of them.
function getStartingZones(numPlayers, mapRadius, budget, map = maps.getMap('default')) {
  const td = getTerrainData(map);
  const sd = getSegmentData(map);
  const fixed = fixedZones(numPlayers, map.zones, td);
  if (fixed) return fixed;
  // Every player gets exactly maxTiles tiles (equal zones)
  const maxTiles = Math.floor(4 * (budget || 2500) / 1000 + 2);
  return _randomZones(numPlayers, maxTiles, td, sd);
}

// Tile scoring (lower = better): distance to the player's centre, x0.9 road, x1.2 forest/building/bridge, x1.3 river,
// x1.2 per segment crossed on the shortest path, x4 too close to the map's battle centre, x5 too close to another zone;
// then isolated tiles are penalised (x2) until the selection is stable.
function _randomZones(numPlayers, maxTiles, td, sd) {
  const allHexes = Object.entries(td).map(([key, terrain]) => { const [q, r] = key.split(',').map(Number); return { q, r, terrain }; });
  const has = (k) => Object.prototype.hasOwnProperty.call(td, k);
  const centerExclusion = 3 + numPlayers;
  const borderExclusion = 15 + numPlayers;

  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const { q, r } of allHexes) {
    if (q < minQ) minQ = q; if (q > maxQ) maxQ = q;
    if (r < minR) minR = r; if (r > maxR) maxR = r;
  }
  const inside = ({ q, r }) => q >= minQ + borderExclusion && q <= maxQ - borderExclusion && r >= minR + borderExclusion && r <= maxR - borderExclusion;
  const land = allHexes.filter(h => h.terrain !== 'river');
  const centerCandidates = land.filter(inside);
  const centralHex = centerCandidates[Math.floor(Math.random() * centerCandidates.length)]
    || land[Math.floor(Math.random() * land.length)] || allHexes[0];

  // N centres evenly spaced on a circle around the battle centre
  const deployRadius = 3 + numPlayers;
  const angleOffset = Math.random() * Math.PI * 2;
  const pool = land.filter(inside).length ? land.filter(inside) : land;
  const S = Math.sqrt(3);
  const playerCenters = [];
  for (let i = 0; i < numPlayers; i++) {
    const angle = angleOffset + i * (Math.PI * 2 / numPlayers);
    const targetQ = centralHex.q + Math.round(deployRadius * (2 / S) * Math.cos(angle));
    const targetR = centralHex.r + Math.round(deployRadius * (Math.sin(angle) - Math.cos(angle) / S));
    let best = null, bestDist = Infinity;
    for (const h of pool) {
      const d = hexDistance(h.q, h.r, targetQ, targetR);
      if (d < bestDist) { bestDist = d; best = h; }
    }
    playerCenters.push(best || { q: targetQ, r: targetR });
  }

  const zoneTiles = playerCenters.map((center, pi) => {
    const otherCenters = playerCenters.filter((_, i) => i !== pi);
    // Pass 1: BFS steps from the centre
    const stepsMap = new Map([[`${center.q},${center.r}`, 0]]);
    let frontier = [center];
    while (frontier.length) {
      const next = [];
      for (const { q, r } of frontier) {
        const s = stepsMap.get(`${q},${r}`);
        for (const [dq, dr] of DIRS) {
          const nq = q + dq, nr = r + dr, nk = `${nq},${nr}`;
          if (!has(nk) || stepsMap.has(nk)) continue;
          stepsMap.set(nk, s + 1);
          next.push({ q: nq, r: nr });
        }
      }
      frontier = next;
    }
    // Pass 2: fewest segments crossed along a shortest path
    const crossMap = new Map([[`${center.q},${center.r}`, 0]]);
    frontier = [center];
    while (frontier.length) {
      const next = [], inNext = new Set();
      for (const { q, r } of frontier) {
        const k = `${q},${r}`, s = stepsMap.get(k), cross = crossMap.get(k) ?? 0;
        for (const [dq, dr] of DIRS) {
          const nq = q + dq, nr = r + dr, nk = `${nq},${nr}`;
          if (!has(nk) || stepsMap.get(nk) !== s + 1) continue;
          const newCross = cross + (sd[segmentEdgeKey(q, r, nq, nr)] ? 1 : 0);
          if (!crossMap.has(nk) || newCross < crossMap.get(nk)) crossMap.set(nk, newCross);
          if (!inNext.has(nk)) { inNext.add(nk); next.push({ q: nq, r: nr }); }
        }
      }
      frontier = next;
    }
    const scored = [];
    for (const { q, r, terrain } of allHexes) {
      const key = `${q},${r}`;
      const dx = 1.5 * (q - center.q);
      const dy = S / 2 * q + S * r - S / 2 * center.q - S * center.r;
      let score = (Math.sqrt(dx * dx + dy * dy) || 0.01) * (1 + (Math.random() - 0.5) * 0.3);
      if (terrain === 'road') score *= 0.9;
      else if (terrain === 'forest' || terrain === 'building' || terrain === 'bridge') score *= 1.2;
      else if (terrain === 'river') score *= 1.3;
      const cross = crossMap.get(key) ?? 0;
      if (cross > 0) score *= Math.pow(1.2, cross);
      if (hexDistance(q, r, centralHex.q, centralHex.r) < centerExclusion) score *= 4;
      for (const other of otherCenters) {
        if (hexDistance(q, r, other.q, other.r) < DEPLOY_INTER_ZONE_EXCLUSION) { score *= 5; break; }
      }
      scored.push({ q, r, score });
    }
    scored.sort((a, b) => a.score - b.score);
    let selectedKeys = new Set(scored.slice(0, maxTiles).map(s => `${s.q},${s.r}`));
    for (let iter = 0; iter < 20; iter++) {
      const adjusted = scored.map(s => {
        if (!selectedKeys.has(`${s.q},${s.r}`)) return s;
        const isolated = !DIRS.some(([dq, dr]) => selectedKeys.has(`${s.q + dq},${s.r + dr}`));
        return isolated ? { ...s, score: s.score * 2 } : s;
      });
      adjusted.sort((a, b) => a.score - b.score);
      const newKeys = new Set(adjusted.slice(0, maxTiles).map(s => `${s.q},${s.r}`));
      const changed = [...newKeys].some(k => !selectedKeys.has(k));
      selectedKeys = newKeys;
      if (!changed) break;
    }
    return [...selectedKeys].map(k => { const [q, r] = k.split(',').map(Number); return { q, r }; });
  });

  return playerCenters.map((c, i) => ({ q: c.q, r: c.r, tiles: zoneTiles[i] }));
}

const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

function hexFacing(q1, r1, q2, r2) {
  const dq = q2 - q1, dr = r2 - r1;
  if (dq === 0 && dr === 0) return 5;
  const px = 1.5 * dq;
  const py = Math.sqrt(3) * dr + Math.sqrt(3) / 2 * dq;
  let best = 5, bestDot = -Infinity;
  for (let i = 0; i < 6; i++) {
    const [ddq, ddr] = DIRS[i];
    const dot = px * (1.5 * ddq) + py * (Math.sqrt(3) * ddr + Math.sqrt(3) / 2 * ddq);
    if (dot > bestDot) { bestDot = dot; best = i; }
  }
  return best;
}

function hexFacingRanged(q, r, targetQ, targetR) {
  let best = 5, bestDist = Infinity;
  for (let i = 0; i < 6; i++) {
    const [dq, dr] = DIRS[i];
    const d = hexDistance(q + dq, r + dr, targetQ, targetR);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}

module.exports = { hexDistance, hexKey, hexNeighbors, hexesInRange, buildHexMap, generateHexMap, findPath, findPathCost, getStartingZones, segmentEdgeKey, getTerrainData, getSegmentData, SEGMENT_DEFS, hexFacing, hexFacingRanged };
