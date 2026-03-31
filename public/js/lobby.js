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
let selectedColor = '#4a90d9';

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

function initColorPicker() {
  const container = document.getElementById('player-color-picker');
  if (!container) return;
  container.innerHTML = PLAYER_COLORS.map(c => `
    <div class="color-swatch${c.hex === selectedColor ? ' active' : ''}"
      title="${c.name}"
      style="width:24px;height:24px;border-radius:50%;background:${c.hex};cursor:pointer;border:2px solid ${c.hex === selectedColor ? '#fff' : 'transparent'};transition:border 0.15s"
      onclick="pickColor('${c.hex}')"></div>
  `).join('');
}

function pickColor(hex) {
  selectedColor = hex;
  wsSend('set_player_color', { roomCode, color: hex });
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
  ['screen-home', 'screen-lobby', 'screen-army'].forEach(s => {
    document.getElementById(s).style.display = s === id ? 'block' : 'none';
  });
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
  const val = parseInt(document.getElementById('budget-input').value);
  if (isNaN(val) || val < 1000) return notify('Budget minimum : 1000 or');
  wsSend('set_budget', { roomCode, budget: val });
}

function selectGeneral(id) {
  selectedGeneral = id;
  wsSend('select_general', { roomCode, generalId: id });
}

function addAI() {
  const select = document.getElementById('ai-general-select');
  const generalId = select?.value || null;
  wsSend('add_ai', { roomCode, generalId });
}

function updateAIGeneralSelect(takenGenerals) {
  const select = document.getElementById('ai-general-select');
  if (!select) return;
  const available = GENERALS_DATA.filter(g => !takenGenerals.includes(g.id));
  select.innerHTML = available.map(g => `<option value="${g.id}">${g.name} (${g.kingdom})</option>`).join('');
}

function startGame() {
  wsSend('start_game', { roomCode });
}

function renderGenerals(takenList) {
  const grid = document.getElementById('generals-grid');
  grid.innerHTML = '';
  for (const g of GENERALS_DATA) {
    const taken = takenList.includes(g.id) && g.id !== selectedGeneral;
    const sel = g.id === selectedGeneral;
    const div = document.createElement('div');
    div.className = `general-card${taken ? ' taken' : ''}${sel ? ' selected' : ''}`;
    const imgEntry = GENERAL_IMAGE1_MAP[g.id];
    const imgHtml = imgEntry
      ? `<img src="/assets/unites/GENERAL IMAGE 1-1/${encodeURIComponent(imgEntry.file)}.${imgEntry.ext}" style="width:100%;aspect-ratio:1/1;object-fit:cover;object-position:top;border-radius:4px;margin-bottom:6px;display:block">`
      : '';
    div.innerHTML = `
      ${imgHtml}
      <div class="gen-name">${g.name}</div>
      <div class="gen-kingdom">${g.kingdom}</div>
      <div class="gen-stats">Force ${g.force} · Strat ${g.strategy} · Char ${g.charisma}</div>
      ${sel ? '<div style="color:#c8960c;font-size:0.8em;margin-top:4px">✓ Sélectionné</div>' : ''}
    `;
    if (!taken) div.onclick = () => selectGeneral(g.id);
    div.ondblclick = (e) => { e.stopPropagation(); showGeneralCard(g); };
    grid.appendChild(div);
  }
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

function renderPlayerList(players, hostId) {
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  for (const p of players) {
    const li = document.createElement('li');
    const genName = p.generalId ? GENERALS_DATA.find(g => g.id === p.generalId)?.name || p.generalId : '—';
    const color = p.color || '#4a90d9';
    if (p.id === myId) {
      // Color picker inline for current player
      const pickerHtml = PLAYER_COLORS.map(c => `
        <div class="color-swatch${c.hex === selectedColor ? ' active' : ''}"
          title="${c.name}"
          style="width:18px;height:18px;border-radius:50%;background:${c.hex};cursor:pointer;border:2px solid ${c.hex === selectedColor ? '#fff' : 'transparent'};flex-shrink:0"
          onclick="pickColor('${c.hex}')"></div>
      `).join('');
      li.innerHTML = `
        <span class="player-badge${p.id === hostId ? ' host' : ''}">${p.id === hostId ? 'Host' : 'Joueur'}</span>
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;flex:1">${pickerHtml}</div>
        <span>${p.name}</span>
        <span class="text-muted" style="font-size:0.85em">${genName}</span>
        <span class="ready-icon">${p.isReady ? '✅' : p.generalId ? '⚔️' : ''}</span>
      `;
    } else if (p.isBot) {
      li.innerHTML = `
        <span class="player-badge" style="background:#555">Bot</span>
        <div style="width:16px;height:16px;border-radius:50%;background:${color};flex-shrink:0;border:1px solid rgba(255,255,255,0.3)"></div>
        <span>${p.name}</span>
        <span class="text-muted" style="font-size:0.85em">${genName}</span>
        <span class="ready-icon">${p.isReady ? '✅' : p.generalId ? '⚔️' : ''}</span>
      `;
    } else {
      li.innerHTML = `
        <span class="player-badge${p.id === hostId ? ' host' : ''}">${p.id === hostId ? 'Host' : 'Joueur'}</span>
        <div style="width:16px;height:16px;border-radius:50%;background:${color};flex-shrink:0;border:1px solid rgba(255,255,255,0.3)"></div>
        <span>${p.name}</span>
        <span class="text-muted" style="font-size:0.85em">${genName}</span>
        <span class="ready-icon">${p.isReady ? '✅' : p.generalId ? '⚔️' : ''}</span>
      `;
    }
    list.appendChild(li);
  }
  document.getElementById('player-count').textContent = players.length;
}

// Army builder
function renderArmyBuilder() {
  const shop = document.getElementById('unit-shop');
  shop.innerHTML = '';
  armyQuantities = {};
  UNITS_DATA.forEach(u => { armyQuantities[u.id] = 0; });

  for (const u of UNITS_DATA) {
    const div = document.createElement('div');
    div.className = 'unit-card';
    const imgEntry = UNIT_IMAGE1_MAP[u.id];
    const imgHtml = imgEntry
      ? `<img src="/assets/unites/UNIT IMAGE 1-1/${encodeURIComponent(imgEntry.file)}.${imgEntry.ext}" style="width:100%;aspect-ratio:1/1;object-fit:cover;object-position:top;border-radius:4px;margin-bottom:6px;display:block">`
      : '';
    div.innerHTML = `
      ${imgHtml}
      <h4>${u.name}</h4>
      <div class="unit-category">${u.category}</div>
      <div class="unit-stats">
        Vitalité ${u.vitality} · Attaque ${u.attack} · Défense ${u.defense}<br>
        Puissance ${u.power} · Armure ${u.armor} · Vitesse ${u.speed}
        ${u.range > 1 ? `<br>Portée ${u.range} cases` : ''}
      </div>
      <div class="unit-cost">${u.cost} or/unité</div>
      <div class="unit-qty">
        <button onclick="changeQty('${u.id}', -1)" ondblclick="event.stopPropagation()">−</button>
        <span id="qty-${u.id}">0</span>
        <button onclick="changeQty('${u.id}', 1)" ondblclick="event.stopPropagation()">+</button>
      </div>
    `;
    div.ondblclick = (e) => { e.stopPropagation(); showUnitCardLobby(u); };
    shop.appendChild(div);
  }
  updateBudgetDisplay();
}

function changeQty(typeId, delta) {
  const unit = UNITS_DATA.find(u => u.id === typeId);
  const newQty = Math.max(0, armyQuantities[typeId] + delta);
  const spent = computeSpent();
  const cost = unit.cost;
  if (delta > 0 && spent + cost > budget) {
    return notify('Budget insuffisant !');
  }
  armyQuantities[typeId] = newQty;
  document.getElementById(`qty-${typeId}`).textContent = newQty;
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
  document.getElementById('army-budget').textContent = budget.toLocaleString();
  document.getElementById('army-spent').textContent = spent.toLocaleString();
  document.getElementById('army-remaining').textContent = (budget - spent).toLocaleString();
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
      document.getElementById('host-actions').style.display = 'flex';
      updateAIGeneralSelect([]);
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
      document.getElementById('current-budget').textContent = data.budget.toLocaleString();
      renderPlayerList(data.players, data.hostId);
      renderGenerals(data.takenGenerals);
      if (data.hostId === myId) {
        document.getElementById('budget-card').style.display = 'block';
        document.getElementById('host-actions').style.display = 'flex';
        updateAIGeneralSelect(data.takenGenerals);
      }
      const me = data.players.find(p => p.id === myId);
      if (me && me.generalId) selectedGeneral = me.generalId;
      break;
    }
    case 'phase_change': {
      if (data.budget !== undefined) budget = data.budget;
      if (data.phase === 'army_building') {
        show('screen-army');
        document.getElementById('army-budget').textContent = budget.toLocaleString();
        renderArmyBuilder();
      }
      break;
    }
    case 'army_accepted':
      notify('Armée confirmée ! En attente des autres joueurs...', 'success');
      break;
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
