'use strict';
// Note 882: a cast beside its lava fills its water where water is in view,
// before the walk to the lava (mid-244-cn climbed 97 blocks back for it).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

function scene(buckets, water) {
  const items = [{ name: 'bucket', count: buckets }, { name: 'cobblestone', count: 64 }, { name: 'stone_pickaxe', count: 1 }, { name: 'flint_and_steel', count: 1 }];
  const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival' }, health: 20, food: 20, entity: { position: new Vec3(0.5, 64, 0.5) }, time: { timeOfDay: 6000 },
    inventory: { items: () => items, slots: [], emptySlotCount: () => 20 }, entities: {}, oxygenLevel: 20, world: { raycast: () => null },
    findBlocks: ({ matching }) => water && matching === registry.blocksByName.water.id ? [water] : [],
    pathfinder: { movements: {}, setGoal() {}, stop() {}, goto: async () => { throw new Error('No path to the goal'); } }, chat() {}, on() {}, off() {}, removeListener() {} };
  bot.blockAt = p => { const f = p.floored ? p.floored() : p; const w = water && f.x === water.x && f.y === water.y && f.z === water.z;
    return { name: w ? 'water' : f.y < 64 ? 'stone' : 'air', position: f, boundingBox: w || f.y >= 64 ? 'empty' : 'block', getProperties: () => ({ level: 0 }), metadata: 0 }; };
  const goal = { kind: 'win', survival: { deaths: [] }, gameProgress: { phase: 'reach_nether' }, landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 60, y: 63, z: 0 }] };
  return { bot, goal };
}
async function walkOff(buckets, water) {
  const { portalStep } = require('../src/work');
  const { Task } = require('../src/skills');
  const { bot, goal } = scene(buckets, water);
  const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => { const keys = Object.keys(questions.branch_0.criteria); return { answers: { branch_0: { choice: keys.find(k => /^beside_pool_/.test(k)) || keys[0], confidence: 0.8 } } }; } };
  const steps = [];
  for (let i = 0; i < 4; i++) { await portalStep(bot, task, goal, () => {}, task.opportunityClient).catch(() => {}); if (goal.step?.action) steps.push(`${goal.step.action}${goal.step.item ? `:${goal.step.item}` : ''}`); }
  return { goal, steps };
}

test('a cast beside lava 60 blocks off, three empty buckets and water in view: the water is filled before the walk (note 882)', async () => {
  const a = await walkOff(3, new Vec3(2, 63, 0));
  assert.match(a.goal.portalMethod?.key || '', /^beside_pool_/);
  assert.ok(a.steps.includes('fill_bucket:water_bucket'), a.steps.join(' '));
  // The fake has no way to fill: the fill rests, and the walk to the lava goes on.
  assert.ok(a.goal.portalMethod.waterFirst?.failedAt);
  assert.match(a.steps.slice(a.steps.indexOf('fill_bucket:water_bucket') + 1).join(' '), /to_lava_for_portal|tunnel/, a.steps.join(' '));
});

test('no water in view, or one bucket only: the walk as before', async () => {
  const none = await walkOff(3, null);
  assert.ok(!none.steps.includes('fill_bucket:water_bucket'), none.steps.join(' '));
  const one = await walkOff(1, new Vec3(2, 63, 0));
  assert.ok(!one.steps.includes('fill_bucket:water_bucket'), one.steps.join(' '));
});
