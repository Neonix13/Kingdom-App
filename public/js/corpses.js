// Fallen soldiers left on the battlefield for the rest of the game: where a unit was destroyed (a whole heap,
// with its banner) and a few bodies where a unit took heavy losses. Kept per room in localStorage so a reload
// keeps them; drawn in 2D here (draw2D) and in 3D by public/js/map3d/corpses3d.js (onChange).
(function () {
  const MAX = 400;
  let list = [];
  let room = null;
  const seen = new Set();
  const listeners = [];
  const key = () => 'kb_corpses_' + room;

  function save() { if (room) try { localStorage.setItem(key(), JSON.stringify(list)); } catch (e) { } }
  function changed() { save(); for (const f of listeners) { try { f(list); } catch (e) { console.warn(e); } } }
  function load(code) {
    if (!code || code === room) return;
    room = code;
    try { list = JSON.parse(localStorage.getItem(key()) || '[]') || []; } catch (e) { list = []; }
    seen.clear();
    changed();
  }
  function clear() { list = []; seen.clear(); changed(); }

  const kindOf = (u) => u.isGeneral ? 'general' : u.typeId === 'char' ? 'chariot' : /^cavalier/.test(u.typeId || '') ? 'horse' : 'foot';
  const seedOf = () => Math.floor(Math.random() * 1e9);

  function add(rec, delayMs = 0) {
    if (!room && window.gameBridge && window.gameBridge.roomCode) load(window.gameBridge.roomCode);
    const go = () => {
      list.push({ ...rec, seed: rec.seed ?? seedOf() });
      if (list.length > MAX) list.splice(0, list.length - MAX);
      changed();
    };
    if (delayMs > 0) setTimeout(go, delayMs); else go();
  }

  function unitById(id) {
    const st = window.gameBridge && window.gameBridge.state;
    return id && st && st.units ? st.units.find((u) => u.id === id) : null;
  }
  function colorOf(u) {
    try { return window.gameBridge.getPlayerColor(u.playerId); } catch (e) { return '#888888'; }
  }

  function onCombat(log, data) {
    if (!log || log.abilityUsed) return;
    const sig = [log.attackerId, log.targetId, log.dmgReceived, log.counterDmgReceived, log.targetVitalityLeft, log.attackerVitalityLeft, data && data.playback ? 'p' : 's'].join('|');
    if (seen.has(sig)) return;
    seen.add(sig);
    const delay = data && data.playback ? 900 : 1300;
    for (const [id, killed, dmg] of [[log.targetId, log.targetKilled, log.dmgReceived], [log.attackerId, log.attackerKilled, log.counterDmgReceived]]) {
      const u = unitById(id);
      if (!u || u.q == null) continue;
      const kind = kindOf(u);
      const color = colorOf(u);
      if (killed) add({ q: u.q, r: u.r, kind, color, n: kind === 'foot' ? 9 : kind === 'horse' ? 4 : kind === 'chariot' ? 2 : 1, banner: true }, delay);
      else if (dmg > 0) {
        const max = u.maxVitality || u.vitality || 100;
        const n = Math.min(3, Math.round((10 * dmg) / max));
        if (n > 0) add({ q: u.q, r: u.r, kind: kind === 'general' ? 'foot' : kind, color, n, banner: false }, delay);
      }
    }
  }

  function onEvent(event, data) {
    if (event === 'session' && data && data.roomCode) load(data.roomCode);
    else if (event === 'deployment_state') { if (list.length) clear(); }
    else if (event === 'combat_result') onCombat(data.combatLog || data, data);
  }
  (window.gameEventHooks = window.gameEventHooks || []).push(onEvent);

  // 2D: small dark strokes for the bodies, a pole with a coloured cloth for a fallen banner
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function draw2D(ctx, hexToPixel, hexSize, visible) {
    if (!list.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const c of list) {
      const { x, y } = hexToPixel(c.q, c.r);
      const rnd = rng(c.seed);
      const body = hexSize * 0.16;
      ctx.lineWidth = Math.max(1, hexSize * 0.045);
      for (let i = 0; i < c.n; i++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * hexSize * 0.62, h = rnd() * Math.PI * 2;
        const bx = x + Math.cos(a) * d, by = y + Math.sin(a) * d;
        ctx.strokeStyle = 'rgba(28,22,18,0.75)';
        ctx.beginPath();
        ctx.moveTo(bx - Math.cos(h) * body, by - Math.sin(h) * body);
        ctx.lineTo(bx + Math.cos(h) * body, by + Math.sin(h) * body);
        ctx.stroke();
        ctx.fillStyle = c.color;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(bx + Math.cos(h) * body * 0.2, by + Math.sin(h) * body * 0.2, ctx.lineWidth * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (c.banner) {
        const a = rnd() * Math.PI * 2;
        const bx = x + Math.cos(a) * hexSize * 0.25, by = y + Math.sin(a) * hexSize * 0.25;
        ctx.strokeStyle = 'rgba(60,40,24,0.9)';
        ctx.lineWidth = Math.max(1, hexSize * 0.03);
        ctx.beginPath(); ctx.moveTo(bx - hexSize * 0.3, by + hexSize * 0.08); ctx.lineTo(bx + hexSize * 0.22, by - hexSize * 0.05); ctx.stroke();
        ctx.fillStyle = c.color;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.moveTo(bx + hexSize * 0.22, by - hexSize * 0.05);
        ctx.lineTo(bx + hexSize * 0.04, by - hexSize * 0.0);
        ctx.lineTo(bx + hexSize * 0.08, by + hexSize * 0.14);
        ctx.lineTo(bx + hexSize * 0.25, by + hexSize * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  window.KBCorpses = {
    get list() { return list; },
    onChange(f) { listeners.push(f); try { f(list); } catch (e) { console.warn(e); } },
    load, clear, add, draw2D,
  };
})();
