'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
require('../src/env').loadEnv();
const { TypeSafe } = require('../src/typesafe'), { interpret } = require('../src/objectives'), { CompanionMemory } = require('../src/memory');
const registry = require('minecraft-data')('26.1');
const directory = path.resolve('artifacts', `implicit-memory-routing-${Date.now().toString(36)}`); fs.mkdirSync(directory, { recursive: true });
const memory = new CompanionMemory(path.join(directory, 'memory.json')), service = new TypeSafe();
let failed = 0;
async function check(index, example) {
  const calls = [], started = Date.now(); let spec;
  const client = { systemOne: async args => { const result = await service.systemOne(args); calls.push({ state: args.state, questions: args.questions, result }); return result; } };
  try {
    spec = await interpret(client, example.request, 'Alex', 'Jev', { registry, players: ['Alex', 'Sam'],
      memory: example.memory || memory.context('Alex'), inventory: { cherry_log: 8, oak_log: 8, cherry_planks: 32, oak_planks: 32 } });
    assert.equal(spec.kind, example.kind);
    for (const field of ['item', 'material']) if (example[field]) assert.equal(spec[field], example[field]);
    assert.deepEqual(spec.implicitPreferences?.map(p => p.value) || [], example.learn ? [example.learn] : []);
    if (example.tasks) assert.deepEqual(spec.tasks.map(t => [t.item, t.count]).sort(), example.tasks.sort());
    if (example.save) memory.recordGoal({ ...spec, status: 'complete' });
    console.log(JSON.stringify({ result: 'PASS', request: example.request, kind: spec.kind, elapsedMs: Date.now() - started }));
  } catch (error) { failed++; console.log(JSON.stringify({ result: 'FAIL', request: example.request, error: error.message, actual: spec && { kind: spec.kind, item: spec.item, material: spec.material, learned: spec.implicitPreferences } })); }
  finally { fs.writeFileSync(path.join(directory, `${index}.json`), JSON.stringify({ example, spec, calls }, null, 2)); }
}
(async () => {
  await check(0, { request: 'Jev give me a cherry log', kind: 'obtain', item: 'cherry_log', learn: 'cherry', save: true });
  assert.equal(memory.context('Alex').preferences[0]?.value, 'cherry');
  const explicitNote = { ...memory.context('Alex'), notes: [{ note: 'I prefer birch wood', source: 'player' }] };
  const examples = [
    { request: 'Jev give me two planks', kind: 'obtain', item: 'cherry_planks' },
    { request: 'Jev build a small house', kind: 'house', material: 'cherry_planks' },
    { request: 'Jev craft four wooden stairs', kind: 'craft', item: 'cherry_stairs' },
    { request: 'Jev get me two oak logs', kind: 'obtain', item: 'oak_log', learn: 'oak' },
    { request: 'Jev get me birch logs, not cherry', kind: 'obtain', item: 'birch_log', learn: 'birch' },
    { request: 'Jev give me a stone block', kind: 'obtain', item: 'stone' },
    { request: 'Jev give me two planks', kind: 'obtain', item: 'oak_planks', memory: memory.context('Sam') },
    { request: 'Jev get cherry logs for Sam', kind: 'obtain', item: 'cherry_log' },
    { request: 'Jev get yourself cherry logs', kind: 'obtain', item: 'cherry_log' },
    { request: 'Jev do not get me cherry logs', kind: 'other' },
    { request: 'Jev give me two planks', kind: 'obtain', item: 'birch_planks', memory: explicitNote },
    { request: 'Jev give me two planks and a bed', kind: 'bundle', tasks: [['cherry_planks', 2], ['white_bed', 1]] },
    { request: 'Jev give me two planks', kind: 'obtain', item: 'oak_planks', memory: { ...memory.context('Alex'), preferences: [] } },
  ];
  for (let i = 0; i < examples.length; i += 3) await Promise.all(examples.slice(i, i + 3).map((example, j) =>
    !process.env.MEMORY_CASE || Number(process.env.MEMORY_CASE) === i + j + 1 ? check(i + j + 1, example) : undefined));
  console.log(JSON.stringify({ result: failed ? 'FAIL' : 'PASS', failed, directory })); process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
