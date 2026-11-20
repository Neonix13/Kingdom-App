// In-memory room/connection store for the local server. Rooms are serialized per room through a promise queue.
// roundTrip: true stores rooms as JSON (serialize/deserialize on every access), like the DynamoDB store does.
// persistFile: rooms past the lobby are saved there every few seconds and restored at start (games survive a server
// restart; players come back with the session token kept by their browser).
const fs = require('fs');
const GameRoom = require('../game/GameRoom');

function createMemoryStore({ roundTrip = false, persistFile = null, persistMs = 5000, log = console } = {}) {
  const rooms = new Map();
  const conns = new Map();
  const queues = new Map();
  let saveTimer = null;

  function saveAll() {
    try {
      const data = {};
      for (const [code, stored] of rooms) {
        const plain = roundTrip ? JSON.parse(stored) : stored.serialize();
        if (plain.phase === 'lobby' || plain.phase === 'ended') continue;
        data[code] = plain;
      }
      fs.writeFileSync(persistFile, JSON.stringify(data));
    } catch (e) { log.error('[rooms] sauvegarde impossible :', e.message); }
  }

  function loadAll() {
    try {
      if (!fs.existsSync(persistFile)) return;
      const data = JSON.parse(fs.readFileSync(persistFile, 'utf8'));
      for (const [code, d] of Object.entries(data)) {
        try {
          const room = GameRoom.deserialize(d);
          for (const m of [...room.players, ...room.spectators]) {
            m.connId = null;
            if (!m.isBot) { m.connected = false; m.disconnectedAt = Date.now(); }
          }
          rooms.set(code, roundTrip ? JSON.stringify(room.serialize()) : room);
          log.log(`[rooms] salle restaurée : ${code} (${room.phase})`);
        } catch (e) { log.error(`[rooms] restauration impossible de ${code} :`, e.message); }
      }
    } catch (e) { log.error('[rooms] lecture impossible :', e.message); }
  }

  if (persistFile) {
    loadAll();
    saveTimer = setInterval(saveAll, persistMs);
    if (saveTimer.unref) saveTimer.unref();
  }

  function serial(code, fn) {
    const prev = queues.get(code) || Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    queues.set(code, tail);
    tail.then(() => { if (queues.get(code) === tail) queues.delete(code); });
    return run;
  }

  function load(code) {
    const stored = rooms.get(code);
    if (!stored) return null;
    return roundTrip ? GameRoom.deserialize(JSON.parse(stored)) : stored;
  }

  function persist(room) {
    rooms.set(room.roomCode, roundTrip ? JSON.stringify(room.serialize()) : room);
  }

  return {
    rooms,
    conns,
    async get(code) {
      return load(code);
    },
    async create(room) {
      if (rooms.has(room.roomCode)) return false;
      persist(room);
      return true;
    },
    update(code, fn) {
      return serial(code, async () => {
        const room = load(code);
        if (!room) return null;
        const res = (await fn(room)) || {};
        if (res.remove) {
          rooms.delete(code);
          for (const [connId, rec] of conns) if (rec.roomCode === code) conns.delete(connId);
        } else if (res.save) {
          persist(room);
        }
        return room;
      });
    },
    async getConn(connId) {
      return conns.get(connId) || null;
    },
    async putConn(connId, rec) {
      conns.set(connId, rec);
    },
    async deleteConn(connId) {
      conns.delete(connId);
    },
    listRoomCodes() {
      return [...rooms.keys()];
    },
    saveNow() {
      if (persistFile) saveAll();
    },
    stop() {
      clearInterval(saveTimer);
    },
  };
}

module.exports = { createMemoryStore };
