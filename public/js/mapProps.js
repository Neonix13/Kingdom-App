// Kingdom Battleground — decorative map features stored in map.decor (purely visual, no rule effect):
//   decor.ramparts: ["q,r", ...]                      wall-walk hexes; their drops get masonry walls and battlements in 3D
//   decor.paths:    ["q,r", ...]                      visual dirt tracks (mountain trails, defiles): drawn like roads, no rule effect
//   decor.props:    [{ type, q, r, rot?, label? }]    point features (tower, gatehouse, tents, banner, stairs, campfire)
//                   banners are vertical war banners (nobori), never confused with objective pennants; in a fixed
//                   deployment zone they take the colours of the army deployed there (3D, map3d/banners3d.js)
// Rules come from height, terrain and segments (barriers on the gate...), plus two derived rules (effectiveSegments):
// - automatic cliffs: neighbours AUTO_CLIFF_DH (2) levels apart or more are separated by a cliff unless the edge carries
//   stairs, a ladder, a ramp ('rampe'), a bridge or a footbridge;
// - a wall walk can only be entered or left by its stone stairs (segment 'escalier') or a siege ladder ('echelle');
//   every other edge between a rampart hex and a non-rampart hex is a sheer wall (treated as 'cliff').
// Shared by the server (validation), the game (2D drawing), the map editor and the 3D view (fortifications.js).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KBMapProps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // rot: index in DIRS (0..5), the direction the feature faces (gate passage, tent door, stairs going up)
  const PROP_TYPES = [
    { id: 'tour', name: 'Tour de guet', oriented: false },
    { id: 'porte', name: 'Porte fortifiée', oriented: true },
    { id: 'tente', name: 'Tente', oriented: true },
    { id: 'tente_cmd', name: 'Tente de commandement', oriented: true },
    { id: 'banniere', name: 'Bannière', oriented: false, label: true },
    { id: 'escalier', name: 'Escalier de pierre', oriented: true },
    { id: 'feu', name: 'Feu de camp', oriented: false },
  ];
  const PROP_BY_ID = Object.fromEntries(PROP_TYPES.map((t) => [t.id, t]));
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const KEY_RE = /^-?\d+,-?\d+$/;

  // Errors in decor.ramparts / decor.props for a map whose hexes are `hexes` (Set of "q,r")
  function validateDecor(decor, hexes) {
    const errors = [];
    if (!decor) return errors;
    if (decor.ramparts !== undefined) {
      if (!Array.isArray(decor.ramparts)) errors.push('decor.ramparts doit être une liste de cases.');
      else for (const k of decor.ramparts) if (typeof k !== 'string' || !KEY_RE.test(k) || !hexes.has(k)) { errors.push(`Rempart hors carte : ${k}`); break; }
    }
    if (decor.paths !== undefined) {
      if (!Array.isArray(decor.paths)) errors.push('decor.paths doit être une liste de cases.');
      else for (const k of decor.paths) if (typeof k !== 'string' || !KEY_RE.test(k) || !hexes.has(k)) { errors.push(`Sentier hors carte : ${k}`); break; }
    }
    if (decor.props !== undefined) {
      if (!Array.isArray(decor.props)) errors.push('decor.props doit être une liste.');
      else for (const p of decor.props) {
        if (!p || !PROP_BY_ID[p.type]) { errors.push(`Élément de décor inconnu : ${p && p.type}`); break; }
        if (!Number.isInteger(p.q) || !Number.isInteger(p.r) || !hexes.has(`${p.q},${p.r}`)) { errors.push(`Élément de décor hors carte : ${p.type} ${p.q},${p.r}`); break; }
        if (p.rot !== undefined && !(Number.isInteger(p.rot) && p.rot >= 0 && p.rot < 6)) { errors.push(`Orientation invalide : ${p.type} ${p.q},${p.r}`); break; }
        if (p.label !== undefined && (typeof p.label !== 'string' || p.label.length > 8)) { errors.push(`Texte de bannière invalide en ${p.q},${p.r}`); break; }
      }
    }
    return errors;
  }

  // 2D drawing (game board and map editor). toXY(q, r) -> { x, y } hex centre, s = hex radius in the same units.
  function drawDecor2D(ctx, decor, toXY, s, opts) {
    if (!decor) return;
    const ramparts = decor.ramparts || [];
    const props = decor.props || [];
    if (!ramparts.length && !props.length) return;
    const lw = (opts && opts.lineWidth) || s * 0.06;
    ctx.save();
    // ramparts: one thick wall through the centres of neighbouring rampart hexes (and on to adjacent gates), as in 3D
    const set = new Set(ramparts);
    const gates = new Set(props.filter((p) => p.type === 'porte').map((p) => `${p.q},${p.r}`));
    const links = [];
    for (const k of ramparts) {
      const [q, r] = k.split(',').map(Number);
      for (const [dq, dr] of DIRS) {
        const nk = `${q + dq},${r + dr}`;
        if ((set.has(nk) && nk > k) || gates.has(nk)) links.push([toXY(q, r), toXY(q + dq, r + dr), gates.has(nk)]);
      }
    }
    const strokeLinks = (width, style, dash) => {
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      for (const [a, b, toGate] of links) {
        const e = toGate ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : b;
        ctx.moveTo(a.x, a.y); ctx.lineTo(e.x, e.y);
      }
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    strokeLinks(s * 1.25, 'rgba(43,38,32,0.9)');
    strokeLinks(s * 1.05, 'rgba(150,140,122,0.96)');
    strokeLinks(s * 0.16, 'rgba(43,38,32,0.75)', [s * 0.16, s * 0.12]);
    ctx.lineCap = 'butt';
    for (const k of ramparts) {
      const [q, r] = k.split(',').map(Number);
      if (DIRS.some(([dq, dr]) => set.has(`${q + dq},${r + dr}`) || gates.has(`${q + dq},${r + dr}`))) continue;
      const c = toXY(q, r);
      ctx.fillStyle = 'rgba(150,140,122,0.96)';
      ctx.strokeStyle = 'rgba(43,38,32,0.9)';
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(c.x, c.y, s * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    for (const p of props) {
      const c = toXY(p.q, p.r);
      const dirXY = (() => { const n = toXY(p.q + DIRS[p.rot || 0][0], p.r + DIRS[p.rot || 0][1]); const l = Math.hypot(n.x - c.x, n.y - c.y) || 1; return { x: (n.x - c.x) / l, y: (n.y - c.y) / l }; })();
      const nx = -dirXY.y, ny = dirXY.x;
      ctx.lineWidth = lw;
      ctx.strokeStyle = '#111';
      switch (p.type) {
        case 'tour': {
          ctx.fillStyle = '#7d7466';
          ctx.fillRect(c.x - s * 0.32, c.y - s * 0.32, s * 0.64, s * 0.64);
          ctx.strokeRect(c.x - s * 0.32, c.y - s * 0.32, s * 0.64, s * 0.64);
          ctx.fillStyle = '#d8352a';
          ctx.beginPath(); ctx.arc(c.x, c.y, s * 0.12, 0, Math.PI * 2); ctx.fill();
          break;
        }
        case 'porte': {
          const L = s * 0.95, W = s * 0.38;
          ctx.fillStyle = '#5a4c3c';
          ctx.beginPath();
          ctx.moveTo(c.x + nx * L + dirXY.x * W, c.y + ny * L + dirXY.y * W);
          ctx.lineTo(c.x - nx * L + dirXY.x * W, c.y - ny * L + dirXY.y * W);
          ctx.lineTo(c.x - nx * L - dirXY.x * W, c.y - ny * L - dirXY.y * W);
          ctx.lineTo(c.x + nx * L - dirXY.x * W, c.y + ny * L - dirXY.y * W);
          ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#c9a36a';
          ctx.fillRect(c.x - s * 0.18, c.y - s * 0.18, s * 0.36, s * 0.36);
          ctx.strokeStyle = '#d8352a';
          ctx.beginPath(); ctx.moveTo(c.x - dirXY.x * W, c.y - dirXY.y * W); ctx.lineTo(c.x + dirXY.x * W, c.y + dirXY.y * W); ctx.stroke();
          break;
        }
        case 'tente': case 'tente_cmd': {
          const big = p.type === 'tente_cmd' ? 1.5 : 1;
          const L = s * 0.4 * big, W = s * 0.28 * big;
          ctx.fillStyle = p.type === 'tente_cmd' ? '#b23a2a' : '#d9cfb4';
          ctx.beginPath();
          ctx.moveTo(c.x + dirXY.x * L, c.y + dirXY.y * L);
          ctx.lineTo(c.x - dirXY.x * L + nx * W, c.y - dirXY.y * L + ny * W);
          ctx.lineTo(c.x - dirXY.x * L - nx * W, c.y - dirXY.y * L - ny * W);
          ctx.closePath(); ctx.fill(); ctx.stroke();
          break;
        }
        case 'banniere': {
          // vertical war banner (nobori) beside the hex centre, unlike the objective pennants
          const bx = c.x + s * 0.3, by = c.y - s * 0.05;
          ctx.strokeStyle = '#111';
          ctx.beginPath(); ctx.moveTo(bx, by + s * 0.45); ctx.lineTo(bx, by - s * 0.55); ctx.lineTo(bx + s * 0.22, by - s * 0.55); ctx.stroke();
          ctx.fillStyle = '#a8352a';
          ctx.fillRect(bx + s * 0.02, by - s * 0.52, s * 0.18, s * 0.6);
          ctx.strokeRect(bx + s * 0.02, by - s * 0.52, s * 0.18, s * 0.6);
          if (p.label) {
            // fixed 20px glyph scaled to the hex size (fonts below ~1px are clamped by some browsers)
            ctx.save();
            ctx.translate(bx + s * 0.11, by - s * 0.38);
            ctx.scale(s / 110, s / 110);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 20px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(p.label, 0, 0);
            ctx.restore();
          }
          break;
        }
        case 'escalier': {
          ctx.strokeStyle = '#3b352d';
          for (let i = -3; i <= 3; i++) {
            const t = i * s * 0.12;
            ctx.beginPath();
            ctx.moveTo(c.x + dirXY.x * t + nx * s * 0.3, c.y + dirXY.y * t + ny * s * 0.3);
            ctx.lineTo(c.x + dirXY.x * t - nx * s * 0.3, c.y + dirXY.y * t - ny * s * 0.3);
            ctx.stroke();
          }
          break;
        }
        case 'feu': {
          ctx.fillStyle = '#f08a2a';
          ctx.beginPath(); ctx.arc(c.x, c.y, s * 0.16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          break;
        }
        default: break;
      }
    }
    ctx.restore();
  }

  // ---- Rampart access rule (shared by the server, the game client, the bots and the editor) ----
  const RAMPART_ACCESS = ['escalier', 'echelle'];
  const edgeKey = (q1, r1, q2, r2) => ((q1 < q2 || (q1 === q2 && r1 < r2)) ? `${q1},${r1}|${q2},${r2}` : `${q2},${r2}|${q1},${r1}`);

  // Edges between a rampart hex and a non-rampart hex of the map (hexes: Set or object of "q,r"), with their key
  function rampartEdges(decor, hexes) {
    const R = new Set((decor && decor.ramparts) || []);
    const has = hexes instanceof Set ? (k) => hexes.has(k) : (k) => Object.prototype.hasOwnProperty.call(hexes || {}, k);
    const out = [];
    for (const k of R) {
      if (!has(k)) continue;
      const [q, r] = k.split(',').map(Number);
      for (const [dq, dr] of DIRS) {
        const nk = `${q + dq},${r + dr}`;
        if (R.has(nk) || !has(nk)) continue;
        out.push({ key: edgeKey(q, r, q + dq, r + dr), rampart: k, outside: nk });
      }
    }
    return out;
  }

  // segments + a 'cliff' on every rampart edge that has no stairs or ladder: the movement rules (server, bots, client
  // previews) then only let units onto the wall walk through its stairs. map: { segments, decor, height }
  function withRampartRules(segments, decor, hexes) {
    const out = Object.assign({}, segments || {});
    for (const e of rampartEdges(decor, hexes)) {
      if (RAMPART_ACCESS.indexOf(out[e.key]) === -1) out[e.key] = 'cliff';
    }
    return out;
  }

  // ---- Automatic cliffs: between two neighbouring hexes whose heights differ by AUTO_CLIFF_DH levels or more, the edge is
  // a cliff unless the map puts an explicit way up there (stairs, ladder, ramp, bridge, footbridge).
  const AUTO_CLIFF_DH = 2;
  const STEEP_PASSABLE = ['escalier', 'echelle', 'rampe', 'bridge', 'passerelle'];
  function autoCliffs(segments, height) {
    const out = {};
    const H = height || {};
    for (const k of Object.keys(H)) {
      const [q, r] = k.split(',').map(Number);
      for (let d = 0; d < 3; d++) {
        const nk = `${q + DIRS[d][0]},${r + DIRS[d][1]}`;
        if (!(nk in H)) continue;
        if (Math.abs((H[k] || 0) - (H[nk] || 0)) < AUTO_CLIFF_DH) continue;
        const ek = edgeKey(q, r, q + DIRS[d][0], r + DIRS[d][1]);
        const t = (segments || {})[ek];
        if (t === 'cliff' || t === 'mur' || STEEP_PASSABLE.indexOf(t) !== -1) continue;
        out[ek] = 'cliff';
      }
    }
    return out;
  }

  // The segments the rules play with: the map's own segments, plus the automatic cliffs and the rampart walls.
  // Used by the server (GameRoom, bots, simultaneous resolution), the game client (previews, 2D) and the 3D terrain.
  function effectiveSegments(segments, decor, height) {
    return withRampartRules(Object.assign({}, segments || {}, autoCliffs(segments, height)), decor, height);
  }

  // Groups of connected rampart hexes with no stairs or ladder at all (editor warning: nobody can ever get up there)
  function unreachableRamparts(decor, segments, hexes) {
    const R = new Set(((decor && decor.ramparts) || []).filter((k) => (hexes instanceof Set ? hexes.has(k) : k in (hexes || {}))));
    const access = new Set(rampartEdges(decor, hexes).filter((e) => RAMPART_ACCESS.indexOf((segments || {})[e.key]) !== -1).map((e) => e.rampart));
    const seen = new Set();
    const groups = [];
    for (const k of R) {
      if (seen.has(k)) continue;
      const group = [];
      const stack = [k];
      seen.add(k);
      while (stack.length) {
        const cur = stack.pop();
        group.push(cur);
        const [q, r] = cur.split(',').map(Number);
        for (const [dq, dr] of DIRS) {
          const nk = `${q + dq},${r + dr}`;
          if (R.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
        }
      }
      if (!group.some((g) => access.has(g))) groups.push(group);
    }
    return groups;
  }

  // ---- Wall walk above the gates: a second level on every gate hex next to a rampart ----
  // Its node key is "q,r^" (the passage below keeps "q,r"); a unit up there does not block the passage. It is reached from
  // a neighbouring rampart hex (about the same height), from the wall walk above a neighbouring gate, or from any
  // neighbour through stairs / a ladder on the edge. Returns { tops: { "q,r": height }, links: { node: [node, ...] } }.
  const TOP = '^';
  const isTop = (k) => typeof k === 'string' && k.charAt(k.length - 1) === TOP;
  const topKey = (q, r) => `${q},${r}${TOP}`;
  const baseKey = (k) => (isTop(k) ? k.slice(0, -1) : k);
  function gateTops(decor, height, segments) {
    const H = height || {};
    const R = new Set((decor && decor.ramparts) || []);
    const gates = ((decor && decor.props) || []).filter((p) => p && p.type === 'porte' && `${p.q},${p.r}` in H);
    const tops = {};
    for (const g of gates) {
      let best = null;
      for (const [dq, dr] of DIRS) {
        const nk = `${g.q + dq},${g.r + dr}`;
        if (R.has(nk) && nk in H && (best === null || H[nk] > best)) best = H[nk];
      }
      if (best !== null && best > (H[`${g.q},${g.r}`] || 0)) tops[`${g.q},${g.r}`] = best;
    }
    const links = {};
    const link = (a, b) => { (links[a] || (links[a] = [])).push(b); (links[b] || (links[b] = [])).push(a); };
    for (const gk of Object.keys(tops)) {
      const [q, r] = gk.split(',').map(Number);
      for (let d = 0; d < 6; d++) {
        const nq = q + DIRS[d][0], nr = r + DIRS[d][1], nk = `${nq},${nr}`;
        if (!(nk in H)) continue;
        if (nk in tops) { if (d < 3) link(topKey(q, r), topKey(nq, nr)); continue; }
        const seg = (segments || {})[edgeKey(q, r, nq, nr)];
        if ((R.has(nk) && Math.abs((H[nk] || 0) - tops[gk]) <= 1) || RAMPART_ACCESS.indexOf(seg) !== -1) link(topKey(q, r), nk);
      }
    }
    return { tops, links };
  }

  return { PROP_TYPES, PROP_BY_ID, DIRS, validateDecor, drawDecor2D, RAMPART_ACCESS, rampartEdges, withRampartRules, unreachableRamparts, AUTO_CLIFF_DH, STEEP_PASSABLE, autoCliffs, effectiveSegments, gateTops, isTop, topKey, baseKey };
});
