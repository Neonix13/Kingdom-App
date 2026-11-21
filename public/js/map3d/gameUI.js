// 3D game view chrome: settings panel, photo mode, keyboard camera, floating combat text
import { attackTipHtml } from '../hud/attackTip.js';
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

const CAM_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']);
const DEFAULTS = { quality: 'auto', grid: 0.16, plates: 'auto', hour: 'auto', camSpeed: 1, staging: true, combatCard: 'full', followPlayback: true, dice: true };

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
    <label>Qualité <select data-k="quality"><option value="auto">Auto (60 fps)</option>${levelOpts}</select></label>
    <label>Grille <input type="range" data-k="grid" min="0" max="0.5" step="0.02"></label>
    <label>Étiquettes <select data-k="plates"><option value="auto">Auto</option><option value="always">Toujours</option><option value="never">Jamais</option></select></label>
    <label>Heure <select data-k="hour"><option value="auto">Suit les tours</option><option value="6.5">Aube</option><option value="10">Matin</option><option value="13">Midi</option><option value="16.2">Après-midi</option><option value="18.2">Crépuscule</option><option value="20.3">Nuit</option></select></label>
    <label>Vitesse caméra <input type="range" data-k="camSpeed" min="0.4" max="2.5" step="0.1"></label>
    <label>Mise en scène des combats <input type="checkbox" data-k="staging"></label>
    <label>Fiche de combat <select data-k="combatCard"><option value="full">Grande</option><option value="small">Petite</option><option value="off">Aucune</option></select></label>
    <label>Caméra qui suit l'action <input type="checkbox" data-k="followPlayback"></label>
    <label>Dés 3D <input type="checkbox" data-k="dice"></label>
    <div class="row"><button data-act="photo">Mode photo (P)</button><button data-act="top">Vue du dessus (T)</button></div>
    <div class="hint">Clic gauche : sélection · glisser : déplacer la vue · clic droit glissé : pivoter · molette : zoom<br>
    ZQSD / WASD / flèches : déplacer · A/E : pivoter · Espace : centrer sur l’unité · Échap : désélectionner</div>`;
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
  panel.querySelector('[data-act=top]').addEventListener('click', () => toggleTopDown());

  function apply(k) {
    if (!k || k === 'quality') {
      const g = world.governor;
      if (settings.quality === 'auto') { g.locked = false; }
      else { g.locked = true; g.set(parseInt(settings.quality, 10)); }
    }
    if (!k || k === 'grid') world.setGrid(settings.grid);
    if (!k || k === 'hour') applyHour();
  }
  function applyHour() {
    if (settings.hour === 'auto') {
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
  function updateHour(dt) {
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
  let photo = false;
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
  let topDown = null;
  function toggleTopDown() {
    if (topDown) {
      world.flyTo(topDown.p, topDown.t, 0.8);
      topDown = null;
    } else {
      topDown = { p: camera.position.clone(), t: controls.target.clone() };
      const t = controls.target.clone();
      world.flyTo(new THREE.Vector3(t.x, t.y + 46, t.z + 0.5), t, 0.8);
    }
  }
  const editable = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  window.addEventListener('keydown', (e) => {
    const view = getView();
    if (!view || !view.active || editable(document.activeElement) || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (CAM_CODES.has(e.code)) {
      keys.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
      return;
    }
    if (k === 'p') setPhoto(!photo);
    else if (k === 'escape') { if (photo) setPhoto(false); else bridge.deselect && bridge.deselect(); }
    else if (k === 't') toggleTopDown();
    else if (k === ' ') {
      e.preventDefault();
      const st = bridge.state;
      const u = bridge.selectedUnit || (st?.units || []).find((x) => x.isMine && x.isGeneral && x.q != null);
      if (u && u.q != null) world.focusHex(u.q, u.r, 0.7);
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();

  function update(dt) {
    if (!keys.size) return;
    const dist = camera.position.distanceTo(controls.target);
    const sp = dist * 0.9 * settings.camSpeed * dt;
    camera.getWorldDirection(fwd);
    fwd.y = 0; fwd.normalize();
    right.crossVectors(fwd, camera.up).normalize();
    move.set(0, 0, 0);
    // Physical key codes: WASD on QWERTY = ZQSD on AZERTY; Q/E (A/E on AZERTY) rotate
    if (keys.has('KeyW') || keys.has('ArrowUp')) move.add(fwd);
    if (keys.has('KeyS') || keys.has('ArrowDown')) move.sub(fwd);
    if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) move.sub(right);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(sp);
      camera.position.add(move);
      controls.target.add(move);
    }
    const rot = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
    if (rot) {
      const off = camera.position.clone().sub(controls.target);
      off.applyAxisAngle(camera.up, -rot * dt * 1.4 * settings.camSpeed);
      camera.position.copy(controls.target).add(off);
    }
    const zoom = (keys.has('Minus') || keys.has('NumpadSubtract') ? 1 : 0) - (keys.has('Equal') || keys.has('NumpadAdd') ? 1 : 0);
    if (zoom) {
      const off = camera.position.clone().sub(controls.target);
      const len = Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length() * (1 + zoom * dt * 1.6)));
      camera.position.copy(controls.target).add(off.setLength(len));
    }
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
    followPlayback() { return settings.followPlayback !== false; },
    dice() { return settings.dice !== false; },
    hide(on) { gear.style.display = on ? 'none' : ''; sep.style.display = on ? 'none' : ''; if (on) { panel.classList.remove('open'); setPhoto(false); } },
  };
}
