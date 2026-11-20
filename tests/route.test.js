const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');
const { hexKey } = require('../game/HexUtils');
const { registerTestMap, createHarness, setupBattle } = require('./helpers');
const { simRoom, put, units, events } = require('./simHelpers');

registerTestMap();

function battleRoom() {
  const room = new GameRoom('ROUTE', 'p0', { mapId: 'test-small' });
  room.addPlayer('p0', 'A'); room.getPlayer('p0').generalId = 'ou_ki';
  room.addPlayer('p1', 'B'); room.getPlayer('p1').generalId = 'mou_bu';
  room.startGame();
  for (const p of room.players) assert.ok(room.submitArmy(p.id, [{ typeId: 'soldats', count: 1 }]).ok);
  room.startDeployment();
  for (const p of room.players) {
    p.units.forEach((u, j) => assert.ok(room.placeUnit(p.id, u.id, p.startingZone.tiles[j * 2].q, p.startingZone.tiles[j * 2].r).ok));
    assert.ok(room.setDeploymentReady(p.id).ok);
  }
  room.startBattle();
  const me = room.getPlayer(room.getCurrentPlayerId());
  const foe = room.players.find(p => p !== me);
  const mine = me.units.find(u => !u.isGeneral), enemy = foe.units.find(u => !u.isGeneral);
  const place = (u, q, r) => {
    delete room.unitMap[hexKey(u.q, u.r)];
    u.q = q; u.r = r;
    room.unitMap[hexKey(q, r)] = u;
  };
  place(me.units.find(u => u.isGeneral), 0, 7);
  place(foe.units.find(u => u.isGeneral), 9, 7);
  mine.speed = 3;
  return { room, me, foe, mine, enemy, place, ready: () => room._initUnitSpeedForTurn(mine) };
}

test('chemin choisi : l\'unité suit exactement les étapes demandées (détour compris) et paie leur coût', () => {
  const { room, me, mine, enemy, place, ready } = battleRoom();
  place(mine, 1, 3); place(enemy, 8, 0); ready();
  const route = [[1, 2], [2, 2], [2, 3]];
  const res = room.moveUnit(me.id, mine.id, 2, 3, route);
  assert.ok(res.ok, res.error);
  assert.deepEqual(res.path, route);
  assert.deepEqual([mine.q, mine.r], [2, 3]);
  assert.equal(mine.speedRemaining, 0);
});

test('chemin choisi : invalide → refusé, l\'unité ne bouge pas', () => {
  const { room, me, mine, enemy, place, ready } = battleRoom();
  place(mine, 1, 3); place(enemy, 3, 3); ready();
  const before = () => assert.deepEqual([mine.q, mine.r, mine.speedRemaining], [1, 3, 3]);
  assert.ok(room.moveUnit(me.id, mine.id, 2, 2, [[1, 2], [3, 2]]).error, 'pas non voisin');
  before();
  assert.ok(room.moveUnit(me.id, mine.id, 4, 3, [[2, 3], [3, 3], [4, 3]]).error, 'traverse une unité visible');
  before();
  assert.ok(room.moveUnit(me.id, mine.id, 1, 0, [[1, 2], [1, 1], [1, 0], [0, 0]]).error, 'ne finit pas sur la case visée');
  before();
  assert.ok(room.moveUnit(me.id, mine.id, 2, 0, [[1, 2], [1, 1], [1, 0], [2, 0]]).error, 'trop long pour la vitesse');
  before();
  assert.ok(room.moveUnit(me.id, mine.id, 1, 2, [[1, 2], [2, 2], [1, 2]]).error, 'repasse par la même case');
  before();
});

test('déplacer puis attaquer : le chemin choisi mène à la case d\'attaque, l\'attaque part dans la même action', () => {
  const { room, me, mine, enemy, place, ready } = battleRoom();
  place(mine, 1, 2); place(enemy, 4, 2); ready();
  const route = [[2, 1], [3, 1], [4, 1]];
  const res = room.moveAndAttack(me.id, mine.id, enemy.id, 4, 1, route);
  assert.ok(res.move && res.move.ok, res.error);
  assert.deepEqual(res.move.path, route);
  assert.ok(res.attack && res.attack.pending, 'attaque lancée');
  assert.ok(mine.hasAttacked);
});

test('déplacer puis attaquer : sans chemin, une unité qui vient de bouger peut encore attaquer au contact', () => {
  const { room, me, mine, enemy, place, ready } = battleRoom();
  place(mine, 1, 2); place(enemy, 4, 2); ready();
  assert.ok(room.moveUnit(me.id, mine.id, 3, 2).ok);
  assert.equal(mine.speedRemaining, 1);
  const atk = room.initiateCombat(me.id, mine.id, enemy.id);
  assert.ok(atk.pending, atk.error);
});

test('protocole : move_unit refuse un chemin mal formé', async () => {
  const h = createHarness();
  const { first } = await setupBattle(h);
  const gs = first.last('game_state');
  const u = gs.myUnits.find(x => !x.isGeneral);
  await first.send('move_unit', { unitId: u.id, targetQ: u.q, targetR: u.r + 1, path: 'abc' });
  assert.equal(first.last('error').code, 'invalid_path');
  await first.send('move_unit', { unitId: u.id, targetQ: u.q, targetR: u.r + 1, path: [[u.q, u.r + 1]] });
  const moved = first.last('game_state').myUnits.find(x => x.id === u.id);
  assert.deepEqual([moved.q, moved.r], [u.q, u.r + 1]);
});

// ---- simultaneous mode ----
function simSetup() {
  const room = simRoom();
  put(room, units(room, 'p0').general, 0, 8, { visionRange: 3 });
  put(room, units(room, 'p1').general, 13, 0, { visionRange: 3 });
  return { room, A: units(room, 'p0').troops[0], B: units(room, 'p1').troops[0], T: room.turns };
}

test('simultané : une attaque au corps à corps peut suivre un chemin choisi avant d\'aller au contact', () => {
  const { room, A, B, T } = simSetup();
  put(room, A, 4, 4); put(room, B, 7, 4);
  const res = T.setOrders(room, 'p0', { [A.id]: { type: 'attack', targetId: B.id, path: [[4, 3], [5, 2], [6, 2]] } });
  assert.ok(res.ok, res.error);
  assert.deepEqual(res.orders[A.id].path, [[4, 3], [5, 2], [6, 2]]);
  T.resolve(room, 1);
  assert.deepEqual([A.q, A.r], [6, 2], 'le chemin est suivi (pas la ligne droite vers la cible)');
});

test('simultané : le contact avec la cible arrête le chemin et déclenche la mêlée', () => {
  const { room, A, B, T } = simSetup();
  put(room, A, 4, 4); put(room, B, 7, 4);
  assert.ok(T.setOrders(room, 'p0', { [A.id]: { type: 'charge', targetId: B.id, path: [[5, 4], [6, 4], [6, 3]] } }).ok);
  const res = T.resolve(room, 1);
  assert.deepEqual([A.q, A.r], [6, 4]);
  assert.ok(events(res).some(e => e.k === 'combat'), 'mêlée');
});

test('simultané : chemin d\'attaque trop long refusé à la planification', () => {
  const { room, A, B, T } = simSetup();
  put(room, A, 4, 4); put(room, B, 7, 4);
  assert.ok(T.setOrders(room, 'p0', { [A.id]: { type: 'attack', targetId: B.id, path: [[4, 3], [5, 2], [6, 2], [6, 1]] } }).error);
});
