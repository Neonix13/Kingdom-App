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
