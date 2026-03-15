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

// Tokens des généraux
const GENERAL_TOKEN_MAP = {
  'ou_ki':       'Ou Ki',
  'ou_sen':      'Ou Sen',
  'kei_sha':     'Kei Sha',
  'shi_ba_shou': 'Shi Ba Shou',
  'ren_pa':      'Ren Pa',
  'go_hou_mei':  'Go Hou Mei',
};
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
    const treeCount = 4 + Math.floor(seededRand(q * 137 + r * 251) * 3);
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

  const hexes = deployState ? deployState.hexMap : (gameState ? null : null);
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
    const { x, y } = hexToPixel(u.q, u.r);
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
  if (!unit.isGeneral || !gameState) return null;
  const player = gameState.players.find(p => p.id === unit.playerId);
  return player?.generalId || null;
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
  const key = `${hex.q},${hex.r}`;
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
  if (!selectedUnit) return;
  const zone = deployState.startingZone;
  let inDeployZone = false;
  const rRiver = Math.round(21 - 0.43 * hex.q);
  if (zone.type === 'river_north') {
    inDeployZone = hex.r >= rRiver - zone.radius && hex.r <= rRiver - 1;
  } else if (zone.type === 'river_south') {
    inDeployZone = hex.r >= rRiver + 1 && hex.r <= rRiver + zone.radius;
  } else {
    inDeployZone = hexDistance(hex.q, hex.r, zone.q, zone.r) <= zone.radius;
  }
  if (!inDeployZone) {
    notify('Hors de la zone de déploiement.');
    return;
  }
  // Check not already occupied
  const occupied = deployState.units.some(u => u.q === hex.q && u.r === hex.r && u.id !== selectedUnit.id);
  if (occupied) { notify('Case occupée.'); return; }

  socket.emit('place_unit', { roomCode, unitId: selectedUnit.id, q: hex.q, r: hex.r });
  // Mise à jour locale immédiate
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

  if (gameState?.currentPlayerId === myId && !unit.hasMoved) {
    computeMovableTiles(unit);
  }
  if (gameState?.currentPlayerId === myId && !unit.hasAttacked) {
    computeAttackableTiles(unit);
  }

  updateActionButtons();
  showUnitDetail(unit);
  render();
}

function computeMovableTiles(unit) {
  // BFS up to speed tiles
  const visited = new Set();
  const queue = [{ q: unit.q, r: unit.r, steps: 0 }];
  const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

  visited.add(`${unit.q},${unit.r}`);
  while (queue.length > 0) {
    const { q, r, steps } = queue.shift();
    if (steps >= unit.speed) continue;
    for (const [dq, dr] of dirs) {
      const nq = q + dq, nr = r + dr;
      const key = `${nq},${nr}`;
      if (visited.has(key)) continue;
      if (gameState && !gameState.visibleHexes.has(key)) continue;
      // Check not occupied by enemy
      const occupant = gameState?.units.find(u => u.q === nq && u.r === nr);
      if (occupant && !occupant.isMine) continue;
      visited.add(key);
      movableTiles.add(key);
      queue.push({ q: nq, r: nr, steps: steps + 1 });
    }
  }
  movableTiles.delete(`${unit.q},${unit.r}`);
}

function computeAttackableTiles(unit) {
  const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
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
  const canMove = hasUnit && isMyTurn && !selectedUnit.hasMoved;
  const canAttack = hasUnit && isMyTurn && !selectedUnit.hasAttacked;
  const isGeneral = hasUnit && selectedUnit.isGeneral;
  const canAbility = isGeneral && isMyTurn && !selectedUnit.hasUsedAbility && selectedUnit.abilityCooldown === 0;

  document.getElementById('btn-move').style.display = canMove ? 'block' : 'none';
  document.getElementById('btn-attack').style.display = canAttack ? 'block' : 'none';
  document.getElementById('btn-ability').style.display = canAbility ? 'block' : 'none';
  document.getElementById('btn-end-turn').style.display = isMyTurn ? 'block' : 'none';
  document.getElementById('btn-deploy-ready').style.display = (mode === 'deploy') ? 'block' : 'none';
}

function showUnitDetail(unit) {
  const panel = document.getElementById('selected-unit-detail');
  if (!unit) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  document.getElementById('detail-name').textContent = unit.name;
  document.getElementById('detail-stats').innerHTML = `
    <div class="stat-row"><span>Vitalité</span><span>${unit.vitality}/${unit.maxVitality}</span></div>
    <div class="stat-row"><span>Attaque</span><span>${unit.attack}</span></div>
    <div class="stat-row"><span>Puissance</span><span>${unit.power}</span></div>
    <div class="stat-row"><span>Défense</span><span>${unit.defense}</span></div>
    <div class="stat-row"><span>Armure</span><span>${unit.armor}</span></div>
    <div class="stat-row"><span>Vitesse</span><span>${unit.speed}</span></div>
    <div class="stat-row"><span>Portée</span><span>${unit.range} case${unit.range > 1 ? 's' : ''}</span></div>
    ${unit.visionRange > 0 ? `<div class="stat-row"><span>Vision</span><span>${unit.visionRange} cases</span></div>` : ''}
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
    div.className = `unit-row${selectedUnit?.id === u.id ? ' selected' : ''}${done ? ' done' : ''}${u.isGeneral ? ' is-general' : ''}`;
    div.innerHTML = `
      <span class="icon">${u.isGeneral ? '★' : '·'}</span>
      <span class="uname">${u.name}</span>
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
    const name = roll?.playerName || id;
    const isCurrent = id === currentPlayerId;
    const hasPlayed = currentIdx >= 0 && i < currentIdx;
    const div = document.createElement('div');
    div.className = `turn-order-item${isCurrent ? ' current' : ''}${hasPlayed ? ' played' : ''}`;
    div.innerHTML = `
      <span class="to-rank">${i + 1}.</span>
      <span class="to-name">${name}${id === myId ? ' (moi)' : ''}</span>
      ${roll ? `<span style="color:#7a5820;font-size:0.85em">${roll.total}</span>` : ''}
    `;
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
    text += log.hit ? `${log.damage} dégâts` : 'Manqué';
    if (log.targetKilled) text += ` (${log.targetName} éliminé!)`;
    if (log.generalKilled) text += ` ⚠️ GÉNÉRAL TUÉ!`;
  }
  entry.textContent = text;
  container.insertBefore(entry, container.firstChild);
  if (container.children.length > 20) container.lastChild.remove();
}

function showUnitCard(unit) {
  const overlay = document.getElementById('overlay-unit-card');
  const content = document.getElementById('unit-card-content');

  // Token image
  let tokenHtml = '';
  if (unit.isGeneral) {
    const gid = unit.generalId || (gameState?.players.find(p => p.id === unit.playerId)?.generalId);
    const name = GENERAL_TOKEN_MAP[gid];
    if (name) {
      tokenHtml = `<img class="unit-card-token" src="/assets/GENERAL TOKEN/${encodeURIComponent(name)}.png" alt="${unit.name}">`;
    } else {
      tokenHtml = `<div class="unit-card-token-placeholder">★</div>`;
    }
  } else {
    const name = UNIT_TOKEN_MAP[unit.typeId];
    if (name) {
      tokenHtml = `<img class="unit-card-token" src="/assets/UNIT TOKEN/${encodeURIComponent(name)}.png" alt="${unit.name}">`;
    } else {
      tokenHtml = `<div class="unit-card-token-placeholder">${unit.name.charAt(0)}</div>`;
    }
  }

  const hpBar = `<div style="height:5px;background:#1a0a04;border-radius:3px;margin-top:4px">
    <div style="height:100%;width:${Math.round(unit.vitality/unit.maxVitality*100)}%;background:${unit.vitality/unit.maxVitality>0.5?'#2a8c2a':unit.vitality/unit.maxVitality>0.25?'#c8960c':'#a02020'};border-radius:3px"></div>
  </div>`;

  let statsHtml = `<div class="unit-card-stats">
    <div class="uc-stat"><span>Vitalité</span><span>${unit.vitality}/${unit.maxVitality}</span></div>
    <div class="uc-stat"><span>Moral</span><span>${unit.morale ?? '—'}/${unit.maxMorale ?? '—'}</span></div>
    <div class="uc-stat"><span>Attaque</span><span>${unit.attack}</span></div>
    <div class="uc-stat"><span>Puissance</span><span>${unit.power}</span></div>
    <div class="uc-stat"><span>Défense</span><span>${unit.defense}</span></div>
    <div class="uc-stat"><span>Armure</span><span>${unit.armor}</span></div>
    <div class="uc-stat"><span>Vitesse</span><span>${unit.speed}</span></div>
    <div class="uc-stat"><span>Portée</span><span>${unit.range} case${unit.range > 1 ? 's' : ''}</span></div>
    ${unit.visionRange > 0 ? `<div class="uc-stat"><span>Vision</span><span>${unit.visionRange} cases</span></div>` : ''}
    ${unit.intimidation ? `<div class="uc-stat"><span>Intimidation</span><span>${unit.intimidation}</span></div>` : ''}
  </div>`;

  let abilitiesHtml = '';
  if (unit.activeAbility) {
    abilitiesHtml += `<div class="unit-card-ability">
      <div class="ab-name">⚡ ${unit.activeAbility.name}</div>
      <div class="ab-desc">${unit.activeAbility.description}</div>
      <div class="ab-cooldown">Recharge : ${unit.activeAbility.cooldown} tours</div>
    </div>`;
  }
  if (unit.passiveAbility) {
    abilitiesHtml += `<div class="unit-card-ability">
      <div class="ab-name">🔹 ${unit.passiveAbility.name}</div>
      <div class="ab-desc">${unit.passiveAbility.description}</div>
    </div>`;
  }
  if (unit.bonus) {
    abilitiesHtml += `<div class="unit-card-ability">
      <div class="ab-name">✦ Capacité spéciale</div>
      <div class="ab-desc">${unit.bonus}</div>
    </div>`;
  }

  const citationHtml = unit.citation
    ? `<div class="unit-card-citation">${unit.citation}</div>` : '';

  const kingdom = unit.kingdom ? `<span style="color:#c8960c;font-size:0.8em;margin-left:6px">[${unit.kingdom}]</span>` : '';
  const weapon = unit.weapon ? `<div style="font-size:0.78em;color:#7a5820;margin-top:1px">Arme : ${unit.weapon}</div>` : '';

  content.innerHTML = `
    <div class="unit-card-header">
      ${tokenHtml}
      <div class="unit-card-title">
        <h3>${unit.name}${kingdom}</h3>
        <div class="uc-category">${unit.category || ''}</div>
        ${weapon}
        ${hpBar}
      </div>
    </div>
    ${statsHtml}
    ${abilitiesHtml}
    ${citationHtml}
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
    if (updated) { selectedUnit = updated; showUnitDetail(updated); }
    else { selectedUnit = null; showUnitDetail(null); }
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

socket.on('combat_result', (log) => {
  addCombatLog(log);
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

socket.on('player_disconnected', ({ playerId }) => {
  notify('Un joueur s\'est déconnecté.', 'info');
});

// Init
resizeCanvas();
