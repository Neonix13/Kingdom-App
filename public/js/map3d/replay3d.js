import { createWorld } from './world.js';
import { createGameUI } from './gameUI.js';

const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const facingBetween = (q1, r1, q2, r2) => {
  const i = HEX_DIRS.findIndex(([a, b]) => a === q2 - q1 && b === r2 - r1);
  return i < 0 ? null : i;
};

// Rebuilds the battle state at any event index from the nearest keyframe (format kb-replay-1, game/replay.js)
export function createReplayModel(rep) {
  const roster = new Map(rep.roster.map((u) => [u.id, u]));
  const kfs = [...rep.keyframes].sort((a, b) => a.e - b.e);
  function fromKeyframe(kf) {
    const units = new Map();
    for (const [id, q, r, vitality, morale, facing, stance, flags] of kf.units) {
      const base = roster.get(id) || { id, name: '?', typeId: 'soldats', category: 'Infanterie' };
      units.set(id, { ...base, q, r, vitality, morale, facing, stance, isFleeing: !!(flags & 1), isMine: false });
    }
    return { units, turn: kf.turn, manche: kf.manche, currentPlayerId: kf.currentPlayerId, timeOfDay: kf.timeOfDay, isNight: kf.isNight, owners: {}, scores: {} };
  }
  function apply(state, ev) {
    const u = ev.u != null ? state.units.get(ev.u) : null;
    switch (ev.k) {
      case 'move': if (u && ev.path?.length) {
        const last = ev.path[ev.path.length - 1], prev = ev.path[ev.path.length - 2];
        u.q = last[0]; u.r = last[1];
        if (prev) { const f = facingBetween(prev[0], prev[1], last[0], last[1]); if (f != null) u.facing = f; }
      } break;
      case 'combat': {
        const log = ev.log || {};
        const t = state.units.get(log.targetId), a = state.units.get(log.attackerId);
        if (t && log.targetVitalityLeft != null) t.vitality = log.targetVitalityLeft;
        if (t && log.targetMoraleLeft != null) t.morale = log.targetMoraleLeft;
        if (a && log.attackerVitalityLeft != null) a.vitality = log.attackerVitalityLeft;
        if (log.targetKilled) state.units.delete(log.targetId);
        if (log.attackerKilled) state.units.delete(log.attackerId);
        break;
      }
      case 'stance': if (u) u.stance = ev.s; break;
      case 'facing': if (u) u.facing = ev.f; break;
      case 'fled': for (const id of ev.units || []) { const f = state.units.get(id); if (f) f.isFleeing = true; } break;
      case 'capture': state.owners[ev.id] = ev.owner; break;
      case 'score': state.scores = ev.scores || {}; break;
      case 'turn': state.currentPlayerId = ev.currentPlayerId; state.turn = ev.turn; state.manche = ev.manche;
        if (ev.timeOfDay != null) state.timeOfDay = ev.timeOfDay; state.isNight = ev.isNight; break;
      default: break;
    }
  }
  function stateAt(index) {
    let kf = kfs[0];
    for (const k of kfs) if (k.e <= index) kf = k;
    const st = fromKeyframe(kf);
    for (let i = 0; i < index; i++) {
      if (i >= kf.e) apply(st, rep.events[i]);
      else if (rep.events[i].k === 'capture' || rep.events[i].k === 'score') apply(st, rep.events[i]);
    }
    return st;
  }
  return { stateAt, apply, events: rep.events, players: rep.players, roster };
}

export async function mountReplay3d(rep, { container, canvas, onProgress, controlsEl }) {
  const model = createReplayModel(rep);
  const world = await createWorld({ canvas, container, mapId: rep.mapId || 'default', intro: false, hour: 12, onProgress });
  const colors = Object.fromEntries((rep.players || []).map((p) => [p.id, p.color || '#4a90d9']));
  const getPlayerColor = (id) => colors[id] || '#bbbbbb';
  const KINGDOM_OF = { ou_ki: '秦', mou_bu: '秦', ou_sen: '秦', kan_ki: '秦', ri_boku: '趙', kei_sha: '趙', shi_ba_shou: '趙', ren_pa: '趙', go_kei: '魏', go_hou_mei: '魏', gai_mou: '魏' };
  const gens = Object.fromEntries((rep.players || []).map((p) => [p.id, KINGDOM_OF[p.generalId]]));
  const { createUnitLayer } = await import('./units3d.js');
  const units3d = createUnitLayer(world, { getPlayerColor, getPlayerEmblem: (id) => gens[id] });

  let state = model.stateAt(0);
  const bridgeLike = { get state() { return { timeOfDay: state.timeOfDay, turn: state.turn, manche: state.manche, units: [...state.units.values()] }; }, selectedUnit: null };
  const ui = createGameUI({ world, container, bridge: bridgeLike, getView: () => ({ active: true }) });
  world.frameHooks.push((dt) => ui.update(dt));

  const T = world.THREE;
  const anchor = (u) => units3d.getAnchor(u.id) || new T.Vector3(world.hexToWorld(u.q, u.r).x, 1, world.hexToWorld(u.q, u.r).z);
  function syncAll() {
    const list = [...state.units.values()].filter((u) => u.q != null);
    units3d.sync(list);
    world.layers.setOccupied(new Set(list.map((u) => `${u.q},${u.r}`)));
    const owners = {};
    for (const [id, o] of Object.entries(state.owners)) if (o) owners[id] = getPlayerColor(o);
    world.objectives.setOwners(owners);
    ui.applyHour();
  }

  let index = 0, playing = false, speed = 1, follow = true;
  let busyUntil = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms / speed));

  async function playEvent(ev) {
    const prevState = state;
    const u = ev.u != null ? prevState.units.get(ev.u) : null;
    if (ev.k === 'move' && u && ev.path?.length > 1) {
      const path = ev.path;
      if (follow) world.focusHex(path[path.length - 1][0], path[path.length - 1][1], 0.8 / speed);
      units3d.setMoving(u.id, true);
      const stepMs = 260;
      const t0 = performance.now();
      const total = (path.length - 1) * stepMs / speed;
      await new Promise((resolve) => {
        const tick = () => {
          const k = Math.min(1, (performance.now() - t0) / total);
          const f = k * (path.length - 1);
          const i = Math.min(path.length - 2, Math.floor(f));
          const a = world.hexToWorld(path[i][0], path[i][1]), b = world.hexToWorld(path[i + 1][0], path[i + 1][1]);
          const t = f - i;
          units3d.setDisplayPosition(u.id, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, Math.atan2(b.x - a.x, b.z - a.z));
          if (k < 1) requestAnimationFrame(tick); else resolve();
        };
        tick();
      });
      model.apply(state, ev);
      syncAll();
      units3d.clearDisplayPosition(u.id);
      units3d.setMoving(u.id, false);
      return;
    }
    if (ev.k === 'combat') {
      const log = ev.log || {};
      const a = state.units.get(log.attackerId), t = state.units.get(log.targetId);
      if (a && t) {
        if (follow) world.focusHex(t.q, t.r, 0.7 / speed);
        const impact = units3d.playAttack(a.id, t.id, { ranged: !!log.ranged }) || 0.5;
        units3d.playHit(t.id, { delay: impact });
        if (log.dmgReceived != null) ui.floatText(anchor(t).clone(), log.hit === false ? 'Raté' : `-${log.dmgReceived}`, log.hit === false ? 'miss' : '', impact);
        if (log.duel) ui.floatText(anchor(t).clone().setY(anchor(t).y + 0.6), 'DUEL', 'kill');
        await wait((impact + 0.6) * 1000);
      }
      model.apply(state, ev);
      syncAll();
      await wait(350);
      return;
    }
    model.apply(state, ev);
    syncAll();
    if (ev.k === 'turn') await wait(500);
    else if (ev.k === 'capture') { const [q, r] = String(ev.id).split(',').map(Number); if (!Number.isNaN(q)) world.layers.addPing(q, r, getPlayerColor(ev.owner)); await wait(400); }
  }

  async function loop() {
    while (playing && index < model.events.length) {
      await playEvent(model.events[index]);
      index++;
      render();
    }
    playing = false;
    render();
  }

  function jump(i) {
    index = Math.max(0, Math.min(model.events.length, i));
    state = model.stateAt(index);
    syncAll();
    render();
  }

  // --- Controls ---
  controlsEl.innerHTML = `
    <button data-a="start" title="Début">⏮</button><button data-a="prev" title="Tour précédent">⏪</button>
    <button data-a="play" title="Lecture/Pause">▶</button><button data-a="next" title="Tour suivant">⏩</button>
    <input type="range" min="0" value="0" step="1">
    <select data-a="speed"><option value="1">×1</option><option value="2">×2</option><option value="4">×4</option></select>
    <label><input type="checkbox" data-a="follow" checked> Suivre</label>
    <span class="info"></span>`;
  const slider = controlsEl.querySelector('input[type=range]');
  slider.max = model.events.length;
  const playBtn = controlsEl.querySelector('[data-a=play]');
  const info = controlsEl.querySelector('.info');
  const turnStarts = model.events.map((e, i) => (e.k === 'turn' ? i : -1)).filter((i) => i >= 0);
  function render() {
    slider.value = index;
    playBtn.textContent = playing ? '⏸' : '▶';
    const cur = (rep.players || []).find((p) => p.id === state.currentPlayerId);
    const h = state.timeOfDay != null ? `${String(Math.floor(state.timeOfDay)).padStart(2, '0')}h${String(Math.round((state.timeOfDay % 1) * 60)).padStart(2, '0')}` : '';
    info.innerHTML = `Tour ${state.turn || 1} · Manche ${state.manche || 1} · ${cur ? `<b style="color:${getPlayerColor(cur.id)}">${cur.name}</b>` : ''} · ${h}${state.isNight ? ' 🌙' : ''} · ${index}/${model.events.length}`;
  }
  controlsEl.addEventListener('click', (e) => {
    const a = e.target.dataset?.a;
    if (!a) return;
    if (a === 'play') { if (playing) playing = false; else { if (index >= model.events.length) jump(0); playing = true; loop(); } render(); }
    else if (a === 'start') { playing = false; jump(0); }
    else if (a === 'next') { playing = false; jump(turnStarts.find((i) => i > index) ?? model.events.length); }
    else if (a === 'prev') { playing = false; const p = turnStarts.filter((i) => i < index - 1); jump(p.length ? p[p.length - 1] : 0); }
  });
  slider.addEventListener('input', () => { playing = false; jump(parseInt(slider.value, 10)); });
  controlsEl.querySelector('[data-a=speed]').addEventListener('change', (e) => { speed = parseFloat(e.target.value); });
  controlsEl.querySelector('[data-a=follow]').addEventListener('change', (e) => { follow = e.target.checked; });

  world.controls.mouseButtons = { LEFT: T.MOUSE.PAN, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.ROTATE };
  world.controls.screenSpacePanning = false;
  jump(0);
  const first = [...state.units.values()][0];
  if (first) {
    const p = world.hexToWorld(first.q, first.r);
    world.applyView({ px: p.x + 11, py: 13, pz: p.z + 13, tx: p.x, ty: 1, tz: p.z });
  }
  world.start();
  window.addEventListener('resize', () => world.resize());
  return { world, units3d, jump, model };
}
