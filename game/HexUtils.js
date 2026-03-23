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

const Q_MAP_MIN = 0;
const Q_MAP_MAX = 57;
const DEPLOY_OFFSET = 5;      // décalage depuis la rivière vers chaque camp
const DEPLOY_SPACING = 12;    // espacement entre zones du même côté
const DEPLOY_MAX_TILES = 61;  // nombre max de tuiles par zone (rayon 4 circulaire = 61)

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
      // Hors carte → ignorer
      if (!(td[nk] !== undefined || true)) { visited.add(nk); continue; }
      // Segment infranchissable → bloqué
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

  // Trouver les cases rivière dans la zone centrale de la carte
  const riverTiles = [];
  for (const [key, type] of Object.entries(td)) {
    if (type !== 'river') continue;
    const [q, r] = key.split(',').map(Number);
    if (q >= 10 && q <= 45) riverTiles.push({ q, r });
  }

  let crossQ, crossR;
  if (riverTiles.length > 0) {
    const pick = riverTiles[Math.floor(Math.random() * riverTiles.length)];
    crossQ = pick.q; crossR = pick.r;
  } else {
    crossQ = Math.round((Q_MAP_MIN + Q_MAP_MAX) / 2);
    crossR = Math.round(21 - 0.43 * crossQ);
  }

  // Répartir les joueurs sur deux côtés (pairs = Nord, impairs = Sud)
  const northIndices = [], southIndices = [];
  for (let i = 0; i < numPlayers; i++) {
    if (i % 2 === 0) northIndices.push(i); else southIndices.push(i);
  }

  // Calculer les centres
  const centers = new Array(numPlayers);
  for (let j = 0; j < northIndices.length; j++) {
    const qOff = Math.round((j - (northIndices.length - 1) / 2) * DEPLOY_SPACING);
    centers[northIndices[j]] = { q: crossQ + qOff, r: crossR - DEPLOY_OFFSET };
  }
  for (let j = 0; j < southIndices.length; j++) {
    const qOff = Math.round((j - (southIndices.length - 1) / 2) * DEPLOY_SPACING);
    centers[southIndices[j]] = { q: crossQ + qOff, r: crossR + DEPLOY_OFFSET };
  }

  // BFS pour chaque zone
  const tileSets = centers.map(c => _deployZoneBFS(c.q, c.r, DEPLOY_MAX_TILES));

  // Égaliser : toutes les zones ont le même nombre de tuiles (la plus petite)
  const minTiles = Math.min(...tileSets.map(t => t.length));
  const truncated = tileSets.map(t => t.slice(0, minTiles));

  return centers.map((c, i) => ({
    q: c.q,
    r: c.r,
    crossR,
    tiles: truncated[i],
  }));
}

module.exports = { hexDistance, hexKey, hexNeighbors, hexesInRange, generateHexMap, findPath, getStartingZones, segmentEdgeKey, getSegmentData };
