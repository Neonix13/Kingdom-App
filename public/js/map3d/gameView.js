import { createWorld } from './world.js';
import { createPathPreview, createOrdersLayer, createPathMarks, createZoneRims } from './pathPreview.js';
import { createMapEditsLayer } from './mapEdits3d.js';
import { createGameUI } from './gameUI.js';
import { createMapMode } from './mapMode.js';
import { createDice3d } from './dice3d.js';
import { createCameraDirector } from './cameraDirector.js';
import { createCorpseLayer } from './corpses3d.js';
import { createKillCam } from './killCam.js';

const PLATE_CSS = `
#view3d-canvas { position:absolute; inset:0; width:100%; height:100%; display:block; z-index:1; outline:none; touch-action:none; }
#view3d-plates { position:absolute; inset:0; pointer-events:none; z-index:2; overflow:hidden; }
/* ---- unit plates: a little war banner (nobori) planted above each unit.
   The cloth hangs from the crossbar and is tied to the pole (loops along its edge); it carries the type pictogram, the
   stance in a square under it, kanji tags for the state, and a strip sewn along its right edge with the two gauges (vitality,
   morale — red stripes below zero), so the whole flag sways in the wind as one. Fleeing: the stance is torn off and the
   flag flashes red. Values in the tooltips. Sizes in --cw / --ch (smaller from far away), map mode: cloth only */
/* banner -> Strategy token morph: --m (0 banner, 1 token) and --mi = 1 - --m on #view3d-plates; the cloth turns into the square
   token while the pole, crossbar, ties, gauges and stance fade (--mf) and fold away. --dd: the details shown (0 from far) */
.u3-plate { --dd:var(--det, 1); position:absolute; left:0; top:0; pointer-events:auto; cursor:pointer; will-change:transform; padding:0 calc(4px * var(--mi, 1));
  font:900 10px 'Zen Kaku Gothic New','Segoe UI',system-ui,sans-serif; color:#fff; }
/* size follows the camera distance continuously (--sc on #view3d-plates), details fade out with it (--det) */
.u3-ban { --cw:38px; --ch:58px; --tw:26px; position:relative;
  width:calc((var(--cw) + 6px) * var(--mi, 1) + var(--tw) * var(--m, 0)); height:calc((var(--ch) + 23px) * var(--mi, 1) + var(--tw) * var(--m, 0));
  transform-origin:calc(1.5px * var(--mi, 1) + 50% * var(--m, 0)) calc(100% - 50% * var(--m, 0)); transform:scale(var(--sc, 1)); transition:transform .15s; }
.u3-plate.hov, .u3-plate.sel { --dd:1; }
.u3-plate.hov .u3-ban, .u3-plate.sel .u3-ban { transform:scale(max(1, calc(var(--sc, 1) * var(--hs, 1.18)))); }
.u3-plate .st, .u3-plate .u3-tags { opacity:calc(var(--dd) * var(--mf, 1)); transition:opacity .2s; }
.u3-pole, .u3-cap, .u3-bar-x, .u3-ties, .u3-gauges { opacity:var(--mf, 1); }
#view3d-plates.tok .u3-pole, #view3d-plates.tok .u3-cap, #view3d-plates.tok .u3-bar-x, #view3d-plates.tok .u3-ties,
#view3d-plates.tok .u3-gauges, #view3d-plates.tok .st, #view3d-plates.tok .u3-tags { display:none; }
/* pole, finial and crossbar */
.u3-pole { position:absolute; left:0; top:4px; bottom:0; width:3px; background:linear-gradient(90deg, #2a1a0e, #7a5634 45%, #2a1a0e); box-shadow:0 0 0 1px #000; }
.u3-cap { position:absolute; left:-2px; top:0; width:7px; height:7px; border-radius:50%; background:#8a6a48; box-shadow:0 0 0 1px #000; z-index:4; }
.u3-bar-x { position:absolute; left:0; top:6px; width:calc(var(--cw) + 4px); height:3px; background:linear-gradient(#5a3d22, #2e1d0f); box-shadow:0 0 0 1px #000; z-index:3; }
.u3-bar-x::after { content:''; position:absolute; right:-2px; top:-1px; width:4px; height:5px; border-radius:1px; background:#6b4a2c; box-shadow:0 0 0 1px #000; }
.u3-plate.general .u3-pole { background:linear-gradient(90deg, #6a4a10, #e8c060 45%, #6a4a10); }
.u3-plate.general .u3-cap, .u3-plate.general .u3-bar-x::after { background:#f3d27a; }
.u3-plate.general .u3-bar-x { background:linear-gradient(#e0b450, #8a6418); }
/* loops tying the cloth to the pole */
.u3-ties { position:absolute; left:-1px; top:11px; width:6px; height:calc(var(--ch) - 12px); z-index:3; pointer-events:none;
  background:repeating-linear-gradient(180deg, #efe6d4 0 2px, #000 2px 3px, transparent 3px 10px); }
/* cloth: hangs right under the crossbar, its left edge along the pole */
.u3-cloth { position:absolute; left:calc(3px * var(--mi, 1)); top:calc(9px * var(--mi, 1));
  width:calc(var(--cw) * var(--mi, 1) + var(--tw) * var(--m, 0)); height:calc(var(--ch) * var(--mi, 1) + var(--tw) * var(--m, 0)); overflow:hidden;
  background:linear-gradient(90deg, rgba(0,0,0,.3), transparent 25%, rgba(255,255,255,.14) 55%, rgba(0,0,0,.18)), var(--pc);
  clip-path:polygon(0 0, 100% 0, 100% 100%, 50% calc(86% + 14% * var(--m, 0)), 0 100%); transform-origin:0 0; animation:u3-wind 2.8s ease-in-out infinite; animation-delay:var(--wd, 0s); }
@keyframes u3-wind { 0%, 100% { transform:skewY(0deg) scaleX(1); } 35% { transform:skewY(calc(2.5deg * var(--mi, 1))) scaleX(calc(1 - .05 * var(--mi, 1))); }
  70% { transform:skewY(calc(-1.5deg * var(--mi, 1))) scaleX(calc(1 + .02 * var(--mi, 1))); } }
.u3-cloth-edge { position:absolute; inset:0; z-index:4; pointer-events:none; clip-path:polygon(0 0, 100% 0, 100% 100%, 50% calc(86% + 14% * var(--m, 0)), 0 100%);
  box-shadow:inset 0 3px 0 rgba(0,0,0,.35), inset 0 0 0 2px #fff, inset 0 0 0 3px #000; }
.u3-flash { position:absolute; inset:0; z-index:1; background:#D8352A; opacity:0; pointer-events:none; }
.u3-plate.fleeing .u3-flash { animation:u3-redflash .8s steps(2) infinite; }
@keyframes u3-redflash { 0% { opacity:0; } 50% { opacity:.85; } }
/* main column: tags, pictogram, stance */
.u3-main { position:absolute; left:calc(3px * var(--mi, 1)); right:calc((9px + 5px * var(--dd)) * var(--mi, 1)); top:calc(5px * var(--mi, 1) + 4.5px * var(--m, 0));
  z-index:2; display:flex; flex-direction:column; align-items:center; gap:calc(3px * var(--mi, 1)); }
.u3-cloth .k { display:flex; color:#fff; font:400 17px 'Yuji Boku','Zen Old Mincho',serif; line-height:1; filter:drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000); }
.u3-cloth .k svg { width:16px; height:16px; }
.u3-tags { display:flex; flex-direction:column; align-items:center; gap:1px; max-height:calc(60px * var(--mi, 1)); overflow:hidden; }
.u3-tag { display:flex; align-items:center; justify-content:center; width:12px; height:12px; font:400 9px/1 'Yuji Boku','Zen Old Mincho',serif; background:#fff; color:#000; box-shadow:0 0 0 1px #000; }
.u3-tag.gen { background:#e8c060; color:#000; } .u3-tag.hide { background:#2f6a3a; color:#cfe9c9; } .u3-tag.stun { background:#ffcf40; color:#000; }
.u3-plate .st { width:19px; height:calc(19px * var(--mi, 1)); box-sizing:border-box; display:flex; align-items:center; justify-content:center; border-radius:0; border:2px solid #fff; box-shadow:0 0 0 1.5px #000, 1px 1px 0 2px rgba(0,0,0,.5); }
.u3-plate .st svg { width:13px; height:13px; }
.u3-plate .st:empty:not(.torn) { display:none; }
/* fleeing: the stance has been torn off — a ragged hole with a loose thread */
.u3-plate .st.torn { position:relative; background:rgba(0,0,0,.6); border:0; box-shadow:none; border-radius:0;
  clip-path:polygon(50% 0, 62% 14%, 82% 6%, 84% 28%, 100% 40%, 86% 56%, 96% 78%, 72% 80%, 62% 100%, 46% 86%, 26% 98%, 22% 76%, 2% 70%, 14% 50%, 0 30%, 22% 22%, 26% 2%); }
.u3-plate .st.torn::after { content:''; position:absolute; left:3px; right:3px; top:50%; height:1px; background:rgba(255,255,255,.5); transform:rotate(-35deg); }
/* gauges: a strip sewn along the right edge of the cloth (seam on its left), vitality wide, morale narrow */
/* from far away the morale gauge folds away (--dd): the strip narrows to the vitality alone instead of showing an empty track */
.u3-gauges { position:absolute; right:3px; top:3px; bottom:4px; z-index:2; width:calc(6px + 5px * var(--dd)); box-sizing:content-box; display:flex; gap:calc(1px * var(--dd)); padding:1px;
  background:#0f0e0d; box-shadow:0 0 0 1px #fff, 0 0 0 2px #000; }
.u3-vbar { position:relative; flex:none; width:4px; height:100%; background:#2a2725; overflow:hidden; }
.u3-vbar > i { position:absolute; left:0; right:0; bottom:0; transition:height .3s; }
.u3-vbar.hp > i { background:linear-gradient(90deg, #ffffff, #d8d0c2); }
.u3-vbar.hp.low > i { background:linear-gradient(90deg, #ff6a55, #b8261c); }
.u3-vbar.hp::after { content:''; position:absolute; inset:0; background:repeating-linear-gradient(0deg, transparent 0 calc(25% - 1px), rgba(0,0,0,.7) calc(25% - 1px) 25%); }
.u3-vbar.mo { width:calc(4px * var(--dd)); opacity:var(--dd); box-shadow:-1px 0 0 #000; }
.u3-vbar.mo > i { background:linear-gradient(90deg, #8fd0ff, #2f86e6); box-shadow:0 0 3px rgba(80,170,255,.9); }
.u3-vbar.mo.neg > i { top:0; bottom:auto; background:repeating-linear-gradient(135deg, #ff5a45 0 2px, #8a1a12 2px 4px); }
/* states */
.u3-plate.general .u3-cloth-edge { box-shadow:inset 0 3px 0 rgba(0,0,0,.35), inset 0 0 0 2px #e8c060, inset 0 0 0 3px #000; }
.u3-plate.sel .u3-cloth-edge { box-shadow:inset 0 3px 0 rgba(0,0,0,.35), inset 0 0 0 2px #D8352A, inset 0 0 0 3px #000; }
.u3-plate.sel .u3-ban { filter:drop-shadow(0 0 5px rgba(216,53,42,.9)); }
.u3-plate.moved .u3-cloth { filter:grayscale(.75) brightness(.8); }
.u3-plate.fleeing .u3-cloth { animation-duration:.9s; }
.u3-plate.concealed .u3-ban { animation:u3-hidden 3s ease-in-out infinite; }
@keyframes u3-hidden { 0%, 100% { opacity:.6; } 50% { opacity:.2; } }
/* far: a smaller flag, vitality only */
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
  // Camera in the manner of Total War: the middle button held turns and tilts the view, the wheel zooms along a curve
  // (close: the camera lowers toward the horizon; far: it looks down on the battlefield), keys / screen edges move it
  // (gameUI.js); the left button still drags the view; the right button turns it too (or orients the selected unit when
  // the drag starts on it)
  world.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.ROTATE };
  world.controls.screenSpacePanning = false;
  world.controls.panSpeed = 1.2;
  {
    const C = world.controls, cam = world.camera;
    const sph = new THREE.Spherical(), off = new THREE.Vector3();
    const pitchFor = (r) => THREE.MathUtils.degToRad(70 - 46 * THREE.MathUtils.smoothstep(r, 4, 55)); // from the vertical
    let tilt = null, mmb = false, wheelAt = -1e9;
    canvas.addEventListener('pointerdown', (e) => { if (e.button === 1 || e.button === 2) mmb = true; if (e.button === 1) e.preventDefault(); });
    window.addEventListener('pointerup', (e) => { if (e.button === 1 || e.button === 2) mmb = false; });
    canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
    // leaving the Strategy view: the angle is the player's — forget the wheel that triggered it and re-read the tilt
    window.addEventListener('kb-mapmode', (e) => { if (!e.detail) { wheelAt = -1e9; window.kbCamZoomAt = -1e9; tilt = null; } });
    // zoom-out limit of the battle view: wheeling further out switches to the Strategy view (map mode, M); in the
    // Strategy view, wheeling in all the way comes back to the battle view
    C.maxDistance = 55;
    let push = 0;
    canvas.addEventListener('wheel', (e) => {
      wheelAt = performance.now();
      const d = cam.position.distanceTo(C.target);
      if (!mapMode.active) {
        if (e.deltaY > 0 && d >= C.maxDistance * 0.97) { push = 0; mapMode.enter(); } else push = 0;
      } else if (mapMode.state === 'on') {
        if (e.deltaY < 0 && d <= C.minDistance * 1.05) { push = 0; mapMode.exit(); } else push = 0;
      }
    }, { passive: true });
    world.frameHooks.push((dt) => {
      if (!C.enabled || window.kbMapBusy || document.body.classList.contains('v3-map')) return; // Strategy view (or its transition): its own camera
      off.copy(cam.position).sub(C.target);
      sph.setFromVector3(off);
      const base = pitchFor(sph.radius);
      // the tilt chosen with the middle button is kept as an offset to the zoom curve
      if (tilt === null || mmb) { tilt = THREE.MathUtils.clamp(sph.phi - base, -0.6, 0.6); return; }
      const now = performance.now();
      if (now - wheelAt > 450 && now - (window.kbCamZoomAt || -1e9) > 200) return;
      const want = THREE.MathUtils.clamp(base + tilt, 0.12, C.maxPolarAngle);
      sph.phi += (want - sph.phi) * Math.min(1, dt * 9);
      off.setFromSpherical(sph);
      cam.position.copy(C.target).add(off);
    });
  }
  world.setGrid(0.16);

  let units3d = null;
  const KINGDOM_OF = { ou_ki: '秦', mou_bu: '秦', ou_sen: '秦', kan_ki: '秦', ri_boku: '趙', kei_sha: '趙', shi_ba_shou: '趙', ren_pa: '趙', go_kei: '魏', go_hou_mei: '魏', gai_mou: '魏' };
  try {
    const mod = await import('./units3d.js');
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
  const ordersLayer = createOrdersLayer(world, { tint: true }); // moves of this turn: in the player's colour
  const marchLayer = createOrdersLayer(world, { opacity: 0.45 }); // standing marches of my units (rest of the route)
  const zoneRims = createZoneRims(world); // range / charisma zones: crisp ribbons on the relief
  const pathMarks = createPathMarks(world); // selected unit: turn numbers of its march, stance changes on its path
  const editsLayer = createMapEditsLayer(world);
  const baseMap = () => (bridge.mapDoc ? { seg: bridge.mapDoc.segments || {}, ter: bridge.mapDoc.terrain || {} } : { seg: {}, ter: {} });
  editsLayer.update(bridge.mapEdits, baseMap().seg, baseMap().ter);
  let view = null;
  const ui = createGameUI({ world, container, bridge, getView: () => view });
  const mapMode = createMapMode(world, { onChange: (on) => window.dispatchEvent(new CustomEvent('kb-mapmode', { detail: on })) });
  const dice = createDice3d(world);
  const killCam = createKillCam(world, { enabled: () => ui.killCam(), blocked: () => ui.photo || !view || !view.active || mapMode.active });
  const director = createCameraDirector(world, { container, enabled: () => ui.followPlayback() && !killCam.active });
  const corpses = createCorpseLayer(world);
  if (window.KBCorpses) window.KBCorpses.onChange((list) => corpses.set(list));

  // --- Input: click vs drag, hover, context menu ---
  let down = null, orienting = false;
  // right-drag starting on the selected unit orients it; captured on the container so the orbit controls never start
  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 2 || e.target !== canvas || !window.KBOrient) return;
    const u = bridge.selectedUnit;
    const hex = u && world.pickHex(e.clientX, e.clientY);
    const anchor = hex && bridge.orientAnchor ? bridge.orientAnchor(u, hex) : null;
    if (!anchor || !KBOrient.start(bridge, u, anchor)) return;
    orienting = true;
    world.controls.enabled = false;
  }, true);
  window.addEventListener('pointermove', (e) => { if (orienting) KBOrient.move(world.pickHex(e.clientX, e.clientY), e.clientX, e.clientY); });
  window.addEventListener('pointerup', () => {
    if (!orienting) return;
    orienting = false;
    KBOrient.end();
    world.controls.enabled = true;
    down = null;
  });
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button };
    canvas.focus();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || orienting) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 450;
    const b = down.b;
    down = null;
    if (moved > 6 || !quick) return;
    const hex = world.pickHex(e.clientX, e.clientY);
    if (b === 0) { bridge.click(hex, { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey || e.metaKey, altKey: e.altKey, clientX: e.clientX, clientY: e.clientY }); lastMove = e; hovered = null; }
    else if (b === 2) bridge.contextMenu(hex, e.clientX, e.clientY);
  });
  canvas.addEventListener('dblclick', (e) => {
    const hex = world.pickHex(e.clientX, e.clientY);
    if (hex) bridge.doubleClick(hex);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  let lastMove = null;
  let lastPointer = null, routeSig = '';
  canvas.addEventListener('pointermove', (e) => { lastMove = e; lastPointer = e; });
  canvas.addEventListener('pointerleave', () => { lastMove = null; hovered = null; bridge.hover(null); world.layers.setHover(null); preview.clear(); ui.showAttackTip(null); });
  let hovered = null;

  // --- Unit plates (HTML overlays following the formations) ---
  const plateEls = new Map();
  function plateFor(u) {
    let el = plateEls.get(u.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'u3-plate';
      el.innerHTML = '<div class="u3-ban"><i class="u3-pole"></i><i class="u3-bar-x"></i><i class="u3-cap"></i>'
        + '<div class="u3-cloth"><i class="u3-flash"></i><div class="u3-main"><span class="u3-tags"></span><b class="k"></b><b class="st"></b></div>'
        + '<div class="u3-gauges"><div class="u3-vbar hp"><i></i></div><div class="u3-vbar mo"><i></i></div></div><i class="u3-cloth-edge"></i></div>'
        + '<i class="u3-ties"></i></div>';
      el.style.setProperty('--wd', `${(-Math.random() * 2.8).toFixed(2)}s`);
      el.addEventListener('click', (ev) => { ev.stopPropagation(); const cur = el._unit; if (cur && cur.q != null) bridge.click({ q: cur.q, r: cur.r }); });
      el.addEventListener('dblclick', (ev) => { ev.stopPropagation(); const cur = el._unit; if (cur && cur.q != null) bridge.doubleClick({ q: cur.q, r: cur.r }); });
      el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); const cur = el._unit; if (cur) bridge.contextMenu({ q: cur.q, r: cur.r }, ev.clientX, ev.clientY); });
      plates.appendChild(el);
      plateEls.set(u.id, el);
    }
    el._unit = u;
    const color = bridge.getPlayerColor(u.playerId);
    el.style.setProperty('--pc', color);
    const kj = u.isGeneral ? 'general' : u.typeId;
    const kEl = el.querySelector('.k');
    if (kEl.dataset.t !== kj) { kEl.dataset.t = kj; kEl.innerHTML = self.KBUnitIcon(u.typeId, u.isGeneral); }
    // kanji tags for the state only (the cloth's colour already tells the side, the gold edge the general, a slow blink a hidden unit): stunned
    const tags = [];
    if (u.stunned) tags.push('<i class="u3-tag stun" title="Sonné">暈</i>');
    const tagEl = el.querySelector('.u3-tags');
    const tagHtml = tags.join('');
    if (tagEl.dataset.h !== tagHtml) { tagEl.dataset.h = tagHtml; tagEl.innerHTML = tagHtml; }
    const hp = Math.max(0, Math.min(1, (u.vitality ?? 1) / (u.maxVitality || 1)));
    const hpBar = el.querySelector('.u3-vbar.hp');
    hpBar.firstChild.style.height = (hp * 100).toFixed(0) + '%';
    hpBar.classList.toggle('low', hp <= 0.35);
    hpBar.title = `Vitalité ${u.vitality ?? '?'} / ${u.maxVitality ?? '?'}`;
    const moBar = el.querySelector('.u3-vbar.mo');
    if (u.maxMorale && u.morale != null) {
      // negative morale (the unit flees below zero): red stripes from the top, as long as the deficit
      const neg = u.morale < 0;
      moBar.style.display = '';
      moBar.classList.toggle('neg', neg);
      moBar.firstChild.style.height = (Math.max(0, Math.min(1, Math.abs(u.morale) / u.maxMorale)) * 100).toFixed(0) + '%';
      moBar.title = `Moral ${u.morale} / ${u.maxMorale}`;
    } else moBar.style.display = 'none';
    const st = el.querySelector('.st');
    const sst = u.stance && !u.isGeneral && window.stanceStyle ? window.stanceStyle(u.stance) : null;
    const torn = !!u.isFleeing && !u.isGeneral;
    const stKey = torn ? 'torn' : sst ? u.stance : '';
    if (st.dataset.st !== stKey) {
      st.dataset.st = stKey;
      st.classList.toggle('torn', torn);
      st.innerHTML = !torn && sst && window.stanceIconSvg ? window.stanceIconSvg(u.stance, 13) : '';
      st.style.background = !torn && sst ? sst.c : '';
      st.title = torn ? 'En fuite : la posture est arrachée' : sst ? `Posture : ${sst.name}` : '';
    }
    el.classList.toggle('general', !!u.isGeneral);
    el.classList.toggle('enemy', !u.isMine && !u.isAlly);
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
  // the range from the selected unit's destination (hovered hex, or end of its planned path) is added to the overlay;
  // it follows the hover without a full sync
  let lastOverlay = { fills: [], outlines: [], zones: [] }, previewSig = '';
  function previewOutline() {
    const rp = bridge.rangePreview;
    previewSig = rp ? `${rp.kind}|${rp.center.q},${rp.center.r}|${rp.keys.size}` : '';
    if (!rp || !rp.keys.size) return [];
    return [{ keys: rp.keys, center: hexKey(rp.center.q, rp.center.r), kind: rp.kind === 'tir' ? 'tir' : 'charisme', dash: true }];
  }
  function applyOverlay() {
    world.layers.setOverlay({ fills: lastOverlay.fills, outlines: lastOverlay.outlines });
    zoneRims.show([...lastOverlay.zones, ...previewOutline()]);
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
      const stuck = bridge.deployBlockedFor ? bridge.deployBlockedFor(bridge.selectedUnit) : null;
      if (stuck) fills.push({ keys: stuck, color: 'rgba(216,53,42,0.55)', edge: 'rgba(255,110,90,0.95)' });
    }
    if (bridge.abilityTiles && bridge.abilityTiles.size) fills.push({ keys: new Set(bridge.abilityTiles.keys()), color: 'rgba(40,110,200,0.5)', edge: 'rgba(120,190,255,0.95)' });
    fills.push({ keys: bridge.attackableTiles, color: 'rgba(200,40,20,0.5)', edge: 'rgba(255,120,80,0.95)' });
    if (bridge.approachAt) {
      const approach = new Set([...bridge.attackableTiles].filter((k) => bridge.approachAt(k)));
      if (approach.size) fills.push({ keys: approach, color: 'rgba(230,120,20,0.5)', edge: 'rgba(255,190,90,0.95)' });
    }
    const sel = bridge.selectedUnit;
    if (sel && sel.q != null) fills.push({ keys: new Set([hexKey(sel.q, sel.r)]), color: 'rgba(255,210,60,0.32)' });
    const rc = bridge.rangeCenter, mc = bridge.motivateCenter;
    // range (pale gold) and charisma (blue): light veil, soft halo, crisp edge
    const zones = [];
    if (rc) zones.push({ keys: bridge.rangeTiles, center: hexKey(rc.q, rc.r), kind: 'tir' });
    if (mc) zones.push({ keys: bridge.motivateTiles, center: hexKey(mc.q, mc.r), kind: 'charisme' });
    lastOverlay = { fills, outlines, zones };
    applyOverlay();

    world.objectives.group.visible = st && st.phase !== 'deployment' ? (st.objectives || []).length > 0 : ds?.showObjectives !== false;
    if (st && Array.isArray(st.objectives)) {
      const owners = {};
      for (const o of st.objectives) if (o.owner) owners[o.id ?? hexKey(o.q, o.r)] = bridge.getPlayerColor(o.owner);
      world.objectives.setOwners(owners);
    }
    shownUnits = currentUnits().filter((u) => u.q != null);
    // base-camp banners take the colours of the army deployed in each fixed zone; birds flee approaching troops
    if (st && Array.isArray(st.players) && world.setCampColors) world.setCampColors(st.players.filter((p) => p.mapZone != null).map((p) => ({ zone: p.mapZone, color: bridge.getPlayerColor(p.id), emblem: KINGDOM_OF[p.generalId] || '' })));
    if (world.setBirdThreats) world.setBirdThreats(shownUnits.map((u) => world.hexToWorld(u.q, u.r)));
    if (world.setBuildingCutaways) {
      const inside = (u) => u && u.q != null && world.allHexes.get(hexKey(u.q, u.r))?.terrain === 'building';
      const open = shownUnits.filter((u) => (u.isMine || u.playerId === bridge.myId) && inside(u));
      if (inside(sel) && !open.includes(sel)) open.push(sel);
      world.setBuildingCutaways(open.map((u) => ({ q: u.q, r: u.r })));
    }
    if (bridge.simultaneous && !bridge.playback) ordersLayer.show(bridge.plannedOrders || [], bridge.getPlayerColor(bridge.myId), (id) => { const u = shownUnits.find((x) => x.id === id); return u ? anchorOf(u).clone().setY(anchorOf(u).y - 0.3) : null; }, sel ? sel.id : null);
    else ordersLayer.clear();
    const marches = window.marchPaths ? window.marchPaths().map(({ u, path }) => ({ unitId: u.id, type: 'move', path })) : [];
    // the turns after this one are drawn grey (only this turn's part takes the player colour)
    if (marches.length) marchLayer.show(marches, '#9a9a9a', null, sel ? sel.id : null); else marchLayer.clear();
    const marks = [];
    const sm = sel && !bridge.playback && window.selectedMarch ? window.selectedMarch() : null;
    if (sm) sm.ends.forEach((idx, n) => { if (idx > 0 && sm.path[idx]) marks.push({ kind: 'turn', q: sm.path[idx][0], r: sm.path[idx][1], n: n + 1 }); });
    const so = sel && bridge.simultaneous && !bridge.playback ? (bridge.plannedOrders || []).find((o) => String(o.unitId) === String(sel.id)) : null;
    const sp = so && window.KBSim && KBSim.stepInfo ? KBSim.stepInfo(sel) : null;
    if (sp) marks.push({ kind: 'step', q: sp.hex[0], r: sp.hex[1], ring: bridge.getPlayerColor(bridge.myId) });
    // the end of this turn's move: a white disc numbered 1 (the next turns of a march carry 2, 3…)
    if (so && so.type === 'move' && so.path && so.path.length > 1) { const e = so.path[so.path.length - 1]; marks.push({ kind: 'turn', q: e[0], r: e[1], n: 1 }); }
    // a stance change in a later turn of the march: the seal in black and white
    if (so && so.stanceSteps) for (const s of so.stanceSteps) { const later = s.at > (so.path ? so.path.length - 1 : 0); marks.push({ kind: 'stance', q: s.hex[0], r: s.hex[1], stance: s.stance, ring: later ? '#9a9a9a' : bridge.getPlayerColor(bridge.myId), grey: later }); }
    // a stance change on the spot (taken at the start of the turn): the seal on the unit itself, for every unit of mine
    if (bridge.simultaneous && !bridge.playback) for (const o of bridge.plannedOrders || []) {
      if (!o.stance) continue;
      const u = shownUnits.find((x) => String(x.id) === String(o.unitId));
      if (u && u.q != null && o.stance !== u.stance) marks.push({ kind: 'stance', q: u.q, r: u.r, stance: o.stance, ring: bridge.getPlayerColor(bridge.myId), onUnit: true });
    }
    pathMarks.show(marks);
    // trees step aside on hexes holding a unit and on every forest hex in sight, so that a visible forest stays readable
    const seenForest = Array.from(st && st.phase === 'battle' && st.visibleHexes ? st.visibleHexes : []).filter((k) => world.allHexes.get(k)?.terrain === 'forest');
    world.layers.setOccupied(new Set([...shownUnits.map((u) => hexKey(u.q, u.r)), ...seenForest, ...editsLayer.clearedHexes(bridge.mapEdits, baseMap().ter)]));
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
    // stone stairs between the two hexes: walk their switchback (foot, flights, landings) instead of cutting across
    const route = stairRoute(from, to);
    if (route) return alongPolyline([p0, ...route, p1], k);
    return { x: p0.x + (p1.x - p0.x) * k, z: p0.z + (p1.z - p0.z) * k, heading: Math.atan2(p1.x - p0.x, p1.z - p0.z) };
  }
  function stairRoute(from, to) {
    const a = `${from[0]},${from[1]}`, b = `${to[0]},${to[1]}`;
    const d = (world.decks || []).find((x) => x.stair && ((x.stair.lo === a && x.stair.hi === b) || (x.stair.lo === b && x.stair.hi === a)));
    if (!d) return null;
    return d.stair.lo === a ? d.stair.route : [...d.stair.route].reverse();
  }
  function alongPolyline(pts, k) {
    let total = 0;
    const seg = [];
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); seg.push(l); total += l; }
    let want = Math.max(0, Math.min(1, k)) * total;
    for (let i = 0; i < seg.length; i++) {
      if (want <= seg[i] || i === seg.length - 1) {
        const t = seg[i] > 1e-6 ? Math.min(1, want / seg[i]) : 1, A = pts[i], Bp = pts[i + 1];
        return { x: A.x + (Bp.x - A.x) * t, z: A.z + (Bp.z - A.z) * t, heading: Math.atan2(Bp.x - A.x, Bp.z - A.z) };
      }
      want -= seg[i];
    }
    const L = pts[pts.length - 1];
    return { x: L.x, z: L.z, heading: 0 };
  }

  function diceAt(log) {
    const a = log && shownUnits.find((u) => u.id === log.attackerId), b = log && shownUnits.find((u) => u.id === log.targetId);
    if (!a || !b) return null;
    const p = anchorOf(a).clone().lerp(anchorOf(b), 0.5);
    return p.setY(world.groundHeight(p.x, p.z));
  }
  const _v = new THREE.Vector3();
  const _plateAt = new THREE.Vector3();
  function anchorOf(u) {
    if (units3d) {
      const a = units3d.getAnchor(u.id);
      if (a) return a;
    }
    const ap = animatedPos(u);
    const p = ap || world.hexToWorld(u.q, u.r);
    return _v.set(p.x, world.standHeight(p.x, p.z) + 0.7, p.z);
  }

  function frame(dt = 0.016) {
    if (!view.active) return;
    if (dirty) syncNow();
    {
      const rp = bridge.rangePreview;
      const sig = rp ? `${rp.kind}|${rp.center.q},${rp.center.r}|${rp.keys.size}` : '';
      if (sig !== previewSig) applyOverlay();
    }
    // route waypoints changed (Maj+clic, Échap...): markers and path preview follow
    const wps = bridge.routeWaypoints || [];
    const sig = `${bridge.selectedUnit ? bridge.selectedUnit.id : ''}|${wps.join(';')}`;
    if (sig !== routeSig) { routeSig = sig; preview.showWaypoints(wps); hovered = null; lastMove = lastMove || lastPointer; }
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
        const movable = key && (bridge.movableTiles.has(key) || bridge.movableTiles.has(key + '^'));
        const hu = valid && shownUnits.find((x) => x.q === valid.q && x.r === valid.r);
        const outOfReach = sel && hu && !hu.isMine && !hu.isAlly && !attackable && !bridge.simultaneous;
        world.layers.setHover(valid, attackable ? '#ff6040' : movable ? '#a0ff70' : outOfReach ? '#8a8a8a' : '#ffd25a');
        if (units3d) units3d.setHovered(hu ? hu.id : null);
        for (const el of plateEls.values()) el.classList.toggle('hov', !!(hu && el._unit.id === hu.id));
        const approach = sel && attackable && hu && bridge.approachTo ? bridge.approachTo(sel, hu) : null;
        const march = sel && !movable && !attackable && !hu && bridge.marchPlan ? bridge.marchPlan(sel, valid.q, valid.r) : null;
        if (march) world.layers.setHover(valid, '#c9d4ff');
        preview.setColor(bridge.getPlayerColor(bridge.myId));
        if (sel && movable) {
          const res = bridge.pathTo(sel, valid.q, valid.r);
          preview.showPath(res ? [[sel.q, sel.r], ...res.path.slice(1)] : null);
        } else if (approach && approach.path.length > 1) preview.showPath(approach.path);
        else if (march) preview.showPath(march.path, { turnEnds: march.turnEnds });
        else preview.showPath(null);
        if (sel && attackable && hu) {
          let from = anchorOf(sel).clone().setY(anchorOf(sel).y - 0.35);
          if (approach && approach.path.length > 1) {
            const p = world.hexToWorld(approach.q, approach.r);
            from = new THREE.Vector3(p.x, world.standHeight(p.x, p.z) + 0.35, p.z);
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
    if (!killCam.active) { const sel = bridge.selectedUnit; world.dof.setFocus(sel && sel.q != null ? anchorOf(sel) : null); }
    director.update();
    preview.update(dt);
    const camDist = world.camera.position.distanceTo(world.controls.target);
    const pm = ui.platesMode();
    const showPlates = !ui.photo && (pm === 'always' || (pm === 'auto' && (camDist < 60 || mapMode.active)));
    plates.classList.toggle('names', camDist < 14);
    plates.classList.toggle('near', camDist < 16);
    // banners shrink smoothly with the distance (1 → 0.72) and their details fade (stance, morale, tags)
    const far = THREE.MathUtils.smoothstep(camDist, 14, 50);
    plates.style.setProperty('--det', (1 - THREE.MathUtils.smoothstep(camDist, 26, 46)).toFixed(3));
    // banner <-> Strategy token: follows the camera transition (kbMapProgress 0 → 1): the banner glides to the centre of
    // its hex and its cloth turns into the token (CSS --m), the pole and the rest fold away
    const mp = Math.max(0, Math.min(1, window.kbMapProgress || 0));
    const tok = mp >= 1;
    plates.classList.toggle('tok', tok);
    plates.style.setProperty('--m', mp.toFixed(3));
    plates.style.setProperty('--mi', (1 - mp).toFixed(3));
    plates.style.setProperty('--mf', (1 - THREE.MathUtils.smoothstep(mp, 0, 0.6)).toFixed(3));
    plates.style.setProperty('--hs', (1 + 0.18 * (1 - mp)).toFixed(3));
    plates.style.setProperty('--sc', (1 - 0.28 * far * (1 - mp)).toFixed(3));
    plates.style.display = showPlates ? '' : 'none';
    if (showPlates) {
      for (const el of plateEls.values()) {
        const u = el._unit;
        // the banner's pole stands among the soldiers: its foot a little below the top of the formation; the general's
        // escort is taller (mounted), its banner is brought down to the height of the others
        // Strategy view (top-down): a flat token on the centre of the unit's hex instead of a banner
        const a = anchorOf(u);
        const sb = mp < 1 ? world.projectToScreen(_plateAt.copy(a).setY(a.y - (u.isGeneral ? 0.65 : 0.2))) : null;
        const bx = sb ? sb.x : 0, by = sb ? sb.y : 0, bv = sb ? sb.visible : true;
        const st = mp > 0 ? world.projectToScreen(_plateAt.set(a.x, world.standHeight(a.x, a.z), a.z)) : null;
        const s = { x: st ? bx + (st.x - bx) * mp : bx, y: st ? by + (st.y - by) * mp : by, visible: mp >= 1 ? st.visible : bv };
        if (mp >= 1) { s.x = st.x; s.y = st.y; }
        if (!s.visible) { el.style.display = 'none'; continue; }
        el.style.display = '';
        // stacking by the real distance to the camera (not the screen height, which flips with low or tilted views):
        // the closer, the more in front; hovered / selected always on top
        const camD = world.camera.position.distanceTo(anchorOf(u));
        el.style.zIndex = String(Math.max(1, 90000 - Math.round(camD * 100)) + (el.classList.contains('sel') ? 200000 : el.classList.contains('hov') ? 100000 : 0));
        // anchor: the pole's foot for the banner (bottom left), the centre for the token, blended along the morph
        el.style.transform = `translate(${(s.x - 5.5 * (1 - mp)).toFixed(1)}px, ${s.y.toFixed(1)}px) translate(${(-50 * mp).toFixed(1)}%, ${(-100 + 50 * mp).toFixed(1)}%)`;
      }
    }
  }
  world.frameHooks.push(frame);

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
    get cinematicBusy() { return killCam.busy; },
    get units3d() { return units3d; },
    active: false,
    world,
    markDirty() { dirty = true; },
    onMapEdits(ed) { editsLayer.update(ed, baseMap().seg, baseMap().ter); dirty = true; },
    focusHex(q, r) { world.focusHex(q, r, 0.9); },
    toggleMapMode() { mapMode.toggle(); },
    get mapMode() { return mapMode.active; },
    // true when the hex is well inside the screen (not near the borders)
    hexOnScreen(q, r, margin = 0.12) {
      const p = world.hexToWorld(q, r);
      const sp = world.projectToScreen(new THREE.Vector3(p.x, world.groundHeight(p.x, p.z), p.z));
      const w = canvas.clientWidth, h = canvas.clientHeight;
      return sp.visible && sp.x > w * margin && sp.x < w * (1 - margin) && sp.y > h * margin && sp.y < h * (1 - margin);
    },
    pingHex(q, r, color) { world.layers.addPing(q, r, color); },
    // Viewport pixels of a hex centre (ground level)
    hexScreen(q, r) {
      const p = world.hexToWorld(q, r);
      const sp = world.projectToScreen(new THREE.Vector3(p.x, world.standHeight(p.x, p.z), p.z));
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + sp.x, y: rect.top + sp.y, visible: sp.visible };
    },
    onEvent(event, data) {
      if (!view.active) return;
      dice.enabled = ui.dice();
      dice.onEvent(event, data, { colorOf: (id) => bridge.getPlayerColor(id), at: diceAt(data && (data.combatLog || data)) });
      // Automatic camera: frame where units are and where they go (see cameraDirector.js)
      if (event === 'playback_start' && data.hexes && data.hexes.length) {
        director.frame(data.hexes.map(([q, r, w]) => ({ q, r, w: w || 1 })), { force: true });
      } else if (event === 'unit_move_anim' && data.path && data.path.length) {
        const end = data.path[data.path.length - 1];
        director.observe([{ q: data.fromQ, r: data.fromR }, { q: end[0], r: end[1] }]);
      } else if (event === 'ambush') {
        director.observe([{ q: data.q, r: data.r, w: 3 }]);
      }
      if (event === 'combat_result') {
        const log = data.combatLog || data;
        const pts = [];
        if (log) for (const id of [log.attackerId, log.targetId]) { const u = id != null && shownUnits.find((x) => x.id === id); if (u && u.q != null) pts.push({ q: u.q, r: u.r, w: 3 }); }
        if (pts.length && !(log && log.duel)) director.observe(pts, { closeUp: !data.playback && ui.staging() });
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
          if (tgt) {
            const tA = anchorOf(tgt).clone();
            if (log.hit === false) ui.floatText(tA, 'Raté', 'miss', impact);
            else if (log.dmgReceived != null) ui.floatText(tA, `-${log.dmgReceived}`, '', impact);
            if (log.moralDmg) ui.floatText(tA.clone().setY(tA.y - 0.25), `-${log.moralDmg} moral`, 'morale', impact + 0.25);
            if (log.targetKilled) ui.floatText(tA.clone().setY(tA.y + 0.3), 'Détruite !', 'kill', impact + 0.5);
          }
          if (att && log.counterDmgReceived) ui.floatText(anchorOf(att).clone(), `-${log.counterDmgReceived}`, '', impact + 0.6);
          // slow-motion shot on the unit that is finished off
          const victim = log.targetKilled ? tgt : log.attackerKilled ? att : null;
          const killer = victim === tgt ? att : tgt;
          if (victim) killCam.trigger(anchorOf(victim), killer ? anchorOf(killer) : null, { delay: Math.max(0, impact - 0.25) });
        }
      } else if (event === 'ambush') {
        world.layers.addPing(data.q, data.r, '#ff3020');
        const u = shownUnits.find((x) => x.id === data.unitId);
        const p = world.hexToWorld(data.q, data.r);
        ui.floatText(new THREE.Vector3(p.x, world.groundHeight(p.x, p.z) + 0.8, p.z), 'Embuscade !', 'kill');
        if (u && units3d) units3d.playHit(u.id, { delay: 0.1 });
      } else if (event === 'objective_captured') {
        world.layers.addPing(data.q, data.r, data.owner ? bridge.getPlayerColor(data.owner) : '#ffd700');
        const p = world.hexToWorld(data.q, data.r);
        ui.floatText(new THREE.Vector3(p.x, world.groundHeight(p.x, p.z) + 1.9, p.z), `${data.name || 'Objectif'} capturé`, 'kill');
      } else if (event === 'ping') {
        world.layers.addPing(data.q, data.r, data.color || '#ffd700');
      }
      dirty = true;
    },
    killCam,
    setActive(on) {
      if (!on) mapMode.exit(true);
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
