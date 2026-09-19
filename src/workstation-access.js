'use strict';
const { ConstructionGoal } = require('./construction-access');
const { surveyRoute, navigate } = require('./skills');
const { checkAir } = require('./vitals');

// A nearby workstation can be sealed inside a building. Require a reachable,
// visible face before opening it, and try other observed stations without
// dismantling walls or spending the next recipe's ingredients as scaffolding.
async function approachWorkstation(bot, task, name, positions) {
  task.check(); checkAir(bot);
  const movement = bot.pathfinder.movements;
  const previous = Object.fromEntries(['canDig', 'allow1by1towers', 'scafoldingBlocks', 'countScaffoldingItems', 'getScaffoldingItem']
    .map(key => [key, movement[key]]));
  Object.assign(movement, { canDig: false, allow1by1towers: false, scafoldingBlocks: [],
    countScaffoldingItems: () => 0, getScaffoldingItem: () => null });
  let searchBudget = 3000;
  const deadline = Date.now() + 20000;
  try {
    for (const p of positions.slice(0, 8)) {
      task.check(); checkAir(bot);
      if (bot.blockAt(p)?.name !== name) continue;
      const destination = new ConstructionGoal(bot, p, 'interact');
      if (!destination.reachable(bot.entity.position, .2)) {
        if (searchBudget <= 0 || Date.now() >= deadline) break;
        const started = Date.now();
        const route = await surveyRoute(bot, task, movement, destination, Math.min(500, searchBudget));
        searchBudget -= Date.now() - started;
        task.check();
        if (route.status !== 'success') continue;
        try { await navigate(bot, task, destination, { timeoutMs: Math.min(8000, deadline - Date.now()), stallMs: 4000 }); }
        catch (err) {
          task.check();
          if (['NeedsAir', 'NeedsSafety'].includes(err.name)) throw err;
          continue;
        }
      }
      task.check(); checkAir(bot);
      const block = bot.blockAt(p);
      if (block?.name === name && destination.reachable(bot.entity.position, .2)) return block;
    }
    return null;
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete movement[key]; else movement[key] = value;
  }
}

module.exports = { approachWorkstation };
