'use strict';
// Piglin bartering: a gold ingot thrown to an adult piglin comes back, after
// it has admired it for a few seconds, as one of its loot table's items.
// Measured on this server: 160 ingots bought 18 ender pearls (about nine
// ingots a pearl) and, along the way, 13 obsidian, soul sand, quartz, string
// and a great deal of gravel and blackstone. It is one of two ways the pearl
// rung is filled; the enderman hunt is the other. The bot barters with the
// gold it carries while it is in the Nether, and hunts otherwise.
//
// A piglin leaves a player wearing gold alone (see danger.js), so a gold
// piece is worn first: carried golden boots, or a pair made from four
// ingots when there are enough to spare.
const { goals } = require('mineflayer-pathfinder');
const { countOf, navigate } = require('./skills');
const { checkAir } = require('./vitals');
const { checkThreats } = require('./danger');
const { setAside, isSetAside } = require('./progress');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// What is picked up afterwards. The rest (gravel, blackstone, spectral
// arrows, leather) fills pockets for nothing and is left lying.
const KEEP = new Set(['ender_pearl', 'obsidian', 'string', 'fire_charge', 'quartz', 'soul_sand', 'iron_nugget', 'enchanted_book']);
const ADMIRE_MS = 8000, PER_ROUND = 3, SEARCH = 32;
const GOLD_PIECES = ['golden_helmet', 'golden_chestplate', 'golden_leggings', 'golden_boots'];
const nether = bot => /nether/.test(String(bot.game?.dimension || ''));
const wearingGold = bot => [5, 6, 7, 8].some(slot => /^golden_/.test(bot.inventory?.slots?.[slot]?.name || ''));
const baby = (bot, e) => e.metadata?.[(bot.registry?.entitiesByName?.[e.name]?.metadataKeys || []).indexOf('baby')] === true;
const ingots = bot => countOf(bot, 'gold_ingot'), nuggets = bot => countOf(bot, 'gold_nugget');
// Gold that can be thrown: ingots carried, and nuggets that make ingots.
const goldOnHand = bot => ingots(bot) + Math.floor(nuggets(bot) / 9);

function piglins(bot, goal) {
  const here = bot.entity.position;
  return Object.values(bot.entities || {}).filter(e => e.name === 'piglin' && e.isValid !== false && e.position &&
    e.position.distanceTo(here) <= SEARCH && !baby(bot, e) && !isSetAside(goal, 'barter_piglin', e.id))
    .sort((a, b) => a.position.distanceTo(here) - b.position.distanceTo(here));
}

// Whether a barter can happen from here now: in the Nether, gold to throw,
// and a piglin in view.
function barterReady(bot, goal) {
  return nether(bot) && goldOnHand(bot) > 0 && piglins(bot, goal).length > 0;
}

async function wearGold(bot, task, goal, save, actions) {
  if (wearingGold(bot)) return true;
  const carried = bot.inventory.items().find(i => GOLD_PIECES.includes(i.name));
  if (!carried && ingots(bot) >= 5) {
    goal.step = { action: 'barter_make_gold_boots', ingots: ingots(bot) }; save();
    await actions.acquireStep(bot, task, 'golden_boots', 1, goal, save);
  }
  const piece = bot.inventory.items().find(i => GOLD_PIECES.includes(i.name));
  if (!piece) return false;
  const slot = { golden_helmet: 'head', golden_chestplate: 'torso', golden_leggings: 'legs', golden_boots: 'feet' }[piece.name];
  await bot.equip(piece, slot);
  return wearingGold(bot);
}

// One round: up to three piglins each thrown one ingot, the admiring waited
// out, and what is worth keeping picked up. Returns what the round brought.
async function barterStep(bot, task, goal, save, actions = {}) {
  task.check(); checkAir(bot);
  if (!nether(bot)) throw new Error('Bartering is done in the Nether: piglins turn in the Overworld');
  if (!ingots(bot) && nuggets(bot) >= 9) {
    goal.step = { action: 'barter_make_ingots', nuggets: nuggets(bot) }; save();
    await actions.acquireStep(bot, task, 'gold_ingot', Math.floor(nuggets(bot) / 9), goal, save);
  }
  if (!ingots(bot)) throw new Error('No gold to barter with');
  if (!await wearGold(bot, task, goal, save, actions)) throw new Error('No gold to wear: piglins will not barter with a player in no gold');
  const pearlsBefore = countOf(bot, 'ender_pearl');
  const round = piglins(bot, goal).slice(0, PER_ROUND);
  if (!round.length) throw new Error('No adult piglin in view to barter with');
  const state = goal.barter ||= { thrown: 0, pearls: 0 };
  const ingot = bot.registry.itemsByName.gold_ingot.id;
  const thrownAt = [];
  for (const piglin of round) {
    if (!ingots(bot)) break;
    task.check(); checkThreats(bot);
    if (piglin.position.distanceTo(bot.entity.position) > 4) {
      const p = piglin.position.floored();
      goal.step = { action: 'barter_approach', piglin: piglin.id, distance: Math.round(piglin.position.distanceTo(bot.entity.position)) }; save();
      try { await (actions.navigate || navigate)(bot, task, new goals.GoalNear(p.x, p.y, p.z, 3), { timeoutMs: 10000, stallMs: 3000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(goal, 'barter_piglin', piglin.id, err, 60000); continue; }
    }
    if (bot.entities[piglin.id] !== piglin || piglin.position.distanceTo(bot.entity.position) > 5) { setAside(goal, 'barter_piglin', piglin.id, 'out of reach', 60000); continue; }
    await bot.lookAt(piglin.position.offset(0, 0.5, 0), true);
    await bot.toss(ingot, null, 1);
    state.thrown++; thrownAt.push(piglin.position.clone());
    // One ingot a piglin at a time: it admires one and ignores the rest.
    setAside(goal, 'barter_piglin', piglin.id, 'admiring', ADMIRE_MS);
    goal.step = { action: 'barter', piglin: piglin.id, thrown: state.thrown, pearls: countOf(bot, 'ender_pearl'), ingotsLeft: ingots(bot) }; save();
  }
  if (!thrownAt.length) return { thrown: 0, pearls: 0 };
  for (let waited = 0; waited < ADMIRE_MS; waited += 200) { task.check(); checkAir(bot); await sleep(200); }
  // What the piglins dropped, near where they stood.
  const near = p => thrownAt.some(t => t.distanceTo(p) <= 8);
  const loot = () => Object.values(bot.entities).filter(e => KEEP.has(e.getDroppedItem?.()?.name) && e.position && near(e.position))
    .sort((a, b) => (b.getDroppedItem().name === 'ender_pearl') - (a.getDroppedItem().name === 'ender_pearl'));
  for (const drop of loot().slice(0, 8)) {
    task.check();
    if (bot.entities[drop.id] !== drop) continue;
    const p = drop.position.floored();
    try { await (actions.navigate || navigate)(bot, task, new goals.GoalNear(p.x, p.y, p.z, 1), { timeoutMs: 6000, stallMs: 2500 }); await sleep(300); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  }
  const gained = countOf(bot, 'ender_pearl') - pearlsBefore;
  state.pearls += Math.max(0, gained); save();
  return { thrown: thrownAt.length, pearls: gained };
}

module.exports = { barterReady, barterStep, goldOnHand, wearingGold, KEEP };
