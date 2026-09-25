'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { markExplored, unexploredArea, noticeLandmarks, knownLandmarks, explorationSummary } = require('../src/exploration');
const { WORLD_FIELDS } = require('../src/world-knowledge');

const world = (blocks = {}, dimension = 'overworld', position = new Vec3(10, 64, 10)) => {
  const said = [];
  const bot = { registry, game: { dimension }, entity: { position }, said, chat: m => said.push(m),
    blockAt: p => { const name = blocks[`${p.x},${p.y},${p.z}`] || (p.y < 64 ? 'stone' : 'air'); return { name, boundingBox: name === 'air' || name === 'lava' ? 'empty' : 'block', position: p }; },
    findBlocks: ({ matching, count = 64 }) => Object.entries(blocks).filter(([, name]) => matching.includes(registry.blocksByName[name]?.id))
      .map(([k]) => new Vec3(...k.split(',').map(Number))).slice(0, count) };
  return bot;
};

test('the area the bot stands in is marked explored, and the next leg goes to the nearest unexplored area around home', () => {
  const bot = world(), goal = {};
  assert.equal(markExplored(bot, goal), true);
  assert.equal(markExplored(bot, goal), false, 'once');
  assert.equal(Object.keys(goal.explored)[0], 'overworld:0,0');
  const next = unexploredArea(bot, goal, { home: { x: 10, z: 10 } });
  assert.notEqual(next.key, 'overworld:0,0');
  assert(next.fromHere <= 91, `a neighbouring area first (${next.fromHere})`);
  const { setAside } = require('../src/progress');
  setAside(goal, 'explore_area', next.key, 'unreachable', 60000);
  assert.notEqual(unexploredArea(bot, goal, { home: { x: 10, z: 10 } }).key, next.key, 'an unreachable area rests');
});

test('landmarks are noticed by their own blocks, remembered once, and said once', () => {
  const blocks = { '20,64,20': 'crying_obsidian', '21,64,20': 'obsidian', '21,65,20': 'obsidian', '22,64,20': 'netherrack' };
  const bot = world(blocks), goal = {};
  noticeLandmarks(bot, goal, () => {}, { force: true });
  assert.equal(goal.landmarks.length, 1);
  assert.equal(goal.landmarks[0].kind, 'ruined_portal');
  assert.equal(goal.landmarks[0].obsidian, 2);
  noticeLandmarks(bot, goal, () => {}, { force: true });
  assert.equal(goal.landmarks.length, 1, 'the same portal is not a second one');
  // Said by the narration, in Jev's voice, from the action: once, not twice.
  assert.equal(bot.said.length, 0);
  assert.match(goal.survivalAction.what, /ruined portal at 20, 20 \(2 obsidian\)/);
  const { narrate, setRandom } = require('../src/narration'); setRandom(() => 0);
  const said = [];
  assert.match(narrate({ chat: l => said.push(l) }, goal, { now: 1000 }), /^Ooh, a ruined portal at 20, 20 \(2 obsidian\)! I'll remember that\.$/);
  assert.equal(knownLandmarks(bot, goal, 'ruined_portal')[0].distance, 14);
  assert.deepEqual(explorationSummary(goal).landmarks, { ruined_portal: 1 });
});

test('in the Nether a fortress is thirty bricks, not three, and a bastion is blackstone with gold', () => {
  const few = {}; for (let i = 0; i < 3; i++) few[`${i},64,30`] = 'nether_bricks';
  const g1 = {}; noticeLandmarks(world(few, 'the_nether'), g1, () => {}, { force: true });
  assert.equal((g1.landmarks || []).length, 0, 'a handful of bricks is the bot\'s own');
  const many = {}; for (let i = 0; i < 30; i++) many[`${i},64,30`] = 'nether_bricks';
  many['50,64,50'] = 'gilded_blackstone'; many['51,64,50'] = 'polished_blackstone_bricks';
  const g2 = {}; noticeLandmarks(world(many, 'the_nether'), g2, () => {}, { force: true });
  assert.deepEqual(g2.landmarks.map(l => l.kind).sort(), ['bastion', 'nether_fortress']);
  assert.equal(g2.landmarks.every(l => l.dimension === 'nether'), true);
});

test('the explored map and the landmarks are the world\'s: every goal after knows them', () => {
  assert(WORLD_FIELDS.includes('explored') && WORLD_FIELDS.includes('landmarks'));
});

test('a remembered fortress is walked back to, not swept for', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { Task } = require('../src/skills');
  const bot = world({}, 'the_nether', new Vec3(0, 64, 0));
  const goal = { landmarks: [{ kind: 'nether_fortress', x: 200, y: 60, z: -40, dimension: 'nether' }] };
  const legs = [];
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { tunnel: async (b, t, g, s, target) => legs.push([target.x, target.z]) });
  assert.deepEqual(legs[0], [200, -40]);
});

test('a trip to a remembered landmark walks there, arrives, and sets aside one the walk makes no ground toward', async () => {
  const { goToLandmark } = require('../src/exploration');
  const { Task } = require('../src/skills');
  const bot = world({}, 'overworld', new Vec3(0, 64, 0));
  const goal = { landmarks: [{ kind: 'lava_pool', x: 100, y: 62, z: 0, dimension: 'overworld' }] };
  const sprinted = [];
  const walk = async (b, t, g, opts) => { sprinted.push(opts.sprint); b.entity.position = new Vec3(g.x, 64, g.z); };
  assert.equal(await goToLandmark(bot, new Task('go'), goal, () => {}, ['lava_pool'], { navigate: walk }), goal.landmarks[0]);
  assert.deepEqual(sprinted, [true], 'a long leg is sprinted');
  const stuck = world({}, 'overworld', new Vec3(0, 64, 0));
  assert.equal(await goToLandmark(stuck, new Task('go'), goal, () => {}, ['lava_pool'], { navigate: async () => {} }), false);
  assert.equal(await goToLandmark(stuck, new Task('go'), goal, () => {}, ['lava_pool'], { navigate: async () => {} }), null, 'set aside, so none to go to');
});

test('with no lava in view the obsidian step goes to a remembered ruined portal before digging down for lava', async () => {
  const { makeObsidian } = require('../src/obsidian');
  const { Task } = require('../src/skills');
  const bot = world({}, 'overworld', new Vec3(0, 64, 0));
  bot.entities = {}; bot.inventory = { items: () => [{ name: 'diamond_pickaxe', count: 1 }, { name: 'water_bucket', count: 1 }] };
  bot.pathfinder = { movements: {} }; bot.world = { raycast: () => null };
  const goal = { landmarks: [{ kind: 'ruined_portal', x: 150, y: 70, z: 20, obsidian: 9, dimension: 'overworld' }] };
  const went = [];
  await makeObsidian(bot, new Task('obsidian'), { action: 'make_obsidian', count: 10 }, goal, () => {}, {
    navigate: async (b, t, g) => { went.push([g.x, g.z]); }, dig: async () => {}, resourceTunnelStep: async () => { went.push('shaft'); }, acquireStep: async () => {} });
  assert.deepEqual(went[0], [150, 20]);
  assert.equal(goal.step.action, 'go_to_landmark');
});

test('with no gold and a bastion remembered, the pearl rung goes for its gold; only gold no piglin can see is taken', () => {
  const { nextGameStage } = require('../src/game-progress');
  const { bastionGold } = require('../src/bartering');
  const items = [{ name: 'blaze_rod', count: 8 }];
  const bot = world({ '10,64,0': 'gold_block', '40,64,0': 'gold_block' }, 'the_nether', new Vec3(0, 64, 0));
  bot.inventory = { items: () => items, slots: {} };
  bot.entities = { 1: { name: 'piglin', position: new Vec3(42, 64, 0), isValid: true } };
  const goal = { kind: 'win', gameProgress: { version: 1, milestones: { nether_entered: { at: 1 } } }, landmarks: [{ kind: 'bastion', x: 30, y: 64, z: 0, dimension: 'nether' }] };
  assert.equal(nextGameStage(bot, goal).action, 'bastion_gold');
  assert.deepEqual(bastionGold(bot).map(p => p.x), [10], 'not the block beside the piglin');
});

test('asked what it has found, Jev answers from the world, and can say where one thing is', async () => {
  const { CompanionMemory } = require('../src/memory');
  const { foundEntries, foundSentence } = require('../src/exploration');
  const known = { explored: { 'overworld:0,0': {}, 'overworld:1,0': {} }, villages: [{ x: 5, y: 64, z: 5, dimension: 'overworld' }],
    landmarks: [{ kind: 'ruined_portal', x: 120, y: 70, z: -40, dimension: 'overworld' }] };
  assert.equal(foundSentence(known), "I've walked 2 areas and found 1 village, 1 ruined portal.");
  const entries = foundEntries(known);
  assert.equal(entries[1].label, 'ruined portal');
  const memory = Object.create(CompanionMemory.prototype);
  assert.match(memory.handle({ from: 'p', memory: { operation: 'recall', targetId: 'found:1', found: entries[1] } }), /ruined portal I found is at 120, 70, -40/);
});

test('navigate sprints only when asked and fed, and puts the setting back', async () => {
  const { navigate, Task } = require('../src/skills');
  const movements = { allowSprinting: false };
  const seen = [];
  const bot = { food: 20, entity: { position: new Vec3(0, 64, 0) }, oxygenLevel: 20, pathfinder: { movements, setGoal() {}, goto: async () => { seen.push(movements.allowSprinting); } }, game: { gameMode: 'survival' }, blockAt: () => ({ name: 'air' }) };
  await navigate(bot, new Task('go'), { x: 1, y: 64, z: 0 }, { sprint: true }).catch(() => {});
  bot.food = 10;
  await navigate(bot, new Task('go'), { x: 1, y: 64, z: 0 }, { sprint: true }).catch(() => {});
  assert.equal(seen[0], true); assert.equal(seen.at(-1), false, 'not when hungry');
  assert.equal(movements.allowSprinting, false, 'restored');
});

test('the bot\'s own portal is not a ruined portal', () => {
  const blocks = { '20,64,20': 'obsidian', '21,64,20': 'obsidian', '22,64,20': 'netherrack' };
  const goal = { portals: [{ x: 21, y: 65, z: 20, dimension: 'overworld' }] };
  noticeLandmarks(world(blocks), goal, () => {}, { force: true });
  assert.equal((goal.landmarks || []).length, 0);
});
