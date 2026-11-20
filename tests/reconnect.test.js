const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, setupBattle } = require('./helpers');

async function rejoin(h, old, name = 'r') {
  const c = h.client(name);
  await c.send('rejoin_game', { roomCode: old.session.roomCode, playerId: old.session.playerId, token: old.session.token });
  return c;
}

for (const roundTrip of [false, true]) {
  const label = roundTrip ? ' (sérialisation)' : '';

  test(`rafraîchissement en pleine bataille : resynchronisation complète${label}`, async () => {
    const h = createHarness({ roundTrip });
    const { first, second } = await setupBattle(h);
    const before = second.last('game_state');
    await second.close();
    assert.equal(first.last('player_disconnected').playerId, second.session.playerId);
    const again = await rejoin(h, second);
    assert.equal(again.last('session').playerId, second.session.playerId);
    const gs = again.last('game_state');
    assert.equal(gs.phase, 'battle');
    assert.equal(gs.myId, before.myId);
    assert.deepEqual(gs.myUnits.map(u => u.id), before.myUnits.map(u => u.id));
    assert.equal(first.last('player_reconnected').playerId, second.session.playerId);
    await first.send('end_turn');
    assert.equal(again.last('turn_change').currentPlayerId, second.session.playerId, 'le joueur reconnecté reçoit les événements');
  });

  test(`reconnexion pendant une demande de défense : la demande est renvoyée${label}`, async () => {
    const h = createHarness({ roundTrip });
    const { first, second } = await setupBattle(h);
    const gs = first.last('game_state');
    await first.send('attack_unit', { attackerId: gs.myUnits.find(u => !u.isGeneral).id, targetId: gs.units.find(u => !u.isMine && !u.isGeneral).id });
    await second.close();
    h.clock.advance(5000);
    const again = await rejoin(h, second);
    const req = again.last('defense_request');
    assert.ok(req, 'defense_request renvoyé');
    assert.ok(req.seconds <= 15 && req.seconds > 0);
    await again.send('defend_choice', { attackId: req.attackId, choice: 'absorb' });
    assert.ok(first.last('combat_result'));
  });

  test(`reconnexion en déploiement et en construction d'armée${label}`, async () => {
    const h = createHarness({ roundTrip });
    const a = h.client('a');
    const b = h.client('b');
    await a.send('create_room', { playerName: 'Alice' });
    await b.send('join_room', { roomCode: a.session.roomCode, playerName: 'Bob' });
    await a.send('set_map', { mapId: 'test-small' });
    await a.send('select_general', { generalId: 'ou_ki' });
    await b.send('select_general', { generalId: 'mou_bu' });
    await a.send('start_game');
    await a.send('submit_army', { units: [{ typeId: 'archer', count: 1 }] });
    await a.close();
    const a2 = await rejoin(h, a, 'a2');
    const pc = a2.last('phase_change');
    assert.equal(pc.phase, 'army_building');
    assert.equal(pc.armySubmitted, true);
    await b.send('submit_army', { units: [{ typeId: 'soldats', count: 1 }] });
    assert.ok(a2.last('deployment_state'));
    await b.close();
    const b2 = await rejoin(h, b, 'b2');
    const ds = b2.last('deployment_state');
    assert.equal(ds.units.length, 2);
    assert.ok(ds.startingZone.tiles.length > 0);
  });
}

test('jeton invalide ou volé : refus', async () => {
  const h = createHarness();
  const { first, second } = await setupBattle(h);
  const thief = h.client('thief');
  await thief.send('rejoin_game', { roomCode: first.session.roomCode, playerId: second.session.playerId });
  assert.equal(thief.last('error').code, 'rejoin_failed');
  await thief.send('rejoin_game', { roomCode: first.session.roomCode, playerId: second.session.playerId, token: first.session.token });
  assert.equal(thief.last('error').code, 'rejoin_failed');
  await thief.send('end_turn', { roomCode: first.session.roomCode });
  assert.equal(thief.last('error').code, 'not_in_room');
});

test('ouverture dans un second onglet : l\'ancien reçoit session_replaced', async () => {
  const h = createHarness();
  const { first } = await setupBattle(h);
  const other = await rejoin(h, first, 'tab2');
  assert.ok(first.last('session_replaced'));
  assert.ok(other.last('game_state'));
  first.clear();
  await other.send('chat_message', { text: 'hello' });
  assert.equal(first.all('chat_message').length, 0, 'l\'ancienne connexion ne reçoit plus rien');
});

test('joueur actif déconnecté : son tour passe automatiquement après le délai de grâce', async () => {
  const h = createHarness();
  const { first, second } = await setupBattle(h);
  await first.close();
  h.clock.advance(59000);
  await h.protocol.tick(second.session.roomCode);
  assert.equal(second.all('turn_auto_ended').length, 0);
  h.clock.advance(2000);
  await h.protocol.tick(second.session.roomCode);
  assert.equal(second.last('turn_auto_ended').playerId, first.session.playerId);
  assert.equal(second.last('turn_change').currentPlayerId, second.session.playerId);
  for (let i = 0; i < 6 && second.last('game_state').currentPlayerId === second.session.playerId; i++) await second.send('end_turn');
  const gs = second.last('game_state');
  assert.equal(gs.currentPlayerId, first.session.playerId);
  assert.ok(gs.turnDeadline, 'échéance visible pour le tour d\'un absent');
  h.clock.advance(31000);
  await h.protocol.tick(second.session.roomCode);
  assert.equal(second.last('game_state').currentPlayerId, second.session.playerId, 'tour d\'un absent passé après 30 s');
});

test('absence prolongée en bataille : abandon et victoire de l\'adversaire', async () => {
  const h = createHarness();
  const { first, second } = await setupBattle(h);
  await second.close();
  h.clock.advance(600001);
  await h.protocol.tick(first.session.roomCode);
  const over = first.last('game_over');
  assert.equal(over.winnerId, first.session.playerId);
});

test('lobby : un joueur parti est retiré après 30 s et l\'hôte est transféré', async () => {
  const h = createHarness();
  const a = h.client('a');
  const b = h.client('b');
  await a.send('create_room', { playerName: 'Alice' });
  await b.send('join_room', { roomCode: a.session.roomCode, playerName: 'Bob' });
  await a.close();
  assert.equal(b.last('room_update').players.find(p => p.name === 'Alice').connected, false);
  h.clock.advance(31000);
  await h.protocol.tick(b.session.roomCode);
  const lu = b.last('room_update');
  assert.equal(lu.players.length, 1);
  assert.equal(lu.hostId, b.session.playerId);
  await b.send('set_budget', { budget: 4000 });
  assert.equal(b.last('room_update').budget, 4000);
});

test('construction d\'armée : un joueur absent 2 min est retiré, la partie avance', async () => {
  const h = createHarness();
  const a = h.client('a');
  const b = h.client('b');
  await a.send('create_room', { playerName: 'Alice' });
  await b.send('join_room', { roomCode: a.session.roomCode, playerName: 'Bob' });
  await a.send('set_map', { mapId: 'test-small' });
  await a.send('select_general', { generalId: 'ou_ki' });
  await b.send('select_general', { generalId: 'mou_bu' });
  await a.send('start_game');
  await a.send('submit_army', { units: [{ typeId: 'soldats', count: 1 }] });
  await b.close();
  h.clock.advance(121000);
  await h.protocol.tick(a.session.roomCode);
  assert.equal(a.last('player_left').reason, 'timeout');
  assert.ok(a.last('deployment_state'), 'passage au déploiement');
});

test('salle vide supprimée', async () => {
  const h = createHarness();
  const a = h.client('a');
  await a.send('create_room', { playerName: 'Alice' });
  const code = a.session.roomCode;
  await a.close();
  h.clock.advance(31000);
  await h.protocol.tick(code);
  assert.equal(await h.store.get(code), null);
});
