const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');
const maps = require('../game/maps');
const rules = require('../game/rules');
const { effectiveSegments } = require('../public/js/mapProps.js');
const { nextPlacement } = require('../game/bots/deploy');

function deployRoom(units, mapId = 'kankoku') {
  const room = new GameRoom('DEP', 'p0', { mapId });
  room.addPlayer('p0', 'P0');
  room.addPlayer('p1', 'P1');
  room.getPlayer('p0').generalId = 'ou_ki';
  room.getPlayer('p1').generalId = 'ri_boku';
  room.startGame();
  assert.ok(room.submitArmy('p0', units).ok);
  assert.ok(room.submitArmy('p1', [{ typeId: 'soldats', count: 1 }]).ok);
  room.startDeployment();
  return room;
}

// A hex foot soldiers can leave but horses cannot (wall walk reached by stairs, ladder-only ledge…)
function fencedHex(room) {
  const foot = room._mainArea(false), mounted = room._mainArea(true);
  return [...foot].find((k) => !mounted.has(k) && room.hexMap[k].terrain !== 'river');
}

test('Carte par défaut : toutes les cases sont joignables à pied malgré les falaises automatiques', () => {
  const map = maps.getMap('default');
  const td = maps.terrainLookup(map);
  const eff = effectiveSegments(map.segments, map.decor, map.height);
  const [q, r] = map.zones[0] ? map.zones[0].tiles[0].split(',').map(Number) : Object.keys(map.height)[0].split(',').map(Number);
  const dist = rules.reachable(rules.MOVE_TABLE, {
    start: { q, r }, maxCost: 1e6, mounted: false,
    hexAt: (k) => (map.height[k] === undefined ? null : { terrain: td[k], height: map.height[k] }),
    segAt: (a, b, c, d) => eff[rules.edgeKey(a, b, c, d)] || null,
  }).dist;
  const total = Object.keys(map.height).length;
  assert.ok(dist.size / total >= 0.999, `${dist.size}/${total} cases joignables`);
});

test('Déploiement : une cavalerie ne peut pas être posée là où elle serait coincée (chemin de ronde), l\'infanterie si', () => {
  const room = deployRoom([{ typeId: 'cavalier_leger', count: 1 }, { typeId: 'soldats', count: 1 }]);
  const k = fencedHex(room);
  assert.ok(k, 'le Col de Kankoku a des cases interdites aux montures');
  const [q, r] = k.split(',').map(Number);
  const p = room.getPlayer('p0');
  p.startingZone.tiles.push({ q, r });
  for (const o of room.players) for (const u of o.units) if (u.q === q && u.r === r) { u.q = null; u.r = null; }
  const cav = p.units.find((u) => u.typeId === 'cavalier_leger');
  const inf = p.units.find((u) => u.typeId === 'soldats');
  const res = room.placeUnit('p0', cav.id, q, r);
  assert.ok(res.error && /bloqué/.test(res.error), res.error);
  assert.notDeepEqual([cav.q, cav.r], [q, r]);
  assert.ok(room.placeUnit('p0', inf.id, q, r).ok);
  // swapping would push the cavalry into the field: refused too
  assert.ok(room.placeUnit('p0', cav.id, q, r).error);
  const state = room.getDeploymentState('p0');
  assert.ok(state.blockedTiles.mounted.includes(k));
  assert.ok(!state.blockedTiles.foot.includes(k));
});

test('Déploiement automatique et IA : jamais une unité sur une case où elle serait bloquée', () => {
  for (const mapId of ['kankoku', 'bayou', 'default']) {
    const room = deployRoom([{ typeId: 'cavalier_leger', count: 2 }, { typeId: 'soldats', count: 1 }], mapId);
    for (const p of room.players) for (const u of p.units) {
      if (u.q === null) continue;
      assert.ok(room.canDeployAt(u, u.q, u.r), `${u.name} posé sur une case sans issue ${u.q},${u.r}`);
    }
    // the bot placement filters stuck hexes too
    const p = room.getPlayer('p0');
    const k = fencedHex(room);
    if (!k) continue;
    const [q, r] = k.split(',').map(Number);
    p.startingZone = { ...p.startingZone, tiles: [{ q, r }] };
    for (const u of p.units) { u.q = null; u.r = null; }
    const cav = p.units.find((u) => u.typeId === 'cavalier_leger');
    p.units.sort((a, b) => (a === cav ? -1 : b === cav ? 1 : 0));
    const next = nextPlacement(room, p, () => 0.5);
    assert.ok(!next || next.unitId !== cav.id || room.canDeployAt(cav, next.q, next.r));
  }
});

test('zones de déploiement : d\'un seul tenant (sans falaise ni mur à traverser), de taille égale, sans rivière ni chevauchement', () => {
  const maps = require('../game/maps');
  const { getStartingZones, segmentEdgeKey } = require('../game/HexUtils');
  const { effectiveSegments } = require('../public/js/mapProps.js');
  const D = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  for (const { id } of maps.listMaps()) {
    const map = maps.getMap(id);
    const td = maps.terrainLookup(map);
    const sd = effectiveSegments(map.segments, map.decor, map.height);
    for (const n of [2, 4]) for (const budget of [2500, 5000, 10000]) {
      const zones = getStartingZones(n, 70, budget, map);
      const used = new Set();
      const size = zones[0].tiles.length;
      for (const z of zones) {
        assert.equal(z.tiles.length, size, `${id} ${n} joueurs ${budget} : tailles égales`);
        const keys = new Set(z.tiles.map(t => `${t.q},${t.r}`));
        for (const k of keys) { assert.ok(!used.has(k), `${id} : chevauchement ${k}`); used.add(k); assert.notEqual(td[k], 'river', `${id} : rivière ${k}`); }
        const seen = new Set([[...keys][0]]);
        const stack = [z.tiles[0]];
        while (stack.length) {
          const c = stack.pop();
          for (const [dq, dr] of D) {
            const nk = `${c.q + dq},${c.r + dr}`;
            const seg = sd[segmentEdgeKey(c.q, c.r, c.q + dq, c.r + dr)];
            if (keys.has(nk) && !seen.has(nk) && seg !== 'cliff' && seg !== 'mur') { seen.add(nk); stack.push({ q: c.q + dq, r: c.r + dr }); }
          }
        }
        assert.equal(seen.size, keys.size, `${id} ${n} joueurs ${budget} : zone d'un seul tenant`);
      }
    }
  }
});
