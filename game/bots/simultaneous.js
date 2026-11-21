// Bots in the simultaneous mode (game/turns/simultaneous.js, docs/mode-simultane.md): each planning phase a bot
// sends its whole order set (set_orders, replace) then validates it (commit_orders).
// Planning: every melee unit lists the contact hexes it can reach this turn without being stopped by a zone of control,
// with the expected exchange (angle of attack, charge, the defender's automatic answer); strikes are then assigned
// greedily so that units gang up on the same targets. Units that do not strike hold in a sensible stance facing the
// threat, broken units fall back, shooters keep behind the line, the general stays behind his troops.
// The tactical depth scales with profile.tactics (0..1); command points cap the number of orders.
const GENERALS = require('../data/generals');
const rules = require('../rules');

const { RULES } = rules;
const { hexDistance, hexKey, hexFacing } = require('../HexUtils');
const { buildWorld, inRange, centroid, loneGeneralGoal, unitValue } = require('./world');
const B = require('./battle');
const T = require('./tactics');
const Strat = require('./strategy');
const { rngFor, pick } = require('./rng');
const { distanceField } = require('./pathing');

const S = RULES.simultaneous;
const parseKey = (k) => k.split(',').map(Number);

function pathTo(prev, u, q, r) {
  return rules.pathFromPrev(prev, hexKey(u.q, u.r), hexKey(q, r));
}

// Automatic answer of a defender in the simultaneous mode (its stance)
function response(t) {
  if (t.isGeneral) return 'counter';
  return S.stanceReaction[t.stance] || 'counter';
}

const isLancer = (room, u) => { const ab = room.ability(u); return !!ab && ab.type === 'anti_cavalry'; };
const isMountedCat = (u) => u.category === 'Chevaux' || u.category === 'Chars';

// Best hex of reach from which a shooter has a target in range, away from enemy melee units, behind its own line
function firingSpot(world, profile, u, reach, targets) {
  let best = null;
  const tactics = profile.tactics || 0;
  for (const [k, cost] of reach) {
    const [q, r] = parseKey(k);
    if (world.enemies.some(e => !B.isRanged(e) && hexDistance(q, r, e.q, e.r) <= 1)) continue;
    const ts = targets.filter(t => inRange(world, u, q, r, t));
    if (!ts.length) continue;
    const threat = T.meleeThreat(world, q, r);
    const screened = world.mine.some(m => m !== u && !B.isRanged(m) && !m.isGeneral
      && ts.some(t => hexDistance(m.q, m.r, t.q, t.r) < hexDistance(q, r, t.q, t.r)));
    const s = Math.max(...ts.map(t => B.targetScore(world, profile, u, t, q, r))) - cost * 0.5
      - threat.n * 8 * profile.focus + (screened ? 6 * tactics : 0) + world.height(q, r) * tactics;
    if (!best || s > best.s) best = { q, r, s };
  }
  return best;
}

// Expected exchange when u strikes e from contact hex (q, r) after a run of `run` hexes
function exchange(world, profile, u, e, q, r, run) {
  const room = world.room;
  const charge = !u.isGeneral && !B.isRanged(u) && run >= RULES.simultaneous.charge.minHexes && e.stance !== 'defense_combat';
  const C = RULES.simultaneous.charge;
  const vsLancer = e.typeId === RULES.simultaneous.antiCharge.lancierTypeId;
  const extra = charge ? (vsLancer ? { attack: -RULES.simultaneous.antiCharge.attackMalus, power: 0 } : { attack: C.attack, power: C.power }) : null;
  const useCharge = charge && !vsLancer;
  const dealt = B.strike(world, { ...u, q, r }, e, q, r, useCharge ? extra : null);
  let taken = 0;
  const ans = response(e);
  if (ans !== 'rien') {
    const back = B.strike(world, e, { ...u, q, r, stance: u.stance, facing: hexFacing(q, r, e.q, e.r) }, e.q, e.r);
    taken = back.expected * (ans === 'absorb' ? 0.5 : 1);
  }
  const dealtFrac = Math.min(1.2, dealt.expected / Math.max(1, e.vitality));
  const takenFrac = Math.min(1.2, taken / Math.max(1, u.vitality));
  const valueRatio = unitValue(e) / Math.max(1, unitValue(u));
  let score = 40 * dealtFrac * Math.min(2, valueRatio) - 40 * takenFrac * (0.4 + 0.6 * (profile.tactics || 0));
  score += profile.focus * ((dealt.kill ? 35 * dealt.pHit : 0) + (e.isGeneral ? 40 : 0) + (1 - e.vitality / (e.maxVitality || 1)) * 20);
  return { score, dealt: dealt.expected, taken, charge: useCharge, kill: dealt.kill };
}

// { [unitId]: order } for this turn
function planOrders(room, playerId, profile) {
  const world = buildWorld(room, playerId);
  if (!world.player || world.player.isEliminated) return {};
  const max = room.turns.commandPoints ? room.turns.commandPoints(room, playerId) : 99;
  const tactics = profile.tactics || 0;
  const objectives = Strat.assignments(world, profile);
  const ability = B.abilityStep(world, profile);
  const balance = T.globalBalance(world);
  const defensive = profile.holdIfWeaker && world.enemies.length > 0 && balance < 0.8;
  const cands = [];
  const decided = new Set();
  const troops = world.mine.filter(m => !m.isGeneral);
  const enemyC = T.enemyCentroid(world);

  // ---------- strikes (melee units), assigned greedily so that units gang up ----------
  const strikeOpts = [];
  const unitRng = new Map();
  for (const u of world.mine) {
    const rng = rngFor(room.roomCode, room.turn, 'sim', u.id);
    const roll = rng();
    unitRng.set(u.id, { rng, roll, blunder: roll < profile.mistake });
  }
  for (const u of troops) {
    if (u.isFleeing || B.isRanged(u) || profile.hold) continue;
    const { blunder, roll } = unitRng.get(u.id);
    if (blunder && roll < profile.mistake * 0.4) continue;
    const opts = [];
    const asg = objectives.get(u.id);
    const tether = asg && (asg.hold || asg.kind === 'scout' || asg.kind === 'sabotage') ? asg : null;
    // already in contact: strike without moving
    for (const e of world.enemies) {
      if (hexDistance(u.q, u.r, e.q, e.r) !== 1 || e.isFleeing && tactics < 0.5) continue;
      opts.push({ e, q: u.q, r: u.r, path: null, run: 0 });
    }
    if ((tactics > 0 || !opts.length) && !(tether && tether.kind !== 'objective' && tether.kind !== 'post')) {
      const { contacts } = T.contactReach(world, u, u.speedRemaining || 0);
      for (const c of contacts) {
        // units holding a post or an objective only strike next to it
        if (tether && hexDistance(c.q, c.r, tether.q, tether.r) > 1) continue;
        for (const e of c.adj) opts.push({ e, q: c.q, r: c.r, path: c.path, run: c.path.length });
      }
    }
    for (const o of opts) {
      const x = exchange(world, profile, u, o.e, o.q, o.r, o.run);
      // other enemies next to the contact hex hit back too
      const others = world.enemies.filter(f => f !== o.e && !f.isFleeing && !B.isRanged(f) && hexDistance(f.q, f.r, o.q, o.r) <= 1).length;
      const te = B.terrainScore(world, o.q, o.r);
      let s = x.score - others * 12 * (0.5 + tactics) + te * profile.terrain * 0.8 - (o.path ? o.path.length * 0.3 : 0);
      if (blunder) s += (unitRng.get(u.id).rng() - 0.5) * 60;
      strikeOpts.push({ u, ...o, x, s });
    }
  }
  // greedy assignment: best exchanges first; a target already struck gets a bonus (local superiority) until it is
  // expected to die, then later strikes on it lose their value
  const assigned = new Map(); // enemyId -> expected damage
  const usedHex = new Set();
  strikeOpts.sort((a, b) => b.s - a.s);
  const remaining = strikeOpts.slice();
  while (remaining.length) {
    let bi = -1, bs = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const o = remaining[i];
      if (decided.has(o.u.id) || usedHex.has(hexKey(o.q, o.r)) && o.path) continue;
      const already = assigned.get(o.e.id) || 0;
      let s = o.s;
      if (already > 0) s += already >= o.e.vitality * 1.1 ? -45 : 18 * tactics;
      if (s > bs) { bs = s; bi = i; }
    }
    if (bi < 0) break;
    const o = remaining.splice(bi, 1)[0];
    const inContact = !o.path;
    const threshold = defensive ? (inContact ? -10 : 18) : (inContact ? -20 : 4 - 10 * tactics);
    if (bs < threshold) continue;
    decided.add(o.u.id);
    if (o.path) usedHex.add(hexKey(o.q, o.r));
    assigned.set(o.e.id, (assigned.get(o.e.id) || 0) + o.x.dealt);
    const order = { type: o.x.charge && o.path ? 'charge' : 'attack', targetId: o.e.id };
    if (o.path && o.path.length) order.path = o.path;
    // in contact without a fighting stance: take one when there is speed for it (the strike itself needs none)
    const { rng } = unitRng.get(o.u.id);
    if (!o.path && (o.u.stance === 'repos' || o.u.stance === 'marche') && o.u.speedRemaining > 0 && rng() < profile.stance) order.stance = 'combat';
    cands.push({ unitId: o.u.id, prio: 100 + bs, order });
  }

  for (const u of world.mine) {
    if (u.isFleeing || decided.has(u.id)) continue;
    const { rng, roll, blunder } = unitRng.get(u.id);
    if (blunder && roll < profile.mistake * 0.4) continue;
    const { dist: reach, prev } = B.reachFrom(world, u, true);

    // ---------- general ----------
    if (u.isGeneral) {
      const gd = GENERALS.find(g => g.id === u.generalId);
      const radius = Math.floor(((gd && gd.charisma) || 10) / 5);
      const near = world.mine.filter(m => !m.isGeneral && hexDistance(m.q, m.r, u.q, u.r) <= radius);
      const abilityOrder = ability ? { ability: ability.data.targetId ? { targetId: ability.data.targetId } : {} } : {};
      if (rng() < profile.motivate && (near.some(m => m.isFleeing) || near.filter(m => m.morale < m.maxMorale * 0.5).length >= 2)) {
        cands.push({ unitId: u.id, prio: 80, order: { type: 'motivate', ...abilityOrder } });
        continue;
      }
      const foes = world.enemies.filter(t => hexDistance(u.q, u.r, t.q, t.r) <= (u.speedRemaining || 0) + 1 && !t.isFleeing || inRange(world, u, u.q, u.r, t));
      const fair = foes.filter(t => (t.isGeneral
        ? blunder || profile.caution === 0 || u.force >= t.force - (profile.focus >= 1 ? 1 : 2)
        : profile.caution <= 1 || t.vitality < t.maxVitality * 0.35 || t.isFleeing || !troops.length));
      if (fair.length && !profile.hold) {
        const t = fair.slice().sort((a, b) => B.targetScore(world, profile, u, b, u.q, u.r) - B.targetScore(world, profile, u, a, u.q, u.r))[0];
        cands.push({ unitId: u.id, prio: 95, order: { type: 'attack', targetId: t.id, ...abilityOrder } });
        continue;
      }
      const hunt = !profile.hold && loneGeneralGoal(world);
      if (hunt && reach.size) {
        const dest = B.approachDest(world, profile, u, reach, hunt, null);
        const path = dest && pathTo(prev, u, dest.q, dest.r);
        if (path && path.length) { cands.push({ unitId: u.id, prio: 70, order: { type: 'move', path, ...abilityOrder } }); continue; }
      }
      const c = centroid(troops);
      const keep = profile.caution + 1;
      // behind the troops: the army centre pushed away from the enemy, out of reach of enemy melee and shooters
      let anchor = c;
      if (c && enemyC && tactics > 0) {
        const dq = c.q - enemyC.q, dr = c.r - enemyC.r;
        const len = Math.max(1, hexDistance(c.q, c.r, enemyC.q, enemyC.r));
        anchor = { q: Math.round(c.q + dq / len * 2), r: Math.round(c.r + dr / len * 2) };
      }
      const exposed = (q, r) => world.enemies.some(e => hexDistance(e.q, e.r, q, r) < keep)
        || (tactics > 0 && T.rangedThreat(world, q, r) > 0);
      if (anchor && reach.size && (hexDistance(u.q, u.r, anchor.q, anchor.r) > 2 || exposed(u.q, u.r))) {
        let best = null, bs = -Infinity;
        for (const [k] of reach) {
          const [q, r] = parseKey(k);
          const d = world.enemies.length ? Math.min(...world.enemies.map(e => hexDistance(q, r, e.q, e.r))) : Infinity;
          const s = -hexDistance(q, r, anchor.q, anchor.r) * 1.5 - (d < keep ? (keep - d) * 6 : 0)
            - T.rangedThreat(world, q, r) * 8 * tactics - (T.meleeThreat(world, q, r).n * 3 + T.meleeThreat(world, q, r).cavalry * 6) * tactics;
          if (s > bs) { bs = s; best = { q, r }; }
        }
        const path = best && pathTo(prev, u, best.q, best.r);
        if (path && path.length) { cands.push({ unitId: u.id, prio: ability ? 75 : exposed(u.q, u.r) ? 72 : 15, order: { type: 'move', path, ...abilityOrder } }); continue; }
      }
      if (ability) cands.push({ unitId: u.id, prio: 75, order: { type: 'hold', ...abilityOrder } });
      continue;
    }

    // ---------- unit abilities ----------
    const asg = objectives.get(u.id);
    const sab = !blunder && Strat.sabotageTarget(world, u, asg);
    const sabAb = sab && room.ability(u);
    if (sab && sabAb && (u.speedRemaining || 0) >= sabAb.cost) {
      cands.push({ unitId: u.id, prio: 65, order: { type: 'hold', unitAbility: { kind: 'sabotage', q: sab.q, r: sab.r } } });
      continue;
    }
    const ua = blunder ? null : B.unitAbilityPlan(world, u, asg);
    if (ua) {
      const unitAbility = ua.kind === 'build' ? { kind: 'build', build: ua.build, q: ua.q, r: ua.r } : { kind: 'vanish' };
      cands.push({ unitId: u.id, prio: 60, order: { type: 'hold', unitAbility } });
      continue;
    }

    // ---------- broken units fall back ----------
    const broken = u.morale < u.maxMorale * 0.3 || u.vitality < u.maxVitality * 0.25;
    if (broken && tactics > 0 && world.enemies.some(e => hexDistance(e.q, e.r, u.q, u.r) <= 6) && reach.size) {
      const gen = world.mine.find(m => m.isGeneral);
      let best = null, bs = -Infinity;
      for (const [k] of reach) {
        const [q, r] = parseKey(k);
        const d = Math.min(...world.enemies.map(e => hexDistance(q, r, e.q, e.r)));
        const s = Math.min(d, 6) * 3 - (gen ? hexDistance(q, r, gen.q, gen.r) * 0.8 : 0) - T.meleeThreat(world, q, r).n * 4;
        if (s > bs) { bs = s; best = { q, r }; }
      }
      const path = best && pathTo(prev, u, best.q, best.r);
      if (path && path.length) { cands.push({ unitId: u.id, prio: 85, order: { type: 'move', path } }); continue; }
    }

    // ---------- shooters ----------
    const strikeReach = (u.speedRemaining || 0) + (u.range || 1);
    // shooters posted on a wall walk: get there, then shoot from it (or wait in ranged defence)
    if (B.isRanged(u) && asg && asg.kind === 'post') {
      if (u.q === asg.q && u.r === asg.r) {
        const ts = world.enemies.filter(t => inRange(world, u, u.q, u.r, t));
        if (ts.length) {
          const t = ts.slice().sort((a, b) => B.targetScore(world, profile, u, b, u.q, u.r) - B.targetScore(world, profile, u, a, u.q, u.r))[0];
          cands.push({ unitId: u.id, prio: 100 + B.targetScore(world, profile, u, t, u.q, u.r), order: { type: 'attack', targetId: t.id } });
        } else if (u.stance !== 'defense_distance' && u.speedRemaining > 0) cands.push({ unitId: u.id, prio: 45, order: { type: 'hold', stance: 'defense_distance' } });
        continue;
      }
      const dest = reach.size ? B.approachDest(world, profile, u, reach, asg, null) : null;
      const path = dest && pathTo(prev, u, dest.q, dest.r);
      if (path && path.length) { cands.push({ unitId: u.id, prio: 70, order: { type: 'move', path } }); continue; }
    }
    if (B.isRanged(u)) {
      let targets = world.enemies.filter(t => hexDistance(u.q, u.r, t.q, t.r) <= strikeReach || inRange(world, u, u.q, u.r, t));
      const allowed = targets.length && (!profile.hold || targets.some(t => hexDistance(u.q, u.r, t.q, t.r) <= (profile.engageRadius || 0) + (u.range || 1)));
      const inContact = world.enemies.some(e => !B.isRanged(e) && hexDistance(e.q, e.r, u.q, u.r) === 1);
      // out of range, or caught in melee: walk to a firing position first
      if (allowed && (inContact && profile.retreatRanged || !targets.some(t => inRange(world, u, u.q, u.r, t))) && reach.size) {
        const spot = firingSpot(world, profile, u, reach, targets);
        const path = spot && pathTo(prev, u, spot.q, spot.r);
        if (path && path.length) {
          cands.push({ unitId: u.id, prio: 90 + spot.s * 0.1, order: { type: 'move', path } });
          continue;
        }
      }
      targets = targets.filter(t => inRange(world, u, u.q, u.r, t));
      if (targets.length && allowed) {
        const t = blunder ? pick(rng, targets)
          : targets.slice().sort((a, b) => B.targetScore(world, profile, u, b, u.q, u.r) - B.targetScore(world, profile, u, a, u.q, u.r))[0];
        const order = { type: 'attack', targetId: t.id };
        const st = B.attackStance(u);
        if (st && st !== u.stance && u.speedRemaining > 0 && rng() < profile.stance) order.stance = st;
        cands.push({ unitId: u.id, prio: 100 + B.targetScore(world, profile, u, t, u.q, u.r), order });
        continue;
      }
      // nothing to shoot: wait for the enemy in ranged defence (reaction fire) when it is coming
      const close = world.enemies.length && Math.min(...world.enemies.map(e => hexDistance(e.q, e.r, u.q, u.r))) <= 7;
      if (close && tactics > 0 && u.stance !== 'defense_distance' && u.speedRemaining > 0 && rng() < profile.stance) {
        cands.push({ unitId: u.id, prio: 45, order: { type: 'hold', stance: 'defense_distance' } });
        continue;
      }
      if (close && tactics > 0) continue;
    }

    if (profile.hold) continue;

    // ---------- melee units without a strike: hold the line or advance with the army ----------
    const threat = T.meleeThreat(world, u.q, u.r);
    const nearest = world.enemies.length ? Math.min(...world.enemies.map(e => hexDistance(e.q, e.r, u.q, u.r))) : Infinity;
    const objective = objectives.get(u.id);
    if (objective && objective.q === u.q && objective.r === u.r && objective.hold !== false && objective.kind !== 'scout' && objective.kind !== 'flank') {
      const hold = holdOrder(world, profile, u, rng, threat, objective.stance);
      if (hold) cands.push({ unitId: u.id, prio: 55, order: hold });
      continue;
    }
    // the enemy can reach us next turn and we did not find a good strike: brace (stance + facing) instead of walking
    // into its charge, unless an objective calls
    if (!objective && tactics > 0 && !B.isRanged(u) && threat.n > 0 && (defensive || nearest <= 3)) {
      const hold = holdOrder(world, profile, u, rng, threat);
      if (hold) cands.push({ unitId: u.id, prio: 58, order: hold });
      continue;
    }
    const goal = objective || (blunder ? world.enemyGuess : B.armyGoal(world));
    if (!goal) continue;
    const prio = objective ? (objective.kind === 'post' ? 66 : 60) : 20 + hexDistance(u.q, u.r, goal.q, goal.r) * 0.1;
    // Long walk with no enemy in sight: march stance (the change costs this turn's speed, the stance pays back)
    if (!world.enemies.length && u.stance && u.stance !== 'marche' && u.speedRemaining > 0 && hexDistance(u.q, u.r, goal.q, goal.r) > 6 && rng() < profile.stance) {
      const slow = { ...u, speedRemaining: (u.speedRemaining || 0) - S.stanceCost };
      const r2 = B.reachFrom(world, slow, true);
      const d2 = r2.dist.size ? B.approachDest(world, profile, slow, r2.dist, goal, null) : null;
      const p2 = d2 && pathTo(r2.prev, slow, d2.q, d2.r);
      cands.push({ unitId: u.id, prio, order: p2 && p2.length ? { type: 'move', path: p2, stance: 'marche' } : { type: 'hold', stance: 'marche' } });
      continue;
    }
    if (!reach.size) continue;
    // Advance: keep together (no unit far ahead of the army) and do not end next to enemy melee units in the open
    let limit = null;
    if (!objective && Number.isFinite(profile.cohesion) && troops.length > 1) {
      const field = distanceField(room, goal.q, goal.r, false);
      const vals = troops.map(m => field.get(hexKey(m.q, m.r))).filter(v => v != null);
      if (vals.length > 1) limit = vals.reduce((s, v) => s + v, 0) / vals.length - profile.cohesion;
    }
    let dest = B.approachDest(world, profile, u, reach, goal, limit);
    if (dest && tactics > 0 && world.enemies.length && !objective) {
      // approaching the enemy: stop where its melee units cannot reach us with a run-up, in a fighting stance
      const t2 = T.meleeThreat(world, dest.q, dest.r);
      if (t2.n > 0 && (u.stance === 'marche' || u.stance === 'repos')) {
        const hold = holdOrder(world, profile, u, rng, threat.n ? threat : t2);
        if (hold) { cands.push({ unitId: u.id, prio: 50, order: hold }); continue; }
      }
    }
    const path = dest && pathTo(prev, u, dest.q, dest.r);
    if (path && path.length) {
      const order = { type: 'move', path };
      // enemies close: leave the march (or rest) stance on the way, it answers a charge badly
      const near = world.enemies.length && Math.min(...world.enemies.map(e => hexDistance(e.q, e.r, dest.q, dest.r))) <= 7;
      if (near && tactics > 0 && !B.isRanged(u) && (u.stance === 'marche' || u.stance === 'repos') && rng() < profile.stance) {
        order.stance = T.meleeThreat(world, dest.q, dest.r).cavalry > 0 && !isLancer(room, u) ? 'defense_combat' : 'combat';
      }
      cands.push({ unitId: u.id, prio, order });
    }
  }

  cands.sort((a, b) => b.prio - a.prio);
  const out = {};
  const check = room.turns.validateOrder;
  let n = 0;
  for (const c of cands) {
    if (n >= max) break;
    let order = c.order;
    if (check) {
      let res = check(room, playerId, room.findUnit(c.unitId), order);
      // too costly with the stance / facing change: drop them and keep the move
      if ((res.error || !res.order) && (order.stance || order.facing != null) && order.type !== 'hold') {
        const { stance, facing, ...bare } = order;
        res = check(room, playerId, room.findUnit(c.unitId), bare);
        order = bare;
      }
      if (res.error || !res.order) continue;
    }
    out[c.unitId] = order;
    n++;
  }
  return out;
}

// Order for a melee unit that waits for the enemy: a defensive stance (Défense de combat against cavalry or when
// outmatched, Combat otherwise) and a facing toward the threat when its flank or back is exposed. null = nothing to do.
function holdOrder(world, profile, u, rng, threat, prefer = null) {
  const order = { type: 'hold' };
  const room = world.room;
  if (u.speedRemaining > 0 && rng() < profile.stance) {
    // a post imposes its stance; otherwise brace against cavalry, leave march / rest, stop charging when threatened
    let want = prefer;
    if (!want && threat.cavalry > 0 && !isLancer(room, u)) want = 'defense_combat';
    else if (!want && (u.stance === 'marche' || u.stance === 'repos')) want = 'combat';
    else if (!want && u.stance === 'charge' && threat.n > 0) want = 'defense_combat';
    if (want && want !== u.stance) order.stance = want;
  }
  const tactics = profile.tactics || 0;
  if (tactics >= 0.5) {
    const face = T.threatFacing(world, u);
    if (face != null && face !== u.facing) {
      const stance = order.stance || u.stance;
      const now = T.worstExposure(world, u, u.q, u.r, u.facing || 0, stance);
      const then = T.worstExposure(world, u, u.q, u.r, face, stance);
      if (then < now) order.facing = face;
    }
  }
  return order.stance || order.facing != null ? order : null;
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
