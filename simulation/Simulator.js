const GameRoom = require('../game/GameRoom');
const GENERALS = require('../game/data/generals');
const UNITS = require('../game/data/units');
const AIAgent = require('./AIAgent');
const RewardFunction = require('./RewardFunction');
const { hexKey } = require('../game/HexUtils');

const MAX_TURNS = 200;
const PLAYER_COLORS = ['#4a90d9', '#d94a4a', '#4ad94a', '#d9d94a', '#d94ad9', '#4ad9d9', '#d9944a', '#944ad9'];

class Simulator {
  constructor(config) {
    this.generalId1 = config.generalId1;
    this.generalId2 = config.generalId2;
    this.budget = config.budget || 2500;
    this.record = config.record || false;
    this.noInitiative = config.noInitiative || false;
  }

  run() {
    const rewardFn = new RewardFunction();
    const agent1 = new AIAgent('p1', rewardFn);
    const agent2 = new AIAgent('p2', rewardFn);

    let room, army1, army2;
    const MAX_RETRIES = 20;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      room = new GameRoom('SIM', 'p1');
      room.addPlayer('p1', 'AI_1');
      room.addPlayer('p2', 'AI_2');

      const p1 = room.getPlayer('p1');
      const p2 = room.getPlayer('p2');
      p1.generalId = this.generalId1;
      p2.generalId = this.generalId2;
      p1.color = PLAYER_COLORS[0];
      p2.color = PLAYER_COLORS[1];
      room.budget = this.budget;

      room.startGame();

      army1 = agent1.buildArmy(this.budget, this.generalId1);
      army2 = agent2.buildArmy(this.budget, this.generalId2);

      const res1 = room.submitArmy('p1', army1);
      const res2 = room.submitArmy('p2', army2);

      if (res1.error || res2.error) {
        return { error: res1.error || res2.error, winner: null, turns: 0 };
      }

      room.startDeployment();

      const minNeeded = Math.max(p1.units.length, p2.units.length);
      const z1 = p1.startingZone;
      const z2 = p2.startingZone;
      if (z1 && z2 && z1.tiles.length >= minNeeded && z2.tiles.length >= minNeeded) {
        break;
      }
    }

    agent1.deploy(room);
    agent2.deploy(room);
    room.setDeploymentReady('p1');
    room.setDeploymentReady('p2');

    const initialStats = this._captureUnitStats(room);

    // Replay recording
    const replay = this.record ? {
      generalId1: this.generalId1,
      generalId2: this.generalId2,
      budget: this.budget,
      players: room.players.map(p => ({ id: p.id, name: p.name, generalId: p.generalId, color: p.color })),
      heightData: room.heightData,
      frames: [],
    } : null;

    // Record initial deployment state
    if (replay) {
      replay.frames.push({
        type: 'deployment',
        turn: 0,
        manche: 0,
        currentPlayerId: null,
        units: this._snapshotAllUnits(room),
      });
    }

    room.startBattle();

    if (this.noInitiative) {
      const order = Math.random() < 0.5 ? ['p1', 'p2'] : ['p2', 'p1'];
      room.turnOrder = order;
      room.currentTurnIndex = 0;
      room._rollInitiative = function () {
        this.currentTurnIndex = 0;
      };
    }

    if (replay) {
      replay.frames.push({
        type: 'battle_start',
        turn: room.turn,
        manche: room.manche,
        currentPlayerId: room.getCurrentPlayerId(),
        initiativeRolls: { ...room.initiativeRolls },
        turnOrder: [...room.turnOrder],
        units: this._snapshotAllUnits(room),
      });
    }

    let turnCount = 0;

    while (room.phase === 'battle' && turnCount < MAX_TURNS) {
      const currentPlayerId = room.getCurrentPlayerId();
      if (!currentPlayerId) break;

      const agent = currentPlayerId === 'p1' ? agent1 : agent2;

      if (this.record) {
        // Play turn with action recording
        const actions = agent.playTurnRecorded(room);
        for (const action of actions) {
          replay.frames.push({
            type: 'action',
            turn: room.turn,
            manche: room.manche,
            currentPlayerId,
            action,
            units: this._snapshotAllUnits(room),
          });
        }
      } else {
        agent.playTurn(room);
      }

      const turnResult = room.endTurn();
      turnCount++;

      if (replay) {
        replay.frames.push({
          type: 'end_turn',
          turn: room.turn,
          manche: room.manche,
          currentPlayerId: room.getCurrentPlayerId(),
          newRound: turnResult.newRound,
          fled: turnResult.fled,
          units: this._snapshotAllUnits(room),
          phase: room.phase,
          winner: room.winner,
        });
      }

      if (room.phase === 'ended') break;
    }

    const finalStats = this._captureUnitStats(room);
    const winner = room.winner;
    const isDraw = room.phase !== 'ended';

    if (replay) {
      replay.winner = winner;
      replay.isDraw = isDraw;
      replay.totalTurns = room.turn;
      replay.totalManches = turnCount;
    }

    return {
      winner,
      isDraw,
      generalId1: this.generalId1,
      generalId2: this.generalId2,
      budget: this.budget,
      turns: room.turn,
      manches: turnCount,
      initialStats,
      finalStats,
      army1,
      army2,
      replay,
    };
  }

  _snapshotAllUnits(room) {
    const units = [];
    for (const p of room.players) {
      for (const u of p.units) {
        units.push({
          id: u.id,
          playerId: p.id,
          typeId: u.typeId || 'general',
          name: u.name,
          isGeneral: u.isGeneral,
          category: u.category,
          q: u.q,
          r: u.r,
          vitality: u.vitality,
          maxVitality: u.maxVitality,
          morale: u.isGeneral ? null : u.morale,
          maxMorale: u.isGeneral ? null : u.maxMorale,
          armor: u.armor,
          maxArmor: u.maxArmor,
          stance: u.stance || null,
          isFleeing: u.isFleeing,
          facing: u.facing,
          speedRemaining: u.speedRemaining,
          hasMoved: u.hasMoved,
          hasAttacked: u.hasAttacked,
        });
      }
    }
    return units;
  }

  _captureUnitStats(room) {
    const stats = {};
    for (const p of room.players) {
      stats[p.id] = {
        generalId: p.generalId,
        isEliminated: p.isEliminated,
        units: p.units.map(u => ({
          id: u.id,
          typeId: u.typeId || 'general',
          name: u.name,
          isGeneral: u.isGeneral,
          category: u.category,
          vitality: u.vitality,
          maxVitality: u.maxVitality,
          morale: u.isGeneral ? null : u.morale,
          maxMorale: u.isGeneral ? null : u.maxMorale,
          armor: u.armor,
          stance: u.stance || null,
          isFleeing: u.isFleeing,
          alive: u.vitality > 0,
        })),
        totalVitality: p.units.reduce((s, u) => s + u.vitality, 0),
        totalMaxVitality: p.units.reduce((s, u) => s + u.maxVitality, 0),
        unitCount: p.units.filter(u => u.q !== null).length,
      };
    }
    return stats;
  }
}

module.exports = Simulator;
