'use strict';

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { navigate, countOf } = require('./skills');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function approachForHandover(bot, task, receiver) {
  if (!bot.blockAt) return navigate(bot, task, new goals.GoalNear(receiver.position.x, receiver.position.y, receiver.position.z, 1));
  const origin = receiver.position.floored();
  const candidates = [];
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (const y of [0, -1, 1]) {
    const p = origin.offset(x, y, z);
    const center = p.offset(0.5, 0, 0.5);
    const distance = center.distanceTo(receiver.position);
    if (distance < 2.2 || distance > 3 || Math.abs(center.y - receiver.position.y) > 0.6) continue;
    if (bot.blockAt(p)?.boundingBox !== 'empty' || bot.blockAt(p.offset(0, 1, 0))?.boundingBox !== 'empty' ||
        bot.blockAt(p.offset(0, -1, 0))?.boundingBox !== 'block') continue;
    if (['water', 'lava'].includes(bot.blockAt(p)?.name)) continue;
    candidates.push(p);
  }
  candidates.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
  const target = candidates.find(p => bot.pathfinder.getPathTo(bot.pathfinder.movements, new goals.GoalBlock(p.x, p.y, p.z), 200).status === 'success');
  if (!target) throw new Error('Need clear standing room beside the requester to hand over items');
  await navigate(bot, task, new goals.GoalBlock(target.x, target.y, target.z));
}
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
      // The destination must not be inside the source range: transfer returns
      // its cursor remainder to that range and would merge our split back in.
      await bot.transfer({ window: bot.inventory, itemType: stack.type, metadata: null, count: amount,
        sourceStart: stack.slot, sourceEnd: stack.slot + 1, destStart: slot, destEnd: slot + 1 });
      if (bot._syncWindow) await bot._syncWindow(bot.inventory);
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
  const itemName = goal.item || 'purple_concrete';
  const label = itemName.replaceAll('_', ' ');
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
        const err = new Error(`${label} handover was interrupted; receiver pickup is unconfirmed. Check the dropped items before requesting a replacement.`);
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
  if (!receiver) throw new Error(`Cannot see ${goal.from} to deliver ${label}`);
  await approachForHandover(bot, task, receiver);
  task.check();
  receiver = bot.players[goal.from]?.entity;
  if (!receiver || receiver.position.distanceTo(bot.entity.position) > 3) throw new Error('Requester moved out of handover range');
  await bot.lookAt(receiver.position.plus(new Vec3(0, 1.2, 0)), true);
  const knownEntities = new Set(Object.keys(bot.entities).map(Number));
  const before = countOf(bot, itemName);
  if (before < remaining) throw new Error(`Need ${remaining} ${label} for delivery, carrying ${before}`);
  goal.pendingDelivery = { inventoryBefore: before, count: remaining, at: new Date().toISOString() };
  save();
  const onCollect = packet => {
    bot.emit?.('handover', { event: 'pickup', packet, item: bot.entities[packet.collectedEntityId]?.getDroppedItem?.()?.name, recipientId: receiver.id });
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
  const onDrop = entity => {
    if (entity.getDroppedItem?.()?.name === itemName) bot.emit?.('handover', { event: 'drop', entityId: entity.id, position: { ...entity.position } });
  };
  bot.on?.('entityUpdate', onDrop);
  try {
    bot.emit?.('handover', { event: 'start', position: { ...bot.entity.position }, recipient: { ...receiver.position }, yaw: bot.entity.yaw, pitch: bot.entity.pitch, count: remaining });
    await dropHeld(bot, task, itemName, remaining);
    const end = Date.now() + timeout;
    while ((goal.delivered || 0) < goal.count && Date.now() < end) {
      task.check();
      await new Promise(r => setTimeout(r, 100));
    }
    if ((goal.delivered || 0) < goal.count) {
      const err = new Error(`Dropped ${label} for ${goal.from}, but pickup of all ${remaining} items was not confirmed`);
      err.name = 'Blocked'; throw err;
    }
    return true;
  } finally { bot._client.removeListener('collect', onCollect); bot.removeListener?.('entityUpdate', onDrop); }
}
module.exports = { deliver, dropHeld };
