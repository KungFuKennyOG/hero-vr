// Synthesised sound: no audio files. Wind that rises with speed, slam booms,
// throw whooshes, impact thuds, and a grab zing.
export class Sfx {
  constructor() { this.ctx = null; this.lastThud = 0; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    this.master = C.createGain(); this.master.gain.value = 0.7; this.master.connect(C.destination);
    const len = C.sampleRate * 2, buf = C.createBuffer(1, len, C.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // Wind loop.
    const src = C.createBufferSource(); src.buffer = buf; src.loop = true;
    this.windFilter = C.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.Q.value = 0.7;
    this.windGain = C.createGain(); this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
  }

  _burst({ dur = 0.3, freq = 800, type = 'lowpass', gain = 0.5, sweepTo = null, q = 1 }) {
    const C = this.ctx; if (!C) return;
    const t = C.currentTime;
    const s = C.createBufferSource(); s.buffer = this.noise;
    const f = C.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = C.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  _tone(f0, f1, dur, gain, type = 'sine') {
    const C = this.ctx; if (!C) return;
    const t = C.currentTime;
    const o = C.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = C.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  wind(speed) {
    if (!this.ctx) return;
    const k = Math.min(1, speed / 55);
    this.windGain.gain.setTargetAtTime(k * k * 0.5, this.ctx.currentTime, 0.1);
    this.windFilter.frequency.setTargetAtTime(300 + k * 1600, this.ctx.currentTime, 0.1);
  }
  boom(strength = 30) {
    const k = Math.min(1, strength / 45);
    this._burst({ dur: 1.1, freq: 600, sweepTo: 60, gain: 0.9 * k + 0.2 });
    this._tone(90, 28, 0.9, 0.8 * k + 0.2);
  }
  thud(speed) {
    if (!this.ctx || this.ctx.currentTime - this.lastThud < 0.06) return;
    this.lastThud = this.ctx.currentTime;
    const k = Math.min(1, speed / 30);
    this._burst({ dur: 0.18 + k * 0.2, freq: 250 + k * 500, gain: 0.15 + k * 0.5 });
  }
  crunch(speed) {
    const k = Math.min(1, speed / 30);
    this._burst({ dur: 0.35, freq: 1800, type: 'bandpass', q: 0.8, sweepTo: 400, gain: 0.25 + k * 0.4 });
    this.thud(speed);
  }
  whoosh(speed) { this._burst({ dur: 0.45, freq: 300, type: 'bandpass', sweepTo: 2200, q: 1.2, gain: Math.min(0.6, speed / 80) }); }
  grab() { this._tone(320, 880, 0.18, 0.18, 'triangle'); }
  jump() { this._burst({ dur: 0.3, freq: 200, sweepTo: 900, type: 'bandpass', gain: 0.25 }); }
  rescue() { [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, f, 0.25, 0.15, 'square'), i * 110)); }
  villain() { [196, 185, 147].forEach((f, i) => setTimeout(() => this._tone(f, f * 0.98, 0.3, 0.14, 'sawtooth'), i * 140)); }
}
