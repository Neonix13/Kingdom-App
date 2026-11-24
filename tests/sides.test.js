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

  assert.ok(r.setSettings({ attackerBonus: 30 }).ok);
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
