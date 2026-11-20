import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, patchLit } from './shaderPatches.js';
import { makeRng } from './noise.js';
import * as VEG from './vegetation.js';

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

  // --- Building compounds ---
  const woodMat = patchLit(new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.85, flatShading: true }), {}, null, 'wood');
  const waterwheels = [];
  const smokeSources = [];
  const lanternSpots = [];
  {
    const WALL_HEIGHT = 0.7;
    const WALL_THICKNESS = 0.1;
    const compoundWallMat = patchLit(new THREE.MeshStandardMaterial({ color: 0xa48f70, roughness: 0.9, flatShading: true }), {}, (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float course = smoothstep( 0.0, 0.08, abs( fract( vPWorld.y * 9.0 ) - 0.5 ) * 2.0 - 0.86 );
        diffuseColor.rgb *= ( 0.86 + 0.28 * texture2D( uNoise, vPWorld.xz * 2.3 + vPWorld.y ).b ) * ( 1.0 - 0.18 * course );`);
    }, 'wall');
    const roofMat = patchLit(new THREE.MeshStandardMaterial({ color: 0x7c3f24, roughness: 0.7, flatShading: true }), {}, (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float rowL = abs( fract( vPWorld.y * 16.0 ) - 0.5 ) * 2.0;
        diffuseColor.rgb *= ( 0.78 + 0.22 * smoothstep( 0.0, 0.5, rowL ) ) * ( 0.85 + 0.3 * texture2D( uNoise, vPWorld.xz * 3.1 ).b );`);
    }, 'roof');

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

    const wallGeos = [], roofGeos = [], windowGeos = [];
    const winRng = makeRng(2024);
    for (const cluster of clusters) {
      const clusterSet = new Set(cluster.map(h => `${h.q},${h.r}`));

      // Compound walls along "mur" edges (sunk into the ground)
      for (const hex of cluster) {
        const wp = hexToWorld(hex.q, hex.r);
        const baseY = hex.height * HEX_HEIGHT_STEP;
        for (let d = 0; d < 6; d++) {
          const [dq, dr] = HEX_DIRS[d];
          if (getSegType(hex.q, hex.r, hex.q + dq, hex.r + dr) !== 'mur') continue;
          const geoEdge = DIR_TO_GEO_EDGE[d];
          const c0 = hexCorner(wp.x, wp.z, geoEdge);
          const c1 = hexCorner(wp.x, wp.z, (geoEdge + 1) % 6);
          const edgeDx = c1.x - c0.x, edgeDz = c1.z - c0.z;
          const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDz * edgeDz);
          const nx = edgeDz / edgeLen, nz = -edgeDx / edgeLen;
          const halfT = WALL_THICKNESS / 2;
          const positions = [], normals = [], indices = [];
          const wallBottom = baseY - 0.5;
          positions.push(c0.x + nx * halfT, wallBottom, c0.z + nz * halfT);
          positions.push(c1.x + nx * halfT, wallBottom, c1.z + nz * halfT);
          positions.push(c1.x + nx * halfT, baseY + WALL_HEIGHT, c1.z + nz * halfT);
          positions.push(c0.x + nx * halfT, baseY + WALL_HEIGHT, c0.z + nz * halfT);
          for (let v = 0; v < 4; v++) normals.push(nx, 0, nz);
          indices.push(0, 1, 2, 0, 2, 3);
          positions.push(c0.x - nx * halfT, wallBottom, c0.z - nz * halfT);
          positions.push(c1.x - nx * halfT, wallBottom, c1.z - nz * halfT);
          positions.push(c1.x - nx * halfT, baseY + WALL_HEIGHT, c1.z - nz * halfT);
          positions.push(c0.x - nx * halfT, baseY + WALL_HEIGHT, c0.z - nz * halfT);
          for (let v = 0; v < 4; v++) normals.push(-nx, 0, -nz);
          indices.push(4, 6, 5, 4, 7, 6);
          positions.push(c0.x - nx * halfT, baseY + WALL_HEIGHT, c0.z - nz * halfT);
          positions.push(c1.x - nx * halfT, baseY + WALL_HEIGHT, c1.z - nz * halfT);
          positions.push(c1.x + nx * halfT, baseY + WALL_HEIGHT, c1.z + nz * halfT);
          positions.push(c0.x + nx * halfT, baseY + WALL_HEIGHT, c0.z + nz * halfT);
          for (let v = 0; v < 4; v++) normals.push(0, 1, 0);
          indices.push(8, 9, 10, 8, 10, 11);
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
          geo.setIndex(indices);
          wallGeos.push(geo);
          if (winRng() < 0.75) {
            const ww = 0.15, wh = 0.13, wy = baseY + 0.36;
            const t = 0.35 + winRng() * 0.3;
            const cx = c0.x + edgeDx * t + nx * (halfT + 0.004), cz = c0.z + edgeDz * t + nz * (halfT + 0.004);
            const ex = edgeDx / edgeLen * ww / 2, ez = edgeDz / edgeLen * ww / 2;
            const wg = new THREE.BufferGeometry();
            wg.setAttribute('position', new THREE.Float32BufferAttribute([
              cx - ex, wy - wh / 2, cz - ez, cx + ex, wy - wh / 2, cz + ez, cx + ex, wy + wh / 2, cz + ez, cx - ex, wy + wh / 2, cz - ez,
            ], 3));
            wg.setAttribute('normal', new THREE.Float32BufferAttribute([nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz], 3));
            wg.setIndex([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
            windowGeos.push(wg);
          }
        }
      }

      // Roof: triangle-vertex peaks
      const ROOF_HIGH = 0.55;
      const ROOF_LOW = 0.3;
      const baseY = cluster[0].height * HEX_HEIGHT_STEP + WALL_HEIGHT;
      const peakY = baseY + ROOF_HIGH;
      const centerY = baseY + ROOF_LOW;
      const peakSet = new Set();
      for (const hex of cluster) {
        const wp = hexToWorld(hex.q, hex.r);
        for (let i = 0; i < 6; i++) {
          const [d0, d1] = CORNER_NEIGHBORS[i];
          if (clusterSet.has(`${hex.q + d0[0]},${hex.r + d0[1]}`) && clusterSet.has(`${hex.q + d1[0]},${hex.r + d1[1]}`)) {
            const c = hexCorner(wp.x, wp.z, i);
            peakSet.add(`${c.x.toFixed(3)},${c.z.toFixed(3)}`);
          }
        }
      }
      const isPeak = (wx, wz) => peakSet.has(`${wx.toFixed(3)},${wz.toFixed(3)}`);
      let chimney = null;
      for (const hex of cluster) {
        const wp = hexToWorld(hex.q, hex.r);
        const corners = [];
        for (let i = 0; i < 6; i++) corners.push(hexCorner(wp.x, wp.z, i));
        let peakCount = 0;
        for (let i = 0; i < 6; i++) if (isPeak(corners[i].x, corners[i].z)) peakCount++;
        const hexCenterY = peakCount >= 2 ? peakY : centerY;
        const positions = [wp.x, hexCenterY, wp.z];
        const normals = [0, 1, 0];
        for (let i = 0; i < 6; i++) {
          const pk = isPeak(corners[i].x, corners[i].z);
          positions.push(corners[i].x, pk ? peakY : baseY, corners[i].z);
          normals.push(0, 1, 0);
          if (pk && !chimney) chimney = { x: corners[i].x, y: peakY, z: corners[i].z };
        }
        const indices = [];
        for (let i = 0; i < 6; i++) indices.push(0, 1 + (i + 1) % 6, 1 + i);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();
        roofGeos.push(geo);
      }
      if (!chimney) {
        const wp = hexToWorld(cluster[0].q, cluster[0].r);
        chimney = { x: wp.x, y: centerY, z: wp.z };
      }
      smokeSources.push(chimney);

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
    if (windowGeos.length) {
      const wm = new THREE.MeshStandardMaterial({ color: 0x24170c, emissive: 0xffa24a, emissiveIntensity: 0, roughness: 0.8 });
      windowMats.push(wm);
      scene.add(new THREE.Mesh(mergeGeometries(windowGeos), wm));
    }
    const walls = new THREE.Mesh(mergeGeometries(wallGeos), compoundWallMat);
    walls.castShadow = walls.receiveShadow = true;
    const roofs = new THREE.Mesh(mergeGeometries(roofGeos), roofMat);
    roofs.castShadow = roofs.receiveShadow = true;
    scene.add(walls, roofs);
  }

  // --- Wooden structures: bridges, footbridges, gates, fences ---
  {
    const parts = [];
    const tmpQ = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0);
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    function beam(p0, p1, w, h) {
      const dir = new THREE.Vector3().subVectors(p1, p0);
      const len = dir.length();
      const g = new THREE.BoxGeometry(len, h, w);
      tmpQ.setFromUnitVectors(X, dir.normalize());
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5), tmpQ, V(1, 1, 1)));
      return g;
    }
    function post(x, y, z, r, h) {
      const g = new THREE.CylinderGeometry(r, r * 1.1, h, 6);
      g.translate(x, y + h / 2, z);
      return g;
    }

    // Arched bridges over river hexes
    for (const hex of hexesByType.bridge || []) {
      const wp = hexToWorld(hex.q, hex.r);
      let best = null;
      for (let d = 0; d < 3; d++) {
        const a = allHexes.get(`${hex.q + HEX_DIRS[d][0]},${hex.r + HEX_DIRS[d][1]}`);
        const b = allHexes.get(`${hex.q + HEX_DIRS[d + 3][0]},${hex.r + HEX_DIRS[d + 3][1]}`);
        if (!a || !b || isWaterHex(a) || isWaterHex(b)) continue;
        const score = (a.terrain === 'road') + (b.terrain === 'road');
        if (!best || score > best.score) best = { a, b, score };
      }
      if (!best) {
        const deck = new THREE.CylinderGeometry(0.95, 0.95, 0.12, 6);
        deck.translate(wp.x, hex.height, wp.z);
        parts.push(deck);
        continue;
      }
      const pa = hexToWorld(best.a.q, best.a.r), pb = hexToWorld(best.b.q, best.b.r);
      const ux = (pb.x - pa.x) / (2 * sqrt3), uz = (pb.z - pa.z) / (2 * sqrt3);
      const px = -uz, pz = ux;
      const half = 1.25, segs = 10, width = 0.34;
      const yEnd = Math.max(effH(best.a), effH(best.b)) + 0.04;
      const arch = 0.2;
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const s = i / segs * 2 - 1;
        pts.push(V(wp.x + ux * half * s, yEnd + arch * (1 - s * s), wp.z + uz * half * s));
      }
      for (let i = 0; i < segs; i++) {
        parts.push(beam(pts[i], pts[i + 1], width * 2, 0.07));
        for (const side of [-1, 1]) {
          const o0 = pts[i].clone().add(V(px * width * side, 0.18, pz * width * side));
          const o1 = pts[i + 1].clone().add(V(px * width * side, 0.18, pz * width * side));
          parts.push(beam(o0, o1, 0.035, 0.035));
        }
      }
      for (let i = 0; i <= segs; i += 2) {
        for (const side of [-1, 1]) parts.push(post(pts[i].x + px * width * side, pts[i].y - 0.02, pts[i].z + pz * width * side, 0.025, 0.2));
      }
      for (const s of [-0.45, 0.45]) {
        const cx = wp.x + ux * half * s, cz = wp.z + uz * half * s;
        for (const side of [-1, 1]) parts.push(post(cx + px * width * 0.8 * side, RIVERBED_HEIGHT, cz + pz * width * 0.8 * side, 0.05, yEnd + arch * (1 - s * s) - RIVERBED_HEIGHT));
      }
      for (const side of [-1, 1]) lanternSpots.push(V(pts[0].x + px * width * side, pts[0].y + 0.24, pts[0].z + pz * width * side));
    }

    // Footbridges over streams
    for (const fb of footbridges) {
      const pa = hexToWorld(fb.q1, fb.r1), pb = hexToWorld(fb.q2, fb.r2);
      const mx = (fb.a.x + fb.b.x) / 2, mz = (fb.a.z + fb.b.z) / 2;
      const ux = (pb.x - pa.x) / sqrt3, uz = (pb.z - pa.z) / sqrt3;
      const px = -uz, pz = ux;
      const L = 0.5;
      const yy = Math.max(groundHeight(mx - ux * L, mz - uz * L), groundHeight(mx + ux * L, mz + uz * L)) + 0.05;
      for (let k = -3; k <= 3; k++) {
        const ox = px * k * 0.04, oz = pz * k * 0.04;
        parts.push(beam(V(mx - ux * L + ox, yy, mz - uz * L + oz), V(mx + ux * L + ox, yy, mz + uz * L + oz), 0.035, 0.03));
      }
      for (const side of [-1, 1]) {
        parts.push(beam(V(mx - ux * L + px * 0.15 * side, yy + 0.14, mz - uz * L + pz * 0.15 * side), V(mx + ux * L + px * 0.15 * side, yy + 0.14, mz + uz * L + pz * 0.15 * side), 0.025, 0.025));
        for (const t of [-L, 0, L]) parts.push(post(mx + ux * t + px * 0.15 * side, yy - 0.05, mz + uz * t + pz * 0.15 * side, 0.018, 0.2));
      }
    }

    // Compound gateways (passerelle segments on building edges)
    for (const gw of gateways) {
      const mx = (gw.a.x + gw.b.x) / 2, mz = (gw.a.z + gw.b.z) / 2;
      const ex = gw.b.x - gw.a.x, ez = gw.b.z - gw.a.z;
      const y = groundHeight(mx, mz);
      const h = 0.95;
      const p0 = V(mx - ex * 0.42, y, mz - ez * 0.42), p1 = V(mx + ex * 0.42, y, mz + ez * 0.42);
      parts.push(post(p0.x, y - 0.1, p0.z, 0.045, h + 0.1), post(p1.x, y - 0.1, p1.z, 0.045, h + 0.1));
      parts.push(beam(V(p0.x - ex * 0.12, y + h, p0.z - ez * 0.12), V(p1.x + ex * 0.12, y + h, p1.z + ez * 0.12), 0.12, 0.06));
      parts.push(beam(V(p0.x, y + h - 0.16, p0.z), V(p1.x, y + h - 0.16, p1.z), 0.06, 0.04));
      lanternSpots.push(V(mx, y + h - 0.3, mz));
    }

    // Fences on barrier segments
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
      for (const p of pts) parts.push(post(p.x, p.y - 0.05, p.z, 0.022, 0.27));
      for (let i = 0; i < pts.length - 1; i++) {
        for (const hy of [0.1, 0.19]) parts.push(beam(pts[i].clone().setY(pts[i].y + hy), pts[i + 1].clone().setY(pts[i + 1].y + hy), 0.02, 0.025));
      }
    }

    const strip = (g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; };
    if (parts.length) {
      const wood = new THREE.Mesh(mergeGeometries(parts.map(strip)), woodMat);
      wood.castShadow = wood.receiveShadow = true;
      scene.add(wood);
    }
  }

  // Banners flying downwind at compound gateways
  {
    const items = [], cloths = [];
    const wd = G.uWindDir.value;
    const ry = Math.atan2(-wd.y, wd.x);
    for (const gw of gateways) {
      const mx = (gw.a.x + gw.b.x) / 2, mz = (gw.a.z + gw.b.z) / 2;
      const x = mx + (gw.b.x - gw.a.x) * 0.5, z = mz + (gw.b.z - gw.a.z) * 0.5;
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

  return { waterwheels, smokeSources, lanternSpots };
}
