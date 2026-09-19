'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const { deliver, dropHeld, safeHandoverPosition } = require('../src/delivery');
const { Task } = require('../src/skills');

function setup(collector = 7, pickup = 32) {
  const client = new EventEmitter();
  let count = 32;
  const bot = {
    players: { Player: { entity: { id: 7, position: new Vec3(1, 64, 0) } } },
    entity: { position: new Vec3(0, 64, 0) }, entities: {},
    pathfinder: { goto: async () => {}, setGoal: () => {} },
    inventory: { items: () => count ? [{ name: 'purple_concrete', count }] : [] },
    lookAt: async () => {}, equip: async () => {}, _client: client,
    registry: { itemsByName: { purple_concrete: { id: 1 } } },
    toss: async () => {
      count = 0;
      bot.entities[10] = { getDroppedItem: () => ({ name: 'purple_concrete', count: 32 }) };
      client.emit('collect', { collectedEntityId: 10, collectorEntityId: collector, pickupItemCount: pickup });
    },
  };
  client.write = () => bot.toss();
  return { bot, goal: { count: 32, from: 'Player' }, task: new Task('deliver', 'test') };
}
test('delivery requires receiver pickup and records exact quantity', async () => {
  const { bot, goal, task } = setup();
  assert(await deliver(bot, task, goal, () => {}, { timeout: 0 }));
  assert.equal(goal.delivered, 32);
  assert.equal(goal.pendingDelivery, undefined);
  assert.equal(goal.deliveryEvidence[0].recipient, 'Player');
  assert.equal(bot._client.listenerCount('collect'), 0);
});
test('self-pickup or another player pickup does not satisfy delivery', async () => {
  const { bot, goal, task } = setup(99);
  await assert.rejects(deliver(bot, task, goal, () => {}, { timeout: 0 }), { name: 'Blocked' });
  assert(!goal.delivered);
  assert(goal.pendingDelivery);
  assert.equal(bot._client.listenerCount('collect'), 0);
});
test('partial pickup is preserved and uncertain delivery is not silently repeated', async () => {
  const { bot, goal, task } = setup(7, 12);
  await assert.rejects(deliver(bot, task, goal, () => {}, { timeout: 0 }), { name: 'Blocked' });
  assert.equal(goal.delivered, 12);
  let tossedAgain = false;
  bot.toss = async () => { tossedAgain = true; };
  await assert.rejects(deliver(bot, task, goal, () => {}, { timeout: 0 }), /interrupted/);
  assert(!tossedAgain);
});

test('spare inventory never excuses an unconfirmed throw after reconnect', async () => {
  const { bot, goal, task } = setup();
  goal.count = 1; goal.item = 'purple_concrete';
  goal.pendingDelivery = { inventoryBefore: 33, deliveredBefore: 0, count: 1 };
  let writes = 0; bot._client.write = () => { writes++; };
  // Still carrying 32 is more than the requested one, but one was lost from
  // the saved 33. Replaying would give the player two if the first was picked up.
  await assert.rejects(deliver(bot, task, goal, () => {}, { timeout: 0 }), /interrupted/);
  assert.equal(writes, 0); assert(goal.pendingDelivery);
});

test('confirmed partial handover subtracts only that pickup from the inventory baseline', async () => {
  const { bot, goal, task } = setup();
  goal.count = 44; goal.delivered = 12;
  goal.pendingDelivery = { inventoryBefore: 44, deliveredBefore: 0, count: 44 };
  assert(await deliver(bot, task, goal, () => {}, { timeout: 0 }));
  assert.equal(goal.delivered, 44); assert.equal(goal.pendingDelivery, undefined);
});

test('earlier completed handovers do not hide a new uncertain throw', async () => {
  const { bot, goal, task } = setup();
  goal.count = 44; goal.delivered = 12;
  goal.pendingDelivery = { inventoryBefore: 33, deliveredBefore: 12, count: 32 };
  let writes = 0; bot._client.write = () => { writes++; };
  await assert.rejects(deliver(bot, task, goal, () => {}, { timeout: 0 }), /interrupted/);
  assert.equal(writes, 0); assert.equal(goal.delivered, 12);
});

test('finishing a carrying batch records delivery without completing the whole request', async () => {
  const { bot, goal, task } = setup();
  goal.count = 96; goal.deliveryTarget = 32;
  assert.equal(await deliver(bot, task, goal, () => {}, { timeout: 0 }), false);
  assert.equal(goal.delivered, 32); assert.equal(goal.count, 96); assert(!goal.pendingDelivery);
});

test('splitting a handover stack excludes its destination from the cursor return range', async () => {
  let items = [{ name: 'pumpkin', type: 1, count: 17, slot: 36 }];
  const bot = {
    inventory: { items: () => items, firstEmptyInventorySlot: () => 9, inventoryStart: 9, inventoryEnd: 45 },
    transfer: async options => {
      assert.equal(options.sourceStart, 36);
      assert.equal(options.sourceEnd, 37);
      assert(options.destStart < options.sourceStart || options.destStart >= options.sourceEnd);
      items = [{ name: 'pumpkin', type: 1, count: 16, slot: 36 }, { name: 'pumpkin', type: 1, count: 1, slot: 9 }];
    },
    equip: async item => { assert.equal(item.count, 1); },
    _client: { write: () => { items = items.filter(i => i.slot !== 9); } },
  };
  await dropHeld(bot, new Task('test', 'hand over one pumpkin'), 'pumpkin', 1);
  assert.equal(items[0].count, 16);
});

test('handover accepts a single supported row at two blocks distance, including a player near its edge', () => {
  const bot = { blockAt: p => ({ name: p.y === 63 && p.z === 0 ? 'stone' : 'air',
    boundingBox: p.y === 63 && p.z === 0 ? 'block' : 'empty' }) };
  for (const z of [0.5, 0.21, 0.79]) {
    assert(safeHandoverPosition(bot, new Vec3(0.5, 64, 0.5), { position: new Vec3(2.5, 64, z) }));
  }
  assert(!safeHandoverPosition(bot, new Vec3(0.5, 64, 0.5), { position: new Vec3(2.5, 65, 0.5) }));
  const blockAt = bot.blockAt;
  bot.blockAt = p => p.x === 1 && p.y === 63 ? { name: 'air', boundingBox: 'empty' } : blockAt(p);
  assert(!safeHandoverPosition(bot, new Vec3(0.5, 64, 0.5), { position: new Vec3(2.5, 64, 0.5) }), 'Do not throw across an unsupported gap');
});

test('each separate stack is rechecked before dropping when the recipient moves', async () => {
  const stacks = [1, 2, 3].map(slot => ({ name: 'stone_axe', count: 1, slot }));
  let held, checks = 0, writes = 0;
  const bot = { inventory: { items: () => stacks }, equip: async item => { held = item; },
    _client: { write: () => { writes++; stacks.splice(stacks.indexOf(held), 1); } } };
  await assert.rejects(dropHeld(bot, new Task('test', 'axes'), 'stone_axe', 3, async () => {
    if (++checks === 2) throw new Error('Requester moved');
  }), /Requester moved/);
  assert.equal(writes, 1);
  assert.equal(stacks.length, 2);
});

function fullInventory() {
  const items = [{ name: 'pumpkin', type: 1, count: 17, slot: 36 },
    ...Array.from({ length: 35 }, (_, i) => ({ name: 'stone_axe', type: 2, count: 1, slot: i < 27 ? i + 9 : i + 10 }))];
  let held;
  const packets = [];
  const bot = { inventory: { items: () => items, firstEmptyInventorySlot: () => null },
    equip: async item => { held = item; }, transfer: async () => assert.fail('no room for a temporary stack'),
    _client: { write: (name, packet) => {
      assert.equal(name, 'block_dig'); packets.push(packet);
      assert.equal(held.name, 'pumpkin');
      held.count -= packet.status === 4 ? 1 : held.count;
    } } };
  return { bot, items, packets };
}

test('a full inventory can hand over an exact partial stack without discarding other items', async () => {
  const { bot, items, packets } = fullInventory(), task = new Task('give five pumpkins');
  let checks = 0;
  await dropHeld(bot, task, 'pumpkin', 5, async () => { checks++; });
  assert.equal(items[0].count, 12);
  assert(items.slice(1).every(i => i.count === 1));
  assert.equal(packets.length, 5); assert(packets.every(p => p.status === 4));
  assert.equal(checks, 5, 'recheck the recipient before every single-item drop');
});

test('stop or a moving recipient interrupts a full-inventory handover before the next drop', async () => {
  for (const reason of ['stop', 'moved']) {
    const { bot, items, packets } = fullInventory(), task = new Task('give five pumpkins');
    let checks = 0;
    await assert.rejects(dropHeld(bot, task, 'pumpkin', 5, async () => {
      if (++checks < 2) return;
      if (reason === 'stop') task.cancel(); else throw new Error('Requester moved');
    }), reason === 'stop' ? { name: 'Cancelled' } : /Requester moved/);
    assert.equal(packets.length, 1); assert.equal(items[0].count, 16);
  }
});
