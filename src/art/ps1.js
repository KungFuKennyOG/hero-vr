// PS1 look: one shared material for every static mesh in the city.
// Vertex snapping, affine texture warp, per-vertex (Gouraud) lighting and fog,
// 15-bit colour with ordered dithering, and an atlas lookup so a whole city
// chunk can be one geometry, one material, one draw call.
import * as THREE from '../../vendor/three.module.js';

// Wobble (vertex snap + affine warp) is off in both presets; set snapMode 1 / affine > 0 to bring it back.
// Settings tuned for the headset. Screen-space snapping wobbles differently in
// each eye, so VR uses world-space snapping (stable in stereo, wobbles only on
// moving objects) and a milder affine warp.
export const PS1_VR = { snapMode: 0, snapGrid: 0.02, affine: 0, dither: 1, colorDepth: 32 };
export const PS1_FLAT = { snapMode: 0, snapRes: [320, 240], affine: 0, dither: 1, colorDepth: 32 };

// Lighting + sky presets. The city's look follows the player's reputation.
export const MOODS = {
  hero: {
    skyTop: 0x2f6fc4, skyHorizon: 0xbfd8e8, skyGround: 0x7d8a94,
    fog: 0xaec8d8, fogNear: 90, fogFar: 260,
    sun: 0xfff1d6, sunDir: [0.45, 0.8, 0.35], ambient: 0x5d6a80,
    nightGlow: 0.15, sunSize: 0.035,
  },
  villain: {
    skyTop: 0x1a0d14, skyHorizon: 0xc2482a, skyGround: 0x2a1a1a,
    fog: 0x5a2a22, fogNear: 55, fogFar: 200,
    sun: 0xff8a4a, sunDir: [-0.6, 0.18, -0.5], ambient: 0x3a2630,
    nightGlow: 1.0, sunSize: 0.06,
  },
};

const VERT = /* glsl */`
uniform float uSnapMode;   // 0 off, 1 world grid, 2 screen grid
uniform float uSnapGrid;   // metres, world mode
uniform vec2  uSnapRes;    // pixels, screen mode
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uAmbient;
uniform float uFogNear;
uniform float uFogFar;
attribute vec2  aTile;
attribute vec3  aColor;
attribute float aTint;
varying vec2  vUv;
varying vec3  vUvAffine;
varying vec2  vTile;
varying vec3  vColor;
varying vec3  vLight;
varying float vFog;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = m * instanceMatrix;
  #endif
  vec4 wp = m * vec4(position, 1.0);
  if (uSnapMode > 0.5 && uSnapMode < 1.5) {
    wp.xyz = floor(wp.xyz / uSnapGrid + 0.5) * uSnapGrid;
  }
  vec4 vp = viewMatrix * wp;
  vec4 cp = projectionMatrix * vp;
  if (uSnapMode > 1.5) {
    vec2 g = uSnapRes * 0.5;
    cp.xy = floor(cp.xy / cp.w * g + 0.5) / g * cp.w;
  }
  gl_Position = cp;

  vec3 n = normalize(mat3(m) * normal);
  float d = max(dot(n, normalize(uSunDir)), 0.0);
  float sky = 0.5 + 0.5 * n.y;               // cheap hemisphere fill
  vLight = uAmbient * (0.6 + 0.6 * sky) + uSunColor * d;

  vec3 c = aColor;
  #ifdef USE_INSTANCING_COLOR
    c *= mix(vec3(1.0), instanceColor, aTint);
  #endif
  vColor = c;
  vUv = uv;
  vUvAffine = vec3(uv * cp.w, cp.w);
  vTile = aTile;
  vFog = smoothstep(uFogNear, uFogFar, length(vp.xyz));
}`;

const FRAG = /* glsl */`
uniform sampler2D uAtlas;
uniform float uTiles;
uniform float uHalfTexel;
uniform float uAffine;
uniform float uDither;
uniform float uColorDepth;
uniform vec3  uFogColor;
uniform float uNightGlow;
varying vec2  vUv;
varying vec3  vUvAffine;
varying vec2  vTile;
varying vec3  vColor;
varying vec3  vLight;
varying float vFog;

float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  const float b[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  return b[i.x + i.y * 4] / 16.0;
}

void main() {
  // Interpolating uv*w and w, then dividing, cancels perspective correction.
  vec2 uv = mix(vUv, vUvAffine.xy / vUvAffine.z, uAffine);
  vec2 f = clamp(fract(uv), uHalfTexel, 1.0 - uHalfTexel);
  // Gradients from the continuous uv, so the fract() wrap doesn't pick a tiny mip at tile seams.
  vec2 g = uv / uTiles;
  vec4 t = textureGrad(uAtlas, (vTile + f) / uTiles, dFdx(g), dFdy(g));

  vec3 base = t.rgb * vColor;
  vec3 col = base * vLight;
  // Alpha below 1 marks emissive texels: lit windows, lamps, neon, palm cores.
  float glow = 1.0 - t.a;
  if (glow > 0.0) {
    vec3 off = base * vLight * vec3(0.32, 0.38, 0.5);
    vec3 on = base * (0.7 + glow * 0.5);
    col = mix(off, on, clamp(uNightGlow * glow * 1.6, 0.0, 1.0));
  }
  col = mix(col, uFogColor, vFog);

  float levels = uColorDepth - 1.0;
  col += (bayer4(gl_FragCoord.xy) - 0.5) / levels * uDither;
  col = floor(col * levels + 0.5) / levels;
  gl_FragColor = vec4(col, 1.0);
}`;

function lin(hex) { return new THREE.Color(hex); }

export function createPS1Material(atlas, opts = {}) {
  const o = { ...PS1_FLAT, ...opts };
  const mood = MOODS.hero;
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uAtlas: { value: atlas.texture },
      uTiles: { value: atlas.tilesPerRow },
      uHalfTexel: { value: 0.5 / atlas.tileSize },
      uSnapMode: { value: o.snapMode },
      uSnapGrid: { value: o.snapGrid ?? 0.02 },
      uSnapRes: { value: new THREE.Vector2(...(o.snapRes ?? [320, 240])) },
      uAffine: { value: o.affine },
      uDither: { value: o.dither },
      uColorDepth: { value: o.colorDepth },
      uSunDir: { value: new THREE.Vector3(...mood.sunDir).normalize() },
      uSunColor: { value: lin(mood.sun) },
      uAmbient: { value: lin(mood.ambient) },
      uFogColor: { value: lin(mood.fog) },
      uFogNear: { value: mood.fogNear },
      uFogFar: { value: mood.fogFar },
      uNightGlow: { value: mood.nightGlow },
    },
  });
}

// Gradient sky dome with a sun disc and the same dithering, so the banding
// looks deliberate instead of broken.
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */`
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGround;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunSize;
uniform float uDither; uniform float uColorDepth; uniform float uTime; uniform float uSmoke;
varying vec3 vDir;
float bayer4(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  const float b[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  return b[i.x + i.y * 4] / 16.0;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(h, 0.55)) : mix(uHorizon, uGround, min(-h * 6.0, 1.0));
  float s = dot(d, normalize(uSunDir));
  col += uSunColor * smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.6, s);
  col += uSunColor * 0.25 * pow(max(s, 0.0), 24.0);
  // Blocky cloud / smoke bands, quantised to keep the low-fi feel.
  vec2 cp = d.xz / max(h + 0.15, 0.05) * 1.6 + vec2(uTime * 0.02, 0.0);
  float n = noise(floor(cp * 6.0) / 6.0) * 0.6 + noise(cp * 2.3) * 0.4;
  float band = smoothstep(0.55, 0.8, n) * smoothstep(0.0, 0.25, h) * (1.0 - smoothstep(0.5, 0.9, h));
  col = mix(col, mix(vec3(1.0), uGround * 0.6, uSmoke), band * (0.35 + 0.4 * uSmoke));
  float levels = uColorDepth - 1.0;
  col += (bayer4(gl_FragCoord.xy) - 0.5) / levels * uDither;
  col = floor(col * levels + 0.5) / levels;
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    depthWrite: false,
    side: THREE.BackSide,
    uniforms: {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uSunSize: { value: 0.04 },
      uDither: { value: 1 }, uColorDepth: { value: 32 }, uTime: { value: 0 }, uSmoke: { value: 0 },
    },
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 12), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}

// Applies a mood to every PS1 material and the sky. Pass t in 0..1 to blend
// hero -> villain (the reputation meter can drive this directly).
export function applyMood(materials, sky, t) {
  const a = MOODS.hero, b = MOODS.villain;
  const c = (x, y) => new THREE.Color(x).lerp(new THREE.Color(y), t);
  const n = (x, y) => x + (y - x) * t;
  const sun = new THREE.Vector3(...a.sunDir).normalize().lerp(new THREE.Vector3(...b.sunDir).normalize(), t).normalize();
  for (const m of materials) {
    const u = m.uniforms;
    u.uSunDir.value.copy(sun);
    u.uSunColor.value.copy(c(a.sun, b.sun));
    u.uAmbient.value.copy(c(a.ambient, b.ambient));
    u.uFogColor.value.copy(c(a.fog, b.fog));
    u.uFogNear.value = n(a.fogNear, b.fogNear);
    u.uFogFar.value = n(a.fogFar, b.fogFar);
    u.uNightGlow.value = n(a.nightGlow, b.nightGlow);
  }
  if (sky) {
    const u = sky.material.uniforms;
    u.uTop.value.copy(c(a.skyTop, b.skyTop));
    u.uHorizon.value.copy(c(a.skyHorizon, b.skyHorizon));
    u.uGround.value.copy(c(a.skyGround, b.skyGround));
    u.uSunDir.value.copy(sun);
    u.uSunColor.value.copy(c(a.sun, b.sun));
    u.uSunSize.value = n(a.sunSize, b.sunSize);
    u.uSmoke.value = t;
  }
}
