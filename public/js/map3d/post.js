import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uSaturation: { value: 1.12 },
    uShadowTint: { value: new THREE.Vector3(-0.004, 0.0, 0.012) },
    uHighlightTint: { value: new THREE.Vector3(1.03, 1.0, 0.95) },
    uContrast: { value: 1.06 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uVignette;
    uniform float uSaturation;
    uniform vec3 uShadowTint;
    uniform vec3 uHighlightTint;
    uniform float uContrast;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D( tDiffuse, vUv );
      vec3 col = c.rgb;
      float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
      col = mix( vec3( l ), col, uSaturation );
      float sh = 1.0 - smoothstep( 0.0, 0.35, l );
      col = max( col + uShadowTint * sh, 0.0 );
      col *= mix( vec3( 1.0 ), uHighlightTint, smoothstep( 0.3, 1.5, l ) );
      col = pow( max( col, 0.0 ) / 0.18, vec3( uContrast ) ) * 0.18;
      vec2 d = vUv - 0.5;
      float v = smoothstep( 0.95, 0.3, length( d * vec2( 1.0, 0.82 ) ) * 1.15 );
      col *= mix( 1.0 - uVignette, 1.0, v );
      gl_FragColor = vec4( col, c.a );
    }
  `,
};

// Light depth of field: gathers a golden-angle disc whose radius grows with the distance to the focus plane.
// Reads the scene depth resolved with the colour (depthTexture on the composer targets).
const DofShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    uNear: { value: 0.3 },
    uFar: { value: 1400 },
    uFocus: { value: 30 },
    uAperture: { value: 0.6 },
    uMaxBlur: { value: 5 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform float uNear, uFar, uFocus, uAperture, uMaxBlur;
    uniform vec2 uResolution;
    varying vec2 vUv;
    float viewZ( vec2 uv ) {
      float z = texture2D( tDepth, uv ).x * 2.0 - 1.0;
      return 2.0 * uNear * uFar / ( uFar + uNear - z * ( uFar - uNear ) );
    }
    // near blur is softened: the foreground of a strategy view is large on screen
    float coc( float z ) { return clamp( abs( z - uFocus ) / max( z, 0.001 ) * uAperture * ( z < uFocus ? 0.6 : 1.0 ), 0.0, 1.0 ) * uMaxBlur; }
    void main() {
      vec4 base = texture2D( tDiffuse, vUv );
      float z0 = viewZ( vUv );
      float c0 = coc( z0 );
      if ( c0 < 0.45 ) { gl_FragColor = base; return; }
      vec3 acc = base.rgb;
      float wsum = 1.0;
      for ( int i = 0; i < 20; i ++ ) {
        float fi = float( i ) + 0.5;
        float r = sqrt( fi / 20.0 ) * c0;
        float a = fi * 2.39996323;
        vec2 uv = vUv + vec2( cos( a ), sin( a ) ) * r / uResolution;
        float zs = viewZ( uv );
        // a sharper surface in front must not smear into the blurred background behind it
        float w = zs < z0 ? smoothstep( r - 1.0, r + 1.0, coc( zs ) + 0.5 ) : 1.0;
        acc += texture2D( tDiffuse, uv ).rgb * w;
        wsum += w;
      }
      gl_FragColor = vec4( acc / wsum, base.a );
    }
  `,
};

class DofPass extends ShaderPass {
  constructor(getCamera) {
    super(DofShader);
    this.getCamera = getCamera;
    this.baseBlur = 4;
  }
  render(renderer, writeBuffer, readBuffer, deltaTime, maskActive) {
    const u = this.uniforms;
    const cam = this.getCamera();
    u.tDepth.value = readBuffer.depthTexture;
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    u.uResolution.value.set(readBuffer.width, readBuffer.height);
    u.uMaxBlur.value = this.baseBlur * (readBuffer.height / 900);
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  rt.depthTexture = new THREE.DepthTexture(size.x, size.y);
  const composer = new EffectComposer(renderer, rt);
  if (!composer.renderTarget2.depthTexture) composer.renderTarget2.depthTexture = new THREE.DepthTexture(size.x, size.y);
  const renderPass = new RenderPass(scene, camera);
  const dof = new DofPass(() => renderPass.camera);
  dof.enabled = false;
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.45, 2.4);
  const grade = new ShaderPass(GradeShader);
  const output = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(dof);
  composer.addPass(bloom);
  composer.addPass(grade);
  composer.addPass(output);
  return { composer, renderPass, dof, bloom, grade, output, rt };
}

// Adaptive quality: keep frame time under budget by trading resolution and effects.
// On vsync-capped displays headroom is invisible, so after a downgrade it periodically
// probes one level up and backs off (exponentially) if the probe drops frames.
export class QualityGovernor {
  constructor(levels, apply, { budgetMs = 17.5, fastMs = 11.0, measure = null } = {}) {
    this.levels = levels;
    this.measure = measure;
    this.costMs = 0;
    this.apply = apply;
    this.level = 0;
    this.budgetMs = budgetMs;
    this.fastMs = fastMs;
    this.acc = 0;
    this.frames = 0;
    this.windowStart = performance.now();
    this.slowWindows = 0;
    this.okWindows = 0;
    this.cooldownUntil = 0;
    this.blockUpUntil = 0;
    this.backoff = 20000;
    this.probing = false;
    this.warmupUntil = Infinity;
    this.pausedUntil = 0;
    this.locked = false;
    this.avgMs = 0;
  }
  start(delayMs = 2000) {
    this.warmupUntil = performance.now() + delayMs;
  }
  pause(ms = 800) {
    this.pausedUntil = performance.now() + ms;
  }
  set(level, now = performance.now()) {
    level = Math.max(0, Math.min(this.levels.length - 1, level));
    if (level === this.level) return;
    this.level = level;
    this.apply(this.levels[level], level);
    this.cooldownUntil = now + 1500;
    this.slowWindows = this.okWindows = 0;
    this.acc = 0; this.frames = 0; this.windowStart = now;
  }
  frame(dtMs) {
    const now = performance.now();
    if (dtMs > 250 || now < this.warmupUntil || now < this.pausedUntil) {
      this.acc = 0; this.frames = 0; this.windowStart = now;
      return;
    }
    this.acc += dtMs;
    this.frames++;
    if (now - this.windowStart < 1000) return;
    const avg = this.acc / this.frames;
    this.avgMs = avg;
    this.acc = 0; this.frames = 0; this.windowStart = now;
    if (this.locked || now < this.cooldownUntil) return;
    if (avg > this.budgetMs) {
      // Distinguish real GPU/CPU load from an external frame cap (power saving, occluded window):
      // time one fully synchronous frame; if it is cheap, the slowness is not ours.
      if (this.measure) {
        this.costMs = this.measure();
        if (this.costMs < this.budgetMs * 0.6) {
          this.slowWindows = 0;
          if (this.level > 0 && this.costMs < this.budgetMs * 0.3 && now > this.blockUpUntil && ++this.okWindows >= 4) this.set(this.level - 1, now);
          return;
        }
      }
      this.okWindows = 0;
      const need = this.probing ? 1 : 2;
      if (++this.slowWindows >= need && this.level < this.levels.length - 1) {
        if (this.probing) this.backoff = Math.min(this.backoff * 2, 300000);
        this.probing = false;
        this.blockUpUntil = now + this.backoff;
        this.set(this.level + 1, now);
      }
      return;
    }
    this.slowWindows = 0;
    if (this.probing && ++this.okWindows >= 4) { this.probing = false; this.okWindows = 0; }
    if (this.level === 0 || now < this.blockUpUntil || this.probing) return;
    const needOk = avg < this.fastMs ? 4 : 10;
    if (++this.okWindows >= needOk) {
      this.probing = true;
      this.set(this.level - 1, now);
    }
  }
}
