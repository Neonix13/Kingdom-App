import * as THREE from 'three';

// Slow-motion shot when a unit is destroyed: a second camera cuts to a low angle near the victim, time runs ×4 slower
// for a short moment, then the view cuts back to the orbit camera exactly where it was.
const CSS = `
.kc-bar { position:fixed; left:0; right:0; height:0; background:#000; z-index:45; pointer-events:none; transition:height .18s ease; }
.kc-bar.top { top:0; } .kc-bar.bot { bottom:0; }
body.kb-killcam .kc-bar { height:7vh; }
body.kb-killcam #view3d-plates, body.kb-killcam .v3-float, body.kb-killcam #v3-tip { visibility:hidden; }
`;

export function createKillCam(world, { enabled = () => true, blocked = () => false } = {}) {
  const T = THREE;
  const cam = new T.PerspectiveCamera(34, world.camera.aspect, 0.05, world.camera.far);
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const bars = ['top', 'bot'].map((c) => { const d = document.createElement('div'); d.className = 'kc-bar ' + c; document.body.appendChild(d); return d; });

  const DUR = 5.5;        // real seconds
  const SLOW = 0.08;      // ×12.5
  const COOLDOWN = 9000;  // ms between two shots
  let shot = null, last = -Infinity, pending = null;
  const look = new T.Vector3(), tmp = new T.Vector3();

  function place(victim, from) {
    const guard = world.camGuard;
    const base = new T.Vector3().subVectors(victim, from || victim.clone().add(new T.Vector3(1, 0, 0)));
    base.y = 0;
    if (base.lengthSq() < 1e-6) base.set(1, 0, 0);
    base.normalize();
    // beside the attack line, low, slightly behind the victim: both sides of the clash stay in frame
    const tries = [70, -70, 110, -110, 40, -40, 150, -150, 0, 180];
    const target = victim.clone().setY(victim.y + 0.3);
    for (const dist of [2.8, 2.1]) {
      for (const deg of tries) {
        const a = (deg * Math.PI) / 180;
        const dx = base.x * Math.cos(a) - base.z * Math.sin(a), dz = base.x * Math.sin(a) + base.z * Math.cos(a);
        const p = new T.Vector3(victim.x + dx * dist, 0, victim.z + dz * dist);
        p.y = Math.max(world.walkHeight(p.x, p.z), guard ? guard.surface(p.x, p.z) : -Infinity) + 0.75;
        p.y = Math.max(p.y, victim.y + 0.6);
        if (!guard || guard.blocked(p, target, 0.05) == null) return { pos: p, side: new T.Vector3(-dz, 0, dx) };
      }
    }
    return null;
  }

  function begin(victim, from) {
    const where = place(victim, from);
    if (!where) return;
    shot = { t0: performance.now(), pos: where.pos, side: where.side, victim: victim.clone(), from: from ? from.clone() : null };
    last = shot.t0;
    cam.aspect = world.camera.aspect;
    cam.updateProjectionMatrix();
    world.setViewCamera(cam);
    world.controls.enabled = false;
    document.body.classList.add('kb-killcam');
    world.dof.setBoost(1);
    world.dof.setFocus(shot.victim);
    update();
  }

  function end() {
    if (!shot) return;
    shot = null;
    world.setTimeScale(1);
    world.setViewCamera(null);
    world.controls.enabled = true;
    document.body.classList.remove('kb-killcam');
    world.dof.setBoost(0);
    world.dof.setFocus(null);
  }

  function update() {
    if (pending && performance.now() >= pending.at) {
      const p = pending;
      pending = null;
      if (!shot && enabled() && !blocked() && world.usePost) begin(p.victim, p.from);
    }
    if (!shot) return;
    const k = (performance.now() - shot.t0) / 1000 / DUR;
    if (k >= 1) { end(); return; }
    // ease into slow motion and back out at the very end
    const ease = Math.min(1, k / 0.08) * Math.min(1, (1 - k) / 0.1);
    world.setTimeScale(1 + (SLOW - 1) * Math.max(0, ease));
    // slow lateral dolly with a slight push in
    const p = tmp.copy(shot.pos).addScaledVector(shot.side, 0.55 * (k - 0.5));
    p.lerp(shot.victim, 0.12 * k);
    p.y = Math.max(p.y, (world.camGuard ? world.camGuard.surface(p.x, p.z) : -Infinity) + 0.4);
    cam.position.copy(p);
    look.copy(shot.victim).setY(shot.victim.y + 0.3);
    if (shot.from) look.lerp(shot.from, 0.18);
    cam.lookAt(look);
    if (cam.aspect !== world.camera.aspect) { cam.aspect = world.camera.aspect; cam.updateProjectionMatrix(); }
  }

  const cancel = () => { pending = null; end(); };
  window.addEventListener('keydown', (e) => { if (shot && e.key === 'Escape') cancel(); });
  world.canvas.addEventListener('pointerdown', () => { if (shot) cancel(); });
  world.frameHooks.push(() => update());

  return {
    get active() { return !!shot; },
    get busy() { return !!shot || !!pending; },
    // victim / attacker: world positions; delay: real seconds before the cut (lets the blows land in slow motion)
    trigger(victim, from, { delay = 0 } = {}) {
      const now = performance.now();
      if (shot || pending || now - last < COOLDOWN || !enabled() || blocked() || !world.usePost) return false;
      // anchors float above the formations: work at ground level
      const ground = (v) => v && new THREE.Vector3(v.x, world.walkHeight(v.x, v.z), v.z);
      pending = { at: now + delay * 1000, victim: ground(victim), from: ground(from) };
      return true;
    },
    cancel,
  };
}
