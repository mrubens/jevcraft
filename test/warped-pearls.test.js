'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const { nextGameStage, observeProgress } = require('../src/game-progress');
const warped = require('../src/warped-pearls');
const { setAside } = require('../src/progress');

const KIT = ['white_bed', 'diamond_pickaxe', 'iron_sword', 'diamond_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots', 'bow']
  .map(name => ({ name, count: 1 })).concat({ name: 'arrow', count: 16 }, { name: 'blaze_rod', count: 8 });
function fixture(dimension) {
  const items = [...KIT];
  const bot = { registry, game: { dimension, gameMode: 'survival' }, health: 20, food: 20, isAlive: true, entities: {}, chat() {},
    entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => items } };
  const goal = { kind: 'win' }; observeProgress(bot, goal);
  return { bot, goal };
}

test('a warped forest is warped nylium and stems in the Nether', () => {
  const { DETECTORS } = require('../src/exploration');
  const detect = DETECTORS.find(d => d.kind === 'warped_forest').detect;
  const blocks = Array.from({ length: 30 }, (_, i) => new Vec3(i, 60, 0));
  const bot = { registry, findBlocks: ({ matching }) => matching.includes(registry.blocksByName.warped_nylium.id) ? blocks : [] };
  assert.equal(detect(bot).warped, 30);
});

test('in the Nether with the rods in hand, the pearls come from the warped forest before the walk back', () => {
  const { bot, goal } = fixture('the_nether');
  assert.equal(nextGameStage(bot, goal).action, 'warped_pearls', 'none known: the sweep for one');
  setAside(goal, 'rung', 'warped_search', 'none found', 600000);
  assert.equal(nextGameStage(bot, goal).action, 'return_overworld', 'the sweep rested and none known: home the old way');
  goal.landmarks = [{ kind: 'warped_forest', x: 300, y: 70, z: 40, dimension: 'nether' }];
  assert.equal(nextGameStage(bot, goal).action, 'warped_pearls', 'one remembered: go there');
});

test('in the Overworld, a remembered warped forest sends the bot back through the portal for pearls', () => {
  const { bot, goal } = fixture('overworld');
  assert.equal(nextGameStage(bot, goal).action, 'acquire', 'none known: the Overworld hunt, as before');
  goal.landmarks = [{ kind: 'warped_forest', x: 300, y: 70, z: 40, dimension: 'nether' }];
  const stage = nextGameStage(bot, goal);
  assert.equal(stage.action, 'enter_nether'); assert.equal(stage.via, 'warped_forest');
});

test('the sweep walks legs of sixty-four and rests after eight without a forest', async () => {
  const { bot, goal } = fixture('the_nether');
  const legs = [];
  const actions = { navigate: async (b, t, g) => { legs.push([g.x, g.z]); b.entity.position = new Vec3(g.x, 64, g.z); }, acquireStep: async () => assert.fail('no hunt without a forest'), notice: () => {} };
  for (let i = 0; i < 9; i++) await warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 12 });
  assert.equal(legs.length, 8);
  assert(Math.hypot(legs[0][0], legs[0][1]) >= 60, 'a sixty-four-block leg');
  assert.equal(warped.warpedOpen(goal), false, 'eight legs and nothing: the search rests');
});
