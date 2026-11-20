import * as THREE from 'three';
import { G } from './shaderPatches.js';

const SQ3 = Math.sqrt(3);
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const DIR_TO_GEO_EDGE = [0, 5, 4, 3, 2, 1];

function makeCanvasTex(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return { canvas: c, ctx: c.getContext('2d'), tex: t };
}

// Board-space layers: fog-of-war visibility (soft, animated), tile overlays (move/attack/deploy
// fills, range outlines), hover/selection rings and pings.
export function createBoardLayers(world) {
  const { scene, hexToWorld, groundHeight, bounds } = world;
  const margin = 6;
  const B = new THREE.Vector4(bounds.bx0 - margin, bounds.bz0 - margin, bounds.bx1 - bounds.bx0 + margin * 2, bounds.bz1 - bounds.bz0 + margin * 2);
  const toPx = (ppu) => (x, z) => [(x - B.x) * ppu, (z - B.y) * ppu];

  // --- Visibility (fog of war) ---
  const VIS_PPU = 6;
  const visW = Math.ceil(B.z * VIS_PPU), visH = Math.ceil(B.w * VIS_PPU);
  const vis = [makeCanvasTex(visW, visH), makeCanvasTex(visW, visH)];
  for (const v of vis) { v.ctx.fillStyle = '#fff'; v.ctx.fillRect(0, 0, visW, visH); v.tex.needsUpdate = true; }
  let visFront = 0;
  let visAnim = 1;
  G.uVisA.value = vis[0].tex;
  G.uVisB.value = vis[0].tex;
  G.uVisMix.value = 1;
  G.uVisBounds.value.copy(B);
  const visP = toPx(VIS_PPU);
  let lastVisKey = null;

  function hexPath(ctx, P, q, r, scale = 1) {
    const c = hexToWorld(q, r);
    ctx.moveTo(...P(c.x + scale, c.z));
    for (let i = 1; i < 6; i++) {
      const a = Math.PI / 3 * i;
      ctx.lineTo(...P(c.x + Math.cos(a) * scale, c.z + Math.sin(a) * scale));
    }
    ctx.closePath();
  }

  function setVisibility(keys) {
    if (!keys) { G.uFogOn.value = 0; lastVisKey = null; return; }
    const arr = Array.from(keys).sort();
    const sig = arr.join(';');
    G.uFogOn.value = 1;
    if (sig === lastVisKey) return;
    const first = lastVisKey === null;
    lastVisKey = sig;
    const back = vis[1 - visFront];
    const ctx = back.ctx;
    ctx.filter = 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, visW, visH);
    ctx.filter = `blur(${(0.28 * VIS_PPU).toFixed(1)}px)`;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (const k of arr) {
      const [q, r] = k.split(',').map(Number);
      hexPath(ctx, visP, q, r, 1.04);
    }
    ctx.fill();
    ctx.filter = 'none';
    back.tex.needsUpdate = true;
    if (first) {
      G.uVisA.value = back.tex; G.uVisB.value = back.tex; G.uVisMix.value = 1; visAnim = 1;
    } else {
      G.uVisA.value = vis[visFront].tex; G.uVisB.value = back.tex; G.uVisMix.value = 0; visAnim = 0;
    }
    visFront = 1 - visFront;
  }

  // --- Unit occupancy: trees/bushes shrink on hexes holding a formation so soldiers stay visible ---
  const occ = makeCanvasTex(visW, visH);
  G.uOcc.value = occ.tex;
  let lastOcc = null;
  function setOccupied(keys) {
    const arr = keys ? Array.from(keys).sort() : [];
    const sig = arr.join(';');
    if (sig === lastOcc) return;
    lastOcc = sig;
    const ctx = occ.ctx;
    ctx.filter = 'none';
    ctx.clearRect(0, 0, visW, visH);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, visW, visH);
    ctx.filter = `blur(${(0.18 * VIS_PPU).toFixed(1)}px)`;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    for (const k of arr) {
      const [q, r] = k.split(',').map(Number);
      hexPath(ctx, visP, q, r, 0.95);
    }
    ctx.fill();
    ctx.filter = 'none';
    occ.tex.needsUpdate = true;
    G.uOccOn.value = arr.length ? 1 : 0;
  }

  // --- Tile overlays (projected into the terrain shader) ---
  const OV_PPU = 12;
  const ovW = Math.ceil(B.z * OV_PPU), ovH = Math.ceil(B.w * OV_PPU);
  const ov = makeCanvasTex(ovW, ovH);
  ov.tex.needsUpdate = true;
  G.uOverlay.value = ov.tex;
  G.uOverlayBounds.value.copy(B);
  const ovP = toPx(OV_PPU);
  let lastOvSig = null;

  function outline(ctx, keys, center) {
    const interior = new Set(keys);
    if (center) interior.add(center);
    ctx.beginPath();
    for (const k of keys) {
      const [q, r] = k.split(',').map(Number);
      const c = hexToWorld(q, r);
      for (let d = 0; d < 6; d++) {
        if (interior.has(`${q + DIRS[d][0]},${r + DIRS[d][1]}`)) continue;
        const g = DIR_TO_GEO_EDGE[d];
        const a0 = Math.PI / 3 * g, a1 = Math.PI / 3 * (g + 1);
        ctx.moveTo(...ovP(c.x + Math.cos(a0) * 0.97, c.z + Math.sin(a0) * 0.97));
        ctx.lineTo(...ovP(c.x + Math.cos(a1) * 0.97, c.z + Math.sin(a1) * 0.97));
      }
    }
    ctx.stroke();
  }

  // spec: { fills: [{ keys, color }], outlines: [{ keys, center, color, width }] }
  function setOverlay(spec) {
    const sig = JSON.stringify(spec, (k, v) => (v instanceof Set ? Array.from(v).sort() : v));
    if (sig === lastOvSig) return;
    lastOvSig = sig;
    const ctx = ov.ctx;
    ctx.clearRect(0, 0, ovW, ovH);
    for (const f of spec.fills || []) {
      if (!f.keys || !f.keys.size) continue;
      ctx.fillStyle = f.color;
      ctx.beginPath();
      for (const k of f.keys) {
        const [q, r] = k.split(',').map(Number);
        hexPath(ctx, ovP, q, r, 0.93);
      }
      ctx.fill();
      if (f.edge) {
        ctx.strokeStyle = f.edge;
        ctx.lineWidth = 0.07 * OV_PPU;
        outline(ctx, f.keys, null);
      }
    }
    for (const o of spec.outlines || []) {
      if (!o.keys || !o.keys.size) continue;
      ctx.strokeStyle = o.color;
      ctx.lineWidth = (o.width || 0.1) * OV_PPU;
      ctx.lineCap = 'round';
      outline(ctx, o.keys, o.center);
    }
    ov.tex.needsUpdate = true;
  }

  // --- Hex rings (hover / selection / pings) ---
  function ringGeometry(inner, outer) {
    const pos = [], idx = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i;
      pos.push(Math.cos(a) * inner, 0, Math.sin(a) * inner, Math.cos(a) * outer, 0, Math.sin(a) * outer);
    }
    for (let i = 0; i < 6; i++) {
      const a = i * 2, b = ((i + 1) % 6) * 2;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }
  function drape(mesh, q, r) {
    const c = hexToWorld(q, r);
    const pos = mesh.geometry.attributes.position;
    const base = mesh.userData.base || (mesh.userData.base = pos.array.slice());
    for (let i = 0; i < pos.count; i++) {
      const x = c.x + base[i * 3], z = c.z + base[i * 3 + 2];
      pos.setXYZ(i, x, groundHeight(x, z) + 0.05, z);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
  }
  const ringMat = (color, opacity) => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, fog: false, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -4,
  });
  const hoverRing = new THREE.Mesh(ringGeometry(0.86, 0.97), ringMat(0xffd25a, 0.9));
  hoverRing.visible = false;
  hoverRing.renderOrder = 6;
  scene.add(hoverRing);
  let hoverKey = null;
  function setHover(hex, color) {
    const key = hex ? `${hex.q},${hex.r}` : null;
    if (color) hoverRing.material.color.set(color);
    if (key === hoverKey) return;
    hoverKey = key;
    hoverRing.visible = !!hex;
    if (hex) drape(hoverRing, hex.q, hex.r);
  }

  const pings = [];
  function addPing(q, r, color = '#ffd700') {
    const m = new THREE.Mesh(ringGeometry(0.75, 0.95), ringMat(new THREE.Color(color), 1));
    m.renderOrder = 7;
    drape(m, q, r);
    const c = hexToWorld(q, r);
    m.userData.center = new THREE.Vector3(c.x, 0, c.z);
    m.userData.t = 0;
    scene.add(m);
    pings.push(m);
  }

  function update(dt) {
    if (visAnim < 1) {
      visAnim = Math.min(1, visAnim + dt / 0.7);
      G.uVisMix.value = visAnim * visAnim * (3 - 2 * visAnim);
    }
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i];
      p.userData.t += dt;
      const t = p.userData.t;
      const k = (t % 1);
      p.material.opacity = (1 - k) * Math.max(0, 1 - Math.max(0, t - 3) / 1);
      const s = 0.6 + k * 1.2;
      const c = p.userData.center;
      p.position.set(c.x * (1 - s), 0, c.z * (1 - s));
      p.scale.set(s, 1, s);
      if (t > 4) { scene.remove(p); p.geometry.dispose(); p.material.dispose(); pings.splice(i, 1); }
    }
  }

  return { setVisibility, setOverlay, setOccupied, setHover, addPing, update, bounds: B };
}
