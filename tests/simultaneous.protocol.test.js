const test = require('node:test');
const assert = require('node:assert/strict');
const maps = require('../game/maps');
const { createHarness } = require('./helpers');

// 30 x 9 plain map: the armies start out of sight of each other (generals see 12-16 hexes)
function registerWideMap() {
  const height = {};
  for (let q = 0; q < 30; q++) for (let r = 0; r < 9; r++) height[`${q},${r}`] = 0;
  const zone = (q0) => ({ tiles: Object.keys(height).filter(k => { const q = +k.split(',')[0]; return q >= q0 && q <= q0 + 1; }) });
  maps.registerMap({ id: 'test-sim-wide', name: 'Test large', height, terrain: {}, segments: {}, zones: [zone(0), zone(28)], objectives: [] });
}

async function simBattle(h, settings = {}) {
  registerWideMap();
  const a = h.client('a');
  const b = h.client('b');
  await a.send('create_room', { playerName: 'Alice' });
  await b.send('join_room', { roomCode: a.session.roomCode, playerName: 'Bob' });
  await a.send('set_map', { mapId: 'test-sim-wide' });
  await a.send('set_mode', { mode: 'simultaneous' });
  await a.send('set_settings', { settings: { planningTimer: 30, ...settings } });
  await a.send('select_general', { generalId: 'ou_ki' });
  await b.send('select_general', { generalId: 'mou_bu' });
  await a.send('start_game');
  for (const c of [a, b]) await c.send('submit_army', { units: [{ typeId: 'soldats', count: 2 }] });
  for (const c of [a, b]) {
    const ds = c.last('deployment_state');
    const tiles = ds.startingZone.tiles.slice().sort((x, y) => x.r - y.r || x.q - y.q);
    for (let i = 0; i < ds.units.length; i++) await c.send('place_unit', { unitId: ds.units[i].id, q: tiles[i * 2 + 2].q, r: tiles[i * 2 + 2].r });
  }
  await a.send('deployment_ready');
  await b.send('deployment_ready');
  return { a, b };
}

const troops = (gs) => gs.myUnits.filter(u => !u.isGeneral);
const step = (u, n, dq = 1) => Array.from({ length: n }, (_, i) => [u.q + dq * (i + 1), u.r]);

for (const roundTrip of [false, true]) {
  const label = roundTrip ? ' (sérialisation à chaque action)' : '';

  test(`mode simultané : planification secrète, validation, résolution filtrée, reconnexion, minuteur${label}`, async () => {
    const h = createHarness({ roundTrip });
    const { a, b } = await simBattle(h);
    const s = h.client('s');
    await s.send('join_room', { roomCode: a.session.roomCode, playerName: 'Spect', spectator: true });

    const gsA = a.last('game_state');
    const gsB = b.last('game_state');
    assert.equal(gsA.mode, 'simultaneous');
    assert.equal(gsA.currentPlayerId, null);
    assert.equal(a.all('initiative_rolled').length, 0);
    const ps = a.last('planning_start');
    assert.equal(ps.turn, 1);
    assert.equal(ps.endsAt, ps.startsAt + 30000);
    assert.equal(ps.commandPoints.max, 8);
    assert.deepEqual(gsA.planning.myOrders, {});
    assert.equal(gsA.planning.commandPoints.max, 8);
    const aIds = gsA.myUnits.map(u => u.id);
    assert.ok(!gsB.units.some(u => aIds.includes(u.id)), 'armées hors de vue au départ');

    // sequential actions are refused
    const [a1, a2] = troops(gsA);
    await a.send('move_unit', { unitId: a1.id, targetQ: a1.q + 1, targetR: a1.r });
    assert.equal(a.last('error').code, 'not_your_turn');

    // orders: only the sender hears about them
    b.clear();
    await a.send('set_orders', { orders: { [a1.id]: { type: 'move', path: step(a1, 3) }, [a2.id]: { type: 'hold', stance: 'combat' } } });
    const ou = a.last('orders_update');
    assert.equal(ou.commandPoints.used, 2);
    assert.equal(ou.orders[a1.id].path.length, 3);
    await a.send('set_orders', { orders: { [a1.id]: { type: 'move', path: step(a1, 9) } } });
    assert.equal(a.last('error').code, 'rejected');
    await a.send('commit_orders');
    assert.deepEqual(b.last('commit_status').committed, [a.session.playerId]);
    await a.send('set_orders', { orders: { [a2.id]: null } });
    assert.equal(a.last('error').code, 'rejected', 'ordres verrouillés une fois validés');
    assert.equal(b.all('orders_update').length, 0);
    assert.equal(s.all('orders_update').length, 0);

    // B plans, refreshes the page: its orders come back
    const [b1] = troops(gsB);
    await b.send('set_orders', { orders: { [b1.id]: { type: 'move', path: step(b1, 2, -1) } } });
    const bSession = b.session;
    await b.close();
    const b2 = h.client('b2');
    await b2.send('rejoin_game', { roomCode: bSession.roomCode, playerId: bSession.playerId, token: bSession.token });
    const resynced = b2.last('game_state');
    assert.deepEqual(Object.keys(resynced.planning.myOrders), [b1.id]);
    assert.equal(resynced.planning.myCommitted, false);
    assert.deepEqual(resynced.planning.committed, [a.session.playerId]);
    assert.equal(b2.all('resolution').length, 0);

    // everyone committed: resolution, filtered per player, then the next planning
    await b2.send('commit_orders');
    const rA = a.last('resolution'), rB = b2.last('resolution'), rS = s.last('resolution');
    assert.ok(rA && rB && rS);
    assert.equal(rA.turn, 1);
    assert.equal(rA.seed, rB.seed);
    assert.ok(Number.isInteger(rA.seed));
    const movesA = rA.ticks.flatMap(t => t.events).filter(e => e.k === 'move' && e.u === a1.id);
    assert.equal(movesA.length, 3);
    assert.deepEqual(rA.start.units.filter(u => u.isMine).map(u => u.id).sort(), aIds.slice().sort());
    const textB = JSON.stringify(b2.messages);
    for (const id of aIds) assert.ok(!textB.includes(`"${id}"`), `aucune trace de ${id} chez B`);
    const fullMoves = rS.ticks.flatMap(t => t.events).filter(e => e.k === 'move');
    assert.equal(fullMoves.length, 5, 'le spectateur (vision complète) voit tout');
    const gs2 = a.last('game_state');
    assert.equal(gs2.turn, 2);
    assert.deepEqual(gs2.planning.myOrders, {});
    assert.equal(gs2.myUnits.find(u => u.id === a1.id).q, a1.q + 3);
    assert.equal(gs2.myUnits.find(u => u.id === a2.id).stance, 'combat');
    const ps2 = a.last('planning_start');
    assert.equal(ps2.turn, 2);
    assert.equal(ps2.startsAt, h.clock.now() + rA.durationMs, 'le minuteur démarre après la lecture');
    assert.equal(ps2.endsAt, ps2.startsAt + 30000);

    // refresh during the playback: the timeline comes back with the elapsed time
    h.clock.advance(500);
    const aSession = a.session;
    await a.close();
    const a3 = h.client('a3');
    await a3.send('rejoin_game', { roomCode: aSession.roomCode, playerId: aSession.playerId, token: aSession.token });
    const again = a3.last('resolution');
    assert.ok(again, 'chronologie renvoyée pendant la lecture');
    assert.equal(again.elapsedMs, 500);
    assert.deepEqual(again.ticks, rA.ticks);
    const order = a3.messages.map(m => m.event);
    assert.ok(order.indexOf('game_state') < order.indexOf('resolution'));

    // the planning timer resolves the turn with the orders given so far
    const [, ] = troops(gs2);
    await a3.send('set_orders', { orders: { [a1.id]: { type: 'move', path: step({ q: a1.q + 3, r: a1.r }, 1) } } });
    h.clock.set(ps2.endsAt + 1);
    await h.protocol.tick(aSession.roomCode);
    assert.ok(a3.last('planning_timeout'));
    assert.equal(a3.last('resolution').turn, 2);
    assert.equal(a3.last('game_state').turn, 3);
    assert.equal(a3.last('game_state').myUnits.find(u => u.id === a1.id).q, a1.q + 4);

    // an absent player counts as ready after absentTurnMs
    await b2.close();
    await a3.send('commit_orders');
    assert.equal(a3.last('game_state').turn, 3, 'B vient de partir : on l\'attend');
    h.clock.advance(h.protocol.config.absentTurnMs + 1);
    await h.protocol.tick(aSession.roomCode);
    assert.equal(a3.last('game_state').turn, 4);
  });
}

test('mode simultané : un joueur qui abandonne ne bloque pas la résolution', async () => {
  const h = createHarness();
  const { a, b } = await simBattle(h, { planningTimer: 0 });
  assert.equal(a.last('planning_start').endsAt, null);
  await a.send('commit_orders');
  await b.send('leave_room');
  assert.equal(a.last('game_state').phase, 'ended', 'seul joueur restant : victoire');
});

test('mode simultané : les spectateurs en vision différée ou aucune ne reçoivent pas la chronologie', async () => {
  const h = createHarness();
  const { a, b } = await simBattle(h, { spectatorVision: 'off' });
  const s = h.client('s');
  await s.send('join_room', { roomCode: a.session.roomCode, playerName: 'Spect', spectator: true });
  await a.send('commit_orders');
  await b.send('commit_orders');
  assert.ok(a.last('resolution'));
  assert.equal(s.all('resolution').length, 0);
  assert.equal(s.last('game_state').planning.myOrders, undefined);
});
