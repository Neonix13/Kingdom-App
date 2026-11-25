const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');
const { hexDistance } = require('../game/HexUtils');

function battle(mode) {
  const r = new GameRoom('LEAD', 'p0', { mapId: 'bayou', mode });
  const gens = ['ou_ki', 'mou_bu', 'ri_boku'];
  for (let i = 0; i < 3; i++) { r.addPlayer(`p${i}`, `J${i}`); r.getPlayer(`p${i}`).generalId = gens[i]; }
  r.budget = 100000;
  r.startGame();
  for (const p of r.players) assert.ok(r.submitArmy(p.id, [{ typeId: 'soldats', count: 2 }]).ok);
  r.startDeployment();
  for (const p of r.players) {
    const tiles = p.startingZone.tiles;
    p.units.forEach((u, j) => assert.ok(r.placeUnit(p.id, u.id, tiles[j].q, tiles[j].r).ok));
    assert.ok(r.setDeploymentReady(p.id).ok);
  }
  r.startBattle();
  return r;
}

const troops = (r, id) => r.getPlayer(id).units.filter(u => !u.isGeneral);
const general = (r, id) => r.getPlayer(id).units.find(u => u.isGeneral);

test('général perdu : ses troupes perdent leur moral max, fuient et ne jouent plus', () => {
  const r = battle('sequential');
  const p1 = r.getPlayer('p1');
  const t = troops(r, 'p1');
  const before = t.map(u => u.morale);
  r._loseGeneral(p1);
  p1.units = p1.units.filter(u => !u.isGeneral);
  assert.ok(p1.isEliminated);
  assert.equal(r.phase, 'battle');
  t.forEach((u, i) => {
    assert.equal(u.morale, before[i] - u.maxMorale);
    assert.ok(u.isFleeing);
    assert.ok(r.isLeaderless(u));
  });
  const pos = t.map(u => [u.q, u.r]);
  r.processLeaderless();
  assert.ok(t.some((u, i) => !p1.units.includes(u) || u.q !== pos[i][0] || u.r !== pos[i][1]), 'les troupes sans général fuient');
});

test('général perdu : un autre général qui réussit à les motiver prend le contrôle des troupes', () => {
  const r = battle('sequential');
  const p1 = r.getPlayer('p1');
  r._loseGeneral(p1);
  p1.units = p1.units.filter(u => !u.isGeneral);
  const g = general(r, 'p0');
  const [stray] = troops(r, 'p1');
  const free = Object.keys(r.hexMap).map(k => k.split(',').map(Number)).find(([q, rr]) => hexDistance(q, rr, g.q, g.r) === 1 && !r.unitMap[`${q},${rr}`]);
  r._vacate(stray); stray.q = free[0]; stray.r = free[1]; r._rebuildUnitMap();
  r.getCurrentPlayerId = () => 'p0';
  let res;
  for (let i = 0; i < 50; i++) {
    g.hasAttacked = false;
    res = r.motivateUnit('p0', g.id);
    assert.ok(res.ok);
    if (res.success) break;
  }
  assert.ok(res.success);
  assert.equal(res.rallied, 1);
  assert.equal(stray.playerId, 'p0');
  assert.ok(r.getPlayer('p0').units.includes(stray));
  assert.ok(!p1.units.includes(stray));
  assert.ok(!stray.isFleeing);
  assert.ok(stray.morale >= 0);
});

test('mode simultané : les troupes sans général fuient à la résolution', () => {
  const r = battle('simultaneous');
  const p1 = r.getPlayer('p1');
  r._loseGeneral(p1);
  p1.units = p1.units.filter(u => !u.isGeneral);
  const t = troops(r, 'p1');
  const pos = t.map(u => [u.q, u.r]);
  r.turns.resolve(r, 3);
  assert.ok(t.some((u, i) => !p1.units.includes(u) || u.q !== pos[i][0] || u.r !== pos[i][1]));
});
