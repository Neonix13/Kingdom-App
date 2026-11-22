let myId = null;
let roomCode = null;
let myRole = 'player';
let isHost = false;
let selectedGeneral = null;
let selectedColor = null;
let armyQuantities = {};
let budget = 2500;
let lastLobby = null;
let mapsList = [];
let modesList = [];
let armySubmitted = false;

const PLAYER_COLORS = [
  { hex: '#4a90d9', name: 'Bleu' },
  { hex: '#e05050', name: 'Rouge' },
  { hex: '#50c050', name: 'Vert' },
  { hex: '#e0a030', name: 'Or' },
  { hex: '#a050d0', name: 'Violet' },
  { hex: '#e07840', name: 'Orange' },
  { hex: '#40c0c0', name: 'Cyan' },
  { hex: '#e050a0', name: 'Rose' },
  { hex: '#ffffff', name: 'Blanc' },
];

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
  'go_kei':      null,
};

const GENERALS_DATA = [
  { id:'ou_ki', name:'Ou Ki', kingdom:'QIN', force:15, strategy:16, charisma:18, vitality:240, armor:4, weapon:{name:'Naginata',damage:12}, activeAbility:{name:'Sourire du Monstre',description:"Augmente la puissance de l'armée de 2 pendant 2 tours. Si l'armée ennemie est en infériorité numérique, réduit le moral de chaque unité adverse de 1.",cooldown:3}, passiveAbility:{name:'Oiseau Colossale',description:"Les généraux ennemis ont -3 en Force, Stratégie et Charisme. Les unités de l'armée d'Ou Ki ont +1 d'intimidation."}, citation:"«Ne l'as-tu pas encore compris ? La guerre, c'est amusant !»" },
  { id:'mou_bu', name:'Mou Bu', kingdom:'QIN', force:18, strategy:12, charisma:15, vitality:320, armor:6, weapon:{name:'Masse',damage:14}, activeAbility:{name:'Poing du Titan',description:"Réduit l'armure d'une armée ennemie de 1 pendant 2 tours. Les unités ciblées éliminées octroient +1 de puissance à l'unité jusqu'à la fin de la journée.",cooldown:3}, passiveAbility:{name:'Force Inégalée',description:"Augmente la puissance des unités de l'armée de Mou Bu de 1."}, citation:"«Ce n'est pas la stratégie qui gagne les guerres… c'est la force !»" },
  { id:'ou_sen', name:'Ou Sen', kingdom:'QIN', force:13, strategy:17, charisma:14, vitality:220, armor:5, weapon:{name:'Naginata',damage:12}, activeAbility:{name:"L'Architecte de la Guerre",description:"Réduit l'attaque et la vitesse d'une armée ennemie de 2 pendant 3 tours, et augmente la portée des unités à distance de l'armée de 200m pendant 2 tours.",cooldown:4}, passiveAbility:{name:'Forteresse Imprenable',description:"Les unités de l'armée d'Ou Sen gagnent 2 d'armure et subissent 1 d'intimidation en moins en position défensive."}, citation:"«La guerre n'est pas un duel de force… mais un jeu d'esprit où le perdant ne se relève jamais.»" },
  { id:'kan_ki', name:'Kan Ki', kingdom:'QIN', force:14, strategy:16, charisma:16, vitality:220, armor:3, weapon:{name:'Arc',damage:8}, activeAbility:{name:'Tactiques Infernales',description:"Choisit 3 unités qui peuvent se déployer n'importe où sur le champ de bataille. Ces unités gagnent 2 de puissance et 1 d'intimidation pour la journée et ne subissent pas de malus d'éloignement.",cooldown:5}, passiveAbility:{name:'Terreur Psychologique',description:"Augmente l'intimidation des unités de 1 par embuscade réussie jusqu'à la fin de la bataille."}, citation:"«La guerre n'a jamais eu de règles. Ce sont juste les idiots qui s'en inventent.»" },
  { id:'ri_boku', name:'Ri Boku', kingdom:'ZHAO', force:11, strategy:18, charisma:15, vitality:180, armor:2, weapon:{name:'Sabre',damage:10}, activeAbility:{name:'Vision du Sage',description:"Révèle l'emplacement d'une unité ennemie en embuscade.",cooldown:2}, passiveAbility:{name:'Maître de la Guerre Totale',description:"Lors d'un conflit, si une unité de l'armée est en avantage, elle reçoit un bonus de 1 en attaque ou en défense."}, citation:"«Gagner une guerre sans combattre est la plus grande des victoires.»" },
  { id:'kei_sha', name:'Kei Sha', kingdom:'ZHAO', force:13, strategy:16, charisma:13, vitality:240, armor:4, weapon:{name:'Sabre',damage:10}, activeAbility:{name:'Piège Mortel',description:"Toute l'armée de Kei Sha recule instantanément de 2 cases et obtient un bonus de 1 de défense pendant les 2 prochains tours.",cooldown:4}, passiveAbility:{name:'Danse de la Guerre',description:"Chaque fois qu'une unité de l'armée de Kei Sha défend, l'unité adverse qui attaque perd 1 de vitalité en ignorant l'armure."}, citation:"«La guerre est un art, et seuls les plus fins stratèges en maîtrisent toutes les nuances.»" },
  { id:'shi_ba_shou', name:'Shi Ba Shou', kingdom:'ZHAO', force:17, strategy:15, charisma:18, vitality:240, armor:4, weapon:{name:'Naginata',damage:12}, activeAbility:{name:'Forteresse Inviolable',description:"Les unités de l'armée en position de défense gagnent 5 d'armure pendant 2 tours et annule la charge d'une unité.",cooldown:4}, passiveAbility:{name:'Loyauté Absolue',description:"Lorsqu'une unité alliée est détruite, les unités alliées dans un rayon de 400m regagnent 1 de vitalité."}, citation:"«Tant que Zhao aura besoin de moi, je resterai son bouclier.»" },
  { id:'ren_pa', name:'Ren Pa', kingdom:'ZHAO/WEI', force:17, strategy:16, charisma:17, vitality:310, armor:5, weapon:{name:'Naginata',damage:12}, activeAbility:{name:'Furie Martial',description:"Si une unité ennemie possède 12 de vitalité ou moins et se trouve au corps à corps avec Ren Pa, détruit cette unité peu importe son type.",cooldown:3}, passiveAbility:{name:'Volonté Indomptable',description:"La troupe de Ren Pa continue de se battre pendant 1 tour après avoir été démoralisée."}, citation:"«Un vrai guerrier ne fuit jamais la bataille. Seuls les faibles se cachent derrière les mots.»" },
  { id:'go_kei', name:'Go Kei', kingdom:'WEI', force:14, strategy:17, charisma:15, vitality:240, armor:4, weapon:{name:'Sabre',damage:10}, activeAbility:{name:'Rempart Inébranlable',description:"Les unités de l'armée de Go Kei obtiennent 3 de défense et 2 de puissance supplémentaires en position de défense pendant 2 tours.",cooldown:3}, passiveAbility:{name:'Gardien de Wei',description:"Lorsqu'une unité de l'armée de Go Kei tue une unité ennemie en position de défense, l'unité gagne 1 de puissance et 1 de défense jusqu'à la fin de la bataille."}, citation:"«Un général qui se précipite vers la bataille a déjà perdu. Celui qui attend son heure triomphe sans effort.»" },
  { id:'go_hou_mei', name:'Go Hou Mei', kingdom:'WEI', force:10, strategy:18, charisma:15, vitality:160, armor:2, weapon:{name:'-',damage:6}, activeAbility:{name:'Esprit Tactique Inégalé',description:"À la fin d'un tour, Go Hou Mei peut rejouer un de ses officiers ainsi que la troupe sous son commandement, mais ne peut pas attaquer.",cooldown:3}, passiveAbility:{name:'Génie Militaire',description:"Si Go Hou Mei réussit le test de Stratégie et commence le tour, ses unités ont +1 d'attaque et de défense."}, citation:"«La guerre est un jeu d'échecs où chaque mouvement détermine le vainqueur avant même que l'ennemi ne s'en rende compte.»" },
  { id:'gai_mou', name:'Gai Mou', kingdom:'WEI', force:18, strategy:12, charisma:15, vitality:360, armor:4, weapon:{name:'Naginata',damage:12}, activeAbility:{name:'Rugissement du Lion',description:"Toutes les troupes ennemies (à l'exception des officiers) perdent 1 d'intimidation dans un rayon de 1000m autour de Gai Mou.",cooldown:3}, passiveAbility:{name:'Fierté Inflexible',description:"Lors d'un combat impliquant une unité de l'armée de Gai Mou, si l'unité adverse est en supériorité numérique (plus de vitalité), l'unité alliée obtient un bonus de 1 de puissance."}, citation:"«Que ce soit dix, cent ou mille ennemis… je les écraserai tous de mes propres mains !»" },
];

const UNIT_IMAGE1_MAP = {
  'pietaille':      { file: 'PIETAILLE 1-1',       ext: 'jpeg' },
  'soldats':        { file: 'SOLDAT',               ext: 'jpg'  },
  'phalange':       { file: 'PHALANGE 1-1',         ext: 'png'  },
  'lancier':        { file: 'LANCIER 1-1',          ext: 'jpg'  },
  'espion':         { file: 'ESPION 1-1',           ext: 'png'  },
  'assassin':       { file: 'ASSASSIN 1-1',         ext: 'jpg'  },
  'cavalier_leger': { file: 'CAVALIER LEGER 1-1',   ext: 'jpg'  },
  'cavalier_lourd': { file: 'CAVALIER LOURD 1-1',   ext: 'jpg'  },
  'archer':         { file: 'ARCHER 1-1',           ext: 'jpg'  },
  'archer_elite':   { file: "ARCHER D'ELITE 1-1",   ext: 'jpg'  },
  'batisseurs':     { file: 'BATISSEUR 1-1',        ext: 'jpg'  },
  'char':           { file: 'CHAR 1-1',             ext: 'png'  },
};

const UNITS_DATA = [
  { id:'pietaille',      name:'Piétaille',      category:'Infanterie', cost:400,  vitality:300, morale:150, attack:8,  power:6,  defense:10, armor:5,  intimidation:1,  speed:3, range:1, bonus:"+1 de moral par tour lorsque l'unité se trouve dans la troupe du général." },
  { id:'soldats',        name:'Soldats',        category:'Infanterie', cost:600,  vitality:200, morale:300, attack:11, power:10, defense:10, armor:8,  intimidation:3,  speed:2, range:1, bonus:"Après un combat si l'unité ennemie est laissée avec 3 de vitalité ou moins, elle est détruite." },
  { id:'phalange',       name:'Phalange',       category:'Infanterie', cost:700,  vitality:200, morale:300, attack:12, power:9,  defense:15, armor:10, intimidation:3,  speed:2, range:1, bonus:"La phalange peut faire un test de défense contre les unités de tireur. Si elle réussit, elle ignore la puissance ennemie." },
  { id:'lancier',        name:'Lancier',        category:'Infanterie', cost:700,  vitality:200, morale:300, attack:10, power:10, defense:12, armor:8,  intimidation:3,  speed:3, range:1, bonus:"+3 attaque et défense contre les unités à cheval et les chars." },
  { id:'espion',         name:'Espion',         category:'Infanterie', cost:600,  vitality:240, morale:240, attack:12, power:8,  defense:10, armor:7,  intimidation:2,  speed:4, range:1, bonus:"Peut détruire une infrastructure pour 2 de vitesse." },
  { id:'assassin',       name:'Assassin',       category:'Infanterie', cost:800,  vitality:100, morale:200, attack:16, power:22, defense:10, armor:18, intimidation:4,  speed:4, range:1, bonus:"Avantage sur le premier jet d'attaque par jour. Peut disparaître si aucun ennemi à moins de 600m." },
  { id:'cavalier_leger', name:'Cavalier Léger', category:'Chevaux',    cost:900,  vitality:150, morale:300, attack:13, power:15, defense:7,  armor:12, intimidation:4,  speed:6, range:1, bonus:"+1 de vitesse si l'unité n'est pas engagée." },
  { id:'cavalier_lourd', name:'Cavalier Lourd', category:'Chevaux',    cost:1200, vitality:100, morale:400, attack:15, power:22, defense:8,  armor:18, intimidation:8,  speed:5, range:1, bonus:"+1 de puissance et d'intimidation lors d'une charge." },
  { id:'archer',         name:'Archer',         category:'Tireurs',    cost:600,  vitality:240, morale:240, attack:8,  power:8,  defense:5,  armor:7,  intimidation:2,  speed:3, range:3, bonus:"Attaque à 300m. L'unité attaquée ne fait pas de test de défense." },
  { id:'archer_elite',   name:"Archer d'Élite", category:'Tireurs',    cost:900,  vitality:200, morale:300, attack:12, power:10, defense:6,  armor:9,  intimidation:3,  speed:3, range:4, bonus:"Attaque à 400m. L'unité attaquée ne fait pas de test de défense." },
  { id:'batisseurs',     name:'Bâtisseurs',     category:'Chars',      cost:1000, vitality:150, morale:75,  attack:8,  power:10, defense:5,  armor:9,  intimidation:1,  speed:4, range:1, bonus:"Pour 2 vitesse, peut construire une barrière, un cheval de frise, une échelle, un pont ou brûler une tuile inflammable adjacente." },
  { id:'char',           name:'Char',           category:'Chars',      cost:1600, vitality:75,  morale:375, attack:16, power:30, defense:8,  armor:25, intimidation:10, speed:5, range:1, bonus:"Peut attaquer 2 unités simultanément si les 3 sont alignées. Traverse les unités lorsque c'est possible." },
];

function show(id) {
  ['screen-home', 'screen-lobby', 'screen-army', 'screen-wait'].forEach(s => {
    document.getElementById(s).style.display = s === id ? 'block' : 'none';
  });
  const home = id === 'screen-home';
  document.body.classList.toggle('ld-at-home', home);
  document.body.classList.toggle('ld-in-lobby', id === 'screen-lobby');
  if (window.mapPreview3d) window.mapPreview3d.setActive(id === 'screen-lobby');
  if (!home) closeHomePanel();
  if (window.homeScene) window.homeScene.setActive(home);
}

// ---- Home: three big buttons, each opening a sheet ----
let newKind = 'friends';
const NEW_KIND_UI = {
  friends: { go: 'Créer la salle', hint: "Invitez vos amis avec le code ou le lien de la salle. Vous pourrez aussi y ajouter des IA." },
  ai: { go: 'Lancer la bataille', hint: "Vous recrutez votre armée, l'IA aussi, puis la bataille commence." },
  tuto: { go: 'Commencer le tutoriel', hint: 'Une courte bataille guidée contre une IA passive.' },
};

function openHomePanel(which) {
  const sheet = document.getElementById('home-sheet');
  sheet.hidden = false;
  sheet.querySelectorAll('.ld-sheet-panel').forEach(el => { el.hidden = el.dataset.panel !== which; });
  document.body.classList.add('ld-sheet-open');
  if (which === 'new') { setNewKind(newKind); document.getElementById('create-name').focus(); }
  if (which === 'join') { renderResume(); (document.getElementById('join-name').value ? document.getElementById('join-code') : document.getElementById('join-name')).focus(); }
  if (which === 'about') sheet.querySelector('.ld-sheet-box').scrollTop = 0;
}

function closeHomePanel() {
  const sheet = document.getElementById('home-sheet');
  if (!sheet || sheet.hidden) return;
  sheet.hidden = true;
  document.body.classList.remove('ld-sheet-open');
}

function setNewKind(kind) {
  newKind = NEW_KIND_UI[kind] ? kind : 'friends';
  document.querySelectorAll('.ld-choice').forEach(b => b.setAttribute('aria-checked', String(b.dataset.kind === newKind)));
  document.querySelectorAll('.ld-choice-opts').forEach(el => { el.hidden = el.dataset.for !== newKind; });
  document.getElementById('new-go').textContent = NEW_KIND_UI[newKind].go;
  document.getElementById('new-hint').textContent = NEW_KIND_UI[newKind].hint;
  if (newKind === 'ai') fillSoloGenerals();
}

function startNewGame() {
  if (newKind === 'ai') return playSolo();
  if (newKind === 'tuto') return startTutorial();
  return createRoom();
}

// Room code from a code or a pasted invite link (…/?join=CODE)
function parseJoinCode(raw) {
  const v = String(raw || '').trim();
  const m = v.match(/[?&]join=([A-Za-z0-9]+)/);
  return (m ? m[1] : v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function notify(msg, type = 'error') {
  const n = document.getElementById('notification');
  n.textContent = msg;
  n.className = type;
  n.style.display = 'block';
  clearTimeout(notify._t);
  notify._t = setTimeout(() => n.style.display = 'none', 3500);
}

function showLobbyError(msg) {
  const el = document.getElementById('lobby-error');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
  clearTimeout(showLobbyError._t);
  if (msg) showLobbyError._t = setTimeout(() => { el.style.display = 'none'; }, 6000);
}

function savedName() {
  return localStorage.getItem('kb_player_name') || '';
}

function readName(inputId) {
  const name = document.getElementById(inputId).value.trim();
  if (name) localStorage.setItem('kb_player_name', name);
  return name;
}

function createRoom() {
  const name = readName('create-name');
  if (!name) return notify('Entrez votre nom.');
  KBNet.clearSession();
  KBNet.send('create_room', { playerName: name, roomCode: undefined, mode: 'simultaneous' });
}

function joinRoom(asSpectator) {
  const name = readName('join-name');
  const raw = document.getElementById('join-code').value;
  const code = parseJoinCode(raw);
  const spectateLink = /[?&]spectate=1/.test(raw);
  if (spectateLink) asSpectator = true;
  if (!name) return notify('Entrez votre nom.');
  if (code.length < 4) return notify('Entrez le code de la salle.');
  KBNet.clearSession();
  KBNet.send('join_room', { roomCode: code, playerName: name, spectator: !!asSpectator });
}

let resumeList = [];

function resumeSession(i = 0) {
  const s = resumeList[i];
  if (!s) return;
  KBNet.setSession(s);
  KBNet.rejoin();
}

function dismissResume() {
  for (const s of KBNet.recentSessions()) KBNet.forget(s.roomCode, s.playerId);
  renderResume();
}

function renderResume() {
  const card = document.getElementById('resume-card');
  const list = KBNet.getSession() ? [] : KBNet.recentSessions().slice(0, 3);
  resumeList = list;
  const joinBox = document.getElementById('join-resume');
  if (joinBox) joinBox.innerHTML = list.length ? `<span class="ld-label">Parties en cours</span>${list.map((s, i) =>
    `<button class="ld-btn" onclick="resumeSession(${i})">Reprendre : salle ${escapeHtml(s.roomCode)} — ${escapeHtml(s.name || '')}${s.role === 'spectator' ? ' (spectateur)' : ''}</button>`).join('')}` : '';
  if (!list.length) { card.style.display = 'none'; return; }
  document.getElementById('resume-text').textContent = list.length > 1 ? 'Vous avez des parties en cours :' : '';
  card.querySelector('.btn-row').innerHTML = list.map((s, i) =>
    `<button class="ld-btn ld-btn-red" onclick="resumeSession(${i})">Reprendre : salle ${escapeHtml(s.roomCode)} — ${escapeHtml(s.name || '')}${s.role === 'spectator' ? ' (spectateur)' : ''}</button>`
  ).join('') + '<button class="ld-btn" onclick="dismissResume()">Ignorer</button>';
  card.style.display = 'block';
}

function inviteUrl(spectate) {
  return `${location.origin}/?join=${encodeURIComponent(roomCode)}${spectate ? '&spectate=1' : ''}`;
}

async function copyInvite(spectate) {
  const url = inviteUrl(spectate);
  try {
    await navigator.clipboard.writeText(url);
    notify('Lien copié : ' + url, 'success');
  } catch (e) {
    window.prompt('Copiez ce lien :', url);
  }
}

function leaveRoom() {
  KBNet.send('leave_room');
  KBNet.clearSession();
  myId = null; roomCode = null; lastLobby = null;
  document.getElementById('ld-room-tag').hidden = true;
  show('screen-home');
  renderResume();
}

function setBudget() {
  const raw = parseInt(document.getElementById('budget-input').value, 10);
  if (isNaN(raw) || raw < 1000 || raw > 100000) return notify('Budget entre 1000 et 100000 or.');
  const val = Math.round(raw / 100) * 100;
  document.getElementById('budget-input').value = val;
  KBNet.send('set_budget', { budget: val });
}

// The host may still change the budget during army building (armies being built are re-checked on submit)
function setBudgetFromArmy() {
  const el = document.getElementById('army-budget-input');
  const raw = parseInt(el.value, 10);
  if (isNaN(raw) || raw < 1000 || raw > 100000) return notify('Budget entre 1000 et 100000 or.');
  const val = Math.round(raw / 100) * 100;
  el.value = val;
  KBNet.send('set_budget', { budget: val });
}

function backToLobby() {
  KBNet.send('back_to_lobby');
}

// ---- flags (nations): teammates under one flag in team mode; the flag sets the player's colour ----
const FLAGS = [
  { id: 'qin', name: 'Qin', k: '秦', file: 'Quin.webp' },
  { id: 'zhao', name: 'Zhao', k: '趙', file: 'Zhao.webp' },
  { id: 'wei', name: 'Wei', k: '魏', file: 'Wei.webp' },
  { id: 'chu', name: 'Chu', k: '楚', file: 'Chu.webp' },
  { id: 'yan', name: 'Yan', k: '燕', file: 'Yan.webp' },
  { id: 'qi', name: 'Qi', k: '齊', file: 'Qi.webp' },
  { id: 'han', name: 'Han', k: '韓', file: 'Han.webp' },
];

function flagImg(flagId, cls = 'ld-flag') {
  const f = FLAGS.find(x => x.id === flagId);
  if (!f) return `<span class="${cls} none" aria-hidden="true"></span>`;
  return `<img class="${cls}" src="/assets/flag/${f.file}" alt="Drapeau ${escapeHtml(f.name)}" title="${escapeHtml(f.name)}">`;
}

function pickFlag(flagId) {
  KBNet.send('set_player_flag', { flagId });
}

function setTeamMode(on) {
  KBNet.send('set_option', { key: 'teamMode', value: !!on });
}

function toggleLobbyReady() {
  KBNet.send('lobby_ready');
}

function setMap(mapId) {
  KBNet.send('set_map', { mapId });
}

function setMode(mode) {
  KBNet.send('set_mode', { mode });
}

const SETTING_KEYS = ['turnsPerHalfDay', 'maxTurns', 'victoryPoints', 'turnTimer', 'spectatorVision', 'planningTimer', 'commandPoints'];

function setSetting(el) {
  const key = el.dataset.setting;
  let value = el.value;
  if (key !== 'spectatorVision') {
    value = parseInt(value, 10);
    const lim = window.KBRules && KBRules.RULES.settings[key];
    if (!Number.isInteger(value) || (lim && (value < lim.min || value > lim.max))) {
      notify(lim ? `Valeur invalide (${lim.min} à ${lim.max}).` : 'Valeur invalide.');
      if (lastLobby) renderSettings(lastLobby);
      return;
    }
    if ((key === 'turnTimer' || key === 'planningTimer') && value > 0 && value < 15) {
      notify('Minuteur : 0 (désactivé) ou au moins 15 secondes.');
      if (lastLobby) renderSettings(lastLobby);
      return;
    }
  }
  KBNet.send('set_settings', { settings: { [key]: value } });
}

function renderGameSettings(data, host) {
  const settings = data.settings || (window.KBRules ? KBRules.defaultSettings() : {});
  for (const key of SETTING_KEYS) {
    const el = document.getElementById(`set-${key}`);
    if (!el) continue;
    if (document.activeElement !== el && settings[key] !== undefined) el.value = settings[key];
    el.disabled = !host;
  }
  const sim = data.mode === 'simultaneous';
  document.querySelectorAll('.sim-only').forEach(el => { el.style.display = sim ? '' : 'none'; });
  const tt = document.getElementById('row-turnTimer');
  if (tt) tt.style.display = sim ? 'none' : '';
  const spec = document.getElementById('set-spectatorVision');
  document.querySelectorAll('#spec-seg button').forEach(b => {
    b.setAttribute('aria-checked', String(b.dataset.value === (spec ? spec.value : 'full')));
    b.disabled = !host;
  });
  document.querySelectorAll('#ld-settings .ld-step').forEach(b => { b.disabled = !host; });
  const box = document.getElementById('ld-settings');
  if (box) box.classList.toggle('readonly', !host);
}

const MODE_SHORT = { sequential: 'Classique', simultaneous: 'Simultané' };
const MODE_HINTS = {
  sequential: "Chacun joue à son tour, dans l'ordre d'initiative tiré à chaque manche.",
  simultaneous: 'Tous les joueurs donnent leurs ordres en secret, puis ils sont résolus en même temps.',
};

function renderModeSeg(modes, current, host) {
  const box = document.getElementById('mode-seg');
  if (!box) return;
  box.innerHTML = modes.map(m => `<button type="button" role="radio" data-mode="${escapeHtml(m.id)}" aria-checked="${m.id === current}" title="${escapeHtml(MODE_HINTS[m.id] || '')}"${!host || !m.available ? ' disabled' : ''}>${escapeHtml(MODE_SHORT[m.id] || m.name)}</button>`).join('');
  const hint = document.getElementById('mode-hint');
  if (hint) hint.textContent = MODE_HINTS[current] || '';
}

// Settings panel: steppers, segmented controls (installed once)
function initSettingsControls() {
  const box = document.getElementById('ld-settings');
  box.addEventListener('click', (e) => {
    const step = e.target.closest('.ld-step');
    if (step) {
      const input = document.getElementById(step.dataset.for);
      if (!input || input.disabled) return;
      const dir = Number(step.dataset.step);
      const min = Number(input.min), max = Number(input.max), inc = Number(input.step) || 1;
      let v = (parseInt(input.value, 10) || 0) + dir * inc;
      if (/Timer$/.test(input.id) && v > 0 && v < 15) v = dir > 0 ? 15 : 0;
      v = Math.max(min, Math.min(max, v));
      if (String(v) === input.value) return;
      input.value = v;
      input.dispatchEvent(new Event('change'));
      return;
    }
    const mode = e.target.closest('#mode-seg button');
    if (mode && !mode.disabled) { setMode(mode.dataset.mode); return; }
    const spec = e.target.closest('#spec-seg button');
    if (spec && !spec.disabled) {
      const sel = document.getElementById('set-spectatorVision');
      sel.value = spec.dataset.value;
      setSetting(sel);
    }
  });
}

// Small map preview drawn from the map document (terrain, relief, deployment zones, objectives)
const mapDocs = {};
const PREVIEW_COLORS = { forest: [47, 74, 42], river: [61, 111, 154], road: [179, 155, 107], bridge: [150, 112, 70], building: [150, 58, 46] };
function drawMapPreview(mapId) {
  const cv = document.getElementById('map-preview');
  if (!cv || !mapId) return;
  if (window.mapPreview3d) window.mapPreview3d.show(mapId);
  if (!(mapId in mapDocs)) {
    mapDocs[mapId] = null;
    fetch('/api/maps/' + encodeURIComponent(mapId)).then(r => (r.ok ? r.json() : false)).catch(() => false).then(d => {
      mapDocs[mapId] = d || false;
      if (lastLobby && lastLobby.mapId === mapId) drawMapPreview(mapId);
    });
  }
  const doc = mapDocs[mapId];
  const meta = document.getElementById('map-meta');
  cv.hidden = doc === false;
  if (!doc) { if (meta) meta.textContent = ''; return; }
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const keys = Object.keys(doc.height || {});
  if (!keys.length) return;
  const S3 = Math.sqrt(3);
  const pts = keys.map(k => { const [q, r] = k.split(',').map(Number); return { k, x: 1.5 * q, y: S3 * (q / 2 + r) }; });
  const minX = Math.min(...pts.map(p => p.x)), maxX = Math.max(...pts.map(p => p.x));
  const minY = Math.min(...pts.map(p => p.y)), maxY = Math.max(...pts.map(p => p.y));
  const scale = Math.min((W - 8) / (maxX - minX + 2), (H - 8) / (maxY - minY + 2));
  const ox = (W - (maxX - minX) * scale) / 2, oy = (H - (maxY - minY) * scale) / 2;
  const maxH = Math.max(1, ...keys.map(k => doc.height[k] || 0));
  const rad = scale * 1.02;
  for (const p of pts) {
    const t = doc.terrain && doc.terrain[p.k];
    const base = PREVIEW_COLORS[t] || [104, 116, 78];
    const lift = ((doc.height[p.k] || 0) / maxH) * 0.45;
    const c = base.map(v => Math.round(v + (217 - v) * lift));
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    const x = ox + (p.x - minX) * scale, y = oy + (p.y - minY) * scale;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; ctx.lineTo(x + rad * Math.cos(a), y + rad * Math.sin(a)); }
    ctx.fill();
  }
  const at = (k) => { const [q, r] = String(k).split(',').map(Number); return [ox + (1.5 * q - minX) * scale, oy + (S3 * (q / 2 + r) - minY) * scale]; };
  ctx.fillStyle = 'rgba(239,232,216,.55)';
  for (const z of doc.zones || []) for (const k of z.tiles || []) { const [x, y] = at(k); ctx.fillRect(x - scale * 0.45, y - scale * 0.45, scale * 0.9, scale * 0.9); }
  for (const o of doc.objectives || []) {
    const [x, y] = at(`${o.q},${o.r}`);
    ctx.fillStyle = '#D8352A'; ctx.strokeStyle = '#0E0D0C'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  if (meta) {
    const parts = [`${keys.length.toLocaleString('fr-FR')} cases`];
    if ((doc.zones || []).length) parts.push(`${doc.zones.length} zones de déploiement fixes`);
    else parts.push('zones de déploiement tirées au hasard');
    if ((doc.objectives || []).length) parts.push(`${doc.objectives.length} objectif${doc.objectives.length > 1 ? 's' : ''}`);
    meta.textContent = parts.join(' · ');
  }
}

function onSealClick() {
  if (lastLobby && lastLobby.hostId === myId) startGame();
  else toggleLobbyReady();
}

function pickColor(hex) {
  KBNet.send('set_player_color', { color: hex });
}

function selectGeneral(id) {
  KBNet.send('select_general', { generalId: id });
}

function startGame() {
  KBNet.send('start_game');
}

// ---- IA (game/bots) ----
const BOT_DIFFICULTIES = [
  { id: 'recrue', name: 'Recrue (facile)' },
  { id: 'veteran', name: 'Vétéran (moyen)' },
  { id: 'stratege', name: 'Stratège (difficile)' },
];

function playSolo() {
  const name = readName('create-name') || savedName() || 'Joueur';
  KBNet.clearSession();
  KBNet.send('create_solo', {
    mode: document.getElementById('solo-mode')?.value || 'simultaneous',
    playerName: name,
    difficulty: document.getElementById('solo-difficulty').value,
    generalId: document.getElementById('solo-general').value || undefined,
    roomCode: undefined,
  });
}

function startTutorial() {
  const name = readName('create-name') || savedName() || 'Recrue';
  KBNet.clearSession();
  KBNet.send('start_tutorial', { playerName: name, roomCode: undefined });
}

function addBot() {
  const sel = document.getElementById('bot-difficulty');
  const flag = document.getElementById('bot-flag');
  KBNet.send('add_bot', { difficulty: sel ? sel.value : 'veteran', flagId: flag && flag.value ? flag.value : undefined, generalId: botGeneralChoice || undefined });
  botGeneralChoice = null;
}

function removeBot(id) {
  KBNet.send('remove_bot', { playerId: id });
}

function renderBotControls(data) {
  const box = document.getElementById('bot-controls');
  if (!box) return;
  const show = data.phase === 'lobby' && data.hostId === myId && data.players.length < 8;
  box.style.display = show ? 'grid' : 'none';
  if (!show) return;
  const prev = document.getElementById('bot-difficulty');
  const current = prev ? prev.value : 'veteran';
  const prevFlag = document.getElementById('bot-flag');
  const curFlag = prevFlag ? prevFlag.value : '';
  const team = !!(data.settings && data.settings.teamMode);
  const taken = new Set(data.players.map(p => p.flag).filter(Boolean));
  box.innerHTML = `<span class="ld-label ld-bot-title">Ajouter une IA</span>
    <label for="bot-difficulty" class="ld-sr">Niveau de l'IA</label>
    <select id="bot-difficulty">${BOT_DIFFICULTIES.map(d => `<option value="${d.id}"${d.id === current ? ' selected' : ''}>${d.name}</option>`).join('')}</select>
    <select id="bot-flag" aria-label="Drapeau de l'IA"><option value="">Drapeau : auto</option>${FLAGS.map(f => `<option value="${f.id}"${f.id === curFlag ? ' selected' : ''}${!team && taken.has(f.id) ? ' disabled' : ''}>${f.k} ${f.name}</option>`).join('')}</select>
    <button type="button" class="ld-btn ld-bot-gen" onclick="chooseBotGeneral()" title="Choisir le général de l'IA">${(() => {
      const g = botGeneralChoice && GENERALS_DATA.find(x => x.id === botGeneralChoice);
      const img = g && generalImageUrl(g);
      return g ? `${img ? `<img src="${img}" alt="">` : ''}${escapeHtml(g.name)}` : 'Général : au hasard';
    })()}</button>
    <button class="ld-btn ld-bot-add" onclick="addBot()">+ Ajouter l'IA</button>`;
  if (botGeneralChoice && (data.takenGenerals || []).includes(botGeneralChoice)) botGeneralChoice = null;
}

function fillSoloGenerals() {
  const box = document.getElementById('solo-general-pick');
  const input = document.getElementById('solo-general');
  if (!box || !input) return;
  renderGeneralPicker(box, {
    selected: input.value || null, allowRandom: true, tabKey: 'solo',
    onPick: (id) => { input.value = id || ''; fillSoloGenerals(); },
  });
}

const pickerTabs = {};
// Portrait grid with kingdom tabs. onPick(id | null for "au hasard"); taken ids are greyed out.
function renderGeneralPicker(box, { selected = null, taken = [], allowRandom = false, onPick, tabKey = 'x' }) {
  const sel = GENERALS_DATA.find(g => g.id === selected);
  if (!pickerTabs[tabKey]) pickerTabs[tabKey] = sel ? kingdomInfo(sel).id : 'QIN';
  const tab = pickerTabs[tabKey];
  const list = GENERALS_DATA.filter(g => kingdomsOf(g).includes(tab));
  const takenSet = new Set(taken.filter(id => id !== selected));
  const card = (g) => {
    const img = generalImageUrl(g);
    const tk = takenSet.has(g.id);
    return `<button type="button" class="ld-gp-card${g.id === selected ? ' on' : ''}${tk ? ' taken' : ''}" data-gp="${escapeHtml(g.id)}"${tk ? ' disabled' : ''}
      aria-pressed="${g.id === selected}" title="${escapeHtml(g.name)}${tk ? ' (déjà pris)' : ''}">
      <span class="ld-gp-face">${img ? `<img src="${img}" alt="" loading="lazy">` : `<span class="ld-brush">${escapeHtml(g.name.charAt(0))}</span>`}</span>
      <span class="ld-gp-name">${escapeHtml(g.name)}</span>
      <span class="ld-gp-stats"><i>F</i>${g.force ?? '—'}<i>S</i>${g.strategy ?? '—'}<i>C</i>${g.charisma ?? '—'}</span>
      ${tk ? '<span class="ld-gp-flag">Pris</span>' : g.id === selected ? '<span class="ld-gp-flag on">Choisi</span>' : ''}</button>`;
  };
  box.innerHTML = `<div class="ld-gp-tabs" role="group" aria-label="Royaume">
      ${allowRandom ? `<button type="button" class="ld-gp-tab ld-gp-random${!selected ? ' on' : ''}" data-gp-random="1" aria-pressed="${!selected}">Au hasard</button>` : ''}
      ${KINGDOMS.map(k => `<button type="button" class="ld-gp-tab" data-gp-tab="${k.id}" aria-pressed="${k.id === tab}"><span class="ld-brush" aria-hidden="true">${k.k}</span>${k.name}</button>`).join('')}
    </div>
    <div class="ld-gp-grid">${list.map(card).join('')}</div>
    ${sel ? `<p class="ld-gp-sel">${escapeHtml(sel.name)} · ${escapeHtml(kingdomLabel(sel))}${sel.citation ? ` — <i>${escapeHtml(sel.citation)}</i>` : ''}</p>` : allowRandom ? '<p class="ld-gp-sel">Un général sera tiré au hasard.</p>' : ''}`;
  box.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.gpTab) { pickerTabs[tabKey] = b.dataset.gpTab; renderGeneralPicker(box, { selected, taken, allowRandom, onPick, tabKey }); return; }
    if (b.dataset.gpRandom) { onPick(null); return; }
    if (b.dataset.gp) onPick(b.dataset.gp);
  };
}

// Modal version (room: AI general)
function openGeneralPicker({ title, selected, taken, allowRandom, onPick }) {
  let ov = document.getElementById('ld-gpicker');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'ld-gpicker';
    ov.className = 'ld-sheet';
    ov.innerHTML = `<div class="ld-sheet-box" role="dialog" aria-modal="true"><button class="ld-close" aria-label="Fermer"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg></button><h2></h2><div class="ld-gpick"></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('.ld-close')) ov.hidden = true; });
  }
  ov.querySelector('h2').textContent = title;
  const box = ov.querySelector('.ld-gpick');
  const render = (sel) => renderGeneralPicker(box, { selected: sel, taken, allowRandom, tabKey: 'modal', onPick: (id) => { ov.hidden = true; onPick(id); } });
  delete pickerTabs.modal;
  render(selected);
  ov.hidden = false;
}

let botGeneralChoice = null;
function chooseBotGeneral() {
  openGeneralPicker({
    title: "Général de l'IA", selected: botGeneralChoice, taken: lastTaken, allowRandom: true,
    onPick: (id) => { botGeneralChoice = id; if (lastLobby) renderBotControls(lastLobby); },
  });
}

function changeBotGeneral(botId) {
  const bot = lastLobby && lastLobby.players.find(p => p.id === botId);
  if (!bot) return;
  openGeneralPicker({
    title: `Général de ${bot.name}`, selected: bot.generalId, taken: lastTaken, allowRandom: false,
    onPick: (id) => { if (id && id !== bot.generalId) KBNet.send('set_bot_general', { playerId: botId, generalId: id }); },
  });
}

function showGeneralSheet(id) {
  const g = GENERALS_DATA.find(x => x.id === id);
  if (!g) return;
  const abil = [];
  if (g.activeAbility) abil.push(`<div class="ld-abil-item"><span class="ld-abil-kind">Capacité active · recharge ${g.activeAbility.cooldown} tours</span><b>${escapeHtml(g.activeAbility.name)}</b><p>${escapeHtml(g.activeAbility.description)}</p></div>`);
  if (g.passiveAbility) abil.push(`<div class="ld-abil-item"><span class="ld-abil-kind">Passif</span><b>${escapeHtml(g.passiveAbility.name)}</b><p>${escapeHtml(g.passiveAbility.description)}</p></div>`);
  document.getElementById('general-card-content').innerHTML = `<div class="ld-gsheet">
      ${scrollHtml(g)}
      <div class="ld-gen-info">
        <div class="ld-gen-kicker">Général · ${escapeHtml(kingdomLabel(g))}</div>
        <div class="ld-gen-name">${escapeHtml(g.name)}</div>
        ${g.citation ? `<p class="ld-gen-quote">${escapeHtml(g.citation)}</p>` : ''}
        ${statBars(g)}${generalFacts(g)}
        ${abil.length ? `<div class="ld-abil">${abil.join('')}</div>` : ''}
      </div></div>`;
  document.getElementById('overlay-general-card').style.display = 'flex';
}

const KINGDOMS = [{ id: 'QIN', k: '秦', name: 'Qin' }, { id: 'ZHAO', k: '趙', name: 'Zhao' }, { id: 'WEI', k: '魏', name: 'Wei' }, { id: 'CHU', k: '楚', name: 'Chu' }];
const UNIT_KANJI = { pietaille: '卒', soldats: '兵', phalange: '盾', lancier: '槍', espion: '諜', assassin: '刺', cavalier_leger: '騎', cavalier_lourd: '騎', archer: '弓', archer_elite: '弓', batisseurs: '工', char: '車' };
let genTab = null;
let previewGeneralId = null;
let lastTaken = [];

const kingdomsOf = (g) => String(g.kingdom || '').split('/');
const kingdomInfo = (g) => KINGDOMS.find(k => k.id === kingdomsOf(g)[0]) || KINGDOMS[0];
const kingdomLabel = (g) => kingdomsOf(g).map(id => (KINGDOMS.find(k => k.id === id) || { name: id }).name).join(' / ');

function generalImageUrl(g) {
  const e = GENERAL_IMAGE1_MAP[g.id];
  return e ? `/assets/unites/GENERAL IMAGE 1-1/${encodeURIComponent(e.file)}.${e.ext}` : null;
}

function unitImageUrl(u) {
  const e = UNIT_IMAGE1_MAP[u.id];
  return e ? `/assets/unites/UNIT IMAGE 1-1/${encodeURIComponent(e.file)}.${e.ext}` : null;
}

function scrollHtml(g) {
  const img = generalImageUrl(g);
  const k = kingdomInfo(g).k;
  return `<div class="ld-scroll" aria-hidden="true"><div class="ld-rod"></div><div class="ld-paper">
    ${img ? `<img src="${img}" alt="">` : `<span class="ld-paper-k">${escapeHtml(g.name.charAt(0))}</span>`}
    <span class="ld-stamp">${k}</span></div><div class="ld-rod"></div></div>`;
}

function statBars(g) {
  const rows = [['Force', g.force], ['Stratégie', g.strategy], ['Charisme', g.charisma]];
  const best = Math.max(...rows.map(r => r[1] || 0));
  return `<div class="ld-bars">${rows.map(([label, v]) => `<div class="ld-bar"><span>${label}</span>
    <span class="ld-track"><i class="${v === best ? 'red' : ''}" style="width:${Math.min(100, (v || 0) / 20 * 100)}%"></i></span>
    <span class="ld-num">${v ?? '—'}</span></div>`).join('')}</div>`;
}

function generalFacts(g) {
  const facts = [];
  if (g.vitality) facts.push(['Vitalité', g.vitality]);
  if (g.weapon) facts.push(['Arme', `${g.weapon.name}${g.weapon.damage != null ? ' · ' + g.weapon.damage : ''}`]);
  if (g.armor != null) facts.push(['Armure', g.armor]);
  if (g.power != null) facts.push(['Puissance', g.power]);
  if (g.intimidation != null) facts.push(['Intimidation', g.intimidation]);
  return `<div class="ld-facts">${facts.map(([l, v]) => `<div><span>${l}</span><b>${escapeHtml(String(v))}</b></div>`).join('')}</div>`;
}

function renderGenerals(takenList) {
  lastTaken = takenList || [];
  const grid = document.getElementById('generals-grid');
  const chosen = GENERALS_DATA.find(g => g.id === selectedGeneral);
  if (!genTab) genTab = chosen ? kingdomInfo(chosen).id : 'QIN';
  const inTab = GENERALS_DATA.filter(g => kingdomsOf(g).includes(genTab));
  let g = inTab.find(x => x.id === previewGeneralId) || inTab.find(x => x.id === selectedGeneral) || inTab[0];
  if (!g) { grid.innerHTML = ''; return; }
  const isTaken = (x) => lastTaken.includes(x.id) && x.id !== selectedGeneral;
  const player = myRole === 'player';
  let status;
  if (!player) status = '';
  else if (g.id === selectedGeneral) status = '<span class="ld-btn ld-btn-red" role="status" style="cursor:default">Votre général</span>';
  else if (isTaken(g)) status = '<span class="ld-gen-taken">Déjà choisi par un autre joueur</span>';
  else status = `<button class="ld-btn ld-btn-red" data-pick="${escapeHtml(g.id)}">Choisir ${escapeHtml(g.name)}</button>`;
  const abil = [];
  if (g.activeAbility) abil.push(`<div class="ld-abil-item"><span class="ld-abil-kind">Capacité active · recharge ${g.activeAbility.cooldown} tours</span><b>${escapeHtml(g.activeAbility.name)}</b><p>${escapeHtml(g.activeAbility.description)}</p></div>`);
  if (g.passiveAbility) abil.push(`<div class="ld-abil-item"><span class="ld-abil-kind">Passif</span><b>${escapeHtml(g.passiveAbility.name)}</b><p>${escapeHtml(g.passiveAbility.description)}</p></div>`);
  const heroImg = '/assets/unites/UNIT%20IMAGE%201-1/SOLDAT.jpg';
  const fc = (x) => `<span class="ld-gmini"><i>F</i>${x.force ?? '—'}<i>S</i>${x.strategy ?? '—'}<i>C</i>${x.charisma ?? '—'}</span>`;
  grid.innerHTML = `
    <div class="ld-tabs" role="group" aria-label="Royaume">${KINGDOMS.map(k => `<button class="ld-tab" data-tab="${k.id}" aria-pressed="${k.id === genTab}" title="${k.name}"><span class="ld-brush" aria-hidden="true">${k.k}</span><span>${k.name}</span></button>`).join('')}</div>
    <div class="ld-gen-stage">
      ${heroImg ? `<div class="ld-gen-bg" aria-hidden="true" style="background-image:url('${heroImg}')"></div>` : ''}
      <div class="ld-gen">
        <div class="ld-gen-info">
          <div class="ld-gen-kicker">Général · ${escapeHtml(kingdomLabel(g))}</div>
          <div class="ld-gen-name">${escapeHtml(g.name)}</div>
          <svg class="ld-stroke" width="220" height="12" viewBox="0 0 220 12" aria-hidden="true"><path d="M2 8 C 50 2, 110 11, 160 5 S 210 7, 218 4" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/></svg>
          ${g.citation ? `<p class="ld-gen-quote">${escapeHtml(g.citation)}</p>` : ''}
          ${statBars(g)}
          ${generalFacts(g)}
          ${abil.length ? `<div class="ld-abil">${abil.join('')}</div>` : ''}
          ${status ? `<div class="ld-gen-actions">${status}</div>` : ''}
        </div>
        ${scrollHtml(g)}
      </div>
    </div>
    <div class="ld-roster" role="group" aria-label="Généraux de ${escapeHtml((KINGDOMS.find(k => k.id === genTab) || {}).name || '')}">${inTab.map(x => {
      const cls = [x.id === g.id ? 'preview' : '', x.id === selectedGeneral ? 'mine' : '', isTaken(x) ? 'taken' : ''].join(' ');
      const img = generalImageUrl(x);
      const flag = x.id === selectedGeneral ? '<span class="ld-flag">Vous</span>' : isTaken(x) ? '<span class="ld-flag">Pris</span>' : '';
      return `<button class="ld-gbtn ${cls}" data-gen="${escapeHtml(x.id)}" aria-pressed="${x.id === g.id}">
        <span class="ld-face">${img ? `<img src="${img}" alt="">` : `<span class="ld-brush">${escapeHtml(x.name.charAt(0))}</span>`}</span>${flag}
        <span class="ld-gname">${escapeHtml(x.name)}</span>${fc(x)}</button>`;
    }).join('')}</div>`;
  grid.onclick = (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.tab) { genTab = t.dataset.tab; previewGeneralId = null; renderGenerals(lastTaken); return; }
    const id = t.dataset.pick || t.dataset.gen;
    if (!id) return;
    previewGeneralId = id;
    const x = GENERALS_DATA.find(y => y.id === id);
    if (player && x && !isTaken(x) && id !== selectedGeneral) selectGeneral(id);
    renderGenerals(lastTaken);
  };
}

function closeGeneralCard() {
  document.getElementById('overlay-general-card').style.display = 'none';
}

function showUnitCardLobby(u) {
  const imgEntry = UNIT_IMAGE1_MAP[u.id];
  const imgHtml = imgEntry
    ? `<img class="uc-pdf-img" src="/assets/unites/UNIT IMAGE 1-1/${encodeURIComponent(imgEntry.file)}.${imgEntry.ext}" alt="${u.name}">`
    : `<div class="uc-pdf-img-placeholder">${UNIT_KANJI[u.id] || u.name.charAt(0)}</div>`;

  const stats = [
    { label: 'Vitalité',      value: u.vitality },
    { label: 'Morale',        value: u.morale },
    { label: 'Attaque',       value: u.attack },
    { label: 'Défense',       value: u.defense },
    { label: 'Puissance',     value: u.power },
    { label: 'Intimidation',  value: u.intimidation },
    { label: 'Armure',        value: u.armor },
    { label: 'Vitesse',       value: u.speed },
  ];
  if (u.range > 1) stats.push({ label: 'Portée', value: `${u.range} cases` });
  const statsHtml = stats.map(s =>
    `<div class="uc-pdf-stat"><div class="uc-pdf-stat-label">${s.label}</div><div class="uc-pdf-stat-value">${s.value}</div></div>`
  ).join('');

  const bonusHtml = u.bonus
    ? `<div class="uc-pdf-bonus"><strong>Bonus :</strong> ${u.bonus}</div>`
    : `<div class="uc-pdf-bonus"><em>Aucun bonus spécial</em></div>`;

  document.getElementById('general-card-content').innerHTML = `
    <div class="uc-pdf">
      <div class="uc-pdf-left">
        ${imgHtml}
        ${bonusHtml}
      </div>
      <div class="uc-pdf-right">
        <div class="uc-pdf-title">${escapeHtml(u.name)}<br><span>${escapeHtml(unitGroupOf(u).name.toUpperCase())} · <b class="uc-gold">${fmtGold(u.cost)} or</b></span></div>
        <div class="uc-pdf-stats">${statsHtml}</div>
      </div>
    </div>
  `;
  document.getElementById('overlay-general-card').style.display = 'flex';
}

function renderPlayerList(data) {
  const { players, hostId, phase } = data;
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  const usedColors = new Set(players.filter(p => p.id !== myId).map(p => (p.color || '').toLowerCase()));
  for (const p of players) {
    const li = document.createElement('li');
    if (!p.connected) li.classList.add('offline');
    const genName = p.generalId ? GENERALS_DATA.find(g => g.id === p.generalId)?.name || p.generalId : '—';
    const color = p.color || '#4a90d9';
    const bot = (data.bots || []).find(b => b.id === p.id);
    const badge = bot ? `<span class="player-badge bot">IA · ${escapeHtml(bot.label)}</span>`
      : `<span class="player-badge${p.id === hostId ? ' host' : ''}">${p.id === hostId ? 'Hôte' : 'Joueur'}</span>`;
    const mine = p.id === myId && phase === 'lobby';
    const team = !!(data.settings && data.settings.teamMode);
    const holders = (fid) => players.filter(o => o.id !== myId && o.flag === fid).map(o => o.name);
    const selIdx = Math.max(0, FLAGS.findIndex(f => f.id === p.flag));
    const swatches = mine ? `<div class="ld-flag-wheel" role="group" aria-label="Votre drapeau">${FLAGS.map((f, i) => {
      const others = holders(f.id);
      const taken = !team && others.length > 0;
      const active = f.id === p.flag;
      const who = others.length ? `${team ? 'Alliés' : 'Pris par'} : ${others.join(', ')}` : '';
      const tip = `${f.name}${who ? ' — ' + who : ''}`;
      return `<button class="ld-flag-btn${active ? ' active' : ''}${taken ? ' taken' : ''}" title="${escapeHtml(tip)}" style="--a:${((i - selIdx) * 360 / FLAGS.length).toFixed(2)}deg"
        aria-label="Drapeau ${escapeHtml(tip)}" aria-pressed="${active}"${taken ? ' disabled' : ` onclick="pickFlag('${f.id}')"`}>
        <span class="ld-flag-img"><img src="/assets/flag/${f.file}" alt=""></span>
        ${taken ? '<span class="ld-flag-tag">Pris</span>' : team && others.length ? `<span class="ld-flag-tag ally">${others.length} allié${others.length > 1 ? 's' : ''}</span>` : ''}
      </button>`;
    }).join('')}</div>` : '';
    let statusText, ready = false;
    if (!p.connected) statusText = 'hors ligne';
    else if (phase === 'army_building') { ready = p.armySubmitted || p.isReady; statusText = ready ? 'armée prête' : 'recrute…'; }
    else if (bot) { ready = !!p.generalId; statusText = 'prêt'; }
    else if (!p.generalId) statusText = 'choisit un général';
    else if (!p.flag) statusText = 'choisit un drapeau';
    else { ready = !!p.isReady; statusText = p.isReady ? 'prêt' : 'se prépare'; }
    const gen = p.generalId && GENERALS_DATA.find(g => g.id === p.generalId);
    const genImg = gen && generalImageUrl(gen);
    if (p.id === myId) li.classList.add('me');
    li.style.setProperty('--pc', color);
    li.innerHTML = `
      <span class="ld-pface">${genImg ? `<img src="${genImg}" alt="">` : `<span class="ld-brush" aria-hidden="true">${gen ? escapeHtml(gen.name.charAt(0)) : '?'}</span>`}</span>
      <div class="ld-pbody">
        <div class="ld-pline">${flagImg(p.flag)}<span class="ld-pname">${escapeHtml(p.name)}${p.id === myId ? ' <em>(vous)</em>' : ''}</span>${badge}</div>
        <div class="ld-pline">
          ${bot && phase === 'lobby' && hostId === myId
            ? `<button type="button" class="ld-pgen ld-pgen-btn" onclick="changeBotGeneral('${escapeHtml(p.id)}')" title="Changer le général de cette IA">${escapeHtml(genName)} <span aria-hidden="true">▾</span></button>`
            : `<span class="ld-pgen">${escapeHtml(genName)}</span>`}
          <span class="player-status${ready ? ' ready' : ''}">${statusText}</span>
        </div>
      </div>
      ${bot && phase === 'lobby' && hostId === myId ? `<button class="bot-remove" onclick="removeBot('${escapeHtml(p.id)}')" title="Retirer cette IA" aria-label="Retirer cette IA">×</button>` : ''}
      ${swatches ? `<div class="ld-pflags"><span class="ld-label">Votre drapeau</span>${swatches}</div>` : ''}
    `;
    list.appendChild(li);
  }
  document.getElementById('player-count').textContent = players.length;
  renderBotControls(data);
  const specs = data.spectators || [];
  document.getElementById('spectator-list').innerHTML = specs.length
    ? `Spectateurs : ${specs.map(s => `<span class="tag${s.connected ? '' : ' offline'}">${escapeHtml(s.name)}${s.id === myId ? ' (vous)' : ''}</span>`).join('')}`
    : '';
}

function renderSettings(data) {
  const host = data.hostId === myId;
  const mapSel = document.getElementById('map-select');
  const known = mapsList.length ? mapsList : [{ id: data.mapId, name: data.mapName || data.mapId }];
  if (!known.some(m => m.id === data.mapId)) known.push({ id: data.mapId, name: data.mapName || data.mapId });
  mapSel.innerHTML = known.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('');
  mapSel.value = data.mapId;
  mapSel.disabled = !host;
  const cur = known.find(m => m.id === data.mapId);
  document.getElementById('map-desc').textContent = cur && cur.description ? cur.description : '';
  drawMapPreview(data.mapId);
  const budgetInput = document.getElementById('budget-input');
  if (document.activeElement !== budgetInput) budgetInput.value = data.budget;
  budgetInput.disabled = !host;
  const modeSel = document.getElementById('mode-select');
  const modes = modesList.length ? modesList : [{ id: 'sequential', name: 'Séquentiel (initiative)', available: true }];
  modeSel.innerHTML = modes.map(m => `<option value="${escapeHtml(m.id)}"${m.available ? '' : ' disabled'}>${escapeHtml(m.name)}</option>`).join('');
  modeSel.value = data.mode || 'sequential';
  modeSel.disabled = !host;
  renderModeSeg(modes, data.mode || 'sequential', host);
  renderGameSettings(data, host);
  const team = document.getElementById('set-teamMode');
  if (team) { team.checked = !!(data.settings && data.settings.teamMode); team.disabled = !host; }
  const me = data.players.find(p => p.id === myId);
  const readyBtn = document.getElementById('lobby-ready-btn');
  if (readyBtn) {
    readyBtn.style.display = host && myRole === 'player' && me ? '' : 'none';
    readyBtn.disabled = !me || !me.generalId || !me.flag;
    readyBtn.textContent = me && me.isReady ? 'Prêt ✓ (annuler)' : 'Je suis prêt';
    readyBtn.setAttribute('aria-pressed', me && me.isReady ? 'true' : 'false');
    readyBtn.title = !me ? '' : !me.generalId ? 'Choisissez d\'abord un général' : !me.flag ? 'Choisissez d\'abord un drapeau' : 'La partie commence quand tous les joueurs sont prêts';
  }
  document.getElementById('settings-hint').textContent = host ? 'Vous êtes l\'hôte : les paramètres s\'appliquent à tous.' : 'Seul l\'hôte peut modifier les paramètres.';
  const startBtn = document.getElementById('start-btn');
  const missing = data.players.filter(p => !p.generalId).length;
  const notReady = data.players.filter(p => !p.isBot && !p.isReady).length;
  const label = document.getElementById('ld-start-label');
  if (host) {
    startBtn.style.display = '';
    startBtn.disabled = missing > 0;
    startBtn.classList.remove('done');
    startBtn.removeAttribute('aria-pressed');
    startBtn.setAttribute('aria-label', missing > 0 ? `Lancer la bataille (${missing} joueur(s) sans général)` : 'Lancer la bataille');
    label.textContent = 'Lancer';
  } else if (myRole === 'player' && me) {
    startBtn.style.display = '';
    startBtn.disabled = !me.generalId || !me.flag;
    startBtn.classList.toggle('done', !!me.isReady);
    startBtn.setAttribute('aria-pressed', me.isReady ? 'true' : 'false');
    startBtn.setAttribute('aria-label', me.isReady ? 'Prêt — cliquer pour annuler' : 'Je suis prêt');
    label.textContent = me.isReady ? 'Prêt ✓' : 'Prêt';
  } else {
    startBtn.style.display = 'none';
  }
  document.getElementById('ld-start-hint').textContent = host
    ? (missing > 0 ? `${missing} joueur(s) sans général` : (data.players.length < 2 ? 'Ajoutez un joueur ou une IA.' : (notReady > 0 ? `${notReady} joueur(s) pas encore prêt(s) — vous pouvez lancer quand même.` : 'Tout le monde est prêt.')))
    : (myRole === 'player' && me ? (!me.generalId ? 'Choisissez un général.' : !me.flag ? 'Choisissez un drapeau.' : me.isReady ? 'En attente des autres joueurs (cliquez pour annuler).' : 'Cliquez sur Prêt : la bataille commence quand tous les joueurs sont prêts.') : '');
  const settingsBox = document.getElementById('ld-settings');
  if (!settingsBox.dataset.touched && (!host || window.matchMedia('(max-width: 640px)').matches)) settingsBox.open = false;
}

// Army builder
const UNIT_GROUPS = [
  { id: 'inf', name: 'Infanterie', hint: 'Le cœur de la ligne : tient le terrain et encaisse.', ids: ['pietaille', 'soldats', 'phalange', 'lancier'], cats: ['Infanterie'] },
  { id: 'tir', name: 'Tireurs', hint: 'Frappent à distance, sans riposte possible.', ids: ['archer', 'archer_elite'], cats: ['Tireurs'] },
  { id: 'cav', name: 'Cavalerie', hint: 'Rapide et décisive en charge, fragile au contact prolongé.', ids: ['cavalier_leger', 'cavalier_lourd'], cats: ['Chevaux', 'Cavalerie'] },
  { id: 'char', name: 'Chars', hint: 'Lourds, ils traversent les lignes ennemies.', ids: ['char'], cats: ['Chars'] },
  { id: 'spe', name: 'Unités spéciales', hint: 'Renseignement, sabotage et génie.', ids: ['espion', 'assassin', 'batisseurs'], cats: [] },
];
const GROUP_ICONS = {
  inf: '<path d="M12 3l7 3v5c0 5-3.5 8-7 10-3.5-2-7-5-7-10V6z"/><path d="M12 7v9M9 11h6"/>',
  tir: '<path d="M6 3c9 3 9 15 0 18"/><path d="M6 3v18M6 12h14M16 8l4 4-4 4"/>',
  cav: '<path d="M8 21v-5l-3-3 2-6 6-4 3 3 4 1-1 4h-3l-2 2v8"/><circle cx="14" cy="7.5" r=".6" fill="currentColor"/>',
  char: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 4v6M12 14v6M4 12h6M14 12h6M6.3 6.3l4.3 4.3M13.4 13.4l4.3 4.3M17.7 6.3l-4.3 4.3M10.6 13.4l-4.3 4.3"/>',
  spe: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
};
const groupIcon = (id, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GROUP_ICONS[id] || GROUP_ICONS.spe}</svg>`;
const UNIT_STATS = [['attack', 'Attaque', 'ATQ'], ['defense', 'Défense', 'DÉF'], ['power', 'Puissance', 'PUI'], ['armor', 'Armure', 'ARM'], ['speed', 'Vitesse', 'VIT']];
const fmtGold = (n) => Number(n || 0).toLocaleString('fr-FR');

function unitGroupOf(u) {
  return UNIT_GROUPS.find(g => g.ids.includes(u.id)) || UNIT_GROUPS.find(g => g.cats.includes(u.category)) || UNIT_GROUPS[UNIT_GROUPS.length - 1];
}

function renderArmyGeneral() {
  const box = document.getElementById('ld-army-general');
  const g = GENERALS_DATA.find(x => x.id === selectedGeneral);
  const img = g ? generalImageUrl(g) : null;
  const chosen = UNITS_DATA.filter(u => (armyQuantities[u.id] || 0) > 0);
  const totalUnits = chosen.reduce((n, u) => n + armyQuantities[u.id], 0);
  const summary = chosen.length
    ? `<ul class="ld-army-list">${chosen.map(u => `<li><span class="ld-al-ico">${groupIcon(unitGroupOf(u).id, 16)}</span>
        <span class="ld-al-name">${escapeHtml(u.name)}</span><span class="ld-al-n">× ${armyQuantities[u.id]}</span>
        <span class="ld-gold">${fmtGold(u.cost * armyQuantities[u.id])}</span></li>`).join('')}</ul>`
    : '<p class="ld-army-empty">Aucune unité recrutée. Ajoutez des troupes avec les boutons +.</p>';
  box.innerHTML = `${g ? `<button type="button" class="ld-army-hero" onclick="showGeneralSheet('${escapeHtml(g.id)}')" title="Voir la fiche de ${escapeHtml(g.name)}">
      ${img ? `<div class="ld-army-face"><img src="${img}" alt=""></div>` : ''}
      <div class="ld-army-hero-txt"><div class="ld-gen-kicker">Votre général · ${escapeHtml(kingdomLabel(g))}</div>
      <div class="ld-gen-name">${escapeHtml(g.name)}</div>${statBars(g)}<span class="ld-army-more">Voir la fiche</span></div></button>` : ''}
    <div class="ld-army-sum">
      <div class="ld-army-sum-head"><span>Votre armée</span><b>${totalUnits} unité${totalUnits > 1 ? 's' : ''}</b></div>
      ${summary}
    </div>`;
}

function unitCardHtml(u, max) {
  const img = unitImageUrl(u);
  const stats = UNIT_STATS.map(([k, label, short]) => {
    const v = u[k] ?? 0;
    return `<div class="ld-us" title="${label} : ${v}"><span>${short}</span><b>${v}</b><span class="ld-us-track"><i style="width:${Math.max(6, Math.min(100, v / (max[k] || 1) * 100))}%"></i></span></div>`;
  }).join('');
  const extra = [`${u.vitality} vitalité`, `${u.morale} moral`];
  if (u.range > 1) extra.push(`portée ${u.range}`);
  return `<article class="ld-ucard" id="unit-row-${u.id}" data-unit="${escapeHtml(u.id)}">
    <button class="ld-ucard-art" data-sheet="${escapeHtml(u.id)}" aria-label="Fiche complète : ${escapeHtml(u.name)}">
      ${img ? `<img src="${img}" alt="" loading="lazy">` : `<span class="ld-ucard-ico">${groupIcon(unitGroupOf(u).id, 48)}</span>`}
      <span class="ld-ucard-cost"><b>${fmtGold(u.cost)}</b> or</span>
      <span class="ld-ucard-count" id="badge-${u.id}" aria-hidden="true"></span>
      <span class="ld-ucard-info" aria-hidden="true">Fiche</span>
    </button>
    <div class="ld-ucard-body">
      <div class="ld-ucard-title"><b>${escapeHtml(u.name)}</b><small>${extra.join(' · ')}</small></div>
      <div class="ld-ustats">${stats}</div>
      ${u.bonus ? `<p class="ld-ucard-bonus" title="${escapeHtml(u.bonus)}">${escapeHtml(u.bonus)}</p>` : ''}
    </div>
    <div class="ld-ucard-foot unit-qty">
      <button class="ld-q" data-q="-1" aria-label="Retirer : ${escapeHtml(u.name)}">−</button>
      <span id="qty-${u.id}" aria-live="polite">0</span>
      <button class="ld-q" data-q="1" aria-label="Ajouter : ${escapeHtml(u.name)}">+</button>
    </div>
  </article>`;
}

function renderArmyBuilder() {
  const shop = document.getElementById('unit-shop');
  armyQuantities = {};
  UNITS_DATA.forEach(u => { armyQuantities[u.id] = 0; });
  const max = {};
  for (const [k] of UNIT_STATS) max[k] = Math.max(...UNITS_DATA.map(u => u[k] || 0));
  const groups = UNIT_GROUPS.map(g => ({ g, units: UNITS_DATA.filter(u => unitGroupOf(u) === g) })).filter(x => x.units.length);
  shop.innerHTML = groups.map(({ g, units }) => `<section class="ld-cat" data-group="${g.id}">
      <header class="ld-cat-head"><span class="ld-cat-ico">${groupIcon(g.id, 20)}</span><h3>${g.name}</h3><p>${g.hint}</p><span class="ld-cat-n" id="cat-n-${g.id}"></span></header>
      <div class="ld-cat-grid">${units.map(u => unitCardHtml(u, max)).join('')}</div>
    </section>`).join('');
  shop.onclick = (e) => {
    const card = e.target.closest('.ld-ucard');
    if (!card) return;
    const q = e.target.closest('[data-q]');
    if (q) { changeQty(card.dataset.unit, Number(q.dataset.q)); return; }
    if (e.target.closest('[data-sheet]')) {
      const u = UNITS_DATA.find(x => x.id === card.dataset.unit);
      if (u) showUnitCardLobby(u);
    }
  };
  renderArmyGeneral();
  updateBudgetDisplay();
}

function changeQty(typeId, delta) {
  const unit = UNITS_DATA.find(u => u.id === typeId);
  if (!unit) return;
  const newQty = Math.max(0, (armyQuantities[typeId] || 0) + delta);
  if (delta > 0 && computeSpent() + unit.cost > budget) return notify('Budget insuffisant !');
  armyQuantities[typeId] = newQty;
  renderArmyGeneral();
  updateBudgetDisplay();
}

function computeSpent() {
  let total = 0;
  for (const [id, qty] of Object.entries(armyQuantities)) {
    const u = UNITS_DATA.find(u => u.id === id);
    if (u) total += u.cost * qty;
  }
  return total;
}

function updateBudgetDisplay() {
  const spent = computeSpent();
  const left = budget - spent;
  document.getElementById('army-budget').textContent = fmtGold(budget);
  document.getElementById('army-spent').textContent = fmtGold(spent);
  document.getElementById('army-remaining').textContent = fmtGold(left);
  const fill = document.getElementById('ld-budget-fill');
  if (fill) fill.style.width = `${budget > 0 ? Math.min(100, spent / budget * 100) : 0}%`;
  for (const u of UNITS_DATA) {
    const n = armyQuantities[u.id] || 0;
    const card = document.getElementById(`unit-row-${u.id}`);
    if (!card) continue;
    card.classList.toggle('has', n > 0);
    card.classList.toggle('pricey', u.cost > left);
    document.getElementById(`qty-${u.id}`).textContent = n;
    const badge = document.getElementById(`badge-${u.id}`);
    if (badge) badge.textContent = n > 0 ? `× ${n}` : '';
    const plus = card.querySelector('[data-q="1"]');
    if (plus) { plus.disabled = u.cost > left; plus.title = u.cost > left ? 'Budget insuffisant' : ''; }
    const minus = card.querySelector('[data-q="-1"]');
    if (minus) minus.disabled = n === 0;
  }
  for (const g of UNIT_GROUPS) {
    const el = document.getElementById(`cat-n-${g.id}`);
    if (!el) continue;
    const n = UNITS_DATA.filter(u => unitGroupOf(u) === g).reduce((t, u) => t + (armyQuantities[u.id] || 0), 0);
    el.textContent = n ? `${n} recrutée${n > 1 ? 's' : ''}` : '';
  }
}

function submitArmy() {
  const units = Object.entries(armyQuantities)
    .filter(([, qty]) => qty > 0)
    .map(([typeId, count]) => ({ typeId, count }));
  if (units.length === 0) return notify('Ajoutez au moins une unité.');
  KBNet.send('submit_army', { units });
}

function enterArmyBuilding(data) {
  if (myRole !== 'player') { show('screen-wait'); return; }
  const wasVisible = document.getElementById('screen-army').style.display === 'block';
  show('screen-army');
  if (!wasVisible) renderArmyBuilder();
  else renderArmyGeneral();
  updateBudgetDisplay();
  if (data && data.armySubmitted) markArmySubmitted();
}

function markArmySubmitted() {
  armySubmitted = true;
  const btn = document.getElementById('army-submit-btn');
  btn.querySelector('.ld-seal-label').textContent = 'Reconfirmer';
  btn.setAttribute('aria-label', 'Modifier et reconfirmer l\'armée');
}

function updateArmyWait(data) {
  const host = data.hostId === myId;
  const tools = document.getElementById('army-host-tools');
  if (tools) {
    tools.style.display = host ? '' : 'none';
    const bi = document.getElementById('army-budget-input');
    if (bi && document.activeElement !== bi) bi.value = data.budget;
  }
  const nations = document.getElementById('army-nations');
  if (nations) nations.innerHTML = data.players.map(p => `<span class="ld-nation${p.armySubmitted || p.isReady ? ' ready' : ''}" title="${escapeHtml(p.name)}">${flagImg(p.flag)}<span>${escapeHtml(p.name)}</span></span>`).join('');
  const ready = data.players.filter(p => p.isReady).length;
  const txt = `${ready}/${data.players.length} armée(s) prête(s)`;
  document.getElementById('army-wait').textContent = armySubmitted ? `Armée confirmée — ${txt}` : txt;
  document.getElementById('wait-text').textContent = `Les généraux recrutent leurs troupes… ${txt}`;
}

function goToGame() {
  if (goToGame.done) return;
  goToGame.done = true;
  window.location.href = '/game.html';
}

function onRoomUpdate(data) {
  lastLobby = data;
  roomCode = data.roomCode;
  budget = data.budget;
  isHost = data.hostId === myId;
  document.getElementById('room-code-display').textContent = data.roomCode;
  document.getElementById('ld-room-code-mini').textContent = data.roomCode;
  document.getElementById('ld-room-tag').hidden = false;
  const me = data.players.find(p => p.id === myId);
  if (me) { selectedGeneral = me.generalId; selectedColor = me.color; }
  if (me && document.getElementById('screen-army').style.display === 'block') renderArmyGeneral();
  document.getElementById('role-hint').textContent = myRole === 'spectator' ? 'Vous regardez cette partie en spectateur.' : 'Partagez le code ou le lien avec vos amis.';
  document.getElementById('generals-card').style.display = myRole === 'player' ? '' : 'none';
  renderPlayerList(data);
  renderSettings(data);
  renderGenerals(data.takenGenerals || []);
  if (data.phase === 'lobby') {
    show('screen-lobby');
  } else if (data.phase === 'army_building') {
    if (document.getElementById('screen-army').style.display !== 'block' && document.getElementById('screen-wait').style.display !== 'block') enterArmyBuilding(me && me.isReady ? { armySubmitted: true } : null);
    updateArmyWait(data);
    if (document.getElementById('screen-army').style.display === 'block') updateBudgetDisplay();
  } else {
    goToGame();
  }
}

function lobbyDispatch(event, data) {
  switch (event) {
    case 'session':
      myId = data.playerId;
      roomCode = data.roomCode;
      myRole = data.role;
      showLobbyError('');
      KBNet.send('list_maps');
      break;
    case 'room_update':
      onRoomUpdate(data);
      break;
    case 'maps_list':
      mapsList = data.maps || [];
      modesList = data.modes || [];
      if (lastLobby) renderSettings(lastLobby);
      break;
    case 'phase_change':
      if (data.budget !== undefined) budget = data.budget;
      if (data.phase === 'lobby') { armySubmitted = false; show('screen-lobby'); }
      if (data.phase === 'army_building') enterArmyBuilding(data);
      else if (data.phase === 'deployment' || data.phase === 'battle') goToGame();
      break;
    case 'army_accepted':
      markArmySubmitted();
      notify('Armée confirmée ! En attente des autres joueurs…', 'success');
      if (lastLobby) updateArmyWait(lastLobby);
      break;
    case 'deployment_state':
    case 'game_state':
      goToGame();
      break;
    case 'player_left':
      notify(`${data.name} a quitté la salle.`, 'info');
      break;
    case 'error':
      if (data.sessionLost) {
        myId = null; roomCode = null;
        show('screen-home');
        renderResume();
        showLobbyError('Impossible de reprendre la partie : ' + (data.message || 'session expirée.'));
      } else {
        showLobbyError(data.message || 'Erreur.');
        notify(data.message || 'Erreur.');
      }
      break;
  }
}

// Stats from the balance tables (GET /api/balance, local server only); the arrays above stay as fallback
// and keep the client-only fields (images, ability texts) the API does not provide.
async function loadBalanceData() {
  try {
    const res = await fetch('/api/balance');
    if (!res.ok) return;
    const { tables } = await res.json();
    const merge = (list, rows) => {
      for (const row of rows) {
        if (!row || !row.id) continue;
        const cur = list.find(x => x.id === row.id);
        if (cur) Object.assign(cur, row);
        else list.push({ ...row });
      }
    };
    if (tables && tables.units) merge(UNITS_DATA, Array.isArray(tables.units) ? tables.units : Object.values(tables.units));
    if (tables && tables.generals) merge(GENERALS_DATA, Array.isArray(tables.generals) ? tables.generals : Object.values(tables.generals));
    if (lastLobby) renderGenerals(lastLobby.takenGenerals || []);
    fillSoloGenerals();
  } catch (e) { /* static hosting: hardcoded data */ }
}

function initLobby() {
  loadBalanceData();
  const settingsBox = document.getElementById('ld-settings');
  settingsBox.addEventListener('toggle', () => { settingsBox.dataset.touched = '1'; });
  initSettingsControls();
  fillSoloGenerals();
  KBNet.mountIndicator();
  const params = new URLSearchParams(location.search);
  const joinCode = (params.get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const name = savedName();
  document.getElementById('create-name').value = name;
  document.getElementById('join-name').value = name;
  document.body.classList.add('ld-at-home');
  document.querySelectorAll('.ld-choice').forEach(b => b.addEventListener('click', () => setNewKind(b.dataset.kind)));
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const gp = document.getElementById('ld-gpicker');
    if (gp && !gp.hidden) { gp.hidden = true; return; }
    closeHomePanel();
  });
  document.getElementById('home-sheet').addEventListener('click', (e) => { if (e.target.id === 'home-sheet') closeHomePanel(); });
  if (joinCode) {
    document.getElementById('join-code').value = joinCode;
    document.getElementById('join-title').textContent = params.get('spectate') ? `Regarder la partie ${joinCode}` : `Rejoindre la partie ${joinCode}`;
    openHomePanel('join');
    document.getElementById('join-name').focus();
    const s = KBNet.getSession();
    if (s && s.roomCode !== joinCode) KBNet.clearSession();
  }
  document.getElementById('join-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(!!params.get('spectate')); });
  document.getElementById('create-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') startNewGame(); });
  document.getElementById('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(!!params.get('spectate')); });
  if (!joinCode) renderResume();
  let wasDown = false;
  KBNet.connect({
    onEvent: lobbyDispatch,
    onStatus: (st) => {
      if (st === 'reconnecting' && !wasDown) { wasDown = true; notify('Connexion perdue, reconnexion…', 'info'); }
      if (st === 'connected' && wasDown) { wasDown = false; notify('Connexion rétablie.', 'success'); }
      if (st === 'replaced') showLobbyError('Cette session est ouverte dans un autre onglet.');
    },
  });
}

initLobby();
