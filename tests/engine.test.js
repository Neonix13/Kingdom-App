const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const GameRoom = require('../game/GameRoom');
const maps = require('../game/maps');
const { registerTestMap } = require('./helpers');

registerTestMap();

function battleRoom(n = 2, mapId = 'test-small') {
  const room = new GameRoom('TEST', 'p0', { mapId });
  const gens = ['ou_ki', 'mou_bu', 'ri_boku'];
  for (let i = 0; i < n; i++) {
    room.addPlayer(`p${i}`, `P${i}`);
    room.getPlayer(`p${i}`).generalId = gens[i];
  }
  room.startGame();
  for (let i = 0; i < n; i++) assert.ok(room.submitArmy(`p${i}`, [{ typeId: 'soldats', count: 1 }]).ok);
  room.startDeployment();
  for (const p of room.players) {
    const tiles = p.startingZone.tiles;
    p.units.forEach((u, j) => assert.ok(room.placeUnit(p.id, u.id, tiles[j * 2].q, tiles[j * 2].r).ok));
    assert.ok(room.setDeploymentReady(p.id).ok);
  }
  room.startBattle();
  return room;
}

test('la carte vient du registre : cases = clés de height, terrain plaine par défaut, zones fixes', () => {
  const room = new GameRoom('T', 'p', { mapId: 'test-small' });
  const map = maps.getMap('test-small');
  assert.deepEqual(Object.keys(room.hexMap).sort(), Object.keys(map.height).sort());
  assert.equal(room.hexMap['0,0'].terrain, 'plain');
  assert.equal(room.hexMap['6,1'].terrain, 'forest');
  assert.equal(room.heightData['5,5'], 2);
  const def = new GameRoom('T', 'p');
  assert.equal(Object.keys(def.hexMap).length, Object.keys(maps.getMap('default').height).length);
  const room2 = battleRoom(2);
  assert.ok(room2.players[0].startingZone.tiles.every(t => t.q <= 1));
  assert.ok(room2.players[1].startingZone.tiles.every(t => t.q >= 2 && t.q <= 3));
});

test('aucun module serveur ne lit public/data', () => {
  for (const f of ['game/GameRoom.js', 'game/HexUtils.js', 'game/protocol.js', 'simulation/Simulator.js', 'simulation/AIAgent.js']) {
    assert.ok(!fs.readFileSync(path.join(__dirname, '..', f), 'utf8').includes('public/data'), f);
  }
});

test('submitArmy : validation avant toute création d\'unité', () => {
  const room = new GameRoom('T', 'p', { mapId: 'test-small' });
  room.addPlayer('p', 'P');
  room.getPlayer('p').generalId = 'ou_ki';
  room.startGame();
  assert.ok(room.submitArmy('p', [{ typeId: 'soldats', count: 1e9 }]).error);
  assert.ok(room.submitArmy('p', [{ typeId: 'soldats', count: 1.5 }]).error);
  assert.ok(room.submitArmy('p', [{ typeId: 'toString', count: 1 }]).error);
  assert.ok(room.submitArmy('p', null).error);
  assert.ok(room.submitArmy('p', [{ typeId: 'char', count: 3 }]).error, 'budget dépassé');
  assert.equal(room.getPlayer('p').units.length, 0);
  assert.ok(room.submitArmy('p', [{ typeId: 'soldats', count: 2 }]).ok);
  assert.equal(room.getPlayer('p').units.length, 3);
});

test('ordre de tour : les éliminés sont sautés sans double tour', () => {
  const room = battleRoom(3);
  room.turnOrder = ['p0', 'p1', 'p2'];
  room.currentTurnIndex = 0;
  room.getPlayer('p1').isEliminated = true;
  assert.equal(room.getCurrentPlayerId(), 'p0');
  room.endTurn();
  assert.equal(room.getCurrentPlayerId(), 'p2', 'p1 éliminé est sauté');
  const before = room.turn;
  room.endTurn();
  assert.equal(room.turn, before + 1, 'nouveau round après p2');
  assert.ok(!room.turnOrder.includes('p1'), 'l\'initiative ne contient que les vivants');
});

test('le tour passe si le joueur actif est éliminé pendant son tour', () => {
  const room = battleRoom(3);
  room.turnOrder = ['p0', 'p1', 'p2'];
  room.currentTurnIndex = 0;
  room.eliminatePlayer('p0');
  assert.equal(room.getCurrentPlayerId(), null);
  assert.ok(room.settleTurn());
  assert.equal(room.getCurrentPlayerId(), 'p1');
});

test('sérialisation : aller-retour complet (manche, carte, mode, lien général)', () => {
  const room = battleRoom(2);
  room.endTurn();
  const copy = GameRoom.deserialize(JSON.parse(JSON.stringify(room.serialize())));
  assert.equal(copy.manche, room.manche);
  assert.equal(copy.mapId, 'test-small');
  assert.equal(copy.mode, 'sequential');
  assert.equal(copy.getCurrentPlayerId(), room.getCurrentPlayerId());
  const p = copy.players[0];
  assert.strictEqual(p.generalUnit, p.units.find(u => u.isGeneral));
  assert.equal(Object.keys(copy.unitMap).length, Object.keys(room.unitMap).length);
  assert.ok(!('hexMap' in room.serialize()));
});

test('combat : le défenseur qui contre-attaque se tourne vers l\'attaquant', () => {
  const room = battleRoom(2);
  const cur = room.getCurrentPlayerId();
  const att = room.getPlayer(cur).units.find(u => !u.isGeneral);
  const enemy = room.players.find(p => p.id !== cur);
  const def = enemy.units.find(u => !u.isGeneral);
  def.q = att.q + 1; def.r = att.r; def.facing = 3 === 0 ? 1 : 0;
  room._rebuildUnitMap();
  const res = room.initiateCombat(cur, att.id, def.id);
  assert.ok(res.pending, JSON.stringify(res));
  const out = room.resolveAttack(res.attackId, 'counter');
  assert.ok(out.ok);
  if (!out.combatLog.targetKilled) assert.equal(def.facing, 3);
});

test('déploiement : on ne voit pas les positions adverses', () => {
  const room = new GameRoom('T', 'p0', { mapId: 'test-small' });
  for (const [id, g] of [['p0', 'ou_ki'], ['p1', 'mou_bu']]) { room.addPlayer(id, id); room.getPlayer(id).generalId = g; }
  room.startGame();
  room.submitArmy('p0', [{ typeId: 'soldats', count: 1 }]);
  room.submitArmy('p1', [{ typeId: 'soldats', count: 1 }]);
  room.startDeployment();
  const t = room.getPlayer('p1').startingZone.tiles[0];
  room.placeUnit('p1', room.getPlayer('p1').units[0].id, t.q, t.r);
  const occ = Object.values(room.getDeploymentState('p0').occupiedHexes);
  assert.ok(occ.length > 0, 'ses propres unités sont placées d\'office');
  assert.ok(occ.every(o => o.playerId === 'p0'));
});

test('déploiement : toutes les unités sont placées d\'office dans la zone, et un placement sur une unité alliée échange les places', () => {
  const room = new GameRoom('T', 'p0', { mapId: 'test-small' });
  for (const [id, g] of [['p0', 'ou_ki'], ['p1', 'mou_bu']]) { room.addPlayer(id, id); room.getPlayer(id).generalId = g; }
  room.startGame();
  room.submitArmy('p0', [{ typeId: 'soldats', count: 2 }]);
  room.submitArmy('p1', [{ typeId: 'soldats', count: 1 }]);
  room.startDeployment();
  const p0 = room.getPlayer('p0');
  const zone = new Set(p0.startingZone.tiles.map(t => `${t.q},${t.r}`));
  assert.ok(p0.units.every(u => u.q !== null && zone.has(`${u.q},${u.r}`)));
  const [a, b] = p0.units;
  const [aq, ar, bq, br] = [a.q, a.r, b.q, b.r];
  assert.ok(room.placeUnit('p0', a.id, bq, br).ok);
  assert.deepEqual([a.q, a.r, b.q, b.r], [bq, br, aq, ar]);
});

test('combat (NGO) : 1 dé par 5 de vitalité, dégâts = réussites × puissance × ratio d\'armure, moral = réussites × intimidation', () => {
  const { RULES } = require('../game/rules');
  const room = battleRoom();
  const a = room.getPlayer('p0').units.find(x => x.typeId === 'soldats');
  const t = room.getPlayer('p1').units.find(x => x.typeId === 'soldats');
  a.attack = 99; // every die succeeds
  a.stance = 'combat'; t.stance = 'combat';
  a.q = 0; a.r = 0; t.q = 1; t.r = 0; t.facing = 3; // attacked from the front
  room.terrainData['0,0'] = 'plain'; room.terrainData['1,0'] = 'plain';
  room.heightData['0,0'] = 0; room.heightData['1,0'] = 0;
  room.segmentData = {};
  const r = room._resolveCombat(a, t, true, 'rien');
  const ngoA = Math.floor(a.vitality / RULES.combat.diceDivisor), ngoD = Math.floor(t.vitality / RULES.combat.diceDivisor);
  assert.equal(r.breakdown.NGOAtt, ngoA);
  assert.equal(r.breakdown.attReussite, ngoA);
  const ar = ngoD * t.armor;
  const ratio = 1 - ar / (ar + RULES.combat.armorK);
  assert.equal(r.dmgReceived, Math.round(ngoA * a.power * ratio));
  assert.equal(r.moralDmg, ngoA * a.intimidation);
  assert.equal(r.counterDmgReceived, 0);
});

test('combat : courage du défenseur (posture) retranché de l\'intimidation, angle de dos +4', () => {
  const room = battleRoom();
  const a = room.getPlayer('p0').units.find(x => x.typeId === 'soldats');
  const t = room.getPlayer('p1').units.find(x => x.typeId === 'soldats');
  a.attack = 99; a.stance = 'combat';
  a.q = 0; a.r = 0; t.q = 1; t.r = 0;
  room.terrainData['0,0'] = 'plain'; room.terrainData['1,0'] = 'plain';
  room.heightData['0,0'] = 0; room.heightData['1,0'] = 0;
  room.segmentData = {};
  t.stance = 'charge'; t.facing = 3; // facing the attacker: Charge courage_cac +1, front angle +2 (charge table)
  const front = room._resolveCombat(a, t, true, 'rien');
  assert.equal(front.breakdown.modCourageDef, -1);
  assert.equal(front.breakdown.modAngle, 2);
  assert.equal(front.breakdown.effectiveIntimidation, a.intimidation - 1 + 2);
  t.stance = 'combat'; t.facing = 0; // attacker behind
  const back = room._resolveCombat(a, t, true, 'rien');
  assert.equal(back.breakdown.modAngle, 4);
  assert.equal(back.breakdown.angleName, 'dos');
});

test('vitesse de début de tour : au moins 1 (une unité lente au repos ou en forêt peut toujours changer de posture)', () => {
  const room = battleRoom();
  const u = room.getPlayer('p0').units.find(x => x.typeId === 'soldats');
  u.stance = 'repos';
  room._initUnitSpeedForTurn(u);
  assert.equal(u.speedRemaining, 1);
  assert.ok(room.changeStance('p0', u.id, 'combat').ok);
  u.isFleeing = true;
  room._initUnitSpeedForTurn(u);
  assert.equal(u.speedRemaining, Math.floor(u.speed / 2));
});
