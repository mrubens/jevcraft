'use strict';
const { countOf } = require('./skills');
const { prepareCombatGear } = require('./mob-hunt');
const { carriedEquipment, durable } = require('./mob-policy');
const { foodSupply } = require('./foraging');
const { checkThreats } = require('./danger');

// Two water buckets: one for a landing after the dragon's knockback, one
// poured against an enderman (end-combat.js). With one, the enderman took
// the bucket and the next knockback had nothing to land in.
async function prepareEndSupplies(bot, task, goal, save, actions) {
  task.check(); goal.preparingEnd = true; save();
  if (!await prepareCombatGear(bot, task, goal, save, actions)) return false;
  for (const [item, count] of [['bow', 1], ['arrow', 192], ['cobblestone', 64], ['iron_pickaxe', 1], ['water_bucket', 2]]) {
    const equipment = carriedEquipment(bot);
    const ready = item === 'bow' ? equipment.some(i => i.name === 'bow' && durable(bot.registry, i)) :
      item === 'iron_pickaxe' ? equipment.some(i => ['iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'].includes(i.name)) : countOf(bot, item) >= count;
    if (ready) continue;
    goal.step = { action: 'prepare_end_supplies', item, count }; save();
    await actions.acquireStep(bot, task, item, count + (['bow', 'iron_pickaxe'].includes(item) ? countOf(bot, item) : 0), goal, save);
    return false;
  }
  // An enchanting table before the End, and whatever the levels will buy on
  // the sword, the bow and the armour (enchanting.js): the dragon and its
  // endermen are the fights that most need it.
  const { tableNear, enchantReady } = require('./enchanting');
  if (actions.enchant && !tableNear(bot, goal)) {
    goal.step = { action: 'prepare_end_supplies', item: 'enchanting_table', count: 1 }; save();
    await actions.acquireStep(bot, task, 'enchanting_table', 1, goal, save);
    return false;
  }
  if (actions.enchant && enchantReady(bot, goal)) { await actions.enchant(bot, task, goal, save); return false; }
  // The ordinary food controller sees preparingEnd and gathers this reserve.
  if (foodSupply(bot) < 64 || bot.food < 18) return false;
  if (bot.health < 18) {
    goal.step = { action: 'recover_before_end', health: bot.health, food: bot.food }; save();
    for (let n = 0; n < 5; n++) { task.check(); checkThreats(bot); await new Promise(resolve => setTimeout(resolve, 100)); }
    return false;
  }
  delete goal.preparingEnd; save(); return true;
}
module.exports = { prepareEndSupplies };
