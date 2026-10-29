// Procedural city: buildings, streets and street furniture, built per chunk.
// One chunk (one 64 m city cell: a block plus half of each surrounding road)
// is ONE merged geometry = ONE draw call. Streaming = add/remove chunk meshes.
import * as THREE from '../../vendor/three.module.js';
import { MeshBuilder, seeded } from './builder.js';

export const CELL = 64;         // metres per chunk
const HALF = CELL / 2;
const ROAD_HALF = 6;            // each chunk owns half of a 12 m road
const WALK = 4;                 // sidewalk width
export const CURB = 0.15;       // sidewalk height
export const LOT = HALF - ROAD_HALF - WALK; // block interior half-size (22 m)
const GROUND_H = 4.2, FLOOR_H = 3.2;

const STYLES = {
  brick:      { upper: ['brick_a', 'brick_b'], ground: ['store_a', 'store_b', 'store_shutter', 'store_neon', 'door'], plain: 'brick_plain', trim: 'concrete_plain', roof: 'roof_tar', floors: [3, 6], colors: [0xffffff, 0xf2e6e0, 0xe6dcd8, 0xfff0e0] },
  brownstone: { upper: ['brick_c'], ground: ['store_b', 'door', 'store_shutter', 'store_a'], plain: 'brick_plain', trim: 'concrete_plain', roof: 'roof_tar', floors: [3, 5], colors: [0xffffff, 0xf0e8dc, 0xe8e0e8] },
  concrete:   { upper: ['concrete_a'], ground: ['store_shutter', 'store_a', 'lobby', 'store_neon'], plain: 'concrete_plain', trim: 'concrete_plain', roof: 'roof_gravel', floors: [5, 11], colors: [0xffffff, 0xe8ecf2, 0xf2ece4, 0xdcd8d0] },
  office:     { upper: ['office_a'], ground: ['lobby'], plain: 'concrete_plain', trim: 'concrete_plain', roof: 'roof_gravel', floors: [8, 16], colors: [0xffffff, 0xe0f0ff, 0xf0f0e8] },
  office_band:{ upper: ['office_b'], ground: ['lobby', 'store_a'], plain: 'concrete_plain', trim: 'concrete_plain', roof: 'roof_gravel', floors: [7, 15], colors: [0xffffff, 0xf4eee4, 0xe4e8ee] },
};
export const BUILDING_STYLES = Object.keys(STYLES);

// The four outward-facing walls of a rectangle: start point, along-wall unit, length.
function walls(x0, x1, z0, z1) {
  return [
    { s: [x0, z1], u: [1, 0], L: x1 - x0 },   // +z
    { s: [x1, z1], u: [0, -1], L: z1 - z0 },  // +x
    { s: [x1, z0], u: [-1, 0], L: x1 - x0 },  // -z
    { s: [x0, z0], u: [0, 1], L: z1 - z0 },   // -x
  ];
}
function wallQuad(B, w, a, b, y0, y1, tile, uv, color) {
  const p = (t, y) => [w.s[0] + w.u[0] * t, y, w.s[1] + w.u[1] * t];
  B.quad(p(a, y0), p(b, y0), p(b, y1), p(a, y1), tile, uv, color);
}

// ---- buildings ---------------------------------------------------------------
export function addBuilding(B, r, { x0, x1, z0, z1, y = CURB, style = 'brick', heightMul = 1, floors: fixedFloors }) {
  const S = STYLES[style];
  const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const floors = fixedFloors ?? Math.max(2, Math.round(r.int(S.floors[0], S.floors[1]) * heightMul));
  const color = r.pick(S.colors);
  const trimColor = 0xd8d4cc;
  const top = y + GROUND_H + floors * FLOOR_H;

  for (const w of walls(x0, x1, z0, z1)) {
    const n = Math.max(1, Math.round(w.L / 4));
    const seg = w.L / n;
    for (let i = 0; i < n; i++) wallQuad(B, w, i * seg, (i + 1) * seg, y, y + GROUND_H, r.pick(S.ground), [0, 0, 1, 1], color);
    // Split big facades into patches of at most 3 tiles x 3 floors. Smaller
    // polygons keep the affine warp and vertex snap from tearing tall walls.
    const tile = r.pick(S.upper), cols = Math.ceil(n / 3), rows = Math.ceil(floors / 3);
    for (let ci = 0; ci < cols; ci++) for (let ri = 0; ri < rows; ri++) {
      const u0 = (ci * n) / cols, u1 = ((ci + 1) * n) / cols, f0 = (ri * floors) / rows, f1 = ((ri + 1) * floors) / rows;
      wallQuad(B, w, u0 * seg, u1 * seg, y + GROUND_H + f0 * FLOOR_H, y + GROUND_H + f1 * FLOOR_H, tile, [u0, f0, u1, f1], color);
    }
  }
  // Cornice over the shopfronts, and a heavier one at the roofline.
  B.box(cx, y + GROUND_H - 0.1, cz, W + 0.5, 0.45, D + 0.5, { sides: { t: S.trim, s: 4 }, top: { t: S.trim, s: 4 }, bottom: { t: S.trim, s: 4 } }, trimColor);
  B.box(cx, top - 0.3, cz, W + 0.6, 0.5, D + 0.6, { sides: { t: S.trim, s: 4 }, bottom: { t: S.trim, s: 4 }, top: null }, trimColor);
  // Roof with parapet walls.
  B.quad([x0, top, z1], [x1, top, z1], [x1, top, z0], [x0, top, z0], S.roof, [0, 0, W / 4, D / 4]);
  const pw = 0.35, ph = 1.0;
  const par = { sides: { t: S.plain, s: 4 }, top: { t: S.trim, s: 2 } };
  B.box(cx, top, z1 - pw / 2, W, ph, pw, par, color);
  B.box(cx, top, z0 + pw / 2, W, ph, pw, par, color);
  B.box(x1 - pw / 2, top, cz, pw, ph, D - pw * 2, par, color);
  B.box(x0 + pw / 2, top, cz, pw, ph, D - pw * 2, par, color);

  // Rooftop dressing: what you see most of while flying.
  const inner = (m) => [r.range(x0 + m, x1 - m), r.range(z0 + m, z1 - m)];
  if ((style === 'brick' || style === 'brownstone') && r.chance(0.6) && W > 8 && D > 8) {
    const [tx, tz] = inner(3);
    for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.box(tx + lx, top, tz + lz, 0.2, 2.2, 0.2, 'metal', 0x6a6a6a);
    B.box(tx, top + 2.2, tz, 2.6, 0.15, 2.6, 'metal', 0x5a5a5a);
    B.cyl(tx, top + 2.35, tz, 1.4, 1.4, 2.6, 8, { t: 'water_tank', r: [3, 1] }, 'roof_tar');
    B.cyl(tx, top + 4.95, tz, 1.5, 0, 0.9, 8, { t: 'roof_tar', r: [2, 1] });
  }
  for (let k = r.int(0, 3); k > 0; k--) {
    const [ax, az] = inner(1.5);
    B.box(ax, top, az, 1.4, 0.9, 1.0, { sides: 'ac_unit', top: 'metal' }, 0xffffff);
  }
  if (r.chance(0.5) && W > 6) {
    const [sx, sz] = inner(2);
    B.box(sx, top, sz, 2.4, 2.6, 2.0, { sides: { t: S.plain, s: 3 }, pz: 'stair_box', top: S.roof }, color);
  }
  if (style.startsWith('office') && r.chance(0.7)) {
    const [ax, az] = inner(2);
    B.box(ax, top, az, 0.12, 6 + r() * 6, 0.12, 'metal', 0x9a9a9a);
  }
  if (r.chance(0.25) && W > 10 && floors < 9) {
    // Billboard facing +z.
    const bw = Math.min(W - 2, 9), bh = bw * 0.45, by = top + 2.2;
    B.box(cx - bw / 3, top, z1 - 2, 0.2, 2.2, 0.2, 'metal', 0x5a5a5a);
    B.box(cx + bw / 3, top, z1 - 2, 0.2, 2.2, 0.2, 'metal', 0x5a5a5a);
    B.box(cx, by, z1 - 2, bw, bh, 0.2, { pz: 'ad_board', sides: 'metal', top: 'metal' });
  }
  if (style === 'brick' && r.chance(0.35)) {
    // Vertical blade sign on the street corner.
    B.box(x0 + 1, y + GROUND_H + 0.8, z1 + 0.6, 0.25, 4.5, 1.2, { px: 'neon_sign', nx: 'neon_sign', sides: 'metal', top: 'metal', bottom: 'metal' });
  }
  return top;
}

// ---- street furniture (all local: +z faces the road) --------------------------
function lamp(B, x, z, ry) {
  B.pushTRS(x, CURB, z, ry);
  B.box(0, 0, 0, 0.32, 0.4, 0.32, 'lamp_post');
  B.box(0, 0.4, 0, 0.16, 5.4, 0.16, 'lamp_post');
  B.box(0, 5.6, 0.7, 0.12, 0.12, 1.5, 'lamp_post');
  B.box(0, 5.45, 1.45, 0.5, 0.22, 0.7, { sides: 'lamp_post', top: 'lamp_post', bottom: 'lamp_head' });
  B.pop();
}
function trafficLight(B, x, z, ry) {
  B.pushTRS(x, CURB, z, ry);
  B.box(0, 0, 0, 0.22, 5.2, 0.22, 'lamp_post', 0x8a8a70);
  B.box(0, 5.0, 1.8, 0.16, 0.16, 3.6, 'lamp_post', 0x8a8a70);
  B.box(0, 4.0, 3.4, 0.45, 1.1, 0.4, { nz: 'traffic', pz: 'traffic', sides: 'lamp_post', top: 'lamp_post', bottom: 'lamp_post' }, 0xffffff);
  B.pop();
}
function hydrant(B, x, z) {
  B.cyl(x, CURB, z, 0.16, 0.16, 0.55, 6, 'hydrant', 'hydrant');
  B.cyl(x, CURB + 0.55, z, 0.18, 0.05, 0.16, 6, 'hydrant');
  B.box(x, CURB + 0.3, z, 0.42, 0.1, 0.1, 'hydrant');
}
function trashCan(B, x, z) { B.cyl(x, CURB, z, 0.3, 0.33, 0.95, 7, { t: 'trash', r: [2, 1] }, 'trash'); }
function bench(B, x, z, ry) {
  B.pushTRS(x, CURB, z, ry);
  B.box(0, 0.42, 0, 1.8, 0.08, 0.45, 'bench');
  B.box(0, 0.55, -0.22, 1.8, 0.45, 0.06, 'bench');
  for (const lx of [-0.75, 0.75]) B.box(lx, 0, 0, 0.08, 0.42, 0.4, 'lamp_post', 0x5a5a5a);
  B.pop();
}

// Street furniture by name, for previews and hand-placed set dressing.
export function addStreetProp(B, kind, x, z, ry = 0) {
  if (kind === 'lamp') lamp(B, x, z, ry);
  else if (kind === 'traffic') trafficLight(B, x, z, ry);
  else if (kind === 'hydrant') hydrant(B, x, z);
  else if (kind === 'trash') trashCan(B, x, z);
  else if (kind === 'bench') bench(B, x, z, ry);
}

// ---- chunk -------------------------------------------------------------------
// Builds the static geometry of one city cell. Returns geometry plus spawn
// points (sidewalk paths, road lanes) for the dynamic layer: people and cars.
export function buildChunk(atlas, cx, cz, { seed = 1, downtown = 1 } = {}) {
  const B = new MeshBuilder(atlas);
  const r = seeded(((cx * 73856093) ^ (cz * 19349663) ^ seed) >>> 0);

  // Road surface for the whole cell, then markings drawn on the +x / +z roads.
  B.quad([-HALF, 0, HALF], [HALF, 0, HALF], [HALF, 0, -HALF], [-HALF, 0, -HALF], 'asphalt', [0, 0, CELL / 4, CELL / 4]);
  const mk = 0.04;
  const lineLen = LOT;
  B.quad([HALF - 0.25, mk, lineLen], [HALF + 0.25, mk, lineLen], [HALF + 0.25, mk, -lineLen], [HALF - 0.25, mk, -lineLen], 'road_dash', [0.43, 0, 0.57, (lineLen * 2) / 4]);
  B.quad([-lineLen, mk, HALF - 0.25], [-lineLen, mk, HALF + 0.25], [lineLen, mk, HALF + 0.25], [lineLen, mk, HALF - 0.25], 'road_dash', [0.43, 0, 0.57, (lineLen * 2) / 4]);
  // Crosswalks around this cell's +x/+z intersection.
  const c0 = HALF - ROAD_HALF, c1 = HALF + ROAD_HALF, cw = 3;
  // Stripes run along the road: roadAlongX picks which way the texture's v axis points.
  const xwalk = (x0, x1, z0, z1, roadAlongX) => roadAlongX
    ? B.quad([x0, mk, z0], [x0, mk, z1], [x1, mk, z1], [x1, mk, z0], 'crosswalk', [0, 0, (z1 - z0) / 4, (x1 - x0) / 4])
    : B.quad([x0, mk, z1], [x1, mk, z1], [x1, mk, z0], [x0, mk, z0], 'crosswalk', [0, 0, (x1 - x0) / 4, (z1 - z0) / 4]);
  xwalk(c0, c1, c0 - cw - 0.5, c0 - 0.5, false);
  xwalk(c0, c1, c1 + 0.5, c1 + cw + 0.5, false);
  xwalk(c0 - cw - 0.5, c0 - 0.5, c0, c1, true);
  xwalk(c1 + 0.5, c1 + cw + 0.5, c0, c1, true);

  // Sidewalk ring (raised slab with curb faces).
  const S0 = LOT, S1 = LOT + WALK;
  const walk = { top: { t: 'sidewalk', s: 2 }, sides: { t: 'curb', s: 2 } };
  B.box(0, 0, (S0 + S1) / 2, S1 * 2, CURB, WALK, walk);
  B.box(0, 0, -(S0 + S1) / 2, S1 * 2, CURB, WALK, walk);
  B.box((S0 + S1) / 2, 0, 0, WALK, CURB, S0 * 2, walk);
  B.box(-(S0 + S1) / 2, 0, 0, WALK, CURB, S0 * 2, walk);
  B.box(0, 0, 0, S0 * 2, CURB, S0 * 2, { top: { t: 'sidewalk', s: 2 }, sides: null });

  // Lots: split the block into 2-6 buildings, or leave a plaza.
  const plaza = r.chance(0.12);
  const lots = [];
  if (!plaza) {
    const splitX = r.chance(0.5);
    const rows = r.int(1, 2), cols = r.int(1, 3);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const ax = -LOT + (i * 2 * LOT) / cols, bx = -LOT + ((i + 1) * 2 * LOT) / cols;
      const az = -LOT + (j * 2 * LOT) / rows, bz = -LOT + ((j + 1) * 2 * LOT) / rows;
      lots.push(splitX ? { x0: ax, x1: bx, z0: az, z1: bz } : { x0: az, x1: bz, z0: ax, z1: bx });
    }
  }
  const dist = Math.hypot(cx, cz);
  const core = Math.max(0, 1 - dist / 4) * downtown;
  const colliders = [];
  for (const lot of lots) {
    const g = 0.4; // alley gap
    const st = core > 0.5 ? r.pick(['office', 'office', 'office_band', 'concrete'])
      : core > 0.15 ? r.pick(['concrete', 'office_band', 'brick', 'concrete'])
      : r.pick(['brick', 'brick', 'brownstone', 'concrete']);
    const box = { x0: lot.x0 + g, x1: lot.x1 - g, z0: lot.z0 + g, z1: lot.z1 - g };
    const top = addBuilding(B, r, { ...box, style: st, heightMul: 0.85 + core * 0.45 });
    colliders.push({ ...box, top: top + 1.0 }); // +1 m parapet
  }
  if (plaza) {
    for (let k = 0; k < 6; k++) bench(B, r.range(-16, 16), r.range(-16, 16), r.int(0, 3) * Math.PI / 2);
    for (const [x, z] of [[-12, -12], [12, -12], [12, 12], [-12, 12]]) lamp(B, x, z, 0);
    B.cyl(0, CURB, 0, 4, 4, 0.6, 10, { t: 'concrete_plain', r: [4, 1] }, 'roof_gravel', null, 0xffffff);
    B.cyl(0, CURB + 0.6, 0, 3.6, 3.6, 0.01, 10, 'roof_gravel', 'roof_gravel', null, 0x7aa85a);
  }

  // Furniture along the curb. Lamps face the road.
  const edge = S1 - 0.6;
  const sides = [[0, 1, 0], [1, 0, Math.PI / 2], [0, -1, Math.PI], [-1, 0, -Math.PI / 2]];
  for (const [dx, dz, ry] of sides) {
    for (let t = -LOT + 6; t <= LOT - 6; t += 16) {
      const x = dx ? dx * edge : t, z = dz ? dz * edge : t;
      lamp(B, x, z, ry);
      const t2 = t + 5 + r() * 4;
      const x2 = dx ? dx * (edge - 0.3) : t2, z2 = dz ? dz * (edge - 0.3) : t2;
      const roll = r();
      if (roll < 0.25) hydrant(B, x2, z2);
      else if (roll < 0.55) trashCan(B, x2, z2);
      else if (roll < 0.7) bench(B, dx ? dx * (S0 + 0.8) : t2, dz ? dz * (S0 + 0.8) : t2, ry);
    }
  }
  trafficLight(B, S1 - 0.5, S1 - 0.5, Math.PI / 2);

  const geometry = B.toGeometry();
  // Sidewalk loop (for pedestrians) and the two lanes of the +x road (for traffic).
  const mid = (S0 + S1) / 2;
  return {
    geometry, triangles: B.triangles, colliders, plaza,
    sidewalk: [[-mid, mid], [mid, mid], [mid, -mid], [-mid, -mid]],
    lanes: [{ x: HALF - 3, dir: 1 }, { x: HALF + 3, dir: -1 }],
  };
}
