const test = require('node:test');
const assert = require('node:assert');
const maps = require('../game/maps');
const rules = require('../game/rules');
const { getStartingZones } = require('../game/HexUtils');
const { PROP_BY_ID } = require('../public/js/mapProps.js');

const map = maps.getMap('kokuyou');
const td = maps.terrainLookup(map);
const seg = (q1, r1, q2, r2) => map.segments[rules.edgeKey(q1, r1, q2, r2)] || null;
const parse = (k) => { const [q, r] = k.split(',').map(Number); return { q, r }; };
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

function reach(start, { mounted = false, maxCost = 1e6, minStep = false } = {}) {
  return rules.reachable(rules.MOVE_TABLE, {
    start, maxCost, mounted, minStep,
    hexAt: (k) => (map.height[k] === undefined ? null : { terrain: td[k], height: map.height[k] }),
    segAt: seg,
  }).dist;
}

test('Colline de Kokuyou : carte valide, zones et objectifs', () => {
  assert.deepStrictEqual(maps.validateMap(map), []);
  assert.ok(maps.listMaps().some((m) => m.id === 'kokuyou' && m.name === 'Colline de Kokuyou'));
  assert.ok(Object.values(map.height).every(Number.isInteger), 'hauteurs entières');
  for (const k of Object.keys(map.segments)) {
    const [a, b] = k.split('|').map((x) => x.split(',').map(Number));
    assert.strictEqual(k, rules.edgeKey(a[0], a[1], b[0], b[1]), `clé de segment non canonique ${k}`);
  }
  assert.strictEqual(map.zones.length, 4);
  for (const z of map.zones) {
    assert.ok(z.tiles.length >= 40, `zone ${z.name} trop petite (${z.tiles.length})`);
    for (const k of z.tiles) assert.ok(td[k] && td[k] !== 'river' && td[k] !== 'bridge', `case de zone invalide ${k}`);
  }
  for (const n of [2, 3, 4]) {
    const zones = getStartingZones(n, 0, 2500, map);
    assert.strictEqual(zones.length, n);
    assert.ok(zones.every((z) => z.tiles.length > 0));
  }
  assert.strictEqual(map.objectives.length, 6, 'la grande colline et cinq collines');
  const centre = map.objectives.find((o) => o.name === 'Colline de Kokuyou');
  assert.ok(centre && centre.points > 1, 'la colline centrale vaut plus');
  for (const o of map.objectives) assert.ok(map.height[`${o.q},${o.r}`] >= 3, `${o.name} doit être une hauteur`);
  assert.ok(map.height[`${centre.q},${centre.r}`] > Math.max(...map.objectives.filter((o) => o !== centre).map((o) => map.height[`${o.q},${o.r}`])), 'la colline centrale domine');
  for (const p of map.decor.props) assert.ok(PROP_BY_ID[p.type], p.type);
  const forest = Object.values(td).filter((t) => t === 'forest').length;
  assert.ok(forest / Object.keys(td).length > 0.4, 'pays de forêts profondes');
});

test('Colline de Kokuyou : pentes douces, aucune falaise cachée', () => {
  for (const k of Object.keys(map.height)) {
    const { q, r } = parse(k);
    for (const [dq, dr] of DIRS) {
      const nk = `${q + dq},${r + dr}`;
      if (map.height[nk] === undefined) continue;
      if (Math.abs(map.height[k] - map.height[nk]) >= 2) assert.strictEqual(seg(q, r, q + dq, r + dr), 'cliff', `dénivelé sans falaise ${k} → ${nk}`);
    }
  }
  assert.ok(!Object.values(map.segments).includes('cliff'), 'aucune falaise nécessaire');
});

test('Colline de Kokuyou : presque toute la carte est accessible à pied depuis chaque zone, les objectifs aussi', () => {
  const total = Object.keys(map.height).length;
  for (const z of map.zones) {
    const dist = reach(parse(z.tiles[0]));
    assert.ok(dist.size / total >= 0.95, `${z.name} : ${dist.size}/${total} cases accessibles`);
    for (const o of map.objectives) assert.ok(dist.has(`${o.q},${o.r}`), `${o.name} injoignable depuis ${z.name}`);
    for (const other of map.zones) assert.ok(dist.has(other.tiles[0]), `${other.name} injoignable depuis ${z.name}`);
    const horses = reach(parse(z.tiles[0]), { mounted: true });
    for (const o of map.objectives) assert.ok(horses.has(`${o.q},${o.r}`), `${o.name} injoignable à cheval depuis ${z.name}`);
  }
});

test('Colline de Kokuyou : chaque case de déploiement permet de bouger', () => {
  for (const z of map.zones) for (const k of z.tiles) for (const mounted of [false, true]) {
    assert.ok(reach(parse(k), { mounted, maxCost: 3, minStep: true }).size > 1, `unité bloquée en ${k} (${mounted ? 'monté' : 'à pied'})`);
  }
});

test('Colline de Kokuyou : partie IA contre IA complète', { timeout: 180000 }, async () => {
  const { createProtocol } = require('../game/protocol');
  const { createMemoryStore } = require('../server/memoryStore');
  const GameRoom = require('../game/GameRoom');
  const bots = require('../game/bots');
  const errors = [];
  const store = createMemoryStore({});
  const log = { error: (...a) => errors.push(a.map(String).join(' ')), warn() {}, log() {} };
  const protocol = createProtocol({ store, transport: { async send() { return true; } }, config: { botPace: 0 }, log });
  const room = new GameRoom('KOKUY1', null, { mapId: 'kokuyou', record: true });
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
});
