// MeshBuilder: accumulates flat-shaded, atlas-mapped triangles into one
// BufferGeometry. Anything built with one builder is one draw call.
import * as THREE from '../../vendor/three.module.js';

const _v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _n = new THREE.Vector3();
const _c = new THREE.Color();

export function seeded(seed) {
  let a = seed >>> 0;
  const r = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + r() * (hi - lo);
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  return r;
}

export class MeshBuilder {
  constructor(atlas) {
    this.tiles = atlas.tiles;
    this.pos = []; this.nrm = []; this.uv = []; this.tile = []; this.col = []; this.tint = [];
    this.m = new THREE.Matrix4();
    this.stack = [];
    this.mirrored = false;
  }
  get triangles() { return this.pos.length / 9; }

  // Transform stack, so parts can be built in local space then placed.
  push(mat) { this.stack.push(this.m.clone()); this.m.multiply(mat); this.mirrored = this.m.determinant() < 0; return this; }
  pushTRS(x, y, z, ry = 0, rx = 0, rz = 0, s = 1) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
    const sc = typeof s === 'number' ? new THREE.Vector3(s, s, s) : new THREE.Vector3(...s);
    return this.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, sc));
  }
  pop() { this.m = this.stack.pop(); this.mirrored = this.m.determinant() < 0; return this; }

  _tile(name) {
    const t = this.tiles[name];
    if (!t) throw new Error(`Unknown atlas tile "${name}"`);
    return t;
  }

  _emit(p, uv, tile, color, tint) {
    _c.set(color);
    for (let k = 0; k < 3; k++) {
      this.pos.push(p[k].x, p[k].y, p[k].z);
      this.nrm.push(_n.x, _n.y, _n.z);
      this.uv.push(uv[k][0], uv[k][1]);
      this.tile.push(tile[0], tile[1]);
      this.col.push(_c.r, _c.g, _c.b);
      this.tint.push(tint);
    }
  }

  tri(a, b, c, tileName, uva = [0, 0], uvb = [1, 0], uvc = [0.5, 1], color = 0xffffff, tint = 0) {
    const tile = this._tile(tileName);
    const p = [_v[0].set(...a).applyMatrix4(this.m), _v[1].set(...b).applyMatrix4(this.m), _v[2].set(...c).applyMatrix4(this.m)];
    _n.crossVectors(_e1.subVectors(p[1], p[0]), _e2.subVectors(p[2], p[0])).normalize();
    if (this.mirrored) { _n.negate(); this._emit([p[0], p[2], p[1]], [uva, uvc, uvb], tile, color, tint); }
    else this._emit(p, [uva, uvb, uvc], tile, color, tint);
    return this;
  }

  // Corners counter-clockwise as seen from the front: bottom-left, bottom-right, top-right, top-left.
  quad(a, b, c, d, tileName, uv = [0, 0, 1, 1], color = 0xffffff, tint = 0) {
    const [u0, v0, u1, v1] = uv;
    const tile = this._tile(tileName);
    const p = [_v[0].set(...a).applyMatrix4(this.m), _v[1].set(...b).applyMatrix4(this.m), _v[2].set(...c).applyMatrix4(this.m), _v[3].set(...d).applyMatrix4(this.m)];
    _n.crossVectors(_e1.subVectors(p[1], p[0]), _e2.subVectors(p[3], p[0])).normalize();
    const ta = [u0, v0], tb = [u1, v0], tc = [u1, v1], td = [u0, v1];
    if (this.mirrored) {
      _n.negate();
      this._emit([p[0], p[2], p[1]], [ta, tc, tb], tile, color, tint);
      this._emit([p[0], p[3], p[2]], [ta, td, tc], tile, color, tint);
    } else {
      this._emit([p[0], p[1], p[2]], [ta, tb, tc], tile, color, tint);
      this._emit([p[0], p[2], p[3]], [ta, tc, td], tile, color, tint);
    }
    return this;
  }

  // Face spec: 'tile' | { t, s (metres per repeat), r: [ru, rv], uv: [u0,v0,u1,v1] } | null (skip).
  _face(spec, fu, fv) {
    if (!spec) return null;
    if (typeof spec === 'string') return { t: spec, uv: [0, 0, 1, 1] };
    if (spec.uv) return { t: spec.t, uv: spec.uv };
    if (spec.s) return { t: spec.t, uv: [0, 0, Math.max(fu / spec.s, 0.25), Math.max(fv / spec.s, 0.25)] };
    if (spec.r) return { t: spec.t, uv: [0, 0, spec.r[0], spec.r[1]] };
    return { t: spec.t, uv: [0, 0, 1, 1] };
  }
  _faces(f) {
    const side = f.sides ?? f.all;
    return {
      pz: f.pz ?? f.front ?? side, nz: f.nz ?? f.back ?? side,
      px: f.px ?? f.right ?? side, nx: f.nx ?? f.left ?? side,
      py: f.py ?? f.top ?? f.all, ny: f.ny ?? f.bottom ?? null,
    };
  }

  // Box centred on x/z with its base at y. Bottom face is skipped unless given.
  box(x, y, z, w, h, d, faces, color = 0xffffff, tint = 0) {
    return this.taper(x, y, z, w, d, w, d, h, 0, faces, color, tint);
  }

  // Box whose top rectangle (wt x dt) differs from the bottom (wb x db) and
  // can slide forward/back by zShift: car cabins, torsos, rooftop tanks.
  taper(x, y, z, wb, db, wt, dt, h, zShift, faces, color = 0xffffff, tint = 0) {
    const F = this._faces(typeof faces === 'string' ? { all: faces, bottom: faces } : faces);
    const y0 = y, y1 = y + h;
    const B = [[x - wb / 2, y0, z - db / 2], [x + wb / 2, y0, z - db / 2], [x + wb / 2, y0, z + db / 2], [x - wb / 2, y0, z + db / 2]];
    const T = [[x - wt / 2, y1, z - dt / 2 + zShift], [x + wt / 2, y1, z - dt / 2 + zShift], [x + wt / 2, y1, z + dt / 2 + zShift], [x - wt / 2, y1, z + dt / 2 + zShift]];
    const wAvg = (wb + wt) / 2, dAvg = (db + dt) / 2;
    let s;
    if ((s = this._face(F.pz, wAvg, h))) this.quad(B[3], B[2], T[2], T[3], s.t, s.uv, color, tint);
    if ((s = this._face(F.nz, wAvg, h))) this.quad(B[1], B[0], T[0], T[1], s.t, s.uv, color, tint);
    if ((s = this._face(F.px, dAvg, h))) this.quad(B[2], B[1], T[1], T[2], s.t, s.uv, color, tint);
    if ((s = this._face(F.nx, dAvg, h))) this.quad(B[0], B[3], T[3], T[0], s.t, s.uv, color, tint);
    if ((s = this._face(F.py, wt, dt))) this.quad(T[3], T[2], T[1], T[0], s.t, s.uv, color, tint);
    if ((s = this._face(F.ny, wb, db))) this.quad(B[0], B[1], B[2], B[3], s.t, s.uv, color, tint);
    return this;
  }

  // Faceted cylinder/cone along +y. r1 = 0 gives a cone.
  cyl(x, y, z, r0, r1, h, sides, sideFace, topFace = sideFace, bottomFace = null, color = 0xffffff, tint = 0) {
    const ring = (r, yy, i) => { const a = (i / sides) * Math.PI * 2; return [x + Math.cos(a) * r, yy, z + Math.sin(a) * r]; };
    const sf = this._face(sideFace, 1, 1);
    for (let i = 0; i < sides; i++) {
      const u0 = (i / sides) * sf.uv[2], u1 = ((i + 1) / sides) * sf.uv[2];
      if (r1 > 0.0001) {
        this.quad(ring(r0, y, i + 1), ring(r0, y, i), ring(r1, y + h, i), ring(r1, y + h, i + 1), sf.t, [u1, sf.uv[1], u0, sf.uv[3]], color, tint);
      } else {
        this.tri(ring(r0, y, i + 1), ring(r0, y, i), [x, y + h, z], sf.t, [u1, 0], [u0, 0], [(u0 + u1) / 2, sf.uv[3]], color, tint);
      }
    }
    const capUv = (i) => { const a = (i / sides) * Math.PI * 2; return [0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5]; };
    const tf = this._face(topFace, 1, 1);
    if (tf && r1 > 0.0001) for (let i = 0; i < sides; i++) this.tri([x, y + h, z], ring(r1, y + h, i + 1), ring(r1, y + h, i), tf.t, [0.5, 0.5], capUv(i + 1), capUv(i), color, tint);
    const bf = this._face(bottomFace, 1, 1);
    if (bf) for (let i = 0; i < sides; i++) this.tri([x, y, z], ring(r0, y, i), ring(r0, y, i + 1), bf.t, [0.5, 0.5], capUv(i), capUv(i + 1), color, tint);
    return this;
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aTile', new THREE.Float32BufferAttribute(this.tile, 2));
    g.setAttribute('aColor', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.tint, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
