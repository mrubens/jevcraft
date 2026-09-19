'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);
const { validateSchematic, buildPalette, canClearSchematicBlock } = require('../src/designer');
const { materialCounts, remainingBuildBatch } = require('../src/build-batch');
const { verifyHouse } = require('../src/objectives');
const { configureMovements } = require('../src/movement');
const { blockOwnership, placementGoal } = require('../src/build-blocks');
const { guardNavigationDoors } = require('../src/doors');
const { Task } = require('../src/skills');
const { designedBuildStep } = require('../src/work');
const { EventEmitter } = require('node:events');
function source() {
  return { name: 'Doorway', description: 'Small room with a usable wooden door', size: [5, 4, 5],
    palette: ['oak_planks', 'oak_door'], entrance: [2, 1, 0], regions: [
      { from: [0, 0, 0], to: [4, 0, 4], block: 'oak_planks' },
      { from: [0, 1, 0], to: [4, 2, 4], block: 'oak_planks' },
      { from: [1, 1, 1], to: [3, 2, 3], block: 'air' },
      { from: [2, 1, 0], to: [2, 2, 0], block: 'air' },
      { from: [0, 3, 0], to: [4, 3, 4], block: 'oak_planks' },
      { from: [2, 1, 0], to: [2, 1, 0], block: 'oak_door', properties: { facing: 'south', half: null } },
    ] };
}
function fixture() {
  const Chunk = require('prismarine-chunk')(registry), World = require('prismarine-world')(registry);
  const world = new World(() => new Chunk()).sync;
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) world.setColumn(x, z, new Chunk());
  const set = (p, name, properties = {}) => world.setBlockStateId(p, Block.fromProperties(registry.blocksByName[name].id, properties, 0).stateId);
  const bot = { registry, world, blockAt: p => world.getBlock(p), entity: { position: new Vec3(.5, 64, .5) }, game: { minY: 0 },
    inventory: { items: () => [] }, entities: {}, pathfinder: { setMovements: m => { bot.pathfinder.movements = m; } } };
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) set(new Vec3(x, 63, z), 'stone');
  const door = (name = 'oak_door', extra = {}) => {
    set(new Vec3(0, 64, 1), name, { facing: 'south', half: 'lower', open: false, hinge: 'left', ...extra });
    set(new Vec3(0, 65, 1), name, { facing: 'south', half: 'upper', open: false, hinge: 'left', ...extra });
  };
  return { bot, set, door };
}
test('a schematic reserves both door halves but acquires only one inventory item', () => {
  const d = validateSchematic(source(), registry), doors = d.blocks.filter(p => p.material === 'oak_door');
  assert.equal(doors.length, 2); assert.equal(d.materials.oak_door, 1);
  assert.equal(doors.filter(p => p.companion).length, 1);
  assert(!d.empty.some(p => p.x === 2 && p.y === 2 && p.z === 0));
  assert.equal(materialCounts(doors)[0].count, 1);
  assert(!buildPalette(registry).includes('iron_door'));
});
test('a retained advisor cottage supports a door entrance alongside oriented stairs', () => {
  const d = validateSchematic(require('./fixtures/oak-door-cottage.json'), registry);
  assert.equal(d.blocks.length, 110);
  assert.deepEqual(d.materials, { oak_planks: 88, oak_door: 1, oak_stairs: 20 });
  assert.equal(d.blocks.filter(p => p.companion).length, 1);
  assert.deepEqual(d.notes, []);
});
test('doors need headroom and a full supporting floor, and cannot specify upper halves', () => {
  for (const mutate of [
    s => s.regions.push({ from: [2, 2, 0], to: [2, 2, 0], block: 'oak_planks' }),
    s => s.regions.push({ from: [2, 0, 0], to: [2, 0, 0], block: 'air' }),
    s => { s.regions.at(-1).properties.half = 'upper'; },
  ]) { const s = source(); mutate(s); assert.throws(() => validateSchematic(s, registry), /Invalid building schematic/); }
});
test('resume verifies both halves without charging a second door or resetting open doors', () => {
  const { bot, set, door } = fixture(); door();
  const lower = { x: 0, y: 64, z: 1, material: 'oak_door', properties: { facing: 'south', half: 'lower' } };
  const upper = { ...lower, y: 65, properties: { facing: 'south', half: 'upper' }, companion: true };
  const blueprint = { blocks: [lower, upper], empty: [] };
  assert(verifyHouse(bot, blueprint).ok);
  door('oak_door', { open: true });
  assert(verifyHouse(bot, blueprint).ok);
  assert.equal(remainingBuildBatch(bot, { cells: [lower] }).length, 0);
  set(new Vec3(0, 65, 1), 'air');
  assert(!verifyHouse(bot, blueprint).ok);
  assert.deepEqual(remainingBuildBatch(bot, { cells: [lower] }), [lower]);
});
test('walking opens a closed wooden door without digging or using a building block', () => {
  const { bot, door } = fixture(); door();
  const movement = configureMovements(bot); movement.canDig = false;
  const moves = []; movement.getMoveForward({ x: 0, y: 64, z: 0, remainingBlocks: 0 }, new Vec3(0, 0, 1), moves);
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0].toBreak, []); assert.equal(moves[0].remainingBlocks, 0);
  assert.deepEqual(moves[0].toPlace, [{ x: 0, y: 64, z: 1, dx: 0, dy: 0, dz: 0, useOne: true }]);
  door('oak_door', { open: true });
  const openMoves = []; movement.getMoveForward({ x: 0, y: 64, z: 0, remainingBlocks: 0 }, new Vec3(0, 0, 1), openMoves);
  assert.equal(openMoves.length, 1); assert.equal(openMoves[0].toPlace.length, 0, 'do not toggle an already open door shut');
});
test('door routes reject iron doors, incomplete pairs, side approaches and unsupported thresholds', () => {
  for (const kind of ['iron', 'missingUpper', 'side', 'noFloor']) {
    const { bot, set, door } = fixture(); door(kind === 'iron' ? 'iron_door' : 'oak_door');
    if (kind === 'missingUpper') set(new Vec3(0, 65, 1), 'air');
    if (kind === 'noFloor') set(new Vec3(0, 63, 1), 'air');
    const movement = configureMovements(bot); movement.canDig = false;
    const node = kind === 'side' ? { x: -1, y: 64, z: 1, remainingBlocks: 0 } : { x: 0, y: 64, z: 0, remainingBlocks: 0 };
    const moves = []; movement.getMoveForward(node, kind === 'side' ? new Vec3(1, 0, 0) : new Vec3(0, 0, 1), moves);
    assert.equal(moves.length, 0, kind);
  }
});

test('opening a bot-owned door preserves ownership, while changing its facing does not', () => {
  const { bot, door } = fixture(); door();
  const p = new Vec3(0, 64, 1), owned = { '0,64,1': blockOwnership(bot.blockAt(p)) };
  door('oak_door', { open: true });
  assert(canClearSchematicBlock({}, owned, bot.blockAt(p)));
  door('oak_door', { facing: 'east' });
  assert(!canClearSchematicBlock({}, owned, bot.blockAt(p)));
});
test('door placement clicks the floor from the requested facing', () => {
  const { bot } = fixture(), p = new Vec3(0, 64, 1);
  const placement = placementGoal(bot, p, { material: 'oak_door', properties: { facing: 'south', half: 'lower' } });
  const face = placement.getFaceAndRef(new Vec3(.5, 65.62, -.5));
  assert(face); assert(face.face.equals(new Vec3(0, -1, 0)));
  assert.equal(placement.getFaceAndRef(new Vec3(.5, 65.62, 3.5)), null);
});
test('a stale door action does not close a door opened by the player during approach', async () => {
  const { bot: fixtureBot, door } = fixture(), bot = Object.assign(new EventEmitter(), fixtureBot); door();
  let calls = 0, refreshed = 0;
  const goal = {}, original = bot.activateBlock = async () => { calls++; };
  bot.pathfinder.goal = goal; bot.pathfinder.setGoal = g => { assert.equal(g, goal); refreshed++; };
  bot.lookAt = async () => door('oak_door', { open: true });
  const guard = guardNavigationDoors(bot, new Task('door'), goal);
  await bot.activateBlock(bot.blockAt(new Vec3(0, 64, 1)));
  assert.equal(calls, 0); assert.equal(refreshed, 1);
  const route = { path: [{ x: .3, y: 65, z: 1.5, doorway: { x: 0, y: 64, z: 1 } }] };
  bot.emit('path_update', route);
  assert.deepEqual([route.path[0].x, route.path[0].y, route.path[0].z], [.5, 64, 1.5]);
  guard.restore(); assert.equal(bot.activateBlock, original); assert.equal(bot.listenerCount('path_update'), 0);
});
test('stop while looking at a door prevents the interaction packet', async () => {
  const { bot, door } = fixture(), task = new Task('stop opening'); door();
  let calls = 0; bot.activateBlock = async () => { calls++; }; bot.lookAt = async () => task.cancel();
  const guard = guardNavigationDoors(bot, task);
  await assert.rejects(bot.activateBlock(bot.blockAt(new Vec3(0, 64, 1))), { name: 'Cancelled' });
  assert.equal(calls, 0); guard.restore();
});
test('an unexpected block in the upper half is protected before the lower door is repaired', async () => {
  const { bot: fixtureBot, set } = fixture(), bot = Object.assign(new EventEmitter(), fixtureBot);
  const design = validateSchematic(source(), registry), blocks = design.blocks.map(p => ({ ...p, y: p.y + 63 }));
  for (const p of blocks) set(new Vec3(p.x, p.y, p.z), p.material, p.properties);
  set(new Vec3(2, 65, 0), 'chest');
  const lower = bot.blockAt(new Vec3(2, 64, 0));
  const goal = { design, blueprint: { origin: { x: 0, y: 63, z: 0 }, blocks, empty: [], initialBlocks: {} }, buildOwned: { '2,64,0': blockOwnership(lower) } };
  await assert.rejects(designedBuildStep(bot, new Task('protect door space'), goal, () => {}, null), /preserving the unexpected chest/);
});
