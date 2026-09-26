'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { reachShore } = require('../src/shore');
const { Task } = require('../src/skills');

function fixture() {
  const registry = require('prismarine-registry')('26.1'), Block = require('prismarine-block')(registry), blocks = new Map();
  const landing = new Vec3(18, 63, 0);
  const bot = { registry, game: { minY: 0, height: 100 }, entities: {}, oxygenLevel: 20,
    entity: { position: new Vec3(.5, 61.9, .5), onGround: false },
    blockAt(point) {
      const p = point.floored(), name = blocks.get(`${p}`) || (p.y < 59 || p.x >= 18 && p.y <= 62 ? 'stone' : p.y <= 62 ? 'water' : 'air');
      if (name === 'unknown') return null;
      const b = Block.fromStateId(registry.blocksByName[name].defaultState); b.position = p; return b;
    },
    findBlocks({ useExtraInfo }) { const b = bot.blockAt(landing.offset(0, -1, 0)); return useExtraInfo(b) ? [b.position] : []; },
    pathfinder: { movements: { canDig: true, allowParkour: true, allow1by1towers: true, scafoldingBlocks: [1] },
      getPathTo: () => ({ status: 'success', path: [{ ...landing, toPlace: [], toBreak: [] }] }), setGoal() {} }, clearControlStates() {},
  };
  const surface = async (b, task, y) => { assert.equal(y, 62); b.entity.position.y = 62.2; };
  const move = async () => { bot.entity.position = landing.offset(.5, 0, .5); bot.entity.onGround = true; };
  return { bot, landing, blocks, task: new Task('shore'), goal: { request: 'get wood', item: 'oak_log' }, surface, move };
}

test('shore recovery rejects unknown, hazardous, covered or forbidden land and construction routes', async () => {
  for (const kind of ['unknown', 'hazard', 'roof', 'restricted', 'excavation', 'placement', 'stale']) {
    const f = fixture(), { bot, blocks, landing } = f;
    if (kind === 'unknown') blocks.set(`${landing}`, 'unknown');
    if (kind === 'hazard') blocks.set(`${landing.offset(0, -1, 0)}`, 'campfire');
    if (kind === 'roof') blocks.set(`${landing.offset(0, 5, 0)}`, 'stone');
    if (kind === 'restricted') bot.pathfinder.movements.allowedPosition = p => p.x < 18;
    bot.pathfinder.getPathTo = () => {
      if (kind === 'stale') blocks.set(`${landing}`, 'water');
      return { status: 'success', path: [{ ...landing, toBreak: kind === 'excavation' ? [landing] : [], toPlace: kind === 'placement' ? [landing] : [] }] };
    };
    const previous = { ...bot.pathfinder.movements };
    await assert.rejects(reachShore(bot, f.task, f.goal, () => {}, { surface: f.surface, move: () => assert.fail(kind) }), /No reachable dry shore/, kind);
    for (const [key, value] of Object.entries(previous)) assert.equal(bot.pathfinder.movements[key], value, key);
  }
});

test('shore recovery verifies arrival, retains failures and restores movement on cancellation', async () => {
  for (const kind of ['arrived', 'not_arrived', 'airborne', 'cancelled']) {
    const f = fixture(), { bot, task, goal } = f, previous = { ...bot.pathfinder.movements };
    const run = reachShore(bot, task, goal, () => {}, { surface: f.surface, move: async () => {
      if (kind === 'cancelled') { task.cancel(); task.check(); }
      if (kind !== 'not_arrived') await f.move();
      if (kind === 'airborne') bot.entity.onGround = false;
    } });
    if (kind === 'arrived') { assert(await run); assert(goal.shoreRecovery.landed); }
    else await assert.rejects(run, kind === 'cancelled' ? { name: 'Cancelled' } : /No reachable dry shore/);
    assert.equal(goal.item, 'oak_log');
    if (kind === 'not_arrived' || kind === 'airborne') assert.equal(Object.keys(goal.shoreRecovery.failures).length, 1);
    for (const [key, value] of Object.entries(previous)) assert.equal(bot.pathfinder.movements[key], value, key);
  }
});

test('under a roof, with no landing counted as surface, the bot climbs out onto the nearest dry cell', async () => {
  const { Vec3 } = require('vec3');
  const { reachShore } = require('../src/shore');
  const { Task } = require('../src/skills');
  const water = new Set(['0,62,0', '1,62,0']);
  const blockAt = p => water.has(`${p.x},${p.y},${p.z}`) ? { name: 'water', type: 1, boundingBox: 'empty', position: p, getProperties: () => ({ level: 0 }) }
    : p.y === 66 ? { name: 'oak_planks', boundingBox: 'block', position: p } : p.y < 62 || (p.y === 62 && !water.has(`${p.x},${p.y},${p.z}`) && Math.abs(p.x) > 2) ? { name: 'dirt', boundingBox: 'block', position: p } : { name: 'air', boundingBox: 'empty', position: p };
  const bot = { registry: require('minecraft-data')('26.1'), game: { dimension: 'overworld', minY: -64, height: 384 }, entity: { position: new Vec3(0.5, 62.2, 0.5), onGround: false, isInWater: true },
    blockAt, findBlocks: () => [], controlState: {}, entities: {}, oxygenLevel: 20, lookAt: async () => {}, clearControlStates() {},
    setControlState(k, v) { this.controlState[k] = v; if (k === 'forward' && v) { this.entity.position = new Vec3(-1.5, 62, 0.5); this.entity.isInWater = false; this.entity.onGround = true; } },
    pathfinder: { movements: { allowedPosition: () => true }, setGoal() {} } };
  const goal = {};
  const landed = await reachShore(bot, new Task('shore'), goal, () => {}, { surface: async () => {} });
  assert.equal(landed, true);
  assert.equal(goal.step.climb, true);
});

// A one-wide pool at (0, 62, 0), water beside it at (1, 62, 0), banks two
// above the water everywhere else.
function pool({ items = [], waterBeside = true } = {}) {
  const { Vec3 } = require('vec3');
  const placed = new Map(), dug = new Set();
  const name = p => {
    const k = `${p.x},${p.y},${p.z}`;
    if (placed.has(k)) return placed.get(k);
    if (dug.has(k)) return 'air';
    if (p.y >= 64) return 'air';
    if (p.x === 0 && p.z === 0 && p.y >= 59) return p.y <= 62 ? 'water' : 'air';
    if (waterBeside && p.x === 1 && p.z === 0 && p.y >= 60) return p.y <= 62 ? 'water' : 'air';
    return 'dirt';
  };
  const bot = { entity: { position: new Vec3(0.5, 62.2, 0.5), onGround: false, isInWater: true }, inventory: { items: () => items },
    blockAt: p => { const f = p.floored(); const n = name(f); return { position: f, name: n, boundingBox: /air|water/.test(n) ? 'empty' : 'block', diggable: true }; },
    equip: async () => {}, lookAt: async () => {}, getControlState: () => false,
    setControlState: (key, on) => { if (key === 'jump' && on) { bot.entity.position = bot.target || bot.entity.position; bot.entity.onGround = true; bot.entity.isInWater = false; } },
    placeBlock: async (ref, face) => { const p = ref.position.plus(face); placed.set(`${p.x},${p.y},${p.z}`, 'dirt'); bot.target = p.offset(0.5, 1, 0.5); },
    dig: async b => { dug.add(`${b.position.x},${b.position.y},${b.position.z}`); bot.target = b.position.offset(0.5, 0, 0.5).offset(0, -1, 0); } };
  return { bot, placed, dug };
}

test('in a high-banked pool with blocks carried, a block goes into the water beside and the bot climbs onto it', async () => {
  const { stepOut } = require('../src/shore');
  const { bot, placed } = pool({ items: [{ name: 'cobblestone', count: 20 }] });
  const goal = {};
  assert.equal(await stepOut(bot, new Task('pool'), goal, () => {}), true);
  assert(placed.has('1,62,0'), 'the block at the waterline beside');
  assert.equal(goal.survivalAction.action, 'step_out_of_water');
});

test('with no blocks, a step is cut into the bank at the waterline and climbed', async () => {
  const { notchOut, stepOut } = require('../src/shore');
  const { bot, dug } = pool({ waterBeside: false });
  assert.equal(await stepOut(bot, new Task('pool'), {}, () => {}), false, 'no blocks to place');
  const goal = {};
  assert.equal(await notchOut(bot, new Task('pool'), goal, () => {}), true);
  assert(dug.has('1,63,0') || dug.has('-1,63,0') || dug.has('0,63,1') || dug.has('0,63,-1'), 'the block over the step dug');
  assert.equal(goal.survivalAction.action, 'notch_out_of_water');
});

test('with no bank beside it, the bot swims to the nearest bank a step can be cut into', async () => {
  const { notchOut } = require('../src/shore');
  const { Vec3 } = require('vec3');
  const { bot, dug } = pool({ waterBeside: false });
  // Open water all round the bot for two blocks; the banks are further off.
  const inner = bot.blockAt;
  bot.blockAt = p => { const f = p.floored(); if (Math.abs(f.x) <= 2 && Math.abs(f.z) <= 1 && f.y >= 59 && f.y <= 62) return { position: f, name: 'water', boundingBox: 'empty' }; if (Math.abs(f.x) <= 2 && Math.abs(f.z) <= 1 && f.y >= 63) return { position: f, name: 'air', boundingBox: 'empty' }; return inner(p); };
  const set = bot.setControlState;
  bot.setControlState = (key, on) => { if (key === 'forward' && on && !bot.swum) { bot.swum = true; bot.entity.position = new Vec3(0.5, 62.2, 1.5); } set(key, on); };
  const goal = {};
  assert.equal(await notchOut(bot, new Task('lake'), goal, () => {}), true);
  assert([...dug].some(k => /,63,2$|,63,-2$|^3,63|^-3,63/.test(k)), `a bank block dug: ${[...dug]}`);
});

test('the swim to a bank crosses only water: not the corner of a cell over lava the pour did not reach', async () => {
  // mid-92-n: swimming a poured sheet over a lava pool, the straight line to the bank crossed an air cell and the bot fell into the lava.
  const { notchOut } = require('../src/shore');
  const { bot, dug } = pool({ waterBeside: false });
  const inner = bot.blockAt;
  // Water only where the bot is and in a ring beyond cells of air over lava.
  bot.blockAt = p => { const f = p.floored(); const ring = Math.max(Math.abs(f.x), Math.abs(f.z));
    if (f.y === 62 && ring <= 2) return { position: f, name: ring === 1 ? 'air' : 'water', boundingBox: 'empty' };
    if (f.y === 61 && ring === 1) return { position: f, name: 'lava', boundingBox: 'empty' };
    if (f.y >= 63 && ring <= 2) return { position: f, name: 'air', boundingBox: 'empty' };
    return inner(p); };
  let swum = false;
  const set = bot.setControlState;
  bot.setControlState = (key, on) => { if (key === 'forward' && on) swum = true; set(key, on); };
  assert.equal(await notchOut(bot, new Task('sheet'), {}, () => {}), false);
  assert.equal(swum, false, 'no swim across the air');
  assert.equal(dug.size, 0);
});

test('a bank of stone that would take long to dig from the water is not cut: that drowned the live bot', async () => {
  const { notchOut } = require('../src/shore');
  const { bot } = pool({ waterBeside: false });
  bot.digTime = () => 10000;
  assert.equal(await notchOut(bot, new Task('lake'), {}, () => {}), false);
});

// Open sea for two hundred blocks round (0, 62, 0), a taiga walked the day
// before to the west, and the bot on a sand bar twelve blocks long running
// east from its pillar, with no other ground in sight: it swims west, not
// searching the sea floor again. The bar's far end is not land in sight.
function sea() {
  const { Vec3 } = require('vec3');
  const registry = require('minecraft-data')('26.1');
  const block = (p, name) => ({ position: p, name, type: registry.blocksByName[name]?.id, boundingBox: /air|water/.test(name) ? 'empty' : 'block' });
  // A second bar a block of water past the first, as the live run's was.
  // And a cave under the sea bed: dry floor, air over it.
  const nameAt = p => p.x === 10 && p.z === 5 && p.y >= 31 && p.y <= 33 ? 'air' : p.x < -60 ? (p.y <= 62 ? 'grass_block' : 'air') : (p.x >= 0 && p.x <= 12 || p.x >= 14 && p.x <= 20) && p.z === 0 && p.y === 62 ? 'sand' : p.y <= 55 ? 'stone' : p.y <= 62 ? 'water' : 'air';
  const bot = { registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 63, 0.5), isInWater: false, onGround: true },
    oxygenLevel: 20, controlState: {}, said: [], looks: [],
    blockAt: p => { const f = p.floored(); return block(f, nameAt(f)); },
    findBlocks({ maxDistance, useExtraInfo }) {
      const shore = new Vec3(-61, 62, Math.floor(bot.entity.position.z)), bar = new Vec3(12, 62, 0), next = new Vec3(14, 62, 0), cave = new Vec3(10, 30, 5);
      return [cave, bar, next, shore].filter(p => p.distanceTo(bot.entity.position) <= maxDistance && useExtraInfo(bot.blockAt(p)));
    },
    lookAt: async p => { bot.looks.push(p); }, chat: m => bot.said.push(m),
    getControlState: k => !!bot.controlState[k],
    setControlState(k, v) { bot.controlState[k] = v; if (k === 'forward' && v) bot.entity.position = bot.entity.position.offset(-10, 0, 0); },
  };
  // Off the bar into the sea beside it.
  const move = async (b, task, goal) => { bot.entity.position = new Vec3(goal.x + 0.5, 62.2, goal.z + 0.5); bot.entity.isInWater = true; };
  const goal = { explored: { 'overworld:0,0': { biome: 'cold_ocean' }, 'overworld:-2,0': { biome: 'taiga' }, 'overworld:3,3': { biome: 'forest' } } };
  return { bot, goal, move };
}

test('at sea with no ground in sight, the bot swims for the nearest land it has walked', async () => {
  const { crossSea } = require('../src/shore');
  const { bot, goal, move } = sea();
  // At the bar's edge: the centre over the water, the feet on the sand.
  bot.entity.position.z = -0.2;
  assert.equal(await crossSea(bot, new Task('wood'), goal, () => {}, { segmentMs: 30, move }), true, JSON.stringify(goal.seaCrossing));
  assert.equal(goal.step.action, 'cross_sea');
  assert.equal(goal.step.land, 'taiga');
  assert.match(bot.said[0], /taiga.*west/);
  assert(bot.looks.some(p => p.x < -90), 'looking west while swimming');
  assert(bot.entity.position.x < -20, `swum west: ${bot.entity.position.x}`);
  assert.equal(goal.step.landInView, true);
});

test('with ground in sight, on the mainland, or nothing remembered, the sea crossing leaves it to the ordinary search', async () => {
  const { crossSea } = require('../src/shore');
  const near = sea(); near.bot.entity.position.x = -20; near.bot.entity.position.y = 62.2;
  assert.equal(await crossSea(near.bot, new Task('wood'), near.goal, () => {}, { segmentMs: 30, move: near.move }), false, 'the shore is in view');
  const blank = sea(); blank.goal.explored = { 'overworld:0,0': { biome: 'cold_ocean' } };
  assert.equal(await crossSea(blank.bot, new Task('wood'), blank.goal, () => {}, { segmentMs: 30, move: blank.move }), false, 'no land known');
  assert.equal(blank.goal.seaCrossing.declined, 'no land remembered');
});

test('an oak log remembered across the water is swum for before the land walked', async () => {
  const { crossSea } = require('../src/shore');
  const { bot, goal, move } = sea();
  const toward = { x: -100, z: 60, key: 'oak_log:(-100, 64, 60)', biome: 'oak log' };
  assert.equal(await crossSea(bot, new Task('wood'), goal, () => {}, { segmentMs: 30, move, toward }), true);
  assert.match(bot.said[0], /oak log I saw/);
  assert.deepEqual(goal.step.toward, { x: -100, z: 60 });
});

test('with stone at the top of the head in the water, the block over the head is dug before climbing out', async () => {
  // Trial 33: the one open cell of an underground pool, the ceiling at the
  // top of the head; the game gives no lift onto the bank without room.
  const { clearHeadroom } = require('../src/shore');
  const { bot, dug } = pool();
  const over = bot.entity.position.floored().offset(0, 2, 0);
  const inner = bot.blockAt;
  bot.blockAt = p => { const f = p.floored(); return f.equals(over) && !dug.has(`${f.x},${f.y},${f.z}`) ? { position: f, name: 'granite', boundingBox: 'block', diggable: true } : inner(p); };
  bot.oxygenLevel = 20; bot.digTime = () => 500; bot.canDigBlock = () => true;
  assert.equal(await clearHeadroom(bot, new Task('pool')), true);
  assert(dug.has(`${over.x},${over.y},${over.z}`), 'the block over the head is dug');
  // Water or lava over it is left alone.
  const { bot: wet } = pool();
  const top = wet.entity.position.floored();
  const innerWet = wet.blockAt;
  wet.blockAt = p => { const f = p.floored(); return f.equals(top.offset(0, 2, 0)) ? { position: f, name: 'granite', boundingBox: 'block', diggable: true } : f.equals(top.offset(0, 3, 0)) ? { position: f, name: 'water', boundingBox: 'empty' } : innerWet(p); };
  assert.equal(await clearHeadroom(wet, new Task('pool')), false);
});

test('half a minute in the water in one place, the way out is worked one move at a time', async () => {
  // Trial 41: two minutes round the shore escapes in a hole by its mine.
  const unstuck = require('../src/unstuck');
  const real = unstuck.workFree;
  let called = null;
  unstuck.workFree = async (bot, task, goal, save, opts) => { called = opts.aim; return true; };
  try {
    delete require.cache[require.resolve('../src/shore')];
    const { reachShore } = require('../src/shore');
    const { bot } = pool();
    bot.findBlocks = () => []; bot.pathfinder = { movements: { allowedPosition: () => true }, setGoal() {} }; bot.clearControlStates = () => {};
    const f = bot.entity.position.floored();
    const goal = { shoreRecovery: { failures: {}, inWaterSince: Date.now() - 31000, wetArea: { x: f.x, z: f.z } } };
    assert.equal(await reachShore(bot, new Task('pool'), goal, () => {}, { client: {}, dig: async () => {}, surface: async () => {} }), true);
    assert.equal(called?.goal, 'dry');
    // Not before the half minute.
    called = null;
    const fresh = { shoreRecovery: { failures: {}, inWaterSince: Date.now() - 5000, wetArea: { x: f.x, z: f.z } } };
    await reachShore(bot, new Task('pool'), fresh, () => {}, { client: {}, dig: async () => {}, surface: async () => {} }).catch(() => {});
    assert.equal(called, null);
  } finally { unstuck.workFree = real; delete require.cache[require.resolve('../src/shore')]; }
});

test('a swim on purpose toward somewhere far is left alone by the shore rule; a still or sunk one is not', () => {
  // Trial 94: swimming for the sheep on the next island, pulled back to the shore it left three times.
  const { crossingWater } = require('../src/work');
  const { Vec3 } = require('vec3');
  const now = Date.now();
  const bot = { entity: { position: new Vec3(20.5, 62.1, 0.5), eyeHeight: 1.62 }, oxygenLevel: 20, _heading: { x: 80, z: 0, at: now - 5000 },
    blockAt: p => ({ name: p.y <= 62 ? 'water' : 'air', getProperties: () => ({ level: 0 }) }) };
  assert.equal(crossingWater(bot, now), true, 'headed sixty blocks off, head up, air full');
  assert.equal(crossingWater({ ...bot, _heading: { x: 80, z: 0, at: now - 30000 } }, now), false, 'no fresh heading');
  assert.equal(crossingWater({ ...bot, _heading: { x: 25, z: 0, at: now } }, now), false, 'nearly there');
  assert.equal(crossingWater({ ...bot, oxygenLevel: 15 }, now), false, 'losing air');
});
