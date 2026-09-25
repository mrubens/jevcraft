'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { poolSurface, pourSpots, safeCrust, pour, makeObsidian } = require('../src/obsidian');
const { planCatalog } = require('../src/knowledge');
const { Task } = require('../src/skills');

// A 3x3 lava pool one deep at y=10 on a stone floor, ringed by stone shore
// at pool level, open to the air above. The bot stands two blocks east.
function world({ pool = [], ring = true } = {}) {
  const blocks = new Map();
  const set = (x, y, z, name, extra = {}) => blocks.set(`${x},${y},${z}`, { name, position: new Vec3(x, y, z),
    boundingBox: ['air', 'lava', 'water'].includes(name) ? 'empty' : 'block', ...extra });
  for (let x = -3; x <= 5; x++) for (let z = -3; z <= 5; z++) set(x, 9, z, 'stone');
  for (let x = -3; x <= 5; x++) for (let z = -3; z <= 5; z++) set(x, 10, z, ring ? 'stone' : 'air');
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) set(x, 10, z, 'lava', { getProperties: () => ({ level: 0 }) });
  for (const [x, z, name] of pool) set(x, 10, z, name, name === 'lava' ? { getProperties: () => ({ level: 0 }) } : {});
  const items = [{ name: 'water_bucket', count: 1 }, { name: 'diamond_pickaxe', count: 1 }];
  const bot = {
    registry, game: { gameMode: 'survival', difficulty: 'normal' }, entities: {},
    entity: { position: new Vec3(4.5, 11, 1.5) },
    inventory: { items: () => items },
    blockAt: p => blocks.get(`${p.x},${p.y},${p.z}`) || { name: 'air', position: p.clone(), boundingBox: 'empty' },
    findBlocks: ({ matching, maxDistance, count, point = bot.entity.position, useExtraInfo = () => true }) => [...blocks.values()]
      .filter(b => registry.blocksByName[b.name]?.id === matching && b.position.distanceTo(point) <= maxDistance && useExtraInfo(b))
      .sort((a, b) => a.position.distanceTo(point) - b.position.distanceTo(point)).slice(0, count).map(b => b.position.clone()),
    pathfinder: { movements: {}, getPathTo: async () => ({ status: 'success', path: [] }) },
  };
  return { bot, blocks, set, items };
}

test('the pouring spot is a dry shore block beside the pool, ranked by the sources the flow reaches', () => {
  const { bot } = world();
  const surface = poolSurface(bot);
  assert.equal(surface.length, 9);
  const spots = pourSpots(bot, surface);
  assert(spots.length >= 4);
  assert.equal(spots[0].reach, 9, 'every source of a small pool is within the flow');
  assert.equal(spots[0].feet.y, 11);
  assert(spots.every(s => bot.blockAt(s.shore).name === 'stone' && bot.blockAt(s.feet).name === 'air'));
  assert.equal(bot.blockAt(spots[0].shore.offset(0, 0, 0)).name, 'stone');
});

test('a shore with lava at the feet or no floor is not a pouring spot', () => {
  const { bot } = world({ ring: false });
  assert.equal(pourSpots(bot, poolSurface(bot)).length, 0);
});

test('only crust with nothing molten beside or beneath it is safe to open', () => {
  const { bot, set } = world();
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) set(x, 10, z, 'obsidian');
  set(2, 10, 2, 'lava', { getProperties: () => ({ level: 0 }) });
  const safe = safeCrust(bot, new Vec3(1, 11, 1)).map(p => `${p.x},${p.z}`);
  assert.equal(safe.length, 6);
  assert(!safe.includes('1,2') && !safe.includes('2,1'), 'neighbours of the remaining source stay shut');
  assert(safe.includes('0,0') && safe.includes('1,1'));
});

test('pouring aims at the shore block underfoot and confirms the bucket emptied', async () => {
  const { bot, items } = world();
  const spot = pourSpots(bot, poolSurface(bot))[0];
  const looked = [], equipped = [];
  let activated = false;
  bot.entity.position = spot.feet.offset(0.5, 0, 0.5);
  bot.equip = async item => { equipped.push(item.name); };
  bot.lookAt = async p => { looked.push(p); };
  bot.activateItem = () => { activated = true; items.splice(0, 1, { name: 'bucket', count: 1 }); };
  bot.deactivateItem = () => {};
  await pour(bot, new Task('pour'), spot, { navigate: async () => { throw new Error('already there'); } });
  assert(activated); assert.deepEqual(equipped, ['water_bucket']);
  assert.deepEqual(looked[0], spot.shore.offset(0.5, 0.5, 0.5));
});

test('with no crust and a reachable shore, the step pours and takes the water back', async () => {
  const { bot, items, set } = world();
  const spot = pourSpots(bot, poolSurface(bot))[0];
  const calls = [];
  bot.equip = async () => {}; bot.deactivateItem = () => {};
  bot.lookAt = async () => {};
  bot.activateItem = () => {
    if (items[0].name === 'water_bucket') {
      items.splice(0, 1, { name: 'bucket', count: 1 });
      for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) set(x, 10, z, 'obsidian');
      set(spot.feet.x, spot.feet.y, spot.feet.z, 'water', { getProperties: () => ({ level: 0 }) });
    } else { items.splice(0, 1, { name: 'water_bucket', count: 1 }); }
  };
  bot.world = { raycast: () => null };
  const goal = {};
  const actions = {
    navigate: async (b, t, destination) => { calls.push('navigate'); bot.entity.position = new Vec3(destination.x + 0.5, destination.y, destination.z + 0.5); },
    dig: async () => { calls.push('dig'); }, approachDryMining: async () => {}, collectNearbyDrops: async () => {},
    resourceTunnelStep: async () => { calls.push('tunnel'); }, acquireStep: async () => { calls.push('acquire'); },
  };
  await makeObsidian(bot, new Task('obsidian'), { action: 'make_obsidian', item: 'obsidian', count: 4 }, goal, () => {}, actions);
  assert.equal(goal.obsidianWorks.pours, 1);
  assert.deepEqual(goal.obsidianWorks.lastPour, { ...spot.feet });
  assert.equal(items[0].name, 'water_bucket', 'the source was scooped back');
  assert(!calls.includes('tunnel'));
  assert.equal(goal.step.phase, 'pour');
});

test('the plan makes obsidian from lava with a diamond pickaxe and a water bucket rather than searching for a deposit', () => {
  const plan = planCatalog(registry, 'obsidian', 10, { stone_pickaxe: 1, oak_log: 8, crafting_table: 1 });
  assert(plan.some(s => s.item === 'diamond_pickaxe'));
  assert(plan.some(s => s.action === 'fill_bucket'));
  const last = plan.at(-1);
  assert.equal(last.action, 'make_obsidian'); assert.equal(last.count, 10);
  assert.deepEqual(last.requires, { diamond_pickaxe: 1, water_bucket: 1 });
  const observed = planCatalog(registry, 'obsidian', 2, { diamond_pickaxe: 1, water_bucket: 1 }, { nearby: ['obsidian'] });
  assert.equal(observed.at(-1).action, 'make_obsidian', 'an observed deposit goes through the same step, which mines only crust with no lava against it');
});

test('a crust whose dig is refused is set aside, not tried again next round', async () => {
  // mid-83-c: "Refusing to open a drop beside the feet" thrown out of the step, the same crust every round, a loop at minute 67.
  const { bot } = world({ pool: [0, 1, 2].flatMap(x => [0, 1, 2].map(z => [x, z, 'obsidian'])) });
  bot.world = { raycast: () => null };
  const dug = [];
  const actions = {
    navigate: async () => {}, approachDryMining: async () => {}, collectNearbyDrops: async () => {}, resourceTunnelStep: async () => {}, acquireStep: async () => {},
    dig: async (b, t, p) => { dug.push(`${p}`); throw new Error('Refusing to open a drop beside the feet'); },
  };
  const goal = {};
  const step = { action: 'make_obsidian', item: 'obsidian', count: 4 };
  await makeObsidian(bot, new Task('obsidian'), step, goal, () => {}, actions).catch(() => {});
  const first = dug.length;
  assert(first >= 1, 'a crust was tried');
  const again = dug.slice();
  dug.length = 0;
  await makeObsidian(bot, new Task('obsidian'), step, goal, () => {}, actions).catch(() => {});
  assert(!dug.some(p => again.includes(p)), `the refused crust is not tried again: ${dug.join(' ')}`);
});
