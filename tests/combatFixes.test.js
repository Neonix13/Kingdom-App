const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../game/rules');
const { simRoom, put, units, events } = require('./simHelpers');

function setup(armies) {
  const room = simRoom(armies);
  put(room, units(room, 'p0').general, 0, 8, { visionRange: 3 });
  put(room, units(room, 'p1').general, 13, 0, { visionRange: 3 });
  return { room, A: units(room, 'p0').troops, B: units(room, 'p1').troops, T: room.turns };
}
const order = (room, pid, orders) => assert.ok(room.turns.setOrders(room, pid, orders).ok);
const combats = (res) => events(res).filter(e => e.k === 'combat');

test('simultané : l\'égalité entre attaques mutuelles est tirée au sort (graine), pas gagnée par la première armée', () => {
  const firstAttacker = new Set();
  for (let seed = 1; seed <= 24; seed++) {
    const { room, A, B, T } = setup();
    put(room, A[0], 5, 4, { stance: 'combat' }); put(room, B[0], 6, 4, { stance: 'combat' });
    order(room, 'p0', { [A[0].id]: { type: 'attack', targetId: B[0].id } });
    order(room, 'p1', { [B[0].id]: { type: 'attack', targetId: A[0].id } });
    const c = combats(T.resolve(room, seed));
    assert.equal(c.length, 1);
    assert.equal(c[0].kind, 'encounter');
    firstAttacker.add(c[0].log.attackerId === A[0].id ? 'p0' : 'p1');
  }
  assert.deepEqual([...firstAttacker].sort(), ['p0', 'p1']);
});

test('simultané : même graine, même ordre de priorité', () => {
  const run = () => {
    const { room, A, B, T } = setup();
    put(room, A[0], 5, 4, { stance: 'combat' }); put(room, B[0], 6, 4, { stance: 'combat' });
    order(room, 'p0', { [A[0].id]: { type: 'attack', targetId: B[0].id } });
    order(room, 'p1', { [B[0].id]: { type: 'attack', targetId: A[0].id } });
    return combats(T.resolve(room, 7))[0].log.attackerId;
  };
  assert.equal(run(), run());
});

test('simultané : en attaque mutuelle, l\'unité qui charge est l\'attaquant', () => {
  for (let seed = 1; seed <= 10; seed++) {
    const { room, A, B, T } = setup();
    put(room, A[0], 5, 4, { stance: 'combat' }); put(room, B[0], 6, 4, { stance: 'charge' });
    order(room, 'p0', { [A[0].id]: { type: 'attack', targetId: B[0].id } });
    order(room, 'p1', { [B[0].id]: { type: 'attack', targetId: A[0].id } });
    assert.equal(combats(T.resolve(room, seed))[0].log.attackerId, B[0].id);
  }
});

test('simultané : un tir sur une unité qui ne peut pas le bloquer → pas de demi-tour, journal « rien »', () => {
  const { room, A, B, T } = setup({ p0: [{ typeId: 'archer', count: 1 }], p1: [{ typeId: 'soldats', count: 1 }] });
  put(room, A[0], 4, 4, { stance: 'combat' }); put(room, B[0], 6, 4, { stance: 'combat', facing: 2 });
  order(room, 'p0', { [A[0].id]: { type: 'attack', targetId: B[0].id } });
  const c = combats(T.resolve(room, 3));
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, 'ranged');
  assert.equal(c[0].log.defenseChoice, 'rien');
  assert.equal(B[0].facing, 2, 'la cible ne se tourne pas vers le tireur');
});

test('simultané : un archer au contact se bat en mêlée (événement et journal cohérents)', () => {
  const { room, A, B, T } = setup({ p0: [{ typeId: 'archer', count: 1 }], p1: [{ typeId: 'soldats', count: 1 }] });
  put(room, A[0], 5, 4, { stance: 'combat' }); put(room, B[0], 6, 4, { stance: 'combat' });
  order(room, 'p0', { [A[0].id]: { type: 'attack', targetId: B[0].id } });
  const c = combats(T.resolve(room, 5));
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, 'melee');
  assert.equal(c[0].log.ranged, false);
  assert.equal(c[0].log.defenseChoice, 'counter', 'riposte permise au contact');
});

test('portée : le bonus de hauteur ne vaut que pour les tireurs, la mêlée reste à 1 case', () => {
  assert.equal(rules.attackRange(1, 2, 0), 1);
  assert.equal(rules.attackRange(1, 0, 2), 1);
  assert.equal(rules.attackRange(3, 1, 0), 4);
  assert.equal(rules.attackRange(3, 0, 3), 1);
  const { room, A, B } = setup();
  put(room, A[0], 5, 4); put(room, B[0], 7, 4);
  room.heightData['5,4'] = 1;
  const p0 = room.getPlayer('p0');
  room.currentPlayerId = p0.id;
  const res = room.initiateCombat ? room.initiateCombat(p0.id, A[0].id, B[0].id) : null;
  if (res) assert.ok(res.error, 'une unité de mêlée en hauteur ne frappe pas à 2 cases');
});
