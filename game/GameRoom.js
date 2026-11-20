const GENERALS = require('./data/generals');
const UNITS = require('./data/units');
const { hexDistance, hexKey, buildHexMap, findPathCost, getStartingZones, segmentEdgeKey, SEGMENT_DEFS, hexFacing, hexFacingRanged } = require('./HexUtils');
const TERRAINS = require('./data/terrains');
const SEGMENTS = require('./data/segments');
const maps = require('./maps');
const { getTurnController } = require('./turns');
const rules = require('./rules');
const replay = require('./replay');

const { RULES } = rules;

const MAP_RADIUS = 70;
// Derived from the map or rebuilt on load: never serialized
const TRANSIENT = new Set(['map', 'hexMap', 'unitMap', 'terrainData', 'segmentData', 'heightData', 'mapCenter', '_events', '_moveTable', '_rng']);

const clone = (o) => JSON.parse(JSON.stringify(o));

function generalAbility(generalData) {
  if (!generalData) return null;
  return generalData.activeAbility || rules.ABILITIES[generalData.id] || null;
}

function newUnitId(room) {
  room._unitCounter = (room._unitCounter || 0) + 1;
  return `u_${room._unitCounter}`;
}

class GameRoom {
  constructor(roomCode, hostId, options = {}) {
    this.roomCode = roomCode;
    this.hostId = hostId;
    this.players = [];
    this.spectators = [];
    this.phase = 'lobby'; // lobby | army_building | deployment | battle | ended
    this.budget = 2500;
    this.mapId = options.mapId || 'default';
    this.mode = options.mode || 'sequential';
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
    this.settings = rules.defaultSettings();
    this.objectives = [];
    this.scores = {};
    this.stats = null;
    this.endReason = null;
    this.recordReplay = !!options.record;
    this.replay = null;
    this.spectatorSnapshots = [];
    this.balance = null; // terrain / segment / stance tables frozen at battle start (balance edits do not change running games)
    this._events = [];
    this._loadMap();
  }

  _terrains() { return this.balance ? this.balance.terrains : TERRAINS; }
  _segments() { return this.balance ? this.balance.segments : SEGMENTS; }

  moveTable() {
    if (!this.balance) return rules.MOVE_TABLE;
    if (!this._moveTable) this._moveTable = rules.movementTable(this.balance.segments);
    return this._moveTable;
  }

  // Dice: Math.random, or the seeded generator installed while a simultaneous turn resolves (deterministic replays)
  _random() { return this._rng ? this._rng() : Math.random(); }

  // Events produced by the rules (captures, ambushes, nightfall...) for the protocol to broadcast
  emitEvent(e) { this._events.push(e); }
  drainEvents() { const out = this._events; this._events = []; return out; }

  // ---- time of day ----
  timeOfDay(turn = this.turn) { return rules.timeOfDay(turn, this.settings.turnsPerHalfDay); }
  isNight(turn = this.turn) { return rules.isNightHour(this.timeOfDay(turn)); }
  dayNumber(turn = this.turn) { return rules.dayNumber(turn, this.settings.turnsPerHalfDay); }
  timeState() { return { timeOfDay: this.timeOfDay(), isNight: this.isNight(), day: this.dayNumber(), hoursPerTurn: rules.hoursPerTurn(this.settings.turnsPerHalfDay) }; }

  setSettings(patch) {
    if (this.phase !== 'lobby') return { error: 'Les paramètres ne peuvent être changés qu\'avant le début de la partie.' };
    const { settings, error } = rules.mergeSettings(this.settings, patch);
    if (error) return { error: `Paramètre invalide : ${error}.` };
    this.settings = settings;
    return { ok: true };
  }

  get turns() {
    return getTurnController(this.mode);
  }

  _loadMap() {
    let map;
    try { map = maps.getMap(this.mapId); } catch (e) { this.mapId = 'default'; map = maps.getMap('default'); }
    this.map = map;
    this.terrainData = maps.terrainLookup(map);
    this.segmentData = map.segments || {};
    this.heightData = map.height || {};
    this.hexMap = buildHexMap(map);
    this._applyMapEdits();
    const keys = Object.keys(this.hexMap);
    let sq = 0, sr = 0;
    for (const k of keys) { sq += this.hexMap[k].q; sr += this.hexMap[k].r; }
    this.mapCenter = keys.length ? { q: Math.round(sq / keys.length), r: Math.round(sr / keys.length) } : { q: 0, r: 0 };
  }

  // Map changes made during the battle (espions, bâtisseurs), persisted and re-applied over the shared map
  _applyMapEdits() {
    const ed = this.mapEdits;
    if (!ed || (!Object.keys(ed.seg || {}).length && !Object.keys(ed.ter || {}).length)) return;
    this.segmentData = { ...this.segmentData };
    this.terrainData = { ...this.terrainData };
    for (const [k, t] of Object.entries(ed.seg || {})) {
      if (t) this.segmentData[k] = t; else delete this.segmentData[k];
    }
    for (const [k, t] of Object.entries(ed.ter || {})) {
      this.terrainData[k] = t;
      if (this.hexMap[k]) this.hexMap[k] = { ...this.hexMap[k], terrain: t };
    }
  }

  _editMap(kind, key, value) {
    this.mapEdits = this.mapEdits || { seg: {}, ter: {} };
    this.mapEdits[kind][key] = value;
    this._applyMapEdits();
  }

  ability(unit) {
    return rules.ability(unit, UNITS);
  }

  // Shared checks of the unit actions (sabotage, build, vanish): returns { unit, ab } or { error }
  _abilityUnit(playerId, unitId, type) {
    if (this.phase !== 'battle') return { error: 'Action possible seulement pendant la bataille.' };
    const unit = this.getPlayer(playerId)?.units.find(u => u.id === unitId);
    if (!unit || unit.q === null) return { error: 'Unité introuvable.' };
    const ab = this.ability(unit);
    if (!ab || ab.type !== type) return { error: 'Cette unité n\'a pas cette capacité.' };
    if (unit.isFleeing) return { error: 'Unité en fuite.' };
    if (unit.speedRemaining < ab.cost) return { error: `Il faut ${ab.cost} de vitesse.` };
    return { unit, ab };
  }

  _neighbour(unit, q, r) {
    if (!Number.isInteger(q) || !Number.isInteger(r) || !this.hexMap[hexKey(q, r)]) return false;
    return hexDistance(unit.q, unit.r, q, r) === 1;
  }

  // Espion: destroys the infrastructure on the edge toward (q, r), or the bridge hex (q, r) if it is empty
  sabotage(playerId, unitId, q, r) {
    const c = this._abilityUnit(playerId, unitId, 'sabotage');
    if (c.error) return c;
    const { unit, ab } = c;
    if (!this._neighbour(unit, q, r)) return { error: 'Choisissez une case voisine.' };
    const ek = segmentEdgeKey(unit.q, unit.r, q, r), hk = hexKey(q, r);
    const opt = rules.sabotageOption(this.segmentData[ek] || null, this.terrainData[hk]);
    if (!opt) return { error: 'Rien à saboter ici.' };
    if (opt.target === 'hex' && this.unitMap[hk]) return { error: 'Le pont est occupé.' };
    const before = opt.target === 'edge' ? this.segmentData[ek] : this.terrainData[hk];
    if (opt.target === 'edge') this._editMap('seg', ek, opt.to); else this._editMap('ter', hk, opt.to);
    unit.speedRemaining = Math.max(0, rules.snap(unit.speedRemaining - ab.cost));
    const change = { kind: 'sabotage', unitId: unit.id, playerId, target: opt.target, q1: unit.q, r1: unit.r, q, r, from: before, to: opt.to };
    this._record('map_edit', change);
    this.emitEvent({ event: 'map_edit', ...change });
    return { ok: true, ...change };
  }

  // Bâtisseurs: builds on the edge toward (q, r) (barrière, chevaux de frise, échelle on a cliff, pont on a river)
  // or works the hex (q, r) (pont on a river hex, burns a forest)
  build(playerId, unitId, q, r, kind) {
    const c = this._abilityUnit(playerId, unitId, 'build');
    if (c.error) return c;
    const { unit, ab } = c;
    if (!this._neighbour(unit, q, r)) return { error: 'Choisissez une case voisine.' };
    const ek = segmentEdgeKey(unit.q, unit.r, q, r), hk = hexKey(q, r);
    const options = rules.buildOptions(this.segmentData[ek] || null, this.terrainData[hk]);
    const opt = options.find(o => o.id === kind);
    if (!opt) return { error: 'Construction impossible ici.' };
    const def = RULES.abilities.build_kinds[kind];
    if (opt.target === 'hex' && kind === 'pont' && this.unitMap[hk]) return { error: 'Case occupée.' };
    const before = opt.target === 'edge' ? (this.segmentData[ek] || null) : this.terrainData[hk];
    const to = opt.target === 'edge' ? def.edgeTo : def.terrainTo;
    if (opt.target === 'edge') this._editMap('seg', ek, to); else this._editMap('ter', hk, to);
    unit.speedRemaining = Math.max(0, rules.snap(unit.speedRemaining - ab.cost));
    const change = { kind, unitId: unit.id, playerId, target: opt.target, q1: unit.q, r1: unit.r, q, r, from: before, to };
    this._record('map_edit', change);
    this.emitEvent({ event: 'map_edit', ...change });
    return { ok: true, ...change };
  }

  // Assassin: disappears for the rest of the day when no enemy is within its ability range
  vanish(playerId, unitId) {
    const c = this._abilityUnit(playerId, unitId, 'ambush');
    if (c.error) return c;
    const { unit, ab } = c;
    if (unit.vanishedDay === this.dayNumber()) return { error: 'Déjà disparu pour la journée.' };
    for (const p of this.players) {
      if (p.id === playerId) continue;
      for (const e of p.units) if (e.q !== null && hexDistance(e.q, e.r, unit.q, unit.r) <= ab.range && this.canSee(playerId, e)) return { error: `Un ennemi est à moins de ${ab.range} cases.` };
    }
    unit.vanishedDay = this.dayNumber();
    unit.revealedUntilRound = null;
    unit.speedRemaining = Math.max(0, rules.snap(unit.speedRemaining - ab.cost));
    this._record('vanish', { u: unit.id });
    return { ok: true, unitId: unit.id };
  }

  setMap(mapId) {
    if (this.phase !== 'lobby') return { error: 'La carte ne peut être changée qu\'avant le début de la partie.' };
    if (!maps.mapExists(mapId)) return { error: 'Carte introuvable.' };
    this.mapId = mapId;
    this._loadMap();
    return { ok: true };
  }

  addPlayer(id, name, extra = {}) {
    this.players.push({
      ...extra,
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

  publicPlayers() {
    return this.players.map(p => ({
      id: p.id,
      name: p.name,
      generalId: p.generalId,
      isReady: !!p.isReady,
      isEliminated: !!p.isEliminated,
      connected: p.connected !== false,
      color: p.color || '#4a90d9',
    }));
  }

  publicSpectators() {
    return this.spectators.map(s => ({ id: s.id, name: s.name, connected: s.connected !== false }));
  }

  getLobbyState() {
    return {
      roomCode: this.roomCode,
      hostId: this.hostId,
      phase: this.phase,
      budget: this.budget,
      mapId: this.mapId,
      mapName: this.map ? this.map.name : this.mapId,
      mode: this.mode,
      settings: this.settings,
      players: this.publicPlayers(),
      spectators: this.publicSpectators(),
      takenGenerals: this.players.filter(p => p.generalId).map(p => p.generalId),
    };
  }

  startGame() {
    this.phase = 'army_building';
    for (const p of this.players) p.isReady = false;
  }

  submitArmy(playerId, unitList) {
    // unitList: [{ typeId, count }]
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Joueur introuvable.' };

    if (!Array.isArray(unitList)) return { error: 'Armée invalide.' };

    let totalCost = 0;
    let totalCount = 0;
    for (const entry of unitList) {
      const unitData = entry && Object.prototype.hasOwnProperty.call(UNITS, entry.typeId) ? UNITS[entry.typeId] : null;
      if (!unitData) return { error: `Unité inconnue: ${entry && entry.typeId}` };
      if (!Number.isInteger(entry.count) || entry.count < 0 || entry.count > 200) return { error: 'Quantité invalide.' };
      totalCost += unitData.cost * entry.count;
      totalCount += entry.count;
    }
    if (totalCount > 200) return { error: 'Trop d\'unités.' };

    if (totalCost > this.budget) {
      return { error: `Budget dépassé. Max: ${this.budget}, utilisé: ${totalCost}` };
    }

    // Add the general as a special unit
    const generalData = GENERALS.find(g => g.id === player.generalId);
    if (!generalData) return { error: 'Général non sélectionné.' };

    const units = [];
    for (const { typeId, count } of unitList) {
      for (let i = 0; i < count; i++) units.push(this._createUnit(typeId, playerId));
    }

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
      power: generalData.weapon.damage,
      armor: generalData.armor,
      maxArmor: generalData.armor,
      intimidation: Math.floor(generalData.charisma / 2),
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
      activeAbility: generalAbility(generalData),
      passiveAbility: generalData.passiveAbility,
      citation: generalData.citation,
      speedRemaining: 0,
      isFleeing: false,
      facing: 5,
    };

    player.units = [generalUnit, ...units];
    player.generalUnit = generalUnit;
    player.isReady = true;

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
      bonusType: data.bonusType || null,
      bonusValue: data.bonusValue ?? null,
      bonusRange: data.bonusRange ?? null,
      bonusCost: data.bonusCost ?? null,
      stance: 'marche',
      speedRemaining: 0,
      isFleeing: false,
      facing: 5,
    };
  }

  allArmiesSubmitted() {
    return this.players.every(p => p.isReady);
  }

  startDeployment() {
    this.phase = 'deployment';
    const zones = getStartingZones(this.players.length, MAP_RADIUS, this.budget, this.map);
    this.players.forEach((p, i) => {
      p.startingZone = zones[i];
      p.isReady = false;
    });
  }

  getDeploymentState(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return null;
    const general = GENERALS.find(g => g.id === player.generalId);
    const occupiedHexes = {};
    for (const unit of player.units) {
      if (unit.q !== null) occupiedHexes[hexKey(unit.q, unit.r)] = { unitId: unit.id, playerId: player.id };
    }
    return {
      phase: 'deployment',
      myId: playerId,
      mapId: this.mapId,
      mode: this.mode,
      budget: this.budget,
      isReady: !!player.isReady,
      startingZone: player.startingZone,
      units: player.units,
      placedUnits: player.placedUnits,
      generalData: general,
      occupiedHexes,
      players: this.publicPlayers(),
      spectators: this.publicSpectators(),
    };
  }

  serialize() {
    const out = {};
    for (const [k, v] of Object.entries(this)) {
      if (TRANSIENT.has(k)) continue;
      out[k] = v;
    }
    out.players = this.players.map(p => ({ ...p, generalUnit: null }));
    return JSON.parse(JSON.stringify(out));
  }

  static deserialize(data) {
    const room = new GameRoom(data.roomCode, data.hostId, { mapId: data.mapId || 'default', mode: data.mode || 'sequential' });
    for (const [k, v] of Object.entries(data)) {
      if (TRANSIENT.has(k)) continue;
      room[k] = v;
    }
    room.spectators = room.spectators || [];
    room.manche = room.manche || 1;
    room.turn = room.turn || 1;
    room.turnOrder = room.turnOrder || [];
    room.pendingAttacks = room.pendingAttacks || {};
    room.activeEffects = room.activeEffects || [];
    room.settings = rules.mergeSettings(rules.defaultSettings(), room.settings).settings;
    room.objectives = room.objectives || [];
    room.scores = room.scores || {};
    room.spectatorSnapshots = room.spectatorSnapshots || [];
    room._events = [];
    for (const p of room.players) p.generalUnit = p.units.find(u => u.isGeneral) || null;
    room._loadMap();
    room._rebuildUnitMap();
    return room;
  }

  placeUnit(playerId, unitId, q, r) {
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Joueur introuvable.' };
    if (!Number.isInteger(q) || !Number.isInteger(r)) return { error: 'Case invalide.' };
    if (player.isReady) return { error: 'Vous êtes déjà prêt.' };

    const zone = player.startingZone;
    if (!zone) return { error: 'Aucune zone de déploiement.' };
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
    this._rebuildUnitMap();
    for (const p of this.players) {
      p.isReady = false;
      for (const u of p.units) {
        u.hasMoved = false;
        u.hasAttacked = false;
      }
    }
    this.objectives = (this.map.objectives || [])
      .filter(o => o && Number.isInteger(o.q) && Number.isInteger(o.r) && this.hexMap[hexKey(o.q, o.r)])
      .map(o => ({ id: o.id || hexKey(o.q, o.r), q: o.q, r: o.r, name: o.name || 'Objectif', type: o.type || 'flag', points: Number.isFinite(o.points) ? o.points : RULES.objectives.defaultPoints, owner: null }));
    this.scores = Object.fromEntries(this.players.map(p => [p.id, 0]));
    this.balance = { terrains: clone(TERRAINS), segments: clone(SEGMENTS), stances: clone(rules.stanceList()) };
    this._moveTable = null;
    this._initStats();
    this.turns.start(this);
    if (this.recordReplay) { this.replay = replay.createReplay(this); replay.keyframe(this.replay, this); }
    this._snapshotForSpectators();
  }

  // ---- statistics (end of battle recap) ----
  _initStats() {
    const players = {}, units = {};
    for (const p of this.players) {
      players[p.id] = { damageDealt: 0, damageTaken: 0, moraleDealt: 0, kills: 0, losses: 0, captures: 0, duelsWon: 0, duelsLost: 0 };
      for (const u of p.units) {
        if (u.q === null) continue;
        units[u.id] = { playerId: p.id, name: u.name, typeId: u.typeId, isGeneral: !!u.isGeneral, damageDealt: 0, damageTaken: 0, kills: 0, alive: true, fled: false };
      }
    }
    this.stats = { players, units };
  }

  _stat(unit, field, n = 1) {
    if (!this.stats || !unit) return;
    const us = this.stats.units[unit.id];
    if (us && field in us) us[field] += n;
    const ps = this.stats.players[unit.playerId];
    if (ps && field in ps) ps[field] += n;
  }

  _record(kind, data) {
    if (this.replay) replay.event(this.replay, this, kind, data);
  }

  _recordKeyframe() {
    if (this.replay) replay.keyframe(this.replay, this);
  }

  getReplay() {
    return this.phase === 'ended' ? replay.exportReplay(this.replay) : null;
  }

  getRecap() {
    if (!this.stats) return null;
    const alive = new Set();
    for (const p of this.players) for (const u of p.units) alive.add(u.id);
    const units = Object.entries(this.stats.units).map(([id, s]) => ({ id, ...s, alive: alive.has(id) }));
    return {
      winnerId: this.winner,
      winnerName: this.getPlayer(this.winner)?.name || null,
      endReason: this.endReason,
      turns: this.turn,
      scores: this.scores,
      objectives: this.objectives,
      players: this.players.map(p => ({
        id: p.id, name: p.name, color: p.color || '#4a90d9', generalId: p.generalId, isEliminated: !!p.isEliminated,
        points: this.scores[p.id] || 0,
        unitsAlive: units.filter(u => u.playerId === p.id && u.alive).length,
        unitsTotal: units.filter(u => u.playerId === p.id).length,
        objectivesHeld: this.objectives.filter(o => o.owner === p.id).length,
        ...(this.stats.players[p.id] || {}),
      })),
      units,
      replayAvailable: !!this.replay,
    };
  }

  // ---- spectators: delayed vision keeps the unit positions of the previous round ----
  _slimUnit(u, p) {
    return { id: u.id, playerId: p.id, typeId: u.typeId, name: u.name, isGeneral: !!u.isGeneral, category: u.category, q: u.q, r: u.r, vitality: u.vitality, maxVitality: u.maxVitality, morale: u.morale, maxMorale: u.maxMorale, facing: u.facing, stance: u.stance || null, isFleeing: !!u.isFleeing, generalId: u.generalId || null, isMine: false };
  }

  _snapshotForSpectators() {
    if (this.settings.spectatorVision !== 'delayed') { this.spectatorSnapshots = []; return; }
    const units = [];
    for (const p of this.players) for (const u of p.units) if (u.q !== null) units.push(this._slimUnit(u, p));
    this.spectatorSnapshots = [...this.spectatorSnapshots, { turn: this.turn, units }].slice(-2);
  }

  _rollInitiative() {
    const activePlayers = this.players.filter(p => !p.isEliminated);
    this.initiativeRolls = {};
    for (const p of activePlayers) {
      const general = GENERALS.find(g => g.id === p.generalId);
      const strategy = general ? general.strategy : 10;
      const d20 = Math.floor(this._random() * 20) + 1;
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
    return this.turns.currentPlayerId(this);
  }

  canAct(playerId) {
    return this.turns.canAct(this, playerId);
  }

  // Compute visible hexes for a player
  getVisibleHexes(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return new Set();
    const visible = new Set();

    const sd = this.segmentData;
    const night = this.phase === 'battle' && this.isNight();
    const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
    for (const unit of player.units) {
      if (unit.q === null) continue;
      const unitTerrain = this.terrainData[hexKey(unit.q, unit.r)] || 'plain';
      const inForest = unitTerrain === 'forest';
      let baseRange = inForest ? 2 : Math.max(3, unit.visionRange);
      if (night) baseRange = Math.max(RULES.night.visionMin, Math.floor(baseRange * RULES.night.visionFactor));
      const myHeight = this.heightData[hexKey(unit.q, unit.r)] || 0;
      const maxRange = baseRange + myHeight; // portée max possible (cible au niveau 0)
      // BFS bloqué par segments infranchissables
      const visited = new Map(); // key -> distance
      const queue = [{ q: unit.q, r: unit.r, d: 0 }];
      visited.set(hexKey(unit.q, unit.r), 0);
      while (queue.length) {
        const { q, r, d } = queue.shift();
        const key = hexKey(q, r);
        if (!this.hexMap[key]) continue;
        const targetHeight = this.heightData[key] || 0;
        const effectiveRange = baseRange + Math.max(0, myHeight - targetHeight);
        if (!inForest && this.terrainData[key] === 'forest' && d > 2) continue;
        if (d <= effectiveRange) visible.add(key);
        if (d >= maxRange) continue;
        for (const [dq, dr] of DIRS) {
          const nq = q + dq, nr = r + dr;
          const nk = hexKey(nq, nr);
          if (visited.has(nk)) continue;
          const edgeK = segmentEdgeKey(q, r, nq, nr);
          const segDef = sd[edgeK] ? this._segments()[sd[edgeK]] : null;
          if (segDef?.infranchissable) { visited.set(nk, maxRange + 1); continue; }
          visited.set(nk, d + 1);
          queue.push({ q: nq, r: nr, d: d + 1 });
        }
      }
    }
    return visible;
  }

  // ---- concealment (ambushes) ----
  _inCover(q, r) {
    return RULES.concealment.terrains.includes(this.terrainData[hexKey(q, r)]);
  }

  _isRevealed(unit) {
    return unit.revealedUntilRound != null && unit.revealedUntilRound >= this.turn;
  }

  // Hidden from this viewer at (q, r)? Cover terrain, not revealed, no viewer unit adjacent / spy within range
  isConcealedFrom(viewerId, unit, q = unit.q, r = unit.r) {
    if ((!this._inCover(q, r) && !this._vanished(unit)) || this._isRevealed(unit)) return false;
    if (this.activeEffects.some(e => e.type === 'reveal_hidden' && e.targetPlayerId === viewerId)) return false;
    const viewer = this.getPlayer(viewerId);
    if (!viewer) return true;
    const c = RULES.concealment;
    for (const v of viewer.units) {
      if (v.q === null) continue;
      const d = hexDistance(v.q, v.r, q, r);
      if (d <= c.revealDistance || (v.typeId === c.spyTypeId && d <= c.spyDistance)) return false;
    }
    return true;
  }

  // The single visibility predicate: fog of war + concealment. vis = getVisibleHexes(viewerId) (optional cache)
  canSee(viewerId, unit, q = unit.q, r = unit.r, vis = null) {
    if (!unit || q === null || q === undefined) return false;
    if (unit.playerId === viewerId) return true;
    const visible = vis || this.getVisibleHexes(viewerId);
    if (!visible.has(hexKey(q, r))) return false;
    return !this.isConcealedFrom(viewerId, unit, q, r);
  }

  _reveal(unit, rounds = RULES.concealment.revealRounds) {
    unit.revealedUntilRound = Math.max(unit.revealedUntilRound || 0, this.turn + rounds);
    unit.vanishedDay = null;
  }

  // Assassin that used its ability today (hidden anywhere, like in a forest)
  _vanished(unit) {
    return unit.vanishedDay != null && unit.vanishedDay === this.dayNumber();
  }

  _enemyAdjacent(unit) {
    for (const p of this.players) {
      if (p.id === unit.playerId) continue;
      for (const e of p.units) if (e.q !== null && hexDistance(e.q, e.r, unit.q, unit.r) === 1) return true;
    }
    return false;
  }

  findUnit(unitId) {
    for (const p of this.players) {
      const u = p.units.find(x => x.id === unitId);
      if (u) return u;
    }
    return null;
  }

  _commonState() {
    return {
      phase: this.phase,
      turn: this.turn,
      manche: this.manche,
      currentPlayerId: this.getCurrentPlayerId(),
      mapId: this.mapId,
      mode: this.mode,
      budget: this.budget,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        generalId: p.generalId,
        isEliminated: !!p.isEliminated,
        connected: p.connected !== false,
        unitCount: p.units.length,
        color: p.color || '#4a90d9',
      })),
      spectators: this.publicSpectators(),
      turnOrder: this.turnOrder,
      initiativeRolls: this.initiativeRolls,
      winner: this.winner,
      endReason: this.endReason,
      turnDeadline: this.turnDeadline || null,
      turnEndsAt: this.turnEndsAt || null,
      settings: this.settings,
      ...this.timeState(),
      objectives: this.objectives,
      scores: this.scores,
      movementRules: this.moveTable(),
      mapEdits: this.mapEdits || null,
      recap: this.phase === 'ended' ? this.getRecap() : null,
    };
  }

  getSpectatorState(spectatorId) {
    const vision = this.phase === 'ended' ? 'full' : this.settings.spectatorVision;
    let units = [];
    if (vision === 'full') {
      for (const p of this.players) {
        for (const u of p.units) {
          if (u.q === null) continue;
          units.push({ ...u, isMine: false, playerId: p.id });
        }
      }
    } else if (vision === 'delayed') {
      units = (this.spectatorSnapshots[0] && this.spectatorSnapshots.length > 1) ? this.spectatorSnapshots[0].units : [];
    }
    const delayedTurn = vision === 'delayed' && this.spectatorSnapshots.length > 1 ? this.spectatorSnapshots[0].turn : null;
    return {
      ...this._commonState(),
      myId: spectatorId,
      isSpectator: true,
      spectatorVision: vision,
      delayedTurn,
      generalData: null,
      visibleHexes: vision === 'off' ? [] : Object.keys(this.hexMap),
      units,
      myUnits: [],
      activeEffects: vision === 'full' ? this.activeEffects : [],
      ...(this.turns.stateFor ? this.turns.stateFor(this, null) : {}),
    };
  }

  getGameState(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return null;
    const visibleHexes = this.getVisibleHexes(playerId);
    const general = GENERALS.find(g => g.id === player.generalId);

    // Build visible units list
    const visibleUnits = [];
    const enemies = this.players.filter(p => p.id !== playerId && !p.isEliminated);
    const concealedOf = (u) => u.q !== null && (this._inCover(u.q, u.r) || this._vanished(u)) && !this._isRevealed(u) && enemies.every(e => this.isConcealedFrom(e.id, u));
    const myUnits = player.units.map(u => ({ ...u, concealed: concealedOf(u) }));
    for (const p of this.players) {
      for (const u of p.units) {
        if (u.q === null) continue;
        if (p.id === playerId) {
          visibleUnits.push({ ...u, isMine: true, playerId: p.id, concealed: concealedOf(u) });
        } else if (this.canSee(playerId, u, u.q, u.r, visibleHexes)) {
          visibleUnits.push({ ...u, isMine: false, playerId: p.id });
        }
      }
    }
    const isCurrent = this.getCurrentPlayerId() === playerId;

    return {
      ...this._commonState(),
      myId: playerId,
      generalData: general,
      visibleHexes: Array.from(visibleHexes),
      units: visibleUnits,
      myUnits,
      activeEffects: this.activeEffects.filter(e => e.targetPlayerId === playerId),
      ...(() => {
        const ids = isCurrent && this.phase === 'battle' ? this.unitsAbleToAct(playerId, true) : [];
        return { actionsLeft: ids.length, actionUnitIds: ids };
      })(),
      ...(this.turns.stateFor ? this.turns.stateFor(this, playerId) : {}),
    };
  }

  moveUnit(playerId, unitId, targetQ, targetR) {
    const player = this.getPlayer(playerId);
    const unit = player?.units.find(u => u.id === unitId);
    if (!unit || unit.q === null) return { error: 'Unité introuvable.' };
    if (!Number.isInteger(targetQ) || !Number.isInteger(targetR) || !this.hexMap[hexKey(targetQ, targetR)]) return { error: 'Case invalide.' };
    if (unit.isFleeing) return { error: 'Unité en fuite.' };
    if (unit.speedRemaining <= 0) return { error: 'Plus de déplacement disponible.' };

    // Only units the mover can see block the path; the walk stops in front of a hidden unit (ambush)
    const vis = this.getVisibleHexes(playerId);
    const blocked = (k) => {
      const occ = this.unitMap[k];
      return !!occ && this.canSee(playerId, occ, occ.q, occ.r, vis);
    };
    // Chariots drive through the units they can see, but never stop on one
    const ab = this.ability(unit);
    const drive = !!ab && ab.type === 'trample';
    if (drive && blocked(hexKey(targetQ, targetR))) return { error: 'Case occupée.' };
    const found = findPathCost(this.hexMap, this.unitMap, unit.q, unit.r, targetQ, targetR, unit.speedRemaining, unit, this.segmentData, blocked, this.moveTable(), rules.hasFullSpeed(unit), drive ? blocked : null);
    if (found === null) return { error: 'Chemin inaccessible.' };

    const fromQ = unit.q, fromR = unit.r;
    let path = found.path;
    let ambush = null;
    const stop = path.findIndex(([q, r]) => {
      const occ = this.unitMap[hexKey(q, r)];
      return !!occ && !(drive && blocked(hexKey(q, r)));
    });
    if (stop !== -1) {
      const occ = this.unitMap[hexKey(path[stop][0], path[stop][1])];
      ambush = { byUnitId: occ.id, q: occ.q, r: occ.r, playerId: occ.playerId };
      path = path.slice(0, stop);
    }
    while (drive && path.length && this.unitMap[hexKey(path[path.length - 1][0], path[path.length - 1][1])]) path.pop();
    const moveCost = path.length ? this._pathCost(unit, fromQ, fromR, path) : 0;

    delete this.unitMap[hexKey(unit.q, unit.r)];
    if (path.length) {
      unit.q = path[path.length - 1][0];
      unit.r = path[path.length - 1][1];
      unit.hasMoved = true;
    }
    unit.speedRemaining = ambush ? 0 : Math.max(0, rules.snap(unit.speedRemaining - moveCost));
    this.unitMap[hexKey(unit.q, unit.r)] = unit;

    if (path.length > 0) {
      const last = path.length - 1;
      const prevQ = last === 0 ? fromQ : path[last - 1][0];
      const prevR = last === 0 ? fromR : path[last - 1][1];
      unit.facing = hexFacing(prevQ, prevR, path[last][0], path[last][1]);
    }
    if (ambush) {
      const amb = this.findUnit(ambush.byUnitId);
      if (amb) {
        this._reveal(amb);
        unit.facing = hexFacing(unit.q, unit.r, amb.q, amb.r);
      }
      this.emitEvent({ event: 'ambush', unitId: unit.id, playerId, byUnitId: ambush.byUnitId, byPlayerId: ambush.playerId, q: ambush.q, r: ambush.r });
    }
    this._record('move', { u: unit.id, path: [[fromQ, fromR], ...path], ambush: ambush ? ambush.byUnitId : undefined });

    return { ok: true, unitId: unit.id, fromQ, fromR, path, ambush };
  }

  _pathCost(unit, fromQ, fromR, path) {
    const mounted = rules.isMounted(unit);
    let cost = 0;
    let pq = fromQ, pr = fromR;
    for (const [nq, nr] of path) {
      cost = rules.snap(cost + rules.stepCost(this.moveTable(), this.hexMap[hexKey(pq, pr)], this.hexMap[hexKey(nq, nr)], this.segmentData[segmentEdgeKey(pq, pr, nq, nr)] || null, mounted));
      pq = nq; pr = nr;
    }
    return cost;
  }

  // Terrain and stance helpers
  _getTerrainMods(q, r) {
    const type = this.terrainData[`${q},${r}`];
    const t = this._terrains();
    return t[type] || t.plain;
  }

  _getStanceMods(unit) {
    if (this.balance) return this.balance.stances[unit.stance] || this.balance.stances.marche;
    return rules.getStance(unit.stance) || rules.getStance('marche');
  }

  _initUnitSpeedForTurn(unit) {
    if (unit.q === null) return;
    if (unit.isFleeing) {
      unit.speedRemaining = unit.turnSpeed = Math.floor(unit.speed / 2);
      return;
    }
    if (unit.stunned) { // beaten in a duel: loses the movement of its next turn
      unit.stunned = false;
      unit.speedRemaining = unit.turnSpeed = 0;
      return;
    }
    const stance = unit.isGeneral ? {} : this._getStanceMods(unit);
    const terrain = this._getTerrainMods(unit.q, unit.r);
    // at least 1: a slow unit resting or fighting in a forest must still be able to leave its stance
    let speed = Math.max(unit.speed > 0 ? 1 : 0, unit.speed + (stance.vitesse || 0) + terrain.vitesse);
    if (this.isNight() && speed > 0) speed = Math.max(1, speed - RULES.night.speedMalus);
    const ab = this.ability(unit);
    if (ab && ab.type === 'speed_free' && !this._enemyAdjacent(unit)) speed += ab.value;
    unit.speedRemaining = unit.turnSpeed = speed;
  }

  _applyTurnRegen(unit) {
    if (unit.q === null) return;
    const stance = unit.isGeneral ? {} : this._getStanceMods(unit);
    const terrain = this._getTerrainMods(unit.q, unit.r);
    const rest = (!unit.isGeneral && this.isNight() && RULES.night.restStances[unit.stance]) || {};
    const ar = (stance.armure_tour || 0) + (terrain.armure_tour || 0) + (rest.armure_tour || 0);
    const mr = (stance.moral_tour || 0) + (terrain.moral_tour || 0) + (rest.moral_tour || 0);
    const vr = (stance.vitalite_tour || 0) + (terrain.vitalite_tour || 0) + (rest.vitalite_tour || 0);
    if (ar !== 0) unit.armor = Math.max(0, Math.min(unit.maxArmor || unit.armor, unit.armor + ar));
    if (mr !== 0 && !unit.isGeneral) unit.morale = Math.max(0, Math.min(unit.maxMorale, unit.morale + mr));
    if (vr !== 0) unit.vitality = Math.max(0, Math.min(unit.maxVitality, unit.vitality + vr));
    const ab = this.ability(unit);
    if (ab && ab.type === 'moral_near_general' && !unit.isFleeing) {
      const g = this.getPlayer(unit.playerId)?.generalUnit;
      if (g && g.q !== null && hexDistance(g.q, g.r, unit.q, unit.r) <= ab.range) unit.morale = Math.min(unit.maxMorale, unit.morale + ab.value);
    }
  }

  // Called at the start of a player's turn to handle fleeing units
  _processFleeing(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return [];
    const fled = [];
    for (const unit of [...player.units]) {
      if (!unit.isFleeing || unit.q === null) continue;
      // Move away from the map center toward the nearest edge
      const c = this.mapCenter || { q: 0, r: 0 };
      const dist = hexDistance(c.q, c.r, unit.q, unit.r);
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
      const targetQ = Math.round(c.q + (unit.q - c.q) * scale);
      const targetR = Math.round(c.r + (unit.r - c.r) * scale);
      if (!this.hexMap[hexKey(targetQ, targetR)]) {
        // Outside map - unit has fled
        player.units = player.units.filter(u => u.id !== unit.id);
        delete this.unitMap[hexKey(unit.q, unit.r)];
        fled.push({ unitId: unit.id, unitName: unit.name });
        if (this.stats?.units[unit.id]) this.stats.units[unit.id].fled = true;
        this._stat(unit, 'losses');
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
    if (fled.length) this._record('fled', { units: fled.map(f => f.unitId) });
    return fled;
  }

  rotateFacing(playerId, unitId, facing) {
    if (!Number.isInteger(facing) || facing < 0 || facing > 5) return { error: 'Orientation invalide.' };
    const player = this.getPlayer(playerId);
    const unit = player?.units.find(u => u.id === unitId);
    if (!unit || unit.q === null) return { error: 'Unité introuvable.' };
    if (unit.speedRemaining <= 0) return { error: 'Plus de vitesse disponible.' };
    unit.speedRemaining = Math.max(0, rules.snap(unit.speedRemaining - 1));
    unit.facing = facing;
    this._record('facing', { u: unit.id, f: facing });
    return { ok: true };
  }

  changeStance(playerId, unitId, stanceId) {
    if (this.balance ? !Object.prototype.hasOwnProperty.call(this.balance.stances, stanceId) : !rules.hasStance(stanceId)) return { error: 'Posture invalide.' };
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Joueur introuvable.' };
    const unit = player.units.find(u => u.id === unitId);
    if (!unit || unit.q === null) return { error: 'Unité introuvable.' };
    if (unit.isGeneral) return { error: 'Les généraux n\'ont pas de posture.' };
    if (unit.isFleeing) return { error: 'Unité en fuite.' };
    if (unit.speedRemaining <= 0) return { error: 'Plus de vitesse disponible pour changer de posture.' };
    if (unit.stance === stanceId) return { error: 'Déjà dans cette posture.' };
    unit.speedRemaining = Math.max(0, rules.snap(unit.speedRemaining - 2));
    unit.stance = stanceId;
    this._record('stance', { u: unit.id, s: stanceId });
    return { ok: true };
  }

  motivateUnit(playerId, generalId) {
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Joueur introuvable.' };
    const general = player.units.find(u => u.id === generalId && u.isGeneral);
    if (!general || general.q === null) return { error: 'Général introuvable.' };
    if (general.hasAttacked) return { error: 'Le général a déjà agi ce tour.' };

    const generalData = GENERALS.find(g => g.id === general.generalId);
    const charisma = generalData ? generalData.charisma : 10;
    const range = Math.floor(charisma / 5);
    const targets = player.units.filter(u => !u.isGeneral && u.q !== null && hexDistance(general.q, general.r, u.q, u.r) <= range);
    if (targets.length === 0) return { error: 'Aucune unité à portée.' };

    const d20 = Math.floor(this._random() * 20) + 1;
    const success = charisma >= d20;
    const moralGain = success ? (general.intimidation || 5) : 0;
    if (success) {
      for (const t of targets) {
        t.morale = Math.min(t.maxMorale, t.morale + moralGain);
        if (t.isFleeing && t.morale > 0) t.isFleeing = false;
      }
    }

    // Coût : toute la vitesse restante min 1
    const speedCost = Math.max(1, general.speedRemaining);
    general.speedRemaining = Math.max(0, general.speedRemaining - speedCost);
    general.hasAttacked = true;
    this._record('motivate', { u: general.id, success, count: targets.length });

    return { ok: true, success, charisma, d20, range, moralGain, count: targets.length };
  }

  // Attack from a distance in one action: walk to (q, r), then strike. Everything is checked before the unit moves,
  // so either both happen or nothing does (an ambush on the way still stops the unit before the attack).
  moveAndAttack(playerId, attackerId, targetId, q, r) {
    const player = this.getPlayer(playerId);
    const attacker = player?.units.find(u => u.id === attackerId);
    if (!attacker || attacker.q === null) return { error: 'Unité attaquante introuvable.' };
    if (attacker.hasAttacked) return { error: 'Cette unité a déjà attaqué ce tour.' };
    if (attacker.isFleeing) return { error: 'Unité en fuite.' };
    const target = this.findUnit(targetId);
    if (!target || target.playerId === playerId || target.q === null || !this.canSee(playerId, target)) return { error: 'Cible introuvable.' };
    if (!Number.isInteger(q) || !Number.isInteger(r) || !this.hexMap[hexKey(q, r)]) return { error: 'Case invalide.' };
    if (q === attacker.q && r === attacker.r) return { move: null, attack: this.initiateCombat(playerId, attackerId, targetId) };
    const d = hexDistance(q, r, target.q, target.r);
    if (d === 0 || d > rules.attackRange(attacker.range, this.heightData[hexKey(q, r)], this.heightData[hexKey(target.q, target.r)])) {
      return { error: 'La cible ne serait pas à portée depuis cette case.' };
    }
    const move = this.moveUnit(playerId, attackerId, q, r);
    if (move.error) return move;
    if (move.ambush || attacker.q !== q || attacker.r !== r) return { move, attack: null };
    return { move, attack: this.initiateCombat(playerId, attackerId, targetId) };
  }

  initiateCombat(playerId, attackerId, targetId) {
    const player = this.getPlayer(playerId);
    const attacker = player?.units.find(u => u.id === attackerId);
    if (!attacker || attacker.q === null) return { error: 'Unité attaquante introuvable.' };
    if (attacker.hasAttacked) return { error: 'Cette unité a déjà attaqué ce tour.' };
    if (attacker.isFleeing) return { error: 'Unité en fuite.' };

    let targetPlayer = null, target = null;
    for (const p of this.players) {
      if (p.id === playerId) continue;
      const u = p.units.find(u => u.id === targetId);
      if (u) { targetPlayer = p; target = u; break; }
    }
    if (!target || target.q === null || !this.canSee(playerId, target)) return { error: 'Cible introuvable.' };

    const dist = hexDistance(attacker.q, attacker.r, target.q, target.r);
    const hA = this.heightData[hexKey(attacker.q, attacker.r)] || 0;
    const hT = this.heightData[hexKey(target.q, target.r)] || 0;
    const effectiveRange = rules.attackRange(attacker.range, hA, hT);
    if (dist > effectiveRange) return { error: `Cible hors de portée (distance: ${dist}, portée: ${effectiveRange}).` };

    // Deduct speed (all remaining, min 1)
    const speedCost = Math.max(1, attacker.speedRemaining);
    attacker.speedRemaining = Math.max(0, attacker.speedRemaining - speedCost);
    attacker.hasAttacked = true;
    this._reveal(attacker);

    // General against general in melee: a duel, resolved without a defense choice
    const duel = !!(attacker.isGeneral && target.isGeneral && dist === 1);
    const attackId = `atk_${require('crypto').randomBytes(8).toString('hex')}`;
    this.pendingAttacks[attackId] = {
      attackerPlayerId: playerId, attackerId, targetPlayerId: targetPlayer.id, targetId, dist,
      attackerName: attacker.name, targetName: target.name,
      attackerQ: attacker.q, attackerR: attacker.r, targetQ: target.q, targetR: target.r,
      isRanged: dist > 1, targetTypeId: target.typeId, duel,
    };

    return { pending: true, attackId, duel, targetPlayerId: targetPlayer.id, attackerName: attacker.name, targetName: target.name, targetQ: target.q, targetR: target.r, isRanged: dist > 1, targetTypeId: target.typeId };
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
    if (pending.duel) return this._resolveDuel(attacker, target, attackerPlayer, targetPlayer);

    if (isCac) {
      attacker.facing = hexFacing(attacker.q, attacker.r, target.q, target.r);
    } else {
      attacker.facing = hexFacingRanged(attacker.q, attacker.r, target.q, target.r);
    }
    if (defenseChoice === 'counter' || defenseChoice === 'absorb') {
      target.facing = hexFacing(target.q, target.r, attacker.q, attacker.r);
      if (isCac) this._reveal(target);
    }

    const second = isCac ? this.trampleTarget(attacker, target) : null;
    const result = this._resolveCombat(attacker, target, isCac, defenseChoice);
    const combatLog = this._applyCombat(attacker, target, isCac, defenseChoice, result, attackerPlayer, targetPlayer);
    const trample = [];
    if (second && attacker.vitality > 0 && !attacker.isFleeing && this.findUnit(second.id)) {
      const sP = this.getPlayer(second.playerId);
      const r2 = this._resolveCombat(attacker, second, true, 'rien');
      const log2 = this._applyCombat(attacker, second, true, 'rien', r2, attackerPlayer, sP);
      log2.trample = true;
      trample.push({ combatLog: log2, attackerPlayerId: attackerPlayer.id, targetPlayerId: sP.id, attackerId: attacker.id, targetId: second.id });
    }
    return { ok: true, combatLog, trample };
  }

  // Char: the enemy unit right behind its (adjacent) target, in line with it, is struck too
  trampleTarget(attacker, target) {
    const ab = this.ability(attacker);
    if (!ab || ab.type !== 'trample' || !target || hexDistance(attacker.q, attacker.r, target.q, target.r) !== 1) return null;
    const bq = 2 * target.q - attacker.q, br = 2 * target.r - attacker.r;
    const u = this.unitMap[hexKey(bq, br)];
    if (!u || u.playerId === attacker.playerId || u.q === null || !this.canSee(attacker.playerId, u)) return null;
    return u;
  }

  // Applies a computed combat result (damage, morale, rout, stats, deaths, replay); returns the combat log
  _applyCombat(attacker, target, isCac, defenseChoice, result, attackerPlayer, targetPlayer) {
    const attackerId = attacker.id, targetId = target.id;
    const tVitBefore = target.vitality, aVitBefore = attacker.vitality;

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
    const bonuses = [...(result.bonuses || [])];
    if (result.advantage) attacker.ambushDay = this.dayNumber();
    // Soldats: an enemy left at or below the threshold after the fight is finished off (never a general)
    const executeBy = (killer, victim, side) => {
      const ab = this.ability(killer);
      if (!ab || ab.type !== 'execute_low_hp' || victim.isGeneral || killer.vitality <= 0 || victim.vitality <= 0) return;
      if (victim.vitality <= Math.ceil(victim.maxVitality * ab.value / 100)) {
        victim.vitality = 0;
        bonuses.push({ side, type: 'execute_low_hp', text: 'Soldats : unité achevée' });
      }
    };
    executeBy(attacker, target, 'attacker');
    if (result.counterDmgReceived > 0) executeBy(target, attacker, 'target');

    const combatLog = {
      attackerId, targetId, ranged: !isCac,
      attackerName: attacker.name, targetName: target.name,
      defenseChoice,
      attackTotal: result.attackTotal, attackD20: result.attackD20, hit: result.hit,
      dmgInflicted: result.dmgInflicted, armorAbsorb: result.armorAbsorb, dmgReceived: result.dmgReceived,
      moralDmg: result.moralDmg,
      defenseRoll: result.defenseRoll, defenseSuccess: result.defenseSuccess,
      counterDmgReceived: result.counterDmgReceived, counterMoralDmg: result.counterMoralDmg,
      targetVitalityLeft: target.vitality, targetMoraleLeft: target.morale,
      attackerVitalityLeft: attacker.vitality,
      bonuses: bonuses.length ? bonuses : undefined,
      breakdown: result.breakdown,
    };

    const dealt = tVitBefore - target.vitality, countered = aVitBefore - attacker.vitality;
    this._stat(attacker, 'damageDealt', dealt);
    this._stat(target, 'damageTaken', dealt);
    this._stat(attacker, 'moraleDealt', result.moralDmg);
    if (countered > 0) {
      this._stat(target, 'damageDealt', countered);
      this._stat(attacker, 'damageTaken', countered);
    }
    this._removeDead(combatLog, attacker, target, attackerPlayer, targetPlayer);
    const { breakdown, ...logged } = combatLog;
    this._record('combat', { log: logged });
    return combatLog;
  }

  _removeDead(combatLog, attacker, target, attackerPlayer, targetPlayer) {
    if (target.vitality <= 0) {
      combatLog.targetKilled = true;
      this._stat(attacker, 'kills');
      this._stat(target, 'losses');
      targetPlayer.units = targetPlayer.units.filter(u => u.id !== target.id);
      delete this.unitMap[hexKey(target.q, target.r)];
      if (target.isGeneral) { targetPlayer.isEliminated = true; combatLog.generalKilled = true; combatLog.eliminatedPlayer = targetPlayer.name; this._dropObjectives(targetPlayer.id); this._checkVictory(); }
    }
    if (attacker.vitality <= 0) {
      combatLog.attackerKilled = true;
      this._stat(target, 'kills');
      this._stat(attacker, 'losses');
      attackerPlayer.units = attackerPlayer.units.filter(u => u.id !== attacker.id);
      delete this.unitMap[hexKey(attacker.q, attacker.r)];
      if (attacker.isGeneral) { attackerPlayer.isEliminated = true; combatLog.generalKilled = true; combatLog.eliminatedPlayer = attackerPlayer.name; this._dropObjectives(attackerPlayer.id); this._checkVictory(); }
    }
  }

  // ---- general duel ----
  // A few exchanges: each one, both roll d20 + Force; the higher strikes for weapon damage + margin - armor x factor.
  // The winner (most exchanges, then most damage) shakes the loser's army; death only if the vitality reaches 0.
  _resolveDuel(attacker, target, attackerPlayer, targetPlayer) {
    const D = RULES.duel;
    attacker.facing = hexFacing(attacker.q, attacker.r, target.q, target.r);
    target.facing = hexFacing(target.q, target.r, attacker.q, attacker.r);
    this._reveal(target);
    const rounds = [];
    const won = { [attacker.id]: 0, [target.id]: 0 };
    const dealt = { [attacker.id]: 0, [target.id]: 0 };
    for (let i = 0; i < D.maxRounds && attacker.vitality > 0 && target.vitality > 0; i++) {
      const aD = Math.floor(this._random() * D.die) + 1, tD = Math.floor(this._random() * D.die) + 1;
      const aRoll = attacker.force + aD, tRoll = target.force + tD;
      if (aRoll === tRoll) { rounds.push({ attacker: null, dmg: 0, attackerRoll: aRoll, defenderRoll: tRoll, attackerD20: aD, defenderD20: tD }); continue; }
      const striker = aRoll > tRoll ? attacker : target;
      const victim = striker === attacker ? target : attacker;
      const margin = Math.abs(aRoll - tRoll);
      const armor = Math.max(0, victim.armor - this._effectValue('armor_reduction', victim.playerId));
      const dmg = Math.min(victim.vitality, Math.max(1, Math.round(striker.power + margin - armor * D.armorFactor)));
      victim.vitality -= dmg;
      won[striker.id]++;
      dealt[striker.id] += dmg;
      rounds.push({ attacker: striker.id, dmg, attackerRoll: aRoll, defenderRoll: tRoll, attackerD20: aD, defenderD20: tD });
    }
    let winner = null;
    if (target.vitality <= 0) winner = attacker;
    else if (attacker.vitality <= 0) winner = target;
    else if (won[attacker.id] !== won[target.id]) winner = won[attacker.id] > won[target.id] ? attacker : target;
    else if (dealt[attacker.id] !== dealt[target.id]) winner = dealt[attacker.id] > dealt[target.id] ? attacker : target;
    const loser = winner ? (winner === attacker ? target : attacker) : null;
    const duel = { attackerId: attacker.id, defenderId: target.id, rounds, winnerId: winner ? winner.id : null, loserId: loser ? loser.id : null, moraleShock: 0, stunned: false };
    if (winner) {
      const winP = this.getPlayer(winner.playerId), loseP = this.getPlayer(loser.playerId);
      this.stats && this.stats.players[winP.id] && this.stats.players[winP.id].duelsWon++;
      this.stats && this.stats.players[loseP.id] && this.stats.players[loseP.id].duelsLost++;
      if (loser.vitality > 0) {
        duel.moraleShock = D.loserMoraleShock;
        for (const u of loseP.units) {
          if (u.isGeneral || u.q === null) continue;
          u.morale = Math.max(0, u.morale - Math.round(u.maxMorale * D.loserMoraleShock));
          if (u.morale <= 0 && !u.isFleeing) { u.stance = 'marche'; u.isFleeing = true; }
        }
        loser.stunned = true;
        duel.stunned = true;
      }
      for (const u of winP.units) {
        if (u.isGeneral || u.q === null || hexDistance(u.q, u.r, winner.q, winner.r) > D.boostRadius) continue;
        u.morale = Math.min(u.maxMorale, u.morale + Math.round(u.maxMorale * D.winnerMoraleBoost));
      }
    }
    this._stat(attacker, 'damageDealt', dealt[attacker.id]);
    this._stat(target, 'damageTaken', dealt[attacker.id]);
    this._stat(target, 'damageDealt', dealt[target.id]);
    this._stat(attacker, 'damageTaken', dealt[target.id]);
    const combatLog = {
      attackerId: attacker.id, targetId: target.id, ranged: false,
      attackerName: attacker.name, targetName: target.name,
      defenseChoice: 'duel', duel,
      hit: dealt[attacker.id] > 0, attackTotal: null, attackD20: null,
      dmgInflicted: dealt[attacker.id], armorAbsorb: 0, dmgReceived: dealt[attacker.id], moralDmg: 0,
      defenseRoll: null, defenseSuccess: dealt[target.id] > 0,
      counterDmgReceived: dealt[target.id], counterMoralDmg: 0,
      targetVitalityLeft: Math.max(0, target.vitality), targetMoraleLeft: null,
      attackerVitalityLeft: Math.max(0, attacker.vitality),
    };
    this._removeDead(combatLog, attacker, target, attackerPlayer, targetPlayer);
    this._record('combat', { log: combatLog });
    return { ok: true, combatLog };
  }

  _effectValue(type, playerId) {
    return this.activeEffects.filter(e => e.type === type && e.targetPlayerId === playerId).reduce((s, e) => s + (e.value || 0), 0);
  }

  _getSegmentDef(q1, r1, q2, r2) {
    const edgeK = segmentEdgeKey(q1, r1, q2, r2);
    const segType = this.segmentData[edgeK];
    return segType ? (this._segments()[segType] || null) : null;
  }

  // extra (simultaneous mode): { attack, power } added to the attacker (charge bonus / malus)
  _resolveCombat(attacker, target, isCac, defenseChoice, extra = null) {
    const type = isCac ? 'cac' : 'tir';
    const stA = attacker.isGeneral ? {} : this._getStanceMods(attacker);
    const stD = target.isGeneral ? {} : this._getStanceMods(target);
    const tA = this._getTerrainMods(attacker.q, attacker.r);
    const tD = this._getTerrainMods(target.q, target.r);
    // Segment on the edge between attacker and target (only for adjacent melee)
    const segDef = isCac ? this._getSegmentDef(attacker.q, attacker.r, target.q, target.r) : null;

    // Unit abilities (rules.RULES.abilities): lanciers vs horses/chariots, heavy cavalry charge, assassin advantage
    const abA = this.ability(attacker), abD = this.ability(target);
    const antiCav = RULES.abilities.antiCavalryCategories;
    const bonuses = [];
    const lancerAtk = isCac && abA && abA.type === 'anti_cavalry' && antiCav.includes(target.category) ? abA.value : 0;
    const lancerDef = isCac && abD && abD.type === 'anti_cavalry' && antiCav.includes(attacker.category) ? abD.value : 0;
    const charging = isCac && abA && abA.type === 'charge_bonus' && (attacker.stance === 'charge' || (extra && extra.charge === 'bonus')) ? abA.value : 0;
    const advantage = !!(abA && abA.type === 'ambush' && attacker.ambushDay !== this.dayNumber());
    if (lancerAtk) bonuses.push({ side: 'attacker', type: 'anti_cavalry', text: `Lanciers : +${lancerAtk} attaque contre la cavalerie` });
    if (lancerDef) bonuses.push({ side: 'target', type: 'anti_cavalry', text: `Lanciers : +${lancerDef} défense contre la cavalerie` });
    if (charging) bonuses.push({ side: 'attacker', type: 'charge_bonus', text: `Charge lourde : +${charging} puissance et intimidation` });
    if (advantage) bonuses.push({ side: 'attacker', type: 'ambush', text: 'Assassin : avantage (meilleur de 2 dés)' });

    // Bonus/malus de hauteur
    const hA = this.heightData[hexKey(attacker.q, attacker.r)] || 0;
    const hD = this.heightData[hexKey(target.q, target.r)] || 0;
    const heightDiff = hA - hD;
    const nightMod = this.isNight() ? (RULES.night.attackMod[type] || 0) : 0;
    const powerA = this._effectValue('power_boost', attacker.playerId);
    const powerD = this._effectValue('power_boost', target.playerId);
    const armorRedA = this._effectValue('armor_reduction', attacker.playerId);
    const armorRedD = this._effectValue('armor_reduction', target.playerId);

    // Attack effective (généraux utilisent force comme base d'attaque)
    const attackBase = attacker.isGeneral ? attacker.force : attacker.attack;
    const extraAttack = extra ? (extra.attack || 0) : 0;
    const extraPower = extra ? (extra.power || 0) : 0;
    const attackTotal = attackBase + extraAttack + lancerAtk
      + (stA[`attack_${type}`] || 0) + (tA[`attack_${type}`] || 0) + (segDef ? (segDef[`attack_${type}`] || 0) : 0)
      - (stD[`esquive_${type}`] || 0) - (tD[`esquive_${type}`] || 0)
      + heightDiff + nightMod;
    let attackD20 = Math.floor(this._random() * 20) + 1;
    let advantageRolls = null;
    if (advantage) {
      const second = Math.floor(this._random() * 20) + 1;
      advantageRolls = [attackD20, second];
      attackD20 = Math.min(attackD20, second);
    }
    const hit = attackTotal >= attackD20;

    // Damage inflicted: N dé X where N=attacker.vitality, X=effective power
    let dmgInflicted = 0;
    if (hit) {
      const dieFaces = Math.max(1, attacker.power + extraPower + charging + powerA + (stA[`puissance_${type}`] || 0) + (tA[`puissance_${type}`] || 0) + (segDef ? (segDef[`puissance_${type}`] || 0) : 0));
      for (let i = 0; i < attacker.vitality; i++) {
        dmgInflicted += Math.floor(this._random() * dieFaces) + 1;
      }
    }

    // Multiplicateur de hauteur sur les dégâts : (1 + heightDiff / 10)
    if (hit) dmgInflicted = Math.round(dmgInflicted * (1 + heightDiff / 10));

    // Armor absorption: Vitalite_def × Armure_def_effective
    const effectiveArmor = Math.max(0, target.armor + (stD.armure || 0) + (tD.armure || 0) - armorRedD);
    const armorAbsorb = Math.min(target.vitality * effectiveArmor, Math.floor(dmgInflicted * RULES.combat.maxArmorAbsorb));
    let dmgReceived = Math.max(0, Math.floor((dmgInflicted - armorAbsorb) / 10));

    // Intimidation → moral damage
    const effectiveIntimidation = attacker.intimidation + charging + (stA[`intimidation_${type}`] || 0) + (tA[`intimidation_${type}`] || 0);
    let moralDmg = Math.max(0, Math.floor(attacker.vitality * effectiveIntimidation / 10));

    // Defense choice — ranged attacks: no defence test (archers), except a phalange (defend_ranged) which may test
    const shieldWall = !isCac && !!abD && abD.type === 'defend_ranged';
    if (!isCac) defenseChoice = shieldWall && (defenseChoice === 'absorb' || defenseChoice === 'counter') ? 'absorb' : 'rien';

    let defenseRoll = null, defenseSuccess = false;
    let counterDmgReceived = 0, counterMoralDmg = 0;

    if (defenseChoice === 'counter' || defenseChoice === 'absorb') {
      // Généraux utilisent force comme base de défense
      const defBase = target.isGeneral ? target.force : target.defense;
      const defTotal = defBase + lancerDef
        + (stD[`defense_${type}`] || 0) + (tD[`defense_${type}`] || 0) + (segDef ? (segDef[`defense_${type}`] || 0) : 0)
        - (stA[`precision_${type}`] || 0) - (tA[`precision_${type}`] || 0)
        - heightDiff;
      defenseRoll = Math.floor(this._random() * 20) + 1;
      defenseSuccess = defTotal >= defenseRoll;

      if (defenseSuccess && shieldWall) {
        dmgReceived = 0; // the phalange ignores the shooters' power: no vitality loss (morale still suffers)
        bonuses.push({ side: 'target', type: 'defend_ranged', text: 'Phalange : boucliers levés, aucun dégât' });
      } else if (defenseSuccess) {
        const counterDieFaces = Math.max(1, target.power + powerD + (stD[`puissance_${type}`] || 0) + (tD[`puissance_${type}`] || 0) + (segDef ? (segDef[`puissance_${type}`] || 0) : 0));
        let counterRaw = 0;
        for (let i = 0; i < target.vitality; i++) {
          counterRaw += Math.floor(this._random() * counterDieFaces) + 1;
        }
        const atkArmor = Math.max(0, attacker.armor + (stA.armure || 0) + (tA.armure || 0) - armorRedA);
        const atkArmorAbsorb = Math.min(attacker.vitality * atkArmor, Math.floor(counterRaw * RULES.combat.maxArmorAbsorb));
        const rawCounter = Math.max(0, Math.round((counterRaw - atkArmorAbsorb) * (1 + (hD - hA) / 10)));
        const effectiveCounterIntimidation = target.intimidation + (stD[`intimidation_${type}`] || 0) + (tD[`intimidation_${type}`] || 0);
        const rawMoral = Math.max(0, Math.floor(target.vitality * effectiveCounterIntimidation / 10));

        if (defenseChoice === 'absorb') {
          dmgReceived = Math.ceil(dmgReceived / 2);
          moralDmg = Math.ceil(moralDmg / 2);
          // Ranged absorb (phalange): no counter damage
          if (isCac) {
            counterDmgReceived = Math.ceil(rawCounter / 2);
            counterMoralDmg = Math.ceil(rawMoral / 2);
          }
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
      night: nightMod,
      extraAttack, extraPower,
      dieFaces: Math.max(1, attacker.power + extraPower + charging + powerA + (stA[`puissance_${type}`] || 0) + (tA[`puissance_${type}`] || 0) + (segDef ? (segDef[`puissance_${type}`] || 0) : 0)),
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
        ? (target.isGeneral ? target.force : target.defense) + lancerDef + (stD[`defense_${type}`] || 0) + (tD[`defense_${type}`] || 0) + (segDef ? (segDef[`defense_${type}`] || 0) : 0) - (stA[`precision_${type}`] || 0) - (tA[`precision_${type}`] || 0)
        : null,
      defenseRoll,
      defenseSuccess,
      lancerAtk, lancerDef, charging, advantageRolls,
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
    return { attackTotal, attackD20, hit, dmgInflicted, armorAbsorb, dmgReceived, moralDmg, defenseRoll, defenseSuccess, counterDmgReceived, counterMoralDmg, breakdown, bonuses, advantage };
  }

  useGeneralAbility(playerId, targetHex, targetId) {
    const player = this.getPlayer(playerId);
    if (!player) return { error: 'Joueur introuvable.' };
    const general = GENERALS.find(g => g.id === player.generalId);
    const generalUnit = player.units.find(u => u.isGeneral);

    if (!general) return { error: 'Général introuvable.' };
    if (!generalUnit) return { error: 'Unité général introuvable.' };
    const ability = generalAbility(general);
    if (!ability) return { error: 'Ce général n\'a pas de capacité active.' };
    if (generalUnit.hasUsedAbility) return { error: 'Capacité déjà utilisée ce tour.' };
    if (generalUnit.abilityCooldown > 0) return { error: `Capacité en recharge (${generalUnit.abilityCooldown} tours restants).` };

    const combatLog = { abilityUsed: ability.name, generalId: general.id, unitId: generalUnit.id, playerId, effects: [] };

    switch (general.id) {
      case 'ou_ki': {
        this.activeEffects.push({ type: 'power_boost', targetPlayerId: playerId, turnsLeft: 2, value: 2 });
        combatLog.effects.push('Puissance +2 pendant 2 tours');
        const myCount = player.units.length;
        for (const p of this.players) {
          if (p.id === playerId || p.isEliminated) continue;
          if (p.units.length < myCount) {
            for (const u of p.units) if (!u.isGeneral) u.morale = Math.max(0, u.morale - 1);
            combatLog.effects.push(`Moral de ${p.name} réduit de 1`);
          }
        }
        break;
      }
      case 'mou_bu': {
        const target = this.getPlayer(targetId);
        if (!targetId || targetId === playerId || !target || target.isEliminated) return { error: 'Choisissez une armée ennemie cible.' };
        this.activeEffects.push({ type: 'armor_reduction', targetPlayerId: targetId, turnsLeft: 2, value: 1 });
        combatLog.targetPlayerId = targetId;
        combatLog.effects.push(`Armure de l'armée de ${target.name} -1 pendant 2 tours`);
        break;
      }
      case 'ri_boku': {
        this.activeEffects.push({ type: 'reveal_hidden', targetPlayerId: playerId, turnsLeft: 1, value: 1 });
        combatLog.effects.push('Les unités ennemies en embuscade sont révélées jusqu\'au prochain tour');
        break;
      }
      default:
        return { error: 'Capacité sans effet implémenté.' };
    }

    generalUnit.hasUsedAbility = true;
    generalUnit.abilityCooldown = ability.cooldown;
    this._record('ability', { u: generalUnit.id, name: ability.name, effects: combatLog.effects });

    return { ok: true, combatLog };
  }

  _endGame(winnerId, reason) {
    if (this.phase === 'ended') return;
    this.winner = winnerId;
    this.endReason = reason;
    this.phase = 'ended';
    this.pendingAttacks = {};
    if (this.replay) replay.event(this.replay, this, 'end', { winnerId, reason }, true);
    if (this.replay) Object.assign(this.replay, { winnerId, reason });
    if (this.replay) replay.finish(this.replay, this);
  }

  _checkVictory() {
    const alivePlayers = this.players.filter(p => !p.isEliminated);
    if (alivePlayers.length <= 1) this._endGame(alivePlayers.length === 1 ? alivePlayers[0].id : null, 'elimination');
  }

  _dropObjectives(playerId) {
    for (const o of this.objectives) if (o.owner === playerId) o.owner = null;
  }

  // Highest score wins; tie -> most remaining vitality ratio; still tied -> draw
  _endByPoints(reason) {
    const alive = this.players.filter(p => !p.isEliminated);
    const strength = (p) => p.units.reduce((s, u) => s + u.vitality / (u.maxVitality || 1), 0);
    const ranked = alive.slice().sort((a, b) => (this.scores[b.id] || 0) - (this.scores[a.id] || 0) || strength(b) - strength(a));
    const [best, next] = ranked;
    const tie = next && (this.scores[best.id] || 0) === (this.scores[next.id] || 0) && Math.abs(strength(best) - strength(next)) < 1e-9;
    this._endGame(best && !tie ? best.id : null, reason);
  }

  // Called by the turn controller when a player's turn ends: objective captures, end of reveals
  onPlayerTurnEnd(playerId) {
    const player = this.getPlayer(playerId);
    if (!player) return;
    for (const o of this.objectives) {
      const occ = this.unitMap[hexKey(o.q, o.r)];
      if (occ && occ.playerId === playerId && o.owner !== playerId) {
        const prev = o.owner;
        o.owner = playerId;
        if (this.stats?.players[playerId]) this.stats.players[playerId].captures++;
        this.emitEvent({ event: 'objective_captured', objectiveId: o.id, name: o.name, q: o.q, r: o.r, owner: playerId, previousOwner: prev });
        this._record('capture', { id: o.id, owner: playerId });
      }
    }
    for (const u of player.units) {
      if (u.revealedUntilRound != null && u.revealedUntilRound <= this.turn) u.revealedUntilRound = null;
    }
  }

  // Called by the turn controller after the round counter moved: objective points, nightfall, turn limits
  onRoundStart() {
    const before = this.isNight(this.turn - 1);
    for (const o of this.objectives) {
      const owner = o.owner && this.getPlayer(o.owner);
      if (owner && !owner.isEliminated) this.scores[o.owner] = (this.scores[o.owner] || 0) + o.points;
    }
    if (this.objectives.length) this._record('score', { scores: { ...this.scores } });
    if (before !== this.isNight()) this.emitEvent({ event: 'time_change', ...this.timeState() });
    const vp = this.settings.victoryPoints;
    if (vp > 0) {
      const reached = this.players.filter(p => !p.isEliminated && (this.scores[p.id] || 0) >= vp);
      if (reached.length) { this._endByPoints('points'); return; }
    }
    if (this.settings.maxTurns > 0 && this.turn > this.settings.maxTurns) { this._endByPoints('max_turns'); return; }
    this._snapshotForSpectators();
  }

  // Units of the player that can still do something this turn (move, rotate, change stance, attack, motivate, ability)
  // strict: only units that can still move, attack or use an action (the end-turn warning);
  // otherwise any remaining speed counts, since it can still pay for a stance change or a pivot (automatic end of turn)
  unitsAbleToAct(playerId, strict = false) {
    const player = this.getPlayer(playerId);
    if (!player || player.isEliminated) return [];
    const out = [];
    let vis = null;
    for (const u of player.units) {
      if (u.q === null || u.isFleeing) continue;
      if (u.speedRemaining > 0) {
        if (!strict) { out.push(u.id); continue; }
        vis = vis || this.getVisibleHexes(playerId);
        if (this._canStepSomewhere(playerId, u, vis) || this._canUseUnitAction(playerId, u)) { out.push(u.id); continue; }
      }
      if (!u.hasAttacked) {
        vis = vis || this.getVisibleHexes(playerId);
        if (this._hasTargetInRange(playerId, u, vis)) { out.push(u.id); continue; }
      }
      if (u.isGeneral) {
        const g = GENERALS.find(x => x.id === u.generalId);
        if (!u.hasAttacked && g && player.units.some(t => !t.isGeneral && t.q !== null && t.morale < t.maxMorale && hexDistance(u.q, u.r, t.q, t.r) <= Math.floor(g.charisma / 5))) { out.push(u.id); continue; }
        if (generalAbility(g) && !u.hasUsedAbility && !(u.abilityCooldown > 0)) { out.push(u.id); continue; }
      }
    }
    return out;
  }

  // Remaining speed only counts when it pays for at least one step (same rules as moveUnit)
  _canStepSomewhere(playerId, unit, vis) {
    const blocked = (k) => {
      const occ = this.unitMap[k];
      return !!occ && this.canSee(playerId, occ, occ.q, occ.r, vis);
    };
    const ab = this.ability(unit);
    const transit = ab && ab.type === 'trample' ? blocked : null;
    const table = this.moveTable();
    for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
      const q = unit.q + dq, r = unit.r + dr, k = hexKey(q, r);
      if (!this.hexMap[k] || blocked(k)) continue;
      if (findPathCost(this.hexMap, this.unitMap, unit.q, unit.r, q, r, unit.speedRemaining, unit, this.segmentData, blocked, table, rules.hasFullSpeed(unit), transit) !== null) return true;
    }
    return false;
  }

  // Sabotage / build / vanish still possible this turn
  _canUseUnitAction(playerId, unit) {
    const ab = this.ability(unit);
    if (!ab || unit.speedRemaining < ab.cost) return false;
    if (ab.type === 'ambush') {
      if (unit.vanishedDay === this.dayNumber()) return false;
      return !this.players.some(p => p.id !== playerId && p.units.some(e => e.q !== null && hexDistance(e.q, e.r, unit.q, unit.r) <= ab.range && this.canSee(playerId, e)));
    }
    if (ab.type !== 'sabotage' && ab.type !== 'build') return false;
    for (const [dq, dr] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]) {
      const q = unit.q + dq, r = unit.r + dr, hk = hexKey(q, r);
      if (!this.hexMap[hk]) continue;
      const seg = this.segmentData[segmentEdgeKey(unit.q, unit.r, q, r)] || null;
      if (ab.type === 'sabotage') {
        const opt = rules.sabotageOption(seg, this.terrainData[hk]);
        if (opt && !(opt.target === 'hex' && this.unitMap[hk])) return true;
      } else if (rules.buildOptions(seg, this.terrainData[hk]).some(o => !(o.target === 'hex' && o.id === 'pont' && this.unitMap[hk]))) return true;
    }
    return false;
  }

  canPlayerAct(playerId) {
    return this.unitsAbleToAct(playerId).length > 0;
  }

  _hasTargetInRange(playerId, unit, vis) {
    const hA = this.heightData[hexKey(unit.q, unit.r)] || 0;
    for (const p of this.players) {
      if (p.id === playerId || p.isEliminated) continue;
      for (const t of p.units) {
        if (t.q === null) continue;
        const dist = hexDistance(unit.q, unit.r, t.q, t.r);
        const range = (unit.range || 1) + Math.max(0, hA - (this.heightData[hexKey(t.q, t.r)] || 0));
        if (dist <= range && this.canSee(playerId, t, t.q, t.r, vis)) return true;
      }
    }
    return false;
  }

  endTurn() {
    return this.turns.endTurn(this);
  }

  // Pass the turn if the active player got eliminated during their own turn
  settleTurn() {
    return this.turns.settle(this);
  }

  eliminatePlayer(playerId) {
    const p = this.getPlayer(playerId);
    if (!p || p.isEliminated) return false;
    p.isEliminated = true;
    this._dropObjectives(playerId);
    for (const id of Object.keys(this.pendingAttacks)) {
      const a = this.pendingAttacks[id];
      if (a.attackerPlayerId === playerId || a.targetPlayerId === playerId) delete this.pendingAttacks[id];
    }
    this._checkVictory();
    return true;
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
