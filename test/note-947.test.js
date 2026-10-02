'use strict';
// Note 947: 25590 (mid-242-ua-fortress-5, 2026-10-02 21:48 to 22:12Z) stood
// in a pocket 36 over its portal, one across; the walk found only a drop,
// the staircase rested, and portal_way offered going round or waiting:
// tunnel_home was offered only more than six across.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');

test('the portal close across but far below: the tunnel home is offered, priced for the way down', async () => {
  const { returnFromNether } = require('../src/work');
  const { setAside } = require('../src/progress');
  const registry = require('minecraft-data')('26.1');
  const portal = new Vec3(-19, 71, 19);
  const bot = Object.assign(new EventEmitter(), { registry, entity: { position: new Vec3(-17.5, 107, 19.5), isInWater: false }, game: { dimension: 'the_nether', gameMode: 'survival' }, oxygenLevel: 20,
    health: 20, food: 20, entities: {}, world: { raycast: () => null },
    inventory: { items: () => [{ name: 'cobblestone', count: 10, type: 1 }, { name: 'iron_pickaxe', count: 1, type: registry.itemsByName.iron_pickaxe.id }] },
    findBlocks: ({ matching }) => matching.includes(registry.blocksByName.nether_portal.id) ? [portal] : [],
    blockAt: p => {
      const f = p.floored(), name = f.equals(portal) ? 'nether_portal' : (f.y >= 103 && f.y <= 105) || (f.y >= 107 && f.y <= 108 && f.x >= -19 && f.x <= -18 && f.z === 19) ? 'air' : 'netherrack';
      return { name, boundingBox: name === 'netherrack' ? 'block' : 'empty', diggable: true, position: f, digTime: () => 400 };
    },
    clearControlStates() {}, getControlState() { return false; }, setControlState() {}, stopDigging() {}, canDigBlock: () => true, digTime: () => 400 });
  bot.pathfinder = { movements: {}, setGoal() {}, isMoving: () => false, goto: async () => { throw Object.assign(new Error('No path'), { name: 'NoPath' }); } };
  const task = new Task('back'), asked = [], picks = ['wait_rest'];
  task.opportunityClient = { systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } };
  const goal = { survival: {} };
  setAside(goal, 'staircase', { x: -24, y: 64, z: 16 }, 'the way passes along a drop that would kill', 600000);
  await assert.rejects(returnFromNether(bot, task, goal, () => {}), err => err.name === 'WaysResting');
  assert.equal(asked.length, 1);
  const { options } = asked[0];
  assert.ok(options.tunnel_home, `offered: ${Object.keys(options)}`);
  assert.match(options.tunnel_home, /^Dig a tunnel straight at the portal through the rock, two high and one wide: a step down with each block until level with it \(36 below\)/);
  assert.match(options.tunnel_home, /about 54 seconds for 2 blocks of the 2 to the portal and the 36 down,/);
});
