'use strict';
// Note 775b (critic-20261001T0358Z item 5; 25598 mid-241-bq, 03:56:18Z on
// 2026-10-01): "Lava in, water on top: I'm casting the portal frame", and in
// the same second the next step began with the batch of 3 raw iron in a
// furnace 11 blocks off and 7 up through rock: "I can't reach the furnace
// holding our saved batch", "stayed out of reach; starting the batch again",
// a climb to daylight, a new furnace, the 3 iron again; the portal 1 block
// from done, then 26.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const work = require('../src/work');

const FURNACE = { x: -274, y: 38, z: -475 };
function caveBot() {
  return { registry, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 18, chat() {}, emit() {},
    entity: { id: 1, position: new Vec3(-281.5, 31, -476.5), onGround: true }, entities: {}, time: { timeOfDay: 6000 },
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1 }, { name: 'cobblestone', count: 32 }], slots: [] }, findBlocks: () => [],
    blockAt: p => ({ position: p, name: p.x === FURNACE.x && p.y === FURNACE.y && p.z === FURNACE.z ? 'furnace' : 'stone', boundingBox: 'block' }),
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, clearControlStates() {} };
}
const batch = () => ({ item: 'iron_ingot', from: 'raw_iron', fuelItem: 'coal', position: { ...FURNACE }, dimension: 'overworld', targetInventory: 3, count: 3, startedAt: Date.now() - 60000,
  left: { at: Date.now() - 50000, doneAt: Date.now() - 20000 } });

test('while a portal frame is being cast, the batch in a furnace is not taken out at the head of a step, nor offered at upkeep', async () => {
  const bot = caveBot();
  const goal = { kind: 'win', smelting: batch(), portalFrame: { cast: true, origin: { x: -284, y: 29, z: -476 } }, portalMethod: { kind: 'cast' } };
  assert.equal(work.castUnderWay(goal), true);
  assert.equal(await work.takeOutBatch(bot, new Task('t'), goal, () => {}), false, 'the step goes on');
  assert(goal.smelting.left, 'the batch stays left');
  goal.smelting.left = { at: Date.now() - 30 * 60000, doneAt: Date.now() - 29 * 60000, lapsed: Date.now() - 10 * 60000 };
  bot.entity.position = new Vec3(-200.5, 31, -476.5);
  assert.equal(work.leftBatch(bot, goal), null, 'fetch_batch is not run inside the cast');
  const { options } = await work.upkeepOffers(bot, new Task('upkeep'), goal, () => {});
  assert.equal(options.fetch_batch, undefined);
  assert.equal(options.leave_batch, undefined);
  // The frame done (no frame kept), it is offered.
  delete goal.portalFrame;
  assert(work.leftBatch(bot, goal), 'offered once the cast is over');
});

test('a batch whose furnace cannot be reached from here is left where it is and the step goes on; it is not taken again from about here, and leave_batch says why', async () => {
  const bot = caveBot();
  const goal = { kind: 'win', smelting: batch() };
  const b = goal.smelting;
  // As smelt throws when approachWorkstation finds no face it can reach.
  const err = Object.assign(new Error("I can't reach the furnace holding our saved batch"), { name: 'Blocked' });
  // Through the real smelt: every face of the furnace closed, no route to one.
  bot.openFurnace = async () => { throw err; };
  const went = await work.takeOutBatch(bot, new Task('t'), goal, () => {}).catch(e => e);
  assert.equal(went, false, `the step goes on, not thrown: ${went?.message || went}`);
  assert(b.left?.noRoute, 'left, with where it failed and why');
  assert.match(b.left.noRoute.why, /furnace holding our saved batch/);
  assert.equal(work.localBatch(bot, goal), null, 'not taken again from about here, though 11 blocks from it');
  const { options } = await work.upkeepOffers(bot, new Task('upkeep'), goal, () => {});
  assert.equal(options.fetch_batch, undefined, 'not offered from where it failed');
  assert.match(options.leave_batch.description, /found no route from about here/);
  // From 20 blocks on, the way back is offered again.
  bot.entity.position = new Vec3(-260.5, 38, -460.5);
  assert.equal(work.leftBatch(bot, goal)?.noRoute, null);
});

test('any other failure of the take-out is thrown as before', async () => {
  const bot = caveBot();
  const goal = { kind: 'win', smelting: batch() };
  bot.blockAt = () => { const e = new Error('Cancelled'); e.name = 'Cancelled'; throw e; };
  await assert.rejects(work.takeOutBatch(bot, new Task('t'), goal, () => {}));
});
