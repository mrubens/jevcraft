'use strict';
// Note 765: every answer's run is checked for what it changed (position,
// what is carried, blocks dug or placed, health and hunger coming up, the
// dimension, the distance to its target). One that changed nothing, judged
// when its question comes back or once its own time has passed, is recorded
// failed in the ledger, its commitment ends, it is said at the next asking,
// and it is listed last from the same stall, resting once it has changed
// nothing there twice (src/decisions/outcome.js, src/tried.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const outcome = require('../src/decisions/outcome');
const commit = require('../src/decisions/commit');
const { decide, define } = require('../src/decisions');

const inventoryOf = counts => ({ items: () => Object.entries(counts).map(([name, count]) => ({ name, count })) });
// 25590 at 20:04:40Z: under seven blocks of sand, no pickaxe, cobblestone and a table carried, an oak log 11 blocks off.
const botAt = (x, y, z, counts = { cobblestone: 128, crafting_table: 2, birch_planks: 1 }) => ({ entity: { position: new Vec3(x, y, z) }, health: 20, food: 18, game: { dimension: 'overworld' }, inventory: inventoryOf(counts) });
const climbTree = exit => ({
  wood_first: { description: 'Make a pickaxe first: the nearest wood known is oak log 11 blocks off, 7 up; break 1 log, craft a stone pickaxe from the cobblestone carried at the crafting table carried: about 15 seconds there and back with the crafting; then the climb with it, about 20 seconds: about 30 seconds in all.', target: exit },
  staircase: { description: 'Dig a staircase up by hand: 7 blocks up, about 3 minutes with bare hands.', target: exit },
});
const answering = (seen, pick) => ({ systemOne: async ({ state, questions }) => { seen.push({ state, criteria: questions.branch_0.criteria, keys: Object.keys(questions.branch_0.criteria) }); const keys = Object.keys(questions.branch_0.criteria); return { answers: { branch_0: { choice: keys.includes(pick) ? pick : keys[0], confidence: 0.75 } } }; } });

test('the option\'s own time: "in all" first, then the first "about", a stance\'s price; ninety seconds at least, ten minutes at most', () => {
  assert.equal(outcome.statedMs(climbTree(null).wood_first), 90000, 'thirty seconds in all is under the floor');
  assert.equal(outcome.statedMs({ description: 'Walk there: about 4 minutes, then about 20 seconds of digging.' }), 240000);
  assert.equal(outcome.statedMs({ description: 'about 3 minutes in all, about 20 seconds a stair' }), 180000);
  assert.equal(outcome.statedMs({ description: 'x', expects: { seconds: 300, damage: 2 } }), 300000);
  assert.equal(outcome.statedMs({ description: 'nothing said' }), outcome.FLOOR_MS);
  assert.equal(outcome.statedMs({ description: 'about 40 minutes' }), outcome.CAP_MS);
});

test('what an answer changed: a block moved, anything carried, a block dug or placed, health or hunger up, another dimension; health falling is not the answer\'s doing', () => {
  const a = outcome.markOf(botAt(357.3, 56, 16.5), { x: 354, y: 63, z: 15 });
  assert.equal(outcome.effect(a, outcome.markOf(botAt(357.5, 56, 16.6))), null);
  assert.match(outcome.effect(a, outcome.markOf(botAt(360.3, 56, 16.5))), /^moved 3 blocks, \d+ blocks from its target \(8 when chosen\)$/);
  assert.match(outcome.effect(a, outcome.markOf(botAt(357.3, 56, 16.5, { cobblestone: 128, crafting_table: 2, birch_planks: 1, oak_log: 1 }))), /\+1 oak log/);
  const dug = botAt(357.3, 56, 16.5); dug._stalls = { marked: 1 };
  assert.equal(outcome.effect(a, outcome.markOf(dug)), 'a block was dug or placed');
  const hurt = botAt(357.3, 56, 16.5); hurt.health = 12;
  assert.equal(outcome.effect(a, outcome.markOf(hurt)), null);
  assert.match(outcome.nothingSays(a, outcome.markOf(hurt)), /health fell from 20 to 12$/);
  const nether = botAt(357.3, 56, 16.5); nether.game.dimension = 'the_nether';
  assert.equal(outcome.effect(a, outcome.markOf(nether)), 'went to the nether');
  assert.equal(outcome.markOf({ entity: { position: new Vec3(0, 0, 0) } }), null, 'no inventory to read: no mark, nothing judged');
});

test('25590\'s wood_first, asked live: the run that changed nothing is recorded failed and said, listed last from the same stall five blocks on, and rests at its second', async () => {
  const bot = botAt(357.3, 56, 16.5);
  const goal = { kind: 'win', gameProgress: { phase: 'iron_pickaxe' } };
  const seen = [];
  const client = answering(seen, 'wood_first');
  const exit = { x: 354, y: 63, z: 15 };
  const first = await decide('climb_out', { client, bot, goal, tree: climbTree(exit), state: { up: 7 } });
  assert.deepEqual(first.path, ['wood_first']);
  // The run came back in a fraction of a second, nothing broken, nothing carried, not a block moved.
  await decide('climb_out', { client: answering(seen, 'staircase'), bot, goal, tree: climbTree(exit), state: { up: 7 } });
  // Said once, in the words of note 724's rule where it speaks, with the failure recorded beside them.
  assert.match(seen[1].state.answerChangedNothing, /^wood first was chosen \d+ seconds? ago and changed nothing \(the bot on the same block, carrying the same, no block dug or placed, health as it was\).*; recorded as failed: listed last from here while the bot is within 16 blocks of where it was chosen and carries nothing new \(up to 10 minutes\), and not offered there once it has changed nothing twice\.$/);
  const entry = goal.tried.entries.find(e => e.q === 'climb_out' && e.method === 'wood_first');
  assert.equal(entry.outcome, 'blocked');
  assert.ok(entry.noop, 'marked as a run that changed nothing');
  assert.match(entry.why, /its run changed nothing within/);
  assert.deepEqual(seen[1].keys, ['staircase', 'wood_first'], 'not listed first again');
  assert.match(seen[1].criteria.wood_first, /came to nothing: .*its run changed nothing within .* Its run changed nothing; changing nothing again from about here, it rests\./);
  // Three minutes on, five blocks off, the exit it aims at moved six blocks: the same stall. Said and listed last,
  // where before it was offered as new; chosen again, it changes nothing again.
  for (const e of goal.tried.entries) { e.at -= 170000; if (e.settledAt) e.settledAt -= 170000; }
  // The staircase climbed meanwhile and was given up (its own intention ended, as the record's did).
  require('../src/intention').end(goal, 'the staircase came to rest');
  // The quick-return and repeat rules' own memories run on the clock the test does not wait out.
  delete bot._answers; delete bot._repeats; delete bot._unchanged;
  bot.entity.position = new Vec3(362.5, 56, 17.5);
  const exit2 = { x: 360, y: 63, z: 15 };
  await decide('climb_out', { client, bot, goal, tree: climbTree(exit2), state: { up: 7 } });
  assert.deepEqual(seen[2].keys, ['staircase', 'wood_first']);
  assert.match(seen[2].criteria.wood_first, /Tried once toward the same place from about here in the last 3 minutes, and it came to nothing: .*its run changed nothing within/);
  // Asked again with nothing changed: changed nothing twice from this stall, it is not offered; the staircase, the
  // one way left, is taken.
  const fourth = await decide('climb_out', { client, bot, goal, tree: climbTree(exit2), state: { up: 7 } });
  assert.deepEqual(fourth.path, ['staircase']);
  assert.equal(fourth.only, true);
  // Something new carried (a log broken on the way): it is offered again.
  bot.inventory = inventoryOf({ cobblestone: 128, crafting_table: 2, birch_planks: 1, oak_log: 1 });
  const seenAfter = [];
  await decide('climb_out', { client: answering(seenAfter, 'staircase'), bot, goal, tree: climbTree(exit2), state: { up: 7 } });
  assert.ok(seenAfter[0].keys.includes('wood_first'), 'carrying something new, the stall is not the same');
});

test('a run still going that has changed nothing in its own time is judged at the next question of any loop, and said at its own next asking', async () => {
  const bot = botAt(10.5, 64, 10.5);
  const goal = { kind: 'win' };
  const seen = [];
  await decide('climb_out', { client: answering(seen, 'staircase'), bot, goal, tree: climbTree({ x: 12, y: 70, z: 10 }), state: { up: 6 } });
  // Its three minutes pass with nothing dug, nothing moved.
  bot._outcome.climb_out.at -= 181000;
  for (const e of goal.tried.entries) e.at -= 181000;
  if (goal.intention) goal.intention.at -= 181000;
  const failed = outcome.sweep(bot, goal);
  assert.equal(failed.length, 1);
  assert.match(failed[0].says, /^staircase was chosen 3 minutes ago and changed nothing in its own time, 3 minutes: the bot on the same block/);
  assert.equal(goal.tried.entries.find(e => e.method === 'staircase').outcome, 'blocked');
  await decide('climb_out', { client: answering(seen, 'wood_first'), bot, goal, tree: climbTree({ x: 12, y: 70, z: 10 }), state: { up: 6 } });
  assert.match(seen[1].state.answerChangedNothing, /^staircase was chosen .* changed nothing .*; recorded as failed: listed last from here/);
  assert.match(goal.tried.entries.find(e => e.method === 'staircase').why, /its run changed nothing in its own time, 3 minutes: the bot on the same block, carrying the same, no block dug or placed, still 6 blocks from its target/);
  assert.equal(goal.intention?.choice, 'wood_first', 'the climb held as the intention ended failed, and the other way was offered');
  assert.match(goal.intentionEnded?.why || '', /^failed: .*its run changed nothing in its own time/);
});

test('what is not judged: a run that moved, a wait declared as one, a keep-on answer, a run cut short by the survival layer', async () => {
  const bot = botAt(0.5, 64, 0.5);
  const goal = { kind: 'win' };
  const seen = [];
  await decide('climb_out', { client: answering(seen, 'staircase'), bot, goal, tree: climbTree(null), state: {} });
  bot.entity.position = new Vec3(2.5, 65, 0.5);
  await decide('climb_out', { client: answering(seen, 'staircase'), bot, goal, tree: climbTree(null), state: {} });
  assert.equal(seen[1].state.answerChangedNothing, undefined);
  assert.equal(goal.tried.entries.filter(e => e.noop).length, 0);
  // Declared: the catalogue's wait, a node's own changesNothing, a keep-on.
  assert.match(outcome.waitWhy(require('../src/decisions').question('survival_priority'), 'rest_to_heal', {}), /a wait/);
  assert.equal(outcome.waitWhy({ id: 'x' }, 'stand', { changesNothing: 'a wait for the furnace, meant to change nothing' }), 'a wait for the furnace, meant to change nothing');
  assert.match(outcome.waitWhy({ id: 'upkeep' }, 'carry_on', {}), /keeps on/);
  // Cut short: the ledger's entry says so, and nothing is recorded failed.
  bot.entity.position = new Vec3(4.5, 66, 0.5);
  await decide('climb_out', { client: answering(seen, 'staircase'), bot, goal, tree: climbTree(null), state: {} });
  require('../src/tried').cut(goal, 'a zombie within 4 blocks');
  await decide('climb_out', { client: answering(seen, 'staircase'), bot, goal, tree: climbTree(null), state: {} });
  assert.equal(goal.tried.entries.filter(e => e.noop).length, 0);
});

test('a commitment whose answer changed nothing ends so, and the next asking says how', () => {
  const bot = botAt(0.5, 64, 0.5);
  const goal = { kind: 'win', tried: { entries: [] } };
  const spec = { id: 'night_mine_target', commit: { until: { threats: true } }, options: [] };
  const tree = { ore_0: { description: 'Iron ore 6 blocks off, about 20 seconds.', target: { x: 6, y: 64, z: 0 } } };
  commit.after(bot, goal, spec, ['ore_0'], tree.ore_0, tree);
  outcome.begin(bot, goal, spec, ['ore_0'], tree.ore_0);
  assert.ok(commit.holding(bot, 'night_mine_target'));
  const j = outcome.judge(bot, goal, 'night_mine_target', { asked: true });
  assert.ok(j.failed);
  assert.equal(commit.holding(bot, 'night_mine_target'), null);
  const c = commit.before(bot, goal, spec, tree);
  assert.match(c.ended, /ended: it changed nothing within \d+ seconds? \(its own time 90 seconds\); asked afresh$/);
});

test('a held answer keeps the mark of the answer it carries on, and is judged by its time, not at each poll', () => {
  const bot = botAt(0.5, 64, 0.5);
  const goal = { kind: 'win', tried: { entries: [] } };
  const spec = { id: 'upkeep', options: [] };
  outcome.begin(bot, goal, spec, ['wood_reserve'], { description: 'Get wood.' });
  const at = bot._outcome.upkeep.at;
  outcome.begin(bot, goal, spec, ['wood_reserve'], { description: 'Get wood.' }, { held: true });
  assert.equal(bot._outcome.upkeep.at, at);
  assert.equal(outcome.judge(bot, goal, 'upkeep', { asked: false }), null, 'within its time, a poll judges nothing');
});

test('the rule over 25590\'s five wood_first answers (20:04 to 20:19Z): the second said and listed last, the third and fourth kept off, the fifth a new stall in time', () => {
  // As scripts/zero-delta.js reads them from the flight record: each a run that changed nothing, judged when
  // climb_out came back ten seconds later.
  const t0 = Date.parse('2026-09-30T20:04:40.517Z');
  const kinds = ['crafting_table', 'cobblestone', 'birch_planks'];
  const answers = [[0, 357.3, 56, 16.5], [169833, 362.5, 56, 17.5], [341332, 360.3, 56, 11.5], [510343, 354.5, 56, 11.3], [850529, 346.7, 58, 8.5]]
    .map(([dt, x, y, z]) => ({ t: t0 + dt, id: 'climb_out', key: 'wood_first', place: { x, y, z }, kinds, dimension: 'overworld', failed: true, exempt: false, sameStall: 16 }));
  const { said, kept } = outcome.replay(answers);
  assert.deepEqual(said.map(a => a.t - t0), [169833]);
  assert.deepEqual(kept.map(a => a.t - t0), [341332, 510343]);
  // Ten minutes after the second no-op the stall's record has gone by: asked about as new, said once more.
  assert.equal(answers.length - kept.length, 3);
});

test('a question says where a no-op bears, and a wait declared says so', () => {
  const base = { area: 'survival', kind: 'survival', primitive: 'choice', stakes: 'low', tree: true, parent: null, question: 'q?', trigger: 't', source: 's' };
  assert.throws(() => define({ ...base, id: 'note_765_bad_stall', sameStall: 0, options: [{ key: 'a', label: 'a', when: 'always' }] }), /a sameStall that is a number of blocks/);
  assert.throws(() => define({ ...base, id: 'note_765_bad_wait', options: [{ key: 'stay', wait: true, label: 'stay put', when: 'always' }] }), /declared a wait, to say so/);
  assert.equal(require('../src/decisions').question('unstuck_move').sameStall, 1, 'a move bears on the cell it was tried from');
});
