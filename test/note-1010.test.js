'use strict';
// Note 1010: at upkeep, none good on top is carrying on, at any margin.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { Vec3 } = require('vec3');

test('upkeep answered none good takes carry_on, not the best errand listed; a stall\'s question keeps the least bad under twice', async t => {
  const env = { NONE: process.env.JEV_NONE_GOOD, LOG: process.env.JEV_MISSING_OPTIONS };
  process.env.JEV_NONE_GOOD = '1'; process.env.JEV_MISSING_OPTIONS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-1010-')), 'missing.jsonl');
  t.after(() => { for (const [k, v] of [['JEV_NONE_GOOD', env.NONE], ['JEV_MISSING_OPTIONS', env.LOG]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const { decide } = require('../src/decisions');
  const bot = { entity: { position: new Vec3(-19.5, 59, 47.5) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 17, food: 13, entities: {} };
  const asked = probabilities => ({ systemOne: async () => ({ answers: { branch_0: { choice: 'none_good', confidence: 0.4, probabilities } } }) });
  const up = () => ({ fetch_stems: { description: 'Fetch stems.' }, block_reserve: { description: 'Mine blocks.' }, carry_on: { description: 'Carry on.' } });
  const d = await decide('upkeep', { client: asked({ none_good: 0.46, fetch_stems: 0.27, carry_on: 0.2, block_reserve: 0.07 }), bot, goal: { kind: 'win' }, tree: up(), state: {} });
  assert.deepEqual(d.path, ['carry_on']);
  assert.match(d.passedOver, /over the best listed, and at upkeep that is carrying on/);
  const stall = () => ({ differently: { description: 'Another way.' }, keep_at_it: { description: 'Keep at it.' } });
  const s = await decide('rung_progress', { client: asked({ none_good: 0.46, differently: 0.3, keep_at_it: 0.24 }), bot, goal: { kind: 'win' }, tree: stall(), state: {} });
  assert.deepEqual(s.path, ['differently'], 'elsewhere the least bad stands under twice');
});
