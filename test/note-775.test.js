'use strict';
// Note 775 (critic-20261001T0210Z.md item 1; 25589 mid-226-ac, 02:02 to
// 02:11Z on 2026-10-01): within seven blocks of (-541, 79, 725) in the Nether,
// every work step began with the walk back to a furnace at (73, 79, 493),
// 657 blocks off, where 3 raw iron had been left cooking twenty minutes
// before (while_cooking's leave_cooking, "or in 20 minutes wherever the bot
// is then"); "No route ... the way passes along a drop that would kill" 398
// times, the chat "I'll keep trying (attempt 5 ... 130)", relocations of two
// to four blocks that put it back on the same cell, the rise to y 96 said in
// passing inside work_free, and hoglin_pillar chosen twice with its own words
// saying the walk "found no way there".
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const ra = require('../src/route-aside');

const HERE = new Vec3(-541.5, 79, 725.5);
const FURNACE = { x: 73, y: 79, z: 493 };
const noRoute = (p = FURNACE) => Object.assign(new Error(`No route from here to (${p.x}, ${p.y}, ${p.z}) (noPath): the way passes along a drop that would kill`), { name: 'NoRoute', destination: { ...p } });

test('a route that found no way three times from about here is set aside with its reason; from 20 blocks off it is not', () => {
  const goal = {}, now = Date.now();
  assert.equal(ra.noteFailure(goal, noRoute(), HERE, now).aside, null);
  assert.equal(ra.noteFailure(goal, noRoute(), HERE.offset(4, 0, 2), now + 300).aside, null);
  const third = ra.noteFailure(goal, noRoute(), HERE.offset(-3, 1, 0), now + 600);
  assert(third.newly, 'set aside at the third');
  assert.match(third.says, /route to \(73, 79, 493\), \d+ blocks off, found no way 3 times from about here/);
  assert.match(third.says, /drop that would kill/);
  assert(ra.asideFor(goal, FURNACE, HERE, now + 700), 'stands from here');
  assert.equal(ra.asideFor(goal, FURNACE, HERE.offset(20, 0, 0), now + 700), null, 'not from 20 blocks off');
  assert.equal(ra.asideFor(goal, FURNACE, HERE, now + 600 + ra.REST_MS + 1), null, 'ten minutes, then offered again');
  // Another target is its own.
  assert.equal(ra.noteFailure(goal, noRoute({ x: 0, y: 70, z: 0 }), HERE, now + 800).aside, null);
});

test('persist says a failure once, never as a counter, and at the third no-route from here says it set the target aside and asks the stall\'s question', async () => {
  const { runGoal } = require('../src/work');
  const bot = { registry, inventory: { items: () => [] }, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' },
    entity: { id: 1, position: new Vec3(0.5, 64, 0.5), onGround: true }, health: 20, food: 20, entities: {}, time: { timeOfDay: 1000 },
    pathfinder: { movements: { blocksCantBreak: new Set(), exclusionAreasBreak: [] }, setGoal() {} }, clearControlStates() {},
    blockAt: () => ({ name: 'air', boundingBox: 'empty' }), findBlocks: () => [], chat(line) { this.said.push(line); }, said: [], emit() {}, buildRegistry: null };
  const goal = { kind: 'obtain', item: 'pumpkin', count: 1, request: 'get a pumpkin', from: 'Player', survival: {} };
  const survival = { state: goal.survival, step: async () => { throw noRoute({ x: 300, y: 64, z: 0 }); } };
  await runGoal(bot, new Task('persist', 'get a pumpkin'), goal, { save() {} }, { survival, maxSteps: 12, backoffMs: 1 });
  assert(goal.struggles >= 3, `struggled ${goal.struggles} times`);
  assert.equal(bot.said.filter(l => /attempt/.test(l)).length, 0, 'no attempt counter in chat');
  assert.equal(bot.said.filter(l => /keep trying/.test(l)).length, 1, 'said once');
  assert.equal(bot.said.filter(l => /set it aside/.test(l)).length, 1, 'the set-aside said once');
  assert.match(bot.said.find(l => /set it aside/.test(l)), /No way to \(300, 64, 0\) from here, 300 blocks off/);
  assert.equal(goal.routeAside.aside.length, 1);
});

// The stall's question at 25589's ledge: rock over the head, every walk
// failing. The rise is its own answer, priced, named first; relocations the
// work failed after the same way are said as tried and listed last.
function ledgeBot() {
  const solidAt = y => y < 79 || (y >= 83 && y <= 88);
  return { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 18.5, food: 16, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: HERE.clone(), onGround: true }, time: { timeOfDay: 0 }, entities: {},
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, durabilityUsed: 60 }, { name: 'netherrack', count: 64 }, { name: 'diamond_sword', count: 1 }], slots: [] },
    findBlocks: () => [], clearControlStates() {}, setControlState() {},
    blockAt: p => ({ position: p, name: solidAt(p.y) ? 'netherrack' : 'air', boundingBox: solidAt(p.y) ? 'block' : 'empty', diggable: true, hardness: 0.4 }),
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
}
async function askStall(bot, goal, stall) {
  const { answerStall } = require('../src/work');
  const task = new Task('stall'), asked = [];
  const client = { systemOne: async ({ questions }) => {
    for (const q of Object.values(questions)) asked.push(q.criteria);
    task.cancel();
    const keys = Object.keys(Object.values(questions)[0].criteria || {});
    return { answers: Object.fromEntries(Object.keys(questions).map(b => [b, { choice: keys[0], confidence: 0.6 }])) };
  } };
  await answerStall(bot, task, goal, () => {}, stall, { client, failed: { action: 'acquire', item: 'blaze_rod' } }).catch(() => {});
  return asked;
}

test('where the walks fail, rise_through is its own answer with its price, named first; again is not offered once the route is set aside', async () => {
  const bot = ledgeBot();
  const goal = { version: 1, kind: 'win', request: 'beat the game', survival: {} };
  const now = Date.now();
  for (let i = 0; i < 3; i++) ra.noteFailure(goal, noRoute(), HERE, now + i);
  const aside = ra.asideFor(goal, FURNACE, HERE);
  const stall = { key: 'step:blaze_rod', work: 'step:rung:obtain_blaze_rods', layer: 'work', strikes: 3, error: `${noRoute().message}; ${ra.asideSays(aside)}`, routeAside: aside };
  const asked = await askStall(bot, goal, stall);
  assert.equal(asked.length, 1);
  const keys = Object.keys(asked[0]);
  assert(asked[0].rise_through, `rise_through offered: ${keys.join(', ')}`);
  assert.equal(keys[0], 'rise_through', `named first: ${keys.join(', ')}`);
  assert.match(asked[0].rise_through, /Rise straight up through the rock over the head: 3 blocks of open air, then 6 of netherrack/);
  assert.match(asked[0].rise_through, /About \d+ seconds/);
  assert.match(asked[0].rise_through, /walks from here have found no route/);
  assert.equal(asked[0].again, undefined, 'the failed step is not offered again as it was');
});

test('a relocation after which the work failed the same way is said as tried, with the route\'s distance, and listed last', async () => {
  const goal = { version: 1, kind: 'win', request: 'beat the game', survival: {} };
  const now = Date.now();
  ra.noteRelocation(goal, HERE, { x: -545, y: 78, z: 726 }, noRoute().message, now - 60000);
  const tried = ra.relocationsTried(goal, HERE.offset(1, 0, 0), noRoute().message, now);
  assert.equal(tried.length, 1);
  const same = ra.relocationSays(tried, { kind: 'relocate', position: { x: -545, y: 78, z: 726 } }, HERE, noRoute().message, now);
  assert.match(same, /Tried: this same footing 60 seconds ago, and the work failed the same way after it/);
  assert.match(same, /route to \(73, 79, 493\), 657 blocks off: footing a few blocks from here does not change that route/);
  const other = ra.relocationSays(tried, { kind: 'relocate', position: { x: -543, y: 75, z: 725 } }, HERE, noRoute().message, now);
  assert.match(other, /Tried: 1 move to footing near here/);
  assert.equal(ra.relocationsTried(goal, HERE, 'No route from here to (0, 70, 0) (noPath)', now).length, 0, 'another failure is not the same');
  assert.equal(ra.relocationsTried(goal, HERE.offset(30, 0, 0), noRoute().message, now).length, 0, 'not from 30 blocks off');
});

test('a batch left cooking is not walked back to unasked from far off: its time up, upkeep offers fetch_batch priced and leave_batch', async () => {
  const work = require('../src/work');
  const bot = ledgeBot();
  const now = Date.now();
  const goal = { kind: 'win', survival: {}, smelting: { item: 'iron_ingot', from: 'raw_iron', fuelItem: 'coal', position: { ...FURNACE }, dimension: 'nether', targetInventory: 3, count: 3,
    left: { at: now - work.LEAVE_BATCH_MS - 1000, doneAt: now - work.LEAVE_BATCH_MS + 30000 } } };
  assert.equal(work.localBatch(bot, goal), null, 'not taken back from 657 blocks off');
  assert(goal.smelting.left.lapsed, 'its time up is kept');
  const lb = work.leftBatch(bot, goal);
  assert.equal(lb.distance, 657);
  const { options } = await work.upkeepOffers(bot, new Task('upkeep'), goal, () => {});
  assert(options.fetch_batch, `fetch_batch offered: ${Object.keys(options).join(', ')}`);
  assert.match(options.fetch_batch.description, /3 raw iron \(to iron ingot\) in the furnace at \(73, 79, 493\), 657 blocks off/);
  assert.match(options.fetch_batch.description, /minutes each way at the Nether's walks/);
  assert(options.leave_batch, 'leave_batch offered');
  await options.leave_batch.run();
  assert.equal(work.leftBatch(bot, goal), null, 'left for good: not offered again');
  // Within 16 blocks of the furnace, with its time up, it is taken out.
  goal.smelting.left = { at: now - work.LEAVE_BATCH_MS - 1000, doneAt: now };
  bot.entity.position = new Vec3(70.5, 79, 495.5);
  assert.equal(work.localBatch(bot, goal), goal.smelting);
});

test('a batch not left but walked away from, more than 64 blocks off, is offered the same way, not walked back to unasked (25592)', async () => {
  const work = require('../src/work');
  const bot = ledgeBot();
  bot.game.dimension = 'overworld';
  bot.entity.position = new Vec3(-121.5, 43, 43.5);
  const goal = { kind: 'win', survival: {}, smelting: { item: 'cooked_mutton', from: 'mutton', fuelItem: 'coal', position: { x: 101, y: 43, z: 100 }, dimension: 'overworld', targetInventory: 6, count: 6, startedAt: Date.now() - 14 * 60000 } };
  assert.equal(work.localBatch(bot, goal), null);
  assert(goal.smelting.left?.away);
  const { options } = await work.upkeepOffers(bot, new Task('upkeep'), goal, () => {});
  assert.match(options.fetch_batch.description, /6 mutton \(to cooked mutton\) in the furnace at \(101, 43, 100\), 230 blocks off, begun 14 minutes ago and walked away from/);
  // Within 64 blocks a batch in hand is still finished as before.
  const near = { kind: 'win', survival: {}, smelting: { ...goal.smelting } };
  delete near.smelting.left;
  bot.entity.position = new Vec3(80.5, 43, 90.5);
  assert.equal(work.localBatch(bot, near), near.smelting);
});

test('the walk to the batch finding no route leaves it where it is, said, and fetch_batch is not offered from about there', async () => {
  const work = require('../src/work');
  const bot = ledgeBot();
  const goal = { kind: 'win', survival: {}, smelting: { item: 'iron_ingot', from: 'raw_iron', fuelItem: 'coal', position: { ...FURNACE }, dimension: 'nether', targetInventory: 3, count: 3 } };
  assert.equal(work.batchNoRoute(bot, goal, goal.smelting, new Error('timed out')), false, 'only a route that found no way');
  assert.equal(work.batchNoRoute(bot, goal, goal.smelting, noRoute()), true);
  assert(goal.smelting.left?.noRoute, 'left again with the no-route kept');
  assert.equal(work.localBatch(bot, goal), null, 'the next step does not walk there again');
  const { options } = await work.upkeepOffers(bot, new Task('upkeep'), goal, () => {});
  assert.equal(options.fetch_batch, undefined, 'not offered from about where it found no route');
  assert.match(options.leave_batch.description, /found no route from about here \d+ seconds ago \(No route from here to \(73, 79, 493\)/);
  // From 20 blocks on, the walk is offered again, said with the failure.
  bot.entity.position = HERE.offset(20, 0, 0);
  const again = (await work.upkeepOffers(bot, new Task('upkeep'), goal, () => {})).options;
  assert.match(again.fetch_batch.description, /found no route \d+ minutes? ago from \(-542, 79, 725\)/);
});

test('a hoglin walk that found no way from about here is not offered to another sighting from here; from 20 blocks off it is', () => {
  const { hoglinsKnown } = require('../src/nether-travel');
  const now = Date.now();
  const bot = ledgeBot();
  const goal = { sightings: { hoglin: [{ x: -548, y: 70, z: 878, count: 1, at: now - 60000, dimension: 'the_nether' }] },
    netherFood: { noWay: [{ x: -601, y: 70, z: 861, at: now - 200000, until: now + 100000, why: 'Took to long to decide path to goal!', from: { x: -542, y: 79, z: 725 } }] } };
  const here = hoglinsKnown(bot, goal);
  assert.equal(here.seen.length, 0, 'withheld from about here');
  assert.equal(here.noWay.length, 1);
  assert(here.noWay[0].fromHere);
  bot.entity.position = HERE.offset(20, 0, 0);
  assert.equal(hoglinsKnown(bot, goal).seen.length, 1, 'offered from 20 blocks off');
});

// 25585 (mid-227-ab, critic-20261001T0253Z item 1): back_to_fortress chosen
// at 02:47:58 and 02:51:59Z, each walk back ending at once "No way on east
// from here. Choosing another." of a walk west, and the legs away asked as if
// it had not been chosen. The ground of note 750's fixture, a fortress known
// 97 blocks east.
test('a walk back to a fortress known that found no way from about here is said as that, on the way back and in the facts, with the ways that change it first; not taken again unasked', async () => {
  const { groundBot } = require('./fixtures/saved-ground');
  const GROUND = require('./fixtures/fortress-under-25585.json');
  const mh = require('../src/mob-hunt');
  const bot = groundBot(GROUND, { at: new Vec3(943.5, 41, 73.5), items: [['cooked_mutton', 7], ['netherrack', 64], ['stone_pickaxe', 1]], dimension: 'the_nether', indexed: true });
  bot.entities = {}; bot.players = {};
  const now = Date.now();
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 7 } };
  const fortressAt = { x: 1040, y: 60, z: 74, extent: 40, firstAt: now - 60 * 60000 };
  const state = { legs: 11, since: now - 30 * 60000, fortressAt, heading: 0, lastHeading: 0, legMode: 'descend',
    backFailed: { at: now - 20000, from: { x: 943, y: 41, z: 73 }, target: { x: 1040, y: 60, z: 74 }, why: 'out of blocks (31 carried)', carried: 31 } };
  const asked = [];
  const client = { systemOne: async ({ state: facts, questions }) => { const c = questions.branch_0.criteria; asked.push({ facts, options: c }); return { answers: { branch_0: { choice: 'back_to_fortress', confidence: 0.9 } } }; } };
  const ran = await mh.chooseLeg(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => { throw new Error('No path to the goal!'); }, tunnel: async () => {}, mineAt: async () => {}, acquireStep: async () => false }, state);
  const { options, facts } = asked.at(-1);
  assert.match(options.back_to_fortress, /Tried \d+ seconds ago from about here: the walk back \(the pathfinder, then straight across at this height, then the staircase\) found no way, out of blocks \(31 carried\), with 31 blocks carried\./);
  assert.match(facts.fortressKnown, /Tried \d+ seconds ago from about here/);
  const keys = Object.keys(options).filter(k => k !== 'none_good');
  const firstLeg = keys.findIndex(k => /^leg_/.test(k));
  assert(keys.indexOf('back_to_fortress') < firstLeg || firstLeg < 0, `the way back before the legs: ${keys.join(', ')}`);
  if (options.restock_blocks) { assert.equal(keys[0], 'restock_blocks'); assert.match(options.restock_blocks, /The walk back to the fortress at \(1040, 74\), 97 blocks off, found no way from about here \d+ seconds ago/); }
  // Taken: a level walk headed at it, east, whatever the last leg was.
  assert.equal(ran, 'fortress');
  assert.equal(state.legMode, 'level');
  assert.equal(state.lastHeading, 0);
  // From 30 blocks off the failure is not said.
  bot.entity.position = new Vec3(913.5, 41, 73.5);
  assert.equal(mh.knownFortressOutOfView(bot, goal, state, bot.entity.position)?.failed, undefined);
});
