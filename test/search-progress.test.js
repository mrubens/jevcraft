'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3'), { Task } = require('../src/skills');
const { acquireStep, explore } = require('../src/work');

function fixture() {
  const registry = require('minecraft-data')('26.1'), target = new Vec3(1, 63, 0);
  let removed = false, collected = 0;
  const bot = { registry, game: { gameMode: 'survival' }, entities: {}, entity: { position: new Vec3(.5, 64, .5) },
    inventory: { items: () => collected ? [{ name: 'sand', count: collected, type: registry.itemsByName.sand.id }] : [] },
    blockAt: p => {
      const name = p.y >= 64 || removed && p.equals(target) ? 'air' : p.equals(target) ? 'sand' : 'stone';
      return { name, position: p, type: registry.blocksByName[name].id, boundingBox: name === 'air' ? 'empty' : 'block', diggable: true, digTime: () => 1 };
    },
    canDigBlock: () => true,
    dig: async () => { removed = true; collected++; },
    findBlocks: ({ matching }) => matching.includes(registry.blocksByName.grass_block.id) ? [new Vec3(10, 63, 0)] :
      matching.includes(registry.blocksByName.sand.id) && !removed ? [target] : [],
    pathfinder: { movements: {}, setGoal() {}, goto: async g => { bot.entity.position = new Vec3(g.x + .5, g.y, g.z + .5); } },
  };
  const goal = { search: { sand: { attempts: 128, leg: 15, origin: { x: -50, y: 64, z: -50 }, progressLeg: 15 } } };
  return { bot, goal, task: new Task('continue searching') };
}

test('actual pickup renews an exhausted resource search and searches onward for the remaining quantity', async () => {
  const { bot, goal, task } = fixture();
  await acquireStep(bot, task, 'sand', 2, goal, () => {});
  assert.equal(goal.search.sand.attempts, 0);
  assert.equal(goal.search.sand.lastPickup.count, 1);
  assert.deepEqual(goal.search.sand.origin, { x: 0, y: 64, z: 0 });
  await explore(bot, task, goal, () => {}, 'sand');
  assert.equal(goal.search.sand.attempts, 1);
  assert.equal(bot.entity.position.x, 10.5);
});

test('failed digging without pickup does not renew an exhausted search', async () => {
  const { bot, goal, task } = fixture();
  bot.dig = async () => { throw new Error('Block stayed in the world'); };
  await assert.rejects(acquireStep(bot, task, 'sand', 2, goal, () => {}), /128 exploration steps without collecting/);
  assert.equal(goal.search.sand.attempts, 128);
  assert.equal(goal.search.sand.lastPickup, undefined);
});
