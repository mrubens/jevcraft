'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const reg = require('minecraft-data')('26.1');
const { nextGameStage } = require('../src/game-progress');

const GEAR = ['white_bed', 'diamond_pickaxe', 'iron_sword', 'diamond_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots', 'bow'].map(name => [name, 1]).concat([['arrow', 16], ['cooked_beef', 20], ['cobblestone', 64], ['oak_log', 8], ['crafting_table', 1]]);
function world(carried) {
  const items = [...GEAR, ...carried].map(([name, count], i) => ({ name, count, type: reg.itemsByName[name].id, slot: 9 + i, durabilityUsed: 0 }));
  return { registry: reg, version: '26.1', game: { gameMode: 'survival', dimension: 'overworld' }, time: { timeOfDay: 6000 }, entity: { position: new Vec3(-32, 95, 134) }, entities: {},
    inventory: { items: () => items, slots: [] }, blockAt: () => null, findBlocks: () => [], health: 20, food: 20 };
}

test('every pearl had and the rods short only in the pack, the rest in the chest on this side: the chest is the step, resting or not, not the Nether (note 1263)', () => {
  const goal = { version: 1, kind: 'win', request: 'beat the game', gameProgress: { milestones: { nether_entered: { at: 1 } } },
    rodStashes: [{ position: { x: -33, y: 94, z: 135 }, dimension: 'overworld', contents: { blaze_rod: 2, ender_pearl: 6 }, takeFails: 1 }] };
  require('../src/progress').setAside(goal, 'rod_stash_take', '(-33, 94, 135)', 'Still in the chest', 600000);
  const stage = nextGameStage(world([['blaze_rod', 5], ['ender_pearl', 7]]), goal);
  assert.equal(stage.action, 'collect_rod_stash', JSON.stringify(stage));
  assert.deepEqual(stage.at, { x: -33, y: 94, z: 135 });
});

test('in the Nether with eyes of ender in the pack, the step is out with them (note 1264)', () => {
  const bot = world([['ender_eye', 12], ['blaze_powder', 1]]);
  bot.game.dimension = 'the_nether';
  const goal = { version: 1, kind: 'win', request: 'beat the game', gameProgress: { milestones: { nether_entered: { at: 1 }, eyes_obtained: { at: 2 } } }, strongholdSearch: { bearings: [{}] } };
  const stage = nextGameStage(bot, goal);
  assert.equal(stage.action, 'return_overworld', JSON.stringify(stage));
  assert.equal(stage.phase, 'eyes_out');
});

test('twelve eyes in the chest on the Overworld side and one pearl wanted: the Nether side reads the pearl wanted too, not every one had (note 1265)', () => {
  const goal = () => ({ version: 1, kind: 'win', request: 'beat the game', gameProgress: { milestones: { nether_entered: { at: 1 }, eyes_obtained: { at: 2 } } }, strongholdSearch: { bearings: [{}] },
    eyeBank: { at: Date.now(), chestAt: { x: -33, y: 94, z: 135 }, forNether: true },
    rodStashes: [{ position: { x: -33, y: 94, z: 135 }, dimension: 'overworld', contents: { ender_eye: 12 } }] });
  const over = nextGameStage(world([['blaze_powder', 1]]), goal());
  assert.equal(over.action, 'enter_nether'); assert.equal(over.item, 'ender_pearl');
  const bot = world([['blaze_powder', 1]]); bot.game.dimension = 'the_nether';
  const there = nextGameStage(bot, goal());
  assert.notEqual(there.action, 'home_with_rods', JSON.stringify(there));
  assert.equal(there.phase, 'obtain_ender_pearls', JSON.stringify(there));
});

test('one of the twelve chosen for the second bearing: the eyes held less one are what is wanted, the chest is opened and the search goes on (note 1268)', () => {
  const { eyeTarget } = require('../src/eye-need');
  const goal = { version: 1, kind: 'win', request: 'beat the game', gameProgress: { milestones: { nether_entered: { at: 1 }, eyes_obtained: { at: 2 } } }, strongholdSearch: { bearings: [{}], throws: 1 },
    eyeBank: { at: Date.now(), chestAt: { x: -33, y: 94, z: 135 }, forNether: true },
    rodStashes: [{ position: { x: -33, y: 94, z: 135 }, dimension: 'overworld', contents: { ender_eye: 12 } }] };
  assert.equal(eyeTarget(goal), 13);
  assert.notEqual(nextGameStage(world([]), goal).action, 'find_stronghold', 'by the rule the spare is fetched first');
  goal.strongholdSearch.spare = { pick: 'throw_one', at: Date.now(), target: 11 };
  assert.equal(eyeTarget(goal), 11);
  assert.equal(nextGameStage(world([]), goal).action, 'collect_rod_stash', 'the eyes come out of the chest');
  goal.rodStashes[0].contents = {};
  const stage = nextGameStage(world([['ender_eye', 12]]), goal);
  assert.equal(stage.action, 'find_stronghold', JSON.stringify(stage));
  // The thrown eye broken: eleven still go on with the search.
  assert.equal(nextGameStage(world([['ender_eye', 11]]), goal).action, 'find_stronghold');
});

test('the bearings met and eleven eyes in the chest after the one thrown: the walk to the place is the step, not the Nether (note 1269)', () => {
  const goal = { version: 1, kind: 'win', request: 'beat the game', gameProgress: { milestones: { nether_entered: { at: 1 }, eyes_obtained: { at: 2 } } },
    strongholdSearch: { bearings: [{}, {}], throws: 2, estimate: { x: 1839, z: -288 }, spare: { pick: 'throw_one', at: Date.now(), target: 11 } },
    eyeBank: { at: Date.now(), chestAt: { x: 4, y: 66, z: 5 }, forSearch: true },
    rodStashes: [{ position: { x: 4, y: 66, z: 5 }, dimension: 'overworld', contents: { ender_eye: 11 } }] };
  const stage = nextGameStage(world([]), goal);
  assert.equal(stage.action, 'find_stronghold', JSON.stringify(stage));
});

test('every eye put away and the stronghold placed: the walk there is the stage, not an early rung with the Nether as the way past it (note 1270)', () => {
  const reg2 = require('minecraft-data')('26.1');
  // 25597's pack at 01:33Z: a bow and four arrows, no eye, rod or pearl carried.
  const items = [['iron_pickaxe', 1], ['diamond_sword', 1], ['bow', 1], ['arrow', 4], ['white_bed', 1], ['bucket', 1], ['cobblestone', 56], ['oak_log', 14], ['crafting_table', 1], ['furnace', 1], ['stone_pickaxe', 3]]
    .map(([name, count], i) => ({ name, count, type: reg2.itemsByName[name].id, slot: 9 + i, durabilityUsed: 0 }));
  const slots = []; for (const [i, n] of [[5, 'iron_helmet'], [6, 'iron_chestplate'], [7, 'iron_leggings'], [8, 'golden_boots'], [45, 'shield']]) slots[i] = { name: n, type: reg2.itemsByName[n].id, count: 1 };
  const bot = { registry: reg2, version: '26.1', game: { gameMode: 'survival', dimension: 'overworld' }, time: { timeOfDay: 6000 }, entity: { position: new Vec3(525, 70, -56) }, entities: {},
    inventory: { items: () => items, slots }, blockAt: () => null, findBlocks: () => [], health: 20, food: 20 };
  const goal = { version: 1, kind: 'win', request: 'beat the game', gameProgress: { milestones: { nether_entered: { at: 1 }, eyes_obtained: { at: 2 } } },
    strongholdSearch: { bearings: [{}, {}], throws: 2, estimate: { x: 1839, z: -288 }, spare: { pick: 'throw_one', at: Date.now(), target: 11 } },
    eyeBank: { at: Date.now(), chestAt: { x: 4, y: 66, z: 5 }, forSearch: true },
    rodStashes: [{ position: { x: 4, y: 66, z: 5 }, dimension: 'overworld', contents: { ender_eye: 12, ender_pearl: 2, blaze_powder: 1 } }] };
  const stage = nextGameStage(bot, goal);
  assert.equal(stage.action, 'find_stronghold', JSON.stringify(stage));
});
