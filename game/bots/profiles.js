// Difficulty levels. Every behaviour knob of the bots lives here.
//   delay        pause between two actions (ms, multiplied by config.botPace)
//   mistake      chance per unit and per turn to blunder (idle unit or random choice)
//   focus        0..1 weight of focus fire (finish wounded units, kill shots, enemy general)
//   terrain      0..1 weight of terrain (forest, buildings, height, rivers)
//   cohesion     max lead (in movement cost) of a unit over the army average while advancing
//   stance       0..1 chance of picking the right stance (else keeps the current one)
//   ability      0..1 chance of using the general's ability when it is useful
//   motivate     0..1 chance of motivating demoralised units
//   objectives   number of units sent to capture objectives
//   caution      distance the general keeps from visible enemies (0 = fights in the front line)
//   holdIfWeaker wait in good terrain when the local balance of forces is bad
//   army         army building style: random | template | optimized | fixed
const PROFILES = {
  recrue: {
    id: 'recrue', label: 'Recrue', delay: 1300, mistake: 0.25, focus: 0, terrain: 0, cohesion: Infinity,
    stance: 0.3, ability: 0.35, motivate: 0.3, objectives: 0, caution: 0, holdIfWeaker: false, retreatRanged: false,
    army: 'random', budgetUse: 0.85,
  },
  veteran: {
    id: 'veteran', label: 'Vétéran', delay: 1000, mistake: 0.08, focus: 0.6, terrain: 0.5, cohesion: 6,
    stance: 0.75, ability: 0.8, motivate: 0.8, objectives: 1, caution: 2, holdIfWeaker: false, retreatRanged: true,
    army: 'template', budgetUse: 1,
  },
  stratege: {
    id: 'stratege', label: 'Stratège', delay: 800, mistake: 0, focus: 1, terrain: 1, cohesion: 3,
    stance: 1, ability: 1, motivate: 1, objectives: 2, caution: 3, holdIfWeaker: true, retreatRanged: true,
    army: 'optimized', budgetUse: 1,
  },
  // Scripted opponent of the tutorial: holds its positions and only strikes what it can reach nearby
  tutorial: {
    id: 'tutorial', label: 'Tutoriel', delay: 1200, mistake: 0, focus: 0.3, terrain: 0, cohesion: Infinity,
    stance: 0, ability: 0, motivate: 0, objectives: 0, caution: 99, holdIfWeaker: false, retreatRanged: false,
    army: 'fixed', budgetUse: 1, hold: true, engageRadius: 2,
  },
};

const DIFFICULTIES = ['recrue', 'veteran', 'stratege'];

function getProfile(id) {
  return PROFILES[id] || PROFILES.veteran;
}

module.exports = { PROFILES, DIFFICULTIES, getProfile };
