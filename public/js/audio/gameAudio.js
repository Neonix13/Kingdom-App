import { createAudio } from './index.js';

const CSS = `
#snd-popup { position:absolute; top:52px; left:64px; z-index:60; width:220px; padding:10px 12px; display:none;
  background:rgba(18,8,4,0.95); border:1px solid #5a3c10; border-radius:8px; color:#e8d5a0; font:12px 'Segoe UI',system-ui,sans-serif; }
#snd-popup.open { display:block; }
#snd-popup label { display:flex; justify-content:space-between; align-items:center; gap:8px; margin:5px 0; }
#snd-popup input[type=range] { width:110px; accent-color:#c8960c; }
`;

// Game-wide sound: music by phase, SFX on game events, ambience from the 3D camera (or a calm default in 2D)
export function attachGameAudio(bridge) {
  const audio = createAudio();
  window.gameAudio = audio;
  const unlock = () => audio.unlock();
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const toolbar = document.getElementById('toolbar');
  const btn = document.createElement('button');
  btn.className = 'tool-btn';
  btn.title = 'Son';
  btn.innerHTML = '&#128264;';
  const sep = document.createElement('div');
  sep.className = 'tool-separator';
  if (toolbar) { toolbar.appendChild(sep); toolbar.appendChild(btn); }
  const pop = document.createElement('div');
  pop.id = 'snd-popup';
  const s = audio.settings || {};
  const slider = (k, label) => `<label>${label}<input type="range" min="0" max="1" step="0.05" data-k="${k}" value="${s[k] ?? 0.7}"></label>`;
  pop.innerHTML = `${slider('masterVolume', 'Général')}${slider('musicVolume', 'Musique')}${slider('sfxVolume', 'Effets')}${slider('ambienceVolume', 'Ambiance')}
    <label>Muet <input type="checkbox" data-k="muted" ${s.muted ? 'checked' : ''}></label>`;
  (document.getElementById('canvas-area') || document.body).appendChild(pop);
  btn.addEventListener('click', (e) => { e.stopPropagation(); pop.classList.toggle('open'); });
  document.addEventListener('pointerdown', (e) => { if (!pop.contains(e.target) && e.target !== btn) pop.classList.remove('open'); });
  for (const el of pop.querySelectorAll('input')) {
    el.addEventListener('input', () => {
      if (el.dataset.k === 'muted') audio.mute(el.checked);
      else audio.setVolumes({ [el.dataset.k]: parseFloat(el.value) });
      btn.innerHTML = el.dataset.k === 'muted' && el.checked ? '&#128263;' : '&#128264;';
    });
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('button, .btn, .tool-btn')) audio.play('ui_click', { volume: 0.7 });
  }, true);

  // Spatialisation helpers (3D view when active)
  function spatial(q, r) {
    const v = window.view3d;
    if (!v || !v.active || q == null) return { pan: 0, distance: 0.2 };
    const w = v.world;
    const p = w.hexToWorld(q, r);
    const T = w.THREE;
    const pos = new T.Vector3(p.x, w.groundHeight(p.x, p.z), p.z);
    const s2 = w.projectToScreen(pos);
    const width = w.canvas.clientWidth || 1;
    const pan = Math.max(-1, Math.min(1, (s2.x / width) * 2 - 1)) * 0.8;
    const d = w.camera.position.distanceTo(pos);
    return { pan, distance: Math.max(0, Math.min(1, (d - 6) / 70)) };
  }
  const unitById = (id) => (bridge.state?.units || []).find((u) => u.id === id);

  function setPhaseMusic() {
    const st = bridge.state;
    if (st?.phase === 'battle') audio.setMusic('battle');
    else if (bridge.deployState) audio.setMusic('deploy');
    else audio.setMusic('calm');
  }
  setPhaseMusic();

  function intensity() {
    const st = bridge.state;
    if (!st || st.phase !== 'battle') return 0;
    const units = st.units || [];
    let contact = 0;
    for (const u of units) {
      if (u.q == null) continue;
      if (units.some((o) => o.playerId !== u.playerId && o.q != null && (Math.abs(o.q - u.q) + Math.abs(o.r - u.r) + Math.abs(o.q + o.r - u.q - u.r)) / 2 <= 2)) contact++;
    }
    return Math.min(1, 0.15 + contact / Math.max(4, units.length) * 1.6);
  }

  function onEvent(event, data) {
    switch (event) {
      case 'deployment_state': audio.setMusic('deploy'); break;
      case 'phase_change': if (data.phase === 'battle') { audio.setMusic('battle'); audio.play('gong'); } break;
      case 'initiative_rolled': audio.play('drum_roll_initiative'); break;
      case 'turn_change': audio.play(data.currentPlayerId === bridge.myId ? 'horn_turn_start' : 'notification', { volume: data.currentPlayerId === bridge.myId ? 1 : 0.6 }); break;
      case 'game_state': setTimeout(() => audio.setIntensity(intensity()), 0); break;
      case 'unit_move_anim': {
        const u = unitById(data.unitId);
        const name = u && u.category === 'Chevaux' ? 'move_gallop' : u && u.category === 'Chars' ? 'chariot_rumble' : 'move_march';
        const sp = spatial(data.fromQ, data.fromR);
        const id = audio.startLoop(name, sp);
        const steps = (data.path || []).length || 1;
        setTimeout(() => audio.stopLoop(id), steps * (bridge.ANIM_STEP_MS || 200) + 150);
        break;
      }
      case 'combat_result': {
        const log = data.combatLog || data;
        if (log.abilityUsed) { audio.play('gong', { volume: 0.7 }); break; }
        if (log.duel) { audio.play('drum_roll_initiative', { volume: 0.8 }); if (!(window.view3d && window.view3d.active)) audio.play('general_duel'); break; }
        const tgt = unitById(log.targetId);
        const sp = spatial(tgt?.q, tgt?.r);
        audio.play(log.ranged ? 'arrow_volley' : 'attack_clash', sp);
        const impact = log.ranged ? 900 : 420;
        if (log.hit !== false) setTimeout(() => audio.play('hit_impact', sp), impact);
        if (log.targetKilled || log.attackerKilled) setTimeout(() => audio.play('unit_death', sp), impact + 400);
        break;
      }
      case 'units_fled': audio.play('unit_rout'); break;
      case 'ambush': { const sp = spatial(data.q, data.r); audio.play('attack_clash', sp); setTimeout(() => audio.play('hit_impact', sp), 300); break; }
      case 'objective_captured': audio.play('gong', { ...spatial(data.q, data.r), volume: 0.6 }); break;
      case 'ping': audio.play('ping', spatial(data.q, data.r)); break;
      case 'chat_message': if (data.authorId !== bridge.myId) audio.play('notification', { volume: 0.5 }); break;
      case 'game_over': {
        const won = data.winnerId === bridge.myId;
        audio.play(won ? 'victory_fanfare' : 'defeat');
        audio.setMusic(won ? 'victory' : 'defeat');
        break;
      }
      default: break;
    }
  }
  (window.gameEventHooks = window.gameEventHooks || []).push(onEvent);

  // Ambience follows the 3D camera; calm countryside mix in 2D
  setInterval(() => {
    const v = window.view3d;
    if (!v || !v.active) {
      audio.setAmbience({ timeOfDay: 14, nearWater: 0.2, nearForest: 0.4, nearVillage: 0.15, cameraHeight: 40 });
      return;
    }
    const w = v.world;
    const t = w.controls.target;
    const c = w.worldToHex(t.x, t.z);
    let water = 0, forest = 0, village = 0, n = 0;
    for (let dq = -4; dq <= 4; dq++) {
      for (let dr = Math.max(-4, -dq - 4); dr <= Math.min(4, -dq + 4); dr++) {
        const h = w.allHexes.get(`${c.q + dq},${c.r + dr}`);
        n++;
        if (!h) continue;
        if (h.terrain === 'river' || h.terrain === 'bridge') water++;
        else if (h.terrain === 'forest') forest++;
        else if (h.terrain === 'building') village++;
      }
    }
    audio.setAmbience({
      timeOfDay: w.hour,
      nearWater: Math.min(1, water / n * 5),
      nearForest: Math.min(1, forest / n * 2.5),
      nearVillage: Math.min(1, village / n * 6),
      cameraHeight: w.camera.position.distanceTo(t),
    });
  }, 300);

  return audio;
}
