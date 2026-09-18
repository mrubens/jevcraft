'use strict';
require('../src/env').loadEnv();
const { TypeSafe } = require('../src/typesafe');
const { interpret } = require('../src/objectives');
const fs = require('fs');
const cases = [
  ['Jev please make it daytime', { kind: 'operator_command' }],
  ['Jev teleport me to you', { kind: 'operator_command' }],
  ['Jev put me in Creative', { kind: 'operator_command' }],
  ['Jev summon a cow', { kind: 'operator_command' }],
  ['Jev get me a command block', { kind: 'obtain', item: 'command_block', count: 1 }],
  ['Jev do not change the time', { kind: 'other' }],
  ['Jev what does teleport do?', { kind: 'other' }],
  ['Jev get me three grass blocks', { kind: 'obtain', item: 'grass_block', count: 3, deliver: true }],
  ['jev get me a pumpkin', { kind: 'obtain', item: 'pumpkin', count: 1, deliver: true }],
  ['Jev build a house', { kind: 'house', material: 'oak_planks' }],
  ['Jev make a birch plank house', { kind: 'house', material: 'birch_planks' }],
  ['Jev bring me grass', { kind: 'obtain', item: 'short_grass', count: 1, deliver: true }],
  ['Jev get me a grass block', { kind: 'obtain', item: 'grass_block', count: 1, deliver: true }],
  ['Jev craft a chest', { kind: 'craft', item: 'chest', count: 1, deliver: false }],
  ['Jev collect 1 lapis lazuli for yourself', { kind: 'obtain', item: 'lapis_lazuli', count: 1, deliver: false }],
  ['Jev get yourself a stone pickaxe', { kind: 'obtain', item: 'stone_pickaxe', count: 1, deliver: false }],
  ['Jev collect 8 red concrete and keep it', { kind: 'obtain', item: 'red_concrete', count: 8, deliver: false }],
  ['Jev craft me a chest', { kind: 'craft', item: 'chest', count: 1, deliver: true }],
  ['Jev make eight birch stairs', { kind: 'craft', item: 'birch_stairs', count: 8, deliver: false }],
  ['Jev craft two stone pickaxes', { kind: 'craft', item: 'stone_pickaxe', count: 2, deliver: false }],
  ['Jev get me two stacks of cobblestone', { kind: 'obtain', item: 'cobblestone', count: 128, deliver: true }],
  ['Jev bring half a stack of purple concrete', { kind: 'obtain', item: 'purple_concrete', count: 32, deliver: true }],
  ['Jev collect 8 red concrete', { kind: 'obtain', item: 'red_concrete', count: 8, deliver: false }],
  ['Jev craft a furnace', { kind: 'craft', item: 'furnace', count: 1, deliver: false }],
  ['Jev get me bedrock', { kind: 'obtain', item: 'bedrock', count: 1 }],
  ['Jev come here', { kind: 'come', target: 'TestPlayer' }],
  ['Jev stay with Alex', { kind: 'follow', target: 'Alex' }],
  ['Jev find a way to the nether', { kind: 'nether' }],
  ['Jev stop', { kind: 'stop' }],
  ['Jev status', { kind: 'status' }],
  ['Jev resume', { kind: 'resume' }],
];
(async () => {
  const client = new TypeSafe();
  const results = [];
  for (const [request, expected] of cases) {
    const started = performance.now();
    const result = await interpret(client, request, 'TestPlayer', 'JevBot', { players: ['TestPlayer', 'Alex'] });
    const pass = Object.entries(expected).every(([key, value]) => result?.[key] === value);
    const record = { request, pass, expected, latencyMs: Math.round(performance.now() - started), result };
    results.push(record); console.log(JSON.stringify({ request, pass, expected, actual: { kind: result?.kind, item: result?.item, count: result?.count, target: result?.target, deliver: result?.deliver }, latencyMs: record.latencyMs }));
  }
  fs.mkdirSync('artifacts', { recursive: true });
  const artifact = `artifacts/intent-eval-${Date.now()}.json`;
  fs.writeFileSync(artifact, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ passed: results.filter(r => r.pass).length, total: results.length, artifact }));
  if (results.some(r => !r.pass)) process.exitCode = 1;
})().catch(err => { console.error(err.message); process.exitCode = 1; });
