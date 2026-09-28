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

test('a warped forest beyond the block search is found by the loaded chunks\' biome', () => {
  const { DETECTORS } = require('../src/exploration');
  const detect = DETECTORS.find(d => d.kind === 'warped_forest').detect;
  const warped = registry.biomesByName.warped_forest.id, wastes = registry.biomesByName.nether_wastes.id;
  const bot = { registry, entity: { position: new Vec3(0.5, 64, 0.5) }, findBlocks: () => [],
    blockAt: p => ({ position: p, name: 'netherrack', biome: { id: p.x >= 90 && p.z >= 30 ? warped : wastes } }) };
  const found = detect(bot);
  assert(found && found.biome, JSON.stringify(found));
  assert.equal(found.x, 96); assert.equal(found.z, 32);
  bot.blockAt = p => ({ position: p, name: 'netherrack', biome: { id: wastes } });
  assert.equal(detect(bot), null);
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
  assert.equal(nextGameStage(bot, goal).via, 'warped_forest', 'none known yet: back through the portal to look for one');
  setAside(goal, 'rung', 'warped_search', 'none found', 600000);
  assert.equal(nextGameStage(bot, goal).action, 'pearl_patrol', 'the search rested: endermen on sight, an expedition or exploring between');
  goal.landmarks = [{ kind: 'warped_forest', x: 300, y: 70, z: 40, dimension: 'nether' }];
  const stage = nextGameStage(bot, goal);
  assert.equal(stage.action, 'enter_nether'); assert.equal(stage.via, 'warped_forest', 'one remembered: go there');
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

test('a walk that fails at once is not a leg: the sweep tunnels on and gives up only after real tries', async () => {
  const { bot, goal } = fixture('the_nether');
  let tunnels = 0;
  const actions = { navigate: async () => {}, tunnel: async () => { tunnels++; }, acquireStep: async () => {}, notice: () => {} };
  for (let i = 0; i < 10; i++) await warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 12 });
  assert.equal(tunnels, 10, 'each stuck walk goes on through the netherrack');
  assert.equal(goal.warpedSearch.legs, 0, 'and ten stuck tries are not ten legs');
  assert(warped.warpedOpen(goal), 'the search is still on');
  for (let i = 0; i < 30; i++) await warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 12 });
  assert(warped.warpedOpen(goal), 'forty quick tries are not a search spent');
  await warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 12 }, { now: () => Date.now() + 16 * 60000 });
  assert.equal(warped.warpedOpen(goal), false, 'a quarter of an hour without a forest: it rests');
});

test('the pearl patrol hunts an enderman in view, and otherwise goes on an expedition or explores', () => {
  const { patrolChoice } = require('../src/work');
  const bot = { entity: { position: new Vec3(0, 64, 0) }, entities: {} };
  assert.equal(patrolChoice(bot, { explore: {}, deep_dark: {} }), 'deep_dark');
  assert.equal(patrolChoice(bot, { explore: {} }), 'explore');
  assert.equal(patrolChoice(bot, {}), 'search', 'nothing else to do: the search as before');
  bot.entities[4] = { name: 'enderman', position: new Vec3(30, 64, 0), isValid: true };
  assert.equal(patrolChoice(bot, { explore: {}, deep_dark: {} }), 'hunt', 'the fun part');
});

test('a warped forest whose walk came to nothing is not walked to again at once, twenty times a second: the sweep looks for another, and with the sweep resting the pearls go the old way (mid-244-ad-nether-3, note 583)', async () => {
  // mid-244-ad-nether-3 (and mid-242-ae-nether-2 and -3-fortress-1): a forest seen across the lava sea 127 blocks off,
  // the walk there came no nearer, the trip was set aside half an hour, and warped_pearls then returned at once on
  // every pass (the forest still counted as known, its walk refused), "No measurable progress" every two seconds.
  const { bot, goal } = fixture('the_nether');
  goal.landmarks = [{ kind: 'warped_forest', x: 153, y: 63, z: -217, dimension: 'nether' }];
  const walks = [];
  const actions = { navigate: async (b, t, g) => { walks.push([g.x, g.z]); throw new Error('No path to the goal!'); }, tunnel: async () => {}, acquireStep: async () => assert.fail('no hunt short of the forest'), notice: () => {} };
  await assert.rejects(warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 16 }),
    /^Error: The walk to the warped forest at \(153, -217\), 266 blocks off, came no nearer: No path to the goal!; that walk rests half an hour$/, 'the step\'s own failure, said');
  assert.equal(walks.length, 1, 'walked there once');
  assert.match(goal.tried.entries.find(e => e.q === 'step' && e.method === 'warped_pearls').why, /^The walk to the warped forest/, 'in the ledger');
  const forest = goal.landmarks[0];
  assert.equal(forest.lastWalk.why, 'No path to the goal!', 'how the walk ended is kept with the place');
  assert.equal(forest.lastWalk.began, 266);
  // The next pass: not the resting walk refused and returned, but the sweep for another forest.
  await warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 16 });
  assert.equal(goal.step.action, 'warped_search', 'the sweep for another forest, not the refused walk again');
  assert(warped.warpedOpen(goal));
  setAside(goal, 'rung', 'warped_search', 'none found', 600000);
  assert.equal(warped.warpedOpen(goal), false, 'the forest\'s walk resting and the sweep resting: not open');
  assert.equal(nextGameStage(bot, goal).action, 'return_overworld', 'home the old way, not the pearl step spinning');
});
