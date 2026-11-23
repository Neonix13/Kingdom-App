// Kingdom Battleground — 2D client of the simultaneous mode (loaded after game.js, shares its globals).
// Planning: select a unit, click a hex (move), an enemy (attack, or charge with the Charge tool), set stance / facing /
// motivation / ability in the side panel; orders are kept by the server (set_orders) and shown as arrows.
// Playback: the `resolution` timeline is replayed tick by tick on gameState.units (unitAnimations drive the 2D and 3D
// views); ws events received meanwhile (new game_state, captures, game over...) are applied once the playback ends.
// Local events for the 3D / audio layers (window.view3d.onEvent + window.gameEventHooks):
//   playback_start { turn, ticks }, playback_tick { turn, t, index }, unit_move_anim { unitId, fromQ, fromR, path, playback: true },
//   combat_result { combatLog, playback: true, kind }, ambush {...}, playback_end { turn }
(function () {
  const S = KBRules.RULES.simultaneous;
  const DEFERRED = new Set(['game_state', 'planning_start', 'objective_captured', 'time_change', 'game_over', 'units_fled', 'turn_auto_ended', 'planning_timeout']);
  const ORDER_LABEL = { move: 'Déplacement', attack: 'Attaque', charge: 'Charge', hold: 'Tenir', motivate: 'Motiver' };
  const FACING_BTNS = [{ idx: 3, label: '↖' }, { idx: 2, label: '↑' }, { idx: 1, label: '↗' }, { idx: 4, label: '↙' }, { idx: 5, label: '↓' }, { idx: 0, label: '↘' }];

  const st = {
    orders: {},          // my orders as stored by the server
    cp: { max: 0, used: 0 },
    committed: false,
    committedIds: [],
    lastStatus: null,    // freshest commit_status { turn, committed }
    turn: null,
    endsAt: null,
    startsAt: null,
    tool: null,          // 'charge' | 'ability' (waiting for a click)
    wps: {},             // unitId -> waypoints chosen for its move order (stance change on a waypoint)
    playback: null,
    tickSent: 0,
    popupTurn: null,
  };

  function isSim() {
    return !!gameState && gameState.mode === 'simultaneous' && (gameState.phase === 'battle' || gameState.phase === 'ended');
  }
  function me() { return gameState && gameState.players.find(p => p.id === myId); }
  function canPlan() {
    const p = me();
    return isSim() && gameState.phase === 'battle' && !isSpectator && !!p && !p.isEliminated && !st.committed && !st.playback;
  }
  function myUnit(id) { return (gameState?.myUnits || []).find(u => u.id === id) || (gameState?.units || []).find(u => u.id === id && u.isMine); }
  function anyUnit(id) { return (gameState?.units || []).find(u => u.id === id); }

  function emitLocal(event, data) {
    if (window.view3d) { try { window.view3d.onEvent(event, data); } catch (e) { console.warn(e); } }
    if (window.gameEventHooks) for (const h of window.gameEventHooks) { try { h(event, data); } catch (e) { console.warn(e); } }
  }

  function send(action, data = {}) { wsSend(action, { roomCode, ...data }); }

  // ---------- movement preview: same rules as the server (paths checked by cost; only visible enemies block) ----------
  function budgetFor(unit, order = st.orders[unit.id]) {
    let b = unit.speedRemaining || 0;
    if (order && order.stance && order.stance !== unit.stance) b -= S.stanceCost;
    if (order && order.facing != null) b -= S.facingCost;
    if (order && order.unitAbility) { const ab = KBRules.ability(unit, window.gameBridge && window.gameBridge.unitTypes); if (ab) b -= ab.cost; }
    return Math.max(0, KBRules.snap(b));
  }

  function reach(unit, budget, start = null, fresh = true) {
    const enemies = new Set((gameState?.units || []).filter(u => !u.isMine && !u.isAlly).map(u => `${u.q},${u.r}`));
    return KBRules.reachable(movementTable(), {
      start: start || { q: unit.q, r: unit.r }, maxCost: budget, mounted: KBRules.isMounted(unit),
      minStep: fresh && budget === unit.speedRemaining && KBRules.hasFullSpeed(unit),
      hexAt: (k) => (k in mapHeight ? { terrain: terrainData[k] || 'plain', height: mapHeight[k] || 0 } : null),
      blocked: (k) => enemies.has(k),
      segAt: (a, b, c, d) => segmentData[segmentEdgeKey(a, b, c, d)] || null,
    });
  }

  function clearTiles() {
    movableTiles.clear(); attackableTiles.clear();
    rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
  }

  // Route through the waypoints chosen by the player (shared helpers of game.js), from the planning budget
  function simRoute(unit) {
    if (!unit || unit.q == null) return null;
    const from = (start, budget, fresh) => reach(unit, budget, start, fresh);
    let R = composeRoute(unit, budgetFor(unit), from);
    if (!R && routeWaypoints(unit).length) {
      const M = marchRoute(unit); // waypoints beyond this turn: a march
      if (M) return M;
      route.waypoints = []; R = composeRoute(unit, budgetFor(unit), from);
    }
    return R;
  }

  function computeTiles(unit) {
    clearTiles();
    if (!unit || !canPlan() || unit.isFleeing) return;
    const R = simRoute(unit);
    if (!R) return;
    if (R.march) return;
    for (const k of R.reach.dist.keys()) movableTiles.add(k);
    movableTiles.delete(`${unit.q},${unit.r}`);
    for (const [q, r] of routeWaypoints(unit)) movableTiles.delete(`${q},${r}`);
    for (const e of gameState.units) if (!e.isMine && !e.isAlly) attackableTiles.add(`${e.q},${e.r}`);
    if (unit.range > 1) computeRangeTiles(unit);
    if (unit.isGeneral) computeMotivateTiles(unit);
  }

  // ---------- orders ----------
  function setOrder(unitId, order) {
    if (!canPlan()) return;
    send('set_orders', { orders: { [unitId]: order }, turn: gameState.turn });
  }

  function current(unit) { return st.orders[unit.id] || null; }

  // Same check as the server: adjacent steps, finite costs, total within the budget (one step always allowed when fresh)
  function pathFits(unit, path, budget) {
    let q = unit.q, r = unit.r, cost = 0;
    const mounted = KBRules.isMounted(unit);
    for (const [nq, nr] of path) {
      const a = `${q},${r}`, b = `${nq},${nr}`;
      if (!(b in mapHeight)) return false;
      const c = KBRules.stepCost(movementTable(), { terrain: terrainData[a] || 'plain', height: mapHeight[a] || 0 }, { terrain: terrainData[b] || 'plain', height: mapHeight[b] || 0 }, segmentData[segmentEdgeKey(q, r, nq, nr)] || null, mounted);
      if (!isFinite(c)) return false;
      cost = KBRules.snap(cost + c);
      q = nq; r = nr;
    }
    return cost <= budget + 1e-9 || (path.length === 1 && budget > 0 && budget === unit.speedRemaining && KBRules.hasFullSpeed(unit));
  }

  function patchOrder(unit, patch) {
    const o = { type: 'hold', ...(current(unit) || {}), ...patch };
    // a march order: resend its whole route (the server splits it again with the new budget)
    if (o.marchRest && !('path' in patch) && o.type === 'move') { o.path = [...(o.path || []), ...o.marchRest]; o.march = true; }
    delete o.marchRest;
    if (o.type !== 'move' || ('path' in patch && !patch.march)) delete o.march;
    for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
    const routed = o.type === 'attack' || o.type === 'charge';
    if (o.stanceAt != null && (!o.stance || !o.path || o.stanceAt > o.path.length)) delete o.stanceAt;
    if (o.type !== 'move' && !routed) delete o.path;
    if (o.type !== 'attack' && o.type !== 'charge') delete o.targetId;
    // a stance or facing change shrinks the budget: drop a path that no longer fits (checked step by step)
    if ((o.type === 'move' || routed) && o.path && o.path.length && !o.march) {
      if (!pathFits(unit, o.path, budgetFor(unit, o))) {
        if (o.type === 'move') { o.type = 'hold'; notify('Chemin trop long avec ce changement : déplacement annulé.', 'info'); }
        else if ((unit.range || 1) > 1) notify('Position de tir trop loin avec ce changement : le tireur reste sur place.', 'info');
        else notify('Chemin trop long avec ce changement : l\'unité ira droit sur sa cible.', 'info');
        delete o.path;
      }
    }
    setOrder(unit.id, o);
  }

  function describe(order, unit) {
    if (!order) return 'Aucun ordre : l\'unité tient sa position.';
    const parts = [ORDER_LABEL[order.type] || order.type];
    if (order.type === 'move' && order.path) parts[0] += ` (${order.path.length} case${order.path.length > 1 ? 's' : ''})`;
    if (order.type === 'move' && order.marchRest && order.marchRest.length) parts[0] += ` · marche : encore ${order.marchRest.length} case${order.marchRest.length > 1 ? 's' : ''} aux tours suivants`;
    if ((order.type === 'attack' || order.type === 'charge') && order.path && order.path.length && unit && (unit.range || 1) <= 1) parts[0] += ` · par le chemin choisi (${order.path.length} case${order.path.length > 1 ? 's' : ''})`;
    if (order.targetId) {
      const t = anyUnit(order.targetId);
      parts[0] += ` → ${t ? t.name : 'cible'}`;
      if (order.type === 'attack' && unit && unit.range > 1) parts[0] += ' (tir dès qu\'elle est à portée)';
    }
    if (order.stance) parts.push(`posture ${stanceNames[order.stance] || order.stance}${order.stanceAt ? ` à l'étape ${order.stanceAt}` : ''}`);
    if (order.facing != null) parts.push('orientation');
    if (order.ability) parts.push('capacité');
    if (order.unitAbility) parts.push(order.unitAbility.kind === 'vanish' ? 'disparaître' : order.unitAbility.kind === 'sabotage' ? 'sabotage' : `construire : ${(KBRules.RULES.abilities.build_kinds[order.unitAbility.build] || {}).label || ''}`);
    return parts.join(' · ');
  }

  // ---------- selection / clicks ----------
  function select(unit) {
    if (!isSim()) return;
    if (!unit || route.unitId !== unit.id) { route.unitId = null; route.waypoints = []; }
    selectedUnit = unit && unit.isMine ? unit : null;
    st.tool = null;
    computeTiles(selectedUnit);
    showUnitDetail(selectedUnit || unit || null);
    renderStancePanel(null);
    updateActionButtons();
    renderPanel();
    render();
  }

  function refresh() {
    const sel = selectedUnit && (myUnit(selectedUnit.id) || selectedUnit);
    if (sel) computeTiles(sel);
    renderPanel();
    updateActionButtons();
    render();
  }

  function click(hex, opts = {}) {
    if (!hex || !isSim()) return;
    const key = `${hex.q},${hex.r}`;
    const unitAt = (gameState.units || []).find(u => u.q === hex.q && u.r === hex.r);
    if (!canPlan()) { if (unitAt) showUnitDetail(unitAt); return; }
    if (selectedUnit) {
      const sel = myUnit(selectedUnit.id) || selectedUnit;
      // waypoints: Maj+clic (or the Étapes tool) adds one, a click on a waypoint cuts the route back to it
      if (!unitAt && routeClick(sel, hex, !!opts.shiftKey || route.tool, { has: (k) => movableTiles.has(k) || marchTargets(sel).has(k) }, refresh)) return;
      if (unitAt && !unitAt.isMine && !unitAt.isAlly) {
        const type = st.tool === 'charge' ? 'charge' : 'attack';
        if (type === 'charge' && sel.range > 1) { notify('Les tireurs ne chargent pas.', 'info'); return; }
        const patch = { type, targetId: unitAt.id, path: undefined };
        const R = routeWaypoints(sel).length ? simRoute(sel) : null;
        if (R && !R.march && (sel.range || 1) <= 1) patch.path = R.path.slice(1); // melee: follows the route, then closes in
        else if (type === 'attack' && sel.range > 1) {
          // out of range: the shooter first walks to its firing position (after the route, if any)
          const a = approachTo(sel, unitAt);
          if (a && a.path.length > 1) patch.path = a.path.slice(1);
          else if (!a) notify('Hors de portée ce tour : le tireur tirera si la cible s\'approche.', 'info');
        }
        patchOrder(sel, patch);
        resetRoute();
        st.tool = null;
        computeTiles(sel);
        return;
      }
      if (unitAt && unitAt.isMine) {
        if (unitAt.id === sel.id) { select(null); return; }
        select(unitAt);
        return;
      }
      if (movableTiles.has(key)) {
        const path = pathTo(sel, hex.q, hex.r);
        if (path) { st.wps[sel.id] = routeWaypoints(sel).map(w => w.slice()); patchOrder(sel, { type: 'move', path: path.path.slice(1) }); }
        resetRoute();
        computeTiles(sel);
        return;
      }
      // beyond this turn's reach: a march over several turns (first click shows it, the second one gives the order)
      const mp = !unitAt && marchPlan(sel, hex.q, hex.r);
      if (mp) {
        if (mp.path.length - 1 > 200) { notify('Destination trop lointaine pour une seule marche.', 'info'); return; }
        if (st.pendingMarch === `${sel.id}|${key}`) {
          st.pendingMarch = null;
          st.wps[sel.id] = routeWaypoints(sel).map(w => w.slice());
          patchOrder(sel, { type: 'move', path: mp.path.slice(1), march: true, targetId: undefined });
          resetRoute();
          computeTiles(sel);
          return;
        }
        st.pendingMarch = `${sel.id}|${key}`;
        notify(`${marchLabel(mp)} : cliquez à nouveau sur la case pour donner l'ordre.`, 'info');
        render();
        return;
      }
      select(null);
      return;
    }
    if (unitAt && unitAt.isMine) select(unitAt);
    else if (unitAt) showUnitDetail(unitAt);
  }

  // March to a hex beyond this turn's reach (planning budget), or null
  function marchPlan(unit, tq, tr) {
    if (!unit || unit.q == null || !canPlan() || unit.isFleeing) return null;
    const k = `${tq},${tr}`;
    if (movableTiles.has(k) || (gameState.units || []).some(u => u.q === tq && u.r === tr)) return null;
    const b = budgetFor(unit);
    return window.marchPlan ? window.marchPlan(unit, tq, tr, b, b === unit.speedRemaining && KBRules.hasFullSpeed(unit)) : null;
  }

  // Path to (tq, tr) through the waypoints: { path (origin included), costs, cost } or null
  function pathTo(unit, tq, tr) {
    if (!unit || unit.q == null || !canPlan()) return null;
    if (!movableTiles.has(`${tq},${tr}`)) return null;
    return extendRoute(simRoute(unit), tq, tr);
  }

  // Hex from which the unit can strike target this turn, after the waypoints (path with the origin included), or null
  function approachTo(unit, target) {
    if (!unit || unit.q == null || !target || !canPlan()) return null;
    const R = simRoute(unit);
    if (!R || R.march) return null;
    const E = R.end;
    if (hexDistance(E.q, E.r, target.q, target.r) <= KBRules.attackRange(unit.range, mapHeight[`${E.q},${E.r}`] || 0, mapHeight[`${target.q},${target.r}`] || 0)) {
      return routeWaypoints(unit).length ? { q: E.q, r: E.r, path: R.path } : null;
    }
    const res = KBRules.bestAttackHex(R.reach, { start: E, target, range: unit.range || 1, heightAt: (k) => mapHeight[k] || 0 });
    return res ? { ...res, path: [...R.path, ...res.path] } : null;
  }

  function routeInfo() {
    const unit = selectedUnit && myUnit(selectedUnit.id);
    if (!unit || !canPlan() || unit.isFleeing) return null;
    const R = simRoute(unit);
    return R ? { waypoints: routeWaypoints(unit), cost: R.cost, left: R.march ? 0 : R.left, budget: budgetFor(unit), tool: route.tool, march: !!R.march } : null;
  }

  function contextMenu(hex, clientX, clientY) {
    if (!hex || !canPlan()) return;
    const unit = gameState.units.find(u => u.q === hex.q && u.r === hex.r && u.isMine);
    if (!unit) return;
    document.getElementById('facing-popup')?.remove();
    const popup = document.createElement('div');
    popup.id = 'facing-popup';
    Object.assign(popup.style, { position: 'fixed', left: `${clientX - 54}px`, top: `${clientY - 40}px`, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '3px', background: 'rgba(10,5,0,0.95)', border: '1px solid #5a3c10', borderRadius: '8px', padding: '6px', zIndex: '1000' });
    const o = current(unit);
    for (const { idx, label } of FACING_BTNS) {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = 'sim-facing-btn' + ((o && o.facing === idx) ? ' active' : '');
      b.onclick = () => { patchOrder(unit, { facing: o && o.facing === idx ? undefined : idx }); popup.remove(); };
      popup.appendChild(b);
    }
    document.body.appendChild(popup);
    setTimeout(() => document.addEventListener('click', () => popup.remove(), { once: true }), 0);
  }

  // ---------- side panel (orders of the selected unit) and bottom bar (commit, timer, status) ----------
  function ensureDom() {
    if (document.getElementById('sim-bar')) return;
    const css = document.createElement('style');
    css.textContent = `
      #sim-bar { position:fixed; bottom:18px; left:50%; transform:translateX(-50%); z-index:300; display:none; align-items:center; gap:12px;
        background:rgba(12,6,2,0.94); border:1px solid #5a3c10; border-radius:10px; padding:8px 14px; box-shadow:0 2px 14px #000a; color:#e0c080; font-size:0.9em; }
      #sim-bar .sim-cp { color:#ffd700; font-weight:bold; }
      #sim-bar .sim-timer { min-width:46px; text-align:center; font-variant-numeric:tabular-nums; }
      #sim-bar .sim-chip { padding:2px 7px; border-radius:10px; border:1px solid #3a2408; font-size:0.85em; white-space:nowrap; }
      #sim-bar .sim-chip.ok { border-color:#4a8020; color:#a0e080; }
      #sim-commit { padding:8px 20px; font-weight:bold; background:#1a3a08; border:2px solid #4a8020; color:#a0e080; border-radius:7px; cursor:pointer; }
      #sim-commit.cancel { background:#3a2408; border-color:#7a5820; color:#e0c080; }
      #sim-commit:disabled { opacity:0.5; cursor:default; }
      #sim-panel { padding:6px 8px; border-top:1px solid #3a2408; font-size:0.8em; color:#c8a060; display:none; }
      #sim-panel h4 { margin:0 0 4px; color:#ffd700; font-size:0.95em; }
      #sim-panel .sim-row { display:flex; flex-wrap:wrap; gap:4px; margin:4px 0; }
      #sim-panel .sim-desc { color:#e0c080; margin-bottom:4px; }
      #sim-panel button, .sim-facing-btn { background:#1a0f04; border:1px solid #3a2408; color:#a89060; cursor:pointer; padding:3px 7px; font-size:0.95em; border-radius:3px; }
      #sim-panel button:hover, .sim-facing-btn:hover { border-color:#7a5820; color:#e0c080; }
      #sim-panel button.active, .sim-facing-btn.active { border-color:#c8960c; background:#3a2408; color:#ffd700; }
      .sim-facing-btn { width:30px; height:30px; font-size:16px; }
      #sim-panel .sim-label { color:#7a5820; font-size:0.85em; margin-top:6px; }
    `;
    document.head.appendChild(css);
    const bar = document.createElement('div');
    bar.id = 'sim-bar';
    bar.innerHTML = '<span id="sim-phase"></span><span class="sim-cp" id="sim-cp"></span><span class="sim-timer" id="sim-timer"></span><span id="sim-status"></span><button id="sim-commit"></button>';
    document.body.appendChild(bar);
    document.getElementById('sim-commit').onclick = onCommitClick;
    const panel = document.createElement('div');
    panel.id = 'sim-panel';
    const anchor = document.getElementById('action-panel');
    anchor.parentNode.insertBefore(panel, anchor);
  }

  function onCommitClick() {
    if (st.playback) { skipPlayback(); return; }
    if (!isSim() || isSpectator) return;
    if (st.committed) send('cancel_commit');
    else send('commit_orders', { turn: gameState.turn });
  }

  function fmt(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function renderBar() {
    ensureDom();
    const bar = document.getElementById('sim-bar');
    if (!isSim() || gameState.phase !== 'battle') { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    const btn = document.getElementById('sim-commit');
    const phase = document.getElementById('sim-phase');
    if (st.playback) {
      phase.textContent = `Résolution du tour ${st.playback.data.turn}…`;
      document.getElementById('sim-cp').textContent = '';
      document.getElementById('sim-status').innerHTML = '';
      btn.textContent = 'Passer ⏭';
      btn.className = 'cancel';
      btn.disabled = false;
      btn.style.display = '';
      return;
    }
    phase.textContent = `Tour ${gameState.turn} · Planification`;
    document.getElementById('sim-cp').textContent = isSpectator ? '' : `Ordres ${st.cp.used}/${st.cp.max}`;
    const alive = gameState.players.filter(p => !p.isEliminated);
    document.getElementById('sim-status').innerHTML = alive.map(p => {
      const ok = st.committedIds.includes(p.id);
      return `<span class="sim-chip${ok ? ' ok' : ''}" style="color:${ok ? '' : p.color}" title="${ok ? 'Ordres prêts' : 'Planifie…'}">${ok ? '✓ ' : '… '}${escapeHtml(p.name)}</span>`;
    }).join(' ');
    const p = me();
    btn.style.display = isSpectator || !p || p.isEliminated ? 'none' : '';
    btn.textContent = st.committed ? 'Modifier les ordres' : 'Ordres prêts ✓';
    btn.className = st.committed ? 'cancel' : '';
    btn.disabled = false;
  }

  function renderPanel() {
    ensureDom();
    const panel = document.getElementById('sim-panel');
    const unit = selectedUnit && myUnit(selectedUnit.id);
    if (!canPlan() || !unit) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    const o = current(unit);
    const melee = (unit.range || 1) <= 1;
    let html = `<h4>Ordre : ${escapeHtml(unit.name)}</h4><div class="sim-desc">${escapeHtml(describe(o, unit))}</div>`;
    html += `<div class="sim-label">Vitesse disponible : ${fmtSpeed(budgetFor(unit))} / ${fmtSpeed(unit.speedRemaining)} · clic sur une case verte = déplacement, sur un ennemi = ${melee ? 'attaque (approche puis frappe)' : 'tir (dès qu\'il est à portée)'}</div>`;
    html += '<div class="sim-row">';
    html += `<button data-a="hold">Tenir</button>`;
    if (melee) html += `<button data-a="charge" class="${st.tool === 'charge' ? 'active' : ''}" title="Choisissez ensuite la cible : bonus si ≥ ${S.charge.minHexes} cases parcourues">Charger…</button>`;
    if (unit.isGeneral) html += `<button data-a="motivate" class="${o && o.type === 'motivate' ? 'active' : ''}">Motiver</button>`;
    if (unit.isGeneral && unit.activeAbility) {
      const cd = unit.abilityCooldown > 0;
      html += `<button data-a="ability" class="${o && o.ability ? 'active' : ''}" ${cd ? 'disabled' : ''} title="${escapeHtml(unit.activeAbility.description || '')}">${escapeHtml(unit.activeAbility.name)}${cd ? ` (${unit.abilityCooldown})` : ''}</button>`;
    }
    html += `<button data-a="clear">Annuler l'ordre</button></div>`;
    const uab = !unit.isGeneral && KBRules.ability(unit, window.gameBridge && window.gameBridge.unitTypes);
    if (uab && ['sabotage', 'build', 'ambush'].includes(uab.type)) {
      const cur = o && o.unitAbility;
      const DIR_NAMES = ['E', 'NE', 'NO', 'O', 'SO', 'SE'];
      const opts = [];
      if (uab.type === 'ambush') opts.push({ kind: 'vanish', label: 'Disparaître pour la journée' });
      else KBRules.DIRS.forEach(([dq, dr], i) => {
        const nq = unit.q + dq, nr = unit.r + dr, nk = `${nq},${nr}`;
        if (!(nk in mapHeight)) return;
        const seg = segmentData[segmentEdgeKey(unit.q, unit.r, nq, nr)] || null, ter = terrainData[nk] || 'plain';
        if (uab.type === 'sabotage') { if (KBRules.sabotageOption(seg, ter)) opts.push({ kind: 'sabotage', q: nq, r: nr, label: `Saboter (${DIR_NAMES[i]})` }); }
        else for (const b of KBRules.buildOptions(seg, ter)) opts.push({ kind: 'build', build: b.id, q: nq, r: nr, label: `${KBRules.RULES.abilities.build_kinds[b.id].label} (${DIR_NAMES[i]})` });
      });
      html += `<div class="sim-label">Capacité (coût ${uab.cost} vitesse, au début de la résolution)</div><div class="sim-row">`;
      if (!opts.length) html += '<span class="sim-desc">Rien à faire à côté de cette unité.</span>';
      opts.forEach((op, i) => {
        const on = cur && cur.kind === op.kind && cur.q === op.q && cur.r === op.r && cur.build === op.build;
        html += `<button data-ua="${i}" class="${on ? 'active' : ''}">${escapeHtml(op.label)}</button>`;
      });
      html += '</div>';
      st.uaOpts = opts;
    }
    const steps = KBSimStanceSteps(unit);
    if (steps) html += `<div class="sim-label">Changer de posture (${escapeHtml(stanceNames[o.stance] || o.stance)})</div><div class="sim-row"><select data-stance-at class="sim-stance-at">${steps.choices.map(c => `<option value="${c.n}"${c.n === steps.value ? ' selected' : ''}>${escapeHtml(c.label)}</option>`).join('')}</select></div>`;
    html += `<div class="sim-label">Posture : sous la fiche de l'unité · orientation finale (coût ${S.facingCost}) : clic droit glissé depuis l'unité${o && o.facing != null ? ' (choisie)' : ''}</div>`;
    if (unit.isGeneral && unit.activeAbility && unit.activeAbility.target === 'enemy_army' && st.tool === 'ability') {
      html += '<div class="sim-label">Armée ciblée</div><div class="sim-row">';
      for (const p of gameState.players) if (p.id !== myId && !p.isEliminated) html += `<button data-ability-target="${escapeHtml(p.id)}" style="color:${p.color}">${escapeHtml(p.name)}</button>`;
      html += '</div>';
    }
    panel.innerHTML = html;
    panel.querySelectorAll('button[data-a]').forEach(b => { b.onclick = () => panelAction(unit, b.dataset.a); });
    panel.querySelectorAll('button[data-stance]').forEach(b => {
      const s = b.dataset.stance;
      b.onclick = () => { hideStanceTooltip(); patchOrder(unit, { stance: s === unit.stance ? undefined : s }); };
      b.addEventListener('mouseenter', e => showStanceTooltip(e, s));
      b.addEventListener('mousemove', positionStanceTooltip);
      b.addEventListener('mouseleave', hideStanceTooltip);
    });
    const sa = panel.querySelector('[data-stance-at]');
    if (sa) sa.onchange = () => patchOrder(unit, { stanceAt: Number(sa.value) > 0 ? Number(sa.value) : undefined });
    panel.querySelectorAll('button[data-facing]').forEach(b => {
      const f = Number(b.dataset.facing);
      b.onclick = () => patchOrder(unit, { facing: o && o.facing === f ? undefined : f });
    });
    panel.querySelectorAll('button[data-ua]').forEach(b => {
      const op = st.uaOpts[Number(b.dataset.ua)];
      b.onclick = () => {
        const cur = o && o.unitAbility;
        const same = cur && cur.kind === op.kind && cur.q === op.q && cur.r === op.r && cur.build === op.build;
        patchOrder(unit, { unitAbility: same ? undefined : { kind: op.kind, q: op.q, r: op.r, build: op.build } });
      };
    });
    panel.querySelectorAll('button[data-ability-target]').forEach(b => {
      b.onclick = () => { st.tool = null; patchOrder(unit, { ability: { targetId: b.dataset.abilityTarget } }); };
    });
  }

  function panelAction(unit, a) {
    const o = current(unit);
    if (a === 'hold') patchOrder(unit, { type: 'hold' });
    else if (a === 'clear') setOrder(unit.id, null);
    else if (a === 'charge') { st.tool = st.tool === 'charge' ? null : 'charge'; notify(st.tool ? 'Charge : cliquez sur l\'unité ennemie visée.' : 'Charge annulée.', 'info'); renderPanel(); }
    else if (a === 'motivate') patchOrder(unit, { type: o && o.type === 'motivate' ? 'hold' : 'motivate' });
    else if (a === 'ability') {
      if (o && o.ability) patchOrder(unit, { ability: undefined });
      else if (unit.activeAbility.target === 'enemy_army') { st.tool = 'ability'; renderPanel(); }
      else patchOrder(unit, { ability: {} });
    }
  }

  // ---------- drawing of the planned orders (2D) ----------
  function arrowHead(ctx, from, to, size) {
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - size * Math.cos(ang - 0.45), to.y - size * Math.sin(ang - 0.45));
    ctx.lineTo(to.x - size * Math.cos(ang + 0.45), to.y - size * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
  }

  function draw(ctx) {
    if (!isSim() || st.playback || gameState.phase !== 'battle') return;
    const color = getPlayerColor(myId);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const order of plannedOrders()) {
      const u = myUnit(order.unitId);
      if (!u) continue;
      const p0 = hexToPixel(u.q, u.r);
      const selected = selectedUnit && selectedUnit.id === u.id;
      ctx.globalAlpha = selected ? 1 : 0.8;
      if (order.type === 'attack' && order.path && order.target) {
        const pts = order.path.map(([q, r]) => hexToPixel(q, r));
        ctx.strokeStyle = color; ctx.lineWidth = selected ? 4 : 3;
        ctx.setLineDash(st.committed ? [] : [10, 7]);
        ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
        const pe = pts[pts.length - 1], p1 = hexToPixel(order.target.q, order.target.r);
        ctx.strokeStyle = '#D8352A'; ctx.fillStyle = '#D8352A'; ctx.lineWidth = 3.5; ctx.setLineDash([3, 8]);
        ctx.beginPath(); ctx.moveTo(pe.x, pe.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        ctx.setLineDash([]);
        arrowHead(ctx, pe, p1, 15);
      } else if (order.type === 'move' && order.path) {
        const pts = [p0, ...order.path.map(([q, r]) => hexToPixel(q, r))];
        ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = selected ? 5 : 3.5;
        ctx.setLineDash(st.committed ? [] : [10, 7]);
        ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
        ctx.setLineDash([]);
        arrowHead(ctx, pts[pts.length - 2], pts[pts.length - 1], 14);
      } else if ((order.type === 'attack' || order.type === 'charge') && order.target) {
        const p1 = hexToPixel(order.target.q, order.target.r);
        const ranged = (u.range || 1) > 1;
        ctx.strokeStyle = '#D8352A';
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = order.type === 'charge' ? 6 : 3.5;
        ctx.setLineDash(ranged ? [3, 8] : []);
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        ctx.setLineDash([]);
        arrowHead(ctx, p0, p1, order.type === 'charge' ? 20 : 15);
      } else if (order.type === 'motivate') {
        ctx.strokeStyle = '#000'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(p0.x, p0.y, HEX_SIZE * 0.95, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#6f9bf0'; ctx.lineWidth = 3; ctx.stroke();
      }
      const tags = [];
      if (order.type === 'hold') tags.push('Tenir');
      if (order.stance) tags.push(stanceNames[order.stance] || order.stance);
      if (order.ability) tags.push('Capacité');
      if (order.facing != null) {
        const a = FACING_ANGLES[order.facing];
        ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#ffffff'; ctx.lineWidth = 2.5;
        const end = { x: p0.x + Math.cos(a) * HEX_SIZE * 0.95, y: p0.y + Math.sin(a) * HEX_SIZE * 0.95 };
        const mid = { x: p0.x + Math.cos(a) * HEX_SIZE * 0.55, y: p0.y + Math.sin(a) * HEX_SIZE * 0.55 };
        ctx.beginPath(); ctx.moveTo(mid.x, mid.y); ctx.lineTo(end.x, end.y); ctx.stroke();
        arrowHead(ctx, mid, end, 8);
      }
      if (tags.length) {
        ctx.globalAlpha = 1;
        ctx.font = `900 ${Math.round(HEX_SIZE * 0.32)}px 'Zen Kaku Gothic New', sans-serif`;
        ctx.textAlign = 'center';
        const text = tags.join(' · ');
        const w = ctx.measureText(text).width + 8;
        ctx.fillStyle = '#000';
        ctx.fillRect(p0.x - w / 2, p0.y + HEX_SIZE * 0.55, w, HEX_SIZE * 0.42);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, p0.x, p0.y + HEX_SIZE * 0.88);
      }
    }
    // hover preview of a move
    if (selectedUnit && hoveredHex && canPlan() && movableTiles.has(`${hoveredHex.q},${hoveredHex.r}`)) {
      const sel = myUnit(selectedUnit.id);
      const pv = sel && pathTo(sel, hoveredHex.q, hoveredHex.r);
      if (pv) {
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.setLineDash([4, 6]);
        ctx.beginPath(); pv.path.forEach(([q, r], i) => { const p = hexToPixel(q, r); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (selectedUnit && hoveredHex && canPlan()) {
      // hover preview of an attack: approach (melee follows the target, shooters walk to their firing position)
      const sel = myUnit(selectedUnit.id);
      const tgt = (gameState.units || []).find(u => !u.isMine && !u.isAlly && u.q === hoveredHex.q && u.r === hoveredHex.r);
      const a = sel && tgt && approachTo(sel, tgt);
      if (a && a.path.length > 1) {
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.setLineDash([4, 6]);
        ctx.beginPath(); a.path.forEach(([q, r], i) => { const p = hexToPixel(q, r); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  // Orders as data, for the 3D view: [{ unitId, type, path: [[q, r]...] (origin included), target: { id, q, r } | null, stance, facing, ability }]
  function plannedOrders() {
    if (!isSim()) return [];
    const out = [];
    for (const [unitId, o] of Object.entries(st.orders)) {
      const u = myUnit(unitId);
      if (!u) continue;
      const t = o.targetId ? anyUnit(o.targetId) : null;
      out.push({ unitId, type: o.type, path: o.path ? [[u.q, u.r], ...o.path] : null, target: t ? { id: t.id, q: t.q, r: t.r } : null, stance: o.stance || null, facing: o.facing != null ? o.facing : null, ability: o.ability || null, ranged: (u.range || 1) > 1 });
    }
    return out;
  }

  function planning() {
    if (!isSim()) return null;
    return { turn: gameState.turn, endsAt: st.endsAt, startsAt: st.startsAt, commandPoints: { ...st.cp }, committed: st.committed, committedIds: st.committedIds.slice(), canPlan: canPlan(), tool: st.tool };
  }

  // ---------- state sync ----------
  function applyPlanning(pl) {
    if (!pl) return;
    st.turn = pl.turn;
    st.endsAt = pl.endsAt;
    st.startsAt = pl.startsAt;
    if (pl.myOrders) st.orders = pl.myOrders;
    if (pl.commandPoints) st.cp = pl.commandPoints;
    if (pl.myCommitted != null) st.committed = pl.myCommitted;
    st.committedIds = st.lastStatus && st.lastStatus.turn === pl.turn ? st.lastStatus.committed : (pl.committed || []);
  }

  function onState(data) {
    if (st.hourHeldForTurn != null && (data.turn > st.hourHeldForTurn || data.phase !== 'battle')) { st.hourHeldForTurn = null; setHour(null); }
    if (!isSim()) { const bar = document.getElementById('sim-bar'); if (bar) bar.style.display = 'none'; return; }
    applyPlanning(data.planning);
    const p = me();
    document.getElementById('top-current-player').textContent = data.phase !== 'battle' ? '' : isSpectator ? 'Planification des généraux' : p && p.isEliminated ? 'Éliminé' : st.committed ? 'Ordres prêts — en attente des autres' : '✍ Donnez vos ordres';
    document.getElementById('sidebar-title').textContent = isSpectator ? 'Spectateur' : `Tour ${data.turn} · ordres secrets`;
    document.getElementById('top-turn').textContent = `Tour ${data.turn}${data.settings?.maxTurns ? '/' + data.settings.maxTurns : ''} · Simultané`;
    document.getElementById('turn-order-panel').style.display = 'none';
    if (selectedUnit) {
      const u = myUnit(selectedUnit.id);
      selectedUnit = u || null;
      computeTiles(selectedUnit);
      if (!u) showUnitDetail(null);
    }
    renderBar();
    renderPanel();
    render();
    const replaying = st.playback || (data.planning && data.planning.playbackEndsAt && data.planning.playbackEndsAt > Date.now() && data.planning.turn > 1);
    if (data.phase === 'battle' && st.popupTurn !== data.turn && !replaying && !isSpectator && p && !p.isEliminated) {
      st.popupTurn = data.turn;
      showTurnPopup(`Tour ${data.turn}`, 'Donnez vos ordres', p.color || '#ffd700');
    }
  }

  function onOrders(data) {
    st.orders = data.orders || {};
    st.cp = data.commandPoints || st.cp;
    st.committed = !!data.committed;
    if (selectedUnit) computeTiles(myUnit(selectedUnit.id));
    renderBar(); renderPanel(); render();
  }

  function onCommitStatus(data) {
    st.lastStatus = { turn: data.turn, committed: data.committed || [] };
    if (gameState && data.turn === gameState.turn) {
      st.committedIds = st.lastStatus.committed;
      const mine = st.committedIds.includes(myId);
      if (mine !== st.committed) {
        st.committed = mine;
        if (mine) { selectedUnit = null; clearTiles(); showUnitDetail(null); }
        else if (selectedUnit) computeTiles(myUnit(selectedUnit.id));
      }
      document.getElementById('top-current-player').textContent = isSpectator ? 'Planification des généraux' : st.committed ? 'Ordres prêts — en attente des autres' : '✍ Donnez vos ordres';
    }
    renderBar(); renderPanel(); render();
  }

  // ---------- playback ----------
  function tickDuration(tk) {
    return S.playback.tickMs + (tk.events.some(e => e.k === 'combat') ? S.playback.combatMs : 0);
  }

  // The hour flows through the resolution, from this turn's hour to the next one (see displayHour in game.js)
  function setHour(h) { if (window.gameBridge && window.gameBridge.setHourOverride) window.gameBridge.setHourOverride(h); }
  function playbackHour(pb, k) {
    const t0 = pb.restore && pb.restore.timeOfDay, hpt = pb.restore && pb.restore.hoursPerTurn;
    return t0 == null || !hpt ? null : (t0 + hpt * Math.min(1, Math.max(0, k))) % 24;
  }
  // Continuous flow over the whole playback (real time), so the clock and the sun never step from tick to tick
  function playbackFlow(pb, elapsedMs) {
    const t0 = pb.restore && pb.restore.timeOfDay, hpt = pb.restore && pb.restore.hoursPerTurn;
    if (t0 == null || !hpt) return null;
    const total = pb.data.ticks.reduce((a, tk) => a + tickDuration(tk), 0) || 1;
    return { from: t0, span: hpt, start: performance.now() - Math.min(total, elapsedMs), dur: total };
  }

  function startPlayback(data) {
    if (!gameState) return;
    if (st.playback) finishPlayback(true);
    const prev = new Map((gameState.units || []).map(u => [u.id, u]));
    const units = (data.start && data.start.units ? data.start.units : gameState.units).map(su => ({ ...(prev.get(su.id) || {}), ...su, isMine: su.playerId === myId }));
    const restore = gameState;
    gameState = { ...gameState, units };
    selectedUnit = null; clearTiles(); showUnitDetail(null);
    st.tool = null;
    st.playback = { data, restore, deferred: [], index: 0, timer: null, killTimers: [] };
    document.getElementById('top-current-player').textContent = `Résolution du tour ${data.turn}`;
    renderBar(); renderPanel();
    // every hex where something happens during the resolution (moves from/to, combats weigh more), for the camera
    const hexes = [];
    for (const tk of data.ticks) for (const e of tk.events) {
      if ((e.k === 'move' || e.k === 'flee') && e.from && e.to) hexes.push([e.from[0], e.from[1], 1], [e.to[0], e.to[1], 1]);
      else if (e.k === 'combat' && e.log) for (const id of [e.log.attackerId, e.log.targetId]) { const u = id && units.find(x => x.id === id); if (u && u.q != null) hexes.push([u.q, u.r, 3]); }
      else if (e.k === 'ambush' && e.q != null) hexes.push([e.q, e.r, 3]);
    }
    emitLocal('playback_start', { turn: data.turn, ticks: data.ticks.length, seed: data.seed, hexes });
    // reconnection: jump over the ticks already played
    let skip = data.elapsedMs || 0;
    while (st.playback.index < data.ticks.length && skip >= tickDuration(data.ticks[st.playback.index])) {
      skip -= tickDuration(data.ticks[st.playback.index]);
      applyTick(data.ticks[st.playback.index], false);
      st.playback.index++;
    }
    setHour(playbackFlow(st.playback, (data.elapsedMs || 0) - skip));
    render();
    nextTick();
  }

  function nextTick() {
    const pb = st.playback;
    if (!pb) return;
    // a slow-motion shot is running: the timeline waits for it
    if (window.view3d && window.view3d.active && window.view3d.cinematicBusy) { pb.timer = setTimeout(nextTick, 150); return; }
    if (pb.index >= pb.data.ticks.length) { pb.timer = setTimeout(() => finishPlayback(false), 400); return; }
    const tk = pb.data.ticks[pb.index++];
    emitLocal('playback_tick', { turn: pb.data.turn, t: tk.t, index: pb.index - 1 });
    applyTick(tk, true);
    pb.timer = setTimeout(nextTick, tickDuration(tk));
  }

  function removeUnit(id) {
    gameState.units = gameState.units.filter(u => u.id !== id);
  }

  function applyTick(tk, animate) {
    const now = performance.now();
    let moved = false;
    for (const e of tk.events) {
      const u = e.u ? anyUnit(e.u) : null;
      switch (e.k) {
        case 'move': case 'flee': {
          if (!u) break;
          if (animate) {
            unitAnimations[u.id] = { path: [e.to], fromQ: e.from[0], fromR: e.from[1], startTime: now };
            emitLocal('unit_move_anim', { unitId: u.id, fromQ: e.from[0], fromR: e.from[1], path: [e.to], playback: true });
            moved = true;
          }
          u.q = e.to[0]; u.r = e.to[1];
          if (e.f != null) u.facing = e.f;
          break;
        }
        case 'appear':
          if (!u && e.unit) gameState.units.push({ ...e.unit, q: e.at[0], r: e.at[1], isMine: e.unit.playerId === myId });
          else if (u) { u.q = e.at[0]; u.r = e.at[1]; }
          break;
        case 'vanish': case 'fled':
          if (e.k === 'fled' && animate && u) notify(`${u.name} a fui le champ de bataille.`, 'info');
          removeUnit(e.u);
          break;
        case 'stance': if (u) u.stance = e.s; break;
        case 'facing': if (u) u.facing = e.f; break;
        case 'ability': {
          const log = { abilityUsed: e.name, playerId: e.playerId, targetPlayerId: e.targetPlayerId, effects: e.effects || [] };
          if (animate) { showCombatResult(log); addCombatLog(log); emitLocal('combat_result', { combatLog: log, playback: true, kind: 'ability' }); }
          break;
        }
        case 'motivate':
          if (animate && u) notify(e.success ? `${u.name} motive ses troupes (${e.count} unité(s)).` : `${u.name} ne parvient pas à motiver ses troupes.`, e.success ? 'success' : 'info');
          break;
        case 'ambush':
          if (animate) {
            const mine = e.byPlayerId === myId;
            notify(mine ? 'Embuscade ! Une de vos unités cachées a surpris l\'ennemi.' : 'Embuscade ! Votre unité est tombée sur un ennemi caché.', mine ? 'success' : 'error');
            activePings.push({ q: e.q, r: e.r, color: '#ff4020', startTime: performance.now() });
            emitLocal('ambush', { unitId: e.u, playerId: e.playerId, byUnitId: e.by, byPlayerId: e.byPlayerId, q: e.q, r: e.r, playback: true });
          }
          break;
        case 'combat': applyCombat(e, animate); break;
        case 'shot_lost':
          if (animate && u) notify(`${u.name} : tir perdu, la cible n'est jamais passée à portée.`, 'info');
          break;
        default: break;
      }
    }
    if (moved) startAnimLoop();
    render();
  }

  function applyCombat(e, animate) {
    const log = e.log;
    const att = log.attackerId ? anyUnit(log.attackerId) : null;
    const tgt = log.targetId ? anyUnit(log.targetId) : null;
    if (tgt) {
      if (log.targetVitalityLeft != null) tgt.vitality = log.targetVitalityLeft;
      if (log.targetMoraleLeft != null) { tgt.morale = log.targetMoraleLeft; if (tgt.morale <= 0 && !tgt.isGeneral) tgt.isFleeing = true; }
    }
    if (att && log.attackerVitalityLeft != null) att.vitality = log.attackerVitalityLeft;
    if (animate) {
      if (e.charge === 'bonus') notify(`Charge de ${log.attackerName} !`, 'info');
      else if (e.charge === 'stopped') notify(`La charge de ${log.attackerName} se brise sur les lances !`, 'info');
      showCombatResult(log);
      addCombatLog(log);
      addCombatHistory(log, st.playback ? st.playback.data.turn : gameState.turn);
      emitLocal('combat_result', { combatLog: log, playback: true, kind: e.kind });
    }
    // the dead leave the board after the blow has been staged (the 3D view looks them up when the event fires)
    const dead = [];
    if (log.targetKilled && log.targetId) dead.push(log.targetId);
    if (log.attackerKilled && log.attackerId) dead.push(log.attackerId);
    if (!dead.length) return;
    if (!animate) { dead.forEach(removeUnit); return; }
    const pb = st.playback;
    const t = setTimeout(() => { dead.forEach(removeUnit); render(); }, Math.min(S.playback.combatMs, 1000));
    if (pb) pb.killTimers.push({ t, dead });
  }

  function skipPlayback() {
    const pb = st.playback;
    if (!pb) return;
    clearTimeout(pb.timer);
    finishPlayback(true);
  }

  function finishPlayback(skipped) {
    const pb = st.playback;
    if (!pb) return;
    clearTimeout(pb.timer);
    for (const k of pb.killTimers) clearTimeout(k.t);
    st.playback = null;
    setHour(playbackHour(pb, 1));
    st.hourHeldForTurn = pb.data.turn;
    gameState = pb.restore;
    for (const id of Object.keys(unitAnimations)) delete unitAnimations[id];
    emitLocal('playback_end', { turn: pb.data.turn, skipped: !!skipped });
    const queue = pb.deferred;
    for (const [event, data] of queue) wsDispatch(event, data);
    if (!queue.some(([ev]) => ev === 'game_state') && gameState) onState(gameState);
    render();
  }

  // ---------- ws events ----------
  function intercept(event, data) {
    if (st.playback && DEFERRED.has(event)) { st.playback.deferred.push([event, data]); return true; }
    switch (event) {
      case 'resolution':
        emitLocal(event, data);
        startPlayback(data);
        return true;
      case 'planning_start':
        st.turn = data.turn; st.endsAt = data.endsAt; st.startsAt = data.startsAt;
        if (data.commandPoints) st.cp = { ...st.cp, max: data.commandPoints.max };
        emitLocal(event, data);
        renderBar();
        return true;
      case 'planning_timeout':
        notify('Temps de planification écoulé : les ordres donnés sont exécutés.', 'info');
        emitLocal(event, data);
        return true;
      case 'commit_status':
        emitLocal(event, data);
        onCommitStatus(data);
        return true;
      case 'orders_update':
        emitLocal(event, data);
        onOrders(data);
        return true;
      default:
        return false;
    }
  }

  setInterval(() => {
    const el = document.getElementById('sim-timer');
    if (!el) return;
    if (!isSim() || gameState.phase !== 'battle' || st.playback || !st.endsAt) { el.textContent = ''; return; }
    const now = Date.now();
    if (st.startsAt && now < st.startsAt) { el.textContent = `⏱ ${fmt(st.endsAt - st.startsAt)}`; return; }
    const left = st.endsAt - now;
    el.textContent = `⏱ ${fmt(left)}`;
    el.style.color = left <= 10000 ? '#ff6040' : '#c8960c';
    // deadlines are processed when a message reaches the server (lambda): nudge it when the timer runs out
    if (left < -1000 && now - st.tickSent > 5000) { st.tickSent = now; send('tick'); }
  }, 500);

  // where a planned stance change can happen: the start, every waypoint chosen for the path, the arrival
  function KBSimStanceSteps(unit) {
    const u = unit && myUnit(unit.id);
    const o = u && current(u);
    if (!o || !o.stance || !o.path || !o.path.length) return null;
    const out = [{ n: 0, label: 'au départ' }];
    const wps = st.wps[u.id] || [];
    wps.forEach(([q, r], i) => {
      const n = o.path.findIndex(([pq, pr]) => pq === q && pr === r) + 1;
      if (n > 0 && n < o.path.length) out.push({ n, label: `à l'étape ${i + 1}` });
    });
    out.push({ n: o.path.length, label: `à l'arrivée (${o.path.length} case${o.path.length > 1 ? 's' : ''})` });
    if (o.stanceAt && !out.some(x => x.n === o.stanceAt)) out.splice(1, 0, { n: o.stanceAt, label: `après ${o.stanceAt} case${o.stanceAt > 1 ? 's' : ''}` });
    return { value: o.stanceAt || 0, choices: out };
  }

  window.KBSim = {
    isSim,
    active: () => isSim() && gameState.phase === 'battle',
    intercept, onState, click, select, contextMenu, pathTo, marchPlan, approachTo, draw, refresh, routeInfo,
    routeWaypoints: () => routeWaypoints(selectedUnit),
    routePath: () => { const u = selectedUnit && myUnit(selectedUnit.id); return u ? simRoute(u) : null; },
    plannedOrders, planning,
    playbackInfo() {
      const pb = st.playback;
      return pb ? { turn: pb.data.turn, seed: pb.data.seed, tick: pb.index, ticks: pb.data.ticks.length, durationMs: pb.data.durationMs } : null;
    },
    skipPlayback,
    orderOf: (unit) => (unit ? current(unit) : null),
    setFacing(unit, f) {
      const u = unit && myUnit(unit.id);
      if (!u || !canPlan()) return;
      const o = current(u);
      const cur = o && o.facing != null ? o.facing : null;
      patchOrder(u, { facing: cur === f || (cur == null && f === u.facing) ? undefined : f });
    },
    setStance(unit, s) {
      const u = unit && myUnit(unit.id);
      if (!u || !canPlan()) return;
      patchOrder(u, { stance: s === u.stance ? undefined : s });
    },
    // where the planned stance change happens: 0 = at the start, n = after the n-th step of the path
    setStanceAt(unit, n) {
      const u = unit && myUnit(unit.id);
      if (!u || !canPlan()) return;
      patchOrder(u, { stanceAt: n > 0 ? n : undefined });
    },
    stanceSteps: (unit) => KBSimStanceSteps(unit),
  };
})();
