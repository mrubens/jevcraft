'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseFood, maintainVitals, airRoute, surfaceForAir, headSubmerged } = require('../src/vitals');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { planningInventory } = require('../src/work');

test('low air aborts the current mining attempt without trying other blocks', async () => {
  const { acquireStep } = require('../src/work');
  let digging = 0;
  let rejectDig;
  const bot = {
    oxygenLevel: 20, entity: { position: new Vec3(0.5, 64, 0.5) },
    registry: require('minecraft-data')('26.1'), inventory: { items: () => [] },
    pathfinder: { movements: { canDig: true } },
    findBlocks: ({ matching }) => matching.includes(require('minecraft-data')('26.1').blocksByName.sand.id) ? [new Vec3(1, 63, 0), new Vec3(2, 63, 0)] : [],
    blockAt: p => ({ name: p.y >= 64 ? 'air' : p.x === 0 ? 'stone' : 'sand', position: p,
      type: p.y >= 64 ? 0 : 1, boundingBox: p.y >= 64 ? 'empty' : 'block', diggable: true, digTime: () => 1000 }),
    canDigBlock: () => true,
    dig: () => { digging++; return new Promise((resolve, reject) => { rejectDig = reject; bot.oxygenLevel = 12; }); },
    stopDigging: () => rejectDig(new Error('Digging aborted')),
  };
  const goal = {};
  await assert.rejects(acquireStep(bot, new Task('test', 'sand'), 'sand', 1, goal, () => {}), { name: 'NeedsAir' });
  assert.equal(digging, 1);
  assert(require('../src/progress').isSetAside(goal, 'reach', { x: 1, y: 63, z: 0 }), 'Do not retry the same interrupted dive immediately');
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
  const refill = setInterval(() => {
    bot.entity.position.y = 65;
    bot.oxygenLevel = Math.min(20, bot.oxygenLevel + 2);
  }, 50);
  try { await surfaceForAir(bot, new Task('test', 'surface')); }
  finally { clearInterval(refill); }
  assert.equal(bot.oxygenLevel, 20);
  assert(!controls.jump && !controls.forward);
});

test('a full initial air bar does not skip surfacing after an underwater reconnect', async () => {
  const bot = waterWorld(), actions = [], controls = {};
  bot.oxygenLevel = 20; bot.food = 20; bot.health = 20;
  bot.pathfinder = { setGoal() {} }; bot.stopDigging = () => {};
  bot.clearControlStates = () => { controls.jump = false; controls.forward = false; };
  bot.lookAt = async () => {};
  let jumped = false;
  bot.setControlState = (key, value) => {
    controls[key] = value;
    if (key === 'jump' && value) { jumped = true; bot.entity.position.y = 65; }
  };
  await maintainVitals(bot, new Task('reconnected underwater'), action => actions.push(action));
  assert(jumped); assert.equal(actions[0].action, 'surface');
  assert.equal(bot.blockAt(bot.entity.position.offset(0, 1.62, 0).floored()).name, 'air');
  assert(!controls.jump && !controls.forward);
});

test('breathable space above flowing water is not mistaken for submersion', () => {
  const bot = { entity: { position: new Vec3(0.5, 59.2, 0.5) },
    blockAt: p => ({ name: p.y === 60 ? 'water' : 'air', getProperties: () => ({ level: '4' }) }),
  };
  assert.equal(headSubmerged(bot), false);
  bot.entity.position.y = 58.6;
  assert.equal(headSubmerged(bot), true);
  bot.entity.position.y = 59.2;
  bot.blockAt = () => ({ name: 'water', getProperties: () => ({ level: '8' }) });
  assert.equal(headSubmerged(bot), true, 'A falling water column with water above fills the whole eye block');
});

test('kelp age metadata does not lower the water surface around a submerged head', () => {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const kelp = Block.fromProperties(registry.blocksByName.kelp.id, { age: 7 }, 0);
  const bot = { entity: { position: new Vec3(.5, 59.1, .5) }, blockAt: p => p.y === 60 ? kelp : { name: 'air' } };
  assert(headSubmerged(bot));
  bot.entity.position.y = 59.3;
  assert(!headSubmerged(bot), 'eyes above the source-water surface can breathe');
});

test('carried food restores the regeneration threshold for moderate injuries', async () => {
  let eaten = 0;
  const bot = { food: 17, health: 13.6, entity: {},
    registry: { foodsByName: { cooked_beef: { effectiveQuality: 20.8 } } },
    inventory: { items: () => [{ name: 'cooked_beef', count: 2 }] },
    equip: async () => {}, consume: async () => { eaten++; bot.food = 20; }, deactivateItem() {},
  };
  assert(await maintainVitals(bot, new Task('heal in shelter')));
  assert.equal(eaten, 1);
  bot.food = 18;
  assert.equal(await maintainVitals(bot, new Task('already regenerating')), false);
  bot.food = 17; bot.health = 20;
  assert.equal(await maintainVitals(bot, new Task('healthy')), false);
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

test('an emerging hazard interrupts eating even when the task itself was not cancelled', async () => {
  const task = new Task('eat with threat guard'); let hazard = false, stopped = false;
  task.interruptCheck = () => { if (hazard) throw Object.assign(new Error('New breath cloud'), { name: 'EndEmergency' }); };
  const bot = { food: 17, health: 13, entity: {}, registry: { foodsByName: { apple: { effectiveQuality: 6.4 } } },
    inventory: { items: () => [{ name: 'apple' }] }, equip: async () => {},
    consume: () => { hazard = true; return new Promise(() => {}); }, deactivateItem: () => { stopped = true; } };
  await assert.rejects(maintainVitals(bot, task), { name: 'EndEmergency' });
  assert(stopped); assert.equal(task.cancelled, false);
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
    registry: require('minecraft-data')('26.1'),
    findBlocks: () => { throw new Error('replacement planning was reached'); } };
  assert.equal(pickaxeTier(bot), 0);
  await assert.rejects(acquireStep(bot, new Task('test', 'replace'), 'stone_pickaxe', 1, {}, () => {}), /replacement planning was reached/);
  stock = [worn, fresh];
  bot.heldItem = worn;
  bot.equip = async item => { bot.heldItem = item; };
  await equipBestTool(bot, { digTime: type => type === 1 ? 100 : 1000 });
  assert.equal(bot.heldItem.slot, fresh.slot);
});

test('with nothing else to eat, rotten flesh is eaten when it is the way back to regeneration', () => {
  const { lastResortFood, chooseFood } = require('../src/vitals');
  const registry = require('minecraft-data')('26.1');
  const bot = { registry, inventory: { items: () => [{ name: 'rotten_flesh', count: 2 }, { name: 'spider_eye', count: 1 }] } };
  assert.equal(chooseFood(bot), undefined, 'neither counts as ordinary food');
  assert.equal(lastResortFood(bot).name, 'rotten_flesh', 'rotten flesh is the last resort');
  const poison = { registry, inventory: { items: () => [{ name: 'spider_eye', count: 3 }, { name: 'pufferfish', count: 1 }] } };
  assert.equal(lastResortFood(poison), undefined, 'poison is never a last resort');
});

test('no eating with a hostile mob within five blocks, unless starving', async () => {
  const { maintainVitals } = require('../src/vitals');
  const { Vec3 } = require('vec3');
  const registry = require('minecraft-data')('26.1');
  let ate = 0;
  const bot = { registry, health: 6, food: 12, oxygenLevel: 20, entity: { position: new Vec3(0, 64, 0) },
    entities: { 1: { name: 'zombie', position: new Vec3(2, 64, 0), isValid: true } },
    inventory: { items: () => [{ name: 'bread', count: 4, type: registry.itemsByName.bread.id }] },
    equip: async () => {}, consume: async () => { ate++; bot.food += 5; }, deactivateItem() {}, blockAt: () => ({ name: 'air' }) };
  const task = { check() {} };
  assert.equal(await maintainVitals(bot, task), false, 'a zombie beside it');
  assert.equal(ate, 0);
  bot.entities[1].position = new Vec3(12, 64, 0);
  assert.equal(await maintainVitals(bot, task), true, 'with the zombie gone, it eats');
  bot.entities[1].position = new Vec3(2, 64, 0); bot.food = 2;
  assert.equal(await maintainVitals(bot, task), true, 'starving, it eats anyway');
});
