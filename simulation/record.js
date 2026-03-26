const path = require('path');
const fs = require('fs');
const Simulator = require('./Simulator');
const GENERALS = require('../game/data/generals');

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

const generalId1 = getArg('g1', 'ou_ki');
const generalId2 = getArg('g2', 'mou_bu');
const budget = parseInt(getArg('budget', '5000'));
const outputDir = getArg('output', path.join(__dirname, 'results'));

// Validate generals
const validIds = GENERALS.map(g => g.id);
if (!validIds.includes(generalId1)) { console.error(`Unknown general: ${generalId1}. Valid: ${validIds.join(', ')}`); process.exit(1); }
if (!validIds.includes(generalId2)) { console.error(`Unknown general: ${generalId2}. Valid: ${validIds.join(', ')}`); process.exit(1); }

const g1Name = GENERALS.find(g => g.id === generalId1).name;
const g2Name = GENERALS.find(g => g.id === generalId2).name;

console.log(`Recording: ${g1Name} vs ${g2Name} — Budget: ${budget}`);

const sim = new Simulator({ generalId1, generalId2, budget, record: true });
const result = sim.run();

if (result.error) {
  console.error('Simulation error:', result.error);
  process.exit(1);
}

const winnerName = result.isDraw ? 'DRAW' : (result.winner === 'p1' ? g1Name : g2Name);
console.log(`Result: ${winnerName} — ${result.turns} turns, ${result.replay.frames.length} frames`);

// Save replay
fs.mkdirSync(outputDir, { recursive: true });
const filename = `replay_${generalId1}_vs_${generalId2}_${Date.now()}.json`;
const filepath = path.join(outputDir, filename);
fs.writeFileSync(filepath, JSON.stringify(result.replay));

console.log(`Replay saved: ${filepath}`);
console.log(`\nOpen in browser: http://localhost:3000/replay.html?file=/simulation/results/${filename}`);
