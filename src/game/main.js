import * as THREE from '../../vendor/three.module.js';
import { createAtlas, createFxSheet } from '../art/atlas.js';
import { createPS1Material, createSky, applyMood, MOODS, PS1_VR, PS1_FLAT } from '../art/ps1.js';
import { buildHand } from '../art/actors.js';
import { FxSystem } from '../art/fx.js';
import { CELL } from '../art/city.js';
import { World } from './world.js';
import { Physics } from './physics.js';
import { People } from './people.js';
import { Props } from './props.js';
import { Player } from './player.js';
import { Powers } from './powers.js';
import { Input } from './input.js';
import { Hud, repLabel } from './hud.js';
import { Sfx } from './sfx.js';

THREE.ColorManagement.enabled = false;
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- renderer
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(1);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(1.0); // full sharpness; drop to ~0.8 if the frame rate struggles
renderer.xr.setFoveation(1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 700);
const rig = new THREE.Group();
rig.add(camera);
camera.position.y = 1.65;
scene.add(rig);

const atlas = createAtlas();
const mat = createPS1Material(atlas, PS1_FLAT);
const instMat = createPS1Material(atlas, PS1_FLAT);
const handMat = createPS1Material(atlas, PS1_FLAT);
const materials = [mat, instMat, handMat];
const sky = createSky();
scene.add(sky);
const fx = new FxSystem(createFxSheet(), scene);
const sfx = new Sfx();

// ------------------------------------------------------------------- world
const world = new World(scene, atlas, mat, { radius: 2, seed: 7 });
const physics = new Physics(world);
const people = new People(scene, atlas, instMat, physics, world);
const props = new Props(scene, atlas, instMat, physics, world);
const player = new Player(world, rig);
const input = new Input(renderer, rig, camera, canvas);
const powers = new Powers(scene, { input, people, props, world, rig, sfx });
const hud = new Hud(camera, canvas);

// Start on the street next to a mugging in progress.
player.pos.set(CELL / 2 - 2, 0, 6);
input.yaw = Math.PI / 2; // desktop: camera yaw; VR copies it onto the rig
world.fill(player.pos.x, player.pos.z);

// People and props live only in the 3x3 blocks around the player.
const active = new Map();
function refreshActive() {
  const cx = World.cell(player.pos.x), cz = World.cell(player.pos.z);
  for (const [k, chunk] of active) {
    if (Math.max(Math.abs(chunk.cx - cx), Math.abs(chunk.cz - cz)) > 1 || !world.chunks.has(k)) {
      people.clearChunk(chunk, player.pos); props.clearChunk(chunk, player.pos); active.delete(k);
    }
  }
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const k = world.key(cx + i, cz + j);
    if (active.has(k) || !world.chunks.has(k)) continue;
    const chunk = world.chunks.get(k);
    active.set(k, chunk);
    const extra = props.populate(chunk);
    const r = Math.abs(Math.sin(chunk.cx * 12.9898 + chunk.cz * 78.233) * 43758.5453) % 1;
    const first = chunk.cx === 0 && chunk.cz === 0;
    people.populate(chunk, { mugging: first || (!chunk.plaza && r < 0.4), cops: extra.cops });
  }
}

// ------------------------------------------------------------- reputation
let rep = 0.3, moodT = 0.3, lastLabel = repLabel(rep);
function addRep(d, why) {
  rep = THREE.MathUtils.clamp(rep + d, 0, 1);
  const label = repLabel(rep);
  if (label !== lastLabel) {
    const worse = d > 0;
    hud.say(worse ? (label === 'SUPERVILLAIN' ? 'THE CITY FEARS YOU' : `YOU ARE NOW A ${label}`) : (label === 'BELOVED HERO' ? 'THE CITY LOVES YOU' : `YOU ARE A ${label} AGAIN`));
    if (worse) sfx.villain(); else sfx.rescue();
    lastLabel = label;
  } else if (why) hud.say(why);
}
people.onKO = (p, cause) => {
  if (p.team === 'civ') { hud.counts.civ++; addRep(0.045); }
  else if (p.team === 'cop') { hud.counts.cop++; addRep(0.07); }
  else if (p.team === 'thug') { hud.counts.thug++; addRep(-0.035); }
};
people.onRescue = () => { hud.counts.rescues++; addRep(-0.08, 'MUGGING STOPPED'); sfx.rescue(); };

// ------------------------------------------------------------- powers
player.onSlam = (pos, strength) => {
  const R = 6 + strength * 0.3;
  people.blast(pos, R, strength * 0.85);
  props.blast(pos, R, strength * 0.6);
  people.scare(pos, 45);
  fx.shockwave(pos, R);
  sfx.boom(strength);
  input.pulse('left', 1, 160); input.pulse('right', 1, 160);
};
player.onLand = (v) => { if (v > 7) sfx.thud(v); people.react(player.pos, rep, true); };
physics.onImpact = (body, speed) => { if (speed > 9) (body.kind === 'box' ? sfx.crunch(speed) : sfx.thud(speed)); };
physics.onBodyHit = (a, b, rel) => { if (rel > 9) sfx.crunch(rel); };

// Thrown things and a fast-flying player knock people over and shove cars.
const _v = new THREE.Vector3(), _c = new THREE.Vector3();
function projectileHits(dt) {
  for (const b of physics.bodies) {
    if (!b.thrown) continue;
    b.thrown = Math.max(0, b.thrown - dt);
    const v = b.velocity(_v);
    if (v.length() < 6) { b.thrown = 0; continue; }
    const r = b.kind === 'box' ? Math.max(...b.size) * 0.5 : 0.5;
    people.hitTest(b.center, r, v, 'thrown', b);
    for (const p of props.list) if (!p.body && props.center(p).distanceTo(b.center) < r + 1.5) props.activate(p).push(_c.copy(v).multiplyScalar(0.5));
  }
  if (player.speed > 14) {
    const chest = _c.copy(player.pos).setY(player.pos.y + 1);
    people.hitTest(chest, 0.6, player.vel, 'ram');
    for (const p of props.list) if (!p.body && props.center(p).distanceTo(chest) < 2.2) { props.activate(p).push(_v.copy(player.vel).multiplyScalar(0.7)); sfx.crunch(player.speed); }
  }
}

// Villain city burns: fires on nearby rooftops, more as reputation drops.
const fires = [];
function updateFires() {
  const want = moodT < 0.55 ? 0 : Math.min(8, 1 + Math.floor((moodT - 0.55) * 18));
  for (let i = fires.length - 1; i >= 0; i--) {
    if (fires.length > want || fires[i].base.distanceTo(player.pos) > 170) { fires[i].life = 0; fires.splice(i, 1); }
  }
  if (fires.length < want) {
    const tops = [];
    for (const c of world.chunks.values()) for (const b of c.colliders) tops.push(b);
    const b = tops[(Math.random() * tops.length) | 0];
    if (b) {
      const x = THREE.MathUtils.lerp(b.x0, b.x1, 0.3 + Math.random() * 0.4), z = THREE.MathUtils.lerp(b.z0, b.z1, 0.3 + Math.random() * 0.4);
      if (Math.hypot(x - player.pos.x, z - player.pos.z) < 140) fires.push(fx.fire(new THREE.Vector3(x, b.top - 0.5, z), 4 + Math.random() * 4));
    }
  }
}

// ------------------------------------------------------------- hands
const gloves = {};
for (const style of ['hero', 'villain']) for (const side of ['left', 'right']) {
  const m = new THREE.Mesh(buildHand(atlas, style, side).geometry, handMat);
  m.rotation.set(-0.35, 0, 0);
  gloves[`${style}-${side}`] = m;
}
function updateGloves() {
  const style = rep > 0.58 ? 'villain' : 'hero';
  for (const side of ['left', 'right']) {
    const grip = input.mode === 'vr' ? input.gripFor(side) : null;
    for (const s of ['hero', 'villain']) {
      const g = gloves[`${s}-${side}`];
      const want = s === style && grip ? grip : null;
      if (want && g.parent !== want) want.add(g);
      if (!want && g.parent) g.parent.remove(g);
    }
    if (side === 'left') hud.attachWrist(grip);
  }
}

// Comfort vignette: darkens the edges of your view at high speed (VR only).
const vignette = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false,
  uniforms: { uK: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform float uK; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(0.0, 0.0, 0.0, smoothstep(0.55 - uK * 0.3, 1.0 - uK * 0.25, d) * uK); }',
}));
vignette.position.set(0, 0, -0.25); vignette.scale.setScalar(0.45); vignette.renderOrder = 1000; vignette.frustumCulled = false;
camera.add(vignette);
let comfort = true;

// ------------------------------------------------------------- display modes
function setLook(mode) {
  const o = mode === 'vr' ? PS1_VR : PS1_FLAT;
  for (const m of materials) {
    m.uniforms.uSnapMode.value = o.snapMode;
    m.uniforms.uAffine.value = o.affine;
    if (o.snapGrid) m.uniforms.uSnapGrid.value = o.snapGrid;
  }
}
const DESK_H = 360;
function resize() {
  const w = innerWidth, h = innerHeight;
  const ih = Math.min(DESK_H, h), iw = Math.round((ih * w) / h);
  renderer.setSize(iw, ih, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  for (const m of materials) m.uniforms.uSnapRes.value.set(iw, ih);
}
addEventListener('resize', resize);
resize();

let started = false;
function start(mode) {
  started = true;
  $('menu').hidden = true;
  $('hud').hidden = mode !== 'desktop';
  sfx.start();
  setLook(mode);
  comfort = $('comfort').checked;
}
$('playDesk').addEventListener('click', () => { start('desktop'); canvas.requestPointerLock?.(); });
const vrBtn = $('playVR');
if (navigator.xr) {
  navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
    if (!ok) return;
    vrBtn.disabled = false; vrBtn.textContent = 'Enter VR';
    vrBtn.addEventListener('click', async () => {
      try {
        const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
        camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
        rig.rotation.y = input.yaw;
        await renderer.xr.setSession(session);
        start('vr');
        session.addEventListener('end', () => { started = false; $('menu').hidden = false; input.yaw = rig.rotation.y; rig.rotation.y = 0; camera.position.set(0, 1.65, 0); setLook('desktop'); });
      } catch (e) { $('vrNote').textContent = `Could not start VR: ${e.message}`; }
    });
  });
}

// ------------------------------------------------------------- loop
const clock = new THREE.Clock();
const perf = { update: 0 };
let reactT = 0;
const headPos = new THREE.Vector3();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t0 = performance.now();
  input.read(dt);
  if (started) {
    player.update(dt, input);
    world.update(player.pos.x, player.pos.z);
    refreshActive();
    powers.update(dt);
    physics.step(dt);
    projectileHits(dt);
    props.update(dt, player.pos);
    people.update(dt, player.pos);
    if ((reactT += dt) > 0.5) { reactT = 0; people.react(player.pos, rep, false); }
  } else {
    // Menu: slow turn on the spot.
    if (input.mode === 'desktop') { input.yaw += dt * 0.08; }
  }
  people.render(moodT);
  props.render();
  fx.update(dt);

  moodT += (rep - moodT) * Math.min(1, dt * 0.6);
  applyMood(materials, sky, moodT);
  for (const m of materials) { m.uniforms.uFogFar.value = Math.min(m.uniforms.uFogFar.value, 150); m.uniforms.uFogNear.value = Math.min(m.uniforms.uFogNear.value, 60); }
  handMat.uniforms.uNightGlow.value = 1;
  powers.setColor(moodT > 0.55 ? 0xff5a3a : 0x6ae0ff);
  updateFires();
  updateGloves();
  hud.update(dt, rep, input.mode);
  sfx.wind(started ? player.speed : 0);
  vignette.material.uniforms.uK.value = input.mode === 'vr' && comfort ? THREE.MathUtils.clamp((player.speed - 10) / 35, 0, 0.8) : 0;

  perf.update = perf.update * 0.9 + (performance.now() - t0) * 0.1;
  camera.getWorldPosition(headPos);
  sky.position.copy(headPos);
  sky.material.uniforms.uTime.value = clock.elapsedTime;
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(tick);

// Handle for automated tests and console tinkering.
window.game = { THREE, scene, renderer, camera, rig, world, physics, people, props, player, powers, input, hud, fx, start, perf,
  get rep() { return rep; }, set rep(v) { rep = v; }, get moodT() { return moodT; }, set moodT(v) { moodT = v; }, fires };
$('loading').hidden = true;
