// AWS API Gateway WebSocket adapter: same protocol as the local server (game/protocol.js), DynamoDB persistence.
// Deadlines (defense timer, absent players) have no timer here: they are processed on every incoming message,
// and clients send { action: 'tick' } every 15 s while in a room.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { createProtocol } = require('../game/protocol');
const { createDynamoStore } = require('./dynamoStore');

function apiGatewayTransport(client, log) {
  return {
    async send(connectionId, msg) {
      try {
        await client.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: Buffer.from(JSON.stringify(msg)) }));
        return true;
      } catch (e) {
        if (e.$metadata?.httpStatusCode === 410 || e.name === 'GoneException') return false;
        log.error('[send]', connectionId, e.name || e.message);
        return true;
      }
    },
  };
}

function createHandler({ ddb, apigwFactory, roomsTable, connectionsTable, config, log = console } = {}) {
  const docClient = ddb || DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const store = createDynamoStore(docClient, {
    roomsTable: roomsTable || process.env.ROOMS_TABLE || 'KingdomRooms',
    connectionsTable: connectionsTable || process.env.CONNECTIONS_TABLE || 'KingdomConnections',
  });
  const makeApigw = apigwFactory || ((endpoint) => new ApiGatewayManagementApiClient({ endpoint }));
  const clients = new Map();

  return async (event) => {
    const { connectionId, routeKey, domainName, stage } = event.requestContext;
    const endpoint = `https://${domainName}/${stage}`;
    if (!clients.has(endpoint)) clients.set(endpoint, makeApigw(endpoint));
    const protocol = createProtocol({ store, transport: apiGatewayTransport(clients.get(endpoint), log), config, log });

    if (routeKey === '$connect') return { statusCode: 200 };
    if (routeKey === '$disconnect') {
      await protocol.disconnect(connectionId);
      return { statusCode: 200 };
    }

    let parsed;
    try { parsed = JSON.parse(event.body); } catch (e) { return { statusCode: 400 }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { statusCode: 400 };
    const { action, ...data } = parsed;
    await protocol.handle(connectionId, action, data);
    return { statusCode: 200 };
  };
}

let defaultHandler = null;
exports.handler = (event) => {
  defaultHandler = defaultHandler || createHandler();
  return defaultHandler(event);
};
exports.createHandler = createHandler;
