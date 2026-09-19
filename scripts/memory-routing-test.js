'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
require('../src/env').loadEnv();
const { TypeSafe } = require('../src/typesafe'), { interpret } = require('../src/objectives'), { CompanionMemory } = require('../src/memory');
const directory = path.resolve('artifacts', `memory-routing-${Date.now().toString(36)}`); fs.mkdirSync(directory, { recursive: true });
const memory = new CompanionMemory(path.join(directory, 'memory.json'));
const home = memory.rememberPlace('Alex', 'home', { x: 12, y: 64, z: -7 }, 'overworld');
const note = memory.rememberNote('Alex', 'I prefer cherry planks');
memory.recordGoal({ kind: 'craft', item: 'chest', count: 1, request: 'Jev craft a chest', from: 'Alex', status: 'complete' });
const context = { registry: require('minecraft-data')('26.1'), players: ['Alex'], memory: memory.context('Alex'),
  speakerPosition: { x: 10, y: 64, z: 0 }, botPosition: { x: 30, y: 64, z: 0 }, dimension: 'overworld' };
const examples = [
  { request: 'Jev remember this as the north mine', kind: 'memory', operation: 'remember_place', label: 'north mine' },
  { request: 'Jev I prefer small houses', kind: 'memory', operation: 'remember_note' },
  { request: 'Jev what wood do I like?', kind: 'memory', operation: 'recall', targetId: note.id },
  { request: 'Jev return to our base at home', kind: 'visit' },
  { request: 'Jev where is home?', kind: 'memory', operation: 'recall', targetId: home.id },
  { request: 'Jev forget my wood preference', kind: 'memory', operation: 'forget', targetId: note.id },
  { request: 'Jev make another one like last time', kind: 'craft', item: 'chest', count: 1 },
  { request: 'Jev get me two oak logs', kind: 'obtain', item: 'oak_log', count: 2 },
  { request: 'Jev do not remember this as home', kinds: ['other', 'clarify'] },
  { request: 'Jev what do you remember?', kind: 'memory', operation: 'recall', targetId: 'all' },
  { request: 'Jev get me 2 of my favorite planks', kind: 'obtain', item: 'cherry_planks', count: 2 },
];
(async () => {
  const service = new TypeSafe(); let failed = 0;
  for (const [index, example] of examples.entries()) {
    const started = Date.now(); let spec;
    const calls = [], client = { systemOne: async args => { const result = await service.systemOne(args); calls.push({ state: args.state, questions: args.questions, result }); return result; } };
    try {
      spec = await interpret(client, example.request, 'Alex', 'Jev', context);
      fs.writeFileSync(path.join(directory, `${index}.json`), JSON.stringify({ example, spec, calls }, null, 2));
      if (example.kinds) assert(example.kinds.includes(spec.kind)); else assert.equal(spec.kind, example.kind);
      for (const field of ['operation', 'targetId', 'label']) if (example[field]) assert.equal(spec.memory?.[field], example[field]);
      for (const field of ['item', 'count']) if (example[field]) assert.equal(spec[field], example[field]);
      if (spec.kind === 'visit') assert.equal(spec.destination.id, home.id);
      console.log(JSON.stringify({ result: 'PASS', request: example.request, kind: spec.kind, elapsedMs: Date.now() - started }));
    } catch (error) { failed++; console.log(JSON.stringify({ result: 'FAIL', request: example.request, actual: spec?.kind, error: error.message })); }
  }
  console.log(JSON.stringify({ result: failed ? 'FAIL' : 'PASS', failed, directory })); process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
