'use strict';
// Note 751b: the walk a leg takes said with it, a blind stem fetch said as
// one, and the way back to a portal asked toward the portal before wood.
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const coverage = require('../src/nether-coverage');
const { groundBot } = require('./fixtures/saved-ground');
const fixture = require('./fixtures/tunnels-mid-243-af-nether-3-fortress-5.json');

// A bot whose pathfinder's route is `path`, standing at (0, 57, 0).
function routeBot(path, status = 'success') {
  const air = p => ({ name: p.y <= 56 ? 'netherrack' : 'air', boundingBox: p.y <= 56 ? 'block' : 'empty', position: p });
  return { entity: { position: new Vec3(0.5, 57, 0.5) }, game: { dimension: 'the_nether' }, blockAt: air,
    pathfinder: { movements: {}, getPathTo: () => ({ status, path }) } };
}
const line = (from, to) => { const out = []; for (let x = from; from <= to ? x <= to : x >= to; x += from <= to ? 1 : -1) out.push({ x, y: 57, z: 0, toPlace: [], toBreak: [] }); return out; };

test('a leg says the walk the pathfinder takes first: over the bot\'s own span it is said as a walk back over ground already walked (25584, 16:49Z)', async () => {
  const { legWalkSays } = require('../src/nether-travel');
  const state = {};
  // The span east, stood on its whole length.
  for (let x = 0; x <= 60; x++) { const c = coverage.coverageOf(state, 'nether'), cx = Math.floor(x / 4), k = `${cx >> 2},0`; c.stood[k] = (c.stood[k] || 0) | (1 << (cx & 3)); }
  const says = await legWalkSays(routeBot(line(1, 60)), new Task('leg'), { x: 64, y: 57, z: 0 }, { state });
  assert.match(says, /^ Walked first by the pathfinder, before any digging: its route reaches the leg's end in 60 steps, about 14 seconds, 60 of them on ground the bot has stood on before, a walk back over ground already walked and looked from; the line's cells said here are dug only where that walk fails\.$/);
  // Part of the way: said as far as it goes.
  const part = await legWalkSays(routeBot(line(1, 20), 'partial'), new Task('leg'), { x: 64, y: 57, z: 0 }, { state: {} });
  assert.match(part, /its route goes 20 blocks nearer the leg's end, to \(20, 57, 0\) in 20 steps, about 5 seconds, 0 of them on ground the bot has stood on before; from where it ends the leg goes straight on\./);
  // No walk: the line as said.
  assert.match(await legWalkSays(routeBot([], 'noPath'), new Task('leg'), { x: 64, y: 57, z: 0 }), /finds no walk on foot from here: the leg goes straight along the line as said/);
  // No pathfinder at hand: nothing said.
  assert.equal(await legWalkSays({ entity: { position: new Vec3(0, 57, 0) } }, new Task('leg'), { x: 64, y: 57, z: 0 }), '');
});

test('a stem fetch with no stem known is said as a blind search, with what such fetches came to in the record', async () => {
  const { fetchStemsOffer } = require('../src/nether-wood');
  const bot = groundBot(fixture, { at: new Vec3(-176.5, 66, -112.5), dimension: 'the_nether', health: 20, food: 20, items: [] });
  bot.findBlocks = () => [];
  const offer = await fetchStemsOffer(bot, new Task('fetch'), { survival: {} });
  assert(offer, 'offered: no pickaxe and none to be made');
  assert.match(offer.description, /The fetch is then a blind search: the gathering's legs of 64 blocks/);
  assert.match(offer.description, /none of the 4 fetches chosen with no stem known brought wood; of 337 to stems known, 100 brought some within twelve minutes/);
});

test('the way back with no pickaxe asks toward the portal beside the wood: dig_across and pickaxe_first (25598, 16:52:37Z)', async () => {
  const { portalWay } = require('../src/work');
  const bot = groundBot(fixture, { at: new Vec3(-161.5, 66, -112.5), dimension: 'the_nether', health: 1, food: 14, items: [] });
  bot.findBlocks = () => [];
  const task = new Task('back'), asked = [];
  task.opportunityClient = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'around_left', confidence: 0.9 } } }; } };
  bot.pathfinder = { ...(bot.pathfinder || {}), goto: async () => { throw new Error('No path to the goal!'); }, setGoal: () => {} };
  const p = { x: -140, y: 66, z: -113 };
  await portalWay(bot, task, { survival: {} }, () => {}, p, 'nether', { walk: 'the walk there failed (no route)', pickaxeWanted: { item: 'stone_pickaxe', gather: true } }).catch(() => {});
  const o = asked[0];
  assert(o, 'asked');
  assert.match(o.dig_across, /^Straight at the portal now at this height, the rock in the way dug by hand \(no pickaxe carried\)/);
  assert.match(o.pickaxe_first, /^Get stone pickaxe first for the way to the portal, from wood not carried, then the way on: the gathering goes where the wood is, not toward the portal\..* With it the tunnel home is about \d+ minutes? for the \d+ blocks across, against about \d+ by hand/);
});

test('pickaxe first on the way to the portal says what choosing it has come to and what the wait costs a hurt, hungry bot (note 1258)', async () => {
  const { portalWay } = require('../src/work');
  const bot = groundBot(fixture, { at: new Vec3(-161.5, 66, -112.5), dimension: 'the_nether', health: 3, food: 13, items: [] });
  bot.findBlocks = () => [];
  const task = new Task('back'), asked = [];
  task.opportunityClient = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'around_left', confidence: 0.9 } } }; } };
  bot.pathfinder = { ...(bot.pathfinder || {}), goto: async () => { throw new Error('No path to the goal!'); }, setGoal: () => {} };
  const goal = { survival: {}, portalPickaxeTried: [Date.now() - 12 * 60000, Date.now() - 6 * 60000, Date.now() - 60000] };
  await portalWay(bot, task, goal, () => {}, { x: -140, y: 66, z: -113 }, 'nether', { walk: 'the walk there failed (no route)', pickaxeWanted: { item: 'stone_pickaxe', gather: true } }).catch(() => {});
  assert.match(asked[0].pickaxe_first, /Chosen 3 times in the last 12 minutes, and no pickaxe has come of it\. Health 3 does not come back meanwhile: hunger 13, nothing carried to eat, and the food is past the portal\.$/);
});

test('portal_way asked on the trip home carries the trip on: its ways toward the portal are offered, not all withheld (25584\'s return_for_wood)', async () => {
  const { EventEmitter } = require('node:events');
  const registry = require('minecraft-data')('26.1');
  const { decide } = require('../src/decisions');
  const bot = Object.assign(new EventEmitter(), { registry, version: '26.1', health: 20, food: 20, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' },
    entity: { position: new Vec3(-184, 70, 10), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, entities: {},
    inventory: { items: () => [], slots: [] }, chat() {}, blockAt: () => null });
  const goal = { kind: 'win' };
  const ask = (answer, offered) => ({ systemOne: async ({ questions }) => { const keys = Object.keys(questions.branch_0.criteria); offered.push(keys); return { answers: { branch_0: { choice: keys.includes(answer) ? answer : keys[0], confidence: 0.9 } } }; } });
  const portal = { x: 240, y: 70, z: 10 };
  await decide('upkeep', { client: ask('return_for_wood', []), bot, goal, tree: { return_for_wood: { description: 'Back through the portal for wood.', target: portal }, carry_on: { description: 'Carry on.' } }, state: {} });
  assert.equal(goal.intention?.choice, 'return_for_wood');
  const offered = [];
  await decide('portal_way', { client: ask('dig_across', offered), bot, goal, target: portal,
    tree: { around_left: { description: 'Go round left.' }, dig_across: { description: 'Straight at the portal.' }, pickaxe_first: { description: 'A pickaxe first.' }, wait_rest: { description: 'Other work.' } }, state: {} });
  assert.deepEqual(offered[0].filter(k => k !== 'none_good').sort(), ['around_left', 'dig_across', 'pickaxe_first']);
  assert.equal(goal.intention?.choice, 'return_for_wood', 'the trip holds');
});

test('the stem fetch resting is said as resting on pickaxe_first, not as no stem known (note 967)', async () => {
  const { portalWay } = require('../src/work');
  const { setAside } = require('../src/progress');
  const bot = groundBot(fixture, { at: new Vec3(-161.5, 66, -112.5), dimension: 'the_nether', health: 20, food: 20, items: [] });
  bot.findBlocks = () => [];
  const task = new Task('back'), asked = [];
  task.opportunityClient = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'around_left', confidence: 0.9 } } }; } };
  bot.pathfinder = { ...(bot.pathfinder || {}), goto: async () => { throw new Error('No path to the goal!'); }, setGoal: () => {} };
  const goal = { survival: {} };
  setAside(goal, 'fetch_stems', 'nether', 'No stems were fetched: the walk to the crimson stems came no nearer', 600000);
  await portalWay(bot, task, goal, () => {}, { x: -140, y: 66, z: -113 }, 'nether', { walk: 'the walk there failed (no route)', pickaxeWanted: { item: 'stone_pickaxe', gather: true } }).catch(() => {});
  assert.match(asked[0]?.pickaxe_first || '', /The fetch of stems rests from a failure \(No stems were fetched: the walk to the crimson stems came no nearer\)/);
  assert.doesNotMatch(asked[0].pickaxe_first, /No stem is known/);
  // On the trip home chosen for wood, the pickaxe first is not a way of it (note 1113).
  const home = { survival: {}, intention: { id: 'upkeep', choice: 'return_for_wood', at: Date.now() } };
  asked.length = 0;
  await portalWay(bot, task, home, () => {}, { x: -140, y: 66, z: -113 }, 'nether', { walk: 'the walk there failed (no route)', pickaxeWanted: { item: 'stone_pickaxe', gather: true } }).catch(() => {});
  assert(asked[0], 'the way is asked');
  assert.equal(asked[0].pickaxe_first, undefined, Object.keys(asked[0]).join(','));
});
