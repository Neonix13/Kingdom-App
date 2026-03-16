const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const GameRoom = require('./game/GameRoom');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {}; // roomCode -> GameRoom
const disconnectTimers = {}; // oldSocketId -> timer (grâce à la navigation de page)

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

io.on('connection', (socket) => {
  console.log('Connexion:', socket.id);

  // --- REJOIN (après navigation vers game.html) ---

  socket.on('rejoin_game', ({ roomCode, oldPlayerId }) => {
    // Annuler la déconnexion différée si elle existe (navigation de page)
    if (disconnectTimers[oldPlayerId]) {
      clearTimeout(disconnectTimers[oldPlayerId]);
      delete disconnectTimers[oldPlayerId];
    }

    const room = rooms[roomCode];
    if (!room) return socket.emit('error', 'Salle introuvable.');

    const player = room.getPlayer(oldPlayerId);
    if (!player) return socket.emit('error', 'Joueur introuvable.');

    // Mettre à jour l'ID du socket
    player.id = socket.id;
    if (room.hostId === oldPlayerId) room.hostId = socket.id;

    socket.join(roomCode);
    console.log(`Rejoin: ${player.name} (${oldPlayerId} → ${socket.id})`);

    if (room.phase === 'deployment') {
      socket.emit('deployment_state', room.getDeploymentState(socket.id));
    } else if (room.phase === 'battle') {
      socket.emit('game_state', room.getGameState(socket.id));
    }
  });

  // --- LOBBY ---

  socket.on('create_room', ({ playerName }) => {
    let code;
    do { code = generateRoomCode(); } while (rooms[code]);
    const room = new GameRoom(code, socket.id);
    rooms[code] = room;
    room.addPlayer(socket.id, playerName);
    socket.join(code);
    socket.emit('room_created', { roomCode: code, playerId: socket.id });
    socket.emit('room_update', room.getLobbyState());
  });

  socket.on('join_room', ({ roomCode, playerName }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('error', 'Salle introuvable.');
    if (room.phase !== 'lobby') return socket.emit('error', 'La partie a déjà commencé.');
    if (room.players.length >= 8) return socket.emit('error', 'La salle est pleine (8 joueurs max).');
    room.addPlayer(socket.id, playerName);
    socket.join(roomCode);
    socket.emit('room_joined', { roomCode, playerId: socket.id });
    io.to(roomCode).emit('room_update', room.getLobbyState());
  });

  socket.on('set_budget', ({ roomCode, budget }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    room.budget = Math.max(1000, Math.min(100000, parseInt(budget) || 15000));
    io.to(roomCode).emit('room_update', room.getLobbyState());
  });

  socket.on('set_player_color', ({ roomCode, color }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== 'lobby') return;
    const player = room.getPlayer(socket.id);
    const allowed = ['#4a90d9','#e05050','#50c050','#e0a030','#a050d0','#e07840','#40c0c0','#e050a0','#ffffff'];
    if (player && allowed.includes(color)) player.color = color;
    io.to(roomCode).emit('room_update', room.getLobbyState());
  });

  socket.on('select_general', ({ roomCode, generalId }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== 'lobby') return;
    const taken = room.players.filter(p => p.id !== socket.id).map(p => p.generalId);
    if (taken.includes(generalId)) return socket.emit('error', 'Ce général est déjà pris.');
    const player = room.getPlayer(socket.id);
    if (player) player.generalId = generalId;
    io.to(roomCode).emit('room_update', room.getLobbyState());
  });

  socket.on('start_game', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    if (room.players.length < 1) return socket.emit('error', 'Il faut au moins 1 joueur.');
    if (room.players.some(p => !p.generalId)) return socket.emit('error', 'Tous les joueurs doivent choisir un général.');
    room.startGame();
    io.to(roomCode).emit('phase_change', { phase: 'army_building', budget: room.budget });
    io.to(roomCode).emit('room_update', room.getLobbyState());
  });

  // --- ARMY BUILDING ---

  socket.on('submit_army', ({ roomCode, units }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== 'army_building') return;
    const result = room.submitArmy(socket.id, units);
    if (result.error) return socket.emit('error', result.error);
    socket.emit('army_accepted');
    if (room.allArmiesSubmitted()) {
      room.startDeployment();
      room.players.forEach(p => {
        io.to(p.id).emit('phase_change', { phase: 'deployment' });
        io.to(p.id).emit('deployment_state', room.getDeploymentState(p.id));
      });
    }
  });

  // --- DEPLOYMENT ---

  socket.on('place_unit', ({ roomCode, unitId, q, r }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== 'deployment') return;
    const result = room.placeUnit(socket.id, unitId, q, r);
    if (result.error) return socket.emit('error', result.error);
    socket.emit('deployment_state', room.getDeploymentState(socket.id));
  });

  socket.on('deployment_ready', ({ roomCode }) => {
    const room = rooms[roomCode];
    console.log(`[deployment_ready] socketId=${socket.id} roomCode="${roomCode}" salles=${Object.keys(rooms).join(',')} phase=${room?.phase}`);
    if (!room || room.phase !== 'deployment') return socket.emit('error', `Phase invalide: ${room?.phase}`);

    const result = room.setDeploymentReady(socket.id);
    console.log(`[deployment_ready] result=`, JSON.stringify(result));
    if (result.error) return socket.emit('error', result.error);

    const readyCount = room.players.filter(p => p.isReady).length;
    const total = room.players.length;
    console.log(`[deployment_ready] ${readyCount}/${total} prêts`);
    io.to(roomCode).emit('deployment_ready_update', { readyCount, total });

    if (room.allDeployed()) {
      try {
        room.startBattle();
        room.players.forEach(p => {
          io.to(p.id).emit('phase_change', { phase: 'battle' });
          io.to(p.id).emit('initiative_rolled', {
            rolls: room.initiativeRolls,
            turnOrder: room.turnOrder,
            turn: room.turn,
          });
          io.to(p.id).emit('game_state', room.getGameState(p.id));
        });
        console.log(`[deployment_ready] Bataille démarrée!`);
      } catch (e) {
        console.error('[deployment_ready] ERREUR:', e.stack || e.message);
        socket.emit('error', 'Erreur au démarrage: ' + e.message);
      }
    }
  });

  // --- BATTLE ---

  socket.on('move_unit', ({ roomCode, unitId, targetQ, targetR }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== 'battle') return;
    if (room.getCurrentPlayerId() !== socket.id) return socket.emit('error', 'Ce n\'est pas votre tour.');
    const result = room.moveUnit(socket.id, unitId, targetQ, targetR);
    if (result.error) return socket.emit('error', result.error);
    // Envoyer l'animation d'abord, puis le game_state
    room.players.forEach(p => {
      io.to(p.id).emit('unit_move_anim', { unitId: result.unitId, fromQ: result.fromQ, fromR: result.fromR, path: result.path });
      io.to(p.id).emit('game_state', room.getGameState(p.id));
    });
  });

  socket.on('attack_unit', ({ roomCode, attackerId, targetId }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== 'battle') return;
    if (room.getCurrentPlayerId() !== socket.id) return socket.emit('error', 'Ce n\'est pas votre tour.');
    const result = room.initiateCombat(socket.id, attackerId, targetId);
    if (result.error) return socket.emit('error', result.error);
    if (result.pending) {
      // Find defender socket
      const defenderSocket = result.targetPlayerId;
      io.to(defenderSocket).emit('defense_request', {
        attackId: result.attackId,
        attackerName: result.attackerName,
        targetName: result.targetName,
        targetQ: result.targetQ,
        targetR: result.targetR,
        roomCode,
      });
      socket.emit('waiting_defense', { attackId: result.attackId });
      // Auto-resolve after 20 seconds
      io.to(defenderSocket).emit('defense_timer', { attackId: result.attackId, seconds: 20 });
      setTimeout(() => {
        if (!room.pendingAttacks[result.attackId]) return;
        const resolved = room.resolveAttack(result.attackId, 'rien');
        if (resolved.ok) {
          for (const p of room.players) {
            io.to(p.id).emit('combat_result', { combatLog: resolved.combatLog });
            io.to(p.id).emit('game_state', room.getGameState(p.id));
          }
          if (room.phase === 'ended') {
            io.to(roomCode).emit('game_over', { winnerId: room.winner, winnerName: room.getPlayer(room.winner)?.name });
          }
        }
      }, 20000);
    }
  });

  socket.on('defend_choice', ({ roomCode, attackId, choice }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const resolved = room.resolveAttack(attackId, choice || 'rien');
    if (resolved.error) return socket.emit('error', resolved.error);
    if (resolved.ok) {
      for (const p of room.players) {
        io.to(p.id).emit('combat_result', { combatLog: resolved.combatLog });
        io.to(p.id).emit('game_state', room.getGameState(p.id));
      }
      if (room.phase === 'ended') {
        io.to(roomCode).emit('game_over', { winnerId: room.winner, winnerName: room.getPlayer(room.winner)?.name });
      }
    }
  });

  socket.on('change_stance', ({ roomCode, unitId, stanceId }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit('error', 'Salle introuvable.');
    if (room.getCurrentPlayerId() !== socket.id) return socket.emit('error', 'Ce n\'est pas votre tour.');
    const result = room.changeStance(socket.id, unitId, stanceId);
    if (result.error) return socket.emit('error', result.error);
    for (const p of room.players) {
      io.to(p.id).emit('game_state', room.getGameState(p.id));
    }
  });

  socket.on('motivate_unit', ({ roomCode, generalId, targetId }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== 'battle') return;
    if (room.getCurrentPlayerId() !== socket.id) return socket.emit('error', 'Ce n\'est pas votre tour.');
    const result = room.motivateUnit(socket.id, generalId, targetId);
    if (result.error) return socket.emit('error', result.error);
    socket.emit('motivate_result', result);
    for (const p of room.players) io.to(p.id).emit('game_state', room.getGameState(p.id));
  });

  socket.on('chat_message', ({ roomCode, text }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.getPlayer(socket.id);
    if (!player) return;
    const msg = String(text || '').slice(0, 200).trim();
    if (!msg) return;
    io.to(roomCode).emit('chat_message', { authorId: socket.id, authorName: player.name, text: msg });
  });

  socket.on('use_ability', ({ roomCode, targetHex, targetId }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== 'battle') return;
    if (room.getCurrentPlayerId() !== socket.id) return socket.emit('error', 'Ce n\'est pas votre tour.');
    const result = room.useGeneralAbility(socket.id, targetHex, targetId);
    if (result.error) return socket.emit('error', result.error);
    io.to(roomCode).emit('combat_result', result.combatLog);
    room.players.forEach(p => {
      io.to(p.id).emit('game_state', room.getGameState(p.id));
    });
  });

  socket.on('end_turn', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.phase !== 'battle') return;
    if (room.getCurrentPlayerId() !== socket.id) return socket.emit('error', 'Ce n\'est pas votre tour.');
    const { newRound, fled } = room.endTurn();
    if (newRound) {
      io.to(roomCode).emit('initiative_rolled', {
        rolls: room.initiativeRolls,
        turnOrder: room.turnOrder,
        turn: room.turn,
      });
    }
    io.to(roomCode).emit('turn_change', { currentPlayerId: room.getCurrentPlayerId(), turn: room.turn });
    if (fled && fled.length > 0) {
      for (const p of room.players) {
        io.to(p.id).emit('units_fled', { fled });
      }
    }
    room.players.forEach(p => {
      io.to(p.id).emit('game_state', room.getGameState(p.id));
    });
  });

  // --- DISCONNECT ---

  socket.on('disconnect', () => {
    for (const code in rooms) {
      const room = rooms[code];
      if (room.getPlayer(socket.id)) {
        const playerId = socket.id;
        // Délai de 10s pour permettre la navigation lobby → game.html (rejoin)
        disconnectTimers[playerId] = setTimeout(() => {
          delete disconnectTimers[playerId];
          if (!room.getPlayer(playerId)) return; // déjà rejoint (ID changé)
          io.to(code).emit('player_disconnected', { playerId });
          room.removePlayer(playerId);
          if (room.players.length === 0) {
            delete rooms[code];
          } else if (room.hostId === playerId) {
            room.hostId = room.players[0].id;
            io.to(code).emit('room_update', room.getLobbyState());
          } else {
            io.to(code).emit('room_update', room.getLobbyState());
          }
        }, 10000);
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur démarré sur http://localhost:${PORT}`));
