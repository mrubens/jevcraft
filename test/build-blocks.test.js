'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);
const { regionProperties, matchesBuildBlock, placementGoal } = require('../src/build-blocks');
const { validateSchematic, selectSchematicSite } = require('../src/designer');
const { remainingBuildBatch, materialCounts } = require('../src/build-batch');
const { verifyHouse } = require('../src/objectives');
const { ConstructionGoal } = require('../src/construction-access');
const { designedBuildStep } = require('../src/work');
const { Task } = require('../src/skills');
const { EventEmitter } = require('node:events');
function block(name, properties) { return Block.fromProperties(registry.blocksByName[name].id, properties, 0); }
function fixture() {
  const Chunk = require('prismarine-chunk')(registry), World = require('prismarine-world')(registry);
  const world = new World(() => new Chunk()).sync;
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) world.setColumn(x, z, new Chunk());
  const bot = { registry, world, blockAt: p => world.getBlock(p), entity: { position: new Vec3(.5, 64, .5) }, game: { minY: 0, height: 128 } };
  const set = (p, name, properties = {}) => world.setBlockStateId(p, block(name, properties).stateId);
  return { bot, set };
}
test('schematic properties permit deliberate stairs/slabs but reject arbitrary or missing states', () => {
  assert.deepEqual(regionProperties('oak_stairs', { facing: 'west', half: 'top' }), { facing: 'west', half: 'top', waterlogged: false });
  assert.deepEqual(regionProperties('stone_slab', { facing: null, half: 'bottom' }), { type: 'bottom', waterlogged: false });
  assert.equal(regionProperties('stone', null), undefined);
  for (const [name, properties] of [['oak_stairs', null], ['oak_stairs', { facing: 'up', half: 'top' }],
    ['stone_slab', { half: 'double' }], ['stone_slab', { half: 'bottom', facing: 'north' }],
    ['stone', { half: 'top' }], ['oak_stairs', { facing: 'north', half: 'top', shape: 'outer_left' }]]) {
    assert.throws(() => regionProperties(name, properties));
  }
});
test('same material with the wrong state remains unfinished across verification, batching and resume', () => {
  const properties = regionProperties('oak_stairs', { facing: 'east', half: 'bottom' });
  const cell = { x: 0, y: 64, z: 0, material: 'oak_stairs', properties };
  let observed = block('oak_stairs', { ...properties, facing: 'west' });
  const bot = { blockAt: () => observed }, blueprint = { blocks: [cell], empty: [] };
  assert.equal(verifyHouse(bot, blueprint).ok, false);
  assert.deepEqual(materialCounts(remainingBuildBatch(bot, JSON.parse(JSON.stringify({ cells: [cell] })))), [{ item: 'oak_stairs', count: 1 }]);
  observed = block('oak_stairs', { ...properties, shape: 'inner_left' });
  assert(verifyHouse(bot, blueprint).ok, 'neighbor-derived corner shape is allowed');
  assert(!matchesBuildBlock(block('oak_stairs', { ...properties, half: 'top' }), cell));
  assert(!matchesBuildBlock(block('oak_stairs', { ...properties, waterlogged: true }), cell));
  assert(!matchesBuildBlock(block('stone_slab', { type: 'double' }), { material: 'stone_slab', properties: { type: 'bottom' } }));
});
test('stair work faces require the requested player direction and click height', () => {
  const { bot, set } = fixture(), p = new Vec3(0, 64, 0);
  set(p.offset(0, -1, 0), 'stone');
  const cell = { material: 'oak_stairs', properties: regionProperties('oak_stairs', { facing: 'north', half: 'bottom' }) };
  const goal = placementGoal(bot, p, cell);
  assert(goal.getFaceAndRef(new Vec3(.5, 65.62, 3.5)), 'northward from the south');
  assert.equal(goal.getFaceAndRef(new Vec3(.5, 65.62, -2.5)), null, 'wrong side would face south');
  cell.properties.half = 'top';
  assert.equal(placementGoal(bot, p, cell).facesPos.length, 0, 'a floor click cannot make an upside-down stair');
  set(p.offset(-1, 0, 0), 'stone');
  const top = placementGoal(bot, p, cell).getFaceAndRef(new Vec3(.5, 65.62, 2.5));
  assert(top); assert.equal(top.to.y, 64.75);
});
test('slab placement avoids merging an existing slab and can use its non-merging side', () => {
  const { bot, set } = fixture(), p = new Vec3(0, 64, 0);
  const cell = { material: 'stone_slab', properties: { type: 'bottom', waterlogged: false } };
  set(p.offset(0, -1, 0), 'stone_slab', { type: 'bottom' });
  assert.equal(placementGoal(bot, p, cell).facesPos.length, 0);
  set(p.offset(-1, 0, 0), 'stone_slab', { type: 'bottom' });
  const side = placementGoal(bot, p, cell).getFaceAndRef(new Vec3(2.5, 65.62, .5));
  assert(side); assert.equal(side.to.y, 64.25);
});
test('work destinations use the real half-slab footing instead of an integer eye height', () => {
  const { bot, set } = fixture(), p = new Vec3(0, 65, 1);
  set(p.offset(0, 1, 0), 'stone');
  set(new Vec3(0, 64, 0), 'oak_slab', { type: 'bottom' });
  const goal = new ConstructionGoal(bot, p, 'place', { material: 'oak_slab', properties: { type: 'top', waterlogged: false } });
  assert(!goal.reachable(new Vec3(.5, 64.5, .5)), 'eye above the beam underside cannot click it');
  assert(!goal.isEnd(new Vec3(0, 64, 0)), 'arrival checks floor actual slab feet');
  assert(!goal.isEnd(new Vec3(0, 65, 0)), 'pathfinder nodes index the air cell above the slab');
});
test('site translation retains oriented properties and exact material estimates', () => {
  const { bot, set } = fixture();
  for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) set(new Vec3(x, 63, z), 'stone');
  const source = { name: 'steps', description: 'steps', size: [3, 3, 3], palette: ['stone', 'oak_stairs', 'oak_slab'], entrance: null,
    regions: [{ from: [0, 0, 0], to: [2, 0, 2], block: 'stone' },
      { from: [1, 1, 0], to: [1, 1, 0], block: 'oak_stairs', properties: { facing: 'south', half: 'bottom' } },
      { from: [1, 1, 1], to: [1, 1, 1], block: 'oak_slab', properties: { half: 'top' } }] };
  const design = validateSchematic(source, registry), site = selectSchematicSite(bot, design);
  assert(site); assert.equal(design.materials.oak_stairs, 1); assert.equal(design.materials.oak_slab, 1);
  assert.deepEqual(site.blocks.find(p => p.material === 'oak_stairs').properties, { facing: 'south', half: 'bottom', waterlogged: false });
  source.regions[1].from[1] = 0;
  assert.throws(() => validateSchematic(source, registry), /full-block foundation/);
});

test('the executor does not silently accept or overwrite a player-rotated stair', async () => {
  const { bot: fixtureBot, set } = fixture(), bot = Object.assign(new EventEmitter(), fixtureBot);
  const source = { name: 'step', description: 'step', size: [3, 3, 3], palette: ['stone', 'oak_stairs'], entrance: null,
    regions: [{ from: [0, 0, 0], to: [2, 0, 2], block: 'stone' },
      { from: [0, 1, 0], to: [0, 1, 0], block: 'oak_stairs', properties: { facing: 'east', half: 'bottom' } }] };
  const design = validateSchematic(source, registry);
  const blocks = design.blocks.map(p => ({ ...p, y: p.y + 63 }));
  for (const p of blocks) set(new Vec3(p.x, p.y, p.z), p.material, p.properties);
  set(new Vec3(0, 64, 0), 'oak_stairs', { facing: 'west', half: 'bottom' });
  const blueprint = { origin: { x: 0, y: 63, z: 0 }, blocks, empty: [], initialBlocks: {} };
  await assert.rejects(designedBuildStep(bot, new Task('protect changed stair'), { design, blueprint }, () => {}, null), /preserving the unexpected oak_stairs/);
  assert.equal(bot.listenerCount('blockPlaced'), 0);
});
