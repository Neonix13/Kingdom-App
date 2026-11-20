// Balance editor API: game data tables (data/balance/*.json), history/restore, and balance simulations
// run in a separate process (simulation/run.js) so they never block the game server.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const balance = require('../data/balance');
const { requireAdmin } = require('./admin');

const ROOT = path.join(__dirname, '..');
const SIM_DIR = path.join(ROOT, 'simulation');
const SIM_SCRIPT = path.join(SIM_DIR, 'run.js');
const SIM_OUTPUT = path.join(SIM_DIR, 'results');
const REPORT_DIR_RE = /^results[A-Za-z0-9_-]*$/;
const REPORT_FILE_RE = /^report_[0-9T-]+\.json$/;
const MAX_THREADS = Math.max(1, Math.min(8, os.cpus().length - 2));
const LIMITS = { gamesPerMatchup: [1, 500], budget: [500, 50000], threads: [1, MAX_THREADS] };

function handle(res, fn) {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(fn());
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message, details: e.details || null, version: e.version || null });
  }
}

// ---- simulation runner (one run at a time) ----

let run = null;
let runSeq = 0;

function publicRun() {
  if (!run) return null;
  const { child, ...r } = run;
  return { ...r, log: r.log.slice(-40) };
}

function clampInt(v, [min, max], name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw Object.assign(new Error(`${name} : entier entre ${min} et ${max} attendu.`), { status: 400 });
  return n;
}

function startSimulation(body = {}) {
  if (run && run.status === 'running') throw Object.assign(new Error('Une simulation est déjà en cours.'), { status: 409 });
  const params = {
    gamesPerMatchup: clampInt(body.gamesPerMatchup ?? 10, LIMITS.gamesPerMatchup, 'Parties par affrontement'),
    budget: clampInt(body.budget ?? 5000, LIMITS.budget, 'Budget'),
    threads: clampInt(body.threads ?? Math.min(4, MAX_THREADS), LIMITS.threads, 'Threads'),
    initiative: body.initiative !== false,
  };
  const args = ['--games', String(params.gamesPerMatchup), '--budget', String(params.budget), '--threads', String(params.threads), '--output', SIM_OUTPUT];
  if (!params.initiative) args.push('--no-initiative');
  const child = fork(SIM_SCRIPT, args, { cwd: ROOT, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  try { os.setPriority(child.pid, 10); } catch (e) { /* not permitted */ }
  const generals = balance.table('generals').length;
  run = {
    id: ++runSeq, status: 'running', params, child,
    done: 0, total: generals * generals * params.gamesPerMatchup,
    startedAt: new Date().toISOString(), endedAt: null,
    report: null, error: null, balanceVersion: balance.globalVersion(), log: [],
  };
  const r = run;
  const onData = (buf) => {
    for (const line of buf.toString().split('\n')) if (line.trim()) r.log.push(line.replace(/\s+$/, ''));
    if (r.log.length > 400) r.log.splice(0, r.log.length - 400);
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'progress') { r.done = m.done; r.total = m.total; }
    if (m.type === 'done' && m.reportPath) r.report = path.relative(SIM_DIR, m.reportPath).split(path.sep).join('/');
  });
  child.on('exit', (code, signal) => {
    r.endedAt = new Date().toISOString();
    r.child = null;
    if (r.status === 'cancelled') return;
    if (code === 0 && r.report) r.status = 'done';
    else { r.status = 'error'; r.error = signal ? `Interrompue (${signal}).` : `Code de sortie ${code}.`; }
  });
  child.on('error', (e) => { r.status = 'error'; r.error = e.message; r.child = null; });
  return publicRun();
}

function cancelSimulation() {
  if (!run || run.status !== 'running') throw Object.assign(new Error('Aucune simulation en cours.'), { status: 409 });
  run.status = 'cancelled';
  run.endedAt = new Date().toISOString();
  if (run.child) run.child.kill('SIGTERM');
  return publicRun();
}

process.on('exit', () => { if (run && run.child) run.child.kill('SIGTERM'); });

// ---- reports ----

const reportMetaCache = new Map();

function listReports() {
  const out = [];
  for (const dir of fs.readdirSync(SIM_DIR)) {
    if (!REPORT_DIR_RE.test(dir)) continue;
    const full = path.join(SIM_DIR, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const file of fs.readdirSync(full)) {
      if (!REPORT_FILE_RE.test(file)) continue;
      const p = path.join(full, file);
      const st = fs.statSync(p);
      const key = `${dir}/${file}`;
      let meta = reportMetaCache.get(key);
      if (!meta || meta.mtimeMs !== st.mtimeMs) {
        try {
          const r = JSON.parse(fs.readFileSync(p, 'utf8'));
          meta = { mtimeMs: st.mtimeMs, timestamp: r.timestamp || null, totalGames: r.totalGames || 0, errors: r.errors || 0, params: r.params || null, balanceVersion: r.balance ? r.balance.version : null };
        } catch (e) {
          meta = { mtimeMs: st.mtimeMs, timestamp: null, totalGames: 0, errors: 0, params: null, balanceVersion: null, invalid: true };
        }
        reportMetaCache.set(key, meta);
      }
      const { mtimeMs, ...m } = meta;
      out.push({ file: key, dir, size: st.size, ...m });
    }
  }
  return out.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
}

function readReport(dir, file) {
  if (!REPORT_DIR_RE.test(dir) || !REPORT_FILE_RE.test(file)) throw Object.assign(new Error('Rapport invalide.'), { status: 400 });
  try {
    return JSON.parse(fs.readFileSync(path.join(SIM_DIR, dir, file), 'utf8'));
  } catch (e) {
    throw Object.assign(new Error('Rapport introuvable.'), { status: 404 });
  }
}

function mountBalanceRoutes(app) {
  balance.watch();
  app.get('/api/balance', (req, res) => handle(res, () => ({ version: balance.globalVersion(), tables: balance.all() })));
  app.get('/api/balance/schema', (req, res) => handle(res, () => ({ order: balance.TABLES, tables: balance.SPEC })));

  app.get('/api/balance/history', requireAdmin, (req, res) => handle(res, () => balance.listHistory(req.query.table ? String(req.query.table) : undefined)));
  app.get('/api/balance/history/:file', requireAdmin, (req, res) => handle(res, () => balance.readHistory(req.params.file)));
  app.post('/api/balance/history/:file/restore', requireAdmin, (req, res) => handle(res, () => ({ ...balance.restore(req.params.file, { baseVersion: req.body && req.body.baseVersion }), globalVersion: balance.globalVersion() })));
  app.post('/api/balance/reload', requireAdmin, (req, res) => handle(res, () => ({ versions: balance.reload(), version: balance.globalVersion() })));

  app.get('/api/balance/sim', requireAdmin, (req, res) => handle(res, () => ({ run: publicRun(), limits: LIMITS })));
  app.post('/api/balance/sim', requireAdmin, (req, res) => handle(res, () => ({ run: startSimulation(req.body || {}) })));
  app.post('/api/balance/sim/cancel', requireAdmin, (req, res) => handle(res, () => ({ run: cancelSimulation() })));
  app.get('/api/balance/reports', requireAdmin, (req, res) => handle(res, () => listReports()));
  app.get('/api/balance/reports/:dir/:file', requireAdmin, (req, res) => handle(res, () => readReport(req.params.dir, req.params.file)));

  app.get('/api/balance/:table', (req, res) => handle(res, () => {
    const t = req.params.table;
    return { table: t, version: balance.version(t), data: balance.table(t) };
  }));
  app.put('/api/balance/:table', requireAdmin, (req, res) => handle(res, () => {
    const body = req.body || {};
    if (!('data' in body)) throw Object.assign(new Error('Corps attendu : { data, baseVersion }.'), { status: 400 });
    return { table: req.params.table, ...balance.save(req.params.table, body.data, { baseVersion: body.baseVersion }), globalVersion: balance.globalVersion() };
  }));
}

module.exports = { mountBalanceRoutes };
