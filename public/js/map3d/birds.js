import * as THREE from 'three';

// Birds: boids with topological neighbours (the ~7 nearest of the same species, found through a spatial hash),
// banking into turns, terrain / wall look-ahead, a preferred height above the ground, flapping or gliding from
// speed and climb, flocks that split and merge, starling murmurations with waves of startle running through them,
// raptors soaring in thermals, perching on walls, roofs, trees, fields and summits, panic take-offs that spread
// through the flock when troops or the camera come near, and roosting at night.
// createBirds({ scene, G, bounds, groundHeight, surfaceHeight?, perches: [{ x, y, z, kind? }], camera })
//   -> { mesh, update(dt), setThreats([{ x, z }]), setNight(n), setQuality(level) }
// kind: 'wall' | 'roof' | 'tree' | 'field' | 'summit' (default 'summit')

// Wing hinges, in units where the wingspan is 1 (x from -0.5 to 0.5): root at |x| = 0.045, wrist at |x| = 0.22.
function birdGeometry({ body = 0.46, chord = 0.17, tip = 0.04, fingers = 0, tail = 0.16, head = 1 } = {}) {
  const P = [], S = [], C = [];
  const tri = (a, b, c, seg, col) => { P.push(...a, ...b, ...c); S.push(seg, seg, seg); for (let i = 0; i < 3; i++) C.push(col[i % col.length][0], col[i % col.length][1], col[i % col.length][2]); };
  const quad = (a, b, c, d, seg, ca, cb = ca) => { tri(a, b, c, seg, [ca, cb, cb]); tri(a, c, d, seg, [ca, cb, ca]); };
  const L = body;
  const top = [0.85, 0.85, 0.85], side = [1.05, 1.02, 0.98], belly = [1.55, 1.45, 1.3], beak = [1.9, 1.5, 0.7], dark = [0.6, 0.6, 0.62];
  const nose = [0, 0.004, 0.5 * L + 0.035 * head], beakBase = [0, 0.012, 0.5 * L];
  const crown = [0, 0.038 * head, 0.38 * L], chinL = [-0.026 * head, 0.0, 0.4 * L], chinR = [0.026 * head, 0.0, 0.4 * L];
  const back = [0, 0.045, 0.05 * L], shL = [-0.045, 0.012, 0.12 * L], shR = [0.045, 0.012, 0.12 * L];
  const bel = [0, -0.04, 0.02 * L], hipL = [-0.03, 0.008, -0.22 * L], hipR = [0.03, 0.008, -0.22 * L], rump = [0, 0.014, -0.3 * L];
  // head + beak
  tri(nose, chinL, beakBase, 0, [beak]); tri(nose, beakBase, chinR, 0, [beak]); tri(nose, chinR, chinL, 0, [beak]);
  tri(beakBase, chinL, crown, 0, [top, side, top]); tri(beakBase, crown, chinR, 0, [top, top, side]);
  tri(crown, chinL, shL, 0, [top, side, side]); tri(crown, shR, chinR, 0, [top, side, side]); tri(crown, shL, back, 0, [top, side, top]); tri(crown, back, shR, 0, [top, top, side]);
  tri(chinL, chinR, bel, 0, [belly]); tri(chinL, bel, shL, 0, [belly, belly, side]); tri(chinR, shR, bel, 0, [belly, side, belly]);
  // body
  tri(back, shL, hipL, 0, [top, side, side]); tri(back, hipR, shR, 0, [top, side, side]); tri(back, hipL, rump, 0, [top, side, top]); tri(back, rump, hipR, 0, [top, top, side]);
  tri(bel, hipL, shL, 0, [belly, side, side]); tri(bel, shR, hipR, 0, [belly, side, side]); tri(bel, rump, hipL, 0, [belly, side, side]); tri(bel, hipR, rump, 0, [belly, side, side]);
  // tail fan
  const tw = tail * 0.55, tl = -0.3 * L - tail;
  tri(rump, [-tw, 0.012, tl], [tw, 0.012, tl], 0, [top, dark, dark]);
  tri(rump, [tw, 0.008, tl], [-tw, 0.008, tl], 0, [belly, side, side]);
  // wings: inner panel (root -> wrist, segment 1), outer hand (wrist -> tip, segment 2)
  for (const s of [-1, 1]) {
    const y = 0.012;
    const rf = [0.045 * s, y, 0.14 * L], rb = [0.045 * s, y, 0.14 * L - chord];
    const jf = [0.22 * s, y, 0.12 * L + 0.01], jb = [0.22 * s, y, 0.12 * L - chord * 1.02];
    quad(rf, jf, jb, rb, 1, side, top);
    if (fingers) {
      // broad hand ending in slotted primaries (raptor)
      const hf = [0.4 * s, y, 0.1 * L - 0.01], hb = [0.4 * s, y, 0.1 * L - chord * 0.95];
      quad(jf, hf, hb, jb, 2, side, top);
      for (let i = 0; i < fingers; i++) {
        const t0 = i / fingers, t1 = (i + 0.7) / fingers;
        const a = [0.4 * s, y, hf[2] - (hf[2] - hb[2]) * t0], b = [0.4 * s, y, hf[2] - (hf[2] - hb[2]) * t1];
        tri(a, [0.5 * s, y, (a[2] + b[2]) / 2 - 0.02 - i * 0.012], b, 2, [top, dark, top]);
      }
    } else {
      // pointed hand (starling, sparrow, crow)
      const tf = [0.5 * s, y, 0.02 * L - 0.05], tb = [0.47 * s, y, 0.02 * L - 0.05 - tip];
      quad(jf, tf, tb, jb, 2, side, dark);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aSeg', new THREE.Float32BufferAttribute(S, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  return g;
}

// aFlap: x = wing-beat phase (radians, advanced on the CPU), y = spread (-1 folded, 0 gliding, 1 flapping), z = hand flex
function birdMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSeg;\nattribute vec3 aFlap;')
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        if ( aSeg > 0.5 && aFlap.y >= 0.0 ) {
          float fl = sin( aFlap.x ) * aFlap.y;
          float ang = ( 0.12 + fl * 0.75 ) * ( position.x < 0.0 ? 1.0 : -1.0 );
          objectNormal = vec3( objectNormal.x * cos( ang ) - objectNormal.y * sin( ang ), objectNormal.x * sin( ang ) + objectNormal.y * cos( ang ), objectNormal.z );
        }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float side = position.x < 0.0 ? -1.0 : 1.0;
          float d = abs( position.x );
          float amt = aFlap.y;
          float ph = aFlap.x;
          if ( amt < 0.0 ) {
            // folded along the back (perched, or the closed-wing dip of a bounding finch)
            if ( aSeg > 0.5 ) {
              float rr = d - 0.045;
              transformed.x = side * ( 0.045 + rr * 0.06 );
              transformed.y = position.y + 0.018 + rr * 0.04;
              transformed.z = position.z - rr * 0.62;
            }
          } else {
            float flap = sin( ph );
            float lag = sin( ph - 0.9 );
            float th1 = mix( 0.12, 0.15 + flap * 0.95, amt );
            float th2 = th1 + mix( 0.05 + aFlap.z * 0.12, lag * 0.55 * (1.0 + aFlap.z) + 0.08, amt );
            // downstroke: hand sweeps forward a little, upstroke: wrist flexes the hand back
            float sweep = mix( 0.0, ( cos( ph ) * 0.06 ), amt );
            if ( aSeg > 0.5 && aSeg < 1.5 ) {
              float rr = d - 0.045;
              transformed.x = side * ( 0.045 + rr * cos( th1 ) );
              transformed.y = position.y + rr * sin( th1 );
            } else if ( aSeg > 1.5 ) {
              float jx = 0.045 + 0.175 * cos( th1 ), jy = 0.175 * sin( th1 );
              float rr = d - 0.22;
              float fold = mix( 1.0, 0.72 + 0.28 * max( 0.0, -cos( ph ) ), amt );
              transformed.x = side * ( jx + rr * fold * cos( th2 ) );
              transformed.y = position.y + jy + rr * fold * sin( th2 );
              transformed.z += sweep * rr * 4.0 - ( 1.0 - fold ) * rr * 0.5;
            }
            transformed.y -= flap * 0.03 * amt;
          }
        }`);
  };
  mat.customProgramCacheKey = () => 'kb-birds-2';
  return mat;
}

// span: world units (soldiers are 0.3 tall). speed: cruise range. alt: preferred height above the ground.
const SPECIES = {
  starling: { id: 0, span: 0.13, color: 0x463e3a, speed: [2.2, 3.4], alt: [4.5, 8.5], R: 1.0, sep: 0.2, k: 7, flap: 17, wAli: 1.7, wCoh: 0.9, wSep: 1.1, wGoal: 0.55, scare: 3.2, clear: 2.6, kinds: ['tree', 'roof', 'wall', 'field'], land: 0.22, geo: 'small', maxFlock: 999 },
  sparrow: { id: 1, span: 0.1, color: 0x8a6c4e, speed: [1.6, 2.4], alt: [1.8, 3.4], R: 0.85, sep: 0.17, k: 6, flap: 21, wAli: 1.2, wCoh: 0.7, wSep: 1.2, wGoal: 0.7, scare: 2.4, clear: 2.3, kinds: ['tree', 'roof', 'field', 'wall'], land: 0.6, bounding: true, geo: 'small', maxFlock: 36 },
  crow: { id: 2, span: 0.24, color: 0x34343c, speed: [1.5, 2.3], alt: [3, 6], R: 2.0, sep: 0.45, k: 6, flap: 7, wAli: 0.9, wCoh: 0.45, wSep: 1.0, wGoal: 0.7, scare: 3.6, clear: 2.4, kinds: ['wall', 'summit', 'field', 'tree', 'roof'], land: 0.5, geo: 'small', maxFlock: 20 },
  raptor: { id: 3, span: 0.46, color: 0x5d4734, speed: [1.4, 1.9], alt: [8, 12], flap: 4, scare: 5, clear: 4, kinds: ['summit', 'wall', 'tree'], land: 0.12, soar: true, geo: 'raptor', maxFlock: 1 },
};
const SPECIES_LIST = Object.values(SPECIES);
// flocks per quality rank (0 = best): [species, size, minRank-to-hide]
const FLOCKS = [
  { sp: 'starling', n: 110, tiers: [110, 110, 70, 40, 0] },
  { sp: 'sparrow', n: 16, tiers: [16, 16, 14, 12, 10] },
  { sp: 'sparrow', n: 14, tiers: [14, 14, 12, 10, 0] },
  { sp: 'sparrow', n: 12, tiers: [12, 12, 10, 0, 0] },
  { sp: 'sparrow', n: 12, tiers: [12, 12, 0, 0, 0] },
  { sp: 'crow', n: 9, tiers: [9, 9, 7, 7, 6] },
  { sp: 'crow', n: 8, tiers: [8, 8, 6, 0, 0] },
  { sp: 'raptor', n: 1, tiers: [1, 1, 1, 1, 1] },
  { sp: 'raptor', n: 1, tiers: [1, 1, 1, 1, 0] },
  { sp: 'raptor', n: 1, tiers: [1, 1, 0, 0, 0] },
];
const SLOT_CAP = { tree: 2, roof: 2, wall: 6, field: 10, summit: 6 };
const SLOT_R = { tree: 0.05, roof: 0.06, wall: 0.35, field: 0.7, summit: 0.5 };

export function createBirds({ scene, G, bounds, groundHeight, surfaceHeight = null, perches = [], camera = null }) {
  const surf = surfaceHeight || groundHeight;
  const { bx0, bx1, bz0, bz1 } = bounds;
  const span = { x0: bx0 - 6, x1: bx1 + 6, z0: bz0 - 6, z1: bz1 + 6 };
  const rnd = Math.random;
  const rr = (a, b) => a + (b - a) * rnd();

  // --- meshes: one for small birds (starlings, sparrows, crows), one for raptors ---
  const meshes = {};
  for (const [key, opts] of [['small', {}], ['raptor', { body: 0.42, chord: 0.24, fingers: 4, tail: 0.17, head: 1.2 }]]) {
    const n = FLOCKS.filter((f) => SPECIES[f.sp].geo === key).reduce((a, f) => a + f.n, 0);
    const geo = birdGeometry(opts);
    const flap = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    flap.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFlap', flap);
    const mesh = new THREE.InstancedMesh(geo, birdMaterial(), n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    meshes[key] = { mesh, flap, next: 0 };
  }
  const root = new THREE.Group();
  root.add(meshes.small.mesh, meshes.raptor.mesh);
  scene.add(root);

  // --- perches, indexed by kind ---
  const sites = perches.map((p) => ({ x: p.x, y: p.y ?? groundHeight(p.x, p.z), z: p.z, kind: p.kind || 'summit', occ: 0 }));
  const byKind = {};
  for (const s of sites) (byKind[s.kind] ||= []).push(s);

  // --- birds and flocks ---
  const birds = [];
  const flocks = [];
  const randomPoint = (cx, cz, radius) => {
    const x = Math.min(span.x1, Math.max(span.x0, cx == null ? rr(span.x0, span.x1) : cx + rr(-radius, radius)));
    const z = Math.min(span.z1, Math.max(span.z0, cz == null ? rr(span.z0, span.z1) : cz + rr(-radius, radius)));
    return { x, z };
  };
  function newFlock(sp, x, z) {
    const f = { sp, members: [], mode: 'fly', alt: rr(sp.alt[0], sp.alt[1]), goal: { x, y: 0, z }, timer: rr(12, 30), anchor: null, roost: false, murmur: 0, splitT: rr(40, 90),
      thermal: sp.soar ? { cx: x, cz: z, r: rr(3.5, 7), dir: rnd() < 0.5 ? 1 : -1, alt: rr(sp.alt[0], sp.alt[1]) } : null, startleT: rr(2, 6) };
    flocks.push(f);
    return f;
  }
  FLOCKS.forEach((def) => {
    const sp = SPECIES[def.sp];
    const c = randomPoint();
    const flock = newFlock(sp, c.x, c.z);
    pickGoal(flock);
    const mk = meshes[sp.geo];
    for (let i = 0; i < def.n; i++) {
      const x = c.x + rr(-2, 2), z = c.z + rr(-2, 2);
      const y = groundHeight(x, z) + rr(sp.alt[0], sp.alt[1]);
      const a = rnd() * 6.28, v = rr(sp.speed[0], sp.speed[1]);
      const b = {
        sp, flock, def, rank: i, mesh: mk, slot: mk.next++, active: true,
        px: x, py: y, pz: z, vx: Math.sin(a) * v, vy: 0, vz: Math.cos(a) * v,
        mode: 'fly', spot: null, site: null, takeoffAt: 0,
        cruise: v, altJ: rr(-0.35, 0.35), scale: sp.span * rr(0.9, 1.12),
        phase: rnd() * 6.28, spread: 1, flapPow: 1, bank: 0, pitch: 0, yaw: a, yawRate: 0,
        floor: 0, floorAhead: 0, turnBias: 0, startle: 0, sdx: 0, sdy: 0, sdz: 0, startleCd: 0,
        bound: rnd() * 0.6, idle: rr(1, 5), hopT: 0, hopFrom: null, hopTo: null, bob: 0,
      };
      flock.members.push(b);
      birds.push(b);
    }
  });
  for (const k of ['small', 'raptor']) {
    const c = new THREE.Color();
    for (const b of birds) if (b.mesh === meshes[k]) {
      c.set(b.sp.color).multiplyScalar(rr(0.85, 1.15));
      meshes[k].mesh.setColorAt(b.slot, c);
    }
    meshes[k].mesh.instanceColor.needsUpdate = true;
  }

  function pickGoal(f) {
    const c = flockCenter(f);
    const sp = f.sp;
    let p;
    if (sp === SPECIES.sparrow) p = randomPoint(c.x, c.z, 14);
    else if (sp === SPECIES.starling && f.murmur > 0) p = randomPoint(f.goal.x, f.goal.z, 3);
    else p = randomPoint(c.x, c.z, 40);
    f.goal.x = p.x; f.goal.z = p.z;
    f.alt = rr(sp.alt[0], sp.alt[1]);
    f.timer = sp === SPECIES.sparrow ? rr(8, 20) : rr(14, 34);
  }
  function flockCenter(f) {
    let x = 0, y = 0, z = 0, n = 0;
    for (const b of f.members) if (b.active) { x += b.px; y += b.py; z += b.pz; n++; }
    if (!n) return { x: f.goal.x, y: f.goal.y, z: f.goal.z, n: 0 };
    return { x: x / n, y: y / n, z: z / n, n };
  }

  // --- threats (unit positions) and the camera ---
  let threats = [];
  function setThreats(points) { threats = Array.isArray(points) ? points : []; }
  function nearestThreat(x, y, z, radius) {
    let best = null, bd = radius;
    for (const t of threats) { const d = Math.hypot(t.x - x, t.z - z); if (d < bd) { bd = d; best = { x: t.x, z: t.z, d }; } }
    if (camera) {
      const cp = camera.position, d = Math.hypot(cp.x - x, cp.y - y, cp.z - z);
      if (d < radius * 1.15 && d < bd + 0.01) best = { x: cp.x, z: cp.z, d };
    }
    return best;
  }

  // --- perching ---
  function freeSlots(site, sp) {
    const cap = site.kind === 'tree' || site.kind === 'roof' ? (sp === SPECIES.crow ? 1 : SLOT_CAP[site.kind]) : SLOT_CAP[site.kind];
    return Math.max(0, cap - site.occ);
  }
  function chooseAnchor(f, kinds) {
    const c = flockCenter(f);
    let best = null, bs = Infinity;
    for (let tries = 0; tries < 18; tries++) {
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      const list = byKind[kind];
      if (!list || !list.length) continue;
      const s = list[Math.floor(rnd() * list.length)];
      if (freeSlots(s, f.sp) <= 0) continue;
      if (nearestThreat(s.x, s.y, s.z, f.sp.scare * 1.6)) continue;
      const d = Math.hypot(s.x - c.x, s.z - c.z) + (f.roost && kind !== 'tree' && kind !== 'roof' ? 20 : 0);
      if (d < bs) { bs = d; best = s; }
    }
    return best;
  }
  function landFlock(f, roost = false) {
    const kinds = roost && f.sp !== SPECIES.raptor ? ['tree', 'roof', ...f.sp.kinds.filter((k) => k !== 'tree' && k !== 'roof').slice(0, 1)] : f.sp.kinds;
    f.roost = roost;
    const anchor = chooseAnchor(f, kinds);
    if (!anchor) return false;
    // the anchor's neighbourhood: nearby perches of the allowed kinds, nearest first
    const near = [];
    for (const k of kinds) for (const s of byKind[k] || []) {
      const d = Math.hypot(s.x - anchor.x, s.z - anchor.z);
      if (d < 3.5 && freeSlots(s, f.sp) > 0) near.push({ s, d });
    }
    near.sort((a, b) => a.d - b.d);
    let i = 0;
    const members = f.members.filter((b) => b.active);
    for (const { s } of near) {
      let free = freeSlots(s, f.sp);
      while (free-- > 0 && i < members.length) {
        const b = members[i++], a = rnd() * 6.28, r = SLOT_R[s.kind] * Math.sqrt(rnd());
        const x = s.x + Math.cos(a) * r, z = s.z + Math.sin(a) * r;
        const y = s.kind === 'tree' || s.kind === 'roof' ? s.y - 0.02 : s.kind === 'wall' ? surf(x, z) : groundHeight(x, z);
        b.spot = { x, y: y + 0.006, z };
        b.site = s;
        s.occ++;
        b.mode = 'land';
      }
      if (i >= members.length) break;
    }
    // the rest feed on the ground around the anchor
    while (i < members.length) {
      const b = members[i++], a = rnd() * 6.28, r = 0.4 + rnd() * 1.1;
      const x = anchor.x + Math.cos(a) * r, z = anchor.z + Math.sin(a) * r;
      b.spot = { x, y: surf(x, z) + 0.006, z };
      b.site = null;
      b.mode = 'land';
    }
    f.mode = 'landing';
    f.anchor = anchor;
    f.timer = roost ? 1e9 : rr(12, 40);
    return true;
  }
  function takeOff(f, threat, now) {
    f.mode = 'fly';
    f.roost = false;
    const members = f.members.filter((b) => b.active && (b.mode === 'perch' || b.mode === 'land'));
    // panic spreads from the bird nearest to the threat
    let first = members[0];
    if (threat) { let bd = Infinity; for (const b of members) { const d = Math.hypot(b.px - threat.x, b.pz - threat.z); if (d < bd) { bd = d; first = b; } } }
    for (const b of members) {
      const d = first ? Math.hypot(b.px - first.px, b.pz - first.pz) : 0;
      b.flee = threat ? { x: threat.x, z: threat.z } : null;
      if (b.mode === 'land') { launch(b); continue; }
      b.takeoffAt = now + (threat ? d * 0.16 + rnd() * 0.12 : rnd() * 2.5);
    }
    if (!threat) f.roostDone = false;
    f.pendingTakeoff = true;
    const away = threat ? { x: f.anchor.x - threat.x, z: f.anchor.z - threat.z } : { x: rnd() - 0.5, z: rnd() - 0.5 };
    const l = Math.hypot(away.x, away.z) || 1;
    const p = randomPoint(f.anchor.x + (away.x / l) * 18, f.anchor.z + (away.z / l) * 18, 6);
    f.goal.x = p.x; f.goal.z = p.z;
    f.timer = rr(12, 30);
    f.anchor = null;
  }
  function launch(b) {
    if (b.site) { b.site.occ = Math.max(0, b.site.occ - 1); b.site = null; }
    b.spot = null;
    b.mode = 'fly';
    let ax = rnd() - 0.5, az = rnd() - 0.5;
    if (b.flee) { ax = b.px - b.flee.x; az = b.pz - b.flee.z; }
    const l = Math.hypot(ax, az) || 1;
    const v = b.flee ? b.sp.speed[1] * 1.15 : b.sp.speed[0];
    b.vx = (ax / l) * v * 0.8; b.vz = (az / l) * v * 0.8; b.vy = v * 0.75;
    b.flapPow = 1;
    b.flee = null;
  }

  // --- flock dynamics: split, merge ---
  function splitFlock(f) {
    const members = f.members.filter((b) => b.active && b.mode === 'fly');
    if (members.length < 10) return;
    const c = flockCenter(f), a = rnd() * 6.28, nx = Math.cos(a), nz = Math.sin(a);
    const g = newFlock(f.sp, c.x, c.z);
    g.members = f.members.filter((b) => (b.px - c.x) * nx + (b.pz - c.z) * nz > 0);
    if (g.members.length < 4 || g.members.length > f.members.length - 4) { flocks.pop(); return; }
    f.members = f.members.filter((b) => !g.members.includes(b));
    for (const b of g.members) b.flock = g;
    const p = randomPoint(c.x + nx * 25, c.z + nz * 25, 8);
    g.goal.x = p.x; g.goal.z = p.z;
    const q = randomPoint(c.x - nx * 20, c.z - nz * 20, 8);
    f.goal.x = q.x; f.goal.z = q.z;
  }
  function mergeFlocks() {
    for (let i = 0; i < flocks.length; i++) {
      const a = flocks[i];
      if (a.mode !== 'fly' || a.sp.soar) continue;
      const ca = flockCenter(a);
      for (let j = i + 1; j < flocks.length; j++) {
        const b = flocks[j];
        if (b.sp !== a.sp || b.mode !== 'fly' || a.members.length + b.members.length > a.sp.maxFlock) continue;
        const cb = flockCenter(b);
        if (Math.hypot(ca.x - cb.x, ca.y - cb.y, ca.z - cb.z) > (a.sp === SPECIES.starling ? 5 : 3)) continue;
        const [big, small] = a.members.length >= b.members.length ? [a, b] : [b, a];
        for (const m of small.members) { m.flock = big; big.members.push(m); }
        small.members = [];
      }
    }
    for (let i = flocks.length - 1; i >= 0; i--) if (!flocks[i].members.length) flocks.splice(i, 1);
  }

  // --- spatial hash for topological neighbours ---
  const CELL = 1.1;
  const grid = new Map();
  const pool = [];
  let used = [];
  const keyOf = (sid, ix, iy, iz) => (((ix + 2048) * 4096 + (iz + 2048)) * 256 + (iy + 128)) * 4 + sid;
  function buildGrid() {
    for (const arr of used) { arr.length = 0; pool.push(arr); }
    used = [];
    grid.clear();
    for (const b of birds) {
      if (!b.active || b.mode !== 'fly' || b.sp.soar) continue;
      const cs = b.sp.R > 1.5 ? CELL * 2 : CELL;
      const k = keyOf(b.sp.id, Math.floor(b.px / cs), Math.floor(b.py / cs), Math.floor(b.pz / cs));
      let arr = grid.get(k);
      if (!arr) { arr = pool.pop() || []; grid.set(k, arr); used.push(arr); }
      arr.push(b);
    }
  }
  const nb = new Array(8), nd = new Float64Array(8);

  // --- night, quality ---
  let night = 0, rankQ = 0, clock = 0, mergeT = 2, threatT = 0, frame = 0;
  function setNight(n) { night = n; }
  function setQuality(level) {
    const r = typeof level === 'number' ? level : ['Ultra', 'High', 'Medium', 'Low', 'Minimum'].indexOf(level && level.name);
    rankQ = Math.max(0, Math.min(4, r < 0 ? 0 : r));
    for (const b of birds) {
      const on = b.rank < b.def.tiers[rankQ];
      if (on === b.active) continue;
      b.active = on;
      if (!on && b.site) { b.site.occ = Math.max(0, b.site.occ - 1); b.site = null; }
      if (on && b.mode !== 'fly') { b.mode = 'fly'; b.spot = null; }
    }
  }

  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, 'YXZ'), P = new THREE.Vector3(), SC = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const wrap = (a) => (a > Math.PI ? a - Math.PI * 2 : a < -Math.PI ? a + Math.PI * 2 : a);

  function flockLogic(dt) {
    const dusk = night > 0.32, dawn = night < 0.2;
    for (const f of flocks) {
      f.timer -= dt;
      const sp = f.sp;
      if (f.pendingTakeoff) {
        if (f.members.every((b) => !b.active || b.mode === 'fly')) f.pendingTakeoff = false;
        continue;
      }
      if (f.mode === 'fly' && sp.soar) {
        if (dusk && night > 0.4) { if (landFlock(f, true)) continue; }
        if (f.timer <= 0) {
          f.timer = rr(25, 55);
          if (!(rnd() < sp.land && landFlock(f))) {
            const th = f.thermal, p = randomPoint(th.cx, th.cz, 30);
            th.cx = p.x; th.cz = p.z; th.r = rr(3.5, 7); th.alt = rr(sp.alt[0], sp.alt[1]); th.dir = rnd() < 0.5 ? 1 : -1;
          }
        }
        continue;
      }
      if (f.mode === 'fly') {
        const c = flockCenter(f);
        if (!c.n) continue;
        // dusk: starlings murmurate over their roost, then everyone (but raptors) settles in for the night
        if (dusk && !sp.soar) {
          if (sp === SPECIES.starling && f.murmur <= 0 && !f.roostDone) { f.murmur = rr(25, 45); const s = chooseAnchor(f, ['tree', 'roof']); if (s) { f.goal.x = s.x; f.goal.z = s.z; } f.roostDone = true; }
          if (f.murmur <= 0 || night > 0.55) { if (landFlock(f, true)) continue; }
        }
        if (f.murmur > 0) { f.murmur -= dt; if (f.murmur <= 0 && !dusk) pickGoal(f); continue; }
        const dg = Math.hypot(c.x - f.goal.x, c.z - f.goal.z);
        if (dg < (sp === SPECIES.starling ? 6 : 4) || f.timer <= 0) {
          const roll = rnd();
          if (sp === SPECIES.starling && roll < 0.35) { f.murmur = rr(20, 40); f.timer = 40; }
          else if (!(roll < sp.land && landFlock(f))) pickGoal(f);
        }
        f.splitT -= dt;
        if (f.splitT <= 0) { f.splitT = rr(40, 100); if (!sp.soar && rnd() < 0.45) splitFlock(f); }
        // a raptor near small birds makes them break away
        if (!sp.soar) {
          for (const r of flocks) if (r.sp.soar && r.mode === 'fly' && r.members[0]?.active) {
            const rb = r.members[0];
            if (Math.hypot(rb.px - c.x, rb.py - c.y, rb.pz - c.z) < 3.5) startleNearest(f, rb.px, rb.py, rb.pz);
          }
        }
        if (sp === SPECIES.starling && f.murmur > 0) {
          f.startleT -= dt;
          if (f.startleT <= 0) { f.startleT = rr(1.5, 5); const b = f.members[Math.floor(rnd() * f.members.length)]; if (b && b.active) startleBird(b, b.px + rr(-2, 2), b.py + rr(0.5, 2), b.pz + rr(-2, 2)); }
        }
      } else if (f.mode === 'landing' || f.mode === 'perched') {
        if (f.mode === 'landing' && f.members.every((b) => !b.active || b.mode === 'perch')) f.mode = 'perched';
        if (f.roost ? dawn && rnd() < dt * 0.08 : f.timer <= 0 && f.mode === 'perched') takeOff(f, null, clock);
      }
    }
  }
  function startleBird(b, fx, fy, fz) {
    let dx = b.px - fx, dy = b.py - fy, dz = b.pz - fz;
    const l = Math.hypot(dx, dy, dz) || 1;
    b.startle = 1; b.sdx = dx / l; b.sdy = Math.min(0.2, dy / l) - 0.25; b.sdz = dz / l; b.startleCd = 1.2;
  }
  function startleNearest(f, x, y, z) {
    let best = null, bd = Infinity;
    for (const b of f.members) if (b.active && b.mode === 'fly' && b.startleCd <= 0) { const d = Math.hypot(b.px - x, b.py - y, b.pz - z); if (d < bd) { bd = d; best = b; } }
    if (best) startleBird(best, x, y, z);
  }

  function checkThreats() {
    for (const f of flocks) {
      if (f.mode === 'fly' || f.pendingTakeoff || !f.anchor) continue;
      for (const b of f.members) {
        if (!b.active) continue;
        const t = nearestThreat(b.px, b.py, b.pz, f.sp.scare);
        if (t) { takeOff(f, t, clock); break; }
      }
    }
    // flying birds dodge the camera
    if (camera) {
      const cp = camera.position;
      for (const b of birds) if (b.active && b.mode === 'fly' && b.startleCd <= 0 && Math.hypot(cp.x - b.px, cp.y - b.py, cp.z - b.pz) < 1.6) startleBird(b, cp.x, cp.y, cp.z);
    }
  }

  function updateFloor(b) {
    // terrain / wall look-ahead, refreshed a few times a second per bird
    const s = Math.hypot(b.vx, b.vz) || 1;
    const hx = b.vx / s, hz = b.vz / s;
    // over walls, towers and decks the surface is the walk: add room for parapets, pavilions and roofs
    const top = (x, z) => { const s = surf(x, z); return s > groundHeight(x, z) + 0.25 ? s + 1.6 : s; };
    const f0 = top(b.px, b.pz);
    const f1 = top(b.px + hx * 1.2, b.pz + hz * 1.2);
    const f2 = top(b.px + hx * 2.6, b.pz + hz * 2.6);
    b.floor = f0;
    b.floorAhead = Math.max(f0, f1, f2);
    if (f2 > b.py - b.sp.clear) {
      // something high ahead: turn toward the lower side
      const l = top(b.px + (hx * 1.6 - hz * 1.6), b.pz + (hz * 1.6 + hx * 1.6));
      const r = top(b.px + (hx * 1.6 + hz * 1.6), b.pz + (hz * 1.6 - hx * 1.6));
      b.turnBias = l < r ? 1 : -1;
    } else b.turnBias = 0;
  }

  function steerFlying(b, dt) {
    const sp = b.sp, f = b.flock;
    let ax = 0, ay = 0, az = 0;
    const speed = Math.hypot(b.vx, b.vy, b.vz) || 1e-3;
    if (sp.soar) {
      // thermal soaring: ride a circle, drift to another thermal now and then
      const th = f.thermal;
      const dx = b.px - th.cx, dz = b.pz - th.cz, d = Math.hypot(dx, dz) || 1e-3;
      const tx = -dz / d * th.dir, tz = dx / d * th.dir;
      const radial = (th.r - d) * 0.5;
      const want = d > th.r * 3 ? { x: -dx / d, z: -dz / d } : { x: tx + (dx / d) * radial, z: tz + (dz / d) * radial };
      const wl = Math.hypot(want.x, want.z) || 1;
      const cruise = b.cruise;
      ax += ((want.x / wl) * cruise - b.vx) * 0.6;
      az += ((want.z / wl) * cruise - b.vz) * 0.6;
      const target = Math.max(b.floorAhead + sp.clear, groundHeight(th.cx, th.cz) + th.alt);
      ay += (target - b.py) * 0.35 - b.vy * 0.8 + 0.12 * Math.sin(clock * 0.4 + b.phase);
    } else {
      // boids over the k nearest neighbours of the same species
      const cs = sp.R > 1.5 ? CELL * 2 : CELL;
      const ix = Math.floor(b.px / cs), iy = Math.floor(b.py / cs), iz = Math.floor(b.pz / cs);
      let n = 0, worst = 0;
      const R2 = sp.R * sp.R;
      for (let gx = -1; gx <= 1; gx++) for (let gy = -1; gy <= 1; gy++) for (let gz = -1; gz <= 1; gz++) {
        const arr = grid.get(keyOf(sp.id, ix + gx, iy + gy, iz + gz));
        if (!arr) continue;
        for (const o of arr) {
          if (o === b) continue;
          const d2 = (o.px - b.px) ** 2 + (o.py - b.py) ** 2 + (o.pz - b.pz) ** 2;
          if (d2 > R2) continue;
          if (n < sp.k) { nb[n] = o; nd[n] = d2; if (d2 > nd[worst] || n === 0) worst = n; n++; }
          else if (d2 < nd[worst]) {
            nb[worst] = o; nd[worst] = d2;
            worst = 0;
            for (let i = 1; i < n; i++) if (nd[i] > nd[worst]) worst = i;
          }
        }
      }
      let sx = 0, sy = 0, sz = 0, avx = 0, avy = 0, avz = 0, cx = 0, cy = 0, cz = 0, st = 0, stI = -1;
      for (let i = 0; i < n; i++) {
        const o = nb[i], d = Math.sqrt(nd[i]) || 1e-3;
        if (d < sp.sep) { const w = (sp.sep - d) / (sp.sep * d); sx += (b.px - o.px) * w; sy += (b.py - o.py) * w; sz += (b.pz - o.pz) * w; }
        avx += o.vx; avy += o.vy; avz += o.vz;
        cx += o.px; cy += o.py; cz += o.pz;
        if (o.startle > st) { st = o.startle; stI = i; }
      }
      if (n) {
        const inv = 1 / n;
        ax += (avx * inv - b.vx) * sp.wAli + (cx * inv - b.px) * sp.wCoh + sx * sp.wSep * 3;
        ay += (avy * inv - b.vy) * sp.wAli * 0.6 + (cy * inv - b.py) * sp.wCoh * 0.5 + sy * sp.wSep * 3;
        az += (avz * inv - b.vz) * sp.wAli + (cz * inv - b.pz) * sp.wCoh + sz * sp.wSep * 3;
        // startle waves: a neighbour's dodge reaches this bird a moment later
        if (stI >= 0 && st > 0.55 && b.startleCd <= 0 && b.startle < 0.2) {
          const o = nb[stI];
          b.startle = st * 0.93; b.sdx = o.sdx; b.sdy = o.sdy; b.sdz = o.sdz; b.startleCd = 0.9;
        }
      }
      // flock goal (or the murmuration ball)
      let gx = f.goal.x - b.px, gz = f.goal.z - b.pz;
      if (f.murmur > 0) {
        const ball = sp === SPECIES.starling ? 4.5 + 1.5 * Math.sin(clock * 0.31 + f.goal.x) : 3;
        const gy = groundHeight(f.goal.x, f.goal.z) + 6.5 - b.py;
        const d = Math.hypot(gx, gy * 1.6, gz);
        const pull = d > ball ? (d - ball) * 0.9 : 0;
        ax += (gx / (d || 1)) * pull + Math.sin(clock * 0.7 + b.phase * 0.2) * 0.4;
        ay += (gy / (d || 1)) * pull * 0.8;
        az += (gz / (d || 1)) * pull + Math.cos(clock * 0.6 + b.phase * 0.2) * 0.4;
      } else {
        const gl = Math.hypot(gx, gz) || 1;
        ax += ((gx / gl) * b.cruise - b.vx) * sp.wGoal;
        az += ((gz / gl) * b.cruise - b.vz) * sp.wGoal;
      }
      // preferred height
      // the flock keeps one cruising height above the ground; neighbours, not the spring, keep birds together
      const target = Math.max(b.floorAhead + sp.clear * 0.6, b.floor + f.alt + b.altJ);
      ay += (target - b.py) * 0.45 - b.vy * 0.9;
      if (b.startle > 0) {
        const s = b.startle * 9;
        ax += b.sdx * s; ay += b.sdy * s; az += b.sdz * s;
      }
    }
    // obstacles ahead: climb and turn away
    const clearNeed = b.floorAhead + sp.clear * 0.7;
    if (b.py < clearNeed) ay += (clearNeed - b.py) * 6;
    if (b.turnBias) {
      const s = Math.hypot(b.vx, b.vz) || 1;
      ax += (-b.vz / s) * b.turnBias * 3.5;
      az += (b.vx / s) * b.turnBias * 3.5;
    }
    // stay over the land
    if (b.px < span.x0) ax += (span.x0 - b.px) * 1.5; else if (b.px > span.x1) ax -= (b.px - span.x1) * 1.5;
    if (b.pz < span.z0) az += (span.z0 - b.pz) * 1.5; else if (b.pz > span.z1) az -= (b.pz - span.z1) * 1.5;
    const amax = sp.soar ? 2.5 : 14;
    const al = Math.hypot(ax, ay, az);
    if (al > amax) { ax *= amax / al; ay *= amax / al; az *= amax / al; }
    b.vx += ax * dt; b.vy += ay * dt; b.vz += az * dt;
    // speed limits, no hovering in flight
    const lo = sp.speed[0] * (b.startle > 0.3 ? 1.1 : 0.85), hi = sp.speed[1] * (b.startle > 0.3 ? 1.45 : 1.1);
    const s2 = Math.hypot(b.vx, b.vy, b.vz) || 1e-3;
    if (s2 > hi) { b.vx *= hi / s2; b.vy *= hi / s2; b.vz *= hi / s2; } else if (s2 < lo) { b.vx *= lo / s2; b.vy *= lo / s2; b.vz *= lo / s2; }
    b.vy = Math.max(-sp.speed[1] * 0.8, Math.min(sp.speed[1] * 0.7, b.vy));
    // flap from effort: climbing or slow = flap, fast or descending = glide
    const climb = b.vy / sp.speed[1], slow = 1 - (speed - lo) / Math.max(0.1, hi - lo);
    let want = Math.max(0, Math.min(1, 0.35 + climb * 1.6 + slow * 0.5 + b.startle * 0.8 - (b.vy < -0.25 ? 0.6 : 0)));
    if (sp.soar) want = b.vy > 0.25 || b.py < b.floorAhead + sp.clear ? 0.7 : 0;
    return want;
  }

  function steerLanding(b, dt) {
    const s = b.spot;
    const dx = s.x - b.px, dz = s.z - b.pz, hd = Math.hypot(dx, dz);
    // come in from above, then drop onto the spot with a flare
    const above = hd > 1.4 ? Math.max(s.y + 0.7 + hd * 0.25, b.floorAhead + b.sp.clear * 0.6) : s.y;
    const dy = above - b.py;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.03 && hd < 0.03) return true;
    const sp = b.sp;
    const v = Math.min(sp.speed[1], 0.25 + d * 1.4);
    const ax = ((dx / (d || 1)) * v - b.vx) * 4, ay = ((dy / (d || 1)) * v - b.vy) * 4, az = ((dz / (d || 1)) * v - b.vz) * 4;
    b.vx += ax * dt; b.vy += ay * dt; b.vz += az * dt;
    return false;
  }

  function update(dt) {
    dt = Math.min(dt, 0.05);
    if (dt <= 0) return;
    clock += dt;
    frame++;
    flockLogic(dt);
    threatT -= dt;
    if (threatT <= 0) { threatT = 0.2; checkThreats(); }
    mergeT -= dt;
    if (mergeT <= 0) { mergeT = 2; mergeFlocks(); }
    buildGrid();
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      const mk = b.mesh;
      if (!b.active) { mk.mesh.setMatrixAt(b.slot, zero); continue; }
      let spread = 1;
      b.startle = Math.max(0, b.startle - dt * 1.4);
      b.startleCd -= dt;
      if (b.mode === 'perch') {
        if (b.takeoffAt && clock >= b.takeoffAt) { b.takeoffAt = 0; launch(b); }
      }
      if (b.mode === 'perch') {
        spread = -1;
        b.idle -= dt;
        if (b.idle < 0) {
          b.idle = rr(0.8, 4);
          b.yaw += rr(-1.4, 1.4);
          // ground birds hop about
          if (!b.site && b.spot && b.sp !== SPECIES.raptor && rnd() < 0.6) {
            const a = b.yaw, r = b.sp === SPECIES.crow ? 0.12 : 0.07;
            const x = b.spot.x + Math.sin(a) * r, z = b.spot.z + Math.cos(a) * r;
            b.hopFrom = { x: b.spot.x, y: b.spot.y, z: b.spot.z };
            b.hopTo = { x, y: surf(x, z) + 0.006, z };
            b.hopT = 0;
          }
        }
        let hy = 0;
        if (b.hopTo) {
          b.hopT += dt / 0.22;
          const t = Math.min(1, b.hopT);
          b.spot.x = b.hopFrom.x + (b.hopTo.x - b.hopFrom.x) * t;
          b.spot.z = b.hopFrom.z + (b.hopTo.z - b.hopFrom.z) * t;
          b.spot.y = b.hopFrom.y + (b.hopTo.y - b.hopFrom.y) * t;
          hy = Math.sin(t * Math.PI) * 0.03;
          if (t >= 1) b.hopTo = null;
        }
        b.bob += dt * 3;
        b.px = b.spot.x; b.pz = b.spot.z; b.py = b.spot.y + hy;
        b.pitch = 0.05 * Math.sin(b.bob * 1.7) * (b.sp === SPECIES.raptor ? 0.3 : 1); b.bank = 0;
        b.vx = b.vy = b.vz = 0;
        b.flapPow = 0;
      } else {
        if ((frame + i) % 4 === 0) updateFloor(b);
        const prevYaw = Math.atan2(b.vx, b.vz);
        let want;
        if (b.mode === 'land') {
          if (steerLanding(b, dt)) {
            b.mode = 'perch'; b.px = b.spot.x; b.py = b.spot.y; b.pz = b.spot.z;
            b.yaw = Math.atan2(b.vx, b.vz) || b.yaw; b.idle = rr(0.5, 2);
            spread = -1;
          }
          const dist = b.spot ? Math.hypot(b.spot.x - b.px, b.spot.y - b.py, b.spot.z - b.pz) : 0;
          want = dist < 1.2 ? 1 : b.vy < -0.1 ? 0.1 : 0.6;
        } else {
          want = steerFlying(b, dt);
        }
        if (b.mode !== 'perch') {
          b.px += b.vx * dt; b.py += b.vy * dt; b.pz += b.vz * dt;
          // never below the ground (or a wall-walk) while flying
          const minY = (b.mode === 'land' ? b.spot.y : b.floor + 0.35);
          if (b.py < minY) { b.py = minY; if (b.vy < 0) b.vy = 0; }
          const sh = Math.hypot(b.vx, b.vz);
          if (sh > 0.05) b.yaw = Math.atan2(b.vx, b.vz);
          const yr = wrap(b.yaw - prevYaw) / dt;
          b.yawRate += (yr - b.yawRate) * Math.min(1, dt * 6);
          // roll into the turn like a real bird: tan(bank) ~ v * yawRate / g (scaled)
          const bankT = Math.max(-1.15, Math.min(1.15, -Math.atan(sh * b.yawRate * 0.45)));
          b.bank += (bankT - b.bank) * Math.min(1, dt * 5);
          const flare = b.mode === 'land' && b.spot && Math.hypot(b.spot.x - b.px, b.spot.z - b.pz) < 0.6 ? -0.6 : 0;
          const pitchT = -Math.atan2(b.vy, Math.max(0.2, sh)) * 0.85 + flare;
          b.pitch += (pitchT - b.pitch) * Math.min(1, dt * 6);
          // bounding flight (finches): a few beats, then a dip with the wings shut
          if (b.sp.bounding && b.mode === 'fly' && b.startle < 0.3) {
            b.bound += dt;
            const cyc = b.bound % 0.62;
            if (cyc > 0.38) { want = -1; }
          }
          b.flapPow += ((want < 0 ? 0 : want) - b.flapPow) * Math.min(1, dt * 5);
          spread = want < 0 ? -1 : b.flapPow > 0.08 ? Math.min(1, 0.35 + b.flapPow) : 0;
          if (want >= 0 && b.flapPow > 0.08) b.phase += dt * b.sp.flap * 6.283 * (0.7 + 0.45 * b.flapPow);
          else if (spread === 0) {
            // glide: ease the wings back to the gliding pose
            const target = Math.round(b.phase / 6.283) * 6.283;
            b.phase += (target - b.phase) * Math.min(1, dt * 4);
          }
        }
      }
      E.set(b.pitch, b.yaw, b.bank);
      Q.setFromEuler(E);
      P.set(b.px, b.py, b.pz);
      SC.setScalar(b.scale);
      M.compose(P, Q, SC);
      mk.mesh.setMatrixAt(b.slot, M);
      mk.flap.setXYZ(b.slot, b.phase, spread, b.sp === SPECIES.raptor ? 0.6 : b.sp === SPECIES.crow ? 0.35 : 0);
    }
    for (const k of ['small', 'raptor']) {
      meshes[k].mesh.instanceMatrix.needsUpdate = true;
      meshes[k].flap.needsUpdate = true;
    }
  }

  for (const b of birds) updateFloor(b);
  update(0.016);
  return {
    mesh: root, update, setThreats, setNight, setQuality,
    // debug / tests
    get stats() {
      const s = { flying: 0, perched: 0, landing: 0, flocks: flocks.length, active: 0 };
      for (const b of birds) { if (!b.active) continue; s.active++; if (b.mode === 'fly') s.flying++; else if (b.mode === 'perch') s.perched++; else s.landing++; }
      return s;
    },
    _birds: birds, _flocks: flocks, _land: landFlock,
  };
}
