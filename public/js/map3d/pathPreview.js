import * as THREE from 'three';

// Movement path chevrons draped on the terrain + attack arc between two formations
export function createPathPreview(world) {
  const { scene, hexToWorld } = world;
  const groundHeight = world.walkHeight || world.groundHeight;
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

  // March over several turns: the next turns' part is drawn with fainter chevrons, a numbered disc ends each turn
  const FAR_MAX = 200;
  const farMat = new THREE.MeshBasicMaterial({ color: 0x9a9a9a, transparent: true, opacity: 0.6, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
  const farChev = new THREE.InstancedMesh(chevGeo, farMat, FAR_MAX);
  farChev.count = 0;
  farChev.frustumCulled = false;
  farChev.renderOrder = 8;
  scene.add(farChev);
  const numTex = new Map();
  function numberTexture(n) {
    if (numTex.has(n)) return numTex.get(n);
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = n === 1 ? '#ffffff' : '#000000';
    g.strokeStyle = n === 1 ? '#000000' : '#ffffff';
    g.lineWidth = 6;
    g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = n === 1 ? '#000000' : '#ffffff';
    g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), 32, 34);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    numTex.set(n, t);
    return t;
  }
  const turnMarks = [];
  function showTurnMarks(hexes, ends) {
    const list = (ends || []).map((idx, k) => ({ idx, n: k + 1 })).filter((e) => e.idx > 0);
    while (turnMarks.length < list.length) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
      sp.scale.set(0.42, 0.42, 1);
      sp.renderOrder = 10;
      scene.add(sp);
      turnMarks.push(sp);
    }
    turnMarks.forEach((sp, i) => {
      sp.visible = i < list.length;
      if (!sp.visible) return;
      const [hq, hr] = hexes[list[i].idx];
      const c = hexToWorld(hq, hr);
      sp.material.map = numberTexture(list[i].n);
      sp.material.needsUpdate = true;
      sp.position.set(c.x, groundHeight(c.x, c.z) + 0.45, c.z);
    });
  }

  function samplePath(hexes, max = MAX) {
    const pts = hexes.map(([hq, hr]) => { const c = hexToWorld(hq, hr); return new THREE.Vector3(c.x, 0, c.z); });
    if (pts.length < 2) return [];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.3);
    const len = curve.getLength();
    const n = Math.min(max, Math.max(2, Math.floor(len / 0.32)));
    const out = [];
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const pt = curve.getPointAt(Math.min(t, 0.999));
      const tan = curve.getTangentAt(Math.min(t, 0.999));
      out.push({ x: pt.x, z: pt.z, a: Math.atan2(tan.x, tan.z) });
    }
    return out;
  }

  // opts.turnEnds (march): index in hexes of the last hex of each turn
  function showPath(hexes, opts = {}) {
    const ends = opts.turnEnds && opts.turnEnds.length > 1 ? opts.turnEnds : null;
    const first = ends ? ends[0] : hexes ? hexes.length - 1 : 0;
    farChev.count = 0;
    if (ends && hexes && first < hexes.length - 1) {
      const far = samplePath(hexes.slice(first), FAR_MAX);
      far.forEach((pt, i) => {
        q.setFromAxisAngle(up, pt.a);
        p.set(pt.x, groundHeight(pt.x, pt.z) + 0.07, pt.z);
        s.set(0.85, 1, 0.85);
        m.compose(p, q, s);
        farChev.setMatrixAt(i, m);
      });
      farChev.count = far.length;
      farChev.instanceMatrix.needsUpdate = true;
    }
    showTurnMarks(hexes || [], ends);
    pathPoints = hexes && hexes.length > 1 && first > 0 ? samplePath(hexes.slice(0, first + 1)) : null;
    if (!hexes || hexes.length < 2) { chevrons.count = 0; endMark.visible = false; return; }
    if (!pathPoints) chevrons.count = 0;
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

  // Waypoints of the route chosen by the player: red rings standing on the walking surface
  const wpMat = new THREE.MeshBasicMaterial({ color: 0xd8352a, transparent: true, opacity: 0.95, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
  const wpGeo = new THREE.RingGeometry(0.16, 0.3, 24).rotateX(-Math.PI / 2);
  const wpMarks = [];
  function showWaypoints(list) {
    const n = list ? list.length : 0;
    while (wpMarks.length < n) {
      const m = new THREE.Mesh(wpGeo, wpMat);
      m.renderOrder = 9;
      scene.add(m);
      wpMarks.push(m);
    }
    wpMarks.forEach((m, i) => {
      m.visible = i < n;
      if (i < n) {
        const c = hexToWorld(list[i][0], list[i][1]);
        m.position.set(c.x, world.walkHeight(c.x, c.z) + 0.1, c.z);
      }
    });
  }

  function clear() { showPath(null); showAttack(null, null); }

  function update(dt) {
    phase += dt;
    if (pathPoints) layout();
    if (arc) arcMat.opacity = 0.65 + 0.25 * Math.sin(phase * 6);
  }

  return { showPath, showAttack, showWaypoints, clear, update };
}

// Planned orders (simultaneous mode): one chevron trail per move, an arc per attack, all in the player's colour
export function createOrdersLayer(world, { opacity = 0.85 } = {}) {
  const { scene, hexToWorld } = world;
  const groundHeight = world.walkHeight || world.groundHeight;
  const MAX = 512;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.09, 0, -0.08, 0, 0, 0.05, 0.09, 0, -0.08,
    0.09, 0, -0.08, 0, 0, 0.05, 0, 0, 0.1,
    -0.09, 0, -0.08, 0, 0, 0.1, 0, 0, 0.05,
  ], 3));
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
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

  const base = new THREE.Color(), dim = new THREE.Color(), grey = new THREE.Color(0x3a3a3a), big = new THREE.Vector3(1.4, 1, 1.4), small = new THREE.Vector3(0.8, 1, 0.8);
  // selectedId: that unit's trail is drawn larger and in full colour, the others smaller and darker
  function show(orders, color, anchorOf, selectedId = null) {
    const sig = JSON.stringify(orders || []) + color + '|' + selectedId;
    if (sig === lastSig) return;
    lastSig = sig;
    mat.color.set(0xffffff);
    base.set(color || '#ffd25a');
    dim.copy(base).lerp(grey, 0.55);
    clearArcs();
    let n = 0;
    const list = [...(orders || [])].sort((a, b) => (String(a.unitId) === String(selectedId)) - (String(b.unitId) === String(selectedId)));
    for (const o of list) {
      const sel = selectedId != null && String(o.unitId) === String(selectedId);
      if (o.path && o.path.length > 1) {
        const pts = o.path.map(([hq, hr]) => { const c = hexToWorld(hq, hr); return new THREE.Vector3(c.x, 0, c.z); });
        const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.3);
        const len = curve.getLength();
        const cnt = Math.max(2, Math.floor(len / (sel ? 0.3 : 0.4)));
        for (let i = 1; i <= cnt && n < MAX; i++) {
          const t = Math.min(0.999, i / cnt);
          const pt = curve.getPointAt(t), tan = curve.getTangentAt(t);
          q.setFromAxisAngle(up, Math.atan2(tan.x, tan.z));
          p.set(pt.x, groundHeight(pt.x, pt.z) + (sel ? 0.09 : 0.07), pt.z);
          m.compose(p, q, selectedId == null ? one : sel ? big : small);
          chev.setColorAt(n, selectedId == null || sel ? base : dim);
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
    if (chev.instanceColor) chev.instanceColor.needsUpdate = true;
  }
  function clear() { show([], null); }
  return { show, clear };
}

// Marks on the selected unit's path: numbered discs where each turn of a march ends, stance chips where it changes stance
export function createPathMarks(world) {
  const { scene, hexToWorld } = world;
  const groundHeight = world.walkHeight || world.groundHeight;
  const tex = new Map();
  function texture(key, draw) {
    if (tex.has(key)) return tex.get(key);
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    draw(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    tex.set(key, t);
    return t;
  }
  const turnTex = (n) => texture(`t${n}`, (g) => {
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(32, 32, 29, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#000000'; g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(n), 32, 34);
  });
  const stanceTex = (s) => texture(`s${s}`, (g) => {
    const sty = window.stanceStyle ? window.stanceStyle(s) : { c: '#444' };
    g.fillStyle = '#ffffff'; g.fillRect(2, 2, 60, 60);
    g.fillStyle = '#000000'; g.fillRect(6, 6, 52, 52);
    g.fillStyle = sty.c || '#444'; g.fillRect(10, 10, 44, 44);
    if (window.drawStanceIcon) window.drawStanceIcon(g, s, 32, 32, 36);
  });
  const sprites = [];
  let lastSig = '';
  // marks: [{ q, r, kind: 'turn' | 'stance', n?, stance? }]
  function show(marks) {
    const sig = JSON.stringify(marks || []);
    if (sig === lastSig) return;
    lastSig = sig;
    const list = marks || [];
    while (sprites.length < list.length) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
      sp.renderOrder = 11;
      scene.add(sp);
      sprites.push(sp);
    }
    sprites.forEach((sp, i) => {
      const mk = list[i];
      sp.visible = !!mk;
      if (!mk) return;
      const c = hexToWorld(mk.q, mk.r);
      const y = groundHeight(c.x, c.z);
      sp.material.map = mk.kind === 'turn' ? turnTex(mk.n) : stanceTex(mk.stance);
      sp.material.needsUpdate = true;
      const k = mk.kind === 'turn' ? 0.42 : 0.38;
      sp.scale.set(k, k, 1);
      if (mk.kind === 'turn') sp.position.set(c.x, y + 0.45, c.z);
      else sp.position.set(c.x + 0.28, y + 0.75, c.z - 0.2);
    });
  }
  function clear() { show([]); }
  return { show, clear };
}
