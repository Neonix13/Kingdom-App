import * as THREE from 'three';
import { G } from './shaderPatches.js';
import { makeRng } from './noise.js';

export function createStars(count = 4200, radius = 900) {
  const rng = makeRng(77);
  const pos = new Float32Array(count * 3), size = new Float32Array(count), ph = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const y = Math.pow(rng(), 0.8);
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(a) * r * radius;
    pos[i * 3 + 1] = y * radius;
    pos[i * 3 + 2] = Math.sin(a) * r * radius;
    size[i] = 0.6 + Math.pow(rng(), 6) * 3.2;
    ph[i] = rng() * 100;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: G.uTime, uNight: { value: 0 }, uPx: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uTime;
      uniform float uPx;
      attribute float size;
      attribute float phase;
      varying float vTw;
      varying float vH;
      void main() {
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        gl_Position = projectionMatrix * mv;
        vTw = 0.65 + 0.35 * sin( uTime * ( 1.3 + fract( phase ) * 2.0 ) + phase );
        vH = normalize( position ).y;
        gl_PointSize = size * uPx;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uNight;
      varying float vTw;
      varying float vH;
      void main() {
        float d = length( gl_PointCoord - 0.5 );
        float a = smoothstep( 0.5, 0.0, d ) * vTw * uNight * smoothstep( 0.02, 0.2, vH );
        if ( a < 0.002 ) discard;
        gl_FragColor = vec4( vec3( 0.85, 0.9, 1.0 ) * a * 2.4, 1.0 );
      }
    `,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -1;
  return pts;
}

export function createMoon() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const glow = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
  glow.addColorStop(0, 'rgba(220,230,255,0.55)');
  glow.addColorStop(0.35, 'rgba(160,180,230,0.12)');
  glow.addColorStop(1, 'rgba(120,140,200,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 256, 256);
  ctx.beginPath();
  ctx.arc(128, 128, 30, 0, Math.PI * 2);
  ctx.fillStyle = '#f2f4ff';
  ctx.fill();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#8890a8';
  for (const [x, y, r] of [[118, 120, 8], [138, 136, 6], [126, 142, 4], [140, 116, 5]]) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(2.2, 2.2, 2.4), transparent: true, depthWrite: false, fog: false, opacity: 0 });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(150);
  s.renderOrder = -1;
  return s;
}

export function createFireflies(points) {
  const n = points.length;
  const pos = new Float32Array(n * 3), ph = new Float32Array(n);
  points.forEach((p, i) => { pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; ph[i] = p.ph; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('phase', new THREE.BufferAttribute(ph, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: G.uTime, uNight: { value: 0 }, uPx: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uTime;
      uniform float uPx;
      attribute float phase;
      varying float vA;
      void main() {
        vec3 p = position;
        float t = uTime * 0.6 + phase * 7.0;
        p += vec3( sin( t * 0.9 ) + sin( t * 0.37 ) * 0.6, sin( t * 1.3 ) * 0.35, cos( t * 0.7 ) + cos( t * 0.29 ) * 0.6 ) * 0.28;
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        gl_Position = projectionMatrix * mv;
        float flick = pow( 0.5 + 0.5 * sin( uTime * ( 2.0 + fract( phase * 3.1 ) * 3.0 ) + phase * 40.0 ), 4.0 );
        vA = flick * ( 1.0 - smoothstep( 25.0, 70.0, -mv.z ) );
        gl_PointSize = ( 0.05 + 0.04 * flick ) * uPx / -mv.z;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uNight;
      varying float vA;
      void main() {
        float d = length( gl_PointCoord - 0.5 );
        float a = smoothstep( 0.5, 0.0, d );
        a = a * a * vA * uNight;
        if ( a < 0.003 ) discard;
        gl_FragColor = vec4( vec3( 1.0, 0.85, 0.35 ) * a * 4.0, 1.0 );
      }
    `,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  return pts;
}

// Warm additive light pools on the ground around lanterns / village hearts
export function createLightPools(spots) {
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uGlow: { value: 0 }, uTime: G.uTime },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying float vSeed;
      varying float vK;
      void main() {
        vUv = uv;
        vSeed = instanceMatrix[ 3 ].x * 1.7 + instanceMatrix[ 3 ].z;
        vK = length( instanceMatrix[ 1 ].xyz );
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uGlow;
      uniform float uTime;
      varying vec2 vUv;
      varying float vSeed;
      varying float vK;
      void main() {
        float d = length( vUv - 0.5 ) * 2.0;
        float f = pow( max( 1.0 - d, 0.0 ), 2.2 );
        float flick = 0.9 + 0.1 * sin( uTime * 9.0 + vSeed ) * sin( uTime * 5.3 + vSeed * 2.0 );
        float a = f * uGlow * flick * vK;
        if ( a < 0.002 ) discard;
        gl_FragColor = vec4( vec3( 1.0, 0.52, 0.18 ) * a * 0.9, 1.0 );
      }
    `,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, spots.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0);
  // spot: { x, y, z, r } disc, or { sx, sz, ry } ellipse (window light on the ground); k = intensity (stored in the
  // unused y scale of the flat quad)
  spots.forEach((s, i) => {
    q.setFromAxisAngle(yAxis, s.ry || 0);
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3((s.sx ?? s.r) * 2, s.k ?? 1, (s.sz ?? s.r) * 2));
    mesh.setMatrixAt(i, m);
  });
  mesh.count = spots.length;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}
