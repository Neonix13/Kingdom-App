const GENERALS = require('../game/data/generals');
const UNITS = require('../game/data/units');
const fs = require('fs');
const path = require('path');

const GENERAL_IDS = GENERALS.map(g => g.id);
const UNIT_TYPE_IDS = Object.keys(UNITS);

class Stats {
  constructor() {
    this.games = [];
  }

  recordGame(result) {
    this.games.push(result);
  }

  merge(otherStats) {
    this.games.push(...otherStats.games);
  }

  getMatchupMatrix() {
    const matrix = {};
    const counts = {};
    for (const gA of GENERAL_IDS) {
      matrix[gA] = {};
      counts[gA] = {};
      for (const gB of GENERAL_IDS) {
        matrix[gA][gB] = 0;
        counts[gA][gB] = 0;
      }
    }

    for (const game of this.games) {
      if (game.error) continue;
      const g1 = game.generalId1;
      const g2 = game.generalId2;
      counts[g1][g2]++;
      if (game.isDraw) {
        matrix[g1][g2] += 0.5;
      } else if (game.winner === 'p1') {
        matrix[g1][g2] += 1;
      }
      // If p2 wins, g1 vs g2 gets 0 (the reverse matchup g2 vs g1 is separate)
    }

    // Convert to win rates with CI
    const winRates = {};
    const ci95 = {};
    for (const gA of GENERAL_IDS) {
      winRates[gA] = {};
      ci95[gA] = {};
      for (const gB of GENERAL_IDS) {
        const n = counts[gA][gB];
        if (n === 0) {
          winRates[gA][gB] = null;
          ci95[gA][gB] = null;
        } else {
          const p = matrix[gA][gB] / n;
          winRates[gA][gB] = Math.round(p * 1000) / 10;
          ci95[gA][gB] = Math.round(1.96 * Math.sqrt(p * (1 - p) / n) * 1000) / 10;
        }
      }
    }
    return { winRates, ci95, counts };
  }

  getGeneralReport() {
    const report = {};
    for (const g of GENERAL_IDS) {
      report[g] = { wins: 0, losses: 0, draws: 0, totalGames: 0, avgTurns: 0, totalTurns: 0 };
    }

    for (const game of this.games) {
      if (game.error) continue;
      const g1 = game.generalId1;
      const g2 = game.generalId2;

      report[g1].totalGames++;
      report[g2].totalGames++;
      report[g1].totalTurns += game.turns;
      report[g2].totalTurns += game.turns;

      if (game.isDraw) {
        report[g1].draws++;
        report[g2].draws++;
      } else if (game.winner === 'p1') {
        report[g1].wins++;
        report[g2].losses++;
      } else {
        report[g1].losses++;
        report[g2].wins++;
      }
    }

    for (const g of GENERAL_IDS) {
      const r = report[g];
      r.avgTurns = r.totalGames > 0 ? Math.round(r.totalTurns / r.totalGames * 10) / 10 : 0;
      r.winRate = r.totalGames > 0 ? Math.round((r.wins / r.totalGames) * 1000) / 10 : 0;
      r.ci95 = r.totalGames > 0
        ? Math.round(1.96 * Math.sqrt((r.winRate / 100) * (1 - r.winRate / 100) / r.totalGames) * 1000) / 10
        : 0;
      r.name = GENERALS.find(gen => gen.id === g)?.name || g;
    }

    return report;
  }

  getUnitEfficiency() {
    const stats = {};
    for (const typeId of UNIT_TYPE_IDS) {
      stats[typeId] = {
        name: UNITS[typeId].name,
        cost: UNITS[typeId].cost,
        totalDeployed: 0,
        totalSurvived: 0,
        totalDamageTaken: 0,
        totalMoraleLost: 0,
        survivalRate: 0,
        avgHpLostPercent: 0,
      };
    }
    // Also track general stats
    stats['general'] = {
      name: 'Général',
      cost: 0,
      totalDeployed: 0,
      totalSurvived: 0,
      totalDamageTaken: 0,
      survivalRate: 0,
      avgHpLostPercent: 0,
    };

    for (const game of this.games) {
      if (game.error || !game.finalStats) continue;

      for (const playerId of ['p1', 'p2']) {
        const initial = game.initialStats[playerId];
        const final = game.finalStats[playerId];
        if (!initial || !final) continue;

        // Build map of final units
        const finalMap = {};
        for (const u of final.units) {
          finalMap[u.id] = u;
        }

        for (const u of initial.units) {
          const typeId = u.typeId || 'general';
          if (!stats[typeId]) continue;
          stats[typeId].totalDeployed++;

          const finalU = finalMap[u.id];
          if (finalU && finalU.alive && finalU.vitality > 0) {
            stats[typeId].totalSurvived++;
          }
          const hpLost = finalU ? (u.maxVitality - finalU.vitality) : u.maxVitality;
          stats[typeId].totalDamageTaken += hpLost;
          if (!u.isGeneral && finalU) {
            const moraleLost = u.maxMorale ? (u.maxMorale - (finalU.morale || 0)) : 0;
            if (stats[typeId].totalMoraleLost !== undefined) {
              stats[typeId].totalMoraleLost += moraleLost;
            }
          }
        }
      }
    }

    for (const typeId of [...UNIT_TYPE_IDS, 'general']) {
      const s = stats[typeId];
      if (!s) continue;
      s.survivalRate = s.totalDeployed > 0
        ? Math.round((s.totalSurvived / s.totalDeployed) * 1000) / 10
        : 0;
      const p = s.survivalRate / 100;
      s.survivalCI95 = s.totalDeployed > 0
        ? Math.round(1.96 * Math.sqrt(p * (1 - p) / s.totalDeployed) * 1000) / 10
        : 0;
      s.avgHpLostPercent = s.totalDeployed > 0
        ? Math.round((s.totalDamageTaken / (s.totalDeployed * (UNITS[typeId]?.maxVitality || 100))) * 1000) / 10
        : 0;
    }

    return stats;
  }

  getArmyCompositionStats() {
    const compStats = { winners: {}, losers: {} };
    for (const typeId of UNIT_TYPE_IDS) {
      compStats.winners[typeId] = 0;
      compStats.losers[typeId] = 0;
    }
    let winnerGames = 0, loserGames = 0;

    for (const game of this.games) {
      if (game.error || game.isDraw || !game.army1 || !game.army2) continue;

      const winnerArmy = game.winner === 'p1' ? game.army1 : game.army2;
      const loserArmy = game.winner === 'p1' ? game.army2 : game.army1;

      winnerGames++;
      loserGames++;
      for (const { typeId, count } of winnerArmy) {
        compStats.winners[typeId] = (compStats.winners[typeId] || 0) + count;
      }
      for (const { typeId, count } of loserArmy) {
        compStats.losers[typeId] = (compStats.losers[typeId] || 0) + count;
      }
    }

    // Averages
    const avgWinner = {}, avgLoser = {};
    for (const typeId of UNIT_TYPE_IDS) {
      avgWinner[typeId] = winnerGames > 0 ? Math.round((compStats.winners[typeId] / winnerGames) * 100) / 100 : 0;
      avgLoser[typeId] = loserGames > 0 ? Math.round((compStats.losers[typeId] / loserGames) * 100) / 100 : 0;
    }

    return { avgWinner, avgLoser };
  }

  exportJSON(filepath) {
    const report = {
      timestamp: new Date().toISOString(),
      totalGames: this.games.length,
      errors: this.games.filter(g => g.error).length,
      matchupMatrix: this.getMatchupMatrix(),
      generalReport: this.getGeneralReport(),
      unitEfficiency: this.getUnitEfficiency(),
      armyComposition: this.getArmyCompositionStats(),
    };

    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
    return report;
  }

  printSummary() {
    console.log('\n========================================');
    console.log('  BALANCE SIMULATION REPORT');
    console.log('========================================\n');

    const generalReport = this.getGeneralReport();
    const sorted = Object.entries(generalReport)
      .sort((a, b) => b[1].winRate - a[1].winRate);

    console.log('--- GENERAL WIN RATES (95% CI) ---');
    console.log('');
    for (const [, r] of sorted) {
      const bar = '█'.repeat(Math.round(r.winRate / 2.5)) + '░'.repeat(40 - Math.round(r.winRate / 2.5));
      console.log(`  ${r.name.padEnd(14)} ${r.winRate.toFixed(1).padStart(5)}% ±${r.ci95.toFixed(1)}%  ${bar}  (${r.wins}W/${r.losses}L/${r.draws}D, n=${r.totalGames})`);
    }

    // Flag outliers
    console.log('\n--- BALANCE FLAGS ---');
    for (const [id, r] of sorted) {
      if (r.winRate > 60) console.log(`  ⚠ ${r.name} may be TOO STRONG (${r.winRate}% winrate)`);
      if (r.winRate < 40) console.log(`  ⚠ ${r.name} may be TOO WEAK (${r.winRate}% winrate)`);
    }

    const unitEff = this.getUnitEfficiency();
    console.log('\n--- UNIT SURVIVAL RATES (95% CI) ---');
    const unitSorted = Object.entries(unitEff)
      .filter(([id]) => id !== 'general')
      .sort((a, b) => b[1].survivalRate - a[1].survivalRate);
    for (const [, s] of unitSorted) {
      console.log(`  ${s.name.padEnd(18)} Survival: ${s.survivalRate.toFixed(1).padStart(5)}% ±${s.survivalCI95.toFixed(1)}%  AvgHPLost: ${s.avgHpLostPercent.toFixed(1).padStart(5)}%  (n=${s.totalDeployed})`);
    }

    // Matchup matrix
    const { winRates } = this.getMatchupMatrix();
    console.log('\n--- MATCHUP MATRIX (row = P1, col = P2, value = P1 win%) ---');
    const names = GENERALS.map(g => g.name.substring(0, 8).padEnd(8));
    console.log('          ' + names.join(' '));
    for (const gA of GENERAL_IDS) {
      const nameA = GENERALS.find(g => g.id === gA).name.substring(0, 8).padEnd(8);
      const row = GENERAL_IDS.map(gB => {
        const v = winRates[gA][gB];
        if (v === null) return '   --   ';
        return v.toFixed(0).padStart(4) + '%   ';
      }).join('');
      console.log(`  ${nameA}  ${row}`);
    }

    console.log('\n========================================\n');
  }
}

module.exports = Stats;
