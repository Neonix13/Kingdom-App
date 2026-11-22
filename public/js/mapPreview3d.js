// 3D preview of the selected map in the room settings: the whole map seen from above, slowly turning; drag to rotate, wheel to zoom.
import { createWorld } from './map3d/world.js';

export function createMapPreview3d(container) {
  let cur = null, wantedId = null, token = 0, active = true, idleTimer = null;

  const destroy = (w) => {
    try { w.world.setRunning(false); w.world.renderer.dispose(); w.world.renderer.forceContextLoss(); } catch {}
    w.canvas.remove();
  };

  const frame = (world) => {
    const { camera, controls, bounds } = world;
    const { bx0, bx1, bz0, bz1, BCX, BCZ } = bounds;
    const size = Math.max(bx1 - bx0, bz1 - bz0);
    world.setGrid(0);
    controls.enableDamping = true;
    controls.minDistance = size * 0.25;
    controls.maxDistance = size * 1.4;
    controls.target.set(BCX, 0, BCZ);
    camera.position.set(BCX + size * 0.62, size * 0.78, BCZ + size * 0.62);
    camera.lookAt(controls.target);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    controls.addEventListener('start', () => { controls.autoRotate = false; clearTimeout(idleTimer); });
    controls.addEventListener('end', () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => { controls.autoRotate = true; }, 6000); });
  };

  async function show(mapId) {
    if (!mapId || mapId === wantedId) return;
    wantedId = mapId;
    const my = ++token;
    container.classList.add('loading');
    const canvas = document.createElement('canvas');
    canvas.className = 'ld-map-3d-canvas';
    container.appendChild(canvas);
    let world;
    try {
      world = await createWorld({ canvas, container, mapId, intro: false, hour: 15.5, quality: 2 });
    } catch (e) {
      console.warn('[salle] aperçu 3D indisponible', e);
      canvas.remove();
      if (my === token) container.classList.remove('loading');
      return;
    }
    if (my !== token) { destroy({ world, canvas }); return; }
    frame(world);
    world.start();
    world.setRunning(active && !document.hidden);
    if (cur) destroy(cur);
    cur = { world, canvas };
    canvas.classList.add('shown');
    container.classList.remove('loading');
    container.classList.add('ready');
  }

  new ResizeObserver(() => { if (cur) cur.world.resize(); }).observe(container);
  document.addEventListener('visibilitychange', () => { if (cur) cur.world.setRunning(active && !document.hidden); });

  return {
    show,
    setActive(on) { active = !!on; if (cur) cur.world.setRunning(active && !document.hidden); },
  };
}
