const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const GameRoom = require('../game/GameRoom');
const { createHarness } = require('./helpers');
const { createMemoryStore } = require('../server/memoryStore');
const { hexKey } = require('../game/HexUtils');

createHarness(); // registers the 'test-small' map

function teamRoom() {
  const room = new GameRoom('TEAM', 'p0', { mapId: 'test-small' });
  [['p0', 'ou_ki', 'qin'], ['p1', 'mou_bu', 'qin'], ['p2', 'ri_boku', 'zhao']].forEach(([id, g, f]) => { room.addPlayer(id, id); Object.assign(room.getPlayer(id), { generalId: g, flag: f }); });
  assert.ok(room.setSettings({ teamMode: true }).ok);
  room.startGame();
  for (const p of room.players) assert.ok(room.submitArmy(p.id, [{ typeId: 'soldats', count: 1 }]).ok);
  room.startDeployment();
  for (const p of room.players) assert.ok(room.setDeploymentReady(p.id).ok);
  room.startBattle();
  return room;
}

function put(room, u, q, r) {
  delete room.unitMap[hexKey(u.q, u.r)];
  u.q = q; u.r = r;
  room.unitMap[hexKey(q, r)] = u;
}

test('mode par équipe : pas d\'attaque entre alliés du même drapeau, les alliés se voient, victoire commune', () => {
  const room = teamRoom();
  const a = room.getPlayer('p0').units.find(u => !u.isGeneral);
  const ally = room.getPlayer('p1').units.find(u => !u.isGeneral);
  const foe = room.getPlayer('p2').units.find(u => !u.isGeneral);
  put(room, a, 0, 0); put(room, ally, 1, 0); put(room, foe, 0, 1);
  room.turnOrder = ['p0', 'p1', 'p2']; room.currentTurnIndex = 0;
  a.speedRemaining = 3; a.hasAttacked = false;
  assert.equal(room.areAllies('p0', 'p1'), true);
  assert.equal(room.areAllies('p0', 'p2'), false);
  assert.match(room.initiateCombat('p0', a.id, ally.id).error, /allié/);
  assert.ok(room.initiateCombat('p0', a.id, foe.id).pending);
  const gs = room.getGameState('p0');
  assert.equal(gs.units.find(u => u.id === ally.id).isAlly, true);
  assert.equal(gs.teamMode, true);
  room.getPlayer('p2').isEliminated = true;
  room._checkVictory();
  assert.equal(room.phase, 'ended');
  assert.equal(room.winningFlag, 'qin');
});

test('sans mode par équipe, le même drapeau ne rend pas allié', () => {
  const room = new GameRoom('SOLO', 'p0', { mapId: 'test-small' });
  room.addPlayer('p0', 'A'); room.addPlayer('p1', 'B');
  room.getPlayer('p0').flag = 'qin'; room.getPlayer('p1').flag = 'qin';
  assert.equal(room.areAllies('p0', 'p1'), false);
});

test('salle : drapeaux, prêt dans le salon (démarrage automatique), retour au salon, budget arrondi', async () => {
  const h = createHarness();
  const a = h.client('a');
  const b = h.client('b');
  await a.send('create_room', { playerName: 'Alice' });
  await b.send('join_room', { roomCode: a.session.roomCode, playerName: 'Bob' });
  await a.send('set_player_flag', { flagId: 'qin' });
  await b.send('set_player_flag', { flagId: 'qin' });
  assert.equal(b.last('error').code, 'flag_taken');
  await a.send('set_option', { key: 'teamMode', value: true });
  await b.send('set_player_flag', { flagId: 'qin' });
  let lobby = a.last('room_update');
  assert.equal(lobby.settings.teamMode, true);
  const colors = lobby.players.map(p => p.color);
  assert.notEqual(colors[0], colors[1], 'variantes de couleur pour les coéquipiers');
  await a.send('lobby_ready');
  assert.equal(a.last('error').code, 'general_missing');
  await a.send('select_general', { generalId: 'ou_ki' });
  await b.send('select_general', { generalId: 'ri_boku' });
  await a.send('lobby_ready');
  assert.notEqual(a.last('phase_change')?.phase, 'army_building');
  await b.send('lobby_ready');
  assert.equal(a.last('phase_change').phase, 'army_building', 'tous prêts : la partie démarre');
  await a.send('set_budget', { budget: 3049 });
  assert.equal(a.last('room_update').budget, 3000);
  await a.send('back_to_lobby');
  assert.equal(b.last('phase_change').phase, 'lobby');
});

test('persistance : les salles en cours sont sauvegardées puis restaurées au démarrage', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-rooms-')), 'rooms.json');
  const room = teamRoom();
  const s1 = createMemoryStore({ persistFile: file, persistMs: 60000, log: { log() {}, error() {} } });
  s1.create(room);
  s1.saveNow();
  s1.stop();
  const s2 = createMemoryStore({ persistFile: file, persistMs: 60000, log: { log() {}, error() {} } });
  s2.stop();
  return s2.get('TEAM').then((r) => {
    assert.ok(r, 'salle restaurée');
    assert.equal(r.phase, 'battle');
    assert.equal(r.players.length, 3);
    assert.ok(r.players.every(p => p.connected === false && p.connId === null));
    assert.deepEqual(r.players.map(p => p.units.length), room.players.map(p => p.units.length));
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
});
