// Map changes made during the battle (espions, bâtisseurs) drawn over the static 3D map:
// small wooden props for what was built, debris for what was destroyed, ash for burnt forests.
export function createMapEditsLayer(world) {
  const { THREE, scene, hexToWorld, groundHeight } = world;
  const group = new THREE.Group();
  group.name = 'map-edits';
  scene.add(group);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e4a2a, roughness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 1 });
  const ash = new THREE.MeshStandardMaterial({ color: 0x1b1916, roughness: 1, transparent: true, opacity: 0.85 });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const post = new THREE.CylinderGeometry(0.035, 0.04, 1, 6);
  const disk = new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2);
  const INFRA = new Set(['bridge', 'passerelle', 'barriere', 'chevaux_de_frise', 'echelle']);
  let lastSig = '';

  const center = (k) => { const [q, r] = k.split(',').map(Number); return hexToWorld(q, r); };

  function add(geo, mat, x, y, z, sx, sy, sz, ry = 0, rz = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.set(0, ry, rz);
    m.castShadow = true;
    group.add(m);
    return m;
  }

  // Along an edge: origin at its middle, u = along the edge, v = across it (from hex a to hex b)
  function edgeFrame(key) {
    const [ka, kb] = key.split('|');
    const a = center(ka), b = center(kb);
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const vx = b.x - a.x, vz = b.z - a.z, d = Math.hypot(vx, vz) || 1;
    return { mx, mz, y: groundHeight(mx, mz), vx: vx / d, vz: vz / d, ux: -vz / d, uz: vx / d, len: d / Math.sqrt(3), d };
  }

  function debris(x, z, spread, seed) {
    let s = seed;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < 7; i++) {
      const px = x + (rnd() - 0.5) * spread, pz = z + (rnd() - 0.5) * spread;
      add(box, i % 2 ? dark : wood, px, groundHeight(px, pz) + 0.03, pz, 0.06 + rnd() * 0.12, 0.03, 0.03 + rnd() * 0.05, rnd() * Math.PI, (rnd() - 0.5) * 0.6);
    }
  }

  function buildEdge(key, type) {
    const f = edgeFrame(key);
    const yaw = Math.atan2(f.ux, f.uz);
    if (type === 'barriere') {
      for (let i = 0; i < 5; i++) {
        const t = (i / 4 - 0.5) * f.len * 0.9;
        const x = f.mx + f.ux * t, z = f.mz + f.uz * t;
        add(post, wood, x, groundHeight(x, z) + 0.15, z, 1, 0.3, 1);
      }
      for (const h of [0.12, 0.24]) add(box, wood, f.mx, f.y + h, f.mz, 0.03, 0.03, f.len * 0.95, yaw);
    } else if (type === 'chevaux_de_frise') {
      for (let i = 0; i < 3; i++) {
        const t = (i / 2 - 0.5) * f.len * 0.7;
        const x = f.mx + f.ux * t, z = f.mz + f.uz * t, y = groundHeight(x, z) + 0.12;
        add(box, wood, x, y, z, 0.03, 0.03, f.len * 0.32, yaw);
        for (const s of [1, -1]) {
          const m = add(box, wood, x, y, z, 0.025, 0.36, 0.025, yaw);
          m.rotation.set(s * 0.75 * f.vz, yaw, s * 0.75 * f.vx, 'YXZ');
        }
      }
    } else if (type === 'echelle') {
      for (const s of [-1, 1]) {
        const x = f.mx + f.ux * s * 0.09, z = f.mz + f.uz * s * 0.09;
        const m = add(box, wood, x, groundHeight(x, z) + 0.35, z, 0.03, 0.75, 0.03, yaw);
        m.rotation.set(0.35 * -f.vz, yaw, 0.35 * f.vx, 'YXZ');
      }
      for (let i = 0; i < 5; i++) add(box, wood, f.mx, f.y + 0.08 + i * 0.13, f.mz, 0.02, 0.02, 0.2, yaw);
    } else if (type === 'bridge') {
      const deck = add(box, wood, f.mx, f.y + 0.1, f.mz, 0.04, 0.05, f.d * 0.55, Math.atan2(f.vx, f.vz));
      deck.scale.set(f.len * 0.55, 0.05, f.d * 0.6);
    }
  }

  function update(edits, baseSegments, baseTerrain) {
    const sig = JSON.stringify(edits || null);
    if (sig === lastSig) return;
    lastSig = sig;
    for (const c of [...group.children]) group.remove(c);
    if (!edits) return;
    let seed = 1;
    for (const [key, to] of Object.entries(edits.seg || {})) {
      const before = (baseSegments || {})[key] || null;
      if (to && INFRA.has(to) && to !== before) buildEdge(key, to);
      else if (before && INFRA.has(before) && to !== before) { const f = edgeFrame(key); debris(f.mx, f.mz, f.len * 0.8, seed++ * 97); }
    }
    for (const [key, to] of Object.entries(edits.ter || {})) {
      const c = center(key), before = (baseTerrain || {})[key] || 'plain';
      if (before === 'forest' && to === 'plain') add(disk, ash, c.x, groundHeight(c.x, c.z) + 0.02, c.z, 0.5, 1, 0.5);
      else if (to === 'bridge') add(box, wood, c.x, groundHeight(c.x, c.z) + 0.12, c.z, 0.55, 0.05, 0.4);
      else if (before === 'bridge') debris(c.x, c.z, 0.6, seed++ * 131);
    }
  }

  // Burnt forests lose their trees: these hexes are added to the vegetation clearing mask
  function clearedHexes(edits, baseTerrain) {
    const out = [];
    for (const [key, to] of Object.entries((edits && edits.ter) || {})) if ((baseTerrain || {})[key] === 'forest' && to !== 'forest') out.push(key);
    return out;
  }

  return { update, clearedHexes, group };
}
