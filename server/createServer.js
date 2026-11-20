const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');
const { createProtocol } = require('../game/protocol');
const { createMemoryStore } = require('./memoryStore');

const ROOT = path.join(__dirname, '..');
const MAX_MESSAGES_PER_SECOND = 40;

function createServer({ livereload = false, config = {}, log = console } = {}) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server, maxPayload: 64 * 1024 });
  let lrServer = null;

  if (livereload) {
    const lr = require('livereload');
    lrServer = lr.createServer({ exts: ['html', 'js', 'css', 'json'] });
    lrServer.watch(path.join(ROOT, 'public'));
    app.use(require('connect-livereload')());
  }
  app.use(express.json({ limit: '5mb' }));
  require('./admin').mountAdmin(app);
  require('./mapRoutes').mountMapRoutes(app);
  require('./editorRoutes').mountEditorRoutes(app);
  require('./balanceRoutes').mountBalanceRoutes(app);
  app.get('/join/:code', (req, res) => res.redirect(`/?join=${encodeURIComponent(String(req.params.code).toUpperCase().replace(/[^A-Z0-9]/g, ''))}`));
  app.get('/audio/music/manifest.json', (req, res, next) => {
    if (fs.existsSync(path.join(ROOT, 'public/audio/music/manifest.json'))) return next();
    res.json({ format: 'kb-music-1', states: {} });
  });
  app.use(express.static(path.join(ROOT, 'public')));
  app.use('/simulation/results', express.static(path.join(ROOT, 'simulation/results')));

  const connections = new Map();
  const timers = new Map();
  const store = createMemoryStore();

  const transport = {
    async send(connId, msg) {
      const ws = connections.get(connId);
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(msg));
      return true;
    },
  };

  const scheduler = {
    schedule(code, at) {
      clearTimeout(timers.get(code));
      const delay = Math.max(0, Math.min(at - Date.now(), 0x7fffffff)) + 20;
      const t = setTimeout(() => { timers.delete(code); protocol.tick(code); }, delay);
      if (t.unref) t.unref();
      timers.set(code, t);
    },
  };

  const protocol = createProtocol({ store, transport, scheduler, config, log });

  wss.on('connection', (ws) => {
    const connId = crypto.randomBytes(12).toString('base64url');
    connections.set(connId, ws);
    ws.isAlive = true;
    let windowStart = Date.now();
    let count = 0;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (raw) => {
      const t = Date.now();
      if (t - windowStart > 1000) { windowStart = t; count = 0; }
      if (++count > MAX_MESSAGES_PER_SECOND) return;
      let parsed;
      try { parsed = JSON.parse(raw); } catch (e) { return; }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const { action, ...data } = parsed;
      protocol.handle(connId, action, data);
    });
    ws.on('close', () => {
      connections.delete(connId);
      protocol.disconnect(connId);
    });
    ws.on('error', () => {});
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (e) { /* closing */ }
    }
  }, 30000);
  heartbeat.unref();

  return {
    app, server, wss, store, protocol,
    listen(port) {
      return new Promise((resolve) => server.listen(port, () => resolve(server.address().port)));
    },
    close() {
      clearInterval(heartbeat);
      for (const t of timers.values()) clearTimeout(t);
      for (const ws of wss.clients) ws.terminate();
      if (lrServer) lrServer.close();
      return new Promise((resolve) => wss.close(() => server.close(() => resolve())));
    },
  };
}

module.exports = { createServer };
