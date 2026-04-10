const GENERALS = require('./data/generals');
const UNITS = require('./data/units');
const { hexDistance, hexKey, hexNeighbors, hexesInRange, generateHexMap, findPath, getStartingZones, segmentEdgeKey, getSegmentData, SEGMENT_DEFS, hexFacing, hexFacingRanged } = require('./HexUtils');
const STANCES = require('./data/stances');
const TERRAINS = require('./data/terrains');
const SEGMENTS = require('./data/segments');
const fs = require('fs');
const nodePath = require('path');

const MAP_RADIUS = 70;

function newUnitId(room) {
  room._unitCounter = (room._unitCounter || 0) + 1;
  return `u_${room._unitCounter}`;
}

class GameRoom {
  constructor(roomCode, hostId) {
    this.roomCode = roomCode;
    this.hostId = hostId;
    this.players = [];
    this.phase = 'lobby'; // lobby | army_building | deployment | battle | ended
    this.budget = 2500;
    this.hexMap = {};
    this.unitMap = {}; // hexKey -> unit
    this.turn = 1;
    this.manche = 1;
    this.turnOrder = [];       // IDs des joueurs dans l'ordre d'initiative
    this.initiativeRolls = {}; // playerId -> { d20, strategy, total, playerName, generalName }
    this.currentTurnIndex = 0;
    this.winner = null;
    this.abilityCooldowns = {}; // playerId -> turnsRemaining
    this.activeEffects = []; // { type, targetPlayerId, turnsLeft, value }
    this.pendingAttacks = {}; // attackId -> pending attack data
    this._unitCounter = 0;
    this._loadStaticData();
  }

  _loadStaticData() {
    try { this.terrainData = JSON.parse(fs.readFileSync(nodePath.join(__dirname, '../public/data/terrain.json'), 'utf8')); } catch(e) { this.terrainData = {}; }
    try { this.segmentData = JSON.parse(fs.readFileSync(nodePath.join(__dirname, '../public/data/segments.json'), 'utf8')); } catch(e) { this.segmentData = {}; }
    try { this.heightData = JSON.parse(fs.readFileSync(nodePath.join(__dirname, '../public/data/height.json'), 'utf8')); } catch(e) { this.heightData = {}; }
  }

  addPlayer(id, name) {
    this.players.push({
      id,
      name,
      generalId: null,
      generalUnit: null,  // placed general unit
      units: [],          // bought units
      placedUnits: {},    // unitId -> { q, r }
      isReady: false,
      isEliminated: false,
    });
  }

  getPlayer(id) {
    return this.players.find(p => p.id === id);
  }

  removePlayer(id) {
    this.players = this.players.filter(p => p.id !== id);
  }

  getLobbyState() {
    return {
      roomCode: this.roomCode,
      hostId: this.hostId,
      phase: this.phase,
      budget: this.budget,
      players: this.players.filter(p => !p.offline).map(p => {
        const gd = GENERALS.find(g => g.id === p.generalId);
        return {
          id: p.id,
          name: p.name,
          generalId: p.generalId,
          generalName: gd ? gd.name : null,
          isReady: p.isReady,
          isEliminated: p.isEliminated,
          isBot: p.isBot || false,
          color: p.color || '#4a90d9',
          flag: p.flag || null,
        };
      }),
      takenGenerals: this.players.filter(p => p.generalId && !p.offline).map(p => p.generalId),
    };
  }

  startGame() {
    this.phase = 'army_building';
    this.hexMap = generateHexMap(MAP_RADIUS);
  }

  submitArmy(playerId, unitList) {
    // unitList: [{ typeId, count }]
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Joueur introuvable.' };

    let totalCost = 0;
    const units = [];

    for (const { typeId, count } of unitList) {
      const unitData = UNITS[typeId];
      if (!unitData) return { error: `Unité inconnue: ${typeId}` };
      if (count < 0) return { error: 'Quantité invalide.' };
      totalCost += unitData.cost * count;
      for (let i = 0; i < count; i++) {
        units.push(this._createUnit(typeId, playerId));
      }
    }

    if (totalCost > this.budget) {
      return { error: `Budget dépassé. Max: ${this.budget}, utilisé: ${totalCost}` };
    }

    // Add the general as a special unit
    const generalData = GENERALS.find(g => g.id === player.generalId);
    if (!generalData) return { error: 'Général non sélectionné.' };

    const generalUnit = {
      id: newUnitId(this),
      playerId,
      typeId: 'general',
      name: generalData.name,
      isGeneral: true,
      generalId: generalData.id,
      vitality: generalData.vitality,
      maxVitality: generalData.vitality,
      force: generalData.force,
      strategy: generalData.strategy,
      charisma: generalData.charisma,
      power: generalData.power,
      armor: generalData.armor,
      maxArmor: generalData.armor,
      intimidation: generalData.intimidation,
      speed: 4,
      range: 1,
      visionRange: generalData.strategy, // 1 hex = 100m
      hasMoved: false,
      hasAttacked: false,
      hasUsedAbility: false,
      abilityCooldown: 0,
      q: null,
      r: null,
      buffs: [],
      category: 'Général',
      kingdom: generalData.kingdom,
      weapon: generalData.weapon.name,
      activeAbility: generalData.activeAbility,
      passiveAbility: generalData.passiveAbility,
      citation: generalData.citation,
      speedRemaining: 0,
      isFleeing: false,
      facing: 5,
      damageDealt: 0,
    };

    player.units = [generalUnit, ...units];
    player.generalUnit = generalUnit;
    player.armySubmitted = true;

    return { ok: true };
  }

  _createUnit(typeId, playerId) {
    const data = UNITS[typeId];
    return {
      id: newUnitId(this),
      playerId,
      typeId,
      name: data.name,
      isGeneral: false,
      vitality: data.vitality,
      maxVitality: data.maxVitality,
      morale: data.morale,
      maxMorale: data.maxMorale,
      attack: data.attack,
      power: data.power,
      defense: data.defense,
      armor: data.armor,
      maxArmor: data.armor,
      intimidation: data.intimidation,
      speed: data.speed,
      range: data.range,
      visionRange: 3,
      hasMoved: false,
      hasAttacked: false,
      q: null,
      r: null,
      buffs: [],
      category: data.category,
      bonus: data.bonus || null,
      stance: 'marche',
      speedRemaining: 0,
      isFleeing: false,
      facing: 5,
      damageDealt: 0,
    };
  }

  allArmiesSubmitted() {
    return this.players.every(p => p.armySubmitted);
  }

  startDeployment() {
    this.phase = 'deployment';
    const zones = getStartingZones(this.players.length, MAP_RADIUS, this.budget);
    this.players.forEach((p, i) => {
      p.startingZone = zones[i];
      p.isReady = false;
    });
    // Auto-place all units randomly in their starting zone
    this.players.forEach(p => this._autoDeployPlayer(p));
  }

  _autoDeployPlayer(player) {
    const zone = player.startingZone;
    if (!zone || !zone.tiles) return;
    // Shuffle available tiles (exclude river, stay in hexMap)
    const available = zone.tiles
      .filter(t => {
        const key = hexKey(t.q, t.r);
        return this.hexMap[key] && this.hexMap[key].terrain !== 'river';
      })
      .sort(() => Math.random() - 0.5);

    // Compute enemy center for facing
    const enemyCenters = this.players
      .filter(p => p.id !== player.id && p.startingZone)
      .map(p => p.startingZone);
    const bq = enemyCenters.length > 0
      ? Math.round(enemyCenters.reduce((s, z) => s + z.q, 0) / enemyCenters.length)
      : 0;
    const br = enemyCenters.length > 0
      ? Math.round(enemyCenters.reduce((s, z) => s + z.r, 0) / enemyCenters.length)
      : 0;

    const occupied = new Set();
    // Place general first
    const general = player.units.find(u => u.isGeneral);
    const others = player.units.filter(u => !u.isGeneral);
    const ordered = general ? [general, ...others] : others;

    for (const unit of ordered) {
      const tile = available.find(t => !occupied.has(`${t.q},${t.r}`));
      if (!tile) break;
      unit.q = tile.q;
      unit.r = tile.r;
      unit.facing = hexFacing(tile.q, tile.r, bq, br);
      occupied.add(`${tile.q},${tile.r}`);
    }
  }

  getDeploymentState(playerId) {
    const player = this.getPlayer(playerId);
    const general = GENERALS.find(g => g.id === player.generalId);
    return {
      phase: 'deployment',
      myId: playerId,
      budget: this.budget,
      startingZone: player.startingZone,
      units: player.units,
      placedUnits: player.placedUnits,
      generalData: general,
      occupiedHexes: this._getAllOccupiedHexes(),
      players: this.players.map(p => ({ id: p.id, name: p.name, color: p.color || '#4a90d9' })),
    };
  }

  serialize() {
    return {
      roomCode: this.roomCode,
      hostId: this.hostId,
      players: this.players,
      phase: this.phase,
      budget: this.budget,
      turn: this.turn,
      manche: this.manche,
      turnOrder: this.turnOrder,
      initiativeRolls: this.initiativeRolls,
      currentTurnIndex: this.currentTurnIndex,
      winner: this.winner,
      abilityCooldowns: this.abilityCooldowns,
      activeEffects: this.activeEffects,
      pendingAttacks: this.pendingAttacks,
      _unitCounter: this._unitCounter,
    };
  }

  static deserialize(data) {
    const room = new GameRoom(data.roomCode, data.hostId);
    room.players = data.players;
    room.phase = data.phase;
    room.budget = data.budget;
    room.turn = data.turn || 1;
    room.turnOrder = data.turnOrder || [];
    room.initiativeRolls = data.initiativeRolls || {};
    room.currentTurnIndex = data.currentTurnIndex || 0;
    room.winner = data.winner || null;
    room.abilityCooldowns = data.abilityCooldowns || {};
    room.activeEffects = data.activeEffects || [];
    room.pendingAttacks = data.pendingAttacks || {};
    room._unitCounter = data._unitCounter || 0;
    // Recharger les données statiques (terrain/segments) depuis fichiers
    room._loadStaticData();
    if (['army_building', 'deployment', 'battle', 'ended'].includes(data.phase)) {
      room.hexMap = generateHexMap(MAP_RADIUS);
    }
    if (['deployment', 'battle', 'ended'].includes(data.phase)) {
      room._rebuildUnitMap();
    }
    return room;
  }

  _getAllOccupiedHexes() {
    const occupied = {};
    for (const p of this.players) {
      for (const unit of p.units) {
        if (unit.q !== null) occupied[hexKey(unit.q, unit.r)] = { unitId: unit.id, playerId: p.id };
      }
    }
    return occupied;
  }

  placeUnit(playerId, unitId, q, r) {
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Joueur introuvable.' };

    const zone = player.startingZone;
    const tileSet = new Set((zone.tiles || []).map(t => `${t.q},${t.r}`));
    if (!tileSet.has(`${q},${r}`)) return { error: 'Hors de la zone de déploiement.' };

    const key = hexKey(q, r);
    if (!this.hexMap[key]) return { error: 'Case invalide.' };

    // Pas de déploiement sur la rivière
    const terrain = this.hexMap[key]?.terrain;
    if (terrain === 'river') return { error: 'Impossible de se déployer sur la rivière.' };

    // Check if occupied
    for (const p of this.players) {
      for (const u of p.units) {
        if (u.q === q && u.r === r) return { error: 'Case déjà occupée.' };
      }
    }

    const unit = player.units.find(u => u.id === unitId);
    if (!unit) return { error: 'Unité introuvable.' };

    unit.q = q;
    unit.r = r;

    const enemyCenters = this.players
      .filter(p => p.id !== playerId && p.startingZone)
      .map(p => p.startingZone);
    if (enemyCenters.length > 0) {
      const bq = Math.round(enemyCenters.reduce((s, z) => s + z.q, 0) / enemyCenters.length);
      const br = Math.round(enemyCenters.reduce((s, z) => s + z.r, 0) / enemyCenters.length);
      unit.facing = hexFacing(q, r, bq, br);
    }

    return { ok: true };
  }

  setDeploymentReady(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Joueur introuvable.' };

    // Check general is placed — toujours chercher dans units (generalUnit peut être désynchronisé après désérialisation DynamoDB)
    const generalUnit = player.units.find(u => u.isGeneral);
    if (!generalUnit || generalUnit.q === null) {
      return { error: 'Vous devez placer votre général avant d\'être prêt.' };
    }

    player.isReady = true;
    return { ok: true };
  }

  allDeployed() {
    return this.players.every(p => p.isReady);
  }

  startBattle() {
    this.phase = 'battle';
    this.turn = 1;
    this._rollInitiative();
    this._rebuildUnitMap();
    for (const p of this.players) {
      for (const u of p.units) {
        u.hasMoved = false;
        u.hasAttacked = false;
      }
    }
    // Init speed for first player
    const firstPlayer = this.getPlayer(this.getCurrentPlayerId());
    if (firstPlayer) {
      for (const u of firstPlayer.units) {
        this._initUnitSpeedForTurn(u);
      }
    }
  }

  _rollInitiative() {
    const activePlayers = this.players.filter(p => !p.isEliminated);
    this.initiativeRolls = {};
    for (const p of activePlayers) {
      const general = GENERALS.find(g => g.id === p.generalId);
      const strategy = general ? general.strategy : 10;
      const d20 = Math.floor(Math.random() * 20) + 1;
      this.initiativeRolls[p.id] = {
        d20,
        strategy,
        total: strategy + d20,
        playerName: p.name,
        generalName: general?.name || '?',
      };
    }
    // Trier du plus grand au plus petit total (égalité : D20 le plus grand)
    this.turnOrder = activePlayers
      .slice()
      .sort((a, b) => {
        const aR = this.initiativeRolls[a.id];
        const bR = this.initiativeRolls[b.id];
        if (bR.total !== aR.total) return bR.total - aR.total;
        return bR.d20 - aR.d20;
      })
      .map(p => p.id);
    this.currentTurnIndex = 0;
  }

  _rebuildUnitMap() {
    this.unitMap = {};
    for (const p of this.players) {
      for (const u of p.units) {
        if (u.q !== null) this.unitMap[hexKey(u.q, u.r)] = u;
      }
    }
  }

  getCurrentPlayerId() {
    if (this.turnOrder.length === 0) return null;
    // Passer les joueurs éliminés en cours de round
    for (let i = 0; i < this.turnOrder.length; i++) {
      const id = this.turnOrder[(this.currentTurnIndex + i) % this.turnOrder.length];
      const player = this.getPlayer(id);
      if (player && !player.isEliminated) return id;
    }
    return null;
  }

  // Compute visible hexes for a player
  getVisibleHexes(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return new Set();
    // Spectateur : union de la vision de tous les joueurs vivants
    if (player.isEliminated) {
      const all = new Set();
      for (const p of this.players) {
        if (!p.isEliminated) {
          for (const hex of this._getVisibleHexesForPlayer(p.id)) all.add(hex);
        }
      }
      return all;
    }
    return this._getVisibleHexesForPlayer(playerId);
  }

  _getVisibleHexesForPlayer(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return new Set();
    const visible = new Set();

    const sd = getSegmentData();
    const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
    for (const unit of player.units) {
      if (unit.q === null) continue;
      const unitTerrain = this.terrainData[hexKey(unit.q, unit.r)] || 'plain';
      const inForest = unitTerrain === 'forest';
      let baseRange;
      if (unit.typeId === 'espion') {
        baseRange = inForest ? 4 : 6;
      } else {
        baseRange = inForest ? 2 : Math.max(3, unit.visionRange);
      }
      const myHeight = this.heightData[hexKey(unit.q, unit.r)] || 0;
      const heightBonus = unit.isGeneral ? myHeight * 2 : myHeight;
      const maxRange = baseRange + heightBonus;
      // BFS bloqué par segments infranchissables
      const visited = new Map(); // key -> distance
      const queue = [{ q: unit.q, r: unit.r, d: 0 }];
      visited.set(hexKey(unit.q, unit.r), 0);
      while (queue.length) {
        const { q, r, d } = queue.shift();
        const key = hexKey(q, r);
        if (!this.hexMap[key]) continue;
        const targetHeight = this.heightData[key] || 0;
        const effectiveRange = unit.isGeneral
          ? baseRange + myHeight * 2
          : baseRange + Math.max(0, myHeight - targetHeight);
        const isForest = this.terrainData[key] === 'forest';
        const isLowerForest = isForest && targetHeight < myHeight;
        // Forêt bloque la vision, sauf général en hauteur ou espion
        if (!inForest && isForest && d > 2) {
          if (unit.isGeneral && isLowerForest) {
            // Le général en hauteur peut voir DERRIÈRE la forêt inférieure (pas DANS)
          } else if (unit.typeId === 'espion') {
            // L'espion voit à l'intérieur des forêts depuis l'extérieur, seulement à d≤4
            if (d > 4) continue;
          } else {
            continue;
          }
        }
        if (d <= effectiveRange && !(unit.isGeneral && isLowerForest && d > 2)) visible.add(key);
        if (d >= maxRange) continue;
        for (const [dq, dr] of DIRS) {
          const nq = q + dq, nr = r + dr;
          const nk = hexKey(nq, nr);
          if (visited.has(nk)) continue;
          const edgeK = segmentEdgeKey(q, r, nq, nr);
          const segDef = sd[edgeK] ? SEGMENT_DEFS[sd[edgeK]] : null;
          if (segDef?.infranchissable && sd[edgeK] !== 'cliff') { visited.set(nk, maxRange + 1); continue; }
          visited.set(nk, d + 1);
          queue.push({ q: nq, r: nr, d: d + 1 });
        }
      }
    }
    return visible;
  }

  getGameState(playerId) {
    const player = this.getPlayer(playerId);
    const visibleHexes = this.getVisibleHexes(playerId);
    const general = GENERALS.find(g => g.id === player.generalId);
    const isSpectator = player.isEliminated;

    // Build visible units list
    const visibleUnits = [];
    for (const p of this.players) {
      for (const u of p.units) {
        if (u.q === null) continue;
        const key = hexKey(u.q, u.r);
        // Assassin : invisible pour les ennemis à plus de 4 cases
        const assassinHidden = u.typeId === 'assassin' && p.id !== playerId && !isSpectator
          && player.units.every(myU => myU.q === null || hexDistance(myU.q, myU.r, u.q, u.r) > 4);
        if (!assassinHidden && (isSpectator || p.id === playerId || visibleHexes.has(key))) {
          visibleUnits.push({
            ...u,
            isMine: p.id === playerId,
            playerId: p.id,
          });
        }
      }
    }

    return {
      phase: this.phase,
      turn: this.turn,
      manche: this.manche,
      currentPlayerId: this.getCurrentPlayerId(),
      myId: playerId,
      isSpectator,
      budget: this.budget,
      generalData: general,
      visibleHexes: Array.from(visibleHexes),
      units: visibleUnits,
      myUnits: player.units,
      players: this.players.map(p => {
        const gd = GENERALS.find(g => g.id === p.generalId);
        return {
          id: p.id,
          name: p.name,
          generalId: p.generalId,
          generalName: gd ? gd.name : null,
          isEliminated: p.isEliminated,
          unitCount: p.units.length,
          color: p.color || '#4a90d9',
        };
      }),
      turnOrder: this.turnOrder,
      initiativeRolls: this.initiativeRolls,
      activeEffects: this.activeEffects.filter(e => e.targetPlayerId === playerId),
      winner: this.winner,
      heightData: this.heightData,
      segmentData: this.segmentData,
    };
  }

  moveUnit(playerId, unitId, targetQ, targetR) {
    const player = this.getPlayer(playerId);
    const unit = player.units.find(u => u.id === unitId);
    if (!unit) return { error: 'Unité introuvable.' };
    if (unit.isFleeing) return { error: 'Unité en fuite.' };
    if (unit.speedRemaining <= 0) return { error: 'Plus de déplacement disponible.' };

    const path = findPath(this.hexMap, this.unitMap, unit.q, unit.r, targetQ, targetR, unit.speedRemaining, playerId, unit);
    if (path === null) return { error: 'Chemin inaccessible.' };

    const fromQ = unit.q, fromR = unit.r;

    // Move unit
    delete this.unitMap[hexKey(unit.q, unit.r)];
    unit.q = targetQ;
    unit.r = targetR;
    unit.hasMoved = true;

    // Cost: terrain exit cost + segment crossing cost
    const fullPath = [[fromQ, fromR], ...path];
    const terrainCosts = { plain: 1, road: 1, forest: 2, river: 2, building: 1, bridge: 1 };
    let moveCost = 0;
    let vitesseTout = false;
    for (let i = 0; i < path.length; i++) {
      const [pq, pr] = fullPath[i];
      const [nq, nr] = path[i];
      const t = this.hexMap[hexKey(pq, pr)]?.terrain || 'plain';
      let stepCost = terrainCosts[t] ?? 1;
      const edgeK = segmentEdgeKey(pq, pr, nq, nr);
      const segType = this.segmentData[edgeK];
      const segDef = segType ? SEGMENTS[segType] : null;
      if (segDef) {
        if (segDef.vitesse_fixe != null) {
          stepCost = segDef.vitesse_fixe;
        } else {
          stepCost += Math.max(0, -(segDef.vitesse || 0));
        }
      }
      moveCost += stepCost;
    }
    if (vitesseTout) moveCost = unit.speedRemaining;
    unit.speedRemaining = Math.max(0, unit.speedRemaining - moveCost);
    this.unitMap[hexKey(targetQ, targetR)] = unit;

    if (path.length > 0) {
      const last = path.length - 1;
      const prevQ = last === 0 ? fromQ : path[last - 1][0];
      const prevR = last === 0 ? fromR : path[last - 1][1];
      unit.facing = hexFacing(prevQ, prevR, path[last][0], path[last][1]);
    }

    // Piétinement : char attaque automatiquement les unités traversées (hors destination)
    const trampledAttacks = [];
    if (unit.typeId === 'char' && path.length > 1) {
      for (let i = 0; i < path.length - 1; i++) {
        const [pq, pr] = path[i];
        const enemy = this.unitMap[hexKey(pq, pr)];
        if (enemy && enemy.playerId !== playerId) {
          const log = this._resolveTrample(unit, enemy, playerId);
          if (log) trampledAttacks.push(log);
        }
      }
    }

    return { ok: true, unitId: unit.id, fromQ, fromR, path, trampledAttacks };
  }

  _resolveTrample(attacker, target, playerId) {
    const attackerPlayer = this.getPlayer(playerId);
    let targetPlayer = null;
    for (const p of this.players) {
      if (p.id !== playerId) {
        if (p.units.find(u => u.id === target.id)) { targetPlayer = p; break; }
      }
    }
    if (!attackerPlayer || !targetPlayer) return null;

    const result = this._resolveCombat(attacker, target, true, 'rien');

    if (result.dmgReceived > 0) {
      target.vitality = Math.max(0, target.vitality - result.dmgReceived);
      attacker.damageDealt = (attacker.damageDealt || 0) + result.dmgReceived;
    }
    if (result.moralDmg > 0 && !target.isGeneral) {
      target.morale = Math.max(0, target.morale - result.moralDmg);
      if (target.morale <= 0 && !target.isFleeing) { target.stance = 'marche'; target.isFleeing = true; }
    }

    const combatLog = {
      attackerName: attacker.name, targetName: target.name,
      attackerPlayerId: playerId, targetPlayerId: targetPlayer.id,
      defenderPlayerId: targetPlayer.id,
      turn: this.turn, manche: this.manche,
      defenseChoice: 'rien',
      hit: result.hit, dmgReceived: result.dmgReceived, moralDmg: result.moralDmg,
      defenseSuccess: false, counterDmgReceived: 0, counterMoralDmg: 0,
      targetVitalityLeft: target.vitality, targetMoraleLeft: target.morale,
      attackerVitalityLeft: attacker.vitality,
      breakdown: result.breakdown,
      trample: true,
    };

    if (target.vitality <= 0) {
      combatLog.targetKilled = true;
      targetPlayer.units = targetPlayer.units.filter(u => u.id !== target.id);
      delete this.unitMap[hexKey(target.q, target.r)];
      if (target.isGeneral) {
        targetPlayer.isEliminated = true;
        combatLog.generalKilled = true;
        combatLog.eliminatedPlayer = targetPlayer.name;
        this._checkVictory();
      }
    }

    return combatLog;
  }

  // Terrain and stance helpers
  _getTerrainMods(q, r) {
    const type = this.terrainData[`${q},${r}`];
    return TERRAINS[type] || TERRAINS['plain'];
  }

  _getStanceMods(unit) {
    return STANCES[unit.stance] || STANCES['marche'];
  }

  _initUnitSpeedForTurn(unit) {
    if (unit.q === null) return;
    if (unit.isFleeing) {
      unit.speedRemaining = Math.floor(unit.speed / 2);
      return;
    }
    const stance = unit.isGeneral ? {} : this._getStanceMods(unit);
    const terrain = this._getTerrainMods(unit.q, unit.r);
    unit.speedRemaining = Math.max(0, unit.speed + (stance.vitesse || 0) + terrain.vitesse);
  }

  _applyTurnRegen(unit) {
    if (unit.q === null) return;
    const stance = unit.isGeneral ? {} : this._getStanceMods(unit);
    const terrain = this._getTerrainMods(unit.q, unit.r);
    const ar = (stance.armure_tour || 0) + (terrain.armure_tour || 0);
    const mr = (stance.moral_tour || 0) + (terrain.moral_tour || 0);
    const vr = (stance.vitalite_tour || 0) + (terrain.vitalite_tour || 0);
    if (ar !== 0) unit.armor = Math.max(0, Math.min(unit.maxArmor || unit.armor, unit.armor + ar));
    if (mr !== 0 && !unit.isGeneral) unit.morale = Math.max(0, Math.min(unit.maxMorale, unit.morale + mr));
    if (vr !== 0) unit.vitality = Math.max(0, Math.min(unit.maxVitality, unit.vitality + vr));
  }

  // Called at the start of a player's turn to handle fleeing units
  _processFleeing(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return [];
    const fled = [];
    for (const unit of [...player.units]) {
      if (!unit.isFleeing || unit.q === null) continue;
      // Move toward nearest edge
      const dist = hexDistance(0, 0, unit.q, unit.r);
      if (dist === 0) {
        // At center, pick direction q+1
        const tq = unit.q + 1, tr = unit.r;
        if (this.hexMap[hexKey(tq, tr)]) {
          delete this.unitMap[hexKey(unit.q, unit.r)];
          unit.q = tq; unit.r = tr;
          this.unitMap[hexKey(tq, tr)] = unit;
        }
        continue;
      }
      const speed = unit.speedRemaining || unit.speed;
      const scale = (dist + speed) / dist;
      const targetQ = Math.round(unit.q * scale);
      const targetR = Math.round(unit.r * scale);
      if (!this.hexMap[hexKey(targetQ, targetR)]) {
        // Outside map - unit has fled
        player.units = player.units.filter(u => u.id !== unit.id);
        delete this.unitMap[hexKey(unit.q, unit.r)];
        fled.push({ unitId: unit.id, unitName: unit.name });
        if (unit.isGeneral) { player.isEliminated = true; this._checkVictory(); }
      } else if (this.unitMap[hexKey(targetQ, targetR)]) {
        // Target occupied — find nearest free tile away from center
        const neighbors = hexNeighbors(unit.q, unit.r);
        const awayFirst = neighbors.slice().sort((a, b) => hexDistance(0,0,b[0],b[1]) - hexDistance(0,0,a[0],a[1]));
        let moved = false;
        for (const [nq, nr] of awayFirst) {
          const nk = hexKey(nq, nr);
          if (this.hexMap[nk] && !this.unitMap[nk]) {
            delete this.unitMap[hexKey(unit.q, unit.r)];
            unit.q = nq; unit.r = nr;
            this.unitMap[nk] = unit;
            moved = true;
            break;
          }
        }
        // If no free tile found, unit stays put
      } else {
        // Move toward edge
        delete this.unitMap[hexKey(unit.q, unit.r)];
        unit.q = targetQ; unit.r = targetR;
        this.unitMap[hexKey(targetQ, targetR)] = unit;
      }
      unit.speedRemaining = 0; // used up fleeing
      unit.hasMoved = true;
    }
    return fled;
  }

  rotateFacing(playerId, unitId, facing) {
    if (facing < 0 || facing > 5) return { error: 'Orientation invalide.' };
    const player = this.getPlayer(playerId);
    const unit = player?.units.find(u => u.id === unitId);
    if (!unit) return { error: 'Unité introuvable.' };
    if (unit.speedRemaining <= 0) return { error: 'Plus de vitesse disponible.' };
    unit.speedRemaining = Math.max(0, unit.speedRemaining - 1);
    unit.facing = facing;
    return { ok: true };
  }

  changeStance(playerId, unitId, stanceId) {
    if (!STANCES[stanceId]) return { error: 'Posture invalide.' };
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Joueur introuvable.' };
    const unit = player.units.find(u => u.id === unitId);
    if (!unit) return { error: 'Unité introuvable.' };
    if (unit.isGeneral) return { error: 'Les généraux n\'ont pas de posture.' };
    if (unit.isFleeing) return { error: 'Unité en fuite.' };
    if (unit.speedRemaining <= 0) return { error: 'Plus de vitesse disponible pour changer de posture.' };
    if (unit.stance === stanceId) return { error: 'Déjà dans cette posture.' };
    unit.speedRemaining = Math.max(0, unit.speedRemaining - 2);
    unit.stance = stanceId;
    return { ok: true };
  }

  motivateUnit(playerId, generalId) {
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Joueur introuvable.' };
    const general = player.units.find(u => u.id === generalId && u.isGeneral);
    if (!general) return { error: 'Général introuvable.' };
    if (general.hasAttacked) return { error: 'Le général a déjà agi ce tour.' };

    const generalData = GENERALS.find(g => g.id === general.generalId);
    const charisma = generalData ? generalData.charisma : 10;
    const range = Math.floor(charisma / 5);
    const targets = player.units.filter(u => !u.isGeneral && hexDistance(general.q, general.r, u.q, u.r) <= range);
    if (targets.length === 0) return { error: 'Aucune unité à portée.' };

    const d20 = Math.floor(Math.random() * 20) + 1;
    const critSuccess = d20 === 1;
    const critFail = d20 === 20;
    const success = critSuccess || (!critFail && charisma >= d20);
    let moralGain = 0;
    if (critSuccess) {
      moralGain = null; // full restore
    } else if (success) {
      moralGain = Math.max(1, charisma - d20) * 10;
    }
    for (const t of targets) {
      if (critFail) {
        t.morale = Math.max(0, t.morale - 20);
      } else if (critSuccess) {
        t.morale = t.maxMorale;
        t.isFleeing = false;
      } else if (success) {
        t.morale = Math.min(t.maxMorale, t.morale + moralGain);
        if (t.isFleeing && t.morale > 0) t.isFleeing = false;
      }
    }

    // Coût : toute la vitesse restante min 1
    const speedCost = Math.max(1, general.speedRemaining);
    general.speedRemaining = Math.max(0, general.speedRemaining - speedCost);
    general.hasAttacked = true;

    return { ok: true, success, critSuccess, critFail, charisma, d20, range, moralGain, count: targets.length };
  }

  initiateCombat(playerId, attackerId, targetId) {
    const player = this.getPlayer(playerId);
    const attacker = player?.units.find(u => u.id === attackerId);
    if (!attacker) return { error: 'Unité attaquante introuvable.' };
    if (attacker.hasAttacked) return { error: 'Cette unité a déjà attaqué ce tour.' };

    let targetPlayer = null, target = null;
    for (const p of this.players) {
      if (p.id === playerId) continue;
      const u = p.units.find(u => u.id === targetId);
      if (u) { targetPlayer = p; target = u; break; }
    }
    if (!target) return { error: 'Cible introuvable.' };

    const dist = hexDistance(attacker.q, attacker.r, target.q, target.r);
    const hA = this.heightData[hexKey(attacker.q, attacker.r)] || 0;
    const hT = this.heightData[hexKey(target.q, target.r)] || 0;
    const effectiveRange = Math.max(1, (attacker.range || 1) + (hA - hT));
    if (dist > effectiveRange) return { error: `Cible hors de portée (distance: ${dist}, portée: ${effectiveRange}).` };

    // Deduct speed (all remaining, min 1 — Cavalier Léger : coûte 2)
    const speedCost = attacker.typeId === 'cavalier_leger' ? 2 : Math.max(1, attacker.speedRemaining);
    attacker.speedRemaining = Math.max(0, attacker.speedRemaining - speedCost);
    attacker.hasAttacked = true;

    const attackId = `atk_${Date.now()}_${Math.random()}`;
    this.pendingAttacks[attackId] = { attackerPlayerId: playerId, attackerId, targetPlayerId: targetPlayer.id, targetId, dist };

    return { pending: true, attackId, targetPlayerId: targetPlayer.id, attackerName: attacker.name, targetName: target.name, targetQ: target.q, targetR: target.r, isRanged: dist > 1, targetTypeId: target.typeId, attackerTypeId: attacker.typeId };
  }

  resolveAttack(attackId, defenseChoice) {
    const pending = this.pendingAttacks[attackId];
    if (!pending) return { error: 'Attaque introuvable.' };
    delete this.pendingAttacks[attackId];

    const { attackerPlayerId, attackerId, targetPlayerId, targetId, dist } = pending;
    const attackerPlayer = this.getPlayer(attackerPlayerId);
    const targetPlayer = this.getPlayer(targetPlayerId);
    if (!attackerPlayer || !targetPlayer) return { error: 'Joueur disparu.' };
    const attacker = attackerPlayer.units.find(u => u.id === attackerId);
    const target = targetPlayer.units.find(u => u.id === targetId);
    if (!attacker || !target) return { error: 'Unité disparue.' };

    const isCac = dist <= 1;

    if (isCac) {
      attacker.facing = hexFacing(attacker.q, attacker.r, target.q, target.r);
    } else {
      attacker.facing = hexFacingRanged(attacker.q, attacker.r, target.q, target.r);
    }
    if (defenseChoice === 'contre_attaque' || defenseChoice === 'encaissement') {
      target.facing = hexFacing(target.q, target.r, attacker.q, attacker.r);
    }

    const result = this._resolveCombat(attacker, target, isCac, defenseChoice);

    // Apply to target
    target.vitality = Math.max(0, target.vitality - result.dmgReceived);
    // Soldats : exécute si < 10% vitalité après le coup
    if (attacker.typeId === 'soldats' && target.vitality > 0 && target.vitality < target.maxVitality * 0.1) {
      target.vitality = 0;
    }
    target.armor = Math.max(0, target.armor - 1);
    attacker.damageDealt = (attacker.damageDealt || 0) + result.dmgReceived;
    if (!target.isGeneral) {
      target.morale = Math.max(0, target.morale - result.moralDmg);
      if (target.morale <= 0 && !target.isFleeing) { target.stance = 'marche'; target.isFleeing = true; }
    }
    // Cavalier Lourd : 50% des dégâts moral aux unités ennemies adjacentes à la cible
    if (attacker.typeId === 'cavalier_lourd' && result.moralDmg > 0) {
      const aoeIntimDmg = Math.floor(result.moralDmg * 0.5);
      if (aoeIntimDmg > 0) {
        const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
        for (const [dq, dr] of DIRS) {
          const adjUnit = this.unitMap[hexKey(target.q + dq, target.r + dr)];
          if (!adjUnit || adjUnit === target || adjUnit.isGeneral) continue;
          for (const p of this.players) {
            if (p.id === attackerPlayerId) continue;
            const u = p.units.find(u => u.id === adjUnit.id);
            if (u) {
              u.morale = Math.max(0, u.morale - aoeIntimDmg);
              if (u.morale <= 0 && !u.isFleeing) { u.stance = 'marche'; u.isFleeing = true; }
            }
          }
        }
      }
    }

    // Apply to attacker (counter-attack)
    if (result.counterDmgReceived > 0) {
      attacker.vitality = Math.max(0, attacker.vitality - result.counterDmgReceived);
      attacker.armor = Math.max(0, attacker.armor - 1);
      target.damageDealt = (target.damageDealt || 0) + result.counterDmgReceived;
    }
    if (result.counterMoralDmg > 0 && !attacker.isGeneral) {
      attacker.morale = Math.max(0, attacker.morale - result.counterMoralDmg);
      if (attacker.morale <= 0 && !attacker.isFleeing) { attacker.stance = 'marche'; attacker.isFleeing = true; }
    }

    const combatLog = {
      attackerName: attacker.name, targetName: target.name,
      attackerPlayerId: attackerPlayer.id, targetPlayerId: targetPlayer.id,
      defenderPlayerId: targetPlayer.id,
      turn: this.turn, manche: this.manche,
      defenseChoice,
      hit: result.hit,
      dmgReceived: result.dmgReceived,
      moralDmg: result.moralDmg,
      defenseSuccess: result.defenseSuccess,
      counterDmgReceived: result.counterDmgReceived, counterMoralDmg: result.counterMoralDmg,
      targetVitalityLeft: target.vitality, targetMoraleLeft: target.morale,
      attackerVitalityLeft: attacker.vitality,
      breakdown: result.breakdown,
    };

    // Remove dead units
    if (target.vitality <= 0) {
      combatLog.targetKilled = true;
      targetPlayer.units = targetPlayer.units.filter(u => u.id !== targetId);
      delete this.unitMap[hexKey(target.q, target.r)];
      if (target.isGeneral) { targetPlayer.isEliminated = true; combatLog.generalKilled = true; combatLog.eliminatedPlayer = targetPlayer.name; this._checkVictory(); }
    }
    if (attacker.vitality <= 0) {
      combatLog.attackerKilled = true;
      attackerPlayer.units = attackerPlayer.units.filter(u => u.id !== attackerId);
      delete this.unitMap[hexKey(attacker.q, attacker.r)];
      if (attacker.isGeneral) { attackerPlayer.isEliminated = true; this._checkVictory(); }
    }

    // Cavalier Léger : peut se déplacer après une attaque (vitesse non vidée)
    if (attacker.vitality > 0 && attacker.typeId === 'cavalier_leger') {
      attacker.hasMoved = false;
    }

    return { ok: true, combatLog };
  }

  _getSegmentDef(q1, r1, q2, r2) {
    const edgeK = segmentEdgeKey(q1, r1, q2, r2);
    const segType = this.segmentData[edgeK];
    return segType ? (SEGMENTS[segType] || null) : null;
  }

  _resolveCombat(attacker, target, isCac, defenseChoice) {
    const type = isCac ? 'cac' : 'tir';
    const stA = attacker.isGeneral ? {} : this._getStanceMods(attacker);
    const stD = target.isGeneral ? {} : this._getStanceMods(target);
    const tA = this._getTerrainMods(attacker.q, attacker.r);
    const tD = this._getTerrainMods(target.q, target.r);
    const segDef = isCac ? this._getSegmentDef(attacker.q, attacker.r, target.q, target.r) : null;
    const hA = this.heightData[hexKey(attacker.q, attacker.r)] || 0;
    const hD = this.heightData[hexKey(target.q, target.r)] || 0;
    const heightDiff = hA - hD;

    // NGO = Nombre de Groupes d'Opposition
    const NGOAtt = Math.max(1, Math.floor(attacker.vitality / 5));
    const NGODef = Math.max(1, Math.floor(target.vitality / 5));

    // Attaque effective
    const attackBase = attacker.isGeneral ? attacker.force : attacker.attack;
    const attackEff = attackBase
      + (stA[`attack_${type}`] || 0) + (tA[`attack_${type}`] || 0) + (segDef ? (segDef[`attack_${type}`] || 0) : 0)
      - (stD[`esquive_${type}`] || 0) - (tD[`esquive_${type}`] || 0)
      + heightDiff;

    // Roll d'attaque
    let attReussite = 0;
    let generalD20 = null, generalAttValue = null;
    if (attacker.isGeneral) {
      generalD20 = Math.floor(Math.random() * 20) + 1;
      generalAttValue = attacker.force - generalD20 + 80;
    } else {
      for (let i = 0; i < NGOAtt; i++) {
        if (Math.floor(Math.random() * 20) + 1 <= attackEff) attReussite++;
      }
    }
    const hit = attacker.isGeneral ? true : attReussite > 0;

    // Ratio d'armure défenseur
    const phalangeBonus = (!isCac && target.typeId === 'phalange') ? 20 : 0;
    const lancierRangedBonus = (!isCac && target.typeId === 'lancier') ? 20 : 0;
    const effectiveArmorDef = Math.max(0, target.armor + (stD.armure || 0) + (tD.armure || 0) + phalangeBonus + lancierRangedBonus + (segDef ? (segDef[`defense_armure_${type}`] || 0) : 0));
    const ARDef = NGODef * effectiveArmorDef;
    const ratARDef = 1 - ARDef / (ARDef + 100);

    // Dégâts attaquant
    const lancierBonus = (attacker.typeId === 'lancier' && (target.category === 'Chevaux' || target.category === 'Chars')) ? 6 : 0;
    const effectivePowerAtt = Math.max(1, attacker.power + (stA[`puissance_${type}`] || 0) + (tA[`puissance_${type}`] || 0) + (segDef ? (segDef[`puissance_${type}`] || 0) : 0) + lancierBonus);
    let degatsUnitaire = effectivePowerAtt * ratARDef;
    let dmgReceived;
    if (attacker.isGeneral) {
      // Formule spéciale général : ((Force - D20 + 80) × Puissance / 5 × ratARDef) / 2
      dmgReceived = Math.round(generalAttValue * attacker.power / 5 * ratARDef / 2);
      degatsUnitaire = attacker.power / 5 * ratARDef / 2;
    } else {
      dmgReceived = Math.round(attReussite * degatsUnitaire);
    }

    // Moral damage
    const effectiveIntimidation = attacker.intimidation + (stA[`intimidation_${type}`] || 0) + (tA[`intimidation_${type}`] || 0) + (segDef ? (segDef[`intimidation_${type}`] || 0) : 0)
      - (stD[`courage_${type}`] || 0) - (tD[`courage_${type}`] || 0);
    let moralDmg;
    if (attacker.isGeneral) {
      // (Charisme - D20 + 80) * intimidation / 100 (même D20 que l'attaque)
      const charismeVal = attacker.charisma - generalD20 + 80;
      moralDmg = Math.round(charismeVal * effectiveIntimidation / 100);
    } else {
      moralDmg = attReussite * effectiveIntimidation;
    }

    // Defense choice — tir : seule la phalange peut absorber (sauf vs archers)
    if (!isCac) {
      const archerTypes = ['archer', 'archer_elite'];
      const phalangeCanAbsorb = target.typeId === 'phalange' && !archerTypes.includes(attacker.typeId);
      defenseChoice = (phalangeCanAbsorb && defenseChoice === 'absorb') ? 'absorb' : 'rien';
    }

    let defReussite = 0;
    let defenseSuccess = false;
    let counterDmgReceived = 0, counterMoralDmg = 0;

    let defBase = null, defEff = null, effectiveArmorAtt = null, ARAtt = null, ratARAtt = null, effectivePowerDef = null, counterIntimidation = null;
    let generalD20Def = null, generalAttValueDef = null;

    if (defenseChoice === 'counter' || defenseChoice === 'absorb') {
      const isAbsorb = defenseChoice === 'absorb';

      // Défense effective (utilisé pour unités normales + display)
      defBase = target.isGeneral ? target.force : target.defense;
      defEff = defBase
        + (stD[`defense_${type}`] || 0) + (tD[`defense_${type}`] || 0) + (segDef ? (segDef[`defense_${type}`] || 0) : 0)
        - (stA[`precision_${type}`] || 0) - (tA[`precision_${type}`] || 0)
        - heightDiff;

      // Ratio d'armure attaquant (même formule que pour les unités)
      effectiveArmorAtt = Math.max(0, attacker.armor + (stA.armure || 0) + (tA.armure || 0) + (segDef ? (segDef[`armure_${type}`] || 0) : 0));
      ARAtt = NGOAtt * effectiveArmorAtt;
      ratARAtt = 1 - ARAtt / (ARAtt + 100);

      counterIntimidation = target.intimidation + (stD[`intimidation_${type}`] || 0) + (tD[`intimidation_${type}`] || 0) + (segDef ? (segDef[`defense_intimidation_${type}`] || 0) : 0)
        - (stA[`courage_${type}`] || 0) - (tA[`courage_${type}`] || 0);
      const lancierBonusDef = (target.typeId === 'lancier' && (attacker.category === 'Chevaux' || attacker.category === 'Chars')) ? 6 : 0;
      effectivePowerDef = Math.max(1, target.power + (stD[`puissance_${type}`] || 0) + (tD[`puissance_${type}`] || 0) + (segDef ? (segDef[`defense_puissance_${type}`] || 0) : 0) + lancierBonusDef);

      if (target.isGeneral) {
        // Formule spéciale général : ((Force - D20 + 80) × Puissance / 5 × ratARAtt) / 2
        generalD20Def = Math.floor(Math.random() * 20) + 1;
        generalAttValueDef = target.force - generalD20Def + 80;
        defenseSuccess = true;
        const divisor = isAbsorb ? 4 : 2; // encaissement ÷2 supplémentaire
        counterDmgReceived = Math.round(generalAttValueDef * target.power / 5 * ratARAtt / divisor);
        // (Charisme - D20 + 80) * intimidation / 100
        const charValDef = target.charisma - generalD20Def + 80;
        const rawCounterMoral = Math.round(charValDef * counterIntimidation / 100);
        counterMoralDmg = isAbsorb ? Math.round(rawCounterMoral / 2) : rawCounterMoral;
      } else {
        // Def_reussite : NGODef jets D20
        for (let i = 0; i < NGODef; i++) {
          if (Math.floor(Math.random() * 20) + 1 <= defEff) defReussite++;
        }
        defenseSuccess = defReussite > 0;
        counterDmgReceived = Math.round(defReussite * effectivePowerDef * ratARAtt / (isAbsorb ? 2 : 1));
        counterMoralDmg = isAbsorb ? Math.round(defReussite * counterIntimidation / 2) : defReussite * counterIntimidation;
      }

      // Encaissement : dégâts attaquant ÷2
      if (isAbsorb) {
        dmgReceived = Math.ceil(dmgReceived / 2);
        moralDmg = Math.ceil(moralDmg / 2);
      }
    }

    const breakdown = {
      NGOAtt, NGODef,
      attackBase, attackEff, attReussite,
      generalD20, generalAttValue,
      generalD20Def, generalAttValueDef,
      // Attack modifiers (individual, for display)
      modAtkStance:   (stA[`attack_${type}`] || 0) + (segDef ? (segDef[`attack_${type}`] || 0) : 0),
      modAtkTerrain:  (tA[`attack_${type}`] || 0),
      modEsquive:    -((stD[`esquive_${type}`] || 0) + (tD[`esquive_${type}`] || 0)),
      modHauteur:     heightDiff,
      effectiveArmorDef, ARDef, baseArmorDef: target.armor,
      modArmorDefStance: (stD.armure || 0),
      phalangeBonus, lancierRangedBonus,
      modArmorDefTerrain: (tD.armure || 0),
      ratARDef: Math.round(ratARDef * 1000) / 1000,
      effectivePowerAtt, basePowerAtt: attacker.power, lancierBonus,
      modPwrAtt: (stA[`puissance_${type}`] || 0) + (tA[`puissance_${type}`] || 0) + (segDef ? (segDef[`puissance_${type}`] || 0) : 0),
      degatsUnitaire: Math.round(degatsUnitaire * 100) / 100,
      dmgReceived,
      defBase, defEff, defReussite: (defenseChoice === 'counter' || defenseChoice === 'absorb') ? defReussite : null,
      // Defense modifiers (counter + absorb)
      modDefStance:   (defenseChoice === 'counter' || defenseChoice === 'absorb') ? ((stD[`defense_${type}`] || 0) + (segDef ? (segDef[`defense_${type}`] || 0) : 0)) : null,
      modDefTerrain:  (defenseChoice === 'counter' || defenseChoice === 'absorb') ? (tD[`defense_${type}`] || 0) : null,
      modPrecision:   (defenseChoice === 'counter' || defenseChoice === 'absorb') ? -((stA[`precision_${type}`] || 0) + (tA[`precision_${type}`] || 0)) : null,
      modHauteurDef:  (defenseChoice === 'counter' || defenseChoice === 'absorb') ? -heightDiff : null,
      effectivePowerDef, basePowerDef: target.power,
      lancierBonusDef: (defenseChoice === 'counter' || defenseChoice === 'absorb') ? ((target.typeId === 'lancier' && (attacker.category === 'Chevaux' || attacker.category === 'Chars')) ? 6 : 0) : null,
      modPwrDef: (defenseChoice === 'counter' || defenseChoice === 'absorb') ? ((stD[`puissance_${type}`] || 0) + (tD[`puissance_${type}`] || 0) + (segDef ? (segDef[`defense_puissance_${type}`] || 0) : 0)) : null,
      effectiveArmorAtt, baseArmorAtt: attacker.armor,
      modArmorAttStance: (defenseChoice === 'counter' || defenseChoice === 'absorb') ? (stA.armure || 0) : null,
      modArmorAttTerrain: (defenseChoice === 'counter' || defenseChoice === 'absorb') ? (tA.armure || 0) : null,
      ARAtt,
      ratARAtt: ratARAtt !== null ? Math.round(ratARAtt * 1000) / 1000 : null,
      counterDmgReceived, counterMoralDmg,
      effectiveIntimidation,
      modIntimAtt: (stA[`intimidation_${type}`] || 0) + (tA[`intimidation_${type}`] || 0),
      modCourageDef: -((stD[`courage_${type}`] || 0) + (tD[`courage_${type}`] || 0)),
      counterIntimidation,
      modIntimDef: (defenseChoice === 'counter' || defenseChoice === 'absorb') ? ((stD[`intimidation_${type}`] || 0) + (tD[`intimidation_${type}`] || 0)) : null,
      modCourageAtt: (defenseChoice === 'counter' || defenseChoice === 'absorb') ? -((stA[`courage_${type}`] || 0) + (tA[`courage_${type}`] || 0)) : null,
      moralDmg,
      attackerCharisma: attacker.isGeneral ? attacker.charisma : null,
      defenderCharisma: target.isGeneral ? target.charisma : null,
      defenseChoice,
      attackerStance: attacker.stance,
      defenderStance: target.stance,
      attackerTerrain: this.terrainData[hexKey(attacker.q, attacker.r)] || 'plaines',
      defenderTerrain: this.terrainData[hexKey(target.q, target.r)] || 'plaines',
      segment: segDef ? segDef.name : null,
    };

    return { hit, dmgReceived, moralDmg, defenseSuccess, counterDmgReceived, counterMoralDmg, breakdown };
  }

  useGeneralAbility(playerId, targetHex, targetId) {
    const player = this.getPlayer(playerId);
    const general = GENERALS.find(g => g.id === player.generalId);
    const generalUnit = player.units.find(u => u.isGeneral);

    if (!general) return { error: 'Général introuvable.' };
    if (!generalUnit) return { error: 'Unité général introuvable.' };
    if (!general.activeAbility) return { error: 'Ce général n\'a pas de capacité active.' };
    if (generalUnit.hasUsedAbility) return { error: 'Capacité déjà utilisée ce tour.' };
    if (generalUnit.abilityCooldown > 0) return { error: `Capacité en recharge (${generalUnit.abilityCooldown} tours restants).` };

    const combatLog = { abilityUsed: general.activeAbility.name, effects: [] };

    switch (general.id) {
      case 'ou_ki': {
        // +2 power for all allied units for 2 turns
        this.activeEffects.push({ type: 'power_boost', targetPlayerId: playerId, turnsLeft: 2, value: 2 });
        combatLog.effects.push('Puissance +2 pendant 2 tours');
        // If enemy has fewer units, reduce their morale by 1
        const myCount = player.units.length;
        for (const p of this.players) {
          if (p.id === playerId || p.isEliminated) continue;
          if (p.units.length < myCount) {
            for (const u of p.units) u.morale = Math.max(0, u.morale - 1);
            combatLog.effects.push(`Moral de ${p.name} réduit de 1`);
          }
        }
        break;
      }
      case 'mou_bu': {
        // -1 armor to target enemy army for 2 turns
        if (!targetId) return { error: 'Choisissez une armée cible.' };
        this.activeEffects.push({ type: 'armor_reduction', targetPlayerId: targetId, turnsLeft: 2, value: 1 });
        combatLog.effects.push('Armure ennemie -1 pendant 2 tours');
        break;
      }
      case 'ri_boku': {
        // Reveal a hidden unit
        combatLog.effects.push('Vision du Sage activée');
        break;
      }
      default:
        combatLog.effects.push(`${general.activeAbility.name} activée`);
    }

    generalUnit.hasUsedAbility = true;
    generalUnit.abilityCooldown = general.activeAbility.cooldown;

    return { ok: true, combatLog };
  }

  _checkVictory() {
    const alivePlayers = this.players.filter(p => !p.isEliminated);
    if (alivePlayers.length <= 1) {
      this.winner = alivePlayers.length === 1 ? alivePlayers[0].id : null;
      this.phase = 'ended';
    }
  }

  endTurn() {
    const currentPlayer = this.getPlayer(this.getCurrentPlayerId());
    if (currentPlayer) {
      for (const u of currentPlayer.units) {
        u.hasMoved = false;
        u.hasAttacked = false;
        if (u.isGeneral) {
          u.hasUsedAbility = false;
          if (u.abilityCooldown > 0) u.abilityCooldown--;
        }
      }
    }

    this.currentTurnIndex++;
    this.manche++;

    const newRound = this.currentTurnIndex >= this.turnOrder.length;
    if (newRound) {
      this.turn++;
      this.manche = 1;
      this.activeEffects = this.activeEffects
        .map(e => ({ ...e, turnsLeft: e.turnsLeft - 1 }))
        .filter(e => e.turnsLeft > 0);
      this._applyPassives();
      this._rollInitiative();
    }

    // Init speed for new current player's units + apply regen + process fleeing
    const nextPlayer = this.getPlayer(this.getCurrentPlayerId());
    let fled = [];
    if (nextPlayer) {
      const nextGeneral = nextPlayer.units.find(u => u.isGeneral && u.q !== null);
      const nextGeneralData = GENERALS.find(g => g.id === nextPlayer.generalId);
      for (const u of nextPlayer.units) {
        this._applyTurnRegen(u);
        this._initUnitSpeedForTurn(u);
        // Piétaille : +10 moral si dans le rayon de Charisme du général
        if (u.typeId === 'pietaille' && nextGeneral && u.q !== null) {
          const charisma = nextGeneralData ? nextGeneralData.charisma : 10;
          const range = Math.floor(charisma / 5);
          if (hexDistance(nextGeneral.q, nextGeneral.r, u.q, u.r) <= range) {
            u.morale = Math.min(u.maxMorale, u.morale + 10);
          }
        }
      }
      fled = this._processFleeing(nextPlayer.id);
    }

    return { newRound, fled };
  }

  buildSegment(playerId, unitId, neighborQ, neighborR) {
    const player = this.getPlayer(playerId);
    const unit = player?.units.find(u => u.id === unitId);
    if (!unit) return { error: 'Unité introuvable.' };
    if (unit.typeId !== 'batisseurs') return { error: 'Seuls les Bâtisseurs peuvent construire.' };
    if (unit.hasAttacked) return { error: 'Cette unité a déjà agi ce tour.' };
    if (hexDistance(unit.q, unit.r, neighborQ, neighborR) !== 1) return { error: 'Case non adjacente.' };

    const edgeK = segmentEdgeKey(unit.q, unit.r, neighborQ, neighborR);
    const existing = this.segmentData[edgeK];

    let segType;
    if (existing === 'cliff') {
      segType = 'echelle';
    } else if (!existing) {
      segType = 'chevaux_de_frise';
    } else {
      return { error: 'Ce segment ne peut pas être construit ici.' };
    }

    this.segmentData[edgeK] = segType;
    unit.speedRemaining = Math.max(0, unit.speedRemaining - 2);
    return { ok: true, segType, edgeK };
  }

  _applyPassives() {
    for (const p of this.players) {
      if (p.isEliminated) continue;
      const general = GENERALS.find(g => g.id === p.generalId);
      if (!general) continue;

      if (general.id === 'ou_ki') {
        // Enemy generals -3 in stats (handled during combat resolution via game state)
        // Piétaille passive: +1 intimid (applied on unit creation)
      }
      if (general.id === 'mou_bu') {
        // +1 power for all units of Mou Bu (handled in combat)
      }
    }
  }
}

module.exports = GameRoom;
