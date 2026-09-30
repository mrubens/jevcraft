'use strict';
// Note 749c: 25598's win_strategy asked 11 times in 36 s (14:14:47 to
// 14:15:23Z): the crossing kit asked for a second sound pickaxe, a stone one
// was made (131 uses) and the tidy threw it, keeping two iron ones of 247
// and 22 uses, so the kit asked again; and take_up_nether_chest was taken at
// 0.09 with none_good at 0.83, undone seven seconds later.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const decisions = require('../src/decisions');

test('the tidy keeps a pickaxe with the uses a spare needs before a better tier nearly worn out (25598, 14:14:57Z)', () => {
  const { spares } = require('../src/inventory-tidy');
  const max = n => registry.itemsByName[n].maxDurability;
  const iron = { name: 'iron_pickaxe', count: 1, durabilityUsed: max('iron_pickaxe') - 247 };
  const worn = { name: 'iron_pickaxe', count: 1, durabilityUsed: max('iron_pickaxe') - 22 };
  const stone = { name: 'stone_pickaxe', count: 1, durabilityUsed: 0 };
  const bot = { registry, inventory: { items: () => [iron, worn, stone], slots: [] } };
  assert.deepEqual(spares(bot), [worn], 'the 22-use iron one goes, the stone one with 131 stays');
  // As the crossing kit counts them: two sound.
  const kept = [iron, worn, stone].filter(i => !spares(bot).includes(i));
  const kit = require('../src/crossing-kit');
  assert.equal(kit.soundPickaxes({ registry, inventory: { items: () => kept } }).length, kit.PICKAXES_TAKEN);
});

const withNoneGood = async fn => {
  const env = { NONE: process.env.JEV_NONE_GOOD, LOG: process.env.JEV_MISSING_OPTIONS };
  process.env.JEV_NONE_GOOD = '1'; process.env.JEV_MISSING_OPTIONS = path.join(os.tmpdir(), `missing-749c-${process.pid}.jsonl`);
  const log = console.log; console.log = () => {};
  try { return await fn(); } finally {
    console.log = log;
    if (env.NONE === undefined) delete process.env.JEV_NONE_GOOD; else process.env.JEV_NONE_GOOD = env.NONE;
    if (env.LOG === undefined) delete process.env.JEV_MISSING_OPTIONS; else process.env.JEV_MISSING_OPTIONS = env.LOG;
  }
};
const recorded = { none_good: 0.83, take_up_nether_chest: 0.09, take_up_golden_boots: 0.04, take_up_diamond_sword: 0.02, side_trip: 0.02 };
const client = weights => ({ systemOne: async ({ questions }) => {
  const keys = Object.keys(questions.branch_0.criteria);
  return { answers: { branch_0: { choice: 'none_good', confidence: 0.77, probabilities: Object.fromEntries(keys.map(k => [k, weights[k] || 0])) } } };
} });

test('none good at twice the best listed or more: the option that changes nothing is taken where one is offered, and where none is the least bad is marked weak', async () => withNoneGood(async () => {
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, game: { dimension: 'overworld' }, inventory: { items: () => [] } };
  const tree = { take_up_golden_boots: { description: 'Take up the golden boots.' }, take_up_diamond_sword: { description: 'Take up the diamond sword.' }, take_up_nether_chest: { description: 'Take up the nether chest.' }, side_trip: { description: 'A side trip.' } };
  // As recorded: nothing that changes nothing on offer.
  const a = await decisions.decide('win_strategy', { client: client(recorded), bot, goal: { kind: 'win' }, tree, state: {} });
  assert.deepEqual(a.path, ['take_up_nether_chest']);
  assert.deepEqual(a.weakLeastBad, { key: 'take_up_nether_chest', p: 0.09, noneGood: 0.83 });
  // With the ladder's own stage on offer: that is taken, not the guess.
  const b = await decisions.decide('win_strategy', { client: client({ ...recorded, stage_reach_nether: 0.01 }), bot, goal: { kind: 'win' }, tree: { ...tree, stage_reach_nether: { description: 'Go on to the reach nether.', ladderNext: true } }, state: {} });
  assert.deepEqual(b.path, ['stage_reach_nether']);
  assert.match(b.passedOver, /none good at 0\.83 was twice the best listed or more \(take up nether chest 0\.09\): stage reach nether, which changes nothing, was taken rather than a guess/);
  assert.equal(b.weakLeastBad, undefined);
  // A close call is the least bad as before.
  const c = await decisions.decide('win_strategy', { client: client({ none_good: 0.44, stage_reach_nether: 0.33, take_up_nether_chest: 0.1 }), bot, goal: { kind: 'win' }, tree: { ...tree, stage_reach_nether: { description: 'Go on.', ladderNext: true } }, state: {} });
  assert.deepEqual(c.path, ['stage_reach_nether']);
  assert.equal(c.weakLeastBad, undefined);
}));

test('the stance keeps its own rule under none good (the body comes first)', async () => withNoneGood(async () => {
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, game: { dimension: 'overworld' }, inventory: { items: () => [] } };
  const d = await decisions.decide('encounter_stance', { client: client({ none_good: 0.8, fight: 0.1, keep_working: 0.05 }), bot, goal: { kind: 'win' }, tree: { fight: { description: 'Fight.' }, keep_working: { description: 'Keep working.' } }, state: {} });
  assert.deepEqual(d.path, ['fight']);
  assert.equal(d.weakLeastBad, undefined);
}));

test('a climb out is a trip: held through a stall\'s question and the rung\'s by what keeps it going, and at its own question until out, failed or a named change (25593 and 25584, 14:30 to 14:40Z)', () => {
  const intention = require('../src/intention');
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(10, 30, 10) }, health: 20, food: 20 };
  const goal = {};
  intention.after(bot, goal, 'climb_out', ['straight_up'], { target: { x: 10, y: 66, z: 10 } });
  assert.equal(goal.intention?.trip, 'its target');
  // The stall's question: only keep_on carries the climb on.
  const g = intention.gate(bot, goal, 'stillness_detour', { differently: { description: 'Differently.' }, work_free: { description: 'Work free.' }, keep_on: { description: 'Keep on.' }, until_rest_ends: { description: 'Other work.' } });
  assert.deepEqual(Object.keys(g.tree), ['keep_on']);
  assert.match(g.underWay, /^straight up \(climb out, to \(10, 66, 10\)\), chosen .*not offered while it holds: differently, work free, until rest ends$/);
  // The rung's question the same.
  const r = intention.gate(bot, goal, 'rung_progress', { keep_at_it: { description: 'Keep at it.' }, set_aside_rung: { description: 'Set it aside.' } });
  assert.deepEqual(Object.keys(r.tree), ['keep_at_it']);
  // Its own question with a new way on offer: the held way only.
  const own = intention.gate(bot, goal, 'climb_out', { straight_up: { description: 'Up.', target: { x: 10, y: 66, z: 10 } }, walk_then_up: { description: 'Walk then up.', target: { x: 14, y: 66, z: 10 } }, staircase: { description: 'Stairs.' } });
  assert.deepEqual(Object.keys(own.tree), ['straight_up']);
  // Out: arrived, and it ends.
  bot.entity.position = new Vec3(10, 66, 10);
  assert.equal(intention.holding(bot, goal), null);
  assert.equal(goal.intentionEnded.why, 'arrived');
});
