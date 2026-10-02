'use strict';
// Note 949: 25594 (mid-242-xa-fortress-5, 2026-10-02 22:10 to 22:20Z), its
// portal on an island 21 blocks off across open air and no block carried,
// took the tunnel home at 0.86, stopped at the gap each time, and the held
// tunnel kept blocks_then_cross off the question.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');

test('the tunnel home says the open air on its line against the blocks carried', async () => {
  const { returnFromNether } = require('../src/work');
  const { setAside } = require('../src/progress');
  const registry = require('minecraft-data')('26.1');
  const portal = new Vec3(25, 71, 0);
  const bot = Object.assign(new EventEmitter(), { registry, entity: { position: new Vec3(0.5, 71, 0.5), isInWater: false }, game: { dimension: 'the_nether', gameMode: 'survival' }, oxygenLevel: 20,
    health: 20, food: 20, entities: {}, world: { raycast: () => null },
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1, type: registry.itemsByName.iron_pickaxe.id }] },
    findBlocks: ({ matching }) => matching.includes(registry.blocksByName.nether_portal.id) ? [portal] : [],
    blockAt: p => {
      const f = p.floored();
      const name = f.equals(portal) ? 'nether_portal' : f.y <= 30 ? 'lava' : f.y === 70 && (f.x <= 4 || (f.x >= 23 && f.x <= 27)) ? 'netherrack' : f.y < 70 && f.x <= 4 ? 'netherrack' : 'air';
      return { name, boundingBox: name === 'netherrack' ? 'block' : 'empty', diggable: true, position: f, digTime: () => 400 };
    },
    clearControlStates() {}, getControlState() { return false; }, setControlState() {}, stopDigging() {}, canDigBlock: () => true, digTime: () => 400 });
  bot.pathfinder = { movements: {}, setGoal() {}, isMoving: () => false, goto: async () => { throw Object.assign(new Error('No path'), { name: 'NoPath' }); } };
  const task = new Task('back'), asked = [], picks = ['wait_rest'];
  task.opportunityClient = { systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } };
  const goal = { survival: {} };
  setAside(goal, 'staircase', { x: 24, y: 64, z: 0 }, 'no floor to step onto', 600000);
  await assert.rejects(returnFromNether(bot, task, goal, () => {}), err => err.name === 'WaysResting');
  const { options } = asked[0];
  assert.ok(options.tunnel_home, `offered: ${Object.keys(options)}`);
  assert.match(options.tunnel_home, /Its line at this height crosses about \d+ cells of open air to floor in the next \d+, against 0 blocks carried; inside the rock it digs the blocks for its floor from its own walls, over open air there is no wall to dig: it stops at the gap where the blocks carried run out\./);
});
