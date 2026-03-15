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

// BFS pathfinding (returns path array or null)
function findPath(hexMap, unitMap, q1, r1, q2, r2, maxSteps, playerId) {
  if (q1 === q2 && r1 === r2) return [];
  const visited = new Map();
  const queue = [{ q: q1, r: r1, path: [] }];
  visited.set(hexKey(q1, r1), true);

  while (queue.length > 0) {
    const { q, r, path } = queue.shift();
    if (path.length >= maxSteps) continue;

    for (const [nq, nr] of hexNeighbors(q, r)) {
      const key = hexKey(nq, nr);
      if (visited.has(key)) continue;
      if (!hexMap[key]) continue; // out of map

      // Can't move through enemy units (but can move to empty or own general)
      const occupant = unitMap[key];
      if (occupant && occupant.playerId !== playerId) continue;

      visited.set(key, true);
      const newPath = [...path, [nq, nr]];

      if (nq === q2 && nr === r2) return newPath;
      queue.push({ q: nq, r: nr, path: newPath });
    }
  }
  return null;
}

// Rivière horizontale approximée en coordonnées hex
// r_rivière(q) ≈ 21 - 0.43*q  (calculé depuis la calibration image)
const RIVER_SLOPE = 0.43;
const RIVER_OFFSET = 21;
function riverR(q) { return Math.round(RIVER_OFFSET - RIVER_SLOPE * q); }

const Q_MAP_MIN = 0;
const Q_MAP_MAX = 57; // largeur de la carte en hexes
const DEPLOY_RIVER_DIST = 3; // cases max de la rivière (Nord et Sud)

function getStartingZones(numPlayers, mapRadius) {
  // Joueurs pairs (index 0,2,4,6) → Nord de la rivière
  // Joueurs impairs (index 1,3,5,7) → Sud de la rivière
  const zones = [];
  const qCenter = Math.round((Q_MAP_MIN + Q_MAP_MAX) / 2);
  const rCenter = riverR(qCenter);
  for (let i = 0; i < numPlayers; i++) {
    const type = (i % 2 === 0) ? 'river_north' : 'river_south';
    zones.push({ q: qCenter, r: rCenter, radius: DEPLOY_RIVER_DIST, type });
  }
  return zones;
}

module.exports = { hexDistance, hexKey, hexNeighbors, hexesInRange, generateHexMap, findPath, getStartingZones };
