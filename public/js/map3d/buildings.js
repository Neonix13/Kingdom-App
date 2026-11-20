import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, patchLit } from './shaderPatches.js';
import { makeRng } from './noise.js';
import * as VEG from './vegetation.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C = (hex) => new THREE.Color(hex);

class Buf {
  constructor() { this.p = []; this.c = []; this.k = []; }
  tri(a, b, c, col, k = 0) {
    this.p.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) { this.c.push(col.r, col.g, col.b); this.k.push(k); }
  }
  quad(a, b, c, d, col, k) { this.tri(a, b, c, col, k); this.tri(a, c, d, col, k); }
  get count() { return this.p.length / 9; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aK', new THREE.Float32BufferAttribute(this.k, 1));
    g.computeVertexNormals();
    return g;
  }
}

class RoofBuf {
  constructor() { this.p = []; this.d = []; }
  tri(a, b, c, dn) {
    const n = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (n > 0) [b, c] = [c, b];
    this.p.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) this.d.push(dn.x, dn.z);
  }
  get count() { return this.p.length / 9; }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('aDown', new THREE.Float32BufferAttribute(this.d, 2));
    g.computeVertexNormals();
    return g;
  }
}

function frame(t) {
  const T = t.clone().normalize();
  const S = new THREE.Vector3().crossVectors(UP, T);
  if (S.lengthSq() < 1e-8) S.set(1, 0, 0); else S.normalize();
  const N = new THREE.Vector3().crossVectors(T, S);
  return { T, S, N };
}

function box(B, c, X, Y, Z, hx, hy, hz, col, k) {
  const P = (sx, sy, sz) => c.clone().addScaledVector(X, sx * hx).addScaledVector(Y, sy * hy).addScaledVector(Z, sz * hz);
  const v = [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
  for (const f of [[0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7], [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]]) B.quad(v[f[0]], v[f[1]], v[f[2]], v[f[3]], col, k);
}

function beam(B, p0, p1, w, h, col, k) {
  const d = p1.clone().sub(p0);
  const { T, S, N } = frame(d);
  box(B, p0.clone().add(p1).multiplyScalar(0.5), T, N, S, d.length() / 2, h / 2, w / 2, col, k);
}

function hbox(B, x, y0, y1, z, dir, hl, hw, col, k) {
  const T = V(dir.x, 0, dir.z).normalize();
  const S = V(-T.z, 0, T.x);
  box(B, V(x, (y0 + y1) / 2, z), T, UP, S, hl, (y1 - y0) / 2, hw, col, k);
}

function prism(B, x, y0, z, r0, r1, h, col, k, n = 6, rot = 0) {
  const ring = (r, y) => Array.from({ length: n }, (_, i) => { const a = rot + i / n * Math.PI * 2; return V(x + Math.cos(a) * r, y, z + Math.sin(a) * r); });
  const lo = ring(r0, y0), hi = ring(r1, y0 + h);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; B.quad(lo[i], lo[j], hi[j], hi[i], col, k); }
  if (r1 > 1e-4) { const top = V(x, y0 + h, z); for (let i = 0; i < n; i++) B.tri(top, hi[i], hi[(i + 1) % n], col, k); }
}

function tube(B, pts, prof, col, k, scl = null) {
  const rings = pts.map((p, i) => {
    const t = pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)]);
    const { S, N } = frame(t);
    const s = scl ? scl[i] : 1;
    return prof.map(([a, b]) => p.clone().addScaledVector(S, a * s).addScaledVector(N, b * s));
  });
  const m = prof.length;
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < m; j++) { const jj = (j + 1) % m; B.quad(rings[i][j], rings[i][jj], rings[i + 1][jj], rings[i + 1][j], col, k); }
  }
  for (const r of [rings[0], rings[rings.length - 1]]) {
    const c = r.reduce((a, p) => a.add(p), V(0, 0, 0)).multiplyScalar(1 / m);
    for (let j = 0; j < m; j++) B.tri(c, r[j], r[(j + 1) % m], col, k);
  }
}

const ridgeProf = (w, h) => [[-w, 0], [w, 0], [w, h * 0.7], [w * 0.45, h], [-w * 0.45, h], [-w, h * 0.7]];
const RAIL_PROF = [[-0.016, -0.016], [0.016, -0.016], [0.016, 0.016], [-0.016, 0.016]];

const K_CURVE = 0.45;
const curveH = (u) => (u < 0 ? u * (1 - K_CURVE) : u * (1 - K_CURVE) + K_CURVE * u * u);
const liftAt = (lifts, x, z) => {
  let m = 0;
  for (const p of lifts) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.R) { const w = 1 - d / p.R; m = Math.max(m, p.U * w * w); }
  }
  return m;
};

function sheetTri(R, A, B, Cc, dn, n, hf) {
  const g = [];
  for (let i = 0; i <= n; i++) {
    g.push([]);
    for (let j = 0; j <= n - i; j++) {
      const a = i / n, b = j / n;
      const x = A.x + (B.x - A.x) * a + (Cc.x - A.x) * b, z = A.z + (B.z - A.z) * a + (Cc.z - A.z) * b, l = A.l + (B.l - A.l) * a + (Cc.l - A.l) * b;
      g[i].push(V(x, hf(x, z, l), z));
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n - i; j++) {
      R.tri(g[i][j], g[i + 1][j], g[i][j + 1], dn);
      if (i + j < n - 1) R.tri(g[i + 1][j], g[i + 1][j + 1], g[i][j + 1], dn);
    }
  }
}

function sheetQuad(R, A, Bp, Cp, D, dn, nu, nv, hf) {
  const g = [];
  for (let v = 0; v <= nv; v++) {
    g.push([]);
    for (let u = 0; u <= nu; u++) {
      const a = u / nu, b = v / nv;
      const ix = A.x + (Bp.x - A.x) * a, iz = A.z + (Bp.z - A.z) * a, il = A.l + (Bp.l - A.l) * a;
      const ox = D.x + (Cp.x - D.x) * a, oz = D.z + (Cp.z - D.z) * a, ol = D.l + (Cp.l - D.l) * a;
      const x = ix + (ox - ix) * b, z = iz + (oz - iz) * b, l = il + (ol - il) * b;
      g[v].push(V(x, hf(x, z, l), z));
    }
  }
  for (let v = 0; v < nv; v++) {
    for (let u = 0; u < nu; u++) {
      R.tri(g[v][u], g[v][u + 1], g[v + 1][u + 1], dn);
      R.tri(g[v][u], g[v + 1][u + 1], g[v + 1][u], dn);
    }
  }
}

const lerpP = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, l: a.l + (b.l - a.l) * t });

// Villages and man-made structures: compounds (walls, roofs, waterwheels, windows),
// bridges, footbridges, gateways, fences, banners and lanterns.
export function buildStructures(ctx) {
  const {
    scene, vegGroup, allHexes, hexesByType, segmentData, getSegType, parseSeg, edgeCorners,
    hexToWorld, hexCorner, groundHeight, effH, isWaterHex, footbridges, gateways,
    HEX_DIRS, DIR_TO_GEO_EDGE, CORNER_NEIGHBORS, HEX_HEIGHT_STEP, WATER_LEVEL, RIVERBED_HEIGHT,
    lanternMats, windowMats,
  } = ctx;
  const sqrt3 = Math.sqrt(3);

  const woodMat = patchLit(new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.85, flatShading: true }), {}, null, 'wood');
  const buildMat = patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true, side: THREE.DoubleSide }), {}, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aK;\nvarying float vK;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvK = aK;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vK;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float m = 0.9 + 0.2 * texture2D( uNoise, vPWorld.xz * 2.3 + vPWorld.y ).b;
        if ( vK > 0.5 && vK < 1.5 ) {
          float course = smoothstep( 0.0, 0.08, abs( fract( vPWorld.y * 9.0 ) - 0.5 ) * 2.0 - 0.86 );
          m *= ( 0.92 + 0.16 * texture2D( uNoise, vec2( ( vPWorld.x + vPWorld.z ) * 0.9, vPWorld.y * 3.0 ) ).g ) * ( 1.0 - 0.14 * course );
        } else if ( vK > 1.5 && vK < 2.5 ) {
          float row = vPWorld.y * 12.0;
          float col = ( vPWorld.x * 0.7 + vPWorld.z * 0.7 ) * 6.0 + 0.5 * floor( row );
          float j = max( smoothstep( 0.82, 0.95, abs( fract( row ) - 0.5 ) * 2.0 ), smoothstep( 0.88, 0.97, abs( fract( col ) - 0.5 ) * 2.0 ) );
          m *= ( 1.0 - 0.35 * j ) * ( 0.85 + 0.3 * texture2D( uNoise, floor( vec2( row, col ) ) * 0.0731 ).g );
        } else if ( vK > 2.5 ) {
          m *= 0.88 + 0.24 * texture2D( uNoise, vec2( ( vPWorld.x + vPWorld.z ) * 0.5, vPWorld.y * 9.0 ) ).r;
        }
        diffuseColor.rgb *= m;
      }`);
  }, 'build');
  const roofMat = patchLit(new THREE.MeshStandardMaterial({ color: 0x46443f, roughness: 0.78, flatShading: true }), {}, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aDown;\nvarying vec2 vDown;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDown = aDown;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vDown;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      vec2 _dn = normalize( vDown + vec2( 1e-5 ) );
      vec2 _tn = vec2( -_dn.y, _dn.x );
      float _ch = dot( vPWorld.xz, _tn ) * 12.0;
      float _cr = dot( vPWorld.xz, _dn ) * 8.0;
      float _aa = 1.0 - smoothstep( 0.2, 0.6, fwidth( _ch ) );
      {
        float rib = cos( _ch * 6.2831853 );
        float st = smoothstep( 0.0, 0.3, fract( _cr ) );
        float tn = texture2D( uNoise, floor( vec2( _ch, _cr ) ) * 0.0731 ).b;
        diffuseColor.rgb *= ( 0.84 + 0.3 * tn ) * mix( 0.92, ( 0.72 + 0.28 * smoothstep( -0.6, 0.8, rib ) ) * ( 0.8 + 0.2 * st ), _aa );
      }`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      {
        vec3 _tv = normalize( ( viewMatrix * vec4( _tn.x, 0.0, _tn.y, 0.0 ) ).xyz );
        normal = normalize( normal + _tv * sin( _ch * 6.2831853 ) * 0.55 * _aa );
      }`);
  }, 'tileroof');

  const COL = {
    plaster: C(0xb8925c), stone: C(0x8d877e), timber: C(0x3e2b1f), band: C(0x5b3424), door: C(0x6a2b1d),
    lacquer: C(0x7a2c20), ridge: C(0x2f3032), fascia: C(0x27282a), soffit: C(0x4a3526), wood: C(0x6b4a2e),
    woodDark: C(0x4f3624), bronze: C(0x5c5040),
  };
  const B = new Buf();
  const R = new RoofBuf();
  const W = new Buf();
  const waterwheels = [];
  const smokeSources = [];
  const lanternSpots = [];
  const ck = (x, z) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
  let towerSite = null;

  function hipRoof(c, ax, az, hl, hd, base, Hr, U, nS = 3) {
    const P = (a, b, l) => ({ x: c.x + ax.x * a + az.x * b, z: c.z + ax.z * a + az.z * b, l });
    const rl = Math.max(0, hl - hd);
    const top = base + Hr;
    const Q = [P(-hl, -hd, base), P(hl, -hd, base), P(hl, hd, base), P(-hl, hd, base)];
    const R0 = P(-rl, 0, top), R1 = P(rl, 0, top);
    const lifts = Q.map(q => ({ x: q.x, z: q.z, U, R: Math.min(hl, hd) * 1.1 }));
    const hf = (x, z, l) => base + Hr * curveH((l - base) / Hr) + liftAt(lifts, x, z);
    const nz = { x: -az.x, z: -az.z }, pz = az, px = ax, nx = { x: -ax.x, z: -ax.z };
    sheetTri(R, Q[0], Q[1], R1, nz, nS, hf);
    if (rl > 0) sheetTri(R, Q[0], R1, R0, nz, nS, hf);
    sheetTri(R, Q[2], Q[3], R0, pz, nS, hf);
    if (rl > 0) sheetTri(R, Q[2], R0, R1, pz, nS, hf);
    sheetTri(R, Q[1], Q[2], R1, px, nS, hf);
    sheetTri(R, Q[3], Q[0], R0, nx, nS, hf);
    const F = 0.04;
    const ring = [];
    for (let s = 0; s < 4; s++) for (let i = 0; i < nS; i++) ring.push(lerpP(Q[s], Q[(s + 1) % 4], i / nS));
    const bottom = base - Hr * 0.05;
    const mid = V(c.x, bottom - F, c.z);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const ya = hf(a.x, a.z, a.l), yb = hf(b.x, b.z, b.l);
      B.quad(V(a.x, ya, a.z), V(b.x, yb, b.z), V(b.x, yb - F, b.z), V(a.x, ya - F, a.z), COL.fascia, 0);
      B.tri(mid, V(a.x, ya - F, a.z), V(b.x, yb - F, b.z), COL.soffit, 3);
    }
    const sample = (a, b, n, off) => Array.from({ length: n + 1 }, (_, i) => { const p = lerpP(a, b, i / n); return V(p.x, hf(p.x, p.z, p.l) + off, p.z); });
    const hipW = 0.022 + Hr * 0.02;
    for (const [r, q] of [[R0, Q[0]], [R1, Q[1]], [R1, Q[2]], [R0, Q[3]]]) {
      const pts = sample(r, q, nS, -0.005);
      const e = pts[pts.length - 1];
      const dx = q.x - r.x, dz = q.z - r.z, dl = Math.hypot(dx, dz);
      pts.push(V(e.x + dx / dl * 0.05, e.y + 0.04, e.z + dz / dl * 0.05));
      tube(B, pts, ridgeProf(hipW, hipW * 1.6), COL.ridge, 0, pts.map((_, i) => (i === pts.length - 1 ? 0.6 : 1)));
    }
    if (rl > 0) {
      const pts = sample(R0, R1, 2, -0.01);
      tube(B, pts, ridgeProf(hipW * 1.5, hipW * 2.6), COL.ridge, 0);
      for (const [p, sg] of [[pts[0], -1], [pts[pts.length - 1], 1]]) {
        const h = [p.clone(), p.clone().addScaledVector(V(ax.x, 0, ax.z), sg * 0.03).add(V(0, 0.06, 0)), p.clone().addScaledVector(V(ax.x, 0, ax.z), sg * 0.01).add(V(0, 0.12, 0))];
        tube(B, h, ridgeProf(hipW * 1.4, hipW * 1.6), COL.ridge, 0, [1, 0.9, 0.5]);
      }
    } else {
      prism(B, c.x, top - 0.02, c.z, 0.035, 0.0, 0.16, COL.bronze, 0);
    }
    return hf;
  }

  // --- Building compounds ---
  {
    const WALL_HEIGHT = 0.7;
    const ROOF_HIGH = 0.85;
    const ROOF_LOW = 0.6;
    const OV = 0.22;
    const DROP_L = 0.13;
    const FASCIA = 0.05;
    const NSUB = 5;

    const buildingHexes = hexesByType.building || [];
    const buildingSet = new Set(buildingHexes.map(h => `${h.q},${h.r}`));
    const visited = new Set();
    const clusters = [];
    for (const hex of buildingHexes) {
      const key = `${hex.q},${hex.r}`;
      if (visited.has(key)) continue;
      const cluster = [];
      const queue = [hex];
      visited.add(key);
      while (queue.length > 0) {
        const h = queue.shift();
        cluster.push(h);
        for (const [dq, dr] of HEX_DIRS) {
          const nk = `${h.q + dq},${h.r + dr}`;
          if (buildingSet.has(nk) && !visited.has(nk)) { visited.add(nk); queue.push(allHexes.get(nk)); }
        }
      }
      clusters.push(cluster);
    }

    const largest = clusters.reduce((a, c) => (c.length > (a ? a.length : 0) ? c : a), null);
    if (largest) {
      let best = null;
      for (const h of largest) {
        for (const [dq, dr] of HEX_DIRS) {
          const n = allHexes.get(`${h.q + dq},${h.r + dr}`);
          if (!n || n.terrain !== 'plain' || n.height !== h.height) continue;
          const open = HEX_DIRS.filter(([a, b]) => { const o = allHexes.get(`${n.q + a},${n.r + b}`); return o && o.terrain === 'plain'; }).length;
          if (!best || open > best.open) best = { h, n, open };
        }
      }
      if (best) {
        const a = hexToWorld(best.h.q, best.h.r), b = hexToWorld(best.n.q, best.n.r);
        const dx = (b.x - a.x) / sqrt3, dz = (b.z - a.z) / sqrt3;
        towerSite = { x: a.x + dx * (sqrt3 / 2 + 0.75), z: a.z + dz * (sqrt3 / 2 + 0.75), ax: { x: -dz, z: dx }, az: { x: dx, z: dz }, gy: best.h.height * HEX_HEIGHT_STEP };
      }
    }

    const winRng = makeRng(2024);
    for (const cluster of clusters) {
      const clusterSet = new Set(cluster.map(h => `${h.q},${h.r}`));
      const groundY = cluster[0].height * HEX_HEIGHT_STEP;
      const baseY = groundY + WALL_HEIGHT;
      const H = ROOF_HIGH;

      const corners = new Map();
      for (const hex of cluster) {
        const wp = hexToWorld(hex.q, hex.r);
        for (let i = 0; i < 6; i++) {
          const c = hexCorner(wp.x, wp.z, i);
          const key = ck(c.x, c.z);
          if (!corners.has(key)) corners.set(key, { x: c.x, z: c.z, count: 0, nx: 0, nz: 0, key });
          corners.get(key).count++;
        }
      }
      for (const c of corners.values()) c.l = c.count === 3 ? baseY + H : baseY;

      const hexInfo = cluster.map((hex) => {
        const wp = hexToWorld(hex.q, hex.r);
        const cs = [];
        for (let i = 0; i < 6; i++) { const c = hexCorner(wp.x, wp.z, i); cs.push(corners.get(ck(c.x, c.z))); }
        const peaks = cs.filter(c => c.count === 3).length;
        return { hex, wp, cs, center: { x: wp.x, z: wp.z, l: peaks >= 2 ? baseY + H : baseY + ROOF_LOW } };
      });

      const boundary = [];
      for (const hi of hexInfo) {
        const { hex, wp, cs } = hi;
        for (let d = 0; d < 6; d++) {
          const [dq, dr] = HEX_DIRS[d];
          if (clusterSet.has(`${hex.q + dq},${hex.r + dr}`)) continue;
          const g = DIR_TO_GEO_EDGE[d];
          const c0 = cs[g], c1 = cs[(g + 1) % 6];
          const mx = (c0.x + c1.x) / 2, mz = (c0.z + c1.z) / 2;
          const nl = Math.hypot(mx - wp.x, mz - wp.z);
          const n = { x: (mx - wp.x) / nl, z: (mz - wp.z) / nl };
          for (const c of [c0, c1]) { c.nx += n.x; c.nz += n.z; }
          boundary.push({ hi, g, c0, c1, n, type: getSegType(hex.q, hex.r, hex.q + dq, hex.r + dr) });
        }
      }
      const lifts = [];
      for (const c of corners.values()) {
        if (c.count === 3) continue;
        const l = Math.hypot(c.nx, c.nz) || 1;
        c.mx = c.nx / l; c.mz = c.nz / l;
        const md = OV / Math.cos(Math.PI / 6);
        c.o = { x: c.x + c.mx * md, z: c.z + c.mz * md, l: baseY - DROP_L };
        if (c.count === 1) lifts.push({ x: c.o.x, z: c.o.z, U: 0.15, R: 0.7 });
      }
      const hf = (x, z, l) => baseY + H * curveH((l - baseY) / H) + liftAt(lifts, x, z);

      // Roof sheet: one fan per hex, curved by height remap
      for (const { cs, center } of hexInfo) {
        for (let i = 0; i < 6; i++) {
          const a = cs[i], b = cs[(i + 1) % 6];
          const mx = (a.x + b.x) / 2 - center.x, mz = (a.z + b.z) / 2 - center.z, ml = Math.hypot(mx, mz);
          sheetTri(R, center, a, b, { x: mx / ml, z: mz / ml }, NSUB, hf);
        }
      }
      // Eaves: overhang strip, fascia and soffit
      for (const e of boundary) {
        const { c0, c1, n } = e;
        sheetQuad(R, c0, c1, c1.o, c0.o, n, NSUB, 2, hf);
        for (let j = 0; j < NSUB; j++) {
          const o0 = lerpP(c0.o, c1.o, j / NSUB), o1 = lerpP(c0.o, c1.o, (j + 1) / NSUB);
          const w0 = lerpP(c0, c1, j / NSUB), w1 = lerpP(c0, c1, (j + 1) / NSUB);
          const y0 = hf(o0.x, o0.z, o0.l), y1 = hf(o1.x, o1.z, o1.l);
          B.quad(V(o0.x, y0, o0.z), V(o1.x, y1, o1.z), V(o1.x, y1 - FASCIA, o1.z), V(o0.x, y0 - FASCIA, o0.z), COL.fascia, 0);
          B.quad(V(w0.x, baseY - 0.01, w0.z), V(w1.x, baseY - 0.01, w1.z), V(o1.x, y1 - FASCIA, o1.z), V(o0.x, y0 - FASCIA, o0.z), COL.soffit, 3);
        }
      }

      // Ridges on convex creases, horns at eave corners, finials on apexes
      const planeAt = (A, Bp, Cp, x, z) => {
        const ux = Bp.x - A.x, uz = Bp.z - A.z, vx = Cp.x - A.x, vz = Cp.z - A.z;
        const det = ux * vz - uz * vx;
        const s = ((x - A.x) * vz - (z - A.z) * vx) / det, t = (ux * (z - A.z) - uz * (x - A.x)) / det;
        return A.l + (Bp.l - A.l) * s + (Cp.l - A.l) * t;
      };
      const ridgeSample = (a, b, n, off) => Array.from({ length: n + 1 }, (_, i) => { const p = lerpP(a, b, i / n); return V(p.x, hf(p.x, p.z, p.l) + off, p.z); });
      const addRidge = (a, b) => {
        const top = a.l > baseY + H - 1e-3 && b.l > baseY + H - 1e-3;
        const pts = ridgeSample(a, b, NSUB, -0.012);
        const scl = pts.map(() => 1);
        if (b.count === 1 && b.o) {
          const o = b.o, yo = hf(o.x, o.z, o.l) - 0.012;
          pts.push(V(o.x, yo, o.z), V(o.x + b.mx * 0.07, yo + 0.07, o.z + b.mz * 0.07), V(o.x + b.mx * 0.09, yo + 0.15, o.z + b.mz * 0.09));
          scl.push(1, 0.85, 0.45);
        }
        tube(B, pts, top ? ridgeProf(0.05, 0.1) : ridgeProf(0.038, 0.07), COL.ridge, 0, scl);
      };
      const seenEdge = new Set();
      for (const hi of hexInfo) {
        const { hex, cs, center } = hi;
        for (let i = 0; i < 6; i++) {
          const prev = cs[(i + 5) % 6], cur = cs[i], next = cs[(i + 1) % 6];
          if (planeAt(center, prev, cur, next.x, next.z) - next.l > 0.04) addRidge(center, cur);
        }
        for (let d = 0; d < 6; d++) {
          const [dq, dr] = HEX_DIRS[d];
          const nb = hexInfo.find(o => o.hex.q === hex.q + dq && o.hex.r === hex.r + dr);
          if (!nb) continue;
          const g = DIR_TO_GEO_EDGE[d];
          const a = cs[g], b = cs[(g + 1) % 6];
          const key = [a.key, b.key].sort().join('|');
          if (seenEdge.has(key)) continue;
          seenEdge.add(key);
          if (planeAt(center, a, b, nb.center.x, nb.center.z) - nb.center.l > 0.04) addRidge(a.l >= b.l ? a : b, a.l >= b.l ? b : a);
        }
        if (cs.every(c => c.l < center.l - 1e-3)) {
          const y = hf(center.x, center.z, center.l);
          prism(B, center.x, y - 0.02, center.z, 0.07, 0.05, 0.07, COL.ridge, 0);
          prism(B, center.x, y + 0.05, center.z, 0.045, 0.0, 0.2, COL.bronze, 0);
        }
      }
      for (const c of corners.values()) {
        if (c.count !== 3) continue;
        const adj = hexInfo.filter(o => o.cs.includes(c));
        if (adj.some(o => o.center.l >= c.l - 1e-3)) continue;
        const y = hf(c.x, c.z, c.l);
        prism(B, c.x, y - 0.02, c.z, 0.08, 0.06, 0.08, COL.ridge, 0);
        prism(B, c.x, y + 0.06, c.z, 0.05, 0.0, 0.22, COL.bronze, 0);
      }

      // Chimney point on the roof surface
      {
        const pk = [...corners.values()].find(c => c.count === 3);
        const p = pk || hexInfo[0].center;
        smokeSources.push({ x: p.x, y: hf(p.x, p.z, p.l) + 0.1, z: p.z });
      }

      // Walls: stone plinth, rammed-earth body, timber band, posts, doors and windows
      const postKeys = new Set();
      const addPost = (x, z, r) => {
        const key = ck(x, z);
        if (postKeys.has(key)) return;
        postKeys.add(key);
        prism(B, x, groundY + 0.08, z, r, r, WALL_HEIGHT - 0.115, COL.timber, 3, 6);
        prism(B, x, groundY - 0.3, z, r + 0.035, r + 0.025, 0.42, COL.stone, 2, 6);
      };
      for (const { c0, c1, n, type } of boundary) {
        const ex = c1.x - c0.x, ez = c1.z - c0.z, len = Math.hypot(ex, ez);
        const e = { x: ex / len, z: ez / len };
        const at = (t, off = 0) => ({ x: c0.x + ex * t + n.x * off, z: c0.z + ez * t + n.z * off });
        const seg = (t0, t1, y0, y1, thick, off, col, k) => {
          const a = at(t0, off), b = at(t1, off);
          hbox(B, (a.x + b.x) / 2, y0, y1, (a.z + b.z) / 2, e, (t1 - t0) * len / 2, thick / 2, col, k);
        };
        const s0 = c0.count === 1 ? -0.04 : 0.05, s1 = c1.count === 1 ? 1.04 : 0.95;
        seg(s0 - 0.01, s1 + 0.01, groundY - 0.5, groundY + 0.1, 0.18, 0, COL.stone, 2);
        seg(s0, s1, baseY - 0.1, baseY - 0.035, 0.13, 0, COL.band, 3);
        const DW = 0.21;
        if (type === 'passerelle') {
          seg(s0, 0.5 - DW, groundY + 0.1, baseY - 0.08, 0.1, 0, COL.plaster, 1);
          seg(0.5 + DW, s1, groundY + 0.1, baseY - 0.08, 0.1, 0, COL.plaster, 1);
          seg(0.5 - DW, 0.5 + DW, groundY + 0.58, baseY - 0.08, 0.1, 0, COL.plaster, 1);
          seg(0.5 - DW, 0.5 + DW, groundY + 0.53, groundY + 0.6, 0.12, 0, COL.timber, 3);
          seg(0.5 - DW, 0.5, groundY + 0.1, groundY + 0.54, 0.035, -0.01, COL.door, 3);
          seg(0.5, 0.5 + DW, groundY + 0.1, groundY + 0.54, 0.035, -0.01, COL.door.clone().multiplyScalar(0.85), 3);
          for (const t of [0.5 - DW, 0.5 + DW]) { const p = at(t, 0.02); prism(B, p.x, groundY + 0.08, p.z, 0.03, 0.03, 0.52, COL.timber, 3, 4, Math.PI / 4); }
          seg(0.5 - DW - 0.05, 0.5 + DW + 0.05, groundY - 0.2, groundY + 0.05, 0.16, 0.16, COL.stone, 2);
        } else {
          seg(s0, s1, groundY + 0.1, baseY - 0.08, 0.1, 0, COL.plaster, 1);
          const m = at(0.5, 0);
          addPost(m.x, m.z, 0.045);
          for (const t of [0.25, 0.75]) {
            if (winRng() > 0.68) continue;
            const ww = 0.16, wh = 0.14, wy = groundY + 0.4;
            const fo = 0.05;
            const p = at(t, fo + 0.004);
            const hx = e.x * ww / 2, hz = e.z * ww / 2;
            W.quad(V(p.x - hx, wy - wh / 2, p.z - hz), V(p.x + hx, wy - wh / 2, p.z + hz), V(p.x + hx, wy + wh / 2, p.z + hz), V(p.x - hx, wy + wh / 2, p.z - hz), COL.timber, 0);
            const ft = 0.025;
            seg(t - ww / 2 / len - ft, t + ww / 2 / len + ft, wy + wh / 2, wy + wh / 2 + ft, 0.13, 0, COL.timber, 3);
            seg(t - ww / 2 / len - ft, t + ww / 2 / len + ft, wy - wh / 2 - ft, wy - wh / 2, 0.13, 0, COL.timber, 3);
            seg(t - ww / 2 / len - ft, t - ww / 2 / len, wy - wh / 2, wy + wh / 2, 0.13, 0, COL.timber, 3);
            seg(t + ww / 2 / len, t + ww / 2 / len + ft, wy - wh / 2, wy + wh / 2, 0.13, 0, COL.timber, 3);
            for (const bt of [-0.33, 0, 0.33]) seg(t + bt * ww / 2 / len - 0.006, t + bt * ww / 2 / len + 0.006, wy - wh / 2, wy + wh / 2, 0.115, 0, COL.timber, 3);
          }
        }
        addPost(c0.x, c0.z, 0.055);
        addPost(c1.x, c1.z, 0.055);
      }

      // Waterwheels at vertices with building-water-water configuration
      const placedWheels = new Set();
      for (const hex of cluster) {
        const wp = hexToWorld(hex.q, hex.r);
        for (let i = 0; i < 6; i++) {
          const [d0, d1] = CORNER_NEIGHBORS[i];
          const n0 = allHexes.get(`${hex.q + d0[0]},${hex.r + d0[1]}`);
          const n1 = allHexes.get(`${hex.q + d1[0]},${hex.r + d1[1]}`);
          if (!n0 || !n1 || n0.terrain !== 'river' || n1.terrain !== 'river') continue;
          const c = hexCorner(wp.x, wp.z, i);
          const wKey = `${c.x.toFixed(3)},${c.z.toFixed(3)}`;
          if (placedWheels.has(wKey)) continue;
          placedWheels.add(wKey);

          const outDx = c.x - wp.x, outDz = c.z - wp.z;
          const faceAngle = Math.atan2(outDx, outDz);
          const wheelRadius = 0.55;
          const wheelWidth = 0.45;
          const wheelY = WATER_LEVEL + wheelRadius * 0.6;
          const dist = 0.3;
          const ol = Math.sqrt(outDx * outDx + outDz * outDz);
          const wheelBase = new THREE.Group();
          wheelBase.position.set(c.x + outDx / ol * dist, wheelY, c.z + outDz / ol * dist);
          wheelBase.rotation.y = faceAngle + Math.PI / 2 + Math.PI;

          const spinParts = [];
          const addPart = (geo, setup) => {
            const m = new THREE.Object3D();
            setup(m);
            m.updateMatrix();
            spinParts.push(geo.applyMatrix4(m.matrix));
          };
          const paddleH = 0.12;
          const rimInnerR = wheelRadius - paddleH / 2;
          const rimOuterR = wheelRadius + paddleH / 2;
          const xNear = -wheelWidth * 0.35;
          const xFar = wheelWidth * 0.35;
          for (const rr of [rimInnerR, rimOuterR]) {
            for (const xOff of [xNear, xFar]) {
              addPart(new THREE.TorusGeometry(rr, 0.04, 4, 24), (m) => {
                m.rotation.y = Math.PI / 2; m.rotation.z = Math.PI / 4; m.scale.set(1, 1, 1.5); m.position.x = xOff;
              });
            }
          }
          for (let s = 0; s < 5; s++) {
            for (const xOff of [xNear, xFar]) {
              addPart(new THREE.CylinderGeometry(0.04, 0.04, rimOuterR * 2, 4), (m) => {
                m.rotation.y = Math.PI / 2; m.rotation.z = (Math.PI * 2 / 5) * s; m.position.x = xOff;
              });
            }
          }
          const numPaddles = 24;
          const tilt = 10 * Math.PI / 180;
          for (let p = 0; p < numPaddles; p++) {
            const a = (Math.PI * 2 / numPaddles) * p;
            addPart(new THREE.BoxGeometry(wheelWidth, 0.12, 0.04), (m) => {
              m.position.set(0, wheelRadius * Math.sin(a), wheelRadius * Math.cos(a));
              m.rotation.x = -a + tilt;
            });
          }
          const spin = new THREE.Mesh(mergeGeometries(spinParts), woodMat);
          spin.castShadow = true;
          wheelBase.add(spin);

          const axleStart = -wheelWidth * 0.7;
          const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, xFar - axleStart, 6), woodMat);
          axle.rotation.z = Math.PI / 2;
          axle.position.x = (axleStart + xFar) / 2;
          wheelBase.add(axle);
          scene.add(wheelBase);
          waterwheels.push(spin);
        }
      }
    }
  }

  if (towerSite) {
    const { x, z, ax, az, gy } = towerSite;
    const at = (s, t, y) => V(x + ax.x * s + az.x * t, y, z + ax.z * s + az.z * t);
    const PS = 0.22, FS = 0.3, PY = gy + 1.5, TOP = gy + 2.0;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [s, t] of corners) {
      const foot = at(s * FS, t * FS, 0);
      const fy = groundHeight(foot.x, foot.z);
      prism(B, foot.x, fy - 0.1, foot.z, 0.075, 0.065, 0.2, COL.stone, 2, 6);
      beam(B, foot.setY(fy - 0.05), at(s * PS, t * PS, TOP), 0.06, 0.06, COL.woodDark, 3);
    }
    for (let i = 0; i < 4; i++) {
      const [s0, t0] = corners[i], [s1, t1] = corners[(i + 1) % 4];
      const P = (s, t, f) => { const k = FS + (PS - FS) * f; return at(s * k, t * k, gy + (PY - gy) * f); };
      for (const [f0, f1] of [[0.12, 0.55], [0.55, 0.98]]) {
        beam(B, P(s0, t0, f0), P(s1, t1, f1), 0.03, 0.03, COL.woodDark, 3);
        beam(B, P(s1, t1, f0), P(s0, t0, f1), 0.03, 0.03, COL.woodDark, 3);
      }
      beam(B, P(s0, t0, 0.55), P(s1, t1, 0.55), 0.04, 0.04, COL.woodDark, 3);
    }
    box(B, at(0, 0, PY), V(ax.x, 0, ax.z), UP, V(az.x, 0, az.z), 0.36, 0.035, 0.36, COL.wood, 3);
    for (const [s, t, len] of [[0, -1, 0], [0, 1, 0], [-1, 0, 1], [1, 0, 1]]) {
      const c = at(s * 0.34, t * 0.34, PY + 0.13);
      const X = len ? V(az.x, 0, az.z) : V(ax.x, 0, ax.z);
      box(B, c, X, UP, new THREE.Vector3().crossVectors(UP, X), 0.36, 0.1, 0.015, COL.wood.clone().multiplyScalar(0.85), 3);
    }
    hipRoof(at(0, 0, 0), ax, az, 0.42, 0.42, TOP, 0.4, 0.09, 4);
    lanternSpots.push(at(0, 0.3, PY + 0.32));
  }

  // --- Gatehouses on compound gateways ---
  const gateInfo = [];
  {
    const cornerUse = new Map();
    for (const gw of gateways) for (const p of [gw.a, gw.b]) cornerUse.set(ck(p.x, p.z), (cornerUse.get(ck(p.x, p.z)) || 0) + 1);
    for (const gw of gateways) {
      const ha = allHexes.get(`${gw.q1},${gw.r1}`), hb = allHexes.get(`${gw.q2},${gw.r2}`);
      const inner = ha && ha.terrain === 'building' ? ha : hb;
      const c = hexToWorld(inner.q, inner.r);
      const mx = (gw.a.x + gw.b.x) / 2, mz = (gw.a.z + gw.b.z) / 2;
      const nl = Math.hypot(mx - c.x, mz - c.z);
      const n = { x: (mx - c.x) / nl, z: (mz - c.z) / nl };
      const el = Math.hypot(gw.b.x - gw.a.x, gw.b.z - gw.a.z);
      const e = { x: (gw.b.x - gw.a.x) / el, z: (gw.b.z - gw.a.z) / el };
      const gy = inner.height * HEX_HEIGHT_STEP;
      const at = (s, t) => ({ x: mx + e.x * s + n.x * t, z: mz + e.z * s + n.z * t });
      const PW = 0.27, PD = 0.42, PH = 1.0;
      const posts = [];
      for (const s of [-PW, PW]) {
        for (const t of [0.08, PD]) {
          const p = at(s, t);
          const gh = Math.min(gy, groundHeight(p.x, p.z));
          prism(B, p.x, gh - 0.1, p.z, 0.04, 0.036, gy + PH - gh + 0.1, COL.lacquer, 3, 6);
          prism(B, p.x, gh - 0.1, p.z, 0.062, 0.058, 0.17, COL.stone, 2, 6);
          posts.push(p);
        }
      }
      const ty = gy + PH - 0.05;
      for (const t of [0.08, PD]) {
        const a = at(-PW - 0.08, t), b = at(PW + 0.08, t);
        beam(B, V(a.x, ty, a.z), V(b.x, ty, b.z), 0.06, 0.08, COL.timber, 3);
      }
      for (const s of [-PW, PW]) {
        const a = at(s, 0.0), b = at(s, PD + 0.08);
        beam(B, V(a.x, ty + 0.06, a.z), V(b.x, ty + 0.06, b.z), 0.05, 0.05, COL.timber, 3);
      }
      { const a = at(-PW, PD), b = at(PW, PD); beam(B, V(a.x, gy + 0.74, a.z), V(b.x, gy + 0.74, b.z), 0.04, 0.05, COL.lacquer, 3); }
      { const p = at(0, PD + 0.025); hbox(B, p.x, gy + 0.8, gy + 0.91, p.z, e, 0.11, 0.012, COL.ridge, 0); }
      const rc = at(0, PD / 2 + 0.04);
      hipRoof(rc, e, n, 0.46, 0.34, gy + PH + 0.02, 0.32, 0.07);
      const lp = at(0, PD + 0.01);
      lanternSpots.push(V(lp.x, gy + 0.66, lp.z));
      const side = (cornerUse.get(ck(gw.b.x, gw.b.z)) || 0) > 1 ? -1 : 1;
      gateInfo.push({ banner: at(side * (PW + 0.2), PD + 0.25) });
    }
  }

  // --- Wooden structures: bridges, footbridges, fences ---
  const decks = []; // walkable bridge decks: sampled centre line (x, y, z) and half width, for units crossing them
  {
    const bridgeHexes = hexesByType.bridge || [];
    const bKey = (h) => `${h.q},${h.r}`;
    const bset = new Set(bridgeHexes.map(bKey));
    const seen = new Set();
    const nbs = (h) => HEX_DIRS.map(([dq, dr]) => allHexes.get(`${h.q + dq},${h.r + dr}`)).filter(Boolean);
    const cen = (h) => hexToWorld(h.q, h.r);
    const pickEnd = (h, prev) => {
      const c = cen(h), p = cen(prev);
      const ax = (c.x - p.x) / sqrt3, az = (c.z - p.z) / sqrt3;
      let best = null;
      for (const n of nbs(h)) {
        if (isWaterHex(n)) continue;
        const o = cen(n);
        const s = (n.terrain === 'road' ? 2 : 0) + ((o.x - c.x) * ax + (o.z - c.z) * az) / sqrt3;
        if (!best || s > best.s) best = { n, s };
      }
      return best && best.n;
    };
    const rng = makeRng(77);
    for (const start of bridgeHexes) {
      if (seen.has(bKey(start))) continue;
      const group = [start];
      seen.add(bKey(start));
      for (let i = 0; i < group.length; i++) {
        for (const n of nbs(group[i])) if (bset.has(bKey(n)) && !seen.has(bKey(n))) { seen.add(bKey(n)); group.push(n); }
      }
      const gset = new Set(group.map(bKey));
      let chain, endA, endB;
      if (group.length === 1) {
        const hex = start;
        let best = null;
        for (let d = 0; d < 3; d++) {
          const a = allHexes.get(`${hex.q + HEX_DIRS[d][0]},${hex.r + HEX_DIRS[d][1]}`);
          const b = allHexes.get(`${hex.q + HEX_DIRS[d + 3][0]},${hex.r + HEX_DIRS[d + 3][1]}`);
          if (!a || !b || isWaterHex(a) || isWaterHex(b)) continue;
          const score = (a.terrain === 'road') + (b.terrain === 'road');
          if (!best || score > best.score) best = { a, b, score };
        }
        if (!best) continue;
        chain = [hex]; endA = best.a; endB = best.b;
      } else {
        const deg = (h) => nbs(h).filter(n => gset.has(bKey(n))).length;
        const first = group.find(h => deg(h) <= 1) || group[0];
        chain = [first];
        const used = new Set([bKey(first)]);
        for (;;) {
          const nx = nbs(chain[chain.length - 1]).find(n => gset.has(bKey(n)) && !used.has(bKey(n)));
          if (!nx) break;
          used.add(bKey(nx));
          chain.push(nx);
        }
        endA = pickEnd(chain[0], chain[1]);
        endB = pickEnd(chain[chain.length - 1], chain[chain.length - 2]);
        if (!endA || !endB) continue;
      }
      const bank = (h, land) => {
        const c = cen(h), o = cen(land);
        const dx = (o.x - c.x) / sqrt3, dz = (o.z - c.z) / sqrt3;
        const x = (c.x + o.x) / 2 + dx * 0.38, z = (c.z + o.z) / 2 + dz * 0.38;
        return { x, z, y: Math.max(groundHeight(x, z), land.height * HEX_HEIGHT_STEP) + 0.05 };
      };
      const A = bank(chain[0], endA), Bk = bank(chain[chain.length - 1], endB);
      const curve = new THREE.CatmullRomCurve3([V(A.x, 0, A.z), ...chain.map(h => { const c = cen(h); return V(c.x, 0, c.z); }), V(Bk.x, 0, Bk.z)], false, 'centripetal');
      const L = curve.getLength();
      const arch = Math.min(0.3, 0.1 + 0.035 * L);
      const Y = (u) => A.y + (Bk.y - A.y) * u + arch * (1 - (2 * u - 1) ** 2);
      const P = (u) => { const p = curve.getPointAt(Math.min(1, Math.max(0, u))); p.y = Y(u); return p; };
      const F = (u) => { const du = 0.01; return frame(P(Math.min(1, u + du)).sub(P(Math.max(0, u - du)))); };
      const HW = 0.33;
      {
        const pts = [];
        const n = Math.max(8, Math.round(L / 0.1));
        for (let i = 0; i <= n; i++) { const p = P(i / n); pts.push({ x: p.x, y: p.y, z: p.z }); }
        const xs = pts.map(p => p.x), zs = pts.map(p => p.z), m = HW + 0.1;
        decks.push({ pts, hw: HW + 0.05, x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, z0: Math.min(...zs) - m, z1: Math.max(...zs) + m });
      }

      const nP = Math.round(L / 0.082);
      for (let i = 0; i < nP; i++) {
        const u = (i + 0.5) / nP;
        const { T, S, N } = F(u);
        const c = P(u).addScaledVector(N, -0.022);
        const j = 0.88 + rng() * 0.24;
        box(B, c.addScaledVector(S, (rng() - 0.5) * 0.03), T, N, S, 0.035, 0.02, HW + (rng() - 0.5) * 0.04, COL.wood.clone().multiplyScalar(j), 3);
      }
      const nS = Math.max(6, Math.round(L / 0.2));
      const along = (off, up, u0 = 0, u1 = 1) => Array.from({ length: nS + 1 }, (_, i) => {
        const u = u0 + (u1 - u0) * i / nS;
        const { S, N } = F(u);
        return P(u).addScaledVector(S, off).addScaledVector(N, up);
      });
      for (const off of [-0.24, 0, 0.24]) tube(B, along(off, -0.08), [[-0.03, -0.04], [0.03, -0.04], [0.03, 0.04], [-0.03, 0.04]], COL.woodDark, 3);
      for (const sg of [-1, 1]) {
        tube(B, along(sg * HW, 0.3, 0.005, 0.995), RAIL_PROF.map(([a, b]) => [a * 1.4, b * 1.2]), COL.lacquer, 3);
        tube(B, along(sg * HW, 0.15, 0.005, 0.995), RAIL_PROF, COL.woodDark, 3);
      }
      const nR = Math.max(2, Math.round(L / 0.45));
      for (let i = 0; i <= nR; i++) {
        const u = i / nR;
        const end = i === 0 || i === nR;
        const { T, S } = F(u);
        for (const sg of [-1, 1]) {
          const p = P(u).addScaledVector(S, sg * HW);
          const hgt = end ? 0.42 : 0.34;
          hbox(B, p.x, p.y - 0.05, p.y + hgt, p.z, T, end ? 0.035 : 0.022, end ? 0.035 : 0.022, end ? COL.lacquer : COL.woodDark, 3);
          if (end) {
            prism(B, p.x, p.y + hgt, p.z, 0.05, 0.0, 0.07, COL.ridge, 0, 4, Math.PI / 4);
            lanternSpots.push(V(p.x, p.y + hgt - 0.08, p.z).addScaledVector(T, i === 0 ? -0.06 : 0.06));
          }
        }
      }
      const nT = Math.max(1, Math.round(L / 0.85));
      for (let i = 1; i < nT; i++) {
        const u = i / nT;
        const c = P(u);
        if (groundHeight(c.x, c.z) > WATER_LEVEL + 0.05) continue;
        const { S } = F(u);
        const top = c.y - 0.12;
        const pp = [];
        for (const sg of [-1, 1]) {
          const t = c.clone().addScaledVector(S, sg * 0.25);
          const bx = c.x + S.x * sg * 0.34, bz = c.z + S.z * sg * 0.34;
          const b = V(bx, Math.min(groundHeight(bx, bz), RIVERBED_HEIGHT + 0.1) - 0.1, bz);
          t.y = top;
          beam(B, b, t, 0.065, 0.065, COL.woodDark, 3);
          pp.push({ t, b });
        }
        beam(B, c.clone().addScaledVector(S, -0.4).setY(top + 0.01), c.clone().addScaledVector(S, 0.4).setY(top + 0.01), 0.08, 0.07, COL.woodDark, 3);
        const lo = WATER_LEVEL + 0.05;
        const mix = (k, y) => { const { t, b } = pp[k]; const f = (y - b.y) / (t.y - b.y); return V(b.x + (t.x - b.x) * f, y, b.z + (t.z - b.z) * f); };
        beam(B, mix(0, lo), mix(1, top - 0.06), 0.035, 0.035, COL.woodDark, 3);
        beam(B, mix(1, lo), mix(0, top - 0.06), 0.035, 0.035, COL.woodDark, 3);
      }
      for (const [u, sg] of [[0.24 / L, -1], [1 - 0.24 / L, 1]]) {
        const c = P(u);
        const { T, S } = F(u);
        const top = c.y - 0.06;
        box(B, V(c.x, (top + WATER_LEVEL - 0.35) / 2, c.z), V(T.x, 0, T.z).normalize(), UP, S, 0.26, (top - WATER_LEVEL + 0.35) / 2, HW + 0.08, COL.stone, 2);
      }
    }

    for (const fb of footbridges) {
      const pa = hexToWorld(fb.q1, fb.r1), pb = hexToWorld(fb.q2, fb.r2);
      const mx = (fb.a.x + fb.b.x) / 2, mz = (fb.a.z + fb.b.z) / 2;
      const ux = (pb.x - pa.x) / sqrt3, uz = (pb.z - pa.z) / sqrt3;
      const px = -uz, pz = ux;
      const L = 0.5;
      const yy = Math.max(groundHeight(mx - ux * L, mz - uz * L), groundHeight(mx + ux * L, mz + uz * L)) + 0.05;
      for (let k = -3; k <= 3; k++) {
        const ox = px * k * 0.04, oz = pz * k * 0.04;
        beam(B, V(mx - ux * L + ox, yy, mz - uz * L + oz), V(mx + ux * L + ox, yy, mz + uz * L + oz), 0.035, 0.03, COL.wood, 3);
      }
      for (const side of [-1, 1]) {
        beam(B, V(mx - ux * L + px * 0.15 * side, yy + 0.14, mz - uz * L + pz * 0.15 * side), V(mx + ux * L + px * 0.15 * side, yy + 0.14, mz + uz * L + pz * 0.15 * side), 0.025, 0.025, COL.wood, 3);
        for (const t of [-L, 0, L]) prism(B, mx + ux * t + px * 0.15 * side, yy - 0.05, mz + uz * t + pz * 0.15 * side, 0.018, 0.018, 0.2, COL.wood, 3);
      }
    }

    for (const [segKey, type] of Object.entries(segmentData)) {
      if (type !== 'barriere' && type !== 'chevaux_de_frise') continue;
      const s = parseSeg(segKey);
      const ec = edgeCorners(s.q1, s.r1, s.q2, s.r2);
      if (!ec) continue;
      const pts = [];
      for (let i = 0; i <= 4; i++) {
        const t = 0.06 + i / 4 * 0.88;
        const x = ec[0].x + (ec[1].x - ec[0].x) * t, z = ec[0].z + (ec[1].z - ec[0].z) * t;
        pts.push(V(x, groundHeight(x, z), z));
      }
      for (const p of pts) prism(B, p.x, p.y - 0.05, p.z, 0.022, 0.02, 0.27, COL.wood, 3);
      for (let i = 0; i < pts.length - 1; i++) {
        for (const hy of [0.1, 0.19]) beam(B, pts[i].clone().setY(pts[i].y + hy), pts[i + 1].clone().setY(pts[i + 1].y + hy), 0.02, 0.025, COL.wood, 3);
      }
    }
  }

  if (W.count) {
    const wm = new THREE.MeshStandardMaterial({ color: 0x24170c, emissive: 0xffa24a, emissiveIntensity: 0, roughness: 0.8, side: THREE.DoubleSide });
    windowMats.push(wm);
    const g = W.geometry();
    g.deleteAttribute('aK');
    g.deleteAttribute('color');
    scene.add(new THREE.Mesh(g, wm));
  }
  if (B.count) {
    const m = new THREE.Mesh(B.geometry(), buildMat);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
  if (R.count) {
    const m = new THREE.Mesh(R.geometry(), roofMat);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }

  // Banners flying downwind at compound gateways
  {
    const items = [], cloths = [];
    const wd = G.uWindDir.value;
    const ry = Math.atan2(-wd.y, wd.x);
    for (const { banner } of gateInfo) {
      const { x, z } = banner;
      const y = groundHeight(x, z) - 0.05;
      items.push({ x, y, z, s: 1 });
      cloths.push({ x, y: y + 1.45, z, s: 1, ry });
    }
    if (items.length) {
      const poleMat = patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 }), {}, null, 'pole');
      vegGroup.add(VEG.instanced(VEG.makeBannerGeometry(), poleMat, items, { castShadow: true }));
      const clothMat = patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), {}, (shader) => {
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            float ph = instanceMatrix[ 3 ].x * 1.3 + instanceMatrix[ 3 ].z * 0.7;
            float u = clamp( position.x / 0.55, 0.0, 1.0 );
            float w = sin( position.x * 9.0 - uTime * 6.5 + ph ) * 0.05 + sin( position.x * 5.0 - uTime * 3.7 + ph * 2.0 ) * 0.03;
            transformed.z += w * u * ( 0.6 + 0.4 * uWindStrength );
            transformed.y -= u * u * 0.06 * ( 1.2 - uWindStrength * 0.5 );
          }`);
      }, 'cloth');
      vegGroup.add(VEG.instanced(VEG.makeClothGeometry(), clothMat, cloths, { castShadow: false }));
    }
  }

  // Lanterns (glow at dusk/night, bloom picks them up)
  if (lanternSpots.length) {
    const m = new THREE.MeshStandardMaterial({ color: 0xb04a2a, emissive: 0xffa040, emissiveIntensity: 0, roughness: 0.7 });
    lanternMats.push(m);
    vegGroup.add(VEG.instanced(new THREE.SphereGeometry(0.055, 8, 6), m, lanternSpots.map(p => ({ x: p.x, y: p.y, z: p.z, s: 1 }))));
  }

  return { waterwheels, smokeSources, lanternSpots, decks };
}
