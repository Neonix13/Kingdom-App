// 3D game view chrome: settings panel, photo mode, keyboard camera, floating combat text
import { attackTipHtml } from '../hud/attackTip.js';
import { createWalker } from './walker.js';
const CSS = `
#v3-gear { font-size:15px; }
#v3-settings { position:absolute; top:52px; left:64px; z-index:60; width:250px; padding:12px 14px; display:none;
  background:rgba(18,8,4,0.95); border:1px solid #5a3c10; border-radius:8px; color:#e8d5a0; font:12px 'Segoe UI',system-ui,sans-serif; }
#v3-settings.open { display:block; }
#v3-settings h4 { margin:0 0 8px; color:#ffd700; font-size:12px; letter-spacing:2px; }
#v3-settings label { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:6px 0; }
#v3-settings select, #v3-settings input[type=range] { width:120px; accent-color:#c8960c; background:#1a0e05; color:#e8d5a0; border:1px solid #5a3c10; border-radius:4px; }
#v3-settings .row { display:flex; gap:6px; margin-top:10px; }
#v3-settings button { flex:1; background:#2a1408; color:#e8d5a0; border:1px solid #5a3c10; border-radius:5px; padding:5px; cursor:pointer; font-size:11px; }
#v3-settings button:hover { border-color:#c8960c; }
#v3-settings .hint { color:#8e7a50; font-size:10.5px; line-height:1.5; margin-top:8px; }
body.v3-photo #toolbar, body.v3-photo #top-bar, body.v3-photo #sidebar, body.v3-photo #view3d-plates,
body.v3-photo .mode-indicator, body.v3-photo #turn-order-panel, body.v3-photo #v3-settings { display:none !important; }
#v3-photo-bar { position:fixed; bottom:16px; left:50%; transform:translateX(-50%); z-index:200; display:none; gap:8px; align-items:center;
  background:rgba(12,8,4,0.7); border:1px solid rgba(200,150,40,.4); border-radius:999px; padding:6px 10px; color:#e8d5a0; font:12px 'Segoe UI',system-ui,sans-serif; }
body.v3-photo #v3-photo-bar { display:flex; }
#v3-photo-bar button { background:#2a1408; color:#e8d5a0; border:1px solid #5a3c10; border-radius:999px; padding:4px 12px; cursor:pointer; }
#v3-photo-bar input { width:120px; accent-color:#c8960c; }
.v3-float { position:absolute; z-index:4; pointer-events:none; font:800 16px 'Segoe UI',system-ui,sans-serif; color:#ff5a3a;
  text-shadow:0 1px 2px #000, 0 0 8px rgba(0,0,0,.6); transform:translate(-50%,-50%); white-space:nowrap; }
.v3-float.morale { color:#7fb2ff; font-size:13px; }
.v3-float.miss { color:#d8d0b8; font-size:13px; }
.v3-float.kill { color:#ffd700; font-size:18px; }
#v3-tip { position:absolute; z-index:5; pointer-events:none; display:none; padding:7px 9px; border-radius:6px; max-width:230px;
  background:rgba(14,9,4,0.92); border:1px solid #7a2a10; color:#e8d5a0; font:11px/1.45 'Segoe UI',system-ui,sans-serif; }
#v3-tip b { color:#ffd700; }
#v3-tip .note { margin-top:4px; font-size:11px; color:#e8735a; }
#v3-tip .vs { display:grid; grid-template-columns:1fr auto 1fr; gap:2px 8px; margin-top:4px; }
#v3-tip .vs span:nth-child(3n+2) { color:#8e7a50; text-align:center; }
`;

const CAM_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'PageUp', 'PageDown']);
const DEFAULTS = { quality: 'auto', grid: 0.16, plates: 'auto', hour: 'auto', camSpeed: 1, staging: true, combatCard: 'full', combatClose: 'mine', followPlayback: true, dice: true, killCam: true, dof: true, colors: 'kingdom', fogStyle: 'dark', edgeScroll: true };

export function createGameUI({ world, container, bridge, getView }) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const { THREE, camera, controls } = world;

  const settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('kb_view3d_settings') || '{}') };
  const save = () => localStorage.setItem('kb_view3d_settings', JSON.stringify(settings));

  // --- Toolbar button + settings panel ---
  const toolbar = document.getElementById('toolbar');
  const gear = document.createElement('button');
  gear.className = 'tool-btn';
  gear.id = 'v3-gear';
  gear.title = 'Réglages 3D';
  gear.innerHTML = '&#9881;';
  const sep = document.createElement('div');
  sep.className = 'tool-separator';
  const btn3d = document.getElementById('tool-3d');
  const tbCam = document.getElementById('tb-cam');
  if (tbCam) {
    gear.className = 'tool-btn tb-row';
    gear.title = 'Réglages 3D : qualité, étiquettes, heure, caméra';
    gear.innerHTML = '<svg class="tb-ic" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"></path></svg><span>Réglages 3D</span>';
    tbCam.querySelector('.tb-h').after(gear);
  } else if (toolbar && btn3d) { btn3d.after(sep); sep.after(gear); }
  const panel = document.createElement('div');
  panel.id = 'v3-settings';
  const levelOpts = world.LEVELS.map((l, i) => `<option value="${i}">${l.name}</option>`).join('');
  panel.innerHTML = `
    <h4>RÉGLAGES 3D</h4>
    <label>Couleurs <select data-k="colors"><option value="kingdom">Kingdom (chaudes, contrastées)</option><option value="naturel">Naturelles</option></select></label>
    <label>Brouillard de guerre <select data-k="fogStyle"><option value="dark">Sombre (ciel noir)</option><option value="light">Léger (ciel normal)</option></select></label>
    <label>Qualité <select data-k="quality"><option value="auto">Auto (60 fps)</option>${levelOpts}</select></label>
    <label>Grille <input type="range" data-k="grid" min="0" max="0.5" step="0.02"></label>
    <label>Étiquettes <select data-k="plates"><option value="auto">Auto</option><option value="always">Toujours</option><option value="never">Jamais</option></select></label>
    <label>Heure <select data-k="hour"><option value="auto">Suit les tours</option><option value="6.5">Aube</option><option value="10">Matin</option><option value="13">Midi</option><option value="16.2">Après-midi</option><option value="18.2">Crépuscule</option><option value="20.3">Nuit</option></select></label>
    <label>Vitesse caméra <input type="range" data-k="camSpeed" min="0.4" max="2.5" step="0.1"></label>
    <label>Défilement par les bords de l'écran <input type="checkbox" data-k="edgeScroll"></label>
    <label>Mise en scène des combats <input type="checkbox" data-k="staging"></label>
    <label>Fiche de combat <select data-k="combatCard"><option value="full">Grande</option><option value="small">Petite</option><option value="off">Aucune</option></select></label>
    <label>Fermeture des fiches <select data-k="combatClose"><option value="mine">Manuelle pour mes combats</option><option value="manual">Toujours manuelle</option><option value="auto">Automatique</option></select></label>
    <label>Caméra qui suit l'action <input type="checkbox" data-k="followPlayback"></label>
    <label>Dés 3D <input type="checkbox" data-k="dice"></label>
    <label>Ralentis sur les unités détruites <input type="checkbox" data-k="killCam"></label>
    <label>Profondeur de champ <input type="checkbox" data-k="dof"></label>
    <div class="row"><button data-act="photo">Mode photo (P)</button><button data-act="top">Stratégie (M)</button></div>
    <div class="row"><button data-act="walk">Promenade sur le terrain (B)</button></div>
    <div class="hint">Caméra façon Total War / Baldur's Gate 3 : ZQSD / WASD / flèches ou souris au bord de l'écran : déplacer · A/E : pivoter · molette ou Page préc. / suiv. : zoom (la caméra se couche en s'approchant, plonge en s'éloignant) · clic molette ou clic droit maintenu : pivoter et incliner · Maj : plus vite · Fin : nord en haut · Origine ou Espace : centrer sur l'unité<br>
    Clic gauche : sélection · glisser : déplacer la vue · clic droit glissé depuis l'unité : orienter · Échap : désélectionner · B : promenade · M, Tab ou dézoom maximal : vue Stratégie</div>`;
  container.appendChild(panel);
  gear.addEventListener('click', (e) => { e.stopPropagation(); panel.classList.toggle('open'); });
  document.addEventListener('pointerdown', (e) => { if (!panel.contains(e.target) && e.target !== gear) panel.classList.remove('open'); });

  for (const el of panel.querySelectorAll('[data-k]')) {
    const k = el.dataset.k;
    if (el.type === 'checkbox') el.checked = !!settings[k];
    else el.value = String(settings[k]);
    el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
      settings[k] = el.type === 'checkbox' ? el.checked : (el.type === 'range' ? parseFloat(el.value) : el.value);
      save();
      apply(k);
    });
  }
  panel.querySelector('[data-act=photo]').addEventListener('click', () => setPhoto(true));
  panel.querySelector('[data-act=top]').addEventListener('click', () => { panel.classList.remove('open'); const v = getView(); if (v && v.toggleMapMode) v.toggleMapMode(); });
  panel.querySelector('[data-act=walk]').addEventListener('click', () => { panel.classList.remove('open'); walker.enter(); });

  function apply(k) {
    if (!k || k === 'quality') {
      const g = world.governor;
      if (settings.quality === 'auto') { g.locked = false; }
      else { g.locked = true; g.set(parseInt(settings.quality, 10)); }
    }
    if (!k || k === 'grid') world.setGrid(settings.grid);
    if (!k || k === 'dof') world.dof.setEnabled(settings.dof !== false);
    if ((!k || k === 'colors') && world.colors) world.colors.set(settings.colors || 'kingdom');
    if (!k || k === 'fogStyle') {
      if (world.setFogStyle) world.setFogStyle(settings.fogStyle);
      window.kbFogStyle = settings.fogStyle;
      if (k && typeof window.render === 'function') window.render();
    }
    if (!k || k === 'hour') applyHour();
  }
  function applyHour() {
    if (settings.hour === 'auto') {
      if (bridge.clockMoving) return;
      const st = bridge.state;
      let h;
      const dh = bridge.displayHour;
      if (typeof dh === 'number') h = dh;
      else if (st && typeof st.timeOfDay === 'number') h = st.timeOfDay;
      else h = 8 + (((st?.turn || 1) - 1) * 1.6 + ((st?.manche || 1) - 1) * 0.3) % 13;
      if (Math.abs(world.hour - h) > 0.05) animateHour(h);
    } else {
      const h = parseFloat(settings.hour);
      if (Math.abs(world.hour - h) > 0.05) world.commitTimeOfDay(h);
    }
  }
  // Smoothly sweep the sun to a new hour (wrapping forward through the night)
  let hourAnim = null;
  function animateHour(target) {
    let from = world.hour;
    let to = target;
    if (to < from - 0.05) to += 24;
    if (to - from > 12) { world.commitTimeOfDay(target); return; }
    hourAnim = { from, to, t: 0, dur: Math.min(3, 0.6 + (to - from) * 0.4) };
  }
  // While the game clock flows (resolution playback, eased hour changes), the sun follows it continuously;
  // light-only previews ~10 times a second, environment map refreshed once when the clock stops.
  let followAcc = 0, following = false;
  function updateHour(dt) {
    if (settings.hour === 'auto' && bridge.clockMoving) {
      hourAnim = null;
      following = true;
      followAcc += dt;
      if (followAcc >= 0.1) {
        followAcc = 0;
        const h = bridge.displayHour;
        if (typeof h === 'number' && Math.abs(h - world.hour) > 1e-4) world.previewTimeOfDay(h);
      }
      return;
    }
    if (following) {
      following = false;
      const h = bridge.displayHour;
      if (settings.hour === 'auto' && typeof h === 'number') world.commitTimeOfDay(h);
    }
    if (!hourAnim) return;
    hourAnim.t += dt / hourAnim.dur;
    const k = Math.min(1, hourAnim.t);
    const e = k * k * (3 - 2 * k);
    const h = (hourAnim.from + (hourAnim.to - hourAnim.from) * e) % 24;
    if (k >= 1) { world.commitTimeOfDay(h); hourAnim = null; }
    else world.previewTimeOfDay(h);
  }
  apply();

  // --- Photo mode ---
  const photoBar = document.createElement('div');
  photoBar.id = 'v3-photo-bar';
  photoBar.innerHTML = `<span>Mode photo</span><label>Heure <input type="range" min="5.5" max="20.5" step="0.05"></label>
    <button data-act="shot">Capture</button><button data-act="exit">Quitter (Échap)</button>`;
  document.body.appendChild(photoBar);
  const hourSlider = photoBar.querySelector('input');
  hourSlider.addEventListener('input', () => world.previewTimeOfDay(parseFloat(hourSlider.value)));
  hourSlider.addEventListener('change', () => world.commitTimeOfDay(parseFloat(hourSlider.value)));
  photoBar.querySelector('[data-act=exit]').addEventListener('click', () => setPhoto(false));
  photoBar.querySelector('[data-act=shot]').addEventListener('click', screenshot);
  const walkBtn = document.createElement('button');
  walkBtn.type = 'button';
  walkBtn.textContent = 'Promenade (B)';
  walkBtn.addEventListener('click', () => walker.enter());
  photoBar.querySelector('[data-act=exit]').before(walkBtn);
  let photo = false;
  let photoBeforeWalk = false;
  const walker = createWalker(world, {
    container,
    onEnter: () => { photoBeforeWalk = photo; if (!photo) setPhoto(true); },
    onExit: () => { if (!photoBeforeWalk) setPhoto(false); },
  });
  const savedLimits = { maxPolar: controls.maxPolarAngle, maxDist: controls.maxDistance, min: controls.minDistance };
  function setPhoto(on) {
    photo = on;
    document.body.classList.toggle('v3-photo', on);
    panel.classList.remove('open');
    controls.maxPolarAngle = on ? Math.PI / 2.02 : savedLimits.maxPolar;
    controls.minDistance = on ? 0.8 : savedLimits.min;
    hourSlider.value = world.hour;
    world.resize();
  }
  function screenshot() {
    world.renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `kingdom-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  }

  // --- Keyboard camera ---
  const keys = new Set();
  const editable = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  window.addEventListener('keydown', (e) => {
    const view = getView();
    if (!view || !view.active || editable(document.activeElement) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (CAM_CODES.has(e.code)) {
      keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code.startsWith('Page')) e.preventDefault();
      return;
    }
    if (walker.active) return;
    if (e.code === 'KeyB') { if (!view.mapMode) walker.enter(); return; }
    // Strategy view: M, or Tab (the tactical map of Total War); O stays "orient the unit"
    if (e.code === 'KeyM' || e.code === 'Tab') { e.preventDefault(); view.toggleMapMode && view.toggleMapMode(); }
    // End: back to the default heading (north at the top), as in Total War
    else if (e.code === 'End') { e.preventDefault(); resetHeading = true; }
    // Home: centre on the selected unit (Baldur's Gate 3), like Space
    else if (e.code === 'Home') {
      e.preventDefault();
      const st = bridge.state;
      const u = bridge.selectedUnit || (st?.units || []).find((x) => x.isMine && x.isGeneral && x.q != null);
      if (u && u.q != null) world.focusHex(u.q, u.r, 0.7);
    }
    else if (k === 'p') setPhoto(!photo);
    else if (k === 'escape') { if (view.mapMode) view.toggleMapMode(); else if (photo) setPhoto(false); else bridge.deselect && bridge.deselect(); }
    else if (k === ' ') {
      e.preventDefault();
      const st = bridge.state;
      const u = bridge.selectedUnit || (st?.units || []).find((x) => x.isMine && x.isGeneral && x.q != null);
      if (u && u.q != null) world.focusHex(u.q, u.r, 0.7);
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); mouse.in = false; });
  // Total War: Shift speeds the camera up; the mouse at the edge of the screen scrolls the view
  let shift = false;
  window.addEventListener('keydown', (e) => { if (e.key === 'Shift') shift = true; }, true);
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift') shift = false; }, true);
  const mouse = { x: 0, y: 0, in: false, onView: false, buttons: 0 };
  window.addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.in = true; mouse.buttons = e.buttons; mouse.onView = e.target === world.renderer.domElement; });
  document.addEventListener('pointerleave', () => { mouse.in = false; });
  document.addEventListener('mouseout', (e) => { if (!e.relatedTarget) mouse.in = false; });
  const EDGE = 14;
  function edgeDir() {
    if (!settings.edgeScroll || !mouse.in || mouse.buttons || !document.hasFocus()) return null;
    const w = window.innerWidth, h = window.innerHeight;
    // only from the 3D view itself, or right at the very border of the window (HUD panels do not scroll)
    const atBorder = mouse.x <= 2 || mouse.y <= 2 || mouse.x >= w - 3 || mouse.y >= h - 3;
    if (!mouse.onView && !atBorder) return null;
    const dx = mouse.x < EDGE ? -1 : mouse.x > w - EDGE ? 1 : 0;
    const dy = mouse.y < EDGE ? 1 : mouse.y > h - EDGE ? -1 : 0;
    return dx || dy ? { dx, dy } : null;
  }
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();

  // Keyboard / edge camera with inertia (Total War, Baldur's Gate 3): the speed eases in when a key is held and eases out
  // when it is released, instead of starting and stopping dead. vel: pan (world units/s, in the camera's ground frame),
  // rotVel (rad/s), zoomVel (relative distance/s)
  const vel = new THREE.Vector2(), want = new THREE.Vector2();
  let rotVel = 0, zoomVel = 0, resetHeading = false;
  const ease = (cur, target, dt, up = 9, down = 6) => cur + (target - cur) * Math.min(1, dt * (Math.abs(target) > Math.abs(cur) ? up : down));
  function update(dt) {
    if (walker.active) { vel.set(0, 0); rotVel = zoomVel = 0; return; }
    const view = getView();
    const edge = photo || (view && view.mapMode) ? null : edgeDir();
    const dist = camera.position.distanceTo(controls.target);
    const sp = (shift ? 2.2 : 1) * dist * 0.9 * settings.camSpeed * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(21));
    // Physical key codes: WASD on QWERTY = ZQSD on AZERTY; Q/E (A/E on AZERTY) rotate
    want.set(0, 0);
    if (keys.has('KeyW') || keys.has('ArrowUp')) want.y += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) want.y -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) want.x += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) want.x -= 1;
    if (edge) { want.x += edge.dx; want.y += edge.dy; }
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(sp);
    vel.x = ease(vel.x, want.x, dt); vel.y = ease(vel.y, want.y, dt);
    const rotWant = ((keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0)) * 1.4 * settings.camSpeed * (shift ? 1.8 : 1);
    rotVel = ease(rotVel, rotWant, dt, 8, 6);
    const zoomWant = ((keys.has('Minus') || keys.has('NumpadSubtract') || keys.has('PageDown') ? 1 : 0) - (keys.has('Equal') || keys.has('NumpadAdd') || keys.has('PageUp') ? 1 : 0)) * 1.6;
    zoomVel = ease(zoomVel, zoomWant, dt, 8, 7);
    if (Math.abs(vel.x) + Math.abs(vel.y) > 1e-4) {
      camera.getWorldDirection(fwd);
      fwd.y = 0; fwd.normalize();
      right.crossVectors(fwd, camera.up).normalize();
      move.set(0, 0, 0).addScaledVector(fwd, vel.y * dt).addScaledVector(right, vel.x * dt);
      camera.position.add(move);
      controls.target.add(move);
    } else vel.set(0, 0);
    if (Math.abs(rotVel) > 1e-4) {
      const off = camera.position.clone().sub(controls.target);
      off.applyAxisAngle(camera.up, -rotVel * dt);
      camera.position.copy(controls.target).add(off);
    } else rotVel = 0;
    if (resetHeading) {
      // ease the heading back to north (camera south of its target, looking toward −z)
      const off = camera.position.clone().sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(off);
      let d = 0 - sph.theta;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) < 0.003) { sph.theta = 0; resetHeading = false; } else sph.theta += d * Math.min(1, dt * 7);
      camera.position.copy(controls.target).add(off.setFromSpherical(sph));
    }
    if (Math.abs(zoomVel) > 1e-4) {
      window.kbCamZoomAt = performance.now();
      const off = camera.position.clone().sub(controls.target);
      const len = Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length() * (1 + zoomVel * dt)));
      camera.position.copy(controls.target).add(off.setLength(len));
    } else zoomVel = 0;
  }

  // --- Floating combat text + attack tooltip ---
  const floats = [];
  function floatText(anchor, text, cls = '', delay = 0) {
    const el = document.createElement('div');
    el.className = 'v3-float ' + cls;
    el.textContent = text;
    el.style.opacity = '0';
    container.appendChild(el);
    floats.push({ el, p: anchor.clone(), t: -delay, life: 1.8 });
  }
  function updateFloats(dt) {
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.t += dt;
      if (f.t < 0) continue;
      const k = f.t / f.life;
      const s = world.projectToScreen(f.p.clone().setY(f.p.y + 0.35 + k * 0.9));
      f.el.style.left = s.x + 'px';
      f.el.style.top = s.y + 'px';
      f.el.style.opacity = String(Math.min(1, f.t * 6) * (1 - Math.max(0, k - 0.6) / 0.4));
      if (k >= 1) { f.el.remove(); floats.splice(i, 1); }
    }
  }

  const tip = document.createElement('div');
  tip.id = 'v3-tip';
  container.appendChild(tip);
  function showAttackTip(att, tgt, e) {
    if (!att || !tgt || !e) { tip.style.display = 'none'; return; }
    const rect = container.getBoundingClientRect();
    const ap = window.gameBridge && window.gameBridge.approachAt ? window.gameBridge.approachAt(`${tgt.q},${tgt.r}`) : null;
    tip.innerHTML = attackTipHtml(att, tgt, window.gameBridge && window.gameBridge.unitTypes, ap);
    tip.style.display = 'block';
    tip.style.left = Math.min(rect.width - 240, e.clientX - rect.left + 16) + 'px';
    tip.style.top = Math.max(8, e.clientY - rect.top - 10) + 'px';
  }

  return {
    settings,
    update(dt) { update(dt); updateFloats(dt); updateHour(dt); },
    floatText,
    showAttackTip,
    applyHour,
    get photo() { return photo; },
    platesMode() { return settings.plates; },
    staging() { return !!settings.staging; },
    followPlayback() { return settings.followPlayback !== false && !walker.active; },
    walker,
    dice() { return settings.dice !== false; },
    killCam() { return settings.killCam !== false; },
    hide(on) { gear.style.display = on ? 'none' : ''; sep.style.display = on ? 'none' : ''; if (on) { walker.exit(); panel.classList.remove('open'); setPhoto(false); } },
  };
}
