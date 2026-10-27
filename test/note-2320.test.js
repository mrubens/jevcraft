'use strict';
// Water in view that no walk reaches is dug to, not searched for on the surface (note 2320).
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');

test('water 8 below through rock, every walk failing: the fetch digs to it', async () => {
  const { collectWater } = require('../src/water');
  const water = new Vec3(323, 67, 404);
  const bot = { registry, entities: {}, oxygenLevel: 20, health: 20, food: 20, game: { gameMode: 'survival', dimension: 'overworld' }, time: { timeOfDay: 6000 },
    entity: { position: new Vec3(321.5, 75, 404.5), height: 1.8, width: 0.6 }, inventory: { items: () => [{ name: 'bucket', count: 1 }], slots: [], emptySlotCount: () => 5 },
    findBlocks: ({ matching }) => matching === registry.blocksByName.water.id ? [water] : [],
    blockAt: p => { const f = p.floored?.() || p; const w = f.equals(water); return { name: w ? 'water' : f.equals(new Vec3(321, 75, 404)) || f.equals(new Vec3(321, 76, 404)) ? 'air' : 'stone', position: f, boundingBox: w || (f.x === 321 && f.z === 404 && f.y >= 75) ? 'empty' : 'block', getProperties: () => ({ level: 0 }), metadata: 0 }; },
    world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, chat() {}, emit() {}, on() {}, removeListener() {} };
  const goal = { kind: 'win', survival: {}, step: { action: 'fill_bucket', item: 'water_bucket' } };
  let dug = null, explored = false;
  const navigate = async () => { throw Object.assign(new Error('No route from here (noPath)'), { name: 'NoRoute' }); };
  const log = console.log; console.log = () => {};
  try {
    await collectWater(bot, new Task('water'), goal, () => {}, { navigate, explore: async () => { explored = true; }, digTo: async t => { dug = t; } });
  } finally { console.log = log; }
  assert.ok(dug && dug.equals(water), 'dug toward the water');
  assert.equal(explored, false, 'no surface search from inside the rock');
  assert.equal(goal.step.dig, true);
});
