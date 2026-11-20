// Turn controllers decide who may act and when a turn/round ends; GameRoom keeps the rules resolution.
// Interface: start(room), currentPlayerId(room), canAct(room, playerId), endTurn(room) -> { newRound, fled },
// settle(room) -> null | { newRound, fled }.
// simultaneous: everyone plans secret orders, then all resolve together (setOrders, commit, resolve, stateFor).
const sequential = require('./sequential');
const simultaneous = require('./simultaneous');

const CONTROLLERS = { sequential, simultaneous };

const MODES = [
  { id: 'sequential', name: 'Séquentiel (initiative)', available: true },
  { id: 'simultaneous', name: 'Simultané (ordres secrets)', available: true },
];

function getTurnController(mode) {
  return CONTROLLERS[mode] || sequential;
}

function isModeAvailable(mode) {
  return typeof mode === 'string' && Object.prototype.hasOwnProperty.call(CONTROLLERS, mode);
}

module.exports = { getTurnController, isModeAvailable, MODES };
