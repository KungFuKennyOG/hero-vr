// Builds city chunks off the main thread so fast flight doesn't stutter.
import { createAtlas } from '../art/atlas.js';
import { buildChunk } from '../art/city.js';

const atlas = createAtlas();
const NAMES = ['position', 'normal', 'uv', 'aTile', 'aColor', 'aTint'];

self.onmessage = (e) => {
  const { cx, cz, seed } = e.data;
  const c = buildChunk(atlas, cx, cz, { seed });
  const attrs = {}, transfer = [];
  for (const n of NAMES) { const a = c.geometry.attributes[n].array; attrs[n] = a; transfer.push(a.buffer); }
  self.postMessage({ cx, cz, attrs, colliders: c.colliders, plaza: c.plaza, sidewalk: c.sidewalk, lanes: c.lanes }, transfer);
};
