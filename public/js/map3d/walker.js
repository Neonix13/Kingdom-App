// "Promenade": a ghost walking on the battlefield, seen in third person. Purely local (no server message, no rule effect).
// Collisions: terrain heightfield (cliffs, steep slopes) + the merged building/fortification meshes tagged userData.kbCollider
// (walls, houses, towers, stairs, wall walks, bridges), indexed once in a uniform XZ grid of triangles,
// plus the solid footprints of world.solids (walls, towers, tents, fences…) and the board's tree trunks (world.trunks).
import { createObstacles } from './obstacles.js';

const CSS = `
#v3-walk-layer { position:absolute; inset:0; z-index:40; cursor:grab; display:none; }
body.v3-walk #v3-walk-layer { display:block; }
body.v3-walk #v3-photo-bar { display:none !important; }
#v3-walk-bar { position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:210; display:none; align-items:center; gap:14px;
  background:#000; color:#fff; border:3px solid #fff; box-shadow:0 0 0 3px #000; padding:7px 14px; font:600 12px 'Zen Kaku Gothic New','Segoe UI',system-ui,sans-serif; white-space:nowrap; }
body.v3-walk #v3-walk-bar { display:flex; }
#v3-walk-bar b { font:400 15px 'Dela Gothic One','Segoe UI',sans-serif; letter-spacing:1px; }
#v3-walk-bar .k { display:inline-block; border:1.5px solid #fff; padding:0 4px; margin-right:3px; font-size:10px; }
#v3-walk-bar button { background:#D8352A; color:#fff; border:2px solid #fff; padding:3px 10px; font:700 12px inherit; cursor:pointer; }
`;

const CELL = 0.5;
const H = 0.36;            // ghost height (soldiers are about 0.33)
const R = 0.07;            // body radius
const MAX_STEP = 0.24;     // highest ledge climbed without jumping (wall stairs, kerbs)
const MAX_SLOPE = 1.25;    // terrain gradient beyond which it can't be climbed (~51°)
const WALK = 0.75, RUN = 1.7, ACCEL = 9, FRICTION = 10, GRAVITY = 4.2, JUMP = 1.35;

export function createWalker(world, { container = document.body, onEnter, onExit } = {}) {
  const { THREE, scene, camera, controls, groundHeight } = world;
  if (!document.getElementById('v3-walk-css')) {
    const st = document.createElement('style');
    st.id = 'v3-walk-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const layer = document.createElement('div');
  layer.id = 'v3-walk-layer';
  container.appendChild(layer);
  const bar = document.createElement('div');
  bar.id = 'v3-walk-bar';
  bar.innerHTML = `<b>PROMENADE</b><span><span class="k">ZQSD</span><span class="k">↑↓←→</span>marcher</span><span><span class="k">Maj</span>courir</span>
    <span><span class="k">Espace</span>sauter</span><span>souris : regarder (clic pour capturer) · molette : distance</span><button type="button">Quitter (Échap)</button>`;
  document.body.appendChild(bar);
  bar.querySelector('button').addEventListener('click', () => exit());

  // ---------- collision grid ----------
  let grid = null;
  function buildGrid() {
    const tris = [];
    const v = new THREE.Vector3();
    scene.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.userData.kbCollider) return;
      o.updateMatrixWorld();
      const pos = o.geometry.attributes.position, idx = o.geometry.index;
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
        tris.push(v.x, v.y, v.z);
      }
    });
    const T = new Float32Array(tris);
    const cells = new Map();
    const nt = T.length / 9;
    for (let t = 0; t < nt; t++) {
      const o = t * 9;
      const x0 = Math.min(T[o], T[o + 3], T[o + 6]), x1 = Math.max(T[o], T[o + 3], T[o + 6]);
      const z0 = Math.min(T[o + 2], T[o + 5], T[o + 8]), z1 = Math.max(T[o + 2], T[o + 5], T[o + 8]);
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
          const k = cx * 73856093 ^ cz * 19349663;
          let a = cells.get(k);
          if (!a) cells.set(k, (a = []));
          a.push(t);
        }
      }
    }
    grid = { T, cells };
    obst = world.solids && world.solids.length ? createObstacles(world) : null;
    trunkCells = new Map();
    for (const t of world.trunks || []) {
      const k = Math.floor(t.x / CELL) * 73856093 ^ Math.floor(t.z / CELL) * 19349663;
      let a = trunkCells.get(k);
      if (!a) trunkCells.set(k, (a = []));
      a.push(t);
    }
  }
  let obst = null, trunkCells = null;
  // body (radius R) at (x, z) against footprints standing higher than a step above the feet, and against tree trunks
  function solidBlocks(x, z, feet) {
    if (obst) {
      for (const [ox, oz] of [[0, 0], [R, 0], [-R, 0], [0, R], [0, -R]]) if (obst.solidTop(x + ox, z + oz) > feet + MAX_STEP) return true;
    }
    if (trunkCells) {
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const list = trunkCells.get((cx + i) * 73856093 ^ (cz + j) * 19349663);
        if (list) for (const t of list) if ((x - t.x) ** 2 + (z - t.z) ** 2 < (t.r + R) ** 2 && feet < groundHeight(t.x, t.z) + 1.2) return true;
      }
    }
    return false;
  }
  // push-back direction away from what blocks (x, z)
  function solidNormal(x, z, feet, ux, uz) {
    let sx = 0, sz = 0;
    for (let a = 0; a < 8; a++) {
      const dx = Math.cos(a * Math.PI / 4), dz = Math.sin(a * Math.PI / 4);
      if (solidBlocks(x + dx * R * 1.5, z + dz * R * 1.5, feet)) { sx -= dx; sz -= dz; }
    }
    const l = Math.hypot(sx, sz);
    return l > 1e-6 ? { nx: sx / l, nz: sz / l } : { nx: -ux, nz: -uz };
  }
  const cellAt = (x, z) => grid.cells.get(Math.floor(x / CELL) * 73856093 ^ Math.floor(z / CELL) * 19349663);

  // Heights where a vertical line through (x, z) meets structures, highest one not above yMax (or -Infinity)
  function structureBelow(x, z, yMax) {
    const list = cellAt(x, z);
    if (!list) return -Infinity;
    const T = grid.T;
    let best = -Infinity;
    for (const t of list) {
      const o = t * 9;
      const ax = T[o], az = T[o + 2], bx = T[o + 3], bz = T[o + 5], cx = T[o + 6], cz = T[o + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-7) continue;
      const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      if (l1 < 0 || l1 > 1) continue;
      const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (l2 < 0 || l1 + l2 > 1) continue;
      const y = l1 * T[o + 1] + l2 * T[o + 4] + (1 - l1 - l2) * T[o + 7];
      if (y <= yMax && y > best) best = y;
    }
    return best;
  }

  // Nearest hit of a segment against structure triangles: { t (0..1), nx, nz } or null
  const _seen = new Set();
  function segmentHit(x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / (CELL * 0.5)));
    _seen.clear();
    const T = grid.T;
    let best = null;
    for (let s = 0; s <= steps; s++) {
      const list = cellAt(x0 + dx * s / steps, z0 + dz * s / steps);
      if (!list) continue;
      for (const t of list) {
        if (_seen.has(t)) continue;
        _seen.add(t);
        const o = t * 9;
        const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
        const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-9) continue;
        const inv = 1 / det;
        const sx = x0 - T[o], sy = y0 - T[o + 1], sz = z0 - T[o + 2];
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const w = (dx * qx + dy * qy + dz * qz) * inv;
        if (w < 0 || u + w > 1) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (tt < 0 || tt > 1 || (best && tt >= best.t)) continue;
        let nx = e1y * e2z - e1z * e2y, nz = e1x * e2y - e1y * e2x;
        const nl = Math.hypot(nx, nz) || 1;
        best = { t: tt, nx: nx / nl, nz: nz / nl };
      }
    }
    return best;
  }

  // Walkways of units (world.decks: stairs, wall walks, bridges): height at (x, z) or null off them
  function deckAt(x, z) {
    let best = null;
    for (const d of world.decks || []) {
      if (x < d.x0 || x > d.x1 || z < d.z0 || z > d.z1) continue;
      for (let i = 0; i < d.pts.length - 1; i++) {
        const a = d.pts[i], b = d.pts[i + 1];
        const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
        const px = a.x + vx * t, pz = a.z + vz * t;
        if ((x - px) ** 2 + (z - pz) ** 2 <= d.hw * d.hw) { const y = a.y + (b.y - a.y) * t; if (best === null || y > best) best = y; }
      }
    }
    return best;
  }
  // a walkway reachable from these feet (not one far above or below)
  function walkwayAt(x, z, feet) {
    const y = deckAt(x, z);
    return y !== null && y <= feet + MAX_STEP && y >= feet - MAX_STEP * 2 ? y : null;
  }

  // Ground under the ghost: terrain, a walkway, or a structure surface it can step onto
  function floorAt(x, z, feet) {
    const w = walkwayAt(x, z, feet);
    return Math.max(groundHeight(x, z), w === null ? -Infinity : w, structureBelow(x, z, feet + MAX_STEP));
  }

  // ---------- ghost figure ----------
  const ghost = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe9eef3, emissive: 0x8a96a3, emissiveIntensity: 0.45, roughness: 0.9, transparent: true, opacity: 0.5, depthWrite: false });
  const inkMat = new THREE.MeshBasicMaterial({ color: 0x0b0b0b, side: THREE.BackSide, transparent: true, opacity: 0.75, depthWrite: false });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xd8352a, emissive: 0x5a120d, roughness: 0.8, transparent: true, opacity: 0.85, depthWrite: false });
  function part(geo, mat = bodyMat, ink = 1.12) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 12;
    g.add(m);
    if (ink) { const o = new THREE.Mesh(geo, inkMat); o.scale.setScalar(ink); o.renderOrder = 11; g.add(o); }
    return g;
  }
  const robe = part(new THREE.CylinderGeometry(0.055, 0.11, 0.2, 10, 1, true).translate(0, 0.1, 0), bodyMat, 1.08);
  robe.position.y = 0.04;
  const chest = part(new THREE.CylinderGeometry(0.06, 0.06, 0.09, 10).translate(0, 0.045, 0), bodyMat, 1.1);
  chest.position.y = 0.23;
  const head = part(new THREE.SphereGeometry(0.045, 12, 10));
  head.position.y = 0.355;
  const hat = part(new THREE.ConeGeometry(0.095, 0.045, 14), bodyMat, 1.1);
  hat.position.y = 0.4;
  const scarf = part(new THREE.BoxGeometry(0.05, 0.12, 0.012).translate(0, -0.06, 0), redMat, 0);
  scarf.position.set(0, 0.31, -0.05);
  const limb = (len, r) => new THREE.CylinderGeometry(r, r * 0.8, len, 6).translate(0, -len / 2, 0);
  const armL = part(limb(0.13, 0.017)), armR = part(limb(0.13, 0.017));
  armL.position.set(0.075, 0.31, 0); armR.position.set(-0.075, 0.31, 0);
  const legL = part(limb(0.09, 0.02)), legR = part(limb(0.09, 0.02));
  legL.position.set(0.03, 0.09, 0); legR.position.set(-0.03, 0.09, 0);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.09, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  const fig = new THREE.Group();
  fig.add(robe, chest, head, hat, scarf, armL, armR, legL, legR);
  ghost.add(fig);
  ghost.visible = false;
  shadow.visible = false;
  scene.add(ghost, shadow);

  // ---------- state ----------
  let active = false;
  const pos = new THREE.Vector3(), vel = new THREE.Vector3();
  let vy = 0, onGround = true, yaw = 0, pitch = 0.32, dist = 1.35, facing = 0, phase = 0, entering = 0;
  const camPos = new THREE.Vector3(), camTarget = new THREE.Vector3();
  let saved = null;
  const keys = new Set();
  const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space', 'KeyQ', 'KeyE']);

  function onKeyDown(e) {
    if (!active) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); exit(); return; }
    if (MOVE_CODES.has(e.code) || e.code === 'KeyB') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'KeyB') { exit(); return; }
      keys.add(e.code);
      if (e.code === 'Space' && onGround && !e.repeat) { vy = JUMP; onGround = false; }
    } else if (!e.metaKey && !e.ctrlKey) e.stopImmediatePropagation();
  }
  function onKeyUp(e) { if (active) { keys.delete(e.code); e.stopImmediatePropagation(); } }
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', () => keys.clear());

  let dragging = false;
  layer.addEventListener('pointerdown', (e) => {
    dragging = true;
    if (layer.requestPointerLock && document.pointerLockElement !== layer) {
      try { const p = layer.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* drag to look */ }
    }
    e.preventDefault();
  });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (!active || (!dragging && document.pointerLockElement !== layer)) return;
    yaw -= e.movementX * 0.0042;
    pitch = Math.max(-0.35, Math.min(1.25, pitch + e.movementY * 0.0036));
  });
  layer.addEventListener('wheel', (e) => { e.preventDefault(); dist = Math.max(0.55, Math.min(4.5, dist * (1 + Math.sign(e.deltaY) * 0.12))); }, { passive: false });
  layer.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- physics ----------
  const fwd = new THREE.Vector3(), right = new THREE.Vector3();
  function tryMove(dx, dz) {
    // two heights: just above the climbable step (walls, steps too high) and the chest (beams, low walls)
    for (let pass = 0; pass < 2 && (dx || dz); pass++) {
      const len = Math.hypot(dx, dz);
      if (len < 1e-6) return;
      const ux = dx / len, uz = dz / len;
      let hit = null;
      // on a walkway (stairs, wall walk) the way is clear: decorative masonry around it doesn't block
      const onWay = walkwayAt(pos.x + dx, pos.z + dz, pos.y) !== null;
      if (!onWay) for (const hy of [MAX_STEP + 0.02, H * 0.8]) {
        for (const side of [0, 1, -1]) {
          const ox = pos.x - uz * R * 0.8 * side, oz = pos.z + ux * R * 0.8 * side;
          const h = segmentHit(ox, pos.y + hy, oz, ox + ux * (len + R), pos.y + hy, oz + uz * (len + R));
          if (h && (!hit || h.t < hit.t)) hit = { ...h, len: len + R };
        }
      }
      // ledges and cliffs higher than a step; open hillsides too steep to climb (not over stairs or walks)
      const nx = pos.x + dx, nz = pos.z + dz;
      if (!hit) {
        const g1 = groundHeight(nx, nz);
        let blocked = floorAt(nx, nz, pos.y) - pos.y > MAX_STEP;
        if (!blocked && structureBelow(nx, nz, 1e9) < g1 - 0.05) {
          const g0 = groundHeight(pos.x, pos.z), ahead = groundHeight(pos.x + ux * 0.2, pos.z + uz * 0.2);
          blocked = ahead - g0 > MAX_SLOPE * 0.2 && pos.y < ahead;
        }
        if (blocked) {
          const e = 0.05;
          const gx = groundHeight(nx + e, nz) - groundHeight(nx - e, nz), gz = groundHeight(nx, nz + e) - groundHeight(nx, nz - e);
          const gl = Math.hypot(gx, gz);
          hit = gl > 1e-6 ? { t: 0, nx: -gx / gl, nz: -gz / gl, len } : { t: 0, nx: -ux, nz: -uz, len };
        }
      }
      if (!hit && !onWay && solidBlocks(nx, nz, pos.y) && !solidBlocks(pos.x, pos.z, pos.y)) {
        const n = solidNormal(nx, nz, pos.y, ux, uz);
        hit = { t: 0, nx: n.nx, nz: n.nz, len };
      }
      if (!hit) { pos.x = nx; pos.z = nz; return; }
      const free = Math.max(0, hit.t * hit.len - R);
      pos.x += ux * Math.min(free, len);
      pos.z += uz * Math.min(free, len);
      // slide along the obstacle with what's left
      const rest = len - Math.min(free, len);
      let sx = ux * rest, sz = uz * rest;
      const dot = sx * hit.nx + sz * hit.nz;
      sx -= dot * hit.nx; sz -= dot * hit.nz;
      dx = sx * 0.9; dz = sz * 0.9;
      const vn = vel.x * hit.nx + vel.z * hit.nz;
      if (vn < 0) { vel.x -= vn * hit.nx; vel.z -= vn * hit.nz; }
    }
  }

  function clampToBoard() {
    const b = world.bounds;
    pos.x = Math.max(b.bx0 + 0.3, Math.min(b.bx1 - 0.3, pos.x));
    pos.z = Math.max(b.bz0 + 0.3, Math.min(b.bz1 - 0.3, pos.z));
  }

  function step(dt) {
    let ix = 0, iz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    yaw += ((keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0)) * dt * 1.8;
    fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const want = new THREE.Vector3().addScaledVector(fwd, iz).addScaledVector(right, ix);
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(run ? RUN : WALK);
    const k = (want.lengthSq() > 0 ? ACCEL : FRICTION) * (onGround ? 1 : 0.25);
    vel.x += (want.x - vel.x) * Math.min(1, k * dt);
    vel.z += (want.z - vel.z) * Math.min(1, k * dt);

    // slide down slopes too steep to stand on
    if (onGround) {
      const e = 0.05;
      const gx = (groundHeight(pos.x + e, pos.z) - groundHeight(pos.x - e, pos.z)) / (2 * e);
      const gz = (groundHeight(pos.x, pos.z + e) - groundHeight(pos.x, pos.z - e)) / (2 * e);
      const sl = Math.hypot(gx, gz);
      const onStructure = structureBelow(pos.x, pos.z, pos.y + 0.02) > groundHeight(pos.x, pos.z) - 0.01;
      if (sl > MAX_SLOPE && !onStructure) { vel.x -= gx / sl * 2.5 * dt; vel.z -= gz / sl * 2.5 * dt; }
    }

    const sub = Math.max(1, Math.ceil(Math.hypot(vel.x, vel.z) * dt / 0.04));
    for (let i = 0; i < sub; i++) tryMove(vel.x * dt / sub, vel.z * dt / sub);
    clampToBoard();

    // vertical: gravity, step up onto stairs/kerbs, stick to the ground going down
    const floor = floorAt(pos.x, pos.z, pos.y);
    vy -= GRAVITY * dt;
    let y = pos.y + vy * dt;
    if (y <= floor) { y = floor; vy = 0; onGround = true; }
    else if (onGround && vy <= 0 && pos.y - floor <= MAX_STEP * 0.75) { y = floor; vy = 0; }
    else onGround = false;
    if (y > pos.y && onGround && y - pos.y > 0.02) y = pos.y + Math.min(y - pos.y, dt * 2.2);
    pos.y = y;

    // figure: face the motion, walk cycle
    const sp = Math.hypot(vel.x, vel.z);
    if (sp > 0.05) {
      const target = Math.atan2(vel.x, vel.z);
      let d = target - facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      facing += d * Math.min(1, dt * 10);
    }
    phase += dt * (3 + sp * 9);
    const sw = Math.min(1, sp / WALK) * 0.7;
    ghost.position.copy(pos);
    ghost.rotation.y = facing;
    fig.position.y = Math.abs(Math.sin(phase)) * 0.012 * Math.min(1, sp * 2) + 0.004 * Math.sin(phase * 0.5);
    armL.rotation.x = Math.sin(phase) * sw; armR.rotation.x = -Math.sin(phase) * sw;
    legL.rotation.x = -Math.sin(phase) * sw; legR.rotation.x = Math.sin(phase) * sw;
    scarf.rotation.x = -0.25 - sp * 0.55 + Math.sin(phase * 1.3) * 0.12;
    shadow.position.set(pos.x, floorAt(pos.x, pos.z, pos.y) + 0.01, pos.z);
  }

  // camera position for a pitch, pulled in front of walls, ceilings and the ground; returns [point, free fraction]
  function cameraFor(pt) {
    const cp = Math.cos(pt), off = new THREE.Vector3(Math.sin(yaw) * cp, Math.sin(pt), Math.cos(yaw) * cp).multiplyScalar(dist);
    let want = camTarget.clone().add(off), k = 1;
    const h = segmentHit(camTarget.x, camTarget.y, camTarget.z, want.x, want.y, want.z);
    if (h) k = Math.max(0.12, h.t - 0.06);
    for (let i = 1; i <= 6; i++) {
      const p = camTarget.clone().lerp(want, (i / 6) * k);
      if (groundHeight(p.x, p.z) + 0.05 > p.y) { k = Math.max(0.12, ((i - 1) / 6) * k); break; }
    }
    return [camTarget.clone().lerp(want, k), k];
  }

  function placeCamera(dt, snap) {
    camTarget.set(pos.x, pos.y + H * 0.92, pos.z);
    let [want, k] = cameraFor(pitch);
    // under an arch or a roof: try a lower view before closing in on the ghost
    if (k < 0.7 && pitch > 0.1) { const [w2, k2] = cameraFor(0.06); if (k2 > k + 0.1) { want = w2; k = k2; } }
    const near = THREE.MathUtils.clamp((k * dist - 0.22) / 0.45, 0.15, 1);
    bodyMat.opacity = 0.5 * near; inkMat.opacity = 0.7 * near; redMat.opacity = 0.8 * near;
    want.y = Math.max(want.y, groundHeight(want.x, want.z) + 0.06);
    const a = snap ? 1 : 1 - Math.exp(-dt * 14);
    camPos.lerp(want, a);
    if (entering > 0) {
      entering = Math.max(0, entering - dt / 0.7);
      const ek = entering * entering;
      camera.position.copy(camPos).lerp(saved.p, ek);
      controls.target.copy(camTarget).lerp(saved.t, ek);
    } else {
      camera.position.copy(camPos);
      controls.target.copy(camTarget);
    }
    camera.lookAt(controls.target);
  }

  function frame(dt) {
    if (!active) return;
    step(Math.min(dt, 0.05));
    placeCamera(dt);
  }

  function enter() {
    if (active) return;
    if (!grid) buildGrid();
    saved = { p: camera.position.clone(), t: controls.target.clone(), enabled: controls.enabled, minD: controls.minDistance, near: camera.near };
    // the ghost camera does its own collision handling: the orbit camera rig steps aside while walking
    saved.rig = world.cameraRig ? world.cameraRig.enabled : null;
    if (world.cameraRig) world.cameraRig.enabled = false;
    const b = world.bounds;
    const sx = Math.max(b.bx0 + 0.5, Math.min(b.bx1 - 0.5, controls.target.x));
    const sz = Math.max(b.bz0 + 0.5, Math.min(b.bz1 - 0.5, controls.target.z));
    pos.set(sx, Math.max(groundHeight(sx, sz), structureBelow(sx, sz, 1e9)), sz);
    const look = controls.target.clone().sub(camera.position);
    yaw = Math.atan2(-look.x, -look.z);
    facing = yaw + Math.PI;
    pitch = 0.32;
    vel.set(0, 0, 0); vy = 0; onGround = true; keys.clear();
    controls.enabled = false;
    camera.near = Math.min(camera.near, 0.03);
    camera.updateProjectionMatrix();
    ghost.visible = shadow.visible = true;
    active = true;
    entering = 1;
    camPos.copy(saved.p);
    placeCamera(0, true);
    const fh = world.frameHooks;
    const i = fh.indexOf(frame);
    if (i >= 0) fh.splice(i, 1);
    fh.push(frame);
    document.body.classList.add('v3-walk');
    if (onEnter) onEnter();
  }

  function exit() {
    if (!active) return;
    active = false;
    keys.clear();
    if (document.pointerLockElement === layer && document.exitPointerLock) document.exitPointerLock();
    ghost.visible = shadow.visible = false;
    const i = world.frameHooks.indexOf(frame);
    if (i >= 0) world.frameHooks.splice(i, 1);
    controls.enabled = saved.enabled;
    if (world.cameraRig && saved.rig != null) world.cameraRig.enabled = saved.rig;
    camera.near = saved.near;
    camera.updateProjectionMatrix();
    world.flyTo(saved.p, saved.t, 0.7);
    document.body.classList.remove('v3-walk');
    if (onExit) onExit();
  }

  return {
    enter, exit,
    toggle() { if (active) exit(); else enter(); },
    get active() { return active; },
    get position() { return pos.clone(); },
    // test hooks
    _floorAt: (x, z, feet) => (grid || buildGrid(), floorAt(x, z, feet)),
    _keys: keys,
    _teleport(x, z, yawTo) { pos.set(x, floorAt(x, z, 1e9), z); vel.set(0, 0, 0); vy = 0; if (yawTo != null) yaw = yawTo; },
    get _grid() { return grid; },
  };
}
