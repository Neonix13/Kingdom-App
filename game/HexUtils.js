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
function findPathCost(hexMap, unitMap, q1, r1, q2, r2, maxSpeed, unit, segMap = getSegmentData(), blocked = null, table = null) {
  if (q1 === q2 && r1 === r2) return { path: [], cost: 0 };
  const { dist, prev } = rules.reachable(table || rules.MOVE_TABLE, {
    start: { q: q1, r: r1 },
    maxCost: maxSpeed,
    mounted: rules.isMounted(unit),
    hexAt: (k) => hexMap[k] || null,
    blocked: blocked || ((k) => !!unitMap[k]),
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
const TERRAIN_DEPLOY_MOD = { road: -2, plain: 0, building: 1, forest: 4, river: 999 };
const DEPLOY_RADIAL_SCALE = 10; // poids de la distance au centre
const DEPLOY_CENTER_EXCLUSION = 3;
const DEPLOY_INTER_ZONE_EXCLUSION = 8;
const DEPLOY_BORDER_EXCLUSION = 12;

// Expansion radiale depuis un centre de déploiement.
// Priorité = distance_hexagonale_au_centre × SCALE + modificateur_terrain
// → forme proche d'un cercle, avec préférence légère pour plaines/routes
function _deployZoneDijkstra(centerQ, centerR, maxTiles, forbiddenKeys, td, sd) {
  const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  const visited = new Set();
  const tiles = [];
  const heap = [{ q: centerQ, r: centerR, priority: 0 }];

  while (heap.length && tiles.length < maxTiles) {
    heap.sort((a, b) => a.priority - b.priority);
    const { q, r } = heap.shift();
    const key = `${q},${r}`;
    if (visited.has(key)) continue;
    const terrain = td[key] || 'plain';
    if (terrain === 'river') continue;
    if (forbiddenKeys && forbiddenKeys.has(key)) continue;
    visited.add(key);
    tiles.push({ q, r });
    if (tiles.length >= maxTiles) break;

    for (const [dq, dr] of DIRS) {
      const nq = q + dq, nr = r + dr;
      const nk = `${nq},${nr}`;
      if (!td[nk] || visited.has(nk)) continue;
      const edgeK = segmentEdgeKey(q, r, nq, nr);
      const segType = sd[edgeK];
      if (segType && rules.MOVE_TABLE.seg[segType]?.blocked) continue;
      const nTerrain = td[nk] || 'plain';
      if (nTerrain === 'river') continue;
      const radialDist = hexDistance(nq, nr, centerQ, centerR);
      const terrainMod = TERRAIN_DEPLOY_MOD[nTerrain] ?? 0;
      const priority = radialDist * DEPLOY_RADIAL_SCALE + terrainMod;
      heap.push({ q: nq, r: nr, priority });
    }
  }
  return tiles;
}

function fixedZones(numPlayers, zones, td) {
  if (!Array.isArray(zones) || zones.length < numPlayers) return null;
  const picked = zones.slice(0, numPlayers).map((z) => {
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
    return { q: center.q, r: center.r, tiles };
  });
  return picked.every(Boolean) ? picked : null;
}

// map: a registry map (game/maps.js). Fixed map.zones are used when there are enough of them.
function getStartingZones(numPlayers, mapRadius, budget, map = maps.getMap('default')) {
  const td = getTerrainData(map);
  const sd = getSegmentData(map);
  const fixed = fixedZones(numPlayers, map.zones, td);
  if (fixed) return fixed;
  const maxTiles = Math.max(5, Math.floor((budget || 2500) / 1000) * 5);
  // Random placement can occasionally squeeze a zone to nothing: retry, keep the best attempt
  const wanted = Math.min(maxTiles, 8);
  let best = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const zones = _randomZones(numPlayers, maxTiles, td, sd);
    const size = Math.min(...zones.map(z => z.tiles.length));
    if (!best || size > best.size) best = { zones, size };
    if (size >= wanted) break;
  }
  return best.zones;
}

function _randomZones(numPlayers, maxTiles, td, sd) {

  const validHexes = [];
  for (const [key, type] of Object.entries(td)) {
    if (type === 'river' || type === 'forest') continue;
    const [q, r] = key.split(',').map(Number);
    validHexes.push({ q, r });
  }

  // Extrêmes de la carte pour estimer le bord
  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const { q, r } of validHexes) {
    if (q < minQ) minQ = q; if (q > maxQ) maxQ = q;
    if (r < minR) minR = r; if (r > maxR) maxR = r;
  }

  // Point central aléatoire loin des bords
  const centerCandidates = validHexes.filter(({ q, r }) =>
    q >= minQ + DEPLOY_BORDER_EXCLUSION && q <= maxQ - DEPLOY_BORDER_EXCLUSION &&
    r >= minR + DEPLOY_BORDER_EXCLUSION && r <= maxR - DEPLOY_BORDER_EXCLUSION
  );
  const centralHex = centerCandidates[Math.floor(Math.random() * centerCandidates.length)]
    || validHexes[Math.floor(Math.random() * validHexes.length)];

  // Rayon du cercle de déploiement (augmente avec le nombre de joueurs)
  const deployRadius = 10 + numPlayers * 4;

  // Placer N centres équidistants sur le cercle autour du point central
  const angleOffset = Math.random() * Math.PI * 2;
  const playerCenters = [];
  for (let i = 0; i < numPlayers; i++) {
    const angle = angleOffset + i * (Math.PI * 2 / numPlayers);
    const targetQ = centralHex.q + Math.round(Math.cos(angle) * deployRadius);
    const targetR = centralHex.r + Math.round(Math.sin(angle) * deployRadius);
    let best = null, bestDist = Infinity;
    for (const h of validHexes) {
      const d = hexDistance(h.q, h.r, targetQ, targetR);
      if (d < bestDist) { bestDist = d; best = h; }
    }
    playerCenters.push(best || { q: targetQ, r: targetR });
  }

  // Tuiles interdites : trop proches du point central
  const centralExcluded = new Set();
  for (const { q, r } of validHexes) {
    if (hexDistance(q, r, centralHex.q, centralHex.r) < DEPLOY_CENTER_EXCLUSION)
      centralExcluded.add(`${q},${r}`);
  }

  // Construire les zones (on demande 2x maxTiles pour avoir de la marge avant filtrage)
  const zoneTiles = playerCenters.map(c =>
    _deployZoneDijkstra(c.q, c.r, maxTiles * 2, centralExcluded, td, sd)
  );

  // Supprimer les tuiles trop proches d'une autre zone
  const filtered = zoneTiles.map((tiles, pi) =>
    tiles.filter(t =>
      !zoneTiles.some((other, pj) => {
        if (pj === pi) return false;
        return other.some(ot => hexDistance(t.q, t.r, ot.q, ot.r) < DEPLOY_INTER_ZONE_EXCLUSION);
      })
    )
  );

  // Égaliser à la plus petite zone, tronquer à maxTiles
  const minTiles = Math.min(maxTiles, ...filtered.map(t => t.length));
  return playerCenters.map((c, i) => ({
    q: c.q,
    r: c.r,
    tiles: filtered[i].slice(0, minTiles),
  }));
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
