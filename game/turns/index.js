// Turn controllers decide who may act and when a turn/round ends; GameRoom keeps the rules resolution.
// Interface: start(room), currentPlayerId(room), canAct(room, playerId), endTurn(room) -> { newRound, fled },
// settle(room) -> null | { newRound, fled }.
// A "simultaneous" controller (everyone plans orders, then all resolve together) is planned: register it here
// and flip `available` once implemented.
const sequential = require('./sequential');

const CONTROLLERS = { sequential };

const MODES = [
  { id: 'sequential', name: 'Séquentiel (initiative)', available: true },
  { id: 'simultaneous', name: 'Simultané (bientôt)', available: false },
];

function getTurnController(mode) {
  return CONTROLLERS[mode] || sequential;
}

function isModeAvailable(mode) {
  return !!CONTROLLERS[mode];
}

module.exports = { getTurnController, isModeAvailable, MODES };
