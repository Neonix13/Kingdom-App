const GENERALS = require('./data/generals');
const UNITS = require('./data/units');
const { hexDistance, hexKey, hexesInRange, generateHexMap, findPath, getStartingZones, segmentEdgeKey } = require('./HexUtils');
const STANCES = require('./data/stances');
const TERRAINS = require('./data/terrains');
const SEGMENTS = require('./data/segments');
const fs = require('fs');
const nodePath = require('path');

const MAP_RADIUS = 70;

let unitCounter = 0;
function newUnitId() { return `u_${++unitCounter}`; }

class GameRoom {
  constructor(roomCode, hostId) {
    this.roomCode = roomCode;
    this.hostId = hostId;
    this.players = [];
    this.phase = 'lobby'; // lobby | army_building | deployment | battle | ended
    this.budget = 1000;
    this.hexMap = {};
    this.unitMap = {}; // hexKey -> unit
    this.turn = 1;
    this.turnOrder = [];       // IDs des joueurs dans l'ordre d'initiative
    this.initiativeRolls = {}; // playerId -> { d20, strategy, total, playerName, generalName }
    this.currentTurnIndex = 0;
    this.winner = null;
    this.abilityCooldowns = {}; // playerId -> turnsRemaining
    this.activeEffects = []; // { type, targetPlayerId, turnsLeft, value }
    this.pendingAttacks = {}; // attackId -> pending attack data
    let terrainRaw = {};
    try { terrainRaw = JSON.parse(fs.readFileSync(nodePath.join(__dirname, '../public/terrain.json'), 'utf8')); } catch(e) {}
    this.terrainData = terrainRaw;
    let segmentRaw = {};
    try { segmentRaw = JSON.parse(fs.readFileSync(nodePath.join(__dirname, '../public/segments.json'), 'utf8')); } catch(e) {}
    this.segmentData = segmentRaw;
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
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        generalId: p.generalId,
        isReady: p.isReady,
        isEliminated: p.isEliminated,
        color: p.color || '#4a90d9',
      })),
      takenGenerals: this.players.filter(p => p.generalId).map(p => p.generalId),
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
      id: newUnitId(),
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
      power: generalData.weapon.damage,
      armor: generalData.armor,
      maxArmor: generalData.armor,
      intimidation: 5,
      speed: 3,
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
      stance: 'marche',
      speedRemaining: 0,
      isFleeing: false,
    };

    player.units = [generalUnit, ...units];
    player.generalUnit = generalUnit;
    player.isReady = true;

    return { ok: true };
  }

  _createUnit(typeId, playerId) {
    const data = UNITS[typeId];
    return {
      id: newUnitId(),
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
      visionRange: 2,
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
    };
  }

  allArmiesSubmitted() {
    return this.players.every(p => p.isReady);
  }

  startDeployment() {
    this.phase = 'deployment';
    const zones = getStartingZones(this.players.length, MAP_RADIUS);
    this.players.forEach((p, i) => {
      p.startingZone = zones[i];
      p.isReady = false;
    });
  }

  getDeploymentState(playerId) {
    const player = this.getPlayer(playerId);
    const general = GENERALS.find(g => g.id === player.generalId);
    return {
      phase: 'deployment',
      budget: this.budget,
      hexMap: this.hexMap,
      startingZone: player.startingZone,
      units: player.units,
      placedUnits: player.placedUnits,
      generalData: general,
      occupiedHexes: this._getAllOccupiedHexes(),
    };
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
    const inZone = hexDistance(q, r, zone.q, zone.r) <= zone.radius;
    if (!inZone) return { error: 'Hors de la zone de déploiement.' };

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
    return { ok: true };
  }

  setDeploymentReady(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Joueur introuvable.' };

    // Check general is placed
    if (!player.generalUnit || player.generalUnit.q === null) {
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
    const visible = new Set();

    for (const unit of player.units) {
      if (unit.q === null) continue;
      const unitTerrain = this.terrainData[hexKey(unit.q, unit.r)] || 'plain';
      const inForest = unitTerrain === 'forest';
      // En forêt : vision réduite à 1. Hors forêt : vision normale mais forêts visibles max à 2
      const range = inForest ? 1 : Math.max(2, unit.visionRange);
      const hexes = hexesInRange(unit.q, unit.r, range);
      for (const [hq, hr] of hexes) {
        const key = hexKey(hq, hr);
        if (!this.hexMap[key]) continue;
        // Hors forêt : les cases forêt ne sont visibles qu'à rayon ≤ 2
        if (!inForest && this.terrainData[key] === 'forest') {
          if (hexDistance(unit.q, unit.r, hq, hr) > 2) continue;
        }
        visible.add(key);
      }
    }
    return visible;
  }

  getGameState(playerId) {
    const player = this.getPlayer(playerId);
    const visibleHexes = this.getVisibleHexes(playerId);
    const general = GENERALS.find(g => g.id === player.generalId);

    // Build visible units list
    const visibleUnits = [];
    for (const p of this.players) {
      for (const u of p.units) {
        if (u.q === null) continue;
        const key = hexKey(u.q, u.r);
        if (p.id === playerId || visibleHexes.has(key)) {
          visibleUnits.push({
            ...u,
            isMine: p.id === playerId,
          });
        }
      }
    }

    return {
      phase: this.phase,
      turn: this.turn,
      currentPlayerId: this.getCurrentPlayerId(),
      myId: playerId,
      budget: this.budget,
      generalData: general,
      visibleHexes: Array.from(visibleHexes),
      units: visibleUnits,
      myUnits: player.units,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        generalId: p.generalId,
        isEliminated: p.isEliminated,
        unitCount: p.units.length,
        color: p.color || '#4a90d9',
      })),
      turnOrder: this.turnOrder,
      initiativeRolls: this.initiativeRolls,
      activeEffects: this.activeEffects.filter(e => e.targetPlayerId === playerId),
      winner: this.winner,
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
        if (segDef.vitesse_tout) { vitesseTout = true; break; }
        stepCost += Math.max(0, -(segDef.vitesse || 0));
      }
      moveCost += stepCost;
    }
    if (vitesseTout) moveCost = unit.speedRemaining;
    unit.speedRemaining = Math.max(0, unit.speedRemaining - moveCost);
    this.unitMap[hexKey(targetQ, targetR)] = unit;

    return { ok: true, unitId: unit.id, fromQ, fromR, path };
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
    const stance = this._getStanceMods(unit);
    const terrain = this._getTerrainMods(unit.q, unit.r);
    unit.speedRemaining = Math.max(0, unit.speed + stance.vitesse + terrain.vitesse);
  }

  _applyTurnRegen(unit) {
    if (unit.q === null) return;
    const stance = this._getStanceMods(unit);
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

  changeStance(playerId, unitId, stanceId) {
    if (!STANCES[stanceId]) return { error: 'Posture invalide.' };
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Joueur introuvable.' };
    const unit = player.units.find(u => u.id === unitId);
    if (!unit) return { error: 'Unité introuvable.' };
    if (unit.isFleeing) return { error: 'Unité en fuite.' };
    if (unit.stance === stanceId) return { error: 'Déjà dans cette posture.' };
    unit.speedRemaining = Math.max(0, unit.speedRemaining - 2);
    unit.stance = stanceId;
    return { ok: true };
  }

  motivateUnit(playerId, generalId, targetId) {
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Joueur introuvable.' };
    const general = player.units.find(u => u.id === generalId && u.isGeneral);
    if (!general) return { error: 'Général introuvable.' };
    if (general.hasAttacked) return { error: 'Le général a déjà agi ce tour.' };

    const target = player.units.find(u => u.id === targetId);
    if (!target) return { error: 'Unité amie introuvable.' };
    if (target.isGeneral) return { error: 'Ne peut pas motiver un général.' };

    const dist = hexDistance(general.q, general.r, target.q, target.r);
    if (dist > 2) return { error: 'Unité hors de portée (max 2 cases).' };

    // Jet de Charisme vs D20
    const generalData = GENERALS.find(g => g.id === general.generalId);
    const charisma = generalData ? generalData.charisma : 10;
    const d20 = Math.floor(Math.random() * 20) + 1;
    const success = charisma >= d20;

    if (success) {
      const moralGain = general.intimidation || 5;
      target.morale = Math.min(target.maxMorale, target.morale + moralGain);
      if (target.isFleeing && target.morale > 0) target.isFleeing = false;
    }

    // Coût : toute la vitesse restante min 1
    const speedCost = Math.max(1, general.speedRemaining);
    general.speedRemaining = Math.max(0, general.speedRemaining - speedCost);
    general.hasAttacked = true;

    return { ok: true, success, charisma, d20, moralGain: success ? (general.intimidation || 5) : 0, targetName: target.name };
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
    if (dist > attacker.range) return { error: `Cible hors de portée (distance: ${dist}, portée: ${attacker.range}).` };

    // Deduct speed (all remaining, min 1)
    const speedCost = Math.max(1, attacker.speedRemaining);
    attacker.speedRemaining = Math.max(0, attacker.speedRemaining - speedCost);
    attacker.hasAttacked = true;

    const attackId = `atk_${Date.now()}_${Math.random()}`;
    this.pendingAttacks[attackId] = { attackerPlayerId: playerId, attackerId, targetPlayerId: targetPlayer.id, targetId, dist };

    return { pending: true, attackId, targetPlayerId: targetPlayer.id, attackerName: attacker.name, targetName: target.name, targetQ: target.q, targetR: target.r };
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
    const result = this._resolveCombat(attacker, target, isCac, defenseChoice);

    // Apply to target
    target.vitality = Math.max(0, target.vitality - result.dmgReceived);
    target.armor = Math.max(0, target.armor - 1);
    if (!target.isGeneral) {
      target.morale = Math.max(0, target.morale - result.moralDmg);
      if (target.morale <= 0 && !target.isFleeing) { target.stance = 'marche'; target.isFleeing = true; }
    }

    // Apply to attacker (counter-attack)
    if (result.counterDmgReceived > 0) {
      attacker.vitality = Math.max(0, attacker.vitality - result.counterDmgReceived);
      attacker.armor = Math.max(0, attacker.armor - 1);
    }
    if (result.counterMoralDmg > 0 && !attacker.isGeneral) {
      attacker.morale = Math.max(0, attacker.morale - result.counterMoralDmg);
      if (attacker.morale <= 0 && !attacker.isFleeing) { attacker.stance = 'marche'; attacker.isFleeing = true; }
    }

    const combatLog = {
      attackerName: attacker.name, targetName: target.name,
      defenseChoice,
      attackTotal: result.attackTotal, attackD20: result.attackD20, hit: result.hit,
      dmgInflicted: result.dmgInflicted, armorAbsorb: result.armorAbsorb, dmgReceived: result.dmgReceived,
      moralDmg: result.moralDmg,
      defenseRoll: result.defenseRoll, defenseSuccess: result.defenseSuccess,
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

    return { ok: true, combatLog };
  }

  _getSegmentDef(q1, r1, q2, r2) {
    const edgeK = segmentEdgeKey(q1, r1, q2, r2);
    const segType = this.segmentData[edgeK];
    return segType ? (SEGMENTS[segType] || null) : null;
  }

  _resolveCombat(attacker, target, isCac, defenseChoice) {
    const type = isCac ? 'cac' : 'tir';
    const stA = this._getStanceMods(attacker);
    const stD = this._getStanceMods(target);
    const tA = this._getTerrainMods(attacker.q, attacker.r);
    const tD = this._getTerrainMods(target.q, target.r);
    // Segment on the edge between attacker and target (only for adjacent melee)
    const segDef = isCac ? this._getSegmentDef(attacker.q, attacker.r, target.q, target.r) : null;

    // Attack effective (généraux utilisent force comme base d'attaque)
    const attackBase = attacker.isGeneral ? attacker.force : attacker.attack;
    const attackTotal = attackBase
      + (stA[`attack_${type}`] || 0) + (tA[`attack_${type}`] || 0) + (segDef ? (segDef[`attack_${type}`] || 0) : 0)
      - (stD[`esquive_${type}`] || 0) - (tD[`esquive_${type}`] || 0);
    const attackD20 = Math.floor(Math.random() * 20) + 1;
    const hit = attackTotal >= attackD20;

    // Damage inflicted: N dé X where N=attacker.vitality, X=effective power
    let dmgInflicted = 0;
    if (hit) {
      const dieFaces = Math.max(1, attacker.power + (stA[`puissance_${type}`] || 0) + (tA[`puissance_${type}`] || 0) + (segDef ? (segDef[`puissance_${type}`] || 0) : 0));
      for (let i = 0; i < attacker.vitality; i++) {
        dmgInflicted += Math.floor(Math.random() * dieFaces) + 1;
      }
    }

    // Armor absorption: Vitalite_def × Armure_def_effective
    const effectiveArmor = Math.max(0, target.armor + (stD.armure || 0) + (tD.armure || 0));
    const armorAbsorb = target.vitality * effectiveArmor;
    let dmgReceived = Math.max(0, Math.floor((dmgInflicted - armorAbsorb) / 10));

    // Intimidation → moral damage
    let moralDmg = Math.max(0,
      attacker.intimidation + (stA[`intimidation_${type}`] || 0) + (tA[`intimidation_${type}`] || 0)
    );

    // Defense choice
    let defenseRoll = null, defenseSuccess = false;
    let counterDmgReceived = 0, counterMoralDmg = 0;

    if (defenseChoice === 'counter' || defenseChoice === 'absorb') {
      // Généraux utilisent force comme base de défense
      const defBase = target.isGeneral ? target.force : target.defense;
      const defTotal = defBase
        + (stD[`defense_${type}`] || 0) + (tD[`defense_${type}`] || 0) + (segDef ? (segDef[`defense_${type}`] || 0) : 0)
        - (stA[`precision_${type}`] || 0) - (tA[`precision_${type}`] || 0);
      defenseRoll = Math.floor(Math.random() * 20) + 1;
      defenseSuccess = defTotal >= defenseRoll;

      if (defenseSuccess) {
        const counterDieFaces = Math.max(1, target.power + (stD[`puissance_${type}`] || 0) + (tD[`puissance_${type}`] || 0) + (segDef ? (segDef[`puissance_${type}`] || 0) : 0));
        let counterRaw = 0;
        for (let i = 0; i < target.vitality; i++) {
          counterRaw += Math.floor(Math.random() * counterDieFaces) + 1;
        }
        const atkArmor = Math.max(0, attacker.armor + (stA.armure || 0) + (tA.armure || 0));
        const atkArmorAbsorb = attacker.vitality * atkArmor;
        const rawCounter = Math.max(0, counterRaw - atkArmorAbsorb);
        const rawMoral = Math.max(0, target.intimidation + (stD[`intimidation_${type}`] || 0) + (tD[`intimidation_${type}`] || 0));

        if (defenseChoice === 'absorb') {
          dmgReceived = Math.ceil(dmgReceived / 2);
          moralDmg = Math.ceil(moralDmg / 2);
          counterDmgReceived = Math.ceil(rawCounter / 2);
          counterMoralDmg = Math.ceil(rawMoral / 2);
        } else {
          counterDmgReceived = rawCounter;
          counterMoralDmg = rawMoral;
        }
      }
    }

    // Breakdown details for history
    const breakdown = {
      attackBase,
      stA_attack: stA[`attack_${type}`] || 0,
      tA_attack:  tA[`attack_${type}`] || 0,
      stD_esquive: stD[`esquive_${type}`] || 0,
      tD_esquive:  tD[`esquive_${type}`] || 0,
      attackTotal,
      attackD20,
      hit,
      dieFaces: Math.max(1, attacker.power + (stA[`puissance_${type}`] || 0) + (tA[`puissance_${type}`] || 0) + (segDef ? (segDef[`puissance_${type}`] || 0) : 0)),
      diceCount: attacker.vitality,
      dmgInflicted,
      armorAbsorb,
      effectiveArmor,
      dmgReceived,
      moralDmg,
      defenseChoice,
      defBase: (defenseChoice === 'counter' || defenseChoice === 'absorb') ? (target.isGeneral ? target.force : target.defense) : null,
      stD_defense: (stD[`defense_${type}`] || 0),
      tD_defense:  (tD[`defense_${type}`] || 0),
      stA_precision: (stA[`precision_${type}`] || 0),
      tA_precision:  (tA[`precision_${type}`] || 0),
      defTotal: (defenseChoice === 'counter' || defenseChoice === 'absorb')
        ? (target.isGeneral ? target.force : target.defense) + (stD[`defense_${type}`] || 0) + (tD[`defense_${type}`] || 0) + (segDef ? (segDef[`defense_${type}`] || 0) : 0) - (stA[`precision_${type}`] || 0) - (tA[`precision_${type}`] || 0)
        : null,
      defenseRoll,
      defenseSuccess,
      counterDmgReceived,
      counterMoralDmg,
      attackerStance: attacker.stance,
      defenderStance: target.stance,
      attackerTerrain: this.terrainData[hexKey(attacker.q, attacker.r)] || 'plaines',
      defenderTerrain: this.terrainData[hexKey(target.q, target.r)] || 'plaines',
      segment: segDef ? segDef.name : null,
      seg_attack: segDef ? (segDef[`attack_${type}`] || 0) : 0,
      seg_defense: segDef ? (segDef[`defense_${type}`] || 0) : 0,
      seg_puissance: segDef ? (segDef[`puissance_${type}`] || 0) : 0,
    };
    return { attackTotal, attackD20, hit, dmgInflicted, armorAbsorb, dmgReceived, moralDmg, defenseRoll, defenseSuccess, counterDmgReceived, counterMoralDmg, breakdown };
  }

  useGeneralAbility(playerId, targetHex, targetId) {
    const player = this.getPlayer(playerId);
    const general = GENERALS.find(g => g.id === player.generalId);
    const generalUnit = player.generalUnit;

    if (!general) return { error: 'Général introuvable.' };
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

    const newRound = this.currentTurnIndex >= this.turnOrder.length;
    if (newRound) {
      this.turn++;
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
      for (const u of nextPlayer.units) {
        this._applyTurnRegen(u);
        this._initUnitSpeedForTurn(u);
      }
      fled = this._processFleeing(nextPlayer.id);
    }

    return { newRound, fled };
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
