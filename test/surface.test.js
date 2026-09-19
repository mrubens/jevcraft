'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { surfaceObserver, surfaceMovement, returnToSurface } = require('../src/surface');
const { constructionObservation, explore } = require('../src/work');
const { Task } = require('../src/skills');

function world() {
  const blocks = new Map();
  const bot = { game: { minY: 0, height: 100 }, entity: { position: new Vec3(0.5, 64, 0.5) },
    pathfinder: { movements: { canDig: true, allow1by1towers: true, allowSprinting: true, scafoldingBlocks: [1] } },
    blockAt: p => ({ name: blocks.get(`${p}`) || (p.y < 64 ? 'stone' : 'air'), boundingBox: blocks.has(`${p}`) || p.y < 64 ? 'block' : 'empty' }) };
  return { bot, blocks };
}
test('surface search accepts forest canopy but rejects cave floors and roofs', () => {
  const { bot, blocks } = world();
  blocks.set('(5, 70, 0)', 'oak_leaves');
  blocks.set('(6, 70, 0)', 'oak_log');
  blocks.set('(7, 70, 0)', 'stone');
  const check = surfaceObserver(bot);
  assert(check(new Vec3(0, 64, 0)));
  assert(check(new Vec3(5, 64, 0)));
  assert(check(new Vec3(6, 64, 0)));
  assert(!check(new Vec3(7, 64, 0)));
  assert(!check(new Vec3(0, 24, 0)));
  bot.blockAt = () => null;
  assert(!surfaceObserver(bot)(new Vec3(0, 64, 0)), 'Unloaded terrain cannot establish surface safety');
});
test('surface routes can use carried scaffolding but cannot dig or descend into a cave, and restore normal mining', () => {
  const { bot, blocks } = world();
  blocks.set('(0, 67, 0)', 'oak_planks');
  const before = { ...bot.pathfinder.movements };
  const policy = surfaceMovement(bot);
  assert(policy.allowed(new Vec3(0, 64, 0)), 'Can leave the starting house');
  assert(!policy.allowed(new Vec3(1, 60, 0)));
  assert(!policy.allowed(new Vec3(20, 24, 0)));
  assert.equal(bot.pathfinder.movements.canDig, false);
  assert.equal(bot.pathfinder.movements.allow1by1towers, true);
  assert.deepEqual(bot.pathfinder.movements.scafoldingBlocks, [1]);
  policy.restore();
  for (const [key, value] of Object.entries(before)) assert.deepEqual(bot.pathfinder.movements[key], value);
});
test('building progress observes placement and clearing with unchanged Creative inventory and position', () => {
  const { bot, blocks } = world();
  const p = new Vec3(1, 64, 1);
  const goal = { blueprint: { blocks: [{ ...p, material: 'gold_block' }], empty: [] } };
  const before = constructionObservation(bot, goal);
  blocks.set(`${p}`, 'gold_block');
  const placed = constructionObservation(bot, goal);
  assert.notEqual(placed, before);
  blocks.set(`${p}`, 'short_grass');
  const obstruction = constructionObservation(bot, goal);
  blocks.delete(`${p}`);
  assert.notEqual(constructionObservation(bot, goal), obstruction);
  blocks.set('(10, 64, 10)', 'stone');
  assert.equal(constructionObservation(bot, goal), before, 'Unrelated world updates are not construction progress');
});

function undergroundFixture() {
  const { bot } = world();
  bot.entity.position = new Vec3(0.5, 55, 0.5);
  bot.registry = require('minecraft-data')('26.1');
  const target = new Vec3(6, 63, 0);
  const inherited = p => p.x >= 0;
  bot.pathfinder.movements.allowedPosition = inherited;
  bot.findBlocks = ({ useExtraInfo }) => {
    const block = { ...bot.blockAt(target), position: target };
    return useExtraInfo(block) ? [target] : [];
  };
  bot.pathfinder.getPathFromTo = function * (movements) {
    assert.equal(movements.canDig, true, 'Returning to the surface may use the existing mining capability');
    assert(movements.allowedPosition(new Vec3(1, 56, 0)));
    assert(!movements.allowedPosition(new Vec3(1, 51, 0)), 'Recovery must not descend farther into the cave');
    assert(!movements.allowedPosition(new Vec3(-1, 60, 0)), 'Preserve other movement restrictions');
    yield { result: { status: 'partial', path: [] } };
    yield { result: { status: 'success', path: [target.offset(0, 1, 0)] } };
  };
  bot.pathfinder.goto = async g => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); };
  bot.pathfinder.setGoal = () => {};
  return { bot, inherited };
}

test('surface foraging first exits an underground work area without spending its exploration budget', async () => {
  const { bot, inherited } = undergroundFixture();
  const goal = {};
  assert(!surfaceObserver(bot)(bot.entity.position.floored()));
  await explore(bot, new Task('test', 'food'), goal, () => {}, 'food animals', { surfaceOnly: true });
  assert(surfaceObserver(bot)(bot.entity.position.floored()));
  assert.equal(goal.survivalAction.action, 'return_to_surface');
  assert.equal(goal.search, undefined);
  assert.equal(goal.surfaceReturn, undefined);
  assert.equal(bot.pathfinder.movements.allowedPosition, inherited);
  const policy = surfaceMovement(bot);
  assert(!policy.allowed(new Vec3(6, 55, 0)), 'Ordinary surface hunting still rejects caves');
  policy.restore();
});

test('failed or cancelled surface recovery restores movement policy and keeps its bounded attempts', async () => {
  for (const cancelled of [false, true]) {
    const { bot, inherited } = undergroundFixture();
    const task = new Task('test', 'recover'), goal = {};
    bot.pathfinder.getPathFromTo = function * () {
      if (cancelled) task.cancel();
      yield { result: { status: 'noPath', path: [] } };
    };
    await assert.rejects(returnToSurface(bot, task, goal, () => {}), cancelled ? { name: 'Cancelled' } : /No safe route from underground/);
    assert.equal(bot.pathfinder.movements.allowedPosition, inherited);
    assert.equal(goal.surfaceReturn.attempts, 1);
    assert.equal(bot.entity.position.y, 55);
  }
});

test('deep surface recovery excavates one supported step at a time and preserves the mining worksite', async () => {
  const { bot } = world(), changed = new Map();
  bot.entity.position = new Vec3(0.5, 16, 0.5);
  bot.registry = require('minecraft-data')('26.1');
  bot.inventory = { items: () => [{ type: 1 }] };
  bot.findBlocks = () => [];
  bot.blockAt = p => {
    const name = changed.get(`${p}`) || (p.y < 64 ? 'stone' : 'air');
    return { name, position: p, boundingBox: name === 'stone' ? 'block' : 'empty', diggable: true, harvestTools: name === 'stone' ? { 1: true } : undefined };
  };
  changed.set('(0, 16, 0)', 'air'); changed.set('(0, 17, 0)', 'air');
  const mining = { steps: 35, target: { x: -30, y: 2, z: -40 }, visited: {} };
  const goal = { tunnel: mining }, before = { ...bot.pathfinder.movements };
  let digCount = 0;
  for (let step = 0; step < 48 && !surfaceObserver(bot)(bot.entity.position.floored()); step++) {
    const start = bot.entity.position.floored();
    await returnToSurface(bot, new Task('exit'), goal, () => {}, {
      dig: async (_bot, _task, p) => {
        assert(!p.equals(bot.entity.position.floored().offset(0, -1, 0)));
        changed.set(`${p}`, 'air'); digCount++;
      },
      navigate: async (_bot, _task, target) => {
        assert.equal(target.y, start.y + 1);
        assert.equal(bot.blockAt(new Vec3(target.x, target.y - 1, target.z)).name, 'stone');
        bot.entity.position = new Vec3(target.x + 0.5, target.y, target.z + 0.5);
      },
    });
    assert.equal(bot.entity.position.y, start.y + 1);
    for (const [key, value] of Object.entries(before)) assert.deepEqual(bot.pathfinder.movements[key], value);
    assert.equal(goal.tunnel, mining);
    assert.equal(goal.tunnel.steps, 35);
  }
  assert(digCount > 48);
  assert(bot.entity.position.y >= 62, 'Escapes the deep cave through a real opening to the sky');
  assert(surfaceObserver(bot)(bot.entity.position.floored()));
  assert.equal(goal.surfaceReturn, undefined);
  assert.equal(goal.step.action, 'ascend_to_surface');
});

test('surface ascent yields for replacement-tool preparation and can be cancelled without excavating', async () => {
  const { bot } = undergroundFixture(); bot.findBlocks = () => [];
  const task = new Task('exit'), goal = {};
  let preparations = 0;
  const actions = { prepareTool: async () => { preparations++; return false; }, dig: async () => assert.fail('No tool yet') };
  await returnToSurface(bot, task, goal, () => {}, actions);
  assert.equal(preparations, 1); assert.equal(bot.entity.position.y, 55);
  task.cancel();
  await assert.rejects(returnToSurface(bot, task, goal, () => {}, actions), { name: 'Cancelled' });
  assert.equal(preparations, 1);
});
