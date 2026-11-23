// Fairness of objectives vs deployment zones: walking cost (foot) from each zone to each objective.
// node scripts/objectiveFairness.js [mapId]
const maps = require('../game/maps');
const rules = require('../game/rules');
const { effectiveSegments } = require('../public/js/mapProps.js');
const { getStartingZones } = require('../game/HexUtils');

function report(id) {
  const map = maps.getMap(id);
  const td = maps.terrainLookup(map);
  const effSeg = effectiveSegments(map.segments, map.decor, map.height);
  const costFrom = (tiles) => {
    // multi-source: cheapest cost from any tile of the zone
    const best = new Map();
    for (const k of tiles) {
      const [q, r] = k.split(',').map(Number);
      const d = rules.reachable(rules.MOVE_TABLE, {
        start: { q, r }, maxCost: 1e6, mounted: false,
        hexAt: (h) => (map.height[h] === undefined ? null : { terrain: td[h], height: map.height[h] }),
        segAt: (q1, r1, q2, r2) => effSeg[rules.edgeKey(q1, r1, q2, r2)] || null,
      }).dist;
      for (const [h, c] of d) if (!best.has(h) || c < best.get(h)) best.set(h, c);
    }
    return best;
  };
  // the zones as played (trimmed to the budget's size)
  const played = getStartingZones((map.zones || []).length, 0, 5000, map);
  const zones = played.map((z, i) => ({ name: map.zones[i].name, cost: costFrom(z.tiles.map((t) => `${t.q},${t.r}`)) }));
  const out = { id, objectives: [] };
  for (const o of map.objectives || []) {
    const k = `${o.q},${o.r}`;
    out.objectives.push({ name: o.name || o.id, points: o.points, cost: zones.map((z) => Math.round(z.cost.get(k) ?? Infinity)) });
  }
  out.zones = zones.map((z) => z.name);
  return out;
}
module.exports = { report };
// advantage of side A over side B: points of the objectives A reaches clearly first (cost gap > 2) minus those of B
function advantage(r, a, b) { let n = 0; for (const o of r.objectives) { const d = o.cost[b] - o.cost[a]; if (d > 2) n += o.points; else if (d < -2) n -= o.points; } return n; }
module.exports.advantage = advantage;
if (require.main === module) {
  for (const id of process.argv[2] ? [process.argv[2]] : ['bayou', 'kankoku', 'kokuyou']) {
    const r = report(id);
    console.log(`== ${id}: ${r.zones.join(' | ')}`);
    for (const o of r.objectives) console.log(`  ${String(o.name).padEnd(22)} ${o.points} pts  coût ${o.cost.join(' / ')}`);
    console.log(`  avantage 1v1 (zone 1 vs 2) : ${advantage(r, 0, 1)} pts`);
  }
}
