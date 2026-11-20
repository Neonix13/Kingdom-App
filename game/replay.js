// Battle replay recorder. A room records one replay per battle (opt-in: GameRoom option `record`), fetched with
// the `get_replay` action once the game has ended (it reveals everything).
//
// Format (kb-replay-1), compact so it fits in the stored room:
// {
//   format: 'kb-replay-1', mapId, settings, startedAt, endedAt, truncated,
//   players: [{ id, name, color, generalId }],
//   roster:  [{ id, playerId, typeId, name, isGeneral, category, maxVitality, maxMorale }],   // every unit of the battle
//   keyframes: [{ e, turn, manche, currentPlayerId, timeOfDay, isNight, units: [[id, q, r, vitality, morale, facing, stance, flags]] }],
//              // e = index in events where the keyframe applies (state BEFORE events[e]); flags: 1 fleeing, 2 concealed terrain
//              // taken at battle start and at the start of every player turn; units absent from a keyframe are dead / gone
//   events: [ { k, turn, manche, ... } ]  (k = kind)
//     move     { u, path: [[q, r], ...] (starts at the origin), ambush?: unitId }
//     combat   { log: combatLog without the breakdown }          (log.duel present for general duels)
//     stance   { u, s }            facing { u, f }
//     motivate { u, success, count }   ability { u, name, effects }
//     fled     { units: [unitId] }     capture { id, owner }      score { scores }
//     turn     { currentPlayerId, timeOfDay, isNight }             end { winnerId, reason }
// }
const MAX_BYTES = 200000;

function unitTuple(u) {
  const flags = (u.isFleeing ? 1 : 0);
  return [u.id, u.q, u.r, u.vitality, u.isGeneral ? null : u.morale, u.facing, u.stance || null, flags];
}

function createReplay(room) {
  const roster = [];
  for (const p of room.players) for (const u of p.units) {
    if (u.q === null) continue;
    roster.push({ id: u.id, playerId: p.id, typeId: u.typeId, name: u.name, isGeneral: !!u.isGeneral, category: u.category, maxVitality: u.maxVitality, maxMorale: u.isGeneral ? null : u.maxMorale });
  }
  const rep = {
    format: 'kb-replay-1',
    mapId: room.mapId,
    settings: { ...room.settings },
    startedAt: Date.now(),
    endedAt: null,
    truncated: false,
    players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color || '#4a90d9', generalId: p.generalId })),
    roster,
    keyframes: [],
    events: [],
    _bytes: 0,
  };
  rep._bytes = JSON.stringify(rep).length;
  return rep;
}

function push(rep, list, item, force = false) {
  if (!rep || (rep.truncated && !force)) return false;
  const size = JSON.stringify(item).length + 1;
  if (!force && rep._bytes + size > MAX_BYTES) { rep.truncated = true; return false; }
  rep._bytes += size;
  rep[list].push(item);
  return true;
}

function keyframe(rep, room, force = false) {
  if (!rep) return;
  const units = [];
  for (const p of room.players) for (const u of p.units) if (u.q !== null) units.push(unitTuple(u));
  push(rep, 'keyframes', {
    e: rep.events.length, turn: room.turn, manche: room.manche, currentPlayerId: room.getCurrentPlayerId(),
    timeOfDay: room.timeOfDay(), isNight: room.isNight(), units,
  }, force);
}

function event(rep, room, k, data) {
  if (!rep) return;
  push(rep, 'events', { k, turn: room.turn, manche: room.manche, ...data });
}

function finish(rep, room) {
  if (!rep) return;
  rep.endedAt = Date.now();
  keyframe(rep, room, true);
}

function exportReplay(rep) {
  if (!rep) return null;
  const { _bytes, ...out } = rep;
  return out;
}

module.exports = { createReplay, keyframe, event, finish, exportReplay, MAX_BYTES };
