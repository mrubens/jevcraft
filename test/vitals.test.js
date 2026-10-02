'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseFood, maintainVitals, airRoute, surfaceForAir, headSubmerged, digWithAirGuard } = require('../src/vitals');
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

test('with no swimming route the bot digs up through the sand that fell on it and swims up', async () => {
  // Trial 7: a staircase broke into a lakebed, the sand came down, the water after it.
  const { Vec3 } = require('vec3');
  const sand = new Set(['0,58,0', '0,59,0']);
  const bot = { entity: { position: new Vec3(0.5, 56, 0.5), onGround: false, isInWater: true }, oxygenLevel: 2,
    blockAt: p => {
      const k = `${p.x},${p.y},${p.z}`;
      const name = sand.has(k) ? 'sand' : p.x === 0 && p.z === 0 && p.y >= 56 && p.y < 64 ? 'water' : p.y >= 64 ? 'air' : 'stone';
      return { name, position: p, boundingBox: name === 'sand' || name === 'stone' ? 'block' : 'empty', diggable: true, digTime: () => 750, getProperties: () => ({ level: 0 }) };
    },
    pathfinder: { setGoal() {} }, stopDigging() {}, clearControlStates() {}, setControlState() {}, lookAt: async () => {},
    dig: async block => { sand.delete(`${block.position.x},${block.position.y},${block.position.z}`); dug.push(`${block.position}`); } };
  const dug = [];
  const rise = setInterval(() => { if (!sand.has(`0,${Math.floor(bot.entity.position.y) + 2},0`)) bot.entity.position.y += 0.5; if (bot.entity.position.y >= 64) bot.oxygenLevel = 20; }, 20);
  try { await surfaceForAir(bot, new Task('test', 'surface')); }
  finally { clearInterval(rise); }
  assert.deepEqual(dug, ['(0, 58, 0)', '(0, 59, 0)'], 'the fallen sand, one block at a time');
  assert.equal(bot.oxygenLevel, 20);
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

// Note 717: this routine eat did not mark bot._meal, so the shot reflex's
// shield raise or its release-on-lower (combat.js, note 701) could collide
// with the bite mid-consume and the food never rose ("Eating did not
// restore hunger", 25594 mid-242-qe). While the bite is in progress the
// same meal.mealOn(bot) guard combat.js already checks must see it on.
test('eating through maintainVitals marks a meal on, as the stance-chosen eat does', async () => {
  const { mealOn } = require('../src/meal');
  let sawMealDuringConsume = null;
  const bot = { food: 12, health: 18, entity: {}, registry: { foodsByName: { apple: { effectiveQuality: 6.4 } } },
    inventory: { items: () => [{ name: 'apple', count: 1 }] },
    equip: async () => {},
    consume: async () => { sawMealDuringConsume = mealOn(bot); bot.food = 16; },
    deactivateItem: () => {} };
  assert(await maintainVitals(bot, new Task('test', 'eat')));
  assert(sawMealDuringConsume, 'a meal was on (bot._meal) while the bite was in progress');
  assert.equal(bot._meal, null, 'cleared once the eat is done');
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

test('a worn pickaxe does not satisfy acquisition, and it is used up before the replacement', async () => {
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
  assert.equal(bot.heldItem.slot, worn.slot, 'the worn one first; the replacement is the spare');
  stock = [fresh];
  await equipBestTool(bot, { digTime: type => type === 1 ? 100 : 1000 });
  assert.equal(bot.heldItem.slot, fresh.slot, 'and the replacement once it has gone');
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
  // Sealed in, the zombie on the far side of the wall: it eats.
  bot.food = 12; bot.entities[1].position = new Vec3(3, 64, 0);
  bot.world = { raycast: (from, dir) => ({ position: new Vec3(1, 65, 0), intersect: from.plus(dir.scaled(1)) }) };
  assert.equal(await maintainVitals(bot, task), true, 'a zombie behind a wall is no reason not to eat');
});

test('suffocating with the head in gravel, the block is dug before anything else', async () => {
  const { maintainVitals, headInBlock } = require('../src/vitals');
  const dug = [];
  const bot = { oxygenLevel: 20, health: 12, food: 20, entity: { position: new Vec3(0.5, 35, 0.5) }, inventory: { items: () => [] },
    blockAt: p => ({ name: dug.includes(`${p}`) || p.y !== 36 ? 'air' : 'gravel', position: p, boundingBox: dug.includes(`${p}`) || p.y !== 36 ? 'empty' : 'block' }),
    dig: async b => { dug.push(`${b.position}`); }, equip: async () => {} };
  assert.equal(headInBlock(bot), false, 'not hurting: not suffocation');
  bot._recentHurtAt = Date.now();
  assert.equal(headInBlock(bot), true);
  const actions = [];
  await maintainVitals(bot, new Task('mine'), a => actions.push(a.action));
  assert.deepEqual(dug, ['(0, 36, 0)']);
  assert.equal(actions[0], 'dig_out_of_block');
});

test('under a falling gravel column, the dig goes on while the column is still coming down', async () => {
  // mid-110-p: the head's cell was air between one gravel dug and the next landing; the dig stopped there and it suffocated.
  const { maintainVitals } = require('../src/vitals');
  const Vec3 = require('vec3').Vec3;
  let column = 3, eyeFull = true;
  const dug = [];
  const bot = { oxygenLevel: 20, health: 12, food: 20, entity: { position: new Vec3(0.5, 35, 0.5) }, entities: {}, inventory: { items: () => [] },
    blockAt: p => {
      const solid = p.x !== 0 || p.z !== 0 ? p.y >= 35 && p.y <= 45 : false;
      const name = solid ? 'stone' : p.y === 36 ? (eyeFull ? 'gravel' : 'air') : p.y > 36 && p.y <= 36 + column ? 'gravel' : 'air';
      return { name, position: p, boundingBox: name === 'air' ? 'empty' : 'block' };
    },
    dig: async b => { dug.push(`${b.position}`); eyeFull = false; bot._recentHurtAt = Date.now();
      // The next block is a falling entity above the head until it lands.
      if (column > 0) { column--; bot.entities[9] = { name: 'falling_block', position: new Vec3(0.5, 37.5, 0.5) }; setTimeout(() => { eyeFull = true; delete bot.entities[9]; }, 250); } },
    equip: async () => {} };
  bot._recentHurtAt = Date.now();
  await maintainVitals(bot, new Task('climb'), () => {});
  assert.equal(dug.length, 4, `the block at the head and the three that fell after it: ${dug.length}`);
  assert.equal(column, 0); assert.equal(eyeFull, false);
});

test('the way to air can be through a block dug quickly: sideways out of a flooded column under a lake, not up into it', () => {
  // Trial 63: a water column under a dripstone lid with a lake over it, and
  // two pointed dripstones between the bot and a dry cave. The only rule
  // left was to dig straight up, into the lake.
  const mcData = require('minecraft-data')('26.1'), Block = require('prismarine-block')('26.1');
  const make = name => Block.fromStateId(mcData.blocksByName[name].defaultState, 0);
  const world = (x, y, z) => {
    if (x === 0 && z === 0 && y >= 40 && y <= 42) return 'water';
    if (x === 0 && z === 0 && y === 43) return 'dripstone_block';
    if (x >= -1 && x <= 1 && z >= -1 && z <= 1 && y >= 44 && y <= 49) return 'water';
    if (x === 1 && z === 0 && (y === 40 || y === 41)) return 'pointed_dripstone';
    if (x >= 2 && x <= 5 && z === 0 && y >= 39 && y <= 41) return 'air';
    return 'stone';
  };
  const blocks = new Map();
  const blockAt = p => { const k = `${p.x},${p.y},${p.z}`; if (!blocks.has(k)) { const b = make(world(p.x, p.y, p.z)); b.position = p; blocks.set(k, b); } return blocks.get(k); };
  const stonePick = { name: 'stone_pickaxe', type: mcData.itemsByName.stone_pickaxe.id };
  const bot = { entity: { position: new Vec3(0.5, 40.4, 0.5), isInWater: true, onGround: false, effects: {} }, oxygenLevel: 14,
    inventory: { items: () => [stonePick] }, blockAt };
  const route = airRoute(bot);
  assert(route, 'a way out');
  const dug = route.flatMap(c => (c.digs || []).map(d => `${d}`));
  assert(dug.every(d => /^\(1, 4[01], 0\)$/.test(d)), `digs only the pointed dripstone: ${dug}`);
  assert(route.at(-1).x >= 2, 'ends in the cave');
  assert(!dug.includes('(0, 43, 0)'), 'not the lid under the lake');
});

test('in a drift of powder snow, the way out is dug through it to the nearest cell clear of it with a floor', () => {
  // Trial 89: spawned in powder snow four deep, took it for a roof, and froze to death.
  const { inPowderSnow, snowRoute } = require('../src/vitals');
  const name = p => p.y < 60 ? 'stone' : (Math.abs(p.x) <= 3 && Math.abs(p.z) <= 3 && p.y <= 63) ? 'powder_snow' : 'air';
  const bot = { entity: { position: new Vec3(0.5, 60, 0.5) }, blockAt: p => { const n = name(p); return { name: n, position: p, boundingBox: n === 'stone' ? 'block' : 'empty' }; } };
  assert.equal(inPowderSnow(bot), true);
  const route = snowRoute(bot);
  assert(route && route.length, 'a way out');
  const end = route.at(-1);
  assert.equal(name(end), 'air'); assert.equal(name(end.offset(0, 1, 0)), 'air');
  assert.equal(route.length, 4, 'four cells to the edge of the drift');
  bot.entity.position = new Vec3(10.5, 60, 0.5);
  assert.equal(inPowderSnow(bot), false);
});

test('in burning grass, the way out is to the nearest cell two blocks clear of any fire, and water counts', () => {
  // Trial 101: stood in a forest fire from twenty health to nothing, mining the tree.
  const { inFire, fireRoute } = require('../src/vitals');
  const fire = new Set(['0,60,0', '1,60,0', '0,60,1', '-1,60,0', '0,60,-1', '1,60,1']);
  const name = p => p.y < 60 ? 'grass_block' : fire.has(`${p.x},${p.y},${p.z}`) ? 'fire' : 'air';
  const bot = { entity: { position: new Vec3(0.5, 60, 0.5), metadata: [1] }, blockAt: p => { const n = name(p); return { name: n, position: p, boundingBox: n === 'grass_block' ? 'block' : 'empty' }; } };
  assert.equal(inFire(bot), true);
  const route = fireRoute(bot);
  assert(route && route.length, 'a way out');
  const end = route.at(-1);
  for (const k of fire) { const [x, , z] = k.split(',').map(Number); assert(Math.max(Math.abs(x - end.x), Math.abs(z - end.z)) > 2, `clear of the fire at ${k}: ${end}`); }
  assert.equal(route.filter(p => name(p) === 'fire').length, 1, 'ringed by fire, through one cell of it');
  fire.delete('1,60,0');
  assert(fireRoute(bot).every(p => name(p) !== 'fire'), 'with a gap, round the flames');
  bot.entity.position = new Vec3(10.5, 60, 0.5);
  assert.equal(inFire(bot), false, 'burning out with no fire near is left to burn out');
});

test('out of fire, the run goes to no cell beside a fall that kills, and a shallow drop beside is still walked (mid-208-k-nether-2, note 548)', () => {
  // mid-208-k-nether-2 ran out of a fire at 19.5 health to a cell by an edge
  // and went on over it, forty-seven blocks into the lava sea.
  const { fireRoute } = require('../src/vitals');
  const fire = new Set(['0,81,0', '1,81,0', '-1,81,0', '0,81,1', '0,81,-1']);
  const make = edge => p => {
    if (p.x >= 5 && p.y >= edge) return 'air';
    if (p.y <= 31) return 'lava';
    if (p.y < 81) return 'netherrack';
    return fire.has(`${p.x},${p.y},${p.z}`) ? 'fire' : 'air';
  };
  const botIn = name => ({ health: 19.5, game: { dimension: 'the_nether' }, entity: { position: new Vec3(0.5, 81, 0.5), metadata: [1] },
    blockAt: p => { const n = name(p); return { name: n, position: p, boundingBox: n === 'netherrack' ? 'block' : 'empty' }; } });
  // Void from x 5 down to the lava: the nearest clear cell toward it, x 4, is beside it.
  const route = fireRoute(botIn(make(32)));
  assert(route && route.length, 'a way out');
  for (const c of route) assert(c.x <= 3, `no cell beside the drop: ${c}`);
  // A drop of two onto rock beside the same cell is no fall that kills: it is still the way.
  const shallow = fireRoute(botIn(make(79)));
  assert.equal(`${shallow.at(-1)}`, '(4, 81, 0)', 'the nearest clear cell, a shallow drop beside it');
});

// mid-243-ad-nether-1's span as the region file has it (note 575): a
// one-wide basalt span at y 33 from x 31 east over the lava sea (its top at
// y 31), the bot's own oak planks at its west end, the bot at (31, 34, 15)
// in a fire lit on the planks, magma cubes about.
function spanInFire({ items = [], health = 7.5 } = {}) {
  const fire = new Set(['31,34,15', '30,34,15', '30,34,14', '31,34,16']);
  const name = p => {
    if (p.y <= 31) return 'lava';
    if (p.y === 33 && p.z === 15 && p.x >= 31 && p.x <= 45) return 'basalt';
    if (p.y === 33 && p.z === 15 && p.x === 30) return 'oak_planks';
    return fire.has(`${p.x},${p.y},${p.z}`) ? 'fire' : 'air';
  };
  const cube = (id, x, z) => ({ id, name: 'magma_cube', type: 'hostile', position: new Vec3(x, 34, z), height: 1.04, width: 1.04, isValid: true });
  return { health, food: 20, oxygenLevel: 20, game: { dimension: 'the_nether' }, _inFireAt: Date.now(),
    entity: { position: new Vec3(31.75, 34, 15.5), metadata: [1], onGround: true, eyeHeight: 1.62, yaw: 0, pitch: 0 },
    entities: { 1: cube(1, 33.5, 15.5), 2: cube(2, 29.5, 17.5), 3: cube(3, 32.5, 12.5), 4: cube(4, 34.8, 16) },
    inventory: { items: () => items, slots: {} }, heldItem: null,
    blockAt: p => { const q = p.floored ? p.floored() : p; const n = name(q); return { name: n, position: q, boundingBox: /basalt|planks/.test(n) ? 'block' : 'empty' }; },
    setControlState() {}, getControlState() { return false; }, clearControlStates() {}, lookAt: async () => {}, look: async () => {} };
}

test('in fire on a one-wide span over the lava sea, the way out is walked crouched along the span, not refused (mid-243-ad-nether-1, note 575)', async () => {
  // Every cell of the span is beside the drop into the lava: note 548's rule refused them all, and the bot stood in the fire from 7.5 to none.
  const vitals = require('../src/vitals');
  const bot = spanInFire({ items: [{ name: 'gravel', count: 16 }] });
  assert.equal(vitals.inFire(bot), true);
  const route = vitals.fireRoute(bot);
  assert(route && route.length, 'a way out');
  assert(route.every(c => c.y === 34 && c.z === 15 && c.x > 31), `along the span: ${route.join(' ')}`);
  const ways = vitals.fireWays(bot, new Task('t'));
  assert.deepEqual(Object.keys(ways), ['crouch_out_of_fire', 'rise_on_block'], 'no run clear of the edge exists; the crouch first, the block to stand on beside it');
  assert.match(ways.crouch_out_of_fire.description, /crouched, \d+ steps to a cell two blocks from any flame, \d+ of them beside a drop into lava 2 down: crouched, a body does not walk off an edge/);
  assert.match(ways.rise_on_block.description, /block of gravel \(16 carried\) in the fire's cell underfoot/);
  // The crouch is walked on the keys, sneaking, every step of it.
  const motion = require('../src/motion'), move = motion.move, moves = [];
  // The server's in-fire hurts stop once the body is out of the flames.
  motion.move = async (b, task, opts) => { moves.push(opts); b.entity.position = new Vec3(opts.look.x, 34, opts.look.z); b._inFireAt = 0; return true; };
  try { assert.equal(await ways.crouch_out_of_fire.run(), true); }
  finally { motion.move = move; }
  assert.equal(moves.length, route.length);
  assert(moves.every(m => m.sneak === true && !m.keys.includes('sprint')), 'crouched, never at a sprint beside the drop');
  // With no block to stand on, the crouch is still there.
  assert.deepEqual(Object.keys(vitals.fireWays(spanInFire(), new Task('t'))), ['crouch_out_of_fire']);
});

test('in fire with a mob about, the vitals step walks out of the fire rather than stop for the threat (mid-242-ac-nether-1-fortress-3, mid-243-ad-nether-1, note 575)', async () => {
  // The work's turn hands the vitals its task with the threat check on; it threw "Threat nearby" before the fire was looked at,
  // twenty-one times a second, while mid-242-ac stood in fire at a fortress from 9.2 to 5.4 with blazes six blocks off.
  const vitals = require('../src/vitals');
  const { NeedsSafety } = require('../src/danger');
  const bot = spanInFire();
  const task = new Task('work');
  task.interruptCheck = () => { throw new NeedsSafety({ entity: { name: 'magma_cube' }, distance: 3 }); };
  const motion = require('../src/motion'), move = motion.move, moves = [];
  motion.move = async (b, t, opts) => { t.check(); moves.push(opts); b.entity.position = new Vec3(opts.look.x, 34, opts.look.z); b._inFireAt = 0; return true; };
  const acted = [];
  try { await assert.rejects(vitals.maintainVitals(bot, task, step => acted.push(step)), /Threat nearby/, 'the threat still stops what comes after'); }
  finally { motion.move = move; }
  assert.equal(acted[0]?.action, 'out_of_fire', 'the fire answered first');
  assert(moves.length >= 1, 'and walked');
  assert.equal(vitals.inFire(bot), false, 'out of the flames');
});

test('alight with no flames about and no water, the fire reflex stands aside; in flames, or with water at hand, it answers (mid-235-q-nether-3, note 548)', () => {
  // mid-235-q-nether-3, mid-208-k and mid-235-q-nether-2-fortress-1 each stood five to seven seconds on the reflex,
  // alight in the Nether with nothing to put it out, a blaze shooting on: 20 to 9, 15.3 to 5.9, 9 to 5.
  const { fireToAnswer } = require('../src/vitals');
  const { probe } = require('../src/arbiter');
  const names = new Map();
  const at = (dimension, items = []) => ({ game: { dimension }, entity: { position: new Vec3(0.5, 64, 0.5), metadata: [1] }, inventory: { items: () => items },
    blockAt: p => { const n = names.get(`${p}`) || (p.y < 64 ? 'netherrack' : 'air'); return { name: n, position: p, boundingBox: n === 'netherrack' ? 'block' : 'empty' }; } });
  const nether = at('the_nether');
  assert.equal(fireToAnswer(nether), false, 'alight in the Nether, nothing burning about: only time puts it out');
  assert.equal(probe.burning(nether), false, 'and the reflex does not take the turn');
  names.set(`${new Vec3(0, 64, 0)}`, 'fire');
  assert.equal(probe.burning(nether), true, 'standing in flames: stepped out of');
  names.clear();
  nether._inFireAt = Date.now();
  assert.equal(probe.burning(nether), true, 'the server\'s in-fire hurt just now: the same');
  assert.equal(probe.burning(at('overworld')), false, 'alight in the Overworld, no water near: nothing to do but burn out');
  assert.equal(probe.burning(at('overworld', [{ name: 'water_bucket', count: 1 }])), true, 'a water bucket carried puts it out');
  names.set(`${new Vec3(4, 63, 0)}`, 'water');
  assert.equal(probe.burning(at('overworld')), true, 'and a pond within eight');
});

test('burning with no fire about and a water bucket carried, the bucket is poured at the feet and taken back', async () => {
  // mid-110-b: out of the lava it was getting obsidian from, burned from thirteen health to two with a water bucket in its pack.
  const { douse } = require('../src/vitals');
  const { Task } = require('../src/skills');
  const names = new Map();
  const items = [{ name: 'water_bucket', count: 1 }];
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5), metadata: [1] }, health: 12, inventory: { items: () => items },
    blockAt: p => { const n = names.get(`${p}`) || (p.y < 64 ? 'stone' : 'air'); return { name: n, position: p, boundingBox: n === 'stone' ? 'block' : 'empty' }; },
    equip: async item => { bot.held = item.name; }, lookAt: async () => {},
    activateItem: () => {
      if (bot.held === 'water_bucket') { names.set(`${new Vec3(0, 64, 0)}`, 'water'); bot.entity.metadata[0] = 0; items[0] = { name: 'bucket', count: 1 }; }
      else if (bot.held === 'bucket') { names.delete(`${new Vec3(0, 64, 0)}`); items[0] = { name: 'water_bucket', count: 1 }; }
    } };
  assert.equal(await douse(bot, new Task('burn')), true);
  assert.equal(items[0].name, 'water_bucket', 'the water taken back');
  bot.game.dimension = 'the_nether'; bot.entity.metadata[0] = 1;
  assert.equal(await douse(bot, new Task('burn')), false, 'water boils away in the Nether');
});

// The pond mid-92-b drowned in (2026-09-25), as the region file has it:
// x -113 to -104 along each row, z 78 to 85 down the rows. o a lily pad,
// ~ still water, f falling water, s seagrass, , grass, d dirt, v vine.
const POND_92B = {
  64: ['..........', '..........', '........v.', '.......vvv', '......v...', '......v...', '..........', '......v...'],
  63: ['.o..o.....', '..........', '..........', '....o.....', ',.....v...', ',,,...v...', ',,,,......', ',,,,......'],
  62: ['~~,,s~~~~~', '~,,,,s~~~~', '~,,,~~s~~~', ',,,,~~~~~~', 'd,,,~~~~~~', 'ddd~~ss~~~', 'dddd~~,,~~', 'dddds,,,~~'],
  61: ['dddds~~~~~', 'ddddds~~~~', 'dddddds~~~', 'ddd.fdd~~~', 'ddddfddddd', 'ddddfddddd', 'dddddddddd', 'dddddddddd'],
  60: ['ddddd~~~~~', 'dddddd~~~~', 'ddddddd~~~', 'ddddfdd~~d', 'ddddfddddd', 'ddddfddddd', 'dddddddddd', 'dddddddddd'],
};
function pondBot({ start = new Vec3(-108.5, 61.2, 81.5) } = {}) {
  const mcData = require('minecraft-data')('26.1'), Block = require('prismarine-block')('26.1');
  const { swimmableWater } = require('../src/terrain');
  const names = { '.': 'air', o: 'lily_pad', '~': 'water', f: 'water', s: 'seagrass', ',': 'grass_block', d: 'dirt', v: 'vine' };
  const dug = new Set(), cache = new Map();
  const blockAt = q => {
    const p = q.floored(), k = `${p}`;
    if (!cache.has(k)) {
      const c = POND_92B[p.y]?.[p.z - 78]?.[p.x + 113];
      const name = dug.has(k) ? 'air' : c ? names[c] : p.y < 60 ? 'dirt' : 'air';
      const b = Block.fromStateId(mcData.blocksByName[name].defaultState + (c === 'f' ? 8 : 0), 0);
      b.position = p; cache.set(k, b);
    }
    return cache.get(k);
  };
  const solid = b => b.boundingBox === 'block';
  const pick = { name: 'diamond_pickaxe', type: mcData.itemsByName.diamond_pickaxe.id };
  const controls = {}; let look = null, ticks = 0;
  // Where the flight record has it: afloat at y 61.2 in the falling column,
  // the top of its head against the lily pad's underside at y 63.
  const bot = { oxygenLevel: 12, entity: { position: start.clone(), eyeHeight: 1.62, isInWater: true, onGround: false, effects: {} },
    inventory: { items: () => [pick] }, blockAt, dug, controls,
    pathfinder: { setGoal() {} }, stopDigging() {}, clearControlStates() { for (const k in controls) controls[k] = false; },
    setControlState(key, value) { controls[key] = value; }, lookAt: async p => { look = p; }, equip: async () => {},
    dig: async block => { const k = `${block.position}`; dug.add(k); cache.delete(k); } };
  // A swimmer's physics, twenty times a second: jump rises, sneak sinks, and
  // nothing held sinks slowly; a collision box over the head (a lily pad's
  // is at the bottom of its cell) is a ceiling, one under the feet a floor.
  // Forward swims toward where the bot last looked if the body fits there.
  // Air goes a point every fifteen ticks with the eyes under, and comes
  // back a point a tick above.
  const fits = (x, y, z) => { for (let cy = Math.floor(y); cy <= Math.floor(y + 1.79); cy++) if (solid(blockAt(new Vec3(x, cy, z)))) return false; return true; };
  const tick = setInterval(() => {
    const p = bot.entity.position;
    const vy = controls.jump ? 0.15 : controls.sneak ? -0.15 : -0.03;
    let top = Infinity, bottom = -Infinity;
    for (let cy = Math.floor(p.y) + 1; cy <= Math.floor(p.y + 1.8) + 1; cy++) {
      const b = blockAt(new Vec3(p.x, cy, p.z));
      if (solid(b)) { top = cy + (b.shapes?.[0]?.[1] ?? 0); break; }
    }
    if (solid(blockAt(new Vec3(p.x, p.y - 0.01, p.z)))) bottom = Math.floor(p.y - 0.01) + 1;
    p.y = Math.max(bottom, Math.min(top - 1.8, p.y + vy));
    if (controls.forward && look) {
      const dx = look.x - p.x, dz = look.z - p.z, d = Math.hypot(dx, dz);
      if (d > 0.01) { const s = Math.min(0.15, d), nx = p.x + dx / d * s, nz = p.z + dz / d * s; if (fits(nx, p.y, nz)) { p.x = nx; p.z = nz; } }
    }
    bot.entity.onGround = p.y === bottom;
    bot.entity.isInWater = swimmableWater(blockAt(p)) || swimmableWater(blockAt(p.offset(0, 1, 0)));
    ticks++;
    if (headSubmerged(bot)) { if (ticks % 15 === 0) bot.oxygenLevel = Math.max(0, bot.oxygenLevel - 1); }
    else bot.oxygenLevel = Math.min(20, bot.oxygenLevel + 1);
  }, 50);
  bot.stop = () => clearInterval(tick);
  return bot;
}

test('under a lily pad, the way to air digs the pad or swims round it, and is never held against it', async () => {
  // mid-92-b came up a flooded shaft into a pond under a lily pad. The way to
  // air went up through the pad: a block that comes away at a touch, so it
  // cost the search nothing and was named as nothing to dig. Its underside
  // held the head a tenth under the surface, and the bot pressed jump into
  // it for thirteen seconds and drowned (2026-09-25).
  const bot = pondBot();
  try {
    assert.equal(headSubmerged(bot), true, 'the eyes are under the surface');
    const route = airRoute(bot);
    assert(route, 'a way to air');
    for (const cell of route) for (const p of [cell, cell.offset(0, 1, 0)]) {
      const b = bot.blockAt(p);
      if (b.boundingBox === 'block') assert((cell.digs || []).some(d => d.equals(p)), `the ${b.name} at ${p} is dug, not swum through`);
    }
    const task = new Task('test', 'surface'), started = Date.now();
    const limit = setTimeout(() => task.cancel(), 8000);
    try { await surfaceForAir(bot, task); } finally { clearTimeout(limit); }
    assert.equal(headSubmerged(bot), false, 'the head out of the water');
    assert(Date.now() - started < 3000, `in a moment, not ${Date.now() - started} ms`);
    assert.deepEqual([...bot.dug], ['(-109, 63, 81)'], 'the pad, and nothing else');
  } finally { bot.stop(); }
});

test('a swimmer that stops getting anywhere on its way to air takes another way at once', async () => {
  // The same pond, with the route made blind to the pad (as it was): the
  // swimmer, held still under something the search did not see, must not
  // spend its air pressing into it. mid-92-b held jump thirteen seconds.
  const bot = pondBot(), task = new Task('test', 'surface'), started = Date.now();
  const real = bot.blockAt, pad = new Vec3(-109, 63, 81);
  let blind = true;
  // What the bot reads; the physics still has the pad stop the head.
  bot.blockAt = p => blind && p.floored().equals(pad) ? { ...real(p), name: 'air', boundingBox: 'empty' } : real(p);
  const limit = setTimeout(() => task.cancel(), 8000);
  try { await surfaceForAir(bot, task); } finally { blind = false; clearTimeout(limit); bot.stop(); }
  assert.equal(headSubmerged(bot), false, 'the head out of the water');
  assert(Date.now() - started < 5000, `in a few seconds, not ${Date.now() - started} ms`);
});

test('a falling gravel column is dug out as often as it refills', async () => {
  // mid-79-c: four tries a time, broken off by a creeper at ten blocks and by the spare pickaxe, and it suffocated from nineteen health.
  const { maintainVitals } = require('../src/vitals');
  let column = 6, digs = 0;
  const bot = { oxygenLevel: 20, health: 12, food: 20, entity: { position: new Vec3(0.5, 35, 0.5) }, inventory: { items: () => [] }, _recentHurtAt: Date.now(),
    blockAt: p => ({ name: p.y === 36 && column > 0 ? 'gravel' : p.y < 35 ? 'air' : 'stone', position: p, boundingBox: (p.y === 36 && column > 0) || (p.y >= 35 && p.y !== 36) ? 'block' : 'empty' }),
    dig: async () => { digs++; column--; }, equip: async () => {} };
  // As the survival layer calls it: its own threat check is off (stepOnce).
  await maintainVitals(bot, new Task('mine')).catch(() => {});
  assert.equal(digs, 6, 'the whole column, not four');
});

test('burning with no water bucket, water within eight blocks is run into', async () => {
  // mid-110-j: out of a lava pool with an empty bucket, burned from sixteen to nothing on the bank.
  const { douse } = require('../src/vitals');
  const { Task } = require('../src/skills');
  const pond = new Vec3(4, 63, 0);
  const controls = {};
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5), metadata: [1], isInWater: false }, health: 12, inventory: { items: () => [{ name: 'bucket', count: 1 }] },
    blockAt: p => ({ name: p.equals(pond) ? 'water' : p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p.y < 64 && !p.equals(pond) ? 'block' : 'empty' }),
    lookAt: async () => {}, getControlState: k => !!controls[k], clearControlStates: () => {},
    setControlState: (k, v) => { controls[k] = v; if (k === 'forward' && v) { bot.entity.isInWater = true; bot.entity.metadata[0] = 0; } } };
  const said = [];
  assert.equal(await douse(bot, new Task('burn'), a => said.push(a)), true);
  assert.deepEqual(said[0].pond, { x: 4, y: 63, z: 0 });
});

test('while an encounter stance is carried out the meal is Jev\'s, not a reflex between its ticks', async () => {
  // mid-83-d ate at twelve health in the middle of the retreat it had chosen.
  let eaten = 0;
  const bot = { food: 16, health: 12, entity: {},
    registry: { foodsByName: { bread: { effectiveQuality: 11 } } },
    inventory: { items: () => [{ name: 'bread', count: 2 }] },
    equip: async () => {}, consume: async () => { eaten++; bot.food = 20; }, deactivateItem() {},
    _stance: { choice: 'retreat', at: Date.now(), health: 13, running: true } };
  assert.equal(await maintainVitals(bot, new Task('crowd')), false);
  assert.equal(eaten, 0, 'the retreat goes on');
  bot._stance.choice = 'keep_working';
  assert(await maintainVitals(bot, new Task('left be')), 'leaving the mobs be is not a stance that eating stops');
  assert.equal(eaten, 1);
  bot.food = 5; bot._stance.choice = 'retreat';
  assert(await maintainVitals(bot, new Task('starving')), 'down to six hunger it eats whatever the stance');
});

test('no meal with a creeper coming on in sight; a zombie as far off does not stop it', async () => {
  // mid-214-c: ate with a creeper eight blocks off, stood still three and a half seconds, one blast.
  let eaten = 0;
  const creeper = { name: 'creeper', type: 'hostile', position: new Vec3(8.5, 64, 0.5), height: 1.7, isValid: true };
  const bot = { food: 17, health: 13.6, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 7: creeper },
    registry: { foodsByName: { cooked_beef: { effectiveQuality: 20.8 } }, entitiesByName: { creeper: { type: 'hostile' }, zombie: { type: 'hostile' } } },
    inventory: { items: () => [{ name: 'cooked_beef', count: 2 }] },
    equip: async () => {}, consume: async () => { eaten++; bot.food = 20; }, deactivateItem() {},
  };
  assert.equal(await maintainVitals(bot, new Task('creeper')), false);
  assert.equal(eaten, 0);
  creeper.name = 'zombie';
  assert(await maintainVitals(bot, new Task('zombie')));
  assert.equal(eaten, 1);
});

test('no meal in a witch\'s throwing range while it can see the bot', async () => {
  // mid-237-b: stood eating three seconds poisoned with a witch ten blocks off; its harming potion took four.
  let eaten = 0;
  const witch = { name: 'witch', type: 'hostile', position: new Vec3(9.5, 64, 0.5), height: 1.9, isValid: true };
  const bot = { food: 17, health: 13.6, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 7: witch },
    registry: { foodsByName: { cooked_beef: { effectiveQuality: 20.8 } }, entitiesByName: { witch: { type: 'hostile' } } },
    inventory: { items: () => [{ name: 'cooked_beef', count: 2 }] },
    equip: async () => {}, consume: async () => { eaten++; bot.food = 20; }, deactivateItem() {},
  };
  assert.equal(await maintainVitals(bot, new Task('witch')), false);
  witch.position = new Vec3(20.5, 64, 0.5);
  assert(await maintainVitals(bot, new Task('far witch')));
  assert.equal(eaten, 1);
});

test('a dig the server never finishes is given up after three times what it should take', async () => {
  // mid-243-a: thirty seconds on one block of a shelter wall with a creeper coming.
  let reject;
  const bot = { oxygenLevel: 20, entity: { position: new Vec3(0, 64, 0), onGround: true }, heldItem: null, blockAt: () => ({ name: 'air' }),
    dig: () => new Promise((_, r) => { reject = r; }), stopDigging: () => reject(new Error('Digging aborted')) };
  const block = { name: 'dirt', position: new Vec3(1, 64, 0), digTime: () => 100 };
  const started = Date.now();
  await assert.rejects(digWithAirGuard(bot, new Task('dig'), block), { name: 'DigStalled' });
  assert(Date.now() - started < 4000, 'given up in about 2.3 seconds, not waited on');
});

test('told by the server it is freezing, the bot leaves the snow though the blocks did not show it in any', async () => {
  // mid-202-f froze to death at y 121, the way out of the snow tried once (note 308).
  const { maintainVitals } = require('../src/vitals');
  const { Vec3 } = require('vec3');
  const { Task } = require('../src/skills');
  // A snowfield: powder snow round the bot's cell, firm stone four blocks east.
  const at = p => { const f = p.floored(); if (f.y < 64) return { name: 'stone', boundingBox: 'block', position: f }; if (f.y <= 65 && f.x < 4 && f.x > -4 && !(f.x === 0 && f.z === 0)) return { name: 'powder_snow', boundingBox: 'empty', position: f }; return { name: 'air', boundingBox: 'empty', position: f }; };
  const went = [];
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5), eyeHeight: 1.62 }, health: 18, food: 20, oxygenLevel: 20, entities: {}, game: { dimension: 'overworld' },
    inventory: { items: () => [] }, registry: require('minecraft-data')('26.1'), blockAt: at, _freezingAt: Date.now(), lookAt: async () => {}, dig: async () => {},
    pathfinder: { goto: async g => { went.push(g); bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); } } };
  await maintainVitals(bot, new Task('snow'), () => {});
  assert.equal(went.length, 1, 'walked out');
  assert(Math.abs(went[0].x) >= 4, `to firm ground clear of the snow: ${went[0].x}`);
});

test('suffocation is tested as the game does, a box round the eye: a block in the next column counts', () => {
  // mid-205-l rejoined with its eye at x -368.9, the box reaching into gravel at x -370, and suffocated with its eye's cell open.
  const { suffocatingBlock } = require('../src/vitals');
  const bot = { entity: { position: new Vec3(-368.9, 67, 577.5), width: 0.6, eyeHeight: 1.62 },
    blockAt: p => { const q = p.floored(); const name = q.x === -370 ? 'gravel' : 'air'; return { name, position: q, boundingBox: name === 'air' ? 'empty' : 'block' }; } };
  assert.equal(suffocatingBlock(bot)?.name, 'gravel');
  assert.equal(suffocatingBlock(bot).position.x, -370);
  bot.entity.position = new Vec3(-368.5, 67, 577.5);
  assert.equal(suffocatingBlock(bot), null, 'centred in its cell: clear');
});

// mid-244-y (note 477): a lake sealed under stone at x 19-32, y 49-57, its
// air up a flooded column at x 18.
function sealedLake({ column = true } = {}) {
  const mcData = require('minecraft-data')('26.1'), Block = require('prismarine-block')('26.1'), blocks = new Map();
  const world = (x, y, z) => {
    if (column && x === 18 && z === 143) return y >= 63 ? 'air' : y >= 49 ? 'water' : 'stone';
    if (x >= 19 && x <= 32 && z >= 140 && z <= 146 && y >= 49 && y <= 57) return 'water';
    return y >= 72 ? 'air' : 'stone';
  };
  const blockAt = q => { const p = q.floored(), k = `${p}`; if (!blocks.has(k)) { const b = Block.fromStateId(mcData.blocksByName[world(p.x, p.y, p.z)].defaultState, 0); b.position = p; blocks.set(k, b); } return blocks.get(k); };
  return { entity: { position: new Vec3(27.5, 56, 143.5), isInWater: true, onGround: false, effects: {} }, oxygenLevel: 12, health: 20, inventory: { items: () => [] }, blockAt };
}

test('the way to air is searched as far as the breath goes, not eight blocks each way', () => {
  // Boxed to eight, the search found none, and it dug by hand into the twelve-block lid and drowned.
  const bot = sealedLake();
  const route = airRoute(bot);
  assert(route, 'a way to air');
  assert.deepEqual([route.at(-1).x, route.at(-1).y, route.at(-1).z], [18, 62, 143], 'up the flooded column');
  assert(route.every(c => !c.digs.length), 'swum, not dug');
});

test('straight up is not dug where the lid takes longer than the breath and health there are', async () => {
  const bot = sealedLake({ column: false }), dug = [];
  bot.oxygenLevel = 2; bot.health = 4;
  Object.assign(bot, { pathfinder: { setGoal() {} }, stopDigging() {}, clearControlStates() {}, setControlState() {}, lookAt: async () => {}, dig: async b => { dug.push(`${b.position}`); } });
  await assert.rejects(surfaceForAir(bot, new Task('test', 'surface')), /breathable air/);
  assert.deepEqual(dug, [], 'no hand against the stone');
});

test('air is not taken in the spill at a waterfall\'s lip, beside the shaft it runs into (mid-237-j, note 518)', () => {
  // A waterfall up a shaft at x 0, its spill at the top (0,34,0) level 1; beside it at x 1 an open shaft thirteen
  // blocks to lava; a mossy bank at x -1. The swimmer breathed in the spill, the current took it over the lip, three times.
  const mcData = require('minecraft-data')('26.1'), Block = require('prismarine-block')('26.1'), blocks = new Map();
  const world = (x, y, z) => {
    if (x === 0 && z === 0) return y === 34 ? ['water', { level: 1 }] : y >= 20 && y < 34 ? ['water', { level: 8 }] : y > 34 ? ['air'] : ['stone'];
    if (x === 1 && z >= -1 && z <= 1) return y === 21 ? ['lava', { level: 0 }] : y > 21 ? ['air'] : ['stone'];
    if (x === -1 && z === 0) return y >= 34 ? ['air'] : ['stone'];
    return y >= 36 ? ['air'] : ['stone'];
  };
  const blockAt = q => { const p = q.floored(), k = `${p}`; if (!blocks.has(k)) { const [name, props = {}] = world(p.x, p.y, p.z); const b = Block.fromProperties(mcData.blocksByName[name].id, props, 0); b.position = p; blocks.set(k, b); } return blocks.get(k); };
  const bot = { entity: { position: new Vec3(0.5, 32, 0.5), isInWater: true, onGround: false, effects: {} }, oxygenLevel: 13, health: 15, inventory: { items: () => [] }, blockAt };
  const route = airRoute(bot);
  assert(route, 'a way to air');
  const end = route.at(-1);
  assert.notDeepEqual([end.x, end.y, end.z], [0, 34, 0], 'not the spill at the lip');
  assert.deepEqual([end.x, end.y, end.z], [-1, 34, 0], 'the bank beside it');
});

test('rotten flesh is eaten with no rule of ours on health, and offered with its Hunger said: on the claim and as a stance (note 515)', async () => {
  // The gate ate it only hurt and under eighteen hunger; several of the day's low-health deaths carried it.
  const { maintainVitals, claim } = require('../src/vitals');
  const { claimSays } = require('../src/arbiter');
  const { mealHelps, eatSays } = require('../src/survival');
  const registry = require('minecraft-data')('26.1');
  let ate = 0;
  const bot = { registry, health: 20, food: 16, oxygenLevel: 20, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, game: { gameMode: 'survival', dimension: 'overworld' },
    inventory: { items: () => [{ name: 'rotten_flesh', count: 3 }] }, heldItem: { name: 'rotten_flesh' },
    equip: async () => {}, consume: async () => { ate++; bot.food += 4; }, deactivateItem() {}, blockAt: p => ({ name: 'air', position: p, boundingBox: 'empty' }) };
  const c = claim(bot);
  assert.equal(c?.action, 'eat');
  assert.equal(c.facts.item, 'rotten_flesh');
  assert.match(claimSays(c), /Eat rotten flesh now.*Hunger 16 to 20\. It is the last resort: each eaten has a 80% chance of Hunger for 30 seconds/);
  assert.equal(await maintainVitals(bot, new Task('full health, hunger sixteen')), true);
  assert.equal(ate, 1);
  bot.health = 9; bot.food = 15;
  const meal = mealHelps(bot);
  assert.equal(meal?.name, 'rotten_flesh', 'with nothing safe, the last resort is a stance');
  assert.match(eatSays(bot, meal), /hunger 15 to 19, then health comes back.*It is the last resort: each eaten has a 80% chance of Hunger/);
});

test('a hoglin is hostile to the meal: none at arm\'s length, and one walking up is said on the claim with its speed and hit (mid-208-k-nether-1, note 552)', async () => {
  // The registry calls a hoglin an animal: the bot ate with one at 1.2 blocks and at 2, bitten 9.4 to 4.6 and 4 to none.
  const { maintainVitals, claim } = require('../src/vitals');
  const { claimSays } = require('../src/arbiter');
  const registry = require('minecraft-data')('26.1');
  let eaten = 0;
  const hoglin = { id: 210, name: 'hoglin', type: 'animal', position: new Vec3(2.2, 64, 0.5), height: 1.4, width: 1.4, isValid: true };
  const slots = []; slots[5] = { name: 'iron_helmet' }; slots[6] = { name: 'iron_chestplate' }; slots[7] = { name: 'iron_leggings' }; slots[8] = { name: 'golden_boots' };
  const bot = { registry, health: 4, food: 16, oxygenLevel: 20, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 210: hoglin }, game: { gameMode: 'survival', dimension: 'the_nether' },
    time: { timeOfDay: 6000 }, world: { raycast: () => null }, inventory: { items: () => [{ name: 'beef', count: 1 }], slots }, heldItem: { name: 'beef' },
    equip: async () => {}, consume: async () => { eaten++; bot.food += 3; }, deactivateItem() {}, blockAt: p => ({ name: 'air', position: p, boundingBox: 'empty' }) };
  assert.equal(claim(bot), null, 'no meal claimed with a hoglin at arm\'s length');
  assert.equal(await maintainVitals(bot, new Task('hoglin at arm')), false);
  assert.equal(eaten, 0);
  // Eleven blocks off and walking up at about 3.9 blocks a second: at the bot a second after the meal.
  hoglin.position = new Vec3(11.6, 64, 0.5);
  bot._mobTracks = new Map([[210, [{ at: Date.now() - 1000, x: 15.5, y: 64, z: 0.5 }]]]);
  const c = claim(bot);
  assert.equal(c?.action, 'eat');
  assert.equal(c.facts.comingAtTheBot[0].name, 'hoglin');
  assert.equal(c.facts.comingAtTheBot[0].blocksASecond, 3.9);
  assert.match(claimSays(c), /standing still\..*The hoglin 11\.1 blocks off is coming at about 3\.9 blocks a second, at the bot in about 2\.5 seconds; each hit about 3(\.\d)? through the armour worn \(three to eight a blow before armour, one blow every two seconds at arm's length/);
  // Its hardest blow through that iron and its pace, in the facts (note 587).
  assert.equal(c.facts.comingAtTheBot[0].hitsForAtMost, 4.8);
  assert.equal(c.facts.comingAtTheBot[0].blowEverySeconds, 2);
  // Six blocks off and coming: at the bot before the meal is done, so no meal.
  hoglin.position = new Vec3(6.5, 64, 0.5);
  bot._mobTracks = new Map([[210, [{ at: Date.now() - 1000, x: 10.5, y: 64, z: 0.5 }]]]);
  assert.equal(claim(bot), null, 'one that is at the bot within the meal\'s seconds is close');
});

test('the meal given the turn is stopped by what its claim is made by, not by a blaze the pocket\'s seal was chosen against behind the wall (mid-242-ab-nether-3, note 585)', async () => {
  // Sealed in at 10.6 health, hunger 17, the meal was given the turn 41 times in six seconds: each time the work's
  // threat check found the blaze the seal was chosen against, out of sight behind the pocket's wall, and stopped it.
  const { maintainVitals, claim, checkMeal } = require('../src/vitals');
  const { checkThreats } = require('../src/danger');
  const registry = require('minecraft-data')('26.1');
  let eaten = 0, wall = true;
  const blaze = { id: 9, name: 'blaze', type: 'hostile', position: new Vec3(6.5, 64, 0.5), height: 1.8, width: 0.6, isValid: true };
  const slots = []; slots[5] = { name: 'iron_helmet' }; slots[6] = { name: 'iron_chestplate' };
  const bot = { registry, health: 10.6, food: 17, oxygenLevel: 20, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 9: blaze }, game: { gameMode: 'survival', dimension: 'the_nether' },
    time: { timeOfDay: 6000 }, inventory: { items: () => [{ name: 'beef', count: 1 }], slots }, heldItem: { name: 'beef' },
    world: { raycast: (from, dir) => wall ? { position: from.plus(dir).floored(), intersect: from.plus(dir) } : null },
    equip: async () => {}, consume: async () => { eaten++; bot.food += 3; }, deactivateItem() {}, blockAt: p => ({ name: 'air', position: p, boundingBox: 'empty' }) };
  // The seal chosen against it seven seconds ago, last run three seconds ago: held against it for its fifteen seconds.
  bot._stance = { choice: 'seal', ids: [9], at: Date.now() - 7000, ranAt: Date.now() - 3000, health: 10.6 };
  assert.equal(claim(bot)?.action, 'eat', 'the meal claims: nothing can get at the bot through the wall');
  assert.throws(() => checkThreats(bot), /Threat nearby: blaze at 6 blocks/, 'the work\'s check finds the seal\'s blaze');
  const work = new Task('under the work\'s check'); work.interruptCheck = () => checkThreats(bot);
  await assert.rejects(maintainVitals(bot, work), /Threat nearby/);
  assert.equal(eaten, 0);
  const meal = new Task('under the meal\'s own'); meal.interruptCheck = () => checkMeal(bot);
  assert.equal(await maintainVitals(bot, meal), true);
  assert.equal(eaten, 1, 'eaten in the pocket');
  // In its line, within its reach: no meal claimed, and one begun is stopped.
  wall = false; bot.food = 17;
  assert.equal(claim(bot), null);
  assert.throws(() => checkMeal(bot), /Threat nearby: blaze at 6 blocks/);
  bot.food = 2;
  assert.doesNotThrow(() => checkMeal(bot), 'starving, it eats anyway');
  // And the turn: given the meal by Jev, the loop runs it under the meal's own check, and it eats.
  wall = true; bot.food = 17; eaten = 0;
  bot._stance = { choice: 'seal', ids: [9], at: Date.now() - 7000, ranAt: Date.now() - 3000, health: 10.6 };
  bot._arbiter = {};
  const { liveTurn } = require('../src/work');
  const goal = { request: 'beat the game', kind: 'win', step: { action: 'find_fortress' } };
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'vitals', confidence: 0.9 } } }) };
  const turn = await liveTurn(bot, new Task('the turn'), goal, goal, { step: async () => false, state: {} }, () => {}, { client, onStep: () => {}, save: () => {} });
  assert.equal(turn.layer, 'vitals');
  assert.equal(eaten, 1, 'the meal Jev gave the turn to is eaten, not stopped at once');
});

// mid-242-aa-nether-3's ground at 04:14:17 as the death snapshot's region
// file has it (note 579): x -28 to -15 across, z 40 to 53 down, by layer.
// The bot's cobblestone walk at y 33 along z 47 over a lava lake (its top
// at y 31), magma blocks at (-23, 33, 47) and (-22, 33, 47), open cave air
// down to the lava at (-22, 33, 46) and (-21, 33, 46). The bot hung at
// (-21.58, 34, 46.74), its middle over the hole and its box's edge on the
// magma, where the crouched walk at a netherrack it had dug left it.
const MAGMA_EDGE = {
  36: ['........ccc...', '..............', '..............', '..............', '..............', '........ccc...', '........ccc...', '........ccc...', '..............', '..............', '..............', '..............', '..............', '..............'],
  35: ['........c.c...', '..............', '..............', '..............', '..............', '..............', '..............', '..............', '..............', '..............', '..............', '..............', '..............', '..............'],
  34: ['........c.c...', '..............', '..............', '..............', '..............', '..............', '..............', '..............', '..............', '..............', '..............', '....m.........', '....mm........', '....mm........'],
  33: ['........nnn...', '........nnn...', '.........c....', '.........c....', '.........c....', '........ccc...', '........ccc...', 'cccccmmcccc...', '....mmm..c....', '....sss..c....', '....sss..c....', '....ms...c....', '....mm...c....', '....mm...c....'],
  32: ['........nnnnnn', '........nnnnnn', '..........nnn.', '............n.', '............n.', '....nn........', '..............', '....nnn.......', '....nnn.......', '....sss.......', '....ss........', '...sms........', '...smm........', '...snn........'],
  31: ['llllllllgnnnnn', 'lllllllllnnnnn', 'llllglllllnnnn', 'llllnlllllllnn', 'llllllllllllll', 'llllnnllllllll', 'llllnnllllllll', 'llllnnnlllllll', 'llllnnnlllllll', 'llllssslllllll', 'lllsssllllllll', 'lllsnsllllllll', 'lllsnnllllllll', 'lllsnnllllllll'],
};
function magmaEdge({ position = new Vec3(-21.575835, 34, 46.739675), sneak = false, items = [], health = 19.3 } = {}) {
  const names = { '.': 'air', c: 'cobblestone', m: 'magma_block', n: 'netherrack', s: 'soul_sand', l: 'lava', g: 'gravel' };
  const name = p => {
    if (p.y < 31) return 'lava';
    const c = MAGMA_EDGE[p.y]?.[p.z - 40]?.[p.x + 28];
    return c ? names[c] : p.y > 36 ? 'air' : 'netherrack';
  };
  const controls = { sneak };
  return { health, food: 20, oxygenLevel: 20, game: { dimension: 'the_nether' },
    entity: { position, metadata: [0], onGround: true, eyeHeight: 1.62, yaw: 0, pitch: 0, height: 1.8, width: 0.6 }, entities: {},
    inventory: { items: () => items, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' } } }, heldItem: null,
    blockAt: p => { const q = p.floored ? p.floored() : p; const n = name(q); return { name: n, position: q, boundingBox: /air|lava/.test(n) ? 'empty' : 'block' }; },
    setControlState(k, v) { controls[k] = v; }, getControlState(k) { return !!controls[k]; }, clearControlStates() {}, lookAt: async () => {}, look: async () => {} };
}

test('on a magma block\'s edge over a hole into the lava, the hot floor is seen though the cell under the middle is open (mid-242-aa-nether-3, note 579)', () => {
  const vitals = require('../src/vitals');
  const bot = magmaEdge();
  assert.equal(bot.blockAt(bot.entity.position.floored().offset(0, -1, 0)).name, 'air', 'under the middle: the hole');
  const hot = vitals.onHotFloor(bot);
  assert(hot, 'the body rests on the magma');
  assert.equal(hot.block.name, 'magma_block');
  assert.equal(`${hot.cell}`, '(-22, 34, 47)');
  // Crouched on it, the game does not hurt the body: no danger.
  assert.equal(vitals.onHotFloor(magmaEdge({ sneak: true })), null);
  // Off it, on the cobblestone the stand cell was chosen on, none.
  assert.equal(vitals.onHotFloor(magmaEdge({ position: new Vec3(-20.5, 34, 47.5) })), null);
  // The arbiter sees it as the body's own danger, whatever holds the turn.
  const arbiter = require('../src/arbiter');
  assert(arbiter.observeReflexes(bot, []).some(r => r.key === 'hot_floor' && r.layer === 'vitals'));
  assert(require('../src/stillness').EMERGENCIES.has('off_hot_floor'));
  // A lit campfire hurts crouched or not; an unlit one does not.
  const { hotFloor } = require('../src/terrain');
  assert.equal(hotFloor({ name: 'campfire', getProperties: () => ({ lit: true }) }), true);
  assert.equal(hotFloor({ name: 'soul_campfire', getProperties: () => ({ lit: false }) }), false);
});

test('on the hot floor, Jev is offered the step off crouched and the crouch in place, said with the rate through the armour worn (mid-242-aa-nether-3, note 579)', async () => {
  const vitals = require('../src/vitals');
  const bot = magmaEdge();
  const ways = vitals.hotFloorWays(bot, new Task('t'));
  // Hanging over the hole, the block to stand on is not offered: it would go in the open cell under the middle.
  assert.deepEqual(Object.keys(ways), ['step_off_hot_floor', 'crouch_on_hot_floor']);
  assert.match(ways.step_off_hot_floor.description, /Step off the magma block crouched, 1 step to \(-21, 34, 47\) on cobblestone: crouched, a magma block does not hurt and a body does not walk off an edge \(a drop into lava beside the way\)/);
  assert.match(ways.crouch_on_hot_floor.description, /does not hurt a crouched body on a magma block/);
  const body = require('../src/body');
  const says = body.conditionSays(bot, 'hot_floor', { floor: 'magma_block', hurt: 1, crouchSafe: true });
  // An iron helmet and chestplate: the 0.7 a time the trial took, twice a second.
  assert.match(says, /Standing on a magma block at 19.3 health: it hurts every half second, about 1.4 health a second through the armour worn, about 13.8 seconds to death/);
  // The step off is walked crouched, onto the cobblestone.
  const motion = require('../src/motion'), move = motion.move, moves = [];
  motion.move = async (b, task, opts) => { moves.push(opts); b.entity.position = new Vec3(opts.look.x, 34, opts.look.z); return true; };
  try { assert.equal(await ways.step_off_hot_floor.run(), true); }
  finally { motion.move = move; }
  assert.equal(moves.length, 1);
  assert(moves.every(m => m.sneak === true && !m.keys.includes('sprint')));
  assert.equal(vitals.onHotFloor(bot), null);
  // The crouch: held, and no danger while it is.
  const still = magmaEdge();
  assert.equal(await vitals.hotFloorWays(still, new Task('t')).crouch_on_hot_floor.run(), true);
  assert.equal(still.getControlState('sneak'), true);
  assert.equal(vitals.onHotFloor(still), null);
  // Standing square on the magma with blocks carried, the block to stand on is offered too.
  const square = magmaEdge({ position: new Vec3(-21.5, 34, 47.5), items: [{ name: 'gravel', count: 16 }] });
  assert.deepEqual(Object.keys(vitals.hotFloorWays(square, new Task('t'))), ['step_off_hot_floor', 'crouch_on_hot_floor', 'rise_on_block']);
});

test('standing still on the hot floor with the threat check throwing, the vitals step answers the floor first (mid-242-aa-nether-3, note 579)', async () => {
  // The rest before a fight and the meal stood on the magma from 20 to none; the hurt watchdog's "something unseen" stopped each and nothing looked at the floor.
  const vitals = require('../src/vitals');
  const { NeedsSafety } = require('../src/danger');
  const bot = magmaEdge();
  const task = new Task('work');
  task.interruptCheck = () => { throw new NeedsSafety({ entity: { name: 'something unseen' }, distance: 0 }); };
  const motion = require('../src/motion'), move = motion.move;
  motion.move = async (b, t, opts) => { t.check(); b.entity.position = new Vec3(opts.look.x, 34, opts.look.z); return true; };
  const acted = [];
  try { await assert.rejects(vitals.maintainVitals(bot, task, step => acted.push(step)), /Threat nearby/); }
  finally { motion.move = move; }
  assert.equal(acted[0]?.action, 'off_hot_floor', 'the floor answered first');
  assert.equal(vitals.onHotFloor(bot), null, 'off the magma');
});

test('the straight walk at a drop is not taken onto a hot floor (mid-242-aa-nether-3, note 579)', () => {
  // From the stand cell on the cobblestone toward the netherrack dug at (-24, 32, 46): the line crosses the magma.
  const { hotOnTheWay } = require('../src/drop-collection');
  const bot = magmaEdge({ position: new Vec3(-20.5, 34, 47.5) });
  const hot = hotOnTheWay(bot, new Vec3(-23.5, 32.2, 46.5));
  assert.equal(hot?.name, 'magma_block');
  // Along the cobblestone east, none.
  assert.equal(hotOnTheWay(bot, new Vec3(-18.5, 34, 47.5)), null);
});

// mid-242-ah-fortress-2 (25587), 11:50:21 to 11:50:31 (note 602): at y 44
// on the column of blocks it had risen on out of an earlier fire, a deadly
// drop on every side, a flame lit in its own cell by a blaze's fireball.
// No way out was found and no rise offered (no block left), so body_way was
// never asked and the old run found no steps twenty-one times a second
// while it burned from 8.5 to none, the flame a punch away.
function risenColumnInFire({ dig = true } = {}) {
  const feet = new Vec3(-197, 44, -152), dug = [];
  const lit = new Set([`${feet}`]);
  const name = p => lit.has(`${p}`) ? 'fire' : p.x === feet.x && p.z === feet.z && p.y < feet.y && p.y >= 30 ? 'netherrack' : p.y < 30 ? 'lava' : 'air';
  const bot = { health: 8.1, food: 20, oxygenLevel: 20, game: { dimension: 'the_nether' }, _inFireAt: Date.now(),
    entity: { position: new Vec3(-196.5, 44, -151.5), metadata: [1], onGround: true, eyeHeight: 1.62, yaw: 0, pitch: 0 },
    entities: {}, inventory: { items: () => [{ name: 'mutton', count: 9 }], slots: {} }, heldItem: null,
    blockAt: p => { const q = p.floored ? p.floored() : p; const n = name(q); return { name: n, position: q, boundingBox: n === 'netherrack' ? 'block' : 'empty' }; },
    setControlState() {}, getControlState() { return false; }, clearControlStates() {}, lookAt: async () => {}, look: async () => {} };
  if (dig) bot.dig = async b => { dug.push(`${b.position}`); lit.delete(`${b.position}`); };
  return { bot, dug };
}
test('in a flame on a risen column with nowhere to walk and no block to rise on, the way offered is to punch the flame out, and it is punched (mid-242-ah-fortress-2, note 602)', async () => {
  const vitals = require('../src/vitals');
  const { bot, dug } = risenColumnInFire();
  assert.equal(vitals.inFire(bot), true);
  assert.equal(vitals.fireRoute(bot), null, 'no cell to walk to');
  const ways = vitals.fireWays(bot, new Task('t'));
  assert.deepEqual(Object.keys(ways), ['put_out_flames']);
  assert.match(ways.put_out_flames.description, /^Punch out the flame the body stands in or beside \(1\), where it stands: a hit puts fire out at once/);
  assert.equal(await ways.put_out_flames.run(), true, 'out of the fire once the flame is punched');
  assert.deepEqual(dug, ['(-197, 44, -152)']);
  // With no other way out the punch stays on offer, punched a moment ago or not (note 886).
  assert.ok(bot._punchedFlames?.at);
  const again = risenColumnInFire(); again.bot._punchedFlames = { at: Date.now() - 2000 };
  assert.deepEqual(Object.keys(vitals.fireWays(again.bot, new Task('t'))), ['put_out_flames']);
});

test('punched a moment ago and in fire still, with a run out on offer: the punch rests (25588, note 886)', () => {
  const vitals = require('../src/vitals');
  // A floor of netherrack, the body's cell and the one east of it alight, clear ground beyond.
  const feet = new Vec3(158, 66, 175);
  const lit = new Set([`${feet}`, `${feet.offset(1, 0, 0)}`]);
  const make = () => ({ health: 12.9, food: 20, oxygenLevel: 20, game: { dimension: 'the_nether' }, _inFireAt: Date.now(),
    entity: { position: new Vec3(158.6, 66, 175.8), metadata: [1], onGround: true, eyeHeight: 1.62, yaw: 0, pitch: 0 },
    entities: {}, inventory: { items: () => [], slots: {} }, heldItem: null, dig: async () => {},
    blockAt: p => { const q = p.floored ? p.floored() : p; const n = lit.has(`${q}`) ? 'fire' : q.y < 66 ? 'netherrack' : 'air'; return { name: n, position: q, boundingBox: n === 'netherrack' ? 'block' : 'empty' }; },
    setControlState() {}, getControlState() { return false; }, clearControlStates() {}, lookAt: async () => {}, look: async () => {} });
  const fresh = vitals.fireWays(make(), new Task('t'));
  assert.ok(fresh.put_out_flames && fresh.out_of_fire, Object.keys(fresh).join(','));
  const bot = make(); bot._punchedFlames = { at: Date.now() - 3000 };
  const after = vitals.fireWays(bot, new Task('t'));
  assert.ok(after.out_of_fire && !after.put_out_flames, Object.keys(after).join(','));
  bot._punchedFlames = { at: Date.now() - 9000 };
  assert.ok(vitals.fireWays(bot, new Task('t')).put_out_flames, 'offered again after eight seconds');
});

test('the step aside from under gravel walks on until the head is clear of the block, not to the edge of the cell beside (note 680)', async () => {
  // mid-242-hb (25595): stopped as its feet crossed into the cell beside, its head still in the gravel, hurt four times more.
  const motion = require('../src/motion');
  const { headWays } = require('../src/vitals');
  const bot = { entity: { position: new Vec3(3.9, 48, 53.5), width: 0.6, eyeHeight: 1.62 }, _recentHurtAt: Date.now(),
    blockAt: p => { const q = p.floored(); const name = q.x === 3 && q.y === 49 ? 'gravel' : q.y < 48 ? 'stone' : 'air'; return { name, position: q, boundingBox: name === 'air' ? 'empty' : 'block' }; } };
  const original = motion.move;
  let stoppedAt = null;
  motion.move = async (b, task, { until }) => {
    for (let x = 3.9; x < 5; x += 0.05) { b.entity.position = new Vec3(x, 48, 53.5); if (until()) { stoppedAt = x; return; } }
  };
  try {
    const ways = headWays(bot, new Task('head'));
    assert(ways.step_aside, 'the open cell east is offered');
    assert.equal(await ways.step_aside.run(), true);
    assert(stoppedAt >= 4.24, `walked until the head's box left x 3: stopped at ${stoppedAt}`);
  } finally { motion.move = original; }
});
