'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseFood, maintainVitals, airRoute, surfaceForAir } = require('../src/vitals');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { planningInventory } = require('../src/work');

test('low air aborts the current mining attempt without trying other blocks', async () => {
  const { acquireStep } = require('../src/work');
  let digging = 0;
  let rejectDig;
  const bot = {
    oxygenLevel: 20, entity: { position: new Vec3(0.5, 64, 0.5) },
    registry: { blocksByName: { sand: { id: 1 } } }, inventory: { items: () => [] },
    findBlocks: ({ matching }) => matching.includes(1) ? [new Vec3(1, 63, 0), new Vec3(2, 63, 0)] : [],
    blockAt: p => ({ name: 'sand', position: p, type: 1, diggable: true, digTime: () => 1000 }),
    canDigBlock: () => true,
    dig: () => { digging++; return new Promise((resolve, reject) => { rejectDig = reject; bot.oxygenLevel = 12; }); },
    stopDigging: () => rejectDig(new Error('Digging aborted')),
  };
  const goal = {};
  await assert.rejects(acquireStep(bot, new Task('test', 'sand'), 'sand', 1, goal, () => {}), { name: 'NeedsAir' });
  assert.equal(digging, 1);
  assert.equal(goal.unreachable, undefined);
});

function waterWorld() {
  const solid = new Set(['0,64,0']); // An overhang blocks the direct ascent.
  return { oxygenLevel: 12, entity: { position: new Vec3(0.5, 62, 0.5), isInWater: true },
    blockAt: p => ({ name: solid.has(`${p.x},${p.y},${p.z}`) ? 'stone' : p.y >= 66 ? 'air' : 'water', boundingBox: 'empty' }) };
}

test('air escape moves around a solid overhang before surfacing', () => {
  const bot = waterWorld();
  const route = airRoute(bot);
  assert(route && route.length);
  assert.equal(route[0].y, 62);
  assert.notEqual(`${route[0].x},${route[0].z}`, '0,0');
  assert.equal(route.at(-1).y, 65);
  assert(route.every(p => bot.blockAt(p).name !== 'stone' && bot.blockAt(p.offset(0, 1, 0)).name !== 'stone'));
});

test('surfacing refills the air bar and releases swimming controls', async () => {
  const bot = waterWorld();
  const controls = {};
  bot.pathfinder = { setGoal: () => {} };
  bot.stopDigging = () => {};
  bot.clearControlStates = () => { controls.jump = false; controls.forward = false; };
  bot.setControlState = (key, value) => { controls[key] = value; };
  bot.lookAt = async () => {};
  const refill = setInterval(() => { bot.oxygenLevel = Math.min(20, bot.oxygenLevel + 2); }, 50);
  try { await surfaceForAir(bot, new Task('test', 'surface')); }
  finally { clearInterval(refill); }
  assert.equal(bot.oxygenLevel, 20);
  assert(!controls.jump && !controls.forward);
});

test('eating uses safe food and verifies restored hunger', async () => {
  const actions = [];
  const bot = { food: 12, health: 18, entity: {}, registry: { foodsByName: {
    apple: { effectiveQuality: 6.4 }, rotten_flesh: { effectiveQuality: 4.8 },
  } }, inventory: { items: () => [{ name: 'rotten_flesh', count: 1 }, { name: 'apple', count: 1 }] },
  equip: async item => assert.equal(item.name, 'apple'), consume: async () => { bot.food = 16; }, deactivateItem: () => {}, };
  assert.equal(chooseFood(bot).name, 'apple');
  assert(await maintainVitals(bot, new Task('test', 'eat'), step => actions.push(step)));
  assert.equal(actions[0].action, 'eat');
  bot.food = 20;
  assert.equal(await maintainVitals(bot, new Task('test', 'full')), false);
});

test('eating can be cancelled while waiting for the server', async () => {
  let stopped = false;
  const task = new Task('test', 'eat');
  const bot = { food: 8, health: 10, entity: {}, registry: { foodsByName: { apple: { effectiveQuality: 6.4 } } },
    inventory: { items: () => [{ name: 'apple' }] }, equip: async () => {},
    consume: () => { setTimeout(() => task.cancel(), 20); return new Promise(() => {}); }, deactivateItem: () => { stopped = true; }, };
  await assert.rejects(maintainVitals(bot, task), { name: 'Cancelled' });
  assert(stopped);
});

test('near-broken tools are not counted as a usable planned supply', () => {
  const stock = [{ name: 'stone_pickaxe', count: 1, durabilityUsed: 128 }, { name: 'stone_pickaxe', count: 1, durabilityUsed: 0 }];
  const bot = { inventory: { items: () => stock }, registry: { itemsByName: { stone_pickaxe: { maxDurability: 131 } } } };
  assert.equal(planningInventory(bot).stone_pickaxe, 1);
  assert.equal(stock.length, 2);
});

test('a worn pickaxe does not satisfy acquisition and the replacement is equipped', async () => {
  const { acquireStep } = require('../src/work');
  const { equipBestTool, pickaxeTier } = require('../src/skills');
  const worn = { name: 'stone_pickaxe', type: 1, count: 1, durabilityUsed: 130, slot: 36 };
  const fresh = { ...worn, durabilityUsed: 0, slot: 37 };
  let stock = [worn];
  const bot = { inventory: { items: () => stock }, entity: { position: new Vec3(0, 64, 0) },
    registry: { itemsByName: { stone_pickaxe: { maxDurability: 131 } }, blocksByName: {} },
    findBlocks: () => { throw new Error('replacement planning was reached'); } };
  assert.equal(pickaxeTier(bot), 0);
  await assert.rejects(acquireStep(bot, new Task('test', 'replace'), 'stone_pickaxe', 1, {}, () => {}), /replacement planning was reached/);
  stock = [worn, fresh];
  bot.heldItem = worn;
  bot.equip = async item => { bot.heldItem = item; };
  await equipBestTool(bot, { digTime: type => type === 1 ? 100 : 1000 });
  assert.equal(bot.heldItem.slot, fresh.slot);
});
