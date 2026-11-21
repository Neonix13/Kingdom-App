import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise2D, makeRng } from './noise.js';

const _c = new THREE.Color();

function strip(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  }
  return g;
}

function paint(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), _c, i);
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function spherizeNormals(geo, cx, cy, cz, amount = 1) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i) - cx, pos.getY(i) - cy, pos.getZ(i) - cz).normalize();
    n.set(nor.getX(i), nor.getY(i), nor.getZ(i)).lerp(v, amount).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
}

function jitter(geo, amount, seed) {
  const noise = makeNoise2D(seed);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = noise(x * 6.1 + z * 2.3, y * 6.7 - z * 3.1) * amount;
    pos.setXYZ(i, x * (1 + k), y * (1 + k * 0.6), z * (1 + k));
  }
}

const lin = (hex) => new THREE.Color(hex);

// 0 = trunk (bark texture), 1 = foliage
function part(geo, v) {
  geo.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count).fill(v), 1));
  return geo;
}

// ---- Procedural tree textures (grey detail maps, multiplied onto the vertex colours) ----
let _treeTex = null;
function tileDraw(ctx, size, fn) {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) { ctx.save(); ctx.translate(dx, dy); fn(); ctx.restore(); }
}
function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function grey(v, a = 1) { const g = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgba(${g},${g},${g},${a})`; }

export function treeTextures() {
  if (_treeTex || typeof document === 'undefined') return _treeTex;
  const rng = makeRng(4242);
  // Broadleaf: overlapping leaf clusters, light tops, dark gaps (never transparent)
  const leaves = canvasTex(512, 512, (ctx, S) => {
    ctx.fillStyle = grey(0.32); ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 2600; i++) {
      const x = rng() * S, y = rng() * S, r = 7 + rng() * 12, a = rng() * Math.PI, v = 0.35 + rng() * 0.6;
      tileDraw(ctx, S, () => {
        ctx.translate(x, y); ctx.rotate(a);
        const g = ctx.createLinearGradient(-r, -r * 0.5, r, r * 0.5);
        g.addColorStop(0, grey(v + 0.18)); g.addColorStop(1, grey(v - 0.2));
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.48, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = grey(v - 0.28, 0.5); ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-r * 0.8, 0); ctx.lineTo(r * 0.8, 0); ctx.stroke();
      });
    }
  });
  // Conifer: short needle strokes hanging down and outwards in layered tufts
  const needles = canvasTex(512, 512, (ctx, S) => {
    ctx.fillStyle = grey(0.28); ctx.fillRect(0, 0, S, S);
    ctx.lineCap = 'round';
    for (let i = 0; i < 7000; i++) {
      const x = rng() * S, y = rng() * S, len = 10 + rng() * 22, a = Math.PI / 2 + (rng() - 0.5) * 1.3, v = 0.3 + rng() * 0.65;
      tileDraw(ctx, S, () => {
        ctx.strokeStyle = grey(v); ctx.lineWidth = 1.2 + rng() * 1.4;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
      });
    }
  });
  // Bark: vertical fibres with dark furrows and a few horizontal cracks
  const bark = canvasTex(128, 256, (ctx, W, H) => {
    ctx.fillStyle = grey(0.55); ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) {
      const x = rng() * W, w = 1 + rng() * 4, v = 0.3 + rng() * 0.55, y0 = rng() * H, len = 30 + rng() * 140;
      for (const dx of [-W, 0, W]) for (const dy of [-H, 0, H]) {
        ctx.fillStyle = grey(v, 0.8);
        ctx.fillRect(x + dx + Math.sin(y0) * 2, y0 + dy, w, len);
      }
    }
    for (let i = 0; i < 26; i++) {
      const x = rng() * W, w = 2 + rng() * 3;
      for (const dx of [-W, 0, W]) { ctx.fillStyle = grey(0.12, 0.85); ctx.fillRect(x + dx, 0, w, H); }
    }
    for (let i = 0; i < 40; i++) {
      const x = rng() * W, y = rng() * H;
      ctx.fillStyle = grey(0.15, 0.7); ctx.fillRect(x, y, 6 + rng() * 14, 1.5);
    }
  });
  _treeTex = { leaves, needles, bark };
  return _treeTex;
}

// Shader patch (patchLit "extra"): bark on trunks, leaf / needle detail and darker clump hollows on foliage.
// Triplanar in object space so instancing, wind and LOD keep working; fully opaque (no alpha cut-outs).
export function treeTexturePatch(kind) {
  const tex = treeTextures();
  return (shader) => {
    if (!tex) return;
    const foliage = kind === 'conifer' ? tex.needles : tex.leaves;
    shader.uniforms.uFoliageTex = { value: foliage };
    shader.uniforms.uBarkTex = { value: tex.bark };
    const scale = kind === 'conifer' ? 2.1 : kind === 'bush' ? 2.6 : 1.9;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute float aPart;
varying float vPart;
varying vec3 vObj;
varying vec3 vObjN;
varying float vSeed;
`).replace('#include <begin_vertex>', `#include <begin_vertex>
vPart = aPart;
vObj = position;
vObjN = normal;
{
  vec3 _sp = vec3( 0.0 );
  #ifdef USE_INSTANCING
    _sp = instanceMatrix[ 3 ].xyz;
  #endif
  vSeed = fract( sin( dot( _sp.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
}
`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform sampler2D uFoliageTex;
uniform sampler2D uBarkTex;
varying float vPart;
varying vec3 vObj;
varying vec3 vObjN;
varying float vSeed;
// x: albedo detail, y: blurred detail (cavities), z: macro clump shading
vec3 treeDetail() {
  if ( vPart < 0.5 ) {
    vec2 uv = vec2( atan( vObj.z, vObj.x ) * 0.4775 + vSeed, vObj.y * 1.4 + vSeed * 3.0 );
    return vec3( texture2D( uBarkTex, uv ).r, texture2D( uBarkTex, uv, 1.5 ).r, 1.0 );
  }
  vec3 p = vObj * ${scale.toFixed(2)} + vec3( vSeed * 7.0, vSeed * 3.0, vSeed * 5.0 );
  vec3 w = pow( abs( normalize( vObjN ) ), vec3( 4.0 ) );
  w /= ( w.x + w.y + w.z + 1e-4 );
  vec3 d = vec3( 0.0 );
  d.x = texture2D( uFoliageTex, p.zy ).r * w.x + texture2D( uFoliageTex, p.xz * 0.9 ).r * w.y + texture2D( uFoliageTex, p.xy ).r * w.z;
  d.y = texture2D( uFoliageTex, p.zy, 2.0 ).r * w.x + texture2D( uFoliageTex, p.xz * 0.9, 2.0 ).r * w.y + texture2D( uFoliageTex, p.xy, 2.0 ).r * w.z;
  vec3 q = p * 0.23;
  d.z = texture2D( uFoliageTex, q.zy, 3.0 ).r * w.x + texture2D( uFoliageTex, q.xz, 3.0 ).r * w.y + texture2D( uFoliageTex, q.xy, 3.0 ).r * w.z;
  return d;
}
`).replace('#include <color_fragment>', `#include <color_fragment>
vec3 _td = treeDetail();
{
  if ( vPart < 0.5 ) diffuseColor.rgb *= 0.4 + _td.x * 1.25;
  else {
    diffuseColor.rgb *= mix( 1.0, 0.55 + _td.x * 0.9, 0.72 );
    diffuseColor.rgb *= 0.8 + smoothstep( 0.32, 0.6, _td.y ) * 0.26;
    diffuseColor.rgb *= 0.8 + smoothstep( 0.3, 0.62, _td.z ) * 0.32;
  }
  diffuseColor.rgb *= 0.93 + vSeed * 0.14;
}
`);
  };
}

export function makeConiferGeometry(variant = 0, lod = 0) {
  const parts = [];
  const trunkCol = lin(0x4a3220);
  const trunk = strip(new THREE.CylinderGeometry(0.03, 0.05, 0.6, lod ? 4 : 5, 1, true));
  trunk.translate(0, 0.15, 0);
  parts.push(part(paint(trunk, (x, y, z, c) => c.copy(trunkCol)), 0));

  let tiers = variant === 0
    ? [[0.36, 0.55, 0.22], [0.29, 0.5, 0.5], [0.21, 0.46, 0.78], [0.12, 0.34, 1.04]]
    : [[0.3, 0.6, 0.2], [0.24, 0.55, 0.52], [0.15, 0.5, 0.85]];
  if (lod) tiers = [[0.34, 0.75, 0.22], [0.22, 0.7, 0.68]];
  const top = tiers[tiers.length - 1][2] + tiers[tiers.length - 1][1];
  const dark = lin(0x1d3f1f), light = lin(0x4b7a3a);
  tiers.forEach(([r, h, y], ti) => {
    const cone = strip(new THREE.ConeGeometry(r, h, lod ? 6 : 8, lod ? 1 : 2, true));
    cone.rotateY(ti * 0.7);
    cone.translate(0, y + h / 2, 0);
    jitter(cone, 0.07, 17 + ti + variant * 5);
    cone.computeVertexNormals();
    spherizeNormals(cone, 0, y + h * 0.15, 0, 0.45);
    paint(cone, (x, yy, z, c) => {
      const local = (yy - y) / h;
      const g = yy / top;
      c.copy(dark).lerp(light, Math.min(1, 0.15 + g * 0.55 + local * 0.35));
      c.multiplyScalar(0.75 + 0.25 * local);
    });
    parts.push(part(cone, 1));
  });
  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  return geo;
}

export function makeBroadleafGeometry(variant = 0, lod = 0) {
  const parts = [];
  const trunkCol = lin(0x5b4128);
  const trunk = strip(new THREE.CylinderGeometry(0.035, 0.06, 0.7, lod ? 4 : 5, 1, true));
  trunk.translate(0, 0.2, 0);
  parts.push(part(paint(trunk, (x, y, z, c) => c.copy(trunkCol)), 0));

  let blobs = variant === 0
    ? [[0, 0.78, 0, 0.34], [0.2, 0.66, 0.08, 0.25], [-0.18, 0.68, -0.08, 0.26], [0.04, 0.98, -0.06, 0.24]]
    : [[0, 0.7, 0, 0.3], [0.16, 0.88, 0.05, 0.22], [-0.15, 0.62, 0.1, 0.22]];
  if (lod) blobs = [[0, 0.75, 0, 0.36], [0.12, 0.95, -0.04, 0.24]];
  const cc = new THREE.Vector3(0, 0.78, 0);
  const dark = lin(0x22401a), light = lin(0x6a9244);
  blobs.forEach(([x, y, z, r], bi) => {
    const s = strip(new THREE.IcosahedronGeometry(r, lod ? 0 : 1));
    jitter(s, lod ? 0.08 : 0.16, 31 + bi + variant * 7);
    s.translate(x, y, z);
    s.computeVertexNormals();
    spherizeNormals(s, cc.x, cc.y - 0.1, cc.z, 0.75);
    paint(s, (px, py, pz, c) => {
      const up = (py - (y - r)) / (2 * r);
      const out = Math.min(1, Math.hypot(px, pz) / 0.45);
      c.copy(dark).lerp(light, Math.min(1, 0.1 + up * 0.6 + out * 0.25 + (py - 0.4) * 0.3));
    });
    parts.push(part(s, 1));
  });
  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  return geo;
}

export function makeBushGeometry() {
  const s = strip(new THREE.IcosahedronGeometry(0.2, 1));
  jitter(s, 0.2, 77);
  s.scale(1, 0.7, 1);
  s.translate(0, 0.08, 0);
  s.computeVertexNormals();
  spherizeNormals(s, 0, -0.05, 0, 0.7);
  const dark = lin(0x264519), light = lin(0x62903e);
  paint(s, (x, y, z, c) => c.copy(dark).lerp(light, Math.min(1, Math.max(0, (y + 0.06) / 0.3))));
  return part(s, 1);
}

export function makeGrassTuftGeometry(seed = 5) {
  const rng = makeRng(seed);
  const pos = [], nor = [], col = [];
  const base = lin(0x45662a), tip = lin(0xa9c766);
  const blades = 5;
  for (let b = 0; b < blades; b++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * 0.07;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const h = 0.1 + rng() * 0.12;
    const w = 0.012 + rng() * 0.01;
    const lean = 0.03 + rng() * 0.06;
    const la = rng() * Math.PI * 2;
    const ox = Math.cos(la) * lean, oz = Math.sin(la) * lean;
    const px = -Math.sin(a + 1.2) * w, pz = Math.cos(a + 1.2) * w;
    const mid = [bx + ox * 0.35, h * 0.55, bz + oz * 0.35];
    const v = [
      [bx - px, 0, bz - pz], [bx + px, 0, bz + pz],
      [mid[0] - px * 0.7, mid[1], mid[2] - pz * 0.7], [mid[0] + px * 0.7, mid[1], mid[2] + pz * 0.7],
      [bx + ox, h, bz + oz],
    ];
    const tris = [[0, 1, 3], [0, 3, 2], [2, 3, 4]];
    for (const t of tris) {
      for (const i of t) {
        pos.push(...v[i]);
        nor.push(ox * 2, 1, oz * 2);
        _c.copy(base).lerp(tip, Math.min(1, v[i][1] / 0.2));
        col.push(_c.r, _c.g, _c.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const n = g.attributes.normal, tmp = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) { tmp.fromBufferAttribute(n, i).normalize(); n.setXYZ(i, tmp.x, tmp.y, tmp.z); }
  g.computeBoundingSphere();
  return g;
}

export function makeWheatGeometry(seed = 9) {
  const rng = makeRng(seed);
  const pos = [], nor = [], col = [];
  const stem = lin(0x9a8a3a), head = lin(0xe8c35a), base = lin(0x6d6a2a);
  const stalks = 7;
  for (let s = 0; s < stalks; s++) {
    const bx = (rng() - 0.5) * 0.16, bz = (rng() - 0.5) * 0.16;
    const h = 0.22 + rng() * 0.08;
    const ox = (rng() - 0.5) * 0.06, oz = (rng() - 0.5) * 0.06;
    const a = rng() * Math.PI;
    const w = 0.006, hw = 0.016;
    const px = Math.cos(a), pz = Math.sin(a);
    const top = [bx + ox, h, bz + oz];
    const headStart = h * 0.7;
    const hs = [bx + ox * 0.7, headStart, bz + oz * 0.7];
    const quad = (p0, p1, w0, w1, c0, c1) => {
      const v = [
        [p0[0] - px * w0, p0[1], p0[2] - pz * w0], [p0[0] + px * w0, p0[1], p0[2] + pz * w0],
        [p1[0] + px * w1, p1[1], p1[2] + pz * w1], [p1[0] - px * w1, p1[1], p1[2] - pz * w1],
      ];
      const cs = [c0, c0, c1, c1];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(...v[i]);
        nor.push(ox * 3, 1, oz * 3);
        col.push(cs[i].r, cs[i].g, cs[i].b);
      }
    };
    quad([bx, 0, bz], hs, w, w, base, stem);
    quad(hs, top, hw, hw * 0.4, head, head.clone().multiplyScalar(1.12));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const n = g.attributes.normal, tmp = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) { tmp.fromBufferAttribute(n, i).normalize(); n.setXYZ(i, tmp.x, tmp.y, tmp.z); }
  g.computeBoundingSphere();
  return g;
}

export function makeRockGeometry(seed = 3, kind = 'boulder') {
  const g = strip(new THREE.IcosahedronGeometry(0.5, 1));
  const noise = makeNoise2D(seed);
  const rng = makeRng(seed * 13 + 1);
  const planes = [];
  for (let i = 0; i < 7; i++) {
    const n = new THREE.Vector3(rng() * 2 - 1, rng() * 1.6 - 0.4, rng() * 2 - 1).normalize();
    planes.push([n, 0.3 + rng() * 0.16]);
  }
  planes.push([new THREE.Vector3(0, 1, 0), kind === 'slab' ? 0.42 : 0.3]);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const cache = new Map();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const key = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    let out = cache.get(key);
    if (!out) {
      const k = 1 + noise(v.x * 2.3 + v.y * 1.1, v.z * 2.1 - v.y * 1.7) * 0.18;
      v.multiplyScalar(k);
      for (const [n, d] of planes) {
        const over = v.dot(n) - d;
        if (over > 0) v.addScaledVector(n, -over);
      }
      if (kind === 'slab') v.set(v.x * 0.75, v.y * 1.25, v.z * 0.45);
      else v.set(v.x * 1.15, v.y * 0.8, v.z);
      v.y = Math.max(v.y, -0.2);
      out = v.clone();
      cache.set(key, out);
    }
    pos.setXYZ(i, out.x, out.y, out.z);
  }
  g.computeVertexNormals();
  const light = lin(0xc8bba3), dark = lin(0x7f725f), moss = lin(0x7a8550);
  paint(g, (x, y, z, c) => {
    const t = Math.min(1, Math.max(0, (y + 0.2) / 0.6));
    c.copy(dark).lerp(light, t);
    if (y > 0.18 && kind !== 'slab') c.lerp(moss, 0.35);
  });
  g.computeBoundingSphere();
  return g;
}

export function instanced(geo, mat, items, { castShadow = false, receiveShadow = true } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const e = new THREE.Euler();
  const hasColor = items.some((it) => it.color);
  items.forEach((it, i) => {
    e.set(it.rx || 0, it.ry || 0, it.rz || 0);
    q.setFromEuler(e);
    s.set(it.s * (it.sx || 1), it.s * (it.sy || 1), it.s * (it.sz || 1));
    p.set(it.x, it.y, it.z);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (hasColor) mesh.setColorAt(i, it.color || _c.setRGB(1, 1, 1));
  });
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.frustumCulled = false;
  return mesh;
}

export function makeFlowerGeometry(seed = 21) {
  const rng = makeRng(seed);
  const parts = [];
  const stemCol = lin(0x4f6e2c);
  for (let i = 0; i < 4; i++) {
    const x = (rng() - 0.5) * 0.12, z = (rng() - 0.5) * 0.12;
    const h = 0.07 + rng() * 0.07;
    const stem = strip(new THREE.CylinderGeometry(0.003, 0.004, h, 3, 1, true));
    stem.translate(x, h / 2, z);
    parts.push(paint(stem, (px, py, pz, c) => c.copy(stemCol)));
    const head = strip(new THREE.OctahedronGeometry(0.02 + rng() * 0.01, 0));
    head.scale(1, 0.6, 1);
    head.translate(x, h + 0.008, z);
    parts.push(paint(head, (px, py, pz, c) => c.setRGB(1, 1, 1)));
  }
  const g = mergeGeometries(parts);
  const n = g.attributes.normal, tmp = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) { tmp.fromBufferAttribute(n, i); tmp.y += 1.2; tmp.normalize(); n.setXYZ(i, tmp.x, tmp.y, tmp.z); }
  g.computeBoundingSphere();
  return g;
}

export function makeBannerGeometry() {
  const parts = [];
  const pole = strip(new THREE.CylinderGeometry(0.018, 0.024, 1.7, 6, 1, false));
  pole.translate(0, 0.85, 0);
  parts.push(paint(pole, (x, y, z, c) => c.set(0x3b2a1a)));
  const tip = strip(new THREE.ConeGeometry(0.035, 0.08, 6));
  tip.translate(0, 1.74, 0);
  parts.push(paint(tip, (x, y, z, c) => c.set(0xc9a24a)));
  const g = mergeGeometries(parts);
  g.computeBoundingSphere();
  return g;
}

export function makeClothGeometry(w = 0.55, h = 0.34) {
  const g = new THREE.PlaneGeometry(w, h, 10, 4);
  g.translate(w / 2, 0, 0);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const border = Math.abs(y) > h * 0.36 || x > w * 0.92;
    const emblem = Math.hypot(x - w * 0.45, y) < h * 0.2;
    _c.set(border ? 0x1c1410 : emblem ? 0xe8c25a : 0x9c1f1a);
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}
