const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');

function room(mapId, n = 2) {
  const r = new GameRoom('SIDE', 'p0', { mapId, mode: 'sequential' });
  const gens = ['ou_ki', 'mou_bu', 'ri_boku', 'ou_sen'];
  for (let i = 0; i < n; i++) { r.addPlayer(`p${i}`, `J${i}`); r.getPlayer(`p${i}`).generalId = gens[i]; }
  return r;
}

test('camps (Col de Kankoku) : choix, bonus d\'or des attaquants, zones du camp, alliés', () => {
  const r = room('kankoku', 3);
  assert.ok(r.mapSides());
  assert.match(r.sidesProblem(), /camp/);
  assert.ok(r.setPlayerSide('p0', 'defender').ok);
  assert.ok(r.setPlayerSide('p1', 'attacker').ok);
  assert.ok(r.setPlayerSide('p2', 'attacker').ok);
  assert.equal(r.sidesProblem(), null);
  // two attacker zones only: a third attacker is refused
  const r4 = room('kankoku', 4);
  for (const id of ['p0', 'p1']) assert.ok(r4.setPlayerSide(id, 'attacker').ok);
  assert.match(r4.setPlayerSide('p2', 'attacker').error, /complet/);

  assert.ok(r.setSettings({ attackerBonus: 1500 }).ok);
  r.budget = 5000;
  assert.equal(r.budgetOf(r.getPlayer('p0')), 5000);
  assert.equal(r.budgetOf(r.getPlayer('p1')), 6500);
  assert.ok(r.areAllies('p1', 'p2'));
  assert.ok(!r.areAllies('p0', 'p1'));

  r.startGame();
  for (const p of r.players) assert.ok(r.submitArmy(p.id, [{ typeId: 'soldats', count: 1 }]).ok);
  r.startDeployment();
  const sideOfZone = (p) => r.map.zones[p.startingZone.mapZone].side;
  for (const p of r.players) assert.equal(sideOfZone(p), p.side);
  assert.notEqual(r.getPlayer('p1').startingZone.mapZone, r.getPlayer('p2').startingZone.mapZone);
});

test('zones de déploiement tirées au hasard à chaque partie (cartes à zones fixes)', () => {
  const seen = new Set();
  for (let i = 0; i < 30 && seen.size < 2; i++) {
    const r = room('bayou', 2);
    r.startGame();
    for (const p of r.players) assert.ok(r.submitArmy(p.id, [{ typeId: 'soldats', count: 1 }]).ok);
    r.startDeployment();
    seen.add(r.getPlayer('p0').startingZone.mapZone);
    assert.notEqual(r.getPlayer('p0').startingZone.mapZone, r.getPlayer('p1').startingZone.mapZone);
  }
  assert.equal(seen.size, 2, 'le premier joueur ne reçoit pas toujours la même zone');
});

const { simRoom, units } = require('./simHelpers');

test('annihilation : à la limite de tours, l\'armée la plus forte gagne', () => {
  const room = simRoom({ p0: [{ typeId: 'soldats', count: 2 }], p1: [{ typeId: 'soldats', count: 1 }], settings: { maxTurns: 1 } });
  assert.equal(room.objectives.length, 0, 'pas d\'objectifs en annihilation');
  room.turns.resolve(room, 1);
  assert.equal(room.phase, 'ended');
  assert.equal(room.endReason, 'max_turns');
  assert.equal(room.winner, 'p0');
});

test('moral : peut devenir négatif, l\'unité fuit seulement en dessous de zéro', () => {
  const room = simRoom();
  const a = units(room, 'p0').troops[0], t = units(room, 'p1').troops[0];
  t.morale = 10;
  const res = room._resolveCombat(a, t, true, 'rien');
  res.moralDmg = 10; res.dmgReceived = 0;
  room._applyCombat(a, t, true, 'rien', res, room.getPlayer('p0'), room.getPlayer('p1'));
  assert.equal(t.morale, 0);
  assert.ok(!t.isFleeing, 'à zéro : tient encore');
  res.moralDmg = 5;
  room._applyCombat(a, t, true, 'rien', res, room.getPlayer('p0'), room.getPlayer('p1'));
  assert.equal(t.morale, -5);
  assert.ok(t.isFleeing, 'sous zéro : fuit');
});

test('charge : une unité en Charge qui n\'a pas bougé du tour repasse en Combat', () => {
  const r = room('kankoku', 2);
  r.objectives = [];
  const p = r.getPlayer('p0');
  const still = { id: 'a', q: 1, r: 1, stance: 'charge', hasMoved: false };
  const moved = { id: 'b', q: 2, r: 1, stance: 'charge', hasMoved: true };
  const gen = { id: 'g', q: 3, r: 1, isGeneral: true, stance: 'charge', hasMoved: false };
  p.units = [still, moved, gen];
  r.onPlayerTurnEnd('p0');
  assert.equal(still.stance, 'combat');
  assert.equal(moved.stance, 'charge');
  assert.equal(gen.stance, 'charge');
});
