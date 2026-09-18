'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('minecraft-data')('26.1');
const { catalogTree, resolveItem } = require('../src/catalog');
const { planCatalog } = require('../src/knowledge');
const { quantityCandidates } = require('../src/objectives');

test('quantity candidates come from the request rather than fixed batch sizes', () => {
  assert.deepEqual(quantityCandidates('get me a pumpkin'), ['1']);
  assert.deepEqual(quantityCandidates('get me pumpkins'), []);
  assert.deepEqual(quantityCandidates('get me two stacks of cobblestone'), ['2', '128']);
  assert.deepEqual(quantityCandidates('get half a stack of purple concrete'), ['32', '1']);
  assert.deepEqual(quantityCandidates('craft twenty-four stairs'), ['24']);
  assert.deepEqual(quantityCandidates('get one hundred and twenty eight stone'), ['128']);
});

test('catalog covers every item exactly once with bounded branches', () => {
  const leaves = [];
  function visit(children, depth = 0) {
    assert(Object.keys(children).length <= 28);
    assert(depth < 12);
    for (const node of Object.values(children)) {
      if (node.item) leaves.push(node.item);
      else visit(node.children, depth + 1);
    }
  }
  visit(catalogTree(registry));
  assert.equal(new Set(leaves).size, registry.itemsArray.length);
  assert.equal(leaves.length, registry.itemsArray.length);
});

test('catalog rejects answers outside the offered branch', async () => {
  await assert.rejects(resolveItem({ systemOne: async () => ({ answers: { item: { choice: 'invented_item' } } }) }, registry, 'a chest'), /outside/);
});

test('crafting uses observed birch and reserves ingredients across dependencies', () => {
  const plan = planCatalog(registry, 'chest', 1, {}, { nearby: ['birch_log'] });
  assert(plan.some(s => s.drops === 'birch_log'));
  assert(!plan.some(s => s.drops === 'oak_log'));
  const stock = {};
  for (const step of plan) {
    for (const [name, count] of Object.entries(step.consumes)) {
      assert((stock[name] || 0) >= count, `insufficient ${name} for ${step.item}`);
      if (!['crafting_table', 'furnace'].includes(name)) stock[name] -= count;
    }
    for (const [name, count] of Object.entries(step.produces)) stock[name] = (stock[name] || 0) + count;
  }
  assert.equal(stock.chest, 1);
});

test('stairs preserve species and correct recipe batch size', () => {
  const plan = planCatalog(registry, 'birch_stairs', 8, { birch_log: 4 });
  assert(!plan.some(s => s.action === 'mine'));
  assert.equal(plan.at(-1).count, 8);
  assert(plan.at(-1).recipe.shape.flat().filter(Boolean).every(i => i === 'birch_planks'));
});

test('grass plant needs shears while intact grass block needs Silk Touch', () => {
  const plan = planCatalog(registry, 'short_grass', 2, {}, { nearby: ['oak_log', 'stone', 'iron_ore', 'short_grass'] });
  assert(plan.some(s => s.item === 'shears'));
  assert(plan.some(s => s.action === 'smelt' && s.item === 'iron_ingot'));
  assert.equal(plan.at(-1).tool, 'shears');
  assert.throws(() => planCatalog(registry, 'grass_block', 1), /silk touch/i);
  const silk = planCatalog(registry, 'grass_block', 1, { diamond_shovel: 1 }, { tools: [{ name: 'diamond_shovel', enchantments: ['silk_touch'] }] });
  assert.equal(silk.at(-1).enchantment, 'silk_touch');
});

test('gravel needs no Silk Touch and survival-inaccessible items fail explicitly', () => {
  assert.equal(planCatalog(registry, 'gravel', 4).at(-1).enchantment, undefined);
  assert.throws(() => planCatalog(registry, 'bedrock', 1), /No supported survival acquisition/);
});

test('concrete crafts requested color and hardens the powder', () => {
  const plan = planCatalog(registry, 'red_concrete', 8, { sand: 4, gravel: 4, red_dye: 1, crafting_table: 1, wooden_pickaxe: 1 });
  assert.deepEqual(plan.map(s => s.action), ['craft', 'harden']);
  assert.equal(plan[0].item, 'red_concrete_powder');
  assert.equal(plan[1].item, 'red_concrete');
});

test('natural obsidian progression requires diamonds rather than searching for unobserved ender chests', () => {
  const plan = planCatalog(registry, 'obsidian', 10, { stone_pickaxe: 1, oak_log: 8, crafting_table: 1 });
  assert(plan.some(s => s.item === 'iron_pickaxe'));
  assert(plan.some(s => s.drops === 'diamond'));
  assert(plan.some(s => s.item === 'diamond_pickaxe'));
  assert.equal(plan.at(-1).tool, 'diamond_pickaxe');
  assert.equal(plan.at(-1).block, 'obsidian');
  assert(!plan.at(-1).sources.includes('ender_chest'));
});

test('a mining action cannot combine sources needing stronger harvest tools', () => {
  const copy = { ...registry, blocksArray: registry.blocksArray.map(b => b.name === 'stone'
    ? { ...b, harvestTools: { [registry.itemsByName.diamond_pickaxe.id]: true } } : b) };
  const step = planCatalog(copy, 'cobblestone', 1, { wooden_pickaxe: 1 }, { nearby: ['cobblestone'] }).at(-1);
  assert.equal(step.tool, 'wooden_pickaxe');
  assert(!step.sources.includes('stone'), 'the chosen wooden pickaxe must not authorize the diamond-only source');
});
