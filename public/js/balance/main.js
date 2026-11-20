// Balance editor page: tabs per table, save / undo / diff, history and simulations
import { api, toast, loginModal } from '/js/editor/ui.js';
import { h } from '/js/editor/dom.js';
import * as M from './model.js';
import { renderTable } from './tables.js';
import { mountHistory } from './history.js';
import { mountSim } from './sim.js';

const $ = (id) => document.getElementById(id);
const NOTES = {
  units: 'Statistiques de base copiées dans chaque unité quand l\'armée est constituée. Le coût est en or (budget de la partie).',
  generals: 'Le général entre en jeu avec sa vitalité, son armure, les dégâts de son arme (puissance), sa force (défense), sa stratégie (vision et initiative) et charisme / 2 (intimidation). Les capacités sont facultatives (texte ; l\'effet de la capacité active est codé dans le moteur).',
  terrains: 'Modificateurs appliqués à une unité selon le terrain de sa case (CàC = corps à corps, tir = à distance).',
  segments: 'Modificateurs des bords entre deux cases (rivières, murs, ponts…) appliqués lors d\'un combat ou d\'un déplacement à travers le bord.',
  stances: 'Modificateurs des postures choisies par les joueurs pour leurs unités.',
};

let active = 'units';
let grid = null;
let sim = null;
let history = null;
const views = {};

function totalChanges() {
  return M.state.order.reduce((n, t) => n + M.changes(t).length, 0);
}

function hasErrors(t) {
  return M.validate(t).size > 0;
}

function updateChrome() {
  for (const t of M.state.order) {
    const n = M.changes(t).length;
    const tab = document.querySelector(`.tabs button[data-tab="${t}"]`);
    tab.querySelector('.badge').textContent = n ? String(n) : '';
    tab.classList.toggle('err', hasErrors(t));
  }
  const n = totalChanges();
  $('saveBtn').textContent = n ? `Enregistrer (${n})` : 'Enregistrer';
  $('saveBtn').disabled = !n;
  const isTable = M.state.order.includes(active);
  $('undoBtn').disabled = !isTable || !M.state.undo[active].length;
  $('redoBtn').disabled = !isTable || !M.state.redo[active].length;
  $('discardBtn').disabled = !isTable || !M.changes(active).length;
  if (isTable) renderSide();
  if (sim) sim.refresh();
}

function renderSide() {
  const t = active;
  const errs = grid ? grid.refresh() : M.validate(t);
  const ch = M.changes(t);
  const box = $('side');
  box.replaceChildren(...[
    h('h3', null, `Modifications non enregistrées (${ch.length})`),
    ch.length ? h('ul', { class: 'changes' }, ch.map((d) => h('li', null,
      h('b', null, d.name || d.id), ` › ${d.col ? d.col.label : ''} : `, h('span', { class: 'before' }, M.fmt(d.before)), ' → ', h('span', { class: 'after' }, M.fmt(d.after)),
      d.col ? h('button', { type: 'button', class: 'small x', title: 'Annuler cette modification', onclick: () => { M.revertCell(t, d.id, d.col); rerender(); } }, '↺') : null))) : h('p', { class: 'muted' }, 'Aucune.'),
    errs.size ? h('h3', { class: 'errh' }, `Erreurs (${errs.size})`) : null,
    errs.size ? h('ul', { class: 'errors' }, [...errs].slice(0, 30).map(([k, msg]) => h('li', null, h('b', null, k.split('|')[0]), ' : ', msg))) : null,
  ].filter(Boolean));
}

function rerender() {
  if (!M.state.order.includes(active)) return;
  const wrap = views[active];
  grid = renderTable(active, wrap.querySelector('.gridwrap'));
  updateChrome();
}

function show(tab) {
  active = tab;
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const [k, v] of Object.entries(views)) v.hidden = k !== tab;
  const isTable = M.state.order.includes(tab);
  $('editActions').hidden = !isTable;
  $('side').hidden = !isTable;
  document.querySelector('.layout').classList.toggle('full', !isTable);
  if (isTable) rerender();
  if (tab === 'history') history.load();
  if (tab === 'sim') sim.refresh();
  history && updateChrome();
  try { localStorage.setItem('kbBalance:tab', tab); } catch (e) { /* ignore */ }
}

async function reloadTable(t) {
  const fresh = await api('GET', `/api/balance/${t}`);
  M.setSaved(t, fresh);
  if (active === t) rerender(); else updateChrome();
}

async function saveAll() {
  const dirty = M.state.order.filter((t) => M.changes(t).length);
  for (const t of dirty) {
    if (hasErrors(t)) { show(t); toast(`Corrigez les erreurs de « ${M.state.spec[t].label} » avant d'enregistrer.`, 'error'); return; }
  }
  let saved = 0;
  for (const t of dirty) {
    const data = M.clone(M.state.draft[t]);
    try {
      const r = await api('PUT', `/api/balance/${t}`, { data, baseVersion: M.state.saved[t].version });
      M.state.saved[t] = { version: r.version, data: M.clone(data) };
      M.state.undo[t] = [];
      M.state.redo[t] = [];
      M.state.serverErrors[t] = [];
      saved++;
    } catch (e) {
      if (e.status === 401) { toast('Session expirée : reconnectez-vous.', 'error'); if (await loginModal('Session expirée.')) return saveAll(); return; }
      if (e.status === 409) {
        show(t);
        toast(`« ${M.state.spec[t].label} » a été modifiée ailleurs.`, 'error', { action: { label: 'Recharger (perd vos modifications)', fn: () => reloadTable(t) }, timeout: 8000 });
        return;
      }
      if (e.details) { M.state.serverErrors[t] = e.details; show(t); }
      toast(`« ${M.state.spec[t].label} » : ${e.message}`, 'error');
      return;
    } finally {
      if (active === t) rerender();
    }
  }
  if (saved) {
    toast(`${saved} table${saved > 1 ? 's' : ''} enregistrée${saved > 1 ? 's' : ''} : appliqué aux nouvelles parties.`, 'ok');
    refreshVersion();
  }
  updateChrome();
}

async function refreshVersion() {
  try { $('version').textContent = `données ${(await api('GET', '/api/balance')).version}`; } catch (e) { /* ignore */ }
}

async function start() {
  const me = await api('GET', '/api/admin/me').catch(() => ({ admin: false, configured: false }));
  if (!me.admin) {
    $('login').hidden = false;
    $('loginErr').textContent = me.configured ? '' : 'Aucun mot de passe admin configuré (ADMIN_PASSWORD ou config.local.json).';
    $('loginBtn').onclick = async () => { if (await loginModal()) location.reload(); };
    return;
  }
  const [schema, all] = await Promise.all([api('GET', '/api/balance/schema'), api('GET', '/api/balance')]);
  const tables = {};
  await Promise.all(schema.order.map(async (t) => { tables[t] = await api('GET', `/api/balance/${t}`); }));
  M.init(schema, tables);
  $('version').textContent = `données ${all.version}`;
  $('app').hidden = false;

  const tabs = $('tabs');
  const main = $('views');
  for (const t of M.state.order) {
    tabs.append(h('button', { type: 'button', 'data-tab': t, onclick: () => show(t) }, M.state.spec[t].label, h('span', { class: 'badge' })));
    views[t] = h('div', { class: 'view' }, h('p', { class: 'muted note' }, NOTES[t] || ''), h('div', { class: 'gridwrap' }));
    main.append(views[t]);
  }
  tabs.append(h('button', { type: 'button', 'data-tab': 'history', onclick: () => show('history') }, 'Historique'));
  tabs.append(h('button', { type: 'button', 'data-tab': 'sim', onclick: () => show('sim') }, 'Simulation'));
  views.history = h('div', { class: 'view' });
  views.sim = h('div', { class: 'view' });
  main.append(views.history, views.sim);
  history = mountHistory(views.history, { onRestored: async (t) => { await reloadTable(t); refreshVersion(); } });
  sim = mountSim(views.sim, { hasUnsaved: () => totalChanges() > 0 });

  M.onChange(() => updateChrome());
  $('saveBtn').onclick = saveAll;
  $('undoBtn').onclick = () => { if (M.undo(active)) rerender(); };
  $('redoBtn').onclick = () => { if (M.redoOp(active)) rerender(); };
  $('discardBtn').onclick = () => { M.discard(active); rerender(); };
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); saveAll(); return; }
    if (!M.state.order.includes(active)) return;
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); if (M.undo(active)) rerender(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); if (M.redoOp(active)) rerender(); }
  });
  window.addEventListener('beforeunload', (e) => { if (totalChanges()) { e.preventDefault(); e.returnValue = ''; } });

  window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (views[t]) show(t); });
  let initial = 'units';
  try { initial = location.hash.slice(1) || localStorage.getItem('kbBalance:tab') || 'units'; } catch (e) { /* ignore */ }
  show(views[initial] ? initial : 'units');
}

start().catch((e) => toast(`Chargement impossible : ${e.message}`, 'error', { timeout: 0 }));
