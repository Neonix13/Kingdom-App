const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, setupBattle } = require('./helpers');

for (const roundTrip of [false, true]) {
  const label = roundTrip ? ' (sérialisation à chaque action)' : '';

  test(`flux complet lobby → armée → déploiement → bataille → combat → fin de tour${label}`, async () => {
    const h = createHarness({ roundTrip });
    const a = h.client('a');
    const b = h.client('b');
    await a.send('create_room', { playerName: 'Alice' });
    assert.ok(a.session && a.session.token, 'session reçue');
    assert.match(a.session.roomCode, /^[A-Z2-9]{6}$/);
    await b.send('join_room', { roomCode: a.session.roomCode, playerName: 'Bob' });
    const lobby = b.last('room_update');
    assert.equal(lobby.players.length, 2);
    assert.notEqual(lobby.players[0].color, lobby.players[1].color, 'couleurs distinctes par défaut');

    await a.send('list_maps');
    assert.ok(a.last('maps_list').maps.some(m => m.id === 'default'));
    await a.send('set_map', { mapId: 'test-small' });
    assert.equal(b.last('room_update').mapId, 'test-small');
    await b.send('set_map', { mapId: 'default' });
    assert.equal(b.last('error').code, 'not_host');

    await a.send('select_general', { generalId: 'ou_ki' });
    await b.send('select_general', { generalId: 'ou_ki' });
    assert.equal(b.last('error').code, 'general_taken');
    await b.send('select_general', { generalId: 'mou_bu' });
    await a.send('start_game');
    assert.equal(b.last('phase_change').phase, 'army_building');

    await a.send('submit_army', { units: [{ typeId: 'soldats', count: 1 }] });
    assert.ok(a.last('army_accepted'));
    assert.equal(a.all('deployment_state').length, 0);
    await b.send('submit_army', { units: [{ typeId: 'soldats', count: 1 }] });
    const dsA = a.last('deployment_state');
    assert.equal(dsA.mapId, 'test-small');
    assert.equal(dsA.units.length, 2);
    assert.ok(dsA.startingZone.tiles.every(t => t.q <= 1), 'zone fixe de la carte utilisée');

    const { first, second } = await (async () => {
      const general = dsA.units.find(u => u.isGeneral);
      assert.ok(dsA.units.every(u => u.q !== null), 'unités placées d\'office');
      await a.send('place_unit', { unitId: general.id, q: 0, r: 3 });
      await a.send('place_unit', { unitId: dsA.units.find(u => !u.isGeneral).id, q: 1, r: 3 });
      await a.send('place_unit', { unitId: general.id, q: 5, r: 3 });
      assert.equal(a.last('error').message, 'Hors de la zone de déploiement.');
      const dsB = b.last('deployment_state');
      await b.send('place_unit', { unitId: dsB.units.find(u => u.isGeneral).id, q: 3, r: 3 });
      await b.send('place_unit', { unitId: dsB.units.find(u => !u.isGeneral).id, q: 2, r: 3 });
      await a.send('deployment_ready');
      assert.equal(b.last('deployment_ready_update').readyCount, 1);
      await b.send('deployment_ready');
      const gs = a.last('game_state');
      assert.equal(gs.phase, 'battle');
      assert.equal(gs.heightData, undefined, 'plus de heightData dans game_state');
      const f = gs.currentPlayerId === a.session.playerId ? a : b;
      return { first: f, second: f === a ? b : a };
    })();

    assert.ok(first.last('initiative_rolled'));
    await second.send('end_turn');
    assert.equal(second.last('error').code, 'not_your_turn');

    const gs = first.last('game_state');
    const mine = gs.myUnits.find(u => !u.isGeneral);
    const enemy = gs.units.find(u => !u.isMine && !u.isGeneral);
    assert.ok(enemy, 'ennemi adjacent visible');

    await first.send('attack_unit', { attackerId: mine.id, targetId: enemy.id });
    const req = second.last('defense_request');
    assert.ok(req && req.attackId);
    assert.ok(first.last('waiting_defense'));

    await first.send('end_turn');
    assert.equal(first.last('error').code, 'defense_pending');
    await first.send('defend_choice', { attackId: req.attackId, choice: 'rien' });
    assert.equal(first.last('error').code, 'not_defender');
    await second.send('defend_choice', { attackId: req.attackId, choice: 'counter' });
    assert.ok(first.last('combat_result'));
    assert.ok(second.last('combat_result'));
    await second.send('defend_choice', { attackId: req.attackId, choice: 'counter' });
    assert.equal(second.last('error').code, 'attack_not_found');

    await first.send('end_turn');
    const tc = second.last('turn_change');
    assert.equal(tc.currentPlayerId, second.session.playerId);
    await first.send('end_turn');
    assert.equal(first.last('error').code, 'not_your_turn');
    await second.send('end_turn');
    assert.ok(second.last('initiative_rolled'));
    assert.equal(second.last('turn_change').turn, 2);
  });
}

test('le délai de défense résout l\'attaque avec "rien"', async () => {
  const h = createHarness();
  const { first, second } = await setupBattle(h);
  const gs = first.last('game_state');
  await first.send('attack_unit', { attackerId: gs.myUnits.find(u => !u.isGeneral).id, targetId: gs.units.find(u => !u.isMine && !u.isGeneral).id });
  h.clock.advance(19000);
  await h.protocol.tick(first.session.roomCode);
  assert.equal(first.all('combat_result').length, 0);
  h.clock.advance(1500);
  await h.protocol.tick(first.session.roomCode);
  assert.equal(first.last('combat_result').combatLog.defenseChoice, 'rien');
  await first.send('end_turn');
  assert.ok(second.last('turn_change'));
});

test('entrées invalides : jamais de crash, toujours une erreur explicite', async () => {
  const h = createHarness();
  const { first, second } = await setupBattle(h);
  const bad = [
    ['nope', {}], [null, {}], ['move_unit', { unitId: { $gt: 1 }, targetQ: 'x' }], ['move_unit', { unitId: 'u_1', targetQ: 1.5, targetR: 2 }],
    ['attack_unit', { attackerId: 'u_999', targetId: 'u_1' }], ['submit_army', { units: null }], ['rotate_facing', { unitId: 'u_1', facing: 9 }],
    ['change_stance', { unitId: 'u_1', stanceId: '__proto__' }], ['chat_message', { text: { a: 1 } }], ['ping', { q: 1e9, r: 0 }],
    ['set_budget', { budget: 'abc' }], ['start_game', {}], ['place_unit', { unitId: 'u_1', q: 0, r: 0 }], ['join_room', { roomCode: '<script>', playerName: 'x' }],
    ['create_room', { playerName: '   ' }], ['defend_choice', { attackId: 'zzz' }], ['rejoin_game', { roomCode: first.session.roomCode, playerId: second.session.playerId, token: 'wrong' }],
  ];
  for (const [action, data] of bad) {
    first.clear();
    await first.send(action, data);
    const errs = first.errors();
    if (action !== 'chat_message' && action !== 'ping') assert.equal(errs.length, 1, `erreur attendue pour ${action}`);
    assert.ok(errs.every(e => e.code && e.code !== 'server_error'), `${action}: ${JSON.stringify(errs)}`);
  }
  await first.send('end_turn');
  assert.ok(second.last('turn_change'), 'la partie continue');
});

test('le joueur actif ne peut pas jouer pendant le tour adverse ni avec les unités adverses', async () => {
  const h = createHarness();
  const { first, second } = await setupBattle(h);
  const gs2 = second.last('game_state');
  const u2 = gs2.myUnits.find(u => !u.isGeneral);
  await second.send('move_unit', { unitId: u2.id, targetQ: u2.q, targetR: u2.r + 1 });
  assert.equal(second.last('error').code, 'not_your_turn');
  await first.send('move_unit', { unitId: u2.id, targetQ: u2.q, targetR: u2.r + 1 });
  assert.equal(first.last('error').message, 'Unité introuvable.');
});

test('hôte : changement de budget, mode, couleur unique', async () => {
  const h = createHarness();
  const a = h.client('a');
  const b = h.client('b');
  await a.send('create_room', { playerName: 'Alice' });
  await b.send('join_room', { roomCode: a.session.roomCode, playerName: 'Bob' });
  await a.send('set_budget', { budget: 5000 });
  assert.equal(b.last('room_update').budget, 5000);
  await a.send('set_mode', { mode: 'turbo' });
  assert.equal(a.last('error').code, 'invalid_mode');
  await b.send('set_mode', { mode: 'simultaneous' });
  assert.equal(b.last('error').code, 'not_host');
  await a.send('set_mode', { mode: 'simultaneous' });
  assert.equal(b.last('room_update').mode, 'simultaneous');
  await b.send('set_player_color', { color: '#4A90D9' });
  assert.equal(b.last('error').code, 'color_taken');
  await b.send('set_player_color', { color: '#2070e0' });
  const players = a.last('room_update').players;
  assert.equal(players.find(p => p.name === 'Bob').color, '#2070e0');
});

// An archer steps back from the front line, then shoots an enemy of the given type at distance 2–3
async function shootAt(targetType) {
  const h = createHarness();
  const { first, second } = await setupBattle(h, { units: [{ typeId: 'archer', count: 1 }, { typeId: 'phalange', count: 1 }] });
  const gs = first.last('game_state');
  const archer = gs.myUnits.find(u => u.typeId === 'archer');
  const dist = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
  const taken = new Set([...gs.myUnits, ...gs.units].map(u => `${u.q},${u.r}`));
  const enemies = gs.units.filter(u => !u.isMine && !u.isGeneral);
  const target = enemies.find(e => e.typeId === targetType);
  const back = [[-1, 0], [-1, 1], [0, -1], [1, -1], [0, 1], [1, 0]].map(([dq, dr]) => ({ q: archer.q + dq, r: archer.r + dr }))
    .find(t => !taken.has(`${t.q},${t.r}`) && enemies.every(e => dist(e, t) >= 2) && dist(target, t) <= 3);
  assert.ok(back, 'case de tir libre');
  await first.send('move_unit', { unitId: archer.id, targetQ: back.q, targetR: back.r });
  const moved = first.last('game_state').myUnits.find(u => u.id === archer.id);
  assert.deepEqual([moved.q, moved.r], [back.q, back.r]);
  const before = second.all('defense_request').length;
  await first.send('attack_unit', { attackerId: archer.id, targetId: target.id });
  return { first, second, asked: second.all('defense_request').length > before };
}

test('tir sur une unité qui ne peut pas le bloquer : résolu sans demander de défense', async () => {
  const { first, second, asked } = await shootAt('archer');
  assert.equal(asked, false);
  assert.equal(first.last('combat_result').combatLog.defenseChoice, 'rien');
  assert.ok(second.last('combat_result'));
});

test('tir d\'archer sur une phalange : pas de choix (la phalange ne peut pas encaisser les archers)', async () => {
  const { first, asked } = await shootAt('phalange');
  assert.equal(asked, false);
  assert.equal(first.last('combat_result').combatLog.defenseChoice, 'rien');
});
