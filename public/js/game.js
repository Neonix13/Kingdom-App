// Kingdom Battleground — Game Client

const socket = io();
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// Chargement de la carte
const mapImage = new Image();
mapImage.src = '/img/map.webp';

// Chargement des terrains
let terrainData = {};
let showTerrain = false;
let gridOpacity = 0.25;
let gridThickness = 1;
let gridColorRGB = '180,140,60';
fetch('/terrain.json').then(r => r.json()).then(d => { terrainData = d; render(); }).catch(() => {});

// Chargement de l'image d'arbre
const treeImage = new Image();
treeImage.src = '/assets/arbre.png';
treeImage.onload = () => render();

// Stance icons
const stanceIcons = {};
const stanceList = ['marche','combat','charge','percee','defense_combat','defense_distance'];
const stanceIconFiles = { marche:'marche', combat:'combat', charge:'charge', percee:'percee', defense_combat:'def_charge', defense_distance:'def_eparse' };
const stanceNames = { marche:'Marche', combat:'Combat', charge:'Charge', percee:'Percée', defense_combat:'Déf. combat', defense_distance:'Déf. distance' };
for (const s of stanceList) {
  const img = new Image();
  img.src = `/icons/${stanceIconFiles[s]}.svg`;
  img.onload = () => render();
  stanceIcons[s] = img;
}

// Tokens des généraux
const GENERAL_TOKEN_MAP = {
  'ou_ki':       'Ou Ki',
  'ou_sen':      'Ou Sen',
  'kei_sha':     'Kei Sha',
  'shi_ba_shou': 'Shi Ba Shou',
  'ren_pa':      'Ren Pa',
  'go_hou_mei':  'Go Hou Mei',
};
const GENERAL_IMAGE1_MAP = {
  'ou_ki':       { file: 'OU KI 1-1',       ext: 'jpg' },
  'ou_sen':      { file: 'OU SEN 1-1',       ext: 'png' },
  'mou_bu':      { file: 'MOU BU 1-1',       ext: 'jpg' },
  'kan_ki':      { file: 'KAN KI 1-1',       ext: 'jpg' },
  'ri_boku':     { file: 'RI BOKU 1-1',      ext: 'jpg' },
  'kei_sha':     { file: 'KEI SHA 1-1',      ext: 'jpg' },
  'shi_ba_shou': { file: 'SHI BA SHOU 1-1',  ext: 'jpg' },
  'ren_pa':      { file: 'REN PA 1-1',       ext: 'jpg' },
  'go_hou_mei':  { file: 'GO HOU MEI 1-1',   ext: 'jpg' },
  'gai_mou':     { file: 'GAI MOU',          ext: 'jpg' },
};
const UNIT_IMAGE1_MAP = {
  'pietaille':      { file: 'PIETAILLE 1-1',       ext: 'jpeg' },
  'soldats':        { file: 'SOLDAT',               ext: 'jpg'  },
  'phalange':       { file: 'PHALANGE 1-1',         ext: 'png'  },
  'lancier':        { file: 'LANCIER 1-1',          ext: 'jpg'  },
  'espion':         { file: 'ESPION 1-1',           ext: 'png'  },
  'assassin':       { file: "ASSASSIN 1-1",         ext: 'jpg'  },
  'cavalier_leger': { file: 'CAVALIER LEGER 1-1',   ext: 'jpg'  },
  'cavalier_lourd': { file: 'CAVALIER LOURD 1-1',   ext: 'jpg'  },
  'archer':         { file: 'ARCHER 1-1',           ext: 'jpg'  },
  'archer_elite':   { file: "ARCHER D'ELITE 1-1",   ext: 'jpg'  },
  'batisseurs':     { file: 'BATISSEUR 1-1',        ext: 'jpg'  },
  'char':           { file: 'CHAR 1-1',             ext: 'png'  },
};
function img1Url(map, key, folder) {
  const entry = map[key];
  if (!entry) return null;
  return `/assets/${folder}/${encodeURIComponent(entry.file)}.${entry.ext}`;
}

const generalTokenImages = {};
for (const [id, name] of Object.entries(GENERAL_TOKEN_MAP)) {
  const img = new Image();
  img.src = `/assets/GENERAL TOKEN/${encodeURIComponent(name)}.png`;
  img.onload = () => render();
  generalTokenImages[id] = img;
}

// Tokens des unités
const UNIT_TOKEN_MAP = {
  'pietaille':      "Piétaille",
  'soldats':        "Soldats",
  'phalange':       "Phalange",
  'lancier':        "Lanciers",
  'espion':         "Espions",
  'assassin':       "Assassins",
  'cavalier_leger': "Cavalerie légère",
  'cavalier_lourd': "Cavalerie Loude",
  'archer':         "Archer léger",
  'archer_elite':   "Archer d'Elite",
  'batisseurs':     "Batisseurs",
  'char':           "Chars",
};
const unitTokenImages = {};
for (const [id, name] of Object.entries(UNIT_TOKEN_MAP)) {
  const img = new Image();
  img.src = `/assets/UNIT TOKEN/${encodeURIComponent(name)}.png`;
  img.onload = () => render();
  unitTokenImages[id] = img;
}

// Aléatoire déterministe basé sur les coordonnées hex (pour placement stable des arbres)
function seededRand(seed) {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

function drawForestTrees(ctx) {
  if (!treeImage.complete || !treeImage.naturalWidth) return;
  for (const [key, terrain] of Object.entries(terrainData)) {
    if (terrain !== 'forest') continue;
    const [q, r] = key.split(',').map(Number);
    const { x, y } = hexToPixel(q, r);
    // 2 ou 3 arbres par case
    const treeCount = 7 + Math.floor(seededRand(q * 137 + r * 251) * 4);
    for (let i = 0; i < treeCount; i++) {
      const s1 = q * 1000 + r * 100 + i * 7 + 1;
      const s2 = q * 2000 + r * 200 + i * 13 + 2;
      const s3 = q * 3000 + r * 300 + i * 17 + 3;
      const s4 = q * 4000 + r * 400 + i * 23 + 4;
      const offsetX = (seededRand(s1) - 0.5) * HEX_SIZE * 1.1;
      const offsetY = (seededRand(s2) - 0.5) * HEX_SIZE * 0.9;
      const rotation = seededRand(s3) * Math.PI * 2;
      const size = HEX_SIZE * (1.5 + seededRand(s4) * 0.7); // 1.5x à 2.2x le rayon
      ctx.save();
      ctx.translate(x + offsetX, y + offsetY);
      ctx.rotate(rotation);
      ctx.drawImage(treeImage, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }
}

const TERRAIN_COLORS = {
  forest:   'rgba(30,100,20,0.7)',
  river:    'rgba(40,120,220,0.7)',
  building: 'rgba(140,100,60,0.8)',
  road:     'rgba(200,170,100,0.6)',
  bridge:   'rgba(220,140,30,0.8)',
};

// State
let myId = sessionStorage.getItem('myId');
let roomCode = sessionStorage.getItem('roomCode');
let gameState = null;
let deployState = sessionStorage.getItem('deploymentState');

// Animations de déplacement : unitId → { path:[[q,r],...], startTime, stepMs }
const unitAnimations = {};
const ANIM_STEP_MS = 200;
let animLoopRunning = false;

function startAnimLoop() {
  if (animLoopRunning) return;
  animLoopRunning = true;
  function loop() {
    const now = performance.now();
    let anyActive = false;
    for (const id of Object.keys(unitAnimations)) {
      const a = unitAnimations[id];
      const totalSteps = a.path.length;
      const elapsed = now - a.startTime;
      const currentStep = Math.floor(elapsed / ANIM_STEP_MS);
      if (currentStep >= totalSteps) {
        delete unitAnimations[id];
      } else {
        anyActive = true;
      }
    }
    render();
    if (anyActive) requestAnimationFrame(loop);
    else animLoopRunning = false;
  }
  requestAnimationFrame(loop);
}

function getAnimatedPos(unit) {
  const a = unitAnimations[unit.id];
  if (!a) return null;
  const elapsed = performance.now() - a.startTime;
  const stepF = elapsed / ANIM_STEP_MS;
  const step = Math.floor(stepF);
  const t = stepF - step;
  const totalSteps = a.path.length;
  if (step >= totalSteps) return null;
  // Position de départ de ce step
  const fromPos = step === 0 ? hexToPixel(a.fromQ, a.fromR) : hexToPixel(a.path[step - 1][0], a.path[step - 1][1]);
  const toPos = hexToPixel(a.path[step][0], a.path[step][1]);
  return { x: fromPos.x + (toPos.x - fromPos.x) * t, y: fromPos.y + (toPos.y - fromPos.y) * t };
}
if (deployState) deployState = JSON.parse(deployState);

let mode = 'select'; // select | move | attack | deploy
let selectedUnit = null;
let hoveredHex = null;
let movableTiles = new Set();
let attackableTiles = new Set();
let deployTiles = new Set();

// Camera — centrée sur la carte image au démarrage
const MAP_CENTER_WORLD_X = (MAP_IMG_W / 2 - MAP_ORIG_X) * MAP_SCALE; // ≈ 1344
const MAP_CENTER_WORLD_Y = (MAP_IMG_H / 2 - MAP_ORIG_Y) * MAP_SCALE; // ≈ 1075
let zoom = 0.3;
let camX = -MAP_CENTER_WORLD_X * zoom;
let camY = -MAP_CENTER_WORLD_Y * zoom;
let isDragging = false, dragStart = null, camAtDrag = null;

// Player colors
const PLAYER_COLORS = [
  '#e05020', '#2070e0', '#20a020', '#e0c020',
  '#a020e0', '#e02080', '#20e0c0', '#e08020'
];

function getPlayerColor(playerId) {
  if (!gameState) return '#888';
  const idx = gameState.players.findIndex(p => p.id === playerId);
  return PLAYER_COLORS[idx % PLAYER_COLORS.length] || '#888';
}

// ---- CANVAS SETUP ----
function resizeCanvas() {
  const area = document.getElementById('canvas-area');
  canvas.width = area.clientWidth;
  canvas.height = area.clientHeight;
  render();
}
window.addEventListener('resize', resizeCanvas);

// ---- RENDER ----
function render() {
  if (!canvas.width) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2 + camX, canvas.height / 2 + camY);
  ctx.scale(zoom, zoom);

  // Dessin de la carte en arrière-plan
  if (mapImage.complete && mapImage.naturalWidth) {
    const imgX = -MAP_ORIG_X * MAP_SCALE;
    const imgY = -MAP_ORIG_Y * MAP_SCALE;
    ctx.drawImage(mapImage, imgX, imgY, MAP_IMG_W * MAP_SCALE, MAP_IMG_H * MAP_SCALE);
  }

  // Overlays de terrain (si activé)
  if (showTerrain) {
    for (const [key, terrain] of Object.entries(terrainData)) {
      const color = TERRAIN_COLORS[terrain];
      if (!color) continue;
      const [q, r] = key.split(',').map(Number);
      const { x, y } = hexToPixel(q, r);
      drawHex(ctx, x, y, color, 'rgba(0,0,0,0)');
    }
  }

  // Arbres sur les cases forêt (toujours visibles, couverts par le brouillard)
  drawForestTrees(ctx);

  const visibleSet = new Set(gameState?.visibleHexes || []);
  const startZone = deployState?.startingZone;

  // Determine which hexes to draw
  const hexMap = deployState?.hexMap || {};
  const hexKeys = Object.keys(hexMap);

  // In battle, we only have visibleHexes + fog
  if (gameState && gameState.phase === 'battle') {
    // Draw all hexes (fog on non-visible)
    // We need the full hex map — server sends visible hexes as array
    // Draw a large area and mark fog
    const S = Math.sqrt(3);
    const qMin = Math.floor(-MAP_ORIG_X / (MAP_HEX_SIZE * 1.5)) - 1;
    const qMax = Math.ceil((MAP_IMG_W - MAP_ORIG_X) / (MAP_HEX_SIZE * 1.5)) + 1;
    for (let q = qMin; q <= qMax; q++) {
      const rMin2 = Math.floor((-MAP_ORIG_Y - MAP_HEX_SIZE * S / 2 * q) / (MAP_HEX_SIZE * S)) - 1;
      const rMax2 = Math.ceil((MAP_IMG_H - MAP_ORIG_Y - MAP_HEX_SIZE * S / 2 * q) / (MAP_HEX_SIZE * S)) + 1;
      for (let r = rMin2; r <= rMax2; r++) {
        const imgX = MAP_HEX_SIZE * 1.5 * q + MAP_ORIG_X;
        const imgY = MAP_HEX_SIZE * (S / 2 * q + S * r) + MAP_ORIG_Y;
        if (imgX < 0 || imgX > MAP_IMG_W || imgY < 0 || imgY > MAP_IMG_H) continue;
        const key = `${q},${r}`;
        const { x, y } = hexToPixel(q, r);
        const isVisible = visibleSet.has(key);
        const isHovered = hoveredHex && hoveredHex.q === q && hoveredHex.r === r;

        // Zones visibles : transparent sur la carte, brouillard : sombre opaque
        let fill = isVisible ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.72)';
        let stroke = isVisible ? `rgba(${gridColorRGB},${gridOpacity})` : 'rgba(0,0,0,0)';

        if (isVisible && movableTiles.has(key)) fill = 'rgba(40,120,20,0.35)';
        if (isVisible && attackableTiles.has(key)) fill = 'rgba(180,30,10,0.35)';
        if (isHovered && isVisible) stroke = '#c8960c';

        drawHex(ctx, x, y, fill, stroke, 1, gridThickness);
      }
    }
  } else {
    // Deployment: draw all hexes
    for (const key of hexKeys) {
      const [q, r] = key.split(',').map(Number);
      const { x, y } = hexToPixel(q, r);
      let inZone = false;
      if (startZone) {
        const rRiver = Math.round(21 - 0.43 * q);
        if (startZone.type === 'river_north') {
          inZone = r >= rRiver - startZone.radius && r <= rRiver - 1;
        } else if (startZone.type === 'river_south') {
          inZone = r >= rRiver + 1 && r <= rRiver + startZone.radius;
        } else {
          inZone = hexDistance(q, r, startZone.q, startZone.r) <= startZone.radius;
        }
      }
      const isHovered = hoveredHex && hoveredHex.q === q && hoveredHex.r === r;

      // Déploiement : transparent sur carte, zone de départ en vert léger
      let fill = inZone ? 'rgba(40,120,20,0.25)' : 'rgba(0,0,0,0)';
      let stroke = inZone ? `rgba(80,200,40,${Math.min(1, gridOpacity * 2)})` : `rgba(${gridColorRGB},${gridOpacity * 0.6})`;
      if (inZone && isHovered) fill = 'rgba(60,180,30,0.4)';
      if (isHovered && !inZone) stroke = 'rgba(200,160,80,0.5)';
      drawHex(ctx, x, y, fill, stroke, 1, gridThickness);
    }
  }

  // Draw units
  const units = gameState?.units || [];
  const myUnits = deployState?.units || [];

  // Deployment units
  if (deployState && mode === 'deploy') {
    for (const u of myUnits) {
      if (u.q === null) continue;
      const { x, y } = hexToPixel(u.q, u.r);
      drawUnit(ctx, x, y, u, myId);
    }
  }

  // Battle units
  for (const u of units) {
    if (u.q === null) continue;
    const animPos = getAnimatedPos(u);
    const { x, y } = animPos || hexToPixel(u.q, u.r);
    const isSelected = selectedUnit && selectedUnit.id === u.id;

    // Vision radius for general (highlight)
    if (isSelected && u.visionRange > 0) {
      drawHex(ctx, x, y, 'transparent', '#ffd70060', 0.5);
    }

    drawUnit(ctx, x, y, u, u.playerId, isSelected);
  }

  ctx.restore();
}

function getGeneralIdForUnit(unit) {
  if (!unit.isGeneral) return null;
  if (gameState) {
    const player = gameState.players.find(p => p.id === unit.playerId);
    if (player?.generalId) return player.generalId;
  }
  // Pendant le déploiement, utiliser le generalId stocké dans l'unité ou deployState
  if (unit.generalId) return unit.generalId;
  if (deployState?.generalData?.id) return deployState.generalData.id;
  return null;
}

function drawTokenImage(ctx, img, x, y, radius) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

function drawUnit(ctx, x, y, unit, playerId, isSelected = false) {
  const color = getPlayerColor(playerId);
  const size = HEX_SIZE * 0.55;

  ctx.save();

  // Selection ring
  if (isSelected) {
    ctx.beginPath();
    ctx.arc(x, y, size + 7, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  const tokenR = HEX_SIZE * 0.95;

  if (unit.isGeneral) {
    const gid = getGeneralIdForUnit(unit);
    const img = gid ? generalTokenImages[gid] : null;
    if (img && img.complete && img.naturalWidth) {
      drawTokenImage(ctx, img, x, y, tokenR);
    } else {
      drawStar(ctx, x, y, 5, size, size * 0.45);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(HEX_SIZE * 0.45)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(unit.name.charAt(0), x, y);
    }
  } else {
    const img = unit.typeId ? unitTokenImages[unit.typeId] : null;
    if (img && img.complete && img.naturalWidth) {
      drawTokenImage(ctx, img, x, y, tokenR);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = color + 'cc';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(HEX_SIZE * 0.45)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(unit.name.charAt(0), x, y);
    }
  }

  // HP bar
  const hpRatio = unit.vitality / unit.maxVitality;
  const barW = HEX_SIZE * 1.2;
  const barH = 4;
  const bx = x - barW / 2;
  const by = y + tokenR + 2;
  ctx.fillStyle = '#1a0a04';
  ctx.fillRect(bx, by, barW, barH);
  ctx.fillStyle = hpRatio > 0.5 ? '#2a8c2a' : hpRatio > 0.25 ? '#c8960c' : '#a02020';
  ctx.fillRect(bx, by, barW * hpRatio, barH);

  // Overlay "déjà joué"
  if (unit.hasMoved && unit.isMine) {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.arc(x, y, tokenR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Overlay "en fuite"
  if (unit.isFleeing) {
    ctx.fillStyle = 'rgba(255,80,0,0.35)';
    ctx.beginPath();
    ctx.arc(x, y, tokenR, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw stance icon (bottom-right of hex) — only for own units
  if (unit.isMine && unit.stance) {
    const icon = stanceIcons[unit.stance];
    const iconSize = HEX_SIZE * 0.4;
    const iconX = x + HEX_SIZE * 0.45;
    const iconY = y + HEX_SIZE * 0.35;
    if (icon && icon.complete && icon.naturalWidth) {
      ctx.drawImage(icon, iconX - iconSize/2, iconY - iconSize/2, iconSize, iconSize);
    } else {
      // Fallback: text indicator
      ctx.fillStyle = 'rgba(200,150,12,0.9)';
      ctx.font = `bold ${Math.round(HEX_SIZE * 0.22)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText((unit.stance || '').charAt(0).toUpperCase(), iconX, iconY);
    }
  }

  ctx.restore();
}

function drawStar(ctx, cx, cy, spikes, outerR, innerR) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
    rot += step;
  }
  ctx.closePath();
}

// ---- INPUT ----
canvas.addEventListener('dblclick', (e) => {
  const hex = getHexUnderMouse(e);
  const units = gameState?.units || deployState?.units || [];
  const unit = units.find(u => u.q === hex.q && u.r === hex.r);
  if (unit) showUnitCard(unit);
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1 || e.button === 2) {
    isDragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
    camAtDrag = { x: camX, y: camY };
    return;
  }
  const hex = getHexUnderMouse(e);
  handleHexClick(hex);
});

canvas.addEventListener('mousemove', (e) => {
  if (isDragging) {
    camX = camAtDrag.x + (e.clientX - dragStart.x);
    camY = camAtDrag.y + (e.clientY - dragStart.y);
    render();
    return;
  }
  hoveredHex = getHexUnderMouse(e);
  render();
});

canvas.addEventListener('mouseup', () => { isDragging = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const newZoom = Math.min(3, Math.max(0.3, zoom * delta));

  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Point monde sous le curseur avant zoom
  const worldX = (mouseX - canvas.width / 2 - camX) / zoom;
  const worldY = (mouseY - canvas.height / 2 - camY) / zoom;

  // Recaler la caméra pour que ce point reste sous le curseur
  camX = mouseX - canvas.width / 2 - worldX * newZoom;
  camY = mouseY - canvas.height / 2 - worldY * newZoom;

  zoom = newZoom;
  render();
}, { passive: false });

// Touch support
let lastTouchDist = null;
canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    const t = e.touches[0];
    isDragging = true;
    dragStart = { x: t.clientX, y: t.clientY };
    camAtDrag = { x: camX, y: camY };
  }
});
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (lastTouchDist) {
      zoom = Math.min(3, Math.max(0.3, zoom * (dist / lastTouchDist)));
    }
    lastTouchDist = dist;
    render();
  } else if (e.touches.length === 1 && isDragging) {
    const t = e.touches[0];
    camX = camAtDrag.x + (t.clientX - dragStart.x);
    camY = camAtDrag.y + (t.clientY - dragStart.y);
    render();
  }
}, { passive: false });
canvas.addEventListener('touchend', () => { isDragging = false; lastTouchDist = null; });

function getHexUnderMouse(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left - canvas.width / 2 - camX) / zoom;
  const my = (e.clientY - rect.top - canvas.height / 2 - camY) / zoom;
  return pixelToHex(mx, my);
}

// ---- GAME LOGIC ----
function handleHexClick(hex) {
  const key = `${hex.q},${hex.r}`;

  if (mode === 'deploy') {
    handleDeployClick(hex);
    return;
  }

  if (selectedUnit) {
    // Clic sur case de déplacement → déplacer
    if (movableTiles.has(key)) {
      socket.emit('move_unit', { roomCode, unitId: selectedUnit.id, targetQ: hex.q, targetR: hex.r });
      movableTiles.clear();
      attackableTiles.clear();
      render();
      return;
    }

    // Clic sur ennemi attaquable → attaquer
    if (attackableTiles.has(key)) {
      const target = gameState.units.find(u => u.q === hex.q && u.r === hex.r && !u.isMine);
      if (target) {
        socket.emit('attack_unit', { roomCode, attackerId: selectedUnit.id, targetId: target.id });
        movableTiles.clear();
        attackableTiles.clear();
        render();
        return;
      }
    }

    // Clic sur une autre unité alliée → changer de sélection
    const ally = gameState?.units.find(u => u.q === hex.q && u.r === hex.r && u.isMine);
    if (ally && ally.id !== selectedUnit.id) {
      selectUnit(ally);
      return;
    }

    // Clic hors portée → déselectionner
    selectedUnit = null;
    movableTiles.clear();
    attackableTiles.clear();
    updateActionButtons();
    showUnitDetail(null);
    render();
    return;
  }

  // Pas d'unité sélectionnée → sélectionner
  const unit = gameState?.units.find(u => u.q === hex.q && u.r === hex.r && u.isMine);
  if (unit) selectUnit(unit);
  render();
}

function handleDeployClick(hex) {
  // Clic sur une unité déjà placée → la reprendre
  const clickedUnit = deployState.units.find(u => u.q === hex.q && u.r === hex.r);
  if (clickedUnit) {
    if (selectedUnit && selectedUnit.id === clickedUnit.id) {
      // Déselectionner si on reclique dessus
      selectedUnit = null;
      renderDeployUnitList(deployState.units);
      render();
      return;
    }
    selectedUnit = clickedUnit;
    renderDeployUnitList(deployState.units);
    render();
    return;
  }

  if (!selectedUnit) return;

  const zone = deployState.startingZone;
  const inDeployZone = hexDistance(hex.q, hex.r, zone.q, zone.r) <= zone.radius;

  if (!inDeployZone) {
    // Clic hors zone → déselectionner
    selectedUnit = null;
    renderDeployUnitList(deployState.units);
    render();
    return;
  }

  socket.emit('place_unit', { roomCode, unitId: selectedUnit.id, q: hex.q, r: hex.r });
  selectedUnit.q = hex.q;
  selectedUnit.r = hex.r;
  selectedUnit = null;
  renderDeployUnitList(deployState.units);
  render();
}

function selectUnit(unit) {
  selectedUnit = unit;
  movableTiles.clear();
  attackableTiles.clear();

  if (gameState?.currentPlayerId === myId && !unit.hasMoved && !unit.isFleeing) {
    computeMovableTiles(unit);
  }
  if (gameState?.currentPlayerId === myId && !unit.hasAttacked && !unit.isFleeing) {
    computeAttackableTiles(unit);
  }

  updateActionButtons();
  showUnitDetail(unit);
  renderStancePanel(unit);
  render();
}

function computeMovableTiles(unit) {
  // BFS up to speedRemaining tiles
  const maxSpeed = unit.speedRemaining != null ? unit.speedRemaining : unit.speed;
  const visited = new Set();
  const queue = [{ q: unit.q, r: unit.r, steps: 0 }];
  const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

  visited.add(`${unit.q},${unit.r}`);
  while (queue.length > 0) {
    const { q, r, steps } = queue.shift();
    if (steps >= maxSpeed) continue;
    for (const [dq, dr] of dirs) {
      const nq = q + dq, nr = r + dr;
      const key = `${nq},${nr}`;
      if (visited.has(key)) continue;
      if (gameState && !gameState.visibleHexes.has(key)) continue;
      // Toute case occupée (amie ou ennemie) bloque le passage
      const occupant = gameState?.units.find(u => u.q === nq && u.r === nr);
      if (occupant) continue;
      visited.add(key);
      movableTiles.add(key);
      queue.push({ q: nq, r: nr, steps: steps + 1 });
    }
  }
  movableTiles.delete(`${unit.q},${unit.r}`);
}

function computeAttackableTiles(unit) {
  if (!gameState) return;

  for (const u of gameState.units) {
    if (u.isMine) continue;
    const dist = hexDistance(unit.q, unit.r, u.q, u.r);
    if (dist <= unit.range) {
      attackableTiles.add(`${u.q},${u.r}`);
    }
  }
}

function setMode(newMode) {
  mode = newMode;
  const indicator = document.getElementById('mode-indicator');
  const labels = { select: 'Sélection', move: 'Déplacement', attack: 'Attaque', deploy: 'Déploiement' };
  indicator.textContent = `Mode : ${labels[newMode] || newMode}`;
  if (newMode !== 'move') movableTiles.clear();
  if (newMode !== 'attack') attackableTiles.clear();
  render();
}

function updateActionButtons() {
  const isMyTurn = gameState?.currentPlayerId === myId;
  const hasUnit = !!selectedUnit;
  const isFleeing = hasUnit && selectedUnit.isFleeing;
  const canMove = hasUnit && isMyTurn && !selectedUnit.hasMoved && !isFleeing && (selectedUnit.speedRemaining > 0 || selectedUnit.speedRemaining == null);
  const canAttack = hasUnit && isMyTurn && !selectedUnit.hasAttacked && !isFleeing;
  const isGeneral = hasUnit && selectedUnit.isGeneral;
  const canAbility = isGeneral && isMyTurn && !selectedUnit.hasUsedAbility && selectedUnit.abilityCooldown === 0;

  document.getElementById('btn-move').style.display = canMove ? 'block' : 'none';
  document.getElementById('btn-attack').style.display = canAttack ? 'block' : 'none';
  document.getElementById('btn-ability').style.display = canAbility ? 'block' : 'none';
  document.getElementById('btn-end-turn').style.display = isMyTurn ? 'block' : 'none';
  document.getElementById('btn-deploy-ready').style.display = (mode === 'deploy') ? 'block' : 'none';

  // Show/hide stance panel
  const stancePanel = document.getElementById('stance-panel');
  if (stancePanel) {
    stancePanel.style.display = (hasUnit && isMyTurn && !isFleeing && gameState?.phase === 'battle') ? 'block' : 'none';
  }
}

function showUnitDetail(unit) {
  const panel = document.getElementById('selected-unit-detail');
  if (!unit) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  document.getElementById('detail-name').textContent = unit.name + (unit.isFleeing ? ' (EN FUITE)' : '');
  const speedLabel = unit.speedRemaining != null ? `${unit.speedRemaining}/${unit.speed}` : `${unit.speed}`;
  const stanceLabel = unit.stance ? (stanceNames[unit.stance] || unit.stance) : '—';
  document.getElementById('detail-stats').innerHTML = `
    <div class="stat-row"><span>Vitalité</span><span>${unit.vitality}/${unit.maxVitality}</span></div>
    <div class="stat-row"><span>Moral</span><span>${unit.morale != null ? unit.morale : '—'}/${unit.maxMorale != null ? unit.maxMorale : '—'}</span></div>
    <div class="stat-row"><span>Attaque</span><span>${unit.attack}</span></div>
    <div class="stat-row"><span>Puissance</span><span>${unit.power}</span></div>
    <div class="stat-row"><span>Défense</span><span>${unit.defense}</span></div>
    <div class="stat-row"><span>Armure</span><span>${unit.armor}</span></div>
    <div class="stat-row"><span>Vitesse</span><span>${speedLabel}</span></div>
    <div class="stat-row"><span>Portée</span><span>${unit.range} case${unit.range > 1 ? 's' : ''}</span></div>
    ${unit.visionRange > 0 ? `<div class="stat-row"><span>Vision</span><span>${unit.visionRange} cases</span></div>` : ''}
    <div class="stat-row"><span>Posture</span><span>${stanceLabel}</span></div>
    <div class="stat-row"><span>Déplacé</span><span>${unit.hasMoved ? 'Oui' : 'Non'}</span></div>
    <div class="stat-row"><span>Attaqué</span><span>${unit.hasAttacked ? 'Oui' : 'Non'}</span></div>
  `;
}

function renderUnitList() {
  if (!gameState) return;
  const list = document.getElementById('unit-list');
  list.innerHTML = '';

  const myUnits = gameState.myUnits || [];
  for (const u of myUnits) {
    const div = document.createElement('div');
    const done = u.hasMoved && u.hasAttacked;
    const fleeing = u.isFleeing ? ' style="color:#f84"' : '';
    const stanceLabel = u.stance ? (stanceNames[u.stance] || u.stance).charAt(0).toUpperCase() : '';
    div.className = `unit-row${selectedUnit?.id === u.id ? ' selected' : ''}${done ? ' done' : ''}${u.isGeneral ? ' is-general' : ''}`;
    div.innerHTML = `
      <span class="icon">${u.isGeneral ? '★' : '·'}</span>
      <span class="uname"${fleeing}>${u.name}${u.isFleeing ? ' ✦' : ''}</span>
      <span class="uhp" style="font-size:0.75em;color:#7a5820" title="${u.stance || ''}">[${stanceLabel}]</span>
      <span class="uhp">${u.vitality}/${u.maxVitality}</span>
    `;
    div.onclick = () => {
      if (u.q === null) return;
      selectUnit(u);
      // Pan camera to unit
      const { x, y } = hexToPixel(u.q, u.r);
      camX = -x * zoom;
      camY = -y * zoom;
      render();
    };
    list.appendChild(div);
  }
}

function renderDeployUnitList(units) {
  const list = document.getElementById('unit-list');
  list.innerHTML = '';

  // Instructions en haut
  const instr = document.createElement('div');
  instr.style.cssText = 'background:#0a1a0a;border:1px solid #2a5c2a;border-radius:6px;padding:10px;margin-bottom:10px;font-size:0.8em;color:#80c080;line-height:1.6;';
  instr.innerHTML = `
    <strong style="color:#c8960c">Comment placer :</strong><br>
    1. Clique sur une unité ci-dessous<br>
    2. Clique sur la <span style="color:#4aaa4a">zone verte</span> de la carte<br>
    3. Place ton ★ Général en dernier<br>
    4. Clique <strong>Prêt !</strong>
  `;
  list.appendChild(instr);

  for (const u of units) {
    const placed = u.q !== null;
    const isSelected = selectedUnit && selectedUnit.id === u.id;
    const div = document.createElement('div');
    div.className = `unit-row${u.isGeneral ? ' is-general' : ''}${isSelected ? ' selected' : ''}`;
    div.style.cssText = placed ? 'opacity:0.6;' : 'cursor:pointer;';
    div.innerHTML = `
      <span class="icon">${u.isGeneral ? '★' : '·'}</span>
      <span class="uname">${u.name}</span>
      <span class="uhp" style="color:${placed ? '#4aaa4a' : '#c8960c'}">${placed ? '✓ Placé' : 'À placer'}</span>
    `;
    div.onclick = () => {
      selectedUnit = u;
      renderDeployUnitList(deployState.units);
      render();
    };
    list.appendChild(div);
  }
}

// ---- TOOLBAR ----
function setToolbarTool(tool) {
  // Fermer tous les popups ouverts
  document.querySelectorAll('.tool-popup.visible').forEach(p => p.classList.remove('visible'));
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`tool-${tool}`);
  if (btn) btn.classList.add('active');
}

function setGridOpacity(val) {
  gridOpacity = parseFloat(val);
  render();
}

function setGridThickness(val) {
  gridThickness = parseFloat(val);
  render();
}

function setGridColor(rgb) {
  gridColorRGB = rgb;
  document.querySelectorAll('.grid-color-swatch').forEach(s => s.classList.remove('active'));
  document.querySelectorAll(`.grid-color-swatch[data-rgb="${rgb}"]`).forEach(s => s.classList.add('active'));
  render();
}

function toggleToolPopup(id) {
  const popup = document.getElementById(id);
  const btn = popup.previousElementSibling;
  const isVisible = popup.classList.toggle('visible');
  btn.classList.toggle('active', isVisible);
}

function toggleGridSubmenu() {
  const sub = document.getElementById('grid-submenu');
  const btn = document.getElementById('tool-grid-group');
  const isVisible = sub.classList.toggle('visible');
  btn.classList.toggle('active', isVisible);
  if (!isVisible) {
    document.querySelectorAll('#grid-submenu .tool-popup').forEach(p => p.classList.remove('visible'));
    document.querySelectorAll('#grid-submenu .tool-btn').forEach(b => b.classList.remove('active'));
  }
}

function toggleTerrain() {
  showTerrain = !showTerrain;
  document.getElementById('tool-terrain').classList.toggle('active', showTerrain);
  render();
}

function showInitiativeModal(rolls, turnOrder, turn) {
  const overlay = document.getElementById('overlay-initiative');
  const content = document.getElementById('initiative-content');
  let html = `<h3 style="color:#c8960c;text-align:center;margin-bottom:14px">Tour ${turn} — Initiative</h3>`;
  html += `<div>`;
  for (let i = 0; i < turnOrder.length; i++) {
    const id = turnOrder[i];
    const roll = rolls[id];
    if (!roll) continue;
    const isMe = id === myId;
    html += `<div class="initiative-row${isMe ? ' mine' : ''}">
      <span class="rank">${i + 1}.</span>
      <span class="i-name">${roll.playerName}<span style="color:#7a5820;font-size:0.85em"> (${roll.generalName})</span></span>
      <span class="i-roll">Str ${roll.strategy} + D20 <strong>${roll.d20}</strong> = <strong>${roll.total}</strong></span>
    </div>`;
  }
  html += `</div>`;
  content.innerHTML = html;
  overlay.style.display = 'flex';
  if (window._initiativeTimer) clearTimeout(window._initiativeTimer);
  window._initiativeTimer = setTimeout(closeInitiativeModal, 8000);
}

function closeInitiativeModal() {
  document.getElementById('overlay-initiative').style.display = 'none';
  if (window._initiativeTimer) clearTimeout(window._initiativeTimer);
}

function renderTurnOrder(turnOrder, initiativeRolls, currentPlayerId) {
  const panel = document.getElementById('turn-order-panel');
  const list = document.getElementById('turn-order-list');
  if (!turnOrder || turnOrder.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  list.innerHTML = '';
  const currentIdx = turnOrder.indexOf(currentPlayerId);

  for (let i = 0; i < turnOrder.length; i++) {
    const id = turnOrder[i];
    const roll = initiativeRolls?.[id];
    const isCurrent = id === currentPlayerId;
    const hasPlayed = currentIdx >= 0 && i < currentIdx;

    // Trouver le generalId du joueur
    const playerData = gameState?.players.find(p => p.id === id);
    const gid = playerData?.generalId;
    const imgToken = gid ? GENERAL_TOKEN_MAP[gid] : null;
    const img1Src = img1Url(GENERAL_IMAGE1_MAP, gid, 'GENERAL IMAGE 1-1');
    const imgTokenSrc = imgToken ? `/assets/GENERAL TOKEN/${encodeURIComponent(imgToken)}.png` : null;
    let portraitHtml;
    if (img1Src) {
      portraitHtml = `<img class="to-portrait" src="${img1Src}">`;
    } else if (imgTokenSrc) {
      portraitHtml = `<img class="to-portrait" src="${imgTokenSrc}">`;
    } else {
      portraitHtml = `<div class="to-portrait-placeholder">★</div>`;
    }

    const name = roll?.playerName || roll?.generalName || id;
    const div = document.createElement('div');
    div.className = `turn-order-item${isCurrent ? ' current' : ''}${hasPlayed ? ' played' : ''}`;
    div.innerHTML = `${portraitHtml}<span class="to-name">${name}</span>`;
    list.appendChild(div);
  }
}

function endTurn() {
  if (gameState?.currentPlayerId !== myId) return;
  socket.emit('end_turn', { roomCode });
  selectedUnit = null;
  movableTiles.clear();
  attackableTiles.clear();
  setMode('select');
  const stancePanel = document.getElementById('stance-panel');
  if (stancePanel) stancePanel.style.display = 'none';
}

function useAbility() {
  if (!selectedUnit || !selectedUnit.isGeneral) return;
  socket.emit('use_ability', { roomCode });
}

function deploymentReady() {
  const gen = deployState?.units.find(u => u.isGeneral);
  if (!gen || gen.q === null) {
    notify('Vous devez placer votre Général (★) avant d\'être prêt.');
    return;
  }
  socket.emit('deployment_ready', { roomCode });
  const btn = document.getElementById('btn-deploy-ready');
  btn.textContent = 'En attente des autres joueurs…';
  btn.disabled = true;
}

function addCombatLog(log) {
  const container = document.getElementById('combat-log');
  const entry = document.createElement('div');
  entry.className = 'combat-log-entry' + (log.targetKilled ? ' kill' : log.hit ? ' hit' : ' miss');

  let text = '';
  if (log.abilityUsed) {
    text = `⚡ ${log.abilityUsed}: ${log.effects?.join(', ')}`;
  } else {
    text = `${log.attackerName} → ${log.targetName}: `;
    // Support both old format (damage) and new format (dmgReceived)
    const dmg = log.dmgReceived != null ? log.dmgReceived : log.damage;
    text += log.hit ? `${dmg} dégâts` : 'Manqué';
    if (log.targetKilled) text += ` (${log.targetName} éliminé!)`;
    if (log.generalKilled) text += ` ⚠ GÉNÉRAL TUÉ!`;
  }
  entry.textContent = text;
  container.insertBefore(entry, container.firstChild);
  if (container.children.length > 20) container.lastChild.remove();
}

function showUnitCard(unit) {
  const overlay = document.getElementById('overlay-unit-card');
  const content = document.getElementById('unit-card-content');

  // Image portrait
  let imgHtml = '';
  if (unit.isGeneral) {
    const gid = unit.generalId || (gameState?.players.find(p => p.id === unit.playerId)?.generalId);
    const src = img1Url(GENERAL_IMAGE1_MAP, gid, 'GENERAL IMAGE 1-1');
    if (src) {
      imgHtml = `<img class="uc-pdf-img" src="${src}" alt="${unit.name}">`;
    } else {
      imgHtml = `<div class="uc-pdf-img-placeholder" style="font-size:52px;flex-direction:column;gap:8px">★<span style="font-size:14px;color:#7a5820">${unit.name}</span></div>`;
    }
  } else {
    const src = img1Url(UNIT_IMAGE1_MAP, unit.typeId, 'UNIT IMAGE 1-1');
    const imgToken = UNIT_TOKEN_MAP[unit.typeId];
    if (src) {
      imgHtml = `<img class="uc-pdf-img" src="${src}" alt="${unit.name}">`;
    } else if (imgToken) {
      imgHtml = `<img class="uc-pdf-img" src="/assets/UNIT TOKEN/${encodeURIComponent(imgToken)}.png" alt="${unit.name}">`;
    } else {
      imgHtml = `<div class="uc-pdf-img-placeholder">${unit.name.charAt(0)}</div>`;
    }
  }

  // Barre de vie
  const hpPct = Math.round(unit.vitality / unit.maxVitality * 100);
  const hpColor = hpPct > 50 ? '#2a8c2a' : hpPct > 25 ? '#c8960c' : '#a02020';
  const hpBar = `<div class="uc-pdf-hpbar-wrap"><div class="uc-pdf-hpbar" style="width:${hpPct}%;background:${hpColor}"></div></div>`;

  // Stats
  const stats = [
    { label: 'Vitalité', value: `${unit.vitality}/${unit.maxVitality}` },
    { label: 'Morale',   value: `${unit.morale ?? '—'}/${unit.maxMorale ?? '—'}` },
    { label: 'Attaque',  value: unit.attack },
    { label: 'Défense',  value: unit.defense },
    { label: 'Puissance',value: unit.power },
    { label: 'Armure',   value: unit.armor },
    { label: 'Intimidation', value: unit.intimidation ?? 0 },
    { label: 'Vitesse',  value: unit.speed },
  ];
  if (unit.range > 1) stats.push({ label: 'Portée', value: `${unit.range} cases` });

  const statsHtml = stats.map(s =>
    `<div class="uc-pdf-stat"><div class="uc-pdf-stat-label">${s.label}</div><div class="uc-pdf-stat-value">${s.value}</div></div>`
  ).join('');

  // Bonus / capacités
  const bonusLines = [];
  if (unit.bonus) bonusLines.push(`<strong>Bonus :</strong> ${unit.bonus}`);
  if (unit.activeAbility) bonusLines.push(`<strong>Capacité active :</strong> ${unit.activeAbility.name} — ${unit.activeAbility.description} (recharge : ${unit.activeAbility.cooldown} tours)`);
  if (unit.passiveAbility) bonusLines.push(`<strong>Passif :</strong> ${unit.passiveAbility.name} — ${unit.passiveAbility.description}`);
  const bonusHtml = bonusLines.length
    ? `<div class="uc-pdf-bonus">${bonusLines.join('<br>')}</div>`
    : `<div class="uc-pdf-bonus" style="color:#888;font-style:italic">Aucun bonus spécial</div>`;

  // Titre
  const category = unit.category ? `<br><span style="font-size:0.85em">(${unit.category})</span>` : '';
  const titleHtml = `<div class="uc-pdf-title">${unit.name}${category}</div>`;

  // Description
  const descHtml = unit.description || unit.citation
    ? `<div class="uc-pdf-desc"><strong>Description :</strong> ${unit.description || unit.citation}</div>`
    : '';

  content.innerHTML = `
    <div class="uc-pdf">
      <div class="uc-pdf-left">
        ${imgHtml}
        ${hpBar}
        ${bonusHtml}
      </div>
      <div class="uc-pdf-right">
        ${titleHtml}
        <div class="uc-pdf-stats">${statsHtml}</div>
      </div>
      ${descHtml}
    </div>
  `;

  overlay.style.display = 'flex';
}

function closeUnitCard() {
  document.getElementById('overlay-unit-card').style.display = 'none';
}

function notify(msg, type = 'error') {
  const n = document.getElementById('notification');
  n.textContent = msg;
  n.className = type;
  n.style.display = 'block';
  setTimeout(() => n.style.display = 'none', 3000);
}

// ---- STANCE PANEL ----
function renderStancePanel(unit) {
  const panel = document.getElementById('stance-panel');
  const listEl = document.getElementById('stance-list');
  if (!panel || !listEl) return;
  if (!unit || gameState?.currentPlayerId !== myId || unit.isFleeing || gameState?.phase !== 'battle') {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  listEl.innerHTML = '';
  for (const s of stanceList) {
    const btn = document.createElement('button');
    btn.className = 'stance-btn' + (unit.stance === s ? ' active' : '');
    btn.title = stanceNames[s] || s;
    const icon = stanceIcons[s];
    if (icon && icon.complete && icon.naturalWidth) {
      btn.innerHTML = `<img src="${icon.src}" alt="${s}"> ${stanceNames[s] || s}`;
    } else {
      btn.textContent = stanceNames[s] || s;
    }
    btn.onclick = () => changeStance(unit.id, s);
    listEl.appendChild(btn);
  }
}

function changeStance(unitId, stanceId) {
  if (!roomCode) return;
  socket.emit('change_stance', { roomCode, unitId, stanceId });
}

// ---- COMBAT RESULT ----
function showCombatResult(log) {
  const el = document.getElementById('combat-result-box');
  if (!el) return;
  let html = `<b>${log.attackerName}</b> attaque <b>${log.targetName}</b><br>`;
  html += `Attaque : ${log.attackTotal} vs D20=${log.attackD20} → ${log.hit ? '<span style="color:#4f4">TOUCHÉ</span>' : '<span style="color:#f44">RATÉ</span>'}<br>`;
  if (log.hit) {
    html += `Dégâts infligés : ${log.dmgInflicted} − armure ${log.armorAbsorb} = <b>${log.dmgReceived}</b><br>`;
    html += `Moral −${log.moralDmg}<br>`;
  }
  if (log.defenseChoice && log.defenseChoice !== 'rien') {
    html += `Défense (${log.defenseChoice}) : ${log.defenseSuccess ? '<span style="color:#4f4">SUCCÈS</span>' : '<span style="color:#f44">ÉCHEC</span>'}`;
    if (log.defenseSuccess && log.counterDmgReceived > 0) {
      html += ` → contre-attaque <b>${log.counterDmgReceived}</b> dégâts`;
    }
    html += '<br>';
  }
  if (log.targetKilled) html += `<span style="color:#f84">&#9876; ${log.targetName} éliminé !</span><br>`;
  if (log.attackerKilled) html += `<span style="color:#f84">&#9876; ${log.attackerName} éliminé !</span><br>`;
  el.innerHTML = html;
  el.style.display = 'block';
  clearTimeout(window._combatResultTimer);
  window._combatResultTimer = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// ---- DEFENSE POPUP ----
function showDefenseRequest(data) {
  const overlay = document.getElementById('overlay-defense');
  if (!overlay) return;
  document.getElementById('defense-attacker-name').textContent = data.attackerName;
  document.getElementById('defense-target-name').textContent = data.targetName;
  overlay.style.display = 'flex';
  overlay.dataset.attackId = data.attackId;
  overlay.dataset.roomCode = data.roomCode;
  // Countdown
  let t = 8;
  const countdown = document.getElementById('defense-countdown');
  if (countdown) countdown.textContent = t;
  window._defenseTimer = setInterval(() => {
    t--;
    if (countdown) countdown.textContent = t;
    if (t <= 0) {
      clearInterval(window._defenseTimer);
      sendDefenseChoice('rien');
    }
  }, 1000);
}

function sendDefenseChoice(choice) {
  clearInterval(window._defenseTimer);
  const overlay = document.getElementById('overlay-defense');
  if (!overlay) return;
  const attackId = overlay.dataset.attackId;
  const rc = overlay.dataset.roomCode;
  overlay.style.display = 'none';
  socket.emit('defend_choice', { roomCode: rc, attackId, choice });
}

// ---- SOCKET EVENTS ----
socket.on('connect', () => {
  const oldPlayerId = sessionStorage.getItem('myId');
  const rc = sessionStorage.getItem('roomCode');

  if (!oldPlayerId || !rc) {
    window.location.href = '/';
    return;
  }

  roomCode = rc;
  // Envoyer l'ancien ID pour que le serveur retrouve le joueur
  socket.emit('rejoin_game', { roomCode: rc, oldPlayerId });

  if (deployState) {
    mode = 'deploy';
    setMode('deploy');
    document.getElementById('sidebar-title').textContent = 'Déploiement';
    document.getElementById('btn-deploy-ready').style.display = 'block';
    renderDeployUnitList(deployState.units);
    resizeCanvas();
    if (deployState.startingZone) {
      const { x, y } = hexToPixel(deployState.startingZone.q, deployState.startingZone.r);
      camX = -x * zoom;
      camY = -y * zoom;
    }
  }
});

socket.on('deployment_state', (state) => {
  myId = socket.id;
  deployState = state;
  renderDeployUnitList(state.units);
  render();
});

socket.on('phase_change', ({ phase }) => {
  if (phase === 'battle') {
    deployState = null;
    sessionStorage.removeItem('deploymentState');
    mode = 'select';
    setMode('select');
    document.getElementById('btn-deploy-ready').style.display = 'none';
  }
});

socket.on('unit_move_anim', ({ unitId, fromQ, fromR, path }) => {
  unitAnimations[unitId] = { path, fromQ, fromR, startTime: performance.now() };
  startAnimLoop();
});

socket.on('game_state', (state) => {
  myId = socket.id; // Mettre à jour l'ID avec le nouveau socket
  gameState = state;
  gameState.visibleHexes = new Set(state.visibleHexes);

  // Update top bar
  document.getElementById('top-turn').textContent = `Tour ${state.turn}`;
  const currPlayer = state.players.find(p => p.id === state.currentPlayerId);
  document.getElementById('top-current-player').textContent =
    state.currentPlayerId === myId ? '⚔️ Votre tour' : `Tour de : ${currPlayer?.name || '?'}`;
  document.getElementById('top-phase').textContent = state.phase === 'battle' ? 'Bataille' : '';

  document.getElementById('sidebar-title').textContent =
    state.currentPlayerId === myId ? 'Votre tour' : `Tour de ${currPlayer?.name || '?'}`;

  // Refresh selected unit from new state
  if (selectedUnit) {
    const updated = state.myUnits.find(u => u.id === selectedUnit.id);
    if (updated) { selectedUnit = updated; showUnitDetail(updated); renderStancePanel(updated); }
    else { selectedUnit = null; showUnitDetail(null); renderStancePanel(null); }
  }

  renderTurnOrder(state.turnOrder, state.initiativeRolls, state.currentPlayerId);
  renderUnitList();
  updateActionButtons();
  render();
});

socket.on('turn_change', ({ currentPlayerId, turn }) => {
  if (gameState) {
    gameState.currentPlayerId = currentPlayerId;
    gameState.turn = turn;
  }
  selectedUnit = null;
  movableTiles.clear();
  attackableTiles.clear();
  updateActionButtons();
  if (currentPlayerId === myId) notify('C\'est votre tour !', 'success');
});

socket.on('initiative_rolled', ({ rolls, turnOrder, turn }) => {
  showInitiativeModal(rolls, turnOrder, turn);
});

socket.on('combat_result', (data) => {
  // Support both old format (direct log) and new format ({ combatLog })
  const log = data.combatLog || data;
  addCombatLog(log);
  showCombatResult(log);
});

socket.on('defense_request', (data) => {
  showDefenseRequest(data);
});

socket.on('waiting_defense', () => {
  const el = document.getElementById('combat-result-box');
  if (el) { el.innerHTML = 'En attente de la réponse du défenseur…'; el.style.display = 'block'; }
});

socket.on('units_fled', ({ fled }) => {
  const el = document.getElementById('combat-result-box');
  if (el && fled.length > 0) {
    el.innerHTML = fled.map(f => `&#127939; ${f.unitName} a fui !`).join('<br>');
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  }
});

socket.on('game_over', ({ winnerName }) => {
  document.getElementById('gameover-msg').textContent =
    winnerName ? `${winnerName} remporte la bataille !` : 'Match nul !';
  document.getElementById('overlay-gameover').style.display = 'flex';
});

socket.on('deployment_ready_update', ({ readyCount, total }) => {
  notify(`${readyCount}/${total} joueurs prêts…`, 'info');
  const btn = document.getElementById('btn-deploy-ready');
  btn.textContent = `En attente… (${readyCount}/${total} prêts)`;
  btn.disabled = true;
});

socket.on('error', (msg) => notify(msg));

socket.on('player_disconnected', () => {
  notify('Un joueur s\'est déconnecté.', 'info');
});

// Init
resizeCanvas();
