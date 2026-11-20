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
      terrainCost: { plain: 1, road: 1 / 3, forest: 2, river: 2, building: 1, bridge: 1 },
      slopeUpPerLevel: 1,     // +1 per height level climbed (edge without cliff)
      slopeDownPerLevel: 0,   // free downhill
      blockedSegments: ['cliff', 'mur'],          // impassable for everyone (line of sight is not affected)
      ladder: { segment: 'echelle', cost: 3 },    // infantry and generals only; fixed cost, ignores the slope
      mountedCategories: ['Chevaux', 'Chars'],    // never cross cliffs, walls or ladders
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
      spyDistance: 2,                   // ...or an enemy spy is within 2 hexes
      revealRounds: 1,                  // attacking reveals the unit until the end of its owner's next turn
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
      maxTurns: { min: 0, max: 200, default: 0 },          // 0 = unlimited
      victoryPoints: { min: 0, max: 1000, default: 0 },    // 0 = disabled
      turnTimer: { min: 0, max: 600, default: 0 },         // seconds, 0 = off (else >= 15)
      spectatorVision: { values: ['full', 'delayed', 'off'], default: 'full' },
      planningTimer: { min: 0, max: 600, default: 90 },    // simultaneous mode: seconds, 0 = off (else >= 15)
      commandPoints: { min: 0, max: 50, default: 0 },      // simultaneous mode: 0 = formula below, else fixed
    },
    // Simultaneous mode (game/turns/simultaneous.js, game/rules/resolve.js)
    simultaneous: {
      commandPoints: { base: 2, strategyDivisor: 3 },   // units that may receive an order per turn = 2 + ceil(Strategy / 3)
      maxTicks: 40,
      stanceCost: 2, facingCost: 1,                     // taken from the speed budget, as in sequential mode
      // Defender reaction in place of the defense prompt (rien | counter | absorb); generals: counter
      stanceReaction: { marche: 'absorb', combat: 'counter', charge: 'counter', percee: 'absorb', defense_combat: 'counter', defense_distance: 'absorb', repos: 'rien' },
      marchMovingReaction: 'rien',                      // a unit in Marche caught while it moved this turn does not defend
      charge: { minHexes: 2, attack: 2, power: 3 },     // first melee after >= 2 hexes, with a Charge order or in Charge stance
      antiCharge: { lancierTypeId: 'lancier', attackMalus: 2 }, // against spearmen the bonus becomes a malus; Def. combat cancels it
      reactionFireStance: 'defense_distance',           // shooters in this stance fire once at the first enemy entering range
      breakthroughStance: 'percee',                     // may keep moving one hex after winning a melee
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
    let c = table.terrainCost[from.terrain || 'plain'];
    if (c == null) c = 1;
    if (s) c += s.extra;
    const dh = (to.height || 0) - (from.height || 0);
    c += dh > 0 ? dh * table.slopeUp : -dh * table.slopeDown;
    return snap(c);
  }

  // Dijkstra from opts.start within opts.maxCost.
  //   hexAt(key) -> { terrain, height } | null (off map), blocked(key) -> true when the hex cannot be entered,
  //   segAt(q1, r1, q2, r2) -> segment type | null, mounted: bool
  // Returns { dist: Map(key -> cost), prev: Map(key -> previous key) } (start included with cost 0).
  function reachable(table, opts) {
    const startKey = hexKey(opts.start.q, opts.start.r);
    const maxCost = snap(opts.maxCost);
    const dist = new Map([[startKey, 0]]);
    const prev = new Map();
    const queue = [{ q: opts.start.q, r: opts.start.r, cost: 0 }];
    while (queue.length) {
      let bi = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].cost < queue[bi].cost) bi = i;
      const cur = queue.splice(bi, 1)[0];
      const k = hexKey(cur.q, cur.r);
      if (cur.cost > dist.get(k)) continue;
      if (cur.cost >= maxCost) continue;
      const here = opts.hexAt(k);
      if (!here) continue;
      for (const [dq, dr] of DIRS) {
        const nq = cur.q + dq, nr = cur.r + dr, nk = hexKey(nq, nr);
        const there = opts.hexAt(nk);
        if (!there) continue;
        if (opts.blocked && opts.blocked(nk)) continue;
        const c = stepCost(table, here, there, opts.segAt(cur.q, cur.r, nq, nr), !!opts.mounted);
        if (!isFinite(c)) continue;
        const nc = snap(cur.cost + c);
        if (nc > maxCost) continue;
        if (!dist.has(nk) || nc < dist.get(nk)) {
          dist.set(nk, nc);
          prev.set(nk, k);
          queue.push({ q: nq, r: nr, cost: nc });
        }
      }
    }
    return { dist, prev };
  }

  // Path [[q, r], ...] from the start (excluded) to key, or null
  function pathFromPrev(prev, startKey, key) {
    if (key === startKey) return [];
    if (!prev.has(key)) return null;
    const out = [];
    for (let k = key; k && k !== startKey; k = prev.get(k)) out.unshift(k.split(',').map(Number));
    return out;
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
      maxTurns: s.maxTurns.default,
      victoryPoints: s.victoryPoints.default,
      turnTimer: s.turnTimer.default,
      spectatorVision: s.spectatorVision.default,
      planningTimer: s.planningTimer.default,
      commandPoints: s.commandPoints.default,
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
      || intField('planningTimer', (v) => v === 0 || v >= 15) || intField('commandPoints');
    if (bad) return { settings: current, error: bad };
    if ('spectatorVision' in patch) {
      if (s.spectatorVision.values.indexOf(patch.spectatorVision) === -1) return { settings: current, error: 'spectatorVision' };
      out.spectatorVision = patch.spectatorVision;
    }
    return { settings: out, error: null };
  }

  return {
    RULES, snap, hexKey, edgeKey, DIRS, isMounted,
    movementTable, stepCost, reachable, pathFromPrev,
    hoursPerTurn, timeOfDay, dayNumber, isNightHour, formatHour,
    defaultSettings, mergeSettings,
  };
});
