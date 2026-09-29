'use strict';
// Note 691 (2): "none of these is good" at low health in a fight. On 25589
// (2026-09-29 21:18:09Z, 6.8 health, six blazes by a live spawner) Jev's top
// answer to encounter_stance was none_good at 0.18 and the code took the next
// by weight, break_spawner at 0.17, whose own words priced it at 9.6 damage
// in its first second and a half. The options and weights are the recorded
// ones (test/fixtures/none-good-stance-25589.json: each price as its words
// said it, the damage and the seconds it is over).
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickWhenNoneGood, EXPOSED_S } = require('../src/decisions');
const rec = require('./fixtures/none-good-stance-25589.json');

const listed = () => Object.fromEntries(Object.entries(rec.options).map(([k, o]) => [k, { description: o.said, ...(o.expects ? { expects: o.expects } : {}) }]));

test('the recorded frame: every priced stance takes the 6.8 health or more; the one that takes the least in the next seconds is taken, not the next by weight', () => {
  assert.deepEqual(rec.took, ['break_spawner'], 'the record: the next by weight was taken');
  const { key, why } = pickWhenNoneGood(listed(), rec.weights, rec.health);
  assert.notEqual(key, 'break_spawner');
  const tree = listed(), rate = k => tree[k].expects.damage * EXPOSED_S / Math.max(1, tree[k].expects.seconds);
  const priced = Object.keys(tree).filter(k => tree[k].expects);
  assert.equal(rate(key), Math.min(...priced.map(rate)));
  // Out of their sight or a stand, not a walk in on them.
  assert.ok(['corner_ambush', 'fight_at_spawner', 'back_to_wall', 'leave_and_heal', 'out_of_sight'].includes(key), key);
  assert.match(why, /every priced option takes the 6\.8 health the bot has or more/);
});

test('where a priced stance is under the health, the likeliest of those is taken: Jev\'s weights stand', () => {
  const tree = listed();
  const at20 = pickWhenNoneGood(tree, rec.weights, 20);
  // break_spawner (9.6) is under 20: the next by weight stands.
  assert.equal(at20.key, 'break_spawner'); assert.equal(at20.why, null);
  // At 12 health break_spawner's 9.6 is under it too.
  assert.equal(pickWhenNoneGood(tree, rec.weights, 12).key, 'break_spawner');
  // At 9 health break_spawner's 9.6 is more than the bot has: the likeliest under it.
  const at9 = pickWhenNoneGood(tree, rec.weights, 9);
  assert.equal(at9.key, 'fight_at_spawner');
  assert.match(at9.why, /break_spawner priced at the health the bot has or more/);
});

test('options with no price, or no health known: the next by weight, as before', () => {
  const plain = { a: { description: 'a' }, b: { description: 'b' } };
  assert.equal(pickWhenNoneGood(plain, { a: 0.2, b: 0.3 }, 3).key, 'b');
  assert.equal(pickWhenNoneGood(listed(), rec.weights, undefined).key, 'break_spawner');
});

test('decide: none_good at the recorded weights and health takes the least-harm stance and records the missing move with why', async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-')), 'missing.jsonl');
  const env = { NONE: process.env.JEV_NONE_GOOD, LOG: process.env.JEV_MISSING_OPTIONS };
  process.env.JEV_NONE_GOOD = '1'; process.env.JEV_MISSING_OPTIONS = log;
  try {
    const { decide } = require('../src/decisions');
    require('../src/decisions/survival');
    const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'none_good', confidence: 0.14, probabilities: rec.weights } } }) };
    const bot = { health: rec.health, food: rec.food, game: { dimension: 'the_nether' } };
    const r = await decide('encounter_stance', { client, bot, goal: null, tree: listed(), state: { health: rec.health } });
    assert.equal(r.noneGood, true);
    assert.notEqual(r.path[0], 'break_spawner');
    const entry = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').at(-1));
    assert.equal(entry.question, 'encounter_stance');
    assert.deepEqual(entry.tookInstead, r.path);
    assert.match(entry.tookBecause, /takes the least in the next 15 seconds/);
  } finally {
    if (env.NONE === undefined) delete process.env.JEV_NONE_GOOD; else process.env.JEV_NONE_GOOD = env.NONE;
    if (env.LOG === undefined) delete process.env.JEV_MISSING_OPTIONS; else process.env.JEV_MISSING_OPTIONS = env.LOG;
  }
});
