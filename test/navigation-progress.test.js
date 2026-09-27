'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { navigate, Task } = require('../src/skills');

// A bot whose pathfinder never arrives, moved by `step` every 100 ms.
const walker = (start, step) => {
  const bot = Object.assign(new EventEmitter(), { entity: { position: start.clone(), isInWater: false }, game: { dimension: 'overworld', gameMode: 'survival' }, oxygenLevel: 20,
    blockAt: () => ({ name: 'air', boundingBox: 'empty' }), clearControlStates() {}, getControlState() { return false; }, stopDigging() {} });
  let timer;
  bot.pathfinder = { movements: {}, setGoal: g => { if (!g) clearInterval(timer); }, goto: () => new Promise(() => { let i = 0; timer = setInterval(() => step(bot, i++), 100); }) };
  return bot;
};

test('bouncing about a shaft is no progress toward the goal: new cells alone do not keep a walk going', async () => {
  // first-days-206: a retreat bounced up and down its own shaft for fourteen seconds, every bounce a new cell, and was shot from 10.8 to 4.8.
  const cells = [];
  for (let y = 37; y <= 45; y++) for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) cells.push([x, (y - 37) % 2 ? 82 - y : y, z]);
  const bot = walker(new Vec3(0.5, 38, 0.5), (b, i) => { const [x, y, z] = cells[i % cells.length]; b.entity.position = new Vec3(x + 0.5, y, z + 0.5); });
  const started = Date.now();
  await assert.rejects(navigate(bot, new Task('run'), new goals.GoalBlock(30, 60, 30), { timeoutMs: 8000, stallMs: 1500 }), /without reaching new ground/);
  assert(Date.now() - started < 4000, `stalled in ${Date.now() - started} ms, not at the timeout`);
});

test('in the Nether a leg toward the portal back that comes no nearer than before gives way to a crossing straight at it', async () => {
  // mid-211-c: its legs on foot toward the portal 250 blocks off made no ground, and nothing else but a staircase was tried (note 241).
  const { walkToKnownPortal } = require('../src/work');
  const laid = new Set();
  let look = null;
  const bot = Object.assign(new EventEmitter(), { entity: { position: new Vec3(0.5, 39, 0.5), isInWater: false }, game: { dimension: 'the_nether', gameMode: 'survival' }, oxygenLevel: 20,
    health: 20, food: 20, entities: {}, world: { raycast: () => null }, inventory: { items: () => [{ name: 'netherrack', count: 64, type: 1 }] },
    blockAt: p => {
      const name = laid.has(`${p}`) ? 'netherrack' : p.y <= 31 ? 'lava' : p.y === 38 && p.x <= 32 ? 'netherrack' : 'air';
      return { name, boundingBox: name === 'netherrack' ? 'block' : 'empty', diggable: true, position: p };
    },
    clearControlStates() {}, getControlState() { return false; }, stopDigging() {}, equip: async () => {}, lookAt: async p => { look = p; },
    placeBlock: async (ref, face) => { laid.add(`${ref.position.plus(face)}`); },
    setControlState: (name, on) => { if (name === 'forward' && on && look) bot.entity.position = new Vec3(Math.floor(look.x) + 0.5, 39, Math.floor(look.z) + 0.5); } });
  // The walk goes thirty blocks in; earlier walks had come within two hundred.
  bot.pathfinder = { movements: {}, setGoal() {}, goto: async () => { bot.entity.position = new Vec3(30.5, 39, 0.5); } };
  const goal = { survival: {}, portals: [{ x: 250, y: 83, z: 0, dimension: 'nether' }], portalApproach: { '250,83,0': { best: 200 } } };
  assert.equal(await walkToKnownPortal(bot, new Task('back'), goal, () => {}, 'nether'), true);
  assert.equal(goal.step.action, 'cross_toward');
  assert.equal(laid.size, 30, 'thirty blocks laid over the lava sea, x 33 to 62');
  assert.equal(bot.entity.position.x, 62.5);
  assert.equal(Math.round(goal.portalApproach['250,83,0'].best), 188, 'a new nearest approach to the portal');
});

test('a walk that keeps getting nearer is progress, however long', async () => {
  const bot = walker(new Vec3(0.5, 64, 0.5), (b, i) => { b.entity.position = new Vec3(0.5 + i * 0.5, 64, 0.5); });
  await assert.rejects(navigate(bot, new Task('walk'), new goals.GoalBlock(200, 64, 0), { timeoutMs: 3000, stallMs: 1000 }), /navigation timed out/);
});

test('a crossing that ends no nearer rests from here toward that target, and is not offered again meanwhile', async () => {
  // mid-235-e took the crossing forty times in a few minutes on a lava-sea island, each run back within a second with nothing laid (2026-09-27).
  const { crossToward, netherAnswers } = require('../src/nether-travel');
  const bot = Object.assign(new EventEmitter(), { entity: { position: new Vec3(0.5, 39, 0.5), isInWater: false }, game: { dimension: 'the_nether', gameMode: 'survival' }, oxygenLevel: 20,
    health: 20, food: 20, entities: {}, world: { raycast: () => null }, inventory: { items: () => [{ name: 'netherrack', count: 64, type: 1 }] },
    blockAt: p => { const name = p.y <= 31 ? 'lava' : p.y === 38 && p.x <= 0 ? 'netherrack' : 'air'; return { name, boundingBox: name === 'netherrack' ? 'block' : 'empty', diggable: true, position: p }; },
    clearControlStates() {}, getControlState() { return false; }, setControlState() {}, stopDigging() {}, equip: async () => {}, lookAt: async () => {},
    // The block never lands.
    placeBlock: async () => {} });
  const goal = { survival: {}, fortressSearch: { target: { x: 60, y: 39, z: 0 } } };
  const target = new Vec3(60, 39, 0);
  assert(netherAnswers(bot, new Task('stall'), goal, () => {}).cross_toward, 'offered before it is tried');
  assert.equal((await crossToward(bot, new Task('cross'), goal, () => {}, target)).tried, true);
  assert.equal((await crossToward(bot, new Task('cross'), goal, () => {}, target)).tried, false, 'resting: not run again at once');
  assert.equal(netherAnswers(bot, new Task('stall'), goal, () => {}).cross_toward, undefined, 'nor offered');
});

test('a round of gathering blocks that gains none counts: twice in ten minutes and the reserve rests, said on the option', async () => {
  // mid-202-l chose "mine netherrack" sixteen times in seven minutes over the lava sea and never carried one (2026-09-27).
  const { gatherBlocks } = require('../src/work');
  const { isSetAside } = require('../src/progress');
  const bot = { game: { dimension: 'the_nether' }, inventory: { items: () => [] } };
  const goal = { kind: 'win' };
  let asked = 0;
  const acquire = async () => { asked++; };
  await gatherBlocks(bot, new Task('blocks'), goal, () => {}, { acquire });
  assert.equal(isSetAside(goal, 'block_reserve', 'gather'), false, 'once is not yet');
  await gatherBlocks(bot, new Task('blocks'), goal, () => {}, { acquire });
  assert.equal(asked, 2);
  assert.equal(isSetAside(goal, 'block_reserve', 'gather'), true, 'twice with none gained rests it');
  assert.deepEqual(goal.blockRounds.map(r => r.gained), [0, 0]);
});

test('the portal way held says its pace and where its minutes went', () => {
  // mid-235-l was told "2 obsidian in 40 minutes, about 20 a block", the minutes mostly climbs and a pickaxe (2026-09-27).
  const { methodSoFar } = require('../src/work');
  const { Vec3 } = require('vec3');
  const frame = { blocks: Array.from({ length: 10 }, (_, i) => ({ x: i, y: 64, z: 0 })) };
  const bot = { inventory: { items: () => [] }, blockAt: p => ({ name: p.x < 2 ? 'obsidian' : 'air', position: p }) };
  const method = { kind: 'cast', activeMs: 40 * 60000, from: { obsidian: 0, diamonds: 0 },
    byStep: { 'ascend to surface': 14 * 60000, 'fill bucket': 9 * 60000, 'cast: pour': 6 * 60000, 'mine': 11 * 60000 } };
  const says = methodSoFar(bot, { portalFrame: frame }, method, null);
  assert.match(says, /Its minutes went to: ascend to surface 14, mine 11, fill bucket 9, cast: pour 6\./);
  assert.match(says, /2 obsidian in 40 minutes \(about 20 a block\), the 8 still to come would take about 160 minutes more/);
});
