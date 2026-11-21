import * as THREE from 'three';

// Flocks of birds: boid steering (separation / alignment / cohesion + a wandering goal), flapping and gliding
// (articulated wings in the vertex shader), now and then a flock lands on a perch (wall-walks, summits, fields) and
// takes off again after a while, or at once when an army or the camera comes close.
// createBirds({ scene, G, bounds, groundHeight, perches: [{ x, y, z }], camera })
//   -> { mesh, update(dt), setThreats([{ x, z }]) }

function birdGeometry() {
  const P = [], S = [];
  const tri = (a, b, c, seg) => { P.push(...a, ...b, ...c); S.push(seg, seg, seg); };
  const quad = (a, b, c, d, seg) => { tri(a, b, c, seg); tri(a, c, d, seg); };
  // body: a slim spindle, head forward (+z), tail fan behind
  const nose = [0, 0.005, 0.17], neck = [0, 0.012, 0.11], back = [0, 0.03, 0.0], belly = [0, -0.022, 0.01];
  const l = [-0.032, 0.004, 0.03], r = [0.032, 0.004, 0.03], rump = [0, 0.004, -0.09];
  tri(nose, l, neck, 0); tri(nose, neck, r, 0); tri(nose, belly, l, 0); tri(nose, r, belly, 0);
  tri(neck, l, back, 0); tri(neck, back, r, 0);
  tri(back, l, rump, 0); tri(back, rump, r, 0); tri(belly, rump, l, 0); tri(belly, r, rump, 0);
  tri(rump, [-0.055, 0.004, -0.19], [0.055, 0.004, -0.19], 0);
  // wings: inner panel (root -> joint at |x| = 0.17), outer panel (joint -> swept tip); both sides
  for (const s of [-1, 1]) {
    const rf = [0.03 * s, 0.006, 0.06], rb = [0.03 * s, 0.006, -0.045];
    const jf = [0.17 * s, 0.006, 0.045], jb = [0.17 * s, 0.006, -0.06];
    const tf = [0.34 * s, 0.006, -0.03], tb = [0.29 * s, 0.006, -0.1];
    quad(rf, jf, jb, rb, 1);
    quad(jf, tf, tb, jb, 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aSeg', new THREE.Float32BufferAttribute(S, 1));
  g.computeVertexNormals();
  return g;
}

export function createBirds({ scene, G, bounds, groundHeight, perches = [], camera = null }) {
  const { bx0, bx1, bz0, bz1 } = bounds;
  const FLOCKS = [11, 9, 8];
  const N = FLOCKS.reduce((a, b) => a + b, 0);
  const geo = birdGeometry();
  const flapAttr = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  geo.setAttribute('aFlap', flapAttr);
  const mat = new THREE.MeshLambertMaterial({ color: 0x2a2621, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = G.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aSeg;\nattribute vec3 aFlap;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float side = position.x < 0.0 ? -1.0 : 1.0;
          float d = abs( position.x );
          float amt = aFlap.y;
          float flap = sin( uTime * aFlap.z + aFlap.x );
          if ( amt < 0.0 ) {
            // perched: wings folded along the body
            if ( aSeg > 0.5 ) { transformed.x = side * ( 0.03 + ( d - 0.03 ) * 0.12 ); transformed.y += 0.012; transformed.z -= ( d - 0.03 ) * 0.35; }
          } else {
            float th1 = mix( 0.14, flap * 0.85, amt );
            float th2 = th1 + mix( 0.06, flap * 0.5 + 0.1, amt );
            if ( aSeg > 0.5 && aSeg < 1.5 ) {
              float rr = d - 0.03;
              transformed.x = side * ( 0.03 + rr * cos( th1 ) );
              transformed.y = position.y + rr * sin( th1 );
            } else if ( aSeg > 1.5 ) {
              float jx = 0.03 + 0.14 * cos( th1 ), jy = 0.14 * sin( th1 );
              float rr = d - 0.17;
              transformed.x = side * ( jx + rr * cos( th2 ) );
              transformed.y = position.y + jy + rr * sin( th2 );
            }
            transformed.y -= flap * 0.012 * amt;
          }
        }`);
  };
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const rnd = Math.random;
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const span = { x0: bx0 - 8, x1: bx1 + 8, z0: bz0 - 8, z1: bz1 + 8 };
  const skyY = (x, z, lo = 6, hi = 13) => groundHeight(x, z) + lo + rnd() * (hi - lo);
  const randomGoal = () => { const x = span.x0 + rnd() * (span.x1 - span.x0), z = span.z0 + rnd() * (span.z1 - span.z0); return new THREE.Vector3(x, skyY(x, z), z); };

  const flocks = [];
  const birds = [];
  FLOCKS.forEach((n, f) => {
    const goal = randomGoal();
    const flock = { mode: 'fly', goal, timer: 12 + rnd() * 20, perch: null, members: [] };
    const start = randomGoal();
    for (let i = 0; i < n; i++) {
      const b = {
        flock, pos: start.clone().add(new THREE.Vector3((rnd() - 0.5) * 4, (rnd() - 0.5) * 1.5, (rnd() - 0.5) * 4)),
        vel: new THREE.Vector3(rnd() - 0.5, 0, rnd() - 0.5).normalize().multiplyScalar(3.5),
        mode: 'fly', spot: null, flapT: rnd() * 3, gliding: false, bank: 0, yaw: 0,
        phase: rnd() * 6.28, freq: 13 + rnd() * 4, scale: 0.85 + rnd() * 0.3, idle: rnd() * 6,
      };
      flock.members.push(b);
      birds.push(b);
    }
    flocks.push(flock);
  });

  let threats = [];
  function setThreats(points) { threats = Array.isArray(points) ? points : []; }
  const threatened = (p, radius) => {
    for (const t of threats) if (Math.hypot(t.x - p.x, t.z - p.z) < radius) return true;
    if (camera && camera.position.distanceTo(p) < 4.5) return true;
    return false;
  };

  function landFlock(flock) {
    if (!perches.length) return false;
    const site = pick(perches);
    if (threatened(site, 5)) return false;
    flock.mode = 'landing';
    flock.perch = site;
    flock.timer = 14 + rnd() * 18;
    flock.members.forEach((b, i) => {
      const a = (i / flock.members.length) * Math.PI * 2 + rnd() * 0.5, rad = 0.15 + rnd() * 0.5;
      const x = site.x + Math.cos(a) * rad, z = site.z + Math.sin(a) * rad;
      b.spot = new THREE.Vector3(x, (site.y ?? groundHeight(x, z)) + 0.02, z);
      b.mode = 'landing';
    });
    return true;
  }
  function takeOff(flock, scared) {
    flock.mode = 'fly';
    flock.goal = randomGoal();
    flock.timer = 15 + rnd() * 20;
    for (const b of flock.members) {
      b.mode = 'fly';
      b.spot = null;
      const away = new THREE.Vector3(b.pos.x - flock.perch.x, 0, b.pos.z - flock.perch.z);
      if (away.lengthSq() < 1e-4) away.set(rnd() - 0.5, 0, rnd() - 0.5);
      away.normalize().multiplyScalar(scared ? 4.5 : 2.5);
      b.vel.set(away.x, scared ? 3.5 : 2.2, away.z);
    }
    flock.perch = null;
  }

  const sep = new THREE.Vector3(), ali = new THREE.Vector3(), coh = new THREE.Vector3(), acc = new THREE.Vector3(), tmp = new THREE.Vector3();
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), sc = new THREE.Vector3();
  let threatClock = 0;

  function update(dt) {
    dt = Math.min(dt, 0.05);
    if (dt <= 0) return;
    threatClock -= dt;
    const checkThreats = threatClock <= 0;
    if (checkThreats) threatClock = 0.25;
    for (const flock of flocks) {
      flock.timer -= dt;
      if (flock.mode === 'fly') {
        const c = tmp.set(0, 0, 0);
        for (const b of flock.members) c.add(b.pos);
        c.multiplyScalar(1 / flock.members.length);
        if (c.distanceTo(flock.goal) < 6 || flock.timer <= 0) {
          if (!(rnd() < 0.35 && landFlock(flock))) { flock.goal = randomGoal(); flock.timer = 12 + rnd() * 20; }
        }
      } else if (flock.perch) {
        const settled = flock.members.every((b) => b.mode === 'perch');
        if ((checkThreats && threatened(flock.perch, 3.2)) || (settled && flock.timer <= 0)) takeOff(flock, flock.timer > 0);
        else if (flock.mode === 'landing' && settled) flock.mode = 'perched';
      }
    }
    birds.forEach((b, i) => {
      let amt = 1;
      if (b.mode === 'perch') {
        b.idle -= dt;
        if (b.idle < 0) { b.idle = 1.5 + rnd() * 5; b.yaw += (rnd() - 0.5) * 1.6; }
        amt = -1;
        e.set(0, b.yaw, 0);
        b.pos.copy(b.spot);
      } else {
        const flock = b.flock;
        acc.set(0, 0, 0);
        if (b.mode === 'landing') {
          tmp.copy(b.spot).sub(b.pos);
          const d = tmp.length();
          if (d < 0.12) { b.yaw = Math.atan2(b.vel.x, b.vel.z) || b.yaw; b.mode = 'perch'; b.pos.copy(b.spot); b.vel.set(0, 0, 0); amt = -1; }
          else {
            const speed = Math.min(4.5, 0.8 + d * 0.9);
            tmp.multiplyScalar(speed / d).sub(b.vel).multiplyScalar(3.2);
            acc.add(tmp);
          }
        } else {
          sep.set(0, 0, 0); ali.set(0, 0, 0); coh.set(0, 0, 0);
          let n = 0;
          for (const o of flock.members) {
            if (o === b) continue;
            tmp.copy(b.pos).sub(o.pos);
            const d = tmp.length();
            if (d < 0.9 && d > 1e-4) sep.add(tmp.multiplyScalar(1 / (d * d)));
            ali.add(o.vel);
            coh.add(o.pos);
            n++;
          }
          if (n) {
            ali.multiplyScalar(1 / n).sub(b.vel).multiplyScalar(0.6);
            coh.multiplyScalar(1 / n).sub(b.pos).multiplyScalar(0.35);
          }
          tmp.copy(flock.goal).sub(b.pos);
          const goalD = tmp.length() || 1;
          tmp.multiplyScalar(4.2 / goalD).sub(b.vel).multiplyScalar(0.55);
          acc.add(sep.multiplyScalar(0.9)).add(ali).add(coh).add(tmp);
          const floor = groundHeight(b.pos.x, b.pos.z) + 3;
          if (b.pos.y < floor) acc.y += (floor - b.pos.y) * 4;
        }
        if (b.mode !== 'perch') {
          const prevYaw = Math.atan2(b.vel.x, b.vel.z);
          b.vel.addScaledVector(acc, dt);
          const sp = b.vel.length();
          const maxSp = b.mode === 'landing' ? 5 : 5.8, minSp = b.mode === 'landing' ? 0.3 : 2.6;
          if (sp > maxSp) b.vel.multiplyScalar(maxSp / sp);
          else if (sp < minSp && sp > 1e-4) b.vel.multiplyScalar(minSp / sp);
          b.pos.addScaledVector(b.vel, dt);
          const yaw = Math.atan2(b.vel.x, b.vel.z);
          let dy = yaw - prevYaw;
          if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
          b.bank += ((-dy / dt) * 0.35 - b.bank) * Math.min(1, dt * 4);
          b.bank = Math.max(-0.9, Math.min(0.9, b.bank));
          b.yaw = yaw;
          const pitch = -Math.atan2(b.vel.y, Math.hypot(b.vel.x, b.vel.z)) * 0.8;
          e.set(pitch, yaw, b.bank);
          // flap in bursts, glide in between; always flap when climbing or landing
          b.flapT -= dt;
          if (b.flapT <= 0) { b.gliding = !b.gliding; b.flapT = b.gliding ? 1 + rnd() * 2 : 1.2 + rnd() * 2; }
          amt = b.mode === 'landing' || b.vel.y > 0.4 || !b.gliding ? 1 : 0;
        }
      }
      if (amt < 0) e.set(0, b.yaw, 0);
      q.setFromEuler(e);
      sc.setScalar(b.scale);
      m.compose(b.pos, q, sc);
      mesh.setMatrixAt(i, m);
      flapAttr.setXYZ(i, b.phase, amt, b.mode === 'landing' ? b.freq * 1.3 : b.freq);
    });
    mesh.instanceMatrix.needsUpdate = true;
    flapAttr.needsUpdate = true;
  }

  update(0.016);
  return { mesh, update, setThreats };
}
