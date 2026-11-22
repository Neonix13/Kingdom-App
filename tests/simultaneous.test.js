const test = require('node:test');
const assert = require('node:assert/strict');
const GameRoom = require('../game/GameRoom');
const { simRoom, put, units, events } = require('./simHelpers');

// Generals in the corners with a short sight so that fog of war matters on the small test map
function park(room) {
  put(room, units(room, 'p0').general, 0, 8, { visionRange: 3 });
  put(room, units(room, 'p1').general, 13, 0, { visionRange: 3 });
}

function setup(armies) {
  const room = simRoom(armies);
  park(room);
  return { room, A: units(room, 'p0').troops, B: units(room, 'p1').troops, T: room.turns };
}

function order(room, pid, orders) {
  const res = room.turns.setOrders(room, pid, orders);
  assert.ok(res.ok, res.error);
  return res;
}

const at = (u) => [u.q, u.r];
const combats = (res, who) => events(res, who).filter(e => e.k === 'combat');

test('simultané : case disputée entre ennemis → personne n\'y entre, mêlée de rencontre', () => {
  const { room, A, B, T } = setup({ p0: [{ typeId: 'soldats', count: 1 }], p1: [{ typeId: 'soldats', count: 1 }] });
  put(room, A[0], 4, 4); put(room, B[0], 8, 4);
  order(room, 'p0', { [A[0].id]: { type: 'move', path: [[5, 4], [6, 4]] } });
  order(room, 'p1', { [B[0].id]: { type: 'move', path: [[7, 4], [6, 4]] } });
  const res = T.resolve(room, 1);
  assert.deepEqual(at(A[0]), [5, 4]);
  assert.deepEqual(at(B[0]), [7, 4]);
  const c = combats(res);
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, 'encounter');
  assert.equal(c[0].t, 2);
  assert.equal(c[0].log.defenseChoice, 'counter', 'les deux camps se battent');
});

test('simultané : croisement (échange de cases) entre ennemis → chacun reste, mêlée de rencontre', () => {
  const { room, A, B, T } = setup();
  put(room, A[0], 5, 4); put(room, B[0], 6, 4);
  order(room, 'p0', { [A[0].id]: { type: 'move', path: [[6, 4], [7, 4]] } });
  order(room, 'p1', { [B[0].id]: { type: 'move', path: [[5, 4], [4, 4]] } });
  const res = T.resolve(room, 2);
  assert.deepEqual(at(A[0]), [5, 4]);
  assert.deepEqual(at(B[0]), [6, 4]);
  assert.equal(combats(res)[0].kind, 'encounter');
});

test('simultané : case disputée entre alliés → le plus rapide passe, l\'autre attend un tick', () => {
  const { room, A, T } = setup({ p0: [{ typeId: 'cavalier_leger', count: 1 }, { typeId: 'soldats', count: 1 }] });
  const cav = A.find(u => u.typeId === 'cavalier_leger');
  const sol = A.find(u => u.typeId === 'soldats');
  put(room, cav, 4, 4); put(room, sol, 5, 5);
  order(room, 'p0', { [cav.id]: { type: 'move', path: [[5, 4], [6, 4]] }, [sol.id]: { type: 'move', path: [[5, 4]] } });
  const res = T.resolve(room, 3);
  assert.deepEqual(at(cav), [6, 4]);
  assert.deepEqual(at(sol), [5, 4]);
  const solMoves = events(res).filter(e => e.k === 'move' && e.u === sol.id);
  assert.equal(solMoves.length, 1);
  assert.equal(solMoves[0].t, 2, 'le plus lent entre au tick suivant, dans la case libérée');
});

test('simultané : une colonne avance d\'un bloc (case libérée au même tick) ; un allié immobile bloque toute la file', () => {
  const { room, A, T } = setup({ p0: [{ typeId: 'soldats', count: 6 }] });
  put(room, A[0], 4, 4); put(room, A[1], 3, 4); put(room, A[2], 4, 6);
  put(room, A[3], 5, 1); put(room, A[4], 4, 1); put(room, A[5], 3, 1);
  order(room, 'p0', {
    [A[0].id]: { type: 'move', path: [[5, 4], [6, 4]] },
    [A[1].id]: { type: 'move', path: [[4, 4], [5, 4]] },
    [A[2].id]: { type: 'move', path: [[4, 5], [4, 4], [3, 4]] },
    [A[4].id]: { type: 'move', path: [[5, 1]] },
    [A[5].id]: { type: 'move', path: [[4, 1]] },
  });
  const res = T.resolve(room, 4);
  assert.deepEqual(at(A[0]), [6, 4]);
  assert.deepEqual(at(A[1]), [5, 4]);
  assert.deepEqual(at(A[2]), [3, 4]);
  assert.equal(events(res).filter(e => e.k === 'move' && e.t === 1).length, 3, 'mouvements simultanés au tick 1');
  assert.deepEqual(at(A[4]), [4, 1], 'bloquée par un allié qui tient');
  assert.deepEqual(at(A[5]), [3, 1], 'la file derrière reste bloquée');
});

test('simultané : zone de contrôle — un déplacement s\'arrête au contact d\'un ennemi', () => {
  const { room, A, B, T } = setup({ p0: [{ typeId: 'cavalier_leger', count: 1 }] });
  put(room, A[0], 4, 4); put(room, B[0], 8, 3);
  order(room, 'p0', { [A[0].id]: { type: 'move', path: [[5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4]] } });
  const res = T.resolve(room, 5);
  assert.deepEqual(at(A[0]), [7, 4]);
  assert.equal(combats(res).length, 0, 'un simple déplacement n\'attaque pas');
});

test('simultané : attaque de mêlée — approche puis frappe ; réaction du défenseur selon sa posture', () => {
  const cases = [['defense_combat', 'counter'], ['combat', 'counter'], ['repos', 'rien'], ['marche', 'absorb']];
  for (const [stance, choice] of cases) {
    const { room, A, B, T } = setup();
    put(room, A[0], 4, 4); put(room, B[0], 7, 4, { stance });
    order(room, 'p0', { [A[0].id]: { type: 'attack', targetId: B[0].id } });
    const res = T.resolve(room, 6);
    const c = combats(res);
    assert.equal(c.length, 1, stance);
    assert.equal(c[0].kind, 'melee');
    assert.equal(c[0].t, 2);
    assert.equal(c[0].log.defenseChoice, choice, stance);
    assert.equal(c[0].log.attackerId, A[0].id);
  }
});

test('simultané : une unité en Marche qui a bougé ne se défend pas', () => {
  const { room, A, B, T } = setup();
  put(room, A[0], 5, 4); put(room, B[0], 8, 4, { stance: 'marche' });
  order(room, 'p0', { [A[0].id]: { type: 'attack', targetId: B[0].id } });
  order(room, 'p1', { [B[0].id]: { type: 'move', path: [[8, 5]] } });
  const res = T.resolve(room, 7);
  const c = combats(res);
  assert.equal(c.length, 1);
  assert.equal(c[0].log.defenseChoice, 'rien');
});

test('simultané : charge — bonus après 2 cases, annulé par la Défense de combat, retourné par les lanciers', () => {
  const run = (typeId, stance, from) => {
    const { room, A, B, T } = setup({ p0: [{ typeId: 'cavalier_leger', count: 1 }], p1: [{ typeId, count: 1 }] });
    put(room, A[0], from, 4); put(room, B[0], 7, 4, { stance });
    order(room, 'p0', { [A[0].id]: { type: 'charge', targetId: B[0].id } });
    return combats(T.resolve(room, 8))[0];
  };
  const bonus = run('soldats', 'marche', 4);
  assert.equal(bonus.kind, 'charge');
  assert.equal(bonus.log.charge, 'bonus');
  assert.equal(bonus.log.breakdown.extraAttack, 2);
  assert.equal(run('soldats', 'defense_combat', 4).log.charge, 'cancelled');
  const spears = run('lancier', 'marche', 4);
  assert.equal(spears.log.charge, 'stopped');
  assert.equal(spears.log.breakdown.extraAttack, -2);
  const short = run('soldats', 'marche', 5);
  assert.equal(short.kind, 'melee', 'moins de 2 cases : pas de bonus');
  assert.equal(short.log.charge, undefined);
});

test('simultané : tir — à portée au début du tick, tir perdu si la cible s\'éloigne, tir dès qu\'elle entre à portée', () => {
  const mk = () => {
    const s = setup({ p0: [{ typeId: 'archer', count: 1 }, { typeId: 'soldats', count: 1 }] });
    s.archer = s.A.find(u => u.typeId === 'archer');
    s.spot = s.A.find(u => u.typeId === 'soldats');
    return s;
  };
  {
    const { room, archer, spot, B, T } = mk();
    put(room, archer, 4, 4); put(room, spot, 4, 7); put(room, B[0], 7, 4);
    order(room, 'p0', { [archer.id]: { type: 'attack', targetId: B[0].id } });
    order(room, 'p1', { [B[0].id]: { type: 'move', path: [[8, 4], [9, 4]] } });
    const c = combats(T.resolve(room, 9));
    assert.equal(c.length, 1);
    assert.equal(c[0].kind, 'ranged');
    assert.equal(c[0].t, 1, 'le tir part avant le déplacement de la cible');
    assert.deepEqual(at(archer), [4, 4], 'un tireur ne bouge pas');
  }
  {
    const { room, archer, spot, B, T } = mk();
    put(room, archer, 4, 4); put(room, spot, 8, 6); put(room, B[0], 8, 4);
    order(room, 'p0', { [archer.id]: { type: 'attack', targetId: B[0].id } });
    order(room, 'p1', { [B[0].id]: { type: 'move', path: [[9, 4], [10, 4]] } });
    const res = T.resolve(room, 10);
    assert.equal(combats(res).length, 0);
    assert.ok(events(res, 'p0').some(e => e.k === 'shot_lost' && e.u === archer.id));
    assert.ok(!events(res, 'p1').some(e => e.k === 'shot_lost'), 'le tir perdu n\'est montré qu\'au tireur');
  }
  {
    const { room, archer, spot, B, T } = mk();
    put(room, archer, 4, 4); put(room, spot, 8, 6); put(room, B[0], 8, 4);
    order(room, 'p0', { [archer.id]: { type: 'attack', targetId: B[0].id } });
    order(room, 'p1', { [B[0].id]: { type: 'move', path: [[7, 4]] } });
    const c = combats(T.resolve(room, 11));
    assert.equal(c.length, 1);
    assert.equal(c[0].t, 2, 'tir au tick suivant l\'entrée à portée');
  }
});

test('simultané : tir de réaction d\'un tireur en Défense à distance', () => {
  const { room, A, B, T } = setup({ p0: [{ typeId: 'archer', count: 1 }] });
  put(room, A[0], 4, 4, { stance: 'defense_distance' }); put(room, B[0], 8, 4);
  order(room, 'p1', { [B[0].id]: { type: 'move', path: [[7, 4], [6, 4]] } });
  const res = T.resolve(room, 12);
  const c = combats(res);
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, 'reaction');
  assert.equal(c[0].t, 2);
  assert.equal(c[0].log.ranged, true);
});

test('simultané : embuscade — l\'unité qui découvre un ennemi caché en forêt s\'arrête, l\'embusqué est révélé', () => {
  const { room, A, B, T } = setup();
  put(room, A[0], 4, 2); put(room, B[0], 7, 2);
  assert.ok(room.isConcealedFrom('p0', B[0]));
  order(room, 'p0', { [A[0].id]: { type: 'move', path: [[5, 2], [6, 2], [6, 3]] } });
  const res = T.resolve(room, 13);
  assert.deepEqual(at(A[0]), [6, 2]);
  const ev = events(res, 'p0');
  const amb = ev.find(e => e.k === 'ambush');
  assert.ok(amb && amb.by === B[0].id);
  const firstSight = ev.findIndex(e => e.u === B[0].id);
  assert.equal(ev[firstSight].k, 'appear', 'l\'embusqué apparaît au moment de l\'embuscade');
  assert.equal(ev[firstSight].t, amb.t);
  assert.ok(room._isRevealed(B[0]));
});

test('simultané : brouillard — chronologie filtrée par la vision à chaque tick', () => {
  const { room, A, B, T } = setup({ p1: [{ typeId: 'soldats', count: 2 }] });
  put(room, A[0], 4, 4); put(room, B[0], 11, 8); put(room, B[1], 9, 4);
  order(room, 'p1', {
    [B[0].id]: { type: 'move', path: [[10, 8], [9, 8]] },
    [B[1].id]: { type: 'move', path: [[8, 4], [7, 4]] },
  });
  const res = T.resolve(room, 14);
  const seen = events(res, 'p0');
  const text = JSON.stringify(res.views.p0);
  assert.ok(!text.includes(`"${B[0].id}"`), 'une unité jamais vue n\'apparaît pas dans la chronologie');
  const ap = seen.find(e => e.u === B[1].id);
  assert.equal(ap.k, 'appear', 'entrée dans la vision : descripteur complet');
  assert.deepEqual(ap.at, [7, 4]);
  assert.equal(ap.unit.typeId, 'soldats');
  assert.ok(!seen.some(e => e.k === 'move' && e.u === B[1].id && e.from[0] === 9), 'pas de trajet hors de vue');
  assert.ok(events(res, 'p1').filter(e => e.k === 'move').length === 4, 'le propriétaire voit tout');
  const apA = events(res, 'p1').find(e => e.u === A[0].id);
  assert.equal(apA.k, 'appear', 'l\'unité immobile de A apparaît quand B arrive à portée de vue');
  assert.equal(apA.t, 2);
});

test('simultané : déterminisme — même salle, mêmes ordres, même graine → même résultat', () => {
  const { room, A, B } = setup({ p0: [{ typeId: 'soldats', count: 2 }, { typeId: 'archer', count: 1 }], p1: [{ typeId: 'soldats', count: 2 }, { typeId: 'lancier', count: 1 }] });
  put(room, A[0], 4, 4); put(room, A[1], 4, 5); put(room, A[2], 3, 4);
  put(room, B[0], 7, 4); put(room, B[1], 7, 5); put(room, B[2], 8, 4);
  order(room, 'p0', { [A[0].id]: { type: 'attack', targetId: B[0].id }, [A[1].id]: { type: 'charge', targetId: B[1].id }, [A[2].id]: { type: 'attack', targetId: B[0].id } });
  order(room, 'p1', { [B[0].id]: { type: 'move', path: [[6, 4]] }, [B[1].id]: { type: 'attack', targetId: A[1].id, stance: 'combat' } });
  const data = JSON.stringify(room.serialize());
  const load = () => GameRoom.deserialize(JSON.parse(data));
  const r1 = load(), r2 = load();
  const res1 = r1.turns.resolve(r1, 424242), res2 = r2.turns.resolve(r2, 424242);
  assert.deepEqual(res1, res2);
  assert.deepEqual(r1.serialize(), r2.serialize());
  assert.ok(combats(res1).length >= 2);
  const r3 = load();
  r3.turns.resolve(r3, 1);
  const diff = JSON.stringify(r3.serialize().players) !== JSON.stringify(r1.serialize().players);
  assert.ok(diff, 'une autre graine donne d\'autres dés');
});

test('simultané : points de commandement, validation des ordres', () => {
  const { room, A, B, T } = setup({ p0: [{ typeId: 'soldats', count: 2 }, { typeId: 'archer', count: 1 }] });
  const GENERALS = require('../game/data/generals');
  const strat = (id) => GENERALS.find(g => g.id === id).strategy;
  assert.equal(T.commandPoints(room, 'p0'), 2 + Math.ceil(strat('ou_ki') / 3), 'Ou Ki : 2 + ⌈Stratégie/3⌉');
  assert.equal(T.commandPoints(room, 'p1'), 2 + Math.ceil(strat('mou_bu') / 3));
  put(room, A[0], 4, 4); put(room, A[1], 4, 5); put(room, A[2], 3, 4); put(room, B[0], 12, 8);
  room.settings.commandPoints = 1;
  assert.match(T.setOrders(room, 'p0', { [A[0].id]: { type: 'hold', stance: 'defense_combat' }, [A[1].id]: { type: 'move', path: [[5, 5]] } }).error, /commandement/);
  assert.ok(T.setOrders(room, 'p0', { [A[0].id]: { type: 'hold' } }).ok, 'tenir sans posture ne coûte rien');
  assert.deepEqual(room.sim.orders.p0, {});
  room.settings.commandPoints = 0;
  assert.match(T.setOrders(room, 'p0', { [A[0].id]: { type: 'move', path: [[5, 4], [6, 4], [7, 4], [8, 4]] } }).error, /trop long/);
  assert.match(T.setOrders(room, 'p0', { [A[0].id]: { type: 'move', path: [[5, 4], [7, 4]] } }).error, /Chemin invalide/);
  assert.match(T.setOrders(room, 'p0', { [A[0].id]: { type: 'move', path: [[5, 4], [6, 4]], stance: 'defense_combat' } }).error, /trop long/, 'la posture coûte 2');
  assert.equal(T.setOrders(room, 'p0', { [A[0].id]: { type: 'attack', targetId: B[0].id } }).error, 'Cible introuvable.', 'cible invisible');
  assert.equal(T.setOrders(room, 'p0', { [A[0].id]: { type: 'attack', targetId: A[1].id } }).error, 'Cible introuvable.');
  assert.ok(T.setOrders(room, 'p0', { [B[0].id]: { type: 'hold', stance: 'combat' } }).error, 'unité adverse');
  put(room, B[0], 6, 4);
  assert.match(T.setOrders(room, 'p0', { [A[2].id]: { type: 'charge', targetId: B[0].id } }).error, /tireurs/);
  assert.ok(T.setOrders(room, 'p0', { [A[0].id]: { type: 'charge', targetId: B[0].id, facing: 2 } }).ok);
  T.commit(room, 'p0');
  assert.match(T.setOrders(room, 'p0', { [A[1].id]: { type: 'hold', stance: 'combat' } }).error, /validés/);
});

test('simultané : fin de tour — objectifs, tour suivant, vitesse et ordres réinitialisés, recharge des capacités', () => {
  const { room, A, B, T } = setup();
  const gen = units(room, 'p0').general;
  put(room, A[0], 4, 6); put(room, B[0], 12, 1);
  order(room, 'p0', { [A[0].id]: { type: 'move', path: [[5, 6], [6, 6]] }, [gen.id]: { type: 'hold', ability: {} } });
  const res = T.resolve(room, 15);
  assert.ok(events(res, 'p1').some(e => e.k === 'ability' && e.name), 'capacité annoncée à tous');
  assert.equal(room.turn, 2);
  assert.equal(room.objectives[0].owner, 'p0');
  assert.equal(room.scores.p0, 1, 'points au début du tour suivant');
  assert.equal(A[0].speedRemaining, 3, 'vitesse réinitialisée pour la planification');
  assert.deepEqual(room.sim.orders, {});
  assert.equal(gen.abilityCooldown, 2, 'recharge 3, décomptée en fin de tour');
  assert.ok(room.activeEffects.some(e => e.type === 'power_boost'));
  assert.equal(room.getCurrentPlayerId(), null);
  assert.equal(room.canAct('p0'), false, 'pas d\'action immédiate en mode simultané');
});

test('simultané : duel quand un général attaque le général adverse', () => {
  const room = simRoom();
  const gA = units(room, 'p0').general, gB = units(room, 'p1').general;
  put(room, units(room, 'p0').troops[0], 0, 0); put(room, units(room, 'p1').troops[0], 13, 8);
  put(room, gA, 5, 4); put(room, gB, 6, 4);
  order(room, 'p0', { [gA.id]: { type: 'attack', targetId: gB.id } });
  const res = room.turns.resolve(room, 16);
  const c = combats(res);
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, 'duel');
  assert.ok(c[0].log.duel);
});

test('simultané : unités en fuite au tick 0, motivation', () => {
  const { room, A, B, T } = setup({ p1: [{ typeId: 'soldats', count: 1 }] });
  put(room, A[0], 4, 4); put(room, B[0], 12, 4, { isFleeing: true, morale: 0 });
  const gen = units(room, 'p0').general;
  put(room, gen, 4, 5);
  A[0].morale = 1;
  order(room, 'p0', { [gen.id]: { type: 'motivate' } });
  const res = T.resolve(room, 17);
  const t0 = res.views.p1.ticks[0].events;
  assert.ok(t0.some(e => (e.k === 'fled' || e.k === 'flee') && e.u === B[0].id));
  assert.ok(res.views.p0.ticks[0].events.some(e => e.k === 'motivate' && e.u === gen.id && typeof e.d20 === 'number'));
});

test('simultané : tir de réaction selon la posture prise ce tour (pas celle d\'avant)', () => {
  const run = (stance, ordered) => {
    const { room, A, B, T } = setup({ p0: [{ typeId: 'archer', count: 1 }] });
    put(room, A[0], 4, 4, { stance }); put(room, B[0], 8, 4);
    if (ordered) order(room, 'p0', { [A[0].id]: { type: 'hold', stance: ordered } });
    order(room, 'p1', { [B[0].id]: { type: 'move', path: [[7, 4], [6, 4]] } });
    return combats(T.resolve(room, 18)).filter(e => e.kind === 'reaction').length;
  };
  assert.equal(run('marche', 'defense_distance'), 1, 'posture prise au tick 0 : réagit');
  assert.equal(run('defense_distance', 'combat'), 0, 'posture quittée au tick 0 : ne réagit plus');
});

test('simultané : la posture Repos remplace la Percée (un déplacement arrêté au contact n\'attaque pas)', () => {
  const { room, A, B, T } = setup();
  assert.match(T.setOrders(room, 'p0', { [A[0].id]: { type: 'hold', stance: 'percee' } }).error, /Posture/);
  put(room, A[0], 4, 4); put(room, B[0], 7, 3, { stance: 'repos' });
  order(room, 'p0', { [A[0].id]: { type: 'move', path: [[5, 4], [6, 4], [7, 4]] } });
  const res = T.resolve(room, 19);
  assert.equal(combats(res).length, 0);
  assert.deepEqual(at(A[0]), [6, 4]);
});

test('simultané : capacités d\'unité en ordre (bâtisseurs, assassin) au début de la résolution ; char qui piétine', () => {
  const { room, A, B, T } = setup({ p0: [{ typeId: 'batisseurs', count: 1 }, { typeId: 'assassin', count: 1 }, { typeId: 'char', count: 1 }], p1: [{ typeId: 'soldats', count: 2 }] });
  const b = A.find(u => u.typeId === 'batisseurs'), a = A.find(u => u.typeId === 'assassin'), c = A.find(u => u.typeId === 'char');
  put(room, b, 2, 2); put(room, a, 0, 1); put(room, c, 4, 4); put(room, B[0], 5, 4); put(room, B[1], 6, 4);
  assert.ok(room.turns.setOrders(room, 'p0', { [b.id]: { type: 'hold', unitAbility: { kind: 'build', build: 'pont', q: 3, r: 2 } } }).error, 'pas de rivière ici');
  order(room, 'p0', {
    [b.id]: { type: 'hold', unitAbility: { kind: 'build', build: 'barriere', q: 3, r: 2 } },
    [a.id]: { type: 'hold', unitAbility: { kind: 'vanish' } },
    [c.id]: { type: 'attack', targetId: B[0].id },
  });
  const res = T.resolve(room, 11);
  const { segmentEdgeKey } = require('../game/HexUtils');
  assert.equal(room.segmentData[segmentEdgeKey(2, 2, 3, 2)], 'barriere');
  assert.ok(events(res, 'p0').some(e => e.k === 'map_edit'));
  assert.equal(a.vanishedDay, room.dayNumber());
  const hit = combats(res, 'p0').filter(e => e.log.attackerId === c.id);
  assert.equal(hit.length, 1);
  assert.equal(hit[0].log.targetId, B[0].id);
});

test('simultané : posture sur une étape du trajet — payée au départ, prise après le n-ième pas', () => {
  const { room, A, T } = setup();
  put(room, A[0], 2, 4, { speed: 6, stance: 'marche' });
  assert.match(T.setOrders(room, 'p0', { [A[0].id]: { type: 'move', path: [[3, 4], [4, 4], [5, 4]], stance: 'defense_combat', stanceAt: 5 } }).error, /posture/);
  order(room, 'p0', { [A[0].id]: { type: 'move', path: [[3, 4], [4, 4], [5, 4]], stance: 'defense_combat', stanceAt: 2 } });
  const res = T.resolve(room, 3);
  const ev = events(res).filter(e => e.u === A[0].id);
  const st = ev.find(e => e.k === 'stance');
  assert.ok(st, 'changement de posture');
  assert.ok(st.t > 0, 'pas au tick 0');
  const movesBefore = ev.filter(e => e.k === 'move' && e.t <= st.t).length;
  assert.equal(movesBefore, 2, 'après le 2e pas');
  assert.deepEqual(at(A[0]), [5, 4]);
  assert.equal(A[0].stance, 'defense_combat');
});
