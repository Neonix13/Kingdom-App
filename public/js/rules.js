// Kingdom Battleground — shared rules: one file for the rule values and the movement algorithm.
// Server: require('game/rules') (re-exports this module). Client: window.KBRules (plain <script>).
// Every tunable value of the day/night cycle, ambushes, duels, objectives and room settings lives in RULES.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KBRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const RULES = {
    movement: {
      // Cost paid when leaving a hex of this terrain
      terrainCost: { plain: 1, road: 1 / 2, forest: 2, river: 2, building: 1, bridge: 1 / 2 }, // a bridge is a road over the water
      slopeUpPerLevel: 1,     // +1 per height level climbed (edge without cliff)
      slopeDownPerLevel: 0,   // free downhill
      blockedSegments: ['cliff', 'mur'],          // impassable for everyone (line of sight is not affected)
      ladder: { segment: 'echelle', cost: 3 },    // infantry and generals only; fixed cost, ignores the slope
      mountedCategories: ['Chevaux', 'Chars'],    // never cross cliffs, walls, ladders or stone stairs (escalier: fixed cost in segments data)
    },
    time: {
      startHour: 8,          // battle starts at 8:00
      dayStartHour: 6,       // day 6:00 -> 18:00, night 18:00 -> 6:00
      nightStartHour: 18,
    },
    night: {
      visionFactor: 0.5,     // vision range x0.5 (min 2 hexes)
      visionMin: 2,
      speedMalus: 1,         // -1 speed at the start of each turn (min 1)
      attackMod: { cac: -2, tir: -3 },
      // Rest stance bonus at night, per turn (flat values; applied to the stance ids listed here)
      restStances: { repos: { moral_tour: 20, vitalite_tour: 5, armure_tour: 0 }, defense_combat: { moral_tour: 5, vitalite_tour: 0, armure_tour: 0 } },
    },
    // Stances added by these rules when the stance data does not define them (game/data/stances has no rest stance)
    extraStances: {
      repos: {
        id: 'repos', name: 'Repos', icon: null,
        vitesse: -2,
        attack_cac: -3, attack_tir: -3,
        defense_cac: -2, defense_tir: -2,
        puissance_cac: -2, puissance_tir: -2,
        intimidation_cac: -1, intimidation_tir: -1,
        esquive_cac: -1, esquive_tir: -1,
        precision_cac: -2, precision_tir: -2,
        armure: 0, armure_tour: 0, moral_tour: 5, vitalite_tour: 2,
      },
    },
    concealment: {
      terrains: ['forest', 'building'], // units here are hidden from enemies...
      revealDistance: 1,                // ...unless an enemy unit is adjacent
      spyTypeId: 'espion',
      spyDistance: 4,                   // ...or an enemy spy is within 4 hexes (the spy sees inside forests up to 4 hexes)
      revealRounds: 1,                  // attacking reveals the unit until the end of its owner's next turn
    },
    // Vision (GameRoom.getVisibleHexes): range = general's Strategy (min 3), 2 inside a forest; forests block the view
    // beyond forestSight hexes; +1 per level above the target hex (generals: +2 per level of their own hex, all directions)
    vision: {
      unitRange: 3,
      forestRange: 2,
      forestSight: 2,                   // forest hexes farther than this are not seen from outside
      generalHeightFactor: 2,           // a general on high ground sees behind lower forests (not inside them)
      spy: { range: 6, forestRange: 4, forestSight: 4 },
      assassinHiddenBeyond: 4,          // assassins are invisible to enemies farther than 4 hexes (any terrain)
      // Line of sight (game/los.js), in height levels: a sight line from the eye (hex height + eyeHeight) to the target
      // (hex height + targetHeight) is blocked by any hex it crosses whose ground (+ canopy for forests, + building) is
      // higher than the line, and by walls on the edges it crosses (top = higher side + segment height).
      // Forests do not block within forestSight of the observer; a general sees over forests lower than his hex;
      // from inside a building, only the hexes reached without crossing another building hex are seen (no seeing
      // through rooms: own room, the rooms next to it, and outside through its own openings).
      los: {
        eyeHeight: 0.6,
        targetHeight: 0.4,
        canopyHeight: 1.2,
        buildingHeight: 1.0,
        canopyTerrains: ['forest'],
        buildingTerrains: ['building'],
        segmentHeights: { mur: 1.5 },   // sight-blocking segments (others, e.g. barrières, fences, do not block)
        terrainSegments: ['cliff'],     // drawn by the relief itself
        defaultWallHeight: 1.5,         // other impassable segments
      },
    },
    // Unit abilities (data/balance/units.json: bonusType + optional bonusValue / bonusRange / bonusCost; defaults below)
    abilities: {
      moral_near_general: { value: 10, charismaDivisor: 5 }, // piétaille: +value morale per turn within (general Charisma / 5) hexes of its general
      execute_low_hp: { value: 10 },                  // soldats: after its attack, an enemy under value % of its max vitality is executed
      defend_ranged: { value: 20 },                   // phalange: +value armour against shots (may absorb, except against archers)
      anti_cavalry: { value: 6, rangedArmor: 20 },    // lancier: +value power against horses and chariots (attack and riposte); +rangedArmor against shots
      sabotage: { cost: 2 },                          // espion: (vision: RULES.vision.spy) destroys an adjacent infrastructure for cost speed
      ambush: { range: 6, cost: 2 },                  // assassin: (invisible beyond RULES.vision.assassinHiddenBeyond) vanishes for the day if no enemy within range
      speed_free: { value: 1, attackCost: 2 },        // cavalier léger: attacking costs attackCost speed and it may move again; +value speed when no enemy is adjacent
      charge_bonus: { value: 50 },                    // cavalier lourd: value % of the morale damage it inflicts also hits the enemies adjacent to its target
      ranged_no_defense: {},                          // archers: the target makes no defence test
      build: { cost: 2 },                             // bâtisseurs: build on / burn an adjacent edge or hex for cost speed
      trample: {},                                    // char: drives through enemy units and strikes each one it crosses (no riposte)
      antiCavalryCategories: ['Chevaux', 'Chars'],
      // infrastructure an espion can destroy: segment -> what remains (null = nothing)
      sabotage_segments: { bridge: 'river', passerelle: 'river', barriere: null, chevaux_de_frise: null, echelle: 'cliff' },
      sabotage_terrain: { bridge: 'river' },
      // what bâtisseurs can do on the edge (or the hex) next to them
      build_kinds: {
        barriere: { label: 'Barrière', edgeFrom: [null], edgeTo: 'barriere' },
        chevaux_de_frise: { label: 'Chevaux de frise', edgeFrom: [null], edgeTo: 'chevaux_de_frise' },
        echelle: { label: 'Échelle', edgeFrom: ['cliff'], edgeTo: 'echelle' },
        pont: { label: 'Pont', edgeFrom: ['river'], edgeTo: 'bridge', terrainFrom: ['river'], terrainTo: 'bridge' },
        bruler: { label: 'Brûler', terrainFrom: ['forest'], terrainTo: 'plain' },
      },
    },
    // Combat resolution (GameRoom._resolveCombat): each 5 vitality rolls one d20 against the effective attack;
    // damage = successes × power × armour ratio, armour ratio = 1 - AR / (AR + armorK) with AR = (defender vitality / 5) × armour
    combat: {
      diceDivisor: 5,
      armorK: 100,
      // angle of attack, from the defender's point of view and stance: index = attacker direction relative to the
      // defender's facing (0 front, 1-2 front/back flank, 3 back...). +attack/power/intimidation for the attacker,
      // -armour/defence/power/intimidation for the defender
      angleMods: {
        marche: [0, 2, 2, 4, 2, 2],
        combat: [0, 0, 2, 4, 2, 0],
        charge: [2, 2, 4, 4, 4, 2],
        repos: [0, 2, 4, 4, 4, 2],
        defense_combat: [0, 0, 0, 4, 0, 0],
        defense_distance: [0, 2, 4, 4, 4, 2],
      },
      // generals: damage = (Force - d20 + base) × Power / powerDivisor × armour ratio / damageDivisor (÷2 more when absorbing);
      // morale = (Charisma - d20 + base) × Intimidation / moraleDivisor (same d20)
      general: { base: 80, powerDivisor: 5, damageDivisor: 2, moraleDivisor: 100 },
      archerTypes: ['archer', 'archer_elite'],
    },
    duel: {
      maxRounds: 3,          // exchanges
      die: 20,               // each exchange: d20 + Force for both generals, the higher one strikes
      armorFactor: 0.5,      // strike = weapon damage + margin - armor x 0.5 (min 1)
      loserMoraleShock: 0.15, // loser's army loses 15% of max morale
      winnerMoraleBoost: 0.10, // winner's units within boostRadius gain 10% of max morale
      boostRadius: 5,
      // the beaten general cannot move during his next turn
    },
    objectives: {
      defaultPoints: 1,      // points per round for each objective held
    },
    settings: {
      turnsPerHalfDay: { min: 5, max: 20, default: 12 },
      // annihilation: kill the enemy general(s), with an optional turn limit (then the strongest army wins);
      // capture: objectives on the map, the first to victoryPoints wins (or the last general standing)
      victoryMode: { values: ['annihilation', 'capture'], default: 'annihilation' },
      maxTurns: { min: 0, max: 200, default: 0 },          // annihilation: 0 = unlimited
      victoryPoints: { min: 1, max: 1000, default: 100 },  // capture: points to win
      turnTimer: { min: 0, max: 600, default: 0 },         // seconds, 0 = off (else >= 15)
      spectatorVision: { values: ['full', 'delayed', 'off'], default: 'full' },
      planningTimer: { min: 0, max: 600, default: 90 },    // simultaneous mode: seconds, 0 = off (else >= 15)
      commandPoints: { min: 0, max: 50, default: 0 },      // simultaneous mode: 0 = formula below, else fixed
      teamMode: { default: false },                        // players under the same flag (nation) are allies
      attackerBonus: { min: 0, max: 100000, default: 0 },  // maps with sides (siege): extra gold for the attackers
    },
    // Simultaneous mode (game/turns/simultaneous.js, game/rules/resolve.js)
    simultaneous: {
      commandPoints: { base: 2, strategyDivisor: 3 },   // units that may receive an order per turn = 2 + ceil(Strategy / 3)
      maxTicks: 40,
      stanceCost: 1, facingCost: 0,                     // taken from the speed budget, as in sequential mode (turning is free)
      // Defender reaction in place of the defense prompt (rien | counter | absorb); generals: counter
      stanceReaction: { marche: 'absorb', combat: 'counter', charge: 'counter', defense_combat: 'counter', defense_distance: 'absorb', repos: 'rien' },
      marchMovingReaction: 'rien',                      // a unit in Marche caught while it moved this turn does not defend
      charge: { minHexes: 2, attack: 2, power: 3 },     // first melee after >= 2 hexes, with a Charge order or in Charge stance
      antiCharge: { lancierTypeId: 'lancier', attackMalus: 2 }, // against spearmen the bonus becomes a malus; Def. combat cancels it
      reactionFireStance: 'defense_distance',           // shooters in this stance fire once at the first enemy entering range
      playback: { tickMs: 700, combatMs: 1300, minMs: 1500 },  // estimated playback duration (next planning starts after it)
    },
  };

  const EPS_DEN = 60; // costs are multiples of 1/60 (thirds, halves, quarters...)
  function snap(x) { return Math.round(x * EPS_DEN) / EPS_DEN; }

  function hexKey(q, r) { return q + ',' + r; }
  function edgeKey(q1, r1, q2, r2) {
    if (q1 < q2 || (q1 === q2 && r1 < r2)) return q1 + ',' + r1 + '|' + q2 + ',' + r2;
    return q2 + ',' + r2 + '|' + q1 + ',' + r1;
  }
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

  function isMounted(unit) {
    return !!unit && RULES.movement.mountedCategories.indexOf(unit.category) !== -1;
  }

  // Movement table: derived from the segment definitions (game/data/segments) + the rules above.
  // The server sends it in game_state.movementRules so the client computes exactly the same ranges.
  function movementTable(segmentDefs) {
    const m = RULES.movement;
    const seg = {};
    for (const type of Object.keys(segmentDefs || {})) {
      const d = segmentDefs[type] || {};
      const s = {
        blocked: !!d.infranchissable || m.blockedSegments.indexOf(type) !== -1,
        mountedBlocked: !!d.infranchissable_cavalerie,
        fixed: d.vitesse_fixe != null ? d.vitesse_fixe : null,
        extra: Math.max(0, -(d.vitesse || 0)),
        ladder: false,
      };
      if (type === m.ladder.segment) { s.blocked = false; s.mountedBlocked = true; s.fixed = m.ladder.cost; s.ladder = true; }
      seg[type] = s;
    }
    return { terrainCost: Object.assign({}, m.terrainCost), slopeUp: m.slopeUpPerLevel, slopeDown: m.slopeDownPerLevel, seg };
  }

  // Cost of one step from -> to (hex infos { terrain, height }), Infinity if impassable
  function stepCost(table, from, to, segType, mounted) {
    const s = segType ? table.seg[segType] : null;
    if (s) {
      if (s.blocked) return Infinity;
      if (s.mountedBlocked && mounted) return Infinity;
      if (s.fixed != null) return s.fixed;
    }
    let c = table.terrainCost[to.terrain || 'plain']; // paid on entering the hex
    if (c == null) c = 1;
    if (s) c += s.extra;
    const dh = (to.height || 0) - (from.height || 0);
    c += dh > 0 ? dh * table.slopeUp : -dh * table.slopeDown;
    return snap(c);
  }

  // Dijkstra from opts.start within opts.maxCost.
  //   hexAt(key) -> { terrain, height } | null (off map), blocked(key) -> true when the hex cannot be entered,
  //   segAt(q1, r1, q2, r2) -> segment type | null, mounted: bool,
  //   transit(key) -> true when a blocked hex can still be driven through (chariots), never as a destination
  //   minStep: the unit has not spent any speed this turn, so one step to a neighbour is always allowed
  //            (if passable), even when it costs more than maxCost: nobody stays stuck in a river or below a slope
  // Returns { dist: Map(key -> cost), prev: Map(key -> previous key) } (start included with cost 0).
  //   tops: { "q,r": height } wall walks above the gates (node "q,r^"), links: { node: [node...] } their connections
  //   (mapProps.gateTops); mounted units never go up there; start.level = 1 starts on a wall walk
  function reachable(table, opts) {
    const tops = opts.tops || null, links = opts.links || null;
    const startKey = hexKey(opts.start.q, opts.start.r) + (opts.start.level ? '^' : '');
    const maxCost = snap(opts.maxCost);
    const dist = new Map([[startKey, 0]]);
    const prev = new Map();
    const queue = [{ k: startKey, cost: 0 }];
    const at = (key) => {
      if (key.charAt(key.length - 1) !== '^') return opts.hexAt(key);
      const b = key.slice(0, -1);
      return tops && b in tops && opts.hexAt(b) ? { terrain: 'plain', height: tops[b] } : null;
    };
    while (queue.length) {
      let bi = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].cost < queue[bi].cost) bi = i;
      const cur = queue.splice(bi, 1)[0];
      const k = cur.k;
      if (cur.cost > dist.get(k)) continue;
      if (cur.cost >= maxCost) continue;
      const here = at(k);
      if (!here) continue;
      const top = k.charAt(k.length - 1) === '^';
      const [cq, cr] = (top ? k.slice(0, -1) : k).split(',').map(Number);
      const next = [];
      if (!top) for (const [dq, dr] of DIRS) next.push({ nk: hexKey(cq + dq, cr + dr), nq: cq + dq, nr: cr + dr, link: false });
      if (links && links[k] && !opts.mounted) for (const nk of links[k]) { const [nq, nr] = nk.replace('^', '').split(',').map(Number); next.push({ nk, nq, nr, link: true }); }
      for (const { nk, nq, nr, link } of next) {
        const there = at(nk);
        if (!there) continue;
        if (opts.blocked && opts.blocked(nk) && !(opts.transit && opts.transit(nk))) continue;
        // a wall-walk link ignores the sheer wall of the edge, but pays its stairs / ladder
        let seg = opts.segAt(cq, cr, nq, nr);
        if (link && seg !== 'escalier' && seg !== 'echelle') seg = null;
        const c = stepCost(table, here, there, seg, !!opts.mounted);
        if (!isFinite(c)) continue;
        let nc = snap(cur.cost + c);
        if (nc > maxCost) {
          if (!(opts.minStep && k === startKey && maxCost > 0)) continue;
          nc = maxCost;
        }
        if (!dist.has(nk) || nc < dist.get(nk)) {
          dist.set(nk, nc);
          prev.set(nk, k);
          queue.push({ k: nk, cost: nc });
        }
      }
    }
    return { dist, prev };
  }

  function hexDistance(q1, r1, q2, r2) {
    return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
  }

  // Attack range from a hex at height hFrom on a target at height hTo. Shooters (range > 1): +1 per level above the target,
  // -1 per level below (min 1). Melee units always strike adjacent hexes only.
  function attackRange(range, hFrom, hTo) {
    if ((range || 1) <= 1) return 1;
    return Math.max(1, range + ((hFrom || 0) - (hTo || 0)));
  }

  // Ability of a unit: { type, value, range, cost } (unit fields first, then the unit type table, then RULES defaults)
  function ability(unit, unitTypes) {
    if (!unit || unit.isGeneral) return null;
    const src = unit.bonusType ? unit : (unitTypes && unitTypes[unit.typeId]) || null;
    const type = src && src.bonusType;
    if (!type) return null;
    const d = RULES.abilities[type] || {};
    const pick = (k, dk) => (src[k] != null ? src[k] : (d[dk] != null ? d[dk] : 0));
    return { type, value: pick('bonusValue', 'value'), range: pick('bonusRange', 'range'), cost: pick('bonusCost', 'cost') };
  }

  // What a bâtisseur can do toward a neighbour: list of build kinds allowed by the current edge segment / hex terrain
  function buildOptions(segType, terrain) {
    const out = [];
    for (const [id, k] of Object.entries(RULES.abilities.build_kinds)) {
      if (k.edgeFrom && k.edgeFrom.indexOf(segType || null) !== -1) out.push({ id, target: 'edge' });
      else if (k.terrainFrom && k.terrainFrom.indexOf(terrain) !== -1) out.push({ id, target: 'hex' });
    }
    return out;
  }

  // What an espion can destroy toward a neighbour: { target: 'edge'|'hex', to } or null
  function sabotageOption(segType, terrain) {
    const a = RULES.abilities;
    if (segType && Object.prototype.hasOwnProperty.call(a.sabotage_segments, segType)) return { target: 'edge', to: a.sabotage_segments[segType] };
    if (terrain && Object.prototype.hasOwnProperty.call(a.sabotage_terrain, terrain)) return { target: 'hex', to: a.sabotage_terrain[terrain] };
    return null;
  }

  // A unit that has not spent any speed this turn (no move, stance change or pivot) may always take one step
  function hasFullSpeed(unit) {
    return !!unit && !unit.isFleeing && unit.speedRemaining > 0 && unit.turnSpeed != null && unit.speedRemaining >= unit.turnSpeed;
  }

  // Best hex from which a unit can strike target this turn, among the hexes of a reachable() result.
  //   opts: { start: {q, r}, target: {q, r}, range, heightAt(key) -> level, canStand(key) -> bool (optional) }
  // Melee: cheapest hex, then the highest. Shooters: farthest from the target, then cheapest, then the highest.
  // Returns { key, q, r, cost, path: [[q, r], ...] (start excluded, [] when no move is needed) } or null.
  // How a can strike t ({ q, r, level?, range }): 'melee', 'ranged' or null. Never straight down or up through a gate;
  // melee with a unit on the wall walk above a gate needs a direct access (gates.links), a shooter next to it without
  // one fires. gates = mapProps.gateTops(...) or null, heightAt(key) = ground height
  function combatKind(a, t, gates, heightAt) {
    const d = hexDistance(a.q, a.r, t.q, t.r);
    if (d === 0) return null;
    const ranged = (a.range || 1) > 1;
    const node = (u) => hexKey(u.q, u.r) + (u.level ? '^' : '');
    const h = (u) => (u.level && gates && gates.tops[hexKey(u.q, u.r)] != null ? gates.tops[hexKey(u.q, u.r)] : (heightAt(hexKey(u.q, u.r)) || 0));
    if (d === 1) {
      if (!a.level && !t.level) return 'melee';
      const l = gates && gates.links[node(a)];
      if (l && l.indexOf(node(t)) !== -1) return 'melee';
      return ranged ? 'ranged' : null;
    }
    return ranged && d <= attackRange(a.range, h(a), h(t)) ? 'ranged' : null;
  }

  function bestAttackHex(reach, opts) {
    const startKey = hexKey(opts.start.q, opts.start.r) + (opts.start.level ? '^' : '');
    const tq = opts.target.q, tr = opts.target.r;
    const ranged = (opts.range || 1) > 1;
    let best = null;
    for (const [k, cost] of reach.dist) {
      if (k !== startKey && opts.canStand && !opts.canStand(k)) continue;
      const s = stepOf(k);
      const q = s[0], r = s[1];
      const d = hexDistance(q, r, tq, tr);
      const from = { q, r, level: s[2] ? 1 : 0, range: opts.range };
      const h = s[2] && opts.gates ? opts.gates.tops[hexKey(q, r)] : (opts.heightAt(hexKey(q, r)) || 0);
      if (!combatKind(from, opts.target, opts.gates || null, opts.heightAt)) continue;
      const cand = { key: k, q, r, level: from.level, cost, d, h };
      if (!best) { best = cand; continue; }
      const cmp = ranged
        ? (best.d - d) || (cost - best.cost) || (best.h - h)
        : (cost - best.cost) || (best.h - h);
      if (cmp < 0 || (cmp === 0 && k < best.key)) best = cand;
    }
    if (!best) return null;
    const path = pathFromPrev(reach.prev, startKey, best.key);
    if (!path) return null;
    return { key: best.key, q: best.q, r: best.r, level: best.level, cost: best.cost, path };
  }

  // Path [[q, r], ...] from the start (excluded) to key, or null
  function pathFromPrev(prev, startKey, key) {
    if (key === startKey) return [];
    if (!prev.has(key)) return null;
    const out = [];
    for (let k = key; k && k !== startKey; k = prev.get(k)) out.unshift(stepOf(k));
    return out;
  }
  // Path step of a node key: [q, r] on the ground, [q, r, 1] on the wall walk above a gate ("q,r^")
  function stepOf(k) {
    if (k.charAt(k.length - 1) === '^') { const s = k.slice(0, -1).split(',').map(Number); s.push(1); return s; }
    return k.split(',').map(Number);
  }
  function stepKey(s) { return s[0] + ',' + s[1] + (s[2] ? '^' : ''); }

  // ---- drawing helper: smooth outline of a set of hexes (range / charisma zones, 2D and 3D) ----
  // keys: Set of "q,r" (center: extra "q,r" counted inside); edgeOf(q, r, d) -> [[x, y], [x, y]] the two corners of the edge
  // toward neighbour DIRS[d], in drawing coordinates. Returns closed loops [[x, y], ...] (outer contour and holes),
  // corners rounded off by Chaikin cutting (iters passes)
  function zoneLoops(keys, center, edgeOf, iters = 2) {
    const inside = new Set(keys);
    if (center) inside.add(center);
    const kp = (p) => Math.round(p[0] * 100) + ':' + Math.round(p[1] * 100);
    const next = new Map(), pts = new Map();
    for (const k of keys) {
      const [q, r] = k.split(',').map(Number);
      for (let d = 0; d < 6; d++) {
        if (inside.has(hexKey(q + DIRS[d][0], r + DIRS[d][1]))) continue;
        const [a, b] = edgeOf(q, r, d);
        const ka = kp(a), kb = kp(b);
        pts.set(ka, a); pts.set(kb, b);
        if (!next.has(ka)) next.set(ka, []);
        next.get(ka).push(kb);
        if (!next.has(kb)) next.set(kb, []);
        next.get(kb).push(ka);
      }
    }
    const used = new Set();
    const ek = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    const loops = [];
    for (const start of next.keys()) {
      for (const first of next.get(start)) {
        if (used.has(ek(start, first))) continue;
        const loop = [pts.get(start)];
        used.add(ek(start, first));
        let prev = start, cur = first;
        for (let guard = 0; cur !== start && guard < 100000; guard++) {
          loop.push(pts.get(cur));
          const nb = next.get(cur).find((n) => n !== prev && !used.has(ek(cur, n))) || next.get(cur).find((n) => !used.has(ek(cur, n)));
          if (!nb) break;
          used.add(ek(cur, nb));
          prev = cur; cur = nb;
        }
        if (loop.length >= 3) loops.push(loop);
      }
    }
    return loops.map((l) => {
      let out = l;
      for (let k = 0; k < iters; k++) {
        const nx = [];
        for (let i = 0; i < out.length; i++) {
          const a = out[i], b = out[(i + 1) % out.length];
          nx.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
        }
        out = nx;
      }
      return out;
    });
  }

  // ---- time ----
  function clampInt(v, min, max, def) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (!Number.isInteger(n)) return def;
    return Math.max(min, Math.min(max, n));
  }

  function hoursPerTurn(turnsPerHalfDay) {
    const s = RULES.settings.turnsPerHalfDay;
    return 12 / clampInt(turnsPerHalfDay, s.min, s.max, s.default);
  }

  // Hour of the day (0 <= h < 24) at round `turn` (1-based)
  function timeOfDay(turn, turnsPerHalfDay) {
    const h = RULES.time.startHour + (Math.max(1, turn || 1) - 1) * hoursPerTurn(turnsPerHalfDay);
    return Math.round((((h % 24) + 24) % 24) * 1000) / 1000;
  }

  function dayNumber(turn, turnsPerHalfDay) {
    const h = RULES.time.startHour + (Math.max(1, turn || 1) - 1) * hoursPerTurn(turnsPerHalfDay);
    return Math.floor((h - RULES.time.dayStartHour) / 24) + 1;
  }

  function isNightHour(h) {
    const t = RULES.time;
    return h >= t.nightStartHour || h < t.dayStartHour;
  }

  function formatHour(h) {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return String(hh % 24).padStart(2, '0') + ':' + String(mm % 60).padStart(2, '0');
  }

  // ---- room settings ----
  function defaultSettings() {
    const s = RULES.settings;
    return {
      turnsPerHalfDay: s.turnsPerHalfDay.default,
      victoryMode: s.victoryMode.default,
      maxTurns: s.maxTurns.default,
      victoryPoints: s.victoryPoints.default,
      turnTimer: s.turnTimer.default,
      spectatorVision: s.spectatorVision.default,
      planningTimer: s.planningTimer.default,
      commandPoints: s.commandPoints.default,
      teamMode: s.teamMode.default,
      attackerBonus: s.attackerBonus.default,
    };
  }

  // Merge a partial patch into settings; returns { settings, error }
  function mergeSettings(current, patch) {
    const s = RULES.settings;
    const out = Object.assign(defaultSettings(), current || {});
    if (!patch || typeof patch !== 'object') return { settings: out, error: null };
    const intField = (key, extra) => {
      if (!(key in patch)) return null;
      const v = typeof patch[key] === 'string' && patch[key].trim() !== '' ? Number(patch[key]) : patch[key];
      const lim = s[key];
      if (!Number.isInteger(v) || v < lim.min || v > lim.max || (extra && !extra(v))) return key;
      out[key] = v;
      return null;
    };
    const bad = intField('turnsPerHalfDay') || intField('maxTurns') || intField('victoryPoints')
      || intField('turnTimer', (v) => v === 0 || v >= 15)
      || intField('planningTimer', (v) => v === 0 || v >= 15) || intField('commandPoints') || intField('attackerBonus');
    if (bad) return { settings: current, error: bad };
    if ('teamMode' in patch) {
      if (typeof patch.teamMode !== 'boolean') return { settings: current, error: 'teamMode' };
      out.teamMode = patch.teamMode;
    }
    if ('spectatorVision' in patch) {
      if (s.spectatorVision.values.indexOf(patch.spectatorVision) === -1) return { settings: current, error: 'spectatorVision' };
      out.spectatorVision = patch.spectatorVision;
    }
    if ('victoryMode' in patch) {
      if (s.victoryMode.values.indexOf(patch.victoryMode) === -1) return { settings: current, error: 'victoryMode' };
      out.victoryMode = patch.victoryMode;
    }
    return { settings: out, error: null };
  }

  return {
    RULES, snap, hexKey, edgeKey, DIRS, isMounted,
    movementTable, stepCost, reachable, pathFromPrev, stepOf, stepKey,
    hexDistance, attackRange, combatKind, zoneLoops, hasFullSpeed, bestAttackHex, ability, buildOptions, sabotageOption,
    hoursPerTurn, timeOfDay, dayNumber, isNightHour, formatHour,
    defaultSettings, mergeSettings,
  };
});
