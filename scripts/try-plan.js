'use strict';

// Offline check of the planner. No server, no API key, no model — if this is
// wrong, the bot cannot possibly succeed, so it is worth being able to run in
// a second.

const { planFor, describeStep, PlanError } = require('../src/plan');

const CASES = [
  ['diamond', 1, {}, 'from nothing'],
  ['diamond', 3, {}, 'three of them'],
  ['iron_pickaxe', 1, {}, 'from nothing'],
  ['iron_pickaxe', 1, { oak_log: 10, cobblestone: 30 }, 'with wood and stone already'],
  ['diamond', 1, { iron_pickaxe: 1 }, 'already holding an iron pickaxe'],
  ['stone_pickaxe', 1, { oak_planks: 8, stick: 4, wooden_pickaxe: 1 }, 'partially stocked'],
  ['bucket', 1, {}, 'from nothing'],
  ['torch', 8, {}, 'from nothing'],
  ['netherrack', 1, {}, 'deliberately impossible'],
];

for (const [item, count, inv, label] of CASES) {
  const stock = Object.keys(inv).length ? JSON.stringify(inv) : '{}';
  console.log(`\n=== ${count}x ${item} — ${label}  inventory=${stock}`);
  try {
    const steps = planFor(item, count, inv);
    steps.forEach((s, i) => console.log(`   ${String(i + 1).padStart(2)}. ${describeStep(s)}`));
    console.log(`   (${steps.length} steps)`);
  } catch (err) {
    if (err instanceof PlanError) console.log(`   PlanError: ${err.message}`);
    else throw err;
  }
}
