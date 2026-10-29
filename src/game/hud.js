// Reputation readout: a little pixel screen on your left wrist in VR, a
// corner panel on desktop. Toasts float in front of you for big moments.
import * as THREE from '../../vendor/three.module.js';

export function repLabel(t) { return t < 0.2 ? 'BELOVED HERO' : t < 0.42 ? 'HERO' : t < 0.58 ? 'VIGILANTE' : t < 0.8 ? 'MENACE' : 'SUPERVILLAIN'; }

function screen(w, h) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  return { canvas, ctx: canvas.getContext('2d'), tex };
}

export class Hud {
  constructor(camera, dom) {
    this.camera = camera; this.dom = dom;
    this.wrist = screen(128, 64);
    this.wristMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.055), new THREE.MeshBasicMaterial({ map: this.wrist.tex, transparent: true, depthTest: false, fog: false }));
    this.wristMesh.renderOrder = 999;
    // Sits on the back of the left wrist; turn your wrist to read it.
    this.wristMesh.position.set(0.0, 0.035, 0.06);
    this.wristMesh.rotation.set(-Math.PI / 2 + 0.5, 0, 0);
    this.toast = screen(256, 48);
    this.toastMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.1125), new THREE.MeshBasicMaterial({ map: this.toast.tex, transparent: true, depthTest: false, fog: false }));
    this.toastMesh.position.set(0, -0.12, -1.1); this.toastMesh.renderOrder = 999; this.toastMesh.visible = false;
    camera.add(this.toastMesh);
    this.toastT = 0; this.last = '';
    this.counts = { civ: 0, cop: 0, thug: 0, rescues: 0 };
  }
  attachWrist(grip) { if (grip && this.wristMesh.parent !== grip) grip.add(this.wristMesh); }

  say(text) {
    const { ctx, canvas, tex } = this.toast;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(8,10,14,0.78)'; ctx.fillRect(0, 6, canvas.width, 36);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, 25);
    tex.needsUpdate = true;
    this.toastMesh.visible = true; this.toastT = 2.6;
    const el = document.getElementById('toast');
    if (el) { el.textContent = text; el.hidden = false; }
  }

  update(dt, rep, mode) {
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) { this.toastMesh.visible = false; const el = document.getElementById('toast'); if (el) el.hidden = true; }
    }
    this.toastMesh.visible = this.toastMesh.visible && mode === 'vr';
    const label = repLabel(rep);
    const key = `${label}|${rep.toFixed(2)}|${Object.values(this.counts).join(',')}`;
    if (key === this.last) return;
    this.last = key;
    const { ctx, canvas, tex } = this.wrist;
    ctx.clearRect(0, 0, 128, 64);
    ctx.fillStyle = 'rgba(8,10,14,0.85)'; ctx.fillRect(0, 0, 128, 64);
    const col = `rgb(${Math.round(80 + rep * 175)},${Math.round(140 - rep * 70)},${Math.round(255 - rep * 200)})`;
    ctx.fillStyle = col; ctx.font = 'bold 12px monospace'; ctx.textBaseline = 'top';
    ctx.fillText(label, 6, 5);
    ctx.fillStyle = '#2a2f3a'; ctx.fillRect(6, 24, 116, 8);
    const grad = ctx.createLinearGradient(6, 0, 122, 0); grad.addColorStop(0, '#4f8dff'); grad.addColorStop(1, '#ff4b36');
    ctx.fillStyle = grad; ctx.fillRect(6, 24, 116, 8);
    ctx.fillStyle = '#fff'; ctx.fillRect(6 + rep * 112, 21, 4, 14);
    ctx.fillStyle = '#c8c5bc'; ctx.font = '10px monospace';
    ctx.fillText(`THUGS ${this.counts.thug}  SAVES ${this.counts.rescues}`, 6, 38);
    ctx.fillText(`CIVS ${this.counts.civ}  COPS ${this.counts.cop}`, 6, 50);
    tex.needsUpdate = true;
    const d = document.getElementById('hudRep');
    if (d) {
      d.textContent = label; d.style.color = col;
      document.getElementById('hudBar').style.left = `${rep * 100}%`;
      document.getElementById('hudCounts').textContent = `Thugs down ${this.counts.thug} · Rescues ${this.counts.rescues} · Civilians hurt ${this.counts.civ} · Cops down ${this.counts.cop}`;
    }
  }
}
