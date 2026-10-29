// Movement: Superman-style flight (fly toward where your hands point),
// walking on the ground, super jump, dive, and the landing slam.
import * as THREE from '../../vendor/three.module.js';

const THRUST = 30;        // m/s² per hand at full trigger
const MAX_SPEED = 75;
const GRAVITY = -20;      // falling (not thrusting)
const HOVER_GRAVITY = -2; // while thrusting: almost weightless
const AIR_DRAG = 0.55;
const WALK = 4.5, RUN = 9;
const SLAM_SPEED = 15;    // landing faster than this makes a shockwave

export class Player {
  constructor(world, rig) {
    this.world = world; this.rig = rig;
    this.pos = rig.position;
    this.vel = new THREE.Vector3();
    this.grounded = false; this.flying = false; this.diving = false;
    this.turnLatch = false;
    this.onSlam = null; this.onLand = null;
    this._t = new THREE.Vector3(); this._b = new THREE.Vector3();
  }

  update(dt, input) {
    const L = input.hands.left, R = input.hands.right, head = input.head;

    // Snap turn on the right stick, pivoting around the head (VR only).
    if (input.mode === 'vr') {
      const sx = R.stick.x;
      if (Math.abs(sx) > 0.7 && !this.turnLatch) {
        this.turnLatch = true;
        const a = -Math.sign(sx) * Math.PI / 6;
        const hx = head.pos.x - this.pos.x, hz = head.pos.z - this.pos.z;
        const c = Math.cos(a), s = Math.sin(a);
        this.pos.x += hx - (hx * c + hz * s); this.pos.z += hz - (-hx * s + hz * c);
        this.rig.rotation.y += a;
      } else if (Math.abs(sx) < 0.3) this.turnLatch = false;
    }

    // Thrust: every hand on its trigger pushes you along where it points.
    const thrust = this._t.set(0, 0, 0);
    for (const h of [L, R]) if (h.connected && h.trigger > 0.08) thrust.addScaledVector(h.aimDir, h.trigger);
    this.flying = thrust.lengthSq() > 0.0001;
    this.thrust = thrust.length();

    if ((L.pressed.a || R.pressed.a) && this.grounded) { this.vel.y = 17; this.grounded = false; }
    if ((L.pressed.b || R.pressed.b) && !this.grounded) { this.vel.y = Math.min(this.vel.y, -45); this.diving = true; }

    if (this.flying) {
      this.vel.addScaledVector(thrust, THRUST * dt);
      this.vel.y += HOVER_GRAVITY * dt;
      if (thrust.y > 0.2) this.grounded = false;
    } else if (!this.grounded) this.vel.y += GRAVITY * dt;

    // Walking (and light air control) on the left stick, relative to the head.
    const st = L.stick;
    const fx = -Math.sin(head.yaw), fz = -Math.cos(head.yaw);
    const mx = fx * -st.y + -fz * st.x, mz = fz * -st.y + fx * st.x;
    if (this.grounded && !this.flying) {
      const sp = Math.hypot(st.x, st.y) > 0.95 ? RUN : WALK;
      const k = Math.min(1, dt * 12);
      this.vel.x += (mx * sp - this.vel.x) * k;
      this.vel.z += (mz * sp - this.vel.z) * k;
    } else {
      this.vel.x += mx * 8 * dt; this.vel.z += mz * 8 * dt;
      const d = Math.exp(-AIR_DRAG * dt);
      this.vel.multiplyScalar(d);
    }
    if (this.vel.length() > MAX_SPEED) this.vel.setLength(MAX_SPEED);

    const vyBefore = this.vel.y;
    this.pos.addScaledVector(this.vel, dt);

    // Collide feet and chest with the city.
    const before = this._b.copy(this.pos);
    const feet = this._t.copy(this.pos).setY(this.pos.y + 0.4);
    const h1 = this.world.collide(feet, 0.4);
    this.pos.set(feet.x, feet.y - 0.4, feet.z);
    const chest = this._t.copy(this.pos).setY(this.pos.y + 1.3);
    const h2 = this.world.collide(chest, 0.35);
    if (h2 === 2) { this.pos.x = chest.x; this.pos.z = chest.z; }
    if (h1 === 2 || h2 === 2) {
      if (Math.abs(this.pos.x - before.x) > 1e-4) this.vel.x *= -0.1;
      if (Math.abs(this.pos.z - before.z) > 1e-4) this.vel.z *= -0.1;
    }
    const wasGrounded = this.grounded;
    const surface = this.world.surfaceY(this.pos.x, this.pos.z, this.pos.y);
    this.grounded = this.pos.y <= surface + 0.05 && this.vel.y <= 0.5;
    if (this.grounded) {
      this.pos.y = Math.max(this.pos.y, surface);
      if (!wasGrounded) {
        if (vyBefore < -SLAM_SPEED || (this.diving && vyBefore < -8)) this.onSlam?.(this.pos.clone(), Math.max(-vyBefore, 25));
        this.onLand?.(-vyBefore);
      }
      if (this.vel.y < 0) this.vel.y = 0;
      this.diving = false;
    }
    this.speed = this.vel.length();
  }
}
