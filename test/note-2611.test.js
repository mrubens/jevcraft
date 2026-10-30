'use strict';
// Note 2611: pearl_order's rods_first hands the work to the ladder's rods rung
// and is not judged by the ledgers (handsOff, note 1962's rule).
// mid-full-162-fortress-1 (25586, 2026-10-30 23:38Z), a second after joining
// beside its fortress, had 'rods first was chosen 1 second ago and changed
// nothing within 1 second ... recorded failed', then 'barter gold, the only way
// offered' and dug for gold under the fortress with 7 rods owed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

const answering = pick => ({ systemOne: async ({ questions }) => {
  const choice = pick(questions.branch_0.criteria);
  return { answers: { branch_0: { choice, confidence: 0.6, probabilities: { [choice]: 0.6 } } } };
} });
const bot = () => ({ entity: { position: new Vec3(80, 73, -105) }, game: { dimension: 'the_nether', gameMode: 'survival' },
  inventory: { items: () => [] }, health: 20, food: 20, entities: {}, _stalls: { records: {}, marks: [], marked: 0 } });

test('rods_first is marked hands-off, and chosen it leaves no tried entry and no outcome watch', async () => {
  const { decide } = require('../src/decisions');
  require('../src/decisions/work');
  const po = require('../src/pearl-order');
  const b = bot(), goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, step: { action: 'find_fortress' } };
  const tree = { rods_first: { ladderNext: true, handsOff: true, description: 'Go on with the rods now.' }, barter_gold: { description: 'Barter gold with the piglins for pearls.' } };
  const d = await decide('pearl_order', { client: answering(() => 'rods_first'), bot: b, goal, tree, state: {} });
  assert.deepEqual(d.path, ['rods_first']);
  assert.equal((goal.tried?.entries || []).filter(e => e.q === 'pearl_order').length, 0, 'no rung-ledger entry for the hand-off');
  assert.equal(b._outcome?.pearl_order, undefined, 'no outcome watch on the hand-off');
  // The live option carries the flag.
  const src = require('node:fs').readFileSync(require.resolve('../src/pearl-order'), 'utf8');
  assert.match(src, /out\.rods_first = \{ ladderNext: true, handsOff: true,/);
  assert.ok(po);
});
