'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events'), { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { bearingFromSamples, triangulate, throwEye } = require('../src/ender-eye');
const { observedPortal, frameOffsets, travelTarget, findStronghold } = require('../src/stronghold');
const registry = require('minecraft-data')('26.1');
const ray = (x, z, target) => { const length = Math.hypot(target.x - x, target.z - z);
  return { origin: { x, y: 64, z }, direction: { x: (target.x - x) / length, z: (target.z - z) / length } }; };

test('eye observations retain downward evidence and reject short or non-collinear flight', () => {
  const points = [{ x: 0, y: 65, z: 0 }, { x: 3, y: 67, z: 4 }, { x: 6, y: 69, z: 8 }];
  const bearing = bearingFromSamples(points);
  assert.deepEqual(bearing.direction, { x: .6, z: .8 }); assert.equal(bearing.descending, false);
  assert.equal(bearingFromSamples(points.slice(0, 2)), null);
  assert.equal(bearingFromSamples([points[0], { x: 4, y: 67, z: 4 }, points[2]]), null);
  const down = bearingFromSamples([{ x: 0, y: 65, z: 0 }, { x: .1, y: 61, z: 0 }, { x: .2, y: 54, z: 0 }]);
  assert.equal(down.direction, null); assert.equal(down.descending, true);
});

test('triangulation requires separated, forward, consistent bearings and is never a located milestone', () => {
  const target = { x: 1000, z: 500 }, first = ray(0, 0, target), second = ray(64, 200, target);
  const estimate = triangulate([first, second]);
  assert(Math.abs(estimate.x - target.x) < .0001); assert(Math.abs(estimate.z - target.z) < .0001);
  assert.equal(triangulate([first, ray(2, 2, target)]), null, 'Insufficient baseline');
  assert.equal(triangulate([first, ray(100, 50, target)]), null, 'Parallel rays');
  assert.equal(triangulate([first, { ...second, direction: { x: -second.direction.x, z: -second.direction.z } }]), null, 'Intersection behind the throw');
  assert.equal(triangulate([first, second, ray(200, 0, { x: -1000, z: 2000 })]), null, 'Conflicting nearest-structure bearings');
});

function eyeFixture({ consume = true, ambiguous = false, cancel } = {}) {
  const item = { name: 'ender_eye', count: 16 }, bot = Object.assign(new EventEmitter(), {
    game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'peaceful' }, health: 20, oxygenLevel: 20,
    entity: { position: new Vec3(.5, 64, .5), yaw: 0 }, entities: {}, inventory: { items: () => [item] },
    pathfinder: { setGoal() {} }, clearControlStates() {},
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty' }),
    equip: async item => { bot.heldItem = item; }, look: async () => {}, deactivateItem() {},
  });
  const timers = [];
  bot.activateItem = () => {
    if (consume) item.count--;
    const eye = { id: 12, name: 'eye_of_ender', position: new Vec3(.5, 64.9, .5) };
    bot.entities[12] = eye; bot.emit('entitySpawn', eye);
    if (ambiguous) bot.emit('entitySpawn', { ...eye, id: 13, position: eye.position.clone() });
    for (let n = 1; n <= 3; n++) timers.push(setTimeout(() => {
      eye.position = new Vec3(.5 + n * 2, 64.9 + n, .5); bot.emit('entityMoved', eye);
      if (n === 1 && cancel) cancel();
      if (n === 3) { bot.emit('entityGone', eye); delete bot.entities[12]; }
    }, n * 20));
  };
  return { bot, item, cleanup: () => timers.forEach(clearTimeout) };
}

test('an eye throw requires both a new observed entity flight and actual inventory consumption', async () => {
  for (const consume of [true, false]) {
    const { bot, cleanup } = eyeFixture({ consume });
    try {
      const result = throwEye(bot, new Task('eye'), { timeoutMs: 180 });
      if (consume) { const bearing = await result; assert.equal(bearing.consumed, 1); assert.equal(bearing.direction.x, 1); }
      else await assert.rejects(result, /inventory confirmation/);
      for (const event of ['entitySpawn', 'entityMoved', 'entityGone']) assert.equal(bot.listenerCount(event), 0);
    } finally { cleanup(); }
  }
});

test('ambiguous eyes, cancellation and dimension changes cannot produce a bearing, and clean up listeners', async () => {
  for (const condition of ['ambiguous', 'cancelled', 'dimension']) {
    const task = new Task('eye');
    let bot;
    const fixture = eyeFixture({ ambiguous: condition === 'ambiguous', cancel: condition === 'cancelled' ? () => task.cancel() :
      condition === 'dimension' ? () => { bot.game.dimension = 'the_nether'; } : null });
    bot = fixture.bot;
    try {
      await assert.rejects(throwEye(bot, task, { timeoutMs: 200 }), condition === 'cancelled' ? { name: 'Cancelled' } : condition === 'dimension' ? /dimension/ : /ambiguous/);
      for (const event of ['entitySpawn', 'entityMoved', 'entityGone']) assert.equal(bot.listenerCount(event), 0);
    } finally { fixture.cleanup(); }
  }
});

test('the twelve-eye portal reserve and Survival restriction prevent use before any packet is sent', async () => {
  for (const condition of ['reserve', 'creative']) {
    const { bot, item } = eyeFixture();
    if (condition === 'reserve') item.count = 12; else bot.game.gameMode = 'creative';
    bot.activateItem = () => assert.fail('Must not consume an eye');
    await assert.rejects(throwEye(bot, new Task('eye')), condition === 'reserve' ? /reserved/ : /Survival/);
  }
});

function portalFixture() {
  const center = new Vec3(16, 24, -32), blocks = new Map();
  for (const o of frameOffsets) {
    const position = center.offset(o.x, 0, o.z);
    blocks.set(`${position}`, { position, name: 'end_portal_frame', getProperties: () => ({ facing: o.facing, eye: false }) });
  }
  const bot = { registry, game: { dimension: 'overworld', difficulty: 'peaceful' }, health: 20,
    entity: { position: new Vec3(16.5, 64, -31.5) }, inventory: { items: () => [] },
    findBlocks: () => [...blocks.values()].map(b => b.position), blockAt: p => blocks.get(`${p}`) || { name: 'air' } };
  return { bot, blocks, center };
}

test('only a complete inward-facing observed frame ring establishes a located stronghold', async () => {
  const { bot, blocks, center } = portalFixture(), goal = { gameProgress: { milestones: {} } };
  assert.deepEqual(observedPortal(bot).center, { ...center });
  const key = blocks.keys().next().value, frame = blocks.get(key); blocks.delete(key);
  assert.equal(observedPortal(bot), null);
  blocks.set(key, { ...frame, getProperties: () => ({ facing: 'west' }) });
  assert.equal(observedPortal(bot), null);
  blocks.set(key, frame);
  await findStronghold(bot, new Task('find'), goal, () => {}, {}, null);
  assert.equal(goal.gameProgress.milestones.stronghold_located.source, 'observed_end_portal_frame_ring');
  assert.equal(goal.endPortal.frames.length, 12);
});

test('a descending eye keeps a fixed excavation hint rather than moving the target deeper forever', () => {
  const search = { bearings: [{ descending: true, origin: { x: 1, y: 64, z: 1 }, end: { x: 2, y: 28.9, z: 2 } }] };
  assert.equal(travelTarget(search, { x: 1, y: 64, z: 1 }).y, 28);
  assert.equal(travelTarget(search, { x: 1, y: 20, z: 1 }).y, 28);
});

test('a contradictory new bearing clears a stale triangulated target and follows current evidence', () => {
  const target = { x: 1000, z: 500 }, bearings = [ray(0, 0, target), ray(64, 200, target)];
  const search = { bearings, estimate: triangulate(bearings) };
  bearings.push(ray(200, 0, { x: -1000, z: 2000 }));
  const next = travelTarget(search, { x: 200, y: 64, z: 0 });
  assert.equal(search.estimate, null);
  assert(next.x < 200 && next.z > 0);
});
