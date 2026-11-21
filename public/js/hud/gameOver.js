// End-of-battle screen, style D: a full-screen manga-ink finale that replaces the legacy #overlay-gameover while the HUD is active.
// It wraps showRecap (game.js), which still fills the legacy overlay, and reuses its buttons' functions.
import { generalPortrait, unitPortrait, unitKanji } from '../portraits.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REASONS = { elimination: 'Général ennemi vaincu', points: 'Points de victoire atteints', max_turns: 'Limite de tours atteinte' };
const GENERAL_NAMES = {
  ou_ki: 'Ou Ki', mou_bu: 'Mou Bu', ou_sen: 'Ou Sen', kan_ki: 'Kan Ki', ri_boku: 'Ri Boku', kei_sha: 'Kei Sha',
  shi_ba_shou: 'Shi Ba Shou', ren_pa: 'Ren Pa', go_kei: 'Go Kei', go_hou_mei: 'Go Hou Mei', gai_mou: 'Gai Mou',
};
const STATS = [
  ['damageDealt', 'dégâts infligés'], ['damageTaken', 'dégâts subis'], ['kills', 'victimes'], ['losses', 'pertes'],
  ['captures', 'captures'], ['points', 'points'],
];
const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function ensureStyle() {
  if (document.getElementById('gf-style')) return;
  const l = document.createElement('link');
  l.id = 'gf-style';
  l.rel = 'stylesheet';
  l.href = '/css/gameover.css';
  document.head.appendChild(l);
}

export function createGameOver({ bridge }) {
  ensureStyle();
  const root = document.createElement('div');
  root.id = 'hud-gameover';
  root.className = 'overlay gf-root';
  root.style.display = 'none';
  document.body.appendChild(root);
  const reopen = document.createElement('button');
  reopen.id = 'hud-gameover-reopen';
  reopen.type = 'button';
  reopen.hidden = true;
  reopen.innerHTML = '<span class="hud-brush">終</span> Bilan de la bataille';
  document.body.appendChild(reopen);
  let last = null;
  let counterRaf = 0;
  const showBox = (on, replay = false) => {
    root.style.display = on ? 'block' : 'none';
    reopen.hidden = on || !last;
    document.body.classList.toggle('hud-gameover-on', on);
    if (on) {
      const gf = root.firstElementChild;
      if (gf && replay) { gf.classList.remove('gf-play'); void gf.offsetWidth; gf.classList.add('gf-play'); }
      startCounters(replay ? 1150 : 1150);
    }
  };
  reopen.addEventListener('click', () => showBox(true, false));

  const panel = (p, cls, extra = '') => {
    const pic = generalPortrait(p.generalId);
    const gname = GENERAL_NAMES[p.generalId] || '';
    return `<figure class="gf-panel ${cls}" style="--pc:${esc(p.color || '#888')}">
      ${pic ? `<img src="${esc(pic)}" alt="${esc(gname)}">` : '<span class="gf-nopic hud-brush">将</span>'}
      <figcaption><b class="hud-dela">${esc(gname || p.name)}</b><span>${esc(p.name)}</span></figcaption>${extra}</figure>`;
  };

  function render(data) {
    const recap = data.recap || null;
    const st = bridge.state || {};
    const winnerId = data.winnerId ?? recap?.winnerId ?? null;
    const me = bridge.myId;
    const players = recap ? recap.players : (st.players || []);
    const flagOf = (id) => (st.players || []).find((p) => p.id === id)?.flag || null;
    const team = !!st.teamMode && winnerId && flagOf(winnerId);
    const winners = !winnerId ? [] : players.filter((p) => p.id === winnerId || (team && flagOf(p.id) === flagOf(winnerId)));
    const isWinner = (id) => winners.some((w) => w.id === id);
    const amPlayer = players.some((p) => p.id === me);
    const outcome = !winnerId ? 'draw' : !amPlayer ? 'watch' : isWinner(me) ? 'win' : 'loss';
    const KJ = { win: '勝', loss: '敗', draw: '和', watch: '終' }[outcome];
    const title = { win: 'VICTOIRE', loss: 'DÉFAITE', draw: 'MATCH NUL', watch: 'FIN DE LA BATAILLE' }[outcome];
    const winner = players.find((p) => p.id === winnerId);
    const wGen = winner ? (GENERAL_NAMES[winner.generalId] || winner.name) : null;
    const line = !winner ? 'Les deux armées quittent le champ de bataille sans vainqueur.'
      : team && winners.length > 1 ? `${esc(winners.map((w) => GENERAL_NAMES[w.generalId] || w.name).join(' et '))} remportent la bataille`
        : `${esc(wGen)} remporte la bataille`;
    const meta = [st.mapName, recap ? REASONS[recap.endReason] : data.reason && REASONS[data.reason], recap ? `${recap.turns} tours` : '']
      .filter(Boolean).map(esc).join('<i></i>');

    const ordered = players.slice().sort((a, b) => isWinner(b.id) - isWinner(a.id) || (b.points || 0) - (a.points || 0));
    const losers = ordered.filter((p) => !isWinner(p.id));
    let hero;
    if (outcome === 'draw') hero = `<div class="gf-duo">${ordered.slice(0, 2).map((p, i) => panel(p, `gf-even gf-even-${i}`)).join('')}</div>`;
    else hero = `${winners.slice(0, 2).map((p, i) => panel(p, `gf-main${i ? ' gf-main2' : ''}`)).join('')}
      <div class="gf-losers">${losers.slice(0, 3).map((p, i) => panel(p, `gf-torn gf-torn-${i}`, '<span class="gf-x" aria-hidden="true"></span>')).join('')}</div>`;

    const cards = ordered.map((p, i) => `<article class="gf-card${isWinner(p.id) ? ' win' : ''}${p.isEliminated ? ' out' : ''}" style="--pc:${esc(p.color || '#888')};--d:${1150 + i * 140}ms">
        <header><i class="gf-dot"></i><span class="hud-dela">${esc(p.name)}</span>${p.id === me ? '<em>vous</em>' : ''}${isWinner(p.id) ? '<b class="hud-brush">勝</b>' : ''}
          <small>${esc(GENERAL_NAMES[p.generalId] || '')}</small></header>
        <div class="gf-stats">${STATS.map(([k, label]) => `<span><b class="hud-dela" data-to="${Number(p[k]) || 0}">0</b>${label}</span>`).join('')}
          <span><b class="hud-dela"><span data-to="${p.unitsAlive ?? 0}">0</span>/${p.unitsTotal ?? 0}</b>unités debout</span></div>
      </article>`).join('');

    let mvp = '';
    if (recap && recap.units && recap.units.length) {
      const best = recap.units.slice().sort((a, b) => (b.damageDealt + 120 * b.kills) - (a.damageDealt + 120 * a.kills))[0];
      if (best && (best.damageDealt > 0 || best.kills > 0)) {
        const owner = players.find((p) => p.id === best.playerId);
        const pic = best.isGeneral ? generalPortrait(owner?.generalId) : unitPortrait(best.typeId);
        mvp = `<div class="gf-mvp" style="--pc:${esc(owner?.color || '#888')}">
          <div class="gf-mvp-pic">${pic ? `<img src="${esc(pic)}" alt="">` : `<span class="hud-brush">${unitKanji(best)}</span>`}</div>
          <div><span class="gf-mvp-tag">HÉROS DE LA BATAILLE</span><b class="hud-dela">${esc(best.name)}</b>
            <small>${esc(owner?.name || '')} · <span data-to="${best.damageDealt}">0</span> dégâts · <span data-to="${best.kills}">0</span> victime${best.kills > 1 ? 's' : ''}${best.alive ? '' : ' · tombé au combat'}</small></div></div>`;
      }
    }

    const units = recap ? recap.units.slice().sort((a, b) => b.damageDealt - a.damageDealt).map((u) => {
      const pl = players.find((p) => p.id === u.playerId);
      const state = u.alive ? 'debout' : u.fled ? 'en fuite' : 'détruite';
      return `<tr class="${u.alive ? '' : 'dead'}"><td><i style="background:${esc(pl?.color || '#888')}"></i>${u.isGeneral ? '将 ' : ''}${esc(u.name)}</td><td>${u.damageDealt}</td><td>${u.damageTaken}</td><td>${u.kills}</td><td>${state}</td></tr>`;
    }).join('') : '';
    const replay = recap && recap.replayAvailable;

    root.innerHTML = `<div class="gf gf-${outcome}${reduced() ? '' : ' gf-play'}" style="--wc:${esc(winner?.color || '#888')}">
      <div class="gf-bg"></div>
      <div class="gf-speed"></div>
      <svg class="gf-ink" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs><filter id="gf-rough" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" result="n"></feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="46"></feDisplacementMap></filter></defs>
        <g filter="url(#gf-rough)">
          <circle class="gf-blot b1" cx="250" cy="330" r="210"></circle>
          <circle class="gf-blot b2" cx="430" cy="210" r="70"></circle>
          <circle class="gf-blot b3" cx="120" cy="560" r="55"></circle>
          <circle class="gf-blot b4" cx="470" cy="520" r="34"></circle>
          <circle class="gf-blot b5" cx="60" cy="150" r="26"></circle>
          <path class="gf-blot b6" d="M40 640 C 260 560, 520 610, 980 520 L 990 560 C 600 660, 300 640, 30 690 Z"></path>
        </g>
      </svg>
      <div class="gf-stage">
        <section class="gf-hero">${hero}<div class="gf-kanji hud-brush" aria-hidden="true"><span class="gf-k-shadow">${KJ}</span><span class="gf-k-ink">${KJ}</span></div></section>
        <section class="gf-side">
          <h2 class="gf-title hud-dela">${title}</h2>
          <p class="gf-line">${line}</p>
          ${meta ? `<p class="gf-meta">${meta}</p>` : ''}
          <div class="gf-cards">${cards}</div>
          ${mvp}
          ${units ? `<details class="gf-units"><summary>Détail par unité</summary><table><tr><th>Unité</th><th>Infligés</th><th>Subis</th><th>Victimes</th><th>État</th></tr>${units}</table></details>` : ''}
          <nav class="gf-actions">
            ${replay ? '<button type="button" data-go="view">Voir le replay</button><button type="button" data-go="download">Télécharger le replay</button>' : ''}
            <button type="button" data-go="map">Voir la carte</button>
            <button type="button" class="gf-menu" data-go="menu"><span class="hud-brush">歸</span>Retour au menu</button>
          </nav>
        </section>
      </div></div>`;
  }

  function startCounters(delay) {
    cancelAnimationFrame(counterRaf);
    const els = [...root.querySelectorAll('[data-to]')];
    if (reduced()) { els.forEach((e) => { e.textContent = e.dataset.to; }); return; }
    els.forEach((e) => { e.textContent = '0'; });
    const t0 = performance.now() + delay;
    const dur = 1300;
    const step = (now) => {
      const k = Math.min(1, Math.max(0, (now - t0) / dur));
      const ease = 1 - Math.pow(1 - k, 3);
      for (const e of els) e.textContent = String(Math.round(Number(e.dataset.to) * ease));
      if (k < 1) counterRaf = requestAnimationFrame(step);
    };
    counterRaf = requestAnimationFrame(step);
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    const a = b.dataset.go;
    if (a === 'view' || a === 'download') window.requestReplay && window.requestReplay(a);
    else if (a === 'map') showBox(false);
    else if (a === 'menu') window.leaveGame && window.leaveGame();
  });

  const orig = window.showRecap;
  if (typeof orig === 'function') {
    window.showRecap = function (data) {
      const r = orig.apply(this, arguments);
      last = data;
      if (document.body.classList.contains('hud-d')) {
        render(data);
        const legacy = document.getElementById('overlay-gameover');
        if (legacy) legacy.style.display = 'none';
        showBox(true);
      }
      return r;
    };
  }

  return {
    hide() { root.style.display = 'none'; reopen.hidden = true; document.body.classList.remove('hud-gameover-on'); },
    get last() { return last; },
  };
}
