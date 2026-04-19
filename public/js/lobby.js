// WebSocket natif (remplace socket.io)
let ws = null;
let wsQueue = [];
let tryingRejoin = false;

function wsConnect() {
  ws = new WebSocket(window.WS_URL || ('ws' + (location.protocol === 'https:' ? 's' : '') + '://' + location.host));
  ws.onopen = () => {
    wsQueue.forEach(msg => ws.send(msg));
    wsQueue = [];
    const savedId = sessionStorage.getItem('lobbyPlayerId');
    const savedCode = sessionStorage.getItem('lobbyRoomCode');
    if (savedId && savedCode) {
      tryingRejoin = true;
      ws.send(JSON.stringify({ action: 'rejoin_game', roomCode: savedCode, oldPlayerId: savedId }));
    }
  };
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
  const msg = JSON.stringify({ action, ...data });
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(msg);
  else wsQueue.push(msg);
}

wsConnect();
let myId = null;
let roomCode = null;
let isHost = false;
let selectedGeneral = null;
let selectedFlag = null;
let roomOptions = {};

const FLAGS = [
  { id: 'qin',  name: 'Qin',  file: 'Quin.webp', color: '#1a5fa8' },
  { id: 'zhao', name: 'Zhao', file: 'Zhao.webp', color: '#e07820' },
  { id: 'wei',  name: 'Wei',  file: 'Wei.webp',  color: '#1a7a3a' },
  { id: 'chu',  name: 'Chu',  file: 'Chu.webp',  color: '#20b8c8' },
  { id: 'yan',  name: 'Yan',  file: 'Yan.webp',  color: '#c8b84a' },
  { id: 'qi',   name: 'Qi',   file: 'Qi.webp',   color: '#e8e8e8' },
  { id: 'han',  name: 'Han',  file: 'Han.webp',  color: '#9060c0' },
];

function pickFlag(flagId) {
  selectedFlag = flagId;
  wsSend('set_player_flag', { roomCode, flagId });
}
let armyQuantities = {};
let budget = 15000;

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
  { id:'ou_ki', name:'Ou Ki', kingdom:'QIN', force:15, strategy:16, charisma:18, vitality:240, armor:4, power:8, intimidation:7, weapon:{name:'Naginata',damage:12}, activeAbility:{name:'Sourire du Monstre',description:"Augmente la puissance de l'armée de 2 pendant 2 tours. Si l'armée ennemie est en infériorité numérique, réduit le moral de chaque unité adverse de 1.",cooldown:3}, passiveAbility:{name:'Oiseau Colossale',description:"Les généraux ennemis ont -3 en Force, Stratégie et Charisme. Les unités de l'armée d'Ou Ki ont +1 d'intimidation."}, citation:"«Ne l'as-tu pas encore compris ? La guerre, c'est amusant !»" },
  { id:'mou_bu', name:'Mou Bu', kingdom:'QIN', force:18, strategy:12, charisma:15, vitality:320, armor:6, power:9, intimidation:7, weapon:{name:'Masse',damage:14}, activeAbility:{name:'Poing du Titan',description:"Réduit l'armure d'une armée ennemie de 1 pendant 2 tours. Les unités ciblées éliminées octroient +1 de puissance à l'unité jusqu'à la fin de la journée.",cooldown:3}, passiveAbility:{name:'Force Inégalée',description:"Augmente la puissance des unités de l'armée de Mou Bu de 1."}, citation:"«Ce n'est pas la stratégie qui gagne les guerres… c'est la force !»" },
  { id:'ou_sen', name:'Ou Sen', kingdom:'QIN', force:13, strategy:17, charisma:14, vitality:220, armor:5, power:7, intimidation:6, weapon:{name:'Naginata',damage:12}, activeAbility:{name:"L'Architecte de la Guerre",description:"Réduit l'attaque et la vitesse d'une armée ennemie de 2 pendant 3 tours, et augmente la portée des unités à distance de l'armée de 200m pendant 2 tours.",cooldown:4}, passiveAbility:{name:'Forteresse Imprenable',description:"Les unités de l'armée d'Ou Sen gagnent 2 d'armure et subissent 1 d'intimidation en moins en position défensive."}, citation:"«La guerre n'est pas un duel de force… mais un jeu d'esprit où le perdant ne se relève jamais.»" },
  { id:'kan_ki', name:'Kan Ki', kingdom:'QIN', force:14, strategy:16, charisma:16, vitality:220, armor:3, power:6, intimidation:7, weapon:{name:'Arc',damage:8}, activeAbility:{name:'Tactiques Infernales',description:"Choisit 3 unités qui peuvent se déployer n'importe où sur le champ de bataille. Ces unités gagnent 2 de puissance et 1 d'intimidation pour la journée et ne subissent pas de malus d'éloignement.",cooldown:5}, passiveAbility:{name:'Terreur Psychologique',description:"Augmente l'intimidation des unités de 1 par embuscade réussie jusqu'à la fin de la bataille."}, citation:"«La guerre n'a jamais eu de règles. Ce sont juste les idiots qui s'en inventent.»" },
  { id:'ri_boku', name:'Ri Boku', kingdom:'ZHAO', force:11, strategy:18, charisma:15, vitality:180, armor:2, power:7, intimidation:6, weapon:{name:'Sabre',damage:10}, activeAbility:{name:'Vision du Sage',description:"Révèle l'emplacement d'une unité ennemie en embuscade.",cooldown:2}, passiveAbility:{name:'Maître de la Guerre Totale',description:"Lors d'un conflit, si une unité de l'armée est en avantage, elle reçoit un bonus de 1 en attaque ou en défense."}, citation:"«Gagner une guerre sans combattre est la plus grande des victoires.»" },
  { id:'kei_sha', name:'Kei Sha', kingdom:'ZHAO', force:13, strategy:16, charisma:13, vitality:240, armor:4, power:6, intimidation:6, weapon:{name:'Sabre',damage:10}, activeAbility:{name:'Piège Mortel',description:"Toute l'armée de Kei Sha recule instantanément de 2 cases et obtient un bonus de 1 de défense pendant les 2 prochains tours.",cooldown:4}, passiveAbility:{name:'Danse de la Guerre',description:"Chaque fois qu'une unité de l'armée de Kei Sha défend, l'unité adverse qui attaque perd 1 de vitalité en ignorant l'armure."}, citation:"«La guerre est un art, et seuls les plus fins stratèges en maîtrisent toutes les nuances.»" },
  { id:'shi_ba_shou', name:'Shi Ba Shou', kingdom:'ZHAO', force:17, strategy:15, charisma:18, vitality:240, armor:4, power:8, intimidation:6, weapon:{name:'Naginata',damage:12}, activeAbility:{name:'Forteresse Inviolable',description:"Les unités de l'armée en position de défense gagnent 5 d'armure pendant 2 tours et annule la charge d'une unité.",cooldown:4}, passiveAbility:{name:'Loyauté Absolue',description:"Lorsqu'une unité alliée est détruite, les unités alliées dans un rayon de 400m regagnent 1 de vitalité."}, citation:"«Tant que Zhao aura besoin de moi, je resterai son bouclier.»" },
  { id:'ren_pa', name:'Ren Pa', kingdom:'CHU', force:17, strategy:16, charisma:17, vitality:310, armor:5, power:8, intimidation:7, weapon:{name:'Naginata',damage:12}, activeAbility:{name:'Furie Martial',description:"Si une unité ennemie possède 12 de vitalité ou moins et se trouve au corps à corps avec Ren Pa, détruit cette unité peu importe son type.",cooldown:3}, passiveAbility:{name:'Volonté Indomptable',description:"La troupe de Ren Pa continue de se battre pendant 1 tour après avoir été démoralisée."}, citation:"«Un vrai guerrier ne fuit jamais la bataille. Seuls les faibles se cachent derrière les mots.»" },
  { id:'go_kei', name:'Go Kei', kingdom:'WEI', force:14, strategy:17, charisma:15, vitality:240, armor:4, power:6, intimidation:7, weapon:{name:'Sabre',damage:10}, activeAbility:{name:'Rempart Inébranlable',description:"Les unités de l'armée de Go Kei obtiennent 3 de défense et 2 de puissance supplémentaires en position de défense pendant 2 tours.",cooldown:3}, passiveAbility:{name:'Gardien de Wei',description:"Lorsqu'une unité de l'armée de Go Kei tue une unité ennemie en position de défense, l'unité gagne 1 de puissance et 1 de défense jusqu'à la fin de la bataille."}, citation:"«Un général qui se précipite vers la bataille a déjà perdu. Celui qui attend son heure triomphe sans effort.»" },
  { id:'go_hou_mei', name:'Go Hou Mei', kingdom:'WEI', force:10, strategy:18, charisma:15, vitality:160, armor:2, power:5, intimidation:6, weapon:{name:'-',damage:6}, activeAbility:{name:'Esprit Tactique Inégalé',description:"À la fin d'un tour, Go Hou Mei peut rejouer un de ses officiers ainsi que la troupe sous son commandement, mais ne peut pas attaquer.",cooldown:3}, passiveAbility:{name:'Génie Militaire',description:"Si Go Hou Mei réussit le test de Stratégie et commence le tour, ses unités ont +1 d'attaque et de défense."}, citation:"«La guerre est un jeu d'échecs où chaque mouvement détermine le vainqueur avant même que l'ennemi ne s'en rende compte.»" },
  { id:'gai_mou', name:'Gai Mou', kingdom:'WEI', force:18, strategy:12, charisma:15, vitality:360, armor:4, power:9, intimidation:7, weapon:{name:'Naginata',damage:12}, activeAbility:{name:'Rugissement du Lion',description:"Toutes les troupes ennemies (à l'exception des officiers) perdent 1 d'intimidation dans un rayon de 1000m autour de Gai Mou.",cooldown:3}, passiveAbility:{name:'Fierté Inflexible',description:"Lors d'un combat impliquant une unité de l'armée de Gai Mou, si l'unité adverse est en supériorité numérique (plus de vitalité), l'unité alliée obtient un bonus de 1 de puissance."}, citation:"«Que ce soit dix, cent ou mille ennemis… je les écraserai tous de mes propres mains !»" },
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
  { id:'pietaille',      name:'Piétaille',      category:'Infanterie', cost:500,  vitality:300, morale:180, attack:6,  power:5,  defense:5,  armor:4,  intimidation:2,  speed:3, range:1, bonus:"+10 de moral au début du tour si l'unité est dans le rayon de Charisme de son général." },
  { id:'soldats',        name:'Soldats',        category:'Infanterie', cost:600,  vitality:200, morale:300, attack:10, power:8,  defense:10, armor:8,  intimidation:3,  speed:2, range:1, bonus:"Si après une attaque du Soldat, une unité ennemie a moins de 10% de sa vitalité, elle est exécutée." },
  { id:'espion',         name:'Espion',         category:'Infanterie', cost:400,  vitality:250, morale:150, attack:7,  power:6,  defense:4,  armor:6,  intimidation:2,  speed:4, range:1, bonus:"+5 de vision et +2 de vision en forêt." },
  { id:'archer',         name:'Archer',         category:'Tireurs',    cost:600,  vitality:240, morale:150, attack:7,  power:6,  defense:4,  armor:5,  intimidation:2,  speed:3, range:3, bonus:"Attaque à distance. L'unité attaquée ne fait pas de test de défense." },
  { id:'phalange',       name:'Phalange',       category:'Infanterie', cost:700,  vitality:200, morale:300, attack:9,  power:7,  defense:11, armor:10, intimidation:3,  speed:2, range:1, bonus:"+2 Armure contre les attaques de tir." },
  { id:'lancier',        name:'Lancier',        category:'Infanterie', cost:700,  vitality:200, morale:350, attack:9,  power:9,  defense:11, armor:8,  intimidation:4,  speed:3, range:1, bonus:"+6 de puissance contre les unités de cavalerie et les chars." },
  { id:'assassin',       name:'Assassin',       category:'Infanterie', cost:900,  vitality:140, morale:400, attack:14, power:12, defense:9,  armor:13, intimidation:4,  speed:4, range:1, bonus:"Invisible pour les ennemis à plus de 4 cases." },
  { id:'cavalier_leger', name:'Cavalier Léger', category:'Chevaux',    cost:800,  vitality:150, morale:350, attack:12, power:10, defense:9,  armor:15, intimidation:4,  speed:6, range:1, bonus:"Peut se déplacer après une attaque." },
  { id:'archer_elite',   name:"Archer d'Élite", category:'Tireurs',    cost:800,  vitality:200, morale:220, attack:8,  power:8,  defense:5,  armor:8,  intimidation:3,  speed:3, range:4, bonus:"Attaque à distance (portée 4). L'unité attaquée ne fait pas de test de défense." },
  { id:'batisseurs',     name:'Bâtisseurs',     category:'Chars',      cost:900,  vitality:150, morale:100, attack:4,  power:4,  defense:6,  armor:8,  intimidation:2,  speed:4, range:1, bonus:"Peut construire des échelles sur les falaises et des chevaux de frise sur les segments vides." },
  { id:'cavalier_lourd', name:'Cavalier Lourd', category:'Chevaux',    cost:1000, vitality:100, morale:400, attack:16, power:14, defense:10, armor:60, intimidation:5,  speed:5, range:1, bonus:"Inflige 50% de ses dégâts d'intimidation aux unités adjacentes à sa cible lors d'une attaque." },
  { id:'char',           name:'Char',           category:'Chars',      cost:1200, vitality:80,  morale:450, attack:18, power:16, defense:10, armor:80, intimidation:6,  speed:5, range:1, bonus:"Peut traverser les unités ennemies (si assez de vitesse)." },
];

function show(id) {
  ['screen-home', 'screen-lobby', 'screen-army'].forEach(s => {
    const el = document.getElementById(s);
    if (s === id) {
      el.style.display = (s === 'screen-army' || s === 'screen-lobby') ? 'flex' : 'block';
    } else {
      el.style.display = 'none';
    }
  });
  const c = document.querySelector('.lobby-container');
  c.classList.toggle('army-mode', id === 'screen-army');
  c.classList.toggle('lobby-mode', id === 'screen-lobby');
}

function notify(msg, type = 'error') {
  const n = document.getElementById('notification');
  n.textContent = msg;
  n.className = type;
  n.style.display = 'block';
  setTimeout(() => n.style.display = 'none', 3500);
}

function createRoom() {
  const name = document.getElementById('create-name').value.trim();
  if (!name) return notify('Entrez votre nom.');
  wsSend('create_room', { playerName: name });
}

function joinRoom() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) return notify('Entrez votre nom.');
  if (code.length < 4) return notify('Entrez le code de la salle.');
  wsSend('join_room', { roomCode: code, playerName: name });
}

function setBudget() {
  const raw = parseInt(document.getElementById('budget-input').value);
  if (isNaN(raw) || raw < 1000) return notify('Budget minimum : 1000 or');
  const val = Math.round(raw / 100) * 100;
  document.getElementById('budget-input').value = val;
  wsSend('set_budget', { roomCode, budget: val });
}

function setBudgetFromArmy() {
  const raw = parseInt(document.getElementById('army-budget-input').value);
  if (isNaN(raw) || raw < 1000) return notify('Budget minimum : 1000 or');
  const val = Math.round(raw / 100) * 100;
  document.getElementById('army-budget-input').value = val;
  wsSend('set_budget', { roomCode, budget: val });
}

function backToLobby() {
  wsSend('back_to_lobby', { roomCode });
}

function selectGeneral(id) {
  selectedGeneral = id;
  wsSend('select_general', { roomCode, generalId: id });
}

function addAI() {
  const generalId = document.getElementById('ai-general-select')?.value || null;
  const flagId = document.getElementById('ai-flag-select')?.value || null;
  wsSend('add_ai', { roomCode, generalId, flagId });
}

function removeBot(botId) {
  wsSend('remove_bot', { roomCode, botId });
}

function updateAIGeneralSelect(takenGenerals) {
  const select = document.getElementById('ai-general-select');
  if (!select) return;
  const available = GENERALS_DATA.filter(g => !takenGenerals.includes(g.id));
  select.innerHTML = available.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
}

function updateAIFlagSelect(takenFlags) {
  const select = document.getElementById('ai-flag-select');
  if (!select) return;
  const available = FLAGS.filter(f => !takenFlags.includes(f.id));
  select.innerHTML = available.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
}

function renderBotList(players) {
  const box = document.getElementById('bot-list');
  if (!box) return;
  const bots = players.filter(p => p.isBot);
  box.innerHTML = bots.map(p => `
    <div style="display:flex;align-items:center;gap:8px;background:#1a1008;border:1px solid #3a2408;border-radius:4px;padding:4px 8px;font-size:0.82em">
      ${flagImg(p.flag, 18)}
      <span style="flex:1;color:#c8960c">${p.name}</span>
      <button onclick="removeBot('${p.id}')" style="background:#5a1010;color:#ff8080;border:none;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:0.85em">✕ Retirer</button>
    </div>
  `).join('');
}

function startGame() {
  wsSend('start_game', { roomCode });
}

function toggleReady() {
  wsSend('lobby_ready', { roomCode });
}

function setOption(key, value) {
  console.log('[setOption] key=', key, 'value=', value, 'isHost=', isHost, 'roomCode=', roomCode);
  if (!isHost) return;
  wsSend('set_option', { roomCode, key, value });
  console.log('[setOption] sent');
}

function renderFlagPicker(takenFlags) {
  const container = document.getElementById('flag-picker');
  if (!container) return;
  const teamMode = roomOptions.teamMode;
  container.innerHTML = FLAGS.map(f => {
    const isTaken = !teamMode && takenFlags.includes(f.id);
    const isSel = f.id === selectedFlag;
    return `<div class="flag-item${isSel ? ' selected' : ''}${isTaken ? ' taken' : ''}" onclick="${isTaken ? '' : `pickFlag('${f.id}')`}">
      <img src="/assets/flag/${f.file}" title="${f.name}">
      <div class="flag-item-name">${f.name}</div>
    </div>`;
  }).join('');
}

function renderGenerals(takenList) {
  const grid = document.getElementById('generals-grid');
  grid.innerHTML = '';

  const nationOrder = ['QIN', 'ZHAO', 'WEI', 'CHU'];
  const byNation = {};
  for (const g of GENERALS_DATA) {
    if (!byNation[g.kingdom]) byNation[g.kingdom] = [];
    byNation[g.kingdom].push(g);
  }
  const nations = nationOrder.filter(n => byNation[n]);
  // Ajoute les nations non prévues
  for (const n of Object.keys(byNation)) {
    if (!nations.includes(n)) nations.push(n);
  }

  for (const nation of nations) {
    const section = document.createElement('div');
    section.className = 'generals-nation-section';

    const row = document.createElement('div');
    row.className = 'generals-row';

    for (const g of byNation[nation]) {
      const taken = takenList.includes(g.id) && g.id !== selectedGeneral;
      const sel = g.id === selectedGeneral;
      const div = document.createElement('div');
      div.className = `general-card${taken ? ' taken' : ''}${sel ? ' selected' : ''}`;
      const imgEntry = GENERAL_IMAGE1_MAP[g.id];
      const imgHtml = imgEntry
        ? `<img src="/assets/unites/GENERAL IMAGE 1-1/${encodeURIComponent(imgEntry.file)}.${imgEntry.ext}" style="width:100%;aspect-ratio:1/1;object-fit:cover;object-position:top;display:block">`
        : `<div style="width:100%;aspect-ratio:1/1;background:#1a0f04;display:flex;align-items:center;justify-content:center;font-size:32px;color:#3a2408">★</div>`;
      div.innerHTML = `
        <div class="gen-name">${g.name}</div>
        ${imgHtml}
        <div class="gen-stats-row">
          ${statBox('Force', g.force)}${statBox('Stratégie', g.strategy)}${statBox('Charisme', g.charisma)}
        </div>
      `;
      if (!taken) div.onclick = () => { selectGeneral(g.id); showGeneralDetail(g); };
      row.appendChild(div);
    }

    section.appendChild(row);
    grid.appendChild(section);
  }
}

function showGeneralDetail(g) {
  const panel = document.getElementById('general-detail-panel');
  if (!panel) return;
  const imgEntry = GENERAL_IMAGE1_MAP[g.id];
  const imgHtml = imgEntry
    ? `<img class="roster-gen-img" src="/assets/unites/GENERAL IMAGE 1-1/${encodeURIComponent(imgEntry.file)}.${imgEntry.ext}">`
    : `<div class="roster-gen-img-placeholder">⚔</div>`;
  const bonusLines = [];
  if (g.activeAbility) bonusLines.push(`<strong>⚡ ${g.activeAbility.name}</strong> — ${g.activeAbility.description}`);
  if (g.passiveAbility) bonusLines.push(`<strong>☽ ${g.passiveAbility.name}</strong> — ${g.passiveAbility.description}`);
  panel.innerHTML = `
    <div class="gen-panel-wrap">
      <div class="gen-panel-title">${g.name}</div>
      <div class="roster-gen-wrap">
        ${imgHtml}
        <div class="roster-gen-body">
          <div class="stat-row">${statBox('Vitalité', g.vitality)}</div>
          <div class="stat-row">${statBox('Force', g.force)}${statBox('Stratégie', g.strategy)}${statBox('Charisme', g.charisma)}</div>
          <div class="stat-row">${statBox('Puissance', g.power)}${statBox('Armure', g.armor)}${statBox('Intimidation', g.intimidation)}</div>
        </div>
      </div>
      ${bonusLines.length ? `<div style="text-align:center;font-size:0.68em;color:#5a3c10;text-transform:uppercase;letter-spacing:0.08em;margin-top:6px;margin-bottom:3px">Bonus</div><div class="gen-panel-abilities">${bonusLines.join('<br>')}</div>` : ''}
      ${g.citation ? `<div class="gen-panel-citation">${g.citation}</div>` : ''}
    </div>
  `;
}

function showGeneralCard(g) {
  const imgEntry = GENERAL_IMAGE1_MAP[g.id];
  const imgHtml = imgEntry
    ? `<img class="uc-pdf-img" src="/assets/unites/GENERAL IMAGE 1-1/${encodeURIComponent(imgEntry.file)}.${imgEntry.ext}" alt="${g.name}">`
    : `<div class="uc-pdf-img-placeholder" style="font-size:52px;flex-direction:column;gap:8px">★<span style="font-size:14px;color:#7a5820">${g.name}</span></div>`;

  const row2 = [
    { label: 'Force',     value: g.force },
    { label: 'Stratégie', value: g.strategy },
    { label: 'Charisme',  value: g.charisma },
  ];
  const row3 = [
    { label: 'Armure', value: g.armor },
    { label: 'Arme',   value: g.weapon ? `${g.weapon.name} (${g.weapon.damage})` : '—' },
  ];
  const vit = `<div class="uc-pdf-stat" style="grid-column:1/-1"><div class="uc-pdf-stat-label">Vitalité</div><div class="uc-pdf-stat-value">${g.vitality}</div></div>`;
  const r2 = `<div style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px">${row2.map(s => `<div class="uc-pdf-stat"><div class="uc-pdf-stat-label">${s.label}</div><div class="uc-pdf-stat-value">${s.value}</div></div>`).join('')}</div>`;
  const r3 = row3.map(s => `<div class="uc-pdf-stat"><div class="uc-pdf-stat-label">${s.label}</div><div class="uc-pdf-stat-value">${s.value}</div></div>`).join('');
  const statsHtml = vit + r2 + r3;

  const bonusLines = [];
  if (g.activeAbility) bonusLines.push(`<strong>Capacité active :</strong> ${g.activeAbility.name} — ${g.activeAbility.description} (recharge : ${g.activeAbility.cooldown} tours)`);
  if (g.passiveAbility) bonusLines.push(`<strong>Passif :</strong> ${g.passiveAbility.name} — ${g.passiveAbility.description}`);
  const bonusHtml = bonusLines.length
    ? `<div class="uc-pdf-bonus">${bonusLines.join('<br>')}</div>`
    : '';

  const descHtml = g.citation
    ? `<div class="uc-pdf-desc"><em>${g.citation}</em></div>`
    : '';

  document.getElementById('general-card-content').innerHTML = `
    <div class="uc-pdf">
      <div class="uc-pdf-left">
        ${imgHtml}
        ${bonusHtml}
      </div>
      <div class="uc-pdf-right">
        <div class="uc-pdf-title">${g.name}<br><span style="font-size:0.85em">${g.kingdom}</span></div>
        <div class="uc-pdf-stats">${statsHtml}</div>
      </div>
      ${descHtml}
    </div>
  `;
  document.getElementById('overlay-general-card').style.display = 'flex';
}

function closeGeneralCard() {
  document.getElementById('overlay-general-card').style.display = 'none';
}

function showUnitCardLobby(u) {
  const imgEntry = UNIT_IMAGE1_MAP[u.id];
  const imgHtml = imgEntry
    ? `<img class="uc-pdf-img" src="/assets/unites/UNIT IMAGE 1-1/${encodeURIComponent(imgEntry.file)}.${imgEntry.ext}" alt="${u.name}">`
    : `<div class="uc-pdf-img-placeholder">${u.name.charAt(0)}</div>`;

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
    : `<div class="uc-pdf-bonus" style="color:#888;font-style:italic">Aucun bonus spécial</div>`;

  document.getElementById('general-card-content').innerHTML = `
    <div class="uc-pdf">
      <div class="uc-pdf-left">
        ${imgHtml}
        ${bonusHtml}
      </div>
      <div class="uc-pdf-right">
        <div class="uc-pdf-title">${u.name}<br><span style="font-size:0.85em">${u.category} — ${u.cost} or</span></div>
        <div class="uc-pdf-stats">${statsHtml}</div>
      </div>
    </div>
  `;
  document.getElementById('overlay-general-card').style.display = 'flex';
}

function renderArmyStatus(players) {
  const el = document.getElementById('army-players-status');
  if (!el) return;
  el.innerHTML = players.filter(p => !p.offline).map(p => {
    const ready = p.armySubmitted;
    return `<div style="display:flex;align-items:center;gap:4px;background:${ready ? '#1a3a1a' : '#1a1008'};border:1px solid ${ready ? '#2a8c2a' : '#3a2408'};border-radius:4px;padding:3px 8px">
      ${flagImg(p.flag, 18)}
      <span style="font-size:0.78em;color:${ready ? '#7fff7f' : '#c87040'}">${ready ? 'Prêt' : 'En attente'}</span>
    </div>`;
  }).join('');
}

function flagImg(flagId, size = 24) {
  const f = FLAGS.find(f => f.id === flagId);
  if (!f) return `<div style="width:${size}px;height:${size}px;border-radius:2px;background:#333;flex-shrink:0"></div>`;
  return `<img src="/assets/flag/${f.file}" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:2px;flex-shrink:0;border:1px solid #5a3c10" title="${f.name}">`;
}

function renderPlayerList(players, hostId, teamMode) {
  const list = document.getElementById('player-list');
  list.innerHTML = '';

  const flagOrder = ['qin', 'zhao', 'wei', 'chu', 'yan', 'qi', 'han'];
  const groups = {};
  const ungrouped = [];

  for (const p of players) {
    const gen = p.generalId ? GENERALS_DATA.find(g => g.id === p.generalId) : null;
    const flagId = p.flag || null;
    if (flagId) {
      if (!groups[flagId]) groups[flagId] = [];
      groups[flagId].push({ p, gen });
    } else {
      ungrouped.push({ p, gen });
    }
  }

  const flagsWithPlayers = flagOrder.filter(f => groups[f]);

  function makeRow(p, gen, hostId) {
    const genName = gen ? gen.name : '—';
    const isMe = p.id === myId;
    const isHost = p.id === hostId;
    const readyHtml = p.isReady
      ? '<span class="pl-ready pl-ready-yes">Prêt</span>'
      : '<span class="pl-ready pl-ready-no">' + (p.generalId ? 'En attente' : 'Pas prêt') + '</span>';
    const botBadge = p.isBot ? '<span class="player-badge" style="background:#555;font-size:0.7em">Bot</span>' : '';
    const hostBadge = isHost ? '<span class="player-badge host" style="font-size:0.7em">Host</span>' : '';
    const meStyle = isMe ? 'background:#1a1008;' : '';
    return `<li style="${meStyle}">
      <div class="pl-left">${flagImg(p.flag, 20)}<span class="pl-gen">${genName}</span>${botBadge}</div>
      <div class="pl-right">${hostBadge}<span class="pl-name">${p.name}</span>${readyHtml}</div>
    </li>`;
  }

  let html = '';
  if (teamMode) {
    for (const flagId of flagsWithPlayers) {
      const flagName = FLAGS.find(f => f.id === flagId)?.name || flagId.toUpperCase();
      html += `<li class="pl-nation-header">${flagName}</li>`;
      for (const { p, gen } of groups[flagId]) {
        html += makeRow(p, gen, hostId);
      }
    }
    if (ungrouped.length) {
      if (flagsWithPlayers.length) html += `<li class="pl-nation-header">—</li>`;
      for (const { p, gen } of ungrouped) {
        html += makeRow(p, gen, hostId);
      }
    }
  } else {
    for (const flagId of flagsWithPlayers) {
      for (const { p, gen } of groups[flagId]) {
        html += makeRow(p, gen, hostId);
      }
    }
    for (const { p, gen } of ungrouped) {
      html += makeRow(p, gen, hostId);
    }
  }

  list.innerHTML = html;
  document.getElementById('player-count').textContent = players.length;
}

// Army builder
function statBox(label, value) {
  return `<div class="stat-box"><div class="stat-box-label">${label}</div><div class="stat-box-value">${value}</div></div>`;
}

function renderRosterGeneral() {
  const box = document.getElementById('army-roster-general');
  if (!box) return;
  const g = GENERALS_DATA.find(g => g.id === selectedGeneral);
  if (!g) { box.innerHTML = ''; return; }
  const imgEntry = GENERAL_IMAGE1_MAP[g.id];
  const imgHtml = imgEntry
    ? `<img class="roster-gen-img" src="/assets/unites/GENERAL IMAGE 1-1/${encodeURIComponent(imgEntry.file)}.${imgEntry.ext}">`
    : `<div class="roster-gen-img-placeholder">⚔</div>`;
  const bonusLines = [];
  if (g.activeAbility) bonusLines.push(`<strong>⚡ ${g.activeAbility.name}</strong> — ${g.activeAbility.description}`);
  if (g.passiveAbility) bonusLines.push(`<strong>☽ ${g.passiveAbility.name}</strong> — ${g.passiveAbility.description}`);
  box.innerHTML = `
    <div class="gen-panel-wrap">
      <div class="gen-panel-title">${g.name}</div>
      <div class="roster-gen-wrap">
        ${imgHtml}
        <div class="roster-gen-body">
          <div class="stat-row">${statBox('Vitalité', g.vitality)}</div>
          <div class="stat-row">${statBox('Force', g.force)}${statBox('Stratégie', g.strategy)}${statBox('Charisme', g.charisma)}</div>
          <div class="stat-row">${statBox('Puissance', g.power)}${statBox('Armure', g.armor)}${statBox('Intimidation', g.intimidation)}</div>
        </div>
        ${selectedFlag ? `<img class="roster-flag-img" src="/assets/flag/${FLAGS.find(f=>f.id===selectedFlag)?.file}" title="${FLAGS.find(f=>f.id===selectedFlag)?.name}">` : ''}
      </div>
      ${bonusLines.length ? `<div style="text-align:center;font-size:0.68em;color:#5a3c10;text-transform:uppercase;letter-spacing:0.08em;margin-top:6px;margin-bottom:3px">Bonus</div><div class="gen-panel-abilities">${bonusLines.join('<br>')}</div>` : ''}
      ${g.citation ? `<div class="gen-panel-citation">${g.citation}</div>` : ''}
    </div>
  `;
}

function makeRosterCard(u) {
  const imgEntry = UNIT_IMAGE1_MAP[u.id];
  const imgHtml = imgEntry
    ? `<img class="unit-card-img" src="/assets/unites/UNIT IMAGE 1-1/${encodeURIComponent(imgEntry.file)}.${imgEntry.ext}" draggable="false">`
    : `<div class="unit-card-img-placeholder">⚔</div>`;
  const div = document.createElement('div');
  div.className = 'unit-card in-roster';
  div.title = 'Double-clic ou glisser vers le shop pour retirer';
  div.draggable = true;
  div.innerHTML = `
    <div class="unit-card-name">${u.name}</div>
    ${imgHtml}
    <div class="unit-card-cost">${u.cost}</div>
  `;
  div.addEventListener('click', () => showUnitDetail(u));
  div.addEventListener('dblclick', () => changeQty(u.id, -1));
  div.addEventListener('dragstart', e => { e.dataTransfer.setData('removeUnitId', u.id); div.classList.add('dragging'); });
  div.addEventListener('dragend', () => div.classList.remove('dragging'));
  return div;
}

function makeShopCard(u) {
  const div = document.createElement('div');
  div.className = 'unit-card';
  div.id = `card-${u.id}`;
  div.draggable = true;
  const imgEntry = UNIT_IMAGE1_MAP[u.id];
  const imgHtml = imgEntry
    ? `<img class="unit-card-img" src="/assets/unites/UNIT IMAGE 1-1/${encodeURIComponent(imgEntry.file)}.${imgEntry.ext}" draggable="false">`
    : `<div class="unit-card-img-placeholder">⚔</div>`;
  div.innerHTML = `
    <div class="unit-card-name">${u.name}</div>
    ${imgHtml}
    <div class="unit-card-cost">${u.cost}</div>
  `;
  div.addEventListener('click', () => showUnitDetail(u));
  div.addEventListener('dblclick', () => changeQty(u.id, 1));
  div.addEventListener('dragstart', e => { e.dataTransfer.setData('unitId', u.id); div.classList.add('dragging'); });
  div.addEventListener('dragend', () => div.classList.remove('dragging'));
  return div;
}

function renderArmyBuilder() {
  const shop = document.getElementById('unit-shop');
  shop.innerHTML = '';
  armyQuantities = {};
  UNITS_DATA.forEach(u => { armyQuantities[u.id] = 0; });

  const categoryOrder = ['Infanterie', 'Tireurs', 'Chevaux', 'Chars'];
  const byCategory = {};
  for (const u of UNITS_DATA) {
    if (!byCategory[u.category]) byCategory[u.category] = [];
    byCategory[u.category].push(u);
  }
  for (const cat of categoryOrder) {
    if (!byCategory[cat] || byCategory[cat].length === 0) continue;
    const units = byCategory[cat].slice().sort((a, b) => a.cost - b.cost);

    const section = document.createElement('div');
    section.className = 'unit-shop-category';

    const title = document.createElement('div');
    title.className = 'unit-shop-category-title';
    title.textContent = cat;
    section.appendChild(title);

    const row = document.createElement('div');
    row.className = 'unit-shop-category-row';

    for (const u of units) {
      row.appendChild(makeShopCard(u));
    }

    section.appendChild(row);
    shop.appendChild(section);
  }
  updateBudgetDisplay();
  renderRosterGeneral();
  updateArmyRoster();

  // Drop sur le shop = retirer une unité du roster
  const shopPanel = shop.parentElement;
  shopPanel.ondragover = e => e.preventDefault();
  shopPanel.ondrop = e => {
    e.preventDefault();
    const unitId = e.dataTransfer.getData('removeUnitId');
    if (unitId) changeQty(unitId, -1);
  };
}

function showUnitDetail(u) {
  document.querySelectorAll('.unit-card.selected').forEach(el => el.classList.remove('selected'));
  const card = document.getElementById(`card-${u.id}`);
  if (card) card.classList.add('selected');

  const panel = document.getElementById('army-detail-panel');
  const imgEntry = UNIT_IMAGE1_MAP[u.id];
  const imgHtml = imgEntry
    ? `<img class="army-detail-img" src="/assets/unites/UNIT IMAGE 1-1/${encodeURIComponent(imgEntry.file)}.${imgEntry.ext}">`
    : `<div class="army-detail-img-placeholder">⚔</div>`;
  panel.innerHTML = `
    <div class="army-detail-header">
      <div class="army-detail-name">${u.name}</div>
      <div class="army-detail-category">${u.category}</div>
    </div>
    ${imgHtml}
    <div class="army-detail-body">
      <div class="stat-row">${statBox('Vitalité', u.vitality)}${statBox('Moral', u.morale)}</div>
      <div class="stat-row">${statBox('Attaque', u.attack)}${statBox('Défense', u.defense)}</div>
      <div class="stat-row">${statBox('Puissance', u.power)}${statBox('Armure', u.armor)}${statBox('Intimidation', u.intimidation)}</div>
      <div class="stat-row">${statBox('Vitesse', u.speed)}${u.range > 1 ? statBox('Portée', u.range) : ''}</div>
      <div style="text-align:center;font-size:0.68em;color:#5a3c10;text-transform:uppercase;letter-spacing:0.08em;margin-top:6px;margin-bottom:3px">Bonus</div>
      <div class="army-detail-bonus">${u.bonus}</div>
    </div>
  `;
}

function changeQty(typeId, delta) {
  const unit = UNITS_DATA.find(u => u.id === typeId);
  const newQty = Math.max(0, armyQuantities[typeId] + delta);
  if (delta > 0 && computeSpent() + unit.cost > budget) {
    return notify('Budget insuffisant !');
  }
  armyQuantities[typeId] = newQty;
  updateBudgetDisplay();
  updateArmyRoster();
}

function updateArmyRoster() {
  const panel = document.getElementById('army-roster-panel');
  const grid = document.getElementById('army-roster-grid');
  grid.innerHTML = '';
  let total = 0;

  const sorted = UNITS_DATA.slice().sort((a, b) => b.cost - a.cost);
  for (const u of sorted) {
    const qty = armyQuantities[u.id] || 0;
    total += qty;
    for (let i = 0; i < qty; i++) {
      grid.appendChild(makeRosterCard(u));
    }
  }

  if (total === 0) {
    grid.innerHTML = '<div class="army-roster-placeholder">Aucune unité</div>';
  }

  panel.ondragover = e => { e.preventDefault(); panel.classList.add('drag-over'); };
  panel.ondragleave = () => panel.classList.remove('drag-over');
  panel.ondrop = e => {
    e.preventDefault();
    panel.classList.remove('drag-over');
    const unitId = e.dataTransfer.getData('unitId');
    if (unitId) changeQty(unitId, 1);
  };
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
  document.getElementById('army-spent').textContent = spent.toLocaleString();
  document.getElementById('army-remaining').textContent = (budget - spent).toLocaleString();
  const inp = document.getElementById('army-budget-input');
  if (inp && document.activeElement !== inp) inp.value = budget;
}

function submitArmy() {
  const units = Object.entries(armyQuantities)
    .filter(([, qty]) => qty > 0)
    .map(([typeId, count]) => ({ typeId, count }));

  if (units.length === 0) return notify('Ajoutez au moins une unité.');
  wsSend('submit_army', { roomCode, units });
}

// WebSocket event dispatch
function wsDispatch(event, data) {
  switch (event) {
    case 'room_created': {
      myId = data.playerId;
      roomCode = data.roomCode;
      isHost = true;
      sessionStorage.setItem('lobbyPlayerId', myId);
      sessionStorage.setItem('lobbyRoomCode', roomCode);
      document.getElementById('room-code-display').textContent = data.roomCode;
      document.getElementById('budget-card').style.display = 'block';
      document.getElementById('host-actions').style.display = 'block';
      updateAIGeneralSelect([]);
      updateAIFlagSelect([]);
      renderBotList([]);
      show('screen-lobby');
      break;
    }
    case 'room_joined': {
      myId = data.playerId;
      roomCode = data.roomCode;
      tryingRejoin = false;
      sessionStorage.setItem('lobbyPlayerId', myId);
      sessionStorage.setItem('lobbyRoomCode', roomCode);
      document.getElementById('room-code-display').textContent = data.roomCode;
      show('screen-lobby');
      break;
    }
    case 'room_update': {
      budget = data.budget;
      isHost = data.hostId === myId;
      if (data.options) roomOptions = data.options;
      document.getElementById('current-budget').textContent = data.budget.toLocaleString();
      const budgetInput = document.getElementById('budget-input');
      if (budgetInput && document.activeElement !== budgetInput) budgetInput.value = data.budget;
      const me = data.players.find(p => p.id === myId);
      if (me?.flag) selectedFlag = me.flag;
      if (me?.generalId) selectedGeneral = me.generalId;
      renderPlayerList(data.players, data.hostId, roomOptions.teamMode);
      renderArmyStatus(data.players);
      renderGenerals(data.takenGenerals);
      renderFlagPicker(data.players.filter(p => p.id !== myId).map(p => p.flag).filter(Boolean));
      // Bouton prêt
      const readyBtn = document.getElementById('ready-btn');
      if (readyBtn) {
        const meReady = me?.isReady;
        const canReady = !!(me?.generalId && me?.flag);
        readyBtn.textContent = meReady ? '✅ Prêt !' : 'Je suis prêt';
        readyBtn.className = `btn ${meReady ? 'btn-ready-on' : canReady ? 'btn-ready-on' : 'btn-ready'}`;
      }
      const tmCb = document.getElementById('opt-team-mode');
      const tmLabel = document.getElementById('opt-team-mode-label');
      const teamModeVal = !!(data.options && data.options.teamMode);
      console.log('[room_update] options=', data.options, 'teamModeVal=', teamModeVal, 'tmCb=', !!tmCb);
      if (tmCb) tmCb.checked = teamModeVal;
      if (tmLabel) {
        const canEdit = data.hostId === myId;
        tmLabel.style.pointerEvents = canEdit ? '' : 'none';
        tmLabel.style.cursor = canEdit ? 'pointer' : 'default';
        tmLabel.style.opacity = canEdit ? '' : '0.75';
      }
      document.getElementById('lobby-options').style.display = 'block';
      if (data.hostId === myId) {
        document.getElementById('budget-card').style.display = 'block';
        document.getElementById('host-actions').style.display = 'block';
        updateAIGeneralSelect(data.takenGenerals);
        updateAIFlagSelect(data.players.map(p => p.flag).filter(Boolean));
        renderBotList(data.players);
        // Activer "Lancer" seulement si tous les non-bots sont prêts
        const allReady = data.players.filter(p => !p.isBot).every(p => p.isReady);
        const startBtn = document.getElementById('start-btn');
        if (startBtn) { startBtn.disabled = !allReady; startBtn.style.opacity = allReady ? '1' : '0.4'; }
      }
      break;
    }
    case 'phase_change': {
      if (data.budget !== undefined) budget = data.budget;
      if (data.phase === 'lobby') {
        show('screen-lobby');
        armyQuantities = {};
        break;
      }
      if (data.phase === 'army_building') {
        show('screen-army');
        const budgetInp = document.getElementById('army-budget-input');
        if (budgetInp) { budgetInp.value = budget; budgetInp.disabled = !isHost; }
        const btnBack = document.getElementById('btn-back-to-lobby');
        if (btnBack) btnBack.style.display = isHost ? 'inline-block' : 'none';
        renderArmyBuilder();
      }
      break;
    }
    case 'army_accepted': {
      const btn = document.getElementById('btn-submit-army');
      if (btn) { btn.textContent = '✓ Prêt'; btn.disabled = true; btn.style.opacity = '0.6'; }
      break;
    }
    case 'army_status': {
      const container = document.getElementById('army-nations-ready');
      if (container && data.players) {
        container.innerHTML = data.players.map(p => {
          const ready = p.armySubmitted;
          return `<div style="display:flex;align-items:center;gap:4px;background:${ready ? '#1a3a1a' : '#1a1008'};border:1px solid ${ready ? '#2a8c2a' : '#3a2408'};border-radius:4px;padding:3px 6px;font-size:0.78em">
            ${flagImg(p.flag, 16)}
            <span style="color:${ready ? '#7fff7f' : '#c87040'}">${ready ? '✓' : '…'}</span>
          </div>`;
        }).join('');
      }
      break;
    }
    case 'deployment_state':
      sessionStorage.setItem('deploymentState', JSON.stringify(data));
      sessionStorage.setItem('roomCode', roomCode);
      sessionStorage.setItem('myId', myId);
      sessionStorage.removeItem('lobbyPlayerId');
      sessionStorage.removeItem('lobbyRoomCode');
      window.location.href = '/game.html';
      break;
    case 'error':
      if (tryingRejoin) {
        tryingRejoin = false;
        sessionStorage.removeItem('lobbyPlayerId');
        sessionStorage.removeItem('lobbyRoomCode');
      } else {
        notify(data.message || data);
      }
      break;
    case 'player_disconnected':
      notify('Un joueur s\'est déconnecté.', 'info');
      break;
  }
}
