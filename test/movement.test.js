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

test('a portal is never walked through on the way somewhere else', () => {
  // mid-87-l crossed between the worlds every ten seconds, its fortress search setting out through the sheet.
  const bot = botFixture(), Block = require('prismarine-block')(bot.registry);
  bot.blockAt = point => {
    const p = point.floored(), blockName = p.y < 70 ? 'stone' : p.x === 1 && p.z === 0 && (p.y === 70 || p.y === 71) ? 'nether_portal' : 'air';
    const block = Block.fromStateId(bot.registry.blocksByName[blockName].defaultState); block.position = p; return block;
  };
  const movement = configureMovements(bot); movement.canDig = false;
  const neighbors = movement.getNeighbors({ x: 0, y: 70, z: 0, remainingBlocks: 0 });
  assert(!neighbors.some(p => p.x === 1 && p.z === 0), 'not into the sheet');
  assert(neighbors.some(p => p.x === -1 && p.z === 0));
});

test('a cell with lava beside it costs more than open ground', () => {
  // mid-92-o walked a soul sand shore on a fortress leg and drifted into the lava sea.
  const bot = botFixture(), Block = require('prismarine-block')(bot.registry);
  bot.blockAt = point => {
    const p = point.floored(), blockName = p.y < 70 ? (p.y === 69 && p.x === 2 && p.z === 0 ? 'lava' : 'stone') : 'air';
    const block = Block.fromStateId(bot.registry.blocksByName[blockName].defaultState); block.position = p; return block;
  };
  const movement = configureMovements(bot); movement.canDig = false;
  const neighbors = movement.getNeighbors({ x: 0, y: 70, z: 0, remainingBlocks: 0 });
  const east = neighbors.find(p => p.x === 1 && p.z === 0 && p.y === 70), west = neighbors.find(p => p.x === -1 && p.z === 0 && p.y === 70);
  assert(east && west, 'both still walkable');
  assert(east.cost > west.cost + 3, `beside the lava costs more: ${east.cost} against ${west.cost}`);
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

test('no bridge is laid over a drop that hurts; over a short gap it still is', () => {
  // mid-87-d: its own scaffolding along a ravine, twenty-six blocks down at full health.
  const bot = botFixture(), movement = configureMovements(bot);
  for (const [depth, expected] of [[26, 0], [2, 1]]) {
    movement.getBlock = (p, dx, dy, dz) => {
      const position = new Vec3(p.x + dx, p.y + dy, p.z + dz);
      // Under x 1 the ground is `depth` blocks below the floor cell; elsewhere the floor is y 69.
      const floorY = position.x === 1 ? 69 - depth : 69;
      const physical = position.y <= floorY;
      return { position, physical, safe: !physical, liquid: false, replaceable: !physical, height: position.y + (physical ? 1 : 0), name: physical ? 'stone' : 'air', shapes: physical ? [[0, 0, 0, 1, 1, 1]] : [] };
    };
    const neighbors = [];
    movement.getMoveForward({ x: 0, y: 70, z: 0, remainingBlocks: 10 }, new Vec3(1, 0, 0), neighbors);
    assert.equal(neighbors.length, expected, `a gap ${depth} deep`);
  }
});

test('a diagonal corner over lava is no floor', () => {
  const bot = botFixture(), movement = configureMovements(bot);
  movement.getBlock = (p, dx, dy, dz) => {
    const position = new Vec3(p.x + dx, p.y + dy, p.z + dz);
    const lava = position.x === 1 && position.z === 0 && position.y === 68;
    const physical = !lava && position.y <= (position.x === 1 && position.z === 0 ? 60 : 69);
    return { position, physical, safe: !physical && !lava, liquid: lava, height: position.y + (physical ? 1 : 0), name: lava ? 'lava' : physical ? 'stone' : 'air' };
  };
  const diagonal = [];
  movement.getMoveDiagonal({ x: 0, y: 70, z: 0, remainingBlocks: 0 }, new Vec3(1, 0, 1), diagonal);
  assert.equal(diagonal.length, 0);
});

// A ledge over the lava sea: netherrack up to y 69 for z 0 to 2, and north
// of it (z -1) open air down to lava at y 20.
function ledgeFixture(dimension) {
  const bot = botFixture(), Block = require('prismarine-block')(bot.registry);
  bot.game.dimension = dimension; bot.health = 20;
  bot.blockAt = point => {
    const p = point.floored();
    const blockName = p.y <= 20 ? 'lava' : p.y < 70 && p.z >= 0 && p.z <= 2 ? 'netherrack' : 'air';
    const block = Block.fromStateId(bot.registry.blocksByName[blockName].defaultState); block.position = p; return block;
  };
  const movement = configureMovements(bot); movement.canDig = false;
  return { bot, movement };
}

// Something that can push the bot, where the pathfinder asks (danger.js pushersAbout): a blaze in sight, in its reach.
function pusher(bot, at = new Vec3(10.5, 72, 6.5)) {
  bot.entities = { 9: { id: 9, name: 'blaze', type: 'hostile', position: at, height: 1.8, isValid: true } };
  delete bot._pushers;
}

test('in the Nether a cell beside a drop into the lava sea is walked at its cost while nothing can push the bot, and refused while something can', () => {
  // mid-227-a and mid-227-b were routed along ledges high over the lava sea and went over (notes 217, 248);
  // mid-243-q-nether-1 was knocked off one by a ghast's fireball (note 516). mid-235-p-nether-3-fortress-2 reached none of
  // its fortress's stretches in seventy-three minutes with every bridge edge refused and nothing about (note 541).
  const { bot, movement } = ledgeFixture('the_nether');
  let neighbors = movement.getNeighbors({ x: 0, y: 70, z: 1, remainingBlocks: 0 });
  const edge = neighbors.find(p => p.x === 0 && p.z === 0 && p.y === 70), back = neighbors.find(p => p.x === -1 && p.z === 1 && p.y === 70);
  assert(edge && back, 'nothing about: both walkable');
  assert(edge.cost > back.cost + 3, `the ledge costs more: ${edge.cost} against ${back.cost}`);
  pusher(bot);
  neighbors = movement.getNeighbors({ x: 0, y: 70, z: 1, remainingBlocks: 0 });
  assert(!neighbors.some(p => p.z === 0), 'a blaze in sight: not onto the edge');
  assert(neighbors.some(p => p.x === -1 && p.z === 1 && p.y === 70), 'a block back from it is open');
  movement.besideLava = () => true;
  assert(movement.getNeighbors({ x: 0, y: 70, z: 1, remainingBlocks: 0 }).some(p => p.x === 0 && p.z === 0 && p.y === 70), 'a walk that opts out takes it');
  // In the Overworld the cost is left as it was.
  const overworld = ledgeFixture('overworld').movement.getNeighbors({ x: 0, y: 70, z: 1, remainingBlocks: 0 });
  assert.equal(overworld.find(p => p.x === 0 && p.z === 0 && p.y === 70).cost, overworld.find(p => p.x === -1 && p.z === 1 && p.y === 70).cost);
});

test('after a step back from the edge the route does not go back onto it while the mob is about', () => {
  // mid-227-b stepped back from the ledge at the magma cubes, and the next route walked it back along the same edge (note 248).
  const { holdOffEdge } = require('../src/terrain');
  const { bot, movement } = ledgeFixture('the_nether');
  // The edge opted into, as a walk that must take it does (note 516): the hold is what is tested.
  movement.besideLava = () => true;
  const cube = { id: 7, name: 'magma_cube', position: new Vec3(40, 70, 1), isValid: true, height: 1 };
  bot.entities = { 7: cube };
  holdOffEdge(bot, new Vec3(0, 70, 0), [cube]);
  let neighbors = movement.getNeighbors({ x: 0, y: 70, z: 1, remainingBlocks: 0 });
  assert(!neighbors.some(p => p.x === 0 && p.z === 0 && p.y === 70), 'not back onto the edge cell it left');
  assert(!neighbors.some(p => p.x === 1 && p.z === 0 && p.y === 70), 'nor the edge beside it');
  assert(neighbors.some(p => p.x === -1 && p.z === 1 && p.y === 70), 'ground back from the edge is open');
  // The cube gone, the edge is a route again (at its cost).
  bot.entities = {}; movement._hostileObservation = null;
  neighbors = movement.getNeighbors({ x: 0, y: 70, z: 1, remainingBlocks: 0 });
  assert(neighbors.some(p => p.x === 0 && p.z === 0 && p.y === 70));
  assert.equal(bot._edgeHold, undefined);
});

test('no drop of two or more onto the lava sea\'s shore: the fall carries on past the cell it was aimed at', () => {
  // mid-220-e dropped three blocks to the shore on a fortress leg and went on into the sea (2026-09-27).
  for (const lava of [true, false]) {
    const bot = botFixture(), Block = require('prismarine-block')(bot.registry);
    bot.game.dimension = 'the_nether'; bot.health = 20;
    bot.blockAt = point => {
      const p = point.floored();
      // A ledge at x <= 0 (feet 70); the shore below it at x 1 (feet 67); x 2 is the sea, or more shore.
      const name = p.x <= 0 ? (p.y < 70 ? 'netherrack' : 'air') : p.y < 66 ? 'netherrack' : p.y === 66 ? (p.x >= 2 && lava ? 'lava' : 'netherrack') : 'air';
      const block = Block.fromStateId(bot.registry.blocksByName[name].defaultState); block.position = p; return block;
    };
    const movement = configureMovements(bot); movement.canDig = false;
    const down = movement.getNeighbors({ x: 0, y: 70, z: 0, remainingBlocks: 0 }).filter(p => p.x === 1 && p.y === 67);
    assert.equal(down.length, lava ? 0 : 1, lava ? 'not down to the shore beside the lava' : 'down to dry ground as before');
  }
});

test('no gap jumps in the Nether: a jump that falls short there is the lava sea', () => {
  // mid-243-g and mid-229-f went into the lava sea on fortress legs, the route running and no hit taken (2026-09-27).
  const bot = botFixture(); bot.game.dimension = 'the_nether';
  const movement = configureMovements(bot);
  assert.deepEqual(jumps(movement, gapWorld()), [], 'the crack a miss survives in the Overworld is not jumped here');
});

// A world of named cells for the pathfinder's view; `name(p)` names each.
function namedWorld(dimension, name) {
  const bot = botFixture(), Block = require('prismarine-block')(bot.registry);
  bot.game.dimension = dimension; bot.health = 8;
  bot.blockAt = point => {
    const p = point.floored();
    const block = Block.fromStateId(bot.registry.blocksByName[name(p)].defaultState); block.position = p; return block;
  };
  bot.inventory.items = () => [{ name: 'cobblestone', type: bot.registry.itemsByName.cobblestone.id, count: 64 }];
  const movement = configureMovements(bot); movement.canDig = false;
  return movement;
}

test('no block is laid level beside the floor where a miss ends in lava or beside it', () => {
  // mid-235-p-nether-2 towered beside its span over the lava sea, backed off the top to lay a block beside it, fell five onto the span and slid into the sea (note 514).
  for (const sea of [true, false]) {
    // A one-wide span at y 31 along z 0 over lava (or ground), and a tower on it at x 5 up to y 35.
    const movement = namedWorld('the_nether', p => p.x === 5 && p.z === 0 && p.y >= 31 && p.y <= 35 ? 'cobblestone'
      : p.y === 31 && p.z === 0 ? 'cobblestone' : p.y <= 31 ? (sea ? 'lava' : 'netherrack') : 'air');
    const neighbors = movement.getNeighbors({ x: 5, y: 36, z: 0, remainingBlocks: 64 });
    const beside = neighbors.filter(n => n.toPlace.some(p => p.dy === 0));
    if (sea) assert.equal(beside.length, 0, 'nothing laid beside the tower over the span and the sea');
    else assert(beside.some(n => n.x === 4 && n.y === 36), 'over ground the tower still bridges off');
    // Over the sea the tower's top is itself a block from a short fall into lava (note 516): refused while something
    // can push the bot off it, priced while nothing can (note 541).
    assert(neighbors.some(n => n.x === 5 && n.y === 37 && n.z === 0), 'the tower goes up while nothing can push');
    movement.bot.entities = { 9: { id: 9, name: 'blaze', type: 'hostile', position: new Vec3(15.5, 38, 6.5), height: 1.8, isValid: true } }; delete movement.bot._pushers;
    assert.equal(movement.getNeighbors({ x: 5, y: 36, z: 0, remainingBlocks: 64 }).some(n => n.x === 5 && n.y === 37 && n.z === 0), !sea, sea ? 'no higher over the sea under fire' : 'the tower still goes up');
  }
  // Nor a span laid out over the lava sea itself: a miss is the sea.
  const movement = namedWorld('the_nether', p => p.y === 31 && p.z === 0 && p.x <= 0 ? 'cobblestone' : p.y <= 31 ? 'lava' : 'air');
  const out = movement.getNeighbors({ x: 0, y: 32, z: 0, remainingBlocks: 64 });
  assert(!out.some(n => n.toPlace.some(p => p.dy === 0)), 'no block laid out over the lava from the span\'s end');
  // Nor walked back along the span: a one-wide span over lava is Jev's crossing, not a route (note 516).
  assert(!out.some(n => n.x === -1 && n.y === 32), 'the span is not a route');
});

test('no jump up, across, onto a cell with lava beside it', () => {
  // mid-235-p-fortress-3 jumped out of a trench onto the cells beside a lava flow and its side went into it (note 514).
  for (const lava of [true, false]) {
    // A trench floor at y 47 for x >= 0; a step up at x -1 (floor y 48); lava at feet height beside the step at z 1.
    const movement = namedWorld('the_nether', p => p.x === -1 && p.y === 49 && p.z === 1 ? (lava ? 'lava' : 'air')
      : p.y <= 47 || p.x <= -1 && p.y <= 48 ? 'netherrack' : 'air');
    const up = movement.getNeighbors({ x: 0, y: 48, z: 0, remainingBlocks: 0 }).filter(n => n.x === -1 && n.y === 49 && n.z === 0);
    assert.equal(up.length, lava ? 0 : 1, lava ? 'not up beside the lava' : 'up the step as before');
  }
});

test('in the Nether no cell a block sideways of lava is walked: along a one-wide shore the route keeps a block off', () => {
  // Both of note 514's burns were the pathfinder's own routes; refused a move at a time, the next leaked (note 516).
  // Netherrack floor at y 47 for z >= 0; the lava sea at z < 0, level with the floor.
  const shore = dimension => namedWorld(dimension, p => p.y <= 47 ? (p.z < 0 ? 'lava' : 'netherrack') : 'air');
  const nether = shore('the_nether');
  const along = nether.getNeighbors({ x: 0, y: 48, z: 1, remainingBlocks: 0 });
  assert(!along.some(n => n.z === 0), 'no cell on the shore beside the sea');
  assert(along.some(n => n.x === 1 && n.z === 1 && n.y === 48), 'a block off the shore it goes on');
  assert(nether.lavaRefusals > 0, 'the refusal is counted for the no-route error');
  // Nor beside a column that falls into lava within reach: a ledge at z >= 0, open air at z < 0 down to lava four below.
  const ledge = namedWorld('the_nether', p => p.z < 0 ? (p.y <= 43 ? 'lava' : 'air') : p.y <= 47 ? 'netherrack' : 'air');
  ledge.bot.entities = { 9: { id: 9, name: 'blaze', type: 'hostile', position: new Vec3(10.5, 50, 6.5), height: 1.8, isValid: true } };
  assert(!ledge.getNeighbors({ x: 0, y: 48, z: 1, remainingBlocks: 0 }).some(n => n.z === 0), 'not beside a short fall into lava while something can push');
  // A fortress bridge three wide with the sea forty blocks down: with nothing about, its edges are walked at their cost; with a
  // blaze in sight, they are refused and its middle walked (note 541).
  const bridge = namedWorld('the_nether', p => p.y <= 8 ? 'lava' : p.y === 47 && p.z >= 0 && p.z <= 2 ? 'nether_bricks' : 'air');
  let deck = bridge.getNeighbors({ x: 0, y: 48, z: 1, remainingBlocks: 0 });
  const middle = deck.find(n => n.x === 1 && n.z === 1 && n.y === 48), side = deck.find(n => n.x === 0 && n.z === 0 && n.y === 48);
  assert(middle && side, 'nothing about: the whole deck');
  assert(side.cost > middle.cost, 'its edge costs more');
  bridge.bot.entities = { 9: { id: 9, name: 'blaze', type: 'hostile', position: new Vec3(10.5, 50, 6.5), height: 1.8, isValid: true } }; delete bridge.bot._pushers;
  deck = bridge.getNeighbors({ x: 0, y: 48, z: 1, remainingBlocks: 0 });
  assert(deck.some(n => n.x === 1 && n.z === 1 && n.y === 48), 'along the middle');
  assert(!deck.some(n => n.z !== 1), 'not along an edge');
  // An opt-out by name takes the shore, and the Overworld keeps its cost.
  nether.besideLava = () => true;
  assert(nether.getNeighbors({ x: 0, y: 48, z: 1, remainingBlocks: 0 }).some(n => n.z === 0), 'opted out, the shore is open');
  assert(shore('overworld').getNeighbors({ x: 0, y: 48, z: 1, remainingBlocks: 0 }).some(n => n.z === 0), 'the Overworld shore is priced, not refused');
});

test('in the Nether a route over ground far from lava is unchanged', () => {
  const ground = dimension => namedWorld(dimension, p => p.y <= 47 ? 'netherrack' : 'air');
  const key = n => `${n.x},${n.y},${n.z}:${n.cost}`;
  const node = { x: 0, y: 48, z: 0, remainingBlocks: 0 };
  const nether = ground('the_nether');
  assert.deepEqual(nether.getNeighbors(node).map(key).sort(), ground('overworld').getNeighbors(node).map(key).sort());
  assert.equal(nether.lavaRefusals || 0, 0);
});

test('parkour is off in the Nether, whatever the loop restores', () => {
  const bot = botFixture(), movement = configureMovements(bot);
  assert.equal(movement.allowParkour, true);
  bot.game.dimension = 'the_nether';
  assert.equal(movement.allowParkour, false);
  Object.assign(movement, bot._movementDefaults);
  assert.equal(movement.allowParkour, false, 'the defaults put back each tick do not turn it on');
  bot.game.dimension = 'overworld';
  assert.equal(movement.allowParkour, true);
});

test('a walk the lava rule leaves no route for says the way passes beside lava; an opt-out is by name and put back', async () => {
  const { navigate, Task } = require('../src/skills');
  const { goals } = require('mineflayer-pathfinder');
  const movements = { besideLava: undefined }, seen = [];
  const bot = { entity: { position: new Vec3(0, 64, 0) }, game: { dimension: 'the_nether' }, pathfinder: { movements, setGoal() {},
    goto: async () => { seen.push(movements.besideLava); movements.lavaRefusals = 3; } } };
  const atFrame = () => true;
  await assert.rejects(navigate(bot, new Task('test', 'test'), new goals.GoalBlock(10, 64, 0), { besideLava: atFrame }),
    err => err.name === 'NoRoute' && /the way passes beside lava/.test(err.message) && err.besideLava);
  assert.deepEqual(seen, [atFrame]);
  assert.equal(movements.besideLava, undefined, 'the opt-out ends with the walk');
  // With nothing refused, the error is as before.
  bot.pathfinder.goto = async () => {};
  await assert.rejects(navigate(bot, new Task('test', 'test'), new goals.GoalBlock(10, 64, 0)), err => err.name === 'NoRoute' && !/lava/.test(err.message));
});

test('no drop of two or more onto a ledge the walk\'s own pace carries past into a fall that kills', () => {
  // mid-244-ac dropped three from a cave floor onto a one-wide ledge at walking pace, missed it, and fell forty at full health (note 545).
  for (const deep of [true, false]) {
    // A cave floor at feet 70 for x >= 1; a one-wide ledge at x 0 (feet 67); beyond it at x <= -1 a pit to y 20, or ground at feet 66.
    const movement = namedWorld('overworld', p => p.x >= 1 ? (p.y <= 69 ? 'stone' : 'air') : p.x === 0 ? (p.y <= 66 ? 'stone' : 'air')
      : p.y <= (deep ? 19 : 65) ? 'stone' : 'air');
    movement.bot.health = 20;
    const down = movement.getNeighbors({ x: 1, y: 70, z: 0, remainingBlocks: 0 }).filter(n => n.x === 0 && n.y === 67 && n.z === 0);
    assert.equal(down.length, deep ? 0 : 1, deep ? 'not down onto the ledge over the pit' : 'down to the ledge over low ground as before');
  }
});

test('no block laid level beside the floor from a cell over lava or a fall that kills, on any side', () => {
  // mid-235-q-nether-2-fortress-2, in the Overworld at 10.6 health, backed off its tower's top mid-jump the other way from the block it meant to lay and fell six into a lava pool (note 545).
  for (const pool of [true, false]) {
    // A bank at z <= -1 (floor y 47); a tower at x 0, z 0 up to y 48; round it a lava pool at y 43, or ground at y 46.
    const movement = namedWorld('overworld', p => p.z <= -1 ? (p.y <= 47 ? 'stone' : 'air') : p.x === 0 && p.z === 0 ? (p.y <= 48 ? 'cobblestone' : 'air')
      : pool ? (p.y < 43 ? 'stone' : p.y === 43 ? 'lava' : 'air') : p.y <= 46 ? 'stone' : 'air');
    movement.bot.health = 10.6;
    const laid = movement.getNeighbors({ x: 0, y: 49, z: 0, remainingBlocks: 64 }).filter(n => n.toPlace.some(p => p.dy === 0 && (p.dx || p.dz)));
    if (pool) assert.equal(laid.length, 0, 'nothing laid off the tower top over the pool');
    else assert(laid.some(n => n.x === 0 && n.y === 49 && n.z === -1), 'over a short fall the tower still bridges to the bank');
  }
});

test('no block laid to climb from a top whose four sides fall more than three, on a walk to somewhere no higher', () => {
  // mid-243-ab's walks to sheep on the ground built a staircase into the air from the canopy and a tower on it, 97 to 129 (note 565).
  const rises = (movement, node) => movement.getNeighbors(node).filter(n => n.y > node.y && n.toPlace.some(p => p.dy === 1));
  // A one-wide column of dirt up to y 79 over ground at 64.
  const column = namedWorld('overworld', p => p.y <= 64 ? 'stone' : p.x === 0 && p.z === 0 && p.y <= 79 ? 'dirt' : 'air');
  column.bot.health = 20;
  const top = { x: 0, y: 80, z: 0, remainingBlocks: 64 };
  assert(rises(column, top).length > 0, 'with no goal height known, as before');
  column.walkGoalY = 65;
  assert.equal(rises(column, top).length, 0, 'the walk to the ground lays nothing to climb');
  column.walkGoalY = 90;
  assert(rises(column, top).some(n => n.x === 0 && n.z === 0 && n.y === 81), 'a goal above still climbs');
  // On open ground the tower up is the walk's to take.
  const ground = namedWorld('overworld', p => p.y <= 64 ? 'stone' : 'air');
  ground.walkGoalY = 65;
  assert(rises(ground, { x: 0, y: 65, z: 0, remainingBlocks: 64 }).length > 0);
});
