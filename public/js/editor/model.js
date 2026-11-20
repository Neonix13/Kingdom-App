// Editable map model (format 2) with patch-based undo/redo
import { parseKey, parseEdge, edgeKey } from './hex.js';
import { KEY_RE } from './constants.js';

const KNOWN_TOP = new Set(['format', 'id', 'name', 'description', 'author', 'updatedAt', 'background', 'height', 'terrain', 'segments', 'decor', 'zones', 'objectives']);
const HISTORY_MAX = 300;
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

export class MapModel {
  constructor() {
    this.listeners = new Set();
    this.reset();
  }

  reset() {
    this.meta = { id: '', name: '', description: '', author: '', updatedAt: null, background: null };
    this.extra = {};
    this.height = new Map();
    this.terrain = new Map();
    this.segments = new Map();
    this.fields = new Set();
    this.ramparts = new Set();
    this.props = [];
    this.decorExtra = {};
    this.zoneOf = new Map();
    this.zoneCount = 0;
    this.zoneMeta = [];
    this.objectives = [];
    this.undoStack = [];
    this.redoStack = [];
    this.tx = null;
    this.txSeq = 0;
    this.savedTop = 0;
  }

  // ---------- load / export ----------
  load(doc) {
    this.reset();
    doc = doc || {};
    for (const [k, v] of Object.entries(doc)) if (!KNOWN_TOP.has(k)) this.extra[k] = clone(v);
    this.meta = {
      id: doc.id || '',
      name: doc.name || '',
      description: doc.description || '',
      author: doc.author || '',
      updatedAt: doc.updatedAt || null,
      background: doc.background ? clone(doc.background) : null,
    };
    for (const [k, v] of Object.entries(doc.height || {})) this.height.set(k, v);
    for (const [k, v] of Object.entries(doc.terrain || {})) if (v && v !== 'plain') this.terrain.set(k, v);
    for (const [k, v] of Object.entries(doc.segments || {})) {
      const e = parseEdge(k);
      const ck = e ? edgeKey(e.q1, e.r1, e.q2, e.r2) : k;
      this.segments.set(ck, v);
    }
    const decor = doc.decor || {};
    for (const [k, v] of Object.entries(decor)) if (k !== 'fields' && k !== 'ramparts' && k !== 'props') this.decorExtra[k] = clone(v);
    for (const k of decor.fields || []) this.fields.add(k);
    for (const k of decor.ramparts || []) this.ramparts.add(k);
    this.props = Array.isArray(decor.props) ? clone(decor.props) : [];
    const zones = Array.isArray(doc.zones) ? doc.zones : [];
    this.zoneCount = zones.length;
    zones.forEach((z, i) => {
      const { tiles, ...rest } = z || {};
      this.zoneMeta[i] = rest;
      for (const k of tiles || []) if (!this.zoneOf.has(k)) this.zoneOf.set(k, i);
    });
    this.objectives = Array.isArray(doc.objectives) ? clone(doc.objectives) : [];
    this.emit({ all: true });
  }

  toDoc() {
    const zones = [];
    for (let i = 0; i < this.zoneCount; i++) zones.push({ ...(this.zoneMeta[i] || {}), tiles: [] });
    for (const [k, z] of this.zoneOf) if (zones[z]) zones[z].tiles.push(k);
    const decor = { ...clone(this.decorExtra), fields: [...this.fields] };
    if (this.ramparts.size) decor.ramparts = [...this.ramparts];
    if (this.props.length) decor.props = clone(this.props);
    return {
      ...clone(this.extra),
      format: 2,
      id: this.meta.id,
      name: this.meta.name,
      description: this.meta.description || '',
      author: this.meta.author || '',
      updatedAt: this.meta.updatedAt || new Date().toISOString(),
      background: this.meta.background ? clone(this.meta.background) : null,
      height: Object.fromEntries(this.height),
      terrain: Object.fromEntries(this.terrain),
      segments: Object.fromEntries(this.segments),
      decor,
      zones: this.zoneCount ? zones : [],
      objectives: clone(this.objectives),
    };
  }

  topId() { const t = this.undoStack[this.undoStack.length - 1]; return t ? t.id : 0; }
  get dirty() { return !!(this.tx && this.tx.ops.length) || this.topId() !== this.savedTop; }
  markSaved() { if (this.tx) this.commit(); this.savedTop = this.topId(); this.emit({ saved: true }); }
  markDirty() { this.savedTop = -1; this.emit({ saved: false }); }

  // ---------- events ----------
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ch) { for (const fn of this.listeners) fn(ch); }

  // ---------- transactions ----------
  begin(label) {
    if (this.tx) this.commit();
    this.tx = { label, ops: [], layers: new Set() };
  }

  commit() {
    const tx = this.tx;
    this.tx = null;
    if (!tx || !tx.ops.length) return false;
    tx.id = ++this.txSeq;
    this.undoStack.push(tx);
    if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit({ committed: true, layers: tx.layers });
    return true;
  }

  // Run fn inside a one-shot transaction
  run(label, fn) {
    const nested = !!this.tx;
    if (!nested) this.begin(label);
    fn();
    if (!nested) this.commit();
  }

  record(op) {
    if (!this.tx) { this.begin('edit'); this.tx.auto = true; }
    this.tx.ops.push(op);
    this.tx.layers.add(op.t);
    this.emit({ layers: new Set([op.t]), keys: op.k !== undefined ? [op.k] : null });
    if (this.tx.auto) this.commit();
  }

  rawSet(t, k, v) {
    const m = this.store(t);
    if (t === 'field' || t === 'rampart') { if (v) m.add(k); else m.delete(k); return; }
    if (v === undefined) m.delete(k); else m.set(k, v);
  }

  rawGet(t, k) {
    const m = this.store(t);
    if (t === 'field' || t === 'rampart') return m.has(k) ? true : undefined;
    return m.get(k);
  }

  store(t) {
    switch (t) {
      case 'height': return this.height;
      case 'terrain': return this.terrain;
      case 'seg': return this.segments;
      case 'field': return this.fields;
      case 'rampart': return this.ramparts;
      case 'zone': return this.zoneOf;
      default: throw new Error('unknown layer ' + t);
    }
  }

  applyWhole(t, v) {
    if (t === 'obj') this.objectives = clone(v);
    else if (t === 'props') this.props = clone(v);
    else if (t === 'meta') this.meta = { ...this.meta, ...clone(v) };
    else if (t === 'zoneCount') this.zoneCount = v;
  }

  // Generic keyed setter (undefined = delete)
  set(t, k, v) {
    if (t === 'terrain' && v === 'plain') v = undefined;
    if (t === 'field' || t === 'rampart') v = v ? true : undefined;
    const prev = this.rawGet(t, k);
    if (prev === v) return false;
    this.rawSet(t, k, v);
    this.record({ t, k, a: prev, b: v });
    return true;
  }

  setWhole(t, next) {
    if (t === 'meta') {
      // field-level diff, never touching id / updatedAt
      const a = {}, b = {};
      for (const k of new Set([...Object.keys(this.meta), ...Object.keys(next)])) {
        if (k === 'id' || k === 'updatedAt') continue;
        if (JSON.stringify(this.meta[k]) !== JSON.stringify(next[k])) { a[k] = clone(this.meta[k]) ?? null; b[k] = clone(next[k]) ?? null; }
      }
      if (!Object.keys(b).length) return false;
      this.applyWhole('meta', b);
      this.record({ t, a, b });
      return true;
    }
    const prev = t === 'obj' ? this.objectives : t === 'props' ? this.props : this.zoneCount;
    if (JSON.stringify(prev) === JSON.stringify(next)) return false;
    const a = clone(prev);
    this.applyWhole(t, next);
    this.record({ t, a, b: clone(next) });
    return true;
  }

  undo() { return this.step(this.undoStack, this.redoStack, 'a'); }
  redo() { return this.step(this.redoStack, this.undoStack, 'b'); }

  step(from, to, field) {
    if (this.tx) this.commit();
    const tx = from.pop();
    if (!tx) return null;
    const ops = field === 'a' ? [...tx.ops].reverse() : tx.ops;
    for (const op of ops) {
      if (op.k === undefined) this.applyWhole(op.t, op[field]);
      else this.rawSet(op.t, op.k, op[field]);
    }
    to.push(tx);
    this.emit({ all: true, undo: field === 'a', redo: field === 'b' });
    return tx.label;
  }

  // ---------- domain helpers ----------
  has(k) { return this.height.has(k); }
  terrainAt(k) { return this.terrain.get(k) || 'plain'; }

  addHex(k, h) {
    if (this.height.has(k)) return false;
    return this.set('height', k, h);
  }

  // Remove a hex and everything that references it (single undo step if inside a transaction)
  removeHex(k) {
    if (!this.height.has(k)) return false;
    this.set('height', k, undefined);
    this.set('terrain', k, undefined);
    this.set('field', k, undefined);
    this.set('rampart', k, undefined);
    this.set('zone', k, undefined);
    for (const [sk] of [...this.segments]) {
      const e = parseEdge(sk);
      if (!e || (e.a !== k && e.b !== k)) continue;
      const other = e.a === k ? e.b : e.a;
      if (!this.height.has(other)) this.set('seg', sk, undefined);
    }
    const [q, r] = parseKey(k);
    if (this.objectives.some((o) => o.q === q && o.r === r)) {
      this.setWhole('obj', this.objectives.filter((o) => !(o.q === q && o.r === r)));
    }
    if (this.props.some((o) => o.q === q && o.r === r)) {
      this.setWhole('props', this.props.filter((o) => !(o.q === q && o.r === r)));
    }
    return true;
  }

  segAt(q1, r1, q2, r2) { return this.segments.get(edgeKey(q1, r1, q2, r2)); }
  setSeg(q1, r1, q2, r2, type) { return this.set('seg', edgeKey(q1, r1, q2, r2), type || undefined); }

  zoneSizes() {
    const sizes = new Array(this.zoneCount).fill(0);
    for (const z of this.zoneOf.values()) if (z < sizes.length) sizes[z]++;
    return sizes;
  }

  bounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const k of this.height.keys()) {
      if (!KEY_RE.test(k)) continue;
      const [q, r] = parseKey(k);
      const x = 1.5 * q, y = Math.sqrt(3) * (q / 2 + r);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (minX === Infinity) return null;
    return { minX: minX - 1, minY: minY - 1, maxX: maxX + 1, maxY: maxY + 1 };
  }
}
