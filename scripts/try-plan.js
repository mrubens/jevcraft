'use strict';

// Offline check of the planner. No server, no API key, no model — if this is
// wrong, the bot cannot possibly succeed, so it is worth being able to run in
// a second.
//
// This runs the same knowledge.js planner the bot executes in game, over the
// same extracted recipe/smelting/drop data, so a plan printed here is the plan
// Jev would work through. What it cannot check is the world: `nearby` stands in
// for what the bot can actually see, and an observed block is cheaper than a
// speculative one, so the chosen route shifts with it exactly as it does in
// game.
//
//   npm run plan                          # the built-in cases
//   npm run plan -- cherry_planks 8       # one item
//   npm run plan -- iron_pickaxe 1 oak_log=10,cobblestone=30
//
const { planCatalog } = require('../src/knowledge');
const { PlanError } = require('../src/plan');
const registry = require('minecraft-data')(process.env.MC_VERSION || '26.1');

const CASES = [
  ['diamond', 1, {}, [], 'from nothing'],
  ['diamond', 3, {}, [], 'three of them'],
  ['iron_pickaxe', 1, {}, [], 'from nothing'],
  ['iron_pickaxe', 1, { oak_log: 10, cobblestone: 30 }, [], 'with wood and stone already'],
  ['diamond', 1, { iron_pickaxe: 1 }, [], 'already holding an iron pickaxe'],
  ['stone_pickaxe', 1, { oak_planks: 8, stick: 4, wooden_pickaxe: 1 }, [], 'partially stocked'],
  ['bucket', 1, {}, [], 'from nothing'],
  ['torch', 8, {}, [], 'from nothing'],
  ['cherry_planks', 8, {}, ['cherry_log'], 'a species the bot can see nearby'],
  ['purple_concrete', 32, {}, [], 'the acceptance request'],
  ['ender_pearl', 1, {}, [], 'through a supported mob encounter'],
  ['enchanted_golden_apple', 1, {}, [], 'deliberately impossible'],
];

function describe(step) {
  const amount = `${step.count} ${step.item || step.drops}`;
  switch (step.action) {
    case 'mine': return `mine ${amount} from ${(step.sources || [step.block]).join('/')}` +
      (step.depth != null ? ` (generates around y=${step.depth})` : '') + (step.tool ? ` with a ${step.tool}` : '');
    case 'craft': return `craft ${amount}${step.needs_table ? ' at a crafting table' : ''}`;
    case 'smelt': return `smelt ${amount} from ${step.from}, burning ${step.fuel} ${step.fuelItem}`;
    case 'harden': return `harden ${amount} in water`;
    case 'hunt_mob': return `hunt ${step.entity} for ${amount}`;
    case 'fill_bucket': return `fill a bucket for ${amount}`;
    default: return `${step.action} ${amount}`;
  }
}

const parse = text => Object.fromEntries((text || '').split(',').filter(Boolean).map(entry => {
  const [name, count] = entry.split('=');
  return [name, Number(count ?? 1)];
}));

const [item, count, stock, nearby] = process.argv.slice(2);
const cases = item ? [[item, Number(count || 1), parse(stock), Object.keys(parse(nearby)), 'requested']] : CASES;

for (const [name, amount, inventory, observed, label] of cases) {
  const context = [Object.keys(inventory).length ? `inventory=${JSON.stringify(inventory)}` : 'inventory={}',
    observed.length ? `nearby=${observed.join(',')}` : null].filter(Boolean).join(' ');
  console.log(`\n=== ${amount}x ${name} — ${label}  ${context}`);
  try {
    const steps = planCatalog(registry, name, amount, inventory, { nearby: observed });
    steps.forEach((step, i) => console.log(`   ${String(i + 1).padStart(2)}. ${describe(step)}`));
    console.log(`   (${steps.length} steps)`);
  } catch (err) {
    if (err instanceof PlanError) console.log(`   PlanError: ${err.message}`);
    else throw err;
  }
}
