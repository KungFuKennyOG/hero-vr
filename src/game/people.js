// Pedestrians, cops and thugs. Rendering is instanced per body part: every
// person of a variant shares 11 InstancedMeshes, so the whole population costs
// a fixed ~55 draw calls however many people there are.
// Alive people are posed with simple FK; knocked-down people are verlet ragdolls.
import * as THREE from '../../vendor/three.module.js';
import { buildPersonParts } from '../art/actors.js';
import { makeRagdoll, RAG, RAG_REST } from './physics.js';
import { seeded } from '../art/builder.js';

const VARIANTS = [
  { kind: 'civilian', seed: 3, team: 'civ' },
  { kind: 'civilian', seed: 8, team: 'civ' },
  { kind: 'civilian', seed: 21, team: 'civ' },
  { kind: 'cop', seed: 5, team: 'cop' },
  { kind: 'thug', seed: 6, team: 'thug' },
];
const MAX_PER_VARIANT = 36;
const SHIRTS = [0xc8483a, 0x3a6ab8, 0xe8d8b0, 0x4a8a5a, 0xd8a030, 0x8a5aa8, 0xf0f0f0, 0x3a3a3a, 0x2a8a8a, 0xb85a8a];
const HOODS = [0x3a3a3c, 0x7a1e1e, 0x2e4a2e, 0x5a5a6a, 0x8a6a2a];
const KO_SPEED = 8; // hits harder than this put someone down for good

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const _X = new THREE.Vector3(), _Y = new THREE.Vector3(), _Z = new THREE.Vector3();

export class People {
  constructor(scene, atlas, material, physics, world) {
    this.scene = scene; this.physics = physics; this.world = world;
    this.list = [];
    this.groups = new Map(); // mugging scenes: id -> { thugs, victim, done }
    this.onKO = null; this.onRescue = null;
    this.variants = VARIANTS.map((v) => {
      const parts = buildPersonParts(atlas, v.kind, v.seed);
      const meshes = parts.map((p) => {
        const im = new THREE.InstancedMesh(p.geometry, material, MAX_PER_VARIANT);
        im.frustumCulled = false; im.count = 0;
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < MAX_PER_VARIANT; i++) im.setColorAt(i, new THREE.Color(0xffffff));
        scene.add(im);
        return im;
      });
      const index = Object.fromEntries(parts.map((p, i) => [p.name, i]));
      return { ...v, parts, meshes, index, used: new Array(MAX_PER_VARIANT).fill(null) };
    });
    this.rng = seeded(99);
  }

  // ------------------------------------------------------------- spawning
  spawn(vi, x, z, opts = {}) {
    const V = this.variants[vi];
    const slot = V.used.indexOf(null);
    if (slot < 0) return null;
    const r = this.rng;
    const p = {
      v: vi, slot, team: V.team, pos: new THREE.Vector3(x, this.world.groundY(x, z), z), yaw: opts.yaw ?? r() * Math.PI * 2,
      state: opts.state ?? 'idle', phase: r() * 10, timer: 0, body: null, ko: false, held: false,
      path: opts.path ?? null, chunk: opts.chunk ?? null, group: opts.group ?? null, alive: true,
    };
    V.used[slot] = p;
    const tint = V.team === 'civ' ? r.pick(SHIRTS) : V.team === 'thug' ? r.pick(HOODS) : 0xffffff;
    for (const im of V.meshes) { im.setColorAt(slot, _c.set(tint)); im.instanceColor.needsUpdate = true; }
    this.list.push(p);
    return p;
  }
  despawn(p) {
    if (p.body) this.physics.remove(p.body);
    const V = this.variants[p.v];
    V.used[p.slot] = null;
    for (const im of V.meshes) { im.setMatrixAt(p.slot, _zero); im.instanceMatrix.needsUpdate = true; }
    p.alive = false;
    this.list.splice(this.list.indexOf(p), 1);
  }

  // Fills a chunk with life: walkers on the sidewalk loop, and sometimes a
  // mugging in progress (hero bait) or a pair of cops (villain bait).
  populate(chunk, scene = {}) {
    const r = seeded(chunk.cx * 7919 + chunk.cz * 104729 + 1);
    const [ox, oz] = chunk.origin, mid = 24;
    const made = [];
    for (let i = 0; i < 6; i++) {
      const path = { ox, oz, t: r(), dir: r.chance(0.5) ? 1 : -1, off: r.range(-1.3, 1.3), speed: r.range(1.1, 1.7) };
      const p = this.spawn(r.int(0, 2), 0, 0, { state: 'walk', path, chunk });
      if (p) { this._pathPos(p); made.push(p); }
    }
    if (scene.mugging) {
      const sx = r.chance(0.5) ? 1 : -1, sz = r.chance(0.5) ? 1 : -1;
      const cx = ox + sx * mid, cz = oz + sz * mid;
      const victim = this.spawn(r.int(0, 2), cx, cz, { state: 'cower', chunk, group: chunk });
      const g = { thugs: [], victim, done: false, chunk };
      for (let i = 0; i < r.int(2, 3); i++) {
        const a = (i / 3) * Math.PI * 1.4 - 0.7 + Math.atan2(-sx, -sz);
        const t = this.spawn(4, cx + Math.sin(a) * 1.8, cz + Math.cos(a) * 1.8, { state: 'menace', chunk, group: chunk });
        if (t) { t.yaw = Math.atan2(cx - t.pos.x, cz - t.pos.z); g.thugs.push(t); made.push(t); }
      }
      if (victim) { victim.yaw = Math.atan2(-sx, -sz) + Math.PI; made.push(victim); }
      this.groups.set(chunk, g);
    }
    if (scene.cops) {
      const [x, z, yaw] = scene.cops;
      for (const dx of [-1.6, 1.6]) {
        const c = this.spawn(3, x + Math.cos(yaw) * dx + Math.sin(yaw) * 2.6, z - Math.sin(yaw) * dx + Math.cos(yaw) * 2.6, { state: 'guard', chunk });
        if (c) { c.yaw = yaw; made.push(c); }
      }
    }
    return made;
  }
  clearChunk(chunk, keepNear) {
    for (const p of [...this.list]) {
      if (p.chunk !== chunk || p.held) continue;
      if (p.body && keepNear && p.pos.distanceTo(keepNear) < 60) { p.chunk = null; continue; }
      this.despawn(p);
    }
    this.groups.delete(chunk);
  }

  _pathPos(p) {
    const w = p.path, mid = 24;
    const t = ((w.t % 1) + 1) % 1, side = Math.floor(t * 4), f = t * 4 - side;
    const a = -mid + f * mid * 2, o = mid + w.off;
    const pt = [[a, o], [o, -a], [-a, -o], [-o, a]][side];
    p.pos.set(w.ox + pt[0], 0.15, w.oz + pt[1]);
    p.yaw = [Math.PI / 2, Math.PI, -Math.PI / 2, 0][side] + (w.dir < 0 ? Math.PI : 0);
  }

  // ------------------------------------------------------------- reactions
  // Turns a standing person into a ragdoll with a velocity kick.
  knock(p, vel, cause = 'hit') {
    if (!p.alive) return;
    if (!p.body) {
      _m.compose(p.pos, _q.setFromAxisAngle(_Y.set(0, 1, 0), p.yaw), _s);
      const pts = RAG_REST.map(([x, y, z]) => _v.set(x, y, z).applyMatrix4(_m).toArray());
      p.body = this.physics.add(makeRagdoll(pts, vel));
      p.body.owner = p;
      p.state = 'ragdoll';
    } else p.body.push(vel);
    const speed = vel.length();
    if (speed >= KO_SPEED) this._ko(p, cause);
  }
  _ko(p, cause) {
    if (p.ko) return;
    p.ko = true;
    this.onKO?.(p, cause);
    const g = p.group && this.groups.get(p.group);
    if (g && !g.done && p.team === 'thug' && g.thugs.every((t) => t.ko)) {
      g.done = true;
      if (g.victim && !g.victim.ko && g.victim.alive && !g.victim.body) { g.victim.state = 'cheer'; g.victim.timer = 6; }
      this.onRescue?.(g);
    }
  }
  // Radial blast (ground slam). Strength in m/s at the centre.
  blast(c, radius, strength) {
    for (const p of this.list) {
      const at = this.center(p);
      const d = at.distanceTo(c);
      if (d > radius) continue;
      const k = strength * (1 - d / radius);
      _w.subVectors(at, c).setY(0).normalize().multiplyScalar(k).add(_v.set(0, k * 0.55, 0));
      this.knock(p, _w.clone(), 'slam');
    }
  }
  // Something fast passing through: thrown car, flying player.
  hitTest(c, radius, vel, cause, skipBody) {
    let n = 0;
    for (const p of this.list) {
      if (p.body === skipBody || p.held) continue;
      if (p.body && p.ko) continue;
      const at = this.center(p);
      if (at.distanceTo(c) < radius + 0.4) { this.knock(p, vel.clone().multiplyScalar(0.8).add(_v.set(0, 2.5, 0)), cause); n++; }
    }
    return n;
  }
  // Nearby civilians react to the player: cheer the hero, run from the villain.
  react(playerPos, rep, landed) {
    for (const p of this.list) {
      if (p.body || p.team !== 'civ' || p.state === 'cower') continue;
      const d = p.pos.distanceTo(playerPos);
      if (rep > 0.55 && d < 18 && p.state !== 'flee') { p.state = 'flee'; p.timer = 8; p.path = null; }
      else if (landed && rep < 0.4 && d < 12 && p.state === 'walk') { p.state = 'cheer'; p.timer = 3.5; p.yaw = Math.atan2(playerPos.x - p.pos.x, playerPos.z - p.pos.z); }
    }
  }
  scare(c, radius) {
    for (const p of this.list) if (!p.body && p.team === 'civ' && p.state !== 'cower' && p.pos.distanceTo(c) < radius) { p.state = 'flee'; p.timer = 8; p.path = null; }
  }

  center(p) { return p.body ? p.body.center : _tmpC.copy(p.pos).setY(p.pos.y + 1.0); }
  grabbable() { return this.list.filter((p) => !p.held); }

  // ------------------------------------------------------------- per frame
  update(dt, playerPos) {
    for (const p of this.list) {
      p.phase += dt;
      if (p.body) {
        const a = p.body.p[RAG.hipL], b = p.body.p[RAG.hipR];
        p.pos.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
        // Gentle drops get back up; real hits stay down.
        if (!p.ko && !p.held && p.body.impact >= KO_SPEED) this._ko(p, 'impact');
        if (!p.ko && !p.held && p.body.asleep) {
          this.physics.remove(p.body); p.body = null;
          p.pos.y = this.world.surfaceY(p.pos.x, p.pos.z, p.pos.y);
          p.state = 'flee'; p.timer = 6; p.path = null;
          p.yaw = Math.atan2(p.pos.x - playerPos.x, p.pos.z - playerPos.z);
        }
        continue;
      }
      if (p.state === 'walk' && p.path) {
        p.path.t += (p.path.dir * p.path.speed * dt) / 192;
        this._pathPos(p);
      } else if (p.state === 'flee') {
        p.timer -= dt;
        const away = Math.atan2(p.pos.x - playerPos.x, p.pos.z - playerPos.z);
        p.yaw += Math.atan2(Math.sin(away - p.yaw), Math.cos(away - p.yaw)) * Math.min(1, dt * 3);
        p.pos.x += Math.sin(p.yaw) * 4.5 * dt; p.pos.z += Math.cos(p.yaw) * 4.5 * dt;
        this.world.collide(_w.copy(p.pos).setY(p.pos.y + 0.5), 0.35);
        p.pos.x = _w.x; p.pos.z = _w.z; p.pos.y = this.world.groundY(p.pos.x, p.pos.z);
        if (p.timer < 0) { p.state = 'cower'; }
      } else if (p.state === 'cheer') {
        p.timer -= dt;
        if (p.timer < 0) p.state = p.path ? 'walk' : 'idle';
      } else if (p.state === 'guard') {
        p.yaw += Math.atan2(Math.sin(Math.atan2(playerPos.x - p.pos.x, playerPos.z - p.pos.z) - p.yaw), 1) * dt * 0.8;
      }
    }
  }

  // Writes every person's part matrices into the instanced meshes.
  render(rep) {
    for (const V of this.variants) {
      let top = 0;
      V.used.forEach((p, i) => { if (p) top = i + 1; });
      for (const im of V.meshes) im.count = top;
    }
    for (const p of this.list) {
      const V = this.variants[p.v];
      if (p.body) this._poseRagdoll(V, p);
      else this._poseFK(V, p, rep);
    }
    for (const V of this.variants) for (const im of V.meshes) im.instanceMatrix.needsUpdate = true;
  }

  _poseFK(V, p, rep) {
    const t = p.phase, A = _anim;
    for (const k in A) A[k][0] = A[k][1] = A[k][2] = 0;
    const swing = (ph, amt) => {
      const s = Math.sin(ph);
      A.legUR[0] = s * amt; A.legUL[0] = -s * amt;
      A.legLR[0] = Math.max(0, -s) * amt * 1.1; A.legLL[0] = Math.max(0, s) * amt * 1.1;
      A.armUR[0] = -s * amt * 0.8; A.armUL[0] = s * amt * 0.8;
      A.armLR[0] = -0.35; A.armLL[0] = -0.35;
    };
    let bob = 0;
    switch (p.state) {
      case 'walk': swing(t * 6.5, 0.55); bob = Math.abs(Math.sin(t * 6.5)) * 0.03; break;
      case 'flee': swing(t * 11, 0.95); A.armUR[0] = -1.1 + Math.sin(t * 11) * 0.8; A.armUL[0] = -1.1 - Math.sin(t * 11) * 0.8; A.torso[0] = 0.25; bob = Math.abs(Math.sin(t * 11)) * 0.06; break;
      case 'cheer': A.armUR[0] = -2.9 + Math.sin(t * 9) * 0.25; A.armUL[0] = -2.9 - Math.sin(t * 9) * 0.25; A.armUR[2] = 0.2; A.armUL[2] = -0.2; bob = Math.abs(Math.sin(t * 7)) * 0.12; break;
      case 'cower': A.armUR[0] = -2.6; A.armUL[0] = -2.6; A.armLR[0] = -1.2; A.armLL[0] = -1.2; A.torso[0] = 0.3; A.head[0] = 0.3; A.legUR[0] = -0.5; A.legUL[0] = -0.5; A.legLR[0] = 0.9; A.legLL[0] = 0.9; bob = -0.18; break;
      case 'menace': A.armUR[0] = -1.35 + Math.sin(t * 3) * 0.1; A.armLR[0] = -0.3; A.armUL[0] = -0.5 + Math.sin(t * 2) * 0.2; A.torso[1] = Math.sin(t * 1.3) * 0.2; A.head[1] = Math.sin(t * 0.9) * 0.3; break;
      case 'guard': A.armUR[0] = rep > 0.5 ? -1.45 : -0.15; A.armUL[0] = rep > 0.5 ? -1.3 : -0.1; A.armLR[0] = -0.1; A.head[1] = Math.sin(t * 0.7) * 0.3; break;
      default: A.head[1] = Math.sin(t * 0.6) * 0.4; A.armUR[0] = 0.05; A.armUL[0] = 0.05;
    }
    const world = _mats;
    _m.compose(_v.set(p.pos.x, p.pos.y + bob, p.pos.z), _q.setFromAxisAngle(_Y.set(0, 1, 0), p.yaw), _s);
    V.parts.forEach((part, i) => {
      const parent = part.parent ? world[V.index[part.parent]] : _m;
      const a = A[part.name];
      _local.compose(_v.fromArray(part.pivot), _q.setFromEuler(_e.set(a[0], a[1], a[2], 'YXZ')), _s);
      world[i].multiplyMatrices(parent, _local);
      V.meshes[i].setMatrixAt(p.slot, world[i]);
    });
  }

  _poseRagdoll(V, p) {
    const P = p.body.p, R = RAG;
    const pt = (i) => _pts[i].set(P[i][0], P[i][1], P[i][2]);
    for (let i = 0; i < 13; i++) pt(i);
    const hipMid = _a.addVectors(_pts[R.hipL], _pts[R.hipR]).multiplyScalar(0.5);
    const shMid = _b.addVectors(_pts[R.shL], _pts[R.shR]).multiplyScalar(0.5);
    const up = _Y.subVectors(shMid, hipMid).normalize();
    const left = _X.subVectors(_pts[R.shL], _pts[R.shR]).add(_w.subVectors(_pts[R.hipL], _pts[R.hipR])).normalize();
    const set = (name, pos, yDir) => {
      const i = V.index[name];
      _Z.crossVectors(left, yDir).normalize();
      const x = _tx.crossVectors(yDir, _Z);
      _mats[i].makeBasis(x, yDir, _Z).setPosition(pos);
      V.meshes[i].setMatrixAt(p.slot, _mats[i]);
    };
    const pelvis = _c3.copy(hipMid).addScaledVector(up, 0.12);
    set('pelvis', pelvis, up);
    set('torso', _d.copy(pelvis).addScaledVector(up, 0.06), up);
    const neck = _f.copy(pelvis).addScaledVector(up, 0.56);
    set('head', neck, _g.subVectors(_pts[R.head], neck).normalize());
    const limb = (name, a, b) => set(name, _pts[a], _g.subVectors(_pts[a], _pts[b]).normalize());
    limb('armUR', R.shR, R.elR); limb('armLR', R.elR, R.haR);
    limb('armUL', R.shL, R.elL); limb('armLL', R.elL, R.haL);
    limb('legUR', R.hipR, R.knR); limb('legLR', R.knR, R.ftR);
    limb('legUL', R.hipL, R.knL); limb('legLL', R.knL, R.ftL);
  }
}

const _c = new THREE.Color();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _tmpC = new THREE.Vector3();
const _local = new THREE.Matrix4();
const _mats = Array.from({ length: 11 }, () => new THREE.Matrix4());
const _pts = Array.from({ length: 13 }, () => new THREE.Vector3());
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c3 = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3(), _g = new THREE.Vector3(), _tx = new THREE.Vector3();
const _anim = Object.fromEntries(['pelvis', 'torso', 'head', 'armUR', 'armLR', 'armUL', 'armLL', 'legUR', 'legLR', 'legUL', 'legLL'].map((n) => [n, [0, 0, 0]]));
