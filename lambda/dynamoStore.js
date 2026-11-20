// DynamoDB store for the protocol. Rooms: { roomCode, data, version, ttl }; Connections: { connectionId, roomCode, memberId, ttl }.
// Writes are conditional on the version read (optimistic locking); conflicting updates are retried.
const { GetCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const GameRoom = require('../game/GameRoom');

const MAX_ATTEMPTS = 6;

function isConflict(e) {
  return e && (e.name === 'ConditionalCheckFailedException' || e.__type === 'ConditionalCheckFailedException');
}

function createDynamoStore(ddb, { roomsTable, connectionsTable, roomTtlSec = 86400 * 3, connTtlSec = 3600 * 6 } = {}) {
  const ttl = (sec) => Math.floor(Date.now() / 1000) + sec;

  async function readRoom(code) {
    const res = await ddb.send(new GetCommand({ TableName: roomsTable, Key: { roomCode: code }, ConsistentRead: true }));
    return res.Item || null;
  }

  async function writeRoom(room, version) {
    await ddb.send(new PutCommand({
      TableName: roomsTable,
      Item: { roomCode: room.roomCode, data: room.serialize(), version: version + 1, ttl: ttl(roomTtlSec) },
      ConditionExpression: 'attribute_not_exists(version) OR version = :v',
      ExpressionAttributeValues: { ':v': version },
    }));
  }

  return {
    async get(code) {
      const item = await readRoom(code);
      return item ? GameRoom.deserialize(item.data) : null;
    },
    async create(room) {
      try {
        await ddb.send(new PutCommand({
          TableName: roomsTable,
          Item: { roomCode: room.roomCode, data: room.serialize(), version: 1, ttl: ttl(roomTtlSec) },
          ConditionExpression: 'attribute_not_exists(roomCode)',
        }));
        return true;
      } catch (e) {
        if (isConflict(e)) return false;
        throw e;
      }
    },
    async update(code, fn) {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const item = await readRoom(code);
        if (!item) return null;
        const version = item.version || 0;
        const room = GameRoom.deserialize(item.data);
        const res = (await fn(room)) || {};
        try {
          if (res.remove) {
            await ddb.send(new DeleteCommand({
              TableName: roomsTable, Key: { roomCode: code },
              ConditionExpression: 'attribute_not_exists(version) OR version = :v',
              ExpressionAttributeValues: { ':v': version },
            }));
          } else if (res.save) {
            await writeRoom(room, version);
          }
          return room;
        } catch (e) {
          if (!isConflict(e)) throw e;
          await new Promise(r => setTimeout(r, 15 + Math.random() * 40 * (attempt + 1)));
        }
      }
      throw new Error(`Conflit d'écriture persistant sur la salle ${code}`);
    },
    async getConn(connectionId) {
      const res = await ddb.send(new GetCommand({ TableName: connectionsTable, Key: { connectionId } }));
      return res.Item || null;
    },
    async putConn(connectionId, rec) {
      await ddb.send(new PutCommand({ TableName: connectionsTable, Item: { connectionId, roomCode: rec.roomCode, memberId: rec.memberId, ttl: ttl(connTtlSec) } }));
    },
    async touchConn(connectionId) {
      const rec = await this.getConn(connectionId);
      if (rec) await this.putConn(connectionId, rec);
    },
    async deleteConn(connectionId) {
      await ddb.send(new DeleteCommand({ TableName: connectionsTable, Key: { connectionId } }));
    },
  };
}

module.exports = { createDynamoStore };
