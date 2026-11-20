import { createWorld } from './world.js';
import { createGameUI } from './gameUI.js';
import { createCombatSplash } from '../hud/combatSplash.js';
import { generalPortrait, unitPortrait, unitKanji } from '../portraits.js';

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
  // Recorded replays carry the clock (turn, manche, hour) in keyframes rather than 'turn' events
  function syncClock(st, index) {
    const k = kfs.find((x) => x.e === index);
    if (!k) return false;
    Object.assign(st, { turn: k.turn, manche: k.manche, currentPlayerId: k.currentPlayerId, timeOfDay: k.timeOfDay, isNight: k.isNight });
    return true;
  }
  return { stateAt, apply, syncClock, events: rep.events, players: rep.players, roster };
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
  const generalOf = Object.fromEntries((rep.players || []).map((p) => [p.id, p.generalId]));
  const splash = createCombatSplash({
    bridge: { get state() { return { units: [...state.units.values()] }; }, getPlayerColor },
    portrait: (u) => (u.isGeneral ? generalPortrait(generalOf[u.playerId]) : unitPortrait(u.typeId)),
    kanji: unitKanji,
    isActive: () => true,
  });

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

  let index = 0, playing = false, speed = 1, follow = true, cards = true;
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
        if (cards) splash.show(log, { playback: speed > 1 });
        await wait((impact + 0.6) * 1000 + (cards && speed === 1 ? 2200 : 0));
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
      if (model.syncClock(state, index)) ui.applyHour();
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
  const PLAY = '<svg class="ink-ic fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>', PAUSE = '<svg class="ink-ic fill" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>';
  controlsEl.innerHTML = `
    <div class="rc-row">
      <button class="ink-btn" data-a="start" title="Début" aria-label="Début"><svg class="ink-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M18 6l-9 6 9 6z"/></svg></button>
      <button class="ink-btn" data-a="prev" title="Tour précédent" aria-label="Tour précédent"><svg class="ink-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6l-8 6 8 6zM20 6l-8 6 8 6z"/></svg></button>
      <button class="ink-btn big" data-a="play" title="Lecture / pause (Espace)" aria-label="Lecture">${PLAY}</button>
      <button class="ink-btn" data-a="next" title="Tour suivant" aria-label="Tour suivant"><svg class="ink-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6l8 6-8 6zM4 6l8 6-8 6z"/></svg></button>
      <span class="rc-info info"></span>
      <label class="rc-lab">Vitesse <select class="ink-select" data-a="speed"><option value="1">×1</option><option value="2">×2</option><option value="4">×4</option></select></label>
      <label class="ink-check"><input type="checkbox" data-a="follow" checked> Suivre</label>
      <label class="ink-check"><input type="checkbox" data-a="cards" checked> Fiches de combat</label>
    </div>
    <div class="ink-track"><div class="ink-ticks"></div><input type="range" min="0" value="0" step="1" aria-label="Chronologie"></div>`;
  const slider = controlsEl.querySelector('input[type=range]');
  slider.max = model.events.length;
  const playBtn = controlsEl.querySelector('[data-a=play]');
  const info = controlsEl.querySelector('.info');
  // Turn boundaries: 'turn' events when present, otherwise the keyframes (recorded at each manche)
  const marks = model.events.some((e) => e.k === 'turn')
    ? model.events.map((e, i) => (e.k === 'turn' ? { i, turn: e.turn, night: !!e.isNight } : null)).filter(Boolean)
    : [...(rep.keyframes || [])].sort((x, y) => x.e - y.e).map((k) => ({ i: k.e, turn: k.turn, night: !!k.isNight }));
  const turnStarts = [...new Set(marks.map((m) => m.i))].filter((i) => i > 0 && i < model.events.length);
  {
    const ticks = controlsEl.querySelector('.ink-ticks');
    const n = Math.max(1, model.events.length);
    let lastNight = null, lastTurn = null, labelled = -100;
    for (const m of marks) {
      const pct = (m.i / n) * 100;
      const tick = document.createElement('i');
      tick.style.left = pct + '%';
      if (lastNight !== null && m.night !== lastNight) tick.className = 'day';
      lastNight = m.night;
      ticks.append(tick);
      if (m.turn != null && m.turn !== lastTurn && pct - labelled >= 5) {
        const b = document.createElement('b');
        b.style.left = pct + '%';
        b.textContent = m.turn;
        ticks.append(b);
        labelled = pct;
      }
      lastTurn = m.turn;
    }
  }
  function render() {
    slider.value = index;
    playBtn.innerHTML = playing ? PAUSE : PLAY;
    const cur = (rep.players || []).find((p) => p.id === state.currentPlayerId);
    const h = state.timeOfDay != null ? `${String(Math.floor(state.timeOfDay)).padStart(2, '0')}h${String(Math.round((state.timeOfDay % 1) * 60)).padStart(2, '0')}` : '';
    info.innerHTML = `<b class="n">TOUR ${state.turn || 1}</b> Manche ${state.manche || 1} · ${cur ? `<b style="color:${getPlayerColor(cur.id)}">${cur.name}</b> · ` : ''}${h}${state.isNight ? ' · nuit' : ''} <span class="c">${index} / ${model.events.length}</span>`;
  }
  controlsEl.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'play') { if (playing) playing = false; else { if (index >= model.events.length) jump(0); playing = true; loop(); } render(); }
    else if (a === 'start') { playing = false; jump(0); }
    else if (a === 'next') { playing = false; jump(turnStarts.find((i) => i > index) ?? model.events.length); }
    else if (a === 'prev') { playing = false; const p = turnStarts.filter((i) => i < index - 1); jump(p.length ? p[p.length - 1] : 0); }
  });
  slider.addEventListener('input', () => { playing = false; jump(parseInt(slider.value, 10)); });
  controlsEl.querySelector('[data-a=speed]').addEventListener('change', (e) => { speed = parseFloat(e.target.value); });
  controlsEl.querySelector('[data-a=follow]').addEventListener('change', (e) => { follow = e.target.checked; });
  controlsEl.querySelector('[data-a=cards]').addEventListener('change', (e) => { cards = e.target.checked; if (!cards) splash.hide(); });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || splash.shown || /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || '')) return;
    e.preventDefault();
    playBtn.click();
  });

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
