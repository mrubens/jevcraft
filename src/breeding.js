'use strict';
// Breeding in the field: two adults of a kind near the bot, fed their food,
// make a third. Sheep are wool for the next bed (a death costs the carried
// one) and chickens are feathers for arrows; the cow pen at the base keeps
// its own rules (home-base.js). The user, 2026-09-23.
const { goals } = require('mineflayer-pathfinder');
const { countOf } = require('./skills');

// Cows too, for the food: the evening's deaths were mostly too hungry to
// heal with nothing to eat, and the base's pen had never held two cows (the
// user, 2026-09-26).
const FOODS = Object.freeze({ sheep: 'wheat', chicken: 'wheat_seeds', cow: 'wheat' });
const REST_MS = 5 * 60 * 1000, REACH = 16;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const baby = (bot, e) => e.metadata?.[(bot.registry?.entitiesByName?.[e.name]?.metadataKeys || []).indexOf('baby')] === true;

function adults(bot, species) {
  return Object.values(bot.entities || {}).filter(e => e.name === species && e.isValid !== false && e.position && !baby(bot, e) &&
    e.position.distanceTo(bot.entity.position) <= REACH).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
}

// Two adults in reach, two of their food carried, not bred in five minutes.
function breedReady(bot, goal, species, now = Date.now()) {
  const food = FOODS[species];
  if (!food || countOf(bot, food) < 2) return false;
  if (now - Date.parse(goal.bred?.[species] || 0) < REST_MS) return false;
  return adults(bot, species).length >= 2;
}

async function breedNearby(bot, task, goal, save, species, { navigate }) {
  const food = FOODS[species];
  const pair = adults(bot, species).slice(0, 2);
  if (pair.length < 2 || countOf(bot, food) < 2) return false;
  goal.step = { action: 'breed', species, food, adults: pair.length }; save();
  let fed = 0;
  for (const animal of pair) {
    task.check();
    if (animal.position.distanceTo(bot.entity.position) > 3.5) {
      try { await navigate(bot, task, new goals.GoalFollow(animal, 2), { timeoutMs: 12000, stallMs: 4000, stopWhen: () => animal.position.distanceTo(bot.entity.position) <= 3 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
    if (animal.position.distanceTo(bot.entity.position) > 4.5) continue;
    await bot.equip(bot.inventory.items().find(i => i.name === food), 'hand');
    await bot.lookAt(animal.position.offset(0, 0.5, 0), true);
    bot.useOn(animal);
    fed++;
    await sleep(400);
  }
  (goal.bred ||= {})[species] = new Date().toISOString(); save();
  if (fed === 2) bot.chat?.(`Bred two ${species === 'sheep' ? 'sheep' : species === 'cow' ? 'cows' : 'chickens'}.`);
  return fed === 2;
}

module.exports = { FOODS, breedReady, breedNearby, adults };
