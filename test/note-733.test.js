'use strict';
// Note 733: win_strategy held its answer no longer than the tree's own
// shape, which changes regime with the ladder's default stage (rung_* keys
// while the default is a rung itself; stage_*, nether_first and the side
// trips once it moves past the preparation ladder). A rung Jev put ahead of
// the ladder's own default runs its own crafts (a table, a stone pickaxe),
// which the ladder's next call reads afresh with nextGameStage, and that
// read can land on either regime independent of anything the chosen rung
// itself did. 25585 (mid-242-vc, artifacts/critic/critic-20260930T0733Z.md
// item 4, 07:25 to 07:31Z) was asked win_strategy six times in six minutes,
// its answer swinging between rung_nether_pickaxe, rung_nether_food,
// nether_first and stage_reach_nether with small crafts between (a table, a
// stone pickaxe, planks, a stone pickaxe again), the portal 52 to 51 blocks
// off the whole time (read with scripts/trials/recent.js and the flight
// record .bot-state/flight/127_0_0_1-25585-Jev-2026-09-30T06-52-13-004Z.jsonl):
//   07:25:43 iron leggings   -> rung_nether_pickaxe
//   07:25:51 iron leggings   -> rung_nether_food     (8s later, same stage)
//   07:28:06 iron leggings   -> nether_first
//   07:28:14 nether pickaxe  -> rung_nether_pickaxe
//   07:28:18 reach nether    -> stage_reach_nether    (4s later)
//   07:30:57 nether pickaxe  -> rung_nether_pickaxe
//   07:31:04 reach nether    -> stage_reach_nether    (7s later)
// Four of those six asks (07:25:51, 07:28:18, 07:31:04) came seconds after
// the one before, with the ladder's own default stage the only thing that
// had moved. Fixed here at the rule level (src/strategy.js): a rung answer
// now holds on the rung itself (game-progress.js openRungs), not on the
// tree's keys or the ladder's own stage.phase, so it survives the regime
// flip a craft causes; it still gives way the moment a rung neither open
// nor known when it was answered opens up (note 709), or the one held
// finishes, is set aside, or ten minutes pass regardless. Re-asked, the
// facts say what was chosen, how long ago, and what it brought, and every
// other option says it would reverse a rung still open with nothing
// decided about it since.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { strategyStep, HOLD_MS } = require('../src/strategy');
const { Task } = require('../src/skills');

const GEAR = ['white_bed', 'diamond_pickaxe', 'iron_sword', 'diamond_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots', 'bow'].map(name => ({ name, count: 1 })).concat({ name: 'arrow', count: 16 });
function fixture(without = []) {
  let items = GEAR.filter(i => !without.includes(i.name));
  const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), game: { dimension: 'overworld', gameMode: 'survival' },
    health: 20, food: 20, isAlive: true, entities: {}, time: { timeOfDay: 1000 }, entity: { position: new Vec3(.5, 64, .5) }, inventory: { items: () => items } });
  const goal = { version: 1, kind: 'win', request: 'beat the game' };
  return { bot, goal, task: new Task('win'), setItems: v => { items = v; } };
}
// A stand-in for Jev: each ask answers with the next of `plan`, in order.
function scripted(plan) {
  const asked = [];
  let i = 0;
  return { asked, decide: async (id, args) => { asked.push({ tree: args.tree, state: args.state }); const choice = plan[Math.min(i, plan.length - 1)]; i++; return { path: [choice] }; } };
}

test('a rung put ahead of the ladder holds through the regime flip a craft causes, not asked again on every small craft (25585, note 733)', async () => {
  // The two rungs 25585 had open together: the ladder's own default (here,
  // golden_boots, standing for iron_leggings) and one further down it
  // (diamond_sword, standing for nether_pickaxe) that Jev put first.
  const { bot, goal, task, setItems } = fixture(['golden_boots', 'diamond_sword']);
  const said = []; bot.chat = line => said.push(line);
  const { asked, decide } = scripted(['rung_diamond_sword', 'rung_golden_boots']);
  let now = 1e12;
  const stage = { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 };
  const first = await strategyStep(bot, task, goal, () => {}, stage, { decide, now: () => now });
  assert.equal(first.stage.phase, 'diamond_sword', 'put ahead of the ladder\'s own default');
  assert.equal(goal.strategy.rungPhase, 'diamond_sword');
  assert.equal(asked.length, 1);

  // The small craft: something carried changes (a table, a stone pickaxe),
  // and the very next call is asked with a completely different stage - the
  // ladder's own default moved off golden_boots onto the rung just chosen,
  // as nextGameStage reads fresh every tick and knows nothing of the
  // override strategy.js gave it a moment before. Before this fix, that
  // alone (the tree's regime: rung_* keys against stage_* ones) broke the
  // hold and win_strategy was asked again mid-craft.
  now += 4000;
  setItems(GEAR.filter(i => !['golden_boots', 'diamond_sword'].includes(i.name)).concat({ name: 'crafting_table', count: 1 }));
  const second = await strategyStep(bot, task, goal, () => {}, { phase: 'diamond_sword', action: 'acquire', item: 'diamond_sword', count: 1 }, { decide, now: () => now });
  assert.equal(second, null, 'already the rung in force: no stage override needed');
  assert.equal(asked.length, 1, 'held: the diamond sword is still open and nothing new is on offer');

  // And the regime flips again, back to the original default's own shape:
  // still held.
  now += 4000;
  const third = await strategyStep(bot, task, goal, () => {}, stage, { decide, now: () => now });
  assert.equal(third.stage.phase, 'diamond_sword');
  assert.equal(asked.length, 1, 'held across the regime flipping back too');

  // The rung finishes (the sword now carried): the next ask is fresh, and
  // it is not held past that.
  now += 4000;
  setItems(GEAR.filter(i => i.name !== 'golden_boots'));
  const fourth = await strategyStep(bot, task, goal, () => {}, stage, { decide, now: () => now });
  assert.equal(asked.length, 2, 'asked again once the held rung finished');
  assert.equal(fourth, null, 'the ladder\'s own default is worked directly now');
  // The last answer's fact was said, not asked blind: what was chosen, how
  // long ago, and that it finished.
  assert.match(asked[1].state.lastStrategy, /^rung diamond sword was chosen 12 seconds ago: the diamond sword finished\.$/);
});

test('a new rung opening up that was not known when the answer was given still asks again (note 709 kept)', async () => {
  const { bot, goal, task, setItems } = fixture(['golden_boots', 'diamond_sword']);
  const { asked, decide } = scripted(['rung_diamond_sword']);
  let now = 1e12;
  const stage = { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 };
  await strategyStep(bot, task, goal, () => {}, stage, { decide, now: () => now });
  assert.equal(asked.length, 1);
  // Dusk falls mid-hold and the bow is lost with it: a rung neither open
  // nor known at the answer (bow sits after golden_boots on the ladder, so
  // golden_boots stays rungs[0] and this is not just the ladder's own
  // default reordering), so it is not folded into what was already
  // weighed.
  now += 4000;
  bot.time.timeOfDay = 13000;
  setItems(GEAR.filter(i => !['golden_boots', 'diamond_sword', 'bow'].includes(i.name)));
  await strategyStep(bot, task, goal, () => {}, stage, { decide, now: () => now });
  assert.equal(asked.length, 2, 'a genuinely new rung asks again, even though diamond_sword is still open');
});

test('held past ten minutes with the rung still open is priced as a reversal when Jev switches away from it', async () => {
  const { bot, goal, task } = fixture(['golden_boots', 'diamond_sword']);
  const said = []; bot.chat = line => said.push(line);
  const { asked, decide } = scripted(['rung_diamond_sword', 'rung_golden_boots']);
  let now = 1e12;
  const stage = { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 };
  await strategyStep(bot, task, goal, () => {}, stage, { decide, now: () => now });
  assert.equal(goal.strategy.choice, 'rung_diamond_sword');
  now += HOLD_MS + 1000;
  const logs = [];
  const origLog = console.log; console.log = (...a) => logs.push(a.join(' '));
  try { await strategyStep(bot, task, goal, () => {}, stage, { decide, now: () => now }); }
  finally { console.log = origLog; }
  assert.equal(asked.length, 2, 'asked again after ten minutes regardless');
  // The rung held (diamond_sword) was still open and nothing was decided
  // about it: every other option said it would reverse it, and Jev's own
  // switch away from it (to rung_golden_boots) is logged as a reversal.
  assert.match(asked[1].tree.rung_golden_boots.description, /This would reverse rung diamond sword, chosen 10 minutes ago: diamond sword is still open, nothing decided about it since\./);
  assert(!/This would reverse/.test(asked[1].tree.rung_diamond_sword?.description || ''), 'the rung itself is not tagged as reversing itself');
  assert.ok(logs.some(l => /^\[strategy\] reversal: rung_golden_boots \(golden boots\) chosen over rung diamond sword, with diamond sword still open/.test(l)), logs.join('\n'));
});
