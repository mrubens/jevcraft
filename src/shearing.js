'use strict';
// Wool by shears, as a player gets it: one to three a sheep instead of the
// one a killed sheep drops, and the sheep grows it back. Beds are the
// wool's point: one to sleep in, and several to blow up in the End, where
// a bed explodes when slept in (the user, 2026-09-24: "he should care more
// about getting wool").
//
// A sheep's `wool` byte holds its colour in the low four bits and 0x10
// once it is sheared.
const { goals } = require('mineflayer-pathfinder');
const { countOf } = require('./skills');
const { collectNearbyDrops } = require('./drop-collection');
const { setAside, isSetAside } = require('./progress');

// Five beds' worth: one to sleep in, four for the dragon.
const WOOL_STOCK = 15, SHEARS_IRON = 2, REACH = 32;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const woolTotal = bot => bot.inventory.items().filter(i => /_wool$/.test(i.name)).reduce((n, i) => n + i.count, 0);
const flagsOf = (bot, e) => {
  const index = (bot.registry?.entitiesByName?.sheep?.metadataKeys || []).indexOf('wool');
  return index >= 0 ? Number(e.metadata?.[index] ?? 0) : 0;
};
const sheared = (bot, e) => (flagsOf(bot, e) & 0x10) !== 0;
const baby = (bot, e) => { const index = (bot.registry?.entitiesByName?.sheep?.metadataKeys || []).indexOf('baby'); return index >= 0 && e.metadata?.[index] === true; };

function woollySheep(bot, goal, reach = REACH) {
  const here = bot.entity.position;
  return Object.values(bot.entities || {}).filter(e => e.name === 'sheep' && e.isValid !== false && e.position && e.position.distanceTo(here) <= reach &&
    !sheared(bot, e) && !baby(bot, e) && !isSetAside(goal, 'shear', e.uuid || e.id))
    .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here));
}

// Shears in hand, or the iron for a pair.
const canShear = bot => countOf(bot, 'shears') > 0 || countOf(bot, 'iron_ingot') >= SHEARS_IRON;
// A side trip's worth: shears carried, a woolly sheep near, and less wool
// than five beds need.
const shearReady = (bot, goal) => countOf(bot, 'shears') > 0 && woolTotal(bot) < WOOL_STOCK && woollySheep(bot, goal, 24).length > 0 &&
  /overworld/.test(String(bot.game?.dimension || 'overworld'));

// Shear sheep until `want` wool is carried or none woolly is near.
async function shearSheep(bot, task, goal, save, { navigate, acquireStep, want = WOOL_STOCK, collect = collectNearbyDrops } = {}) {
  if (!countOf(bot, 'shears')) {
    if (countOf(bot, 'iron_ingot') < SHEARS_IRON || !acquireStep) return false;
    for (let i = 0; i < 6 && !countOf(bot, 'shears'); i++) { task.check(); if (await acquireStep(bot, task, 'shears', 1, goal, save)) break; }
    if (!countOf(bot, 'shears')) return false;
  }
  const start = woolTotal(bot);
  let shorn = 0;
  for (let n = 0; n < 8 && woolTotal(bot) < want; n++) {
    task.check();
    const sheep = woollySheep(bot, goal)[0];
    if (!sheep) break;
    goal.step = { action: 'shear_sheep', sheep: sheep.id, wool: woolTotal(bot), want }; save();
    if (sheep.position.distanceTo(bot.entity.position) > 3) {
      try { await navigate(bot, task, new goals.GoalFollow(sheep, 2), { timeoutMs: 15000, stallMs: 5000, stopWhen: () => sheep.position.distanceTo(bot.entity.position) <= 2.5 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
    if (sheep.isValid === false || sheep.position.distanceTo(bot.entity.position) > 3.5) { setAside(goal, 'shear', sheep.uuid || sheep.id, 'could not get beside it', 300000); continue; }
    const shears = bot.inventory.items().find(i => i.name === 'shears');
    await bot.equip(shears, 'hand');
    await bot.lookAt(sheep.position.offset(0, 0.8, 0), true);
    bot.useOn(sheep);
    for (let t = 0; t < 10 && !sheared(bot, sheep); t++) { await sleep(100); task.check(); }
    if (!sheared(bot, sheep)) { setAside(goal, 'shear', sheep.uuid || sheep.id, 'the shears did not take', 300000); continue; }
    shorn++;
    // The wool pops out round the sheep: every colour of it within a few blocks.
    const where = sheep.position.clone();
    for (const drop of Object.values(bot.entities || {}).filter(e => /_wool$/.test(e.getDroppedItem?.()?.name || '') && e.position?.distanceTo(where) < 6)) {
      task.check();
      try { await collect(bot, task, drop.getDroppedItem().name, { origin: where, radius: 6, timeoutMs: 5000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
  }
  if (shorn) { goal.shearing = { at: new Date().toISOString(), shorn, wool: woolTotal(bot) }; save(); }
  return woolTotal(bot) > start;
}

module.exports = { WOOL_STOCK, woollySheep, sheared, canShear, shearReady, shearSheep, woolTotal };
