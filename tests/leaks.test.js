const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, setupBattle } = require('./helpers');
const { hexKey } = require('../game/HexUtils');

// Walk every message a player received and check it carries nothing it should not see:
// other members' tokens / connection ids, and enemy unit ids or positions outside its visible hexes at that time.
function auditInbox(h, client, room, secrets) {
  const me = client.session.playerId;
  const msgs = h.inbox.get(client.connId);
  let visible = null;
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    const text = JSON.stringify(msg);
    for (const s of secrets) if (s.owner !== me && s.value) assert.ok(!text.includes(s.value), `${msg.event} contient un secret de ${s.owner}`);
    if (msg.event === 'game_state' && !msg.isSpectator) {
      visible = new Set(msg.visibleHexes);
      for (const u of msg.units) {
        if (u.playerId !== me) assert.ok(visible.has(hexKey(u.q, u.r)), `unité ennemie ${u.id} hors vision envoyée`);
      }
    }
    if (msg.event === 'deployment_state') {
      for (const k of Object.keys(msg.occupiedHexes)) assert.equal(msg.occupiedHexes[k].playerId, me, 'position adverse au déploiement');
      for (const u of msg.units) assert.equal(u.playerId, me);
    }
    if (msg.event === 'unit_move_anim' && room.enemyUnitIds.has(msg.unitId)) {
      const next = msgs.slice(i + 1).find(m => m.event === 'game_state');
      const after = new Set(next.visibleHexes);
      for (const [q, r] of [[msg.fromQ, msg.fromR], ...msg.path]) assert.ok(after.has(hexKey(q, r)), `chemin ennemi caché envoyé ${JSON.stringify(msg)}`);
    }
  }
}

test('brouillard de guerre : aucune fuite (positions, ids, jetons) sur une partie complète', async () => {
  const h = createHarness();
  const a = h.client('a');
  const b = h.client('b');
  const c = h.client('c');
  await a.send('create_room', { playerName: 'Alice' });
  await b.send('join_room', { roomCode: a.session.roomCode, playerName: 'Bob' });
  await c.send('join_room', { roomCode: a.session.roomCode, playerName: 'Chloé' });
  await a.send('set_map', { mapId: 'test-small' });
  await a.send('select_general', { generalId: 'ou_ki' });
  await b.send('select_general', { generalId: 'mou_bu' });
  await c.send('select_general', { generalId: 'ri_boku' });
  await a.send('start_game');
  for (const p of [a, b, c]) await p.send('submit_army', { units: [{ typeId: 'cavalier_leger', count: 2 }] });
  for (const p of [a, b, c]) {
    const ds = p.last('deployment_state');
    const tiles = ds.startingZone.tiles;
    let i = 0;
    for (const u of ds.units) { await p.send('place_unit', { unitId: u.id, q: tiles[i].q, r: tiles[i].r }); i += 3; }
    await p.send('deployment_ready');
  }
  for (const pl of (await h.store.get(a.session.roomCode)).players) for (const u of pl.units) u.visionRange = 3;
  for (const p of [a, b, c]) await p.send('get_state');
  const players = { [a.session.playerId]: a, [b.session.playerId]: b, [c.session.playerId]: c };
  const stored = await h.store.get(a.session.roomCode);
  const secrets = [];
  for (const p of stored.players) secrets.push({ owner: p.id, value: p.token }, { owner: p.id, value: p.connId });

  for (let step = 0; step < 12; step++) {
    const room = await h.store.get(a.session.roomCode);
    if (room.phase !== 'battle') break;
    const cur = players[room.getCurrentPlayerId()];
    const gs = cur.last('game_state');
    for (const u of gs.myUnits.filter(x => x.q !== null && !x.isFleeing)) {
      const fresh = cur.last('game_state').myUnits.find(x => x.id === u.id);
      if (!fresh || fresh.speedRemaining <= 0) continue;
      const dirs = [[1, 0], [1, -1], [0, 1], [-1, 1], [0, -1], [-1, 0]];
      for (const [dq, dr] of dirs) {
        const before = cur.messages.length;
        await cur.send('move_unit', { unitId: u.id, targetQ: fresh.q + dq * 2, targetR: fresh.r + dr * 2 });
        if (!cur.messages.slice(before).some(m => m.event === 'error')) break;
      }
    }
    await cur.send('end_turn');
  }

  const room = await h.store.get(a.session.roomCode);
  const ids = (pid) => new Set(room.players.filter(p => p.id !== pid).flatMap(p => p.units.map(u => u.id)));
  const ownAnims = (p) => p.all('unit_move_anim').filter(m => room.getPlayer(p.session.playerId).units.some(u => u.id === m.unitId)).length;
  const totalMoves = [a, b, c].reduce((n, p) => n + ownAnims(p), 0);
  const otherMoves = (own) => totalMoves - [a, b, c].reduce((n, p) => n + p.all('unit_move_anim').filter(m => own.has(m.unitId) && room.getPlayer(p.session.playerId).units.some(u => u.id === m.unitId)).length, 0);
  let hiddenMoves = 0;
  for (const p of [a, b, c]) {
    const me = p.session.playerId;
    const ctx = { enemyUnitIds: ids(me) };
    auditInbox(h, p, ctx, secrets);
    const own = new Set(room.getPlayer(me).units.map(u => u.id));
    hiddenMoves += otherMoves(own) - p.all('unit_move_anim').filter(m => !own.has(m.unitId)).length;
    const ownSession = p.all('session');
    assert.ok(ownSession.every(s => s.playerId === me));
  }
  assert.ok(totalMoves > 5, 'des mouvements ont eu lieu');
  assert.ok(hiddenMoves > 0, 'certains mouvements ennemis sont restés cachés');
});

test('attaque d\'une unité cachée ou non déployée : refus sans révéler de position', async () => {
  const h = createHarness();
  const { first, second } = await setupBattle(h, { units: [{ typeId: 'archer', count: 2 }] });
  const room = await h.store.get(first.session.roomCode);
  const enemy = room.getPlayer(second.session.playerId);
  for (const pl of room.players) for (const u of pl.units) u.visionRange = 3;
  const [hidden, unplaced] = enemy.units.filter(u => !u.isGeneral);
  hidden.q = 9; hidden.r = 7;
  unplaced.q = null; unplaced.r = null;
  room._rebuildUnitMap();
  assert.ok(!room.getVisibleHexes(first.session.playerId).has('9,7'));
  const mine = first.last('game_state').myUnits.find(u => u.range > 1);
  for (const target of [hidden, unplaced]) {
    first.clear();
    await first.send('attack_unit', { attackerId: mine.id, targetId: target.id });
    assert.equal(first.last('error').message, 'Cible introuvable.');
  }
});
