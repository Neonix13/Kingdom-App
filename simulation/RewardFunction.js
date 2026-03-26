const { hexDistance } = require('../game/HexUtils');

class RewardFunction {
  evaluate(room, playerId) {
    let score = 0;
    const myPlayer = room.getPlayer(playerId);
    if (!myPlayer) return -Infinity;

    // Find enemies
    const enemies = room.players.filter(p => p.id !== playerId && !p.isEliminated);
    if (enemies.length === 0) return 1000; // we won

    // Check if own general is dead
    const myGeneral = myPlayer.units.find(u => u.isGeneral);
    if (!myGeneral || myPlayer.isEliminated) return -1000;

    // Check if enemy general is dead
    for (const enemy of enemies) {
      const enemyGeneral = enemy.units.find(u => u.isGeneral);
      if (!enemyGeneral || enemy.isEliminated) {
        score += 1000;
        continue;
      }

      // Enemy HP damage (normalized)
      for (const u of enemy.units) {
        if (u.q === null) continue;
        const hpLost = (u.maxVitality - u.vitality) / u.maxVitality;
        score += hpLost * 10;
        if (!u.isGeneral) {
          const moraleLost = (u.maxMorale - u.morale) / u.maxMorale;
          score += moraleLost * 5;
        }
        if (u.isFleeing) score += 8;
      }

      // Positional bonus: own units closer to enemy general
      if (enemyGeneral.q !== null) {
        for (const u of myPlayer.units) {
          if (u.q === null) continue;
          const dist = hexDistance(u.q, u.r, enemyGeneral.q, enemyGeneral.r);
          score += Math.max(0, 20 - dist); // closer = better, max 20 bonus
        }
      }
    }

    // Own HP preserved
    for (const u of myPlayer.units) {
      if (u.q === null) continue;
      const hpRatio = u.vitality / u.maxVitality;
      score += hpRatio * 3;
      if (u.isGeneral) {
        score += hpRatio * 15; // general survival heavily weighted
      }
    }

    // Unit count advantage
    const myUnitCount = myPlayer.units.filter(u => u.q !== null).length;
    const enemyUnitCount = enemies.reduce((s, e) => s + e.units.filter(u => u.q !== null).length, 0);
    score += (myUnitCount - enemyUnitCount) * 50;

    return score;
  }

  evaluateAction(room, playerId, action) {
    // Quick heuristic score for a candidate action without simulating
    let score = 0;

    if (action.type === 'attack') {
      const target = action.target;
      // Prioritize low-HP targets (finishing kills)
      const hpRatio = target.vitality / target.maxVitality;
      score += (1 - hpRatio) * 30; // bonus for attacking wounded
      // Huge bonus for attacking enemy general
      if (target.isGeneral) score += 200;
      // Bonus for attacking fleeing units (easy kills)
      if (target.isFleeing) score += 20;
      // Prefer targets with low morale
      if (!target.isGeneral && target.morale < target.maxMorale * 0.3) score += 15;
    }

    if (action.type === 'move') {
      // Score based on getting closer to nearest enemy
      if (action.distToNearestEnemy !== undefined) {
        score += Math.max(0, 30 - action.distToNearestEnemy);
      }
      // Terrain advantage
      if (action.terrain === 'forest') score += 3;   // defensive cover
      if (action.terrain === 'building') score += 5;  // strong defense
      if (action.terrain === 'road') score += 1;      // speed
      if (action.terrain === 'river') score -= 10;    // bad position
    }

    if (action.type === 'stance') {
      // Contextual stance scoring handled by caller
      score += action.stanceScore || 0;
    }

    return score;
  }
}

module.exports = RewardFunction;
