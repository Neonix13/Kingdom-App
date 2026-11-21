// Tactical helpers of the bots: attack angles, contact hexes reachable without being stopped by a zone of control,
// enemy threats, force balance, own facing. Pure functions of the bot's world (what its player can see).
const rules = require('../rules');
const { hexDistance, hexKey, hexFacing, segmentEdgeKey } = require('../HexUtils');
const { unitValue, centroid } = require('./world');

const { RULES } = rules;
const isRanged = (u) => (u.range || 1) > 1;
const parseKey = (k) => k.split(',').map(Number);

// Angle bonus of an attack from (q, r) on target t (RULES.combat.angleMods, defender's stance and facing; 0 for generals)
function angleBonus(t, q, r) {
  if (t.isGeneral || hexDistance(q, r, t.q, t.r) !== 1) return 0;
  const dir = hexFacing(t.q, t.r, q, r);
  const off = (dir - (t.facing || 0) + 6) % 6;
  const table = RULES.combat.angleMods[t.stance] || RULES.combat.angleMods.combat;
  return table[off] || 0;
}

// Worst angle an enemy at (eq, er) could get on a unit u standing at (q, r) with a given facing and stance
function exposure(u, q, r, facing, stance, eq, er) {
  if (u.isGeneral) return 0;
  const dir = hexFacing(q, r, eq, er);
  const off = (dir - facing + 6) % 6;
  const table = RULES.combat.angleMods[stance] || RULES.combat.angleMods.combat;
  return table[off] || 0;
}

// Reach of a melee unit when every hex next to a visible enemy (not already next to it) is a stop: the unit can only
// end its move there. Returns contact candidates { key, q, r, cost, path, adj: [enemy] } and the free reach.
function contactReach(world, u, budget) {
  const room = world.room;
  const start = hexKey(u.q, u.r);
  const already = new Set(world.enemies.filter(e => hexDistance(e.q, e.r, u.q, u.r) <= 1).map(e => e.id));
  const stopAt = new Map();
  for (const e of world.enemies) {
    if (already.has(e.id)) continue;
    for (const [dq, dr] of rules.DIRS) {
      const k = hexKey(e.q + dq, e.r + dr);
      if (!stopAt.has(k)) stopAt.set(k, []);
      stopAt.get(k).push(e);
    }
  }
  const mounted = rules.isMounted(u);
  const table = room.moveTable();
  const hexAt = (k) => room.hexMap[k] || null;
  const segAt = (a, b, c, d) => room.segmentData[segmentEdgeKey(a, b, c, d)] || null;
  if (!(budget > 0)) return { contacts: [], free: new Map([[start, 0]]), prev: new Map() };
  const { dist, prev } = rules.reachable(table, {
    start: { q: u.q, r: u.r }, maxCost: budget, minStep: rules.hasFullSpeed(u) && budget === u.speedRemaining, mounted,
    hexAt, segAt, blocked: (k) => world.blocked(k) || stopAt.has(k),
  });
  // contact hexes: one step from the free reach
  const contacts = new Map();
  for (const [k, c] of dist) {
    const [q, r] = parseKey(k);
    for (const [dq, dr] of rules.DIRS) {
      const nq = q + dq, nr = r + dr, nk = hexKey(nq, nr);
      if (!stopAt.has(nk) || world.blocked(nk)) continue;
      const there = hexAt(nk);
      if (!there) continue;
      const step = rules.stepCost(table, hexAt(k), there, segAt(q, r, nq, nr), mounted);
      if (!isFinite(step)) continue;
      const cost = rules.snap(c + step);
      const minStep = k === start && rules.hasFullSpeed(u) && budget === u.speedRemaining;
      if (cost > budget + 1e-9 && !minStep) continue;
      const old = contacts.get(nk);
      if (!old || cost < old.cost) contacts.set(nk, { key: nk, q: nq, r: nr, cost, from: k, adj: stopAt.get(nk) });
    }
  }
  const out = [];
  for (const c of contacts.values()) {
    const head = c.from === start ? [] : rules.pathFromPrev(prev, start, c.from);
    if (head == null) continue;
    out.push({ ...c, path: [...head, [c.q, c.r]] });
  }
  return { contacts: out, free: dist, prev };
}

// Melee threat on hex (q, r): enemy melee units able to reach it next turn, with their value
function meleeThreat(world, q, r) {
  let n = 0, v = 0, cavalry = 0;
  for (const e of world.enemies) {
    if (isRanged(e) || e.isFleeing) continue;
    const reach = (e.speed || 3) + 1;
    if (hexDistance(e.q, e.r, q, r) <= reach) {
      n++; v += unitValue(e);
      if (e.category === 'Chevaux' || e.category === 'Chars') cavalry++;
    }
  }
  return { n, v, cavalry };
}

// Shooters able to hit (q, r) next turn (range + a step)
function rangedThreat(world, q, r) {
  let n = 0;
  for (const e of world.enemies) {
    if (!isRanged(e) || e.isFleeing) continue;
    if (hexDistance(e.q, e.r, q, r) <= (e.range || 1) + Math.min(2, e.speed || 3)) n++;
  }
  return n;
}

// Our army value against what we know of the enemy (visible units + recent sightings): > 1 = we are stronger
function globalBalance(world) {
  const mine = world.mine.reduce((s, u) => s + unitValue(u), 0);
  let theirs = 0;
  const seen = new Set();
  for (const e of world.enemies) { theirs += unitValue(e); seen.add(e.id); }
  for (const e of world.memory.enemies.values()) if (!seen.has(e.id)) theirs += e.value || 600;
  return theirs ? mine / theirs : Infinity;
}

// Facing toward the main threat (nearest enemies weighted by value), or null when none
function threatFacing(world, u, q = u.q, r = u.r) {
  let best = null, bs = -Infinity;
  for (const e of world.enemies) {
    const d = hexDistance(q, r, e.q, e.r);
    if (d === 0 || d > 8) continue;
    const s = unitValue(e) / (d * d);
    if (s > bs) { bs = s; best = e; }
  }
  return best ? hexFacing(q, r, best.q, best.r) : null;
}

// Highest exposure of u at (q, r) with the given facing/stance to visible enemies that can reach it soon
function worstExposure(world, u, q, r, facing, stance) {
  let worst = 0;
  for (const e of world.enemies) {
    if (e.isFleeing) continue;
    const reach = isRanged(e) ? 0 : (e.speed || 3) + 1;
    if (!reach || hexDistance(e.q, e.r, q, r) > reach) continue;
    worst = Math.max(worst, exposure(u, q, r, facing, stance, e.q, e.r));
  }
  return worst;
}

const enemyCentroid = (world) => centroid(world.enemies) || centroid([...world.memory.enemies.values()]) || world.enemyGuess;

module.exports = { angleBonus, exposure, contactReach, meleeThreat, rangedThreat, globalBalance, threatFacing, worstExposure, enemyCentroid, isRanged };
