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

// Dessine une bande de faiblesse sur chaque bord de l'hex (dégradé bord→intérieur)
// colors : tableau de 6 couleurs (string rgba) ou null, indexées par edgeIdx
function drawHexWeakness(ctx, cx, cy, colors) {
  const pts = hexCorners(cx, cy);
  const depth = 0.28; // profondeur de la bande (fraction coin→centre)
  const t = 0.2;      // fraction du bord réservée aux coins de chaque côté

  // Points intérieurs (coins ramenés vers le centre par depth)
  const inner = pts.map(p => ({
    x: p.x + (cx - p.x) * depth,
    y: p.y + (cy - p.y) * depth,
  }));

  // Bandes trapézoïdales : bord extérieur plat droit, dégradé vers l'intérieur
  for (let i = 0; i < 6; i++) {
    if (!colors[i]) continue;
    const a = pts[i], b = pts[(i + 1) % 6];
    const ia = inner[i], ib = inner[(i + 1) % 6];
    const pA  = { x: a.x  + (b.x  - a.x)  * t, y: a.y  + (b.y  - a.y)  * t };
    const pB  = { x: b.x  + (a.x  - b.x)  * t, y: b.y  + (a.y  - b.y)  * t };
    const piA = { x: ia.x + (ib.x - ia.x) * t, y: ia.y + (ib.y - ia.y) * t };
    const piB = { x: ib.x + (ia.x - ib.x) * t, y: ib.y + (ia.y - ib.y) * t };
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const imx = (ia.x + ib.x) / 2, imy = (ia.y + ib.y) / 2;
    const grad = ctx.createLinearGradient(mx, my, imx, imy);
    grad.addColorStop(0, colors[i]);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y);
    ctx.lineTo(pB.x, pB.y);
    ctx.lineTo(piB.x, piB.y);
    ctx.lineTo(piA.x, piA.y);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  // Coins : petit triangle extérieur uniquement (pas d'extension vers l'intérieur)
  for (let j = 0; j < 6; j++) {
    const cA = colors[(j - 1 + 6) % 6];
    const cB = colors[j];
    if (!cA || !cB || cA === cB) continue;
    const corner = pts[j];
    const prev = pts[(j - 1 + 6) % 6];
    const next = pts[(j + 1) % 6];
    const pR = { x: corner.x + (prev.x - corner.x) * t, y: corner.y + (prev.y - corner.y) * t };
    const pL = { x: corner.x + (next.x - corner.x) * t, y: corner.y + (next.y - corner.y) * t };
    const grad = ctx.createLinearGradient(pR.x, pR.y, pL.x, pL.y);
    grad.addColorStop(0, cA);
    grad.addColorStop(1, cB);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pR.x, pR.y);
    ctx.lineTo(corner.x, corner.y);
    ctx.lineTo(pL.x, pL.y);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }
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
