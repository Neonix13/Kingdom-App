import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchLit } from './shaderPatches.js';

// Fallen soldiers, horses, chariot wrecks, dropped weapons and banners lying on the terrain (records from public/js/corpses.js).
// One InstancedMesh per kind, rebuilt from the deterministic records when the list changes.
const S = 0.3;

function part(geo, m, color) {
  for (const n of Object.keys(geo.attributes)) if (n !== 'position') geo.deleteAttribute(n);
  geo.applyMatrix4(m);
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
const M = (x, y, z, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
const merged = (parts, k = S) => { const g = mergeGeometries(parts); g.scale(k, k, k); g.computeVertexNormals(); g.computeBoundingSphere(); return g; };

// Built in "man units" (a standing soldier is 1 tall) then scaled like the 3D soldiers.
// Lying soldier, head toward +X; the white torso takes the instance (army) colour.
function bodyGeo() {
  return merged([
    part(new THREE.BoxGeometry(0.42, 0.11, 0.24), M(0.02, 0.055, 0), 0xffffff),
    part(new THREE.BoxGeometry(0.44, 0.1, 0.1), M(-0.4, 0.05, 0.06, 0, 0.12, 0), 0x3a332c),
    part(new THREE.BoxGeometry(0.42, 0.1, 0.1), M(-0.38, 0.05, -0.08, 0, -0.18, 0), 0x3a332c),
    part(new THREE.SphereGeometry(0.1, 6, 4), M(0.33, 0.08, 0.02), 0xd6a47a),
    part(new THREE.ConeGeometry(0.12, 0.16, 6), M(0.44, 0.09, 0.02, 0, 0, -Math.PI / 2), 0x56534f),
    part(new THREE.BoxGeometry(0.34, 0.06, 0.08), M(0.08, 0.06, 0.22, 0, 0.9, 0), 0x3f342b),
  ]);
}
function horseGeo() {
  return merged([
    part(new THREE.BoxGeometry(0.9, 0.32, 0.36), M(0, 0.17, 0), 0xffffff),
    part(new THREE.BoxGeometry(0.42, 0.18, 0.18), M(0.58, 0.1, 0.12, 0, -0.5, 0), 0xffffff),
    part(new THREE.BoxGeometry(0.1, 0.08, 0.5), M(0.28, 0.05, 0.38, 0, 0.3, 0), 0x2a2018),
    part(new THREE.BoxGeometry(0.1, 0.08, 0.5), M(-0.32, 0.05, 0.4, 0, -0.2, 0), 0x2a2018),
    part(new THREE.BoxGeometry(0.34, 0.06, 0.3), M(0.05, 0.34, -0.02), 0x5a3b22),
  ], S * 1.15);
}
function wreckGeo() {
  return merged([
    part(new THREE.BoxGeometry(0.8, 0.22, 0.6), M(0, 0.18, 0, 0.35, 0, 0.25), 0x6e4c2c),
    part(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 10), M(0.1, 0.05, 0.55), 0x4a3320),
    part(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 10), M(-0.55, 0.32, -0.2, 0.2, 0, 1.2), 0x4a3320),
    part(new THREE.BoxGeometry(1.3, 0.05, 0.05), M(0.9, 0.04, -0.1, 0, 0.4, 0), 0x6e4c2c),
  ]);
}
function weaponGeo() {
  return merged([
    part(new THREE.BoxGeometry(1.5, 0.035, 0.035), M(0, 0.02, 0), 0x6e4c2c),
    part(new THREE.ConeGeometry(0.05, 0.18, 4), M(0.82, 0.02, 0, 0, 0, -Math.PI / 2), 0xcfcfca),
  ]);
}
function bannerGeo() {
  const cloth = new THREE.PlaneGeometry(0.75, 1.05, 3, 3);
  const p = cloth.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 6) * 0.04 + Math.cos(p.getY(i) * 5) * 0.03);
  return merged([
    part(new THREE.BoxGeometry(2.4, 0.05, 0.05), M(0, 0.03, 0, 0, 0, 0.04), 0x3c2a1a),
    part(cloth, M(0.75, 0.05, 0.5, -Math.PI / 2, 0, 0.08), 0xffffff),
  ]);
}

const CAP = { body: 3000, horse: 700, wreck: 120, weapon: 1600, banner: 420 };

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function createCorpseLayer(world) {
  const { scene, hexToWorld } = world;
  const height = world.walkHeight || world.groundHeight;
  const mat = patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true, envMapIntensity: 0.4, side: THREE.DoubleSide }), {}, null, 'corpses3d');
  const meshes = {};
  const GEOS = { body: bodyGeo(), horse: horseGeo(), wreck: wreckGeo(), weapon: weaponGeo(), banner: bannerGeo() };
  for (const [k, g] of Object.entries(GEOS)) {
    const m = new THREE.InstancedMesh(g, mat, CAP[k]);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = true;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP[k] * 3), 3);
    scene.add(m);
    meshes[k] = m;
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
  const _c = new THREE.Color(), _dark = new THREE.Color(0x2a241f);
  const HORSE_COATS = [0x4a3324, 0x6b4a2e, 0x2a221c, 0x7a6a58, 0x8b5a2b];

  function put(kind, x, z, yaw, tilt, color) {
    const m = meshes[kind];
    if (m.count >= CAP[kind]) return;
    _p.set(x, height(x, z) + 0.004, z);
    _e.set(tilt, yaw, tilt * 0.6);
    _q.setFromEuler(_e);
    _m.compose(_p, _q, _s);
    m.setMatrixAt(m.count, _m);
    m.setColorAt(m.count, color);
    m.count++;
  }

  function set(list) {
    for (const m of Object.values(meshes)) m.count = 0;
    for (const c of list || []) {
      const rnd = rng(c.seed || 1);
      const ctr = hexToWorld(c.q, c.r);
      const spot = (rad = 0.72) => { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * rad; return [ctr.x + Math.cos(a) * d, ctr.z + Math.sin(a) * d]; };
      const army = _c.set(c.color || '#888888').clone().lerp(_dark, 0.35);
      const n = Math.max(0, c.n | 0);
      if (c.kind === 'chariot') {
        const [x, z] = spot(0.35);
        put('wreck', x, z, rnd() * 6.28, 0, _c.setRGB(1, 1, 1));
      }
      if (c.kind === 'horse' || c.kind === 'chariot' || c.kind === 'general') {
        const horses = c.kind === 'chariot' ? 2 : c.kind === 'general' ? 1 : n;
        for (let i = 0; i < horses; i++) {
          const [x, z] = spot();
          put('horse', x, z, rnd() * 6.28, (rnd() - 0.5) * 0.12, _c.set(HORSE_COATS[Math.floor(rnd() * HORSE_COATS.length)]));
        }
      }
      for (let i = 0; i < n; i++) {
        const [x, z] = spot();
        put('body', x, z, rnd() * 6.28, (rnd() - 0.5) * 0.1, army);
        if (rnd() < 0.5) { const [wx, wz] = spot(); put('weapon', wx, wz, rnd() * 6.28, 0, _c.setRGB(1, 1, 1)); }
      }
      if (c.banner) {
        const [x, z] = spot(0.4);
        put('banner', x, z, rnd() * 6.28, 0, _c.set(c.color || '#888888'));
      }
    }
    for (const m of Object.values(meshes)) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  return { set };
}
