'use strict';
// Trial note 750c: 25581 (mid-243-kc), 14:55:14-14:55:53Z on 2026-09-30,
// under its fortress's floor 27 up with an iron pickaxe and no blocks
// (critic-20260930T1501Z item 1).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { groundBot } = require('./fixtures/saved-ground');

// The ground as the fortress-stage checkpoint mid-243-kc-150523 had it.
const GROUND = require('./fixtures/fortress-over-25581-750c.json');
const BRICK = new Vec3(-254, 72, -249);
const kcBot = at => { const bot = groundBot(GROUND, { at, items: [['iron_pickaxe', 1], ['oak_planks', 3], ['stick', 2], ['coal', 20]], dimension: 'the_nether', indexed: true }); bot.entities = {}; bot.players = {}; return bot; };

test('at a gap\'s edge where no stair step has a floor, the staircase is offered from the floor beside, and its run steps back there first (25581 at 14:55:35Z, note 750c)', async () => {
  const { fortressApproaches } = require('../src/mob-hunt');
  const bot = kcBot(new Vec3(-247.3, 45, -242.3));
  const goal = { kind: 'win', fortressSearch: { legs: 12 }, portals: [] };
  const walks = [], tunnels = [];
  const actions = { navigate: async (b, t, g) => { walks.push({ x: g.x, y: g.y, z: g.z }); bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); }, tunnel: async (...a) => { tunnels.push(a[4]); }, dig: async () => {}, mineAt: async () => {}, acquireStep: async () => false };
  const { options, facts } = await fortressApproaches(bot, new Task('hunt'), goal, () => {}, actions, goal.fortressSearch, BRICK, [], { failed: [] });
  assert(options.tunnel, `offered: ${Object.keys(options).join(', ')}`);
  assert.match(options.tunnel.description, /^Dig a staircase through the rock toward the fortress, \d+ blocks off and 28 blocks up, from \(-248, 45, -242\), a step back onto the floor beside the bot \(from where it stands no step toward it has a floor: no floor to step onto \(a gap, for a span or a pillar\): \d+ of the steps nearer\)/);
  assert.equal(facts.staircase, undefined, 'not said as no staircase');
  await options.tunnel.run();
  assert.deepEqual(walks, [{ x: -248, y: 45, z: -242 }]);
  assert.equal(tunnels.length, 1);
  // Where a step from the cell stood in has a floor, the staircase is the plain one.
  const plain = await fortressApproaches(kcBot(new Vec3(-246.5, 45, -242.5)), new Task('hunt'), goal, () => {}, actions, goal.fortressSearch, BRICK, [], { failed: [] });
  assert.match(plain.options.tunnel.description, /^Dig a staircase through the rock toward the fortress, \d+ blocks off and 28 blocks up, a step at a time/);
});

test('with none good on top of the leg question under a fortress in view, a leg away is not taken as the least bad: the best listed that stays is (25581 at 14:55:53Z, note 750c)', async t => {
  const env = { NONE: process.env.JEV_NONE_GOOD, LOG: process.env.JEV_MISSING_OPTIONS };
  process.env.JEV_NONE_GOOD = '1'; process.env.JEV_MISSING_OPTIONS = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-750c-')), 'missing.jsonl');
  t.after(() => { for (const [k, v] of [['JEV_NONE_GOOD', env.NONE], ['JEV_MISSING_OPTIONS', env.LOG]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const { decide } = require('../src/decisions');
  const mkBot = () => ({ entity: { position: new Vec3(-247.3, 45, -242.3) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 20, food: 18, entities: {}, _stalls: { records: {}, marks: [] } });
  const bot = mkBot();
  const probabilities = { none_good: 0.33, leg_south: 0.28, return_for_blocks: 0.16, back_to_fortress: 0.14, leg_east: 0.09 };
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'none_good', confidence: 0.4, probabilities } } }) };
  const tree = () => ({ leg_east: { description: 'Search east.' }, leg_south: { description: 'Search south.' }, back_to_fortress: { description: 'Back to the fortress.' }, return_for_blocks: { description: 'Back through the portal for blocks.' } });
  const inView = { fortressInView: { leaving: 'The fortress at (-255, 71, -243) is 9 blocks across and 28 up from here, and stays the search\'s target unless leaving it is chosen.' } };
  const d = await decide('fortress_leg', { client, bot, goal: { kind: 'win' }, tree: tree(), state: inView });
  assert.deepEqual(d.path, ['return_for_blocks']);
  assert.match(d.passedOver, /leg south leaves the fortress, and leaving is not taken for none good: return for blocks, the best listed that does not, was taken/);
  // No fortress in view: a leg is a leg, taken as before.
  const d2 = await decide('fortress_leg', { client, bot: mkBot(), goal: { kind: 'win' }, tree: tree(), state: {} });
  assert.deepEqual(d2.path, ['leg_south']);
});
