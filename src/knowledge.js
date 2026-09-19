'use strict';
const vanilla = require('../data/vanilla-26.1.json');
const { ORE_DEPTH, TOOL_TIERS, PlanError } = require('./plan');
const { mobSources, combatGear } = require('./mob-policy');
const cached = new WeakMap();
const ordinarySelf = new Set(vanilla.ordinarySelfDrops);
const plain = value => value?.replace('minecraft:', '');
const toolOrder = name => ['wooden', 'stone', 'iron', 'diamond', 'netherite', 'copper', 'golden'].indexOf(name.split('_')[0]);

function requirements(condition) {
  const kind = plain(condition.condition);
  if (kind === 'any_of') return condition.terms.flatMap(requirements);
  if (kind === 'all_of') return combine(condition.terms);
  if (kind === 'match_tool') {
    const p = condition.predicate;
    if (p.items === 'minecraft:shears') return [{ tool: 'shears' }];
    if (p.predicates?.['minecraft:enchantments']?.some(e => e.enchantments === 'minecraft:silk_touch')) return [{ enchantment: 'silk_touch' }];
    return [];
  }
  if (kind === 'block_state_property') return [{ properties: condition.properties }];
  if (kind === 'survives_explosion' || kind === 'random_chance') return [{}];
  return [];
}
function combine(conditions) {
  return conditions.reduce((a, c) => a.flatMap(left => requirements(c).map(right => ({ ...left, ...right }))), [{}]);
}

function knowledge(registry) {
  if (cached.has(registry)) return cached.get(registry);
  const sources = {};
  for (const block of registry.blocksArray) {
    if (block.diggable === false || block.hardness < 0 || block.name === 'bedrock') continue;
    const allowedTools = Object.keys(block.harvestTools || {}).map(id => registry.items[id]?.name).filter(Boolean).sort((a, b) => toolOrder(a) - toolOrder(b));
    for (const drop of block.drops || []) {
      const item = registry.items[typeof drop === 'number' ? drop : drop.drop]?.name;
      if (!item || (item === block.name && vanilla.specialDrops[block.name] && !ordinarySelf.has(block.name))) continue;
      (sources[item] ||= []).push({ block: block.name, allowedTools, depth: ORE_DEPTH[block.name] ?? null,
        ...(block.name === 'cobweb' && item === 'string' ? { tool: 'wooden_sword' } : {}) });
    }
    for (const conditions of vanilla.specialDrops[block.name] || []) {
      for (const requirement of combine(conditions)) (sources[block.name] ||= []).push({ block: block.name, allowedTools,
        depth: ORE_DEPTH[block.name] ?? null, ...requirement });
    }
  }
  // Gravel can drop flint probabilistically; each actual mining action still
  // verifies pickup and retries with a bounded search budget.
  sources.flint ||= [{ block: 'gravel', allowedTools: [], depth: null }];
  const result = { sources, mobSources: mobSources(), recipes: vanilla.recipes, smelting: vanilla.smelting };
  cached.set(registry, result);
  return result;
}

function sourceBlocks(registry, item) { return [...new Set((knowledge(registry).sources[item] || []).map(s => s.block))]; }

function planCatalog(registry, item, count, inventory = {}, { nearby = [], tools = [], equipment = [] } = {}) {
  if (!registry.itemsByName[item]) throw new PlanError(`No Minecraft item named ${item}`, item);
  const data = knowledge(registry);
  const observed = new Set(nearby);
  let stock = { ...inventory };
  const steps = [];
  const visiting = new Set();
  let estimates;
  let expansions = 0;
  const have = name => stock[name] || 0;
  const add = (name, amount) => { stock[name] = have(name) + amount; estimates = undefined; };
  const slots = recipe => recipe.shape ? recipe.shape.flat().filter(Boolean) : recipe.ingredients;
  // A drop table describes what breaking a block yields, not where that
  // block can be found. Never plan an unobserved crafted object as a raw
  // resource deposit (for example ender chests as a source of obsidian).
  const usableSource = (name, source) => !name.endsWith('_concrete') &&
    !(data.recipes[source.block] && !/(ore|log|stem|hyphae|wood)$/.test(source.block) &&
      (source.block === name || !observed.has(source.block)));
  // These costs rank real acquisition methods; they do not authorize actions.
  // Evaluate the recipe graph in bounded passes instead of recursively
  // expanding every repeated ingredient/alternative on the game event loop.
  const costRecipes = Object.entries(data.recipes).flatMap(([output, recipes]) =>
    recipes.map(recipe => ({ output, slots: slots(recipe), count: recipe.count })));
  function estimate(name) {
    if (!estimates) {
      let costs = {};
      for (const [item, amount] of Object.entries(stock)) if (amount > 0) costs[item] = 0;
      for (const [item, sources] of Object.entries(data.sources)) for (const source of sources) {
        if (source.enchantment || !usableSource(item, source)) continue;
        const cost = (observed.has(source.block) ? 1 : 8) + (source.tool ? 8 : 0) + (source.allowedTools.length ? 4 : 0);
        costs[item] = Math.min(costs[item] ?? 1000, cost);
      }
      for (const item of Object.keys(data.mobSources)) costs[item] = Math.min(costs[item] ?? 1000, 80);
      // Six dependency layers are sufficient for this preference heuristic.
      // Exact dependency execution below still detects cycles and checks the
      // full recipe/tool chain, with its separate expansion budget.
      for (let pass = 0; pass < 6; pass++) {
        const next = { ...costs };
        for (const recipe of costRecipes) {
          const cost = recipe.slots.reduce((sum, alternatives) => sum + Math.min(...alternatives.map(item => costs[item] ?? 1000)), 0) / recipe.count + 1;
          next[recipe.output] = Math.min(next[recipe.output] ?? 1000, cost);
        }
        for (const [output, inputs] of Object.entries(data.smelting)) for (const input of inputs) {
          next[output] = Math.min(next[output] ?? 1000, (costs[input] ?? 1000) + 12);
        }
        costs = next;
      }
      estimates = costs;
    }
    return estimates[name] ?? 1000;
  }
  function chooseIngredient(alternatives, counts) {
    const preference = name => ({ oak_log: -4, oak_planks: -4, cobblestone: -3, stone: -2, coal: -1 }[name] || 0);
    return alternatives.filter(name => registry.itemsByName[name]).sort((a, b) =>
      ((have(a) > (counts[a] || 0) ? -100 : estimate(a)) - (have(b) > (counts[b] || 0) ? -100 : estimate(b))) ||
      preference(a) - preference(b) || a.localeCompare(b))[0];
  }
  function acquire(name, needed) {
    if (have(name) >= needed) return;
    if (++expansions > 4000) throw new PlanError(`Recipe search exceeded its bounded budget for ${item}`, item);
    if (visiting.has(name)) throw new PlanError(`Recipe cycle while obtaining ${name}`, name);
    visiting.add(name);
    const missing = needed - have(name);
    let lastError;
    try {
      const methods = [];
      if (name === 'water_bucket') methods.push({ cost: 8, run: () => {
        acquire('bucket', missing); add('bucket', -missing);
        steps.push({ action: 'fill_bucket', item: name, count: missing, consumes: { bucket: missing }, produces: { water_bucket: missing } });
        add(name, missing);
      } });
      if (name.endsWith('_concrete')) methods.push({ cost: 1, run: () => {
        ensurePickaxe(); const powder = `${name}_powder`; acquire(powder, missing); add(powder, -missing);
        steps.push({ action: 'harden', item: name, count: missing, consumes: { [powder]: missing }, produces: { [name]: missing } }); add(name, missing);
      } });
      for (const recipe of data.recipes[name] || []) {
        const cost = slots(recipe).reduce((sum, alts) => sum + Math.min(...alts.map(ing => estimate(ing))), 0) / recipe.count + 1;
        methods.push({ cost, run: () => {
          const table = recipe.shape ? recipe.shape.length > 2 || recipe.shape.some(row => row.length > 2) : recipe.ingredients.length > 4;
          if (table) acquire('crafting_table', 1);
          const batches = Math.ceil(missing / recipe.count);
          const ingredients = {};
          const pick = alts => {
            if (!alts) return null;
            const selected = chooseIngredient(alts, ingredients);
            if (!selected) throw new PlanError(`No supported ingredient for ${name}`, name);
            ingredients[selected] = (ingredients[selected] || 0) + 1;
            return selected;
          };
          const chosen = recipe.shape ? { shape: recipe.shape.map(row => row.map(pick)) } : { ingredients: recipe.ingredients.map(pick) };
          const consumes = {};
          for (const [ingredient, amount] of Object.entries(ingredients)) {
            acquire(ingredient, amount * batches); add(ingredient, -amount * batches); consumes[ingredient] = amount * batches;
          }
          if (table) consumes.crafting_table = 1;
          steps.push({ action: 'craft', item: name, count: batches * recipe.count, needs_table: table,
            recipe: { ...chosen, count: recipe.count, id: recipe.id }, consumes, produces: { [name]: batches * recipe.count } });
          add(name, batches * recipe.count);
        } });
      }
      for (const input of data.smelting[name] || []) methods.push({ cost: estimate(input) + 12, run: () => {
        acquire(input, missing); acquire('furnace', 1);
        const fuel = Math.ceil(missing / 1.5); acquire('oak_planks', fuel);
        add(input, -missing); add('oak_planks', -fuel);
        steps.push({ action: 'smelt', item: name, count: missing, from: input, fuel,
          consumes: { [input]: missing, oak_planks: fuel, furnace: 1 }, produces: { [name]: missing } }); add(name, missing);
      } });
      for (const source of data.mobSources[name] || []) methods.push({ cost: 80, run: () => {
        for (const names of Object.values(combatGear)) {
          if (!names.some(tool => have(tool) > 0 || equipment.includes(tool))) acquire(names[0], 1);
        }
        // produces expresses the resource target for dependency planning;
        // kills never credit this amount to the real inventory.
        steps.push({ action: 'hunt_mob', ...source, count: missing, consumes: {}, produces: { [name]: missing } });
        add(name, missing);
      } });
      const sources = [...(data.sources[name] || [])].sort((a, b) => Number(observed.has(b.block)) - Number(observed.has(a.block)));
      for (const source of sources) {
        // Craftable objects should be made from ingredients. Do not roam the
        // world destroying other players' chests or houses as a cheap source.
        if (!usableSource(name, source)) continue;
        methods.push({ cost: (observed.has(source.block) ? 1 : 8) + (source.tool ? 8 : 0) + (source.allowedTools.length ? 4 : 0), run: () => {
          let tool = source.tool;
          if (source.enchantment) {
            const enchanted = tools.find(t => t.enchantments?.includes(source.enchantment) && (!source.allowedTools.length || source.allowedTools.includes(t.name)));
            if (!enchanted) throw new PlanError(`${name} requires a ${source.enchantment.replaceAll('_', ' ')} tool; normal digging does not drop that block. Enchanting this tool is not implemented yet.`, name);
            tool = enchanted.name;
          } else if (source.allowedTools.length) tool = source.allowedTools.find(t => have(t)) || source.allowedTools[0];
          if (tool) acquire(tool, 1);
          const compatible = sources.filter(s => usableSource(name, s) && s.tool === source.tool && s.enchantment === source.enchantment &&
            (!s.allowedTools.length || s.allowedTools.includes(tool)) && JSON.stringify(s.properties) === JSON.stringify(source.properties));
          steps.push({ action: 'mine', block: source.block, sources: [...new Set(compatible.map(s => s.block))], drops: name, count: missing,
            depth: source.depth, tier: tool?.endsWith('_pickaxe') ? TOOL_TIERS.indexOf(tool.split('_')[0]) + 1 : 0,
            tool, enchantment: source.enchantment, properties: source.properties, consumes: {}, produces: { [name]: missing } }); add(name, missing);
        } });
      }
      methods.sort((a, b) => a.cost - b.cost);
      for (const method of methods) {
        const before = { ...stock }; const length = steps.length;
        try { method.run(); return; }
        catch (err) { stock = before; estimates = undefined; steps.length = length; lastError = err; }
      }
      throw lastError || new PlanError(`No supported survival acquisition method for ${name}: it needs a source outside the current mining, crafting, smelting, hardening, and supported mob actions.`, name);
    } finally { visiting.delete(name); }
  }
  function ensurePickaxe() {
    if (!Object.keys(stock).some(name => name.endsWith('_pickaxe') && have(name))) acquire('wooden_pickaxe', 1);
  }
  acquire(item, count);
  return steps;
}

module.exports = { knowledge, sourceBlocks, planCatalog };
