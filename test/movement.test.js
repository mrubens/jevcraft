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
