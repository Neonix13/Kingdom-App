// Kingdom Battleground — Game Client

// WebSocket natif (remplace socket.io)
let ws = null;

function wsConnect() {
  ws = new WebSocket(window.WS_URL || ('ws' + (location.protocol === 'https:' ? 's' : '') + '://' + location.host));
  ws.onopen = onWsOpen;
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    const { event, ...data } = msg;
    wsDispatch(event, data);
  };
  ws.onclose = () => { ws = null; setTimeout(wsConnect, 2000); };
  ws.onerror = () => ws.close();
}

function wsSend(action, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action, ...data }));
}

wsConnect();
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

// Chargement des segments
let segmentData = {};
fetch('/segments.json').then(r => r.json()).then(d => { segmentData = d; render(); }).catch(() => {});

// Edge i = between corners[i] and corners[(i+1)%6], direction to neighbor i
const SEGMENT_EDGE_DIRS = [[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]];

const SEGMENT_COLORS_MAP = {
  river:            '#4a90d9',
  cliff:            '#8888aa',
  bridge:           '#e8a040',
  passerelle:       '#c8b060',
  barriere:         '#4a8040',
  chevaux_de_frise: '#c04040',
  mur:              '#606060',
  echelle:          '#a07840',
};

// Propriétés locales pour les vérifications de mouvement côté client
const SEGMENT_DEFS_CLIENT = {
  river:            { vitesse: -1, vitesse_tout: false, infranchissable: false, infranchissable_cavalerie: false },
  cliff:            { vitesse: 0,  vitesse_fixe: 3, vitesse_tout: false, infranchissable: false, infranchissable_cavalerie: true },
  bridge:           { vitesse: 0,  vitesse_tout: false, infranchissable: false, infranchissable_cavalerie: false },
  passerelle:       { vitesse: 0,  vitesse_tout: false, infranchissable: false, infranchissable_cavalerie: false },
  barriere:         { vitesse: -1, vitesse_tout: false, infranchissable: false, infranchissable_cavalerie: false },
  chevaux_de_frise: { vitesse: 0,  vitesse_tout: false, infranchissable: false, infranchissable_cavalerie: false },
  mur:              { vitesse: 0,  vitesse_tout: false, infranchissable: true,  infranchissable_cavalerie: false },
  echelle:          { vitesse: -2, vitesse_tout: false, infranchissable: false, infranchissable_cavalerie: true },
};

function segmentEdgeKey(q1, r1, q2, r2) {
  if (q1 < q2 || (q1 === q2 && r1 < r2)) return `${q1},${r1}|${q2},${r2}`;
  return `${q2},${r2}|${q1},${r1}`;
}

function drawSegments(ctx) {
  if (Object.keys(segmentData).length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  for (const [edgeKey, segType] of Object.entries(segmentData)) {
    const color = SEGMENT_COLORS_MAP[segType];
    if (!color) continue;
    const parts = edgeKey.split('|');
    const [q1, r1] = parts[0].split(',').map(Number);
    const [q2, r2] = parts[1].split(',').map(Number);
    const dq = q2 - q1, dr = r2 - r1;
    const dirIdx = SEGMENT_EDGE_DIRS.findIndex(([d0, d1]) => d0 === dq && d1 === dr);
    if (dirIdx === -1) continue;
    const { x: cx, y: cy } = hexToPixel(q1, r1);
    const corners = hexCorners(cx, cy);
    const c1 = corners[dirIdx], c2 = corners[(dirIdx + 1) % 6];
    ctx.strokeStyle = color;
    ctx.lineWidth = HEX_SIZE * 0.13;
    ctx.beginPath();
    ctx.moveTo(c1.x, c1.y);
    ctx.lineTo(c2.x, c2.y);
    ctx.stroke();
  }
  ctx.restore();
}

// Chargement de l'image d'arbre
const treeImage = new Image();
treeImage.src = '/assets/arbre.png';
treeImage.onload = () => render();

// Stance icons
const stanceIcons = {};
const stanceList = ['marche','combat','charge','percee','defense_combat','defense_distance'];
const stanceIconFiles = { marche:'marche', combat:'combat', charge:'charge', percee:'percee', defense_combat:'def_charge', defense_distance:'def_eparse' };
const stanceNames = { marche:'Marche', combat:'Combat', charge:'Charge', percee:'Percée', defense_combat:'Déf. combat', defense_distance:'Déf. distance' };
const STANCES_DATA = {
  marche:           { vitesse:+1, attack_cac:-1, attack_tir:-2, defense_cac:-2, defense_tir:-1, puissance_cac:+1, puissance_tir:-1, intimidation_cac:0, intimidation_tir:0, esquive_cac:+1, esquive_tir:+2, precision_cac:0, precision_tir:-2, armure:-1, moral_tour:0 },
  combat:           { vitesse:-1, attack_cac:+1, attack_tir:+1, defense_cac:+1, defense_tir:+1, puissance_cac:+2, puissance_tir:+2, intimidation_cac:+1, intimidation_tir:+1, esquive_cac:0, esquive_tir:0, precision_cac:+1, precision_tir:+2, armure:+1, moral_tour:0 },
  charge:           { vitesse:+2, attack_cac:+3, attack_tir:-2, defense_cac:-1, defense_tir:-2, puissance_cac:+3, puissance_tir:-2, intimidation_cac:+2, intimidation_tir:-1, esquive_cac:+2, esquive_tir:+3, precision_cac:+3, precision_tir:-2, armure:0, moral_tour:-1 },
  percee:           { vitesse:+1, attack_cac:+2, attack_tir:-2, defense_cac:-1, defense_tir:-2, puissance_cac:+2, puissance_tir:-2, intimidation_cac:0, intimidation_tir:0, esquive_cac:0, esquive_tir:+2, precision_cac:+2, precision_tir:-2, armure:0, moral_tour:0 },
  defense_combat:   { vitesse:-1, attack_cac:-2, attack_tir:-1, defense_cac:+4, defense_tir:-2, puissance_cac:-1, puissance_tir:-2, intimidation_cac:-2, intimidation_tir:+1, esquive_cac:+1, esquive_tir:-1, precision_cac:0, precision_tir:-2, armure:+2, moral_tour:0 },
  defense_distance: { vitesse:0,  attack_cac:-3, attack_tir:0,  defense_cac:-3, defense_tir:0,  puissance_cac:-2, puissance_tir:-1, intimidation_cac:-2, intimidation_tir:-1, esquive_cac:+2, esquive_tir:+4, precision_cac:-2, precision_tir:-1, armure:+1, moral_tour:0 },
};
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

  const allUnits = [...(gameState?.units || []), ...(deployState?.units || [])];

  // Cases directement occupées par un pion
  const unitHexes = new Set();
  for (const u of allUnits) {
    if (u.q !== null) unitHexes.add(`${u.q},${u.r}`);
  }

  // Cases dans la vision
  const visibleHexes = gameState?.visibleHexes || new Set();

  for (const [key, terrain] of Object.entries(terrainData)) {
    if (terrain !== 'forest') continue;
    const [q, r] = key.split(',').map(Number);
    const { x, y } = hexToPixel(q, r);

    let alpha;
    if (unitHexes.has(key)) {
      alpha = 0;
    } else if (visibleHexes.has(key)) {
      alpha = 0.10;
    } else {
      alpha = 0.65;
    }
    if (alpha === 0) continue;

    const treeCount = 7 + Math.floor(seededRand(q * 137 + r * 251) * 4);
    for (let i = 0; i < treeCount; i++) {
      const s1 = q * 1000 + r * 100 + i * 7 + 1;
      const s2 = q * 2000 + r * 200 + i * 13 + 2;
      const s3 = q * 3000 + r * 300 + i * 17 + 3;
      const s4 = q * 4000 + r * 400 + i * 23 + 4;
      const offsetX = (seededRand(s1) - 0.5) * HEX_SIZE * 1.1;
      const offsetY = (seededRand(s2) - 0.5) * HEX_SIZE * 0.9;
      const rotation = seededRand(s3) * Math.PI * 2;
      const size = HEX_SIZE * (1.5 + seededRand(s4) * 0.7);
      ctx.save();
      ctx.globalAlpha = alpha;
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

function smoothPanTo(worldX, worldY, durationMs = 600) {
  const startX = camX, startY = camY;
  const targetX = -worldX * zoom, targetY = -worldY * zoom;
  const startTime = performance.now();
  function step(now) {
    const t = Math.min(1, (now - startTime) / durationMs);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    camX = startX + (targetX - startX) * ease;
    camY = startY + (targetY - startY) * ease;
    render();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
let isDragging = false, dragStart = null, camAtDrag = null;

// Player colors
const PLAYER_COLORS = [
  '#e05020', '#2070e0', '#20a020', '#e0c020',
  '#a020e0', '#e02080', '#20e0c0', '#e08020'
];

function getPlayerColor(playerId) {
  if (!gameState) return '#4a90d9';
  const player = gameState.players.find(p => p.id === playerId);
  return player?.color || '#4a90d9';
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
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2 + camX, canvas.height / 2 + camY);
  ctx.scale(zoom, zoom);

  // Dessin de la carte en arrière-plan
  if (mapImage.complete && mapImage.naturalWidth) {
    const imgX = -MAP_ORIG_X * MAP_SCALE;
    const imgY = -MAP_ORIG_Y * MAP_SCALE;
    ctx.drawImage(mapImage, imgX, imgY, MAP_IMG_W * MAP_SCALE, MAP_IMG_H * MAP_SCALE);
  }

  const visibleSet = new Set(gameState?.visibleHexes || []);
  const startZone = deployState?.startingZone;

  const S = Math.sqrt(3);
  const qMin = Math.floor(-MAP_ORIG_X / (MAP_HEX_SIZE * 1.5)) - 1;
  const qMax = Math.ceil((MAP_IMG_W - MAP_ORIG_X) / (MAP_HEX_SIZE * 1.5)) + 1;

  if (gameState && gameState.phase === 'battle') {
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
        let fill = isVisible ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,0.72)';
        let stroke = isVisible ? `rgba(${gridColorRGB},${gridOpacity})` : 'rgba(0,0,0,0)';
        if (isVisible && movableTiles.has(key)) fill = 'rgba(40,120,20,0.35)';
        if (isVisible && attackableTiles.has(key)) fill = 'rgba(180,30,10,0.35)';
        if (isHovered && isVisible) stroke = '#c8960c';
        drawHex(ctx, x, y, fill, stroke, 1, gridThickness);
      }
    }
  } else {
    // Deployment: iterate over the full map extent without needing hexMap
    for (let q = qMin; q <= qMax; q++) {
      const rMin2 = Math.floor((-MAP_ORIG_Y - MAP_HEX_SIZE * S / 2 * q) / (MAP_HEX_SIZE * S)) - 1;
      const rMax2 = Math.ceil((MAP_IMG_H - MAP_ORIG_Y - MAP_HEX_SIZE * S / 2 * q) / (MAP_HEX_SIZE * S)) + 1;
      for (let r = rMin2; r <= rMax2; r++) {
        const imgX = MAP_HEX_SIZE * 1.5 * q + MAP_ORIG_X;
        const imgY = MAP_HEX_SIZE * (S / 2 * q + S * r) + MAP_ORIG_Y;
        if (imgX < 0 || imgX > MAP_IMG_W || imgY < 0 || imgY > MAP_IMG_H) continue;
        const { x, y } = hexToPixel(q, r);
        const inZone = startZone ? hexDistance(q, r, startZone.q, startZone.r) <= startZone.radius : false;
        const isHovered = hoveredHex && hoveredHex.q === q && hoveredHex.r === r;
        let fill = inZone ? 'rgba(40,120,20,0.25)' : 'rgba(0,0,0,0)';
        let stroke = inZone ? `rgba(80,200,40,${Math.min(1, gridOpacity * 2)})` : `rgba(${gridColorRGB},${gridOpacity * 0.6})`;
        if (inZone && isHovered) fill = 'rgba(60,180,30,0.4)';
        if (isHovered && !inZone) stroke = 'rgba(200,160,80,0.5)';
        drawHex(ctx, x, y, fill, stroke, 1, gridThickness);
      }
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

  // Arbres par dessus les unités
  drawForestTrees(ctx);

  // Overlays de terrain (si activé) — par dessus les arbres
  if (showTerrain) {
    for (const [key, terrain] of Object.entries(terrainData)) {
      const color = TERRAIN_COLORS[terrain];
      if (!color) continue;
      const [q, r] = key.split(',').map(Number);
      const { x, y } = hexToPixel(q, r);
      drawHex(ctx, x, y, color, 'rgba(0,0,0,0)');
    }
  }

  // Segments (arêtes entre tuiles) — visibles quand le toggle terrain est actif
  if (showTerrain) drawSegments(ctx);

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

function drawTokenImage(ctx, img, x, y, radius, tintColor, tintOpacity = 0.25, overlayColor = null) {
  const RES = 4; // suréchantillonnage pour éviter le flou au zoom
  const size = Math.ceil(radius * 2 * RES);
  const off = document.createElement('canvas');
  off.width = size; off.height = size;
  const o = off.getContext('2d');
  o.imageSmoothingEnabled = true;
  o.imageSmoothingQuality = 'high';
  o.beginPath();
  o.arc(radius * RES, radius * RES, radius * RES, 0, Math.PI * 2);
  o.clip();
  o.drawImage(img, 0, 0, size, size);
  o.globalCompositeOperation = 'source-atop';
  if (tintColor) {
    const r = parseInt(tintColor.slice(1,3),16);
    const g = parseInt(tintColor.slice(3,5),16);
    const b = parseInt(tintColor.slice(5,7),16);
    o.fillStyle = `rgba(${r},${g},${b},${tintOpacity})`;
    o.fillRect(0, 0, size, size);
  }
  if (overlayColor) {
    o.fillStyle = overlayColor;
    o.fillRect(0, 0, size, size);
  }
  ctx.drawImage(off, x - radius, y - radius, radius * 2, radius * 2);
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

  const overlayColor = unit.isFleeing ? 'rgba(255,80,0,0.45)'
    : (unit.hasMoved && unit.isMine) ? 'rgba(0,0,0,0.45)'
    : null;

  if (unit.isGeneral) {
    const gid = getGeneralIdForUnit(unit);
    const img = gid ? generalTokenImages[gid] : null;
    if (img && img.complete && img.naturalWidth) {
      drawTokenImage(ctx, img, x, y, tokenR, color, 0.15, overlayColor);
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
      drawTokenImage(ctx, img, x, y, tokenR, color, 0.25, overlayColor);
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

  // Draw stance icon (bottom-right of hex) — all non-general units
  if (unit.stance && !unit.isGeneral) {
    const icon = stanceIcons[unit.stance];
    const iconSize = HEX_SIZE * 0.4;
    const iconX = x + HEX_SIZE * 0.45;
    const iconY = y + HEX_SIZE * 0.35;
    const r = iconSize * 0.62;
    // Background circle + golden border
    ctx.beginPath();
    ctx.arc(iconX, iconY, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,14,6,0.82)';
    ctx.fill();
    ctx.strokeStyle = unit.isMine ? '#c8960c' : '#9090c0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (icon && icon.complete && icon.naturalWidth) {
      ctx.drawImage(icon, iconX - iconSize/2, iconY - iconSize/2, iconSize, iconSize);
    } else {
      ctx.fillStyle = unit.isMine ? '#c8960c' : '#a0a0e0';
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
      wsSend('move_unit', { roomCode, unitId: selectedUnit.id, targetQ: hex.q, targetR: hex.r });
      movableTiles.clear();
      attackableTiles.clear();
      render();
      return;
    }

    // Clic sur ennemi attaquable → attaquer
    if (attackableTiles.has(key)) {
      const target = gameState.units.find(u => u.q === hex.q && u.r === hex.r && !u.isMine);
      if (target) {
        wsSend('attack_unit', { roomCode, attackerId: selectedUnit.id, targetId: target.id });
        movableTiles.clear();
        attackableTiles.clear();
        render();
        return;
      }
    }

    // Mode motiver → cliquer une unité amie à portée
    if (mode === 'motivate') {
      const target = gameState?.units.find(u => u.q === hex.q && u.r === hex.r && u.isMine && !u.isGeneral);
      if (target) {
        const dist = hexDistance(selectedUnit.q, selectedUnit.r, hex.q, hex.r);
        if (dist <= 2) {
          wsSend('motivate_unit', { roomCode, generalId: selectedUnit.id, targetId: target.id });
          setMode('select');
          return;
        }
      }
      setMode('select');
      return;
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

  wsSend('place_unit', { roomCode, unitId: selectedUnit.id, q: hex.q, r: hex.r });
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

  if (gameState?.currentPlayerId === myId && unit.speedRemaining > 0 && !unit.isFleeing) {
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

function terrainMoveCost(key) {
  const t = terrainData[key] || 'plain';
  const costs = { plain: 1, road: 1, forest: 2, river: 2, building: 1, bridge: 1 };
  return costs[t] ?? 1;
}

function computeMovableTiles(unit) {
  const maxSpeed = unit.speedRemaining != null ? unit.speedRemaining : unit.speed;
  const isCavalry = unit.category === 'Chevaux' || unit.category === 'Chars';
  const dist = new Map();
  const queue = [{ q: unit.q, r: unit.r, cost: 0 }];
  const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  dist.set(`${unit.q},${unit.r}`, 0);

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const { q, r, cost } = queue.shift();
    if (cost > dist.get(`${q},${r}`)) continue;
    if (cost >= maxSpeed) continue;
    for (const [dq, dr] of dirs) {
      const nq = q + dq, nr = r + dr;
      const key = `${nq},${nr}`;
      if (gameState && !gameState.visibleHexes.has(key)) continue;
      const occupant = gameState?.units.find(u => u.q === nq && u.r === nr);
      if (occupant) continue;

      // Segment check
      const edgeK = segmentEdgeKey(q, r, nq, nr);
      const segType = segmentData[edgeK];
      const segDef = segType ? SEGMENT_DEFS_CLIENT[segType] : null;
      if (segDef) {
        if (segDef.infranchissable) continue;
        if (segDef.infranchissable_cavalerie && isCavalry) continue;
      }

      const srcKey = `${q},${r}`;
      let stepCost = terrainMoveCost(srcKey);
      if (segDef) {
        if (segDef.vitesse_fixe != null) {
          stepCost = segDef.vitesse_fixe;
        } else {
          stepCost += Math.max(0, -(segDef.vitesse || 0));
        }
      }
      const newCost = cost + stepCost;
      if (newCost > maxSpeed) continue;
      if (!dist.has(key) || newCost < dist.get(key)) {
        dist.set(key, newCost);
        movableTiles.add(key);
        queue.push({ q: nq, r: nr, cost: newCost });
      }
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
  const labels = { select: 'Sélection', move: 'Déplacement', attack: 'Attaque', motivate: 'Motiver', deploy: 'Déploiement' };
  indicator.textContent = `Mode : ${labels[newMode] || newMode}`;
  if (newMode !== 'move') movableTiles.clear();
  if (newMode !== 'attack') {
    attackableTiles.clear();
  } else if (selectedUnit) {
    computeAttackableTiles(selectedUnit);
  }
  render();
}

function updateActionButtons() {
  const isMyTurn = gameState?.currentPlayerId === myId;
  const hasUnit = !!selectedUnit;
  const isFleeing = hasUnit && selectedUnit.isFleeing;
  const canMove = hasUnit && isMyTurn && !isFleeing && (selectedUnit.speedRemaining > 0);
  const canAttack = hasUnit && isMyTurn && !selectedUnit.hasAttacked && !isFleeing;
  const isGeneral = hasUnit && selectedUnit.isGeneral;
  const canAbility = isGeneral && isMyTurn && !selectedUnit.hasUsedAbility && selectedUnit.abilityCooldown === 0;
  const canMotivate = isGeneral && isMyTurn && !selectedUnit.hasAttacked;

  document.getElementById('btn-move').style.display = canMove ? 'block' : 'none';
  document.getElementById('btn-attack').style.display = canAttack ? 'block' : 'none';
  document.getElementById('btn-ability').style.display = canAbility ? 'block' : 'none';
  document.getElementById('btn-motivate').style.display = canMotivate ? 'block' : 'none';
  const endDisplay = isMyTurn ? 'block' : 'none';
  const deployDisplay = (mode === 'deploy') ? 'block' : 'none';
  document.getElementById('btn-end-turn').style.display = endDisplay;
  document.getElementById('btn-deploy-ready').style.display = deployDisplay;
  document.getElementById('btn-end-turn-global').style.display = endDisplay;
  document.getElementById('btn-deploy-ready-global').style.display = deployDisplay;

  // Show/hide stance panel
  const stancePanel = document.getElementById('stance-panel');
  if (stancePanel) {
    stancePanel.style.display = (hasUnit && isMyTurn && !isFleeing && !selectedUnit?.isGeneral && gameState?.phase === 'battle' && selectedUnit?.speedRemaining > 0) ? 'block' : 'none';
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
    ${!unit.isGeneral ? `<div class="stat-row"><span>Posture</span><span>${stanceLabel}</span></div>` : ''}
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
      ${!u.isGeneral ? `<span class="uhp" style="font-size:0.75em;color:#7a5820" title="${u.stance || ''}">[${stanceLabel}]</span>` : ''}
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
  wsSend('end_turn', { roomCode });
  selectedUnit = null;
  movableTiles.clear();
  attackableTiles.clear();
  setMode('select');
  const stancePanel = document.getElementById('stance-panel');
  if (stancePanel) stancePanel.style.display = 'none';
}

function useAbility() {
  if (!selectedUnit || !selectedUnit.isGeneral) return;
  wsSend('use_ability', { roomCode });
}

function deploymentReady() {
  const gen = deployState?.units.find(u => u.isGeneral);
  if (!gen || gen.q === null) {
    notify('Vous devez placer votre Général (★) avant d\'être prêt.');
    return;
  }
  wsSend('deployment_ready', { roomCode });
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

  // Stats — fiche spéciale pour les généraux
  let statsHtml;
  if (unit.isGeneral) {
    const row2 = [
      { label: 'Force',      value: unit.force },
      { label: 'Stratégie',  value: unit.strategy },
      { label: 'Charisme',   value: unit.charisma },
    ];
    const row3 = [
      { label: 'Puissance',    value: unit.power },
      { label: 'Armure',       value: unit.armor },
      { label: 'Intimidation', value: unit.intimidation ?? 0 },
      { label: 'Vitesse',      value: unit.speed },
    ];
    const vit = `<div class="uc-pdf-stat" style="grid-column:1/-1"><div class="uc-pdf-stat-label">Vitalité</div><div class="uc-pdf-stat-value">${unit.vitality}/${unit.maxVitality}</div></div>`;
    const r2 = `<div style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px">${row2.map(s => `<div class="uc-pdf-stat"><div class="uc-pdf-stat-label">${s.label}</div><div class="uc-pdf-stat-value">${s.value}</div></div>`).join('')}</div>`;
    const r3 = row3.map(s => `<div class="uc-pdf-stat"><div class="uc-pdf-stat-label">${s.label}</div><div class="uc-pdf-stat-value">${s.value}</div></div>`).join('');
    statsHtml = vit + r2 + r3;
  } else {
    const stats = [
      { label: 'Vitalité',    value: `${unit.vitality}/${unit.maxVitality}` },
      { label: 'Morale',      value: `${unit.morale ?? '—'}/${unit.maxMorale ?? '—'}` },
      { label: 'Attaque',     value: unit.attack },
      { label: 'Défense',     value: unit.defense },
      { label: 'Puissance',   value: unit.power },
      { label: 'Intimidation',value: unit.intimidation ?? 0 },
      { label: 'Armure',      value: unit.armor },
      { label: 'Vitesse',     value: unit.speed },
    ];
    if (unit.range > 1) stats.push({ label: 'Portée', value: `${unit.range} cases` });
    statsHtml = stats.map(s =>
      `<div class="uc-pdf-stat"><div class="uc-pdf-stat-label">${s.label}</div><div class="uc-pdf-stat-value">${s.value}</div></div>`
    ).join('');
  }

  // Bonus / capacités
  const bonusLines = [];
  if (unit.bonus) bonusLines.push(`<strong>Bonus :</strong> ${unit.bonus}`);
  if (unit.activeAbility) bonusLines.push(`<strong>Capacité active :</strong> ${unit.activeAbility.name} — ${unit.activeAbility.description} (recharge : ${unit.activeAbility.cooldown} tours)`);
  if (unit.passiveAbility) bonusLines.push(`<strong>Passif :</strong> ${unit.passiveAbility.name} — ${unit.passiveAbility.description}`);
  const bonusHtml = bonusLines.length
    ? `<div class="uc-pdf-bonus">${bonusLines.join('<br>')}</div>`
    : `<div class="uc-pdf-bonus" style="color:#888;font-style:italic">Aucun bonus spécial</div>`;

  // Titre
  const titleSub = unit.isGeneral ? `${unit.kingdom || ''}</span>` : (unit.category ? `(${unit.category})</span>` : '</span>');
  const category = `<br><span style="font-size:0.85em">${titleSub}`;
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

function switchSidebarTab(tab) {
  const tabs = ['units', 'history', 'chat'];
  document.querySelectorAll('.sidebar-tab').forEach((el, i) => {
    el.classList.toggle('active', tabs[i] === tab);
  });
  document.getElementById('pane-units').classList.toggle('active', tab === 'units');
  document.getElementById('pane-history').classList.toggle('active', tab === 'history');
  document.getElementById('pane-chat').classList.toggle('active', tab === 'chat');
  if (tab === 'chat') {
    document.getElementById('tab-chat').classList.remove('unread');
    const msgs = document.getElementById('chat-messages');
    msgs.scrollTop = msgs.scrollHeight;
    document.getElementById('chat-input').focus();
  }
  updateActionButtons();
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  wsSend('chat_message', { roomCode, text });
  input.value = '';
}

function appendChatMessage({ authorName, text, isMine, isSystem }) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  if (isSystem) {
    div.className = 'chat-msg system';
    div.textContent = text;
  } else {
    div.className = `chat-msg ${isMine ? 'mine' : 'other'}`;
    div.innerHTML = `<span class="chat-author">${authorName} : </span><span class="chat-text">${text}</span>`;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  // Badge si l'onglet n'est pas actif
  const pane = document.getElementById('pane-chat');
  if (!pane.classList.contains('active')) {
    document.getElementById('tab-chat').classList.add('unread');
  }
}

let combatHistoryEntries = [];
function addCombatHistory(log, round) {
  combatHistoryEntries.push({ log, round });
  const container = document.getElementById('combat-history');
  if (!container) return;
  const entry = document.createElement('div');
  entry.innerHTML = formatHistoryEntry({ log, round });
  container.appendChild(entry.firstElementChild);
  container.scrollTop = container.scrollHeight;
}

let historyCounter = 0;
function formatHistoryEntry({ log, round }) {
  if (!log) return '';
  const id = `h${historyCounter++}`;
  const b = log.breakdown || {};
  const hit = log.hit;
  const defLabels = { none: 'Rien', counter: 'Contre-attaque', absorb: 'Encaisse' };
  const stanceNames2 = { marche:'Marche', combat:'Combat', charge:'Charge', percee:'Percée', def_combat:'Déf. Combat', def_distance:'Déf. Distance' };

  // Header line
  const hitBadge = hit
    ? `<span class="h-badge h-hit">TOUCHÉ</span>`
    : `<span class="h-badge h-miss">RATÉ</span>`;
  const header = `<div class="h-header" onclick="toggleHistory('${id}')">
    <span class="h-arrow" id="arrow-${id}">▶</span>
    <span class="h-title">T${round} — <b>${log.attackerName||'?'}</b> → <b>${log.targetName||'?'}</b></span>
    ${hitBadge}
    ${log.targetKilled ? `<span class="h-badge h-dead">💀</span>` : ''}
    ${log.attackerKilled ? `<span class="h-badge h-dead">💀 (attaquant)</span>` : ''}
  </div>`;

  // Detail table
  const sign = n => n >= 0 ? `+${n}` : `${n}`;
  const row = (label, val, cls='') => {
    // Masquer les lignes dont la valeur est 0 ou +0
    const raw = typeof val === 'number' ? val : (typeof val === 'string' ? parseFloat(val) : NaN);
    if (!isNaN(raw) && raw === 0) return '';
    const signed = typeof val === 'string' && val.startsWith('+') ? parseFloat(val) : NaN;
    if (!isNaN(signed) && signed === 0) return '';
    return `<tr class="${cls}"><td>${label}</td><td>${val}</td></tr>`;
  };
  const signRow = (label, n, cls='') => n === 0 ? '' : row(label, sign(n), cls);

  let table = `<div class="h-detail" id="${id}" style="display:none"><table class="h-table">
    <tbody>
    <tr class="h-section"><td colspan="2">⚔ ATTAQUE</td></tr>
    ${row('Base attaque', b.attackBase ?? '—')}
    ${signRow('Posture atq. ('+(stanceNames2[b.attackerStance]||b.attackerStance||'?')+')', b.stA_attack||0)}
    ${signRow('Terrain atq. ('+(b.attackerTerrain||'?')+')', b.tA_attack||0)}
    ${signRow('− Esquive posture déf.', -(b.stD_esquive||0))}
    ${signRow('− Esquive terrain déf.', -(b.tD_esquive||0))}
    ${row('= Total attaque', `<b>${b.attackTotal??'—'}</b> vs D20: <b>${b.attackD20??'—'}</b>`, hit?'h-hit-row':'h-miss-row')}`;

  if (hit) {
    table += `
    <tr class="h-section"><td colspan="2">💥 DÉGÂTS</td></tr>
    ${row('Dés', `${b.diceCount??'?'} × D${b.dieFaces??'?'}`)}
    ${row('Dégâts infligés', b.dmgInflicted??0)}
    ${(b.armorAbsorb||0) > 0 ? row('Absorption (Vit×Arm)', `${b.armorAbsorb} (armure eff. ${b.effectiveArmor??'?'})`) : ''}
    ${row('Dégâts reçus (÷10)', `<b>${log.dmgReceived??0}</b>`, 'h-hit-row')}
    ${row('Vitalité restante cible', log.targetVitalityLeft??'—')}`;
  }

  if (log.moralDmg > 0 || log.targetMoraleLeft != null) {
    table += `<tr class="h-section"><td colspan="2">😰 MORAL</td></tr>`;
    if (log.moralDmg > 0) table += row('Moral infligé (Vit×Intim.)', log.moralDmg);
    if (log.targetMoraleLeft != null) table += row('Moral restant cible', log.targetMoraleLeft);
  }

  if (log.defenseChoice && log.defenseChoice !== 'none') {
    const ds = log.defenseSuccess;
    table += `<tr class="h-section"><td colspan="2">🛡 DÉFENSE — ${defLabels[log.defenseChoice]||log.defenseChoice}</td></tr>
    ${row('Base défense', b.defBase??'—')}
    ${signRow('Posture déf. ('+(stanceNames2[b.defenderStance]||b.defenderStance||'?')+')', b.stD_defense||0)}
    ${signRow('Terrain déf. ('+(b.defenderTerrain||'?')+')', b.tD_defense||0)}
    ${signRow('− Précision posture atq.', -(b.stA_precision||0))}
    ${signRow('− Précision terrain atq.', -(b.tA_precision||0))}
    ${row('= Total défense', `<b>${b.defTotal??'—'}</b> vs D20: <b>${log.defenseRoll??'—'}</b>`, ds?'h-hit-row':'h-miss-row')}`;
    if (ds && log.counterDmgReceived > 0) {
      table += row('Dégâts contre-attaque', `<b>${log.counterDmgReceived}</b>`, 'h-hit-row');
      table += row('Vitalité restante atq.', log.attackerVitalityLeft??'—');
    }
    if (ds && log.counterMoralDmg > 0) table += row('Moral contre-attaque', log.counterMoralDmg);
  }

  table += `</tbody></table></div>`;

  return `<div class="history-entry">${header}${table}</div>`;
}

function toggleHistory(id) {
  const el = document.getElementById(id);
  const arrow = document.getElementById(`arrow-${id}`);
  if (!el) return;
  const open = el.style.display === 'block';
  el.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▶' : '▼';
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
  if (!unit || unit.isGeneral || gameState?.currentPlayerId !== myId || unit.isFleeing || gameState?.phase !== 'battle') {
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
    btn.onclick = () => { hideStanceTooltip(); changeStance(unit.id, s); };
    btn.addEventListener('mouseenter', e => showStanceTooltip(e, s));
    btn.addEventListener('mousemove', positionStanceTooltip);
    btn.addEventListener('mouseleave', hideStanceTooltip);
    listEl.appendChild(btn);
  }
}

function buildStanceTooltip(stanceId) {
  const s = STANCES_DATA[stanceId];
  if (!s) return '';
  const row = (label, val) => {
    if (val === 0) return '';
    const cls = val > 0 ? 'tt-pos' : 'tt-neg';
    return `<div><span class="${cls}">${val > 0 ? '+' : ''}${val}</span> ${label}</div>`;
  };
  return `<div class="tt-title">${stanceNames[stanceId] || stanceId}</div>`
    + row('Vitesse', s.vitesse)
    + row('Attaque cac', s.attack_cac) + row('Attaque tir', s.attack_tir)
    + row('Défense cac', s.defense_cac) + row('Défense tir', s.defense_tir)
    + row('Puissance cac', s.puissance_cac) + row('Puissance tir', s.puissance_tir)
    + row('Intimidation cac', s.intimidation_cac) + row('Intimidation tir', s.intimidation_tir)
    + row('Esquive cac', s.esquive_cac) + row('Esquive tir', s.esquive_tir)
    + row('Précision cac', s.precision_cac) + row('Précision tir', s.precision_tir)
    + row('Armure', s.armure)
    + (s.moral_tour !== 0 ? row('Moral/tour', s.moral_tour) : '');
}

function showStanceTooltip(e, stanceId) {
  const tt = document.getElementById('stance-tooltip');
  if (!tt) return;
  tt.innerHTML = buildStanceTooltip(stanceId);
  tt.style.display = 'block';
  positionStanceTooltip(e);
}

function positionStanceTooltip(e) {
  const tt = document.getElementById('stance-tooltip');
  if (!tt || tt.style.display === 'none') return;
  const x = e.clientX + 12, y = e.clientY - 8;
  const maxX = window.innerWidth - tt.offsetWidth - 8;
  const maxY = window.innerHeight - tt.offsetHeight - 8;
  tt.style.left = Math.min(x, maxX) + 'px';
  tt.style.top = Math.max(8, Math.min(y, maxY)) + 'px';
}

function hideStanceTooltip() {
  const tt = document.getElementById('stance-tooltip');
  if (tt) tt.style.display = 'none';
}

function changeStance(unitId, stanceId) {
  if (!roomCode) return;
  const overlay = document.getElementById('overlay-stance');
  if (!overlay) { wsSend('change_stance', { roomCode, unitId, stanceId }); return; }
  const unit = selectedUnit || gameState?.units?.find(u => u.id === unitId);
  document.getElementById('stance-unit-name').textContent = unit?.name || '';
  document.getElementById('stance-from').textContent = stanceNames[unit?.stance] || unit?.stance || '?';
  document.getElementById('stance-to').textContent = stanceNames[stanceId] || stanceId;
  overlay.dataset.unitId = unitId;
  overlay.dataset.stanceId = stanceId;
  overlay.style.display = 'flex';
}

function confirmStanceChange() {
  const overlay = document.getElementById('overlay-stance');
  if (!overlay) return;
  const { unitId, stanceId } = overlay.dataset;
  overlay.style.display = 'none';
  wsSend('change_stance', { roomCode, unitId, stanceId });
}

function cancelStanceChange() {
  document.getElementById('overlay-stance').style.display = 'none';
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
  // Ranged attack: only phalange can absorb, nobody can counter
  const btnCounter = document.getElementById('btn-defense-counter');
  const btnAbsorb = document.getElementById('btn-defense-absorb');
  if (data.isRanged) {
    if (btnCounter) btnCounter.style.display = 'none';
    if (btnAbsorb) btnAbsorb.style.display = data.targetTypeId === 'phalange' ? '' : 'none';
  } else {
    if (btnCounter) btnCounter.style.display = '';
    if (btnAbsorb) btnAbsorb.style.display = '';
  }
  // Countdown
  let t = 20;
  const countdown = document.getElementById('defense-countdown');
  if (countdown) countdown.textContent = t;
  clearInterval(window._defenseTimer);
  window._defenseTimer = setInterval(() => {
    t--;
    if (countdown) {
      countdown.textContent = t;
      countdown.style.color = t <= 5 ? '#ff4040' : t <= 10 ? '#ff9040' : '#c8960c';
    }
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
  wsSend('defend_choice', { roomCode: rc, attackId, choice });
}

// ---- WEBSOCKET EVENTS ----

function onWsOpen() {
  const oldPlayerId = sessionStorage.getItem('myId');
  const rc = sessionStorage.getItem('roomCode');

  if (!oldPlayerId || !rc) {
    window.location.href = '/';
    return;
  }

  roomCode = rc;
  wsSend('rejoin_game', { roomCode: rc, oldPlayerId });

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
}

function wsDispatch(event, data) {
  switch (event) {
    case 'deployment_state': {
      myId = data.myId;
      sessionStorage.setItem('myId', myId);
      deployState = data;
      renderDeployUnitList(data.units);
      render();
      break;
    }
    case 'phase_change': {
      if (data.phase === 'battle') {
        deployState = null;
        sessionStorage.removeItem('deploymentState');
        mode = 'select';
        setMode('select');
        document.getElementById('btn-deploy-ready').style.display = 'none';
      }
      break;
    }
    case 'unit_move_anim': {
      const { unitId, fromQ, fromR, path } = data;
      unitAnimations[unitId] = { path, fromQ, fromR, startTime: performance.now() };
      startAnimLoop();
      break;
    }
    case 'game_state': {
      myId = data.myId;
      sessionStorage.setItem('myId', myId);
      gameState = data;
      gameState.visibleHexes = new Set(data.visibleHexes);

      document.getElementById('top-turn').textContent = `Tour ${data.turn}`;
      const currPlayer = data.players.find(p => p.id === data.currentPlayerId);
      document.getElementById('top-current-player').textContent =
        data.currentPlayerId === myId ? '⚔️ Votre tour' : `Tour de : ${currPlayer?.name || '?'}`;
      document.getElementById('top-phase').textContent = data.phase === 'battle' ? 'Bataille' : '';
      document.getElementById('sidebar-title').textContent =
        data.currentPlayerId === myId ? 'Votre tour' : `Tour de ${currPlayer?.name || '?'}`;

      if (selectedUnit) {
        const updated = data.myUnits.find(u => u.id === selectedUnit.id);
        if (updated) {
          selectedUnit = updated;
          showUnitDetail(updated);
          renderStancePanel(updated);
          movableTiles.clear();
          if (data.currentPlayerId === myId && updated.speedRemaining > 0 && !updated.isFleeing) {
            computeMovableTiles(updated);
          }
        } else { selectedUnit = null; movableTiles.clear(); showUnitDetail(null); renderStancePanel(null); }
      }

      renderTurnOrder(data.turnOrder, data.initiativeRolls, data.currentPlayerId);
      renderUnitList();
      updateActionButtons();
      render();
      break;
    }
    case 'turn_change': {
      if (gameState) {
        gameState.currentPlayerId = data.currentPlayerId;
        gameState.turn = data.turn;
      }
      selectedUnit = null;
      movableTiles.clear();
      attackableTiles.clear();
      updateActionButtons();
      if (data.currentPlayerId === myId) notify('C\'est votre tour !', 'success');
      break;
    }
    case 'initiative_rolled':
      showInitiativeModal(data.rolls, data.turnOrder, data.turn);
      break;
    case 'combat_result': {
      const log = data.combatLog || data;
      addCombatLog(log);
      showCombatResult(log);
      addCombatHistory(log, gameState?.round || 1);
      break;
    }
    case 'defense_request': {
      showDefenseRequest(data);
      if (data.targetQ != null && data.targetR != null) {
        const { x, y } = hexToPixel(data.targetQ, data.targetR);
        smoothPanTo(x, y, 700);
      }
      break;
    }
    case 'waiting_defense': {
      const el = document.getElementById('combat-result-box');
      if (el) { el.innerHTML = 'En attente de la réponse du défenseur…'; el.style.display = 'block'; }
      break;
    }
    case 'units_fled': {
      const el = document.getElementById('combat-result-box');
      if (el && data.fled.length > 0) {
        el.innerHTML = data.fled.map(f => `&#127939; ${f.unitName} a fui !`).join('<br>');
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 4000);
      }
      break;
    }
    case 'game_over':
      document.getElementById('gameover-msg').textContent =
        data.winnerName ? `${data.winnerName} remporte la bataille !` : 'Match nul !';
      document.getElementById('overlay-gameover').style.display = 'flex';
      break;
    case 'deployment_ready_update': {
      notify(`${data.readyCount}/${data.total} joueurs prêts…`, 'info');
      const btn = document.getElementById('btn-deploy-ready');
      if (btn.disabled) {
        btn.textContent = `En attente… (${data.readyCount}/${data.total} prêts)`;
      } else {
        btn.textContent = `Prêt ! (${data.readyCount}/${data.total})`;
      }
      break;
    }
    case 'motivate_result':
      if (data.success) {
        notify(`Motivation réussie ! (Charisme ${data.charisma} ≥ D20 ${data.d20}) → ${data.targetName} regagne ${data.moralGain} moral.`, 'success');
      } else {
        notify(`Motivation échouée. (Charisme ${data.charisma} < D20 ${data.d20})`, 'info');
      }
      break;
    case 'chat_message':
      appendChatMessage({ authorName: data.authorName, text: data.text, isMine: data.authorId === myId });
      break;
    case 'error':
      notify(data.message || String(data));
      break;
    case 'player_disconnected':
      notify('Un joueur s\'est déconnecté.', 'info');
      break;
  }
}

// Init
resizeCanvas();
