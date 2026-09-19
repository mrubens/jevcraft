'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('events'), { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { fallDanger, clutchTarget, recoverFall } = require('../src/fall-recovery');
const { fillWaterBucket } = require('../src/water');
const { planCatalog } = require('../src/knowledge');
const registry = require('minecraft-data')('26.1');
function fixture() {
  const stock = { water_bucket: 1 }, support = new Vec3(0, 0, 0), task = new Task('fall'), goal = {};
  let clicks = 0, placed = false;
  const bot = Object.assign(new EventEmitter(), {
    health: 20, oxygenLevel: 20, isAlive: true, game: { dimension: 'the_end' },
    entity: { position: new Vec3(.5, 2.8, .5), velocity: new Vec3(0, -1, 0), onGround: false },
    inventory: { items: () => Object.entries(stock).filter(([, count]) => count).map(([name, count]) => ({ name, count })) },
    pathfinder: { setGoal() {} }, clearControlStates() {}, deactivateItem() {},
    world: { raycast: () => ({ position: support, intersect: support.offset(.5, 1, .5) }) },
    blockAt: p => ({ name: p.y < 1 ? 'stone' : placed && p.floored().y === 1 ? 'water' : 'air', boundingBox: p.y < 1 ? 'block' : 'empty', metadata: 0 }),
    equip: async item => { bot.heldItem = item; }, look: async () => {}, lookAt: async () => {},
    activateItem: () => { clicks++; stock.water_bucket = 0; stock.bucket = 1; placed = true; bot.heldItem = { name: 'bucket' };
      bot.entity.position.y = 1; bot.entity.velocity.y = -.005; },
  });
  return { bot, task, goal, stock, clicks: () => clicks };
}
test('fall detection distinguishes a high launch or long descent from standing, swimming and a small step', () => {
  const { bot } = fixture();
  assert(fallDanger(bot)); bot.entity.onGround = true; assert.equal(fallDanger(bot), false);
  bot.entity.onGround = false; bot.entity.velocity.y = .8; assert(fallDanger(bot));
  bot.entity.isInWater = true; assert.equal(fallDanger(bot), false); bot.entity.isInWater = false;
  bot.entity.velocity.y = -.3; assert.equal(fallDanger(bot), false);
  bot.world.raycast = () => null; assert(fallDanger(bot));
});
test('water clutch respects last server reach, loaded support and a clear destination', () => {
  const { bot } = fixture();
  assert(clutchTarget(bot, bot.entity.position));
  assert.equal(clutchTarget(bot, bot.entity.position.offset(0, 4, 0)), null);
  bot.blockAt = () => null; assert.equal(clutchTarget(bot, bot.entity.position), null);
});
test('fall recovery uses one click and only records success after inventory and world confirmation', async () => {
  for (const acknowledged of [true, false]) {
    const { bot, task, goal, clicks } = fixture();
    if (!acknowledged) bot.activateItem = () => {};
    const timer = setInterval(() => bot.emit('physicsTick'), 5);
    try {
      const promise = recoverFall(bot, task, goal, () => {}, { timeoutMs: acknowledged ? 700 : 80, refill: false });
      if (acknowledged) {
        assert(await promise); assert.equal(clicks(), 1);
        assert.equal(goal.fallRecoveries.length, 1); assert.equal(goal.fallRecoveries[0].sourceConfirmed, true);
      } else { await assert.rejects(promise, /server-confirmed/); assert.equal(goal.fallRecoveries, undefined); }
      assert.equal(bot.listenerCount('physicsTick'), 0); assert.equal(task.interruptCheck, undefined);
    } finally { clearInterval(timer); }
  }
});
test('fall cancellation and dimension changes release handlers and never claim a recovery', async () => {
  for (const cancel of [true, false]) {
    const { bot, task, goal } = fixture();
    const timer = setTimeout(() => { if (cancel) task.cancel(); else bot.game.dimension = 'overworld'; }, 10);
    await assert.rejects(recoverFall(bot, task, goal, () => {}, { timeoutMs: 100 }), cancel ? { name: 'Cancelled' } : /dimension change/);
    clearTimeout(timer); assert.equal(bot.listenerCount('physicsTick'), 0); assert.equal(goal.fallRecoveries, undefined);
  }
});

test('landing on dry ground after a water attempt ends the emergency without claiming a water landing', async () => {
  for (const converted of [true, false]) {
    const { bot, task, goal, stock } = fixture(); let clicks = 0;
    bot.blockAt = p => ({ name: p.y < 1 ? 'stone' : stock.bucket && p.floored().x === 0 && p.floored().y === 1 ? 'water' : 'air',
      boundingBox: p.y < 1 ? 'block' : 'empty', metadata: 0 });
    const raycast = bot.world.raycast;
    bot.world.raycast = (...args) => bot.heldItem?.name === 'bucket' ? null : raycast(...args);
    bot.activateItem = () => {
      clicks++;
      if (bot.heldItem.name === 'bucket') { stock.water_bucket = 1; stock.bucket = 0; return; }
      if (converted) { stock.water_bucket = 0; stock.bucket = 1; }
      bot.entity.position.set(2.5, 1, .5); bot.entity.velocity.set(0, -.0784, 0); bot.entity.onGround = true;
    };
    const timer = setInterval(() => bot.emit('physicsTick'), 5);
    try {
      assert.equal(await recoverFall(bot, task, goal, () => {}, { timeoutMs: 700 }), false);
      assert.equal(goal.fallRecoveries, undefined);
      assert.equal(goal.lastFallLanding.outcome, 'stable_dry_landing');
      assert.equal(goal.lastFallLanding.waterProtectionConfirmed, false);
      assert.equal(goal.lastFallLanding.waterConsumed, converted ? 1 : 0);
      assert.equal(goal.lastFallLanding.bucketRecovered, converted ? true : undefined);
      assert.equal(stock.water_bucket, 1); assert.equal(clicks, converted ? 2 : 1);
      assert.equal(bot.listenerCount('physicsTick'), 0);
    } finally { clearInterval(timer); }
  }
});

test('brief ground contact followed by another fall cannot complete the landing guard', async () => {
  const { bot, task, goal } = fixture();
  bot.activateItem = () => { bot.entity.position.y = 1; bot.entity.onGround = true; bot.entity.velocity.y = -.0784; };
  const timer = setInterval(() => bot.emit('physicsTick'), 5);
  const airborne = setTimeout(() => { bot.entity.onGround = false; bot.entity.position.y = 3; bot.entity.velocity.y = -.4; }, 65);
  try {
    await assert.rejects(recoverFall(bot, task, goal, () => {}, { timeoutMs: 180 }), /server-confirmed/);
    assert.equal(goal.lastFallLanding, undefined); assert.equal(goal.fallRecoveries, undefined);
  } finally { clearInterval(timer); clearTimeout(airborne); }
});
test('water acquisition plans the real iron bucket dependency and accounts for each consumed bucket', () => {
  const plan = planCatalog(registry, 'water_bucket', 2, { iron_ingot: 6, crafting_table: 1 });
  assert.deepEqual(plan.map(s => [s.action, s.item]), [['craft', 'bucket'], ['fill_bucket', 'water_bucket']]);
  assert.deepEqual(plan.at(-1).consumes, { bucket: 2 }); assert.deepEqual(plan.at(-1).produces, { water_bucket: 2 });
});
test('filling rejects stale reach and requires an actual empty-to-water inventory conversion', async () => {
  for (const behavior of ['success', 'no_ack', 'moved']) {
    const { bot, task, stock } = fixture(); stock.water_bucket = 0; stock.bucket = 1;
    bot.blockAt = () => ({ name: 'water', metadata: 0 }); bot.world.raycast = () => null;
    bot.lookAt = async (point, immediate) => {
      assert.equal(immediate, true, 'Fluid interactions must not wait for a turn while the current moves the player');
      if (behavior === 'moved') bot.entity.position.x = 10;
    };
    let used = 0;
    bot.activateItem = () => { used++; if (behavior === 'success') { stock.water_bucket = 1; stock.bucket = 0; } };
    const promise = fillWaterBucket(bot, task, new Vec3(0, 1, 0), { timeoutMs: 30 });
    if (behavior === 'success') await promise;
    else await assert.rejects(promise, behavior === 'moved' ? /reach/ : /conversion/);
    assert.equal(used, behavior === 'moved' ? 0 : 1);
  }
});
