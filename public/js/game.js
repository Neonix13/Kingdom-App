// Kingdom Battleground — Game Client

// Réseau : session + reconnexion gérées par KBNet (public/js/net.js)
function wsSend(action, data) {
  KBNet.send(action, data);
}

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// Carte de la salle (registre /api/maps/<mapId>) : cases = clés de height, terrain plaine par défaut
const mapImage = new Image();
let mapId = null;
let mapDoc = null;
let mapBg = null;
let mapHexes = [];
let mapHeight = {};
let mapLoading = null;

// Chargement des terrains
let terrainData = {};
let showTerrain = false;
let showCoords = false;
let pingMode = false;
const activePings = []; // { q, r, color, startTime }
let gridOpacity = 0.25;
let gridThickness = 1;
let gridColorRGB = '180,140,60';

// Chargement des segments
let segmentData = {};
let UNIT_TYPES = {};

// Map changes made during the battle (espions, bâtisseurs): game_state.mapEdits over the map document
function applyMapEdits() {
  if (!mapDoc) return;
  const ed = gameState && gameState.mapEdits;
  segmentData = { ...(mapDoc.segments || {}) };
  terrainData = Object.fromEntries(Object.entries(mapDoc.terrain || {}).filter(([, t]) => t && t !== 'plain'));
  if (ed) {
    for (const [k, t] of Object.entries(ed.seg || {})) { if (t) segmentData[k] = t; else delete segmentData[k]; }
    for (const [k, t] of Object.entries(ed.ter || {})) { if (!t || t === 'plain') delete terrainData[k]; else terrainData[k] = t; }
  }
  if (window.view3d && window.view3d.onMapEdits) window.view3d.onMapEdits(ed || null);
}

async function fetchMapDoc(id) {
  try {
    const res = await fetch(`/api/maps/${encodeURIComponent(id)}`);
    if (res.ok) return await res.json();
  } catch (e) { /* hors serveur local : repli ci-dessous */ }
  if (id !== 'default') throw new Error('Carte introuvable : ' + id);
  const [terrain, segments, height] = await Promise.all(['terrain', 'segments', 'height'].map(n => fetch(`/data/${n}.json`).then(r => r.json())));
  return { id: 'default', terrain, segments, height, background: { image: '/assets/img/map.webp', hexSize: 101.5, origX: 137, origY: 190, width: 8800, height: 7200 } };
}

function ensureMap(id) {
  id = id || 'default';
  if (mapId === id && mapLoading) return mapLoading;
  mapId = id;
  window.KB_MAP_ID = id;
  mapLoading = fetchMapDoc(id).then((doc) => {
    if (mapId !== id) return;
    mapDoc = doc;
    mapHeight = doc.height || {};
    applyMapEdits();
    mapHexes = Object.keys(mapHeight).map(k => { const [q, r] = k.split(',').map(Number); return { q, r, key: k }; });
    mapBg = doc.background && doc.background.image ? doc.background : null;
    if (mapBg) { mapImage.onload = () => render(); mapImage.src = mapBg.image; }
    if (!cameraPlaced && mapHexes.length) {
      let sx = 0, sy = 0;
      for (const h of mapHexes) { const p = hexToPixel(h.q, h.r); sx += p.x; sy += p.y; }
      camX = -(sx / mapHexes.length) * zoom;
      camY = -(sy / mapHexes.length) * zoom;
    }
    if (selectedUnit) selectUnit(selectedUnit);
    render();
  }).catch((e) => { notify(e.message || 'Carte introuvable.'); });
  return mapLoading;
}

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
  escalier:         '#c8b898',
};

// Propriétés locales pour les vérifications de mouvement côté client
const SEGMENT_DEFS_CLIENT = {
  river:            { name:'Rivière',         vitesse:-1,  vitesse_fixe:null, infranchissable:false, infranchissable_cavalerie:false, attack_cac:-2, attack_tir:0, defense_cac:0, defense_tir:0, puissance_cac:0, puissance_tir:0, special:null },
  cliff:            { name:'Falaise',         vitesse:0,   vitesse_fixe:3,    infranchissable:false, infranchissable_cavalerie:true,  attack_cac:-5, attack_tir:0, defense_cac:0, defense_tir:0, puissance_cac:0, puissance_tir:0, special:'Infranchissable (sauf par une échelle)' },
  bridge:           { name:'Pont',            vitesse:0,   vitesse_fixe:null, infranchissable:false, infranchissable_cavalerie:false, attack_cac:0,  attack_tir:0, defense_cac:2, defense_tir:2, puissance_cac:0, puissance_tir:0, special:null },
  passerelle:       { name:'Passerelle',      vitesse:0,   vitesse_fixe:null, infranchissable:false, infranchissable_cavalerie:false, attack_cac:0,  attack_tir:0, defense_cac:-1, defense_tir:-1, puissance_cac:0, puissance_tir:0, special:'Effondrement 1/4' },
  barriere:         { name:'Barrière',        vitesse:-1,  vitesse_fixe:null, infranchissable:false, infranchissable_cavalerie:false, attack_cac:0,  attack_tir:0, defense_cac:2, defense_tir:2, puissance_cac:0, puissance_tir:0, special:null },
  chevaux_de_frise: { name:'Chevaux de frise',vitesse:0,   vitesse_fixe:null, infranchissable:false, infranchissable_cavalerie:false, attack_cac:0,  attack_tir:0, defense_cac:4, defense_tir:4, puissance_cac:0, puissance_tir:0, special:'+5 puissance vs cavalerie' },
  mur:              { name:'Mur',             vitesse:0,   vitesse_fixe:null, infranchissable:true,  infranchissable_cavalerie:false, attack_cac:0,  attack_tir:0, defense_cac:0, defense_tir:0, puissance_cac:0, puissance_tir:0, special:null },
  echelle:          { name:'Échelle',         vitesse:-2,  vitesse_fixe:null, infranchissable:false, infranchissable_cavalerie:true,  attack_cac:-6, attack_tir:0, defense_cac:0, defense_tir:0, puissance_cac:0, puissance_tir:0, special:'Infanterie et généraux seulement, coût 3' },
  escalier:         { name:'Escalier',        vitesse:-1,  vitesse_fixe:2   , infranchissable:false, infranchissable_cavalerie:true,  attack_cac:-6, attack_tir:0, defense_cac:0, defense_tir:0, puissance_cac:0, puissance_tir:0, special:'Infanterie et généraux seulement, coût 3' },
};

// Movement: same rules and table as the server (public/js/rules.js, table sent in game_state.movementRules)
function movementTable() {
  return gameState?.movementRules || KBRules.movementTable(SEGMENT_DEFS_CLIENT);
}

function clientReachable(unit) {
  const maxSpeed = unit.speedRemaining != null ? unit.speedRemaining : unit.speed;
  const occupied = new Set((gameState?.units || []).map(u => `${u.q},${u.r}`));
  const ab = KBRules.ability(unit, UNIT_TYPES);
  const drive = !!ab && ab.type === 'trample';
  return KBRules.reachable(movementTable(), {
    transit: drive ? (k) => occupied.has(k) && !!gameState && gameState.visibleHexes.has(k) : null,
    start: { q: unit.q, r: unit.r },
    maxCost: maxSpeed,
    minStep: KBRules.hasFullSpeed(unit),
    mounted: KBRules.isMounted(unit),
    hexAt: (k) => (k in mapHeight ? { terrain: terrainData[k] || 'plain', height: mapHeight[k] || 0 } : null),
    blocked: (k) => occupied.has(k) || (!!gameState && !gameState.visibleHexes.has(k)),
    segAt: (a, b, c, d) => segmentData[segmentEdgeKey(a, b, c, d)] || null,
  });
}

function fmtSpeed(v) {
  if (v == null) return '—';
  return Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString().replace('.', ',');
}

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
const stanceList = ['marche','combat','charge','repos','defense_combat','defense_distance'];
const stanceIconFiles = { marche:'marche', combat:'combat', charge:'charge', repos:'repos', defense_combat:'def_charge', defense_distance:'def_eparse' };
const stanceNames = { marche:'Marche', combat:'Combat', charge:'Charge', repos:'Repos', defense_combat:'Déf. combat', defense_distance:'Déf. distance' };
const TERRAINS_DATA = {
  plain:    { name:'Plaines', vitesse:0, attack_cac:0, attack_tir:0, defense_cac:0, defense_tir:0, puissance_cac:0, puissance_tir:0, intimidation_cac:0, intimidation_tir:0, courage_cac:0, courage_tir:0, esquive_cac:0, esquive_tir:0, precision_cac:0, precision_tir:0, armure:0, armure_tour:0, moral_tour:0, vitalite_tour:0 },
  forest:   { name:'Forêts', vitesse:-1, attack_cac:0, attack_tir:-1, defense_cac:2, defense_tir:2, puissance_cac:0, puissance_tir:-1, intimidation_cac:2, intimidation_tir:2, courage_cac:-1, courage_tir:-2, esquive_cac:1, esquive_tir:2, precision_cac:-1, precision_tir:-1, armure:1, armure_tour:0, moral_tour:0, vitalite_tour:0 },
  river:    { name:'Fleuves', vitesse:-1, attack_cac:-3, attack_tir:-2, defense_cac:-3, defense_tir:-3, puissance_cac:-2, puissance_tir:-2, intimidation_cac:-2, intimidation_tir:-2, courage_cac:-2, courage_tir:-2, esquive_cac:-2, esquive_tir:-2, precision_cac:-2, precision_tir:-1, armure:-1, armure_tour:0, moral_tour:0, vitalite_tour:0 },
  road:     { name:'Routes', vitesse:1, attack_cac:1, attack_tir:1, defense_cac:0, defense_tir:0, puissance_cac:1, puissance_tir:0, intimidation_cac:1, intimidation_tir:0, courage_cac:1, courage_tir:1, esquive_cac:-1, esquive_tir:-1, precision_cac:1, precision_tir:1, armure:0, armure_tour:0, moral_tour:0, vitalite_tour:0 },
  building: { name:'Bâtiments', vitesse:-1, attack_cac:-1, attack_tir:-3, defense_cac:2, defense_tir:2, puissance_cac:0, puissance_tir:-1, intimidation_cac:1, intimidation_tir:2, courage_cac:1, courage_tir:1, esquive_cac:2, esquive_tir:4, precision_cac:-1, precision_tir:-1, armure:2, armure_tour:0, moral_tour:10, vitalite_tour:5 },
  bridge:   { name:'Ponts', vitesse:0, attack_cac:0, attack_tir:1, defense_cac:1, defense_tir:1, puissance_cac:0, puissance_tir:0, intimidation_cac:1, intimidation_tir:0, courage_cac:0, courage_tir:-1, esquive_cac:1, esquive_tir:-1, precision_cac:0, precision_tir:1, armure:0, armure_tour:0, moral_tour:0, vitalite_tour:0 },
};
const STANCES_DATA = {
  marche:           { vitesse:1, attack_cac:-1, attack_tir:-2, defense_cac:-2, defense_tir:-1, puissance_cac:0, puissance_tir:-1, intimidation_cac:1, intimidation_tir:0, courage_cac:-1, courage_tir:-1, esquive_cac:0, esquive_tir:2, precision_cac:0, precision_tir:-2, armure:-1, armure_tour:0, moral_tour:0, vitalite_tour:0 },
  combat:           { vitesse:0, attack_cac:0, attack_tir:0, defense_cac:0, defense_tir:0, puissance_cac:0, puissance_tir:0, intimidation_cac:0, intimidation_tir:0, courage_cac:0, courage_tir:0, esquive_cac:0, esquive_tir:0, precision_cac:0, precision_tir:0, armure:0, armure_tour:0, moral_tour:0, vitalite_tour:0 },
  charge:           { vitesse:2, attack_cac:3, attack_tir:-2, defense_cac:-1, defense_tir:-2, puissance_cac:1, puissance_tir:-1, intimidation_cac:2, intimidation_tir:-1, courage_cac:1, courage_tir:1, esquive_cac:1, esquive_tir:3, precision_cac:2, precision_tir:-2, armure:0, armure_tour:0, moral_tour:-10, vitalite_tour:0 },
  repos:            { vitesse:-1, attack_cac:-2, attack_tir:-2, defense_cac:-2, defense_tir:-2, puissance_cac:-2, puissance_tir:-1, intimidation_cac:-2, intimidation_tir:-1, courage_cac:-1, courage_tir:-1, esquive_cac:0, esquive_tir:-2, precision_cac:-1, precision_tir:-1, armure:0, armure_tour:1, moral_tour:10, vitalite_tour:5 },
  defense_combat:   { vitesse:-1, attack_cac:-2, attack_tir:-1, defense_cac:3, defense_tir:-2, puissance_cac:-1, puissance_tir:0, intimidation_cac:0, intimidation_tir:1, courage_cac:1, courage_tir:-1, esquive_cac:1, esquive_tir:-1, precision_cac:0, precision_tir:-2, armure:1, armure_tour:0, moral_tour:0, vitalite_tour:0 },
  defense_distance: { vitesse:0, attack_cac:-3, attack_tir:0, defense_cac:-2, defense_tir:0, puissance_cac:-2, puissance_tir:0, intimidation_cac:-2, intimidation_tir:-1, courage_cac:-1, courage_tir:1, esquive_cac:2, esquive_tir:4, precision_cac:-2, precision_tir:-1, armure:0, armure_tour:0, moral_tour:0, vitalite_tour:0 },
};

// Balance data (data/balance/*.json): /api/balance on the local server, else the tables frozen for the battle
// (game_state.balanceTables, sent at battle start and on resync). The hardcoded copies above are the fallback.
function applyBalanceTables(t) {
  if (!t) return;
  if (t.units) UNIT_TYPES = t.units;
  for (const [k, v] of Object.entries(t.terrains || {})) TERRAINS_DATA[k] = { ...(TERRAINS_DATA[k] || {}), ...v };
  for (const [k, v] of Object.entries(t.segments || {})) {
    const special = SEGMENT_DEFS_CLIENT[k]?.special;
    SEGMENT_DEFS_CLIENT[k] = { ...(SEGMENT_DEFS_CLIENT[k] || {}), ...v, special: special !== undefined ? special : v.special };
  }
  for (const [k, v] of Object.entries(t.stances || {})) {
    STANCES_DATA[k] = { ...(STANCES_DATA[k] || {}), ...v };
    if (v.name && !stanceNames[k]) stanceNames[k] = v.name;
  }
  if (selectedUnit) showUnitDetail(selectedUnit);
}

fetch('/api/balance').then(r => (r.ok ? r.json() : null)).then((d) => { if (d && d.tables && d.tables.units) UNIT_TYPES = d.tables.units; if (d && d.tables && !gameState?.balanceTables) applyBalanceTables(d.tables); }).catch(() => {});
for (const s of stanceList) {
  if (!stanceIconFiles[s]) continue;
  const img = new Image();
  img.src = `/assets/icons/${stanceIconFiles[s]}.svg`;
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
  return `/assets/unites/${folder}/${encodeURIComponent(entry.file)}.${entry.ext}`;
}

const generalTokenImages = {};
for (const [id, name] of Object.entries(GENERAL_TOKEN_MAP)) {
  const img = new Image();
  img.src = `/assets/unites/GENERAL TOKEN/${encodeURIComponent(name)}.png`;
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
  img.src = `/assets/unites/UNIT TOKEN/${encodeURIComponent(name)}.png`;
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

const TERRAIN_BASE_COLORS = {
  plain:    '#7d7a45',
  forest:   '#3f5a26',
  river:    '#3a6a9a',
  road:     '#a08a5a',
  building: '#6e5a44',
  bridge:   '#8a6a3a',
};

const TERRAIN_COLORS = {
  forest:   'rgba(30,100,20,0.7)',
  river:    'rgba(40,120,220,0.7)',
  building: 'rgba(140,100,60,0.8)',
  road:     'rgba(200,170,100,0.6)',
  bridge:   'rgba(220,140,30,0.8)',
};

// State
const initialSession = KBNet.getSession();
let myId = initialSession ? initialSession.playerId : null;
let roomCode = initialSession ? initialSession.roomCode : null;
let isSpectator = !!(initialSession && initialSession.role === 'spectator');
let gameState = null;
let deployState = null;
let cameraPlaced = false;

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
function buildZoneTileSet(state) {
  if (state?.startingZone?.tiles && !(state.startingZone.tileSet instanceof Set)) {
    state.startingZone.tileSet = new Set(state.startingZone.tiles.map(t => `${t.q},${t.r}`));
  }
}

let mode = 'select'; // select | move | attack | deploy
let selectedUnit = null;
let hoveredHex = null;
let movableTiles = new Set();
let abilityTiles = new Map();   // hex key -> unit ability options (espion, bâtisseurs) in mode 'ability'
let attackableTiles = new Set();
let showWeakness = false; // friend's weak-sides overlay (2D)
let approachAttacks = new Map(); // enemy hex -> { targetId, q, r, path }: out of range, reachable by moving first (one action)
let rangeTiles = new Set();
let rangeCenter = null;
let motivateTiles = new Set();
let motivateCenter = null;
let deployTiles = new Set();

// Camera — recentrée sur la carte une fois chargée
let zoom = 0.3;
let camX = 0;
let camY = 0;

function smoothPanTo(worldX, worldY, durationMs = 600) {
  if (window.view3d && window.view3d.active) { const h = pixelToHex(worldX, worldY); window.view3d.focusHex(h.q, h.r); return; }
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
if (window.ResizeObserver) {
  let lastW = 0, lastH = 0;
  new ResizeObserver(() => {
    const area = document.getElementById('canvas-area');
    if (area.clientWidth === lastW && area.clientHeight === lastH) return;
    lastW = area.clientWidth; lastH = area.clientHeight;
    resizeCanvas();
  }).observe(document.getElementById('canvas-area'));
}

// ---- RENDER ----
function render() {
  if (window.view3d && window.view3d.active) { window.view3d.markDirty(); return; }
  if (!canvas.width) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2 + camX, canvas.height / 2 + camY);
  ctx.scale(zoom, zoom);

  // Dessin de la carte en arrière-plan (calibration propre à la carte) ou cases colorées par terrain
  if (mapBg && mapImage.complete && mapImage.naturalWidth) {
    const scale = HEX_SIZE / mapBg.hexSize;
    ctx.drawImage(mapImage, -mapBg.origX * scale, -mapBg.origY * scale, mapBg.width * scale, mapBg.height * scale);
  } else if (mapDoc && !mapBg) {
    for (const h of mapHexes) {
      const { x, y } = hexToPixel(h.q, h.r);
      drawHex(ctx, x, y, TERRAIN_BASE_COLORS[terrainData[h.key] || 'plain'] || TERRAIN_BASE_COLORS.plain, 'rgba(0,0,0,0.25)', 1, 1);
      const hh = mapDoc.height[h.key] || 0;
      if (hh > 3) drawHex(ctx, x, y, `rgba(205,192,168,${Math.min(0.5, (hh - 3) * 0.07)})`, 'rgba(0,0,0,0)', 1, 1);
    }
  }
  if (mapDoc && window.KBMapProps) KBMapProps.drawDecor2D(ctx, mapDoc.decor, hexToPixel, HEX_SIZE);

  const visibleSet = new Set(gameState?.visibleHexes || []);
  const startZone = deployState?.startingZone;

  if (gameState && gameState.phase === 'battle') {
    for (const { q, r, key } of mapHexes) {
      const { x, y } = hexToPixel(q, r);
      const isVisible = visibleSet.has(key);
      const isHovered = hoveredHex && hoveredHex.q === q && hoveredHex.r === r;
      let fill = isVisible ? 'rgba(0,0,0,0)' : 'rgba(14,12,10,0.74)';
      let stroke = isVisible ? `rgba(${gridColorRGB},${gridOpacity})` : 'rgba(0,0,0,0)';
      if (isVisible && movableTiles.has(key)) fill = 'rgba(255,255,255,0.22)';
      if (abilityTiles.has(key)) fill = 'rgba(47,95,168,0.45)';
      if (isVisible && attackableTiles.has(key)) fill = approachAttacks.has(key) ? 'rgba(216,53,42,0.24)' : 'rgba(216,53,42,0.45)';
      if (isHovered && isVisible) stroke = '#D8352A';
      drawHex(ctx, x, y, fill, stroke, 1, gridThickness);
    }
  } else {
    const zoneKeys = new Set();
    for (const { q, r } of mapHexes) {
      const { x, y } = hexToPixel(q, r);
      const inZone = startZone?.tileSet ? startZone.tileSet.has(`${q},${r}`) : (startZone ? hexDistance(q, r, startZone.q, startZone.r) <= (startZone.radius || 4) : false);
      if (inZone) zoneKeys.add(`${q},${r}`);
      const isHovered = hoveredHex && hoveredHex.q === q && hoveredHex.r === r;
      let fill = inZone ? 'rgba(255,255,255,0.3)' : 'rgba(14,12,10,0.4)';
      let stroke = inZone ? `rgba(0,0,0,${Math.min(1, 0.25 + gridOpacity * 2)})` : `rgba(${gridColorRGB},${gridOpacity * 0.6})`;
      if (inZone && isHovered) fill = 'rgba(255,255,255,0.55)';
      if (isHovered && !inZone) stroke = 'rgba(216,53,42,0.5)';
      drawHex(ctx, x, y, fill, stroke, 1, gridThickness);
    }
    if (zoneKeys.size) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const key of zoneKeys) {
        const [q, r] = key.split(',').map(Number);
        const { x, y } = hexToPixel(q, r);
        const corners = hexCorners(x, y);
        for (let i = 0; i < 6; i++) {
          const [dq, dr] = SEGMENT_EDGE_DIRS[i];
          if (!zoneKeys.has(`${q + dq},${r + dr}`)) {
            ctx.moveTo(corners[i].x, corners[i].y);
            ctx.lineTo(corners[(i + 1) % 6].x, corners[(i + 1) % 6].y);
          }
        }
      }
      ctx.strokeStyle = '#000'; ctx.lineWidth = 6 / zoom; ctx.stroke();
      ctx.strokeStyle = '#D8352A'; ctx.lineWidth = 3 / zoom; ctx.stroke();
      ctx.restore();
    }
  }

  if (rangeTiles.size > 0 && rangeCenter) {
    const dirs = SEGMENT_EDGE_DIRS;
    const interior = new Set(rangeTiles);
    interior.add(`${rangeCenter.q},${rangeCenter.r}`);
    ctx.save();
    const outlineColor = '#ffffff';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const key of rangeTiles) {
      const [q, r] = key.split(',').map(Number);
      const { x, y } = hexToPixel(q, r);
      const corners = hexCorners(x, y);
      for (let i = 0; i < 6; i++) {
        const [dq, dr] = dirs[i];
        if (!interior.has(`${q + dq},${r + dr}`)) {
          ctx.moveTo(corners[i].x, corners[i].y);
          ctx.lineTo(corners[(i + 1) % 6].x, corners[(i + 1) % 6].y);
        }
      }
    }
    ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(6, 5 / zoom); ctx.stroke();
    ctx.strokeStyle = outlineColor; ctx.lineWidth = Math.max(3, 2.5 / zoom); ctx.stroke();
    ctx.restore();
  }

  if (motivateTiles.size > 0 && motivateCenter) {
    const dirs = SEGMENT_EDGE_DIRS;
    const interior = new Set(motivateTiles);
    interior.add(`${motivateCenter.q},${motivateCenter.r}`);
    ctx.save();
    const outlineColor = '#6f9bf0';
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const key of motivateTiles) {
      const [q, r] = key.split(',').map(Number);
      const { x, y } = hexToPixel(q, r);
      const corners = hexCorners(x, y);
      for (let i = 0; i < 6; i++) {
        const [dq, dr] = dirs[i];
        if (!interior.has(`${q + dq},${r + dr}`)) {
          ctx.moveTo(corners[i].x, corners[i].y);
          ctx.lineTo(corners[(i + 1) % 6].x, corners[(i + 1) % 6].y);
        }
      }
    }
    ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(6, 5 / zoom); ctx.stroke();
    ctx.strokeStyle = outlineColor; ctx.lineWidth = Math.max(3, 2.5 / zoom); ctx.stroke();
    ctx.restore();
  }

  // Weak sides (friend's tool): each unit's open edges coloured by the angle-of-attack bonus an enemy would get there
  // (green: front, orange: flank, red: back — RULES.combat.angleMods of its stance), edges shared with a friend excluded
  if (showWeakness) {
    const DIRS6 = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    const all = gameState?.units || [];
    const angleMods = KBRules.RULES.combat.angleMods;
    const sideOf = (u) => (u.isMine || u.isAlly ? 'friend' : u.playerId);
    const posBySide = {};
    for (const u of all) { if (u.q === null) continue; (posBySide[sideOf(u)] = posBySide[sideOf(u)] || new Set()).add(`${u.q},${u.r}`); }
    for (const u of all) {
      if (u.q === null || u.facing == null || u.isGeneral) continue;
      const table = angleMods[u.stance] || angleMods.combat;
      const mine = posBySide[sideOf(u)];
      const colors = new Array(6).fill(null);
      for (let dirIdx = 0; dirIdx < 6; dirIdx++) {
        if (mine.has(`${u.q + DIRS6[dirIdx][0]},${u.r + DIRS6[dirIdx][1]}`)) continue;
        const mod = table[(dirIdx - u.facing + 6) % 6] || 0;
        colors[(6 - dirIdx) % 6] = mod >= 4 ? 'rgba(216,53,42,0.9)' : mod >= 2 ? 'rgba(232,150,40,0.9)' : 'rgba(60,170,80,0.85)';
      }
      const pos = getAnimatedPos(u) || hexToPixel(u.q, u.r);
      drawHexWeakness(ctx, pos.x, pos.y, colors);
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
      drawHex(ctx, x, y, 'transparent', 'rgba(216,53,42,0.4)', 0.5);
    }

    drawUnit(ctx, x, y, u, u.playerId, isSelected);
  }

  // Arbres par dessus les unités
  drawForestTrees(ctx);

  if (gameState) drawObjectives(ctx);
  if (window.KBSim) KBSim.draw(ctx);
  drawApproachPreview(ctx);

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

  // Pings
  drawPings(ctx);

  // Coordonnées Q,R sur chaque case
  if (showCoords) {
    ctx.save();
    ctx.font = `bold ${Math.round(HEX_SIZE * 0.22)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const state = gameState || (deployState ? { phase: 'deployment' } : null);
    if (state) {
      const S = Math.sqrt(3);
      const qMin = Math.floor((-canvas.width / 2 - camX) / zoom / (HEX_SIZE * 1.5)) - 1;
      const qMax = Math.ceil((canvas.width / 2 - camX) / zoom / (HEX_SIZE * 1.5)) + 1;
      for (let q = qMin; q <= qMax; q++) {
        const rMin2 = Math.floor(((-canvas.height / 2 - camY) / zoom - HEX_SIZE * S / 2 * q) / (HEX_SIZE * S)) - 1;
        const rMax2 = Math.ceil(((canvas.height / 2 - camY) / zoom - HEX_SIZE * S / 2 * q) / (HEX_SIZE * S)) + 1;
        for (let r = rMin2; r <= rMax2; r++) {
          const { x, y } = hexToPixel(q, r);
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillText(`${q},${r}`, x + 0.5, y + 0.5);
          ctx.fillStyle = 'rgba(255,220,100,0.9)';
          ctx.fillText(`${q},${r}`, x, y);
        }
      }
    }
    ctx.restore();
  }

  ctx.restore();

  if (gameState?.isNight && gameState.phase === 'battle') {
    ctx.fillStyle = 'rgba(8,16,48,0.32)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawObjectives(ctx) {
  for (const o of gameState.objectives || []) {
    const { x, y } = hexToPixel(o.q, o.r);
    const color = o.owner ? getPlayerColor(o.owner) : '#d8c9a0';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = HEX_SIZE * 0.08;
    ctx.setLineDash([HEX_SIZE * 0.15, HEX_SIZE * 0.1]);
    ctx.beginPath();
    ctx.arc(x, y, HEX_SIZE * 0.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#3b2a1a';
    ctx.fillRect(x + HEX_SIZE * 0.45, y - HEX_SIZE * 0.75, HEX_SIZE * 0.05, HEX_SIZE * 0.7);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + HEX_SIZE * 0.5, y - HEX_SIZE * 0.75);
    ctx.lineTo(x + HEX_SIZE * 0.85, y - HEX_SIZE * 0.62);
    ctx.lineTo(x + HEX_SIZE * 0.5, y - HEX_SIZE * 0.5);
    ctx.fill();
    ctx.font = `900 ${Math.round(HEX_SIZE * 0.24)}px 'Zen Kaku Gothic New', sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = HEX_SIZE * 0.08;
    ctx.strokeText(`${o.name} (${o.points})`, x, y + HEX_SIZE * 0.95);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${o.name} (${o.points})`, x, y + HEX_SIZE * 0.95);
    ctx.restore();
  }
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

function drawTokenImage(ctx, img, x, y, radius, tintColor, tintOpacity = 0.25, overlayColor = null, rotAngle = 0) {
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
  o.save();
  o.translate(radius * RES, radius * RES);
  o.rotate(rotAngle);
  o.drawImage(img, -radius * RES, -radius * RES, size, size);
  o.restore();
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

function getAnimatedFacing(unit) {
  const a = unitAnimations[unit.id];
  if (!a) return unit.facing ?? 5;
  const elapsed = performance.now() - a.startTime;
  const step = Math.floor(elapsed / ANIM_STEP_MS);
  if (step >= a.path.length) return unit.facing ?? 5;
  const prevQ = step === 0 ? a.fromQ : a.path[step - 1][0];
  const prevR = step === 0 ? a.fromR : a.path[step - 1][1];
  return hexFacingClient(prevQ, prevR, a.path[step][0], a.path[step][1]);
}

function drawUnit(ctx, x, y, unit, playerId, isSelected = false) {
  const color = getPlayerColor(playerId);
  const size = HEX_SIZE * 0.55;
  const rotAngle = FACING_ANGLES[getAnimatedFacing(unit)];

  ctx.save();

  if (unit.isMine && unit.concealed) {
    ctx.beginPath();
    ctx.arc(x, y, HEX_SIZE * 0.98, 0, Math.PI * 2);
    ctx.setLineDash([HEX_SIZE * 0.12, HEX_SIZE * 0.1]);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Selection ring
  if (isSelected) {
    ctx.beginPath();
    ctx.arc(x, y, HEX_SIZE * 1.08, 0, Math.PI * 2);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = HEX_SIZE * 0.16;
    ctx.stroke();
    ctx.strokeStyle = '#D8352A';
    ctx.lineWidth = HEX_SIZE * 0.08;
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
      drawTokenImage(ctx, img, x, y, tokenR, color, 0.15, overlayColor, rotAngle);
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
      drawTokenImage(ctx, img, x, y, tokenR, color, 0.25, overlayColor, rotAngle);
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

  // Ink frame: black ring, player colour inside
  ctx.beginPath();
  ctx.arc(x, y, tokenR, 0, Math.PI * 2);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = HEX_SIZE * 0.09;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, tokenR - HEX_SIZE * 0.07, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = HEX_SIZE * 0.06;
  ctx.stroke();

  // HP bar (white on black, red when low)
  const hpRatio = Math.max(0, Math.min(1, unit.vitality / unit.maxVitality));
  const barW = HEX_SIZE * 1.3;
  const barH = Math.max(4, HEX_SIZE * 0.13);
  const bx = x - barW / 2;
  const by = y + tokenR + HEX_SIZE * 0.06;
  ctx.fillStyle = '#000';
  ctx.fillRect(bx - 2, by - 2, barW + 4, barH + 4);
  ctx.fillStyle = hpRatio > 0.3 ? '#ffffff' : '#D8352A';
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
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.strokeStyle = unit.isMine ? '#ffffff' : '#D8352A';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (icon && icon.complete && icon.naturalWidth) {
      ctx.drawImage(icon, iconX - iconSize/2, iconY - iconSize/2, iconSize, iconSize);
    } else {
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.round(HEX_SIZE * 0.22)}px 'Zen Kaku Gothic New', sans-serif`;
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
  if (pingMode) {
    const hex = getHexUnderMouse(e);
    if (hex && roomCode) wsSend('ping', { roomCode, q: hex.q, r: hex.r });
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
    hideTerrainTooltip();
    return;
  }
  hoveredHex = getHexUnderMouse(e);
  render();

  if (showTerrain) {
    const rect = canvas.getBoundingClientRect();
    const worldX = (e.clientX - rect.left - canvas.width / 2 - camX) / zoom;
    const worldY = (e.clientY - rect.top - canvas.height / 2 - camY) / zoom;
    const nearSeg = getNearestSegment(worldX, worldY);
    if (nearSeg) {
      showTerrainTooltip(buildSegmentTooltip(nearSeg), e);
    } else if (hoveredHex) {
      const tType = terrainData[`${hoveredHex.q},${hoveredHex.r}`] || 'plain';
      showTerrainTooltip(buildTerrainTooltip(tType), e);
    } else {
      hideTerrainTooltip();
    }
  } else {
    hideTerrainTooltip();
  }
});

canvas.addEventListener('mouseleave', hideTerrainTooltip);

canvas.addEventListener('mouseup', () => { isDragging = false; });
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (window.KBSim && KBSim.active()) { KBSim.contextMenu(getHexUnderMouse(e), e.clientX, e.clientY); return; }
  if (gameState?.phase !== 'battle' || gameState?.currentPlayerId !== myId) return;
  const hex = getHexUnderMouse(e);
  const unit = gameState.units.find(u => u.q === hex.q && u.r === hex.r && u.isMine);
  if (!unit) return;
  if (unit.speedRemaining <= 0) { notify('Plus de vitesse disponible.', 'info'); return; }
  showFacingPopup(unit, e.clientX, e.clientY);
});

function showFacingPopup(unit, clientX, clientY) {
  document.getElementById('facing-popup')?.remove();
  const popup = document.createElement('div');
  popup.id = 'facing-popup';
  // Layout 3x2 : NW(3) N(2) NE(1) / SW(4) S(5) SE(0)
  const dirs = [
    { idx: 3, label: '↖' }, { idx: 2, label: '↑' }, { idx: 1, label: '↗' },
    { idx: 4, label: '↙' }, { idx: 5, label: '↓' }, { idx: 0, label: '↘' },
  ];
  Object.assign(popup.style, {
    position: 'fixed', left: `${clientX - 54}px`, top: `${clientY - 40}px`,
    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '3px',
    background: 'rgba(10,5,0,0.95)', border: '1px solid #5a3c10',
    borderRadius: '8px', padding: '6px', zIndex: '1000',
  });
  for (const { idx, label } of dirs) {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      background: unit.facing === idx ? '#5a3c10' : '#2a1408',
      color: '#e8d5a0', border: '1px solid #5a3c10', borderRadius: '4px',
      cursor: 'pointer', fontSize: '18px', width: '34px', height: '34px',
    });
    btn.onclick = () => {
      wsSend('rotate_facing', { roomCode, unitId: unit.id, facing: idx });
      popup.remove();
    };
    popup.appendChild(btn);
  }
  document.body.appendChild(popup);
  setTimeout(() => document.addEventListener('click', () => popup.remove(), { once: true }), 0);
}

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
  if (window.KBSim && KBSim.active()) { KBSim.click(hex); return; }

  if (selectedUnit && mode === 'ability') {
    const opts = abilityTiles.get(key);
    if (opts) { pickUnitAbilityOption(hex, opts); return; }
    setMode('select');
    render();
    return;
  }

  if (selectedUnit) {
    // Clic sur case de déplacement → déplacer
    if (movableTiles.has(key)) {
      wsSend('move_unit', { roomCode, unitId: selectedUnit.id, targetQ: hex.q, targetR: hex.r });
      movableTiles.clear();
      attackableTiles.clear();
      rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
      render();
      return;
    }

    // Clic sur ennemi attaquable → attaquer (hors de portée : l'unité s'approche puis attaque, en une action)
    if (attackableTiles.has(key)) {
      const target = gameState.units.find(u => u.q === hex.q && u.r === hex.r && !u.isMine && !u.isAlly);
      if (target) {
        const a = approachAt(key);
        wsSend('attack_unit', a
          ? { roomCode, attackerId: selectedUnit.id, targetId: target.id, approachQ: a.q, approachR: a.r }
          : { roomCode, attackerId: selectedUnit.id, targetId: target.id });
        movableTiles.clear();
        attackableTiles.clear();
        rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
        render();
        return;
      }
    }


    // Ennemi visible mais hors d'atteinte ce tour : l'unité ne bouge pas
    const foe = gameState?.units.find(u => u.q === hex.q && u.r === hex.r && !u.isMine && !u.isAlly);
    if (foe && selectedUnit.isMine !== false && gameState.currentPlayerId === myId && !selectedUnit.hasAttacked && !selectedUnit.isFleeing) {
      notify(`${foe.name} est hors d'atteinte ce tour : ${selectedUnit.name} ne peut pas s'en approcher assez pour attaquer.`, 'info');
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
    rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
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
  if (deployState?.isReady) { notify('Vous êtes prêt : le déploiement est verrouillé.', 'info'); return; }
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
  const inDeployZone = zone.tileSet ? zone.tileSet.has(`${hex.q},${hex.r}`) : hexDistance(hex.q, hex.r, zone.q, zone.r) <= (zone.radius || 4);

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
  updateActionButtons();
  render();
}

function selectUnit(unit) {
  if (window.KBSim && KBSim.active()) { KBSim.select(unit); return; }
  selectedUnit = unit;
  movableTiles.clear();
  attackableTiles.clear();
  rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;

  if (gameState?.currentPlayerId === myId && unit.speedRemaining > 0 && !unit.isFleeing) {
    computeMovableTiles(unit);
  }
  if (gameState?.currentPlayerId === myId && !unit.hasAttacked && !unit.isFleeing) {
    computeAttackableTiles(unit);
  }
  if (unit.range > 1) {
    computeRangeTiles(unit);
  }
  if (unit.isGeneral) {
    computeMotivateTiles(unit);
  }

  updateActionButtons();
  showUnitDetail(unit);
  renderStancePanel(unit);
  render();
}

function computeMovableTiles(unit) {
  const { dist } = clientReachable(unit);
  const occupied = new Set((gameState?.units || []).map(u => `${u.q},${u.r}`));
  for (const k of dist.keys()) if (!occupied.has(k)) movableTiles.add(k);
  movableTiles.delete(`${unit.q},${unit.r}`);
}

function computeAttackableTiles(unit) {
  approachAttacks.clear();
  if (!gameState) return;
  const hd = mapHeight;
  const hA = hd[`${unit.q},${unit.r}`] || 0;
  const canApproach = gameState.currentPlayerId === myId && unit.speedRemaining > 0 && !unit.isFleeing && !unit.hasAttacked;
  let reach = null;

  for (const u of gameState.units) {
    if (u.isMine || u.isAlly) continue;
    const dist = hexDistance(unit.q, unit.r, u.q, u.r);
    const hT = hd[`${u.q},${u.r}`] || 0;
    const effectiveRange = KBRules.attackRange(unit.range, hA, hT);
    if (dist <= effectiveRange) {
      attackableTiles.add(`${u.q},${u.r}`);
    } else if (canApproach) {
      reach = reach || clientReachable(unit);
      const best = KBRules.bestAttackHex(reach, { start: unit, target: u, range: unit.range || 1, heightAt: (k) => hd[k] || 0, canStand: (k) => k === `${unit.q},${unit.r}` || !gameState.units.some(o => `${o.q},${o.r}` === k) });
      if (best && best.path.length) {
        attackableTiles.add(`${u.q},${u.r}`);
        approachAttacks.set(`${u.q},${u.r}`, { targetId: u.id, q: best.q, r: best.r, path: [[unit.q, unit.r], ...best.path] });
      }
    }
  }
}

// Approach + strike planned against the enemy on this hex (null when it is in range already or out of reach)
function approachAt(key) {
  return attackableTiles.has(key) ? approachAttacks.get(key) || null : null;
}

function drawApproachPreview(ctx) {
  if (!selectedUnit || !hoveredHex || (window.KBSim && KBSim.active())) return;
  const a = approachAt(`${hoveredHex.q},${hoveredHex.r}`);
  if (!a) return;
  const pts = a.path.map(([q, r]) => hexToPixel(q, r));
  const tgt = hexToPixel(hoveredHex.q, hoveredHex.r);
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.85;
  const trace = () => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); };
  ctx.strokeStyle = '#000'; ctx.lineWidth = 6; ctx.setLineDash([]); trace(); ctx.stroke();
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.setLineDash([6, 7]); trace(); ctx.stroke();
  const pe = pts[pts.length - 1];
  ctx.setLineDash([]);
  ctx.strokeStyle = '#000'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(pe.x, pe.y); ctx.lineTo(tgt.x, tgt.y); ctx.stroke();
  ctx.strokeStyle = '#D8352A'; ctx.lineWidth = 4; ctx.setLineDash((selectedUnit.range || 1) > 1 ? [3, 7] : []);
  ctx.beginPath(); ctx.moveTo(pe.x, pe.y); ctx.lineTo(tgt.x, tgt.y); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#D8352A'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(pe.x, pe.y, HEX_SIZE * 0.18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function computeRangeTiles(unit) {
  const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  rangeCenter = { q: unit.q, r: unit.r };
  const hd = mapHeight;
  const hA = hd[`${unit.q},${unit.r}`] || 0;
  const maxRange = (unit.range || 1) + hA; // portée max si cible au niveau 0
  const visited = new Set();
  const queue = [{ q: unit.q, r: unit.r, d: 0 }];
  visited.add(`${unit.q},${unit.r}`);
  while (queue.length) {
    const { q, r, d } = queue.shift();
    const hT = hd[`${q},${r}`] || 0;
    const effectiveRange = KBRules.attackRange(unit.range, hA, hT);
    if (d > 0) rangeTiles.add(`${q},${r}`);
    if (d >= effectiveRange || d >= maxRange) continue;
    for (const [dq, dr] of dirs) {
      const nq = q + dq, nr = r + dr;
      const nk = `${nq},${nr}`;
      if (!visited.has(nk)) {
        visited.add(nk);
        queue.push({ q: nq, r: nr, d: d + 1 });
      }
    }
  }
}

function computeMotivateTiles(unit) {
  if (!unit.charisma) return;
  const range = Math.floor(unit.charisma / 5);
  const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  motivateCenter = { q: unit.q, r: unit.r };
  const visited = new Set();
  const queue = [{ q: unit.q, r: unit.r, d: 0 }];
  visited.add(`${unit.q},${unit.r}`);
  while (queue.length) {
    const { q, r, d } = queue.shift();
    if (d > 0) motivateTiles.add(`${q},${r}`);
    if (d >= range) continue;
    for (const [dq, dr] of dirs) {
      const nq = q + dq, nr = r + dr;
      const nk = `${nq},${nr}`;
      if (!visited.has(nk)) {
        visited.add(nk);
        queue.push({ q: nq, r: nr, d: d + 1 });
      }
    }
  }
}

function setMode(newMode) {
  mode = newMode;
  const indicator = document.getElementById('mode-indicator');
  const labels = { select: 'Sélection', move: 'Déplacement', attack: 'Attaque', motivate: 'Motiver', deploy: 'Déploiement', ability: 'Capacité' };
  if (newMode !== 'ability') abilityTiles.clear();
  indicator.textContent = `Mode : ${labels[newMode] || newMode}`;
  if (newMode !== 'move') movableTiles.clear();
  if (newMode !== 'attack') {
    attackableTiles.clear();
    rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
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
  const canAbility = isGeneral && isMyTurn && !!selectedUnit.activeAbility && !selectedUnit.hasUsedAbility && !(selectedUnit.abilityCooldown > 0);
  const canMotivate = isGeneral && isMyTurn && !selectedUnit.hasAttacked;
  const uab = hasUnit && isMyTurn && !isFleeing && gameState?.phase === 'battle' ? unitActionOf(selectedUnit) : null;
  const canUnitAbility = !!uab && selectedUnit.speedRemaining >= uab.cost && !(uab.type === 'ambush' && selectedUnit.vanishedDay === gameState?.day);
  const abilityBtn = document.getElementById('btn-ability');
  abilityBtn.textContent = canUnitAbility ? `${uab.label} (${uab.cost})` : 'Capacité active';
  abilityBtn.dataset.label = canUnitAbility ? uab.label : '';

  document.getElementById('btn-move').style.display = canMove ? 'block' : 'none';
  document.getElementById('btn-attack').style.display = canAttack ? 'block' : 'none';
  abilityBtn.style.display = canAbility || canUnitAbility ? 'block' : 'none';
  document.getElementById('btn-motivate').style.display = canMotivate ? 'block' : 'none';
  const endDisplay = isMyTurn ? 'block' : 'none';
  const deployDisplay = (mode === 'deploy') ? 'block' : 'none';
  document.getElementById('btn-end-turn-global').style.display = endDisplay;
  document.getElementById('btn-end-turn-center').style.display = endDisplay;
  const noActionsLeft = isMyTurn && gameState?.actionsLeft === 0;
  const btnCenter = document.getElementById('btn-end-turn-center');
  if (noActionsLeft) btnCenter.classList.add('pulse'); else btnCenter.classList.remove('pulse');
  document.getElementById('btn-deploy-ready-global').style.display = deployDisplay;
  const btnDeployCenter = document.getElementById('btn-deploy-ready-center');
  btnDeployCenter.style.display = deployDisplay;
  const allPlaced = deployState?.units.length > 0 && deployState.units.every(u => u.q !== null);
  if (allPlaced) btnDeployCenter.classList.add('pulse'); else btnDeployCenter.classList.remove('pulse');

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

  const st = (!unit.isGeneral && unit.stance) ? (STANCES_DATA[unit.stance] || {}) : {};
  const terrainKey = (unit.q != null && unit.r != null) ? `${unit.q},${unit.r}` : null;
  const terrainType = terrainKey ? (terrainData[terrainKey] || 'plain') : 'plain';
  const tr = TERRAINS_DATA[terrainType] || TERRAINS_DATA.plain;
  const terrainName = tr.name || terrainType;

  // Build a stat row with delta coloring and hover tooltip
  const statRows = [];
  function addStat(label, base, stKey, trKey, suffix) {
    const sDelta = st[stKey] || 0;
    const tDelta = trKey ? (tr[trKey] || 0) : 0;
    const total = sDelta + tDelta;
    let valueHtml;
    if (total === 0) {
      valueHtml = `<span>${base}${suffix||''}</span>`;
    } else {
      const effective = base + total;
      const color = total > 0 ? '#80e080' : '#e08080';
      const sign = total > 0 ? '+' : '';
      valueHtml = `<span style="color:${color}" title="Base: ${base}${suffix||''}${sDelta!==0?` | Posture: ${sDelta>0?'+':''}${sDelta}`:''}${tDelta!==0?` | Terrain: ${tDelta>0?'+':''}${tDelta}`:''}">`;
      valueHtml += `${effective}${suffix||''} <small style="opacity:0.75">(${sign}${total})</small></span>`;
    }
    statRows.push(`<div class="stat-row" style="cursor:default" title="${label}: base ${base}${suffix||''}${sDelta!==0?`, posture ${sDelta>0?'+':''}${sDelta}`:''}${tDelta!==0?`, terrain ${tDelta>0?'+':''}${tDelta}`:''}"><span>${label}</span>${valueHtml}</div>`);
  }

  const speedLabel = unit.speedRemaining != null ? `${fmtSpeed(unit.speedRemaining)}/${unit.speed}` : `${unit.speed}`;
  const stanceLabel = unit.stance ? (stanceNames[unit.stance] || unit.stance) : '—';

  statRows.push(`<div class="stat-row"><span>Vitalité</span><span>${unit.vitality}/${unit.maxVitality}</span></div>`);
  statRows.push(`<div class="stat-row"><span>Moral</span><span>${unit.morale != null ? unit.morale : '—'}/${unit.maxMorale != null ? unit.maxMorale : '—'}</span></div>`);
  if (!unit.isGeneral) {
    addStat('Attaque', unit.attack, 'attack_cac', 'attack_cac');
    addStat('Puissance', unit.power, 'puissance_cac', 'puissance_cac');
    addStat('Défense', unit.defense, 'defense_cac', 'defense_cac');
    addStat('Armure', unit.armor, 'armure', 'armure');
  } else {
    statRows.push(`<div class="stat-row"><span>Attaque</span><span>${unit.attack}</span></div>`);
    statRows.push(`<div class="stat-row"><span>Puissance</span><span>${unit.power}</span></div>`);
    statRows.push(`<div class="stat-row"><span>Défense</span><span>${unit.defense}</span></div>`);
    statRows.push(`<div class="stat-row"><span>Armure</span><span>${unit.armor}</span></div>`);
  }
  statRows.push(`<div class="stat-row"><span>Vitesse</span><span>${speedLabel}</span></div>`);
  if (unit.range > 1) statRows.push(`<div class="stat-row"><span>Portée</span><span>${unit.range} cases</span></div>`);
  if (unit.visionRange > 0) statRows.push(`<div class="stat-row"><span>Vision</span><span>${unit.visionRange} cases</span></div>`);
  if (unit.isMine && unit.concealed) statRows.push(`<div class="stat-row" style="color:#8cdc8c"><span>Embuscade</span><span>cachée</span></div>`);
  if (unit.stunned) statRows.push(`<div class="stat-row" style="color:#e08080"><span>Duel perdu</span><span>sonné</span></div>`);
  if (!unit.isGeneral) {
    statRows.push(`<div class="stat-row"><span>Posture</span><span>${stanceLabel}</span></div>`);
    statRows.push(`<div class="stat-row" style="color:#a89060;font-size:0.8em"><span>Terrain</span><span>${terrainName}</span></div>`);
  }
  statRows.push(`<div class="stat-row"><span>Déplacé</span><span>${unit.hasMoved ? 'Oui' : 'Non'}</span></div>`);
  statRows.push(`<div class="stat-row"><span>Attaqué</span><span>${unit.hasAttacked ? 'Oui' : 'Non'}</span></div>`);

  document.getElementById('detail-stats').innerHTML = statRows.join('');
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
      <span class="icon">${u.isGeneral ? '将' : '·'}</span>
      <span class="uname"${fleeing}>${u.name}${u.isFleeing ? ' (fuite)' : ''}</span>
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
    3. Place ton Général en dernier<br>
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
      <span class="icon">${u.isGeneral ? '将' : '·'}</span>
      <span class="uname">${u.name}</span>
      <span class="uhp" style="color:${placed ? '#4aaa4a' : '#c8960c'}">${placed ? 'Placé' : 'À placer'}</span>
    `;
    div.onclick = () => {
      selectedUnit = u;
      renderDeployUnitList(deployState.units);
      if (u.q === null) focusDeployZone();
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

function toggleWeakness() {
  showWeakness = !showWeakness;
  const b = document.getElementById('tool-weakness');
  if (b) b.classList.toggle('active', showWeakness);
  render();
}

function toggleCoords() {
  showCoords = !showCoords;
  document.getElementById('tool-coords').classList.toggle('active', showCoords);
  render();
}

let turnPopupTimer = null;
let pendingTurnPopup = null;
function showTurnPopup(name, sub, color) {
  const el = document.getElementById('turn-popup');
  const nameEl = document.getElementById('turn-popup-name');
  const subEl = document.getElementById('turn-popup-sub');
  if (!el) return;
  nameEl.textContent = name;
  nameEl.style.color = color || '#ffd700';
  subEl.textContent = sub || '';
  el.classList.add('visible');
  if (turnPopupTimer) clearTimeout(turnPopupTimer);
  turnPopupTimer = setTimeout(() => el.classList.remove('visible'), 3000);
}

function togglePing() {
  pingMode = !pingMode;
  document.getElementById('tool-ping').classList.toggle('active', pingMode);
  canvas.style.cursor = pingMode ? 'crosshair' : '';
}

function drawPings(ctx) {
  const now = performance.now();
  const DURATION = 1800;
  for (let i = activePings.length - 1; i >= 0; i--) {
    const p = activePings[i];
    const elapsed = now - p.startTime;
    if (elapsed > DURATION) { activePings.splice(i, 1); continue; }
    const t = elapsed / DURATION;
    const { x, y } = hexToPixel(p.q, p.r);
    const maxR = HEX_SIZE * 1.2;
    const radius = maxR * t;
    const alpha = 1 - t;
    ctx.save();
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 3;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    // 2ème anneau décalé
    const radius2 = maxR * Math.max(0, t - 0.3);
    if (radius2 > 0) {
      ctx.beginPath();
      ctx.arc(x, y, radius2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (activePings.length > 0) requestAnimationFrame(() => render());
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
}

function closeInitiativeModal() {
  document.getElementById('overlay-initiative').style.display = 'none';
  if (window._initiativeTimer) clearTimeout(window._initiativeTimer);
  if (window._pendingTurnPopupAfterInitiative) {
    const fn = window._pendingTurnPopupAfterInitiative;
    window._pendingTurnPopupAfterInitiative = null;
    fn();
  }
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
    const imgTokenSrc = imgToken ? `/assets/unites/GENERAL TOKEN/${encodeURIComponent(imgToken)}.png` : null;
    let portraitHtml;
    if (img1Src) {
      portraitHtml = `<img class="to-portrait" src="${img1Src}">`;
    } else if (imgTokenSrc) {
      portraitHtml = `<img class="to-portrait" src="${imgTokenSrc}">`;
    } else {
      portraitHtml = `<div class="to-portrait-placeholder">将</div>`;
    }

    const name = roll?.playerName || roll?.generalName || id;
    const offline = playerData && playerData.connected === false;
    const div = document.createElement('div');
    div.className = `turn-order-item${isCurrent ? ' current' : ''}${hasPlayed ? ' played' : ''}`;
    if (offline) { div.style.opacity = '0.45'; div.title = 'Hors ligne'; }
    div.innerHTML = `${portraitHtml}<span class="to-name">${escapeHtml(name)}${offline ? ' (absent)' : ''}</span>`;
    list.appendChild(div);
  }
}

function endTurn(confirmed = false) {
  if (gameState?.currentPlayerId !== myId) return;
  if (!confirmed && gameState.actionsLeft > 0) {
    const names = (gameState.actionUnitIds || []).map(id => (gameState.myUnits || []).find(u => u.id === id)?.name).filter(Boolean);
    document.getElementById('confirm-end-msg').textContent = `${gameState.actionsLeft} unité${gameState.actionsLeft > 1 ? 's peuvent' : ' peut'} encore agir${names.length ? ' : ' + names.join(', ') : ''}.`;
    document.getElementById('overlay-confirm-end').style.display = 'flex';
    return;
  }
  document.getElementById('overlay-confirm-end').style.display = 'none';
  wsSend('end_turn', { roomCode });
  selectedUnit = null;
  movableTiles.clear();
  attackableTiles.clear();
  rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
  setMode('select');
  const stancePanel = document.getElementById('stance-panel');
  if (stancePanel) stancePanel.style.display = 'none';
}

function motivateAll() {
  if (!selectedUnit || !selectedUnit.isGeneral) return;
  wsSend('motivate_unit', { roomCode, generalId: selectedUnit.id });
}

const UNIT_ACTIONS = { sabotage: 'Saboter', build: 'Construire', ambush: 'Disparaître' };
function unitActionOf(unit) {
  if (!unit || unit.isGeneral) return null;
  const ab = KBRules.ability(unit, UNIT_TYPES);
  return ab && UNIT_ACTIONS[ab.type] ? { ...ab, label: UNIT_ACTIONS[ab.type] } : null;
}

// Espion / bâtisseurs: highlight the neighbours where the ability can act; assassin: vanish at once
function useUnitAbility(unit, ab) {
  if (ab.type === 'ambush') { wsSend('unit_vanish', { roomCode, unitId: unit.id }); return; }
  abilityTiles.clear();
  for (const [dq, dr] of KBRules.DIRS) {
    const nq = unit.q + dq, nr = unit.r + dr, nk = `${nq},${nr}`;
    if (!(nk in mapHeight)) continue;
    const seg = segmentData[segmentEdgeKey(unit.q, unit.r, nq, nr)] || null;
    const ter = terrainData[nk] || 'plain';
    let opts = [];
    if (ab.type === 'build') opts = KBRules.buildOptions(seg, ter);
    else { const o = KBRules.sabotageOption(seg, ter); if (o) opts = [{ id: 'sabotage', ...o }]; }
    if (opts.length) abilityTiles.set(nk, opts);
  }
  if (!abilityTiles.size) { notify(ab.type === 'build' ? 'Rien à construire ni à brûler à côté de cette unité.' : 'Aucune infrastructure à saboter à côté de cette unité.', 'info'); return; }
  setMode('ability');
  render();
}

function sendUnitAbility(hex, opt) {
  if (!selectedUnit) return;
  if (opt.id === 'sabotage') wsSend('unit_sabotage', { roomCode, unitId: selectedUnit.id, q: hex.q, r: hex.r });
  else wsSend('unit_build', { roomCode, unitId: selectedUnit.id, q: hex.q, r: hex.r, kind: opt.id });
  setMode('select');
  render();
}

function pickUnitAbilityOption(hex, opts) {
  if (opts.length === 1) { sendUnitAbility(hex, opts[0]); return; }
  const box = document.getElementById('ability-targets');
  document.getElementById('ability-target-title').textContent = 'Construire';
  box.innerHTML = '';
  for (const o of opts) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = KBRules.RULES.abilities.build_kinds[o.id]?.label || o.id;
    b.onclick = () => { closeAbilityTarget(); sendUnitAbility(hex, o); };
    box.appendChild(b);
  }
  document.getElementById('overlay-ability-target').style.display = 'flex';
}

function useAbility() {
  const uab = unitActionOf(selectedUnit);
  if (uab) { useUnitAbility(selectedUnit, uab); return; }
  if (!selectedUnit || !selectedUnit.isGeneral || !selectedUnit.activeAbility) return;
  const ability = selectedUnit.activeAbility;
  if (ability.target !== 'enemy_army') { wsSend('use_ability', { roomCode }); return; }
  const enemies = (gameState?.players || []).filter(p => p.id !== myId && !p.isEliminated);
  if (enemies.length === 1) { wsSend('use_ability', { roomCode, targetId: enemies[0].id }); return; }
  const box = document.getElementById('ability-targets');
  document.getElementById('ability-target-title').textContent = ability.name;
  box.innerHTML = '';
  for (const p of enemies) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.style.cssText = `border:2px solid ${p.color};background:#1a0f04;color:#e0c080;padding:8px 14px`;
    b.textContent = p.name;
    b.onclick = () => { closeAbilityTarget(); wsSend('use_ability', { roomCode, targetId: p.id }); };
    box.appendChild(b);
  }
  document.getElementById('overlay-ability-target').style.display = 'flex';
}

function closeAbilityTarget() {
  document.getElementById('overlay-ability-target').style.display = 'none';
}

// ---- TOP BAR: time of day, scores, turn timer ----
function renderTopInfo() {
  const el = document.getElementById('top-time');
  if (!el) return;
  if (!gameState || gameState.timeOfDay == null) { el.textContent = ''; return; }
  el.textContent = `${gameState.isNight ? 'Nuit ·' : ''} Jour ${gameState.day || 1} · ${KBRules.formatHour(gameState.timeOfDay)}`;
  el.style.color = gameState.isNight ? '#9fb4ff' : '#e8c060';
  const sc = document.getElementById('top-scores');
  const objs = gameState.objectives || [];
  const vp = gameState.settings?.victoryPoints || 0;
  if (sc) {
    sc.innerHTML = objs.length || vp ? (gameState.players || []).map(p => `<span style="color:${p.color}">${escapeHtml(p.name)} ${gameState.scores?.[p.id] || 0}</span>`).join(' · ') + (vp ? ` <span class="text-muted">/ ${vp}</span>` : '') : '';
  }
  const mt = gameState.settings?.maxTurns;
  document.getElementById('top-turn').textContent = `Tour ${gameState.turn}${mt ? '/' + mt : ''} · Manche ${gameState.manche || 1}`;
}

setInterval(() => {
  const el = document.getElementById('top-timer');
  if (!el) return;
  const at = gameState?.phase === 'battle' ? gameState.turnEndsAt : null;
  if (!at) { el.textContent = ''; return; }
  const left = Math.max(0, Math.ceil((at - Date.now()) / 1000));
  el.textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  el.style.color = left <= 10 ? '#ff6040' : '#c8960c';
}, 500);

// ---- RULES PANEL ----
function toggleRules() {
  const o = document.getElementById('overlay-rules');
  if (o.style.display === 'flex') { o.style.display = 'none'; return; }
  const R = KBRules.RULES;
  const st = gameState?.settings || KBRules.defaultSettings();
  const tc = R.movement.terrainCost;
  const frac = (v) => (Math.abs(v - 1 / 3) < 1e-9 ? '1/3' : String(v));
  document.getElementById('rules-content').innerHTML = `
    <h3>Déplacement</h3>
    <p>Coût pour quitter une case : plaine ${tc.plain}, route ${frac(tc.road)}, forêt ${tc.forest}, fleuve ${tc.river}, bâtiment ${tc.building}, pont ${frac(tc.bridge)}.
    Montée : +${R.movement.slopeUpPerLevel} par niveau ; descente gratuite. Falaises et murs : infranchissables.
    Échelle : infanterie et généraux uniquement, coût ${R.movement.ladder.cost} (jamais la cavalerie ni les chars). Rivière et barrière : +1.
    Une unité qui n'a encore rien dépensé de sa vitesse peut toujours avancer d'une case, même trop chère.</p>
    <p>Cliquer un ennemi hors de portée (case orange) : l'unité s'approche puis attaque, en une seule action ; s'il est hors d'atteinte ce tour, elle ne bouge pas.</p>
    <h3>Jour et nuit</h3>
    <p>La bataille commence à ${KBRules.formatHour(R.time.startHour)} ; ${st.turnsPerHalfDay} tours par demi-journée. Nuit de ${R.time.nightStartHour}h à ${R.time.dayStartHour}h :
    vision ×${R.night.visionFactor} (min ${R.night.visionMin}), vitesse −${R.night.speedMalus}, attaque ${R.night.attackMod.cac} au corps à corps et ${R.night.attackMod.tir} au tir,
    la posture Repos (et Défense de combat) récupère davantage de moral et de vitalité.</p>
    <h3>Embuscades</h3>
    <p>Une unité en forêt ou dans un bâtiment est invisible pour l'ennemi, même dans sa vision, sauf si une unité ennemie lui est adjacente,
    si un espion ennemi est à ${R.concealment.spyDistance} cases ou moins, ou si elle a attaqué (révélée jusqu'à la fin de son prochain tour).
    Un déplacement qui bute sur une unité cachée s'arrête net (plus de vitesse ce tour).</p>
    <h3>Duels de généraux</h3>
    <p>Un général qui attaque un général au corps à corps provoque un duel : ${R.duel.maxRounds} passes, chacun lance D20 + Force ; le plus haut frappe
    (arme + écart − armure × ${R.duel.armorFactor}). Le vaincu (sauf s'il meurt) perd ${Math.round(R.duel.loserMoraleShock * 100)} % du moral de son armée et reste sonné un tour ;
    les unités du vainqueur à ${R.duel.boostRadius} cases gagnent ${Math.round(R.duel.winnerMoraleBoost * 100)} % de moral.</p>
    <h3>Objectifs et victoire</h3>
    <p>Finir son tour sur un objectif le capture ; chaque objectif tenu rapporte ses points au début de chaque tour.
    Victoire : dernier général en vie${st.victoryPoints ? `, ou ${st.victoryPoints} points` : ''}${st.maxTurns ? `, ou meilleur score après ${st.maxTurns} tours` : ''}.</p>
    <h3>Tour de jeu</h3>
    <p>Le tour se termine automatiquement quand plus aucune unité ne peut agir.${st.turnTimer ? ` Minuteur : ${st.turnTimer} s par tour.` : ''}</p>
    <p class="text-muted" style="font-size:0.85em">Règles complètes : docs/regles.md</p>`;
  o.style.display = 'flex';
}

// ---- END OF BATTLE: recap + replay ----
let replayChunks = null;
let replayAction = null;
let replayWindow = null;

function showRecap(data) {
  const recap = data.recap;
  document.getElementById('gameover-msg').textContent = data.winnerName ? `${data.winnerName} remporte la bataille !` : 'Match nul !';
  const reasons = { elimination: 'Général ennemi vaincu', points: 'Points de victoire atteints', max_turns: 'Limite de tours atteinte' };
  const box = document.getElementById('recap-content');
  if (!recap) { box.innerHTML = ''; }
  else {
    const rows = recap.players.map(p => `<tr><td style="color:${p.color}">${escapeHtml(p.name)}${p.id === recap.winnerId ? ' (vainqueur)' : ''}</td><td>${p.damageDealt}</td><td>${p.damageTaken}</td><td>${p.kills}</td><td>${p.losses}</td><td>${p.captures}</td><td>${p.points}</td><td>${p.unitsAlive}/${p.unitsTotal}</td></tr>`).join('');
    const units = recap.units.slice().sort((a, b) => b.damageDealt - a.damageDealt).map(u => {
      const pl = recap.players.find(p => p.id === u.playerId);
      return `<tr style="${u.alive ? '' : 'opacity:0.55'}"><td style="color:${pl?.color || '#ccc'}">${u.isGeneral ? '将 ' : ''}${escapeHtml(u.name)}</td><td>${u.damageDealt}</td><td>${u.damageTaken}</td><td>${u.kills}</td><td>${u.alive ? 'vivante' : u.fled ? 'en fuite' : 'détruite'}</td></tr>`;
    }).join('');
    box.innerHTML = `<div class="text-muted" style="margin-bottom:8px">${reasons[recap.endReason] || ''} · ${recap.turns} tours</div>
      <table class="recap-table"><tr><th>Joueur</th><th>Dégâts infligés</th><th>Dégâts subis</th><th>Victimes</th><th>Pertes</th><th>Captures</th><th>Points</th><th>Unités</th></tr>${rows}</table>
      <details style="margin-top:10px"><summary style="cursor:pointer;color:#c8960c">Détail par unité</summary>
      <table class="recap-table"><tr><th>Unité</th><th>Infligés</th><th>Subis</th><th>Victimes</th><th>État</th></tr>${units}</table></details>`;
  }
  document.getElementById('btn-replay-view').style.display = recap && recap.replayAvailable ? '' : 'none';
  document.getElementById('btn-replay-download').style.display = recap && recap.replayAvailable ? '' : 'none';
  document.getElementById('overlay-gameover').style.display = 'flex';
}

function requestReplay(action) {
  replayAction = action;
  replayChunks = null;
  // Open the tab during the click: browsers block window.open once the replay arrives over the socket
  if (action === 'view') {
    replayWindow = window.open('', '_blank');
    if (replayWindow) replayWindow.document.title = 'Replay…';
  }
  wsSend('get_replay', { roomCode });
}

function onReplayChunk(data) {
  if (!replayChunks || replayChunks.length !== data.total) replayChunks = new Array(data.total).fill(null);
  replayChunks[data.index] = data.data;
  if (replayChunks.some(c => c === null)) return;
  const text = replayChunks.join('');
  replayChunks = null;
  if (replayAction === 'download') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = `replay_${roomCode || 'bataille'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } else {
    const win = replayWindow;
    replayWindow = null;
    try { localStorage.setItem('kb_last_replay', text); } catch (e) {
      if (win && !win.closed) win.close();
      notify('Replay trop volumineux pour le stockage local : téléchargez-le.');
      return;
    }
    if (win && !win.closed) win.location.href = '/replay.html?local=1';
    else if (!window.open('/replay.html?local=1', '_blank')) notify('Le navigateur a bloqué l\'ouverture du replay : autorisez les fenêtres pour ce site, ou téléchargez-le.');
  }
}

function deploymentReady() {
  const gen = deployState?.units.find(u => u.isGeneral);
  if (!gen || gen.q === null) {
    notify('Vous devez placer votre Général avant d\'être prêt.');
    return;
  }
  wsSend('deployment_ready', { roomCode });
  setDeployReadyButtons('En attente des autres joueurs…', true);
}

function setDeployReadyButtons(text, disabled) {
  for (const id of ['btn-deploy-ready-global', 'btn-deploy-ready-center']) {
    const b = document.getElementById(id);
    if (!b) continue;
    b.textContent = text;
    b.disabled = disabled;
  }
}

function addCombatLog(log) {
  const container = document.getElementById('combat-log');
  const entry = document.createElement('div');
  entry.className = 'combat-log-entry' + (log.targetKilled ? ' kill' : log.hit ? ' hit' : ' miss');

  let text = '';
  if (log.abilityUsed) {
    text = `${log.abilityUsed} : ${log.effects?.join(', ')}`;
  } else if (log.duel) {
    const w = log.duel.winnerId === log.attackerId ? log.attackerName : log.duel.winnerId === log.targetId ? log.targetName : null;
    text = `Duel ${log.attackerName} / ${log.targetName} : ${w ? `${w} l'emporte` : 'indécis'}`;
    if (log.generalKilled) text += ' — GÉNÉRAL TUÉ !';
  } else {
    text = `${log.attackerName} → ${log.targetName}: `;
    // Support both old format (damage) and new format (dmgReceived)
    const dmg = log.dmgReceived != null ? log.dmgReceived : log.damage;
    text += log.hit ? `${dmg} dégâts` : 'Manqué';
    if (log.targetKilled) text += ` (${log.targetName} éliminé!)`;
    if (log.generalKilled) text += ` — GÉNÉRAL TUÉ !`;
    if (log.trample) text = `Piétinement : ${text}`;
    if (log.bonuses && log.bonuses.length) text += ` — ${log.bonuses.map(b => b.text).join(' ; ')}`;
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
      imgHtml = `<div class="uc-pdf-img-placeholder" style="font-size:52px;flex-direction:column;gap:8px">将<span style="font-size:14px;color:#7a5820">${unit.name}</span></div>`;
    }
  } else {
    const src = img1Url(UNIT_IMAGE1_MAP, unit.typeId, 'UNIT IMAGE 1-1');
    const imgToken = UNIT_TOKEN_MAP[unit.typeId];
    if (src) {
      imgHtml = `<img class="uc-pdf-img" src="${src}" alt="${unit.name}">`;
    } else if (imgToken) {
      imgHtml = `<img class="uc-pdf-img" src="/assets/unites/UNIT TOKEN/${encodeURIComponent(imgToken)}.png" alt="${unit.name}">`;
    } else {
      imgHtml = `<div class="uc-pdf-img-placeholder">${unit.name.charAt(0)}</div>`;
    }
  }

  // Barre de vie
  const hpPct = Math.round(unit.vitality / unit.maxVitality * 100);
  const hpColor = hpPct > 50 ? '#2a8c2a' : hpPct > 25 ? '#c8960c' : '#a02020';
  const hpBar = `<div class="uc-pdf-hpbar-wrap"><div class="uc-pdf-hpbar" style="width:${hpPct}%;background:${hpColor}"></div></div>`;

  // Modificateurs stance + terrain
  const _st = (!unit.isGeneral && unit.stance) ? (STANCES_DATA[unit.stance] || {}) : {};
  const _terrainKey = (unit.q != null && unit.r != null) ? `${unit.q},${unit.r}` : null;
  const _terrainType = _terrainKey ? (terrainData[_terrainKey] || 'plain') : 'plain';
  const _tr = TERRAINS_DATA[_terrainType] || TERRAINS_DATA.plain;
  const _stanceName = unit.stance ? (stanceNames[unit.stance] || unit.stance) : null;
  const _terrainName = _tr.name || _terrainType;

  // Retourne { html, tip } pour une stat avec modificateurs cac/tir (ou single si cac===tir)
  function _mod(base, stCacKey, stTirKey, trCacKey, trTirKey) {
    const sCac = _st[stCacKey] || 0, sTir = stTirKey ? (_st[stTirKey] || 0) : sCac;
    const tCac = trCacKey ? (_tr[trCacKey] || 0) : 0, tTir = trTirKey ? (_tr[trTirKey] || 0) : tCac;
    const dCac = sCac + tCac, dTir = sTir + tTir;

    const tipParts = [`Base : ${base}`];
    if (_stanceName && (sCac !== 0 || sTir !== 0)) {
      tipParts.push(`Posture (${_stanceName}) : ${sCac >= 0 ? '+' : ''}${sCac} cac / ${sTir >= 0 ? '+' : ''}${sTir} tir`);
    }
    if (_terrainType !== 'plain' && (tCac !== 0 || tTir !== 0)) {
      tipParts.push(`Terrain (${_terrainName}) : ${tCac >= 0 ? '+' : ''}${tCac} cac / ${tTir >= 0 ? '+' : ''}${tTir} tir`);
    }
    const tip = tipParts.join(' | ');

    if (dCac === 0 && dTir === 0) return { html: String(base), tip };

    const fmt = (base, d) => {
      const eff = base + d;
      const color = d > 0 ? '#2e7d32' : '#c62828';
      const sign = d > 0 ? '+' : '';
      return `<span style="color:${color};font-weight:bold">${eff}<sup style="font-size:0.6em">(${sign}${d})</sup></span>`;
    };

    if (dCac === dTir) return { html: fmt(base, dCac), tip };
    return { html: `${fmt(base, dCac)}<span style="color:#888;font-size:0.75em"> / ${fmt(base, dTir)}</span>`, tip };
  }

  function _statDiv(label, html, tip) {
    return `<div class="uc-pdf-stat" title="${tip.replace(/"/g, '&quot;')}"><div class="uc-pdf-stat-label">${label}</div><div class="uc-pdf-stat-value">${html}</div></div>`;
  }

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
    const atk  = _mod(unit.attack,           'attack_cac',       'attack_tir',       'attack_cac',       'attack_tir');
    const def  = _mod(unit.defense,          'defense_cac',      'defense_tir',      'defense_cac',      'defense_tir');
    const pui  = _mod(unit.power,            'puissance_cac',    'puissance_tir',    'puissance_cac',    'puissance_tir');
    const inti = _mod(unit.intimidation ?? 0,'intimidation_cac', 'intimidation_tir', 'intimidation_cac', 'intimidation_tir');
    const arm  = _mod(unit.armor,            'armure',           null,               'armure',           null);
    const spd  = _mod(unit.speed,            'vitesse',          null,               'vitesse',          null);

    statsHtml = [
      `<div class="uc-pdf-stat" style="grid-column:1/-1"><div class="uc-pdf-stat-label">Vitalité</div><div class="uc-pdf-stat-value">${unit.vitality}/${unit.maxVitality}</div></div>`,
      `<div class="uc-pdf-stat" style="grid-column:1/-1"><div class="uc-pdf-stat-label">Morale</div><div class="uc-pdf-stat-value">${unit.morale ?? '—'}/${unit.maxMorale ?? '—'}</div></div>`,
      _statDiv('Attaque',      atk.html,  atk.tip),
      _statDiv('Défense',      def.html,  def.tip),
      _statDiv('Puissance',    pui.html,  pui.tip),
      _statDiv('Intimidation', inti.html, inti.tip),
      _statDiv('Armure',       arm.html,  arm.tip),
      _statDiv('Vitesse',      spd.html,  spd.tip),
    ].join('');
    if (unit.range > 1) statsHtml += `<div class="uc-pdf-stat"><div class="uc-pdf-stat-label">Portée</div><div class="uc-pdf-stat-value">${unit.range} cases</div></div>`;
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

function appendChatMessage({ authorName, text, isMine, isSystem, authorId, isSpectator: isSpectatorMsg }) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  if (isSystem) {
    div.className = 'chat-msg system';
    div.textContent = text;
  } else {
    const players = gameState?.players || deployState?.players || [];
    const color = authorId ? (players.find(p => p.id === authorId)?.color || '#c8960c') : '#c8960c';
    div.className = `chat-msg ${isMine ? 'mine' : 'other'}`;
    div.innerHTML = `<span class="chat-author" style="color:${escapeHtml(color)}">${escapeHtml(authorName)}${isSpectatorMsg ? ' <span style="opacity:0.6">(spectateur)</span>' : ''} : </span><span class="chat-text">${escapeHtml(text)}</span>`;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
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
  const defLabels = { rien: 'Aucune défense', none: 'Aucune défense', counter: 'Contre-attaque', absorb: 'Encaissement' };
  const stanceNames2 = { marche: 'Marche', combat: 'Combat', charge: 'Charge', repos: 'Repos', defense_combat: 'Déf. combat', defense_distance: 'Déf. distance' };
  const terrainNames = { plain: 'Plaines', forest: 'Forêt', river: 'Rivière', road: 'Route', building: 'Bâtiment', bridge: 'Pont' };
  const aSt = stanceNames2[b.attackerStance] || b.attackerStance || '—';
  const dSt = stanceNames2[b.defenderStance] || b.defenderStance || '—';
  const aTe = terrainNames[b.attackerTerrain] || b.attackerTerrain || '—';
  const dTe = terrainNames[b.defenderTerrain] || b.defenderTerrain || '—';
  const attackerColor = gameState?.players?.find(p => p.id === log.attackerPlayerId)?.color;
  const targetColor = gameState?.players?.find(p => p.id === log.targetPlayerId)?.color;

  const hitBadge = hit ? `<span class="h-badge h-hit">TOUCHÉ</span>` : `<span class="h-badge h-miss">RATÉ</span>`;
  const header = `<div class="h-header" onclick="toggleHistory('${id}')"${attackerColor ? ` style="border-left:3px solid ${attackerColor}"` : ''}>
    <span class="h-arrow" id="arrow-${id}">▶</span>
    <span class="h-title">T${round} — <b${attackerColor ? ` style="color:${attackerColor}"` : ''}>${log.attackerName || '?'}</b> → <b${targetColor ? ` style="color:${targetColor}"` : ''}>${log.targetName || '?'}</b></span>
    ${log.trample ? `<span class="h-badge h-trample">PIÉTINEMENT</span>` : ''}
    ${hitBadge}
    ${log.targetKilled ? `<span class="h-badge h-dead">DÉTRUIT</span>` : ''}
    ${log.attackerKilled ? `<span class="h-badge h-dead">ATTAQUANT DÉTRUIT</span>` : ''}
  </div>`;

  const sign = n => n >= 0 ? `+${n}` : `${n}`;
  const row = (label, val, cls = '') => (val === null || val === undefined || val === '') ? '' : `<tr class="${cls}"><td>${label}</td><td>${val}</td></tr>`;
  const mods = (...list) => list.filter(([v]) => v).map(([v, l]) => `${sign(v)} ${l}`).join(', ');
  const modRow = (label, ...list) => { const m = mods(...list); return m ? row(label, m) : ''; };
  const pct = (x) => x == null ? '—' : `${Math.round(x * 100)} %`;
  const general = b.generalD20 != null;
  const generalDef = b.generalD20Def != null;

  let table = `<div class="h-detail" id="${id}" style="display:none"><table class="h-table"><tbody>
    <tr class="h-section"><td colspan="2">ATTAQUE</td></tr>`;
  if (general) {
    table += row('Force − d20 + 80', `${b.attackBase} − ${b.generalD20} + 80 = <b>${b.generalAttValue}</b>`, 'h-hit-row');
  } else {
    table += row('Dés (1 par 5 de vitalité)', b.NGOAtt);
    table += row('Attaque effective', `${b.attackBase} → <b>${b.attackEff}</b>`);
    table += modRow('Modificateurs', [b.modAngle, b.angleName === 'dos' ? 'de dos' : 'de flanc'], [b.modAtkStance, aSt], [b.modAtkTerrain, aTe], [b.modEsquive, 'esquive'], [b.modHauteur, 'hauteur'], [b.modNuit, 'nuit'], [b.extraAttack, 'charge']);
    table += row('Réussites (d20 ≤ attaque)', `<b>${b.attReussite} / ${b.NGOAtt}</b>`, hit ? 'h-hit-row' : 'h-miss-row');
  }
  table += `<tr class="h-section"><td colspan="2">DÉGÂTS</td></tr>`;
  table += row('Puissance', general ? `${b.basePowerAtt} (÷5, ÷2)` : `${b.basePowerAtt} → <b>${b.effectivePowerAtt}</b>`);
  if (!general) table += modRow('Modificateurs puissance', [b.lancierBonus, 'lanciers'], [b.modPwrAtt, aSt], [b.modAngle, 'angle'], [b.extraPower, 'charge']);
  table += row('Armure défenseur', `${b.baseArmorDef} → <b>${b.effectiveArmorDef}</b>`);
  table += modRow('Modificateurs armure', [b.modArmorDefAngle, 'angle'], [b.modArmorDefStance, dSt], [b.modArmorDefTerrain, dTe], [b.phalangeBonus, 'phalange'], [b.lancierRangedBonus, 'lanciers']);
  table += row('Ratio d\'armure', `${pct(b.ratARDef)} (dés ${b.NGODef} × armure)`);
  table += row('Vitalité perdue', `<b>${log.dmgReceived ?? 0}</b>${log.defenseChoice === 'absorb' ? ' (÷2)' : ''}`, 'h-hit-row');
  table += row('Vitalité restante cible', log.targetVitalityLeft ?? '—');
  table += `<tr class="h-section"><td colspan="2">MORAL</td></tr>`;
  table += row('Intimidation effective', b.effectiveIntimidation);
  table += modRow('Modificateurs', [b.modIntimAtt, aSt], [b.modCourageDef, 'courage'], [b.modAngle, 'angle']);
  table += row('Moral perdu', log.moralDmg ?? 0);
  if (log.targetMoraleLeft != null) table += row('Moral restant cible', log.targetMoraleLeft);

  if (log.defenseChoice === 'counter' || log.defenseChoice === 'absorb') {
    table += `<tr class="h-section"><td colspan="2">DÉFENSE — ${defLabels[log.defenseChoice]}</td></tr>`;
    if (generalDef) {
      table += row('Force − d20 + 80', `${b.defBase} − ${b.generalD20Def} + 80 = <b>${b.generalAttValueDef}</b>`);
    } else {
      table += row('Dés', b.NGODef);
      table += row('Défense effective', `${b.defBase} → <b>${b.defEff}</b>`);
      table += modRow('Modificateurs', [b.modDefAngle, 'angle'], [b.modDefStance, dSt], [b.modDefTerrain, dTe], [b.modPrecision, 'précision'], [b.modHauteurDef, 'hauteur']);
      table += row('Réussites', `<b>${b.defReussite ?? 0} / ${b.NGODef}</b>`, log.defenseSuccess ? 'h-hit-row' : 'h-miss-row');
      table += row('Puissance riposte', `${b.basePowerDef} → <b>${b.effectivePowerDef}</b>`);
    }
    table += row('Armure attaquant', `${b.baseArmorAtt} → <b>${b.effectiveArmorAtt}</b> · ratio ${pct(b.ratARAtt)}`);
    if (log.counterDmgReceived > 0) {
      table += row('Vitalité perdue (attaquant)', `<b>${log.counterDmgReceived}</b>`, 'h-hit-row');
      table += row('Vitalité restante atq.', log.attackerVitalityLeft ?? '—');
    }
    if (log.counterMoralDmg > 0) table += row('Moral perdu (attaquant)', log.counterMoralDmg);
  } else if (log.defenseChoice) {
    table += `<tr class="h-section"><td colspan="2">${defLabels[log.defenseChoice] || log.defenseChoice}</td></tr>`;
  }
  if (log.bonuses && log.bonuses.length) {
    table += `<tr class="h-section"><td colspan="2">CAPACITÉS</td></tr>`;
    for (const bo of log.bonuses) table += `<tr><td colspan="2">${bo.text}</td></tr>`;
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

// ---- TERRAIN / SEGMENT TOOLTIP ----
function ttGrid(rows, showTir = true) {
  const cell = (val) => {
    if (val === null || val === undefined || val === 0) return `<td style="color:#555">—</td>`;
    const cls = val > 0 ? 'tt-pos' : 'tt-neg';
    return `<td class="${cls}">${val > 0 ? '+' : ''}${val}</td>`;
  };
  let html = `<table class="tt-grid"><thead><tr><th></th><th>Cac</th>${showTir ? '<th>Tir</th>' : ''}</tr></thead><tbody>`;
  for (const [label, cac, tir] of rows) {
    if (!showTir && cac === 0) continue;
    if (showTir && cac === 0 && tir === 0) continue;
    html += `<tr><td class="tt-label">${label}</td>${cell(cac)}${showTir ? cell(tir) : ''}</tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

function buildTerrainTooltip(terrainType) {
  const t = TERRAINS_DATA[terrainType];
  if (!t) return '';
  const val = (v) => v === 0 ? 0 : v;
  const cell1 = (v) => { if (!v) return ''; const cls = v > 0 ? 'tt-pos' : 'tt-neg'; return `<span class="${cls}">${v > 0?'+':''}${v}</span>`; };
  let html = `<div class="tt-title">${t.name}</div>`;
  const showTirT = selectedUnit?.range > 1;
  html += ttGrid([
    ['Attaque',      t.attack_cac,      t.attack_tir],
    ['Défense',      t.defense_cac,     t.defense_tir],
    ['Puissance',    t.puissance_cac,   t.puissance_tir],
    ['Intimidation', t.intimidation_cac,t.intimidation_tir],
    ['Esquive',      t.esquive_cac,     t.esquive_tir],
    ['Précision',    t.precision_cac,   t.precision_tir],
  ], showTirT);
  if (t.vitesse !== 0) html += `<div class="tt-extra">${cell1(t.vitesse)} Vitesse</div>`;
  if (t.armure  !== 0) html += `<div class="tt-extra">${cell1(t.armure)} Armure</div>`;
  return html;
}

function buildSegmentTooltip(segType) {
  const s = SEGMENT_DEFS_CLIENT[segType];
  if (!s) return '';
  const cell1 = (v) => { if (!v) return ''; const cls = v > 0 ? 'tt-pos' : 'tt-neg'; return `<span class="${cls}">${v > 0?'+':''}${v}</span>`; };
  let html = `<div class="tt-title">${s.name}</div>`;
  html += ttGrid([
    ['Attaque',   s.attack_cac,   s.attack_tir],
    ['Défense',   s.defense_cac,  s.defense_tir],
    ['Puissance', s.puissance_cac,s.puissance_tir],
  ], selectedUnit?.range > 1);
  if (s.infranchissable)           html += `<div class="tt-extra"><span class="tt-neg">Infranchissable</span></div>`;
  if (s.infranchissable_cavalerie) html += `<div class="tt-extra"><span class="tt-neg">Cavalerie bloquée</span></div>`;
  if (s.vitesse_fixe != null)      html += `<div class="tt-extra"><span class="tt-neg">Coûte ${s.vitesse_fixe} vitesse</span></div>`;
  else if (s.vitesse !== 0)        html += `<div class="tt-extra">${cell1(s.vitesse)} Vitesse</div>`;
  if (s.special) html += `<div class="tt-extra" style="color:#c8a040;font-style:italic">${s.special}</div>`;
  return html;
}

function distPointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function getNearestSegment(worldX, worldY) {
  const threshold = HEX_SIZE * 0.25;
  let best = null, bestDist = threshold;
  for (const [edgeKey, segType] of Object.entries(segmentData)) {
    const parts = edgeKey.split('|');
    const [q1, r1] = parts[0].split(',').map(Number);
    const [q2, r2] = parts[1].split(',').map(Number);
    const dq = q2 - q1, dr = r2 - r1;
    const dirIdx = SEGMENT_EDGE_DIRS.findIndex(([d0, d1]) => d0 === dq && d1 === dr);
    if (dirIdx === -1) continue;
    const { x: cx, y: cy } = hexToPixel(q1, r1);
    const corners = hexCorners(cx, cy);
    const c1 = corners[dirIdx], c2 = corners[(dirIdx + 1) % 6];
    const d = distPointToSegment(worldX, worldY, c1.x, c1.y, c2.x, c2.y);
    if (d < bestDist) { bestDist = d; best = segType; }
  }
  return best;
}

function showTerrainTooltip(content, e) {
  const tt = document.getElementById('terrain-tooltip');
  if (!tt) return;
  tt.innerHTML = content;
  tt.style.display = 'block';
  const x = e.clientX + 14, y = e.clientY - 8;
  tt.style.left = Math.min(x, window.innerWidth - tt.offsetWidth - 8) + 'px';
  tt.style.top = Math.max(8, Math.min(y, window.innerHeight - tt.offsetHeight - 8)) + 'px';
}

function hideTerrainTooltip() {
  const tt = document.getElementById('terrain-tooltip');
  if (tt) tt.style.display = 'none';
}

function buildStanceTooltip(stanceId) {
  const s = STANCES_DATA[stanceId];
  if (!s) return '';
  const isRanged = selectedUnit?.range > 1;
  const cell1 = (v) => { if (!v) return ''; const cls = v > 0 ? 'tt-pos' : 'tt-neg'; return `<span class="${cls}">${v > 0?'+':''}${v}</span>`; };
  let html = `<div class="tt-title">${stanceNames[stanceId] || stanceId}</div>`;
  html += ttGrid([
    ['Attaque',      s.attack_cac,       s.attack_tir],
    ['Défense',      s.defense_cac,      s.defense_tir],
    ['Puissance',    s.puissance_cac,    s.puissance_tir],
    ['Intimidation', s.intimidation_cac, s.intimidation_tir],
    ['Esquive',      s.esquive_cac,      s.esquive_tir],
    ['Précision',    s.precision_cac,    s.precision_tir],
  ], isRanged);
  if (s.vitesse    !== 0) html += `<div class="tt-extra">${cell1(s.vitesse)} Vitesse</div>`;
  if (s.armure     !== 0) html += `<div class="tt-extra">${cell1(s.armure)} Armure</div>`;
  if (s.moral_tour !== 0) html += `<div class="tt-extra">${cell1(s.moral_tour)} Moral/tour</div>`;
  return html;
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
  if (log.abilityUsed) {
    el.innerHTML = `<b>${escapeHtml(log.abilityUsed)}</b><br>${(log.effects || []).map(escapeHtml).join('<br>')}`;
    el.style.display = 'block';
    clearTimeout(window._combatResultTimer);
    window._combatResultTimer = setTimeout(() => { el.style.display = 'none'; }, 5000);
    return;
  }
  if (log.duel) {
    const name = (id) => (id === log.attackerId ? log.attackerName : id === log.targetId ? log.targetName : 'Unité inconnue');
    let html = `<b>Duel : ${escapeHtml(log.attackerName)} contre ${escapeHtml(log.targetName)}</b><br>`;
    log.duel.rounds.forEach((rd, i) => {
      html += `Passe ${i + 1} : ${rd.attackerRoll} contre ${rd.defenderRoll} → ${rd.attacker ? `${escapeHtml(name(rd.attacker))} frappe (${rd.dmg})` : 'parade'}<br>`;
    });
    html += log.duel.winnerId ? `<b style="color:#ffd700">${escapeHtml(name(log.duel.winnerId))} remporte le duel !</b>` : '<b>Duel indécis</b>';
    if (log.generalKilled) html += `<br><span style="color:#f84">${escapeHtml(log.eliminatedPlayer || '')} perd son général !</span>`;
    else if (log.duel.stunned) html += `<br><span style="color:#e0a060">Le vaincu est sonné, son armée vacille.</span>`;
    el.innerHTML = html;
    el.style.display = 'block';
    clearTimeout(window._combatResultTimer);
    window._combatResultTimer = setTimeout(() => { el.style.display = 'none'; }, 7000);
    return;
  }
  let html = `<b>${log.attackerName}</b> attaque <b>${log.targetName}</b><br>`;
  const bk = log.breakdown || {};
  const roll = bk.generalD20 != null ? `Force − d20 (${bk.generalD20}) + 80 = ${bk.generalAttValue}` : bk.NGOAtt != null ? `${bk.attReussite} réussites / ${bk.NGOAtt} dés` : '';
  html += `Attaque${roll ? ` : ${roll}` : ''} → ${log.hit ? '<span style="color:#4f4">TOUCHÉ</span>' : '<span style="color:#f44">RATÉ</span>'}<br>`;
  if (log.hit) {
    html += `Vitalité −<b>${log.dmgReceived}</b>${bk.ratARDef != null ? ` (armure : ${Math.round(bk.ratARDef * 100)} % passent)` : ''}<br>`;
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
  if (Array.isArray(data.options)) {
    if (btnCounter) btnCounter.style.display = data.options.includes('counter') ? '' : 'none';
    if (btnAbsorb) btnAbsorb.style.display = data.options.includes('absorb') ? '' : 'none';
  } else if (data.isRanged) {
    if (btnCounter) btnCounter.style.display = 'none';
    if (btnAbsorb) btnAbsorb.style.display = data.targetTypeId === 'phalange' ? '' : 'none';
  } else {
    if (btnCounter) btnCounter.style.display = '';
    if (btnAbsorb) btnAbsorb.style.display = '';
  }
  // Countdown
  let t = data.seconds || 20;
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

const disconnectToasts = {};

function renderSpectatorBar() {
  const players = gameState?.players || deployState?.players || [];
  const specs = gameState?.spectators || deployState?.spectators || [];
  let bar = document.getElementById('presence-bar');
  if (!bar) {
    bar = document.createElement('span');
    bar.id = 'presence-bar';
    bar.style.cssText = 'font-size:0.9em;color:#a89060;white-space:nowrap';
    const top = document.getElementById('top-bar');
    top.insertBefore(bar, document.getElementById('top-phase'));
  }
  const offline = players.filter(p => p.connected === false && !p.isEliminated);
  const parts = [];
  if (offline.length) parts.push(`<span style="color:#e0a030" title="Hors ligne">${offline.map(p => escapeHtml(p.name)).join(', ')} hors ligne</span>`);
  if (specs.length) parts.push(`<span title="${specs.map(s => escapeHtml(s.name)).join(', ')}">${specs.length} spectateur${specs.length > 1 ? 's' : ''}</span>`);
  bar.innerHTML = parts.join(' · ');
  const dl = gameState?.turnDeadline;
  if (dl && gameState.phase === 'battle') {
    const cur = players.find(p => p.id === gameState.currentPlayerId);
    if (cur && cur.connected === false) bar.innerHTML += ` · <span style="color:#e0a030">tour de ${escapeHtml(cur.name)} passé automatiquement s'il ne revient pas</span>`;
  }
  if (isSpectator) {
    const actions = document.getElementById('global-action-bar');
    if (actions) actions.style.display = 'none';
    const ap = document.getElementById('action-panel');
    if (ap) ap.style.display = 'none';
  }
}

function applyPresence(data) {
  for (const st of [gameState, deployState]) {
    if (!st) continue;
    st.players = (st.players || []).map(p => ({ ...p, ...(data.players.find(x => x.id === p.id) || {}) }));
    st.spectators = data.spectators;
  }
  renderSpectatorBar();
  if (gameState) renderTurnOrder(gameState.turnOrder, gameState.initiativeRolls, gameState.currentPlayerId);
}

function leaveGame() {
  wsSend('leave_room');
  KBNet.clearSession();
  setTimeout(() => { window.location.href = '/'; }, 150);
}

function enterDeployMode() {
  if (mode === 'deploy') return;
  mode = 'deploy';
  setMode('deploy');
  document.getElementById('sidebar-title').textContent = 'Déploiement';
  if (deployState.startingZone) {
    const { x, y } = hexToPixel(deployState.startingZone.q, deployState.startingZone.r);
    if (cameraPlaced) smoothPanTo(x, y, 600);
    else { camX = -x * zoom; camY = -y * zoom; }
    if (window.view3d && window.view3d.active) focusDeployZone(true);
    cameraPlaced = true;
  }
}

// Brings the deployment zone into view (2D and 3D) when it is off screen, or always with force
function focusDeployZone(force = false) {
  const z = deployState?.startingZone;
  if (!z || z.q == null) return;
  const v3 = window.view3d && window.view3d.active ? window.view3d : null;
  if (v3) {
    if (!force && v3.hexOnScreen(z.q, z.r)) return;
    v3.focusHex(z.q, z.r);
    if (v3.pingHex) v3.pingHex(z.q, z.r, '#8cff5a');
    return;
  }
  const { x, y } = hexToPixel(z.q, z.r);
  const sx = x * zoom + camX + canvas.width / 2, sy = y * zoom + camY + canvas.height / 2;
  const mx = canvas.width * 0.12, my = canvas.height * 0.12;
  if (!force && sx > mx && sx < canvas.width - mx && sy > my && sy < canvas.height - my) return;
  smoothPanTo(x, y, 600);
}

function initGame() {
  if (!initialSession) {
    window.location.href = '/';
    return;
  }
  KBNet.mountIndicator();
  let wasDown = false;
  KBNet.connect({
    onEvent: wsDispatch,
    onStatus: (st) => {
      if (st === 'reconnecting' && !wasDown) { wasDown = true; notify('Connexion perdue, reconnexion…', 'info'); }
      if (st === 'connected' && wasDown) { wasDown = false; notify('Connexion rétablie.', 'success'); }
      if (st === 'replaced') notify('Cette partie est ouverte dans un autre onglet.', 'error');
    },
  });
}

function wsDispatch(event, data) {
  if (window.KBSim && KBSim.intercept(event, data)) return;
  if (window.view3d) window.view3d.onEvent(event, data);
  if (window.gameEventHooks) for (const h of window.gameEventHooks) { try { h(event, data); } catch (e) { console.warn(e); } }
  switch (event) {
    case 'session':
      myId = data.playerId;
      roomCode = data.roomCode;
      isSpectator = data.role === 'spectator';
      break;
    case 'room_update':
      if (data.phase === 'lobby' || data.phase === 'army_building') { window.location.href = '/'; return; }
      if (data.mapId) ensureMap(data.mapId);
      break;
    case 'deployment_state': {
      if (data.mapId) ensureMap(data.mapId);
      myId = data.myId;
      gameState = null;
      deployState = data;
      buildZoneTileSet(deployState);
      enterDeployMode();
      if (data.isReady) setDeployReadyButtons('En attente des autres joueurs…', true);
      renderDeployUnitList(data.units);
      renderSpectatorBar();
      updateActionButtons();
      render();
      break;
    }
    case 'phase_change': {
      if (data.mapId) ensureMap(data.mapId);
      if (data.phase === 'battle') {
        deployState = null;
        mode = 'select';
        setMode('select');
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
      if (data.mapId) ensureMap(data.mapId);
      myId = data.myId;
      isSpectator = !!data.isSpectator;
      if (data.phase !== 'deployment') { deployState = null; if (mode === 'deploy') setMode('select'); }
      if (data.balanceTables) applyBalanceTables(data.balanceTables);
      else if (gameState?.balanceTables) data.balanceTables = gameState.balanceTables;
      const editsChanged = JSON.stringify(gameState?.mapEdits || null) !== JSON.stringify(data.mapEdits || null);
      gameState = data;
      gameState.visibleHexes = new Set(data.visibleHexes);
      if (editsChanged) applyMapEdits();
      renderTopInfo();
      renderSpectatorBar();
      if (data.phase === 'ended' && data.winner !== undefined) document.getElementById('btn-end-turn-center').style.display = 'none';

      renderTopInfo();
      const currPlayer = data.players.find(p => p.id === data.currentPlayerId);
      document.getElementById('top-current-player').textContent =
        data.phase === 'deployment' ? 'Déploiement en cours' : data.currentPlayerId === myId ? 'Votre manche' : `Manche de : ${currPlayer?.name || '?'}`;
      document.getElementById('top-phase').textContent = isSpectator ? 'Spectateur' : data.phase === 'battle' ? 'Bataille' : data.phase === 'deployment' ? 'Déploiement' : data.phase === 'ended' ? 'Terminée' : '';
      if (!cameraPlaced && data.units.length) {
        const focus = data.units.find(u => u.isMine && u.isGeneral) || data.units[0];
        const { x, y } = hexToPixel(focus.q, focus.r);
        camX = -x * zoom; camY = -y * zoom;
        cameraPlaced = true;
      }
      document.getElementById('sidebar-title').textContent = isSpectator ? 'Spectateur'
        : data.currentPlayerId === myId ? 'Votre manche' : `Manche de ${currPlayer?.name || '?'}`;

      if (selectedUnit) {
        const updated = data.myUnits.find(u => u.id === selectedUnit.id);
        if (updated) {
          selectedUnit = updated;
          showUnitDetail(updated);
          renderStancePanel(updated);
          movableTiles.clear();
          attackableTiles.clear();
          rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
          if (data.currentPlayerId === myId && updated.speedRemaining > 0 && !updated.isFleeing) {
            computeMovableTiles(updated);
          }
          if (data.currentPlayerId === myId && !updated.hasAttacked && !updated.isFleeing) {
            computeAttackableTiles(updated);
          }
          if (updated.range > 1) {
            computeRangeTiles(updated);
          }
        } else { selectedUnit = null; movableTiles.clear(); attackableTiles.clear(); rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null; showUnitDetail(null); renderStancePanel(null); }
      }

      renderTurnOrder(data.turnOrder, data.initiativeRolls, data.currentPlayerId);
      renderUnitList();
      updateActionButtons();
      render();
      if (window.KBSim) KBSim.onState(data);
      if (pendingTurnPopup && pendingTurnPopup.playerId === data.currentPlayerId) {
        const ptp = pendingTurnPopup;
        pendingTurnPopup = null;
        const showPopup = () => {
          const ptpPlayer = gameState?.players.find(p => p.id === ptp.playerId);
          const ptpColor = ptpPlayer?.color || '#ffd700';
          const ptpName = ptp.playerId === myId ? 'Votre manche !' : `Manche de ${ptpPlayer?.name || '?'}`;
          const ptpSub = `Tour ${ptp.turn} · Manche ${ptp.manche || 1}`;
          if (ptp.playerId === myId) {
            const myGeneral = gameState?.units?.find(u => u.playerId === myId && u.isGeneral);
            if (myGeneral) { const { x, y } = hexToPixel(myGeneral.q, myGeneral.r); smoothPanTo(x, y); }
            const canAct = gameState?.units?.some(u => u.playerId === myId && (u.speedRemaining > 0 || !u.hasAttacked));
            if (canAct) showTurnPopup(ptpName, ptpSub, ptpColor);
          } else {
            showTurnPopup(ptpName, ptpSub, ptpColor);
          }
        };
        const initiativeOpen = document.getElementById('overlay-initiative').style.display !== 'none';
        if (ptp.newRound && initiativeOpen) {
          window._pendingTurnPopupAfterInitiative = showPopup;
        } else {
          showPopup();
        }
      }
      break;
    }
    case 'turn_change': {
      if (gameState) {
        gameState.currentPlayerId = data.currentPlayerId;
        gameState.turn = data.turn;
        if (data.timeOfDay != null) Object.assign(gameState, { timeOfDay: data.timeOfDay, isNight: data.isNight, day: data.day, turnEndsAt: data.turnEndsAt });
        renderTopInfo();
      }
      document.getElementById('overlay-confirm-end').style.display = 'none';
      selectedUnit = null;
      movableTiles.clear();
      attackableTiles.clear();
      rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
      updateActionButtons();
      pendingTurnPopup = { playerId: data.currentPlayerId, turn: data.turn, manche: data.manche, newRound: data.manche === 1 };
      break;
    }
    case 'initiative_rolled':
      showInitiativeModal(data.rolls, data.turnOrder, data.turn);
      break;
    case 'map_edit': {
      const SEG = { bridge: 'un pont', passerelle: 'une passerelle', barriere: 'une barrière', chevaux_de_frise: 'des chevaux de frise', echelle: 'une échelle', river: 'la rivière', cliff: 'la falaise' };
      let text;
      if (data.kind === 'sabotage') text = `Sabotage : ${SEG[data.from] || 'une infrastructure'} détruit${data.from === 'barriere' || data.from === 'passerelle' || data.from === 'echelle' ? 'e' : ''}.`;
      else if (data.kind === 'bruler') text = 'Une forêt part en fumée.';
      else text = `Construction : ${SEG[data.to] || data.to}.`;
      notify(text, 'info');
      break;
    }
    case 'combat_result': {
      const log = data.combatLog || data;
      addCombatLog(log);
      showCombatResult(log);
      if (!log.abilityUsed) addCombatHistory(log, gameState?.turn || 1);
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
      if (el) { el.innerHTML = `En attente de la réponse du défenseur… (${data.seconds || 20} s max)`; el.style.display = 'block'; }
      break;
    }
    case 'units_fled': {
      const el = document.getElementById('combat-result-box');
      if (el && data.fled.length > 0) {
        el.innerHTML = data.fled.map(f => `&#127939; ${escapeHtml(f.unitName)} a fui !`).join('<br>');
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 4000);
      }
      break;
    }
    case 'game_over':
      showRecap(data);
      break;
    case 'replay_chunk':
      onReplayChunk(data);
      break;
    case 'ambush': {
      const mine = data.byPlayerId === myId;
      notify(mine ? 'Embuscade ! Une de vos unités cachées a surpris l\'ennemi.' : 'Embuscade ! Votre unité est tombée sur un ennemi caché.', mine ? 'success' : 'error');
      activePings.push({ q: data.q, r: data.r, color: '#ff4020', startTime: performance.now() });
      render();
      break;
    }
    case 'objective_captured': {
      const who = gameState?.players.find(p => p.id === data.owner);
      notify(`${who?.name || '?'} s'empare de ${data.name}.`, data.owner === myId ? 'success' : 'info');
      if (gameState) { const o = (gameState.objectives || []).find(x => x.id === data.objectiveId); if (o) o.owner = data.owner; }
      activePings.push({ q: data.q, r: data.r, color: who?.color || '#ffd700', startTime: performance.now() });
      render();
      break;
    }
    case 'time_change':
      notify(data.isNight ? `La nuit tombe (${KBRules.formatHour(data.timeOfDay)}) : vision et vitesse réduites.` : `Le jour se lève (${KBRules.formatHour(data.timeOfDay)}).`, 'info');
      break;
    case 'duel_challenge':
      notify(`${data.attackerName} défie ${data.targetName} en duel !`, 'error');
      break;
    case 'deployment_ready_update': {
      if (!isSpectator) notify(`${data.readyCount}/${data.total} joueurs prêts…`, 'info');
      const meReady = (data.readyIds || []).includes(myId);
      if (deployState) deployState.isReady = meReady;
      setDeployReadyButtons(meReady ? `En attente… (${data.readyCount}/${data.total} prêts)` : `Prêt ! (${data.readyCount}/${data.total})`, meReady);
      break;
    }
    case 'motivate_result':
      if (data.critSuccess) {
        notify(`Motivation critique ! (D20 = 1) → ${data.count} unité(s) retrouvent tout leur moral et cessent de fuir.`, 'success');
      } else if (data.critFail) {
        notify(`Motivation désastreuse (D20 = 20) : ${data.count} unité(s) perdent 20 de moral.`, 'error');
      } else if (data.success) {
        notify(`Motivation réussie ! (Charisme ${data.charisma} ≥ D20 ${data.d20}) → ${data.count} unité(s) regagnent ${data.moralGain} moral.`, 'success');
      } else {
        notify(`Motivation échouée. (Charisme ${data.charisma} < D20 ${data.d20})`, 'info');
      }
      break;
    case 'chat_history':
      document.getElementById('chat-messages').innerHTML = '';
      for (const m of data.messages || []) appendChatMessage({ ...m, isMine: m.authorId === myId });
      document.getElementById('tab-chat').classList.remove('unread');
      break;
    case 'chat_message':
      appendChatMessage({ authorName: data.authorName, text: data.text, isMine: data.authorId === myId, authorId: data.authorId, isSpectator: data.isSpectator });
      break;
    case 'ping': {
      activePings.push({ q: data.q, r: data.r, color: data.color || '#ffd700', startTime: performance.now() });
      render();
      break;
    }
    case 'presence':
      applyPresence(data);
      break;
    case 'player_disconnected':
      if (data.playerId === myId) break;
      clearTimeout(disconnectToasts[data.playerId]);
      disconnectToasts[data.playerId] = setTimeout(() => {
        notify(`${data.name || 'Un joueur'} s'est déconnecté${data.role === 'spectator' ? ' (spectateur)' : ''}.`, 'info');
      }, 4000);
      break;
    case 'player_reconnected':
      if (disconnectToasts[data.playerId]) { clearTimeout(disconnectToasts[data.playerId]); delete disconnectToasts[data.playerId]; }
      else notify(`${data.name || 'Un joueur'} est de retour.`, 'success');
      break;
    case 'player_left':
      notify(`${data.name} ${data.reason === 'abandon' ? 'a abandonné (absence prolongée)' : 'a quitté la partie'}.`, 'info');
      break;
    case 'turn_auto_ended': {
      const why = { no_actions: 'plus aucune action possible', timer: 'temps écoulé', absent: 'joueur absent' }[data.reason] || 'joueur absent';
      notify(data.playerId === myId ? `Fin de votre tour (${why}).` : `Tour de ${data.name} terminé (${why}).`, 'info');
      break;
    }
    case 'spectator_joined':
      notify(`${data.name} regarde la partie.`, 'info');
      break;
    case 'error':
      if (data.sessionLost) {
        notify('Partie introuvable ou session expirée.');
        setTimeout(() => { window.location.href = '/'; }, 1500);
        break;
      }
      if (data.code === 'not_your_turn' && data.action === 'end_turn') break;
      if (data.action === 'get_replay' && replayWindow) { if (!replayWindow.closed) replayWindow.close(); replayWindow = null; }
      notify(data.message || String(data));
      break;
  }
}

// ---- 3D VIEW BRIDGE ----
window.gameBridge = {
  get state() { return gameState; },
  get mapDoc() { return mapDoc; },
  get mapLoading() { return mapLoading; },
  get deployState() { return deployState; },
  get myId() { return myId; },
  get mode() { return mode; },
  get selectedUnit() { return selectedUnit; },
  get movableTiles() { return movableTiles; },
  get abilityTiles() { return abilityTiles; },
  get unitTypes() { return UNIT_TYPES; },
  get mapEdits() { return gameState ? gameState.mapEdits || null : null; },
  get attackableTiles() { return attackableTiles; },
  approachAt,
  // Approach + strike preview against target: { q, r, path: [[q, r]...] (origin included) } or null
  approachTo(unit, target) {
    if (!unit || !target) return null;
    if (window.KBSim && KBSim.active()) return KBSim.approachTo(unit, target);
    return approachAt(`${target.q},${target.r}`);
  },
  get rangeTiles() { return rangeTiles; },
  get rangeCenter() { return rangeCenter; },
  get motivateTiles() { return motivateTiles; },
  get motivateCenter() { return motivateCenter; },
  get showTerrain() { return showTerrain; },
  get terrainData() { return terrainData; },
  get pingMode() { return pingMode; },
  unitAnimations,
  ANIM_STEP_MS,
  stanceIcons,
  unitTokenImages,
  generalTokenImages,
  getGeneralIdForUnit,
  getPlayerColor,
  hexFacingClient,
  setHoveredHex(h) { hoveredHex = h; },
  click(hex) {
    if (!hex) return;
    if (pingMode) { if (roomCode) wsSend('ping', { roomCode, q: hex.q, r: hex.r }); return; }
    handleHexClick(hex);
  },
  doubleClick(hex) {
    const units = gameState?.units || deployState?.units || [];
    const unit = units.find(u => u.q === hex.q && u.r === hex.r);
    if (unit) showUnitCard(unit);
  },
  contextMenu(hex, clientX, clientY) {
    if (window.KBSim && KBSim.active()) { KBSim.contextMenu(hex, clientX, clientY); return; }
    if (gameState?.phase !== 'battle' || gameState?.currentPlayerId !== myId || !hex) return;
    const unit = gameState.units.find(u => u.q === hex.q && u.r === hex.r && u.isMine);
    if (!unit) return;
    if (unit.speedRemaining <= 0) { notify('Plus de vitesse disponible.', 'info'); return; }
    showFacingPopup(unit, clientX, clientY);
  },
  hover(hex, e) {
    hoveredHex = hex;
    if (showTerrain && hex && e) showTerrainTooltip(buildTerrainTooltip(terrainData[`${hex.q},${hex.r}`] || 'plain'), e);
    else hideTerrainTooltip();
  },
  redraw2D() { resizeCanvas(); },
  panToHex(q, r) { const p = hexToPixel(q, r); smoothPanTo(p.x, p.y); },
  hexOnScreen2D(q, r, margin = 0.12) {
    const p = hexToPixel(q, r);
    const sx = canvas.width / 2 + camX + p.x * zoom, sy = canvas.height / 2 + camY + p.y * zoom;
    const mx = canvas.width * margin, my = canvas.height * margin;
    return sx >= mx && sx <= canvas.width - mx && sy >= my && sy <= canvas.height - my;
  },
  pathTo(unit, tq, tr) {
    if (window.KBSim && KBSim.active()) return KBSim.pathTo(unit, tq, tr);
    if (!unit || unit.q == null) return null;
    const target = `${tq},${tr}`;
    if (!movableTiles.has(target)) return null;
    const { dist, prev } = clientReachable(unit);
    const path = KBRules.pathFromPrev(prev, `${unit.q},${unit.r}`, target);
    if (!path) return null;
    path.unshift([unit.q, unit.r]);
    return { path, cost: dist.get(target) };
  },
  // Simultaneous mode (public/js/simultaneous.js): planning, my planned orders, playback of the resolution
  get simultaneous() { return !!(window.KBSim && KBSim.isSim()); },
  get planning() { return window.KBSim ? KBSim.planning() : null; },
  get plannedOrders() { return window.KBSim ? KBSim.plannedOrders() : []; },
  get playback() { return window.KBSim ? KBSim.playbackInfo() : null; },
  segmentAt(q1, r1, q2, r2) {
    const t = segmentData[segmentEdgeKey(q1, r1, q2, r2)];
    return t || null;
  },
  segmentTooltip(segType, e) { showTerrainTooltip(buildSegmentTooltip(segType), e); },
  deselect() {
    if (mode === 'deploy' || !selectedUnit) return;
    selectedUnit = null;
    movableTiles.clear(); attackableTiles.clear();
    rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
    updateActionButtons();
    showUnitDetail(null);
    render();
  },
};

// Init
resizeCanvas();
initGame();
