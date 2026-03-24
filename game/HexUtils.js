// Axial coordinate hex utilities (flat-top hexagons)
// 1 hex = 100m

const fs = require('fs');
const path = require('path');
let _terrainData = null;
function getTerrainData() {
  if (!_terrainData) {
    try {
      _terrainData = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/terrain.json'), 'utf8'));
    } catch(e) { _terrainData = {}; }
  }
  return _terrainData;
}

const SEGMENT_DEFS = require('./data/segments');
let _segmentData = null;
function getSegmentData() {
  if (!_segmentData) {
    try {
      _segmentData = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/segments.json'), 'utf8'));
    } catch(e) { _segmentData = {}; }
  }
  return _segmentData;
}

function segmentEdgeKey(q1, r1, q2, r2) {
  if (q1 < q2 || (q1 === q2 && r1 < r2)) return `${q1},${r1}|${q2},${r2}`;
  return `${q2},${r2}|${q1},${r1}`;
}

// Calibration carte (synchronisé avec public/js/hexGrid.js)
const MAP_HEX_SIZE = 101.5;
const MAP_ORIG_X   = 137;
const MAP_ORIG_Y   = 190;
const MAP_IMG_W    = 8800;
const MAP_IMG_H    = 7200;

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

// Generate a hex map that couvre exactement la zone de l'image
function generateHexMap(radius) {
  const hexes = {};
  const S = Math.sqrt(3);
  const qMin = Math.floor(-MAP_ORIG_X / (MAP_HEX_SIZE * 1.5)) - 1;
  const qMax = Math.ceil((MAP_IMG_W - MAP_ORIG_X) / (MAP_HEX_SIZE * 1.5)) + 1;

  for (let q = qMin; q <= qMax; q++) {
    const rMin = Math.floor((-MAP_ORIG_Y - MAP_HEX_SIZE * S / 2 * q) / (MAP_HEX_SIZE * S)) - 1;
    const rMax = Math.ceil((MAP_IMG_H - MAP_ORIG_Y - MAP_HEX_SIZE * S / 2 * q) / (MAP_HEX_SIZE * S)) + 1;
    for (let r = rMin; r <= rMax; r++) {
      const imgX = MAP_HEX_SIZE * 1.5 * q + MAP_ORIG_X;
      const imgY = MAP_HEX_SIZE * (S / 2 * q + S * r) + MAP_ORIG_Y;
      if (imgX >= 0 && imgX <= MAP_IMG_W && imgY >= 0 && imgY <= MAP_IMG_H) {
        const key = hexKey(q, r);
        hexes[key] = { q, r, terrain: getTerrainData()[key] || 'plain' };
      }
    }
  }
  return hexes;
}

// Terrain movement cost: entering a tile costs max(1, 1 - vitesse_modifier)
function terrainMoveCost(terrain) {
  const costs = { plain: 1, road: 1, forest: 2, river: 2, building: 1, bridge: 1 };
  return costs[terrain] ?? 1;
}

// Dijkstra pathfinding with terrain + segment movement costs (returns path array or null)
function findPath(hexMap, unitMap, q1, r1, q2, r2, maxSpeed, playerId, unit) {
  if (q1 === q2 && r1 === r2) return [];

  const segMap = getSegmentData();
  const isCavalry = unit && (unit.category === 'Chevaux' || unit.category === 'Chars');

  const dist = new Map();
  const queue = [{ q: q1, r: r1, cost: 0, path: [] }];
  dist.set(hexKey(q1, r1), 0);

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const { q, r, cost, path } = queue.shift();

    if (q === q2 && r === r2) return path;
    if (cost >= maxSpeed) continue;

    for (const [nq, nr] of hexNeighbors(q, r)) {
      const key = hexKey(nq, nr);
      if (!hexMap[key]) continue;
      if (unitMap[key]) continue;

      // Segment check
      const edgeK = segmentEdgeKey(q, r, nq, nr);
      const segType = segMap[edgeK];
      const segDef = segType ? SEGMENT_DEFS[segType] : null;
      if (segDef) {
        if (segDef.infranchissable) continue;
        if (segDef.infranchissable_cavalerie && isCavalry) continue;
      }

      const srcTerrain = hexMap[hexKey(q, r)]?.terrain || 'plain';
      let stepCost = terrainMoveCost(srcTerrain);

      if (segDef) {
        if (segDef.vitesse_fixe != null) {
          stepCost = segDef.vitesse_fixe;
        } else {
          stepCost += Math.max(0, -(segDef.vitesse || 0));
        }
      }

      const newCost = cost + stepCost;
      if (newCost > maxSpeed) continue;

      if (!dist.has(key) || newCost < dist.get(key)) {
        dist.set(key, newCost);
        queue.push({ q: nq, r: nr, cost: newCost, path: [...path, [nq, nr]] });
      }
    }
  }
  return null;
}

const TERRAIN_DEPLOY_PENALTY = { forest: 5, mountain: 5, swamp: 5, hill: 2 };
const DEPLOY_CENTER_EXCLUSION = 3;
const DEPLOY_INTER_ZONE_EXCLUSION = 8;
const DEPLOY_BORDER_EXCLUSION = 12;

// Dijkstra depuis un centre de déploiement.
// Évite rivière, segments infranchissables, et forbiddenKeys.
// Pénalise les terrains/segments spéciaux.
function _deployZoneDijkstra(centerQ, centerR, maxTiles, forbiddenKeys) {
  const td = getTerrainData();
  const sd = getSegmentData();
  const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  const dist = new Map();
  const tiles = [];
  const heap = [{ q: centerQ, r: centerR, cost: 0 }];
  dist.set(`${centerQ},${centerR}`, 0);

  while (heap.length && tiles.length < maxTiles) {
    heap.sort((a, b) => a.cost - b.cost);
    const { q, r, cost } = heap.shift();
    const key = `${q},${r}`;
    if (dist.get(key) < cost) continue;
    const terrain = td[key] || 'plain';
    if (terrain === 'river') continue;
    if (forbiddenKeys && forbiddenKeys.has(key)) continue;
    tiles.push({ q, r });
    if (tiles.length >= maxTiles) break;

    for (const [dq, dr] of DIRS) {
      const nq = q + dq, nr = r + dr;
      const nk = `${nq},${nr}`;
      if (!td[nk]) continue;
      const edgeK = segmentEdgeKey(q, r, nq, nr);
      const segType = sd[edgeK];
      const segDef = segType ? SEGMENT_DEFS[segType] : null;
      if (segDef?.infranchissable) continue;
      const nTerrain = td[nk] || 'plain';
      if (nTerrain === 'river') continue;
      const stepCost = 1 + (TERRAIN_DEPLOY_PENALTY[nTerrain] || 0) + (segDef ? 3 : 0);
      const newCost = cost + stepCost;
      if (!dist.has(nk) || newCost < dist.get(nk)) {
        dist.set(nk, newCost);
        heap.push({ q: nq, r: nr, cost: newCost });
      }
    }
  }
  return tiles;
}

function getStartingZones(numPlayers, mapRadius, budget) {
  const td = getTerrainData();
  const maxTiles = Math.max(5, Math.floor((budget || 2500) / 1000) * 5);

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
    _deployZoneDijkstra(c.q, c.r, maxTiles * 2, centralExcluded)
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

module.exports = { hexDistance, hexKey, hexNeighbors, hexesInRange, generateHexMap, findPath, getStartingZones, segmentEdgeKey, getSegmentData, SEGMENT_DEFS };
