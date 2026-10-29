// Vehicles, people and the player's hands.
// People are segmented rigid parts (the way PS1 games actually did characters):
// no skinning cost, and every part maps 1:1 to a ragdoll body later.
import * as THREE from '../../vendor/three.module.js';
import { MeshBuilder, seeded } from './builder.js';

// ---- vehicles (forward = +z, origin on the ground) --------------------------
export const VEHICLE_TYPES = ['sedan', 'taxi', 'police', 'bus'];
const CAR_COLORS = [0xc83a2a, 0x2a4a8a, 0x3a3a3c, 0xd8d8d0, 0x4a6a4a, 0x7a2a4a, 0xb8a080, 0x6a7a8a];

function wheel(B, x, y, z, r, w) {
  B.pushTRS(x, y, z, 0, 0, Math.PI / 2);
  B.cyl(0, -w / 2, 0, r, r, w, 8, 'tire', 'tire', 'tire');
  B.pop();
}

export function buildVehicle(atlas, type = 'sedan', color, tint = 0) {
  const B = new MeshBuilder(atlas);
  if (type === 'bus') {
    const L = 11, W = 2.5;
    color ??= 0x3a78c8;
    B.box(0, 0.35, 0, W, 2.75, L, { sides: { t: 'bus_side', r: [4, 1] }, pz: 'bus_front', nz: 'car_back', top: { t: 'metal', s: 3 }, bottom: 'tire' }, color, tint);
    B.box(0, 3.1, -1, 1.6, 0.35, 3, { sides: 'metal', top: 'metal' }, 0xc8ccd0);
    for (const z of [3.6, -3.4]) for (const x of [-1.1, 1.1]) wheel(B, x, 0.5, z, 0.5, 0.3);
    return { geometry: B.toGeometry(), size: [W, 3.45, L], mass: 12000 };
  }
  const L = 4.4, W = 1.8;
  const side = type === 'taxi' ? 'taxi_stripe' : type === 'police' ? 'police_door' : 'car_body';
  color ??= type === 'taxi' ? 0xf2c230 : type === 'police' ? 0xffffff : CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0];
  B.box(0, 0.3, 0, W, 0.62, L, { sides: { t: side, r: [1, 1] }, pz: 'car_front', nz: 'car_back', top: { t: 'car_body', r: [1, 2] }, bottom: 'tire' }, color, tint);
  const roofColor = type === 'police' ? 0x24262c : color;
  B.taper(0, 0.92, -0.25, W - 0.1, 2.5, W - 0.3, 1.5, 0.56, -0.15, { sides: 'car_window', top: null }, 0xffffff);
  B.taper(0, 0.92, -0.25, W - 0.1, 2.5, W - 0.3, 1.5, 0.56, -0.15, { sides: null, top: 'car_body' }, roofColor, type === 'police' ? 0 : tint);
  // Bumpers.
  B.box(0, 0.28, L / 2 + 0.05, W - 0.1, 0.18, 0.12, 'metal', 0x5a5a5e);
  B.box(0, 0.28, -L / 2 - 0.05, W - 0.1, 0.18, 0.12, 'metal', 0x5a5a5e);
  if (type === 'taxi') B.box(0, 1.48, -0.3, 0.7, 0.24, 0.3, { pz: 'taxi_sign', nz: 'taxi_sign', sides: 'metal', top: 'metal' }, 0xffffff);
  if (type === 'police') B.box(0, 1.48, -0.25, 1.2, 0.16, 0.3, 'light_bar');
  for (const z of [1.4, -1.35]) for (const x of [-0.82, 0.82]) wheel(B, x, 0.34, z, 0.34, 0.24);
  return { geometry: B.toGeometry(), size: [W, 1.5, L], mass: 1400 };
}

// Loose physics props: crates and dumpsters to throw around.
export function buildCrate(atlas, size = 1) {
  const B = new MeshBuilder(atlas);
  B.box(0, 0, 0, size, size, size, { all: 'crate', bottom: 'crate' });
  return { geometry: B.toGeometry(), size: [size, size, size], mass: 40 * size };
}
export function buildDumpster(atlas) {
  const B = new MeshBuilder(atlas);
  B.taper(0, 0.25, 0, 1.8, 1.1, 1.9, 1.3, 1.1, 0, { sides: { t: 'dumpster', r: [2, 1] }, top: 'rust', bottom: 'rust' });
  B.box(0, 1.35, -0.05, 1.95, 0.08, 1.35, { all: 'metal', bottom: 'metal' }, 0x2a3a36);
  for (const x of [-0.7, 0.7]) for (const z of [-0.4, 0.4]) B.box(x, 0, z, 0.12, 0.25, 0.12, 'tire', 0xffffff);
  return { geometry: B.toGeometry(), size: [1.9, 1.45, 1.3], mass: 400 };
}

// ---- people ------------------------------------------------------------------
export const PERSON_KINDS = ['civilian', 'cop', 'thug', 'swat'];
const SKINS = [0xf2cdb0, 0xdca37c, 0xb47a52, 0x7a4c34, 0x5a3626, 0xe8bc98];
const HAIRS = [0x2a1a10, 0x4a3020, 0x8a6a3a, 0x18181a, 0xc8a060, 0x7a3a22];
const SHIRTS = [0xc8483a, 0x3a6ab8, 0xe8d8b0, 0x4a8a5a, 0xd8a030, 0x8a5aa8, 0xf0f0f0, 0x3a3a3a];

function outfit(kind, r) {
  const skin = r.pick(SKINS), hair = r.pick(HAIRS);
  const base = { skin, hair, face: 'face', faceColor: skin, shoe: 0xffffff };
  switch (kind) {
    case 'cop': return { ...base, shirt: 'uniform', shirtColor: 0xffffff, sleeve: 'uniform', arm: 'uniform', armColor: 0xffffff, pants: 'cloth', pantsColor: 0x2a3450, hat: 'cap', tint: 0 };
    case 'thug': {
      const hood = r.pick([0x3a3a3c, 0x7a1e1e, 0x2e4a2e, 0x5a5a6a, 0x8a6a2a]);
      return { ...base, face: 'face_thug', shirt: 'hoodie', shirtColor: hood, sleeve: 'hoodie', arm: 'hoodie', armColor: hood, pants: r.chance(0.5) ? 'jeans' : 'cloth', pantsColor: r.chance(0.5) ? 0xffffff : 0x2e2e30, hat: 'hood', hatColor: hood, tint: 1 };
    }
    case 'swat': return { ...base, face: 'face_swat', faceColor: 0xffffff, shirt: 'vest_swat', shirtColor: 0xffffff, sleeve: 'cloth', arm: 'cloth', armColor: 0x34363a, pants: 'cloth', pantsColor: 0x34363a, hat: 'helmet', tint: 0 };
    default: {
      const shirt = r.pick(SHIRTS), longSleeve = r.chance(0.45);
      const jeans = r.chance(0.55);
      return { ...base, shirt: 'cloth', shirtColor: shirt, sleeve: 'cloth', arm: longSleeve ? 'cloth' : 'skin', armColor: longSleeve ? shirt : skin, pants: jeans ? 'jeans' : 'cloth', pantsColor: jeans ? 0xffffff : r.pick([0xb8a07a, 0x3a3a3c, 0x7a7a80, 0x4a3a2a]), hat: r.chance(0.15) ? 'cap' : null, hatColor: r.pick(SHIRTS), tint: 1 };
    }
  }
}

// Part layout: [name, parent, pivot relative to parent, builder]. Pivots sit on
// joints, so rotating a part swings it like a limb (and ragdoll joints match).
function personParts(o) {
  const T = o.tint;
  return [
    ['pelvis', null, [0, 0.95, 0], (B) => B.box(0, -0.12, 0, 0.32, 0.2, 0.2, { all: o.pants, bottom: o.pants }, o.pantsColor)],
    ['torso', 'pelvis', [0, 0.06, 0], (B) => {
      B.taper(0, 0, 0, 0.32, 0.2, 0.44, 0.24, 0.5, 0, { sides: o.shirt, top: o.shirt, bottom: o.shirt }, o.shirtColor, T);
    }],
    ['head', 'torso', [0, 0.5, 0], (B) => {
      B.box(0, 0, 0, 0.1, 0.06, 0.1, 'skin', o.skin);
      const sideTile = o.hat === 'helmet' ? 'cloth' : 'skin', sideColor = o.hat === 'helmet' ? 0x2a2c30 : o.skin;
      B.box(0, 0.05, 0, 0.23, 0.26, 0.24, { pz: null, sides: sideTile, top: 'hair', bottom: 'skin' }, sideColor);
      B.box(0, 0.05, 0, 0.23, 0.26, 0.24, { pz: o.face, sides: null, top: null }, o.faceColor);
      if (o.hat === 'cap') {
        B.box(0, 0.27, -0.005, 0.25, 0.08, 0.26, { all: 'cloth' }, o.hatColor ?? 0x232c48);
        B.box(0, 0.27, 0.16, 0.22, 0.025, 0.1, { all: 'cloth' }, o.hatColor ?? 0x232c48);
      } else if (o.hat === 'hood') {
        B.box(0, 0.02, -0.03, 0.27, 0.33, 0.24, { sides: 'hoodie', top: 'hoodie', pz: null }, o.hatColor, T);
      } else if (o.hat === 'helmet') {
        B.box(0, 0.24, 0, 0.27, 0.12, 0.28, { all: 'cloth' }, 0x1e2024);
      } else {
        B.box(0, 0.27, -0.01, 0.25, 0.05, 0.26, { all: 'hair' }, o.hair);
        B.box(0, 0.08, -0.125, 0.25, 0.22, 0.03, { all: 'hair' }, o.hair);
      }
    }],
    ['armUR', 'torso', [-0.27, 0.46, 0], (B) => B.box(0, -0.3, 0, 0.11, 0.3, 0.12, { all: o.sleeve, bottom: o.sleeve }, o.shirtColor, T)],
    ['armLR', 'armUR', [0, -0.3, 0], (B) => {
      B.box(0, -0.26, 0, 0.1, 0.26, 0.1, { all: o.arm, bottom: o.arm }, o.armColor, o.arm === 'skin' ? 0 : T);
      B.box(0, -0.36, 0.01, 0.09, 0.1, 0.07, { all: 'skin', bottom: 'skin' }, o.skin);
    }],
    ['armUL', 'torso', [0.27, 0.46, 0], (B) => B.box(0, -0.3, 0, 0.11, 0.3, 0.12, { all: o.sleeve, bottom: o.sleeve }, o.shirtColor, T)],
    ['armLL', 'armUL', [0, -0.3, 0], (B) => {
      B.box(0, -0.26, 0, 0.1, 0.26, 0.1, { all: o.arm, bottom: o.arm }, o.armColor, o.arm === 'skin' ? 0 : T);
      B.box(0, -0.36, 0.01, 0.09, 0.1, 0.07, { all: 'skin', bottom: 'skin' }, o.skin);
    }],
    ['legUR', 'pelvis', [-0.085, -0.12, 0], (B) => B.box(0, -0.42, 0, 0.14, 0.42, 0.15, { all: o.pants }, o.pantsColor)],
    ['legLR', 'legUR', [0, -0.42, 0], (B) => {
      B.box(0, -0.36, 0, 0.13, 0.36, 0.14, { all: o.pants }, o.pantsColor);
      B.box(0, -0.43, 0.04, 0.14, 0.08, 0.25, { all: 'shoe', bottom: 'shoe' }, o.shoe);
    }],
    ['legUL', 'pelvis', [0.085, -0.12, 0], (B) => B.box(0, -0.42, 0, 0.14, 0.42, 0.15, { all: o.pants }, o.pantsColor)],
    ['legLL', 'legUL', [0, -0.42, 0], (B) => {
      B.box(0, -0.36, 0, 0.13, 0.36, 0.14, { all: o.pants }, o.pantsColor);
      B.box(0, -0.43, 0.04, 0.14, 0.08, 0.25, { all: 'shoe', bottom: 'shoe' }, o.shoe);
    }],
  ];
}

// Segmented person: a Group of 11 meshes on joint pivots (nearby, ragdoll-able).
export function buildPerson(atlas, material, kind = 'civilian', seed = 1) {
  const o = outfit(kind, seeded(seed));
  const group = new THREE.Group();
  const parts = {};
  let tris = 0;
  for (const [name, parent, pivot, build] of personParts(o)) {
    const B = new MeshBuilder(atlas);
    build(B);
    tris += B.triangles;
    const mesh = new THREE.Mesh(B.toGeometry(), material);
    mesh.name = name;
    mesh.position.set(...pivot);
    (parent ? parts[parent] : group).add(mesh);
    parts[name] = mesh;
  }
  group.userData = { kind, parts, triangles: tris };
  return group;
}

// Per-part geometries for instanced rendering (one InstancedMesh per part
// across every person of this kind). Tintable parts are white + aTint = 1.
export function buildPersonParts(atlas, kind = 'civilian', seed = 1) {
  const o = outfit(kind, seeded(seed));
  if (o.tint) { o.shirtColor = 0xffffff; if (o.arm !== 'skin') o.armColor = 0xffffff; if (o.hat === 'hood') o.hatColor = 0xffffff; }
  return personParts(o).map(([name, parent, pivot, build]) => {
    const B = new MeshBuilder(atlas);
    build(B);
    return { name, parent, pivot, geometry: B.toGeometry() };
  });
}

// Single-geometry person for crowds: one InstancedMesh = a whole crowd in one
// draw call. Shirts carry aTint = 1, so instanceColor recolours outfits.
export function buildPersonMerged(atlas, kind = 'civilian', seed = 1) {
  const o = outfit(kind, seeded(seed));
  if (o.tint) { o.shirtColor = 0xffffff; if (o.arm !== 'skin') o.armColor = 0xffffff; if (o.hat === 'hood') o.hatColor = 0xffffff; }
  const B = new MeshBuilder(atlas);
  const abs = {};
  for (const [name, parent, pivot, build] of personParts(o)) {
    const p = parent ? abs[parent] : [0, 0, 0];
    abs[name] = [p[0] + pivot[0], p[1] + pivot[1], p[2] + pivot[2]];
    B.pushTRS(...abs[name]);
    build(B);
    B.pop();
  }
  return { geometry: B.toGeometry(), triangles: B.triangles };
}

// ---- player hands -------------------------------------------------------------
// Wrist at the origin, fingers toward -z, palm facing -y (the flight pose).
// The palm core is emissive, so it glows harder as the city darkens.
export function buildHand(atlas, style = 'hero', side = 'right') {
  const B = new MeshBuilder(atlas);
  const glove = style === 'hero' ? 0x2858b8 : 0x1c181a;
  const cuffColor = style === 'hero' ? 0xf0f0f0 : 0x8a1a14;
  if (side === 'left') B.push(new THREE.Matrix4().makeScale(-1, 1, 1));
  const palmTile = style === 'hero' ? 'glove_hero' : 'glove_villain';
  B.box(0, -0.045, 0.05, 0.1, 0.09, 0.1, { all: 'cloth', bottom: 'cloth' }, cuffColor);
  B.box(0, -0.03, -0.055, 0.095, 0.055, 0.11, { sides: 'cloth', top: 'cloth', bottom: palmTile }, glove);
  const fingers = [[-0.034, 0.92], [-0.011, 1], [0.012, 0.97], [0.034, 0.82]];
  for (const [x, len] of fingers) {
    B.pushTRS(x, -0.012, -0.11, 0, -0.3);
    B.box(0, -0.011, -0.022 * len, 0.02, 0.022, 0.045 * len, { all: 'cloth', bottom: 'cloth' }, glove);
    B.pushTRS(0, 0, -0.045 * len, 0, -0.45);
    B.box(0, -0.01, -0.019 * len, 0.019, 0.02, 0.038 * len, { all: 'cloth', bottom: 'cloth' }, glove);
    B.pop();
    B.pop();
  }
  B.pushTRS(-0.052, -0.02, -0.035, 0.7, -0.2, 0.3);
  B.box(0, -0.011, -0.025, 0.024, 0.024, 0.05, { all: 'cloth', bottom: 'cloth' }, glove);
  B.pop();
  if (side === 'left') B.pop();
  return { geometry: B.toGeometry(), triangles: B.triangles };
}
