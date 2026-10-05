'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { Vec3 } = require('vec3');

test('at a stall\'s detour, none good at twice the best listed is another way from here, not the listed way that leaves (note 1252)', async t => {
  const env = { NONE: process.env.JEV_NONE_GOOD, LOG: process.env.JEV_MISSING_OPTIONS };
  process.env.JEV_NONE_GOOD = '1'; process.env.JEV_MISSING_OPTIONS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-1252-')), 'missing.jsonl');
  t.after(() => { for (const [k, v] of [['JEV_NONE_GOOD', env.NONE], ['JEV_MISSING_OPTIONS', env.LOG]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const { decide } = require('../src/decisions');
  const bot = { entity: { position: new Vec3(-140.5, 70, 80.5) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 20, food: 18, entities: {}, time: { timeOfDay: 6000 } };
  const asked = probabilities => ({ systemOne: async () => ({ answers: { branch_0: { choice: 'none_good', confidence: 0.3, probabilities } } }) });
  const tree = () => ({ pearls_overworld: { description: 'Go back to the Overworld for the pearls.' }, pearls_barter: { description: 'Barter for them.' }, differently: { description: 'Another way at it from here.' }, work_free: { description: 'Work free.' } });
  const d = await decide('stillness_detour', { client: asked({ none_good: 0.40, pearls_overworld: 0.15, pearls_barter: 0.12, differently: 0.11, work_free: 0.1 }), bot, goal: { kind: 'win' }, tree: tree(), state: {} });
  assert.deepEqual(d.path, ['differently']);
});

test('at the rung\'s stall question, none good at twice the best works free of the terrain where that is offered, before keep_at_it (note 1285)', async t => {
  process.env.JEV_NONE_GOOD = '1';
  const { decide } = require('../src/decisions');
  const bot = { entity: { position: new Vec3(1883.5, 63, -367.5) }, game: { dimension: 'overworld', gameMode: 'survival' }, inventory: { items: () => [] }, health: 20, food: 17, entities: {}, time: { timeOfDay: 1000 } };
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'none_good', confidence: 0.4, probabilities: { none_good: 0.54, keep_at_it: 0.15, differently: 0.12, work_free: 0.1 } } } }) };
  const tree = { keep_at_it: { description: 'Keep at it.' }, differently: { description: 'Another way.' }, work_free: { description: 'Work free of the terrain.' } };
  const d = await decide('rung_progress', { client, bot, goal: { kind: 'win' }, tree, state: {} });
  assert.deepEqual(d.path, ['work_free']);
});
