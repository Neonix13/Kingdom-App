const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, setupBattle } = require('./helpers');

test('spectateur : rejoint en cours de partie, vision complète, lecture seule, chat', async () => {
  const h = createHarness();
  const { first, second } = await setupBattle(h);
  const spec = h.client('spec');
  await spec.send('join_room', { roomCode: first.session.roomCode, playerName: 'Zoé', spectator: true });
  assert.equal(spec.session.role, 'spectator');
  const gs = spec.last('game_state');
  assert.equal(gs.isSpectator, true);
  assert.equal(gs.units.length, 4, 'voit toutes les unités');
  assert.ok(gs.visibleHexes.length >= 80, 'aucun brouillard');
  assert.equal(first.last('presence').spectators[0].name, 'Zoé');

  const unit = gs.units[0];
  for (const [action, data] of [['end_turn', {}], ['move_unit', { unitId: unit.id, targetQ: 0, targetR: 0 }], ['ping', { q: 1, r: 1 }], ['set_budget', { budget: 3000 }]]) {
    spec.clear();
    await spec.send(action, data);
    assert.ok(['spectator_read_only', 'not_host', 'wrong_phase'].includes(spec.last('error').code), action);
  }

  await spec.send('chat_message', { text: 'Bonne chance' });
  const chat = second.last('chat_message');
  assert.equal(chat.authorName, 'Zoé');
  assert.equal(chat.isSpectator, true);

  await first.send('end_turn');
  assert.ok(spec.last('turn_change'));
  assert.equal(spec.last('game_state').isSpectator, true);

  await spec.close();
  const again = h.client('spec2');
  await again.send('rejoin_game', { roomCode: spec.session.roomCode, playerId: spec.session.playerId, token: spec.session.token });
  assert.equal(again.last('game_state').isSpectator, true);
  assert.equal(again.last('chat_history').messages.length, 1);
});

test('spectateur en lobby puis passage au déploiement', async () => {
  const h = createHarness();
  const a = h.client('a');
  await a.send('create_room', { playerName: 'Alice' });
  const spec = h.client('spec');
  await spec.send('join_room', { roomCode: a.session.roomCode, playerName: 'Zoé', spectator: true });
  const lu = a.last('room_update');
  assert.equal(lu.players.length, 1);
  assert.equal(lu.spectators.length, 1);
  await a.send('set_map', { mapId: 'test-small' });
  await a.send('select_general', { generalId: 'ou_ki' });
  await a.send('start_game');
  await a.send('submit_army', { units: [{ typeId: 'soldats', count: 1 }] });
  assert.equal(spec.last('phase_change').phase, 'deployment');
  assert.equal(spec.last('game_state').phase, 'deployment');
  const ds = a.last('deployment_state');
  await a.send('place_unit', { unitId: ds.units[0].id, q: ds.startingZone.tiles[0].q, r: ds.startingZone.tiles[0].r });
  assert.equal(spec.last('game_state').units.length, 1, 'le spectateur voit le placement');
});
