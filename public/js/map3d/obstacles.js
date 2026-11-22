// What soldiers can stand on and what arrows can hit, from the world's structures:
// solid footprints (world.solids: walls, gates, towers, tents, fences), walkable decks (world.decks: bridges, stairs and
// wall-walks flagged wall: true), building hexes (soldiers inside are garrisoned, not drawn), forest canopy and cliff faces.
// Visual only: game rules (movement, line of sight) are untouched.
export function createObstacles(world) {
  const solids = world.solids || [];
  const decks = world.decks || [];
  const g = (x, z) => world.groundHeight(x, z);
  // feet in the water, never under it: rivers are forded at the wading level
  const WADE = (world.WATER_LEVEL ?? 0.35) - 0.12;
  const CELL = 1.5;
  const grid = new Map();
  const cellKey = (i, j) => i * 65536 + j;
  const addTo = (s, x0, x1, z0, z1) => {
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        const k = cellKey(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(s);
      }
    }
  };
  for (const s of solids) {
    if (s.k === 'circ') addTo(s, s.x - s.r, s.x + s.r, s.z - s.r, s.z + s.r);
    else if (s.k === 'box') { const e = Math.hypot(s.hl, s.hw); addTo(s, s.x - e, s.x + e, s.z - e, s.z + e); }
    else { const e = Math.max(s.wo, s.wi); addTo(s, Math.min(s.ax, s.bx) - e, Math.max(s.ax, s.bx) + e, Math.min(s.az, s.bz) - e, Math.max(s.az, s.bz) + e); }
  }
  const terrainSet = (type) => new Set((world.hexesByType && world.hexesByType[type] || []).map((h) => `${h.q},${h.r}`));
  const buildings = terrainSet('building');
  const forests = terrainSet('forest');
  const hexKey = (x, z) => { const h = world.worldToHex(x, z); return `${h.q},${h.r}`; };

  function inside(s, x, z) {
    if (s.k === 'circ') return (x - s.x) ** 2 + (z - s.z) ** 2 <= s.r * s.r;
    if (s.k === 'box') {
      const dx = x - s.x, dz = z - s.z;
      return Math.abs(dx * s.ux + dz * s.uz) <= s.hl && Math.abs(-dx * s.uz + dz * s.ux) <= s.hw;
    }
    const vx = s.bx - s.ax, vz = s.bz - s.az, l2 = vx * vx + vz * vz || 1;
    const t = ((x - s.ax) * vx + (z - s.az) * vz) / l2;
    if (t < 0 || t > 1) return false;
    const lat = (x - s.ax) * s.nx + (z - s.az) * s.nz;
    return lat <= s.wo && lat >= -s.wi;
  }
  // highest solid top at (x, z), -Infinity when nothing stands there
  function solidTop(x, z) {
    const list = grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    let top = -Infinity;
    if (list) for (const s of list) if (s.top > top && inside(s, x, z)) top = s.top;
    return top;
  }
  // deck under (x, z): { y, wall } with the lateral margin kept from its edges, or null
  function deckAt(x, z, margin = 0, wallOnly = false) {
    let best = null;
    for (const d of decks) {
      if ((wallOnly && !d.wall) || x < d.x0 || x > d.x1 || z < d.z0 || z > d.z1) continue;
      const hw = d.hw - margin;
      if (hw <= 0) continue;
      for (let i = 0; i < d.pts.length - 1; i++) {
        const a = d.pts[i], b = d.pts[i + 1];
        const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
        const px = a.x + vx * t, pz = a.z + vz * t;
        if ((x - px) ** 2 + (z - pz) ** 2 <= hw * hw) {
          const y = a.y + (b.y - a.y) * t;
          if (!best || y > best.y) best = { y, wall: !!d.wall };
        }
      }
    }
    return best;
  }
  // height where a soldier of a formation at level L stands: wall-walks and their platforms only count for units up on the wall
  function standHeight(x, z, L) {
    const gy = g(x, z);
    if (L && L.onWall) {
      const d = deckAt(x, z, 0);
      if (d) return Math.max(gy, d.y);
      const top = solidTop(x, z);
      return Math.abs(top - L.deckY) < 0.3 ? top : gy;
    }
    const y = deckAtNonWall(x, z);
    return Math.max(y == null ? gy : Math.max(gy, y), WADE);
  }
  function deckAtNonWall(x, z) {
    let y = null;
    for (const d of decks) {
      if (d.wall || x < d.x0 || x > d.x1 || z < d.z0 || z > d.z1) continue;
      for (let i = 0; i < d.pts.length - 1; i++) {
        const a = d.pts[i], b = d.pts[i + 1];
        const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
        const px = a.x + vx * t, pz = a.z + vz * t;
        if ((x - px) ** 2 + (z - pz) ** 2 <= d.hw * d.hw) { const yy = a.y + (b.y - a.y) * t; if (y == null || yy > y) y = yy; }
      }
    }
    return y;
  }
  const isBuilding = (x, z) => buildings.size > 0 && buildings.has(hexKey(x, z));

  // Where a formation stands: up on a wall-walk (and at which height), inside a building, or on open ground
  function formationLevel(x, z) {
    const d = deckAt(x, z, 0, true);
    return { onWall: !!d, deckY: d ? d.y : null, garrison: !d && isBuilding(x, z) };
  }

  // Can a soldier of a formation at level L stand at (x, z)? (cx, cz) is the formation centre, used to spot cliff faces.
  function free(x, z, L, cx, cz) {
    if (L.onWall) {
      const d = deckAt(x, z, 0.2, true);
      if (d) return Math.abs(d.y - L.deckY) < 0.6;
      const top = solidTop(x, z);
      return top > -Infinity && Math.abs(top - L.deckY) < 0.3; // a platform at walk level (bastion, gate top)
    }
    const sy = standHeight(x, z, null);
    if (solidTop(x, z) > sy + 0.3) return false;
    if (deckAt(x, z, -0.1, true) && !deckAtNonWall(x, z)) return false; // under a wall-walk: the wall body
    if (!L.garrison && isBuilding(x, z)) return false;
    const dx = cx - x, dz = cz - z, dl = Math.hypot(dx, dz);
    if (dl > 0.05) {
      const k = 0.12 / dl;
      if (Math.abs(standHeight(x + dx * k, z + dz * k, null) - sy) > 0.3) return false; // cliff face or step
    }
    return true;
  }

  // Nearest spot at or around (x, z) where the soldier can stand; hide = no spot nearby (garrisoned or boxed in)
  const ANG = Array.from({ length: 12 }, (_, i) => [Math.cos(i / 12 * Math.PI * 2), Math.sin(i / 12 * Math.PI * 2)]);
  function fit(x, z, L, cx, cz, out = {}) {
    out.hide = false;
    // garrison: soldiers stand in the room (seen when the roof opens), never hidden
    if (L.garrison && isBuilding(x, z)) { out.x = x; out.z = z; return out; }
    if (free(x, z, L, cx, cz)) { out.x = x; out.z = z; return out; }
    const dx = cx - x, dz = cz - z, dl = Math.hypot(dx, dz);
    if (dl > 0.05) {
      for (let s = 0.08; s < dl; s += 0.08) {
        const px = x + dx / dl * s, pz = z + dz / dl * s;
        if (free(px, pz, L, cx, cz)) { out.x = px; out.z = pz; return out; }
      }
    }
    for (let r = 0.1; r <= 0.9; r += 0.1) {
      for (const [ca, sa] of ANG) {
        const px = x + ca * r, pz = z + sa * r;
        if (free(px, pz, L, cx, cz)) { out.x = px; out.z = pz; return out; }
      }
    }
    out.x = x; out.z = z; out.hide = true;
    return out;
  }

  // Top of what an arrow flying over (x, z) would hit: ground, masonry, roofs, forest canopy (skip = hex keys left out)
  function topFor(x, z, skip) {
    let top = Math.max(g(x, z), solidTop(x, z));
    if (buildings.size || forests.size) {
      const k = hexKey(x, z);
      if (!skip || !skip.has(k)) {
        if (buildings.has(k)) top = Math.max(top, g(x, z) + 1.45);
        else if (forests.has(k)) top = Math.max(top, g(x, z) + 0.75);
      }
    }
    return top;
  }

  // An arrow arc from S to E (apex hgt above the chord): the parameter of its first impact, or 1 when it lands clean
  function arcImpact(S, E, hgt, skip) {
    const N = 20;
    const dx = E.x - S.x, dy = E.y - S.y, dz = E.z - S.z;
    for (let i = 1; i < N; i++) {
      const u = i / N;
      if (u > 0.94) break;
      const x = S.x + dx * u, z = S.z + dz * u, y = S.y + dy * u + 4 * hgt * u * (1 - u);
      if (y < topFor(x, z, skip)) {
        let lo = (i - 1) / N, hi = u;
        for (let k = 0; k < 6; k++) {
          const m = (lo + hi) / 2;
          const mx = S.x + dx * m, mz = S.z + dz * m, my = S.y + dy * m + 4 * hgt * m * (1 - m);
          if (my < topFor(mx, mz, skip)) hi = m; else lo = m;
        }
        return hi;
      }
    }
    return 1;
  }
  // Plan an arrow: the default arc, else a higher one that clears every obstacle, else the default arc stopping at its impact
  function planArrow(S, E, skip) {
    const base = 0.25 * Math.hypot(E.x - S.x, E.z - S.z) + 0.25;
    for (const k of [1, 1.6, 2.4, 3.4]) if (arcImpact(S, E, base * k, skip) >= 1) return { hgt: base * k, uMax: 1, clear: true };
    return { hgt: base, uMax: arcImpact(S, E, base, skip), clear: false };
  }

  return { solidTop, deckAt, standHeight, isBuilding, formationLevel, free, fit, topFor, planArrow, hexKey };
}
