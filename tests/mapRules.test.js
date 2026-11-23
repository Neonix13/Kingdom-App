const test = require('node:test');
const assert = require('node:assert');
const { effectiveSegments, autoCliffs, unreachableRamparts, AUTO_CLIFF_DH } = require('../public/js/mapProps.js');
const maps = require('../game/maps');
const { getSegmentData } = require('../game/HexUtils');

// a line of hexes q = 0..4 on r = 0, heights given
const line = (hs) => Object.fromEntries(hs.map((h, q) => [`${q},0`, h]));

test('falaises automatiques : 2 niveaux d\'écart ou plus, sauf escalier, échelle, rampe ou pont', () => {
  assert.strictEqual(AUTO_CLIFF_DH, 2);
  const height = line([0, 1, 3, 3, 6]);
  const auto = autoCliffs({}, height);
  assert.deepStrictEqual(Object.keys(auto).sort(), ['1,0|2,0', '3,0|4,0']);
  for (const t of ['escalier', 'echelle', 'rampe', 'bridge', 'passerelle']) {
    const eff = effectiveSegments({ '1,0|2,0': t }, {}, height);
    assert.strictEqual(eff['1,0|2,0'], t, `${t} reste praticable`);
    assert.strictEqual(eff['3,0|4,0'], 'cliff');
  }
  assert.strictEqual(effectiveSegments({ '1,0|2,0': 'barriere' }, {}, height)['1,0|2,0'], 'cliff');
  assert.strictEqual(effectiveSegments({}, {}, height)['0,0|1,0'], undefined, 'un niveau : pente praticable');
});

test('chemin de ronde : on n\'y monte que par un escalier ou une échelle', () => {
  const height = line([3, 3, 5, 5, 3]);
  const decor = { ramparts: ['2,0', '3,0'] };
  const eff = effectiveSegments({ '1,0|2,0': 'escalier' }, decor, height);
  assert.strictEqual(eff['1,0|2,0'], 'escalier');
  assert.strictEqual(eff['3,0|4,0'], 'cliff');
  assert.strictEqual(eff['2,0|3,0'], undefined, 'le chemin de ronde reste continu');
  // same height as the ground outside: still a wall
  const flat = effectiveSegments({}, { ramparts: ['2,0'] }, line([5, 5, 5, 5, 5]));
  assert.strictEqual(flat['1,0|2,0'], 'cliff');
  assert.strictEqual(flat['2,0|3,0'], 'cliff');
  assert.deepStrictEqual(unreachableRamparts({ ramparts: ['2,0'] }, {}, line([5, 5, 5, 5, 5])), [['2,0']]);
});

test('serveur : les segments de jeu incluent falaises automatiques et murs de rempart', () => {
  for (const id of ['default', 'kankoku']) {
    const map = maps.getMap(id);
    const sd = getSegmentData(map);
    assert.deepStrictEqual(sd, effectiveSegments(map.segments, map.decor, map.height));
    for (const [k, t] of Object.entries(map.segments)) if (['escalier', 'echelle', 'bridge', 'passerelle'].includes(t)) assert.strictEqual(sd[k], t);
  }
});

test('serveur : sur le Col de Kankoku, un fantassin ne monte sur le mur que par l\'escalier', () => {
  const GameRoom = require('../game/GameRoom');
  const { findPathCost } = require('../game/HexUtils');
  const room = new GameRoom('TEST', 'h', { mapId: 'kankoku' });
  room._loadMap();
  const unit = { id: 'u', typeId: 'soldats', category: 'Infanterie', q: 23, r: 8 };
  const path = (q, r) => findPathCost(room.hexMap, {}, 23, 8, q, r, 20, unit, room.segmentData, null, room.moveTable());
  // 23,8 (courtyard) -> 24,7 (wall walk) is a single edge without stairs: refused directly...
  const direct = findPathCost(room.hexMap, {}, 23, 8, 24, 7, 1, unit, room.segmentData, null, room.moveTable());
  assert.strictEqual(direct, null);
  // ...but reachable through the stairs a few hexes away, and the path climbs on a stair edge
  const p = path(24, 7);
  assert.ok(p, 'chemin vers le chemin de ronde');
  const steps = [[23, 8], ...p.path.map((s) => [s.q ?? s[0], s.r ?? s[1]])];
  const keyE = (a, b) => require('../game/rules').edgeKey(a[0], a[1], b[0], b[1]);
  const onto = steps.findIndex((s) => room.map.decor.ramparts.includes(`${s[0]},${s[1]}`));
  assert.ok(onto > 0);
  assert.strictEqual(room.segmentData[keyE(steps[onto - 1], steps[onto])], 'escalier');
});

test('cartes : deux cases voisines ne diffèrent jamais de plus de 2 niveaux sans falaise, escalier ou mur entre elles', () => {
  const maps = require('../game/maps');
  const rules = require('../game/rules');
  const D = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  for (const { id } of maps.listMaps()) {
    const m = maps.getMap(id);
    const H = m.height || {};
    const seg = m.segments || {};
    const walls = new Set([...((m.decor && m.decor.ramparts) || []), ...((m.decor && m.decor.props) || []).filter((p) => p.type === 'porte').map((p) => `${p.q},${p.r}`)]);
    const bad = [];
    for (const k of Object.keys(H)) {
      const [q, r] = k.split(',').map(Number);
      for (const [a, b] of D) {
        const nk = `${q + a},${r + b}`;
        if (!(nk in H) || nk < k || Math.abs(H[k] - H[nk]) <= 2) continue;
        if (seg[rules.edgeKey(q, r, q + a, r + b)] || walls.has(k) || walls.has(nk)) continue;
        bad.push(`${k}|${nk}`);
      }
    }
    assert.deepStrictEqual(bad, [], `${id} : écarts de plus de 2 niveaux sans falaise`);
  }
});
