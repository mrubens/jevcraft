'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { sculkAbout, hearing } = require('../src/sculk');

// mid-230-n ran from a creeper into the deep dark, worked beside four sensors and a shrieker, and the warden it called killed it (2026-09-27).
function world({ canSummon = 'true' } = {}) {
  const registry = require('minecraft-data')('26.1');
  const at = { sensor: new Vec3(4, -27, 1), shrieker: new Vec3(5, -29, -4) };
  const bot = { registry, entity: { position: new Vec3(0.5, -25, 0.5) }, _shrieks: [Date.now() - 60000, Date.now() - 20000],
    findBlocks: ({ matching, maxDistance }) => {
      const out = [];
      if (matching.includes(registry.blocksByName.sculk_sensor.id)) out.push(at.sensor);
      if (matching.includes(registry.blocksByName.sculk_shrieker.id)) out.push(at.shrieker);
      return out.filter(p => p.distanceTo(bot.entity.position) <= maxDistance);
    },
    blockAt: p => ({ position: p, name: p.equals(at.shrieker) ? 'sculk_shrieker' : 'stone', getProperties: () => (p.equals(at.shrieker) ? { can_summon: canSummon } : {}) }) };
  return bot;
}

test('sculk near is said: the sensors and what they hear, the shrieker that calls a warden, and the warnings so far', () => {
  const said = sculkAbout(world());
  assert.equal(said.sensors, 1); assert.equal(said.shriekers, 1); assert.equal(said.withinHearing, true);
  assert.match(said.says, /1 sculk sensor, the nearest 4 blocks off \(within its hearing\); 1 sculk shrieker that can call a warden, the nearest 8 blocks off/);
  assert.match(said.says, /the fourth within about ten minutes calls a warden/);
  assert.match(said.says, /warned 2 times in the last ten minutes/);
  // A shrieker a player set down calls nothing.
  assert.equal(sculkAbout(world({ canSummon: 'false' })).shriekers, 0);
});

test('the retreat can tell a footing within a sensor\'s hearing from one out of it', () => {
  const heard = hearing(world(), 40);
  assert.equal(heard(new Vec3(6, -25, 1)), true);
  assert.equal(heard(new Vec3(20, -25, 1)), false);
});

test('every question about playing the game is told of the sculk near', async () => {
  const { decide } = require('../src/decisions');
  let seen = null, said = null;
  const client = { systemOne: async ({ state, rootInstructions }) => { seen = state; said = rootInstructions; return { answers: { branch_0: { choice: 'stay', confidence: 0.9 } } }; } };
  const bot = Object.assign(world(), { game: { dimension: 'overworld' } });
  await decide('pocket_next', { client, bot, goal: {}, tree: { stay: { description: 'a' }, leave: { description: 'b' } }, state: {} });
  assert.match(seen.sculk || '', /sculk shrieker that can call a warden/);
});

test('by sculk, the work asks Jev: carry on, carry on crouched, or move the work out of its reach', async () => {
  // mid-230-n made its obsidian four blocks over a shrieker, and the warden it called killed it (2026-09-27).
  const { sculkStep } = require('../src/work');
  const { Task } = require('../src/skills');
  const registry = require('minecraft-data')('26.1');
  const sensor = new Vec3(4, -27, 1), quiet = new Vec3(20, -26, 1);
  const bot = { registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, -25, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, entities: {}, health: 20, food: 20, oxygenLevel: 20,
    inventory: { items: () => [], slots: [] }, on() {}, removeListener() {}, clearControlStates() {}, setControlState() {}, stopDigging() {},
    findBlocks: ({ matching, maxDistance }) => {
      if (matching.includes(registry.blocksByName.sculk_sensor.id)) return [sensor].filter(p => p.distanceTo(bot.entity.position) <= maxDistance);
      if (matching.includes(registry.blocksByName.sculk_shrieker.id)) return [];
      return [quiet, new Vec3(3, -26, 1)];
    },
    blockAt: p => ({ position: p, name: 'air', boundingBox: 'empty' }) };
  let asked = null;
  const client = { systemOne: async ({ questions, state }) => { asked = { questions, state }; return { answers: { branch_0: { choice: 'move_away', confidence: 0.9 } } }; } };
  const goal = { kind: 'win', step: { action: 'make_obsidian', item: 'obsidian' } };
  let walked = null;
  bot.pathfinder = { movements: {}, setGoal() {}, isMoving: () => false, goto: async g => { walked = g; bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); } };
  const moved = await sculkStep(bot, new Task('work'), goal, () => {}, client);
  assert.deepEqual(Object.keys(asked.questions.branch_0.criteria).sort(), ['carry_on', 'move_away', 'work_crouched']);
  assert.match(JSON.stringify(asked.questions.branch_0.criteria.move_away), /walk to a place 20 blocks off, out of every sensor's hearing/);
  assert.equal(moved, true);
  assert.equal(goal.quietZones?.length, 1, 'the patch is set aside');
  // Its lava and landmarks are passed over while it rests.
  const { inQuietZone } = require('../src/sculk');
  assert.equal(inQuietZone(goal, { x: 4, y: -26, z: 1 }), true);
  assert.equal(inQuietZone(goal, { x: 40, y: -26, z: 1 }), false);
  // Asked once per patch while the answer holds.
  asked = null;
  bot.entity.position = new Vec3(0.5, -25, 0.5);
  assert.equal(await sculkStep(bot, new Task('work'), goal, () => {}, client), false);
  assert.equal(asked, null);
});

test('chosen, crouched work holds the crouch while walking, in the Overworld too', async () => {
  const { EventEmitter } = require('node:events');
  const { navigate, Task } = require('../src/skills');
  const { goals } = require('mineflayer-pathfinder');
  const controls = {};
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld' }, health: 20, oxygenLevel: 20, entities: {}, _quietUntil: Date.now() + 60000,
    entity: { position: new Vec3(0.5, -25, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, controlState: controls,
    setControlState: (k, v) => { controls[k] = v; }, clearControlStates() {}, stopDigging() {},
    blockAt: p => { const q = p.floored(); return { name: q.y < -25 ? 'deepslate' : 'air', position: q, boundingBox: q.y < -25 ? 'block' : 'empty' }; },
    pathfinder: { movements: {}, setGoal() {}, isMoving: () => true, goal: null, goto: () => new Promise(r => setTimeout(r, 300)) } });
  const walking = navigate(bot, new Task('quiet'), new goals.GoalBlock(0, -25, 10), { timeoutMs: 400, stallMs: 300 }).catch(() => {});
  for (let i = 0; i < 20 && !bot.listenerCount('physicsTick'); i++) await new Promise(r => setTimeout(r, 5));
  bot.emit('physicsTick');
  assert.equal(controls.sneak, true);
  bot._quietUntil = 0; bot.emit('physicsTick');
  assert.equal(controls.sneak, false, 'let go when the quiet ends');
  await walking;
});
