// Map registry: maps are JSON files (format 2) in data/maps/<id>.json
//
// {
//   format: 2, id, name, description, author, updatedAt,
//   background: { image, hexSize, origX, origY, width, height } | null,   // optional 2D backdrop + calibration
//   height:   { "q,r": level },          // defines the set of hexes on the map (every hex must be listed)
//   terrain:  { "q,r": type },           // only non-plain hexes (missing = plain)
//   segments: { "q1,r1|q2,r2": type },   // edge features: river, cliff, mur, barriere, passerelle, echelle, chevaux_de_frise
//   decor:    { fields: ["q,r", ...],    // purely visual (public/js/mapProps.js): wheat fields,
//               ramparts: ["q,r", ...],  // wall-walk hexes drawn as fortress walls (rules come from height + cliff segments),
//               props: [{ type, q, r, rot, label }] },  // towers, gatehouses, tents, banners, stairs, campfires
//   zones:    [ { tiles: ["q,r", ...] } ],                 // optional fixed deployment zones (else generated)
//   objectives: [ { q, r, type, points, name } ],          // optional victory points
// }
const fs = require('fs');
const path = require('path');

const MAPS_DIR = path.join(__dirname, '..', 'data', 'maps');
const TERRAINS = new Set(['plain', 'forest', 'river', 'road', 'building', 'bridge']);
const SEGMENTS = new Set(['river', 'cliff', 'bridge', 'passerelle', 'barriere', 'chevaux_de_frise', 'mur', 'echelle']);
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const KEY_RE = /^-?\d+,-?\d+$/;
const { validateDecor } = require('../public/js/mapProps.js');

const cache = new Map();

function mapPath(id) {
  if (!ID_RE.test(id)) throw new Error(`Identifiant de carte invalide : ${id}`);
  return path.join(MAPS_DIR, `${id}.json`);
}

function validateMap(map) {
  const errors = [];
  if (!map || typeof map !== 'object') return ['Carte invalide.'];
  if (!ID_RE.test(map.id || '')) errors.push('id invalide (a-z, 0-9, - et _).');
  if (!map.name || typeof map.name !== 'string') errors.push('name manquant.');
  if (!map.height || typeof map.height !== 'object') errors.push('height manquant.');
  const hexes = new Set(Object.keys(map.height || {}));
  if (hexes.size === 0) errors.push('La carte ne contient aucune case.');
  for (const [k, v] of Object.entries(map.height || {})) {
    if (!KEY_RE.test(k)) { errors.push(`Clé de case invalide : ${k}`); break; }
    if (!Number.isFinite(v) || v < -2 || v > 20) { errors.push(`Hauteur invalide en ${k}`); break; }
  }
  for (const [k, v] of Object.entries(map.terrain || {})) {
    if (!hexes.has(k)) { errors.push(`Terrain hors carte : ${k}`); break; }
    if (!TERRAINS.has(v)) { errors.push(`Terrain inconnu "${v}" en ${k}`); break; }
  }
  for (const [k, v] of Object.entries(map.segments || {})) {
    const parts = k.split('|');
    if (parts.length !== 2 || !KEY_RE.test(parts[0]) || !KEY_RE.test(parts[1])) { errors.push(`Segment invalide : ${k}`); break; }
    if (!SEGMENTS.has(v)) { errors.push(`Type de segment inconnu "${v}" en ${k}`); break; }
  }
  errors.push(...validateDecor(map.decor, hexes));
  return errors;
}

function normalizeMap(map) {
  return {
    format: 2,
    id: map.id,
    name: map.name,
    description: map.description || '',
    author: map.author || '',
    updatedAt: map.updatedAt || new Date().toISOString(),
    background: map.background || null,
    height: map.height || {},
    terrain: Object.fromEntries(Object.entries(map.terrain || {}).filter(([, v]) => v && v !== 'plain')),
    segments: map.segments || {},
    decor: map.decor || {},
    zones: Array.isArray(map.zones) ? map.zones : [],
    objectives: Array.isArray(map.objectives) ? map.objectives : [],
  };
}

function listMaps() {
  if (!fs.existsSync(MAPS_DIR)) return [];
  return fs.readdirSync(MAPS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const m = getMap(f.slice(0, -5));
        return { id: m.id, name: m.name, description: m.description, updatedAt: m.updatedAt, hexCount: Object.keys(m.height).length };
      } catch (e) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getMap(id = 'default') {
  if (cache.has(id)) return cache.get(id);
  const map = normalizeMap(JSON.parse(fs.readFileSync(mapPath(id), 'utf8')));
  cache.set(id, map);
  return map;
}

function mapExists(id) {
  if (typeof id !== 'string') return false;
  if (cache.has(id)) return true;
  try { return fs.existsSync(mapPath(id)); } catch (e) { return false; }
}

function saveMap(raw) {
  const map = normalizeMap({ ...raw, updatedAt: new Date().toISOString() });
  const errors = validateMap(map);
  if (errors.length) { const err = new Error(errors.join(' ')); err.validation = errors; throw err; }
  fs.mkdirSync(MAPS_DIR, { recursive: true });
  const tmp = mapPath(map.id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(map));
  fs.renameSync(tmp, mapPath(map.id));
  cache.set(map.id, map);
  return map;
}

function deleteMap(id) {
  if (id === 'default') throw new Error('La carte par défaut ne peut pas être supprimée.');
  fs.unlinkSync(mapPath(id));
  cache.delete(id);
}

function registerMap(raw) {
  const map = normalizeMap(raw);
  const errors = validateMap(map);
  if (errors.length) throw new Error(errors.join(' '));
  cache.set(map.id, map);
  return map;
}

// Terrain lookup with plain as default for every hex of the map
function terrainLookup(map) {
  const out = {};
  for (const k of Object.keys(map.height)) out[k] = map.terrain[k] || 'plain';
  return out;
}

module.exports = { listMaps, getMap, mapExists, saveMap, deleteMap, registerMap, validateMap, normalizeMap, terrainLookup, MAPS_DIR };
