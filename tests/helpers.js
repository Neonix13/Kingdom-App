const maps = require('../game/maps');
const { createProtocol } = require('../game/protocol');
const { createMemoryStore } = require('../server/memoryStore');

// 10 x 8 parallelogram; two adjacent fixed zones (q 0-1 and q 2-3) so combat is reachable on turn 1
function registerTestMap() {
  const height = {};
  const terrain = {};
  for (let q = 0; q < 10; q++) for (let r = 0; r < 8; r++) height[`${q},${r}`] = 0;
  height['5,5'] = 2;
  terrain['6,1'] = 'forest';
  terrain['7,1'] = 'forest';
  terrain['8,6'] = 'river';
  const zone = (q0) => ({ tiles: Object.keys(height).filter(k => { const q = +k.split(',')[0]; return q >= q0 && q <= q0 + 1; }) });
  return maps.registerMap({
    id: 'test-small', name: 'Test', height, terrain,
    segments: { '4,4|5,4': 'mur' },
    zones: [zone(0), zone(2), zone(6)], shuffleZones: false,
    objectives: [{ q: 5, r: 5, type: 'flag', points: 1, name: 'Colline' }],
  });
}

function createClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; }, set: (v) => { t = v; } };
}

function createHarness({ roundTrip = false, config = {}, store } = {}) {
  registerTestMap();
  const clock = createClock();
  const inbox = new Map();
  const closed = new Set();
  const transport = {
    async send(connId, msg) {
      if (closed.has(connId)) return false;
      if (!inbox.has(connId)) inbox.set(connId, []);
      inbox.get(connId).push(JSON.parse(JSON.stringify(msg)));
      return true;
    },
  };
  const st = store || createMemoryStore({ roundTrip });
  const protocol = createProtocol({ store: st, transport, now: clock.now, config, log: { error() {}, warn() {}, log() {} } });
  let n = 0;
  function client(name) {
    const connId = `${name || 'c'}#${++n}`;
    inbox.set(connId, []);
    const c = {
      connId,
      session: null,
      get messages() { return inbox.get(connId); },
      async send(action, data = {}) {
        await protocol.handle(connId, action, { roomCode: c.session?.roomCode, ...data });
        for (const m of inbox.get(connId)) if (m.event === 'session') c.session = m;
        return c;
      },
      all(event) { return inbox.get(connId).filter(m => m.event === event); },
      last(event) { const a = c.all(event); return a[a.length - 1]; },
      errors() { return c.all('error'); },
      clear() { inbox.set(connId, []); },
      async close() { closed.add(connId); await protocol.disconnect(connId); },
    };
    return c;
  }
  return { protocol, store: st, clock, client, inbox, transport };
}

// Lobby -> battle on the test map with one unit type per player. Returns { a, b, first, second, room }.
async function setupBattle(h, { units = [{ typeId: 'soldats', count: 1 }], mapId = 'test-small' } = {}) {
  const a = h.client('a');
  const b = h.client('b');
  await a.send('create_room', { playerName: 'Alice' });
  await b.send('join_room', { roomCode: a.session.roomCode, playerName: 'Bob' });
  await a.send('set_map', { mapId });
  await a.send('select_general', { generalId: 'ou_ki' });
  await b.send('select_general', { generalId: 'mou_bu' });
  await a.send('start_game');
  await a.send('submit_army', { units });
  await b.send('submit_army', { units });
  const dsA = a.last('deployment_state');
  const dsB = b.last('deployment_state');
  await deployFront(a, dsA, 1);
  await deployFront(b, dsB, 2);
  await a.send('deployment_ready');
  await b.send('deployment_ready');
  const gs = a.last('game_state');
  const first = gs.currentPlayerId === a.session.playerId ? a : b;
  const second = first === a ? b : a;
  return { a, b, first, second };
}

// Place units on column `q` (the zone edge facing the enemy), general further back
async function deployFront(c, ds, q) {
  const zone = ds.startingZone.tiles;
  const front = zone.filter(t => t.q === q).sort((x, y) => x.r - y.r);
  const back = zone.filter(t => t.q !== q).sort((x, y) => x.r - y.r);
  const general = ds.units.find(u => u.isGeneral);
  const troops = ds.units.filter(u => !u.isGeneral);
  let i = 2;
  for (const u of troops) { const t = front[i++]; await c.send('place_unit', { unitId: u.id, q: t.q, r: t.r }); }
  await c.send('place_unit', { unitId: general.id, q: back[3].q, r: back[3].r });
}

module.exports = { registerTestMap, createClock, createHarness, setupBattle };
