import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, patchLit } from './shaderPatches.js';

// Decorative war banners (nobori): a tall vertical cloth hanging from a cross-bar, with a brush character.
// Deliberately unlike the objective markers (stone base + horizontal pennant, objectives3d.js).
// items: [{ x, y, z, label?, color?, zone? }]  zone = index of the map's fixed deployment zone the banner stands in:
// setZoneColors() repaints those banners in the colour and emblem of the army deployed there.
const KINGDOM_COLORS = { '秦': 0xa8352a, '趙': 0x2f5fa8, '魏': 0x6b3fa0, '韓': 0x3f7d4a, '燕': 0x2b7a78, '楚': 0xb06a1c, '齊': 0xc49a2c, '峠': 0x8a6a3a };
const DEFAULT_COLOR = 0xa8352a;
const CLOTH_W = 0.24, CLOTH_H = 0.92, POLE_H = 1.72;
const CELL_W = 64, CELL_H = 256, SLOTS = 16;
const GLYPH_FONT = '"Yuji Boku","Hiragino Mincho ProN","Songti SC","Noto Serif CJK SC","Noto Serif CJK JP",serif';

export function bannerColorFor(label) {
  return KINGDOM_COLORS[label] ?? DEFAULT_COLOR;
}

export function createBanners({ parent, items }) {
  const list = items.map((it) => ({ ...it, baseColor: new THREE.Color(it.color ?? bannerColorFor(it.label)), baseLabel: it.label || '' }));
  const group = new THREE.Group();
  parent.add(group);
  if (!list.length) return { group, setZoneColors() {} };

  // glyph atlas: one column per character, white strokes on transparent
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * SLOTS;
  canvas.height = CELL_H;
  const ctx = canvas.getContext('2d');
  const atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = 4;
  const slots = new Map();
  function glyphIndex(label) {
    if (!label) return -1;
    if (slots.has(label)) return slots.get(label);
    if (slots.size >= SLOTS) return -1;
    const i = slots.size;
    slots.set(label, i);
    const chars = [...label].slice(0, 3);
    ctx.save();
    ctx.translate(i * CELL_W, 0);
    ctx.clearRect(0, 0, CELL_W, CELL_H);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = chars.length === 1 ? 52 : 44;
    ctx.font = `700 ${size}px ${GLYPH_FONT}`;
    chars.forEach((ch, k) => ctx.fillText(ch, CELL_W / 2, 62 + k * (size + 6)));
    ctx.restore();
    atlas.needsUpdate = true;
    return i;
  }

  // pole + cross-bar + finial
  const pole = new THREE.CylinderGeometry(0.016, 0.022, POLE_H, 6).translate(0, POLE_H / 2, 0);
  const bar = new THREE.BoxGeometry(CLOTH_W + 0.06, 0.022, 0.022).translate((CLOTH_W + 0.06) / 2, POLE_H - 0.07, 0);
  const tip = new THREE.ConeGeometry(0.03, 0.09, 6).translate(0, POLE_H + 0.045, 0);
  for (const g of [pole, bar, tip]) { g.deleteAttribute('uv'); }
  const paint = (g, hex) => {
    const c = new THREE.Color(hex);
    const a = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const poleGeo = mergeGeometries([paint(pole, 0x3b2a1a), paint(bar, 0x3b2a1a), paint(tip, 0xc9a24a)]);
  const poleMat = patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 }), {}, null, 'nobori-pole');
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, list.length);
  const clothGeo = new THREE.PlaneGeometry(CLOTH_W, CLOTH_H, 2, 10).translate(0.03 + CLOTH_W / 2, -CLOTH_H / 2, 0);
  const glyphAttr = new THREE.InstancedBufferAttribute(new Float32Array(list.length), 1);
  clothGeo.setAttribute('aGlyph', glyphAttr);
  const uniforms = { uAtlas: { value: atlas } };
  const clothMat = patchLit(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide }), {}, (shader) => {
    shader.uniforms.uAtlas = uniforms.uAtlas;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGlyph;\nvarying float vGlyph;\nvarying vec2 vBUv;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGlyph = aGlyph;
        vBUv = uv;
        {
          float ph = instanceMatrix[ 3 ].x * 1.3 + instanceMatrix[ 3 ].z * 0.7;
          float down = clamp( -position.y / ${CLOTH_H.toFixed(3)}, 0.0, 1.0 );
          float outw = clamp( ( position.x - 0.03 ) / ${CLOTH_W.toFixed(3)}, 0.0, 1.0 );
          float sway = sin( uTime * 1.6 + ph + position.y * 2.5 ) * 0.045 + sin( uTime * 3.1 + ph * 1.7 + position.y * 5.0 ) * 0.015;
          transformed.z += sway * ( 0.25 + 0.75 * down ) * ( 0.3 + 0.7 * outw ) * ( 0.6 + 0.4 * uWindStrength );
          transformed.x += sin( uTime * 1.2 + ph ) * 0.012 * down;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uAtlas;\nvarying float vGlyph;\nvarying vec2 vBUv;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float hem = max( step( vBUv.y, 0.05 ), max( step( 0.95, vBUv.y ), step( 0.9, vBUv.x ) ) );
          diffuseColor.rgb *= 1.0 - 0.55 * hem;
          if ( vGlyph >= 0.0 ) {
            vec2 cuv = vec2( ( clamp( vBUv.x, 0.02, 0.98 ) + vGlyph ) / ${SLOTS.toFixed(1)}, vBUv.y );
            float ga = texture2D( uAtlas, cuv ).a;
            diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.95, 0.92, 0.82 ), ga * 0.95 );
          }
        }`);
  }, 'nobori-cloth');
  const cloths = new THREE.InstancedMesh(clothGeo, clothMat, list.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), e = new THREE.Euler();
  // cloths face across the wind so they read as vertical banners from most camera angles
  const wd = G.uWindDir.value;
  const baseRy = Math.atan2(-wd.y, wd.x);
  list.forEach((it, i) => {
    e.set(0, (it.ry ?? baseRy) + ((i * 0.37) % 0.5) - 0.25, 0);
    q.setFromEuler(e);
    p.set(it.x, it.y, it.z);
    m.compose(p, q, s);
    poles.setMatrixAt(i, m);
    p.set(it.x, it.y + POLE_H - 0.06, it.z);
    m.compose(p, q, s);
    cloths.setMatrixAt(i, m);
  });
  function paintAll(owners) {
    list.forEach((it, i) => {
      const own = it.zone != null ? owners.get(it.zone) : null;
      const col = own ? new THREE.Color(own.color) : it.baseColor;
      cloths.setColorAt(i, col);
      glyphAttr.setX(i, glyphIndex(own ? (own.emblem || '') : it.baseLabel));
    });
    if (cloths.instanceColor) cloths.instanceColor.needsUpdate = true;
    glyphAttr.needsUpdate = true;
  }
  paintAll(new Map());
  for (const mesh of [poles, cloths]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
  }
  poles.castShadow = true;
  group.add(poles, cloths);

  let lastSig = '';
  // owners: [{ zone, color, emblem }]
  function setZoneColors(owners = []) {
    const sig = JSON.stringify(owners);
    if (sig === lastSig) return;
    lastSig = sig;
    paintAll(new Map(owners.filter((o) => o && o.zone != null).map((o) => [o.zone, o])));
  }
  return { group, setZoneColors, count: list.length };
}
