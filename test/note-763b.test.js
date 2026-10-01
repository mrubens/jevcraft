'use strict';
// Note 763b: the lava's way asked, the pickaxes said with the depth, no
// pickaxe a gap at the crossing, the audit's flips without the ladder's
// label, and portal-time's "other" split.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { setAside } = require('../src/progress');
const registry = require('minecraft-data')('26.1');

// 25590 (about 20:35Z) at y 22, a held pool 165 blocks off at its own depth.
function lavaBot(items = [{ name: 'bucket', count: 1 }, { name: 'iron_ingot', count: 9 }, { name: 'stone_pickaxe', count: 1 }]) {
  const chat = [];
  const bot = {
    registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {},
    entity: { position: new Vec3(36.5, 22, 39.5) }, inventory: { items: () => items }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 22 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < 22 ? 'block' : 'empty' }),
    findBlocks: () => [], pathfinder: { movements: {}, getPathTo: async () => ({ status: 'noPath', path: [] }) }, chat: m => chat.push(m),
  };
  return { bot, chat };
}
test('the lava\'s way is the portal plan\'s: the fetch digs to the plan\'s lava layer or pool and asks nothing of its own (25590, note 763b, note 782)', async () => {
  const { collectLava, LAVA_DEPTH } = require('../src/obsidian');
  const { bot } = lavaBot();
  const goal = { landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 201, y: 21, z: 39 }],
    portalMethod: { kind: 'cast', key: 'here_deep', lava: { way: 'deep' }, chosenAt: Date.now(), facts: { dimension: 'overworld' } } };
  setAside(goal, 'landmark_trip', 'lava_pool:201,39', 'no nearer', 1800000);
  const asked = [];
  const task = new Task('lava');
  task.opportunityClient = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'deep', confidence: 0.7 } } }; } };
  const dug = [], actions = { navigate: async () => {}, dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } };
  await collectLava(bot, task, { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, goal, () => {}, actions);
  await collectLava(bot, task, { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, goal, () => {}, actions);
  assert.equal(asked.length, 0, 'nothing asked: the plan chose the lava');
  assert.equal(dug[0].y, LAVA_DEPTH, 'the lava layer, as the plan holds');
  assert.equal(dug[1].y, LAVA_DEPTH);
  // The plan's pool held: dug to, its walk having failed.
  goal.portalMethod = { kind: 'cast', key: 'here_pool_0', lava: { way: 'pool', at: { x: 201, y: 21, z: 39 } }, chosenAt: Date.now() + 1, facts: { dimension: 'overworld' } };
  delete goal.lavaFetch;
  await collectLava(bot, task, { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, goal, () => {}, actions);
  assert.equal(asked.length, 0);
  assert(Math.hypot(dug[2].x - 201, dug[2].z - 39) <= 2, `dug toward the pool: ${dug[2]}`);
});

test('the depth\'s needs say the pickaxes it would be worked with, and what the pockets make first (25583: down to y 16 with a wooden pickaxe)', () => {
  const { pickSays } = require('../src/levels');
  const bot = { registry, inventory: { items: () => [{ name: 'wooden_pickaxe', count: 1, durabilityUsed: 40 }, { name: 'cobblestone', count: 12 }] } };
  assert.match(pickSays(bot), /Pickaxes carried for the depth: wooden pickaxe \(19 uses left\)\. A wooden pickaxe mines stone and coal only, slowly, not iron, gold or diamond\. The 12 cobblestone carried makes a stone pickaxe first/);
});

test('no pickaxe at all is a gap at the crossing: said on cross_now and offered as its own top-up (25589)', async () => {
  const { crossingKitReady } = require('../src/work');
  const items = [{ name: 'cobblestone', count: 128 }, { name: 'cooked_beef', count: 12 }, { name: 'iron_sword', count: 1 }, { name: 'stick', count: 4 }];
  const bot = { registry, health: 20, food: 20, game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {},
    inventory: { items: () => items, slots: [] }, blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }), findBlocks: () => [] };
  const goal = {};
  let offered = null;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'cross_now', confidence: 0.6 } } }; } };
  assert.equal(await crossingKitReady(bot, new Task('win'), goal, () => {}, client), true);
  assert(offered, 'asked');
  assert.match(offered.cross_now, /No pickaxe is carried: in the Nether nothing can be mined/);
  assert.match(offered.top_up_pickaxe, /^Make a pickaxe first \(none carried\): stone pickaxe/);
});

test('the audit\'s flips leave out the ladder\'s label: a cast traded with enter_nether is not a loop by that name', () => {
  const src = require('fs').readFileSync(require.resolve('../scripts/lib/audit'), 'utf8');
  assert.match(src, /st\?\.action === 'enter_nether' && st\.phase === 'reach_nether'/);
});

test('portal-time splits what had been "other" by what the step did', () => {
  const { workOf } = require('../scripts/portal-time');
  assert.equal(workOf({ action: 'smelt' }), 'smelt and craft');
  assert.equal(workOf({ action: 'tunnel' }), 'mining');
  assert.equal(workOf({ action: 'detour' }), 'stall detours');
  assert.equal(workOf({ action: 'loot_minecart' }), 'side errands');
  assert.equal(workOf({ action: 'notch_out_of_water' }), 'other: notch_out_of_water');
});
