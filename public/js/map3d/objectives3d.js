import * as THREE from 'three';
import { patchLit } from './shaderPatches.js';

// Victory-point markers: a stone base, a tall pole and a pennant per objective; ring + pennant take the owner's colour
export function createObjectiveMarkers({ scene, hexToWorld, groundHeight, objectives = [] }) {
  const group = new THREE.Group();
  scene.add(group);
  const markers = new Map();
  const stoneMat = patchLit(new THREE.MeshStandardMaterial({ color: 0x8c8274, roughness: 0.95, flatShading: true }), {}, null, 'obj-stone');
  const poleMat = patchLit(new THREE.MeshStandardMaterial({ color: 0x3b2a1a, roughness: 0.8 }), {}, null, 'obj-pole');
  const neutral = new THREE.Color(0xd8c9a0);

  for (const o of objectives) {
    if (o == null || o.q == null || o.r == null) continue;
    const c = hexToWorld(o.q, o.r);
    const y = groundHeight(c.x, c.z);
    const m = new THREE.Group();
    m.position.set(c.x, y, c.z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.16, 8), stoneMat);
    base.position.y = 0.06;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.9, 6), poleMat);
    pole.position.y = 1.0;
    const flagMat = new THREE.MeshStandardMaterial({ color: neutral.clone(), roughness: 0.8, side: THREE.DoubleSide, emissive: 0x000000 });
    const flagGeo = new THREE.PlaneGeometry(0.62, 0.36, 8, 2).translate(0.31, 0, 0);
    const flag = new THREE.Mesh(flagGeo, flagMat);
    flag.position.y = 1.7;
    const ringMat = new THREE.MeshBasicMaterial({ color: neutral.clone(), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 6, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 6), ringMat);
    ring.position.y = 0.06;
    base.castShadow = pole.castShadow = true;
    m.add(base, pole, flag, ring);
    m.userData = { baseOpacity: 0.5, flag, flagGeo, base: flagGeo.attributes.position.array.slice(), ring, flagMat, ringMat, def: o };
    group.add(m);
    markers.set(o.id ?? `${o.q},${o.r}`, m);
  }

  function setOwners(owners = {}) {
    for (const [id, m] of markers) {
      const col = owners[id] ? new THREE.Color(owners[id]) : neutral;
      m.userData.flagMat.color.copy(col);
      m.userData.ringMat.color.copy(col);
      m.userData.baseOpacity = owners[id] ? 0.8 : 0.5;
    }
  }

  function update(dt, t) {
    for (const m of markers.values()) {
      const pos = m.userData.flagGeo.attributes.position;
      const b = m.userData.base;
      for (let i = 0; i < pos.count; i++) {
        const x = b[i * 3];
        pos.setZ(i, Math.sin(x * 9 - t * 6 + m.position.x) * 0.05 * (x / 0.62));
      }
      pos.needsUpdate = true;
      m.userData.ringMat.opacity = m.userData.baseOpacity * (0.85 + 0.15 * Math.sin(t * 2));
    }
  }

  return { group, setOwners, update, markers };
}
