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
