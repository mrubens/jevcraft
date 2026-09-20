'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { depositInChest, reconcileChestDeposit, deliverToChest } = require('../src/chest-delivery');
const { completion } = require('../src/speech');
const { bundleStep } = require('../src/item-bundle');

function setup({ carried = 17, stored = 5, full = false, partial = false } = {}) {
  const inventory = [{ name: 'cobblestone', count: carried, type: 4, stackSize: 64 }];
  const contents = [{ name: 'cobblestone', count: stored, type: 4 }, { name: 'diamond', count: 3, type: 5 }];
  let deposits = 0, closed = 0;
  const window = { inventoryStart: 27, slots: Array(27).fill(full ? { name: 'stone', count: 64 } : null),
    items: () => inventory, containerItems: () => contents, close: () => closed++,
    deposit: async (type, metadata, count) => { deposits++; assert.equal(type, 4); const n = partial ? 2 : count;
      inventory[0].count -= n; contents[0].count += n; if (partial) throw new Error('connection lost'); } };
  const chat = [], bot = { openContainer: async () => window, game: { dimension: 'overworld' }, chat: text => chat.push(text) };
  const goal = { kind: 'obtain', deliver: true, item: 'cobblestone', count: 16, from: 'Player' }, block = { position: new Vec3(10, 64, 12) };
  return { bot, window, goal, block, inventory, contents, chat, stats: () => ({ deposits, closed }) };
}

test('a chest deposit verifies both inventories, preserves existing contents, and records its method', async () => {
  const s = setup(), checkpoints = [];
  assert(await depositInChest(s.bot, new Task('give'), s.goal, () => checkpoints.push(structuredClone(s.goal)), s.block, 16));
  assert(checkpoints.some(g => g.pendingChestDelivery?.inventoryBefore === 17 && g.pendingChestDelivery.containerBefore === 5));
  assert.equal(s.inventory[0].count, 1); assert.equal(s.contents[0].count, 21); assert.equal(s.contents[1].count, 3);
  assert.equal(s.goal.delivered, 16); assert(!s.goal.pendingChestDelivery);
  assert.equal(s.goal.deliveryEvidence[0].method, 'chest'); assert.equal(s.goal.deliveryEvidence[0].recipient, 'Player');
  assert.match(s.chat[0], /16 cobblestone.*10, 64, 12/); assert.match(completion(s.goal), /chest at 10, 64, 12/);
  assert.doesNotMatch(completion(s.goal), /You got|You have/); assert.deepEqual(s.stats(), { deposits: 1, closed: 1 });
  assert(await depositInChest(s.bot, new Task('resume'), structuredClone(s.goal), () => {}, s.block, 16));
  assert.equal(s.stats().deposits, 1, 'A completed delivery never deposits twice');
});

test('a full chest neither moves its contents nor creates a pending transaction', async () => {
  const s = setup({ full: true });
  assert.equal(await depositInChest(s.bot, new Task('give'), s.goal, () => {}, s.block, 16), false);
  assert.equal(s.stats().deposits, 0); assert(!s.goal.pendingChestDelivery); assert.equal(s.inventory[0].count, 17);
});

test('partial transfer followed by disconnect is reconciled before depositing only the remainder', async () => {
  const s = setup({ partial: true });
  await assert.rejects(depositInChest(s.bot, new Task('give'), s.goal, () => {}, s.block, 16), /connection lost/);
  assert(s.goal.pendingChestDelivery); assert(!s.goal.delivered);
  assert.equal(reconcileChestDeposit(s.goal, s.window, () => {}), 2);
  assert.equal(s.goal.delivered, 2); assert(!s.goal.pendingChestDelivery);
  let nextCount;
  s.window.deposit = async (type, metadata, count) => { nextCount = count; s.inventory[0].count -= count; s.contents[0].count += count; };
  assert(await depositInChest(s.bot, new Task('resume'), s.goal, () => {}, s.block, 16));
  assert.equal(nextCount, 14); assert.equal(s.goal.delivered, 16);
});

test('ambiguous chest contents after restart never authorize a replacement', () => {
  for (const [stored, carried] of [[5, 1], [21, 17], [22, 1], [4, 17]]) {
    const s = setup({ stored, carried });
    s.goal.pendingChestDelivery = { item: 'cobblestone', position: s.block.position, inventoryBefore: 17, containerBefore: 5, deliveredBefore: 0, count: 16 };
    assert.throws(() => reconcileChestDeposit(s.goal, s.window, () => {}), /unconfirmed/);
    assert(s.goal.pendingChestDelivery); assert(!s.goal.delivered);
  }
});

test('a chest transfer interrupted before moving anything can safely be retried', () => {
  const s = setup();
  s.goal.pendingChestDelivery = { item: 'cobblestone', position: s.block.position, inventoryBefore: 17, containerBefore: 5, deliveredBefore: 0, count: 16 };
  assert.equal(reconcileChestDeposit(s.goal, s.window, () => {}), 0); assert(!s.goal.pendingChestDelivery); assert(!s.goal.delivered);
});

test('stop before deposit preserves a checkpoint without moving items', async () => {
  const s = setup(), task = new Task('give');
  await assert.rejects(depositInChest(s.bot, task, s.goal, () => task.cancel(), s.block, 16), { name: 'Cancelled' });
  assert.equal(s.stats().deposits, 0); assert.equal(s.stats().closed, 1); assert(s.goal.pendingChestDelivery);
});

test('chest preparation continues gathering reserved supplies before returning to the player', async () => {
  const bot = { inventory: { items: () => [{ name: 'oak_planks', count: 16 }] }, players: {}, game: { dimension: 'overworld' } };
  const goal = { item: 'oak_planks', count: 16, from: 'Player', deliveryChestPreparation: { reserved: { oak_planks: 16, diamond: 24 } } };
  let calls = 0;
  assert.equal(await deliverToChest(bot, new Task('give'), goal, () => {}, { acquireStep: async (b, t, item, count, g, save, options) => {
    calls++; assert.equal(item, 'chest'); assert.equal(count, 1); assert.deepEqual(options.reserved, goal.deliveryChestPreparation.reserved);
  } }), false);
  assert.equal(calls, 1, 'Do not try to return on every ingredient step');
});

test('confirmed deposits are saved even when cancellation arrives during the transfer', async () => {
  const s = setup(), task = new Task('give'), deposit = s.window.deposit;
  s.window.deposit = async (...args) => { await deposit(...args); task.cancel(); };
  await assert.rejects(depositInChest(s.bot, task, s.goal, () => {}, s.block, 16), { name: 'Cancelled' });
  assert.equal(s.goal.delivered, 16); assert(!s.goal.pendingChestDelivery); assert.equal(s.stats().closed, 1);
});

test('bundle reconciles a pending chest before gathering and protects every requested output', async () => {
  const goal = { from: 'Player', tasks: [
    { item: 'oak_planks', count: 16, deliver: true, pendingChestDelivery: { count: 16 } },
    { item: 'diamond', count: 24, deliver: true }, { item: 'oak_planks', count: 4, deliver: false },
  ] };
  await bundleStep({ inventory: { items: () => [] } }, new Task('give'), goal, () => {}, async child => {
    assert.deepEqual(child.deliveryReservations, { oak_planks: 20, diamond: 24 }); return false;
  }, { prepare: () => assert.fail('Do not gather before reconciling') });
});

test('mixed direct and chest delivery completion points to storage without claiming player pickup', () => {
  const goal = { kind: 'bundle', tasks: [{ deliver: true, item: 'diamond', count: 1, delivered: 1 },
    { deliver: true, item: 'white_bed', count: 1, delivered: 1, deliveryEvidence: [{ method: 'chest', position: { x: 1, y: 64, z: 2 } }] }] };
  assert.match(completion(goal), /chest at 1, 64, 2/); assert.doesNotMatch(completion(goal), /You have the whole list/);
});
