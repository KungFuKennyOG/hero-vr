// Pixel FX: fire, smoke, energy orbs and slam shockwaves from one 64x64 sheet.
import * as THREE from '../../vendor/three.module.js';

const ROW = { fire: 0, smoke: 1, orb: 2, ring: 3 };

export class FxSystem {
  constructor(sheet, scene) {
    this.sheet = sheet;
    this.scene = scene;
    this.items = [];
  }
  _mat(row, additive = true) {
    const t = this.sheet.texture.clone();
    t.repeat.set(1 / 4, 1 / 4);
    t.offset.set(0, (3 - ROW[row]) / 4);
    t.needsUpdate = true;
    return new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false });
  }
  _sprite(row, pos, size, additive) {
    const s = new THREE.Sprite(this._mat(row, additive));
    s.position.copy(pos);
    s.scale.setScalar(size);
    this.scene.add(s);
    return s;
  }

  // Burning spot: a flickering flame plus a smoke column that keeps rising.
  fire(pos, size = 3) {
    const flame = this._sprite('fire', pos.clone().add(new THREE.Vector3(0, size * 0.45, 0)), size, true);
    const puffs = [];
    for (let i = 0; i < 6; i++) {
      const p = this._sprite('smoke', pos, size * 1.2, false);
      p.material.opacity = 0.85;
      puffs.push({ s: p, t: i / 6 });
    }
    const item = { kind: 'fire', flame, puffs, base: pos.clone(), size, t: Math.random() * 10, life: Infinity };
    this.items.push(item);
    return item;
  }
  orb(pos, vel) {
    const s = this._sprite('orb', pos, 1.2, true);
    this.items.push({ kind: 'orb', s, vel: vel.clone(), t: 0, life: 3 });
  }
  shockwave(pos, radius = 14) {
    const t = this.sheet.texture.clone();
    t.repeat.set(1 / 4, 1 / 4); t.offset.set(0.25, 0); t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos).add(new THREE.Vector3(0, 0.3, 0));
    this.scene.add(m);
    this.items.push({ kind: 'ring', m, radius, t: 0, life: 0.7 });
  }

  update(dt) {
    for (const it of this.items) {
      it.t += dt;
      if (it.kind === 'fire') {
        it.flame.material.map.offset.x = (Math.floor(it.t * 10) % 4) / 4;
        for (const p of it.puffs) {
          p.t = (p.t + dt * 0.18) % 1;
          p.s.position.set(it.base.x + Math.sin(p.t * 6 + it.t) * 0.6, it.base.y + it.size * 0.6 + p.t * it.size * 6, it.base.z + p.t * 2);
          p.s.scale.setScalar(it.size * (0.8 + p.t * 2.4));
          p.s.material.map.offset.x = Math.min(3, Math.floor(p.t * 4)) / 4;
          p.s.material.opacity = 0.9 * (1 - p.t);
        }
      } else if (it.kind === 'orb') {
        it.s.position.addScaledVector(it.vel, dt);
        it.s.material.map.offset.x = (Math.floor(it.t * 12) % 2) / 4;
      } else if (it.kind === 'ring') {
        const k = it.t / it.life;
        it.m.scale.setScalar(1 + k * it.radius * 2);
        it.m.material.map.offset.x = Math.min(3, Math.floor(k * 4)) / 4;
        it.m.material.opacity = 1 - k;
      }
    }
    this.items = this.items.filter((it) => {
      if (it.t < it.life) return true;
      if (it.kind === 'fire') {
        for (const s of [it.flame, ...it.puffs.map((p) => p.s)]) { this.scene.remove(s); s.material.map.dispose(); s.material.dispose(); }
        return false;
      }
      const obj = it.s ?? it.m;
      this.scene.remove(obj);
      obj.material.map.dispose(); obj.material.dispose();
      if (it.m) it.m.geometry.dispose();
      return false;
    });
  }

  setVisible(kind, v) { for (const it of this.items) if (it.kind === kind) { it.flame.visible = v; it.puffs.forEach((p) => (p.s.visible = v)); } }
}
