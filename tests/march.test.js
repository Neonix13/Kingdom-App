const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');
const { hexKey } = require('../game/HexUtils');
const { registerTestMap, createHarness, setupBattle } = require('./helpers');
const { simRoom, put, units } = require('./simHelpers');

registerTestMap();

// Classic battle on the 10 x 8 test map: my soldats (speed 3), the enemy soldats parked far away, generals in corners
function battleRoom() {
  const room = new GameRoom('MARCH', 'p0', { mapId: 'test-small' });
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
  return { room, me, foe, mine, enemy, place, newTurn: () => room._initUnitSpeedForTurn(mine) };
}

const ROUTE = [[2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3]];

test('marche : l\'unité avance de ce que sa vitesse paie, puis reprend la route aux tours suivants jusqu\'à destination', () => {
  const { room, me, mine, enemy, place, newTurn } = battleRoom();
  place(mine, 1, 3); place(enemy, 0, 0); newTurn();
  const res = room.marchUnit(me.id, mine.id, ROUTE);
  assert.ok(res.ok, res.error);
  assert.deepEqual([mine.q, mine.r], [4, 3]);
  assert.deepEqual(mine.march.route, [[5, 3], [6, 3], [7, 3], [8, 3]]);
  assert.deepEqual(mine.march.dest, [8, 3]);
  newTurn();
  const moves = room.runMarches(me.id);
  assert.equal(moves.length, 1);
  assert.deepEqual([mine.q, mine.r], [7, 3]);
  assert.deepEqual(mine.march.route, [[8, 3]]);
  newTurn();
  room.runMarches(me.id);
  assert.deepEqual([mine.q, mine.r], [8, 3]);
  assert.equal(mine.march, null, 'arrivée : plus d\'ordre de marche');
});

test('marche : cachée aux autres joueurs, visible par son propriétaire', () => {
  const { room, me, foe, mine, enemy, place, newTurn } = battleRoom();
  place(mine, 1, 3); place(enemy, 0, 0); newTurn();
  assert.ok(room.marchUnit(me.id, mine.id, ROUTE).ok);
  const mineView = room.getGameState(me.id).myUnits.find(u => u.id === mine.id);
  assert.ok(mineView.march && mineView.march.route.length === 4);
  foe.isEliminated = true; // an eliminated player sees every unit: still no march
  const foeView = room.getGameState(foe.id).units.find(u => u.id === mine.id);
  assert.ok(foeView);
  assert.equal(foeView.march, undefined);
});

test('marche : le contact avec un ennemi visible, une unité visible sur la route, ou un nouvel ordre l\'arrêtent', () => {
  // contact
  let s = battleRoom();
  s.place(s.mine, 1, 3); s.place(s.enemy, 0, 0); s.newTurn();
  assert.ok(s.room.marchUnit(s.me.id, s.mine.id, ROUTE).ok);
  s.place(s.enemy, 5, 2); // next to (4, 3)
  s.newTurn();
  assert.equal(s.room.runMarches(s.me.id).length, 0);
  assert.deepEqual([s.mine.q, s.mine.r], [4, 3]);
  assert.equal(s.mine.march, null);
  // a visible unit holds the next hex: the march stops in front of it
  s = battleRoom();
  s.place(s.mine, 1, 3); s.place(s.enemy, 0, 0); s.newTurn();
  assert.ok(s.room.marchUnit(s.me.id, s.mine.id, ROUTE).ok);
  s.place(s.me.units.find(u => u.isGeneral), 6, 3);
  s.newTurn();
  s.room.runMarches(s.me.id);
  assert.deepEqual([s.mine.q, s.mine.r], [5, 3]);
  s.newTurn();
  s.room.runMarches(s.me.id);
  assert.deepEqual([s.mine.q, s.mine.r], [5, 3]);
  assert.equal(s.mine.march, null);
  // a new move order replaces the march
  s = battleRoom();
  s.place(s.mine, 1, 3); s.place(s.enemy, 0, 0); s.newTurn();
  assert.ok(s.room.marchUnit(s.me.id, s.mine.id, ROUTE).ok);
  s.newTurn();
  assert.ok(s.room.moveUnit(s.me.id, s.mine.id, 4, 4).ok);
  assert.equal(s.mine.march, null);
});

test('marche : route invalide refusée (pas non voisin, bord infranchissable), rien ne bouge', () => {
  const { room, me, mine, enemy, place, newTurn } = battleRoom();
  place(mine, 1, 3); place(enemy, 0, 0); newTurn();
  assert.ok(room.marchUnit(me.id, mine.id, [[2, 3], [4, 3]]).error);
  assert.ok(room.marchUnit(me.id, mine.id, [[2, 3], [3, 3], [4, 3], [4, 4], [5, 4]]).error, 'le mur entre (4,4) et (5,4)');
  assert.deepEqual([mine.q, mine.r, mine.march || null], [1, 3, null]);
});

test('marche (protocole) : envoyée avec move_unit, elle reprend au début du tour suivant du joueur et survit à la sauvegarde', async () => {
  const h = createHarness({ roundTrip: true });
  const { first, second } = await setupBattle(h);
  const code = first.session.roomCode;
  const room = GameRoom.deserialize(JSON.parse(h.store.rooms.get(code)));
  const me = room.getPlayer(first.session.playerId);
  const troop = me.units.find(u => !u.isGeneral);
  // free a lane on row 4: every other unit goes to the far columns
  let i = 0;
  for (const p of room.players) for (const u of p.units) if (u !== troop) { u.q = p === me ? 0 : 9; u.r = i++ % 3; }
  troop.q = 1; troop.r = 4; troop.speed = 3;
  room._rebuildUnitMap();
  room._initUnitSpeedForTurn(troop);
  h.store.rooms.set(code, JSON.stringify(room.serialize()));
  const route = [[2, 4], [3, 4], [4, 4], [4, 5], [4, 6], [5, 6], [6, 6]];
  await first.send('move_unit', { unitId: troop.id, targetQ: 6, targetR: 6, march: true, path: route });
  assert.deepEqual(first.errors(), []);
  let u = first.last('game_state').myUnits.find(x => x.id === troop.id);
  assert.deepEqual([u.q, u.r], [4, 4]);
  assert.deepEqual(u.march.route, route.slice(3));
  assert.equal(second.last('game_state').units.find(x => x.id === troop.id)?.march, undefined);
  await first.send('end_turn');
  await second.send('end_turn');
  if (first.last('game_state').currentPlayerId !== first.session.playerId) {
    u = first.last('game_state').myUnits.find(x => x.id === troop.id);
    assert.deepEqual([u.q, u.r], [4, 4], 'la marche attend le tour de son propriétaire');
    await second.send('end_turn');
  }
  u = first.last('game_state').myUnits.find(x => x.id === troop.id);
  assert.equal(first.last('game_state').currentPlayerId, first.session.playerId);
  assert.deepEqual([u.q, u.r], [5, 6], 'la marche a repris au début de son tour');
  assert.ok(first.all('unit_move_anim').length >= 2);
});

// ---- simultaneous mode ----
function simSetup() {
  const room = simRoom();
  put(room, units(room, 'p0').general, 0, 8, { visionRange: 3 });
  put(room, units(room, 'p1').general, 13, 0, { visionRange: 3 });
  return { room, A: units(room, 'p0').troops[0], B: units(room, 'p1').troops[0], T: room.turns };
}

test('simultané : un déplacement en marche marche ce tour-ci, puis l\'ordre est prérempli aux planifications suivantes', () => {
  const { room, A, B, T } = simSetup();
  put(room, A, 1, 4); put(room, B, 13, 8);
  const route = [[2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4]];
  const res = T.setOrders(room, 'p0', { [A.id]: { type: 'move', path: route, march: true } });
  assert.ok(res.ok, res.error);
  assert.deepEqual(res.orders[A.id].path, route.slice(0, 3));
  assert.deepEqual(res.orders[A.id].marchRest, route.slice(3));
  T.resolve(room, 1);
  assert.deepEqual([A.q, A.r], [4, 4]);
  assert.deepEqual(A.march.route, route.slice(3));
  const pre = room.sim.orders.p0[A.id];
  assert.ok(pre, 'ordre prérempli pour le tour suivant');
  assert.deepEqual(pre.path, route.slice(3, 6));
  assert.equal(T.stateFor(room, 'p0').planning.commandPoints.used, 1, 'compte comme un ordre');
  T.resolve(room, 2);
  assert.deepEqual([A.q, A.r], [7, 4]);
  T.resolve(room, 3);
  assert.deepEqual([A.q, A.r], [9, 4]);
  assert.equal(A.march, null);
  assert.equal(room.sim.orders.p0 && room.sim.orders.p0[A.id], undefined);
});

test('simultané : retirer ou remplacer l\'ordre prérempli met fin à la marche', () => {
  const { room, A, B, T } = simSetup();
  put(room, A, 1, 4); put(room, B, 13, 8);
  const route = [[2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4]];
  assert.ok(T.setOrders(room, 'p0', { [A.id]: { type: 'move', path: route, march: true } }).ok);
  T.resolve(room, 1);
  assert.ok(room.sim.orders.p0[A.id]);
  assert.ok(T.setOrders(room, 'p0', { [A.id]: null }).ok);
  T.resolve(room, 2);
  assert.deepEqual([A.q, A.r], [4, 4]);
  assert.equal(A.march, null);
});
