'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { enterEnd } = require('../src/end-portal');
const { Task } = require('../src/skills');

// 25594 (2026-10-04 02:27Z): the ring seen at (604, -37, 1540) from (778, 85, 1660).
function far({ route = 'noPath' } = {}) {
  const bot = { registry, entity: { position: new Vec3(778.5, 85, 1660.5) }, entities: {},
    game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, health: 20, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'ender_eye', count: 12 }, { name: 'iron_pickaxe', count: 1 }] },
    // The ring's chunks are not loaded from here.
    blockAt: p => Math.hypot(p.x - 778, p.z - 1660) > 64 ? null : { name: p.y < 85 ? 'stone' : 'air', position: p.floored(), boundingBox: p.y < 85 ? 'block' : 'empty' },
    world: { raycast: () => null }, pathfinder: { movements: { canDig: true, scafoldingBlocks: [1], allow1by1towers: true }, getPathTo: () => ({ status: route, path: [] }), setGoal() {} },
    clearControlStates() {}, setControlState() {} };
  const goal = { kind: 'win', endPortal: { center: { x: 604, y: -37, z: 1540 }, frames: [] }, gameProgress: { milestones: { stronghold_located: { at: 1 } } } };
  return { bot, goal };
}

test('far from the End portal\'s ring and it out of view, the step goes to it: the stair dug toward a place beside it (note 1161)', async () => {
  const { bot, goal } = far();
  const calls = [];
  await enterEnd(bot, new Task('enter'), goal, () => {}, { navigate: async () => calls.push('walk'), tunnel: async (b, t, g, s, target, resource) => calls.push({ target: [target.x, target.y, target.z], resource }) });
  assert.deepEqual(calls, [{ target: [607, -36, 1540], resource: 'end_portal' }]);
  assert.equal(goal.step.action, 'go_to_end_portal');
  assert.deepEqual([goal.step.blocksOff, goal.step.blocksUnder], [211, 122]);
});

test('where a walk to it is found, it is walked; with no way to dig, the step says the ring is out of view as before', async () => {
  const walked = far({ route: 'success' });
  const calls = [];
  await enterEnd(walked.bot, new Task('enter'), walked.goal, () => {}, { navigate: async () => calls.push('walk'), tunnel: async () => calls.push('tunnel') });
  assert.deepEqual(calls, ['walk']);
  const none = far();
  await assert.rejects(enterEnd(none.bot, new Task('enter'), none.goal, () => {}, { navigate: async () => {} }), /not fully visible/);
});
