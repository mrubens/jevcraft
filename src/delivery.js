'use strict';

const { goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const { navigate, surveyRoute, countOf } = require('./skills');
const { dryBodySpace, dryPassable, damagingTerrain } = require('./terrain');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function handoverAim(bot, receiver, from = bot.entity?.position) {
  const feet = receiver.position.floored();
  // Aim down toward the center of supported ground beneath the recipient.
  // A chest-height throw can overshoot a close player on a narrow ledge.
  // Across an upward step, lift the aim enough to clear its edge. Aiming at
  // those feet sent the item into the riser before the player could collect it.
  const height = from && receiver.position.y - from.y > .6 ? .65 : .2;
  return bot.blockAt?.(feet.offset(0, -1, 0))?.boundingBox === 'block'
    ? feet.offset(0.5, height, 0.5) : receiver.position.offset(0, height, 0);
}

function safeHandoverPosition(bot, point, receiver) {
  const distance = point.distanceTo(receiver.position);
  if (distance < 1.7 || distance > 2.8 || Math.abs(point.y - receiver.position.y) > 1.01) return false;
  const aim = handoverAim(bot, receiver, point);
  const feet = point.floored();
  const receiverFeet = receiver.position.floored();
  const supported = p => {
    const block = bot.blockAt(p);
    return block?.boundingBox === 'block' && !damagingTerrain.has(block.name);
  };
  if (!dryBodySpace(bot, point) || !dryBodySpace(bot, receiver.position) ||
      !supported(feet.offset(0, -1, 0)) || !supported(receiverFeet.offset(0, -1, 0))) return false;
  // Check the whole drop corridor, not a wide area beside the player. A
  // single supported row or a one-block step is sufficient. Each crossed
  // column needs dry support within the two players' floor heights; a cliff
  // below that band cannot masquerade as a safe downhill handover.
  const samples = Math.ceil(point.distanceTo(aim) * 4);
  for (let i = 0; i <= samples; i++) {
    const p = point.plus(aim.minus(point).scaled(i / samples)).floored();
    let ground = false;
    for (let y = Math.min(feet.y, receiverFeet.y) - 1; y <= Math.max(feet.y, receiverFeet.y) - 1; y++) {
      p.y = y;
      if (supported(p) && dryPassable(bot.blockAt(p.offset(0, 1, 0)))) { ground = true; break; }
    }
    if (!ground) return false;
  }
  const eye = point.offset(0, 1.32, 0), direction = aim.minus(eye);
  const hit = bot.world?.raycast?.(eye, direction.unit(), direction.norm());
  return !hit || eye.distanceTo(hit.intersect || hit.position) >= direction.norm() - 0.25;
}

async function approachForHandover(bot, task, receiver) {
  if (!bot.blockAt) return navigate(bot, task, new goals.GoalNear(receiver.position.x, receiver.position.y, receiver.position.z, 1));
  if (safeHandoverPosition(bot, bot.entity.position, receiver)) return;
  const origin = receiver.position.floored();
  const candidates = [];
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (const y of [0, -1, 1]) {
    const p = origin.offset(x, y, z);
    const center = p.offset(0.5, 0, 0.5);
    if (!safeHandoverPosition(bot, center, receiver)) continue;
    candidates.push(p);
  }
  candidates.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
  for (const target of candidates.slice(0, 12)) {
    const destination = new goals.GoalBlock(target.x, target.y, target.z);
    if ((await surveyRoute(bot, task, bot.pathfinder.movements, destination, 400)).status !== 'success') continue;
    await navigate(bot, task, destination);
    return;
  }
  throw Object.assign(new Error('Cannot reach a supported handover spot with a clear drop path to you'), { code: 'HANDOVER_SPACE' });
}
async function waitCount(bot, task, item, predicate, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { task.check(); if (predicate(countOf(bot, item))) return; await sleep(100); }
  throw new Error('Timed out waiting for handover inventory update');
}

async function dropHeld(bot, task, itemName, count, beforeDrop = async () => {}) {
  let remaining = count;
  while (remaining > 0) {
    task.check();
    let stack = bot.inventory.items().find(i => i.name === itemName);
    if (!stack) throw new Error(`No ${itemName} left to hand over`);
    let amount = Math.min(remaining, stack.count), single = false;
    if (amount < stack.count) {
      const slot = bot.inventory.firstEmptyInventorySlot();
      if (slot == null) {
        // A full inventory can still use ordinary Q to hand over one item.
        // Keep the rest of the stack in hand and recheck aim/cancellation and
        // server inventory before each next drop. Never discard spare stock.
        amount = 1; single = true;
      } else {
        // The destination must not be inside the source range: transfer returns
        // its cursor remainder to that range and would merge our split back in.
        await bot.transfer({ window: bot.inventory, itemType: stack.type, metadata: null, count: amount,
          sourceStart: stack.slot, sourceEnd: stack.slot + 1, destStart: slot, destEnd: slot + 1 });
        if (bot._syncWindow) await bot._syncWindow(bot.inventory);
        stack = bot.inventory.items().find(i => i.slot === slot);
        if (!stack || stack.count !== amount) throw new Error('Could not prepare the exact handover stack');
      }
    }
    await bot.equip(stack, 'hand');
    if (bot._syncWindow) await bot._syncWindow(bot.inventory);
    if (bot.setQuickBarSlot) bot.setQuickBarSlot(bot.quickBarSlot);
    if (bot.waitForTicks) await bot.waitForTicks(2);
    task.check();
    await beforeDrop();
    task.check();
    const before = countOf(bot, itemName);
    // Vanilla DROP_ALL_ITEMS (3) is Ctrl-Q; DROP_ITEM (4) is ordinary Q.
    // Mineflayer.toss clicks outside an inventory window and scatters the stack.
    bot._client.write('block_dig', { status: single ? 4 : 3, location: new Vec3(0, 0, 0), face: 0, sequence: 0 });
    if (bot.waitForTicks) await bot.waitForTicks(2);
    if (bot._syncWindow) await bot._syncWindow(bot.inventory);
    await waitCount(bot, task, itemName, n => n <= before - amount);
    remaining -= amount;
  }
}

// Do not equate tossing an item with delivery. The receiver must actually
// collect it, and an interrupted handover must not silently duplicate it.
async function deliver(bot, task, goal, save, { timeout = 12000 } = {}) {
  const movement = bot.pathfinder.movements, previous = movement?.scafoldingBlocks;
  const item = bot.registry?.itemsByName?.[goal.item || 'purple_concrete']?.id;
  // Navigation must not build its return route out of the requested delivery.
  if (previous && item !== undefined) movement.scafoldingBlocks = previous.filter(id => id !== item);
  try {
    if (goal.deliveryMode === 'chest' || goal.pendingChestDelivery)
      return await require('./chest-delivery').deliverToChest(bot, task, goal, save);
    try { return await deliverItems(bot, task, goal, save, { timeout }); }
    catch (error) {
      task.check();
      if (error.code !== 'HANDOVER_SPACE') throw error;
      goal.deliveryMode = 'chest'; save();
      bot.chat?.("It's hard to hand you things here. I'll put them in a chest nearby.");
      return await require('./chest-delivery').deliverToChest(bot, task, goal, save);
    }
  }
  finally { if (movement) movement.scafoldingBlocks = previous; }
}

async function deliverItems(bot, task, goal, save, { timeout }) {
  const itemName = goal.item || 'purple_concrete';
  const label = itemName.replaceAll('_', ' ');
  const target = Math.min(goal.count, goal.pendingDelivery?.target ?? goal.deliveryTarget ?? goal.count);
  const remaining = target - (goal.delivered || 0);
  if (remaining <= 0) return (goal.delivered || 0) >= goal.count;
  if (goal.pendingDelivery) {
    // Extra carried stock cannot prove the previous throw was recovered. Only
    // confirmed recipient pickups may reduce the pre-throw inventory baseline.
    // Older checkpoints lack deliveredBefore: reconcile conservatively.
    const baseline = goal.pendingDelivery.deliveredBefore ?? (goal.delivered || 0);
    const confirmed = Math.max(0, (goal.delivered || 0) - baseline);
    const expected = goal.pendingDelivery.inventoryBefore - confirmed;
    if (countOf(bot, itemName) < expected) {
      const dropped = Object.values(bot.entities).find(e => e.position && e.getDroppedItem?.()?.name === itemName &&
        e.position.distanceTo(bot.entity.position) <= 8);
      if (dropped) {
        await navigate(bot, task, new goals.GoalNear(dropped.position.x, dropped.position.y, dropped.position.z, 0));
        await waitCount(bot, task, itemName, n => n >= expected);
      }
      if (countOf(bot, itemName) < expected) {
        const err = new Error(`${label} handover was interrupted; receiver pickup is unconfirmed. Check the dropped items before requesting a replacement.`);
        err.name = 'Blocked'; throw err;
      }
    }
    delete goal.pendingDelivery;
    save();
  }
  let receiver = await approachReceiver(bot, task, goal);
  if (!receiver) return false;
  await approachForHandover(bot, task, receiver);
  task.check();
  receiver = bot.players[goal.from]?.entity;
  if (!receiver || receiver.position.distanceTo(bot.entity.position) > 3) throw new Error('Requester moved out of handover range');
  const aimDrop = async () => {
    const current = bot.players[goal.from]?.entity;
    if (!current || current.position.distanceTo(bot.entity.position) > 3 ||
        (bot.blockAt && !safeHandoverPosition(bot, bot.entity.position, current))) throw new Error('Requester moved away from the safe handover spot');
    receiver = current;
    await bot.lookAt(handoverAim(bot, receiver), true);
  };
  await aimDrop();
  const knownEntities = new Set(Object.keys(bot.entities).map(Number));
  const before = countOf(bot, itemName);
  if (before < remaining) throw new Error(`Need ${remaining} ${label} for delivery, carrying ${before}`);
  goal.pendingDelivery = { inventoryBefore: before, deliveredBefore: goal.delivered || 0, count: remaining, target, at: new Date().toISOString() };
  save();
  const onCollect = packet => {
    bot.emit?.('handover', { event: 'pickup', packet, item: bot.entities[packet.collectedEntityId]?.getDroppedItem?.()?.name, recipientId: receiver.id });
    if (packet.collectorEntityId !== receiver.id || knownEntities.has(packet.collectedEntityId)) return;
    const entity = bot.entities[packet.collectedEntityId];
    if (entity?.getDroppedItem?.()?.name !== itemName) return;
    const amount = Math.min(packet.pickupItemCount, target - (goal.delivered || 0));
    if (!Number.isInteger(amount) || amount <= 0) return;
    goal.delivered = (goal.delivered || 0) + amount;
    goal.deliveryEvidence ||= [];
    goal.deliveryEvidence.push({ recipient: goal.from, entity: packet.collectedEntityId, count: amount, at: new Date().toISOString() });
    if (goal.delivered >= target) delete goal.pendingDelivery;
    save();
  };
  bot._client.on('collect', onCollect);
  const onDrop = entity => {
    if (entity.getDroppedItem?.()?.name === itemName) bot.emit?.('handover', { event: 'drop', entityId: entity.id, position: { ...entity.position } });
  };
  bot.on?.('entityUpdate', onDrop);
  try {
    bot.emit?.('handover', { event: 'start', position: { ...bot.entity.position }, recipient: { ...receiver.position }, yaw: bot.entity.yaw, pitch: bot.entity.pitch, count: remaining });
    await dropHeld(bot, task, itemName, remaining, aimDrop);
    const end = Date.now() + timeout;
    while ((goal.delivered || 0) < target && Date.now() < end) {
      task.check();
      await new Promise(r => setTimeout(r, 100));
    }
    if ((goal.delivered || 0) < target) {
      // Only switch methods after all unconfirmed items are back in our own
      // inventory. A lost or unobserved pickup must never create a replacement.
      const confirmed = (goal.delivered || 0) - (goal.pendingDelivery?.deliveredBefore || 0);
      if (countOf(bot, itemName) >= before - confirmed) {
        delete goal.pendingDelivery; save();
        throw Object.assign(new Error('Recovered the throw; use a chest for the remaining items'), { code: 'HANDOVER_SPACE' });
      }
      const err = new Error(`Dropped ${label} for ${goal.from}, but pickup of all ${remaining} items was not confirmed`);
      err.name = 'Blocked'; throw err;
    }
    return (goal.delivered || 0) >= goal.count;
  } finally { bot._client.removeListener('collect', onCollect); bot.removeListener?.('entityUpdate', onDrop); }
}

async function approachReceiver(bot, task, goal) {
  let receiver = bot.players[goal.from]?.entity;
  if (!receiver && goal.requesterPosition) {
    const p = goal.requesterPosition;
    await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2));
    receiver = bot.players[goal.from]?.entity;
  }
  if (!receiver) throw new Error(`Cannot see ${goal.from} to deliver the items`);
  // Returning from a mine is a trip, not a local drop-position survey. A
  // visible player can be far above us, and the final corridor may only become
  // available after approaching through terrain or loading nearby chunks.
  if (bot.entity.position.distanceTo(receiver.position) > 6) {
    const target = receiver.position.clone();
    await navigate(bot, task, new goals.GoalNear(target.x, target.y, target.z, 3), {
      stopWhen: () => {
        const current = bot.players[goal.from]?.entity;
        return !current || current.position.distanceTo(target) > 4;
      },
    });
    task.check();
    receiver = bot.players[goal.from]?.entity;
    if (!receiver) throw new Error(`Cannot see ${goal.from} to deliver the items`);
    if (bot.entity.position.distanceTo(receiver.position) > 6) return false;
  }
  return receiver;
}
module.exports = { deliver, dropHeld, safeHandoverPosition, approachReceiver };
