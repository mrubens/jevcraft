'use strict';
const { planCatalog } = require('./knowledge');
const { dryStanding, miningReach } = require('./mining-access');
const { safeExcavation } = require('./tunneling');
const { safeFromHostiles } = require('./danger');
const { reservedForConstruction } = require('./build-sites');
const { checkAir } = require('./vitals');

// The ordinary tool reserve must not create a circular dependency when a worn
// pick can gather the last ingredient for its own replacement. Admit that pick
// to this one recipe proof only; never count it as a general expedition tool.
function replacementPlan(bot) {
  const stock = {}, worn = new Map();
  for (const item of bot.inventory.items()) {
    stock[item.name] = (stock[item.name] || 0) + item.count;
    const remaining = (bot.registry.itemsByName[item.name]?.maxDurability || 0) - (item.durabilityUsed || 0);
    if (item.name.endsWith('_pickaxe') && remaining > 0 && remaining < 8) {
      worn.set(item.name, Math.max(worn.get(item.name) || 0, remaining));
    }
    if (item.name.endsWith('_pickaxe') && remaining >= 8) return null;
  }
  if (!worn.size) return null;
  // Ask the real catalog for a stronger replacement. Only a complete recipe
  // funded by carried ingredients and the remaining stone swings qualifies.
  let plan;
  try { plan = planCatalog(bot.registry, 'stone_pickaxe', (stock.stone_pickaxe || 0) + 1, stock, { nearby: ['stone'] }); }
  catch (_) { return null; }
  const mining = plan.filter(step => step.action === 'mine');
  if (mining.length !== 1 || !['cobblestone', 'cobbled_deepslate', 'blackstone'].includes(mining[0].drops) ||
      !worn.has(mining[0].tool) || mining[0].count > worn.get(mining[0].tool) ||
      plan.some(step => !['mine', 'craft'].includes(step.action)) ||
      plan[0] !== mining[0] || !plan.some(step => step.action === 'craft' && step.item === 'stone_pickaxe')) return null;
  return { plan, step: { ...mining[0], count: 1, minimumToolDurability: 1 } };
}

async function bootstrapPickaxe(bot, task, goal, save, { mine }) {
  task.check(); checkAir(bot);
  const proof = replacementPlan(bot);
  if (!proof || !dryStanding(bot, bot.entity.position)) return false;
  const step = proof.step;
  const matching = step.sources.map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
  const positions = bot.findBlocks({ matching, maxDistance: 4, count: 16 });
  const target = positions.find(p => {
    const block = bot.blockAt(p);
    return step.sources.includes(block?.name) && block.diggable && bot.canDigBlock(block) &&
      miningReach(bot, bot.entity.position, p) && safeExcavation(bot, p) &&
      safeFromHostiles(bot, p) && !reservedForConstruction(goal, p);
  });
  if (!target) return false;
  const movement = bot.pathfinder.movements;
  const previous = { canDig: movement.canDig, scafoldingBlocks: movement.scafoldingBlocks, allow1by1towers: movement.allow1by1towers };
  Object.assign(movement, { canDig: false, scafoldingBlocks: [], allow1by1towers: false });
  const count = () => bot.inventory.items().filter(i => i.name === step.drops).reduce((n, i) => n + i.count, 0);
  const before = count();
  try {
    goal.step = { action: 'bootstrap_pickaxe', item: 'stone_pickaxe', tool: step.tool, source: { ...target }, recipe: proof.plan };
    save();
    await mine(bot, task, step, goal, save, target);
    task.check();
    if (count() <= before) throw new Error('Replacement-tool ingredient pickup was not confirmed');
    goal.toolRecovery = { at: new Date().toISOString(), tool: step.tool, item: step.drops, collected: count() - before };
    save();
    return true;
  } finally { Object.assign(movement, previous); }
}

module.exports = { replacementPlan, bootstrapPickaxe };
