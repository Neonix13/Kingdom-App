// Balance data store: tables live in data/balance/<table>.json and are exposed by game/data/<table>.js.
// Files are read with fs (not require) so that `node --watch` does not restart the server on save.
// reload() refills the exported objects in place: every module that required them sees the new values.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SPEC, TABLES, validateTable, idsOf } = require('./schema');

const DIR = __dirname;
const HISTORY_DIR = path.join(DIR, 'history');
const HISTORY_RE = new RegExp(`^(${TABLES.join('|')})_(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z)(?:-(\\d+))?\\.json$`);
const HISTORY_KEEP = 100;

const live = {};
const versions = {};

const filePath = (t) => path.join(DIR, `${t}.json`);
const hash = (raw) => crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12);
const serialize = (data) => JSON.stringify(data, null, 2) + '\n';

function assertTable(t) {
  if (!TABLES.includes(t)) throw Object.assign(new Error(`Table inconnue « ${t} ».`), { status: 404 });
}

function readFile(t) {
  const raw = fs.readFileSync(filePath(t), 'utf8');
  return { raw, data: JSON.parse(raw), version: hash(raw) };
}

function fill(target, data) {
  if (Array.isArray(target)) {
    target.length = 0;
    target.push(...data);
  } else {
    for (const k of Object.keys(target)) delete target[k];
    Object.assign(target, data);
  }
}

function table(t) {
  assertTable(t);
  if (!live[t]) {
    const { data, version } = readFile(t);
    live[t] = data;
    versions[t] = version;
  }
  return live[t];
}

// Re-reads the JSON files and refills the loaded tables in place. Everything is parsed and validated
// before anything is swapped, so a broken file leaves the previous data in memory.
function reload(only) {
  const list = only ? [only] : TABLES;
  list.forEach(assertTable);
  const next = {};
  for (const t of list) {
    const file = readFile(t);
    const errors = validateTable(t, file.data);
    if (errors.length) throw Object.assign(new Error(`${t}.json invalide : ${errors[0].message}`), { status: 400, details: errors });
    next[t] = file;
  }
  for (const t of list) {
    if (live[t]) fill(live[t], next[t].data);
    else live[t] = next[t].data;
    versions[t] = next[t].version;
  }
  return { ...versions };
}

function version(t) {
  table(t);
  return versions[t];
}

function globalVersion() {
  return hash(TABLES.map((t) => version(t)).join(':'));
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function backup(t, raw) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  const base = `${t}_${stamp()}`;
  let name = `${base}.json`;
  for (let i = 2; fs.existsSync(path.join(HISTORY_DIR, name)); i++) name = `${base}-${i}.json`;
  fs.writeFileSync(path.join(HISTORY_DIR, name), raw);
  const old = listHistory(t).slice(HISTORY_KEEP);
  for (const h of old) fs.rmSync(path.join(HISTORY_DIR, h.file), { force: true });
  return name;
}

// Validates and writes a table, keeping the replaced version in history/, then reloads it.
// baseVersion (optional) is the version the editor started from: a mismatch means someone saved in between.
function save(t, data, { baseVersion } = {}) {
  assertTable(t);
  const current = readFile(t);
  if (baseVersion && baseVersion !== current.version) {
    throw Object.assign(new Error('La table a été modifiée entre-temps : rechargez avant d\'enregistrer.'), { status: 409, version: current.version });
  }
  const errors = validateTable(t, data, idsOf(t, current.data));
  if (errors.length) throw Object.assign(new Error(`Données invalides (${errors.length} erreur${errors.length > 1 ? 's' : ''}).`), { status: 400, details: errors });
  const raw = serialize(data);
  if (raw === current.raw) return { version: current.version, unchanged: true, backup: null };
  const name = backup(t, current.raw);
  writeAtomic(filePath(t), raw);
  reload(t);
  return { version: versions[t], unchanged: false, backup: name };
}

function listHistory(only) {
  let files = [];
  try { files = fs.readdirSync(HISTORY_DIR); } catch (e) { return []; }
  const out = [];
  for (const file of files) {
    const m = HISTORY_RE.exec(file);
    if (!m || (only && m[1] !== only)) continue;
    const iso = m[2].replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, '$1:$2:$3.$4Z');
    out.push({ file, table: m[1], replacedAt: iso, seq: Number(m[3] || 1), size: fs.statSync(path.join(HISTORY_DIR, file)).size });
  }
  return out.sort((a, b) => (b.replacedAt.localeCompare(a.replacedAt)) || (b.seq - a.seq)).map(({ seq, ...h }) => h);
}

function readHistory(file) {
  const m = HISTORY_RE.exec(String(file));
  if (!m) throw Object.assign(new Error('Fichier d\'historique invalide.'), { status: 400 });
  let raw;
  try { raw = fs.readFileSync(path.join(HISTORY_DIR, file), 'utf8'); } catch (e) {
    throw Object.assign(new Error('Version introuvable.'), { status: 404 });
  }
  return { table: m[1], data: JSON.parse(raw), version: hash(raw) };
}

function restore(file, opts = {}) {
  const h = readHistory(file);
  return { table: h.table, ...save(h.table, h.data, opts) };
}

// Server only: reloads a table when its file changes on disk outside the API (hand edit, git checkout, another process)
let watching = false;
function watch(log = console) {
  if (watching) return;
  watching = true;
  for (const t of TABLES) {
    fs.watchFile(filePath(t), { interval: 2000, persistent: false }, () => {
      if (!live[t]) return;
      let raw;
      try { raw = fs.readFileSync(filePath(t), 'utf8'); } catch (e) { return; }
      if (hash(raw) === versions[t]) return;
      try { reload(t); log.log(`[balance] ${t}.json rechargé (modifié sur le disque).`); } catch (e) { log.error(`[balance] ${t}.json ignoré : ${e.message}`); }
    });
  }
}

function all() {
  const tables = {};
  for (const t of TABLES) tables[t] = table(t);
  return tables;
}

module.exports = { TABLES, SPEC, table, reload, watch, version, globalVersion, save, listHistory, readHistory, restore, all, serialize, validateTable, idsOf };
