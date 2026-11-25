import * as THREE from 'three';

// ---- unit trails (in the spirit of Humankind): a thick white ribbon draped on the ground, corners rounded off, a soft
// dark shadow under it, round caps, no arrows; the turns ahead fainter; numbered discs where each turn ends ----
// Chaikin corner cutting on [{ x, z }]: rounded bends with a large radius, ends kept
function smooth2(pts, iters = 3) {
  let out = pts;
  for (let k = 0; k < iters && out.length > 2; k++) {
    const nx = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i], b = out[i + 1];
      nx.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    nx.push(out[out.length - 1]);
    out = nx;
  }
  return out;
}
// evenly spaced samples along the polyline (so the ribbon follows the relief between hex centres)
function resample(pts, step = 0.1) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / step));
    for (let j = 1; j <= n; j++) out.push({ x: a.x + (b.x - a.x) * j / n, z: a.z + (b.z - a.z) * j / n });
  }
  return out;
}
// ribbon mesh along pts, width w, lifted above the ground; round caps at both ends
function trailMesh(pts, w, ground, lift, mat) {
  const pos = [], idx = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nx = -tz * w, nz = tx * w, p = pts[i];
    pos.push(p.x + nx, ground(p.x + nx, p.z + nz) + lift, p.z + nz, p.x - nx, ground(p.x - nx, p.z - nz) + lift, p.z - nz);
    if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  // round caps: fans of triangles around both ends
  const cap = (p, dirx, dirz) => {
    const c0 = pos.length / 3;
    pos.push(p.x, ground(p.x, p.z) + lift, p.z);
    const seg = 8, base = Math.atan2(dirz, dirx);
    for (let j = 0; j <= seg; j++) {
      const ang = base - Math.PI / 2 + Math.PI * j / seg;
      const x = p.x + Math.cos(ang) * w, z = p.z + Math.sin(ang) * w;
      pos.push(x, ground(x, z) + lift, z);
      if (j) idx.push(c0, c0 + j, c0 + j + 1);
    }
  };
  if (n > 1) {
    cap(pts[n - 1], pts[n - 1].x - pts[n - 2].x, pts[n - 1].z - pts[n - 2].z);
    cap(pts[0], pts[0].x - pts[1].x, pts[0].z - pts[1].z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}
const trailMat = (color, opacity, additive = false) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
// draws a trail for the hexes [[q, r], ...] (origin included): returns the meshes added to the scene
// opts: { width, color, opacity, shadow, glow (colour), from (index where the faint part starts), faint, restColor (that part) }
function addTrail(scene, hexToWorld, ground, hexes, opts) {
  const out = [];
  if (!hexes || hexes.length < 2) return out;
  const pts = resample(smooth2(hexes.map(([q, r]) => { const c = hexToWorld(q, r); return { x: c.x, z: c.z }; })));
  const w = opts.width || 0.07;
  const add = (m, order) => { m.renderOrder = order; scene.add(m); out.push(m); };
  if (opts.glow) add(trailMesh(pts, w * 2.6, ground, 0.035, trailMat(opts.glow, 0.28, true)), 6);
  if (opts.shadow !== false) add(trailMesh(pts, w * 1.45, ground, 0.04, trailMat(0x000000, 0.3)), 7);
  // split where the next turns begin: the rest of the march is fainter
  let cut = pts.length;
  if (opts.from != null && opts.from < hexes.length - 1) {
    const c = hexToWorld(hexes[opts.from][0], hexes[opts.from][1]);
    let best = Infinity;
    pts.forEach((p, i) => { const d = (p.x - c.x) ** 2 + (p.z - c.z) ** 2; if (d < best) { best = d; cut = i; } });
  }
  if (cut > 1) add(trailMesh(pts.slice(0, cut + 1), w, ground, 0.05, trailMat(opts.color || 0xffffff, opts.opacity ?? 0.96)), 8);
  if (cut < pts.length - 1) add(trailMesh(pts.slice(Math.max(0, cut - 1)), w * 0.8, ground, 0.05, trailMat(opts.restColor ?? opts.color ?? 0xffffff, (opts.opacity ?? 0.96) * (opts.faint ?? 0.5))), 8);
  return out;
}
const disposeAll = (scene, list) => { for (const m of list) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); } list.length = 0; };
// numbered disc (turn ends): white, black ring and figure, like a board-game counter
function turnBadge(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(33, 35, 28, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.fill();
  g.lineWidth = 4; g.strokeStyle = '#1a1a1a'; g.beginPath(); g.arc(32, 32, 22, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#1a1a1a'; g.font = 'bold 28px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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
    if (!numTex.has(n)) numTex.set(n, turnBadge(n));
    return numTex.get(n);
  }
  const turnMarks = [];
  function showTurnMarks(hexes, ends) {
    const list = (ends || []).map((idx, k) => ({ idx, n: k + 1 })).filter((e) => e.idx > 0);
    while (turnMarks.length < list.length) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
      sp.scale.set(0.36, 0.36, 1);
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
      sp.position.set(c.x, groundHeight(c.x, c.z) + 0.3, c.z);
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

  // opts.turnEnds (march): index in hexes of the last hex of each turn; this turn's part in the player's colour (setColor),
  // the next turns white and faint
  const trail = [];
  let pathColor = 0xffffff;
  const setColor = (c) => { pathColor = c ? new THREE.Color(c).getHex() : 0xffffff; };
  function showPath(hexes, opts = {}) {
    const ends = opts.turnEnds && opts.turnEnds.length > 1 ? opts.turnEnds : null;
    disposeAll(scene, trail);
    chevrons.count = 0; farChev.count = 0; endMark.visible = false; pathPoints = null;
    if (!hexes || hexes.length < 2) { showTurnMarks([], null); return; }
    trail.push(...addTrail(scene, hexToWorld, groundHeight, hexes, { width: 0.075, from: ends ? ends[0] : null, color: pathColor, restColor: 0xffffff }));
    // a numbered disc ends each turn; a simple move ends on "1"
    showTurnMarks(hexes, ends || [hexes.length - 1]);
  }

  function layout() {}

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
    if (arc) arcMat.opacity = 0.65 + 0.25 * Math.sin(phase * 6);
  }

  return { showPath, showAttack, showWaypoints, clear, update, setColor };
}

// Planned orders (simultaneous mode): one chevron trail per move, an arc per attack, all in the player's colour
export function createOrdersLayer(world, { opacity = 0.85, tint = false } = {}) {
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
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3();
  let lastSig = '';

  function clearArcs() { for (const a of arcs) { scene.remove(a); a.geometry.dispose(); } arcs.length = 0; }

  const base = new THREE.Color(), grey = new THREE.Color(0x3a3a3a), big = new THREE.Vector3(1.4, 1, 1.4);
  // glow under the selected unit's trail: a soft wide ribbon and a bright thin core, draped on the ground
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false, fog: false, toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
  const thinMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: Math.min(0.75, opacity + 0.15), depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
  const ribbons = [];
  function clearRibbons() { for (const r of ribbons) { scene.remove(r); r.geometry.dispose(); if (r.material !== thinMat && r.material !== glowMat && r.material !== coreMat) r.material.dispose(); } ribbons.length = 0; }
  function ribbon(curve, len, width, mat, lift) {
    const n = Math.max(8, Math.floor(len / 0.12));
    const pos = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, pt = curve.getPointAt(t), tan = curve.getTangentAt(t);
      // taper at both ends
      const w = width * Math.min(1, t * 6, (1 - t) * 6 + 0.15);
      const nx = -tan.z * w, nz = tan.x * w;
      const ax = pt.x + nx, az = pt.z + nz, bx = pt.x - nx, bz = pt.z - nz;
      pos.push(ax, groundHeight(ax, az) + lift, az, bx, groundHeight(bx, bz) + lift, bz);
      if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = 7;
    m.frustumCulled = false;
    scene.add(m);
    ribbons.push(m);
  }
  // destination of an unselected unit's trail: a small disc on the ground
  function endDot(pt, radius, mat) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 16), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(pt.x, groundHeight(pt.x, pt.z) + 0.05, pt.z);
    m.renderOrder = 7;
    m.frustumCulled = false;
    scene.add(m);
    ribbons.push(m);
  }
  // selectedId: that unit's trail glows with chevrons; the others are a thin darker line ending on a dot
  function show(orders, color, anchorOf, selectedId = null) {
    const sig = JSON.stringify(orders || []) + color + '|' + selectedId;
    if (sig === lastSig) return;
    lastSig = sig;
    mat.color.set(0xffffff);
    base.set(color || '#ffd25a');
    glowMat.color.copy(base);
    coreMat.color.copy(base).lerp(new THREE.Color(0xffffff), 0.45);
    thinMat.color.set(tint ? base.getHex() : 0xffffff);
    thinMat.opacity = tint ? 0.85 : 0.4;
    clearArcs();
    clearRibbons();
    let n = 0;
    const list = [...(orders || [])].sort((a, b) => (String(a.unitId) === String(selectedId)) - (String(b.unitId) === String(selectedId)));
    for (const o of list) {
      const sel = selectedId != null && String(o.unitId) === String(selectedId);
      if (o.path && o.path.length > 1) {
        const pts = o.path.map(([hq, hr]) => { const c = hexToWorld(hq, hr); return new THREE.Vector3(c.x, 0, c.z); });
        const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.3);
        const len = curve.getLength();
        // selected: thick white trail, soft glow in the player's colour; others: thin faint trail ending on a dot
        if (sel) ribbons.push(...addTrail(scene, hexToWorld, groundHeight, o.path, { width: 0.075, glow: base.getHex(), color: tint ? base.getHex() : 0xffffff, opacity: Math.min(0.96, opacity + 0.15) }));
        else {
          ribbons.push(...addTrail(scene, hexToWorld, groundHeight, o.path, { width: tint ? 0.034 : 0.028, opacity: tint ? 0.85 : 0.4, shadow: tint, color: tint ? base.getHex() : 0xffffff }));
          endDot(pts[pts.length - 1], 0.06, thinMat);
        }
        void curve; void len;
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
  const turnTex = (n) => { if (!tex.has(`t${n}`)) tex.set(`t${n}`, turnBadge(n)); return tex.get(`t${n}`); };
  // round seal: ring in the player's colour (soft glow), disc in the stance colour, pictogram
  const stanceTex = (s, ring, grey = false) => texture(`s${s}${ring}${grey ? 'g' : ''}`, (g) => {
    const sty = window.stanceStyle ? window.stanceStyle(s) : { c: '#444' };
    const grd = g.createRadialGradient(32, 32, 20, 32, 32, 32);
    grd.addColorStop(0, ring); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(32, 32, 32, 0, Math.PI * 2); g.fill();
    g.fillStyle = ring; g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.fill();
    g.fillStyle = sty.c || '#444'; g.beginPath(); g.arc(32, 32, 20, 0, Math.PI * 2); g.fill();
    g.lineWidth = 2; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.stroke();
    if (window.drawStanceIcon) window.drawStanceIcon(g, s, 32, 32, 26);
    if (grey) {
      const img = g.getImageData(0, 0, 64, 64), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const y = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; d[i] = d[i + 1] = d[i + 2] = y; }
      g.putImageData(img, 0, 0);
    }
  });
  // step chosen with Ctrl+click: dashed ring in the player's colour
  const stepTex = (ring) => texture(`r${ring}`, (g) => {
    g.setLineDash([9, 6]);
    g.lineWidth = 9; g.strokeStyle = '#000'; g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 5; g.strokeStyle = ring; g.stroke();
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
      sp.material.map = mk.kind === 'turn' ? turnTex(mk.n) : mk.kind === 'step' ? stepTex(mk.ring || '#ffffff') : stanceTex(mk.stance, mk.ring || '#ffffff', !!mk.grey);
      sp.material.needsUpdate = true;
      const k = mk.kind === 'turn' ? 0.36 : mk.kind === 'step' ? 0.85 : 0.5;
      sp.scale.set(k, k, 1);
      // the stance seal sits on the trail itself, just above the ground
      sp.position.set(c.x, y + 0.3, c.z);
    });
  }
  function clear() { show([]); }
  return { show, clear };
}

// Range (shots) and charisma zones: crisp ribbons draped on the relief along one smooth contour (KBRules.zoneLoops),
// no fill (the movement range is the filled one). Shots: a double golden line with a soft outer glow; charisma: sky-blue
// dashes; the planned range (dash: true) is thinner and paler. zones: [{ keys, center: "q,r", kind: 'tir' | 'charisme', dash? }]
export function createZoneRims(world) {
  const { scene, hexToWorld } = world;
  const ground0 = world.walkHeight || world.groundHeight;
  const ground = (x, z) => { const h = ground0(x, z); return Number.isFinite(h) ? h : 0; };
  const meshes = [];
  let lastSig = '';
  const DIR_TO_GEO_EDGE = [0, 5, 4, 3, 2, 1];
  const edgeOf = (q, r, d) => {
    const c = hexToWorld(q, r), g = DIR_TO_GEO_EDGE[d];
    const a0 = Math.PI / 3 * g, a1 = Math.PI / 3 * (g + 1);
    // exact corners (radius 1): neighbouring hexes share them, so the contour closes into one loop around the zone
    return [[c.x + Math.cos(a0), c.z + Math.sin(a0)], [c.x + Math.cos(a1), c.z + Math.sin(a1)]];
  };
  const STYLE = {
    tir: { color: 0xffc94a, glow: 0xffb020 },
    charisme: { color: 0x7cc8ff, glow: 0x3d9bff },
  };
  // closed polyline resampled every `step`, as [{ x, z }]
  function resampleLoop(loop, step) {
    const out = [];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / step));
      for (let j = 0; j < n; j++) out.push({ x: a[0] + (b[0] - a[0]) * j / n, z: a[1] + (b[1] - a[1]) * j / n });
    }
    return out;
  }
  // strip along pts (open), offset sideways by `shift`, half width w, lifted above the ground
  function strip(pts, w, shift, lift, mat, closed) {
    const pos = [], idx = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      let tx = b.x - a.x, tz = b.z - a.z;
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const nx = -tz, nz = tx, p = pts[i];
      const ox = p.x + nx * shift, oz = p.z + nz * shift;
      const x1 = ox + nx * w, z1 = oz + nz * w, x2 = ox - nx * w, z2 = oz - nz * w;
      pos.push(x1, ground(x1, z1) + lift, z1, x2, ground(x2, z2) + lift, z2);
      if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    if (closed && n > 2) { const k = (n - 1) * 2; idx.push(k, k + 1, 0, k + 1, 1, 0); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat);
    m.frustumCulled = false;
    m.renderOrder = 6;
    scene.add(m);
    meshes.push(m);
  }
  const mat = (color, opacity, additive = false) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -2 });
  function clear() { for (const m of meshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); } meshes.length = 0; }
  function show(zones) {
    const sig = JSON.stringify((zones || []).map((z) => [z.kind, z.center, z.dash ? 1 : 0, [...z.keys].sort()]));
    if (sig === lastSig) return;
    lastSig = sig;
    clear();
    const R = self.KBRules;
    if (!R || !R.zoneLoops) return;
    for (const z of zones || []) {
      if (!z.keys || !z.keys.size) continue;
      const st = STYLE[z.kind] || STYLE.tir;
      const k = z.dash ? 0.65 : 1;
      for (const loop of R.zoneLoops(z.keys, z.center, edgeOf, 3)) {
        const pts = resampleLoop(loop, 0.08);
        if (pts.length < 3) continue;
        // soft outer glow, dark under-line, then the rim (inner side of the contour = toward the zone)
        strip(pts, 0.16 * k, 0, 0.03, mat(st.glow, z.dash ? 0.12 : 0.2, true), true);
        strip(pts, 0.05 * k, 0, 0.035, mat(0x000000, 0.45), true);
        if (z.kind === 'charisme') {
          // dashes
          const dash = z.dash ? 3 : 4, gap = 3;
          for (let i = 0; i < pts.length; i += dash + gap) strip(pts.slice(i, Math.min(pts.length, i + dash + 1)), 0.03 * k, 0, 0.04, mat(st.color, 0.98 * (z.dash ? 0.8 : 1)), false);
        } else if (z.dash) {
          for (let i = 0; i < pts.length; i += 6) strip(pts.slice(i, Math.min(pts.length, i + 4)), 0.022, 0, 0.04, mat(st.color, 0.8), false);
        } else {
          // double golden line
          strip(pts, 0.016, 0.04, 0.04, mat(st.color, 0.98), true);
          strip(pts, 0.016, -0.04, 0.04, mat(st.color, 0.98), true);
        }
      }
    }
  }
  return { show, clear };
}
