'use strict';
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
require('../src/env').loadEnv();
const { TypeSafe } = require('../src/typesafe');
const { interpret } = require('../src/objectives');
const directory = path.join(__dirname, '..', 'artifacts', `companion-routing-${Date.now().toString(36)}`);
fs.mkdirSync(directory, { recursive: true });
const client = new TypeSafe(), registry = require('minecraft-data')('26.1');
const cases = [
  { request: 'Jev give me full diamond armor and a bed', kind: 'bundle', items: ['diamond_boots', 'diamond_chestplate', 'diamond_helmet', 'diamond_leggings', 'white_bed'] },
  { request: 'Jev get me full diamond armor', kind: 'bundle', items: ['diamond_boots', 'diamond_chestplate', 'diamond_helmet', 'diamond_leggings'] },
  { request: 'Jev bring me 3 diamonds and 2 red beds', kind: 'bundle', counts: { diamond: 3, red_bed: 2 } },
  { request: 'Jev craft a chest using oak and birch wood', kind: 'craft', item: 'chest' },
  { request: 'Jev find a cherry biome', kind: 'find', target: { kind: 'biome', name: 'cherry_grove' } },
  { request: 'Jev find a sheep', kind: 'find', target: { kind: 'entity', name: 'sheep' } },
  { request: 'Jev find a cherry log', kind: 'find', target: { kind: 'block', name: 'cherry_log' } },
  { request: 'Jev get me a cherry log', kind: 'obtain', item: 'cherry_log' },
  { request: 'Jev find me', kind: 'come' },
];
(async () => {
  let failed = 0;
  for (const [index, example] of cases.entries()) {
    const started = Date.now(); let spec;
    try {
      spec = await interpret(client, example.request, 'Player', 'Jev', { registry, players: ['Player'] });
      fs.writeFileSync(path.join(directory, `${index}.json`), JSON.stringify({ example, spec }, null, 2));
      assert.equal(spec.kind, example.kind);
      if (example.items) assert.deepEqual(spec.tasks.map(t => t.item).sort(), example.items.sort());
      if (example.counts) assert.deepEqual(Object.fromEntries(spec.tasks.map(t => [t.item, t.count])), example.counts);
      if (example.items || example.counts) assert(spec.tasks.every(t => t.deliver));
      if (example.items) assert(spec.tasks.every(t => t.count === 1));
      if (example.item) assert.equal(spec.item, example.item);
      if (example.target) assert.deepEqual(spec.discoveryTarget, example.target);
      console.log(JSON.stringify({ result: 'PASS', request: example.request, kind: spec.kind, items: spec.tasks?.map(t => [t.item, t.count]), target: spec.discoveryTarget, elapsedMs: Date.now() - started }));
    } catch (error) { failed++; console.log(JSON.stringify({ result: 'FAIL', request: example.request, actual: { kind: spec?.kind, message: spec?.message, tasks: spec?.tasks }, error: error.message })); }
  }
  console.log(JSON.stringify({ result: failed ? 'FAIL' : 'PASS', failed, directory })); process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
