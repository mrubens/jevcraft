'use strict';
// Pack light, plan to die. Before a bold trip (the deep dark, a bastion, a
// trial chamber) everything but the trip's kit goes into a chest on the
// spot, so a death out there costs the kit and a walk, not the run's
// hoard. The user, 2026-09-23: "Jev should take minimal inventory etc and
// plan to die." The chest is a field cache (field-cache.js): remembered,
// held while the trip is on, and emptied again when the bot is back by it.
const { countOf } = require('./skills');
const { setAside, isSetAside } = require('./progress');

const TIERS = ['wooden', 'stone', 'golden', 'iron', 'diamond', 'netherite'];
const tier = name => TIERS.findIndex(t => name.startsWith(`${t}_`));
const FOOD_POINTS = 20, BLOCKS = 32, TORCHES = 16, ARROWS = 32;
const BLOCK = /^(cobblestone|cobbled_deepslate|netherrack|dirt|stone|andesite|diorite|granite|tuff|deepslate|blackstone)$/;

// What the trip takes, as a count per item name: the best of each tool, the
// shield and bow, food to twenty points, a stack's half of blocks, torches,
// water, the bed, and for a bastion the gold a piglin looks for.
function tripKeep(bot, trip) {
  const items = bot.inventory.items();
  const keep = {};
  const add = (name, n) => { keep[name] = (keep[name] || 0) + n; };
  for (const kind of ['sword', 'pickaxe', 'axe']) {
    const best = items.filter(i => i.name.endsWith(`_${kind}`)).sort((a, b) => tier(b.name) - tier(a.name))[0];
    if (best) add(best.name, 1);
  }
  for (const name of ['shield', 'bow', 'water_bucket', 'crafting_table', 'flint_and_steel']) if (countOf(bot, name)) add(name, 1);
  const bed = items.find(i => /_bed$/.test(i.name)); if (bed) add(bed.name, 1);
  if (countOf(bot, 'arrow')) add('arrow', Math.min(ARROWS, countOf(bot, 'arrow')));
  if (countOf(bot, 'torch')) add('torch', Math.min(TORCHES, countOf(bot, 'torch')));
  let blocks = 0;
  for (const i of items.filter(i => BLOCK.test(i.name))) { const n = Math.min(i.count, BLOCKS - blocks); if (n > 0) { add(i.name, n); blocks += n; } }
  const foodPoints = name => bot.registry?.foodsByName?.[name]?.foodPoints || 0;
  const unsafe = /^(rotten_flesh|spider_eye|poisonous_potato|pufferfish|chicken)$/;
  let points = 0;
  for (const i of items.filter(i => foodPoints(i.name) > 0 && !unsafe.test(i.name)).sort((a, b) => foodPoints(b.name) - foodPoints(a.name))) {
    const n = Math.min(i.count, Math.ceil((FOOD_POINTS - points) / foodPoints(i.name)));
    if (n > 0) { add(i.name, n); points += n * foodPoints(i.name); }
  }
  // Gold for the piglins: every golden armour piece goes along to a bastion.
  if (trip === 'bastion') for (const i of items.filter(i => /^golden_(helmet|chestplate|leggings|boots)$/.test(i.name))) add(i.name, 1);
  // Keys are what a trial chamber's vaults open with.
  if (trip === 'trial_chambers') for (const name of ['trial_key', 'ominous_trial_key']) if (countOf(bot, name)) add(name, countOf(bot, name));
  return keep;
}

// Everything over the kit, as deposit moves.
function tripDeposits(bot, trip) {
  const keep = tripKeep(bot, trip), totals = {};
  for (const i of bot.inventory.items()) totals[i.name] = (totals[i.name] || 0) + i.count;
  return Object.entries(totals).map(([item, n]) => ({ item, count: n - (keep[item] || 0) })).filter(m => m.count > 0);
}

// Packed for this trip already, with the chest still holding it.
const packedFor = (goal, trip) => (goal.caches || []).some(c => c.hold === trip && Object.values(c.contents || {}).some(n => n > 0));

// Before the trip: a chest here, the surplus in it, the chest held for the
// trip. True when packed (or nothing to pack, or packing failed and was set
// aside: the trip is not held up either way).
async function packLight(bot, task, goal, save, actions, trip, { now = Date.now() } = {}) {
  if (packedFor(goal, trip) || isSetAside(goal, 'pack_light', trip, now)) return true;
  const moves = tripDeposits(bot, trip);
  if (moves.reduce((n, m) => n + m.count, 0) < 8) return true;
  const { chestCell } = require('./field-cache');
  const stash = require('./home-stash');
  try {
    goal.step = { action: 'pack_light', trip, items: moves.slice(0, 12) }; save();
    if (!countOf(bot, 'chest')) await actions.acquireStep(bot, task, 'chest', 1, goal, save);
    const cell = chestCell(bot);
    if (!cell) throw new Error('No dry spot beside me for a chest');
    await actions.place(bot, task, cell, 'chest');
    if (bot.blockAt(cell)?.name !== 'chest') throw new Error('The chest did not go down');
    const cache = { position: { x: cell.x, y: cell.y, z: cell.z }, dimension: String(bot.game?.dimension || 'overworld'), contents: {}, placedAt: new Date(now).toISOString(), reason: trip, hold: trip };
    (goal.caches ||= []).push(cache); save();
    const home = { origin: cache.position, stash: { position: cache.position, contents: {} } };
    const stored = await stash.withChest(bot, task, goal, save, home, actions, async window => {
      const done = [];
      for (const move of tripDeposits(bot, trip)) {
        task.check();
        if (!stash.chestRoomFor(bot, window, move.item)) continue;
        try { await stash.moveIn(bot, window, move); done.push(move); } catch (err) { task.check(); }
      }
      return done;
    });
    cache.contents = home.stash.contents || {}; save();
    bot.chat?.(`Packing light for ${trip.replaceAll('_', ' ')}: ${stored.length} kinds of things left in a chest here. If I die out there, they wait for me.`);
  } catch (err) {
    task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err;
    setAside(goal, 'pack_light', trip, err, 20 * 60 * 1000); save();
  }
  return true;
}

// The trip is over (done, a warden, given up): its chest is free to be
// emptied the next time the bot is by it.
function tripOver(goal, trip) {
  for (const c of goal.caches || []) if (c.hold === trip) delete c.hold;
}

module.exports = { tripKeep, tripDeposits, packLight, packedFor, tripOver };
