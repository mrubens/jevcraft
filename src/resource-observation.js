'use strict';
const { Vec3 } = require('vec3');
const { knowledge } = require('./knowledge');
const faces = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const air = block => ['air', 'cave_air', 'void_air'].includes(block?.name);
const tags = require('../data/vanilla-26.1.json').resourceTags || {};
// Spore blossoms grow under cave ceilings; chorus belongs to End terrain.
const surfaceResources = new Set([...(tags.flowers || []).filter(n => !['spore_blossom', 'chorus_flower'].includes(n)), ...(tags.logs_that_burn || [])]);
const isSurfaceResource = name => surfaceResources.has(name);

function rememberResources(bot, goal, positions) {
  const memory = goal.resourceMemory ||= {};
  for (const position of positions) {
    const name = bot.blockAt(position)?.name;
    if (!name || air({ name })) continue;
    const dimension = bot.game?.dimension || 'overworld';
    memory[`${dimension}:${position.x},${position.y},${position.z}`] = { name, position: { ...position }, dimension, seenAt: Date.now() };
  }
  const entries = Object.entries(memory).sort((a, b) => b[1].seenAt - a[1].seenAt);
  for (const [key] of entries.slice(256)) delete memory[key];
}

function knownResourceLocations(bot, goal, names) {
  const result = [], dimension = bot.game?.dimension || 'overworld';
  for (const [key, entry] of Object.entries(goal?.resourceMemory || {})) {
    if (entry.dimension !== dimension) continue;
    const p = new Vec3(entry.position.x, entry.position.y, entry.position.z), actual = bot.blockAt(p);
    if (Date.now() - entry.seenAt > 1800000 || actual && actual.name !== entry.name) { delete goal.resourceMemory[key]; continue; }
    if (!names.includes(entry.name) || p.distanceTo(bot.entity.position) > 512 || goal.unreachable?.[`${p}`] > Date.now() - 120000) continue;
    result.push(p);
  }
  return result.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
}

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

function observeRecipeAlternatives(bot, plan, goal = {}) {
  const observations = bot._recipeObservations ||= {};
  const nearby = new Set();
  for (const [item, names] of Object.entries(recipeSourceGroups(bot.registry, plan))) {
    let observation = observations[item];
    if (!observation || Date.now() - observation.at > 5000 || bot.entity.position.distanceTo(observation.position) > 8) {
      const matching = names.map(name => bot.registry.blocksByName[name]?.id).filter(id => id !== undefined);
      const found = bot.findBlocks({ matching, maxDistance: 64, count: 16,
        useExtraInfo: block => faces.some(face => air(bot.blockAt(block.position.plus(face)))) });
      rememberResources(bot, goal, found);
      observation = observations[item] = { at: Date.now(), position: bot.entity.position.clone(),
        names: [...new Set(found.map(p => bot.blockAt(p)?.name).filter(Boolean))] };
    }
    for (const name of observation.names) nearby.add(name);
    for (const p of knownResourceLocations(bot, goal, names)) {
      const entry = goal.resourceMemory[`${bot.game?.dimension || 'overworld'}:${p.x},${p.y},${p.z}`];
      if (entry) nearby.add(entry.name);
    }
  }
  return [...nearby];
}

module.exports = { recipeSourceGroups, observeRecipeAlternatives, rememberResources, knownResourceLocations, isSurfaceResource };
