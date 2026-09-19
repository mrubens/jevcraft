'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { runGoal } = require('../src/work');
const { collectNearbyDrops, pickupPositions } = require('../src/drop-collection');

function fixture() {
  const registry = require('minecraft-data')('26.1');
  let count = 0;
  const drop = { id: 7, position: new Vec3(3.5, 64, .5), getDroppedItem: () => ({ name: 'cobblestone' }) };
  const bot = { registry, game: { gameMode: 'survival', difficulty: 'peaceful', dimension: 'overworld' },
    health: 20, food: 20, entity: { position: new Vec3(.5, 60, .5), onGround: true }, entities: { 7: drop },
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, type: registry.itemsByName.stone_pickaxe.id },
      ...(count ? [{ name: 'cobblestone', count }] : [])] },
    blockAt: p => { const name = p.y < 60 ? 'bedrock' : 'air'; return { name, position: p.floored(), boundingBox: name === 'air' ? 'empty' : 'block' }; },
    findBlocks: () => [], chat() {},
    pathfinder: { movements: { canDig: true, allow1by1towers: true, scafoldingBlocks: [1], blocksCantBreak: new Set() }, setGoal() {},
      getPathTo: (_m, g) => ({ status: 'success', path: [new Vec3(g.x, g.y, g.z)] }),
    },
  };
  return { bot, drop, collect: () => { count++; delete bot.entities[drop.id]; } };
}

test('resource acquisition waits for falling loot and collects it without excavating or mining replacements', async () => {
  const { bot, drop, collect } = fixture(), original = { ...bot.pathfinder.movements }, visits = [];
  bot.pathfinder.goto = async g => {
    visits.push({ x: g.x, y: g.y, z: g.z });
    assert.equal(bot.pathfinder.movements.canDig, false, 'Picking up a drop must not excavate');
    assert.deepEqual(bot.pathfinder.movements.scafoldingBlocks, []);
    assert.equal(g.y, 60, 'Do not chase the old airborne item position');
    bot.entity.position = new Vec3(g.x + .5, g.y, g.z + .5); collect();
  };
  const timer = setTimeout(() => { drop.position.y = 60; }, 120);
  try {
    const goal = { kind: 'obtain', item: 'cobblestone', count: 1, deliver: false };
    const errors = [];
    const result = await runGoal(bot, new Task('pick up resource'), goal, { save() {} }, {
      maxSteps: 3, survival: { state: {}, step: async () => false },
      onStep: g => { if (g.lastError) errors.push(g.lastError); },
      recoveryAdviser: { recordFailure() {}, suggest: async () => false },
    });
    assert(result.ok, JSON.stringify({ reason: result.reason, errors, visits })); assert.equal(visits.length, 1);
    for (const name of ['canDig', 'allow1by1towers', 'scafoldingBlocks', 'allowedPosition'])
      assert.equal(bot.pathfinder.movements[name], original[name]);
  } finally { clearTimeout(timer); }
});

test('a drop moving during approach invalidates the old route and is observed again', async () => {
  const { bot, drop, collect } = fixture(); drop.position.y = 60;
  const visits = [];
  assert(await collectNearbyDrops(bot, new Task('moving loot'), 'cobblestone', { timeoutMs: 1000,
    move: async (_b, _t, destination, options) => {
      visits.push(destination.x);
      if (visits.length === 1) { drop.position.x = 7.5; assert(options.stopWhen()); }
      else { collect(); assert(options.stopWhen()); }
    } }));
  assert.deepEqual(visits, [3, 7]);
});

test('another player taking a drop does not count as our pickup', async () => {
  const { bot, drop } = fixture(); drop.position.y = 60;
  assert.equal(await collectNearbyDrops(bot, new Task('lost loot'), 'cobblestone', { timeoutMs: 500,
    move: async (_b, _t, _g, options) => { delete bot.entities[drop.id]; assert(options.stopWhen()); } }), false);
});

test('an unreachable nearer stack does not hide a reachable alternative', async () => {
  const { bot, drop, collect } = fixture(); drop.position.y = 60;
  bot.entities[8] = { ...drop, id: 8, position: new Vec3(7.5, 60, .5) };
  bot.pathfinder.getPathTo = (_m, g) => ({ status: g.x < 6 ? 'noPath' : 'success', path: [] });
  assert(await collectNearbyDrops(bot, new Task('other loot'), 'cobblestone', { timeoutMs: 500,
    move: async (_b, _t, g) => { assert(g.x >= 6); collect(); } }));
});

test('blocked drops have a cooldown, and a new observed position permits another try', async () => {
  const { bot, drop, collect } = fixture(); drop.position.y = 60;
  let surveys = 0;
  bot.pathfinder.getPathTo = () => { surveys++; return { status: 'noPath', path: [] }; };
  const task = new Task('blocked loot'), options = { timeoutMs: 120, move: async () => assert.fail('No safe route') };
  assert.equal(await collectNearbyDrops(bot, task, 'cobblestone', options), false);
  const first = surveys; assert(first > 0);
  assert.equal(await collectNearbyDrops(bot, task, 'cobblestone', options), false); assert.equal(surveys, first);
  drop.position.x += 2;
  bot.pathfinder.getPathTo = () => ({ status: 'success', path: [] });
  assert(await collectNearbyDrops(bot, task, 'cobblestone', { ...options, move: async () => collect() }));
});

test('loot routes do not excavate, place blocks, enter hazards or violate inherited boundaries', async () => {
  for (const path of [[{ x: 2, y: 60, z: 0, toBreak: [{}] }], [{ x: 2, y: 60, z: 0, toPlace: [{}] }],
    [new Vec3(-1, 60, 0)], [new Vec3(2, 50, 0)], [new Vec3(30, 60, 0)]]) {
    const { bot, drop } = fixture(); drop.position.y = 60;
    bot.pathfinder.movements.allowedPosition = p => p.x >= 0;
    const before = { ...bot.pathfinder.movements };
    bot.pathfinder.getPathTo = m => { assert.equal(m.canDig, false); return { status: 'success', path }; };
    assert.equal(await collectNearbyDrops(bot, new Task('unsafe loot'), 'cobblestone', { timeoutMs: 30,
      move: async () => assert.fail('Unsafe route') }), false);
    assert.deepEqual(bot.pathfinder.movements, before);
  }
  const { bot, drop } = fixture(); drop.position.y = 60;
  bot.blockAt = p => ({ position: p, name: p.y < 60 ? 'magma_block' : 'air', boundingBox: p.y < 60 ? 'block' : 'empty' });
  assert.deepEqual(pickupPositions(bot, drop), []);
  bot.blockAt = p => p.y < 60 ? null : { name: 'air', boundingBox: 'empty' };
  assert.deepEqual(pickupPositions(bot, drop), [], 'Unknown ground is not a landing');
});

test('stopping or needing air interrupts pickup and restores movement settings', async () => {
  for (const reason of ['Cancelled', 'NeedsAir', 'NeedsSafety']) {
    const { bot, drop } = fixture(); drop.position.y = 60;
    bot.pathfinder.movements.allowedPosition = () => true;
    const before = { ...bot.pathfinder.movements }, task = new Task('interrupt loot');
    await assert.rejects(collectNearbyDrops(bot, task, 'cobblestone', { move: async () => {
      if (reason === 'Cancelled') { task.cancel(); task.check(); }
      throw Object.assign(new Error(reason), { name: reason });
    } }), { name: reason });
    assert.deepEqual(bot.pathfinder.movements, before);
  }
});

test('post-dig pickup handles delayed spawn and stops on inventory confirmation', async () => {
  const { bot, drop, collect } = fixture(); delete bot.entities[drop.id]; drop.position.y = 60;
  const timer = setTimeout(() => { bot.entities[drop.id] = drop; }, 50);
  try {
    assert(await collectNearbyDrops(bot, new Task('late loot'), 'cobblestone', { waitForSpawnMs: 300, timeoutMs: 500,
      move: async (_b, _t, _g, options) => { collect(); assert(options.stopWhen()); } }));
  } finally { clearTimeout(timer); }
});

test('partial path-block surfaces are supported pickup positions, airborne points are not', () => {
  const { bot, drop } = fixture();
  assert.deepEqual(pickupPositions(bot, drop), []);
  bot.blockAt = p => ({ name: p.y === 59 ? 'dirt_path' : 'air', position: p.floored(),
    boundingBox: p.y === 59 ? 'block' : 'empty', shapes: p.y === 59 ? [[0, 0, 0, 1, .9375, 1]] : [] });
  drop.position.y = 59.9375;
  assert.equal(pickupPositions(bot, drop)[0].y, 59.9375);
});
