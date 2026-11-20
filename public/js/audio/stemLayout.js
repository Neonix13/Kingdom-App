// Rendered-music layout shared by scripts/music-phrases.mjs (export), scripts/music-import.mjs (import) and stemMusic.js (player).
// Each state is a pool of phrases of PHRASE_BARS bars at a fixed tempo; battle is split into layers mixed by intensity.
export const PHRASE_BARS = 8;
export const TAIL_BARS = 2;
export const PRE_BARS = 1;

export const STEM_STATES = {
  menu: { folder: 'menu', bpm: 58, layers: ['mix'] },
  calm: { folder: 'calme', bpm: 52, layers: ['mix'] },
  deploy: { folder: 'deploiement', bpm: 74, layers: ['mix'] },
  battle: { folder: 'bataille', bpm: 96, layers: ['melodie', 'pipa', 'leger', 'lourd'] },
  victory: { folder: 'victoire', bpm: 64, layers: ['mix'], intro: true },
  defeat: { folder: 'defaite', bpm: 50, layers: ['mix'], intro: true },
};

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function layerGains(state, intensity) {
  if (state !== 'battle') return { mix: 1 };
  const I = Math.min(1, Math.max(0, intensity || 0));
  return {
    melodie: 1 - 0.45 * ss(0.5, 1, I),
    pipa: 0.3 + 0.7 * ss(0.1, 0.8, I),
    leger: ss(0.02, 0.3, I),
    lourd: ss(0.45, 0.85, I),
  };
}
