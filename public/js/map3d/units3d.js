import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchLit, G } from './shaderPatches.js';

// Army layer: every unit is a small formation of instanced miniatures.
//
// const layer = createUnitLayer(world, { getPlayerColor, getPlayerEmblem?, autoUpdate = true })
//   layer.sync(units)                         full unit list (q/r null = not drawn)
//   layer.setDisplayPosition(id, x, z, heading|null)   world coords; heading in radians, 0 = +Z,
//                                             atan2(dx, dz); null heading = derived from motion; x null = clear
//   layer.clearDisplayPosition(id)
//   layer.setMoving(id, bool)
//   layer.playAttack(attId, tgtId, { ranged }) -> seconds until impact
//   layer.playHit(id, { delay = 0 })
//   layer.setSelected(id|null) / layer.setHovered(id|null)
//   layer.getAnchor(id, out?) -> THREE.Vector3 | null
//   layer.update(dt, t)                       auto-registered in world.frameHooks unless autoUpdate:false
//   layer.dispose()
// Draw calls: foot (regular + irregular kits), rider, horse, chariot, banner cloth, contact blobs
// (+ arrows during volleys, + selection/hover rings).

const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const TAU = Math.PI * 2;
const S = 0.3;
const RIDER_Y = 0.262;

const FK = { helmet: 1, bun: 2, hood: 3, straw: 4, lamellar: 5, round: 6, tower: 7, spear: 8, ji: 9, sword: 10, crossbow: 11, quiver: 12, fork: 13, hammer: 14, shovel: 15, pole: 16, daggers: 17, planks: 18, cloak: 19 };
const RK = { helmet: 1, plume: 2, lamellar: 3, ji: 4, bow: 5, quiver: 6, cape: 7, pole: 8, guandao: 9, sword: 10, round: 11, bun: 12 };
const HK = { barding: 1, chanfron: 2, cloth: 3 };
const CK = { war: 1, cart: 2, pole: 3, crew: 4 };
const bits = (...s) => s.reduce((a, b) => a | (1 << (b - 1)), 0);

const COATS = [0x6b4226, 0x8b5a2b, 0x2b2420, 0x8e8a84, 0xd8d0c2, 0x4a2f1e, 0xa07850];
const DEFAULT_EMBLEMS = ['秦', '趙', '魏', '楚', '燕', '斉', '韓', '王'];

// --- Geometry building ---
const _c = new THREE.Color();
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 6, open = true) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
const disc = (r, h, s) => new THREE.CylinderGeometry(r, r, h, s, 1, false);
const cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s, 1, true);
const ball = (r, w = 6, h = 4) => new THREE.SphereGeometry(r, w, h);

function xf(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
}
function about(px, py, pz, rx, m) {
  return new THREE.Matrix4().makeTranslation(px, py, pz).multiply(new THREE.Matrix4().makeRotationX(rx))
    .multiply(new THREE.Matrix4().makeTranslation(-px, -py, -pz)).multiply(m);
}

class RigBuilder {
  constructor(k = 1) { this.k = k; this.geos = []; }
  add(geo, m, col, part = 0, slot = 0, tint = 0) {
    for (const n of Object.keys(geo.attributes)) if (n !== 'position') geo.deleteAttribute(n);
    geo.applyMatrix4(m);
    if (this.k !== 1) geo.scale(this.k, this.k, this.k);
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3), info = new Float32Array(n * 3);
    if (tint) _c.setRGB(col, col, col); else _c.set(col);
    for (let i = 0; i < n; i++) {
      c[i * 3] = _c.r; c[i * 3 + 1] = _c.g; c[i * 3 + 2] = _c.b;
      info[i * 3] = part; info[i * 3 + 1] = slot; info[i * 3 + 2] = tint;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    geo.setAttribute('aInfo', new THREE.BufferAttribute(info, 3));
    this.geos.push(geo);
    return this;
  }
  build() {
    const g = mergeGeometries(this.geos);
    g.computeBoundingSphere();
    return g;
  }
}

const COL = {
  skin: 0xd6a47a, pants: 0x3a332c, belt: 0x2b1e14, armor: 0x3f342b,
  metal: 0x56534f, bronze: 0xa8843f, gold: 0xd9a93a, wood: 0x6e4c2c, woodLight: 0xa07a4a, hair: 0x1b1410,
  steel: 0xcfcfca, dark: 0x2a2a31, straw: 0xc8a85e, leather: 0x5a3b22, cream: 0xe6dcc4, wheel: 0x4a3320,
};

// Foot soldier, built in "man units" (height 1) and scaled by S. Forward = +Z, right hand = -X.
const F_PIV = {
  hip: [0, 0.46, 0], shR: [-0.185, 0.74, 0], shL: [0.185, 0.74, 0], hand: [-0.185, 0.42, 0.02],
  anchor: [-0.235, 2.04, 0.03],
};
function buildFoot() {
  const b = new RigBuilder(S);
  for (const [sx, part] of [[1, 1], [-1, 2]]) {
    b.add(box(0.11, 0.46, 0.13), xf(0.075 * sx, 0.23, 0.005), COL.pants, part);
  }
  b.add(cyl(0.15, 0.19, 0.2, 6), xf(0, 0.42, 0), 0.72, 0, 0, 1);
  b.add(box(0.28, 0.3, 0.17), xf(0, 0.63, 0), 1.0, 0, 0, 1);
  b.add(box(0.29, 0.045, 0.18), xf(0, 0.5, 0), COL.belt);
  b.add(ball(0.095, 6, 4), xf(0, 0.88, 0), COL.skin);
  // armour
  b.add(box(0.31, 0.25, 0.2), xf(0, 0.65, 0), COL.armor, 0, FK.lamellar);
  b.add(box(0.12, 0.07, 0.17), xf(0.17, 0.77, 0, 0, 0, -0.35), COL.armor, 0, FK.lamellar);
  b.add(box(0.12, 0.07, 0.17), xf(-0.17, 0.77, 0, 0, 0, 0.35), COL.armor, 0, FK.lamellar);
  b.add(cyl(0.17, 0.21, 0.12, 6), xf(0, 0.46, 0), COL.armor, 0, FK.lamellar);
  // headgear
  b.add(cone(0.115, 0.15, 7), xf(0, 1.0, 0), COL.metal, 0, FK.helmet);
  b.add(cone(0.135, 0.04, 7), xf(0, 0.94, 0), COL.metal, 0, FK.helmet);
  b.add(cone(0.032, 0.07, 4), xf(0, 1.1, 0), 1.0, 0, FK.helmet, 1);
  b.add(ball(0.1, 6, 4), xf(0, 0.905, -0.012, 0, 0, 0, 1, 0.75, 1), COL.hair, 0, FK.bun);
  b.add(ball(0.046, 5, 3), xf(0, 0.99, -0.035), COL.hair, 0, FK.bun);
  b.add(ball(0.114, 6, 5), xf(0, 0.9, -0.024, 0, 0, 0, 1, 1.12, 1.05), COL.dark, 0, FK.hood);
  b.add(cone(0.25, 0.1, 8), xf(0, 0.995, 0), COL.straw, 0, FK.straw);
  b.add(cyl(0.185, 0.235, 0.5, 6), xf(0, 0.56, 0), COL.dark, 0, FK.cloak);
  b.add(cyl(0.19, 0.195, 0.05, 6), xf(0, 0.53, 0), 0.9, 0, FK.cloak, 1);
  // arms
  for (const [sx, part] of [[-1, 3], [1, 5]]) {
    b.add(box(0.085, 0.2, 0.095), xf(0.185 * sx, 0.66, 0), 0.85, part, 0, 1);
    b.add(box(0.072, 0.13, 0.082), xf(0.185 * sx, 0.5, 0), COL.skin, part);
  }
  const [hx, hy, hz] = F_PIV.hand;
  // right-hand weapons (part 4)
  b.add(cyl(0.012, 0.014, 1.35, 4), xf(hx, 0.6, hz + 0.02), COL.wood, 4, FK.spear);
  b.add(cone(0.03, 0.13, 4), xf(hx, 1.34, hz + 0.02), COL.steel, 4, FK.spear);
  b.add(cyl(0.012, 0.014, 1.8, 4), xf(hx, 0.82, hz + 0.02), COL.wood, 4, FK.ji);
  b.add(cone(0.028, 0.15, 4), xf(hx, 1.79, hz + 0.02), COL.steel, 4, FK.ji);
  b.add(box(0.014, 0.045, 0.17), xf(hx, 1.6, hz + 0.1), COL.steel, 4, FK.ji);
  b.add(box(0.035, 0.44, 0.012), xf(hx, hy + 0.23, hz + 0.11, 0.45), COL.steel, 4, FK.sword);
  b.add(box(0.09, 0.025, 0.035), xf(hx, hy + 0.03, hz + 0.02, 0.45), COL.bronze, 4, FK.sword);
  b.add(box(0.045, 0.045, 0.36), xf(-0.1, 0.5, 0.2), COL.wood, 4, FK.crossbow);
  b.add(box(0.44, 0.03, 0.035), xf(-0.1, 0.505, 0.35), COL.leather, 4, FK.crossbow);
  b.add(cyl(0.012, 0.014, 1.25, 4), xf(hx, 0.58, hz + 0.02), COL.woodLight, 4, FK.fork);
  b.add(box(0.13, 0.025, 0.025), xf(hx, 1.2, hz + 0.02), COL.metal, 4, FK.fork);
  b.add(box(0.016, 0.15, 0.016), xf(hx - 0.055, 1.28, hz + 0.02), COL.metal, 4, FK.fork);
  b.add(box(0.016, 0.15, 0.016), xf(hx + 0.055, 1.28, hz + 0.02), COL.metal, 4, FK.fork);
  b.add(cyl(0.014, 0.014, 0.5, 4), xf(hx, hy + 0.15, hz + 0.02), COL.woodLight, 4, FK.hammer);
  b.add(box(0.16, 0.08, 0.09), xf(hx, hy + 0.4, hz + 0.02), COL.metal, 4, FK.hammer);
  b.add(cyl(0.012, 0.012, 1.0, 4), xf(hx, 0.66, hz + 0.02), COL.woodLight, 4, FK.shovel);
  b.add(box(0.13, 0.17, 0.02), xf(hx, 0.08, hz + 0.02), COL.metal, 4, FK.shovel);
  b.add(box(0.026, 0.22, 0.012), xf(hx, hy + 0.02, hz + 0.1, 1.3), COL.steel, 4, FK.daggers);
  b.add(box(0.026, 0.22, 0.012), xf(-hx, hy + 0.02, hz + 0.1, 1.3), COL.steel, 5, FK.daggers);
  // left arm: shields
  b.add(cyl(0.21, 0.21, 0.035, 8), xf(0.205, 0.55, 0.115, Math.PI / 2), COL.wood, 5, FK.round);
  b.add(new THREE.CircleGeometry(0.2, 8), xf(0.205, 0.55, 0.133), 0.95, 5, FK.round, 1);
  b.add(cone(0.045, 0.04, 4), xf(0.205, 0.55, 0.15, Math.PI / 2), COL.bronze, 5, FK.round);
  b.add(box(0.42, 0.82, 0.03), xf(0.15, 0.47, 0.15), COL.wood, 5, FK.tower);
  b.add(box(0.35, 0.72, 0.02), xf(0.15, 0.47, 0.168), 0.95, 5, FK.tower, 1);
  // back / body gear
  b.add(cyl(0.045, 0.04, 0.34, 5), xf(0.08, 0.66, -0.125, 0, 0, -0.35), COL.leather, 0, FK.quiver);
  b.add(box(0.07, 0.07, 0.045), xf(0.14, 0.83, -0.125, 0, 0, -0.35), COL.cream, 0, FK.quiver);
  b.add(box(0.13, 0.05, 0.72), xf(-0.15, 0.82, 0.04), COL.woodLight, 0, FK.planks);
  b.add(cyl(0.018, 0.022, 2.1, 5), xf(F_PIV.anchor[0], 1.0, F_PIV.anchor[2]), COL.wood, 0, FK.pole);
  b.add(cone(0.035, 0.1, 5), xf(F_PIV.anchor[0], 2.1, F_PIV.anchor[2]), COL.gold, 0, FK.pole);
  return b.build();
}

const IRREG = bits(FK.bun, FK.hood, FK.straw, FK.cloak, FK.fork, FK.hammer, FK.shovel, FK.planks, FK.daggers);
const FOOT_A = new Set([0, FK.helmet, FK.lamellar, FK.round, FK.tower, FK.spear, FK.ji, FK.sword, FK.crossbow, FK.quiver, FK.pole]);
const FOOT_B = new Set([0, FK.helmet, FK.bun, FK.hood, FK.straw, FK.cloak, FK.fork, FK.hammer, FK.shovel, FK.planks, FK.daggers, FK.crossbow, FK.quiver, FK.pole, FK.sword]);
function subset(geo, slots) {
  const info = geo.attributes.aInfo, idx = geo.index.array, out = [];
  for (let i = 0; i < idx.length; i += 3) if (slots.has(info.getY(idx[i]))) out.push(idx[i], idx[i + 1], idx[i + 2]);
  const g = new THREE.BufferGeometry();
  for (const n of ['position', 'color', 'aInfo']) g.setAttribute(n, geo.attributes[n]);
  g.setIndex(out);
  g.computeBoundingSphere();
  return g;
}

// Horse, world units. Origin on the ground under the body centre.
const H_PIV = { front: [0, 0.15, 0.1], back: [0, 0.15, -0.1], neck: [0, 0.2, 0.1], tail: [0, 0.2, -0.15] };
function buildHorse() {
  const b = new RigBuilder(1);
  b.add(ball(1, 7, 5), xf(0, 0.18, 0, 0, 0, 0, 0.068, 0.072, 0.155), 1.0, 0, 0, 2);
  b.add(ball(1, 6, 4), xf(0, 0.185, 0.085, 0, 0, 0, 0.062, 0.066, 0.075), 0.95, 0, 0, 2);
  b.add(box(0.045, 0.13, 0.06), xf(0, 0.245, 0.135, 0.55), 0.92, 5, 0, 2);
  b.add(box(0.042, 0.048, 0.105), xf(0, 0.29, 0.195, 0.55), 0.85, 5, 0, 2);
  b.add(box(0.016, 0.135, 0.03), xf(0, 0.265, 0.115, 0.55), COL.hair, 5);
  b.add(cone(0.01, 0.03, 4), xf(0.013, 0.33, 0.17), 0.8, 5, 0, 2);
  b.add(cone(0.01, 0.03, 4), xf(-0.013, 0.33, 0.17), 0.8, 5, 0, 2);
  const legs = [[0.035, 0.1, 1], [-0.035, 0.1, 2], [0.035, -0.1, 3], [-0.035, -0.1, 4]];
  for (const [x, z, part] of legs) {
    b.add(box(0.026, 0.15, 0.03), xf(x, 0.085, z), 0.78, part, 0, 2);
    b.add(box(0.03, 0.026, 0.036), xf(x, 0.013, z + 0.003), 0x1c1612, part);
  }
  b.add(box(0.022, 0.13, 0.026), xf(0, 0.14, -0.17, -0.35), COL.hair, 6);
  b.add(box(0.085, 0.022, 0.095), xf(0, 0.252, -0.01), COL.leather);
  b.add(box(0.15, 0.085, 0.105), xf(0, 0.22, -0.01), 0.9, 0, HK.cloth, 1);
  b.add(ball(1, 7, 5), xf(0, 0.182, -0.005, 0, 0, 0, 0.076, 0.072, 0.162), 0.8, 0, HK.barding, 1);
  b.add(box(0.135, 0.085, 0.07), xf(0, 0.19, 0.125), COL.armor, 0, HK.barding);
  b.add(box(0.05, 0.055, 0.075), xf(0, 0.295, 0.2, 0.55), COL.metal, 5, HK.chanfron);
  return b.build();
}

// Rider, man units scaled by S. Origin at the saddle.
const R_PIV = { shR: [-0.185, 0.31, 0], shL: [0.185, 0.31, 0], cape: [0, 0.33, -0.1], armA: -0.7 };
function buildRider() {
  const b = new RigBuilder(S);
  for (const sx of [1, -1]) {
    b.add(box(0.11, 0.11, 0.27), xf(0.2 * sx, -0.03, 0.08), COL.pants);
    b.add(box(0.095, 0.3, 0.11), xf(0.245 * sx, -0.2, 0.18), COL.pants);
  }
  b.add(cyl(0.16, 0.25, 0.14, 6), xf(0, 0.03, 0), 0.72, 0, 0, 1);
  b.add(box(0.28, 0.3, 0.17), xf(0, 0.2, 0), 1.0, 0, 0, 1);
  b.add(box(0.29, 0.045, 0.18), xf(0, 0.07, 0), COL.belt);
  b.add(ball(0.095, 6, 4), xf(0, 0.45, 0), COL.skin);
  b.add(box(0.31, 0.25, 0.2), xf(0, 0.22, 0), COL.armor, 0, RK.lamellar);
  b.add(box(0.12, 0.07, 0.17), xf(0.17, 0.34, 0, 0, 0, -0.35), COL.armor, 0, RK.lamellar);
  b.add(box(0.12, 0.07, 0.17), xf(-0.17, 0.34, 0, 0, 0, 0.35), COL.armor, 0, RK.lamellar);
  b.add(cone(0.115, 0.15, 7), xf(0, 0.57, 0), COL.metal, 0, RK.helmet);
  b.add(cone(0.135, 0.04, 7), xf(0, 0.51, 0), COL.metal, 0, RK.helmet);
  b.add(cone(0.032, 0.07, 4), xf(0, 0.67, 0), 1.0, 0, RK.helmet, 1);
  b.add(cone(0.12, 0.17, 7), xf(0, 0.58, 0), COL.gold, 0, RK.plume);
  b.add(cone(0.145, 0.045, 7), xf(0, 0.51, 0), COL.gold, 0, RK.plume);
  b.add(box(0.05, 0.3, 0.05), xf(0, 0.8, -0.03, -0.25), 1.0, 0, RK.plume, 1);
  b.add(box(0.2, 0.03, 0.03), xf(0, 0.6, 0.06), COL.gold, 0, RK.plume);
  b.add(ball(0.1, 6, 4), xf(0, 0.475, -0.012, 0, 0, 0, 1, 0.75, 1), COL.hair, 0, RK.bun);
  b.add(ball(0.046, 5, 3), xf(0, 0.555, -0.035), COL.hair, 0, RK.bun);
  b.add(box(0.32, 0.5, 0.025), xf(0, 0.09, -0.13, 0.12), 0.68, 7, RK.cape, 1);
  const [spx, spy, spz] = R_PIV.shR;
  const armM = (sx, m) => about(spx * -sx, spy, spz, R_PIV.armA, m);
  for (const [sx, part] of [[-1, 3], [1, 5]]) {
    b.add(box(0.085, 0.2, 0.095), armM(-sx, xf(0.185 * sx, 0.22, 0)), 0.85, part, 0, 1);
    b.add(box(0.072, 0.13, 0.082), armM(-sx, xf(0.185 * sx, 0.06, 0)), COL.skin, part);
  }
  const hand = new THREE.Vector3(-0.185, -0.01, 0.015).applyMatrix4(about(spx, spy, spz, R_PIV.armA, new THREE.Matrix4()));
  R_PIV.hand = [hand.x, hand.y, hand.z];
  const [hx, hy, hz] = R_PIV.hand;
  b.add(cyl(0.013, 0.015, 2.0, 4), xf(hx, hy + 0.45, hz), COL.wood, 4, RK.ji);
  b.add(cone(0.03, 0.16, 4), xf(hx, hy + 1.53, hz), COL.steel, 4, RK.ji);
  b.add(box(0.014, 0.045, 0.17), xf(hx, hy + 1.33, hz + 0.08), COL.steel, 4, RK.ji);
  b.add(cyl(0.015, 0.017, 1.9, 4), xf(hx, hy + 0.4, hz), COL.armor, 4, RK.guandao);
  b.add(box(0.02, 0.4, 0.11), xf(hx, hy + 1.5, hz + 0.04, 0.08), COL.steel, 4, RK.guandao);
  b.add(cyl(0.035, 0.035, 0.04, 6), xf(hx, hy + 1.31, hz), COL.gold, 4, RK.guandao);
  b.add(box(0.035, 0.44, 0.012), xf(hx, hy + 0.23, hz + 0.11, 0.45), COL.steel, 4, RK.sword);
  b.add(box(0.09, 0.025, 0.035), xf(hx, hy + 0.03, hz + 0.02, 0.45), COL.bronze, 4, RK.sword);
  b.add(new THREE.TorusGeometry(0.34, 0.014, 3, 10, Math.PI), xf(-hx, hy, hz + 0.02, 0, -Math.PI / 2, -Math.PI / 2), COL.leather, 5, RK.bow);
  b.add(cyl(0.21, 0.21, 0.035, 8), xf(0.27, 0.12, 0.08, 0, 0, Math.PI / 2), COL.wood, 5, RK.round);
  b.add(new THREE.CircleGeometry(0.2, 8), xf(0.29, 0.12, 0.08, 0, Math.PI / 2, 0), 0.95, 5, RK.round, 1);
  b.add(cyl(0.045, 0.04, 0.34, 5), xf(0.08, 0.24, -0.13, 0, 0, -0.35), COL.leather, 0, RK.quiver);
  b.add(box(0.07, 0.07, 0.045), xf(0.14, 0.41, -0.13, 0, 0, -0.35), COL.cream, 0, RK.quiver);
  R_PIV.anchor = [-0.25, 1.98, 0.08];
  b.add(cyl(0.018, 0.022, 2.4, 5), xf(-0.25, 0.8, 0.08), COL.wood, 0, RK.pole);
  b.add(cone(0.035, 0.1, 5), xf(-0.25, 2.05, 0.08), COL.gold, 0, RK.pole);
  return b.build();
}

// Chariot / cart, world units. Origin on the ground under the car.
const C_PIV = { axle: [0, 0.085, 0], crew: [0, 0.1, 0], anchor: [-0.072, 0.74, -0.05] };
function addMiniMan(b, ox, oz, k, slot, weapon) {
  const o = new THREE.Matrix4().makeTranslation(ox, 0.105, oz).multiply(new THREE.Matrix4().makeScale(k, k, k));
  const at = (m) => o.clone().multiply(m);
  b.add(box(0.24, 0.45, 0.13), at(xf(0, 0.25, 0)), COL.pants, 8, slot);
  b.add(box(0.28, 0.32, 0.17), at(xf(0, 0.63, 0)), 1.0, 8, slot, 1);
  b.add(box(0.36, 0.08, 0.1), at(xf(0, 0.72, 0.06)), 0.85, 8, slot, 1);
  b.add(ball(0.095, 5, 4), at(xf(0, 0.88, 0)), COL.skin, 8, slot);
  b.add(cone(0.115, 0.15, 6), at(xf(0, 1.0, 0)), COL.metal, 8, slot);
  if (weapon === 'ji') {
    b.add(cyl(0.014, 0.014, 1.9, 4), at(xf(-0.19, 0.85, 0.06)), COL.wood, 8, slot);
    b.add(cone(0.03, 0.15, 4), at(xf(-0.19, 1.85, 0.06)), COL.steel, 8, slot);
  } else if (weapon === 'bow') {
    b.add(new THREE.TorusGeometry(0.32, 0.016, 3, 8, Math.PI), at(xf(0.2, 0.7, 0.1, 0, -Math.PI / 2, -Math.PI / 2)), COL.leather, 8, slot);
  }
}
function buildChariot() {
  const b = new RigBuilder(1);
  for (const sx of [1, -1]) {
    b.add(disc(0.085, 0.016, 10), xf(0.105 * sx, 0.085, 0, 0, 0, Math.PI / 2), COL.wheel, 7);
    for (let k = 0; k < 3; k++) b.add(box(0.012, 0.16, 0.012), xf(0.115 * sx, 0.085, 0, (k * Math.PI) / 3), COL.woodLight, 7);
  }
  b.add(box(0.2, 0.012, 0.012), xf(0, 0.085, 0), COL.wood);
  // war car
  b.add(box(0.17, 0.02, 0.13), xf(0, 0.1, 0), COL.wood, 0, CK.war);
  b.add(box(0.012, 0.07, 0.13), xf(0.085, 0.145, 0), 0.9, 0, CK.war, 1);
  b.add(box(0.012, 0.07, 0.13), xf(-0.085, 0.145, 0), 0.9, 0, CK.war, 1);
  b.add(box(0.17, 0.08, 0.012), xf(0, 0.15, 0.065), 1.0, 0, CK.war, 1);
  b.add(box(0.18, 0.012, 0.14), xf(0, 0.185, 0), COL.bronze, 0, CK.war);
  b.add(box(0.014, 0.014, 0.36), xf(0, 0.125, 0.23, -0.12), COL.wood, 0, CK.war);
  b.add(box(0.22, 0.014, 0.014), xf(0, 0.17, 0.4), COL.wood, 0, CK.war);
  // supply cart
  b.add(box(0.18, 0.02, 0.26), xf(0, 0.11, 0), COL.woodLight, 0, CK.cart);
  b.add(box(0.012, 0.05, 0.26), xf(0.09, 0.14, 0), COL.wood, 0, CK.cart);
  b.add(box(0.012, 0.05, 0.26), xf(-0.09, 0.14, 0), COL.wood, 0, CK.cart);
  b.add(box(0.075, 0.065, 0.075), xf(0.04, 0.155, 0.055, 0, 0.3, 0), COL.woodLight, 0, CK.cart);
  b.add(box(0.07, 0.06, 0.07), xf(-0.04, 0.152, -0.05, 0, -0.2, 0), 0xb08a5a, 0, CK.cart);
  b.add(ball(0.045, 5, 4), xf(-0.035, 0.15, 0.06, 0, 0, 0, 1, 0.75, 1), 0xc9b48a, 0, CK.cart);
  b.add(box(0.11, 0.025, 0.11), xf(0.04, 0.2, 0.055, 0, 0.3, 0), 0.9, 0, CK.cart, 1);
  b.add(box(0.012, 0.012, 0.2), xf(0.075, 0.13, -0.21, 0.15), COL.wood, 0, CK.cart);
  b.add(box(0.012, 0.012, 0.2), xf(-0.075, 0.13, -0.21, 0.15), COL.wood, 0, CK.cart);
  // banner pole
  const [ax, ay, az] = C_PIV.anchor;
  b.add(cyl(0.008, 0.009, ay - 0.08, 5), xf(ax, (ay + 0.08) / 2, az), COL.wood, 0, CK.pole);
  b.add(cone(0.012, 0.035, 5), xf(ax, ay + 0.02, az), COL.gold, 0, CK.pole);
  addMiniMan(b, 0, 0.025, 0.27, CK.crew, null);
  addMiniMan(b, -0.045, -0.035, 0.27, CK.crew, 'bow');
  addMiniMan(b, 0.045, -0.035, 0.27, CK.crew, 'ji');
  return b.build();
}

function buildBlob() {
  const g = new THREE.CircleGeometry(1, 12);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.025, 0);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const pos = g.attributes.position;
  const a = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) a[i] = 1 - Math.min(1, Math.hypot(pos.getX(i), pos.getZ(i)));
  g.setAttribute('aAlpha', new THREE.BufferAttribute(a, 1));
  return g;
}

function buildCloth() {
  const g = new THREE.PlaneGeometry(1, 1, 5, 6);
  g.translate(0.5, -0.5, 0);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  return g;
}

function buildArrow() {
  const b = new RigBuilder(1);
  b.add(box(0.008, 0.008, 0.17), xf(0, 0, 0), 0x3a2a1a);
  b.add(cone(0.013, 0.035, 4), xf(0, 0, 0.1, Math.PI / 2), 0x9a9a9a);
  b.add(box(0.024, 0.003, 0.035), xf(0, 0, -0.07), 0xe8e0d0);
  b.add(box(0.003, 0.024, 0.035), xf(0, 0, -0.07), 0xe8e0d0);
  const g = b.build();
  g.deleteAttribute('aInfo');
  return g;
}

// --- Shaders ---
const f4 = (x) => (Math.round(x * 10000) / 10000).toFixed(4);
const v3 = (a, k = 1) => `vec3(${f4(a[0] * k)}, ${f4(a[1] * k)}, ${f4(a[2] * k)})`;

function coatsGLSL() {
  return COATS.map((h) => { _c.set(h); return `vec3(${f4(_c.r)}, ${f4(_c.g)}, ${f4(_c.b)})`; }).join(', ');
}

const COMMON_V = () => `
attribute vec3 aInfo;
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
varying vec3 vTint;
varying float vDesat;
varying float vGlow;
const vec3 COATS[${COATS.length}] = vec3[${COATS.length}](${coatsGLSL()});
vec3 rX( vec3 p, vec3 c, float a ) { p -= c; float s = sin( a ), k = cos( a ); return c + vec3( p.x, k * p.y - s * p.z, s * p.y + k * p.z ); }
vec3 rY( vec3 p, vec3 c, float a ) { p -= c; float s = sin( a ), k = cos( a ); return c + vec3( k * p.x + s * p.z, p.y, - s * p.x + k * p.z ); }
vec3 rZ( vec3 p, vec3 c, float a ) { p -= c; float s = sin( a ), k = cos( a ); return c + vec3( k * p.x - s * p.y, s * p.x + k * p.y, p.z ); }
float kitOn( float kit, float slot ) { return slot < 0.5 ? 1.0 : mod( floor( ( kit + 0.5 ) / exp2( slot - 1.0 ) ), 2.0 ); }
float envAct( float t0, float dur ) { float a = uTime - t0; return ( t0 > 0.0 && a > 0.0 && a < dur ) ? smoothstep( 0.0, 0.15, a ) * ( 1.0 - smoothstep( dur - 0.3, dur, a ) ) : 0.0; }
float pulse( float t0, float dur ) { float a = uTime - t0; return ( t0 > 0.0 && a > 0.0 && a < dur ) ? sin( a / dur * 3.14159 ) : 0.0; }
float horseBob( float ph, float g ) {
  float w = clamp( g, 0.0, 1.0 ), r = clamp( g - 1.0, 0.0, 1.0 );
  return w * abs( sin( uTime * mix( 6.0, 10.5, r ) + ph ) ) * mix( 0.008, 0.02, r );
}
float dieF( float t0 ) { if ( t0 <= 0.0 || uTime < t0 ) return 0.0; float f = smoothstep( 0.0, 0.6, uTime - t0 ); return f * f; }
float sinkF( float t0 ) { return t0 > 0.0 ? max( uTime - t0 - 1.8, 0.0 ) * 0.28 : 0.0; }
`;

const TINT_V = `
  vTint = aInfo.z > 1.5 ? COATS[ int( iC.w + 0.5 ) ] : ( aInfo.z > 0.5 ? iB.rgb : vec3( 1.0 ) );
  vDesat = iC.y;
  vGlow = iC.z;
`;

const RIG_GLSL = {
  foot: () => `{
  float part = aInfo.x;
  float ph = iA.x, g = iA.y;
  float walk = clamp( g, 0.0, 1.0 ), run = clamp( g - 1.0, 0.0, 1.0 );
  float cyc = uTime * mix( 7.0, 11.5, run ) + ph;
  float sw = sin( cyc ) * walk * mix( 0.5, 0.85, run );
  float act = envAct( iA.z, 1.5 );
  float strike = act * ( 0.5 + 0.5 * sin( ( uTime - iA.z ) * 9.0 + ph ) );
  float hit = pulse( iA.w, 0.5 );
  float idle = ( 1.0 - walk ) * sin( uTime * 0.9 + ph * 3.0 );
  float kit = iC.x;
  float shield = max( kitOn( kit, 6.0 ), kitOn( kit, 7.0 ) );
  float xbow = kitOn( kit, 11.0 );
  vec3 p = transformed;
  if ( part == 1.0 ) p = rX( p, ${v3(F_PIV.hip, S)}, sw );
  else if ( part == 2.0 ) p = rX( p, ${v3(F_PIV.hip, S)}, - sw );
  else if ( part == 3.0 || part == 4.0 ) {
    float armA = - sw * 0.7 * ( 1.0 - xbow ) + idle * 0.06 - act * mix( 0.45 + strike * 0.7, 1.2, xbow );
    if ( part == 4.0 ) {
      float tilt = xbow > 0.5 ? ( - armA - 0.25 * act ) : act * ( 1.45 - armA ) - 0.12 * walk * ( 1.0 - act );
      p = rX( p, ${v3(F_PIV.hand, S)}, tilt );
    }
    p = rX( p, ${v3(F_PIV.shR, S)}, armA );
  } else if ( part == 5.0 ) {
    float armL = sw * 0.7 * ( 1.0 - 0.8 * shield ) - idle * 0.05 - act * ( 0.35 * shield + 0.9 * xbow );
    p = rX( p, ${v3(F_PIV.shL, S)}, armL );
  }
  p.y += abs( cos( cyc ) ) * walk * mix( 0.008, 0.016, run );
  p = rX( p, vec3( 0.0 ), run * 0.2 + act * 0.1 * ( 1.0 - xbow ) - hit * 0.45 );
  p = rY( p, vec3( 0.0 ), idle * 0.1 );
  p = rX( p, vec3( 0.0 ), - 1.52 * dieF( iB.w ) );
  p.y -= sinkF( iB.w );
  p *= kitOn( kit, aInfo.y );
  transformed = p;
  ${TINT_V}
}`,
  horse: () => `{
  float part = aInfo.x;
  float ph = iA.x, g = iA.y;
  float walk = clamp( g, 0.0, 1.0 ), run = clamp( g - 1.0, 0.0, 1.0 );
  float cyc = uTime * mix( 6.0, 10.5, run ) + ph;
  float hit = pulse( iA.w, 0.55 );
  vec3 p = transformed;
  if ( part > 0.5 && part < 4.5 ) {
    bool front = part < 2.5;
    float wk = ( part == 1.0 || part == 4.0 ) ? sin( cyc ) : - sin( cyc );
    float gl = sin( cyc + ( front ? 0.0 : 2.4 ) + ( ( part == 2.0 || part == 4.0 ) ? 0.4 : 0.0 ) );
    float a = mix( wk * 0.45, gl * 0.8, run ) * walk;
    p = rX( p, front ? ${v3(H_PIV.front)} : ${v3(H_PIV.back)}, a );
  } else {
    if ( part == 5.0 ) {
      float graze = pow( max( sin( uTime * 0.21 + ph * 5.0 ), 0.0 ), 6.0 ) * ( 1.0 - walk );
      p = rX( p, ${v3(H_PIV.neck)}, graze * 0.9 + ( 1.0 - walk ) * 0.05 * sin( uTime * 0.8 + ph ) + walk * 0.07 * sin( cyc * 2.0 ) - run * 0.15 - hit * 0.4 );
    }
    if ( part == 6.0 ) p = rY( p, ${v3(H_PIV.tail)}, sin( uTime * 2.1 + ph ) * 0.4 * ( 1.0 - run ) );
    p.y += horseBob( ph, g );
  }
  p = rX( p, vec3( 0.0, 0.0, -0.12 ), - hit * 0.3 );
  p = rZ( p, vec3( 0.0 ), 1.45 * dieF( iB.w ) );
  p.y -= sinkF( iB.w );
  p *= kitOn( iC.x, aInfo.y );
  transformed = p;
  ${TINT_V}
}`,
  rider: () => `{
  float part = aInfo.x;
  float ph = iA.x, g = iA.y;
  float walk = clamp( g, 0.0, 1.0 ), run = clamp( g - 1.0, 0.0, 1.0 );
  float cyc = uTime * mix( 6.0, 10.5, run ) + ph;
  float act = envAct( iA.z, 1.5 );
  float strike = act * ( 0.5 + 0.5 * sin( ( uTime - iA.z ) * 8.0 + ph ) );
  float hit = pulse( iA.w, 0.55 );
  float kit = iC.x;
  float bow = kitOn( kit, 5.0 );
  vec3 p = transformed;
  if ( part == 3.0 || part == 4.0 ) {
    float armA = - act * ( 0.4 + strike * 0.8 ) * ( 1.0 - bow ) + walk * 0.05 * sin( cyc );
    if ( part == 4.0 ) p = rX( p, ${v3(R_PIV.hand || [0, 0, 0], S)}, act * ( 1.4 - armA ) * ( 1.0 - bow ) + run * 1.15 * ( 1.0 - act ) );
    p = rX( p, ${v3(R_PIV.shR, S)}, armA );
  } else if ( part == 5.0 ) {
    p = rX( p, ${v3(R_PIV.shL, S)}, - act * 0.75 * bow );
  } else if ( part == 7.0 ) {
    p = rX( p, ${v3(R_PIV.cape, S)}, 0.1 + 0.08 * sin( uTime * 3.0 + ph ) + walk * 0.3 + run * 0.6 );
  }
  p = rX( p, vec3( 0.0 ), run * 0.22 + act * 0.12 - hit * 0.35 );
  p.y += horseBob( ph, g );
  p = rX( p, vec3( 0.0, ${f4(-RIDER_Y)}, -0.12 ), - hit * 0.3 );
  p = rZ( p, vec3( 0.0, ${f4(-RIDER_Y)}, 0.0 ), 1.45 * dieF( iB.w ) );
  p.y -= sinkF( iB.w );
  p *= kitOn( kit, aInfo.y );
  transformed = p;
  ${TINT_V}
}`,
  chariot: () => `{
  float part = aInfo.x;
  float ph = iA.x, g = iA.y;
  float walk = clamp( g, 0.0, 1.0 ), run = clamp( g - 1.0, 0.0, 1.0 );
  float act = envAct( iA.z, 1.5 );
  float hit = pulse( iA.w, 0.55 );
  vec3 p = transformed;
  if ( part == 7.0 ) p = rX( p, ${v3(C_PIV.axle)}, uTime * walk * mix( 3.5, 8.0, run ) );
  if ( part == 8.0 ) {
    p.y += abs( sin( uTime * mix( 6.0, 10.5, run ) + ph ) ) * walk * 0.006;
    p = rX( p, ${v3(C_PIV.crew)}, act * 0.15 * sin( ( uTime - iA.z ) * 8.0 ) - hit * 0.35 );
  }
  p = rZ( p, vec3( 0.0 ), 1.2 * dieF( iB.w ) );
  p.y -= sinkF( iB.w );
  p *= kitOn( iC.x, aInfo.y );
  transformed = p;
  ${TINT_V}
}`,
};

function rigMaterial(kind) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, flatShading: true, envMapIntensity: 0.6 });
  return patchLit(mat, {}, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', COMMON_V() + '\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + RIG_GLSL[kind]());
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying vec3 vTint;\nvarying float vDesat;\nvarying float vGlow;\nvoid main() {')
      .replace('#include <color_fragment>', `#include <color_fragment>
  diffuseColor.rgb *= vTint;
  { float l = dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) ); diffuseColor.rgb = mix( diffuseColor.rgb, vec3( l ), vDesat * 0.35 ) * ( 1.0 - 0.1 * vDesat ); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * ( 0.06 + vGlow * 0.35 );`);
  }, 'units3d-' + kind);
}

const CLOTH_DIM = [[0.17, 0.28], [0.27, 0.44]];
function clothMaterial(glyphTex) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, flatShading: true, side: THREE.DoubleSide, envMapIntensity: 0.5 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = G.uTime;
    shader.uniforms.uGlyphs = { value: glyphTex };
    shader.vertexShader = shader.vertexShader.replace('void main() {', `
uniform float uTime;
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
varying vec2 vCUv;
varying vec4 vCI;
varying vec3 vTeamC;
void main() {`).replace('#include <project_vertex>', `
  vec3 anc = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  float sc = length( instanceMatrix[ 0 ].xyz );
  float ph = iA.x, g = iA.y, style = iA.z, bt = iA.w;
  float gsc = sc * ( 1.0 + 0.7 * smoothstep( 10.0, 40.0, distance( cameraPosition, anc ) ) );
  float walk = clamp( g, 0.0, 1.0 ), run = clamp( g - 1.0, 0.0, 1.0 );
  if ( bt < 0.5 ) anc.y += abs( cos( uTime * mix( 7.0, 11.5, run ) + ph ) ) * walk * mix( 0.008, 0.016, run ) * sc;
  else if ( bt < 1.5 ) anc.y += walk * abs( sin( uTime * mix( 6.0, 10.5, run ) + ph ) ) * mix( 0.008, 0.02, run ) * sc;
  vec3 tc = cameraPosition - anc; tc.y = 0.0; tc = normalize( tc + vec3( 1e-4, 0.0, 0.0 ) );
  vec3 rt = vec3( tc.z, 0.0, - tc.x );
  float W = ( style > 0.5 ? ${f4(CLOTH_DIM[1][0])} : ${f4(CLOTH_DIM[0][0])} ) * gsc;
  float Hh = ( style > 0.5 ? ${f4(CLOTH_DIM[1][1])} : ${f4(CLOTH_DIM[0][1])} ) * gsc;
  float u = position.x, v = - position.y;
  float sp = 4.5 + g * 3.0;
  float wv = ( sin( u * 4.5 + v * 1.5 - uTime * sp + ph ) * 0.6 + sin( u * 7.0 + v * 3.0 - uTime * sp * 1.43 + ph * 2.0 ) * 0.4 ) * u * ( 0.13 + 0.08 * g );
  vec3 wp = anc + rt * ( u * W * ( 1.0 - 0.05 * g ) ) - vec3( 0.0, v * Hh, 0.0 ) + tc * wv * W;
  if ( iB.w > 0.0 && uTime > iB.w ) wp = anc;
  vCUv = vec2( u, v );
  vCI = vec4( iC.x, style, iC.y, iC.z );
  vTeamC = iB.rgb;
  vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
  gl_Position = projectionMatrix * mvPosition;`);
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `
uniform sampler2D uGlyphs;
varying vec2 vCUv;
varying vec4 vCI;
varying vec3 vTeamC;
void main() {`).replace('#include <color_fragment>', `
  vec2 cu = vCUv;
  if ( cu.y > 0.84 && abs( cu.x - 0.5 ) < ( cu.y - 0.84 ) * 2.4 ) discard;
  float edge = max( max( step( cu.x, 0.07 ), step( 0.93, cu.x ) ), step( cu.y, 0.06 ) );
  vec3 team = vTeamC;
  float lum = dot( team, vec3( 0.2126, 0.7152, 0.0722 ) );
  vec3 trim = vCI.y > 0.5 ? vec3( 0.75, 0.48, 0.1 ) : team * 0.28;
  vec3 col = mix( team, trim, edge );
  float aspect = vCI.y > 0.5 ? ${f4(CLOTH_DIM[1][0] / CLOTH_DIM[1][1])} : ${f4(CLOTH_DIM[0][0] / CLOTH_DIM[0][1])};
  vec2 gp = vec2( ( cu.x - 0.14 ) / 0.72, ( cu.y - 0.13 ) / ( 0.72 * aspect ) );
  if ( gp.x > 0.0 && gp.x < 1.0 && gp.y > 0.0 && gp.y < 1.0 ) {
    float ga = texture2D( uGlyphs, vec2( ( vCI.x + gp.x ) / 8.0, 1.0 - gp.y ) ).a;
    vec3 ink = lum > 0.3 ? vec3( 0.02 ) : vec3( 0.93, 0.87, 0.72 );
    col = mix( col, ink, ga );
  }
  diffuseColor.rgb = col;
  { float l = dot( col, vec3( 0.3, 0.59, 0.11 ) ); diffuseColor.rgb = mix( col, vec3( l ), vCI.z * 0.2 ) * ( 1.0 - 0.05 * vCI.z ); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * ( 0.12 + vCI.w * 0.7 );`);
  };
  mat.customProgramCacheKey = () => 'units3d-cloth';
  return mat;
}

function blobMaterial() {
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = G.uTime;
    shader.vertexShader = shader.vertexShader.replace('void main() {', `
uniform float uTime;
attribute float aAlpha;
attribute vec4 iB;
varying float vA;
void main() {
  vA = aAlpha * ( iB.w > 0.0 ? 1.0 - smoothstep( 0.5, 2.8, uTime - iB.w ) : 1.0 );`);
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', 'varying float vA;\nvoid main() {')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a *= vA;');
  };
  mat.customProgramCacheKey = () => 'units3d-blob';
  return mat;
}

function arrowMaterial() {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = G.uTime;
    shader.vertexShader = shader.vertexShader.replace('void main() {', `
uniform float uTime;
attribute vec4 aS;
attribute vec4 aE;
void main() {`).replace('#include <project_vertex>', `
  float u = ( uTime - aS.w ) / max( aE.w, 0.01 );
  vec3 wp = vec3( 0.0, -500.0, 0.0 );
  if ( u > 0.0 && u < 1.8 ) {
    float uc = min( u, 1.0 );
    vec3 d = aE.xyz - aS.xyz;
    float hgt = 0.25 * length( d.xz ) + 0.25;
    vec3 P = aS.xyz + d * uc;
    P.y += 4.0 * hgt * uc * ( 1.0 - uc );
    vec3 fw = normalize( d + vec3( 0.0, 4.0 * hgt * ( 1.0 - 2.0 * uc ), 0.0 ) );
    vec3 sd = normalize( cross( vec3( 0.0, 1.0, 0.0 ), fw ) + vec3( 1e-4, 0.0, 0.0 ) );
    vec3 up = cross( fw, sd );
    float k = 1.0 - smoothstep( 1.4, 1.8, u );
    wp = P + ( sd * position.x + up * position.y + fw * ( position.z - ( u >= 1.0 ? 0.06 : 0.0 ) ) ) * k;
  }
  vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
  gl_Position = projectionMatrix * mvPosition;`);
  };
  mat.customProgramCacheKey = () => 'units3d-arrow';
  return mat;
}

function makeGlyphAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  const chars = [];
  function draw() {
    ctx.clearRect(0, 0, 1024, 128);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 104px "Hiragino Mincho ProN", "Songti SC", "Noto Serif CJK SC", "Yu Mincho", "SimSun", serif';
    chars.forEach((ch, i) => ctx.fillText(ch, i * 128 + 64, 68));
    tex.needsUpdate = true;
  }
  return {
    tex,
    index(ch) {
      let i = chars.indexOf(ch);
      if (i >= 0) return i;
      if (chars.length >= 8) return 0;
      chars.push(ch); draw();
      return chars.length - 1;
    },
  };
}

// --- Instance pools ---
const _px = new Float32Array(16);
function upload(attr, start, count) {
  if (attr.addUpdateRange) attr.addUpdateRange(start, count);
  attr.needsUpdate = true;
}
class Pool {
  constructor(geo, mat, cap, names = ['iA', 'iB', 'iC']) {
    this.geo = geo; this.cap = cap; this.hw = 0; this.free = []; this.names = names;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix.array.fill(0);
    this.attrs = {};
    for (const n of names) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(n, a);
      this.attrs[n] = a;
    }
    this.mLo = Infinity; this.mHi = -1; this.aLo = Infinity; this.aHi = -1;
  }
  get live() { return this.hw - this.free.length; }
  alloc() {
    if (this.free.length) return this.free.pop();
    if (this.hw >= this.cap) this.grow();
    return this.hw++;
  }
  release(s) {
    this.mesh.instanceMatrix.array.fill(0, s * 16, s * 16 + 16);
    this.markM(s);
    this.free.push(s);
    if (this.free.length === this.hw) { this.free.length = 0; this.hw = 0; }
  }
  grow() {
    const cap = this.cap * 2;
    this.mesh.dispose();
    const im = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
    im.array.set(this.mesh.instanceMatrix.array);
    im.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceMatrix = im;
    for (const n of this.names) {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      a.array.set(this.attrs[n].array);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(n, a);
      this.attrs[n] = a;
    }
    this.cap = cap;
    this.mLo = Infinity; this.mHi = -1; this.aLo = Infinity; this.aHi = -1;
  }
  markM(s) { if (s < this.mLo) this.mLo = s; if (s > this.mHi) this.mHi = s; }
  markA(s) { if (s < this.aLo) this.aLo = s; if (s > this.aHi) this.aHi = s; }
  mat(s, x, y, z, yaw, sx, sy = sx, sz = sx) {
    const c = Math.cos(yaw), n = Math.sin(yaw), a = this.mesh.instanceMatrix.array, o = s * 16;
    a[o] = c * sx; a[o + 1] = 0; a[o + 2] = -n * sx; a[o + 3] = 0;
    a[o + 4] = 0; a[o + 5] = sy; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = n * sz; a[o + 9] = 0; a[o + 10] = c * sz; a[o + 11] = 0;
    a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1;
    this.markM(s);
  }
  set(name, s, x, y, z, w) {
    const a = this.attrs[name].array, o = s * 4;
    a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = w;
    this.markA(s);
  }
  setW(name, s, w) { this.attrs[name].array[s * 4 + 3] = w; this.markA(s); }
  flush() {
    this.mesh.count = this.hw;
    if (this.mHi >= this.mLo) upload(this.mesh.instanceMatrix, this.mLo * 16, (this.mHi - this.mLo + 1) * 16);
    if (this.aHi >= this.aLo) for (const n of this.names) upload(this.attrs[n], this.aLo * 4, (this.aHi - this.aLo + 1) * 4);
    this.mLo = Infinity; this.mHi = -1; this.aLo = Infinity; this.aHi = -1;
  }
}

// --- Formation templates ---
function rngFrom(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
const BLOB = { foot: [0, 0.15, 0.15], footB: [0, 0.15, 0.15], cav: [0, 0.15, 0.27], chariot: [0.18, 0.2, 0.44], cart: [-0.03, 0.17, 0.25] };

function footTpl(lx, lz, kit, rnd, extra = {}) {
  return { rig: kit & IRREG ? 'footB' : 'foot', lx, lz, yaw: (rnd() - 0.5) * 0.2, kit, sc: 1, ...extra };
}
function grid(n, cols, sx, sz, z0, rnd, kitFn) {
  const out = [], rows = Math.ceil(n / cols);
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols), inRow = row === rows - 1 ? n - row * cols : cols, col = i % cols;
    const lx = (col - (inRow - 1) / 2) * sx + (rnd() - 0.5) * 0.035;
    const lz = z0 + ((rows - 1) / 2 - row) * sz + (rnd() - 0.5) * 0.035;
    out.push({ ...footTpl(lx, lz, kitFn(rnd, i), rnd), rank: row });
  }
  return out;
}
function prioritize(bearers, soldiers, rnd) {
  soldiers.forEach((s) => { s._p = (s.rank || 0) + rnd() * 1.3; });
  soldiers.sort((a, b) => b._p - a._p);
  return [...bearers, ...soldiers];
}
function infantry(full, cols, sx, sz, kitFn, bearerKit) {
  return (rnd, density) => {
    const n = Math.max(4, Math.round((full - 1) * density));
    const sold = grid(n, cols, sx, sz, 0.1, rnd, kitFn);
    const back = Math.min(...sold.map((s) => s.lz));
    const bearer = footTpl(0.02, back - sz * 0.85, bearerKit, rnd, { cloth: 0 });
    return prioritize([bearer], sold, rnd);
  };
}
function loose(points, kitFn) {
  return (rnd) => points.map(([x, z]) => ({ ...footTpl(x + (rnd() - 0.5) * 0.06, z + (rnd() - 0.5) * 0.06, kitFn(rnd), rnd), yaw: (rnd() - 0.5) * 0.7 }));
}
function cavTpl(lx, lz, kit, hkit, coat, rnd, extra = {}) {
  return { rig: 'cav', lx, lz, yaw: (rnd() - 0.5) * 0.12, kit, hkit, coats: [coat], sc: 1, ...extra };
}
function cavalry(rows, sx, sz, kitFn, hkit, coats, bearerKit, bearerH) {
  return (rnd) => {
    const sold = [];
    const nRows = rows.length;
    rows.forEach((cnt, ri) => {
      const z = ((nRows - 1) / 2 - ri) * sz + 0.05;
      const slots = ri === nRows - 1 ? cnt - 1 : cnt;
      const xs = [];
      if (ri === nRows - 1) { for (let i = 0; i < slots; i++) xs.push((i - (slots - 1) / 2) * sx * (slots > 1 ? 1.5 : 1)); }
      else for (let i = 0; i < cnt; i++) xs.push((i - (cnt - 1) / 2) * sx);
      for (const x of xs) sold.push({ ...cavTpl(x + (rnd() - 0.5) * 0.03, z + (rnd() - 0.5) * 0.05, kitFn(rnd), hkit, pick(rnd, coats), rnd), rank: ri });
    });
    const bz = ((nRows - 1) / 2 - (nRows - 1)) * sz + 0.02;
    const bearer = cavTpl(0, bz, bearerKit, bearerH, pick(rnd, coats), rnd, { cloth: 0 });
    return prioritize([bearer], sold, rnd);
  };
}

const SPECS = {
  pietaille: { anchorH: 0.72, make: infantry(20, 5, 0.19, 0.2, (r) => bits(pick(r, [FK.bun, FK.straw, FK.bun]), pick(r, [FK.fork, FK.spear, FK.fork, FK.shovel])), bits(FK.bun, FK.pole)) },
  soldats: { anchorH: 0.75, make: infantry(18, 6, 0.18, 0.2, () => bits(FK.helmet, FK.lamellar, FK.sword, FK.round), bits(FK.helmet, FK.lamellar, FK.pole)) },
  phalange: { anchorH: 0.75, make: infantry(18, 6, 0.165, 0.19, () => bits(FK.helmet, FK.lamellar, FK.tower, FK.spear), bits(FK.helmet, FK.lamellar, FK.pole)) },
  lancier: { anchorH: 0.78, make: infantry(18, 6, 0.18, 0.21, () => bits(FK.helmet, FK.lamellar, FK.ji), bits(FK.helmet, FK.lamellar, FK.pole)) },
  archer: { anchorH: 0.75, make: infantry(12, 6, 0.19, 0.24, (r) => bits(pick(r, [FK.bun, FK.helmet]), FK.crossbow, FK.quiver), bits(FK.helmet, FK.quiver, FK.pole)) },
  archer_elite: { anchorH: 0.75, make: infantry(12, 6, 0.19, 0.24, () => bits(FK.helmet, FK.lamellar, FK.crossbow, FK.quiver), bits(FK.helmet, FK.lamellar, FK.pole)) },
  espion: { anchorH: 0.6, make: loose([[0, 0.18], [-0.24, -0.04], [0.23, -0.08], [0.02, -0.3]], () => bits(FK.hood, FK.cloak, FK.sword)) },
  assassin: { anchorH: 0.6, make: loose([[0, 0.12], [-0.2, -0.14], [0.21, -0.12]], () => bits(FK.hood, FK.cloak, FK.daggers)) },
  batisseurs: {
    anchorH: 0.72,
    make: (rnd) => {
      const kits = [bits(FK.straw, FK.hammer), bits(FK.straw, FK.shovel), bits(FK.bun, FK.planks), bits(FK.straw, FK.hammer), bits(FK.bun, FK.shovel), bits(FK.straw, FK.planks), bits(FK.bun, FK.hammer)];
      const sold = [];
      const pts = [[-0.33, 0.28], [-0.1, 0.32], [0.14, 0.3], [0.37, 0.25], [-0.24, 0.05], [0.0, 0.08], [0.27, 0.02]];
      pts.forEach(([x, z], i) => sold.push({ ...footTpl(x + (rnd() - 0.5) * 0.06, z + (rnd() - 0.5) * 0.06, kits[i], rnd), yaw: (rnd() - 0.5) * 0.9, rank: z > 0.15 ? 0 : 1 }));
      const cart = { rig: 'cart', lx: 0.12, lz: -0.3, yaw: 0.35, kit: bits(CK.cart), sc: 1 };
      const bearer = footTpl(-0.3, -0.27, bits(FK.straw, FK.pole), rnd, { cloth: 0 });
      return prioritize([bearer, cart], sold, rnd);
    },
  },
  cavalier_leger: { anchorH: 0.95, make: cavalry([4, 3], 0.29, 0.44, (r) => bits(pick(r, [RK.bun, RK.helmet]), RK.bow, RK.quiver), bits(HK.cloth), [0, 1, 5, 6, 3], bits(RK.helmet, RK.pole), bits(HK.cloth)) },
  cavalier_lourd: { anchorH: 1.0, make: cavalry([3, 3], 0.33, 0.46, () => bits(RK.helmet, RK.lamellar, RK.ji, RK.round), bits(HK.barding, HK.chanfron), [2, 5, 0], bits(RK.helmet, RK.lamellar, RK.pole), bits(HK.barding, HK.chanfron)) },
  char: {
    anchorH: 1.0,
    make: (rnd) => [0, -0.44, 0.44].map((x, i) => ({
      rig: 'chariot', lx: x, lz: -0.18 + (i ? -0.06 : 0.04), yaw: (rnd() - 0.5) * 0.08,
      kit: bits(CK.war, CK.crew, ...(i === 0 ? [CK.pole] : [])), hkit: i === 0 ? bits(HK.cloth) : 0,
      coats: [pick(rnd, [0, 1, 5, 2]), pick(rnd, [0, 1, 5, 2])], sc: 1, cloth: i === 0 ? 0 : undefined,
    })),
  },
  general: {
    anchorH: 1.2,
    make: (rnd) => [
      cavTpl(0, 0.16, bits(RK.plume, RK.lamellar, RK.cape, RK.guandao), bits(HK.barding, HK.chanfron), 4, rnd, { sc: 1.28, yaw: 0 }),
      cavTpl(-0.36, -0.22, bits(RK.helmet, RK.lamellar, RK.pole), bits(HK.barding), 2, rnd, { cloth: 1, sc: 1.08 }),
      cavTpl(0.36, -0.16, bits(RK.helmet, RK.lamellar, RK.ji, RK.round), bits(HK.barding, HK.chanfron), 5, rnd, { sc: 1.08 }),
      cavTpl(0.02, -0.42, bits(RK.helmet, RK.lamellar, RK.ji), bits(HK.barding, HK.chanfron), 2, rnd, { sc: 1.08 }),
      cavTpl(-0.4, 0.2, bits(RK.helmet, RK.lamellar, RK.sword, RK.round), bits(HK.barding), 0, rnd, { sc: 1.08 }),
    ],
  },
};
const CATEGORY_FALLBACK = { Infanterie: 'soldats', Chevaux: 'cavalier_leger', Tireurs: 'archer', Chars: 'char', 'Général': 'general' };

const RIGS = {
  foot: { parts: [{ pool: 'foot', ox: 0, oy: 0, oz: 0, kit: 'kit' }], anchor: F_PIV.anchor.map((v) => v * S), bob: 0 },
  footB: { parts: [{ pool: 'footB', ox: 0, oy: 0, oz: 0, kit: 'kit' }], anchor: F_PIV.anchor.map((v) => v * S), bob: 0 },
  cav: { parts: [{ pool: 'horse', ox: 0, oy: 0, oz: 0, kit: 'hkit', coat: 0 }, { pool: 'rider', ox: 0, oy: RIDER_Y, oz: 0, kit: 'kit' }], anchor: null, bob: 1 },
  chariot: {
    parts: [{ pool: 'chariot', ox: 0, oy: 0, oz: 0, kit: 'kit' }, { pool: 'horse', ox: -0.074, oy: 0, oz: 0.33, kit: 'hkit', coat: 0, ph: 0 }, { pool: 'horse', ox: 0.074, oy: 0, oz: 0.33, kit: 'hkit', coat: 1, ph: 0.5 }],
    anchor: C_PIV.anchor, bob: 2,
  },
  cart: { parts: [{ pool: 'chariot', ox: 0, oy: 0, oz: 0, kit: 'kit' }], anchor: C_PIV.anchor, bob: 2 },
};

// --- Ring (selection / hover), conformed to terrain on CPU ---
function makeRing(color, alpha, groundHeight) {
  const N = 48, R0 = 0.7, R1 = 0.9;
  const pos = new Float32Array(N * 2 * 3), col = new Float32Array(N * 2 * 4), idx = [];
  const corners = [];
  for (let i = 0; i < 6; i++) corners.push([Math.cos((i * Math.PI) / 3), Math.sin((i * Math.PI) / 3)]);
  const dir = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * 6, k = Math.floor(t), f = t - k;
    const a = corners[k], b = corners[(k + 1) % 6];
    dir.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    const c = new THREE.Color(color);
    col.set([c.r, c.g, c.b, 0], i * 8);
    col.set([c.r, c.g, c.b, 1], i * 8 + 4);
    const j = (i + 1) % N;
    idx.push(i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: alpha, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 3;
  let lx = NaN, lz = NaN;
  return {
    mesh, baseAlpha: alpha,
    place(x, z) {
      if (x === lx && z === lz) return;
      lx = x; lz = z;
      for (let i = 0; i < N; i++) {
        const [dx, dz] = dir[i];
        for (const [k, R] of [[0, R0], [1, R1]]) {
          const px = x + dx * R, pz = z + dz * R;
          pos.set([px, groundHeight(px, pz) + 0.05, pz], (i * 2 + k) * 3);
        }
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// --- Layer ---
export function createUnitLayer(world, { getPlayerColor = () => '#bbbbbb', getPlayerEmblem = null, autoUpdate = true } = {}) {
  const { scene, hexToWorld } = world;
  const groundHeight = world.walkHeight || world.groundHeight;
  const group = new THREE.Group();
  group.name = 'units3d';
  scene.add(group);

  const glyphs = makeGlyphAtlas();
  const mats = {
    foot: rigMaterial('foot'), horse: rigMaterial('horse'), rider: rigMaterial('rider'), chariot: rigMaterial('chariot'),
    cloth: clothMaterial(glyphs.tex), blob: blobMaterial(), arrow: arrowMaterial(),
  };
  const footGeo = buildFoot();
  const pools = {
    foot: new Pool(subset(footGeo, FOOT_A), mats.foot, 4096),
    footB: new Pool(subset(footGeo, FOOT_B), mats.foot, 1024),
    horse: new Pool(buildHorse(), mats.horse, 1024),
    rider: new Pool(buildRider(), mats.rider, 1024),
    chariot: new Pool(buildChariot(), mats.chariot, 128),
    cloth: new Pool(buildCloth(), mats.cloth, 256),
    blob: new Pool(buildBlob(), mats.blob, 4096, ['iB']),
  };
  pools.cloth.mesh.receiveShadow = false;
  pools.blob.mesh.receiveShadow = false;
  pools.blob.mesh.renderOrder = 1;
  for (const p of Object.values(pools)) group.add(p.mesh);
  RIGS.cav.anchor = [R_PIV.anchor[0] * S, RIDER_Y + R_PIV.anchor[1] * S, R_PIV.anchor[2] * S];

  // arrows
  const ARROW_CAP = 1024;
  const arrowGeo = buildArrow();
  const aS = new THREE.InstancedBufferAttribute(new Float32Array(ARROW_CAP * 4), 4);
  const aE = new THREE.InstancedBufferAttribute(new Float32Array(ARROW_CAP * 4), 4);
  aS.setUsage(THREE.DynamicDrawUsage); aE.setUsage(THREE.DynamicDrawUsage);
  arrowGeo.setAttribute('aS', aS); arrowGeo.setAttribute('aE', aE);
  const arrows = new THREE.InstancedMesh(arrowGeo, mats.arrow, ARROW_CAP);
  arrows.count = 0; arrows.frustumCulled = false; arrows.visible = false;
  group.add(arrows);
  let arrowCursor = 0, arrowsUntil = 0, arrowLo = Infinity, arrowHi = -1;

  const selRing = makeRing(0xffd36a, 0.95, groundHeight);
  const hovRing = makeRing(0xfff4dc, 0.45, groundHeight);
  group.add(selRing.mesh, hovRing.mesh);

  const FACE = HEX_DIRS.map(([dq, dr]) => {
    const a = hexToWorld(0, 0), b = hexToWorld(dq, dr);
    return Math.atan2(b.x - a.x, b.z - a.z);
  });
  const forms = new Map();
  const active = new Set();
  let dying = [];
  let selId = null, hovId = null;
  let density = 1;
  const now = () => G.uTime.value;
  const emblemByPlayer = new Map();

  function emblemFor(playerId) {
    let ch = getPlayerEmblem ? getPlayerEmblem(playerId) : null;
    if (!ch) {
      if (!emblemByPlayer.has(playerId)) emblemByPlayer.set(playerId, DEFAULT_EMBLEMS[emblemByPlayer.size % DEFAULT_EMBLEMS.length]);
      ch = emblemByPlayer.get(playerId);
    }
    return glyphs.index(String(ch).charAt(0));
  }
  function specKey(u) {
    if (u.isGeneral || u.typeId === 'general') return 'general';
    if (SPECS[u.typeId]) return u.typeId;
    return CATEGORY_FALLBACK[u.category] || 'soldats';
  }
  function baseHeading(f) {
    const fc = ((f.u.facing ?? 0) % 6 + 6) % 6;
    return FACE[fc] + (f.u.isFleeing ? Math.PI : 0);
  }
  const wrapA = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  const gaitOf = (f) => (f.lungeGait != null ? f.lungeGait : f.moving ? (f.u.isFleeing ? 2 : 1) : 0);
  const glowOf = (f) => (f.id === selId ? 1 : f.id === hovId ? 0.45 : 0);

  // --- members ---
  function memberTarget(f, m, i) {
    const t = m.t;
    if (!f.u.isFleeing) { m.tx = t.lx; m.tz = t.lz; m.tyaw = t.yaw; return; }
    const r = rngFrom(hashStr(f.id + ':' + i));
    let x = t.lx * 1.55 + (r() - 0.5) * 0.4, z = t.lz * 1.35 + (r() - 0.5) * 0.4;
    const d = Math.hypot(x, z);
    if (d > 0.8) { x *= 0.8 / d; z *= 0.8 / d; }
    m.tx = x; m.tz = z; m.tyaw = t.yaw + (r() - 0.5) * 1.6;
  }
  function makeMember(f, i) {
    const t = f.tpls[i], rig = RIGS[t.rig];
    const m = { t, rig, parts: [], cloth: -1, blob: -1, phase: f.rnd() * TAU, dieT: 0, lx: 0, lz: 0, yaw: 0, tx: 0, tz: 0, tyaw: 0 };
    for (const p of rig.parts) {
      const pool = pools[p.pool];
      m.parts.push({ pool, slot: pool.alloc(), ox: p.ox, oy: p.oy, oz: p.oz, kit: t[p.kit] || 0, variant: p.coat != null ? (t.coats ? t.coats[p.coat] : 0) : 0, ph: p.ph || 0 });
    }
    if (t.cloth != null && rig.anchor) m.cloth = pools.cloth.alloc();
    m.blob = pools.blob.alloc();
    memberTarget(f, m, i);
    m.lx = m.tx; m.lz = m.tz; m.yaw = m.tyaw;
    writeMemberAttrs(f, m);
    return m;
  }
  function writeMemberAttrs(f, m) {
    const g = gaitOf(f), tc = f.team, glow = glowOf(f), des = f.desat;
    for (const p of m.parts) {
      p.pool.set('iA', p.slot, m.phase + p.ph, g, f.actT, f.hitT);
      p.pool.set('iB', p.slot, tc.r, tc.g, tc.b, m.dieT);
      p.pool.set('iC', p.slot, p.kit, des, glow, p.variant);
    }
    if (m.cloth >= 0) {
      pools.cloth.set('iA', m.cloth, m.phase, g, m.t.cloth, m.rig.bob);
      pools.cloth.set('iB', m.cloth, tc.r, tc.g, tc.b, m.dieT);
      pools.cloth.set('iC', m.cloth, f.glyph, des, glow, 0);
    }
    pools.blob.set('iB', m.blob, 0, 0, 0, m.dieT);
  }
  function writeMemberMatrix(f, m, bx, bz, h) {
    const ch = Math.cos(h), sh = Math.sin(h);
    let mx = bx + m.lx * ch + m.lz * sh, mz = bz - m.lx * sh + m.lz * ch;
    if (world.deckClamp && world.walkHeight(bx, bz) > world.groundHeight(bx, bz) + 0.05) {
      const c = world.deckClamp(mx, mz, 0.26); // crossing a bridge: the formation narrows onto the deck
      if (c) { mx = c.x; mz = c.z; }
    }
    const yaw = h + m.yaw, cy = Math.cos(yaw), sy = Math.sin(yaw), sc = m.t.sc || 1;
    let g0 = NaN;
    for (const p of m.parts) {
      const wx = mx + (p.ox * cy + p.oz * sy) * sc, wz = mz + (-p.ox * sy + p.oz * cy) * sc;
      const gy = p.ox === 0 && p.oz === 0 ? (Number.isNaN(g0) ? (g0 = groundHeight(mx, mz)) : g0) : groundHeight(wx, wz);
      p.pool.mat(p.slot, wx, gy + p.oy * sc, wz, yaw, sc);
    }
    if (Number.isNaN(g0)) g0 = groundHeight(mx, mz);
    if (m.cloth >= 0) {
      const [ax, ay, az] = m.rig.anchor;
      pools.cloth.mat(m.cloth, mx + (ax * cy + az * sy) * sc, g0 + ay * sc, mz + (-ax * sy + az * cy) * sc, yaw, sc);
    }
    const [boz, bsx, bsz] = BLOB[m.t.rig];
    pools.blob.mat(m.blob, mx + boz * sy * sc, g0, mz + boz * cy * sc, yaw, bsx * sc, 1, bsz * sc);
  }
  function releaseMember(m) {
    for (const p of m.parts) p.pool.release(p.slot);
    if (m.cloth >= 0) pools.cloth.release(m.cloth);
    pools.blob.release(m.blob);
    m.parts.length = 0; m.cloth = -1;
  }
  function killMember(f, m, at) {
    m.dieT = at;
    if (m.cloth >= 0) { pools.cloth.release(m.cloth); m.cloth = -1; }
    writeMemberAttrs(f, m);
    dying.push({ m, until: at + 3.0 });
  }

  // --- formations ---
  function writeFormation(f) {
    const bx = f.px + f.lungeX, bz = f.pz + f.lungeZ;
    for (const m of f.members) if (m) writeMemberMatrix(f, m, bx, bz, f.heading);
    if (f.id === selId) selRing.place(f.px, f.pz);
    if (f.id === hovId) hovRing.place(f.px, f.pz);
  }
  function writeFormationAttrs(f) { for (const m of f.members) if (m) writeMemberAttrs(f, m); }
  function setTeam(f) {
    const cs = getPlayerColor(f.u.playerId) || '#bbbbbb';
    if (cs === f.colorStr) return false;
    f.colorStr = cs;
    f.team.set(cs);
    return true;
  }
  function wantCount(f) {
    const u = f.u, n = f.tpls.length;
    const max = u.maxVitality > 0 ? u.maxVitality : 1;
    const ratio = Math.max(0, Math.min(1, (u.vitality ?? max) / max));
    return Math.max(1, Math.min(n, Math.ceil(n * ratio - 1e-6)));
  }
  function applyCount(f) {
    const want = wantCount(f), t = now();
    const recent = t - f.lastHit < 3.5;
    const base = Math.max(t, f.lastHit > t ? f.lastHit : t);
    for (let i = 0; i < f.tpls.length; i++) {
      const m = f.members[i];
      if (i < want && !m) f.members[i] = makeMember(f, i);
      else if (i >= want && m) {
        killMember(f, m, recent ? base + Math.random() * 0.35 : t + Math.random() * 0.3);
        f.members[i] = null;
      }
    }
  }
  function buildTemplates(f) {
    f.rnd = rngFrom(hashStr(String(f.id) + ':' + f.key));
    f.tpls = SPECS[f.key].make(f.rnd, density);
    f.members = new Array(f.tpls.length).fill(null);
  }
  function createFormation(u) {
    const key = specKey(u);
    const p = hexToWorld(u.q, u.r);
    const f = {
      id: u.id, u, key, spec: SPECS[key], tpls: [], members: [], rnd: null,
      hx: p.x, hz: p.z, px: p.x, pz: p.z, ov: null, heading: 0, tHeading: 0,
      moving: false, lungeGait: null, lunge: null, lungeX: 0, lungeZ: 0,
      actT: 0, hitT: 0, lastHit: -1e9, desat: 0, team: new THREE.Color(), colorStr: null,
      glyph: emblemFor(u.playerId), flee: !!u.isFleeing, relayout: false, dirty: true,
    };
    setTeam(f);
    f.desat = u.hasMoved && u.isMine ? 1 : 0;
    f.heading = f.tHeading = baseHeading(f);
    buildTemplates(f);
    applyCount(f);
    forms.set(u.id, f);
    active.add(f);
    return f;
  }
  function removeFormation(f, animate) {
    const t = now();
    for (const m of f.members) {
      if (!m) continue;
      if (animate) killMember(f, m, Math.max(t, f.lastHit) + Math.random() * 0.4);
      else releaseMember(m);
    }
    f.members = [];
    forms.delete(f.id);
    active.delete(f);
    if (selId === f.id) setSelected(null);
    if (hovId === f.id) setHovered(null);
  }
  function rebuildFormation(f) {
    for (const m of f.members) if (m) releaseMember(m);
    buildTemplates(f);
    applyCount(f);
    f.dirty = true;
    active.add(f);
  }

  function sync(units) {
    const seen = new Set();
    for (const u of units) {
      if (!u || u.q == null || u.r == null) continue;
      seen.add(u.id);
      let f = forms.get(u.id);
      if (!f) { createFormation(u); continue; }
      const prev = f.u;
      f.u = u;
      if (specKey(u) !== f.key || prev.playerId !== u.playerId) {
        f.key = specKey(u); f.spec = SPECS[f.key];
        f.glyph = emblemFor(u.playerId);
        setTeam(f);
        rebuildFormation(f);
        continue;
      }
      let attrs = setTeam(f);
      const p = hexToWorld(u.q, u.r);
      if (p.x !== f.hx || p.z !== f.hz) { f.hx = p.x; f.hz = p.z; active.add(f); }
      const flee = !!u.isFleeing;
      if (flee !== f.flee) {
        f.flee = flee;
        f.members.forEach((m, i) => { if (m) memberTarget(f, m, i); });
        f.relayout = true;
        attrs = true;
        active.add(f);
      }
      if (!f.ov && !f.lunge) {
        const bh = baseHeading(f);
        if (bh !== f.tHeading) { f.tHeading = bh; active.add(f); }
      }
      const des = u.hasMoved && u.isMine ? 1 : 0;
      if (des !== f.desat) { f.desat = des; attrs = true; }
      if (attrs) writeFormationAttrs(f);
      const before = f.members.map(Boolean).join();
      applyCount(f);
      if (f.members.map(Boolean).join() !== before) { f.dirty = true; active.add(f); }
    }
    for (const f of [...forms.values()]) if (!seen.has(f.id)) removeFormation(f, now() - f.lastHit < 4);
  }

  function stepFormation(f, dt) {
    let changed = f.dirty, busy = false;
    f.dirty = false;
    const tx = f.ov ? f.ov.x : f.hx, tz = f.ov ? f.ov.z : f.hz;
    if (f.px !== tx || f.pz !== tz) {
      if (f.ov) { f.px = tx; f.pz = tz; }
      else {
        const k = 1 - Math.exp(-dt * 9);
        f.px += (tx - f.px) * k; f.pz += (tz - f.pz) * k;
        if (Math.hypot(tx - f.px, tz - f.pz) < 0.003) { f.px = tx; f.pz = tz; } else busy = true;
      }
      changed = true;
    }
    const dh = wrapA(f.tHeading - f.heading);
    if (dh !== 0) {
      const step = Math.min(Math.abs(dh), Math.max(Math.abs(dh) * (1 - Math.exp(-dt * 6)), dt * 0.6));
      f.heading = Math.abs(dh) < 0.002 ? f.tHeading : f.heading + Math.sign(dh) * step;
      if (f.heading !== f.tHeading) busy = true;
      changed = true;
    }
    if (f.relayout) {
      const k = 1 - Math.exp(-dt * 3.5);
      let any = false;
      for (const m of f.members) {
        if (!m) continue;
        const ex = m.tx - m.lx, ez = m.tz - m.lz, ey = wrapA(m.tyaw - m.yaw);
        if (Math.abs(ex) + Math.abs(ez) + Math.abs(ey) < 0.002) { m.lx = m.tx; m.lz = m.tz; m.yaw = m.tyaw; continue; }
        m.lx += ex * k; m.lz += ez * k; m.yaw += ey * k;
        any = true;
      }
      f.relayout = any;
      busy = busy || any;
      changed = true;
    }
    if (f.lunge) {
      const L = f.lunge, e = now() - L.t0;
      let d, stage;
      if (e < 0.35) { const x = e / 0.35; d = 1 - (1 - x) * (1 - x); stage = 0; }
      else if (e < 1.15) { d = 1 + 0.06 * Math.sin((e - 0.35) * 14); stage = 1; }
      else if (e < 1.65) { const x = (e - 1.15) / 0.5; d = 1 - x * x * (3 - 2 * x); stage = 2; }
      else { d = 0; stage = 3; }
      f.lungeX = L.dx * d; f.lungeZ = L.dz * d;
      if (stage !== L.stage) {
        L.stage = stage;
        f.lungeGait = stage === 0 ? 2 : stage === 2 ? 1 : stage === 1 ? 0 : null;
        if (stage === 3) { f.lunge = null; f.tHeading = f.ov ? f.tHeading : baseHeading(f); }
        writeFormationAttrs(f);
      }
      busy = true;
      changed = true;
    }
    if (changed) writeFormation(f);
    return busy;
  }

  function update(dt) {
    const t = now();
    for (const f of active) if (!stepFormation(f, dt)) active.delete(f);
    if (dying.length && dying[0] !== undefined) {
      let keep = null;
      for (const d of dying) {
        if (t >= d.until) releaseMember(d.m);
        else (keep || (keep = [])).push(d);
      }
      if (!keep || keep.length !== dying.length) dying = keep || [];
    }
    if (arrows.visible && t > arrowsUntil) { arrows.visible = false; arrows.count = 0; arrowCursor = 0; }
    if (!group.visible) return;
    if (arrowHi >= arrowLo) {
      upload(aS, arrowLo * 4, (arrowHi - arrowLo + 1) * 4);
      upload(aE, arrowLo * 4, (arrowHi - arrowLo + 1) * 4);
      arrowLo = Infinity; arrowHi = -1;
    }
    if (selRing.mesh.visible) selRing.mesh.material.opacity = selRing.baseAlpha * (0.75 + 0.25 * Math.sin(t * 4));
    for (const p of Object.values(pools)) p.flush();
  }

  // --- public API ---
  function setDisplayPosition(id, x, z, heading = null) {
    const f = forms.get(id);
    if (!f) return;
    if (x == null || z == null) { clearDisplayPosition(id); return; }
    const prev = f.ov || { x: f.px, z: f.pz };
    if (heading != null) f.tHeading = heading;
    else if (Math.hypot(x - prev.x, z - prev.z) > 1e-3) f.tHeading = Math.atan2(x - prev.x, z - prev.z);
    f.ov = { x, z };
    active.add(f);
  }
  function clearDisplayPosition(id) {
    const f = forms.get(id);
    if (!f || !f.ov) return;
    f.ov = null;
    if (!f.lunge) f.tHeading = baseHeading(f);
    active.add(f);
  }
  function setMoving(id, on) {
    const f = forms.get(id);
    if (!f || f.moving === !!on) return;
    f.moving = !!on;
    writeFormationAttrs(f);
  }
  function memberWorld(f, m, out) {
    const h = f.heading, ch = Math.cos(h), sh = Math.sin(h);
    const bx = f.px + f.lungeX, bz = f.pz + f.lungeZ;
    out.x = bx + m.lx * ch + m.lz * sh; out.z = bz - m.lx * sh + m.lz * ch;
    out.y = groundHeight(out.x, out.z);
    return out;
  }
  function spawnArrow(sx, sy, sz, ex, ey, ez, t0, dur) {
    const i = arrowCursor;
    arrowCursor = (arrowCursor + 1) % ARROW_CAP;
    aS.array.set([sx, sy, sz, t0], i * 4);
    aE.array.set([ex, ey, ez, dur], i * 4);
    if (i < arrowLo) arrowLo = i;
    if (i > arrowHi) arrowHi = i;
    arrows.count = Math.max(arrows.count, i + 1);
    arrowsUntil = Math.max(arrowsUntil, t0 + dur * 1.85);
    arrows.visible = true;
  }
  function playAttack(attId, tgtId, { ranged = false } = {}) {
    const a = forms.get(attId), b = forms.get(tgtId);
    if (!a) return 0;
    const t = now();
    const tx = b ? b.px : a.px + Math.sin(a.heading) * 1.7, tz = b ? b.pz : a.pz + Math.cos(a.heading) * 1.7;
    const dx = tx - a.px, dz = tz - a.pz, dist = Math.hypot(dx, dz) || 1;
    if (!a.ov) a.tHeading = Math.atan2(dx, dz);
    active.add(a);
    if (!ranged) {
      const reach = Math.min(0.62, dist * 0.36);
      a.lunge = { t0: t, dx: (dx / dist) * reach, dz: (dz / dist) * reach, stage: -1 };
      a.actT = t + 0.3;
      writeFormationAttrs(a);
      return 0.45;
    }
    a.actT = t;
    writeFormationAttrs(a);
    const p = new THREE.Vector3();
    let latest = 0, sum = 0, n = 0;
    for (const m of a.members) {
      if (!m) continue;
      memberWorld(a, m, p);
      const shots = m.t.rig === 'foot' || m.t.rig === 'footB' ? 2 : m.t.rig === 'chariot' ? 3 : 2;
      for (let k = 0; k < shots; k++) {
        const ang = Math.random() * TAU, rr = Math.sqrt(Math.random()) * 0.5;
        const ex = tx + Math.cos(ang) * rr, ez = tz + Math.sin(ang) * rr;
        const t0 = t + 0.3 + Math.random() * 0.35;
        const dur = 0.7 + dist * 0.07;
        spawnArrow(p.x, p.y + 0.22, p.z, ex, groundHeight(ex, ez) + 0.02, ez, t0, dur);
        latest = Math.max(latest, t0 + dur); sum += t0 + dur; n++;
      }
    }
    return n ? (sum / n) - t : 0;
  }
  function playHit(id, { delay = 0 } = {}) {
    const f = forms.get(id);
    if (!f) return;
    f.hitT = now() + delay;
    f.lastHit = f.hitT;
    writeFormationAttrs(f);
  }
  function setSelected(id) {
    const prev = forms.get(selId);
    selId = id;
    if (prev) writeFormationAttrs(prev);
    const f = forms.get(id);
    if (f) { writeFormationAttrs(f); selRing.place(f.px, f.pz); }
    selRing.mesh.visible = !!f;
  }
  function setHovered(id) {
    if (id === hovId) return;
    const prev = forms.get(hovId);
    hovId = id;
    if (prev) writeFormationAttrs(prev);
    const f = forms.get(id);
    if (f) { writeFormationAttrs(f); hovRing.place(f.px, f.pz); }
    hovRing.mesh.visible = !!f && id !== selId;
  }
  function getAnchor(id, out = new THREE.Vector3()) {
    const f = forms.get(id);
    if (!f) return null;
    const x = f.px + f.lungeX, z = f.pz + f.lungeZ;
    return out.set(x, groundHeight(x, z) + f.spec.anchorH, z);
  }

  function onQuality(level) {
    const d = level && level.grass === false ? 0.6 : 1;
    if (d === density) return;
    density = d;
    for (const f of forms.values()) rebuildFormation(f);
  }
  const startLevel = world.LEVELS && world.governor ? world.LEVELS[world.governor.level] : null;
  if (startLevel && startLevel.grass === false) density = 0.6;
  if (world.qualityHooks) world.qualityHooks.push(onQuality);
  if (autoUpdate && world.frameHooks) world.frameHooks.push(update);

  function stats() {
    const inst = {};
    let total = 0;
    for (const [k, p] of Object.entries(pools)) { inst[k] = p.live; total += p.live; }
    return { formations: forms.size, instances: inst, total, arrows: arrows.visible ? arrows.count : 0 };
  }

  function dispose() {
    const rm = (arr, fn) => { const i = arr ? arr.indexOf(fn) : -1; if (i >= 0) arr.splice(i, 1); };
    rm(world.frameHooks, update);
    rm(world.qualityHooks, onQuality);
    scene.remove(group);
    for (const p of Object.values(pools)) { p.geo.dispose(); p.mesh.dispose(); }
    arrowGeo.dispose(); arrows.dispose();
    for (const r of [selRing, hovRing]) { r.mesh.geometry.dispose(); r.mesh.material.dispose(); }
    for (const m of Object.values(mats)) m.dispose();
    glyphs.tex.dispose();
    forms.clear(); active.clear(); dying = [];
  }

  return {
    group, pools, sync, update, setDisplayPosition, clearDisplayPosition, setMoving, playAttack, playHit,
    setSelected, setHovered, getAnchor, stats, dispose,
    get formations() { return forms; },
  };
}
