// Map mode (M): the camera eases to a top-down view while its field of view narrows, then an orthographic
// camera takes over (no perspective). Wheel zooms, drag pans, no rotation. M again (or Esc) eases back to the
// exact previous view. The perspective camera stays the rig driven by OrbitControls; the orthographic camera
// copies its framing every frame, so picking, projections and camera moves keep working.
const STYLE = `
#hud-root .hud-ibtn[hidden] { display: none; }
body.v3-map #view3d-plates .u3-plate { transform-origin: 0 0; }
body.v3-map #view3d-plates .u3-plate:not(.sel):not(.hov) { padding: 0; }
body.v3-map #view3d-plates .u3-plate:not(.sel):not(.hov) .u3-gauges,
body.v3-map #view3d-plates .u3-plate:not(.sel):not(.hov) .st,
body.v3-map #view3d-plates .u3-plate:not(.sel):not(.hov) .u3-tags { display: none; }
body.v3-map #view3d-plates .u3-plate:not(.sel):not(.hov) .u3-main { right: 3px; }
body.v3-map .v3-map-chip.show { display: flex; }
.v3-map-chip { display: none; position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 60; align-items: center; gap: 10px;
  padding: 6px 14px; background: #000; color: #fff; border: 2px solid #fff; box-shadow: 0 0 0 2px #000, 4px 4px 0 #D8352A;
  font: 700 12px 'Zen Kaku Gothic New', system-ui, sans-serif; letter-spacing: .5px; pointer-events: none; }
.v3-map-chip b { font-family: 'Dela Gothic One', sans-serif; font-weight: 400; letter-spacing: 1px; }
.v3-map-chip kbd { border: 1.5px solid #fff; padding: 0 5px; font: 900 11px 'Zen Kaku Gothic New', sans-serif; }
body.v3-map.hud-d .v3-map-chip { bottom: auto; top: 196px; }
`;

const MAP_FOV = 9;
// furthest zoom of the Strategy view: about 22 world units of ground on the screen's height (a dozen hexes)
const MAX_HALF_H = 11;
const maxStrategyDistance = () => MAX_HALF_H / Math.tan(MAP_FOV * Math.PI / 360);
const DUR_IN = 0.85, DUR_OUT = 0.75;
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export function createMapMode(world, { onChange } = {}) {
  const { THREE, camera, controls } = world;
  if (!document.getElementById('v3-map-style')) {
    const st = document.createElement('style');
    st.id = 'v3-map-style';
    st.textContent = STYLE;
    document.head.appendChild(st);
  }
  const chip = document.createElement('div');
  chip.className = 'v3-map-chip';
  chip.innerHTML = '<b>STRATÉGIE</b> molette : zoom (à fond : retour à la bataille) · glisser : déplacer · <kbd>M</kbd> ou <kbd>Échap</kbd> : revenir';
  document.body.appendChild(chip);

  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 900);
  let state = 'off'; // off | in | on | out
  let saved = null;
  let anim = null;
  const _off = new THREE.Vector3(), _s = new THREE.Spherical(), _s0 = new THREE.Spherical(), _s1 = new THREE.Spherical();

  // distance at which the perspective camera (fov) frames the whole board from above
  function fitDistance(fov) {
    const b = world.bounds;
    const aspect = world.aspect();
    const halfH = Math.max((b.bz1 - b.bz0) / 2, (b.bx1 - b.bx0) / 2 / aspect) * 1.06;
    return halfH / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  }

  function syncOrtho() {
    const dist = camera.position.distanceTo(controls.target);
    const halfH = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const aspect = world.aspect();
    ortho.left = -halfH * aspect; ortho.right = halfH * aspect;
    ortho.top = halfH; ortho.bottom = -halfH;
    _off.copy(camera.position).sub(controls.target).normalize();
    ortho.position.copy(controls.target).addScaledVector(_off, 120);
    ortho.quaternion.copy(camera.quaternion);
    ortho.updateProjectionMatrix();
    ortho.updateMatrixWorld();
  }

  function frame(dt) {
    if (anim) {
      anim.t = Math.min(1, anim.t + dt / anim.dur);
      const k = ease(anim.t);
      let dTheta = anim.s1.theta - anim.s0.theta;
      if (dTheta > Math.PI) dTheta -= Math.PI * 2;
      if (dTheta < -Math.PI) dTheta += Math.PI * 2;
      const r = Math.exp(Math.log(anim.s0.radius) + (Math.log(anim.s1.radius) - Math.log(anim.s0.radius)) * k);
      _s.set(r, anim.s0.phi + (anim.s1.phi - anim.s0.phi) * k, anim.s0.theta + dTheta * k);
      controls.target.copy(anim.t0).lerp(anim.t1, k);
      camera.position.copy(controls.target).add(_off.setFromSpherical(_s));
      // narrowing the field of view while backing off keeps the framing and flattens the perspective
      const tanF = Math.tan(THREE.MathUtils.degToRad(anim.f0) / 2) + (Math.tan(THREE.MathUtils.degToRad(anim.f1) / 2) - Math.tan(THREE.MathUtils.degToRad(anim.f0) / 2)) * k;
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanF));
      camera.updateProjectionMatrix();
      camera.lookAt(controls.target);
      if (anim.t >= 1) {
        const done = anim.done;
        anim = null;
        done();
      }
    }
    if (state === 'on') syncOrtho();
  }
  world.frameHooks.unshift(frame);
  world.resizeHooks.push(() => { if (state === 'on') syncOrtho(); });

  function startAnim(toT, toS, toFov, dur, done) {
    world.stopFly();
    _s0.setFromVector3(_off.copy(camera.position).sub(controls.target));
    anim = { t: 0, dur, t0: controls.target.clone(), t1: toT.clone(), s0: _s0.clone(), s1: toS.clone(), f0: camera.fov, f1: toFov, done };
  }

  function enter() {
    if (state !== 'off' || world.viewCamera !== camera) return;
    saved = {
      p: camera.position.clone(), t: controls.target.clone(), fov: camera.fov,
      min: controls.minDistance, max: controls.maxDistance, rotate: controls.enableRotate,
      buttons: { ...controls.mouseButtons }, grid: world.grid,
      fog: world.scene.fog ? world.scene.fog.density : null, clouds: world.clouds ? world.clouds.visible : null,
      guard: world.camGuard ? world.camGuard.enabled : null, dof: world.dof ? world.dof.user : null,
    };
    // the obstacle guard and the depth of field are made for the orbit view: off while the map is shown
    if (world.camGuard) world.camGuard.enabled = false;
    if (world.dof) world.dof.setEnabled(false);
    state = 'in';
    controls.minDistance = 0.01;
    controls.maxDistance = 1e6;
    controls.enableRotate = false;
    // seen from far above: no haze, no cloud layer between the camera and the board, a stronger grid
    world.setGrid(Math.max(0.24, saved.grid));
    if (world.scene.fog) world.scene.fog.density = 0.0006;
    if (world.clouds) world.clouds.visible = false;
    const b = world.bounds;
    const fit = fitDistance(MAP_FOV), cap = maxStrategyDistance();
    // the whole map when it fits within the zoom limit, else the place the player was looking at
    const center = fit <= cap ? new THREE.Vector3((b.bx0 + b.bx1) / 2, 0, (b.bz0 + b.bz1) / 2) : controls.target.clone();
    center.y = world.groundHeight(center.x, center.z);
    const dist = Math.min(fit, cap);
    // theta 0: north (−z) at the top of the screen, like the 2D board
    startAnim(center, new THREE.Spherical(dist, 0.0004, 0), MAP_FOV, DUR_IN, () => {
      state = 'on';
      controls.minDistance = fitDistance(MAP_FOV) * 0.06;
      controls.maxDistance = Math.min(fitDistance(MAP_FOV) * 1.05, maxStrategyDistance()); // whole map at most, and the zoom limit
      controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      controls.screenSpacePanning = false;
      syncOrtho();
      world.setViewCamera(ortho);
      // camera moves requested by the game (auto camera, focus on a unit) become pans in map mode
      world.setFlyFilter((toPos, toTarget) => {
        const off = camera.position.clone().sub(controls.target);
        const t = toTarget.clone();
        return { p: t.clone().add(off), t };
      });
      document.body.classList.add('v3-map');
      chip.classList.add('show');
      clearTimeout(chip._t);
      chip._t = setTimeout(() => chip.classList.remove('show'), 4000);
      onChange && onChange(true);
    });
    onChange && onChange(true);
  }

  function restoreSettings() {
    controls.minDistance = saved.min;
    controls.maxDistance = saved.max;
    controls.enableRotate = saved.rotate;
    controls.mouseButtons = saved.buttons;
    world.setGrid(saved.grid);
    if (world.scene.fog && saved.fog != null) world.scene.fog.density = saved.fog;
    if (world.clouds && saved.clouds != null) world.clouds.visible = saved.clouds;
    if (world.camGuard && saved.guard != null) world.camGuard.enabled = saved.guard;
    if (world.dof && saved.dof != null) world.dof.setEnabled(saved.dof);
  }

  function exit(instant = false) {
    if (state === 'off' || state === 'out') return;
    const back = saved;
    world.setFlyFilter(null);
    world.setViewCamera(camera);
    document.body.classList.remove('v3-map');
    chip.classList.remove('show');
    const finish = () => {
      anim = null;
      restoreSettings();
      camera.fov = back.fov;
      camera.updateProjectionMatrix();
      camera.position.copy(back.p);
      controls.target.copy(back.t);
      camera.lookAt(back.t);
      controls.update();
      state = 'off';
      saved = null;
      onChange && onChange(false);
    };
    if (instant) { finish(); return; }
    state = 'out';
    controls.minDistance = 0.01;
    controls.maxDistance = 1e6;
    startAnim(back.t, new THREE.Spherical().setFromVector3(back.p.clone().sub(back.t)), back.fov, DUR_OUT, finish);
  }

  function toggle() {
    if (state === 'off') enter();
    else if (state === 'on' || state === 'in') exit();
  }

  return {
    toggle, enter, exit,
    get active() { return state !== 'off'; },
    get state() { return state; },
    camera: ortho,
  };
}
