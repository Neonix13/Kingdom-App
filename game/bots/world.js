// What a bot knows about the battle: only what its player could see (fog of war + concealment through
// room.canSee), the public map, objectives and its own units.
const UNITS = require('../data/units');
const { hexDistance, hexKey } = require('../HexUtils');
const rules = require('../rules');

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

// Memory of a bot player (process cache, like the search routes: a lambda cold start only forgets it).
// enemies: last sighting of each enemy unit, forgotten when its hex is seen empty (cover hexes: only from up close)
// or after MEMORY_TURNS; seen: last turn each hex was in sight; explore: current exploration target.
const MEMORY_TURNS = 12;
const EXPLORE_TURNS = 14;
const memories = new Map();

function memoryFor(room, player) {
  const zone = player.startingZone && player.startingZone.tiles && player.startingZone.tiles[0];
  const key = `${room.roomCode}|${room.mapId}|${player.id}|${player.generalId}|${zone ? `${zone.q},${zone.r}` : ''}`;
  let m = memories.get(key);
  if (!m || room.turn < m.turn) {
    m = { turn: room.turn, enemies: new Map(), seen: new Map(), explore: null };
    memories.set(key, m);
    if (memories.size > 200) memories.delete(memories.keys().next().value);
  }
  return m;
}

function observe(room, player, m, vis, enemies, mine) {
  const turn = room.turn;
  m.turn = turn;
  for (const k of vis) m.seen.set(k, turn);
  const visibleIds = new Set();
  for (const e of enemies) {
    visibleIds.add(e.id);
    m.enemies.set(e.id, { id: e.id, q: e.q, r: e.r, turn, isGeneral: !!e.isGeneral, playerId: e.playerId, value: unitValue(e) });
  }
  const close = (q, r) => mine.some(u => hexDistance(u.q, u.r, q, r) <= 1);
  for (const [id, e] of m.enemies) {
    if (visibleIds.has(id)) continue;
    const owner = room.getPlayer(e.playerId);
    const gone = !owner || owner.isEliminated || turn - e.turn > MEMORY_TURNS;
    const k = hexKey(e.q, e.r);
    if (gone || (vis.has(k) && (!room._inCover(e.q, e.r) || close(e.q, e.r)))) m.enemies.delete(id);
  }
}

// Where to look for the enemy when none is in sight: the freshest sighting (the general first), else the first
// unexplored point of the search route, else the hex of a coarse grid unseen for the longest time near the army
function huntGoal(room, player, m, mine) {
  const c = centroid(mine.filter(u => !u.isGeneral)) || centroid(mine) || room.mapCenter || { q: 0, r: 0 };
  const remembered = [...m.enemies.values()];
  if (remembered.length) {
    const best = remembered.sort((a, b) => (b.turn - a.turn) || (b.isGeneral - a.isGeneral)
      || hexDistance(a.q, a.r, c.q, c.r) - hexDistance(b.q, b.r, c.q, c.r))[0];
    return { q: best.q, r: best.r, remembered: true };
  }
  const turn = room.turn;
  const t = m.explore;
  const reached = t && (m.seen.get(hexKey(t.q, t.r)) === turn || hexDistance(t.q, t.r, c.q, c.r) <= 1 || turn - t.since > EXPLORE_TURNS);
  if (t && !reached) return t;
  if (t) m.seen.set(hexKey(t.q, t.r), turn);
  let next = searchRoute(room, player).find(p => !m.seen.has(hexKey(p.q, p.r)));
  if (!next) {
    let bs = -Infinity;
    for (const h of Object.values(room.hexMap)) {
      if (h.q % 3 || h.r % 3 || h.terrain === 'river') continue;
      const seen = m.seen.get(hexKey(h.q, h.r));
      const stale = Math.min(40, seen == null ? turn + 10 : turn - seen);
      const s = stale - hexDistance(h.q, h.r, c.q, c.r) * 0.5;
      if (s > bs) { bs = s; next = { q: h.q, r: h.r }; }
    }
  }
  m.explore = next ? { q: next.q, r: next.r, since: turn } : null;
  return m.explore || searchGoal(room, player);
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
    if (p.id === playerId || p.isEliminated || room.areAllies(playerId, p.id)) continue;
    for (const u of p.units) {
      if (u.q === null) continue;
      if (room.canSee(playerId, u, u.q, u.r, vis)) enemies.push(u);
    }
  }
  const mine = player.units.filter(u => u.q !== null);
  const memory = memoryFor(room, player);
  observe(room, player, memory, vis, enemies, mine);
  const height = (q, r) => room.heightData[hexKey(q, r)] || 0;
  const blocked = (k) => {
    const o = room.unitMap[k];
    return !!o && room.canSee(playerId, o, o.q, o.r, vis);
  };
  return {
    room, player, playerId, vis, enemies, mine, height, blocked, memory,
    night: room.isNight(),
    enemyGuess: huntGoal(room, player, memory, mine),
    terrainAt: (q, r) => room.terrainData[hexKey(q, r)] || 'plain',
  };
}

const hasArmy = (world) => world.mine.some(u => !u.isGeneral);
const knownTroops = (world) => [...world.memory.enemies.values()].filter(e => !e.isGeneral).length;

// A general left without an army hunts when it only knows of enemy generals (a duel settles the battle)
function loneGeneralGoal(world) {
  if (hasArmy(world) || knownTroops(world)) return null;
  return world.enemyGuess;
}

// A general left alone against an army it has seen gives up (bots only)
function hopeless(world) {
  return !hasArmy(world) && knownTroops(world) >= 2;
}

// Same reach rule as GameRoom.initiateCombat (rules.attackRange: ± height difference, at least 1)
function inRange(world, unit, fq, fr, t) {
  const d = hexDistance(fq, fr, t.q, t.r);
  return d >= 1 && d <= rules.attackRange(unit.range, world.height(fq, fr), world.height(t.q, t.r));
}

module.exports = { buildWorld, inRange, unitValue, guessEnemyCenter, centroid, nearestHex, loneGeneralGoal, hopeless };
