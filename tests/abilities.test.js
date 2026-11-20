const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');
const { hexKey, segmentEdgeKey } = require('../game/HexUtils');
const { registerTestMap } = require('./helpers');

registerTestMap();

// Two armies of the given unit types, deployed then moved freely with put()
function arena(a, b) {
  const room = new GameRoom('T', 'p0', { mapId: 'test-small' });
  room.addPlayer('p0', 'A');
  room.addPlayer('p1', 'B');
  room.getPlayer('p0').generalId = 'ou_ki';
  room.getPlayer('p1').generalId = 'ri_boku';
  room.startGame();
  room.budget = 100000;
  const army = (types) => Object.entries(types.reduce((m, t) => ((m[t] = (m[t] || 0) + 1), m), {})).map(([typeId, count]) => ({ typeId, count }));
  assert.ok(room.submitArmy('p0', army(a)).ok);
  assert.ok(room.submitArmy('p1', army(b)).ok);
  room.startDeployment();
  for (const p of room.players) {
    p.units.forEach((u, j) => assert.ok(room.placeUnit(p.id, u.id, p.startingZone.tiles[j].q, p.startingZone.tiles[j].r).ok));
    assert.ok(room.setDeploymentReady(p.id).ok);
  }
  room.startBattle();
  // park everyone out of the way (row 7), generals included
  room.players.forEach((p, i) => p.units.forEach((u, j) => put(room, u, i * 5 + j % 5, 7 - Math.floor(j / 5))));
  return room;
}

function put(room, unit, q, r) {
  if (unit.q !== null && room.unitMap[hexKey(unit.q, unit.r)] === unit) delete room.unitMap[hexKey(unit.q, unit.r)];
  unit.q = q; unit.r = r;
  room.unitMap[hexKey(q, r)] = unit;
}

const unitOf = (room, pid, typeId) => room.getPlayer(pid).units.find(u => u.typeId === typeId);
const seq = (...vals) => { let i = 0; return () => (i < vals.length ? vals[i++] : 0.5); };

test('lanciers : +6 puissance contre la cavalerie et les chars (attaque et riposte), +20 armure contre les tirs', () => {
  const room = arena(['lancier', 'archer'], ['cavalier_lourd', 'soldats']);
  const l = unitOf(room, 'p0', 'lancier'), c = unitOf(room, 'p1', 'cavalier_lourd'), s = unitOf(room, 'p1', 'soldats');
  put(room, l, 3, 3); put(room, c, 4, 3);
  const r1 = room._resolveCombat(l, c, true, 'rien');
  assert.equal(r1.breakdown.lancierBonus, 6);
  assert.equal(r1.breakdown.effectivePowerAtt, room._resolveCombat(l, { ...c, category: 'Infanterie' }, true, 'rien').breakdown.effectivePowerAtt + 6);
  assert.ok(r1.bonuses.some(b => b.type === 'anti_cavalry'));
  const r2 = room._resolveCombat(c, l, true, 'counter');
  assert.equal(r2.breakdown.lancierBonusDef, 6);
  const a = unitOf(room, 'p0', 'archer');
  put(room, a, 3, 5); put(room, l, 9, 7); put(room, s, 5, 5);
  const shotLancier = room._resolveCombat(a, { ...l, q: 5, r: 4 }, false, 'rien');
  assert.equal(shotLancier.breakdown.lancierRangedBonus, 20);
  assert.equal(room._resolveCombat(a, s, false, 'rien').breakdown.lancierRangedBonus, 0);
});

test('cavalier lourd : la moitié du moral infligé frappe aussi les ennemis voisins de sa cible', () => {
  const room = arena(['cavalier_lourd'], ['soldats', 'pietaille']);
  const c = unitOf(room, 'p0', 'cavalier_lourd'), s = unitOf(room, 'p1', 'soldats'), p = unitOf(room, 'p1', 'pietaille');
  put(room, c, 3, 3); put(room, s, 4, 3); put(room, p, 5, 3);
  room._random = () => 0;
  const res = room._resolveCombat(c, s, true, 'rien');
  assert.ok(res.moralDmg > 0);
  const before = p.morale;
  const log = room._applyCombat(c, s, true, 'rien', res, room.getPlayer('p0'), room.getPlayer('p1'));
  assert.equal(before - p.morale, Math.floor(res.moralDmg * 50 / 100));
  assert.ok(log.bonuses.some(b => b.type === 'charge_bonus'));
});

test('phalange : +20 armure contre les tirs, pas d\'encaissement contre les archers', () => {
  const room = arena(['archer'], ['phalange', 'soldats']);
  const a = unitOf(room, 'p0', 'archer'), ph = unitOf(room, 'p1', 'phalange'), so = unitOf(room, 'p1', 'soldats');
  put(room, a, 2, 3); put(room, ph, 4, 3); put(room, so, 4, 4);
  const r = room._resolveCombat(a, ph, false, 'absorb');
  assert.equal(r.breakdown.phalangeBonus, 20);
  assert.equal(r.breakdown.defenseChoice, 'rien', 'contre des archers la phalange n\'encaisse pas');
  assert.ok(r.bonuses.some(b => b.type === 'defend_ranged'));
  const r2 = room._resolveCombat(a, so, false, 'absorb');
  assert.equal(r2.breakdown.phalangeBonus, 0);
  assert.equal(r2.breakdown.defReussite, null);
});

test('soldats : après leur attaque, un ennemi sous 10 % de vitalité est exécuté (jamais un général, pas en riposte)', () => {
  const room = arena(['soldats'], ['pietaille']);
  const s = unitOf(room, 'p0', 'soldats'), p = unitOf(room, 'p1', 'pietaille');
  put(room, s, 3, 3); put(room, p, 4, 3);
  const res = room._resolveCombat(s, p, true, 'rien');
  res.dmgReceived = Math.max(1, res.dmgReceived || 1);
  p.vitality = Math.floor(p.maxVitality * 0.1) - 1 + res.dmgReceived;
  const log = room._applyCombat(s, p, true, 'rien', res, room.getPlayer('p0'), room.getPlayer('p1'));
  assert.equal(log.targetKilled, true);
  assert.ok(log.bonuses.some(b => b.type === 'execute_low_hp'));
  const g = room.getPlayer('p1').units.find(u => u.isGeneral);
  put(room, g, 4, 3);
  g.vitality = 3;
  const res2 = room._resolveCombat(s, g, true, 'rien');
  res2.dmgReceived = 1;
  const log2 = room._applyCombat(s, g, true, 'rien', res2, room.getPlayer('p0'), room.getPlayer('p1'));
  assert.ok(!(log2.bonuses || []).some(b => b.type === 'execute_low_hp'));
  // riposte of soldiers: no execution
  const room2 = arena(['pietaille'], ['soldats']);
  const pa = unitOf(room2, 'p0', 'pietaille'), sd = unitOf(room2, 'p1', 'soldats');
  put(room2, pa, 3, 3); put(room2, sd, 4, 3);
  const r3 = room2._resolveCombat(pa, sd, true, 'counter');
  r3.counterDmgReceived = 1; r3.dmgReceived = 0;
  pa.vitality = Math.floor(pa.maxVitality * 0.1) - 1 + 1;
  const log3 = room2._applyCombat(pa, sd, true, 'counter', r3, room2.getPlayer('p0'), room2.getPlayer('p1'));
  assert.ok(!(log3.bonuses || []).some(b => b.type === 'execute_low_hp'));
});

test('assassin : invisible pour un ennemi qui n\'a aucune unité à 4 cases ou moins', () => {
  const room = arena(['assassin'], ['soldats']);
  const a = unitOf(room, 'p0', 'assassin'), s = unitOf(room, 'p1', 'soldats');
  for (const u of room.getPlayer('p1').units) put(room, u, 9, 7 - room.getPlayer('p1').units.indexOf(u));
  put(room, a, 3, 3);
  put(room, s, 8, 3);
  assert.equal(room.isConcealedFrom('p1', a), true, 'à 5 cases : invisible');
  put(room, s, 7, 3);
  assert.equal(room.isConcealedFrom('p1', a), false, 'à 4 cases : visible (en plaine)');
});

test('assassin : disparaît pour la journée si aucun ennemi à moins de 6 cases ; attaquer le révèle', () => {
  const room = arena(['assassin'], ['soldats']);
  const a = unitOf(room, 'p0', 'assassin'), s = unitOf(room, 'p1', 'soldats');
  for (const u of room.getPlayer('p1').units) put(room, u, 9, 7 - room.getPlayer('p1').units.indexOf(u));
  put(room, a, 1, 1);
  a.speedRemaining = 4;
  room.currentPlayerId = 'p0';
  assert.ok(room.vanish('p0', a.id).ok);
  assert.equal(a.speedRemaining, 2);
  assert.equal(room.isConcealedFrom('p1', a), true);
  assert.ok(room.vanish('p0', a.id).error, 'une fois par jour');
  put(room, s, 4, 1);
  assert.equal(room.isConcealedFrom('p1', a), true, 'reste caché même plus près');
  room._reveal(a);
  assert.equal(room.isConcealedFrom('p1', a), false);
  const b = arena(['assassin'], ['soldats']);
  const a2 = unitOf(b, 'p0', 'assassin'), s2 = unitOf(b, 'p1', 'soldats');
  put(b, a2, 1, 1); put(b, s2, 4, 1);
  a2.speedRemaining = 4;
  assert.ok(b.vanish('p0', a2.id).error);
});

test('cavalier léger : attaquer coûte 2 de vitesse et il peut encore se déplacer', () => {
  const room = arena(['cavalier_leger'], ['soldats']);
  const c = unitOf(room, 'p0', 'cavalier_leger'), s = unitOf(room, 'p1', 'soldats');
  put(room, c, 3, 3); put(room, s, 4, 3);
  room.turnOrder = ['p0', 'p1']; room.currentTurnIndex = 0;
  c.speedRemaining = 6; c.turnSpeed = 6; c.hasAttacked = false; c.hasMoved = true;
  const init = room.initiateCombat('p0', c.id, s.id);
  assert.ok(init.pending, JSON.stringify(init));
  assert.equal(c.speedRemaining, 4);
  assert.ok(room.resolveAttack(init.attackId, 'rien').ok);
  assert.equal(c.hasMoved, false);
  assert.ok(room.moveUnit('p0', c.id, 2, 3).ok);
});

test('cavalier léger : +1 vitesse s\'il n\'est pas engagé', () => {
  const room = arena(['cavalier_leger'], ['soldats']);
  const c = unitOf(room, 'p0', 'cavalier_leger'), s = unitOf(room, 'p1', 'soldats');
  put(room, c, 3, 3);
  room._initUnitSpeedForTurn(c);
  const free = c.speedRemaining;
  put(room, s, 4, 3);
  room._initUnitSpeedForTurn(c);
  assert.equal(free - c.speedRemaining, 1);
});

test('piétaille : +10 moral par tour dans le rayon de Charisme / 5 de son général', () => {
  const room = arena(['pietaille'], ['soldats']);
  const p = unitOf(room, 'p0', 'pietaille'), g = room.getPlayer('p0').generalUnit;
  p.stance = 'marche';
  p.morale = 50;
  put(room, g, 3, 3); put(room, p, 4, 3);
  room._applyTurnRegen(p);
  const near = p.morale;
  p.morale = 50;
  put(room, p, 8, 3);
  room._applyTurnRegen(p);
  assert.equal(near - p.morale, 10);
});

test('espion : sabote un pont (segment -> rivière), coûte 2 de vitesse, persiste après sauvegarde', () => {
  const room = arena(['espion'], ['soldats']);
  const e = unitOf(room, 'p0', 'espion');
  put(room, e, 3, 3);
  const ek = segmentEdgeKey(3, 3, 4, 3);
  room.mapEdits = { seg: { [ek]: 'bridge' }, ter: {} };
  room._applyMapEdits();
  e.speedRemaining = 4;
  assert.ok(room.sabotage('p0', e.id, 4, 4).error, 'rien à saboter');
  const r = room.sabotage('p0', e.id, 4, 3);
  assert.ok(r.ok);
  assert.equal(room.segmentData[ek], 'river');
  assert.equal(e.speedRemaining, 2);
  const copy = GameRoom.deserialize(room.serialize());
  assert.equal(copy.segmentData[ek], 'river');
  assert.equal(new GameRoom('X', 'p', { mapId: 'test-small' }).segmentData[ek], undefined, 'la carte partagée est intacte');
  assert.ok(room.drainEvents().some(ev => ev.event === 'map_edit'));
});

test('bâtisseurs : chevaux de frise, pont sur une rivière, forêt brûlée (l\'embusqué y perd sa couverture)', () => {
  const room = arena(['batisseurs', 'batisseurs', 'batisseurs'], ['soldats']);
  const [b1, b2, b3] = room.getPlayer('p0').units.filter(u => u.typeId === 'batisseurs');
  const s = unitOf(room, 'p1', 'soldats');
  for (const b of [b1, b2, b3]) b.speedRemaining = 4;
  put(room, b1, 3, 3);
  assert.ok(room.build('p0', b1.id, 4, 3, 'chevaux_de_frise').ok);
  assert.equal(room.segmentData[segmentEdgeKey(3, 3, 4, 3)], 'chevaux_de_frise');
  assert.ok(room.build('p0', b1.id, 4, 3, 'barriere').error, 'arête déjà construite');
  put(room, b2, 7, 6);
  assert.ok(room.build('p0', b2.id, 8, 6, 'pont').ok);
  assert.equal(room.terrainData['8,6'], 'bridge');
  assert.equal(room.hexMap['8,6'].terrain, 'bridge');
  put(room, s, 6, 1);
  put(room, b3, 5, 1);
  assert.equal(room._inCover(6, 1), true);
  assert.ok(room.build('p0', b3.id, 6, 1, 'bruler').ok);
  assert.equal(room.terrainData['6,1'], 'plain');
  assert.equal(room._inCover(6, 1), false);
});

test('char : traverse les unités ennemies vues et frappe chacune (sans riposte), jamais sur une case occupée', () => {
  const room = arena(['char', 'soldats'], ['soldats', 'pietaille']);
  const c = unitOf(room, 'p0', 'char'), mine = unitOf(room, 'p0', 'soldats');
  const t1 = unitOf(room, 'p1', 'soldats');
  put(room, c, 2, 3); put(room, t1, 3, 3);
  room.turnOrder = ['p0', 'p1']; room.currentTurnIndex = 0;
  c.speedRemaining = 5; c.turnSpeed = 5;
  const v0 = t1.vitality;
  const mv = room.moveUnit('p0', c.id, 4, 3);
  assert.ok(mv.ok, JSON.stringify(mv));
  assert.deepEqual([c.q, c.r], [4, 3]);
  assert.equal(mv.trampledAttacks.length, 1);
  assert.equal(mv.trampledAttacks[0].targetId, t1.id);
  assert.equal(mv.trampledAttacks[0].combatLog.trample, true);
  assert.equal(mv.trampledAttacks[0].combatLog.counterDmgReceived, 0);
  assert.ok(t1.vitality <= v0);
  put(room, mine, 5, 3);
  c.speedRemaining = 5;
  assert.ok(room.moveUnit('p0', c.id, 5, 3).error, 'jamais sur une case occupée');
  mine.speedRemaining = 2; mine.turnSpeed = 2;
  put(room, mine, 5, 5); put(room, t1, 6, 5);
  assert.ok(room.moveUnit('p0', mine.id, 7, 5).error, 'les autres unités ne traversent pas');
});
