// Telekinesis, one per hand: point, grip to grab, move your hand to drag,
// let go mid-swing to throw. People dangle by the neck; cars and buses lag
// behind your hand according to their weight.
import * as THREE from '../../vendor/three.module.js';
import { RAG } from './physics.js';

const PICK_CONE = Math.cos(THREE.MathUtils.degToRad(13));
const MAX_RANGE = 85;
const HAND_GAIN = 2.5; // extra reach: hand movement is amplified at the object

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class Powers {
  constructor(scene, ctx) {
    this.ctx = ctx; // { input, people, props, world, rig, sfx }
    this.state = {};
    for (const side of ['left', 'right']) {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.03, 1, 5, 1, true).translate(0, 0.5, 0),
        new THREE.MeshBasicMaterial({ color: 0x6ae0ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      );
      beam.visible = false; beam.frustumCulled = false;
      scene.add(beam);
      this.state[side] = { cand: null, held: null, dist: 0, local0: new THREE.Vector3(), target: new THREE.Vector3(), tvel: new THREE.Vector3(), prevT: new THREE.Vector3(), beam };
    }
    this.onThrow = null; this.onGrab = null;
  }

  setColor(hex) { for (const s of Object.values(this.state)) s.beam.material.color.setHex(hex); }

  _entities() {
    const { people, props } = this.ctx;
    const out = [];
    for (const p of people.list) if (!p.held) out.push({ kind: 'person', ent: p, at: people.center(p).clone() });
    for (const p of props.list) if (!p.held) out.push({ kind: 'prop', ent: p, at: props.center(p).clone() });
    return out;
  }

  _pick(h, entities) {
    let best = null, bestScore = Infinity;
    for (const e of entities) {
      _v.subVectors(e.at, h.aimPos);
      const d = _v.length();
      if (d < 0.8 || d > MAX_RANGE) continue;
      const cos = _v.dot(h.aimDir) / d;
      if (cos < PICK_CONE) continue;
      const score = (1 - cos) * 60 + d * 0.02 - (e.kind === 'person' ? 0.05 : 0);
      if (score < bestScore) { bestScore = score; best = { ...e, d }; }
    }
    if (best) {
      const dir = _w.subVectors(best.at, h.aimPos).normalize();
      if (this.ctx.world.raycast(h.aimPos, dir, best.d) < best.d - 2) return null; // behind a wall
    }
    return best;
  }

  update(dt) {
    const { input } = this.ctx;
    const entities = this._entities();
    for (const side of ['left', 'right']) {
      const h = input.hands[side], s = this.state[side];
      if (!h.connected) { if (s.held) this._release(s, h, true); s.beam.visible = false; continue; }

      if (!s.held) {
        s.cand = h.grip > 0.5 && !h.pressed.grip ? null : this._pick(h, entities);
        if (s.cand && h.pressed.grip) this._grab(s, h, s.cand);
      } else {
        const body = s.held.body;
        if (!body || h.grip < 0.35 || !s.held.ent.alive) { this._release(s, h, false); }
        else {
          if (side === 'right') s.dist = THREE.MathUtils.clamp(s.dist - h.stick.y * 30 * dt, 2, MAX_RANGE);
          const handDelta = _v.subVectors(h.localPos, s.local0).applyQuaternion(this.ctx.rig.quaternion);
          s.target.copy(h.aimPos).addScaledVector(h.aimDir, s.dist).addScaledVector(handDelta, HAND_GAIN);
          if (dt > 0) { _w.subVectors(s.target, s.prevT).divideScalar(dt); s.tvel.lerp(_w, 0.35); }
          s.prevT.copy(s.target);
          body.grab.target.copy(s.target);
          if (input.mode === 'desktop' && input.desktopThrow) this._release(s, h, false, _w.copy(h.aimDir).multiplyScalar(50));
        }
      }
      this._drawBeam(s, h);
    }
  }

  _grab(s, h, cand) {
    const { people, props, sfx } = this.ctx;
    let body, idx = -1, k;
    if (cand.kind === 'person') {
      people.knock(cand.ent, new THREE.Vector3());
      body = cand.ent.body; idx = RAG.head; k = 0.22;
    } else {
      body = props.activate(cand.ent);
      k = 0.04 + 0.12 * Math.min(1, 1500 / cand.ent.mass);
    }
    cand.ent.held = true;
    body.grab = { target: body.center.clone(), idx, k };
    body.wake();
    s.held = { ...cand, body };
    s.dist = h.aimPos.distanceTo(body.center);
    s.local0.copy(h.localPos);
    s.prevT.copy(body.center); s.target.copy(body.center); s.tvel.set(0, 0, 0);
    sfx?.grab(); this.ctx.input.pulse(h.side, 0.6, 60);
    this.onGrab?.(s.held);
  }

  _release(s, h, quiet, force) {
    const held = s.held;
    s.held = null;
    if (!held) return;
    held.ent.held = false;
    const body = held.body;
    if (!body) return;
    body.grab = null;
    let v = force ? force.clone() : s.tvel.clone().multiplyScalar(1.6);
    // Gentle release = drop. A flick = throw.
    if (!force && v.length() < 3) v = body.velocity();
    const heavy = Math.min(1, 3000 / (held.ent.mass ?? 75) + 0.35);
    if (v.length() > 70 * heavy) v.setLength(70 * heavy);
    body.setVelocity(v);
    body.thrown = v.length() > 6 ? 1.5 : 0; // seconds it counts as a projectile
    if (!quiet && v.length() > 8) { this.ctx.sfx?.whoosh(v.length()); this.ctx.input.pulse(h.side, 0.9, 80); }
    this.onThrow?.(held, v);
  }

  _drawBeam(s, h) {
    const target = s.held ? s.held.body.center : s.cand?.at;
    if (!target) { s.beam.visible = false; return; }
    _v.subVectors(target, h.aimPos);
    const len = _v.length();
    s.beam.visible = true;
    s.beam.position.copy(h.aimPos);
    s.beam.quaternion.setFromUnitVectors(_up, _v.divideScalar(len));
    s.beam.scale.set(s.held ? 1.6 : 0.8, len, s.held ? 1.6 : 0.8);
    s.beam.material.opacity = s.held ? 0.55 + Math.random() * 0.25 : 0.18;
  }

  heldBodies() { return Object.values(this.state).filter((s) => s.held).map((s) => s.held.body); }
}
