// Tiny verlet physics. Everything is particles + distance constraints:
// a car or crate is 8 corner particles braced into a box, a person is a
// 13-particle ragdoll. Collisions are particle-vs-world plus a cheap
// bounding-sphere push between bodies. Good enough to throw a bus.
import * as THREE from '../../vendor/three.module.js';

const STEP = 1 / 72;
const ITER = 4;
const GRAVITY = -12; // a bit heavier than real: thrown things read better in VR

export class Body {
  constructor(kind, mass) {
    this.kind = kind; this.mass = mass;
    this.p = [];      // [x, y, z, px, py, pz, r, invMass]
    this.c = [];      // [i, j, rest, stiffness]
    this.center = new THREE.Vector3();
    this.radius = 1;
    this.asleep = false; this.still = 0;
    this.impact = 0;  // fastest world impact since last read
    this.grab = null; // { target: Vector3, idx: particle index or -1 (all), k }
    this.owner = null;
    this.drag = 0.999;
  }
  add(x, y, z, r, invMass = 1) { this.p.push([x, y, z, x, y, z, r, invMass]); return this.p.length - 1; }
  link(i, j, stiff = 1) {
    const a = this.p[i], b = this.p[j];
    this.c.push([i, j, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), stiff]);
  }
  updateBounds() {
    let x = 0, y = 0, z = 0;
    for (const q of this.p) { x += q[0]; y += q[1]; z += q[2]; }
    const n = this.p.length;
    this.center.set(x / n, y / n, z / n);
    let r = 0;
    for (const q of this.p) r = Math.max(r, Math.hypot(q[0] - this.center.x, q[1] - this.center.y, q[2] - this.center.z) + q[6]);
    this.radius = r;
  }
  velocity(out = new THREE.Vector3()) {
    out.set(0, 0, 0);
    for (const q of this.p) { out.x += q[0] - q[3]; out.y += q[1] - q[4]; out.z += q[2] - q[5]; }
    return out.multiplyScalar(1 / (this.p.length * STEP));
  }
  // Adds a velocity change (m/s) to every particle, or to particle idx.
  push(v, idx = -1) {
    this.wake();
    const list = idx >= 0 ? [this.p[idx]] : this.p;
    for (const q of list) { q[3] -= v.x * STEP; q[4] -= v.y * STEP; q[5] -= v.z * STEP; }
  }
  setVelocity(v) { this.wake(); for (const q of this.p) { q[3] = q[0] - v.x * STEP; q[4] = q[1] - v.y * STEP; q[5] = q[2] - v.z * STEP; } }
  wake() { this.asleep = false; this.still = 0; }

  // Orientation of a box body from its corner particles.
  boxBasis(m) {
    const P = this.p, ax = new THREE.Vector3(), ay = new THREE.Vector3(), az = new THREE.Vector3();
    for (let k = 0; k < 4; k++) {
      // corner index bits: x = 1, y = 2, z = 4
      const xa = [0, 2, 4, 6][k], ya = [0, 1, 4, 5][k], za = [0, 1, 2, 3][k];
      ax.x += P[xa + 1][0] - P[xa][0]; ax.y += P[xa + 1][1] - P[xa][1]; ax.z += P[xa + 1][2] - P[xa][2];
      ay.x += P[ya + 2][0] - P[ya][0]; ay.y += P[ya + 2][1] - P[ya][1]; ay.z += P[ya + 2][2] - P[ya][2];
      az.x += P[za + 4][0] - P[za][0]; az.y += P[za + 4][1] - P[za][1]; az.z += P[za + 4][2] - P[za][2];
    }
    ax.normalize(); az.crossVectors(ax, ay).normalize(); ay.crossVectors(az, ax);
    return m.makeBasis(ax, ay, az);
  }
}

export function makeBox(center, size, yaw, mass) {
  const [w, h, l] = size;
  const b = new Body('box', mass);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let i = 0; i < 8; i++) {
    const lx = (i & 1 ? 0.5 : -0.5) * w, ly = (i & 2 ? 0.5 : -0.5) * h, lz = (i & 4 ? 0.5 : -0.5) * l;
    b.add(center.x + lx * c + lz * s, center.y + ly, center.z - lx * s + lz * c, 0.05);
  }
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) b.link(i, j);
  b.size = size;
  b.updateBounds();
  return b;
}

// Ragdoll joint layout (character-local, feet at origin, facing +z, +x = left).
export const RAG = { hipL: 0, hipR: 1, shL: 2, shR: 3, head: 4, elL: 5, elR: 6, haL: 7, haR: 8, knL: 9, knR: 10, ftL: 11, ftR: 12 };
export const RAG_REST = [
  [0.085, 0.83, 0], [-0.085, 0.83, 0], [0.27, 1.47, 0], [-0.27, 1.47, 0], [0, 1.69, 0.02],
  [0.27, 1.17, 0], [-0.27, 1.17, 0], [0.27, 0.81, 0.02], [-0.27, 0.81, 0.02],
  [0.085, 0.41, 0], [-0.085, 0.41, 0], [0.085, 0.02, 0.04], [-0.085, 0.02, 0.04],
];

export function makeRagdoll(points, vel) {
  const b = new Body('ragdoll', 75);
  points.forEach(([x, y, z], i) => b.add(x, y, z, i === RAG.head ? 0.13 : 0.08));
  const L = (i, j, s = 1) => b.link(i, j, s);
  const R = RAG;
  L(R.hipL, R.hipR); L(R.shL, R.shR); L(R.hipL, R.shL); L(R.hipR, R.shR); L(R.hipL, R.shR); L(R.hipR, R.shL);
  L(R.head, R.shL); L(R.head, R.shR); L(R.head, R.hipL, 0.5); L(R.head, R.hipR, 0.5);
  L(R.shL, R.elL); L(R.elL, R.haL); L(R.shR, R.elR); L(R.elR, R.haR);
  L(R.hipL, R.knL); L(R.knL, R.ftL); L(R.hipR, R.knR); L(R.knR, R.ftR);
  // Soft limits so knees and elbows don't fold through the body.
  L(R.hipL, R.ftL, 0.12); L(R.hipR, R.ftR, 0.12); L(R.shL, R.haL, 0.06); L(R.shR, R.haR, 0.06);
  b.drag = 0.995;
  if (vel) b.setVelocity(vel);
  b.updateBounds();
  return b;
}

export class Physics {
  constructor(world) {
    this.world = world;
    this.bodies = [];
    this.acc = 0;
    this._t = new THREE.Vector3();
    this.onImpact = null; // (body, speed, point) for sounds and damage
  }
  add(b) { this.bodies.push(b); return b; }
  remove(b) { const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1); }

  step(dt) {
    this.acc = Math.min(this.acc + dt, STEP * 4);
    while (this.acc >= STEP) { this._substep(); this.acc -= STEP; }
  }

  _substep() {
    const g = GRAVITY * STEP * STEP, world = this.world;
    const active = this.bodies.filter((b) => !b.asleep);
    for (const b of active) {
      const d = b.drag;
      for (const q of b.p) {
        const vx = (q[0] - q[3]) * d, vy = (q[1] - q[4]) * d, vz = (q[2] - q[5]) * d;
        q[3] = q[0]; q[4] = q[1]; q[5] = q[2];
        q[0] += vx; q[1] += vy + g; q[2] += vz;
      }
      if (b.grab) this._applyGrab(b);
    }
    for (let it = 0; it < ITER; it++) {
      for (const b of active) {
        for (const [i, j, rest, s] of b.c) {
          const a = b.p[i], c = b.p[j];
          const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          // Soft limits (s < 1) only push apart, never pull together.
          if (s < 1 && len > rest * 0.6) continue;
          const k = ((len - (s < 1 ? rest * 0.6 : rest)) / len) * 0.5;
          a[0] += dx * k; a[1] += dy * k; a[2] += dz * k;
          c[0] -= dx * k; c[1] -= dy * k; c[2] -= dz * k;
        }
      }
      if (it === ITER - 1 || it === 1) for (const b of active) this._collideWorld(b, it === ITER - 1);
    }
    this._collideBodies(active);
    for (const b of active) {
      b.updateBounds();
      const v = b.velocity(this._t).length();
      if (v < 0.25 && !b.grab) { b.still += STEP; if (b.still > 1.2) b.asleep = true; } else b.still = 0;
    }
  }

  _applyGrab(b) {
    // Critically damped pull toward the target: the held object lags a little
    // behind your hand, which sells its weight.
    const { target, idx, k } = b.grab;
    const list = idx >= 0 ? [b.p[idx]] : b.p;
    b.updateBounds();
    const anchor = idx >= 0 ? new THREE.Vector3(b.p[idx][0], b.p[idx][1], b.p[idx][2]) : b.center;
    const ox = target.x - anchor.x, oy = target.y - anchor.y, oz = target.z - anchor.z;
    for (const q of list) {
      const vx = q[0] - q[3], vy = q[1] - q[4], vz = q[2] - q[5];
      q[0] += ox * k - vx * 0.25; q[1] += oy * k - vy * 0.25 - GRAVITY * STEP * STEP; q[2] += oz * k - vz * 0.25;
    }
  }

  _collideWorld(b, report) {
    let hard = 0;
    const tmp = this._p ?? (this._p = new THREE.Vector3());
    for (const q of b.p) {
      tmp.set(q[0], q[1], q[2]);
      const hit = this.world.collide(tmp, q[6]);
      if (!hit) continue;
      const vx = q[0] - q[3], vy = q[1] - q[4], vz = q[2] - q[5];
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz) / STEP;
      hard = Math.max(hard, speed);
      q[0] = tmp.x; q[1] = tmp.y; q[2] = tmp.z;
      // Friction: bleed tangential velocity on contact.
      const f = hit === 1 ? 0.25 : 0.4;
      q[3] = q[0] - vx * (1 - f); q[5] = q[2] - vz * (1 - f);
      if (hit === 1) q[4] = q[1] + Math.min(0, vy) * 0.2; // small bounce
    }
    if (report && hard > 6) {
      b.impact = Math.max(b.impact, hard);
      this.onImpact?.(b, hard);
    }
  }

  _collideBodies(active) {
    const all = this.bodies;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], c = all[j];
      if (a.asleep && c.asleep) continue;
      const dx = c.center.x - a.center.x, dy = c.center.y - a.center.y, dz = c.center.z - a.center.z;
      const ra = a.kind === 'box' ? Math.min(a.radius, Math.max(...a.size) * 0.45) : 0.35;
      const rc = c.kind === 'box' ? Math.min(c.radius, Math.max(...c.size) * 0.45) : 0.35;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz), min = ra + rc;
      if (d >= min || d < 1e-5) continue;
      const rel = new THREE.Vector3().subVectors(c.velocity(), a.velocity()).length();
      if (rel > 4) { a.wake(); c.wake(); this.onBodyHit?.(a, c, rel); }
      const pen = (min - d) / d, wa = c.mass / (a.mass + c.mass), wc = 1 - wa;
      for (const q of a.p) { q[0] -= dx * pen * wa; q[1] -= dy * pen * wa * 0.5; q[2] -= dz * pen * wa; }
      for (const q of c.p) { q[0] += dx * pen * wc; q[1] += dy * pen * wc * 0.5; q[2] += dz * pen * wc; }
      a.updateBounds(); c.updateBounds();
    }
  }
}
