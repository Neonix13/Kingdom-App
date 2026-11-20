// Editing tools: each tool handles pointer strokes and builds its option panel
import { key, parseKey, center, inRadius, nearestEdge, edgeEnds, addHexPath, DIRS, edgeKey, fromPoint } from './hex.js';
import { TERRAINS, SEGMENTS, ZONE_COLORS, OBJECTIVE_TYPES, clampHeight, TERRAIN_BY_ID, SEGMENT_BY_ID } from './constants.js';
import { h, seg, field, num, range, check } from './dom.js';

export const settings = {
  brush: 0,
  terrainType: 'forest',
  terrainFill: false,
  heightMode: 'raise',
  heightValue: 2,
  hexMode: 'add',
  newHexHeight: 1,
  segType: 'cliff',
  segErase: false,
  fieldErase: false,
  zoneIndex: 0,
  zoneErase: false,
  objType: 'village',
  objPoints: 1,
  decorKind: 'field',
  propType: 'tour',
  propRot: 0,
  propLabel: '',
};

const BRUSH_TOOLS = new Set(['terrain', 'height', 'hex', 'decor', 'zone']);

function brushHexes(q, r) { return inRadius(q, r, settings.brush); }

function brushPanel(E) {
  return field('Taille du pinceau ([ / ])', range(settings.brush, { min: 0, max: 8, onInput: (v) => { settings.brush = v; E.renderer.request(); } }));
}

// Sample points between two world positions so fast strokes leave no gaps
function samples(a, b, step = 0.3) {
  if (!a) return [b];
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(d / step));
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n });
  return out;
}

function floodTerrain(E, q, r, type) {
  const m = E.model;
  const start = key(q, r);
  if (!m.has(start)) return;
  const from = m.terrainAt(start);
  if (from === type) return;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const k = stack.pop();
    m.set('terrain', k, type);
    const [cq, cr] = parseKey(k);
    for (const [dq, dr] of DIRS) {
      const n = key(cq + dq, cr + dr);
      if (!seen.has(n) && m.has(n) && m.terrainAt(n) === from) { seen.add(n); stack.push(n); }
    }
  }
}

function smoothValue(m, q, r) {
  let sum = m.height.get(key(q, r)), n = 1;
  for (const [dq, dr] of DIRS) {
    const v = m.height.get(key(q + dq, r + dr));
    if (v !== undefined) { sum += v; n++; }
  }
  return clampHeight(sum / n);
}

export function createTools(E) {
  const { model } = E;
  let stroke = null;

  const T = {};

  // ---------- terrain ----------
  T.terrain = {
    id: 'terrain', name: 'Terrain', key: '1', icon: 'M4 4h16v16H4zM4 12h16M12 4v16',
    help: 'Clic/glisser : peindre. Mode remplissage : remplit la zone contiguë. Alt+clic ou I : pipette.',
    panel() {
      const counts = {};
      for (const k of model.height.keys()) { const t = model.terrainAt(k); counts[t] = (counts[t] || 0) + 1; }
      return [
        seg(TERRAINS.map((t) => ({ id: t.id, name: `${t.name} (${counts[t.id] || 0})`, swatch: t.color })), settings.terrainType, (v) => { settings.terrainType = v; }, 'vertical'),
        seg([{ id: 'brush', name: 'Pinceau' }, { id: 'fill', name: 'Remplissage (F)' }], settings.terrainFill ? 'fill' : 'brush', (v) => { settings.terrainFill = v === 'fill'; }),
        brushPanel(E),
      ];
    },
    pick(p) { if (model.has(p.k)) { settings.terrainType = model.terrainAt(p.k); return TERRAIN_BY_ID[settings.terrainType].name; } },
    apply(p) {
      if (settings.terrainFill) { if (!stroke.filled) { stroke.filled = true; floodTerrain(E, p.q, p.r, settings.terrainType); } return; }
      const t = p.shift ? 'plain' : settings.terrainType;
      for (const [q, r] of brushHexes(p.q, p.r)) { const k = key(q, r); if (model.has(k)) model.set('terrain', k, t); }
    },
  };

  // ---------- height ----------
  T.height = {
    id: 'height', name: 'Hauteur', key: '2', icon: 'M3 20l6-10 4 6 3-4 5 8z',
    help: 'Élever/abaisser : +1/−1 par passage (Maj inverse). Fixer : valeur. Aplanir : hauteur du point de départ. Lisser : moyenne des voisins.',
    panel() {
      const hs = [...model.height.values()];
      return [
        seg([
          { id: 'raise', name: 'Élever' }, { id: 'lower', name: 'Abaisser' }, { id: 'set', name: 'Fixer' },
          { id: 'flatten', name: 'Aplanir' }, { id: 'smooth', name: 'Lisser' },
        ], settings.heightMode, (v) => { settings.heightMode = v; }),
        field('Valeur (mode Fixer)', num(settings.heightValue, { min: -2, max: 20, onInput: (v) => { if (Number.isFinite(v)) settings.heightValue = clampHeight(v); } })),
        brushPanel(E),
        h('div', { class: 'row' },
          h('button', { type: 'button', onclick: () => shiftAll(1) }, 'Tout +1'),
          h('button', { type: 'button', onclick: () => shiftAll(-1) }, 'Tout −1')),
        h('small', { class: 'muted' }, hs.length ? `Hauteurs : ${Math.min(...hs)} → ${Math.max(...hs)} (limites −2 … 20)` : ''),
      ];
    },
    pick(p) { if (model.has(p.k)) { settings.heightValue = model.height.get(p.k); settings.heightMode = 'set'; return `hauteur ${settings.heightValue}`; } },
    begin(p) { stroke.flat = model.height.get(p.k); },
    apply(p) {
      let mode = settings.heightMode;
      if (p.shift && mode === 'raise') mode = 'lower'; else if (p.shift && mode === 'lower') mode = 'raise';
      const updates = [];
      for (const [q, r] of brushHexes(p.q, p.r)) {
        const k = key(q, r);
        if (!model.has(k)) continue;
        const cur = model.height.get(k);
        if (mode === 'raise' || mode === 'lower' || mode === 'smooth') {
          if (stroke.touched.has(k)) continue;
          stroke.touched.add(k);
        }
        let v = cur;
        if (mode === 'raise') v = cur + 1;
        else if (mode === 'lower') v = cur - 1;
        else if (mode === 'set') v = settings.heightValue;
        else if (mode === 'flatten') { if (stroke.flat === undefined) stroke.flat = cur; v = stroke.flat; }
        else if (mode === 'smooth') v = smoothValue(model, q, r);
        updates.push([k, clampHeight(v)]);
      }
      for (const [k, v] of updates) model.set('height', k, v);
    },
  };

  function shiftAll(d) {
    model.run(`Hauteur ${d > 0 ? '+1' : '−1'}`, () => {
      for (const [k, v] of [...model.height]) model.set('height', k, clampHeight(v + d));
    });
  }

  // ---------- hexes ----------
  T.hex = {
    id: 'hex', name: 'Cases', key: '3', icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z',
    help: 'Ajouter / supprimer des cases (forme de la carte). Maj = mode inverse. Supprimer une case retire aussi son terrain, ses champs, zones, objectifs et segments orphelins.',
    panel() {
      return [
        seg([{ id: 'add', name: 'Ajouter' }, { id: 'remove', name: 'Supprimer' }], settings.hexMode, (v) => { settings.hexMode = v; }),
        field('Hauteur des nouvelles cases', num(settings.newHexHeight, { min: -2, max: 20, onInput: (v) => { if (Number.isFinite(v)) settings.newHexHeight = clampHeight(v); } })),
        brushPanel(E),
        h('button', { type: 'button', onclick: () => E.ui.newMapWizard() }, 'Nouvelle carte… (assistant)'),
        h('small', { class: 'muted' }, `${model.height.size} cases`),
      ];
    },
    pick(p) { if (model.has(p.k)) { settings.newHexHeight = model.height.get(p.k); return `hauteur ${settings.newHexHeight}`; } },
    apply(p) {
      const remove = (settings.hexMode === 'remove') !== !!p.shift;
      for (const [q, r] of brushHexes(p.q, p.r)) {
        const k = key(q, r);
        if (remove) model.removeHex(k); else model.addHex(k, settings.newHexHeight);
      }
    },
  };

  // ---------- segments ----------
  T.segment = {
    id: 'segment', name: 'Segments', key: '4', icon: 'M5 19L19 5M4 14l6 6M14 4l6 6',
    help: 'Cliquer/glisser le long des bords de cases. Maj = gomme. Seuls les bords entre deux cases de la carte sont peints.',
    panel() {
      const counts = {};
      for (const v of model.segments.values()) counts[v] = (counts[v] || 0) + 1;
      return [
        seg([...SEGMENTS.map((s) => ({ id: s.id, name: `${s.name} (${counts[s.id] || 0})`, swatch: s.color })), { id: '__erase', name: 'Gomme', swatch: 'repeating-linear-gradient(45deg,#000 0 3px,#888 3px 6px)' }],
          settings.segErase ? '__erase' : settings.segType, (v) => { if (v === '__erase') settings.segErase = true; else { settings.segErase = false; settings.segType = v; } }, 'vertical'),
      ];
    },
    pick(p) {
      const e = nearestEdge(p.x, p.y);
      const t = model.segAt(e.q1, e.r1, e.q2, e.r2);
      if (t) { settings.segType = t; settings.segErase = false; return SEGMENT_BY_ID[t]?.name || t; }
    },
    stroke(a, b, shift) {
      for (const s of samples(a, b, 0.15)) {
        const e = nearestEdge(s.x, s.y);
        if (e.dist > 0.62) continue;
        const k1 = key(e.q1, e.r1), k2 = key(e.q2, e.r2);
        if (settings.segErase || shift) model.setSeg(e.q1, e.r1, e.q2, e.r2, undefined);
        else if (model.has(k1) && model.has(k2)) model.setSeg(e.q1, e.r1, e.q2, e.r2, settings.segType);
      }
    },
  };

  // ---------- decor ----------
  T.decor = {
    id: 'decor', name: 'Décor', key: '5', icon: 'M12 3l6 8H6zM12 8l7 9H5zM12 17v4',
    help: 'Champs de blé (sur plaines) ou remparts (chemin de ronde : murailles et créneaux en 3D là où une falaise ou un mur borde la case). Purement visuels. Maj = gomme.',
    panel() {
      return [
        seg([{ id: 'field', name: 'Champs de blé' }, { id: 'rampart', name: 'Remparts' }], settings.decorKind, (v) => { settings.decorKind = v; }),
        seg([{ id: 'add', name: 'Peindre' }, { id: 'erase', name: 'Gomme' }], settings.fieldErase ? 'erase' : 'add', (v) => { settings.fieldErase = v === 'erase'; }),
        brushPanel(E),
        h('small', { class: 'muted' }, `${model.fields.size} cases de champs · ${model.ramparts.size} cases de remparts`),
        settings.decorKind === 'rampart' ? h('small', { class: 'muted' }, 'Règles : placez les remparts plus haut que leurs abords et une falaise (ou un mur) sur leur face extérieure ; une échelle permet l\'assaut à pied.') : null,
      ];
    },
    pick(p) {
      const set = settings.decorKind === 'rampart' ? model.ramparts : model.fields;
      settings.fieldErase = !set.has(p.k);
      return settings.fieldErase ? 'gomme' : (settings.decorKind === 'rampart' ? 'rempart' : 'champ');
    },
    apply(p) {
      const erase = settings.fieldErase !== !!p.shift;
      const layer = settings.decorKind === 'rampart' ? 'rampart' : 'field';
      for (const [q, r] of brushHexes(p.q, p.r)) {
        const k = key(q, r);
        if (erase) model.set(layer, k, false);
        else if (model.has(k) && (layer === 'rampart' || model.terrainAt(k) === 'plain')) model.set(layer, k, true);
      }
    },
  };

  // ---------- props (towers, gatehouses, tents, banners, stairs, campfires) ----------
  const PT = () => (window.KBMapProps ? window.KBMapProps.PROP_TYPES : []);
  const PTB = () => (window.KBMapProps ? window.KBMapProps.PROP_BY_ID : {});
  const ROT_NAMES = ['↘ 0', '↗ 1', '↑ 2', '↖ 3', '↙ 4', '↓ 5'];
  function setProps(label, next) { model.run(label, () => model.setWhole('props', next)); }
  function editSelected(patch) {
    const i = E.view.selectedProp;
    if (i == null || !model.props[i]) return;
    setProps('Modifier élément', model.props.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }
  T.props = {
    id: 'props', name: 'Éléments', key: '9', icon: 'M6 21V9l6-5 6 5v12M9 21v-6h6v6M3 21h18',
    help: 'Clic sur une case vide : poser l\'élément choisi. Clic sur un élément : le sélectionner (glisser pour le déplacer). R : tourner. Suppr : supprimer. Maj+clic : supprimer.',
    panel() {
      const out = [
        seg(PT().map((t) => ({ id: t.id, name: t.name })), settings.propType, (v) => { settings.propType = v; E.ui.refreshPanel(); }, 'vertical'),
        field('Orientation (R)', seg(ROT_NAMES.map((n, i) => ({ id: String(i), name: n })), String(settings.propRot), (v) => { settings.propRot = +v; editSelected({ rot: +v }); })),
      ];
      if (PTB()[settings.propType]?.label) {
        const inp = h('input', { type: 'text', value: settings.propLabel, maxlength: 8, placeholder: '秦' });
        inp.addEventListener('change', () => { settings.propLabel = inp.value.trim(); editSelected({ label: settings.propLabel || undefined }); });
        out.push(field('Texte de la bannière', inp));
      }
      const i = E.view.selectedProp;
      const sel = i != null ? model.props[i] : null;
      if (sel) {
        out.push(h('div', { class: 'row' },
          h('b', null, `${PTB()[sel.type]?.name || sel.type} en ${sel.q},${sel.r}`),
          h('button', { type: 'button', onclick: () => editSelected({ type: settings.propType }) }, 'Changer le type'),
          h('button', { type: 'button', onclick: () => deleteSelectedProp() }, 'Supprimer')));
      }
      const counts = {};
      for (const p of model.props) counts[p.type] = (counts[p.type] || 0) + 1;
      out.push(h('small', { class: 'muted' }, `${model.props.length} élément(s) · ` + Object.entries(counts).map(([t, n]) => `${PTB()[t]?.name || t} : ${n}`).join(', ')));
      return out;
    },
    down(p) {
      const i = model.props.findIndex((o) => o.q === p.q && o.r === p.r);
      if (p.shift) {
        if (i >= 0) { setProps('Supprimer élément', model.props.filter((_, j) => j !== i)); E.view.selectedProp = null; }
      } else if (i >= 0) {
        E.view.selectedProp = i;
        stroke.moveIdx = i;
        const o = model.props[i];
        settings.propType = o.type; settings.propRot = o.rot || 0; settings.propLabel = o.label || '';
      } else if (model.has(p.k)) {
        const t = PTB()[settings.propType];
        const o = { type: settings.propType, q: p.q, r: p.r };
        if (t?.oriented) o.rot = settings.propRot;
        if (t?.label && settings.propLabel) o.label = settings.propLabel;
        setProps('Nouvel élément', [...model.props, o]);
        E.view.selectedProp = model.props.length - 1;
      } else E.view.selectedProp = null;
      E.ui.refreshPanel();
      E.renderer.request();
    },
    drag(p) {
      const i = stroke.moveIdx;
      if (i === undefined || !model.has(p.k)) return;
      const o = model.props[i];
      if (o.q === p.q && o.r === p.r) return;
      if (model.props.some((x, j) => j !== i && x.q === p.q && x.r === p.r)) return;
      model.setWhole('props', model.props.map((x, j) => (j === i ? { ...x, q: p.q, r: p.r } : x)));
    },
    pick(p) {
      const o = model.props.find((x) => x.q === p.q && x.r === p.r);
      if (!o) return null;
      settings.propType = o.type; settings.propRot = o.rot || 0; settings.propLabel = o.label || '';
      return PTB()[o.type]?.name || o.type;
    },
  };

  function rotateProp() {
    settings.propRot = (settings.propRot + 1) % 6;
    editSelected({ rot: settings.propRot });
    E.ui.refreshPanel();
  }

  function deleteSelectedProp() {
    const i = E.view.selectedProp;
    if (i == null || !model.props[i]) return;
    setProps('Supprimer élément', model.props.filter((_, j) => j !== i));
    E.view.selectedProp = null;
    E.ui.refreshPanel();
    E.renderer.request();
  }

  // ---------- zones ----------
  T.zone = {
    id: 'zone', name: 'Zones', key: '6', icon: 'M5 21V4h11l-2 4 2 4H5',
    help: 'Zones de déploiement fixes (optionnel ; sinon le jeu les génère). Maj = gomme.',
    panel() {
      const sizes = model.zoneSizes();
      const list = h('div', { class: 'zonelist' });
      for (let i = 0; i < model.zoneCount; i++) {
        list.append(h('button', {
          type: 'button', class: i === settings.zoneIndex && !settings.zoneErase ? 'on' : '',
          onclick: () => { settings.zoneIndex = i; settings.zoneErase = false; E.ui.refreshPanel(); },
        }, h('i', { style: { background: ZONE_COLORS[i % ZONE_COLORS.length] } }), `Zone ${i + 1} — ${sizes[i]} cases`));
      }
      return [
        model.zoneCount ? list : h('p', { class: 'muted' }, 'Aucune zone fixe : le jeu génère les zones automatiquement.'),
        h('div', { class: 'row' },
          h('button', { type: 'button', onclick: () => { model.run('Ajouter zone', () => model.setWhole('zoneCount', model.zoneCount + 1)); settings.zoneIndex = model.zoneCount - 1; settings.zoneErase = false; E.ui.refreshPanel(); } }, '+ Zone'),
          model.zoneCount ? h('button', { type: 'button', onclick: () => removeLastZone() }, '− Dernière zone') : null,
          model.zoneCount ? h('button', { type: 'button', class: settings.zoneErase ? 'on' : '', onclick: () => { settings.zoneErase = !settings.zoneErase; E.ui.refreshPanel(); } }, 'Gomme') : null),
        model.zoneCount ? h('button', { type: 'button', onclick: () => clearZone(settings.zoneIndex) }, `Vider la zone ${settings.zoneIndex + 1}`) : null,
        brushPanel(E),
      ];
    },
    pick(p) { const z = model.zoneOf.get(p.k); if (z !== undefined) { settings.zoneIndex = z; settings.zoneErase = false; return `zone ${z + 1}`; } },
    apply(p) {
      if (!model.zoneCount) return;
      const erase = settings.zoneErase || p.shift;
      for (const [q, r] of brushHexes(p.q, p.r)) {
        const k = key(q, r);
        if (erase) model.set('zone', k, undefined);
        else if (model.has(k)) model.set('zone', k, Math.min(settings.zoneIndex, model.zoneCount - 1));
      }
    },
  };

  function removeLastZone() {
    const last = model.zoneCount - 1;
    model.run('Supprimer zone', () => {
      for (const [k, z] of [...model.zoneOf]) if (z === last) model.set('zone', k, undefined);
      model.setWhole('zoneCount', last);
    });
    settings.zoneIndex = Math.max(0, Math.min(settings.zoneIndex, last - 1));
    E.ui.refreshPanel();
  }

  function clearZone(i) {
    model.run('Vider zone', () => { for (const [k, z] of [...model.zoneOf]) if (z === i) model.set('zone', k, undefined); });
    E.ui.refreshPanel();
  }

  // ---------- objectives ----------
  T.objective = {
    id: 'objective', name: 'Objectifs', key: '7', icon: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7z',
    help: 'Clic sur une case vide : nouvel objectif. Clic sur un objectif : sélection ; glisser pour déplacer. Suppr : supprimer.',
    panel() {
      const objs = model.objectives;
      const sel = E.view.selectedObjective;
      const out = [
        field('Type des nouveaux objectifs', typeInput(settings.objType, (v) => { settings.objType = v; })),
        field('Points par défaut', num(settings.objPoints, { min: 0, step: 1, onInput: (v) => { if (Number.isFinite(v)) settings.objPoints = v; } })),
      ];
      if (sel !== null && objs[sel]) {
        const o = objs[sel];
        const upd = (patch) => {
          const next = model.objectives.map((x, i) => (i === sel ? { ...x, ...patch } : x));
          model.run('Objectif', () => model.setWhole('obj', next));
          E.ui.refreshPanelSoon();
        };
        out.push(h('div', { class: 'card-sub' },
          h('b', null, `Objectif sélectionné (${o.q},${o.r})`),
          field('Nom', (() => { const i = h('input', { type: 'text', value: o.name || '' }); i.addEventListener('change', () => upd({ name: i.value.trim() })); return i; })()),
          field('Type', typeInput(o.type || '', (v) => upd({ type: v }))),
          field('Points', num(o.points ?? 0, { min: 0, step: 1, onChange: (v) => upd({ points: Number.isFinite(v) ? v : 0 }) })),
          h('button', { type: 'button', class: 'danger', onclick: () => deleteSelected() }, 'Supprimer (Suppr)')));
      }
      const list = h('div', { class: 'objlist' });
      objs.forEach((o, i) => list.append(h('button', {
        type: 'button', class: i === sel ? 'on' : '',
        onclick: () => { E.view.selectedObjective = i; const c = center(o.q, o.r); E.renderer.focus(c.x, c.y); E.ui.refreshPanel(); },
      }, `★ ${o.name || '(sans nom)'} · ${o.type || '?'} · ${o.points ?? 0} pts`)));
      out.push(h('b', null, `${objs.length} objectif(s)`), list);
      return out;
    },
    down(p) {
      const i = model.objectives.findIndex((o) => o.q === p.q && o.r === p.r);
      if (i >= 0) { E.view.selectedObjective = i; stroke.moveIdx = i; }
      else if (model.has(p.k)) {
        const n = model.objectives.length + 1;
        model.run('Nouvel objectif', () => model.setWhole('obj', [...model.objectives, { q: p.q, r: p.r, type: settings.objType, points: settings.objPoints, name: `Objectif ${n}` }]));
        E.view.selectedObjective = model.objectives.length - 1;
      } else E.view.selectedObjective = null;
      E.ui.refreshPanel();
    },
    drag(p) {
      const i = stroke.moveIdx;
      if (i === undefined || !model.has(p.k)) return;
      const o = model.objectives[i];
      if (o.q === p.q && o.r === p.r) return;
      if (model.objectives.some((x, j) => j !== i && x.q === p.q && x.r === p.r)) return;
      model.setWhole('obj', model.objectives.map((x, j) => (j === i ? { ...x, q: p.q, r: p.r } : x)));
    },
  };

  function typeInput(value, onChange) {
    const id = 'objtypes';
    const i = h('input', { type: 'text', value, list: id });
    if (!document.getElementById(id)) document.body.append(h('datalist', { id }, OBJECTIVE_TYPES.map((t) => h('option', { value: t }))));
    i.addEventListener('change', () => onChange(i.value.trim()));
    return i;
  }

  function deleteSelected() {
    const sel = E.view.selectedObjective;
    if (sel === null || !model.objectives[sel]) return;
    model.run('Supprimer objectif', () => model.setWhole('obj', model.objectives.filter((_, i) => i !== sel)));
    E.view.selectedObjective = null;
    E.ui.refreshPanel();
  }

  // ---------- background / calibration ----------
  T.background = {
    id: 'background', name: 'Fond', key: '8', icon: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6',
    help: 'Glisser : déplacer l\'image (origine). Maj+glisser vertical : échelle (taille d\'hex). Réglages fins dans le panneau.',
    panel() { return E.ui.backgroundPanel(); },
    down(p) {
      const bg = model.meta.background;
      if (!bg) return;
      stroke.bgStart = JSON.parse(JSON.stringify(model.meta));
      stroke.last = { sx: p.sx, sy: p.sy };
    },
    drag(p) {
      const bg = model.meta.background;
      if (!bg || !stroke.bgStart) return;
      const dx = p.sx - stroke.last.sx, dy = p.sy - stroke.last.sy;
      stroke.last = { sx: p.sx, sy: p.sy };
      if (p.shift) {
        const f = Math.exp(-dy * 0.002);
        // scale around hex (0,0) keeps origin fixed
        bg.hexSize = Math.max(1, +(bg.hexSize * f).toFixed(3));
      } else {
        const z = E.renderer.cam.zoom;
        bg.origX = +(bg.origX - dx / z * bg.hexSize).toFixed(2);
        bg.origY = +(bg.origY - dy / z * bg.hexSize).toFixed(2);
      }
      E.renderer.request();
      E.ui.syncBackgroundInputs();
    },
    up() {
      if (!stroke.bgStart) return;
      const next = JSON.parse(JSON.stringify(model.meta));
      model.meta = stroke.bgStart;
      model.run('Calibration', () => model.setWhole('meta', next));
    },
  };

  // ---------- generic stroke dispatch ----------
  function pt(ev) {
    const w = E.renderer.toWorld(ev.sx, ev.sy);
    const [q, r] = fromPoint(w.x, w.y);
    return { ...ev, x: w.x, y: w.y, q, r, k: key(q, r) };
  }

  return {
    tools: T,
    order: ['terrain', 'height', 'hex', 'segment', 'decor', 'zone', 'objective', 'background', 'props'],
    isBrush: (id) => BRUSH_TOOLS.has(id),
    active: () => !!stroke,
    pick(toolId, ev) { const t = T[toolId]; return t.pick ? t.pick(pt(ev)) : null; },
    down(toolId, ev) {
      const t = T[toolId];
      const p = pt(ev);
      stroke = { tool: toolId, touched: new Set(), last: null, lastW: { x: p.x, y: p.y } };
      model.begin(t.name);
      if (t.begin) t.begin(p);
      if (t.down) t.down(p);
      else if (t.stroke) t.stroke(null, p, p.shift);
      else if (t.apply) t.apply(p);
    },
    move(ev) {
      if (!stroke) return;
      const t = T[stroke.tool];
      const p = pt(ev);
      if (t.drag) t.drag(p);
      else if (t.stroke) t.stroke(stroke.lastW, p, p.shift);
      else if (t.apply) {
        if (t === T.terrain && settings.terrainFill) return;
        let lastK = null;
        for (const s of samples(stroke.lastW, p, 0.5)) {
          const [q, r] = fromPoint(s.x, s.y);
          const k = key(q, r);
          if (k === lastK) continue;
          lastK = k;
          t.apply({ ...p, x: s.x, y: s.y, q, r, k });
        }
      }
      stroke.lastW = { x: p.x, y: p.y };
    },
    up() {
      if (!stroke) return;
      const t = T[stroke.tool];
      if (t.up) t.up();
      stroke = null;
      model.commit();
      E.ui.refreshPanelSoon();
    },
    cancel() { if (stroke) { stroke = null; model.commit(); } },
    deleteSelected,
    deleteSelectedProp,
    rotateProp,
    // Hover overlay: brush footprint / target edge
    overlay(toolId, hover, ctx, px) {
      if (!hover) return;
      const t = T[toolId];
      if (toolId === 'segment') {
        const e = nearestEdge(hover.x, hover.y);
        if (e.dist > 0.62) return;
        const ends = edgeEnds(e.q1, e.r1, e.q2, e.r2);
        const s = SEGMENT_BY_ID[settings.segType];
        const erase = settings.segErase || hover.shift;
        const ok = erase || (model.has(key(e.q1, e.r1)) && model.has(key(e.q2, e.r2)));
        ctx.strokeStyle = !ok ? 'rgba(255,60,60,0.6)' : erase ? '#ffffff' : s.color;
        ctx.setLineDash(erase ? [0.12, 0.1] : []);
        ctx.lineWidth = Math.max(5 * px, 0.25);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(ends[0], ends[1]); ctx.lineTo(ends[2], ends[3]); ctx.stroke();
        ctx.setLineDash([]);
        return;
      }
      if (toolId === 'background') return;
      const path = new Path2D();
      const hexes = BRUSH_TOOLS.has(toolId) && !(t === T.terrain && settings.terrainFill) ? brushHexes(hover.q, hover.r) : [[hover.q, hover.r]];
      for (const [q, r] of hexes) { const c = center(q, r); addHexPath(path, c.x, c.y, 0.96); }
      ctx.lineWidth = Math.max(2 * px, 0.05);
      ctx.strokeStyle = hover.shift ? 'rgba(255,90,90,0.95)' : 'rgba(255,255,255,0.95)';
      ctx.stroke(path);
    },
  };
}

export { edgeKey };
