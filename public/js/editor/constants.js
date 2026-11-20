// Types and limits mirrored from game/maps.js, game/data/terrains.js and game/data/segments.js
export const TERRAINS = [
  { id: 'plain', name: 'Plaines', color: '#9fb86a' },
  { id: 'forest', name: 'Forêts', color: '#2f6b24' },
  { id: 'river', name: 'Fleuves', color: '#3a7fd0' },
  { id: 'road', name: 'Routes', color: '#c8aa6a' },
  { id: 'building', name: 'Bâtiments', color: '#8a5a3a' },
  { id: 'bridge', name: 'Ponts', color: '#d88a20' },
];
export const TERRAIN_IDS = new Set(TERRAINS.map((t) => t.id));
export const TERRAIN_BY_ID = Object.fromEntries(TERRAINS.map((t) => [t.id, t]));

export const SEGMENTS = [
  { id: 'cliff', name: 'Falaise', color: '#b4b4d8' },
  { id: 'mur', name: 'Mur', color: '#e0e0e0' },
  { id: 'river', name: 'Rivière', color: '#4aa0ff' },
  { id: 'barriere', name: 'Barrière', color: '#6ccf50' },
  { id: 'passerelle', name: 'Passerelle', color: '#f0d070' },
  { id: 'bridge', name: 'Pont', color: '#ff9a30' },
  { id: 'echelle', name: 'Échelle', color: '#c08040' },
  { id: 'chevaux_de_frise', name: 'Chevaux de frise', color: '#ff4a4a' },
];
export const SEGMENT_IDS = new Set(SEGMENTS.map((s) => s.id));
export const SEGMENT_BY_ID = Object.fromEntries(SEGMENTS.map((s) => [s.id, s]));

export const ZONE_COLORS = ['#e04040', '#4080ff', '#40c060', '#e0c030', '#c050e0', '#30d0d0', '#ff8030', '#ff70b0'];

export const OBJECTIVE_TYPES = ['village', 'fort', 'colline', 'pont', 'camp', 'temple', 'gué', 'autre'];

export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;
export const KEY_RE = /^-?\d+,-?\d+$/;
export const HEIGHT_MIN = -2;
export const HEIGHT_MAX = 20;

// Same formula as getStartingZones (game/HexUtils.js): max(5, floor(budget/1000)*5), default budget 2500
export const DEFAULT_BUDGET = 2500;
export const zoneMinTiles = (budget = DEFAULT_BUDGET) => Math.max(5, Math.floor(budget / 1000) * 5);

export const clampHeight = (h) => Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, Math.round(h)));
