// Strategic layer of the bots, shared by the sequential and simultaneous planners.
// - mapIntel: key points of the public map (gates, wall walks, stairs and ladders, bridges), cached per map state
// - posture: defend a fortification (our zone behind walls the enemy has to cross), attack one, or field battle
// - assignments: one goal per unit — defenders' posts (gate, wall walk, reserve), a flank group on an alternative
//   crossing while the rest pins the main gate, objectives valued by victory points, a scout when nothing is in sight,
//   spies sent to sabotage the crossings the enemy needs
// Everything uses public map data, the bot's own units and what its player can see (world.enemies / memory).
const rules = require('../rules');
const { hexDistance, hexKey, segmentEdgeKey } = require('../HexUtils');
const { distanceField } = require('./pathing');
const { centroid, nearestHex, unitValue } = require('./world');

const parseKey = (k) => k.split(',').map(Number);
const isRanged = (u) => (u.range || 1) > 1;
const isMounted = (u) => rules.isMounted(u);
const isFoot = (u) => !u.isGeneral && !isMounted(u);

// ---------- map key points ----------

const intelCache = new Map();
function mapIntel(room) {
  const ed = room.mapEdits || {};
  const key = `${room.roomCode}|${room.mapId}|${Object.keys(ed.seg || {}).length}|${Object.keys(ed.ter || {}).length}`;
  if (intelCache.has(key)) return intelCache.get(key);
  const decor = (room.map && room.map.decor) || {};
  const ramparts = new Set((decor.ramparts || []).filter(k => room.hexMap[k]));
  const gates = (decor.props || []).filter(p => p.type === 'porte' && room.hexMap[hexKey(p.q, p.r)] && !ramparts.has(hexKey(p.q, p.r)))
    .map(p => ({ q: p.q, r: p.r }));
  const crossings = [];
  for (const [k, t] of Object.entries(room.segmentData || {})) {
    if (t !== 'escalier' && t !== 'echelle' && t !== 'rampe') continue;
    const [a, b] = k.split('|').map(parseKey);
    if (!room.hexMap[hexKey(a[0], a[1])] || !room.hexMap[hexKey(b[0], b[1])]) continue;
    crossings.push({ kind: t, a: { q: a[0], r: a[1] }, b: { q: b[0], r: b[1] } });
  }
  const bridges = Object.entries(room.terrainData || {}).filter(([k, t]) => t === 'bridge' && room.hexMap[k]).map(([k]) => {
    const [q, r] = parseKey(k);
    return { q, r };
  });
  const out = { ramparts, gates, crossings, bridges, hasFort: ramparts.size > 0 };
  intelCache.set(key, out);
  if (intelCache.size > 100) intelCache.delete(intelCache.keys().next().value);
  return out;
}

// Centre of each zone of the other players (fixed zones are public; random zones: the search route guess)
function enemyZoneCenters(world) {
  const { room, player } = world;
  const out = [];
  for (const p of room.players) {
    if (p.id === player.id || p.isEliminated || room.areAllies(player.id, p.id)) continue;
    const z = p.startingZone;
    if (z && z.tiles && z.tiles.length && room.map && Array.isArray(room.map.zones) && room.map.zones.length) {
      const c = centroid(z.tiles);
      out.push(nearestHex(room, c.q, c.r));
    }
  }
  if (!out.length && world.enemyGuess) out.push(world.enemyGuess);
  return out;
}

function ownCenter(world) {
  const z = world.player.startingZone;
  if (z && z.tiles && z.tiles.length) { const c = centroid(z.tiles); return nearestHex(world.room, c.q, c.r); }
  return centroid(world.mine) || world.room.mapCenter;
}

// ---------- posture ----------

// 'defend' when walls stand between our zone and the enemy, close to us; 'attack' when they stand close to the enemy;
// else 'field'. The defenders leave their walls once the enemy is inside or when they clearly outnumber it.
function posture(world, profile) {
  const intel = mapIntel(world.room);
  const tactics = profile.tactics || 0;
  if (!intel.hasFort || tactics < 0.5) return { kind: 'field', intel };
  const own = ownCenter(world);
  const foes = enemyZoneCenters(world);
  if (!own || !foes.length) return { kind: 'field', intel };
  const nearRampart = (c) => {
    let bd = Infinity;
    for (const k of intel.ramparts) { const [q, r] = parseKey(k); bd = Math.min(bd, hexDistance(q, r, c.q, c.r)); }
    return bd;
  };
  const dOwn = nearRampart(own);
  const dFoe = Math.min(...foes.map(nearRampart));
  const foe = foes.slice().sort((a, b) => nearRampart(a) - nearRampart(b))[0];
  if (dOwn <= 12 && dOwn + 4 < dFoe) {
    const fieldOwn = distanceField(world.room, own.q, own.r, false);
    // breach: an enemy unit is closer (walking) to our zone than our walls are
    const wallCost = Math.min(...[...intel.ramparts].map(k => fieldOwn.get(k)).filter(v => v != null), Infinity);
    const breached = world.enemies.some(e => { const f = fieldOwn.get(hexKey(e.q, e.r)); return f != null && f < wallCost - 1; });
    const seenFoes = new Set([...world.enemies.map(e => e.id), ...world.memory.enemies.keys()]).size;
    const strong = seenFoes >= Math.max(3, world.mine.length - 2) && require('./tactics').globalBalance(world) > 1.8;
    if (breached || strong) return { kind: 'field', intel, own, foe, sally: true };
    return { kind: 'defend', intel, own, foe, fieldOwn };
  }
  if (dFoe <= 12 && dFoe + 4 < dOwn) return { kind: 'attack', intel, own, foe };
  return { kind: 'field', intel, own, foe };
}

// ---------- assignments ----------

// Gate through which the enemy comes: the one with the lowest walking cost from the enemy zone
function mainGate(room, intel, from) {
  if (!intel.gates.length) return null;
  const field = distanceField(room, from.q, from.r, false);
  let best = null, bc = Infinity;
  for (const g of intel.gates) {
    const c = field.get(hexKey(g.q, g.r));
    if (c != null && c < bc) { bc = c; best = g; }
  }
  return best || intel.gates[0];
}

// Hexes next to (q, r) ordered by walking cost to `field` (inside first when field is our zone's)
function neighboursByField(room, q, r, field) {
  return rules.DIRS.map(([dq, dr]) => ({ q: q + dq, r: r + dr }))
    .filter(h => room.hexMap[hexKey(h.q, h.r)] && field.get(hexKey(h.q, h.r)) != null)
    .sort((a, b) => field.get(hexKey(a.q, a.r)) - field.get(hexKey(b.q, b.r)));
}

function defendPosts(world, profile, pos, out) {
  const { room } = world;
  const { intel, own, foe, fieldOwn } = pos;
  const gate = mainGate(room, intel, foe);
  const free = world.mine.filter(u => !u.isGeneral && !u.isFleeing && !out.has(u.id));
  const taken = new Set();
  const take = (u, h, extra) => { out.set(u.id, { q: h.q, r: h.r, kind: 'post', hold: true, ...extra }); taken.add(hexKey(h.q, h.r)); };
  const reachableFor = (u, h) => {
    const f = distanceField(room, h.q, h.r, isMounted(u));
    return f.get(hexKey(u.q, u.r)) != null;
  };
  const anchor = gate || foe;
  const special = (u) => u.typeId === 'espion' || u.typeId === 'assassin' || u.typeId === 'batisseurs';
  // a bâtisseur closes the main gate with chevaux de frise on its outer edge
  const builder = gate && free.find(u => u.typeId === 'batisseurs' && !out.has(u.id));
  if (builder && reachableFor(builder, gate)) take(builder, gate, { build: true, toward: foe });
  // infantry holds the gates, the main gate first, in Défense de combat
  const gates = intel.gates.slice().sort((a, b) => hexDistance(a.q, a.r, anchor.q, anchor.r) - hexDistance(b.q, b.r, anchor.q, anchor.r));
  const foot = free.filter(u => isFoot(u) && !isRanged(u) && !special(u) && !out.has(u.id))
    .sort((a, b) => (b.defense || 0) + (b.armor || 0) - (a.defense || 0) - (a.armor || 0));
  for (const g of gates.slice(0, 3)) {
    if (taken.has(hexKey(g.q, g.r))) continue;
    const u = foot.filter(x => !out.has(x.id)).sort((a, b) => hexDistance(a.q, a.r, g.q, g.r) - hexDistance(b.q, b.r, g.q, g.r))[0];
    if (u && reachableFor(u, g)) take(u, g, { stance: 'defense_combat' });
  }
  // shooters on the wall walk near the main gate
  const walk = [...intel.ramparts].map(parseKey).map(([q, r]) => ({ q, r }))
    .sort((a, b) => hexDistance(a.q, a.r, anchor.q, anchor.r) - hexDistance(b.q, b.r, anchor.q, anchor.r));
  for (const u of free.filter(x => isRanged(x) && !out.has(x.id))) {
    const h = walk.find(w => !taken.has(hexKey(w.q, w.r)) && hexDistance(w.q, w.r, anchor.q, anchor.r) <= 6 && reachableFor(u, w));
    if (h) take(u, h, { stance: 'defense_distance' });
  }
  // the rest waits behind the main gate as a reserve (cavalry further back, ready to strike what comes through)
  if (gate) {
    const inside = neighboursByField(room, gate.q, gate.r, fieldOwn)[0];
    if (inside) {
      const dq = inside.q - gate.q, dr = inside.r - gate.r;
      for (const u of free.filter(x => !out.has(x.id) && !x.isFleeing && !(x.typeId === 'espion' || x.typeId === 'batisseurs'))) {
        const depth = isMounted(u) ? 4 : 2;
        let best = null;
        for (let k = depth; k <= depth + 3 && !best; k++) {
          for (const [ox, oy] of [[0, 0], ...rules.DIRS]) {
            const h = nearestHex(room, gate.q + dq * k + ox, gate.r + dr * k + oy);
            const hk = hexKey(h.q, h.r);
            if (taken.has(hk) || intel.ramparts.has(hk) || fieldOwn.get(hk) == null) continue;
            if (fieldOwn.get(hk) > (fieldOwn.get(hexKey(gate.q, gate.r)) || 0)) continue;
            best = h; break;
          }
        }
        if (best && reachableFor(u, best)) take(u, best, { stance: isMounted(u) ? 'combat' : 'combat', reserve: true });
      }
    }
  }
}

// Walking path from `from` to `to` that avoids the hexes of `avoid` (the main gate): Dijkstra on the shared rules
function pathAvoiding(room, from, to, avoid, mounted) {
  const table = room.moveTable();
  const start = hexKey(from.q, from.r), goal = hexKey(to.q, to.r);
  const dist = new Map([[start, 0]]), prev = new Map();
  const open = [[0, from.q, from.r]];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
    const [d, q, r] = open.splice(bi, 1)[0];
    const k = hexKey(q, r);
    if (d > dist.get(k)) continue;
    if (k === goal) break;
    const here = room.hexMap[k];
    for (const [dq, dr] of rules.DIRS) {
      const nq = q + dq, nr = r + dr, nk = hexKey(nq, nr);
      const there = room.hexMap[nk];
      if (!there || avoid.has(nk)) continue;
      const c = rules.stepCost(table, here, there, room.segmentData[segmentEdgeKey(q, r, nq, nr)] || null, mounted);
      if (!isFinite(c)) continue;
      const nd = d + c;
      if (!dist.has(nk) || nd < dist.get(nk) - 1e-9) { dist.set(nk, nd); prev.set(nk, k); open.push([nd, nq, nr]); }
    }
    if (open.length > 6000) break;
  }
  if (!dist.has(goal)) return null;
  const path = [];
  for (let k = goal; k && k !== start; k = prev.get(k)) path.push(parseKey(k));
  path.reverse();
  return { cost: dist.get(goal), path };
}

// Alternative route for a flank group when the main gate is held: the walking route with every gate hex closed;
// its waypoints are the hexes on both sides of the first crossing it uses (stairs, ladder, ramp, another gate), or
// its midpoint. null when that route does not exist or is much longer than the one through the gate.
function flankCrossing(world, pos, gate) {
  const { room } = world;
  const { intel, own, foe } = pos;
  const army = centroid(world.mine.filter(u => !u.isGeneral)) || own;
  if (!gate) return null;
  const gates = new Set();
  for (const g of intel.gates) if (hexDistance(g.q, g.r, gate.q, gate.r) <= 2) gates.add(hexKey(g.q, g.r));
  const fieldFoe = distanceField(room, foe.q, foe.r, false);
  const main = fieldFoe.get(hexKey(army.q, army.r));
  const alt = pathAvoiding(room, army, foe, gates, false);
  if (!alt || main == null || alt.cost > main * 1.8 + 6) return null;
  const crossKinds = new Set(['escalier', 'echelle', 'rampe']);
  let prevHex = [army.q, army.r];
  for (const h of alt.path) {
    const seg = room.segmentData[segmentEdgeKey(prevHex[0], prevHex[1], h[0], h[1])];
    const isGate = intel.gates.some(g => g.q === h[0] && g.r === h[1]);
    if (crossKinds.has(seg) || isGate) {
      return { near: { q: prevHex[0], r: prevHex[1] }, far: { q: h[0], r: h[1] }, kind: isGate ? 'porte' : seg, cost: alt.cost };
    }
    prevHex = h;
  }
  const mid = alt.path[Math.floor(alt.path.length / 2)];
  return mid ? { near: { q: mid[0], r: mid[1] }, far: { q: mid[0], r: mid[1] }, kind: 'route', cost: alt.cost } : null;
}

function attackPlan(world, profile, pos, out) {
  const { room } = world;
  const m = world.memory;
  const gate = mainGate(room, pos.intel, centroid(world.mine) || pos.own);
  if (!m.flank || m.flank.turn < room.turn - 25) {
    const crossing = flankCrossing(world, pos, gate);
    const foot = world.mine.filter(u => isFoot(u) && !isRanged(u) && u.typeId !== 'espion' && u.typeId !== 'batisseurs');
    const n = crossing ? Math.max(1, Math.round(foot.length * (profile.tactics >= 1 ? 0.4 : 0.25))) : 0;
    // the units closest to the crossing go
    const ids = crossing ? foot.sort((a, b) => hexDistance(a.q, a.r, crossing.near.q, crossing.near.r) - hexDistance(b.q, b.r, crossing.near.q, crossing.near.r)).slice(0, n).map(u => u.id) : [];
    m.flank = { turn: room.turn, crossing, ids };
  }
  const fl = m.flank;
  if (!fl.crossing) return;
  for (const id of fl.ids) {
    const u = world.mine.find(x => x.id === id);
    if (!u || u.isFleeing || out.has(id)) continue;
    // through the crossing, then on to the enemy
    fl.done = fl.done || [];
    if (hexDistance(u.q, u.r, fl.crossing.far.q, fl.crossing.far.r) <= 1 && !fl.done.includes(id)) fl.done.push(id);
    if (fl.done.includes(id)) continue;
    // first the near side of the crossing (the gate stays out of the route), then through it
    const atNear = hexDistance(u.q, u.r, fl.crossing.near.q, fl.crossing.near.r) <= 1;
    const g = atNear ? fl.crossing.far : fl.crossing.near;
    out.set(id, { q: g.q, r: g.r, kind: 'flank' });
  }
}

// Objectives: points x turns left decide how many units go and where; an objective we hold is kept while enemies are
// near; enemy-held objectives are contested before neutral ones of the same value
function objectiveGoals(world, profile, out) {
  const { room, playerId } = world;
  const objs = room.objectives || [];
  if (!objs.length || !profile.objectives) return;
  const vp = room.isCapture();
  const maxT = room.settings.maxTurns > 0 ? room.settings.maxTurns : room.turn + 20;
  const left = Math.max(1, maxT - room.turn + 1);
  // with victory points: one more unit per three objectives, never more than half the army
  const army = world.mine.filter(u => !u.isGeneral).length;
  const want = Math.min(profile.objectives + (vp ? 1 + Math.floor(objs.length / 3) : 0), Math.max(1, Math.ceil(army / 2)));
  const free = world.mine.filter(u => !u.isGeneral && !u.isFleeing && !isRanged(u) && !out.has(u.id));
  const value = (o) => {
    let v = (o.points || 1) * Math.min(left, 10);
    if (o.owner && o.owner !== playerId && !room.areAllies(playerId, o.owner)) v *= vp ? 1.6 : 1.2;
    return v;
  };
  const scored = objs.map(o => ({ o, v: value(o) })).sort((a, b) => b.v - a.v);
  let n = 0;
  for (const { o } of scored) {
    if (n >= want) break;
    const occupant = room.unitMap[hexKey(o.q, o.r)];
    const ours = o.owner === playerId;
    // an objective stays ours once taken: it only needs a holder while enemies are around
    const threatened = world.enemies.some(e => hexDistance(e.q, e.r, o.q, o.r) <= 6);
    if (occupant && occupant.playerId === playerId) {
      if (!out.has(occupant.id) && (threatened || !ours)) { out.set(occupant.id, { q: o.q, r: o.r, kind: 'objective', hold: true }); n++; }
      continue;
    }
    if (ours && !threatened) continue;
    const u = free.filter(x => !out.has(x.id)).sort((a, b) => hexDistance(a.q, a.r, o.q, o.r) - hexDistance(b.q, b.r, o.q, o.r))[0];
    if (!u) break;
    // far objectives are only worth it with victory points
    if (!vp && hexDistance(u.q, u.r, o.q, o.r) > 14) continue;
    out.set(u.id, { q: o.q, r: o.r, kind: 'objective', hold: true });
    n++;
  }
}

// Spies: sabotage the crossings the enemy needs (ladders on our walls, bridges between the armies)
function spyGoals(world, profile, pos, out) {
  if ((profile.tactics || 0) < 0.5) return;
  const { room } = world;
  const foe = pos.foe || world.enemyGuess;
  const own = pos.own || centroid(world.mine);
  if (!foe || !own) return;
  for (const u of world.mine.filter(x => x.typeId === 'espion' && !x.isFleeing && !out.has(x.id))) {
    let best = null, bd = Infinity;
    const check = (near, far, seg, terrain) => {
      if (!rules.sabotageOption(seg, terrain)) return;
      // the far side faces the enemy, our own units are on our side
      if (hexDistance(far.q, far.r, foe.q, foe.r) >= hexDistance(near.q, near.r, foe.q, foe.r)) return;
      const d = hexDistance(u.q, u.r, near.q, near.r);
      if (d < bd && d <= 14) { bd = d; best = { q: near.q, r: near.r, tq: far.q, tr: far.r }; }
    };
    for (const c of pos.intel ? pos.intel.crossings : []) {
      if (c.kind !== 'echelle') continue;
      const [near, far] = hexDistance(c.a.q, c.a.r, own.q, own.r) <= hexDistance(c.b.q, c.b.r, own.q, own.r) ? [c.a, c.b] : [c.b, c.a];
      check(near, far, 'echelle', null);
    }
    for (const b of pos.intel ? pos.intel.bridges : []) {
      for (const [dq, dr] of rules.DIRS) {
        const near = { q: b.q + dq, r: b.r + dr };
        if (!room.hexMap[hexKey(near.q, near.r)] || room.terrainData[hexKey(near.q, near.r)] === 'river') continue;
        check(near, b, null, 'bridge');
      }
    }
    if (best) out.set(u.id, { q: best.q, r: best.r, kind: 'sabotage', tq: best.tq, tr: best.tr });
  }
}

// A light rider (or a spy) scouts a few hexes ahead of the army when the enemy has never been seen since turn 3
// (a lone rider far ahead gets caught: the scout stays within 6 hexes of the army)
function scoutGoal(world, profile, out) {
  if ((profile.tactics || 0) <= 0 || world.enemies.length || world.memory.enemies.size || world.room.turn < 3) return;
  const cands = world.mine.filter(u => !u.isGeneral && !u.isFleeing && !out.has(u.id) && (u.typeId === 'cavalier_leger' || u.typeId === 'espion'));
  const u = cands.sort((a, b) => (b.speed || 0) - (a.speed || 0))[0];
  const army = centroid(world.mine.filter(m => !m.isGeneral && m !== u));
  if (!u || !world.enemyGuess || !army) return;
  const g = world.enemyGuess;
  const d = hexDistance(army.q, army.r, g.q, g.r);
  const k = d > 6 ? 6 / d : 1;
  const h = nearestHex(world.room, Math.round(army.q + (g.q - army.q) * k), Math.round(army.r + (g.r - army.r) * k));
  out.set(u.id, { q: h.q, r: h.r, kind: 'scout' });
}

// Map unitId -> goal { q, r, kind: post|flank|objective|sabotage|scout, hold?, stance?, reserve? } and the posture
function assignments(world, profile) {
  const out = new Map();
  const pos = posture(world, profile);
  // when points decide the game the objectives come first, the walls get what is left
  const vp = world.room.isCapture();
  if (vp) objectiveGoals(world, profile, out);
  // measured (arena): with victory points in the sequential mode, sitting on the walls loses the race for points
  if (pos.kind === 'defend' && !(vp && world.room.mode !== 'simultaneous')) defendPosts(world, profile, pos, out);
  if (!vp) objectiveGoals(world, profile, out);
  if (pos.kind === 'attack') attackPlan(world, profile, pos, out);
  spyGoals(world, profile, pos, out);
  scoutGoal(world, profile, out);
  out.posture = pos.kind;
  return out;
}

// Edge next to unit u that a spy should sabotage now (adjacent infrastructure facing the enemy), or null
function sabotageTarget(world, u, goal) {
  const { room } = world;
  if (goal && goal.kind === 'sabotage' && u.q === goal.q && u.r === goal.r) {
    const opt = rules.sabotageOption(room.segmentData[segmentEdgeKey(u.q, u.r, goal.tq, goal.tr)] || null, room.terrainData[hexKey(goal.tq, goal.tr)]);
    // a bridge hex can only be destroyed empty
    if (opt && !(opt.target === 'hex' && room.unitMap[hexKey(goal.tq, goal.tr)])) return { q: goal.tq, r: goal.tr };
  }
  return null;
}

module.exports = { mapIntel, posture, assignments, sabotageTarget, enemyZoneCenters, isFoot };
