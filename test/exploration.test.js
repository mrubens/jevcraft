'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { explore } = require('../src/work');
const { Task } = require('../src/skills');

test('exploration reaches a distant waypoint through intermediate walks before rotating', async () => {
  const registry = require('minecraft-data')('26.1');
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    registry,
    blockAt: () => ({ name: 'air' }),
    findBlocks: ({ matching }) => matching.includes(registry.blocksByName.grass_block.id) ? [bot.entity.position.offset(9, -1, 0), bot.entity.position.offset(0, -1, 9)] : [],
    pathfinder: { goto: async g => { bot.entity.position = new Vec3(g.x, g.y, g.z); }, setGoal: () => {} },
  };
  const task = new Task('test', 'search');
  const goal = {};
  await explore(bot, task, goal, () => {}, 'sand');
  assert.equal(goal.search.sand.leg, 0);
  assert.equal(bot.entity.position.x, 9);
  await explore(bot, task, goal, () => {}, 'sand');
  assert.equal(goal.search.sand.leg, 0);
  assert.equal(bot.entity.position.x, 18);
  await explore(bot, task, goal, () => {}, 'sand');
  assert.equal(goal.search.sand.leg, 1);
  assert.equal(bot.entity.position.x, 27);
});

test('surface exploration recognizes ground covered by non-colliding forest vegetation', async () => {
  const registry = require('minecraft-data')('26.1'), target = new Vec3(10, 63, 0);
  for (const name of ['leaf_litter', 'short_grass', 'tall_grass']) {
    const bot = { registry, game: { minY: 0, height: 80 }, entity: { position: new Vec3(0.5, 64, 0.5) },
      blockAt: p => ({ position: p, name: p.y < 64 ? 'grass_block' : p.y === 64 ? name : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
      findBlocks: ({ matching, useExtraInfo }) => matching.includes(registry.blocksByName.grass_block.id) && useExtraInfo(bot.blockAt(target)) ? [target] : [],
      pathfinder: { movements: {}, setGoal() {}, goto: async g => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); } },
    };
    await explore(bot, new Task('forest search'), {}, () => {}, 'rose_bush');
    assert.equal(bot.entity.position.x, 10.5, name);
  }
});

test('exploration leaves an unreachable geometric waypoint instead of spending the entire search there', async () => {
  const registry = require('minecraft-data')('26.1');
  const bot = { registry, game: { minY: 0, height: 100 }, entity: { position: new Vec3(22, 64, 8) }, blockAt: () => ({ name: 'air' }),
    findBlocks: ({ matching }) => matching.includes(registry.blocksByName.grass_block.id) ? [new Vec3(22, 63, 8)] : [],
    pathfinder: { movements: {}, goto: async () => {}, setGoal() {} } };
  const goal = { search: { rose_bush: { origin: { x: 0, y: 64, z: 0 }, attempts: 0, leg: 0 } } };
  for (let n = 0; n < 3; n++) await explore(bot, new Task('test', 'search'), goal, () => {}, 'rose_bush');
  assert.equal(goal.search.rose_bush.leg, 1);
  assert.equal(goal.search.rose_bush.attempts, 3);
});

test('route surveys continue partial searches while respecting cancellation and deadlines', async () => {
  const { surveyRoute } = require('../src/skills');
  const bot = { entity: { position: new Vec3(0, 64, 0) }, pathfinder: {
    getPathFromTo: function * () { yield { result: { status: 'partial', path: [1] } }; yield { result: { status: 'success', path: [1, 2] } }; },
  } };
  assert.deepEqual(await surveyRoute(bot, new Task('test', 'survey'), {}, {}, 100), { status: 'success', path: [1, 2] });
  const cancelled = new Task('test', 'cancel');
  bot.pathfinder.getPathFromTo = function * () { yield { result: { status: 'partial', path: [] } }; cancelled.cancel(); yield { result: { status: 'success', path: [] } }; };
  await assert.rejects(surveyRoute(bot, cancelled, {}, {}, 100), { name: 'Cancelled' });
  bot.pathfinder.getPathFromTo = function * () { while (true) yield { result: { status: 'partial', path: [] } }; };
  assert.equal((await surveyRoute(bot, new Task('test', 'deadline'), {}, {}, 20)).status, 'timeout');
});
test('an empty path resolving successfully is not accepted as arrival', async () => {
  const { navigate } = require('../src/skills');
  const { goals } = require('mineflayer-pathfinder');
  let stopped = false;
  const bot = { entity: { position: new Vec3(0, 64, 0) }, pathfinder: {
    goto: async () => {}, setGoal: () => { stopped = true; },
  } };
  await assert.rejects(navigate(bot, new Task('test', 'test'), new goals.GoalBlock(10, 64, 0)), /before reaching/);
  assert(stopped);
});

test('navigation stops when stationary, but allows a longer route that makes progress', async () => {
  const { navigate } = require('../src/skills');
  let stopped = false;
  const bot = { entity: { position: new Vec3(0, 64, 0) }, pathfinder: {
    goto: () => new Promise(() => {}), setGoal: () => { stopped = true; },
  } };
  await assert.rejects(navigate(bot, new Task('test', 'stalled'), {}, { timeoutMs: 2000, stallMs: 100 }), /timed out/);
  assert(stopped);
  const motion = setInterval(() => { bot.entity.position.x++; }, 50);
  bot.pathfinder.goto = () => new Promise(resolve => setTimeout(resolve, 450));
  try { await navigate(bot, new Task('test', 'moving'), {}, { timeoutMs: 2000, stallMs: 200 }); }
  finally { clearInterval(motion); }
});

test('navigation has a hard deadline even while moving', async () => {
  const { navigate } = require('../src/skills');
  const bot = { entity: { position: new Vec3(0, 64, 0) }, pathfinder: {
    goto: () => new Promise(() => {}), setGoal: () => {},
  } };
  const motion = setInterval(() => { bot.entity.position.x++; }, 50);
  try {
    await assert.rejects(navigate(bot, new Task('test', 'wandering'), {}, { timeoutMs: 250, stallMs: 200 }), /timed out/);
  } finally { clearInterval(motion); }
});

test('navigation waits to land before the next digging action can start', async () => {
  const { navigate } = require('../src/skills');
  let stopped = false;
  const bot = { entity: { position: new Vec3(0, 64.9, 0), onGround: false }, clearControlStates: () => { stopped = true; },
    pathfinder: { goto: async () => {}, setGoal: () => {} } };
  setTimeout(() => { bot.entity.position.y = 64; bot.entity.onGround = true; }, 80);
  await navigate(bot, new Task('test', 'land'), {});
  assert(stopped);
  assert(bot.entity.onGround);
  assert.equal(bot.entity.position.y, 64);
});

test('navigation interrupts promptly for air even while making progress', async () => {
  const { navigate } = require('../src/skills');
  let stopped = false;
  const bot = { oxygenLevel: 20, entity: { position: new Vec3(0, 60, 0), isInWater: true },
    clearControlStates: () => {}, stopDigging: () => {},
    pathfinder: { goto: () => new Promise(() => {}), setGoal: () => { stopped = true; } } };
  setTimeout(() => { bot.oxygenLevel = 12; bot.entity.position.x += 2; }, 20);
  await assert.rejects(navigate(bot, new Task('test', 'dive'), {}), { name: 'NeedsAir' });
  assert(stopped);
});

test('resource pickup ends a mining approach without excavating the rest of the route', async () => {
  const { navigate } = require('../src/skills');
  const { goals } = require('mineflayer-pathfinder');
  let collected = false;
  let stopped = false;
  const bot = { entity: { position: new Vec3(0, 64, 0), onGround: true },
    clearControlStates: () => {}, stopDigging: () => {},
    pathfinder: { goto: () => new Promise(() => {}), setGoal: () => { stopped = true; } } };
  setTimeout(() => { collected = true; }, 20);
  await navigate(bot, new Task('test', 'mine'), new goals.GoalBlock(20, 30, 0), { stopWhen: () => collected });
  assert(stopped);
  assert.equal(bot.entity.position.y, 64);
});

test('bobbing in place does not indefinitely reset the navigation stall timer', async () => {
  const { navigate } = require('../src/skills');
  const bot = { entity: { position: new Vec3(0, 62, 0), isInWater: true },
    pathfinder: { goto: () => new Promise(() => {}), setGoal: () => {} } };
  const motion = setInterval(() => { bot.entity.position.y = bot.entity.position.y === 62 ? 64 : 62; }, 80);
  const started = Date.now();
  try { await assert.rejects(navigate(bot, new Task('test', 'swim'), {}, { timeoutMs: 2000, stallMs: 300 }), /timed out/); }
  finally { clearInterval(motion); }
  assert(Date.now() - started < 1500);
});

function correctionFixture({ safe = true } = {}) {
  const { EventEmitter } = require('node:events');
  const bot = new EventEmitter();
  const controls = {};
  let attempts = 0, corrections;
  Object.assign(bot, {
    entity: { position: new Vec3(0.5, 64, 0.7), onGround: false },
    blockAt: p => ({ name: p.y === 63 ? 'stone' : 'air',
      shapes: p.y === 63 && safe ? [[0, 0, 0, 1, 1, 1]] : [] }),
    clearControlStates: () => { for (const k of Object.keys(controls)) controls[k] = false; },
    setControlState: (key, value) => { controls[key] = value; },
    lookAt: async () => {},
    pathfinder: {
      goto: () => {
        attempts++;
        corrections = setInterval(() => bot.emit('forcedMove'), 10);
        return new Promise(() => {});
      },
      setGoal: () => clearInterval(corrections),
    },
  });
  return { bot, controls, attempts: () => attempts, dispose: () => clearInterval(corrections) };
}

test('a repeated server correction permits one ordinary movement recovery then fails cleanly', async () => {
  const { navigate } = require('../src/skills');
  const fixture = correctionFixture();
  const { bot, controls } = fixture;
  let recoveries = 0;
  bot.on('navigation_recovery', () => { recoveries++; });
  // Simulate observed physics only after the recovery actually uses controls.
  const motion = setInterval(() => {
    if (controls.forward) { bot.entity.position.z = 0.55; bot.entity.onGround = true; }
  }, 10);
  try {
    await assert.rejects(navigate(bot, new Task('test', 'recover'), {}, { timeoutMs: 2000 }), /Repeated server/);
    assert.equal(fixture.attempts(), 2);
    assert.equal(recoveries, 1);
    assert.equal(bot.listenerCount('forcedMove'), 0);
    assert(Object.values(controls).every(v => !v));
  } finally { clearInterval(motion); fixture.dispose(); }
});

test('navigation recovery refuses unsupported footing and respects cancellation and the original deadline', async () => {
  const { navigate } = require('../src/skills');
  for (const kind of ['unsafe', 'cancel', 'deadline', 'air']) {
    const fixture = correctionFixture({ safe: kind !== 'unsafe' });
    const { bot, controls } = fixture;
    const task = new Task('test', kind);
    const started = Date.now();
    const interrupt = setInterval(() => {
      if (!controls.forward) return;
      if (kind === 'cancel') task.cancel();
      if (kind === 'air') bot.oxygenLevel = 10;
    }, 10);
    try {
      await assert.rejects(navigate(bot, task, {}, { timeoutMs: 350 }), kind === 'cancel' ? { name: 'Cancelled' } : kind === 'air' ? { name: 'NeedsAir' } : /Repeated server/);
      assert.equal(fixture.attempts(), 1);
      assert(Date.now() - started < 1000);
      assert.equal(bot.listenerCount('forcedMove'), 0);
      assert(Object.values(controls).every(v => !v));
    } finally { clearInterval(interrupt); fixture.dispose(); }
  }
});
