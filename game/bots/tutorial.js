// Scripted tutorial battle on the default map: small fixed armies, fixed deployment, a flag objective,
// a passive bot. The human always plays first in the first round.
const { hexKey } = require('../HexUtils');

const TUTORIAL = {
  mapId: 'default',
  budget: 100000,
  settings: { turnsPerHalfDay: 5, victoryPoints: 6, maxTurns: 0, turnTimer: 0 },
  human: {
    generalId: 'ou_ki',
    general: { q: 20, r: 9 },
    units: [
      { typeId: 'soldats', q: 20, r: 7 },
      { typeId: 'archer', q: 19, r: 8 },
      { typeId: 'cavalier_leger', q: 22, r: 7 },
    ],
  },
  bot: {
    generalId: 'go_hou_mei',
    difficulty: 'tutorial',
    general: { q: 26, r: -1 },
    units: [
      { typeId: 'pietaille', q: 20, r: 3 }, // hidden in the forest next to the flag
      { typeId: 'soldats', q: 23, r: 0 },
      { typeId: 'archer', q: 24, r: -1 },
    ],
  },
  objective: { id: 'tuto_drapeau', q: 21, r: 3, name: 'Drapeau du gué', type: 'flag', points: 1 },
};

function armyOf(spec) {
  const count = {};
  for (const u of spec.units) count[u.typeId] = (count[u.typeId] || 0) + 1;
  return Object.entries(count).map(([typeId, n]) => ({ typeId, count: n }));
}

function deploy(room, player, spec) {
  const spots = [{ ...spec.general, general: true }, ...spec.units];
  player.startingZone = { q: spec.general.q, r: spec.general.r, tiles: spots.map(s => ({ q: s.q, r: s.r })) };
  const free = player.units.slice();
  for (const s of spots) {
    const i = free.findIndex(u => (s.general ? u.isGeneral : u.typeId === s.typeId));
    if (i === -1) return { error: 'Tutoriel : unité manquante.' };
    const res = room.placeUnit(player.id, free[i].id, s.q, s.r);
    if (res.error) return res;
    free.splice(i, 1);
  }
  return room.setDeploymentReady(player.id);
}

// room: a fresh lobby room with the human host only. addBot: (room, opts) -> { ok, bot } | { error }
function setupTutorial(room, { addBot, botId, botColor }) {
  const human = room.players[0];
  if (!human || room.phase !== 'lobby') return { error: 'Tutoriel impossible.' };
  let res = room.setMap(TUTORIAL.mapId);
  if (res.error) return res;
  res = room.setSettings(TUTORIAL.settings);
  if (res.error) return res;
  room.budget = TUTORIAL.budget;
  room.tutorial = true;
  human.generalId = TUTORIAL.human.generalId;
  res = addBot(room, { id: botId, difficulty: TUTORIAL.bot.difficulty, generalId: TUTORIAL.bot.generalId, color: botColor });
  if (res.error) return res;
  const bot = res.bot;
  room.startGame();
  for (const [p, spec] of [[human, TUTORIAL.human], [bot, TUTORIAL.bot]]) {
    res = room.submitArmy(p.id, armyOf(spec));
    if (res.error) return res;
  }
  room.startDeployment();
  for (const [p, spec] of [[human, TUTORIAL.human], [bot, TUTORIAL.bot]]) {
    res = deploy(room, p, spec);
    if (res.error) return res;
  }
  room.startBattle();
  const o = TUTORIAL.objective;
  if (room.hexMap[hexKey(o.q, o.r)]) room.objectives = [{ ...o, owner: null }];
  // The human opens the battle
  room.turnOrder = [human.id, bot.id];
  room.currentTurnIndex = 0;
  const hr = room.initiativeRolls[human.id], br = room.initiativeRolls[bot.id];
  if (hr && br && hr.total <= br.total) {
    hr.d20 = Math.min(20, br.total - hr.strategy + 1);
    hr.total = hr.strategy + hr.d20;
    if (hr.total <= br.total) { br.d20 = 1; br.total = br.strategy + 1; }
  }
  for (const u of human.units) room._initUnitSpeedForTurn(u);
  for (const u of bot.units) u.speedRemaining = 0;
  room._recordKeyframe();
  return { ok: true, bot };
}

module.exports = { TUTORIAL, setupTutorial };
