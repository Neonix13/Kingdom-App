// Benchmark of the line-of-sight vision (game/los.js): node scripts/bench-los.cjs
const GameRoom = require('../game/GameRoom.js');
const maps = require('../game/maps');
const { buildHexMap } = require('../game/HexUtils');
const SEG = require('../game/data/segments');

function stub(id) {
  const map = maps.getMap(id);
  return { hexMap: buildHexMap(map), heightData: map.height || {}, terrainData: maps.terrainLookup(map), segmentData: map.segments || {}, _segments: () => SEG };
}

for (const id of ['kankoku', 'default']) {
  const s = stub(id);
  const keys = Object.keys(s.hexMap);
  const units = [];
  for (let i = 0; i < 10; i++) {
    const h = s.hexMap[keys[((i + 3) * 7919) % keys.length]];
    units.push({ q: h.q, r: h.r, typeId: i === 0 ? 'general' : 'soldats', isGeneral: i === 0, visionRange: i === 0 ? 16 : 0 });
  }
  const reps = 5;
  let total = 0;
  const t = process.hrtime.bigint();
  for (let rep = 0; rep < reps; rep++) {
    s._losCache = null; s._losGrid = null;
    for (const u of units) total += GameRoom.prototype._unitVision.call(s, u, false).length;
  }
  const ms = Number(process.hrtime.bigint() - t) / 1e6 / reps;
  console.log(`${id}: ${keys.length} cases, 10 unités (dont 1 général) recalculées : ${ms.toFixed(2)} ms, ${total / reps} cases vues`);
}
