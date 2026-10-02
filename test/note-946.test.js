'use strict';
// Note 946: on the bank's walk out with rods the stems were taken off the
// upkeep (note 899). 25595 (mid-243-ia-fortress-5, 2026-10-02 21:51 and
// 21:58Z), two rods, no pickaxe, 151 to 363 blocks from its portal and
// crimson stems a block off, was offered only the portal for wood or carry
// on. The stems are offered, with the way home against them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { groundBot } = require('./fixtures/saved-ground');
const { Task } = require('../src/skills');

const DELTA = require('./fixtures/basalt-delta-mid-243-cg.json');
const KIT = [['blaze_rod', 2], ['iron_ingot', 30], ['iron_sword', 1], ['cooked_beef', 6]];

async function asked(portalAt) {
  const { upkeepStep } = require('../src/work');
  const bot = groundBot(DELTA, { at: new Vec3(-20.7, 101, -18.5), health: 18, food: 18, dimension: 'the_nether', held: 'iron_sword', items: KIT });
  let offered = null;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'carry_on', confidence: 0.7 } } }; } };
  const goal = { kind: 'win', step: { action: 'return_to_portal' }, rodBank: { at: Date.now() - 60000 }, portals: [{ ...portalAt, dimension: 'nether' }] };
  await upkeepStep(bot, new Task('work'), goal, () => {}, client);
  return offered;
}

test('on the bank\'s walk with rods and no pickaxe, the stems are offered with the portal\'s distance and the tunnel by hand against with a pickaxe', async () => {
  const far = await asked({ x: -20, y: 70, z: 280 });
  assert.ok(far?.fetch_stems, `offered: ${far && Object.keys(far)}`);
  assert.match(far.fetch_stems, /This is on the bank's walk out with 2 rods carried: the portal is 299 blocks off; no pickaxe is carried: the tunnel home through the rock is about 25 minutes by hand against about 7 minutes with one/);
  // Near the portal: the same facts, small.
  const near = await asked({ x: -20, y: 101, z: -2 });
  assert.match(near.fetch_stems, /the portal is 17 blocks off; .* about 1 minute by hand against about 1 minute with one/);
});
