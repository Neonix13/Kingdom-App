// Balance editor state: saved version vs draft per table, validation from the server field specs, diff and undo
export const state = {
  spec: null,
  order: [],
  saved: {},
  draft: {},
  undo: {},
  redo: {},
  serverErrors: {},
  listeners: new Set(),
};

export const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
export const onChange = (fn) => state.listeners.add(fn);
export const emit = (table) => { for (const fn of state.listeners) fn(table); };

export function init(schema, tables) {
  state.spec = schema.tables;
  state.order = schema.order;
  for (const t of state.order) setSaved(t, tables[t]);
}

export function setSaved(t, { version, data }) {
  state.saved[t] = { version, data: clone(data) };
  state.draft[t] = clone(data);
  state.undo[t] = [];
  state.redo[t] = [];
  state.serverErrors[t] = [];
}

// Flattened columns: { path: ['weapon','damage'], f: fieldSpec, parent: objectSpec|null }
export function columns(t) {
  const out = [];
  for (const f of state.spec[t].fields) {
    if (f.type === 'object') for (const sf of f.fields) out.push({ path: [f.key, sf.key], f: sf, parent: f, label: `${f.label} : ${sf.label}` });
    else out.push({ path: [f.key], f, parent: null, label: f.label });
  }
  return out;
}

export function entries(t, data = state.draft[t]) {
  return state.spec[t].shape === 'list' ? data.map((e) => [e.id, e]) : Object.entries(data);
}

export function entry(t, id, data = state.draft[t]) {
  return state.spec[t].shape === 'list' ? data.find((e) => e.id === id) : data[id];
}

export function getValue(obj, path) {
  let v = obj;
  for (const k of path) { if (v == null) return undefined; v = v[k]; }
  return v;
}

function setValue(obj, path, value, parent) {
  if (path.length === 1) {
    if (value === undefined) delete obj[path[0]]; else obj[path[0]] = value;
    return;
  }
  const [k, sk] = path;
  if (!obj[k] || typeof obj[k] !== 'object') {
    if (value === undefined) return;
    obj[k] = {};
  }
  if (value === undefined) delete obj[k][sk]; else obj[k][sk] = value;
  if (parent && parent.optional && Object.values(obj[k]).every((v) => v === undefined || v === '')) delete obj[k];
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function edit(t, id, col, value, { record = true, coalesce = false } = {}) {
  const e = entry(t, id);
  if (!e) return;
  const before = getValue(e, col.path);
  if (same(before, value)) return;
  const beforeObj = col.parent ? clone(e[col.path[0]]) : undefined;
  setValue(e, col.path, value, col.parent);
  const key = col.path.join('.');
  state.serverErrors[t] = (state.serverErrors[t] || []).filter((se) => !(se.id === id && se.field === key));
  const last = state.undo[t][state.undo[t].length - 1];
  if (record && coalesce && last && last.id === id && same(last.path, col.path) && Date.now() - last.ts < 1500) {
    last.after = value;
    last.ts = Date.now();
    state.redo[t] = [];
  } else if (record) {
    state.undo[t].push({ id, path: col.path, before, after: value, beforeObj, hadObj: beforeObj !== undefined, ts: coalesce ? Date.now() : 0 });
    if (state.undo[t].length > 500) state.undo[t].shift();
    state.redo[t] = [];
  }
  emit(t);
}

export function undo(t) {
  const op = state.undo[t].pop();
  if (!op) return false;
  const e = entry(t, op.id);
  if (op.path.length === 2) {
    if (op.hadObj) e[op.path[0]] = clone(op.beforeObj); else delete e[op.path[0]];
  } else setValue(e, op.path, op.before);
  state.redo[t].push(op);
  emit(t);
  return true;
}

export function redoOp(t) {
  const op = state.redo[t].pop();
  if (!op) return false;
  const e = entry(t, op.id);
  const col = columns(t).find((c) => same(c.path, op.path));
  setValue(e, op.path, op.after, col && col.parent);
  state.undo[t].push(op);
  emit(t);
  return true;
}

export function revertCell(t, id, col) {
  edit(t, id, col, getValue(entry(t, id, state.saved[t].data), col.path));
}

export function discard(t) {
  state.draft[t] = clone(state.saved[t].data);
  state.undo[t] = [];
  state.redo[t] = [];
  state.serverErrors[t] = [];
  emit(t);
}

// Cell-level differences between two versions of a table
export function diff(t, a, b) {
  const out = [];
  const cols = columns(t);
  const ids = new Set([...entries(t, a).map(([id]) => id), ...entries(t, b).map(([id]) => id)]);
  for (const id of ids) {
    const ea = entry(t, id, a);
    const eb = entry(t, id, b);
    if (!ea || !eb) { out.push({ id, col: null, before: ea ? 'présente' : 'absente', after: eb ? 'présente' : 'absente' }); continue; }
    for (const col of cols) {
      const va = getValue(ea, col.path);
      const vb = getValue(eb, col.path);
      if (!same(va, vb)) out.push({ id, col, before: va, after: vb, name: eb.name || ea.name || id });
    }
  }
  return out;
}

export const changes = (t) => diff(t, state.saved[t].data, state.draft[t]);
export const isChanged = (t, id, col) => !same(getValue(entry(t, id), col.path), getValue(entry(t, id, state.saved[t].data), col.path));

function checkField(f, v) {
  if (v === undefined || v === '') {
    if (v === '' && f.type === 'string' && !(f.minLength > 0)) return null;
    return f.optional ? null : `${f.label} : champ requis.`;
  }
  if (v === null) return f.nullable ? null : `${f.label} : valeur requise.`;
  switch (f.type) {
    case 'int':
      if (typeof v !== 'number' || !Number.isInteger(v)) return `${f.label} : nombre entier attendu.`;
      if (v < f.min || v > f.max) return `${f.label} : doit être entre ${f.min} et ${f.max}.`;
      return null;
    case 'string':
      if (typeof v !== 'string') return `${f.label} : texte attendu.`;
      if (v.length < (f.minLength || 0)) return `${f.label} : requis.`;
      if (v.length > f.maxLength) return `${f.label} : ${f.maxLength} caractères maximum.`;
      if (f.pattern && !new RegExp(f.pattern).test(v)) return `${f.label} : format invalide${f.hint ? ` (${f.hint})` : ''}.`;
      return null;
    case 'bool':
      return typeof v === 'boolean' ? null : `${f.label} : vrai/faux attendu.`;
    case 'enum':
      return f.options.includes(v) ? null : `${f.label} : valeur inconnue.`;
    default:
      return null;
  }
}

// Returns Map key `${id}|${path}` -> message
export function validate(t) {
  const errs = new Map();
  const spec = state.spec[t];
  for (const [id, e] of entries(t)) {
    for (const col of columns(t)) {
      if (col.parent && col.parent.optional && e[col.path[0]] === undefined) continue;
      const msg = checkField(col.f, getValue(e, col.path));
      if (msg) errs.set(`${id}|${col.path.join('.')}`, msg);
    }
    for (const r of spec.rules || []) {
      if (r.type === 'lte' && Number.isInteger(e[r.a]) && Number.isInteger(e[r.b]) && e[r.a] > e[r.b]) {
        errs.set(`${id}|${r.a}`, r.message);
        errs.set(`${id}|${r.b}`, r.message);
      }
    }
  }
  for (const se of state.serverErrors[t] || []) {
    const k = `${se.id}|${se.field || 'id'}`;
    if (!errs.has(k)) errs.set(k, se.message);
  }
  return errs;
}

export function fmt(v) {
  if (v === undefined) return '∅';
  if (v === null) return '—';
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  if (typeof v === 'string') return v.length > 50 ? `« ${v.slice(0, 50)}… »` : `« ${v} »`;
  return String(v);
}
