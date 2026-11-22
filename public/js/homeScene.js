// Animated 3D backdrop of the home screen: the Kankoku gate at golden hour, a coalition army marching on the plain,
// Qin defenders behind the wall, slow cinematic camera drift. Purely decorative: never blocks the menus.
import { createWorld } from './map3d/world.js';
import { createUnitLayer } from './map3d/units3d.js';

const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const MAXV = { soldats: 200, lancier: 200, phalange: 200, archer: 240, cavalier_lourd: 130, cavalier_leger: 200, char: 100, general: 300 };
const CAT = { soldats: 'Infanterie', lancier: 'Infanterie', phalange: 'Infanterie', archer: 'Tireurs', cavalier_lourd: 'Chevaux', cavalier_leger: 'Chevaux', char: 'Chars', general: 'Général' };
const PLAYERS = { qin: { color: '#c8321e', emblem: '秦' }, coa: { color: '#2a62c9', emblem: '趙' }, wei: { color: '#7d3cc0', emblem: '魏' } };

export async function mountHomeScene({ canvas, container, reducedMotion = false, small = false } = {}) {
  const world = await createWorld({
    canvas, container, mapId: 'kankoku', intro: false, hour: 16.9, quality: small ? 4 : 2,
  });
  const { THREE, camera, controls, hexToWorld, groundHeight, allHexes } = world;
  world.setGrid(0);
  controls.enabled = false;
  controls.enableDamping = false;

  const key = (q, r) => `${q},${r}`;
  const isLand = (q, r) => {
    const h = allHexes.get(key(q, r));
    return h && !['river', 'building', 'bridge', 'forest'].includes(h.terrain) && !(world.isWaterHex && world.isWaterHex(h));
  };
  const facingTo = (dx, dz) => {
    const ang = Math.atan2(dx, dz);
    let best = 0, bd = Infinity;
    HEX_DIRS.forEach(([dq, dr], i) => {
      const o = hexToWorld(0, 0), p = hexToWorld(dq, dr);
      let d = Math.abs(Math.atan2(p.x - o.x, p.z - o.z) - ang);
      d = Math.min(d, Math.PI * 2 - d);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  };

  // Gate (map objective "porte") and the plain in front of it (east, toward the coalition camp)
  const map = world.map || {};
  const gateObj = (map.objectives || []).find((o) => o.id === 'porte') || { q: 24, r: 8 };
  const gate = hexToWorld(gateObj.q, gateObj.r + 0.5);
  const gateY = groundHeight(gate.x, gate.z);

  const used = new Set();
  const spotNear = (q0, r0) => {
    const seen = new Set([key(q0, r0)]), queue = [[q0, r0]];
    while (queue.length) {
      const [q, r] = queue.shift();
      if (isLand(q, r) && !used.has(key(q, r))) { used.add(key(q, r)); return [q, r]; }
      for (const [dq, dr] of HEX_DIRS) {
        const k = key(q + dq, r + dr);
        if (!seen.has(k) && allHexes.has(k) && seen.size < 400) { seen.add(k); queue.push([q + dq, r + dr]); }
      }
    }
    return null;
  };
  let nextId = 1;
  const units = [];
  const mk = (playerId, typeId, q, r, facing, stance) => {
    const s = spotNear(q, r);
    if (!s) return null;
    const mv = MAXV[typeId];
    const u = { id: 'h' + nextId++, playerId, typeId, name: typeId, category: CAT[typeId], isGeneral: typeId === 'general', generalId: null,
      q: s[0], r: s[1], facing, vitality: mv, maxVitality: mv, morale: 100, maxMorale: 100, isFleeing: false, hasMoved: false, isMine: false, stance };
    units.push(u);
    return u;
  };
  const west = facingTo(-1, 0), east = facingTo(1, 0);
  // Qin: behind the gate and on the walls' inner side
  for (const [t, dq, dr] of [['general', -4, 0], ['phalange', -2, 0], ['lancier', -2, 1], ['archer', -3, -1], ['soldats', -3, 2], ['archer', -2, -2]]) {
    mk('qin', t, gateObj.q + dq, gateObj.r + dr, east, t === 'archer' ? 'defense_distance' : 'defense_combat');
  }
  // Coalition: columns marching from the east toward the gate
  const marchers = [];
  const coa = [['general', 8, 1, 'coa'], ['soldats', 5, -1, 'coa'], ['lancier', 5, 2, 'coa'], ['phalange', 6, 0, 'coa'], ['cavalier_lourd', 8, -3, 'coa'],
    ['archer', 7, 3, 'coa'], ['cavalier_leger', 9, 5, 'wei'], ['soldats', 7, 5, 'wei'], ['lancier', 9, -1, 'wei'], ['char', 10, 2, 'coa']];
  for (const [t, dq, dr, p] of coa) {
    const u = mk(p, t, gateObj.q + dq, gateObj.r + dr, west, 'marche');
    if (!u) continue;
    const start = hexToWorld(u.q + 7, u.r - 3);
    const end = hexToWorld(u.q, u.r);
    marchers.push({ u, start, end, delay: Math.random() * 4 });
  }
  const layer = createUnitLayer(world, { getPlayerColor: (id) => PLAYERS[id]?.color, getPlayerEmblem: (id) => PLAYERS[id]?.emblem });
  layer.sync(units);

  // Cinematic drift: slow orbit in front of the gate, from the plain, with a gentle breathing dolly
  const target = new THREE.Vector3(gate.x + 4, gateY + 2.6, gate.z);
  const R = small ? 34 : 30;
  let t = reducedMotion ? 30 : 0;
  const place = (time) => {
    const th = 0.38 * Math.sin(time * 0.018) + 0.18;
    const rr = R + 3 * Math.sin(time * 0.031);
    const y = gateY + 6.2 + 1.2 * Math.sin(time * 0.023);
    camera.position.set(target.x + Math.cos(th) * rr, y, target.z + Math.sin(th) * rr);
    controls.target.copy(target);
    camera.lookAt(target);
  };
  place(t);

  const MARCH = 55;
  const marchAt = (time) => {
    for (const m of marchers) {
      const k = Math.max(0, Math.min(1, (time - m.delay) / MARCH));
      const x = m.start.x + (m.end.x - m.start.x) * k, z = m.start.z + (m.end.z - m.start.z) * k;
      if (k < 1) {
        layer.setDisplayPosition(m.u.id, x, z, Math.atan2(m.end.x - m.start.x, m.end.z - m.start.z));
        if (!m.moving) { layer.setMoving(m.u.id, true); m.moving = true; }
      } else if (m.moving) {
        layer.clearDisplayPosition(m.u.id);
        layer.setMoving(m.u.id, false);
        m.moving = false;
      }
    }
  };
  marchAt(reducedMotion ? MARCH + 10 : 0);

  world.frameHooks.push((dt) => {
    if (reducedMotion) return;
    t += dt;
    place(t);
    marchAt(t);
  });

  let active = true, visible = !document.hidden, slow = false;
  const apply = () => world.setRunning(active && visible && !slow && !reducedMotion);
  document.addEventListener('visibilitychange', () => { visible = !document.hidden; apply(); });
  world.start();
  if (reducedMotion) setTimeout(() => world.setRunning(false), 1500);
  // Too slow for a decoration: freeze on the current frame
  setTimeout(() => { if (world.perf.frame > 45) { slow = true; apply(); } }, 6000);
  window.addEventListener('resize', () => world.resize());

  return {
    world,
    setActive(on) { active = !!on; apply(); },
  };
}
