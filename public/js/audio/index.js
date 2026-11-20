import { sharedBank } from './bank.js';
import { Engine } from './engine.js';
import { Music, MUSIC_STATES } from './music.js';
import { Ambience } from './ambience.js';
import { SFX } from './recipes.js';
import { clamp } from './dsp.js';

const KEY = 'kb_audio';
const DEFAULTS = { masterVolume: 0.8, musicVolume: 0.6, sfxVolume: 0.8, ambienceVolume: 0.6, muted: false };
const VOL_KEYS = ['masterVolume', 'musicVolume', 'sfxVolume', 'ambienceVolume'];

export const SOUND_NAMES = Object.keys(SFX);
export const LOOP_NAMES = Object.keys(SFX).filter((n) => SFX[n].loop);
export const MUSIC_STATE_NAMES = ['off', ...Object.keys(MUSIC_STATES)];

function loadStored() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && typeof s === 'object' ? s : {}; } catch (e) { return {}; }
}

function sanitize(src) {
  const o = {};
  for (const k of VOL_KEYS) if (Number.isFinite(+src[k]) && src[k] !== null && src[k] !== '') o[k] = clamp(+src[k], 0, 1);
  if (typeof src.muted === 'boolean') o.muted = src.muted;
  return o;
}

function engineVolumes(s) {
  return { master: s.masterVolume, music: s.musicVolume, sfx: s.sfxVolume, ambience: s.ambienceVolume, muted: s.muted };
}

export function createAudio(opts = {}) {
  const settings = { ...DEFAULTS, ...sanitize(opts), ...sanitize(loadStored()) };
  const bank = sharedBank(opts.renderRate || 32000);
  let engine = null, music = null, amb = null, timer = null;
  let musicState = 'off', intensity = 0;
  const ambParams = {};
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { } };
  const warmTimer = setTimeout(() => bank.warm(), opts.warmDelay ?? 200);

  const tick = () => {
    if (!engine || engine.ctx.state !== 'running') return;
    const now = engine.ctx.currentTime;
    amb.update();
    amb.scheduleWindow(now, now + 1.0);
    music.scheduleWindow(now, now + 1.5);
  };

  const audio = {
    get unlocked() { return !!engine; },
    get context() { return engine ? engine.ctx : null; },
    get settings() { return { ...settings }; },
    get musicState() { return musicState; },
    get _internals() { return engine ? { engine, music, amb, bank } : { bank }; },
    ready: () => bank.warm(),

    unlock() {
      if (!engine) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return Promise.resolve(false);
        const ctx = new AC({ latencyHint: 'interactive' });
        engine = new Engine(ctx, bank);
        engine.setVolumes(engineVolumes(settings), 0.01);
        music = new Music(engine, (Math.random() * 1e9) | 0);
        amb = new Ambience(engine, { cameraHeightRange: opts.cameraHeightRange, seed: (Math.random() * 1e9) | 0 });
        amb.set(ambParams);
        music.setIntensity(intensity);
        if (musicState !== 'off') music.set(musicState);
        timer = setInterval(tick, 100);
        bank.warm();
      }
      const ctx = engine.ctx;
      return (ctx.state === 'running' ? Promise.resolve() : ctx.resume()).then(() => true, () => false);
    },

    setVolumes(v = {}) {
      Object.assign(settings, sanitize(v));
      persist();
      engine && engine.setVolumes(engineVolumes(settings));
      return { ...settings };
    },

    mute(m = true) {
      settings.muted = !!m;
      persist();
      engine && engine.setVolumes(engineVolumes(settings));
    },

    play(name, o = {}) {
      if (!engine || engine.ctx.state !== 'running') return null;
      return engine.play(name, o) ? true : null;
    },

    startLoop(name, o = {}) { return engine ? engine.startLoop(name, o) : null; },
    updateLoop(id, o = {}) { engine && engine.updateLoop(id, o); },
    stopLoop(id, fade) { engine && engine.stopLoop(id, fade); },
    stopAllLoops(fade) { engine && engine.stopAllLoops(fade); },

    setAmbience(p = {}) {
      const q = 'enabled' in ambParams || 'enabled' in p ? p : { enabled: true, ...p };
      Object.assign(ambParams, q);
      amb && amb.set(q);
    },

    setMusic(state) {
      if (!MUSIC_STATE_NAMES.includes(state)) { console.warn('[audio] état musical inconnu', state); return; }
      musicState = state;
      music && music.set(state);
    },

    setIntensity(x) {
      intensity = clamp(+x || 0, 0, 1);
      music && music.setIntensity(intensity);
    },

    dispose() {
      clearTimeout(warmTimer);
      clearInterval(timer);
      if (engine) { engine.stopAllLoops(0.05); amb.stop(); engine.ctx.close(); }
      engine = music = amb = null;
    },
  };
  return audio;
}

export async function renderOffline(seconds, setup, o = {}) {
  const sr = o.sampleRate || 44100;
  const bank = sharedBank(o.renderRate || 32000);
  await bank.warm();
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sr), sr);
  const engine = new Engine(ctx, bank);
  engine.vnow = 0;
  engine.setVolumes(engineVolumes({ ...DEFAULTS, masterVolume: 1, musicVolume: 1, sfxVolume: 1, ambienceVolume: 1, ...sanitize(o.volumes || {}) }));
  const music = new Music(engine, o.seed ?? 7);
  const amb = new Ambience(engine, { seed: o.seed ?? 7, cameraHeightRange: o.cameraHeightRange });
  let ambOn = false;
  const api = {
    engine, music, amb,
    play: (name, opts = {}, at) => engine.play(name, opts, at ?? engine.vnow),
    startLoop: (name, opts) => engine.startLoop(name, opts),
    stopLoop: (id, fade) => engine.stopLoop(id, fade),
    setMusic: (s) => music.set(s),
    setIntensity: (x) => music.setIntensity(x),
    setAmbience: (p) => { ambOn = true; amb.set({ enabled: true, ...p }); },
  };
  const timeline = [...(o.timeline || [])].sort((a, b) => a[0] - b[0]);
  if (setup) await setup(api);
  if (ambOn) amb.update(true);
  const step = 0.25;
  for (let t = 0; t < seconds; t += step) {
    engine.vnow = t;
    while (timeline.length && timeline[0][0] <= t) timeline.shift()[1](api);
    if (ambOn) { amb.update(); amb.scheduleWindow(t, t + step); }
    music.scheduleWindow(t, t + step);
  }
  return ctx.startRendering();
}
