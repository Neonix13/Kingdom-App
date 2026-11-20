import * as THREE from 'three';

// Large translucent d20s thrown onto the ground in front of the camera, landing on the real rolled value.
//   const dice = createDice3d(world);
//   dice.roll([{ value: 17, edge: '#D8352A' }, { value: 4 }], { at: THREE.Vector3 | null, label })
//   dice.onEvent(event, data)   combat_result (generals' d20: breakdown.generalD20 / generalD20Def) and initiative_rolled (rolls[id].d20)
//   dice.enabled = false        nothing is shown
const INK = '#111111';
const RED = '#D8352A';

function makeAtlas() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 1024;
  const g = c.getContext('2d');
  const cw = 1024 / 5, chh = 1024 / 4;
  for (let v = 1; v <= 20; v++) {
    const cx = ((v - 1) % 5) * cw, cy = Math.floor((v - 1) / 5) * chh;
    g.save();
    g.translate(cx, cy);
    g.beginPath();
    g.moveTo(cw * 0.06, chh * 0.9); g.lineTo(cw * 0.94, chh * 0.9); g.lineTo(cw * 0.5, chh * 0.06); g.closePath();
    g.fillStyle = 'rgba(250,248,242,0.26)';
    g.fill();
    g.fillStyle = v === 20 || v === 1 ? RED : '#c42d22';
    g.font = `900 ${v > 9 ? 78 : 92}px "Dela Gothic One", "Arial Black", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineJoin = 'round';
    g.strokeText(String(v), cw * 0.5, chh * 0.62);
    g.fillText(String(v), cw * 0.5, chh * 0.62);
    if (v === 6 || v === 9) g.fillRect(cw * 0.38, chh * 0.79, cw * 0.24, 8);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// d20 geometry: face values with opposite faces summing to 21; per face, its normal and the "top" corner direction.
function makeD20() {
  const geo = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
  const pos = geo.attributes.position;
  const faces = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let f = 0; f < 20; f++) {
    a.fromBufferAttribute(pos, f * 3); b.fromBufferAttribute(pos, f * 3 + 1); c.fromBufferAttribute(pos, f * 3 + 2);
    const n = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    const center = a.clone().add(b).add(c).divideScalar(3);
    faces.push({ n, center, top: c.clone().sub(center).normalize(), value: 0 });
  }
  let next = 1;
  for (const f of faces) {
    if (f.value) continue;
    const opp = faces.find((o) => !o.value && o !== f && o.n.dot(f.n) < -0.99);
    f.value = next;
    if (opp) opp.value = 21 - next;
    next++;
  }
  const uv = new Float32Array(60 * 2);
  faces.forEach((f, i) => {
    const u0 = ((f.value - 1) % 5) / 5, v0 = 1 - (Math.floor((f.value - 1) / 5) + 1) / 4;
    const cw = 1 / 5, ch = 1 / 4;
    const pts = [[0.06, 0.1], [0.94, 0.1], [0.5, 0.94]];
    pts.forEach(([x, y], k) => { uv[(i * 3 + k) * 2] = u0 + x * cw; uv[(i * 3 + k) * 2 + 1] = v0 + y * ch; });
  });
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return { geo, faces, inradius: 0.7947 };
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function createDice3d(world) {
  const { scene, camera } = world;
  const ground = world.walkHeight || world.groundHeight;
  const atlas = makeAtlas();
  const D20 = makeD20();
  const edgesGeo = new THREE.EdgesGeometry(D20.geo, 1);
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadowTex = shadowTexture();
  const live = [];
  const up = new THREE.Vector3(0, 1, 0);
  let enabled = true;
  const now = () => performance.now() / 1000;

  // Re-draw the atlas once the display font has loaded
  if (document.fonts && document.fonts.load) document.fonts.load('900 80px "Dela Gothic One"').then(() => { const t = makeAtlas(); atlas.image = t.image; atlas.needsUpdate = true; }).catch(() => {});

  function finalQuaternion(value, awayDir) {
    const face = D20.faces.find((f) => f.value === value) || D20.faces[0];
    const q1 = new THREE.Quaternion().setFromUnitVectors(face.n, up);
    const top = face.top.clone().applyQuaternion(q1).setY(0).normalize();
    const yaw = Math.atan2(awayDir.x, awayDir.z) - Math.atan2(top.x, top.z);
    return new THREE.Quaternion().setFromAxisAngle(up, yaw).multiply(q1);
  }

  function groundAhead() {
    const el = world.renderer.domElement, r = el.getBoundingClientRect();
    return world.pickPoint(r.left + r.width * 0.5, r.top + r.height * 0.6) || world.controls.target.clone();
  }

  function roll(list, { at = null } = {}) {
    if (!enabled || !list || !list.length) return 0;
    const target = at ? at.clone() : groundAhead();
    const camFlat = camera.position.clone().sub(target).setY(0);
    // a staged combat brings the camera within ~22 units of the action (gameView), so size the dice for that view
    const camDist = Math.min(camera.position.distanceTo(target), at ? 22 : Infinity);
    const toCam = camFlat.lengthSq() > 1e-6 ? camFlat.normalize() : new THREE.Vector3(0, 0, 1);
    const right = new THREE.Vector3(toCam.z, 0, -toCam.x);
    const R = THREE.MathUtils.clamp(camDist * 0.04, 0.25, 3);
    const land = at ? target.clone().addScaledVector(right, R * 4.2).addScaledVector(toCam, R * 1.5) : target.clone().addScaledVector(toCam, camDist * 0.06);
    const t = now();
    list.forEach((d, i) => {
      const value = THREE.MathUtils.clamp(Math.round(d.value) || 1, 1, 20);
      const off = (i - (list.length - 1) / 2) * R * 2.6;
      const end = land.clone().addScaledVector(right, off);
      const side = off !== 0 ? Math.sign(off) : Math.random() < 0.5 ? -1 : 1;
      const start = end.clone().addScaledVector(right, side * R * (5 + Math.random() * 2)).addScaledVector(toCam, R * (1.5 + Math.random() * 2));
      const dir = end.clone().sub(start).setY(0);
      const travel = dir.length();
      dir.normalize();
      const mat = new THREE.MeshStandardMaterial({ map: atlas, transparent: true, opacity: 1, roughness: 0.22, metalness: 0, depthWrite: false, fog: false, emissive: 0xffffff, emissiveMap: atlas, emissiveIntensity: 0.22, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(D20.geo, mat);
      mesh.scale.setScalar(R);
      mesh.renderOrder = 20;
      const edges = new THREE.LineSegments(edgesGeo, new THREE.LineBasicMaterial({ color: d.edge || INK, transparent: true, opacity: 0.95, fog: false, depthWrite: false }));
      edges.renderOrder = 21;
      mesh.add(edges);
      const shadow = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, fog: false }));
      shadow.renderOrder = 19;
      scene.add(mesh, shadow);
      const T = 1.35 + Math.random() * 0.25;
      live.push({
        mesh, edges, shadow, mat, start, dir, travel, R, T, t0: t + i * 0.09,
        qFinal: finalQuaternion(value, toCam.clone().negate()),
        axis: up.clone().cross(dir).normalize(), spin: (Math.random() - 0.5) * 6,
        hops: [{ at: 0.3, h: 0 }, { at: 0.56, h: 1.3 }, { at: 0.74, h: 0.5 }, { at: 0.85, h: 0.16 }], h0: 3.2,
        hold: 1.25,
      });
    });
    update(0);
    return 1.6;
  }

  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3();
  function heightAt(d, k) {
    const hops = d.hops;
    if (k < hops[0].at) { const s = k / hops[0].at; return d.h0 * (1 - s * s); }
    for (let i = 0; i < hops.length - 1; i++) {
      if (k < hops[i + 1].at) { const s = (k - hops[i].at) / (hops[i + 1].at - hops[i].at); return 4 * hops[i + 1].h * s * (1 - s); }
    }
    return 0;
  }
  function update() {
    if (!live.length) return;
    const t = now();
    for (let i = live.length - 1; i >= 0; i--) {
      const d = live[i];
      const e = t - d.t0;
      const k = THREE.MathUtils.clamp(e / d.T, 0, 1);
      const u = 1 - Math.pow(1 - k, 2.2);
      _p.copy(d.start).addScaledVector(d.dir, d.travel * u);
      const settle = THREE.MathUtils.smoothstep(k, 0.8, 1);
      const rest = d.R * (1 - (1 - D20.inradius) * settle);
      const gy = ground(_p.x, _p.z);
      _p.y = gy + rest + heightAt(d, k) * d.R;
      d.mesh.position.copy(_p);
      const phi = -(d.travel / (d.R * D20.inradius)) * (1 - u);
      _q.setFromAxisAngle(d.axis, phi);
      _q2.setFromAxisAngle(up, d.spin * (1 - u) * (1 - u));
      d.mesh.quaternion.copy(_q).multiply(_q2).multiply(d.qFinal);
      d.mesh.visible = e >= 0;
      d.shadow.visible = e >= 0;
      const lift = _p.y - gy;
      d.shadow.position.set(_p.x, gy + 0.02, _p.z);
      d.shadow.scale.setScalar(d.R * (2.2 + lift * 0.4));
      const fade = 1 - THREE.MathUtils.clamp((e - d.T - d.hold) / 0.6, 0, 1);
      d.mat.opacity = fade;
      d.edges.material.opacity = 0.95 * fade;
      d.shadow.material.opacity = fade * THREE.MathUtils.clamp(1 - lift / (d.R * 4), 0.2, 1);
      if (fade <= 0) {
        scene.remove(d.mesh, d.shadow);
        d.mat.dispose(); d.edges.material.dispose(); d.shadow.material.dispose();
        live.splice(i, 1);
      }
    }
  }
  world.frameHooks.push(update);

  function onEvent(event, data, ctx = {}) {
    if (!enabled || !data) return;
    if (event === 'combat_result') {
      const log = data.combatLog || data;
      if (!log || log.duel || log.abilityUsed || data.playback) return;
      const list = [];
      // NGO resolution: a unit rolls one die per 5 vitality (shown in the combat card); generals roll a single d20
      const b = log.breakdown || {};
      if (b.generalD20 != null) list.push({ value: b.generalD20, edge: RED });
      if (b.generalD20Def != null) list.push({ value: b.generalD20Def, edge: INK });
      if (list.length) roll(list, { at: ctx.at || null });
    } else if (event === 'initiative_rolled' && data.rolls) {
      const order = data.turnOrder || Object.keys(data.rolls);
      const list = order.map((id) => data.rolls[id]).filter((r) => r && r.d20 != null).slice(0, 6)
        .map((r, i) => ({ value: r.d20, edge: (ctx.colorOf && ctx.colorOf(order[i])) || INK }));
      if (list.length) roll(list);
    }
  }

  function dispose() {
    const i = world.frameHooks.indexOf(update);
    if (i >= 0) world.frameHooks.splice(i, 1);
    for (const d of live) { scene.remove(d.mesh, d.shadow); d.mat.dispose(); d.edges.material.dispose(); d.shadow.material.dispose(); }
    live.length = 0;
    D20.geo.dispose(); edgesGeo.dispose(); shadowGeo.dispose(); atlas.dispose(); shadowTex.dispose();
  }

  return {
    roll, onEvent, update, dispose,
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
    get count() { return live.length; },
  };
}
