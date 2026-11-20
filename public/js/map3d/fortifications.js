// Map features from map.decor (see public/js/mapProps.js): fortress ramparts, gatehouses, watchtowers, camp tents,
// banners, stone stairs and campfires. Drawn into the building buffers of buildings.js through its decorate hook,
// so they share its materials (stone courses, bricks, lacquer, tiled roofs), shadows and lanterns.
export function buildFortifications(api, map) {
  const { B, COL, V, C, beam, hbox, prism, hipRoof, banners, lanternSpots, smokeSources } = api;
  const { decor, allHexes, hexToWorld, hexCorner, edgeCorners, groundHeight, effH, getSegType, HEX_DIRS, HEX_HEIGHT_STEP } = map;
  const ramparts = new Set((decor && decor.ramparts) || []);
  const props = (decor && decor.props) || [];
  if (!ramparts.size && !props.length) return;

  const K = { stone: C(0xa39582), stoneDark: C(0x7f7467), pave: C(0x8a8070), cloth: C(0xd8ccb0), clothDark: C(0xb9ab8b), red: C(0xa8352a), gold: C(0xb58a3a) };
  const top = (h) => h.height * HEX_HEIGHT_STEP;
  const hk = (q, r) => `${q},${r}`;
  // masonry only where the drop is sheer (cliff / wall segment) or at the map border; inner slopes stay earthen ramps
  const isWallEdge = (h, n) => {
    if (!n) return true;
    if (ramparts.has(hk(n.q, n.r))) return false;
    const s = getSegType(h.q, h.r, n.q, n.r);
    return (s === 'cliff' || s === 'mur') && effH(n) < top(h) - 0.3;
  };
  const dirVec = (q, r, d) => {
    const a = hexToWorld(q, r), b = hexToWorld(q + HEX_DIRS[d][0], r + HEX_DIRS[d][1]);
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  };
  const gateHexes = new Set(props.filter((p) => p.type === 'porte').map((p) => hk(p.q, p.r)));

  // --- Ramparts: paved wall-walk, masonry faces with a battered foot, parapet and merlons on every drop ---
  const pillars = new Set();
  for (const k of ramparts) {
    const h = allHexes.get(k);
    if (!h) continue;
    const c = hexToWorld(h.q, h.r);
    const y = top(h);
    // paving on the flat top only (the inner side slopes down as an earthen ramp)
    const pv = Array.from({ length: 6 }, (_, i) => { const p = hexCorner(c.x, c.z, i); return V(c.x + (p.x - c.x) * 0.6, y + 0.025, c.z + (p.z - c.z) * 0.6); });
    const mid = V(c.x, y + 0.025, c.z);
    for (let i = 0; i < 6; i++) B.tri(mid, pv[(i + 1) % 6], pv[i], K.pave, 2);
    for (let d = 0; d < 6; d++) {
      const nq = h.q + HEX_DIRS[d][0], nr = h.r + HEX_DIRS[d][1];
      const n = allHexes.get(hk(nq, nr));
      if (!isWallEdge(h, n)) continue;
      const ec = edgeCorners(h.q, h.r, nq, nr);
      if (!ec) continue;
      const [a, b] = ec;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      const t = { x: b.x - a.x, z: b.z - a.z };
      const tl = Math.hypot(t.x, t.z);
      const tan = { x: t.x / tl, z: t.z / tl };
      const out = { x: mx - c.x, z: mz - c.z };
      const ol = Math.hypot(out.x, out.z);
      out.x /= ol; out.z /= ol;
      const low = (n ? Math.min(effH(n), groundHeight(mx + out.x * 0.35, mz + out.z * 0.35)) : y - 2) - 0.45;
      const gate = n && gateHexes.has(hk(n.q, n.r));
      // wall body, slightly proud of the edge so the terrain step stays hidden
      hbox(B, mx + out.x * 0.02, low, y + 0.03, mz + out.z * 0.02, tan, tl / 2 + 0.05, 0.14, K.stone, 1);
      // battered foot
      if (!gate) hbox(B, mx + out.x * 0.1, low, low + Math.min(0.75, (y - low) * 0.35), mz + out.z * 0.1, tan, tl / 2 + 0.06, 0.12, K.stoneDark, 1);
      // parapet + merlons
      const px = mx - out.x * 0.07, pz = mz - out.z * 0.07;
      hbox(B, px, y, y + 0.17, pz, tan, tl / 2 + 0.03, 0.05, K.stoneDark, 1);
      for (const s of [-0.34, 0, 0.34]) {
        hbox(B, px + tan.x * s, y + 0.17, y + 0.31, pz + tan.z * s, tan, 0.09, 0.055, K.stoneDark, 1);
      }
      for (const p of [a, b]) {
        const ck = `${Math.round(p.x * 100)},${Math.round(p.z * 100)}`;
        if (pillars.has(ck)) continue;
        pillars.add(ck);
        prism(B, p.x, low, p.z, 0.17, 0.15, y + 0.2 - low, K.stone, 1, 6);
      }
    }
  }

  // --- Point features ---
  for (const p of props) {
    const h = allHexes.get(hk(p.q, p.r));
    if (!h) continue;
    const c = hexToWorld(h.q, h.r);
    const ax = dirVec(h.q, h.r, p.rot || 0);
    const nx = { x: -ax.z, z: ax.x };
    const at = (u, v) => ({ x: c.x + ax.x * u + nx.x * v, z: c.z + ax.z * u + nx.z * v });
    const gy = groundHeight(c.x, c.z);
    switch (p.type) {
      case 'porte': gatehouse(h, c, ax, nx, at, gy); break;
      case 'tour': tower(c, gy); break;
      case 'tente': tent(at, ax, nx, 0.42, 0.3, 0.36, K.cloth); break;
      case 'tente_cmd': {
        tent(at, ax, nx, 0.7, 0.5, 0.55, K.red);
        const b = at(-0.55, 0.62);
        banners.push({ banner: { x: b.x, z: b.z } });
        break;
      }
      case 'banniere': banners.push({ banner: { x: c.x + 0.15, z: c.z } }); break;
      case 'escalier': stairs(at, ax); break;
      case 'feu': campfire(c, gy); break;
      default: break;
    }
  }

  function gatehouse(h, c, ax, nx, at, gy) {
    let tY = top(h) + 2 * HEX_HEIGHT_STEP;
    let best = -Infinity;
    for (const [dq, dr] of HEX_DIRS) {
      const n = allHexes.get(hk(h.q + dq, h.r + dr));
      if (n && ramparts.has(hk(n.q, n.r))) best = Math.max(best, top(n));
    }
    if (best > -Infinity) tY = best;
    const floor = gy;
    // pylons on both sides of the passage
    for (const s of [-1, 1]) {
      const p = at(0, s * 0.66);
      hbox(B, p.x, floor - 0.4, tY + 0.06, p.z, ax, 0.6, 0.3, K.stone, 1);
      const f = at(0.55, s * 0.66);
      hbox(B, f.x, floor - 0.4, floor + 0.5, f.z, ax, 0.12, 0.34, K.stoneDark, 1);
    }
    // lintel over the passage
    const l = at(0, 0);
    hbox(B, l.x, tY - 0.5, tY + 0.06, l.z, nx, 0.98, 0.6, K.stone, 1);
    // doors pushed open against the pylons, studded lacquer
    for (const s of [-1, 1]) {
      const d = at(0.45, s * 0.3);
      hbox(B, d.x, floor, Math.min(tY - 0.5, floor + 1.25), d.z, ax, 0.2, 0.035, COL.lacquer, 3);
    }
    // gate-tower platform and two-storey pavilion
    const pl = at(0, 0);
    hbox(B, pl.x, tY + 0.06, tY + 0.13, pl.z, nx, 1.02, 0.66, K.pave, 2);
    for (const u of [-0.42, 0.42]) {
      for (const v of [-0.78, -0.26, 0.26, 0.78]) {
        const q = at(u, v);
        prism(B, q.x, tY + 0.13, q.z, 0.04, 0.035, 0.55, COL.lacquer, 3, 6);
      }
      const rail = at(u, 0);
      hbox(B, rail.x, tY + 0.13, tY + 0.3, rail.z, nx, 0.8, 0.02, COL.timber, 3);
    }
    hipRoof(at(0, 0), nx, ax, 0.98, 0.58, tY + 0.68, 0.3, 0.09, 4);
    const body = at(0, 0);
    hbox(B, body.x, tY + 0.7, tY + 1.0, body.z, nx, 0.62, 0.34, COL.plaster, 0);
    hipRoof(at(0, 0), nx, ax, 0.8, 0.48, tY + 1.0, 0.42, 0.1, 4);
    for (const s of [-1, 1]) {
      const lp = at(0.62, s * 0.55);
      lanternSpots.push(V(lp.x, tY + 0.5, lp.z));
      const b = at(0.75, s * 0.95);
      banners.push({ banner: { x: b.x, z: b.z } });
    }
  }

  function tower(c, gy) {
    const h0 = gy, H = 1.05;
    const X = { x: 1, z: 0 }, Z = { x: 0, z: 1 };
    hbox(B, c.x, h0 - 0.4, h0 + H, c.z, X, 0.38, 0.38, K.stone, 1);
    hbox(B, c.x, h0 + H, h0 + H + 0.06, c.z, X, 0.44, 0.44, K.pave, 2);
    for (const [dx, dz] of [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]]) {
      prism(B, c.x + dx, h0 + H + 0.06, c.z + dz, 0.035, 0.03, 0.42, COL.lacquer, 3, 6);
    }
    for (const [dx, dz, dir] of [[0, -0.4, X], [0, 0.4, X], [-0.4, 0, Z], [0.4, 0, Z]]) {
      hbox(B, c.x + dx, h0 + H + 0.06, h0 + H + 0.18, c.z + dz, dir, 0.36, 0.025, COL.timber, 3);
    }
    hipRoof({ x: c.x, z: c.z }, X, Z, 0.46, 0.46, h0 + H + 0.48, 0.34, 0.08, 4);
    lanternSpots.push(V(c.x + 0.42, h0 + H - 0.1, c.z));
  }

  function tent(at, ax, nx, L, W, Ht, col) {
    const y = (u, v) => { const p = at(u, v); return groundHeight(p.x, p.z) - 0.02; };
    const P = (u, v, dy) => { const p = at(u, v); return V(p.x, dy, p.z); };
    const r0 = P(-L, 0, y(-L, 0) + Ht), r1 = P(L, 0, y(L, 0) + Ht);
    const a0 = P(-L, W, y(-L, W)), a1 = P(L, W, y(L, W)), b0 = P(-L, -W, y(-L, -W)), b1 = P(L, -W, y(L, -W));
    B.quad(a0, a1, r1, r0, col, 0);
    B.quad(b1, b0, r0, r1, col, 0);
    B.tri(a0, r0, b0, K.clothDark, 0);
    B.tri(b1, r1, a1, K.clothDark, 0);
    beam(B, V(r0.x, r0.y + 0.015, r0.z), V(r1.x, r1.y + 0.015, r1.z), 0.03, 0.03, COL.timber, 3);
    for (const u of [-L - 0.08, L + 0.08]) {
      const p = at(u, 0);
      const g = groundHeight(p.x, p.z);
      beam(B, V(p.x, g - 0.05, p.z), V(p.x, g + Ht + 0.12, p.z), 0.025, 0.025, COL.timber, 3);
    }
  }

  function stairs(at, ax) {
    for (let i = 0; i <= 8; i++) {
      const u = -0.85 + i * 0.2125;
      const p = at(u, 0);
      const y = groundHeight(p.x, p.z);
      hbox(B, p.x, y - 0.55, y + 0.045, p.z, ax, 0.11, 0.36, K.pave, 2);
    }
    for (const v of [-0.4, 0.4]) {
      const a = at(-0.9, v), b = at(0.9, v);
      beam(B, V(a.x, groundHeight(a.x, a.z) + 0.05, a.z), V(b.x, groundHeight(b.x, b.z) + 0.05, b.z), 0.06, 0.08, K.stoneDark, 1);
    }
  }

  function campfire(c, gy) {
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2;
      prism(B, c.x + Math.cos(a) * 0.16, gy - 0.03, c.z + Math.sin(a) * 0.16, 0.05, 0.035, 0.07, K.stoneDark, 1, 5);
    }
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI;
      beam(B, V(c.x - Math.cos(a) * 0.13, gy + 0.03, c.z - Math.sin(a) * 0.13), V(c.x + Math.cos(a) * 0.13, gy + 0.05, c.z + Math.sin(a) * 0.13), 0.035, 0.035, COL.woodDark, 3);
    }
    smokeSources.push({ x: c.x, y: gy + 0.1, z: c.z });
    lanternSpots.push(V(c.x, gy + 0.08, c.z));
  }

}
