const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./helpers');
const { createProtocol } = require('../game/protocol');
const { createMemoryStore } = require('../server/memoryStore');
const { isModeAvailable } = require('../game/turns');
const GameRoom = require('../game/GameRoom');
const bots = require('../game/bots');

createHarness(); // registers the 'test-small' map

// Protocol + memory store; log.error is captured (bots swallow their errors, a broken bot must still fail the test)
function harness({ roundTrip = false, config = {}, scheduler = null, now } = {}) {
  const errors = [];
  const inbox = new Map();
  const sentToBots = [];
  const transport = {
    async send(connId, msg) {
      if (bots.isBotConn(connId)) sentToBots.push(connId);
      if (!inbox.has(connId)) inbox.set(connId, []);
      inbox.get(connId).push(JSON.parse(JSON.stringify(msg)));
      return true;
    },
  };
  const store = createMemoryStore({ roundTrip });
  const log = { error: (...a) => errors.push(a.map(String).join(' ')), warn() {}, log() {} };
  const protocol = createProtocol({ store, transport, scheduler, now, config: { botPace: 0, ...config }, log });
  let n = 0;
  function client(name) {
    const connId = `${name}#${++n}`;
    inbox.set(connId, []);
    const c = {
      connId,
      session: null,
      async send(action, data = {}) {
        await protocol.handle(connId, action, { roomCode: c.session?.roomCode, ...data });
        for (const m of inbox.get(connId)) if (m.event === 'session') c.session = m;
        return c;
      },
      all(event) { return inbox.get(connId).filter(m => m.event === event); },
      last(event) { const a = c.all(event); return a[a.length - 1]; },
    };
    return c;
  }
  return { protocol, store, client, errors, sentToBots };
}

function botRoom({ code, mapId, a, b, maxTurns = 25, budget = 5000, mode = 'sequential' }) {
  const room = new GameRoom(code, null, { mapId, record: true });
  assert.ok(bots.addBot(room, { id: 'b_one', difficulty: a, color: '#4a90d9' }).ok);
  assert.ok(bots.addBot(room, { id: 'b_two', difficulty: b, color: '#e05050' }).ok);
  room.hostId = 'b_one';
  room.mode = mode;
  room.setSettings({ maxTurns });
  room.budget = budget;
  room.startGame();
  return room;
}

// All-bot room watched by a spectator (bots only play while a human is connected); driven by tick() like the lambda
async function playBotGame(h, room, maxTicks = 400) {
  await h.store.create(room);
  const spec = h.client('spec');
  await spec.send('join_room', { roomCode: room.roomCode, playerName: 'Arbitre', spectator: true });
  let r = null;
  for (let i = 0; i < maxTicks; i++) {
    await h.protocol.tick(room.roomCode);
    r = await h.store.get(room.roomCode);
    if (!r || r.phase === 'ended') break;
  }
  return { room: r, spec };
}

test('lobby : l\'hôte ajoute et retire des IA', async () => {
  const h = harness();
  const host = h.client('host');
  const guest = h.client('guest');
  await host.send('create_room', { playerName: 'Shin' });
  await guest.send('join_room', { roomCode: host.session.roomCode, playerName: 'Ten' });
  await guest.send('add_bot', { difficulty: 'recrue' });
  assert.equal(guest.last('error').code, 'not_host');
  await host.send('add_bot', { difficulty: 'invincible' });
  assert.equal(host.last('error').code, 'invalid_difficulty');
  await host.send('select_general', { generalId: 'ou_ki' });
  await host.send('add_bot', { difficulty: 'stratege', generalId: 'ou_ki' });
  assert.equal(host.last('error').code, 'rejected', 'général déjà pris');

  await host.send('add_bot', { difficulty: 'stratege', generalId: 'ren_pa' });
  await host.send('add_bot', {});
  const lobby = guest.last('room_update');
  assert.equal(lobby.players.length, 4);
  assert.equal(lobby.bots.length, 2);
  const renPa = lobby.players.find(p => p.generalId === 'ren_pa');
  assert.equal(renPa.name, 'Roi Kou Retsu', 'IA nommée d\'après le roi du royaume de son général');
  assert.equal(renPa.generalId, 'ren_pa');
  assert.deepEqual(lobby.bots.map(b => b.difficulty).sort(), ['stratege', 'veteran']);
  const other = lobby.players.find(p => p.id === lobby.bots.find(b => b.difficulty === 'veteran').id);
  assert.ok(other.generalId && other.generalId !== 'ou_ki' && other.generalId !== 'ren_pa', 'général choisi automatiquement');
  assert.equal(new Set(lobby.players.map(p => p.color)).size, 4, 'couleurs distinctes');
  assert.ok(guest.last('player_joined').isBot);

  await guest.send('set_bot_general', { playerId: renPa.id, generalId: 'gai_mou' });
  assert.equal(guest.last('error').code, 'not_host');
  await host.send('set_bot_general', { playerId: renPa.id, generalId: 'ou_ki' });
  assert.equal(host.last('error').code, 'general_taken');
  await host.send('set_bot_general', { playerId: host.session.playerId, generalId: 'gai_mou' });
  assert.equal(host.last('error').code, 'bot_not_found');
  await host.send('set_bot_general', { playerId: renPa.id, generalId: 'gai_mou' });
  const changed = guest.last('room_update').players.find(p => p.id === renPa.id);
  assert.equal(changed.generalId, 'gai_mou');
  assert.equal(changed.name, 'Roi Kei Bin');

  await guest.send('set_bot_difficulty', { playerId: renPa.id, difficulty: 'recrue' });
  assert.equal(guest.last('error').code, 'not_host');
  await host.send('set_bot_difficulty', { playerId: renPa.id, difficulty: 'nope' });
  assert.equal(host.last('error').code, 'invalid_difficulty');
  await host.send('set_bot_difficulty', { playerId: renPa.id, difficulty: 'recrue' });
  assert.equal(guest.last('room_update').bots.find(b => b.id === renPa.id).difficulty, 'recrue');
  await host.send('set_bot_flag', { playerId: renPa.id, flagId: 'yan' });
  const flagged = guest.last('room_update').players.find(p => p.id === renPa.id);
  assert.equal(flagged.flag, 'yan');
  assert.equal(flagged.name, 'Roi Ki', 'le nom suit le drapeau');
  await host.send('set_bot_flag', { playerId: renPa.id, flagId: 'wei' });
  await host.send('set_player_flag', { flagId: 'wei' });
  assert.equal(host.last('error').code, 'flag_taken');

  await host.send('remove_bot', { playerId: host.session.playerId });
  assert.equal(host.last('error').code, 'bot_not_found');
  await host.send('remove_bot', { playerId: renPa.id });
  assert.equal(guest.last('player_left').playerId, renPa.id);
  assert.equal(guest.last('room_update').players.length, 3);

  // Bots are always ready: the army is submitted as soon as the army building starts
  const taken = guest.last('room_update').takenGenerals;
  await guest.send('select_general', { generalId: ['mou_bu', 'kan_ki', 'ou_sen'].find(g => !taken.includes(g)) });
  await host.send('start_game');
  const up = host.last('room_update');
  assert.equal(up.phase, 'army_building');
  assert.ok(up.players.filter(p => lobby.bots.some(b => b.id === p.id)).every(p => p.isReady), 'armée de l\'IA envoyée');
  assert.equal(h.sentToBots.length, 0, 'rien n\'est envoyé aux connexions des IA');
  assert.deepEqual(h.errors, []);
});

test('lobby : une salle sans humain est supprimée', async () => {
  const h = harness();
  const host = h.client('host');
  await host.send('create_room', { playerName: 'Shin' });
  const code = host.session.roomCode;
  await host.send('add_bot', { difficulty: 'recrue' });
  await host.send('leave_room');
  assert.equal(await h.store.get(code), null);
});

test('solo : create_solo, armée, déploiement et bataille contre l\'IA sans blocage', { timeout: 60000 }, async () => {
  const h = harness();
  const me = h.client('me');
  await me.send('create_solo', { playerName: 'Shin', difficulty: 'recrue', mapId: 'test-small', generalId: 'ou_ki' });
  assert.equal(me.last('phase_change').phase, 'army_building');
  const lobby = me.last('room_update');
  assert.equal(lobby.players.length, 2);
  assert.equal(lobby.players.find(p => p.id === me.session.playerId).generalId, 'ou_ki');
  assert.ok(lobby.players.find(p => p.id !== me.session.playerId).isReady, 'IA prête');

  await me.send('submit_army', { units: [{ typeId: 'soldats', count: 2 }, { typeId: 'archer', count: 1 }] });
  const ds = me.last('deployment_state');
  assert.ok(ds, 'déploiement');
  const tiles = ds.startingZone.tiles.slice();
  for (const u of ds.units) {
    const t = tiles.shift();
    await me.send('place_unit', { unitId: u.id, q: t.q, r: t.r });
  }
  await me.send('deployment_ready');
  let gs = me.last('game_state');
  assert.equal(gs.phase, 'battle', 'bataille');
  const myId = me.session.playerId;
  let lastTurn = 0;
  let ended = false;
  for (let i = 0; i < 80; i++) {
    const room = await h.store.get(me.session.roomCode);
    if (room.phase === 'ended') { ended = true; break; }
    const mine = Object.entries(room.pendingAttacks).find(([, a]) => a.targetPlayerId === myId);
    if (mine) { await me.send('defend_choice', { attackId: mine[0], choice: 'absorb' }); continue; }
    assert.equal(room.getCurrentPlayerId(), myId, 'après chaque action humaine, l\'IA a fini sa manche');
    assert.ok(room.turn >= lastTurn);
    lastTurn = room.turn;
    if (room.turn > 6) break;
    await me.send('end_turn');
  }
  assert.ok(ended || lastTurn >= 5, `la partie avance (tour ${lastTurn})`);
  if (ended) assert.ok(me.last('game_over'), 'fin de partie reçue');
  assert.equal(h.protocol.bots.stats.failures, 0, JSON.stringify(h.protocol.bots.stats.errors));
  assert.deepEqual(h.errors, []);
});

const PAIRS = [['recrue', 'veteran'], ['veteran', 'stratege'], ['stratege', 'recrue'], ['stratege', 'stratege']];

for (const roundTrip of [false, true]) {
  test(`IA contre IA : parties complètes sans erreur ni blocage${roundTrip ? ' (sérialisation)' : ''}`, { timeout: 180000 }, async () => {
    let n = 0;
    for (const [a, b] of PAIRS) {
      for (const mapId of ['test-small', 'default']) {
        let h, room;
        for (let attempt = 0; attempt < 4; attempt++) {
          h = harness({ roundTrip });
          ({ room } = await playBotGame(h, botRoom({ code: `IA${roundTrip ? 'R' : 'M'}${++n}X`, mapId, a, b, maxTurns: mapId === 'default' ? 25 : 15 })));
          // Known issue of HexUtils.getStartingZones (random zones): a zone can end up empty, nobody can deploy
          if (!(room.phase === 'deployment' && room.players.some(p => !p.startingZone.tiles.length))) break;
        }
        assert.equal(room.phase, 'ended', `${a} contre ${b} sur ${mapId} : partie terminée (tour ${room.turn})`);
        assert.ok(['elimination', 'max_turns', 'points', 'surrender'].includes(room.endReason), room.endReason);
        const st = h.protocol.bots.stats;
        assert.equal(st.failures, 0, `${a}/${b}/${mapId} : ${JSON.stringify(st.errors)}`);
        assert.ok(st.steps > 3);
        assert.equal(h.sentToBots.length, 0);
        assert.deepEqual(h.errors, []);
        assert.ok(room.stats && Object.values(room.stats.players).some(p => p.damageDealt > 0 || p.kills > 0) || room.endReason === 'max_turns', 'les armées se sont affrontées');
      }
    }
  });
}

test('IA contre IA avec minuteries (serveur local) et rythme entre les actions', { timeout: 60000 }, async () => {
  const timers = new Map();
  let protocol = null;
  const scheduler = {
    schedule(code, at) {
      clearTimeout(timers.get(code));
      const t = setTimeout(() => { timers.delete(code); protocol.tick(code); }, Math.max(0, Math.min(at - Date.now(), 1000)));
      timers.set(code, t);
    },
  };
  const h = harness({ scheduler, now: Date.now, config: { botPace: 0.004 } });
  protocol = h.protocol;
  const room = botRoom({ code: 'IATIME', mapId: 'test-small', a: 'veteran', b: 'stratege', maxTurns: 5 });
  await h.store.create(room);
  const spec = h.client('spec');
  await spec.send('join_room', { roomCode: room.roomCode, playerName: 'Arbitre', spectator: true });
  const t0 = Date.now();
  let r;
  while (Date.now() - t0 < 55000) {
    await new Promise(res => setTimeout(res, 50));
    r = await h.store.get('IATIME');
    if (!r || r.phase === 'ended') break;
  }
  for (const t of timers.values()) clearTimeout(t);
  assert.equal(r.phase, 'ended', `partie terminée par les minuteries (phase ${r.phase}, tour ${r.turn})`);
  assert.equal(h.protocol.bots.stats.failures, 0, JSON.stringify(h.protocol.bots.stats.errors));
  assert.ok(spec.all('unit_move_anim').length > 0, 'le spectateur voit jouer les IA');
  assert.deepEqual(h.errors, []);
});

test('IA : sans humain connecté, les IA attendent', async () => {
  const h = harness();
  const room = botRoom({ code: 'IAIDLE', mapId: 'test-small', a: 'recrue', b: 'recrue' });
  await h.store.create(room);
  await h.protocol.tick('IAIDLE');
  const r = await h.store.get('IAIDLE');
  assert.equal(r.phase, 'army_building');
  assert.equal(h.protocol.bots.stats.steps, 0);
});

test('tutoriel : bataille scriptée, le joueur commence, drapeau, IA passive', { timeout: 30000 }, async () => {
  const h = harness();
  const me = h.client('me');
  await me.send('start_tutorial', { playerName: 'Shin' });
  assert.ok(me.session, 'session');
  assert.equal(me.last('phase_change').phase, 'battle');
  assert.equal(me.last('room_update').tutorial, true);
  const gs = me.last('game_state');
  assert.equal(gs.phase, 'battle');
  assert.equal(gs.currentPlayerId, me.session.playerId, 'le joueur commence');
  assert.equal(gs.settings.turnsPerHalfDay, 5);
  assert.equal(gs.objectives.length, 1);
  assert.deepEqual(gs.myUnits.map(u => u.typeId).sort(), ['archer', 'cavalier_leger', 'general', 'soldats']);
  assert.ok(gs.myUnits.every(u => u.speedRemaining > 0), 'vitesses initialisées');
  assert.ok(!gs.units.some(u => !u.isMine && u.typeId === 'pietaille'), 'la piétaille ennemie est cachée en forêt');
  const enemyBefore = gs.units.filter(u => !u.isMine).map(u => `${u.id}@${u.q},${u.r}`).sort();
  await me.send('end_turn');
  const room = await h.store.get(me.session.roomCode);
  assert.equal(room.getCurrentPlayerId(), me.session.playerId, 'l\'IA a joué et rendu la main');
  assert.equal(room.turn, 2);
  const after = me.last('game_state').units.filter(u => !u.isMine).map(u => `${u.id}@${u.q},${u.r}`).sort();
  assert.deepEqual(after, enemyBefore, 'l\'IA du tutoriel tient ses positions tant qu\'on ne l\'approche pas');
  assert.equal(h.protocol.bots.stats.failures, 0);
  assert.deepEqual(h.errors, []);
});

test('IA : mode simultané (ordres secrets) jusqu\'à la fin de la partie', { timeout: 120000, skip: !isModeAvailable('simultaneous') && 'mode simultané absent' }, async () => {
  const h = harness();
  const room = botRoom({ code: 'IASIM', mapId: 'test-small', a: 'veteran', b: 'stratege', maxTurns: 10, mode: 'simultaneous' });
  const { room: r } = await playBotGame(h, room);
  assert.equal(r.phase, 'ended', `partie terminée (tour ${r.turn})`);
  assert.equal(h.protocol.bots.stats.failures, 0, JSON.stringify(h.protocol.bots.stats.errors));
  assert.deepEqual(h.errors, []);
});

test('IA : général seul face à une armée vue -> abandon ; face au seul général adverse -> il le cherche', () => {
  const { getProfile } = require('../game/bots/profiles');
  const { buildWorld, loneGeneralGoal } = require('../game/bots/world');
  const room = new GameRoom('SURR1', null, { mapId: 'test-small' });
  bots.addBot(room, { id: 'b_one', difficulty: 'veteran', generalId: 'ou_ki' });
  bots.addBot(room, { id: 'b_two', difficulty: 'veteran', generalId: 'mou_bu' });
  room.hostId = 'b_one';
  room.startGame();
  for (const p of room.players) assert.ok(room.submitArmy(p.id, [{ typeId: 'soldats', count: 2 }]).ok);
  room.startDeployment();
  for (const p of room.players) {
    const tiles = p.startingZone.tiles;
    p.units.forEach((u, j) => assert.ok(room.placeUnit(p.id, u.id, tiles[j * 2].q, tiles[j * 2].r).ok));
    assert.ok(room.setDeploymentReady(p.id).ok);
  }
  room.startBattle();
  const one = room.getPlayer('b_one'), two = room.getPlayer('b_two');
  const vet = getProfile('veteran');
  assert.equal(bots.shouldSurrender(room, 'b_one', vet), false, 'armée encore présente');

  const g1 = one.units.find(u => u.isGeneral);
  one.units = one.units.filter(u => u.isGeneral);
  room._rebuildUnitMap();
  const free = Object.values(room.hexMap).filter(h => hexDist(h, g1) >= 2 && hexDist(h, g1) <= 3 && !room.unitMap[`${h.q},${h.r}`] && !room._inCover(h.q, h.r) && room.getVisibleHexes('b_one').has(`${h.q},${h.r}`));
  two.units.filter(u => !u.isGeneral).forEach((u, i) => { u.q = free[i].q; u.r = free[i].r; });
  room._rebuildUnitMap();
  assert.equal(bots.shouldSurrender(room, 'b_one', vet), true, 'général seul face à deux unités vues');
  assert.equal(bots.shouldSurrender(room, 'b_one', getProfile('tutorial')), false, 'jamais dans le tutoriel');

  two.units = two.units.filter(u => u.isGeneral);
  room._rebuildUnitMap();
  assert.equal(bots.shouldSurrender(room, 'b_one', vet), false, 'les cases vues vides font oublier les unités');
  assert.ok(loneGeneralGoal(buildWorld(room, 'b_one')), 'général contre général : il part à sa recherche');
});

function hexDist(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
}
