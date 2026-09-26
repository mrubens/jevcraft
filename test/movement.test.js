'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { configureMovements, updateDigCapabilities } = require('../src/movement');

function botFixture() {
  const registry = require('prismarine-registry')('26.1');
  const bot = { registry, inventory: { items: () => [] }, entities: {}, entity: { position: new Vec3(0, 70, 0) }, game: { minY: -64 },
    pathfinder: { setMovements: m => { bot.pathfinder.movements = m; } } };
  return bot;
}

test('movement refuses deep water drops as well as deep dry drops', () => {
  const bot = botFixture();
  const movement = configureMovements(bot);
  // A tempting water landing 20 blocks below the current ledge.
  movement.getBlock = (p, dx, dy, dz) => ({ position: new Vec3(p.x + dx, p.y + dy, p.z + dz), safe: true, liquid: false });
  movement.getLandingBlock = () => ({ position: new Vec3(1, 50, 0), safe: true, liquid: true });
  const neighbors = [];
  movement.getMoveDropDown({ x: 0, y: 70, z: 0, remainingBlocks: 0 }, new Vec3(1, 0, 0), neighbors);
  assert.equal(neighbors.length, 0);
  assert.equal(movement.allowSprinting, false);
});

test('drop allowance measures feet-to-landing distance, including a full three-block dry drop', () => {
  const bot = botFixture(), Block = require('prismarine-block')(bot.registry);
  let drop = 3;
  bot.blockAt = point => {
    const p = point.floored(), name = p.y < (p.x === 0 ? 70 : 70 - drop) ? 'stone' : 'air';
    const block = Block.fromStateId(bot.registry.blocksByName[name].defaultState); block.position = p; return block;
  };
  const movement = configureMovements(bot); movement.canDig = false;
  for (const limit of [2, 3]) for (drop of [limit, limit + 1]) {
    movement.maxDropDown = limit;
    const neighbors = [];
    movement.getMoveDropDown({ x: 0, y: 70, z: 0, remainingBlocks: 0 }, new Vec3(1, 0, 0), neighbors);
    assert.equal(neighbors.length, drop <= limit ? 1 : 0, `${drop}-block drop with allowance ${limit}`);
    if (neighbors.length) assert.equal(neighbors[0].y, 70 - drop);
    assert.equal(movement.maxDropDown, limit);
  }
});

test('natural rock can be cleared only with a harvesting pickaxe; crafted blocks stay protected', () => {
  const bot = botFixture();
  const movement = configureMovements(bot);
  const stone = bot.registry.blocksByName.stone.id;
  assert(movement.blocksCantBreak.has(stone));
  bot.inventory.items = () => [{ name: 'wooden_pickaxe', type: bot.registry.itemsByName.wooden_pickaxe.id }];
  updateDigCapabilities(bot);
  assert(!movement.blocksCantBreak.has(stone));
  assert(movement.blocksCantBreak.has(bot.registry.blocksByName.cobblestone.id));
  assert(movement.blocksCantBreak.has(bot.registry.blocksByName.oak_planks.id));
});

test('navigation does not dig a vertical shaft directly beneath its feet', () => {
  const bot = botFixture();
  const movement = configureMovements(bot);
  movement.getBlock = () => ({ physical: true, climbable: false });
  const neighbors = [];
  movement.getMoveDown({ x: 0, y: 70, z: 0, remainingBlocks: 0 }, neighbors);
  assert.equal(neighbors.length, 0);
});

test('walking retains flat diagonals but climbs and swimming corners use cardinal routes', () => {
  const bot = botFixture(), movement = configureMovements(bot);
  for (const mode of ['flat', 'step', 'swim']) {
    movement.getBlock = (p, dx, dy, dz) => {
      const position = new Vec3(p.x + dx, p.y + dy, p.z + dz);
      const physical = position.y < 70 || mode === 'step' && position.x === 1 && position.z === 1 && position.y === 70;
      return { position, physical, safe: !physical, liquid: mode === 'swim' && position.y === 70,
        height: position.y + (physical ? 1 : 0) };
    };
    const node = { x: 0, y: 70, z: 0, remainingBlocks: 0 }, diagonal = [], cardinal = [];
    movement.getMoveDiagonal(node, new Vec3(1, 0, 1), diagonal);
    assert.equal(diagonal.length, mode === 'flat' ? 1 : 0, mode);
    movement.getMoveForward(node, new Vec3(1, 0, 0), cardinal);
    assert(cardinal.length, 'Retains the cardinal approach instead of declaring the area inaccessible');
  }
});

test('solid damaging floors are excluded even when the body space is air', () => {
  for (const name of ['magma_block', 'campfire', 'cactus']) {
    const bot = botFixture(), Block = require('prismarine-block')(bot.registry);
    bot.blockAt = point => {
      const p = point.floored(), blockName = p.y < 70 ? p.y === 69 && p.x === 1 && p.z === 0 ? name : 'stone' : 'air';
      const block = Block.fromStateId(bot.registry.blocksByName[blockName].defaultState); block.position = p; return block;
    };
    const movement = configureMovements(bot); movement.canDig = false;
    const neighbors = movement.getNeighbors({ x: 0, y: 70, z: 0, remainingBlocks: 0 });
    assert(!neighbors.some(p => p.x === 1 && p.z === 0), name);
    assert(neighbors.some(p => p.x === -1 && p.z === 0), 'Keeps a safe route available');
  }
});

test('flat diagonals cannot skim a lava corner beside a dry destination', () => {
  const bot = botFixture(), movement = configureMovements(bot);
  movement.getBlock = (p, dx, dy, dz) => {
    const position = new Vec3(p.x + dx, p.y + dy, p.z + dz), lava = position.x === 1 && position.z === 0 && position.y === 69;
    const physical = position.y < 70 && !lava;
    return { name: lava ? 'lava' : physical ? 'stone' : 'air', position, liquid: lava, safe: !physical && !lava,
      physical, height: position.y + (physical ? 1 : 0) };
  };
  const neighbors = [];
  movement.getMoveDiagonal({ x: 0, y: 70, z: 0, remainingBlocks: 0 }, new Vec3(1, 0, 1), neighbors);
  assert.equal(neighbors.length, 0);
});

test('aquatic plants support swimming, surface entry and shore exits without building', () => {
  for (const name of ['kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']) {
    const bot = botFixture(), Block = require('prismarine-block')(bot.registry);
    bot.blockAt = p => {
      p = p.floored();
      const material = p.y < 67 || p.x === 2 && p.y < 70 ? 'stone' : p.y < 70 ? name : 'air';
      const b = Block.fromStateId(bot.registry.blocksByName[material].defaultState); b.position = p; return b;
    };
    const movement = configureMovements(bot); movement.canDig = false;
    const node = { x: 0, y: 69, z: 0, remainingBlocks: 0 }, swimming = [], exiting = [];
    movement.getMoveForward(node, new Vec3(1, 0, 0), swimming);
    assert.equal(swimming.length, 1, name); assert.deepEqual(swimming[0].toPlace, []);
    movement.getMoveJumpUp({ ...node, x: 1 }, new Vec3(1, 0, 0), exiting);
    assert.equal(exiting.length, 1, `${name} shore`); assert.equal(exiting[0].y, 70);
    const landing = movement.getLandingBlock({ ...node, y: 70 }, new Vec3(1, 0, 0));
    assert.equal(landing?.position.y, 69, `${name} surface entry`);
  }
});

// Stone ground at y 69 with a gap along x from 1 to `width`, floored `depth`
// blocks below the feet with `floor`.
function gapWorld({ width = 1, depth = 3, floor = 'stone' } = {}) {
  return (p, dx, dy, dz) => {
    const x = p.x + dx, y = p.y + dy, z = p.z + dz;
    const gap = x >= 1 && x <= width;
    let name = 'air';
    if (gap) { if (y === 70 - depth) name = floor; else if (y < 70 - depth) name = 'stone'; }
    else if (y <= 69) name = 'stone';
    const physical = !['air', 'lava', 'water'].includes(name);
    return { position: new Vec3(x, y, z), name, physical, safe: name === 'air', liquid: name === 'lava' || name === 'water', height: physical ? y + 1 : y, climbable: false };
  };
}
const jumps = (movement, world) => {
  movement.getBlock = world;
  const neighbors = [];
  movement.getMoveParkourForward({ x: 0, y: 70, z: 0, remainingBlocks: 0 }, new Vec3(1, 0, 0), neighbors);
  return neighbors.map(n => [n.x, n.y, n.z]);
};

test('a gap a miss survives is jumped instead of bridged; lava, a deep crevice and a wide gap are not', () => {
  const movement = configureMovements(botFixture());
  assert.equal(movement.allowParkour, true);
  assert.deepEqual(jumps(movement, gapWorld()), [[2, 70, 0]], 'a one-block crack three deep: jumped');
  assert.deepEqual(jumps(movement, gapWorld({ depth: 3, floor: 'lava' })), [], 'never over lava');
  assert.deepEqual(jumps(movement, gapWorld({ depth: 20 })), [], 'a crevice twenty deep is bridged or walked round');
  assert.deepEqual(jumps(movement, gapWorld({ depth: 4, floor: 'water' })), [[2, 70, 0]], 'water under the gap is a soft landing');
  assert.deepEqual(jumps(movement, gapWorld({ width: 2 })), [], 'two blocks wide needs a sprint');
  movement.allowSprinting = true;
  assert.deepEqual(jumps(movement, gapWorld({ width: 2 })), [[3, 70, 0]], 'sprinting, a two-block gap a miss survives is jumped');
  assert.deepEqual(jumps(movement, gapWorld({ width: 3 })), [], 'three is too far to risk');
  movement.allowGapJumps = false;
  assert.deepEqual(jumps(movement, gapWorld()), []);
});

test('no jump across a gap and up a block, and gap jumps rest after walks keep ending short', () => {
  const bot = botFixture();
  const movement = configureMovements(bot);
  // The far side one block higher.
  const raised = (p, dx, dy, dz) => { const b = gapWorld()(p, dx, dy, dz); const x = p.x + dx, y = p.y + dy; if (x === 2 && y === 70) return { ...b, name: 'stone', physical: true, safe: false, height: 71 }; return b; };
  assert.deepEqual(jumps(movement, raised), [], 'up across a gap at a walk falls short');
  assert.deepEqual(jumps(movement, gapWorld()), [[2, 70, 0]]);
  bot._gapJumpsOffUntil = Date.now() + 60000;
  assert.deepEqual(jumps(movement, gapWorld()), [], 'resting after short walks');
});

test('a water column is swum up where it comes out into air within twenty blocks, and not where it does not', () => {
  // The arena, 2026-09-25: a twelve-block waterfall the physics climbed in six seconds was "no path".
  const bot = botFixture(), Block = require('prismarine-block')(bot.registry);
  let top = 80;
  bot.blockAt = point => {
    const p = point.floored();
    const name = p.x === 0 && p.z === 0 && p.y >= 70 && p.y < top ? 'water' : p.x === 0 && p.z === 0 && p.y >= top ? 'air' : 'stone';
    const block = Block.fromStateId(bot.registry.blocksByName[name].defaultState); block.position = p; return block;
  };
  const movement = configureMovements(bot); movement.canDig = false; movement.allow1by1towers = false;
  const up = () => { const n = []; movement.getMoveUp({ x: 0, y: 70, z: 0, remainingBlocks: 0 }, n); return n; };
  assert.equal(up().length, 1, 'air ten blocks up: swum up');
  assert.equal(up()[0].y, 71);
  top = 95;
  assert.equal(up().length, 0, 'twenty-five blocks of water: not planned');
  top = 200;
  bot.blockAt = point => { const p = point.floored(); const name = p.x === 0 && p.z === 0 && p.y >= 70 && p.y < 80 ? 'water' : 'stone';
    const block = Block.fromStateId(bot.registry.blocksByName[name].defaultState); block.position = p; return block; };
  assert.equal(up().length, 0, 'water to a stone ceiling: not planned');
});

test('a diagonal does not cut the corner of a drop that hurts; over a step it still goes', () => {
  // mid-87-c: from a cliff-top toward a herd, the corner of a twenty-five-block drop, dead at full health.
  const bot = botFixture(), movement = configureMovements(bot);
  for (const [hole, expected] of [[25, 0], [2, 1]]) {
    movement.getBlock = (p, dx, dy, dz) => {
      const position = new Vec3(p.x + dx, p.y + dy, p.z + dz);
      // The corner cell (1, 0) has its floor `hole` blocks down; everything else stands on y 69.
      const floorY = position.x === 1 && position.z === 0 ? 70 - hole - 1 : 69;
      const physical = position.y <= floorY;
      return { position, physical, safe: !physical, liquid: false, height: position.y + (physical ? 1 : 0), name: physical ? 'stone' : 'air' };
    };
    const diagonal = [];
    movement.getMoveDiagonal({ x: 0, y: 70, z: 0, remainingBlocks: 0 }, new Vec3(1, 0, 1), diagonal);
    assert.equal(diagonal.length, expected, `a corner ${hole} blocks deep`);
  }
});
