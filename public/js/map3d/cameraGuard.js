import * as THREE from 'three';

// Keeps cameras out of the scenery. A top-down "highest surface" map is baked once from the static scene
// (terrain, walls, buildings, trees, water); the orbit camera is then pulled in front of whatever lies
// between its target and itself, and never sinks below the surface under it.

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

export function createCameraGuard({ camera, controls, top, groundHeight }) {
  const desired = new THREE.Vector3(), applied = new THREE.Vector3(), dir = new THREE.Vector3(), pos = new THREE.Vector3();
  let clipped = false, cur = null, pulled = false;
  const surface = (x, z) => { const t = top(x, z); const g = groundHeight(x, z); return Math.max(Number.isFinite(t) ? t : -Infinity, Number.isFinite(g) ? g : -Infinity); };
  return {
    enabled: true,
    // put the camera back where the controls / camera moves wanted it, so the user's zoom is never lost
    before() {
      if (clipped && camera.position.distanceToSquared(applied) < 1e-10) camera.position.copy(desired);
      clipped = false;
    },
    after(dt) {
      if (!this.enabled) return;
      const T = controls.target, C = camera.position;
      desired.copy(C);
      dir.subVectors(C, T);
      const L = dir.length();
      if (L < 1e-4) return;
      dir.divideScalar(L);
      const start = Math.min(1.2, L * 0.3);
      let allow = L;
      for (let s = start; s <= L; s += 0.3) {
        const px = T.x + dir.x * s, py = T.y + dir.y * s, pz = T.z + dir.z * s;
        const margin = 0.15 + 0.35 * Math.min(1, s / 4);
        if (py < surface(px, pz) + margin) { allow = Math.max(start, s - 0.6); break; }
      }
      if (allow < 2.5 && allow < L) allow = L; // target under a roof or a tree: lift instead of diving in
      if (cur == null || cur > L) cur = L;
      if (allow < L - 1e-3) {
        pulled = true;
        if (allow < cur) cur = allow;
        else cur += (allow - cur) * Math.min(1, dt * 2.5);
      } else if (pulled) {
        cur += (L - cur) * Math.min(1, dt * 2.5);
        if (L - cur < 0.02) { cur = L; pulled = false; }
      } else cur = L;
      pos.copy(T).addScaledVector(dir, cur);
      const floor = surface(pos.x, pos.z) + 0.5;
      if (pos.y < floor) pos.y = floor;
      if (pos.distanceToSquared(C) > 1e-10) {
        C.copy(pos);
        applied.copy(pos);
        clipped = true;
      }
    },
    // first sample of the segment a→b that runs into the scenery (null if clear)
    blocked(a, b, margin = 0.2) {
      const d = a.distanceTo(b);
      for (let s = 0.2; s <= d; s += 0.2) {
        const k = s / d;
        const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k, z = a.z + (b.z - a.z) * k;
        if (y < surface(x, z) + margin) return s;
      }
      return null;
    },
    surface,
  };
}
