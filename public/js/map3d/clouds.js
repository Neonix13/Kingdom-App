import * as THREE from 'three';
import { G } from './shaderPatches.js';

// Single drifting cloud deck. Uses the same density function as the ground cloud shadows,
// so every shadow on the terrain has a matching cloud overhead.
export function createCloudLayer(size = 2600) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: G.uTime,
      uNoise: G.uNoise,
      uCloudScale: G.uCloudScale,
      uCloudSpeed: G.uCloudSpeed,
      uCloudHeight: G.uCloudHeight,
      uCloudStrength: G.uCloudStrength,
      uLit: { value: new THREE.Color(1.6, 1.55, 1.5) },
      uShade: { value: new THREE.Color(0.55, 0.6, 0.7) },
      uHorizon: { value: new THREE.Color(0xbccad6) },
      uOpacity: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      uniform float uTime;
      uniform sampler2D uNoise;
      uniform float uCloudScale;
      uniform vec2 uCloudSpeed;
      uniform float uCloudHeight;
      uniform float uCloudStrength;
      uniform vec3 uLit;
      uniform vec3 uShade;
      uniform vec3 uHorizon;
      uniform float uOpacity;
      varying vec3 vW;
      void main() {
        vec2 p = vW.xz * uCloudScale;
        float c = texture2D( uNoise, p + uCloudSpeed * uTime ).r * 0.75;
        c += texture2D( uNoise, mat2( 0.8, -0.6, 0.6, 0.8 ) * p * 2.7 - uCloudSpeed * uTime * 1.6 ).g * 0.25;
        float detail = texture2D( uNoise, p * 9.0 + uCloudSpeed * uTime * 3.0 ).b;
        float a = smoothstep( 0.5, 0.78, c + ( detail - 0.5 ) * 0.08 );
        float core = smoothstep( 0.62, 0.95, c );
        vec3 col = mix( uLit, uShade, core * 0.75 );
        float d = length( vW.xz - cameraPosition.xz );
        float far = smoothstep( 250.0, 1100.0, d );
        col = mix( col, uHorizon, far * 0.85 );
        a *= ( 1.0 - smoothstep( 700.0, 1250.0, d ) );
        a *= 1.0 - smoothstep( uCloudHeight - 45.0, uCloudHeight - 12.0, cameraPosition.y );
        a *= uOpacity * 0.92 * clamp( uCloudStrength / 0.38, 0.0, 1.0 );
        if ( a < 0.004 ) discard;
        gl_FragColor = vec4( col, a );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 1, 1).rotateX(Math.PI / 2), mat);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  return mesh;
}
