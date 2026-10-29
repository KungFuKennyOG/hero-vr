// Streams city chunks around the player and answers collision queries.
import * as THREE from '../../vendor/three.module.js';
import { buildChunk, CELL, CURB, LOT } from '../art/city.js';

const SIDEWALK_HALF = LOT + 4; // 26 m: block + sidewalk, raised by CURB

export class World {
  constructor(scene, atlas, material, { radius = 2, seed = 7 } = {}) {
    this.scene = scene; this.atlas = atlas; this.material = material;
    this.radius = radius; this.seed = seed;
    this.chunks = new Map();
    this.onLoad = null; this.onUnload = null;
  }
  static cell(v) { return Math.floor((v + CELL / 2) / CELL); }
  key(cx, cz) { return `${cx},${cz}`; }

  _build(cx, cz) { return this._add(cx, cz, buildChunk(this.atlas, cx, cz, { seed: this.seed })); }

  _add(cx, cz, c) {
    const mesh = new THREE.Mesh(c.geometry, this.material);
    mesh.position.set(cx * CELL, 0, cz * CELL);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    this.scene.add(mesh);
    const ox = cx * CELL, oz = cz * CELL;
    const chunk = {
      cx, cz, mesh, plaza: c.plaza,
      colliders: c.colliders.map((b) => ({ x0: b.x0 + ox, x1: b.x1 + ox, z0: b.z0 + oz, z1: b.z1 + oz, top: b.top })),
      sidewalk: c.sidewalk.map(([x, z]) => [x + ox, z + oz]),
      lanes: c.lanes.map((l) => ({ x: l.x + ox, dir: l.dir })),
      origin: [ox, oz],
    };
    this.chunks.set(this.key(cx, cz), chunk);
    this.onLoad?.(chunk);
    return chunk;
  }

  // Off-thread builds. Falls back to building inline if workers fail.
  _worker() {
    if (this.worker !== undefined) return this.worker;
    try {
      this.worker = new Worker(new URL('./chunkWorker.js', import.meta.url), { type: 'module' });
      this.pending = new Set();
      this.worker.onmessage = (e) => {
        const d = e.data, k = this.key(d.cx, d.cz);
        this.pending.delete(k);
        if (this.chunks.has(k)) return;
        const g = new THREE.BufferGeometry();
        for (const [n, size] of [['position', 3], ['normal', 3], ['uv', 2], ['aTile', 2], ['aColor', 3], ['aTint', 1]]) g.setAttribute(n, new THREE.BufferAttribute(d.attrs[n], size));
        g.computeBoundingSphere();
        this._add(d.cx, d.cz, { ...d, geometry: g });
      };
      this.worker.onerror = () => { this.worker.terminate(); this.worker = null; this.pending.clear(); };
    } catch { this.worker = null; }
    return this.worker;
  }
  _drop(k) {
    const c = this.chunks.get(k);
    this.scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    this.chunks.delete(k);
    this.onUnload?.(c);
  }

  // Loads everything within radius right away (used at spawn).
  fill(x, z) { const cx = World.cell(x), cz = World.cell(z); for (let i = -this.radius; i <= this.radius; i++) for (let j = -this.radius; j <= this.radius; j++) if (!this.chunks.has(this.key(cx + i, cz + j))) this._build(cx + i, cz + j); }

  // Streams at most one chunk per frame, nearest first, and drops far ones.
  update(x, z) {
    const cx = World.cell(x), cz = World.cell(z), R = this.radius;
    for (const [k, c] of this.chunks) if (Math.max(Math.abs(c.cx - cx), Math.abs(c.cz - cz)) > R + 1) this._drop(k);
    let best = null, bd = Infinity;
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
      const kk = this.key(cx + i, cz + j);
      if (this.chunks.has(kk) || this.pending?.has(kk)) continue;
      const d = i * i + j * j;
      if (d < bd) { bd = d; best = [cx + i, cz + j]; }
    }
    if (!best) return;
    const w = this._worker(), k = this.key(best[0], best[1]);
    if (!w) { this._build(best[0], best[1]); return; }
    // Keep up to two requests in flight, nearest first.
    if (this.pending.size < 2) { this.pending.add(k); w.postMessage({ cx: best[0], cz: best[1], seed: this.seed }); }
  }

  chunkAt(x, z) { return this.chunks.get(this.key(World.cell(x), World.cell(z))); }
  groundY(x, z) {
    const lx = x - World.cell(x) * CELL, lz = z - World.cell(z) * CELL;
    return Math.abs(lx) < SIDEWALK_HALF && Math.abs(lz) < SIDEWALK_HALF ? CURB : 0;
  }
  // Highest walkable surface under (x, z) at or below height y (+step).
  surfaceY(x, z, y = Infinity) {
    let s = this.groundY(x, z);
    const c = this.chunkAt(x, z);
    if (c) for (const b of c.colliders) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && b.top <= y + 1.5) s = Math.max(s, b.top);
    return s;
  }
  buildingAt(x, z) {
    const c = this.chunkAt(x, z);
    if (c) for (const b of c.colliders) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return b;
    return null;
  }

  // Pushes a sphere (centre p, radius r) out of buildings and the ground.
  // Returns 0 = free, 1 = ground/roof contact, 2 = wall contact.
  collide(p, r) {
    let hit = 0;
    const c = this.chunkAt(p.x, p.z);
    if (c) for (const b of c.colliders) {
      if (p.x <= b.x0 - r || p.x >= b.x1 + r || p.z <= b.z0 - r || p.z >= b.z1 + r || p.y >= b.top + r) continue;
      if (p.y > b.top - 0.8) { p.y = b.top + r; hit = Math.max(hit, 1); continue; }
      const dx0 = p.x - (b.x0 - r), dx1 = b.x1 + r - p.x, dz0 = p.z - (b.z0 - r), dz1 = b.z1 + r - p.z;
      const m = Math.min(dx0, dx1, dz0, dz1);
      if (m === dx0) p.x -= dx0; else if (m === dx1) p.x += dx1; else if (m === dz0) p.z -= dz0; else p.z += dz1;
      hit = 2;
    }
    const g = this.groundY(p.x, p.z) + r;
    if (p.y < g) { p.y = g; hit = Math.max(hit, 1); }
    return hit;
  }

  // Ray against building boxes + ground, for aiming. Returns distance or Infinity.
  raycast(o, d, maxDist = 200) {
    let best = maxDist;
    if (d.y < -1e-4) { const t = -o.y / d.y; if (t > 0) best = Math.min(best, t); }
    for (const c of this.chunks.values()) for (const b of c.colliders) {
      let t0 = 0, t1 = best;
      for (const [oo, dd, lo, hi] of [[o.x, d.x, b.x0, b.x1], [o.y, d.y, 0, b.top], [o.z, d.z, b.z0, b.z1]]) {
        if (Math.abs(dd) < 1e-6) { if (oo < lo || oo > hi) { t0 = Infinity; break; } continue; }
        let a = (lo - oo) / dd, e = (hi - oo) / dd;
        if (a > e) [a, e] = [e, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, e);
        if (t0 > t1) break;
      }
      if (t0 <= t1 && t0 < best) best = t0;
    }
    return best;
  }
}
