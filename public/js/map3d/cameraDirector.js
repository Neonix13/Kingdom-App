import * as THREE from 'three';

// Automatic camera for the action (AI turns, own moves, simultaneous resolution): gathers the hexes involved
// (where units are and where they are going, combats weigh more), then frames them all in one smooth move
// instead of jumping from unit to unit. When everything does not fit in a readable view, it frames the busiest
// cluster, stays there a minimum time, and shows arrows at the screen edge toward the other actions.
// Any camera input from the player pauses it for a while.
const CAM_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract']);

export function createCameraDirector(world, { container, enabled = () => true } = {}) {
  const { camera, controls, canvas } = world;
  const MIN_DIST = 10, MAX_DIST = 44, CLUSTER = 7.5;
  const USER_PAUSE = 7000, DWELL = 1600, BATCH = 90;
  let pauseUntil = 0, lastMove = 0;
  let batch = null, batchTimer = null, queued = null, queueTimer = null;
  let current = null;

  const userInput = () => { pauseUntil = performance.now() + USER_PAUSE; queued = null; };
  canvas.addEventListener('pointerdown', userInput);
  canvas.addEventListener('wheel', userInput, { passive: true });
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (CAM_CODES.has(e.code)) userInput();
  });

  // --- edge arrows toward the actions left out of the frame ---
  const layer = document.createElement('div');
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:4;overflow:hidden';
  (container || document.body).appendChild(layer);
  let arrows = [];
  function setArrows(points) {
    for (const a of arrows) a.el.remove();
    arrows = points.map((p) => {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;width:0;height:0;border-left:11px solid transparent;border-right:11px solid transparent;border-bottom:20px solid #D8352A;filter:drop-shadow(0 0 2px #000) drop-shadow(0 0 1px #fff);transition:opacity .4s';
      layer.appendChild(el);
      return { el, p, until: performance.now() + 4500 };
    });
  }
  const _v = new THREE.Vector3();
  function update() {
    if (!arrows.length) return;
    const now = performance.now();
    const w = canvas.clientWidth, h = canvas.clientHeight;
    arrows = arrows.filter((a) => {
      if (now > a.until) { a.el.remove(); return false; }
      _v.copy(a.p).project(camera);
      let x = _v.x, y = -_v.y;
      if (_v.z > 1) { x = -x; y = -y; }
      const inside = _v.z <= 1 && Math.abs(x) < 0.92 && Math.abs(y) < 0.92;
      a.el.style.opacity = inside ? '0' : String(Math.min(1, (a.until - now) / 800));
      const m = Math.max(Math.abs(x), Math.abs(y), 1e-6);
      const ex = x / m * 0.9, ey = y / m * 0.9;
      const px = (ex * 0.5 + 0.5) * w, py = (ey * 0.5 + 0.5) * h;
      a.el.style.transform = `translate(${(px - 11).toFixed(0)}px,${(py - 10).toFixed(0)}px) rotate(${Math.atan2(ey, ex) + Math.PI / 2}rad)`;
      return true;
    });
  }

  const toWorld = (pt) => {
    if (pt.isVector3) return pt.clone();
    const c = world.hexToWorld(pt.q, pt.r);
    return new THREE.Vector3(c.x, world.groundHeight(c.x, c.z), c.z);
  };
  function onScreen(v, m = 0.14) {
    const s = world.projectToScreen(v);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    return s.visible && s.x > w * m && s.x < w * (1 - m) && s.y > h * m && s.y < h * (1 - m);
  }
  function radiusOf(pts, c) { let r = 0; for (const p of pts) r = Math.max(r, Math.hypot(p.x - c.x, p.z - c.z)); return r; }
  function centerOf(pts) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const c = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
    c.y = world.groundHeight(c.x, c.z);
    return c;
  }
  // Camera distance so that a disc of radius r around the target fits the view, keeping the current angle
  function distFor(r) {
    const vf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hf = Math.atan(Math.tan(vf) * camera.aspect);
    return (r + 2.2) / Math.sin(Math.min(vf, hf)) * 1.05;
  }
  // Greedy clusters of nearby points; weight favours combats
  function clusters(pts) {
    const out = [];
    for (const p of [...pts].sort((a, b) => b.w - a.w)) {
      const c = out.find((k) => Math.hypot(k.c.x - p.v.x, k.c.z - p.v.z) < CLUSTER);
      if (c) { c.pts.push(p.v); c.w += p.w; c.c = centerOf(c.pts); } else out.push({ pts: [p.v], w: p.w, c: p.v.clone() });
    }
    return out;
  }

  function frame(items, { force = false, closeUp = false } = {}) {
    if (!items.length) return;
    const now = performance.now();
    if (!enabled() || now < pauseUntil) return;
    const pts = items.map((i) => i.v);
    const allVisible = pts.every((p) => onScreen(p));
    const camDist = camera.position.distanceTo(controls.target);
    if (allVisible && !force && !(closeUp && camDist > 26)) return;
    if (now - lastMove < DWELL && !force) {
      // wait for the minimum dwell time, then frame everything gathered meanwhile
      queued = (queued || []).concat(items);
      clearTimeout(queueTimer);
      queueTimer = setTimeout(() => { const q = queued; queued = null; if (q) frame(q); }, DWELL - (now - lastMove) + 30);
      return;
    }
    let c = centerOf(pts), r = radiusOf(pts, c);
    let others = [];
    if (distFor(r) > MAX_DIST) {
      const cl = clusters(items);
      // stick with the cluster already on screen if it is still busy
      cl.sort((a, b) => (b.w + (current && Math.hypot(b.c.x - current.x, b.c.z - current.z) < CLUSTER ? 2 : 0)) - (a.w + (current && Math.hypot(a.c.x - current.x, a.c.z - current.z) < CLUSTER ? 2 : 0)));
      const best = cl[0];
      c = centerOf(best.pts); r = radiusOf(best.pts, c);
      others = cl.slice(1).map((k) => k.c);
    }
    let d = THREE.MathUtils.clamp(distFor(r), closeUp ? 8 : MIN_DIST, MAX_DIST);
    if (!closeUp && camDist > d && camDist < MAX_DIST) d = Math.max(d, Math.min(camDist, d * 1.35));
    const dir = camera.position.clone().sub(controls.target).normalize();
    const pos = c.clone().addScaledVector(dir, d);
    const travel = c.distanceTo(controls.target) + Math.abs(d - camDist);
    if (travel < 0.6) return;
    world.flyTo(pos, c, THREE.MathUtils.clamp(0.7 + travel * 0.035, 0.8, 1.8));
    lastMove = now;
    current = c;
    if (others.length) setArrows(others);
  }

  // Collect what happens within a short window (one tick, one AI action) and frame it at once
  function observe(points, opts = {}) {
    const items = points.filter(Boolean).map((p) => ({ v: toWorld(p), w: p.w || 1 }));
    if (!items.length) return;
    if (!batch) batch = { items: [], opts: {} };
    batch.items.push(...items);
    Object.assign(batch.opts, opts);
    clearTimeout(batchTimer);
    batchTimer = setTimeout(() => { const b = batch; batch = null; frame(b.items, b.opts); }, BATCH);
  }

  return { observe, frame: (pts, o) => frame(pts.map((p) => ({ v: toWorld(p), w: p.w || 1 })), o), update, userInput, get paused() { return performance.now() < pauseUntil; } };
}
