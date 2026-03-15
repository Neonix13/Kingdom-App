const socket = io();
let myId = null;
let roomCode = null;
let isHost = false;
let selectedGeneral = null;
let armyQuantities = {};
let budget = 15000;

const GENERALS_DATA = [
  { id: 'ou_ki', name: 'Ou Ki', kingdom: 'QIN', force: 15, strategy: 16, charisma: 18 },
  { id: 'mou_bu', name: 'Mou Bu', kingdom: 'QIN', force: 18, strategy: 12, charisma: 15 },
  { id: 'ou_sen', name: 'Ou Sen', kingdom: 'QIN', force: 13, strategy: 17, charisma: 14 },
  { id: 'kan_ki', name: 'Kan Ki', kingdom: 'QIN', force: 14, strategy: 16, charisma: 16 },
  { id: 'ri_boku', name: 'Ri Boku', kingdom: 'ZHAO', force: 11, strategy: 18, charisma: 15 },
  { id: 'kei_sha', name: 'Kei Sha', kingdom: 'ZHAO', force: 13, strategy: 16, charisma: 13 },
  { id: 'shi_ba_shou', name: 'Shi Ba Shou', kingdom: 'ZHAO', force: 17, strategy: 15, charisma: 18 },
  { id: 'ren_pa', name: 'Ren Pa', kingdom: 'ZHAO/WEI', force: 17, strategy: 16, charisma: 17 },
  { id: 'go_kei', name: 'Go Kei', kingdom: 'WEI', force: 14, strategy: 17, charisma: 15 },
  { id: 'go_hou_mei', name: 'Go Hou Mei', kingdom: 'WEI', force: 10, strategy: 18, charisma: 15 },
  { id: 'gai_mou', name: 'Gai Mou', kingdom: 'WEI', force: 18, strategy: 12, charisma: 15 },
];

const UNITS_DATA = [
  { id: 'pietaille', name: 'Piétaille', category: 'Infanterie', cost: 400, vitality: 18, attack: 10, power: 8, defense: 10, armor: 2, speed: 3 },
  { id: 'soldats', name: 'Soldats', category: 'Infanterie', cost: 600, vitality: 14, attack: 14, power: 12, defense: 10, armor: 4, speed: 2 },
  { id: 'phalange', name: 'Phalange', category: 'Infanterie', cost: 700, vitality: 14, attack: 12, power: 8, defense: 15, armor: 6, speed: 3 },
  { id: 'lancier', name: 'Lancier', category: 'Infanterie', cost: 700, vitality: 14, attack: 10, power: 10, defense: 8, armor: 3, speed: 3 },
  { id: 'espion', name: 'Espion', category: 'Infanterie', cost: 600, vitality: 8, attack: 12, power: 8, defense: 10, armor: 2, speed: 4 },
  { id: 'assassin', name: 'Assassin', category: 'Infanterie', cost: 800, vitality: 10, attack: 16, power: 10, defense: 10, armor: 2, speed: 4 },
  { id: 'cavalier_leger', name: 'Cavalier Léger', category: 'Chevaux', cost: 900, vitality: 10, attack: 14, power: 10, defense: 7, armor: 2, speed: 6 },
  { id: 'cavalier_lourd', name: 'Cavalier Lourd', category: 'Chevaux', cost: 1200, vitality: 8, attack: 16, power: 12, defense: 8, armor: 4, speed: 5 },
  { id: 'archer', name: 'Archer', category: 'Tireurs', cost: 600, vitality: 14, attack: 10, power: 8, defense: 5, armor: 2, speed: 3, range: 3 },
  { id: 'archer_elite', name: "Archer d'Élite", category: 'Tireurs', cost: 900, vitality: 12, attack: 12, power: 10, defense: 6, armor: 2, speed: 3, range: 5 },
  { id: 'batisseurs', name: 'Bâtisseurs', category: 'Chars', cost: 1000, vitality: 10, attack: 8, power: 8, defense: 8, armor: 4, speed: 2 },
  { id: 'char', name: 'Char', category: 'Chars', cost: 1600, vitality: 8, attack: 16, power: 14, defense: 8, armor: 6, speed: 5 },
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
  socket.emit('create_room', { playerName: name });
}

function joinRoom() {
  const name = document.getElementById('join-name').value.trim();
  const code = document.getElementById('join-code').value.trim().toUpperCase();
  if (!name) return notify('Entrez votre nom.');
  if (code.length < 4) return notify('Entrez le code de la salle.');
  socket.emit('join_room', { roomCode: code, playerName: name });
}

function setBudget() {
  const val = parseInt(document.getElementById('budget-input').value);
  if (isNaN(val) || val < 1000) return notify('Budget minimum : 1000 or');
  socket.emit('set_budget', { roomCode, budget: val });
}

function selectGeneral(id) {
  selectedGeneral = id;
  socket.emit('select_general', { roomCode, generalId: id });
}

function startGame() {
  socket.emit('start_game', { roomCode });
}

function renderGenerals(takenList) {
  const grid = document.getElementById('generals-grid');
  grid.innerHTML = '';
  for (const g of GENERALS_DATA) {
    const taken = takenList.includes(g.id) && g.id !== selectedGeneral;
    const sel = g.id === selectedGeneral;
    const div = document.createElement('div');
    div.className = `general-card${taken ? ' taken' : ''}${sel ? ' selected' : ''}`;
    div.innerHTML = `
      <div class="gen-name">${g.name}</div>
      <div class="gen-kingdom">${g.kingdom}</div>
      <div class="gen-stats">Force ${g.force} · Strat ${g.strategy} · Char ${g.charisma}</div>
      ${sel ? '<div style="color:#c8960c;font-size:0.8em;margin-top:4px">✓ Sélectionné</div>' : ''}
    `;
    if (!taken) div.onclick = () => selectGeneral(g.id);
    grid.appendChild(div);
  }
}

function renderPlayerList(players, hostId) {
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  for (const p of players) {
    const li = document.createElement('li');
    const genName = p.generalId ? GENERALS_DATA.find(g => g.id === p.generalId)?.name || p.generalId : '—';
    li.innerHTML = `
      <span class="player-badge${p.id === hostId ? ' host' : ''}">${p.id === hostId ? 'Host' : 'Joueur'}</span>
      <span>${p.name}</span>
      <span class="text-muted" style="font-size:0.85em">${genName}</span>
      <span class="ready-icon">${p.generalId ? '⚔️' : ''}</span>
    `;
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
    div.innerHTML = `
      <h4>${u.name}</h4>
      <div class="unit-category">${u.category}</div>
      <div class="unit-stats">
        Vitalité ${u.vitality} · Attaque ${u.attack} · Défense ${u.defense}<br>
        Puissance ${u.power} · Armure ${u.armor} · Vitesse ${u.speed}
        ${u.range > 1 ? `<br>Portée ${u.range} cases` : ''}
      </div>
      <div class="unit-cost">${u.cost} or/unité</div>
      <div class="unit-qty">
        <button onclick="changeQty('${u.id}', -1)">−</button>
        <span id="qty-${u.id}">0</span>
        <button onclick="changeQty('${u.id}', 1)">+</button>
      </div>
    `;
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
  socket.emit('submit_army', { roomCode, units });
}

// Socket events
socket.on('room_created', ({ roomCode: code, playerId }) => {
  myId = playerId;
  roomCode = code;
  isHost = true;
  document.getElementById('room-code-display').textContent = code;
  document.getElementById('budget-card').style.display = 'block';
  document.getElementById('start-btn').style.display = 'block';
  show('screen-lobby');
});

socket.on('room_joined', ({ roomCode: code, playerId }) => {
  myId = playerId;
  roomCode = code;
  document.getElementById('room-code-display').textContent = code;
  show('screen-lobby');
});

socket.on('room_update', (state) => {
  budget = state.budget;
  document.getElementById('current-budget').textContent = state.budget.toLocaleString();
  renderPlayerList(state.players, state.hostId);
  renderGenerals(state.takenGenerals);
  // Show start button only for host
  if (state.hostId === myId) {
    document.getElementById('budget-card').style.display = 'block';
    document.getElementById('start-btn').style.display = 'block';
  }
  // Sync my general
  const me = state.players.find(p => p.id === myId);
  if (me && me.generalId) selectedGeneral = me.generalId;
});

socket.on('phase_change', ({ phase, budget: b }) => {
  if (b !== undefined) budget = b;
  if (phase === 'army_building') {
    show('screen-army');
    document.getElementById('army-budget').textContent = budget.toLocaleString();
    renderArmyBuilder();
  }
});

socket.on('army_accepted', () => {
  notify('Armée confirmée ! En attente des autres joueurs...', 'success');
});

socket.on('deployment_state', (state) => {
  // Redirect to game page with state
  sessionStorage.setItem('deploymentState', JSON.stringify(state));
  sessionStorage.setItem('roomCode', roomCode);
  sessionStorage.setItem('myId', myId);
  window.location.href = '/game.html';
});

socket.on('error', (msg) => notify(msg));

socket.on('player_disconnected', ({ playerId }) => {
  notify('Un joueur s\'est déconnecté.', 'info');
});
