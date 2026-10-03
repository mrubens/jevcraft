'use strict';
// Note 989: with none good on top, a rung Jev set aside is not taken up
// again as the code's least bad.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { Vec3 } = require('vec3');

test('none good on top: take_up_<rung> is passed over for the best listed that takes nothing back; chosen outright it stands', async t => {
  const env = { NONE: process.env.JEV_NONE_GOOD, LOG: process.env.JEV_MISSING_OPTIONS };
  process.env.JEV_NONE_GOOD = '1'; process.env.JEV_MISSING_OPTIONS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-989-')), 'missing.jsonl');
  t.after(() => { for (const [k, v] of [['JEV_NONE_GOOD', env.NONE], ['JEV_MISSING_OPTIONS', env.LOG]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const { decide } = require('../src/decisions');
  const bot = { entity: { position: new Vec3(-53.5, 35, 42.5) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 20, food: 20, entities: {} };
  const tree = () => ({ take_up_bank_rods: { takesUp: 'bank_rods', description: 'Take up the bank rods again now.' }, keep_at_it: { description: 'Keep at the obtain blaze rods.' }, differently: { description: 'Another way.' } });
  const asked = probabilities => ({ systemOne: async () => ({ answers: { branch_0: { choice: Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0], confidence: 0.4, probabilities } } }) });
  const d = await decide('rung_progress', { client: asked({ none_good: 0.5, take_up_bank_rods: 0.27, keep_at_it: 0.14, differently: 0.09 }), bot, goal: { kind: 'win' }, tree: tree(), state: {} });
  assert.deepEqual(d.path, ['keep_at_it']);
  assert.match(d.passedOver, /take up bank rods takes up again what was set aside, and that is not taken for none good: keep at it/);
  const own = await decide('rung_progress', { client: asked({ take_up_bank_rods: 0.6, keep_at_it: 0.3, none_good: 0.1 }), bot, goal: { kind: 'win' }, tree: tree(), state: {} });
  assert.deepEqual(own.path, ['take_up_bank_rods'], 'Jev\'s own choice of it stands');
});
