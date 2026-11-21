// Transport-agnostic game protocol shared by the local server (server.js) and the AWS lambda (lambda/handler.js).
//
// createProtocol({ store, transport, scheduler, now, config, log })
//   store:     async get(code), create(room) -> bool, update(code, fn) -> room|null, getConn(connId), putConn(connId, rec), deleteConn(connId)
//              update() loads the room, calls fn(room) -> { save, remove } and persists atomically (it may call fn again on conflict).
//   transport: async send(connId, msg) -> false when the connection is gone
//   scheduler: schedule(roomCode, atMs) — optional; wakes the room with tick() for deadlines (lambda processes them lazily)
//
// Inbound messages: { action, ...data }. Outbound: { event, ...data }. Errors: { event: 'error', code, message, action }.
const crypto = require('crypto');
const GameRoom = require('./GameRoom');
const GENERALS = require('./data/generals');
const maps = require('./maps');
const { MODES, isModeAvailable } = require('./turns');
const { hexKey } = require('./HexUtils');
const v = require('./validate');
const { RULES } = require('./rules');
const bots = require('./bots');
const { UNKNOWN, combatView } = require('./views');

const { ProtocolError, fail } = v;

const DEFAULTS = {
  defenseMs: 20000,
  lobbyDropMs: 30000,
  preBattleDropMs: 120000,
  disconnectGraceMs: 60000,
  absentTurnMs: 30000,
  abandonMs: 600000,
  idleRoomMs: 1800000,
  endedRoomMs: 1800000,
  maxPlayers: 8,
  maxSpectators: 16,
  chatHistory: 50,
  botPace: 1,         // multiplier of the bots' pauses between actions (0 = no pause)
  botBurst: 400,      // max bot actions per wake-up (lambda: per incoming message)
  botMaxSteps: 150,   // max actions of a bot in one manche before it ends its turn
};

const PALETTE = ['#4a90d9', '#e05050', '#50c050', '#e0a030', '#a050d0', '#e07840', '#40c0c0', '#e050a0', '#ffffff'];
// Flags (nations) chosen in the lobby; teammates under the same flag get colour variants of it
const FLAG_VARIANTS = {
  qin: ['#1a5fa8', '#4a8fd8', '#0a3578', '#5aaff8'],
  zhao: ['#e07820', '#b05010', '#f0a040', '#804000'],
  wei: ['#1a7a3a', '#3aaa5a', '#0a5020', '#6acc8a'],
  chu: ['#20b8c8', '#1080a0', '#50d8e8', '#008878'],
  yan: ['#c8b84a', '#a89030', '#e8d870', '#786820'],
  qi: ['#e8e8e8', '#b8b8b8', '#f8f8f8', '#d0d0d0'],
  han: ['#9060c0', '#7040a0', '#b080e0', '#502080'],
};
const KINGDOM_FLAG = { QIN: 'qin', ZHAO: 'zhao', WEI: 'wei', CHU: 'chu', YAN: 'yan', QI: 'qi', HAN: 'han' };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFENSE_CHOICES = ['rien', 'counter', 'absorb'];

function randomId(prefix) {
  return prefix + crypto.randomBytes(6).toString('hex');
}

function randomToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function randomRoomCode() {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return code;
}

function tokenMatches(expected, given) {
  if (typeof expected !== 'string' || typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function findMember(room, id) {
  const p = room.players.find(x => x.id === id);
  if (p) return { member: p, role: 'player' };
  const s = (room.spectators || []).find(x => x.id === id);
  if (s) return { member: s, role: 'spectator' };
  return null;
}

function memberByConn(room, connId) {
  if (!connId) return null;
  const p = room.players.find(x => x.connId === connId);
  if (p) return { member: p, role: 'player' };
  const s = (room.spectators || []).find(x => x.connId === connId);
  if (s) return { member: s, role: 'spectator' };
  return null;
}

function createProtocol({ store, transport, scheduler = null, now = Date.now, config = {}, log = console } = {}) {
  const cfg = { ...DEFAULTS, ...config };
  // Bots (game/bots) act through the handlers below with a synthetic connection that receives nothing
  const net = transport;
  transport = { send: (connId, msg) => (bots.isBotConn(connId) ? Promise.resolve(true) : net.send(connId, msg)) };
  const botRunner = bots.createBotRunner({
    store, scheduler, now, cfg, log,
    call: (connId, action, data) => H[action](connId, data),
    reschedule: (code, room) => { const at = nextDeadline(room); if (at != null && scheduler) scheduler.schedule(code, at); },
  });

  // ---------- outbox ----------

  function recipients(room, to) {
    const all = [
      ...room.players.map(m => ({ member: m, role: 'player' })),
      ...(room.spectators || []).map(m => ({ member: m, role: 'spectator' })),
    ];
    if (to === 'all') return all;
    if (to === 'players') return all.filter(r => r.role === 'player');
    if (to === 'spectators') return all.filter(r => r.role === 'spectator');
    if (typeof to === 'function') return all.filter(to);
    const ids = Array.isArray(to) ? to : [to];
    return all.filter(r => ids.includes(r.member.id));
  }

  function emit(tx, to, msg) {
    tx.out.push({ to, msg });
  }

  function emitBuild(tx, to, build) {
    tx.out.push({ to, build });
  }

  function reply(tx, connId, msg) {
    tx.out.push({ conn: connId, msg });
  }

  function lobbyMessage(room) {
    return { event: 'room_update', ...room.getLobbyState(), bots: bots.lobbyInfo(room), tutorial: !!room.tutorial };
  }

  // withTables: include the terrain / segment / stance tables frozen for this battle (start of battle, resync)
  function stateFor(room, r, withTables = false) {
    const phase = room.phase;
    if (phase === 'lobby' || phase === 'army_building') return lobbyMessage(room);
    const tables = withTables && room.balance ? { balanceTables: room.balance } : {};
    if (r.role === 'spectator') return { event: 'game_state', ...room.getSpectatorState(r.member.id), ...tables };
    if (phase === 'deployment') {
      const ds = room.getDeploymentState(r.member.id);
      return ds && { event: 'deployment_state', ...ds };
    }
    const gs = room.getGameState(r.member.id);
    return gs && { event: 'game_state', ...gs, ...tables };
  }

  function emitState(tx, to = 'all', withTables = false) {
    emitBuild(tx, to, r => stateFor(tx.room, r, withTables));
  }

  function emitPresence(tx) {
    const room = tx.room;
    if (room.phase === 'lobby' || room.phase === 'army_building') emit(tx, 'all', lobbyMessage(room));
    else emit(tx, 'all', { event: 'presence', players: room.publicPlayers(), spectators: room.publicSpectators() });
  }

  async function deliver(tx) {
    const room = tx.room;
    const queues = new Map();
    const push = (connId, msg) => {
      if (!connId || !msg) return;
      if (!queues.has(connId)) queues.set(connId, []);
      queues.get(connId).push(msg);
    };
    for (const o of tx.out) {
      if (o.conn) { push(o.conn, o.msg); continue; }
      for (const r of recipients(room, o.to)) {
        if (!r.member.connId || r.member.connected === false) continue;
        push(r.member.connId, o.msg || o.build(r));
      }
    }
    const gone = [];
    await Promise.all([...queues.entries()].map(async ([connId, msgs]) => {
      for (const msg of msgs) {
        let ok = true;
        try { ok = await transport.send(connId, msg); } catch (e) { ok = false; }
        if (ok === false) { gone.push(connId); break; }
      }
    }));
    return gone;
  }

  // ---------- room transactions ----------

  async function withRoom(code, fn) {
    let tx = null;
    const room = await store.update(code, async (r) => {
      tx = { room: r, out: [], dirty: false, deleted: false, error: null, t: now(), after: [] };
      processDeadlines(tx);
      try {
        await fn(tx);
      } catch (e) {
        if (!(e instanceof ProtocolError)) throw e;
        tx.error = e;
      }
      roomEventsFlow(tx);
      if (tx.dirty) r.lastActivity = tx.t;
      return { save: tx.dirty || tx.deleted, remove: tx.deleted };
    });
    if (!room || !tx) fail('room_not_found', 'Salle introuvable.');
    const gone = await deliver(tx);
    for (const fnAfter of tx.after) await fnAfter();
    if (!tx.deleted && scheduler) {
      const at = nextDeadline(tx.room);
      if (at != null) scheduler.schedule(code, at);
    }
    for (const connId of gone) await disconnect(connId);
    if (tx.deleted) botRunner.forget(code);
    else await botRunner.kick(code);
    if (tx.error) throw tx.error;
    return tx;
  }

  function requireMember(tx, connId) {
    const found = memberByConn(tx.room, connId);
    if (!found) fail('not_in_room', 'Vous ne faites pas partie de cette salle.');
    return found;
  }

  function requirePlayer(tx, connId) {
    const found = requireMember(tx, connId);
    if (found.role !== 'player') fail('spectator_read_only', 'Les spectateurs ne peuvent pas agir.');
    return found.member;
  }

  function requireHost(tx, connId) {
    const p = requirePlayer(tx, connId);
    if (tx.room.hostId !== p.id) fail('not_host', 'Seul l\'hôte peut faire cela.');
    return p;
  }

  function requirePhase(tx, ...phases) {
    if (!phases.includes(tx.room.phase)) fail('wrong_phase', 'Action impossible dans cette phase de jeu.');
  }

  function requireTurn(tx, connId) {
    const p = requirePlayer(tx, connId);
    requirePhase(tx, 'battle');
    if (!tx.room.canAct(p.id)) fail('not_your_turn', 'Ce n\'est pas votre tour.');
    if (Object.keys(tx.room.pendingAttacks).length) fail('defense_pending', 'En attente de la réponse du défenseur.');
    return p;
  }

  function engine(result) {
    if (!result) fail('invalid_action', 'Action invalide.');
    if (result.error) fail('rejected', result.error);
    return result;
  }

  function ensureHost(room) {
    if (room.players.some(p => p.id === room.hostId)) return;
    const next = room.players.find(p => !p.isBot && p.connected !== false) || room.players.find(p => !p.isBot) || room.players[0];
    room.hostId = next ? next.id : null;
  }

  function setFlag(room, player, flagId) {
    const teammates = room.players.filter(p => p !== player && p.flag === flagId).length;
    player.flag = flagId;
    player.color = FLAG_VARIANTS[flagId][Math.min(teammates, FLAG_VARIANTS[flagId].length - 1)];
  }

  // Players without a flag get one at the start: their general's kingdom when free (team mode: always), else any free flag
  function assignFlags(room) {
    const team = room.options.teamMode;
    for (const p of room.players) {
      if (p.flag) continue;
      const gd = GENERALS.find(g => g.id === p.generalId);
      const pref = gd ? KINGDOM_FLAG[String(gd.kingdom || '').split('/')[0]] : null;
      const taken = new Set(room.players.filter(o => o.flag).map(o => o.flag));
      const flag = pref && (team || !taken.has(pref)) ? pref : Object.keys(FLAG_VARIANTS).find(f => !taken.has(f));
      if (flag) {
        const color = p.color;
        setFlag(room, p, flag);
        if (color && !team && !room.players.some(o => o !== p && (o.color || '').toLowerCase() === color.toLowerCase())) p.color = color;
      }
    }
  }

  function freeColor(room) {
    const used = new Set(room.players.map(p => (p.color || '').toLowerCase()));
    return PALETTE.find(c => !used.has(c)) || PALETTE[room.players.length % PALETTE.length];
  }

  // ---------- game flows ----------

  function spectatorsLive(room) {
    return room.phase === 'ended' || room.settings.spectatorVision === 'full';
  }

  // Rule events queued by GameRoom (captures, nightfall, ambushes)
  function roomEventsFlow(tx) {
    const room = tx.room;
    for (const e of room.drainEvents()) {
      tx.dirty = true;
      if (e.event === 'ambush') {
        emit(tx, r => (r.role === 'spectator' ? spectatorsLive(room) : (r.member.id === e.playerId || r.member.id === e.byPlayerId)), e);
      } else if (e.event === 'map_edit') {
        const { unitId, playerId, ...pub } = e;
        emitBuild(tx, 'all', (r) => (r.role === 'player' && r.member.id === playerId ? e : pub));
      } else {
        emit(tx, 'all', e);
      }
    }
  }

  // Who saw each side of a pending attack (computed before resolution: dead units leave the board)
  function combatWitnesses(room, pending) {
    const att = room.findUnit(pending.attackerId);
    const tgt = room.findUnit(pending.targetId);
    const seen = {};
    for (const p of room.players) {
      const vis = room.getVisibleHexes(p.id);
      seen[p.id] = {
        seeAttacker: p.id === pending.attackerPlayerId || (!!att && room.canSee(p.id, att, att.q, att.r, vis)),
        seeTarget: p.id === pending.targetPlayerId || (!!tgt && room.canSee(p.id, tgt, tgt.q, tgt.r, vis)),
      };
    }
    return seen;
  }

  function autoEndFlow(tx) {
    const room = tx.room;
    for (let i = 0; i <= room.players.length; i++) {
      if (room.phase !== 'battle' || Object.keys(room.pendingAttacks).length) return;
      const cur = room.getCurrentPlayerId();
      if (!cur || room.canPlayerAct(cur)) return;
      tx.dirty = true;
      emit(tx, 'all', { event: 'turn_auto_ended', playerId: cur, name: room.getPlayer(cur).name, reason: 'no_actions' });
      turnChangeFlow(tx, room.endTurn(), false);
    }
  }

  function startTurnTimer(tx) {
    const room = tx.room;
    const sec = room.settings.turnTimer;
    room.turnEndsAt = room.phase === 'battle' && sec > 0 && !isSimultaneous(room) ? tx.t + sec * 1000 : null;
  }

  function refreshTurnDeadline(tx, ms = cfg.absentTurnMs) {
    const room = tx.room;
    const cur = room.phase === 'battle' ? room.getCurrentPlayerId() : null;
    const p = cur && room.getPlayer(cur);
    room.turnDeadline = p && p.connected === false ? tx.t + ms : null;
  }

  function gameOverMessage(room) {
    return { event: 'game_over', winnerId: room.winner, winnerName: room.getPlayer(room.winner)?.name || null, reason: room.endReason || null, recap: room.getRecap() };
  }

  function gameOverFlow(tx) {
    const room = tx.room;
    if (room.phase !== 'ended' || room.endedAt) return;
    room.endedAt = tx.t;
    room.turnDeadline = null;
    room.turnEndsAt = null;
    emit(tx, 'all', gameOverMessage(room));
  }

  function turnChangeFlow(tx, res, autoEnd = true) {
    const room = tx.room;
    if (room.phase === 'battle') {
      if (res && res.newRound) emit(tx, 'all', { event: 'initiative_rolled', rolls: room.initiativeRolls, turnOrder: room.turnOrder, turn: room.turn });
      startTurnTimer(tx);
      emit(tx, 'all', { event: 'turn_change', currentPlayerId: room.getCurrentPlayerId(), turn: room.turn, manche: room.manche, ...room.timeState(), turnEndsAt: room.turnEndsAt || null });
      room._recordKeyframe();
      // standing march orders go on at the start of their owner's turn
      const cur = room.getCurrentPlayerId();
      const marcher = cur && room.getPlayer(cur);
      if (marcher && marcher.units.some(u => u.march)) {
        for (const mv of room.runMarches(cur)) {
          emitMoveAnim(tx, marcher, mv);
          for (const t of mv.trampledAttacks || []) emitCombatResult(tx, t, t.combatLog, combatWitnesses(room, t));
        }
        tx.dirty = true;
      }
    }
    if (res && res.fled && res.fled.length) {
      const owner = room.getCurrentPlayerId();
      emit(tx, r => (r.role === 'spectator' ? spectatorsLive(room) : r.member.id === owner), { event: 'units_fled', fled: res.fled });
    }
    refreshTurnDeadline(tx);
    gameOverFlow(tx);
    if (autoEnd) autoEndFlow(tx);
  }

  function settleFlow(tx) {
    const res = tx.room.settleTurn();
    if (res) turnChangeFlow(tx, res);
    gameOverFlow(tx);
  }

  function emitCombatResult(tx, pending, log, witnesses) {
    const room = tx.room;
    emitBuild(tx, 'all', (r) => {
      if (r.role === 'spectator') return spectatorsLive(room) ? { event: 'combat_result', combatLog: log } : null;
      const id = r.member.id;
      const w = witnesses[id] || { seeAttacker: false, seeTarget: false };
      if (id === pending.attackerPlayerId) return { event: 'combat_result', combatLog: log };
      if (id === pending.targetPlayerId) return { event: 'combat_result', combatLog: combatView(log, { ...w, seeTarget: true, details: w.seeAttacker }) };
      if (!w.seeAttacker && !w.seeTarget) return null;
      return { event: 'combat_result', combatLog: combatView(log, { ...w, details: false }) };
    });
  }

  function combatFlow(tx, pending, resolved, witnesses) {
    emitCombatResult(tx, pending, resolved.combatLog, witnesses);
    settleFlow(tx);
    autoEndFlow(tx);
    emitState(tx);
  }

  function resolvePending(tx, attackId, choice) {
    const room = tx.room;
    const pending = room.pendingAttacks[attackId];
    const witnesses = pending ? combatWitnesses(room, pending) : {};
    const resolved = room.resolveAttack(attackId, choice);
    tx.dirty = true;
    if (resolved.ok) combatFlow(tx, pending, resolved, witnesses);
    else emitState(tx);
    return resolved;
  }

  // ---------- simultaneous mode (game/turns/simultaneous.js) ----------

  function isSimultaneous(room) {
    return room.mode === 'simultaneous';
  }

  // Opens the planning of room.turn; its timer starts once the playback of the previous resolution is over
  function planningStartFlow(tx, startsAt) {
    const room = tx.room;
    const sim = room.sim || (room.turns.stateFor(room, null), room.sim);
    const sec = room.settings.planningTimer;
    sim.planningStartsAt = startsAt;
    sim.planningEndsAt = sec > 0 ? startsAt + sec * 1000 : null;
    emitBuild(tx, 'all', (r) => {
      const msg = { event: 'planning_start', turn: room.turn, startsAt, endsAt: sim.planningEndsAt, ...room.timeState() };
      if (r.role === 'player') msg.commandPoints = { max: room.turns.commandPoints(room, r.member.id) };
      return msg;
    });
  }

  function commitStatusFlow(tx) {
    emit(tx, 'all', { event: 'commit_status', ...tx.room.turns.commitStatus(tx.room) });
  }

  function maybeResolveFlow(tx, force = false) {
    const room = tx.room;
    if (!isSimultaneous(room) || room.phase !== 'battle' || !room.players.length) return;
    if (!force && room.turns.waiting(room, tx.t, cfg.absentTurnMs).length) return;
    resolveFlow(tx);
  }

  // Resolution message for one recipient (also used on reconnection while the playback runs)
  function resolutionMessage(room, r, t, pb = room.sim && room.sim.playback) {
    if (!pb) return null;
    let view, start;
    if (r.role === 'spectator') {
      if (!spectatorsLive(room)) return null;
      view = pb.full; start = pb.startAll;
    } else {
      view = pb.views[r.member.id]; start = pb.start[r.member.id];
    }
    if (!view) return null;
    return { event: 'resolution', turn: pb.turn, seed: pb.seed, durationMs: pb.endsAt - pb.startedAt, startedAt: pb.startedAt, elapsedMs: Math.max(0, t - pb.startedAt), start: { units: start || [] }, ticks: view.ticks };
  }

  function resolveFlow(tx) {
    const room = tx.room;
    const seed = crypto.randomInt(0x7fffffff);
    const res = room.turns.resolve(room, seed);
    tx.dirty = true;
    log.log && log.log(`[simultaneous] ${room.roomCode} tour ${res.turn} résolu (graine ${seed}, ${res.combats} combats)`);
    // stored for reconnections during the playback: without the roll breakdowns (room size)
    const slim = (view) => ({ ticks: view.ticks.map(tk => ({ t: tk.t, events: tk.events.map(e => (e.log && e.log.breakdown ? { ...e, log: { ...e.log, breakdown: undefined } } : e)) })) });
    const stored = { views: Object.fromEntries(Object.entries(res.views).map(([id, view]) => [id, slim(view)])), full: slim(res.full) };
    room.sim.playback = { turn: res.turn, seed, startedAt: tx.t, endsAt: tx.t + res.durationMs, views: res.views, full: res.full, start: res.start, startAll: res.startAll };
    const live = room.sim.playback;
    emitBuild(tx, 'all', (r) => resolutionMessage(room, r, tx.t, live));
    room.sim.playback = { ...live, ...stored };
    if (room.phase === 'battle') {
      planningStartFlow(tx, tx.t + res.durationMs);
      room._recordKeyframe();
    }
    gameOverFlow(tx);
    emitState(tx);
  }

  function startDeploymentFlow(tx) {
    const room = tx.room;
    room.startDeployment();
    emit(tx, 'all', { event: 'phase_change', phase: 'deployment', mapId: room.mapId });
    emitState(tx);
  }

  function startBattleFlow(tx) {
    const room = tx.room;
    room.startBattle();
    emit(tx, 'all', { event: 'phase_change', phase: 'battle', mapId: room.mapId });
    if (isSimultaneous(room)) {
      planningStartFlow(tx, tx.t);
      emitState(tx, 'all', true);
      return;
    }
    emit(tx, 'all', { event: 'initiative_rolled', rolls: room.initiativeRolls, turnOrder: room.turnOrder, turn: room.turn });
    startTurnTimer(tx);
    refreshTurnDeadline(tx);
    emitState(tx, 'all', true);
  }

  function checkPhaseTransitions(tx) {
    const room = tx.room;
    if (!room.players.length) return;
    if (room.phase === 'army_building' && room.allArmiesSubmitted()) startDeploymentFlow(tx);
    else if (room.phase === 'deployment' && room.allDeployed()) startBattleFlow(tx);
  }

  function removePlayerFlow(tx, p, reason) {
    const room = tx.room;
    room.removePlayer(p.id);
    if (p.connId) tx.after.push(() => store.deleteConn(p.connId));
    emit(tx, 'all', { event: 'player_left', playerId: p.id, name: p.name, reason });
    ensureHost(room);
    if (!room.players.some(p => !p.isBot)) { tx.deleted = true; return; }
    emitPresence(tx);
    checkPhaseTransitions(tx);
  }

  function abandonFlow(tx, p, reason) {
    const room = tx.room;
    if (!room.eliminatePlayer(p.id)) return;
    emit(tx, 'all', { event: 'player_left', playerId: p.id, name: p.name, reason });
    settleFlow(tx);
    if (isSimultaneous(room) && room.phase === 'battle') { commitStatusFlow(tx); maybeResolveFlow(tx); }
    emitState(tx);
  }

  function processDeadlines(tx) {
    const room = tx.room;
    const t = tx.t;
    for (const [attackId, a] of Object.entries(room.pendingAttacks || {})) {
      if (a.expiresAt && a.expiresAt <= t) resolvePending(tx, attackId, 'rien');
    }
    for (const p of [...room.players]) {
      if (p.connected !== false || !p.disconnectedAt) continue;
      const gone = t - p.disconnectedAt;
      if (room.phase === 'lobby' && gone >= cfg.lobbyDropMs) { tx.dirty = true; removePlayerFlow(tx, p, 'timeout'); }
      else if ((room.phase === 'army_building' || room.phase === 'deployment') && gone >= cfg.preBattleDropMs) { tx.dirty = true; removePlayerFlow(tx, p, 'timeout'); }
      else if (room.phase === 'battle' && !p.isEliminated && gone >= cfg.abandonMs) { tx.dirty = true; abandonFlow(tx, p, 'abandon'); }
    }
    if (tx.deleted) return;
    const staleSpectators = (room.spectators || []).filter(s => s.connected === false && t - (s.disconnectedAt || 0) >= cfg.lobbyDropMs);
    if (staleSpectators.length) {
      room.spectators = room.spectators.filter(s => !staleSpectators.includes(s));
      tx.dirty = true;
      emitPresence(tx);
    }
    if (room.phase === 'battle' && room.turnDeadline && room.turnDeadline <= t) {
      tx.dirty = true;
      const cur = room.getPlayer(room.getCurrentPlayerId());
      if (cur && cur.connected === false && !Object.keys(room.pendingAttacks).length) {
        emit(tx, 'all', { event: 'turn_auto_ended', playerId: cur.id, name: cur.name, reason: 'absent' });
        turnChangeFlow(tx, room.endTurn());
        emitState(tx);
      } else {
        refreshTurnDeadline(tx);
      }
    }
    if (room.phase === 'battle' && room.turnEndsAt && room.turnEndsAt <= t && !Object.keys(room.pendingAttacks).length) {
      tx.dirty = true;
      const cur = room.getPlayer(room.getCurrentPlayerId());
      if (cur) emit(tx, 'all', { event: 'turn_auto_ended', playerId: cur.id, name: cur.name, reason: 'timer' });
      turnChangeFlow(tx, room.endTurn());
      emitState(tx);
    }
    if (isSimultaneous(room) && room.phase === 'battle' && room.sim) {
      if (room.sim.planningEndsAt && room.sim.planningEndsAt <= t) {
        emit(tx, 'all', { event: 'planning_timeout', turn: room.turn });
        resolveFlow(tx);
      } else maybeResolveFlow(tx);
    }
    const anyConnected = room.players.some(p => !p.isBot && p.connected !== false) || (room.spectators || []).some(s => s.connected !== false);
    if (room.phase === 'ended' && room.endedAt && t - room.endedAt >= cfg.endedRoomMs) tx.deleted = true;
    if (!anyConnected && t - (room.lastActivity || t) >= cfg.idleRoomMs) tx.deleted = true;
  }

  function nextDeadline(room) {
    const times = [];
    for (const a of Object.values(room.pendingAttacks || {})) if (a.expiresAt) times.push(a.expiresAt);
    if (room.phase === 'battle' && room.turnDeadline) times.push(room.turnDeadline);
    if (room.phase === 'battle' && room.turnEndsAt) times.push(room.turnEndsAt);
    if (room.phase === 'battle' && room.mode === 'simultaneous' && room.sim) {
      if (room.sim.planningEndsAt) times.push(room.sim.planningEndsAt);
      for (const p of room.players) {
        const at = room.turns.absentReadyAt(room, p, cfg.absentTurnMs);
        if (at != null && at > now()) times.push(at);
      }
    }
    const dropMs = room.phase === 'lobby' ? cfg.lobbyDropMs
      : (room.phase === 'army_building' || room.phase === 'deployment') ? cfg.preBattleDropMs
        : room.phase === 'battle' ? cfg.abandonMs : null;
    for (const p of room.players) {
      if (p.connected === false && p.disconnectedAt && dropMs != null && !p.isEliminated) times.push(p.disconnectedAt + dropMs);
    }
    for (const s of room.spectators || []) if (s.connected === false && s.disconnectedAt) times.push(s.disconnectedAt + cfg.lobbyDropMs);
    if (room.phase === 'ended' && room.endedAt) times.push(room.endedAt + cfg.endedRoomMs);
    const anyConnected = room.players.some(p => !p.isBot && p.connected !== false) || (room.spectators || []).some(s => s.connected !== false);
    if (!anyConnected) times.push((room.lastActivity || now()) + cfg.idleRoomMs);
    const botAt = botRunner.wakeAt(room.roomCode);
    if (botAt != null) times.push(botAt);
    return times.length ? Math.min(...times) : null;
  }

  // ---------- session helpers ----------

  function sessionMessage(room, m, role) {
    return { event: 'session', roomCode: room.roomCode, playerId: m.id, token: m.token, role, name: m.name };
  }

  function resync(tx, connId, found) {
    const room = tx.room;
    const { member, role } = found;
    reply(tx, connId, sessionMessage(room, member, role));
    reply(tx, connId, lobbyMessage(room));
    if (room.phase !== 'lobby' && room.phase !== 'army_building') {
      reply(tx, connId, stateFor(room, found, true));
    }
    if (room.phase === 'army_building' && role === 'player') {
      reply(tx, connId, { event: 'phase_change', phase: 'army_building', budget: room.budget, armySubmitted: !!member.isReady });
    }
    if (room.chat && room.chat.length) reply(tx, connId, { event: 'chat_history', messages: room.chat });
    if (room.phase === 'battle') {
      for (const [attackId, a] of Object.entries(room.pendingAttacks)) {
        const seconds = Math.max(1, Math.ceil(((a.expiresAt || tx.t) - tx.t) / 1000));
        if (a.targetPlayerId === member.id) reply(tx, connId, defenseRequest(room, attackId, a, seconds));
        if (a.attackerPlayerId === member.id) reply(tx, connId, { event: 'waiting_defense', attackId, seconds });
      }
    }
    if (room.phase === 'battle' && isSimultaneous(room) && room.sim && room.sim.playback && tx.t < room.sim.playback.endsAt) {
      reply(tx, connId, resolutionMessage(room, found, tx.t));
    }
    if (room.phase === 'ended') reply(tx, connId, gameOverMessage(room));
  }

  // Responses the defender may pick: shots can only be blocked by a unit with the defend_ranged ability (phalange)
  function defenseOptions(room, a) {
    if (!a.isRanged) return ['counter', 'absorb', 'rien'];
    const target = room.findUnit(a.targetId);
    const ab = target ? room.ability(target) : null;
    return ab && ab.type === 'defend_ranged' && !RULES.combat.archerTypes.includes(a.attackerTypeId) ? ['absorb', 'rien'] : ['rien'];
  }

  function defenseRequest(room, attackId, a, seconds) {
    const att = room.findUnit(a.attackerId);
    const seen = !!att && room.canSee(a.targetPlayerId, att);
    return {
      event: 'defense_request', attackId, roomCode: room.roomCode,
      attackerName: seen ? a.attackerName : UNKNOWN, attackerId: seen ? a.attackerId : null, targetName: a.targetName, targetId: a.targetId,
      targetQ: a.targetQ, targetR: a.targetR, isRanged: a.isRanged, targetTypeId: a.targetTypeId,
      seconds, expiresAt: a.expiresAt, options: defenseOptions(room, a),
    };
  }

  async function bindConn(connId, roomCode, memberId) {
    const prev = await store.getConn(connId);
    if (prev && prev.roomCode && (prev.roomCode !== roomCode || prev.memberId !== memberId)) {
      await detach(prev.roomCode, connId, prev.memberId);
    }
    await store.putConn(connId, { roomCode, memberId });
  }

  async function detach(roomCode, connId, memberId) {
    try {
      await withRoom(roomCode, (tx) => markDisconnected(tx, connId, memberId));
    } catch (e) {
      if (!(e instanceof ProtocolError)) throw e;
    }
  }

  function markDisconnected(tx, connId, memberId) {
    const found = memberId ? findMember(tx.room, memberId) : memberByConn(tx.room, connId);
    if (!found || found.member.connId !== connId) return;
    const m = found.member;
    m.connId = null;
    m.connected = false;
    m.disconnectedAt = tx.t;
    tx.dirty = true;
    const room = tx.room;
    if (found.role === 'player' && room.phase === 'battle' && room.getCurrentPlayerId() === m.id) {
      room.turnDeadline = tx.t + cfg.disconnectGraceMs;
    }
    emit(tx, 'all', { event: 'player_disconnected', playerId: m.id, name: m.name, role: found.role });
    emitPresence(tx);
  }

  // ---------- handlers ----------

  const H = {};

  H.list_maps = async (connId) => {
    await transport.send(connId, { event: 'maps_list', maps: maps.listMaps().map(m => ({ id: m.id, name: m.name, description: m.description, hexCount: m.hexCount })), modes: MODES });
  };

  H.create_room = async (connId, data) => {
    const name = v.name(data.playerName);
    const mapId = typeof data.mapId === 'string' && maps.mapExists(data.mapId) ? data.mapId : 'default';
    // the client asks for its default turn mode (simultaneous in the lobby and solo); without it, sequential
    const mode = isModeAvailable(data.mode) ? data.mode : 'sequential';
    const playerId = randomId('p_');
    const token = randomToken();
    let room = null;
    for (let i = 0; i < 20 && !room; i++) {
      const candidate = new GameRoom(randomRoomCode(), playerId, { mapId, record: true, mode });
      candidate.addPlayer(playerId, name, { token, connId, connected: true, color: PALETTE[0] });
      candidate.createdAt = candidate.lastActivity = now();
      if (await store.create(candidate)) room = candidate;
    }
    if (!room) fail('server_busy', 'Impossible de créer une salle, réessayez.');
    await bindConn(connId, room.roomCode, playerId);
    const found = { member: room.getPlayer(playerId), role: 'player' };
    await transport.send(connId, sessionMessage(room, found.member, 'player'));
    await transport.send(connId, { event: 'room_created', roomCode: room.roomCode, playerId });
    await transport.send(connId, lobbyMessage(room));
    if (scheduler) {
      const at = nextDeadline(room);
      if (at != null) scheduler.schedule(room.roomCode, at);
    }
    return room.roomCode;
  };

  H.join_room = async (connId, data) => {
    const code = v.roomCode(data.roomCode);
    const name = v.name(data.playerName);
    const asSpectator = data.spectator === true || data.role === 'spectator';
    let joined = null;
    await withRoom(code, (tx) => {
      const room = tx.room;
      const id = randomId(asSpectator ? 's_' : 'p_');
      const token = randomToken();
      if (asSpectator) {
        if (room.spectators.length >= cfg.maxSpectators) fail('room_full', 'Trop de spectateurs dans cette salle.');
        room.spectators.push({ id, name, token, connId, connected: true, disconnectedAt: null });
        joined = { member: room.spectators[room.spectators.length - 1], role: 'spectator' };
      } else {
        if (room.phase !== 'lobby') fail('game_started', 'La partie a déjà commencé. Vous pouvez la regarder en spectateur.');
        if (room.players.length >= cfg.maxPlayers) fail('room_full', `La salle est pleine (${cfg.maxPlayers} joueurs max).`);
        room.addPlayer(id, name, { token, connId, connected: true, color: freeColor(room) });
        joined = { member: room.getPlayer(id), role: 'player' };
      }
      tx.dirty = true;
      reply(tx, connId, { event: 'room_joined', roomCode: code, playerId: id, role: joined.role });
      resync(tx, connId, joined);
      emit(tx, r => r.member.id !== id, asSpectator ? { event: 'spectator_joined', spectatorId: id, name } : { event: 'player_joined', playerId: id, name });
      emitPresence(tx);
    });
    await bindConn(connId, code, joined.member.id);
  };

  H.spectate_room = (connId, data) => H.join_room(connId, { ...data, spectator: true });

  H.rejoin_game = async (connId, data) => {
    const code = v.roomCode(data.roomCode);
    const memberId = v.id(data.playerId, 'rejoin_failed', 'Session invalide.');
    let found = null;
    await withRoom(code, (tx) => {
      const room = tx.room;
      found = findMember(room, memberId);
      if (!found || !tokenMatches(found.member.token, data.token)) fail('rejoin_failed', 'Session expirée ou invalide.');
      const m = found.member;
      const old = m.connId;
      const wasOffline = m.connected === false;
      if (old && old !== connId) {
        reply(tx, old, { event: 'session_replaced', message: 'Votre session a été ouverte ailleurs.' });
        tx.after.push(() => store.deleteConn(old));
      }
      m.connId = connId;
      m.connected = true;
      m.disconnectedAt = null;
      tx.dirty = true;
      if (found.role === 'player' && room.phase === 'battle' && room.getCurrentPlayerId() === m.id) room.turnDeadline = null;
      resync(tx, connId, found);
      if (wasOffline) emit(tx, r => r.member.id !== m.id, { event: 'player_reconnected', playerId: m.id, name: m.name, role: found.role });
      emitPresence(tx);
    });
    await bindConn(connId, code, memberId);
  };

  H.get_state = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    resync(tx, connId, requireMember(tx, connId));
  });

  H.leave_room = async (connId, data) => {
    const code = v.roomCode(data.roomCode);
    await withRoom(code, (tx) => {
      const room = tx.room;
      const found = requireMember(tx, connId);
      const m = found.member;
      tx.dirty = true;
      reply(tx, connId, { event: 'left_room', roomCode: code });
      if (found.role === 'spectator') {
        room.spectators = room.spectators.filter(s => s !== m);
        emitPresence(tx);
      } else if (room.phase === 'lobby' || room.phase === 'army_building' || room.phase === 'deployment') {
        removePlayerFlow(tx, m, 'left');
      } else {
        m.connId = null;
        m.connected = false;
        m.disconnectedAt = tx.t;
        if (room.phase === 'battle') abandonFlow(tx, m, 'left');
        emitPresence(tx);
      }
    });
    await store.deleteConn(connId);
  };

  H.set_budget = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    requireHost(tx, connId);
    requirePhase(tx, 'lobby', 'army_building');
    const b = v.int(typeof data.budget === 'number' ? Math.round(data.budget) : data.budget, 1000, 100000, 'invalid_budget', 'Budget invalide (1000 à 100000).');
    tx.room.budget = Math.max(1000, Math.round(b / 100) * 100);
    tx.dirty = true;
    emit(tx, 'all', lobbyMessage(tx.room));
  });

  H.set_map = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    requireHost(tx, connId);
    requirePhase(tx, 'lobby');
    engine(tx.room.setMap(v.id(data.mapId, 'invalid_map', 'Carte invalide.')));
    tx.dirty = true;
    emit(tx, 'all', lobbyMessage(tx.room));
  });

  H.set_mode = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    requireHost(tx, connId);
    requirePhase(tx, 'lobby');
    if (!isModeAvailable(data.mode)) fail('invalid_mode', 'Ce mode de jeu n\'est pas encore disponible.');
    tx.room.mode = data.mode;
    tx.dirty = true;
    emit(tx, 'all', lobbyMessage(tx.room));
  });

  H.set_settings = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    requireHost(tx, connId);
    requirePhase(tx, 'lobby');
    if (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings)) fail('invalid_settings', 'Paramètres invalides.');
    engine(tx.room.setSettings(data.settings));
    tx.dirty = true;
    emit(tx, 'all', lobbyMessage(tx.room));
  });

  H.set_player_color = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requirePlayer(tx, connId);
    requirePhase(tx, 'lobby');
    const color = v.color(data.color);
    if (tx.room.players.some(o => o !== p && (o.color || '').toLowerCase() === color)) fail('color_taken', 'Cette couleur est déjà prise.');
    p.color = color;
    tx.dirty = true;
    emit(tx, 'all', lobbyMessage(tx.room));
  });

  H.set_player_flag = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requirePlayer(tx, connId);
    requirePhase(tx, 'lobby');
    const flagId = v.oneOf(data.flagId, Object.keys(FLAG_VARIANTS), 'invalid_flag', 'Drapeau inconnu.');
    if (!tx.room.options.teamMode && tx.room.players.some(o => o !== p && o.flag === flagId)) fail('flag_taken', 'Ce drapeau est déjà pris.');
    setFlag(tx.room, p, flagId);
    tx.dirty = true;
    emit(tx, 'all', lobbyMessage(tx.room));
  });

  // set_option { key, value }: lobby options of the host (teamMode)
  H.set_option = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    requireHost(tx, connId);
    requirePhase(tx, 'lobby');
    if (data.key !== 'teamMode') fail('invalid_option', 'Option inconnue.');
    engine(tx.room.setSettings({ teamMode: !!data.value }));
    tx.dirty = true;
    emit(tx, 'all', lobbyMessage(tx.room));
  });

  // lobby_ready: a player toggles "ready" (general + flag chosen); when every human is ready the game starts
  H.lobby_ready = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requirePlayer(tx, connId);
    requirePhase(tx, 'lobby');
    const room = tx.room;
    if (!p.generalId) fail('general_missing', 'Choisissez un général avant de vous préparer.');
    if (!p.flag) fail('flag_missing', 'Choisissez un drapeau avant de vous préparer.');
    p.isReady = !p.isReady;
    tx.dirty = true;
    const humans = room.players.filter(x => !x.isBot);
    if (humans.length && humans.every(x => x.isReady) && room.players.every(x => x.generalId)) {
      assignFlags(room);
      room.startGame();
      emit(tx, 'all', { event: 'phase_change', phase: 'army_building', budget: room.budget, mapId: room.mapId });
    }
    emit(tx, 'all', lobbyMessage(room));
  });

  // back_to_lobby: the host goes back from army building (armies are cleared)
  H.back_to_lobby = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    requireHost(tx, connId);
    requirePhase(tx, 'army_building');
    const room = tx.room;
    room.phase = 'lobby';
    for (const p of room.players) { p.units = []; p.generalUnit = null; p.armySubmitted = false; p.isReady = !!p.isBot; }
    tx.dirty = true;
    emit(tx, 'all', { event: 'phase_change', phase: 'lobby', mapId: room.mapId });
    emit(tx, 'all', lobbyMessage(room));
  });

  H.select_general = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requirePlayer(tx, connId);
    requirePhase(tx, 'lobby');
    const generalId = data.generalId;
    if (!GENERALS.some(g => g.id === generalId)) fail('invalid_general', 'Général inconnu.');
    if (tx.room.players.some(o => o !== p && o.generalId === generalId)) fail('general_taken', 'Ce général est déjà pris.');
    p.generalId = generalId;
    tx.dirty = true;
    emit(tx, 'all', lobbyMessage(tx.room));
  });

  H.start_game = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    requireHost(tx, connId);
    requirePhase(tx, 'lobby');
    const room = tx.room;
    if (room.players.length < 1) fail('not_enough_players', 'Il faut au moins 1 joueur.');
    if (room.players.some(p => !p.generalId)) fail('generals_missing', 'Tous les joueurs doivent choisir un général.');
    assignFlags(room);
    room.startGame();
    tx.dirty = true;
    emit(tx, 'all', { event: 'phase_change', phase: 'army_building', budget: room.budget, mapId: room.mapId });
    emit(tx, 'all', lobbyMessage(room));
  });

  // ---------- bots (game/bots) ----------

  H.add_bot = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    requireHost(tx, connId);
    requirePhase(tx, 'lobby');
    const room = tx.room;
    if (room.players.length >= cfg.maxPlayers) fail('room_full', `La salle est pleine (${cfg.maxPlayers} joueurs max).`);
    const difficulty = data.difficulty == null ? 'veteran' : v.oneOf(data.difficulty, bots.DIFFICULTIES, 'invalid_difficulty', 'Difficulté inconnue.');
    const generalId = data.generalId == null || data.generalId === '' ? null : v.id(data.generalId, 'invalid_general', 'Général inconnu.');
    const { bot } = engine(bots.addBot(room, { id: randomId('b_'), difficulty, generalId, color: freeColor(room) }));
    if (data.flagId != null && data.flagId !== '') {
      const flagId = v.oneOf(data.flagId, Object.keys(FLAG_VARIANTS), 'invalid_flag', 'Drapeau inconnu.');
      if (room.options.teamMode || !room.players.some(o => o !== bot && o.flag === flagId)) setFlag(room, bot, flagId);
    }
    tx.dirty = true;
    emit(tx, 'all', { event: 'player_joined', playerId: bot.id, name: bot.name, isBot: true });
    emit(tx, 'all', lobbyMessage(room));
  });

  H.add_ai = (connId, data) => H.add_bot(connId, data);

  // Host changes the general of one of the room's AIs (lobby only)
  H.set_bot_general = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    requireHost(tx, connId);
    requirePhase(tx, 'lobby');
    const room = tx.room;
    const bot = room.getPlayer(v.id(data.playerId));
    if (!bot || !bot.isBot) fail('bot_not_found', 'IA introuvable.');
    const general = GENERALS.find(g => g.id === data.generalId);
    if (!general) fail('invalid_general', 'Général inconnu.');
    if (room.players.some(o => o !== bot && o.generalId === general.id)) fail('general_taken', 'Ce général est déjà pris.');
    bot.generalId = general.id;
    bot.name = `${general.name} (IA)`;
    tx.dirty = true;
    emit(tx, 'all', lobbyMessage(room));
  });

  H.remove_bot = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    requireHost(tx, connId);
    requirePhase(tx, 'lobby');
    const bot = tx.room.getPlayer(v.id(data.playerId != null ? data.playerId : data.botId));
    if (!bot || !bot.isBot) fail('bot_not_found', 'IA introuvable.');
    tx.dirty = true;
    removePlayerFlow(tx, bot, 'left');
  });

  // "Jouer en solo": a room with one bot, straight to army building
  H.create_solo = async (connId, data) => {
    v.name(data.playerName);
    const difficulty = data.difficulty == null ? 'veteran' : v.oneOf(data.difficulty, bots.DIFFICULTIES, 'invalid_difficulty', 'Difficulté inconnue.');
    const generalId = data.generalId == null || data.generalId === '' ? null : v.oneOf(data.generalId, GENERALS.map(g => g.id), 'invalid_general', 'Général inconnu.');
    const code = await H.create_room(connId, { playerName: data.playerName, mapId: data.mapId, mode: data.mode });
    await withRoom(code, (tx) => {
      const room = tx.room;
      const host = room.getPlayer(room.hostId);
      host.generalId = generalId || GENERALS[crypto.randomInt(GENERALS.length)].id;
      engine(bots.addBot(room, { id: randomId('b_'), difficulty, color: freeColor(room) }));
      assignFlags(room);
      room.startGame();
      tx.dirty = true;
      emit(tx, 'all', { event: 'phase_change', phase: 'army_building', budget: room.budget, mapId: room.mapId });
      emit(tx, 'all', lobbyMessage(room));
    });
  };

  // Tutorial: scripted solo battle (game/bots/tutorial.js), straight to the battle
  H.start_tutorial = async (connId, data) => {
    const playerName = data.playerName == null || data.playerName === '' ? 'Recrue' : data.playerName;
    v.name(playerName);
    const code = await H.create_room(connId, { playerName, mapId: bots.TUTORIAL.mapId });
    await withRoom(code, (tx) => {
      const room = tx.room;
      engine(bots.setupTutorial(room, { botId: randomId('b_'), botColor: freeColor(room) }));
      tx.dirty = true;
      emit(tx, 'all', lobbyMessage(room));
      emit(tx, 'all', { event: 'phase_change', phase: 'battle', mapId: room.mapId });
      startTurnTimer(tx);
      refreshTurnDeadline(tx);
      emitState(tx, 'all', true);
    });
  };

  H.submit_army = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requirePlayer(tx, connId);
    requirePhase(tx, 'army_building');
    if (!Array.isArray(data.units) || data.units.length > 40) fail('invalid_army', 'Armée invalide.');
    const units = data.units.map(u => ({ typeId: u && u.typeId, count: u && u.count }));
    engine(tx.room.submitArmy(p.id, units));
    tx.dirty = true;
    reply(tx, connId, { event: 'army_accepted' });
    emit(tx, 'all', lobbyMessage(tx.room));
    checkPhaseTransitions(tx);
  });

  H.place_unit = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requirePlayer(tx, connId);
    requirePhase(tx, 'deployment');
    engine(tx.room.placeUnit(p.id, v.id(data.unitId), v.int(data.q, -10000, 10000), v.int(data.r, -10000, 10000)));
    tx.dirty = true;
    emitState(tx, [p.id]);
    emitState(tx, 'spectators');
  });

  H.deployment_ready = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requirePlayer(tx, connId);
    requirePhase(tx, 'deployment');
    const room = tx.room;
    if (p.isReady) fail('already_ready', 'Vous êtes déjà prêt.');
    engine(room.setDeploymentReady(p.id));
    tx.dirty = true;
    const readyIds = room.players.filter(x => x.isReady).map(x => x.id);
    emit(tx, 'all', { event: 'deployment_ready_update', readyCount: readyIds.length, total: room.players.length, readyIds });
    checkPhaseTransitions(tx);
  });

  // Move animation: full path for the mover (and live spectators), the part each opponent sees otherwise
  function emitMoveAnim(tx, p, result) {
    const room = tx.room;
    const full = [[result.fromQ, result.fromR], ...result.path];
    const anim = { event: 'unit_move_anim', unitId: result.unitId, fromQ: result.fromQ, fromR: result.fromR, path: result.path, ambush: !!result.ambush };
    const unit = room.findUnit(result.unitId);
    emitBuild(tx, 'all', (r) => {
      if (r.member.id === p.id) return anim;
      if (r.role === 'spectator') return spectatorsLive(room) ? anim : null;
      const vis = room.getVisibleHexes(r.member.id);
      const seen = full.map(([q, rr]) => room.canSee(r.member.id, unit, q, rr, vis));
      if (!seen[seen.length - 1]) return null;
      const i = seen.indexOf(true);
      return { ...anim, ambush: undefined, fromQ: full[i][0], fromR: full[i][1], path: full.slice(i + 1).filter((_, j) => seen[i + 1 + j]) };
    });
  }

  // move_unit { unitId, targetQ, targetR, path?, march? }: with march, path is the whole route to a destination beyond
  // this turn's reach — the unit walks what it can now and goes on by itself at the start of its next turns
  H.move_unit = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requireTurn(tx, connId);
    const room = tx.room;
    if (data.march === true) {
      const res = engine(room.marchUnit(p.id, v.id(data.unitId), v.path(data.path, 200)));
      tx.dirty = true;
      if (res.move) {
        emitMoveAnim(tx, p, res.move);
        if (res.move.trampledAttacks && res.move.trampledAttacks.length) {
          for (const t of res.move.trampledAttacks) emitCombatResult(tx, t, t.combatLog, combatWitnesses(room, t));
          settleFlow(tx);
        }
      }
      autoEndFlow(tx);
      emitState(tx);
      return;
    }
    const route = data.path != null ? v.path(data.path) : null;
    const result = engine(room.moveUnit(p.id, v.id(data.unitId), v.int(data.targetQ, -10000, 10000), v.int(data.targetR, -10000, 10000), route));
    tx.dirty = true;
    emitMoveAnim(tx, p, result);
    if (result.trampledAttacks && result.trampledAttacks.length) {
      for (const t of result.trampledAttacks) emitCombatResult(tx, t, t.combatLog, combatWitnesses(room, t));
      settleFlow(tx);
    }
    autoEndFlow(tx);
    emitState(tx);
  });

  // cancel_march { unitId }: drops a standing march order (any phase of the battle, the owner only)
  H.cancel_march = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const room = tx.room;
    const me = requirePlayer(tx, connId);
    requirePhase(tx, 'battle');
    engine(room.cancelMarch(me.id, v.id(data.unitId)));
    tx.dirty = true;
    emitState(tx);
  });

  // attack_unit { attackerId, targetId, approachQ?, approachR?, path? }: with an approach hex, the unit walks there
  // (along path when the player chose the route) and
  // strikes in the same action (nothing happens if the target would not be in range from it)
  H.attack_unit = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requireTurn(tx, connId);
    const room = tx.room;
    let result;
    if (data.approachQ != null || data.approachR != null) {
      const route = data.path != null ? v.path(data.path) : null;
      const both = engine(room.moveAndAttack(p.id, v.id(data.attackerId), v.id(data.targetId), v.int(data.approachQ, -10000, 10000), v.int(data.approachR, -10000, 10000), route));
      tx.dirty = true;
      if (both.move) emitMoveAnim(tx, p, both.move);
      if (both.move && both.move.trampledAttacks) for (const t of both.move.trampledAttacks) emitCombatResult(tx, t, t.combatLog, combatWitnesses(room, t));
      if (!both.attack || both.attack.error) {
        if (both.attack && both.attack.error) reply(tx, connId, { event: 'error', code: 'attack_failed', message: both.attack.error });
        autoEndFlow(tx);
        emitState(tx);
        return;
      }
      result = both.attack;
    } else {
      result = engine(room.initiateCombat(p.id, v.id(data.attackerId), v.id(data.targetId)));
    }
    tx.dirty = true;
    const pending = room.pendingAttacks[result.attackId];
    if (pending.duel) {
      emit(tx, [result.targetPlayerId], { event: 'duel_challenge', attackId: result.attackId, attackerName: result.attackerName, targetName: result.targetName });
      resolvePending(tx, result.attackId, 'duel');
      return;
    }
    if (defenseOptions(room, { ...pending, targetId: result.targetId || pending.targetId }).length === 1) {
      // Nothing to choose (a shot the target cannot block): resolve now instead of asking the defender
      resolvePending(tx, result.attackId, 'rien');
      return;
    }
    pending.expiresAt = tx.t + cfg.defenseMs;
    const seconds = Math.round(cfg.defenseMs / 1000);
    emit(tx, [result.targetPlayerId], defenseRequest(room, result.attackId, pending, seconds));
    emit(tx, [result.targetPlayerId], { event: 'defense_timer', attackId: result.attackId, seconds });
    reply(tx, connId, { event: 'waiting_defense', attackId: result.attackId, seconds });
    emitState(tx, [p.id]);
  });

  H.defend_choice = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requirePlayer(tx, connId);
    const attackId = v.id(data.attackId);
    const pending = tx.room.pendingAttacks[attackId];
    if (!pending) fail('attack_not_found', 'Attaque introuvable ou déjà résolue.');
    if (pending.targetPlayerId !== p.id) fail('not_defender', 'Vous n\'êtes pas le défenseur.');
    const choice = data.choice == null ? 'rien' : v.oneOf(data.choice, DEFENSE_CHOICES, 'invalid_choice', 'Choix de défense invalide.');
    resolvePending(tx, attackId, choice);
  });

  H.rotate_facing = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requireTurn(tx, connId);
    engine(tx.room.rotateFacing(p.id, v.id(data.unitId), v.int(data.facing, 0, 5, 'invalid_facing', 'Orientation invalide.')));
    tx.dirty = true;
    autoEndFlow(tx);
    emitState(tx);
  });

  H.change_stance = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requireTurn(tx, connId);
    engine(tx.room.changeStance(p.id, v.id(data.unitId), v.id(data.stanceId)));
    tx.dirty = true;
    autoEndFlow(tx);
    emitState(tx);
  });

  H.motivate_unit = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requireTurn(tx, connId);
    const result = engine(tx.room.motivateUnit(p.id, v.id(data.generalId)));
    tx.dirty = true;
    reply(tx, connId, { event: 'motivate_result', ...result });
    autoEndFlow(tx);
    emitState(tx);
  });

  H.use_ability = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requireTurn(tx, connId);
    const targetId = data.targetId == null ? null : v.id(data.targetId);
    const result = engine(tx.room.useGeneralAbility(p.id, null, targetId));
    tx.dirty = true;
    const log = result.combatLog;
    const publicLog = { abilityUsed: log.abilityUsed, generalId: log.generalId, playerId: log.playerId, targetPlayerId: log.targetPlayerId, effects: log.effects };
    emitBuild(tx, 'all', (r) => {
      if (r.member.id === p.id) return { event: 'combat_result', combatLog: log };
      if (r.role === 'spectator' && !spectatorsLive(tx.room)) return null;
      return { event: 'combat_result', combatLog: publicLog };
    });
    autoEndFlow(tx);
    emitState(tx);
  });

  // Unit abilities that act on the map or on the unit itself (espion, bâtisseurs, assassin)
  H.unit_sabotage = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requireTurn(tx, connId);
    engine(tx.room.sabotage(p.id, v.id(data.unitId), v.int(data.q, -10000, 10000), v.int(data.r, -10000, 10000)));
    tx.dirty = true;
    roomEventsFlow(tx);
    autoEndFlow(tx);
    emitState(tx);
  });

  H.unit_build = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requireTurn(tx, connId);
    const kind = v.oneOf(data.kind, Object.keys(RULES.abilities.build_kinds), 'invalid_kind', 'Construction inconnue.');
    engine(tx.room.build(p.id, v.id(data.unitId), v.int(data.q, -10000, 10000), v.int(data.r, -10000, 10000), kind));
    tx.dirty = true;
    roomEventsFlow(tx);
    autoEndFlow(tx);
    emitState(tx);
  });

  // Friend's build_segment { unitId, neighborQ, neighborR }: ladder on a cliff, chevaux de frise on an empty edge
  H.build_segment = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requireTurn(tx, connId);
    engine(tx.room.buildSegment(p.id, v.id(data.unitId), v.int(data.neighborQ, -10000, 10000), v.int(data.neighborR, -10000, 10000)));
    tx.dirty = true;
    roomEventsFlow(tx);
    autoEndFlow(tx);
    emitState(tx);
  });

  H.unit_vanish = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requireTurn(tx, connId);
    engine(tx.room.vanish(p.id, v.id(data.unitId)));
    tx.dirty = true;
    autoEndFlow(tx);
    emitState(tx);
  });

  H.end_turn = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    requireTurn(tx, connId);
    tx.dirty = true;
    turnChangeFlow(tx, tx.room.endTurn());
    emitState(tx);
  });

  function requirePlanning(tx, connId) {
    const p = requirePlayer(tx, connId);
    requirePhase(tx, 'battle');
    if (!isSimultaneous(tx.room)) fail('wrong_mode', 'Action réservée au mode simultané.');
    if (p.isEliminated) fail('eliminated', 'Vous êtes éliminé.');
    return p;
  }

  H.set_orders = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requirePlanning(tx, connId);
    const room = tx.room;
    if (data.turn != null && data.turn !== room.turn) fail('stale_turn', 'Ce tour est déjà résolu.');
    const res = engine(room.turns.setOrders(room, p.id, data.orders, data.replace === true));
    tx.dirty = true;
    reply(tx, connId, { event: 'orders_update', turn: room.turn, orders: res.orders, commandPoints: res.commandPoints, committed: !!room.sim.committed[p.id] });
  });

  H.commit_orders = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requirePlanning(tx, connId);
    const room = tx.room;
    if (data.turn != null && data.turn !== room.turn) fail('stale_turn', 'Ce tour est déjà résolu.');
    engine(room.turns.commit(room, p.id, true));
    tx.dirty = true;
    commitStatusFlow(tx);
    maybeResolveFlow(tx);
  });

  H.cancel_commit = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requirePlanning(tx, connId);
    engine(tx.room.turns.commit(tx.room, p.id, false));
    tx.dirty = true;
    commitStatusFlow(tx);
  });

  // Replay of a finished battle, in chunks (API Gateway frames are limited to 128 KB)
  H.get_replay = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    requireMember(tx, connId);
    requirePhase(tx, 'ended');
    const rep = tx.room.getReplay();
    if (!rep) fail('no_replay', 'Aucun replay enregistré pour cette partie.');
    const text = JSON.stringify(rep);
    const size = 60000;
    const total = Math.max(1, Math.ceil(text.length / size));
    for (let i = 0; i < total; i++) reply(tx, connId, { event: 'replay_chunk', index: i, total, data: text.slice(i * size, (i + 1) * size) });
  });

  H.chat_message = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const { member, role } = requireMember(tx, connId);
    const text = v.cleanText(data.text, 200);
    if (!text) return;
    const msg = { authorId: member.id, authorName: member.name, text, isSpectator: role === 'spectator', at: tx.t };
    tx.room.chat = [...(tx.room.chat || []), msg].slice(-cfg.chatHistory);
    tx.dirty = true;
    emit(tx, 'all', { event: 'chat_message', ...msg });
  });

  H.ping = (connId, data) => withRoom(v.roomCode(data.roomCode), (tx) => {
    const p = requirePlayer(tx, connId);
    const q = v.int(data.q, -10000, 10000);
    const r = v.int(data.r, -10000, 10000);
    if (!tx.room.hexMap[hexKey(q, r)]) return;
    emit(tx, 'all', { event: 'ping', q, r, color: p.color || '#ffd700', playerId: p.id });
  });

  H.tick = async (connId, data) => {
    await withRoom(v.roomCode(data.roomCode), (tx) => {
      requireMember(tx, connId);
      reply(tx, connId, { event: 'pong', t: tx.t });
    });
    if (store.touchConn) await store.touchConn(connId);
  };

  // ---------- entry points ----------

  async function handle(connId, action, data) {
    try {
      if (typeof action !== 'string' || !Object.prototype.hasOwnProperty.call(H, action)) fail('unknown_action', 'Action inconnue.');
      await H[action](connId, data && typeof data === 'object' ? data : {});
    } catch (e) {
      const known = e instanceof ProtocolError;
      if (!known) log.error(`[protocol] ${action}:`, e && (e.stack || e.message));
      try {
        await transport.send(connId, { event: 'error', code: known ? e.code : 'server_error', message: known ? e.message : 'Erreur serveur.', action: typeof action === 'string' ? action : null });
      } catch (err) { /* connection gone */ }
    }
  }

  async function disconnect(connId) {
    try {
      const rec = await store.getConn(connId);
      if (rec && rec.roomCode) {
        try {
          await withRoom(rec.roomCode, (tx) => markDisconnected(tx, connId, rec.memberId));
        } catch (e) {
          if (!(e instanceof ProtocolError)) throw e;
        }
      }
      await store.deleteConn(connId);
    } catch (e) {
      log.error('[protocol] disconnect:', e && (e.stack || e.message));
    }
  }

  async function tick(roomCode) {
    try {
      await withRoom(roomCode, () => {});
    } catch (e) {
      if (!(e instanceof ProtocolError)) log.error('[protocol] tick:', e && (e.stack || e.message));
    }
  }

  return { handle, disconnect, tick, config: cfg, actions: Object.keys(H), bots: botRunner };
}

module.exports = { createProtocol, ProtocolError, PALETTE, DEFAULTS };
