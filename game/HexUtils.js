// Axial coordinate hex utilities (flat-top hexagons)
// 1 hex = 100m

const fs = require('fs');
const path = require('path');
let _terrainData = null;
function getTerrainData() {
  if (!_terrainData) {
    try {
      _terrainData = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/data/terrain.json'), 'utf8'));
    } catch(e) { _terrainData = {}; }
  }
  return _terrainData;
}

const SEGMENT_DEFS = require('./data/segments');
let _segmentData = null;
function getSegmentData() {
  if (!_segmentData) {
    try {
      _segmentData = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/data/segments.json'), 'utf8'));
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
  const costs = { plain: 1, road: 0.66, forest: 1.5, river: 2, building: 1, bridge: 1 };
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
      if (unitMap[key]) {
        // Chars can pass through enemy units (not allied, not target)
        const isChar = unit && unit.typeId === 'char';
        const isEnemy = unit && unitMap[key].playerId !== unit.playerId;
        const isTarget = nq === q2 && nr === r2;
        if (!isChar || !isEnemy || isTarget) continue;
      }

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

const DEPLOY_CENTER_EXCLUSION = 0; // remplacé par 3+N dynamiquement
const DEPLOY_INTER_ZONE_EXCLUSION = 8;
const DEPLOY_BORDER_EXCLUSION = 13; // + numPlayers dynamiquement dans getStartingZones

function getStartingZones(numPlayers, mapRadius, budget) {
  const sd = getSegmentData();
  const maxTiles = Math.floor(4 * (budget || 2500) / 1000 + 2);
  const centerExclusion = 3 + numPlayers;
  const borderExclusion = 15 + numPlayers;
  const DIRS_6 = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

  // Toutes les tuiles de la carte (y compris plaines)
  const hexMap = generateHexMap();
  const allHexes = Object.values(hexMap);

  // Extrêmes de la carte pour estimer le bord
  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity;
  for (const { q, r } of allHexes) {
    if (q < minQ) minQ = q; if (q > maxQ) maxQ = q;
    if (r < minR) minR = r; if (r > maxR) maxR = r;
  }

  // Point central aléatoire loin des bords
  const centerCandidates = allHexes.filter(({ q, r }) =>
    q >= minQ + borderExclusion && q <= maxQ - borderExclusion &&
    r >= minR + borderExclusion && r <= maxR - borderExclusion
  );
  const centralHex = centerCandidates[Math.floor(Math.random() * centerCandidates.length)]
    || allHexes[Math.floor(Math.random() * allHexes.length)];

  // Rayon du cercle de déploiement (augmente avec le nombre de joueurs)
  const deployRadius = 3 + numPlayers;

  // Placer N centres équidistants sur le cercle autour du point central
  const angleOffset = Math.random() * Math.PI * 2;
  const playerCenters = [];
  for (let i = 0; i < numPlayers; i++) {
    const angle = angleOffset + i * (Math.PI * 2 / numPlayers);
    const S = Math.sqrt(3);
    const targetQ = centralHex.q + Math.round(deployRadius * (2 / S) * Math.cos(angle));
    const targetR = centralHex.r + Math.round(deployRadius * (Math.sin(angle) - Math.cos(angle) / S));
    // Trouver le hex valide le plus proche de la cible, avec contrainte de bord
    const validCandidates = allHexes.filter(({ q, r }) =>
      q >= minQ + borderExclusion && q <= maxQ - borderExclusion &&
      r >= minR + borderExclusion && r <= maxR - borderExclusion
    );
    const pool = validCandidates.length > 0 ? validCandidates : allHexes;
    let best = null, bestDist = Infinity;
    for (const h of pool) {
      const d = hexDistance(h.q, h.r, targetQ, targetR);
      if (d < bestDist) { bestDist = d; best = h; }
    }
    playerCenters.push(best || { q: targetQ, r: targetR });
  }

  // Pour chaque joueur : scorer toutes les tuiles et prendre les meilleures
  const zoneTiles = playerCenters.map((center, pi) => {
    const otherCenters = playerCenters.filter((_, i) => i !== pi);

    // Passe 1 : BFS — distance minimale (en pas) depuis le centre
    const stepsMap = new Map([[`${center.q},${center.r}`, 0]]);
    let frontier = [center];
    while (frontier.length > 0) {
      const next = [];
      for (const { q, r } of frontier) {
        const s = stepsMap.get(`${q},${r}`);
        for (const [dq, dr] of DIRS_6) {
          const nq = q + dq, nr = r + dr, nk = `${nq},${nr}`;
          if (!hexMap[nk] || stepsMap.has(nk)) continue;
          stepsMap.set(nk, s + 1);
          next.push({ q: nq, r: nr });
        }
      }
      frontier = next;
    }
    // Passe 2 : segments traversés sur le chemin le plus court (DP en ordre BFS)
    const crossMap = new Map([[`${center.q},${center.r}`, 0]]);
    frontier = [center];
    while (frontier.length > 0) {
      const next = [], inNext = new Set();
      for (const { q, r } of frontier) {
        const k = `${q},${r}`, s = stepsMap.get(k), cross = crossMap.get(k) ?? 0;
        for (const [dq, dr] of DIRS_6) {
          const nq = q + dq, nr = r + dr, nk = `${nq},${nr}`;
          if (!hexMap[nk] || stepsMap.get(nk) !== s + 1) continue;
          const segType = sd[segmentEdgeKey(q, r, nq, nr)];
          const newCross = cross + (segType ? 1 : 0);
          if (!crossMap.has(nk) || newCross < crossMap.get(nk)) crossMap.set(nk, newCross);
          if (!inNext.has(nk)) { inNext.add(nk); next.push({ q: nq, r: nr }); }
        }
      }
      frontier = next;
    }

    // Score de chaque tuile (plus bas = meilleur)
    const scored = [];
    for (const { q, r, terrain } of allHexes) {
      const key = `${q},${r}`;
      const pxDist = Math.sqrt(
        (MAP_HEX_SIZE * 1.5 * (q - center.q)) ** 2 +
        (MAP_HEX_SIZE * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r - Math.sqrt(3) / 2 * center.q - Math.sqrt(3) * center.r)) ** 2
      ) / MAP_HEX_SIZE || 0.01;
      let score = pxDist * (1 + (Math.random() - 0.5) * 0.3);

      if (terrain === 'road') score *= 0.9;
      else if (terrain === 'forest' || terrain === 'building' || terrain === 'bridge') score *= 1.2;
      else if (terrain === 'river') score *= 1.3;

      const cross = crossMap.get(key) ?? 0;
      if (cross > 0) score *= Math.pow(1.2, cross);

      if (hexDistance(q, r, centralHex.q, centralHex.r) < centerExclusion) score *= 4;

      for (const other of otherCenters) {
        if (hexDistance(q, r, other.q, other.r) < DEPLOY_INTER_ZONE_EXCLUSION) {
          score *= 5;
          break;
        }
      }

      scored.push({ q, r, score });
    }

    scored.sort((a, b) => a.score - b.score);

    // Raffinement itératif : ×2 si la tuile est isolée (aucun voisin dans la zone)
    let selectedKeys = new Set(scored.slice(0, maxTiles).map(s => `${s.q},${s.r}`));
    for (let iter = 0; iter < 20; iter++) {
      const adjusted = scored.map(s => {
        if (!selectedKeys.has(`${s.q},${s.r}`)) return s;
        const isolated = !DIRS_6.some(([dq, dr]) => selectedKeys.has(`${s.q + dq},${s.r + dr}`));
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

  return playerCenters.map((c, i) => ({
    q: c.q,
    r: c.r,
    tiles: zoneTiles[i],
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

module.exports = { hexDistance, hexKey, hexNeighbors, hexesInRange, generateHexMap, findPath, getStartingZones, segmentEdgeKey, getSegmentData, SEGMENT_DEFS, hexFacing, hexFacingRanged };
