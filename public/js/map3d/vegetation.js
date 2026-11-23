import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise2D, makeRng } from './noise.js';
import { G } from './shaderPatches.js';

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

// Light that goes through thin foliage / grass seen against the sun (cheap translucency), added after lighting.
// G.uSunDir / G.uSunCol are set by the time-of-day update; strength per material.
function translucency(shader, strength, wrap) {
  shader.uniforms.uSunDir = G.uSunDir;
  shader.uniforms.uSunCol = G.uSunCol;
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform vec3 uSunDir;
uniform vec3 uSunCol;
`).replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  vec3 _v = normalize( cameraPosition - vPWorld );
  float _back = pow( clamp( dot( -_v, uSunDir ), 0.0, 1.0 ), 3.0 );
  float _wrap = clamp( ( dot( normal, -( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz ) + ${wrap.toFixed(2)} ) / ( 1.0 + ${wrap.toFixed(2)} ), 0.0, 1.0 );
  reflectedLight.directDiffuse += diffuseColor.rgb * uSunCol * ( _back * 0.75 + _wrap * 0.25 ) * ${strength.toFixed(3)};
}
`);
}

// Shader patch (patchLit "extra"): bark on trunks, leaf / needle detail and darker clump hollows on foliage.
// Triplanar in object space so instancing, wind and LOD keep working; fully opaque (no alpha cut-outs).
export function treeTexturePatch(kind) {
  const tex = treeTextures();
  return (shader) => {
    if (!tex) return;
    translucency(shader, kind === 'conifer' ? 0.1 : 0.16, 0.35);
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

// Tapered, slightly bent trunk with a root flare (indexed while shaping so the normals stay smooth)
function trunkGeometry(h, r0, r1, sides, bx, bz, segs = 2) {
  const g = new THREE.CylinderGeometry(r1, r0, h, sides, segs, true);
  g.translate(0, h / 2, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / h;
    const flare = t < 0.16 ? 1 + ((0.16 - t) / 0.16) ** 2 * 0.7 : 1;
    pos.setXYZ(i, pos.getX(i) * flare + bx * t * t, pos.getY(i), pos.getZ(i) * flare + bz * t * t);
  }
  g.computeVertexNormals();
  return strip(g);
}

// Thin branch from a to b
function branchGeometry(a, b, r0, r1) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, 4, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()));
  g.translate(a.x, a.y, a.z);
  g.computeVertexNormals();
  return strip(g);
}

const BARK = lin(0x4d3622), BARK_DARK = lin(0x2c1f14);
function paintBark(g, top) {
  return paint(g, (x, y, z, c) => c.copy(BARK_DARK).lerp(BARK, Math.min(1, 0.35 + (y / top) * 0.9)));
}

// Broadleaf: a crown of overlapping leaf clusters around a dome, soft "cloud" shading (normals pulled toward the
// crown centre), darker underside and core, a bent trunk with a root flare and a few branches into the crown.
export function makeBroadleafGeometry(variant = 0, lod = 0) {
  const rng = makeRng(101 + variant * 37 + lod * 5);
  const parts = [];
  const crown = variant === 0 ? { y: 0.8, rx: 0.42, ry: 0.32, rz: 0.4 } : { y: 0.9, rx: 0.3, ry: 0.42, rz: 0.31 };
  const bx = (rng() - 0.5) * 0.07, bz = (rng() - 0.5) * 0.07;
  const trunkTop = crown.y - crown.ry * 0.3;
  parts.push(part(paintBark(trunkGeometry(trunkTop, 0.058, 0.028, lod ? 4 : 6, bx, bz, lod ? 1 : 2), trunkTop), 0));
  const cx = bx, cy = crown.y, cz = bz;
  if (!lod) {
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + rng() * 0.8, y0 = trunkTop * (0.55 + rng() * 0.2);
      const t0 = (y0 / trunkTop) ** 2;
      const from = new THREE.Vector3(bx * t0, y0, bz * t0);
      const to = new THREE.Vector3(cx + Math.cos(a) * crown.rx * 0.62, cy - crown.ry * 0.15, cz + Math.sin(a) * crown.rz * 0.62);
      parts.push(part(paintBark(branchGeometry(from, to, 0.019, 0.008), trunkTop), 0));
    }
  }
  const n = lod ? 4 : 10;
  const clusters = [{ x: cx, y: cy, z: cz, r: Math.min(crown.rx, crown.ry) * 0.86, d: 0 }];
  for (let i = 0; i < n - 1; i++) {
    const u = (n - 1 === 1) ? 0 : i / (n - 2);
    const yd = 0.9 - u * 1.35;
    const rad = Math.sqrt(Math.max(0, 1 - yd * yd));
    const phi = i * 2.39996 + rng() * 0.5;
    clusters.push({
      x: cx + Math.cos(phi) * rad * crown.rx * 0.78,
      y: cy + yd * crown.ry * 0.72,
      z: cz + Math.sin(phi) * rad * crown.rz * 0.78,
      r: (variant === 0 ? 0.165 : 0.145) * (0.85 + rng() * 0.4),
      d: !lod && i < 4 ? 1 : 0,
    });
  }
  const dark = lin(0x1a3313), mid = lin(0x375d25), light = lin(0x678f3e);
  const ext = Math.max(crown.rx, crown.ry);
  clusters.forEach((cl, ci) => {
    const s = new THREE.IcosahedronGeometry(cl.r, cl.d);
    jitter(s, cl.d ? 0.2 : 0.14, 31 + ci + variant * 7 + lod * 3);
    s.translate(cl.x, cl.y, cl.z);
    s.computeVertexNormals();
    spherizeNormals(s, cl.x, cl.y, cl.z, 1);
    spherizeNormals(s, cx, cy - crown.ry * 0.25, cz, 0.68);
    const g = strip(s);
    const tint = 0.9 + rng() * 0.2;
    const nor = g.attributes.normal;
    paint(g, (px, py, pz, c, i) => {
      const up = (py - (cy - crown.ry)) / (2 * crown.ry);
      const out = Math.min(1, Math.hypot(px - cx, (py - cy) * 0.7, pz - cz) / ext);
      const k = Math.min(1, Math.max(0, 0.02 + up * 0.62 + out * 0.4));
      if (k < 0.5) c.copy(dark).lerp(mid, k * 2); else c.copy(mid).lerp(light, (k - 0.5) * 2);
      if (nor.getY(i) < -0.25) c.multiplyScalar(0.78);
      // each lump darker underneath, so the clusters read apart from each other
      const ly = (py - cl.y) / cl.r;
      c.multiplyScalar(tint * (0.7 + 0.3 * Math.min(1, Math.max(0, (ly + 0.7) / 1.3))));
    });
    parts.push(part(g, 1));
  });
  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  return geo;
}

// Conifer: stacked star-shaped tiers that droop at the tips and taper toward the top, each with a shallow
// underside so the tree stays opaque from low angles; tips lighter, core and undersides darker.
export function makeConiferGeometry(variant = 0, lod = 0) {
  const rng = makeRng(203 + variant * 41 + lod * 7);
  const parts = [];
  const spec = variant === 0
    ? { n: lod ? 3 : 6, y0: 0.16, top: 1.2, r: 0.42, h: 0.36, droop: 0.07, trunk: 0.5 }
    : { n: lod ? 3 : 5, y0: 0.3, top: 1.28, r: 0.34, h: 0.34, droop: 0.11, trunk: 0.62 };
  const bx = (rng() - 0.5) * 0.04, bz = (rng() - 0.5) * 0.04;
  parts.push(part(paintBark(trunkGeometry(spec.trunk, 0.048, 0.02, lod ? 4 : 5, bx, bz, lod ? 1 : 2), spec.trunk), 0));
  const K = lod ? 5 : 7;
  const dark = lin(0x16301a), mid = lin(0x2a4f2a), light = lin(0x5e8a46);
  for (let k = 0; k < spec.n; k++) {
    const u = spec.n === 1 ? 0 : k / (spec.n - 1);
    const r = spec.r * (1 - u * 0.8) * (0.92 + rng() * 0.16);
    const h = spec.h * (1 - u * 0.4);
    const yb = spec.y0 + u * (spec.top - h - spec.y0);
    const apex = yb + h;
    const ox = bx * Math.min(1, yb / spec.trunk) ** 2, oz = bz * Math.min(1, yb / spec.trunk) ** 2;
    const rot = rng() * Math.PI;
    const full = !lod && k < 3; // lower tiers: curved profile; upper tiers: plain stars (all closed underneath: shadows, low views)
    const verts = [[ox, apex, oz]];
    const ring = [], midRing = [];
    for (let j = 0; j < 2 * K; j++) {
      const a = rot + (j * Math.PI) / K + (rng() - 0.5) * 0.12;
      const tip = j % 2 === 0;
      const rr = r * (tip ? 0.95 + rng() * 0.15 : 0.6 + rng() * 0.1);
      const dy = tip ? spec.droop * (0.8 + rng() * 0.5) * (1 - u * 0.4) : spec.droop * 0.25;
      ring.push([ox + Math.cos(a) * rr, yb - dy, oz + Math.sin(a) * rr]);
      if (full) {
        const mr = rr * 0.52;
        const lineY = apex - 0.52 * (apex - (yb - dy));
        midRing.push([ox + Math.cos(a) * mr, lineY + h * 0.1, oz + Math.sin(a) * mr]);
      }
    }
    const idx = [];
    const M = 2 * K;
    const midBase = 1, outBase = full ? 1 + M : 1;
    if (full) verts.push(...midRing);
    verts.push(...ring);
    const under = verts.length;
    verts.push([ox, yb + h * 0.12, oz]);
    for (let j = 0; j < M; j++) {
      const j2 = (j + 1) % M;
      if (!full) idx.push(0, outBase + j2, outBase + j);
      else {
        idx.push(0, midBase + j2, midBase + j);
        idx.push(midBase + j, midBase + j2, outBase + j2, midBase + j, outBase + j2, outBase + j);
      }
      idx.push(under, outBase + j, outBase + j2);
    }
    const g0 = new THREE.BufferGeometry();
    g0.setAttribute('position', new THREE.Float32BufferAttribute(verts.flat(), 3));
    g0.setIndex(idx);
    g0.computeVertexNormals();
    spherizeNormals(g0, ox, yb - h * 0.2, oz, 0.35);
    const g = strip(g0);
    const tint = 0.92 + rng() * 0.16;
    paint(g, (px, py, pz, c) => {
      const rf = Math.min(1, Math.hypot(px - ox, pz - oz) / Math.max(r, 1e-3));
      const underside = py < yb + h * 0.13 && rf < 0.92;
      const t = Math.min(1, 0.1 + rf * 0.55 + u * 0.35 + (py - yb) / h * 0.15);
      if (t < 0.5) c.copy(dark).lerp(mid, t * 2); else c.copy(mid).lerp(light, (t - 0.5) * 2);
      if (underside) c.copy(dark).multiplyScalar(0.7);
      c.multiplyScalar(tint);
    });
    parts.push(part(g, 1));
  }
  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  return geo;
}

export function makeBushGeometry(lod = 0) {
  const rng = makeRng(77);
  const parts = [];
  const dark = lin(0x233f17), light = lin(0x6e9a44);
  const lumps = [[0, 0.1, 0, 0.17, 1], [0.13, 0.07, 0.05, 0.12, 0], [-0.11, 0.07, -0.06, 0.12, 0], [0.02, 0.06, -0.14, 0.1, 0]];
  (lod ? [[0, 0.09, -0.02, 0.2, 0]] : lumps).forEach(([x, y, z, r, d], i) => {
    const s = new THREE.IcosahedronGeometry(r, d);
    jitter(s, 0.2, 77 + i);
    s.scale(1, 0.75, 1);
    s.translate(x, y, z);
    s.computeVertexNormals();
    spherizeNormals(s, x, y, z, 1);
    spherizeNormals(s, 0, -0.04, 0, 0.5);
    const g = strip(s);
    const tint = 0.92 + rng() * 0.16;
    paint(g, (px, py, pz, c) => c.copy(dark).lerp(light, Math.min(1, Math.max(0, (py + 0.02) / 0.26))).multiplyScalar(tint));
    parts.push(part(g, 1));
  });
  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  return geo;
}

// Short meadow tuft: a small clump of thin, tapering blades curving outward (heights in world units before scaling)
export function makeGrassTuftGeometry(seed = 5, blades = 7, spread = 0.05) {
  const rng = makeRng(seed);
  const pos = [], nor = [], col = [];
  const base = lin(0x34501f), tip = lin(0x9bbd57), dry = lin(0xbdb46a);
  for (let b = 0; b < blades; b++) {
    const a = rng() * Math.PI * 2;
    const r = 0.012 + Math.sqrt(rng()) * spread;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const h = (0.036 + rng() * 0.036) * (rng() < 0.08 ? 1.4 : 1);
    const w = 0.0045 + rng() * 0.0035;
    const la = a + (rng() - 0.5) * 1.2;
    const lean = h * (0.25 + rng() * 0.45);
    const ox = Math.cos(la) * lean, oz = Math.sin(la) * lean;
    const fa = a + Math.PI / 2 + (rng() - 0.5) * 0.8;
    const px = Math.cos(fa) * w, pz = Math.sin(fa) * w;
    const mid = [bx + ox * 0.3, h * 0.55, bz + oz * 0.3];
    const v = [
      [bx - px, 0, bz - pz], [bx + px, 0, bz + pz],
      [mid[0] - px * 0.6, mid[1], mid[2] - pz * 0.6], [mid[0] + px * 0.6, mid[1], mid[2] + pz * 0.6],
      [bx + ox, h, bz + oz],
    ];
    const tipCol = (rng() < 0.12 ? dry : tip).clone().multiplyScalar(0.85 + rng() * 0.25);
    for (const t of [[0, 1, 3], [0, 3, 2], [2, 3, 4]]) {
      for (const i of t) {
        pos.push(...v[i]);
        nor.push(ox * 1.5, 1, oz * 1.5);
        _c.copy(base).lerp(tipCol, Math.min(1, v[i][1] / h));
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

// Grass: thin blades glow a little against the sun, and big soft patches of drier / lusher colour break any repetition
export function grassPatch(shader) {
  translucency(shader, 0.28, 0.5);
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
{
  float _pa = texture2D( uNoise, vPWorld.xz * 0.021 ).r;
  float _pb = texture2D( uNoise, vPWorld.xz * 0.083 + 0.37 ).g;
  float _dry = smoothstep( 0.5, 0.78, _pa * 0.75 + _pb * 0.35 );
  diffuseColor.rgb *= mix( vec3( 0.92, 1.0, 0.9 ), vec3( 1.16, 1.06, 0.72 ), _dry ) * ( 0.9 + _pb * 0.2 );
}
`);
}

export function makeWheatGeometry(seed = 9) {
  const rng = makeRng(seed);
  const pos = [], nor = [], col = [];
  const stem = lin(0x9a8a3a), head = lin(0xe8c35a), base = lin(0x6d6a2a);
  const stalks = 7;
  for (let s = 0; s < stalks; s++) {
    const bx = (rng() - 0.5) * 0.16, bz = (rng() - 0.5) * 0.16;
    const h = 0.17 + rng() * 0.06;
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

// Soft dark disc for contact shadows under trees and bushes (multiplied onto the ground: 1 at the rim)
export function makeContactGeometry(center = 0.7) {
  const pos = [0, 0, 0], col = [center, center, center], idx = [];
  const seg = 12;
  for (const [r, v] of [[0.45, center + (1 - center) * 0.45], [1, 1]]) {
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      col.push(v, v, v);
    }
  }
  for (let j = 0; j < seg; j++) {
    const j2 = (j + 1) % seg;
    idx.push(0, 1 + j2, 1 + j, 1 + j, 1 + j2, 1 + seg + j2, 1 + j, 1 + seg + j2, 1 + seg + j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
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

// Instances split into square chunks, each frustum-culled on its own, with a level of detail per chunk chosen by its
// distance to the camera. levels: [{ geo, mat, maxDist, castShadow? }] near to far; a chunk beyond every maxDist is hidden.
// Call group.userData.update(cameraPosition) every frame (cheap: one distance per chunk); it returns true when a
// shadow-casting chunk changed level, i.e. when the shadow map must be redrawn to match what is shown.
export function chunkedInstances(items, levels, { size = 10, receiveShadow = true, pad = 0.6 } = {}) {
  const group = new THREE.Group();
  const cells = new Map();
  for (const it of items) {
    const k = `${Math.floor(it.x / size)},${Math.floor(it.z / size)}`;
    let list = cells.get(k);
    if (!list) cells.set(k, (list = []));
    list.push(it);
  }
  const casts = levels.some((lv) => lv.castShadow);
  const chunks = [];
  for (const list of cells.values()) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y = 0;
    for (const it of list) { x0 = Math.min(x0, it.x); x1 = Math.max(x1, it.x); z0 = Math.min(z0, it.z); z1 = Math.max(z1, it.z); y += it.y; }
    const meshes = levels.map((lv) => {
      const m = instanced(lv.geo, lv.mat, list, { castShadow: !!lv.castShadow, receiveShadow });
      m.computeBoundingSphere();
      m.boundingSphere.radius += pad;
      m.frustumCulled = true;
      m.visible = false;
      group.add(m);
      return m;
    });
    chunks.push({ x0, x1, z0, z1, y: y / list.length, meshes, lvl: -2 });
  }
  const levelAt = (d) => { for (let i = 0; i < levels.length; i++) if (d <= levels[i].maxDist) return i; return -1; };
  group.userData.update = (cam) => {
    let changed = false;
    for (const c of chunks) {
      const dx = Math.max(c.x0 - cam.x, 0, cam.x - c.x1), dz = Math.max(c.z0 - cam.z, 0, cam.z - c.z1);
      const d = Math.hypot(dx, cam.y - c.y, dz);
      let li = levelAt(d);
      // small hysteresis so a chunk on a boundary does not flicker between levels
      if (c.lvl >= -1 && li !== c.lvl && (levelAt(d - 1.5) === c.lvl || levelAt(d + 1.5) === c.lvl)) li = c.lvl;
      if (li === c.lvl) continue;
      c.meshes.forEach((m, i) => { m.visible = i === li; });
      c.lvl = li;
      changed = true;
    }
    return changed && casts;
  };
  return group;
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
