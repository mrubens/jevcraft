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

test('smelting uses carried or observed local wood instead of requiring oak fuel', () => {
  for (const [stock, nearby] of [[{ birch_log: 1 }, []], [{}, ['birch_log']]]) {
    const plan = planCatalog(registry, 'glass', 4, { furnace: 1, sand: 4, ...stock }, { nearby });
    assert(!plan.some(s => s.drops === 'oak_log' || s.item === 'oak_planks'), 'local birch covers the fuel dependency');
    const smelt = plan.find(s => s.action === 'smelt');
    assert.equal(smelt.fuelItem, 'birch_planks'); assert.equal(smelt.consumes.birch_planks, 3);
    assert(plan.some(s => s.item === 'birch_planks'));
  }
});

test('fuel plank membership follows vanilla tags and excludes non-flammable Nether wood', () => {
  const { fuelPlanks } = require('../src/fuel');
  assert(fuelPlanks.includes('birch_planks')); assert(fuelPlanks.includes('bamboo_planks')); assert(fuelPlanks.includes('pale_oak_planks'));
  assert(!fuelPlanks.includes('crimson_planks')); assert(!fuelPlanks.includes('warped_planks'));
  for (const name of fuelPlanks) {
    const plan = planCatalog(registry, 'glass', 2, { furnace: 1, sand: 2, [name]: 2 });
    assert.equal(plan.length, 1); assert.equal(plan[0].fuelItem, name); assert.equal(plan[0].consumes[name], 2);
  }
  const plan = planCatalog(registry, 'glass', 2, { furnace: 1, sand: 2, crimson_planks: 64, warped_planks: 64, birch_log: 1 });
  assert.equal(plan.at(-1).fuelItem, 'birch_planks');
});

test('a spare oak plank does not cause a fuel-gathering trip when another carried wood covers the batch', () => {
  const plan = planCatalog(registry, 'glass', 4, { furnace: 1, sand: 4, oak_planks: 1, birch_planks: 3 });
  assert.equal(plan.length, 1); assert.equal(plan[0].fuelItem, 'birch_planks'); assert.equal(plan[0].consumes.birch_planks, 3);
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

test('obsidian progression requires diamonds and makes the obsidian from lava rather than searching for ender chests', () => {
  const plan = planCatalog(registry, 'obsidian', 10, { stone_pickaxe: 1, oak_log: 8, crafting_table: 1 });
  assert(plan.some(s => s.item === 'iron_pickaxe'));
  assert(plan.some(s => s.drops === 'diamond'));
  assert(plan.some(s => s.item === 'diamond_pickaxe'));
  assert.equal(plan.at(-1).action, 'make_obsidian');
  assert.equal(plan.at(-1).requires.diamond_pickaxe, 1);
  assert(!plan.some(s => s.sources?.includes('ender_chest')));
});

test('a mining action cannot combine sources needing stronger harvest tools', () => {
  const copy = { ...registry, blocksArray: registry.blocksArray.map(b => b.name === 'stone'
    ? { ...b, harvestTools: { [registry.itemsByName.diamond_pickaxe.id]: true } } : b) };
  const step = planCatalog(copy, 'cobblestone', 1, { wooden_pickaxe: 1 }, { nearby: ['cobblestone'] }).at(-1);
  assert.equal(step.tool, 'wooden_pickaxe');
  assert(!step.sources.includes('stone'), 'the chosen wooden pickaxe must not authorize the diamond-only source');
});

test('nested wool and bed recipes finish within the connection heartbeat budget', async () => {
  const { Worker } = require('node:worker_threads');
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { planCatalog } = require(workerData.knowledge);
    const registry = require(workerData.minecraftData)('26.1');
    const stock = { oak_log: 1, oak_planks: 2, wooden_axe: 5, stone_pickaxe: 1, bamboo: 1, wooden_pickaxe: 1, dirt: 8 };
    parentPort.postMessage({ ready: true });
    parentPort.once('message', () => parentPort.postMessage({ plan: planCatalog(registry, 'white_bed', 2, stock) }));
  `, { eval: true, workerData: { knowledge: require.resolve('../src/knowledge'), minecraftData: require.resolve('minecraft-data') } });
  let timer;
  try {
    const plan = await new Promise((resolve, reject) => {
      // Registry loading and worker startup are not synchronous recipe work.
      // Measure the existing heartbeat bound after the worker is ready; full
      // suite/process contention otherwise turns startup into a false failure.
      timer = setTimeout(() => reject(new Error('Recipe test worker did not start')), 10000);
      worker.on('message', message => {
        if (message.ready) {
          clearTimeout(timer);
          timer = setTimeout(() => reject(new Error('Recipe planning blocked for more than two seconds')), 2000);
          worker.postMessage('plan');
        } else resolve(message.plan);
      });
      worker.once('error', reject);
    });
    assert.equal(plan.at(-1).item, 'white_bed');
    assert.equal(plan.at(-1).count, 2);
    assert(plan.some(s => s.item === 'white_wool' && s.count === 6));
  } finally { clearTimeout(timer); await worker.terminate(); }
});

test('carried coal fuels a smelt instead of a trip for planks, and planks return when the coal runs short', () => {
  const withCoal = planCatalog(registry, 'iron_ingot', 3, { raw_iron: 3, furnace: 1, coal: 2 });
  const smelt = withCoal.find(s => s.action === 'smelt');
  assert.equal(smelt.fuelItem, 'coal'); assert.equal(smelt.fuel, 1); assert.equal(smelt.consumes.coal, 1);
  assert(!withCoal.some(s => s.action === 'mine' && /_log$/.test(s.block)), 'no wood gathering with coal in the pockets');
  const shortCoal = planCatalog(registry, 'iron_ingot', 24, { raw_iron: 24, furnace: 1, coal: 1, oak_planks: 16 });
  assert.equal(shortCoal.find(s => s.action === 'smelt').fuelItem, 'oak_planks');
});

test('with coal ore in view and no fuel carried, a smelt mines coal rather than climbing for planks', () => {
  const plan = planCatalog(registry, 'iron_ingot', 8, { raw_iron: 8, furnace: 1, stone_pickaxe: 1 }, { nearby: ['deepslate_coal_ore', 'stone'] });
  const smelt = plan.find(s => s.action === 'smelt');
  assert.equal(smelt.fuelItem, 'coal'); assert.equal(smelt.fuel, 1);
  assert(plan.some(s => s.action === 'mine' && s.drops === 'coal'));
  assert(!plan.some(s => /_log$/.test(s.block || '')));
  const planks = planCatalog(registry, 'iron_ingot', 3, { raw_iron: 3, furnace: 1, oak_planks: 4 }, { nearby: ['coal_ore'] });
  assert.equal(planks.find(s => s.action === 'smelt').fuelItem, 'oak_planks', 'planks already carried are used first');
});

test('in the Nether, planks come from crimson or warped stems, not from oak that does not grow there', () => {
  // mid-205-d: at y 16 in the Nether, planned oak logs and stood still over a hundred passes.
  const nether = planCatalog(registry, 'stick', 4, {}, { dimension: 'the_nether' });
  const mined = nether.filter(s => s.action === 'mine').map(s => s.block);
  assert(mined.length && mined.every(b => /^(crimson|warped)_stem$/.test(b)), `mined ${mined}`);
  const overworld = planCatalog(registry, 'stick', 4, {}, { dimension: 'overworld' });
  assert(overworld.filter(s => s.action === 'mine').every(s => !/stem$/.test(s.block)), 'at home, trees');
});
