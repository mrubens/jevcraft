'use strict';

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { navigate, countOf } = require('./skills');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitCount(bot, task, item, predicate, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { task.check(); if (predicate(countOf(bot, item))) return; await sleep(100); }
  throw new Error('Timed out waiting for handover inventory update');
}

async function dropHeld(bot, task, itemName, count) {
  let remaining = count;
  while (remaining > 0) {
    task.check();
    let stack = bot.inventory.items().find(i => i.name === itemName);
    if (!stack) throw new Error(`No ${itemName} left to hand over`);
    const amount = Math.min(remaining, stack.count);
    if (amount < stack.count) {
      const slot = bot.inventory.firstEmptyInventorySlot();
      if (slot === null) throw new Error('Need an empty inventory slot to split the handover stack');
      await bot.transfer({ window: bot.inventory, itemType: stack.type, metadata: null, count: amount,
        sourceStart: bot.inventory.inventoryStart, sourceEnd: bot.inventory.inventoryEnd, destStart: slot, destEnd: slot + 1 });
      stack = bot.inventory.items().find(i => i.slot === slot);
      if (!stack || stack.count !== amount) throw new Error('Could not prepare the exact handover stack');
    }
    await bot.equip(stack, 'hand');
    if (bot._syncWindow) await bot._syncWindow(bot.inventory);
    if (bot.setQuickBarSlot) bot.setQuickBarSlot(bot.quickBarSlot);
    if (bot.waitForTicks) await bot.waitForTicks(2);
    task.check();
    const before = countOf(bot, itemName);
    // Vanilla DROP_ALL_ITEMS (enum ordinal 3) is Ctrl-Q: a directed hand drop.
    // Mineflayer.toss clicks outside an inventory window and scatters the stack.
    bot._client.write('block_dig', { status: 3, location: new Vec3(0, 0, 0), face: 0, sequence: 0 });
    if (bot.waitForTicks) await bot.waitForTicks(2);
    if (bot._syncWindow) await bot._syncWindow(bot.inventory);
    await waitCount(bot, task, itemName, n => n <= before - amount);
    remaining -= amount;
  }
}

// Do not equate tossing an item with delivery. The receiver must actually
// collect it, and an interrupted handover must not silently duplicate it.
async function deliver(bot, task, goal, save, { timeout = 12000 } = {}) {
  const itemName = 'purple_concrete';
  const remaining = goal.count - (goal.delivered || 0);
  if (remaining <= 0) return true;
  if (goal.pendingDelivery) {
    if (countOf(bot, itemName) < goal.pendingDelivery.inventoryBefore) {
      const dropped = Object.values(bot.entities).find(e => e.position && e.getDroppedItem?.()?.name === itemName &&
        e.position.distanceTo(bot.entity.position) <= 8);
      if (dropped) {
        await navigate(bot, task, new goals.GoalNear(dropped.position.x, dropped.position.y, dropped.position.z, 0));
        await waitCount(bot, task, itemName, n => n >= remaining);
      }
      if (countOf(bot, itemName) < remaining) {
        const err = new Error('Concrete handover was interrupted; receiver pickup is unconfirmed. Check the dropped items before requesting a replacement.');
        err.name = 'Blocked'; throw err;
      }
    }
    delete goal.pendingDelivery;
    save();
  }
  let receiver = bot.players[goal.from]?.entity;
  if (!receiver && goal.requesterPosition) {
    const p = goal.requesterPosition;
    await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2));
    receiver = bot.players[goal.from]?.entity;
  }
  if (!receiver) throw new Error(`Cannot see ${goal.from} to deliver concrete`);
  await navigate(bot, task, new goals.GoalNear(receiver.position.x, receiver.position.y, receiver.position.z, 1));
  task.check();
  receiver = bot.players[goal.from]?.entity;
  if (!receiver || receiver.position.distanceTo(bot.entity.position) > 3) throw new Error('Requester moved out of handover range');
  await bot.lookAt(receiver.position.plus(new Vec3(0, 0.5, 0)), true);
  const knownEntities = new Set(Object.keys(bot.entities).map(Number));
  const before = countOf(bot, itemName);
  if (before < remaining) throw new Error(`Need ${remaining} concrete for delivery, carrying ${before}`);
  goal.pendingDelivery = { inventoryBefore: before, count: remaining, at: new Date().toISOString() };
  save();
  const onCollect = packet => {
    if (packet.collectorEntityId !== receiver.id || knownEntities.has(packet.collectedEntityId)) return;
    const entity = bot.entities[packet.collectedEntityId];
    if (entity?.getDroppedItem?.()?.name !== itemName) return;
    const amount = Math.min(packet.pickupItemCount, goal.count - (goal.delivered || 0));
    if (!Number.isInteger(amount) || amount <= 0) return;
    goal.delivered = (goal.delivered || 0) + amount;
    goal.deliveryEvidence ||= [];
    goal.deliveryEvidence.push({ recipient: goal.from, entity: packet.collectedEntityId, count: amount, at: new Date().toISOString() });
    if (goal.delivered >= goal.count) delete goal.pendingDelivery;
    save();
  };
  bot._client.on('collect', onCollect);
  try {
    await dropHeld(bot, task, itemName, remaining);
    const end = Date.now() + timeout;
    while ((goal.delivered || 0) < goal.count && Date.now() < end) {
      task.check();
      await new Promise(r => setTimeout(r, 100));
    }
    if ((goal.delivered || 0) < goal.count) {
      const err = new Error(`Dropped concrete for ${goal.from}, but pickup of all ${remaining} blocks was not confirmed`);
      err.name = 'Blocked'; throw err;
    }
    return true;
  } finally { bot._client.removeListener('collect', onCollect); }
}
module.exports = { deliver, dropHeld };
