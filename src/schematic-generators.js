'use strict';
// Parametric village parts, generated in code from a material set. Each is
// plain cuboid geometry the executor can place exactly, with stairs and slabs
// where the design calls for them. They exist so the shelf holds every part
// a village wants without a generative model drawing anything.
const cuboid = (from, to, block, properties) => ({ from, to, block, ...(properties ? { properties } : {}) });

// A stone well: a low ring, two posts and a little roof, open on all sides.
function well({ stone = 'cobblestone', wood = 'oak_planks', slab = 'oak_slab' } = {}) {
  const regions = [
    cuboid([1, 0, 1], [3, 1, 3], stone), cuboid([2, 1, 2], [2, 1, 2], 'air'),
    cuboid([1, 2, 1], [1, 3, 1], wood), cuboid([3, 2, 3], [3, 3, 3], wood),
    cuboid([1, 2, 3], [1, 3, 3], wood), cuboid([3, 2, 1], [3, 3, 1], wood),
    cuboid([0, 4, 0], [4, 4, 4], slab, { facing: null, half: 'bottom' }),
    cuboid([1, 5, 1], [3, 5, 3], slab, { facing: null, half: 'bottom' }),
  ];
  return { name: `${stone.replaceAll('_', ' ')} well`, description: `A village well: a ${stone.replaceAll('_', ' ')} ring with ${wood.replace('_planks', '')} posts and a little slab roof, open on every side.`,
    size: [5, 6, 5], palette: [...new Set([stone, wood, slab])], regions, entrance: null };
}

// A fenced farm plot: a raised plank border around tilled-looking dirt, with
// a gap to walk in. Fences are not in the executor's palette, so the border
// is a low wall of planks.
function farm({ wood = 'oak_planks', slab = 'oak_slab' } = {}) {
  const w = 9, d = 7;
  const regions = [
    cuboid([0, 0, 0], [w - 1, 0, d - 1], 'dirt'),
    cuboid([0, 1, 0], [w - 1, 1, 0], wood), cuboid([0, 1, d - 1], [w - 1, 1, d - 1], wood),
    cuboid([0, 1, 0], [0, 1, d - 1], wood), cuboid([w - 1, 1, 0], [w - 1, 1, d - 1], wood),
    cuboid([4, 1, 0], [4, 1, 0], 'air'),
    cuboid([0, 2, 0], [0, 2, 0], slab, { facing: null, half: 'bottom' }), cuboid([w - 1, 2, 0], [w - 1, 2, 0], slab, { facing: null, half: 'bottom' }),
    cuboid([0, 2, d - 1], [0, 2, d - 1], slab, { facing: null, half: 'bottom' }), cuboid([w - 1, 2, d - 1], [w - 1, 2, d - 1], slab, { facing: null, half: 'bottom' }),
  ];
  return { name: `${wood.replace('_planks', '').replaceAll('_', ' ')} farm plot`, description: 'A fenced farm plot: a low plank border around a bed of soil with an opening to walk in.',
    size: [w, 3, d], palette: [...new Set(['dirt', wood, slab])], regions, entrance: null };
}

// A chapel: a hall with glass windows, a pitched roof of stairs, and a
// square steeple at the entrance end.
function chapel({ stone = 'stone_bricks', roof = 'stone_brick_stairs', glass = 'glass', door = 'oak_door' } = {}) {
  const w = 7, d = 13, wall = 5;
  const regions = [
    cuboid([0, 0, 0], [w - 1, wall, d - 1], stone), cuboid([1, 1, 1], [w - 2, wall - 1, d - 2], 'air'),
  ];
  for (const z of [3, 6, 9]) { regions.push(cuboid([0, 2, z], [0, 3, z], glass), cuboid([w - 1, 2, z], [w - 1, 3, z], glass)); }
  regions.push(cuboid([3, 3, d - 1], [3, 4, d - 1], glass));
  // Pitched roof: stairs climbing from each long side, a ridge of blocks.
  for (let step = 0; step < 3; step++) {
    const y = wall + 1 + step;
    regions.push(cuboid([step, y, 0], [step, y, d - 1], roof, { facing: 'east', half: 'bottom' }));
    regions.push(cuboid([w - 1 - step, y, 0], [w - 1 - step, y, d - 1], roof, { facing: 'west', half: 'bottom' }));
    if (step) regions.push(cuboid([step, y - 1, 0], [w - 1 - step, y - 1, d - 1], stone));
  }
  regions.push(cuboid([3, wall + 3, 0], [3, wall + 3, d - 1], stone));
  // Steeple over the entrance bay.
  regions.push(cuboid([2, wall + 1, 0], [4, wall + 8, 2], stone), cuboid([3, wall + 1, 1], [3, wall + 7, 1], 'air'));
  regions.push(cuboid([2, wall + 6, 0], [4, wall + 6, 0], glass), cuboid([3, wall + 9, 1], [3, wall + 10, 1], stone));
  regions.push(cuboid([3, 1, 0], [3, 2, 0], 'air'), cuboid([3, 1, 0], [3, 1, 0], door, { facing: 'south', half: null }));
  return { name: `${stone.replace('_bricks', ' brick').replaceAll('_', ' ')} chapel`, description: 'A small chapel: a hall with windows down each side, a pitched roof and a square steeple over the door.',
    size: [w, wall + 11, d], palette: [...new Set([stone, roof, glass, door])], regions, entrance: [3, 1, 0] };
}

// A barn: a wide plank hall with a big door opening and a stepped roof.
function barn({ wood = 'spruce_planks', roof = 'spruce_stairs', trim = 'cobblestone' } = {}) {
  const w = 11, d = 9, wall = 5;
  const regions = [
    cuboid([0, 0, 0], [w - 1, 0, d - 1], trim), cuboid([0, 1, 0], [w - 1, wall, d - 1], wood), cuboid([1, 1, 1], [w - 2, wall, d - 2], 'air'),
    cuboid([4, 1, 0], [6, 3, 0], 'air'),
  ];
  for (let step = 0; step < 4; step++) {
    const y = wall + 1 + step;
    regions.push(cuboid([step, y, 0], [step, y, d - 1], roof, { facing: 'east', half: 'bottom' }));
    regions.push(cuboid([w - 1 - step, y, 0], [w - 1 - step, y, d - 1], roof, { facing: 'west', half: 'bottom' }));
    regions.push(cuboid([step + 1, y, 0], [w - 2 - step, y, d - 1], wood));
    if (step) regions.push(cuboid([step + 1, y, 1], [w - 2 - step, y, d - 2], 'air'));
  }
  regions.push(cuboid([4, wall + 5, 0], [6, wall + 5, d - 1], wood));
  return { name: `${wood.replace('_planks', '').replaceAll('_', ' ')} barn`, description: 'A barn: a wide hall on a stone footing with a big open doorway and a stepped roof.',
    size: [w, wall + 6, d], palette: [...new Set([trim, wood, roof])], regions, entrance: [5, 1, 0] };
}

// A lamp post: a slim column with a glowing top, for the lanes between houses.
function lamp({ post = 'cobblestone', light = 'glowstone' } = {}) {
  return { name: `${post.replaceAll('_', ' ')} lamp post`, description: 'A lamp post: a slim column topped with a light block, for the lanes between the houses.',
    size: [1, 5, 1], palette: [post, light], regions: [cuboid([0, 0, 0], [0, 3, 0], post), cuboid([0, 4, 0], [0, 4, 0], light)], entrance: null };
}

// A plaza: a paved square with a raised centre and four lights at the corners.
function plaza({ paving = 'stone_bricks', slab = 'stone_brick_slab', light = 'sea_lantern' } = {}) {
  const s = 9;
  const regions = [cuboid([0, 0, 0], [s - 1, 0, s - 1], paving), cuboid([3, 1, 3], [5, 1, 5], slab, { facing: null, half: 'bottom' }), cuboid([4, 1, 4], [4, 2, 4], paving), cuboid([4, 3, 4], [4, 3, 4], light)];
  for (const [x, z] of [[0, 0], [0, s - 1], [s - 1, 0], [s - 1, s - 1]]) regions.push(cuboid([x, 1, z], [x, 2, z], paving), cuboid([x, 3, z], [x, 3, z], light));
  return { name: `${paving.replace('_bricks', ' brick').replaceAll('_', ' ')} plaza`, description: 'A paved square with a lit centre and lamps at the corners: the middle of the village.',
    size: [s, 4, s], palette: [...new Set([paving, slab, light])], regions, entrance: null };
}

function generatedEntries() {
  const entries = [];
  const add = (part, id, source) => entries.push({ id, part, origin: 'Generated from a parametric village part in code', source });
  for (const [stone, wood] of [['cobblestone', 'oak_planks'], ['stone_bricks', 'spruce_planks'], ['mossy_cobblestone', 'dark_oak_planks'], ['sandstone', 'birch_planks']]) {
    add('well', `well-${stone}-${wood.replace('_planks', '')}`, well({ stone, wood, slab: wood.replace('_planks', '_slab') }));
  }
  for (const wood of ['oak_planks', 'spruce_planks', 'birch_planks', 'dark_oak_planks']) add('farm', `farm-${wood.replace('_planks', '')}`, farm({ wood, slab: wood.replace('_planks', '_slab') }));
  for (const [stone, roof, door] of [['stone_bricks', 'stone_brick_stairs', 'oak_door'], ['cobblestone', 'cobblestone_stairs', 'spruce_door'], ['sandstone', 'sandstone_stairs', 'birch_door'], ['deepslate_bricks', 'deepslate_brick_stairs', 'dark_oak_door']]) {
    add('chapel', `chapel-${stone}`, chapel({ stone, roof, door }));
  }
  for (const [wood, roof, trim] of [['spruce_planks', 'spruce_stairs', 'cobblestone'], ['oak_planks', 'oak_stairs', 'stone'], ['dark_oak_planks', 'dark_oak_stairs', 'cobblestone'], ['birch_planks', 'birch_stairs', 'sandstone']]) {
    add('barn', `barn-${wood.replace('_planks', '')}`, barn({ wood, roof, trim }));
  }
  for (const [post, light] of [['cobblestone', 'glowstone'], ['stone_bricks', 'sea_lantern'], ['oak_planks', 'glowstone'], ['sandstone', 'glowstone']]) add('lamp', `lamp-${post}-${light}`, lamp({ post, light }));
  for (const [paving, slab, light] of [['stone_bricks', 'stone_brick_slab', 'sea_lantern'], ['cobblestone', 'cobblestone_slab', 'glowstone'], ['sandstone', 'sandstone_slab', 'glowstone'], ['polished_andesite', 'polished_andesite_slab', 'sea_lantern']]) {
    add('plaza', `plaza-${paving}`, plaza({ paving, slab, light }));
  }
  return entries;
}

module.exports = { well, farm, chapel, barn, lamp, plaza, generatedEntries };
