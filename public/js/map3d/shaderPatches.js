import * as THREE from 'three';

export const G = {
  uTime: { value: 0 },
  uNoise: { value: null },
  uCloudStrength: { value: 0.38 },
  uCloudScale: { value: 0.0065 },
  uCloudSpeed: { value: new THREE.Vector2(0.0042, 0.0017) },
  uCloudShift: { value: new THREE.Vector2(0, 0) },
  uCloudHeight: { value: 95 },
  uWindDir: { value: new THREE.Vector2(0.82, 0.57) },
  uWindStrength: { value: 1.0 },
  uFogOn: { value: 0 },
  uVisA: { value: null },
  uVisB: { value: null },
  uVisMix: { value: 1 },
  uVisBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
  uOverlay: { value: null },
  uOcc: { value: null },
  uOccOn: { value: 0 },
  uOverlayBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
};

// Fog of war, applied after lighting to every patched material (and the water shader)
export const WAR_FOG_PARS = /* glsl */`
#define KB_WARFOG 1
uniform float uFogOn;
// set by applyWarFog, read by fog_fragment: the atmospheric fog is darkened over hidden ground too
float kbWarHidden = 0.0;
float kbWarKeep = 1.0;
uniform sampler2D uVisA;
uniform sampler2D uVisB;
uniform float uVisMix;
uniform vec4 uVisBounds;
vec3 applyWarFog( vec3 c, vec3 wp, float t, sampler2D noiseTex ) {
  if ( uFogOn < 0.5 ) return c;
  vec2 vuv = ( wp.xz - uVisBounds.xy ) / uVisBounds.zw;
  // r: visible, g: closeness to the visible area (1 at its edge, fading exponentially to black with distance)
  vec2 vv = mix( texture2D( uVisA, vuv ).rg, texture2D( uVisB, vuv ).rg, uVisMix );
  float hidden = 1.0 - vv.r;
  if ( hidden < 0.002 ) return c;
  float near = vv.g;
  kbWarHidden = hidden;
  kbWarKeep = 0.3 * near;
  float l = dot( c, vec3( 0.3, 0.59, 0.11 ) );
  // soft start: just past the edge the ground keeps half its light and some colour, then fades exponentially to black
  vec3 fogged = mix( vec3( l ), c, 0.15 + 0.25 * near ) * ( 0.5 * near ) + vec3( 0.008, 0.012, 0.022 ) * near;
  float mist = texture2D( noiseTex, wp.xz * 0.045 + t * vec2( 0.012, 0.007 ) ).g * 0.6
             + texture2D( noiseTex, wp.xz * 0.11 - t * vec2( 0.009, 0.014 ) ).b * 0.4;
  fogged += vec3( 0.06, 0.068, 0.085 ) * smoothstep( 0.35, 0.85, mist ) * near;
  return mix( c, fogged, hidden );
}
`;

// Height-attenuated exponential fog: dense in valleys / far plains, thin on mountain peaks.
export function installHeightFog(base = 0.0, falloff = 0.055) {
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float _k = ${falloff.toFixed(4)};
    float _y0 = max( vFogWorld.y - ${base.toFixed(3)}, 0.0 );
    float _y1 = max( cameraPosition.y - ${base.toFixed(3)}, 0.0 );
    float _dy = _y1 - _y0;
    float _e0 = exp( - _k * _y0 );
    float _int = abs( _dy ) > 0.05 ? ( _e0 - exp( - _k * _y1 ) ) / ( _k * _dy ) : _e0;
    float fogFactor = 1.0 - exp( - fogDensity * vFogDepth * _int );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  #ifdef KB_WARFOG
    vec3 _fogC = fogColor * mix( 1.0, kbWarKeep, kbWarHidden );
  #else
    vec3 _fogC = fogColor;
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, _fogC, fogFactor );
#endif`;
}

export function patchLit(material, opts = {}, extra = null, cacheKey = '') {
  const o = {
    cloud: true,
    wind: false,
    windBend: 0.1,
    windFreq: 1.3,
    flutter: 0.0,
    fadeNear: 0,
    fadeFar: 0,
    noFlip: false,
    clearOnUnits: false,
    ...opts,
  };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = G.uTime;
    shader.uniforms.uNoise = G.uNoise;
    shader.uniforms.uCloudStrength = G.uCloudStrength;
    shader.uniforms.uCloudScale = G.uCloudScale;
    shader.uniforms.uCloudSpeed = G.uCloudSpeed;
    shader.uniforms.uCloudShift = G.uCloudShift;
    shader.uniforms.uCloudHeight = G.uCloudHeight;
    shader.uniforms.uWindDir = G.uWindDir;
    shader.uniforms.uWindStrength = G.uWindStrength;
    for (const k of ['uFogOn', 'uVisA', 'uVisB', 'uVisMix', 'uVisBounds', 'uOcc', 'uOccOn']) shader.uniforms[k] = G[k];

    let defs = '';
    if (o.wind) defs += `#define PATCH_WIND\n#define WIND_BEND ${o.windBend.toFixed(4)}\n#define WIND_FREQ ${o.windFreq.toFixed(3)}\n#define WIND_FLUTTER ${o.flutter.toFixed(4)}\n${o.flutter > 0 ? '#define PATCH_FLUTTER\n' : ''}`;
    if (o.fadeFar > 0) defs += `#define PATCH_FADE\n#define FADE_NEAR ${o.fadeNear.toFixed(2)}\n#define FADE_FAR ${o.fadeFar.toFixed(2)}\n`;
    if (o.cloud) defs += '#define PATCH_CLOUD\n';
    if (o.noFlip) defs += '#define PATCH_NOFLIP\n';
    if (o.clearOnUnits) defs += '#define PATCH_OCC\n';

    shader.vertexShader = shader.vertexShader.replace('#include <common>', `${defs}
#include <common>
uniform float uTime;
uniform sampler2D uNoise;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform sampler2D uOcc;
uniform float uOccOn;
uniform vec4 uVisBounds;
varying vec3 vPWorld;
`);

    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
#if defined( PATCH_WIND ) || defined( PATCH_FADE ) || defined( PATCH_OCC )
{
  vec3 _ip = vec3( 0.0 );
  mat3 _im = mat3( 1.0 );
  #ifdef USE_INSTANCING
    _ip = instanceMatrix[ 3 ].xyz;
    _im = mat3( instanceMatrix );
  #endif
  vec3 _ipw = ( modelMatrix * vec4( _ip, 1.0 ) ).xyz;
  #ifdef PATCH_WIND
    vec3 _wd = vec3( uWindDir.x, 0.0, uWindDir.y );
    vec3 _wl = transpose( _im ) * _wd / max( dot( _im[ 0 ], _im[ 0 ] ), 1e-4 );
    float _gust = texture2D( uNoise, _ipw.xz * 0.012 - uWindDir * uTime * 0.035 ).r;
    float _ph = uTime * WIND_FREQ + dot( _ipw.xz, vec2( 0.37, 0.29 ) );
    float _sw = ( sin( _ph ) * 0.45 + sin( _ph * 2.17 + 1.3 ) * 0.2 + _gust * 1.1 - 0.25 ) * uWindStrength;
    float _hh = max( transformed.y, 0.0 );
    transformed += _wl * _sw * _hh * _hh * WIND_BEND;
    #ifdef PATCH_FLUTTER
      transformed += normalize( objectNormal + vec3( 1e-4 ) ) * sin( uTime * 7.0 + position.x * 13.0 + position.z * 11.0 + _ph ) * WIND_FLUTTER * _hh;
    #endif
  #endif
  #ifdef PATCH_OCC
    if ( uOccOn > 0.5 ) {
      float _occ = texture2D( uOcc, ( _ipw.xz - uVisBounds.xy ) / uVisBounds.zw ).r;
      transformed *= 1.0 - 0.82 * _occ;
    }
  #endif
  #ifdef PATCH_FADE
    float _cd = distance( cameraPosition, _ipw );
    transformed *= 1.0 - smoothstep( FADE_NEAR, FADE_FAR, _cd );
  #endif
}
#endif
`);

    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 _wp4 = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    _wp4 = instanceMatrix * _wp4;
  #endif
  vPWorld = ( modelMatrix * _wp4 ).xyz;
}
`);

    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `${defs}
#include <common>
uniform float uTime;
uniform sampler2D uNoise;
uniform float uCloudStrength;
uniform float uCloudScale;
uniform vec2 uCloudSpeed;
uniform vec2 uCloudShift;
uniform float uCloudHeight;
varying vec3 vPWorld;
${WAR_FOG_PARS}
float cloudDensity( vec2 xz ) {
  vec2 p = xz * uCloudScale;
  float c = texture2D( uNoise, p + uCloudSpeed * uTime ).r * 0.75;
  c += texture2D( uNoise, mat2( 0.8, -0.6, 0.6, 0.8 ) * p * 2.7 - uCloudSpeed * uTime * 1.6 ).g * 0.25;
  return c;
}
`);

    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
#if defined( PATCH_NOFLIP ) && defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
  normal = normalize( vNormal );
#endif
`);

    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#ifdef PATCH_CLOUD
{
  float _cl = cloudDensity( vPWorld.xz + uCloudShift * ( uCloudHeight - vPWorld.y ) );
  float _shade = 1.0 - uCloudStrength * smoothstep( 0.5, 0.72, _cl );
  reflectedLight.directDiffuse *= _shade;
  reflectedLight.directSpecular *= _shade;
}
#endif
`);

    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `gl_FragColor.rgb = applyWarFog( gl_FragColor.rgb, vPWorld, uTime, uNoise );
#include <fog_fragment>`);

    if (extra) extra(shader);
  };
  material.customProgramCacheKey = () => 'patch:' + JSON.stringify(o) + ':' + cacheKey;
  return material;
}
