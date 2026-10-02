// Note 844: the cast waiting on water with an empty bucket carried and water
// in view: the stall's question offers filling the bucket there (25597,
// 2026-10-01 22:42 to 22:48Z, none good 302 of 478 askings).
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const { frameCells } = require('../src/ruined-portal');

function fakeBot(carried, water) {
  const items = Object.entries(carried).map(([name, count]) => ({ name, count }));
  const at = new Vec3(212.5, 35, 425.5);
  return { registry, entities: {}, oxygenLevel: 20, health: 20, food: 20, game: { gameMode: 'survival', dimension: 'overworld' }, time: { timeOfDay: 6000 },
    entity: { position: at, height: 1.8, width: 0.6 }, inventory: { items: () => items, slots: [], emptySlotCount: () => 0 },
    findBlocks: ({ matching }) => water && matching === registry.blocksByName.water.id ? [water] : [],
    blockAt: p => { const f = p.floored?.() || p; const w = water && f.equals(water); return { name: w ? 'water' : f.y < 35 ? 'stone' : 'air', position: f, boundingBox: w || f.y >= 35 ? 'empty' : 'block', getProperties: () => ({ level: 0 }), metadata: 0 }; },
    world: { raycast: () => null }, pathfinder: { movements: {}, setGoal() {} }, chat() {}, emit() {}, on() {}, removeListener() {} };
}

test('25597: water in view 2 blocks off and an empty bucket carried: fill_water is on the stall\'s question; none in view, it is not', async () => {
  const { answerStall } = require('../src/work');
  const origin = new Vec3(200, 70, 420);
  const frame = { origin, axis: 'x', cast: true, castTemp: [], blocks: frameCells(origin, 'x').blocks.map(p => ({ x: p.x, y: p.y, z: p.z })) };
  const goal = () => ({ kind: 'win', request: 'beat the game', from: 'TestPlayer', survival: {}, rungTime: { phase: 'reach_nether' }, gameProgress: { phase: 'reach_nether', milestones: {} },
    portalFrame: frame, portalMethod: { kind: 'cast' }, step: { action: 'fill_bucket', item: 'water_bucket' } });
  const asked = [];
  const client = { model: 'jev', systemOne: async ({ questions }) => {
    const answers = {};
    for (const [b, q] of Object.entries(questions)) { asked.push(q.criteria); answers[b] = { choice: 'none_good', confidence: 0.6 }; }
    return { answers };
  } };
  const stall = { key: 'step:rung:reach_nether', work: 'step:rung:reach_nether', layer: 'work', strikes: 2 };
  await answerStall(fakeBot({ bucket: 1, cobblestone: 64, iron_pickaxe: 1 }, new Vec3(214, 35, 425)), new Task('stall'), goal(), () => {}, stall, { client }).catch(() => {});
  assert(asked[0]?.fill_water, Object.keys(asked[0] || {}).join(','));
  assert.match(asked[0].fill_water, /fill the empty bucket at the water in view 2 blocks off at \(214, 35, 425\)/);
  asked.length = 0;
  await answerStall(fakeBot({ bucket: 1, cobblestone: 64, iron_pickaxe: 1 }, null), new Task('stall'), goal(), () => {}, stall, { client }).catch(() => {});
  assert.equal(asked[0]?.fill_water, undefined);
});

test('fill_water chosen runs the fill with its task, and a stall whose step left from a place is asked (note 880)', async () => {
  const { answerStall } = require('../src/work');
  const origin = new Vec3(200, 70, 420);
  const frame = { origin, axis: 'x', cast: true, castTemp: [], blocks: frameCells(origin, 'x').blocks.map(p => ({ x: p.x, y: p.y, z: p.z })) };
  const goal = { kind: 'win', request: 'beat the game', from: 'TestPlayer', survival: {}, rungTime: { phase: 'reach_nether' }, gameProgress: { phase: 'reach_nether', milestones: {} },
    portalFrame: frame, portalMethod: { kind: 'cast' }, step: { action: 'fill_bucket', item: 'water_bucket' } };
  const client = { model: 'jev', systemOne: async ({ questions }) => {
    const answers = {};
    for (const [b, q] of Object.entries(questions)) answers[b] = { choice: 'fill_water' in q.criteria ? 'fill_water' : Object.keys(q.criteria)[0], confidence: 0.9 };
    return { answers };
  } };
  const stall = { key: 'step:rung:reach_nether', work: 'step:rung:reach_nether', layer: 'work', strikes: 2 };
  const errors = [];
  const log = console.log; console.log = (...a) => { if (/TypeError/.test(a.join(' '))) errors.push(a.join(' ')); };
  let thrown = null;
  try { await answerStall(fakeBot({ bucket: 1, cobblestone: 64, iron_pickaxe: 1 }, new Vec3(214, 35, 425)), new Task('stall'), goal, () => {}, stall, { client }); }
  catch (err) { thrown = err; } finally { console.log = log; }
  assert.equal(goal.step.choice || goal.step.action, goal.step.choice ? 'fill_water' : goal.step.action);
  // The fill ran as far as its walk (the fake has no path search): its task was there to check.
  assert.doesNotMatch(String(thrown?.stack || '') + errors.join(' '), /reading 'check'/);
  assert.match(String(thrown?.stack || ''), /collectWater/);
  // The stall of a detour whose step left from a place (restock_blocks): asked, not thrown.
  const g2 = { kind: 'win', request: 'beat the game', from: 'TestPlayer', survival: {}, rungTime: { phase: 'reach_nether' }, gameProgress: { phase: 'reach_nether', milestones: {} }, step: { action: 'restock_blocks', from: { x: -67, y: 42, z: 188 } } };
  let t2 = null;
  try { await answerStall(fakeBot({ cobblestone: 64, iron_pickaxe: 1 }, null), new Task('stall'), g2, () => {}, { key: 'detour:until_rest_ends', work: 'detour:until_rest_ends', layer: 'work', strikes: 2 }, { client }); }
  catch (err) { t2 = err; }
  assert.doesNotMatch(String(t2?.stack || ''), /key\.replace is not a function/);
});
