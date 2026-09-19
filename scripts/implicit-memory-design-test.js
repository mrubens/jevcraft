'use strict';
// Real Jev judgments against a controlled read-only world survey. No gameplay.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
require('../src/env').loadEnv();
const { TypeSafe } = require('../src/typesafe'), { Task } = require('../src/skills');
const { designWithJev } = require('../src/build-templates');
const registry = require('minecraft-data')('26.1');
const directory = path.resolve('artifacts', `implicit-memory-design-${Date.now().toString(36)}`); fs.mkdirSync(directory, { recursive: true });
const bot = { registry, entity: { position: new Vec3(.5, 64, .5) }, game: { dimension: 'overworld', gameMode: 'survival', minY: 0, height: 128 },
  health: 20, food: 20, inventory: { items: () => [{ name: 'cherry_log', count: 32 }, { name: 'birch_log', count: 32 }] },
  blockAt: p => ({ name: p.y < 64 ? 'grass_block' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty', diggable: true }) };
const service = new TypeSafe();
(async () => {
  for (const [index, example] of [
    { request: 'build a mansion', wood: 'cherry' },
    { request: 'build a mansion out of birch wood', wood: 'birch' },
    { request: 'build a mansion', wood: 'birch', notes: [{ note: 'I prefer birch wood' }] },
  ].entries()) {
    const calls = [], client = { model: service.model, systemOne: async args => { const result = await service.systemOne(args); calls.push({ state: args.state, questions: args.questions, result }); return result; } };
    const design = await designWithJev(bot, new Task('memory design'), example.request, client,
      { notes: example.notes || [], preferences: [{ category: 'wood_species', value: 'cherry', source: 'inferred_from_request' }] });
    fs.writeFileSync(path.join(directory, `${index}.json`), JSON.stringify({ example, design, calls }, null, 2));
    assert(design.materials[`${example.wood}_planks`] > 0);
    console.log(JSON.stringify({ result: 'PASS', request: example.request, wood: example.wood, explicitNote: !!example.notes }));
  }
  console.log(JSON.stringify({ result: 'PASS', directory }));
})().catch(error => { console.error(error); process.exitCode = 1; });
