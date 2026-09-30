'use strict';
// mid-243-af-nether-3-fortress-5 (25586), 17:31 to 18:42Z on 2026-09-28: 71 minutes of a bot with no pickaxe and
// no block carried, digging by hand toward the portal back and then toward the crimson stems it needed for a
// pickaxe, and back, "loop: flipping cross_toward <-> find_fortress" (note 629).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const tried = require('../src/tried');
const { groundBot } = require('./fixtures/saved-ground');
const fixture = require('./fixtures/tunnels-mid-243-af-nether-3-fortress-5.json');

const PORTAL = { x: 3, y: 42, z: 8 };
const STEMS = { x: -178, y: 72, z: -112 };
const tunnelBot = (x = -176.5, items = [['oak_planks', 4], ['crafting_table', 1]]) => groundBot(fixture, { at: new Vec3(x, 66, -112.5), dimension: 'the_nether', health: 9.5, food: 14, items });

// The rung's ten minutes are minutes: a pass that is one await of four and a half minutes (a crossing dug by hand)
// was counted as thirty seconds, and 16.8 minutes between two new bests were about 9 to the rung's clock.
test('the rung\'s ten minutes count a long pass as long as it lasted, within one run; after a restart the first look credits thirty seconds', t => {
  const T0 = Date.parse('2026-09-28T18:02:50Z');
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const bot = { entity: { position: new Vec3(-142, 66, -137) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 9.5, food: 14 };
  const goal = { kind: 'win', request: 'beat the game', from: 'TestPlayer', rungTime: { phase: 'obtain_blaze_rods' }, gameProgress: { phase: 'obtain_blaze_rods', milestones: {} }, survival: {} };
  const at = min => t.mock.timers.setTime(T0 + min * 60000);
  assert.equal(tried.watchRung(bot, goal), null, 'the record begins');
  at(0.5); assert.equal(tried.watchRung(bot, goal), null);
  // Passes of 4.6, 4.4 and 1.5 minutes: 10.5 minutes since the record began, none of it a new best.
  at(5.1); assert.equal(tried.watchRung(bot, goal), null);
  at(9.5); assert.equal(tried.watchRung(bot, goal), null);
  assert(goal.tried.rung.idleMs >= 9 * 60000, `${goal.tried.rung.idleMs} ms counted of about ${9.5 * 60000}`);
  at(11); const due = tried.watchRung(bot, goal);
  assert(due, 'ten minutes without a new best: the rung\'s question is due');
  assert.match(due.says, /^\d+ minutes on the obtain blaze rods without a new best/);

  // The same gaps after a restart (a new bot in the same goal): the first look credits thirty seconds at most.
  const fresh = { entity: bot.entity, game: bot.game, inventory: bot.inventory, health: 9.5, food: 14 };
  const g2 = JSON.parse(JSON.stringify(goal));
  g2.tried.rung.idleMs = 0; g2.tried.rung.lastAt = T0; g2.tried.rung.bestAt = T0; g2.tried.rung.asked = 0;
  at(70); assert.equal(tried.watchRung(fresh, g2), null);
  assert.equal(g2.tried.rung.idleMs, 30000, 'an hour of downtime is thirty seconds');
});

test('a gap that began in a wait something was bringing to an end credits nothing to the rung', t => {
  const T0 = Date.parse('2026-09-28T18:02:50Z');
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const bot = { entity: { position: new Vec3(0, 64, 0) }, game: { dimension: 'overworld', gameMode: 'survival' }, inventory: { items: () => [] }, health: 20, food: 20 };
  const goal = { kind: 'win', request: 'beat the game', from: 'TestPlayer', rungTime: { phase: 'obtain_blaze_rods' }, gameProgress: { phase: 'obtain_blaze_rods', milestones: {} }, survival: {} };
  const at = min => t.mock.timers.setTime(T0 + min * 60000);
  tried.watchRung(bot, goal);
  at(1); tried.watchRung(bot, goal, { waiting: 'asleep' });
  const before = goal.tried.rung.idleMs;
  at(6); tried.watchRung(bot, goal);
  assert.equal(goal.tried.rung.idleMs, before, 'five minutes that began asleep are not the rung\'s');
});

// A walk toward a place is judged by how near it came: the answer that took the bot along its own tunnel to where
// an earlier answer had ended came to nothing.
test('a walk toward the crimson stems that ends where an earlier one ended is not getting somewhere: it rests after two, said', t => {
  const T0 = Date.parse('2026-09-28T18:12:31Z');
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const bot = { entity: { position: new Vec3(-145.5, 66, -112.5) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 9.5, food: 14 };
  const goal = { kind: 'win', step: { action: 'nether_gather' }, gameProgress: { phase: 'obtain_blaze_rods' } };
  const tree = () => ({
    walk_to_1: { description: 'Go to the crimson stems on foot.', target: STEMS },
    cross_to_1: { description: 'Go to the crimson stems straight across at this height.', target: STEMS },
    leg_west: { description: 'Search west.' },
    without: { description: 'Go on without the stone pickaxe.' },
  });
  const offered = Object.entries(tree()).map(([key, o]) => ({ key, ...(o.target ? { target: o.target } : {}) }));
  const walkTo = (x, secs = 25) => { t.mock.timers.tick(secs * 1000); bot.entity.position = new Vec3(x, 66, -112.5); };
  // The recorded round: the crossing east takes the bot back to x -145, the gather walks to the stems again.
  const round = () => {
    bot.entity.position = new Vec3(-145.5, 66, -112.5);
    const e = tried.begin(bot, goal, { q: 'nether_gather', method: 'cross_to_1', target: STEMS, offered });
    walkTo(-176.5);
    tried.settle(bot, goal, { q: 'nether_gather' });
    return e;
  };
  const first = round();
  assert.equal(first.outcome, 'progressed', 'the first walk to the stems came nearer than anything before it');
  assert.match(first.gained, /^moved 31 blocks/);
  const second = round();
  assert.equal(second.outcome, 'blocked', 'the same walk again, to where the first ended, is not');
  assert.match(second.why, /^ended 6 blocks from it, no nearer than the 6 an answer toward it reached/);
  const third = round();
  assert.equal(third.outcome, 'blocked');
  // The ledger's summary no longer says three of three got somewhere, and the way rests from here.
  const said = tried.summary(goal, { now: Date.now() })[0];
  assert.match(said, /cross to 1 toward \(-178, 72, -112\), 3 times, 1 of them getting somewhere, 2 coming to nothing/);
  bot.entity.position = new Vec3(-145.5, 66, -112.5);
  const read = tried.read(bot, goal, 'nether_gather', tree(), { now: Date.now() });
  assert.equal(read.tree.cross_to_1, undefined, 'left out while other ways are on offer');
  assert.equal(read.tree.walk_to_1, undefined, 'the walk to the same stems from here is the same failure: left out too');
  assert(read.tree.leg_west && read.tree.without, 'the others stay');
  assert.match(read.resting.find(r => /^cross to 1/.test(r)), /^cross to 1: Tried 2 times toward the same place from about here in the last .* ended 6 blocks from it, no nearer than the 6 an answer toward it reached/);
  assert.match(read.resting.find(r => /^walk to 1/.test(r)), /^walk to 1: Tried 2 times toward the same place from about here/);
  // Toward another place, or from somewhere else, nothing rests.
  assert(tried.read(bot, goal, 'nether_gather', { walk_to_2: { description: 'x', target: { x: -176, y: 44, z: -88 } }, without: { description: 'y' } }, { now: Date.now() }).tree.walk_to_2, 'another place');
  bot.entity.position = new Vec3(-20.5, 66, -112.5);
  assert(tried.read(bot, goal, 'nether_gather', tree(), { now: Date.now() }).tree.walk_to_1, 'from a hundred blocks away');
});

test('a walk toward a place that comes nearer than any before is getting somewhere, and one that moved and came no nearer but carried more still is (a block dug is not)', t => {
  const T0 = Date.parse('2026-09-28T18:12:31Z');
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const bot = { entity: { position: new Vec3(-119.5, 66, -112.5) }, game: { dimension: 'the_nether', gameMode: 'survival' }, inventory: { items: () => [] }, health: 9.5, food: 14 };
  const goal = { kind: 'win', step: { action: 'nether_gather' }, gameProgress: { phase: 'obtain_blaze_rods' } };
  const go = (from, to) => {
    bot.entity.position = new Vec3(from, 66, -112.5);
    const e = tried.begin(bot, goal, { q: 'nether_gather', method: 'cross_to_1', target: STEMS });
    t.mock.timers.tick(20000); bot.entity.position = new Vec3(to, 66, -112.5);
    tried.settle(bot, goal, { q: 'nether_gather' });
    return e;
  };
  assert.equal(go(-119.5, -150.5).outcome, 'progressed');
  const nearer = go(-140.5, -176.5);
  assert.equal(nearer.outcome, 'progressed', 'from 38 blocks off to 6 is nearer than 28');
  assert.equal(nearer.reached, 6.2);
  // No nearer, and a block was dug in a cell not dug in the last ten minutes: a block dug is not the rung's measure (note 646),
  // and the walk ended where the first did.
  bot._stalls = { marked: 0 };
  bot.entity.position = new Vec3(-140.5, 66, -112.5);
  const dug = tried.begin(bot, goal, { q: 'nether_gather', method: 'walk_to_1', target: STEMS });
  t.mock.timers.tick(20000); bot._stalls.marked = 1; bot.entity.position = new Vec3(-176.5, 66, -112.5);
  tried.settle(bot, goal, { q: 'nether_gather' });
  assert.equal(dug.outcome, 'blocked', 'a block dug is not something gained on the rung');
  assert.match(dug.why, /nothing gained on the rung/);
  // No nearer, but what the step was for was carried at the end of it: that is.
  goal.step = { action: 'nether_gather', item: 'crimson_stem' };
  bot.entity.position = new Vec3(-140.5, 66, -112.5);
  const carriedMore = tried.begin(bot, goal, { q: 'nether_gather', method: 'walk_to_1', target: STEMS });
  t.mock.timers.tick(20000); bot.entity.position = new Vec3(-176.5, 66, -112.5);
  bot.inventory = { items: () => [{ name: 'crimson_stem', count: 3 }] };
  tried.settle(bot, goal, { q: 'nether_gather' });
  bot.inventory = { items: () => [] };
  assert.equal(carriedMore.outcome, 'progressed');
  assert.match(carriedMore.gained, /3 more crimson stem/);
  // Brought from afar (a respawn, a long errand) and ending farther than the best of before is still ground made.
  bot._stalls = { marked: 1 };
  bot.entity.position = new Vec3(-320.5, 66, -112.5);
  const afar = tried.begin(bot, goal, { q: 'nether_gather', method: 'cross_to_1', target: STEMS });
  t.mock.timers.tick(60000); bot.entity.position = new Vec3(-250.5, 66, -112.5);
  tried.settle(bot, goal, { q: 'nether_gather' });
  assert.equal(afar.outcome, 'progressed', '142 blocks off to 73, from far from where the best was reached');
});

// The way back to the portal was said as "148 blocks off, about 34 seconds at a walk", the ground on the straight
// line seen; the gathering question said the crossing did not reach it, the food trip never did.
test('the trip back to the portal says where the crossing straight at it ends and whether it reaches, with what is carried', () => {
  const { portalTrip } = require('../src/game-progress');
  const bot = tunnelBot(-161.5);
  const goal = { portals: [{ ...PORTAL, dimension: 'nether' }] };
  const says = portalTrip(bot, goal);
  assert.match(says, /^The nearest portal remembered is 204 blocks off/);
  assert.match(says, /Straight across at y 66, crouched: 109 cells, 48 of rock to dig \(dug by hand, no pickaxe being carried: netherrack so dug drops nothing/);
  assert.match(says, /where lava or water behind the netherrack stops it\. 0 blocks carried/);
  assert.match(says, /With what is carried that crossing stops \d+ blocks short of it\./);
  // Where the crossing does get there, nothing is said against it.
  const near = require('../src/nether-gather').reachSays(bot, new Vec3(-140, 66, -113));
  assert.match(near, /^Straight across at y 66, crouched: 21 cells, all open ground/);
  assert.doesNotMatch(near, /stops \d+ blocks short/);
});

// The crossing walked first at every pass, 32 cells over the bot's own tunnel, and only then gave the turn to the
// pickaxe's wood: from the stems' foot it went 30 blocks east along z -113 each time, the way to the stems asked from
// there, and the stems were never taken.
test('a stretch of the crossing that ends no nearer than the bot has come to the portal is not walked: the way on is the pickaxe\'s', async () => {
  const { crossToward } = require('../src/nether-travel');
  const bot = tunnelBot(-176.5);
  const goal = { survival: {} };
  const saved = [];
  const at = () => bot.entity.position.toString();
  const start = at();
  const skipped = await crossToward(bot, new Task('cross'), goal, () => saved.push(goal.step?.action), new Vec3(PORTAL.x, PORTAL.y, PORTAL.z), { what: 'the portal back', beat: 148 });
  assert.equal(skipped.tried, false);
  assert.match(skipped.madeAlready, /^a crossing straight at the portal back would go 32 blocks and end 191 blocks from it, no nearer than the 148 the bot has already come$/);
  assert.equal(goal.step, undefined, 'no step begun, nothing walked');
  assert.equal(at(), start);
  assert.deepEqual(saved, []);
});

test('walking to a known portal with no pickaxe from the stems\' foot goes to the wood and not into the crossing', async () => {
  const { walkToKnownPortal } = require('../src/work');
  const bot = tunnelBot(-176.5);
  bot.pathfinder.goto = async () => { throw new Error('No path to the goal!'); };
  bot.pathfinder.setGoal = () => {};
  const goal = { kind: 'win', survival: {}, portals: [{ ...PORTAL, dimension: 'nether' }], portalApproach: { '3,42,8': { best: 148 } } };
  const steps = [];
  // The way on is asked first, toward the portal beside the pickaxe's wood
  // (note 751b); the pickaxe chosen, the wood is gone for.
  const task = new Task('back'), asked = [];
  task.opportunityClient = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); const keys = Object.keys(questions.branch_0.criteria); return { answers: { branch_0: { choice: keys.includes('pickaxe_first') ? 'pickaxe_first' : keys[0], confidence: 0.9 } } }; } };
  await assert.rejects(walkToKnownPortal(bot, task, goal, () => steps.push(goal.step?.action), 'nether'), /crimson stems/);
  assert(asked[0]?.pickaxe_first, 'pickaxe_first offered');
  assert(!asked[0].dig_across, 'no crossing that ends no nearer than the bot has come');
  assert(!steps.includes('cross_toward'), `the crossing was not begun: ${[...new Set(steps)].join(', ')}`);
  assert(steps.includes('nether_gather'), 'the pickaxe\'s wood was gone for');
});

// The stall's crossing was "where the work was going", whatever the work: the stems the pickaxe is made of are what
// the gathering was going to.
test('the stall\'s crossing option names the place the gathering was going to', () => {
  const { netherAnswers } = require('../src/nether-travel');
  const bot = tunnelBot(-145.5);
  const goal = { survival: {}, step: { action: 'nether_gather', what: 'the crimson stems at (-178, 72, -112)', target: STEMS } };
  const answers = netherAnswers(bot, new Task('stall'), goal, () => {});
  assert.match(answers.cross_toward.description, /^Go straight at the crimson stems at \(-178, 72, -112\), 33 blocks off and 6 blocks up at the height the bot stands/);
  const other = netherAnswers(bot, new Task('stall'), { survival: {}, step: { action: 'mine', target: STEMS } }, () => {});
  assert.match(other.cross_toward.description, /^Go straight at where the work was going, 33 blocks off/);
});
