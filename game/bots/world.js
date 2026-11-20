// What a bot knows about the battle: only what its player could see (fog of war + concealment through
// room.canSee), the public map, objectives and its own units.
const UNITS = require('../data/units');
const { hexDistance, hexKey } = require('../HexUtils');

const GENERAL_VALUE = 1500;

function unitValue(u) {
  if (u.isGeneral) return GENERAL_VALUE;
  const base = UNITS[u.typeId] ? UNITS[u.typeId].cost : 600;
  return base * Math.max(0.15, u.vitality / (u.maxVitality || u.vitality || 1));
}

function nearestHex(room, q, r) {
  if (room.hexMap[hexKey(q, r)]) return { q, r };
  let best = null, bd = Infinity;
  for (const h of Object.values(room.hexMap)) {
    const d = hexDistance(h.q, h.r, q, r);
    if (d < bd) { bd = d; best = h; }
  }
  return best ? { q: best.q, r: best.r } : { q, r };
}

function centroid(units) {
  if (!units.length) return null;
  let q = 0, r = 0;
  for (const u of units) { q += u.q; r += u.r; }
  return { q: Math.round(q / units.length), r: Math.round(r / units.length) };
}

// Where the enemy may be when nothing is in sight (public information only: the map and our own zone).
// Random zones sit on a circle of radius 10 + 4 x players around a random central hex (HexUtils.getStartingZones):
// the other zones lie about one diameter away from ours, on the map. Fixed zones of the map are public.
// Result: a search route of waypoints, the most likely first (toward the map centre), then along the arc.
const routes = new Map();
const euclid = (q, r) => Math.sqrt(q * q + r * r);

function searchRoute(room, player) {
  const key = `${room.roomCode}|${room.mapId}|${player.id}|${room.players.length}`;
  if (routes.has(key)) return routes.get(key);
  const c = room.mapCenter || { q: 0, r: 0 };
  const own = player.startingZone || centroid(player.units.filter(u => u.q !== null)) || c;
  let route = [];
  const fixed = (room.map && Array.isArray(room.map.zones) ? room.map.zones : [])
    .map(z => (z.tiles || []).map(t => (typeof t === 'string' ? t.split(',').map(Number) : [t.q, t.r])))
    .filter(t => t.length)
    .map(t => ({ q: Math.round(t.reduce((s, x) => s + x[0], 0) / t.length), r: Math.round(t.reduce((s, x) => s + x[1], 0) / t.length) }))
    .filter(z => hexDistance(z.q, z.r, own.q, own.r) > 4);
  if (fixed.length) {
    route = fixed.sort((a, b) => hexDistance(a.q, a.r, own.q, own.r) - hexDistance(b.q, b.r, own.q, own.r)).map(z => nearestHex(room, z.q, z.r));
  } else {
    const diameter = 2 * (10 + 4 * Math.max(2, room.players.length));
    const sectors = new Map();
    for (const h of Object.values(room.hexMap)) {
      if (h.terrain === 'river') continue;
      const dq = h.q - own.q, dr = h.r - own.r;
      if (Math.abs(euclid(dq, dr) - diameter) > 4) continue;
      const a = Math.round(((Math.atan2(dr, dq) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 6)) % 12;
      if (!sectors.has(a)) sectors.set(a, []);
      sectors.get(a).push(h);
    }
    const points = [...sectors.entries()].sort((x, y) => x[0] - y[0]).map(([a, hs]) => {
      const m = centroid(hs);
      return { a, ...nearestHex(room, m.q, m.r) };
    });
    if (points.length) {
      const toCenter = Math.round(((Math.atan2(c.r - own.r, c.q - own.q) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 6)) % 12;
      const gap = (x) => Math.min(Math.abs(x.a - toCenter), 12 - Math.abs(x.a - toCenter));
      let i0 = 0;
      points.forEach((p, i) => { if (gap(p) < gap(points[i0])) i0 = i; });
      // from the most likely sector: sweep one way to the end of the arc, then the other way
      const fwd = points.slice(i0), back = points.slice(0, i0).reverse();
      route = [...fwd, ...back];
    }
  }
  if (!route.length) route = [nearestHex(room, c.q, c.r)];
  routes.set(key, route);
  if (routes.size > 200) routes.delete(routes.keys().next().value);
  return route;
}

function guessEnemyCenter(room, player) {
  return searchRoute(room, player)[0];
}

// Waypoint of the search route for this turn: about 1 turn per 2.5 hexes of walk, plus 2 turns on each point
function searchGoal(room, player) {
  const route = searchRoute(room, player);
  const own = player.startingZone || route[0];
  let t = 1, prev = own;
  for (let lap = 0; lap < 4; lap++) {
    for (const p of route) {
      t += Math.ceil(hexDistance(prev.q, prev.r, p.q, p.r) / 2.5) + 2;
      if (room.turn <= t) return p;
      prev = p;
    }
  }
  return route[route.length - 1];
}

function buildWorld(room, playerId) {
  const player = room.getPlayer(playerId);
  const vis = room.getVisibleHexes(playerId);
  const enemies = [];
  for (const p of room.players) {
    if (p.id === playerId || p.isEliminated) continue;
    for (const u of p.units) {
      if (u.q === null) continue;
      if (room.canSee(playerId, u, u.q, u.r, vis)) enemies.push(u);
    }
  }
  const mine = player.units.filter(u => u.q !== null);
  const height = (q, r) => room.heightData[hexKey(q, r)] || 0;
  const blocked = (k) => {
    const o = room.unitMap[k];
    return !!o && room.canSee(playerId, o, o.q, o.r, vis);
  };
  return {
    room, player, playerId, vis, enemies, mine, height, blocked,
    night: room.isNight(),
    enemyGuess: searchGoal(room, player),
    terrainAt: (q, r) => room.terrainData[hexKey(q, r)] || 'plain',
  };
}

// Same reach rule as GameRoom.initiateCombat: base range + height advantage
function inRange(world, unit, fq, fr, t) {
  const d = hexDistance(fq, fr, t.q, t.r);
  return d >= 1 && d <= (unit.range || 1) + Math.max(0, world.height(fq, fr) - world.height(t.q, t.r));
}

module.exports = { buildWorld, inRange, unitValue, guessEnemyCenter, centroid, nearestHex };
