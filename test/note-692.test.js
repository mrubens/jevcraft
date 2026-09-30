'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { groundBot, registry } = require('./fixtures/saved-ground');

// mid-242-gf-fortress-1 (25585), 21:01 to 21:36Z on 2026-09-29 (note 692):
// the bot walked one line at y 41 from x 897 to 944 under its fortress,
// whose floor (944, 66, 74) stands 26 up over the line's east end, with no
// pickaxe, no wood and no blocks. The ground as its region files had it at
// about 21:45Z: a basalt delta, netherrack in patches, one gravel in reach.
const GROUND = require('./fixtures/fortress-under-25585.json');
const FOOD = [['cooked_mutton', 7], ['mutton', 7], ['beef', 2], ['porkchop', 4]];
const PORTALS = [{ x: -9, y: 72, z: 41, dimension: 'overworld' }, { x: 4, y: 50, z: 13, dimension: 'nether' }];
const FLOOR = new Vec3(944, 66, 74);

function underBot({ at = new Vec3(943.5, 41, 73.5), items = FOOD } = {}) {
  const bot = groundBot(GROUND, { at, items: items.map(i => [...i]), dimension: 'the_nether', indexed: true });
  bot.entities = {}; bot.players = {};
  return bot;
}
function jevStub(picks) {
  const asked = [];
  return { asked, systemOne: async ({ kind, state, questions }) => {
    const criteria = questions.branch_0.criteria;
    asked.push({ kind, state, options: criteria });
    const pick = picks.find(p => criteria[p]) || Object.keys(criteria).find(k => k !== 'none_good');
    return { answers: { branch_0: { choice: pick, confidence: 0.9 } } };
  } };
}
const noIntention = t => { process.env.JEV_INTENTION = '0'; t.after(() => { delete process.env.JEV_INTENTION; }); };
const noPath = async () => { const e = new Error('No path to the goal!'); throw e; };

async function approachAsked(bot, { picks = ['keep_searching'], actions = {} } = {}) {
  const { approachFortress } = require('../src/mob-hunt');
  const goal = { kind: 'win', portals: PORTALS, fortressSearch: { legs: 42, since: Date.now() - 157 * 60000 } };
  const client = jevStub(picks);
  const went = [];
  await approachFortress(bot, new Task('hunt'), goal, () => {}, { client, navigate: noPath, tunnel: async () => {}, dig: async () => {}, mineAt: async () => {}, acquireStep: async () => false,
    returnOverworld: async () => { went.push('home'); }, ...actions }, goal.fortressSearch, FLOOR, []);
  const asked = client.asked.find(a => a.options.keep_searching);
  return { goal, asked, went };
}

test('under its fortress with no pickaxe, wood or blocks: what a hand gets here is said, and the trip home is offered as what it fixes, with the walks back\'s record (25585, note 692)', async t => {
  noIntention(t);
  const bot = underBot();
  const { asked, went } = await approachAsked(bot, { picks: ['return_for_blocks'] });
  assert(asked, 'the way in was asked');
  const { options, state } = asked;
  assert.equal(state.fortress.height, 26, 'the floor is 26 up, not the pier\'s bricks 2 down');
  assert.match(state.byHand, /^Nothing dug by hand within 16 blocks drops a block that can be laid: rock is dug by hand, netherrack about 2 s, basalt about 6\.25 s, blackstone about 7\.5 s, nether bricks about 10 s a block by hand, dropping nothing \(the game's rule: rock drops only to a pickaxe\), and no soul sand, soul soil or wart block can be dug from ground walked to here/);
  assert.equal(state.pillar, undefined, 'no pillar to be had here at all');
  assert.match(options.return_for_blocks, /^Go back through the portal \(the nearest known \d+ blocks off at 4, 50, 13\) for a pickaxe, blocks and wood: every way on here needs one of them\. Here a hand gets no block: netherrack dug by hand drops nothing; a span or pillar needs blocks \(0 carried\); a pickaxe needs wood \(none carried\)\. /);
  assert.match(options.return_for_blocks, /Walks back like this made 17 to 30 blocks a minute \(about 31 to 55 minutes\); of 181 over 60 blocks, 22 came out, 18 died/);
  assert.equal(options.blocks_then_pillar, undefined, 'nothing here to pillar with');
  assert.equal(options.pillar_up, undefined, 'no block carried');
  assert.deepEqual(went, ['home'], 'taken, it goes home');
});

test('with a pickaxe and six blocks under a floor 26 up: dig the blocks for the pillar here first, then pillar (25581\'s case, note 692)', async t => {
  noIntention(t);
  const bot = underBot({ items: [...FOOD, ['stone_pickaxe', 1], ['netherrack', 6]] });
  const { asked } = await approachAsked(bot);
  const { options, state } = asked;
  assert.match(options.pillar_up, /they run out 6 up/);
  assert.match(options.blocks_then_pillar, /^Mine \d+ blocks? for a pillar here first, from the \d+ that can be dug from ground walked to from here \(/);
  assert.match(options.blocks_then_pillar, /Then pillar straight up 26 blocks to the fortress floor's height with them \(6 carried and 20 dug\), /);
  assert.equal(options.return_for_blocks, undefined, 'a pickaxe is carried: the trip home is the leg\'s, not the way in\'s');
  assert.equal(state.byHand, undefined);
});

test('a hand gets soul sand: dug by hand for the pillar, said as dropping where netherrack does not (note 692)', () => {
  const bs = require('../src/block-stock');
  const bot = underBot();
  // Soul sand laid round the feet, on the basalt floor.
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 2]]) bot.changed.set(`${943 + dx},41,${73 + dz}`, 'soul_sand');
  const hand = bs.handGather(bot);
  assert(hand.n >= 1, JSON.stringify(hand.found));
  assert.match(hand.says, /^By hand here: rock is dug by hand, netherrack about 2 s.*dropping nothing.*what a hand does get is \d+ soul sand/);
});

test('a leg that ends at the same place twice rests fifteen minutes from anywhere short of it, said with where and why (25585\'s east and west legs, note 692)', async () => {
  const { netherGather } = require('../src/nether-gather');
  const bot = underBot({ at: new Vec3(897.5, 41, 73.5) });
  const goal = { kind: 'win', portals: PORTALS, gameProgress: { phase: 'obtain_blaze_rods' },
    landmarks: [{ kind: 'warped_forest', x: 677, y: 39, z: -100, biome: true, dimension: 'nether', firstAt: Date.now(), seenAt: Date.now() }] };
  // The leg east walks to the basalt past x 943 and ends there, nearer each time.
  const navigate = async () => { bot.entity.position = new Vec3(943.5, 41, 73.5); };
  // With no other step of the game open, going on without is said, not
  // offered (note 695): the leg east is here the one way, taken unasked.
  let failed = null;
  const ask = async picks => { const client = jevStub(picks); failed = null; await netherGather(bot, new Task('work'), goal, () => {}, 'warped_stem', { navigate, client, forItem: 'wooden_pickaxe' }).catch(e => { failed = e; }); return client.asked.at(-1); };
  // A leg of 46 blocks takes its seconds: the stub walks it at once, so the
  // answer is aged as walked (an answer ended within two seconds rests, note 695).
  const walked = () => { const e = goal.tried?.entries?.at(-1); if (e) e.at -= 15000; };
  for (let i = 0; i < 2; i++) {
    bot.entity.position = new Vec3(897.5, 41, 73.5);
    const asked = await ask(['leg_east']); walked();
    assert(!asked || asked.options.leg_east, `leg east offered the ${i ? 'second' : 'first'} time`);
  }
  assert.equal(goal.gatherEnds.filter(e => e.key === 'leg_east').length, 2);
  bot.entity.position = new Vec3(912.5, 41, 73.5);
  const asked = await ask(['without']);
  assert.equal(asked?.options?.leg_east, undefined, 'short of the place it ends, the leg east is not offered');
  const closed = asked ? asked.state.legsClosed.join('\n') : String(failed?.message);
  assert.match(closed, /leg east: ended at the same place, \(944, 41, 74\), 2 times in the last 1 minute \(.+\); it goes no further from here, so it rests 15 more minutes/);
  // Past it, or a quarter hour on, it is offered again.
  const { sameEnd, END_REST_MS } = require('../src/nether-gather');
  const ahead = e => e.x >= 912;
  assert(sameEnd(goal, 'leg_east', ahead));
  assert.equal(sameEnd(goal, 'leg_east', ahead, Date.now() + END_REST_MS + 1000), null);
  assert.equal(sameEnd(goal, 'leg_west', () => true), null);
});

test('the fortress kept as a brick of its pier is said with its nearest floor (25585, note 692)', () => {
  const { takeBackPlace } = require('../src/work');
  const bot = underBot();
  const goal = { fortressSearch: { approach: { found: { x: 944, y: 66, z: 74 } } }, landmarks: [{ kind: 'nether_fortress', x: 946, y: 39, z: 74, dimension: 'nether' }] };
  assert.match(takeBackPlace(bot, goal, 'obtain_blaze_rods').says, /its nearest floor seen is \d+ blocks? off and 26 up/);
});

test('taken, the pillar\'s blocks are dug here first, as many as the pillar wants, then it pillars (note 692)', async t => {
  noIntention(t);
  const bot = underBot({ items: [...FOOD, ['stone_pickaxe', 1], ['netherrack', 6]] });
  const inv = bot.inventory.items(), mined = [];
  const mineAt = async (b, task, goal, save, p, name) => {
    mined.push(`${p}`); bot.changed.set(`${p.x},${p.y},${p.z}`, 'air');
    inv.find(i => i.name === 'netherrack').count++;
  };
  const navigate = async (b, task, g) => { if (Number.isFinite(g.x) && Number.isFinite(g.y)) bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); };
  const pillared = [];
  const pr = require('../src/pillar-recovery');
  t.mock.method(pr, 'pillarUp', async (b, task, y) => { pillared.push(y); return 26; });
  const { asked } = await approachAsked(bot, { picks: ['blocks_then_pillar'], actions: { mineAt, navigate } });
  assert(asked.options.blocks_then_pillar);
  assert.equal(mined.length, 20, 'the 20 the pillar wants past the 6 carried');
  assert.equal(inv.find(i => i.name === 'netherrack').count, 26);
  assert.deepEqual(pillared, [67], 'then up to the floor\'s height');
});

// mid-242-dd-fortress-24 (25581), 21:07 to 21:16Z: on a pier's top at
// (-114, 47, 147), the fortress's floor (-116, 74, 149) 27 up, 6 blocks and
// an iron pickaxe carried, 146 netherrack to be dug round it; offered a
// pillar that ran out 6 up, a level crossing and a staircase that ended "came
// no nearer" in a second, it left the fortress twice (note 692).
test('on a pier under the floor with a pickaxe: the staircase that gains no step is said, not offered, and the pillar\'s blocks dug here first are (25581, note 692)', async t => {
  noIntention(t);
  const { approachFortress } = require('../src/mob-hunt');
  const bot = groundBot(require('./fixtures/fortress-pier-25581.json'), { at: new Vec3(-113.5, 47, 147.5), items: [['iron_pickaxe', 1], ['netherrack', 6], ['cooked_beef', 11]], dimension: 'the_nether', indexed: true });
  bot.entities = {}; bot.players = {};
  const goal = { kind: 'win', portals: [{ x: -19, y: 71, z: 19, dimension: 'nether' }], fortressSearch: { legs: 8 } };
  const client = jevStub(['keep_searching']);
  await approachFortress(bot, new Task('hunt'), goal, () => {}, { client, navigate: noPath, tunnel: async () => {}, dig: async () => {}, mineAt: async () => {}, acquireStep: async () => false, returnOverworld: async () => {} }, goal.fortressSearch, new Vec3(-116, 73, 149), []);
  const { options, state } = client.asked.find(a => a.options.keep_searching);
  assert.equal(options.tunnel, undefined);
  assert.match(state.staircase, /^the staircase is not offered: no step toward it can be dug from here \(no floor to step onto/);
  assert.match(options.pillar_up, /they run out 6 up/);
  assert.match(options.blocks_then_pillar, /^Mine 21 blocks for a pillar here first, from the \d+ that can be dug from ground walked to from here \(.*netherrack/);
  assert.equal(options.return_for_blocks, undefined, 'a pickaxe is carried');
});
