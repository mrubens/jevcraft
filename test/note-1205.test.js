'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { Vec3 } = require('vec3');

test('in a pocket, none good on top takes staying, which changes nothing, not leaving (note 1205)', async t => {
  const env = { NONE: process.env.JEV_NONE_GOOD, LOG: process.env.JEV_MISSING_OPTIONS };
  process.env.JEV_NONE_GOOD = '1'; process.env.JEV_MISSING_OPTIONS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-1205-')), 'missing.jsonl');
  t.after(() => { for (const [k, v] of [['JEV_NONE_GOOD', env.NONE], ['JEV_MISSING_OPTIONS', env.LOG]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const { decide } = require('../src/decisions');
  const bot = { entity: { position: new Vec3(-19.5, 59, 47.5) }, game: { dimension: 'overworld', gameMode: 'survival' }, inventory: { items: () => [] }, health: 11, food: 15, entities: {}, time: { timeOfDay: 15000 } };
  const asked = probabilities => ({ systemOne: async () => ({ answers: { branch_0: { choice: 'none_good', confidence: 0.3, probabilities } } }) });
  const tree = () => ({ leave: { description: 'Leave the pocket.' }, stay: { description: 'Stay sealed in.' }, go_for_food: { description: 'Go for food.' } });
  const d = await decide('pocket_next', { client: asked({ none_good: 0.29, leave: 0.26, stay: 0.21, go_for_food: 0.24 }), bot, goal: { kind: 'win' }, tree: tree(), state: {} });
  assert.deepEqual(d.path, ['stay']);
  assert.match(d.passedOver, /stay, which changes nothing, was taken rather than a guess/);
  // A listed answer on top is taken as it is.
  const real = { systemOne: async () => ({ answers: { branch_0: { choice: 'leave', confidence: 0.6, probabilities: { leave: 0.6, stay: 0.3, none_good: 0.1 } } } }) };
  const other = { ...bot, entity: { position: new Vec3(200.5, 59, 47.5) } };
  assert.deepEqual((await decide('pocket_next', { client: real, bot: other, goal: { kind: 'win' }, tree: tree(), state: {} })).path, ['leave']);
});
