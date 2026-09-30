'use strict';
const { oldOrder } = require('./support/jev-stand-in');
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { groundBot, registry } = require('./fixtures/saved-ground');

// mid-242-af-nether-2-fortress-3 (25591) at 13:04Z, as its region files had
// it: the bot on its own one-wide cobblestone span at y 72 over the lava
// sea, four of its oak planks laid on and by the span as cover from ghasts
// (two of them a wall across it at (-21, 72..73, 40)), crimson stems 60
// blocks east, warped stems 47 to 53 west, its portal at (17, 58, -2).
// No pickaxe, no block carried, 2 health. It wanted one crimson stem for
// the stone pickaxe the staircase back to the portal needs, and the
// Overworld's walking search threw "No reachable surveyed ground while
// searching for crimson_stem" over and over for twelve minutes (note 608).
const SPAN = require('./fixtures/nether-span-mid-242-af.json');
const CARRIED = [['stone_sword', 1], ['coal', 17], ['leather', 1], ['oak_sapling', 1], ['stick', 1], ['raw_iron', 1], ['crafting_table', 1], ['furnace', 1], ['iron_sword', 1], ['quartz', 4], ['black_wool', 1], ['raw_copper', 2]];
const STEMS = [[26, 65, 26], [26, 59, 26], [26, 58, 26], [25, 70, 12], [25, 65, 12], [25, 64, 12], [31, 69, 27], [31, 68, 27], [31, 67, 27]];
function spanBot({ items = CARRIED, at = new Vec3(-29.5, 72, 48.5) } = {}) {
  return groundBot(SPAN, { at, items, health: 2, food: 13, dimension: 'the_nether', indexed: true });
}
function recordedGoal(now = Date.now()) {
  return { kind: 'win', request: 'beat the game',
    // The crimson stems it remembered, as its archived goal had them.
    resourceMemory: Object.fromEntries(STEMS.map(([x, y, z]) => [`the_nether:${x},${y},${z}`, { name: 'crimson_stem', position: { x, y, z }, dimension: 'the_nether', seenAt: now - 60000 }])),
    landmarks: [{ kind: 'warped_forest', x: -73, y: 64, z: -32, biome: true, dimension: 'nether', firstAt: now, seenAt: now }],
    portals: [{ x: 29, y: 71, z: 31, dimension: 'overworld' }, { x: 17, y: 58, z: 1, dimension: 'nether' }],
    rungTime: { phase: 'errand' }, gameProgress: { phase: 'obtain_blaze_rods' },
    errand: { dimension: 'overworld', items: [{ item: 'iron_helmet', count: 1 }, { item: 'iron_chestplate', count: 1 }], for: 'the combat kit', at: now - 5 * 60000 } };
}
function jevStub(picks) {
  const asked = [];
  return { asked, systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } };
}
const stemStep = () => {
  const step = { action: 'mine', block: 'crimson_stem', sources: ['crimson_stem'], drops: 'crimson_stem', count: 1, depth: null, tier: 0, requires: {}, consumes: {}, produces: { crimson_stem: 1 } };
  // What the acquisition it came from was making (work.js acquireStep).
  Object.defineProperty(step, 'forItem', { value: 'stone_pickaxe', enumerable: false });
  return step;
};
// A block dug from where the bot stands and its drop picked up (work.js mine).
const digger = bot => {
  const mined = [], inv = bot.inventory.items();
  const mineAt = async (p, block) => {
    mined.push(`${p}`); bot.changed.set(`${p.x},${p.y},${p.z}`, 'air');
    const i = inv.find(x => x.name === block);
    if (i) i.count++; else inv.push({ name: block, count: 1, type: registry.itemsByName[block].id });
  };
  const navigate = async (b, t, g) => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); };
  return { mined, mineAt, navigate };
};

test('from the recorded span the stem search is the Nether\'s: the wood within reach, where stems are known and every way there, and going without (mid-242-af-nether-2-fortress-3, note 608)', async () => {
  const { mineAtSource } = require('../src/work');
  const bot = spanBot(), goal = recordedGoal();
  const client = jevStub(['without']), task = new Task('work');
  task.opportunityClient = client;
  // As recorded it threw "No reachable surveyed ground while searching for crimson_stem" and asked nothing.
  await mineAtSource(bot, task, stemStep(), goal, () => {});
  assert.equal(client.asked.length, 1);
  assert.equal(goal.decisions.at(-1).id, 'nether_gather');
  const { options, state } = client.asked[0];
  // The planks it laid as cover: two within reach, two past the wall they make.
  assert.match(options.wood_in_view, /^Take the wood within reach here: 2 oak planks, the nearest 12 blocks off at \(-21, 72, 40\), dug from a walk of 11 blocks/);
  assert.match(options.wood_in_view, /Within 24 blocks but not to be dug from ground walked to from here now: 2 oak planks\./);
  // The crimson stems remembered and the warped forest round it, each with every way there from here.
  const crimson = state.knownPlaces.find(p => /crimson stems known at \(26, 67, 26\), 60 blocks east and 5 down/.test(p));
  assert(crimson, state.knownPlaces.join('\n'));
  // The walk along the span ends at the planks' wall, and that is said.
  assert.match(crimson, /On foot: the pathfinder finds no route there; the nearest it walks to is \(-22, 72, 40\), 10 blocks nearer\. From there, straight across: oak planks in the way at the first cell, so the walk ends there\./);
  assert.match(crimson, /Straight across at y 72, crouched: 76 cells, 90 of rock to dig \(dug by hand, no pickaxe being carried: netherrack so dug drops nothing, about \d+ seconds\) and 47 of open air or lava to lay a block over \(40 over lava\).*0 blocks carried: they take it 1 cell, 1 block nearer/);
  assert(state.knownPlaces.some(p => /^\d+ warped stems known at \(-77, 65, 26\), 53 blocks west and 7 down\..*Straight across at y 72, crouched: 67 cells.*0 blocks carried: it stops at the first cell needing one\. The bot has not stood within 32 blocks of it\. No way from here makes ground toward it, so it is not offered\.$/.test(p)), state.knownPlaces.join('\n'));
  // No crossing is offered with nothing to lay, nor the portal the bot cannot reach.
  assert.deepEqual(Object.keys(options).filter(k => /^cross_to_/.test(k)), []);
  assert.equal(options.portal_trip, undefined);
  assert.match(state.portal, /^The nether portal at \(17, 58, 1\), 66 blocks across and 14 below\. On foot: the pathfinder finds no route there.*where oak planks in the way stops it\. Neither the walk nor the crossing with the blocks carried reaches it from here, so going back through it is not offered\.$/);
  // Every leg needs a block laid within its first cells, and none is carried.
  assert.equal(state.legsClosed.length, 4, state.legsClosed.join('\n'));
  assert.deepEqual(Object.keys(options).filter(k => /^leg_/.test(k)), []);
  assert.match(state.pickaxe, /^none/);
  // Going without: what the stem is for, the errand it serves, and what the ladder goes on with.
  assert.match(options.without, /^Go on without the stone pickaxe this crimson stem is for: leave the errand \(the trip to the overworld for iron helmet, iron chestplate, for the combat kit\) for thirty minutes and go on with the obtain blaze rods/);
  // Chosen, the errand is set aside for the ladder to go on.
  assert.equal(goal.step.action, 'go_without');
  assert(require('../src/progress').isSetAside(goal, 'rung', 'errand'));
});

test('the wood within reach taken: the planks on the span, the wall of them first and those behind it after (note 608)', async () => {
  const { netherGather } = require('../src/nether-gather');
  const bot = spanBot(), goal = recordedGoal();
  const { mined, mineAt, navigate } = digger(bot);
  const client = jevStub(['wood_in_view']), task = new Task('work');
  await netherGather(bot, task, goal, () => {}, 'crimson_stem', { navigate, mineAt, client, forItem: 'stone_pickaxe' });
  assert.deepEqual(mined, ['(-21, 72, 40)', '(-21, 73, 40)', '(-19, 74, 35)', '(-17, 72, 34)']);
  assert.equal(bot.inventory.items().find(i => i.name === 'oak_planks')?.count, 4);
});

test('with blocks carried the ways there are offered and priced, and a way that came no nearer rests from here and is said (note 608)', async () => {
  const { netherGather } = require('../src/nether-gather');
  const bot = spanBot({ items: [...CARRIED, ['cobblestone', 64]] }), goal = recordedGoal();
  const client = jevStub(['cross_to_2']), task = new Task('work');
  const laid = [];
  // The span as bridging.js lays it is not simulated: nothing is laid, and the crossing comes no nearer.
  const bridging = require('../src/bridging');
  const bridgeTo = bridging.bridgeTo;
  bridging.bridgeTo = async (b, t, target, o) => { laid.push({ target: `${target}`, ...o }); throw new Error('Not bridging with a ghast 30 blocks off able to see me'); };
  delete require.cache[require.resolve('../src/nether-gather')];
  try {
    const gather = require('../src/nether-gather');
    await assert.rejects(gather.netherGather(bot, task, goal, () => {}, 'crimson_stem', { navigate: digger(bot).navigate, mineAt: digger(bot).mineAt, client }),
      /^Error: The way straight across to the warped stems at \(-77, 65, 26\) came no nearer: Not bridging with a ghast 30 blocks off able to see me; it rests from here$/);
    const { options } = client.asked[0];
    assert.match(options.cross_to_2, /^Go to the warped stems straight across at this height as far as the blocks carried take it \(64 cells, 48 blocks nearer\)\. \d+ warped stems known at \(-77, 65, 26\).*67 of open air or lava to lay a block over \(33 over lava\).*64 blocks carried: they take it 64 cells, 48 blocks nearer, and it stops at the first cell needing another\./);
    assert.match(options.cross_to_3, /^Go to the crimson stems straight across at this height .*76 cells, 90 of rock to dig .*64 blocks carried, 17 left after\./);
    assert.deepEqual(laid, [{ target: '(-77, 65, 26)', maxBlocks: 64, maxSteps: 64 }]);
    // Asked again from the same spot, that way is not offered and is said resting.
    const again = jevStub(['without']);
    await gather.netherGather(bot, task, goal, () => {}, 'crimson_stem', { navigate: digger(bot).navigate, mineAt: digger(bot).mineAt, client: again });
    assert.equal(again.asked[0].options.cross_to_2, undefined);
    assert(again.asked[0].options.cross_to_3, 'the other ways are still offered');
    assert.match(again.asked[0].state.waysResting.join('\n'), /straight across to the warped stems at \(-77, 65, 26\): came to nothing from here a few minutes ago \(Not bridging with a ghast 30 blocks off able to see me\), resting/);
  } finally { bridging.bridgeTo = bridgeTo; delete require.cache[require.resolve('../src/nether-gather')]; }
});

test('the portal back is offered where the walk reaches it, said with where it comes out and the wood known there (note 608)', async () => {
  const { netherGather } = require('../src/nether-gather');
  // Beside the portal the bot came through, on the ground by it.
  const bot = spanBot({ at: new Vec3(15.5, 58, 2.5) });
  const goal = { ...recordedGoal(), resourceMemory: { 'overworld:140,70,20': { name: 'oak_log', position: { x: 140, y: 70, z: 20 }, dimension: 'overworld', seenAt: Date.now() - 60000 } } };
  const client = jevStub(['portal_trip']), task = new Task('work');
  const went = [];
  await netherGather(bot, task, goal, () => {}, 'crimson_stem', { navigate: digger(bot).navigate, mineAt: digger(bot).mineAt, client, returnOverworld: async () => { went.push('through'); } });
  const { options } = client.asked[0];
  assert.match(options.portal_trip, /^Go back through the portal to the Overworld for wood, on foot\. The nether portal at \(17, 58, 1\), \d+ blocks off\. On foot: the pathfinder's route there is \d+ steps?/);
  assert.match(options.portal_trip, /It comes out at the Overworld portal at \(29, 71, 31\)\. The nearest wood remembered there: oak log 112 blocks from it\. The work here waits till the bot comes back through\.$/);
  assert.deepEqual(went, ['through']);
});

test('without Jev the wood within reach is taken first, then the walk to the nearest place (note 608)', () => {
  const { question } = require('../src/decisions');
  require('../src/decisions/work');
  const fallback = oldOrder('nether_gather');
  assert.equal(fallback({ without: {}, walk_to_2: {}, wood_in_view: {} }), 'wood_in_view');
  assert.equal(fallback({ without: {}, cross_to_1: {}, walk_to_2: {} }), 'cross_to_1');
  assert.equal(fallback({ without: {}, leg_east: {}, leg_west: {} }, [], { unseen: { leg_east: 3, leg_west: 40 } }), 'leg_west');
  assert.equal(fallback({ without: {} }), 'without');
});

test('either Nether stem stands for the other where only it is in view (note 608)', () => {
  const work = require('../src/work');
  const bot = { registry, findBlocks: ({ matching }) => [matching].flat().includes(registry.blocksByName.warped_stem.id) ? [new Vec3(3, 64, 0)] : [], blockAt: () => ({ name: 'warped_stem' }) };
  const step = { action: 'mine', block: 'crimson_stem', sources: ['crimson_stem'], drops: 'crimson_stem', count: 1 };
  const swapped = work.logInView(bot, step);
  assert.equal(swapped.block, 'warped_stem');
  assert.equal(swapped.insteadOf, 'crimson_stem');
});
