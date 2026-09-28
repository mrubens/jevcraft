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

test('at a ruined portal the frame is mined; with none left the portal is marked empty', async () => {
  // mid-79-d: at a ruined portal, "making obsidian" 673 times in two minutes, the frame never mined.
  const obsidianId = registry.blocksByName.obsidian.id;
  const frame = [new Vec3(3, 65, 0), new Vec3(3, 66, 0)];
  const items = [{ name: 'water_bucket', count: 1 }, { name: 'diamond_pickaxe', count: 1 }];
  const bot = { registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {}, entity: { position: new Vec3(0.5, 64, 0.5) },
    inventory: { items: () => items }, world: { raycast: () => null },
    blockAt: p => ({ name: frame.some(f => f.equals(p)) ? 'obsidian' : p.y < 64 ? 'stone' : 'air', position: p, boundingBox: frame.some(f => f.equals(p)) || p.y < 64 ? 'block' : 'empty' }),
    findBlocks: ({ matching }) => matching === obsidianId ? frame.slice() : [],
    pathfinder: { movements: {}, getPathTo: async () => ({ status: 'success', path: [] }) } };
  const goal = { landmarks: [{ kind: 'ruined_portal', x: 2, y: 64, z: 0, dimension: 'overworld', obsidian: 6 }] };
  const dug = [];
  const actions = { navigate: async () => {}, approachDryMining: async () => {}, collectNearbyDrops: async () => {}, resourceTunnelStep: async () => {}, acquireStep: async () => {},
    dig: async (b, t, p) => { dug.push(`${p}`); frame.splice(frame.findIndex(f => f.equals(p)), 1); items.push({ name: 'obsidian', count: 1 }); } };
  await makeObsidian(bot, new Task('obsidian'), { action: 'make_obsidian', item: 'obsidian', count: 4 }, goal, () => {}, actions);
  assert.equal(dug.length, 2, 'the frame mined');
  await makeObsidian(bot, new Task('obsidian'), { action: 'make_obsidian', item: 'obsidian', count: 4 }, goal, () => {}, actions);
  assert.equal(goal.landmarks[0].obsidian, 0, 'none left: the portal is marked empty');
});

test('at a lava pool with no lava to pour on, the pool is marked spent and not gone to again', async () => {
  // mid-110-o: "made obsidian" twenty-one times a second at a lava pool with no lava surface in reach.
  const items = [{ name: 'water_bucket', count: 1 }, { name: 'diamond_pickaxe', count: 1 }];
  const bot = { registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {}, entity: { position: new Vec3(0.5, 64, 0.5) },
    inventory: { items: () => items }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }),
    findBlocks: () => [], pathfinder: { movements: {}, getPathTo: async () => ({ status: 'success', path: [] }) } };
  const goal = { landmarks: [{ kind: 'lava_pool', x: 2, y: 64, z: 0, dimension: 'overworld' }] };
  let tunnels = 0;
  const actions = { navigate: async () => {}, approachDryMining: async () => {}, collectNearbyDrops: async () => {}, resourceTunnelStep: async () => { tunnels++; }, acquireStep: async () => {}, dig: async () => {} };
  const step = { action: 'make_obsidian', item: 'obsidian', count: 4 };
  await makeObsidian(bot, new Task('obsidian'), step, goal, () => {}, actions);
  assert(goal.landmarks[0].spent, 'the pool is marked spent');
  await makeObsidian(bot, new Task('obsidian'), step, goal, () => {}, actions);
  assert.equal(tunnels, 1, 'the next pass goes looking for lava instead');
});

test('lava in buckets: planned from empty buckets, scooped from the dry shore a block above the pool', async () => {
  // A frame cast in place is a lava bucket a block (portal-cast.js).
  const plan = planCatalog(registry, 'lava_bucket', 2, { bucket: 2 });
  assert.deepEqual(plan.map(s => `${s.action}:${s.item}:${s.count}`), ['fill_bucket:lava_bucket:2']);
  assert(planCatalog(registry, 'lava_bucket', 1, { iron_ingot: 3, crafting_table: 1 }).some(s => s.action === 'craft' && s.item === 'bucket'), 'a bucket is made from three iron');
  const { collectLava } = require('../src/obsidian');
  const { bot, items, blocks } = world();
  items.splice(0, items.length, { name: 'bucket', count: 2 });
  const scooped = [];
  let look;
  bot.equip = async () => {}; bot.deactivateItem = () => {};
  bot.lookAt = async p => { look = p; };
  bot.world = { raycast: () => null };
  bot.activateItem = () => {
    const c = look.floored();
    scooped.push(c);
    blocks.delete(`${c.x},${c.y},${c.z}`);
    items[0].count--;
    const full = items.find(i => i.name === 'lava_bucket');
    if (full) full.count++; else items.push({ name: 'lava_bucket', count: 1 });
  };
  let stood;
  const actions = { navigate: async (b, t, g) => { stood = new Vec3(g.x, g.y, g.z); bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); },
    dig: async () => {}, resourceTunnelStep: async () => { throw new Error('no tunnel with a pool in reach'); } };
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 2 }, {}, () => {}, actions);
  assert.equal(items.find(i => i.name === 'lava_bucket').count, 2);
  assert.equal(scooped.length, 2);
  // Where it stood, walked to or already there: the pool is in reach from two blocks off (note 546).
  stood ||= bot.entity.position.floored();
  assert.equal(stood.y, 11, 'a block above the pool');
  assert.equal(bot.blockAt(stood.offset(0, -1, 0)).name, 'stone', 'on dry ground');
  assert(scooped.every(c => c.y === 10 && !(c.x === stood.x && c.z === stood.z)), 'from the pool, never where it stands');
});

test('lava in buckets with every slot full: room is made before each fill, and no lava bucket is lost', async () => {
  // mid-244-v (note 470): nine buckets filled with all thirty-six slots full, one lava bucket kept, eight dropped by the game.
  const { collectLava } = require('../src/obsidian');
  const { bot, items, blocks } = world();
  items.splice(0, items.length, { name: 'bucket', count: 9, stackSize: 16 }, ...Array.from({ length: 35 }, () => ({ name: 'dirt', count: 64, stackSize: 64 })));
  bot.inventory.emptySlotCount = () => 36 - items.filter(i => i.count > 0).length;
  bot.tossStack = async stack => { items.splice(items.indexOf(stack), 1); };
  let look, lost = 0;
  const scooped = [];
  bot.equip = async () => {}; bot.deactivateItem = () => {};
  bot.lookAt = async p => { look = p; };
  bot.world = { raycast: () => null };
  // As the game does: the last empty bucket of a stack fills in its slot; from a bigger stack the lava bucket (which does
  // not stack) goes to a free slot, or is dropped at the feet when there is none.
  bot.activateItem = () => {
    const c = look.floored(), stack = items.find(i => i.name === 'bucket');
    scooped.push(c);
    blocks.delete(`${c.x},${c.y},${c.z}`);
    if (stack.count === 1) { Object.assign(stack, { name: 'lava_bucket', stackSize: 1 }); return; }
    stack.count--;
    if (bot.inventory.emptySlotCount() > 0) items.push({ name: 'lava_bucket', count: 1, stackSize: 1 }); else lost++;
  };
  const actions = { navigate: async (b, t, g) => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); },
    dig: async () => {}, resourceTunnelStep: async () => { throw new Error('no tunnel with a pool in reach'); } };
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 9 }, {}, () => {}, actions);
  assert(scooped.length > 1, 'more than one filled');
  assert.equal(lost, 0, 'no lava bucket dropped');
  assert.equal(items.filter(i => i.name === 'lava_bucket').length, scooped.length, 'every bucket filled is carried');
  assert.equal(items.filter(i => i.name === 'lava_bucket' || i.name === 'bucket').reduce((n, i) => n + i.count, 0), 9, 'all nine buckets still carried');
});

test('lava whose staircase is resting is not dug toward again: the deep lava on another heading is', async () => {
  // mid-215-f dug toward a pool two blocks below it whose staircase was resting, was refused at once every pass, and the loop ended the trial (2026-09-27).
  const { collectLava } = require('../src/obsidian');
  const { setAside } = require('../src/progress');
  const { bot, items } = world();
  items.splice(0, items.length, { name: 'bucket', count: 2 });
  bot.world = { raycast: () => null };
  const goal = {};
  // Every cell of the pool and the shore round it rests, as the staircase's eight-block areas do.
  for (let x = -16; x <= 16; x += 8) for (let z = -16; z <= 16; z += 8) for (const y of [8, 16]) setAside(goal, 'staircase', { x, y, z }, 'three rounds without getting closer', 600000);
  const dug = [];
  const actions = { navigate: async () => {}, dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } };
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 2 }, goal, () => {}, actions);
  assert.equal(dug.length, 1);
  assert(Math.abs(dug[0].x - bot.entity.position.x) >= 20 || Math.abs(dug[0].z - bot.entity.position.z) >= 20, `not the resting pool: ${dug[0]}`);
});

test('making obsidian, lava whose staircase is resting is not dug toward again either', async () => {
  // mid-230-i dug for the same lava thirteen passes running, each refused at once, until the loop watch ended the trial.
  const { makeObsidian } = require('../src/obsidian');
  const { setAside } = require('../src/progress');
  const { bot, items } = world();
  items.splice(0, items.length, { name: 'water_bucket', count: 1 }, { name: 'diamond_pickaxe', count: 1 });
  bot.world = { raycast: () => null };
  // No route to any shore to pour from: the step digs toward the lava.
  bot.pathfinder = { ...(bot.pathfinder || {}), movements: {}, getPathTo: () => ({ status: 'noPath', path: [] }) };
  const goal = {};
  for (let x = -16; x <= 16; x += 8) for (let z = -16; z <= 16; z += 8) for (const y of [8, 16]) setAside(goal, 'staircase', { x, y, z }, 'refusing to open a drop beside the feet', 600000);
  const dug = [];
  const actions = { navigate: async () => { throw new Error('no route'); }, dig: async () => {}, surveyRoute: async () => ({ status: 'noPath' }), resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } };
  await makeObsidian(bot, new Task('obsidian'), { action: 'make_obsidian', item: 'obsidian', count: 4 }, goal, () => {}, actions).catch(e => { goal.err = e.message; });
  assert.equal(dug.length, 1, `dug toward: ${goal.err || ''}`);
  assert(dug.every(d => Math.abs(d.x - bot.entity.position.x) >= 20 || Math.abs(d.z - bot.entity.position.z) >= 20), `not the resting pool: ${dug.map(String)}`);
});

test('with the four straight headings to the deep lava resting, a diagonal or farther one is dug toward', async () => {
  // mid-207-h: "every way to lava from here is resting" three passes running, four headings only.
  const { collectLava } = require('../src/obsidian');
  const { setAside } = require('../src/progress');
  const { bot, items } = world();
  items.splice(0, items.length, { name: 'bucket', count: 2 });
  bot.world = { raycast: () => null };
  const goal = {};
  const { LAVA_DEPTH } = require('../src/obsidian');
  const area = t => ({ x: Math.floor(t.x / 8) * 8, y: Math.floor(t.y / 8) * 8, z: Math.floor(t.z / 8) * 8 });
  // The pool here, and the four straight headings twenty-four off, all resting.
  for (let x = -16; x <= 16; x += 8) for (let z = -16; z <= 16; z += 8) for (const y of [8, 16]) setAside(goal, 'staircase', { x, y, z }, 'resting', 600000);
  const feet = bot.entity.position.floored();
  for (const [dx, dz] of [[24, 0], [0, 24], [-24, 0], [0, -24]]) setAside(goal, 'staircase', area(feet.offset(dx, LAVA_DEPTH - feet.y, dz)), 'refusing to open a drop beside the feet', 600000);
  const dug = [];
  const actions = { navigate: async () => {}, dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } };
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 2 }, goal, () => {}, actions);
  assert.equal(dug.length, 1, 'a way found');
  assert(Math.abs(dug[0].x - feet.x) >= 10 && Math.abs(dug[0].z - feet.z) >= 10, `a diagonal heading: ${dug[0]}`);
});

// mid-229-m: five blocks from its only pool, (342, 47, 33), every staircase
// into it resting in the areas at y 48 (the block above the lava), the pool
// passed as open by its own block's area at y 40; the step arrived, did
// nothing and returned, twenty-five times a second (2026-09-27).
function restingPool() {
  const lava = (x, z) => x >= 341 && x <= 343 && z >= 32 && z <= 34;
  const blockAt = p => {
    const name = p.y < 47 ? 'stone' : p.y === 47 ? (lava(p.x, p.z) ? 'lava' : 'stone') : 'air';
    return { name, position: p.clone(), boundingBox: name === 'stone' ? 'block' : 'empty', ...(name === 'lava' ? { getProperties: () => ({ level: 0 }) } : {}) };
  };
  const pool = [];
  for (let x = 341; x <= 343; x++) for (let z = 32; z <= 34; z++) pool.push(new Vec3(x, 47, z));
  const bot = {
    registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {},
    entity: { position: new Vec3(347.5, 48, 33.5) }, inventory: { items: () => [{ name: 'bucket', count: 2 }] }, world: { raycast: () => null }, blockAt,
    findBlocks: ({ matching, maxDistance, count, point = bot.entity.position, useExtraInfo = () => true }) => matching !== registry.blocksByName.lava.id ? []
      : pool.filter(p => p.distanceTo(point) <= maxDistance && useExtraInfo(blockAt(p))).slice(0, count).map(p => p.clone()),
    // No route to any shore: the scooping spots are not reached.
    pathfinder: { movements: {}, getPathTo: async () => ({ status: 'noPath', path: [] }) },
  };
  const { setAside } = require('../src/progress');
  const goal = { landmarks: [{ kind: 'lava_pool', x: 342, y: 47, z: 33, dimension: 'overworld' }] };
  for (const x of [336, 344, 352]) for (const z of [24, 32]) setAside(goal, 'staircase', { x, y: 48, z }, 'backed off to a landing with no step toward it there either', 600000);
  const dug = [], walked = [];
  const actions = { navigate: async (b, t, g) => { walked.push(g); }, dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } };
  return { bot, goal, dug, walked, actions };
}

test('at the only pool, every way into it resting, the lava step digs toward the deep lava rather than arriving and doing nothing', async () => {
  const { collectLava, LAVA_DEPTH } = require('../src/obsidian');
  const { bot, goal, dug, walked, actions } = restingPool();
  const done = await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 2 }, goal, () => {}, actions);
  assert(dug.length || walked.length || done !== undefined, 'the step acted in the world');
  assert.equal(dug.length, 1);
  assert.equal(dug[0].y, LAVA_DEPTH, `the deep lava, not the resting pool: ${dug[0]}`);
});

test('at the only pool, with every way to lava resting, the lava step says so as a named fact', async () => {
  const { collectLava, LAVA_DEPTH } = require('../src/obsidian');
  const { descentTargets } = require('../src/tunneling');
  const { setAside } = require('../src/progress');
  const { bot, goal, dug, walked, actions } = restingPool();
  const area = t => ({ x: Math.floor(t.x / 8) * 8, y: Math.floor(t.y / 8) * 8, z: Math.floor(t.z / 8) * 8 });
  for (const t of descentTargets(bot.entity.position.floored(), LAVA_DEPTH)) setAside(goal, 'staircase', area(t), 'refusing to open a drop beside the feet', 900000);
  await assert.rejects(collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 2 }, goal, () => {}, actions),
    err => err.name === 'WaysResting' && /pool at \(342, 47, 33\) is the only lava known; every way into it rests for 10 more minutes/.test(err.message) &&
      /deep lava .* rests for 15 more minutes/.test(err.message) && err.until > Date.now());
  assert.equal(dug.length + walked.length, 0);
  assert.equal(goal.step.phase, 'no_lava_way');
});

test('lava for a cast frame is fetched by the carry to the frame: the pool beside the frame, not the one nearest the bot', async () => {
  // mid-230-u (note 524): back from a food trip 130 blocks from its frame, a pool twenty blocks beside the frame, the
  // bot went for pools 350 and 460 blocks off and then dug to the deep lava below it: forty minutes for one bucket.
  const { collectLava, LAVA_DEPTH } = require('../src/obsidian');
  const bot = {
    registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {},
    entity: { position: new Vec3(130.5, 79, 35.5) }, inventory: { items: () => [{ name: 'bucket', count: 1 }] }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 79 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < 79 ? 'block' : 'empty' }),
    findBlocks: () => [], pathfinder: { movements: {}, getPathTo: async () => ({ status: 'noPath', path: [] }) },
  };
  const beside = { kind: 'lava_pool', x: 10, y: 84, z: -20, dimension: 'overworld' };
  const nearBot = { kind: 'lava_pool', x: 150, y: 20, z: 40, dimension: 'overworld' };
  const frame = { origin: { x: 0, y: 78, z: 0 }, cast: true, axis: 'x', blocks: [] };
  const walked = [], dug = [];
  const actions = { navigate: async (b, t, g) => { walked.push(g); }, dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } };
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, { portalFrame: frame, landmarks: [nearBot, beside] }, () => {}, actions);
  assert.equal(dug.length, 0, `not dug toward: ${dug.map(String)}`);
  assert.equal(walked.length, 1);
  assert.deepEqual([walked[0].x, walked[0].z], [beside.x, beside.z], 'the pool beside the frame');
  // Not casting: the nearest pool, as before.
  walked.length = 0;
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, { landmarks: [{ ...nearBot }, { ...beside }] }, () => {}, actions);
  assert.deepEqual([walked[0].x, walked[0].z], [nearBot.x, nearBot.z]);
  // Only lava known that is a longer carry than the deep lava below: the deep lava it is.
  walked.length = 0;
  const deeper = { kind: 'lava_pool', x: 150, y: -50, z: 300, dimension: 'overworld' };
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, { portalFrame: frame, landmarks: [deeper] }, () => {}, actions);
  assert.equal(walked.length, 0);
  assert.equal(dug.length, 1);
  assert.equal(dug[0].y, LAVA_DEPTH);
});

// A bot at world()'s pool whose empty buckets take the source looked at.
function scooper(world0) {
  const { bot, items, blocks } = world0;
  items.splice(0, items.length, { name: 'bucket', count: 1 });
  const scooped = [];
  let look;
  bot.equip = async () => {}; bot.deactivateItem = () => {};
  bot.lookAt = async p => { look = p; };
  bot.world = { raycast: () => null };
  bot.activateItem = () => {
    const c = look.floored();
    scooped.push(c);
    blocks.delete(`${c.x},${c.y},${c.z}`);
    items[0].count--;
    items.push({ name: 'lava_bucket', count: 1 });
  };
  return scooped;
}

test('lava is scooped from where a source is in reach, not only from the shore beside one: the edge taken, the middle is scooped across it', async () => {
  // mid-242-aa (note 546): ten trips into its pool left flowing lava all round the edge; with no source beside any
  // shore the fetch dug round the rim toward the air over the sources two blocks in, four minutes, turning with its retreat.
  const { collectLava, scoopSpots } = require('../src/obsidian');
  const w = world();
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) if (x !== 1 || z !== 1) w.set(x, 10, z, 'lava', { getProperties: () => ({ level: 2 }) });
  const surface = poolSurface(w.bot);
  assert.equal(surface.length, 1, 'only the middle is a source');
  assert.equal(pourSpots(w.bot, surface).length, 0, 'no shore beside it');
  const spots = scoopSpots(w.bot, surface);
  assert(spots.length, 'somewhere to scoop it from');
  assert(spots.every(s => s.feet.y >= 11 && w.bot.blockAt(s.shore).name === 'stone'), 'a block above the pool, on dry ground');
  const scooped = scooper(w);
  const dug = [];
  const actions = { navigate: async (b, t, g) => { w.bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); },
    dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } };
  await collectLava(w.bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, {}, () => {}, actions);
  assert.equal(dug.length, 0, `not dug toward: ${dug.map(String)}`);
  assert.deepEqual(scooped.map(String), ['(1, 10, 1)']);
});

test('a scooping spot whose route search ran out of time is walked to, not dug toward; a walk that comes no nearer rests and the staircase is the way', async () => {
  // mid-242-aa (note 546): from its frame forty blocks off and eighteen below, every half-second search ran out, and each
  // of ten trips dug a staircase up to the pool, about four minutes a trip; the walk there took thirty-three seconds.
  const { collectLava } = require('../src/obsidian');
  const w = world();
  w.bot.entity.position = new Vec3(30.5, 11, 1.5);
  w.bot.pathfinder = { movements: {}, getPathTo: async () => ({ status: 'timeout', path: [] }) };
  scooper(w);
  const walked = [], dug = [];
  const goal = {};
  let moves = true;
  const actions = { navigate: async (b, t, g) => { walked.push(new Vec3(g.x, g.y, g.z)); if (moves) w.bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); },
    dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } };
  await collectLava(w.bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, goal, () => {}, actions);
  assert.equal(dug.length, 0, `not dug toward: ${dug.map(String)}`);
  assert.equal(walked.length, 1);
  assert.equal(goal.step.phase, 'to_lava');
  assert.equal(walked[0].y, 11, 'to a spot above the pool');
  // A walk that goes nowhere: set aside, and the next pass digs.
  moves = false;
  w.bot.entity.position = new Vec3(30.5, 11, 1.5);
  walked.length = 0;
  await collectLava(w.bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, goal, () => {}, actions);
  assert.equal(walked.length, 1);
  await collectLava(w.bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, goal, () => {}, actions);
  assert.equal(walked.length, 1, 'not walked at again');
  assert.equal(dug.length, 1, 'the staircase instead');
});
