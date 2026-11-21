const test = require('node:test');
const assert = require('node:assert');
const maps = require('../game/maps');
const rules = require('../game/rules');
const { getStartingZones } = require('../game/HexUtils');
const { PROP_BY_ID } = require('../public/js/mapProps.js');

const map = maps.getMap('kankoku');
const td = maps.terrainLookup(map);
const seg = (q1, r1, q2, r2) => map.segments[rules.edgeKey(q1, r1, q2, r2)] || null;

// Hexes reachable from `start` (unbounded cost). closed: extra edge types treated as impassable
function costs(start, { mounted = false, closed = [] } = {}) {
  const table = rules.MOVE_TABLE;
  return rules.reachable(table, {
    start,
    maxCost: 1e6,
    mounted,
    hexAt: (k) => (map.height[k] === undefined ? null : { terrain: td[k], height: map.height[k] }),
    segAt: (q1, r1, q2, r2) => { const s = seg(q1, r1, q2, r2); return closed.includes(s) ? 'cliff' : s; },
  }).dist;
}
const reach = (start, opts) => new Set(costs(start, opts).keys());
const parse = (k) => { const [q, r] = k.split(',').map(Number); return { q, r }; };

test('Col de Kankoku : carte valide, zones et objectifs', () => {
  assert.deepStrictEqual(maps.validateMap(map), []);
  assert.ok(Object.values(map.height).every(Number.isInteger), 'hauteurs entières');
  for (const k of Object.keys(map.segments)) {
    const [a, b] = k.split('|').map((x) => x.split(',').map(Number));
    assert.strictEqual(k, rules.edgeKey(a[0], a[1], b[0], b[1]), `clé de segment non canonique ${k}`);
  }
  assert.ok(maps.listMaps().some((m) => m.id === 'kankoku' && m.name === 'Col de Kankoku'));
  assert.ok(map.zones.length >= 4);
  for (const z of map.zones) {
    assert.ok(z.tiles.length >= 30, `zone ${z.name} trop petite (${z.tiles.length})`);
    for (const k of z.tiles) assert.ok(td[k] && td[k] !== 'river' && td[k] !== 'bridge', `case de zone invalide ${k}`);
  }
  for (const n of [2, 3, 4]) {
    const zones = getStartingZones(n, 0, 2500, map);
    assert.strictEqual(zones.length, n);
    assert.ok(zones.every((z) => z.tiles.length > 0));
  }
  const names = map.objectives.map((o) => o.name);
  for (const n of ['Porte de Kankoku', 'Sommet du sentier', 'Camp de la coalition']) assert.ok(names.includes(n), n);
  for (const p of map.decor.props) assert.ok(PROP_BY_ID[p.type], p.type);
  assert.ok(map.decor.props.some((p) => p.type === 'porte'));
  assert.ok(map.decor.ramparts.length >= 3);
});

test('Col de Kankoku : la porte, le défilé nord (escalier) et le sentier sud (échelle) sont les seuls passages', () => {
  const qin = parse(map.zones[0].tiles[0]);
  const coal = map.zones[1].tiles;
  const gate = map.objectives.find((o) => o.id === 'porte');
  // infantry: everything connected, objectives reachable
  const all = reach(qin);
  for (const z of map.zones) for (const k of z.tiles) assert.ok(all.has(k), `zone injoignable ${k}`);
  for (const o of map.objectives) assert.ok(all.has(`${o.q},${o.r}`), `objectif injoignable ${o.name}`);
  // without the gates: the north defile (stone stairs) and the south trail (ladder) each link the two sides on foot
  const viaStairs = reach(qin, { closed: ['barriere', 'echelle'] });
  assert.ok(coal.some((k) => viaStairs.has(k)), 'le défilé nord doit contourner la porte');
  const viaLadder = reach(qin, { closed: ['barriere', 'escalier'] });
  assert.ok(coal.some((k) => viaLadder.has(k)), 'le sentier sud doit contourner la porte');
  const sealed = reach(qin, { closed: ['barriere', 'echelle', 'escalier'] });
  assert.ok(!coal.some((k) => sealed.has(k)), 'aucun autre passage ne doit franchir la ligne des remparts');
  // cavalry: the ladder is closed to them, the gate is their only way
  const horses = reach(qin, { mounted: true });
  assert.ok(coal.some((k) => horses.has(k)), 'la cavalerie passe par la porte');
  const horsesNoGate = reach(qin, { mounted: true, closed: ['barriere'] });
  assert.ok(!coal.some((k) => horsesNoGate.has(k)), 'la cavalerie ne doit pas passer par le sentier');
  assert.ok(all.has(`${gate.q},${gate.r}`));
});

test('Col de Kankoku : les défilés coûtent cher, le chemin de ronde est réservé aux fantassins', () => {
  const coal = parse(map.zones[1].tiles[0]);
  const qinTiles = map.zones[0].tiles;
  const best = (dist) => Math.min(...qinTiles.map((k) => dist.get(k) ?? Infinity));
  const viaGate = best(costs(coal));
  const viaNorth = best(costs(coal, { closed: ['barriere', 'echelle'] }));
  const viaSouth = best(costs(coal, { closed: ['barriere', 'escalier'] }));
  assert.ok(Number.isFinite(viaNorth) && Number.isFinite(viaSouth));
  assert.ok(viaNorth >= viaGate + 10, `défilé nord trop rapide (${viaNorth} contre ${viaGate} par la porte)`);
  assert.ok(viaSouth >= viaGate + 10, `sentier sud trop rapide (${viaSouth} contre ${viaGate} par la porte)`);
  // the wall-walk: reached on foot by the stone stairs from the courtyard, never on horseback
  const qin = parse(qinTiles[0]);
  const foot = reach(qin), horse = reach(qin, { mounted: true });
  assert.ok(map.decor.ramparts.some((k) => foot.has(k)), 'chemin de ronde inaccessible à pied');
  assert.ok(!map.decor.ramparts.some((k) => horse.has(k)), 'la cavalerie ne doit pas monter sur les remparts');
  assert.ok(Object.values(map.segments).filter((t) => t === 'escalier').length >= 5, 'escaliers vers le chemin de ronde');
});

test('Col de Kankoku : chaque case de déploiement permet de bouger', () => {
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

test('Col de Kankoku : partie IA contre IA complète (déploiement, déplacements, combats)', { timeout: 180000 }, async () => {
  const { createProtocol } = require('../game/protocol');
  const { createMemoryStore } = require('../server/memoryStore');
  const GameRoom = require('../game/GameRoom');
  const bots = require('../game/bots');
  const errors = [];
  const store = createMemoryStore({});
  const log = { error: (...a) => errors.push(a.map(String).join(' ')), warn() {}, log() {} };
  const protocol = createProtocol({ store, transport: { async send() { return true; } }, config: { botPace: 0 }, log });
  const room = new GameRoom('KANKO1', null, { mapId: 'kankoku', record: true });
  assert.ok(bots.addBot(room, { id: 'b_qin', difficulty: 'stratege', color: '#e05050' }).ok);
  assert.ok(bots.addBot(room, { id: 'b_coal', difficulty: 'stratege', color: '#4a90d9' }).ok);
  room.hostId = 'b_qin';
  room.setSettings({ maxTurns: 20 });
  room.budget = 5000;
  room.startGame();
  await store.create(room);
  await protocol.handle('spec#1', 'join_room', { roomCode: room.roomCode, playerName: 'Arbitre', spectator: true });
  let r = null;
  const sides = new Map();
  for (let i = 0; i < 500; i++) {
    await protocol.tick(room.roomCode);
    r = await store.get(room.roomCode);
    if (r && r.phase === 'battle') {
      for (const p of r.players) for (const u of p.units) {
        if (u.q == null) continue;
        const k = `${p.id}:${u.id}`;
        if (!sides.has(k)) sides.set(k, new Set());
        sides.get(k).add(u.q <= 24 ? 'W' : 'E');
      }
    }
    if (!r || r.phase === 'ended') break;
  }
  assert.strictEqual(r.phase, 'ended', `partie bloquée (phase ${r.phase}, tour ${r.turn})`);
  assert.strictEqual(protocol.bots.stats.failures, 0, JSON.stringify(protocol.bots.stats.errors));
  assert.deepStrictEqual(errors, []);
  const crossed = [...sides.values()].filter((s) => s.size === 2).length;
  const fought = Object.values(r.stats.players).some((p) => p.damageDealt > 0);
  assert.ok(crossed > 0 || fought, 'les armées doivent se rencontrer (passage de la ligne des remparts ou combats)');
});
