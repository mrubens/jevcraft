'use strict';
const { Vec3 } = require('vec3');
const { countOf } = require('./skills');
const { approachWorkstation } = require('./workstation-access');
const { ConstructionGoal, chooseConstructionWork, approachConstruction } = require('./construction-access');
const { dryPassable, damagingTerrain } = require('./terrain');
const vec = p => new Vec3(p.x, p.y, p.z);
const blocked = message => Object.assign(new Error(message), { name: 'Blocked' });
const containerCount = (window, item) => window.containerItems().filter(i => i.name === item).reduce((n, i) => n + i.count, 0);
const carriedCount = (window, item) => window.items().filter(i => i.name === item).reduce((n, i) => n + i.count, 0);
const air = block => block && ['air', 'cave_air', 'void_air'].includes(block.name);

function chestSites(bot, receiver) {
  const origin = receiver.position.floored(), sites = [];
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (const y of [0, -1, 1]) {
    const p = origin.offset(x, y, z), floor = bot.blockAt(p.offset(0, -1, 0));
    if (!air(bot.blockAt(p)) || !air(bot.blockAt(p.offset(0, 1, 0))) || floor?.boundingBox !== 'block' || damagingTerrain.has(floor.name)) continue;
    // Keep the lid clear, avoid merging into an existing chest, and never
    // replace a player's body space or the block directly under their feet.
    if ([bot.entity, ...Object.values(bot.entities)].some(e => e.position && e.name !== 'item' &&
      e.position.x + .3 > p.x && e.position.x - .3 < p.x + 1 &&
      e.position.z + .3 > p.z && e.position.z - .3 < p.z + 1 &&
      e.position.y + (e.height || 1.8) > p.y && e.position.y - .1 < p.y + 1)) continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => /chest$/.test(bot.blockAt(p.offset(dx, 0, dz))?.name))) continue;
    if (p.offset(.5, .5, .5).distanceTo(receiver.position) > 4) continue;
    const eye = receiver.position.offset(0, 1.62, 0), ray = p.offset(.5, .5, .5).minus(eye);
    if (bot.world.raycast(eye, ray.unit(), ray.norm())) continue;
    sites.push(p);
  }
  return sites.sort((a, b) => a.distanceTo(receiver.position) - b.distanceTo(receiver.position));
}

// A deposit checkpoint precedes the inventory transaction. Both sides must
// agree before we count it, including after a disconnect or a partial transfer.
function reconcileChestDeposit(goal, window, save) {
  const pending = goal.pendingChestDelivery;
  if (!pending) return 0;
  const added = containerCount(window, pending.item) - pending.containerBefore;
  const removed = pending.inventoryBefore - carriedCount(window, pending.item);
  if (added === 0 && removed === 0) { delete goal.pendingChestDelivery; save(); return 0; }
  if (!Number.isInteger(added) || added <= 0 || added > pending.count || removed !== added ||
      (goal.delivered || 0) !== pending.deliveredBefore)
    throw blocked(`Chest handover is unconfirmed at ${vec(pending.position)}. Check that chest before asking for replacements.`);
  goal.delivered = pending.deliveredBefore + added;
  (goal.deliveryEvidence ||= []).push({ method: 'chest', recipient: goal.from, item: pending.item,
    count: added, position: pending.position, dimension: pending.dimension, at: new Date().toISOString() });
  delete goal.pendingChestDelivery; save();
  return added;
}

async function openChest(bot, task, block) {
  // A locked chest, a cat on its lid, or a disappearing block may never send
  // windowOpen. Bound the wait instead of stalling the whole task.
  let window, error, abandoned = false;
  const listeners = new Set(bot.listeners?.('windowOpen') || []);
  bot.openContainer(block).then(value => { if (!abandoned) window = value; }, failure => { error = failure; });
  const added = (bot.listeners?.('windowOpen') || []).filter(listener => !listeners.has(listener));
  const end = Date.now() + 4000;
  try {
    while (!window && !error && Date.now() < end) { task.check(); await new Promise(resolve => setTimeout(resolve, 50)); }
    task.check();
    if (error) throw error;
    if (!window) throw blocked('That chest did not open. Its lid may be blocked.');
    return window;
  } catch (error) {
    abandoned = true;
    // Remove only this openBlock waiter's listener. A stale open must never
    // consume and close the window opened by a later task.
    for (const listener of added) bot.removeListener('windowOpen', listener);
    window?.close(); throw error;
  }
}

async function depositInChest(bot, task, goal, save, block, target) {
  const item = goal.item || 'purple_concrete', window = await openChest(bot, task, block);
  try {
    if (bot._syncWindow) await bot._syncWindow(window);
    reconcileChestDeposit(goal, window, save);
    const count = target - (goal.delivered || 0);
    if (count <= 0) return true;
    task.check();
    const stack = window.items().find(i => i.name === item);
    if (!stack || carriedCount(window, item) < count) throw blocked(`I need the remaining ${item.replaceAll('_', ' ')} before filling the chest.`);
    // Empty slots alone are a conservative capacity guarantee. Do not rely
    // on merging with the player's possibly enchanted/named items.
    const empty = window.slots.slice(0, window.inventoryStart).filter(i => !i).length;
    const capacity = empty * (stack.stackSize || bot.registry.itemsByName[item]?.stackSize || 1);
    if (!capacity) return false;
    goal.pendingChestDelivery = { position: { ...block.position }, dimension: bot.game.dimension, item,
      inventoryBefore: carriedCount(window, item), containerBefore: containerCount(window, item),
      deliveredBefore: goal.delivered || 0, count: Math.min(count, capacity) };
    save(); task.check();
    let failure;
    try {
      await window.deposit(stack.type, null, goal.pendingChestDelivery.count);
      if (bot._syncWindow) await bot._syncWindow(window);
    } catch (error) { failure = error; }
    // Record confirmed progress even if stop arrived during the transaction.
    // On connection loss, leave the checkpoint untouched for the next open.
    if (failure) throw failure;
    const stored = reconcileChestDeposit(goal, window, save);
    if (!stored) throw blocked('The chest did not receive the items.');
    const p = block.position;
    bot.chat?.(`I put ${stored} ${item.replaceAll('_', ' ')} in the chest at ${p.x}, ${p.y}, ${p.z}.`);
    task.check();
    return (goal.delivered || 0) >= target;
  } finally { window.close(); }
}

async function deliverToChest(bot, task, goal, save, actions = require('./work')) {
  task.check();
  const item = goal.item || 'purple_concrete', target = Math.min(goal.count, goal.deliveryTarget ?? goal.count);
  if ((goal.delivered || 0) >= target && !goal.pendingChestDelivery) return (goal.delivered || 0) >= goal.count;
  const pending = goal.pendingChestDelivery;
  if (pending) {
    if (pending.dimension !== bot.game.dimension) throw blocked('The chest handover is waiting in another dimension.');
    const block = await approachWorkstation(bot, task, 'chest', [vec(pending.position)]);
    if (!block) throw blocked(`Chest handover is unconfirmed at ${vec(pending.position)}. Check that chest before asking for replacements.`);
    await depositInChest(bot, task, goal, save, block, target);
    return (goal.delivered || 0) >= goal.count;
  }
  if (countOf(bot, item) < target - (goal.delivered || 0)) {
    await actions.acquireStep(bot, task, item, target - (goal.delivered || 0), goal, save); return false;
  }
  if (goal.deliveryChestPreparation) {
    const reserved = goal.deliveryChestPreparation.reserved;
    if (countOf(bot, 'chest') <= (reserved.chest || 0)) {
      await actions.acquireStep(bot, task, 'chest', 1, goal, save, { reserved }); return false;
    }
    delete goal.deliveryChestPreparation; save();
  }
  const receiver = await require('./delivery').approachReceiver(bot, task, goal);
  if (!receiver) return false;
  goal.step = { action: 'store_delivery', item, count: target - (goal.delivered || 0), recipient: goal.from }; save();
  const positions = bot.findBlocks({ matching: bot.registry.blocksByName.chest.id, point: receiver.position, maxDistance: 6, count: 8 })
    .filter(p => p.offset(.5, .5, .5).distanceTo(receiver.position) <= 4 && dryPassable(bot.blockAt(p.offset(0, 1, 0))) &&
      new ConstructionGoal(bot, p, 'interact').reachable(receiver.position, .2));
  for (const p of positions) {
    const block = await approachWorkstation(bot, task, 'chest', [p]);
    if (block && await depositInChest(bot, task, goal, save, block, target)) return (goal.delivered || 0) >= goal.count;
  }
  const sites = chestSites(bot, receiver);
  // Reuse construction face access without digging or placing scaffolding.
  const access = { buildPhase: 'cleanup' };
  const selected = await chooseConstructionWork(bot, task, access, sites.map(position => ({ position, operation: 'place', material: 'chest' })));
  if (!selected) throw blocked('I need a free block near you for a chest.');
  const reserved = { ...goal.deliveryReservations };
  reserved[item] = Math.max(reserved[item] || 0, target - (goal.delivered || 0));
  if (countOf(bot, 'chest') <= (reserved.chest || 0)) {
    goal.deliveryChestPreparation = { reserved }; save();
    await actions.acquireStep(bot, task, 'chest', 1, goal, save, { reserved }); return false;
  }
  const p = selected.position;
  const face = await approachConstruction(bot, task, access, p, 'place', { material: 'chest' });
  task.check();
  const current = bot.players[goal.from]?.entity;
  if (!current || !chestSites(bot, current).some(site => site.equals(p))) throw blocked('I need a free block near you for a chest.');
  await actions.place(bot, task, p, 'chest', { face });
  goal.deliveryChest = { position: { ...p }, dimension: bot.game.dimension }; save();
  const block = await approachWorkstation(bot, task, 'chest', [p]);
  if (!block) throw blocked('I placed the chest, but cannot reach its lid yet.');
  await depositInChest(bot, task, goal, save, block, target);
  return (goal.delivered || 0) >= goal.count;
}

module.exports = { deliverToChest, depositInChest, reconcileChestDeposit, chestSites, openChest };
