// Simultaneous mode: every player plans secret orders at the same time, then all orders resolve together, tick by tick
// (game/rules/resolve.js). Rules: docs/mode-simultane.md. State lives in room.sim (plain JSON, serialized as-is).
//
// ---- Protocol (game/protocol.js) ----
// Room settings (lobby, host only): mode 'simultaneous' (set_mode), settings.planningTimer (s, 0 = none, else 15-600,
// default 90), settings.commandPoints (0 = 2 + ceil(Strategy / 3), else a fixed number of orders per turn).
//
// Actions (battle phase, players only):
//   set_orders     { orders: { [unitId]: order | null }, replace?: bool }   replace = the whole set (default: merge, null clears)
//                  order = { type: 'move', path: [[q, r], ...] (first step to destination, origin excluded) }
//                        | { type: 'attack' | 'charge', targetId }     (target visible when ordered; shooters fire, melee units close in)
//                        | { type: 'hold' } | { type: 'motivate' }     (motivate: generals)
//                        + optional stance: stanceId (-2 speed), facing: 0-5 (-1 speed, applied at the end), ability: { targetId? } (generals)
//                  -> orders_update { turn, orders, commandPoints: { max, used }, committed }   (to the sender only)
//   commit_orders  {}  -> commit_status to everyone; when every living player has committed (or is absent for
//                         absentTurnMs), or when the planning timer expires, the turn resolves.
//   cancel_commit  {}  -> commit_status
//
// Events:
//   planning_start { turn, endsAt|null, startsAt (after the playback), commandPoints: { max } (players) }
//   commit_status  { turn, committed: [playerId], waiting: [playerId] }            (booleans only, never orders)
//   resolution     { turn, seed, durationMs, startedAt, elapsedMs, start: { units }, ticks: [{ t, events }] }
//                  per recipient: events filtered by what it saw at each tick (resolve.js); spectators get the full
//                  timeline when spectatorVision is 'full' (nothing otherwise). Sent again on reconnection while the
//                  playback is running (elapsedMs > 0). Followed by game_state (new turn) and the usual
//                  objective_captured / time_change / game_over events.
//   game_state.planning = { turn, endsAt, startsAt, committed: [playerId], commandPoints: { max, used },
//                           myOrders, myCommitted, playbackEndsAt }   (myOrders / commandPoints: players only)
const resolveRules = require('../rules/resolve');
const rules = require('../rules');
const { hexDistance, hexKey, segmentEdgeKey } = require('../HexUtils');

const { RULES } = rules;
const ORDER_TYPES = ['move', 'attack', 'charge', 'hold', 'motivate'];

function alivePlayers(room) {
  return room.players.filter(p => !p.isEliminated);
}

function ensureSim(room) {
  if (!room.sim) room.sim = { orders: {}, committed: {}, planningEndsAt: null, planningStartsAt: null, playback: null };
  return room.sim;
}

function beginRound(room, first) {
  const sim = ensureSim(room);
  sim.orders = {};
  sim.committed = {};
  for (const p of alivePlayers(room)) {
    for (const u of p.units) {
      if (!first) room._applyTurnRegen(u);
      room._initUnitSpeedForTurn(u);
    }
  }
}

function commandPoints(room, playerId) {
  const fixed = room.settings.commandPoints;
  if (fixed > 0) return fixed;
  const p = room.getPlayer(playerId);
  const g = p && p.units.find(u => u.isGeneral);
  const C = RULES.simultaneous.commandPoints;
  return C.base + Math.ceil(((g && g.strategy) || 10) / C.strategyDivisor);
}

function hasStance(room, id) {
  return typeof id === 'string' && (room.balance ? Object.prototype.hasOwnProperty.call(room.balance.stances, id) : rules.hasStance(id));
}

const isInt = (v) => Number.isInteger(v);

// Normalized order or { error }. Paths are checked by step cost only: units on the way are a matter for the resolution.
function validateOrder(room, playerId, unit, raw) {
  const S = RULES.simultaneous;
  if (!raw || typeof raw !== 'object' || !ORDER_TYPES.includes(raw.type)) return { error: 'Ordre invalide.' };
  if (unit.isFleeing) return { error: `${unit.name} est en fuite.` };
  const order = { type: raw.type };
  let budget = unit.speedRemaining || 0;
  if (raw.stance != null && raw.stance !== unit.stance) {
    if (unit.isGeneral) return { error: 'Les généraux n\'ont pas de posture.' };
    if (!hasStance(room, raw.stance)) return { error: 'Posture invalide.' };
    if (budget <= 0) return { error: 'Plus de vitesse disponible pour changer de posture.' };
    order.stance = raw.stance;
    budget = Math.max(0, rules.snap(budget - S.stanceCost));
  }
  if (raw.facing != null) {
    if (!isInt(raw.facing) || raw.facing < 0 || raw.facing > 5) return { error: 'Orientation invalide.' };
    order.facing = raw.facing;
    budget = Math.max(0, rules.snap(budget - S.facingCost));
  }
  if (raw.ability) {
    if (!unit.isGeneral || !unit.activeAbility) return { error: 'Pas de capacité active.' };
    if (unit.abilityCooldown > 0) return { error: `Capacité en recharge (${unit.abilityCooldown} tours restants).` };
    const targetId = raw.ability && typeof raw.ability === 'object' ? raw.ability.targetId : null;
    if (unit.activeAbility.target === 'enemy_army') {
      const tp = typeof targetId === 'string' ? room.getPlayer(targetId) : null;
      if (!tp || tp.id === playerId || tp.isEliminated) return { error: 'Choisissez une armée ennemie cible.' };
      order.ability = { targetId };
    } else order.ability = {};
  }
  if (order.type === 'move') {
    const path = raw.path;
    if (!Array.isArray(path) || path.length < 1 || path.length > 60) return { error: 'Chemin invalide.' };
    let q = unit.q, r = unit.r, cost = 0;
    const out = [];
    for (const step of path) {
      if (!Array.isArray(step) || !isInt(step[0]) || !isInt(step[1])) return { error: 'Chemin invalide.' };
      const [nq, nr] = step;
      if (hexDistance(q, r, nq, nr) !== 1 || !room.hexMap[hexKey(nq, nr)]) return { error: 'Chemin invalide.' };
      const c = rules.stepCost(room.moveTable(), room.hexMap[hexKey(q, r)], room.hexMap[hexKey(nq, nr)], room.segmentData[segmentEdgeKey(q, r, nq, nr)] || null, rules.isMounted(unit));
      if (!isFinite(c)) return { error: 'Chemin infranchissable.' };
      cost = rules.snap(cost + c);
      out.push([nq, nr]);
      q = nq; r = nr;
    }
    if (cost > budget + 1e-9) return { error: `Chemin trop long (coût ${cost}, vitesse ${budget}).` };
    order.path = out;
  } else if (order.type === 'attack' || order.type === 'charge') {
    const target = typeof raw.targetId === 'string' ? room.findUnit(raw.targetId) : null;
    if (!target || target.playerId === playerId || target.q === null || !room.canSee(playerId, target)) return { error: 'Cible introuvable.' };
    if (order.type === 'charge' && (unit.range || 1) > 1) return { error: 'Les tireurs ne chargent pas.' };
    order.targetId = target.id;
  } else if (order.type === 'motivate') {
    if (!unit.isGeneral) return { error: 'Seul un général peut motiver.' };
  }
  if (order.type === 'hold' && !order.stance && order.facing == null && !order.ability) return { order: null };
  return { order };
}

const simultaneous = {
  id: 'simultaneous',

  start(room) {
    room.turn = 1;
    room.manche = 1;
    room.initiativeRolls = {};
    room.turnOrder = alivePlayers(room).map(p => p.id);
    room.currentTurnIndex = 0;
    room.sim = null;
    beginRound(room, true);
  },

  currentPlayerId() { return null; },
  canAct() { return false; },
  endTurn() { return { newRound: false, fled: [] }; },
  settle() { return null; },

  commandPoints,

  setOrders(room, playerId, orders, replace = false) {
    const sim = ensureSim(room);
    const player = room.getPlayer(playerId);
    if (!player || player.isEliminated) return { error: 'Joueur éliminé.' };
    if (sim.committed[playerId]) return { error: 'Ordres déjà validés : annulez la validation pour les modifier.' };
    if (!orders || typeof orders !== 'object' || Array.isArray(orders)) return { error: 'Ordres invalides.' };
    const entries = Object.entries(orders);
    if (entries.length > 200) return { error: 'Trop d\'ordres.' };
    const next = replace ? {} : { ...(sim.orders[playerId] || {}) };
    for (const [unitId, raw] of entries) {
      const unit = player.units.find(u => u.id === unitId);
      if (!unit || unit.q === null) return { error: 'Unité introuvable.' };
      if (raw == null) { delete next[unitId]; continue; }
      const res = validateOrder(room, playerId, unit, raw);
      if (res.error) return res;
      if (res.order) next[unitId] = res.order; else delete next[unitId];
    }
    const max = commandPoints(room, playerId);
    const used = Object.keys(next).length;
    if (used > max) return { error: `Points de commandement insuffisants (${used}/${max}).` };
    sim.orders[playerId] = next;
    return { ok: true, orders: next, commandPoints: { max, used } };
  },

  commit(room, playerId, on = true) {
    const sim = ensureSim(room);
    const p = room.getPlayer(playerId);
    if (!p || p.isEliminated) return { error: 'Joueur éliminé.' };
    if (on) sim.committed[playerId] = true; else delete sim.committed[playerId];
    return { ok: true };
  },

  // Living players who have not committed (absent players count as ready after absentMs)
  waiting(room, now, absentMs) {
    const sim = ensureSim(room);
    return alivePlayers(room).filter(p => !sim.committed[p.id] && !(p.connected === false && p.disconnectedAt && now - p.disconnectedAt >= absentMs)).map(p => p.id);
  },

  commitStatus(room) {
    const sim = ensureSim(room);
    const alive = alivePlayers(room).map(p => p.id);
    return { turn: room.turn, committed: alive.filter(id => sim.committed[id]), waiting: alive.filter(id => !sim.committed[id]) };
  },

  // Resolves the turn, then closes the round (captures, effects, scores, night, victory) and opens the next planning.
  resolve(room, seed) {
    const sim = ensureSim(room);
    const turn = room.turn;
    const start = {};
    const units = [];
    for (const p of room.players) for (const u of p.units) if (u.q !== null) units.push(u);
    for (const p of room.players) {
      const vis = room.getVisibleHexes(p.id);
      start[p.id] = units.filter(u => u.playerId === p.id || room.canSee(p.id, u, u.q, u.r, vis)).map(u => ({ ...room._slimUnit(u, room.getPlayer(u.playerId)), isMine: u.playerId === p.id }));
    }
    const all = units.map(u => room._slimUnit(u, room.getPlayer(u.playerId)));
    const res = resolveRules.resolveTurn(room, sim.orders, seed);

    if (room.phase === 'battle') {
      for (const p of alivePlayers(room)) room.onPlayerTurnEnd(p.id);
      for (const p of room.players) {
        for (const u of p.units) {
          u.hasMoved = false;
          u.hasAttacked = false;
          if (u.isGeneral) {
            u.hasUsedAbility = false;
            if (u.abilityCooldown > 0) u.abilityCooldown--;
          }
        }
      }
      room.turn++;
      room.manche = 1;
      room.activeEffects = room.activeEffects.map(e => ({ ...e, turnsLeft: e.turnsLeft - 1 })).filter(e => e.turnsLeft > 0);
      room._applyPassives();
      room.onRoundStart();
      room.turnOrder = alivePlayers(room).map(p => p.id);
    }
    if (room.phase === 'battle') beginRound(room, false);
    else { sim.orders = {}; sim.committed = {}; }
    return { turn, seed, start, startAll: all, ...res };
  },

  stateFor(room, playerId) {
    const sim = ensureSim(room);
    const status = simultaneous.commitStatus(room);
    const planning = {
      turn: room.turn,
      endsAt: sim.planningEndsAt || null,
      startsAt: sim.planningStartsAt || null,
      committed: status.committed,
      playbackEndsAt: sim.playback ? sim.playback.endsAt : null,
    };
    const p = playerId && room.getPlayer(playerId);
    if (p) {
      const mine = (sim.orders && sim.orders[playerId]) || {};
      planning.myOrders = mine;
      planning.myCommitted = !!sim.committed[playerId];
      planning.commandPoints = { max: commandPoints(room, playerId), used: Object.keys(mine).length };
    }
    return { planning };
  },
};

module.exports = simultaneous;
