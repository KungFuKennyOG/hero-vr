// One input shape for both modes. Game code only reads `hands.left/right`
// and `head`, so VR and desktop share every line of gameplay logic.
//
// Quest controllers: trigger = fly toward where the hand points,
// grip = telekinesis, left stick = walk, right stick = turn / push-pull,
// A/X = super jump, B/Y = dive (slam when you hit the ground).
import * as THREE from '../../vendor/three.module.js';

function makeHand(side) {
  return {
    side, connected: false, source: null,
    aimPos: new THREE.Vector3(), aimDir: new THREE.Vector3(0, 0, -1),
    localPos: new THREE.Vector3(), localVel: new THREE.Vector3(), vel: new THREE.Vector3(),
    trigger: 0, grip: 0, stick: { x: 0, y: 0 }, a: false, b: false,
    pressed: {}, released: {}, prev: {}, haptic: null,
  };
}

export class Input {
  constructor(renderer, rig, camera, dom) {
    this.renderer = renderer; this.rig = rig; this.camera = camera; this.dom = dom;
    this.mode = 'desktop';
    this.hands = { left: makeHand('left'), right: makeHand('right') };
    this.head = { pos: new THREE.Vector3(), dir: new THREE.Vector3(), yaw: 0 };
    this.controllers = []; this.grips = [];
    for (let i = 0; i < 2; i++) {
      const c = renderer.xr.getController(i), g = renderer.xr.getControllerGrip(i);
      c.addEventListener('connected', (e) => { c.userData.source = e.data; g.userData.source = e.data; });
      c.addEventListener('disconnected', () => { c.userData.source = null; g.userData.source = null; });
      rig.add(c); rig.add(g);
      this.controllers.push(c); this.grips.push(g);
    }
    // Desktop state.
    this.keys = new Set(); this.mouse = { dx: 0, dy: 0, lmb: false, rmb: false, wheel: 0 };
    this.yaw = 0; this.pitch = 0;
    addEventListener('keydown', (e) => { this.keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    dom.addEventListener('mousedown', (e) => {
      if (this.mode !== 'desktop') return;
      if (document.pointerLockElement !== dom) { dom.requestPointerLock?.(); return; }
      if (e.button === 0) this.mouse.lmb = true; if (e.button === 2) this.mouse.rmb = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.lmb = false; if (e.button === 2) this.mouse.rmb = false; });
    addEventListener('mousemove', (e) => { if (document.pointerLockElement === dom) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    dom.addEventListener('wheel', (e) => { this.mouse.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    this.virtual = null; // scripted input for automated tests
  }

  // Grip-space object for attaching the glove mesh.
  gripFor(side) {
    for (const g of this.grips) if (g.userData.source?.handedness === side) return g;
    return null;
  }

  read(dt) {
    if (this.virtual) return this._readVirtual(dt);
    if (this.renderer.xr.isPresenting) { this.mode = 'vr'; this._readXR(dt); }
    else { this.mode = 'desktop'; this._readDesktop(dt); }
    this._edges();
  }

  _edges() {
    for (const h of Object.values(this.hands)) {
      const now = { trigger: h.trigger > 0.5, grip: h.grip > 0.5, a: h.a, b: h.b };
      for (const k in now) { h.pressed[k] = now[k] && !h.prev[k]; h.released[k] = !now[k] && h.prev[k]; }
      h.prev = now;
    }
  }

  _track(h, localPos, dt) {
    // Hand velocity relative to the rig (so your own flight speed isn't
    // counted), rotated into world space. Smoothed for stable throws.
    if (h.tracked && dt > 0) {
      const v = new THREE.Vector3().subVectors(localPos, h.localPos).divideScalar(dt);
      h.localVel.lerp(v, 0.5);
    }
    h.tracked = true;
    h.localPos.copy(localPos);
    h.vel.copy(h.localVel).applyQuaternion(this.rig.quaternion);
  }

  _readXR(dt) {
    const cam = this.renderer.xr.getCamera();
    cam.getWorldPosition(this.head.pos);
    cam.getWorldDirection(this.head.dir);
    this.head.yaw = Math.atan2(-this.head.dir.x, -this.head.dir.z);
    const seen = new Set();
    for (const c of this.controllers) {
      const src = c.userData.source;
      if (!src || !src.gamepad || (src.handedness !== 'left' && src.handedness !== 'right')) continue;
      const h = this.hands[src.handedness];
      const gp = src.gamepad, B = gp.buttons;
      c.getWorldPosition(h.aimPos);
      c.getWorldDirection(h.aimDir).negate(); // Object3D faces +z; controllers point down -z
      this._track(h, c.position, dt);
      h.connected = true; h.source = src;
      h.trigger = B[0]?.value ?? 0; h.grip = B[1]?.value ?? 0;
      h.stick.x = gp.axes[2] ?? 0; h.stick.y = gp.axes[3] ?? 0;
      h.a = !!B[4]?.pressed; h.b = !!B[5]?.pressed;
      h.haptic = gp.hapticActuators?.[0] ?? null;
      seen.add(h);
    }
    for (const h of Object.values(this.hands)) if (!seen.has(h)) { h.connected = false; h.tracked = false; h.trigger = h.grip = 0; }
  }

  _readDesktop(dt) {
    const m = this.mouse;
    this.yaw -= m.dx * 0.0022; this.pitch = THREE.MathUtils.clamp(this.pitch - m.dy * 0.0022, -1.5, 1.5);
    m.dx = m.dy = 0;
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
    this.camera.getWorldPosition(this.head.pos);
    this.camera.getWorldDirection(this.head.dir);
    this.head.yaw = this.yaw;
    const k = this.keys;
    const L = this.hands.left, R = this.hands.right;
    L.connected = R.connected = true;
    L.stick.x = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    L.stick.y = (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0);
    // The virtual right hand sits just below the view and aims at the crosshair.
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(this.camera.quaternion);
    R.aimDir.copy(this.head.dir);
    const local = new THREE.Vector3().copy(this.head.dir).multiplyScalar(0.35).addScaledVector(right, 0.18).addScaledVector(down, 0.2);
    R.aimPos.copy(this.head.pos).add(local);
    L.aimDir.copy(this.head.dir); L.aimPos.copy(R.aimPos);
    this._track(R, local, dt);
    R.trigger = k.has('Space') ? 1 : 0; L.trigger = k.has('ShiftLeft') && k.has('Space') ? 1 : 0;
    R.grip = m.rmb ? 1 : 0; L.grip = 0;
    R.stick.x = 0; R.stick.y = Math.sign(m.wheel) * 0.6; m.wheel *= 0.5; if (Math.abs(m.wheel) < 1) m.wheel = 0;
    R.a = k.has('KeyE'); R.b = k.has('KeyC') || k.has('ControlLeft');
    L.a = L.b = false;
    this.desktopThrow = m.lmb; // left click while holding: hurl it
  }

  _readVirtual(dt) {
    // Tests drive this with plain objects shaped like real controller data.
    const v = this.virtual;
    this.mode = v.mode ?? 'vr';
    this.head.pos.copy(v.head.pos); this.head.dir.copy(v.head.dir).normalize();
    this.head.yaw = Math.atan2(-this.head.dir.x, -this.head.dir.z);
    for (const side of ['left', 'right']) {
      const h = this.hands[side], s = v[side];
      if (!s) { h.connected = false; continue; }
      h.connected = true;
      h.aimPos.copy(s.pos); h.aimDir.copy(s.dir).normalize();
      this._track(h, s.local ?? s.pos, dt);
      h.trigger = s.trigger ?? 0; h.grip = s.grip ?? 0;
      h.stick.x = s.stick?.x ?? 0; h.stick.y = s.stick?.y ?? 0; h.a = !!s.a; h.b = !!s.b;
    }
    this._edges();
  }

  pulse(side, strength = 0.5, ms = 40) {
    const h = this.hands[side];
    try { h.haptic?.pulse?.(strength, ms); } catch { /* not supported */ }
  }
}
