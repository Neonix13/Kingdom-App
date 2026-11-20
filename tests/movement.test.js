const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');
const rules = require('../game/rules');
const maps = require('../game/maps');
const { hexKey, segmentEdgeKey } = require('../game/HexUtils');
const { registerTestMap, createHarness, setupBattle } = require('./helpers');
const { simRoom, put, units, events } = require('./simHelpers');

registerTestMap();

function battleRoom() {
  const room = new GameRoom('MOVE', 'p0', { mapId: 'test-small' });
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
  return room;
}

function teleport(room, u, q, r) {
  delete room.unitMap[hexKey(u.q, u.r)];
  u.q = q; u.r = r;
  room.unitMap[hexKey(q, r)] = u;
  room._initUnitSpeedForTurn(u);
}

function reachOf(room, u) {
  return rules.reachable(room.moveTable(), {
    start: { q: u.q, r: u.r }, maxCost: u.speedRemaining, minStep: rules.hasFullSpeed(u), mounted: rules.isMounted(u),
    hexAt: (k) => room.hexMap[k] || null, blocked: (k) => !!room.unitMap[k],
    segAt: (a, b, c, d) => room.segmentData[segmentEdgeKey(a, b, c, d)] || null,
  });
}

function sides(room) {
  const me = room.getPlayer(room.getCurrentPlayerId());
  const foe = room.players.find(p => p !== me);
  return { me, foe, mine: me.units.find(u => !u.isGeneral), enemy: foe.units.find(u => !u.isGeneral) };
}

test('attaque à distance : la meilleure case d\'approche est trouvée, l\'unité s\'y rend et attaque en une action', () => {
  const room = battleRoom();
  const { me, mine, enemy } = sides(room);
  for (const p of room.players) teleport(room, p.units.find(u => u.isGeneral), p === me ? 0 : 9, 7);
  teleport(room, mine, 0, 1);
  teleport(room, enemy, 3, 1);
  const best = rules.bestAttackHex(reachOf(room, mine), { start: mine, target: enemy, range: mine.range, heightAt: (k) => room.heightData[k] });
  assert.ok(best, 'une case d\'approche existe');
  assert.equal(rules.hexDistance(best.q, best.r, enemy.q, enemy.r), 1);
  assert.equal(best.path[best.path.length - 1].join(','), best.key);
  const res = room.moveAndAttack(me.id, mine.id, enemy.id, best.q, best.r);
  assert.ok(res.move && res.move.ok, res.error);
  assert.ok(res.attack && res.attack.pending, 'l\'attaque est lancée');
  assert.deepEqual([mine.q, mine.r], [best.q, best.r]);
  assert.ok(mine.hasAttacked);
});

test('attaque à distance : cible hors d\'atteinte → l\'unité ne bouge pas du tout', () => {
  const room = battleRoom();
  const { me, mine, enemy } = sides(room);
  for (const p of room.players) teleport(room, p.units.find(u => u.isGeneral), p === me ? 0 : 9, 0);
  teleport(room, mine, 0, 4);
  teleport(room, enemy, 9, 4);
  assert.equal(rules.bestAttackHex(reachOf(room, mine), { start: mine, target: enemy, range: mine.range, heightAt: (k) => room.heightData[k] }), null);
  const speed = mine.speedRemaining;
  const res = room.moveAndAttack(me.id, mine.id, enemy.id, 1, 4);
  assert.ok(res.error);
  assert.deepEqual([mine.q, mine.r], [0, 4]);
  assert.equal(mine.speedRemaining, speed);
  assert.ok(!mine.hasAttacked);
  assert.ok(room.moveAndAttack(me.id, mine.id, enemy.id, 9, 9).error, 'case hors carte');
});

test('attaque à distance : un tireur reste le plus loin possible de sa cible', () => {
  const reach = { dist: new Map([['0,0', 0], ['1,0', 1], ['2,0', 2], ['3,0', 3]]), prev: new Map([['1,0', '0,0'], ['2,0', '1,0'], ['3,0', '2,0']]) };
  const opts = { start: { q: 0, r: 0 }, target: { q: 6, r: 0 }, heightAt: () => 0 };
  assert.equal(rules.bestAttackHex(reach, { ...opts, range: 3 }).key, '3,0');
  assert.equal(rules.bestAttackHex(reach, { ...opts, range: 4 }).key, '2,0', 'la case à portée la plus éloignée de la cible');
  assert.equal(rules.bestAttackHex(reach, { ...opts, range: 1 }), null);
});

test('protocole : attack_unit avec case d\'approche → animation de déplacement puis demande de défense', async () => {
  const h = createHarness();
  const { first, second } = await setupBattle(h);
  const gs = first.last('game_state');
  const map = maps.getMap('test-small');
  const general = gs.myUnits.find(u => u.isGeneral);
  const occupied = new Set(gs.units.map(u => hexKey(u.q, u.r)));
  const reach = rules.reachable(gs.movementRules, {
    start: general, maxCost: general.speedRemaining, minStep: rules.hasFullSpeed(general), mounted: false,
    hexAt: (k) => (k in map.height ? { terrain: map.terrain[k] || 'plain', height: map.height[k] } : null),
    blocked: (k) => occupied.has(k), segAt: (a, b, c, d) => map.segments[segmentEdgeKey(a, b, c, d)] || null,
  });
  const target = gs.units.filter(u => !u.isMine)
    .map(u => ({ u, best: rules.bestAttackHex(reach, { start: general, target: u, range: 1, heightAt: (k) => map.height[k] }) }))
    .find(x => x.best && x.best.path.length && rules.hexDistance(general.q, general.r, x.u.q, x.u.r) > 1);
  assert.ok(target, 'un ennemi à attaquer après un déplacement');
  await first.send('attack_unit', { attackerId: general.id, targetId: target.u.id, approachQ: target.best.q, approachR: target.best.r });
  assert.equal(first.errors().length, 0, JSON.stringify(first.errors()));
  const anim = first.last('unit_move_anim');
  assert.ok(anim && anim.unitId === general.id);
  assert.deepEqual(anim.path[anim.path.length - 1], [target.best.q, target.best.r]);
  assert.ok(first.last('waiting_defense') || target.u.isGeneral);
  if (!target.u.isGeneral) assert.ok(second.last('defense_request'));
});

test('eau : une unité qui n\'a encore rien dépensé peut toujours faire un pas (général dans la rivière, de nuit)', () => {
  const room = battleRoom();
  const { me } = sides(room);
  const general = me.units.find(u => u.isGeneral);
  room.isNight = () => true;
  general.speed = 3;
  teleport(room, general, 8, 6);
  assert.equal(room.hexMap['8,6'].terrain, 'river');
  assert.equal(general.speedRemaining, 1, 'vitesse 3, rivière −1, nuit −1');
  assert.ok(rules.stepCost(room.moveTable(), room.hexMap['8,6'], room.hexMap['8,5'], null, false) > 1, 'sortir de la rivière coûte plus que la vitesse');
  const res = room.moveUnit(me.id, general.id, 8, 5);
  assert.ok(res.ok, res.error);
  assert.deepEqual([general.q, general.r], [8, 5]);
  assert.equal(general.speedRemaining, 0);
  assert.ok(room.moveUnit(me.id, general.id, 8, 4).error, 'plus de vitesse après ce pas');

  teleport(room, general, 8, 6);
  general.speedRemaining = 0.5;
  assert.ok(room.moveUnit(me.id, general.id, 8, 5).error, 'une unité qui a déjà dépensé de la vitesse n\'a pas ce pas minimum');
  teleport(room, general, 8, 6);
  assert.ok(room.moveUnit(me.id, general.id, 8, 4).error, 'un seul pas, pas deux');
});

test('ponts : une case de pont coûte comme une route, le chemin le moins cher passe par le pont', () => {
  const table = room => room.moveTable();
  const room = new GameRoom('BR', 'p0');
  const t = table(room);
  assert.equal(rules.stepCost(t, { terrain: 'bridge', height: 1 }, { terrain: 'road', height: 1 }, null, false), rules.stepCost(t, { terrain: 'road', height: 1 }, { terrain: 'road', height: 1 }, null, false));
  const { dist, prev } = rules.reachable(t, {
    start: { q: 26, r: 4 }, maxCost: 20, mounted: false,
    hexAt: (k) => room.hexMap[k] || null,
    segAt: (a, b, c, d) => room.segmentData[segmentEdgeKey(a, b, c, d)] || null,
  });
  const path = rules.pathFromPrev(prev, '26,4', '32,4').map(([q, r]) => hexKey(q, r));
  for (const k of ['28,4', '29,4', '30,4']) assert.ok(path.includes(k), `${k} (pont) sur le chemin`);
  assert.ok(dist.get('32,4') < 4);
});

test('simultané : un tireur qui reçoit une cible hors de portée marche jusqu\'à sa position de tir, puis tire', () => {
  const room = simRoom({ p0: [{ typeId: 'archer', count: 1 }] });
  put(room, units(room, 'p0').general, 0, 8, { visionRange: 9 });
  put(room, units(room, 'p1').general, 13, 0, { visionRange: 3 });
  const archer = units(room, 'p0').troops[0];
  const enemy = units(room, 'p1').troops[0];
  put(room, archer, 2, 4); put(room, enemy, 8, 4);
  const T = room.turns;
  assert.ok(T.setOrders(room, 'p0', { [archer.id]: { type: 'attack', targetId: enemy.id, path: [[3, 4], [4, 4], [5, 4]] } }).ok);
  assert.deepEqual(room.sim.orders.p0[archer.id].path, [[3, 4], [4, 4], [5, 4]]);
  const res = T.resolve(room, 5);
  const shots = events(res).filter(e => e.k === 'combat' && e.kind === 'ranged');
  assert.equal(shots.length, 1, 'le tir part une fois à portée');
  assert.equal(rules.hexDistance(archer.q, archer.r, enemy.q, enemy.r), 3);
  assert.deepEqual([archer.q, archer.r], [5, 4]);

  const room2 = simRoom();
  const melee = units(room2, 'p0').troops[0];
  put(room2, melee, 2, 4);
  assert.ok(room2.turns.setOrders(room2, 'p0', { [melee.id]: { type: 'attack', targetId: units(room2, 'p1').troops[0].id, path: [[3, 4]] } }).ok);
  assert.deepEqual(room2.sim.orders.p0[melee.id].path, [[3, 4]], 'la mêlée suit d\'abord le chemin choisi, puis va au contact');
});
