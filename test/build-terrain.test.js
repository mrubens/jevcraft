'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { validateSchematic, selectSchematicSite, canClearSchematicBlock } = require('../src/designer');
const { PREP_LIMITS } = require('../src/build-terrain');
const SITE_STEP = 8; // designer.js SITE.step: how far a foundation may step down.
const source = { name: 'Pavilion', description: 'Open building', size: [5, 5, 5], palette: ['oak_planks'], entrance: [2, 1, 0], regions: [
  { from: [0, 0, 0], to: [4, 0, 4], block: 'oak_planks' },
  { from: [0, 1, 4], to: [4, 4, 4], block: 'oak_planks' },
  { from: [0, 4, 0], to: [4, 4, 4], block: 'oak_planks' },
] };
function world(kind) {
  return { registry, game: { minY: 0, height: 128 }, entity: { position: new Vec3(.5, 64, .5) },
    blockAt: point => {
      const p = point.floored(), ground = kind === 'hills' ? 63 + (Math.abs(p.x) % 5 === 0 ? 4 : 0) : kind === 'deep' ? 50 : 61;
      const name = p.y <= ground ? 'stone' : p.y <= 63 && kind !== 'hills' ? kind === 'lava' ? 'lava' : 'water' : 'air';
      const data = registry.blocksByName[name];
      return { name, position: p, stateId: data.defaultState, diggable: data.diggable, boundingBox: data.boundingBox, getProperties: () => ({ level: 0 }) };
    } };
}

test('uneven natural ground is built into with a stepped foundation, not levelled', () => {
  const bot = world('hills'), site = selectSchematicSite(bot, validateSchematic(source, registry));
  assert(site, 'a hillside is a buildable site, not a reason to give up');
  assert(!site.terrain, 'a plinth disturbs the landscape less than hundreds of blocks of earthworks');
  const filled = new Set(site.blocks.map(p => `${p.x},${p.y},${p.z}`));
  const columns = new Set(site.blocks.filter(p => p.y === site.origin.y).map(p => `${p.x},${p.z}`));
  assert(columns.size, 'the structure has a footprint at its origin height');
  // Every foundation column is carried down to the natural ground it stands on,
  // so the building rests on the hill instead of floating over the low side.
  let stepped = 0;
  for (const column of columns) {
    const [x, z] = column.split(',').map(Number);
    for (let y = site.origin.y - 1; y > site.origin.y - SITE_STEP; y--) {
      if (bot.blockAt(new Vec3(x, y, z)).boundingBox === 'block') break;
      assert(filled.has(`${x},${y},${z}`), `column ${column} is supported down to the ground at y=${y}`);
      stepped++;
    }
  }
  assert(stepped > 0, 'this hillside really does need a plinth somewhere');
  const entry = new Vec3(site.entrance.x, site.entrance.y, site.entrance.z);
  assert(filled.has(`${entry.x},${entry.y - 1},${entry.z}`) || bot.blockAt(entry.offset(0, -1, 0)).boundingBox === 'block');
});

test('shallow source water can support an island foundation but deep water and lava cannot', () => {
  const schematic = validateSchematic(source, registry), bot = world('water');
  const site = selectSchematicSite(bot, schematic);
  assert(site?.terrain); assert.equal(site.terrain.kind, 'shore_foundation');
  assert.equal(site.origin.y, 63, 'island floor must stay at the waterline for swimming access');
  assert(site.terrain.fill.some(p => bot.blockAt(new Vec3(p.x, p.y, p.z)).name === 'water'));
  assert.equal(selectSchematicSite(world('deep'), schematic), null);
  assert.equal(selectSchematicSite(world('lava'), schematic), null);
  bot.blockAt = () => null;
  assert.equal(selectSchematicSite(bot, schematic), null);
});

test('earthworks reject recognizable buildings and preserve later changes to a reserved cell', () => {
  const bot = world('hills'), schematic = validateSchematic(source, registry);
  const original = bot.blockAt;
  bot.blockAt = p => { const b = original(p); return b.name === 'stone' ? { ...b, name: 'oak_planks' } : b; };
  assert.equal(selectSchematicSite(bot, schematic), null);
  bot.blockAt = original;
  const site = selectSchematicSite(bot, schematic), first = site.blocks[0];
  const p = new Vec3(first.x, first.y, first.z);
  assert(!canClearSchematicBlock(site, {}, { position: p, name: 'chest', stateId: 999999 }));
});

test('natural flow changes in a snapshotted water cell do not cancel foundation work', () => {
  const bot = world('water'), site = selectSchematicSite(bot, validateSchematic(source, registry));
  const p = site.terrain.fill.find(p => bot.blockAt(new Vec3(p.x, p.y, p.z)).name === 'water');
  const block = bot.blockAt(new Vec3(p.x, p.y, p.z));
  assert(canClearSchematicBlock(site, {}, { ...block, stateId: block.stateId + 1 }));
  assert(!canClearSchematicBlock(site, {}, { ...block, name: 'lava', stateId: 88888 }));
});

test('terrain fill restocks by the cells remaining, not by holding a single block', () => {
  const { terrainShortage } = require('../src/work');
  const cells = count => Array.from({ length: count }, (_, i) => ({ x: i, y: 64, z: 0, material: 'cobblestone' }));
  const carrying = (count, gameMode = 'survival') =>
    ({ game: { gameMode }, inventory: { items: () => count ? [{ name: 'cobblestone', count }] : [] } });
  assert.deepEqual(terrainShortage(carrying(0), cells(40)), { item: 'cobblestone', count: 40 });
  assert.deepEqual(terrainShortage(carrying(1), cells(40)), { item: 'cobblestone', count: 40 },
    'one block is not a supply for forty cells');
  assert.equal(terrainShortage(carrying(40), cells(40)), null);
  assert.deepEqual(terrainShortage(carrying(0), cells(200)), { item: 'cobblestone', count: 64 }, 'capped at a stack');
  // Creative placement consumes nothing, so a single block really does cover the layer.
  assert.equal(terrainShortage(carrying(1, 'creative'), cells(40)), null);
  assert.deepEqual(terrainShortage(carrying(0, 'creative'), cells(40)), { item: 'cobblestone', count: 1 });
  assert.equal(terrainShortage(carrying(0), []), null, 'nothing left to fill needs nothing');
});

test('a design may be set into a hillside, and only the air it asks for is dug out', () => {
  // A slope rising steadily to the east, so the west face is open ground and
  // the east half of any footprint is buried in the hill.
  const bot = { registry, game: { minY: 0, height: 128 }, entity: { position: new Vec3(.5, 64, .5) },
    blockAt: point => {
      const p = point.floored(), ground = 61 + Math.max(0, Math.min(6, p.x));
      const name = p.y <= ground ? 'stone' : 'air', data = registry.blocksByName[name];
      return { name, position: p, stateId: data.defaultState, diggable: data.diggable, boundingBox: data.boundingBox, getProperties: () => ({}) };
    } };
  // A hall whose interior is carved on purpose, with its floor below the
  // hilltop, and an inset porch that is merely unmentioned.
  const hall = { name: 'Hillhall', description: 'A hall cut into a slope', size: [7, 5, 5],
    palette: ['stone_bricks'], entrance: [1, 1, 0], site: [3, -2, 0], existingOffset: null, regions: [
      { from: [0, 0, 0], to: [6, 0, 4], block: 'stone_bricks', properties: null },
      { from: [0, 1, 0], to: [6, 4, 4], block: 'stone_bricks', properties: null },
      { from: [1, 1, 1], to: [5, 3, 3], block: 'air', properties: null },
      { from: [1, 1, 0], to: [1, 2, 0], block: 'air', properties: null },
    ] };
  const schematic = validateSchematic(hall, registry);
  assert.deepEqual(schematic.site, [3, -2, 0], 'the design says where and how deep it belongs');
  const carved = schematic.empty.filter(p => p.carved);
  assert(carved.length > 0, 'air regions are remembered as rooms, not merely as gaps');

  // Placed with its floor set into the slope, the interior is excavated.
  const floor = 62;
  const cut = selectSchematicSite(bot, schematic, { prefer: new Vec3(3, floor, 0), baseY: floor });
  assert(cut, 'a building set into a hill is a buildable site');
  assert.equal(cut.origin.y, floor, 'the design keeps the floor height it chose');
  const dug = cut.empty.filter(p => bot.blockAt(new Vec3(p.x, p.y, p.z)).name === 'stone');
  assert(dug.length > 0, 'the hillside inside the hall is dug out rather than left solid');
  for (const p of dug) assert(cut.initialBlocks[`${p.x},${p.y},${p.z}`], 'and every dug cell is snapshotted first');

  // Nothing unmentioned is excavated: the porch keeps its ground.
  const asked = new Set(carved.map(p => `${p.x + cut.origin.x},${p.y + cut.origin.y},${p.z + cut.origin.z}`));
  for (const p of dug) assert(asked.has(`${p.x},${p.y},${p.z}`), 'only air the design asked for is dug');
});

test('leaves decaying mid-build is the world carrying on, not the site changing', () => {
  // Leaf state carries a distance and a persistence flag that the server
  // rewrites as nearby logs come down, so an exact state match condemns any
  // build with a tree beside it - and the planner counts leaves as clearable.
  const at = new Vec3(4, 70, 9), key = `${at.x},${at.y},${at.z}`;
  const leaf = (stateId, name = 'acacia_leaves') => ({ name, position: at, stateId });
  const blueprint = { initialBlocks: { [key]: 100 }, initialNames: { [key]: 'acacia_leaves' } };

  assert(canClearSchematicBlock(blueprint, {}, leaf(100)), 'unchanged leaves were always fine');
  assert(canClearSchematicBlock(blueprint, {}, leaf(104)), 'and decayed leaves are still just leaves');
  assert(!canClearSchematicBlock(blueprint, {}, leaf(200, 'chest')),
    'something genuinely new in the way still stops the build');
  assert(!canClearSchematicBlock({ initialBlocks: { [key]: 100 }, initialNames: { [key]: 'stone' } }, {}, leaf(200, 'stone_bricks')),
    'and so does stone turning into someone else’s wall');
});

test('an excavation is dug from its open face, not from the middle of the rock', () => {
  // chooseConstructionWork only weighs the nearest handful of candidates. A
  // solid chamber's interior cells are nearer than its face, so without this
  // they crowd out the only cells that can actually be reached and the dig
  // strands itself before it starts.
  const { chooseConstructionWork } = require('../src/construction-access');
  const { Task } = require('../src/skills');
  const Chunk = require('prismarine-chunk')(registry), World = require('prismarine-world')(registry);
  const world = new World(() => new Chunk()).sync;
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.setColumn(x, z, new Chunk());
  // Solid stone everywhere below the surface; the bot stands in the open.
  for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) for (let y = 60; y <= 64; y++) {
    world.setBlockStateId(new Vec3(x, y, z), registry.blocksByName.stone.defaultState);
  }
  const bot = { registry, world, blockAt: p => world.getBlock(p), entity: { position: new Vec3(5.5, 65, 5.5) },
    game: { gameMode: 'creative' }, oxygenLevel: 20, inventory: { items: () => [] },
    pathfinder: { movements: { canDig: true, scafoldingBlocks: [], exclusionAreasPlace: [] } } };

  // A chamber to hollow out: the top layer is open to the sky, the rest is not.
  const chamber = [];
  for (let x = 3; x <= 7; x++) for (let z = 3; z <= 7; z++) for (let y = 61; y <= 64; y++) chamber.push({ x, y, z });
  const open = chamber.filter(p => p.y === 64);
  assert(open.length && open.length < chamber.length, 'some of it is exposed and most of it is not');

  const candidates = chamber.map(p => ({ position: p, operation: 'dig', cleanup: true,
    buried: p.y !== 64, priority: p.y !== 64 ? 1e6 : 0 }));
  return chooseConstructionWork(bot, new Task('dig'), { blueprint: { blocks: [] }, buildPhase: 'build' }, candidates)
    .then(work => {
      assert(work, 'a chamber with an open top is diggable, not a dead end');
      assert.equal(work.position.y, 64, 'the cell it picks is one that is actually exposed');
    });
});

test('a floor the design chose still may not become a pedestal', () => {
  // Cutting into a slope lowers the floor, and nothing stops that. A floor set
  // high over the low side is the pedestal the step guard exists for, and
  // exempting a chosen one put a tower across a nine-block drop it could not
  // reach the bottom of.
  const bot = world('hills');
  const schematic = validateSchematic(source, registry);
  const lowest = Math.min(63, 67);
  const perched = selectSchematicSite(bot, schematic, { prefer: new Vec3(0, 63, 0), baseY: lowest + SITE_STEP + 4 });
  assert(!perched || perched.origin.y <= lowest + SITE_STEP,
    'a floor far above the low ground is refused, however it was chosen');

  // A floor at ground level is still perfectly acceptable.
  const level = selectSchematicSite(bot, schematic, { prefer: new Vec3(0, 63, 0), baseY: 67 });
  assert(level, 'choosing a sensible floor still works');
});

test('earthworks never fill a cell the design carves as a room', () => {
  const cellar = { ...source, name: 'Pavilion with a sunken step', regions: [...source.regions, { from: [2, 0, 2], to: [2, 0, 2], block: 'air' }] };
  const schematic = validateSchematic(cellar, registry), bot = world('water');
  const site = selectSchematicSite(bot, schematic);
  assert(site?.terrain, 'the island foundation is still planned');
  const carved = new Set(site.empty.filter(p => p.carved).map(p => `${p.x},${p.y},${p.z}`));
  assert(carved.size, 'the carved cell is kept in the plan');
  assert(!site.terrain.fill.some(p => carved.has(`${p.x},${p.y},${p.z}`)), 'nothing is filled where a room was drawn');
  assert(!site.blocks.some(p => carved.has(`${p.x},${p.y},${p.z}`)), 'and nothing is placed there');
});
