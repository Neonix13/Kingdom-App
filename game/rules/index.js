// Server entry for the shared rules (public/js/rules.js is also loaded by the browser as window.KBRules)
const KB = require('../../public/js/rules.js');
const SEGMENTS = require('../data/segments');
const STANCES_DATA = require('../data/stances');
const ABILITIES = require('./abilities');

const MOVE_TABLE = KB.movementTable(SEGMENTS);
const STANCES = { ...KB.RULES.extraStances, ...STANCES_DATA };

module.exports = { ...KB, MOVE_TABLE, STANCES, ABILITIES };
