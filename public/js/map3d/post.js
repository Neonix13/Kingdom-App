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

export function createPost(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.45, 2.4);
  const grade = new ShaderPass(GradeShader);
  const output = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(grade);
  composer.addPass(output);
  return { composer, renderPass, bloom, grade, output, rt };
}

// Adaptive quality: keep frame time under budget by trading resolution and effects.
export class QualityGovernor {
  constructor(levels, apply, { budgetMs = 17.5, upMs = 11.0 } = {}) {
    this.levels = levels;
    this.apply = apply;
    this.level = 0;
    this.budgetMs = budgetMs;
    this.upMs = upMs;
    this.acc = 0;
    this.frames = 0;
    this.windowStart = 0;
    this.slowWindows = 0;
    this.fastWindows = 0;
    this.cooldownUntil = 0;
    this.blockUpUntil = 0;
    this.warmupUntil = performance.now() + 2500;
    this.locked = false;
    this.avgMs = 16.7;
  }
  set(level, now = performance.now()) {
    level = Math.max(0, Math.min(this.levels.length - 1, level));
    if (level === this.level) return;
    this.level = level;
    this.apply(this.levels[level], level);
    this.cooldownUntil = now + 1500;
    this.slowWindows = this.fastWindows = 0;
  }
  frame(dtMs) {
    const now = performance.now();
    if (dtMs > 250) { this.acc = 0; this.frames = 0; this.windowStart = now; return; }
    if (now < this.warmupUntil) { this.windowStart = now; return; }
    this.acc += dtMs;
    this.frames++;
    if (now - this.windowStart < 1000) return;
    const avg = this.acc / this.frames;
    this.avgMs = avg;
    this.acc = 0; this.frames = 0; this.windowStart = now;
    if (this.locked || now < this.cooldownUntil) return;
    if (avg > this.budgetMs) {
      this.fastWindows = 0;
      if (++this.slowWindows >= 2 && this.level < this.levels.length - 1) {
        this.blockUpUntil = now + 30000;
        this.set(this.level + 1, now);
      }
    } else if (avg < this.upMs) {
      this.slowWindows = 0;
      if (++this.fastWindows >= 6 && this.level > 0 && now > this.blockUpUntil) this.set(this.level - 1, now);
    } else {
      this.slowWindows = 0; this.fastWindows = 0;
    }
  }
}
