'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { configureMovements } = require('../src/movement');
const { openMiningPassage } = require('../src/mining-passage');
const { approachDryMining } = require('../src/mining-access');
const { collectNearbyDrops } = require('../src/drop-collection');

function fixture() {
  const registry = require('prismarine-registry')('26.1'), Block = require('prismarine-block')(registry);
  const changed = new Map(), wall = new Vec3(1, 64, 0), target = new Vec3(2, 64, 0);
  changed.set(`${wall}`, 'grass_block');
  let count = 0;
  const drop = { id: 7, position: target.offset(.5, 0, .5), getDroppedItem: () => ({ name: 'cobblestone' }) };
  const bot = { registry, game: { gameMode: 'survival', difficulty: 'normal', minY: -64 },
    entity: { position: new Vec3(.5, 64, .5) }, entities: { 7: drop }, inventory: { items: () => [
      { name: 'wooden_pickaxe', type: registry.itemsByName.wooden_pickaxe.id, count: 1 }, ...(count ? [{ name: 'cobblestone', count }] : [])] },
    blockAt(point) {
      const p = point.floored(), name = changed.get(`${p}`) || (p.y < 64 ? 'stone' : p.y === 66 ? 'stone' : 'air');
      const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = p; return b;
    },
    pathfinder: { setMovements: m => { bot.pathfinder.movements = m; } },
  };
  const movement = configureMovements(bot), task = new Task('reach stone behind a step');
  movement.allowedPosition = p => p.x >= 0;
  const path = [{ x: 1, y: 64, z: 0, toBreak: [wall], toPlace: [] }, { x: 2, y: 64, z: 0, toBreak: [], toPlace: [] }];
  bot.pathfinder.getPathFromTo = function * (m) {
    yield { result: { status: m.canDig ? 'success' : 'noPath', path: m.canDig ? path : [] } };
  };
  const before = { ...movement }, collect = () => { count++; delete bot.entities[drop.id]; };
  return { bot, task, movement, before, wall, target, changed, path, collect };
}

test('mining pickup opens one inspected dirt obstruction instead of mining replacements', async () => {
  const { bot, task, movement, before, wall, target, collect } = fixture();
  let moves = 0;
  assert(await collectNearbyDrops(bot, task, 'cobblestone', { allowExcavation: true, timeoutMs: 1000,
    move: async (_bot, _task, destination, options) => {
      moves++;
      assert(movement.canDig); assert.deepEqual(movement.scafoldingBlocks, []);
      assert(movement.safeToBreak(bot.blockAt(wall)), 'May clear the inspected dirt doorway');
      assert(!movement.safeToBreak(bot.blockAt(new Vec3(1, 66, 0))), 'Replanning cannot expand the set of blocks to dig');
      assert(!movement.safeToBreak(bot.blockAt(target.offset(0, -1, 0))), 'Keep the drop landing intact');
      collect(); assert(options.stopWhen());
    } }));
  assert.equal(moves, 1); assert.deepEqual({ ...movement }, before);
});

test('dry mining approach can open a bounded passage to an existing stance', async () => {
  const { bot, task, movement, before, target } = fixture();
  const ore = target.offset(1, 0, 0);
  bot.world = { raycast: () => ({ position: ore }) };
  bot.canDigBlock = () => false;
  let moves = 0;
  await approachDryMining(bot, task, ore, { navigate: async (_b, _t, destination) => {
    moves++; assert(movement.canDig);
    bot.entity.position = new Vec3(destination.x + .5, destination.y, destination.z + .5);
  } });
  assert.equal(moves, 1); assert.deepEqual({ ...movement }, before);
});

test('mining passages preserve no-dig, protected blocks, construction, fluid and footing restrictions', async () => {
  for (const restriction of ['no_dig', 'crafted', 'protected', 'waterlogged', 'own_floor', 'drop_floor', 'target_block', 'boundary', 'lava']) {
    const { bot, task, movement, wall, target, changed, path } = fixture();
    let protect = [];
    if (restriction === 'no_dig') movement.canDig = false;
    if (restriction === 'crafted') changed.set(`${wall}`, 'oak_planks');
    if (restriction === 'protected') movement.exclusionAreasBreak = [b => b.position.equals(wall) ? 100 : 0];
    if (restriction === 'waterlogged') {
      const read = bot.blockAt; bot.blockAt = p => { const b = read(p); if (b.position.equals(wall)) b.getProperties = () => ({ waterlogged: true }); return b; };
    }
    if (restriction === 'own_floor') path[0].toBreak = [new Vec3(0, 63, 0)];
    if (restriction === 'drop_floor') path[0].toBreak = [target.offset(0, -1, 0)];
    if (restriction === 'target_block') protect = [wall];
    if (restriction === 'boundary') movement.allowedPosition = p => p.x < 1;
    if (restriction === 'lava') changed.set(`${wall}`, 'lava');
    const before = { ...movement };
    assert.equal(await openMiningPassage(bot, task, [target], { protect, navigate: async () => assert.fail(restriction) }), false, restriction);
    assert.deepEqual({ ...movement }, before);
  }
});

test('mining passages reject unfinished, far, deep, excessive and placing routes', async () => {
  for (const kind of ['partial', 'far', 'deep', 'too_many', 'long', 'placing']) {
    const { bot, task, movement, before, target, path } = fixture();
    if (kind === 'far') path.push({ x: 20, y: 64, z: 0 });
    if (kind === 'deep') path.push({ x: 1, y: 60, z: 0 });
    if (kind === 'too_many') path[0].toBreak.push(...[1, 2, 3, 4].map(x => new Vec3(x, 66, 0)));
    if (kind === 'long') path.push(...Array.from({ length: 17 }, () => ({ x: 2, y: 64, z: 0 })));
    if (kind === 'placing') path[0].toPlace.push({ x: 1, y: 63, z: 0 });
    bot.pathfinder.getPathFromTo = function * () { yield { result: { status: kind === 'partial' ? 'partial' : 'success', path } }; };
    assert.equal(await openMiningPassage(bot, task, [target], { navigate: async () => assert.fail(kind) }), false, kind);
    assert.deepEqual({ ...movement }, before);
  }
});

test('mining passage cancellation or newly lost footing unwinds all temporary movement rules', async () => {
  for (const reason of ['Cancelled', 'NeedsSafety', 'NeedsAir', 'lost footing']) {
    const { bot, task, movement, before, target } = fixture();
    await assert.rejects(openMiningPassage(bot, task, [target], { navigate: async () => {
      if (reason === 'Cancelled') { task.cancel(); task.check(); }
      throw Object.assign(new Error(reason), { name: reason });
    } }), { name: reason });
    assert.deepEqual({ ...movement }, before);
  }
});
