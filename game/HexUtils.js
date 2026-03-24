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

const DEPLOY_MAX_TILES = 61;  // nombre max de tuiles par zone (≈ rayon 4)
const DEPLOY_CIRCLE_RADIUS = 15; // rayon du cercle de placement des centres de zone

// BFS flood-fill depuis un centre, bloqué par segments infranchissables et tuiles rivière.
// Retourne les tuiles dans l'ordre croissant de distance, jusqu'à maxTiles.
function _deployZoneBFS(centerQ, centerR, maxTiles) {
  const td = getTerrainData();
  const sd = getSegmentData();
  const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  const visited = new Set();
  const tiles = [];
  const queue = [{ q: centerQ, r: centerR, d: 0 }];
  visited.add(`${centerQ},${centerR}`);

  while (queue.length && tiles.length < maxTiles) {
    const { q, r, d } = queue.shift();
    const terrain = td[`${q},${r}`] || 'plain';
    if (terrain !== 'river') tiles.push({ q, r });
    if (tiles.length >= maxTiles) break;

    for (const [dq, dr] of DIRS) {
      const nq = q + dq, nr = r + dr;
      const nk = `${nq},${nr}`;
      if (visited.has(nk)) continue;
      const edgeK = segmentEdgeKey(q, r, nq, nr);
      const segType = sd[edgeK];
      const segDef = segType ? SEGMENT_DEFS[segType] : null;
      if (segDef?.infranchissable) { visited.add(nk); continue; }
      visited.add(nk);
      queue.push({ q: nq, r: nr, d: d + 1 });
    }
  }
  return tiles;
}

function getStartingZones(numPlayers, mapRadius) {
  const td = getTerrainData();

  // Calculer le centre de la carte à partir des tuiles existantes
  const allKeys = Object.keys(td);
  let sumQ = 0, sumR = 0;
  for (const key of allKeys) {
    const [q, r] = key.split(',').map(Number);
    sumQ += q; sumR += r;
  }
  const centerQ = sumQ / allKeys.length;
  const centerR = sumR / allKeys.length;

  // Construire un index des tuiles valides (non-rivière) pour snap rapide
  const validHexes = [];
  for (const [key, type] of Object.entries(td)) {
    if (type === 'river') continue;
    const [q, r] = key.split(',').map(Number);
    validHexes.push({ q, r });
  }

  // Rotation aléatoire pour varier les parties
  const angleOffset = Math.random() * Math.PI * 2;

  // Placer N centres équidistants sur un cercle autour du centre de la carte
  // En coordonnées axiales flat-top : x ≈ q, y ≈ r + q/2
  const centers = [];
  for (let i = 0; i < numPlayers; i++) {
    const angle = angleOffset + i * (Math.PI * 2 / numPlayers);
    const targetQ = centerQ + Math.cos(angle) * DEPLOY_CIRCLE_RADIUS;
    const targetR = centerR + Math.sin(angle) * DEPLOY_CIRCLE_RADIUS;
    // Snap au hex valide le plus proche
    let best = null, bestDist = Infinity;
    for (const h of validHexes) {
      const d = hexDistance(h.q, h.r, Math.round(targetQ), Math.round(targetR));
      if (d < bestDist) { bestDist = d; best = h; }
    }
    centers.push(best || { q: Math.round(targetQ), r: Math.round(targetR) });
  }

  // BFS pour chaque zone
  const tileSets = centers.map(c => _deployZoneBFS(c.q, c.r, DEPLOY_MAX_TILES));

  // Égaliser : toutes les zones ont le même nombre de tuiles (la plus petite)
  const minTiles = Math.min(...tileSets.map(t => t.length));
  const truncated = tileSets.map(t => t.slice(0, minTiles));

  return centers.map((c, i) => ({
    q: c.q,
    r: c.r,
    tiles: truncated[i],
  }));
}

module.exports = { hexDistance, hexKey, hexNeighbors, hexesInRange, generateHexMap, findPath, getStartingZones, segmentEdgeKey, getSegmentData, SEGMENT_DEFS };
