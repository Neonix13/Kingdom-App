// Flat-top hex grid rendering utilities

const HEX_SIZE = 32; // pixel radius (jeu)

// Calibration carte — valeurs issues de calibration.html
const MAP_HEX_SIZE = 101.5; // taille hex dans l'image source (px)
const MAP_ORIG_X   = 137;   // pixel image correspondant au centre de hex (0,0)
const MAP_ORIG_Y   = 190;
const MAP_IMG_W    = 8800;
const MAP_IMG_H    = 7200;
const MAP_SCALE    = HEX_SIZE / MAP_HEX_SIZE; // ~0.3153

function hexToPixel(q, r) {
  const x = HEX_SIZE * (3 / 2 * q);
  const y = HEX_SIZE * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
  return { x, y };
}

function pixelToHex(px, py) {
  const q = (2 / 3 * px) / HEX_SIZE;
  const r = (-1 / 3 * px + Math.sqrt(3) / 3 * py) / HEX_SIZE;
  return hexRound(q, r);
}

function hexRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

function hexCorners(cx, cy) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i);
    pts.push({ x: cx + HEX_SIZE * Math.cos(angle), y: cy + HEX_SIZE * Math.sin(angle) });
  }
  return pts;
}

// Dessine les indicateurs de faiblesse : trait coloré sur chaque bord extérieur
// colors : tableau de 6 couleurs (string rgba) ou null, indexées par edgeIdx
function drawHexWeakness(ctx, cx, cy, colors) {
  const pts = hexCorners(cx, cy);
  ctx.save();
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const margin = 0.15;
  const inset = 2;
  for (let i = 0; i < 6; i++) {
    if (!colors[i]) continue;
    const a = pts[i], b = pts[(i + 1) % 6];
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    let nx = -ey / len, ny = ex / len;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (nx * (cx - mx) + ny * (cy - my) < 0) { nx = -nx; ny = -ny; }
    const ox = nx * inset, oy = ny * inset;
    const p1 = { x: a.x + ex * margin       + ox, y: a.y + ey * margin       + oy };
    const p2 = { x: a.x + ex * (1 - margin) + ox, y: a.y + ey * (1 - margin) + oy };
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = colors[i];
    ctx.stroke();
  }
  ctx.restore();
}

// Trace le contour blanc d'un hex sur les bords non partagés avec un allié
// outerEdges : tableau de 6 booléens (true = bord extérieur à tracer)
function drawHexGroupOutline(ctx, cx, cy, outerEdges) {
  const pts = hexCorners(cx, cy);
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    if (!outerEdges[i]) continue;
    ctx.beginPath();
    ctx.moveTo(pts[i].x, pts[i].y);
    ctx.lineTo(pts[(i + 1) % 6].x, pts[(i + 1) % 6].y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHex(ctx, cx, cy, fillColor, strokeColor, alpha = 1, lineWidth = 1) {
  const pts = hexCorners(cx, cy);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

// Angle de rotation (en radians) pour chaque orientation (0-5)
// L'image par défaut pointe vers le bas (direction [0,1] = index 5 = angle 0)
const FACING_ANGLES = [-Math.PI / 3, -2 * Math.PI / 3, Math.PI, 2 * Math.PI / 3, Math.PI / 3, 0];

function hexFacingClient(q1, r1, q2, r2) {
  const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  const dq = q2 - q1, dr = r2 - r1;
  if (dq === 0 && dr === 0) return 5;
  const px = 1.5 * dq;
  const py = Math.sqrt(3) * dr + Math.sqrt(3) / 2 * dq;
  let best = 5, bestDot = -Infinity;
  for (let i = 0; i < 6; i++) {
    const [ddq, ddr] = DIRS[i];
    const dot = px * (1.5 * ddq) + py * (Math.sqrt(3) * ddr + Math.sqrt(3) / 2 * ddq);
    if (dot > bestDot) { bestDot = dot; best = i; }
  }
  return best;
}

function hexDistance(q1, r1, q2, r2) {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

// Build the set of hex keys that are within the map image bounds (mirrors server generateHexMap)
function buildMapHexSet() {
  const S = Math.sqrt(3);
  const set = new Set();
  const qMin = Math.floor(-MAP_ORIG_X / (MAP_HEX_SIZE * 1.5)) - 1;
  const qMax = Math.ceil((MAP_IMG_W - MAP_ORIG_X) / (MAP_HEX_SIZE * 1.5)) + 1;
  for (let q = qMin; q <= qMax; q++) {
    const rMin = Math.floor((-MAP_ORIG_Y - MAP_HEX_SIZE * S / 2 * q) / (MAP_HEX_SIZE * S)) - 1;
    const rMax = Math.ceil((MAP_IMG_H - MAP_ORIG_Y - MAP_HEX_SIZE * S / 2 * q) / (MAP_HEX_SIZE * S)) + 1;
    for (let r = rMin; r <= rMax; r++) {
      const imgX = MAP_HEX_SIZE * 1.5 * q + MAP_ORIG_X;
      const imgY = MAP_HEX_SIZE * (S / 2 * q + S * r) + MAP_ORIG_Y;
      if (imgX >= 0 && imgX <= MAP_IMG_W && imgY >= 0 && imgY <= MAP_IMG_H) {
        set.add(`${q},${r}`);
      }
    }
  }
  return set;
}
