'use strict';
const { Vec3 } = require('vec3');
const { knowledge } = require('./knowledge');
const faces = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const air = block => ['air', 'cave_air', 'void_air'].includes(block?.name);

// Observe competing ingredients separately from abundant stone and logs.
// Groups come from actual alternative recipes, including intermediate outputs
// such as dyes. A small fixed list of flowers would miss new catalog recipes.
function recipeSourceGroups(registry, plan) {
  const data = knowledge(registry), groups = {};
  for (const item of new Set(plan.filter(s => s.action === 'craft').map(s => s.item))) {
    const recipes = data.recipes[item] || [];
    if (recipes.length < 2) continue;
    const names = new Set();
    for (const recipe of recipes) {
      const slots = recipe.shape ? recipe.shape.flat().filter(Boolean) : recipe.ingredients;
      for (const ingredient of slots.flat()) for (const source of data.sources[ingredient] || []) {
        if (data.recipes[source.block] && !/(ore|log|stem|hyphae|wood)$/.test(source.block)) continue;
        names.add(source.block);
      }
    }
    if (names.size > 1) groups[item] = [...names];
  }
  return groups;
}

function observeRecipeAlternatives(bot, plan) {
  const observations = bot._recipeObservations ||= {};
  const nearby = new Set();
  for (const [item, names] of Object.entries(recipeSourceGroups(bot.registry, plan))) {
    let observation = observations[item];
    if (!observation || Date.now() - observation.at > 5000 || bot.entity.position.distanceTo(observation.position) > 8) {
      const matching = names.map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
      const found = bot.findBlocks({ matching, maxDistance: 64, count: 16,
        useExtraInfo: block => faces.some(face => air(bot.blockAt(block.position.plus(face)))) });
      observation = observations[item] = { at: Date.now(), position: bot.entity.position.clone(),
        names: [...new Set(found.map(p => bot.blockAt(p)?.name).filter(Boolean))] };
    }
    for (const name of observation.names) nearby.add(name);
  }
  return [...nearby];
}

module.exports = { recipeSourceGroups, observeRecipeAlternatives };
