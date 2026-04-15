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
mapImage.src = '/assets/img/map.webp';

// Chargement des terrains
let terrainData = {};
let showTerrain = false;
let showCoords = false;
let showWeakness = false;
let pingMode = false;

// facing idx → {dq, dr, label}
const FACING_DIRS = [
  { dq:  1, dr:  0, label: '↘' }, // 0 SE
  { dq:  1, dr: -1, label: '↗' }, // 1 NE
  { dq:  0, dr: -1, label: '↑'  }, // 2 N
  { dq: -1, dr:  0, label: '↖' }, // 3 NW
  { dq: -1, dr:  1, label: '↙' }, // 4 SW
  { dq:  0, dr:  1, label: '↓'  }, // 5 S
];
const activePings = []; // { q, r, color, startTime }
let gridOpacity = 0.25;
let gridThickness = 1;
let gridColorRGB = '180,140,60';
fetch('/data/terrain.json').then(r => r.json()).then(d => { terrainData = d; render(); }).catch(() => {});

// Chargement des segments
let segmentData = {};
fetch('/data/segments.json').then(r => r.json()).then(d => { segmentData = d; render(); }).catch(() => {});

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
  river:            { name:'Rivière',          vitesse:-1,  infranchissable:false, infranchissable_cavalerie:false, attack_cac:-2, attack_tir:0, puissance_cac:-2, puissance_tir:0, intimidation_cac:-1, intimidation_tir:0, armure_cac:-1, armure_tir:0, defense_cac:2, defense_tir:0, defense_puissance_cac:0, defense_puissance_tir:1, defense_intimidation_cac:-1, defense_intimidation_tir:1, defense_armure_cac:0, defense_armure_tir:0, special:null },
  cliff:            { name:'Falaise',           vitesse:-3,  infranchissable:true,  infranchissable_cavalerie:true,  attack_cac:-6, attack_tir:0, puissance_cac:-3, puissance_tir:0, intimidation_cac:-2, intimidation_tir:0, armure_cac:-2, armure_tir:0, defense_cac:4, defense_tir:0, defense_puissance_cac:0, defense_puissance_tir:3, defense_intimidation_cac:-2, defense_intimidation_tir:1, defense_armure_cac:2, defense_armure_tir:0, special:null },
  bridge:           { name:'Pont',              vitesse:0,   infranchissable:false, infranchissable_cavalerie:false, attack_cac:0,  attack_tir:0, puissance_cac:0,  puissance_tir:0, intimidation_cac:0,  intimidation_tir:0, armure_cac:0,  armure_tir:0, defense_cac:2, defense_tir:2, defense_puissance_cac:0, defense_puissance_tir:0, defense_intimidation_cac:0,  defense_intimidation_tir:0, defense_armure_cac:0, defense_armure_tir:0, special:null },
  passerelle:       { name:'Passerelle',        vitesse:0,   infranchissable:false, infranchissable_cavalerie:false, attack_cac:-1, attack_tir:0, puissance_cac:0,  puissance_tir:0, intimidation_cac:0,  intimidation_tir:0, armure_cac:0,  armure_tir:0, defense_cac:1, defense_tir:0, defense_puissance_cac:0, defense_puissance_tir:1, defense_intimidation_cac:0,  defense_intimidation_tir:1, defense_armure_cac:0, defense_armure_tir:0, special:null },
  barriere:         { name:'Barrière',          vitesse:-1,  infranchissable:false, infranchissable_cavalerie:false, attack_cac:-2, attack_tir:0, puissance_cac:-1, puissance_tir:0, intimidation_cac:-1, intimidation_tir:0, armure_cac:-1, armure_tir:0, defense_cac:2, defense_tir:0, defense_puissance_cac:0, defense_puissance_tir:-1, defense_intimidation_cac:-1, defense_intimidation_tir:1, defense_armure_cac:1, defense_armure_tir:2, special:null },
  chevaux_de_frise: { name:'Chevaux de frise',  vitesse:-1,  infranchissable:false, infranchissable_cavalerie:false, attack_cac:-3, attack_tir:0, puissance_cac:-2, puissance_tir:0, intimidation_cac:-2, intimidation_tir:0, armure_cac:-2, armure_tir:0, defense_cac:3, defense_tir:0, defense_puissance_cac:0, defense_puissance_tir:-1, defense_intimidation_cac:-2, defense_intimidation_tir:1, defense_armure_cac:2, defense_armure_tir:2, puissance_vs_cavalry:5, special:null },
  mur:              { name:'Mur',               vitesse:0,   infranchissable:true,  infranchissable_cavalerie:false, attack_cac:0,  attack_tir:0, puissance_cac:0,  puissance_tir:0, intimidation_cac:0,  intimidation_tir:0, armure_cac:0,  armure_tir:0, defense_cac:0, defense_tir:0, defense_puissance_cac:0, defense_puissance_tir:0, defense_intimidation_cac:0,  defense_intimidation_tir:0, defense_armure_cac:0, defense_armure_tir:0, special:null },
  echelle:          { name:'Échelle',           vitesse:-2,  infranchissable:false, infranchissable_cavalerie:true,  attack_cac:-4, attack_tir:0, puissance_cac:-2, puissance_tir:0, intimidation_cac:-2, intimidation_tir:0, armure_cac:-2, armure_tir:0, defense_cac:3, defense_tir:0, defense_puissance_cac:0, defense_puissance_tir:3, defense_intimidation_cac:-2, defense_intimidation_tir:1, defense_armure_cac:2, defense_armure_tir:0, special:null },
};

function segmentEdgeKey(q1, r1, q2, r2) {
  if (q1 < q2 || (q1 === q2 && r1 < r2)) return `${q1},${r1}|${q2},${r2}`;
  return `${q2},${r2}|${q1},${r1}`;
}

// Images pour segments construits
const chevauxDeFriseImage = new Image();
chevauxDeFriseImage.src = '/assets/elements/ChevalDeFrise_sfb_hrc.png';
chevauxDeFriseImage.onload = () => render();
const ladderImage = new Image();
ladderImage.src = '/assets/elements/ladder.png';
ladderImage.onload = () => render();

function drawSegments(ctx, withColors) {
  if (Object.keys(segmentData).length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  const hd = gameState?.heightData || {};
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
    const edgeLen = Math.hypot(c2.x - c1.x, c2.y - c1.y);
    const mx = (c1.x + c2.x) / 2, my = (c1.y + c2.y) / 2;

    // Chevaux de frise — PNG pleine largeur ×1.5
    if (segType === 'chevaux_de_frise' && chevauxDeFriseImage.complete && chevauxDeFriseImage.naturalWidth) {
      const drawW = edgeLen * 1.5;
      const drawH = chevauxDeFriseImage.naturalHeight / chevauxDeFriseImage.naturalWidth * drawW;
      const angle = Math.atan2(c2.y - c1.y, c2.x - c1.x);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.drawImage(chevauxDeFriseImage, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();
      if (withColors) {
        const color = SEGMENT_COLORS_MAP[segType];
        if (color) { ctx.strokeStyle = color; ctx.lineWidth = HEX_SIZE * 0.07; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.stroke(); ctx.globalAlpha = 1; }
      }
      continue;
    }

    // Échelle — PNG perpendiculaire, top vers hex le plus haut, largeur ×1.5
    if (segType === 'echelle' && ladderImage.complete && ladderImage.naturalWidth) {
      const h1 = hd[`${q1},${r1}`] || 0;
      const h2 = hd[`${q2},${r2}`] || 0;
      const { x: hx1, y: hy1 } = hexToPixel(q1, r1);
      const { x: hx2, y: hy2 } = hexToPixel(q2, r2);
      // Direction vers le hex le plus élevé (top du PNG)
      const topHexX = (h2 >= h1) ? hx2 : hx1;
      const topHexY = (h2 >= h1) ? hy2 : hy1;
      const toTopAngle = Math.atan2(topHexY - my, topHexX - mx);
      const imgW = edgeLen * 0.675; // 0.45 × 1.5
      const imgH = edgeLen * 1.1;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(toTopAngle + Math.PI / 2);
      ctx.drawImage(ladderImage, -imgW / 2, -imgH / 2, imgW, imgH);
      ctx.restore();
      if (withColors) {
        const color = SEGMENT_COLORS_MAP[segType];
        if (color) { ctx.strokeStyle = color; ctx.lineWidth = HEX_SIZE * 0.07; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.stroke(); ctx.globalAlpha = 1; }
      }
      continue;
    }

    // Autres segments — ligne colorée uniquement en mode terrain
    if (!withColors) continue;
    const color = SEGMENT_COLORS_MAP[segType];
    if (!color) continue;
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

// Données des généraux (pour les capacités)
const GENERALS_GAME_DATA = [
  { id:'ou_ki',       activeAbility:{name:'Sourire du Monstre',description:"Augmente la puissance de l'armée de 2 pendant 2 tours. Si l'armée ennemie est en infériorité numérique, réduit le moral de chaque unité adverse de 1.",cooldown:3}, passiveAbility:{name:'Oiseau Colossale',description:"Les généraux ennemis ont -3 en Force, Stratégie et Charisme. Les unités de l'armée d'Ou Ki ont +1 d'intimidation."} },
  { id:'mou_bu',      activeAbility:{name:'Poing du Titan',description:"Réduit l'armure d'une armée ennemie de 1 pendant 2 tours. Les unités ciblées éliminées octroient +1 de puissance à l'unité jusqu'à la fin de la journée.",cooldown:3}, passiveAbility:{name:'Force Inégalée',description:"Augmente la puissance des unités de l'armée de Mou Bu de 1."} },
  { id:'ou_sen',      activeAbility:{name:"L'Architecte de la Guerre",description:"Réduit l'attaque et la vitesse d'une armée ennemie de 2 pendant 3 tours, et augmente la portée des unités à distance de l'armée de 200m pendant 2 tours.",cooldown:4}, passiveAbility:{name:'Forteresse Imprenable',description:"Les unités de l'armée d'Ou Sen gagnent 2 d'armure et subissent 1 d'intimidation en moins en position défensive."} },
  { id:'kan_ki',      activeAbility:{name:'Tactiques Infernales',description:"Choisit 3 unités qui peuvent se déployer n'importe où sur le champ de bataille. Ces unités gagnent 2 de puissance et 1 d'intimidation pour la journée.",cooldown:5}, passiveAbility:{name:'Terreur Psychologique',description:"Augmente l'intimidation des unités de 1 par embuscade réussie jusqu'à la fin de la bataille."} },
  { id:'ri_boku',     activeAbility:{name:'Vision du Sage',description:"Révèle l'emplacement d'une unité ennemie en embuscade.",cooldown:2}, passiveAbility:{name:'Maître de la Guerre Totale',description:"Lors d'un conflit, si une unité de l'armée est en avantage, elle reçoit un bonus de 1 en attaque ou en défense."} },
  { id:'kei_sha',     activeAbility:{name:'Piège Mortel',description:"Toute l'armée de Kei Sha recule instantanément de 2 cases et obtient un bonus de 1 de défense pendant les 2 prochains tours.",cooldown:4}, passiveAbility:{name:'Danse de la Guerre',description:"Chaque fois qu'une unité de l'armée de Kei Sha défend, l'unité adverse qui attaque perd 1 de vitalité en ignorant l'armure."} },
  { id:'shi_ba_shou', activeAbility:{name:'Forteresse Inviolable',description:"Les unités en position de défense gagnent 5 d'armure pendant 2 tours et annule la charge d'une unité.",cooldown:4}, passiveAbility:{name:'Loyauté Absolue',description:"Lorsqu'une unité alliée est détruite, les unités alliées dans un rayon de 400m regagnent 1 de vitalité."} },
  { id:'ren_pa',      activeAbility:{name:'Furie Martial',description:"Si une unité ennemie possède 12 de vitalité ou moins et se trouve au corps à corps avec Ren Pa, détruit cette unité peu importe son type.",cooldown:3}, passiveAbility:{name:'Volonté Indomptable',description:"La troupe de Ren Pa continue de se battre pendant 1 tour après avoir été démoralisée."} },
  { id:'go_kei',      activeAbility:{name:'Rempart Inébranlable',description:"Les unités obtiennent 3 de défense et 2 de puissance supplémentaires en position de défense pendant 2 tours.",cooldown:3}, passiveAbility:{name:'Gardien de Wei',description:"Lorsqu'une unité tue une unité ennemie en position de défense, elle gagne 1 de puissance et 1 de défense jusqu'à la fin de la bataille."} },
  { id:'go_hou_mei',  activeAbility:{name:'Esprit Tactique Inégalé',description:"À la fin d'un tour, Go Hou Mei peut rejouer un de ses officiers ainsi que la troupe sous son commandement, mais ne peut pas attaquer.",cooldown:3}, passiveAbility:{name:'Génie Militaire',description:"Si Go Hou Mei réussit le test de Stratégie et commence le tour, ses unités ont +1 d'attaque et de défense."} },
  { id:'gai_mou',     activeAbility:{name:'Rugissement du Lion',description:"Toutes les troupes ennemies (à l'exception des officiers) perdent 1 d'intimidation dans un rayon de 1000m autour de Gai Mou.",cooldown:3}, passiveAbility:{name:'Fierté Inflexible',description:"Lors d'un combat impliquant une unité de l'armée de Gai Mou, si l'unité adverse est en supériorité numérique, l'unité alliée obtient un bonus de 1 de puissance."} },
];

// Stance icons
const stanceIcons = {};
const stanceList = ['marche','combat','charge','repos','defense_combat','defense_distance'];
const stanceIconFiles = { marche:'marche', combat:'combat', charge:'charge', repos:'repos', defense_combat:'def_charge', defense_distance:'def_eparse' };
const stanceNames = { marche:'Marche', combat:'Combat', charge:'Charge', repos:'Repos', defense_combat:'Déf. combat', defense_distance:'Déf. distance' };
const TERRAINS_DATA = {
  plain:    { name:'Plaines',    vitesse:0,  attack_cac:0,  attack_tir:0,  defense_cac:0,  defense_tir:0,  puissance_cac:0,  puissance_tir:0,  intimidation_cac:0,  intimidation_tir:0,  courage_cac:0,  courage_tir:0,  esquive_cac:0,  esquive_tir:0,  precision_cac:0,  precision_tir:0,  armure:0,  armure_tour:0, moral_tour:0,  vitalite_tour:0 },
  forest:   { name:'Forêts',    vitesse:-1, attack_cac:0,  attack_tir:-1, defense_cac:+2, defense_tir:+2, puissance_cac:0,  puissance_tir:-1, intimidation_cac:+2, intimidation_tir:+2, courage_cac:-1, courage_tir:-2, esquive_cac:+1, esquive_tir:+2, precision_cac:-1, precision_tir:-1, armure:+1, armure_tour:0, moral_tour:0,  vitalite_tour:0 },
  river:    { name:'Fleuves',   vitesse:-1, attack_cac:-3, attack_tir:-2, defense_cac:-3, defense_tir:-3, puissance_cac:-2, puissance_tir:-2, intimidation_cac:-2, intimidation_tir:-2, courage_cac:-2, courage_tir:-2, esquive_cac:-2, esquive_tir:-2, precision_cac:-2, precision_tir:-1, armure:-1, armure_tour:0, moral_tour:0,  vitalite_tour:0 },
  road:     { name:'Routes',    vitesse:+1, attack_cac:+1, attack_tir:+1, defense_cac:0,  defense_tir:0,  puissance_cac:+1, puissance_tir:0,  intimidation_cac:+1, intimidation_tir:0,  courage_cac:+1, courage_tir:+1, esquive_cac:-1, esquive_tir:-1, precision_cac:+1, precision_tir:+1, armure:0,  armure_tour:0, moral_tour:0,  vitalite_tour:0 },
  building: { name:'Bâtiments', vitesse:-1, attack_cac:-1, attack_tir:-3, defense_cac:+2, defense_tir:+2, puissance_cac:0,  puissance_tir:-1, intimidation_cac:+1, intimidation_tir:+2, courage_cac:+1, courage_tir:+1, esquive_cac:+2, esquive_tir:+4, precision_cac:-1, precision_tir:-1, armure:+2, armure_tour:0, moral_tour:+10, vitalite_tour:+5 },
  bridge:   { name:'Ponts',     vitesse:0,  attack_cac:0,  attack_tir:+1, defense_cac:+1, defense_tir:+1, puissance_cac:0,  puissance_tir:0,  intimidation_cac:+1, intimidation_tir:0,  courage_cac:0,  courage_tir:-1, esquive_cac:+1, esquive_tir:-1, precision_cac:0,  precision_tir:+1, armure:0,  armure_tour:0, moral_tour:0,  vitalite_tour:0 },
};
const STANCES_DATA = {
  marche:           { vitesse:+1,  attack_cac:-1, attack_tir:-2, defense_cac:-2, defense_tir:-1, puissance_cac:0,  puissance_tir:-1, intimidation_cac:+1, intimidation_tir:0,  armure:-1, armure_tour:0,  moral_tour:0,   vitalite_tour:0 },
  combat:           { vitesse:0,   attack_cac:0,  attack_tir:0,  defense_cac:0,  defense_tir:0,  puissance_cac:0,  puissance_tir:0,  intimidation_cac:0,  intimidation_tir:0,  armure:0,  armure_tour:0,  moral_tour:0,   vitalite_tour:0 },
  charge:           { vitesse:+2,  attack_cac:+3, attack_tir:-2, defense_cac:-1, defense_tir:-2, puissance_cac:+1, puissance_tir:-1, intimidation_cac:+2, intimidation_tir:-1, armure:0,  armure_tour:0,  moral_tour:-10, vitalite_tour:0 },
  repos:            { vitesse:-1,  attack_cac:-2, attack_tir:-2, defense_cac:-2, defense_tir:-2, puissance_cac:-2, puissance_tir:-1, intimidation_cac:-2, intimidation_tir:-1, armure:0,  armure_tour:+1, moral_tour:+10, vitalite_tour:+5 },
  defense_combat:   { vitesse:-1,  attack_cac:-2, attack_tir:-1, defense_cac:+3, defense_tir:-2, puissance_cac:-1, puissance_tir:0,  intimidation_cac:0,  intimidation_tir:+1, armure:+1, armure_tour:0,  moral_tour:0,   vitalite_tour:0 },
  defense_distance: { vitesse:0,   attack_cac:-3, attack_tir:0,  defense_cac:-2, defense_tir:0,  puissance_cac:-2, puissance_tir:0,  intimidation_cac:-2, intimidation_tir:-1, armure:0,  armure_tour:0,  moral_tour:0,   vitalite_tour:0 },
};
for (const s of stanceList) {
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

const TERRAIN_COLORS = {
  forest:   'rgba(30,100,20,0.7)',
  river:    'rgba(40,120,220,0.7)',
  building: 'rgba(140,100,60,0.8)',
  road:     'rgba(200,170,100,0.6)',
  bridge:   'rgba(220,140,30,0.8)',
};

// Map hex set — built once from image bounds (mirrors server generateHexMap)
const mapHexSet = buildMapHexSet();

// State
let myId = sessionStorage.getItem('myId');
let roomCode = sessionStorage.getItem('roomCode');
let gameState = null;
let isSpectator = false;
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
function buildZoneTileSet(state) {
  if (state?.startingZone?.tiles && !(state.startingZone.tileSet instanceof Set)) {
    state.startingZone.tileSet = new Set(state.startingZone.tiles.map(t => `${t.q},${t.r}`));
  }
  for (const z of (state?.allZones || [])) {
    if (z.zone?.tiles && !(z.zone.tileSet instanceof Set)) {
      z.zone.tileSet = new Set(z.zone.tiles.map(t => `${t.q},${t.r}`));
    }
  }
}
if (deployState) buildZoneTileSet(deployState);

let mode = 'select'; // select | move | attack | deploy | facing
let facingTiles = new Map(); // key -> { facingIdx, label, isCurrent }
let selectedUnit = null;
let hoveredHex = null;
let hoveredUnit = null;
let hoveredUnitVisible = null;
let hoverTimer = null;
let movableTiles = new Set();
let attackableTiles = new Set();
let rangeTiles = new Set();
let rangeCenter = null;
let motivateTiles = new Set();
let motivateCenter = null;
let deployTiles = new Set();
let pendingMoveTarget = null;
let pendingMovePath = [];
let buildTiles = new Set(); // voisins constructibles pour les Bâtisseurs

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
  const myDeployPlayer = deployState?.players?.find(p => p.id === deployState?.myId);
  const myColorHex = myDeployPlayer?.color || '#40c040';
  const myColorRGB = parseInt(myColorHex.slice(1,3),16)+','+parseInt(myColorHex.slice(3,5),16)+','+parseInt(myColorHex.slice(5,7),16);

  const S = Math.sqrt(3);
  const qMin = Math.floor(-MAP_ORIG_X / (MAP_HEX_SIZE * 1.5)) - 1;
  const qMax = Math.ceil((MAP_IMG_W - MAP_ORIG_X) / (MAP_HEX_SIZE * 1.5)) + 1;

  if (gameState && gameState.phase === 'battle') {
    // Brouillard de guerre : voile sombre sur les hexes non-visibles
    if (visibleSet.size > 0) {
      ctx.save();
      // Découpe en clip les hexes visibles (trou dans le brouillard)
      const fogPath = new Path2D();
      // Rectangle couvrant toute la carte
      fogPath.rect(
        -MAP_ORIG_X * MAP_SCALE - HEX_SIZE * 2,
        -MAP_ORIG_Y * MAP_SCALE - HEX_SIZE * 2,
        MAP_IMG_W * MAP_SCALE + HEX_SIZE * 4,
        MAP_IMG_H * MAP_SCALE + HEX_SIZE * 4
      );
      // Perce un trou pour chaque hex visible
      for (const key of visibleSet) {
        const [vq, vr] = key.split(',').map(Number);
        const { x: vx, y: vy } = hexToPixel(vq, vr);
        fogPath.moveTo(vx + HEX_SIZE, vy);
        for (let i = 1; i <= 6; i++) {
          const a = Math.PI / 3 * i;
          fogPath.lineTo(vx + HEX_SIZE * Math.cos(a), vy + HEX_SIZE * Math.sin(a));
        }
      }
      ctx.fillStyle = 'rgba(0,0,0,0.78)';
      ctx.fill(fogPath, 'evenodd');
      ctx.restore();
    }

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
        let fill = 'rgba(0,0,0,0)';
        let stroke = isVisible ? `rgba(${gridColorRGB},${gridOpacity})` : 'rgba(0,0,0,0)';
        if (isVisible && movableTiles.has(key)) fill = 'rgba(40,120,20,0.35)';
        if (isVisible && attackableTiles.has(key)) fill = 'rgba(180,30,10,0.35)';
        if (isVisible && buildTiles.has(key)) fill = 'rgba(20,160,80,0.45)';
        const facingTile = facingTiles.get(key);
        if (facingTile) {
          if (facingTile.isCurrent) {
            fill = 'rgba(80,80,80,0.45)'; stroke = 'rgba(120,120,120,0.6)';
          } else {
            fill = isHovered ? 'rgba(200,160,20,0.45)' : 'rgba(180,130,10,0.25)';
            stroke = '#c8960c';
          }
        }
        if (isHovered && isVisible && !facingTile) stroke = '#c8960c';
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
        const inZone = startZone?.tileSet ? startZone.tileSet.has(`${q},${r}`) : (startZone ? hexDistance(q, r, startZone.q, startZone.r) <= (startZone.radius || 4) : false);
        const isHovered = hoveredHex && hoveredHex.q === q && hoveredHex.r === r;
        let fill = inZone ? `rgba(${myColorRGB},0.12)` : (startZone ? 'rgba(0,0,0,0.05)' : 'rgba(0,0,0,0)');
        let stroke = inZone ? `rgba(${myColorRGB},0.85)` : (startZone ? 'rgba(0,0,0,0)' : `rgba(${gridColorRGB},${gridOpacity * 0.6})`);
        if (inZone && isHovered) fill = `rgba(${myColorRGB},0.25)`;
        if (isHovered && !inZone) stroke = 'rgba(200,160,80,0.5)';
        drawHex(ctx, x, y, fill, stroke, 1, gridThickness);
      }
    }
  }

  // Contour de la zone de déploiement du joueur
  if (startZone?.tileSet && startZone.tileSet.size > 0) {
    const dirs = SEGMENT_EDGE_DIRS;
    ctx.save();
    ctx.strokeStyle = `rgba(${myColorRGB},0.95)`;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const key of startZone.tileSet) {
      const [q, r] = key.split(',').map(Number);
      const { x, y } = hexToPixel(q, r);
      const corners = hexCorners(x, y);
      for (let i = 0; i < 6; i++) {
        const [dq, dr] = dirs[i];
        if (!startZone.tileSet.has(`${q + dq},${r + dr}`)) {
          ctx.moveTo(corners[i].x, corners[i].y);
          ctx.lineTo(corners[(i + 1) % 6].x, corners[(i + 1) % 6].y);
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // Zones des autres joueurs (opacité réduite, forêts masquées)
  for (const z of (deployState?.allZones || [])) {
    if (!z.zone?.tileSet || z.zone.tileSet.size === 0) continue;
    const dirs = SEGMENT_EDGE_DIRS;
    ctx.save();
    ctx.fillStyle = `${z.color}22`;
    for (const key of z.zone.tileSet) {
      if (terrainData[key] === 'forest') continue;
      const [q, r] = key.split(',').map(Number);
      const { x, y } = hexToPixel(q, r);
      const pts = hexCorners(x, y);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = `${z.color}99`;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const key of z.zone.tileSet) {
      if (terrainData[key] === 'forest') continue;
      const [q, r] = key.split(',').map(Number);
      const { x, y } = hexToPixel(q, r);
      const corners = hexCorners(x, y);
      for (let i = 0; i < 6; i++) {
        const [dq, dr] = dirs[i];
        const nk = `${q + dq},${r + dr}`;
        if (!z.zone.tileSet.has(nk) || terrainData[nk] === 'forest') {
          ctx.moveTo(corners[i].x, corners[i].y);
          ctx.lineTo(corners[(i + 1) % 6].x, corners[(i + 1) % 6].y);
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  if (rangeTiles.size > 0 && rangeCenter) {
    const dirs = SEGMENT_EDGE_DIRS;
    const interior = new Set(rangeTiles);
    interior.add(`${rangeCenter.q},${rangeCenter.r}`);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,220,0,0.9)';
    ctx.lineWidth = 3;
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
    ctx.stroke();
    ctx.restore();
  }

  if (motivateTiles.size > 0 && motivateCenter) {
    const dirs = SEGMENT_EDGE_DIRS;
    const interior = new Set(motivateTiles);
    interior.add(`${motivateCenter.q},${motivateCenter.r}`);
    ctx.save();
    ctx.strokeStyle = 'rgba(80,180,255,0.9)';
    ctx.lineWidth = 3;
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
    ctx.stroke();
    ctx.restore();
  }

  // Table des mods d'angle par stance (index = offset directionnel 0-5 depuis le facing du défenseur)
  const ANGLE_MODS_CLIENT = {
    marche:           [0, 2, 2, 4, 2, 2],
    combat:           [0, 0, 2, 4, 2, 0],
    charge:           [2, 2, 4, 4, 4, 2],
    repos:            [0, 2, 4, 4, 4, 2],
    defense_combat:   [0, 0, 0, 4, 0, 0],
    defense_distance: [0, 2, 4, 4, 4, 2],
  };
  const weaknessColor = (unit, dirIdx, alpha) => {
    if (unit.facing == null) return null;
    const offset = (dirIdx - unit.facing + 6) % 6;
    const table = ANGLE_MODS_CLIENT[unit.stance] || ANGLE_MODS_CLIENT['combat'];
    const mod = table[offset];
    if (mod === 0) return `rgba(20,120,20,${alpha})`;
    if (mod === 2) return `rgba(160,70,0,${alpha})`;
    return `rgba(140,10,10,${alpha})`;
  };

  // Contour blanc continu des groupes d'unités adjacentes
  if (showWeakness) {
    const allUnits = gameState?.units || [];
    const byPlayer = {};
    for (const u of allUnits) {
      if (u.q === null || u.r === null) continue;
      if (!byPlayer[u.playerId]) byPlayer[u.playerId] = { pos: new Set(), units: [] };
      byPlayer[u.playerId].pos.add(`${u.q},${u.r}`);
      byPlayer[u.playerId].units.push(u);
    }
    const rk = p => `${Math.round(p.x)},${Math.round(p.y)}`;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const { pos, units } of Object.values(byPlayer)) {
      // Collecte les bords extérieurs : fromKey → {from, to}
      const edgeMap = new Map();
      for (const u of units) {
        const { x: hx, y: hy } = hexToPixel(u.q, u.r);
        const pts = hexCorners(hx, hy);
        for (let dirIdx = 0; dirIdx < 6; dirIdx++) {
          const { dq, dr } = FACING_DIRS[dirIdx];
          if (pos.has(`${u.q + dq},${u.r + dr}`)) continue;
          const ei = (6 - dirIdx) % 6;
          const from = pts[ei], to = pts[(ei + 1) % 6];
          const color = weaknessColor(u, dirIdx, 0.92) || 'rgba(255,255,255,0.92)';
          edgeMap.set(rk(from), { from, to, hx, hy, color });
        }
      }
      // Chaîne les bords en boucles, dessine avec coins arrondis
      const visited = new Set();
      const cr = 0.2; // fraction du segment utilisée pour l'arrondi
      const inset = 2; // décalage vers l'intérieur (px) pour que le trait ne déborde pas
      const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      // Calcule le point décalé vers l'intérieur de l'hex
      const insetPt = (p, e) => {
        const ex = e.to.x - e.from.x, ey = e.to.y - e.from.y;
        const len = Math.hypot(ex, ey);
        let nx = -ey / len, ny = ex / len;
        const mx = (e.from.x + e.to.x) / 2, my = (e.from.y + e.to.y) / 2;
        if (nx * (e.hx - mx) + ny * (e.hy - my) < 0) { nx = -nx; ny = -ny; }
        return { x: p.x + nx * inset, y: p.y + ny * inset };
      };
      const withAlpha = (color, alpha) => color.replace(/[\d.]+\)$/, `${alpha})`);
      // Construit le chemin fermé de la boucle (pour ctx.clip)
      const buildPath = (loop) => {
        const n = loop.length;
        const iFrom0 = insetPt(loop[0].from, loop[0]);
        const iTo0   = insetPt(loop[0].to,   loop[0]);
        ctx.beginPath();
        ctx.moveTo(lerp(iFrom0, iTo0, cr).x, lerp(iFrom0, iTo0, cr).y);
        for (let i = 0; i < n; i++) {
          const e  = loop[i], en = loop[(i + 1) % n];
          const iFrom = insetPt(e.from, e), iTo = insetPt(e.to, e);
          const iFromN = insetPt(en.from, en), iToN = insetPt(en.to, en);
          const p1 = lerp(iFrom, iTo, 1 - cr), p2 = lerp(iFromN, iToN, cr);
          const corner = insetPt(e.to, e);
          const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          const ctrl = { x: mid.x + (corner.x - mid.x) * 0.6, y: mid.y + (corner.y - mid.y) * 0.6 };
          ctx.lineTo(p1.x, p1.y);
          ctx.quadraticCurveTo(ctrl.x, ctrl.y, p2.x, p2.y);
        }
        ctx.closePath();
      };
      // Dessine tous les segments colorés de la boucle à un alpha donné
      const drawSegments = (loop, lineWidth, alpha) => {
        ctx.lineWidth = lineWidth;
        const n = loop.length;
        for (let i = 0; i < n; i++) {
          const e  = loop[i], en = loop[(i + 1) % n];
          const iFromE  = insetPt(e.from, e),   iToE   = insetPt(e.to,   e);
          const iFromEN = insetPt(en.from, en),  iToEN  = insetPt(en.to,  en);
          const pStart = lerp(iFromE, iToE, cr);
          const p1     = lerp(iFromE, iToE, 1 - cr);
          const p2     = lerp(iFromEN, iToEN, cr);
          const corner = insetPt(e.to, e);
          const mid    = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          const ctrl   = { x: mid.x + (corner.x - mid.x) * 0.6, y: mid.y + (corner.y - mid.y) * 0.6 };
          ctx.beginPath();
          ctx.moveTo(pStart.x, pStart.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.strokeStyle = withAlpha(e.color, alpha);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.quadraticCurveTo(ctrl.x, ctrl.y, p2.x, p2.y);
          if (e.color === en.color) {
            ctx.strokeStyle = withAlpha(e.color, alpha);
          } else {
            const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
            grad.addColorStop(0, withAlpha(e.color, alpha));
            grad.addColorStop(1, withAlpha(en.color, alpha));
            ctx.strokeStyle = grad;
          }
          ctx.stroke();
        }
      };
      for (const [startKey, startEdge] of edgeMap) {
        if (visited.has(startKey)) continue;
        const loop = [];
        let cur = startEdge, curKey = startKey;
        while (!visited.has(curKey)) {
          visited.add(curKey);
          loop.push(cur);
          const nk = rk(cur.to);
          cur = edgeMap.get(nk);
          if (!cur) break;
          curKey = nk;
        }
        if (loop.length === 0) continue;
        // Dégradé vers l'intérieur avec couleurs de faiblesse
        buildPath(loop);
        ctx.save();
        ctx.clip();
        drawSegments(loop, 36, 0.07);
        drawSegments(loop, 22, 0.15);
        drawSegments(loop, 10, 0.35);
        ctx.restore();
        // Trait principal
        drawSegments(loop, 4, 0.92);
      }
    }
    ctx.restore();
  }

  // Faiblesses directionnelles — derrière les unités
  if (showWeakness) {
    const allUnits = gameState?.units || [];
    const allyPositions = new Set(allUnits.filter(u => u.isMine).map(u => `${u.q},${u.r}`));
    const enemyPositions = new Set(allUnits.filter(u => !u.isMine).map(u => `${u.q},${u.r}`));
    for (const unit of allUnits) {
      if (unit.q === null || unit.r === null || unit.facing == null) continue;
      const { x, y } = hexToPixel(unit.q, unit.r);
      const f = unit.facing;
      const friendlyPos = unit.isMine ? allyPositions : enemyPositions;
      const edgeColors = new Array(6).fill(null);
      for (let offset = 0; offset < 6; offset++) {
        const dirIdx = (f + offset) % 6;
        const { dq, dr } = FACING_DIRS[dirIdx];
        const nq = unit.q + dq, nr = unit.r + dr;
        if (friendlyPos.has(`${nq},${nr}`)) continue;
        const edgeIdx = (6 - dirIdx) % 6;
        edgeColors[edgeIdx] = weaknessColor(unit, dirIdx, 0.85);
      }
      drawHexWeakness(ctx, x, y, edgeColors);
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
      drawUnit(ctx, x, y, u, myId, false, hoveredUnit?.id === u.id);
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

    drawUnit(ctx, x, y, u, u.playerId, isSelected, hoveredUnit?.id === u.id);
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

  // Segments — PNGs toujours visibles, couleurs uniquement avec l'outil terrain
  drawSegments(ctx, showTerrain);

  // Chemin de déplacement en attente de confirmation
  if (pendingMovePath.length > 0 && pendingMoveTarget) {
    ctx.save();
    for (const step of pendingMovePath) {
      const { x, y } = hexToPixel(step.q, step.r);
      const isTrampled = step !== pendingMoveTarget && gameState?.units.some(u => u.q === step.q && u.r === step.r && !u.isMine);
      if (isTrampled) {
        drawHex(ctx, x, y, 'rgba(220,60,0,0.4)', 'rgba(255,80,0,0.9)', 1, 2);
      } else {
        drawHex(ctx, x, y, 'rgba(255,200,0,0.25)', 'rgba(255,200,0,0.7)', 1, 2);
      }
    }
    const { x: dx, y: dy } = hexToPixel(pendingMoveTarget.q, pendingMoveTarget.r);
    drawHex(ctx, dx, dy, 'rgba(255,200,0,0.45)', 'rgba(255,220,0,1)', 1, 3);
    if (selectedUnit) {
      const from = hexToPixel(selectedUnit.q, selectedUnit.r);
      ctx.strokeStyle = 'rgba(255,220,0,0.6)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      for (const step of pendingMovePath) {
        const { x, y } = hexToPixel(step.q, step.r);
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

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
          if (!mapHexSet.has(`${q},${r}`)) continue;
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

  // Flèches de rotation — dessinées en dernier pour passer au-dessus de tout
  if (facingTiles.size > 0) {
    ctx.save();
    ctx.font = `bold ${Math.max(12, HEX_SIZE * zoom * 0.52)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [key, ft] of facingTiles) {
      const [q, r] = key.split(',').map(Number);
      const { x, y } = hexToPixel(q, r);
      const isHov = hoveredHex && hoveredHex.q === q && hoveredHex.r === r;
      if (ft.isCurrent) {
        ctx.fillStyle = 'rgba(180,180,180,0.75)';
        ctx.shadowBlur = 0;
      } else {
        ctx.fillStyle = isHov ? '#fff200' : '#ffa500';
        ctx.shadowColor = isHov ? '#fff200' : '#ff8800';
        ctx.shadowBlur = isHov ? 14 : 8;
      }
      ctx.fillText(ft.label, x, y);
    }
    ctx.shadowBlur = 0;
    ctx.restore();
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

function drawUnit(ctx, x, y, unit, playerId, isSelected = false, isHovered = false) {
  const color = getPlayerColor(playerId);
  const size = HEX_SIZE * 0.55;
  const rotAngle = FACING_ANGLES[getAnimatedFacing(unit)];

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
    : (unit.speedRemaining <= 0 && unit.isMine) ? 'rgba(0,0,0,0.45)'
    : null;

  if (unit.isGeneral) {
    const gid = getGeneralIdForUnit(unit);
    const img = gid ? generalTokenImages[gid] : null;
    if (img && img.complete && img.naturalWidth) {
      drawTokenImage(ctx, img, x, y, tokenR, color, 0.25, overlayColor, rotAngle);
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
      drawTokenImage(ctx, img, x, y, tokenR, color, 0.35, overlayColor, rotAngle);
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

  // Hover overlay : assombrit le token et affiche le nom
  if (isHovered) {
    // Flèche de direction (facing)
    const facing = unit.facing ?? 0;
    const [fdq, fdr] = FACING_DIRS[facing] ? [FACING_DIRS[facing].dq, FACING_DIRS[facing].dr] : [1,0];
    const S3 = Math.sqrt(3);
    const fpx = 1.5 * fdq;
    const fpy = S3 * fdr + S3 / 2 * fdq;
    const fAngle = Math.atan2(fpy, fpx);
    const arrowLen = HEX_SIZE * 0.75;
    const arrowHeadLen = HEX_SIZE * 0.3;
    const ax = x + Math.cos(fAngle) * arrowLen;
    const ay = y + Math.sin(fAngle) * arrowLen;
    ctx.save();
    // Contour blanc pour lisibilité
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ax, ay);
    ctx.lineTo(ax - Math.cos(fAngle - 0.4) * arrowHeadLen, ay - Math.sin(fAngle - 0.4) * arrowHeadLen);
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - Math.cos(fAngle + 0.4) * arrowHeadLen, ay - Math.sin(fAngle + 0.4) * arrowHeadLen);
    ctx.stroke();
    // Flèche noire
    ctx.strokeStyle = 'rgba(0,0,0,0.95)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ax, ay);
    ctx.lineTo(ax - Math.cos(fAngle - 0.4) * arrowHeadLen, ay - Math.sin(fAngle - 0.4) * arrowHeadLen);
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - Math.cos(fAngle + 0.4) * arrowHeadLen, ay - Math.sin(fAngle + 0.4) * arrowHeadLen);
    ctx.stroke();
    ctx.restore();

    // Badge nom
    const label = unit.name;
    const fontSize = Math.round(HEX_SIZE * 0.38);
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textW = ctx.measureText(label).width;
    const padX = 8, padY = 4;
    const bw = textW + padX * 2, bh = fontSize + padY * 2;
    const bx = x - bw / 2, by = y - bh / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);

    // Barres de vie et de moral sous le badge
    const barW = Math.max(bw, HEX_SIZE * 1.1);
    const barH = Math.round(HEX_SIZE * 0.13);
    const barX = x - barW / 2;
    let barY = by + bh + 3;

    if (unit.maxVitality > 0) {
      const hpPct = Math.max(0, Math.min(1, unit.vitality / unit.maxVitality));
      const hpColor = hpPct > 0.6 ? '#3a9030' : hpPct > 0.3 ? '#b07020' : '#902020';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 2); ctx.fill();
      ctx.fillStyle = hpColor;
      ctx.beginPath(); ctx.roundRect(barX, barY, barW * hpPct, barH, 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = `bold ${Math.round(HEX_SIZE * 0.22)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${unit.vitality}/${unit.maxVitality}`, x, barY + barH / 2);
      barY += barH + 2;
    }

    if (unit.maxMorale > 0) {
      const moPct = Math.max(0, Math.min(1, unit.morale / unit.maxMorale));
      const moColor = moPct > 0.6 ? '#3060a0' : moPct > 0.3 ? '#7050a0' : '#902020';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 2); ctx.fill();
      ctx.fillStyle = moColor;
      ctx.beginPath(); ctx.roundRect(barX, barY, barW * moPct, barH, 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = `bold ${Math.round(HEX_SIZE * 0.22)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`${unit.morale}/${unit.maxMorale}`, x, barY + barH / 2);
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
let lastMoveConfirmedAt = 0;


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
  const allUnits = [...(gameState?.units || []), ...(deployState?.units || [])];
  const newUnit = hoveredHex ? allUnits.find(u => u.q === hoveredHex.q && u.r === hoveredHex.r) || null : null;
  if (newUnit?.id !== hoveredUnit?.id) {
    hoveredUnit = newUnit;
  }
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

canvas.addEventListener('dblclick', (e) => {
  const hex = getHexUnderMouse(e);
  if (!hex) return;
  const allUnits = [...(gameState?.units || []), ...(deployState?.units || [])];
  const unit = allUnits.find(u => u.q === hex.q && u.r === hex.r);
  if (!unit) return;
  const sidebar = document.getElementById('sidebar');
  if (sidebar.classList.contains('collapsed')) toggleSidebar();
  switchSidebarTab('units');
});

canvas.addEventListener('mouseup', () => { isDragging = false; });
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (gameState?.phase !== 'battle' || gameState?.currentPlayerId !== myId) return;
  const hex = getHexUnderMouse(e);
  if (!hex) return;
  const unit = gameState.units.find(u => u.q === hex.q && u.r === hex.r && u.isMine);
  if (!unit) return;
  selectUnit(unit);
  showUnitContextMenu(unit, e.clientX, e.clientY);
});

function showUnitContextMenu(unit, clientX, clientY) {
  document.getElementById('unit-ctx-menu')?.remove();
  const full = gameState?.myUnits?.find(u => u.id === unit.id) || unit;
  const spd = full.speedRemaining ?? 0;
  const isMyTurn = gameState?.currentPlayerId === myId;

  const menu = document.createElement('div');
  menu.id = 'unit-ctx-menu';
  Object.assign(menu.style, {
    position: 'fixed', left: `${clientX}px`, top: `${clientY}px`,
    background: '#100804', border: '1px solid #5a3c10', borderRadius: '6px',
    padding: '4px 0', zIndex: '2000', minWidth: '190px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.7)', fontFamily: 'inherit',
  });

  function addItem(label, cost, enabled, onClick) {
    const btn = document.createElement('button');
    btn.style.cssText = 'display:flex;justify-content:space-between;align-items:center;width:100%;padding:7px 14px;background:none;border:none;cursor:pointer;font-size:0.82em;text-align:left;gap:12px;';
    btn.innerHTML = `<span style="color:${enabled ? '#e0c080' : '#5a4020'}">${label}</span><span style="color:${enabled && cost <= spd ? '#c8960c' : '#5a3c10'};font-size:0.85em;flex-shrink:0">${cost} ⚡</span>`;
    if (!enabled) { btn.style.cursor = 'not-allowed'; }
    btn.onmouseenter = () => { if (enabled) btn.style.background = '#1a0d04'; };
    btn.onmouseleave = () => { btn.style.background = 'none'; };
    btn.onclick = () => { menu.remove(); if (enabled) onClick(); };
    menu.appendChild(btn);
  }

  function addSeparator() {
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px;background:#2a1408;margin:3px 0;';
    menu.appendChild(sep);
  }

  // Tourner (1 vitesse)
  addItem('Tourner l\'unité', 1, spd >= 1, () => showFacingPopup(full));

  // Changer de posture (2 vitesse) — non-généraux seulement
  if (!unit.isGeneral) {
    addSeparator();
    const canStance = spd >= 2;
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';

    const stanceBtn = document.createElement('button');
    stanceBtn.style.cssText = 'display:flex;justify-content:space-between;align-items:center;width:100%;padding:7px 14px;background:none;border:none;font-size:0.82em;gap:12px;' + (canStance ? 'cursor:pointer;' : 'cursor:not-allowed;');
    stanceBtn.innerHTML = `<span style="color:${canStance ? '#e0c080' : '#5a4020'}">Changer de posture</span><span style="color:${canStance ? '#c8960c' : '#5a3c10'};font-size:0.85em">2 ⚡${canStance ? ' ▶' : ''}</span>`;
    wrapper.appendChild(stanceBtn);

    if (canStance) {
      const subMenu = document.createElement('div');
      subMenu.style.cssText = 'display:none;position:absolute;left:100%;top:0;background:#100804;border:1px solid #5a3c10;border-radius:6px;padding:4px 0;min-width:160px;box-shadow:0 4px 16px rgba(0,0,0,0.7);z-index:2001;';
      for (const s of stanceList) {
        const sb = document.createElement('button');
        const isCurrent = full.stance === s;
        sb.style.cssText = `display:flex;align-items:center;gap:8px;width:100%;padding:7px 14px;background:${isCurrent ? '#2a1408' : 'none'};border:none;cursor:${isCurrent ? 'default' : 'pointer'};font-size:0.82em;`;
        sb.innerHTML = `<img src="/assets/icons/${stanceIconFiles[s]}.svg" style="width:16px;height:16px;opacity:0.8"><span style="color:${isCurrent ? '#ffd700' : '#e0c080'}">${stanceNames[s]}</span>`;
        sb.onmouseenter = () => {
          if (!isCurrent) sb.style.background = '#1a0d04';
          const sidebar = document.getElementById('sidebar');
          if (sidebar.classList.contains('collapsed')) toggleSidebar();
          switchSidebarTab('units');
          const previewUnit = { ...full, stance: s, speedRemaining: Math.max(0, (full.speedRemaining ?? 0) - 2) };
          showUnitDetail(previewUnit, true, `${stanceNames[s]} (−2 ⚡)`);
        };
        sb.onmouseleave = () => {
          if (!isCurrent) sb.style.background = 'none';
          showUnitDetail(full);
        };
        sb.onclick = () => { menu.remove(); if (!isCurrent) wsSend('change_stance', { roomCode, unitId: full.id, stanceId: s }); };
        subMenu.appendChild(sb);
      }
      wrapper.appendChild(subMenu);
      stanceBtn.onmouseenter = () => { stanceBtn.style.background = '#1a0d04'; subMenu.style.display = 'block'; };
      wrapper.onmouseleave = () => { stanceBtn.style.background = 'none'; subMenu.style.display = 'none'; };
    }
    menu.appendChild(wrapper);
  }

  // Capacités spécifiques
  if (!unit.isGeneral) {
    // Bâtisseurs : Construire
    if (unit.typeId === 'batisseurs') {
      addSeparator();
      addItem('Construire', 2, spd >= 2, () => enterBuildMode());
    }
  } else {
    // Général : Motiver
    addSeparator();
    const canMotivate = !full.hasAttacked && spd >= 1;
    const motivateCost = Math.max(1, spd);
    addItem('Motiver les troupes', motivateCost, canMotivate, () => motivateAll());
    // Général : Capacité active
    const active = full.activeAbility || (GENERALS_GAME_DATA.find(g => g.id === getGeneralIdForUnit(full))?.activeAbility);
    if (active) {
      const canAbility = !full.hasUsedAbility && full.abilityCooldown === 0;
      const cooldownInfo = full.abilityCooldown > 0 ? ` (CD: ${full.abilityCooldown})` : '';
      addItem(`⚡ ${active.name}${cooldownInfo}`, 0, canAbility, () => useAbility());
    }
  }

  document.body.appendChild(menu);

  // Repositionner si déborde en bas ou à droite
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${clientX - rect.width}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${clientY - rect.height}px`;
  });

  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}


function showFacingPopup(unit) {
  facingTiles.clear();
  for (let idx = 0; idx < FACING_DIRS.length; idx++) {
    const { dq, dr, label } = FACING_DIRS[idx];
    const nq = unit.q + dq, nr = unit.r + dr;
    if (!mapHexSet.has(`${nq},${nr}`)) continue;
    facingTiles.set(`${nq},${nr}`, { facingIdx: idx, label, isCurrent: unit.facing === idx });
  }
  mode = 'facing';
  render();
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

  if (mode === 'facing') {
    const ft = facingTiles.get(key);
    if (ft && !ft.isCurrent) {
      wsSend('rotate_facing', { roomCode, unitId: selectedUnit.id, facing: ft.facingIdx });
    }
    facingTiles.clear();
    mode = 'select';
    render();
    return;
  }

  if (selectedUnit) {
    // Clic sur case de déplacement → 1er clic = aperçu, 2e clic = confirmer
    if (movableTiles.has(key)) {
      if (pendingMoveTarget && pendingMoveTarget.q === hex.q && pendingMoveTarget.r === hex.r) {
        wsSend('move_unit', { roomCode, unitId: selectedUnit.id, targetQ: hex.q, targetR: hex.r });
        lastMoveConfirmedAt = Date.now();
        pendingMoveTarget = null;
        pendingMovePath = [];
        movableTiles.clear();
        attackableTiles.clear();
        rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
        showUnitDetail(selectedUnit);
      } else {
        pendingMoveTarget = { q: hex.q, r: hex.r };
        pendingMovePath = findPathClient(selectedUnit, hex.q, hex.r);
        showMovePreview(selectedUnit, hex.q, hex.r);
      }
      render();
      return;
    }

    // Clic sur voisin constructible → construire
    if (buildTiles.has(key)) {
      wsSend('build_segment', { roomCode, unitId: selectedUnit.id, neighborQ: hex.q, neighborR: hex.r });
      buildTiles.clear();
      setMode('select');
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
        rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
        render();
        return;
      }
    }


    // Clic sur une autre unité alliée → changer de sélection
    const ally = gameState?.units.find(u => u.q === hex.q && u.r === hex.r && u.isMine);
    if (ally) {
      if (ally.id !== selectedUnit.id) selectUnit(ally);
      return;
    }

    // Clic sur une unité ennemie visible → afficher ses stats en lecture seule
    const visibleEnemy = gameState?.units.find(u => u.q === hex.q && u.r === hex.r && !u.isMine && gameState.visibleHexes?.has(`${hex.q},${hex.r}`));
    if (visibleEnemy) {
      selectedUnit = null;
      pendingMoveTarget = null;
      pendingMovePath = [];
      movableTiles.clear();
      attackableTiles.clear();
      rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
      updateActionButtons();
      showUnitDetail(visibleEnemy, false, '(Ennemi)');
      render();
      return;
    }

    // Clic hors portée → déselectionner
    selectedUnit = null;
    pendingMoveTarget = null;
    pendingMovePath = [];
    movableTiles.clear();
    attackableTiles.clear();
    rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
    updateActionButtons();
    showUnitDetail(null);
    render();
    return;
  }

  // Pas d'unité sélectionnée → sélectionner alliée ou afficher ennemie
  const unit = gameState?.units.find(u => u.q === hex.q && u.r === hex.r && u.isMine);
  if (unit) { selectUnit(unit); render(); return; }
  const enemy = gameState?.units.find(u => u.q === hex.q && u.r === hex.r && !u.isMine && gameState.visibleHexes?.has(`${hex.q},${hex.r}`));
  if (enemy) { showUnitDetail(enemy, false, '(Ennemi)'); render(); return; }
  render();
}

function showMovePreview(unit, tq, tr) {
  // Calcule le coût du chemin vers la tuile cible
  const targetKey = `${tq},${tr}`;
  const maxSpeed = unit.speedRemaining != null ? unit.speedRemaining : unit.speed;
  const isCavalry = unit.category === 'Chevaux' || unit.category === 'Chars';
  const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  const dist = new Map();
  dist.set(`${unit.q},${unit.r}`, 0);
  const queue = [{ q: unit.q, r: unit.r, cost: 0 }];
  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const { q, r, cost } = queue.shift();
    const key = `${q},${r}`;
    if (cost > (dist.get(key) ?? Infinity)) continue;
    if (key === targetKey) break;
    if (cost >= maxSpeed) continue;
    for (const [dq, dr] of dirs) {
      const nq = q + dq, nr = r + dr;
      const nk = `${nq},${nr}`;
      if (!movableTiles.has(nk) && nk !== targetKey) continue;
      const edgeK = segmentEdgeKey(q, r, nq, nr);
      const segDef = segmentData[edgeK] ? SEGMENT_DEFS_CLIENT[segmentData[edgeK]] : null;
      if (segDef?.infranchissable) continue;
      if (segDef?.infranchissable_cavalerie && isCavalry) continue;
      let stepCost = terrainMoveCost(key);
      if (segDef) {
        if (segDef.vitesse_fixe != null) stepCost = segDef.vitesse_fixe;
        else stepCost += Math.max(0, -(segDef.vitesse || 0));
      }
      const newCost = cost + stepCost;
      if (newCost > maxSpeed) continue;
      if (!dist.has(nk) || newCost < dist.get(nk)) {
        dist.set(nk, newCost);
        queue.push({ q: nq, r: nr, cost: newCost });
      }
    }
  }
  const pathCost = dist.get(targetKey) ?? 0;
  const speedAfter = Math.max(0, maxSpeed - pathCost);
  const arrivalTerrain = terrainData[targetKey] || 'plain';
  const terrainName = TERRAINS_DATA[arrivalTerrain]?.name || arrivalTerrain;
  const previewUnit = { ...unit, q: tq, r: tr, speedRemaining: speedAfter };
  showUnitDetail(previewUnit, true, `${terrainName} (−${Math.floor(pathCost)} ⚡)`);
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
  // Toujours utiliser les données complètes de myUnits (contient activeAbility, passiveAbility, etc.)
  const full = gameState?.myUnits?.find(u => u.id === unit.id);
  if (full) unit = { ...full, isMine: unit.isMine };
  selectedUnit = unit;
  pendingMoveTarget = null;
  pendingMovePath = [];
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

function terrainMoveCost(key) {
  const t = terrainData[key] || 'plain';
  const costs = { plain: 1, road: 0.66, forest: 1.5, river: 2, building: 1, bridge: 1 };
  return costs[t] ?? 1;
}

function findPathClient(unit, targetQ, targetR) {
  const maxSpeed = unit.speedRemaining != null ? unit.speedRemaining : unit.speed;
  const isCavalry = unit.category === 'Chevaux' || unit.category === 'Chars';
  const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  const dist = new Map();
  const prev = new Map();
  const startKey = `${unit.q},${unit.r}`;
  const targetKey = `${targetQ},${targetR}`;
  dist.set(startKey, 0);
  const queue = [{ q: unit.q, r: unit.r, cost: 0 }];

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const { q, r, cost } = queue.shift();
    const key = `${q},${r}`;
    if (cost > (dist.get(key) ?? Infinity)) continue;
    if (key === targetKey) break;
    if (cost >= maxSpeed) continue;
    for (const [dq, dr] of dirs) {
      const nq = q + dq, nr = r + dr;
      const nk = `${nq},${nr}`;
      const occupant = gameState?.units.find(u => u.q === nq && u.r === nr);
      const isCharThrough = unit.typeId === 'char' && occupant && !occupant.isMine;
      if (!movableTiles.has(nk) && nk !== targetKey && !isCharThrough) continue;
      if (occupant && !isCharThrough && nk !== targetKey) continue;
      const edgeK = segmentEdgeKey(q, r, nq, nr);
      const segType = segmentData[edgeK];
      const segDef = segType ? SEGMENT_DEFS_CLIENT[segType] : null;
      if (segDef?.infranchissable) continue;
      if (segDef?.infranchissable_cavalerie && isCavalry) continue;
      let stepCost = terrainMoveCost(key);
      if (segDef) {
        if (segDef.vitesse_fixe != null) stepCost = segDef.vitesse_fixe;
        else stepCost += Math.max(0, -(segDef.vitesse || 0));
      }
      const newCost = cost + stepCost;
      if (newCost > maxSpeed) continue;
      if (!dist.has(nk) || newCost < dist.get(nk)) {
        dist.set(nk, newCost);
        prev.set(nk, { q, r });
        queue.push({ q: nq, r: nr, cost: newCost });
      }
    }
  }

  if (!prev.has(targetKey) && targetKey !== startKey) return [];
  const path = [];
  let cur = targetKey;
  while (cur && cur !== startKey) {
    const [cq, cr] = cur.split(',').map(Number);
    path.unshift({ q: cq, r: cr });
    const p = prev.get(cur);
    cur = p ? `${p.q},${p.r}` : null;
  }
  return path;
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
      const isCharThrough = unit.typeId === 'char' && occupant && !occupant.isMine;
      if (occupant && !isCharThrough) continue;

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
        if (!isCharThrough) movableTiles.add(key); // chars ne peuvent pas s'arrêter sur ennemi
        queue.push({ q: nq, r: nr, cost: newCost });
      }
    }
  }
  movableTiles.delete(`${unit.q},${unit.r}`);
}

function computeAttackableTiles(unit) {
  if (!gameState) return;
  const hd = gameState.heightData || {};
  const hA = hd[`${unit.q},${unit.r}`] || 0;

  for (const u of gameState.units) {
    if (u.isMine) continue;
    const dist = hexDistance(unit.q, unit.r, u.q, u.r);
    const hT = hd[`${u.q},${u.r}`] || 0;
    const effectiveRange = Math.max(1, (unit.range || 1) + (hA - hT));
    if (dist <= effectiveRange) {
      attackableTiles.add(`${u.q},${u.r}`);
    }
  }
}

function computeBuildTiles(unit) {
  buildTiles.clear();
  if (!unit || unit.typeId !== 'batisseurs') return;
  const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  for (const [dq, dr] of DIRS) {
    const nq = unit.q + dq, nr = unit.r + dr;
    const edgeK = segmentEdgeKey(unit.q, unit.r, nq, nr);
    const segType = segmentData[edgeK];
    // Segment vide → chevaux de frise, segment falaise → échelle
    if (!segType || segType === 'cliff') {
      buildTiles.add(`${nq},${nr}`);
    }
  }
}

function enterBuildMode() {
  setMode('build');
  render();
}

function computeRangeTiles(unit) {
  const dirs = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
  rangeCenter = { q: unit.q, r: unit.r };
  const hd = gameState?.heightData || {};
  const hA = hd[`${unit.q},${unit.r}`] || 0;
  const maxRange = (unit.range || 1) + hA; // portée max si cible au niveau 0
  const visited = new Set();
  const queue = [{ q: unit.q, r: unit.r, d: 0 }];
  visited.add(`${unit.q},${unit.r}`);
  while (queue.length) {
    const { q, r, d } = queue.shift();
    if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) > 70) continue;
    const hT = hd[`${q},${r}`] || 0;
    const effectiveRange = Math.max(1, (unit.range || 1) + (hA - hT));
    if (d > 0 && d <= effectiveRange && mapHexSet.has(`${q},${r}`)) rangeTiles.add(`${q},${r}`);
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
  const labels = { select: 'Sélection', move: 'Déplacement', attack: 'Attaque', motivate: 'Motiver', deploy: 'Déploiement', build: 'Construction' };
  indicator.textContent = `Mode : ${labels[newMode] || newMode}`;
  if (newMode !== 'facing') facingTiles.clear();
  if (newMode !== 'move') movableTiles.clear();
  if (newMode !== 'attack') {
    attackableTiles.clear();
    rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
  } else if (selectedUnit) {
    computeAttackableTiles(selectedUnit);
  }
  if (newMode !== 'build') buildTiles.clear();
  else if (selectedUnit) computeBuildTiles(selectedUnit);
  render();
}

function updateActionButtons() {
  if (isSpectator) {
    ['btn-move','btn-attack','btn-motivate','btn-ability','btn-build','btn-end-turn','btn-end-turn-center','stance-panel'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    return;
  }
  const isMyTurn = gameState?.currentPlayerId === myId;
  const hasUnit = !!selectedUnit;
  const isFleeing = hasUnit && selectedUnit.isFleeing;
  const canMove = hasUnit && isMyTurn && !isFleeing && (selectedUnit.speedRemaining > 0);
  const canAttack = hasUnit && isMyTurn && !selectedUnit.hasAttacked && !isFleeing;
  const isGeneral = hasUnit && selectedUnit.isGeneral;
  const canAbility = isGeneral && isMyTurn && !selectedUnit.hasUsedAbility && selectedUnit.abilityCooldown === 0;
  const canMotivate = isGeneral && isMyTurn && !selectedUnit.hasAttacked;

  const canBuild = hasUnit && isMyTurn && !isFleeing && selectedUnit.typeId === 'batisseurs' && selectedUnit.speedRemaining >= 2;
  document.getElementById('btn-move').style.display = canMove ? 'block' : 'none';
  document.getElementById('btn-attack').style.display = canAttack ? 'block' : 'none';
  document.getElementById('btn-ability').style.display = canAbility ? 'block' : 'none';
  document.getElementById('btn-motivate').style.display = canMotivate ? 'block' : 'none';
  document.getElementById('btn-build').style.display = canBuild ? 'block' : 'none';
  const endDisplay = isMyTurn ? 'block' : 'none';
  const deployDisplay = (mode === 'deploy') ? 'block' : 'none';
  document.getElementById('btn-end-turn-global').style.display = endDisplay;
  document.getElementById('btn-end-turn-center').style.display = endDisplay;
  const noActionsLeft = isMyTurn && gameState?.units.filter(u => u.playerId === myId).every(u => u.speedRemaining <= 0);
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

function showUnitDetail(unit, previewOnly = false, previewLabel = null) {
  const panel = document.getElementById('selected-unit-detail');
  if (!unit) { panel.style.display = 'none'; return; }
  // Enrichir avec myUnits si activeAbility/passiveAbility manquants
  if (unit.isGeneral && !unit.activeAbility) {
    const full = gameState?.myUnits?.find(u => u.id === unit.id);
    if (full) unit = { ...full, stance: unit.stance };
  }
  panel.style.display = 'block';
  if (!previewOnly) {
    const nameEl = document.getElementById('detail-name');
    const suffix = unit.isFleeing ? ' (EN FUITE)' : (previewLabel ? ` ${previewLabel}` : '');
    nameEl.textContent = unit.name + suffix;
    nameEl.style.textAlign = 'center';
    nameEl.style.color = previewLabel ? '#e07070' : '';
  }

  // Image
  if (!previewOnly) {
    const imgEl = document.getElementById('detail-unit-img');
    if (unit.isGeneral) {
      const generalId = getGeneralIdForUnit(unit);
      const entry = generalId ? GENERAL_IMAGE1_MAP[generalId] : null;
      if (entry && imgEl) {
        imgEl.src = `/assets/unites/GENERAL IMAGE 1-1/${encodeURIComponent(entry.file)}.${entry.ext}`;
        imgEl.style.display = 'block';
      } else if (imgEl) { imgEl.style.display = 'none'; }
    } else {
      const entry = unit.typeId ? UNIT_IMAGE1_MAP[unit.typeId] : null;
      if (entry && imgEl) {
        imgEl.src = `/assets/unites/UNIT IMAGE 1-1/${encodeURIComponent(entry.file)}.${entry.ext}`;
        imgEl.style.display = 'block';
      } else if (imgEl) { imgEl.style.display = 'none'; }
    }
  }

  const st = (!unit.isGeneral && unit.stance) ? (STANCES_DATA[unit.stance] || {}) : {};
  const terrainKey = (unit.q != null && unit.r != null) ? `${unit.q},${unit.r}` : null;
  const terrainType = terrainKey ? (terrainData[terrainKey] || 'plain') : 'plain';
  const tr = TERRAINS_DATA[terrainType] || TERRAINS_DATA.plain;
  const terrainName = tr.name || terrainType;

  function sb(label, value, color, tooltip) {
    const style = color ? ` style="color:${color}"` : '';
    const tip = tooltip ? ` title="${tooltip}"` : '';
    return `<div class="stat-box"${tip}><div class="stat-box-label">${label}</div><div class="stat-box-value"${style}>${value}</div></div>`;
  }

  function sbMod(label, base, stKey, trKey) {
    const sDelta = st[stKey] || 0;
    const tDelta = trKey ? (tr[trKey] || 0) : 0;
    const total = sDelta + tDelta;
    if (total === 0) return sb(label, base);
    const effective = base + total;
    const color = total > 0 ? '#80e080' : '#e08080';
    const sign = total > 0 ? '+' : '';
    const tip = `Base: ${base}${sDelta !== 0 ? ` | Posture: ${sDelta > 0 ? '+' : ''}${sDelta}` : ''}${tDelta !== 0 ? ` | Terrain: ${tDelta > 0 ? '+' : ''}${tDelta}` : ''}`;
    return sb(label, `${effective} <small style="opacity:0.7">(${sign}${total})</small>`, color, tip);
  }

  const speedLabel = unit.speedRemaining != null ? `${unit.speedRemaining}/${unit.speed}` : `${unit.speed}`;
  const rows = [];

  if (!unit.isGeneral) {
    // Vitalité / Moral
    rows.push(`<div class="stat-row">${sb('Vitalité', `${unit.vitality}/${unit.maxVitality}`)}${sb('Moral', `${unit.morale ?? '—'}/${unit.maxMorale ?? '—'}`)}</div>`);
    // Attaque / Défense
    rows.push(`<div class="stat-row">${sbMod('Attaque', unit.attack, 'attack_cac', 'attack_cac')}${sbMod('Défense', unit.defense, 'defense_cac', 'defense_cac')}</div>`);
    // Puissance / Armure / Intimidation
    rows.push(`<div class="stat-row">${sbMod('Puissance', unit.power, 'puissance_cac', 'puissance_cac')}${sbMod('Armure', unit.armor, 'armure', 'armure')}${sb('Intimidation', unit.intimidation ?? 0)}</div>`);
    // Vitesse
    rows.push(`<div class="stat-row">${sb('Vitesse', speedLabel)}${unit.range > 1 ? sb('Portée', `${unit.range} cases`) : ''}</div>`);
  } else {
    // Vitalité
    rows.push(`<div class="stat-row">${sb('Vitalité', `${unit.vitality}/${unit.maxVitality}`)}</div>`);
    // Force / Stratégie / Charisme
    rows.push(`<div class="stat-row">${sb('Force', unit.force)}${sb('Stratégie', unit.strategy)}${sb('Charisme', unit.charisma)}</div>`);
    // Puissance / Armure / Intimidation
    rows.push(`<div class="stat-row">${sb('Puissance', unit.power)}${sb('Armure', unit.armor)}${sb('Intimidation', unit.intimidation ?? 0)}</div>`);
    // Vitesse
    rows.push(`<div class="stat-row">${sb('Vitesse', speedLabel)}</div>`);
  }

  const bonusTitle = `<div style="text-align:center;font-size:0.68em;color:#5a3c10;text-transform:uppercase;letter-spacing:0.08em;margin-top:8px;margin-bottom:3px">Bonus</div>`;

  // Bonus de l'unité
  if (!unit.isGeneral && unit.bonus) {
    rows.push(bonusTitle + `<div style="padding:6px 4px;background:#0a0603;border:1px solid #3a2408;border-radius:3px;font-size:0.72em;line-height:1.5;color:#a89060">${unit.bonus}</div>`);
  }

  // Capacités du général
  if (unit.isGeneral) {
    const gData = GENERALS_GAME_DATA.find(g => g.id === unit.generalId) || unit;
    const active = unit.activeAbility || gData?.activeAbility;
    const passive = unit.passiveAbility || gData?.passiveAbility;
    if (active || passive) rows.push(bonusTitle);
    if (active) {
      rows.push(`<div style="padding:6px 4px;background:#0a0603;border:1px solid #3a2408;border-radius:3px;font-size:0.72em;line-height:1.5;margin-bottom:3px">
        <div style="color:#ffd700;font-weight:bold;margin-bottom:2px">⚡ ${active.name}</div>
        <div style="color:#a89060">${active.description}</div>
        <div style="color:#5a3c10;margin-top:2px">Recharge : ${active.cooldown} tours</div>
      </div>`);
    }
    if (passive) {
      rows.push(`<div style="padding:6px 4px;background:#0a0603;border:1px solid #3a2408;border-radius:3px;font-size:0.72em;line-height:1.5">
        <div style="color:#c8a84b;font-weight:bold;margin-bottom:2px">☽ ${passive.name}</div>
        <div style="color:#a89060">${passive.description}</div>
      </div>`);
    }
  }

  const statsEl = document.getElementById('detail-stats');
  if (previewOnly) {
    const label = previewLabel || stanceNames[unit.stance] || unit.stance || '';
    statsEl.innerHTML = `<div style="font-size:0.68em;color:#c8960c;text-align:center;margin-bottom:4px;letter-spacing:0.05em">↳ Aperçu : ${label}</div>` + rows.join('');
  } else {
    statsEl.innerHTML = rows.join('');
  }
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
  // Sync onglet "Mon armée" si visible
  const armyContainer = document.getElementById('army-list');
  if (armyContainer && document.getElementById('pane-army')?.classList.contains('active') && deployState && !gameState) {
    renderDeployUnitsInArmy(armyContainer);
  }
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

function toggleCoords() {
  showCoords = !showCoords;
  document.getElementById('tool-coords').classList.toggle('active', showCoords);
  render();
}

function toggleWeakness() {
  showWeakness = !showWeakness;
  document.getElementById('tool-weakness').classList.toggle('active', showWeakness);
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
      <span class="i-name">${roll.generalName || roll.playerName}</span>
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
      portraitHtml = `<div class="to-portrait-placeholder">★</div>`;
    }

    const name = roll?.generalName || roll?.playerName || id;
    const div = document.createElement('div');
    div.className = `turn-order-item${isCurrent ? ' current' : ''}${hasPlayed ? ' played' : ''}`;
    div.innerHTML = `${portraitHtml}<span class="to-name">${name}</span>`;
    list.appendChild(div);
  }
}

function getPlayerDisplayName(playerId) {
  const p = gameState?.players?.find(pl => pl.id === playerId);
  return p?.generalName || p?.name || playerId;
}

function endTurn() {
  if (gameState?.currentPlayerId !== myId) return;
  wsSend('end_turn', { roomCode });
  selectedUnit = null;
  pendingMoveTarget = null;
  pendingMovePath = [];
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

function toggleToolbar() {
  const toolbar = document.getElementById('toolbar');
  const btn = document.getElementById('tool-toggle');
  const collapsed = toolbar.classList.toggle('collapsed');
  btn.textContent = collapsed ? '▲' : '▼';
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const container = document.getElementById('game-container');
  const btn = document.getElementById('sidebar-toggle');
  const collapsed = sidebar.classList.toggle('collapsed');
  container.classList.toggle('sidebar-collapsed', collapsed);
  btn.textContent = collapsed ? '◀' : '▶';
}

function switchSidebarTab(tab) {
  const tabs = ['units', 'army', 'history', 'chat'];
  document.querySelectorAll('.sidebar-tab').forEach((el, i) => {
    el.classList.toggle('active', tabs[i] === tab);
  });
  document.getElementById('pane-units').classList.toggle('active', tab === 'units');
  document.getElementById('pane-army').classList.toggle('active', tab === 'army');
  document.getElementById('pane-history').classList.toggle('active', tab === 'history');
  document.getElementById('pane-chat').classList.toggle('active', tab === 'chat');
  if (tab === 'chat') {
    document.getElementById('tab-chat').classList.remove('unread');
    const msgs = document.getElementById('chat-messages');
    msgs.scrollTop = msgs.scrollHeight;
    document.getElementById('chat-input').focus();
  }
  if (tab === 'army') renderArmyList();
  updateActionButtons();
}

function renderDeployUnitsInArmy(container) {
  container.innerHTML = '';
  const units = deployState.units;
  const sorted = [...units].sort((a, b) => {
    if (a.isGeneral && !b.isGeneral) return -1;
    if (!a.isGeneral && b.isGeneral) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });
  for (const u of sorted) {
    const placed = u.q !== null;
    const isSelected = selectedUnit && selectedUnit.id === u.id;
    const row = document.createElement('div');
    row.className = 'army-unit-row' + (u.isGeneral ? ' is-general' : '') + (isSelected ? ' selected' : '');
    let imgHtml = '';
    if (u.isGeneral) {
      const gid = deployState.generalData?.id;
      const entry = gid ? GENERAL_IMAGE1_MAP[gid] : null;
      imgHtml = entry
        ? `<img class="army-unit-icon" src="/assets/unites/GENERAL IMAGE 1-1/${encodeURIComponent(entry.file)}.${entry.ext}" onerror="this.style.display='none'">`
        : `<div class="army-unit-icon-placeholder"></div>`;
    } else {
      const entry = u.typeId ? UNIT_IMAGE1_MAP[u.typeId] : null;
      imgHtml = entry
        ? `<img class="army-unit-icon" src="/assets/unites/UNIT IMAGE 1-1/${encodeURIComponent(entry.file)}.${entry.ext}" onerror="this.style.display='none'">`
        : `<div class="army-unit-icon-placeholder"></div>`;
    }
    row.innerHTML = imgHtml + `
      <div class="army-unit-info">
        <div class="army-unit-name${u.isGeneral ? ' general' : ''}">${u.name}${u.isGeneral ? ' ★' : ''}</div>
        <div class="army-unit-status" style="color:${placed ? '#4aaa4a' : '#c8960c'}">${placed ? '✓ Placé' : 'À placer'}</div>
      </div>`;
    row.onclick = () => {
      selectedUnit = u;
      renderDeployUnitsInArmy(container);
      render();
    };
    container.appendChild(row);
  }
}

function renderArmyList() {
  const container = document.getElementById('army-list');
  if (!container) return;
  // En déploiement, afficher les unités à placer
  if (deployState && !gameState) {
    renderDeployUnitsInArmy(container);
    return;
  }
  const units = gameState?.myUnits;
  if (!units || units.length === 0) {
    container.innerHTML = '<div style="color:#5a3c10;font-style:italic;padding:12px">Aucune unité.</div>';
    return;
  }

  // Général en premier, puis les autres triés par nom
  const sorted = [...units].sort((a, b) => {
    if (a.isGeneral && !b.isGeneral) return -1;
    if (!a.isGeneral && b.isGeneral) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  container.innerHTML = '';
  for (const unit of sorted) {
    const isDead = unit.vitality <= 0;
    const row = document.createElement('div');
    row.className = 'army-unit-row' + (unit.isGeneral ? ' is-general' : '') + (isDead ? ' dead' : '');
    row.onclick = () => {
      switchSidebarTab('units');
      selectUnit({ ...unit, isMine: true });
    };

    // Image
    let imgHtml = '';
    if (unit.isGeneral) {
      const gid = getGeneralIdForUnit(unit);
      const entry = gid ? GENERAL_IMAGE1_MAP[gid] : null;
      if (entry) {
        imgHtml = `<img class="army-unit-icon" src="/assets/unites/GENERAL IMAGE 1-1/${encodeURIComponent(entry.file)}.${entry.ext}" onerror="this.style.display='none'">`;
      } else {
        imgHtml = `<div class="army-unit-icon-placeholder"></div>`;
      }
    } else {
      const entry = unit.typeId ? UNIT_IMAGE1_MAP[unit.typeId] : null;
      if (entry) {
        imgHtml = `<img class="army-unit-icon" src="/assets/unites/UNIT IMAGE 1-1/${encodeURIComponent(entry.file)}.${entry.ext}" onerror="this.style.display='none'">`;
      } else {
        imgHtml = `<div class="army-unit-icon-placeholder"></div>`;
      }
    }

    // Barres
    const hpPct = unit.maxVitality > 0 ? Math.max(0, unit.vitality / unit.maxVitality * 100) : 0;
    const hpColor = hpPct > 60 ? '#4a9040' : hpPct > 30 ? '#b07020' : '#902020';
    const morPct = unit.maxMorale > 0 ? Math.max(0, unit.morale / unit.maxMorale * 100) : 0;
    const morColor = morPct > 60 ? '#4060b0' : morPct > 30 ? '#7050a0' : '#902020';

    // Statuts
    const statuses = [];
    if (unit.isFleeing) statuses.push('En fuite');
    if (unit.moved) statuses.push('Déplacé');
    if (unit.attacked) statuses.push('Attaqué');
    if (isDead) statuses.push('Mort');

    const armorHtml = unit.armor != null ? `<span style="color:#7a9060;margin-left:6px">🛡 ${unit.armor}</span>` : '';

    row.innerHTML = imgHtml + `
      <div class="army-unit-info">
        <div class="army-unit-name${unit.isGeneral ? ' general' : ''}">${unit.name}${unit.isGeneral ? ' ★' : ''}</div>
        <div style="display:flex;align-items:center;gap:4px;margin-top:2px">
          <span style="font-size:0.65em;color:#5a7a40;flex-shrink:0">PV</span>
          <div class="army-unit-hp" style="flex:1"><div class="army-unit-hp-bar" style="width:${hpPct}%;background:${hpColor}"></div></div>
          <span style="font-size:0.65em;color:#7a5820;flex-shrink:0">${unit.vitality}/${unit.maxVitality}</span>
        </div>
        ${unit.maxMorale > 0 ? `<div style="display:flex;align-items:center;gap:4px;margin-top:2px">
          <span style="font-size:0.65em;color:#405080;flex-shrink:0">Mo</span>
          <div class="army-unit-hp" style="flex:1"><div class="army-unit-hp-bar" style="width:${morPct}%;background:${morColor}"></div></div>
          <span style="font-size:0.65em;color:#7a5820;flex-shrink:0">${unit.morale}/${unit.maxMorale}</span>
        </div>` : ''}
        <div class="army-unit-status">${armorHtml}${statuses.length ? (armorHtml ? ' · ' : '') + statuses.join(', ') : ''}</div>
      </div>`;
    container.appendChild(row);
  }
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  wsSend('chat_message', { roomCode, text });
  input.value = '';
}

function appendChatMessage({ authorName, text, isMine, isSystem, authorId }) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  if (isSystem) {
    div.className = 'chat-msg system';
    div.textContent = text;
  } else {
    const players = gameState?.players || deployState?.players || [];
    const color = authorId ? (players.find(p => p.id === authorId)?.color || '#c8960c') : '#c8960c';
    div.className = `chat-msg ${isMine ? 'mine' : 'other'}`;
    div.innerHTML = `<span class="chat-author" style="color:${color}">${authorName} : </span><span class="chat-text">${text}</span>`;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  const pane = document.getElementById('pane-chat');
  if (!pane.classList.contains('active')) {
    document.getElementById('tab-chat').classList.add('unread');
  }
}

let combatHistoryEntries = [];
let historyLastTurn = 0;
const historyTurnOrders = {}; // turn -> { turnOrder, rolls }
let historyCurrentManche = null; // { playerId, turn, manche, contentEl, actionsCount }
let historyMancheCounter = 0;

function recordTurnOrder(turn, turnOrder, rolls) {
  historyTurnOrders[turn] = { turnOrder, rolls };
}

function toggleHistoryTurnOrder(turn) {
  const el = document.getElementById(`turn-order-${turn}`);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function toggleHistoryTurn(turn) {
  const container = document.getElementById('combat-history');
  if (!container) return;
  const wrappers = container.querySelectorAll(`[data-turn="${turn}"]`);
  const arrow = document.getElementById(`turn-arrow-${turn}`);
  const anyVisible = Array.from(wrappers).some(w => w.style.display !== 'none');
  wrappers.forEach(w => { w.style.display = anyVisible ? 'none' : ''; });
  if (arrow) arrow.textContent = anyVisible ? '▶' : '▼';
}

function toggleManche(id) {
  const content = document.getElementById(`mc-${id}`);
  const arrow = document.getElementById(`ma-${id}`);
  if (!content) return;
  const open = content.style.display !== 'none';
  content.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▶' : '▼';
}

function _closeMancheSection() {
  if (!historyCurrentManche) return;
  if (historyCurrentManche.actionsCount === 0) {
    const idle = document.createElement('div');
    idle.className = 'manche-idle';
    idle.textContent = 'Rien de spécial.';
    historyCurrentManche.contentEl.appendChild(idle);
  }
  historyCurrentManche = null;
}

function _openMancheSection(playerId, playerName, generalName, turn, manche, playerColor) {
  _closeMancheSection();
  const container = document.getElementById('combat-history');
  if (!container) return;
  // Supprimer le placeholder si présent
  const placeholder = container.querySelector('div[style*="italic"]');
  if (placeholder) placeholder.remove();
  // Séparateur de tour si nouveau tour
  if (turn !== historyLastTurn) {
    historyLastTurn = turn;
    const sep = document.createElement('div');
    sep.style.cssText = 'background:#1a0d04;color:#c8960c;font-weight:bold;padding:4px 8px;margin-top:6px;border-top:1px solid #5a3c10;font-size:0.8em;cursor:pointer;user-select:none;';
    const tData = historyTurnOrders[turn];
    if (tData) {
      const { turnOrder, rolls } = tData;
      const orderText = turnOrder.map((id, i) => {
        const r = rolls?.[id];
        const n = r?.generalName || r?.playerName || id;
        const g = '';
        const rv = r ? ` — Str${r.strategy}+D20${r.d20}=${r.total}` : '';
        return `<div style="padding:2px 12px;color:${id === myId ? '#ffd700' : '#c8a060'}">${i+1}. ${n}${g}${rv}</div>`;
      }).join('');
      sep.innerHTML = `<span style="display:flex;align-items:center;gap:8px"><span onclick="toggleHistoryTurn(${turn})" style="cursor:pointer" id="turn-arrow-${turn}">▼</span><span onclick="toggleHistoryTurnOrder(${turn})" style="cursor:pointer">── Tour ${turn} ── <span style="font-size:0.85em;opacity:0.6">(ordre ▾)</span></span></span><div id="turn-order-${turn}" style="display:none;margin-top:4px;font-weight:normal;font-size:0.9em">${orderText}</div>`;
    } else {
      sep.innerHTML = `<span style="display:flex;align-items:center;gap:8px"><span onclick="toggleHistoryTurn(${turn})" style="cursor:pointer" id="turn-arrow-${turn}">▼</span><span>── Tour ${turn} ──</span></span>`;
    }
    container.appendChild(sep);
  }
  // Section manche
  const mid = historyMancheCounter++;
  const isMe = playerId === myId;
  const color = playerColor || '#c8a84b';
  const wrapper = document.createElement('div');
  wrapper.dataset.turn = turn;
  const contentId = `mc-${mid}`;
  wrapper.innerHTML = `<div class="manche-header${isMe ? ' mine' : ''}" onclick="toggleManche(${mid})" style="border-left-color:${color}">
    <span class="m-arrow" id="ma-${mid}">▶</span>
    <span class="m-name" style="color:${color}">${playerName}</span>
    <span class="m-sub">${generalName ? `${generalName} · ` : ''}T${turn}.${manche}</span>
  </div>
  <div class="manche-content" id="${contentId}" style="display:none"></div>`;
  container.appendChild(wrapper);
  container.scrollTop = container.scrollHeight;
  historyCurrentManche = { playerId, turn, manche, contentEl: wrapper.querySelector(`#${contentId}`), actionsCount: 0 };
}

function addCombatHistory(log) {
  combatHistoryEntries.push(log);
  if (!historyCurrentManche) return;
  const entry = document.createElement('div');
  entry.innerHTML = formatHistoryEntry(log);
  historyCurrentManche.contentEl.appendChild(entry.firstElementChild);
  historyCurrentManche.actionsCount++;
  // Auto-ouvrir si action ajoutée
  const contentEl = historyCurrentManche.contentEl;
  contentEl.style.display = 'block';
  const mid = contentEl.id.replace('mc-', '');
  const arrow = document.getElementById(`ma-${mid}`);
  if (arrow) arrow.textContent = '▼';
  const container = document.getElementById('combat-history');
  if (container) container.scrollTop = container.scrollHeight;
}

function addHistoryAction(playerId, html) {
  if (!historyCurrentManche) return;
  const entry = document.createElement('div');
  entry.innerHTML = html;
  historyCurrentManche.contentEl.appendChild(entry);
  historyCurrentManche.actionsCount++;
  const contentEl = historyCurrentManche.contentEl;
  contentEl.style.display = 'block';
  const mid = contentEl.id.replace('mc-', '');
  const arrow = document.getElementById(`ma-${mid}`);
  if (arrow) arrow.textContent = '▼';
  const container = document.getElementById('combat-history');
  if (container) container.scrollTop = container.scrollHeight;
}

let historyCounter = 0;
function formatHistoryEntry(log) {
  if (!log) return '';
  const id = `h${historyCounter++}`;
  const b = log.breakdown || {};
  const hit = log.hit;
  const attackerColor = gameState?.players?.find(p => p.id === log.attackerPlayerId)?.color || '#c8a84b';
  const targetColor   = gameState?.players?.find(p => p.id === log.targetPlayerId)?.color   || '#a08060';
  const tgtName = log.targetName   || '?';
  const atkName = log.attackerName || '?';

  // Header
  const hitBadge = hit ? `<span class="h-badge h-hit">TOUCHÉ</span>` : `<span class="h-badge h-miss">RATÉ</span>`;
  const trampleBadge = log.trample ? `<span class="h-badge" style="background:#8a4010;color:#ffd080">PIÉTINEMENT</span>` : '';
  const header = `<div class="h-header" onclick="toggleHistory('${id}')" style="border-left:3px solid ${attackerColor};">
    <span class="h-arrow" id="arrow-${id}">▶</span>
    <span class="h-title"><b style="color:${attackerColor}">${atkName}</b> → <b style="color:${targetColor}">${tgtName}</b></span>
    ${trampleBadge}${hitBadge}
    ${log.targetKilled   ? `<span class="h-badge h-dead">💀</span>` : ''}
    ${log.attackerKilled ? `<span class="h-badge h-dead">💀 (att.)</span>` : ''}
  </div>`;

  const ngoAtt  = b.NGOAtt ?? 0;
  const ngoDef  = b.NGODef ?? 0;
  const att     = b.attReussite ?? 0;
  const defR    = b.defReussite ?? 0;
  const isCac   = log.defenseChoice !== undefined;
  const ds      = log.defenseSuccess;
  const isCounter = isCac && log.defenseChoice === 'counter';
  const isAbsorb  = isCac && log.defenseChoice === 'absorb';
  const isRien    = isCac && log.defenseChoice === 'rien';
  const defTitle  = isCounter ? '⚔ Contre-Attaque' : isAbsorb ? '🛡 Encaissement' : '🛡 Défense impossible';

  const stanceLabels = { marche:'Marche', combat:'Combat', charge:'Charge', repos:'Repos', defense_combat:'Déf. Combat', defense_distance:'Déf. Distance' };
  const terrainLabels = { plain:'Plaines', forest:'Forêts', river:'Fleuve', road:'Route', building:'Bâtiment', bridge:'Pont' };
  const atkStanceName = stanceLabels[b.attackerStance] || b.attackerStance || '—';
  const defStanceName = stanceLabels[b.defenderStance] || b.defenderStance || '—';
  const atkTerrainName = terrainLabels[b.attackerTerrain] || b.attackerTerrain || '—';
  const defTerrainName = terrainLabels[b.defenderTerrain] || b.defenderTerrain || '—';

  // Helpers
  const modTag = (val, lbl) => {
    if (!val) return '';
    return `<span class="${val > 0 ? 'h-mod-pos' : 'h-mod-neg'}">(${val > 0 ? '+' : ''}${val} ${lbl})</span>`;
  };
  const modsLine = (...mods) => {
    const parts = mods.map(([v, l]) => modTag(v, l)).filter(Boolean);
    return parts.length ? `<div class="h-mods">${parts.join(' ')}</div>` : `<div class="h-mods-placeholder"></div>`;
  };
  const statVal = (base, eff, ...mods) => {
    const modHtml = mods.map(([v, l]) => modTag(v, l)).join(' ');
    const modPart = modHtml ? ` ${modHtml}` : '';
    if (base === eff) return `${eff}${modPart}`;
    return `${base} = <b>${eff}</b>${modPart}`;
  };
  const row = (lbl, val, pct) => {
    const pctHtml = pct != null ? `<span class="h-pct">[${pct}%]</span>` : '';
    return `<div class="h-row"><span class="h-lbl">${lbl}</span><span class="h-val">${val}</span>${pctHtml}</div>`;
  };
  const sep  = `<div class="h-sep"></div>`;
  const sep2 = `<div class="h-sep"></div><div class="h-sep2"></div>`;
  const emptyRow = `<div class="h-row"><span class="h-lbl" style="color:#333">—</span></div>`;

  const atkPct = ngoAtt > 0 ? Math.round(att  / ngoAtt * 100) : 0;
  const defPct = ngoDef > 0 ? Math.round(defR / ngoDef * 100) : 0;

  // ── ROLLS ──
  const isGeneralAtk = b.generalD20 != null;
  const atkMods = modsLine(
    [b.modAngle, b.angleName], [b.modAtkStance, atkStanceName], [b.modAtkTerrain, atkTerrainName],
    [b.modEsquive, 'esquive'], [b.modHauteur, 'hauteur']
  );
  let leftRoll = '';
  if (isGeneralAtk) {
    leftRoll += row('Force', b.attackBase ?? '?');
    leftRoll += row('D20', `<span class="h-val-miss">${b.generalD20}</span>`);
    leftRoll += `<div class="h-mods-placeholder"></div>`;
    leftRoll += row('Résultat', `<b>${b.generalAttValue ?? '?'}</b>`);
  } else {
    leftRoll += row('GO', ngoAtt);
    leftRoll += row('Attaque', statVal(b.attackBase ?? '?', b.attackEff ?? '?'));
    leftRoll += atkMods;
    leftRoll += row('Nb touche', `<span class="${att > 0 ? 'h-val-hit' : 'h-val-miss'}">${att} / ${ngoAtt}</span>`, atkPct);
  }

  const isGeneralDef = b.generalD20Def != null;
  let rightRoll = '';
  if (isCounter || isAbsorb) {
    if (isGeneralDef) {
      rightRoll += row('Force', b.defBase ?? '?');
      rightRoll += row('D20', `<span class="h-val-miss">${b.generalD20Def}</span>`);
      rightRoll += `<div class="h-mods-placeholder"></div>`;
      rightRoll += row('Résultat', `<b>${b.generalAttValueDef ?? '?'}</b>`);
    } else {
      const defMods = modsLine(
        [b.modDefAngle, b.angleName], [b.modDefStance, defStanceName], [b.modDefTerrain, defTerrainName],
        [b.modPrecision, 'précision'], [b.modHauteurDef, 'hauteur']
      );
      rightRoll += row('GO', ngoDef);
      rightRoll += row('Défense', statVal(b.defBase ?? '?', b.defEff ?? '?'));
      rightRoll += defMods;
      rightRoll += row('Nb touche', `<span class="${defR > 0 ? 'h-val-hit' : 'h-val-miss'}">${defR} / ${ngoDef}</span>`, defPct);
    }
  } else {
    // Rien — miroir vide pour aligner
    rightRoll += emptyRow + emptyRow + `<div class="h-mods-placeholder"></div>` + emptyRow;
  }

  // ── DÉGÂTS ──
  const pwrAttBase = statVal(b.basePowerAtt ?? '?', b.effectivePowerAtt ?? '?');
  const pwrAttMods = modsLine([(b.lancierBonus || 0), 'lancier'], [b.modPwrAtt, atkStanceName]);
  const arDefBase  = statVal(b.baseArmorDef ?? '?', b.effectiveArmorDef ?? '?');
  const arDefMods  = modsLine([b.modArmorDefAngle, b.angleName], [b.modArmorDefStance, defStanceName], [b.modArmorDefTerrain, defTerrainName],
    [(b.phalangeBonus || 0), 'phalange'], [(b.lancierRangedBonus || 0), 'lancier']);
  const ratARDefPct = b.ratARDef != null ? `${Math.round(b.ratARDef * 100)}%` : '?';

  let leftDmg = '';
  if (isGeneralAtk) {
    leftDmg += row('Puissance /5 ÷2', `${b.basePowerAtt ?? '?'}`);
    leftDmg += `<div class="h-mods-placeholder"></div>`;
  } else {
    leftDmg += row('Puissance', pwrAttBase);
    leftDmg += pwrAttMods;
  }
  leftDmg += row('Armure déf.', arDefBase);
  leftDmg += arDefMods;
  leftDmg += row('%Armure', ratARDefPct);
  leftDmg += sep;
  if (isGeneralAtk || att > 0) {
    const div2Att = isAbsorb ? ` <span style="color:#888;font-size:0.85em">(÷2)</span>` : '';
    leftDmg += row(`(${tgtName}) tués`, `<span class="h-val-hit">${log.dmgReceived ?? 0}</span>${div2Att}`);
  } else {
    leftDmg += emptyRow;
  }

  let rightDmg = '';
  if (isCounter || isAbsorb) {
    const pwrDefBase = isGeneralDef ? `${b.basePowerDef ?? '?'}` : statVal(b.basePowerDef ?? '?', b.effectivePowerDef ?? '?');
    const pwrDefMods = isGeneralDef ? `<div class="h-mods-placeholder"></div>` : modsLine([(b.lancierBonusDef || 0), 'lancier'], [b.modPwrDef, defStanceName]);
    const arAttBase  = statVal(b.baseArmorAtt ?? '?', b.effectiveArmorAtt ?? '?');
    const arAttMods  = modsLine([b.modArmorAttStance, atkStanceName], [b.modArmorAttTerrain, atkTerrainName]);
    const ratARAtt2 = b.ratARAtt != null ? `${Math.round(b.ratARAtt * 100)}%` : '?';
    rightDmg += row(isGeneralDef ? 'Puissance /5 ÷2' : 'Puissance', pwrDefBase);
    rightDmg += pwrDefMods;
    rightDmg += row('Armure att.', arAttBase);
    rightDmg += arAttMods;
    rightDmg += row('%Armure', ratARAtt2);
    rightDmg += sep;
    if ((isCounter && (ds || isGeneralDef)) || isAbsorb) {
      const div2 = isAbsorb ? ` <span style="color:#888;font-size:0.85em">(÷2)</span>` : '';
      rightDmg += row(`(${atkName}) tués`, `<span class="h-val-hit">${log.counterDmgReceived ?? 0}</span>${div2}`);
    } else {
      rightDmg += emptyRow;
    }
  } else {
    rightDmg += emptyRow + `<div class="h-mods-placeholder"></div>` + emptyRow + `<div class="h-mods-placeholder"></div>` + emptyRow + sep + emptyRow;
  }

  // ── MORAL ──
  const intimAttBase = (b.effectiveIntimidation ?? 0) - (b.modIntimAtt ?? 0);
  const intimAttStr  = statVal(intimAttBase, b.effectiveIntimidation ?? '?', [b.modIntimAtt, atkStanceName]);

  let leftMoral = '';
  if (isGeneralAtk) {
    const charismeVal = (b.attackerCharisma ?? 0) - (b.generalD20 ?? 0) + 80;
    leftMoral += row('Charisme', b.attackerCharisma ?? '?');
    leftMoral += row('D20', `<span class="h-val-miss">${b.generalD20 ?? '?'}</span>`);
    leftMoral += sep;
    leftMoral += row('Intimidation /100', b.effectiveIntimidation ?? '?');
  } else {
    leftMoral += row('Intimidation', intimAttStr);
  }
  leftMoral += sep;
  leftMoral += (log.moralDmg ?? 0) > 0
    ? row(`(${tgtName}) démoral.`, `<span class="h-val-hit">${log.moralDmg}</span>`)
    : emptyRow;

  let rightMoral = '';
  if ((isCounter || isAbsorb) && b.counterIntimidation != null) {
    if (isGeneralDef) {
      rightMoral += row('Charisme', b.defenderCharisma ?? '?');
      rightMoral += row('D20', `<span class="h-val-miss">${b.generalD20Def ?? '?'}</span>`);
      rightMoral += sep;
      rightMoral += row('Intimidation /100', b.counterIntimidation ?? '?');
    } else {
      const intimDefBase = b.counterIntimidation - (b.modIntimDef ?? 0);
      const intimDefStr  = statVal(intimDefBase, b.counterIntimidation, [b.modIntimDef, defStanceName]);
      rightMoral += row('Intimidation', intimDefStr);
    }
    rightMoral += sep;
    rightMoral += (log.counterMoralDmg ?? 0) > 0
      ? row(`(${atkName}) démoral.`, `<span class="h-val-hit">${log.counterMoralDmg}</span>`)
      : emptyRow;
  } else {
    rightMoral += emptyRow + sep + emptyRow;
  }

  const leftAll  = leftRoll  + sep2 + leftDmg  + sep2 + leftMoral;
  const rightAll = rightRoll + sep2 + rightDmg + sep2 + rightMoral;

  const detail = `<div class="h-detail" id="${id}" style="display:none">
    <div class="h-dual">
      <div class="h-side">
        <div class="h-side-title">⚔ Attaque</div>
        ${leftAll}
      </div>
      <div class="h-side${isRien ? ' h-side-none' : ''}">
        <div class="h-side-title">${defTitle}</div>
        ${rightAll}
      </div>
    </div>
  </div>`;

  return `<div class="history-entry">${header}${detail}</div>`;
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
  if (panel) panel.style.display = 'none';
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
    ['Courage',      t.courage_cac,     t.courage_tir],
    ['Esquive',      t.esquive_cac,     t.esquive_tir],
    ['Précision',    t.precision_cac,   t.precision_tir],
  ], showTirT);
  if (t.vitesse      !== 0) html += `<div class="tt-extra">${cell1(t.vitesse)} Vitesse</div>`;
  if (t.armure       !== 0) html += `<div class="tt-extra">${cell1(t.armure)} Armure</div>`;
  if (t.armure_tour  !== 0) html += `<div class="tt-extra">${cell1(t.armure_tour)} Armure/tour</div>`;
  if (t.moral_tour   !== 0) html += `<div class="tt-extra">${cell1(t.moral_tour)} Moral/tour</div>`;
  if (t.vitalite_tour !== 0) html += `<div class="tt-extra">${cell1(t.vitalite_tour)} Vita/tour</div>`;
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
    ['Courage',      s.courage_cac,      s.courage_tir],
    ['Esquive',      s.esquive_cac,      s.esquive_tir],
    ['Précision',    s.precision_cac,    s.precision_tir],
  ], isRanged);
  if (s.vitesse       !== 0) html += `<div class="tt-extra">${cell1(s.vitesse)} Vitesse</div>`;
  if (s.armure        !== 0) html += `<div class="tt-extra">${cell1(s.armure)} Armure</div>`;
  if (s.armure_tour   !== 0) html += `<div class="tt-extra">${cell1(s.armure_tour)} Armure/tour</div>`;
  if (s.moral_tour    !== 0) html += `<div class="tt-extra">${cell1(s.moral_tour)} Moral/tour</div>`;
  if (s.vitalite_tour !== 0) html += `<div class="tt-extra">${cell1(s.vitalite_tour)} Vita/tour</div>`;
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
  wsSend('change_stance', { roomCode, unitId, stanceId });
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
  const b = log.breakdown || {};
  const hit = log.hit;
  const defLabels = { counter:'Contre-attaque', absorb:'Encaissement', rien:'Rien' };
  let html = `<b>${log.attackerName}</b> → <b>${log.targetName}</b> &nbsp;`;
  html += hit ? `<span style="color:#f90;font-weight:bold">TOUCHÉ</span>` : `<span style="color:#aaa">RATÉ</span>`;
  html += `<br>`;
  if (hit) {
    const ratPct = b.ratARDef != null ? `${Math.round(b.ratARDef * 100)}%` : '';
    html += `<span style="color:#aaa">Dégâts</span> <b style="color:#ff9060">${log.dmgReceived}</b>`;
    if (ratPct) html += ` <span style="color:#555">(arm. ${ratPct})</span>`;
    if (log.moralDmg > 0) html += ` &nbsp;<span style="color:#aaa">Moral −${log.moralDmg}</span>`;
    html += `<br>`;
  }
  if (log.defenseChoice && log.defenseChoice !== 'rien') {
    const defLabel = defLabels[log.defenseChoice] || log.defenseChoice;
    html += `<span style="color:#aaa">${defLabel}</span> : `;
    if (log.defenseChoice === 'absorb') {
      html += `<b style="color:#80c060">${log.counterDmgReceived ?? 0} PV absorbés</b>`;
    } else {
      html += log.defenseSuccess
        ? `<span style="color:#4f4">Succès</span> → <b style="color:#ff9060">${log.counterDmgReceived} PV</b>`
        : `<span style="color:#f44">Raté</span>`;
    }
    if (log.counterMoralDmg > 0) html += ` &nbsp;<span style="color:#aaa">Moral −${log.counterMoralDmg}</span>`;
    html += `<br>`;
  }
  if (log.targetKilled)   html += `<span style="color:#f84">💀 ${log.targetName} éliminé</span><br>`;
  if (log.attackerKilled) html += `<span style="color:#f84">💀 ${log.attackerName} éliminé</span><br>`;
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
  const btnCounter = document.getElementById('btn-defense-counter');
  const btnAbsorb = document.getElementById('btn-defense-absorb');
  const archerTypes = ['archer', 'archer_elite'];
  if (data.isRanged) {
    if (btnCounter) btnCounter.style.display = 'none';
    const phalangeCanAbsorb = data.targetTypeId === 'phalange' && !archerTypes.includes(data.attackerTypeId);
    if (btnAbsorb) btnAbsorb.style.display = phalangeCanAbsorb ? '' : 'none';
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
    document.getElementById('btn-deploy-ready-center').style.display = 'block';
    renderDeployUnitList(deployState.units);
    switchSidebarTab('army');
    resizeCanvas();
    if (deployState.startingZone) {
      const { x, y } = hexToPixel(deployState.startingZone.q, deployState.startingZone.r);
      camX = -x * zoom;
      camY = -y * zoom;
    }
    render();
  }
}

function wsDispatch(event, data) {
  switch (event) {
    case 'deployment_state': {
      myId = data.myId;
      sessionStorage.setItem('myId', myId);
      deployState = data;
      buildZoneTileSet(deployState);
      if (mode !== 'deploy') {
        mode = 'deploy';
        setMode('deploy');
        document.getElementById('sidebar-title').textContent = 'Déploiement';
        if (deployState.startingZone) {
          const { x, y } = hexToPixel(deployState.startingZone.q, deployState.startingZone.r);
          smoothPanTo(x, y, 600);
        }
      }
      renderDeployUnitList(data.units);
      updateActionButtons();
      render();
      break;
    }
    case 'phase_change': {
      if (data.phase === 'battle') {
        deployState = null;
        sessionStorage.removeItem('deploymentState');
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
      myId = data.myId;
      sessionStorage.setItem('myId', myId);
      gameState = data;
      gameState.visibleHexes = new Set(data.visibleHexes);
      if (data.segmentData) segmentData = data.segmentData;
      if (data.isSpectator) isSpectator = true;

      document.getElementById('top-turn').textContent = `Tour ${data.turn} · Manche ${data.manche || 1}`;
      const currPlayer = data.players.find(p => p.id === data.currentPlayerId);
      document.getElementById('top-current-player').textContent =
        data.currentPlayerId === myId ? '⚔️ Votre manche' : `Manche de : ${currPlayer?.generalName || currPlayer?.name || '?'}`;
      document.getElementById('top-phase').textContent = data.phase === 'battle' ? 'Bataille' : '';
      document.getElementById('sidebar-title').textContent =
        data.currentPlayerId === myId ? 'Votre manche' : `Manche de ${currPlayer?.generalName || currPlayer?.name || '?'}`;
      if (data.phase === 'battle' && !historyCurrentManche) {
        const p = data.players?.find(pl => pl.id === data.currentPlayerId);
        const pName = p?.generalName || p?.name || data.currentPlayerId;
        const pColor = p?.color || '#c8a84b';
        _openMancheSection(data.currentPlayerId, pName, '', data.turn, data.manche || 1, pColor);
      }

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
      renderArmyList();
      updateActionButtons();
      render();
      if (pendingTurnPopup && pendingTurnPopup.playerId === data.currentPlayerId) {
        const ptp = pendingTurnPopup;
        pendingTurnPopup = null;
        const showPopup = () => {
          const ptpPlayer = gameState?.players.find(p => p.id === ptp.playerId);
          const ptpColor = ptpPlayer?.color || '#ffd700';
          const ptpName = ptp.playerId === myId ? 'Votre manche !' : `Manche de ${ptpPlayer?.generalName || ptpPlayer?.name || '?'}`;
          const ptpSub = `Tour ${ptp.turn} · Manche ${ptp.manche || 1}`;
          if (ptp.playerId === myId) {
            const myGeneral = gameState?.units?.find(u => u.playerId === myId && u.isGeneral);
            if (myGeneral) { const { x, y } = hexToPixel(myGeneral.q, myGeneral.r); smoothPanTo(x, y); }
            const canAct = gameState?.units?.some(u => u.playerId === myId && (u.speedRemaining > 0 || !u.hasAttacked));
            if (!canAct) {
              wsSend('end_turn', { roomCode });
            } else {
              showTurnPopup(ptpName, ptpSub, ptpColor);
            }
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
      }
      selectedUnit = null;
      movableTiles.clear();
      attackableTiles.clear();
      rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
      updateActionButtons();
      pendingTurnPopup = { playerId: data.currentPlayerId, turn: data.turn, manche: data.manche, newRound: data.manche === 1 };
      // Ouvrir section manche dans l'historique
      {
        const p = gameState?.players?.find(pl => pl.id === data.currentPlayerId);
        const pName = p?.generalName || p?.name || data.currentPlayerId;
        const pColor = p?.color || '#c8a84b';
        _openMancheSection(data.currentPlayerId, pName, '', data.turn, data.manche, pColor);
      }
      break;
    }
    case 'initiative_rolled':
      recordTurnOrder(data.turn, data.turnOrder, data.rolls);
      showInitiativeModal(data.rolls, data.turnOrder, data.turn);
      break;
    case 'combat_result': {
      const log = data.combatLog || data;
      addCombatLog(log);
      showCombatResult(log);
      addCombatHistory(log);
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
    case 'become_spectator':
      notify(`${data.winnerName} remporte la bataille ! Vous pouvez continuer à observer.`, 'info');
      isSpectator = true;
      updateActionButtons();
      render();
      break;
    case 'deployment_ready_update': {
      notify(`${data.readyCount}/${data.total} joueurs prêts…`, 'info');
      if (btn.disabled) {
        btn.textContent = `En attente… (${data.readyCount}/${data.total} prêts)`;
      } else {
        btn.textContent = `Prêt ! (${data.readyCount}/${data.total})`;
      }
      break;
    }
    case 'motivate_result': {
      let notifMsg, notifType, histMsg;
      if (data.critSuccess) {
        notifMsg = `⭐ SUCCÈS CRITIQUE ! (D20=1) → ${data.count} unité(s) regagnent tout leur moral !`;
        notifType = 'success';
        histMsg = `<div style="padding:4px 8px;color:#ffd700;font-size:0.8em">⭐ Motivation — Succès critique (D20=1) : ${data.count} unité(s) → moral max</div>`;
      } else if (data.critFail) {
        notifMsg = `💀 ÉCHEC CRITIQUE ! (D20=20) → ${data.count} unité(s) perdent 20 moral.`;
        notifType = 'error';
        histMsg = `<div style="padding:4px 8px;color:#ff6060;font-size:0.8em">💀 Motivation — Échec critique (D20=20) : ${data.count} unité(s) −20 moral</div>`;
      } else if (data.success) {
        notifMsg = `Motivation réussie ! (Charisme ${data.charisma} ≥ D20 ${data.d20}) → ${data.count} unité(s) regagnent ${data.moralGain} moral.`;
        notifType = 'success';
        histMsg = `<div style="padding:4px 8px;color:#80c080;font-size:0.8em">🎖 Motivation — Cha${data.charisma} ≥ D20 ${data.d20} : ${data.count} unité(s) +${data.moralGain} moral</div>`;
      } else {
        notifMsg = `Motivation échouée. (Charisme ${data.charisma} < D20 ${data.d20})`;
        notifType = 'info';
        histMsg = `<div style="padding:4px 8px;color:#a08060;font-size:0.8em">Motivation — Échec (Cha${data.charisma} < D20 ${data.d20})</div>`;
      }
      notify(notifMsg, notifType);
      addHistoryAction(data.playerId, histMsg);
      break;
    }
    case 'chat_message':
      appendChatMessage({ authorName: data.authorName, text: data.text, isMine: data.authorId === myId, authorId: data.authorId });
      break;
    case 'ping': {
      activePings.push({ q: data.q, r: data.r, color: data.color || '#ffd700', startTime: performance.now() });
      render();
      break;
    }
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
