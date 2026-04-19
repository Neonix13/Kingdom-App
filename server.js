const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const GameRoom = require('./game/GameRoom');
const AIAgent = require('./simulation/AIAgent');
const GENERALS = require('./game/data/generals');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public'), { etag: false, lastModified: false, setHeaders: (res, filePath) => { if (filePath.endsWith('.js') || filePath.endsWith('.css')) res.setHeader('Cache-Control', 'no-store'); } }));
app.use('/simulation/results', express.static(path.join(__dirname, 'simulation/results')));
app.get('/data/stances.json', (req, res) => res.json(require('./game/data/stances')));

const ROOMS_FILE = path.join(__dirname, 'rooms.json');
const rooms = {};
const connections = {}; // connectionId -> ws
const disconnectTimers = {};

function saveRooms() {
  try {
    const data = {};
    for (const code in rooms) {
      const room = rooms[code];
      if (room.phase === 'lobby' || room.phase === 'ended') continue;
      data[code] = room.serialize();
    }
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(data));
  } catch (e) { console.error('saveRooms error:', e); }
}

function loadRooms() {
  try {
    if (!fs.existsSync(ROOMS_FILE)) return;
    const data = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
    for (const code in data) {
      try {
        rooms[code] = GameRoom.deserialize(data[code]);
        console.log(`Room restaurée: ${code} (${rooms[code].phase})`);
      } catch (e) { console.error(`Erreur restauration room ${code}:`, e); }
    }
  } catch (e) { console.error('loadRooms error:', e); }
}

loadRooms();
setInterval(saveRooms, 5000);

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function send(connectionId, data) {
  const ws = connections[connectionId];
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function broadcast(room, data) {
  for (const p of room.players) send(p.id, data);
}

function broadcastGameOver(room) {
  const winner = room.getPlayer(room.winner);
  const gd = GENERALS.find(g => g.id === winner?.generalId);
  const winnerName = gd ? gd.name : (winner?.name || '?');
  for (const p of room.players) {
    if (p.isEliminated) {
      // Spectateur : notifier qu'ils peuvent regarder
      send(p.id, { event: 'become_spectator', winnerId: room.winner, winnerName });
    } else {
      send(p.id, { event: 'game_over', winnerId: room.winner, winnerName });
    }
  }
}

function runBotArmy(room) {
  for (const p of room.players) {
    if (!p.isBot || p.armySubmitted) continue;
    const agent = new AIAgent(p.id);
    const army = agent.buildArmy(room.budget, p.generalId);
    room.submitArmy(p.id, army);
  }
}

function runBotDeployment(room) {
  for (const p of room.players) {
    if (!p.isBot || p.isReady) continue;
    const agent = new AIAgent(p.id);
    agent.deploy(room);
    room.setDeploymentReady(p.id);
  }
}

const pendingDefenseCallbacks = {};
const _delay = ms => new Promise(r => setTimeout(r, ms));

function runBotTurn(room) {
  if (room.phase !== 'battle') return;
  const currentId = room.getCurrentPlayerId();
  const player = room.getPlayer(currentId);
  if (!player || !player.isBot) return;
  _executeBotTurnAsync(room).catch(e => console.error('Bot turn error:', e));
}

async function _doBotAttack(room, agent, botId, unit, target) {
  const result = room.initiateCombat(botId, unit.id, target.id);
  if (!result.pending) return;
  const targetPlayer = room.players.find(p => p.units.some(u => u.id === target.id));
  if (targetPlayer && !targetPlayer.isBot) {
    send(result.targetPlayerId, { event: 'defense_request', attackId: result.attackId, attackerName: result.attackerName, targetName: result.targetName, targetQ: result.targetQ, targetR: result.targetR, isRanged: result.isRanged, targetTypeId: result.targetTypeId });
    send(result.targetPlayerId, { event: 'defense_timer', attackId: result.attackId, seconds: 20 });
    const choice = await new Promise(resolve => {
      pendingDefenseCallbacks[result.attackId] = resolve;
      setTimeout(() => { if (pendingDefenseCallbacks[result.attackId]) { delete pendingDefenseCallbacks[result.attackId]; resolve('rien'); } }, 20000);
    });
    const resolved = room.resolveAttack(result.attackId, choice);
    if (resolved.ok) {
      room.players.forEach(p => { send(p.id, { event: 'combat_result', combatLog: resolved.combatLog }); send(p.id, { event: 'game_state', ...room.getGameState(p.id) }); });
      if (room.phase === 'ended') broadcastGameOver(room);
    }
  } else {
    const defAgent = new AIAgent(result.targetPlayerId);
    const choice = defAgent.chooseDefense(result, room);
    const resolved = room.resolveAttack(result.attackId, choice);
    if (resolved.ok) {
      room.players.forEach(p => { send(p.id, { event: 'combat_result', combatLog: resolved.combatLog }); send(p.id, { event: 'game_state', ...room.getGameState(p.id) }); });
    }
  }
  await _delay(600);
}

async function _executeBotTurnAsync(room) {
  const currentId = room.getCurrentPlayerId();
  const player = room.getPlayer(currentId);
  if (!player || !player.isBot || room.phase !== 'battle') return;
  await _delay(800);

  const agent = new AIAgent(currentId);
  agent._visibleCache = room.getVisibleHexes(currentId);
  const sortedUnits = agent._sortUnitsByPriority(player.units);

  for (const unit of sortedUnits) {
    if (room.phase !== 'battle') break;
    if (unit.q === null || unit.speedRemaining <= 0) continue;
    const enemies = agent._getEnemyUnits(room);

    // Stance
    if (!unit.isGeneral && !unit.isFleeing && unit.speedRemaining >= 2) {
      const best = agent._chooseBestStance(unit, enemies);
      if (best && best !== unit.stance) {
        room.changeStance(currentId, unit.id, best);
        room.players.forEach(p => send(p.id, { event: 'game_state', ...room.getGameState(p.id) }));
        await _delay(200);
      }
    }

    // Attack before move
    if (!unit.hasAttacked) {
      const attackable = agent._getAttackableEnemies(unit, enemies, room);
      if (attackable.length > 0) {
        await _doBotAttack(room, agent, currentId, unit, agent._pickBestTarget(attackable));
        if (room.phase === 'ended') break;
        continue;
      }
    }

    // Move
    if (unit.speedRemaining > 0) {
      const fromQ = unit.q, fromR = unit.r;
      const moved = enemies.length === 0 ? agent._moveTowardEnemyZone(room, unit) : agent._moveTowardEnemy(room, unit, enemies);
      if (moved) {
        room.players.forEach(p => { send(p.id, { event: 'unit_move_anim', unitId: unit.id, fromQ, fromR, path: [{ q: unit.q, r: unit.r }] }); send(p.id, { event: 'game_state', ...room.getGameState(p.id) }); });
        await _delay(400);
        if (!unit.hasAttacked) {
          const newEnemies = agent._getEnemyUnits(room);
          const attackable = agent._getAttackableEnemies(unit, newEnemies, room);
          if (attackable.length > 0) {
            await _doBotAttack(room, agent, currentId, unit, agent._pickBestTarget(attackable));
            if (room.phase === 'ended') break;
          }
        }
      }
    }

    // General: motivate
    if (unit.isGeneral) {
      const r2 = room.motivateUnit(currentId, unit.id);
      if (r2.ok) { room.players.forEach(p => send(p.id, { event: 'game_state', ...room.getGameState(p.id) })); await _delay(200); }
    }
  }

  agent._visibleCache = null;
  if (room.phase !== 'battle') return;
  const { newRound, fled } = room.endTurn();
  if (newRound) broadcast(room, { event: 'initiative_rolled', rolls: room.initiativeRolls, turnOrder: room.turnOrder, turn: room.turn });
  broadcast(room, { event: 'turn_change', currentPlayerId: room.getCurrentPlayerId(), turn: room.turn, manche: room.manche });
  if (fled && fled.length > 0) broadcast(room, { event: 'units_fled', fled });
  room.players.forEach(p => send(p.id, { event: 'game_state', ...room.getGameState(p.id) }));
  if (room.phase === 'ended') broadcastGameOver(room);
  runBotTurn(room);
}

wss.on('connection', (ws) => {
  const connectionId = generateId();
  ws.id = connectionId;
  connections[connectionId] = ws;
  console.log('Connexion:', connectionId);

  ws.on('message', (raw) => {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return; }
    const { action, ...data } = parsed;
    console.log(`[msg] ${connectionId} → action=${action}`);
    handleAction(ws, connectionId, action, data);
  });

  ws.on('close', () => handleDisconnect(connectionId));
});

function handleDisconnect(connectionId) {
  delete connections[connectionId];
  for (const code in rooms) {
    const room = rooms[code];
    if (!room.getPlayer(connectionId)) continue;
    disconnectTimers[connectionId] = setTimeout(() => {
      delete disconnectTimers[connectionId];
      if (!room.getPlayer(connectionId)) return;
      broadcast(room, { event: 'player_disconnected', playerId: connectionId });
      room.removePlayer(connectionId);
      if (room.players.length === 0) {
        delete rooms[code];
      } else {
        if (room.hostId === connectionId) room.hostId = room.players[0].id;
        broadcast(room, { event: 'room_update', ...room.getLobbyState() });
      }
    }, 30000);
    break;
  }
}

function handleAction(ws, connectionId, action, data) {
  switch (action) {

    case 'rejoin_game': {
      const { roomCode, oldPlayerId } = data;
      if (disconnectTimers[oldPlayerId]) {
        clearTimeout(disconnectTimers[oldPlayerId]);
        delete disconnectTimers[oldPlayerId];
      }
      const room = rooms[roomCode];
      if (!room) return send(connectionId, { event: 'error', message: 'Salle introuvable.' });
      const player = room.getPlayer(oldPlayerId);
      if (!player) return send(connectionId, { event: 'error', message: 'Joueur introuvable.' });
      delete connections[oldPlayerId];
      player.id = connectionId;
      if (room.hostId === oldPlayerId) room.hostId = connectionId;
      console.log(`Rejoin: ${player.name} (${oldPlayerId} → ${connectionId})`);
      if (room.phase === 'lobby') {
        send(connectionId, { event: 'room_joined', roomCode, playerId: connectionId });
        broadcast(room, { event: 'room_update', ...room.getLobbyState() });
      } else if (room.phase === 'deployment') {
        send(connectionId, { event: 'deployment_state', ...room.getDeploymentState(connectionId) });
      } else if (room.phase === 'battle') {
        send(connectionId, { event: 'game_state', ...room.getGameState(connectionId) });
      }
      break;
    }

    case 'create_room': {
      const { playerName } = data;
      let code;
      do { code = generateRoomCode(); } while (rooms[code]);
      const room = new GameRoom(code, connectionId);
      rooms[code] = room;
      room.addPlayer(connectionId, playerName);
      send(connectionId, { event: 'room_created', roomCode: code, playerId: connectionId });
      send(connectionId, { event: 'room_update', ...room.getLobbyState() });
      break;
    }

    case 'join_room': {
      const { roomCode, playerName } = data;
      const room = rooms[roomCode];
      if (!room) return send(connectionId, { event: 'error', message: 'Salle introuvable.' });
      if (room.phase !== 'lobby') return send(connectionId, { event: 'error', message: 'La partie a déjà commencé.' });
      if (room.players.length >= 8) return send(connectionId, { event: 'error', message: 'La salle est pleine (8 joueurs max).' });
      room.addPlayer(connectionId, playerName);
      send(connectionId, { event: 'room_joined', roomCode, playerId: connectionId });
      broadcast(room, { event: 'room_update', ...room.getLobbyState() });
      break;
    }

    case 'set_option': {
      const { roomCode, key, value } = data;
      console.log(`[set_option] roomCode=${roomCode} key=${key} value=${value} from=${connectionId}`);
      const room = rooms[roomCode];
      if (!room || room.hostId !== connectionId) { console.log(`[set_option] rejected: room=${!!room} hostId=${room?.hostId} conn=${connectionId}`); return; }
      if (!room.options) room.options = {};
      room.options[key] = value;
      console.log(`[set_option] options now:`, room.options, `players:`, room.players.map(p=>p.id));
      broadcast(room, { event: 'room_update', ...room.getLobbyState() });
      break;
    }

    case 'set_budget': {
      const { roomCode, budget } = data;
      const room = rooms[roomCode];
      if (!room || room.hostId !== connectionId) return;
      room.budget = Math.max(1000, Math.min(100000, parseInt(budget) || 15000));
      if (room.phase === 'army_building') {
        for (const p of room.players) {
          p.units = [];
          p.isReady = false;
        }
        broadcast(room, { event: 'phase_change', phase: 'army_building', budget: room.budget });
      }
      broadcast(room, { event: 'room_update', ...room.getLobbyState() });
      break;
    }

    case 'set_player_flag': {
      const { roomCode, flagId } = data;
      const room = rooms[roomCode];
      if (!room || room.phase !== 'lobby') return;
      const player = room.getPlayer(connectionId);
      const FLAG_VARIANTS = {
        qin:  ['#1a5fa8','#4a8fd8','#0a3578','#5aaff8'],
        zhao: ['#e07820','#b05010','#f0a040','#804000'],
        wei:  ['#1a7a3a','#3aaa5a','#0a5020','#6acc8a'],
        chu:  ['#20b8c8','#1080a0','#50d8e8','#008878'],
        yan:  ['#c8b84a','#a89030','#e8d870','#786820'],
        qi:   ['#e8e8e8','#b8b8b8','#f8f8f8','#d0d0d0'],
        han:  ['#9060c0','#7040a0','#b080e0','#502080'],
      };
      if (!FLAG_VARIANTS[flagId]) return;
      const takenFlags = room.players.filter(p => p.id !== connectionId).map(p => p.flag);
      if (!room.options?.teamMode && takenFlags.includes(flagId)) return send(connectionId, { event: 'error', message: 'Ce drapeau est déjà pris.' });
      if (player) {
        player.flag = flagId;
        const teammates = room.players.filter(p => p.id !== connectionId && p.flag === flagId).length;
        player.color = FLAG_VARIANTS[flagId][Math.min(teammates, FLAG_VARIANTS[flagId].length - 1)];
      }
      broadcast(room, { event: 'room_update', ...room.getLobbyState() });
      break;
    }

    case 'select_general': {
      const { roomCode, generalId } = data;
      const room = rooms[roomCode];
      if (!room || room.phase !== 'lobby') return;
      const taken = room.players.filter(p => p.id !== connectionId).map(p => p.generalId);
      if (taken.includes(generalId)) return send(connectionId, { event: 'error', message: 'Ce général est déjà pris.' });
      const player = room.getPlayer(connectionId);
      if (player) player.generalId = generalId;
      broadcast(room, { event: 'room_update', ...room.getLobbyState() });
      break;
    }

    case 'add_ai': {
      const { roomCode, generalId: requestedGeneralId, flagId: requestedFlagId } = data;
      const room = rooms[roomCode];
      if (!room || room.hostId !== connectionId || room.phase !== 'lobby') return;
      if (room.players.length >= 8) return send(connectionId, { event: 'error', message: 'Salle pleine.' });
      const FLAG_VARIANTS_BOT = {
        qin:  ['#1a5fa8','#4a8fd8','#0a3578','#5aaff8'],
        zhao: ['#e07820','#b05010','#f0a040','#804000'],
        wei:  ['#1a7a3a','#3aaa5a','#0a5020','#6acc8a'],
        chu:  ['#20b8c8','#1080a0','#50d8e8','#008878'],
        yan:  ['#c8b84a','#a89030','#e8d870','#786820'],
        qi:   ['#e8e8e8','#b8b8b8','#f8f8f8','#d0d0d0'],
        han:  ['#9060c0','#7040a0','#b080e0','#502080'],
      };
      const botId = 'bot_' + generateId();
      room.addPlayer(botId, '🤖 IA');
      const bot = room.getPlayer(botId);
      bot.isBot = true;
      const takenGenerals = room.players.filter(p => p.id !== botId).map(p => p.generalId).filter(Boolean);
      if (requestedGeneralId && !takenGenerals.includes(requestedGeneralId) && GENERALS.find(g => g.id === requestedGeneralId)) {
        bot.generalId = requestedGeneralId;
      } else {
        const available = GENERALS.filter(g => !takenGenerals.includes(g.id));
        if (available.length > 0) bot.generalId = available[Math.floor(Math.random() * available.length)].id;
      }
      if (requestedFlagId && FLAG_VARIANTS_BOT[requestedFlagId]) {
        bot.flag = requestedFlagId;
        const teammates = room.players.filter(p => p.id !== botId && p.flag === requestedFlagId).length;
        bot.color = FLAG_VARIANTS_BOT[requestedFlagId][Math.min(teammates, FLAG_VARIANTS_BOT[requestedFlagId].length - 1)];
      } else {
        bot.color = '#888888';
      }
      const botGeneral = GENERALS.find(g => g.id === bot.generalId);
      bot.name = `🤖 ${botGeneral?.name || 'IA'}`;
      bot.isReady = true;
      broadcast(room, { event: 'room_update', ...room.getLobbyState() });
      break;
    }

    case 'remove_bot': {
      const { roomCode, botId } = data;
      const room = rooms[roomCode];
      if (!room || room.hostId !== connectionId || room.phase !== 'lobby') return;
      const idx = room.players.findIndex(p => p.id === botId && p.isBot);
      if (idx === -1) return;
      room.players.splice(idx, 1);
      broadcast(room, { event: 'room_update', ...room.getLobbyState() });
      break;
    }

    case 'lobby_ready': {
      const { roomCode } = data;
      const room = rooms[roomCode];
      if (!room || room.phase !== 'lobby') return;
      const player = room.getPlayer(connectionId);
      if (!player) return;
      if (!player.generalId) return send(connectionId, { event: 'error', message: 'Choisissez un général avant de vous préparer.' });
      if (!player.flag) return send(connectionId, { event: 'error', message: 'Choisissez un drapeau avant de vous préparer.' });
      player.isReady = !player.isReady;
      broadcast(room, { event: 'room_update', ...room.getLobbyState() });
      const humanPlayers = room.players.filter(p => !p.isBot);
      if (humanPlayers.length > 0 && humanPlayers.every(p => p.isReady)) {
        room.startGame();
        broadcast(room, { event: 'phase_change', phase: 'army_building', budget: room.budget });
        broadcast(room, { event: 'room_update', ...room.getLobbyState() });
        runBotArmy(room);
      }
      break;
    }

    case 'start_game': {
      const { roomCode } = data;
      const room = rooms[roomCode];
      if (!room || room.hostId !== connectionId) return;
      if (room.players.length < 1) return send(connectionId, { event: 'error', message: 'Il faut au moins 1 joueur.' });
      if (room.players.some(p => !p.generalId)) return send(connectionId, { event: 'error', message: 'Tous les joueurs doivent choisir un général.' });
      if (room.players.some(p => !p.flag)) return send(connectionId, { event: 'error', message: 'Tous les joueurs doivent choisir un drapeau.' });
      room.startGame();
      broadcast(room, { event: 'phase_change', phase: 'army_building', budget: room.budget });
      broadcast(room, { event: 'room_update', ...room.getLobbyState() });
      runBotArmy(room);
      break;
    }

    case 'back_to_lobby': {
      const { roomCode } = data;
      const room = rooms[roomCode];
      if (!room || room.hostId !== connectionId || room.phase !== 'army_building') return;
      room.phase = 'lobby';
      for (const p of room.players) { p.units = []; p.isReady = false; }
      broadcast(room, { event: 'phase_change', phase: 'lobby' });
      broadcast(room, { event: 'room_update', ...room.getLobbyState() });
      break;
    }

    case 'submit_army': {
      const { roomCode, units } = data;
      const room = rooms[roomCode];
      if (!room || room.phase !== 'army_building') return;
      const result = room.submitArmy(connectionId, units);
      if (result.error) return send(connectionId, { event: 'error', message: result.error });
      send(connectionId, { event: 'army_accepted' });
      broadcast(room, { event: 'room_update', ...room.getLobbyState() });
      if (room.allArmiesSubmitted()) {
        room.startDeployment();
        room.players.forEach(p => {
          send(p.id, { event: 'phase_change', phase: 'deployment' });
          send(p.id, { event: 'deployment_state', ...room.getDeploymentState(p.id) });
        });
        saveRooms();
        runBotDeployment(room);
        if (room.allDeployed()) {
          room.startBattle();
          room.players.forEach(p => {
            send(p.id, { event: 'phase_change', phase: 'battle' });
            send(p.id, { event: 'initiative_rolled', rolls: room.initiativeRolls, turnOrder: room.turnOrder, turn: room.turn });
            send(p.id, { event: 'game_state', ...room.getGameState(p.id) });
          });
          saveRooms();
          runBotTurn(room);
        }
      }
      break;
    }

    case 'build_segment': {
      const { roomCode, unitId, neighborQ, neighborR } = data;
      const room = rooms[roomCode];
      if (!room || room.phase !== 'battle') return;
      const result = room.buildSegment(connectionId, unitId, neighborQ, neighborR);
      if (result.error) return send(connectionId, { event: 'error', message: result.error });
      room.players.forEach(p => send(p.id, { event: 'game_state', ...room.getGameState(p.id) }));
      break;
    }

    case 'place_unit': {
      const { roomCode, unitId, q, r } = data;
      const room = rooms[roomCode];
      if (!room || room.phase !== 'deployment') return;
      const result = room.placeUnit(connectionId, unitId, q, r);
      if (result.error) return send(connectionId, { event: 'error', message: result.error });
      send(connectionId, { event: 'deployment_state', ...room.getDeploymentState(connectionId) });
      break;
    }

    case 'deployment_ready': {
      const { roomCode } = data;
      const room = rooms[roomCode];
      console.log(`[deployment_ready] connectionId=${connectionId} roomCode="${roomCode}" phase=${room?.phase}`);
      if (!room || room.phase !== 'deployment') return send(connectionId, { event: 'error', message: `Phase invalide: ${room?.phase}` });
      const result = room.setDeploymentReady(connectionId);
      console.log(`[deployment_ready] result=`, JSON.stringify(result));
      if (result.error) return send(connectionId, { event: 'error', message: result.error });
      const readyCount = room.players.filter(p => p.isReady).length;
      const total = room.players.length;
      console.log(`[deployment_ready] ${readyCount}/${total} prêts`);
      broadcast(room, { event: 'deployment_ready_update', readyCount, total });
      if (room.allDeployed()) {
        try {
          room.startBattle();
          room.players.forEach(p => {
            send(p.id, { event: 'phase_change', phase: 'battle' });
            send(p.id, { event: 'initiative_rolled', rolls: room.initiativeRolls, turnOrder: room.turnOrder, turn: room.turn });
            send(p.id, { event: 'game_state', ...room.getGameState(p.id) });
          });
          saveRooms();
          console.log(`[deployment_ready] Bataille démarrée!`);
          runBotTurn(room);
        } catch (e) {
          console.error('[deployment_ready] ERREUR:', e.stack || e.message);
          send(connectionId, { event: 'error', message: 'Erreur au démarrage: ' + e.message });
        }
      }
      break;
    }

    case 'move_unit': {
      const { roomCode, unitId, targetQ, targetR } = data;
      const room = rooms[roomCode];
      if (!room || room.phase !== 'battle') return;
      if (room.getCurrentPlayerId() !== connectionId) return send(connectionId, { event: 'error', message: 'Ce n\'est pas votre tour.' });
      const result = room.moveUnit(connectionId, unitId, targetQ, targetR);
      if (result.error) return send(connectionId, { event: 'error', message: result.error });
      room.players.forEach(p => {
        send(p.id, { event: 'unit_move_anim', unitId: result.unitId, fromQ: result.fromQ, fromR: result.fromR, path: result.path });
        send(p.id, { event: 'game_state', ...room.getGameState(p.id) });
      });
      if (result.trampledAttacks?.length > 0) {
        for (const combatLog of result.trampledAttacks) {
          room.players.forEach(p => send(p.id, { event: 'combat_result', combatLog }));
        }
        if (room.phase === 'ended') broadcastGameOver(room);
      }
      break;
    }

    case 'attack_unit': {
      const { roomCode, attackerId, targetId } = data;
      const room = rooms[roomCode];
      if (!room || room.phase !== 'battle') return;
      if (room.getCurrentPlayerId() !== connectionId) return send(connectionId, { event: 'error', message: 'Ce n\'est pas votre tour.' });
      const result = room.initiateCombat(connectionId, attackerId, targetId);
      if (result.error) return send(connectionId, { event: 'error', message: result.error });
      if (result.pending) {
        const targetPlayer = room.getPlayer(result.targetPlayerId);
        if (targetPlayer?.isBot) {
          const agent = new AIAgent(result.targetPlayerId);
          const choice = agent.chooseDefense(result, room);
          const resolved = room.resolveAttack(result.attackId, choice);
          if (resolved.ok) {
            room.players.forEach(p => {
              send(p.id, { event: 'combat_result', combatLog: resolved.combatLog });
              send(p.id, { event: 'game_state', ...room.getGameState(p.id) });
            });
            if (room.phase === 'ended') broadcastGameOver(room);
          }
        } else {
          // Si seule option est 'rien', résoudre immédiatement sans popup
          const archerTypes = ['archer', 'archer_elite'];
          const noDefensePossible = result.isRanged && !(result.targetTypeId === 'phalange' && !archerTypes.includes(result.attackerTypeId));
          if (noDefensePossible) {
            const resolved = room.resolveAttack(result.attackId, 'rien');
            if (resolved.ok) {
              room.players.forEach(p => {
                send(p.id, { event: 'combat_result', combatLog: resolved.combatLog });
                send(p.id, { event: 'game_state', ...room.getGameState(p.id) });
              });
              if (room.phase === 'ended') broadcastGameOver(room);
            }
            return;
          }
          send(result.targetPlayerId, { event: 'defense_request', attackId: result.attackId, attackerName: result.attackerName, targetName: result.targetName, targetQ: result.targetQ, targetR: result.targetR, isRanged: result.isRanged, targetTypeId: result.targetTypeId, attackerTypeId: result.attackerTypeId, roomCode });
          send(connectionId, { event: 'waiting_defense', attackId: result.attackId });
          send(result.targetPlayerId, { event: 'defense_timer', attackId: result.attackId, seconds: 20 });
          setTimeout(() => {
            if (!room.pendingAttacks[result.attackId]) return;
            const resolved = room.resolveAttack(result.attackId, 'rien');
            if (resolved.ok) {
              room.players.forEach(p => {
                send(p.id, { event: 'combat_result', combatLog: resolved.combatLog });
                send(p.id, { event: 'game_state', ...room.getGameState(p.id) });
              });
              if (room.phase === 'ended') broadcastGameOver(room);
            }
          }, 20000);
        }
      }
      break;
    }

    case 'defend_choice': {
      const { roomCode, attackId, choice } = data;
      const room = rooms[roomCode];
      if (!room) return;
      // If the attacker was a bot, hand off to the bot's async callback
      if (pendingDefenseCallbacks[attackId]) {
        pendingDefenseCallbacks[attackId](choice || 'rien');
        delete pendingDefenseCallbacks[attackId];
        return;
      }
      const resolved = room.resolveAttack(attackId, choice || 'rien');
      if (resolved.error) return send(connectionId, { event: 'error', message: resolved.error });
      if (resolved.ok) {
        room.players.forEach(p => {
          send(p.id, { event: 'combat_result', combatLog: resolved.combatLog });
          send(p.id, { event: 'game_state', ...room.getGameState(p.id) });
        });
        if (room.phase === 'ended') broadcastGameOver(room);
      }
      break;
    }

    case 'rotate_facing': {
      const { roomCode, unitId, facing } = data;
      const room = rooms[roomCode];
      if (!room || room.phase !== 'battle') return;
      if (room.getCurrentPlayerId() !== connectionId) return send(connectionId, { event: 'error', message: 'Ce n\'est pas votre tour.' });
      const result = room.rotateFacing(connectionId, unitId, facing);
      if (result.error) return send(connectionId, { event: 'error', message: result.error });
      room.players.forEach(p => send(p.id, { event: 'game_state', ...room.getGameState(p.id) }));
      break;
    }

    case 'change_stance': {
      const { roomCode, unitId, stanceId } = data;
      const room = rooms[roomCode];
      if (!room) return send(connectionId, { event: 'error', message: 'Salle introuvable.' });
      if (room.getCurrentPlayerId() !== connectionId) return send(connectionId, { event: 'error', message: 'Ce n\'est pas votre tour.' });
      const result = room.changeStance(connectionId, unitId, stanceId);
      if (result.error) return send(connectionId, { event: 'error', message: result.error });
      room.players.forEach(p => send(p.id, { event: 'game_state', ...room.getGameState(p.id) }));
      break;
    }

    case 'motivate_unit': {
      const { roomCode, generalId } = data;
      const room = rooms[roomCode];
      if (!room || room.phase !== 'battle') return;
      if (room.getCurrentPlayerId() !== connectionId) return send(connectionId, { event: 'error', message: 'Ce n\'est pas votre tour.' });
      const result = room.motivateUnit(connectionId, generalId);
      if (result.error) return send(connectionId, { event: 'error', message: result.error });
      broadcast(room, { event: 'motivate_result', ...result, playerId: connectionId });
      room.players.forEach(p => send(p.id, { event: 'game_state', ...room.getGameState(p.id) }));
      break;
    }

    case 'chat_message': {
      const { roomCode, text } = data;
      const room = rooms[roomCode];
      if (!room) return;
      const player = room.getPlayer(connectionId);
      if (!player) return;
      const msg = String(text || '').slice(0, 200).trim();
      if (!msg) return;
      const gd = GENERALS.find(g => g.id === player.generalId);
      const authorName = gd ? gd.name : player.name;
      broadcast(room, { event: 'chat_message', authorId: connectionId, authorName, text: msg });
      break;
    }

    case 'ping': {
      const { roomCode, q, r } = data;
      const room = rooms[roomCode];
      if (!room) return;
      const player = room.getPlayer(connectionId);
      if (!player) return;
      broadcast(room, { event: 'ping', q, r, color: player.color || '#ffd700' });
      break;
    }

    case 'use_ability': {
      const { roomCode, targetHex, targetId } = data;
      const room = rooms[roomCode];
      if (!room || room.phase !== 'battle') return;
      if (room.getCurrentPlayerId() !== connectionId) return send(connectionId, { event: 'error', message: 'Ce n\'est pas votre tour.' });
      const result = room.useGeneralAbility(connectionId, targetHex, targetId);
      if (result.error) return send(connectionId, { event: 'error', message: result.error });
      broadcast(room, { event: 'combat_result', combatLog: result.combatLog });
      room.players.forEach(p => send(p.id, { event: 'game_state', ...room.getGameState(p.id) }));
      break;
    }

    case 'end_turn': {
      const { roomCode } = data;
      const room = rooms[roomCode];
      if (!room || room.phase !== 'battle') return;
      if (room.getCurrentPlayerId() !== connectionId) return send(connectionId, { event: 'error', message: 'Ce n\'est pas votre tour.' });
      const { newRound, fled } = room.endTurn();
      if (newRound) broadcast(room, { event: 'initiative_rolled', rolls: room.initiativeRolls, turnOrder: room.turnOrder, turn: room.turn });
      broadcast(room, { event: 'turn_change', currentPlayerId: room.getCurrentPlayerId(), turn: room.turn, manche: room.manche });
      if (fled && fled.length > 0) broadcast(room, { event: 'units_fled', fled });
      room.players.forEach(p => send(p.id, { event: 'game_state', ...room.getGameState(p.id) }));
      runBotTurn(room);
      break;
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur démarré sur http://localhost:${PORT}`));
