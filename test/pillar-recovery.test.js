'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { pillarDescent, descendPillar } = require('../src/pillar-recovery');

function fixture() {
  const blocks = new Map(), dug = [];
  const bot = { _client: new EventEmitter(), entity: { position: new Vec3(.5, 77, .5), onGround: true }, entities: {}, game: { difficulty: 'peaceful' },
    inventory: { items: () => [] }, pathfinder: { setGoal() {} },
    blockAt: p => {
      const name = blocks.get(`${p}`) || (p.y <= 73 ? 'dirt' : p.x === 0 && p.z === 0 && p.y <= 76 ? 'cobblestone' : 'air');
      if (name === 'unloaded') return null;
      const full = !['air', 'water', 'lava', 'slab'].includes(name);
      return { position: p, name, diggable: true, boundingBox: full ? 'block' : 'empty',
        shapes: full ? [[0, 0, 0, 1, 1, 1]] : name === 'slab' ? [[0, 0, 0, 1, .5, 1]] : [], digTime: () => 1 };
    },
    dig: async b => {
      dug.push(b.position); blocks.set(`${b.position}`, 'air'); bot.entity.position.y--;
      bot._client.emit('block_change', { location: b.position, type: 0 });
    },
  };
  return { bot, blocks, dug, task: new Task('pillar test'), goal: { request: 'get me an iron pickaxe', item: 'iron_pickaxe' } };
}

test('dismantles a pillar one verified block at a time, then stops at ordinary ground', async () => {
  const { bot, task, goal, dug } = fixture();
  for (let i = 0; i < 3; i++) {
    assert(await descendPillar(bot, task, goal, () => {}));
    assert.equal(bot.entity.position.y, 76 - i);
    assert.equal(goal.step.landed.y, 76 - i);
    assert.equal(goal.request, 'get me an iron pickaxe');
  }
  assert.equal(pillarDescent(bot, goal), null);
  assert.equal(await descendPillar(bot, task, goal, () => {}), false);
  assert.equal(dug.length, 3);
});

test('pillar descent rejects unknown ground, gaps, fluids, gravity blocks, damage, and partial footing', () => {
  for (const name of ['unloaded', 'air', 'water', 'lava', 'magma_block', 'campfire', 'sand', 'gravel', 'slab']) {
    const { bot, blocks, goal } = fixture(); blocks.set('(0, 75, 0)', name);
    assert.equal(pillarDescent(bot, goal), null, name);
  }
  for (const name of ['lava', 'water', 'magma_block', 'cactus', 'unloaded']) {
    const { bot, blocks, goal } = fixture(); blocks.set('(1, 76, 0)', name);
    assert.equal(pillarDescent(bot, goal), null, `adjacent ${name}`);
  }
  const { bot, goal } = fixture(); bot.entity.position.x = .9;
  assert.equal(pillarDescent(bot, goal), null, 'Whole body must be over the inspected column');
});

test('pillar descent preserves construction, requires the harvest tool and respects cancellation', async () => {
  const { bot, task, goal, dug } = fixture();
  goal.portalFrame = { origin: { x: 0, y: 75, z: 0 } };
  assert.equal(pillarDescent(bot, goal), null);
  delete goal.portalFrame;
  const read = bot.blockAt;
  bot.blockAt = p => ({ ...read(p), harvestTools: { 5: true } });
  assert.equal(pillarDescent(bot, goal), null);
  bot.blockAt = read;
  task.cancel();
  await assert.rejects(descendPillar(bot, task, goal, () => {}), { name: 'Cancelled' });
  assert.equal(dug.length, 0);
});

test('stale adviser descent and footing changed during tool selection cannot trigger a dig', async () => {
  const { bot, task, goal, blocks, dug } = fixture();
  const expected = pillarDescent(bot, goal);
  blocks.set('(0, 75, 0)', 'lava');
  assert.equal(await descendPillar(bot, task, goal, () => {}, expected), false);
  blocks.delete('(0, 75, 0)');
  bot.inventory.items = () => [{ type: 1, name: 'wooden_pickaxe' }];
  const read = bot.blockAt;
  bot.blockAt = p => ({ ...read(p), digTime: type => type ? .1 : 1 });
  bot.equip = async () => { blocks.set('(0, 75, 0)', 'air'); };
  await assert.rejects(descendPillar(bot, task, goal, () => {}), /footing changed/);
  assert.equal(dug.length, 0);
});

test('the recovery adviser receives and executes the observed pillar descent without replacing the request', async () => {
  const { recoveryOptions, executeRecoveryOption } = require('../src/recovery-options');
  const { bot, task, goal } = fixture();
  bot.registry = require('minecraft-data')('26.1');
  bot.game = { difficulty: 'peaceful', dimension: 'overworld', minY: -64, height: 384 };
  bot.findBlocks = () => [];
  bot.pathfinder.movements = {};
  const actions = { planningInventory: () => ({}), catalogPlan: () => [] };
  const observed = await recoveryOptions(bot, task, goal, actions);
  const option = observed.options.find(o => o.kind === 'descend_pillar');
  assert(option, 'A correct diagnosis must have an executable descent option');
  assert(await executeRecoveryOption(bot, task, goal, () => {}, option, actions));
  assert.equal(bot.entity.position.y, 76);
  assert.equal(goal.item, 'iron_pickaxe');
  await assert.rejects(executeRecoveryOption(bot, task, goal, () => {}, option, actions), /no longer available/);
});

test('optimistic client air cannot complete a descent without the server block acknowledgement', async () => {
  const { bot, task, goal, blocks } = fixture();
  bot.dig = async b => { blocks.set(`${b.position}`, 'air'); bot.entity.position.y--; };
  const timer = setTimeout(() => task.cancel(), 400);
  try { await assert.rejects(descendPillar(bot, task, goal, () => {}), { name: 'Cancelled' }); }
  finally { clearTimeout(timer); }
  assert.equal(goal.step.landed, undefined);
  assert.equal(bot._client.listenerCount('block_change'), 0);
});

test('a batched server block update confirms a real pillar landing', async () => {
  const { bot, task, goal, blocks } = fixture();
  bot.supportFeature = name => ['usesMultiblockSingleLong', 'usesMultiblock3DChunkCoords'].includes(name);
  bot.dig = async b => {
    blocks.set(`${b.position}`, 'air'); bot.entity.position.y--;
    bot._client.emit('multi_block_change', {
      chunkCoordinates: { x: 0, y: 4, z: 0 }, records: [306 * 4096 + 268, 12],
    });
  };
  const timer = setTimeout(() => task.cancel(), 1000);
  try { assert(await descendPillar(bot, task, goal, () => {})); }
  finally { clearTimeout(timer); }
  assert.equal(goal.step.landed.y, 76);
  assert.equal(bot._client.listenerCount('block_change'), 0);
  assert.equal(bot._client.listenerCount('multi_block_change'), 0);
});

test('unrelated batched air and a later solid correction cannot confirm a pillar landing', async () => {
  for (const kind of ['different_section', 'different_block', 'solid_correction']) {
    const { bot, task, goal, blocks } = fixture();
    bot.supportFeature = () => true;
    bot.dig = async b => {
      blocks.set(`${b.position}`, 'air'); bot.entity.position.y--;
      if (kind === 'solid_correction') bot._client.emit('block_change', { location: b.position, type: 0 });
      bot._client.emit('multi_block_change', {
        chunkCoordinates: { x: kind === 'different_section' ? -1 : 0, y: 4, z: 0 },
        records: [kind === 'different_block' ? 268 : (kind === 'solid_correction' ? 4096 : 0) + 12],
      });
    };
    const timer = setTimeout(() => task.cancel(), 400);
    try { await assert.rejects(descendPillar(bot, task, goal, () => {}), { name: 'Cancelled' }); }
    finally { clearTimeout(timer); }
    assert.equal(goal.step.landed, undefined, kind);
    assert.equal(bot._client.listenerCount('multi_block_change'), 0);
  }
});

test('final construction cleanup can descend its own scaffold onto the finished floor, preserving unowned blocks', () => {
  const { bot, blocks, goal } = fixture();
  goal.blueprint = { blocks: [{ x: 0, y: 75, z: 0, material: 'smooth_sandstone' }], bounds: { min: { x: -2, y: 74, z: -2 }, max: { x: 2, y: 80, z: 2 } } };
  blocks.set('(0, 75, 0)', 'smooth_sandstone');
  goal.buildOwned = { '0,76,0': 'cobblestone' };
  assert.equal(pillarDescent(bot, goal), null, 'normal work preserves the construction area');
  goal.buildPhase = 'cleanup'; assert(pillarDescent(bot, goal));
  delete goal.buildOwned['0,76,0']; assert.equal(pillarDescent(bot, goal), null);
  goal.buildOwned['0,76,0'] = 'cobblestone';
  goal.blueprint.blocks.push({ x: 0, y: 76, z: 0, material: 'cobblestone' });
  assert.equal(pillarDescent(bot, goal), null, 'designed geometry is never a disposable scaffold');
});

test('a pillar block is placed with the look already down, not after a slow turn', async () => {
  const { pillarUp } = require('../src/pillar-recovery');
  const { Task } = require('../src/skills');
  const calls = [];
  let y = 64;
  const blockAt = p => ({ name: p.y < 64 || (p.y < y && p.y >= 64) ? 'netherrack' : 'air', boundingBox: p.y < 64 || (p.y < y && p.y >= 64) ? 'block' : 'empty', diggable: true, position: p });
  const bot = { registry: require('minecraft-data')('26.1'), entity: { position: new Vec3(0.5, 64, 0.5), yaw: 0, onGround: true, velocity: new Vec3(0, 0, 0) }, entities: {}, blockAt,
    inventory: { items: () => [{ name: 'netherrack', count: 8 }] }, equip: async () => {}, look: async () => {}, controlState: {},
    setControlState(k, v) { this.controlState[k] = v; if (k === 'jump' && v) { this.entity.onGround = false; this.entity.position = new Vec3(0.5, y + 1.2, 0.5); } },
    clearControlStates() {}, _placeBlockWithOptions: async (ref, face, options) => { calls.push(options); y += 1; bot.entity.position = new Vec3(0.5, y, 0.5); bot.entity.onGround = true; } };
  await pillarUp(bot, new Task('pillar'), 66, { maxBlocks: 2, threats: false });
  assert.equal(calls.length, 2);
  assert(calls.every(o => o.forceLook === true));
});
