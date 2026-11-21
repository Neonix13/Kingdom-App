const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');
const maps = require('../game/maps');
const rules = require('../game/rules');
const { createHarness, setupBattle, registerTestMap } = require('./helpers');

registerTestMap();

// 12 x 6 open map: column q=5 has a cliff edge on r=0..2, a ladder at r=3 and a 1-level slope at r=4..5
function registerRulesMap() {
  const height = {}, terrain = {}, segments = {};
  for (let q = 0; q < 12; q++) for (let r = 0; r < 6; r++) height[`${q},${r}`] = q >= 6 ? 1 : 0;
  for (let r = 0; r < 3; r++) segments[`5,${r}|6,${r}`] = 'cliff';
  segments['5,3|6,3'] = 'echelle';
  for (let r = 0; r < 6; r++) terrain[`2,${r}`] = 'road';
  terrain['9,2'] = 'forest';
  terrain['9,3'] = 'building';
  const tiles = (q0) => ({ tiles: Object.keys(height).filter(k => { const q = +k.split(',')[0]; return q >= q0 && q <= q0 + 1; }) });
  return maps.registerMap({ id: 'test-rules', name: 'Règles', height, terrain, segments, zones: [tiles(0), tiles(10)], objectives: [{ q: 6, r: 5, type: 'flag', points: 2, name: 'Gué' }] });
}
registerRulesMap();

function battle({ mapId = 'test-rules', a = [{ typeId: 'soldats', count: 1 }], b = [{ typeId: 'soldats', count: 1 }], settings = {} } = {}) {
  const room = new GameRoom('T', 'p0', { mapId, record: true });
  room.addPlayer('p0', 'A'); room.getPlayer('p0').generalId = 'ou_ki';
  room.addPlayer('p1', 'B'); room.getPlayer('p1').generalId = 'mou_bu';
  assert.ok(room.setSettings(settings).ok);
  room.startGame();
  assert.ok(room.submitArmy('p0', a).ok);
  assert.ok(room.submitArmy('p1', b).ok);
  room.startDeployment();
  for (const p of room.players) {
    p.units.forEach((u, j) => assert.ok(room.placeUnit(p.id, u.id, p.startingZone.tiles[j].q, p.startingZone.tiles[j].r).ok));
    room.setDeploymentReady(p.id);
  }
  room.startBattle();
  room.turnOrder = ['p0', 'p1'];
  room.currentTurnIndex = 0;
  return room;
}

function put(room, unit, q, r) {
  unit.q = q; unit.r = r;
  room._rebuildUnitMap();
}

const troop = (room, pid, i = 0) => room.getPlayer(pid).units.filter(u => !u.isGeneral)[i];
const general = (room, pid) => room.getPlayer(pid).units.find(u => u.isGeneral);

test('escalier de pierre : coût fixe de 2 quelle que soit la pente, interdit à la cavalerie et aux chars', () => {
  const T = rules.MOVE_TABLE;
  const flat = { terrain: 'plain', height: 0 }, wall = { terrain: 'plain', height: 2 };
  assert.equal(rules.stepCost(T, flat, wall, 'escalier', false), 2, 'monter sur le rempart');
  assert.equal(rules.stepCost(T, wall, flat, 'escalier', false), 2, 'redescendre');
  assert.equal(rules.stepCost(T, { terrain: 'forest', height: 0 }, wall, 'escalier', false), 2, 'le terrain de départ ne compte pas');
  assert.equal(rules.stepCost(T, flat, wall, 'escalier', true), Infinity, 'pas de chevaux dans un escalier');
  assert.equal(T.seg.escalier.mountedBlocked, true);
});

test('mouvement : falaise infranchissable, échelle pour l\'infanterie seulement, pente +1 par niveau, route 1/3', () => {
  const T = rules.MOVE_TABLE;
  const flat = { terrain: 'plain', height: 0 }, high = { terrain: 'plain', height: 1 };
  assert.equal(rules.stepCost(T, flat, high, 'cliff', false), Infinity);
  assert.equal(rules.stepCost(T, flat, high, 'mur', false), Infinity);
  assert.equal(rules.stepCost(T, flat, high, 'echelle', false), 3);
  assert.equal(rules.stepCost(T, flat, high, 'echelle', true), Infinity, 'cavalerie : jamais d\'échelle');
  assert.equal(rules.stepCost(T, flat, high, null, false), 2, 'montée : 1 + 1');
  assert.equal(rules.stepCost(T, high, flat, null, false), 1, 'descente gratuite');
  assert.equal(rules.stepCost(T, { terrain: 'road', height: 0 }, flat, null, false), 1 / 3);
  assert.equal(rules.snap(1 / 3 + 1 / 3 + 1 / 3), 1);

  const room = battle({ a: [{ typeId: 'soldats', count: 1 }, { typeId: 'cavalier_leger', count: 1 }] });
  const inf = troop(room, 'p0', 0);
  const cav = troop(room, 'p0', 1);
  put(room, inf, 5, 1); inf.speedRemaining = 10;
  assert.ok(room.moveUnit('p0', inf.id, 6, 1).ok, 'détour par l\'échelle ou la pente');
  assert.ok(room.getPlayer('p0').units.find(u => u.id === inf.id).speedRemaining < 10 - 1);
  put(room, inf, 5, 3); inf.speedRemaining = 3;
  const r1 = room.moveUnit('p0', inf.id, 6, 3);
  assert.ok(r1.ok);
  assert.equal(inf.speedRemaining, 0, 'échelle : coût fixe 3');
  put(room, inf, 0, 5);
  put(room, cav, 5, 3); cav.speedRemaining = 2;
  assert.ok(room.moveUnit('p0', cav.id, 6, 3).error, 'la cavalerie ne prend pas l\'échelle');
  cav.speedRemaining = 3;
  assert.ok(room.moveUnit('p0', cav.id, 6, 3).ok, 'contourne par la pente (r=4)');
  put(room, inf, 2, 0); inf.speedRemaining = 1;
  assert.ok(room.moveUnit('p0', inf.id, 2, 3).ok, 'trois pas de route = 1');
  assert.equal(inf.speedRemaining, 0);
});

test('chemin : le client et le serveur utilisent la même table (envoyée dans game_state)', () => {
  const room = battle();
  const gs = room.getGameState('p0');
  assert.deepEqual(gs.movementRules, rules.MOVE_TABLE);
  assert.equal(gs.movementRules.seg.cliff.blocked, true);
  assert.equal(gs.movementRules.seg.echelle.ladder, true);
});

test('jour / nuit : heure par tour, réglage 5-20, vision et vitesse réduites la nuit', () => {
  const room = battle();
  assert.equal(room.timeOfDay(1), 8);
  assert.equal(room.timeOfDay(2), 9, '12 tours par demi-journée = 1 h par tour');
  assert.equal(room.isNight(10), false);
  assert.equal(room.isNight(11), true, '18:00');
  assert.equal(room.isNight(23), false, '6:00 le lendemain');
  assert.equal(room.dayNumber(23), 2);
  const st = room.getGameState('p0');
  assert.equal(st.timeOfDay, 8);
  assert.equal(st.isNight, false);

  const fast = new GameRoom('X', 'p', { mapId: 'test-rules' });
  assert.ok(fast.setSettings({ turnsPerHalfDay: 5 }).ok);
  assert.equal(fast.timeOfDay(2), 10.4);
  assert.ok(fast.setSettings({ turnsPerHalfDay: 4 }).error);
  assert.ok(fast.setSettings({ turnsPerHalfDay: 21 }).error);
  assert.ok(fast.setSettings({ spectatorVision: 'x' }).error);
  assert.ok(fast.setSettings({ turnTimer: 5 }).error, 'minuteur : 0 ou >= 15 s');

  const g = general(room, 'p0');
  const dayVision = room.getVisibleHexes('p0').size;
  const s = troop(room, 'p0');
  room.turn = 11;
  assert.ok(room.getVisibleHexes('p0').size < dayVision, 'moins de vision la nuit');
  room._initUnitSpeedForTurn(s);
  const night = s.speedRemaining;
  room.turn = 1;
  room._initUnitSpeedForTurn(s);
  assert.equal(night, s.speedRemaining - 1, '-1 vitesse la nuit');
  assert.ok(g);
});

test('nuit : attaque affaiblie, posture de repos renforcée', () => {
  const room = battle();
  const s = troop(room, 'p0');
  const e = troop(room, 'p1');
  put(room, s, 4, 2); put(room, e, 5, 2);
  room.turn = 11;
  const res = room._resolveCombat(s, e, true, 'rien');
  assert.equal(res.breakdown.modNuit, rules.RULES.night.attackMod.cac);
  s.stance = 'repos';
  s.morale = 10;
  room._applyTurnRegen(s);
  assert.equal(s.morale, 10 + rules.getStance('repos').moral_tour + rules.RULES.night.restStances.repos.moral_tour);
  assert.ok(room.changeStance('p0', e.id, 'repos').error, 'pas une unité du joueur');
});

test('embuscade : unité en forêt cachée sauf adjacence / espion à 2 cases / après avoir attaqué', () => {
  const room = battle({ b: [{ typeId: 'soldats', count: 1 }, { typeId: 'espion', count: 1 }] });
  const hidden = troop(room, 'p0');
  const enemy = troop(room, 'p1', 0);
  const spy = troop(room, 'p1', 1);
  put(room, hidden, 9, 2); // forest
  put(room, enemy, 7, 2);
  put(room, spy, 11, 5);
  const visHex = room.getVisibleHexes('p1');
  assert.ok(visHex.has('9,2'), 'la case est dans la vision');
  assert.equal(room.canSee('p1', hidden), false, 'mais l\'unité est cachée');
  assert.ok(!room.getGameState('p1').units.some(u => u.id === hidden.id));
  assert.equal(room.getGameState('p0').units.find(u => u.id === hidden.id).concealed, true);
  put(room, enemy, 8, 2);
  assert.equal(room.canSee('p1', hidden), true, 'ennemi adjacent');
  put(room, enemy, 7, 2);
  put(room, spy, 9, 4);
  assert.equal(room.canSee('p1', hidden), true, 'espion à 2 cases');
  put(room, spy, 11, 5);
  assert.equal(room.canSee('p1', hidden), false);
  assert.equal(room.initiateCombat('p1', enemy.id, hidden.id).error, 'Cible introuvable.');

  // attacking reveals until the end of the owner's next turn
  put(room, enemy, 8, 2);
  enemy.vitality = enemy.maxVitality = 5000;
  hidden.hasAttacked = false;
  const atk = room.initiateCombat('p0', hidden.id, enemy.id);
  assert.ok(atk.pending);
  room.resolveAttack(atk.attackId, 'rien');
  put(room, enemy, 7, 2);
  assert.equal(room.canSee('p1', hidden), true, 'révélée après avoir attaqué');
  room.endTurn(); // p0 ends turn 1
  assert.equal(room.canSee('p1', hidden), true);
  room.endTurn(); // p1 -> round 2
  assert.equal(room.turn, 2);
  room.turnOrder = ['p0', 'p1']; room.currentTurnIndex = 0;
  assert.equal(room.canSee('p1', hidden), true, 'toujours visible pendant le tour suivant');
  room.endTurn(); // p0 ends turn 2
  assert.equal(room.canSee('p1', hidden), false, 'cachée à nouveau');
});

test('embuscade : un déplacement s\'arrête devant une unité cachée, sans révéler le chemin par une erreur', () => {
  const room = battle();
  const hidden = troop(room, 'p1');
  const mover = troop(room, 'p0');
  put(room, hidden, 9, 3); // building
  put(room, mover, 7, 3);
  mover.speedRemaining = 6;
  assert.equal(room.canSee('p0', hidden), false);
  const res = room.moveUnit('p0', mover.id, 10, 3);
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(res.ambush.byUnitId, hidden.id);
  assert.ok(!(mover.q === 10 && mover.r === 3));
  assert.equal(mover.speedRemaining, 0, 'surprise : fin du mouvement');
  assert.equal(room.canSee('p0', hidden), true);
  assert.equal(room.drainEvents().find(e => e.event === 'ambush').byUnitId, hidden.id);
});

test('duel : général contre général au corps à corps, issue décisive, charge utile combatLog.duel', () => {
  for (let i = 0; i < 20; i++) {
    const room = battle();
    const g0 = general(room, 'p0');
    const g1 = general(room, 'p1');
    put(room, g0, 4, 2); put(room, g1, 5, 2);
    g0.speedRemaining = 3;
    const atk = room.initiateCombat('p0', g0.id, g1.id);
    assert.equal(atk.duel, true);
    const out = room.resolveAttack(atk.attackId, 'rien');
    const d = out.combatLog.duel;
    assert.ok(d && Array.isArray(d.rounds) && d.rounds.length >= 1 && d.rounds.length <= rules.RULES.duel.maxRounds);
    for (const rd of d.rounds) assert.ok(rd.attacker === null || rd.attacker === g0.id || rd.attacker === g1.id);
    if (d.winnerId) {
      const loser = d.loserId === g0.id ? g0 : g1;
      if (loser.vitality > 0) {
        assert.equal(loser.stunned, true);
        loser.speed = 3;
        room._initUnitSpeedForTurn(loser);
        assert.equal(loser.speedRemaining, 0, 'sonné : pas de mouvement au tour suivant');
        room._initUnitSpeedForTurn(loser);
        assert.ok(loser.speedRemaining > 0, 'une seule fois');
        assert.ok(d.moraleShock > 0);
      } else {
        assert.equal(room.phase, 'ended', 'mort du général : partie finie');
      }
    }
    assert.equal(out.combatLog.attackerVitalityLeft, Math.max(0, g0.vitality));
  }
});

test('objectifs : capture en fin de tour, points par manche, victoire au seuil', () => {
  const room = battle({ settings: { victoryPoints: 4 } });
  assert.deepEqual(room.objectives.map(o => [o.id, o.points, o.owner]), [['6,5', 2, null]]);
  const s = troop(room, 'p0');
  put(room, s, 6, 5);
  room.endTurn();
  assert.equal(room.objectives[0].owner, 'p0');
  assert.equal(room.drainEvents().filter(e => e.event === 'objective_captured').length, 1);
  room.endTurn(); // round 2 -> +2
  assert.equal(room.scores.p0, 2);
  assert.equal(room.getGameState('p1').objectives[0].owner, 'p0', 'propriétaire public');
  room.turnOrder = ['p0', 'p1']; room.currentTurnIndex = 0;
  room.endTurn(); room.endTurn(); // round 3 -> 4
  assert.equal(room.phase, 'ended');
  assert.equal(room.winner, 'p0');
  assert.equal(room.endReason, 'points');
});

test('limite de tours : fin aux points, égalité parfaite = match nul', () => {
  const room = battle({ settings: { maxTurns: 2 } });
  for (let i = 0; i < 4 && room.phase === 'battle'; i++) { room.turnOrder = room.turnOrder.length ? room.turnOrder : ['p0', 'p1']; room.endTurn(); }
  assert.equal(room.phase, 'ended');
  assert.equal(room.endReason, 'max_turns');
  assert.equal(room.winner, null, 'armées intactes et 0 point : nul');
});

test('capacité de Mou Bu : cible obligatoire (armée ennemie), effet appliqué au combat', () => {
  const room = battle();
  room.getPlayer('p0').generalId = 'mou_bu';
  room.getPlayer('p1').generalId = 'ou_ki';
  assert.ok(room.useGeneralAbility('p0', null, null).error);
  assert.ok(room.useGeneralAbility('p0', null, 'p0').error);
  const ok = room.useGeneralAbility('p0', null, 'p1');
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(room._effectValue('armor_reduction', 'p1'), 1);
  assert.ok(room.useGeneralAbility('p0', null, 'p1').error, 'une fois par tour');
  const s = troop(room, 'p0'); const e = troop(room, 'p1');
  put(room, s, 4, 2); put(room, e, 5, 2);
  const res = room._resolveCombat(s, e, true, 'rien');
  assert.equal(res.breakdown.effectiveArmorDef, Math.max(0, e.armor + (rules.getStance(e.stance).armure || 0) - (res.breakdown.modAngle || 0) - 1));
});

test('récapitulatif et replay : statistiques par joueur et par unité, enregistrement compact', () => {
  const room = battle();
  const s = troop(room, 'p0'); const e = troop(room, 'p1');
  put(room, s, 4, 2); put(room, e, 5, 2);
  s.speedRemaining = 3;
  assert.ok(room.moveUnit('p0', s.id, 4, 3).ok);
  const atk = room.initiateCombat('p0', s.id, e.id);
  room.resolveAttack(atk.attackId, 'counter');
  room.eliminatePlayer('p1');
  assert.equal(room.phase, 'ended');
  const recap = room.getRecap();
  assert.equal(recap.winnerId, 'p0');
  assert.equal(recap.endReason, 'elimination');
  assert.equal(recap.players.length, 2);
  assert.ok(recap.units.length >= 4);
  const pr = recap.players.find(p => p.id === 'p0');
  assert.equal(pr.damageDealt, recap.units.filter(u => u.playerId === 'p0').reduce((a, u) => a + u.damageDealt, 0));
  const rep = room.getReplay();
  assert.equal(rep.format, 'kb-replay-1');
  assert.ok(rep.keyframes.length >= 2);
  assert.ok(rep.events.some(x => x.k === 'move') && rep.events.some(x => x.k === 'combat') && rep.events.some(x => x.k === 'end'));
  assert.ok(!('_bytes' in rep));
  assert.ok(JSON.stringify(rep).length < 200000);
  const copy = GameRoom.deserialize(JSON.parse(JSON.stringify(room.serialize())));
  assert.equal(copy.getReplay().events.length, rep.events.length);
});

// ---------- protocol ----------

test('protocole : réglages de l\'hôte (lobby uniquement), exposés dans room_update et game_state', async () => {
  const h = createHarness();
  const a = h.client('a');
  const b = h.client('b');
  await a.send('create_room', { playerName: 'Alice' });
  await b.send('join_room', { roomCode: a.session.roomCode, playerName: 'Bob' });
  await b.send('set_settings', { settings: { maxTurns: 10 } });
  assert.equal(b.last('error').code, 'not_host');
  await a.send('set_settings', { settings: { turnsPerHalfDay: 8, maxTurns: 30, victoryPoints: 15, turnTimer: 90, spectatorVision: 'delayed' } });
  assert.deepEqual(b.last('room_update').settings, { turnsPerHalfDay: 8, maxTurns: 30, victoryPoints: 15, turnTimer: 90, spectatorVision: 'delayed', planningTimer: 90, commandPoints: 0, teamMode: false });
  await a.send('set_settings', { settings: { turnsPerHalfDay: 50 } });
  assert.equal(a.last('error').code, 'rejected');
});

test('protocole : duel résolu immédiatement, sans demande de défense', async () => {
  const h = createHarness();
  const { first, second } = await setupBattle(h);
  const room = await h.store.get(first.session.roomCode);
  const g0 = room.getPlayer(first.session.playerId).units.find(u => u.isGeneral);
  const g1 = room.getPlayer(second.session.playerId).units.find(u => u.isGeneral);
  g0.q = 4; g0.r = 3; g1.q = 5; g1.r = 3;
  room._rebuildUnitMap();
  second.clear();
  await first.send('attack_unit', { attackerId: g0.id, targetId: g1.id });
  assert.equal(second.all('defense_request').length, 0);
  const res = first.last('combat_result').combatLog;
  assert.ok(res.duel && res.duel.rounds.length >= 1);
  assert.ok(second.last('combat_result').combatLog.duel);
  assert.equal(second.last('duel_challenge').attackerName, g0.name);
});

test('protocole : fin de tour automatique quand plus aucune unité ne peut agir, minuteur de tour', async () => {
  const h = createHarness();
  const a = h.client('a');
  const b = h.client('b');
  await a.send('create_room', { playerName: 'Alice' });
  await b.send('join_room', { roomCode: a.session.roomCode, playerName: 'Bob' });
  await a.send('set_map', { mapId: 'test-small' });
  await a.send('set_settings', { settings: { turnTimer: 30 } });
  await a.send('select_general', { generalId: 'ou_ki' });
  await b.send('select_general', { generalId: 'kan_ki' });
  await a.send('start_game');
  await a.send('submit_army', { units: [] });
  await b.send('submit_army', { units: [] });
  for (const c of [a, b]) {
    const ds = c.last('deployment_state');
    await c.send('place_unit', { unitId: ds.units[0].id, q: ds.startingZone.tiles[0].q, r: ds.startingZone.tiles[0].r });
    await c.send('deployment_ready');
  }
  const gs = a.last('game_state');
  assert.ok(gs.turnEndsAt > 0, 'échéance du minuteur exposée');
  const first = gs.currentPlayerId === a.session.playerId ? a : b;
  const second = first === a ? b : a;
  assert.ok(first.last('game_state').actionsLeft >= 1);
  const room = await h.store.get(a.session.roomCode);
  const gen = room.getPlayer(first.session.playerId).units[0];
  // general alone: move it once with all its speed -> no action left (no motivate target, no ability for Ou Ki? Ou Ki has one)
  first.clear();
  await first.send('rotate_facing', { unitId: gen.id, facing: 1 });
  await first.send('rotate_facing', { unitId: gen.id, facing: 2 });
  await first.send('rotate_facing', { unitId: gen.id, facing: 3 });
  await first.send('rotate_facing', { unitId: gen.id, facing: 4 });
  if (first.session.playerId === room.players.find(p => p.generalId === 'ou_ki').id) await first.send('use_ability', {});
  const auto = first.all('turn_auto_ended').find(m => m.reason === 'no_actions');
  assert.ok(auto, 'tour terminé automatiquement');
  assert.equal(second.last('turn_change').currentPlayerId, second.session.playerId);

  // timer: the second player's turn ends after 30 s even while connected
  h.clock.advance(31000);
  await second.send('tick');
  assert.ok(second.all('turn_auto_ended').some(m => m.reason === 'timer'));
});

test('protocole : capacité ciblée (Mou Bu) et journal sans détail pour les autres', async () => {
  const h = createHarness();
  const a = h.client('a');
  const b = h.client('b');
  await a.send('create_room', { playerName: 'Alice' });
  await b.send('join_room', { roomCode: a.session.roomCode, playerName: 'Bob' });
  await a.send('set_map', { mapId: 'test-small' });
  await a.send('select_general', { generalId: 'mou_bu' });
  await b.send('select_general', { generalId: 'ou_ki' });
  await a.send('start_game');
  for (const c of [a, b]) await c.send('submit_army', { units: [{ typeId: 'soldats', count: 1 }] });
  for (const c of [a, b]) {
    const ds = c.last('deployment_state');
    for (let i = 0; i < ds.units.length; i++) await c.send('place_unit', { unitId: ds.units[i].id, q: ds.startingZone.tiles[i * 3].q, r: ds.startingZone.tiles[i * 3].r });
    await c.send('deployment_ready');
  }
  if (a.last('game_state').currentPlayerId !== a.session.playerId) await b.send('end_turn');
  await a.send('use_ability', {});
  assert.equal(a.last('error').code, 'rejected');
  await a.send('use_ability', { targetId: b.session.playerId });
  const log = a.last('combat_result').combatLog;
  assert.equal(log.abilityUsed, 'Poing du Titan');
  assert.equal(log.targetPlayerId, b.session.playerId);
  assert.equal(b.last('combat_result').combatLog.unitId, undefined, 'pas d\'id d\'unité pour l\'adversaire');
});

test('protocole : vision des spectateurs off / différée', async () => {
  for (const vision of ['off', 'delayed']) {
    const h = createHarness();
    const a = h.client('a');
    await a.send('create_room', { playerName: 'Alice' });
    const b = h.client('b');
    await b.send('join_room', { roomCode: a.session.roomCode, playerName: 'Bob' });
    const spec = h.client('s');
    await spec.send('join_room', { roomCode: a.session.roomCode, playerName: 'Zoé', spectator: true });
    await a.send('set_map', { mapId: 'test-small' });
    await a.send('set_settings', { settings: { spectatorVision: vision } });
    await a.send('select_general', { generalId: 'ou_ki' });
    await b.send('select_general', { generalId: 'mou_bu' });
    await a.send('start_game');
    for (const c of [a, b]) await c.send('submit_army', { units: [{ typeId: 'soldats', count: 1 }] });
    for (const c of [a, b]) {
      const ds = c.last('deployment_state');
      for (let i = 0; i < ds.units.length; i++) await c.send('place_unit', { unitId: ds.units[i].id, q: ds.startingZone.tiles[i * 3].q, r: ds.startingZone.tiles[i * 3].r });
      await c.send('deployment_ready');
    }
    const deploy = spec.all('game_state').filter(m => m.phase === 'deployment');
    assert.ok(deploy.length && deploy.every(m => m.units.length === 0), `${vision} : placements cachés au déploiement`);
    const gs = spec.last('game_state');
    assert.equal(gs.spectatorVision, vision);
    assert.equal(gs.units.length, 0, `${vision} : rien en direct au premier tour`);
    const cur = gs.currentPlayerId === a.session.playerId ? a : b;
    const other = cur === a ? b : a;
    const unit = cur.last('game_state').myUnits.find(u => !u.isGeneral);
    spec.clear();
    await cur.send('move_unit', { unitId: unit.id, targetQ: unit.q, targetR: unit.r - 1 });
    assert.equal(spec.all('unit_move_anim').length, 0);
    await cur.send('end_turn');
    await other.send('end_turn');
    const later = spec.last('game_state');
    if (vision === 'off') assert.equal(later.units.length, 0);
    else {
      assert.equal(later.units.length, 4, 'différé : positions du tour précédent');
      assert.equal(later.delayedTurn, 1);
    }
  }
});

test('protocole : fin de partie → récapitulatif + replay en morceaux', async () => {
  const h = createHarness();
  const { first, second } = await setupBattle(h);
  await first.send('get_replay');
  assert.equal(first.last('error').code, 'wrong_phase', 'pas de replay pendant la partie');
  await second.send('leave_room');
  const over = first.last('game_over');
  assert.equal(over.winnerId, first.session.playerId);
  assert.equal(over.recap.players.length, 2);
  first.clear();
  await first.send('get_replay');
  const chunks = first.all('replay_chunk');
  assert.ok(chunks.length >= 1);
  const rep = JSON.parse(chunks.sort((x, y) => x.index - y.index).map(c => c.data).join(''));
  assert.equal(rep.format, 'kb-replay-1');
  assert.equal(rep.mapId, 'test-small');
  assert.equal(rep.players.length, 2);
  assert.equal(rep.events[rep.events.length - 1].k, 'end');
});
