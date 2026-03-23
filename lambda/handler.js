const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const GameRoom = require('../game/GameRoom');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ROOMS_TABLE = process.env.ROOMS_TABLE || 'KingdomRooms';
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE || 'KingdomConnections';
const TTL_ROOM = () => Math.floor(Date.now() / 1000) + 86400 * 3;
const TTL_CONN = () => Math.floor(Date.now() / 1000) + 3600;

// ── DynamoDB helpers ──────────────────────────────────────────────────────────

async function getRoom(roomCode) {
  const res = await ddb.send(new GetCommand({ TableName: ROOMS_TABLE, Key: { roomCode } }));
  if (!res.Item) return null;
  return GameRoom.deserialize(res.Item.data);
}

async function saveRoom(room) {
  await ddb.send(new PutCommand({
    TableName: ROOMS_TABLE,
    Item: { roomCode: room.roomCode, data: room.serialize(), ttl: TTL_ROOM() },
  }));
}

async function deleteRoom(roomCode) {
  await ddb.send(new DeleteCommand({ TableName: ROOMS_TABLE, Key: { roomCode } }));
}

async function getConn(connectionId) {
  const res = await ddb.send(new GetCommand({ TableName: CONNECTIONS_TABLE, Key: { connectionId } }));
  return res.Item || null;
}

async function saveConn(connectionId, roomCode) {
  await ddb.send(new PutCommand({
    TableName: CONNECTIONS_TABLE,
    Item: { connectionId, roomCode, ttl: TTL_CONN() },
  }));
}

async function deleteConn(connectionId) {
  await ddb.send(new DeleteCommand({ TableName: CONNECTIONS_TABLE, Key: { connectionId } }));
}

// ── WebSocket send helpers ────────────────────────────────────────────────────

async function send(apigw, connectionId, data) {
  try {
    await apigw.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(JSON.stringify(data)),
    }));
  } catch (e) {
    if (e.$metadata?.httpStatusCode === 410) await deleteConn(connectionId);
  }
}

async function broadcast(apigw, room, data) {
  await Promise.all(room.players.map(p => send(apigw, p.id, data)));
}

// ── Lambda handler ────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const { connectionId, routeKey, domainName, stage } = event.requestContext;
  const apigw = new ApiGatewayManagementApiClient({ endpoint: `https://${domainName}/${stage}` });

  if (routeKey === '$connect') {
    return { statusCode: 200 };
  }

  if (routeKey === '$disconnect') {
    // Wait 600ms: if this is a page refresh, rejoin_game will run first and
    // call deleteConn(oldId). After the delay, getConn returns null → we do nothing.
    // For permanent disconnects, the conn entry is still there → mark offline.
    await new Promise(r => setTimeout(r, 600));
    const conn = await getConn(connectionId);
    if (conn?.roomCode) {
      const room = await getRoom(conn.roomCode);
      if (room) {
        const player = room.getPlayer(connectionId);
        if (player) {
          player.offline = true;
          await saveRoom(room);
          if (room.phase === 'lobby') {
            await broadcast(apigw, room, { event: 'room_update', ...room.getLobbyState() });
          } else {
            await broadcast(apigw, room, { event: 'player_disconnected', playerId: connectionId });
          }
        }
      }
      await deleteConn(connectionId);
    }
    return { statusCode: 200 };
  }

  // Default route — parse action
  let parsed;
  try { parsed = JSON.parse(event.body); } catch { return { statusCode: 400 }; }
  const { action, ...data } = parsed;

  try {
    await handleAction(apigw, connectionId, action, data);
  } catch (e) {
    console.error(`[${action}] ERROR:`, e.stack || e.message);
    await send(apigw, connectionId, { event: 'error', message: 'Erreur serveur: ' + e.message });
  }

  return { statusCode: 200 };
};

// ── Action router ─────────────────────────────────────────────────────────────

async function handleAction(apigw, connectionId, action, data) {
  switch (action) {

    case 'rejoin_game': {
      const { roomCode, oldPlayerId } = data;
      const room = await getRoom(roomCode);
      if (!room) return send(apigw, connectionId, { event: 'error', message: 'Salle introuvable.' });
      const player = room.getPlayer(oldPlayerId);
      if (!player) return send(apigw, connectionId, { event: 'error', message: 'Joueur introuvable.' });
      await deleteConn(oldPlayerId);
      player.id = connectionId;
      player.offline = false;
      if (room.hostId === oldPlayerId) room.hostId = connectionId;
      await saveConn(connectionId, roomCode);
      await saveRoom(room);
      console.log(`Rejoin: ${player.name} (${oldPlayerId} → ${connectionId})`);
      if (room.phase === 'lobby') {
        await send(apigw, connectionId, { event: 'room_joined', roomCode, playerId: connectionId });
        await broadcast(apigw, room, { event: 'room_update', ...room.getLobbyState() });
      } else if (room.phase === 'deployment') {
        await send(apigw, connectionId, { event: 'deployment_state', ...room.getDeploymentState(connectionId) });
      } else if (room.phase === 'battle') {
        await send(apigw, connectionId, { event: 'game_state', ...room.getGameState(connectionId) });
      }
      break;
    }

    case 'create_room': {
      const { playerName } = data;
      const code = await generateUniqueRoomCode();
      const room = new GameRoom(code, connectionId);
      room.addPlayer(connectionId, playerName);
      await saveRoom(room);
      await saveConn(connectionId, code);
      await send(apigw, connectionId, { event: 'room_created', roomCode: code, playerId: connectionId });
      await send(apigw, connectionId, { event: 'room_update', ...room.getLobbyState() });
      break;
    }

    case 'join_room': {
      const { roomCode, playerName } = data;
      const room = await getRoom(roomCode);
      if (!room) return send(apigw, connectionId, { event: 'error', message: 'Salle introuvable.' });
      if (room.phase !== 'lobby') return send(apigw, connectionId, { event: 'error', message: 'La partie a déjà commencé.' });
      if (room.players.length >= 8) return send(apigw, connectionId, { event: 'error', message: 'La salle est pleine (8 joueurs max).' });
      room.addPlayer(connectionId, playerName);
      await saveRoom(room);
      await saveConn(connectionId, roomCode);
      await send(apigw, connectionId, { event: 'room_joined', roomCode, playerId: connectionId });
      await broadcast(apigw, room, { event: 'room_update', ...room.getLobbyState() });
      break;
    }

    case 'set_budget': {
      const { roomCode, budget } = data;
      const room = await getRoom(roomCode);
      if (!room || room.hostId !== connectionId) return;
      room.budget = Math.max(1000, Math.min(100000, parseInt(budget) || 15000));
      await saveRoom(room);
      await broadcast(apigw, room, { event: 'room_update', ...room.getLobbyState() });
      break;
    }

    case 'set_player_color': {
      const { roomCode, color } = data;
      const room = await getRoom(roomCode);
      if (!room || room.phase !== 'lobby') return;
      const player = room.getPlayer(connectionId);
      const allowed = ['#4a90d9','#e05050','#50c050','#e0a030','#a050d0','#e07840','#40c0c0','#e050a0','#ffffff'];
      if (player && allowed.includes(color)) player.color = color;
      await saveRoom(room);
      await broadcast(apigw, room, { event: 'room_update', ...room.getLobbyState() });
      break;
    }

    case 'select_general': {
      const { roomCode, generalId } = data;
      const room = await getRoom(roomCode);
      if (!room || room.phase !== 'lobby') return;
      const taken = room.players.filter(p => p.id !== connectionId).map(p => p.generalId);
      if (taken.includes(generalId)) return send(apigw, connectionId, { event: 'error', message: 'Ce général est déjà pris.' });
      const player = room.getPlayer(connectionId);
      if (player) player.generalId = generalId;
      await saveRoom(room);
      await broadcast(apigw, room, { event: 'room_update', ...room.getLobbyState() });
      break;
    }

    case 'start_game': {
      const { roomCode } = data;
      const room = await getRoom(roomCode);
      if (!room || room.hostId !== connectionId) return;
      if (room.players.length < 1) return send(apigw, connectionId, { event: 'error', message: 'Il faut au moins 1 joueur.' });
      if (room.players.some(p => !p.generalId)) return send(apigw, connectionId, { event: 'error', message: 'Tous les joueurs doivent choisir un général.' });
      room.startGame();
      await saveRoom(room);
      await broadcast(apigw, room, { event: 'phase_change', phase: 'army_building', budget: room.budget });
      await broadcast(apigw, room, { event: 'room_update', ...room.getLobbyState() });
      break;
    }

    case 'submit_army': {
      const { roomCode, units } = data;
      const room = await getRoom(roomCode);
      if (!room || room.phase !== 'army_building') return;
      const result = room.submitArmy(connectionId, units);
      if (result.error) return send(apigw, connectionId, { event: 'error', message: result.error });
      await send(apigw, connectionId, { event: 'army_accepted' });
      if (room.allArmiesSubmitted()) {
        room.startDeployment();
        await saveRoom(room);
        for (const p of room.players) {
          await send(apigw, p.id, { event: 'phase_change', phase: 'deployment' });
          await send(apigw, p.id, { event: 'deployment_state', ...room.getDeploymentState(p.id) });
        }
      } else {
        await saveRoom(room);
      }
      break;
    }

    case 'place_unit': {
      const { roomCode, unitId, q, r } = data;
      const room = await getRoom(roomCode);
      if (!room || room.phase !== 'deployment') return;
      const result = room.placeUnit(connectionId, unitId, q, r);
      if (result.error) return send(apigw, connectionId, { event: 'error', message: result.error });
      await saveRoom(room);
      await send(apigw, connectionId, { event: 'deployment_state', ...room.getDeploymentState(connectionId) });
      break;
    }

    case 'deployment_ready': {
      const { roomCode } = data;
      const room = await getRoom(roomCode);
      console.log(`[deployment_ready] connectionId=${connectionId} roomCode="${roomCode}" phase=${room?.phase}`);
      if (!room || room.phase !== 'deployment') return send(apigw, connectionId, { event: 'error', message: `Phase invalide: ${room?.phase}` });
      const result = room.setDeploymentReady(connectionId);
      if (result.error) return send(apigw, connectionId, { event: 'error', message: result.error });
      const readyCount = room.players.filter(p => p.isReady).length;
      const total = room.players.length;
      console.log(`[deployment_ready] ${readyCount}/${total} prêts`);
      if (room.allDeployed()) {
        room.startBattle();
        await saveRoom(room);
        for (const p of room.players) {
          await send(apigw, p.id, { event: 'phase_change', phase: 'battle' });
          await send(apigw, p.id, { event: 'initiative_rolled', rolls: room.initiativeRolls, turnOrder: room.turnOrder, turn: room.turn });
          await send(apigw, p.id, { event: 'game_state', ...room.getGameState(p.id) });
        }
        console.log(`[deployment_ready] Bataille démarrée!`);
      } else {
        await saveRoom(room);
        await broadcast(apigw, room, { event: 'deployment_ready_update', readyCount, total });
      }
      break;
    }

    case 'move_unit': {
      const { roomCode, unitId, targetQ, targetR } = data;
      const room = await getRoom(roomCode);
      if (!room || room.phase !== 'battle') return;
      if (room.getCurrentPlayerId() !== connectionId) return send(apigw, connectionId, { event: 'error', message: 'Ce n\'est pas votre tour.' });
      const result = room.moveUnit(connectionId, unitId, targetQ, targetR);
      if (result.error) return send(apigw, connectionId, { event: 'error', message: result.error });
      await saveRoom(room);
      for (const p of room.players) {
        await send(apigw, p.id, { event: 'unit_move_anim', unitId: result.unitId, fromQ: result.fromQ, fromR: result.fromR, path: result.path });
        await send(apigw, p.id, { event: 'game_state', ...room.getGameState(p.id) });
      }
      break;
    }

    case 'attack_unit': {
      const { roomCode, attackerId, targetId } = data;
      const room = await getRoom(roomCode);
      if (!room || room.phase !== 'battle') return;
      if (room.getCurrentPlayerId() !== connectionId) return send(apigw, connectionId, { event: 'error', message: 'Ce n\'est pas votre tour.' });
      const result = room.initiateCombat(connectionId, attackerId, targetId);
      if (result.error) return send(apigw, connectionId, { event: 'error', message: result.error });
      if (result.pending) {
        await saveRoom(room);
        await send(apigw, result.targetPlayerId, { event: 'defense_request', attackId: result.attackId, attackerName: result.attackerName, targetName: result.targetName, targetQ: result.targetQ, targetR: result.targetR, roomCode, isRanged: result.isRanged, targetTypeId: result.targetTypeId });
        await send(apigw, connectionId, { event: 'waiting_defense', attackId: result.attackId });
      }
      break;
    }

    case 'defend_choice': {
      const { roomCode, attackId, choice } = data;
      const room = await getRoom(roomCode);
      if (!room) return;
      const resolved = room.resolveAttack(attackId, choice || 'rien');
      if (resolved.error) return send(apigw, connectionId, { event: 'error', message: resolved.error });
      if (resolved.ok) {
        await saveRoom(room);
        for (const p of room.players) {
          await send(apigw, p.id, { event: 'combat_result', combatLog: resolved.combatLog });
          await send(apigw, p.id, { event: 'game_state', ...room.getGameState(p.id) });
        }
        if (room.phase === 'ended') {
          await broadcast(apigw, room, { event: 'game_over', winnerId: room.winner, winnerName: room.getPlayer(room.winner)?.name });
        }
      }
      break;
    }

    case 'change_stance': {
      const { roomCode, unitId, stanceId } = data;
      const room = await getRoom(roomCode);
      if (!room) return send(apigw, connectionId, { event: 'error', message: 'Salle introuvable.' });
      if (room.getCurrentPlayerId() !== connectionId) return send(apigw, connectionId, { event: 'error', message: 'Ce n\'est pas votre tour.' });
      const result = room.changeStance(connectionId, unitId, stanceId);
      if (result.error) return send(apigw, connectionId, { event: 'error', message: result.error });
      await saveRoom(room);
      for (const p of room.players) await send(apigw, p.id, { event: 'game_state', ...room.getGameState(p.id) });
      break;
    }

    case 'motivate_unit': {
      const { roomCode, generalId } = data;
      const room = await getRoom(roomCode);
      if (!room || room.phase !== 'battle') return;
      if (room.getCurrentPlayerId() !== connectionId) return send(apigw, connectionId, { event: 'error', message: 'Ce n\'est pas votre tour.' });
      const result = room.motivateUnit(connectionId, generalId);
      if (result.error) return send(apigw, connectionId, { event: 'error', message: result.error });
      await saveRoom(room);
      await send(apigw, connectionId, { event: 'motivate_result', ...result });
      for (const p of room.players) await send(apigw, p.id, { event: 'game_state', ...room.getGameState(p.id) });
      break;
    }

    case 'chat_message': {
      const { roomCode, text } = data;
      const room = await getRoom(roomCode);
      if (!room) return;
      const player = room.getPlayer(connectionId);
      if (!player) return;
      const msg = String(text || '').slice(0, 200).trim();
      if (!msg) return;
      await broadcast(apigw, room, { event: 'chat_message', authorId: connectionId, authorName: player.name, text: msg });
      break;
    }

    case 'ping': {
      const { roomCode, q, r } = data;
      const room = await getRoom(roomCode);
      if (!room) return;
      const player = room.getPlayer(connectionId);
      if (!player) return;
      await broadcast(apigw, room, { event: 'ping', q, r, color: player.color || '#ffd700' });
      break;
    }

    case 'use_ability': {
      const { roomCode, targetHex, targetId } = data;
      const room = await getRoom(roomCode);
      if (!room || room.phase !== 'battle') return;
      if (room.getCurrentPlayerId() !== connectionId) return send(apigw, connectionId, { event: 'error', message: 'Ce n\'est pas votre tour.' });
      const result = room.useGeneralAbility(connectionId, targetHex, targetId);
      if (result.error) return send(apigw, connectionId, { event: 'error', message: result.error });
      await saveRoom(room);
      await broadcast(apigw, room, { event: 'combat_result', combatLog: result.combatLog });
      for (const p of room.players) await send(apigw, p.id, { event: 'game_state', ...room.getGameState(p.id) });
      break;
    }

    case 'end_turn': {
      const { roomCode } = data;
      const room = await getRoom(roomCode);
      if (!room || room.phase !== 'battle') return;
      if (room.getCurrentPlayerId() !== connectionId) return send(apigw, connectionId, { event: 'error', message: 'Ce n\'est pas votre tour.' });
      const { newRound, fled } = room.endTurn();
      await saveRoom(room);
      if (newRound) {
        await broadcast(apigw, room, { event: 'initiative_rolled', rolls: room.initiativeRolls, turnOrder: room.turnOrder, turn: room.turn });
      }
      await broadcast(apigw, room, { event: 'turn_change', currentPlayerId: room.getCurrentPlayerId(), turn: room.turn });
      if (fled && fled.length > 0) await broadcast(apigw, room, { event: 'units_fled', fled });
      for (const p of room.players) await send(apigw, p.id, { event: 'game_state', ...room.getGameState(p.id) });
      break;
    }

    default:
      console.warn(`Action inconnue: ${action}`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function generateUniqueRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const existing = await ddb.send(new GetCommand({ TableName: ROOMS_TABLE, Key: { roomCode: code } }));
    if (!existing.Item) return code;
  }
  throw new Error('Impossible de générer un code de salle unique');
}
