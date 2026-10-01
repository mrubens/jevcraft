'use strict';
// Trial note 800: a pool whose way rests is priced with the rest's minutes
// left, and its route says so (25597 mid-230-ax/-ay: the plan's own pool,
// priced without the wait, kept while the rung rested under it).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

function scene() {
  const items = [{ name: 'bucket', count: 3 }, { name: 'water_bucket', count: 1 }, { name: 'cobblestone', count: 64 }, { name: 'stone_pickaxe', count: 1 }];
  const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival' }, health: 20, food: 20, entity: { position: new Vec3(0.5, 64, 0.5) },
    inventory: { items: () => items }, findBlocks: () => [], entities: {}, oxygenLevel: 20, world: { raycast: () => null },
    pathfinder: { movements: {}, setGoal() {}, stop() {}, goto: async () => { throw new Error('No path to the goal'); } }, chat() {}, on() {}, off() {}, removeListener() {} };
  bot.blockAt = p => ({ name: p.y < 64 ? 'stone' : 'air', position: p.floored ? p.floored() : p, boundingBox: p.y < 64 ? 'block' : 'empty', getProperties: () => ({ level: 0 }) });
  const goal = { kind: 'win', survival: { deaths: [] }, gameProgress: { phase: 'reach_nether' }, landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 40, y: 63, z: 0 }] };
  return { bot, goal, items };
}
async function offered(rest) {
  const { portalStep } = require('../src/work');
  const { Task } = require('../src/skills');
  const T = require('../src/tunneling');
  const { bot, goal, items } = scene();
  const pass = async () => { let c = null; const task = new Task('nether');
    task.opportunityClient = { systemOne: async ({ questions }) => { const keys = Object.keys(questions.branch_0.criteria); if (!c && keys.some(k => /^(here|beside)_/.test(k))) c = questions.branch_0.criteria; return { answers: { branch_0: { choice: keys.find(k => /^here_pool_/.test(k)) || keys[0], confidence: 0.8 } } }; } };
    for (let i = 0; i < 3 && !c; i++) await portalStep(bot, task, goal, () => {}, task.opportunityClient).catch(() => {});
    return c; };
  await pass();
  assert.match(goal.portalMethod?.key || '', /^here_pool_/, 'the pool chosen first');
  if (rest) {
    const t = T.lavaWay(new Vec3(40, 63, 0)), area = { x: Math.floor(t.x / 8) * 8, y: Math.floor(t.y / 8) * 8, z: Math.floor(t.z / 8) * 8 };
    require('../src/progress').setAside(goal, 'staircase', area, 'paced the same few cells', T.STAIRCASE_REST_MS);
    assert.ok(T.lavaResting(goal, new Vec3(40, 63, 0)), 'the way rests');
  }
  // A bucket lost: the plan asked again.
  items[0].count = 1;
  return pass();
}
const minutesOf = d => Number((d.match(/about (\d+) minutes? (?:end to end|in all|all told)/) || d.match(/(\d+) minutes?/) || [])[1]);

test('a pool whose way rests: its route counts the rest and says it (note 800)', async () => {
  const open = await offered(false), resting = await offered(true);
  const k = Object.keys(open).find(x => /^here_pool_/.test(x));
  assert.ok(k && resting[k], `${Object.keys(open)} / ${Object.keys(resting || {})}`);
  assert.doesNotMatch(open[k], /rest is waited out/);
  assert.match(resting[k], /First its way's rest is waited out: the staircase toward it is set aside \(paced the same few cells\) for \d+ more minutes?, counted in the price\./);
});
