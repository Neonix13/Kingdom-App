const test = require('node:test');
const assert = require('node:assert');
const maps = require('../game/maps');
const rules = require('../game/rules');
const { getStartingZones } = require('../game/HexUtils');
const { PROP_BY_ID } = require('../public/js/mapProps.js');

const map = maps.getMap('bayou');
const td = maps.terrainLookup(map);
const seg = (q1, r1, q2, r2) => map.segments[rules.edgeKey(q1, r1, q2, r2)] || null;
const parse = (k) => { const [q, r] = k.split(',').map(Number); return { q, r }; };

function costs(start, { mounted = false, closed = [] } = {}) {
  return rules.reachable(rules.MOVE_TABLE, {
    start,
    maxCost: 1e6,
    mounted,
    hexAt: (k) => (map.height[k] === undefined ? null : { terrain: td[k], height: map.height[k] }),
    segAt: (q1, r1, q2, r2) => { const s = seg(q1, r1, q2, r2); return closed.includes(s) ? 'cliff' : s; },
  }).dist;
}

test('Plaine de Bayou : carte valide, zones et objectifs', () => {
  assert.deepStrictEqual(maps.validateMap(map), []);
  assert.ok(Object.values(map.height).every(Number.isInteger), 'hauteurs entières');
  for (const k of Object.keys(map.segments)) {
    const [a, b] = k.split('|').map((x) => x.split(',').map(Number));
    assert.strictEqual(k, rules.edgeKey(a[0], a[1], b[0], b[1]), `clé de segment non canonique ${k}`);
  }
  assert.ok(maps.listMaps().some((m) => m.id === 'bayou' && m.name === 'Plaine de Bayou'));
  assert.ok(map.zones.length >= 4);
  for (const z of map.zones) {
    assert.ok(z.tiles.length >= 30, `zone ${z.name} trop petite (${z.tiles.length})`);
    for (const k of z.tiles) assert.ok(td[k] && !['river', 'bridge', 'forest', 'building'].includes(td[k]), `case de zone non déployable ${k} (${td[k]})`);
    for (const k of z.tiles) assert.ok(!map.decor.ramparts.includes(k), `zone sur le rempart ${k}`);
  }
  for (const n of [2, 3, 4]) {
    const zones = getStartingZones(n, 0, 2500, map);
    assert.strictEqual(zones.length, n);
    assert.ok(zones.every((z) => z.tiles.length > 0));
  }
  const names = map.objectives.map((o) => o.name);
  for (const n of ['Porte de Bayou', 'Pont de Bayou', 'Colline centrale', 'Bois du sud-est']) assert.ok(names.includes(n), n);
  for (const p of map.decor.props) assert.ok(PROP_BY_ID[p.type], p.type);
  assert.ok(map.decor.props.filter((p) => p.type === 'porte').length >= 3);
  assert.ok(map.decor.ramparts.length >= 20);
});

test('Plaine de Bayou : pentes douces, falaises seulement aux remparts', () => {
  const keys = Object.keys(map.height);
  const set = new Set(keys);
  const ramparts = new Set(map.decor.ramparts);
  for (const k of keys) {
    const { q, r } = parse(k);
    for (const [dq, dr] of [[1, 0], [1, -1], [0, 1]]) {
      const nk = `${q + dq},${r + dr}`;
      if (!set.has(nk)) continue;
      const dh = Math.abs(map.height[k] - map.height[nk]);
      if (dh >= 2) {
        const s = seg(q, r, q + dq, r + dr);
        assert.ok(s === 'cliff' || s === 'escalier', `dénivelé ${dh} sans falaise ni escalier ${k} / ${nk}`);
        assert.ok(ramparts.has(k) || ramparts.has(nk), `falaise hors des remparts ${k} / ${nk}`);
      }
    }
  }
});

test('Plaine de Bayou : presque toutes les cases sont accessibles à pied, objectifs compris', () => {
  const passable = Object.keys(map.height);
  for (const z of map.zones) {
    const dist = costs(parse(z.tiles[0]));
    const n = passable.filter((k) => dist.has(k)).length;
    assert.ok(n / passable.length >= 0.95, `${z.name} : seulement ${n}/${passable.length} cases accessibles`);
    for (const o of map.objectives) assert.ok(dist.has(`${o.q},${o.r}`), `objectif injoignable ${o.name} depuis ${z.name}`);
    for (const zz of map.zones) assert.ok(zz.tiles.some((k) => dist.has(k)), `${zz.name} injoignable depuis ${z.name}`);
  }
  // the wall-walk: on foot by the inner stairs only, never on horseback
  const town = parse(map.zones[0].tiles[0]);
  const foot = costs(town), horse = costs(town, { mounted: true });
  assert.ok(map.decor.ramparts.some((k) => foot.has(k)), 'chemin de ronde inaccessible à pied');
  assert.ok(!map.decor.ramparts.some((k) => horse.has(k)), 'la cavalerie ne doit pas monter sur les remparts');
  const noStairs = costs(town, { closed: ['escalier'] });
  assert.ok(!map.decor.ramparts.some((k) => noStairs.has(k)), 'le chemin de ronde ne doit être accessible que par les escaliers');
  // the plain is open to cavalry: the Zhao camp reaches the town gate, the bridge and the fords on horseback
  const zhao = costs(parse(map.zones[1].tiles[0]), { mounted: true });
  for (const id of ['porte', 'pont', 'gue', 'colline']) {
    const o = map.objectives.find((x) => x.id === id);
    assert.ok(zhao.has(`${o.q},${o.r}`), `cavalerie : ${o.name} injoignable`);
  }
});

test('Plaine de Bayou : chaque case de déploiement permet de bouger', () => {
  for (const z of map.zones) for (const k of z.tiles) {
    const { q, r } = parse(k);
    for (const mounted of [false, true]) {
      const r1 = rules.reachable(rules.MOVE_TABLE, {
        start: { q, r }, maxCost: 3, mounted, minStep: true,
        hexAt: (kk) => (map.height[kk] === undefined ? null : { terrain: td[kk], height: map.height[kk] }),
        segAt: seg,
      });
      assert.ok(r1.dist.size > 1, `unité bloquée en ${k} (${mounted ? 'monté' : 'à pied'})`);
    }
  }
});

test('Plaine de Bayou : partie IA contre IA complète', { timeout: 180000 }, async () => {
  const { createProtocol } = require('../game/protocol');
  const { createMemoryStore } = require('../server/memoryStore');
  const GameRoom = require('../game/GameRoom');
  const bots = require('../game/bots');
  const errors = [];
  const store = createMemoryStore({});
  const log = { error: (...a) => errors.push(a.map(String).join(' ')), warn() {}, log() {} };
  const protocol = createProtocol({ store, transport: { async send() { return true; } }, config: { botPace: 0 }, log });
  const room = new GameRoom('BAYOU1', null, { mapId: 'bayou', record: true });
  assert.ok(bots.addBot(room, { id: 'b_qin', difficulty: 'stratege', color: '#e05050' }).ok);
  assert.ok(bots.addBot(room, { id: 'b_zhao', difficulty: 'stratege', color: '#4a90d9' }).ok);
  room.hostId = 'b_qin';
  room.setSettings({ maxTurns: 20 });
  room.budget = 5000;
  room.startGame();
  await store.create(room);
  await protocol.handle('spec#1', 'join_room', { roomCode: room.roomCode, playerName: 'Arbitre', spectator: true });
  let r = null;
  for (let i = 0; i < 500; i++) {
    await protocol.tick(room.roomCode);
    r = await store.get(room.roomCode);
    if (!r || r.phase === 'ended') break;
  }
  assert.strictEqual(r.phase, 'ended', `partie bloquée (phase ${r.phase}, tour ${r.turn})`);
  assert.strictEqual(protocol.bots.stats.failures, 0, JSON.stringify(protocol.bots.stats.errors));
  assert.deepStrictEqual(errors, []);
  assert.ok(Object.values(r.stats.players).some((p) => p.damageDealt > 0), 'les armées doivent se rencontrer');
});
