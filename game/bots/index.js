// Server-side AI players. A bot is a regular room player ({ isBot: true }) bound to a synthetic connection
// ("bot:<id>"); it acts through the protocol handlers, so it follows exactly the same rules, checks and
// broadcasts as a human. This module decides the next protocol message of any bot of a room.
const GENERALS = require('../data/generals');
const { PROFILES, DIFFICULTIES, getProfile } = require('./profiles');
const { buildArmy } = require('./army');
const { nextPlacement } = require('./deploy');
const { planBattleStep, chooseDefense, USABLE_ABILITIES } = require('./battle');
const simultaneous = require('./simultaneous');
const { setupTutorial, TUTORIAL } = require('./tutorial');
const { rngFor, pick } = require('./rng');
const { createBotRunner } = require('./runner');

const BOT_CONN_PREFIX = 'bot:';

function isBotConn(connId) {
  return typeof connId === 'string' && connId.startsWith(BOT_CONN_PREFIX);
}

function bots(room) {
  return room.players.filter(p => p.isBot);
}

// Bots only play while a human (player or spectator) is connected: a room nobody watches stays still.
function humanPresent(room) {
  return room.players.some(p => !p.isBot && p.connected !== false) || (room.spectators || []).some(s => s.connected !== false);
}

function addBot(room, { id, difficulty = 'veteran', generalId = null, color = null } = {}) {
  if (!PROFILES[difficulty]) return { error: 'Difficulté inconnue.' };
  const taken = new Set(room.players.map(p => p.generalId).filter(Boolean));
  let general;
  if (generalId) {
    general = GENERALS.find(g => g.id === generalId);
    if (!general) return { error: 'Général inconnu.' };
    if (taken.has(generalId)) return { error: 'Ce général est déjà pris.' };
  } else {
    const free = GENERALS.filter(g => !taken.has(g.id));
    if (!free.length) return { error: 'Plus aucun général disponible.' };
    const withAbility = free.filter(g => USABLE_ABILITIES.has(g.id));
    const rng = rngFor(room.roomCode, id, 'general');
    general = pick(rng, withAbility.length && rng() < 0.5 ? withAbility : free);
  }
  room.addPlayer(id, `${general.name} (IA)`, { isBot: true, botDifficulty: difficulty, connId: BOT_CONN_PREFIX + id, connected: true, color });
  const bot = room.getPlayer(id);
  bot.generalId = general.id;
  return { ok: true, bot };
}

function lobbyInfo(room) {
  return bots(room).map(b => ({ id: b.id, difficulty: b.botDifficulty, label: getProfile(b.botDifficulty).label }));
}

// Next protocol message for one of the room's bots: { playerId, connId, action, data, kind } or null.
// kind: 'setup' (army, deployment), 'defense' or 'battle' (sets the pacing).
function planStep(room) {
  const list = bots(room);
  if (!list.length || !humanPresent(room)) return null;
  const step = (bot, action, data, kind) => ({ playerId: bot.id, connId: bot.connId, action, data: { roomCode: room.roomCode, ...data }, kind });
  if (room.phase === 'army_building') {
    for (const bot of list) {
      if (bot.isReady) continue;
      const units = buildArmy({ budget: room.budget, profile: getProfile(bot.botDifficulty), rng: rngFor(room.roomCode, bot.id, 'army'), generalId: bot.generalId });
      return step(bot, 'submit_army', { units }, 'setup');
    }
    return null;
  }
  if (room.phase === 'deployment') {
    for (const bot of list) {
      if (bot.isReady) continue;
      const next = nextPlacement(room, bot, rngFor(room.roomCode, bot.id, 'deploy', bot.units.filter(u => u.q !== null).length));
      if (next) return step(bot, 'place_unit', next, 'setup');
      return step(bot, 'deployment_ready', {}, 'setup');
    }
    return null;
  }
  if (room.phase !== 'battle') return null;
  const pending = Object.entries(room.pendingAttacks || {});
  for (const [attackId, a] of pending) {
    const target = room.getPlayer(a.targetPlayerId);
    if (target && target.isBot && !a.duel) {
      return step(target, 'defend_choice', { attackId, choice: chooseDefense(room, attackId, a, getProfile(target.botDifficulty)) }, 'defense');
    }
  }
  if (pending.length) return null;
  for (const bot of list) {
    if (bot.isEliminated) continue;
    const profile = getProfile(bot.botDifficulty);
    if (room.mode === 'simultaneous') {
      const s = simultaneous.planStep(room, bot, profile);
      if (s) return step(bot, s.action, s.data, 'plan');
      continue;
    }
    if (!room.canAct(bot.id)) continue;
    const s = planBattleStep(room, bot.id, profile);
    if (s) return { ...step(bot, s.action, s.data, 'battle'), why: s.why };
  }
  return null;
}

function stepDelay(room, s, cfg) {
  const pace = cfg.botPace == null ? 1 : cfg.botPace;
  if (s.kind === 'setup') return 250 * pace;
  if (s.kind === 'defense') return 900 * pace;
  if (s.kind === 'plan') return (s.action === 'set_orders' ? 1500 : 500) * pace;
  const bot = room.getPlayer(s.playerId);
  return getProfile(bot && bot.botDifficulty).delay * pace;
}

module.exports = {
  BOT_CONN_PREFIX, DIFFICULTIES, PROFILES, TUTORIAL,
  isBotConn, addBot, lobbyInfo, planStep, stepDelay, humanPresent,
  setupTutorial: (room, opts) => setupTutorial(room, { ...opts, addBot }),
  createBotRunner: (deps) => createBotRunner({ ...deps, planStep, stepDelay }),
};
