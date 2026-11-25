// Battle HUD (style D) shown over the 3D view and the 2D canvas. It is a presentation layer only: the legacy sidebar, top bar and buttons
// stay in the DOM (hidden) and keep their logic in game.js / simultaneous.js / tutorial.js; the HUD reads the bridge state
// and those elements, and forwards every click to the legacy control, so the rules live in one place.
import { createCombatSplash } from './combatSplash.js';
import { attackTipHtml } from './attackTip.js';
import { createGameOver } from './gameOver.js';
export const KANJI = { pietaille: '卒', soldats: '兵', phalange: '盾', lancier: '槍', espion: '諜', assassin: '刺', cavalier_leger: '騎', cavalier_lourd: '騎', archer: '弓', archer_elite: '弓', batisseurs: '工', char: '車' };
const CAM_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'PageUp', 'PageDown']);
const ACTIONS = [
  { id: 'btn-move', key: 'KeyR', hint: 'R', label: 'Déplacer', cls: '' },
  { id: 'btn-attack', key: 'KeyF', hint: 'F', label: 'Attaquer', cls: 'attack' },
  { id: 'btn-ability', key: 'KeyC', hint: 'C', label: 'Capacité', cls: '' },
  { id: 'btn-facing', key: 'KeyO', hint: 'O', label: 'Orienter', cls: '' },
];
const MIRRORS = [
  ['#unit-list', '.hud-roster'], ['#tool-coords', '[data-hud=tools]'], ['#selected-unit-detail', '.hud-card'],
  ['#stance-panel', '.hud-stancebar'], ['#btn-end-turn-center', '.hud-seal'], ['#btn-end-turn-global', '.hud-seal'],
  ['#btn-attack', '[data-act=btn-attack]'], ['#top-time', '.hud-banner .hud-sub'], ['#top-scores', '.hud-scores'],
];
const SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"></path></svg>';
const MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z"></path></svg>';
const ICONS = {
  rules: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"></path></svg>',
  exit: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M14 4H5v16h9"></path><path d="M10 12h10M16 8l4 4-4 4"></path></svg>',
  map: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"></path><path d="M9 4v14M15 6v14"></path></svg>',
  journal: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"></path><path d="M8 9h8M8 12h5"></path></svg>',
  tools: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>',
};

const lex = new Map();
// Script-level let/const of game.js (gameState, stanceNames, ...) are not on window; read them from the global scope.
function G(name) {
  if (!lex.has(name)) { try { lex.set(name, new Function(`return typeof ${name} !== 'undefined' ? ${name} : undefined;`)); } catch (e) { lex.set(name, () => undefined); } }
  try { return lex.get(name)(); } catch (e) { return undefined; }
}
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (s) => String(s || '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{23E9}-\u{23FA}]/gu, '').replace(/\s+/g, ' ').trim();

export function mountBattleHud(bridge, view) {
  for (const href of ['https://fonts.googleapis.com/css2?family=Dela+Gothic+One&family=Yuji+Boku&family=Zen+Kaku+Gothic+New:wght@500;700;900&family=Zen+Old+Mincho:wght@700;900&display=swap', '/css/hud.css']) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }

  const root = document.createElement('div');
  root.id = 'hud-root';
  root.innerHTML = `
    <div class="hud-banner"><span class="hud-turn hud-dela"></span><span class="hud-sub"></span></div>
    <div class="hud-callout hud-dela hud-outline"></div>
    <div class="hud-presence"></div>
    <div class="hud-topright">
      <div class="hud-scores"></div>
      <div class="hud-timer"></div>
      <div class="hud-group" role="group" aria-label="Vue">
        <button class="hud-ibtn" data-hud="2d" title="Vue 2D" aria-label="Vue 2D">2D</button>
        <button class="hud-ibtn" data-hud="map" title="Vue Stratégie, de haut (M) — ou dézoomer au maximum" aria-label="Vue Stratégie">${ICONS.map}</button>
      </div>
      <div class="hud-menuwrap">
        <button class="hud-ibtn" data-hud="menu" title="Menu : règles, journal, outils" aria-label="Menu" aria-haspopup="true" aria-expanded="false">${ICONS.tools}<span class="hud-dot"></span></button>
        <div class="hud-menu" role="menu" hidden>
          <button role="menuitem" data-hud="rules">${ICONS.rules}<span>Règles</span></button>
          <button role="menuitem" data-hud="journal">${ICONS.journal}<span>Journal et chat</span><kbd>J</kbd><span class="hud-dot"></span></button>
          <button role="menuitem" data-hud="tools">${ICONS.tools}<span>Outils et réglages</span></button>
        </div>
      </div>
      <button class="hud-ibtn hud-exit" data-hud="exit" title="Quitter la partie (retour au menu)" aria-label="Quitter la partie">${ICONS.exit}</button>
    </div>
    <div class="hud-roster"></div>
    <div class="hud-orders hud-panel" hidden></div>
    <div class="hud-feed"></div>
    <button class="hud-lastcombat" title="Rouvrir la fiche du dernier combat (journal : toutes les fiches)">撃 DERNIER COMBAT</button>
    <button class="hud-abil" hidden></button>
    <div class="hud-card hud-panel hud-hatch" hidden></div>
    <div class="hud-stancebar" hidden></div>
    <div class="hud-mode"></div>
    <div class="hud-route" hidden></div>
    <div class="hud-actions"></div>
    <div class="hud-seal-shadow" hidden aria-hidden="true"></div>
    <button class="hud-seal" hidden></button>`;
  document.body.appendChild(root);
  const q = (sel) => root.querySelector(sel);
  const el = {
    turn: q('.hud-turn'), sub: q('.hud-sub'), callout: q('.hud-callout'), presence: q('.hud-presence'), scores: q('.hud-scores'), timer: q('.hud-timer'),
    route: q('.hud-route'), roster: q('.hud-roster'), orders: q('.hud-orders'), feed: q('.hud-feed'), card: q('.hud-card'), stancebar: q('.hud-stancebar'), mode: q('.hud-mode'), actions: q('.hud-actions'),
    seal: q('.hud-seal'), abil: q('.hud-abil'), journal: q('[data-hud=journal]'), tools: q('[data-hud=menu]'), menuBtn: q('[data-hud=menu]'), menu: q('.hud-menu'),
  };

  let active = false;
  let inspected = null;
  let queued = false;
  const invalidate = () => {
    if (!active || queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; if (active) render(); });
  };

  // ---- hooks on the legacy renderers (calls inside game.js / simultaneous.js resolve through window) ----
  const HOOKED = ['renderUnitList', 'renderDeployUnitList', 'updateActionButtons', 'showUnitDetail', 'renderStancePanel', 'renderTopInfo', 'setMode', 'setDeployReadyButtons', 'renderTurnOrder', 'renderSpectatorBar', 'addCombatLog', 'selectUnit'];
  for (const name of HOOKED) {
    const orig = window[name];
    if (typeof orig !== 'function') continue;
    window[name] = function (...args) {
      if (name === 'showUnitDetail') inspected = args[0] || null;
      const r = orig.apply(this, args);
      invalidate();
      return r;
    };
  }
  (window.gameEventHooks = window.gameEventHooks || []).push(() => invalidate());
  const isTimer = (n) => { for (let x = n; x && x !== document.body; x = x.parentNode) if (x.id === 'top-timer' || x.id === 'sim-timer' || x.id === 'top-time') return true; return false; };
  const isClock = (n) => { for (let x = n; x && x !== document.body; x = x.parentNode) if (x.id === 'top-time') return true; return false; };
  const mo = new MutationObserver((recs) => {
    if (recs.some((r) => !isTimer(r.target))) invalidate();
    else if (recs.some((r) => isClock(r.target))) { const st = bridge.state; renderBanner(st, bridge.mode === 'deploy' && !!bridge.deployState); }
  });
  for (const id of ['top-bar', 'combat-log', 'sim-bar', 'stance-panel', 'action-panel', 'btn-end-turn-center', 'btn-deploy-ready-center', 'unit-list', 'tab-chat']) {
    const n = $(id);
    if (n) mo.observe(n, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'disabled'] });
  }
  const watchSim = () => {
    const n = $('sim-bar');
    if (n && !n.dataset.hudWatched) { n.dataset.hudWatched = '1'; mo.observe(n, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'disabled'] }); }
  };

  // ---- top-right buttons ----
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hud]');
    if (!b) return;
    const a = b.dataset.hud;
    if (a === 'menu') { setMenu(el.menu.hidden); return; }
    if (b.closest('.hud-menu')) setMenu(false);
    if (a === '2d') window.toggleView3d && window.toggleView3d();
    else if (a === 'rules') window.toggleRules && window.toggleRules();
    else if (a === 'journal') toggleDrawer();
    else if (a === 'map') { window.view3d && window.view3d.toggleMapMode && window.view3d.toggleMapMode(); }
    else if (a === 'tools') { document.body.classList.toggle('hud-tools'); document.body.classList.remove('hud-drawer'); render(); }
    else if (a === 'exit') {
      if (b.classList.contains('armed')) { window.leaveGame && window.leaveGame(); return; }
      b.classList.add('armed');
      b.title = 'Cliquer à nouveau pour quitter la partie';
      window.notify && window.notify('Cliquez à nouveau sur le bouton pour quitter la partie et revenir au menu.', 'info');
      clearTimeout(b._disarm);
      b._disarm = setTimeout(() => { b.classList.remove('armed'); b.title = 'Quitter la partie (retour au menu)'; }, 3500);
    }
  });
  function setMenu(on) {
    el.menu.hidden = !on;
    el.menuBtn.classList.toggle('on', on);
    el.menuBtn.setAttribute('aria-expanded', String(on));
  }
  const closeTools = () => { if (document.body.classList.contains('hud-tools')) { document.body.classList.remove('hud-tools'); render(); } };
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.hud-menuwrap')) return;
    if (!el.menu.hidden) setMenu(false);
    if (!e.target.closest('#toolbar') && !e.target.closest('#v3-settings')) closeTools();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!el.menu.hidden) setMenu(false);
    closeTools();
  });
  $('toolbar')?.querySelector('.tb-head')?.insertAdjacentHTML('beforeend', '<button type="button" class="tb-close" aria-label="Fermer" title="Fermer">×</button>');
  $('toolbar')?.addEventListener('click', (e) => { if (e.target.closest('.tb-close')) closeTools(); });
  function toggleDrawer(force) {
    const on = force != null ? force : !document.body.classList.contains('hud-drawer');
    document.body.classList.toggle('hud-drawer', on);
    if (on) {
      document.body.classList.remove('hud-tools');
      const tab = $('tab-chat');
      if (tab && tab.classList.contains('unread') && window.switchSidebarTab) window.switchSidebarTab('chat');
      else if (window.switchSidebarTab && document.querySelector('.sidebar-tab.active')?.textContent.includes('Unités')) window.switchSidebarTab('history');
    }
    render();
  }

  // ---- render ----
  function render() {
    watchSim();
    const st = bridge.state;
    const ds = bridge.deployState;
    const deploying = bridge.mode === 'deploy' && !!ds;
    const sim = !!bridge.simultaneous && st?.phase === 'battle';
    renderBanner(st, deploying);
    renderScores(st);
    renderRoster(st, ds, deploying, sim);
    renderCard(st, deploying, sim);
    renderAbility(st, deploying, sim);
    renderActions(sim);
    renderRoute(deploying);
    renderSeal(st, deploying, sim);
    renderFeed();
    renderOrders(st, sim);
    el.journal.classList.toggle('unread', !!$('tab-chat')?.classList.contains('unread'));
    el.menuBtn.classList.toggle('unread', !!$('tab-chat')?.classList.contains('unread'));
    el.journal.classList.toggle('on', document.body.classList.contains('hud-drawer'));
    el.tools.classList.toggle('on', document.body.classList.contains('hud-tools'));
    const vb = root.querySelector('[data-hud="2d"]');
    const label = view.active ? '2D' : '3D';
    if (vb.textContent !== label) { vb.textContent = label; vb.title = vb.ariaLabel = `Vue ${label}`; }
    const mb = root.querySelector('[data-hud="map"]');
    mb.hidden = !view.active;
    mb.classList.toggle('on', !!(window.view3d && window.view3d.mapMode));
    tick();
  }

  function renderBanner(st, deploying) {
    if (deploying) {
      el.turn.textContent = 'DÉPLOIEMENT';
      el.sub.textContent = 'Placez vos unités dans la zone en surbrillance';
    } else {
      const parts = plain($('top-turn')?.textContent).split(' · ');
      el.turn.textContent = (parts[0] || '').toUpperCase();
      const time = plain($('top-time')?.textContent);
      const rest = parts.slice(1).join(' · ');
      el.sub.innerHTML = `${esc(rest.toUpperCase())}${time ? ` ${st?.isNight ? MOON : SUN} ${esc(time.toUpperCase())}` : ''}`;
    }
    let who = plain($('top-current-player')?.textContent);
    if (who === 'Votre manche') who = 'À vous de jouer !';
    if (G('isSpectator')) who = who ? `Spectateur · ${who}` : 'Spectateur';
    el.callout.textContent = who;
    el.presence.textContent = plain($('presence-bar')?.textContent);
  }

  function renderScores(st) {
    const objs = st?.objectives || [];
    const capture = st?.settings?.victoryMode === 'capture';
    const vp = capture ? st?.settings?.victoryPoints || 0 : 0;
    if (!st || !capture || (!objs.length && !vp)) { el.scores.innerHTML = ''; return; }
    const ps = (st.players || []).filter((p) => !p.isEliminated || (st.scores?.[p.id] || 0) > 0);
    const gain = {};
    for (const o of objs) if (o.owner) gain[o.owner] = (gain[o.owner] || 0) + (o.points || 0);
    el.scores.innerHTML = ps.map((p) => {
      const s = st.scores?.[p.id] || 0, g = p.isEliminated ? 0 : gain[p.id] || 0;
      return `<span class="hud-score-col"><span class="hud-score" style="background:${esc(p.color)}" title="${esc(p.name)} : ${s} point(s)${g ? `, +${g} au prochain tour` : ''}">${s}</span><span class="hud-gain${g ? '' : ' zero'}">+${g}</span></span>`;
    }).join('')
      + (vp ? `<span class="hud-vp">/ ${vp} PTS</span>` : '');
  }

  function tick() {
    if (!active) return;
    const st = bridge.state;
    let at = null;
    const pl = bridge.planning;
    if (bridge.simultaneous && st?.phase === 'battle') at = pl && !bridge.playback ? pl.endsAt : null;
    else if (st?.phase === 'battle') at = st.turnEndsAt;
    if (!at) { el.timer.textContent = ''; return; }
    const left = Math.max(0, Math.ceil((at - Date.now()) / 1000));
    el.timer.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    el.timer.classList.toggle('urgent', left <= 10);
  }

  function unitKanji(u) { return self.KBUnitIcon(u.typeId, u.isGeneral); }

  function renderRoster(st, ds, deploying, sim) {
    let units = [];
    let title = '';
    if (deploying) { units = ds.units || []; const placed = units.filter((u) => u.q != null).length; title = `À DÉPLOYER · ${placed}/${units.length}`; }
    else if (st && st.phase !== 'ended') { units = st.myUnits || []; title = sim ? 'ARMÉE · ORDRES' : 'ARMÉE'; }
    if (!units.length) { el.roster.innerHTML = ''; return; }
    const sel = bridge.selectedUnit;
    const orders = sim ? new Set(bridge.plannedOrders.map((o) => String(o.unitId))) : null;
    el.roster.innerHTML = `<div class="hud-roster-title">${title}</div>` + units.map((u, i) => {
      let cls = 'hud-tag';
      let status;
      if (deploying) {
        const placed = u.q != null;
        cls += placed ? ' placed' : ' todo';
        status = `<span class="s">${placed ? 'PLACÉ' : 'À PLACER'}</span>`;
      } else if (u.isFleeing) { cls += ' flee'; status = '<span class="s">FUITE</span>'; }
      else if (u.march && u.march.route && u.march.route.length && !(sim && orders.has(String(u.id)))) status = '<span class="s">MARCHE</span>';
      else if (sim && orders.has(String(u.id))) status = '<span class="s">ORDRE</span>';
      else if (!sim && u.hasMoved && u.hasAttacked) { cls += ' done'; status = '<span class="s">JOUÉ</span>'; }
      else status = `<span class="v">${u.vitality ?? ''}</span>`;
      if (sel && sel.id === u.id) cls += ' sel';
      const pct = u.maxVitality ? Math.max(0, Math.min(100, (u.vitality / u.maxVitality) * 100)) : 0;
      return `<button class="${cls}" data-i="${i}" title="${esc(u.name)}"><span><span class="k">${unitKanji(u)}</span><span class="n">${esc(u.name)}</span>${status}</span>${deploying ? '' : `<i class="bar" style="width:${pct}%"></i>`}</button>`;
    }).join('');
  }
  el.roster.addEventListener('click', (e) => {
    const b = e.target.closest('.hud-tag');
    if (!b) return;
    const i = Number(b.dataset.i);
    const deploying = bridge.mode === 'deploy' && bridge.deployState;
    const simPlan = !deploying && bridge.simultaneous && bridge.state?.phase === 'battle';
    if (simPlan) {
      const mu = (bridge.state.myUnits || [])[i];
      const u = mu && ((bridge.state.units || []).find((x) => x.id === mu.id) || { ...mu, isMine: true });
      if (u && u.q != null && window.selectUnit) window.selectUnit(u);
    } else {
      const rows = document.querySelectorAll('#unit-list .unit-row');
      if (rows[i]) rows[i].click();
    }
    if (!deploying) {
      const u = (bridge.state?.myUnits || [])[i];
      if (u && u.q != null && view.hexOnScreen && !view.hexOnScreen(u.q, u.r, 0.2)) view.focusHex(u.q, u.r);
    }
  });

  function portrait(u) {
    try {
      const img1Url = window.img1Url;
      if (u.isGeneral) return img1Url(G('GENERAL_IMAGE1_MAP') || {}, bridge.getGeneralIdForUnit(u), 'GENERAL IMAGE 1-1');
      return img1Url(G('UNIT_IMAGE1_MAP') || {}, u.typeId, 'UNIT IMAGE 1-1');
    } catch (e) { return null; }
  }

  function effective(u) {
    const STANCES = G('STANCES_DATA') || {};
    const TERRAINS = G('TERRAINS_DATA') || {};
    const terrain = bridge.terrainData || {};
    const sd = (!u.isGeneral && u.stance) ? (STANCES[u.stance] || {}) : {};
    const tt = u.q != null ? (terrain[`${u.q},${u.r}`] || 'plain') : 'plain';
    const tr = u.isGeneral ? {} : (TERRAINS[tt] || TERRAINS.plain || {});
    const stat = (label, base, key) => {
      const d = (sd[key] || 0) + (tr[key] || 0);
      return { label, v: base + d, d };
    };
    const stats = u.isGeneral
      ? [{ label: 'FORCE', v: u.force, d: 0 }, { label: 'STRATÉGIE', v: u.strategy, d: 0 }, { label: 'CHARISME', v: u.charisma, d: 0 }, { label: 'ARMURE', v: u.armor, d: 0 }]
      : [stat('ATTAQUE', u.attack, 'attack_cac'), stat('PUISSANCE', u.power, 'puissance_cac'), stat('DÉFENSE', u.defense, 'defense_cac'), stat('ARMURE', u.armor, 'armure')];
    for (const s of stats) if (s.v == null || Number.isNaN(s.v)) { s.v = '—'; s.d = 0; }
    return { stats, terrainName: (TERRAINS[tt] || {}).name || tt };
  }

  // ---- my general's active ability, bottom-left: portrait, name, recharge or ready; click = use it (select the general and
  // press its ability action); the passive is recalled below, effects in the tooltip ----
  function myGeneral(st) { return (st?.units || []).find((u) => u.isGeneral && (u.isMine || u.playerId === bridge.myId) && u.q != null); }
  function renderAbility(st, deploying, sim) {
    const g = !deploying && st?.phase === 'battle' ? myGeneral(st) : null;
    const ab = g && g.activeAbility;
    if (!ab) { el.abil.hidden = true; return; }
    el.abil.hidden = false;
    const cd = g.abilityCooldown || 0;
    const order = sim && bridge.simOrderOf ? bridge.simOrderOf(g) : null;
    const queued = !!(order && order.ability);
    const used = !sim && g.hasUsedAbility;
    const canPlay = sim ? !!(bridge.planning && bridge.planning.canPlan) : st.currentPlayerId === bridge.myId;
    const ready = !cd && !used;
    const state = queued ? 'ORDONNÉE' : cd ? `⟳ ${cd}` : used ? 'UTILISÉE' : 'PRÊTE';
    const src = portrait(g);
    const sig = [ab.name, state, canPlay, src].join('|');
    el.abil.classList.toggle('ready', ready && canPlay && !queued);
    el.abil.classList.toggle('queued', queued);
    el.abil.classList.toggle('cd', !ready);
    el.abil.title = `${ab.name} — ${ab.description || ''}${ab.cooldown ? ` (recharge ${ab.cooldown} tours)` : ''}${g.passiveAbility ? `\nPassif · ${g.passiveAbility.name} — ${g.passiveAbility.description || ''}` : ''}${ready && canPlay ? '\nCliquer pour utiliser la capacité' : ''}`;
    if (el.abil.dataset.sig === sig) return;
    el.abil.dataset.sig = sig;
    el.abil.innerHTML = `<span class="ha-face">${src ? `<img src="${esc(src)}" alt="">` : ''}<i class="ha-bolt" aria-hidden="true">⚡\uFE0E</i></span>
      <span class="ha-txt"><span class="ha-kicker">Capacité du général</span><b>${esc(ab.name)}</b>${g.passiveAbility ? `<small>⛨ ${esc(g.passiveAbility.name)}</small>` : ''}</span>
      <span class="ha-state">${state}</span>`;
  }
  el.abil.addEventListener('click', () => {
    const st = bridge.state;
    const g = myGeneral(st);
    if (!g || el.abil.classList.contains('cd')) return;
    if (!(bridge.selectedUnit && bridge.selectedUnit.id === g.id)) bridge.click({ q: g.q, r: g.r });
    setTimeout(() => {
      if (window.KBSim && window.KBSim.active() && window.KBSim.orderAction('ability')) return;
      const b = $('btn-ability');
      if (b && !b.disabled) b.click();
    }, 80);
  });

  function currentUnit(st, deploying) {
    if (deploying) return bridge.selectedUnit || null;
    let u = inspected || bridge.selectedUnit;
    if (!u) return null;
    const fresh = (st?.units || []).find((x) => x.id === u.id) || (st?.myUnits || []).find((x) => x.id === u.id);
    if (!fresh && inspected) { inspected = null; return bridge.selectedUnit || null; }
    return fresh || u;
  }

  function renderCard(st, deploying, sim) {
    const u = currentUnit(st, deploying);
    const tip = $('stance-tooltip');
    if (tip && tip.style.display === 'block' && el.stancebar.contains(document.querySelector('.hud-stancebar [data-stance]:hover')) && window.hideStanceTooltip) window.hideStanceTooltip();
    if (!u) { el.card.hidden = true; el.card.innerHTML = ''; el.stancebar.hidden = true; return; }
    el.card.hidden = false;
    const src = portrait(u);
    const color = bridge.getPlayerColor ? bridge.getPlayerColor(u.playerId) : '#000';
    const names = G('stanceNames') || {};
    const list = G('stanceList') || [];
    const { stats, terrainName } = effective(u);
    const fmtSpeed = window.fmtSpeed || ((x) => x);
    const meta = [];
    if (!u.isMine && !deploying) meta.push(u.isAlly ? '<span class="flag ok">ALLIÉ</span>' : '<span class="flag">ENNEMI</span>');
    meta.push(esc(u.isGeneral ? 'GÉNÉRAL' : (u.category || '').toUpperCase()));
    if (u.speed != null) meta.push(`VITESSE ${u.speedRemaining != null ? esc(fmtSpeed(u.speedRemaining)) + '/' : ''}${u.speed}`);
    if (!u.isGeneral && u.q != null) meta.push(esc(String(terrainName).toUpperCase()));
    if (u.range > 1) meta.push(`PORTÉE ${u.range}`);
    if (u.isFleeing) meta.push('<span class="flag">EN FUITE</span>');
    if (u.isMine && u.concealed) meta.push('<span class="flag ok">CACHÉE</span>');
    if (u.stunned) meta.push('<span class="flag">SONNÉ</span>');
    if (u.isMine && !deploying && !sim && u.hasMoved) meta.push('DÉPLACÉ');
    if (u.isMine && !deploying && !sim && u.hasAttacked) meta.push('A ATTAQUÉ');
    if (u.isMine && u.march && u.march.route && u.march.route.length) meta.push(`<span class="flag ok">MARCHE · ${u.march.route.length} CASE${u.march.route.length > 1 ? 'S' : ''}</span>`);
    const pct = u.maxVitality ? Math.max(0, Math.min(100, (u.vitality / u.maxVitality) * 100)) : 0;
    const simOrder = sim && bridge.simOrderOf ? bridge.simOrderOf(u) : null;
    const curStance = simOrder && simOrder.stance ? simOrder.stance : u.stance;
    const canAct = u.isMine && !deploying && !u.isGeneral && !u.isFleeing && u.q != null
      && (sim ? !!(bridge.planning && bridge.planning.canPlan) : st?.currentPlayerId === bridge.myId);
    const stCost = bridge.orientCosts ? bridge.orientCosts().stance : 2;
    const stanceShown = canAct;
    const sty = (s) => (window.stanceStyle ? window.stanceStyle(s) : { k: '', svg: '', c: '#000', name: names[s] || s, short: names[s] || s });
    const step = sim && canAct && window.KBSim && KBSim.stepInfo ? KBSim.stepInfo(u) : null;
    const stanceBtns = (step ? `<span class="sb-step" title="Ctrl+clic sur la case ou Échap pour revenir à la posture de départ">${step.at === step.total ? "À L'ARRIVÉE" : `ÉTAPE ${step.at} / ${step.total}`} · POSTURE ICI</span>` : '') + list.map((s, i) => {
      const ss = sty(s);
      if (step) {
        const on = step.here === s;
        const off = !on && s === step.before;
        return `<button class="sb-key${on ? ' on' : ''}" data-stance="${i}" ${off ? 'disabled' : ''} title="${esc(ss.name)} (touche ${i + 1})${on ? ' — prévue ici, cliquer pour la retirer' : off ? ' — déjà la posture à cette étape' : ` — à cette étape, −${stCost} vitesse`}" aria-label="${esc(ss.name)}"><kbd>${i + 1}</kbd><i class="st-chip" style="background:${esc(ss.c)}">${ss.svg || ''}</i></button>`;
      }
      const on = curStance === s;
      const off = !sim && !on && (u.speedRemaining || 0) < stCost;
      return `<button class="sb-key${on ? ' on' : ''}" data-stance="${i}" ${off ? 'disabled' : ''} title="${esc(ss.name)} (touche ${i + 1})${on ? ' — actuelle' : ` — −${stCost} vitesse${sim ? ', au début de la résolution' : ''}`}" aria-label="${esc(ss.name)}"><kbd>${i + 1}</kbd><i class="st-chip" style="background:${esc(ss.c)}">${ss.svg || ''}</i></button>`;
    }).join('');
    const genShown = u.isMine && !deploying && u.isGeneral && u.q != null && bridge.selectedUnit && bridge.selectedUnit.id === u.id
      && (sim ? !!(bridge.planning && bridge.planning.canPlan) : st?.currentPlayerId === bridge.myId);
    let genBtn = '';
    if (genShown) {
      const on = !!(simOrder && simOrder.type === 'motivate');
      const off = !sim && !!u.hasAttacked;
      const range = Math.floor((u.charisma || 10) / 5);
      const tip = `Motiver les troupes à ${range} case${range > 1 ? 's' : ''} ou moins (touche V) : D20 ≤ Charisme ${u.charisma ?? '?'} → elles regagnent du moral et cessent de fuir ; les troupes sans général rallient votre armée${sim ? (on ? ' — ordonné, cliquer pour annuler' : '') : off ? ' — le général a déjà agi ce tour' : ' — toute la vitesse restante'}`;
      genBtn = `<button class="sb-key sb-gen${on ? ' on' : ''}" data-gen="motivate" ${off ? 'disabled' : ''} title="${esc(tip)}" aria-label="Motiver"><kbd>V</kbd><i class="st-chip" style="background:#6f9bf0"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="2.4" aria-hidden="true"><path d="M5 21V3"></path><path d="M5 4h12l-3 4 3 4H5"></path></svg></i><span>MOTIVER</span></button>`;
    }
    const barSig = stanceShown ? stanceBtns : genBtn;
    if (el.stancebar.dataset.sig !== barSig) { el.stancebar.dataset.sig = barSig; el.stancebar.innerHTML = barSig; }
    el.stancebar.hidden = !(stanceShown || genShown);
    let stanceNow = '';
    if (!u.isGeneral && u.stance) {
      const ss = sty(u.stance);
      const kind = (u.range || 1) > 1 ? 'tir' : 'cac';
      const fx = window.stanceEffectsText ? window.stanceEffectsText(u.stance, kind, 4) : '';
      const full = [window.stanceEffectsText ? window.stanceEffectsText(u.stance) : '', window.stanceAngleText ? window.stanceAngleText(u.stance) : '', sim && window.stanceReactionText ? `si attaquée : ${window.stanceReactionText(u.stance)}` : ''].filter(Boolean).join(' — ');
      stanceNow = `<div class="stance-now" title="${esc(full)}"><i class="st-chip" style="background:${esc(ss.c)}">${ss.svg || ''}</i><b>${esc(ss.name.toUpperCase())}</b><span>${esc(fx)}${sim && window.stanceReactionText ? ` · si attaquée : ${esc(window.stanceReactionText(u.stance))}` : ''}</span></div>`;
    }
    el.card.innerHTML = `
      <div class="pic">${src ? `<img src="${esc(src)}" alt="">` : ''}<span class="k">${unitKanji(u)}</span><i class="owner" style="background:${esc(color)}"></i></div>
      <div class="body">
        <div class="head">
          <div style="min-width:0;display:flex;flex-direction:column"><span class="name">${esc((u.name || '').toUpperCase())}</span><span class="meta">${meta.join(' · ')}</span></div>
          <div class="vit"><b>${u.vitality ?? '—'}</b><small>/${u.maxVitality ?? '—'}</small></div>
        </div>
        <div class="vbar${pct < 35 ? ' low' : ''}"><i style="width:${pct}%"></i></div>
        ${stanceNow}
        <div class="stats">${stats.map((s) => `<div class="stat"><span>${s.label}</span><b class="${s.d > 0 ? 'up' : s.d < 0 ? 'down' : ''}" title="${s.d ? `base ${s.v - s.d}, ${s.d > 0 ? '+' : ''}${s.d} posture/terrain` : ''}">${s.v ?? '—'}</b></div>`).join('')}
          ${u.isGeneral ? `<div class="stat inv"><span>PUISSANCE</span><b>${u.power ?? '—'}</b></div>` : `<div class="stat inv"><span>MORAL</span><b>${u.morale ?? '—'}</b></div>`}</div>
      </div>
      <div class="tools">${u.isMine && u.march && u.march.route && u.march.route.length ? '<button data-card="unmarch" title="Annuler la marche sur plusieurs tours">STOP MARCHE</button>' : ''}<button data-card="sheet" title="Fiche complète (double-clic sur l'unité)">FICHE</button></div>`;
  }
  el.card.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-card=stance-at]');
    const cu = bridge.selectedUnit;
    if (sel && cu && bridge.setStanceAt) bridge.setStanceAt(cu, Number(sel.value));
  });
  el.stancebar.addEventListener('click', (e) => {
    const gb = e.target.closest('[data-gen=motivate]');
    if (gb) {
      if (gb.disabled) return;
      if (window.KBSim && window.KBSim.active()) window.KBSim.orderAction('motivate');
      else if (window.motivateAll) window.motivateAll();
      render();
      return;
    }
    const sb = e.target.closest('[data-stance]');
    if (!sb) return;
    if (window.hideStanceTooltip) window.hideStanceTooltip();
    const cu = bridge.selectedUnit;
    const sid = (G('stanceList') || [])[Number(sb.dataset.stance)];
    if (cu && sid && !sb.disabled && bridge.setUnitStance) bridge.setUnitStance(cu, sid);
  });
  el.card.addEventListener('click', (e) => {
    if (e.target.closest('[data-card=unmarch]')) {
      const cu = bridge.selectedUnit;
      if (cu && bridge.cancelMarch) bridge.cancelMarch(cu.id);
      return;
    }
    if (e.target.closest('[data-card=sheet]')) {
      const u = currentUnit(bridge.state, bridge.mode === 'deploy' && bridge.deployState);
      if (u && window.showUnitCard) window.showUnitCard(u);
    }
  });
  el.stancebar.addEventListener('mouseover', (e) => {
    const sb = e.target.closest('[data-stance]');
    if (!sb || !window.showStanceTooltip) return;
    const s = (G('stanceList') || [])[Number(sb.dataset.stance)];
    if (s) window.showStanceTooltip(e, s);
  });
  el.stancebar.addEventListener('mousemove', (e) => { if (e.target.closest('[data-stance]') && window.positionStanceTooltip) window.positionStanceTooltip(e); });
  el.stancebar.addEventListener('mouseout', (e) => { if (e.target.closest('[data-stance]') && window.hideStanceTooltip) window.hideStanceTooltip(); });

  function legacyVisible(id) {
    const b = $(id);
    const panel = $('action-panel');
    return !!b && b.style.display === 'block' && (!panel || panel.style.display !== 'none');
  }

  function renderActions(sim) {
    const sel = bridge.selectedUnit;
    const fmtSpeed = window.fmtSpeed || ((x) => x);
    const mode = bridge.mode;
    const vis = sim ? [] : ACTIONS.filter((a) => legacyVisible(a.id));
    el.actions.innerHTML = vis.map((a) => {
      let label = a.label;
      if (a.id === 'btn-move' && sel && sel.speedRemaining != null) label += ` ${fmtSpeed(sel.speedRemaining)}`;
      if (a.id === 'btn-ability' && sel?.activeAbility?.name) label = sel.activeAbility.name;
      if (a.id === 'btn-ability' && $('btn-ability')?.dataset.label) label = $('btn-ability').dataset.label;
      const on = (a.id === 'btn-attack' && mode === 'attack') || (a.id === 'btn-move' && mode === 'move') || (a.id === 'btn-ability' && mode === 'ability') || (a.id === 'btn-facing' && mode === 'facing');
      const dis = !!$(a.id)?.disabled;
      const tip = (dis || a.id === 'btn-facing') && $(a.id)?.title ? $(a.id).title : label;
      return `<button class="hud-act ${a.cls}${on ? ' on' : ''}" data-act="${a.id}" ${dis ? 'disabled' : ''} title="${esc(tip)} (${a.hint})"><span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label.toUpperCase())}</span><span class="hud-kbd">${a.hint}</span></span></button>`;
    }).join('');
    const labels = { attack: 'MODE ATTAQUE', motivate: 'MOTIVER : CHOISIR UNE UNITÉ', move: 'MODE DÉPLACEMENT', ability: 'CAPACITÉ : CHOISIR UNE CASE VOISINE', facing: 'ORIENTER : CLIQUEZ LA CASE VISÉE' };
    el.mode.textContent = sim ? '' : (labels[mode] || '');
    el.mode.style.bottom = `${26 + vis.length * 55 + 6}px`;
  }
  // Route being chosen (waypoints): count, cost / speed, tool toggle (T) and undo (Échap)
  function renderRoute(deploying) {
    const info = !deploying && bridge.routeInfo;
    if (!info) { el.route.hidden = true; el.route.innerHTML = ''; return; }
    const fmt = window.fmtSpeed || ((x) => x);
    const n = info.waypoints.length;
    el.route.hidden = false;
    el.route.classList.toggle('on', n > 0 || info.tool);
    el.route.innerHTML = n || info.tool
      ? `<span class="t">CHEMIN</span><span>${n} étape${n > 1 ? 's' : ''} · coût <b>${esc(fmt(info.cost))}</b> / ${esc(fmt(info.budget))}</span>
         <button data-route="tool" class="${info.tool ? 'on' : ''}" title="Chaque clic sur une case ajoute une étape (T)">ÉTAPES <span class="hud-kbd">T</span></button>
         <button data-route="undo" title="Retirer la dernière étape (Échap)">RETIRER <span class="hud-kbd">ÉCHAP</span></button>`
      : `<span>Maj+clic sur des cases : chemin étape par étape, la dernière étape est la destination</span><button data-route="tool" title="Chaque clic sur une case ajoute une étape (T)">ÉTAPES <span class="hud-kbd">T</span></button>`;
  }
  el.route.addEventListener('click', (e) => {
    const b = e.target.closest('[data-route]');
    if (!b) return;
    if (b.dataset.route === 'tool' && bridge.toggleRouteTool) bridge.toggleRouteTool();
    if (b.dataset.route === 'undo' && bridge.undoWaypoint) bridge.undoWaypoint();
    render();
  });

  function doAction(id) {
    if (id === 'btn-move') {
      const sel = bridge.selectedUnit;
      if (!sel) return;
      if (bridge.mode !== 'select' && window.setMode) window.setMode('select');
      if (window.selectUnit) window.selectUnit(sel);
      return;
    }
    const b = $(id);
    if (b) b.click();
  }
  el.actions.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) doAction(b.dataset.act);
  });

  let sealTarget = null;
  function renderSeal(st, deploying, sim) {
    const seal = el.seal;
    let cfg = null;
    if (G('isSpectator') || st?.phase === 'ended') cfg = null;
    else if (deploying) {
      const b = $('btn-deploy-ready-center');
      if (b && b.style.display !== 'none') {
        cfg = b.disabled ? { kj: '待', lb: plain(b.textContent) || 'En attente', wait: true } : { kj: '戦', lb: 'Prêt', ky: 'ENTRÉE', target: b, pulse: b.classList.contains('pulse') };
      }
    } else if (sim) {
      const b = $('sim-commit');
      if (b && b.style.display !== 'none' && $('sim-bar')?.style.display !== 'none') {
        const txt = plain(b.textContent);
        if (bridge.playback) cfg = { kj: '進', lb: 'Passer', ky: 'ENTRÉE', target: b, alt: true };
        else if (b.classList.contains('cancel')) cfg = { kj: '改', lb: txt || 'Modifier les ordres', ky: 'ENTRÉE', target: b, alt: true };
        else cfg = { kj: '令', lb: txt || 'Ordres prêts', ky: 'ENTRÉE', target: b };
      }
    } else if (st?.phase === 'battle') {
      const b = $('btn-end-turn-center');
      if (b && b.style.display !== 'none' && b.style.display !== '') cfg = { kj: '終', lb: 'Fin du tour', ky: 'ENTRÉE', target: b, pulse: b.classList.contains('pulse') };
      else {
        const cur = (st.players || []).find((p) => p.id === st.currentPlayerId);
        if (cur) cfg = { kj: '待', lb: `Tour de ${cur.name}`, wait: true };
      }
    }
    sealTarget = cfg && cfg.target ? cfg.target : null;
    const sealShadow = root.querySelector('.hud-seal-shadow');
    if (sealShadow) sealShadow.hidden = !cfg;
    if (!cfg) { seal.hidden = true; return; }
    seal.hidden = false;
    seal.className = `hud-seal${cfg.wait ? ' wait' : ''}${cfg.alt ? ' alt' : ''}${cfg.pulse ? ' pulse' : ''}`;
    seal.innerHTML = `<span class="kj">${cfg.kj}</span><span class="lb">${esc(cfg.lb)}</span>${cfg.ky ? `<span class="ky">${cfg.ky}</span>` : ''}`;
    seal.setAttribute('aria-label', cfg.lb);
  }
  el.seal.addEventListener('click', () => { if (sealTarget && !sealTarget.disabled) sealTarget.click(); });

  function renderFeed() {
    const fights = (bridge.combatHistory || []).filter((e) => e && e.log && !e.log.abilityUsed).length;
    const lc = root.querySelector('.hud-lastcombat');
    if (lc) lc.classList.toggle('on', fights > 0);
    const log = $('combat-log');
    const entries = log ? [...log.children].slice(0, 4) : [];
    el.feed.innerHTML = entries.map((n, i) => {
      const cls = n.classList.contains('kill') ? 'kill' : n.classList.contains('hit') ? 'hit' : '';
      return `<div class="ev ${cls}${i > 1 ? ' old' : ''}">${esc(plain(n.textContent))}</div>`;
    }).reverse().join('');
  }

  function describeOrder(o, st) {
    const units = st?.units || [];
    const tgt = o.target ? units.find((u) => u.id === o.target.id) : null;
    const tName = tgt ? esc(tgt.name) : 'la cible';
    const names = G('stanceNames') || {};
    let main;
    if (o.type === 'move') main = `Déplacer · ${Math.max(0, (o.path?.length || 1) - 1)} case${(o.path?.length || 1) - 1 > 1 ? 's' : ''}`;
    else if (o.type === 'attack') main = `<em>${o.ranged ? 'Tirer' : 'Attaquer'}</em> ${tName}`;
    else if (o.type === 'charge') main = `<em>Charger</em> ${tName}`;
    else if (o.type === 'motivate') main = 'Motiver les troupes';
    else main = 'Tenir';
    const extra = [];
    if (o.stance) extra.push(`posture ${esc(names[o.stance] || o.stance)}`);
    if (o.facing != null) extra.push('orientation');
    if (o.ability) extra.push('capacité');
    return main + (extra.length ? ` · ${extra.join(' · ')}` : '');
  }

  function renderOrders(st, sim) {
    const pl = bridge.planning;
    if (!sim || !pl || G('isSpectator')) { el.orders.hidden = true; return; }
    el.orders.hidden = false;
    const pb = bridge.playback;
    const orders = bridge.plannedOrders;
    const mine = st.myUnits || [];
    const cp = pl.commandPoints || { used: 0, max: 0 };
    const head = pb ? `<div class="hd"><span class="t">RÉSOLUTION</span><span class="c">${Math.min(pb.tick + 1, pb.ticks)}<small style="font-size:13px"> / ${pb.ticks}</small></span></div>`
      : `<div class="hd"><span class="t">${pl.committed ? 'ORDRES ENVOYÉS' : 'COMMANDEMENT'}</span><span class="c">${cp.used}<small style="font-size:13px"> / ${cp.max}</small></span></div>`;
    const pips = !pb && cp.max > 0 && cp.max <= 16 ? `<div class="pips">${Array.from({ length: cp.max }, (_, i) => `<i class="${i < cp.used ? 'u' : ''}"></i>`).join('')}</div>` : '';
    const rows = pb ? '' : orders.map((o) => {
      const u = mine.find((x) => String(x.id) === String(o.unitId));
      if (!u) return '';
      return `<div class="ord" data-unit="${esc(o.unitId)}"><span class="k">${unitKanji(u)}</span><span class="tx"><b>${esc(u.name)}</b><span>${describeOrder(o, st)}</span></span>${pl.canPlan ? `<button data-clear="${esc(o.unitId)}" title="Annuler l'ordre" aria-label="Annuler l'ordre">✕</button>` : ''}</div>`;
    }).join('');
    const holding = mine.filter((u) => !orders.some((o) => String(o.unitId) === String(u.id))).length;
    const foot = pb ? '<div class="foot">Les ordres de tous les généraux s\'exécutent case par case.</div>'
      : `<div class="foot hud-hatch">${orders.length ? '' : 'Sélectionnez une unité puis cliquez une case ou un ennemi. '}${holding > 1 ? `${holding} unités sans ordre tiennent leur position et réagissent selon leur posture.` : holding === 1 ? '1 unité sans ordre tient sa position et réagit selon sa posture.' : 'Toutes les unités ont un ordre.'}</div>`;
    const players = (st.players || []).filter((p) => !p.isEliminated);
    const who = pb ? '' : `<div class="who">${players.map((p) => { const ok = (pl.committedIds || []).includes(p.id); return `<span class="${ok ? 'ok' : ''}" style="${ok ? '' : `color:${esc(p.color)}`}">${ok ? 'PRÊT' : 'RÉFLÉCHIT'} · ${esc(p.name)}</span>`; }).join('')}</div>`;
    el.orders.innerHTML = head + pips + `<div class="list">${rows}</div>` + foot + who;
  }
  el.orders.addEventListener('click', (e) => {
    const clear = e.target.closest('[data-clear]');
    const row = e.target.closest('[data-unit]');
    if (!row) return;
    const u = (bridge.state?.units || []).find((x) => String(x.id) === row.dataset.unit && x.isMine);
    if (!u) return;
    if (window.selectUnit) window.selectUnit(u);
    if (clear) {
      if (window.KBSim) window.KBSim.orderAction('clear');
    } else if (u.q != null && view.hexOnScreen && !view.hexOnScreen(u.q, u.r, 0.2)) view.focusHex(u.q, u.r);
  });

  window.addEventListener('kb-mapmode', () => render());

  // ---- keyboard: R/F/C/V actions, 1-9 stances, Enter seal, J journal (physical keys, outside the camera keys) ----
  const editable = (n) => n && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName));
  window.addEventListener('keydown', (e) => {
    if (!active || editable(document.activeElement) || e.metaKey || e.ctrlKey || e.altKey || CAM_CODES.has(e.code)) return;
    if (document.body.classList.contains('v3-photo')) return;
    const overlayOpen = [...document.querySelectorAll('.overlay')].some((o) => o.style.display && o.style.display !== 'none');
    if (overlayOpen) return;
    const act = ACTIONS.find((a) => a.key === e.code);
    if (act) { if (el.actions.querySelector(`[data-act=${act.id}]`)) { e.preventDefault(); doAction(act.id); } return; }
    if (e.code === 'KeyV') { const b = el.stancebar.hidden ? null : el.stancebar.querySelector('[data-gen=motivate]'); if (b) { e.preventDefault(); b.click(); } return; }
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m) { const b = el.stancebar.hidden ? null : el.stancebar.querySelector(`[data-stance="${Number(m[1]) - 1}"]`); if (b) { e.preventDefault(); b.click(); } return; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { if (!el.seal.hidden && sealTarget) { e.preventDefault(); el.seal.click(); } return; }
    if (e.code === 'KeyJ') { e.preventDefault(); toggleDrawer(); }
    if (e.code === 'KeyT' && bridge.routeInfo && bridge.toggleRouteTool) { e.preventDefault(); bridge.toggleRouteTool(); render(); }
  });

  // ---- periodic: timers, tutorial highlights mirrored on the HUD, coach placement ----
  setInterval(() => {
    if (!active) return;
    tick();
    let toolsHi = false;
    for (const [src, dst] of MIRRORS) {
      const s = document.querySelector(src);
      const on = !!s && s.classList.contains('tuto-highlight');
      const d = root.querySelector(dst);
      if (dst === '.hud-seal') continue;
      if (d) d.classList.toggle('tuto-highlight', on);
      if (src === '#tool-coords' && on) toolsHi = true;
    }
    const sealOn = ['#btn-end-turn-center', '#btn-end-turn-global'].some((s) => document.querySelector(s)?.classList.contains('tuto-highlight'));
    el.seal.classList.toggle('tuto-highlight', sealOn);
    if (toolsHi && !document.body.classList.contains('hud-tools')) el.tools.classList.add('tuto-highlight');
    const coach = $('tuto-coach');
    document.body.classList.toggle('hud-coach', !!coach && coach.style.display !== 'none' && !coach.classList.contains('minimized'));
  }, 400);

  const area = $('canvas-area');
  const resizeView = () => {
    if (!active) return;
    if (view.active && view.world) view.world.resize();
    else if (bridge.redraw2D) bridge.redraw2D();
  };
  if (area && window.ResizeObserver) new ResizeObserver(resizeView).observe(area);

  const splash = createCombatSplash({ bridge, portrait, kanji: unitKanji, isActive: () => active });
  window.hudOpenCombat = (i) => splash.open(i);
  root.querySelector('.hud-lastcombat').addEventListener('click', () => splash.openLast());
  const gameOver = createGameOver({ bridge });

  // ---- 2D view: attack tooltip on hoverable targets (the 3D view has its own, same content) ----
  const tip2d = document.createElement('div');
  tip2d.id = 'hud-tip2d';
  document.body.appendChild(tip2d);
  const canvas2d = $('game-canvas');
  if (canvas2d) {
    canvas2d.addEventListener('mousemove', (e) => {
      if (!active || view.active || e.buttons) { tip2d.style.display = 'none'; return; }
      const sel = bridge.selectedUnit;
      const hex = window.getHexUnderMouse ? window.getHexUnderMouse(e) : null;
      const key = hex ? `${hex.q},${hex.r}` : null;
      const tgt = key && sel && bridge.attackableTiles && bridge.attackableTiles.has(key)
        ? (bridge.state?.units || []).find((u) => u.q === hex.q && u.r === hex.r && !u.isMine && !u.isAlly) : null;
      if (!tgt) { tip2d.style.display = 'none'; return; }
      tip2d.innerHTML = attackTipHtml(sel, tgt, bridge.unitTypes, bridge.approachAt ? bridge.approachAt(key) : null);
      tip2d.style.display = 'block';
      tip2d.style.left = Math.min(innerWidth - 250, e.clientX + 16) + 'px';
      tip2d.style.top = Math.max(8, Math.min(innerHeight - tip2d.offsetHeight - 8, e.clientY - 10)) + 'px';
    });
    canvas2d.addEventListener('mouseleave', () => { tip2d.style.display = 'none'; });
  }
  (window.gameEventHooks = window.gameEventHooks || []).push((event, data) => {
    if (event !== 'combat_result' || !active) return;
    const log = (data && data.combatLog) || data;
    if (!log || log.abilityUsed) return;
    splash.show(log, { playback: !!(data && data.playback) });
    setTimeout(() => { const box = $('combat-result-box'); if (box && document.body.classList.contains('hud-d')) box.style.display = 'none'; }, 0);
  });

  function setActive(on) {
    active = on;
    if (!on) { splash.hide(); gameOver.hide(); }
    document.body.classList.toggle('hud-d', on);
    document.body.classList.toggle('hud-2d', on && !view.active);
    if (!on) {
      document.body.classList.remove('hud-drawer', 'hud-tools', 'hud-coach');
    } else {
      watchSim();
      render();
    }
    requestAnimationFrame(resizeView);
  }

  // Called after switching between the 2D and the 3D view.
  function setView() {
    document.body.classList.toggle('hud-2d', active && !view.active);
    tip2d.style.display = 'none';
    if (!view.active) document.body.classList.remove('hud-tools');
    invalidate();
    requestAnimationFrame(resizeView);
  }

  return { setActive, setView, invalidate, get active() { return active; } };
}
