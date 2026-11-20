// Saved versions replaced by each save (data/balance/history): preview differences and restore
import { api, toast, modal, confirmModal } from '/js/editor/ui.js';
import { h } from '/js/editor/dom.js';
import * as M from './model.js';

export function mountHistory(root, { onRestored }) {
  const filter = h('select', null, h('option', { value: '' }, 'Toutes les tables'), M.state.order.map((t) => h('option', { value: t }, M.state.spec[t].label)));
  const tbody = h('tbody');
  root.append(h('div', { class: 'card' },
    h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('h2', { style: { margin: 0 } }, 'Historique des versions'), filter),
    h('p', { class: 'muted' }, 'Chaque enregistrement conserve la version remplacée (data/balance/history, 100 dernières par table). Restaurer une version l\'enregistre comme version courante (la version courante est elle-même archivée).'),
    h('table', { class: 'hist' }, h('thead', null, h('tr', null, h('th', null, 'Table'), h('th', null, 'Remplacée le'), h('th', null, 'Différences avec la version enregistrée'), h('th'))), tbody)));

  async function load() {
    let list;
    try { list = await api('GET', `/api/balance/history${filter.value ? `?table=${filter.value}` : ''}`); } catch (e) { tbody.replaceChildren(h('tr', null, h('td', { colspan: 4, class: 'err' }, e.message))); return; }
    tbody.replaceChildren();
    if (!list.length) tbody.append(h('tr', null, h('td', { colspan: 4, class: 'muted' }, 'Aucune version archivée pour l\'instant.')));
    for (const item of list) {
      const summary = h('td', { class: 'muted' }, '…');
      tbody.append(h('tr', null,
        h('td', null, M.state.spec[item.table].label),
        h('td', null, new Date(item.replacedAt).toLocaleString('fr-FR')),
        summary,
        h('td', { class: 'actions' },
          h('button', { type: 'button', class: 'small', onclick: () => preview(item) }, 'Voir'),
          h('button', { type: 'button', class: 'small primary', onclick: () => restore(item) }, 'Restaurer'))));
      api('GET', `/api/balance/history/${encodeURIComponent(item.file)}`).then((v) => {
        item.data = v.data;
        const d = M.diff(item.table, M.state.saved[item.table].data, v.data);
        summary.textContent = d.length ? `${d.length} valeur${d.length > 1 ? 's' : ''} : ${d.slice(0, 3).map((x) => `${x.name || x.id} ${x.col ? x.col.label : ''}`).join(', ')}${d.length > 3 ? '…' : ''}` : 'identique à la version enregistrée';
      }).catch(() => { summary.textContent = 'illisible'; });
    }
  }

  function diffList(t, from, to) {
    const d = M.diff(t, from, to);
    if (!d.length) return h('p', { class: 'muted' }, 'Aucune différence.');
    return h('table', { class: 'difftable' }, h('thead', null, h('tr', null, h('th', null, 'Entrée'), h('th', null, 'Champ'), h('th', null, 'Actuel'), h('th', null, 'Cette version'))),
      h('tbody', null, d.map((x) => h('tr', null, h('td', null, x.name || x.id), h('td', null, x.col ? x.col.label : ''), h('td', null, M.fmt(x.before)), h('td', null, M.fmt(x.after))))));
  }

  async function preview(item) {
    if (!item.data) item.data = (await api('GET', `/api/balance/history/${encodeURIComponent(item.file)}`)).data;
    const ok = await modal({
      title: `${M.state.spec[item.table].label} — version remplacée le ${new Date(item.replacedAt).toLocaleString('fr-FR')}`,
      body: diffList(item.table, M.state.saved[item.table].data, item.data),
      buttons: [{ label: 'Fermer', value: false }, { label: 'Restaurer cette version', value: true, primary: true }],
      wide: true,
    });
    if (ok) restore(item);
  }

  async function restore(item) {
    const t = item.table;
    const unsaved = M.changes(t).length;
    const msg = `Restaurer la table « ${M.state.spec[t].label} » telle qu'elle était avant le ${new Date(item.replacedAt).toLocaleString('fr-FR')} ?${unsaved ? ` Vos ${unsaved} modification(s) non enregistrée(s) de cette table seront perdues.` : ''} La version actuelle sera archivée.`;
    if (!(await confirmModal('Restaurer une version', msg, { okLabel: 'Restaurer', danger: !!unsaved }))) return;
    try {
      const r = await api('POST', `/api/balance/history/${encodeURIComponent(item.file)}/restore`, { baseVersion: M.state.saved[t].version });
      toast(r.unchanged ? 'Version identique : rien à restaurer.' : 'Version restaurée : elle s\'applique aux nouvelles parties.', 'ok');
      await onRestored(t);
      load();
    } catch (e) {
      if (e.status === 409) toast('La table a été modifiée entre-temps : rechargez la page.', 'error');
      else toast(`Échec : ${e.message}${e.details && e.details[0] ? ` (${e.details[0].message})` : ''}`, 'error');
    }
  }

  filter.addEventListener('change', load);
  return { load };
}
