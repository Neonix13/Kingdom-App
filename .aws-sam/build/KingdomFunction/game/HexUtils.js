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
    if (cost > maxSpeed) continue;

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
        if (segDef.vitesse_tout) {
          // Consumes all remaining speed
          const newCost = maxSpeed;
          if (!dist.has(key) || newCost < dist.get(key)) {
            dist.set(key, newCost);
            queue.push({ q: nq, r: nr, cost: newCost, path: [...path, [nq, nr]] });
          }
          continue;
        }
        stepCost += Math.max(0, -(segDef.vitesse || 0));
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

const Q_MAP_MIN = 0;
const Q_MAP_MAX = 57;
const DEPLOY_RADIUS = 4; // rayon de la zone de déploiement (en cases)
const DEPLOY_OFFSET = 4; // décalage depuis la rivière vers chaque camp

function getStartingZones(numPlayers, mapRadius) {
  const td = getTerrainData();

  // Trouver les cases rivière dans la zone centrale de la carte (éviter les bords)
  const riverTiles = [];
  for (const [key, type] of Object.entries(td)) {
    if (type !== 'river') continue;
    const [q, r] = key.split(',').map(Number);
    if (q >= 10 && q <= 45) riverTiles.push({ q, r });
  }

  // Choisir un point de traversée aléatoire dans la rivière
  let crossQ, crossR;
  if (riverTiles.length > 0) {
    const pick = riverTiles[Math.floor(Math.random() * riverTiles.length)];
    crossQ = pick.q;
    crossR = pick.r;
  } else {
    // Fallback si pas de terrain
    crossQ = Math.round((Q_MAP_MIN + Q_MAP_MAX) / 2);
    crossR = Math.round(21 - 0.43 * crossQ);
  }

  const zones = [];
  for (let i = 0; i < numPlayers; i++) {
    if (i % 2 === 0) {
      // Équipe paire → Nord de la rivière
      zones.push({ q: crossQ, r: crossR - DEPLOY_OFFSET, crossR, radius: DEPLOY_RADIUS, type: 'circle' });
    } else {
      // Équipe impaire → Sud de la rivière
      zones.push({ q: crossQ, r: crossR + DEPLOY_OFFSET, crossR, radius: DEPLOY_RADIUS, type: 'circle' });
    }
  }
  return zones;
}

module.exports = { hexDistance, hexKey, hexNeighbors, hexesInRange, generateHexMap, findPath, getStartingZones, segmentEdgeKey, getSegmentData };
