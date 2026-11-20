// Simultaneous mode: resolution of one turn of orders, tick by tick (rules: docs/mode-simultane.md).
//
// resolveTurn(room, ordersByPlayer, seed) mutates the room (positions, combats, deaths...) and returns
//   { seed, ticks, full, views: { [playerId]: { ticks } }, combats, durationMs }
// where every view is a list of ticks [{ t, events }] filtered by what that player saw at that moment
// (`full` = everything, for spectators with full vision). Tick 0 = preparation (fleeing, stances, abilities, motivation).
// Each later tick: (A) ranged fire and reaction fire, (B) simultaneous movement of one hex, (C) contacts / zone of
// control, (D) melee. All dice come from a generator seeded with `seed`: same room + orders + seed = same result.
//
// Timeline events (k = kind), per recipient:
//   move   { u, from:[q,r], to:[q,r], f }        unit seen before and after the step (own units always)
//   appear { u, unit, at:[q,r] }                  enemy entering the recipient's sight (slim unit descriptor)
//   vanish { u }                                  enemy leaving the recipient's sight
//   flee   { u, from, to } / fled { u }           routed unit running to the edge / leaving the map
//   stance { u, s }      facing { u, f }
//   ability { u, playerId, name, effects, targetPlayerId }      motivate { u, success, count, d20?, charisma? }
//   ambush { u, by, q, r, playerId, byPlayerId }  a move ran into a hidden enemy (it stops, the ambusher is revealed)
//   combat { kind: ranged|reaction|melee|charge|encounter|duel, log }   log = combat log (views.combatFor)
//   shot_lost { u, targetId }                     (owner only) the target never came within range and sight
const { hexDistance, hexKey, hexFacing, hexFacingRanged, segmentEdgeKey } = require('../HexUtils');
const rules = require('./index');
const { combatFor } = require('../views');

const { RULES } = rules;
const DIRS = rules.DIRS;
const ALL = '*';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function idNum(id) {
  const n = parseInt(String(id).replace(/^\D+/, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function byId(a, b) {
  return idNum(a.u.id) - idNum(b.u.id) || (a.u.id < b.u.id ? -1 : a.u.id > b.u.id ? 1 : 0);
}

function alive(room, u) {
  const p = room.getPlayer(u.playerId);
  return !!p && p.units.includes(u) && u.q !== null;
}

function reactionOf(u, c) {
  const S = RULES.simultaneous;
  if (u.isGeneral) return 'counter';
  if (u.stance === 'marche' && c && c.moved > 0) return S.marchMovingReaction;
  return S.stanceReaction[u.stance] || 'rien';
}

function effectiveRange(room, a, t) {
  const hA = room.heightData[hexKey(a.q, a.r)] || 0;
  const hT = room.heightData[hexKey(t.q, t.r)] || 0;
  return (a.range || 1) + Math.max(0, hA - hT);
}

function stepCost(room, u, q1, r1, q2, r2) {
  const from = room.hexMap[hexKey(q1, r1)], to = room.hexMap[hexKey(q2, r2)];
  if (!from || !to) return Infinity;
  return rules.stepCost(room.moveTable(), from, to, room.segmentData[segmentEdgeKey(q1, r1, q2, r2)] || null, rules.isMounted(u));
}

function resolveTurn(room, ordersByPlayer, seed) {
  room._rng = mulberry32(seed);
  try {
    return run(room, ordersByPlayer || {}, seed);
  } finally {
    room._rng = null;
  }
}

function run(room, ordersByPlayer, seed) {
  const S = RULES.simultaneous;
  const recipients = [...room.players.map(p => p.id), ALL];
  const views = Object.fromEntries(recipients.map(id => [id, []]));
  let tick = null;
  const newTick = (t) => { tick = { t, events: Object.fromEntries(recipients.map(id => [id, []])) }; return tick; };
  const finishTick = () => { for (const id of recipients) views[id].push({ t: tick.t, events: tick.events[id] }); };
  const send = (id, ev) => { if (ev) tick.events[id].push(ev); };

  // ---- sight: per recipient, the enemy units it currently sees (kept up to date after every sub-phase) ----
  const seen = {};
  const unitsOnBoard = () => {
    const out = [];
    for (const p of room.players) for (const u of p.units) if (u.q !== null) out.push(u);
    return out;
  };
  const computeSight = () => {
    const out = {};
    const units = unitsOnBoard();
    for (const p of room.players) {
      const vis = room.getVisibleHexes(p.id);
      out[p.id] = new Set(units.filter(u => u.playerId === p.id || room.canSee(p.id, u, u.q, u.r, vis)).map(u => u.id));
    }
    out[ALL] = new Set(units.map(u => u.id));
    return out;
  };
  const sees = (id, u) => (id === ALL || u.playerId === id || seen[id].has(u.id));
  const slim = (u) => room._slimUnit(u, room.getPlayer(u.playerId));
  // moved: Map unitId -> { u, from, to, kind }; emits move / appear / vanish and refreshes `seen`
  const refreshSight = (moved = new Map()) => {
    const next = computeSight();
    const units = unitsOnBoard();
    for (const id of recipients) {
      for (const u of units) {
        const was = id === ALL || u.playerId === id || seen[id].has(u.id);
        const now = next[id].has(u.id);
        const m = moved.get(u.id);
        if (m && was && now) send(id, { k: m.kind, u: u.id, from: m.from, to: m.to, f: u.facing });
        else if (!was && now) send(id, { k: 'appear', u: u.id, unit: slim(u), at: [u.q, u.r] });
        else if (was && !now) send(id, { k: 'vanish', u: u.id });
      }
    }
    for (const id of recipients) seen[id] = next[id];
  };
  // event visible to the recipients who see unit u (owner and spectators included)
  const sendSeen = (u, ev) => { for (const id of recipients) if (sees(id, u)) send(id, ev); };

  // ---- controls ----
  const ctl = new Map();
  for (const u of unitsOnBoard()) {
    const p = room.getPlayer(u.playerId);
    const o = (!p.isEliminated && ordersByPlayer[p.id] && ordersByPlayer[p.id][u.id]) || { type: 'hold' };
    ctl.set(u.id, {
      u, o, owner: p.id,
      budget: u.speedRemaining || 0, speed0: u.speedRemaining || 0,
      path: (o.type === 'move' || (o.type === 'attack' && (u.range || 1) > 1)) && Array.isArray(o.path) ? o.path.map(([q, r]) => [q, r]) : [],
      target: (o.type === 'attack' || o.type === 'charge') ? o.targetId : null,
      lastSeen: null,
      ranged: o.type === 'attack' && (u.range || 1) > 1,
      reactor: false,
      moved: 0, done: false, struck: false, fired: false, breakthrough: 0, chargeUsed: false,
      inRange: new Set(), reactQueue: [],
    });
  }
  const ctls = () => [...ctl.values()].filter(c => alive(room, c.u)).sort(byId);
  const pathTrail = new Map(); // replay: unitId -> visited hexes since the last flush
  const flushTrails = () => {
    for (const [id, trail] of pathTrail) if (trail.length > 1) room._record('move', { u: id, path: trail });
    pathTrail.clear();
  };

  seen[ALL] = new Set();
  Object.assign(seen, computeSight());
  room._record('resolution', { seed });

  // ---------------- tick 0: preparation ----------------
  newTick(0);
  {
    const before = new Map(unitsOnBoard().filter(u => u.isFleeing).map(u => [u.id, { u, q: u.q, r: u.r }]));
    for (const p of room.players) {
      if (p.isEliminated) continue;
      const fled = room._processFleeing(p.id);
      for (const f of fled) {
        const b = before.get(f.unitId);
        if (b) sendSeen(b.u, { k: 'fled', u: f.unitId });
      }
    }
    const moved = new Map();
    for (const [id, b] of before) {
      if (!alive(room, b.u)) { for (const r of recipients) seen[r].delete(id); continue; }
      if (b.u.q !== b.q || b.u.r !== b.r) moved.set(id, { u: b.u, from: [b.q, b.r], to: [b.u.q, b.u.r], kind: 'flee' });
    }
    if (moved.size) refreshSight(moved);

    for (const c of ctls()) {
      const { u, o } = c;
      if (u.isFleeing) { c.done = true; continue; }
      if (o.stance && !u.isGeneral && o.stance !== u.stance && c.budget > 0) {
        u.stance = o.stance;
        c.budget = Math.max(0, rules.snap(c.budget - S.stanceCost));
        room._record('stance', { u: u.id, s: u.stance });
        sendSeen(u, { k: 'stance', u: u.id, s: u.stance });
      }
      if (o.facing != null) c.budget = Math.max(0, rules.snap(c.budget - S.facingCost));
      if (o.ability && u.isGeneral) {
        const res = room.useGeneralAbility(c.owner, null, o.ability.targetId || null);
        if (res.ok) {
          const ev = { k: 'ability', playerId: c.owner, name: res.combatLog.abilityUsed, effects: res.combatLog.effects, targetPlayerId: res.combatLog.targetPlayerId || null };
          for (const id of recipients) send(id, sees(id, u) ? { ...ev, u: u.id } : ev);
        }
      }
      if (o.type === 'motivate' && u.isGeneral) {
        const res = room.motivateUnit(c.owner, u.id);
        if (res.ok) {
          for (const id of recipients) {
            if (id === c.owner || id === ALL) send(id, { k: 'motivate', u: u.id, success: res.success, count: res.count, d20: res.d20, charisma: res.charisma, moralGain: res.moralGain });
            else if (sees(id, u)) send(id, { k: 'motivate', u: u.id, success: res.success, count: res.count });
          }
        }
        c.done = true;
      }
      if (o.type === 'hold') c.done = true;
    }
    // shooters in the reaction stance (after this turn's stance changes) holding their ground; they do not fire
    // at enemies already in range at the start
    for (const c of ctls()) {
      c.reactor = (c.u.range || 1) > 1 && !c.u.isGeneral && !c.u.isFleeing && c.o.type === 'hold' && c.u.stance === S.reactionFireStance;
      if (c.reactor) c.inRange = enemiesInRange(c);
    }
  }
  finishTick();

  function enemiesInRange(c) {
    const out = new Set();
    for (const p of room.players) {
      if (p.id === c.owner) continue;
      for (const e of p.units) {
        if (e.q === null) continue;
        if (seen[c.owner].has(e.id) && hexDistance(c.u.q, c.u.r, e.q, e.r) <= effectiveRange(room, c.u, e)) out.add(e.id);
      }
    }
    return out;
  }

  const ended = () => room.phase !== 'battle';

  // ---- combat helpers ----
  function chargeExtra(c, target) {
    const u = c.u;
    if (c.chargeUsed || c.moved < S.charge.minHexes) return null;
    if (!(c.o.type === 'charge' || u.stance === 'charge')) return null;
    c.chargeUsed = true;
    if (target.typeId === S.antiCharge.lancierTypeId) return { attack: -S.antiCharge.attackMalus, power: 0, charge: 'stopped' };
    if (!target.isGeneral && target.stance === 'defense_combat') return { attack: 0, power: 0, charge: 'cancelled' };
    return { attack: S.charge.attack, power: S.charge.power, charge: 'bonus' };
  }

  function emitCombat(kind, attacker, target, log, aOwner, tOwner, seeBefore, extra) {
    for (const id of recipients) {
      let out;
      if (id === ALL) out = log;
      else out = combatFor(log, { attackerPlayerId: aOwner, targetPlayerId: tOwner, viewerId: id, seeAttacker: seeBefore[id].a, seeTarget: seeBefore[id].t });
      if (out) send(id, { k: 'combat', kind, charge: extra && extra.charge ? extra.charge : undefined, log: out });
    }
  }

  function witnesses(attacker, target) {
    const w = {};
    for (const id of recipients) w[id] = { a: sees(id, attacker), t: sees(id, target) };
    return w;
  }

  // Compute every strike of a phase from the state at the start of the phase, then apply them in order:
  // a unit destroyed (or routed) earlier in the phase no longer strikes and can no longer be struck.
  function resolveStrikes(strikes) {
    const snap = new Map();
    const frozen = (u) => { if (!snap.has(u.id)) snap.set(u.id, { ...u }); return snap.get(u.id); };
    // chariots also strike the enemy right behind their target (no reaction from the trampled unit)
    for (const s of [...strikes]) {
      if (s.duel || hexDistance(s.a.q, s.a.r, s.t.q, s.t.r) !== 1) continue;
      const u2 = room.trampleTarget(s.a, s.t);
      if (u2 && !strikes.some(x => x.a === s.a && x.t === u2)) strikes.splice(strikes.indexOf(s) + 1, 0, { a: s.a, t: u2, kind: 'trample', trample: true });
    }
    for (const s of strikes) { frozen(s.a); frozen(s.t); }
    const planned = strikes.map(s => {
      if (s.duel) return s;
      const isCac = s.trample || hexDistance(s.a.q, s.a.r, s.t.q, s.t.r) <= 1 || s.kind === 'encounter';
      const choice = s.trample ? 'rien' : s.kind === 'encounter' ? 'counter' : reactionOf(s.t, ctl.get(s.t.id));
      return { ...s, isCac, choice, result: room._resolveCombat(frozen(s.a), frozen(s.t), isCac, choice, s.extra) };
    });
    let n = 0;
    for (const s of planned) {
      if (ended()) break;
      const { a, t } = s;
      if (!alive(room, a) || !alive(room, t) || a.isFleeing) continue;
      const aP = room.getPlayer(a.playerId), tP = room.getPlayer(t.playerId);
      const w = witnesses(a, t);
      a.hasAttacked = true;
      room._reveal(a);
      let log;
      if (s.duel) {
        log = room._resolveDuel(a, t, aP, tP).combatLog;
      } else {
        a.facing = s.isCac ? hexFacing(a.q, a.r, t.q, t.r) : hexFacingRanged(a.q, a.r, t.q, t.r);
        if (s.choice === 'counter' || s.choice === 'absorb') {
          t.facing = hexFacing(t.q, t.r, a.q, a.r);
          if (s.isCac) room._reveal(t);
        }
        log = room._applyCombat(a, t, s.isCac, s.choice, s.result, aP, tP);
        if (s.extra && s.extra.charge) log.charge = s.extra.charge;
        if (s.trample) log.trample = true;
      }
      n++;
      emitCombat(s.duel ? 'duel' : s.kind, a, t, log, aP.id, tP.id, w, s.extra);
      for (const id of recipients) {
        if (log.targetKilled) seen[id].delete(t.id);
        if (log.attackerKilled) seen[id].delete(a.id);
      }
      if (s.c) s.c.struck = true;
      if (s.c2) s.c2.struck = true;
      // breakthrough: a unit in the Percée stance that wins its melee may move one more hex
      const c = s.c;
      if (c && s.isCac && !s.duel && a.stance === S.breakthroughStance && alive(room, a) && !a.isFleeing && c.o.type === 'move' && c.path.length
        && (log.targetKilled || t.isFleeing || (log.dmgReceived || 0) > (log.counterDmgReceived || 0))) {
        c.done = false;
        c.breakthrough = 1;
      }
    }
    return n;
  }

  // ---- movement helpers ----
  function blockedFor(c) {
    const own = c.owner;
    return (k) => {
      const occ = room.unitMap[k];
      return !!occ && occ !== c.u && (occ.playerId === own || seen[own].has(occ.id));
    };
  }

  // Melee approach: first step of the cheapest path to a hex adjacent to the target (or as close as possible)
  function approachStep(c, tq, tr) {
    const u = c.u;
    const { dist, prev } = rules.reachable(room.moveTable(), {
      start: { q: u.q, r: u.r }, maxCost: c.budget, minStep: c.moved === 0 && c.budget === c.speed0, mounted: rules.isMounted(u),
      hexAt: (k) => room.hexMap[k] || null, blocked: blockedFor(c),
      segAt: (a, b, cc, d) => room.segmentData[segmentEdgeKey(a, b, cc, d)] || null,
    });
    const startKey = hexKey(u.q, u.r);
    const d0 = hexDistance(u.q, u.r, tq, tr);
    let best = null;
    for (const [k, cost] of dist) {
      if (k === startKey) continue;
      const [q, r] = k.split(',').map(Number);
      const d = hexDistance(q, r, tq, tr);
      if (d === 0 || d >= d0) continue;
      const better = !best || d < best.d || (d === best.d && (cost < best.cost || (cost === best.cost && k < best.k)));
      if (better) best = { k, d, cost };
    }
    if (!best) return null;
    const path = rules.pathFromPrev(prev, startKey, best.k);
    return path && path.length ? path[0] : null;
  }

  function targetUnit(c) {
    const t = c.target ? room.findUnit(c.target) : null;
    if (!t || !alive(room, t)) return null;
    return t;
  }

  function wantedStep(c) {
    const u = c.u;
    if (c.done || u.isFleeing) return null;
    if (c.ranged) {
      // walks its approach path until the target is in range and in sight, then stops to shoot
      if (c.fired || !c.path.length) return null;
      const t = targetUnit(c);
      if (!t) { c.done = true; return null; }
      if (seen[c.owner].has(t.id) && hexDistance(u.q, u.r, t.q, t.r) <= effectiveRange(room, u, t)) return null;
      return c.path[0];
    }
    if (c.o.type === 'move') return c.path.length ? c.path[0] : null;
    if (c.o.type === 'attack' || c.o.type === 'charge') {
      const t = targetUnit(c);
      if (!t) { c.done = true; return null; }
      if (seen[c.owner].has(t.id)) c.lastSeen = [t.q, t.r];
      if (!c.lastSeen) return null;
      if (hexDistance(u.q, u.r, c.lastSeen[0], c.lastSeen[1]) <= 1) return null;
      return approachStep(c, c.lastSeen[0], c.lastSeen[1]);
    }
    return null;
  }

  function adjacentEnemies(c, q, r) {
    const out = [];
    for (const [dq, dr] of DIRS) {
      const occ = room.unitMap[hexKey(q + dq, r + dr)];
      if (occ && occ.playerId !== c.owner && alive(room, occ)) out.push(occ);
    }
    return out;
  }

  // ---------------- ticks ----------------
  let combats = 0;
  for (let t = 1; t <= S.maxTicks && !ended(); t++) {
    newTick(t);
    let activity = false;

    // (A) ranged fire, then reaction fire, on the positions at the start of the tick
    const shots = [];
    for (const c of ctls()) {
      if (c.fired || c.u.isFleeing) continue;
      if (c.ranged) {
        const tgt = targetUnit(c);
        if (!tgt) continue;
        if (seen[c.owner].has(tgt.id) && hexDistance(c.u.q, c.u.r, tgt.q, tgt.r) <= effectiveRange(room, c.u, tgt)) {
          shots.push({ a: c.u, t: tgt, c, kind: 'ranged' });
          c.fired = true;
        }
      } else if (c.reactor && c.reactQueue.length) {
        const cands = c.reactQueue.map(id => room.findUnit(id)).filter(e => e && alive(room, e) && seen[c.owner].has(e.id) && hexDistance(c.u.q, c.u.r, e.q, e.r) <= effectiveRange(room, c.u, e));
        c.reactQueue = [];
        if (!cands.length) continue;
        cands.sort((x, y) => hexDistance(c.u.q, c.u.r, x.q, x.r) - hexDistance(c.u.q, c.u.r, y.q, y.r) || idNum(x.id) - idNum(y.id));
        shots.push({ a: c.u, t: cands[0], c, kind: 'reaction' });
        c.fired = true;
      }
    }
    if (shots.length) {
      const n = resolveStrikes(shots);
      combats += n;
      activity = activity || n > 0;
      refreshSight();
      if (ended()) { finishTick(); break; }
    }

    // (B) simultaneous movement: one hex per tick, fixpoint over contests / swaps / occupied hexes
    const props = new Map(); // unitId -> { c, from, to, key, cost, ok }
    for (const c of ctls()) {
      const step = wantedStep(c);
      if (!step) continue;
      const cost = stepCost(room, c.u, c.u.q, c.u.r, step[0], step[1]);
      const minStep = c.moved === 0 && c.budget > 0 && c.budget === c.speed0; // nothing spent yet: one step is always allowed
      if (!isFinite(cost) || (cost > c.budget + 1e-9 && !minStep)) { c.done = true; if (c.o.type === 'move') c.path = []; continue; }
      props.set(c.u.id, { c, from: [c.u.q, c.u.r], to: step, key: hexKey(step[0], step[1]), cost, ok: true });
    }
    const encounters = [];
    const bumps = [];
    const ambushes = [];
    const engaged = new Set();
    const addEncounter = (x, y) => {
      if (engaged.has(x.c.u.id) || engaged.has(y.c.u.id)) return;
      engaged.add(x.c.u.id); engaged.add(y.c.u.id);
      encounters.push([x.c, y.c]);
    };
    for (let changed = true; changed;) {
      changed = false;
      const live = [...props.values()].filter(p => p.ok).sort((a, b) => byId(a.c, b.c));
      // contests for the same hex
      const byHex = new Map();
      for (const p of live) { if (!byHex.has(p.key)) byHex.set(p.key, []); byHex.get(p.key).push(p); }
      for (const group of byHex.values()) {
        if (group.length < 2) continue;
        const owners = new Set(group.map(p => p.c.owner));
        if (owners.size === 1) {
          group.sort((a, b) => b.c.speed0 - a.c.speed0 || byId(a.c, b.c));
          for (const p of group.slice(1)) { p.ok = false; changed = true; }
        } else {
          for (const p of group) { p.ok = false; changed = true; }
          for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
            if (group[i].c.owner !== group[j].c.owner) addEncounter(group[i], group[j]);
          }
        }
      }
      if (changed) continue;
      // swaps
      const at = new Map(live.map(p => [hexKey(p.from[0], p.from[1]), p]));
      for (const p of live) {
        const other = at.get(p.key);
        if (!other || other === p || !other.ok) continue;
        if (other.key === hexKey(p.from[0], p.from[1]) && other.c.owner !== p.c.owner) {
          p.ok = false; other.ok = false; changed = true;
          addEncounter(p, other);
        }
      }
      if (changed) continue;
      // hex occupied by a unit that stays
      for (const p of live) {
        const occ = room.unitMap[p.key];
        if (!occ || occ === p.c.u) continue;
        const leaving = props.get(occ.id);
        if (leaving && leaving.ok) continue;
        p.ok = false; changed = true;
        if (occ.playerId === p.c.owner) continue; // waits behind an ally
        if (!seen[p.c.owner].has(occ.id)) ambushes.push({ c: p.c, by: occ });
        else if (!engaged.has(p.c.u.id)) bumps.push({ c: p.c, t: occ });
      }
    }
    const moves = [...props.values()].filter(p => p.ok);
    for (const p of moves) delete room.unitMap[hexKey(p.from[0], p.from[1])];
    const moved = new Map();
    for (const p of moves) {
      const { c } = p;
      const u = c.u;
      u.q = p.to[0]; u.r = p.to[1];
      u.facing = hexFacing(p.from[0], p.from[1], u.q, u.r);
      u.hasMoved = true;
      c.budget = Math.max(0, rules.snap(c.budget - p.cost));
      c.moved++;
      if (c.path.length) c.path.shift();
      room.unitMap[hexKey(u.q, u.r)] = u;
      moved.set(u.id, { u, from: p.from, to: [u.q, u.r], kind: 'move' });
      if (!pathTrail.has(u.id)) pathTrail.set(u.id, [p.from]);
      pathTrail.get(u.id).push([u.q, u.r]);
    }
    const ambush = (c, by) => {
      c.done = true; c.path = []; c.budget = 0;
      room._reveal(by);
      c.u.facing = hexFacing(c.u.q, c.u.r, by.q, by.r);
      const ev = { k: 'ambush', u: c.u.id, by: by.id, q: by.q, r: by.r, playerId: c.owner, byPlayerId: by.playerId };
      for (const id of recipients) if (id === ALL || id === c.owner || id === by.playerId) send(id, ev);
    };
    for (const a of ambushes) ambush(a.c, a.by);
    const prevSeen = { ...seen };
    if (moves.length || ambushes.length) refreshSight(moved);
    activity = activity || moves.length > 0;

    // (C) contacts: arriving next to an enemy stops the unit (zone of control); melee attackers re-target it.
    // Discovering an enemy hidden in cover this way is an ambush: the unit loses the rest of its movement.
    for (const p of moves) {
      const { c } = p;
      const u = c.u;
      const before = new Set(adjacentEnemies(c, p.from[0], p.from[1]).map(e => e.id));
      const fresh = adjacentEnemies(c, u.q, u.r).filter(e => !before.has(e.id) && seen[c.owner].has(e.id));
      if (!fresh.length) continue;
      const hidden = fresh.find(e => !prevSeen[c.owner].has(e.id) && room._inCover(e.q, e.r));
      if (hidden) { ambush(c, hidden); continue; }
      if (c.breakthrough > 0) { c.breakthrough--; continue; }
      if (c.o.type === 'move') {
        c.done = true;
        // Percée: a unit in this stance stopped by contact attacks to force its way through
        if (u.stance === S.breakthroughStance && !u.isGeneral && !c.struck) {
          fresh.sort((x, y) => idNum(x.id) - idNum(y.id));
          c.pushThrough = fresh[0].id;
        }
        continue;
      }
      const tgt = targetUnit(c);
      if (tgt && hexDistance(u.q, u.r, tgt.q, tgt.r) <= 1) continue;
      fresh.sort((x, y) => idNum(x.id) - idNum(y.id));
      c.target = fresh[0].id;
      c.lastSeen = [fresh[0].q, fresh[0].r];
    }
    for (const c of ctls()) {
      if (!c.reactor || c.fired) continue;
      const now = enemiesInRange(c);
      for (const id of now) if (!c.inRange.has(id)) c.reactQueue.push(id);
      c.inRange = now;
    }

    // (D) melee: encounters, bumps into a unit that stayed, attack / charge orders in contact
    const strikes = [];
    const striking = new Set();
    for (const [x, y] of encounters) {
      if (x.u.isFleeing || y.u.isFleeing) continue;
      let a = x, d = y;
      const xc = x.o.type === 'charge' || x.u.stance === 'charge', yc = y.o.type === 'charge' || y.u.stance === 'charge';
      if (yc && !xc) { a = y; d = x; } else if (xc === yc && room._random() < 0.5) { a = y; d = x; }
      a.done = true; d.done = true;
      striking.add(a.u.id); striking.add(d.u.id);
      if (a.u.isGeneral && d.u.isGeneral) strikes.push({ a: a.u, t: d.u, c: a, c2: d, kind: 'encounter', duel: true });
      else strikes.push({ a: a.u, t: d.u, c: a, c2: d, kind: 'encounter', extra: chargeExtra(a, d.u) });
    }
    for (const { c, t: occ } of bumps) {
      if (striking.has(c.u.id) || c.struck || c.u.isFleeing || c.ranged) continue;
      c.done = true;
      striking.add(c.u.id);
      if (c.u.isGeneral && occ.isGeneral) strikes.push({ a: c.u, t: occ, c, kind: 'melee', duel: true });
      else { const extra = chargeExtra(c, occ); strikes.push({ a: c.u, t: occ, c, kind: extra && extra.charge === 'bonus' ? 'charge' : 'melee', extra }); }
    }
    for (const c of ctls()) {
      if (!c.pushThrough) continue;
      const occ = room.findUnit(c.pushThrough);
      c.pushThrough = null;
      if (!occ || !alive(room, occ) || striking.has(c.u.id) || c.struck || c.u.isFleeing || hexDistance(c.u.q, c.u.r, occ.q, occ.r) > 1) continue;
      striking.add(c.u.id);
      strikes.push({ a: c.u, t: occ, c, kind: 'melee', extra: chargeExtra(c, occ) });
    }
    const pending = [];
    for (const c of ctls()) {
      if (c.struck || c.ranged || striking.has(c.u.id) || c.u.isFleeing) continue;
      if (c.o.type !== 'attack' && c.o.type !== 'charge') continue;
      const tgt = targetUnit(c);
      if (!tgt || hexDistance(c.u.q, c.u.r, tgt.q, tgt.r) > 1 || !seen[c.owner].has(tgt.id)) continue;
      pending.push({ c, tgt });
    }
    for (const { c, tgt } of pending) {
      if (striking.has(c.u.id)) continue;
      const back = ctl.get(tgt.id);
      const mutual = back && !striking.has(tgt.id) && !back.struck && (back.o.type === 'attack' || back.o.type === 'charge') && back.target === c.u.id && pending.some(p => p.c === back);
      c.done = true;
      striking.add(c.u.id);
      if (mutual) {
        back.done = true;
        striking.add(tgt.id);
        if (c.u.isGeneral && tgt.isGeneral) strikes.push({ a: c.u, t: tgt, c, c2: back, kind: 'encounter', duel: true });
        else strikes.push({ a: c.u, t: tgt, c, c2: back, kind: 'encounter', extra: chargeExtra(c, tgt) });
        continue;
      }
      if (c.u.isGeneral && tgt.isGeneral) { strikes.push({ a: c.u, t: tgt, c, kind: 'melee', duel: true }); continue; }
      const extra = chargeExtra(c, tgt);
      strikes.push({ a: c.u, t: tgt, c, kind: extra && extra.charge === 'bonus' ? 'charge' : 'melee', extra });
    }
    if (strikes.length) {
      flushTrails();
      const n = resolveStrikes(strikes);
      combats += n;
      activity = activity || n > 0;
      refreshSight();
    }
    for (const c of ctl.values()) if (c.u.isFleeing) c.done = true;
    finishTick();
    if (!activity) break;
  }
  flushTrails();

  // ---------------- end of the turn ----------------
  newTick(-1);
  if (!ended()) {
    for (const c of ctls()) {
      if (c.ranged && !c.fired && !c.u.isFleeing) {
        for (const id of [c.owner, ALL]) send(id, { k: 'shot_lost', u: c.u.id, targetId: c.target });
      }
      if (c.o.facing != null && !c.u.isFleeing && !c.struck) {
        c.u.facing = c.o.facing;
        room._record('facing', { u: c.u.id, f: c.o.facing });
        sendSeen(c.u, { k: 'facing', u: c.u.id, f: c.o.facing });
      }
    }
  }
  finishTick();

  // number the ticks, drop empty trailing ticks per recipient (keep tick 0)
  const out = {};
  for (const id of recipients) {
    const list = views[id];
    const last = list[list.length - 1];
    if (last && last.t === -1) last.t = list.length > 1 ? list[list.length - 2].t + 1 : 1;
    while (list.length > 1 && !list[list.length - 1].events.length) list.pop();
    out[id] = { ticks: list };
  }
  const full = out[ALL];
  delete out[ALL];
  const P = S.playback;
  const durationMs = Math.max(P.minMs, full.ticks.reduce((s, tk) => s + P.tickMs + (tk.events.some(e => e.k === 'combat') ? P.combatMs : 0), 0));
  return { seed, full, views: out, combats, durationMs };
}

module.exports = { resolveTurn, mulberry32 };
