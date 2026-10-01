'use strict';
// Trial note 821: the plan's room for lava buckets counts the slots the
// tidy frees without asking.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

test('room for lava buckets: the free slot, and the junk the tidy drops (redstone, rails) (note 821)', async () => {
  const { portalStep } = require('../src/work');
  const { Task } = require('../src/skills');
  const items = [{ name: 'bucket', count: 3 }, { name: 'water_bucket', count: 1 }, { name: 'cobblestone', count: 64 }, { name: 'stone_pickaxe', count: 1 }, { name: 'iron_ingot', count: 30 },
    { name: 'redstone', count: 20 }, { name: 'rail', count: 6 }, { name: 'egg', count: 3 }];
  const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival' }, health: 20, food: 20, entity: { position: new Vec3(0.5, 64, 0.5) },
    inventory: { items: () => items, emptySlotCount: () => 1 }, findBlocks: () => [], entities: {}, oxygenLevel: 20, world: { raycast: () => null },
    pathfinder: { movements: {}, setGoal() {}, stop() {}, goto: async () => { throw new Error('No path to the goal'); } }, chat() {}, on() {}, off() {}, removeListener() {} };
  bot.blockAt = p => ({ name: p.y < 64 ? 'stone' : 'air', position: p.floored ? p.floored() : p, boundingBox: p.y < 64 ? 'block' : 'empty', getProperties: () => ({ level: 0 }) });
  const goal = { kind: 'win', survival: { deaths: [] }, gameProgress: { phase: 'reach_nether' }, landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 40, y: 63, z: 0 }] };
  let c = null; const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => { const keys = Object.keys(questions.branch_0.criteria); if (!c && keys.some(k => /^beside_pool_/.test(k))) c = questions.branch_0.criteria; return { answers: { branch_0: { choice: keys[0], confidence: 0.8 } } }; } };
  for (let i = 0; i < 3 && !c; i++) await portalStep(bot, task, goal, () => {}, task.opportunityClient).catch(() => {});
  const k = Object.keys(c || {}).find(x => /^beside_pool_/.test(x));
  assert.ok(k, Object.keys(c || {}).join(','));
  const n = Number((c[k].match(/the pockets hold (\d+) lava buckets? at once/) || [])[1]);
  assert.ok(n >= 4, `room ${n}: the free slot, the bucket stack and the three the tidy frees`);
});
