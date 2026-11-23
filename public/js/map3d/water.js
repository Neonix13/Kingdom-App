import * as THREE from 'three';
import { G, WAR_FOG_PARS } from './shaderPatches.js';

// Stylised water: depth tint from terrain heightfields, shore foam, scrolling normals,
// sky fresnel and sun glints. No reflection render pass (cheap enough for 60 fps).
// `ribbon: true` variant is used for narrow streams (depth faked from an `edge` attribute).
export function createWaterMaterial({ fineTex, fineBounds, coarseTex, coarseBounds, normalTex, sunDir, sunColor, ribbon = false }) {
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uFine: { value: null },
      uFineBounds: { value: new THREE.Vector4() },
      uCoarse: { value: null },
      uCoarseBounds: { value: new THREE.Vector4() },
      uNormals: { value: null },
      uSunDir: { value: new THREE.Vector3() },
      uSunColor: { value: new THREE.Color() },
      uSkyZenith: { value: new THREE.Color(0x5a8fcc) },
      uSkyHorizon: { value: new THREE.Color(0xd4e0ea) },
      uShallow: { value: new THREE.Color(0x46b9ad) },
      uDeep: { value: new THREE.Color(0x0d4256) },
      uFoam: { value: new THREE.Color(0xf2fbff) },
      uLight: { value: 1.0 },
    },
  ]);
  uniforms.uFine.value = fineTex;
  uniforms.uFineBounds.value.copy(fineBounds);
  uniforms.uCoarse.value = coarseTex;
  uniforms.uCoarseBounds.value.copy(coarseBounds);
  uniforms.uNormals.value = normalTex;
  uniforms.uSunDir.value.copy(sunDir);
  uniforms.uSunColor.value.copy(sunColor);
  uniforms.uTime = G.uTime;
  uniforms.uNoise = G.uNoise;
  for (const k of ['uFogOn', 'uFogLight', 'uVisA', 'uVisB', 'uVisMix', 'uVisBounds']) uniforms[k] = G[k];

  return new THREE.ShaderMaterial({
    uniforms,
    defines: ribbon ? { RIBBON: '' } : {},
    transparent: true,
    depthWrite: false,
    side: ribbon ? THREE.DoubleSide : THREE.FrontSide,
    fog: true,
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vW;
      #ifdef RIBBON
        attribute float edge;
        varying float vEdge;
      #endif
      void main() {
        #ifdef RIBBON
          vEdge = edge;
        #endif
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform sampler2D uFine;
      uniform vec4 uFineBounds;
      uniform sampler2D uCoarse;
      uniform vec4 uCoarseBounds;
      uniform sampler2D uNormals;
      uniform sampler2D uNoise;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uSkyZenith;
      uniform vec3 uSkyHorizon;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uFoam;
      uniform float uLight;
      varying vec3 vW;
      #ifdef RIBBON
        varying float vEdge;
      #endif
      ${WAR_FOG_PARS}

      float terrainH( vec2 xz ) {
        vec2 uf = ( xz - uFineBounds.xy ) / uFineBounds.zw;
        if ( uf.x > 0.002 && uf.y > 0.002 && uf.x < 0.998 && uf.y < 0.998 ) return texture2D( uFine, uf ).r;
        vec2 uc = ( xz - uCoarseBounds.xy ) / uCoarseBounds.zw;
        if ( uc.x < 0.0 || uc.y < 0.0 || uc.x > 1.0 || uc.y > 1.0 ) return -3.0;
        return texture2D( uCoarse, uc ).r;
      }

      void main() {
        #ifdef RIBBON
          float ae = abs( vEdge );
          float depth = 0.05 + ( 1.0 - ae ) * 0.22;
        #else
          float depth = vW.y - terrainH( vW.xz );
          if ( depth < -0.03 ) discard;
        #endif

        vec2 uv = vW.xz;
        vec3 n1 = texture2D( uNormals, uv * 0.11 + vec2( uTime * 0.011, uTime * 0.007 ) ).rgb;
        vec3 n2 = texture2D( uNormals, uv * 0.23 + vec2( -uTime * 0.009, uTime * 0.013 ) ).rgb;
        vec3 n3 = texture2D( uNormals, uv * 0.53 + vec2( uTime * 0.02, -uTime * 0.017 ) ).rgb;
        vec3 nt = ( n1 + n2 + n3 * 0.6 ) / 2.6 * 2.0 - 1.0;
        vec3 N = normalize( vec3( nt.x * 0.5, 1.0, nt.y * 0.5 ) );

        vec3 V = normalize( cameraPosition - vW );
        float NdV = max( dot( N, V ), 0.0 );
        float fres = 0.04 + 0.96 * pow( 1.0 - NdV, 5.0 );

        vec3 R = reflect( -V, N );
        vec3 sky = mix( uSkyHorizon, uSkyZenith, smoothstep( 0.0, 0.6, R.y ) );

        float dk = 1.0 - exp( -max( depth, 0.0 ) * 3.0 );
        vec3 body = mix( uShallow, uDeep, dk );
        float diff = max( dot( N, uSunDir ), 0.0 ) * 0.5 + 0.5;
        body *= ( 0.4 + 0.6 * diff ) * uLight;

        vec3 col = mix( body, sky * uLight, fres * 0.8 );

        vec3 H = normalize( uSunDir + V );
        float nh = max( dot( N, H ), 0.0 );
        col += uSunColor * ( pow( nh, 320.0 ) * 7.0 + pow( nh, 48.0 ) * 0.22 );

        float fn = texture2D( uNoise, uv * 0.35 + vec2( uTime * 0.02, -uTime * 0.015 ) ).b;
        float fn2 = texture2D( uNoise, uv * 0.9 - vec2( uTime * 0.03, uTime * 0.01 ) ).g;
        #ifdef RIBBON
          float foam = smoothstep( 0.55, 0.95, ae ) * smoothstep( 0.3, 0.6, fn2 ) + smoothstep( 0.62, 0.8, fn ) * 0.35;
        #else
          float shore = 1.0 - smoothstep( 0.0, 0.1 + fn * 0.08, depth );
          float band = smoothstep( 0.55, 0.75, fn2 ) * ( 1.0 - smoothstep( 0.06, 0.26, depth ) );
          float foam = shore * smoothstep( 0.25, 0.6, fn * 0.6 + fn2 * 0.6 ) + band * 0.5;
        #endif
        foam = clamp( foam, 0.0, 1.0 );
        col = mix( col, uFoam * ( 0.65 + 0.35 * diff ) * uLight, foam * 0.85 );

        float alpha = mix( 0.5, 0.94, smoothstep( 0.0, 0.35, depth ) );
        alpha = max( alpha, foam * 0.9 );
        #ifdef RIBBON
          alpha *= 1.0 - smoothstep( 0.7, 1.0, ae );
        #else
          alpha *= smoothstep( -0.03, 0.03, depth );
        #endif

        gl_FragColor = vec4( col, alpha );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb = applyWarFog( gl_FragColor.rgb, vW, uTime, uNoise );
        #include <fog_fragment>
      }
    `,
  });
}
