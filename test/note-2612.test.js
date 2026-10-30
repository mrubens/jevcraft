'use strict';
// Note 2612: JEV_DRILL_PREFER (a drill's measure of one tactic; never set in play) takes a preferred answer on offer over
// Jev's, said on the decision with Jev's own answer kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

const answering = pick => ({ systemOne: async ({ questions }) => {
  const choice = pick(questions.branch_0.criteria);
  return { answers: { branch_0: { choice, confidence: 0.6, probabilities: { [choice]: 0.6 } } } };
} });
const bot = () => ({ entity: { position: new Vec3(0, 64, 0) }, game: { dimension: 'the_nether', gameMode: 'survival' },
  inventory: { items: () => [] }, health: 20, food: 20, entities: {}, _stalls: { records: {}, marks: [], marked: 0 } });

test('the preferred key on offer is taken over Jev\'s answer; one not on offer changes nothing', async () => {
  const { decide } = require('../src/decisions');
  require('../src/decisions/work');
  const tree = { rods_first: { ladderNext: true, handsOff: true, description: 'Go on with the rods now.' }, barter_gold: { description: 'Barter gold with the piglins for pearls.' } };
  process.env.JEV_DRILL_PREFER = 'box_at_spawner,barter_gold';
  try {
    const d = await decide('pearl_order', { client: answering(() => 'rods_first'), bot: bot(), goal: { kind: 'win' }, tree, state: {} });
    assert.deepEqual(d.path, ['barter_gold']);
    assert.deepEqual(d.drillPrefer, { over: ['rods_first'] });
    process.env.JEV_DRILL_PREFER = 'box_at_spawner';
    const e = await decide('pearl_order', { client: answering(() => 'rods_first'), bot: bot(), goal: { kind: 'win' }, tree, state: {} });
    assert.deepEqual(e.path, ['rods_first']);
    assert.equal(e.drillPrefer, undefined);
  } finally { delete process.env.JEV_DRILL_PREFER; }
});
