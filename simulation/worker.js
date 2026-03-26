const { parentPort, workerData } = require('worker_threads');
const Simulator = require('./Simulator');

const { matchups, budget, noInitiative } = workerData;
const results = [];

for (const { generalId1, generalId2 } of matchups) {
  try {
    const sim = new Simulator({ generalId1, generalId2, budget, noInitiative });
    const result = sim.run();
    results.push(result);
  } catch (e) {
    results.push({
      error: e.message,
      generalId1,
      generalId2,
      winner: null,
      turns: 0,
      isDraw: true,
    });
  }
}

parentPort.postMessage(results);
