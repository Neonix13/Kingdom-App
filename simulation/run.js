const { Worker } = require('worker_threads');
const path = require('path');
const GENERALS = require('../game/data/generals');
const Stats = require('./Stats');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return defaultVal;
  return args[idx + 1];
}

const gamesPerMatchup = parseInt(getArg('games', '10'));
const budget = parseInt(getArg('budget', '2500'));
const threadCount = parseInt(getArg('threads', '4'));
const outputDir = getArg('output', path.join(__dirname, 'results'));
const noInitiative = args.includes('--no-initiative');

const GENERAL_IDS = GENERALS.map(g => g.id);

// Generate all matchup tasks
const allMatchups = [];
for (const g1 of GENERAL_IDS) {
  for (const g2 of GENERAL_IDS) {
    for (let i = 0; i < gamesPerMatchup; i++) {
      allMatchups.push({ generalId1: g1, generalId2: g2 });
    }
  }
}

const totalGames = allMatchups.length;
console.log(`\nBalance Simulator`);
console.log(`  Generals: ${GENERAL_IDS.length}`);
console.log(`  Games per matchup: ${gamesPerMatchup}`);
console.log(`  Total games: ${totalGames}`);
console.log(`  Budget: ${budget}`);
console.log(`  Threads: ${threadCount}`);
console.log(`  Initiative: ${noInitiative ? 'DISABLED (random start, alternating)' : 'enabled'}`);
console.log(`  Output: ${outputDir}\n`);

// Split matchups across threads
function chunkArray(arr, n) {
  const chunks = Array.from({ length: n }, () => []);
  for (let i = 0; i < arr.length; i++) {
    chunks[i % n].push(arr[i]);
  }
  return chunks;
}

const chunks = chunkArray(allMatchups, threadCount);
const stats = new Stats();
let completedWorkers = 0;
let completedGames = 0;
const startTime = Date.now();

console.log(`Starting simulation...`);

const workers = chunks.map((chunk, i) => {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'worker.js'), {
      workerData: { matchups: chunk, budget, noInitiative },
    });

    worker.on('message', (results) => {
      for (const result of results) {
        stats.recordGame(result);
        completedGames++;
      }
      completedWorkers++;
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const pct = Math.round((completedGames / totalGames) * 100);
      console.log(`  Worker ${i + 1}/${threadCount} done (${completedGames}/${totalGames} games, ${pct}%, ${elapsed}s elapsed)`);
      resolve();
    });

    worker.on('error', (err) => {
      console.error(`  Worker ${i + 1} error:`, err.message);
      reject(err);
    });
  });
});

Promise.all(workers)
  .then(() => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nAll ${totalGames} games completed in ${elapsed}s`);
    console.log(`Average: ${(totalGames / (elapsed / 1)).toFixed(1)} games/sec`);

    // Export report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const reportPath = path.join(outputDir, `report_${timestamp}.json`);
    stats.exportJSON(reportPath);
    console.log(`Report saved to: ${reportPath}`);

    // Print summary
    stats.printSummary();
  })
  .catch((err) => {
    console.error('Simulation failed:', err);
    process.exit(1);
  });
