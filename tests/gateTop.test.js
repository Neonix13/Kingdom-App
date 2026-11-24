const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');

// Col de Kankoku: gate 24,8 (height 3, passage), rampart 24,7 (height 5) next to it, wall walk above the gate at height 5
function gateRoom(mode = 'sequential') {
  const room = new GameRoom('GATE', 'p0', { mapId: 'kankoku', mode });
  room.addPlayer('p0', 'A'); room.getPlayer('p0').generalId = 'ou_ki';
  room.addPlayer('p1', 'B'); room.getPlayer('p1').generalId = 'mou_bu';
  room.budget = 100000;
  room.startGame();
  const army = [{ typeId: 'soldats', count: 1 }, { typeId: 'archer', count: 1 }, { typeId: 'cavalier_leger', count: 1 }];
  assert.ok(room.submitArmy('p0', army).ok);
  assert.ok(room.submitArmy('p1', army).ok);
  room.startDeployment();
  for (const p of room.players) {
    const tiles = p.startingZone.tiles;
    p.units.forEach((u, j) => assert.ok(room.placeUnit(p.id, u.id, tiles[j].q, tiles[j].r).ok));
    assert.ok(room.setDeploymentReady(p.id).ok);
  }
  room.startBattle();
  return room;
}
const of = (room, pid, typeId) => room.getPlayer(pid).units.find(u => u.typeId === typeId);
function put(room, u, q, r, level = 0, extra = {}) {
  u.q = q; u.r = r;
  if (level) u.level = 1; else delete u.level;
  Object.assign(u, { hasMoved: false, hasAttacked: false, isFleeing: false }, extra);
  room._rebuildUnitMap();
  room._initUnitSpeedForTurn(u);
  u.speedRemaining = 6;
  return u;
}
// parks every unit far from the gate
function park(room) {
  let i = 0;
  for (const p of room.players) for (const u of p.units) put(room, u, 2 + (i++), 2);
}

test('porte : un chemin de ronde au-dessus de chaque porte reliée aux remparts', () => {
  const room = gateRoom();
  assert.equal(room.gates.tops['24,8'], 5);
  assert.ok(room.linked('24,8^', '24,7'), 'rempart voisin');
  assert.ok(room.linked('24,8^', '24,9^'), 'porte voisine');
  assert.ok(!room.linked('24,8^', '24,8'), 'pas de lien avec le passage dessous');
  assert.ok(!room.linked('24,8^', '23,8'), 'pas de lien avec le sol');
});

test('porte : l\'infanterie monte au-dessus de la porte depuis le rempart, la cavalerie non ; le passage reste libre', () => {
  const room = gateRoom();
  park(room);
  const sol = put(room, of(room, 'p0', 'soldats'), 24, 7);
  const res = room.moveUnit('p0', sol.id, 24, 8, [[24, 8, 1]]);
  assert.ok(res.ok, res.error);
  assert.equal(sol.level, 1);
  assert.equal(room.topMap['24,8'], sol);
  assert.equal(room.unitMap['24,8'], undefined, 'le passage reste libre');
  // an enemy walks through the passage below
  const foe = put(room, of(room, 'p1', 'soldats'), 23, 8);
  assert.ok(room.moveUnit('p1', foe.id, 25, 8, [[24, 8], [25, 8]]).ok);
  assert.deepEqual([foe.q, foe.r, !!foe.level], [25, 8, false]);
  // cavalry cannot climb
  const cav = put(room, of(room, 'p0', 'cavalier_leger'), 24, 7);
  room._vacate(sol); put(room, sol, 2, 6);
  assert.match(room.moveUnit('p0', cav.id, 24, 8, [[24, 8, 1]]).error, /infranchissable/);
  // the ground route from the rampart to the passage is still a sheer wall
  assert.match(room.moveUnit('p0', cav.id, 24, 8, [[24, 8]]).error, /infranchissable/);
});

test('porte : pas de tir à la verticale, mêlée seulement avec un accès direct, tirs depuis le sol', () => {
  const room = gateRoom();
  park(room);
  const archer = put(room, of(room, 'p0', 'archer'), 24, 8, 1);
  const below = put(room, of(room, 'p1', 'soldats'), 24, 8);
  assert.equal(room.combatKind(archer, below), null, 'pas sur l\'unité juste en dessous');
  assert.equal(room.combatKind(below, archer), null);
  // a melee unit on the ground next to the gate cannot reach the wall walk
  put(room, below, 23, 8);
  assert.equal(room.combatKind(below, archer), null);
  assert.match(room.initiateCombat('p1', below.id, archer.id).error, /accès direct/);
  // from the neighbouring rampart: melee
  put(room, below, 24, 7);
  assert.equal(room.combatKind(below, archer), 'melee');
  // an enemy archer on the ground right next to the gate, without access: it shoots up (shooting up costs range)
  put(room, below, 2, 7);
  const foeArcher = put(room, of(room, 'p1', 'archer'), 25, 8);
  assert.equal(room.combatKind(foeArcher, archer), 'ranged');
  put(room, foeArcher, 27, 8);
  assert.equal(room.combatKind(foeArcher, archer), null, 'portée 3 − 2 niveaux : trop loin');
  // the archer on the wall shoots further (height 5 against 3: range 3 + 2)
  assert.equal(room.unitHeight(archer), 5);
  assert.equal(room.combatKind(archer, foeArcher), 'ranged');
  assert.ok(room.initiateCombat('p0', archer.id, foeArcher.id).pending);
});

test('porte : ordre simultané vers le chemin de ronde', () => {
  const room = gateRoom('simultaneous');
  park(room);
  const sol = put(room, of(room, 'p0', 'soldats'), 24, 7);
  const res = room.turns.setOrders(room, 'p0', { [sol.id]: { type: 'move', path: [[24, 8, 1], [24, 9, 1]] } });
  assert.ok(res.ok, res.error);
  room.turns.resolve(room, 7);
  assert.deepEqual([sol.q, sol.r, sol.level], [24, 9, 1]);
  assert.equal(room.topMap['24,9'], sol);
});
