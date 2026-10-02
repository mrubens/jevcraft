'use strict';
// Note 866: a tunnel home chosen and making ground goes on from where it
// stopped, before any walk; with no ground made it ends and rests. 25597
// tunnelled fifty blocks toward its portal and was walked back down its own
// tunnel by the next pass's walk, twice.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');

function fixture() {
  const registry = require('minecraft-data')('26.1');
  const portal = new Vec3(100, 70, 0);
  const bot = Object.assign(new EventEmitter(), { registry, entity: { position: new Vec3(0.5, 70, 0.5), isInWater: false }, game: { dimension: 'the_nether', gameMode: 'survival' }, oxygenLevel: 20,
    health: 20, food: 20, entities: {}, world: { raycast: () => null },
    inventory: { items: () => [{ name: 'netherrack', count: 64, type: 1 }, { name: 'iron_pickaxe', count: 1, type: registry.itemsByName.iron_pickaxe.id }] },
    findBlocks: () => [], blockAt: p => ({ name: p.y < 70 ? 'netherrack' : 'air', boundingBox: p.y < 70 ? 'block' : 'empty', diggable: true, position: p }),
    clearControlStates() {}, getControlState() { return false; }, setControlState() {}, stopDigging() {} });
  let walks = 0;
  bot.pathfinder = { movements: {}, setGoal() {}, isMoving: () => false, goto: async () => { walks++; throw Object.assign(new Error('No path'), { name: 'NoPath' }); } };
  return { bot, portal, walks: () => walks };
}

test('a tunnel home held goes on before any walk, and is kept while it makes ground (note 866)', async t => {
  const { returnFromNether } = require('../src/work');
  const bridging = require('../src/bridging');
  const { bot, portal, walks } = fixture();
  const runs = [];
  t.mock.method(bridging, 'tunnelStraight', async (b, task, target) => { runs.push([target.x, target.z]); b.entity.position = b.entity.position.offset(30, 0, 0); return { steps: 30, laid: 0, arrived: false }; });
  const goal = { survival: {}, portals: [{ x: portal.x, y: portal.y, z: portal.z, dimension: 'nether' }], tunnelHome: { x: portal.x, y: portal.y, z: portal.z, at: Date.now() } };
  await returnFromNether(bot, new Task('back'), goal, () => {});
  assert.deepEqual(runs, [[100, 0]]);
  assert.equal(walks(), 0, 'no walk before the tunnel');
  assert.ok(goal.tunnelHome, 'kept: it made thirty blocks');
  assert.equal(goal.step.action, 'tunnel_home');
});

test('a tunnel home held that makes no ground ends and rests five minutes (note 866)', async t => {
  const { returnFromNether } = require('../src/work');
  const bridging = require('../src/bridging');
  const { isSetAside } = require('../src/progress');
  const { bot, portal } = fixture();
  t.mock.method(bridging, 'tunnelStraight', async () => { throw new Error('The tunnel stopped 100 blocks from its target after 0 blocks: level: lava in the way'); });
  const goal = { survival: {}, portals: [{ x: portal.x, y: portal.y, z: portal.z, dimension: 'nether' }], tunnelHome: { x: portal.x, y: portal.y, z: portal.z, at: Date.now() } };
  const task = new Task('back');
  task.opportunityClient = { systemOne: async ({ questions }) => ({ answers: { branch_0: { choice: Object.keys(questions.branch_0.criteria)[0], confidence: 0.9 } } }) };
  // The ways after it are the old flow's, and in this bare world they fail: the hold's end is what is read.
  try { await returnFromNether(bot, task, goal, () => {}); } catch (_) { /* the walk and the staircase after it */ }
  assert.equal(goal.tunnelHome, undefined);
  assert(isSetAside(goal, 'tunnel_home', 'nether'));
});
