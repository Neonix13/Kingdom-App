const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandler } = require('../lambda/handler');
const { registerTestMap } = require('./helpers');

// Minimal DynamoDB DocumentClient fake: Get/Put/Delete with the condition expressions used by lambda/dynamoStore.js
function fakeDdb({ conflictOnce = false } = {}) {
  const tables = new Map();
  const stats = { puts: 0, conflicts: 0 };
  let pendingConflict = conflictOnce;
  const table = (name) => { if (!tables.has(name)) tables.set(name, new Map()); return tables.get(name); };
  const keyOf = (k) => JSON.stringify(k);
  const check = (item, input) => {
    const cond = input.ConditionExpression;
    if (!cond) return true;
    if (cond === 'attribute_not_exists(roomCode)') return !item;
    if (cond === 'attribute_not_exists(version) OR version = :v') return !item || item.version === undefined || item.version === input.ExpressionAttributeValues[':v'];
    throw new Error('condition inconnue ' + cond);
  };
  const conflict = () => { stats.conflicts++; const e = new Error('conflict'); e.name = 'ConditionalCheckFailedException'; return e; };
  return {
    tables, stats,
    async send(cmd) {
      const input = JSON.parse(JSON.stringify(cmd.input));
      const t = table(input.TableName);
      const name = cmd.constructor.name;
      if (name === 'GetCommand') return { Item: t.has(keyOf(input.Key)) ? JSON.parse(t.get(keyOf(input.Key))) : undefined };
      if (name === 'PutCommand') {
        const key = input.Item.connectionId ? { connectionId: input.Item.connectionId } : { roomCode: input.Item.roomCode };
        const existing = t.has(keyOf(key)) ? JSON.parse(t.get(keyOf(key))) : null;
        if (input.ConditionExpression && pendingConflict && existing) {
          pendingConflict = false;
          existing.version = (existing.version || 0) + 1;
          t.set(keyOf(key), JSON.stringify(existing));
          throw conflict();
        }
        if (!check(existing, input)) throw conflict();
        stats.puts++;
        t.set(keyOf(key), JSON.stringify(input.Item));
        return {};
      }
      if (name === 'DeleteCommand') {
        const existing = t.has(keyOf(input.Key)) ? JSON.parse(t.get(keyOf(input.Key))) : null;
        if (!check(existing, input)) throw conflict();
        t.delete(keyOf(input.Key));
        return {};
      }
      throw new Error('commande inconnue ' + name);
    },
  };
}

function fakeApigw(inbox, gone) {
  return () => ({
    async send(cmd) {
      const id = cmd.input.ConnectionId;
      if (gone.has(id)) { const e = new Error('gone'); e.name = 'GoneException'; e.$metadata = { httpStatusCode: 410 }; throw e; }
      if (!inbox.has(id)) inbox.set(id, []);
      inbox.get(id).push(JSON.parse(Buffer.from(cmd.input.Data).toString()));
      return {};
    },
  });
}

function setup(opts) {
  registerTestMap();
  const ddb = fakeDdb(opts);
  const inbox = new Map();
  const gone = new Set();
  const handler = createHandler({ ddb, apigwFactory: fakeApigw(inbox, gone), roomsTable: 'R', connectionsTable: 'C', log: { error() {} } });
  const ev = (connectionId, routeKey, body) => handler({ requestContext: { connectionId, routeKey, domainName: 'x', stage: 'prod' }, body: body && JSON.stringify(body) });
  const msgs = (id, event) => (inbox.get(id) || []).filter(m => m.event === event);
  const last = (id, event) => msgs(id, event).slice(-1)[0];
  return { ddb, inbox, gone, ev, msgs, last };
}

test('lambda : partie complète avec DynamoDB simulé (état sérialisé à chaque message)', async () => {
  const { ddb, ev, last, msgs } = setup();
  await ev('A', '$connect');
  await ev('A', '$default', { action: 'create_room', playerName: 'Alice' });
  const sA = last('A', 'session');
  const code = sA.roomCode;
  await ev('B', '$default', { action: 'join_room', roomCode: code, playerName: 'Bob' });
  const sB = last('B', 'session');
  for (const [c, body] of [
    ['A', { action: 'set_map', mapId: 'test-small' }],
    ['A', { action: 'select_general', generalId: 'ou_ki' }],
    ['B', { action: 'select_general', generalId: 'mou_bu' }],
    ['A', { action: 'start_game' }],
  ]) await ev(c, '$default', { roomCode: code, ...body });
  await Promise.all([
    ev('A', '$default', { action: 'submit_army', roomCode: code, units: [{ typeId: 'soldats', count: 1 }] }),
    ev('B', '$default', { action: 'submit_army', roomCode: code, units: [{ typeId: 'soldats', count: 1 }] }),
  ]);
  assert.ok(last('A', 'deployment_state'), 'soumissions simultanées : aucune armée perdue');
  for (const [c, q] of [['A', 1], ['B', 2]]) {
    const ds = last(c, 'deployment_state');
    const g = ds.units.find(u => u.isGeneral);
    const s = ds.units.find(u => !u.isGeneral);
    await ev(c, '$default', { action: 'place_unit', roomCode: code, unitId: s.id, q, r: 3 });
    await ev(c, '$default', { action: 'place_unit', roomCode: code, unitId: g.id, q: q === 1 ? 0 : 3, r: 3 });
  }
  await Promise.all([ev('A', '$default', { action: 'deployment_ready', roomCode: code }), ev('B', '$default', { action: 'deployment_ready', roomCode: code })]);
  const gs = last('A', 'game_state');
  assert.equal(gs.phase, 'battle');
  const [cur, other] = gs.currentPlayerId === sA.playerId ? ['A', 'B'] : ['B', 'A'];
  const cgs = last(cur, 'game_state');
  await ev(cur, '$default', { action: 'attack_unit', roomCode: code, attackerId: cgs.myUnits.find(u => !u.isGeneral).id, targetId: cgs.units.find(u => !u.isMine && !u.isGeneral).id });
  const req = last(other, 'defense_request');
  assert.ok(req);
  await ev(other, '$disconnect');
  assert.equal(last(cur, 'player_disconnected').playerId, other === 'A' ? sA.playerId : sB.playerId);
  const sess = other === 'A' ? sA : sB;
  await ev('Z', '$default', { action: 'rejoin_game', roomCode: code, playerId: sess.playerId, token: sess.token });
  assert.equal(last('Z', 'defense_request').attackId, req.attackId);
  await ev('Z', '$default', { action: 'defend_choice', roomCode: code, attackId: req.attackId, choice: 'counter' });
  assert.ok(last(cur, 'combat_result'));
  await ev(cur, '$default', { action: 'end_turn', roomCode: code });
  assert.ok(msgs('Z', 'turn_change').length >= 1);
  const item = JSON.parse([...ddb.tables.get('R').values()][0]);
  assert.ok(item.version > 5);
  assert.equal(item.data.mapId, 'test-small');
  assert.ok(item.data.manche >= 1);
});

test('lambda : conflit d\'écriture → nouvel essai, état cohérent', async () => {
  const { ddb, ev, last } = setup({ conflictOnce: false });
  await ev('A', '$default', { action: 'create_room', playerName: 'Alice' });
  const code = last('A', 'session').roomCode;
  ddb.stats.conflicts = 0;
  const realSend = ddb.send.bind(ddb);
  let injected = false;
  ddb.send = async (cmd) => {
    if (!injected && cmd.constructor.name === 'PutCommand' && cmd.input.ConditionExpression && !cmd.input.Item.connectionId) {
      injected = true;
      const raw = ddb.tables.get('R').get(JSON.stringify({ roomCode: code }));
      const item = JSON.parse(raw);
      item.version += 1;
      item.data.budget = 7000;
      ddb.tables.get('R').set(JSON.stringify({ roomCode: code }), JSON.stringify(item));
    }
    return realSend(cmd);
  };
  await ev('A', '$default', { action: 'select_general', roomCode: code, generalId: 'ou_ki' });
  const lu = last('A', 'room_update');
  assert.equal(lu.budget, 7000, 'la modification concurrente n\'est pas écrasée');
  assert.equal(lu.players[0].generalId, 'ou_ki');
  assert.equal(ddb.stats.conflicts, 1);
});

test('lambda : connexion disparue (410) traitée comme une déconnexion, items legacy sans version', async () => {
  const { ddb, ev, last, gone } = setup();
  await ev('A', '$default', { action: 'create_room', playerName: 'Alice' });
  const code = last('A', 'session').roomCode;
  await ev('B', '$default', { action: 'join_room', roomCode: code, playerName: 'Bob' });
  const key = JSON.stringify({ roomCode: code });
  const item = JSON.parse(ddb.tables.get('R').get(key));
  delete item.version;
  ddb.tables.get('R').set(key, JSON.stringify(item));
  gone.add('B');
  await ev('A', '$default', { action: 'set_budget', roomCode: code, budget: 3000 });
  const lu = last('A', 'room_update');
  assert.equal(lu.budget, 3000);
  assert.equal(lu.players.find(p => p.name === 'Bob').connected, false);
});
