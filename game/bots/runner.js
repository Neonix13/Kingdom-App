// Drives the bots of each room. After every room transaction the protocol calls kick(roomCode): the runner
// plans the next bot message from the stored room, waits its delay, then sends it through the regular
// protocol handler (call). Local server: the delay is a scheduler timer (one action at a time, so humans can
// follow). Lambda / no scheduler: no waiting, a bounded burst of actions per incoming message or tick.
// Any rejected action falls back to something that cannot block the game (end the turn, answer "rien").
function createBotRunner({ store, scheduler = null, now = Date.now, cfg = {}, call, reschedule = () => {}, log = console, planStep, stepDelay }) {
  const running = new Set();
  const wake = new Map();    // roomCode -> earliest time of the next bot action
  const turns = new Map();   // roomCode -> { key, steps } (actions of the current bot manche)
  const failures = new Map(); // roomCode -> { key, count } consecutive failures in the same situation
  const stats = { steps: 0, failures: 0, fallbacks: 0, errors: [] };
  const maxSteps = cfg.botMaxSteps || 150;
  const burst = cfg.botBurst || 400;

  const situation = (room) => `${room.phase}|${room.turn}|${room.manche}|${Object.keys(room.pendingAttacks || {}).length}`;

  function wakeAt(code) {
    return wake.has(code) ? wake.get(code) : null;
  }

  async function send(s, action, data) {
    await call(s.connId, action, { roomCode: s.data.roomCode, ...data });
  }

  async function fallback(room, s) {
    try {
      if (s.kind === 'defense') await send(s, 'defend_choice', { attackId: s.data.attackId, choice: 'rien' });
      else if (s.kind === 'battle' && s.action !== 'end_turn') await send(s, 'end_turn', {});
      else if (s.action === 'place_unit') await send(s, 'deployment_ready', {});
      else if (s.action === 'set_orders') await send(s, 'set_orders', { orders: {}, replace: true });
      else if (s.action === 'submit_army') await send(s, 'submit_army', { units: [{ typeId: 'pietaille', count: 1 }] });
      else return;
      stats.fallbacks++;
    } catch (e) { /* nothing else to try: the failure counter stops the loop */ }
  }

  async function execute(room, s) {
    try {
      await call(s.connId, s.action, s.data);
      stats.steps++;
      failures.delete(room.roomCode);
      return true;
    } catch (e) {
      stats.failures++;
      if (stats.errors.length < 20) stats.errors.push({ action: s.action, why: s.why, code: e && e.code, message: e && e.message });
      if (!(e && e.code)) log.error('[bots]', s.action, e && (e.stack || e.message));
      const key = situation(room);
      const f = failures.get(room.roomCode);
      const count = f && f.key === key ? f.count + 1 : 1;
      failures.set(room.roomCode, { key, count });
      await fallback(room, s);
      return false;
    }
  }

  async function kick(code) {
    if (running.has(code)) return;
    running.add(code);
    try {
      for (let i = 0; i < burst; i++) {
        const room = await store.get(code);
        if (!room) { wake.delete(code); return; }
        const f = failures.get(code);
        if (f && f.count >= 4 && f.key === situation(room)) { wake.delete(code); return; }
        let s = planStep(room);
        if (!s) { wake.delete(code); return; }
        let extra = 0;
        if (s.kind === 'battle') {
          const key = `${room.turn}|${room.manche}|${s.playerId}`;
          const t = turns.get(code);
          if (!t || t.key !== key) { turns.set(code, { key, steps: 0 }); extra = 900; }
          const cur = turns.get(code);
          if (++cur.steps > maxSteps && s.action !== 'end_turn') s = { ...s, action: 'end_turn', data: { roomCode: code }, why: 'step_cap' };
        }
        if (scheduler) {
          const t = now();
          const at = wake.get(code);
          if (at == null) {
            const d = stepDelay(room, s, cfg) + extra * (cfg.botPace == null ? 1 : cfg.botPace);
            if (d > 0) {
              if (s.kind === 'battle') turns.get(code).steps--;
              wake.set(code, t + d);
              reschedule(code, room);
              return;
            }
          } else if (at > t) {
            if (s.kind === 'battle') turns.get(code).steps--;
            return;
          }
          wake.delete(code);
        }
        await execute(room, s);
      }
    } catch (e) {
      log.error('[bots] kick:', e && (e.stack || e.message));
    } finally {
      running.delete(code);
    }
  }

  function forget(code) {
    wake.delete(code);
    turns.delete(code);
    failures.delete(code);
  }

  return { kick, wakeAt, forget, stats };
}

module.exports = { createBotRunner };
