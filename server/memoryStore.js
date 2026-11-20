// In-memory room/connection store for the local server. Rooms are serialized per room through a promise queue.
// roundTrip: true stores rooms as JSON (serialize/deserialize on every access), like the DynamoDB store does.
const GameRoom = require('../game/GameRoom');

function createMemoryStore({ roundTrip = false } = {}) {
  const rooms = new Map();
  const conns = new Map();
  const queues = new Map();

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
  };
}

module.exports = { createMemoryStore };
