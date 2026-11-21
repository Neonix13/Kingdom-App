const test = require('node:test');
const assert = require('node:assert');
const GameRoom = require('../game/GameRoom');
const SEG = require('../game/data/segments');
const { segmentEdgeKey } = require('../game/HexUtils');

// Small hand-made map: every hex within radius 8 of (0,0); heights / terrains / segments overridden per test
function room({ height = {}, terrain = {}, segments = [] } = {}) {
  const hexMap = {};
  for (let q = -8; q <= 8; q++) for (let r = Math.max(-8, -q - 8); r <= Math.min(8, -q + 8); r++) hexMap[`${q},${r}`] = { q, r };
  const segmentData = {};
  for (const [[a, b], t] of segments) segmentData[segmentEdgeKey(a[0], a[1], b[0], b[1])] = t;
  return { hexMap, heightData: height, terrainData: terrain, segmentData, _segments: () => SEG };
}
const sees = (rm, unit, q, r) => GameRoom.prototype._unitVision.call(rm, { typeId: 'soldats', visionRange: 6, ...unit }, false).includes(`${q},${r}`);

test('vision : une crête plus haute que la ligne de visée cache ce qui est derrière', () => {
  const rm = room({ height: { '2,0': 2 } });
  assert.ok(sees(rm, { q: 0, r: 0 }, 2, 0), 'la crête elle-même est vue');
  assert.ok(!sees(rm, { q: 0, r: 0 }, 4, 0), 'derrière la crête');
  assert.ok(sees(rm, { q: 0, r: 0 }, 0, 4), 'à côté, rien ne gêne');
});

test('vision : un mur cache la plaine, sauf depuis le haut du mur', () => {
  const height = { '0,0': 0 };
  for (let r = -8; r <= 8; r++) height[`2,${r}`] = 2;
  const rm = room({ height });
  assert.ok(!sees(rm, { q: 0, r: 0 }, 5, 0), 'derrière le mur depuis le pied');
  assert.ok(sees(rm, { q: 2, r: 0 }, 5, 0), 'depuis le chemin de ronde');
});

test('vision : un segment « mur » bloque, une barrière non', () => {
  const wall = room({ segments: [[[[1, 0], [2, 0]], 'mur']] });
  assert.ok(!sees(wall, { q: 0, r: 0 }, 3, 0));
  const fence = room({ segments: [[[[1, 0], [2, 0]], 'barriere']] });
  assert.ok(sees(fence, { q: 0, r: 0 }, 3, 0));
});

test('vision : forêts (lisière visible, rien derrière, espions à 4, général en hauteur)', () => {
  const terrain = { '1,0': 'forest', '2,0': 'forest', '3,0': 'forest', '4,0': 'forest' };
  const rm = room({ terrain });
  assert.ok(sees(rm, { q: 0, r: 0 }, 2, 0), 'lisière (2 cases)');
  assert.ok(!sees(rm, { q: 0, r: 0 }, 3, 0), 'au-delà de 2 cases dans la forêt');
  assert.ok(!sees(rm, { q: 0, r: 0 }, 5, 0), 'derrière la forêt');
  assert.ok(sees(rm, { q: 0, r: 0, typeId: 'espion' }, 4, 0), 'l\'espion voit à 4 cases dans la forêt');
  const hill = room({ terrain, height: { '0,0': 3, '-1,0': 3 } });
  assert.ok(sees(hill, { q: 0, r: 0, isGeneral: true, visionRange: 8 }, 6, 0), 'le général en hauteur voit derrière la forêt plus basse');
  assert.ok(!sees(hill, { q: 0, r: 0, isGeneral: true, visionRange: 8 }, 4, 0), 'mais pas dedans');
});

test('vision : depuis un bâtiment, sa pièce, les pièces voisines et l\'extérieur par ses ouvertures', () => {
  const terrain = { '0,0': 'building', '1,0': 'building', '2,0': 'building' };
  const rm = room({ terrain });
  const u = { q: 0, r: 0 };
  assert.ok(sees(rm, u, 1, 0), 'pièce voisine');
  assert.ok(!sees(rm, u, 2, 0), 'pièce derrière une autre pièce');
  assert.ok(!sees(rm, u, 4, 0), 'dehors à travers d\'autres pièces');
  assert.ok(sees(rm, u, -3, 0), 'dehors par ses propres ouvertures');
  assert.ok(sees(rm, { q: -2, r: 0 }, 0, 0), 'de dehors, on voit la façade');
  assert.ok(!sees(rm, { q: -2, r: 0 }, 3, 0), 'le bâtiment cache ce qui est derrière');
});
