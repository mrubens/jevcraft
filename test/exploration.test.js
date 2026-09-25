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

test('underground exploration uses deep-cave footing while rejecting flooded landings', async () => {
  const registry = require('minecraft-data')('26.1');
  for (const material of ['deepslate', 'tuff', 'andesite']) {
    const dry = new Vec3(10, -48, 0), flooded = new Vec3(9, -48, 0);
    const bot = { registry, entity: { position: new Vec3(.5, -47, .5) },
      blockAt: p => ({ position: p, name: p.y < -47 ? material : p.x === flooded.x && p.y === -47 ? 'water' : 'air', boundingBox: p.y < -47 ? 'block' : 'empty' }),
      findBlocks: ({ matching, useExtraInfo }) => matching.includes(registry.blocksByName[material].id)
        ? [flooded, dry].filter(p => useExtraInfo(bot.blockAt(p))) : [],
      pathfinder: { movements: {}, setGoal() {}, goto: async g => { bot.entity.position = new Vec3(g.x + .5, g.y, g.z + .5); } },
    };
    await explore(bot, new Task('cave search'), {}, () => {}, 'obsidian');
    assert.equal(bot.entity.position.x, 10.5, `${material} dry landing`);
    assert.equal(bot.entity.position.y, -47);
  }
});

test('an observed deposit eight blocks below continues its inspected staircase', async () => {
  const registry = require('minecraft-data')('26.1'), deposit = new Vec3(-62, -55, -117), work = new Vec3(-70, -47, -117);
  const bot = { registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(-61.7, -47, -116.5) },
    inventory: { items: () => [{ name: 'diamond_pickaxe', count: 1, type: registry.itemsByName.diamond_pickaxe.id }] },
    blockAt: p => ({ name: p.equals(deposit) ? 'obsidian' : p.equals(deposit.offset(0, 1, 0)) ? 'water' : 'air', position: p }),
    findBlocks: ({ matching }) => matching.includes(registry.blocksByName.obsidian.id) ? [deposit] : [],
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'success', path: [] }),
      goto: async g => { bot.entity.position = new Vec3(g.x, g.y, g.z); } },
  };
  const goal = { search: { obsidian: { attempts: 4, origin: { x: -62, y: -47, z: -117 } } },
    miningSites: { 'overworld:obsidian': { workPosition: { ...work }, steps: 74, visited: {} } } };
  await explore(bot, new Task('continue cave approach'), goal, () => {}, 'obsidian');
  assert.equal(goal.step.action, 'return_to_mine');
  assert.deepEqual(goal.step.destination, { ...work });
  assert.equal(goal.search.obsidian.attempts, 5);
});

test('a stranded tree perch can take a short dry exit when every distant route fails', async () => {
  const registry = require('minecraft-data')('26.1'), landing = new Vec3(-488, 74, 200), distant = new Vec3(-478, 74, 200);
  const bot = { registry, game: { minY: 0, height: 90 }, entity: { position: new Vec3(-487.51, 77, 199.5) },
    blockAt: p => ({ position: p, name: p.y <= 74 ? 'dirt' : 'air', boundingBox: p.y <= 74 ? 'block' : 'empty' }),
    findBlocks: ({ matching, maxDistance, useExtraInfo }) => matching.includes(registry.blocksByName.dirt.id)
      ? [maxDistance <= 8 ? landing : distant].filter(p => useExtraInfo(bot.blockAt(p))) : [],
    pathfinder: { movements: { allow1by1towers: true }, setGoal() {},
      getPathTo: (_movement, g) => ({ status: g.x === landing.x ? 'success' : 'noPath', path: [] }),
      goto: async g => { assert.equal(bot.pathfinder.movements.allow1by1towers, false); bot.entity.position = new Vec3(g.x + .5, g.y, g.z + .5); } },
  };
  await explore(bot, new Task('perch exit'), {}, () => {}, 'oak_log');
  assert.equal(bot.entity.position.y, 75);
  assert.equal(bot.entity.position.z, 200.5);
  assert.equal(bot.pathfinder.movements.allow1by1towers, true, 'Restores the ordinary movement policy');
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
  await assert.rejects(navigate(bot, new Task('test', 'test'), new goals.GoalBlock(10, 64, 0)), /before reaching|No route/);
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

test('a stalled swimmer recenters within its observed water cell once before retrying', async () => {
  const { EventEmitter } = require('node:events'), { navigate } = require('../src/skills');
  const bot = new EventEmitter(), controls = {};
  let attempts = 0, recoveries = 0;
  Object.assign(bot, { oxygenLevel: 20,
    entity: { position: new Vec3(0.7, 59.2, 0.8), isInWater: true, onGround: false },
    blockAt: p => ({ name: p.y <= 60 ? 'water' : 'air', shapes: [] }),
    clearControlStates: () => { for (const key of Object.keys(controls)) controls[key] = false; },
    setControlState: (key, value) => { controls[key] = value; }, lookAt: async () => {},
    pathfinder: { setGoal() {}, goto: async () => { if (++attempts === 1) await new Promise(() => {}); } },
  });
  bot.on('navigation_recovery', event => { recoveries++; assert(event.swimming); });
  const motion = setInterval(() => {
    if (controls.forward) { assert(!controls.sneak); bot.entity.position.x = 0.5; bot.entity.position.z = 0.5; }
  }, 10);
  try { await navigate(bot, new Task('swimming corner'), {}, { timeoutMs: 1500, stallMs: 100 }); }
  finally { clearInterval(motion); }
  assert.equal(attempts, 2); assert.equal(recoveries, 1);
  assert.equal(bot.entity.position.y, 59.2); assert(Object.values(controls).every(value => !value));
});

test('biomes about are shown with what they hold, and those far enough off are trips', () => {
  const { biomeView, biomeTrips } = require('../src/exploration');
  const registry = require('minecraft-data')('26.1');
  const id = name => Object.values(registry.biomes).find(b => b.name === name).id;
  // Desert here, plains to the north (negative z), ocean close by to the east.
  const biomeAt = p => p.z <= -64 ? 'plains' : p.x >= 32 && p.x < 64 && Math.abs(p.z) < 32 ? 'ocean' : 'desert';
  const bot = { registry, game: { dimension: 'minecraft:overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) },
    blockAt: p => ({ biome: { id: id(biomeAt(p)) } }) };
  const view = biomeView(bot, { now: 1 });
  assert.equal(view.biome, 'desert');
  assert.match(view.biomeHas, /no trees/);
  const plains = view.biomesNearby.find(b => b.biome === 'plains');
  assert.equal(plains.direction, 'north');
  assert.match(plains.has, /sheep/);
  const trips = biomeTrips(bot);
  assert.deepEqual(trips.map(t => t.biome), ['ocean', 'plains']);
  assert.match(trips[1].says, /^the plains 64 blocks north \(.*sheep/);
});

test('an ore chosen for the search is kept while it is there, not swapped for whichever is nearest after each step', async () => {
  // Trial 52: two iron ores east and west of it, the nearer one taken at
  // each call, four blocks of shore paced for a minute.
  const registry = require('minecraft-data')('26.1');
  const west = new Vec3(-4, 40, 0), east = new Vec3(4, 40, 0);
  const iron = registry.blocksByName.iron_ore.id;
  const bot = {
    entity: { position: new Vec3(-0.5, 64, 0) }, registry,
    blockAt: p => ({ name: (p.equals(west) || p.equals(east)) ? 'iron_ore' : 'air', position: p }),
    findBlocks: ({ matching }) => matching.includes(iron) ? [west, east] : [],
    pathfinder: { goto: async () => {}, setGoal: () => {} },
  };
  const goal = {};
  await explore(bot, new Task('test', 'search'), goal, () => {}, 'iron_ore', { surfaceOnly: false }).catch(() => {});
  const first = goal.search.iron_ore.observedTarget;
  // A step toward the other side: the other ore is now the nearer.
  bot.entity.position = first.x < 0 ? new Vec3(2, 64, 0) : new Vec3(-2, 64, 0);
  await explore(bot, new Task('test', 'search'), goal, () => {}, 'iron_ore', { surfaceOnly: false }).catch(() => {});
  assert.deepEqual(goal.search.iron_ore.observedTarget, first);
});
