import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise2D, makeRng, fbm2, ridged2, makeTileableNoiseData } from './noise.js';
import { G, installHeightFog, patchLit } from './shaderPatches.js';
import { createWaterMaterial } from './water.js';
import * as VEG from './vegetation.js';
import { createPost, QualityGovernor, COLOR_PRESETS } from './post.js';
import { bakeObstacleHeights, createCameraGuard } from './cameraGuard.js';
import { createCloudLayer } from './clouds.js';
import { createStars, createMoon, createFireflies, createLightPools } from './night.js';
import { buildStructures } from './buildings.js';
import { createBirds } from './birds.js';
import { buildFortifications } from './fortifications.js';
import { createBoardLayers } from './overlays.js';
import { createObjectiveMarkers } from './objectives3d.js';
import '../mapProps.js';

export async function createWorld(opts = {}) {

// --- Constants ---
const HEX_SIZE = 1.0;
const HEX_HEIGHT_STEP = 1.0;
const WATER_LEVEL = 0.35;
const RIVERBED_HEIGHT = -0.15;
const STREAM_DEPTH = 0.3;
const sqrt3 = Math.sqrt(3);



const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
async function setProgress(pct, text) {
  if (opts.onProgress) opts.onProgress(pct, text);
  await nextFrame();
}

installHeightFog(0.5, 0.05);

await setProgress(5, 'Fetching terrain data...');
// broadleaf tree modelled in Blender, loaded alongside the terrain (procedural broadleaf if it fails)
const broadModelReady = VEG.loadTreeModel('assets/models/trees/LoireTree2.glb', { height: 1.25 });
const mapDoc = opts.map || await fetch(`/api/maps/${encodeURIComponent(opts.mapId || 'default')}`).then(r => {
  if (!r.ok) throw new Error('Carte introuvable');
  return r.json();
});
const terrainData = mapDoc.terrain || {};
const heightData = mapDoc.height || {};
const segmentData = mapDoc.segments || {};
const decor = mapDoc.decor || {};
const segSet = new Map();
for (const [segKey, segType] of Object.entries(segmentData)) segSet.set(segKey, segType);
function getSegType(q1, r1, q2, r2) {
  return segSet.get(`${q1},${r1}|${q2},${r2}`) || segSet.get(`${q2},${r2}|${q1},${r1}`) || null;
}
// the segments the rules see (map segments + automatic cliffs where heights differ by 2+ + walls around ramparts):
// the terrain shape follows them, so a cliff in the rules is a crisp rock face on screen and every slope is walkable
const MP = (typeof self !== 'undefined' && self.KBMapProps) || null;
const ruleSegSet = new Map(Object.entries(MP ? MP.effectiveSegments(segmentData, decor, heightData) : segmentData));
const getRuleSegType = (q1, r1, q2, r2) => ruleSegSet.get(`${q1},${r1}|${q2},${r2}`) || ruleSegSet.get(`${q2},${r2}|${q1},${r1}`) || null;
// edges drawn as a vertical step in the terrain: cliffs (explicit or automatic), and stone stairs (their flight stands against the face)
const VERTICAL_SEGS = new Set(['cliff', 'escalier']);
const isVerticalEdge = (q1, r1, q2, r2) => VERTICAL_SEGS.has(getRuleSegType(q1, r1, q2, r2));

await setProgress(12, 'Processing hex grid...');

// --- Hex set (same bounds logic as game.js) ---
const allHexes = new Map();
for (const key of Object.keys(heightData)) {
  const [q, r] = key.split(',').map(Number);
  allHexes.set(key, { q, r, terrain: terrainData[key] || 'plain', height: heightData[key] || 0 });
}

// --- Hex math (flat-top) ---
function hexToWorld(q, r) {
  return { x: HEX_SIZE * (3 / 2 * q), z: HEX_SIZE * (sqrt3 / 2 * q + sqrt3 * r) };
}
function hexCorner(wx, wz, i) {
  const a = (Math.PI / 3) * i;
  return { x: wx + HEX_SIZE * Math.cos(a), z: wz + HEX_SIZE * Math.sin(a) };
}
function getCornerKey(x, z) {
  return `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
}
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// Real board bounds from hex positions
let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
for (const h of allHexes.values()) {
  const p = hexToWorld(h.q, h.r);
  bx0 = Math.min(bx0, p.x - 1); bx1 = Math.max(bx1, p.x + 1);
  bz0 = Math.min(bz0, p.z - sqrt3 / 2); bz1 = Math.max(bz1, p.z + sqrt3 / 2);
}
const BCX = (bx0 + bx1) / 2, BCZ = (bz0 + bz1) / 2;

const HEX_DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
// Maps HEX_DIRS index → geometric edge index (edge between corner i and corner i+1)
const DIR_TO_GEO_EDGE = [0, 5, 4, 3, 2, 1];
// Corner i is shared with the neighbors across its two adjacent edges.
const CORNER_NEIGHBORS = [
  [[1, -1], [1, 0]],
  [[1, 0], [0, 1]],
  [[0, 1], [-1, 1]],
  [[-1, 1], [-1, 0]],
  [[-1, 0], [0, -1]],
  [[0, -1], [1, -1]],
];

await setProgress(18, 'Initializing renderer...');

// --- Renderer ---
const canvas = opts.canvas;
const container = opts.container || canvas.parentElement || document.body;
const W = () => Math.max(1, container.clientWidth);
const H = () => Math.max(1, container.clientHeight);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(W(), H());
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
const maxAniso = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0xbccad6);
scene.fog = new THREE.FogExp2(FOG_COLOR.getHex(), 0.0034);
scene.background = FOG_COLOR.clone();

// camera: the DESIRED camera (controls, fly-ins, auto camera, keyboard); renderCam: what is drawn, derived from it
// every frame by the camera rig (cameraGuard.js: smoothed zoom, collision corrections), never written by the game
const camera = new THREE.PerspectiveCamera(42, W() / H(), 0.3, 1400);
const renderCam = new THREE.PerspectiveCamera(42, W() / H(), 0.3, 1400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.maxPolarAngle = Math.PI / 2.12;
controls.minDistance = 3;
controls.maxDistance = 150;
controls.zoomSpeed = 1.1;
controls.autoRotateSpeed = 0.35;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

const intro = { active: false, t: 0, dur: 5.5, from: null, to: null };
const DEFAULT_VIEW = {
  px: BCX + 41, py: 17, pz: BCZ + 41,
  tx: BCX + 7, ty: 2, tz: BCZ + 3,
};
function applyView(v) {
  camera.position.set(v.px, v.py, v.pz);
  controls.target.set(v.tx, v.ty, v.tz);
  controls.update();
}
controls.addEventListener('change', () => {
  const t = controls.target;
  t.x = Math.min(bx1 + 8, Math.max(bx0 - 8, t.x));
  t.z = Math.min(bz1 + 8, Math.max(bz0 - 8, t.z));
  t.y = Math.min(12, Math.max(-1, t.y));
  if (intro.active || !opts.persistKey) return;
  localStorage.setItem(opts.persistKey + '_cam', JSON.stringify({
    px: camera.position.x, py: camera.position.y, pz: camera.position.z,
    tx: t.x, ty: t.y, tz: t.z,
  }));
});
applyView((opts.persistKey && JSON.parse(localStorage.getItem(opts.persistKey + '_cam') || 'null')) || DEFAULT_VIEW);

// --- Shared noise texture ---
const noiseTex = new THREE.DataTexture(makeTileableNoiseData(256), 256, 256, THREE.RGBAFormat);
noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping;
noiseTex.magFilter = THREE.LinearFilter;
noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
noiseTex.generateMipmaps = true;
noiseTex.needsUpdate = true;
G.uNoise.value = noiseTex;

// --- Terrain textures ---
const texLoader = new THREE.TextureLoader();
const TERRAIN_TEX_PATHS = [
  'assets/textures/grass.png',
  'assets/textures/forest-floor.png',
  'assets/textures/dirt.png',
  'assets/textures/rock-ground.png',
  'assets/textures/cliff-rock.png',
  'assets/textures/dry-grass.png',
];
const terrainTextures = TERRAIN_TEX_PATHS.map(p => {
  const t = texLoader.load(p);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
});
const TEX_UV_SCALE = 0.5;

// --- Visual type per hex ---
const fieldSet = new Set(decor.fields || []);
const rampartSet = new Set(decor.ramparts || []);
// fortified ground (walls, gates, stairs): no boulders or scree there
const gateHexSet = new Set((decor.props || []).filter((p) => p.type === 'porte').map((p) => `${p.q},${p.r}`));
const stairHexSet = new Set();
for (const [k, t] of Object.entries(segmentData)) if (t === 'escalier') for (const hk of k.split('|')) stairHexSet.add(hk);
function nearFort(q, r) {
  const k = `${q},${r}`;
  if (rampartSet.has(k) || gateHexSet.has(k) || stairHexSet.has(k)) return true;
  return HEX_DIRS.some(([dq, dr]) => gateHexSet.has(`${q + dq},${r + dr}`));
}
function isWaterHex(h) { return h.terrain === 'river' || h.terrain === 'bridge'; }
// high open ground drawn as continuous mountain slopes rather than stepped hex plateaus
function isMountain(h) {
  return h.height >= 4 && (h.terrain === 'plain' || h.terrain === 'forest') && !rampartSet.has(`${h.q},${h.r}`) && !fieldSet.has(`${h.q},${h.r}`);
}
function visualType(h) {
  if (isWaterHex(h)) return 'water';
  if (rampartSet.has(`${h.q},${h.r}`)) return 'rampart';
  if (h.terrain !== 'plain') return h.terrain;
  if (fieldSet.has(`${h.q},${h.r}`)) return 'field';
  if (h.height >= 5) return 'rocky';
  if (h.height >= 3) return 'highland';
  return 'plain';
}
const VT_STYLE = {
  plain:    { color: 0x83a24c, tex: 0, variation: 0.03 },
  forest:   { color: 0x5d7038, tex: 1, variation: 0.03 },
  road:     { color: 0x8ea152, tex: 0, variation: 0.03 },
  building: { color: 0x9a8b78, tex: 3, variation: 0.02 },
  field:    { color: 0xe0bd62, tex: 5, variation: 0.025 },
  highland: { color: 0xa9a468, tex: 5, variation: 0.03 },
  rocky:    { color: 0x8f9a64, tex: 0, variation: 0.035 },
  water:    { color: 0x7a6a55, tex: 3, variation: 0.0 },
  rampart:  { color: 0x8c8374, tex: 3, variation: 0.015 },
};
const vtypeOf = new Map();
for (const [k, h] of allHexes) vtypeOf.set(k, visualType(h));
const hexesByType = {};
for (const h of allHexes.values()) (hexesByType[h.terrain] ||= []).push(h);

function styleOf(h) { return VT_STYLE[vtypeOf.get(`${h.q},${h.r}`)] || VT_STYLE.plain; }
function hexColor(h) {
  const st = styleOf(h);
  const color = new THREE.Color(st.color);
  const hash = Math.sin(h.q * 127.1 + h.r * 311.7) * 43758.5453;
  const v = (hash - Math.floor(hash)) * 2 - 1;
  const hsl = {};
  color.getHSL(hsl);
  color.setHSL(hsl.h + v * 0.01, hsl.s, Math.max(0.05, Math.min(0.75, hsl.l + v * st.variation)));
  return color;
}
const hexTex = (h) => styleOf(h).tex;
const effH = (h) => (isWaterHex(h) ? RIVERBED_HEIGHT : h.height * HEX_HEIGHT_STEP);

// --- Streams (river segments along hex edges), footbridges and compound gateways ---
function edgeCorners(q1, r1, q2, r2) {
  const d = HEX_DIRS.findIndex(([a, b]) => a === q2 - q1 && b === r2 - r1);
  if (d < 0) return null;
  const geo = DIR_TO_GEO_EDGE[d];
  const c = hexToWorld(q1, r1);
  return [hexCorner(c.x, c.z, geo), hexCorner(c.x, c.z, (geo + 1) % 6)];
}
function parseSeg(segKey) {
  const [A, B] = segKey.split('|');
  const [q1, r1] = A.split(',').map(Number);
  const [q2, r2] = B.split(',').map(Number);
  return { q1, r1, q2, r2 };
}
const streamEdges = [];
const streamCornerKeys = new Set();
const footbridges = [];
const gateways = [];
for (const [segKey, type] of Object.entries(segmentData)) {
  if (type !== 'river' && type !== 'passerelle') continue;
  const s = parseSeg(segKey);
  const ec = edgeCorners(s.q1, s.r1, s.q2, s.r2);
  if (!ec) continue;
  const ha = allHexes.get(`${s.q1},${s.r1}`), hb = allHexes.get(`${s.q2},${s.r2}`);
  if (type === 'passerelle' && ((ha && ha.terrain === 'building') || (hb && hb.terrain === 'building'))) {
    gateways.push({ ...s, a: ec[0], b: ec[1] });
    continue;
  }
  streamEdges.push({ ...s, a: ec[0], b: ec[1], type });
  streamCornerKeys.add(getCornerKey(ec[0].x, ec[0].z));
  streamCornerKeys.add(getCornerKey(ec[1].x, ec[1].z));
  if (type === 'passerelle') footbridges.push({ ...s, a: ec[0], b: ec[1] });
}

// --- Road network mask: smooth dirt paths through road hexes instead of hex-shaped tiles ---
const ROAD_PX = 16;
const roadBounds = new THREE.Vector4(bx0 - 8, bz0 - 8, bx1 - bx0 + 16, bz1 - bz0 + 16);
const roadCanvas = document.createElement('canvas');
roadCanvas.width = Math.ceil(roadBounds.z * ROAD_PX);
roadCanvas.height = Math.ceil(roadBounds.w * ROAD_PX);
let roadPixels;
{
  const ctx = roadCanvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, roadCanvas.width, roadCanvas.height);
  const P = (p) => [(p.x - roadBounds.x) * ROAD_PX, (p.z - roadBounds.y) * ROAD_PX];
  const pathSet = new Set(decor.paths || []);
  const isRoadLike = (h) => h && (h.terrain === 'road' || h.terrain === 'bridge' || pathSet.has(`${h.q},${h.r}`));
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.68 * ROAD_PX;
  ctx.filter = `blur(${(0.09 * ROAD_PX).toFixed(1)}px)`;
  for (const h of allHexes.values()) {
    if (!isRoadLike(h)) continue;
    const c = hexToWorld(h.q, h.r);
    const nb = [];
    let open = null;
    for (const [dq, dr] of HEX_DIRS) {
      const n = allHexes.get(`${h.q + dq},${h.r + dr}`);
      const np = hexToWorld(h.q + dq, h.r + dr);
      if (isRoadLike(n)) nb.push({ x: (c.x + np.x) / 2, z: (c.z + np.z) / 2 });
      else if (!n) open = np;
    }
    ctx.beginPath();
    if (nb.length === 2) {
      ctx.moveTo(...P(nb[0]));
      ctx.quadraticCurveTo(...P(c), ...P(nb[1]));
    } else {
      for (const m of nb) { ctx.moveTo(...P(c)); ctx.lineTo(...P(m)); }
      if (nb.length === 0) { ctx.moveTo(...P(c)); ctx.lineTo(...P({ x: c.x + 0.01, z: c.z })); }
    }
    if (open && nb.length <= 1) {
      const dir = nb.length ? { x: c.x - nb[0].x, z: c.z - nb[0].z } : { x: open.x - c.x, z: open.z - c.z };
      const l = Math.hypot(dir.x, dir.z) || 1;
      ctx.moveTo(...P(c));
      ctx.lineTo(...P({ x: c.x + dir.x / l * 7, z: c.z + dir.z / l * 7 }));
    }
    ctx.stroke();
  }
  roadPixels = ctx.getImageData(0, 0, roadCanvas.width, roadCanvas.height).data;
}
const roadTex = new THREE.CanvasTexture(roadCanvas);
roadTex.colorSpace = THREE.NoColorSpace;
roadTex.flipY = false;
roadTex.wrapS = roadTex.wrapT = THREE.ClampToEdgeWrapping;
roadTex.anisotropy = 4;
function roadAt(x, z) {
  const i = Math.floor((x - roadBounds.x) * ROAD_PX), j = Math.floor((z - roadBounds.y) * ROAD_PX);
  if (i < 0 || j < 0 || i >= roadCanvas.width || j >= roadCanvas.height) return 0;
  return roadPixels[(j * roadCanvas.width + i) * 4] / 255;
}

await setProgress(25, 'Building terrain...');

// --- Terrain material (shared by board and surroundings) ---
const terrainUniforms = { uGrid: { value: 0.11 } };
function makeTerrainMaterial({ grid = false, snow = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0.0, envMapIntensity: 0.6 });
  patchLit(mat, {}, (shader) => {
    for (let i = 0; i < terrainTextures.length; i++) shader.uniforms['uTex' + i] = { value: terrainTextures[i] };
    shader.uniforms.uGrid = terrainUniforms.uGrid;
    shader.uniforms.uRoadMask = { value: roadTex };
    shader.uniforms.uOverlay = G.uOverlay;
    shader.uniforms.uOverlayBounds = G.uOverlayBounds;
    shader.uniforms.uRoadBounds = { value: roadBounds };
    const defs = (grid ? '#define GRID\n' : '') + (snow ? '#define SNOW\n' : '');
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute vec3 terrainBlendIds;
      attribute vec3 terrainBlendWeights;
      varying vec3 vBlendIds;
      varying vec3 vBlendWeights;
      varying vec3 vWN;`);
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      vWN = normalize( mat3( modelMatrix ) * objectNormal );
      vBlendIds = terrainBlendIds;
      vBlendWeights = terrainBlendWeights;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `${defs}#include <common>
      uniform sampler2D uTex0, uTex1, uTex2, uTex3, uTex4, uTex5;
      uniform float uGrid;
      uniform sampler2D uRoadMask;
      uniform vec4 uRoadBounds;
      uniform sampler2D uOverlay;
      uniform vec4 uOverlayBounds;
      varying vec3 vBlendIds;
      varying vec3 vBlendWeights;
      varying vec3 vWN;
      vec3 tSample( int idx, vec2 uv ) {
        if ( idx <= 0 ) return texture2D( uTex0, uv ).rgb;
        else if ( idx == 1 ) return texture2D( uTex1, uv ).rgb;
        else if ( idx == 2 ) return texture2D( uTex2, uv ).rgb;
        else if ( idx == 3 ) return texture2D( uTex3, uv ).rgb;
        else if ( idx == 4 ) return texture2D( uTex4, uv ).rgb;
        return texture2D( uTex5, uv ).rgb;
      }
      vec3 tSampleG( int idx, vec2 uv, vec2 dx, vec2 dy ) {
        if ( idx <= 0 ) return textureGrad( uTex0, uv, dx, dy ).rgb;
        else if ( idx == 1 ) return textureGrad( uTex1, uv, dx, dy ).rgb;
        else if ( idx == 2 ) return textureGrad( uTex2, uv, dx, dy ).rgb;
        else if ( idx == 3 ) return textureGrad( uTex3, uv, dx, dy ).rgb;
        else if ( idx == 4 ) return textureGrad( uTex4, uv, dx, dy ).rgb;
        return textureGrad( uTex5, uv, dx, dy ).rgb;
      }
      vec2 gOffA, gOffB, gDx, gDy;
      float gBn, gFar;
      // Anti-tiling: two copies of the texture with region-dependent offsets, blended by low-frequency noise,
      // plus a rotated large-scale copy that takes over with distance
      vec3 tLayer( int idx, vec2 uvA, vec2 uvB, float m ) {
        vec3 a = tSampleG( idx, uvA + gOffA, gDx, gDy );
        vec3 b = tSampleG( idx, uvA + gOffB, gDx, gDy );
        vec3 nearC = mix( a, b, gBn );
        return mix( nearC, tSample( idx, uvB ), clamp( m * 0.5 + gFar, 0.0, 0.85 ) );
      }
      vec3 rockTriplanar( vec3 p, vec3 n ) {
        vec3 bf = pow( abs( n ), vec3( 4.0 ) );
        bf /= ( bf.x + bf.y + bf.z );
        float sc = ${(TEX_UV_SCALE * 0.9).toFixed(3)};
        return texture2D( uTex4, p.zy * sc ).rgb * bf.x + texture2D( uTex4, p.xz * sc ).rgb * bf.y + texture2D( uTex4, p.xy * sc ).rgb * bf.z;
      }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 wN = normalize( vWN );
        vec2 uvA = vPWorld.xz * ${TEX_UV_SCALE.toFixed(3)};
        vec2 uvB = mat2( 0.8, -0.6, 0.6, 0.8 ) * vPWorld.xz * ${(TEX_UV_SCALE * 0.31).toFixed(4)} + vec2( 0.31, 0.17 );
        float m = 0.3 + 0.4 * texture2D( uNoise, vPWorld.xz * 0.021 ).a;
        {
          float kN = texture2D( uNoise, vPWorld.xz * 0.043 ).r * 8.0;
          float iA = floor( kN );
          gOffA = sin( vec2( 3.0, 7.0 ) * iA );
          gOffB = sin( vec2( 3.0, 7.0 ) * ( iA + 1.0 ) );
          gBn = smoothstep( 0.2, 0.8, fract( kN ) );
          gDx = dFdx( uvA );
          gDy = dFdy( uvA );
          gFar = 0.45 * smoothstep( 18.0, 70.0, distance( cameraPosition, vPWorld ) );
        }
        int id0 = int( vBlendIds.x + 0.5 );
        int id1 = int( vBlendIds.y + 0.5 );
        int id2 = int( vBlendIds.z + 0.5 );
        vec3 tex = tLayer( id0, uvA, uvB, m ) * vBlendWeights.x;
        if ( vBlendWeights.y > 0.001 ) tex += tLayer( id1, uvA, uvB, m ) * vBlendWeights.y;
        if ( vBlendWeights.z > 0.001 ) tex += tLayer( id2, uvA, uvB, m ) * vBlendWeights.z;
        float macro = texture2D( uNoise, vPWorld.xz * 0.011 ).g;
        float micro = texture2D( uNoise, vPWorld.xz * 0.083 ).b;
        vec3 albedo = diffuseColor.rgb * tex * 2.0;
        albedo *= ( 0.8 + 0.4 * macro ) * ( 0.92 + 0.16 * micro );
        albedo *= mix( 1.0, 0.82 + 0.36 * texture2D( uNoise, vPWorld.xz * 0.0045 ).a, gFar * 2.0 );
        {
          float road = texture2D( uRoadMask, ( vPWorld.xz - uRoadBounds.xy ) / uRoadBounds.zw ).r;
          float rm = smoothstep( 0.32, 0.62, road + ( micro - 0.5 ) * 0.35 + ( macro - 0.5 ) * 0.1 );
          if ( rm > 0.001 ) {
            vec3 dirt = tLayer( 2, uvA, uvB, m ) * vec3( 0.4, 0.335, 0.255 ) * 2.0 * ( 0.85 + 0.3 * macro );
            dirt *= 1.0 - 0.18 * smoothstep( 0.55, 0.7, road ) * ( 1.0 - smoothstep( 0.8, 0.95, road ) );
            albedo = mix( albedo, dirt, rm );
          }
        }
        // facet normal: smoothed vertex normals hide steep wedges (a hex top dropping to a cliff end), the facet does not
        vec3 fN = normalize( cross( dFdx( vPWorld ), dFdy( vPWorld ) ) );
        if ( dot( fN, wN ) < 0.0 ) fN = -fN;
        float upN = min( wN.y, fN.y );
        vec3 rN = fN.y < wN.y ? fN : wN;
        float along = dot( vPWorld.xz, vec2( 0.83, 0.57 ) );
        float strata = texture2D( uNoise, vec2( vPWorld.y * 0.21 + texture2D( uNoise, vec2( along * 0.05, 0.3 ) ).r * 0.12, along * 0.013 ) ).r;
        float steep = smoothstep( 0.34, 0.55, 1.0 - upN );
        if ( steep > 0.001 ) {
          vec3 rt0 = rockTriplanar( vPWorld, rN );
          vec3 rock = mix( vec3( dot( rt0, vec3( 0.3, 0.55, 0.15 ) ) ), rt0, 0.45 ) * vec3( 1.2, 0.96, 0.7 ) * 0.95;
          rock *= 0.82 + 0.3 * smoothstep( 0.3, 0.7, strata );
          #ifdef SNOW
            vec3 rockFar = rockTriplanar( vPWorld * 0.18, wN ) * vec3( 0.95, 0.9, 0.84 ) * 1.6;
            rock = mix( rock, rockFar, smoothstep( 20.0, 70.0, distance( cameraPosition, vPWorld ) ) );
            rock = mix( rock, vec3( dot( rock, vec3( 0.3, 0.55, 0.15 ) ) ) * vec3( 0.92, 0.95, 1.0 ), 0.6 );
          #endif
          rock *= 0.85 + 0.3 * macro;
          albedo = mix( albedo, rock, steep );
        }
        // cliff faces (their own mesh, third blend weight < 0): warm grey-brown rock with strata, vertical cracks,
        // moss on ledges; vertex colours carry the mossy lip, the wet foot and the recesses
        float cliffK = step( vBlendWeights.z, -0.5 );
        if ( cliffK > 0.5 ) {
          vec3 rt = rockTriplanar( vPWorld, wN );
          float lum = dot( rt, vec3( 0.3, 0.55, 0.15 ) );
          vec3 rock = mix( vec3( lum ), rt, 0.4 ) * vec3( 1.2, 1.02, 0.8 ) * 1.95;
          rock *= 0.8 + 0.34 * smoothstep( 0.3, 0.7, strata );
          float crack = texture2D( uNoise, vec2( along * 0.37, vPWorld.y * 0.035 ) ).g;
          rock *= 1.0 - 0.38 * smoothstep( 0.68, 0.82, crack ) * ( 1.0 - smoothstep( 0.82, 0.9, crack ) );
          rock *= 0.9 + 0.2 * macro;
          vec3 cliffC = rock * diffuseColor.rgb;
          float ledgeUp = smoothstep( 0.35, 0.75, wN.y );
          cliffC = mix( cliffC, vec3( 0.2, 0.26, 0.12 ) * ( 0.8 + 0.4 * micro ), ledgeUp * 0.75 );
          albedo = cliffC;
        }
        #ifdef SNOW
          float sn = texture2D( uNoise, vPWorld.xz * 0.027 ).r;
          float snow = smoothstep( 27.0, 33.0, vPWorld.y + ( sn - 0.5 ) * 14.0 ) * ( 1.0 - smoothstep( 0.5, 0.8, 1.0 - wN.y ) );
          albedo = mix( albedo, vec3( 0.86, 0.9, 0.96 ), snow );
        #endif
        #ifdef GRID
          float alpG = 0.0;
          {
            // board mountains: alpine meadow, then scree and rock on the slopes
            float hY = vPWorld.y;
            float nA = texture2D( uNoise, vPWorld.xz * 0.05 ).r;
            float alp = smoothstep( 5.0, 8.5, hY + ( nA - 0.5 ) * 1.8 );
            alpG = alp;
            if ( alp > 0.001 && cliffK < 0.5 ) {
              float slopeK = smoothstep( 0.1, 0.42, 1.0 - wN.y );
              vec3 scree = rockTriplanar( vPWorld, wN ) * vec3( 0.93, 0.91, 0.87 ) * 1.5 * ( 0.85 + 0.3 * macro );
              vec3 meadow = albedo * vec3( 0.92, 0.95, 0.82 );
              albedo = mix( albedo, mix( meadow, scree, clamp( slopeK * 0.9 + alp * 0.35, 0.0, 1.0 ) ), alp );
            }
          }
          vec2 p = vPWorld.xz;
          float qf = 2.0 / 3.0 * p.x;
          float rf = -1.0 / 3.0 * p.x + 0.57735027 * p.y;
          vec3 cu = vec3( qf, rf, -qf - rf );
          vec3 rc = floor( cu + 0.5 );
          vec3 dd = abs( rc - cu );
          if ( dd.x > dd.y && dd.x > dd.z ) rc.x = -rc.y - rc.z;
          else if ( dd.y > dd.z ) rc.y = -rc.x - rc.z;
          vec2 hc = vec2( 1.5 * rc.x, 0.8660254 * rc.x + 1.7320508 * rc.y );
          vec2 lp = p - hc;
          float e = max( max( abs( dot( lp, vec2( 0.8660254, 0.5 ) ) ), abs( lp.y ) ), abs( dot( lp, vec2( -0.8660254, 0.5 ) ) ) );
          float ed = 0.8660254 - e;
          float fw = fwidth( ed );
          float line = 1.0 - smoothstep( 0.008, 0.008 + fw * 1.5, ed );
          float camD = distance( cameraPosition, vPWorld );
          float gfade = uGrid * ( 1.0 - smoothstep( 60.0, 150.0, camD ) ) * ( 1.0 - 0.6 * alpG ) * ( 1.0 - cliffK ) * ( 1.0 - 0.7 * steep );
          albedo = mix( albedo, vec3( 1.0, 0.96, 0.82 ) * 0.85, line * gfade );
          vec4 ovc = texture2D( uOverlay, ( vPWorld.xz - uOverlayBounds.xy ) / uOverlayBounds.zw );
          albedo = mix( albedo, ovc.rgb * 1.3, ovc.a );
        #endif
        diffuseColor.rgb = albedo;
      }`);
  }, `terrain:${grid}:${snow}`);
  return mat;
}

// --- Unified board terrain mesh with inner-ring height transitions ---
let boardGeo, boardMesh;
const cornerHeights = new Map();
{
  const positions = [];
  const colors = [];
  const indices = [];
  const tBlendIds = [];
  const tBlendWeights = [];
  const vertexMap = new Map();
  const centerMap = new Map();
  const hexCorners = new Map();
  const cliffPos = [], cliffCol = [], cliffIdx = [];

  function addVertex(x, y, z, color, blendIds, blendWeights) {
    const idx = positions.length / 3;
    positions.push(x, y, z);
    colors.push(color.r, color.g, color.b);
    tBlendIds.push(blendIds[0], blendIds[1], blendIds[2]);
    tBlendWeights.push(blendWeights[0], blendWeights[1], blendWeights[2]);
    return idx;
  }

  // Terrain under a wall-walk hex is sunk below the lowest walk around it (the wall's mass hides it): the walk, which
  // climbs from hex centre to hex centre, then never has rock showing through it.
  const sunk = new Map();
  for (const k of rampartSet) {
    const h = allHexes.get(k);
    if (!h) continue;
    let m = effH(h);
    for (const [dq, dr] of HEX_DIRS) { const nk = `${h.q + dq},${h.r + dr}`; if (rampartSet.has(nk)) m = Math.min(m, effH(allHexes.get(nk))); }
    sunk.set(k, m - 0.3);
  }
  const surfH = (h) => { const v = sunk.get(`${h.q},${h.r}`); return v === undefined ? effH(h) : v; };

  // Step 1: per-edge transition widths
  const hexInfo = new Map();
  for (const [key, hex] of allHexes) {
    let needsRing = false;
    const edgeTransitions = [0, 0, 0, 0, 0, 0];
    const hexH = surfH(hex);
    for (let i = 0; i < 6; i++) {
      const [dq, dr] = HEX_DIRS[i];
      const nq = hex.q + dq, nr = hex.r + dr;
      const neighbor = allHexes.get(`${nq},${nr}`);
      const geoEdge = DIR_TO_GEO_EDGE[i];
      if (!neighbor) {
        needsRing = true;
        edgeTransitions[geoEdge] = 0.55;
      } else if (Math.abs(hexH - surfH(neighbor)) > 0.01) {
        needsRing = true;
        // cliffs are drawn as vertical rock faces on the edge itself (no band); a one-level step is a gentle slope
        edgeTransitions[geoEdge] = isVerticalEdge(hex.q, hex.r, nq, nr) ? 0 : 0.7;
      }
    }
    const wp = hexToWorld(hex.q, hex.r);
    for (let c = 0; c < 6; c++) {
      const cc = hexCorner(wp.x, wp.z, c);
      if (!streamCornerKeys.has(getCornerKey(cc.x, cc.z))) continue;
      needsRing = true;
      edgeTransitions[(c + 5) % 6] = Math.max(edgeTransitions[(c + 5) % 6], 0.36);
      edgeTransitions[c] = Math.max(edgeTransitions[c], 0.36);
    }
    hexInfo.set(key, { needsRing, edgeTransitions });
  }

  // Step 2: center vertices
  for (const [key, hex] of allHexes) {
    const wp = hexToWorld(hex.q, hex.r);
    const ti = hexTex(hex);
    centerMap.set(key, addVertex(wp.x, surfH(hex), wp.z, hexColor(hex), [ti, ti, ti], [1, 0, 0]));
  }

  // Step 3/4: shared corners + inner rings
  const waterColor = new THREE.Color(VT_STYLE.water.color);
  for (const [key, hex] of allHexes) {
    const centerIdx = centerMap.get(key);
    const wp = hexToWorld(hex.q, hex.r);
    const hexY = surfH(hex);
    const info = hexInfo.get(key);
    const myColor = hexColor(hex);
    const myTi = hexTex(hex);

    const cornerIndices = [];
    for (let i = 0; i < 6; i++) {
      const cc = hexCorner(wp.x, wp.z, i);
      const cornerKey = getCornerKey(cc.x, cc.z);
      // The hexes meeting at this corner, split into groups joined by walkable edges (a cliff separates groups):
      // each group gets its own vertex, so a cliff is a clean vertical step and the ground on either side stays flat.
      const neighborOffsets = CORNER_NEIGHBORS[i];
      const members = [hex];
      for (const [dq, dr] of neighborOffsets) {
        const neighbor = allHexes.get(`${hex.q + dq},${hex.r + dr}`);
        if (neighbor) members.push(neighbor);
      }
      // around the end of a cliff only hexes on the same level share the corner: the rock face then wraps around the
      // corner and tapers out along the next edge, instead of the upper hex top dropping to the foot in a steep wedge
      let cliffCorner = false;
      for (let x = 0; x < members.length && !cliffCorner; x++) for (let y = x + 1; y < members.length; y++) if (isVerticalEdge(members[x].q, members[x].r, members[y].q, members[y].r)) { cliffCorner = true; break; }
      const linked = (a, b) => {
        if (isVerticalEdge(a.q, a.r, b.q, b.r)) return false;
        if (!cliffCorner) return true;
        // a one-level step splits (a small rock face tapers out along it); ramps and same-level ground stay joined
        const dh = Math.abs(surfH(a) - surfH(b));
        return dh < 0.5 || dh > 1.5 || getRuleSegType(a.q, a.r, b.q, b.r) === 'rampe';
      };
      const group = [hex];
      for (let pass = 0; pass < 2; pass++) for (const m of members) if (!group.includes(m) && group.some((g) => linked(g, m))) group.push(m);
      const sig = cornerKey + '#' + group.map((g) => `${g.q},${g.r}`).sort().join(';');
      if (vertexMap.has(sig)) { cornerIndices.push(vertexMap.get(sig)); continue; }

      const blendColors = group.map((g) => (g === hex ? myColor : hexColor(g)));
      const cornerTerrains = group.map((g) => (g === hex ? myTi : hexTex(g)));
      // height: the level shared by most of the group (two same-level hexes keep a flat common edge), else the mean
      const hs = group.map(surfH);
      let cornerY = hs.reduce((a, v) => a + v, 0) / hs.length;
      for (const v of hs) if (hs.filter((w) => Math.abs(w - v) < 0.01).length >= 2) { cornerY = v; break; }
      const cornerIsCliff = members.length > group.length;
      const isStream = streamCornerKeys.has(cornerKey);
      {
        // corners under a wall stay just below its walk (the paving is never coplanar with the ground); inside a
        // gate passage they stay at the passage floor
        let walk = rampartSet.has(key) ? hexY : Infinity;
        let gateFloor = gateHexSet.has(key) ? hexY : Infinity;
        for (const m of members) {
          const mk = `${m.q},${m.r}`;
          if (m !== hex && rampartSet.has(mk)) walk = Math.min(walk, surfH(m) - 0.08);
          if (gateHexSet.has(mk)) gateFloor = Math.min(gateFloor, effH(m));
        }
        cornerY = Math.min(cornerY, walk, gateFloor);
      }

      let blended, bIds, bWts;
      if (isStream) {
        cornerY -= STREAM_DEPTH;
        blended = waterColor.clone();
        bIds = [3, 3, 3]; bWts = [1, 0, 0];
      } else {
        blended = new THREE.Color(0, 0, 0);
        for (const c of blendColors) { blended.r += c.r; blended.g += c.g; blended.b += c.b; }
        blended.multiplyScalar(1 / blendColors.length);
        const n = cornerTerrains.length;
        const w = 1 / n;
        bIds = [cornerTerrains[0], cornerTerrains[1 % n], cornerTerrains[2 % n]];
        bWts = n === 1 ? [1, 0, 0] : n === 2 ? [0.5, 0.5, 0] : [w, w, w];
        if (cornerIsCliff) blended.multiplyScalar(Math.max(...members.map(surfH)) - cornerY > 0.9 ? 0.74 : 0.96);
      }
      const vi = addVertex(cc.x, cornerY, cc.z, blended, bIds, bWts);
      vertexMap.set(sig, vi);
      const prevY = cornerHeights.get(cornerKey);
      if (prevY === undefined || cornerY < prevY) cornerHeights.set(cornerKey, cornerY);
      cornerIndices.push(vi);
    }
    hexCorners.set(key, cornerIndices);

    if (!info.needsRing) {
      for (let i = 0; i < 6; i++) indices.push(centerIdx, cornerIndices[(i + 1) % 6], cornerIndices[i]);
    } else {
      const innerIndices = [];
      const et = info.edgeTransitions;
      for (let i = 0; i < 6; i++) {
        const t = Math.max(et[(i + 5) % 6], et[i]);
        const rr = HEX_SIZE * (1 - t);
        const angle = (Math.PI / 3) * i;
        const isCliff = t > 0 && t <= 0.15;
        const bIds = isCliff ? [myTi, 4, myTi] : [myTi, myTi, myTi];
        const bWts = isCliff ? [0.2, 0.8, 0] : [1, 0, 0];
        const vtxColor = isCliff ? new THREE.Color(0.55, 0.5, 0.45) : myColor.clone();
        innerIndices.push(addVertex(wp.x + rr * Math.cos(angle), hexY, wp.z + rr * Math.sin(angle), vtxColor, bIds, bWts));
      }
      for (let i = 0; i < 6; i++) {
        const next = (i + 1) % 6;
        indices.push(centerIdx, innerIndices[next], innerIndices[i]);
        indices.push(innerIndices[i], cornerIndices[next], cornerIndices[i]);
        indices.push(innerIndices[i], innerIndices[next], cornerIndices[next]);
      }
    }
  }

  // Step 5: rock faces on cliff edges, between the two hexes' own corner vertices. They form their own mesh (kept out
  // of the ground heightfield, so units, picking and groundHeight never see the relief of the face): each face is a
  // grid bulged by noise toward the lower hex, with strata ledges, a mossy lip and a dark wet foot; the displacement
  // fades to zero on its border so faces still meet the ground and each other exactly.
  {
    const P = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    const nFace = makeNoise2D(7171), nLedge = makeNoise2D(7272);
    const fortHex = (h) => { const k = `${h.q},${h.r}`; return rampartSet.has(k) || gateHexSet.has(k); };
    for (const [key, hex] of allHexes) {
      const ci = hexCorners.get(key);
      for (let d = 0; d < 3; d++) {
        const [dq, dr] = HEX_DIRS[d];
        const nk = `${hex.q + dq},${hex.r + dr}`;
        const nb = allHexes.get(nk);
        if (!nb) continue;
        const nci = hexCorners.get(nk);
        const g = DIR_TO_GEO_EDGE[d];
        // the same two corners seen from the neighbour: its edge toward us is the opposite one
        const gn = DIR_TO_GEO_EDGE[(d + 3) % 6];
        const a0 = ci[g], a1 = ci[(g + 1) % 6], b0 = nci[(gn + 1) % 6], b1 = nci[gn];
        // faces wherever the two hexes do not share their corners: cliffs, and the tapering ends next to them
        if (a0 === b0 && a1 === b1) continue;
        const ya0 = positions[a0 * 3 + 1], ya1 = positions[a1 * 3 + 1], yb0 = positions[b0 * 3 + 1], yb1 = positions[b1 * 3 + 1];
        if (Math.abs(ya0 - yb0) < 0.02 && Math.abs(ya1 - yb1) < 0.02) continue;
        if ((ya0 - yb0) * (ya1 - yb1) < -1e-4) continue;
        const hiIsA = (ya0 + ya1) >= (yb0 + yb1);
        const [t0, t1, l0, l1] = hiIsA ? [a0, a1, b0, b1] : [b0, b1, a0, a1];
        const lo = hiIsA ? nb : hex, hiH = hiIsA ? hex : nb;
        const pl = hexToWorld(lo.q, lo.r), ph = hexToWorld(hiH.q, hiH.r);
        const T0 = P(t0), T1 = P(t1), L0 = P(l0), L1 = P(l1);
        // horizontal unit vector toward the lower hex
        let ox = pl.x - ph.x, oz = pl.z - ph.z;
        const on = Math.hypot(ox, oz) || 1; ox /= on; oz /= on;
        const ex = T1[0] - T0[0], ez = T1[2] - T0[2];
        const front = ez * (pl.x - ph.x) - ex * (pl.z - ph.z) > 0;
        const maxDrop = Math.max(T0[1] - L0[1], T1[1] - L1[1]);
        // flat faces where something stands against them (stairs, walls, gates)
        const flat = getRuleSegType(hex.q, hex.r, nb.q, nb.r) === 'escalier' || fortHex(hex) || fortHex(nb);
        const cols = 7, rows = Math.max(3, Math.min(16, Math.ceil(maxDrop / 0.16)));
        const base = cliffPos.length / 3;
        for (let c = 0; c <= cols; c++) {
          const sC = c / cols;
          const tx = T0[0] + ex * sC, tz = T0[2] + ez * sC;
          const ty = T0[1] + (T1[1] - T0[1]) * sC, by = L0[1] + (L1[1] - L0[1]) * sC;
          const drop = Math.max(0, ty - by);
          const endK = Math.min(1, sC / 0.2, (1 - sC) / 0.2);
          const endT = endK * endK * (3 - 2 * endK);
          for (let r = 0; r <= rows; r++) {
            const v = r / rows;
            let y = ty + (by - ty) * v;
            let x = tx, z = tz;
            const rowT = Math.pow(Math.sin(Math.PI * v), 0.6);
            let disp = 0;
            if (!flat && drop > 0.05) {
              const amp = Math.min(0.15, 0.05 + 0.06 * drop) * endT * rowT * Math.min(1, drop / 0.6);
              const u = (x * 0.83 + z * 0.57);
              const n1 = nFace(u * 2.3, y * 2.1), n2 = nFace(u * 5.1 + 17, y * 4.7 - 9);
              // strata: ledges that stick out a little, every ~0.45 of height
              const strata = nLedge(y * 2.2 + nFace(u * 0.7, 3) * 0.6, u * 0.15);
              const ledge = strata > 0.25 ? (strata - 0.25) * 1.4 : 0;
              disp = amp * (0.3 + 0.45 * n1 + 0.2 * n2 + 0.6 * ledge);
              x += ox * disp + (ex / (Math.hypot(ex, ez) || 1)) * amp * 0.25 * n2;
              z += oz * disp + (ez / (Math.hypot(ex, ez) || 1)) * amp * 0.25 * n2;
              y += amp * 0.35 * nFace(u * 3.7 - 5, y * 3.1 + 11) * rowT;
            }
            // colour: warm grey-brown rock, moss on the lip, a darker wet foot, recesses darker than bulges
            const shade = 0.88 + 0.12 * nFace(x * 0.9 + 40, z * 0.9 - y * 0.6);
            let cr = 0.52 * shade, cg = 0.47 * shade, cb = 0.4 * shade;
            const lip = 1 - Math.min(1, v / 0.14);
            if (lip > 0) { cr += (0.3 - cr) * lip * 0.75; cg += (0.36 - cg) * lip * 0.75; cb += (0.2 - cb) * lip * 0.75; }
            const foot = Math.max(0, (v - 0.72) / 0.28);
            const footK = 1 - 0.42 * foot * foot;
            const recess = 1 - 0.18 * Math.max(0, -(disp / 0.12));
            cliffPos.push(x, y, z);
            cliffCol.push(cr * footK * recess, cg * footK * recess, cb * footK * recess * 1.03);
          }
        }
        const idx = (c, r) => base + c * (rows + 1) + r;
        for (let c = 0; c < cols; c++) {
          const d0 = (T0[1] + (T1[1] - T0[1]) * (c / cols)) - (L0[1] + (L1[1] - L0[1]) * (c / cols));
          const d1 = (T0[1] + (T1[1] - T0[1]) * ((c + 1) / cols)) - (L0[1] + (L1[1] - L0[1]) * ((c + 1) / cols));
          if (d0 < 0.01 && d1 < 0.01) continue;
          for (let r = 0; r < rows; r++) {
            const A = idx(c, r), B = idx(c + 1, r), C = idx(c + 1, r + 1), D = idx(c, r + 1);
            // (A, B, C): B along the top edge, C below it; winding faces the lower hex
            if (d1 > 0.01) cliffIdx.push(...(front ? [A, B, C] : [A, C, B]));
            if (d0 > 0.01) cliffIdx.push(...(front ? [A, C, D] : [A, D, C]));
          }
        }
      }
    }
  }

  boardGeo = new THREE.BufferGeometry();
  boardGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  boardGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  boardGeo.setAttribute('terrainBlendIds', new THREE.Float32BufferAttribute(tBlendIds, 3));
  boardGeo.setAttribute('terrainBlendWeights', new THREE.Float32BufferAttribute(tBlendWeights, 3));
  boardGeo.setIndex(indices);
  boardGeo.computeVertexNormals();
  {
    // a cliff face closing to a point at one end has a vertex in no real triangle: give it an upward normal (a zero normal
    // turns into NaN in the lighting, which the bloom then spreads over the screen)
    const nrm = boardGeo.attributes.normal.array;
    for (let i = 0; i < nrm.length; i += 3) {
      if (nrm[i] * nrm[i] + nrm[i + 1] * nrm[i + 1] + nrm[i + 2] * nrm[i + 2] < 1e-8) { nrm[i] = 0; nrm[i + 1] = 1; nrm[i + 2] = 0; }
    }
  }
  boardGeo.computeBoundingSphere();

  boardMesh = new THREE.Mesh(boardGeo, makeTerrainMaterial({ grid: true }));
  boardMesh.castShadow = true;
  boardMesh.receiveShadow = true;
  scene.add(boardMesh);

  if (cliffIdx.length) {
    const nV = cliffPos.length / 3;
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cliffPos, 3));
    cg.setAttribute('color', new THREE.Float32BufferAttribute(cliffCol, 3));
    // rock everywhere; a negative third weight marks cliff faces for the terrain shader
    cg.setAttribute('terrainBlendIds', new THREE.Float32BufferAttribute(new Float32Array(nV * 3).fill(4), 3));
    const w = new Float32Array(nV * 3);
    for (let i = 0; i < nV; i++) { w[i * 3] = 1; w[i * 3 + 2] = -1; }
    cg.setAttribute('terrainBlendWeights', new THREE.BufferAttribute(w, 3));
    cg.setIndex(cliffIdx);
    cg.computeVertexNormals();
    // weld normals of vertices at the same place (face borders, corners between faces): rounded shading at the corners
    const pos = cg.attributes.position.array, nrm = cg.attributes.normal.array;
    const acc = new Map();
    for (let i = 0; i < nV; i++) {
      const k = `${Math.round(pos[i * 3] * 200)},${Math.round(pos[i * 3 + 1] * 200)},${Math.round(pos[i * 3 + 2] * 200)}`;
      let a = acc.get(k); if (!a) { a = [0, 0, 0, []]; acc.set(k, a); }
      a[0] += nrm[i * 3]; a[1] += nrm[i * 3 + 1]; a[2] += nrm[i * 3 + 2]; a[3].push(i);
    }
    for (const a of acc.values()) {
      let [x, y, z] = a; const l = Math.hypot(x, y, z);
      if (l < 1e-6) { x = 0; y = 1; z = 0; } else { x /= l; y /= l; z /= l; }
      for (const i of a[3]) { nrm[i * 3] = x; nrm[i * 3 + 1] = y; nrm[i * 3 + 2] = z; }
    }
    cg.computeBoundingSphere();
    const cliffMesh = new THREE.Mesh(cg, boardMesh.material);
    cliffMesh.castShadow = true;
    cliffMesh.receiveShadow = true;
    scene.add(cliffMesh);
  }
}

// --- Heightfields (CPU) ---
function makeHF(x0, z0, w, h, res) {
  const nx = Math.ceil(w / res) + 1, nz = Math.ceil(h / res) + 1;
  return { x0, z0, res, nx, nz, data: new Float32Array(nx * nz).fill(NaN) };
}
function rasterize(hf, pos, idx) {
  const { x0, z0, res, nx, nz, data } = hf;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = (pos[a] - x0) / res, az = (pos[a + 2] - z0) / res, ay = pos[a + 1];
    const bxx = (pos[b] - x0) / res, bzz = (pos[b + 2] - z0) / res, by = pos[b + 1];
    const cx = (pos[c] - x0) / res, cz = (pos[c + 2] - z0) / res, cy = pos[c + 1];
    const den = (bzz - cz) * (ax - cx) + (cx - bxx) * (az - cz);
    if (Math.abs(den) < 1e-12) continue;
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bxx, cx))), i1 = Math.min(nx - 1, Math.floor(Math.max(ax, bxx, cx)));
    const j0 = Math.max(0, Math.ceil(Math.min(az, bzz, cz))), j1 = Math.min(nz - 1, Math.floor(Math.max(az, bzz, cz)));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const w1 = ((bzz - cz) * (i - cx) + (cx - bxx) * (j - cz)) / den;
        const w2 = ((cz - az) * (i - cx) + (ax - cx) * (j - cz)) / den;
        const w3 = 1 - w1 - w2;
        if (w1 < -1e-5 || w2 < -1e-5 || w3 < -1e-5) continue;
        data[j * nx + i] = w1 * ay + w2 * by + w3 * cy;
      }
    }
  }
}
function sampleHF(hf, x, z) {
  const fx = (x - hf.x0) / hf.res, fz = (z - hf.z0) / hf.res;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= hf.nx - 1 || j >= hf.nz - 1) return NaN;
  const tx = fx - i, tz = fz - j, d = hf.data, n = hf.nx;
  const a = d[j * n + i], b = d[j * n + i + 1], c = d[(j + 1) * n + i], e = d[(j + 1) * n + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + e * tx) * tz;
}

const boardHF = makeHF(bx0 - 1, bz0 - 1, bx1 - bx0 + 2, bz1 - bz0 + 2, 0.08);
rasterize(boardHF, boardGeo.attributes.position.array, boardGeo.index.array);
const boardHeight = (x, z) => sampleHF(boardHF, x, z);

await setProgress(35, 'Carving river valleys...');

// --- River exits → valley channels in the surroundings ---
const channels = [];
{
  const keyOf = (h) => `${h.q},${h.r}`;
  const edgeRiver = [];
  for (const h of allHexes.values()) {
    if (h.terrain !== 'river') continue;
    if (HEX_DIRS.some(([dq, dr]) => !allHexes.has(`${h.q + dq},${h.r + dr}`))) edgeRiver.push(h);
  }
  const edgeSet = new Set(edgeRiver.map(keyOf));
  const seen = new Set();
  let seed = 900;
  for (const h of edgeRiver) {
    if (seen.has(keyOf(h))) continue;
    const group = [];
    const queue = [h];
    seen.add(keyOf(h));
    while (queue.length) {
      const g = queue.shift();
      group.push(g);
      for (const [dq, dr] of HEX_DIRS) {
        const k = `${g.q + dq},${g.r + dr}`;
        if (edgeSet.has(k) && !seen.has(k)) { seen.add(k); queue.push(allHexes.get(k)); }
      }
    }
    let sx = 0, sz = 0;
    for (const g of group) { const p = hexToWorld(g.q, g.r); sx += p.x; sz += p.z; }
    sx /= group.length; sz /= group.length;
    const [, dx, dz] = [[sx - bx0, -1, 0], [bx1 - sx, 1, 0], [sz - bz0, 0, -1], [bz1 - sz, 0, 1]].sort((a, b) => a[0] - b[0])[0];
    const n = makeNoise2D(seed++);
    const pts = [[sx - dx * 2, sz - dz * 2]];
    let x = sx, z = sz;
    const base = Math.atan2(dz, dx);
    for (let k = 0; k < 110; k++) {
      const ang = base + n(k * 0.06, 0.37) * 0.85 * smoothstep(0, 6, k);
      x += Math.cos(ang) * 3; z += Math.sin(ang) * 3;
      pts.push([x, z]);
    }
    const segs = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
      segs.push({ ax, az, bx, bz, w0: 0.9 + k * 0.03, w1: 0.9 + (k + 1) * 0.03 });
    }
    const chunks = [];
    for (let k = 0; k < segs.length; k += 10) {
      const part = segs.slice(k, k + 10);
      let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
      for (const s of part) {
        mnx = Math.min(mnx, s.ax, s.bx); mxx = Math.max(mxx, s.ax, s.bx);
        mnz = Math.min(mnz, s.az, s.bz); mxz = Math.max(mxz, s.az, s.bz);
      }
      chunks.push({ segs: part, mnx: mnx - 60, mxx: mxx + 60, mnz: mnz - 60, mxz: mxz + 60 });
    }
    channels.push({ chunks });
  }
}
function riverInfo(x, z) {
  let best = Infinity, bw = 1;
  for (const ch of channels) {
    for (const c of ch.chunks) {
      if (x < c.mnx || x > c.mxx || z < c.mnz || z > c.mxz) continue;
      for (const s of c.segs) {
        const vx = s.bx - s.ax, vz = s.bz - s.az;
        const t = Math.max(0, Math.min(1, ((x - s.ax) * vx + (z - s.az) * vz) / (vx * vx + vz * vz)));
        const dx = x - (s.ax + vx * t), dz = z - (s.az + vz * t);
        const d = dx * dx + dz * dz;
        if (d < best) { best = d; bw = s.w0 + (s.w1 - s.w0) * t; }
      }
    }
  }
  return best === Infinity ? null : { dist: Math.sqrt(best), w: bw };
}

await setProgress(42, 'Raising mountains...');

// --- Surrounding landscape ---
const nHill = makeNoise2D(101), nMtn = makeNoise2D(202), nWarp = makeNoise2D(303), nDet = makeNoise2D(404), nForest = makeNoise2D(505);
function nominalHeight(x, z) {
  const qf = 2 / 3 * x, rf = -1 / 3 * x + sqrt3 / 3 * z;
  let rq = Math.round(qf), rr = Math.round(rf), rs = Math.round(-qf - rf);
  const dq = Math.abs(rq - qf), dr = Math.abs(rr - rf), ds = Math.abs(rs + qf + rf);
  if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
  const h = allHexes.get(`${rq},${rr}`);
  return h ? h.height * HEX_HEIGHT_STEP : NaN;
}
function edgeHeight(x, z) {
  const clampX = (v) => Math.min(bx1 - 1.1, Math.max(bx0 + 1.1, v));
  const clampZ = (v) => Math.min(bz1 - 1.1, Math.max(bz0 + 1.1, v));
  const cx = clampX(x), cz = clampZ(z);
  const alongX = cx === x;
  let sum = 0, n = 0;
  for (let k = -3; k <= 3; k++) {
    const h = nominalHeight(alongX ? clampX(cx + k * 0.9) : cx, alongX ? cz : clampZ(cz + k * 0.9));
    if (!Number.isNaN(h)) { sum += h; n++; }
  }
  return n ? sum / n : 1;
}
function forestMask(x, z) {
  return fbm2(nForest, x * 0.04, z * 0.04, 3) + fbm2(nForest, x * 0.15 + 50, z * 0.15, 2) * 0.25;
}
function surroundHeight(x, z) {
  const dx = Math.max(0, bx0 - x, x - bx1), dz = Math.max(0, bz0 - z, z - bz1);
  const d = Math.max(0.4, Math.hypot(dx, dz));
  const edge = edgeHeight(x, z);
  const wx = x + fbm2(nWarp, x * 0.008, z * 0.008, 3) * 30;
  const wz = z + fbm2(nWarp, x * 0.008 + 17.3, z * 0.008 - 9.1, 3) * 30;
  const hills = fbm2(nHill, wx * 0.028, wz * 0.028, 4);
  const envl = fbm2(nHill, x * 0.004 + 3.1, z * 0.004 - 1.7, 3) * 0.5 + 0.5;
  const mtn = Math.pow(ridged2(nMtn, wx * 0.0055, wz * 0.0055, 5), 1.25) * (40 + 48 * envl);
  const det = fbm2(nDet, x * 0.18, z * 0.18, 3);
  const t1 = smoothstep(0, 12, d);
  const t2 = smoothstep(14, 110, d);
  const riv = riverInfo(x, z);
  const valley = riv ? smoothstep(riv.w + 1, riv.w + 40, riv.dist) : 1;
  let h = edge
    + t1 * (0.8 + hills * 1.6 + d * 0.03) * (0.35 + 0.65 * valley)
    + Math.pow(t2, 1.5) * (mtn + hills * 8 + 4) * (0.2 + 0.8 * valley)
    + det * 0.22 * t1;
  if (riv) {
    const s = smoothstep(riv.w * 0.5, riv.w + 2.2 + d * 0.015, riv.dist);
    h = lerp(RIVERBED_HEIGHT - 0.25, h, s);
  }
  return h;
}

const SUR = { half: 380, n: 400, a: 0.25 };
const SN = SUR.n + 1;
const sAxis = new Float32Array(SN);
for (let i = 0; i < SN; i++) { const u = i / SUR.n * 2 - 1; sAxis[i] = SUR.half * (SUR.a * u + (1 - SUR.a) * u * u * u); }
let surGeo;
{
  const count = SN * SN;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const bIds = new Float32Array(count * 3);
  const bW = new Float32Array(count * 3);
  const covered = new Uint8Array(count);
  for (let j = 0; j < SN; j++) {
    for (let i = 0; i < SN; i++) {
      const k = j * SN + i;
      const x = BCX + sAxis[i], z = BCZ + sAxis[j];
      const bh = boardHeight(x, z);
      let h;
      if (!Number.isNaN(bh)) { h = bh - 0.06; covered[k] = 1; }
      else h = surroundHeight(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    }
  }
  const idx = [];
  for (let j = 0; j < SUR.n; j++) {
    for (let i = 0; i < SUR.n; i++) {
      const a = j * SN + i, b = a + 1, c = a + SN, d = c + 1;
      if (covered[a] && covered[b] && covered[c] && covered[d]) continue;
      idx.push(a, c, b, b, c, d);
    }
  }
  surGeo = new THREE.BufferGeometry();
  surGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  surGeo.setIndex(idx);
  surGeo.computeVertexNormals();
  const nor = surGeo.attributes.normal.array;
  const grassA = new THREE.Color(0x7c9a46), grassB = new THREE.Color(0x9da957), alpine = new THREE.Color(0x6d7f4a);
  const c = new THREE.Color();
  for (let k = 0; k < count; k++) {
    const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
    const ny = nor[k * 3 + 1];
    const fm = smoothstep(0.05, 0.3, forestMask(x, z)) * (1 - smoothstep(16, 26, y));
    const rock = Math.min(1, smoothstep(14, 30, y) + smoothstep(0.82, 0.6, ny) * 0.7);
    const tone = fbm2(nDet, x * 0.02, z * 0.02, 2) * 0.5 + 0.5;
    c.copy(grassA).lerp(grassB, tone).lerp(alpine, smoothstep(6, 20, y));
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    const wr = rock, wf = fm * (1 - rock), wg = Math.max(0, 1 - wr - wf);
    const s = wg + wf + wr;
    bIds[k * 3] = 0; bIds[k * 3 + 1] = 1; bIds[k * 3 + 2] = 3;
    bW[k * 3] = wg / s; bW[k * 3 + 1] = wf / s; bW[k * 3 + 2] = wr / s;
  }
  surGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  surGeo.setAttribute('terrainBlendIds', new THREE.BufferAttribute(bIds, 3));
  surGeo.setAttribute('terrainBlendWeights', new THREE.BufferAttribute(bW, 3));
  surGeo.computeBoundingSphere();
  const surMesh = new THREE.Mesh(surGeo, makeTerrainMaterial({ snow: true }));
  surMesh.castShadow = true;
  surMesh.receiveShadow = true;
  scene.add(surMesh);
}

await setProgress(52, 'Baking heightfields...');

// Coarse global heightfield (surroundings + board) and fine board heightfield: water depth + placement
const COARSE_N = 2048;
const coarseHF = makeHF(BCX - SUR.half, BCZ - SUR.half, SUR.half * 2, SUR.half * 2, (SUR.half * 2) / (COARSE_N - 1));
rasterize(coarseHF, surGeo.attributes.position.array, surGeo.index.array);
rasterize(coarseHF, boardGeo.attributes.position.array, boardGeo.index.array);
for (let i = 0; i < boardHF.data.length; i++) {
  if (Number.isNaN(boardHF.data[i])) {
    const x = boardHF.x0 + (i % boardHF.nx) * boardHF.res, z = boardHF.z0 + Math.floor(i / boardHF.nx) * boardHF.res;
    const v = sampleHF(coarseHF, x, z);
    boardHF.data[i] = Number.isNaN(v) ? -3 : v;
  }
}
const groundHeight = (x, z) => {
  const b = sampleHF(boardHF, x, z);
  if (!Number.isNaN(b)) return b;
  const c = sampleHF(coarseHF, x, z);
  return Number.isNaN(c) ? 0 : c;
};
function hfTexture(hf) {
  const half = new Uint16Array(hf.data.length);
  for (let i = 0; i < hf.data.length; i++) {
    const v = hf.data[i];
    half[i] = THREE.DataUtils.toHalfFloat(Number.isNaN(v) ? -3 : v);
  }
  const t = new THREE.DataTexture(half, hf.nx, hf.nz, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
const fineTex = hfTexture(boardHF);
const coarseTex = hfTexture(coarseHF);
const fineBounds = new THREE.Vector4(boardHF.x0, boardHF.z0, (boardHF.nx - 1) * boardHF.res, (boardHF.nz - 1) * boardHF.res);
const coarseBounds = new THREE.Vector4(coarseHF.x0, coarseHF.z0, (coarseHF.nx - 1) * coarseHF.res, (coarseHF.nz - 1) * coarseHF.res);

await setProgress(58, 'Lighting the sky...');

// --- Sky, sun, environment ---
const sky = new Sky();
sky.scale.setScalar(1000);
sky.material.uniforms.uHorizonColor = { value: FOG_COLOR.clone() };
sky.material.uniforms.uHorizonMix = { value: 1.0 };
sky.material.uniforms.uDarkSky = { value: 0 };
sky.material.fragmentShader = sky.material.fragmentShader
  .replace('void main() {', 'uniform vec3 uHorizonColor;\nuniform float uHorizonMix;\nuniform float uDarkSky;\nvoid main() {')
  .replace('gl_FragColor = vec4( retColor, 1.0 );', `
    float hz = 1.0 - smoothstep( -0.03, 0.22, direction.y );
    retColor = mix( retColor, uHorizonColor, hz * hz * uHorizonMix );
    retColor = mix( retColor, min( retColor, vec3( 1.0 ) ) * 0.045 + vec3( 0.003, 0.004, 0.007 ), uDarkSky );
    gl_FragColor = vec4( retColor, 1.0 );`);
scene.add(sky);
const clouds = createCloudLayer();
scene.add(clouds);
const stars = createStars();
const moon = createMoon();
scene.add(stars, moon);
const MOON_DIR = new THREE.Vector3(-0.75, 0.42, 0.5).normalize();
const skyU = sky.material.uniforms;
skyU.turbidity.value = 4.5;
skyU.rayleigh.value = 1.4;
skyU.mieCoefficient.value = 0.004;
skyU.mieDirectionalG.value = 0.86;

const sunDir = new THREE.Vector3(0.5, 0.5, 0.5).normalize();
const sunLight = new THREE.DirectionalLight(0xffe2b8, 3.2);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(4096, 4096);
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.03;
scene.add(sunLight, sunLight.target);
const hemiLight = new THREE.HemisphereLight(0xb8d0f0, 0x4a4630, 0.35);
scene.add(hemiLight);

const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const envSky = new Sky();
envSky.material = sky.material;
envSky.scale.setScalar(50);
envScene.add(envSky);
const envGround = new THREE.Mesh(new THREE.CircleGeometry(40, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3e4a2c }));
envGround.position.y = -2;
envScene.add(envGround);
let envRT = null;

// Light-space fit of the shadow frustum around the board
const SHADOW_BOX = new THREE.Box3(new THREE.Vector3(bx0 - 18, -1, bz0 - 18), new THREE.Vector3(bx1 + 18, 10, bz1 + 18));
function fitShadow() {
  const center = SHADOW_BOX.getCenter(new THREE.Vector3());
  sunLight.position.copy(center).addScaledVector(sunDir, 150);
  sunLight.target.position.copy(center);
  sunLight.target.updateMatrixWorld();
  sunLight.updateMatrixWorld();
  const view = new THREE.Matrix4().lookAt(sunLight.position, center, new THREE.Vector3(0, 1, 0));
  view.setPosition(sunLight.position);
  const inv = view.clone().invert();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? SHADOW_BOX.max.x : SHADOW_BOX.min.x, i & 2 ? SHADOW_BOX.max.y : SHADOW_BOX.min.y, i & 4 ? SHADOW_BOX.max.z : SHADOW_BOX.min.z);
    box.expandByPoint(v.applyMatrix4(inv));
  }
  const cam = sunLight.shadow.camera;
  cam.left = box.min.x; cam.right = box.max.x;
  cam.bottom = box.min.y; cam.top = box.max.y;
  cam.near = Math.max(0.5, -box.max.z - 60);
  cam.far = -box.min.z + 10;
  cam.updateProjectionMatrix();
  renderer.shadowMap.needsUpdate = true;
}

const KEY_SUN = new THREE.Color(0xffe6c2), GOLD_SUN = new THREE.Color(0xffb56b), DUSK_SUN = new THREE.Color(0xff8a4a);
const NIGHT_FOG = new THREE.Color(0x1a2333), DAY_FOG = FOG_COLOR.clone(), GOLD_FOG = new THREE.Color(0xd8c3a8);
const waterMats = [];
const lanternMats = [];
const windowMats = [];
const nightFx = [];
const timeState = { hour: 16.2, night: 0 };
function setTimeOfDay(hour, { env = true } = {}) {
  timeState.hour = hour;
  const dayT = (hour - 6) / 12;
  const elev = Math.sin(Math.PI * Math.min(1, Math.max(0, dayT))) * 58 - 4 + (dayT < 0 || dayT > 1 ? -10 * Math.min(1, Math.abs(dayT < 0 ? dayT : dayT - 1) * 8) : 0);
  const az = 60 + dayT * 125;
  const el = THREE.MathUtils.degToRad(Math.max(elev, -12));
  const azr = THREE.MathUtils.degToRad(az);
  const realSun = new THREE.Vector3(Math.cos(el) * Math.cos(azr), Math.sin(el), Math.cos(el) * Math.sin(azr)).normalize();
  skyU.sunPosition.value.copy(realSun);

  const golden = 1 - smoothstep(6, 26, elev);
  const night = 1 - smoothstep(-6, 3, elev);
  timeState.night = night;
  const sunCol = KEY_SUN.clone().lerp(GOLD_SUN, golden).lerp(DUSK_SUN, smoothstep(0.75, 1, golden));
  const lightDir = realSun.clone();
  if (night > 0) lightDir.lerp(MOON_DIR, night).normalize();
  if (lightDir.y < 0.06) lightDir.setY(0.06).normalize();
  sunDir.copy(lightDir);
  sunLight.color.copy(sunCol).lerp(new THREE.Color(0x8fb0ff), night);
  sunLight.intensity = lerp(3.3, 1.9, golden) * (1 - night) + 0.75 * night;
  G.uSunDir.value.copy(sunDir);
  G.uSunCol.value.copy(sunLight.color).multiplyScalar(sunLight.intensity * (1 - night * 0.85));
  hemiLight.intensity = lerp(0.36, 0.34, golden) * (1 - night) + 0.22 * night;
  hemiLight.color.set(0xb8d0f0).lerp(new THREE.Color(0x3a4a70), night);

  const fog = DAY_FOG.clone().lerp(GOLD_FOG, golden * 0.85).lerp(NIGHT_FOG, night);
  scene.fog.color.copy(fog);
  scene.background.copy(fog);
  skyU.uHorizonColor.value.copy(fog);
  renderer.toneMappingExposure = lerp(1.0, 1.08, golden) * (1 - night) + 1.45 * night;
  gradeNight = night;
  skyU.rayleigh.value = lerp(1.4, 2.4, golden);
  skyU.turbidity.value = lerp(4.5, 7, golden);

  for (const m of waterMats) {
    m.uniforms.uSunDir.value.copy(sunDir);
    m.uniforms.uSunColor.value.copy(sunLight.color).multiplyScalar(1 - night * 0.7);
    m.uniforms.uSkyHorizon.value.copy(fog);
    m.uniforms.uSkyZenith.value.set(0x5a8fcc).lerp(new THREE.Color(0xd99a6a), golden * 0.5).lerp(new THREE.Color(0x0c1426), night);
    m.uniforms.uLight.value = lerp(1.0, 0.85, golden) * (1 - night) + 0.25 * night;
  }
  const glow = smoothstep(0.25, 0.95, Math.max(night, golden * 0.4 - 0.1));
  for (const m of lanternMats) m.emissiveIntensity = 7 * glow;
  for (const m of windowMats) m.emissiveIntensity = 5.5 * glow;
  const starA = smoothstep(0.35, 1, night);
  stars.material.uniforms.uNight.value = starA;
  birdSys.setNight(night);
  moon.material.opacity = starA;
  for (const fx of nightFx) {
    if (fx.material.uniforms.uNight) fx.material.uniforms.uNight.value = starA;
    if (fx.material.uniforms.uGlow) fx.material.uniforms.uGlow.value = glow;
  }
  G.uCloudStrength.value = 0.38 * (1 - night);
  G.uCloudShift.value.set(sunDir.x, sunDir.z).multiplyScalar(1 / Math.max(sunDir.y, 0.2));
  const cu = clouds.material.uniforms;
  cu.uLit.value.copy(sunLight.color).multiplyScalar(lerp(1.75, 1.35, golden) * (1 - night) + 0.08 * night).add(new THREE.Color(0.15, 0.17, 0.2));
  cu.uShade.value.set(0x8c99ab).lerp(new THREE.Color(0xa07d72), golden * 0.6).multiplyScalar(1 - night * 0.85);
  cu.uHorizon.value.copy(fog);
  timeState.fog = fog;
  for (const m of waterMats) m.userData.sky = [m.uniforms.uSkyHorizon.value.clone(), m.uniforms.uSkyZenith.value.clone()];
  applyFogLook();

  fitShadow();
  if (env) {
    if (envRT) envRT.dispose();
    skyU.uDarkSky.value = 0;
    envRT = pmrem.fromScene(envScene, 0.02, 0.1, 200);
    skyU.uDarkSky.value = fogLook.dark;
    scene.environment = envRT.texture;
  }
}

// Fog-of-war look: 'dark' turns the sky almost black while the fog of war is on, 'light' keeps the normal sky
const fogLook = { style: 'dark', dark: 0 };
function applyFogLook() {
  if (!timeState.fog) return;
  const k = 1 - 0.9 * fogLook.dark;
  skyU.uDarkSky.value = fogLook.dark;
  scene.fog.color.copy(timeState.fog).multiplyScalar(k);
  scene.background.copy(scene.fog.color);
  clouds.material.uniforms.uOpacity.value = 1 - fogLook.dark;
  for (const m of waterMats) {
    if (!m.userData.sky) continue;
    m.uniforms.uSkyHorizon.value.copy(m.userData.sky[0]).multiplyScalar(k);
    m.uniforms.uSkyZenith.value.copy(m.userData.sky[1]).multiplyScalar(k);
  }
}
function updateFogLook(dt) {
  const target = G.uFogOn.value > 0.5 && fogLook.style === 'dark' ? 1 : 0;
  if (fogLook.dark === target) return;
  fogLook.dark = target > fogLook.dark ? Math.min(target, fogLook.dark + dt * 1.2) : Math.max(target, fogLook.dark - dt * 1.2);
  applyFogLook();
}

await setProgress(62, 'Filling rivers...');

// --- Water ---
const waterNormals = texLoader.load('https://threejs.org/examples/textures/waternormals.jpg');
waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;
const waterArgs = { fineTex, fineBounds, coarseTex, coarseBounds, normalTex: waterNormals, sunDir, sunColor: sunLight.color };
const waterMat = createWaterMaterial(waterArgs);
const water = new THREE.Mesh(new THREE.PlaneGeometry(SUR.half * 2, SUR.half * 2, 1, 1).rotateX(-Math.PI / 2), waterMat);
water.position.set(BCX, WATER_LEVEL, BCZ);
water.renderOrder = 1;
scene.add(water);
waterMats.push(waterMat);

// Stream ribbons along hex edges
{
  const pos = [], edge = [], idx = [];
  const W = 0.3, RISE = 0.22;
  const joints = new Map();
  for (const se of streamEdges) {
    const ka = getCornerKey(se.a.x, se.a.z), kb = getCornerKey(se.b.x, se.b.z);
    const ya = cornerHeights.get(ka), yb = cornerHeights.get(kb);
    if (ya === undefined || yb === undefined) continue;
    const dx = se.b.x - se.a.x, dz = se.b.z - se.a.z;
    const L = Math.hypot(dx, dz);
    const px = -dz / L * W, pz = dx / L * W;
    const base = pos.length / 3;
    pos.push(se.a.x + px, ya + RISE, se.a.z + pz, se.a.x - px, ya + RISE, se.a.z - pz);
    pos.push(se.b.x + px, yb + RISE, se.b.z + pz, se.b.x - px, yb + RISE, se.b.z - pz);
    edge.push(1, -1, 1, -1);
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    joints.set(ka, { x: se.a.x, z: se.a.z, y: ya + RISE });
    joints.set(kb, { x: se.b.x, z: se.b.z, y: yb + RISE });
  }
  for (const j of joints.values()) {
    const base = pos.length / 3;
    pos.push(j.x, j.y - 0.002, j.z); edge.push(0);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      pos.push(j.x + Math.cos(a) * W, j.y - 0.002, j.z + Math.sin(a) * W);
      edge.push(1);
    }
    for (let i = 0; i < 8; i++) idx.push(base, base + 1 + ((i + 1) % 8), base + 1 + i);
  }
  if (pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
    g.setIndex(idx);
    const ribbonMat = createWaterMaterial({ ...waterArgs, ribbon: true });
    const ribbons = new THREE.Mesh(g, ribbonMat);
    ribbons.renderOrder = 2;
    scene.add(ribbons);
    waterMats.push(ribbonMat);
  }
}

await setProgress(68, 'Growing forests...');

// --- Vegetation ---
const broadModel = await broadModelReady;
const broadNear = [0, 1].map((v) => (broadModel ? broadModel.geo : VEG.makeBroadleafGeometry(v)));
const vegMat = (opts, key, extra = null) => patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, envMapIntensity: 0.5 }), opts, extra, key);
const treeMatConifer = vegMat({ wind: true, windBend: 0.045, windFreq: 1.1, flutter: 0.004, clearOnUnits: true }, 'conifer-tex2', VEG.treeTexturePatch('conifer'));
const treeMatBroad = vegMat({ wind: true, windBend: 0.06, windFreq: 1.3, flutter: broadModel ? 0 : 0.008, clearOnUnits: true }, 'broad-tex2', VEG.treeTexturePatch('broad'));
const bushMat = vegMat({ wind: true, windBend: 0.5, windFreq: 1.6, clearOnUnits: true }, 'bush-tex2', VEG.treeTexturePatch('bush'));
const grassMat = vegMat({ wind: true, windBend: 6.0, windFreq: 1.6, fadeNear: 22, fadeFar: 40, noFlip: true }, 'grass-v2', VEG.grassPatch);
grassMat.side = THREE.DoubleSide;
const wheatMat = vegMat({ wind: true, windBend: 3.0, windFreq: 1.5, fadeNear: 55, fadeFar: 85, noFlip: true, clearOnUnits: true }, 'wheat');
wheatMat.side = THREE.DoubleSide;
const rockMat = patchLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true, envMapIntensity: 0.3 }), {}, null, 'rock');

const conifers = [[], []], broads = [[], []], farConifers = [], farBroads = [];
const bushes = [], grass = [], wheat = [], rocks = [], slabs = [], flowers = [];
const FLOWER_COLORS = [[1, 1, 1], [1, 0.82, 0.18], [0.72, 0.5, 1], [1, 0.3, 0.2], [1, 0.95, 0.75]];
const mul = (rng, r, g, b, amt = 0.25) => { const k = 1 + (rng() - 0.5) * amt; return new THREE.Color(r * k * (1 + (rng() - 0.5) * amt * 0.4), g * k, b * k * (1 + (rng() - 0.5) * amt * 0.6)); };
const nPatch = makeNoise2D(606);

function randomInHex(cx, cz, rng, radius = 0.86) {
  for (;;) {
    const x = (rng() * 2 - 1) * radius, z = (rng() * 2 - 1) * radius;
    if (Math.abs(z) <= radius * sqrt3 / 2 && Math.abs(x) * sqrt3 / 2 + Math.abs(z) / 2 <= radius * sqrt3 / 2) return [cx + x, cz + z];
  }
}

// Forest hexes: dense mixed woodland
for (const hex of hexesByType.forest || []) {
  const rng = makeRng(hex.q * 7919 + hex.r * 104729 + 13);
  const wp = hexToWorld(hex.q, hex.r);
  const pts = [];
  const target = 10 + Math.floor(rng() * 5);
  for (let tries = 0; tries < 60 && pts.length < target; tries++) {
    const [x, z] = randomInHex(wp.x, wp.z, rng, 0.98);
    if (pts.some(([px, pz]) => (px - x) ** 2 + (pz - z) ** 2 < 0.29 * 0.29)) continue;
    pts.push([x, z]);
  }
  const coniferBias = smoothstep(-0.35, 0.35, nPatch(wp.x * 0.06, wp.z * 0.06)) * 0.8 + 0.1;
  for (const [x, z] of pts) {
    const y = groundHeight(x, z) - 0.04;
    const s = 0.75 + rng() * 0.55;
    const ry = rng() * Math.PI * 2;
    if (rng() < coniferBias) {
      conifers[rng() < 0.6 ? 0 : 1].push({ x, y, z, s, sy: 0.9 + rng() * 0.35, ry, color: mul(rng, 0.92, 1.0, 0.9, 0.35) });
    } else {
      const autumn = rng() < 0.08;
      broads[rng() < 0.5 ? 0 : 1].push({ x, y, z, s: s * 0.95, sy: 0.9 + rng() * 0.25, ry, color: autumn ? mul(rng, 1.5, 0.95, 0.4, 0.3) : mul(rng, 0.95, 1.0, 0.82, 0.35) });
    }
  }
  for (let b = 0; b < 4; b++) {
    const [x, z] = randomInHex(wp.x, wp.z, rng, 0.95);
    bushes.push({ x, y: groundHeight(x, z) - 0.02, z, s: 0.6 + rng() * 0.7, ry: rng() * 6.28, color: mul(rng, 0.95, 1.0, 0.85, 0.3) });
  }
}

// Trunk circles of the board's forest trees (Promenade collisions)
const broadTrunkR = broadModel ? broadModel.trunkRadius * 0.9 : 0.045;
const trunks = [...conifers[0], ...conifers[1]].map((t) => ({ x: t.x, z: t.z, r: 0.045 * t.s }))
  .concat([...broads[0], ...broads[1]].map((t) => ({ x: t.x, z: t.z, r: broadTrunkR * t.s })));

// Plains: grass tufts, occasional bush; fields: wheat; rocky hexes: boulders
for (const [key, hex] of allHexes) {
  const vt = vtypeOf.get(key);
  const rng = makeRng(hex.q * 92821 + hex.r * 68917 + 7);
  const wp = hexToWorld(hex.q, hex.r);
  if (vt === 'plain' || vt === 'highland' || vt === 'road') {
    // meadow: each spot grows a small clump of short tufts (own rng, so the rest of the scatter keeps its layout)
    const grng = makeRng(hex.q * 92821 + hex.r * 68917 + 11);
    const n = vt === 'highland' ? 12 : 22;
    for (let i = 0; i < n; i++) {
      const [x, z] = randomInHex(wp.x, wp.z, rng, 1.0);
      const y = groundHeight(x, z);
      if (y < WATER_LEVEL + 0.12 || y < hex.height - 0.1 || roadAt(x, z) > 0.12) continue;
      const s = 0.75 + rng() * 0.55, sy = 0.75 + rng() * 0.5, ry = rng() * 6.28;
      const color = vt === 'plain' ? mul(rng, 1.0, 1.0, 0.9, 0.25) : mul(rng, 1.2, 1.05, 0.72, 0.2);
      const k = grng() < 0.25 ? 3 + Math.floor(grng() * 3) : grng() < 0.4 ? 1 : 0;
      for (let j = 0; j < k; j++) {
        const a = grng() * 6.28, d = j ? 0.03 + grng() * grng() * 0.16 : 0;
        const gx = x + Math.cos(a) * d, gz = z + Math.sin(a) * d;
        const gy = j ? groundHeight(gx, gz) : y;
        if (j && (gy < WATER_LEVEL + 0.12 || gy < hex.height - 0.1 || roadAt(gx, gz) > 0.12)) continue;
        grass.push({ x: gx, y: gy - 0.008, z: gz, s: s * (0.85 + grng() * 0.3), sy, ry: ry + j * 1.7, color });
      }
    }
    const nf = vt === 'highland' ? 1 : 3;
    const fc = FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)];
    for (let i = 0; i < nf; i++) {
      const [x, z] = randomInHex(wp.x, wp.z, rng, 0.95);
      const y = groundHeight(x, z);
      if (y < hex.height - 0.08 || roadAt(x, z) > 0.1) continue;
      const k = 0.85 + rng() * 0.3;
      flowers.push({ x, y: y - 0.005, z, s: 0.8 + rng() * 0.6, ry: rng() * 6.28, color: new THREE.Color(fc[0] * k, fc[1] * k, fc[2] * k) });
    }
    if (rng() < 0.06) {
      const [x, z] = randomInHex(wp.x, wp.z, rng, 0.6);
      if (groundHeight(x, z) < hex.height - 0.05 || roadAt(x, z) > 0.05) continue;
      bushes.push({ x, y: groundHeight(x, z) - 0.02, z, s: 0.6 + rng() * 0.6, ry: rng() * 6.28, color: mul(rng, 1.0, 1.0, 0.85, 0.3) });
    }
  } else if (vt === 'field') {
    const rowA = 0.6;
    const ca = Math.cos(rowA), sa = Math.sin(rowA);
    for (let u = -1.0; u <= 1.0; u += 0.16) {
      for (let v = -1.0; v <= 1.0; v += 0.13) {
        const lx = u * ca - v * sa + (rng() - 0.5) * 0.05, lz = u * sa + v * ca + (rng() - 0.5) * 0.05;
        if (Math.abs(lz) > sqrt3 / 2 * 0.98 || Math.abs(lx) * sqrt3 / 2 + Math.abs(lz) / 2 > sqrt3 / 2 * 0.98) continue;
        const x = wp.x + lx, z = wp.z + lz;
        wheat.push({ x, y: groundHeight(x, z) - 0.01, z, s: 0.85 + rng() * 0.3, sy: 0.85 + rng() * 0.3, ry: rng() * 6.28, color: mul(rng, 1.0, 0.95, 0.85, 0.2) });
      }
    }
  } else if (vt === 'rocky') {
    // mountains: a few outcrops on the steep parts only (none on gentle slopes), alpine grass, sparse pines low down
    const fortified = nearFort(hex.q, hex.r);
    let slope = 0;
    for (const [dq, dr] of HEX_DIRS) { const n = allHexes.get(`${hex.q + dq},${hex.r + dr}`); if (n) slope = Math.max(slope, Math.abs(n.height - hex.height)); }
    const n = fortified ? 0 : slope >= 2 ? 1 + (rng() < 0.4 ? 1 : 0) : (rng() < 0.18 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const [x, z] = randomInHex(wp.x, wp.z, rng, 0.85);
      const sc = 0.18 + rng() * (slope >= 2 ? 0.3 : 0.16);
      const target = rng() < 0.45 ? slabs : rocks;
      target.push({ x, y: groundHeight(x, z) - 0.15 * sc, z, s: sc, sy: 0.6 + rng() * 0.5, ry: rng() * 6.28, rx: (rng() - 0.5) * 0.5, rz: (rng() - 0.5) * 0.5, color: mul(rng, 1.0, 0.98, 0.94, 0.25) });
    }
    const ng = hex.height >= 9 ? 3 : 12;
    for (let i = 0; i < ng; i++) {
      const [x, z] = randomInHex(wp.x, wp.z, rng, 1.0);
      grass.push({ x, y: groundHeight(x, z) - 0.01, z, s: 0.55 + rng() * 0.45, ry: rng() * 6.28, color: mul(rng, 1.1, 1.06, 0.8, 0.2) });
    }
    if (hex.height <= 7 && rng() < 0.45) {
      const np = 1 + Math.floor(rng() * 3);
      for (let i = 0; i < np; i++) {
        const [x, z] = randomInHex(wp.x, wp.z, rng, 0.9);
        conifers[rng() < 0.6 ? 0 : 1].push({ x, y: groundHeight(x, z) - 0.04, z, s: 0.6 + rng() * 0.4, sy: 0.95 + rng() * 0.35, ry: rng() * 6.28, color: mul(rng, 0.88, 0.98, 0.86, 0.3) });
      }
    }
  }
}

// Cliffs (explicit and automatic): scree and a few fallen blocks at the foot, grass tufts hanging over the lip
for (const [segKey, type] of ruleSegSet) {
  if (type !== 'cliff') continue;
  const s = parseSeg(segKey);
  const ha = allHexes.get(`${s.q1},${s.r1}`), hb = allHexes.get(`${s.q2},${s.r2}`);
  const ec = edgeCorners(s.q1, s.r1, s.q2, s.r2);
  if (!ha || !hb || !ec) continue;
  if (nearFort(s.q1, s.r1) || nearFort(s.q2, s.r2)) continue;
  const [hi, lo] = effH(ha) >= effH(hb) ? [ha, hb] : [hb, ha];
  const drop = effH(hi) - effH(lo);
  if (drop < 0.5 || isWaterHex(lo)) continue;
  const rng = makeRng(s.q1 * 31 + s.r1 * 17 + s.q2 * 13 + s.r2 * 7 + 1);
  const ph = hexToWorld(hi.q, hi.r), pl = hexToWorld(lo.q, lo.r);
  const ox = (pl.x - ph.x) / sqrt3, oz = (pl.z - ph.z) / sqrt3;
  const eda = Math.atan2(-(ec[1].z - ec[0].z), ec[1].x - ec[0].x);
  // talus: small stones, denser right against the face
  const nScree = 5 + Math.floor(rng() * 4 + Math.min(drop, 3));
  for (let i = 0; i < nScree; i++) {
    const t = 0.12 + rng() * 0.76;
    const dist = 0.04 + Math.pow(rng(), 1.8) * 0.42;
    const x = ec[0].x + (ec[1].x - ec[0].x) * t + ox * dist * sqrt3, z = ec[0].z + (ec[1].z - ec[0].z) * t + oz * dist * sqrt3;
    const sc = (0.045 + rng() * 0.07) * (1.15 - dist);
    rocks.push({ x, y: groundHeight(x, z) - 0.25 * sc, z, s: sc, sy: 0.45 + rng() * 0.35, ry: rng() * 6.28, rx: (rng() - 0.5) * 0.6, rz: (rng() - 0.5) * 0.6, color: mul(rng, 0.92, 0.88, 0.82, 0.25) });
  }
  // now and then a fallen block lying against the foot
  if (drop >= 1.5 && rng() < 0.35) {
    const t = 0.25 + rng() * 0.5, dist = 0.08 + rng() * 0.12;
    const x = ec[0].x + (ec[1].x - ec[0].x) * t + ox * dist * sqrt3, z = ec[0].z + (ec[1].z - ec[0].z) * t + oz * dist * sqrt3;
    slabs.push({ x, y: groundHeight(x, z) - 0.04, z, s: 0.13 + rng() * 0.08, sy: 0.45 + rng() * 0.25, ry: eda + (rng() - 0.5) * 0.8, rx: (rng() - 0.5) * 0.3, rz: (rng() - 0.5) * 0.3, color: mul(rng, 0.9, 0.86, 0.8, 0.2) });
  }
  // grass tufts on the lip, leaning over the edge
  const nTuft = 3 + Math.floor(rng() * 3);
  const yA = groundHeight(ec[0].x - ox * 0.06, ec[0].z - oz * 0.06), yB = groundHeight(ec[1].x - ox * 0.06, ec[1].z - oz * 0.06);
  for (let i = 0; i < nTuft; i++) {
    const t = 0.1 + rng() * 0.8;
    const x = ec[0].x + (ec[1].x - ec[0].x) * t - ox * 0.05, z = ec[0].z + (ec[1].z - ec[0].z) * t - oz * 0.05;
    const y = yA + (yB - yA) * t;
    if (y < effH(hi) - 0.3) continue;
    grass.push({ x, y: y - 0.02, z, s: 0.5 + rng() * 0.35, sy: 0.9 + rng() * 0.5, ry: rng() * 6.28, color: mul(rng, 1.05, 1.0, 0.82, 0.2) });
  }
}

// Surroundings: forests on lower slopes (low-poly LOD), scattered boulders, meadow grass near the board
{
  const rng = makeRng(4242);
  const step = 1.45;
  for (let z = bz0 - 70; z <= bz1 + 70; z += step) {
    for (let x = bx0 - 70; x <= bx1 + 70; x += step) {
      const jx = x + (rng() - 0.5) * step, jz = z + (rng() - 0.5) * step;
      const d = Math.hypot(Math.max(0, bx0 - jx, jx - bx1), Math.max(0, bz0 - jz, jz - bz1));
      if (d < 1.2) continue;
      const y = groundHeight(jx, jz);
      if (y < WATER_LEVEL + 0.45 || y > 24 || roadAt(jx, jz) > 0.08) continue;
      const fm = forestMask(jx, jz);
      const e = 0.6;
      const gx = groundHeight(jx + e, jz) - groundHeight(jx - e, jz), gz = groundHeight(jx, jz + e) - groundHeight(jx, jz - e);
      const slope = Math.hypot(gx, gz) / (2 * e);
      if (rng() < smoothstep(0.02, 0.28, fm) * (1 - smoothstep(0.8, 1.4, slope)) * 0.95) {
        const s = 0.9 + rng() * 0.8;
        const ry = rng() * 6.28;
        const near = d < 6;
        if (y > 9 || rng() < 0.65) {
          const it = { x: jx, y: y - 0.08, z: jz, s, sy: 0.9 + rng() * 0.4, ry, color: mul(rng, 0.85, 0.95, 0.88, 0.35) };
          (near ? conifers[rng() < 0.5 ? 0 : 1] : farConifers).push(it);
        } else {
          const it = { x: jx, y: y - 0.08, z: jz, s, sy: 0.9 + rng() * 0.3, ry, color: mul(rng, 1.0, 0.98, 0.8, 0.35) };
          (near ? broads[rng() < 0.5 ? 0 : 1] : farBroads).push(it);
        }
      } else if (slope > 0.7 && rng() < 0.08) {
        rocks.push({ x: jx, y: y - 0.1, z: jz, s: 0.4 + rng() * 0.9, sy: 0.6 + rng() * 0.5, ry: rng() * 6.28, color: mul(rng, 1.0, 0.97, 0.92, 0.3) });
      } else if (d < 22 && rng() < 0.3) {
        grass.push({ x: jx, y: y - 0.01, z: jz, s: 1.0 + rng() * 0.8, sy: 0.8 + rng() * 0.6, ry: rng() * 6.28, color: mul(rng, 1.0, 1.0, 0.9, 0.3) });
      }
    }
  }
}

// Meadow band just outside the board so grass density doesn't stop at the board edge
{
  const rng = makeRng(9191);
  const step = 0.36, band = 10;
  for (let z = bz0 - band; z <= bz1 + band; z += step) {
    for (let x = bx0 - band; x <= bx1 + band; x += step) {
      const jx = x + (rng() - 0.5) * step, jz = z + (rng() - 0.5) * step;
      const d = Math.hypot(Math.max(0, bx0 - jx, jx - bx1), Math.max(0, bz0 - jz, jz - bz1));
      if (d <= 0.05 || d > band) continue;
      if (rng() > Math.pow(1 - d / band, 1.5)) continue;
      const y = groundHeight(jx, jz);
      if (y < WATER_LEVEL + 0.2 || roadAt(jx, jz) > 0.12) continue;
      const e = 0.4;
      const sl = Math.hypot(groundHeight(jx + e, jz) - groundHeight(jx - e, jz), groundHeight(jx, jz + e) - groundHeight(jx, jz - e)) / (2 * e);
      if (sl > 0.8) continue;
      grass.push({ x: jx, y: y - 0.01, z: jz, s: 0.8 + rng() * 0.8, sy: 0.8 + rng() * 0.6, ry: rng() * 6.28, color: mul(rng, 1.0, 1.0, 0.9, 0.3) });
      if (rng() < 0.02) flowers.push({ x: jx, y: y - 0.005, z: jz, s: 0.8 + rng() * 0.6, ry: rng() * 6.28, color: new THREE.Color(...FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)]) });
    }
  }
}

const vegGroup = new THREE.Group();
scene.add(vegGroup);
// vegetation in chunks: each one frustum-culled, trees and bushes simplified past treeLod.dist (per quality level);
// the shadow map is redrawn when a chunk changes level so the shadows always match the trees shown (see the render loop)
const lodGroups = [];
const treeLod = { dist: 30 };
let lodTimer = 0, lodCam = null;
const lodPrev = new THREE.Vector3();
const vegChunks = (items, levels, opts) => {
  const g = VEG.chunkedInstances(items, levels, opts);
  lodGroups.push(g);
  g.userData.update(camera.position);
  return g;
};
const lodLevels = (geo, lodGeo, mat) => [
  { geo, mat, castShadow: true, get maxDist() { return treeLod.dist; } },
  { geo: lodGeo, mat, castShadow: true, maxDist: Infinity },
];
[0, 1].forEach((v) => {
  vegGroup.add(vegChunks(conifers[v], lodLevels(VEG.makeConiferGeometry(v), VEG.makeConiferGeometry(v, 1), treeMatConifer)));
  vegGroup.add(vegChunks(broads[v], lodLevels(broadNear[v], VEG.makeBroadleafGeometry(v, 1), treeMatBroad)));
});
const farTrees = new THREE.Group();
farTrees.add(vegChunks(farConifers, [{ geo: VEG.makeConiferGeometry(0, 1), mat: treeMatConifer, castShadow: true, maxDist: Infinity }], { size: 30 }));
farTrees.add(vegChunks(farBroads, [{ geo: VEG.makeBroadleafGeometry(0, 1), mat: treeMatBroad, castShadow: true, maxDist: Infinity }], { size: 30 }));
vegGroup.add(farTrees);
vegGroup.add(vegChunks(bushes, lodLevels(VEG.makeBushGeometry(), VEG.makeBushGeometry(1), bushMat)));
vegGroup.add(VEG.instanced(VEG.makeRockGeometry(3), rockMat, rocks, { castShadow: true }));
vegGroup.add(VEG.instanced(VEG.makeRockGeometry(8, 'slab'), rockMat, slabs, { castShadow: true }));
for (const w of wheat) w.s *= 0.8;
for (const f of flowers) f.s *= 0.6;
// denser tufts close to the camera, thinner ones further out (blades get sub-pixel there: faded out by 40)
const grassMesh = vegChunks(grass, [
  { geo: VEG.makeGrassTuftGeometry(5, 16, 0.1), mat: grassMat, maxDist: 16 },
  { geo: VEG.makeGrassTuftGeometry(5), mat: grassMat, maxDist: 42 },
]);
const wheatMesh = vegChunks(wheat, [{ geo: VEG.makeWheatGeometry(9), mat: wheatMat, maxDist: 87 }]);
const flowerMat = vegMat({ wind: true, windBend: 6.0, windFreq: 2.4, fadeNear: 30, fadeFar: 48 }, 'flower');
const flowerMesh = vegChunks(flowers, [{ geo: VEG.makeFlowerGeometry(), mat: flowerMat, maxDist: 50 }]);
vegGroup.add(grassMesh, wheatMesh, flowerMesh);
// contact shadows: a soft dark disc multiplied onto the ground under lone trees, forest edges and bushes, tilted with
// the slope (not inside dense woods, where the discs would pile up into a black floor)
const contactMat = new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const contactItems = [];
const treeCells = new Map();
const allTrees = [...conifers[0], ...conifers[1], ...broads[0], ...broads[1]];
for (const t of allTrees) {
  const k = `${Math.floor(t.x * 2)},${Math.floor(t.z * 2)}`;
  if (!treeCells.has(k)) treeCells.set(k, []);
  treeCells.get(k).push(t);
}
const crowded = (t) => {
  let n = 0;
  const cx = Math.floor(t.x * 2), cz = Math.floor(t.z * 2);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    for (const o of treeCells.get(`${cx + i},${cz + j}`) || []) if (o !== t && (o.x - t.x) ** 2 + (o.z - t.z) ** 2 < 0.2) n++;
  }
  return n >= 3;
};
const addContact = (list, r, skipCrowded) => {
  for (const t of list) {
    if (skipCrowded && crowded(t)) continue;
    const e = 0.15;
    const hx = (groundHeight(t.x + e, t.z) - groundHeight(t.x - e, t.z)) / (2 * e);
    const hz = (groundHeight(t.x, t.z + e) - groundHeight(t.x, t.z - e)) / (2 * e);
    const rx = Math.atan(-hz);
    contactItems.push({ x: t.x, y: groundHeight(t.x, t.z) + 0.012, z: t.z, s: r * t.s, rx, rz: Math.atan(hx * Math.cos(rx)) });
  }
};
for (const l of conifers) addContact(l, 0.38, true);
for (const l of broads) addContact(l, 0.36, true);
addContact(bushes, 0.26, false);
const contactMesh = vegChunks(contactItems, [{ geo: VEG.makeContactGeometry(0.76), mat: contactMat, maxDist: 48 }], { receiveShadow: false });
contactMesh.traverse((m) => { m.renderOrder = 1; });
vegGroup.add(contactMesh);

await setProgress(78, 'Raising villages...');

// fixed deployment zone (index in map.zones) a point stands in: base-camp banners take that army's colours
const zoneOfHex = new Map();
(mapDoc.zones || []).forEach((z, i) => { for (const k of z.tiles || []) if (!zoneOfHex.has(k)) zoneOfHex.set(k, i); });
const bannerZoneOf = (x, z) => { const h = worldToHex(x, z); return h ? (zoneOfHex.get(`${h.q},${h.r}`) ?? null) : null; };

const { waterwheels, smokeSources, lanternSpots, windowSpots, decks, solids, banners: bannerSet, cutaways } = buildStructures({
  scene, vegGroup, allHexes, hexesByType, segmentData, getSegType, parseSeg, edgeCorners,
  hexToWorld, hexCorner, groundHeight, effH, isWaterHex, footbridges, gateways,
  HEX_DIRS, DIR_TO_GEO_EDGE, CORNER_NEIGHBORS, HEX_HEIGHT_STEP, WATER_LEVEL, RIVERBED_HEIGHT,
  lanternMats, windowMats, bannerZoneOf, isGateHex: (q, r) => gateHexSet.has(`${q},${r}`),
  decorate: (api) => buildFortifications(api, { decor, segmentData, parseSeg, allHexes, hexToWorld, hexCorner, edgeCorners, groundHeight, effH, getSegType, HEX_DIRS, HEX_HEIGHT_STEP }),
});

// Height where units stand: the ground, or the deck of a bridge they are crossing
function walkHeight(x, z) {
  const g = groundHeight(x, z);
  for (const d of decks) {
    if (x < d.x0 || x > d.x1 || z < d.z0 || z > d.z1) continue;
    for (let i = 0; i < d.pts.length - 1; i++) {
      const a = d.pts[i], b = d.pts[i + 1];
      const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
      const px = a.x + vx * t, pz = a.z + vz * t;
      if ((x - px) ** 2 + (z - pz) ** 2 <= d.hw * d.hw) return Math.max(g, a.y + (b.y - a.y) * t);
    }
  }
  return g;
}

// Height where a unit stands: the walkable surface, but never below the wading level of a river (feet in the water)
const WADE_LEVEL = WATER_LEVEL - 0.12;
function standHeight(x, z) { return Math.max(walkHeight(x, z), WADE_LEVEL); }

// Point (x, z) pulled to within maxOff of the centre line of the nearest bridge deck (null when no deck is close):
// keeps a formation crossing a bridge on its deck
function deckClamp(x, z, maxOff) {
  let best = null;
  for (const d of decks) {
    if (x < d.x0 - 0.5 || x > d.x1 + 0.5 || z < d.z0 - 0.5 || z > d.z1 + 0.5) continue;
    for (let i = 0; i < d.pts.length - 1; i++) {
      const a = d.pts[i], b = d.pts[i + 1];
      const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
      const px = a.x + vx * t, pz = a.z + vz * t;
      const dd = Math.hypot(x - px, z - pz);
      if (dd < d.hw + 0.6 && (!best || dd < best.dd)) best = { dd, px, pz };
    }
  }
  if (!best) return null;
  if (best.dd <= maxOff) return { x, z };
  const k = maxOff / best.dd;
  return { x: best.px + (x - best.px) * k, z: best.pz + (z - best.pz) * k };
}

{
  // light comes out of the windows: a warm patch on the ground in front of each lit window, small pools under
  // lanterns and around camp fires (no more glow discs centred on the houses)
  const pools = lanternSpots.map(p => ({ x: p.x, y: groundHeight(p.x, p.z) + 0.05, z: p.z, r: 0.6, k: Math.max(0.15, 0.55 - 0.25 * Math.max(0, p.y - groundHeight(p.x, p.z) - 0.4)) }));
  for (const s of smokeSources) if (s.fire) pools.push({ x: s.x, y: groundHeight(s.x, s.z) + 0.05, z: s.z, r: 1.5, k: 0.8 });
  for (const w of windowSpots) {
    const x = w.x + w.nx * 0.3, z = w.z + w.nz * 0.3;
    pools.push({ x, y: groundHeight(x, z) + 0.04, z, sx: 0.32, sz: 0.5, ry: Math.atan2(w.nx, w.nz), k: 0.32 });
  }
  const poolMesh = createLightPools(pools);
  scene.add(poolMesh);
  nightFx.push(poolMesh);
  const flies = [];
  const frng = makeRng(31337);
  for (const hex of hexesByType.forest || []) {
    const edge = HEX_DIRS.some(([dq, dr]) => { const n = allHexes.get(`${hex.q + dq},${hex.r + dr}`); return n && n.terrain !== 'forest'; });
    if (!edge) continue;
    const wp = hexToWorld(hex.q, hex.r);
    for (let i = 0; i < 4; i++) {
      const x = wp.x + (frng() - 0.5) * 2.4, z = wp.z + (frng() - 0.5) * 2.4;
      flies.push({ x, y: groundHeight(x, z) + 0.25 + frng() * 0.8, z, ph: frng() * 10 });
    }
  }
  const fireflies = createFireflies(flies);
  scene.add(fireflies);
  nightFx.push(fireflies);
}

await setProgress(86, 'Breathing life...');

// --- Chimney smoke ---
const smokeMat = new THREE.ShaderMaterial({
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uWind: { value: new THREE.Vector2() }, uLight: { value: 1 }, uPx: { value: 1 } }]),
  transparent: true,
  depthWrite: false,
  fog: true,
  vertexShader: /* glsl */`
    #include <common>
    #include <fog_pars_vertex>
    uniform float uTime;
    uniform vec2 uWind;
    uniform float uPx;
    attribute float seed;
    varying float vAge;
    void main() {
      float age = fract( uTime * 0.07 + seed );
      vAge = age;
      vec3 p = position;
      p.y += age * 2.6;
      p.xz += uWind * age * age * 2.2 + vec2( sin( seed * 40.0 + uTime * 0.6 ), cos( seed * 23.0 + uTime * 0.5 ) ) * 0.12 * age;
      vec4 mvPosition = modelViewMatrix * vec4( p, 1.0 );
      gl_Position = projectionMatrix * mvPosition;
      gl_PointSize = ( 0.25 + age * 1.5 ) * uPx / -mvPosition.z;
      #include <fog_vertex>
    }
  `,
  fragmentShader: /* glsl */`
    #include <common>
    #include <fog_pars_fragment>
    uniform float uLight;
    varying float vAge;
    void main() {
      float r = length( gl_PointCoord - 0.5 );
      float a = smoothstep( 0.5, 0.1, r ) * smoothstep( 0.0, 0.12, vAge ) * ( 1.0 - smoothstep( 0.45, 1.0, vAge ) ) * 0.32;
      if ( a < 0.003 ) discard;
      vec3 col = mix( vec3( 0.55, 0.53, 0.52 ), vec3( 0.86, 0.85, 0.84 ), vAge ) * uLight;
      gl_FragColor = vec4( col, a );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }
  `,
});
{
  const pos = [], seeds = [];
  for (const s of smokeSources) {
    for (let i = 0; i < 26; i++) { pos.push(s.x, s.y + 0.05, s.z); seeds.push(i / 26 + Math.random() * 0.02); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 1));
  const smoke = new THREE.Points(g, smokeMat);
  smoke.frustumCulled = false;
  smoke.renderOrder = 3;
  scene.add(smoke);
}

// --- Birds: flocks that roam the valley and perch on wall-walks, roofs, tree tops, summits and fields ---
const birdPerches = [];
{
  const rng = makeRng(777);
  for (const k of rampartSet) { const h = allHexes.get(k); if (h && rng() < 0.6) { const c = hexToWorld(h.q, h.r); birdPerches.push({ x: c.x, y: walkHeight(c.x, c.z), z: c.z, kind: 'wall' }); } }
  for (const h of allHexes.values()) {
    const c = hexToWorld(h.q, h.r);
    const top = h.height >= 4 && HEX_DIRS.every(([dq, dr]) => { const n = allHexes.get(`${h.q + dq},${h.r + dr}`); return !n || n.height <= h.height; });
    if (top && rng() < 0.5) birdPerches.push({ x: c.x, y: groundHeight(c.x, c.z), z: c.z, kind: 'summit' });
    else if (fieldSet.has(`${h.q},${h.r}`) && rng() < 0.08) birdPerches.push({ x: c.x, y: groundHeight(c.x, c.z), z: c.z, kind: 'field' });
  }
  for (const s of smokeSources) birdPerches.push({ x: s.x, y: s.y - 0.08, z: s.z, kind: 'roof' });
  const treeTop = (g) => {
    const pos = g.attributes.position, top = new THREE.Vector3(0, -Infinity, 0);
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > top.y) top.fromBufferAttribute(pos, i);
    return top;
  };
  [[conifers, (v) => VEG.makeConiferGeometry(v)], [broads, (v) => broadNear[v]]].forEach(([sets, make]) => sets.forEach((list, v) => {
    const top = treeTop(make(v));
    for (const t of list) {
      if (rng() >= 0.04) continue;
      const s = t.s || 1, c = Math.cos(t.ry || 0), sn = Math.sin(t.ry || 0);
      birdPerches.push({ x: t.x + (top.x * c + top.z * sn) * s, y: t.y + top.y * s * (t.sy || 1) * 0.97, z: t.z + (-top.x * sn + top.z * c) * s, kind: 'tree' });
    }
  }));
}
const birdSys = createBirds({ scene, G, bounds: { bx0, bx1, bz0, bz1 }, groundHeight, surfaceHeight: walkHeight, perches: birdPerches, camera: renderCam });
const birds = birdSys.mesh;

const boardLayers = createBoardLayers({ scene, hexToWorld, groundHeight, walkHeight, decks, bounds: { bx0, bx1, bz0, bz1 } });
const objectiveMarkers = createObjectiveMarkers({ scene, hexToWorld, groundHeight, objectives: mapDoc.objectives || [] });

await setProgress(92, 'Compiling shaders...');

// --- Post-processing + adaptive quality ---
const post = createPost(renderer, scene, renderCam);
let viewCam = renderCam;
let usePost = true;
let colorPreset = 'kingdom';
var gradeNight; // set by the time-of-day update, which can run before this line (no initializer: hoisted, never reset)
// Cameras stay out of the scenery (walls, roofs, trees, relief): highest surface baked once from above
const obstacleTop = bakeObstacleHeights(renderer, scene, { x0: bx0 - 15, z0: bz0 - 15, x1: bx1 + 15, z1: bz1 + 15 },
  { hide: [sky, clouds, stars, moon, birds, grassMesh, flowerMesh, wheatMesh, contactMesh, ...nightFx] });
const camGuard = createCameraGuard({ camera, controls, top: obstacleTop, groundHeight, renderCam,
  bounds: { x0: bx0 - 15, z0: bz0 - 15, x1: bx1 + 15, z1: bz1 + 15 } });
camGuard.update(0);
// Depth of field: focus on a world point (selected unit…) or the orbit target; boosted during slow-motion shots
const dofState = { user: true, quality: false, point: null, boost: 0, focus: 30 };
const refreshDof = () => { post.dof.enabled = dofState.user && dofState.quality && usePost; };
const _dofV = new THREE.Vector3(), _dofF = new THREE.Vector3();
function updateDof(rawDt) {
  if (!post.dof.enabled) return;
  const rc = post.renderPass.camera;
  rc.getWorldDirection(_dofF);
  const d = Math.max(1, _dofV.subVectors(dofState.point || controls.target, rc.position).dot(_dofF));
  dofState.focus += (d - dofState.focus) * Math.min(1, rawDt * 5);
  post.dof.uniforms.uFocus.value = dofState.focus;
  post.dof.uniforms.uAperture.value = 0.6 + 1.6 * dofState.boost;
  post.dof.baseBlur = 4 + 7 * dofState.boost;
}
const maxDpr = Math.min(window.devicePixelRatio || 1, 2);
const LEVELS = [
  { name: 'Ultra', dpr: maxDpr, samples: maxDpr > 1.6 ? 2 : 4, bloom: true, post: true, grass: true, far: true, dof: true, lod: 30 },
  { name: 'High', dpr: Math.min(maxDpr, 1.5), samples: 4, bloom: true, post: true, grass: true, far: true, dof: true, lod: 25 },
  { name: 'Medium', dpr: Math.min(maxDpr, 1.25), samples: 2, bloom: false, post: true, grass: true, far: true, lod: 20 },
  { name: 'Low', dpr: Math.min(maxDpr, 1.0), samples: 0, bloom: false, post: true, grass: false, far: true, lod: 15 },
  { name: 'Minimum', dpr: 0.75, samples: 0, bloom: false, post: false, grass: false, far: false, lod: 11 },
].filter((l, i, arr) => {
  if (i === 0) return true;
  const sig = (x) => [x.dpr, x.samples, x.bloom, x.post, x.grass, x.far].join();
  return sig(l) !== sig(arr[i - 1]);
});
function applyQuality(l) {
  renderer.setPixelRatio(l.dpr);
  renderer.setSize(W(), H());
  for (const rt of [post.composer.renderTarget1, post.composer.renderTarget2]) {
    if (rt.samples !== l.samples) { rt.samples = l.samples; rt.dispose(); }
  }
  post.composer.setPixelRatio(l.dpr);
  post.composer.setSize(W(), H());
  post.bloom.enabled = l.bloom;
  usePost = l.post;
  dofState.quality = !!l.dof;
  refreshDof();
  grassMesh.visible = l.grass;
  flowerMesh.visible = l.grass;
  contactMesh.visible = l.grass;
  wheatMesh.visible = l.far;
  farTrees.visible = l.far;
  treeLod.dist = l.lod || 30;
  smokeMat.uniforms.uPx.value = H() * l.dpr * 0.5;
  stars.material.uniforms.uPx.value = l.dpr;
  for (const fx of nightFx) if (fx.material.uniforms.uPx) fx.material.uniforms.uPx.value = H() * l.dpr * 0.5;
  for (const fn of qualityHooks) fn(l);
}
const qualityHooks = [];
const resizeHooks = [];
qualityHooks.push((l) => birdSys.setQuality(l));
const _px = new Uint8Array(4);
function measureFrameCost() {
  const gl = renderer.getContext();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, _px);
  let best = Infinity;
  for (let i = 0; i < 2; i++) {
    const t0 = performance.now();
    if (usePost) post.composer.render(0.016);
    else renderer.render(scene, viewCam);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, _px);
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}
const governor = new QualityGovernor(LEVELS, (l) => applyQuality(l), { measure: measureFrameCost });
if (opts.quality != null) {
  governor.set(Math.max(0, Math.min(LEVELS.length - 1, opts.quality)));
  governor.locked = true;
}
applyQuality(LEVELS[governor.level]);

const savedHour = opts.persistKey ? parseFloat(localStorage.getItem(opts.persistKey + '_hour')) : NaN;
setTimeOfDay(Number.isFinite(savedHour) ? savedHour : (opts.hour ?? 16.2));
let pendingHour = null;
function previewTimeOfDay(h) { pendingHour = h; governor.pause(1200); }
function commitTimeOfDay(h) {
  pendingHour = null;
  setTimeOfDay(h);
  if (opts.persistKey) localStorage.setItem(opts.persistKey + '_hour', String(h));
  governor.pause(1200);
}

if (renderer.compileAsync) await renderer.compileAsync(scene, renderCam);
else renderer.compile(scene, renderCam);

await setProgress(100, 'Ready');

// --- Intro fly-in ---
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const _s0 = new THREE.Spherical(), _s1 = new THREE.Spherical(), _sv = new THREE.Vector3();
let flyFilter = null;
function flyTo(toPos, toTarget, dur = 1.2, fromHigh = false) {
  if (flyFilter) { const f = flyFilter(toPos, toTarget); if (!f) return; toPos = f.p; toTarget = f.t; fromHigh = false; }
  const from = { p: camera.position.clone(), t: controls.target.clone() };
  if (fromHigh) {
    const sph = new THREE.Spherical().setFromVector3(toPos.clone().sub(toTarget));
    sph.radius = Math.min(150, sph.radius * 2.4 + 40);
    sph.phi = Math.max(0.3, sph.phi * 0.55);
    sph.theta -= 0.9;
    const fromT = new THREE.Vector3(BCX, 0, BCZ);
    from.p = fromT.clone().add(new THREE.Vector3().setFromSpherical(sph));
    from.t = fromT;
    camera.position.copy(from.p);
    controls.target.copy(from.t);
  }
  intro.from = from;
  intro.to = { p: toPos.clone(), t: toTarget.clone() };
  intro.t = 0;
  intro.dur = dur;
  intro.active = true;
}
function updateIntro(dt) {
  if (!intro.active) return;
  intro.t += dt / intro.dur;
  const k = ease(Math.min(1, intro.t));
  _s0.setFromVector3(_sv.copy(intro.from.p).sub(intro.from.t));
  _s1.setFromVector3(_sv.copy(intro.to.p).sub(intro.to.t));
  let dTheta = _s1.theta - _s0.theta;
  if (dTheta > Math.PI) dTheta -= Math.PI * 2;
  if (dTheta < -Math.PI) dTheta += Math.PI * 2;
  const tgt = intro.from.t.clone().lerp(intro.to.t, k);
  const sph = new THREE.Spherical(lerp(_s0.radius, _s1.radius, k), lerp(_s0.phi, _s1.phi, k), _s0.theta + dTheta * k);
  camera.position.copy(tgt).add(_sv.setFromSpherical(sph));
  controls.target.copy(tgt);
  if (intro.t >= 1) intro.active = false;
}
canvas.addEventListener('pointerdown', () => { intro.active = false; });
canvas.addEventListener('wheel', () => { intro.active = false; }, { passive: true });
if (opts.intro) flyTo(camera.position.clone(), controls.target.clone(), 5.5, true);

// Focus the camera on a hex, keeping the current viewing angle
function focusHex(q, r, dur = 0.9) {
  const p = hexToWorld(q, r);
  const tgt = new THREE.Vector3(p.x, groundHeight(p.x, p.z), p.z);
  const off = camera.position.clone().sub(controls.target);
  flyTo(tgt.clone().add(off), tgt, dur);
}

// --- Hex picking ---
const raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
function worldToHex(x, z) {
  const qf = (2 / 3 * x) / HEX_SIZE;
  const rf = (-1 / 3 * x + sqrt3 / 3 * z) / HEX_SIZE;
  let rx = Math.round(qf), rz = Math.round(rf), ry = Math.round(-qf - rf);
  const dx = Math.abs(rx - qf), dz = Math.abs(rz - rf), dy = Math.abs(ry + qf + rf);
  if (dx > dz && dx > dy) rx = -rz - ry; else if (dz > dy) rz = -rx - ry;
  return { q: rx, r: rz };
}
function pickPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(_ndc, viewCam);
  const { origin: o, direction: d } = raycaster.ray;
  if (d.y > -1e-4) return null;
  // March the ray through the CPU heightfield (cheap, no triangle tests)
  const tTop = Math.max(0, (7 - o.y) / d.y);
  const tBot = (-1 - o.y) / d.y;
  const step = 0.25;
  let prev = tTop;
  for (let t = tTop; t <= tBot; t += step) {
    const x = o.x + d.x * t, z = o.z + d.z * t;
    if (o.y + d.y * t <= groundHeight(x, z)) {
      let lo = prev, hi = t;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        const mx = o.x + d.x * mid, mz = o.z + d.z * mid;
        if (o.y + d.y * mid <= groundHeight(mx, mz)) hi = mid; else lo = mid;
      }
      return new THREE.Vector3(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
    }
    prev = t;
  }
  return null;
}
function pickHex(clientX, clientY) {
  const p = pickPoint(clientX, clientY);
  if (!p) return null;
  const h = worldToHex(p.x, p.z);
  return allHexes.has(`${h.q},${h.r}`) ? h : null;
}
function projectToScreen(v, out = new THREE.Vector3()) {
  out.copy(v).project(viewCam);
  return { x: (out.x * 0.5 + 0.5) * W(), y: (-out.y * 0.5 + 0.5) * H(), visible: out.z < 1 && out.z > -1 };
}

function resize() {
  camera.aspect = W() / H();
  camera.updateProjectionMatrix();
  for (const fn of resizeHooks) fn(W(), H());
  applyQuality(LEVELS[governor.level]);
}

// --- Animate ---
const clock = new THREE.Clock();
const perf = { cpu: 0, frame: 16.7 };
const frameHooks = [(dt) => boardLayers.update(dt), (dt, t) => objectiveMarkers.update(dt, t), (dt) => cutaways.update(dt)];
let running = true;
// timeScale < 1 slows every animation and effect (slow-motion shots); game logic and timers are not affected
let timeScale = 1, simTime = 0;
function animate() {
  if (!running) return;
  requestAnimationFrame(animate);
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.1) * timeScale;
  simTime += dt;
  const t = simTime;
  if (pendingHour !== null) { setTimeOfDay(pendingHour, { env: false }); pendingHour = null; }
  updateFogLook(Math.min(rawDt, 0.1));
  G.uTime.value = t;
  G.uWindStrength.value = 0.75 + 0.35 * Math.sin(t * 0.13) + 0.2 * Math.sin(t * 0.41);
  smokeMat.uniforms.uTime.value = t;
  smokeMat.uniforms.uWind.value.copy(G.uWindDir.value);
  smokeMat.uniforms.uLight.value = 1 - timeState.night * 0.75;
  for (const ww of waterwheels) ww.rotation.x = t * 0.3;
  if (birds.visible) birdSys.update(dt);
  updateIntro(dt);
  controls.update();
  for (const fn of frameHooks) fn(dt, t);
  camGuard.update(Math.min(rawDt, 0.1));
  updateDof(Math.min(rawDt, 0.1));
  const vp = viewCam.position;
  sky.position.copy(vp);
  stars.position.copy(vp);
  moon.position.copy(vp).addScaledVector(MOON_DIR, 800);
  clouds.position.set(vp.x, G.uCloudHeight.value, vp.z);
  const t0 = performance.now();
  // the warm grade is eased off at night so moonlight keeps its blue and the shadows stay readable
  post.display.uniforms.uStrength.value = 1 - 0.7 * (gradeNight || 0);
  // levels re-chosen a few times a second, so a moving camera costs a shadow redraw at most that often
  lodTimer -= rawDt;
  if (viewCam !== lodCam || vp.distanceToSquared(lodPrev) > 16) lodTimer = 0;
  lodCam = viewCam;
  lodPrev.copy(vp);
  if (lodTimer <= 0) {
    lodTimer = 0.35;
    for (const g of lodGroups) if (g.userData.update(vp)) renderer.shadowMap.needsUpdate = true;
  }
  if (usePost) post.composer.render(dt);
  else renderer.render(scene, viewCam);
  perf.cpu = perf.cpu * 0.95 + (performance.now() - t0) * 0.05;
  perf.frame = perf.frame * 0.95 + dt * 1000 * 0.05;
  governor.frame(rawDt * 1000);
}
function start() { governor.start(2500); animate(); }
function setRunning(v) {
  if (v === running) return;
  running = v;
  if (v) { clock.getDelta(); governor.start(1500); animate(); }
}

return {
  THREE, renderer, scene, camera, controls, canvas, perf, governor, post, LEVELS,
  allHexes, hexesByType, getSegType, effH, isWaterHex,
  WATER_LEVEL, hexToWorld, worldToHex, groundHeight, walkHeight, standHeight, deckClamp, pickHex, pickPoint, projectToScreen,
  // walkable decks (bridges, stairs, wall-walks with wall: true) and solid footprints (walls, towers, gates, tents, fences)
  decks, solids, trunks,
  bounds: { bx0, bx1, bz0, bz1, BCX, BCZ },
  applyView, DEFAULT_VIEW, flyTo, focusHex, resize, start, setRunning,
  setTimeOfDay, previewTimeOfDay, commitTimeOfDay, get hour() { return timeState.hour; }, timeState,
  setFogStyle(style) { fogLook.style = style === 'light' ? 'light' : 'dark'; G.uFogLight.value = fogLook.style === 'light' ? 1 : 0; },
  setTimeScale(k) { timeScale = Math.max(0.01, Math.min(4, k)); }, get timeScale() { return timeScale; },
  // camera used for rendering / picking / projections: the orbit camera (through the rig), a slow-motion shot
  // camera or the orthographic map camera (mapMode.js); null or `camera` = the orbit camera
  get viewCamera() { return viewCam === renderCam ? camera : viewCam; },
  setViewCamera(cam) { viewCam = !cam || cam === camera ? renderCam : cam; post.renderPass.camera = viewCam; },
  // the orbit view as actually drawn (collision-corrected, smoothed) and the rig that derives it
  renderCamera: renderCam, cameraRig: camGuard,
  setFlyFilter(fn) { flyFilter = fn; },
  stopFly() { intro.active = false; },
  clouds, aspect: () => W() / H(),
  get usePost() { return usePost; },
  colors: {
    presets: Object.keys(COLOR_PRESETS),
    set(name) { colorPreset = COLOR_PRESETS[name] !== undefined ? name : 'kingdom'; post.display.setPreset(COLOR_PRESETS[colorPreset]); },
    get current() { return colorPreset; },
  },
  dof: {
    setEnabled(v) { dofState.user = !!v; refreshDof(); },
    setFocus(point) { dofState.point = point || null; },
    setBoost(k) { dofState.boost = Math.max(0, Math.min(1, k)); },
    get active() { return post.dof.enabled; },
    get user() { return dofState.user; },
  },
  camGuard, surfaceHeight: (x, z) => camGuard.surface(x, z),
  applyQuality, qualityHooks, frameHooks, resizeHooks,
  setGrid(v) { terrainUniforms.uGrid.value = v; }, get grid() { return terrainUniforms.uGrid.value; },
  sunDir, G, layers: boardLayers, objectives: objectiveMarkers, map: mapDoc,
  // base-camp banners in the colours of the army deployed in each fixed zone: [{ zone, color, emblem }]
  setCampColors: (owners) => bannerSet && bannerSet.setZoneColors(owners),
  // birds scatter when one of these points (unit positions, world x/z) comes near their perch
  setBirdThreats: (points) => birdSys.setThreats(points),
  // buildings with these hexes ([{ q, r }]) open their roof and upper walls (units inside stay visible)
  setBuildingCutaways: (hexes) => cutaways.set(hexes),
  birds: birdSys,
};
}
