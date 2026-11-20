// Battle HUD (style D) shown over the 3D view. It is a presentation layer only: the legacy sidebar, top bar and buttons
// stay in the DOM (hidden) and keep their logic in game.js / simultaneous.js / tutorial.js; the HUD reads the bridge state
// and those elements, and forwards every click to the legacy control, so the rules live in one place.
import { createCombatSplash } from './combatSplash.js';
export const KANJI = { pietaille: '卒', soldats: '兵', phalange: '盾', lancier: '槍', espion: '諜', assassin: '刺', cavalier_leger: '騎', cavalier_lourd: '騎', archer: '弓', archer_elite: '弓', batisseurs: '工', char: '車' };
const CAM_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']);
const ACTIONS = [
  { id: 'btn-move', key: 'KeyR', hint: 'R', label: 'Déplacer', cls: '' },
  { id: 'btn-attack', key: 'KeyF', hint: 'F', label: 'Attaquer', cls: 'attack' },
  { id: 'btn-ability', key: 'KeyC', hint: 'C', label: 'Capacité', cls: '' },
  { id: 'btn-motivate', key: 'KeyV', hint: 'V', label: 'Motiver', cls: '' },
];
const MIRRORS = [
  ['#unit-list', '.hud-roster'], ['#tool-coords', '[data-hud=tools]'], ['#selected-unit-detail', '.hud-card'],
  ['#stance-panel', '.hud-card .stances'], ['#btn-end-turn-center', '.hud-seal'], ['#btn-end-turn-global', '.hud-seal'],
  ['#btn-attack', '[data-act=btn-attack]'], ['#top-time', '.hud-banner .hud-sub'], ['#top-scores', '.hud-scores'],
];
const SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"></path></svg>';
const MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M20 14A8 8 0 1 1 10 4a6 6 0 0 0 10 10z"></path></svg>';
const ICONS = {
  rules: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z"></path></svg>',
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
      <button class="hud-ibtn" data-hud="2d" title="Vue 2D" aria-label="Vue 2D">2D</button>
      <button class="hud-ibtn" data-hud="rules" title="Règles" aria-label="Règles">${ICONS.rules}</button>
      <button class="hud-ibtn" data-hud="journal" title="Journal : historique et chat (J)" aria-label="Journal">${ICONS.journal}<span class="hud-dot"></span></button>
      <button class="hud-ibtn" data-hud="tools" title="Outils et réglages" aria-label="Outils">${ICONS.tools}</button>
    </div>
    <div class="hud-roster"></div>
    <div class="hud-orders hud-panel" hidden></div>
    <div class="hud-feed"></div>
    <div class="hud-card hud-panel hud-hatch" hidden></div>
    <div class="hud-mode"></div>
    <div class="hud-actions"></div>
    <div class="hud-simslot"></div>
    <button class="hud-seal" hidden></button>`;
  document.body.appendChild(root);
  const q = (sel) => root.querySelector(sel);
  const el = {
    turn: q('.hud-turn'), sub: q('.hud-sub'), callout: q('.hud-callout'), presence: q('.hud-presence'), scores: q('.hud-scores'), timer: q('.hud-timer'),
    roster: q('.hud-roster'), orders: q('.hud-orders'), feed: q('.hud-feed'), card: q('.hud-card'), mode: q('.hud-mode'), actions: q('.hud-actions'),
    simslot: q('.hud-simslot'), seal: q('.hud-seal'), journal: q('[data-hud=journal]'), tools: q('[data-hud=tools]'),
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
  const isTimer = (n) => { for (let x = n; x && x !== document.body; x = x.parentNode) if (x.id === 'top-timer' || x.id === 'sim-timer') return true; return false; };
  const mo = new MutationObserver((recs) => { if (recs.some((r) => !isTimer(r.target))) invalidate(); });
  for (const id of ['top-bar', 'combat-log', 'sim-bar', 'stance-panel', 'action-panel', 'btn-end-turn-center', 'btn-deploy-ready-center', 'unit-list', 'tab-chat']) {
    const n = $(id);
    if (n) mo.observe(n, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'disabled'] });
  }
  const watchSim = () => {
    const n = $('sim-bar');
    if (n && !n.dataset.hudWatched) { n.dataset.hudWatched = '1'; mo.observe(n, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'disabled'] }); }
    const p = $('sim-panel');
    if (p && p.parentNode !== el.simslot && active) el.simslot.appendChild(p);
  };

  // ---- top-right buttons ----
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hud]');
    if (!b) return;
    const a = b.dataset.hud;
    if (a === '2d') window.toggleView3d && window.toggleView3d();
    else if (a === 'rules') window.toggleRules && window.toggleRules();
    else if (a === 'journal') toggleDrawer();
    else if (a === 'tools') { document.body.classList.toggle('hud-tools'); document.body.classList.remove('hud-drawer'); render(); }
  });
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
    renderActions(sim);
    renderSeal(st, deploying, sim);
    renderFeed();
    renderOrders(st, sim);
    el.journal.classList.toggle('unread', !!$('tab-chat')?.classList.contains('unread'));
    el.journal.classList.toggle('on', document.body.classList.contains('hud-drawer'));
    el.tools.classList.toggle('on', document.body.classList.contains('hud-tools'));
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
    const vp = st?.settings?.victoryPoints || 0;
    if (!st || (!objs.length && !vp)) { el.scores.innerHTML = ''; return; }
    const ps = (st.players || []).filter((p) => !p.isEliminated || (st.scores?.[p.id] || 0) > 0);
    el.scores.innerHTML = ps.map((p) => `<span class="hud-score" style="background:${esc(p.color)}" title="${esc(p.name)} : ${st.scores?.[p.id] || 0} point(s)">${st.scores?.[p.id] || 0}</span>`).join('')
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

  function unitKanji(u) { return u.isGeneral ? '将' : (KANJI[u.typeId] || '兵'); }

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
    if (tip && tip.style.display === 'block' && el.card.contains(document.querySelector('.hud-card [data-stance]:hover')) && window.hideStanceTooltip) window.hideStanceTooltip();
    if (!u) { el.card.hidden = true; el.card.innerHTML = ''; return; }
    el.card.hidden = false;
    const src = portrait(u);
    const color = bridge.getPlayerColor ? bridge.getPlayerColor(u.playerId) : '#000';
    const names = G('stanceNames') || {};
    const list = G('stanceList') || [];
    const { stats, terrainName } = effective(u);
    const fmtSpeed = window.fmtSpeed || ((x) => x);
    const meta = [];
    if (!u.isMine && !deploying) meta.push('<span class="flag">ENNEMI</span>');
    meta.push(esc(u.isGeneral ? 'GÉNÉRAL' : (u.category || '').toUpperCase()));
    if (u.speed != null) meta.push(`VITESSE ${u.speedRemaining != null ? esc(fmtSpeed(u.speedRemaining)) + '/' : ''}${u.speed}`);
    if (!u.isGeneral && u.stance) meta.push(`POSTURE ${esc((names[u.stance] || u.stance).toUpperCase())}`);
    if (!u.isGeneral && u.q != null) meta.push(esc(String(terrainName).toUpperCase()));
    if (u.range > 1) meta.push(`PORTÉE ${u.range}`);
    if (u.isFleeing) meta.push('<span class="flag">EN FUITE</span>');
    if (u.isMine && u.concealed) meta.push('<span class="flag ok">CACHÉE</span>');
    if (u.stunned) meta.push('<span class="flag">SONNÉ</span>');
    if (u.isMine && !deploying && !sim && u.hasMoved) meta.push('DÉPLACÉ');
    if (u.isMine && !deploying && !sim && u.hasAttacked) meta.push('A ATTAQUÉ');
    const pct = u.maxVitality ? Math.max(0, Math.min(100, (u.vitality / u.maxVitality) * 100)) : 0;
    const stanceShown = !sim && $('stance-panel')?.style.display === 'block';
    const icons = bridge.stanceIcons || {};
    const stanceBtns = list.map((s, i) => {
      const on = u.stance === s;
      const ic = icons[s] && icons[s].src ? `<img src="${esc(icons[s].src)}" alt="">` : '';
      const label = on || !ic ? esc(names[s] || s) : '';
      return `<button class="hud-para${on ? ' on' : ''}" data-stance="${i}" title="${esc(names[s] || s)} (${i + 1})" aria-label="${esc(names[s] || s)}"><span>${ic}${label}</span></button>`;
    }).join('');
    el.card.innerHTML = `
      <div class="pic">${src ? `<img src="${esc(src)}" alt="">` : ''}<span class="k">${unitKanji(u)}</span><i class="owner" style="background:${esc(color)}"></i></div>
      <div class="body">
        <div class="head">
          <div style="min-width:0;display:flex;flex-direction:column"><span class="name">${esc((u.name || '').toUpperCase())}</span><span class="meta">${meta.join(' · ')}</span></div>
          <div class="vit"><b>${u.vitality ?? '—'}</b><small>/${u.maxVitality ?? '—'}</small></div>
        </div>
        <div class="vbar${pct < 35 ? ' low' : ''}"><i style="width:${pct}%"></i></div>
        <div class="stats">${stats.map((s) => `<div class="stat"><span>${s.label}</span><b class="${s.d > 0 ? 'up' : s.d < 0 ? 'down' : ''}" title="${s.d ? `base ${s.v - s.d}, ${s.d > 0 ? '+' : ''}${s.d} posture/terrain` : ''}">${s.v ?? '—'}</b></div>`).join('')}
          ${u.isGeneral ? `<div class="stat inv"><span>${esc((u.weapon || 'ARME').toUpperCase())}</span><b>${u.power ?? '—'}</b></div>` : `<div class="stat inv"><span>MORAL</span><b>${u.morale ?? '—'}</b></div>`}</div>
        <div class="stances" ${stanceShown ? '' : 'hidden'}>${stanceBtns}</div>
      </div>
      <div class="tools"><button data-card="sheet" title="Fiche complète (double-clic sur l'unité)">FICHE</button></div>`;
  }
  el.card.addEventListener('click', (e) => {
    const sb = e.target.closest('[data-stance]');
    if (sb) {
      if (window.hideStanceTooltip) window.hideStanceTooltip();
      const legacy = document.querySelectorAll('#stance-list .stance-btn')[Number(sb.dataset.stance)];
      if (legacy) legacy.click();
      return;
    }
    if (e.target.closest('[data-card=sheet]')) {
      const u = currentUnit(bridge.state, bridge.mode === 'deploy' && bridge.deployState);
      if (u && window.showUnitCard) window.showUnitCard(u);
    }
  });
  el.card.addEventListener('mouseover', (e) => {
    const sb = e.target.closest('[data-stance]');
    if (!sb || !window.showStanceTooltip) return;
    const s = (G('stanceList') || [])[Number(sb.dataset.stance)];
    if (s) window.showStanceTooltip(e, s);
  });
  el.card.addEventListener('mousemove', (e) => { if (e.target.closest('[data-stance]') && window.positionStanceTooltip) window.positionStanceTooltip(e); });
  el.card.addEventListener('mouseout', (e) => { if (e.target.closest('[data-stance]') && window.hideStanceTooltip) window.hideStanceTooltip(); });

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
      const on = (a.id === 'btn-attack' && mode === 'attack') || (a.id === 'btn-move' && mode === 'move');
      return `<button class="hud-act ${a.cls}${on ? ' on' : ''}" data-act="${a.id}" title="${esc(label)} (${a.hint})"><span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label.toUpperCase())}</span><span class="hud-kbd">${a.hint}</span></span></button>`;
    }).join('');
    const labels = { attack: 'MODE ATTAQUE', motivate: 'MOTIVER : CHOISIR UNE UNITÉ', move: 'MODE DÉPLACEMENT' };
    el.mode.textContent = sim ? '' : (labels[mode] || '');
    el.mode.style.bottom = `${26 + vis.length * 55 + 6}px`;
  }
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
    if (!cfg) { seal.hidden = true; return; }
    seal.hidden = false;
    seal.className = `hud-seal${cfg.wait ? ' wait' : ''}${cfg.alt ? ' alt' : ''}${cfg.pulse ? ' pulse' : ''}`;
    seal.innerHTML = `<span class="kj">${cfg.kj}</span><span class="lb">${esc(cfg.lb)}</span>${cfg.ky ? `<span class="ky">${cfg.ky}</span>` : ''}`;
    seal.setAttribute('aria-label', cfg.lb);
  }
  el.seal.addEventListener('click', () => { if (sealTarget && !sealTarget.disabled) sealTarget.click(); });

  function renderFeed() {
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
      const b = document.querySelector('#sim-panel button[data-a=clear]');
      if (b) b.click();
    } else if (u.q != null && view.hexOnScreen && !view.hexOnScreen(u.q, u.r, 0.2)) view.focusHex(u.q, u.r);
  });

  // ---- keyboard: R/F/C/V actions, 1-9 stances, Enter seal, J journal (physical keys, outside the camera keys) ----
  const editable = (n) => n && (n.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName));
  window.addEventListener('keydown', (e) => {
    if (!active || editable(document.activeElement) || e.metaKey || e.ctrlKey || e.altKey || CAM_CODES.has(e.code)) return;
    if (document.body.classList.contains('v3-photo')) return;
    const overlayOpen = [...document.querySelectorAll('.overlay')].some((o) => o.style.display && o.style.display !== 'none');
    if (overlayOpen) return;
    const act = ACTIONS.find((a) => a.key === e.code);
    if (act) { if (el.actions.querySelector(`[data-act=${act.id}]`)) { e.preventDefault(); doAction(act.id); } return; }
    const m = /^Digit([1-9])$/.exec(e.code);
    if (m) { const b = el.card.querySelector(`.stances:not([hidden]) [data-stance="${Number(m[1]) - 1}"]`); if (b) { e.preventDefault(); b.click(); } return; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { if (!el.seal.hidden && sealTarget) { e.preventDefault(); el.seal.click(); } return; }
    if (e.code === 'KeyJ') { e.preventDefault(); toggleDrawer(); }
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
  if (area && window.ResizeObserver) new ResizeObserver(() => { if (active && view.active && view.world) view.world.resize(); }).observe(area);

  const splash = createCombatSplash({ bridge, portrait, kanji: unitKanji, isActive: () => active && !!view.active });
  (window.gameEventHooks = window.gameEventHooks || []).push((event, data) => {
    if (event !== 'combat_result' || !active) return;
    const log = (data && data.combatLog) || data;
    if (!log || log.abilityUsed) return;
    splash.show(log, { playback: !!(data && data.playback) });
    setTimeout(() => { const box = $('combat-result-box'); if (box && document.body.classList.contains('hud-d')) box.style.display = 'none'; }, 0);
  });

  function setActive(on) {
    active = on;
    if (!on) splash.hide();
    document.body.classList.toggle('hud-d', on);
    if (!on) {
      document.body.classList.remove('hud-drawer', 'hud-tools', 'hud-coach');
      const p = $('sim-panel');
      const anchor = $('action-panel');
      if (p && anchor && p.parentNode !== anchor.parentNode) anchor.parentNode.insertBefore(p, anchor);
    } else {
      watchSim();
      render();
    }
    requestAnimationFrame(() => { if (view.active && view.world) view.world.resize(); });
  }

  return { setActive, invalidate, get active() { return active; } };
}
