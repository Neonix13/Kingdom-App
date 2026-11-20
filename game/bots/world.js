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

// Where the enemy probably is when nothing is in sight: across the map centre from our own deployment zone
function guessEnemyCenter(room, player) {
  const c = room.mapCenter || { q: 0, r: 0 };
  const own = player.startingZone || centroid(player.units.filter(u => u.q !== null)) || c;
  const q = 2 * c.q - own.q, r = 2 * c.r - own.r;
  if (hexDistance(q, r, own.q, own.r) < 6) return nearestHex(room, c.q, c.r);
  return nearestHex(room, q, r);
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
    enemyGuess: guessEnemyCenter(room, player),
    terrainAt: (q, r) => room.terrainData[hexKey(q, r)] || 'plain',
  };
}

// Same reach rule as GameRoom.initiateCombat: base range + height advantage
function inRange(world, unit, fq, fr, t) {
  const d = hexDistance(fq, fr, t.q, t.r);
  return d >= 1 && d <= (unit.range || 1) + Math.max(0, world.height(fq, fr) - world.height(t.q, t.r));
}

module.exports = { buildWorld, inRange, unitValue, guessEnemyCenter, centroid, nearestHex };
