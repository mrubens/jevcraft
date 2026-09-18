'use strict';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const unsafeFoods = new Set(['pufferfish', 'poisonous_potato', 'spider_eye', 'rotten_flesh', 'chicken', 'suspicious_stew', 'chorus_fruit']);

function chooseFood(bot) {
  return bot.inventory.items().filter(item => bot.registry.foodsByName?.[item.name] && !unsafeFoods.has(item.name))
    .sort((a, b) => {
      const value = item => bot.registry.foodsByName[item.name].effectiveQuality - (item.name.includes('golden') ? 100 : 0);
      return value(b) - value(a);
    })[0];
}

async function until(task, predicate, timeout, message) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    task.check();
    if (Date.now() >= deadline) throw new Error(message);
    await sleep(100);
  }
  task.check();
}

async function maintainVitals(bot, task, onAction = () => {}) {
  task.check();
  if (bot.entity.isInWater && bot.oxygenLevel <= 8) {
    onAction({ action: 'surface', oxygen: bot.oxygenLevel });
    bot.pathfinder.setGoal(null); bot.clearControlStates();
    bot.setControlState('jump', true);
    try { await until(task, () => bot.oxygenLevel >= 18, 6000, 'Could not reach breathable air above the water'); }
    finally { bot.setControlState('jump', false); }
  }
  if (!(bot.food <= 16 || (bot.health <= 12 && bot.food < 20))) return false;
  const food = chooseFood(bot);
  if (!food) return false; // The higher-level survival planner must forage.
  onAction({ action: 'eat', item: food.name, food: bot.food, health: bot.health });
  await bot.equip(food, 'hand');
  if (bot._syncWindow) await bot._syncWindow(bot.inventory);
  task.check();
  const before = bot.food;
  let watcher;
  try {
    const cancelled = new Promise((_, reject) => {
      watcher = setInterval(() => {
        if (task.cancelled) {
          bot.deactivateItem();
          try { task.check(); } catch (err) { reject(err); }
        }
      }, 100);
    });
    await Promise.race([bot.consume(), cancelled]);
    await until(task, () => bot.food > before, 3000, 'Eating did not restore hunger');
  } finally { clearInterval(watcher); bot.deactivateItem(); }
  return true;
}

module.exports = { chooseFood, maintainVitals };
