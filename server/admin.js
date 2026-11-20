// Simple admin access: one password from ADMIN_PASSWORD env var or config.local.json { "adminPassword": "..." }.
// Sessions are random tokens in an HttpOnly cookie, kept in memory (reset on server restart).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COOKIE = 'kb_admin';
const SESSION_MS = 12 * 3600 * 1000;
const sessions = new Map();

function adminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.local.json'), 'utf8'));
    return cfg.adminPassword || null;
  } catch (e) {
    return null;
  }
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isAdmin(req) {
  const token = parseCookies(req)[COOKIE];
  const s = token && sessions.get(token);
  if (!s) return false;
  if (Date.now() > s.expires) { sessions.delete(token); return false; }
  return true;
}

function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Accès administrateur requis.' });
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function mountAdmin(app) {
  app.post('/api/admin/login', (req, res) => {
    const pwd = adminPassword();
    if (!pwd) return res.status(503).json({ error: 'Aucun mot de passe admin configuré (ADMIN_PASSWORD ou config.local.json).' });
    if (!req.body || !safeEqual(req.body.password || '', pwd)) return res.status(401).json({ error: 'Mot de passe incorrect.' });
    const token = crypto.randomBytes(24).toString('hex');
    sessions.set(token, { expires: Date.now() + SESSION_MS });
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
    res.json({ ok: true });
  });
  app.post('/api/admin/logout', (req, res) => {
    const token = parseCookies(req)[COOKIE];
    if (token) sessions.delete(token);
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });
  app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(req), configured: !!adminPassword() }));
}

module.exports = { mountAdmin, requireAdmin, isAdmin };
