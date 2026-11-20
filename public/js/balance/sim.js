// Balance simulation runner (separate server process) and report viewer: win rates with 95% CI,
// matchup matrix, unit efficiency and comparison with a previous report
import { api, toast } from '/js/editor/ui.js';
import { h, field } from '/js/editor/dom.js';
import * as M from './model.js';

const NEUTRAL = [0x38, 0x38, 0x35];
const POS = [0x39, 0x87, 0xe5];
const NEG = [0xe6, 0x67, 0x67];

const pct = (v, d = 1) => (v == null ? '—' : `${v.toFixed(d).replace('.', ',')} %`);
const signed = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d).replace('.', ',')}`);

function divergingColor(v, span) {
  const x = Math.max(-1, Math.min(1, v / span));
  const pole = x >= 0 ? POS : NEG;
  const a = Math.abs(x);
  const c = NEUTRAL.map((n, i) => Math.round(n + (pole[i] - n) * a));
  return `rgb(${c.join(',')})`;
}

let tip;
function tooltip(el, fn) {
  el.addEventListener('mousemove', (e) => {
    if (!tip) { tip = h('div', { class: 'tip' }); document.body.append(tip); }
    tip.replaceChildren(...[].concat(fn()).filter(Boolean));
    tip.style.display = 'block';
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - r.width - 8, e.clientX + 14)}px`;
    tip.style.top = `${Math.min(window.innerHeight - r.height - 8, e.clientY + 14)}px`;
  });
  el.addEventListener('mouseleave', () => { if (tip) tip.style.display = 'none'; });
}

function paramsLabel(p) {
  if (!p) return 'paramètres inconnus (ancien rapport)';
  return `${p.gamesPerMatchup} parties/affrontement, budget ${p.budget}, initiative ${p.initiative ? 'oui' : 'non'}`;
}

function reportLabel(r) {
  const d = r.timestamp ? new Date(r.timestamp).toLocaleString('fr-FR') : r.file;
  const dir = r.dir === 'results' ? '' : `[${r.dir}] `;
  return `${dir}${d} — ${r.params ? `${r.params.gamesPerMatchup}/affr., budget ${r.params.budget}, init. ${r.params.initiative ? 'oui' : 'non'}` : 'paramètres inconnus'} — ${r.totalGames} parties`;
}

export function mountSim(root, { hasUnsaved }) {
  let limits = { gamesPerMatchup: [1, 500], budget: [500, 50000], threads: [1, 4] };
  let reports = [];
  let pollTimer = null;
  let lastRunId = null;
  const cache = new Map();

  const games = h('input', { type: 'number', min: 1, max: 500, value: 10 });
  const budget = h('input', { type: 'number', min: 500, max: 50000, step: 500, value: 5000 });
  const threads = h('input', { type: 'number', min: 1, value: 4 });
  const initiative = h('input', { type: 'checkbox', checked: true });
  const estimate = h('span', { class: 'muted' });
  const startBtn = h('button', { type: 'button', class: 'primary' }, 'Lancer la simulation');
  const cancelBtn = h('button', { type: 'button', class: 'danger', hidden: true }, 'Annuler');
  const bar = h('div', { class: 'progress' }, h('i'));
  const status = h('div', { class: 'muted' });
  const unsavedWarn = h('p', { class: 'warn', hidden: true }, 'Des modifications ne sont pas enregistrées : la simulation utilise les données enregistrées sur le serveur.');
  const log = h('pre', { class: 'log' });
  const reportSel = h('select');
  const baseSel = h('select');
  const out = h('div', { class: 'report' });

  root.append(
    h('div', { class: 'card' },
      h('h2', null, 'Lancer une simulation'),
      h('p', { class: 'muted' }, 'IA contre IA sur tous les affrontements de généraux (joueur 1 × joueur 2), dans un processus séparé à priorité réduite : le serveur de jeu n\'est pas bloqué. Une seule simulation à la fois.'),
      h('div', { class: 'row simform' },
        field('Parties par affrontement', games),
        field('Budget (or)', budget),
        field('Threads', threads),
        h('label', { class: 'chk' }, initiative, 'Initiative (d20 + stratégie)'),
        startBtn, cancelBtn),
      estimate, unsavedWarn,
      h('div', { class: 'runstatus' }, bar, status),
      h('details', null, h('summary', { class: 'muted' }, 'Journal'), log)),
    h('div', { class: 'card' },
      h('div', { class: 'row', style: { justifyContent: 'space-between' } },
        h('h2', { style: { margin: 0 } }, 'Rapport'),
        h('div', { class: 'row' }, field('Rapport', reportSel), field('Comparer avec', baseSel))),
      out));

  const updateEstimate = () => {
    const n = Number(games.value) || 0;
    const gen = M.state.saved.generals ? M.state.saved.generals.data.length : 11;
    const total = gen * gen * n;
    const secs = Math.ceil(total / (20 * Math.max(1, Number(threads.value) || 1)) * (Number(budget.value) / 2500));
    estimate.textContent = `${total} parties — durée estimée ≈ ${secs < 90 ? `${secs} s` : `${Math.round(secs / 60)} min`} (ordre de grandeur).`;
    unsavedWarn.hidden = !hasUnsaved();
  };
  [games, budget, threads].forEach((el) => el.addEventListener('input', updateEstimate));

  function showRun(run) {
    const running = run && run.status === 'running';
    startBtn.disabled = running;
    cancelBtn.hidden = !running;
    if (!run) { status.textContent = 'Aucune simulation lancée depuis le démarrage du serveur.'; bar.firstChild.style.width = '0'; return; }
    const p = run.total ? Math.round((run.done / run.total) * 100) : 0;
    bar.firstChild.style.width = `${p}%`;
    bar.classList.toggle('done', run.status === 'done');
    bar.classList.toggle('failed', run.status === 'error' || run.status === 'cancelled');
    const elapsed = ((run.endedAt ? new Date(run.endedAt) : new Date()) - new Date(run.startedAt)) / 1000;
    const eta = running && run.done > 0 ? Math.round(elapsed * (run.total - run.done) / run.done) : null;
    const label = { running: 'En cours', done: 'Terminée', error: 'Échec', cancelled: 'Annulée' }[run.status];
    status.textContent = `${label} — ${run.done}/${run.total} parties (${p} %) — ${Math.round(elapsed)} s${eta != null ? `, reste ≈ ${eta} s` : ''} — ${paramsLabel(run.params)}${run.error ? ` — ${run.error}` : ''}`;
    log.textContent = run.log.join('\n');
  }

  async function poll() {
    let res;
    try { res = await api('GET', '/api/balance/sim'); } catch (e) { status.textContent = e.message; return; }
    limits = res.limits;
    threads.max = limits.threads[1];
    showRun(res.run);
    const running = res.run && res.run.status === 'running';
    clearTimeout(pollTimer);
    if (running) pollTimer = setTimeout(poll, 1000);
    if (res.run && res.run.status === 'done' && lastRunId === res.run.id && res.run.report) {
      lastRunId = null;
      toast('Simulation terminée.', 'ok');
      await loadReports(res.run.report);
    }
  }

  startBtn.addEventListener('click', async () => {
    try {
      const body = { gamesPerMatchup: Number(games.value), budget: Number(budget.value), threads: Math.min(Number(threads.value), limits.threads[1]), initiative: initiative.checked };
      const { run } = await api('POST', '/api/balance/sim', body);
      lastRunId = run.id;
      showRun(run);
      pollTimer = setTimeout(poll, 500);
    } catch (e) { toast(e.message, 'error'); }
  });
  cancelBtn.addEventListener('click', async () => {
    try { showRun((await api('POST', '/api/balance/sim/cancel')).run); } catch (e) { toast(e.message, 'error'); }
  });

  async function getReport(file) {
    if (!cache.has(file)) cache.set(file, await api('GET', `/api/balance/reports/${file.split('/').map(encodeURIComponent).join('/')}`));
    return cache.get(file);
  }

  function defaultBaseline(file) {
    const i = reports.findIndex((r) => r.file === file);
    if (i < 0) return '';
    const cur = reports[i];
    const older = reports.slice(i + 1);
    const sameParams = older.find((r) => r.params && cur.params && r.params.budget === cur.params.budget && r.params.initiative === cur.params.initiative);
    return (sameParams || older[0] || { file: '' }).file;
  }

  async function loadReports(select) {
    try { reports = await api('GET', '/api/balance/reports'); } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); return; }
    reportSel.replaceChildren(...reports.map((r) => h('option', { value: r.file }, reportLabel(r))));
    baseSel.replaceChildren(h('option', { value: '' }, '— aucune —'), ...reports.map((r) => h('option', { value: r.file }, reportLabel(r))));
    if (!reports.length) { out.replaceChildren(h('p', { class: 'muted' }, 'Aucun rapport : lancez une simulation.')); return; }
    reportSel.value = select && reports.some((r) => r.file === select) ? select : reports[0].file;
    baseSel.value = defaultBaseline(reportSel.value);
    render();
  }
  reportSel.addEventListener('change', () => { baseSel.value = defaultBaseline(reportSel.value); render(); });
  baseSel.addEventListener('change', render);

  async function render() {
    out.replaceChildren(h('p', { class: 'muted' }, 'Chargement…'));
    try {
      const rep = await getReport(reportSel.value);
      const base = baseSel.value && baseSel.value !== reportSel.value ? await getReport(baseSel.value) : null;
      out.replaceChildren(...renderReport(rep, base));
    } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
  }

  updateEstimate();
  poll();
  loadReports();
  return { refresh: updateEstimate };
}

function nameOf(rep, id) {
  return (rep.generalReport[id] && rep.generalReport[id].name) || id;
}

function renderReport(rep, base) {
  const parts = [];
  parts.push(h('p', { class: 'muted' },
    `${new Date(rep.timestamp).toLocaleString('fr-FR')} — ${rep.totalGames} parties${rep.errors ? `, ${rep.errors} en erreur` : ''} — ${paramsLabel(rep.params)}${rep.balance ? ` — données ${rep.balance.version}` : ''}`,
    base ? h('br') : null,
    base ? `Comparaison : ${new Date(base.timestamp).toLocaleString('fr-FR')} — ${base.totalGames} parties — ${paramsLabel(base.params)}` : null));
  if (base && rep.params && base.params && (rep.params.budget !== base.params.budget || rep.params.initiative !== base.params.initiative)) {
    parts.push(h('p', { class: 'warn' }, 'Les deux rapports n\'ont pas le même budget ou la même initiative : les écarts ne viennent pas seulement des données.'));
  }
  if (base) parts.push(renderDataChanges(rep, base));
  parts.push(renderGenerals(rep, base));
  parts.push(renderMatrix(rep, base));
  parts.push(renderUnits(rep, base));
  return parts;
}

function renderDataChanges(rep, base) {
  const box = h('div', { class: 'datachanges' }, h('h3', null, 'Données modifiées entre les deux rapports'));
  if (!rep.balance || !base.balance) {
    box.append(h('p', { class: 'muted' }, 'Indisponible : au moins un des rapports ne contient pas d\'instantané des données (rapports antérieurs à l\'éditeur).'));
    return box;
  }
  const list = h('ul');
  for (const t of M.state.order) {
    if (!rep.balance.tables[t] || !base.balance.tables[t]) continue;
    for (const d of M.diff(t, base.balance.tables[t], rep.balance.tables[t])) {
      list.append(h('li', null, h('b', null, `${M.state.spec[t].label} › ${d.name || d.id}`), d.col ? ` › ${d.col.label} : ` : ' : ', M.fmt(d.before), ' → ', M.fmt(d.after)));
    }
  }
  box.append(list.children.length ? list : h('p', { class: 'muted' }, 'Aucune : mêmes données d\'équilibrage.'));
  return box;
}

function renderGenerals(rep, base) {
  const rows = Object.entries(rep.generalReport).sort((a, b) => b[1].winRate - a[1].winRate);
  const box = h('div', null, h('h3', null, 'Taux de victoire par général (intervalle de confiance à 95 %)'),
    h('p', { class: 'muted' }, 'Victoires / parties jouées (comme joueur 1 ou 2). La barre fine indique l\'intervalle de confiance ; la ligne pointillée marque 50 %. Un écart est marqué ★ quand il dépasse l\'incertitude combinée des deux rapports.'));
  const table = h('table', { class: 'gen' }, h('thead', null, h('tr', null, h('th', null, 'Général'), h('th', { class: 'barcol' }, 'Taux de victoire'), h('th', null, 'Taux'), h('th', null, 'V / D / N'), h('th', null, 'Tours moy.'), base ? h('th', null, 'Écart') : null)));
  const tb = h('tbody');
  for (const [id, r] of rows) {
    const b = base && base.generalReport[id];
    const delta = b ? r.winRate - b.winRate : null;
    const sig = b ? Math.abs(delta) > Math.sqrt(r.ci95 ** 2 + b.ci95 ** 2) : false;
    const lo = Math.max(0, r.winRate - r.ci95);
    const hi = Math.min(100, r.winRate + r.ci95);
    const track = h('div', { class: 'track' },
      h('div', { class: 'fill', style: { width: `${r.winRate}%` } }),
      h('div', { class: 'ci', style: { left: `${lo}%`, width: `${hi - lo}%` } }),
      b ? h('div', { class: 'prev', style: { left: `${b.winRate}%` } }) : null,
      h('div', { class: 'mid' }));
    tooltip(track, () => [h('b', null, r.name), h('div', null, `${pct(r.winRate)} ±${r.ci95.toFixed(1).replace('.', ',')} (IC 95 % : ${pct(lo)} – ${pct(hi)})`), h('div', null, `${r.wins} V / ${r.losses} D / ${r.draws} N sur ${r.totalGames} parties`), b ? h('div', null, `Comparaison : ${pct(b.winRate)} ±${b.ci95.toFixed(1).replace('.', ',')} (repère vertical)`) : null]);
    tb.append(h('tr', { class: r.winRate > 60 ? 'strong' : r.winRate < 40 ? 'weak' : '' },
      h('td', null, r.name),
      h('td', { class: 'barcol' }, track),
      h('td', { class: 'num' }, `${pct(r.winRate)} ±${r.ci95.toFixed(1).replace('.', ',')}`),
      h('td', { class: 'num' }, `${r.wins} / ${r.losses} / ${r.draws}`),
      h('td', { class: 'num' }, String(r.avgTurns).replace('.', ',')),
      base ? h('td', { class: 'num' + (sig ? ' sig' : '') }, b ? `${signed(delta)} pt${sig ? ' ★' : ''}` : '—') : null));
  }
  table.append(tb);
  box.append(table, h('p', { class: 'muted' }, 'Lignes marquées : taux > 60 % (trop fort ?) ou < 40 % (trop faible ?).'));
  return box;
}

function renderMatrix(rep, base) {
  const ids = Object.keys(rep.matchupMatrix.winRates);
  let mode = 'rate';
  const box = h('div', null, h('h3', null, 'Matrice des affrontements'));
  const modeRow = h('div', { class: 'row' });
  const legend = h('div', { class: 'legend' });
  const holder = h('div', { class: 'scroll' });
  const btns = [['rate', 'Taux de victoire du joueur 1'], ['delta', 'Écart avec la comparaison']].map(([m, label]) => {
    const b = h('button', { type: 'button', class: 'small' + (m === mode ? ' on' : ''), disabled: m === 'delta' && !base }, label);
    b.addEventListener('click', () => { mode = m; btns.forEach((x) => x.classList.toggle('on', x === b)); draw(); });
    return b;
  });
  modeRow.append(...btns);
  box.append(h('p', { class: 'muted' }, 'Ligne = général du joueur 1, colonne = général du joueur 2, valeur = taux de victoire du joueur 1 (nul = ½). Survolez une case pour l\'intervalle de confiance.'), modeRow, legend, holder);

  function draw() {
    const { winRates, ci95, counts } = rep.matchupMatrix;
    const bm = base && base.matchupMatrix;
    const span = mode === 'rate' ? 50 : 30;
    legend.replaceChildren(
      h('span', null, mode === 'rate' ? '0 %' : '−30 pt'),
      h('i', { style: { background: `linear-gradient(90deg, ${divergingColor(-span, span)}, ${divergingColor(0, span)}, ${divergingColor(span, span)})` } }),
      h('span', null, mode === 'rate' ? '100 %' : '+30 pt'),
      h('span', { class: 'muted' }, mode === 'rate' ? ' — gris = 50 % (équilibré), bleu = le joueur 1 gagne, rouge = il perd' : ' — bleu = meilleur que la comparaison, rouge = moins bon'));
    const table = h('table', { class: 'matrix' });
    table.append(h('thead', null, h('tr', null, h('th', { class: 'corner' }, 'J1 \\ J2'), ids.map((id) => h('th', { class: 'colh' }, h('span', null, nameOf(rep, id)))))));
    const tb = h('tbody');
    for (const a of ids) {
      const tr = h('tr', null, h('th', null, nameOf(rep, a)));
      for (const b of ids) {
        const v = winRates[a][b];
        const bv = bm && bm.winRates[a] ? bm.winRates[a][b] : null;
        const shown = mode === 'rate' ? v : (v != null && bv != null ? v - bv : null);
        const td = h('td', { style: { background: shown == null ? 'transparent' : divergingColor(mode === 'rate' ? shown - 50 : shown, span) } }, shown == null ? '—' : (mode === 'rate' ? Math.round(shown) : signed(shown, 0)));
        tooltip(td, () => [
          h('b', null, `${nameOf(rep, a)} (J1) contre ${nameOf(rep, b)} (J2)`),
          h('div', null, v == null ? 'Aucune partie' : `${pct(v)} ±${ci95[a][b].toFixed(1).replace('.', ',')} (n = ${counts[a][b]})`),
          bv != null ? h('div', null, `Comparaison : ${pct(bv)} ±${bm.ci95[a][b].toFixed(1).replace('.', ',')} (n = ${bm.counts[a][b]}) — écart ${signed(v - bv)} pt`) : null,
        ]);
        tr.append(td);
      }
      tb.append(tr);
    }
    table.append(tb);
    holder.replaceChildren(table);
  }
  draw();
  return box;
}

function renderUnits(rep, base) {
  const eff = rep.unitEfficiency;
  const comp = rep.armyComposition || { avgWinner: {}, avgLoser: {} };
  const ids = Object.keys(eff).filter((id) => id !== 'general');
  ids.sort((a, b) => eff[b].survivalRate - eff[a].survivalRate);
  const box = h('div', null, h('h3', null, 'Unités : utilisation et efficacité'),
    h('p', { class: 'muted' }, 'Survie = part des unités encore en vie en fin de partie (IC 95 %). Utilisation = nombre moyen par armée gagnante / perdante ; un ratio > 1 signifie que l\'unité est plus présente chez les vainqueurs. L\'IA compose ses armées au hasard par catégorie : l\'utilisation reflète surtout le coût.'));
  const table = h('table', { class: 'units' }, h('thead', null, h('tr', null,
    h('th', null, 'Unité'), h('th', null, 'Coût'), h('th', null, 'Déployées'), h('th', { class: 'barcol' }, 'Survie'), h('th', null, 'Survie'), h('th', null, 'PV perdus moy.'),
    h('th', null, 'Moy. armée gagnante'), h('th', null, 'Moy. armée perdante'), h('th', null, 'Ratio'), base ? h('th', null, 'Écart survie') : null)));
  const tb = h('tbody');
  for (const id of [...ids, 'general']) {
    const s = eff[id];
    if (!s) continue;
    const b = base && base.unitEfficiency[id] && base.unitEfficiency[id].totalDeployed > 0 ? base.unitEfficiency[id] : null;
    const w = comp.avgWinner[id];
    const l = comp.avgLoser[id];
    const delta = b ? s.survivalRate - b.survivalRate : null;
    const sig = b && s.totalDeployed ? Math.abs(delta) > Math.sqrt((s.survivalCI95 || 0) ** 2 + (b.survivalCI95 || 0) ** 2) : false;
    const lo = Math.max(0, s.survivalRate - (s.survivalCI95 || 0));
    const hi = Math.min(100, s.survivalRate + (s.survivalCI95 || 0));
    const track = h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: `${s.survivalRate}%` } }), h('div', { class: 'ci', style: { left: `${lo}%`, width: `${hi - lo}%` } }), b ? h('div', { class: 'prev', style: { left: `${b.survivalRate}%` } }) : null);
    tooltip(track, () => [h('b', null, s.name), h('div', null, `Survie ${pct(s.survivalRate)} ±${(s.survivalCI95 || 0).toFixed(1).replace('.', ',')} sur ${s.totalDeployed} unités`), b ? h('div', null, `Comparaison : ${pct(b.survivalRate)} (repère vertical)`) : null]);
    tb.append(h('tr', { class: id === 'general' ? 'general' : '' },
      h('td', null, s.name),
      h('td', { class: 'num' }, s.cost ? String(s.cost) : '—'),
      h('td', { class: 'num' }, String(s.totalDeployed)),
      h('td', { class: 'barcol' }, track),
      h('td', { class: 'num' }, `${pct(s.survivalRate)} ±${(s.survivalCI95 || 0).toFixed(1).replace('.', ',')}`),
      h('td', { class: 'num' }, pct(s.avgHpLostPercent)),
      h('td', { class: 'num' }, w == null ? '—' : String(w).replace('.', ',')),
      h('td', { class: 'num' }, l == null ? '—' : String(l).replace('.', ',')),
      h('td', { class: 'num' }, w != null && l ? (w / l).toFixed(2).replace('.', ',') : '—'),
      base ? h('td', { class: 'num' + (sig ? ' sig' : '') }, b && s.totalDeployed ? `${signed(delta)} pt${sig ? ' ★' : ''}` : '—') : null));
  }
  table.append(tb);
  box.append(h('div', { class: 'scroll' }, table));
  return box;
}
