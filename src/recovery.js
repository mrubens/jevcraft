'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { checkThreats, threats } = require('./danger');
const { checkAir } = require('./vitals');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const stock = bot => bot.inventory.items().reduce((out, item) => { out[item.name] = (out[item.name] || 0) + item.count; return out; }, {});
const pos = p => new Vec3(p.x, p.y, p.z);

function observeAliveInventory(bot, now = Date.now()) {
  if (bot.health > 0 && bot.isAlive && bot.inventory) {
    bot._aliveInventory = { at: now, entityId: bot.entity.id, items: stock(bot) };
  }
}

function recordDeath(bot, state, now = Date.now()) {
  // 26.1 can clear inventory before Mineflayer emits the health-based death
  // event. Preserve the last observed alive inventory, with its evidence time.
  const observed = bot._aliveInventory;
  const recent = observed && observed.entityId === bot.entity.id && now - observed.at <= 2000;
  state.deaths = [...(state.deaths || []), { at: new Date(now).toISOString(), position: { ...bot.entity.position }, dimension: bot.game.dimension }].slice(-10);
  state.recovery = { status: 'pending', at: new Date(now).toISOString(), position: { ...bot.entity.position },
    dimension: bot.game.dimension, inventoryBeforeDeath: recent ? { ...observed.items } : stock(bot),
    inventoryObservedAt: new Date(recent ? observed.at : now).toISOString(), recovered: {}, attempts: 0 };
  if (state.deaths.filter(d => now - Date.parse(d.at) < 600000).length >= 3) {
    state.paused = true;
    state.deathBlocked = 'I died three times within ten minutes. Progress is saved; I need a safer situation before you ask me to resume.';
  }
}

// Restrict retrieval to observed routes: no digging, scaffolding, swimming or
// approaching known hostiles. Unknown/dangerous/lost drops are a concrete
// reason to replan from current inventory, not to restore imagined supplies.
async function recoverItems(bot, task, recovery, save, navigate) {
  if (!recovery || recovery.status !== 'pending') return false;
  task.check(); checkAir(bot);
  const finish = reason => {
    recovery.status = 'finished'; recovery.reason = reason;
    recovery.inventoryAfter = stock(bot); recovery.finishedAt = new Date().toISOString();
    save(); bot.emit?.('death_recovery', recovery);
    bot.chat?.(`After respawning: ${reason}. Continuing from my current inventory.`);
    return false;
  };
  if (bot.game.gameMode === 'creative') return finish('Creative inventory remains available');
  const lost = recovery.inventoryBeforeDeath;
  if (!Object.keys(lost).length) return finish('no items were recorded in my inventory at death');
  if (bot.game.dimension !== recovery.dimension) return finish('the death location is in another dimension');
  if (Date.now() - Date.parse(recovery.at) > 300000) return finish('the drop retrieval window elapsed; the old items may have despawned');
  if (bot.health <= 12 || bot.food <= 6) return finish('my health or hunger is too low for a retrieval trip');
  if (recovery.attempts >= 5 || (recovery.startedAt && Date.now() - Date.parse(recovery.startedAt) >= 30000)) return finish('the bounded retrieval attempt ended');
  const origin = pos(recovery.position);
  if (origin.distanceTo(bot.entity.position) > 128 || !bot.blockAt(origin)) return finish('the death location is outside the currently observed area');
  const missing = name => Math.max(0, (lost[name] || 0) - (recovery.recovered[name] || 0));
  const findCandidates = () => Object.values(bot.entities || {}).filter(e => e.position && e.isValid !== false &&
    missing(e.getDroppedItem?.()?.name) > 0 && e.position.distanceTo(origin) <= 8 && !(recovery.failedEntities || []).includes(e.id))
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
  if (!Object.keys(lost).some(name => missing(name))) return finish('recovered the recorded item quantities');
  const before = stock(bot);
  const countPickups = () => {
    const after = stock(bot);
    for (const name of Object.keys(lost)) recovery.recovered[name] = (recovery.recovered[name] || 0) + Math.min(missing(name), Math.max(0, (after[name] || 0) - (before[name] || 0)));
    return after;
  };
  let candidates = findCandidates();
  if (!candidates.length && bot.entity.position.distanceTo(origin) <= 4) {
    // Chunk readiness does not imply entity/metadata readiness after respawn.
    // Observe briefly before concluding that the recorded drops are absent.
    const deadline = Date.now() + 3000;
    while (!candidates.length && Date.now() < deadline) {
      await sleep(100); task.check(); checkAir(bot); checkThreats(bot);
      candidates = findCandidates();
      if (Object.keys(lost).some(name => (stock(bot)[name] || 0) > (before[name] || 0))) {
        countPickups(); save(); return true;
      }
    }
  }
  if (!candidates.length && bot.entity.position.distanceTo(origin) <= 4) return finish('no matching dropped items are visible at the death location');
  const destination = candidates[0]?.position || origin;
  const target = candidates.length ? new goals.GoalBlock(Math.floor(destination.x), Math.floor(destination.y), Math.floor(destination.z)) :
    new goals.GoalNear(origin.x, origin.y, origin.z, 2);
  const movement = bot.pathfinder.movements;
  const previous = { canDig: movement.canDig, allow1by1towers: movement.allow1by1towers,
    allowSprinting: movement.allowSprinting, scafoldingBlocks: movement.scafoldingBlocks, maxDropDown: movement.maxDropDown };
  Object.assign(movement, { canDig: false, allow1by1towers: false, allowSprinting: false, scafoldingBlocks: [], maxDropDown: 2 });
  try {
    const route = bot.pathfinder.getPathTo(movement, target, 250);
    if (route.status !== 'success') return finish('no complete observed route to the dropped items');
    const danger = threats(bot, 128);
    if (route.path.some(p => ['water', 'lava', 'fire', 'soul_fire', 'powder_snow'].includes(bot.blockAt(pos(p))?.name) ||
      danger.some(t => t.entity.position.distanceTo(pos(p)) < 12))) return finish('the observed retrieval route crosses water or a hazard');
    recovery.startedAt ||= new Date().toISOString(); recovery.attempts++; save();
    task.interruptCheck = () => checkThreats(bot);
    await navigate(bot, task, target, { timeoutMs: Math.min(12000, 30000 - (Date.now() - Date.parse(recovery.startedAt))), stallMs: 4000 });
    await sleep(600); task.check(); checkAir(bot);
    const after = countPickups();
    if (candidates.length && JSON.stringify(before) === JSON.stringify(after)) (recovery.failedEntities ||= []).push(candidates[0].id);
    save(); bot.emit?.('death_recovery', recovery);
    return true;
  } catch (err) {
    task.check();
    if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err;
    return finish(`could not safely reach the dropped items: ${err.message}`);
  } finally { Object.assign(movement, previous); task.interruptCheck = undefined; }
}

module.exports = { recordDeath, recoverItems, observeAliveInventory };
