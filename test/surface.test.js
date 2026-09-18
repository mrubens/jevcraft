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
