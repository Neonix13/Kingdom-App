// AI arena: plays bot-vs-bot games through the real protocol (memory store, fake clock) and reports results.
// Usage: node scripts/bots/arena.js [--games 20] [--maps default,kankoku] [--modes sequential,simultaneous]
//        [--pairs stratege:veteran,stratege:recrue] [--budget 5000] [--maxTurns 30] [--old game/bots_old]
// A difficulty suffixed with "_old" plays with the bot code found in --old (a copy of an older game/bots),
// to measure an AI change against its previous version: --pairs stratege:stratege_old
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith('--')) args[a.slice(2)] = arr[i + 1]; });
const GAMES = parseInt(args.games, 10) || 20;
const MAPS = (args.maps || 'default').split(',');
const MODES = (args.modes || 'simultaneous').split(',');
const PAIRS = (args.pairs || 'stratege:veteran').split(',').map(p => p.split(':'));
const BUDGET = parseInt(args.budget, 10) || 5000;
const MAX_TURNS = parseInt(args.maxTurns, 10) || 30;

const botsPath = require.resolve(path.join(ROOT, 'game/bots'));
const newBots = require(botsPath);
const oldBots = args.old ? require(path.resolve(ROOT, args.old)) : null;
const runnerMod = require(path.join(ROOT, 'game/bots/runner'));

// Bots of the room that play the old code: their difficulty is stored without the suffix, ids are remembered here
const oldIds = new Set();
function planStep(room) {
  const s = newBots.planStep(room);
  if (s && oldBots && oldIds.has(s.playerId)) {
    const s2 = oldBots.planStep(room);
    if (s2 && s2.playerId === s.playerId) return s2;
  }
  return s;
}
const timing = { plan: 0, calls: 0, max: 0 };
const TRACE = !!args.trace;
function trace(room, s) {
  const p = room.getPlayer(s.playerId);
  const orders = s.data.orders || {};
  if (s.action === 'end_turn') { const lc = room.combatLog ? room.combatLog.length : 0; }
  const units = p.units.filter(u => u.q !== null);
  const kinds = {};
  for (const o of Object.values(orders)) {
    const k = o.type + (o.stance ? '+' + o.stance : '') + (o.facing != null ? '+face' : '') + (o.path && o.type !== 'move' ? '+route' : '');
    kinds[k] = (kinds[k] || 0) + 1;
  }
  const foes = room.players.filter(x => x.id !== p.id).flatMap(x => x.units.filter(u => u.q !== null));
  const gap = (u) => foes.length ? Math.min(...foes.map(f => (Math.abs(u.q - f.q) + Math.abs(u.r - f.r) + Math.abs(u.q + u.r - f.q - f.r)) / 2)) : -1;
  const gen = units.find(u => u.isGeneral);
  console.log(`T${room.turn} ${oldIds.has(p.id) ? 'OLD' : 'NEW'} ${units.length}u vit ${units.reduce((a, u) => a + u.vitality, 0)} ordres ${JSON.stringify(kinds)} distEnnemi ${units.map(gap).join(',')} gen ${gen ? gap(gen) : 'mort'} stances ${units.map(u => (u.stance || 'G').slice(0, 3)).join(',')}`);
}
function timedPlan(room) {
  const t0 = process.hrtime.bigint();
  const s = planStep(room);
  if (TRACE && s && (s.action === 'set_orders' || s.action === 'end_turn')) trace(room, s);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (s && (s.kind === 'plan' || s.kind === 'battle')) { timing.plan += ms; timing.calls++; timing.max = Math.max(timing.max, ms); }
  return s;
}
require.cache[botsPath].exports = {
  ...newBots,
  createBotRunner: (deps) => runnerMod.createBotRunner({ ...deps, planStep: timedPlan, stepDelay: newBots.stepDelay }),
};

const GameRoom = require(path.join(ROOT, 'game/GameRoom'));
// What kills generals (elimination): attacker type, melee or ranged, turn
const kills = [];
const apply = GameRoom.prototype._applyCombat;
GameRoom.prototype._applyCombat = function (a, t, isCac, choice, result, ...rest) {
  const log = apply.call(this, a, t, isCac, choice, result, ...rest);
  if (log && log.generalKilled) kills.push(`${oldIds.has((t.isGeneral && t.vitality <= 0 ? t : a).playerId) ? 'OLD' : 'NEW'} ${a.isGeneral ? 'général' : a.typeId}${isCac ? '' : '(tir)'}→${t.isGeneral ? 'général' : t.typeId} T${this.turn}`);
  return log;
};
const { createProtocol } = require(path.join(ROOT, 'game/protocol'));
const { createMemoryStore } = require(path.join(ROOT, 'server/memoryStore'));

async function playGame(i, mapId, mode, a, b) {
  let t = 1_000_000;
  const errors = [];
  const transport = { async send() { return true; } };
  const store = createMemoryStore({ roundTrip: false });
  const log = { error: (...x) => errors.push(x.map(String).join(' ')), warn() {}, log() {} };
  const protocol = createProtocol({ store, transport, now: () => t, config: { botPace: 0 }, log });
  const code = `AR${i}${mode[0]}${mapId.slice(0, 2)}`.toUpperCase();
  const room = new GameRoom(code, null, { mapId, record: false });
  const side = (d, id, color) => {
    const old = d.endsWith('_old');
    const res = newBots.addBot(room, { id, difficulty: old ? d.slice(0, -4) : d, color });
    if (!res.ok) throw new Error(res.error);
    if (old) oldIds.add(id); else oldIds.delete(id);
  };
  // Alternate sides so that neither difficulty always gets the same deployment zone
  const [x, y] = i % 2 ? [b, a] : [a, b];
  side(x, 'b_one', '#4a90d9');
  side(y, 'b_two', '#e05050');
  room.hostId = 'b_one';
  room.mode = mode;
  room.setSettings({ maxTurns: MAX_TURNS });
  room.budget = BUDGET;
  room.startGame();
  await store.create(room);
  await protocol.handle('spec#1', 'join_room', { roomCode: code, playerName: 'Arbitre', spectator: true });
  let r = null;
  for (let k = 0; k < 4000; k++) {
    t += 30_000;
    await protocol.tick(code);
    r = await store.get(code);
    if (!r || r.phase === 'ended') break;
  }
  const players = r ? r.players : [];
  const winnerId = r && r.winner;
  const diffOf = (id) => (id === 'b_one' ? x : y);
  return { winner: winnerId ? diffOf(winnerId) : null, turn: r ? r.turn : 0, ended: r && r.phase === 'ended', errors: errors.length, players: players.length };
}

(async () => {
  const median = (v) => { const s = v.slice().sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  for (const mapId of MAPS) for (const mode of MODES) for (const [a, b] of PAIRS) {
    const res = [];
    timing.plan = 0; timing.calls = 0; timing.max = 0;
    for (let i = 0; i < GAMES; i++) res.push(await playGame(i, mapId, mode, a, b));
    const wa = res.filter(r => r.winner === a).length, wb = res.filter(r => r.winner === b).length;
    const draws = res.length - wa - wb;
    const err = res.reduce((s, r) => s + r.errors, 0);
    if (args.kills) { const c = {}; for (const k of kills.splice(0)) { const key = k.replace(/ T\d+$/, '').replace(/^(OLD|NEW) .*/, '$1'); c[key] = (c[key] || 0) + 1; } console.log('  morts de généraux :', JSON.stringify(c)); }
    console.log(`${mapId.padEnd(8)} ${mode.padEnd(12)} ${a} ${wa} – ${wb} ${b}  nuls ${draws}  tour médian ${median(res.map(r => r.turn))}  non finies ${res.filter(r => !r.ended).length}  erreurs ${err}  plan moyen ${(timing.plan / Math.max(1, timing.calls)).toFixed(1)} ms (max ${timing.max.toFixed(0)})`);
  }
})();
