const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const GameRoom = require('./game/GameRoom');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
const connections = {}; // connectionId -> ws
const disconnectTimers = {};

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

wss.on('connection', (ws) => {
  const connectionId = generateId();
  ws.id = connectionId;
  connections[connectionId] = ws;
  console.log('Connexion:', connectionId);

  ws.on('message', (raw) => {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return; }
    const { action, ...data } = parsed;
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
    }, 10000);
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
      if (room.phase === 'deployment') {
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

    case 'set_budget': {
      const { roomCode, budget } = data;
      const room = rooms[roomCode];
      if (!room || room.hostId !== connectionId) return;
      room.budget = Math.max(1000, Math.min(100000, parseInt(budget) || 15000));
      broadcast(room, { event: 'room_update', ...room.getLobbyState() });
      break;
    }

    case 'set_player_color': {
      const { roomCode, color } = data;
      const room = rooms[roomCode];
      if (!room || room.phase !== 'lobby') return;
      const player = room.getPlayer(connectionId);
      const allowed = ['#4a90d9','#e05050','#50c050','#e0a030','#a050d0','#e07840','#40c0c0','#e050a0','#ffffff'];
      if (player && allowed.includes(color)) player.color = color;
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

    case 'start_game': {
      const { roomCode } = data;
      const room = rooms[roomCode];
      if (!room || room.hostId !== connectionId) return;
      if (room.players.length < 1) return send(connectionId, { event: 'error', message: 'Il faut au moins 1 joueur.' });
      if (room.players.some(p => !p.generalId)) return send(connectionId, { event: 'error', message: 'Tous les joueurs doivent choisir un général.' });
      room.startGame();
      broadcast(room, { event: 'phase_change', phase: 'army_building', budget: room.budget });
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
      if (room.allArmiesSubmitted()) {
        room.startDeployment();
        room.players.forEach(p => {
          send(p.id, { event: 'phase_change', phase: 'deployment' });
          send(p.id, { event: 'deployment_state', ...room.getDeploymentState(p.id) });
        });
      }
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
          console.log(`[deployment_ready] Bataille démarrée!`);
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
        send(result.targetPlayerId, { event: 'defense_request', attackId: result.attackId, attackerName: result.attackerName, targetName: result.targetName, targetQ: result.targetQ, targetR: result.targetR, roomCode });
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
            if (room.phase === 'ended') broadcast(room, { event: 'game_over', winnerId: room.winner, winnerName: room.getPlayer(room.winner)?.name });
          }
        }, 20000);
      }
      break;
    }

    case 'defend_choice': {
      const { roomCode, attackId, choice } = data;
      const room = rooms[roomCode];
      if (!room) return;
      const resolved = room.resolveAttack(attackId, choice || 'rien');
      if (resolved.error) return send(connectionId, { event: 'error', message: resolved.error });
      if (resolved.ok) {
        room.players.forEach(p => {
          send(p.id, { event: 'combat_result', combatLog: resolved.combatLog });
          send(p.id, { event: 'game_state', ...room.getGameState(p.id) });
        });
        if (room.phase === 'ended') broadcast(room, { event: 'game_over', winnerId: room.winner, winnerName: room.getPlayer(room.winner)?.name });
      }
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
      send(connectionId, { event: 'motivate_result', ...result });
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
      broadcast(room, { event: 'chat_message', authorId: connectionId, authorName: player.name, text: msg });
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
      broadcast(room, { event: 'turn_change', currentPlayerId: room.getCurrentPlayerId(), turn: room.turn });
      if (fled && fled.length > 0) broadcast(room, { event: 'units_fled', fled });
      room.players.forEach(p => send(p.id, { event: 'game_state', ...room.getGameState(p.id) }));
      break;
    }
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur démarré sur http://localhost:${PORT}`));
