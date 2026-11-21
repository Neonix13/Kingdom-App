// Errors = exactly the server rules of validateMap (game/maps.js) -> block saving.
// Warnings = editor checks (geometry, zones, objectives...) -> informative.
import { DIRS, parseKey, parseEdge, isAdjacent, key } from './hex.js';
import { TERRAIN_IDS, SEGMENT_IDS, SEGMENT_BY_ID, ID_RE, KEY_RE, HEIGHT_MIN, HEIGHT_MAX, zoneMinTiles } from './constants.js';

const CAP = 300;

export function validate(model, opts = {}) {
  const errors = [], warnings = [];
  const counts = {};
  const push = (list, code, msg, at, fix) => {
    counts[code] = (counts[code] || 0) + 1;
    if (counts[code] > CAP) return;
    list.push({ code, msg, at, fix });
  };
  const m = model.meta;
  const H = model.height;

  if (!ID_RE.test(m.id || '')) push(errors, 'id', 'id invalide (a-z, 0-9, - et _).');
  if (!m.name || typeof m.name !== 'string') push(errors, 'name', 'name manquant.');
  if (H.size === 0) push(errors, 'empty', 'La carte ne contient aucune case.');
  for (const [k, v] of H) {
    if (!KEY_RE.test(k)) push(errors, 'hexkey', `Clé de case invalide : ${k}`);
    else if (!Number.isFinite(v) || v < HEIGHT_MIN || v > HEIGHT_MAX) push(errors, 'height', `Hauteur invalide en ${k} (${v})`, { hex: k });
  }
  for (const [k, v] of model.terrain) {
    if (!H.has(k)) push(errors, 'terrainoff', `Terrain hors carte : ${k}`, { hex: k }, 'terrainoff');
    else if (!TERRAIN_IDS.has(v)) push(errors, 'terrainunk', `Terrain inconnu "${v}" en ${k}`, { hex: k });
  }
  for (const [k, v] of model.segments) {
    const e = parseEdge(k);
    if (!e || !KEY_RE.test(e.a) || !KEY_RE.test(e.b)) { push(errors, 'segkey', `Segment invalide : ${k}`, null, 'segbad'); continue; }
    if (!SEGMENT_IDS.has(v)) push(errors, 'segunk', `Type de segment inconnu "${v}" en ${k}`, { edge: k });
    if (!isAdjacent(e.q1, e.r1, e.q2, e.r2)) { push(warnings, 'segnadj', `Segment entre cases non adjacentes : ${k}`, { edge: k }, 'segbad'); continue; }
    const ia = H.has(e.a), ib = H.has(e.b);
    if (!ia || !ib) { push(warnings, 'segoff', `Segment ${SEGMENT_BY_ID[v]?.name || v} hors carte (${!ia && !ib ? 'deux cases absentes' : 'une case absente'}) : ${k}`, { edge: k }, 'segoff'); continue; }
    const dh = Math.abs(H.get(e.a) - H.get(e.b));
    if (v === 'cliff' && dh === 0) push(warnings, 'cliffflat', `Falaise sans dénivelé : ${k}`, { edge: k });
  }

  // Height steps >= 2 without cliff / ladder / wall
  for (const [k, h] of H) {
    if (!KEY_RE.test(k)) continue;
    const [q, r] = parseKey(k);
    for (let d = 0; d < 3; d++) {
      const n = key(q + DIRS[d][0], r + DIRS[d][1]);
      if (!H.has(n)) continue;
      const dh = Math.abs(h - H.get(n));
      if (dh < 2) continue;
      const s = model.segAt(q, r, q + DIRS[d][0], r + DIRS[d][1]);
      if (s === 'cliff' || s === 'echelle' || s === 'escalier' || s === 'mur') continue;
      push(warnings, 'steep', `Dénivelé de ${dh} sans falaise entre ${k} et ${n}`, { edge: `${k}|${n}` });
    }
  }

  // Isolated hexes and islands
  const seen = new Set();
  const comps = [];
  for (const k of H.keys()) {
    if (seen.has(k) || !KEY_RE.test(k)) continue;
    const comp = [];
    const stack = [k];
    seen.add(k);
    while (stack.length) {
      const c = stack.pop();
      comp.push(c);
      const [q, r] = parseKey(c);
      for (const [dq, dr] of DIRS) {
        const n = key(q + dq, r + dr);
        if (H.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length);
  for (const c of comps.slice(1)) {
    if (c.length === 1) push(warnings, 'isolated', `Case isolée : ${c[0]}`, { hex: c[0] }, 'isolated');
    else push(warnings, 'island', `Îlot de ${c.length} cases séparé du reste de la carte (ex. ${c[0]})`, { hex: c[0] });
  }

  // Decor
  if (window.KBMapProps) {
    for (const msg of window.KBMapProps.validateDecor({ ramparts: [...model.ramparts], props: model.props }, new Set(H.keys()))) push(errors, 'decor', msg, null, 'decoroff');
  }
  for (const k of model.fields) {
    if (!H.has(k)) push(warnings, 'fieldoff', `Champ hors carte : ${k}`, { hex: k }, 'fieldoff');
    else if (model.terrainAt(k) !== 'plain') push(warnings, 'fieldterrain', `Champ sur ${model.terrainAt(k)} : ${k}`, { hex: k });
  }

  // Zones
  if (model.zoneCount) {
    const minTiles = zoneMinTiles(opts.budget);
    const sizes = model.zoneSizes();
    if (model.zoneCount === 1) push(warnings, 'zone1', 'Une seule zone de déploiement définie (il en faut au moins 2).');
    sizes.forEach((n, i) => {
      if (n === 0) push(warnings, 'zoneempty', `Zone ${i + 1} vide.`);
      else if (n < minTiles) push(warnings, 'zonesmall', `Zone ${i + 1} trop petite : ${n} cases (minimum ${minTiles} pour un budget de ${opts.budget || 2500}).`);
    });
    const nonEmpty = sizes.filter((n) => n > 0);
    if (nonEmpty.length > 1 && Math.min(...nonEmpty) !== Math.max(...nonEmpty)) {
      push(warnings, 'zoneuneq', `Zones de tailles inégales (${sizes.join(' / ')}) : le jeu égalise à la plus petite.`);
    }
    for (const [k, z] of model.zoneOf) {
      if (z >= model.zoneCount) push(warnings, 'zoneidx', `Case ${k} affectée à une zone inexistante (${z + 1})`, { hex: k }, 'zoneoff');
      else if (!H.has(k)) push(warnings, 'zoneoff', `Case de zone ${z + 1} hors carte : ${k}`, { hex: k }, 'zoneoff');
      else {
        const t = model.terrainAt(k);
        if (t === 'river' || t === 'forest') push(warnings, 'zoneterrain', `Zone ${z + 1} sur ${t === 'river' ? 'fleuve' : 'forêt'} (non déployable) : ${k}`, { hex: k });
      }
    }
  }

  // Objectives
  const objPos = new Set();
  model.objectives.forEach((o, i) => {
    const k = key(o.q, o.r);
    const label = o.name || `#${i + 1}`;
    if (!Number.isInteger(o.q) || !Number.isInteger(o.r)) push(warnings, 'objpos', `Objectif ${label} : position invalide`, null);
    else if (!H.has(k)) push(warnings, 'objoff', `Objectif ${label} hors carte : ${k}`, { hex: k });
    if (objPos.has(k)) push(warnings, 'objdup', `Deux objectifs sur la même case : ${k}`, { hex: k });
    objPos.add(k);
    if (!o.name) push(warnings, 'objname', `Objectif sans nom en ${k}`, { hex: k });
    if (!o.type) push(warnings, 'objtype', `Objectif sans type en ${k}`, { hex: k });
    if (!Number.isFinite(o.points)) push(warnings, 'objpts', `Objectif ${label} : points invalides`, { hex: k });
  });

  // Background
  const bg = m.background;
  if (bg) {
    if (!bg.image) push(warnings, 'bgimg', 'Fond sans image.');
    for (const f of ['hexSize', 'origX', 'origY', 'width', 'height']) {
      if (!Number.isFinite(bg[f])) push(warnings, 'bgcal', `Calibration du fond : ${f} manquant.`);
    }
  }

  const overflow = Object.entries(counts).filter(([, n]) => n > CAP).map(([c, n]) => ({ code: c, hidden: n - CAP }));
  return { errors, warnings, counts, overflow, islands: comps.length };
}

// Automatic fixes for a validation code (run inside a model transaction)
export function applyFix(model, fix) {
  model.run('Correction', () => {
    if (fix === 'segoff' || fix === 'segbad') {
      for (const [k] of [...model.segments]) {
        const e = parseEdge(k);
        const bad = !e || !KEY_RE.test(e.a) || !KEY_RE.test(e.b) || !isAdjacent(e.q1, e.r1, e.q2, e.r2);
        if (fix === 'segbad' ? bad : (!bad && (!model.has(e.a) || !model.has(e.b)))) model.set('seg', k, undefined);
      }
    } else if (fix === 'terrainoff') {
      for (const [k] of [...model.terrain]) if (!model.has(k)) model.set('terrain', k, undefined);
    } else if (fix === 'decoroff') {
      for (const k of [...model.ramparts]) if (!model.has(k)) model.set('rampart', k, undefined);
      const types = window.KBMapProps ? window.KBMapProps.PROP_BY_ID : {};
      const keep = model.props.filter((p) => types[p.type] && model.has(`${p.q},${p.r}`));
      if (keep.length !== model.props.length) model.setWhole('props', keep);
    } else if (fix === 'fieldoff') {
      for (const k of [...model.fields]) if (!model.has(k)) model.set('field', k, undefined);
    } else if (fix === 'zoneoff') {
      for (const [k, z] of [...model.zoneOf]) if (!model.has(k) || z >= model.zoneCount) model.set('zone', k, undefined);
    } else if (fix === 'isolated') {
      for (const k of [...model.height.keys()]) {
        const [q, r] = parseKey(k);
        if (!DIRS.some(([dq, dr]) => model.has(key(q + dq, r + dr)))) model.removeHex(k);
      }
    }
  });
}

export const FIX_LABELS = {
  segoff: 'Supprimer les segments hors carte',
  segbad: 'Supprimer les segments invalides',
  terrainoff: 'Supprimer les terrains hors carte',
  fieldoff: 'Supprimer les champs hors carte',
  decoroff: 'Retirer les remparts et éléments hors carte',
  zoneoff: 'Retirer ces cases des zones',
  isolated: 'Supprimer les cases isolées',
};
