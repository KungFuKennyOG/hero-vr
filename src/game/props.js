// Cars, buses, crates and dumpsters. Each type is one InstancedMesh.
// Props start kinematic (parked or driving) and become physics boxes the
// moment something touches them: a grab, a slam, a thrown body.
import * as THREE from '../../vendor/three.module.js';
import { buildVehicle, buildCrate, buildDumpster } from '../art/actors.js';
import { makeBox } from './physics.js';
import { seeded } from '../art/builder.js';
import { CELL } from '../art/city.js';

const TYPES = {
  sedan: { max: 48, make: (a) => buildVehicle(a, 'sedan', 0xffffff, 1) },
  taxi: { max: 16, make: (a) => buildVehicle(a, 'taxi') },
  police: { max: 12, make: (a) => buildVehicle(a, 'police') },
  bus: { max: 6, make: (a) => buildVehicle(a, 'bus', 0xffffff, 1) },
  crate: { max: 48, make: (a) => buildCrate(a, 1) },
  dumpster: { max: 16, make: (a) => buildDumpster(a) },
};
const CAR_COLORS = [0xc83a2a, 0x2a4a8a, 0x3a3a3c, 0xd8d8d0, 0x4a6a4a, 0x7a2a4a, 0xb8a080, 0x6a7a8a, 0xe0e0e0, 0x2a2a30];

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1), _Y = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _zero = new THREE.Matrix4().makeScale(0, 0, 0), _c = new THREE.Color();

export class Props {
  constructor(scene, atlas, material, physics, world) {
    this.physics = physics; this.world = world;
    this.list = [];
    this.types = {};
    for (const [name, T] of Object.entries(TYPES)) {
      const built = T.make(atlas);
      const im = new THREE.InstancedMesh(built.geometry, material, T.max);
      im.frustumCulled = false; im.count = 0;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < T.max; i++) im.setColorAt(i, _c.set(0xffffff));
      scene.add(im);
      this.types[name] = { mesh: im, size: built.size, mass: built.mass, used: new Array(T.max).fill(null) };
    }
    this.onHit = null;
  }

  spawn(type, x, z, yaw, opts = {}) {
    const T = this.types[type];
    const slot = T.used.indexOf(null);
    if (slot < 0) return null;
    const p = { type, slot, pos: new THREE.Vector3(x, this.world.groundY(x, z), z), yaw, state: opts.state ?? 'parked', body: null, held: false, chunk: opts.chunk ?? null, drive: opts.drive ?? null, size: T.size, mass: T.mass, alive: true };
    T.used[slot] = p;
    if (type === 'sedan' || type === 'bus') { T.mesh.setColorAt(slot, _c.set(opts.color ?? CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0])); T.mesh.instanceColor.needsUpdate = true; }
    this.list.push(p);
    return p;
  }
  despawn(p) {
    if (p.body) this.physics.remove(p.body);
    const T = this.types[p.type];
    T.used[p.slot] = null;
    T.mesh.setMatrixAt(p.slot, _zero);
    p.alive = false;
    this.list.splice(this.list.indexOf(p), 1);
  }

  populate(chunk) {
    const r = seeded(chunk.cx * 3571 + chunk.cz * 6491 + 5);
    const [ox, oz] = chunk.origin;
    const curb = 27.4; // parking lane right next to the sidewalk
    // Parked cars along all four curbs of this block.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let t = -18; t <= 18; t += 9) {
        if (!r.chance(0.35)) continue;
        const type = r.chance(0.2) ? 'taxi' : 'sedan';
        const x = ox + (dx ? dx * curb : t), z = oz + (dz ? dz * curb : t);
        this.spawn(type, x, z, dx ? (r.chance(0.5) ? 0 : Math.PI) : (r.chance(0.5) ? Math.PI / 2 : -Math.PI / 2), { chunk });
      }
    }
    // Traffic on this block's +x road (two lanes) and +z road.
    for (let i = 0; i < 2; i++) {
      const alongZ = i === 0, dir = r.chance(0.5) ? 1 : -1;
      const lane = (alongZ ? ox : oz) + CELL / 2 + (dir > 0 ? -3 : 3) * (alongZ ? 1 : -1);
      const type = r.chance(0.12) ? 'bus' : r.chance(0.25) ? 'taxi' : 'sedan';
      const start = (alongZ ? oz : ox) + r.range(-30, 30);
      this.spawn(type, alongZ ? lane : start, alongZ ? start : lane, 0, { state: 'drive', chunk, drive: { alongZ, dir, lane, speed: type === 'bus' ? 8 : r.range(9, 14) } });
    }
    // Loose stuff to throw.
    for (let k = r.int(2, 4); k > 0; k--) {
      const side = r.int(0, 3), t = r.range(-18, 18), d = 23;
      const [x, z] = [[t, d], [d, t], [t, -d], [-d, t]][side];
      this.spawn(r.chance(0.3) ? 'dumpster' : 'crate', ox + x, oz + z, r() * Math.PI, { chunk });
      if (r.chance(0.4)) { const c = this.spawn('crate', ox + x + 0.2, oz + z + 0.1, r() * 3, { chunk }); if (c) c.pos.y += 1.0; }
    }
    // Sometimes a cruiser: returns its spot so People can post two cops.
    if (r.chance(0.3)) {
      const t = r.range(-12, 12), x = ox + 27.4, z = oz + t;
      this.spawn('police', x, z, 0, { chunk });
      return { cops: [x - 2.8, z, -Math.PI / 2] };
    }
    return {};
  }
  clearChunk(chunk, keepNear) {
    for (const p of [...this.list]) {
      if (p.chunk !== chunk || p.held) continue;
      if (p.body && keepNear && p.pos.distanceTo(keepNear) < 60) { p.chunk = null; continue; }
      this.despawn(p);
    }
  }

  // Kinematic -> physics. Safe to call repeatedly.
  activate(p) {
    if (p.body) return p.body;
    const h = p.size[1];
    p.body = this.physics.add(makeBox(_v.set(p.pos.x, p.pos.y + h / 2 + 0.02, p.pos.z), p.size, p.yaw, p.mass));
    p.body.owner = p;
    if (p.state === 'drive') {
      const d = p.drive, s = d.speed * d.dir;
      p.body.setVelocity(_v.set(d.alongZ ? 0 : s, 0, d.alongZ ? s : 0));
    }
    p.state = 'body';
    return p.body;
  }
  blast(c, radius, strength) {
    for (const p of this.list) {
      const at = this.center(p), d = at.distanceTo(c);
      if (d > radius) continue;
      const k = (strength * (1 - d / radius)) * Math.min(1, 2500 / p.mass + 0.35);
      const b = this.activate(p);
      b.push(_v.subVectors(at, c).setY(0).normalize().multiplyScalar(k).setY(k * 0.7));
      // A little spin: push one corner harder.
      b.push(_v.set(0, k * 0.4, 0), 0);
    }
  }
  center(p) { return p.body ? p.body.center : _tmp.copy(p.pos).setY(p.pos.y + p.size[1] / 2); }
  grabbable() { return this.list.filter((p) => !p.held); }

  update(dt, player) {
    for (const p of this.list) {
      if (p.body) { p.pos.copy(p.body.center).setY(p.body.center.y - p.size[1] / 2); continue; }
      if (p.state !== 'drive') continue;
      const d = p.drive;
      // Brake for the player standing in the road.
      const ahead = _v.set(d.alongZ ? 0 : d.dir, 0, d.alongZ ? d.dir : 0);
      const toPlayer = _tmp.subVectors(player, p.pos);
      const blocked = toPlayer.dot(ahead) > 0 && toPlayer.dot(ahead) < 9 && Math.abs(d.alongZ ? toPlayer.x : toPlayer.z) < 1.6 && Math.abs(toPlayer.y) < 3;
      if (blocked) continue;
      if (d.alongZ) { p.pos.z += d.dir * d.speed * dt; p.yaw = d.dir > 0 ? 0 : Math.PI; }
      else { p.pos.x += d.dir * d.speed * dt; p.yaw = d.dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
      // Loop within the loaded area around the player.
      const along = d.alongZ ? p.pos.z - player.z : p.pos.x - player.x;
      if (Math.abs(along) > 110) { if (d.alongZ) p.pos.z -= Math.sign(along) * 210; else p.pos.x -= Math.sign(along) * 210; }
    }
  }

  render() {
    for (const T of Object.values(this.types)) {
      let top = 0;
      T.used.forEach((p, i) => { if (p) top = i + 1; });
      T.mesh.count = top;
    }
    for (const p of this.list) {
      const T = this.types[p.type];
      if (p.body) {
        p.body.boxBasis(_m);
        const yAxis = _v.setFromMatrixColumn(_m, 1);
        _m.setPosition(_tmp.copy(p.body.center).addScaledVector(yAxis, -p.size[1] / 2));
      } else _m.compose(p.pos, _q.setFromAxisAngle(_Y, p.yaw), _one);
      T.mesh.setMatrixAt(p.slot, _m);
    }
    for (const T of Object.values(this.types)) T.mesh.instanceMatrix.needsUpdate = true;
  }
}
const _tmp = new THREE.Vector3();
