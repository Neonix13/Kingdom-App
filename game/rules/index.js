// Server entry for the shared rules (public/js/rules.js is also loaded by the browser as window.KBRules)
const KB = require('../../public/js/rules.js');
const SEGMENTS = require('../data/segments');
const STANCES_DATA = require('../data/stances');
const ABILITIES = require('./abilities');

let balance = null;
try { balance = require('../../data/balance'); } catch (e) { /* plain data modules */ }

// Rebuilt when the balance data is hot-reloaded (tables are refilled in place)
let moveCache = { v: undefined, table: null };
function moveTable() {
  const v = balance ? balance.version('segments') : 0;
  if (!moveCache.table || moveCache.v !== v) moveCache = { v, table: KB.movementTable(SEGMENTS) };
  return moveCache.table;
}

function hasStance(id) {
  return typeof id === 'string' && (Object.prototype.hasOwnProperty.call(STANCES_DATA, id) || Object.prototype.hasOwnProperty.call(KB.RULES.extraStances, id));
}

function getStance(id) {
  if (Object.prototype.hasOwnProperty.call(STANCES_DATA, id)) return STANCES_DATA[id];
  if (Object.prototype.hasOwnProperty.call(KB.RULES.extraStances, id)) return KB.RULES.extraStances[id];
  return null;
}

function stanceList() {
  return { ...KB.RULES.extraStances, ...STANCES_DATA };
}

module.exports = { ...KB, get MOVE_TABLE() { return moveTable(); }, hasStance, getStance, stanceList, ABILITIES };
