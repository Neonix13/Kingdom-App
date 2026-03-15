const GENERALS = require('./data/generals');
const UNITS = require('./data/units');
const { hexDistance, hexKey, hexesInRange, generateHexMap, findPath, getStartingZones } = require('./HexUtils');

const MAP_RADIUS = 30;

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
      morale: 20,
      maxMorale: 20,
      attack: generalData.force,
      power: generalData.weapon.damage,
      defense: generalData.force,
      armor: generalData.armor,
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
      intimidation: data.intimidation,
      speed: data.speed,
      range: data.range,
      visionRange: 1, // vision de base (1 case autour)
      hasMoved: false,
      hasAttacked: false,
      q: null,
      r: null,
      buffs: [],
      category: data.category,
      bonus: data.bonus || null,
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
    const rRiver = Math.round(21 - 0.43 * q);
    let inZone = false;
    if (zone.type === 'river_north') {
      inZone = r >= rRiver - zone.radius && r <= rRiver - 1;
    } else if (zone.type === 'river_south') {
      inZone = r >= rRiver + 1 && r <= rRiver + zone.radius;
    } else {
      inZone = hexDistance(q, r, zone.q, zone.r) <= zone.radius;
    }
    if (!inZone) return { error: 'Hors de la zone de déploiement.' };

    const key = hexKey(q, r);
    if (!this.hexMap[key]) return { error: 'Case invalide.' };

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
      const range = Math.max(1, unit.visionRange); // minimum 1 case de vision pour toutes les unités
      const hexes = hexesInRange(unit.q, unit.r, range);
      for (const [hq, hr] of hexes) {
        const key = hexKey(hq, hr);
        if (this.hexMap[key]) visible.add(key);
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
    if (unit.hasMoved) return { error: 'Cette unité a déjà bougé ce tour.' };

    const path = findPath(this.hexMap, this.unitMap, unit.q, unit.r, targetQ, targetR, unit.speed, playerId);
    if (path === null) return { error: 'Chemin inaccessible.' };

    // Move unit
    delete this.unitMap[hexKey(unit.q, unit.r)];
    unit.q = targetQ;
    unit.r = targetR;
    unit.hasMoved = true;
    this.unitMap[hexKey(targetQ, targetR)] = unit;

    return { ok: true };
  }

  attackUnit(playerId, attackerId, targetId) {
    const player = this.getPlayer(playerId);
    const attacker = player.units.find(u => u.id === attackerId);
    if (!attacker) return { error: 'Unité attaquante introuvable.' };
    if (attacker.hasAttacked) return { error: 'Cette unité a déjà attaqué ce tour.' };

    // Find target
    let targetPlayer = null;
    let target = null;
    for (const p of this.players) {
      if (p.id === playerId) continue;
      const u = p.units.find(u => u.id === targetId);
      if (u) { targetPlayer = p; target = u; break; }
    }
    if (!target) return { error: 'Cible introuvable.' };

    // Check range
    const dist = hexDistance(attacker.q, attacker.r, target.q, target.r);
    if (dist > attacker.range) return { error: `Cible hors de portée (distance: ${dist}, portée: ${attacker.range}).` };

    // Combat resolution
    const result = this._resolveCombat(attacker, target, dist, playerId, targetPlayer.id);

    attacker.hasAttacked = true;

    // Apply damage
    target.vitality -= result.damage;
    const combatLog = {
      attackerName: attacker.name,
      targetName: target.name,
      attackerRoll: result.attackRoll,
      defenseRoll: result.defenseRoll,
      hit: result.hit,
      damage: result.damage,
      targetVitalityLeft: target.vitality,
    };

    // Kei Sha passive: attacker loses 1 vitality on defense (ignoring armor)
    const targetGen = GENERALS.find(g => g.id === targetPlayer.generalId);
    if (targetGen && targetGen.id === 'kei_sha') {
      attacker.vitality -= 1;
      combatLog.keiShaEffect = true;
    }

    // Soldats bonus: destroy if <= 3 vitality
    const attackerGen = GENERALS.find(g => g.id === player.generalId);
    if (attacker.typeId === 'soldats' && target.vitality <= 3 && target.vitality > 0) {
      target.vitality = 0;
      combatLog.executeKill = true;
    }

    // Remove dead units
    if (target.vitality <= 0) {
      combatLog.targetKilled = true;
      targetPlayer.units = targetPlayer.units.filter(u => u.id !== targetId);
      delete this.unitMap[hexKey(target.q, target.r)];

      // Shi Ba Shou passive: allies in 400m regain 1 vitality when unit dies
      if (targetGen && targetGen.id === 'shi_ba_shou') {
        for (const u of targetPlayer.units) {
          if (u.q !== null && hexDistance(u.q, u.r, target.q, target.r) <= 4) {
            u.vitality = Math.min(u.vitality + 1, u.maxVitality);
          }
        }
      }

      // Check if general was killed
      if (target.isGeneral) {
        targetPlayer.isEliminated = true;
        combatLog.generalKilled = true;
        combatLog.eliminatedPlayer = targetPlayer.name;
        this._checkVictory();
      }
    }

    if (attacker.vitality <= 0) {
      combatLog.attackerKilled = true;
      player.units = player.units.filter(u => u.id !== attackerId);
      delete this.unitMap[hexKey(attacker.q, attacker.r)];
      if (attacker.isGeneral) {
        player.isEliminated = true;
        this._checkVictory();
      }
    }

    return { ok: true, combatLog };
  }

  _resolveCombat(attacker, target, distance, attackerPlayerId, targetPlayerId) {
    // Ranged units: no defense roll for target
    const isRanged = attacker.range > 1;
    const attackRoll = Math.floor(Math.random() * 20) + 1 + attacker.attack;
    const defenseRoll = isRanged ? 0 : Math.floor(Math.random() * 20) + 1 + target.defense;

    // Apply active effects
    let effectivePower = attacker.power;
    let effectiveArmor = target.armor;
    for (const e of this.activeEffects) {
      if (e.type === 'power_boost' && e.targetPlayerId === attackerPlayerId) effectivePower += e.value;
      if (e.type === 'armor_reduction' && e.targetPlayerId === targetPlayerId) effectiveArmor = Math.max(0, effectiveArmor - e.value);
    }

    const hit = isRanged || attackRoll > defenseRoll;
    const damage = hit ? Math.max(1, effectivePower - effectiveArmor) : 0;

    return { attackRoll, defenseRoll, hit, damage };
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
    // Reset flags for current player
    const player = this.getPlayer(this.getCurrentPlayerId());
    if (player) {
      for (const u of player.units) {
        u.hasMoved = false;
        u.hasAttacked = false;
        if (u.isGeneral) {
          u.hasUsedAbility = false;
          if (u.abilityCooldown > 0) u.abilityCooldown--;
        }
      }
    }

    this.currentTurnIndex++;

    // Nouveau round quand tous les joueurs actifs ont joué
    const newRound = this.currentTurnIndex >= this.turnOrder.length;
    if (newRound) {
      this.turn++;
      this.activeEffects = this.activeEffects
        .map(e => ({ ...e, turnsLeft: e.turnsLeft - 1 }))
        .filter(e => e.turnsLeft > 0);
      this._applyPassives();
      this._rollInitiative();
    }

    return { newRound };
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
