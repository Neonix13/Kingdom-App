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
const budget = parseInt(getArg('budget', '10000'));
const threadCount = parseInt(getArg('threads', '4'));
const outputDir = getArg('output', path.join(__dirname, 'results'));
const noInitiative = args.includes('--no-initiative');
const simultaneous = args.includes('--simultaneous');

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
console.log(`  Mode: ${simultaneous ? 'simultaneous' : 'sequential'}`);
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

// When started by the admin UI (child_process.fork), progress and the report path are sent over IPC
const workerProgress = new Array(threadCount).fill(0);
let lastProgressSent = 0;
if (process.send) process.on('disconnect', () => process.exit(1));
function sendProgress(force) {
  if (!process.send) return;
  const now = Date.now();
  if (!force && now - lastProgressSent < 250) return;
  lastProgressSent = now;
  process.send({ type: 'progress', done: workerProgress.reduce((a, b) => a + b, 0), total: totalGames });
}

const workers = chunks.map((chunk, i) => {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'worker.js'), {
      workerData: { matchups: chunk, budget, noInitiative, simultaneous },
    });

    worker.on('message', (results) => {
      if (!Array.isArray(results)) {
        workerProgress[i] = results.done;
        sendProgress(false);
        return;
      }
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
    const balance = require('../data/balance');
    stats.exportJSON(reportPath, {
      params: { gamesPerMatchup, budget, threads: threadCount, initiative: !noInitiative, mode: simultaneous ? 'simultaneous' : 'sequential' },
      balance: { version: balance.globalVersion(), tables: balance.all() },
    });
    console.log(`Report saved to: ${reportPath}`);
    if (process.send) { sendProgress(true); process.send({ type: 'done', reportPath }); }

    // Print summary
    stats.printSummary();
    if (process.send) { process.removeAllListeners('disconnect'); process.disconnect(); }
  })
  .catch((err) => {
    console.error('Simulation failed:', err);
    process.exit(1);
  });
