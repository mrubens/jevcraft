'use strict';
// Note 2585: which water to dig toward is Jev's question, held on the source chosen; elsewhere is the surface search.
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');

function scene(waters) {
  const bot = { registry, entities: {}, oxygenLevel: 20, health: 20, food: 20, game: { gameMode: 'survival', dimension: 'overworld' }, time: { timeOfDay: 6000 },
    entity: { position: new Vec3(0.5, 70, 0.5), height: 1.8, width: 0.6 }, inventory: { items: () => [{ name: 'bucket', count: 1 }], slots: [], emptySlotCount: () => 5 },
    findBlocks: ({ matching }) => matching === registry.blocksByName.water.id ? waters : [],
    blockAt: p => { const f = p.floored?.() || p; const w = waters.some(q => q.equals(f)); return { name: w ? 'water' : f.y >= 70 ? 'air' : 'stone', position: f, boundingBox: w || f.y >= 70 ? 'empty' : 'block', getProperties: () => ({ level: 0 }), diggable: true }; },
    world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, chat() {}, emit() {}, on() {}, removeListener() {} };
  return bot;
}
const noRoute = async () => { throw Object.assign(new Error('No route from here (noPath)'), { name: 'NoRoute' }); };

test('three sources no walk reaches: the three nearest are offered with their distance and rock, and elsewhere; the pick is dug toward and held', async () => {
  const { collectWater } = require('../src/water');
  const waters = [new Vec3(0, 62, 8), new Vec3(0, 60, 14), new Vec3(0, 58, 20), new Vec3(0, 50, 40)];
  const bot = scene(waters);
  const goal = { kind: 'win', survival: {}, step: { action: 'fill_bucket', item: 'water_bucket' } };
  let offered = null, asked = 0, dug = [];
  const task = new Task('water');
  task.opportunityClient = { systemOne: async ({ questions }) => { asked++; offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'water_1', confidence: 0.7 } } }; } };
  const log = console.log; console.log = () => {};
  try {
    await collectWater(bot, task, goal, () => {}, { navigate: noRoute, explore: async () => assert.fail('no surface search'), digTo: async t => { dug.push(t); } });
    assert.deepEqual(Object.keys(offered).filter(k => k !== 'none_good').sort(), ['water_0', 'water_1', 'water_2', 'water_elsewhere']);
    assert.match(offered.water_0, /\(0, 62, 8\), 11 blocks off, 8 below the bot: about 10 blocks of rock on the straight line/);
    assert.ok(dug[0].equals(waters[1]), 'the second source, as Jev chose');
    assert.deepEqual(goal.waterWay.at, { x: 0, y: 60, z: 14 });
    // Asked once for the place: the next pass digs toward the same source unasked.
    await collectWater(bot, task, goal, () => {}, { navigate: noRoute, explore: async () => assert.fail('no surface search'), digTo: async t => { dug.push(t); } });
    assert.equal(asked, 1);
    assert.ok(dug[1].equals(waters[1]));
  } finally { console.log = log; }
});

test('elsewhere chosen: the surface search runs and nothing is dug toward', async () => {
  const { collectWater } = require('../src/water');
  const bot = scene([new Vec3(0, 62, 8)]);
  const goal = { kind: 'win', survival: {}, step: { action: 'fill_bucket', item: 'water_bucket' } };
  let explored = false, dug = false;
  const task = new Task('water');
  task.opportunityClient = { systemOne: async ({ questions }) => ({ answers: { branch_0: { choice: 'water_elsewhere', confidence: 0.7 } } }) };
  const log = console.log; console.log = () => {};
  try { await collectWater(bot, task, goal, () => {}, { navigate: noRoute, explore: async () => { explored = true; }, digTo: async () => { dug = true; } }); } finally { console.log = log; }
  assert.equal(explored, true); assert.equal(dug, false); assert.equal(goal.waterWay, undefined);
});
