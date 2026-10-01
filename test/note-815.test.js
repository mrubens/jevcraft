'use strict';
// Trial note 815: a known pool far off from under the rock is priced as the
// walk by the surface it is (25588 mid-220-ak, 2026-10-01 14:46Z).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

function scene({ under }) {
  const items = [{ name: 'bucket', count: 3 }, { name: 'water_bucket', count: 1 }, { name: 'cobblestone', count: 64 }, { name: 'stone_pickaxe', count: 1 }];
  const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival' }, health: 20, food: 20, entity: { position: new Vec3(0.5, 14, 0.5) },
    inventory: { items: () => items }, findBlocks: () => [], entities: {}, oxygenLevel: 20, world: { raycast: () => null },
    pathfinder: { movements: {}, setGoal() {}, stop() {}, goto: async () => { throw new Error('No path to the goal'); } }, chat() {}, on() {}, off() {}, removeListener() {} };
  // A room at y 14 to 15 round the bot; rock from y 16 up to 96 when under.
  bot.blockAt = p => { const y = Math.floor(p.y); const solid = y < 14 || (under && y >= 16 && y < 96); return { name: solid ? 'stone' : 'air', position: p.floored ? p.floored() : p, boundingBox: solid ? 'block' : 'empty', getProperties: () => ({ level: 0 }) }; };
  const goal = { kind: 'win', survival: { deaths: [] }, gameProgress: { phase: 'reach_nether' }, landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 130, y: 14, z: 0 }] };
  return { bot, goal };
}
async function offered(under) {
  const { portalStep } = require('../src/work');
  const { Task } = require('../src/skills');
  const { bot, goal } = scene({ under });
  let c = null; const task = new Task('nether');
  task.opportunityClient = { systemOne: async ({ questions }) => { const keys = Object.keys(questions.branch_0.criteria); if (!c && keys.some(k => /^beside_pool_/.test(k))) c = questions.branch_0.criteria; return { answers: { branch_0: { choice: keys[0], confidence: 0.8 } } }; } };
  for (let i = 0; i < 3 && !c; i++) await portalStep(bot, task, goal, () => {}, task.opportunityClient).catch(() => {});
  return c;
}
const priceOf = d => Number((d.match(/Priced end to end, about (\d+) minutes/) || [])[1]);

test('a pool 130 blocks off from 80 blocks under rock: by the surface, said and priced (note 815)', async () => {
  const open = await offered(false), under = await offered(true);
  const k = Object.keys(under || {}).find(x => /^beside_pool_/.test(x));
  assert.ok(k && open[k], `${Object.keys(open || {})} / ${Object.keys(under || {})}`);
  assert.match(under[k], /From \d+ blocks under rock the walk to it goes by the surface: \d+ blocks up to open sky, across, and \d+ down to it, counted in the price\./);
  assert.doesNotMatch(open[k], /goes by the surface/);
  assert.ok(priceOf(under[k]) > priceOf(open[k]), `${priceOf(under[k])} vs ${priceOf(open[k])}`);
});
