import * as THREE from 'three';

// Movement path chevrons draped on the terrain + attack arc between two formations
export function createPathPreview(world) {
  const { scene, groundHeight, hexToWorld } = world;
  const MAX = 64;

  const chevGeo = new THREE.BufferGeometry();
  chevGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.11, 0, -0.1, 0, 0, 0.06, 0.11, 0, -0.1,
    0.11, 0, -0.1, 0, 0, 0.06, 0, 0, 0.12,
    -0.11, 0, -0.1, 0, 0, 0.12, 0, 0, 0.06,
  ], 3));
  const chevMat = new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.95, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
  const chevrons = new THREE.InstancedMesh(chevGeo, chevMat, MAX);
  chevrons.count = 0;
  chevrons.frustumCulled = false;
  chevrons.renderOrder = 8;
  scene.add(chevrons);

  const endGeo = new THREE.RingGeometry(0.22, 0.32, 24).rotateX(-Math.PI / 2);
  const endMark = new THREE.Mesh(endGeo, chevMat.clone());
  endMark.visible = false;
  endMark.renderOrder = 8;
  scene.add(endMark);

  const arcMat = new THREE.MeshBasicMaterial({ color: 0xff5030, transparent: true, opacity: 0.85, depthWrite: false, fog: false, toneMapped: false });
  let arc = null;

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  let pathPoints = null, phase = 0;

  function samplePath(hexes) {
    const pts = hexes.map(([hq, hr]) => { const c = hexToWorld(hq, hr); return new THREE.Vector3(c.x, 0, c.z); });
    if (pts.length < 2) return [];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.3);
    const len = curve.getLength();
    const n = Math.min(MAX, Math.max(2, Math.floor(len / 0.32)));
    const out = [];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const pt = curve.getPointAt(Math.min(t, 0.999));
      const tan = curve.getTangentAt(Math.min(t, 0.999));
      out.push({ x: pt.x, z: pt.z, a: Math.atan2(tan.x, tan.z) });
    }
    return out;
  }

  function showPath(hexes) {
    pathPoints = hexes && hexes.length > 1 ? samplePath(hexes) : null;
    if (!pathPoints) { chevrons.count = 0; endMark.visible = false; return; }
    const last = hexes[hexes.length - 1];
    const c = hexToWorld(last[0], last[1]);
    endMark.position.set(c.x, groundHeight(c.x, c.z) + 0.08, c.z);
    endMark.visible = true;
    layout();
  }

  function layout() {
    if (!pathPoints) return;
    const n = pathPoints.length;
    chevrons.count = n;
    for (let i = 0; i < n; i++) {
      const pt = pathPoints[i];
      q.setFromAxisAngle(up, pt.a);
      p.set(pt.x, groundHeight(pt.x, pt.z) + 0.07, pt.z);
      const k = 0.8 + 0.35 * Math.max(0, Math.sin(phase * 5 - i * 0.6));
      s.set(k, 1, k);
      m.compose(p, q, s);
      chevrons.setMatrixAt(i, m);
    }
    chevrons.instanceMatrix.needsUpdate = true;
  }

  function showAttack(from, to, ranged) {
    if (arc) { scene.remove(arc); arc.geometry.dispose(); arc = null; }
    if (!from || !to) return;
    const a = new THREE.Vector3(from.x, from.y, from.z), b = new THREE.Vector3(to.x, to.y, to.z);
    const mid = a.clone().lerp(b, 0.5);
    mid.y += Math.max(0.6, a.distanceTo(b) * (ranged ? 0.35 : 0.15));
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    arc = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.035, 6, false), arcMat);
    arc.renderOrder = 8;
    scene.add(arc);
  }

  function clear() { showPath(null); showAttack(null, null); }

  function update(dt) {
    phase += dt;
    if (pathPoints) layout();
    if (arc) arcMat.opacity = 0.65 + 0.25 * Math.sin(phase * 6);
  }

  return { showPath, showAttack, clear, update };
}

// Planned orders (simultaneous mode): one chevron trail per move, an arc per attack, all in the player's colour
export function createOrdersLayer(world) {
  const { scene, groundHeight, hexToWorld } = world;
  const MAX = 512;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.09, 0, -0.08, 0, 0, 0.05, 0.09, 0, -0.08,
    0.09, 0, -0.08, 0, 0, 0.05, 0, 0, 0.1,
    -0.09, 0, -0.08, 0, 0, 0.1, 0, 0, 0.05,
  ], 3));
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
  const chev = new THREE.InstancedMesh(geo, mat, MAX);
  chev.count = 0;
  chev.frustumCulled = false;
  chev.renderOrder = 8;
  scene.add(chev);
  const arcMat = new THREE.MeshBasicMaterial({ color: 0xff5030, transparent: true, opacity: 0.8, depthWrite: false, fog: false, toneMapped: false });
  const arcs = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  let lastSig = '';

  function clearArcs() { for (const a of arcs) { scene.remove(a); a.geometry.dispose(); } arcs.length = 0; }

  function show(orders, color, anchorOf) {
    const sig = JSON.stringify(orders || []) + color;
    if (sig === lastSig) return;
    lastSig = sig;
    mat.color.set(color || '#ffd25a');
    clearArcs();
    let n = 0;
    for (const o of orders || []) {
      if (o.path && o.path.length > 1) {
        const pts = o.path.map(([hq, hr]) => { const c = hexToWorld(hq, hr); return new THREE.Vector3(c.x, 0, c.z); });
        const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.3);
        const len = curve.getLength();
        const cnt = Math.max(2, Math.floor(len / 0.36));
        for (let i = 1; i <= cnt && n < MAX; i++) {
          const t = Math.min(0.999, i / cnt);
          const pt = curve.getPointAt(t), tan = curve.getTangentAt(t);
          q.setFromAxisAngle(up, Math.atan2(tan.x, tan.z));
          p.set(pt.x, groundHeight(pt.x, pt.z) + 0.07, pt.z);
          m.compose(p, q, one);
          chev.setMatrixAt(n++, m);
        }
      }
      if (o.target && o.target.q != null && (o.type === 'attack' || o.type === 'charge')) {
        const from = o.path && o.path.length ? o.path[o.path.length - 1] : null;
        const src = from ? hexToWorld(from[0], from[1]) : null;
        const tgt = hexToWorld(o.target.q, o.target.r);
        const a = src ? new THREE.Vector3(src.x, groundHeight(src.x, src.z) + 0.4, src.z) : (anchorOf && anchorOf(o.unitId));
        if (!a) continue;
        const b = new THREE.Vector3(tgt.x, groundHeight(tgt.x, tgt.z) + 0.4, tgt.z);
        const mid = a.clone().lerp(b, 0.5);
        mid.y += Math.max(0.5, a.distanceTo(b) * (o.ranged ? 0.35 : 0.15));
        const arc = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 24, 0.028, 5, false), arcMat);
        arc.renderOrder = 8;
        scene.add(arc);
        arcs.push(arc);
      }
    }
    chev.count = n;
    chev.instanceMatrix.needsUpdate = true;
  }
  function clear() { show([], null); }
  return { show, clear };
}
