// Battle decisions of a bot, one action at a time. The planner is stateless: after every action the bot
// re-plans from the room state (as its player sees it). Every action it returns consumes something
// (speed, the attack, the ability), so a turn always ends; when nothing useful is left it ends the turn.
const GENERALS = require('../data/generals');
const rules = require('../rules');
const AIAgent = require('../../simulation/AIAgent');
const { hexDistance, hexKey, segmentEdgeKey } = require('../HexUtils');
const { distanceField, reachableGoal } = require('./pathing');
const { buildWorld, inRange, unitValue, centroid, nearestHex, loneGeneralGoal } = require('./world');
const { rngFor, pick } = require('./rng');

const { RULES } = rules;
// Abilities that have an effect in GameRoom.useGeneralAbility
const USABLE_ABILITIES = new Set(['ou_ki', 'mou_bu', 'ri_boku']);
const COVER = new Set(['forest', 'building']);
const simAgent = new AIAgent('bot');

const isRanged = (u) => (u.range || 1) > 1;
const isMountedUnit = (u) => rules.isMounted(u);
const keyOf = (q, r) => hexKey(q, r);
const parseKey = (k) => k.split(',').map(Number);

function reachFrom(world, unit, withPrev = false) {
  const room = world.room;
  if (!(unit.speedRemaining > 0)) return withPrev ? { dist: new Map(), prev: new Map() } : new Map();
  const { dist, prev } = rules.reachable(room.moveTable(), {
    start: { q: unit.q, r: unit.r },
    maxCost: unit.speedRemaining,
    minStep: rules.hasFullSpeed(unit),
    mounted: isMountedUnit(unit),
    hexAt: (k) => room.hexMap[k] || null,
    blocked: world.blocked,
    segAt: (a, b, c, d) => room.segmentData[segmentEdgeKey(a, b, c, d)] || null,
  });
  dist.delete(keyOf(unit.q, unit.r));
  return withPrev ? { dist, prev } : dist;
}

function mods(room, unit, q, r) {
  return { st: unit.isGeneral ? {} : room._getStanceMods(unit), te: room._getTerrainMods(q, r) };
}

// Rough expectation of a strike (same formula as GameRoom._resolveCombat, averaged)
function strike(world, a, t, fq, fr) {
  const room = world.room;
  const ranged = hexDistance(fq, fr, t.q, t.r) > 1;
  const type = ranged ? 'tir' : 'cac';
  if (!ranged && a.isGeneral && t.isGeneral) {
    const edge = (a.force - t.force) / 20;
    const p = Math.max(0.1, Math.min(0.9, 0.5 + edge));
    return { pHit: p, dmg: a.power * 2, expected: p * a.power * 2, kill: t.vitality <= a.power * 2, duel: true };
  }
  const A = mods(room, a, fq, fr);
  const D = mods(room, t, t.q, t.r);
  const h = world.height(fq, fr) - world.height(t.q, t.r);
  const night = world.night ? (RULES.night.attackMod[type] || 0) : 0;
  const atk = (a.isGeneral ? a.force : a.attack) + (A.st[`attack_${type}`] || 0) + (A.te[`attack_${type}`] || 0)
    - (D.st[`esquive_${type}`] || 0) - (D.te[`esquive_${type}`] || 0) + h + night;
  const pHit = Math.max(0.05, Math.min(1, atk / 20));
  const faces = Math.max(1, a.power + (A.st[`puissance_${type}`] || 0) + (A.te[`puissance_${type}`] || 0));
  const raw = a.vitality * (faces + 1) / 2 * (1 + h / 10);
  const absorb = Math.min(t.vitality * Math.max(0, t.armor + (D.st.armure || 0) + (D.te.armure || 0)), raw * RULES.combat.maxArmorAbsorb);
  const dmg = Math.max(0, (raw - absorb) / 10);
  return { pHit, dmg, expected: pHit * dmg, kill: dmg >= t.vitality, duel: false };
}

function targetScore(world, profile, a, t, fq, fr) {
  const s = strike(world, a, t, fq, fr);
  let score = 10 + Math.min(100, (s.expected / Math.max(1, t.vitality)) * 100);
  score += profile.focus * ((1 - t.vitality / (t.maxVitality || t.vitality || 1)) * 40 + (s.kill ? 60 * s.pHit : 0) + (t.isGeneral ? 80 : 0) + (t.isFleeing ? 10 : 0));
  score += unitValue(t) / 100;
  if (s.duel && profile.focus > 0 && a.force < t.force - 1) score -= 120;
  return score;
}

function terrainScore(world, q, r) {
  const te = world.room._getTerrainMods(q, r);
  const t = world.terrainAt(q, r);
  return (te.defense_cac || 0) + (te.esquive_cac || 0) + (te.armure || 0) + (t === 'river' ? -6 : 0) + world.height(q, r) * 0.5;
}

// Enemy melee units that could reach (q, r) next turn
function danger(world, q, r) {
  let n = 0;
  for (const e of world.enemies) if (!isRanged(e) && hexDistance(e.q, e.r, q, r) <= (e.speed || 3) + 1) n++;
  return n;
}

function nearestEnemy(world, u) {
  let best = null, bd = Infinity;
  for (const e of world.enemies) {
    const d = hexDistance(u.q, u.r, e.q, e.r);
    if (d < bd) { bd = d; best = e; }
  }
  return { enemy: best, dist: bd };
}

// Local balance of forces around (q, r): >1 means we are stronger
function localBalance(world, q, r, radius = 6) {
  let mine = 0, theirs = 0;
  for (const u of world.mine) if (hexDistance(u.q, u.r, q, r) <= radius) mine += unitValue(u);
  for (const e of world.enemies) if (hexDistance(e.q, e.r, q, r) <= radius) theirs += unitValue(e);
  return theirs ? mine / theirs : Infinity;
}

const act = (action, data, why) => ({ action, data, why });

// ---------- general ----------

function abilityStep(world, profile) {
  const { room, player, playerId } = world;
  const gen = player.units.find(u => u.isGeneral && u.q !== null);
  const gid = player.generalId;
  if (!gen || !USABLE_ABILITIES.has(gid) || gen.hasUsedAbility || gen.abilityCooldown > 0) return null;
  if (rngFor(room.roomCode, room.turn, playerId, 'ability')() >= profile.ability) return null;
  const engaged = world.enemies.some(e => world.mine.some(u => hexDistance(u.q, u.r, e.q, e.r) <= 5));
  if (gid === 'ou_ki' && engaged) return act('use_ability', {}, 'ability');
  if (gid === 'mou_bu' && engaged) {
    const count = {};
    for (const e of world.enemies) count[e.playerId] = (count[e.playerId] || 0) + 1;
    const targetId = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    if (targetId) return act('use_ability', { targetId }, 'ability');
  }
  if (gid === 'ri_boku' && room.turn >= 2) {
    const nearCover = world.mine.some(u => {
      for (let dq = -3; dq <= 3; dq++) for (let dr = -3; dr <= 3; dr++) {
        if (hexDistance(0, 0, dq, dr) > 3) continue;
        if (COVER.has(world.terrainAt(u.q + dq, u.r + dr)) && world.vis.has(keyOf(u.q + dq, u.r + dr))) return true;
      }
      return false;
    });
    if (nearCover && world.enemies.length <= 2) return act('use_ability', {}, 'ability');
  }
  return null;
}

function planGeneral(world, profile, g, rng, blunder) {
  const { room } = world;
  const gd = GENERALS.find(x => x.id === g.generalId);
  const charisma = gd ? gd.charisma : 10;
  const radius = Math.floor(charisma / 5);
  if (!g.hasAttacked && rng() < profile.motivate) {
    const near = world.mine.filter(u => !u.isGeneral && hexDistance(u.q, u.r, g.q, g.r) <= radius);
    const fleeing = near.filter(u => u.isFleeing).length;
    const low = near.filter(u => u.morale < u.maxMorale * 0.5).length;
    if (fleeing >= 1 || low >= 2) return act('motivate_unit', { generalId: g.id }, 'motivate');
  }
  if (!g.hasAttacked) {
    const targets = world.enemies.filter(t => inRange(world, g, g.q, g.r, t));
    const ok = targets.filter(t => {
      if (t.isGeneral) return blunder || profile.caution === 0 || g.force >= t.force - (profile.focus >= 1 ? 1 : 2);
      return profile.caution <= 1 || t.vitality < t.maxVitality * 0.35 || t.isFleeing;
    });
    if (ok.length) {
      const t = ok.slice().sort((a, b) => targetScore(world, profile, g, b, g.q, g.r) - targetScore(world, profile, g, a, g.q, g.r))[0];
      return act('attack_unit', { attackerId: g.id, targetId: t.id }, 'general_attack');
    }
  }
  if (!(g.speedRemaining > 0) || profile.hold || g.stunned) return null;
  const reach = reachFrom(world, g);
  if (!reach.size) return null;
  const troops = world.mine.filter(u => !u.isGeneral);
  const hunt = loneGeneralGoal(world);
  if (hunt) return approach(world, profile, g, reach, hunt, null);
  if (profile.caution === 0 && world.enemies.length) {
    // Reckless general: walks to the enemy like a soldier
    return approach(world, profile, g, reach, nearestEnemy(world, g).enemy, null);
  }
  const keep = profile.caution + 1;
  const c0 = centroid(troops) || { q: g.q, r: g.r };
  const center = nearestHex(room, c0.q, c0.r);
  // Walking cost to the army (cliffs and walls), straight distance if the army is out of reach
  const field = distanceField(room, center.q, center.r, false);
  const toArmy = (q, r) => { const f = field.get(keyOf(q, r)); return f == null ? hexDistance(q, r, center.q, center.r) * 2 : f; };
  const withArmy = toArmy(g.q, g.r) <= 4; // terrain only matters once the general has joined his troops
  const score = (q, r) => {
    let s = -toArmy(q, r) * 1.5;
    const d = world.enemies.length ? Math.min(...world.enemies.map(e => hexDistance(q, r, e.q, e.r))) : Infinity;
    if (d < keep) s -= (keep - d) * 6;
    if (withArmy) s += terrainScore(world, q, r) * profile.terrain * 0.5;
    return s;
  };
  let best = null, bs = score(g.q, g.r) + 0.5; // small bias for staying put
  for (const [k] of reach) {
    const [q, r] = parseKey(k);
    const s = score(q, r);
    if (s > bs) { bs = s; best = { q, r }; }
  }
  return best ? act('move_unit', { unitId: g.id, targetQ: best.q, targetR: best.r }, 'general_move') : null;
}

// ---------- troops ----------

function attackStance(u) {
  if (u.isGeneral) return null;
  if (u.category === 'Chevaux' || u.category === 'Chars') return 'charge';
  return 'combat';
}

function idleStance(world, profile, u) {
  const { dist } = nearestEnemy(world, u);
  const hurt = u.vitality < u.maxVitality * 0.7 || u.morale < u.maxMorale * 0.6;
  if (world.night && dist > 5 && hurt) return 'repos';
  if (u.stance === 'repos') return dist > 4 ? 'marche' : isRanged(u) ? 'defense_distance' : 'combat';
  if (isRanged(u) && world.enemies.some(isRanged) && dist > 2) return 'defense_distance';
  if (!isRanged(u) && dist <= 2) return profile.focus >= 1 ? 'defense_combat' : 'combat';
  if (dist > 8 && u.stance === 'repos' && !world.night) return 'marche';
  return null;
}

// Walk toward a goal (unit or hex) along the long-range cost field
function approach(world, profile, u, reach, goal, limit) {
  const best = approachDest(world, profile, u, reach, goal, limit);
  return best ? act('move_unit', { unitId: u.id, targetQ: best.q, targetR: best.r }, 'approach') : null;
}

function approachDest(world, profile, u, reach, goal, limit) {
  if (!goal || !reach.size) return null;
  const { field } = reachableGoal(world.room, goal, u, isMountedUnit(u));
  const here = field.get(keyOf(u.q, u.r));
  if (here == null) return null;
  const keepAway = isRanged(u) ? 2 : 0;
  let best = null, bs = Infinity;
  for (const [k] of reach) {
    const f = field.get(k);
    if (f == null || f >= here - 0.01) continue;
    if (limit != null && f < limit) continue;
    const [q, r] = parseKey(k);
    if (keepAway && world.enemies.some(e => hexDistance(q, r, e.q, e.r) < keepAway)) continue;
    const s = f - terrainScore(world, q, r) * profile.terrain * 0.4 + (world.terrainAt(q, r) === 'river' ? 3 : 0);
    if (s < bs) { bs = s; best = { q, r }; }
  }
  return best;
}

function assignObjectives(world, profile) {
  const { room, playerId } = world;
  const out = new Map();
  if (!room.objectives || !room.objectives.length) return out;
  const want = profile.objectives + (profile.objectives && room.settings.victoryPoints > 0 ? 1 : 0);
  if (!want) return out;
  const free = world.mine.filter(u => !u.isGeneral && !u.isFleeing && !isRanged(u));
  const objs = room.objectives.filter(o => o.owner !== playerId)
    .sort((a, b) => a.id < b.id ? -1 : 1);
  for (const o of objs.slice(0, want)) {
    const occupant = room.unitMap[keyOf(o.q, o.r)];
    if (occupant && occupant.playerId === playerId) { out.set(occupant.id, o); continue; }
    const cands = free.filter(u => !out.has(u.id)).sort((a, b) => hexDistance(a.q, a.r, o.q, o.r) - hexDistance(b.q, b.r, o.q, o.r));
    if (cands[0]) out.set(cands[0].id, o);
  }
  return out;
}

function armyGoal(world) {
  if (world.enemies.length) {
    const gen = world.enemies.find(e => e.isGeneral);
    return gen || centroid(world.enemies);
  }
  return world.enemyGuess;
}

// Unit abilities the bot uses: an assassin vanishes when no enemy is in sight nearby; bâtisseurs put chevaux de frise
// on the edge facing the nearest enemy when it comes close (espions only scout: their sight already reveals ambushes)
function unitAbilityPlan(world, u) {
  const { room } = world;
  const ab = room.ability(u);
  if (!ab || u.isFleeing || (u.speedRemaining || 0) < ab.cost) return null;
  if (ab.type === 'ambush') {
    if (u.vanishedDay === room.dayNumber()) return null;
    if (world.enemies.some(e => hexDistance(e.q, e.r, u.q, u.r) <= ab.range)) return null;
    return { kind: 'vanish' };
  }
  if (ab.type === 'build') {
    const near = nearestEnemy(world, u);
    if (!near.enemy || near.dist > 4 || near.dist <= 1) return null;
    let best = null, bd = Infinity;
    for (const [dq, dr] of rules.DIRS) {
      const q = u.q + dq, r = u.r + dr;
      if (!room.hexMap[keyOf(q, r)]) continue;
      const opts = rules.buildOptions(room.segmentData[segmentEdgeKey(u.q, u.r, q, r)] || null, room.terrainData[keyOf(q, r)]);
      if (!opts.some(o => o.id === 'chevaux_de_frise')) continue;
      const d = hexDistance(q, r, near.enemy.q, near.enemy.r);
      if (d < bd) { bd = d; best = { q, r }; }
    }
    return best && bd < near.dist ? { kind: 'build', build: 'chevaux_de_frise', q: best.q, r: best.r } : null;
  }
  return null;
}

function planTroop(world, profile, u, rng, blunder, objectives) {
  const { room } = world;
  const ua = blunder ? null : unitAbilityPlan(world, u);
  if (ua) return ua.kind === 'vanish' ? act('unit_vanish', { unitId: u.id }, 'vanish') : act('unit_build', { unitId: u.id, q: ua.q, r: ua.r, kind: ua.build }, 'build');
  const objective = objectives.get(u.id);
  const onObjective = objective && objective.q === u.q && objective.r === u.r;
  const targets = u.hasAttacked ? [] : world.enemies.filter(t => inRange(world, u, u.q, u.r, t));
  const reach = reachFrom(world, u);

  // Shooters in contact step back before firing
  if (targets.length && isRanged(u) && profile.retreatRanged && reach.size
      && world.enemies.some(e => !isRanged(e) && hexDistance(e.q, e.r, u.q, u.r) === 1)) {
    let best = null, bs = -Infinity;
    for (const [k] of reach) {
      const [q, r] = parseKey(k);
      if (world.enemies.some(e => hexDistance(q, r, e.q, e.r) < 2)) continue;
      const ts = world.enemies.filter(t => inRange(world, u, q, r, t));
      if (!ts.length) continue;
      const s = Math.max(...ts.map(t => targetScore(world, profile, u, t, q, r))) - danger(world, q, r) * 5;
      if (s > bs) { bs = s; best = { q, r }; }
    }
    if (best) return act('move_unit', { unitId: u.id, targetQ: best.q, targetR: best.r }, 'step_back');
  }

  if (targets.length) {
    if (u.speedRemaining > 0 && rng() < profile.stance) {
      const st = attackStance(u);
      if (st && st !== u.stance) return act('change_stance', { unitId: u.id, stanceId: st }, 'attack_stance');
    }
    const t = blunder ? pick(rng, targets)
      : targets.slice().sort((a, b) => targetScore(world, profile, u, b, u.q, u.r) - targetScore(world, profile, u, a, u.q, u.r))[0];
    return act('attack_unit', { attackerId: u.id, targetId: t.id }, 'attack');
  }

  if (reach.size && !onObjective) {
    // 1. Strike position reachable this turn
    if (!u.hasAttacked && world.enemies.length) {
      const cands = [];
      for (const [k, cost] of reach) {
        const [q, r] = parseKey(k);
        for (const t of world.enemies) {
          if (!inRange(world, u, q, r, t)) continue;
          if (profile.hold && hexDistance(u.q, u.r, t.q, t.r) > (profile.engageRadius || 0) + (u.range || 1)) continue;
          let s = targetScore(world, profile, u, t, q, r) + terrainScore(world, q, r) * profile.terrain * 2 - cost * 0.2;
          if (isRanged(u)) s -= danger(world, q, r) * 8 * profile.focus + (hexDistance(q, r, t.q, t.r) === 1 ? 30 : 0);
          cands.push({ q, r, s });
        }
      }
      if (cands.length) {
        const c = blunder ? pick(rng, cands) : cands.sort((a, b) => b.s - a.s)[0];
        return act('move_unit', { unitId: u.id, targetQ: c.q, targetR: c.r }, 'strike_position');
      }
    }
    // 2. Objective
    if (objective) return approach(world, profile, u, reach, objective, null);
    const grab = (room.objectives || []).find(o => o.owner !== world.playerId && reach.has(keyOf(o.q, o.r)));
    if (grab && !profile.hold && (blunder || !world.enemies.some(e => hexDistance(e.q, e.r, grab.q, grab.r) <= 1))) {
      return act('move_unit', { unitId: u.id, targetQ: grab.q, targetR: grab.r }, 'grab_objective');
    }
    if (!profile.hold) {
      // 3. Hold in good terrain when outnumbered nearby
      const near = nearestEnemy(world, u);
      if (profile.holdIfWeaker && near.enemy && near.dist <= 6 && localBalance(world, u.q, u.r) < 0.8) {
        // stays put; the idle stance below sets a defensive posture
      } else {
        // 4. Advance with the army
        if (!world.enemies.length && u.speedRemaining >= 3 && u.stance !== 'marche' && rng() < profile.stance) {
          return act('change_stance', { unitId: u.id, stanceId: 'marche' }, 'march_stance');
        }
        const goal = blunder ? world.enemyGuess : armyGoal(world);
        let limit = null;
        if (Number.isFinite(profile.cohesion) && !world.enemies.length) {
          const field = distanceField(room, goal.q, goal.r, false);
          const vals = world.mine.filter(m => !m.isGeneral).map(m => field.get(keyOf(m.q, m.r))).filter(v => v != null);
          if (vals.length > 1) limit = vals.reduce((s, v) => s + v, 0) / vals.length - profile.cohesion;
        }
        const step = approach(world, profile, u, reach, goal, limit);
        if (step) return step;
      }
    }
  }

  if (u.speedRemaining > 0 && rng() < Math.max(profile.stance, 0.2)) {
    const st = idleStance(world, profile, u);
    if (st && st !== u.stance) return act('change_stance', { unitId: u.id, stanceId: st }, 'idle_stance');
  }
  return null;
}

const ORDER = { Tireurs: 0, Chevaux: 1, Chars: 1, Infanterie: 2, 'Général': 3 };

function planBattleStep(room, playerId, profile) {
  const world = buildWorld(room, playerId);
  if (!world.player || world.player.isEliminated) return null;
  const ability = abilityStep(world, profile);
  if (ability) return ability;
  const objectives = assignObjectives(world, profile);
  const units = world.mine.slice().sort((a, b) => ((ORDER[a.category] ?? 2) + (a.isGeneral ? 3 : 0)) - ((ORDER[b.category] ?? 2) + (b.isGeneral ? 3 : 0)));
  for (const u of units) {
    if (u.isFleeing) continue;
    const rng = rngFor(room.roomCode, room.turn, room.manche, u.id);
    const roll = rng();
    const blunder = roll < profile.mistake;
    if (blunder && roll < profile.mistake * 0.4) continue; // idle this turn
    const step = u.isGeneral ? planGeneral(world, profile, u, rng, blunder) : planTroop(world, profile, u, rng, blunder, objectives);
    if (step) return step;
  }
  return act('end_turn', {}, 'done');
}

// Answer to an attack on one of the bot's units
function chooseDefense(room, attackId, pending, profile) {
  const target = room.findUnit(pending.targetId);
  if (!target) return 'rien';
  if (pending.isRanged) return target.typeId === 'phalange' ? 'absorb' : 'rien';
  const rng = rngFor(room.roomCode, attackId, 'defense');
  if (rng() < profile.mistake) return pick(rng, ['rien', 'counter', 'absorb']);
  if (profile.id === 'veteran') {
    return simAgent.chooseDefense({ targetPlayerId: pending.targetPlayerId, targetQ: target.q, targetR: target.r, isRanged: false, targetTypeId: target.typeId }, room);
  }
  const st = target.isGeneral ? {} : room._getStanceMods(target);
  const te = room._getTerrainMods(target.q, target.r);
  const defTotal = (target.isGeneral ? target.force : target.defense) + (st.defense_cac || 0) + (te.defense_cac || 0);
  const healthy = target.vitality > target.maxVitality * 0.4;
  return defTotal / 20 >= 0.45 && healthy ? 'counter' : 'absorb';
}

module.exports = {
  planBattleStep, chooseDefense, strike, reachFrom, USABLE_ABILITIES,
  // helpers shared with the simultaneous planner
  abilityStep, assignObjectives, armyGoal, approachDest, targetScore, attackStance, nearestEnemy, isRanged, unitAbilityPlan,
};
