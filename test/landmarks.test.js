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
  assert.equal(bot.said.length, 1);
  assert.match(bot.said[0], /ruined portal at 20, 20 \(2 obsidian\)/);
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
