import * as THREE from 'three';

// Camera rig. The orbit camera driven by OrbitControls, flyTo, the auto camera and the keyboard is the DESIRED
// camera: nothing here ever modifies it. A separate RENDER camera is derived from it every frame:
// - wheel zoom is smoothed (spring on the distance), the orbit target is lifted above the ground under it;
// - when the line from the target to the camera runs into the scenery (terrain, walls, roofs, trees: a top-down
//   "highest surface" map baked once), the render camera first raises its pitch, then if needed comes closer;
// - every correction goes through critically damped springs with hysteresis, so it never pops, and fades back to
//   the desired view as soon as the way is clear.
// Rendering, picking and projections use the render camera.

const OFFSET = 100; // stored as height + OFFSET so that an empty texel (0) means "nothing here"

export function bakeObstacleHeights(renderer, scene, { x0, z0, x1, z1 }, { hide = [], size = 1024 } = {}) {
  const floatOk = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
  const type = floatOk ? THREE.FloatType : THREE.HalfFloatType;
  const rt = new THREE.WebGLRenderTarget(size, size, { type, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
  const w = x1 - x0, h = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 1, 4000);
  cam.up.set(0, 0, -1);
  cam.position.set(cx, 1500, cz);
  cam.lookAt(cx, 0, cz);
  cam.updateMatrixWorld();
  const mat = new THREE.ShaderMaterial({
    defines: { DISTANCE: '' },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      #include <common>
      varying float vY;
      void main() {
        #include <begin_vertex>
        #include <project_vertex>
        #include <worldpos_vertex>
        vY = worldPosition.y;
      }`,
    fragmentShader: /* glsl */`
      varying float vY;
      void main() { gl_FragColor = vec4( vY + ${OFFSET.toFixed(1)}, 0.0, 0.0, 1.0 ); }`,
  });
  const hidden = [];
  const hideObj = (o) => { if (o && o.visible) { o.visible = false; hidden.push(o); } };
  for (const o of hide) hideObj(o);
  scene.traverse((o) => { if (o.isSprite || o.isPoints) hideObj(o); });
  const prevOverride = scene.overrideMaterial, prevBg = scene.background, prevFog = scene.fog;
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
  scene.overrideMaterial = mat;
  scene.background = null;
  scene.fog = null;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  const raw = floatOk ? new Float32Array(size * size * 4) : new Uint16Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, raw);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  scene.overrideMaterial = prevOverride;
  scene.background = prevBg;
  scene.fog = prevFog;
  for (const o of hidden) o.visible = true;
  rt.dispose();
  mat.dispose();

  const val = (k) => (floatOk ? raw[k] : THREE.DataUtils.fromHalfFloat(raw[k]));
  const top = new Float32Array(size * size).fill(-Infinity);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const v = val((j * size + i) * 4);
      if (v > 0) top[j * size + i] = v - OFFSET;
    }
  }
  // dilate by one texel: conservative around thin walls and roof edges
  const grown = new Float32Array(top);
  for (let j = 1; j < size - 1; j++) {
    for (let i = 1; i < size - 1; i++) {
      let m = top[j * size + i];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const v = top[(j + dj) * size + i + di]; if (v > m) m = v; }
      grown[j * size + i] = m;
    }
  }
  // texel row 0 is the bottom of the image, i.e. the +z edge (screen up is -z)
  return function sample(x, z) {
    const i = Math.floor(((x - x0) / w) * size);
    const j = Math.floor(((z1 - z) / h) * size);
    if (i < 0 || j < 0 || i >= size || j >= size) return -Infinity;
    return grown[j * size + i];
  };
}

// Smooth "camera floor": highest surface dilated then box-blurred on a coarse grid, bilinearly sampled.
// Continuous (no steps at wall edges) and never below the raw surface at the grid nodes.
function buildFloor(surface, { x0, z0, x1, z1 }, cell = 0.5) {
  const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
  let a = new Float32Array(nx * nz), b = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const v = surface(x0 + i * cell, z0 + j * cell);
    a[j * nx + i] = Number.isFinite(v) ? v : -50;
  }
  const pass = (src, dst, r, op) => {
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let m = op === 'max' ? -Infinity : 0, n = 0;
      for (let d = -r; d <= r; d++) { const ii = Math.min(nx - 1, Math.max(0, i + d)); const v = src[j * nx + ii]; if (op === 'max') { if (v > m) m = v; } else { m += v; n++; } }
      dst[j * nx + i] = op === 'max' ? m : m / n;
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) src[j * nx + i] = dst[j * nx + i];
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      let m = op === 'max' ? -Infinity : 0, n = 0;
      for (let d = -r; d <= r; d++) { const jj = Math.min(nz - 1, Math.max(0, j + d)); const v = src[jj * nx + i]; if (op === 'max') { if (v > m) m = v; } else { m += v; n++; } }
      dst[j * nx + i] = op === 'max' ? m : m / n;
    }
    return dst;
  };
  b = pass(a, b, 3, 'max'); [a, b] = [b, a];
  b = pass(a, b, 2, 'avg'); [a, b] = [b, a];
  return function floor(x, z) {
    const fx = (x - x0) / cell, fz = (z - z0) / cell;
    if (fx < 0 || fz < 0 || fx > nx - 1 || fz > nz - 1) return surface(x, z);
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(nz - 2, Math.floor(fz));
    const u = fx - i, v = fz - j;
    const k = j * nx + i;
    return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + nx] * (1 - u) + a[k + nx + 1] * u) * v;
  };
}

// critically damped spring step (x toward target, velocity v), stable for any dt
function spring(st, target, omega, dt) {
  const x = st.x - target;
  const e = Math.exp(-omega * dt);
  const nx = (x + (st.v + omega * x) * dt) * e;
  st.v = (st.v - omega * (st.v + omega * x) * dt) * e;
  st.x = target + nx;
  return st.x;
}

export function createCameraGuard({ camera, controls, top, groundHeight, bounds, renderCam = null }) {
  renderCam = renderCam || new THREE.PerspectiveCamera(camera.fov, camera.aspect, camera.near, camera.far);
  renderCam.position.copy(camera.position);
  renderCam.quaternion.copy(camera.quaternion);
  const surface = (x, z) => { const t = top(x, z); const g = groundHeight(x, z); return Math.max(Number.isFinite(t) ? t : -Infinity, Number.isFinite(g) ? g : -Infinity); };
  const floor = bounds ? buildFloor(surface, bounds) : surface;

  const NEAR_ZONE = 3.5;               // length of the target→camera segment, from the camera, kept clear
  const PHI_MIN = 0.12;                // highest pitch the rig may use to see over an obstacle (rad from vertical)
  const dist = { x: 0, v: 0 }, lift = { x: 0, v: 0 }, dphi = { x: 0, v: 0 }, shrink = { x: 0, v: 0 };
  const lastT = new THREE.Vector3(), Tr = new THREE.Vector3(), off = new THREE.Vector3(), pos = new THREE.Vector3();
  const sph = new THREE.Spherical();
  let primed = false, enabled = true;
  const stats = { adjusted: false, blockedFrames: 0, lastJump: 0 };

  // first distance along (phi, theta) from Tr where the segment runs into the scenery, or null if clear
  function firstBlock(phi, theta, d, extra) {
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const dx = sp * Math.sin(theta), dy = cp, dz = sp * Math.cos(theta);
    // only the stretch right in front of the lens matters: scenery between the camera and a distant target may
    // hide it (like in any strategy game), but never sits on the lens or around it
    const ignore = Math.max(Math.min(2.0, 0.3 * d), d - NEAR_ZONE);
    const step = Math.min(0.6, Math.max(0.15, d * 0.02));
    for (let s = ignore; s <= d + 1e-6; s += step) {
      const x = Tr.x + dx * s, y = Tr.y + dy * s, z = Tr.z + dz * s;
      const m = 0.15 + 0.35 * Math.min(1, s / 4) + extra;
      if (y < surface(x, z) + m) return s;
    }
    const ex = Tr.x + dx * d, ey = Tr.y + dy * d, ez = Tr.z + dz * d;
    if (ey < floor(ex, ez) + 0.35 + extra) return d;
    return null;
  }

  function syncOptics() {
    if (renderCam.fov !== camera.fov || renderCam.aspect !== camera.aspect || renderCam.near !== camera.near || renderCam.far !== camera.far || renderCam.zoom !== camera.zoom) {
      renderCam.fov = camera.fov; renderCam.aspect = camera.aspect; renderCam.near = camera.near; renderCam.far = camera.far; renderCam.zoom = camera.zoom;
      renderCam.updateProjectionMatrix();
    }
    renderCam.up.copy(camera.up);
  }

  function snapToDesired() {
    renderCam.position.copy(camera.position);
    renderCam.quaternion.copy(camera.quaternion);
    renderCam.updateMatrixWorld();
    primed = false;
  }

  function update(dt) {
    syncOptics();
    const T = controls.target, P = camera.position;
    off.subVectors(P, T);
    const L = off.length();
    if (L < 1e-4) { snapToDesired(); return; }
    sph.setFromVector3(off);
    dt = Math.min(Math.max(dt, 0), 0.1);
    // teleports (applyView, instant focus, mode switches): no spring across them
    if (!primed || lastT.distanceTo(T) > 6) {
      dist.x = L; dist.v = 0;
      lift.x = enabled ? Math.max(0, groundHeight(T.x, T.z) - T.y) : 0; lift.v = 0;
      if (!primed) { dphi.x = dphi.v = shrink.x = shrink.v = 0; }
      primed = true;
    }
    lastT.copy(T);
    // disabled (map mode, promenade): corrections fade out, then the render camera is the desired one exactly
    if (!enabled) {
      dist.x = L; dist.v = 0;
      spring(lift, 0, 10, dt);
      spring(dphi, 0, 6, dt);
      spring(shrink, 0, 6, dt);
      if (Math.abs(lift.x) < 1e-4 && Math.abs(dphi.x) < 1e-4 && Math.abs(shrink.x) < 1e-3) {
        lift.x = lift.v = dphi.x = dphi.v = shrink.x = shrink.v = 0;
        stats.adjusted = false;
        renderCam.position.copy(P);
        renderCam.quaternion.copy(camera.quaternion);
        renderCam.updateMatrixWorld();
        return;
      }
    } else {
      // smoothed zoom, orbit target lifted above the ground under it
      spring(dist, L, 16, dt);
      spring(lift, Math.max(0, groundHeight(T.x, T.z) - T.y), 10, dt);
    }
    const d = Math.max(0.3, dist.x);
    Tr.copy(T); Tr.y += lift.x;
    if (enabled) {
      // collision: hysteresis margin while a correction is active, so it only lets go when clearly free
      const extra = (dphi.x > 0.01 || shrink.x > 0.05) ? 0.3 : 0;
      let wantPhi = 0, wantShrink = 0;
      if (firstBlock(sph.phi, sph.theta, d, extra) != null) {
        let found = false;
        for (let k = 1; k <= 26; k++) {
          const p = Math.max(PHI_MIN, sph.phi - k * 0.06);
          if (firstBlock(p, sph.theta, d, extra) == null) { wantPhi = sph.phi - p; found = true; break; }
          if (p === PHI_MIN) break;
        }
        if (!found) {
          const p = Math.min(sph.phi, PHI_MIN);
          wantPhi = sph.phi - p;
          const s = firstBlock(p, sph.theta, d, extra);
          if (s != null) wantShrink = Math.max(0, d - Math.max(Math.min(2.5, d), s - 0.6));
        }
      }
      spring(dphi, wantPhi, wantPhi > dphi.x ? 9 : 3.2, dt);
      spring(shrink, wantShrink, wantShrink > shrink.x ? 9 : 3.2, dt);
      if (dphi.x < 0) { dphi.x = 0; dphi.v = Math.max(0, dphi.v); }
      if (shrink.x < 0) { shrink.x = 0; shrink.v = Math.max(0, shrink.v); }
    }
    const phi = Math.max(Math.min(PHI_MIN, sph.phi), sph.phi - dphi.x);
    const r = Math.max(Math.min(1.2, d), d - shrink.x);
    pos.setFromSphericalCoords(r, phi, sph.theta).add(Tr);
    if (enabled) {
      // the camera point itself: above the smooth floor (continuous), never inside the raw surface
      const fl = floor(pos.x, pos.z) + 0.35;
      if (pos.y < fl) pos.y = fl;
      const raw = surface(pos.x, pos.z) + 0.1;
      if (pos.y < raw) pos.y = raw;
    }
    stats.lastJump = renderCam.position.distanceTo(pos);
    stats.dphi = dphi.x; stats.shrink = shrink.x; stats.dist = d; stats.lift = lift.x;
    stats.adjusted = dphi.x > 0.01 || shrink.x > 0.05;
    if (stats.adjusted) stats.blockedFrames++;
    renderCam.position.copy(pos);
    renderCam.lookAt(Tr);
    renderCam.updateMatrixWorld();
  }

  return {
    renderCam,
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
    update,
    // snap the render camera onto the desired one (no spring), e.g. after a cut
    reset() { primed = false; dphi.x = dphi.v = shrink.x = shrink.v = 0; },
    stats,
    // first sample of the segment a→b that runs into the scenery (null if clear)
    blocked(a, b, margin = 0.2) {
      const dd = a.distanceTo(b);
      for (let s = 0.2; s <= dd; s += 0.2) {
        const k = s / dd;
        const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k, z = a.z + (b.z - a.z) * k;
        if (y < surface(x, z) + margin) return s;
      }
      return null;
    },
    surface,
    floor,
  };
}
