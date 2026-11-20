// 2D view: the camera follows the action like the 3D one (public/js/map3d/cameraDirector.js), in a simpler way:
// what happens within a short window is gathered and framed at once (gameBridge.frameHexes2D), at most every
// DWELL ms, and never while the player is moving the map.
(function () {
  const BATCH = 90, DWELL = 1600, USER_PAUSE = 7000;
  let batch = [], timer = null, lastMove = 0, pauseUntil = 0, queued = null, queueTimer = null;

  const enabled = () => {
    try { return JSON.parse(localStorage.getItem('kb_view3d_settings') || '{}').followPlayback !== false; } catch (e) { return true; }
  };
  const active2D = () => !(window.view3d && window.view3d.active) && window.gameBridge && window.gameBridge.frameHexes2D;
  const userInput = () => { pauseUntil = performance.now() + USER_PAUSE; queued = null; };
  window.addEventListener('DOMContentLoaded', () => {
    const c = document.getElementById('game-canvas');
    if (!c) return;
    c.addEventListener('mousedown', userInput);
    c.addEventListener('touchstart', userInput, { passive: true });
    c.addEventListener('wheel', userInput, { passive: true });
  });

  function frame(hexes, force) {
    const now = performance.now();
    if (!hexes.length || !active2D() || !enabled() || now < pauseUntil) return;
    if (!force && now - lastMove < DWELL) {
      queued = (queued || []).concat(hexes);
      clearTimeout(queueTimer);
      queueTimer = setTimeout(() => { const q = queued; queued = null; if (q) frame(q, false); }, DWELL - (now - lastMove) + 30);
      return;
    }
    if (window.gameBridge.frameHexes2D(hexes)) lastMove = now;
  }
  function observe(hexes) {
    batch.push(...hexes);
    clearTimeout(timer);
    timer = setTimeout(() => { const b = batch; batch = []; frame(b, false); }, BATCH);
  }
  function unitHex(id) {
    const st = window.gameBridge && window.gameBridge.state;
    const u = id && st && st.units ? st.units.find((x) => x.id === id) : null;
    return u && u.q != null ? { q: u.q, r: u.r } : null;
  }

  function onEvent(event, data) {
    if (!data) return;
    if (event === 'playback_start' && data.hexes) frame(data.hexes.map(([q, r]) => ({ q, r })), true);
    else if (event === 'unit_move_anim' && data.path && data.path.length) {
      const end = data.path[data.path.length - 1];
      observe([{ q: data.fromQ, r: data.fromR }, { q: end[0], r: end[1] }]);
    } else if (event === 'combat_result') {
      const log = data.combatLog || data;
      observe([unitHex(log.attackerId), unitHex(log.targetId)].filter(Boolean));
    } else if (event === 'ambush' && data.q != null) observe([{ q: data.q, r: data.r }]);
  }
  (window.gameEventHooks = window.gameEventHooks || []).push(onEvent);
})();
