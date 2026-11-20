// Editable grid for one balance table: inputs bound to the draft, live validation and diff highlighting
import { h } from '/js/editor/dom.js';
import * as M from './model.js';

const MODIFIER_TABLES = new Set(['terrains', 'segments', 'stances']);

function parseInput(col, el) {
  const f = col.f;
  if (f.type === 'bool') return el.checked;
  if (f.type === 'enum') return el.value === '' ? (f.nullable ? null : undefined) : el.value;
  if (f.type === 'int') {
    if (el.value === '') return (f.optional || col.parent) ? undefined : '';
    const n = Number(el.value);
    return Number.isFinite(n) ? n : el.value;
  }
  if (el.value === '' && (f.optional || (col.parent && col.parent.optional))) return undefined;
  return el.value;
}

function setInput(col, el, v) {
  const f = col.f;
  if (f.type === 'bool') el.checked = !!v;
  else if (f.type === 'enum') el.value = v == null ? '' : v;
  else el.value = v == null ? '' : String(v);
  if (f.type === 'int') signClass(el, v);
}

function signClass(el, v) {
  el.classList.toggle('pos', typeof v === 'number' && v > 0);
  el.classList.toggle('neg', typeof v === 'number' && v < 0);
}

function makeInput(t, col, listId) {
  const f = col.f;
  let el;
  if (f.type === 'bool') el = h('input', { type: 'checkbox' });
  else if (f.type === 'enum') {
    el = h('select', null, f.nullable ? h('option', { value: '' }, '—') : null, f.options.map((o) => h('option', { value: o }, o)));
  } else if (f.type === 'int') el = h('input', { type: 'number', step: 1, min: f.min, max: f.max, class: MODIFIER_TABLES.has(t) ? 'mod' : (f.max >= 10000 ? 'big' : '') });
  else if (f.multiline) el = h('textarea', { rows: 1, class: 'grow', maxlength: f.maxLength });
  else el = h('input', { type: 'text', maxlength: f.maxLength, list: listId || null, class: f.maxLength > 40 ? 'wide' : '' });
  return el;
}

export function renderTable(t, wrap) {
  const cols = M.columns(t);
  const spec = M.state.spec[t];
  wrap.innerHTML = '';
  const lists = [];
  const head = h('tr', null, h('th', { class: 'sticky' }, 'Entrée'));
  const groupRow = h('tr', { class: 'groups' }, h('th', { class: 'sticky' }));
  let lastGroup = null;
  let groupCell = null;
  for (const col of cols) {
    if (col.f.readOnly) continue;
    const g = col.parent ? col.parent.label : (col.f.group || '');
    if (g !== lastGroup || !g) {
      groupCell = h('th', { colspan: 1 }, g);
      groupRow.append(groupCell);
      lastGroup = g;
    } else groupCell.colSpan++;
    head.append(h('th', { title: [col.label, col.f.hint, col.f.type === 'int' ? `${col.f.min} … ${col.f.max}` : null, col.f.optional ? 'facultatif' : null].filter(Boolean).join(' — ') },
      col.f.label, col.f.optional || (col.parent && col.parent.optional) ? h('sup', null, '?') : null));
  }
  const showGroups = cols.some((c) => c.parent || c.f.group);
  const tbody = h('tbody');
  const cells = [];
  for (const [id, e] of M.entries(t)) {
    const tr = h('tr', null, h('th', { class: 'sticky rowhead' }, h('b', null, e.name || id), h('div', { class: 'id' }, id)));
    for (const col of cols) {
      if (col.f.readOnly) continue;
      let listId = null;
      if (col.f.options && col.f.type === 'string') {
        listId = `dl-${t}-${col.path.join('-')}`;
        if (!lists.some((l) => l.id === listId)) lists.push(h('datalist', { id: listId }, col.f.options.map((o) => h('option', { value: o }))));
      }
      const el = makeInput(t, col, listId);
      setInput(col, el, M.getValue(e, col.path));
      if (col.parent && col.parent.optional && el.tagName !== 'SELECT') el.placeholder = '—';
      const td = h('td', { class: `t-${col.f.type}` }, el);
      const ev = col.f.type === 'bool' || col.f.type === 'enum' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        const v = parseInput(col, el);
        if (col.f.type === 'int') signClass(el, v);
        M.edit(t, id, col, v, { coalesce: ev === 'input' });
      });
      td.addEventListener('contextmenu', (evt) => {
        if (!M.isChanged(t, id, col)) return;
        evt.preventDefault();
        M.revertCell(t, id, col);
        setInput(col, el, M.getValue(M.entry(t, id), col.path));
      });
      cells.push({ id, col, td, el });
      tr.append(td);
    }
    tbody.append(tr);
  }
  const table = h('table', { class: 'bt' + (MODIFIER_TABLES.has(t) ? ' modifiers' : '') }, h('thead', null, showGroups ? groupRow : null, head), tbody);
  wrap.append(h('div', { class: 'scroll' }, table), ...lists);

  function refresh() {
    const errs = M.validate(t);
    for (const c of cells) {
      const key = `${c.id}|${c.col.path.join('.')}`;
      const err = errs.get(key);
      const changed = M.isChanged(t, c.id, c.col);
      c.td.classList.toggle('invalid', !!err);
      c.td.classList.toggle('changed', changed);
      const saved = M.getValue(M.entry(t, c.id, M.state.saved[t].data), c.col.path);
      c.td.title = [err, changed ? `Enregistré : ${M.fmt(saved)} (clic droit pour annuler)` : null].filter(Boolean).join('\n');
    }
    for (const se of M.state.serverErrors[t] || []) {
      if (se.field) continue;
      const row = cells.find((c) => c.id === se.id);
      if (row) row.td.parentElement.querySelector('.rowhead').title = se.message;
    }
    return errs;
  }
  refresh();
  return { refresh, spec };
}
