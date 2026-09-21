'use strict';
// Live decision eval against the configured Jev provider. Each case is a
// judgment code cannot make from a rule: a trade-off between the player's
// request and what the world is about to do. Cases that turned out to be
// rules (eat carried food when hungry) were moved into code and out of here.
require('../src/env').loadEnv();
const fs = require('node:fs');
const { TypeSafe } = require('../src/typesafe');
const { decideTree } = require('../src/decisions');
const branch = (description, children) => ({ description, children });
const leaf = description => ({ description });
const survivalFacts = ticks => ({ difficulty: 'normal', hostileMobsSpawnAtNight: true, nightStartsAt: 11500, dawnAt: 23000,
  daylightTicksRemaining: Math.max(0, 11500 - ticks), shelterReady: false, shelterDistance: null });
const dusk = {
  continue_request: leaf('Spend the next action on the player request while outside. Only suitable when hunger and daylight permit survival preparations afterwards.'),
  secure_shelter: leaf('Prepare and enter a sealed shelter before hostile mobs spawn at night. Reserve a nearby site, obtain missing blocks, then seal the room; keep the player request saved.'),
};
const sources = branch('Continue the player request to build a house.', { gather_materials: branch('Acquire logs for the missing planks.', {
  source_oak_log_near: leaf({ block: 'oak_log', blocksWithinReach: 3, distance: 5, elevationChange: 0 }),
  source_oak_log_far: leaf({ block: 'oak_log', blocksWithinReach: 9, distance: 38, elevationChange: 6 }),
}) });
const cases = [
  { name: 'dusk-with-no-shelter', expected: ['secure_shelter'], tree: dusk,
    state: { playerRequest: 'build a house', retainedGoal: 'house', timeOfDay: 10800, health: 20, food: 20, safeFoodCarried: false, survivalFacts: survivalFacts(10800), carriedBuildingBlocks: 0 } },
  { name: 'dusk-with-a-verified-shelter-beside-me', expected: ['continue_request'], tree: dusk,
    state: { playerRequest: 'build a house', retainedGoal: 'house', timeOfDay: 10000, health: 20, food: 20, safeFoodCarried: true,
      survivalFacts: { ...survivalFacts(10000), shelterReady: true, shelterDistance: 4 }, carriedBuildingBlocks: 12 } },
  { name: 'few-logs-close-beat-many-logs-far', expected: ['build_house', 'gather_materials', 'source_oak_log_near'], tree: { build_house: sources },
    state: { playerRequest: 'build a house', retainedGoal: 'house', food: 20, health: 20, inventory: {}, nearbyThreats: [], daylight: 'day',
      acquisition: { dependencies: [{ action: 'mine', item: 'oak_log', count: 4 }] } } },
  { name: 'the-requested-species-beats-the-nearer-tree', expected: ['build_house', 'gather_materials', 'source_birch_log'], tree: { build_house: branch('Continue the player request to build a birch house.', { gather_materials: branch('Acquire logs for the missing planks.', {
    source_oak_log: leaf({ block: 'oak_log', blocksWithinReach: 6, distance: 4, elevationChange: 0 }),
    source_birch_log: leaf({ block: 'birch_log', blocksWithinReach: 6, distance: 22, elevationChange: 1 }),
  }) }) },
    state: { playerRequest: 'build a birch house', retainedGoal: 'house', food: 20, health: 20, inventory: {}, nearbyThreats: [], daylight: 'day',
      acquisition: { dependencies: [{ action: 'mine', item: 'birch_log', count: 24 }] } } },
];
(async () => {
  const client = new TypeSafe();
  const results = [];
  for (const scenario of cases) {
    const decision = await decideTree(client, scenario);
    const record = { name: scenario.name, pass: JSON.stringify(decision.path) === JSON.stringify(scenario.expected), expected: scenario.expected,
      path: decision.path, latencyMs: decision.latencyMs, usage: decision.usage, judgments: decision.judgments, asked: decision.asked };
    results.push(record); console.log(JSON.stringify({ name: record.name, pass: record.pass, path: record.path, latencyMs: record.latencyMs, judgments: record.judgments.map(j => ({ choice: j.choice, confidence: j.confidence })) }));
  }
  fs.mkdirSync('artifacts', { recursive: true });
  const artifact = `artifacts/decision-eval-${Date.now().toString(36)}.json`;
  fs.writeFileSync(artifact, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.filter(r => r.pass).length, total: results.length, artifact }));
  if (results.some(r => !r.pass)) process.exitCode = 1;
})().catch(err => { console.error(err.message); process.exitCode = 1; });
