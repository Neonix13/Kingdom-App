// Kingdom Battleground — decorative map features stored in map.decor (purely visual, no rule effect):
//   decor.ramparts: ["q,r", ...]                      wall-walk hexes; their drops get masonry walls and battlements in 3D
//   decor.props:    [{ type, q, r, rot?, label? }]    point features (tower, gatehouse, tents, banner, stairs, campfire)
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
    const set = new Set(ramparts);
    const corner = (c, i) => ({ x: c.x + s * Math.cos(Math.PI / 3 * i), y: c.y + s * Math.sin(Math.PI / 3 * i) });
    for (const k of ramparts) {
      const [q, r] = k.split(',').map(Number);
      const c = toXY(q, r);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const p = corner(c, i); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }
      ctx.closePath();
      ctx.fillStyle = 'rgba(138,128,112,0.92)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(70,62,52,0.6)';
      ctx.lineWidth = lw * 0.5;
      ctx.stroke();
      // battlements on the edges that face a non-rampart neighbour
      for (let d = 0; d < 6; d++) {
        const nk = `${q + DIRS[d][0]},${r + DIRS[d][1]}`;
        if (set.has(nk)) continue;
        const n = toXY(q + DIRS[d][0], r + DIRS[d][1]);
        const ang = Math.atan2(n.y - c.y, n.x - c.x);
        // corners of the shared edge are at angle ±30° from the neighbour direction
        const a = { x: c.x + s * Math.cos(ang - Math.PI / 6), y: c.y + s * Math.sin(ang - Math.PI / 6) };
        const b = { x: c.x + s * Math.cos(ang + Math.PI / 6), y: c.y + s * Math.sin(ang + Math.PI / 6) };
        ctx.strokeStyle = '#2b2620';
        ctx.lineWidth = lw * 2.2;
        ctx.setLineDash([s * 0.16, s * 0.1]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.setLineDash([]);
      }
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
          ctx.strokeStyle = '#111';
          ctx.beginPath(); ctx.moveTo(c.x, c.y + s * 0.4); ctx.lineTo(c.x, c.y - s * 0.45); ctx.stroke();
          ctx.fillStyle = '#d8352a';
          ctx.fillRect(c.x, c.y - s * 0.45, s * 0.42, s * 0.3);
          if (p.label) {
            // fixed 20px glyph scaled to the hex size (fonts below ~1px are clamped by some browsers)
            ctx.save();
            ctx.translate(c.x + s * 0.21, c.y - s * 0.3);
            ctx.scale(s / 80, s / 80);
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
