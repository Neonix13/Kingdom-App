// Run after regenerating a map: node scripts/maps/balanceObjectives.js --write (objective fairness: node scripts/objectiveFairness.js)
// Greedy rebalancing of objectives: each objective may move up to 8 hexes (same kind of ground when possible), never on a
// gate, rampart, deployment tile, or within walking cost 6 of a zone; goal: no side reaches more points clearly first
// (1v1: zone 1 vs 2; 2v2: zones 1+4 vs 2+3).
const fs = require('fs');
const maps = require('../../game/maps');
const rules = require('../../game/rules');
const { effectiveSegments } = require('../../public/js/mapProps.js');
const { getStartingZones, hexDistance } = require('../../game/HexUtils');
const write = process.argv.includes('--write');
for (const id of ['bayou', 'kankoku', 'kokuyou']) {
  const map = maps.getMap(id);
  const td = maps.terrainLookup(map);
  const effSeg = effectiveSegments(map.segments, map.decor, map.height);
  const zones = getStartingZones(4, 0, 5000, map);
  const cost = zones.map((z) => {
    const best = new Map();
    for (const t of z.tiles) {
      const d = rules.reachable(rules.MOVE_TABLE, { start: t, maxCost: 1e6, mounted: false,
        hexAt: (h) => (map.height[h] === undefined ? null : { terrain: td[h], height: map.height[h] }),
        segAt: (q1, r1, q2, r2) => effSeg[rules.edgeKey(q1, r1, q2, r2)] || null }).dist;
      for (const [h, c] of d) if (!best.has(h) || c < best.get(h)) best.set(h, c);
    }
    return best;
  });
  const gates = new Set((map.decor?.props || []).filter((p) => p.type === 'porte').map((p) => `${p.q},${p.r}`));
  const ramps = new Set(map.decor?.ramparts || []);
  const zoneSet = new Set(zones.flatMap((z) => z.tiles.map((t) => `${t.q},${t.r}`)));
  const C = (k) => cost.map((m) => m.get(k) ?? Infinity);
  const sgn = (d) => (d > 2 ? 1 : d < -2 ? -1 : 0);
  const contrib = (k, pts) => { const c = C(k); return { duel: pts * sgn(c[1] - c[0]), team: pts * sgn(Math.min(c[1], c[2]) - Math.min(c[0], c[3])) }; };
  const objs = map.objectives.map((o) => ({ ...o, k: `${o.q},${o.r}` }));
  const total = () => objs.reduce((a, o) => { const x = contrib(o.k, o.points); return { duel: a.duel + x.duel, team: a.team + x.team }; }, { duel: 0, team: 0 });
  const bad = (k) => gates.has(k) || ramps.has(k) || zoneSet.has(k) || Math.min(...C(k)) < 6 || !isFinite(Math.max(...C(k)));
  const cost0 = () => { const t = total(); return Math.abs(t.duel) * 3 + Math.abs(t.team) * 2 + objs.filter((o) => bad(o.k)).length * 20; };
  const before = { ...total(), bad: objs.filter((o) => bad(o.k)).map((o) => o.name) };
  for (let pass = 0; pass < 4; pass++) {
    for (const o of objs) {
      const home = { q: o.q, r: o.r };
      let best = { k: o.k, s: cost0() + 0 };
      for (const k of Object.keys(map.height)) {
        const [q, r] = k.split(',').map(Number);
        const d = hexDistance(q, r, home.q, home.r);
        if (d > 8 || bad(k) || objs.some((x) => x !== o && x.k === k)) continue;
        const wasWater = ['river', 'bridge'].includes(td[`${home.q},${home.r}`]);
        if (td[k] === 'river' || (td[k] === 'bridge' && !wasWater) || td[k] === 'building') continue;
        const prev = o.k; o.k = k;
        const s = cost0() + d * 0.15;
        o.k = prev;
        if (s < best.s - 1e-9) best = { k, s };
      }
      o.k = best.k;
    }
  }
  const after = total();
  console.log(`== ${id}: avant 1v1 ${before.duel} / 2v2 ${before.team}, mal placés : ${before.bad.join(', ') || 'aucun'}  →  après 1v1 ${after.duel} / 2v2 ${after.team}`);
  for (const o of objs) console.log(`  ${String(o.name).padEnd(22)} ${o.q},${o.r} -> ${o.k} [${td[o.k] || 'plain'}] coûts ${C(o.k).map(Math.round).join('/')}`);
  if (write) {
    const file = `data/maps/${id}.json`;
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const o of doc.objectives) { const n = objs.find((x) => x.name === o.name && x.q === o.q && x.r === o.r); if (n) [o.q, o.r] = n.k.split(',').map(Number); }
    fs.writeFileSync(file, JSON.stringify(doc));
  }
}
