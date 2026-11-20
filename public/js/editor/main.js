// Map editor entry point: wiring of model, renderer, tools, panels, IO, shortcuts and 3D preview
import { MapModel } from './model.js';
import { Renderer } from './render.js';
import { createTools, settings } from './tools.js';
import { validate, applyFix, FIX_LABELS } from './validate.js';
import { key, parseKey, parseEdge, center, DIRS, rectangle, SQRT3 } from './hex.js';
import { TERRAIN_BY_ID, SEGMENT_BY_ID, TERRAINS, SEGMENTS, ID_RE, clampHeight } from './constants.js';
import { h, seg, field, num, range, check } from './dom.js';
import { api, toast, modal, confirmModal, loginModal, downloadJson, pickFile } from './ui.js';

const LS_VIEW = 'kbMapEditor:view';
const LS_DRAFT = (id) => `kbMapEditor:draft:${id}`;
const DIR_NAMES = ['SE', 'NE', 'N', 'NO', 'SO', 'S'];
const $ = (id) => document.getElementById(id);

const view = Object.assign({
  display: 'terrain', fillAlpha: 0.85, bgVisible: true, bgOpacity: 1, showGrid: true, showSegments: true,
  showFields: true, showZones: true, showObjectives: true, showLabels: true, contours: false, selectedObjective: null,
}, JSON.parse(localStorage.getItem(LS_VIEW) || '{}'), { selectedObjective: null });

const model = new MapModel();
const renderer = new Renderer($('map'), model, view);
const state = {
  tool: 'terrain', tab: 'tool', hover: null, admin: false, serverExists: false, editorRoutes: null,
  validation: { errors: [], warnings: [] }, panning: null, space: false, pickOnce: false,
};
const E = { model, renderer, view, settings, ui: {} };
const tools = createTools(E);
window.__editor = { model, renderer, view, settings, tools, state, validate: () => validate(model) };
window.__kbEditorPreview = () => model.toDoc();

// ---------------------------------------------------------------- toolbar & tabs
function buildToolbar() {
  const bar = $('toolbar');
  bar.innerHTML = '';
  for (const id of tools.order) {
    const t = tools.tools[id];
    bar.append(h('button', { type: 'button', class: id === state.tool ? 'on' : '', title: `${t.name} (${t.key})`, onclick: () => setTool(id) }, t.icon, h('small', null, t.name)));
  }
}

function setTool(id) {
  if (!tools.tools[id]) return;
  tools.cancel();
  state.tool = id;
  buildToolbar();
  $('help').textContent = tools.tools[id].help;
  setTab('tool');
  renderer.request();
}

function setTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  refreshPanel();
}
for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => setTab(b.dataset.tab));

let panelTimer = null;
function refreshPanelSoon() { clearTimeout(panelTimer); panelTimer = setTimeout(refreshPanel, 120); }

function refreshPanel() {
  const p = $('panel');
  const scroll = p.scrollTop;
  const sel = 'input,select,textarea';
  const focusIdx = p.contains(document.activeElement) ? [...p.querySelectorAll(sel)].indexOf(document.activeElement) : -1;
  p.innerHTML = '';
  if (state.tab === 'tool') {
    const t = tools.tools[state.tool];
    p.append(h('div', { class: 'section' }, h('h4', null, t.name), t.panel()));
    p.append(displayPanel());
  } else if (state.tab === 'map') p.append(...mapPanel());
  else if (state.tab === 'valid') p.append(...validationPanel());
  else if (state.tab === 'stats') p.append(...statsPanel());
  p.scrollTop = scroll;
  if (focusIdx >= 0) { const el = p.querySelectorAll(sel)[focusIdx]; if (el) el.focus(); }
}
E.ui.refreshPanel = refreshPanel;
E.ui.refreshPanelSoon = refreshPanelSoon;

function saveView() {
  const { selectedObjective, ...rest } = view;
  localStorage.setItem(LS_VIEW, JSON.stringify(rest));
}

function displayPanel() {
  const set = (k, rebuild) => (v) => { view[k] = v; saveView(); if (rebuild) renderer.invalidateAll(); else renderer.request(); };
  return h('div', { class: 'section' },
    h('h4', null, 'Affichage'),
    seg([{ id: 'terrain', name: 'Terrain' }, { id: 'height', name: 'Hauteurs' }, { id: 'none', name: 'Aucun (calque)' }], view.display, (v) => { set('display', true)(v); }),
    field('Opacité des cases', range(view.fillAlpha, { min: 0.05, max: 1, step: 0.05, onInput: set('fillAlpha') })),
    model.meta.background ? h('div', { class: 'row' }, check('Fond', view.bgVisible, set('bgVisible')),
      h('div', { style: { flex: 1 } }, range(view.bgOpacity, { min: 0.05, max: 1, step: 0.05, onInput: set('bgOpacity') }))) : null,
    h('div', { class: 'row' },
      check('Grille (G)', view.showGrid, set('showGrid')),
      check('Segments', view.showSegments, set('showSegments')),
      check('Champs', view.showFields, set('showFields')),
      check('Zones', view.showZones, set('showZones')),
      check('Objectifs', view.showObjectives, set('showObjectives')),
      check('Étiquettes (L)', view.showLabels, set('showLabels')),
      check('Courbes de niveau', view.contours, set('contours'))),
  );
}

// ---------------------------------------------------------------- map / meta panel
function mapPanel() {
  const m = model.meta;
  const txt = (k, multiline) => {
    const el = multiline ? h('textarea', { rows: 3 }) : h('input', { type: 'text' });
    el.value = m[k] || '';
    el.addEventListener('change', () => { model.run('Infos', () => model.setWhole('meta', { ...model.meta, [k]: el.value.trim() })); updateTitle(); });
    return el;
  };
  return [
    h('div', { class: 'section' },
      h('h4', null, 'Carte'),
      field('Identifiant', h('input', { type: 'text', value: m.id, disabled: true }), 'Pour changer d\'identifiant : « Enregistrer sous… »'),
      field('Nom', txt('name')),
      field('Description', txt('description', true)),
      field('Auteur', txt('author')),
      h('small', { class: 'muted' }, m.updatedAt ? `Dernière sauvegarde serveur : ${new Date(m.updatedAt).toLocaleString('fr-FR')}` : 'Jamais enregistrée sur le serveur.')),
    h('div', { class: 'section' },
      h('h4', null, 'Fond & calibration'),
      h('p', { class: 'muted' }, 'Réglages complets dans l\'outil « Fond » (8).'),
      h('button', { type: 'button', onclick: () => setTool('background') }, 'Outil Fond…')),
  ];
}

// ---------------------------------------------------------------- background panel
let bgInputs = null;
function backgroundPanel() {
  const bg = model.meta.background;
  const out = [];
  const imgSel = h('select', null, h('option', { value: '' }, 'Choisir une image…'));
  const urlIn = h('input', { type: 'text', placeholder: '/assets/maps/mon-fond.webp', value: bg?.image || '' });
  const known = new Set();
  const addOpt = (u) => { if (!u || known.has(u)) return; known.add(u); imgSel.append(h('option', { value: u }, u)); };
  addOpt('/assets/img/map.webp');
  if (bg?.image) addOpt(bg.image);
  if (state.editorRoutes !== false) {
    api('GET', '/api/editor/backgrounds').then((list) => { state.editorRoutes = true; for (const b of list) addOpt(b.url); }).catch(() => {});
  }
  imgSel.addEventListener('change', () => { if (imgSel.value) urlIn.value = imgSel.value; });
  const apply = h('button', { type: 'button', class: 'primary', onclick: () => setBackgroundImage(urlIn.value.trim()) }, bg ? 'Changer l\'image' : 'Utiliser cette image');
  const upload = state.editorRoutes === false ? null : h('button', { type: 'button', onclick: () => uploadBackground() }, 'Téléverser…');
  out.push(h('div', { class: 'section' }, h('h4', null, 'Image de fond'), imgSel, urlIn, h('div', { class: 'row' }, apply, upload),
    state.editorRoutes === false ? h('small', { class: 'muted' }, 'Téléversement indisponible (route /api/editor non montée) : déposer l\'image dans public/assets/maps/ et saisir son chemin.') : null));

  if (bg) {
    const snap = () => JSON.parse(JSON.stringify(model.meta));
    let start = null;
    const mk = (k, step) => {
      const el = num(bg[k], { step });
      el.addEventListener('focus', () => { start = snap(); });
      el.addEventListener('input', () => { const v = parseFloat(el.value); if (Number.isFinite(v)) { if (!start) start = snap(); model.meta.background[k] = v; renderer.request(); } });
      el.addEventListener('change', () => commitBg(start, () => { start = null; }));
      return el;
    };
    const nudge = (k, d) => h('button', { type: 'button', class: 'small', onclick: () => { const s = snap(); model.meta.background[k] = +(model.meta.background[k] + d).toFixed(3); commitBg(s); syncBackgroundInputs(); } }, d > 0 ? '+' : '−');
    bgInputs = { hexSize: mk('hexSize', 0.1), origX: mk('origX', 1), origY: mk('origY', 1) };
    const rowFor = (label, k, d) => field(label, h('div', { class: 'row' }, nudge(k, -d), bgInputs[k], nudge(k, d)));
    const img = renderer.bg.img;
    const sizeNote = img && (img.naturalWidth !== bg.width || img.naturalHeight !== bg.height)
      ? h('div', { class: 'row' }, h('small', { class: 'err' }, `Taille réelle ${img.naturalWidth}×${img.naturalHeight} ≠ ${bg.width}×${bg.height}`),
        h('button', { type: 'button', class: 'small', onclick: () => { const s = snap(); Object.assign(model.meta.background, { width: img.naturalWidth, height: img.naturalHeight }); commitBg(s); refreshPanel(); } }, 'Corriger'))
      : null;
    out.push(h('div', { class: 'section' },
      h('h4', null, 'Calibration'),
      h('small', { class: 'muted' }, 'Taille d\'hex = rayon d\'une case en pixels de l\'image ; origine = pixel de l\'image au centre de la case (0,0). Glisser sur la carte pour déplacer l\'image, Maj+glisser pour l\'échelle.'),
      rowFor('Taille d\'hex (px image)', 'hexSize', 0.1),
      rowFor('Origine X (px image)', 'origX', 1),
      rowFor('Origine Y (px image)', 'origY', 1),
      h('small', { class: 'muted' }, `Image : ${bg.width || '?'} × ${bg.height || '?'} px${renderer.bg.error ? ' — ' + renderer.bg.error : ''}`),
      sizeNote,
      h('div', { class: 'row' }, check('Afficher', view.bgVisible, (v) => { view.bgVisible = v; saveView(); renderer.request(); }),
        h('div', { style: { flex: 1 } }, range(view.bgOpacity, { min: 0.05, max: 1, step: 0.05, onInput: (v) => { view.bgOpacity = v; saveView(); renderer.request(); } }))),
      h('button', { type: 'button', onclick: () => { view.display = 'none'; saveView(); renderer.invalidateAll(); refreshPanel(); } }, 'Mode calque (cases transparentes)'),
      h('button', { type: 'button', onclick: () => fillHexesFromImage() }, 'Ajouter les cases couvertes par l\'image'),
      h('button', { type: 'button', class: 'danger', onclick: () => model.run('Retirer le fond', () => model.setWhole('meta', { ...snap(), background: null })) || refreshPanel() }, 'Retirer le fond')));
  } else bgInputs = null;
  return out;
}
E.ui.backgroundPanel = backgroundPanel;

function commitBg(start, done) {
  if (!start) return;
  const next = JSON.parse(JSON.stringify(model.meta));
  model.meta = start;
  model.run('Calibration', () => model.setWhole('meta', next));
  if (done) done();
}

function syncBackgroundInputs() {
  const bg = model.meta.background;
  if (!bgInputs || !bg) return;
  for (const k of Object.keys(bgInputs)) if (document.activeElement !== bgInputs[k]) bgInputs[k].value = bg[k];
}
E.ui.syncBackgroundInputs = syncBackgroundInputs;

function loadImageSize(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Image introuvable : ' + url));
    img.src = url;
  });
}

async function setBackgroundImage(url) {
  if (!url) return toast('Indiquer une image.', 'error');
  try {
    const { width, height } = await loadImageSize(url);
    const prev = model.meta.background;
    const bg = prev ? { ...prev, image: url, width, height } : { image: url, hexSize: 100, origX: 100, origY: 100, width, height };
    model.run('Image de fond', () => model.setWhole('meta', { ...JSON.parse(JSON.stringify(model.meta)), background: bg }));
    view.bgVisible = true;
    refreshPanel();
    toast(`Fond : ${width}×${height} px`, 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

async function uploadBackground() {
  const file = await pickFile('image/png,image/jpeg,image/webp');
  if (!file) return;
  const ok = await ensureAdmin('Le téléversement nécessite une connexion administrateur.');
  if (!ok) return;
  const t = toast(`Téléversement de ${file.name}…`, 'info', { timeout: 0 });
  try {
    const res = await api('POST', `/api/editor/background?name=${encodeURIComponent(file.name)}`, file, { raw: true, contentType: file.type });
    t.remove();
    await setBackgroundImage(res.url);
  } catch (e) {
    t.remove();
    if (e.status === 404) { state.editorRoutes = false; refreshPanel(); }
    toast('Téléversement impossible : ' + e.message, 'error');
  }
}

function hexesInImage(bg) {
  const out = [];
  const qMin = Math.floor(-bg.origX / (1.5 * bg.hexSize)) - 1, qMax = Math.ceil((bg.width - bg.origX) / (1.5 * bg.hexSize)) + 1;
  for (let q = qMin; q <= qMax; q++) {
    const rMin = Math.floor((-bg.origY / bg.hexSize - SQRT3 / 2 * q) / SQRT3) - 1;
    const rMax = Math.ceil(((bg.height - bg.origY) / bg.hexSize - SQRT3 / 2 * q) / SQRT3) + 1;
    for (let r = rMin; r <= rMax; r++) {
      const x = bg.origX + bg.hexSize * 1.5 * q, y = bg.origY + bg.hexSize * (SQRT3 / 2 * q + SQRT3 * r);
      if (x >= 0 && x <= bg.width && y >= 0 && y <= bg.height) out.push(key(q, r));
    }
  }
  return out;
}

function fillHexesFromImage() {
  const bg = model.meta.background;
  if (!bg || !(bg.hexSize > 0) || !bg.width) return toast('Calibration incomplète.', 'error');
  let n = 0;
  model.run('Cases depuis l\'image', () => { for (const k of hexesInImage(bg)) if (model.addHex(k, settings.newHexHeight)) n++; });
  toast(`${n} case(s) ajoutée(s).`, 'ok');
}

// ---------------------------------------------------------------- validation panel
let validateTimer = null;
function scheduleValidate() { clearTimeout(validateTimer); validateTimer = setTimeout(runValidate, 350); }
function runValidate() {
  state.validation = validate(model);
  const { errors, warnings } = state.validation;
  const b = $('vbadge');
  b.textContent = errors.length ? errors.length : warnings.length;
  b.className = 'badge ' + (errors.length ? 'err' : warnings.length ? 'warn' : '');
  $('btnSave').title = errors.length ? `Enregistrement bloqué : ${errors.length} erreur(s)` : 'Enregistrer (Ctrl+S)';
  if (state.tab === 'valid') refreshPanel();
}

function focusItem(at) {
  if (!at) return;
  renderer.highlight = at;
  let c = null;
  if (at.hex) { const [q, r] = parseKey(at.hex); c = center(q, r); }
  else if (at.edge) { const e = parseEdge(at.edge); if (e) { const a = center(e.q1, e.r1), b = center(e.q2, e.r2); c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; } }
  if (c) renderer.focus(c.x, c.y, Math.max(renderer.cam.zoom, 30));
  clearTimeout(focusItem.t);
  focusItem.t = setTimeout(() => { renderer.highlight = null; renderer.request(); }, 4000);
}

function validationPanel() {
  const { errors, warnings, counts, overflow, islands } = state.validation;
  const out = [h('div', { class: 'section' },
    h('h4', null, 'Validation'),
    h('p', null, errors.length ? h('b', { class: 'err' }, `${errors.length} erreur(s) bloquante(s)`) : h('b', { style: { color: '#7c7' } }, 'Aucune erreur bloquante'),
      ` · ${warnings.length} avertissement(s)`),
    h('small', { class: 'muted' }, 'Erreurs = règles du serveur (validateMap), elles empêchent l\'enregistrement. Avertissements = contrôles de l\'éditeur. Cliquer un élément pour le localiser.'),
    h('button', { type: 'button', onclick: runValidate }, 'Revalider'))];
  const group = (list, kind) => {
    const byCode = new Map();
    for (const it of list) { if (!byCode.has(it.code)) byCode.set(it.code, []); byCode.get(it.code).push(it); }
    for (const [code, items] of byCode) {
      const total = counts[code];
      const fix = items[0].fix;
      out.push(h('div', { class: 'vgroup ' + kind },
        h('header', null, h('b', null, `${items[0].msg.split(' :')[0]} (${total})`),
          fix ? h('button', { type: 'button', class: 'small', onclick: () => { applyFix(model, fix); toast('Correction appliquée (annulable).', 'ok'); } }, FIX_LABELS[fix]) : null),
        h('div', { class: 'vlist' }, items.map((it) => h('button', { type: 'button', class: 'vitem', onclick: () => focusItem(it.at) }, it.msg))),
        overflow.find((o) => o.code === code) ? h('small', { class: 'muted' }, `… et ${overflow.find((o) => o.code === code).hidden} autres`) : null));
    }
  };
  group(errors, 'err');
  group(warnings, 'warn');
  out.push(h('small', { class: 'muted' }, `${islands} composante(s) connexe(s).`));
  return out;
}

// ---------------------------------------------------------------- stats panel
function statsPanel() {
  const tc = {}, sc = {}, hc = {};
  for (const [k, v] of model.height) { const t = model.terrainAt(k); tc[t] = (tc[t] || 0) + 1; hc[v] = (hc[v] || 0) + 1; }
  for (const v of model.segments.values()) sc[v] = (sc[v] || 0) + 1;
  const b = model.bounds();
  let qMin = Infinity, qMax = -Infinity, rMin = Infinity, rMax = -Infinity;
  for (const k of model.height.keys()) { const [q, r] = parseKey(k); qMin = Math.min(qMin, q); qMax = Math.max(qMax, q); rMin = Math.min(rMin, r); rMax = Math.max(rMax, r); }
  const tr = (a, v) => h('tr', null, h('td', null, a), h('td', null, String(v)));
  const hs = Object.keys(hc).map(Number).sort((a, b2) => a - b2);
  const maxH = Math.max(1, ...Object.values(hc));
  return [
    h('div', { class: 'section' }, h('h4', null, 'Général'), h('table', { class: 'stats' },
      tr('Cases', model.height.size),
      tr('Étendue q', b ? `${qMin} … ${qMax}` : '—'),
      tr('Étendue r', b ? `${rMin} … ${rMax}` : '—'),
      tr('Champs de blé', model.fields.size),
      tr('Zones de déploiement', model.zoneCount ? model.zoneSizes().map((n, i) => `Z${i + 1}:${n}`).join(' ') : 'auto'),
      tr('Objectifs', model.objectives.length),
      tr('Historique', `${model.undoStack.length} / ${model.redoStack.length}`))),
    h('div', { class: 'section' }, h('h4', null, 'Terrains'), h('table', { class: 'stats' },
      TERRAINS.map((t) => tr(t.name, `${tc[t.id] || 0} (${model.height.size ? Math.round((tc[t.id] || 0) * 100 / model.height.size) : 0} %)`)))),
    h('div', { class: 'section' }, h('h4', null, 'Segments'), h('table', { class: 'stats' },
      SEGMENTS.map((s) => tr(s.name, sc[s.id] || 0)), tr('Total', model.segments.size))),
    h('div', { class: 'section' }, h('h4', null, 'Hauteurs'),
      h('div', { class: 'hist', style: { marginBottom: '16px' } }, hs.map((v) => h('div', { title: `${v} : ${hc[v]} cases`, style: { height: `${hc[v] * 100 / maxH}%` } }, h('span', null, String(v)))))),
  ];
}

// ---------------------------------------------------------------- canvas input
const canvas = $('map');
const vp = $('viewport');

function evInfo(e) {
  const r = canvas.getBoundingClientRect();
  return { sx: e.clientX - r.left, sy: e.clientY - r.top, shift: e.shiftKey, alt: e.altKey };
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = evInfo(e);
  if (e.button === 1 || e.button === 2 || (e.button === 0 && state.space)) {
    state.panning = { x: e.clientX, y: e.clientY };
    vp.classList.add('panning');
    return;
  }
  if (e.button !== 0) return;
  if (e.altKey || state.pickOnce) {
    const res = tools.pick(state.tool, p);
    state.pickOnce = false;
    vp.classList.remove('pick');
    if (res) { toast(`Pipette : ${res}`, 'info', { timeout: 1200 }); refreshPanel(); }
    return;
  }
  tools.down(state.tool, p);
});

canvas.addEventListener('pointermove', (e) => {
  const p = evInfo(e);
  if (state.panning) {
    renderer.pan(e.clientX - state.panning.x, e.clientY - state.panning.y);
    state.panning = { x: e.clientX, y: e.clientY };
    return;
  }
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  if (tools.active()) for (const ce of evs.length ? evs : [e]) tools.move(evInfo(ce));
  updateHover(p);
});

function endPointer(e) {
  if (state.panning) { state.panning = null; vp.classList.remove('panning'); return; }
  tools.up();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { state.hover = null; renderer.request(); });

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = evInfo(e);
  if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX) * 0.5 || e.deltaMode !== 0) {
    const d = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    renderer.zoomAt(p.sx, p.sy, Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0015)));
  } else renderer.pan(-e.deltaX, -e.deltaY);
  updateHover(p);
}, { passive: false });

function updateHover(p) {
  const w = renderer.toWorld(p.sx, p.sy);
  const [q, r] = (() => { const fq = 2 / 3 * w.x, fr = -1 / 3 * w.x + SQRT3 / 3 * w.y; return roundAx(fq, fr); })();
  state.hover = { ...p, x: w.x, y: w.y, q, r, k: key(q, r) };
  renderer.request();
  updateHoverInfo();
}

function roundAx(fq, fr) {
  const fs = -fq - fr;
  let q = Math.round(fq), r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s; else if (dr > ds) r = -q - s;
  return [q, r];
}

function updateHoverInfo() {
  const hv = state.hover;
  if (!hv) return;
  const k = hv.k;
  const parts = [`(${k})`];
  if (!model.has(k)) parts.push('hors carte');
  else {
    parts.push(TERRAIN_BY_ID[model.terrainAt(k)]?.name || model.terrainAt(k), `h=${model.height.get(k)}`);
    const segs = [];
    DIRS.forEach(([dq, dr], i) => { const t = model.segAt(hv.q, hv.r, hv.q + dq, hv.r + dr); if (t) segs.push(`${DIR_NAMES[i]}:${SEGMENT_BY_ID[t]?.name || t}`); });
    if (segs.length) parts.push('Segments ' + segs.join(', '));
    if (model.fields.has(k)) parts.push('Champ');
    const z = model.zoneOf.get(k);
    if (z !== undefined) parts.push(`Zone ${z + 1}`);
    const o = model.objectives.find((x) => x.q === hv.q && x.r === hv.r);
    if (o) parts.push(`★ ${o.name || ''} (${o.type}, ${o.points} pts)`);
  }
  $('hoverInfo').textContent = parts.join(' · ');
}

renderer.overlays.push((ctx, px) => tools.overlay(state.tool, state.hover, ctx, px));

// ---------------------------------------------------------------- keyboard
function inField(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' && !['range', 'checkbox', 'button'].includes(t.type) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
}

window.addEventListener('keydown', (e) => {
  if (document.querySelector('.modal-overlay')) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 's') { e.preventDefault(); if (e.shiftKey) saveAs(); else save(); return; }
  if (inField(e)) return;
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return; }
  if (mod && k === 'y') { e.preventDefault(); doRedo(); return; }
  if (mod) return;
  if (e.key === ' ') { e.preventDefault(); if (!state.space) { state.space = true; vp.classList.add('pan'); } return; }
  const tool = !e.shiftKey && !e.altKey && tools.order.find((id) => { const d = tools.tools[id].key; return e.key === d || e.code === 'Digit' + d || e.code === 'Numpad' + d; });
  if (tool) { setTool(tool); return; }
  if (e.key === '[') { settings.brush = Math.max(0, settings.brush - 1); refreshPanel(); renderer.request(); }
  else if (e.key === ']') { settings.brush = Math.min(8, settings.brush + 1); refreshPanel(); renderer.request(); }
  else if (k === 'i') { state.pickOnce = true; vp.classList.add('pick'); toast('Pipette : cliquer sur la carte', 'info', { timeout: 1500 }); }
  else if (k === 'f' && state.tool === 'terrain') { settings.terrainFill = !settings.terrainFill; refreshPanel(); }
  else if (k === 'f' || e.key === 'Home') renderer.fit();
  else if (k === 'g') { view.showGrid = !view.showGrid; saveView(); renderer.request(); refreshPanel(); }
  else if (k === 'l') { view.showLabels = !view.showLabels; saveView(); renderer.request(); refreshPanel(); }
  else if (k === 'm') { view.display = { terrain: 'height', height: 'none', none: 'terrain' }[view.display]; saveView(); renderer.invalidateAll(); refreshPanel(); }
  else if (k === 'b') { view.bgVisible = !view.bgVisible; saveView(); renderer.request(); refreshPanel(); }
  else if (k === 'p') togglePreview();
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (state.tool === 'objective') tools.deleteSelected(); }
  else if (e.key === 'Escape') { tools.cancel(); state.pickOnce = false; vp.classList.remove('pick'); view.selectedObjective = null; renderer.highlight = null; renderer.request(); }
  else if (e.key === '?') showHelp();
  else if (e.key === '+' || e.key === '=') renderer.zoomAt(renderer.w / 2, renderer.h / 2, 1.25);
  else if (e.key === '-') renderer.zoomAt(renderer.w / 2, renderer.h / 2, 0.8);
  else if (e.key.startsWith('Arrow')) {
    const d = 80;
    renderer.pan(e.key === 'ArrowLeft' ? d : e.key === 'ArrowRight' ? -d : 0, e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0);
  }
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') { state.space = false; vp.classList.remove('pan'); } });
window.addEventListener('blur', () => { state.space = false; vp.classList.remove('pan'); tools.up(); });

function doUndo() { const l = model.undo(); if (l) { toast(`Annulé : ${l}`, 'info', { timeout: 1200 }); refreshPanelSoon(); } }
function doRedo() { const l = model.redo(); if (l) { toast(`Rétabli : ${l}`, 'info', { timeout: 1200 }); refreshPanelSoon(); } }

function showHelp() {
  const rows = [
    ['1 … 8', 'Outils : terrain, hauteur, cases, segments, décor, zones, objectifs, fond'],
    ['Clic gauche', 'Peindre / appliquer l\'outil'],
    ['Maj + clic', 'Gomme / effet inverse'],
    ['Alt + clic, I', 'Pipette'],
    ['[ / ]', 'Taille du pinceau'],
    ['Clic droit / milieu, Espace + glisser', 'Déplacer la vue'],
    ['Molette, + / −', 'Zoom'],
    ['Flèches', 'Déplacer la vue'],
    ['F', 'Recadrer (outil Terrain : bascule remplissage)'],
    ['M', 'Mode d\'affichage (terrain / hauteurs / calque)'],
    ['G, L, B', 'Grille, étiquettes, fond'],
    ['Ctrl+Z, Ctrl+Maj+Z / Ctrl+Y', 'Annuler / rétablir'],
    ['Ctrl+S, Ctrl+Maj+S', 'Enregistrer / enregistrer sous'],
    ['P', 'Aperçu 3D'],
    ['Suppr', 'Supprimer l\'objectif sélectionné'],
  ];
  modal({ title: 'Raccourcis clavier', wide: true, body: h('table', { class: 'stats' }, rows.map(([a, b]) => h('tr', null, h('td', null, h('b', null, a)), h('td', { style: { textAlign: 'left' } }, b)))) });
}

// ---------------------------------------------------------------- admin / IO
async function refreshAdmin() {
  try {
    const me = await api('GET', '/api/admin/me');
    state.admin = !!me.admin;
    $('adminState').innerHTML = '';
    $('adminState').append(me.admin ? 'Admin connecté' : h('a', { href: '#', onclick: (e) => { e.preventDefault(); ensureAdmin(); } }, me.configured ? 'Non connecté — se connecter' : 'Admin non configuré'));
  } catch (e) { state.admin = false; }
}

async function ensureAdmin(reason) {
  await refreshAdmin();
  if (state.admin) return true;
  const ok = await loginModal(reason);
  await refreshAdmin();
  return ok && state.admin;
}

function updateTitle() {
  const m = model.meta;
  const t = $('mapTitle');
  t.innerHTML = '';
  t.append(m.name || '(sans nom)', ' ', h('small', null, `[${m.id || '?'}]${state.serverExists ? '' : ' — non enregistrée'}`));
  t.title = `${m.name} [${m.id}]`;
  $('dirty').textContent = model.dirty ? '● modifiée' : '';
  document.title = `${model.dirty ? '● ' : ''}${m.name || m.id} — Éditeur de cartes`;
  $('btnUndo').disabled = !model.undoStack.length;
  $('btnRedo').disabled = !model.redoStack.length;
  $('previewOpen').href = `/map3d.html?map=${encodeURIComponent(m.id)}`;
}

async function refreshMapList() {
  try {
    const list = await api('GET', '/api/maps');
    const sel = $('openSelect');
    sel.innerHTML = '';
    sel.append(h('option', { value: '' }, 'Ouvrir…'));
    for (const m of list) sel.append(h('option', { value: m.id }, `${m.name} [${m.id}] · ${m.hexCount} cases`));
    return list;
  } catch (e) { return []; }
}

$('openSelect').addEventListener('change', async (e) => {
  const id = e.target.value;
  e.target.value = '';
  if (!id) return;
  if (model.dirty && !(await confirmModal('Ouvrir une autre carte', 'Les modifications non enregistrées restent dans le brouillon local de cette carte. Continuer ?', { okLabel: 'Ouvrir' }))) return;
  flushDraft();
  await openMap(id);
});

async function openMap(id, { preferServer = false } = {}) {
  let doc = null;
  try { doc = await api('GET', `/api/maps/${encodeURIComponent(id)}`); state.serverExists = true; } catch (e) { state.serverExists = false; }
  const draft = readDraft(id);
  if (draft && !preferServer && (!doc || draft.dirty)) {
    loadDoc(draft.doc, { dirty: true });
    const when = new Date(draft.ts).toLocaleString('fr-FR');
    if (doc) toast(`Brouillon local du ${when} restauré.`, 'info', { action: { label: 'Version serveur', fn: () => discardDraft(id) }, timeout: 6000 });
    else toast(`Brouillon local du ${when} restauré (carte non encore enregistrée).`, 'info');
  } else if (doc) loadDoc(doc);
  else { toast(`Carte « ${id} » introuvable.`, 'error'); if (id !== 'default') return openMap('default'); return; }
  history.replaceState(null, '', `?map=${encodeURIComponent(model.meta.id)}`);
  localStorage.setItem('kbMapEditor:last', model.meta.id);
}

async function discardDraft(id) {
  localStorage.removeItem(LS_DRAFT(id));
  await openMap(id, { preferServer: true });
  toast('Version serveur rechargée.', 'ok');
}

function loadDoc(doc, { dirty = false } = {}) {
  view.selectedObjective = null;
  model.load(doc);
  if (dirty) model.markDirty(); else model.markSaved();
  renderer.highlight = null;
  const sess = JSON.parse(sessionStorage.getItem('kbMapEditor:session') || 'null');
  sessionStorage.removeItem('kbMapEditor:session');
  if (sess && sess.id === doc.id && sess.cam) {
    Object.assign(renderer.cam, sess.cam);
    renderer.request();
    if (sess.tool) setTool(sess.tool);
    if (Number.isFinite(sess.brush)) settings.brush = sess.brush;
    if (sess.tab) state.tab = sess.tab;
    for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === state.tab);
  } else renderer.fit();
  updateTitle();
  refreshPanel();
  runValidate();
  if (!$('preview').hidden) reloadPreview();
}

// ---- autosave draft
function readDraft(id) {
  try { return JSON.parse(localStorage.getItem(LS_DRAFT(id)) || 'null'); } catch (e) { return null; }
}
let draftTimer = null;
function scheduleDraft() { clearTimeout(draftTimer); draftTimer = setTimeout(flushDraft, 1500); }
function flushDraft() {
  clearTimeout(draftTimer);
  const id = model.meta.id;
  if (!id) return;
  try {
    if (model.dirty) localStorage.setItem(LS_DRAFT(id), JSON.stringify({ ts: Date.now(), dirty: true, doc: model.toDoc() }));
    else localStorage.removeItem(LS_DRAFT(id));
  } catch (e) { toast('Brouillon local non sauvegardé (stockage plein ?)', 'error'); }
}
function saveSession() {
  sessionStorage.setItem('kbMapEditor:session', JSON.stringify({ id: model.meta.id, tool: state.tool, tab: state.tab, cam: renderer.cam, brush: settings.brush }));
}
window.addEventListener('pagehide', () => { flushDraft(); saveSession(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) flushDraft(); });

// ---- save
async function putMap(doc) {
  try { return await api('PUT', `/api/maps/${encodeURIComponent(doc.id)}`, doc); } catch (e) {
    if (e.status === 401 && await loginModal('Session administrateur expirée ou absente : se connecter pour enregistrer.')) {
      await refreshAdmin();
      return api('PUT', `/api/maps/${encodeURIComponent(doc.id)}`, doc);
    }
    throw e;
  }
}

async function save() {
  tools.cancel();
  runValidate();
  if (state.validation.errors.length) { setTab('valid'); return toast(`Enregistrement impossible : ${state.validation.errors.length} erreur(s).`, 'error'); }
  if (!state.serverExists) {
    const list = await refreshMapList();
    if (list.some((m) => m.id === model.meta.id) && !(await confirmModal('Écraser ?', `Une carte « ${model.meta.id} » existe déjà sur le serveur. L'écraser ?`, { okLabel: 'Écraser', danger: true }))) return;
  }
  try {
    const saved = await putMap(model.toDoc());
    model.meta.updatedAt = saved.updatedAt;
    model.markSaved();
    state.serverExists = true;
    localStorage.removeItem(LS_DRAFT(saved.id));
    updateTitle();
    refreshMapList();
    toast(`Carte « ${saved.name} » enregistrée.`, 'ok');
    if (!$('preview').hidden && $('previewMode').value === 'saved') reloadPreview();
  } catch (e) {
    toast('Erreur d\'enregistrement : ' + e.message, 'error', { timeout: 8000 });
  }
}

async function saveAs() {
  tools.cancel();
  const idIn = h('input', { type: 'text', value: suggestId(model.meta.id), placeholder: 'ma-carte' });
  const nameIn = h('input', { type: 'text', value: model.meta.name ? `${model.meta.name} (copie)` : '' });
  const err = h('p', { class: 'err' });
  const list = await refreshMapList();
  const ok = await modal({
    title: 'Enregistrer sous…',
    body: [field('Identifiant (a-z, 0-9, - et _)', idIn), field('Nom', nameIn), err],
    buttons: [{ label: 'Annuler', value: false }, {
      label: 'Enregistrer', value: true, primary: true,
      validate: async () => {
        const id = idIn.value.trim();
        if (!ID_RE.test(id)) { err.textContent = 'Identifiant invalide.'; return false; }
        if (!nameIn.value.trim()) { err.textContent = 'Nom requis.'; return false; }
        if (list.some((m) => m.id === id)) {
          return confirmModal('Écraser ?', `La carte « ${id} » existe déjà. L'écraser ?`, { okLabel: 'Écraser', danger: true });
        }
        return true;
      },
    }],
  });
  if (!ok) return;
  const id = idIn.value.trim(), name = nameIn.value.trim();
  const oldId = model.meta.id;
  clearTimeout(draftTimer);
  model.meta = { ...model.meta, id, name, updatedAt: null };
  state.serverExists = true;
  model.markDirty();
  history.replaceState(null, '', `?map=${encodeURIComponent(id)}`);
  updateTitle();
  if (state.validation.errors.length) runValidate();
  await save();
  if (!model.dirty && oldId !== id) {
    localStorage.removeItem(LS_DRAFT(oldId));
    toast(`La carte « ${oldId} » n'a pas été modifiée sur le serveur.`, 'info');
  }
}

function suggestId(id) {
  const base = (id || 'carte').replace(/-copie(-\d+)?$/, '');
  return `${base}-copie`.slice(0, 63);
}

// ---- new map wizard
async function newMapWizard() {
  if (model.dirty) flushDraft();
  const list = await refreshMapList();
  const idIn = h('input', { type: 'text', value: '', placeholder: 'nouvelle-carte' });
  const nameIn = h('input', { type: 'text', value: '', placeholder: 'Nouvelle carte' });
  let mode = 'rect';
  const wIn = num(40, { min: 1, max: 200 }), hIn = num(30, { min: 1, max: 200 }), baseIn = num(1, { min: -2, max: 20 });
  const imgIn = h('input', { type: 'text', value: '/assets/img/map.webp' });
  const hsIn = num(101.5, { step: 0.1 }), oxIn = num(137, { step: 1 }), oyIn = num(190, { step: 1 });
  const info = h('p', { class: 'muted' });
  const err = h('p', { class: 'err' });
  const rectBox = h('div', { class: 'row' }, field('Colonnes', wIn), field('Lignes', hIn));
  const imgBox = h('div', { class: 'modal-body', style: { display: 'none' } },
    field('Image (chemin)', imgIn, state.editorRoutes === false ? 'Déposer l\'image dans public/assets/maps/' : 'Vous pourrez aussi en téléverser une depuis l\'outil Fond.'),
    h('div', { class: 'row' }, field('Taille d\'hex (px)', hsIn), field('Origine X', oxIn), field('Origine Y', oyIn)),
    h('small', { class: 'muted' }, 'Les cases dont le centre tombe dans l\'image sont créées. La calibration reste ajustable ensuite (outil Fond).'));
  const modeCtl = seg([{ id: 'rect', name: 'Rectangle' }, { id: 'image', name: 'Depuis une image' }], mode, (v) => {
    mode = v; rectBox.style.display = v === 'rect' ? '' : 'none'; imgBox.style.display = v === 'image' ? '' : 'none'; updInfo();
  });
  const updInfo = () => { info.textContent = mode === 'rect' ? `${(+wIn.value || 0) * (+hIn.value || 0)} cases` : ''; };
  wIn.addEventListener('input', updInfo); hIn.addEventListener('input', updInfo); updInfo();
  let built = null;
  const ok = await modal({
    title: 'Nouvelle carte', wide: true,
    body: [h('div', { class: 'row' }, field('Identifiant', idIn), field('Nom', nameIn)), modeCtl, rectBox, imgBox, field('Hauteur de base', baseIn), info, err],
    buttons: [{ label: 'Annuler', value: false }, {
      label: 'Créer', value: true, primary: true,
      validate: async () => {
        const id = idIn.value.trim();
        if (!ID_RE.test(id)) { err.textContent = 'Identifiant invalide (a-z, 0-9, - et _).'; return false; }
        if (list.some((m) => m.id === id)) { err.textContent = `La carte « ${id} » existe déjà sur le serveur.`; return false; }
        const base = clampHeight(+baseIn.value || 0);
        const doc = { format: 2, id, name: nameIn.value.trim() || id, description: '', author: '', background: null, height: {}, terrain: {}, segments: {}, decor: { fields: [] }, zones: [], objectives: [] };
        if (mode === 'rect') {
          const w = Math.round(+wIn.value), hh = Math.round(+hIn.value);
          if (!(w > 0 && hh > 0 && w * hh <= 40000)) { err.textContent = 'Dimensions invalides (max 40 000 cases).'; return false; }
          for (const [q, r] of rectangle(w, hh)) doc.height[key(q, r)] = base;
        } else {
          try {
            const { width, height } = await loadImageSize(imgIn.value.trim());
            const bg = { image: imgIn.value.trim(), hexSize: +hsIn.value, origX: +oxIn.value, origY: +oyIn.value, width, height };
            if (!(bg.hexSize > 1)) { err.textContent = 'Taille d\'hex invalide.'; return false; }
            const keys = hexesInImage(bg);
            if (!keys.length || keys.length > 40000) { err.textContent = `${keys.length} cases : vérifier la calibration.`; return false; }
            for (const k of keys) doc.height[k] = base;
            doc.background = bg;
          } catch (e) { err.textContent = e.message; return false; }
        }
        built = doc;
        return true;
      },
    }],
  });
  if (!ok || !built) return;
  state.serverExists = false;
  loadDoc(built, { dirty: true });
  history.replaceState(null, '', `?map=${encodeURIComponent(built.id)}`);
  flushDraft();
  toast(`Carte « ${built.name} » créée (${Object.keys(built.height).length} cases) — pensez à l'enregistrer.`, 'ok', { timeout: 5000 });
}
E.ui.newMapWizard = newMapWizard;

// ---- import / export
$('btnExport').addEventListener('click', () => downloadJson(model.toDoc(), `${model.meta.id || 'carte'}.json`));
async function importFile(f) {
  try {
    const doc = JSON.parse(await f.text());
    if (!doc || typeof doc !== 'object' || !doc.height || typeof doc.height !== 'object') throw new Error('Fichier sans « height » : pas une carte au format 2.');
    if (!doc.id || !ID_RE.test(doc.id)) doc.id = (f.name.replace(/\.json$/i, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+/, '') || 'import').slice(0, 63);
    if (!doc.name) doc.name = doc.id;
    if (model.dirty) flushDraft();
    const list = await refreshMapList();
    state.serverExists = list.some((m) => m.id === doc.id);
    loadDoc(doc, { dirty: true });
    history.replaceState(null, '', `?map=${encodeURIComponent(doc.id)}`);
    toast(`Importé : ${doc.name} [${doc.id}]${state.serverExists ? ' — l\'enregistrement écrasera la carte serveur du même id' : ''}`, 'ok', { timeout: 6000 });
  } catch (e) { toast('Import impossible : ' + e.message, 'error'); }
}
window.__editor.importFile = importFile;
$('btnImport').addEventListener('click', async () => { const f = await pickFile('application/json,.json'); if (f) importFile(f); });
vp.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
vp.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (!f) return;
  e.preventDefault();
  if (/\.json$/i.test(f.name) || f.type === 'application/json') importFile(f);
  else toast('Déposer un fichier .json de carte.', 'error');
});

$('btnNew').addEventListener('click', newMapWizard);
$('btnSave').addEventListener('click', save);
$('btnSaveAs').addEventListener('click', saveAs);
$('btnUndo').addEventListener('click', doUndo);
$('btnRedo').addEventListener('click', doRedo);
$('btnFit').addEventListener('click', () => renderer.fit());
$('btnHelp').addEventListener('click', showHelp);

// ---------------------------------------------------------------- 3D preview
function togglePreview(force) {
  const p = $('preview');
  const show = force !== undefined ? force : p.hidden;
  p.hidden = !show;
  $('btnPreview').classList.toggle('on', show);
  if (show) reloadPreview(); else $('previewFrame').src = 'about:blank';
  requestAnimationFrame(() => renderer.resize());
}

function reloadPreview() {
  const f = $('previewFrame');
  if ($('preview').hidden) return;
  f.src = $('previewMode').value === 'saved'
    ? `/map3d.html?map=${encodeURIComponent(model.meta.id)}&nointro&t=${Date.now()}`
    : `/admin/preview3d.html?t=${Date.now()}`;
}
$('btnPreview').addEventListener('click', () => togglePreview());
$('previewClose').addEventListener('click', () => togglePreview(false));
$('previewReload').addEventListener('click', reloadPreview);
$('previewMode').addEventListener('change', () => {
  if ($('previewMode').value === 'saved' && !state.serverExists) toast('Cette carte n\'est pas encore enregistrée sur le serveur.', 'error');
  reloadPreview();
});

// ---------------------------------------------------------------- model change hooks
let titleQueued = false;
function updateTitleSoon() {
  if (titleQueued) return;
  titleQueued = true;
  requestAnimationFrame(() => { titleQueued = false; updateTitle(); });
}
model.on((ch) => {
  if (ch.layers || ch.all || ch.saved !== undefined) {
    updateTitleSoon();
    scheduleValidate();
    if (ch.saved !== true) scheduleDraft();
    if (ch.all) refreshPanelSoon();
  }
  if (ch.layers && ch.layers.has('meta')) { syncBackgroundInputs(); if (!tools.active()) refreshPanelSoon(); }
});
renderer.onBackgroundLoaded = () => { if (state.tool === 'background') refreshPanelSoon(); };

setInterval(() => {
  $('perfInfo').textContent = `rendu ${renderer.lastDrawMs.toFixed(1)} ms`;
  $('zoomInfo').textContent = `zoom ${(renderer.cam.zoom).toFixed(1)} px/case`;
}, 500);

window.addEventListener('resize', () => renderer.resize());
new ResizeObserver(() => renderer.resize()).observe(vp);

// ---------------------------------------------------------------- boot
(async function boot() {
  buildToolbar();
  setTool('terrain');
  await refreshAdmin();
  refreshMapList();
  api('GET', '/api/editor/backgrounds').then(() => { state.editorRoutes = true; }).catch((e) => { state.editorRoutes = e.status === 404 ? false : null; });
  const params = new URLSearchParams(location.search);
  if (params.has('new')) {
    await openMap(localStorage.getItem('kbMapEditor:last') || 'default');
    newMapWizard();
  } else await openMap(params.get('map') || localStorage.getItem('kbMapEditor:last') || 'default');
})();
