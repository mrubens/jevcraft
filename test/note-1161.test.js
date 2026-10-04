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

test('far from the End portal\'s ring and it out of view, the step goes to it: over the ground, and the stair dug toward a place beside it from near (notes 1161, 1171)', async () => {
  const { bot, goal } = far();
  const calls = [];
  await enterEnd(bot, new Task('enter'), goal, () => {}, { navigate: async () => calls.push('walk'), tunnel: async (b, t, g, s, target, resource) => calls.push({ target: [target.x, target.y, target.z], resource }) });
  // The walk over the ground first, a leg toward the place over the ring; it gained nothing here (the stub does not move), and this far off the stair is not dug from here (note 1171).
  assert.deepEqual(calls, ['walk']);
  assert.equal(goal.step.way, 'surface');
  // Seventy blocks off, a leg that gains nothing gives way to the stair.
  const nearer = far(); nearer.bot.entity.position = new Vec3(654.5, 85, 1590.5);
  nearer.bot.blockAt = p => Math.hypot(p.x - 654, p.z - 1590) > 40 ? null : { name: p.y < 85 ? 'stone' : 'air', position: p.floored(), boundingBox: p.y < 85 ? 'block' : 'empty' };
  const dug = [];
  await enterEnd(nearer.bot, new Task('enter'), nearer.goal, () => {}, { navigate: async () => dug.push('walk'), tunnel: async (b, t2, g, s, target, resource) => dug.push({ target: [target.x, target.y, target.z], resource }) });
  assert.deepEqual(dug, ['walk', { target: [607, -36, 1540], resource: 'end_portal' }]);
  assert.equal(goal.step.action, 'go_to_end_portal');
  assert.deepEqual([goal.step.blocksOff, goal.step.blocksUnder], [211, 122]);
});

test('where a walk to it is found, it is walked; with no way to dig, the step says the ring is out of view as before', async () => {
  const walked = far({ route: 'success' });
  const calls = [];
  await enterEnd(walked.bot, new Task('enter'), walked.goal, () => {}, { navigate: async (b2, t2, g) => { calls.push('walk'); walked.bot.entity.position = new Vec3(g.x + .5, g.y, g.z + .5); }, tunnel: async () => calls.push('tunnel') });
  assert.deepEqual(calls, ['walk']);
  const none = far();
  await assert.rejects(enterEnd(none.bot, new Task('enter'), none.goal, () => {}, { navigate: async () => {} }), /not fully visible/);
});

test('far off across the ground, the leg walked over the surface is the step, and the stair waits until the bot is over the ring (note 1168)', async () => {
  const { bot, goal } = far();
  const calls = [];
  await enterEnd(bot, new Task('enter'), goal, () => {}, { navigate: async (b, t, leg) => { calls.push(['walk', leg.x, leg.z]); bot.entity.position = new Vec3(leg.x + .5, 85, leg.z + .5); }, tunnel: async () => calls.push('tunnel') });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'walk');
  assert.ok(Math.hypot(calls[0][1] - 604, calls[0][2] - 1540) < Math.hypot(778 - 604, 1660 - 1540) - 40, 'forty blocks or more nearer the place over the ring');
  // Underground already, it is the stair as before.
  const under = far(); under.bot.entity.position = new Vec3(778.5, 20, 1660.5);
  const dug = [];
  await enterEnd(under.bot, new Task('enter'), under.goal, () => {}, { navigate: async () => dug.push('walk'), tunnel: async () => dug.push('tunnel') });
  assert.deepEqual(dug, ['tunnel']);
});

test('far off and under the ground, the step goes up to the surface first; near under it, the stair goes on (note 1170)', async () => {
  const deep = far(); deep.bot.entity.position = new Vec3(1069.5, -36, 1326.5);
  deep.bot.blockAt = p => Math.hypot(p.x - 1069, p.z - 1326) > 64 ? null : { name: p.y < 70 ? 'deepslate' : 'air', position: p.floored(), boundingBox: p.y < 70 ? 'block' : 'empty', skyLight: 0 };
  const calls = [];
  await enterEnd(deep.bot, new Task('enter'), deep.goal, () => {}, { navigate: async () => calls.push('walk'), tunnel: async () => calls.push('tunnel'), surfaceStep: async () => calls.push('surface') });
  assert.deepEqual(calls, ['surface']);
  assert.equal(deep.goal.step.way, 'up to the surface first');
  const close = far(); close.bot.entity.position = new Vec3(650.5, -30, 1560.5);
  close.bot.blockAt = p => Math.hypot(p.x - 650, p.z - 1560) > 20 ? null : { name: p.y < 70 ? 'deepslate' : 'air', position: p.floored(), boundingBox: p.y < 70 ? 'block' : 'empty' };
  const dug = [];
  await enterEnd(close.bot, new Task('enter'), close.goal, () => {}, { navigate: async () => dug.push('walk'), tunnel: async () => dug.push('tunnel'), surfaceStep: async () => dug.push('surface') });
  assert.deepEqual(dug, ['tunnel'], 'fifty blocks off: the stair, not the climb');
});

test('four blocks from the ring\'s middle and six over it in the rock, the stair goes on: that is not beside it (note 1178)', async () => {
  const { bot, goal } = far();
  bot.entity.position = new Vec3(608.5, -31, 1540.5);
  bot.blockAt = p => ({ name: 'deepslate', position: p.floored(), boundingBox: 'block' });
  const calls = [];
  await enterEnd(bot, new Task('enter'), goal, () => {}, { navigate: async () => calls.push('walk'), tunnel: async (b, t2, g, s, target) => calls.push([target.x, target.y, target.z]) });
  assert.deepEqual(calls, [[607, -36, 1540]]);
  assert.equal(goal.step.action, 'go_to_end_portal');
});

test('the stair stopped at the portal room\'s wall, seven blocks from the ring: the two cells toward it are dug and stepped through (note 1178)', async () => {
  const { bot, goal } = far();
  bot.entity.position = new Vec3(606.5, -36, 1547.5);
  bot.blockAt = p => ({ name: p.floored().z === 1546 ? 'iron_bars' : 'air', position: p.floored(), boundingBox: p.floored().z === 1546 ? 'block' : 'empty' });
  bot.pathfinder.getPathTo = () => ({ status: 'noPath', path: [] });
  const dug = [], walked = [];
  // The ring is not in view from outside its wall.
  await enterEnd(bot, new Task('enter'), goal, () => {}, { navigate: async (b, t2, g) => walked.push([g.x, g.y, g.z]), tunnel: async () => {}, dig: async (b, t2, c) => dug.push([c.x, c.y, c.z]) });
  assert.deepEqual(dug, [[606, -35, 1546], [606, -36, 1546]]);
  assert.deepEqual(walked, [[606, -36, 1546]]);
  assert.equal(goal.step.way, 'through the wall of its room');
});

test('an infested block in the room\'s wall is not the one dug through: it lets a silverfish out (note 1178)', async () => {
  const { bot, goal } = far();
  bot.entity.position = new Vec3(606.5, -36, 1547.5);
  bot.blockAt = p => ({ name: p.floored().z === 1546 ? (p.floored().y === -35 ? 'infested_stone_bricks' : 'stone_bricks') : 'air', position: p.floored(), boundingBox: p.floored().z === 1546 ? 'block' : 'empty' });
  bot.pathfinder.getPathTo = () => ({ status: 'noPath', path: [] });
  const dug = [];
  await enterEnd(bot, new Task('enter'), goal, () => {}, { navigate: async () => {}, tunnel: async () => {}, dig: async (b, t2, c) => dug.push([c.x, c.y, c.z]) }).catch(() => {});
  assert.deepEqual(dug, [[606, -36, 1546]]);
});

test('the stair to the ring\'s east side set aside, the next side\'s is dug; with all four set aside the error stands (note 1221)', async () => {
  const { bot, goal } = far();
  bot.entity.position = new Vec3(608.5, -31, 1540.5);
  bot.blockAt = p => ({ name: 'deepslate', position: p.floored(), boundingBox: 'block' });
  const calls = [];
  const tunnel = async (b, t2, g, s, target) => { calls.push([target.x, target.y, target.z]); if (calls.length === 1) throw new Error('The staircase toward (607, -36, 1540) is set aside (3 rounds without getting closer than 4 blocks); trying another way'); };
  await enterEnd(bot, new Task('enter'), goal, () => {}, { navigate: async () => {}, tunnel });
  assert.deepEqual(calls, [[607, -36, 1540], [601, -36, 1540]]);
  const all = far(); all.bot.entity.position = new Vec3(608.5, -31, 1540.5);
  all.bot.blockAt = bot.blockAt;
  let n = 0;
  await assert.rejects(enterEnd(all.bot, new Task('enter'), all.goal, () => {}, { navigate: async () => {}, tunnel: async () => { n++; throw new Error('The staircase is set aside'); } }), /set aside/);
  assert.equal(n, 4);
});
