// Bots in the simultaneous mode (game/turns/simultaneous.js, docs/mode-simultane.md): each planning phase a bot
// sends its whole order set (set_orders, replace) then validates it (commit_orders). Orders come from the same
// evaluation as the sequential planner (targets, terrain, objectives, cohesion), limited to the command points.
const GENERALS = require('../data/generals');
const rules = require('../rules');
const { hexDistance, hexKey } = require('../HexUtils');
const { buildWorld, inRange, centroid } = require('./world');
const B = require('./battle');
const { rngFor, pick } = require('./rng');

function pathTo(prev, u, q, r) {
  return rules.pathFromPrev(prev, hexKey(u.q, u.r), hexKey(q, r));
}

// { [unitId]: order } for this turn
function planOrders(room, playerId, profile) {
  const world = buildWorld(room, playerId);
  if (!world.player || world.player.isEliminated) return {};
  const max = room.turns.commandPoints ? room.turns.commandPoints(room, playerId) : 99;
  const objectives = B.assignObjectives(world, profile);
  const ability = B.abilityStep(world, profile);
  const cands = [];
  for (const u of world.mine) {
    if (u.isFleeing) continue;
    const rng = rngFor(room.roomCode, room.turn, 'sim', u.id);
    const roll = rng();
    const blunder = roll < profile.mistake;
    if (blunder && roll < profile.mistake * 0.4) continue;
    const { dist: reach, prev } = B.reachFrom(world, u, true);
    if (u.isGeneral) {
      const gd = GENERALS.find(g => g.id === u.generalId);
      const radius = Math.floor(((gd && gd.charisma) || 10) / 5);
      const near = world.mine.filter(m => !m.isGeneral && hexDistance(m.q, m.r, u.q, u.r) <= radius);
      const abilityOrder = ability ? { ability: ability.data.targetId ? { targetId: ability.data.targetId } : {} } : {};
      if (rng() < profile.motivate && (near.some(m => m.isFleeing) || near.filter(m => m.morale < m.maxMorale * 0.5).length >= 2)) {
        cands.push({ unitId: u.id, prio: 80, order: { type: 'motivate', ...abilityOrder } });
        continue;
      }
      const troops = world.mine.filter(m => !m.isGeneral);
      const c = centroid(troops);
      const keep = profile.caution + 1;
      const tooClose = world.enemies.some(e => hexDistance(e.q, e.r, u.q, u.r) < keep);
      if (c && reach.size && (hexDistance(u.q, u.r, c.q, c.r) > 3 || tooClose)) {
        let best = null, bs = -Infinity;
        for (const [k] of reach) {
          const [q, r] = k.split(',').map(Number);
          const d = world.enemies.length ? Math.min(...world.enemies.map(e => hexDistance(q, r, e.q, e.r))) : Infinity;
          const s = -hexDistance(q, r, c.q, c.r) * 1.5 - (d < keep ? (keep - d) * 6 : 0);
          if (s > bs) { bs = s; best = { q, r }; }
        }
        const path = best && pathTo(prev, u, best.q, best.r);
        if (path && path.length) { cands.push({ unitId: u.id, prio: ability ? 75 : 15, order: { type: 'move', path, ...abilityOrder } }); continue; }
      }
      if (ability) cands.push({ unitId: u.id, prio: 75, order: { type: 'hold', ...abilityOrder } });
      continue;
    }
    // Strike: a visible target within reach this turn (shooters fire, melee units close in)
    const strikeReach = (u.speedRemaining || 0) + (u.range || 1);
    const targets = world.enemies.filter(t => hexDistance(u.q, u.r, t.q, t.r) <= strikeReach || inRange(world, u, u.q, u.r, t));
    if (targets.length && (!profile.hold || targets.some(t => hexDistance(u.q, u.r, t.q, t.r) <= (profile.engageRadius || 0) + (u.range || 1)))) {
      const t = blunder ? pick(rng, targets)
        : targets.slice().sort((a, b) => B.targetScore(world, profile, u, b, u.q, u.r) - B.targetScore(world, profile, u, a, u.q, u.r))[0];
      const d = hexDistance(u.q, u.r, t.q, t.r);
      const charge = !B.isRanged(u) && d >= 2 && (u.category === 'Chevaux' || u.category === 'Chars');
      const order = { type: charge ? 'charge' : 'attack', targetId: t.id };
      const st = B.attackStance(u);
      if (st && st !== u.stance && rng() < profile.stance && (B.isRanged(u) || d <= 1)) order.stance = st;
      cands.push({ unitId: u.id, prio: 100 + B.targetScore(world, profile, u, t, u.q, u.r), order });
      continue;
    }
    if (profile.hold || !reach.size) continue;
    const objective = objectives.get(u.id);
    if (objective && objective.q === u.q && objective.r === u.r) continue;
    const goal = objective || (blunder ? world.enemyGuess : B.armyGoal(world));
    const dest = B.approachDest(world, profile, u, reach, goal, null);
    const path = dest && pathTo(prev, u, dest.q, dest.r);
    if (path && path.length) {
      const order = { type: 'move', path };
      cands.push({ unitId: u.id, prio: objective ? 60 : 20 + hexDistance(u.q, u.r, goal.q, goal.r) * 0.1, order });
    }
  }
  cands.sort((a, b) => b.prio - a.prio);
  const out = {};
  for (const c of cands.slice(0, max)) out[c.unitId] = c.order;
  return out;
}

// Next protocol step of a bot in a simultaneous battle: send the orders, then validate them
function planStep(room, bot, profile) {
  const sim = room.sim;
  if (sim && sim.committed && sim.committed[bot.id]) return null;
  if (!sim || !sim.orders || sim.orders[bot.id] === undefined) {
    return { action: 'set_orders', data: { orders: planOrders(room, bot.id, profile), replace: true } };
  }
  return { action: 'commit_orders', data: { turn: room.turn } };
}

module.exports = { planStep, planOrders };
