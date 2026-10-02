'use strict';
// Note 948: 25583 (mid-237-cq, 2026-10-02 21:49:44Z), at 1.2 health with
// nothing to eat and its return_for_food chosen two minutes before, was
// asked the rods' stall with another iron patch or the gold ore by it: told
// the food plan stood, and offered no way to go on with it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

async function offered(reason) {
  const { breakStillness } = require('../src/work');
  const ORE = new Vec3(-79, 34, 370);
  const quartz = registry.blocksByName.nether_quartz_ore;
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 1.2, food: 15, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: new Vec3(-77.5, 33, 365.1), onGround: true }, time: { timeOfDay: 0 }, entities: {},
    inventory: { items: () => [{ name: 'stone_pickaxe', count: 1, type: registry.itemsByName.stone_pickaxe.id }], slots: [] },
    findBlocks: ({ matching }) => (matching.includes(quartz.id) ? [ORE] : []), clearControlStates() {}, setControlState() {},
    blockAt: p => p.equals(ORE) ? { position: p, name: 'nether_quartz_ore', boundingBox: 'block', harvestTools: { [registry.itemsByName.stone_pickaxe.id]: true } }
      : { position: p, name: p.y < 33 ? 'netherrack' : 'air', boundingBox: p.y < 33 ? 'block' : 'empty' },
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
  const goal = { version: 1, kind: 'win', request: 'beat the game', survival: {}, portals: [{ x: -20, y: 70, z: 19, dimension: 'nether' }] };
  require('../src/food-plan').begin(goal.survival, bot, { choice: 'food', by: 'survival_priority', key: 'obtain_food/return_for_food', need: 'heal', supply: 0, minutesMs: 4 * 60000, goal });
  const task = new Task('stall');
  let asked = null;
  const client = { model: 'jev', systemOne: async ({ questions }) => { asked = questions.branch_0.criteria; task.cancel(); throw new Error('cancelled'); } };
  const log = console.log; console.log = () => {};
  try { await breakStillness(bot, task, goal, () => {}, { client, survival: { state: goal.survival, canNightMine: () => false }, reason }); } catch (_) { /* cancelled */ } finally { console.log = log; }
  return asked;
}

test('a stall met while the food plan is the trip back through the portal offers going on with it', async () => {
  const asked = await offered('step:rung:obtain_blaze_rods');
  assert.ok(asked?.return_for_food, `offered: ${asked && Object.keys(asked)}`);
  assert.match(asked.return_for_food, /^Go on with the food plan now: back through the portal to the Overworld for food\./);
  assert.match(asked.mine_nearby, /The food plan stands: food first \(return for food\)/);
  // The stall of the trip itself does not offer it again.
  const own = await offered('step:return_to_portal');
  assert.equal(own?.return_for_food, undefined);
});
