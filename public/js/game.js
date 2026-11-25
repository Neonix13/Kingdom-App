// Kingdom Battleground — Game Client

// Réseau : session + reconnexion gérées par KBNet (public/js/net.js)
function wsSend(action, data) {
  KBNet.send(action, data);
}

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// Carte de la salle (registre /api/maps/<mapId>) : cases = clés de height, terrain plaine par défaut
const mapImage = new Image();
let mapId = null;
let mapDoc = null;
let mapBg = null;
let mapHexes = [];
let mapHeight = {};
let mapLoading = null;

// Chargement des terrains
let terrainData = {};
let showTerrain = false;
let showCoords = false;
let pingMode = false;
const activePings = []; // { q, r, color, startTime }
let gridOpacity = 0.25;
let gridThickness = 1;
let gridColorRGB = '180,140,60';

// Chargement des segments
let segmentData = {};
let UNIT_TYPES = {};
// Wall walks above the gates (mapProps.gateTops): node "q,r^" above the passage "q,r"
let gateInfo = { tops: {}, links: {} };
function nodeKeyOf(u) { return `${u.q},${u.r}${u.level ? '^' : ''}`; }
function unitAtNode(k) {
  const top = k.endsWith('^');
  const [q, r] = (top ? k.slice(0, -1) : k).split(',').map(Number);
  return (gameState?.units || []).find(u => u.q === q && u.r === r && !!u.level === top) || null;
}
// Which level of a gate hex a click / hover means for this unit: the one it can reach; when both (or neither), the
// wall walk if the unit stands on the wall (or a rampart at that height), the passage otherwise. Alt+click: the other one
function hexNode(unit, hex, alt = false) {
  const base = `${hex.q},${hex.r}`;
  const h = gateInfo.tops[base];
  if (h == null) return base;
  const top = base + '^';
  const canTop = movableTiles.has(top) || (unit && marchTargets(unit).has(top));
  const canBase = movableTiles.has(base) || (unit && marchTargets(unit).has(base));
  let up;
  if (canTop !== canBase) up = canTop;
  else up = !!unit && (!!unit.level || (mapHeight[`${unit.q},${unit.r}`] || 0) >= h - 1);
  return (alt ? !up : up) ? top : base;
}
window.gateInfo = () => gateInfo;

// Map changes made during the battle (espions, bâtisseurs): game_state.mapEdits over the map document
function applyMapEdits() {
  if (!mapDoc) return;
  const ed = gameState && gameState.mapEdits;
  segmentData = window.KBMapProps ? KBMapProps.effectiveSegments(mapDoc.segments, mapDoc.decor, mapDoc.height) : { ...(mapDoc.segments || {}) };
  terrainData = Object.fromEntries(Object.entries(mapDoc.terrain || {}).filter(([, t]) => t && t !== 'plain'));
  if (ed) {
    for (const [k, t] of Object.entries(ed.seg || {})) { if (t) segmentData[k] = t; else delete segmentData[k]; }
    for (const [k, t] of Object.entries(ed.ter || {})) { if (!t || t === 'plain') delete terrainData[k]; else terrainData[k] = t; }
  }
  if (window.view3d && window.view3d.onMapEdits) window.view3d.onMapEdits(ed || null);
}

async function fetchMapDoc(id) {
  try {
    const res = await fetch(`/api/maps/${encodeURIComponent(id)}`);
    if (res.ok) return await res.json();
  } catch (e) { /* hors serveur local : repli ci-dessous */ }
  if (id !== 'default') throw new Error('Carte introuvable : ' + id);
  const [terrain, segments, height] = await Promise.all(['terrain', 'segments', 'height'].map(n => fetch(`/data/${n}.json`).then(r => r.json())));
  return { id: 'default', terrain, segments, height, background: { image: '/assets/img/map.webp', hexSize: 101.5, origX: 137, origY: 190, width: 8800, height: 7200 } };
}

function ensureMap(id) {
  id = id || 'default';
  if (mapId === id && mapLoading) return mapLoading;
  mapId = id;
  window.KB_MAP_ID = id;
  mapLoading = fetchMapDoc(id).then((doc) => {
    if (mapId !== id) return;
    mapDoc = doc;
    mapHeight = doc.height || {};
    gateInfo = window.KBMapProps && KBMapProps.gateTops ? KBMapProps.gateTops(doc.decor, doc.height, doc.segments) : { tops: {}, links: {} };
    applyMapEdits();
    mapHexes = Object.keys(mapHeight).map(k => { const [q, r] = k.split(',').map(Number); return { q, r, key: k }; });
    mapBg = doc.background && doc.background.image ? doc.background : null;
    if (mapBg) { mapImage.onload = () => render(); mapImage.src = mapBg.image; }
    if (!cameraPlaced && mapHexes.length) {
      let sx = 0, sy = 0;
      for (const h of mapHexes) { const p = hexToPixel(h.q, h.r); sx += p.x; sy += p.y; }
      camX = -(sx / mapHexes.length) * zoom;
      camY = -(sy / mapHexes.length) * zoom;
    }
    if (selectedUnit) selectUnit(selectedUnit);
    render();
  }).catch((e) => { notify(e.message || 'Carte introuvable.'); });
  return mapLoading;
}

// Edge i = between corners[i] and corners[(i+1)%6], direction to neighbor i
const SEGMENT_EDGE_DIRS = [[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]];

const SEGMENT_COLORS_MAP = {
  river:            '#4a90d9',
  cliff:            '#8888aa',
  bridge:           '#e8a040',
  passerelle:       '#c8b060',
  barriere:         '#4a8040',
  chevaux_de_frise: '#c04040',
  mur:              '#606060',
  echelle:          '#a07840',
  escalier:         '#c8b898',
  rampe:            '#b8a070',
};

// Propriétés locales pour les vérifications de mouvement côté client
const SEGMENT_DEFS_CLIENT = {
  river:            { name:'Rivière',         vitesse:-1,  vitesse_fixe:null, infranchissable:false, infranchissable_cavalerie:false, attack_cac:-2, attack_tir:0, defense_cac:0, defense_tir:0, puissance_cac:0, puissance_tir:0, special:null },
  cliff:            { name:'Falaise',         vitesse:0,   vitesse_fixe:3,    infranchissable:false, infranchissable_cavalerie:true,  attack_cac:-5, attack_tir:0, defense_cac:0, defense_tir:0, puissance_cac:0, puissance_tir:0, special:'Infranchissable (sauf par une échelle)' },
  bridge:           { name:'Pont',            vitesse:0,   vitesse_fixe:null, infranchissable:false, infranchissable_cavalerie:false, attack_cac:0,  attack_tir:0, defense_cac:2, defense_tir:2, puissance_cac:0, puissance_tir:0, special:null },
  passerelle:       { name:'Passerelle',      vitesse:0,   vitesse_fixe:null, infranchissable:false, infranchissable_cavalerie:false, attack_cac:0,  attack_tir:0, defense_cac:-1, defense_tir:-1, puissance_cac:0, puissance_tir:0, special:'Effondrement 1/4' },
  barriere:         { name:'Barrière',        vitesse:-1,  vitesse_fixe:null, infranchissable:false, infranchissable_cavalerie:false, attack_cac:0,  attack_tir:0, defense_cac:2, defense_tir:2, puissance_cac:0, puissance_tir:0, special:null },
  chevaux_de_frise: { name:'Chevaux de frise',vitesse:0,   vitesse_fixe:null, infranchissable:false, infranchissable_cavalerie:false, attack_cac:0,  attack_tir:0, defense_cac:4, defense_tir:4, puissance_cac:0, puissance_tir:0, special:'+5 puissance vs cavalerie' },
  mur:              { name:'Mur',             vitesse:0,   vitesse_fixe:null, infranchissable:true,  infranchissable_cavalerie:false, attack_cac:0,  attack_tir:0, defense_cac:0, defense_tir:0, puissance_cac:0, puissance_tir:0, special:null },
  echelle:          { name:'Échelle',         vitesse:-2,  vitesse_fixe:null, infranchissable:false, infranchissable_cavalerie:true,  attack_cac:-6, attack_tir:0, defense_cac:0, defense_tir:0, puissance_cac:0, puissance_tir:0, special:'Infanterie et généraux seulement, coût 3' },
  escalier:         { name:'Escalier',        vitesse:-1,  vitesse_fixe:2   , infranchissable:false, infranchissable_cavalerie:true,  attack_cac:-6, attack_tir:0, defense_cac:0, defense_tir:0, puissance_cac:0, puissance_tir:0, special:'Infanterie et généraux seulement, coût 3' },
  rampe:            { name:'Rampe',           vitesse:-1,  infranchissable:false, infranchissable_cavalerie:false, attack_cac:0, attack_tir:0, defense_cac:0, defense_tir:0, puissance_cac:0, puissance_tir:0, special:'Pente praticable par tous malgré un fort dénivelé' },
};

// Movement: same rules and table as the server (public/js/rules.js, table sent in game_state.movementRules)
function movementTable() {
  return gameState?.movementRules || KBRules.movementTable(SEGMENT_DEFS_CLIENT);
}

// opts: { start, maxCost, minStep } to continue a route from one of its waypoints
function clientReachable(unit, opts = {}) {
  const maxSpeed = opts.maxCost != null ? opts.maxCost : unit.speedRemaining != null ? unit.speedRemaining : unit.speed;
  const occupied = new Set((gameState?.units || []).map(nodeKeyOf));
  const ab = KBRules.ability(unit, UNIT_TYPES);
  const drive = !!ab && ab.type === 'trample';
  // Hexes out of sight are not blocked: the map is public, a hidden unit on the way stops the move (ambush)
  return KBRules.reachable(movementTable(), {
    transit: drive ? (k) => occupied.has(k) && !!gameState && gameState.visibleHexes.has(k) : null,
    tops: gateInfo.tops, links: gateInfo.links,
    start: opts.start || { q: unit.q, r: unit.r, level: unit.level },
    maxCost: maxSpeed,
    minStep: opts.minStep != null ? opts.minStep : KBRules.hasFullSpeed(unit),
    mounted: KBRules.isMounted(unit),
    hexAt: (k) => (k in mapHeight ? { terrain: terrainData[k] || 'plain', height: mapHeight[k] || 0 } : null),
    blocked: (k) => occupied.has(k),
    segAt: (a, b, c, d) => segmentData[segmentEdgeKey(a, b, c, d)] || null,
  });
}

// ---- ROUTE: waypoints chosen by the player (Maj+clic, or the Étapes tool / key T) ----
// Shared by the classic turn (below) and the simultaneous planning (simultaneous.js).
const route = { unitId: null, waypoints: [], tool: false };
function routeWaypoints(unit) { return unit && route.unitId === unit.id ? route.waypoints : []; }
function resetRoute() { route.unitId = null; route.waypoints = []; route.tool = false; }
// reachFrom(start, budget, fresh) -> { dist, prev }; returns { path (origin included), costs (cumulative, per hex),
// cost, left, end, reach (from the end, with what is left) } or null when a waypoint is no longer reachable
// Waypoints and path steps are [q, r] or [q, r, 1] (wall walk above a gate); start / end: { q, r, level }
function composeRoute(unit, budget, reachFrom) {
  let cur = { q: unit.q, r: unit.r, level: unit.level ? 1 : 0 }, left = budget, cost = 0, fresh = true;
  const path = [unit.level ? [unit.q, unit.r, 1] : [unit.q, unit.r]], costs = [0];
  for (const w of routeWaypoints(unit)) {
    const { dist, prev } = reachFrom(cur, left, fresh);
    const k = KBRules.stepKey(w);
    if (!dist.has(k)) return null;
    const leg = KBRules.pathFromPrev(prev, nodeKeyOf(cur), k);
    if (!leg || !leg.length) return null;
    for (const s of leg) { path.push(s); costs.push(KBRules.snap(cost + dist.get(KBRules.stepKey(s)))); }
    cost = KBRules.snap(cost + dist.get(k));
    left = Math.max(0, KBRules.snap(left - dist.get(k)));
    cur = { q: w[0], r: w[1], level: w[2] ? 1 : 0 };
    fresh = false;
  }
  return { path, costs, cost, left, end: cur, reach: reachFrom(cur, left, fresh) };
}
// Full route to node k ("q,r" / "q,r^", or (q, r) on the ground) through the waypoints: { path, costs, cost } or null
function extendRoute(R, tq, tr) {
  if (!R) return null;
  const k = typeof tq === 'string' ? tq : `${tq},${tr}`;
  if (k === nodeKeyOf(R.end)) return { path: R.path, costs: R.costs, cost: R.cost };
  if (!R.reach.dist.has(k)) return null;
  const leg = KBRules.pathFromPrev(R.reach.prev, nodeKeyOf(R.end), k);
  if (!leg || !leg.length) return null;
  return { path: [...R.path, ...leg], costs: [...R.costs, ...leg.map((s) => KBRules.snap(R.cost + R.reach.dist.get(KBRules.stepKey(s))))], cost: KBRules.snap(R.cost + R.reach.dist.get(k)) };
}
// Click on hex while a unit is selected: add a waypoint (Maj or tool) or cut the route back to an existing one.
// Returns true when the click was used by the route.
function routeClick(unit, hex, add, movable, onChange) {
  if (!unit) return false;
  const i = routeWaypoints(unit).findIndex(([q, r]) => q === hex.q && r === hex.r);
  if (i !== -1) { route.waypoints = route.waypoints.slice(0, i); onChange(); return true; }
  const k = hexNode(unit, hex, hex.alt);
  if (!add || !movable.has(k)) return false;
  if (route.unitId !== unit.id) { route.unitId = unit.id; route.waypoints = []; }
  route.waypoints.push(KBRules.stepOf(k));
  onChange();
  return true;
}
function seqRouteReach(unit) {
  return (start, budget, fresh) => clientReachable(unit, { start, maxCost: budget, minStep: fresh && KBRules.hasFullSpeed(unit) });
}
function seqRoute(unit) {
  if (!unit || unit.q == null) return null;
  let R = composeRoute(unit, unit.speedRemaining || 0, seqRouteReach(unit));
  if (!R && routeWaypoints(unit).length) {
    // waypoints beyond this turn's reach: the route becomes a march over several turns
    const M = marchRoute(unit);
    if (M) return M;
    resetRoute(); R = composeRoute(unit, unit.speedRemaining || 0, seqRouteReach(unit));
  }
  return R;
}

// ---- MARCH: a destination beyond this turn's reach; the unit walks what it can and goes on over the next turns ----
// Shared by the classic turn and the simultaneous planning (budget = what this turn can pay).
const MARCH_BUDGET = 400;
function marchReach(unit) {
  return (start) => clientReachable(unit, { start, maxCost: MARCH_BUDGET, minStep: false });
}
// Route through the waypoints with no speed limit (R.march = true), or null
function marchRoute(unit) {
  if (!unit || unit.q == null) return null;
  const R = composeRoute(unit, MARCH_BUDGET, marchReach(unit));
  if (R) R.march = true;
  return R;
}
// Hexes a march can reach from the unit (through the waypoints)
let marchReachCache = { sig: null, keys: new Set() };
function marchTargets(unit) {
  if (!unit || unit.q == null) return new Set();
  const sig = `${unit.id}|${nodeKeyOf(unit)}|${routeWaypoints(unit).join(';')}|${(gameState?.units || []).length}`;
  if (marchReachCache.sig === sig) return marchReachCache.keys;
  const R = marchRoute(unit);
  const keys = new Set(R ? R.reach.dist.keys() : []);
  keys.delete(nodeKeyOf(unit));
  marchReachCache = { sig, keys };
  return keys;
}
// Turn boundaries along a path (origin included): index of the last hex reached on each turn.
// first = what this turn can still pay (with the one-step rule when fresh), then turnSpeed per turn (an estimate:
// terrain, stance and night change the real speed turn by turn).
function marchTurns(unit, path, costs, first, fresh) {
  const per = Math.max(1, unit.turnSpeed || unit.speed || 1);
  const ends = [];
  let budget = first, used = 0, minStep = !!fresh;
  if (!(first > 0)) { ends.push(0); budget = per; minStep = true; }
  for (let i = 1; i < path.length; i++) {
    const c = KBRules.snap((costs[i] || 0) - (costs[i - 1] || 0));
    if (used + c <= budget + 1e-9) { used = KBRules.snap(used + c); minStep = false; continue; }
    if (used === 0 && minStep) { used = budget; minStep = false; continue; } // one step is always allowed with full speed
    ends.push(i - 1);
    budget = per;
    used = c <= budget + 1e-9 ? c : budget; // a new turn always pays its first step
    minStep = false;
  }
  ends.push(path.length - 1);
  return ends;
}
// March plan to (tq, tr) or to node key tq: { path (origin included), costs, cost, turnEnds, turns, march: true } or null.
// budget / fresh: what this turn can pay (classic: speedRemaining; planning: the order budget).
function marchPlan(unit, tq, tr, budget, fresh) {
  if (!unit || unit.q == null || !marchTargets(unit).has(typeof tq === 'string' ? tq : `${tq},${tr}`)) return null;
  const R = marchRoute(unit);
  const full = extendRoute(R, tq, tr);
  if (!full || full.path.length < 2) return null;
  const turnEnds = marchTurns(unit, full.path, full.costs, budget, fresh);
  if (turnEnds.length < 2) return null; // reachable this turn: an ordinary move
  return { ...full, turnEnds, turns: turnEnds.length, march: true };
}
let pendingMarch = null; // { unitId, key }: first click on a far hex shows the march, the second one confirms it
function marchLabel(plan) {
  const n = plan.turns;
  return n <= 1 ? 'Marche' : `Marche · ${n} tours`;
}
function refreshRouteTiles() {
  if (window.KBSim && KBSim.active()) { KBSim.refresh(); return; }
  if (!selectedUnit) return;
  movableTiles.clear(); attackableTiles.clear();
  if (gameState?.currentPlayerId === myId && selectedUnit.speedRemaining > 0 && !selectedUnit.isFleeing) computeMovableTiles(selectedUnit);
  if (gameState?.currentPlayerId === myId && !selectedUnit.hasAttacked && !selectedUnit.isFleeing) computeAttackableTiles(selectedUnit);
  updateActionButtons();
  render();
}
// Removes the last waypoint (planning: the move order follows, its destination is the new last waypoint)
function undoRouteStep() {
  const had = route.waypoints.length > 0;
  if (had) route.waypoints.pop(); else route.tool = false;
  if (had && window.KBSim && KBSim.active() && KBSim.routeEdited) KBSim.routeEdited();
  else refreshRouteTiles();
}
// Route summary for the HUD and the previews: { waypoints, cost, left, budget, tool } or null
function routeInfo() {
  if (window.KBSim && KBSim.active()) return KBSim.routeInfo();
  const u = selectedUnit;
  if (!u || !u.isMine || gameState?.currentPlayerId !== myId || !(u.speedRemaining > 0)) return null;
  const R = seqRoute(u);
  return R ? { waypoints: routeWaypoints(u), cost: R.cost, left: R.march ? 0 : R.left, budget: u.speedRemaining, tool: route.tool, march: !!R.march } : null;
}
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
  if ((e.key === 'Escape' || e.key === 'Backspace') && selectedUnit && ((route.waypoints.length && route.unitId === selectedUnit.id) || route.tool)) {
    e.preventDefault();
    undoRouteStep();
    return;
  }
  if (e.key === 'Escape' && !(window.view3d && window.view3d.active) && window.gameBridge) window.gameBridge.deselect();
});
// Classic turn: the last waypoint is the destination — releasing Maj sends the move along the route
document.addEventListener('keyup', (e) => {
  if (e.key !== 'Shift' || route.tool || (window.KBSim && KBSim.active())) return;
  const u = selectedUnit;
  if (!u || !u.isMine || gameState?.currentPlayerId !== myId || !routeWaypoints(u).length) return;
  const R = seqRoute(u);
  if (!R || R.path.length < 2) return;
  const [tq, tr] = R.path[R.path.length - 1];
  wsSend('move_unit', { roomCode, unitId: u.id, targetQ: tq, targetR: tr, path: R.path.slice(1), ...(R.march ? { march: true } : {}) });
  resetRoute();
  movableTiles.clear(); attackableTiles.clear();
  rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
  render();
});

function fmtSpeed(v) {
  if (v == null) return '—';
  return Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString().replace('.', ',');
}

function segmentEdgeKey(q1, r1, q2, r2) {
  if (q1 < q2 || (q1 === q2 && r1 < r2)) return `${q1},${r1}|${q2},${r2}`;
  return `${q2},${r2}|${q1},${r1}`;
}

function drawSegments(ctx) {
  if (Object.keys(segmentData).length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  for (const [edgeKey, segType] of Object.entries(segmentData)) {
    const color = SEGMENT_COLORS_MAP[segType];
    if (!color) continue;
    const parts = edgeKey.split('|');
    const [q1, r1] = parts[0].split(',').map(Number);
    const [q2, r2] = parts[1].split(',').map(Number);
    const dq = q2 - q1, dr = r2 - r1;
    const dirIdx = SEGMENT_EDGE_DIRS.findIndex(([d0, d1]) => d0 === dq && d1 === dr);
    if (dirIdx === -1) continue;
    const { x: cx, y: cy } = hexToPixel(q1, r1);
    const corners = hexCorners(cx, cy);
    const c1 = corners[dirIdx], c2 = corners[(dirIdx + 1) % 6];
    ctx.strokeStyle = color;
    ctx.lineWidth = HEX_SIZE * 0.13;
    ctx.beginPath();
    ctx.moveTo(c1.x, c1.y);
    ctx.lineTo(c2.x, c2.y);
    ctx.stroke();
    if (segType === 'escalier' || segType === 'echelle' || segType === 'rampe') drawClimbArrow(ctx, q1, r1, q2, r2, c1, c2, segType);
  }
  ctx.restore();
}

// Stairs, ladders and ramps: chevrons pointing up the climb (from the lower hex toward the higher one)
function drawClimbArrow(ctx, q1, r1, q2, r2, c1, c2, segType) {
  const H = (mapDoc && mapDoc.height) || {};
  const h1 = H[`${q1},${r1}`] || 0, h2 = H[`${q2},${r2}`] || 0;
  if (h1 === h2) return;
  const [lo, hi] = h1 < h2 ? [[q1, r1], [q2, r2]] : [[q2, r2], [q1, r1]];
  const pl = hexToPixel(...lo), ph = hexToPixel(...hi);
  const len = Math.hypot(ph.x - pl.x, ph.y - pl.y) || 1;
  const ux = (ph.x - pl.x) / len, uy = (ph.y - pl.y) / len;
  const mx = (c1.x + c2.x) / 2, my = (c1.y + c2.y) / 2;
  const s = HEX_SIZE * 0.16;
  ctx.save();
  ctx.strokeStyle = segType === 'escalier' ? '#3b352d' : '#5a3c10';
  ctx.lineWidth = HEX_SIZE * 0.06;
  for (const k of [-0.42, -0.2]) {
    const bx = mx + ux * HEX_SIZE * k, by = my + uy * HEX_SIZE * k;
    ctx.beginPath();
    ctx.moveTo(bx - ux * s - uy * s, by - uy * s + ux * s);
    ctx.lineTo(bx, by);
    ctx.lineTo(bx - ux * s + uy * s, by - uy * s - ux * s);
    ctx.stroke();
  }
  ctx.restore();
}

// Chargement de l'image d'arbre
const treeImage = new Image();
treeImage.src = '/assets/arbre.png';
treeImage.onload = () => render();

// Stance icons
const stanceIcons = {};
const stanceList = ['marche','combat','charge','repos','defense_combat','defense_distance'];
const stanceIconFiles = { marche:'marche', combat:'combat', charge:'charge', repos:'repos', defense_combat:'def_charge', defense_distance:'def_eparse' };
const stanceNames = { marche:'Marche', combat:'Combat', charge:'Charge', repos:'Repos', defense_combat:'Déf. combat', defense_distance:'Déf. distance' };
const TERRAINS_DATA = {
  plain:    { name:'Plaines', vitesse:0, attack_cac:0, attack_tir:0, defense_cac:0, defense_tir:0, puissance_cac:0, puissance_tir:0, intimidation_cac:0, intimidation_tir:0, courage_cac:0, courage_tir:0, esquive_cac:0, esquive_tir:0, precision_cac:0, precision_tir:0, armure:0, armure_tour:0, moral_tour:0, vitalite_tour:0 },
  forest:   { name:'Forêts', vitesse:-1, attack_cac:0, attack_tir:-1, defense_cac:2, defense_tir:2, puissance_cac:0, puissance_tir:-1, intimidation_cac:2, intimidation_tir:2, courage_cac:-1, courage_tir:-2, esquive_cac:1, esquive_tir:2, precision_cac:-1, precision_tir:-1, armure:1, armure_tour:0, moral_tour:0, vitalite_tour:0 },
  river:    { name:'Fleuves', vitesse:-1, attack_cac:-3, attack_tir:-2, defense_cac:-3, defense_tir:-3, puissance_cac:-2, puissance_tir:-2, intimidation_cac:-2, intimidation_tir:-2, courage_cac:-2, courage_tir:-2, esquive_cac:-2, esquive_tir:-2, precision_cac:-2, precision_tir:-1, armure:-1, armure_tour:0, moral_tour:0, vitalite_tour:0 },
  road:     { name:'Routes', vitesse:1, attack_cac:1, attack_tir:1, defense_cac:0, defense_tir:0, puissance_cac:1, puissance_tir:0, intimidation_cac:1, intimidation_tir:0, courage_cac:1, courage_tir:1, esquive_cac:-1, esquive_tir:-1, precision_cac:1, precision_tir:1, armure:0, armure_tour:0, moral_tour:0, vitalite_tour:0 },
  building: { name:'Bâtiments', vitesse:-1, attack_cac:-1, attack_tir:-3, defense_cac:2, defense_tir:2, puissance_cac:0, puissance_tir:-1, intimidation_cac:1, intimidation_tir:2, courage_cac:1, courage_tir:1, esquive_cac:2, esquive_tir:4, precision_cac:-1, precision_tir:-1, armure:2, armure_tour:0, moral_tour:10, vitalite_tour:5 },
  bridge:   { name:'Ponts', vitesse:0, attack_cac:0, attack_tir:1, defense_cac:1, defense_tir:1, puissance_cac:0, puissance_tir:0, intimidation_cac:1, intimidation_tir:0, courage_cac:0, courage_tir:-1, esquive_cac:1, esquive_tir:-1, precision_cac:0, precision_tir:1, armure:0, armure_tour:0, moral_tour:0, vitalite_tour:0 },
};
const STANCES_DATA = {
  marche:           { vitesse:1, attack_cac:-1, attack_tir:-2, defense_cac:-2, defense_tir:-1, puissance_cac:0, puissance_tir:-1, intimidation_cac:1, intimidation_tir:0, courage_cac:-1, courage_tir:-1, esquive_cac:0, esquive_tir:2, precision_cac:0, precision_tir:-2, armure:-1, armure_tour:0, moral_tour:0, vitalite_tour:0 },
  combat:           { vitesse:0, attack_cac:0, attack_tir:0, defense_cac:0, defense_tir:0, puissance_cac:0, puissance_tir:0, intimidation_cac:0, intimidation_tir:0, courage_cac:0, courage_tir:0, esquive_cac:0, esquive_tir:0, precision_cac:0, precision_tir:0, armure:0, armure_tour:0, moral_tour:0, vitalite_tour:0 },
  charge:           { vitesse:2, attack_cac:3, attack_tir:-2, defense_cac:-1, defense_tir:-2, puissance_cac:1, puissance_tir:-1, intimidation_cac:2, intimidation_tir:-1, courage_cac:1, courage_tir:1, esquive_cac:1, esquive_tir:3, precision_cac:2, precision_tir:-2, armure:0, armure_tour:0, moral_tour:-10, vitalite_tour:0 },
  repos:            { vitesse:-1, attack_cac:-2, attack_tir:-2, defense_cac:-2, defense_tir:-2, puissance_cac:-2, puissance_tir:-1, intimidation_cac:-2, intimidation_tir:-1, courage_cac:-1, courage_tir:-1, esquive_cac:0, esquive_tir:-2, precision_cac:-1, precision_tir:-1, armure:0, armure_tour:1, moral_tour:10, vitalite_tour:5 },
  defense_combat:   { vitesse:-1, attack_cac:-2, attack_tir:-1, defense_cac:3, defense_tir:-2, puissance_cac:-1, puissance_tir:0, intimidation_cac:0, intimidation_tir:1, courage_cac:1, courage_tir:-1, esquive_cac:1, esquive_tir:-1, precision_cac:0, precision_tir:-2, armure:1, armure_tour:0, moral_tour:0, vitalite_tour:0 },
  defense_distance: { vitesse:0, attack_cac:-3, attack_tir:0, defense_cac:-2, defense_tir:0, puissance_cac:-2, puissance_tir:0, intimidation_cac:-2, intimidation_tir:-1, courage_cac:-1, courage_tir:1, esquive_cac:2, esquive_tir:4, precision_cac:-2, precision_tir:-1, armure:0, armure_tour:0, moral_tour:0, vitalite_tour:0 },
};

// ---- Stance display (pictogram + colour on tokens, plates, HUD card, attack tip and combat card) ----
// Icons: 24x24 stroke paths (drawn white on the stance colour), shared by the HTML chips and the 2D canvas
const STANCE_STYLE = {
  marche: { c: '#5f5f5f', icon: 'M8 4.5a1.6 1.6 0 1 0 .01 0M7 8l-2 5 3 1M7.5 8.5l3 3.5 3 1M6.5 14l-1.5 6M8 14l3 3v3M14 9h6M17 6l3 3-3 3' },
  combat: { c: '#111111', icon: 'M5 5l12 12M19 5L7 17M15 19l4-4M5 15l4 4M3 21l2-2M21 21l-2-2' },
  charge: { c: '#D8352A', icon: 'M3 12h7M8 6l6 6-6 6M14 6l6 6-6 6' },
  repos: { c: '#3b78b8', icon: 'M19 14.5A8 8 0 1 1 9.5 5a6.2 6.2 0 0 0 9.5 9.5zM15 4h4l-4 4h4' },
  defense_combat: { c: '#a8790c', icon: 'M12 3l7.5 3v5.5c0 5-3.5 8-7.5 9.5-4-1.5-7.5-4.5-7.5-9.5V6zM12 7v10M8 11h8' },
  defense_distance: { c: '#2a8270', icon: 'M13 4l7 2.7v5c0 4.6-3.2 7.4-7 8.8-3.8-1.4-7-4.2-7-8.8M3 3l7 7M3 3v3.5M3 3h3.5' },
};
const STANCE_PATHS2D = {};
function stanceIconSvg(id, size = 14, color = '#fff') {
  const d = (STANCE_STYLE[id] || {}).icon;
  if (!d) return '';
  return `<svg class="st-ico" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
}
function drawStanceIcon(c2d, id, cx, cy, size, color = '#fff') {
  const d = (STANCE_STYLE[id] || {}).icon;
  if (!d || typeof Path2D === 'undefined') return;
  const path = STANCE_PATHS2D[id] || (STANCE_PATHS2D[id] = new Path2D(d));
  const k = size / 24;
  c2d.save();
  c2d.translate(cx - size / 2, cy - size / 2);
  c2d.scale(k, k);
  c2d.strokeStyle = color;
  c2d.lineWidth = 2.6;
  c2d.lineCap = 'round';
  c2d.lineJoin = 'round';
  c2d.stroke(path);
  c2d.restore();
}
const STANCE_FULL_NAMES = { defense_combat: 'Défense de combat', defense_distance: 'Défense à distance' };
function stanceStyle(id) {
  const st = STANCE_STYLE[id] || { c: '#444' };
  return { ...st, k: '', svg: stanceIconSvg(id), name: STANCE_FULL_NAMES[id] || stanceNames[id] || id, short: stanceNames[id] || id };
}
// Non-zero modifiers of a stance: [{ label, v, key }]; kind 'cac' | 'tir' keeps the general ones plus that kind only
const STANCE_FIELDS = [
  ['vitesse', 'vitesse'], ['attack_cac', 'attaque mêlée'], ['attack_tir', 'attaque tir'], ['defense_cac', 'défense mêlée'], ['defense_tir', 'défense contre tirs'],
  ['puissance_cac', 'puissance mêlée'], ['puissance_tir', 'puissance tir'], ['intimidation_cac', 'intimidation mêlée'], ['intimidation_tir', 'intimidation tir'],
  ['courage_cac', 'courage mêlée'], ['courage_tir', 'courage tir'], ['esquive_cac', 'esquive mêlée'], ['esquive_tir', 'esquive tirs'],
  ['precision_cac', 'précision mêlée'], ['precision_tir', 'précision tir'], ['armure', 'armure'],
  ['armure_tour', 'armure / tour'], ['moral_tour', 'moral / tour'], ['vitalite_tour', 'vitalité / tour'],
];
function stanceEffects(id, kind = null) {
  const d = STANCES_DATA[id] || {};
  return STANCE_FIELDS.filter(([k]) => d[k] && (!kind || !/_(cac|tir)$/.test(k) || k.endsWith(`_${kind}`)))
    .map(([k, label]) => ({ key: k, label, v: d[k] }));
}
function stanceEffectsText(id, kind = null, max = 99) {
  const list = stanceEffects(id, kind);
  if (!list.length) return 'aucun modificateur (posture neutre)';
  return list.slice(0, max).map(e => `${e.v > 0 ? '+' : '−'}${Math.abs(e.v)} ${e.label}`).join(' · ') + (list.length > max ? ' …' : '');
}
// Angle of attack against a unit in this stance (RULES.combat.angleMods: front, front flank, rear flank, back)
function stanceAngleText(id) {
  const t = (KBRules.RULES.combat && KBRules.RULES.combat.angleMods || {})[id];
  if (!t) return '';
  const parts = [];
  if (t[1] || t[5]) parts.push(`flancs avant +${Math.max(t[1], t[5])}`);
  if (t[2] || t[4]) parts.push(`flancs arrière +${Math.max(t[2], t[4])}`);
  if (t[3]) parts.push(`dos +${t[3]}`);
  if (t[0]) parts.push(`face +${t[0]}`);
  return parts.length ? `attaquée : ${parts.join(', ')}` : '';
}
// Response of a unit attacked in this stance in simultaneous mode (RULES.simultaneous.stanceReaction)
function stanceReactionText(id) {
  const r = KBRules.RULES.simultaneous && KBRules.RULES.simultaneous.stanceReaction ? KBRules.RULES.simultaneous.stanceReaction[id] : null;
  return { counter: 'contre-attaque', absorb: 'encaisse', rien: 'ne répond pas' }[r] || '';
}

// Balance data (data/balance/*.json): /api/balance on the local server, else the tables frozen for the battle
// (game_state.balanceTables, sent at battle start and on resync). The hardcoded copies above are the fallback.
function applyBalanceTables(t) {
  if (!t) return;
  if (t.units) UNIT_TYPES = t.units;
  for (const [k, v] of Object.entries(t.terrains || {})) TERRAINS_DATA[k] = { ...(TERRAINS_DATA[k] || {}), ...v };
  for (const [k, v] of Object.entries(t.segments || {})) {
    const special = SEGMENT_DEFS_CLIENT[k]?.special;
    SEGMENT_DEFS_CLIENT[k] = { ...(SEGMENT_DEFS_CLIENT[k] || {}), ...v, special: special !== undefined ? special : v.special };
  }
  for (const [k, v] of Object.entries(t.stances || {})) {
    STANCES_DATA[k] = { ...(STANCES_DATA[k] || {}), ...v };
    if (v.name && !stanceNames[k]) stanceNames[k] = v.name;
  }
  if (selectedUnit) showUnitDetail(selectedUnit);
}

fetch('/api/balance').then(r => (r.ok ? r.json() : null)).then((d) => { if (d && d.tables && d.tables.units) UNIT_TYPES = d.tables.units; if (d && d.tables && !gameState?.balanceTables) applyBalanceTables(d.tables); }).catch(() => {});
for (const s of stanceList) {
  if (!stanceIconFiles[s]) continue;
  const img = new Image();
  img.src = `/assets/icons/${stanceIconFiles[s]}.svg`;
  img.onload = () => render();
  stanceIcons[s] = img;
}

// Tokens des généraux
const GENERAL_TOKEN_MAP = {
  'ou_ki':       'Ou Ki',
  'ou_sen':      'Ou Sen',
  'kei_sha':     'Kei Sha',
  'shi_ba_shou': 'Shi Ba Shou',
  'ren_pa':      'Ren Pa',
  'go_hou_mei':  'Go Hou Mei',
};
const GENERAL_IMAGE1_MAP = {
  'ou_ki':       { file: 'OU KI 1-1',       ext: 'jpg' },
  'ou_sen':      { file: 'OU SEN 1-1',       ext: 'png' },
  'mou_bu':      { file: 'MOU BU 1-1',       ext: 'jpg' },
  'kan_ki':      { file: 'KAN KI 1-1',       ext: 'jpg' },
  'ri_boku':     { file: 'RI BOKU 1-1',      ext: 'jpg' },
  'kei_sha':     { file: 'KEI SHA 1-1',      ext: 'jpg' },
  'shi_ba_shou': { file: 'SHI BA SHOU 1-1',  ext: 'jpg' },
  'ren_pa':      { file: 'REN PA 1-1',       ext: 'jpg' },
  'go_hou_mei':  { file: 'GO HOU MEI 1-1',   ext: 'jpg' },
  'gai_mou':     { file: 'GAI MOU',          ext: 'jpg' },
};
const UNIT_IMAGE1_MAP = {
  'pietaille':      { file: 'PIETAILLE 1-1',       ext: 'jpeg' },
  'soldats':        { file: 'SOLDAT',               ext: 'jpg'  },
  'phalange':       { file: 'PHALANGE 1-1',         ext: 'png'  },
  'lancier':        { file: 'LANCIER 1-1',          ext: 'jpg'  },
  'espion':         { file: 'ESPION 1-1',           ext: 'png'  },
  'assassin':       { file: "ASSASSIN 1-1",         ext: 'jpg'  },
  'cavalier_leger': { file: 'CAVALIER LEGER 1-1',   ext: 'jpg'  },
  'cavalier_lourd': { file: 'CAVALIER LOURD 1-1',   ext: 'jpg'  },
  'archer':         { file: 'ARCHER 1-1',           ext: 'jpg'  },
  'archer_elite':   { file: "ARCHER D'ELITE 1-1",   ext: 'jpg'  },
  'batisseurs':     { file: 'BATISSEUR 1-1',        ext: 'jpg'  },
  'char':           { file: 'CHAR 1-1',             ext: 'png'  },
};
function img1Url(map, key, folder) {
  const entry = map[key];
  if (!entry) return null;
  return `/assets/unites/${folder}/${encodeURIComponent(entry.file)}.${entry.ext}`;
}

const generalTokenImages = {};
for (const [id, name] of Object.entries(GENERAL_TOKEN_MAP)) {
  const img = new Image();
  img.src = `/assets/unites/GENERAL TOKEN/${encodeURIComponent(name)}.png`;
  img.onload = () => render();
  generalTokenImages[id] = img;
}

// Tokens des unités
const UNIT_TOKEN_MAP = {
  'pietaille':      "Piétaille",
  'soldats':        "Soldats",
  'phalange':       "Phalange",
  'lancier':        "Lanciers",
  'espion':         "Espions",
  'assassin':       "Assassins",
  'cavalier_leger': "Cavalerie légère",
  'cavalier_lourd': "Cavalerie Loude",
  'archer':         "Archer léger",
  'archer_elite':   "Archer d'Elite",
  'batisseurs':     "Batisseurs",
  'char':           "Chars",
};
const unitTokenImages = {};
for (const [id, name] of Object.entries(UNIT_TOKEN_MAP)) {
  const img = new Image();
  img.src = `/assets/unites/UNIT TOKEN/${encodeURIComponent(name)}.png`;
  img.onload = () => render();
  unitTokenImages[id] = img;
}

// Aléatoire déterministe basé sur les coordonnées hex (pour placement stable des arbres)
function seededRand(seed) {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

function drawForestTrees(ctx) {
  if (!treeImage.complete || !treeImage.naturalWidth) return;

  const allUnits = [...(gameState?.units || []), ...(deployState?.units || [])];

  // Cases directement occupées par un pion
  const unitHexes = new Set();
  for (const u of allUnits) {
    if (u.q !== null) unitHexes.add(`${u.q},${u.r}`);
  }

  // Cases dans la vision
  const visibleHexes = gameState?.visibleHexes || new Set();

  for (const [key, terrain] of Object.entries(terrainData)) {
    if (terrain !== 'forest') continue;
    const [q, r] = key.split(',').map(Number);
    const { x, y } = hexToPixel(q, r);

    let alpha;
    if (unitHexes.has(key)) {
      alpha = 0;
    } else if (visibleHexes.has(key)) {
      alpha = 0.10;
    } else {
      alpha = 0.65;
    }
    if (alpha === 0) continue;

    const treeCount = 7 + Math.floor(seededRand(q * 137 + r * 251) * 4);
    for (let i = 0; i < treeCount; i++) {
      const s1 = q * 1000 + r * 100 + i * 7 + 1;
      const s2 = q * 2000 + r * 200 + i * 13 + 2;
      const s3 = q * 3000 + r * 300 + i * 17 + 3;
      const s4 = q * 4000 + r * 400 + i * 23 + 4;
      const offsetX = (seededRand(s1) - 0.5) * HEX_SIZE * 1.1;
      const offsetY = (seededRand(s2) - 0.5) * HEX_SIZE * 0.9;
      const rotation = seededRand(s3) * Math.PI * 2;
      const size = HEX_SIZE * (1.5 + seededRand(s4) * 0.7);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x + offsetX, y + offsetY);
      ctx.rotate(rotation);
      ctx.drawImage(treeImage, -size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }
}

const TERRAIN_BASE_COLORS = {
  plain:    '#7d7a45',
  forest:   '#3f5a26',
  river:    '#3a6a9a',
  road:     '#a08a5a',
  building: '#6e5a44',
  bridge:   '#8a6a3a',
};

const TERRAIN_COLORS = {
  forest:   'rgba(30,100,20,0.7)',
  river:    'rgba(40,120,220,0.7)',
  building: 'rgba(140,100,60,0.8)',
  road:     'rgba(200,170,100,0.6)',
  bridge:   'rgba(220,140,30,0.8)',
};

// State
const initialSession = KBNet.getSession();
let myId = initialSession ? initialSession.playerId : null;
let roomCode = initialSession ? initialSession.roomCode : null;
let isSpectator = !!(initialSession && initialSession.role === 'spectator');
let gameState = null;
let deployState = null;
let cameraPlaced = false;

// Animations de déplacement : unitId → { path:[[q,r],...], startTime, stepMs }
const unitAnimations = {};
const ANIM_STEP_MS = 200;
let animLoopRunning = false;

function startAnimLoop() {
  if (animLoopRunning) return;
  animLoopRunning = true;
  function loop() {
    const now = performance.now();
    let anyActive = false;
    for (const id of Object.keys(unitAnimations)) {
      const a = unitAnimations[id];
      const totalSteps = a.path.length;
      const elapsed = now - a.startTime;
      const currentStep = Math.floor(elapsed / ANIM_STEP_MS);
      if (currentStep >= totalSteps) {
        delete unitAnimations[id];
      } else {
        anyActive = true;
      }
    }
    render();
    if (anyActive) requestAnimationFrame(loop);
    else animLoopRunning = false;
  }
  requestAnimationFrame(loop);
}

function getAnimatedPos(unit) {
  const a = unitAnimations[unit.id];
  if (!a) return null;
  const elapsed = performance.now() - a.startTime;
  const stepF = elapsed / ANIM_STEP_MS;
  const step = Math.floor(stepF);
  const t = stepF - step;
  const totalSteps = a.path.length;
  if (step >= totalSteps) return null;
  // Position de départ de ce step
  const fromPos = step === 0 ? hexToPixel(a.fromQ, a.fromR) : hexToPixel(a.path[step - 1][0], a.path[step - 1][1]);
  const toPos = hexToPixel(a.path[step][0], a.path[step][1]);
  return { x: fromPos.x + (toPos.x - fromPos.x) * t, y: fromPos.y + (toPos.y - fromPos.y) * t };
}
function buildZoneTileSet(state) {
  if (state?.startingZone?.tiles && !(state.startingZone.tileSet instanceof Set)) {
    state.startingZone.tileSet = new Set(state.startingZone.tiles.map(t => `${t.q},${t.r}`));
  }
  if (state?.blockedTiles && !(state.blockedTiles.footSet instanceof Set)) {
    state.blockedTiles.footSet = new Set(state.blockedTiles.foot || []);
    state.blockedTiles.mountedSet = new Set(state.blockedTiles.mounted || []);
  }
}
// Zone hexes where this unit would be stuck (server-computed: outside the map's main connected area for its mobility)
function deployBlockedFor(unit) {
  const b = deployState?.blockedTiles;
  if (!unit || !b) return null;
  const set = window.KBRules && KBRules.isMounted(unit) ? b.mountedSet : b.footSet;
  return set && set.size ? set : null;
}

let mode = 'select'; // select | move | attack | deploy
let selectedUnit = null;
let hoveredHex = null;
let movableTiles = new Set();
let abilityTiles = new Map();   // hex key -> unit ability options (espion, bâtisseurs) in mode 'ability'
let attackableTiles = new Set();
let showWeakness = false; // friend's weak-sides overlay (2D)
let approachAttacks = new Map(); // enemy hex -> { targetId, q, r, path }: out of range, reachable by moving first (one action)
let rangeTiles = new Set();
let rangeCenter = null;
let motivateTiles = new Set();
let motivateCenter = null;
let deployTiles = new Set();

// Camera — recentrée sur la carte une fois chargée
let zoom = 0.3;
let camX = 0;
let camY = 0;

// Frames hexes in 2D (pan, zoom out if they do not fit); false when they are already on screen
function frameHexes2D(hexes, margin = 0.14) {
  if (!hexes.length || (window.view3d && window.view3d.active)) return false;
  const pts = hexes.map(h => hexToPixel(h.q, h.r));
  const W = canvas.width, H = canvas.height;
  const inside = (z, cx, cy) => pts.every(p => { const sx = p.x * z + cx + W / 2, sy = p.y * z + cy + H / 2; return sx > W * margin && sx < W * (1 - margin) && sy > H * margin && sy < H * (1 - margin); });
  if (inside(zoom, camX, camY)) return false;
  const x0 = Math.min(...pts.map(p => p.x)), x1 = Math.max(...pts.map(p => p.x));
  const y0 = Math.min(...pts.map(p => p.y)), y1 = Math.max(...pts.map(p => p.y));
  const fit = Math.min(W * (1 - 2 * margin) / (x1 - x0 + HEX_SIZE * 3), H * (1 - 2 * margin) / (y1 - y0 + HEX_SIZE * 3));
  const z1 = Math.min(zoom, Math.max(0.3, fit));
  const cx1 = -(x0 + x1) / 2 * z1, cy1 = -(y0 + y1) / 2 * z1;
  const z0 = zoom, cx0 = camX, cy0 = camY, t0 = performance.now(), dur = 700;
  (function step(now) {
    const t = Math.min(1, (now - t0) / dur), e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    zoom = z0 + (z1 - z0) * e; camX = cx0 + (cx1 - cx0) * e; camY = cy0 + (cy1 - cy0) * e;
    render();
    if (t < 1) requestAnimationFrame(step);
  })(t0);
  return true;
}

// Fog of war: distance (1..16) of each hidden hex to the visible area, darker farther away, black at 16 (cached per vision set)
const FOG_DIST_MAX = 100;
let fogDistCache = { src: null, map: new Map() };
function fogDistances(visible) {
  if (!visible || fogDistCache.src === visible) return fogDistCache.map;
  const map = new Map();
  let frontier = [...visible].map(k => k.split(',').map(Number));
  const seen = new Set(visible);
  for (let d = 1; d <= FOG_DIST_MAX && frontier.length; d++) {
    const next = [];
    for (const [q, r] of frontier) for (const [dq, dr] of SEGMENT_EDGE_DIRS) {
      const k = `${q + dq},${r + dr}`;
      if (seen.has(k)) continue;
      seen.add(k); map.set(k, d); next.push([q + dq, r + dr]);
    }
    frontier = next;
  }
  fogDistCache = { src: visible, map };
  return map;
}

function smoothPanTo(worldX, worldY, durationMs = 600) {
  if (window.view3d && window.view3d.active) { const h = pixelToHex(worldX, worldY); window.view3d.focusHex(h.q, h.r); return; }
  const startX = camX, startY = camY;
  const targetX = -worldX * zoom, targetY = -worldY * zoom;
  const startTime = performance.now();
  function step(now) {
    const t = Math.min(1, (now - startTime) / durationMs);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    camX = startX + (targetX - startX) * ease;
    camY = startY + (targetY - startY) * ease;
    render();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
let isDragging = false, dragStart = null, camAtDrag = null;

// Player colors
const PLAYER_COLORS = [
  '#e05020', '#2070e0', '#20a020', '#e0c020',
  '#a020e0', '#e02080', '#20e0c0', '#e08020'
];

function getPlayerColor(playerId) {
  // during the deployment there is no game state yet: the colours come with the deployment state
  const players = (gameState && gameState.players) || (deployState && deployState.players) || [];
  const player = players.find(p => p.id === playerId);
  return player?.color || '#4a90d9';
}

// ---- CANVAS SETUP ----
function resizeCanvas() {
  const area = document.getElementById('canvas-area');
  canvas.width = area.clientWidth;
  canvas.height = area.clientHeight;
  render();
}
window.addEventListener('resize', resizeCanvas);
if (window.ResizeObserver) {
  let lastW = 0, lastH = 0;
  new ResizeObserver(() => {
    const area = document.getElementById('canvas-area');
    if (area.clientWidth === lastW && area.clientHeight === lastH) return;
    lastW = area.clientWidth; lastH = area.clientHeight;
    resizeCanvas();
  }).observe(document.getElementById('canvas-area'));
}

// ---- RENDER ----
function render() {
  if (window.view3d && window.view3d.active) { window.view3d.markDirty(); return; }
  if (!canvas.width) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(canvas.width / 2 + camX, canvas.height / 2 + camY);
  ctx.scale(zoom, zoom);

  // Dessin de la carte en arrière-plan (calibration propre à la carte) ou cases colorées par terrain
  if (mapBg && mapImage.complete && mapImage.naturalWidth) {
    const scale = HEX_SIZE / mapBg.hexSize;
    ctx.drawImage(mapImage, -mapBg.origX * scale, -mapBg.origY * scale, mapBg.width * scale, mapBg.height * scale);
  } else if (mapDoc && !mapBg) {
    for (const h of mapHexes) {
      const { x, y } = hexToPixel(h.q, h.r);
      drawHex(ctx, x, y, TERRAIN_BASE_COLORS[terrainData[h.key] || 'plain'] || TERRAIN_BASE_COLORS.plain, 'rgba(0,0,0,0.25)', 1, 1);
      const hh = mapDoc.height[h.key] || 0;
      if (hh > 3) drawHex(ctx, x, y, `rgba(205,192,168,${Math.min(0.5, (hh - 3) * 0.07)})`, 'rgba(0,0,0,0)', 1, 1);
    }
  }
  if (mapDoc && window.KBMapProps) KBMapProps.drawDecor2D(ctx, mapDoc.decor, hexToPixel, HEX_SIZE);
  if (window.KBCorpses) KBCorpses.draw2D(ctx, hexToPixel, HEX_SIZE);

  const visibleSet = new Set(gameState?.visibleHexes || []);
  const startZone = deployState?.startingZone;

  if (gameState && gameState.phase === 'battle') {
    const fogDist = fogDistances(gameState.visibleHexes);
    const fogLight = (window.kbFogStyle || JSON.parse(localStorage.getItem('kb_view3d_settings') || '{}').fogStyle) === 'light';
    for (const { q, r, key } of mapHexes) {
      const { x, y } = hexToPixel(q, r);
      const isVisible = visibleSet.has(key);
      const isHovered = hoveredHex && hoveredHex.q === q && hoveredHex.r === r;
      const fogFar = 1 - Math.exp(-((fogDist.get(key) || FOG_DIST_MAX) - 1) / 12);
      let fill = isVisible ? 'rgba(0,0,0,0)' : `rgba(4,3,3,${(fogLight ? 0.42 + 0.14 * fogFar : 0.55 + 0.42 * fogFar).toFixed(3)})`;
      let stroke = isVisible ? `rgba(${gridColorRGB},${gridOpacity})` : 'rgba(0,0,0,0)';
      if (isVisible && (movableTiles.has(key) || movableTiles.has(key + '^'))) fill = 'rgba(255,255,255,0.22)';
      if (abilityTiles.has(key)) fill = 'rgba(47,95,168,0.45)';
      if (isVisible && attackableTiles.has(key)) fill = approachAttacks.has(key) ? 'rgba(216,53,42,0.24)' : 'rgba(216,53,42,0.45)';
      if (isHovered && isVisible) stroke = '#D8352A';
      drawHex(ctx, x, y, fill, stroke, 1, gridThickness);
    }
  } else {
    const zoneKeys = new Set();
    const deployStuck = mode === 'deploy' ? deployBlockedFor(selectedUnit) : null;
    for (const { q, r } of mapHexes) {
      const { x, y } = hexToPixel(q, r);
      const inZone = startZone?.tileSet ? startZone.tileSet.has(`${q},${r}`) : (startZone ? hexDistance(q, r, startZone.q, startZone.r) <= (startZone.radius || 4) : false);
      if (inZone) zoneKeys.add(`${q},${r}`);
      const isHovered = hoveredHex && hoveredHex.q === q && hoveredHex.r === r;
      let fill = inZone ? 'rgba(255,255,255,0.3)' : 'rgba(14,12,10,0.4)';
      if (inZone && deployStuck && deployStuck.has(`${q},${r}`)) fill = 'rgba(216,53,42,0.42)';
      let stroke = inZone ? `rgba(0,0,0,${Math.min(1, 0.25 + gridOpacity * 2)})` : `rgba(${gridColorRGB},${gridOpacity * 0.6})`;
      if (inZone && isHovered) fill = 'rgba(255,255,255,0.55)';
      if (isHovered && !inZone) stroke = 'rgba(216,53,42,0.5)';
      drawHex(ctx, x, y, fill, stroke, 1, gridThickness);
    }
    if (zoneKeys.size) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (const key of zoneKeys) {
        const [q, r] = key.split(',').map(Number);
        const { x, y } = hexToPixel(q, r);
        const corners = hexCorners(x, y);
        for (let i = 0; i < 6; i++) {
          const [dq, dr] = SEGMENT_EDGE_DIRS[i];
          if (!zoneKeys.has(`${q + dq},${r + dr}`)) {
            ctx.moveTo(corners[i].x, corners[i].y);
            ctx.lineTo(corners[(i + 1) % 6].x, corners[(i + 1) % 6].y);
          }
        }
      }
      ctx.strokeStyle = '#000'; ctx.lineWidth = 6 / zoom; ctx.stroke();
      ctx.strokeStyle = '#D8352A'; ctx.lineWidth = 3 / zoom; ctx.stroke();
      ctx.restore();
    }
  }

  if (rangeTiles.size > 0 && rangeCenter) strokeZone(rangeTiles, rangeCenter, '#ffce5c');
  if (motivateTiles.size > 0 && motivateCenter) strokeZone(motivateTiles, motivateCenter, '#6ebeff');
  {
    const rp = rangePreview();
    if (rp && rp.keys.size) strokeZone(rp.keys, rp.center, rp.kind === 'tir' ? '#ffce5c' : '#6ebeff', [10, 7]);
  }

  // Weak sides (friend's tool): each unit's open edges coloured by the angle-of-attack bonus an enemy would get there
  // (green: front, orange: flank, red: back — RULES.combat.angleMods of its stance), edges shared with a friend excluded
  if (showWeakness) {
    const DIRS6 = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
    const all = gameState?.units || [];
    const angleMods = KBRules.RULES.combat.angleMods;
    const sideOf = (u) => (u.isMine || u.isAlly ? 'friend' : u.playerId);
    const posBySide = {};
    for (const u of all) { if (u.q === null) continue; (posBySide[sideOf(u)] = posBySide[sideOf(u)] || new Set()).add(`${u.q},${u.r}`); }
    for (const u of all) {
      if (u.q === null || u.facing == null || u.isGeneral) continue;
      const table = angleMods[u.stance] || angleMods.combat;
      const mine = posBySide[sideOf(u)];
      const colors = new Array(6).fill(null);
      for (let dirIdx = 0; dirIdx < 6; dirIdx++) {
        if (mine.has(`${u.q + DIRS6[dirIdx][0]},${u.r + DIRS6[dirIdx][1]}`)) continue;
        const mod = table[(dirIdx - u.facing + 6) % 6] || 0;
        colors[(6 - dirIdx) % 6] = mod >= 4 ? 'rgba(216,53,42,0.9)' : mod >= 2 ? 'rgba(232,150,40,0.9)' : 'rgba(60,170,80,0.85)';
      }
      const pos = getAnimatedPos(u) || hexToPixel(u.q, u.r);
      drawHexWeakness(ctx, pos.x, pos.y, colors);
    }
  }

  // Draw units
  const units = gameState?.units || [];
  const myUnits = deployState?.units || [];

  // Deployment units
  if (deployState && mode === 'deploy') {
    for (const u of myUnits) {
      if (u.q === null) continue;
      const { x, y } = hexToPixel(u.q, u.r);
      drawUnit(ctx, x, y, u, myId);
    }
  }

  // Battle units
  for (const u of units) {
    if (u.q === null) continue;
    const animPos = getAnimatedPos(u);
    const base = animPos || hexToPixel(u.q, u.r);
    // on the wall walk above a gate: drawn higher on its hex, standing on a strip of battlements
    const top = !animPos && u.level;
    const x = base.x, y = top ? base.y - HEX_SIZE * 0.42 : base.y;
    const isSelected = selectedUnit && selectedUnit.id === u.id;

    // Vision radius for general (highlight)
    if (isSelected && u.visionRange > 0) {
      drawHex(ctx, base.x, base.y, 'transparent', 'rgba(216,53,42,0.4)', 0.5);
    }

    drawUnit(ctx, x, y, u, u.playerId, isSelected);
    if (top) {
      const w = HEX_SIZE * 1.1, h = HEX_SIZE * 0.16, by = y + HEX_SIZE * 0.5;
      ctx.save();
      ctx.fillStyle = '#8c8274'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.fillRect(x - w / 2, by, w, h); ctx.strokeRect(x - w / 2, by, w, h);
      for (let i = 0; i < 5; i++) { const cx = x - w / 2 + (i + 0.25) * (w / 5); ctx.fillRect(cx, by - h * 0.7, w / 10, h * 0.7); ctx.strokeRect(cx, by - h * 0.7, w / 10, h * 0.7); }
      ctx.restore();
    }
  }

  // Arbres par dessus les unités
  drawForestTrees(ctx);

  if (gameState) drawObjectives(ctx);
  drawMarches(ctx, false);
  if (window.KBSim) KBSim.draw(ctx);
  drawMarches(ctx, true);
  drawRoutePreview(ctx);
  drawApproachPreview(ctx);

  // Overlays de terrain (si activé) — par dessus les arbres
  if (showTerrain) {
    for (const [key, terrain] of Object.entries(terrainData)) {
      const color = TERRAIN_COLORS[terrain];
      if (!color) continue;
      const [q, r] = key.split(',').map(Number);
      const { x, y } = hexToPixel(q, r);
      drawHex(ctx, x, y, color, 'rgba(0,0,0,0)');
    }
  }

  // Segments (arêtes entre tuiles) — visibles quand le toggle terrain est actif
  if (showTerrain) drawSegments(ctx);

  // Pings
  drawPings(ctx);

  // Coordonnées Q,R sur chaque case
  if (showCoords) {
    ctx.save();
    ctx.font = `bold ${Math.round(HEX_SIZE * 0.22)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const state = gameState || (deployState ? { phase: 'deployment' } : null);
    if (state) {
      const S = Math.sqrt(3);
      const qMin = Math.floor((-canvas.width / 2 - camX) / zoom / (HEX_SIZE * 1.5)) - 1;
      const qMax = Math.ceil((canvas.width / 2 - camX) / zoom / (HEX_SIZE * 1.5)) + 1;
      for (let q = qMin; q <= qMax; q++) {
        const rMin2 = Math.floor(((-canvas.height / 2 - camY) / zoom - HEX_SIZE * S / 2 * q) / (HEX_SIZE * S)) - 1;
        const rMax2 = Math.ceil(((canvas.height / 2 - camY) / zoom - HEX_SIZE * S / 2 * q) / (HEX_SIZE * S)) + 1;
        for (let r = rMin2; r <= rMax2; r++) {
          const { x, y } = hexToPixel(q, r);
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillText(`${q},${r}`, x + 0.5, y + 0.5);
          ctx.fillStyle = 'rgba(255,220,100,0.9)';
          ctx.fillText(`${q},${r}`, x, y);
        }
      }
    }
    ctx.restore();
  }

  ctx.restore();

  if (gameState?.isNight && gameState.phase === 'battle') {
    ctx.fillStyle = 'rgba(8,16,48,0.32)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawObjectives(ctx) {
  for (const o of gameState.objectives || []) {
    const { x, y } = hexToPixel(o.q, o.r);
    const color = o.owner ? getPlayerColor(o.owner) : '#d8c9a0';
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = HEX_SIZE * 0.08;
    ctx.setLineDash([HEX_SIZE * 0.15, HEX_SIZE * 0.1]);
    ctx.beginPath();
    ctx.arc(x, y, HEX_SIZE * 0.8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#3b2a1a';
    ctx.fillRect(x + HEX_SIZE * 0.45, y - HEX_SIZE * 0.75, HEX_SIZE * 0.05, HEX_SIZE * 0.7);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + HEX_SIZE * 0.5, y - HEX_SIZE * 0.75);
    ctx.lineTo(x + HEX_SIZE * 0.85, y - HEX_SIZE * 0.62);
    ctx.lineTo(x + HEX_SIZE * 0.5, y - HEX_SIZE * 0.5);
    ctx.fill();
    ctx.font = `900 ${Math.round(HEX_SIZE * 0.24)}px 'Zen Kaku Gothic New', sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = HEX_SIZE * 0.08;
    ctx.strokeText(`${o.name} (${o.points})`, x, y + HEX_SIZE * 0.95);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${o.name} (${o.points})`, x, y + HEX_SIZE * 0.95);
    ctx.restore();
  }
}

function getGeneralIdForUnit(unit) {
  if (!unit.isGeneral) return null;
  if (gameState) {
    const player = gameState.players.find(p => p.id === unit.playerId);
    if (player?.generalId) return player.generalId;
  }
  // Pendant le déploiement, utiliser le generalId stocké dans l'unité ou deployState
  if (unit.generalId) return unit.generalId;
  if (deployState?.generalData?.id) return deployState.generalData.id;
  return null;
}

function drawTokenImage(ctx, img, x, y, radius, tintColor, tintOpacity = 0.25, overlayColor = null, rotAngle = 0) {
  const RES = 4; // suréchantillonnage pour éviter le flou au zoom
  const size = Math.ceil(radius * 2 * RES);
  const off = document.createElement('canvas');
  off.width = size; off.height = size;
  const o = off.getContext('2d');
  o.imageSmoothingEnabled = true;
  o.imageSmoothingQuality = 'high';
  o.beginPath();
  o.arc(radius * RES, radius * RES, radius * RES, 0, Math.PI * 2);
  o.clip();
  o.save();
  o.translate(radius * RES, radius * RES);
  o.rotate(rotAngle);
  o.drawImage(img, -radius * RES, -radius * RES, size, size);
  o.restore();
  o.globalCompositeOperation = 'source-atop';
  if (tintColor) {
    const r = parseInt(tintColor.slice(1,3),16);
    const g = parseInt(tintColor.slice(3,5),16);
    const b = parseInt(tintColor.slice(5,7),16);
    o.fillStyle = `rgba(${r},${g},${b},${tintOpacity})`;
    o.fillRect(0, 0, size, size);
  }
  if (overlayColor) {
    o.fillStyle = overlayColor;
    o.fillRect(0, 0, size, size);
  }
  ctx.drawImage(off, x - radius, y - radius, radius * 2, radius * 2);
}

function getAnimatedFacing(unit) {
  const a = unitAnimations[unit.id];
  if (!a) return unit.facing ?? 5;
  const elapsed = performance.now() - a.startTime;
  const step = Math.floor(elapsed / ANIM_STEP_MS);
  if (step >= a.path.length) return unit.facing ?? 5;
  const prevQ = step === 0 ? a.fromQ : a.path[step - 1][0];
  const prevR = step === 0 ? a.fromR : a.path[step - 1][1];
  return hexFacingClient(prevQ, prevR, a.path[step][0], a.path[step][1]);
}

function drawUnit(ctx, x, y, unit, playerId, isSelected = false) {
  const color = getPlayerColor(playerId);
  const size = HEX_SIZE * 0.55;
  const rotAngle = FACING_ANGLES[getAnimatedFacing(unit)];

  ctx.save();

  if (unit.isMine && unit.concealed) {
    ctx.beginPath();
    ctx.arc(x, y, HEX_SIZE * 0.98, 0, Math.PI * 2);
    ctx.setLineDash([HEX_SIZE * 0.12, HEX_SIZE * 0.1]);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Selection ring
  if (isSelected) {
    ctx.beginPath();
    ctx.arc(x, y, HEX_SIZE * 1.08, 0, Math.PI * 2);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = HEX_SIZE * 0.16;
    ctx.stroke();
    ctx.strokeStyle = '#D8352A';
    ctx.lineWidth = HEX_SIZE * 0.08;
    ctx.stroke();
  }

  const tokenR = HEX_SIZE * 0.95;

  const overlayColor = unit.isFleeing ? 'rgba(255,80,0,0.45)'
    : (unit.hasMoved && unit.isMine) ? 'rgba(0,0,0,0.45)'
    : null;

  if (unit.isGeneral) {
    const gid = getGeneralIdForUnit(unit);
    const img = gid ? generalTokenImages[gid] : null;
    if (img && img.complete && img.naturalWidth) {
      drawTokenImage(ctx, img, x, y, tokenR, color, 0.15, overlayColor, rotAngle);
    } else {
      drawStar(ctx, x, y, 5, size, size * 0.45);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(HEX_SIZE * 0.45)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(unit.name.charAt(0), x, y);
    }
  } else {
    const img = unit.typeId ? unitTokenImages[unit.typeId] : null;
    if (img && img.complete && img.naturalWidth) {
      drawTokenImage(ctx, img, x, y, tokenR, color, 0.25, overlayColor, rotAngle);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fillStyle = color + 'cc';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(HEX_SIZE * 0.45)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(unit.name.charAt(0), x, y);
    }
  }

  // Ink frame: black ring, player colour inside
  ctx.beginPath();
  ctx.arc(x, y, tokenR, 0, Math.PI * 2);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = HEX_SIZE * 0.09;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, tokenR - HEX_SIZE * 0.07, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = HEX_SIZE * 0.06;
  ctx.stroke();

  // Front: a wedge on the ring toward the facing direction
  const fIdx = getAnimatedFacing(unit);
  if (fIdx != null && FACE_DIRS[fIdx] && unit.q != null) {
    const c0 = hexToPixel(unit.q, unit.r), n0 = hexToPixel(unit.q + FACE_DIRS[fIdx][0], unit.r + FACE_DIRS[fIdx][1]);
    const ang = Math.atan2(n0.y - c0.y, n0.x - c0.x);
    const r0 = tokenR + HEX_SIZE * 0.02, len = HEX_SIZE * 0.26, half = HEX_SIZE * 0.17;
    const tip = [x + Math.cos(ang) * (r0 + len), y + Math.sin(ang) * (r0 + len)];
    const l = [x + Math.cos(ang) * r0 - Math.sin(ang) * half, y + Math.sin(ang) * r0 + Math.cos(ang) * half];
    const rr = [x + Math.cos(ang) * r0 + Math.sin(ang) * half, y + Math.sin(ang) * r0 - Math.cos(ang) * half];
    ctx.beginPath(); ctx.moveTo(tip[0], tip[1]); ctx.lineTo(l[0], l[1]); ctx.lineTo(rr[0], rr[1]); ctx.closePath();
    ctx.fillStyle = unit.isMine ? '#ffffff' : '#D8352A';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // HP bar (white on black, red when low)
  const hpRatio = Math.max(0, Math.min(1, unit.vitality / unit.maxVitality));
  const barW = HEX_SIZE * 1.3;
  const barH = Math.max(4, HEX_SIZE * 0.13);
  const bx = x - barW / 2;
  const by = y + tokenR + HEX_SIZE * 0.06;
  ctx.fillStyle = '#000';
  ctx.fillRect(bx - 2, by - 2, barW + 4, barH + 4);
  ctx.fillStyle = hpRatio > 0.3 ? '#ffffff' : '#D8352A';
  ctx.fillRect(bx, by, barW * hpRatio, barH);

  // Stance badge (bottom-right of hex) — all non-general units: stance colour + pictogram
  if (unit.stance && !unit.isGeneral) {
    const sst = stanceStyle(unit.stance);
    const iconX = x + HEX_SIZE * 0.46;
    const iconY = y + HEX_SIZE * 0.36;
    const r = HEX_SIZE * 0.2;
    ctx.beginPath();
    ctx.arc(iconX, iconY, r, 0, Math.PI * 2);
    ctx.fillStyle = sst.c;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = unit.isMine ? '#ffffff' : '#D8352A';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    drawStanceIcon(ctx, unit.stance, iconX, iconY, r * 1.45);
  }

  ctx.restore();
}

function drawStar(ctx, cx, cy, spikes, outerR, innerR) {
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx.beginPath();
  ctx.moveTo(cx, cy - outerR);
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
    rot += step;
    ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
    rot += step;
  }
  ctx.closePath();
}

// ---- INPUT ----
canvas.addEventListener('dblclick', (e) => {
  const hex = getHexUnderMouse(e);
  const units = gameState?.units || deployState?.units || [];
  const unit = units.find(u => u.q === hex.q && u.r === hex.r);
  if (unit) showUnitCard(unit);
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 2 && selectedUnit && window.KBOrient) {
    const hex = getHexUnderMouse(e);
    const anchor = window.gameBridge.orientAnchor(selectedUnit, hex);
    if (anchor && KBOrient.start(window.gameBridge, selectedUnit, anchor)) { dragStart = { x: e.clientX, y: e.clientY }; return; }
  }
  if (e.button === 1 || e.button === 2) {
    isDragging = true;
    dragStart = { x: e.clientX, y: e.clientY };
    camAtDrag = { x: camX, y: camY };
    return;
  }
  if (pingMode) {
    const hex = getHexUnderMouse(e);
    if (hex && roomCode) wsSend('ping', { roomCode, q: hex.q, r: hex.r });
    return;
  }
  const hex = getHexUnderMouse(e);
  handleHexClick(hex, { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey || e.metaKey, altKey: e.altKey, clientX: e.clientX, clientY: e.clientY });
});

canvas.addEventListener('mousemove', (e) => {
  if (window.KBOrient && KBOrient.active()) { KBOrient.move(getHexUnderMouse(e), e.clientX, e.clientY); return; }
  if (isDragging) {
    camX = camAtDrag.x + (e.clientX - dragStart.x);
    camY = camAtDrag.y + (e.clientY - dragStart.y);
    render();
    hideTerrainTooltip();
    return;
  }
  hoveredHex = getHexUnderMouse(e);
  render();

  if (showTerrain) {
    const rect = canvas.getBoundingClientRect();
    const worldX = (e.clientX - rect.left - canvas.width / 2 - camX) / zoom;
    const worldY = (e.clientY - rect.top - canvas.height / 2 - camY) / zoom;
    const nearSeg = getNearestSegment(worldX, worldY);
    if (nearSeg) {
      showTerrainTooltip(buildSegmentTooltip(nearSeg), e);
    } else if (hoveredHex) {
      const tType = terrainData[`${hoveredHex.q},${hoveredHex.r}`] || 'plain';
      showTerrainTooltip(buildTerrainTooltip(tType), e);
    } else {
      hideTerrainTooltip();
    }
  } else {
    hideTerrainTooltip();
  }
});

canvas.addEventListener('mouseleave', hideTerrainTooltip);

let orientJustEnded = false;
canvas.addEventListener('mouseup', () => {
  isDragging = false;
  if (window.KBOrient && KBOrient.active()) { KBOrient.end(); orientJustEnded = true; }
});
// Right click: deselect (a right-drag pans the map, or orients the selected unit when it starts on it)
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (orientJustEnded) { orientJustEnded = false; return; }
  if (dragStart && Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > 6) return;
  window.gameBridge.deselect();
});

// ---- ORIENTATION / POSTURE as orders (on-unit controls, HUD button, right-click) ----
const FACE_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
// Direction index (0..5) whose neighbour lies closest to the angle toward hex
function facingToward(unit, hex) {
  if (!unit || unit.q == null || (hex.q === unit.q && hex.r === unit.r)) return null;
  const c = hexToPixel(unit.q, unit.r), t = hexToPixel(hex.q, hex.r);
  const a = Math.atan2(t.y - c.y, t.x - c.x);
  let best = null, bestD = Infinity;
  FACE_DIRS.forEach(([dq, dr], i) => {
    const n = hexToPixel(unit.q + dq, unit.r + dr);
    let d = Math.abs(Math.atan2(n.y - c.y, n.x - c.x) - a);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}
function setUnitFacing(unit, facing) {
  if (window.KBSim && KBSim.active()) { KBSim.setFacing(unit, facing); return; }
  if (gameState?.currentPlayerId !== myId || unit.facing === facing) return;
  if ((unit.speedRemaining || 0) <= 0) { notify('Plus de vitesse disponible.', 'info'); return; }
  wsSend('rotate_facing', { roomCode, unitId: unit.id, facing });
}
function setUnitStance(unit, stanceId) {
  if (window.KBSim && KBSim.active()) { KBSim.setStance(unit, stanceId); return; }
  if (gameState?.currentPlayerId !== myId || unit.stance === stanceId) return;
  wsSend('change_stance', { roomCode, unitId: unit.id, stanceId });
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const newZoom = Math.min(3, Math.max(0.3, zoom * delta));

  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Point monde sous le curseur avant zoom
  const worldX = (mouseX - canvas.width / 2 - camX) / zoom;
  const worldY = (mouseY - canvas.height / 2 - camY) / zoom;

  // Recaler la caméra pour que ce point reste sous le curseur
  camX = mouseX - canvas.width / 2 - worldX * newZoom;
  camY = mouseY - canvas.height / 2 - worldY * newZoom;

  zoom = newZoom;
  render();
}, { passive: false });

// Touch support
let lastTouchDist = null;
canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    const t = e.touches[0];
    isDragging = true;
    dragStart = { x: t.clientX, y: t.clientY };
    camAtDrag = { x: camX, y: camY };
  }
});
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (lastTouchDist) {
      zoom = Math.min(3, Math.max(0.3, zoom * (dist / lastTouchDist)));
    }
    lastTouchDist = dist;
    render();
  } else if (e.touches.length === 1 && isDragging) {
    const t = e.touches[0];
    camX = camAtDrag.x + (t.clientX - dragStart.x);
    camY = camAtDrag.y + (t.clientY - dragStart.y);
    render();
  }
}, { passive: false });
canvas.addEventListener('touchend', () => { isDragging = false; lastTouchDist = null; });

function getHexUnderMouse(e) {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left - canvas.width / 2 - camX) / zoom;
  const my = (e.clientY - rect.top - canvas.height / 2 - camY) / zoom;
  return pixelToHex(mx, my);
}

// ---- GAME LOGIC ----
function handleHexClick(hex, opts = {}) {
  hex = { ...hex, alt: !!opts.altKey };
  const key = `${hex.q},${hex.r}`;

  if (mode === 'deploy') {
    handleDeployClick(hex);
    return;
  }
  if (mode === 'facing' && selectedUnit) {
    const d = facingToward(selectedUnit, hex);
    if (d != null) setUnitFacing(selectedUnit, d);
    setMode('select');
    render();
    return;
  }
  if (window.KBSim && KBSim.active()) { KBSim.click(hex, opts); return; }

  if (selectedUnit && mode === 'ability') {
    const opts = abilityTiles.get(key);
    if (opts) { pickUnitAbilityOption(hex, opts); return; }
    setMode('select');
    render();
    return;
  }

  if (selectedUnit) {
    // Étapes du chemin : Maj+clic (ou outil Étapes) ajoute une étape, clic sur une étape coupe le chemin jusqu'à elle
    if (selectedUnit.isMine && gameState?.currentPlayerId === myId && routeClick(selectedUnit, hex, !!opts.shiftKey || route.tool, { has: (k) => movableTiles.has(k) || marchTargets(selectedUnit).has(k) }, refreshRouteTiles)) return;
    // Clic sur case de déplacement → déplacer (le long des étapes s'il y en a) ; une porte : le passage ou le chemin de ronde
    const node = hexNode(selectedUnit, hex, hex.alt);
    if (movableTiles.has(node)) {
      const full = routeWaypoints(selectedUnit).length || node.endsWith('^') ? extendRoute(seqRoute(selectedUnit), node) : null;
      wsSend('move_unit', full
        ? { roomCode, unitId: selectedUnit.id, targetQ: hex.q, targetR: hex.r, path: full.path.slice(1) }
        : { roomCode, unitId: selectedUnit.id, targetQ: hex.q, targetR: hex.r });
      resetRoute();
      movableTiles.clear();
      attackableTiles.clear();
      rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
      render();
      return;
    }

    // Clic sur ennemi attaquable → attaquer (hors de portée : l'unité s'approche puis attaque, en une action)
    if (attackableTiles.has(key)) {
      const target = attackTargetOn(key);
      if (target) {
        const a = approachAt(key);
        const msg = { roomCode, attackerId: selectedUnit.id, targetId: target.id };
        if (a) Object.assign(msg, { approachQ: a.q, approachR: a.r }, (a.routed || a.level) && a.path.length > 1 ? { path: a.path.slice(1) } : {});
        wsSend('attack_unit', msg);
        resetRoute();
        movableTiles.clear();
        attackableTiles.clear();
        rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
        render();
        return;
      }
    }


    // Ennemi visible mais hors d'atteinte ce tour : l'unité ne bouge pas
    const foe = gameState?.units.find(u => u.q === hex.q && u.r === hex.r && !u.isMine && !u.isAlly);
    if (foe && selectedUnit.isMine !== false && gameState.currentPlayerId === myId && !selectedUnit.hasAttacked && !selectedUnit.isFleeing) {
      notify(`${foe.name} est hors d'atteinte ce tour : ${selectedUnit.name} ne peut pas s'en approcher assez pour attaquer.`, 'info');
      return;
    }

    // Case hors d'atteinte ce tour : marche sur plusieurs tours, donnée en un clic (le survol montre le trajet)
    if (selectedUnit.isMine && gameState?.currentPlayerId === myId && !selectedUnit.isFleeing && !unitAtNode(node)) {
      const plan = marchPlan(selectedUnit, node, null, selectedUnit.speedRemaining || 0, KBRules.hasFullSpeed(selectedUnit));
      if (plan) {
        if (plan.path.length - 1 > 200) { notify('Destination trop lointaine pour une seule marche.', 'info'); return; }
        {
          wsSend('move_unit', { roomCode, unitId: selectedUnit.id, targetQ: hex.q, targetR: hex.r, march: true, path: plan.path.slice(1) });
          pendingMarch = null;
          resetRoute();
          movableTiles.clear();
          attackableTiles.clear();
          rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
          render();
          return;
        }
      }
    }

    // Clic sur une autre unité alliée → changer de sélection
    const ally = gameState?.units.find(u => u.q === hex.q && u.r === hex.r && u.isMine);
    if (ally && ally.id !== selectedUnit.id) {
      selectUnit(ally);
      return;
    }

    // Clic hors portée → déselectionner
    resetRoute();
    selectedUnit = null;
    movableTiles.clear();
    attackableTiles.clear();
    rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
    updateActionButtons();
    showUnitDetail(null);
    render();
    return;
  }

  // Pas d'unité sélectionnée → sélectionner
  const unit = gameState?.units.find(u => u.q === hex.q && u.r === hex.r && u.isMine);
  if (unit) selectUnit(unit);
  render();
}

function handleDeployClick(hex) {
  if (deployState?.isReady) { notify('Vous êtes prêt : le déploiement est verrouillé.', 'info'); return; }
  // Clic sur une unité déjà placée → la reprendre
  const clickedUnit = deployState.units.find(u => u.q === hex.q && u.r === hex.r);
  if (clickedUnit) {
    if (selectedUnit && selectedUnit.id === clickedUnit.id) {
      // Déselectionner si on reclique dessus
      selectedUnit = null;
      renderDeployUnitList(deployState.units);
      render();
      return;
    }
    selectedUnit = clickedUnit;
    renderDeployUnitList(deployState.units);
    render();
    return;
  }

  if (!selectedUnit) return;

  const zone = deployState.startingZone;
  const inDeployZone = zone.tileSet ? zone.tileSet.has(`${hex.q},${hex.r}`) : hexDistance(hex.q, hex.r, zone.q, zone.r) <= (zone.radius || 4);

  if (!inDeployZone) {
    // Clic hors zone → déselectionner
    selectedUnit = null;
    renderDeployUnitList(deployState.units);
    render();
    return;
  }

  const stuck = deployBlockedFor(selectedUnit);
  const other = deployState.units.find(u => u !== selectedUnit && u.q === hex.q && u.r === hex.r);
  const otherStuck = other && selectedUnit.q != null ? deployBlockedFor(other) : null;
  if ((stuck && stuck.has(`${hex.q},${hex.r}`)) || (otherStuck && otherStuck.has(`${selectedUnit.q},${selectedUnit.r}`))) {
    notify(`${(stuck && stuck.has(`${hex.q},${hex.r}`)) ? selectedUnit.name : other.name} serait bloqué ici : impossible d'en sortir (barrières, escaliers ou falaises).`, 'info');
    return;
  }
  wsSend('place_unit', { roomCode, unitId: selectedUnit.id, q: hex.q, r: hex.r });
  selectedUnit.q = hex.q;
  selectedUnit.r = hex.r;
  selectedUnit = null;
  renderDeployUnitList(deployState.units);
  updateActionButtons();
  render();
}

function selectUnit(unit) {
  if (window.KBSim && KBSim.active()) { KBSim.select(unit); return; }
  if (!unit || route.unitId !== unit.id) { route.unitId = null; route.waypoints = []; }
  pendingMarch = null;
  selectedUnit = unit;
  movableTiles.clear();
  attackableTiles.clear();
  rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;

  if (gameState?.currentPlayerId === myId && unit.speedRemaining > 0 && !unit.isFleeing) {
    computeMovableTiles(unit);
  }
  if (gameState?.currentPlayerId === myId && !unit.hasAttacked && !unit.isFleeing) {
    computeAttackableTiles(unit);
  }
  if (unit.range > 1) {
    computeRangeTiles(unit);
  }
  if (unit.isGeneral) {
    computeMotivateTiles(unit);
  }

  updateActionButtons();
  showUnitDetail(unit);
  renderStancePanel(unit);
  render();
}

function computeMovableTiles(unit) {
  const R = seqRoute(unit);
  if (!R || R.march) return;
  const occupied = new Set((gameState?.units || []).map(nodeKeyOf));
  for (const k of R.reach.dist.keys()) if (!occupied.has(k)) movableTiles.add(k);
  movableTiles.delete(nodeKeyOf(unit));
  for (const w of routeWaypoints(unit)) movableTiles.delete(KBRules.stepKey(w));
}
// Enemy on this hex that the selected unit can strike (two may share a gate hex: the passage and the wall walk)
const attackTargetAt = new Map(); // hex key -> unit id
function attackTargetOn(key) {
  const id = attackTargetAt.get(key);
  return (gameState?.units || []).find(u => (id ? u.id === id : `${u.q},${u.r}` === key) && !u.isMine && !u.isAlly) || null;
}
const ckHeight = (k) => mapHeight[k] || 0;

function computeAttackableTiles(unit) {
  approachAttacks.clear();
  attackTargetAt.clear();
  if (!gameState) return;
  if (routeWaypoints(unit).length) { computeRoutedAttacks(unit); return; }
  const canApproach = gameState.currentPlayerId === myId && unit.speedRemaining > 0 && !unit.isFleeing && !unit.hasAttacked;
  let reach = null;
  const here = unit.level ? [unit.q, unit.r, 1] : [unit.q, unit.r];

  for (const u of gameState.units) {
    if (u.isMine || u.isAlly) continue;
    const key = `${u.q},${u.r}`;
    if (attackTargetAt.has(key) && !approachAttacks.has(key)) continue;
    if (KBRules.combatKind(unit, u, gateInfo, ckHeight)) {
      attackableTiles.add(key);
      attackTargetAt.set(key, u.id);
      approachAttacks.delete(key);
    } else if (canApproach && !attackTargetAt.has(key)) {
      reach = reach || clientReachable(unit);
      const best = KBRules.bestAttackHex(reach, { start: unit, target: u, range: unit.range || 1, heightAt: ckHeight, gates: gateInfo, canStand: (k) => k === nodeKeyOf(unit) || !gameState.units.some(o => nodeKeyOf(o) === k) });
      if (best && best.path.length) {
        attackableTiles.add(key);
        attackTargetAt.set(key, u.id);
        approachAttacks.set(key, { targetId: u.id, q: best.q, r: best.r, level: best.level, path: [here, ...best.path] });
      }
    }
  }
}

// With waypoints: every strike starts at the end of the route (then, if needed, the cheapest approach from there)
function computeRoutedAttacks(unit) {
  const R = seqRoute(unit);
  if (!R || R.march) return;
  const E = R.end;
  const occupied = (k) => gameState.units.some(o => nodeKeyOf(o) === k);
  for (const u of gameState.units) {
    if (u.isMine || u.isAlly) continue;
    const key = `${u.q},${u.r}`;
    if (attackTargetAt.has(key)) continue;
    if (KBRules.combatKind({ ...unit, q: E.q, r: E.r, level: E.level }, u, gateInfo, ckHeight)) {
      attackableTiles.add(key);
      attackTargetAt.set(key, u.id);
      approachAttacks.set(key, { targetId: u.id, q: E.q, r: E.r, level: E.level, path: R.path, routed: true });
      continue;
    }
    const best = KBRules.bestAttackHex(R.reach, { start: E, target: u, range: unit.range || 1, heightAt: ckHeight, gates: gateInfo, canStand: (k) => !occupied(k) });
    if (best && best.path.length) {
      attackableTiles.add(key);
      attackTargetAt.set(key, u.id);
      approachAttacks.set(key, { targetId: u.id, q: best.q, r: best.r, level: best.level, path: [...R.path, ...best.path], routed: true });
    }
  }
}

// Approach + strike planned against the enemy on this hex (null when it is in range already or out of reach)
function approachAt(key) {
  return attackableTiles.has(key) ? approachAttacks.get(key) || null : null;
}

// Route being chosen: waypoints (numbered), path to the hovered hex, cumulative cost on each step and cost / speed at the end
// March preview for the hovered hex (classic turn or planning), or null
function marchPlanFor(unit, q, r) {
  if (!unit || !unit.isMine || unit.isFleeing || q == null) return null;
  if (window.KBSim && KBSim.active()) return KBSim.marchPlan ? KBSim.marchPlan(unit, hexNode(unit, { q, r })) : null;
  if (gameState?.currentPlayerId !== myId || gameState?.phase !== 'battle') return null;
  const node = hexNode(unit, { q, r });
  if (movableTiles.has(node) || unitAtNode(node)) return null;
  return marchPlan(unit, node, null, unit.speedRemaining || 0, KBRules.hasFullSpeed(unit));
}

// Outline of a zone of hexes (range, motivation): black under a coloured line; dash = preview from the destination
// Range / charisma zone (dashed: the range planned from the destination)
function strokeZone(keys, center, color, dash = null) {
  // one smooth contour around the hexes (KBRules.zoneLoops), a faint veil, an inner glow from the rim, dark under-line, crisp rim
  const dirIdx = KBRules.DIRS.map(([dq, dr]) => SEGMENT_EDGE_DIRS.findIndex(([a, b]) => a === dq && b === dr));
  const edgeOf = (q, r, d) => {
    const { x, y } = hexToPixel(q, r);
    const c = hexCorners(x, y), i = dirIdx[d];
    return [[c[i].x, c[i].y], [c[(i + 1) % 6].x, c[(i + 1) % 6].y]];
  };
  const loops = KBRules.zoneLoops(keys, `${center.q},${center.r}`, edgeOf, 3);
  if (!loops.length) return;
  const rgb = color.startsWith('#') ? [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)) : [255, 255, 255];
  const col = (a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  const path = new Path2D();
  for (const l of loops) { path.moveTo(l[0][0], l[0][1]); for (let i = 1; i < l.length; i++) path.lineTo(l[i][0], l[i][1]); path.closePath(); }
  // no fill (the movement range is the filled one): shots = double golden line with a soft glow, charisma = blue dashes
  const k = Math.max(1, 1 / zoom);
  const charisma = color === '#6ebeff';
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.save();
  ctx.shadowColor = col(0.8); ctx.shadowBlur = dash ? 6 : 10;
  ctx.strokeStyle = col(dash ? 0.12 : 0.22); ctx.lineWidth = (dash ? 6 : 9) * k; ctx.stroke(path);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = (dash ? 4 : 6) * k; ctx.stroke(path);
  if (charisma || dash) {
    ctx.setLineDash((charisma ? [9, 7] : [6, 8]).map((d) => d * k));
    ctx.strokeStyle = col(dash ? 0.85 : 0.98); ctx.lineWidth = (dash ? 1.8 : 2.4) * k; ctx.stroke(path);
  } else {
    // double line: a wide coloured stroke with a dark core
    ctx.strokeStyle = col(0.98); ctx.lineWidth = 4.2 * k; ctx.stroke(path);
    ctx.strokeStyle = 'rgba(20,14,4,0.85)'; ctx.lineWidth = 1.3 * k; ctx.stroke(path);
  }
  ctx.restore();
}

// ---- path drawing (2D): smoothed trails, black outline, arrow at the end ----
// Smooth curve through the hex centres (quadratic segments between the midpoints)
function traceSmooth(c2d, pts) {
  c2d.beginPath();
  c2d.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) { c2d.lineTo(pts[1].x, pts[1].y); return; }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
    c2d.quadraticCurveTo(pts[i].x, pts[i].y, i === pts.length - 2 ? pts[i + 1].x : mx, i === pts.length - 2 ? pts[i + 1].y : my);
  }
}
// opts: { color, width, alpha, dash, arrow, outline, glow, beads, subtle }
//   glow: selected unit — soft halo in the path colour, bright core, beads on the hexes it walks through
//   subtle: other units — thin, faint, no outline, a dot at the destination instead of an arrow head
// Chaikin corner cutting: rounded bends with a large radius, ends kept
function chaikin(pts, iters = 3) {
  let out = pts;
  for (let k = 0; k < iters && out.length > 2; k++) {
    const nx = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i], b = out[i + 1];
      nx.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    nx.push(out[out.length - 1]);
    out = nx;
  }
  return out;
}
// Selected unit's trail, in the spirit of Humankind: a thick white line with rounded bends, a soft dark shadow and a
// faint halo in the player's colour, round ends, no arrow; badge: number drawn in a white disc at the end
function drawHKTrail(c2d, pts, { color = '#fff', width = 5, alpha = 1, dash = null, badge = null } = {}) {
  const sm = chaikin(pts);
  const line = () => { c2d.beginPath(); sm.forEach((p, i) => (i ? c2d.lineTo(p.x, p.y) : c2d.moveTo(p.x, p.y))); };
  const core = Math.max(5, width * 1.25);
  c2d.save();
  c2d.lineCap = 'round'; c2d.lineJoin = 'round';
  c2d.setLineDash([]);
  c2d.globalAlpha = alpha * 0.3; c2d.strokeStyle = color; c2d.lineWidth = core * 3; line(); c2d.stroke();
  c2d.globalAlpha = alpha * 0.4; c2d.strokeStyle = '#000'; c2d.lineWidth = core + 4;
  c2d.shadowColor = 'rgba(0,0,0,0.6)'; c2d.shadowBlur = 6; c2d.shadowOffsetY = 2; line(); c2d.stroke();
  c2d.shadowBlur = 0; c2d.shadowOffsetY = 0;
  c2d.globalAlpha = alpha; c2d.strokeStyle = '#fbfaf6'; c2d.lineWidth = core; c2d.setLineDash(dash || []); line(); c2d.stroke();
  c2d.setLineDash([]);
  if (badge != null) {
    const e = pts[pts.length - 1], R = Math.max(9, HEX_SIZE * 0.2);
    c2d.globalAlpha = 1;
    c2d.shadowColor = 'rgba(0,0,0,0.5)'; c2d.shadowBlur = 5; c2d.shadowOffsetY = 2;
    c2d.beginPath(); c2d.arc(e.x, e.y, R, 0, Math.PI * 2); c2d.fillStyle = '#fff'; c2d.fill();
    c2d.shadowBlur = 0; c2d.shadowOffsetY = 0;
    c2d.beginPath(); c2d.arc(e.x, e.y, R * 0.8, 0, Math.PI * 2); c2d.lineWidth = 2; c2d.strokeStyle = '#1a1a1a'; c2d.stroke();
    c2d.fillStyle = '#1a1a1a'; c2d.font = `bold ${Math.round(R * 1.05)}px sans-serif`; c2d.textAlign = 'center'; c2d.textBaseline = 'middle';
    c2d.fillText(String(badge), e.x, e.y + 1);
  }
  c2d.restore();
}

function drawTrail(c2d, pts, { color = '#fff', width = 4, alpha = 1, dash = null, arrow = true, outline = true, glow = false, beads = false, subtle = false, badge = null } = {}) {
  if (!pts || pts.length < 2) return;
  if (glow) { drawHKTrail(c2d, pts, { color, width, alpha, dash, badge: badge ?? (arrow ? 1 : null) }); return; }
  let dot = false;
  if (subtle) { width = Math.min(width, 2.5); alpha = Math.min(alpha, 0.4); outline = false; dot = arrow; arrow = false; }
  c2d.save();
  c2d.globalAlpha = alpha;
  c2d.lineCap = 'round'; c2d.lineJoin = 'round';
  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const head = Math.max(subtle ? 7 : 10, width * 2.8);
  // stop the line under the arrow head
  const cut = arrow ? [...pts.slice(0, -1), { x: b.x - Math.cos(ang) * head * 0.55, y: b.y - Math.sin(ang) * head * 0.55 }] : pts;
  if (glow) {
    c2d.save();
    c2d.shadowColor = color; c2d.shadowBlur = width * 4;
    c2d.strokeStyle = color; c2d.globalAlpha = alpha * 0.35; c2d.lineWidth = width + 9; c2d.setLineDash([]);
    traceSmooth(c2d, cut); c2d.stroke();
    c2d.restore();
  }
  if (outline) { c2d.strokeStyle = 'rgba(0,0,0,0.85)'; c2d.lineWidth = width + 3; c2d.setLineDash(dash || []); traceSmooth(c2d, cut); c2d.stroke(); }
  c2d.strokeStyle = color; c2d.lineWidth = width; c2d.setLineDash(dash || []); traceSmooth(c2d, cut); c2d.stroke();
  if (glow) { c2d.strokeStyle = 'rgba(255,255,255,0.55)'; c2d.lineWidth = Math.max(1, width * 0.3); traceSmooth(c2d, cut); c2d.stroke(); }
  c2d.setLineDash([]);
  if (beads) {
    for (let i = 1; i < pts.length - 1; i++) {
      c2d.beginPath(); c2d.arc(pts[i].x, pts[i].y, width * 0.75, 0, Math.PI * 2);
      c2d.fillStyle = '#fff'; c2d.fill();
      c2d.lineWidth = 1.5; c2d.strokeStyle = color; c2d.stroke();
    }
  }
  if (dot) {
    const e = pts[pts.length - 1];
    c2d.beginPath(); c2d.arc(e.x, e.y, width * 1.6, 0, Math.PI * 2);
    c2d.fillStyle = color; c2d.fill();
    c2d.lineWidth = 1; c2d.strokeStyle = 'rgba(0,0,0,0.6)'; c2d.stroke();
  }
  if (arrow) {
    // rounded chevron head
    const w = 0.55;
    c2d.beginPath();
    c2d.moveTo(b.x, b.y);
    c2d.lineTo(b.x - head * Math.cos(ang - w), b.y - head * Math.sin(ang - w));
    c2d.quadraticCurveTo(b.x - head * 0.55 * Math.cos(ang), b.y - head * 0.55 * Math.sin(ang), b.x - head * Math.cos(ang + w), b.y - head * Math.sin(ang + w));
    c2d.closePath();
    if (glow) { c2d.shadowColor = color; c2d.shadowBlur = width * 3; }
    c2d.fillStyle = color; c2d.fill();
    c2d.shadowBlur = 0;
    if (outline) { c2d.strokeStyle = 'rgba(0,0,0,0.85)'; c2d.lineWidth = 1.5; c2d.stroke(); }
  }
  c2d.restore();
}
// Stance change ahead on a hex of the selected unit's path: a round seal on the path itself (ring in the path colour,
// disc in the stance colour, pictogram)
function drawStanceStep(c2d, q, r, stance, ring = '#fff') {
  const p = hexToPixel(q, r);
  const R = HEX_SIZE * 0.3;
  c2d.save();
  c2d.shadowColor = ring; c2d.shadowBlur = R * 0.9;
  c2d.beginPath(); c2d.arc(p.x, p.y, R + 3, 0, Math.PI * 2);
  c2d.fillStyle = ring; c2d.fill();
  c2d.shadowBlur = 0;
  c2d.beginPath(); c2d.arc(p.x, p.y, R, 0, Math.PI * 2);
  c2d.fillStyle = (STANCE_STYLE[stance] || {}).c || '#444'; c2d.fill();
  c2d.lineWidth = 1.5; c2d.strokeStyle = 'rgba(0,0,0,0.8)'; c2d.stroke();
  drawStanceIcon(c2d, stance, p.x, p.y, R * 1.3);
  c2d.restore();
}
window.drawTrail = drawTrail;
window.drawStanceStep = drawStanceStep;

// Draws a march: this turn's part like a route, the next turns fainter, a numbered marker where each turn ends
function drawMarchPath(ctx, path, turnEnds, { color = '#fff', alpha = 1, label = null, numbers = true, width = 4, glow = false, subtle = false } = {}) {
  if (!path || path.length < 2) return;
  const pts = path.map(([q, r]) => hexToPixel(q, r));
  const first = Math.max(0, turnEnds && turnEnds.length ? turnEnds[0] : pts.length - 1);
  ctx.save();
  // the selected unit (glow): white trail, the next turns fainter, a white numbered disc where each turn ends
  const hk = glow || (color === '#9a9a9a' && !subtle);
  if (first < pts.length - 1) {
    if (hk) drawHKTrail(ctx, pts.slice(first), { color, width: width * 0.85, alpha: alpha * 0.5 });
    else drawTrail(ctx, pts.slice(first), { color: '#b4b4b4', width: Math.max(2.5, width - 1.5), alpha: alpha * 0.85, dash: [2, 9], arrow: true, subtle });
  }
  if (first > 0) {
    if (hk) drawHKTrail(ctx, pts.slice(0, first + 1), { color, width, alpha });
    else drawTrail(ctx, pts.slice(0, first + 1), { color, width, alpha, arrow: first === pts.length - 1, subtle });
  }
  ctx.globalAlpha = alpha;
  ctx.font = `bold ${Math.round(HEX_SIZE * 0.3)}px 'Dela Gothic One', 'Zen Kaku Gothic New', sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (numbers) (turnEnds || []).forEach((idx, n) => {
    if (idx <= 0) return;
    const p = pts[idx], R = Math.max(9, HEX_SIZE * 0.2);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.beginPath(); ctx.arc(p.x, p.y, R * 0.8, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = '#1a1a1a'; ctx.stroke();
    ctx.fillStyle = '#1a1a1a'; ctx.font = `bold ${Math.round(R * 1.05)}px sans-serif`;
    ctx.fillText(String(n + 1), p.x, p.y + 1);
    ctx.restore();
  });
  if (label) {
    const pe = pts[pts.length - 1];
    ctx.font = `bold ${Math.round(HEX_SIZE * 0.32)}px 'Zen Kaku Gothic New', sans-serif`;
    const w = ctx.measureText(label).width + 12;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.fillRect(pe.x - w / 2, pe.y - HEX_SIZE * 0.85, w, HEX_SIZE * 0.42); ctx.strokeRect(pe.x - w / 2, pe.y - HEX_SIZE * 0.85, w, HEX_SIZE * 0.42);
    ctx.fillStyle = '#000'; ctx.fillText(label, pe.x, pe.y - HEX_SIZE * 0.64);
  }
  ctx.restore();
}

// Standing marches of my units: the rest of their route, faint, numbered by turn for the selected unit
function marchPaths() {
  const planned = new Map();
  if (window.KBSim && KBSim.active()) for (const o of KBSim.plannedOrders()) planned.set(String(o.unitId), o);
  const out = [];
  for (const u of gameState?.units || []) {
    if (!u.isMine || u.q == null) continue;
    const o = planned.get(String(u.id));
    if (o) {
      if (o.marchRest) { const from = o.path && o.path.length ? o.path[o.path.length - 1] : [u.q, u.r]; out.push({ u, path: [from, ...o.marchRest], planned: true }); }
    } else if (u.march && u.march.route && u.march.route.length) out.push({ u, path: [[u.q, u.r], ...u.march.route] });
  }
  return out;
}
window.marchPaths = marchPaths;

// Turn ends along a standing / planned march path (origin included): index of the last hex of each later turn
function marchEnds(u, path) {
  const costs = [0];
  const mounted = KBRules.isMounted(u);
  for (let i = 1; i < path.length; i++) {
    const a = `${path[i - 1][0]},${path[i - 1][1]}`, b = `${path[i][0]},${path[i][1]}`;
    const c = KBRules.stepCost(movementTable(), { terrain: terrainData[a] || 'plain', height: mapHeight[a] || 0 }, { terrain: terrainData[b] || 'plain', height: mapHeight[b] || 0 }, segmentData[segmentEdgeKey(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1])] || null, mounted);
    costs.push(KBRules.snap(costs[i - 1] + (isFinite(c) ? c : 1)));
  }
  return marchTurns(u, path, costs, 0, false).slice(1);
}
// For the 3D view: the selected unit's march, { path, ends: [0, ...turn ends], turns } or null
window.selectedMarch = () => {
  const m = selectedUnit && marchPaths().find((x) => x.u.id === selectedUnit.id);
  if (!m) return null;
  const ends = marchEnds(m.u, m.path);
  return { path: m.path, ends: [0, ...ends], turns: ends.length + (m.planned ? 1 : 0) };
};

function drawMarches(ctx, selectedOnly) {
  for (const { u, path, planned } of marchPaths()) {
    if (!!(selectedUnit && selectedUnit.id === u.id) !== selectedOnly) continue;
    const sel = selectedUnit && selectedUnit.id === u.id;
    const ends = marchEnds(u, path);
    const turns = ends.length + (planned ? 1 : 0);
    drawMarchPath(ctx, path, [0, ...ends], { color: '#9a9a9a', alpha: sel ? 1 : 0.5, width: sel ? 4 : 3, subtle: !sel, numbers: sel, label: sel ? `Marche · ${turns} tour${turns > 1 ? 's' : ''}` : null });
  }
}

function drawRoutePreview(ctx) {
  const unit = selectedUnit;
  if (!unit || !unit.isMine) return;
  const sim = !!(window.KBSim && KBSim.active());
  const hk = hoveredHex ? hexNode(unit, hoveredHex) : null;
  const mp = hk && !movableTiles.has(hk) ? marchPlanFor(unit, hoveredHex.q, hoveredHex.r) : null;
  if (mp) {
    const confirm = pendingMarch && pendingMarch.unitId === unit.id && pendingMarch.key === hk;
    drawMarchPath(ctx, mp.path, mp.turnEnds, { color: getPlayerColor(myId) || '#fff', alpha: 0.95, glow: true, label: marchLabel(mp) });
    return;
  }
  const info = sim ? KBSim.routeInfo() : routeInfo();
  if (!info) return;
  const wps = info.waypoints || [];
  let res = null;
  if (hk && movableTiles.has(hk)) res = sim ? KBSim.pathTo(unit, hk) : extendRoute(seqRoute(unit), hk);
  else if (wps.length) res = sim ? KBSim.routePath() : seqRoute(unit);
  if (!res || res.path.length < 2) return;
  const pts = res.path.map(([q, r]) => hexToPixel(q, r));
  drawTrail(ctx, pts, { color: getPlayerColor(myId) || '#fff', width: 5, alpha: 0.95, glow: true, beads: true });
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.font = `bold ${Math.round(HEX_SIZE * 0.32)}px 'Zen Kaku Gothic New', sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  (res.costs || []).forEach((c, i) => {
    if (!i) return;
    const p = pts[i];
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(p.x, p.y + HEX_SIZE * 0.42, HEX_SIZE * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(fmtSpeed(c), p.x, p.y + HEX_SIZE * 0.43);
  });
  wps.forEach(([q, r], i) => {
    const p = hexToPixel(q, r);
    ctx.fillStyle = '#D8352A'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, HEX_SIZE * 0.24, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillText(String(i + 1), p.x, p.y + 1);
  });
  const pe = pts[pts.length - 1];
  const label = `${fmtSpeed(res.cost)} / ${fmtSpeed(info.budget)}`;
  const w = ctx.measureText(label).width + 12;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
  ctx.fillRect(pe.x - w / 2, pe.y - HEX_SIZE * 0.85, w, HEX_SIZE * 0.42); ctx.strokeRect(pe.x - w / 2, pe.y - HEX_SIZE * 0.85, w, HEX_SIZE * 0.42);
  ctx.fillStyle = '#000'; ctx.fillText(label, pe.x, pe.y - HEX_SIZE * 0.64);
  ctx.restore();
}

function drawApproachPreview(ctx) {
  if (!selectedUnit || !hoveredHex || (window.KBSim && KBSim.active())) return;
  const a = approachAt(`${hoveredHex.q},${hoveredHex.r}`);
  if (!a) return;
  const pts = a.path.map(([q, r]) => hexToPixel(q, r));
  const tgt = hexToPixel(hoveredHex.q, hoveredHex.r);
  const pe = pts[pts.length - 1];
  drawTrail(ctx, pts, { color: getPlayerColor(myId) || '#fff', width: 4.5, alpha: 0.9, glow: true, arrow: false });
  drawTrail(ctx, [pe, tgt], { color: '#D8352A', width: 4, alpha: 0.9, dash: (selectedUnit.range || 1) > 1 ? [3, 7] : null });
  ctx.save();
  ctx.fillStyle = '#D8352A'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(pe.x, pe.y, HEX_SIZE * 0.18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

// Hexes of the map a shooter on (q, r) can hit: distance within its range, +1 per level above the target, -1 below
// (on the wall walk above a gate, from the height of the wall)
function shotZone(unit, q, r, level = 0) {
  const out = new Set();
  const k0 = `${q},${r}`;
  const hA = level && gateInfo.tops[k0] != null ? gateInfo.tops[k0] : (mapHeight[k0] || 0);
  for (const h of mapHexes) {
    const d = hexDistance(q, r, h.q, h.r);
    if (d > 0 && d <= KBRules.attackRange(unit.range, hA, mapHeight[h.key] || 0)) out.add(h.key);
  }
  return out;
}
// Hexes of the map within a general's motivation range (Charisme / 5) around (q, r)
function charismaZone(unit, q, r) {
  const out = new Set();
  const range = Math.floor((unit.charisma || 0) / 5);
  for (const h of mapHexes) { const d = hexDistance(q, r, h.q, h.r); if (d > 0 && d <= range) out.add(h.key); }
  return out;
}

function computeRangeTiles(unit) {
  rangeCenter = { q: unit.q, r: unit.r };
  for (const k of shotZone(unit, unit.q, unit.r, unit.level)) rangeTiles.add(k);
}

function computeMotivateTiles(unit) {
  if (!unit.charisma) return;
  motivateCenter = { q: unit.q, r: unit.r };
  for (const k of charismaZone(unit, unit.q, unit.r)) motivateTiles.add(k);
}

// Range from where the selected unit is headed (shooters: shots, generals: motivation): the hovered hex it can reach
// this turn, else (simultaneous) the end of its planned path. { center, keys, kind: 'tir' | 'charisme' } or null
let rangePreviewCache = null;
function rangePreview() {
  const u = selectedUnit;
  if (!u || u.q == null || u.isMine === false || u.isFleeing || gameState?.phase !== 'battle') return null;
  const kind = (u.range || 1) > 1 ? 'tir' : u.isGeneral && u.charisma ? 'charisme' : null;
  if (!kind) return null;
  let at = null;
  if (hoveredHex && !(hoveredHex.q === u.q && hoveredHex.r === u.r)) {
    const node = hexNode(u, hoveredHex);
    if (movableTiles.has(node)) at = { q: hoveredHex.q, r: hoveredHex.r, level: node.endsWith('^') ? 1 : 0 };
  }
  if (!at && window.KBSim && KBSim.active()) {
    const o = KBSim.orderOf(u);
    const e = o && o.path && o.path.length ? o.path[o.path.length - 1] : null;
    if (e) at = { q: e[0], r: e[1], level: e[2] ? 1 : 0 };
  }
  if (!at) return null;
  const sig = [u.id, kind, at.q, at.r, at.level, u.range, u.charisma, mapHexes.length].join('|');
  if (rangePreviewCache && rangePreviewCache.sig === sig) return rangePreviewCache.value;
  const keys = kind === 'tir' ? shotZone(u, at.q, at.r, at.level) : charismaZone(u, at.q, at.r);
  const value = { center: { q: at.q, r: at.r }, keys, kind };
  rangePreviewCache = { sig, value };
  return value;
}

function setMode(newMode) {
  mode = newMode;
  const indicator = document.getElementById('mode-indicator');
  const labels = { select: 'Sélection', move: 'Déplacement', attack: 'Attaque', motivate: 'Motiver', deploy: 'Déploiement', ability: 'Capacité', facing: 'Orientation' };
  if (newMode !== 'ability') abilityTiles.clear();
  indicator.textContent = `Mode : ${labels[newMode] || newMode}`;
  if (newMode !== 'move') movableTiles.clear();
  if (newMode !== 'attack') {
    attackableTiles.clear();
    rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
  } else if (selectedUnit) {
    computeAttackableTiles(selectedUnit);
  }
  render();
}

function updateActionButtons() {
  const isMyTurn = gameState?.currentPlayerId === myId;
  const hasUnit = !!selectedUnit;
  const isFleeing = hasUnit && selectedUnit.isFleeing;
  const canMove = hasUnit && isMyTurn && !isFleeing && (selectedUnit.speedRemaining > 0);
  const canAttack = hasUnit && isMyTurn && !selectedUnit.hasAttacked && !isFleeing;
  const isGeneral = hasUnit && selectedUnit.isGeneral;
  const canAbility = isGeneral && isMyTurn && !!selectedUnit.activeAbility && !selectedUnit.hasUsedAbility && !(selectedUnit.abilityCooldown > 0);
  const canMotivate = isGeneral && isMyTurn && !selectedUnit.hasAttacked;
  const uab = hasUnit && isMyTurn && !isFleeing && gameState?.phase === 'battle' ? unitActionOf(selectedUnit) : null;
  const canUnitAbility = !!uab && selectedUnit.speedRemaining >= uab.cost && !(uab.type === 'ambush' && selectedUnit.vanishedDay === gameState?.day);
  const abilityBtn = document.getElementById('btn-ability');
  abilityBtn.textContent = canUnitAbility ? `${uab.label} (${uab.cost})` : 'Capacité active';
  abilityBtn.dataset.label = canUnitAbility ? uab.label : '';

  document.getElementById('btn-move').style.display = canMove ? 'block' : 'none';
  document.getElementById('btn-attack').style.display = canAttack ? 'block' : 'none';
  abilityBtn.style.display = canAbility || canUnitAbility ? 'block' : 'none';
  document.getElementById('btn-motivate').style.display = canMotivate ? 'block' : 'none';
  const facingBtn = document.getElementById('btn-facing');
  if (facingBtn) {
    const canFace = hasUnit && selectedUnit.isMine !== false && isMyTurn && !isFleeing && gameState?.phase === 'battle';
    facingBtn.style.display = canFace ? 'block' : 'none';
    facingBtn.disabled = !selectedUnit;
    facingBtn.title = 'Orienter l\'unité (gratuit) : cliquez la case vers laquelle elle doit faire face';
  }
  const endDisplay = isMyTurn ? 'block' : 'none';
  const deployDisplay = (mode === 'deploy') ? 'block' : 'none';
  document.getElementById('btn-end-turn-global').style.display = endDisplay;
  document.getElementById('btn-end-turn-center').style.display = endDisplay;
  const noActionsLeft = isMyTurn && gameState?.actionsLeft === 0;
  const btnCenter = document.getElementById('btn-end-turn-center');
  if (noActionsLeft) btnCenter.classList.add('pulse'); else btnCenter.classList.remove('pulse');
  document.getElementById('btn-deploy-ready-global').style.display = deployDisplay;
  const btnDeployCenter = document.getElementById('btn-deploy-ready-center');
  btnDeployCenter.style.display = deployDisplay;
  const allPlaced = deployState?.units.length > 0 && deployState.units.every(u => u.q !== null);
  if (allPlaced) btnDeployCenter.classList.add('pulse'); else btnDeployCenter.classList.remove('pulse');

  // Show/hide stance panel
  const stancePanel = document.getElementById('stance-panel');
  if (stancePanel) {
    stancePanel.style.display = (hasUnit && isMyTurn && !isFleeing && !selectedUnit?.isGeneral && gameState?.phase === 'battle' && selectedUnit?.speedRemaining > 0) ? 'block' : 'none';
  }
}

function showUnitDetail(unit) {
  const panel = document.getElementById('selected-unit-detail');
  if (!unit) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  document.getElementById('detail-name').textContent = unit.name + (unit.isFleeing ? ' (EN FUITE)' : '');

  const st = (!unit.isGeneral && unit.stance) ? (STANCES_DATA[unit.stance] || {}) : {};
  const terrainKey = (unit.q != null && unit.r != null) ? `${unit.q},${unit.r}` : null;
  const terrainType = terrainKey ? (terrainData[terrainKey] || 'plain') : 'plain';
  const tr = TERRAINS_DATA[terrainType] || TERRAINS_DATA.plain;
  const terrainName = tr.name || terrainType;

  // Build a stat row with delta coloring and hover tooltip
  const statRows = [];
  function addStat(label, base, stKey, trKey, suffix) {
    const sDelta = st[stKey] || 0;
    const tDelta = trKey ? (tr[trKey] || 0) : 0;
    const total = sDelta + tDelta;
    let valueHtml;
    if (total === 0) {
      valueHtml = `<span>${base}${suffix||''}</span>`;
    } else {
      const effective = base + total;
      const color = total > 0 ? '#80e080' : '#e08080';
      const sign = total > 0 ? '+' : '';
      valueHtml = `<span style="color:${color}" title="Base: ${base}${suffix||''}${sDelta!==0?` | Posture: ${sDelta>0?'+':''}${sDelta}`:''}${tDelta!==0?` | Terrain: ${tDelta>0?'+':''}${tDelta}`:''}">`;
      valueHtml += `${effective}${suffix||''} <small style="opacity:0.75">(${sign}${total})</small></span>`;
    }
    statRows.push(`<div class="stat-row" style="cursor:default" title="${label}: base ${base}${suffix||''}${sDelta!==0?`, posture ${sDelta>0?'+':''}${sDelta}`:''}${tDelta!==0?`, terrain ${tDelta>0?'+':''}${tDelta}`:''}"><span>${label}</span>${valueHtml}</div>`);
  }

  const speedLabel = unit.speedRemaining != null ? `${fmtSpeed(unit.speedRemaining)}/${unit.speed}` : `${unit.speed}`;
  const stanceLabel = unit.stance ? (stanceNames[unit.stance] || unit.stance) : '—';

  statRows.push(`<div class="stat-row"><span>Vitalité</span><span>${unit.vitality}/${unit.maxVitality}</span></div>`);
  statRows.push(`<div class="stat-row"><span>Moral</span><span>${unit.morale != null ? unit.morale : '—'}/${unit.maxMorale != null ? unit.maxMorale : '—'}</span></div>`);
  if (!unit.isGeneral) {
    addStat('Attaque', unit.attack, 'attack_cac', 'attack_cac');
    addStat('Puissance', unit.power, 'puissance_cac', 'puissance_cac');
    addStat('Défense', unit.defense, 'defense_cac', 'defense_cac');
    addStat('Armure', unit.armor, 'armure', 'armure');
  } else {
    statRows.push(`<div class="stat-row"><span>Attaque</span><span>${unit.attack}</span></div>`);
    statRows.push(`<div class="stat-row"><span>Puissance</span><span>${unit.power}</span></div>`);
    statRows.push(`<div class="stat-row"><span>Défense</span><span>${unit.defense}</span></div>`);
    statRows.push(`<div class="stat-row"><span>Armure</span><span>${unit.armor}</span></div>`);
  }
  statRows.push(`<div class="stat-row"><span>Vitesse</span><span>${speedLabel}</span></div>`);
  if (unit.range > 1) statRows.push(`<div class="stat-row"><span>Portée</span><span>${unit.range} cases</span></div>`);
  if (unit.visionRange > 0) statRows.push(`<div class="stat-row"><span>Vision</span><span>${unit.visionRange} cases</span></div>`);
  if (unit.isMine && unit.concealed) statRows.push(`<div class="stat-row" style="color:#8cdc8c"><span>Embuscade</span><span>cachée</span></div>`);
  if (unit.stunned) statRows.push(`<div class="stat-row" style="color:#e08080"><span>Duel perdu</span><span>sonné</span></div>`);
  if (!unit.isGeneral) {
    statRows.push(`<div class="stat-row"><span>Posture</span><span>${stanceLabel}</span></div>`);
    statRows.push(`<div class="stat-row" style="color:#a89060;font-size:0.8em"><span>Terrain</span><span>${terrainName}</span></div>`);
  }
  statRows.push(`<div class="stat-row"><span>Déplacé</span><span>${unit.hasMoved ? 'Oui' : 'Non'}</span></div>`);
  statRows.push(`<div class="stat-row"><span>Attaqué</span><span>${unit.hasAttacked ? 'Oui' : 'Non'}</span></div>`);

  document.getElementById('detail-stats').innerHTML = statRows.join('');
}

function renderUnitList() {
  if (!gameState) return;
  const list = document.getElementById('unit-list');
  list.innerHTML = '';

  const myUnits = gameState.myUnits || [];
  for (const u of myUnits) {
    const div = document.createElement('div');
    const done = u.hasMoved && u.hasAttacked;
    const fleeing = u.isFleeing ? ' style="color:#f84"' : '';
    const stanceLabel = u.stance ? (stanceNames[u.stance] || u.stance).charAt(0).toUpperCase() : '';
    div.className = `unit-row${selectedUnit?.id === u.id ? ' selected' : ''}${done ? ' done' : ''}${u.isGeneral ? ' is-general' : ''}`;
    div.innerHTML = `
      <span class="icon">${u.isGeneral ? '将' : '·'}</span>
      <span class="uname"${fleeing}>${u.name}${u.isFleeing ? ' (fuite)' : ''}</span>
      ${!u.isGeneral ? `<span class="uhp" style="font-size:0.75em;color:#7a5820" title="${u.stance || ''}">[${stanceLabel}]</span>` : ''}
      <span class="uhp">${u.vitality}/${u.maxVitality}</span>
    `;
    div.onclick = () => {
      if (u.q === null) return;
      selectUnit(u);
      // Pan camera to unit
      const { x, y } = hexToPixel(u.q, u.r);
      camX = -x * zoom;
      camY = -y * zoom;
      render();
    };
    list.appendChild(div);
  }
}

function renderDeployUnitList(units) {
  const list = document.getElementById('unit-list');
  list.innerHTML = '';

  // Instructions en haut
  const instr = document.createElement('div');
  instr.style.cssText = 'background:#0a1a0a;border:1px solid #2a5c2a;border-radius:6px;padding:10px;margin-bottom:10px;font-size:0.8em;color:#80c080;line-height:1.6;';
  instr.innerHTML = `
    <strong style="color:#c8960c">Comment placer :</strong><br>
    1. Clique sur une unité ci-dessous<br>
    2. Clique sur la <span style="color:#4aaa4a">zone verte</span> de la carte<br>
    3. Place ton Général en dernier<br>
    4. Clique <strong>Prêt !</strong>
  `;
  list.appendChild(instr);

  for (const u of units) {
    const placed = u.q !== null;
    const isSelected = selectedUnit && selectedUnit.id === u.id;
    const div = document.createElement('div');
    div.className = `unit-row${u.isGeneral ? ' is-general' : ''}${isSelected ? ' selected' : ''}`;
    div.style.cssText = placed ? 'opacity:0.6;' : 'cursor:pointer;';
    div.innerHTML = `
      <span class="icon">${u.isGeneral ? '将' : '·'}</span>
      <span class="uname">${u.name}</span>
      <span class="uhp" style="color:${placed ? '#4aaa4a' : '#c8960c'}">${placed ? 'Placé' : 'À placer'}</span>
    `;
    div.onclick = () => {
      selectedUnit = u;
      renderDeployUnitList(deployState.units);
      if (u.q === null) focusDeployZone();
      render();
    };
    list.appendChild(div);
  }
}

// ---- TOOLBAR ----
function setToolbarTool(tool) {
  // Fermer tous les popups ouverts
  document.querySelectorAll('.tool-popup.visible').forEach(p => p.classList.remove('visible'));
  document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`tool-${tool}`);
  if (btn) btn.classList.add('active');
}

function setGridOpacity(val) {
  gridOpacity = parseFloat(val);
  render();
}

function setGridThickness(val) {
  gridThickness = parseFloat(val);
  render();
}

function setGridColor(rgb) {
  gridColorRGB = rgb;
  document.querySelectorAll('.grid-color-swatch').forEach(s => s.classList.remove('active'));
  document.querySelectorAll(`.grid-color-swatch[data-rgb="${rgb}"]`).forEach(s => s.classList.add('active'));
  render();
}

function toggleToolPopup(id) {
  const popup = document.getElementById(id);
  const btn = popup.previousElementSibling;
  const isVisible = popup.classList.toggle('visible');
  btn.classList.toggle('active', isVisible);
}

function toggleGridSubmenu() {
  const sub = document.getElementById('grid-submenu');
  const btn = document.getElementById('tool-grid-group');
  const isVisible = sub.classList.toggle('visible');
  btn.classList.toggle('active', isVisible);
  if (!isVisible) {
    document.querySelectorAll('#grid-submenu .tool-popup').forEach(p => p.classList.remove('visible'));
    document.querySelectorAll('#grid-submenu .tool-btn').forEach(b => b.classList.remove('active'));
  }
}

function toggleTerrain() {
  showTerrain = !showTerrain;
  document.getElementById('tool-terrain').classList.toggle('active', showTerrain);
  render();
}

function toggleWeakness() {
  showWeakness = !showWeakness;
  const b = document.getElementById('tool-weakness');
  if (b) b.classList.toggle('active', showWeakness);
  render();
}

function toggleCoords() {
  showCoords = !showCoords;
  document.getElementById('tool-coords').classList.toggle('active', showCoords);
  render();
}

let turnPopupTimer = null;
let pendingTurnPopup = null;
function showTurnPopup(name, sub, color) {
  const el = document.getElementById('turn-popup');
  const nameEl = document.getElementById('turn-popup-name');
  const subEl = document.getElementById('turn-popup-sub');
  if (!el) return;
  nameEl.textContent = name;
  nameEl.style.color = color || '#ffd700';
  subEl.textContent = sub || '';
  el.classList.add('visible');
  if (turnPopupTimer) clearTimeout(turnPopupTimer);
  turnPopupTimer = setTimeout(() => el.classList.remove('visible'), 3000);
}

function togglePing() {
  pingMode = !pingMode;
  document.getElementById('tool-ping').classList.toggle('active', pingMode);
  canvas.style.cursor = pingMode ? 'crosshair' : '';
}

function drawPings(ctx) {
  const now = performance.now();
  const DURATION = 1800;
  for (let i = activePings.length - 1; i >= 0; i--) {
    const p = activePings[i];
    const elapsed = now - p.startTime;
    if (elapsed > DURATION) { activePings.splice(i, 1); continue; }
    const t = elapsed / DURATION;
    const { x, y } = hexToPixel(p.q, p.r);
    const maxR = HEX_SIZE * 1.2;
    const radius = maxR * t;
    const alpha = 1 - t;
    ctx.save();
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 3;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    // 2ème anneau décalé
    const radius2 = maxR * Math.max(0, t - 0.3);
    if (radius2 > 0) {
      ctx.beginPath();
      ctx.arc(x, y, radius2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (activePings.length > 0) requestAnimationFrame(() => render());
}

function showInitiativeModal(rolls, turnOrder, turn) {
  const overlay = document.getElementById('overlay-initiative');
  const content = document.getElementById('initiative-content');
  let html = `<h3 style="color:#c8960c;text-align:center;margin-bottom:14px">Tour ${turn} — Initiative</h3>`;
  html += `<div>`;
  for (let i = 0; i < turnOrder.length; i++) {
    const id = turnOrder[i];
    const roll = rolls[id];
    if (!roll) continue;
    const isMe = id === myId;
    html += `<div class="initiative-row${isMe ? ' mine' : ''}">
      <span class="rank">${i + 1}.</span>
      <span class="i-name">${roll.playerName}<span style="color:#7a5820;font-size:0.85em"> (${roll.generalName})</span></span>
      <span class="i-roll">Str ${roll.strategy} + D20 <strong>${roll.d20}</strong> = <strong>${roll.total}</strong></span>
    </div>`;
  }
  html += `</div>`;
  content.innerHTML = html;
  overlay.style.display = 'flex';
  if (window._initiativeTimer) clearTimeout(window._initiativeTimer);
}

function closeInitiativeModal() {
  document.getElementById('overlay-initiative').style.display = 'none';
  if (window._initiativeTimer) clearTimeout(window._initiativeTimer);
  if (window._pendingTurnPopupAfterInitiative) {
    const fn = window._pendingTurnPopupAfterInitiative;
    window._pendingTurnPopupAfterInitiative = null;
    fn();
  }
}

function renderTurnOrder(turnOrder, initiativeRolls, currentPlayerId) {
  const panel = document.getElementById('turn-order-panel');
  const list = document.getElementById('turn-order-list');
  if (!turnOrder || turnOrder.length === 0) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  list.innerHTML = '';
  const currentIdx = turnOrder.indexOf(currentPlayerId);

  for (let i = 0; i < turnOrder.length; i++) {
    const id = turnOrder[i];
    const roll = initiativeRolls?.[id];
    const isCurrent = id === currentPlayerId;
    const hasPlayed = currentIdx >= 0 && i < currentIdx;

    // Trouver le generalId du joueur
    const playerData = gameState?.players.find(p => p.id === id);
    const gid = playerData?.generalId;
    const imgToken = gid ? GENERAL_TOKEN_MAP[gid] : null;
    const img1Src = img1Url(GENERAL_IMAGE1_MAP, gid, 'GENERAL IMAGE 1-1');
    const imgTokenSrc = imgToken ? `/assets/unites/GENERAL TOKEN/${encodeURIComponent(imgToken)}.png` : null;
    let portraitHtml;
    if (img1Src) {
      portraitHtml = `<img class="to-portrait" src="${img1Src}">`;
    } else if (imgTokenSrc) {
      portraitHtml = `<img class="to-portrait" src="${imgTokenSrc}">`;
    } else {
      portraitHtml = `<div class="to-portrait-placeholder">将</div>`;
    }

    const name = roll?.playerName || roll?.generalName || id;
    const offline = playerData && playerData.connected === false;
    const div = document.createElement('div');
    div.className = `turn-order-item${isCurrent ? ' current' : ''}${hasPlayed ? ' played' : ''}`;
    if (offline) { div.style.opacity = '0.45'; div.title = 'Hors ligne'; }
    div.innerHTML = `${portraitHtml}<span class="to-name">${escapeHtml(name)}${offline ? ' (absent)' : ''}</span>`;
    list.appendChild(div);
  }
}

function endTurn(confirmed = false) {
  if (gameState?.currentPlayerId !== myId) return;
  if (!confirmed && gameState.actionsLeft > 0) {
    const names = (gameState.actionUnitIds || []).map(id => (gameState.myUnits || []).find(u => u.id === id)?.name).filter(Boolean);
    document.getElementById('confirm-end-msg').textContent = `${gameState.actionsLeft} unité${gameState.actionsLeft > 1 ? 's peuvent' : ' peut'} encore agir${names.length ? ' : ' + names.join(', ') : ''}.`;
    document.getElementById('overlay-confirm-end').style.display = 'flex';
    return;
  }
  document.getElementById('overlay-confirm-end').style.display = 'none';
  wsSend('end_turn', { roomCode });
  selectedUnit = null;
  movableTiles.clear();
  attackableTiles.clear();
  rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
  setMode('select');
  const stancePanel = document.getElementById('stance-panel');
  if (stancePanel) stancePanel.style.display = 'none';
}

function motivateAll() {
  if (!selectedUnit || !selectedUnit.isGeneral) return;
  wsSend('motivate_unit', { roomCode, generalId: selectedUnit.id });
}

const UNIT_ACTIONS = { sabotage: 'Saboter', build: 'Construire', ambush: 'Disparaître' };
function unitActionOf(unit) {
  if (!unit || unit.isGeneral) return null;
  const ab = KBRules.ability(unit, UNIT_TYPES);
  return ab && UNIT_ACTIONS[ab.type] ? { ...ab, label: UNIT_ACTIONS[ab.type] } : null;
}

// Espion / bâtisseurs: highlight the neighbours where the ability can act; assassin: vanish at once
function useUnitAbility(unit, ab) {
  if (ab.type === 'ambush') { wsSend('unit_vanish', { roomCode, unitId: unit.id }); return; }
  abilityTiles.clear();
  for (const [dq, dr] of KBRules.DIRS) {
    const nq = unit.q + dq, nr = unit.r + dr, nk = `${nq},${nr}`;
    if (!(nk in mapHeight)) continue;
    const seg = segmentData[segmentEdgeKey(unit.q, unit.r, nq, nr)] || null;
    const ter = terrainData[nk] || 'plain';
    let opts = [];
    if (ab.type === 'build') opts = KBRules.buildOptions(seg, ter);
    else { const o = KBRules.sabotageOption(seg, ter); if (o) opts = [{ id: 'sabotage', ...o }]; }
    if (opts.length) abilityTiles.set(nk, opts);
  }
  if (!abilityTiles.size) { notify(ab.type === 'build' ? 'Rien à construire ni à brûler à côté de cette unité.' : 'Aucune infrastructure à saboter à côté de cette unité.', 'info'); return; }
  setMode('ability');
  render();
}

function sendUnitAbility(hex, opt) {
  if (!selectedUnit) return;
  if (opt.id === 'sabotage') wsSend('unit_sabotage', { roomCode, unitId: selectedUnit.id, q: hex.q, r: hex.r });
  else wsSend('unit_build', { roomCode, unitId: selectedUnit.id, q: hex.q, r: hex.r, kind: opt.id });
  setMode('select');
  render();
}

function pickUnitAbilityOption(hex, opts) {
  if (opts.length === 1) { sendUnitAbility(hex, opts[0]); return; }
  const box = document.getElementById('ability-targets');
  document.getElementById('ability-target-title').textContent = 'Construire';
  box.innerHTML = '';
  for (const o of opts) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = KBRules.RULES.abilities.build_kinds[o.id]?.label || o.id;
    b.onclick = () => { closeAbilityTarget(); sendUnitAbility(hex, o); };
    box.appendChild(b);
  }
  document.getElementById('overlay-ability-target').style.display = 'flex';
}

function pickAbilityTarget(title, enemies, onPick) {
  const box = document.getElementById('ability-targets');
  document.getElementById('ability-target-title').textContent = title;
  box.innerHTML = '';
  for (const p of enemies) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.style.cssText = `border:2px solid ${p.color};background:#1a0f04;color:#e0c080;padding:8px 14px`;
    b.textContent = p.name;
    b.onclick = () => { closeAbilityTarget(); onPick(p.id); };
    box.appendChild(b);
  }
  document.getElementById('overlay-ability-target').style.display = 'flex';
}
window.pickAbilityTarget = pickAbilityTarget;

function useAbility() {
  const uab = unitActionOf(selectedUnit);
  if (uab) { useUnitAbility(selectedUnit, uab); return; }
  if (!selectedUnit || !selectedUnit.isGeneral || !selectedUnit.activeAbility) return;
  const ability = selectedUnit.activeAbility;
  if (ability.target !== 'enemy_army') { wsSend('use_ability', { roomCode }); return; }
  const enemies = (gameState?.players || []).filter(p => p.id !== myId && !p.isEliminated);
  if (enemies.length === 1) { wsSend('use_ability', { roomCode, targetId: enemies[0].id }); return; }
  const box = document.getElementById('ability-targets');
  document.getElementById('ability-target-title').textContent = ability.name;
  box.innerHTML = '';
  for (const p of enemies) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.style.cssText = `border:2px solid ${p.color};background:#1a0f04;color:#e0c080;padding:8px 14px`;
    b.textContent = p.name;
    b.onclick = () => { closeAbilityTarget(); wsSend('use_ability', { roomCode, targetId: p.id }); };
    box.appendChild(b);
  }
  document.getElementById('overlay-ability-target').style.display = 'flex';
}

function closeAbilityTarget() {
  document.getElementById('overlay-ability-target').style.display = 'none';
}

// ---- TOP BAR: time of day, scores, turn timer ----
// Displayed hour: time flows during the round instead of jumping at its start.
// Sequential: the round's hours are spread over the manches; simultaneous: the resolution playback sets an override per tick.
// hourOverride: a fixed hour, or a flow { from, span, start, dur } that advances continuously in real time (resolution playback).
// The shown hour is eased toward the target (no visible steps), and the HUD clock / 3D sun read it every frame.
let hourOverride = null;
let shownHour = null, shownAnim = null, clockTimer = null, lastClockText = '';
function targetHour() {
  if (!gameState || gameState.timeOfDay == null) return null;
  if (hourOverride != null) {
    if (typeof hourOverride !== 'object') return hourOverride;
    const f = hourOverride;
    const k = f.dur > 0 ? Math.min(1, Math.max(0, (performance.now() - f.start) / f.dur)) : 1;
    return (f.from + f.span * k) % 24;
  }
  const n = (gameState.turnOrder || []).length;
  if (gameState.mode === 'simultaneous' || n < 2 || !gameState.hoursPerTurn || gameState.phase !== 'battle') return gameState.timeOfDay;
  const i = Math.min(n - 1, Math.max(0, (gameState.manche || 1) - 1));
  return (gameState.timeOfDay + gameState.hoursPerTurn * i / n) % 24;
}
function displayHour() {
  const t = targetHour();
  if (t == null) { shownHour = null; shownAnim = null; return null; }
  const now = performance.now();
  if (shownHour == null || (hourOverride && typeof hourOverride === 'object')) { shownHour = t; shownAnim = null; return t; }
  const diff = (((t - shownHour) % 24) + 24) % 24;
  if (diff < 1e-4 || diff > 12) { shownHour = t; shownAnim = null; return t; }
  if (!shownAnim || shownAnim.to !== t) shownAnim = { from: shownHour, span: diff, to: t, t0: now, dur: Math.min(6000, 1500 + diff * 6000) };
  const k = Math.min(1, (now - shownAnim.t0) / shownAnim.dur);
  const e = k * k * (3 - 2 * k);
  shownHour = (shownAnim.from + shownAnim.span * e) % 24;
  if (k >= 1) { shownHour = t; shownAnim = null; }
  ensureClockTicker();
  return shownHour;
}
function clockMoving() { return !!shownAnim || !!(hourOverride && typeof hourOverride === 'object' && performance.now() < hourOverride.start + hourOverride.dur + 200); }
function clockText() {
  return `${gameState.isNight ? 'Nuit ·' : ''} Jour ${gameState.day || 1} · ${KBRules.formatHour(displayHour())}`;
}
// While the clock moves, refresh only the clock text (minutes), not the whole top bar
function ensureClockTicker() {
  if (clockTimer || !clockMoving()) return;
  clockTimer = setInterval(() => {
    const el = document.getElementById('top-time');
    if (el && gameState && gameState.timeOfDay != null) { const txt = clockText(); if (txt !== lastClockText) { lastClockText = txt; el.textContent = txt; } }
    if (!clockMoving()) { clearInterval(clockTimer); clockTimer = null; }
  }, 120);
}

function renderTopInfo() {
  const el = document.getElementById('top-time');
  if (!el) return;
  if (!gameState || gameState.timeOfDay == null) { el.textContent = ''; return; }
  lastClockText = clockText();
  el.textContent = lastClockText;
  ensureClockTicker();
  el.style.color = gameState.isNight ? '#9fb4ff' : '#e8c060';
  const sc = document.getElementById('top-scores');
  const objs = gameState.objectives || [];
  const capture = gameState.settings?.victoryMode === 'capture';
  const vp = capture ? gameState.settings?.victoryPoints || 0 : 0;
  if (sc) {
    sc.innerHTML = capture && (objs.length || vp) ? (gameState.players || []).map(p => `<span style="color:${p.color}">${escapeHtml(p.name)} ${gameState.scores?.[p.id] || 0}</span>`).join(' · ') + (vp ? ` <span class="text-muted">/ ${vp}</span>` : '') : '';
  }
  const mt = capture ? 0 : gameState.settings?.maxTurns;
  document.getElementById('top-turn').textContent = `Tour ${gameState.turn}${mt ? '/' + mt : ''} · Manche ${gameState.manche || 1}`;
}

setInterval(() => {
  const el = document.getElementById('top-timer');
  if (!el) return;
  const at = gameState?.phase === 'battle' ? gameState.turnEndsAt : null;
  if (!at) { el.textContent = ''; return; }
  const left = Math.max(0, Math.ceil((at - Date.now()) / 1000));
  el.textContent = `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  el.style.color = left <= 10 ? '#ff6040' : '#c8960c';
}, 500);

// ---- RULES PANEL ----
function toggleRules() {
  const o = document.getElementById('overlay-rules');
  if (o.style.display === 'flex') { o.style.display = 'none'; return; }
  const R = KBRules.RULES;
  const st = gameState?.settings || KBRules.defaultSettings();
  const tc = R.movement.terrainCost;
  const frac = (v) => (Math.abs(v - 1 / 3) < 1e-9 ? '1/3' : Math.abs(v - 0.5) < 1e-9 ? '1/2' : String(v));
  document.getElementById('rules-content').innerHTML = `
    <h3>Déplacement</h3>
    <p>Coût pour entrer dans une case : plaine ${tc.plain}, route ${frac(tc.road)}, forêt ${tc.forest}, fleuve ${tc.river}, bâtiment ${tc.building}, pont ${frac(tc.bridge)}.
    Montée : +${R.movement.slopeUpPerLevel} par niveau ; descente gratuite. Falaises et murs : infranchissables.
    Échelle : infanterie et généraux uniquement, coût ${R.movement.ladder.cost} (jamais la cavalerie ni les chars). Rivière et barrière : +1.
    Une unité qui n'a encore rien dépensé de sa vitesse peut toujours avancer d'une case, même trop chère.</p>
    <p>Cliquer un ennemi hors de portée (case orange) : l'unité s'approche puis attaque, en une seule action ; s'il est hors d'atteinte ce tour, elle ne bouge pas.</p>
    <h3>Jour et nuit</h3>
    <p>La bataille commence à ${KBRules.formatHour(R.time.startHour)} ; ${st.turnsPerHalfDay} tours par demi-journée. Nuit de ${R.time.nightStartHour}h à ${R.time.dayStartHour}h :
    vision ×${R.night.visionFactor} (min ${R.night.visionMin}), vitesse −${R.night.speedMalus}, attaque ${R.night.attackMod.cac} au corps à corps et ${R.night.attackMod.tir} au tir,
    la posture Repos (et Défense de combat) récupère davantage de moral et de vitalité.</p>
    <h3>Embuscades</h3>
    <p>Une unité en forêt ou dans un bâtiment est invisible pour l'ennemi, même dans sa vision, sauf si une unité ennemie lui est adjacente,
    si un espion ennemi est à ${R.concealment.spyDistance} cases ou moins, ou si elle a attaqué (révélée jusqu'à la fin de son prochain tour).
    Un déplacement qui bute sur une unité cachée s'arrête net (plus de vitesse ce tour).</p>
    <h3>Duels de généraux</h3>
    <p>Un général qui attaque un général au corps à corps provoque un duel : ${R.duel.maxRounds} passes, chacun lance D20 + Force ; le plus haut frappe
    (arme + écart − armure × ${R.duel.armorFactor}). Le vaincu (sauf s'il meurt) perd ${Math.round(R.duel.loserMoraleShock * 100)} % du moral de son armée et reste sonné un tour ;
    les unités du vainqueur à ${R.duel.boostRadius} cases gagnent ${Math.round(R.duel.winnerMoraleBoost * 100)} % de moral.</p>
    <p>Une armée qui perd son général est éliminée : ses unités perdent tout leur moral maximum et fuient. Un autre général qui réussit à les motiver les rallie et en prend le contrôle.</p>
    <h3>Objectifs et victoire</h3>
    <p>Finir son tour sur un objectif le capture ; chaque objectif tenu rapporte ses points au début de chaque tour.
    Victoire : dernier général en vie${st.victoryMode === 'capture' ? `, ou ${st.victoryPoints} points (mode capture)` : st.maxTurns ? `, ou armée la plus forte après ${st.maxTurns} tours (mode annihilation)` : ''}.</p>
    <h3>Tour de jeu</h3>
    <p>Le tour se termine automatiquement quand plus aucune unité ne peut agir.${st.turnTimer ? ` Minuteur : ${st.turnTimer} s par tour.` : ''}</p>
    <p class="text-muted" style="font-size:0.85em">Règles complètes : docs/regles.md</p>`;
  o.style.display = 'flex';
}

// ---- END OF BATTLE: recap + replay ----
let replayChunks = null;
let replayAction = null;
let replayWindow = null;

// The end screen waits until the last actions have been seen: resolution playback, unit moves, slow-motion shot, combat card
function showRecapWhenSettled(data) {
  const t0 = Date.now();
  let calmSince = null;
  const check = () => {
    const busy = (window.KBSim && KBSim.playbackInfo && KBSim.playbackInfo())
      || Object.keys(unitAnimations).length > 0
      || (window.view3d && window.view3d.active && window.view3d.cinematicBusy)
      || document.body.classList.contains('hud-splash-on');
    if (busy) calmSince = null;
    else if (calmSince == null) calmSince = Date.now();
    if ((calmSince != null && Date.now() - calmSince >= 1500) || Date.now() - t0 > 60000) showRecap(data);
    else setTimeout(check, 200);
  };
  setTimeout(check, 300);
}

function showRecap(data) {
  const recap = data.recap;
  document.getElementById('gameover-msg').textContent = data.winnerName ? `${data.winnerName} remporte la bataille !` : 'Match nul !';
  const reasons = { elimination: 'Général ennemi vaincu', points: 'Points de victoire atteints', max_turns: 'Limite de tours atteinte' };
  const box = document.getElementById('recap-content');
  if (!recap) { box.innerHTML = ''; }
  else {
    const rows = recap.players.map(p => `<tr><td style="color:${p.color}">${escapeHtml(p.name)}${p.id === recap.winnerId ? ' (vainqueur)' : ''}</td><td>${p.damageDealt}</td><td>${p.damageTaken}</td><td>${p.kills}</td><td>${p.losses}</td><td>${p.captures}</td><td>${p.points}</td><td>${p.unitsAlive}/${p.unitsTotal}</td></tr>`).join('');
    const units = recap.units.slice().sort((a, b) => b.damageDealt - a.damageDealt).map(u => {
      const pl = recap.players.find(p => p.id === u.playerId);
      return `<tr style="${u.alive ? '' : 'opacity:0.55'}"><td style="color:${pl?.color || '#ccc'}">${u.isGeneral ? '将 ' : ''}${escapeHtml(u.name)}</td><td>${u.damageDealt}</td><td>${u.damageTaken}</td><td>${u.kills}</td><td>${u.alive ? 'vivante' : u.fled ? 'en fuite' : 'détruite'}</td></tr>`;
    }).join('');
    box.innerHTML = `<div class="text-muted" style="margin-bottom:8px">${reasons[recap.endReason] || ''} · ${recap.turns} tours</div>
      <table class="recap-table"><tr><th>Joueur</th><th>Dégâts infligés</th><th>Dégâts subis</th><th>Victimes</th><th>Pertes</th><th>Captures</th><th>Points</th><th>Unités</th></tr>${rows}</table>
      <details style="margin-top:10px"><summary style="cursor:pointer;color:#c8960c">Détail par unité</summary>
      <table class="recap-table"><tr><th>Unité</th><th>Infligés</th><th>Subis</th><th>Victimes</th><th>État</th></tr>${units}</table></details>`;
  }
  document.getElementById('btn-replay-view').style.display = recap && recap.replayAvailable ? '' : 'none';
  document.getElementById('btn-replay-download').style.display = recap && recap.replayAvailable ? '' : 'none';
  document.getElementById('overlay-gameover').style.display = 'flex';
}

function requestReplay(action) {
  replayAction = action;
  replayChunks = null;
  // Open the tab during the click: browsers block window.open once the replay arrives over the socket
  if (action === 'view') {
    replayWindow = window.open('', '_blank');
    if (replayWindow) replayWindow.document.title = 'Replay…';
  }
  wsSend('get_replay', { roomCode });
}

function onReplayChunk(data) {
  if (!replayChunks || replayChunks.length !== data.total) replayChunks = new Array(data.total).fill(null);
  replayChunks[data.index] = data.data;
  if (replayChunks.some(c => c === null)) return;
  const text = replayChunks.join('');
  replayChunks = null;
  if (replayAction === 'download') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = `replay_${roomCode || 'bataille'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } else {
    const win = replayWindow;
    replayWindow = null;
    try { localStorage.setItem('kb_last_replay', text); } catch (e) {
      if (win && !win.closed) win.close();
      notify('Replay trop volumineux pour le stockage local : téléchargez-le.');
      return;
    }
    if (win && !win.closed) win.location.href = '/replay.html?local=1';
    else if (!window.open('/replay.html?local=1', '_blank')) notify('Le navigateur a bloqué l\'ouverture du replay : autorisez les fenêtres pour ce site, ou téléchargez-le.');
  }
}

function deploymentReady() {
  const gen = deployState?.units.find(u => u.isGeneral);
  if (!gen || gen.q === null) {
    notify('Vous devez placer votre Général avant d\'être prêt.');
    return;
  }
  wsSend('deployment_ready', { roomCode });
  setDeployReadyButtons('En attente des autres joueurs…', true);
}

function setDeployReadyButtons(text, disabled) {
  for (const id of ['btn-deploy-ready-global', 'btn-deploy-ready-center']) {
    const b = document.getElementById(id);
    if (!b) continue;
    b.textContent = text;
    b.disabled = disabled;
  }
}

// an enemy general's ability is never announced (no banner, notification or journal line): its effects show in play
const hiddenAbility = (log) => !!(log && log.abilityUsed && log.playerId && log.playerId !== myId);
function addCombatLog(log) {
  if (hiddenAbility(log)) return;
  const container = document.getElementById('combat-log');
  const entry = document.createElement('div');
  entry.className = 'combat-log-entry' + (log.targetKilled ? ' kill' : log.hit ? ' hit' : ' miss');

  let text = '';
  if (log.abilityUsed) {
    text = `${log.abilityUsed} : ${log.effects?.join(', ')}`;
  } else if (log.duel) {
    const w = log.duel.winnerId === log.attackerId ? log.attackerName : log.duel.winnerId === log.targetId ? log.targetName : null;
    text = `Duel ${log.attackerName} / ${log.targetName} : ${w ? `${w} l'emporte` : 'indécis'}`;
    if (log.generalKilled) text += ' — GÉNÉRAL TUÉ !';
  } else {
    text = `${log.attackerName} → ${log.targetName}: `;
    // Support both old format (damage) and new format (dmgReceived)
    const dmg = log.dmgReceived != null ? log.dmgReceived : log.damage;
    text += log.hit ? `${dmg} dégâts` : 'Manqué';
    if (log.targetKilled) text += ` (${log.targetName} éliminé!)`;
    if (log.generalKilled) text += ` — GÉNÉRAL TUÉ !`;
    if (log.trample) text = `Piétinement : ${text}`;
    if (log.bonuses && log.bonuses.length) text += ` — ${log.bonuses.map(b => b.text).join(' ; ')}`;
  }
  entry.textContent = text;
  container.insertBefore(entry, container.firstChild);
  if (container.children.length > 20) container.lastChild.remove();
}

function showUnitCard(unit) {
  const overlay = document.getElementById('overlay-unit-card');
  const content = document.getElementById('unit-card-content');

  // Image portrait
  let imgHtml = '';
  if (unit.isGeneral) {
    const gid = unit.generalId || (gameState?.players.find(p => p.id === unit.playerId)?.generalId);
    const src = img1Url(GENERAL_IMAGE1_MAP, gid, 'GENERAL IMAGE 1-1');
    if (src) {
      imgHtml = `<img class="uc-pdf-img" src="${src}" alt="${unit.name}">`;
    } else {
      imgHtml = `<div class="uc-pdf-img-placeholder" style="font-size:52px;flex-direction:column;gap:8px">将<span style="font-size:14px;color:#7a5820">${unit.name}</span></div>`;
    }
  } else {
    const src = img1Url(UNIT_IMAGE1_MAP, unit.typeId, 'UNIT IMAGE 1-1');
    const imgToken = UNIT_TOKEN_MAP[unit.typeId];
    if (src) {
      imgHtml = `<img class="uc-pdf-img" src="${src}" alt="${unit.name}">`;
    } else if (imgToken) {
      imgHtml = `<img class="uc-pdf-img" src="/assets/unites/UNIT TOKEN/${encodeURIComponent(imgToken)}.png" alt="${unit.name}">`;
    } else {
      imgHtml = `<div class="uc-pdf-img-placeholder">${unit.name.charAt(0)}</div>`;
    }
  }

  // Barre de vie
  const hpPct = Math.round(unit.vitality / unit.maxVitality * 100);
  const hpColor = hpPct > 50 ? '#2a8c2a' : hpPct > 25 ? '#c8960c' : '#a02020';
  const hpBar = `<div class="uc-pdf-hpbar-wrap"><div class="uc-pdf-hpbar" style="width:${hpPct}%;background:${hpColor}"></div></div>`;

  // Modificateurs stance + terrain
  const _st = (!unit.isGeneral && unit.stance) ? (STANCES_DATA[unit.stance] || {}) : {};
  const _terrainKey = (unit.q != null && unit.r != null) ? `${unit.q},${unit.r}` : null;
  const _terrainType = _terrainKey ? (terrainData[_terrainKey] || 'plain') : 'plain';
  const _tr = TERRAINS_DATA[_terrainType] || TERRAINS_DATA.plain;
  const _stanceName = unit.stance ? (stanceNames[unit.stance] || unit.stance) : null;
  const _terrainName = _tr.name || _terrainType;

  // Retourne { html, tip } pour une stat avec modificateurs cac/tir (ou single si cac===tir)
  function _mod(base, stCacKey, stTirKey, trCacKey, trTirKey) {
    const sCac = _st[stCacKey] || 0, sTir = stTirKey ? (_st[stTirKey] || 0) : sCac;
    const tCac = trCacKey ? (_tr[trCacKey] || 0) : 0, tTir = trTirKey ? (_tr[trTirKey] || 0) : tCac;
    const dCac = sCac + tCac, dTir = sTir + tTir;

    const tipParts = [`Base : ${base}`];
    if (_stanceName && (sCac !== 0 || sTir !== 0)) {
      tipParts.push(`Posture (${_stanceName}) : ${sCac >= 0 ? '+' : ''}${sCac} cac / ${sTir >= 0 ? '+' : ''}${sTir} tir`);
    }
    if (_terrainType !== 'plain' && (tCac !== 0 || tTir !== 0)) {
      tipParts.push(`Terrain (${_terrainName}) : ${tCac >= 0 ? '+' : ''}${tCac} cac / ${tTir >= 0 ? '+' : ''}${tTir} tir`);
    }
    const tip = tipParts.join(' | ');

    if (dCac === 0 && dTir === 0) return { html: String(base), tip };

    const fmt = (base, d) => {
      const eff = base + d;
      const color = d > 0 ? '#2e7d32' : '#c62828';
      const sign = d > 0 ? '+' : '';
      return `<span style="color:${color};font-weight:bold">${eff}<sup style="font-size:0.6em">(${sign}${d})</sup></span>`;
    };

    if (dCac === dTir) return { html: fmt(base, dCac), tip };
    return { html: `${fmt(base, dCac)}<span style="color:#888;font-size:0.75em"> / ${fmt(base, dTir)}</span>`, tip };
  }

  function _statDiv(label, html, tip) {
    return `<div class="uc-pdf-stat" title="${tip.replace(/"/g, '&quot;')}"><div class="uc-pdf-stat-label">${label}</div><div class="uc-pdf-stat-value">${html}</div></div>`;
  }

  // Stats — fiche spéciale pour les généraux
  let statsHtml;
  if (unit.isGeneral) {
    const row2 = [
      { label: '<span class="uc-sym">⚔</span> Force',      value: unit.force },
      { label: '<span class="uc-sym">♞</span> Stratégie',  value: unit.strategy },
      { label: '<span class="uc-sym">♛</span> Charisme',   value: unit.charisma },
    ];
    const row3 = [
      { label: 'Puissance',    value: unit.power },
      { label: 'Armure',       value: unit.armor },
      { label: 'Intimidation', value: unit.intimidation ?? 0 },
      { label: 'Vitesse',      value: unit.speed },
    ];
    const vit = `<div class="uc-pdf-stat" style="grid-column:1/-1"><div class="uc-pdf-stat-label">Vitalité</div><div class="uc-pdf-stat-value">${unit.vitality}/${unit.maxVitality}</div></div>`;
    const r2 = `<div style="grid-column:1/-1;display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px">${row2.map(s => `<div class="uc-pdf-stat"><div class="uc-pdf-stat-label">${s.label}</div><div class="uc-pdf-stat-value">${s.value}</div></div>`).join('')}</div>`;
    const r3 = row3.map(s => `<div class="uc-pdf-stat"><div class="uc-pdf-stat-label">${s.label}</div><div class="uc-pdf-stat-value">${s.value}</div></div>`).join('');
    statsHtml = vit + r2 + r3;
  } else {
    const atk  = _mod(unit.attack,           'attack_cac',       'attack_tir',       'attack_cac',       'attack_tir');
    const def  = _mod(unit.defense,          'defense_cac',      'defense_tir',      'defense_cac',      'defense_tir');
    const pui  = _mod(unit.power,            'puissance_cac',    'puissance_tir',    'puissance_cac',    'puissance_tir');
    const inti = _mod(unit.intimidation ?? 0,'intimidation_cac', 'intimidation_tir', 'intimidation_cac', 'intimidation_tir');
    const arm  = _mod(unit.armor,            'armure',           null,               'armure',           null);
    const spd  = _mod(unit.speed,            'vitesse',          null,               null,               null); // the hex the unit stands on does not change its speed

    statsHtml = [
      `<div class="uc-pdf-stat" style="grid-column:1/-1"><div class="uc-pdf-stat-label">Vitalité</div><div class="uc-pdf-stat-value">${unit.vitality}/${unit.maxVitality}</div></div>`,
      `<div class="uc-pdf-stat" style="grid-column:1/-1"><div class="uc-pdf-stat-label">Morale</div><div class="uc-pdf-stat-value">${unit.morale ?? '—'}/${unit.maxMorale ?? '—'}</div></div>`,
      _statDiv('Attaque',      atk.html,  atk.tip),
      _statDiv('Défense',      def.html,  def.tip),
      _statDiv('Puissance',    pui.html,  pui.tip),
      _statDiv('Intimidation', inti.html, inti.tip),
      _statDiv('Armure',       arm.html,  arm.tip),
      _statDiv('Vitesse',      spd.html,  spd.tip),
    ].join('');
    if (unit.range > 1) statsHtml += `<div class="uc-pdf-stat"><div class="uc-pdf-stat-label">Portée</div><div class="uc-pdf-stat-value">${unit.range} cases</div></div>`;
  }

  // Bonus / capacités
  const bonusLines = [];
  if (unit.bonus) bonusLines.push(`<strong>Bonus :</strong> ${unit.bonus}`);
  if (unit.activeAbility) bonusLines.push(`<strong>Capacité active :</strong> ${unit.activeAbility.name} — ${unit.activeAbility.description} (recharge : ${unit.activeAbility.cooldown} tours)`);
  if (unit.passiveAbility) bonusLines.push(`<strong>Passif :</strong> ${unit.passiveAbility.name} — ${unit.passiveAbility.description}`);
  const bonusHtml = bonusLines.length
    ? `<div class="uc-pdf-bonus">${bonusLines.join('<br>')}</div>`
    : `<div class="uc-pdf-bonus" style="color:#888;font-style:italic">Aucun bonus spécial</div>`;

  // Titre
  const titleSub = unit.isGeneral ? `${unit.kingdom || ''}</span>` : (unit.category ? `(${unit.category})</span>` : '</span>');
  const category = `<br><span style="font-size:0.85em">${titleSub}`;
  const titleHtml = `<div class="uc-pdf-title">${unit.name}${category}</div>`;

  // Description
  const descHtml = unit.description || unit.citation
    ? `<div class="uc-pdf-desc"><strong>Description :</strong> ${unit.description || unit.citation}</div>`
    : '';

  content.innerHTML = `
    <div class="uc-pdf">
      <div class="uc-pdf-left">
        ${imgHtml}
        ${hpBar}
        ${bonusHtml}
      </div>
      <div class="uc-pdf-right">
        ${titleHtml}
        <div class="uc-pdf-stats">${statsHtml}</div>
      </div>
      ${descHtml}
    </div>
  `;

  overlay.style.display = 'flex';
}

function closeUnitCard() {
  document.getElementById('overlay-unit-card').style.display = 'none';
}

function switchSidebarTab(tab) {
  const tabs = ['units', 'history', 'chat'];
  document.querySelectorAll('.sidebar-tab').forEach((el, i) => {
    el.classList.toggle('active', tabs[i] === tab);
  });
  document.getElementById('pane-units').classList.toggle('active', tab === 'units');
  document.getElementById('pane-history').classList.toggle('active', tab === 'history');
  document.getElementById('pane-chat').classList.toggle('active', tab === 'chat');
  if (tab === 'chat') {
    document.getElementById('tab-chat').classList.remove('unread');
    const msgs = document.getElementById('chat-messages');
    msgs.scrollTop = msgs.scrollHeight;
    document.getElementById('chat-input').focus();
  }
  updateActionButtons();
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  wsSend('chat_message', { roomCode, text });
  input.value = '';
}

function appendChatMessage({ authorName, text, isMine, isSystem, authorId, isSpectator: isSpectatorMsg }) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  if (isSystem) {
    div.className = 'chat-msg system';
    div.textContent = text;
  } else {
    const players = gameState?.players || deployState?.players || [];
    const color = authorId ? (players.find(p => p.id === authorId)?.color || '#c8960c') : '#c8960c';
    div.className = `chat-msg ${isMine ? 'mine' : 'other'}`;
    div.innerHTML = `<span class="chat-author" style="color:${escapeHtml(color)}">${escapeHtml(authorName)}${isSpectatorMsg ? ' <span style="opacity:0.6">(spectateur)</span>' : ''} : </span><span class="chat-text">${escapeHtml(text)}</span>`;
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  const pane = document.getElementById('pane-chat');
  if (!pane.classList.contains('active')) {
    document.getElementById('tab-chat').classList.add('unread');
  }
}

let combatHistoryEntries = [];
function addCombatHistory(log, round) {
  const idx = combatHistoryEntries.length;
  combatHistoryEntries.push({ log, round, idx });
  const container = document.getElementById('combat-history');
  if (!container) return;
  const entry = document.createElement('div');
  entry.innerHTML = formatHistoryEntry({ log, round, idx });
  container.appendChild(entry.firstElementChild);
  container.scrollTop = container.scrollHeight;
}

// Readable summary of a combat: who struck whom, how, and what each side lost (details unfold below)
function historyCard(log, round, idx, id, attackerColor, targetColor) {
  const e = escapeHtml;
  const who = (name, color) => `<span class="hc-unit"${color ? ` style="--c:${e(color)}"` : ''}><i></i>${e(name || '?')}</span>`;
  const known = (unitId) => [...(gameState?.units || []), ...(gameState?.myUnits || [])].find(u => u.id === unitId);
  const bar = (left, lost, unitId) => {
    const u = known(unitId);
    const max = u?.maxVitality || (left != null ? left + (lost || 0) : 0);
    if (!max || left == null) return '';
    const after = Math.max(0, Math.min(100, left / max * 100)), before = Math.max(after, Math.min(100, (left + (lost || 0)) / max * 100));
    return `<span class="hc-bar" title="${left} / ${max} vitalité"><i class="hc-left" style="width:${after}%"></i><i class="hc-lost" style="left:${after}%;width:${before - after}%"></i></span>`;
  };
  const kind = log.duel ? 'Duel' : log.trample ? 'Piétinement' : log.ranged ? 'Tir' : 'Corps à corps';
  const icon = log.duel ? '⚔' : log.ranged ? '➶' : '⚔';
  const lines = [];
  const b = log.breakdown || {};
  if (log.duel) {
    const d = log.duel;
    const won = d.winnerId === log.attackerId ? log.attackerName : d.winnerId ? log.targetName : null;
    lines.push(`<div class="hc-line">${d.rounds.length} passe${d.rounds.length > 1 ? 's' : ''} · ${won ? `<b>${e(won)}</b> l'emporte` : 'égalité'}${d.stunned ? ' · le vaincu est sonné' : ''}</div>`);
  } else if (b.NGOAtt != null && b.generalD20 == null) {
    lines.push(`<div class="hc-line">${b.attReussite} coup${b.attReussite > 1 ? 's' : ''} porté${b.attReussite > 1 ? 's' : ''} sur ${b.NGOAtt} (il fallait ${b.attackEff} ou moins au d20)</div>`);
  }
  const loss = (vit, mor) => [vit ? `<b class="hc-vit">−${vit} vitalité</b>` : '', mor ? `<b class="hc-mor">−${mor} moral</b>` : ''].filter(Boolean).join(' · ') || '<span class="hc-none">aucune perte</span>';
  const tVit = log.dmgReceived ?? log.dmgInflicted ?? 0;
  const defLabel = { counter: 'riposte', absorb: 'encaisse (dégâts ÷ 2)', rien: 'ne se défend pas', none: 'ne se défend pas' }[log.defenseChoice];
  lines.push(`<div class="hc-side"><span class="hc-lbl">${e(log.targetName || '?')}</span>${loss(tVit, log.moralDmg)}${bar(log.targetVitalityLeft, tVit, log.targetId)}</div>`);
  if (!log.duel && defLabel && !log.ranged) lines.push(`<div class="hc-line hc-def">La cible ${defLabel}</div>`);
  if (log.counterDmgReceived || log.counterMoralDmg || (log.duel && log.counterDmgReceived != null)) {
    lines.push(`<div class="hc-side"><span class="hc-lbl">${e(log.attackerName || '?')}</span>${loss(log.counterDmgReceived, log.counterMoralDmg)}${bar(log.attackerVitalityLeft, log.counterDmgReceived, log.attackerId)}</div>`);
  }
  const tags = [];
  if (b.angleName) tags.push(b.angleName === 'dos' ? 'de dos' : 'de flanc');
  if (b.modHauteur > 0) tags.push('en hauteur');
  if (b.modNuit) tags.push('de nuit');
  if (log.targetKilled) tags.push('<span class="hc-dead">cible détruite</span>');
  if (log.attackerKilled) tags.push('<span class="hc-dead">attaquant détruit</span>');
  if (!log.targetKilled && log.targetMoraleLeft != null && log.targetMoraleLeft < 0) tags.push('<span class="hc-dead">cible en fuite</span>');
  return `<div class="h-header hc" onclick="toggleHistory('${id}')"${attackerColor ? ` style="border-left:4px solid ${e(attackerColor)}"` : ''}>
    <div class="hc-top"><span class="hc-turn">T${round}</span><span class="hc-kind">${icon} ${kind}</span>${idx != null && !log.abilityUsed ? `<button class="h-open" title="Rouvrir la fiche de ce combat" onclick="event.stopPropagation(); window.hudOpenCombat && window.hudOpenCombat(${idx})">FICHE</button>` : ''}<span class="h-arrow" id="arrow-${id}">▶</span></div>
    <div class="hc-vs">${who(log.attackerName, attackerColor)}<span class="hc-arrow">→</span>${who(log.targetName, targetColor)}</div>
    ${lines.join('')}
    ${tags.length ? `<div class="hc-tags">${tags.join(' · ')}</div>` : ''}
  </div>`;
}

let historyCounter = 0;
function formatHistoryEntry({ log, round, idx = null }) {
  if (!log) return '';
  const id = `h${historyCounter++}`;
  const b = log.breakdown || {};
  const hit = log.hit;
  const defLabels = { rien: 'Aucune défense', none: 'Aucune défense', counter: 'Contre-attaque', absorb: 'Encaissement' };
  const stanceNames2 = { marche: 'Marche', combat: 'Combat', charge: 'Charge', repos: 'Repos', defense_combat: 'Déf. combat', defense_distance: 'Déf. distance' };
  const terrainNames = { plain: 'Plaines', forest: 'Forêt', river: 'Rivière', road: 'Route', building: 'Bâtiment', bridge: 'Pont' };
  const aSt = stanceNames2[b.attackerStance] || b.attackerStance || '—';
  const dSt = stanceNames2[b.defenderStance] || b.defenderStance || '—';
  const aTe = terrainNames[b.attackerTerrain] || b.attackerTerrain || '—';
  const dTe = terrainNames[b.defenderTerrain] || b.defenderTerrain || '—';
  const attackerColor = gameState?.players?.find(p => p.id === log.attackerPlayerId)?.color;
  const targetColor = gameState?.players?.find(p => p.id === log.targetPlayerId)?.color;

  const header = historyCard(log, round, idx, id, attackerColor, targetColor);

  const sign = n => n >= 0 ? `+${n}` : `${n}`;
  const row = (label, val, cls = '') => (val === null || val === undefined || val === '') ? '' : `<tr class="${cls}"><td>${label}</td><td>${val}</td></tr>`;
  const mods = (...list) => list.filter(([v]) => v).map(([v, l]) => `${sign(v)} ${l}`).join(', ');
  const modRow = (label, ...list) => { const m = mods(...list); return m ? row(label, m) : ''; };
  const pct = (x) => x == null ? '—' : `${Math.round(x * 100)} %`;
  const general = b.generalD20 != null;
  const generalDef = b.generalD20Def != null;

  if (log.duel) {
    const nm = (uid) => (uid === log.attackerId ? log.attackerName : log.targetName) || '?';
    const rows = (log.duel.rounds || []).map((r, i) => row(`Passe ${i + 1} : ${r.attackerRoll} contre ${r.defenderRoll}`, r.attacker ? `${escapeHtml(nm(r.attacker))} frappe <b>−${r.dmg}</b>` : 'égalité')).join('');
    return `<div class="history-entry">${header}<div class="h-detail" id="${id}" style="display:none"><table class="h-table"><tbody><tr class="h-section"><td colspan="2">DUEL (D20 + FORCE)</td></tr>${rows}</tbody></table></div></div>`;
  }
  let table = `<div class="h-detail" id="${id}" style="display:none"><table class="h-table"><tbody>
    <tr class="h-section"><td colspan="2">ATTAQUE</td></tr>`;
  if (general) {
    table += row('Force − d20 + 80', `${b.attackBase} − ${b.generalD20} + 80 = <b>${b.generalAttValue}</b>`, 'h-hit-row');
  } else {
    table += row('Dés (1 par 5 de vitalité)', b.NGOAtt);
    table += row('Attaque effective', `${b.attackBase} → <b>${b.attackEff}</b>`);
    table += modRow('Modificateurs', [b.modAngle, b.angleName === 'dos' ? 'de dos' : 'de flanc'], [b.modAtkStance, aSt], [b.modAtkTerrain, aTe], [b.modEsquive, 'esquive'], [b.modHauteur, 'hauteur'], [b.modNuit, 'nuit'], [b.extraAttack, 'charge']);
    table += row('Réussites (d20 ≤ attaque)', `<b>${b.attReussite} / ${b.NGOAtt}</b>`, hit ? 'h-hit-row' : 'h-miss-row');
  }
  table += `<tr class="h-section"><td colspan="2">DÉGÂTS</td></tr>`;
  table += row('Puissance', general ? `${b.basePowerAtt} (÷5, ÷2)` : `${b.basePowerAtt} → <b>${b.effectivePowerAtt}</b>`);
  if (!general) table += modRow('Modificateurs puissance', [b.lancierBonus, 'lanciers'], [b.modPwrAtt, aSt], [b.modAngle, 'angle'], [b.extraPower, 'charge']);
  table += row('Armure défenseur', `${b.baseArmorDef} → <b>${b.effectiveArmorDef}</b>`);
  table += modRow('Modificateurs armure', [b.modArmorDefAngle, 'angle'], [b.modArmorDefStance, dSt], [b.modArmorDefTerrain, dTe], [b.phalangeBonus, 'phalange'], [b.lancierRangedBonus, 'lanciers']);
  table += row('Ratio d\'armure', `${pct(b.ratARDef)} (dés ${b.NGODef} × armure)`);
  table += row('Vitalité perdue', `<b>${log.dmgReceived ?? 0}</b>${log.defenseChoice === 'absorb' ? ' (÷2)' : ''}`, 'h-hit-row');
  table += row('Vitalité restante cible', log.targetVitalityLeft ?? '—');
  table += `<tr class="h-section"><td colspan="2">MORAL</td></tr>`;
  table += row('Intimidation effective', b.effectiveIntimidation);
  table += modRow('Modificateurs', [b.modIntimAtt, aSt], [b.modCourageDef, 'courage'], [b.modAngle, 'angle']);
  table += row('Moral perdu', log.moralDmg ?? 0);
  if (log.targetMoraleLeft != null) table += row('Moral restant cible', log.targetMoraleLeft);

  if (log.defenseChoice === 'counter' || log.defenseChoice === 'absorb') {
    table += `<tr class="h-section"><td colspan="2">DÉFENSE — ${defLabels[log.defenseChoice]}</td></tr>`;
    if (generalDef) {
      table += row('Force − d20 + 80', `${b.defBase} − ${b.generalD20Def} + 80 = <b>${b.generalAttValueDef}</b>`);
    } else {
      table += row('Dés', b.NGODef);
      table += row('Défense effective', `${b.defBase} → <b>${b.defEff}</b>`);
      table += modRow('Modificateurs', [b.modDefAngle, 'angle'], [b.modDefStance, dSt], [b.modDefTerrain, dTe], [b.modPrecision, 'précision'], [b.modHauteurDef, 'hauteur']);
      table += row('Réussites', `<b>${b.defReussite ?? 0} / ${b.NGODef}</b>`, log.defenseSuccess ? 'h-hit-row' : 'h-miss-row');
      table += row('Puissance riposte', `${b.basePowerDef} → <b>${b.effectivePowerDef}</b>`);
    }
    table += row('Armure attaquant', `${b.baseArmorAtt} → <b>${b.effectiveArmorAtt}</b> · ratio ${pct(b.ratARAtt)}`);
    if (log.counterDmgReceived > 0) {
      table += row('Vitalité perdue (attaquant)', `<b>${log.counterDmgReceived}</b>`, 'h-hit-row');
      table += row('Vitalité restante atq.', log.attackerVitalityLeft ?? '—');
    }
    if (log.counterMoralDmg > 0) table += row('Moral perdu (attaquant)', log.counterMoralDmg);
  } else if (log.defenseChoice) {
    table += `<tr class="h-section"><td colspan="2">${defLabels[log.defenseChoice] || log.defenseChoice}</td></tr>`;
  }
  if (log.bonuses && log.bonuses.length) {
    table += `<tr class="h-section"><td colspan="2">CAPACITÉS</td></tr>`;
    for (const bo of log.bonuses) table += `<tr><td colspan="2">${bo.text}</td></tr>`;
  }

  table += `</tbody></table></div>`;
  return `<div class="history-entry">${header}${table}</div>`;
}

function toggleHistory(id) {
  const el = document.getElementById(id);
  const arrow = document.getElementById(`arrow-${id}`);
  if (!el) return;
  const open = el.style.display === 'block';
  el.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▶' : '▼';
}

function notify(msg, type = 'error') {
  const n = document.getElementById('notification');
  n.textContent = msg;
  n.className = type;
  n.style.display = 'block';
  setTimeout(() => n.style.display = 'none', 3000);
}

// ---- STANCE PANEL ----
function renderStancePanel(unit) {
  const panel = document.getElementById('stance-panel');
  const listEl = document.getElementById('stance-list');
  if (!panel || !listEl) return;
  if (!unit || unit.isGeneral || gameState?.currentPlayerId !== myId || unit.isFleeing || gameState?.phase !== 'battle') {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  listEl.innerHTML = '';
  for (const s of stanceList) {
    const btn = document.createElement('button');
    btn.className = 'stance-btn' + (unit.stance === s ? ' active' : '');
    btn.title = stanceNames[s] || s;
    const icon = stanceIcons[s];
    if (icon && icon.complete && icon.naturalWidth) {
      btn.innerHTML = `<img src="${icon.src}" alt="${s}"> ${stanceNames[s] || s}`;
    } else {
      btn.textContent = stanceNames[s] || s;
    }
    btn.onclick = () => { hideStanceTooltip(); changeStance(unit.id, s); };
    btn.addEventListener('mouseenter', e => showStanceTooltip(e, s));
    btn.addEventListener('mousemove', positionStanceTooltip);
    btn.addEventListener('mouseleave', hideStanceTooltip);
    listEl.appendChild(btn);
  }
}

// ---- TERRAIN / SEGMENT TOOLTIP ----
function ttGrid(rows, showTir = true) {
  const cell = (val) => {
    if (val === null || val === undefined || val === 0) return `<td style="color:#555">—</td>`;
    const cls = val > 0 ? 'tt-pos' : 'tt-neg';
    return `<td class="${cls}">${val > 0 ? '+' : ''}${val}</td>`;
  };
  let html = `<table class="tt-grid"><thead><tr><th></th><th>Cac</th>${showTir ? '<th>Tir</th>' : ''}</tr></thead><tbody>`;
  for (const [label, cac, tir] of rows) {
    if (!showTir && cac === 0) continue;
    if (showTir && cac === 0 && tir === 0) continue;
    html += `<tr><td class="tt-label">${label}</td>${cell(cac)}${showTir ? cell(tir) : ''}</tr>`;
  }
  html += `</tbody></table>`;
  return html;
}

// Bonus tooltips (stance, terrain): title with its marker, bonuses and penalties as green / red chips for the kind of
// combat of the selected unit (melee or shooting), then movement, armour, morale and a rule line
// Recap card of a stance or a terrain (hover): grouped sections, melee and ranged side by side (the column of the selected
// unit stands out), green bonuses / red penalties, zero rows left out
//   single: [[label, value, fmt?]] rows with one value for both columns (speed, armour, per-turn effects, entry cost)
function bonusTip({ title, kicker, marker, data, attack = true, single = [], notes = [] }) {
  const ranged = selectedUnit ? (selectedUnit.range || 1) > 1 : null;
  const val = (v, fmt) => (v ? `<span class="tt3-v ${v > 0 ? 'up' : 'down'}">${fmt ? fmt(v) : (v > 0 ? '+' : '−') + Math.abs(v)}</span>` : '<span class="tt3-v zero">·</span>');
  const pair = (label, key) => {
    const c = data[key + '_cac'] || 0, t = data[key + '_tir'] || 0;
    return c || t ? `<div class="tt3-row"><span class="tt3-l">${label}</span>${val(c)}${val(t)}</div>` : '';
  };
  const one = ([label, v, fmt, plain]) => (v || plain ? `<div class="tt3-row one"><span class="tt3-l">${label}</span>${plain ? `<span class="tt3-v plain">${plain}</span>` : val(v, fmt)}</div>` : '');
  const section = (name, rows) => { const body = rows.join(''); return body ? `<div class="tt3-sec"><div class="tt3-h">${name}</div>${body}</div>` : ''; };
  const att = attack ? section('En attaque', [pair('Attaque', 'attack'), pair('Puissance', 'puissance'), pair('Intimidation', 'intimidation'), pair('Précision', 'precision')]) : '';
  const def = section('En défense', [pair('Défense', 'defense'), pair('Esquive', 'esquive'), pair('Courage', 'courage'), one(['Armure', data.armure || 0])]);
  const misc = section('Mouvement et par tour', single.map(one));
  let html = `<div class="tt2 tt3${ranged === true ? ' focus-tir' : ranged === false ? ' focus-cac' : ''}"><div class="tt2-head">${marker || ''}<div><span class="tt2-kicker">${kicker}</span><b>${escapeHtml(title)}</b></div></div>`;
  if (att || def) html += `<div class="tt3-cols"><span></span><span class="c-cac">Mêlée</span><span class="c-tir">Tir</span></div>`;
  html += att + def + misc;
  if (!att && !def && !misc) html += '<div class="tt2-none">Aucun modificateur</div>';
  if (selectedUnit) html += `<div class="tt3-who">Pour ${escapeHtml(selectedUnit.name)} : colonne ${ranged ? 'Tir' : 'Mêlée'}</div>`;
  for (const n of notes) if (n) html += `<div class="tt2-note">${n}</div>`;
  return html + '</div>';
}

function buildTerrainTooltip(terrainType) {
  const t = TERRAINS_DATA[terrainType];
  if (!t) return '';
  const cost = KBRules.RULES.movement.terrainCost[terrainType] ?? 1;
  const perTurn = (v) => (v > 0 ? '+' : '−') + Math.abs(v);
  return bonusTip({ title: t.name, kicker: 'Terrain', marker: `<i class="tt2-mark terrain t-${escapeHtml(terrainType)}"></i>`, data: t,
    single: [["Coût d'entrée", 0, null, `${fmtSpeed(cost)} vitesse`], ['Armure / tour', t.armure_tour, perTurn], ['Moral / tour', t.moral_tour, perTurn], ['Vitalité / tour', t.vitalite_tour, perTurn]],
    notes: [KBRules.RULES.concealment && KBRules.RULES.concealment.terrains.includes(terrainType) ? 'Couvert : les unités qui s\'y trouvent sont cachées tant qu\'on ne les approche pas.' : ''] });
}

function buildSegmentTooltip(segType) {
  const s = SEGMENT_DEFS_CLIENT[segType];
  if (!s) return '';
  const cell1 = (v) => { if (!v) return ''; const cls = v > 0 ? 'tt-pos' : 'tt-neg'; return `<span class="${cls}">${v > 0?'+':''}${v}</span>`; };
  let html = `<div class="tt-title">${s.name}</div>`;
  html += ttGrid([
    ['Attaque',   s.attack_cac,   s.attack_tir],
    ['Défense',   s.defense_cac,  s.defense_tir],
    ['Puissance', s.puissance_cac,s.puissance_tir],
  ], selectedUnit?.range > 1);
  if (s.infranchissable)           html += `<div class="tt-extra"><span class="tt-neg">Infranchissable</span></div>`;
  if (s.infranchissable_cavalerie) html += `<div class="tt-extra"><span class="tt-neg">Cavalerie bloquée</span></div>`;
  if (s.vitesse_fixe != null)      html += `<div class="tt-extra"><span class="tt-neg">Coûte ${s.vitesse_fixe} vitesse</span></div>`;
  else if (s.vitesse !== 0)        html += `<div class="tt-extra">${cell1(s.vitesse)} Vitesse</div>`;
  if (s.special) html += `<div class="tt-extra" style="color:#c8a040;font-style:italic">${s.special}</div>`;
  return html;
}

function distPointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function getNearestSegment(worldX, worldY) {
  const threshold = HEX_SIZE * 0.25;
  let best = null, bestDist = threshold;
  for (const [edgeKey, segType] of Object.entries(segmentData)) {
    const parts = edgeKey.split('|');
    const [q1, r1] = parts[0].split(',').map(Number);
    const [q2, r2] = parts[1].split(',').map(Number);
    const dq = q2 - q1, dr = r2 - r1;
    const dirIdx = SEGMENT_EDGE_DIRS.findIndex(([d0, d1]) => d0 === dq && d1 === dr);
    if (dirIdx === -1) continue;
    const { x: cx, y: cy } = hexToPixel(q1, r1);
    const corners = hexCorners(cx, cy);
    const c1 = corners[dirIdx], c2 = corners[(dirIdx + 1) % 6];
    const d = distPointToSegment(worldX, worldY, c1.x, c1.y, c2.x, c2.y);
    if (d < bestDist) { bestDist = d; best = segType; }
  }
  return best;
}

function showTerrainTooltip(content, e) {
  const tt = document.getElementById('terrain-tooltip');
  if (!tt) return;
  tt.innerHTML = content;
  tt.style.display = 'block';
  const x = e.clientX + 14, y = e.clientY - 8;
  tt.style.left = Math.min(x, window.innerWidth - tt.offsetWidth - 8) + 'px';
  tt.style.top = Math.max(8, Math.min(y, window.innerHeight - tt.offsetHeight - 8)) + 'px';
}

function hideTerrainTooltip() {
  const tt = document.getElementById('terrain-tooltip');
  if (tt) tt.style.display = 'none';
}

function buildStanceTooltip(stanceId) {
  const st = STANCES_DATA[stanceId];
  if (!st) return '';
  const sty = window.stanceStyle ? window.stanceStyle(stanceId) : null;
  const marker = sty ? `<i class="tt2-mark" style="background:${sty.c}">${sty.svg || ''}</i>` : '';
  const react = window.stanceReactionText ? window.stanceReactionText(stanceId) : '';
  const perTurn = (v) => (v > 0 ? '+' : '−') + Math.abs(v);
  return bonusTip({ title: STANCE_FULL_NAMES[stanceId] || stanceNames[stanceId] || stanceId, kicker: 'Posture', marker, data: st,
    single: [['Vitesse', st.vitesse], ['Armure / tour', st.armure_tour, perTurn], ['Moral / tour', st.moral_tour, perTurn], ['Vitalité / tour', st.vitalite_tour, perTurn]],
    notes: [react ? `Si attaquée : <b>${escapeHtml(react)}</b>` : '', window.stanceAngleText ? escapeHtml(window.stanceAngleText(stanceId) || '') : ''] });
}

function showStanceTooltip(e, stanceId) {
  const tt = document.getElementById('stance-tooltip');
  if (!tt) return;
  tt.innerHTML = buildStanceTooltip(stanceId);
  tt.style.display = 'block';
  positionStanceTooltip(e);
}

function positionStanceTooltip(e) {
  const tt = document.getElementById('stance-tooltip');
  if (!tt || tt.style.display === 'none') return;
  const x = e.clientX + 12, y = e.clientY - 8;
  const maxX = window.innerWidth - tt.offsetWidth - 8;
  const maxY = window.innerHeight - tt.offsetHeight - 8;
  tt.style.left = Math.min(x, maxX) + 'px';
  tt.style.top = Math.max(8, Math.min(y, maxY)) + 'px';
}

function hideStanceTooltip() {
  const tt = document.getElementById('stance-tooltip');
  if (tt) tt.style.display = 'none';
}

function changeStance(unitId, stanceId) {
  if (!roomCode) return;
  const overlay = document.getElementById('overlay-stance');
  if (!overlay) { wsSend('change_stance', { roomCode, unitId, stanceId }); return; }
  const unit = selectedUnit || gameState?.units?.find(u => u.id === unitId);
  document.getElementById('stance-unit-name').textContent = unit?.name || '';
  document.getElementById('stance-from').textContent = stanceNames[unit?.stance] || unit?.stance || '?';
  document.getElementById('stance-to').textContent = stanceNames[stanceId] || stanceId;
  overlay.dataset.unitId = unitId;
  overlay.dataset.stanceId = stanceId;
  overlay.style.display = 'flex';
}

function confirmStanceChange() {
  const overlay = document.getElementById('overlay-stance');
  if (!overlay) return;
  const { unitId, stanceId } = overlay.dataset;
  overlay.style.display = 'none';
  wsSend('change_stance', { roomCode, unitId, stanceId });
}

function cancelStanceChange() {
  document.getElementById('overlay-stance').style.display = 'none';
}

// ---- GENERAL ABILITY BANNER: a wide band across the screen with the general's portrait, the ability and its effects ----
function showAbilityBanner(log) {
  const player = gameState?.players?.find(p => p.id === log.playerId);
  const gid = log.generalId || player?.generalId;
  const src = gid ? img1Url(GENERAL_IMAGE1_MAP, gid, 'GENERAL IMAGE 1-1') : null;
  const color = getPlayerColor(log.playerId);
  const mine = log.playerId === myId;
  const target = log.targetPlayerId ? gameState?.players?.find(p => p.id === log.targetPlayerId) : null;
  document.getElementById('ability-banner')?.remove();
  const el = document.createElement('div');
  el.id = 'ability-banner';
  el.className = mine ? 'mine' : 'enemy';
  el.style.setProperty('--pc', color);
  const who = mine ? 'Votre général' : escapeHtml(player?.name || 'Ennemi');
  el.innerHTML = '<div class="ab-band">'
    + '<div class="ab-face">' + (src ? '<img src="' + src + '" alt="">' : '') + '</div>'
    + '<div class="ab-txt">'
    + '<span class="ab-kicker">' + who + ' · capacité' + (target ? ' contre ' + escapeHtml(target.name) : '') + '</span>'
    + '<b class="ab-name">' + escapeHtml(log.abilityUsed) + '</b>'
    + '<span class="ab-fx">' + (log.effects || []).map(escapeHtml).join(' · ') + '</span>'
    + '</div></div>';
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  setTimeout(() => { el.classList.remove('in'); el.classList.add('out'); }, 3600);
  setTimeout(() => el.remove(), 4300);
}

// ---- COMBAT RESULT ----
function showCombatResult(log) {
  if (hiddenAbility(log)) return;
  const el = document.getElementById('combat-result-box');
  if (!el) return;
  if (log.abilityUsed) {
    showAbilityBanner(log);
    return;
  }
  if (log.duel) {
    const name = (id) => (id === log.attackerId ? log.attackerName : id === log.targetId ? log.targetName : 'Unité inconnue');
    let html = `<b>Duel : ${escapeHtml(log.attackerName)} contre ${escapeHtml(log.targetName)}</b><br>`;
    log.duel.rounds.forEach((rd, i) => {
      html += `Passe ${i + 1} : ${rd.attackerRoll} contre ${rd.defenderRoll} → ${rd.attacker ? `${escapeHtml(name(rd.attacker))} frappe (${rd.dmg})` : 'parade'}<br>`;
    });
    html += log.duel.winnerId ? `<b style="color:#ffd700">${escapeHtml(name(log.duel.winnerId))} remporte le duel !</b>` : '<b>Duel indécis</b>';
    if (log.generalKilled) html += `<br><span style="color:#f84">${escapeHtml(log.eliminatedPlayer || '')} perd son général !</span>`;
    else if (log.duel.stunned) html += `<br><span style="color:#e0a060">Le vaincu est sonné, son armée vacille.</span>`;
    el.innerHTML = html;
    el.style.display = 'block';
    clearTimeout(window._combatResultTimer);
    window._combatResultTimer = setTimeout(() => { el.style.display = 'none'; }, 7000);
    return;
  }
  let html = `<b>${log.attackerName}</b> attaque <b>${log.targetName}</b><br>`;
  const bk = log.breakdown || {};
  const roll = bk.generalD20 != null ? `Force − d20 (${bk.generalD20}) + 80 = ${bk.generalAttValue}` : bk.NGOAtt != null ? `${bk.attReussite} réussites / ${bk.NGOAtt} dés` : '';
  html += `Attaque${roll ? ` : ${roll}` : ''} → ${log.hit ? '<span style="color:#4f4">TOUCHÉ</span>' : '<span style="color:#f44">RATÉ</span>'}<br>`;
  if (log.hit) {
    html += `Vitalité −<b>${log.dmgReceived}</b>${bk.ratARDef != null ? ` (armure : ${Math.round(bk.ratARDef * 100)} % passent)` : ''}<br>`;
    html += `Moral −${log.moralDmg}<br>`;
  }
  if (log.defenseChoice && log.defenseChoice !== 'rien') {
    html += `Défense (${log.defenseChoice}) : ${log.defenseSuccess ? '<span style="color:#4f4">SUCCÈS</span>' : '<span style="color:#f44">ÉCHEC</span>'}`;
    if (log.defenseSuccess && log.counterDmgReceived > 0) {
      html += ` → contre-attaque <b>${log.counterDmgReceived}</b> dégâts`;
    }
    html += '<br>';
  }
  if (log.targetKilled) html += `<span style="color:#f84">&#9876; ${log.targetName} éliminé !</span><br>`;
  if (log.attackerKilled) html += `<span style="color:#f84">&#9876; ${log.attackerName} éliminé !</span><br>`;
  el.innerHTML = html;
  el.style.display = 'block';
  clearTimeout(window._combatResultTimer);
  window._combatResultTimer = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// ---- DEFENSE POPUP ----
function showDefenseRequest(data) {
  const overlay = document.getElementById('overlay-defense');
  if (!overlay) return;
  document.getElementById('defense-attacker-name').textContent = data.attackerName;
  document.getElementById('defense-target-name').textContent = data.targetName;
  overlay.style.display = 'flex';
  overlay.dataset.attackId = data.attackId;
  overlay.dataset.roomCode = data.roomCode;
  // Ranged attack: only phalange can absorb, nobody can counter
  const btnCounter = document.getElementById('btn-defense-counter');
  const btnAbsorb = document.getElementById('btn-defense-absorb');
  if (Array.isArray(data.options)) {
    if (btnCounter) btnCounter.style.display = data.options.includes('counter') ? '' : 'none';
    if (btnAbsorb) btnAbsorb.style.display = data.options.includes('absorb') ? '' : 'none';
  } else if (data.isRanged) {
    if (btnCounter) btnCounter.style.display = 'none';
    if (btnAbsorb) btnAbsorb.style.display = data.targetTypeId === 'phalange' ? '' : 'none';
  } else {
    if (btnCounter) btnCounter.style.display = '';
    if (btnAbsorb) btnAbsorb.style.display = '';
  }
  // Countdown
  let t = data.seconds || 20;
  const countdown = document.getElementById('defense-countdown');
  if (countdown) countdown.textContent = t;
  clearInterval(window._defenseTimer);
  window._defenseTimer = setInterval(() => {
    t--;
    if (countdown) {
      countdown.textContent = t;
      countdown.style.color = t <= 5 ? '#ff4040' : t <= 10 ? '#ff9040' : '#c8960c';
    }
    if (t <= 0) {
      clearInterval(window._defenseTimer);
      sendDefenseChoice('rien');
    }
  }, 1000);
}

function sendDefenseChoice(choice) {
  clearInterval(window._defenseTimer);
  const overlay = document.getElementById('overlay-defense');
  if (!overlay) return;
  const attackId = overlay.dataset.attackId;
  const rc = overlay.dataset.roomCode;
  overlay.style.display = 'none';
  wsSend('defend_choice', { roomCode: rc, attackId, choice });
}

// ---- WEBSOCKET EVENTS ----

const disconnectToasts = {};

function renderSpectatorBar() {
  const players = gameState?.players || deployState?.players || [];
  const specs = gameState?.spectators || deployState?.spectators || [];
  let bar = document.getElementById('presence-bar');
  if (!bar) {
    bar = document.createElement('span');
    bar.id = 'presence-bar';
    bar.style.cssText = 'font-size:0.9em;color:#a89060;white-space:nowrap';
    const top = document.getElementById('top-bar');
    top.insertBefore(bar, document.getElementById('top-phase'));
  }
  const offline = players.filter(p => p.connected === false && !p.isEliminated);
  const parts = [];
  if (offline.length) parts.push(`<span style="color:#e0a030" title="Hors ligne">${offline.map(p => escapeHtml(p.name)).join(', ')} hors ligne</span>`);
  if (specs.length) parts.push(`<span title="${specs.map(s => escapeHtml(s.name)).join(', ')}">${specs.length} spectateur${specs.length > 1 ? 's' : ''}</span>`);
  bar.innerHTML = parts.join(' · ');
  const dl = gameState?.turnDeadline;
  if (dl && gameState.phase === 'battle') {
    const cur = players.find(p => p.id === gameState.currentPlayerId);
    if (cur && cur.connected === false) bar.innerHTML += ` · <span style="color:#e0a030">tour de ${escapeHtml(cur.name)} passé automatiquement s'il ne revient pas</span>`;
  }
  if (isSpectator) {
    const actions = document.getElementById('global-action-bar');
    if (actions) actions.style.display = 'none';
    const ap = document.getElementById('action-panel');
    if (ap) ap.style.display = 'none';
  }
}

function applyPresence(data) {
  for (const st of [gameState, deployState]) {
    if (!st) continue;
    st.players = (st.players || []).map(p => ({ ...p, ...(data.players.find(x => x.id === p.id) || {}) }));
    st.spectators = data.spectators;
  }
  renderSpectatorBar();
  if (gameState) renderTurnOrder(gameState.turnOrder, gameState.initiativeRolls, gameState.currentPlayerId);
}

function leaveGame() {
  wsSend('leave_room');
  KBNet.clearSession();
  setTimeout(() => { window.location.href = '/'; }, 150);
}

function enterDeployMode() {
  if (mode === 'deploy') return;
  mode = 'deploy';
  setMode('deploy');
  document.getElementById('sidebar-title').textContent = 'Déploiement';
  if (deployState.startingZone) {
    const { x, y } = hexToPixel(deployState.startingZone.q, deployState.startingZone.r);
    if (cameraPlaced) smoothPanTo(x, y, 600);
    else { camX = -x * zoom; camY = -y * zoom; }
    if (window.view3d && window.view3d.active) focusDeployZone(true);
    cameraPlaced = true;
  }
}

// Brings the deployment zone into view (2D and 3D) when it is off screen, or always with force
function focusDeployZone(force = false) {
  const z = deployState?.startingZone;
  if (!z || z.q == null) return;
  const v3 = window.view3d && window.view3d.active ? window.view3d : null;
  if (v3) {
    if (!force && v3.hexOnScreen(z.q, z.r)) return;
    v3.focusHex(z.q, z.r);
    if (v3.pingHex) v3.pingHex(z.q, z.r, '#8cff5a');
    return;
  }
  const { x, y } = hexToPixel(z.q, z.r);
  const sx = x * zoom + camX + canvas.width / 2, sy = y * zoom + camY + canvas.height / 2;
  const mx = canvas.width * 0.12, my = canvas.height * 0.12;
  if (!force && sx > mx && sx < canvas.width - mx && sy > my && sy < canvas.height - my) return;
  smoothPanTo(x, y, 600);
}

function initGame() {
  if (!initialSession) {
    window.location.href = '/';
    return;
  }
  KBNet.mountIndicator();
  let wasDown = false;
  KBNet.connect({
    onEvent: wsDispatch,
    onStatus: (st) => {
      if (st === 'reconnecting' && !wasDown) { wasDown = true; notify('Connexion perdue, reconnexion…', 'info'); }
      if (st === 'connected' && wasDown) { wasDown = false; notify('Connexion rétablie.', 'success'); }
      if (st === 'replaced') notify('Cette partie est ouverte dans un autre onglet.', 'error');
    },
  });
}

function wsDispatch(event, data) {
  if (window.KBSim && KBSim.intercept(event, data)) return;
  if (window.view3d) window.view3d.onEvent(event, data);
  if (window.gameEventHooks) for (const h of window.gameEventHooks) { try { h(event, data); } catch (e) { console.warn(e); } }
  switch (event) {
    case 'session':
      myId = data.playerId;
      roomCode = data.roomCode;
      isSpectator = data.role === 'spectator';
      break;
    case 'room_update':
      if (data.phase === 'lobby' || data.phase === 'army_building') { window.location.href = '/'; return; }
      if (data.mapId) ensureMap(data.mapId);
      break;
    case 'deployment_state': {
      if (data.mapId) ensureMap(data.mapId);
      myId = data.myId;
      gameState = null;
      deployState = data;
      buildZoneTileSet(deployState);
      enterDeployMode();
      if (data.isReady) setDeployReadyButtons('En attente des autres joueurs…', true);
      renderDeployUnitList(data.units);
      renderSpectatorBar();
      updateActionButtons();
      render();
      break;
    }
    case 'phase_change': {
      if (data.mapId) ensureMap(data.mapId);
      if (data.phase === 'battle') {
        deployState = null;
        mode = 'select';
        setMode('select');
      }
      break;
    }
    case 'unit_move_anim': {
      const { unitId, fromQ, fromR, path } = data;
      unitAnimations[unitId] = { path, fromQ, fromR, startTime: performance.now() };
      startAnimLoop();
      break;
    }
    case 'game_state': {
      if (data.mapId) ensureMap(data.mapId);
      myId = data.myId;
      isSpectator = !!data.isSpectator;
      if (data.phase !== 'deployment') { deployState = null; if (mode === 'deploy') setMode('select'); }
      if (data.balanceTables) applyBalanceTables(data.balanceTables);
      else if (gameState?.balanceTables) data.balanceTables = gameState.balanceTables;
      const editsChanged = JSON.stringify(gameState?.mapEdits || null) !== JSON.stringify(data.mapEdits || null);
      gameState = data;
      gameState.visibleHexes = new Set(data.visibleHexes);
      if (editsChanged) applyMapEdits();
      renderTopInfo();
      renderSpectatorBar();
      if (data.phase === 'ended' && data.winner !== undefined) document.getElementById('btn-end-turn-center').style.display = 'none';

      renderTopInfo();
      const currPlayer = data.players.find(p => p.id === data.currentPlayerId);
      document.getElementById('top-current-player').textContent =
        data.phase === 'deployment' ? 'Déploiement en cours' : data.currentPlayerId === myId ? 'Votre manche' : `Manche de : ${currPlayer?.name || '?'}`;
      document.getElementById('top-phase').textContent = isSpectator ? 'Spectateur' : data.phase === 'battle' ? 'Bataille' : data.phase === 'deployment' ? 'Déploiement' : data.phase === 'ended' ? 'Terminée' : '';
      if (!cameraPlaced && data.units.length) {
        const focus = data.units.find(u => u.isMine && u.isGeneral) || data.units[0];
        const { x, y } = hexToPixel(focus.q, focus.r);
        camX = -x * zoom; camY = -y * zoom;
        cameraPlaced = true;
      }
      document.getElementById('sidebar-title').textContent = isSpectator ? 'Spectateur'
        : data.currentPlayerId === myId ? 'Votre manche' : `Manche de ${currPlayer?.name || '?'}`;

      if (selectedUnit) {
        const updated = data.myUnits.find(u => u.id === selectedUnit.id);
        if (updated) {
          selectedUnit = updated;
          showUnitDetail(updated);
          renderStancePanel(updated);
          movableTiles.clear();
          attackableTiles.clear();
          rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
          if (data.currentPlayerId === myId && updated.speedRemaining > 0 && !updated.isFleeing) {
            computeMovableTiles(updated);
          }
          if (data.currentPlayerId === myId && !updated.hasAttacked && !updated.isFleeing) {
            computeAttackableTiles(updated);
          }
          if (updated.range > 1) {
            computeRangeTiles(updated);
          }
        } else { selectedUnit = null; movableTiles.clear(); attackableTiles.clear(); rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null; showUnitDetail(null); renderStancePanel(null); }
      }

      renderTurnOrder(data.turnOrder, data.initiativeRolls, data.currentPlayerId);
      renderUnitList();
      updateActionButtons();
      render();
      if (window.KBSim) KBSim.onState(data);
      if (pendingTurnPopup && pendingTurnPopup.playerId === data.currentPlayerId) {
        const ptp = pendingTurnPopup;
        pendingTurnPopup = null;
        const showPopup = () => {
          const ptpPlayer = gameState?.players.find(p => p.id === ptp.playerId);
          const ptpColor = ptpPlayer?.color || '#ffd700';
          const ptpName = ptp.playerId === myId ? 'Votre manche !' : `Manche de ${ptpPlayer?.name || '?'}`;
          const ptpSub = `Tour ${ptp.turn} · Manche ${ptp.manche || 1}`;
          if (ptp.playerId === myId) {
            const myGeneral = gameState?.units?.find(u => u.playerId === myId && u.isGeneral);
            if (myGeneral) { const { x, y } = hexToPixel(myGeneral.q, myGeneral.r); smoothPanTo(x, y); }
            const canAct = gameState?.units?.some(u => u.playerId === myId && (u.speedRemaining > 0 || !u.hasAttacked));
            if (canAct) showTurnPopup(ptpName, ptpSub, ptpColor);
          } else {
            showTurnPopup(ptpName, ptpSub, ptpColor);
          }
        };
        const initiativeOpen = document.getElementById('overlay-initiative').style.display !== 'none';
        if (ptp.newRound && initiativeOpen) {
          window._pendingTurnPopupAfterInitiative = showPopup;
        } else {
          showPopup();
        }
      }
      break;
    }
    case 'turn_change': {
      if (gameState) {
        gameState.currentPlayerId = data.currentPlayerId;
        gameState.turn = data.turn;
        if (data.timeOfDay != null) Object.assign(gameState, { timeOfDay: data.timeOfDay, isNight: data.isNight, day: data.day, turnEndsAt: data.turnEndsAt });
        renderTopInfo();
      }
      document.getElementById('overlay-confirm-end').style.display = 'none';
      selectedUnit = null;
      movableTiles.clear();
      attackableTiles.clear();
      rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
      updateActionButtons();
      pendingTurnPopup = { playerId: data.currentPlayerId, turn: data.turn, manche: data.manche, newRound: data.manche === 1 };
      break;
    }
    case 'initiative_rolled':
      showInitiativeModal(data.rolls, data.turnOrder, data.turn);
      break;
    case 'map_edit': {
      const SEG = { bridge: 'un pont', passerelle: 'une passerelle', barriere: 'une barrière', chevaux_de_frise: 'des chevaux de frise', echelle: 'une échelle', river: 'la rivière', cliff: 'la falaise' };
      let text;
      if (data.kind === 'sabotage') text = `Sabotage : ${SEG[data.from] || 'une infrastructure'} détruit${data.from === 'barriere' || data.from === 'passerelle' || data.from === 'echelle' ? 'e' : ''}.`;
      else if (data.kind === 'bruler') text = 'Une forêt part en fumée.';
      else text = `Construction : ${SEG[data.to] || data.to}.`;
      notify(text, 'info');
      break;
    }
    case 'combat_result': {
      const log = data.combatLog || data;
      addCombatLog(log);
      showCombatResult(log);
      if (!log.abilityUsed) addCombatHistory(log, gameState?.turn || 1);
      break;
    }
    case 'defense_request': {
      showDefenseRequest(data);
      if (data.targetQ != null && data.targetR != null) {
        const { x, y } = hexToPixel(data.targetQ, data.targetR);
        smoothPanTo(x, y, 700);
      }
      break;
    }
    case 'waiting_defense': {
      const el = document.getElementById('combat-result-box');
      if (el) { el.innerHTML = `En attente de la réponse du défenseur… (${data.seconds || 20} s max)`; el.style.display = 'block'; }
      break;
    }
    case 'units_fled': {
      const el = document.getElementById('combat-result-box');
      if (el && data.fled.length > 0) {
        el.innerHTML = data.fled.map(f => `&#127939; ${escapeHtml(f.unitName)} a fui !`).join('<br>');
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 4000);
      }
      break;
    }
    case 'game_over':
      showRecapWhenSettled(data);
      break;
    case 'replay_chunk':
      onReplayChunk(data);
      break;
    case 'ambush': {
      const mine = data.byPlayerId === myId;
      notify(mine ? 'Embuscade ! Une de vos unités cachées a surpris l\'ennemi.' : 'Embuscade ! Votre unité est tombée sur un ennemi caché.', mine ? 'success' : 'error');
      activePings.push({ q: data.q, r: data.r, color: '#ff4020', startTime: performance.now() });
      render();
      break;
    }
    case 'attack_preview':
      if (window.onAttackPreview) window.onAttackPreview(data);
      break;
    case 'objective_captured': {
      const who = gameState?.players.find(p => p.id === data.owner);
      notify(`${who?.name || '?'} s'empare de ${data.name}.`, data.owner === myId ? 'success' : 'info');
      if (gameState) { const o = (gameState.objectives || []).find(x => x.id === data.objectiveId); if (o) o.owner = data.owner; }
      activePings.push({ q: data.q, r: data.r, color: who?.color || '#ffd700', startTime: performance.now() });
      render();
      break;
    }
    case 'time_change':
      notify(data.isNight ? `La nuit tombe (${KBRules.formatHour(data.timeOfDay)}) : vision et vitesse réduites.` : `Le jour se lève (${KBRules.formatHour(data.timeOfDay)}).`, 'info');
      break;
    case 'duel_challenge':
      notify(`${data.attackerName} défie ${data.targetName} en duel !`, 'error');
      break;
    case 'deployment_ready_update': {
      if (!isSpectator) notify(`${data.readyCount}/${data.total} joueurs prêts…`, 'info');
      const meReady = (data.readyIds || []).includes(myId);
      if (deployState) deployState.isReady = meReady;
      setDeployReadyButtons(meReady ? `En attente… (${data.readyCount}/${data.total} prêts)` : `Prêt ! (${data.readyCount}/${data.total})`, meReady);
      break;
    }
    case 'motivate_result':
      if (data.rallied) notify(`${data.rallied} unité(s) sans général rallient votre armée.`, 'success');
      if (data.critSuccess) {
        notify(`Motivation critique ! (D20 = 1) → ${data.count} unité(s) retrouvent tout leur moral et cessent de fuir.`, 'success');
      } else if (data.critFail) {
        notify(`Motivation désastreuse (D20 = 20) : ${data.count} unité(s) perdent 20 de moral.`, 'error');
      } else if (data.success) {
        notify(`Motivation réussie ! (Charisme ${data.charisma} ≥ D20 ${data.d20}) → ${data.count} unité(s) regagnent ${data.moralGain} moral.`, 'success');
      } else {
        notify(`Motivation échouée. (Charisme ${data.charisma} < D20 ${data.d20})`, 'info');
      }
      break;
    case 'chat_history':
      document.getElementById('chat-messages').innerHTML = '';
      for (const m of data.messages || []) appendChatMessage({ ...m, isMine: m.authorId === myId });
      document.getElementById('tab-chat').classList.remove('unread');
      break;
    case 'chat_message':
      appendChatMessage({ authorName: data.authorName, text: data.text, isMine: data.authorId === myId, authorId: data.authorId, isSpectator: data.isSpectator });
      break;
    case 'ping': {
      activePings.push({ q: data.q, r: data.r, color: data.color || '#ffd700', startTime: performance.now() });
      render();
      break;
    }
    case 'presence':
      applyPresence(data);
      break;
    case 'player_disconnected':
      if (data.playerId === myId) break;
      clearTimeout(disconnectToasts[data.playerId]);
      disconnectToasts[data.playerId] = setTimeout(() => {
        notify(`${data.name || 'Un joueur'} s'est déconnecté${data.role === 'spectator' ? ' (spectateur)' : ''}.`, 'info');
      }, 4000);
      break;
    case 'player_reconnected':
      if (disconnectToasts[data.playerId]) { clearTimeout(disconnectToasts[data.playerId]); delete disconnectToasts[data.playerId]; }
      else notify(`${data.name || 'Un joueur'} est de retour.`, 'success');
      break;
    case 'player_left':
      notify(`${data.name} ${data.reason === 'abandon' ? 'a abandonné (absence prolongée)' : 'a quitté la partie'}.`, 'info');
      break;
    case 'turn_auto_ended': {
      const why = { no_actions: 'plus aucune action possible', timer: 'temps écoulé', absent: 'joueur absent' }[data.reason] || 'joueur absent';
      notify(data.playerId === myId ? `Fin de votre tour (${why}).` : `Tour de ${data.name} terminé (${why}).`, 'info');
      break;
    }
    case 'spectator_joined':
      notify(`${data.name} regarde la partie.`, 'info');
      break;
    case 'error':
      if (data.sessionLost) {
        notify('Partie introuvable ou session expirée.');
        setTimeout(() => { window.location.href = '/'; }, 1500);
        break;
      }
      if (data.code === 'not_your_turn' && data.action === 'end_turn') break;
      if (data.action === 'get_replay' && replayWindow) { if (!replayWindow.closed) replayWindow.close(); replayWindow = null; }
      notify(data.message || String(data));
      break;
  }
}

// ---- 3D VIEW BRIDGE ----
window.gameBridge = {
  get state() { return gameState; },
  get displayHour() { return displayHour(); },
  get roomCode() { return roomCode; },
  frameHexes2D,
  setHourOverride(h) { hourOverride = h; renderTopInfo(); if (window.view3d) window.view3d.markDirty(); },
  get clockMoving() { return clockMoving(); },
  get mapDoc() { return mapDoc; },
  get mapLoading() { return mapLoading; },
  get deployState() { return deployState; },
  deployBlockedFor(unit) { return deployBlockedFor(unit); },
  get myId() { return myId; },
  get mode() { return mode; },
  get selectedUnit() { return selectedUnit; },
  get movableTiles() { return movableTiles; },
  get abilityTiles() { return abilityTiles; },
  get unitTypes() { return UNIT_TYPES; },
  get mapEdits() { return gameState ? gameState.mapEdits || null : null; },
  get attackableTiles() { return attackableTiles; },
  approachAt,
  // Approach + strike preview against target: { q, r, path: [[q, r]...] (origin included) } or null
  approachTo(unit, target) {
    if (!unit || !target) return null;
    if (window.KBSim && KBSim.active()) return KBSim.approachTo(unit, target);
    return approachAt(`${target.q},${target.r}`);
  },
  get rangeTiles() { return rangeTiles; },
  get rangeCenter() { return rangeCenter; },
  get motivateTiles() { return motivateTiles; },
  get motivateCenter() { return motivateCenter; },
  get rangePreview() { return rangePreview(); },
  get showTerrain() { return showTerrain; },
  get terrainData() { return terrainData; },
  get pingMode() { return pingMode; },
  unitAnimations,
  ANIM_STEP_MS,
  stanceIcons,
  unitTokenImages,
  generalTokenImages,
  getGeneralIdForUnit,
  getPlayerColor,
  hexFacingClient,
  setHoveredHex(h) { hoveredHex = h; },
  click(hex, opts = {}) {
    if (!hex) return;
    if (pingMode) { if (roomCode) wsSend('ping', { roomCode, q: hex.q, r: hex.r }); return; }
    handleHexClick(hex, opts);
  },
  doubleClick(hex) {
    const units = gameState?.units || deployState?.units || [];
    const unit = units.find(u => u.q === hex.q && u.r === hex.r);
    if (unit) showUnitCard(unit);
  },
  contextMenu() { this.deselect(); },
  facingToward(unit, hex) { return facingToward(unit, hex); },
  // hex where a right-drag starts orienting the selected unit: the unit itself, or (simultaneous) the end of its path
  orientAnchor(unit, hex) {
    if (!unit || !hex) return null;
    if (window.KBSim && KBSim.active()) return KBSim.orientAnchor(unit, hex);
    return hex.q === unit.q && hex.r === unit.r ? { q: unit.q, r: unit.r } : null;
  },
  // the selected unit can receive a facing now (simultaneous planning, or my turn with speed left)
  canOrient(unit) {
    if (!unit || !unit.isMine || unit.q == null || unit.isFleeing || mode === 'deploy') return false;
    if (window.KBSim && KBSim.active()) return !!(KBSim.planning && KBSim.planning() && KBSim.planning().canPlan);
    return gameState?.phase === 'battle' && gameState.currentPlayerId === myId && (unit.speedRemaining || 0) > 0;
  },
  hover(hex, e) {
    hoveredHex = hex;
    if (showTerrain && hex && e) showTerrainTooltip(buildTerrainTooltip(terrainData[`${hex.q},${hex.r}`] || 'plain'), e);
    else hideTerrainTooltip();
  },
  redraw2D() { resizeCanvas(); },
  panToHex(q, r) { const p = hexToPixel(q, r); smoothPanTo(p.x, p.y); },
  // Viewport pixels of a hex centre in the active view (2D canvas or 3D)
  hexScreen(q, r) {
    if (window.view3d && window.view3d.active && window.view3d.hexScreen) return window.view3d.hexScreen(q, r);
    const p = hexToPixel(q, r);
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + canvas.width / 2 + camX + p.x * zoom, y = rect.top + canvas.height / 2 + camY + p.y * zoom;
    return { x, y, visible: x > rect.left - 40 && x < rect.right + 40 && y > rect.top - 40 && y < rect.bottom + 40 };
  },
  setUnitFacing(unit, f) { setUnitFacing(unit, f); },
  setUnitStance(unit, s) { setUnitStance(unit, s); },
  setStanceAt(unit, n) { if (window.KBSim && KBSim.setStanceAt) KBSim.setStanceAt(unit, n); },
  stanceSteps(unit) { return window.KBSim && KBSim.active() && KBSim.stanceSteps ? KBSim.stanceSteps(unit) : null; },
  simOrderOf(unit) { return window.KBSim && KBSim.orderOf ? KBSim.orderOf(unit) : null; },
  orientCosts() { const S = KBRules.RULES.simultaneous || {}; return { facing: S.facingCost ?? 1, stance: S.stanceCost ?? 2 }; },
  stanceChoices() { return stanceList.map((id) => { const st = stanceStyle(id); return { id, svg: st.svg, color: st.c, name: st.name }; }); },
  stanceIconSvg(id, size, color) { return stanceIconSvg(id, size, color); },
  hexOnScreen2D(q, r, margin = 0.12) {
    const p = hexToPixel(q, r);
    const sx = canvas.width / 2 + camX + p.x * zoom, sy = canvas.height / 2 + camY + p.y * zoom;
    const mx = canvas.width * margin, my = canvas.height * margin;
    return sx >= mx && sx <= canvas.width - mx && sy >= my && sy <= canvas.height - my;
  },
  // Path preview through the waypoints: { path (origin included), costs (cumulative), cost } or null
  pathTo(unit, tq, tr) {
    const k = typeof tq === 'string' ? tq : hexNode(unit, { q: tq, r: tr });
    if (window.KBSim && KBSim.active()) return KBSim.pathTo(unit, k);
    if (!unit || unit.q == null) return null;
    if (!movableTiles.has(k)) return null;
    return extendRoute(seqRoute(unit), k);
  },
  hexNode(unit, hex) { return hexNode(unit, hex); },
  // March over several turns to a hex beyond this turn's reach: { path (origin included), turnEnds, turns, ... } or null
  get combatHistory() { return combatHistoryEntries; },
  marchPlan(unit, tq, tr) { return marchPlanFor(unit, tq, tr); },
  get pendingMarch() { return pendingMarch; },
  cancelMarch(unitId) { wsSend('cancel_march', { roomCode, unitId }); },
  get routeWaypoints() { return window.KBSim && KBSim.active() ? KBSim.routeWaypoints() : routeWaypoints(selectedUnit); },
  get routeInfo() { return routeInfo(); },
  toggleRouteTool() {
    route.tool = !route.tool;
    if (selectedUnit) route.unitId = route.unitId || selectedUnit.id;
    if (window.KBSim && KBSim.active()) KBSim.refresh(); else render();
  },
  undoWaypoint() { undoRouteStep(); },
  // Simultaneous mode (public/js/simultaneous.js): planning, my planned orders, playback of the resolution
  get simultaneous() { return !!(window.KBSim && KBSim.isSim()); },
  get planning() { return window.KBSim ? KBSim.planning() : null; },
  get plannedOrders() { return window.KBSim ? KBSim.plannedOrders() : []; },
  get playback() { return window.KBSim ? KBSim.playbackInfo() : null; },
  segmentAt(q1, r1, q2, r2) {
    const t = segmentData[segmentEdgeKey(q1, r1, q2, r2)];
    return t || null;
  },
  segmentTooltip(segType, e) { showTerrainTooltip(buildSegmentTooltip(segType), e); },
  deselect() {
    if (window.KBSim && KBSim.active()) { KBSim.select(null); render(); return; }
    if (mode === 'deploy' || !selectedUnit) return;
    selectedUnit = null;
    movableTiles.clear(); attackableTiles.clear();
    rangeTiles.clear(); rangeCenter = null; motivateTiles.clear(); motivateCenter = null;
    updateActionButtons();
    showUnitDetail(null);
    render();
  },
};

// Init
resizeCanvas();
initGame();
