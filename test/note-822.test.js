'use strict';
// Trial note 822: at night, a pool route that puts the bot on the surface
// says the night's record there.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

async function offered(timeOfDay) {
  const { portalStep } = require('../src/work');
  const { Task } = require('../src/skills');
  const items = [{ name: 'bucket', count: 3 }, { name: 'water_bucket', count: 1 }, { name: 'cobblestone', count: 64 }, { name: 'stone_pickaxe', count: 1 }];
  const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival' }, time: { timeOfDay }, health: 20, food: 20, entity: { position: new Vec3(0.5, 64, 0.5) },
    inventory: { items: () => items }, findBlocks: () => [], entities: {}, oxygenLevel: 20, world: { raycast: () => null },
    pathfinder: { movements: {}, setGoal() {}, stop() {}, goto: async () => { throw new Error('No path to the goal'); } }, chat() {}, on() {}, off() {}, removeListener() {} };
  bot.blockAt = p => ({ name: p.y < 64 ? 'stone' : 'air', position: p.floored ? p.floored() : p, boundingBox: p.y < 64 ? 'block' : 'empty', getProperties: () => ({ level: 0 }) });
  const goal = { kind: 'win', survival: { deaths: [] }, gameProgress: { phase: 'reach_nether' }, landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 40, y: 63, z: 0 }] };
  let c = null; const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => { const keys = Object.keys(questions.branch_0.criteria); if (!c && keys.some(k => /^beside_pool_/.test(k))) c = questions.branch_0.criteria; return { answers: { branch_0: { choice: keys[0], confidence: 0.8 } } }; } };
  for (let i = 0; i < 3 && !c; i++) await portalStep(bot, task, goal, () => {}, task.opportunityClient).catch(() => {});
  return c;
}

test('a surface pool at night: the route says the night up there and its record; by day it does not (note 822)', async () => {
  const night = await offered(15000), day = await offered(6000);
  const k = Object.keys(night || {}).find(x => /^beside_pool_/.test(x));
  assert.ok(k && day?.[k]);
  assert.match(night[k], /It is night up there, about \d+ real minutes to dawn\. The record/);
  assert.doesNotMatch(day[k], /It is night up there/);
});
