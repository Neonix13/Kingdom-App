// Map features from map.decor (see public/js/mapProps.js): fortress ramparts, gates, watchtowers, camp tents,
// banners, stone stairs and campfires. Drawn into the building buffers of buildings.js through its decorate hook,
// so they share its materials (stone courses, bricks, lacquer, tiled roofs), shadows and lanterns.
// Ramparts are drawn as one continuous wall through the centres of neighbouring rampart hexes (straight where the hexes
// line up) instead of following the hex outlines; adjacent gate props form one wide gate with several passages.
export function buildFortifications(api, map) {
  const { B, W, COL, V, C, beam, hbox, prism, hipRoof, banners, lanternSpots, smokeSources } = api;
  const { decor, allHexes, hexToWorld, hexCorner, groundHeight, HEX_DIRS, HEX_HEIGHT_STEP } = map;
  const ramparts = new Set((decor && decor.ramparts) || []);
  const props = (decor && decor.props) || [];
  if (!ramparts.size && !props.length) return;

  const K = { stone: C(0xa39582), stoneDark: C(0x7f7467), pave: C(0x8a8070), cloth: C(0xd8ccb0), clothDark: C(0xb9ab8b), red: C(0xa8352a), gold: C(0xb58a3a) };
  const top = (h) => h.height * HEX_HEIGHT_STEP;
  const hk = (q, r) => `${q},${r}`;
  const S3 = Math.sqrt(3);
  const WALL_OUT = 1.0, WALL_IN = 0.86;
  const dirVec = (q, r, d) => {
    const a = hexToWorld(q, r), b = hexToWorld(q + HEX_DIRS[d][0], r + HEX_DIRS[d][1]);
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  };
  const Vxz = (p, y) => V(p.x, y, p.z);

  // --- Rampart graph: links between neighbouring rampart hexes ---
  const nodes = new Map();
  for (const k of ramparts) { const h = allHexes.get(k); if (h) nodes.set(k, h); }
  const linkOf = new Map();
  const addLink = (a, b) => { if (!linkOf.has(a)) linkOf.set(a, []); linkOf.get(a).push(b); };
  const wallLinks = [];
  for (const [k, h] of nodes) {
    for (const [dq, dr] of HEX_DIRS) {
      const nk = hk(h.q + dq, h.r + dr);
      if (!nodes.has(nk) || nk < k) continue;
      wallLinks.push([k, nk]);
      addLink(k, nk);
      addLink(nk, k);
    }
  }
  // in a triangle of rampart hexes keep two sides only, so clusters don't become a lattice of crossing walls
  const linkKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const dropped = new Set();
  for (const [ka, kb] of wallLinks) {
    if (dropped.has(linkKey(ka, kb))) continue;
    for (const kc of linkOf.get(ka)) {
      if (kc === kb || !linkOf.get(kb).includes(kc)) continue;
      if (dropped.has(linkKey(ka, kc)) || dropped.has(linkKey(kb, kc))) continue;
      dropped.add(linkKey(ka, kb));
      break;
    }
  }
  const linksOf = (k) => (linkOf.get(k) || []).filter((nk) => !dropped.has(linkKey(k, nk)));

  // outer side = the lower ground (the field side of the wall)
  const outerSign = (p, n) => {
    const s = (sgn) => groundHeight(p.x + n.x * 1.4 * sgn, p.z + n.z * 1.4 * sgn);
    return s(1) <= s(-1) + 0.05 ? 1 : -1;
  };

  // One straight stretch of curtain wall from pa to pb, walk-way at heights ta -> tb
  function wallRun(pa, pb, ta, tb, opt = {}) {
    const dx = pb.x - pa.x, dz = pb.z - pa.z, len = Math.hypot(dx, dz);
    if (len < 1e-3) return;
    const t = { x: dx / len, z: dz / len };
    let n = { x: -t.z, z: t.x };
    if (opt.normal) n = opt.normal;
    else if (outerSign({ x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 }, n) < 0) n = { x: -n.x, z: -n.z };
    const ext = opt.ext ?? 0.06;
    const A = { x: pa.x - t.x * ext, z: pa.z - t.z * ext }, Bp = { x: pb.x + t.x * ext, z: pb.z + t.z * ext };
    const off = (p, d) => ({ x: p.x + n.x * d, z: p.z + n.z * d });
    const wo = opt.wOut ?? WALL_OUT, wi = opt.wIn ?? WALL_IN;
    let bot = opt.bottom;
    if (bot === undefined) {
      bot = Infinity;
      for (let i = 0; i <= 6; i++) {
        const q = { x: A.x + (Bp.x - A.x) * i / 6, z: A.z + (Bp.z - A.z) * i / 6 };
        for (const d of [wo + 0.25, wo, -wi, -wi - 0.2]) { const o = off(q, d); bot = Math.min(bot, groundHeight(o.x, o.z)); }
      }
      bot -= 0.5;
    }
    const yA = ta + 0.01, yB = tb + 0.01;
    const ao = off(A, wo), bo = off(Bp, wo), ai = off(A, -wi), bi = off(Bp, -wi);
    B.quad(Vxz(ao, yA), Vxz(bo, yB), Vxz(bi, yB), Vxz(ai, yA), K.pave, 2);
    B.quad(Vxz(ao, bot), Vxz(bo, bot), Vxz(bo, yB), Vxz(ao, yA), K.stone, 1);
    B.quad(Vxz(bi, bot), Vxz(ai, bot), Vxz(ai, yA), Vxz(bi, yB), K.stone, 1);
    if (!opt.openA) B.quad(Vxz(ai, bot), Vxz(ao, bot), Vxz(ao, yA), Vxz(ai, yA), K.stone, 1);
    if (!opt.openB) B.quad(Vxz(bo, bot), Vxz(bi, bot), Vxz(bi, yB), Vxz(bo, yB), K.stone, 1);
    if (!opt.noFoot) {
      // battered foot on the outer side
      const footH = (y) => bot + 0.5 + Math.max(0.2, Math.min(0.9, (y - bot - 0.5) * 0.32));
      const fa = off(A, wo + 0.22), fb = off(Bp, wo + 0.22);
      B.quad(Vxz(fa, bot), Vxz(fb, bot), Vxz(bo, footH(yB)), Vxz(ao, footH(yA)), K.stoneDark, 1);
    }
    // string course just under the walk-way
    const s0 = off(A, wo + 0.04), s1 = off(Bp, wo + 0.04);
    B.quad(Vxz(s0, yA - 0.12), Vxz(s1, yB - 0.12), Vxz(s1, yB - 0.05), Vxz(s0, yA - 0.05), K.stoneDark, 1);
    // parapets: crenellated on the outer side, low breast-wall on the inner side
    const para = (d, w, h, col) => {
      const p0 = off(A, d), p1 = off(Bp, d), q0 = off(A, d - w), q1 = off(Bp, d - w);
      B.quad(Vxz(p0, yA), Vxz(p1, yB), Vxz(p1, yB + h), Vxz(p0, yA + h), col, 1);
      B.quad(Vxz(q1, yB), Vxz(q0, yA), Vxz(q0, yA + h), Vxz(q1, yB + h), col, 1);
      B.quad(Vxz(p0, yA + h), Vxz(p1, yB + h), Vxz(q1, yB + h), Vxz(q0, yA + h), col, 1);
    };
    para(wo, 0.11, 0.2, K.stoneDark);
    para(-wi + 0.08, 0.08, 0.12, K.stone);
    const L2 = Math.hypot(Bp.x - A.x, Bp.z - A.z);
    const step = 0.34;
    for (let u = (L2 % step) / 2 + step / 2; u < L2 - 0.08; u += step) {
      const f = u / L2;
      const y = yA + (yB - yA) * f + 0.2;
      const c0 = off({ x: A.x + (Bp.x - A.x) * f, z: A.z + (Bp.z - A.z) * f }, wo - 0.055);
      hbox(B, c0.x, y, y + 0.15, c0.z, t, 0.085, 0.055, K.stoneDark, 1);
    }
  }

  const runs = gateRuns();
  const gateKeys = new Set(runs.flatMap((r) => r.hexes.map((h) => hk(h.q, h.r))));

  for (const [ka, kb] of wallLinks) {
    if (dropped.has(linkKey(ka, kb))) continue;
    const a = nodes.get(ka), b = nodes.get(kb);
    wallRun(hexToWorld(a.q, a.r), hexToWorld(b.q, b.r), top(a), top(b));
  }
  // joints: a solid block where the wall turns, forks or ends (straight runs need nothing)
  for (const [k, h] of nodes) {
    const ls = linksOf(k);
    const c = hexToWorld(h.q, h.r);
    const gateSide = HEX_DIRS.some(([dq, dr]) => gateKeys.has(hk(h.q + dq, h.r + dr)));
    if (ls.length === 2) {
      const [p, q] = ls.map((nk) => { const n = nodes.get(nk); return hexToWorld(n.q, n.r); });
      const cos = ((p.x - c.x) * (q.x - c.x) + (p.z - c.z) * (q.z - c.z)) / (Math.hypot(p.x - c.x, p.z - c.z) * Math.hypot(q.x - c.x, q.z - c.z));
      if (cos < -0.97) continue;
    }
    if (gateSide && ls.length <= 1) continue;
    let bot = Infinity;
    for (let i = 0; i < 6; i++) { const p = hexCorner(c.x, c.z, i); bot = Math.min(bot, groundHeight(p.x, p.z)); }
    const y = top(h);
    prism(B, c.x, bot - 0.5, c.z, 1.08, 1.02, y + 0.01 - bot + 0.5, K.stone, 1, 8, Math.PI / 8);
    prism(B, c.x, y, c.z, 1.04, 1.04, 0.2, K.stoneDark, 1, 8, Math.PI / 8);
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
      case 'porte': break;
      case 'tour': if (nodes.has(hk(h.q, h.r))) bastion(h, c); else tower(c, gy); break;
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
  for (const run of runs) gateComplex(run);

  // Adjacent porte props -> one gate complex each (a wide gate with several passages, or a single postern)
  function gateRuns() {
    const ps = props.filter((p) => p.type === 'porte' && allHexes.get(hk(p.q, p.r)));
    const seen = new Set();
    const out = [];
    for (const p of ps) {
      if (seen.has(hk(p.q, p.r))) continue;
      seen.add(hk(p.q, p.r));
      const group = [];
      const stack = [p];
      while (stack.length) {
        const cur = stack.pop();
        group.push(cur);
        for (const o of ps) {
          const ok = hk(o.q, o.r);
          if (seen.has(ok)) continue;
          if (HEX_DIRS.some(([dq, dr]) => cur.q + dq === o.q && cur.r + dr === o.r)) { seen.add(ok); stack.push(o); }
        }
      }
      const ax = dirVec(group[0].q, group[0].r, group[0].rot || 0);
      let tan = { x: -ax.z, z: ax.x };
      if (group.length > 1) {
        const ws = group.map((g) => hexToWorld(g.q, g.r));
        let best = [ws[0], ws[1]], bd = -1;
        for (const a of ws) for (const b of ws) { const d = Math.hypot(a.x - b.x, a.z - b.z); if (d > bd) { bd = d; best = [a, b]; } }
        tan = { x: (best[1].x - best[0].x) / bd, z: (best[1].z - best[0].z) / bd };
      }
      const proj = (g) => { const w = hexToWorld(g.q, g.r); return w.x * tan.x + w.z * tan.z; };
      group.sort((a, b) => proj(a) - proj(b));
      // passage axis: perpendicular to the wall, pointing the way the first gate faces
      let pax = { x: -tan.z, z: tan.x };
      if (pax.x * ax.x + pax.z * ax.z < 0) pax = { x: -pax.x, z: -pax.z };
      out.push({ hexes: group.map((g) => allHexes.get(hk(g.q, g.r))), ax: pax, tan });
    }
    return out;
  }

  function gateComplex(run) {
    const { hexes, ax, tan } = run;
    const n = hexes.length;
    const cs = hexes.map((h) => hexToWorld(h.q, h.r));
    const ctr = { x: (cs[0].x + cs[n - 1].x) / 2, z: (cs[0].z + cs[n - 1].z) / 2 };
    const half = (n * S3) / 2;
    const at = (u, v) => ({ x: ctr.x + tan.x * u + ax.x * v, z: ctr.z + tan.z * u + ax.z * v });
    const floor = Math.min(...cs.map((c) => groundHeight(c.x, c.z)));
    // walk-way height: the ramparts on both ends of the run, else two levels above the passage
    let tY = -Infinity;
    for (const h of hexes) for (const [dq, dr] of HEX_DIRS) {
      const nb = nodes.get(hk(h.q + dq, h.r + dr));
      if (nb) tY = Math.max(tY, top(nb));
    }
    if (tY === -Infinity) tY = Math.max(...hexes.map(top)) + 2 * HEX_HEIGHT_STEP;
    tY = Math.max(tY, floor + 1.6);
    const big = n >= 2;
    const thick = WALL_OUT + 0.12;
    const tw = big ? 0.62 : 0.42;
    const towerU = half + tw - 0.05;
    // flanking buttresses, deeper than the curtain wall; their top stays at walk level (units can stand there)
    for (const s of [-1, 1]) {
      const p = at(s * towerU, 0);
      const deep = thick + (big ? 0.35 : 0.18);
      hbox(B, p.x, floor - 0.5, tY + 0.02, p.z, tan, tw, deep, K.stone, 1);
      hbox(B, p.x, floor - 0.5, floor + 0.65, p.z, tan, tw + 0.12, deep + 0.14, K.stoneDark, 1);
      hbox(B, p.x, tY - 0.1, tY + 0.02, p.z, tan, tw + 0.05, deep + 0.05, K.stoneDark, 1);
      for (let i = -2; i <= 2; i++) {
        for (const v of [-1, 1]) {
          const m = at(s * towerU + i * tw * 0.4, v * (deep - 0.04));
          hbox(B, m.x, tY + 0.02, tY + 0.3, m.z, tan, 0.08, 0.06, K.stoneDark, 1);
        }
      }
      for (const v of [1.3, -1.3]) {
        const lp = at(s * (half + 0.1), v);
        lanternSpots.push(V(lp.x, floor + 0.85, lp.z));
      }
    }
    // curtain over the passages, piers between them, corbelled arches, door leaves pushed open in each passage
    const lintelBot = Math.min(tY - 0.42, floor + 1.3);
    wallRun(at(-half, 0), at(half, 0), tY, tY, { bottom: lintelBot, ext: 0.02, openA: true, openB: true, noFoot: true, normal: ax });
    for (let i = 0; i <= n; i++) {
      const u = -half + i * S3;
      const p = at(u, 0);
      const pw = i === 0 || i === n ? 0.28 : 0.22;
      hbox(B, p.x, floor - 0.5, lintelBot + 0.02, p.z, tan, pw, thick, K.stone, 1);
      for (const v of [-1, 1]) {
        const f = at(u, v * (thick + 0.06));
        hbox(B, f.x, floor - 0.5, floor + 0.42, f.z, tan, pw + 0.05, 0.08, K.stoneDark, 1);
      }
    }
    for (let i = 0; i < n; i++) {
      const u = -half + (i + 0.5) * S3;
      const inner = S3 / 2 - (i === 0 || i === n - 1 ? 0.28 : 0.22);
      for (let k = 0; k < 3; k++) {
        const y0 = lintelBot - (k + 1) * 0.1;
        for (const s of [-1, 1]) {
          const p = at(u + s * (inner - 0.05 - k * 0.07), 0);
          hbox(B, p.x, y0, y0 + 0.1, p.z, tan, 0.05 + k * 0.07, thick, K.stone, 1);
        }
      }
      for (const s of [-1, 1]) {
        const d = at(u + s * (inner - 0.2), -0.75);
        hbox(B, d.x, floor, Math.min(lintelBot - 0.32, floor + 1.0), d.z, ax, 0.22, 0.035, COL.lacquer, 3);
      }
    }
    // gate tower: platform and a two-storey pavilion over a wide gate, a single roof over a postern
    const pl = at(0, 0);
    hbox(B, pl.x, tY + 0.01, tY + 0.09, pl.z, tan, half + 0.02, thick - 0.06, K.pave, 2);
    const pavL = Math.max(0.55, half - 0.2), pavW = big ? 0.72 : 0.5;
    const cols = Math.max(2, Math.round((2 * pavL) / 0.5) + 1);
    for (let i = 0; i < cols; i++) {
      const u = -pavL + 0.08 + (i / (cols - 1)) * (2 * pavL - 0.16);
      for (const v of [-pavW + 0.1, pavW - 0.1]) {
        const q = at(u, v);
        prism(B, q.x, tY + 0.09, q.z, 0.045, 0.04, big ? 0.62 : 0.48, COL.lacquer, 3, 6);
      }
    }
    for (const v of [-pavW + 0.1, pavW - 0.1]) {
      const rl = at(0, v);
      hbox(B, rl.x, tY + 0.09, tY + 0.27, rl.z, tan, pavL - 0.05, 0.02, COL.timber, 3);
    }
    if (big) {
      hipRoof(pl, tan, ax, pavL + 0.3, pavW + 0.22, tY + 0.74, 0.32, 0.1, 4);
      hbox(B, pl.x, tY + 0.74, tY + 1.12, pl.z, tan, pavL * 0.72, pavW * 0.6, COL.plaster, 0);
      const nWin = Math.max(2, Math.round(pavL * 2));
      for (const v of [1, -1]) {
        for (let i = 0; i < nWin; i++) {
          const u = -pavL * 0.6 + (i / Math.max(1, nWin - 1)) * pavL * 1.2;
          const w = at(u, v * (pavW * 0.6 + 0.006));
          W.quad(V(w.x - tan.x * 0.1, tY + 0.83, w.z - tan.z * 0.1), V(w.x + tan.x * 0.1, tY + 0.83, w.z + tan.z * 0.1), V(w.x + tan.x * 0.1, tY + 1.0, w.z + tan.z * 0.1), V(w.x - tan.x * 0.1, tY + 1.0, w.z - tan.z * 0.1), COL.timber, 0);
        }
      }
      hipRoof(pl, tan, ax, pavL * 0.72 + 0.24, pavW * 0.6 + 0.2, tY + 1.12, 0.46, 0.12, 4);
    } else {
      hipRoof(pl, tan, ax, pavL + 0.24, pavW + 0.18, tY + 0.6, 0.36, 0.09, 4);
    }
    for (const s of [-1, 1]) {
      const b = at(s * (half - 0.3), WALL_OUT + 0.7);
      banners.push({ banner: { x: b.x, z: b.z } });
    }
  }

  // watchtower standing on the wall: a square bastion wider than the curtain, with a pavilion on top
  function bastion(h, c) {
    const y = top(h);
    let bot = Infinity;
    for (let i = 0; i < 6; i++) { const p = hexCorner(c.x, c.z, i); bot = Math.min(bot, groundHeight(p.x, p.z)); }
    bot -= 0.5;
    const ls = linksOf(hk(h.q, h.r)).map((nk) => { const n = nodes.get(nk); return hexToWorld(n.q, n.r); });
    let X = { x: 1, z: 0 };
    if (ls.length) { const d = { x: ls[0].x - c.x, z: ls[0].z - c.z }; const l = Math.hypot(d.x, d.z); X = { x: d.x / l, z: d.z / l }; }
    const Z = { x: -X.z, z: X.x };
    // platform at walk level (units can stand on it), wider than the curtain, crenellated, with an open pavilion
    const H = y + 0.02;
    hbox(B, c.x, bot, H, c.z, X, 1.0, 1.25, K.stone, 1);
    hbox(B, c.x, bot, bot + 0.5 + Math.max(0.25, Math.min(1, (H - bot) * 0.3)), c.z, X, 1.12, 1.37, K.stoneDark, 1);
    hbox(B, c.x, H - 0.12, H, c.z, X, 1.05, 1.3, K.stoneDark, 1);
    for (let i = -2; i <= 2; i++) {
      for (const [u, v, dir] of [[i * 0.4, -1.26, X], [i * 0.4, 1.26, X], [-1.01, i * 0.48, Z], [1.01, i * 0.48, Z]]) {
        hbox(B, c.x + X.x * u + Z.x * v, H, H + 0.26, c.z + X.z * u + Z.z * v, dir, 0.09, 0.05, K.stoneDark, 1);
      }
    }
    for (const [u, v] of [[-0.7, -0.85], [0.7, -0.85], [0.7, 0.85], [-0.7, 0.85]]) prism(B, c.x + X.x * u + Z.x * v, H, c.z + X.z * u + Z.z * v, 0.05, 0.045, 0.78, COL.lacquer, 3, 6);
    for (const v of [-0.85, 0.85]) {
      const r = { x: c.x + Z.x * v, z: c.z + Z.z * v };
      hbox(B, r.x, H + 0.66, H + 0.78, r.z, X, 0.74, 0.03, COL.timber, 3);
    }
    hipRoof({ x: c.x, z: c.z }, X, Z, 0.95, 1.1, H + 0.8, 0.42, 0.1, 4);
    lanternSpots.push(V(c.x + Z.x * 0.9, H + 0.6, c.z + Z.z * 0.9));
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

  function tent(at, ax, nx, L, Wd, Ht, col) {
    const y = (u, v) => { const p = at(u, v); return groundHeight(p.x, p.z) - 0.02; };
    const P = (u, v, dy) => { const p = at(u, v); return V(p.x, dy, p.z); };
    const r0 = P(-L, 0, y(-L, 0) + Ht), r1 = P(L, 0, y(L, 0) + Ht);
    const a0 = P(-L, Wd, y(-L, Wd)), a1 = P(L, Wd, y(L, Wd)), b0 = P(-L, -Wd, y(-L, -Wd)), b1 = P(L, -Wd, y(L, -Wd));
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
    smokeSources.push({ x: c.x, y: gy + 0.1, z: c.z, fire: true });
    lanternSpots.push(V(c.x, gy + 0.08, c.z));
  }
}
