// Procedural pixel-art texture atlas. Everything is painted in code at load
// time: zero image downloads, one 256x256 texture (256 KB of VRAM) for the
// entire city, vehicles, people and props.
//
// Alpha is NOT transparency here: alpha < 255 marks emissive texels
// (glow = 1 - a/255). The PS1 material lights them up as the city gets darker.
import * as THREE from '../../vendor/three.module.js';

const TILE = 32;
const PER_ROW = 8;
const SIZE = TILE * PER_ROW;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shade = (hex, f) => {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * f));
  const b = Math.min(255, Math.round((hex & 255) * f));
  return (r << 16) | (g << 8) | b;
};

// 3x5 pixel font for signage.
const FONT = {
  A: '010101111101101', B: '110101110101110', R: '110101110101101', T: '111010010010010',
  X: '101101010101101', I: '111010010010111', O: '111101101101111', E: '111100110100111',
  L: '100100100100111', H: '101101111101101', P: '110101110100100', C: '111100100100111',
  S: '111100111001111', N: '110101101101101', U: '101101101101111', '2': '111001111100111',
  '4': '101101111001001', '7': '111001010010010',
};

class Painter {
  constructor() { this.data = new Uint8Array(SIZE * SIZE * 4); this.ox = 0; this.oy = 0; this.r = rng(1); }
  at(col, row, seed) { this.ox = col * TILE; this.oy = row * TILE; this.r = rng(seed); return this; }
  px(x, y, hex, a = 255) {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const gx = this.ox + x, gy = SIZE - 1 - (this.oy + y); // flip: texture v points up
    const i = (gy * SIZE + gx) * 4;
    this.data[i] = (hex >> 16) & 255; this.data[i + 1] = (hex >> 8) & 255; this.data[i + 2] = hex & 255; this.data[i + 3] = a;
  }
  rect(x, y, w, h, hex, a = 255) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, hex, a); }
  // Speckled fill: picks between shades of one colour, PS1-texture grit.
  grit(x, y, w, h, hex, amt = 0.12, a = 255) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.px(i, j, shade(hex, 1 - amt + this.r() * amt * 2), a);
  }
  text(str, x, y, hex, a = 255) {
    let cx = x;
    for (const ch of str) {
      const g = FONT[ch];
      if (g) for (let k = 0; k < 15; k++) if (g[k] === '1') this.px(cx + (k % 3), y + Math.floor(k / 3), hex, a);
      cx += 4;
    }
  }
}

// ---- reusable motifs -------------------------------------------------------
function bricks(p, base, mortar) {
  p.rect(0, 0, TILE, TILE, mortar);
  for (let row = 0; row < 8; row++) {
    const off = row % 2 ? 4 : 0;
    for (let bx = -off; bx < TILE; bx += 8) {
      const c = shade(base, 0.82 + p.r() * 0.3);
      p.grit(Math.max(bx, 0), row * 4, Math.min(bx + 7, TILE) - Math.max(bx, 0), 3, c, 0.06);
    }
  }
}
function windowPane(p, x, y, w, h, frame, lit, sill) {
  p.rect(x - 1, y - 1, w + 2, h + 2, frame);
  if (lit) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const warm = j < 2 ? 0xffe9a8 : (i + j) % 7 === 0 ? 0xf2c46b : 0xffd27a;
      p.px(x + i, y + j, warm, 70);
    }
    p.rect(x, y, Math.max(1, (w / 3) | 0), h, 0xc98a52, 120); // curtain
  } else {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const g = j < h * 0.4 ? 0x5a7896 : 0x2c3d52;
      p.px(x + i, y + j, shade(g, 0.9 + p.r() * 0.15));
    }
    p.px(x + 1, y + 1, 0x9fc3dc); p.px(x + 2, y + 1, 0x9fc3dc); p.px(x + 1, y + 2, 0x9fc3dc);
  }
  p.rect(x + ((w / 2) | 0), y, 1, h, frame); // mullion
  if (sill) p.rect(x - 2, y + h + 1, w + 4, 1, sill);
}
function metal(p, base) {
  p.grit(0, 0, TILE, TILE, base, 0.08);
  for (let k = 0; k < 6; k++) p.px((p.r() * TILE) | 0, (p.r() * TILE) | 0, shade(base, 0.7));
}

// ---- tile catalogue: [name, col, row, painter] -----------------------------
const TILES = [
  // Row 0: upper-floor facades (each tile = 4 m wide x 1 floor)
  ['brick_a', 0, 0, (p) => { bricks(p, 0x9c4a36, 0x6b5a50); windowPane(p, 4, 8, 8, 14, 0xd8d0c0, true, 0xcfc5b0); windowPane(p, 20, 8, 8, 14, 0xd8d0c0, false, 0xcfc5b0); }],
  ['brick_b', 1, 0, (p) => {
    bricks(p, 0x7a3a2c, 0x574740); windowPane(p, 4, 8, 8, 14, 0xe6e0d0, false, 0xc0b6a6); windowPane(p, 20, 8, 8, 14, 0xe6e0d0, true, 0xc0b6a6);
    p.rect(5, 18, 6, 4, 0x9aa3a8); p.rect(5, 19, 6, 1, 0x6b747a); // AC unit
  }],
  ['brick_c', 2, 0, (p) => {
    bricks(p, 0xb8925e, 0x7e6a54);
    for (const x of [5, 21]) { windowPane(p, x, 9, 6, 13, 0x3a3028, x === 21, 0xe0d4bc); p.rect(x - 1, 7, 8, 2, 0xe0d4bc); }
  }],
  ['office_a', 3, 0, (p) => {
    p.rect(0, 0, TILE, TILE, 0x3a4652);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const lit = p.r() < 0.22;
      for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) {
        const sky = j < 3 ? 0x6f9ec2 : 0x3d6487;
        p.px(x * 8 + i, y * 8 + j, lit ? (j < 2 ? 0xfff6dc : 0xf2dca8) : shade(sky, 0.92 + p.r() * 0.1), lit ? 90 : 255);
      }
    }
  }],
  ['office_b', 4, 0, (p) => {
    p.grit(0, 0, TILE, TILE, 0xb9b6ae, 0.05);
    for (let x = 0; x < TILE; x++) for (let j = 0; j < 12; j++) {
      const lit = ((x / 6) | 0) % 3 === 1;
      p.px(x, 10 + j, lit ? 0xf4e2b0 : j < 4 ? 0x7da2bd : 0x34506a, lit ? 80 : 255);
    }
    p.rect(0, 9, TILE, 1, 0x8a8780); p.rect(0, 22, TILE, 1, 0x8a8780);
  }],
  ['concrete_a', 5, 0, (p) => {
    p.grit(0, 0, TILE, TILE, 0x8f9093, 0.08);
    p.rect(0, 15, TILE, 1, 0x6e6f72); p.rect(15, 0, 1, TILE, 0x6e6f72);
    windowPane(p, 4, 5, 7, 7, 0x5a5b5e, false); windowPane(p, 20, 5, 7, 7, 0x5a5b5e, true);
    windowPane(p, 4, 20, 7, 7, 0x5a5b5e, true); windowPane(p, 20, 20, 7, 7, 0x5a5b5e, false);
  }],
  ['concrete_plain', 6, 0, (p) => { p.grit(0, 0, TILE, TILE, 0x9a9895, 0.07); p.rect(0, 31, TILE, 1, 0x7a7875); for (let k = 0; k < 4; k++) p.rect((p.r() * 28) | 0, (p.r() * 28) | 0, 1, 3, 0x7a7875); }],
  ['brick_plain', 7, 0, (p) => bricks(p, 0x8e4634, 0x5e4e46)],

  // Row 1: street level + roofs
  ['store_a', 0, 1, (p) => {
    p.rect(0, 0, TILE, TILE, 0x2e2a28);
    for (let x = 0; x < TILE; x++) for (let j = 0; j < 6; j++) p.px(x, j, ((x >> 2) % 2) ? 0xf2efe6 : 0xc23a32);
    p.rect(0, 6, TILE, 1, 0x7e2620);
    for (let j = 0; j < 17; j++) for (let i = 0; i < 26; i++) p.px(3 + i, 10 + j, j < 3 ? 0xfff2c8 : (i + j * 3) % 11 === 0 ? 0xe0a050 : 0xf0d090, 60);
    p.rect(3, 22, 26, 1, 0x8a6a40, 120); p.rect(15, 10, 1, 17, 0x2e2a28);
  }],
  ['store_b', 1, 1, (p) => {
    p.rect(0, 0, TILE, TILE, 0x4a5a4a);
    for (let x = 0; x < TILE; x++) for (let j = 0; j < 6; j++) p.px(x, j, ((x >> 2) % 2) ? 0xe8e4d0 : 0x2f7a4a);
    p.rect(2, 10, 18, 17, 0x1e2a2a); for (let j = 0; j < 15; j++) for (let i = 0; i < 16; i++) p.px(3 + i, 11 + j, 0xd8f0e0, 90);
    p.rect(23, 11, 7, 18, 0x6a4a2e); p.px(28, 20, 0xd8c070); // door
  }],
  ['store_shutter', 2, 1, (p) => {
    p.rect(0, 0, TILE, TILE, 0x3a3634);
    for (let j = 6; j < 30; j++) p.rect(2, j, 28, 1, j % 2 ? 0x8a8c8e : 0x6c6e70);
    const tag = [0xd84a8a, 0x3ab0d8, 0xe8c040][(p.r() * 3) | 0];
    for (let k = 0; k < 40; k++) p.px(6 + ((p.r() * 18) | 0), 14 + ((p.r() * 8) | 0), tag);
    p.rect(0, 2, TILE, 3, 0x2a2624);
  }],
  ['store_neon', 3, 1, (p) => {
    p.rect(0, 0, TILE, TILE, 0x1e1a22);
    p.rect(3, 2, 26, 9, 0x2a1e2e); p.text('BAR', 10, 4, 0xff4fb8, 30);
    for (let j = 0; j < 14; j++) for (let i = 0; i < 18; i++) p.px(3 + i, 14 + j, 0x6a3a7a, 140);
    p.rect(24, 14, 6, 16, 0x3a2a2a);
  }],
  ['lobby', 4, 1, (p) => {
    p.grit(0, 0, TILE, TILE, 0x5a5e66, 0.05);
    for (let j = 0; j < 22; j++) for (let i = 0; i < 28; i++) p.px(2 + i, 8 + j, j < 6 ? 0xc8e0f0 : 0xa8c8e0, 110);
    p.rect(2, 8, 28, 1, 0x2a2e36); p.rect(9, 8, 1, 22, 0x2a2e36); p.rect(22, 8, 1, 22, 0x2a2e36); p.rect(15, 14, 2, 16, 0x2a2e36);
  }],
  ['roof_tar', 5, 1, (p) => { p.grit(0, 0, TILE, TILE, 0x3e3c3a, 0.15); for (let k = 0; k < 3; k++) p.rect(0, (p.r() * 30) | 0, TILE, 1, 0x34322f); }],
  ['roof_gravel', 6, 1, (p) => { for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) p.px(i, j, [0x7a756c, 0x8a857a, 0x655f58, 0x9a948a][(p.r() * 4) | 0]); }],
  ['taxi_sign', 7, 1, (p) => { p.rect(0, 0, TILE, TILE, 0x2a2a2a); p.rect(2, 9, 28, 14, 0xffe680, 60); p.text('TAXI', 8, 13, 0x1a1a1a, 255); }],

  // Row 2: streets
  ['asphalt', 0, 2, (p) => { p.grit(0, 0, TILE, TILE, 0x3c3d40, 0.14); for (let k = 0; k < 3; k++) p.rect((p.r() * 26) | 0, (p.r() * 30) | 0, 5, 1, 0x2e2f31); }],
  ['road_dash', 1, 2, (p) => { p.grit(0, 0, TILE, TILE, 0x3c3d40, 0.14); p.rect(14, 4, 4, 22, 0xe0b830); }],
  ['road_edge', 2, 2, (p) => { p.grit(0, 0, TILE, TILE, 0x3c3d40, 0.14); p.grit(1, 0, 2, TILE, 0xdedcd4, 0.06); }],
  ['crosswalk', 3, 2, (p) => { p.grit(0, 0, TILE, TILE, 0x3c3d40, 0.14); for (let x = 2; x < TILE; x += 8) p.grit(x, 0, 4, TILE, 0xe6e3da, 0.05); }],
  ['sidewalk', 4, 2, (p) => {
    p.grit(0, 0, TILE, TILE, 0xa6a39c, 0.06);
    p.rect(0, 15, TILE, 1, 0x84817b); p.rect(15, 0, 1, TILE, 0x84817b); p.rect(0, 31, TILE, 1, 0x84817b); p.rect(31, 0, 1, TILE, 0x84817b);
    p.px(6, 6, 0x6e6b65); p.px(7, 7, 0x6e6b65); p.px(8, 7, 0x6e6b65); p.px(22, 25, 0x5a5650);
  }],
  ['curb', 5, 2, (p) => { p.grit(0, 0, TILE, TILE, 0xb8b4aa, 0.05); for (let x = 7; x < TILE; x += 8) p.rect(x, 0, 1, TILE, 0x8c887f); }],
  ['metal', 6, 2, (p) => metal(p, 0x8a8e92)],
  ['door', 7, 2, (p) => { p.rect(0, 0, TILE, TILE, 0x3a3634); p.grit(6, 2, 20, 30, 0x6a4630, 0.08); p.rect(8, 4, 16, 10, 0x5a3a26); p.rect(8, 17, 16, 12, 0x5a3a26); p.rect(21, 17, 2, 2, 0xd8c070); }],

  // Row 3: vehicles (body tiles are near-white so per-vehicle colour tints them)
  ['car_body', 0, 3, (p) => { p.grit(0, 0, TILE, TILE, 0xe8e8e8, 0.04); p.rect(15, 0, 1, TILE, 0x9a9a9a); p.rect(0, 14, TILE, 1, 0xffffff); p.rect(4, 12, 3, 1, 0x9a9a9a); p.rect(20, 12, 3, 1, 0x9a9a9a); }],
  ['car_window', 1, 3, (p) => { for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) p.px(i, j, (i + j) % 13 < 2 ? 0x8aa8c0 : j < 12 ? 0x3a5068 : 0x1e2834); }],
  ['car_front', 2, 3, (p) => {
    p.grit(0, 0, TILE, TILE, 0xe8e8e8, 0.04); p.rect(9, 12, 14, 8, 0x2a2a2c);
    for (let x = 10; x < 22; x += 2) p.rect(x, 13, 1, 6, 0x5a5a5e);
    p.rect(1, 12, 6, 5, 0xfff8d8, 40); p.rect(25, 12, 6, 5, 0xfff8d8, 40); p.rect(0, 24, TILE, 4, 0x3a3a3c);
  }],
  ['car_back', 3, 3, (p) => { p.grit(0, 0, TILE, TILE, 0xe8e8e8, 0.04); p.rect(1, 10, 7, 5, 0xe02a2a, 60); p.rect(24, 10, 7, 5, 0xe02a2a, 60); p.rect(11, 16, 10, 5, 0xf0f0e0); p.rect(0, 24, TILE, 4, 0x3a3a3c); }],
  ['tire', 4, 3, (p) => {
    p.rect(0, 0, TILE, TILE, 0x1c1c1e);
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) { const d = Math.hypot(i - 15.5, j - 15.5); if (d < 9) p.px(i, j, d < 3 ? 0x5a5a5e : 0xa8aaae); }
    for (let k = 0; k < TILE; k += 4) p.rect(k, 0, 2, TILE, 0x161618);
  }],
  ['taxi_stripe', 5, 3, (p) => { p.grit(0, 0, TILE, TILE, 0xe8e8e8, 0.04); for (let x = 0; x < TILE; x += 4) { p.rect(x, 12, 2, 2, 0x1a1a1a); p.rect(x + 2, 14, 2, 2, 0x1a1a1a); } p.rect(15, 0, 1, TILE, 0x9a9a9a); }],
  ['police_door', 6, 3, (p) => {
    p.rect(0, 0, TILE, 14, 0x1a1c22); p.grit(0, 14, TILE, 18, 0xf0f0f0, 0.03); p.rect(15, 0, 1, TILE, 0x7a7a7a);
    const star = [[3, 0], [2, 1], [3, 1], [4, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [2, 4], [4, 4], [1, 5], [5, 5]];
    for (const [x, y] of star) p.px(20 + x, 19 + y, 0xc8a040);
  }],
  ['light_bar', 7, 3, (p) => { p.rect(0, 0, 16, TILE, 0xff2a2a, 20); p.rect(16, 0, 16, TILE, 0x2a5aff, 20); p.rect(15, 0, 2, TILE, 0x202020); }],

  // Row 4: buses + people (skin/hair/cloth are near-white for tinting)
  ['bus_side', 0, 4, (p) => {
    p.grit(0, 0, TILE, TILE, 0xe8e8e8, 0.03);
    for (let x = 1; x < TILE; x += 8) for (let j = 0; j < 9; j++) for (let i = 0; i < 6; i++) p.px(x + i, 3 + j, j < 3 ? 0x6a88a2 : 0x2a3a4c);
    p.rect(0, 15, TILE, 2, 0x9a9a9a);
  }],
  ['bus_front', 1, 4, (p) => {
    p.grit(0, 0, TILE, TILE, 0xe8e8e8, 0.03); p.rect(2, 1, 28, 5, 0x1a1a1a); p.text('24', 12, 1, 0xffb020, 40);
    for (let j = 0; j < 12; j++) for (let i = 0; i < 28; i++) p.px(2 + i, 7 + j, j < 4 ? 0x7a98b2 : 0x2a3a4c);
    p.rect(2, 24, 5, 3, 0xfff8d8, 40); p.rect(25, 24, 5, 3, 0xfff8d8, 40);
  }],
  ['face', 2, 4, (p) => {
    p.grit(0, 0, TILE, TILE, 0xf2f2f2, 0.04);
    p.rect(7, 12, 5, 3, 0xffffff); p.rect(20, 12, 5, 3, 0xffffff); p.rect(9, 12, 2, 3, 0x2a2018); p.rect(22, 12, 2, 3, 0x2a2018);
    p.rect(6, 9, 7, 2, 0x4a3a30); p.rect(19, 9, 7, 2, 0x4a3a30); p.rect(15, 15, 2, 5, 0xd0d0d0); p.rect(11, 23, 10, 2, 0x8a4a46);
  }],
  ['face_thug', 3, 4, (p) => {
    p.grit(0, 0, TILE, TILE, 0xf2f2f2, 0.04);
    p.rect(7, 12, 5, 3, 0xffffff); p.rect(20, 12, 5, 3, 0xffffff); p.rect(9, 13, 2, 2, 0x1a1010); p.rect(22, 13, 2, 2, 0x1a1010);
    p.rect(5, 9, 8, 2, 0x2a2020); p.rect(19, 9, 8, 2, 0x2a2020);
    for (let j = 17; j < TILE; j++) for (let i = 0; i < TILE; i++) p.px(i, j, (i + j) % 6 < 1 ? 0xf0e0d0 : 0xa82424);
  }],
  ['face_swat', 4, 4, (p) => {
    p.grit(0, 0, TILE, TILE, 0x262628, 0.1);
    p.rect(3, 9, 26, 9, 0x101012); p.rect(5, 11, 9, 5, 0x3a6a5a, 160); p.rect(18, 11, 9, 5, 0x3a6a5a, 160); p.px(6, 12, 0xbfe8d0); p.px(19, 12, 0xbfe8d0);
  }],
  ['hair', 5, 4, (p) => { for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) p.px(i, j, (i * 3 + j) % 5 === 0 ? 0xb0b0b0 : 0xe0e0e0); }],
  ['skin', 6, 4, (p) => p.grit(0, 0, TILE, TILE, 0xf2f2f2, 0.04)],
  ['cloth', 7, 4, (p) => { for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) p.px(i, j, (i + j) % 4 === 0 ? 0xd2d2d2 : (i - j) % 4 === 0 ? 0xdedede : 0xeeeeee); }],

  // Row 5: outfits + player gloves
  ['jeans', 0, 5, (p) => { for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) p.px(i, j, (i + j * 2) % 5 === 0 ? 0x5a78a8 : 0x41608e); p.rect(15, 0, 1, TILE, 0xc8a050); }],
  ['uniform', 1, 5, (p) => {
    p.grit(0, 0, TILE, TILE, 0x1f2c4a, 0.08); p.rect(15, 0, 2, TILE, 0x18223a);
    for (let y = 4; y < TILE; y += 6) p.px(16, y, 0xc8c8c8);
    const badge = [[1, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2], [1, 3]];
    for (const [x, y] of badge) p.px(8 + x, 6 + y, 0xd8b040);
    p.rect(20, 7, 6, 1, 0x3a4a6a);
  }],
  ['hoodie', 2, 5, (p) => { p.grit(0, 0, TILE, TILE, 0xe4e4e4, 0.05); p.rect(6, 20, 20, 1, 0xa8a8a8); p.rect(6, 20, 1, 8, 0xa8a8a8); p.rect(25, 20, 1, 8, 0xa8a8a8); p.rect(13, 0, 1, 8, 0xf8f8f8); p.rect(18, 0, 1, 8, 0xf8f8f8); }],
  ['shoe', 3, 5, (p) => { p.grit(0, 0, TILE, TILE, 0x262424, 0.1); p.rect(0, 26, TILE, 6, 0xd8d4cc); }],
  ['vest_swat', 4, 5, (p) => {
    p.grit(0, 0, TILE, TILE, 0x2a2c2e, 0.1);
    for (const x of [3, 12, 21]) { p.rect(x, 14, 8, 8, 0x1c1e20); p.rect(x, 14, 8, 2, 0x3a3c3e); }
    p.text('SPEC', 8, 4, 0xd8d8d8);
  }],
  ['glove_hero', 5, 5, (p) => {
    p.grit(0, 0, TILE, TILE, 0x2858b8, 0.08); p.rect(0, 0, TILE, 4, 0xf0f0f0); p.rect(0, 28, TILE, 4, 0xf0f0f0);
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) { const d = Math.hypot(i - 15.5, j - 15.5); if (d < 7) p.px(i, j, d < 4 ? 0xe8ffff : 0x6ae0ff, d < 4 ? 0 : 60); }
  }],
  ['glove_villain', 6, 5, (p) => {
    p.grit(0, 0, TILE, TILE, 0x1a1618, 0.1);
    for (let k = 0; k < 5; k++) { let x = 15, y = 15; for (let s = 0; s < 14; s++) { x += ((p.r() * 3) | 0) - 1 + (k % 2 ? 1 : -1) * (s % 3 === 0 ? 1 : 0); y += (k < 2 ? -1 : 1); p.px(x, y, 0xff3a2a, 60); } }
    for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) { const d = Math.hypot(i - 15.5, j - 15.5); if (d < 6) p.px(i, j, d < 3 ? 0xffd0b0 : 0xff4020, d < 3 ? 0 : 50); }
  }],
  ['glow', 7, 5, (p) => p.rect(0, 0, TILE, TILE, 0xffffff, 0)],

  // Row 6: street furniture
  ['lamp_post', 0, 6, (p) => metal(p, 0x2e4a3e)],
  ['lamp_head', 1, 6, (p) => { p.rect(0, 0, TILE, TILE, 0x2e4a3e); p.grit(2, 2, 28, 28, 0xfff0c0, 0.05, 40); }],
  ['traffic', 2, 6, (p) => {
    p.rect(0, 0, TILE, TILE, 0x2a2c20);
    const lights = [[0xff3020, 6], [0xffb020, 15], [0x30e060, 24]];
    for (const [c, y] of lights) for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) if (i * i + j * j <= 10) p.px(15 + i, y + j, c, y === 24 ? 30 : 200);
  }],
  ['hydrant', 3, 6, (p) => { p.grit(0, 0, TILE, TILE, 0xc02a22, 0.1); p.rect(0, 6, TILE, 2, 0x8a1a16); for (const x of [6, 25]) p.rect(x, 14, 2, 2, 0xd0c0a0); }],
  ['trash', 4, 6, (p) => { p.rect(0, 0, TILE, TILE, 0x234030); for (let x = 1; x < TILE; x += 4) p.grit(x, 0, 2, TILE, 0x3a6a4a, 0.1); p.rect(0, 0, TILE, 3, 0x1a2a20); }],
  ['crate', 5, 6, (p) => {
    for (let j = 0; j < TILE; j++) p.grit(0, j, TILE, 1, j % 8 === 7 ? 0x6a4a2a : 0xa87a4a, 0.08);
    p.rect(0, 0, TILE, 3, 0x7a5432); p.rect(0, 29, TILE, 3, 0x7a5432); p.rect(0, 0, 3, TILE, 0x7a5432); p.rect(29, 0, 3, TILE, 0x7a5432);
    for (let k = 3; k < 29; k++) { p.px(k, k, 0x7a5432); p.px(k + 1, k, 0x7a5432); }
  }],
  ['dumpster', 6, 6, (p) => {
    p.grit(0, 0, TILE, TILE, 0x2a5a52, 0.1); for (let x = 3; x < TILE; x += 7) p.rect(x, 4, 1, 24, 0x1e443e);
    for (let k = 0; k < 18; k++) p.px((p.r() * 32) | 0, 20 + ((p.r() * 12) | 0), 0x8a4a22);
  }],
  ['bench', 7, 6, (p) => { for (let j = 0; j < TILE; j++) p.grit(0, j, TILE, 1, j % 6 > 3 ? 0x3a2a1a : 0x9a6a3a, 0.08); }],

  // Row 7: rooftop dressing + signs
  ['water_tank', 0, 7, (p) => { for (let x = 0; x < TILE; x++) p.grit(x, 0, 1, TILE, x % 4 === 3 ? 0x4a3422 : 0x7a5838, 0.08); p.rect(0, 8, TILE, 1, 0x3a3a3a); p.rect(0, 22, TILE, 1, 0x3a3a3a); }],
  ['ad_board', 1, 7, (p) => {
    p.rect(0, 0, TILE, TILE, 0x1a1a1a);
    for (let j = 1; j < 31; j++) for (let i = 1; i < 31; i++) p.px(i, j, j < 16 ? 0xf05a28 : 0xf8c020, 80);
    for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) if (i * i + j * j < 36) p.px(8 + i, 16 + j, 0xfff4e0, 60);
    p.text('COLA', 15, 13, 0x1a1a1a);
  }],
  ['neon_sign', 2, 7, (p) => { p.rect(0, 0, TILE, TILE, 0x14101a); p.text('HOTEL', 6, 13, 0x40e8ff, 20); p.rect(3, 9, 26, 1, 0xff40a0, 40); p.rect(3, 21, 26, 1, 0xff40a0, 40); }],
  ['stair_box', 3, 7, (p) => { p.grit(0, 0, TILE, TILE, 0x8a8478, 0.07); p.rect(10, 8, 12, 24, 0x5a4a3a); p.rect(19, 20, 2, 2, 0xc8b070); }],
  ['ac_unit', 4, 7, (p) => { p.grit(0, 0, TILE, TILE, 0xa8acb0, 0.05); for (let j = 4; j < 28; j += 3) p.rect(4, j, 24, 1, 0x6a6e72); }],
  ['white', 5, 7, (p) => p.rect(0, 0, TILE, TILE, 0xf0f0f0)],
  ['rust', 6, 7, (p) => { p.grit(0, 0, TILE, TILE, 0x6a5a4e, 0.12); for (let k = 0; k < 30; k++) p.px((p.r() * 32) | 0, (p.r() * 32) | 0, 0x8a4a22); }],
  ['scorch', 7, 7, (p) => { for (let j = 0; j < TILE; j++) for (let i = 0; i < TILE; i++) p.px(i, j, p.r() < 0.5 ? 0x1a1614 : 0x2a2420); for (let k = 0; k < 10; k++) p.px((p.r() * 32) | 0, (p.r() * 32) | 0, 0xff6a20, 40); }],
];

export function createAtlas() {
  const p = new Painter();
  const tiles = {};
  TILES.forEach(([name, col, row, paint], i) => {
    p.at(col, row, 1000 + i * 97);
    paint(p);
    tiles[name] = [col, PER_ROW - 1 - row]; // atlas coords with v pointing up
  });
  // Hand-built mip chain (box filter). Tiles are power-of-two and aligned, so
  // each level stays a clean atlas and nearest sampling never bleeds between
  // tiles. Mips stop distant facades from crawling and keep texture reads cheap.
  const mipmaps = [{ data: p.data, width: SIZE, height: SIZE }];
  for (let s = SIZE >> 1; s >= PER_ROW; s >>= 1) {
    const src = mipmaps[mipmaps.length - 1].data, S2 = s * 2, d = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) for (let c = 0; c < 4; c++) {
      const i = (y * 2 * S2 + x * 2) * 4 + c;
      d[(y * s + x) * 4 + c] = (src[i] + src[i + 4] + src[i + S2 * 4] + src[i + S2 * 4 + 4] + 2) >> 2;
    }
    mipmaps.push({ data: d, width: s, height: s });
  }
  const texture = new THREE.DataTexture(p.data, SIZE, SIZE, THREE.RGBAFormat);
  texture.mipmaps = mipmaps;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, tiles, tileSize: TILE, tilesPerRow: PER_ROW, size: SIZE, data: p.data, mipLevels: mipmaps.length };
}

// ---- FX sheet: real alpha, used by additive sprites ------------------------
// 64x64, 16px frames. Rows: fire, smoke, energy orb, spark/ring.
export function createFxSheet() {
  const S = 64, F = 16;
  const data = new Uint8Array(S * S * 4);
  const r = rng(77);
  const put = (x, y, c, a) => { const i = ((S - 1 - y) * S + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = a; };
  for (let f = 0; f < 4; f++) {
    for (let y = 0; y < F; y++) for (let x = 0; x < F; x++) {
      const nx = (x - 7.5) / 8, ny = (y - 7.5) / 8;
      // fire: teardrop that flickers per frame
      const w = 0.75 - (1 - (y / F)) * 0.45 + Math.sin(f * 1.7 + y * 0.9) * 0.08;
      const fire = Math.abs(nx + Math.sin(f * 2.1 + y * 0.6) * 0.15) < w * (y / F) * 1.2 && y > 2;
      if (fire) { const hot = y > 10 && Math.abs(nx) < 0.25; put(f * F + x, y, hot ? [255, 240, 160] : y > 7 ? [255, 140, 40] : [200, 50, 20], 255); }
      // smoke: lumpy disc, grows each frame
      const rad = 0.42 + f * 0.1 + r() * 0.1, d2 = Math.sqrt(nx * nx + ny * ny);
      // Solid core, checkerboard rim: the PS1 way of faking a soft edge.
      if (d2 < rad && (d2 < rad - 0.22 || (x + y) % 2 === 0)) put(f * F + x, F + y, [60 + f * 8, 56 + f * 8, 56 + f * 8], 200 - f * 40);
      // orb: pulsing core
      const d = Math.hypot(nx, ny), core = 0.3 + (f % 2) * 0.08;
      if (d < 0.9) put(f * F + x, 2 * F + y, d < core ? [240, 255, 255] : [90, 220, 255], d < core ? 255 : Math.max(0, 200 - d * 220) | 0);
      // ring
      const ringR = 0.3 + f * 0.18;
      if (Math.abs(d - ringR) < 0.12) put(f * F + x, 3 * F + y, [255, 250, 220], 230 - f * 50);
    }
  }
  const texture = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, frames: 4, rows: 4 };
}
