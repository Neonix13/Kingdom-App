import { createWorld } from './world.js';
import { createPathPreview } from './pathPreview.js';
import { createGameUI } from './gameUI.js';

const PLATE_CSS = `
#view3d-canvas { position:absolute; inset:0; width:100%; height:100%; display:block; z-index:1; outline:none; touch-action:none; }
#view3d-plates { position:absolute; inset:0; pointer-events:none; z-index:2; overflow:hidden; }
.u3-plate { position:absolute; left:0; top:0; display:flex; align-items:center; gap:3px;
  padding:1px 4px 1px 1px; border-radius:11px; background:rgba(14,9,4,0.72); border:1px solid rgba(200,150,40,0.4);
  pointer-events:auto; cursor:pointer; white-space:nowrap; font:600 10px 'Segoe UI',system-ui,sans-serif; color:#e8d5a0;
  will-change:transform; }
.u3-plate .u3-name { display:none; }
.u3-plate.sel .u3-name, .u3-plate.hov .u3-name, #view3d-plates.names .u3-name { display:block; }
.u3-plate.hov { z-index:5; border-color:#e8c060; }
.u3-plate.sel { z-index:6; }
.u3-plate.sel { border-color:#ffd700; box-shadow:0 0 6px rgba(255,215,0,.6); }
.u3-plate.enemy { border-color:rgba(160,160,220,0.5); }
.u3-plate.moved { opacity:.62; }
.u3-plate.fleeing { border-color:#ff6020; }
.u3-plate img.tok { width:17px; height:17px; border-radius:50%; object-fit:cover; border:2px solid var(--pc); }
.u3-plate img.st { width:13px; height:13px; opacity:.9; }
.u3-bars { display:flex; flex-direction:column; gap:2px; }
.u3-bar { width:30px; height:3px; background:#1a0a04; border-radius:2px; overflow:hidden; }
.u3-bar > i { display:block; height:100%; }
.u3-name { max-width:70px; overflow:hidden; text-overflow:ellipsis; }
#view3d-loading { position:absolute; inset:0; z-index:3; display:flex; flex-direction:column; align-items:center; justify-content:center;
  background:rgba(10,6,4,0.92); color:#d9bf78; font:12px 'Segoe UI',system-ui,sans-serif; letter-spacing:2px; transition:opacity .6s; }
#view3d-loading .bar { width:260px; height:2px; background:rgba(217,191,120,.15); margin-top:12px; }
#view3d-loading .bar i { display:block; height:100%; width:0; background:#d9bf78; transition:width .2s; }
`;

const hexKey = (q, r) => `${q},${r}`;
const hexDist = (q1, r1, q2, r2) => (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs(q1 + r1 - q2 - r2)) / 2;

export async function mountGameView(bridge, { container }) {
  const style = document.createElement('style');
  style.textContent = PLATE_CSS;
  document.head.appendChild(style);

  const canvas = document.createElement('canvas');
  canvas.id = 'view3d-canvas';
  canvas.tabIndex = 0;
  const plates = document.createElement('div');
  plates.id = 'view3d-plates';
  const loading = document.createElement('div');
  loading.id = 'view3d-loading';
  loading.innerHTML = '<div>CHARGEMENT DE LA VUE 3D</div><div class="bar"><i></i></div>';
  const ref = container.querySelector('#game-canvas');
  container.insertBefore(canvas, ref ? ref.nextSibling : null);
  container.insertBefore(plates, canvas.nextSibling);
  container.appendChild(loading);

  for (let i = 0; i < 100 && !bridge.mapLoading; i++) await new Promise((r) => setTimeout(r, 100));
  if (bridge.mapLoading) { try { await bridge.mapLoading; } catch (e) { /* default map below */ } }
  const mapDoc = bridge.mapDoc && bridge.mapDoc.height ? bridge.mapDoc : null;
  const world = await createWorld({
    map: mapDoc,
    canvas, container, persistKey: 'game3d', intro: false, hour: 15.5, mapId: window.KB_MAP_ID || 'default',
    onProgress: (pct) => { loading.querySelector('i').style.width = pct + '%'; },
  });
  const { THREE } = world;
  world.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  world.controls.screenSpacePanning = false;
  world.controls.panSpeed = 1.2;
  world.setGrid(0.16);

  let units3d = null;
  try {
    const mod = await import('./units3d.js');
    const KINGDOM_OF = { ou_ki: '秦', mou_bu: '秦', ou_sen: '秦', kan_ki: '秦', ri_boku: '趙', kei_sha: '趙', shi_ba_shou: '趙', ren_pa: '趙', go_kei: '魏', go_hou_mei: '魏', gai_mou: '魏' };
    units3d = mod.createUnitLayer(world, {
      getPlayerColor: (pid) => bridge.getPlayerColor(pid),
      getPlayerEmblem: (pid) => {
        const p = bridge.state?.players?.find((x) => x.id === pid);
        return (p && KINGDOM_OF[p.generalId]) || undefined;
      },
    });
  } catch (e) {
    console.warn('[3D] unit layer unavailable', e);
  }

  const preview = createPathPreview(world);
  let view = null;
  const ui = createGameUI({ world, container, bridge, getView: () => view });

  // --- Input: click vs drag, hover, context menu ---
  let down = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button };
    canvas.focus();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 450;
    const b = down.b;
    down = null;
    if (moved > 6 || !quick) return;
    const hex = world.pickHex(e.clientX, e.clientY);
    if (b === 0) bridge.click(hex);
    else if (b === 2) bridge.contextMenu(hex, e.clientX, e.clientY);
  });
  canvas.addEventListener('dblclick', (e) => {
    const hex = world.pickHex(e.clientX, e.clientY);
    if (hex) bridge.doubleClick(hex);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  let lastMove = null;
  canvas.addEventListener('pointermove', (e) => { lastMove = e; });
  canvas.addEventListener('pointerleave', () => { lastMove = null; hovered = null; bridge.hover(null); world.layers.setHover(null); preview.clear(); ui.showAttackTip(null); });
  let hovered = null;

  // --- Unit plates (HTML overlays following the formations) ---
  const plateEls = new Map();
  function tokenSrc(u) {
    if (u.isGeneral) {
      const gid = bridge.getGeneralIdForUnit(u);
      const img = gid ? bridge.generalTokenImages[gid] : null;
      return img && img.src ? img.src : '';
    }
    const img = u.typeId ? bridge.unitTokenImages[u.typeId] : null;
    return img && img.src ? img.src : '';
  }
  function plateFor(u) {
    let el = plateEls.get(u.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'u3-plate';
      el.innerHTML = '<img class="tok"><div class="u3-bars"><div class="u3-name"></div><div class="u3-bar hp"><i></i></div><div class="u3-bar mo"><i></i></div></div><img class="st">';
      el.addEventListener('click', (ev) => { ev.stopPropagation(); const cur = el._unit; if (cur && cur.q != null) bridge.click({ q: cur.q, r: cur.r }); });
      el.addEventListener('dblclick', (ev) => { ev.stopPropagation(); const cur = el._unit; if (cur && cur.q != null) bridge.doubleClick({ q: cur.q, r: cur.r }); });
      el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); const cur = el._unit; if (cur) bridge.contextMenu({ q: cur.q, r: cur.r }, ev.clientX, ev.clientY); });
      plates.appendChild(el);
      plateEls.set(u.id, el);
    }
    el._unit = u;
    const color = bridge.getPlayerColor(u.playerId);
    el.style.setProperty('--pc', color);
    const tok = el.querySelector('img.tok');
    const src = tokenSrc(u);
    if (src && tok.getAttribute('src') !== src) tok.setAttribute('src', src);
    tok.style.display = src ? '' : 'none';
    el.querySelector('.u3-name').textContent = u.name || '';
    const hp = Math.max(0, Math.min(1, (u.vitality ?? 1) / (u.maxVitality || 1)));
    const hpBar = el.querySelector('.hp > i');
    hpBar.style.width = (hp * 100).toFixed(0) + '%';
    hpBar.style.background = hp > 0.5 ? '#2a8c2a' : hp > 0.25 ? '#c8960c' : '#a02020';
    const moBar = el.querySelector('.mo');
    if (u.maxMorale) {
      moBar.style.display = '';
      moBar.firstChild.style.width = (Math.max(0, Math.min(1, u.morale / u.maxMorale)) * 100).toFixed(0) + '%';
      moBar.firstChild.style.background = '#3a78c8';
    } else moBar.style.display = 'none';
    const st = el.querySelector('img.st');
    const icon = u.stance && !u.isGeneral ? bridge.stanceIcons[u.stance] : null;
    if (icon && icon.src) { st.src = icon.src; st.style.display = ''; } else st.style.display = 'none';
    el.classList.toggle('enemy', !u.isMine);
    el.classList.toggle('moved', !!(u.hasMoved && u.isMine));
    el.classList.toggle('fleeing', !!u.isFleeing);
    return el;
  }

  // --- State sync ---
  let dirty = true;
  let shownUnits = [];
  function currentUnits() {
    const st = bridge.state;
    if (st && st.units && st.phase === 'battle') return st.units;
    const ds = bridge.deployState;
    if (ds && ds.units) return ds.units.map((u) => ({ ...u, isMine: true, playerId: bridge.myId }));
    return st?.units || [];
  }
  function syncNow() {
    dirty = false;
    ui.applyHour();
    const st = bridge.state;
    const ds = bridge.deployState;
    const inBattle = !!(st && st.phase === 'battle');
    const visible = inBattle ? st.visibleHexes : null;
    world.layers.setVisibility(visible ? new Set(visible) : null);

    const fills = [], outlines = [];
    if (!inBattle && ds && ds.startingZone && bridge.mode === 'deploy') {
      const z = ds.startingZone;
      const keys = z.tileSet || new Set();
      if (!keys.size) for (const k of world.allHexes.keys()) { const [q, r] = k.split(',').map(Number); if (hexDist(q, r, z.q, z.r) <= (z.radius || 4)) keys.add(k); }
      fills.push({ keys, color: 'rgba(60,170,40,0.28)', edge: 'rgba(120,230,80,0.85)' });
    }
    fills.push({ keys: bridge.movableTiles, color: 'rgba(60,170,40,0.42)', edge: 'rgba(150,255,100,0.9)' });
    fills.push({ keys: bridge.attackableTiles, color: 'rgba(200,40,20,0.5)', edge: 'rgba(255,120,80,0.95)' });
    const sel = bridge.selectedUnit;
    if (sel && sel.q != null) fills.push({ keys: new Set([hexKey(sel.q, sel.r)]), color: 'rgba(255,210,60,0.32)' });
    const rc = bridge.rangeCenter, mc = bridge.motivateCenter;
    if (rc) outlines.push({ keys: bridge.rangeTiles, center: hexKey(rc.q, rc.r), color: 'rgba(255,220,0,0.95)', width: 0.12 });
    if (mc) outlines.push({ keys: bridge.motivateTiles, center: hexKey(mc.q, mc.r), color: 'rgba(80,180,255,0.95)', width: 0.12 });
    world.layers.setOverlay({ fills, outlines });

    shownUnits = currentUnits().filter((u) => u.q != null);
    if (units3d) {
      units3d.sync(shownUnits);
      units3d.setSelected(sel ? sel.id : null);
    }
    const alive = new Set();
    for (const u of shownUnits) { plateFor(u); alive.add(u.id); }
    for (const [id, el] of plateEls) if (!alive.has(id)) { el.remove(); plateEls.delete(id); }
    for (const el of plateEls.values()) el.classList.toggle('sel', !!(sel && el._unit.id === sel.id));
  }

  // --- Move animations (driven by game.js unitAnimations) ---
  const animating = new Set();
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  function animatedPos(u) {
    const a = bridge.unitAnimations[u.id];
    if (!a) return null;
    const stepF = (performance.now() - a.startTime) / bridge.ANIM_STEP_MS;
    const step = Math.floor(stepF);
    if (step >= a.path.length) return null;
    const from = step === 0 ? [a.fromQ, a.fromR] : a.path[step - 1];
    const to = a.path[step];
    const p0 = world.hexToWorld(from[0], from[1]), p1 = world.hexToWorld(to[0], to[1]);
    const k = stepF - step;
    return { x: p0.x + (p1.x - p0.x) * k, z: p0.z + (p1.z - p0.z) * k, heading: Math.atan2(p1.x - p0.x, p1.z - p0.z) };
  }

  const _v = new THREE.Vector3();
  function anchorOf(u) {
    if (units3d) {
      const a = units3d.getAnchor(u.id);
      if (a) return a;
    }
    const ap = animatedPos(u);
    const p = ap || world.hexToWorld(u.q, u.r);
    return _v.set(p.x, world.groundHeight(p.x, p.z) + 0.7, p.z);
  }

  function frame(dt = 0.016) {
    if (!view.active) return;
    if (dirty) syncNow();
    if (lastMove) {
      const e = lastMove;
      lastMove = null;
      const pt = world.pickPoint(e.clientX, e.clientY);
      const hex = pt ? world.worldToHex(pt.x, pt.z) : null;
      const valid = hex && world.allHexes.has(hexKey(hex.q, hex.r)) ? hex : null;
      const key = valid ? hexKey(valid.q, valid.r) : null;
      if (key !== (hovered && hexKey(hovered.q, hovered.r))) {
        hovered = valid;
        const sel = bridge.selectedUnit;
        const attackable = key && bridge.attackableTiles.has(key);
        const movable = key && bridge.movableTiles.has(key);
        world.layers.setHover(valid, attackable ? '#ff6040' : movable ? '#a0ff70' : '#ffd25a');
        const hu = valid && shownUnits.find((x) => x.q === valid.q && x.r === valid.r);
        if (units3d) units3d.setHovered(hu ? hu.id : null);
        for (const el of plateEls.values()) el.classList.toggle('hov', !!(hu && el._unit.id === hu.id));
        if (sel && movable) {
          const res = bridge.pathTo(sel, valid.q, valid.r);
          preview.showPath(res ? [[sel.q, sel.r], ...res.path.slice(1)] : null);
        } else preview.showPath(null);
        if (sel && attackable && hu) {
          preview.showAttack(anchorOf(sel).clone().setY(anchorOf(sel).y - 0.35), anchorOf(hu).clone().setY(anchorOf(hu).y - 0.35), (sel.range || 1) > 1);
        } else preview.showAttack(null, null);
      }
      const sel = bridge.selectedUnit;
      const hu = valid && shownUnits.find((x) => x.q === valid.q && x.r === valid.r);
      if (sel && hu && key && bridge.attackableTiles.has(key)) ui.showAttackTip(sel, hu, e);
      else ui.showAttackTip(null);
      // Segment tooltip when hovering close to a hex edge (terrain overlay mode)
      let segShown = false;
      if (bridge.showTerrain && valid && pt) {
        const c = world.hexToWorld(valid.q, valid.r);
        const ang = Math.atan2(pt.z - c.z, pt.x - c.x);
        const r = Math.hypot(pt.x - c.x, pt.z - c.z);
        if (r > 0.62) {
          const DIRS6 = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
          const edge = ((Math.floor(((ang < 0 ? ang + Math.PI * 2 : ang)) / (Math.PI / 3)) % 6) + 6) % 6;
          const [dq, dr] = DIRS6[edge];
          const seg = bridge.segmentAt(valid.q, valid.r, valid.q + dq, valid.r + dr);
          if (seg) { bridge.segmentTooltip(seg, e); segShown = true; }
        }
      }
      if (!segShown) bridge.hover(valid, e);
    }
    if (units3d) {
      for (const u of shownUnits) {
        const ap = animatedPos(u);
        if (ap) {
          units3d.setDisplayPosition(u.id, ap.x, ap.z, ap.heading);
          if (!animating.has(u.id)) { animating.add(u.id); units3d.setMoving(u.id, true); }
        } else if (animating.has(u.id)) {
          animating.delete(u.id);
          units3d.clearDisplayPosition(u.id);
          units3d.setMoving(u.id, false);
        }
      }
    }
    ui.update(dt);
    preview.update(dt);
    const camDist = world.camera.position.distanceTo(world.controls.target);
    const pm = ui.platesMode();
    const showPlates = !ui.photo && (pm === 'always' || (pm === 'auto' && camDist < 48));
    plates.classList.toggle('names', camDist < 14);
    plates.style.display = showPlates ? '' : 'none';
    if (showPlates) {
      for (const el of plateEls.values()) {
        const u = el._unit;
        const s = world.projectToScreen(anchorOf(u));
        if (!s.visible) { el.style.display = 'none'; continue; }
        el.style.display = '';
        el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
      }
    }
  }
  world.frameHooks.push(frame);

  view = {
    active: false,
    world,
    markDirty() { dirty = true; },
    focusHex(q, r) { world.focusHex(q, r, 0.9); },
    onEvent(event, data) {
      if (!view.active) return;
      if (event === 'combat_result') {
        const log = data.combatLog || data;
        if (log && log.attackerId != null && log.targetId != null) {
          const att = shownUnits.find((u) => u.id === log.attackerId);
          const tgt = shownUnits.find((u) => u.id === log.targetId);
          let impact = log.ranged ? 0.9 : 0.45;
          if (units3d) {
            const r = units3d.playAttack(log.attackerId, log.targetId, { ranged: !!log.ranged });
            if (typeof r === 'number') impact = r;
            units3d.playHit(log.targetId, { delay: impact });
          }
          if (att && tgt && ui.staging()) {
            const a = anchorOf(att).clone(), b = anchorOf(tgt).clone();
            const mid = a.clone().lerp(b, 0.5);
            mid.y = world.groundHeight(mid.x, mid.z);
            const off = world.camera.position.clone().sub(world.controls.target);
            if (off.length() > 22) off.setLength(22);
            world.flyTo(mid.clone().add(off), mid, 0.8);
          }
          if (tgt) {
            const tA = anchorOf(tgt).clone();
            if (log.hit === false) ui.floatText(tA, 'Raté', 'miss', impact);
            else if (log.dmgReceived != null) ui.floatText(tA, `-${log.dmgReceived}`, '', impact);
            if (log.moralDmg) ui.floatText(tA.clone().setY(tA.y - 0.25), `-${log.moralDmg} moral`, 'morale', impact + 0.25);
            if (log.targetKilled) ui.floatText(tA.clone().setY(tA.y + 0.3), 'Détruite !', 'kill', impact + 0.5);
          }
          if (att && log.counterDmgReceived) ui.floatText(anchorOf(att).clone(), `-${log.counterDmgReceived}`, '', impact + 0.6);
        }
      } else if (event === 'ping') {
        world.layers.addPing(data.q, data.r, data.color || '#ffd700');
      }
      dirty = true;
    },
    setActive(on) {
      view.active = on;
      ui.hide(!on);
      canvas.style.display = on ? '' : 'none';
      plates.style.display = on ? '' : 'none';
      world.setRunning(on);
      if (on) { world.resize(); dirty = true; }
    },
  };
  window.addEventListener('resize', () => { if (view.active) world.resize(); });
  world.start();
  loading.style.opacity = '0';
  setTimeout(() => loading.remove(), 700);

  const focusStart = () => {
    const st = bridge.state, ds = bridge.deployState;
    const mine = (st?.units || []).find((u) => u.isMine && u.isGeneral && u.q != null) || (st?.units || []).find((u) => u.isMine && u.q != null);
    if (mine) return world.focusHex(mine.q, mine.r, 0.01);
    if (ds?.startingZone) return world.focusHex(ds.startingZone.q, ds.startingZone.r, 0.01);
  };
  focusStart();
  return view;
}
