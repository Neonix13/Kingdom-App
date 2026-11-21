// Kingdom Battleground — decorative map features stored in map.decor (purely visual, no rule effect):
//   decor.ramparts: ["q,r", ...]                      wall-walk hexes; their drops get masonry walls and battlements in 3D
//   decor.props:    [{ type, q, r, rot?, label? }]    point features (tower, gatehouse, tents, banner, stairs, campfire)
//                   banners are vertical war banners (nobori), never confused with objective pennants; in a fixed
//                   deployment zone they take the colours of the army deployed there (3D, map3d/banners3d.js)
// Rules come only from height, terrain and segments (cliffs under the walls, barriers on the gate...).
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

  return { PROP_TYPES, PROP_BY_ID, DIRS, validateDecor, drawDecor2D };
});
