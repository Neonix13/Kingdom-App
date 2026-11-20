const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');
const maps = require('../game/maps');

// 14 x 9 plain map, a forest hex at (7,2), deployment zones at both ends
function registerSimMap() {
  const height = {};
  for (let q = 0; q < 14; q++) for (let r = 0; r < 9; r++) height[`${q},${r}`] = 0;
  const zone = (q0) => ({ tiles: Object.keys(height).filter(k => { const q = +k.split(',')[0]; return q >= q0 && q <= q0 + 1; }) });
  return maps.registerMap({ id: 'test-sim', name: 'Test simultané', height, terrain: { '7,2': 'forest' }, segments: {}, zones: [zone(0), zone(12)], objectives: [{ q: 6, r: 6, points: 1, name: 'Gué' }] });
}

// Battle room in simultaneous mode; armies: { p0: [{ typeId, count }], p1: [...] }
function simRoom({ p0 = [{ typeId: 'soldats', count: 1 }], p1 = [{ typeId: 'soldats', count: 1 }], settings = {} } = {}) {
  registerSimMap();
  const room = new GameRoom('SIM', 'p0', { mapId: 'test-sim', mode: 'simultaneous' });
  room.addPlayer('p0', 'A'); room.getPlayer('p0').generalId = 'ou_ki';
  room.addPlayer('p1', 'B'); room.getPlayer('p1').generalId = 'mou_bu';
  assert.ok(room.setSettings(settings).ok);
  room.budget = 100000;
  room.startGame();
  assert.ok(room.submitArmy('p0', p0).ok);
  assert.ok(room.submitArmy('p1', p1).ok);
  room.startDeployment();
  for (const p of room.players) {
    const tiles = p.startingZone.tiles;
    p.units.forEach((u, j) => assert.ok(room.placeUnit(p.id, u.id, tiles[j].q, tiles[j].r).ok));
    assert.ok(room.setDeploymentReady(p.id).ok);
  }
  room.startBattle();
  return room;
}

// Put a unit on (q, r) (generals are parked in the corners unless placed explicitly)
function put(room, u, q, r, extra = {}) {
  u.q = q; u.r = r;
  Object.assign(u, extra);
  room._rebuildUnitMap();
  room._initUnitSpeedForTurn(u);
  return u;
}

function units(room, pid) {
  const p = room.getPlayer(pid);
  return { general: p.units.find(u => u.isGeneral), troops: p.units.filter(u => !u.isGeneral) };
}

// Parks the generals far apart (corners) so they do not interfere
function parkGenerals(room) {
  put(room, units(room, 'p0').general, 0, 8);
  put(room, units(room, 'p1').general, 13, 0);
}

function events(res, who = 'full') {
  const v = who === 'full' ? res.full : res.views[who];
  return v.ticks.flatMap(t => t.events.map(e => ({ ...e, t: t.t })));
}

module.exports = { registerSimMap, simRoom, put, units, parkGenerals, events };
