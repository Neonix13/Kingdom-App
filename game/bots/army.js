// Army building within the room budget. Variety comes from a seeded draw per room and player.
const UNITS = require('../data/units');
const AIAgent = require('../../simulation/AIAgent');
const { pick } = require('./rng');

// Weighted compositions for the optimized style: a front line, shooters, shock troops, sometimes a spy
const COMPOSITIONS = [
  { name: 'Ligne de phalanges', weights: { phalange: 4, lancier: 2, archer_elite: 3, archer: 2, cavalier_lourd: 2, espion: 1 } },
  { name: 'Cavalerie de choc', weights: { cavalier_lourd: 4, cavalier_leger: 3, lancier: 3, soldats: 2, archer: 2, char: 1 } },
  { name: 'Pluie de flèches', weights: { archer_elite: 4, archer: 3, phalange: 3, soldats: 2, cavalier_leger: 1, espion: 1 } },
  { name: 'Infanterie lourde', weights: { soldats: 4, phalange: 3, lancier: 2, assassin: 1, archer: 2, cavalier_leger: 1 } },
];

const RANGED = ['archer', 'archer_elite'];
const FRONT = ['soldats', 'phalange', 'lancier', 'pietaille'];

function addUnit(army, typeId) {
  const e = army.find(a => a.typeId === typeId);
  if (e) e.count++;
  else army.push({ typeId, count: 1 });
}

function cost(army) {
  return army.reduce((s, a) => s + UNITS[a.typeId].cost * a.count, 0);
}

function fillWeighted(army, budget, weights, rng, limit) {
  for (let guard = 0; guard < 400; guard++) {
    const left = budget - cost(army);
    if (cost(army) >= limit) break;
    const options = Object.entries(weights).filter(([t, w]) => w > 0 && UNITS[t] && UNITS[t].cost <= left);
    if (!options.length) break;
    const total = options.reduce((s, [, w]) => s + w, 0);
    let x = rng() * total;
    let chosen = options[0][0];
    for (const [t, w] of options) { x -= w; if (x <= 0) { chosen = t; break; } }
    addUnit(army, chosen);
  }
  return army;
}

function buildArmy({ budget, profile, rng, generalId }) {
  const limit = Math.floor(budget * (profile.budgetUse || 1));
  let army = [];
  if (profile.army === 'random') {
    const all = Object.keys(UNITS);
    fillWeighted(army, budget, Object.fromEntries(all.map(t => [t, 1])), rng, limit);
  } else if (profile.army === 'template') {
    // The balance simulator's heuristic composition, then the leftover gold in cheap infantry
    const sim = new AIAgent('bot').buildArmy(budget, generalId).filter(a => a.count > 0);
    army = sim.map(a => ({ ...a }));
    while (cost(army) > budget) {
      const last = army[army.length - 1];
      last.count--;
      if (!last.count) army.pop();
    }
    if (rng() < 0.5) fillWeighted(army, budget, { soldats: 2, lancier: 1, archer: 1, pietaille: 1 }, rng, limit);
  } else {
    const comp = pick(rng, COMPOSITIONS);
    // Guarantee one front-line unit and one shooter when the budget allows it
    const front = pick(rng, FRONT.filter(t => t !== 'pietaille'));
    if (UNITS[front].cost <= budget) addUnit(army, front);
    const ranged = budget >= 4000 ? 'archer_elite' : 'archer';
    if (cost(army) + UNITS[ranged].cost <= budget) addUnit(army, ranged);
    fillWeighted(army, budget, comp.weights, rng, limit);
    fillWeighted(army, budget, { pietaille: 1 }, rng, budget);
  }
  if (!army.length) {
    const cheapest = Object.keys(UNITS).sort((a, b) => UNITS[a].cost - UNITS[b].cost)[0];
    if (UNITS[cheapest].cost <= budget) addUnit(army, cheapest);
  }
  return army.filter(a => a.count > 0);
}

module.exports = { buildArmy, COMPOSITIONS, RANGED, FRONT };
