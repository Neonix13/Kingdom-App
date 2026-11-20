// Tutorial coach: step-by-step overlay for the scripted tutorial battle (server: game/bots/tutorial.js).
// Starts when room_update says { tutorial: true }. Steps advance on real game events (window.gameEventHooks)
// and on the client state (window.gameBridge), so it works the same in the 2D and the 3D view: it never uses
// canvas coordinates, it highlights DOM elements, names hex coordinates and pings hexes (visible in both views).
// Hints for the 3D view: window 'tutorial_hint' CustomEvent { stepId, hexes: [{q, r}], unitIds } (also window.tutorialHint).
(function () {
  'use strict';
  const KEY = 'kb_tutorial:';
  let roomCode = null;
  let myId = null;
  let active = false;
  let progress = null; // { step, flags, tips, hidden, minimized }
  let box = null;
  let pollTimer = null;
  let shownTip = null;
  let lastCurrent = null;
  let renderedKey = '';
  let storyEl = null;

  for (const href of ['/css/ink-d.css', '/css/tutorial-d.css']) {
    if (document.querySelector(`link[href="${href}"]`)) continue;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.appendChild(l);
  }

  const bridge = () => window.gameBridge || {};
  const state = () => bridge().state || null;
  const mine = () => ((state() && state().myUnits) || []).filter(u => u.q != null);
  const myIds = () => new Set(mine().map(u => u.id));
  const unitOf = (type) => mine().find(u => u.typeId === type);
  const enemies = () => ((state() && state().units) || []).filter(u => !u.isMine);
  const flag = () => ((state() && state().objectives) || [])[0] || null;
  const at = (o) => (o ? `<b>(q ${o.q}, r ${o.r})</b>` : '');

  function save() {
    if (roomCode && progress) try { sessionStorage.setItem(KEY + roomCode, JSON.stringify(progress)); } catch (e) { /* quota */ }
  }

  function load(code) {
    try { return JSON.parse(sessionStorage.getItem(KEY + code)) || null; } catch (e) { return null; }
  }

  function setFlag(name) {
    if (!progress || progress.flags[name]) return;
    progress.flags[name] = true;
    save();
    schedule();
  }

  // ---------- steps ----------
  const STEPS = [
    {
      id: 'intro', title: 'Bienvenue, recrue !', next: true,
      text: () => `Vous commandez l'armée de <b>Ou Ki</b> : un général, des Soldats, des Archers et un Cavalier léger. En face, <b>Go Hou Mei</b> (IA) défend un gué.<br>Victoire : tenir le <b>drapeau</b> ${at(flag())} jusqu'à 6 points, ou abattre le général ennemi.`,
    },
    {
      id: 'select', title: 'Sélectionner une unité',
      text: () => `Cliquez sur vos <b>Soldats</b> ${at(unitOf('soldats'))}, sur la carte ou dans la liste des unités (à droite en 2D, à gauche en 3D).<br><span class="text-muted">Le bouton <b>Q,R</b> de la barre d'outils (bouton ≡ en 3D) affiche les coordonnées des cases.</span>`,
      highlight: ['#unit-list', '#tool-coords'], hexes: () => [unitOf('soldats')],
      done: (f) => f.selected,
    },
    {
      id: 'card', title: 'La fiche de l\'unité', next: true,
      text: () => 'La fiche (à droite en 2D, en bas à gauche en 3D) : vitalité, moral, attaque, défense, armure et <b>vitesse restante</b> de l\'unité. Double-cliquez sur une unité pour sa fiche complète.',
      highlight: ['#selected-unit-detail'],
    },
    {
      id: 'move', title: 'Se déplacer',
      text: () => `Les <b>cases vertes</b> montrent où l'unité peut aller ce tour ; survolez-en une pour voir le chemin. Chaque pas coûte le terrain quitté (route ⅓, plaine 1, forêt 2, +1 par niveau gravi).<br>Avancez vers le drapeau ${at(flag())} en cliquant une case verte.`,
      hexes: () => [flag()],
      done: (f) => f.moved,
    },
    {
      id: 'stance', title: 'Les postures',
      text: () => 'Marche (+1 vitesse), Combat, Charge, Percée, Défenses, Repos… Changer coûte <b>2 de vitesse</b> et vaut pour les tours suivants.<br>Sélectionnez une unité qui a encore de la vitesse (vos <b>Archers</b> par exemple) et choisissez une posture dans le panneau <b>POSTURE</b> (sous la fiche en 3D).',
      highlight: ['#stance-panel'], hexes: () => [unitOf('archer')],
      done: (f) => f.stance,
    },
    {
      id: 'flag', title: 'Prendre l\'objectif',
      text: () => `Le drapeau ${at(flag())} se capture en <b>terminant sa manche</b> avec une unité dessus ; il rapporte 1 point au début de chaque tour (6 = victoire).<br>Envoyez votre <b>Cavalier léger</b> ${at(unitOf('cavalier_leger'))} (vitesse 6) sur le drapeau.`,
      hexes: () => [flag(), unitOf('cavalier_leger')],
      done: (f) => f.onFlag || f.captured,
    },
    {
      id: 'forest', title: 'Se cacher en forêt', next: true,
      text: () => 'En <b>forêt</b> ou dans un bâtiment, une unité est invisible pour l\'ennemi, sauf s\'il lui est adjacent (ou un espion à 2 cases). Vos unités cachées sont marquées <b>« camouflées »</b>.<br>Méfiance : l\'ennemi aussi peut s\'y embusquer… Une unité qui attaque se révèle.',
      done: (f) => f.concealed,
    },
    {
      id: 'end', title: 'Finir son tour',
      text: () => 'Quand vos unités ont agi, cliquez sur <b>Fin du tour</b>. S\'il reste des actions possibles, une confirmation s\'affiche.',
      highlight: ['#btn-end-turn-center', '#btn-end-turn-global'],
      done: (f) => f.endedTurn,
    },
    {
      id: 'enemy', title: 'Le tour de l\'IA',
      text: () => 'Go Hou Mei joue. Si l\'une de vos unités est attaquée, vous choisirez sa réponse. Attendez votre manche…',
      done: (f) => f.myTurnAgain,
    },
    {
      id: 'attack', title: 'Attaquer',
      text: () => 'Sélectionnez une unité proche d\'un ennemi <b>visible</b>, cliquez <b>Attaquer</b> puis la cible (cases rouges). L\'attaque consomme toute la vitesse restante ; le défenseur choisit sa réponse. Une unité peut se déplacer puis attaquer.',
      highlight: ['#btn-attack'], hexes: () => enemies().slice(0, 1),
      done: (f) => f.attacked || f.ranged,
    },
    {
      id: 'ranged', title: 'Tir à distance',
      text: () => `Vos <b>Archers</b> ${at(unitOf('archer'))} tirent jusqu'à 3 cases (+1 par niveau de hauteur au-dessus de la cible) et la cible ne peut pas riposter. Faites-les tirer sur un ennemi visible.`,
      highlight: ['#btn-attack'], hexes: () => [unitOf('archer')],
      done: (f) => f.ranged,
    },
    {
      id: 'time', title: 'Initiative, heure et nuit', next: true,
      text: () => 'À chaque tour, l\'<b>initiative</b> (Stratégie du général + D20) est relancée : l\'ordre de jeu peut changer. L\'heure avance à chaque tour (en haut) ; la <b>nuit</b> tombe à 18 h : vision et vitesse réduites, attaques moins précises, et la posture <b>Repos</b> y régénère beaucoup.',
      highlight: ['#top-time'],
    },
    {
      id: 'win', title: 'À vous de vaincre !',
      text: () => {
        const g = enemies().find(u => u.isGeneral);
        const s = state();
        const pts = s && s.scores && myId ? (s.scores[myId] || 0) : 0;
        return `Tenez le drapeau jusqu'à <b>6 points</b> (vous en avez ${pts}) ou abattez <b>Go Hou Mei</b>${g ? ' ' + at(g) : ''}. Le général ennemi qui tombe élimine son armée.`;
      },
      highlight: ['#top-scores'], hexes: () => [enemies().find(u => u.isGeneral)],
      done: (f) => f.gameOver,
    },
    {
      id: 'outro', title: 'Bataille terminée', finish: true,
      text: () => (progress.flags.won
        ? '<span class="tuto-done">Victoire !</span> Vous connaissez les bases : déplacements, postures, combats, tirs, forêts, objectifs et nuit.'
        : 'La bataille est finie. Vous connaissez les bases : déplacements, postures, combats, tirs, forêts, objectifs et nuit.')
        + '<br>Lancez une partie <b>en solo</b> contre l\'IA (Recrue, Vétéran, Stratège) ou en ligne. Le panneau 📖 Règles reste disponible en jeu.',
    },
  ];

  // Contextual tips, shown once when the event happens (whatever the current step)
  const TIPS = {
    defense: { title: 'Vous êtes attaqué !', text: '<b>Rien</b> : aucun jet. <b>Contre-attaquer</b> : jet de défense ; s\'il réussit, vous rendez les coups. <b>Encaisser</b> : jet de défense ; s\'il réussit, dégâts et perte de moral divisés par deux. Contre un tir, seule la phalange peut encaisser.' },
    revealed: { title: 'Ennemi débusqué', text: 'Une piétaille ennemie était cachée dans la forêt : elle apparaît dès qu\'une de vos unités lui est adjacente (ou après qu\'elle a attaqué).' },
    ambush: { title: 'Embuscade !', text: 'Votre unité est tombée sur un ennemi caché : elle s\'arrête net et perd le reste de sa vitesse. L\'embusqué est révélé.' },
    captured: { title: 'Drapeau pris', text: 'Le drapeau est à vous : +1 point au début de chaque tour tant que l\'ennemi ne le reprend pas (en finissant sa manche dessus).' },
    night: { title: 'La nuit tombe', text: 'Vision divisée par deux, −1 de vitesse, attaques moins précises. En posture <b>Repos</b>, vos unités regagnent beaucoup de moral et de vitalité.' },
    fled: { title: 'Fuite', text: 'Une unité à 0 de moral fuit vers le bord de la carte. Votre général peut la <b>Motiver</b> (bouton Motiver) si elle est à portée de son charisme.' },
  };

  function currentStep() {
    while (progress.step < STEPS.length - 1) {
      const s = STEPS[progress.step];
      if (s.done && s.done(progress.flags)) { progress.step++; save(); continue; }
      break;
    }
    return STEPS[progress.step];
  }

  // ---------- story intro (manga pages, before the first step) ----------
  const STORY = [
    {
      kicker: 'Chine, IIIe siècle av. J.-C.', title: 'Les Royaumes combattants', kanji: '秦',
      img: '/assets/unites/GENERAL%20IMAGE%201-1/OU%20KI%201-1.jpg',
      text: 'Sept royaumes se disputent la Chine depuis des siècles. Le jeune roi de <b>Qin</b> rêve de les unifier, et ses généraux portent cette ambition sur les champs de bataille.',
      cap: '« La guerre, c\'est amusant ! »',
    },
    {
      kicker: 'Votre commandement', title: 'L\'armée de Ou Ki', kanji: '将',
      img: '/assets/unites/UNIT%20IMAGE%201-1/SOLDAT.jpg',
      text: 'Le grand général <b>Ou Ki</b> vous confie une petite armée : des <b>Soldats</b>, des <b>Archers</b> et un <b>Cavalier léger</b>. Chaque unité a ses forces, ses postures et sa vitesse.',
      cap: 'Un bon chef connaît chacun de ses hommes.',
    },
    {
      kicker: 'Votre mission', title: 'La bataille du gué', kanji: '戦',
      img: '/assets/unites/GENERAL%20IMAGE%201-1/GO%20HOU%20MEI%201-1.jpg',
      text: '<b>Go Hou Mei</b>, stratège de Wei, défend un gué près d\'un village. Tenez le <b>drapeau</b> jusqu\'à 6 points, ou abattez son général. Le guide vous accompagne pas à pas.',
      cap: 'Au combat !',
    },
  ];

  function showStory(done) {
    let page = 0;
    storyEl = document.createElement('div');
    storyEl.id = 'tuto-story';
    storyEl.setAttribute('role', 'dialog');
    storyEl.setAttribute('aria-label', 'Introduction du tutoriel');
    document.body.appendChild(storyEl);
    const close = () => {
      window.removeEventListener('keydown', onKey, true);
      if (storyEl) { storyEl.remove(); storyEl = null; }
      done();
    };
    const go = (i) => {
      if (i >= STORY.length) return close();
      page = i;
      const st = STORY[i];
      const last = i === STORY.length - 1;
      storyEl.innerHTML = `<div class="ts-speed"></div>
        <div class="ts-page">
          <div class="ts-art"><img src="${st.img}" alt=""><span class="ts-kanji">${st.kanji}</span></div>
          <div class="ts-text">
            <span class="ts-kicker">${st.kicker}</span>
            <h2>${st.title}</h2>
            <svg class="ts-stroke" viewBox="0 0 180 10" aria-hidden="true"><path d="M2 6 C 40 2, 90 9, 130 4 S 172 6, 178 3" stroke="#D8352A" stroke-width="4" fill="none" stroke-linecap="round"/></svg>
            <p>${st.text}</p>
            <div class="ts-cap">${st.cap}</div>
            <div class="ts-foot">
              <div class="ts-dots">${STORY.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>
              <button type="button" class="ts-skip">Passer</button>
              <button type="button" class="ts-next">${last ? 'Au combat !' : 'Suite'}</button>
            </div>
          </div>
        </div>`;
      storyEl.querySelector('.ts-skip').onclick = close;
      storyEl.querySelector('.ts-next').onclick = () => go(page + 1);
      storyEl.querySelector('.ts-next').focus();
    };
    const onKey = (e) => {
      if (!storyEl) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
      else if (e.key === 'Enter' || e.code === 'Space' || e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); go(page + 1); }
      else if (e.key === 'ArrowLeft' && page > 0) { e.preventDefault(); e.stopImmediatePropagation(); go(page - 1); }
      else e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    go(0);
  }

  // ---------- rendering ----------
  function clearHighlights() {
    document.querySelectorAll('.tuto-highlight').forEach(el => el.classList.remove('tuto-highlight'));
  }

  function ensureBox() {
    if (box) return box;
    box = document.createElement('div');
    box.id = 'tuto-coach';
    box.innerHTML = '<div class="tuto-head"><span class="tuto-badge">TUTORIEL</span><span class="tuto-count"></span><button class="tuto-min" title="Réduire / agrandir">–</button></div>'
      + '<div class="tuto-body"><div class="tuto-title"></div><div class="tuto-text"></div><div class="tuto-goal"></div>'
      + '<div class="tuto-actions"><button class="tuto-skip">Passer le tutoriel</button><button class="tuto-next">Suivant</button></div></div>';
    document.body.appendChild(box);
    box.querySelector('.tuto-min').onclick = (e) => { e.stopPropagation(); progress.minimized = !progress.minimized; save(); render(true); };
    box.addEventListener('click', () => { if (progress.minimized) { progress.minimized = false; save(); render(true); } });
    box.querySelector('.tuto-skip').onclick = (e) => {
      e.stopPropagation();
      if (!window.confirm('Quitter le guide ? La bataille continue sans les conseils.')) return;
      progress.hidden = true;
      save();
      stop();
    };
    box.querySelector('.tuto-next').onclick = (e) => {
      e.stopPropagation();
      if (shownTip) { progress.tips[shownTip] = 'seen'; shownTip = null; save(); render(true); return; }
      const s = STEPS[progress.step];
      if (s.finish) { if (typeof window.leaveGame === 'function') window.leaveGame(); else window.location.href = '/'; return; }
      progress.step = Math.min(STEPS.length - 1, progress.step + 1);
      save();
      render(true);
    };
    return box;
  }

  function hint(step) {
    const hexes = (step.hexes ? step.hexes() : []).filter(Boolean).map(h => ({ q: h.q, r: h.r }));
    const detail = { stepId: step.id, hexes, unitIds: (step.hexes ? step.hexes() : []).filter(h => h && h.id).map(h => h.id) };
    window.tutorialHint = detail;
    try { window.dispatchEvent(new CustomEvent('tutorial_hint', { detail })); } catch (e) { /* old browsers */ }
    return hexes;
  }

  // Ping the hexes of a step once (pings are drawn by both the 2D and the 3D view)
  function pingStep(step, hexes) {
    if (!hexes.length || progress.pinged[step.id] || typeof KBNet === 'undefined') return;
    const s = state();
    if (!s || s.phase !== 'battle') return;
    progress.pinged[step.id] = true;
    save();
    hexes.slice(0, 2).forEach((h, i) => setTimeout(() => KBNet.send('ping', { q: h.q, r: h.r }), 400 + i * 700));
  }

  function render(force) {
    if (!active || !progress || progress.hidden || storyEl) return;
    const el = ensureBox();
    const tipId = Object.keys(progress.tips).find(k => progress.tips[k] === 'pending');
    if (tipId && !shownTip) shownTip = tipId;
    if (progress.tips.defense === 'pending') shownTip = 'defense'; // the defense dialog is on screen now
    const step = currentStep();
    // A modal dialog is open (defense, stance, end of turn...): slide to a narrow column on the left
    const modal = [...document.querySelectorAll('.overlay')].some(o => o.style.display && o.style.display !== 'none');
    el.classList.toggle('tuto-side', modal);
    const key = `${progress.step}|${shownTip}|${progress.minimized}|${step.text()}`;
    if (!force && key === renderedKey) return;
    renderedKey = key;
    el.classList.toggle('minimized', !!progress.minimized);
    el.querySelector('.tuto-count').textContent = `${progress.step + 1} / ${STEPS.length}`;
    clearHighlights();
    if (shownTip) {
      const tip = TIPS[shownTip];
      el.querySelector('.tuto-title').textContent = tip.title;
      el.querySelector('.tuto-text').innerHTML = `<div class="tuto-tip">${tip.text}</div>`;
      el.querySelector('.tuto-goal').textContent = '';
      el.querySelector('.tuto-next').textContent = 'Compris';
      el.querySelector('.tuto-next').style.display = '';
      return;
    }
    el.querySelector('.tuto-title').textContent = step.title;
    el.querySelector('.tuto-text').innerHTML = step.text();
    el.querySelector('.tuto-goal').textContent = step.done && !step.next ? 'À faire : l\'étape se valide toute seule.' : '';
    const next = el.querySelector('.tuto-next');
    next.style.display = step.next || step.finish ? '' : 'none';
    next.textContent = step.finish ? 'Retour au menu' : 'Suivant';
    el.querySelector('.tuto-skip').style.display = step.finish ? 'none' : '';
    if (!progress.minimized) for (const sel of step.highlight || []) document.querySelectorAll(sel).forEach(n => n.classList.add('tuto-highlight'));
    pingStep(step, hint(step));
  }

  let renderTimer = null;
  function schedule() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => { observe(); render(false); }, 0);
  }

  function tip(id) {
    if (!progress || progress.tips[id]) return;
    progress.tips[id] = 'pending';
    save();
    schedule();
  }

  // Flags read from the client state (after game.js applied the event)
  function observe() {
    if (!active || !progress) return;
    const b = bridge();
    const s = state();
    if (b.selectedUnit && myIds().has(b.selectedUnit.id)) setFlag('selected');
    const card = document.getElementById('overlay-unit-card');
    if (card && card.style.display !== 'none' && STEPS[progress.step].id === 'card') { progress.step++; save(); }
    if (!s) return;
    if (mine().some(u => !u.isGeneral && progress.stances[u.id] && u.stance !== progress.stances[u.id])) setFlag('stance');
    const f = flag();
    if (f && mine().some(u => u.q === f.q && u.r === f.r)) setFlag('onFlag');
    if (f && f.owner === myId) setFlag('captured');
    if (mine().some(u => u.concealed)) setFlag('concealed');
    if (enemies().some(u => u.typeId === 'pietaille')) tip('revealed');
    if (s.isNight) tip('night');
  }

  // ---------- events ----------
  function onEvent(event, data) {
    if (event === 'session') { myId = data.playerId; roomCode = data.roomCode; return; }
    if (event === 'room_update') {
      if (data.tutorial && !active) start(data.roomCode || roomCode);
      return;
    }
    if (!active || !progress) return;
    const ids = myIds();
    switch (event) {
      case 'unit_move_anim':
        if (ids.has(data.unitId)) setFlag('moved');
        break;
      case 'turn_change':
        if (lastCurrent === myId && data.currentPlayerId !== myId) setFlag('endedTurn');
        if (data.currentPlayerId === myId && progress.flags.endedTurn) setFlag('myTurnAgain');
        lastCurrent = data.currentPlayerId;
        break;
      case 'game_state':
        if (lastCurrent == null) lastCurrent = data.currentPlayerId;
        if (data.myUnits && !Object.keys(progress.stances).length) {
          for (const u of data.myUnits) if (!u.isGeneral) progress.stances[u.id] = u.stance;
          save();
        }
        break;
      case 'combat_result': {
        const log = data.combatLog || data;
        if (log.abilityUsed) break;
        if (ids.has(log.attackerId)) setFlag(log.ranged ? 'ranged' : 'attacked');
        break;
      }
      case 'defense_request': tip('defense'); break;
      case 'ambush': if (data.playerId === myId) tip('ambush'); break;
      case 'objective_captured': if (data.owner === myId) { setFlag('captured'); tip('captured'); } break;
      case 'time_change': if (data.isNight) tip('night'); break;
      case 'units_fled': tip('fled'); break;
      case 'game_over':
        progress.flags.won = data.winnerId === myId;
        for (const k of Object.keys(progress.tips)) progress.tips[k] = 'seen';
        shownTip = null;
        setFlag('gameOver');
        progress.step = STEPS.length - 1;
        save();
        break;
      default: break;
    }
    schedule();
  }

  function start(code) {
    roomCode = code || roomCode;
    if (!roomCode) return;
    progress = load(roomCode) || { step: 0, flags: {}, tips: {}, stances: {}, pinged: {}, hidden: false, minimized: false };
    progress.pinged = progress.pinged || {};
    progress.stances = progress.stances || {};
    active = true;
    if (progress.hidden) return;
    const s = state();
    if (s && s.myUnits && !Object.keys(progress.stances).length) {
      for (const u of s.myUnits) if (!u.isGeneral) progress.stances[u.id] = u.stance;
    }
    save();
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { observe(); render(false); }, 400);
    if (!progress.storySeen && progress.step === 0 && !storyEl) {
      showStory(() => { progress.storySeen = true; save(); render(true); });
      return;
    }
    render(true);
  }

  function stop() {
    active = false;
    clearInterval(pollTimer);
    clearHighlights();
    if (box) { box.remove(); box = null; }
    if (storyEl) { storyEl.remove(); storyEl = null; }
  }

  window.gameEventHooks = window.gameEventHooks || [];
  window.gameEventHooks.push(onEvent);
  window.KBTutorial = { get active() { return active; }, get step() { return progress && STEPS[progress.step].id; }, steps: STEPS.map(s => s.id), stop };
})();
