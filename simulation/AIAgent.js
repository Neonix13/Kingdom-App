const UNITS = require('../game/data/units');
const GENERALS = require('../game/data/generals');
const STANCES = require('../game/data/stances');
const SEGMENTS = require('../game/data/segments');
const { hexDistance, hexKey, hexNeighbors, findPath, segmentEdgeKey } = require('../game/HexUtils');

const TERRAIN_COSTS = { plain: 1, road: 1, forest: 2, river: 2, building: 1, bridge: 1 };

class AIAgent {
  constructor(playerId, rewardFn) {
    this.playerId = playerId;
    this.rewardFn = rewardFn;
  }

  // --- ARMY BUILDING ---

  buildArmy(budget, generalId) {
    const general = GENERALS.find(g => g.id === generalId);
    const forceRatio = general ? general.force / 18 : 0.5;
    const strategyRatio = general ? general.strategy / 18 : 0.5;

    const pools = [
      { ratio: 0.25 + forceRatio * 0.05, types: ['soldats', 'phalange', 'lancier', 'espion', 'assassin'] },
      { ratio: 0.20 + strategyRatio * 0.05, types: ['archer', 'archer_elite'] },
      { ratio: 0.25, types: ['cavalier_leger', 'cavalier_lourd', 'char', 'batisseurs'] },
    ];

    // Normalize ratios
    const totalRatio = pools.reduce((s, p) => s + p.ratio, 0);
    for (const p of pools) p.ratio /= totalRatio;

    const army = [];
    let spent = 0;

    for (const pool of pools) {
      const poolBudget = Math.floor(budget * pool.ratio);
      let poolSpent = 0;

      // Filter types affordable within pool budget
      const affordableTypes = pool.types.filter(t => UNITS[t].cost <= poolBudget);
      if (affordableTypes.length === 0) continue;

      while (poolSpent < poolBudget) {
        const typeId = affordableTypes[Math.floor(Math.random() * affordableTypes.length)];
        const unit = UNITS[typeId];
        if (poolSpent + unit.cost > poolBudget) break;
        const existing = army.find(a => a.typeId === typeId);
        if (existing) {
          existing.count++;
        } else {
          army.push({ typeId, count: 1 });
        }
        poolSpent += unit.cost;
        spent += unit.cost;
      }
    }

    // Fill remaining budget with piétaille
    const remaining = budget - spent;
    if (remaining >= UNITS.pietaille.cost) {
      const count = Math.floor(remaining / UNITS.pietaille.cost);
      const existing = army.find(a => a.typeId === 'pietaille');
      if (existing) {
        existing.count += count;
      } else {
        army.push({ typeId: 'pietaille', count });
      }
    }

    return army;
  }

  // --- DEPLOYMENT ---

  deploy(room) {
    const player = room.getPlayer(this.playerId);
    const zone = player.startingZone;
    if (!zone || !zone.tiles || zone.tiles.length === 0) return;

    const enemies = room.players.filter(p => p.id !== this.playerId);
    let enemyCenterQ = 0, enemyCenterR = 0;
    if (enemies.length > 0 && enemies[0].startingZone) {
      enemyCenterQ = enemies[0].startingZone.q;
      enemyCenterR = enemies[0].startingZone.r;
    }

    // Sort tiles by distance to enemy (ascending = closest first)
    const sortedTiles = zone.tiles.slice().sort((a, b) => {
      const da = hexDistance(a.q, a.r, enemyCenterQ, enemyCenterR);
      const db = hexDistance(b.q, b.r, enemyCenterQ, enemyCenterR);
      return da - db;
    });

    // Flank detection
    const myCenterQ = zone.q;
    const myCenterR = zone.r;
    const axisQ = enemyCenterQ - myCenterQ;
    const axisR = enemyCenterR - myCenterR;
    const axisLen = Math.sqrt(axisQ * axisQ + axisR * axisR) || 1;

    function lateralOffset(tile) {
      const dq = tile.q - myCenterQ;
      const dr = tile.r - myCenterR;
      return Math.abs(dq * axisR - dr * axisQ) / axisLen;
    }

    // Categorize units
    const units = player.units.filter(u => u.q === null);
    const general = units.find(u => u.isGeneral);
    const ranged = units.filter(u => !u.isGeneral && u.category === 'Tireurs');
    const cavalry = units.filter(u => !u.isGeneral && (u.category === 'Chevaux' || u.category === 'Chars'));
    const infantry = units.filter(u => !u.isGeneral && u.category === 'Infanterie');

    const placed = new Set();

    const placeUnit = (unit, tiles) => {
      for (const tile of tiles) {
        const key = `${tile.q},${tile.r}`;
        if (placed.has(key)) continue;
        const result = room.placeUnit(this.playerId, unit.id, tile.q, tile.r);
        if (result.ok) {
          placed.add(key);
          return true;
        }
      }
      return false;
    };

    for (const u of infantry) placeUnit(u, sortedTiles);

    const midTiles = sortedTiles.slice(Math.floor(sortedTiles.length * 0.3));
    for (const u of ranged) placeUnit(u, midTiles);

    const flankTiles = sortedTiles.slice().sort((a, b) => lateralOffset(b) - lateralOffset(a));
    for (const u of cavalry) placeUnit(u, flankTiles);

    if (general) placeUnit(general, sortedTiles.slice().reverse());

    for (const u of units.filter(u => u.q === null)) placeUnit(u, sortedTiles);
  }

  // --- BATTLE TURN ---

  playTurn(room) {
    this._executeTurn(room, false);
  }

  playTurnRecorded(room) {
    return this._executeTurn(room, true);
  }

  _executeTurn(room, record) {
    const player = room.getPlayer(this.playerId);
    if (!player) return record ? [] : undefined;

    // Check if all enemies are actually eliminated (game over check without vision)
    const anyEnemyAlive = room.players.some(p => p.id !== this.playerId && !p.isEliminated);
    if (!anyEnemyAlive) return record ? [] : undefined;

    this._visibleCache = room.getVisibleHexes(this.playerId);
    const actions = record ? [] : null;
    const sortedUnits = this._sortUnitsByPriority(player.units);

    for (const unit of sortedUnits) {
      if (unit.q === null || unit.speedRemaining <= 0) continue;
      const freshEnemies = this._getEnemyUnits(room);
      this._playUnit(room, unit, freshEnemies, player, actions);
    }

    this._visibleCache = null;
    return actions;
  }

  _sortUnitsByPriority(units) {
    const priority = { 'Tireurs': 0, 'Chevaux': 1, 'Chars': 1, 'Infanterie': 2, 'Général': 3 };
    return units.slice().sort((a, b) => (priority[a.category] ?? 2) - (priority[b.category] ?? 2));
  }

  _getEnemyUnits(room) {
    const visible = this._visibleCache || room.getVisibleHexes(this.playerId);
    const enemies = [];
    for (const p of room.players) {
      if (p.id === this.playerId || p.isEliminated) continue;
      for (const u of p.units) {
        if (u.q === null) continue;
        if (visible.has(hexKey(u.q, u.r))) enemies.push(u);
      }
    }
    return enemies;
  }

  _playUnit(room, unit, enemies, player, actions) {
    // No visible enemies — advance toward enemy territory
    if (enemies.length === 0) {
      if (unit.speedRemaining > 0 && !unit.hasMoved) {
        if (!unit.isGeneral && !unit.isFleeing && unit.speedRemaining >= 2) {
          const bestStance = unit.category === 'Chevaux' || unit.category === 'Chars' ? 'charge' : 'marche';
          if (bestStance !== unit.stance) {
            const oldStance = unit.stance;
            room.changeStance(this.playerId, unit.id, bestStance);
            if (actions) actions.push({ type: 'stance', unitId: unit.id, unitName: unit.name, from: oldStance, to: bestStance });
          }
        }
        const fromQ = unit.q, fromR = unit.r;
        const moved = this._moveTowardEnemyZone(room, unit);
        if (moved && actions) actions.push({ type: 'move', unitId: unit.id, unitName: unit.name, fromQ, fromR, toQ: unit.q, toR: unit.r });
      }
      return;
    }

    // Step 1: Consider stance change
    if (!unit.isGeneral && !unit.isFleeing && unit.speedRemaining >= 2) {
      const bestStance = this._chooseBestStance(unit, enemies);
      if (bestStance && bestStance !== unit.stance) {
        const oldStance = unit.stance;
        room.changeStance(this.playerId, unit.id, bestStance);
        if (actions) actions.push({ type: 'stance', unitId: unit.id, unitName: unit.name, from: oldStance, to: bestStance });
      }
    }

    // Step 2: Try to attack from current position first
    if (!unit.hasAttacked) {
      const attackable = this._getAttackableEnemies(unit, enemies, room);
      if (attackable.length > 0) {
        const target = this._pickBestTarget(attackable);
        const result = room.initiateCombat(this.playerId, unit.id, target.id);
        if (result.pending) {
          const defense = this._chooseDefenseFor(result, room);
          const resolved = room.resolveAttack(result.attackId, defense);
          if (actions) actions.push({ type: 'attack', unitId: unit.id, unitName: unit.name, targetId: target.id, targetName: target.name, defense, combatLog: resolved.combatLog });
        }
        return;
      }
    }

    // Step 3: Move toward best target
    if (unit.speedRemaining > 0 && !unit.hasMoved) {
      const fromQ = unit.q, fromR = unit.r;
      const moved = this._moveTowardEnemy(room, unit, enemies);

      if (moved) {
        if (actions) actions.push({ type: 'move', unitId: unit.id, unitName: unit.name, fromQ, fromR, toQ: unit.q, toR: unit.r });

        // Step 4: Try to attack after moving
        if (!unit.hasAttacked) {
          const attackable = this._getAttackableEnemies(unit, this._getEnemyUnits(room), room);
          if (attackable.length > 0) {
            const target = this._pickBestTarget(attackable);
            const result = room.initiateCombat(this.playerId, unit.id, target.id);
            if (result.pending) {
              const defense = this._chooseDefenseFor(result, room);
              const resolved = room.resolveAttack(result.attackId, defense);
              if (actions) actions.push({ type: 'attack', unitId: unit.id, unitName: unit.name, targetId: target.id, targetName: target.name, defense, combatLog: resolved.combatLog });
            }
          }
        }
      }
    }

    // Step 5: General-specific actions
    if (unit.isGeneral && !unit.hasAttacked && unit.speedRemaining > 0) {
      this._playGeneral(room, unit, enemies, player, actions);
    }
  }

  // Dijkstra flood-fill to find all reachable hexes within speed budget
  _getReachableHexes(room, unit) {
    const speed = unit.speedRemaining;
    const reachable = new Map(); // hexKey -> { q, r, cost }
    const isCavalry = unit.category === 'Chevaux' || unit.category === 'Chars';

    const queue = [{ q: unit.q, r: unit.r, cost: 0 }];
    const dist = new Map();
    dist.set(hexKey(unit.q, unit.r), 0);

    while (queue.length > 0) {
      queue.sort((a, b) => a.cost - b.cost);
      const { q, r, cost } = queue.shift();

      if (cost > speed) continue;
      const key = hexKey(q, r);

      // Skip occupied hexes (except starting position)
      if (room.unitMap[key] && !(q === unit.q && r === unit.r)) continue;

      if (!(q === unit.q && r === unit.r)) {
        reachable.set(key, { q, r, cost });
      }

      for (const [nq, nr] of hexNeighbors(q, r)) {
        const nk = hexKey(nq, nr);
        if (!room.hexMap[nk]) continue;
        if (room.unitMap[nk]) continue;

        // Segment check
        const edgeK = segmentEdgeKey(q, r, nq, nr);
        const segType = room.segmentData?.[edgeK];
        const segDef = segType ? SEGMENTS[segType] : null;
        if (segDef) {
          if (segDef.infranchissable) continue;
          if (segDef.infranchissable_cavalerie && isCavalry) continue;
        }

        const srcTerrain = room.hexMap[hexKey(q, r)]?.terrain || 'plain';
        let stepCost = TERRAIN_COSTS[srcTerrain] ?? 1;
        if (segDef) {
          if (segDef.vitesse_fixe != null) {
            stepCost = segDef.vitesse_fixe;
          } else {
            stepCost += Math.max(0, -(segDef.vitesse || 0));
          }
        }

        const newCost = cost + stepCost;
        if (newCost > speed) continue;

        if (!dist.has(nk) || newCost < dist.get(nk)) {
          dist.set(nk, newCost);
          queue.push({ q: nq, r: nr, cost: newCost });
        }
      }
    }

    return reachable;
  }

  _moveTowardEnemy(room, unit, enemies) {
    const reachable = this._getReachableHexes(room, unit);
    if (reachable.size === 0) return false;

    // Find primary target: enemy general if visible, else nearest enemy
    const enemyGeneral = enemies.find(e => e.isGeneral);
    const nearestEnemy = this._findNearestEnemy(unit, enemies);
    const primaryTarget = enemyGeneral || nearestEnemy;
    if (!primaryTarget) return false;

    const currentDist = hexDistance(unit.q, unit.r, primaryTarget.q, primaryTarget.r);
    const heightData = room.heightData || {};

    let bestHex = null;
    let bestScore = -Infinity;

    for (const [key, hex] of reachable) {
      const distToTarget = hexDistance(hex.q, hex.r, primaryTarget.q, primaryTarget.r);
      const terrain = room.hexMap[key]?.terrain || 'plain';
      const h = heightData[key] || 0;

      let score = 0;

      // Primary: get closer to target
      score += (currentDist - distToTarget) * 10;

      // Terrain
      if (terrain === 'forest') score += 2;
      if (terrain === 'building') score += 4;
      if (terrain === 'road') score += 1;
      if (terrain === 'river') score -= 20;

      // Height advantage
      score += h * 2;

      // Ranged units: prefer staying at range
      if (unit.range > 1) {
        if (distToTarget <= 1) score -= 15;
        if (distToTarget >= 2 && distToTarget <= unit.range) score += 12;
      }

      // Check if we can attack from this hex
      const hA = heightData[key] || 0;
      for (const e of enemies) {
        const hT = heightData[hexKey(e.q, e.r)] || 0;
        const effectiveRange = (unit.range || 1) + Math.max(0, hA - hT);
        if (hexDistance(hex.q, hex.r, e.q, e.r) <= effectiveRange) {
          score += 30; // big bonus for being able to attack
          if (e.isGeneral) score += 50;
          break;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestHex = hex;
      }
    }

    if (!bestHex) return false;

    // Only move if it actually gets us closer or into attack range
    const newDist = hexDistance(bestHex.q, bestHex.r, primaryTarget.q, primaryTarget.r);
    if (newDist >= currentDist && bestScore <= 0) return false;

    const result = room.moveUnit(this.playerId, unit.id, bestHex.q, bestHex.r);
    return result.ok === true;
  }

  _moveTowardEnemyZone(room, unit) {
    const reachable = this._getReachableHexes(room, unit);
    if (reachable.size === 0) return false;

    // Target: enemy starting zone center
    const enemy = room.players.find(p => p.id !== this.playerId);
    if (!enemy || !enemy.startingZone) return false;
    const targetQ = enemy.startingZone.q;
    const targetR = enemy.startingZone.r;

    const currentDist = hexDistance(unit.q, unit.r, targetQ, targetR);
    let bestHex = null, bestScore = -Infinity;

    for (const [key, hex] of reachable) {
      const dist = hexDistance(hex.q, hex.r, targetQ, targetR);
      let score = (currentDist - dist) * 10;
      const terrain = room.hexMap[key]?.terrain || 'plain';
      if (terrain === 'river') score -= 20;
      if (terrain === 'road') score += 1;
      if (score > bestScore) { bestScore = score; bestHex = hex; }
    }

    if (!bestHex || bestScore <= 0) return false;
    const result = room.moveUnit(this.playerId, unit.id, bestHex.q, bestHex.r);
    return result.ok === true;
  }

  _chooseBestStance(unit, enemies) {
    const nearestEnemy = this._findNearestEnemy(unit, enemies);
    if (!nearestEnemy) return null;

    const dist = hexDistance(unit.q, unit.r, nearestEnemy.q, nearestEnemy.r);

    // Repos si très blessé et ennemi loin
    const hpRatio = unit.vitality / unit.maxVitality;
    const moraleRatio = unit.morale / (unit.maxMorale || 1);
    if (dist > 5 && (hpRatio < 0.4 || moraleRatio < 0.3)) return 'repos';

    if (unit.category === 'Chevaux' || unit.category === 'Chars') {
      if (dist > 3) return 'charge';
      if (dist <= 1) return 'combat';
      return 'combat';
    }

    if (unit.category === 'Tireurs') {
      if (dist <= 1) return 'defense_combat';
      return 'defense_distance';
    }

    // Infantry
    if (dist > 4) return 'marche';
    if (dist <= 1) return 'combat';
    if (dist <= 2) return 'combat';
    return 'marche';
  }

  _findNearestEnemy(unit, enemies) {
    let nearest = null, minDist = Infinity;
    for (const e of enemies) {
      const d = hexDistance(unit.q, unit.r, e.q, e.r);
      if (d < minDist) { minDist = d; nearest = e; }
    }
    return nearest;
  }

  _getAttackableEnemies(unit, enemies, room) {
    const heightData = room.heightData || {};
    const hA = heightData[hexKey(unit.q, unit.r)] || 0;
    return enemies.filter(e => {
      const hT = heightData[hexKey(e.q, e.r)] || 0;
      const effectiveRange = (unit.range || 1) + Math.max(0, hA - hT);
      return hexDistance(unit.q, unit.r, e.q, e.r) <= effectiveRange;
    });
  }

  _scoreAttack(attacker, target) {
    let score = 0;
    if (target.isGeneral) score += 200;
    score += (1 - target.vitality / target.maxVitality) * 40;
    if (target.isFleeing) score += 25;
    if (!target.isGeneral && target.morale < target.maxMorale * 0.3) score += 15;
    score += attacker.attack || attacker.force || 10;
    return score;
  }

  _pickBestTarget(targets) {
    let best = targets[0], bestScore = -Infinity;
    for (const t of targets) {
      let score = 0;
      if (t.isGeneral) score += 200;
      score += (1 - t.vitality / t.maxVitality) * 50;
      if (t.isFleeing) score += 30;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  _playGeneral(room, unit, enemies, player, actions) {
    const nearUnits = player.units.filter(u =>
      !u.isGeneral && u.q !== null && hexDistance(unit.q, unit.r, u.q, u.r) <= 3
    );
    const lowMoraleNearby = nearUnits.filter(u => u.morale < u.maxMorale * 0.5);

    if (lowMoraleNearby.length >= 2) {
      const result = room.motivateUnit(this.playerId, unit.id);
      if (actions && result.ok) actions.push({ type: 'motivate', unitId: unit.id, unitName: unit.name, success: result.success, count: result.count });
    } else {
      const attackable = this._getAttackableEnemies(unit, enemies, room);
      if (attackable.length > 0) {
        const target = this._pickBestTarget(attackable);
        const result = room.initiateCombat(this.playerId, unit.id, target.id);
        if (result.pending) {
          const defense = this._chooseDefenseFor(result, room);
          const resolved = room.resolveAttack(result.attackId, defense);
          if (actions) actions.push({ type: 'attack', unitId: unit.id, unitName: unit.name, targetId: target.id, targetName: target.name, defense, combatLog: resolved.combatLog });
        }
      }
    }
  }

  // --- DEFENSE ---

  chooseDefense(attackResult, room) {
    return this._chooseDefenseFor(attackResult, room);
  }

  _chooseDefenseFor(attackResult, room) {
    const targetPlayer = room.getPlayer(attackResult.targetPlayerId);
    if (!targetPlayer) return 'rien';

    const target = targetPlayer.units.find(u =>
      u.q === attackResult.targetQ && u.r === attackResult.targetR
    );
    if (!target) return 'rien';

    if (attackResult.isRanged) {
      if (attackResult.targetTypeId === 'phalange') return 'absorb';
      return 'rien';
    }

    const defBase = target.isGeneral ? target.force : target.defense;
    if (target.vitality < target.maxVitality * 0.3) return 'absorb';
    if (defBase >= 10) return 'counter';
    return 'absorb';
  }
}

module.exports = AIAgent;
