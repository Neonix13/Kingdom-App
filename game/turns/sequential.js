// Sequential mode: players act one after another in initiative order (re-rolled every round).
// Turn state lives on the room (turnOrder, currentTurnIndex, initiativeRolls, turn, manche) so it serializes as-is.

function isAlive(room, id) {
  const p = room.getPlayer(id);
  return !!p && !p.isEliminated;
}

function beginPlayerTurn(room, playerId) {
  const player = room.getPlayer(playerId);
  if (!player) return [];
  for (const u of player.units) {
    room._applyTurnRegen(u);
    room._initUnitSpeedForTurn(u);
  }
  return room._processFleeing(playerId);
}

function skipEliminated(room) {
  while (room.currentTurnIndex < room.turnOrder.length && !isAlive(room, room.turnOrder[room.currentTurnIndex])) {
    room.currentTurnIndex++;
  }
}

function advance(room) {
  room.currentTurnIndex++;
  room.manche++;
  skipEliminated(room);
  let newRound = false;
  if (room.currentTurnIndex >= room.turnOrder.length) {
    newRound = true;
    room.turn++;
    room.manche = 1;
    room.activeEffects = room.activeEffects
      .map(e => ({ ...e, turnsLeft: e.turnsLeft - 1 }))
      .filter(e => e.turnsLeft > 0);
    room._applyPassives();
    room.onRoundStart();
    if (room.phase !== 'battle') return { newRound, fled: [] };
    room._rollInitiative();
    skipEliminated(room);
  }
  const next = sequential.currentPlayerId(room);
  const fled = next ? beginPlayerTurn(room, next) : [];
  return { newRound, fled };
}

const sequential = {
  id: 'sequential',

  start(room) {
    room.turn = 1;
    room.manche = 1;
    room._rollInitiative();
    skipEliminated(room);
    const first = sequential.currentPlayerId(room);
    if (first) {
      const p = room.getPlayer(first);
      for (const u of p.units) room._initUnitSpeedForTurn(u);
    }
  },

  currentPlayerId(room) {
    if (room.phase !== 'battle' && room.phase !== 'ended') return null;
    const id = room.turnOrder[room.currentTurnIndex];
    return id && isAlive(room, id) ? id : null;
  },

  canAct(room, playerId) {
    return room.phase === 'battle' && sequential.currentPlayerId(room) === playerId;
  },

  endTurn(room) {
    const current = room.getPlayer(room.turnOrder[room.currentTurnIndex]);
    if (current) room.onPlayerTurnEnd(current.id);
    if (current) {
      for (const u of current.units) {
        u.hasMoved = false;
        u.hasAttacked = false;
        if (u.isGeneral) {
          u.hasUsedAbility = false;
          if (u.abilityCooldown > 0) u.abilityCooldown--;
        }
      }
    }
    return advance(room);
  },

  // Called after any resolution: if the active player was eliminated during their own turn, pass the turn.
  settle(room) {
    if (room.phase !== 'battle') return null;
    if (sequential.currentPlayerId(room)) return null;
    if (!room.players.some(p => !p.isEliminated)) return null;
    return advance(room);
  },
};

module.exports = sequential;
