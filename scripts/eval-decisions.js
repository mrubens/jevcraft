'use strict';
require('../src/env').loadEnv();
const fs = require('node:fs');
const { TypeSafe } = require('../src/typesafe');
const { decideTree } = require('../src/decisions');
const branch = (description, children) => ({ description, children });
const leaf = description => ({ description });
const building = branch('Continue the player request to build a house.', {
  build: branch('Place carried oak planks on the already selected foundation.', {
    near: leaf('Place one supported floor block 2 blocks away. Clear, level approach.'),
    far: leaf('Place an equally useful supported floor block 12 blocks away. Clear, level approach.'),
  }),
});
const food = branch('Pause house work to restore hunger and allow health regeneration.', {
  eat_carried_food: branch('Eat the safe bread already in inventory.', { eat: leaf('Consume bread and verify restored hunger, keeping the house goal.') }),
});
const cases = [
  { name: 'hungry-house-builder', state: { retainedGoal: 'build a house', food: 8, health: 10, inventory: { bread: 2, oak_planks: 24 }, nearbyThreats: [], daylight: 'day' },
    tree: { build_house: building, restore_food: food }, expected: ['restore_food', 'eat_carried_food', 'eat'] },
  { name: 'healthy-builder', state: { retainedGoal: 'build a house', food: 20, health: 20, inventory: { oak_planks: 24 }, nearbyThreats: [], daylight: 'day' },
    tree: { build_house: building }, expected: ['build_house', 'build', 'near'] },
  { name: 'gather-accessible-wood', state: { retainedGoal: 'build a house', food: 20, health: 20, inventory: {}, nearbyThreats: [], daylight: 'day' },
    tree: { build_house: branch('Build the house.', { gather_materials: branch('Acquire wood for the missing planks.', {
      nearby_tree: leaf('Approach and harvest an oak tree 4 blocks away on flat, reachable ground.'),
      distant_tree: leaf('Approach and harvest an identical oak tree 40 blocks away on flat, reachable ground.'),
    }) }) }, expected: ['build_house', 'gather_materials', 'nearby_tree'] },
];
(async () => {
  const client = new TypeSafe();
  const results = [];
  for (const scenario of cases) {
    scenario.state.survivalFacts = { healthMaximum: 20, hungerMaximum: 20, hungerNeedsAttention: scenario.state.food <= 16,
      injured: scenario.state.health < 20, hungerAllowsNaturalHealing: scenario.state.food >= 18, safeFoodCarried: !!scenario.state.inventory.bread };
    const decision = await decideTree(client, scenario);
    const record = { name: scenario.name, pass: JSON.stringify(decision.path) === JSON.stringify(scenario.expected), expected: scenario.expected,
      path: decision.path, latencyMs: decision.latencyMs, usage: decision.usage, judgments: decision.judgments };
    results.push(record); console.log(JSON.stringify(record));
  }
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync(`artifacts/decision-eval-${Date.now().toString(36)}.json`, JSON.stringify(results, null, 2));
  if (results.some(r => !r.pass)) process.exitCode = 1;
})().catch(err => { console.error(err.message); process.exitCode = 1; });
