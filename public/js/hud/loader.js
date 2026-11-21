import { generalPortrait } from '../portraits.js';

// Full-screen loading screen of game.html (markup + critical CSS are inline in the page so nothing else shows first).
// Covers the page until the connection, the map, the armies, the HUD and (3D view) the 3D world are ready,
// and again during a long reconnection. Shows the generals' own quotes (data/balance/generals.json).
const root = document.getElementById('kb-loader');
if (root) start();

function start() {
  const $ = (s) => root.querySelector(s);
  const want3d = localStorage.getItem('kb_view3d') === '1';
  const steps = [
    { id: 'conn', label: 'Connexion', done: () => netStatus() === 'connected' },
    { id: 'map', label: 'Carte', done: () => !!(window.gameBridge && window.gameBridge.mapDoc) || mapFallback() },
    { id: 'army', label: 'Armées', done: () => !!(window.gameBridge && (window.gameBridge.state || window.gameBridge.deployState)) },
    { id: 'hud', label: 'Interface', done: () => document.body.classList.contains('hud-d') },
  ];
  if (want3d) steps.push({ id: 'world', label: 'Monde 3D', done: () => !!(window.view3d && window.view3d.active) });

  // KBNet is a top-level const of net.js (classic script): reachable by name, not as window.KBNet
  const netStatus = () => (typeof KBNet !== 'undefined' && KBNet ? KBNet.status : 'idle');
  const t0 = performance.now();
  let armyAt = 0;
  function mapFallback() {
    if (!armyAt) return false;
    return performance.now() - armyAt > 8000;
  }

  const list = $('.kbl-steps');
  list.innerHTML = steps.map((s) => `<li data-s="${s.id}"><i></i><span>${s.label}</span></li>`).join('');
  const bar = $('.kbl-bar i');
  const msg = $('.kbl-msg');
  const actions = $('.kbl-actions');
  actions.querySelector('[data-a=reload]').addEventListener('click', () => location.reload());

  // ---- quotes ----
  let quotes = [];
  let qi = 0;
  let quoteTimer = null;
  const fig = $('.kbl-quote');
  function showQuote() {
    if (!quotes.length) return;
    const q = quotes[qi++ % quotes.length];
    fig.classList.remove('in');
    setTimeout(() => {
      const img = fig.querySelector('img');
      const src = generalPortrait(q.id);
      fig.querySelector('.kbl-portrait').classList.toggle('noimg', !src);
      if (src) img.src = src; else img.removeAttribute('src');
      fig.querySelector('blockquote').textContent = q.citation.replace(/^\s*[«"]\s*|\s*[»"]\s*$/g, '');
      fig.querySelector('figcaption').textContent = q.name;
      fig.hidden = false;
      requestAnimationFrame(() => fig.classList.add('in'));
    }, fig.hidden ? 0 : 380);
  }
  fetch('/api/balance/generals').then((r) => (r.ok ? r.json() : null)).then((d) => {
    const rows = Array.isArray(d) ? d : (d && (d.rows || d.data || d.table)) || [];
    quotes = rows.filter((g) => g && g.citation && g.name).map((g) => ({ id: g.id, name: g.name, citation: String(g.citation) }));
    for (let i = quotes.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [quotes[i], quotes[j]] = [quotes[j], quotes[i]]; }
    showQuote();
    quoteTimer = setInterval(showQuote, 7000);
  }).catch(() => {});

  // ---- progress ----
  let mode = 'load';
  let hidden = false;
  let downSince = 0;
  let statesSeen = 0;
  let statesAtDrop = 0;
  (window.gameEventHooks = window.gameEventHooks || []).push((event) => {
    if (event === 'game_state' || event === 'deploy_state' || event === 'deployment_state') statesSeen++;
  });

  function setTitle(t) { $('.kbl-phase').textContent = t; }

  function show(reconnect) {
    mode = reconnect ? 'reconnect' : 'load';
    hidden = false;
    root.classList.toggle('reconnect', !!reconnect);
    root.style.display = '';
    requestAnimationFrame(() => root.classList.remove('out'));
    setTitle(reconnect ? 'Reconnexion…' : 'Préparation de la bataille…');
    if (!quoteTimer && quotes.length) { showQuote(); quoteTimer = setInterval(showQuote, 7000); }
  }

  function hide() {
    if (hidden) return;
    hidden = true;
    root.classList.add('out');
    clearInterval(quoteTimer);
    quoteTimer = null;
    setTimeout(() => { if (hidden) root.style.display = 'none'; }, 520);
  }

  function tick() {
    const now = performance.now();
    const status = netStatus();
    if (!armyAt && steps[2].done()) armyAt = now;
    if (mode === 'load') {
      let n = 0;
      for (const s of steps) {
        const ok = s.done();
        if (ok) n++;
        list.querySelector(`[data-s=${s.id}]`).classList.toggle('ok', ok);
      }
      bar.style.width = `${Math.round((n / steps.length) * 100)}%`;
      const ready = n === steps.length;
      if (ready && !hidden) setTimeout(hide, now - t0 < 400 ? 0 : 250);
      if (!ready && now - t0 > 25000) {
        msg.textContent = status === 'connected' ? 'Le chargement prend plus de temps que prévu…' : 'Impossible de joindre le serveur pour l\'instant.';
        actions.hidden = false;
      }
      if (ready) mode = 'idle';
      return;
    }
    if (mode === 'idle') {
      if (status === 'reconnecting' || status === 'connecting') {
        if (!downSince) { downSince = now; statesAtDrop = statesSeen; }
        if (now - downSince > 2500) {
          show(true);
          list.querySelectorAll('li').forEach((li) => li.classList.remove('ok'));
          bar.style.width = '0%';
        }
      } else downSince = 0;
      return;
    }
    if (mode === 'reconnect') {
      const conn = status === 'connected';
      const fresh = statesSeen > statesAtDrop;
      list.querySelector('[data-s=conn]').classList.toggle('ok', conn);
      list.querySelector('[data-s=army]').classList.toggle('ok', fresh);
      for (const id of ['map', 'hud', 'world']) { const li = list.querySelector(`[data-s=${id}]`); if (li) li.classList.add('ok'); }
      bar.style.width = `${(conn ? 50 : 10) + (fresh ? 50 : 0)}%`;
      if (now - downSince > 30000) { msg.textContent = 'La connexion ne revient pas.'; actions.hidden = false; }
      if (conn && fresh) { downSince = 0; msg.textContent = ''; actions.hidden = true; mode = 'idle'; hide(); }
    }
  }
  setInterval(tick, 150);
  tick();
}
