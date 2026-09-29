'use strict';
// No pickaxe in the Nether, said where it bites (note 687): upkeep's
// carry_on says what the five minutes cannot do and ends at the first way
// that fails for want of a pickaxe; a way that digs is offered only where a
// hand digs it; the questions above lead with getting one; and two chat
// lines that said what was not so. The frames are 25589's upkeep at
// 20:08:20Z (mid-242-dd-fortress-22) and 25585's saved fortress map.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const frame = require('./fixtures/upkeep-no-pickaxe-25589.json');
const saved = require('./fixtures/fortress-map-25585.json');

function frameBot({ items = frame.inventory, position = frame.position, blockAt = null } = {}) {
  const stacks = Object.entries(items).map(([name, count]) => ({ name, count, type: registry.itemsByName[name]?.id ?? 0 }));
  return { registry, game: { gameMode: 'survival', dimension: 'the_nether' }, time: { timeOfDay: 3000 }, health: frame.health, food: frame.food,
    entity: { isInWater: false, position: new Vec3(position.x, position.y, position.z) }, entities: {}, inventory: { items: () => stacks },
    ...(blockAt ? { blockAt } : {}), findBlocks: () => [] };
}
const askedWith = pick => {
  const client = { asked: [], systemOne: async req => {
    const q = req.questions.branch_0;
    client.asked.push({ options: q.criteria, state: req.state });
    return { answers: { branch_0: { choice: q.criteria[pick] ? pick : Object.keys(q.criteria)[0], confidence: 0.7 } } };
  } };
  return client;
};

test('25589 at 20:08:20Z: carry_on says what the five minutes cannot do with no pickaxe, and the upkeep leads with getting one', async () => {
  const { upkeepStep } = require('../src/work');
  const bot = frameBot();
  const goal = { kind: 'win', step: { ...frame.step } };
  const client = askedWith('carry_on');
  assert.equal(await upkeepStep(bot, { check() {} }, goal, () => {}, client), false, 'carried on');
  const { options, state } = client.asked[0];
  assert(options.fetch_stems, `offered: ${Object.keys(options)}`);
  // The recorded words said only "see to this later; asked again in five minutes".
  assert.match(frame.options.carry_on, /^Carry on with the find fortress and see to this later; asked again in five minutes, or sooner if what is due here changes\.$/);
  assert.match(options.carry_on, /or a way chosen fails for want of a pickaxe\. No pickaxe is carried: the next 5 minutes cannot dig or stair through basalt, blackstone or nether bricks, or pillar or span a gap; netherrack is dug by hand \(about 2 seconds a block\) and drops nothing\./);
  assert.match(JSON.stringify(state), /"situation":"No pickaxe is carried: fetch_stems gets one first\. Something the bot keeps/);
  assert.equal(goal.upkeepHold.noPickaxe, true);
  // Held: not asked again while the five minutes run and nothing failed.
  assert.equal(await upkeepStep(bot, { check() {} }, goal, () => {}, client), false);
  assert.equal(client.asked.length, 1);
});

test('the carry-on hold ends at the first way chosen that fails for want of a pickaxe, and the next asking says so', async () => {
  const { upkeepStep } = require('../src/work');
  const tried = require('../src/tried');
  const bot = frameBot();
  const goal = { kind: 'win', step: { ...frame.step } };
  const client = askedWith('carry_on');
  await upkeepStep(bot, { check() {} }, goal, () => {}, client);
  // A failure that is not for want of a pickaxe leaves the hold.
  tried.record(bot, goal, { q: 'fortress_approach', method: 'walk_route', outcome: 'blocked', why: 'No path to the goal!' });
  assert(goal.upkeepHold, 'held');
  // The staircase refused its bricks for the tool: the hold ends.
  tried.record(bot, goal, { q: 'fortress_approach', method: 'tunnel', outcome: 'blocked', why: 'No safe way toward (-147, 71, 97): no tool for nether bricks' });
  assert.equal(goal.upkeepHold, undefined);
  assert.equal(goal.upkeepHoldEnded.method, 'tunnel');
  await upkeepStep(bot, { check() {} }, goal, () => {}, client);
  assert.equal(client.asked.length, 2, 'asked again at once');
  assert.match(client.asked[1].options.carry_on, /The last carry-on ended early: tunnel failed for want of a pickaxe \(No safe way toward \(-147, 71, 97\): no tool for nether bricks\)\./);
  // A pickaxe carried: nothing ends a hold.
  const { pickaxeWanted } = require('../src/block-stock');
  goal.upkeepHold = { keys: 'x', until: Date.now() + 60000, noPickaxe: true, since: Date.now() - 1000 };
  const armed = frameBot({ items: { ...frame.inventory, wooden_pickaxe: 1 } });
  assert.equal(pickaxeWanted(armed, goal, { method: 'leg_east', why: 'out of blocks (0 carried)' }), false);
  assert.equal(pickaxeWanted(bot, goal, { method: 'leg_east', why: 'out of blocks (0 carried)' }), true);
});

test('with no pickaxe a leg stops at the first basalt, blackstone or bricks, and its rock is said by hand, not "with the tools carried"', () => {
  const { surveyLeg, legSays } = require('../src/nether-travel');
  const block = (name, p) => name === 'air' ? { name, position: p, boundingBox: 'empty' }
    : { name, position: p, boundingBox: 'block', hardness: registry.blocksByName[name].hardness, harvestTools: registry.blocksByName[name].harvestTools, digTime: () => 1000 * 5 * registry.blocksByName[name].hardness };
  // Netherrack for 10 cells east at the feet and head, then nether bricks; a floor under all of it.
  const at = p => p.y === 63 ? block('netherrack', p) : (p.y === 64 || p.y === 65) && p.x >= 1 ? block(p.x <= 10 ? 'netherrack' : 'nether_bricks', p) : block('air', p);
  const bot = frameBot({ position: { x: 0.5, y: 64, z: 0.5 }, blockAt: at });
  const survey = surveyLeg(bot, [1, 0], { cells: 32 });
  assert.equal(survey.rock, 10);
  assert.equal(survey.stoppedAt, 10);
  assert.match(survey.stoppedBy, /^nether bricks, which no hand digs \(no pickaxe carried\)$/);
  const says = legSays(survey, { direction: 'east', length: 96, y: 64 });
  assert.match(says, /10 of rock to dig \(about \d+(\.\d)? seconds a cell by hand, no pickaxe carried, dropping nothing, and nothing is seen from inside it\)/);
  assert.doesNotMatch(says, /with the tools carried/);
  // The same leg with a pickaxe digs the bricks.
  const armed = frameBot({ items: { stone_pickaxe: 1 }, position: { x: 0.5, y: 64, z: 0.5 }, blockAt: at });
  const dug = surveyLeg(armed, [1, 0], { cells: 32 });
  assert.equal(dug.stoppedAt, null);
  assert.match(legSays(dug, { direction: 'east', length: 96, y: 64 }), /seconds a cell with the pickaxe carried/);
});

test('a staircase with no pickaxe is offered only where a step toward it is dug by hand, and said so', () => {
  const { handWaySays, handDigs } = require('../src/block-stock');
  const bot = frameBot();
  const b = name => ({ name, boundingBox: 'block', hardness: registry.blocksByName[name].hardness, harvestTools: registry.blocksByName[name].harvestTools });
  assert.equal(handDigs(bot, b('netherrack')), true);
  for (const name of ['basalt', 'blackstone', 'nether_bricks']) assert.equal(handDigs(bot, b(name)), false, name);
  assert.equal(handDigs(bot, b('soul_sand')), true);
  const closed = handWaySays(bot, { gains: false, blocked: 'no tool for basalt' });
  assert.equal(closed.offered, false);
  assert.match(closed.says, /no pickaxe carried, and no step toward it can be dug by hand from here \(no tool for basalt\)/);
  const open = handWaySays(bot, { gains: true, steps: 30, seconds: 60, byHand: ['netherrack'] }, { steps: 30, handSeconds: 24, stopAt: null, stopName: null });
  assert.equal(open.offered, true);
  assert.match(open.says, /No pickaxe is carried: it digs by hand only rock softer than basalt, blackstone or nether bricks, dropping nothing \(about 24 seconds on the straight line to it\), and stops at the first of those\./);
  // Its line meets basalt two blocks along: not a way; twenty along: said where it stops.
  const near = handWaySays(bot, { gains: true }, { steps: 30, handSeconds: 2, stopAt: 2, stopName: 'basalt' });
  assert.equal(near.offered, false);
  assert.match(near.says, /basalt 2 blocks along the straight line to it, which no hand digs/);
  const far = handWaySays(bot, { gains: true }, { steps: 30, handSeconds: 40, stopAt: 20, stopName: 'nether bricks' });
  assert.equal(far.offered, true);
  assert.match(far.says, /the straight line to it meets nether bricks about 20 blocks along, which no hand digs: there it stops\./);
  assert.deepEqual(handWaySays(frameBot({ items: { iron_pickaxe: 1 } }), { gains: false }), { offered: true, says: '' });
});

test('"I\'m in the fortress" only on its floors: 25585 said it 44 blocks under them', () => {
  const { onFortressFloors } = require('../src/mob-hunt');
  const { stepLine } = require('../src/narration');
  const state = { map: saved.map };
  const under = frameBot({ position: saved.said.position });
  assert.equal(onFortressFloors(under, state), false);
  const [x, y, z] = Object.keys(saved.map.cells)[0].split(',').map(Number);
  assert.equal(onFortressFloors(frameBot({ position: { x: x + 0.5, y: y + 1, z: z + 0.5 } }), state), true);
  // The step off the floors carries no `walking`, and is said as heading for it.
  const { walking, ...step } = saved.said.step;
  assert(walking);
  assert.equal(stepLine({}, step), "A fortress! I'm heading for it.");
  assert.match(stepLine({}, saved.said.step), /in the fortress/, 'as it was said');
});

test('"I haven\'t found it yet" is not said of a fortress the stalled step has found, or the search knows', () => {
  const { friendlyProblem } = require('../src/speech');
  // 25590 at 20:08:04Z, 16 blocks from its fortress.
  const err = new Error('No measurable progress on {"action":"find_fortress","found":{"x":-147,"y":71,"z":97},"approach":"keep_searching","legs":28}');
  assert.equal(friendlyProblem(err), "I know where the fortress is, near -147, 97, but I'm not getting any closer to it.");
  const bare = new Error('No measurable progress on {"action":"find_fortress","legs":28}');
  assert.equal(friendlyProblem(bare, { known: { x: -119, y: 74, z: 120 } }), "I know where the fortress is, near -119, 120, but I'm not getting any closer to it.");
  assert.equal(friendlyProblem(bare), "I haven't found it yet. We may need to look farther away.");
});

test('fortress_leg with no pickaxe leads with getting one: its first fact what the ways lack, the ways to one first, the basalt legs and the staircase not offered', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { Task } = require('../src/skills');
  // 25585's ledge at y 36: basalt round it but a strip of floor east at the feet.
  const block = (name, p) => name === 'air' ? { name, position: p, boundingBox: 'empty', diggable: true }
    : { name, position: p, boundingBox: 'block', diggable: true, hardness: registry.blocksByName[name].hardness, harvestTools: registry.blocksByName[name].harvestTools, digTime: () => 1000 * 5 * registry.blocksByName[name].hardness };
  const at = p => p.y <= 35 ? block('basalt', p) : (p.z === 0 && p.x >= 0 && (p.y === 36 || p.y === 37)) ? block('air', p) : block('basalt', p);
  const bot = { ...frameBot({ items: { oak_planks: 12, crafting_table: 1 }, position: { x: 0.5, y: 36, z: 0.5 }, blockAt: at }), world: { raycast: () => null }, chat() {} };
  const client = askedWith('make_pickaxe');
  const goal = { kind: 'win', fortressSearch: { axis: 1, legs: 30 } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, acquireStep: async () => false, navigate: async () => {}, tunnel: async () => {} }).catch(() => {});
  assert.equal(client.asked.length >= 1, true);
  const { options, state } = client.asked[0];
  assert.equal(Object.keys(options)[0], 'make_pickaxe');
  assert(!options.seek_fortress_height, 'no staircase where no hand digs');
  assert(options.leg_east, 'the floor east');
  assert(!options.leg_north && !options.leg_west && !options.leg_south, `offered: ${Object.keys(options)}`);
  const facts = JSON.stringify(state);
  assert.match(facts, /^\{"withoutAPickaxe":"No pickaxe is carried: no basalt, blackstone or nether bricks is dug, no block comes back, and no block that holds is carried to span or pillar with; not offered for want of one: leg south; leg west; leg north; the staircase toward the fortress heights heading east\. make_pickaxe gets one first\."/);
  // Why each is closed is in legsClosed.
  assert.match(facts, /leg north: closed at the first cell at y 36, basalt, which no hand digs \(no pickaxe carried\)/);
  assert.match(facts, /the staircase toward the fortress heights heading east: no pickaxe carried, and basalt 2 blocks along the straight line to it, which no hand digs/);
});

test('wear is a fact before the pickaxe breaks: 25589\'s iron pickaxe, 117 uses to 3 in ten minutes on the search, said with its rate and whether another can be made', () => {
  const { wearOf, wearSays, lastPickaxeSays } = require('../src/pickaxe-budget');
  const max = registry.itemsByName.iron_pickaxe.maxDurability;
  let used = max - 117;
  const bot = frameBot({ items: { cobblestone: 0 } });
  const pick = { name: 'iron_pickaxe', count: 1, type: registry.itemsByName.iron_pickaxe.id, get durabilityUsed() { return used; } };
  bot.inventory = { items: () => [pick, { name: 'coal', count: 115, type: 1 }] };
  const goal = {};
  const t0 = Date.parse('2026-09-29T19:06:48Z');
  for (let m = 0; m <= 10; m++) { used = max - Math.round(117 - m * 11.4); wearOf(bot, goal, t0 + m * 60000); }
  const w = wearOf(bot, goal, t0 + 10 * 60000);
  assert.equal(w.uses, 3);
  assert(w.rate > 10 && w.lastsMinutes < 1, JSON.stringify(w));
  assert.match(wearSays(bot, goal, t0 + 10 * 60000), /^iron pickaxe, 3 uses left \(the only one carried\); \d+ used in the last 10 minutes, at which rate it lasts about 1 minute more; no other can be made from the pockets$/);
  // A leg digging 40 blocks with it.
  assert.match(lastPickaxeSays(bot, 40), /It digs about 40 blocks with the one pickaxe carried, 3 uses left, no other to be made from the pockets: it breaks on the way, the rest dug by hand and dropping nothing\./);
  // A new pickaxe starts the samples again.
  used = 0;
  assert.equal(wearOf(bot, goal, t0 + 11 * 60000).rate, null);
  // With the makings of another, the leg says nothing of it (the upkeep offers the spare).
  bot.inventory = { items: () => [pick, { name: 'iron_ingot', count: 3, type: 2 }, { name: 'crimson_stem', count: 2, type: 3 }] };
  assert.equal(lastPickaxeSays(bot, 40), '');
});

test('in the Nether with one pickaxe and the makings of another, the upkeep offers the spare with the wear; the spare is made beside the one carried', async () => {
  const { upkeepStep } = require('../src/work');
  const max = registry.itemsByName.wooden_pickaxe.maxDurability;
  const stacks = [{ name: 'wooden_pickaxe', count: 1, type: registry.itemsByName.wooden_pickaxe.id, durabilityUsed: max - 12 }, { name: 'crimson_planks', count: 8, type: registry.itemsByName.crimson_planks.id }, { name: 'crafting_table', count: 1, type: registry.itemsByName.crafting_table.id }];
  const bot = frameBot(); bot.inventory = { items: () => stacks };
  const goal = { kind: 'win', step: { action: 'find_fortress' } };
  const client = askedWith('spare_pickaxe');
  let made = null;
  const mh = require('../src/mob-hunt'), was = mh.makePickaxe;
  mh.makePickaxe = async (b, t, g, s, actions, pick) => { made = pick.item; stacks.push({ name: pick.item, count: 1, type: 0 }); return null; };
  try { await upkeepStep(bot, { check() {} }, goal, () => {}, client); } finally { mh.makePickaxe = was; }
  const { options } = client.asked[0];
  assert.match(options.spare_pickaxe, /^Make a wooden pickaxe now as a spare, from what is carried \(8 planks, a crafting table\), a few seconds at a crafting table: wooden pickaxe, 12 uses left \(the only one carried\); the pockets make another \(wooden pickaxe from 8 planks, a crafting table\)\. In the Nether rock is dug and blocks come back only with a pickaxe/);
  assert.equal(made, 'wooden_pickaxe');
});

test('an answer overtaken by other questions is not given their failure: 25585\'s return_for_blocks and the stems\' leg east', () => {
  const tried = require('../src/tried');
  const bot = frameBot();
  const goal = {};
  const t = Date.now();
  const home = tried.begin(bot, goal, { q: 'fortress_leg', method: 'return_for_blocks', now: t });
  tried.begin(bot, goal, { q: 'nether_gather', method: 'leg_east', now: t + 1000 });
  goal.lastFailure = { why: 'The leg east came no nearer: No route from here to (-61, 91) (noPath); it rests from here', at: t + 2000, by: tried.answerNow(goal) };
  tried.settle(bot, goal, { q: 'fortress_leg', now: t + 3000 });
  assert.equal(home.outcome, 'blocked');
  assert.doesNotMatch(home.why || '', /leg east/);
  // A failure under the answer's own question is its own: the way in under the leg's back_to_fortress.
  const g2 = {};
  const back = tried.begin(bot, g2, { q: 'fortress_leg', method: 'back_to_fortress', now: t });
  tried.begin(bot, g2, { q: 'fortress_approach', method: 'tunnel', now: t + 1000 });
  g2.lastFailure = { why: 'No safe way toward (-147, 71, 97): no tool for nether bricks', at: t + 2000, by: tried.answerNow(g2) };
  tried.settle(bot, g2, { q: 'fortress_leg', now: t + 3000 });
  assert.match(back.why || '', /no tool for nether bricks/);
});
