import { createWorld } from './world.js';
import { createPathPreview, createOrdersLayer } from './pathPreview.js';
import { createMapEditsLayer } from './mapEdits3d.js';
import { createGameUI } from './gameUI.js';
import { KANJI } from '../hud/battleHud.js';

const PLATE_CSS = `
#view3d-canvas { position:absolute; inset:0; width:100%; height:100%; display:block; z-index:1; outline:none; touch-action:none; }
#view3d-plates { position:absolute; inset:0; pointer-events:none; z-index:2; overflow:hidden; }
.u3-plate { position:absolute; left:0; top:0; display:flex; align-items:center; gap:4px; padding:1px 5px 1px 0;
  background:#000; border:2px solid #fff; box-shadow:0 0 0 1.5px #000, 2px 2px 0 1.5px rgba(0,0,0,.45);
  pointer-events:auto; cursor:pointer; white-space:nowrap; font:900 10px 'Zen Kaku Gothic New','Segoe UI',system-ui,sans-serif; color:#fff;
  will-change:transform; }
.u3-plate .k { display:flex; align-items:center; justify-content:center; width:21px; height:21px; margin-left:-1px; background:var(--pc); color:#fff;
  font:400 15px 'Yuji Boku','Zen Old Mincho',serif; line-height:1; text-shadow:0 0 2px #000, 0 0 1px #000; }
.u3-plate .u3-name { display:none; }
.u3-plate.sel .u3-name, .u3-plate.hov .u3-name, #view3d-plates.names .u3-name { display:block; }
.u3-plate.hov { z-index:5; background:#222; }
.u3-plate.sel { z-index:6; border-color:#D8352A; box-shadow:0 0 0 1.5px #000, 0 0 0 4px #D8352A; }
.u3-plate.moved { opacity:.6; }
.u3-plate.fleeing { border-color:#D8352A; animation:u3-flee .8s steps(2) infinite; }
@keyframes u3-flee { 50% { border-color:#fff; } }
.u3-plate.concealed { border-style:dashed; }
.u3-plate.concealed::after, .u3-plate.stunned::after { font:400 12px 'Yuji Boku','Zen Old Mincho',serif; margin-left:1px; }
.u3-plate.concealed::after { content:'伏'; color:#9fd09a; }
.u3-plate.stunned::after { content:'暈'; color:#ffcf40; }
.u3-plate img.st { width:13px; height:13px; filter:brightness(0) invert(1); opacity:.95; }
.u3-bars { display:flex; flex-direction:column; gap:2px; }
.u3-bar { width:32px; height:4px; background:#444; overflow:hidden; }
.u3-bar.mo { height:2px; }
.u3-bar > i { display:block; height:100%; }
.u3-name { max-width:78px; overflow:hidden; text-overflow:ellipsis; line-height:1.1; }
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
  const ordersLayer = createOrdersLayer(world);
  const editsLayer = createMapEditsLayer(world);
  const baseMap = () => (bridge.mapDoc ? { seg: bridge.mapDoc.segments || {}, ter: bridge.mapDoc.terrain || {} } : { seg: {}, ter: {} });
  editsLayer.update(bridge.mapEdits, baseMap().seg, baseMap().ter);
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
  function plateFor(u) {
    let el = plateEls.get(u.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'u3-plate';
      el.innerHTML = '<b class="k"></b><div class="u3-bars"><div class="u3-name"></div><div class="u3-bar hp"><i></i></div><div class="u3-bar mo"><i></i></div></div><img class="st">';
      el.addEventListener('click', (ev) => { ev.stopPropagation(); const cur = el._unit; if (cur && cur.q != null) bridge.click({ q: cur.q, r: cur.r }); });
      el.addEventListener('dblclick', (ev) => { ev.stopPropagation(); const cur = el._unit; if (cur && cur.q != null) bridge.doubleClick({ q: cur.q, r: cur.r }); });
      el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); const cur = el._unit; if (cur) bridge.contextMenu({ q: cur.q, r: cur.r }, ev.clientX, ev.clientY); });
      plates.appendChild(el);
      plateEls.set(u.id, el);
    }
    el._unit = u;
    const color = bridge.getPlayerColor(u.playerId);
    el.style.setProperty('--pc', color);
    const kj = u.isGeneral ? '将' : (KANJI[u.typeId] || '兵');
    const kEl = el.firstChild;
    if (kEl.textContent !== kj) kEl.textContent = kj;
    el.querySelector('.u3-name').textContent = u.name || '';
    const hp = Math.max(0, Math.min(1, (u.vitality ?? 1) / (u.maxVitality || 1)));
    const hpBar = el.querySelector('.hp > i');
    hpBar.style.width = (hp * 100).toFixed(0) + '%';
    hpBar.style.background = hp > 0.35 ? '#fff' : '#D8352A';
    const moBar = el.querySelector('.mo');
    if (u.maxMorale) {
      moBar.style.display = '';
      moBar.firstChild.style.width = (Math.max(0, Math.min(1, u.morale / u.maxMorale)) * 100).toFixed(0) + '%';
      moBar.firstChild.style.background = '#9db4d8';
    } else moBar.style.display = 'none';
    const st = el.querySelector('img.st');
    const icon = u.stance && !u.isGeneral ? bridge.stanceIcons[u.stance] : null;
    if (icon && icon.src) { st.src = icon.src; st.style.display = ''; } else st.style.display = 'none';
    el.classList.toggle('enemy', !u.isMine);
    el.classList.toggle('moved', !!(u.hasMoved && u.isMine));
    el.classList.toggle('fleeing', !!u.isFleeing);
    el.classList.toggle('concealed', !!u.concealed);
    el.classList.toggle('stunned', !!u.stunned);
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
    preview.clear();
    ui.showAttackTip(null);
    hovered = null;
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
      fills.push({ keys, color: 'rgba(70,190,50,0.38)', edge: 'rgba(140,255,90,0.95)' });
      outlines.push({ keys, center: null, color: 'rgba(170,255,110,0.95)', width: 0.14 });
    }
    fills.push({ keys: bridge.movableTiles, color: 'rgba(60,170,40,0.42)', edge: 'rgba(150,255,100,0.9)' });
    if (bridge.abilityTiles && bridge.abilityTiles.size) fills.push({ keys: new Set(bridge.abilityTiles.keys()), color: 'rgba(40,110,200,0.5)', edge: 'rgba(120,190,255,0.95)' });
    fills.push({ keys: bridge.attackableTiles, color: 'rgba(200,40,20,0.5)', edge: 'rgba(255,120,80,0.95)' });
    if (bridge.approachAt) {
      const approach = new Set([...bridge.attackableTiles].filter((k) => bridge.approachAt(k)));
      if (approach.size) fills.push({ keys: approach, color: 'rgba(230,120,20,0.5)', edge: 'rgba(255,190,90,0.95)' });
    }
    const sel = bridge.selectedUnit;
    if (sel && sel.q != null) fills.push({ keys: new Set([hexKey(sel.q, sel.r)]), color: 'rgba(255,210,60,0.32)' });
    const rc = bridge.rangeCenter, mc = bridge.motivateCenter;
    if (rc) outlines.push({ keys: bridge.rangeTiles, center: hexKey(rc.q, rc.r), color: 'rgba(255,220,0,0.95)', width: 0.12 });
    if (mc) outlines.push({ keys: bridge.motivateTiles, center: hexKey(mc.q, mc.r), color: 'rgba(80,180,255,0.95)', width: 0.12 });
    world.layers.setOverlay({ fills, outlines });

    if (st && Array.isArray(st.objectives)) {
      const owners = {};
      for (const o of st.objectives) if (o.owner) owners[o.id ?? hexKey(o.q, o.r)] = bridge.getPlayerColor(o.owner);
      world.objectives.setOwners(owners);
    }
    shownUnits = currentUnits().filter((u) => u.q != null);
    if (bridge.simultaneous && !bridge.playback) ordersLayer.show(bridge.plannedOrders || [], bridge.getPlayerColor(bridge.myId), (id) => { const u = shownUnits.find((x) => x.id === id); return u ? anchorOf(u).clone().setY(anchorOf(u).y - 0.3) : null; });
    else ordersLayer.clear();
    world.layers.setOccupied(new Set([...shownUnits.map((u) => hexKey(u.q, u.r)), ...editsLayer.clearedHexes(bridge.mapEdits, baseMap().ter)]));
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
    return _v.set(p.x, world.walkHeight(p.x, p.z) + 0.7, p.z);
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
        const hu = valid && shownUnits.find((x) => x.q === valid.q && x.r === valid.r);
        const outOfReach = sel && hu && !hu.isMine && !attackable && !bridge.simultaneous;
        world.layers.setHover(valid, attackable ? '#ff6040' : movable ? '#a0ff70' : outOfReach ? '#8a8a8a' : '#ffd25a');
        if (units3d) units3d.setHovered(hu ? hu.id : null);
        for (const el of plateEls.values()) el.classList.toggle('hov', !!(hu && el._unit.id === hu.id));
        const approach = sel && attackable && hu && bridge.approachTo ? bridge.approachTo(sel, hu) : null;
        if (sel && movable) {
          const res = bridge.pathTo(sel, valid.q, valid.r);
          preview.showPath(res ? [[sel.q, sel.r], ...res.path.slice(1)] : null);
        } else if (approach && approach.path.length > 1) preview.showPath(approach.path);
        else preview.showPath(null);
        if (sel && attackable && hu) {
          let from = anchorOf(sel).clone().setY(anchorOf(sel).y - 0.35);
          if (approach && approach.path.length > 1) {
            const p = world.hexToWorld(approach.q, approach.r);
            from = new THREE.Vector3(p.x, world.walkHeight(p.x, p.z) + 0.35, p.z);
          }
          preview.showAttack(from, anchorOf(hu).clone().setY(anchorOf(hu).y - 0.35), (sel.range || 1) > 1);
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

  let lastStageCam = 0;
  // Simultaneous playback: keep the hexes where something happens in this tick on screen
  let followPts = null, followTimer = null;
  function followAction(pts) {
    if (!pts.length || performance.now() - lastStageCam < 300) return;
    const w = canvas.clientWidth, h = canvas.clientHeight, m = 0.18;
    const center = new THREE.Vector3();
    let off = false;
    for (const [q, r] of pts) {
      const p = world.hexToWorld(q, r);
      const v = new THREE.Vector3(p.x, world.groundHeight(p.x, p.z), p.z);
      center.add(v);
      const sp = world.projectToScreen(v);
      if (!sp.visible || sp.x < w * m || sp.x > w * (1 - m) || sp.y < h * m || sp.y > h * (1 - m)) off = true;
    }
    if (!off) return;
    center.divideScalar(pts.length);
    const camOff = world.camera.position.clone().sub(world.controls.target);
    if (camOff.length() > 26) camOff.setLength(26);
    world.flyTo(center.clone().add(camOff), center, 0.7);
  }
  // General duel: close camera, alternating strikes per exchange, damage per round
  function stageDuel(log) {
    const d = log.duel;
    const a = shownUnits.find((u) => u.id === d.attackerId) || shownUnits.find((u) => u.id === log.attackerId);
    const b = shownUnits.find((u) => u.id === d.defenderId) || shownUnits.find((u) => u.id === log.targetId);
    if (!a || !b) return;
    const pa = anchorOf(a).clone(), pb = anchorOf(b).clone();
    const mid = pa.clone().lerp(pb, 0.5);
    mid.y = world.groundHeight(mid.x, mid.z);
    if (ui.staging()) {
      const dir = pb.clone().sub(pa).setY(0).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      world.flyTo(mid.clone().addScaledVector(side, 5.5).add(new THREE.Vector3(0, 3.2, 0)), mid.clone().setY(mid.y + 0.4), 1.0);
    }
    ui.floatText(mid.clone().setY(mid.y + 1.6), 'DUEL', 'kill', 0.3);
    (d.rounds || []).forEach((r, i) => {
      const t = 1.1 + i * 1.15;
      setTimeout(() => {
        if (r.attacker == null) { ui.floatText(mid.clone().setY(mid.y + 1.1), 'Parade', 'miss'); return; }
        const striker = r.attacker === a.id ? a : b;
        const victim = striker === a ? b : a;
        if (units3d) { units3d.playAttack(striker.id, victim.id, { ranged: false }); units3d.playHit(victim.id, { delay: 0.35 }); }
        if (window.gameAudio) window.gameAudio.play('general_duel');
        ui.floatText(anchorOf(victim).clone(), r.dmg ? `-${r.dmg}` : 'Paré', r.dmg ? '' : 'miss', 0.35);
      }, t * 1000);
    });
    const end = 1.1 + (d.rounds || []).length * 1.15 + 0.4;
    setTimeout(() => {
      const w = shownUnits.find((u) => u.id === d.winnerId);
      if (w) ui.floatText(anchorOf(w).clone().setY(anchorOf(w).y + 0.4), `${w.name} l'emporte`, 'kill');
    }, end * 1000);
  }

  view = {
    active: false,
    world,
    markDirty() { dirty = true; },
    onMapEdits(ed) { editsLayer.update(ed, baseMap().seg, baseMap().ter); dirty = true; },
    focusHex(q, r) { world.focusHex(q, r, 0.9); },
    // true when the hex is well inside the screen (not near the borders)
    hexOnScreen(q, r, margin = 0.12) {
      const p = world.hexToWorld(q, r);
      const sp = world.projectToScreen(new THREE.Vector3(p.x, world.groundHeight(p.x, p.z), p.z));
      const w = canvas.clientWidth, h = canvas.clientHeight;
      return sp.visible && sp.x > w * margin && sp.x < w * (1 - margin) && sp.y > h * margin && sp.y < h * (1 - margin);
    },
    pingHex(q, r, color) { world.layers.addPing(q, r, color); },
    onEvent(event, data) {
      if (!view.active) return;
      if (event === 'playback_tick') {
        followPts = [];
        clearTimeout(followTimer);
        followTimer = setTimeout(() => { const pts = followPts || []; followPts = null; if (ui.followPlayback()) followAction(pts); }, 0);
      } else if (event === 'unit_move_anim' && data.playback && followPts && data.path && data.path.length) {
        followPts.push(data.path[data.path.length - 1]);
      }
      if (event === 'combat_result') {
        const log = data.combatLog || data;
        if (data.playback && followPts && log) for (const id of [log.attackerId, log.targetId]) { const u = id != null && shownUnits.find((x) => x.id === id); if (u && u.q != null) followPts.push([u.q, u.r]); }
        if (log && log.duel && log.attackerId != null && log.targetId != null) {
          stageDuel(log);
        } else if (log && log.attackerId != null && log.targetId != null) {
          const att = shownUnits.find((u) => u.id === log.attackerId);
          const tgt = shownUnits.find((u) => u.id === log.targetId);
          let impact = log.ranged ? 0.9 : 0.45;
          if (units3d) {
            const r = units3d.playAttack(log.attackerId, log.targetId, { ranged: !!log.ranged });
            if (typeof r === 'number') impact = r;
            units3d.playHit(log.targetId, { delay: impact });
          }
          const now = performance.now();
          const allowCam = !data.playback || now - lastStageCam > 2500;
          if (att && tgt && ui.staging() && allowCam) {
            lastStageCam = now;
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
      } else if (event === 'ambush') {
        world.layers.addPing(data.q, data.r, '#ff3020');
        const u = shownUnits.find((x) => x.id === data.unitId);
        const p = world.hexToWorld(data.q, data.r);
        ui.floatText(new THREE.Vector3(p.x, world.groundHeight(p.x, p.z) + 0.8, p.z), 'Embuscade !', 'kill');
        if (u && units3d) units3d.playHit(u.id, { delay: 0.1 });
        if (ui.staging()) world.focusHex(data.q, data.r, 0.7);
      } else if (event === 'objective_captured') {
        world.layers.addPing(data.q, data.r, data.owner ? bridge.getPlayerColor(data.owner) : '#ffd700');
        const p = world.hexToWorld(data.q, data.r);
        ui.floatText(new THREE.Vector3(p.x, world.groundHeight(p.x, p.z) + 1.9, p.z), `${data.name || 'Objectif'} capturé`, 'kill');
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
