const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const { createServer } = require('../server/createServer');
const { registerTestMap } = require('./helpers');

function connect(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const msgs = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      msgs.push(m);
      for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
    });
    ws.on('open', () => resolve({
      ws, msgs,
      send: (action, data = {}) => ws.send(JSON.stringify({ action, ...data })),
      raw: (s) => ws.send(s),
      wait(event, pred = () => true, ms = 2000) {
        const found = msgs.find(m => m.event === event && pred(m) && !m._seen);
        if (found) { found._seen = true; return Promise.resolve(found); }
        return new Promise((res, rej) => {
          const timer = setTimeout(() => rej(new Error(`timeout ${event}`)), ms);
          waiters.push({ pred: m => m.event === event && pred(m), resolve: (m) => { clearTimeout(timer); m._seen = true; res(m); } });
        });
      },
      close: () => new Promise(r => { ws.once('close', r); ws.close(); }),
    }));
    ws.on('error', reject);
  });
}

test('serveur WebSocket réel : messages malformés, partie, rafraîchissement, spectateur, HTTP', async () => {
  registerTestMap();
  const srv = createServer({ log: { error() {}, log() {} } });
  const port = await srv.listen(0);
  try {
    const a = await connect(port);
    a.raw('not json');
    a.raw('[1,2]');
    a.raw(JSON.stringify({ action: 'submit_army', units: null }));
    a.send('create_room', { playerName: 'Alice' });
    const sa = await a.wait('session');
    const b = await connect(port);
    b.send('join_room', { roomCode: sa.roomCode.toLowerCase(), playerName: 'Bob' });
    const sb = await b.wait('session');
    a.send('set_map', { roomCode: sa.roomCode, mapId: 'test-small' });
    a.send('select_general', { roomCode: sa.roomCode, generalId: 'ou_ki' });
    b.send('select_general', { roomCode: sa.roomCode, generalId: 'mou_bu' });
    await b.wait('room_update', m => m.players.every(p => p.generalId));
    a.send('start_game', { roomCode: sa.roomCode });
    await b.wait('phase_change', m => m.phase === 'army_building');
    a.send('submit_army', { roomCode: sa.roomCode, units: [{ typeId: 'soldats', count: 1 }] });
    b.send('submit_army', { roomCode: sa.roomCode, units: [{ typeId: 'soldats', count: 1 }] });
    const ds = await b.wait('deployment_state');
    assert.equal(ds.mapId, 'test-small');

    await b.close();
    const b2 = await connect(port);
    b2.send('rejoin_game', { roomCode: sb.roomCode, playerId: sb.playerId, token: sb.token });
    const ds2 = await b2.wait('deployment_state');
    assert.deepEqual(ds2.units.map(u => u.id), ds.units.map(u => u.id));

    const spec = await connect(port);
    spec.send('join_room', { roomCode: sa.roomCode, playerName: 'Zoé', spectator: true });
    const gs = await spec.wait('game_state');
    assert.equal(gs.isSpectator, true);
    assert.equal(gs.phase, 'deployment');

    const r1 = await fetch(`http://127.0.0.1:${port}/api/maps/test-small`);
    assert.equal(r1.status, 200);
    const r2 = await fetch(`http://127.0.0.1:${port}/join/${sa.roomCode}`, { redirect: 'manual' });
    assert.equal(r2.headers.get('location'), `/?join=${sa.roomCode}`);
    await Promise.all([a.close(), b2.close(), spec.close()]);
  } finally {
    await srv.close();
  }
});
