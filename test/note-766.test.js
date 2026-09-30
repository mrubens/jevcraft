'use strict';
// Note 766. (A) Smelts that timed out waiting for their output: 20 of the 21
// "timed out ... after smelting" since 2026-09-30T12Z had 0 free slots at the
// wait. 25590 (mid-239-ai, 19:00:05-21Z): 36 slots full, one raw iron to
// smelt; the dirt was thrown for room, a stone pickaxe lying by the furnace
// was picked up into the slot, and the take was counted as the output's
// count whatever arrived: "have 0 of 1, 0 free slots", the ingot in the
// furnace. (B) Lava after note 756: 25590 (mid-242-zg, 15:31:39Z) knocked by a
// ghast's fireball off (328, 73, -9) into a lava cell a block over, took the
// "nearest dry cell" three blocks off through the lava (7.5 seconds said, 40
// health) over the one it had stood on a block away, beside a drop.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { smelt } = require('../src/work');
const { Task } = require('../src/skills');

// 25590's pockets at 19:00:05.413Z, as the flight record has them, one stack
// a slot: 36 slots, none free.
const POCKETS_25590 = { brown_egg: 1, mutton: 5, birch_log: 1, lapis_lazuli: 17, raw_copper: 16, coal: 203, white_wool: 2, torch: 1, leather: 7, iron_pickaxe: 2, beef: 9, arrow: 2, stone_pickaxe: 1, smooth_basalt: 12, cooked_mutton: 2, redstone: 13, gravel: 9, cobblestone: 125, stick: 1, water_bucket: 1, wheat_seeds: 1, birch_planks: 2, iron_sword: 1, flint: 1, raw_iron: 2, leaf_litter: 7, stone_axe: 1, furnace: 1, cooked_beef: 4, dirt: 35, white_bed: 1 };
const UNSTACKED = /pickaxe|sword|_axe|bucket|bed$/;
function stacks(pockets) {
  const out = [];
  for (const [name, count] of Object.entries(pockets)) {
    const size = UNSTACKED.test(name) ? 1 : 64;
    for (let left = count; left > 0; left -= size) out.push({ name, count: Math.min(size, left), stackSize: size });
  }
  return out;
}

// A furnace and a server as 25590 met them: a take with no slot free at the
// server leaves the output in the furnace; what the bot throws lies at its
// feet, and the stone pickaxe on the floor is picked up the first time a
// slot frees.
function scene({ floor = [{ name: 'stone_pickaxe', count: 1, stackSize: 1 }] } = {}) {
  const pockets = stacks(POCKETS_25590);
  assert.equal(pockets.length, 36);
  const state = { loaded: 0, output: 0, opens: 0, takes: 0, refusedTakes: 0, thrown: [] };
  const pickUp = () => { while (floor.length && pockets.length < 36) pockets.push(floor.shift()); };
  const window = () => ({
    get slots() { return [null, null, null, ...pockets.map(p => ({ ...p })), ...Array(Math.max(0, 36 - pockets.length)).fill(null)]; },
    inventoryStart: 3, inventoryEnd: 39,
    outputItem: () => state.output ? { name: 'iron_ingot', count: state.output } : null,
    takeOutput: async () => {
      state.takes++;
      // The pickaxe on the floor comes into the freed slot as the window
      // opens and the click goes: 25590's 19:00:18Z frame.
      pickUp();
      if (pockets.length >= 36) { state.refusedTakes++; return; }
      pockets.push({ name: 'iron_ingot', count: state.output, stackSize: 64 }); state.output = 0;
    },
    inputItem: () => state.loaded ? { name: 'raw_iron', count: state.loaded } : null,
    fuelItem: () => ({ name: 'coal', count: 1 }), fuel: 0.5,
    putInput: async (type, meta, count) => { const raw = pockets.find(p => p.name === 'raw_iron'); raw.count -= count; if (!raw.count) pockets.splice(pockets.indexOf(raw), 1); state.loaded += count; setTimeout(() => { state.output += state.loaded; state.loaded = 0; }, 50); },
    putFuel: async () => {}, close: () => {},
  });
  const bot = {
    entity: { position: new Vec3(384.5, 67, -97.5), yaw: 0 },
    inventory: { items: () => pockets, emptySlotCount: () => 36 - pockets.length },
    registry: { blocksByName: { furnace: { id: 1 } }, itemsByName: { raw_iron: { id: 5 }, coal: { id: 6 }, iron_ingot: { id: 7, stackSize: 64 } } },
    findBlocks: () => [new Vec3(385, 67, -97)], blockAt: p => ({ name: 'furnace', position: p }),
    world: { raycast: () => ({ position: new Vec3(385, 67, -97) }) },
    pathfinder: { movements: {}, goto: async () => {}, setGoal: () => {} },
    lookAt: async () => {},
    tossStack: async item => { pockets.splice(pockets.indexOf(item), 1); state.thrown.push(item.name); },
    openFurnace: async () => { state.opens++; return window(); },
  };
  return { bot, pockets, state };
}
const ingots = pockets => pockets.filter(p => p.name === 'iron_ingot').reduce((n, p) => n + p.count, 0);

test('25590 at 19:00Z, before: the take into pockets filled again is counted anyway and the wait times out with the ingot in the furnace (note 766 replay)', { timeout: 20000 }, async t => {
  // The take as main had it: counted by the output's count. Reproduced by
  // the window with no player slots to read, so this code counts as main did.
  const { bot, pockets, state } = scene();
  const opened = bot.openFurnace;
  bot.openFurnace = async () => { const w = await opened(); delete w.inventoryStart; return w; };
  const began = Date.now();
  await assert.rejects(smelt(bot, new Task('smelt', 'test'), { item: 'iron_ingot', from: 'raw_iron', count: 1, fuelItem: 'coal' }, {}), /iron ingot after smelting \(have 0 of 1, 0 free slots\)/);
  t.diagnostic(`thrown ${state.thrown.join(', ')}; takes ${state.takes}, refused ${state.refusedTakes}; ingots carried ${ingots(pockets)}, in the furnace ${state.output}; ${(Date.now() - began) / 1000} s`);
  assert.equal(state.output, 1, 'the ingot is still in the furnace');
});

test('25590 at 19:00Z, after: the take reads what came into the pockets, the room is made again for the refilled slot, and the ingot comes out (note 766 replay)', { timeout: 20000 }, async t => {
  const { bot, pockets, state } = scene();
  await smelt(bot, new Task('smelt', 'test'), { item: 'iron_ingot', from: 'raw_iron', count: 1, fuelItem: 'coal' }, {});
  t.diagnostic(`thrown ${state.thrown.join(', ')}; takes ${state.takes}, refused ${state.refusedTakes}; ingots carried ${ingots(pockets)}`);
  assert.equal(ingots(pockets), 1, 'the ingot is carried');
  assert.equal(state.output, 0, 'the furnace is empty');
  assert.equal(state.refusedTakes, 1, 'one take found the slot filled again');
  assert.deepEqual(state.thrown.slice(0, 2), ['dirt', 'gravel'], 'room made twice: the dirt, then the gravel');
  assert(pockets.some(p => p.name === 'stone_pickaxe' && pockets.filter(q => q.name === 'stone_pickaxe').length === 2), 'the pickaxe off the floor is carried');
});

test('a take that finds no slot three times ends the step, said with what filled the room, not a wait for an output that is not coming (note 766)', { timeout: 20000 }, async () => {
  // Every freed slot refilled off the floor.
  const floor = Array.from({ length: 8 }, () => ({ name: 'cobbled_deepslate', count: 64, stackSize: 64 }));
  const { bot, state } = scene({ floor });
  await assert.rejects(smelt(bot, new Task('smelt', 'test'), { item: 'iron_ingot', from: 'raw_iron', count: 1, fuelItem: 'coal' }, {}),
    err => err.name === 'Blocked' && /would not come out of the furnace: no free slot at the take, \d+ times \(the room made was filled again by cobbled deepslate picked up off the floor\)/.test(err.message));
  assert.equal(state.output, 1, 'left in the furnace, not thrown');
});

// (B) The ground at 15:31:34Z as the no_route frame has it (the blocks round
// the feet at (328, 73, -9)) and the save's netherrack west of it: the
// ledge's floor at y 72 for x 328 and under, open air east of x 328 down to
// y 64, the lava of a fall at (327..329, 73, -11), (327, 74..75, -11) and
// (329, 72, -11), walls of netherrack at x 326 and under at y 73 and at x
// 324 and under above. The body at the first escape frame (15:31:39.398Z):
// (328.81, 73.05, -9.84), touching the lava cell at z -11, 17.28 health.
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);
function ledgeName(x, y, z) {
  if (x < 316 || x > 340 || z < -20 || z > 2 || y < 60 || y > 84) return null;
  const lava = ['327,73,-11', '328,73,-11', '329,73,-11', '327,74,-11', '327,75,-11', '329,72,-11'];
  if (lava.includes(`${x},${y},${z}`)) return 'lava';
  if (x >= 329) return y <= 64 ? 'netherrack' : 'air';
  if (y <= 72) return 'netherrack';
  if (y === 73) return x <= 326 || (x === 327 && z >= -10 && z <= -8) ? 'netherrack' : 'air';
  return x <= 324 ? 'netherrack' : 'air';
}
function ledgeBot({ at, health = 17.28 } = {}) {
  const cache = new Map();
  const blockAt = p => {
    const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), k = `${q.x},${q.y},${q.z}`;
    if (!cache.has(k)) {
      const name = ledgeName(q.x, q.y, q.z);
      let b = null;
      if (name) { b = Block.fromStateId(registry.blocksByName[name].defaultState, 0); b.position = q; }
      cache.set(k, b);
    }
    return cache.get(k);
  };
  const controls = {};
  const carried = [{ name: 'oak_planks', count: 4 }, { name: 'gravel', count: 16 }, { name: 'netherrack', count: 128 }, { name: 'cobblestone', count: 57 }, { name: 'dirt', count: 23 }];
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food: 20, oxygenLevel: 20, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 6000, age: 100000 },
    username: 'Jev', players: {},
    entity: { position: at.clone(), onGround: false, isInLava: true, isInWater: false, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0, effects: {}, attributes: {}, metadata: {} },
    entities: {},
    inventory: { items: () => carried.map(i => ({ ...i, type: registry.itemsByName[i.name].id })), slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, 45: { name: 'shield' } } },
    controlState: controls, setControlState: (k, v) => { controls[k] = v; }, getControlState: k => !!controls[k], clearControlStates() { for (const k of Object.keys(controls)) controls[k] = false; },
    blockAt, findBlocks: () => [],
  });
  return bot;
}
const KNOCKED = new Vec3(328.81, 73.05, -9.84);

test('25590 at 15:31:39Z: out of the lava onto the cell a block off, where it stood, not three blocks through the lava for a cell with nothing beside it (note 766 replay)', () => {
  const { lavaExit } = require('../src/survival');
  const { bodyInLava, besideDrop } = require('../src/terrain');
  const bot = ledgeBot({ at: KNOCKED });
  assert(bodyInLava(bot), 'touching the lava at the frame');
  const stood = new Vec3(328, 73, -9);
  assert(besideDrop(bot, stood), 'where it stood is beside the drop east');
  const exit = lavaExit(bot, 6, { water: true });
  assert(exit, 'a cell out');
  assert.deepEqual({ x: exit.x, y: exit.y, z: exit.z }, { x: 328, y: 73, z: -9 }, `the cell a block off: took ${exit}`);
  assert(exit.blocks <= 1.01, `a block of lava, not three: ${exit.blocks}`);
});

test('the way out prices each cell by the seconds in the lava: a cell with lava beside it or a drop beside it comes after one as near without, never after one farther through the lava (note 766)', () => {
  const { lavaExitCost } = require('../src/survival');
  // One block off beside a drop and lava against three blocks off with nothing.
  assert(lavaExitCost({ blocks: 1, lavaBeside: true, edge: true, high: false }) < lavaExitCost({ blocks: 2, lavaBeside: false, edge: false, high: false }));
  assert(lavaExitCost({ blocks: 1, lavaBeside: true, edge: false, high: false }) > lavaExitCost({ blocks: 1, lavaBeside: false, edge: false, high: false }));
  assert(lavaExitCost({ blocks: 1, lavaBeside: false, edge: true, high: false }) > lavaExitCost({ blocks: 1, lavaBeside: false, edge: false, high: false }));
  // Out of a swim's reach stays last.
  assert(lavaExitCost({ blocks: 1, lavaBeside: false, edge: false, high: true }) > lavaExitCost({ blocks: 5, lavaBeside: true, edge: true, high: false }));
});

// 25593 (mid-237-am, 2026-09-30 20:38:40-45Z): knocked by a zombie off the
// ledge at (141.9, -53.4, 63.2) into the lava pool it was filling buckets
// from, three deep over tuff; the escape took to_dry_ground, the ledge cell
// (142, -54, 61) level with the lava's top, at once (0.7 s). It rose to the
// lava's top beside the ledge by 20:38:43.77 and there held jump alone for
// two seconds, bobbing at y -54.5 to -54.6 (the rise first of note 756,
// which waits for the feet at the cell's floor, and jump alone in lava
// rises to about 0.6 under the lava's top), and died at 20:38:45.70 a block
// from the cell. The ground is the save's, read-only after the death
// (test/fixtures/lava-pool-25593.json; lava as source blocks).
const POOL = require('./fixtures/lava-pool-25593.json');
function fixtureBot(POOL, { at, health, dimension = 'overworld' }) {
  const [ox, oy, oz] = POOL.origin, cache = new Map();
  const blockAt = p => {
    const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), k = `${q.x},${q.y},${q.z}`;
    if (!cache.has(k)) {
      const ch = POOL.layers[q.y - oy]?.[q.z - oz]?.[q.x - ox];
      let b = null;
      if (ch !== undefined) { const name = POOL.palette[ch.charCodeAt(0) - 97]; b = Block.fromStateId(registry.blocksByName[name].defaultState, 0); b.position = q; }
      cache.set(k, b);
    }
    return cache.get(k);
  };
  const controls = {};
  const carried = [{ name: 'cobblestone', count: 64 }, { name: 'cobbled_deepslate', count: 64 }, { name: 'dirt', count: 30 }, { name: 'iron_pickaxe', count: 1 }, { name: 'bucket', count: 9 }];
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food: 20, oxygenLevel: 20, game: { dimension, gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 6000, age: 100000 },
    username: 'Jev', players: {},
    entity: { position: at.clone(), onGround: false, isInLava: true, isInWater: false, height: 1.8, width: 0.6, velocity: new Vec3(0, -0.08, 0), yaw: 0, pitch: 0, effects: {}, attributes: {}, metadata: {} },
    entities: {},
    inventory: { items: () => carried.map(i => ({ ...i, type: registry.itemsByName[i.name].id })), slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, 45: { name: 'shield' } } },
    controlState: controls, setControlState: (k, v) => { controls[k] = v; }, getControlState: k => !!controls[k], clearControlStates() { for (const k of Object.keys(controls)) controls[k] = false; },
    stopDigging() {}, equip: async () => {}, blockAt, heldItem: null, chat() {}, activateItem() {}, deactivateItem() {},
    findBlocks: () => [],
    pathfinder: { setMovements(m) { this.movements = m; }, setGoal() {}, isMoving: () => false, goal: null, movements: {} },
  });
  bot.lookAt = async p => { const e = bot.entity.position.offset(0, 1.62, 0); bot.entity.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z)); bot.entity.pitch = Math.atan2(p.y - e.y, Math.hypot(p.x - e.x, p.z - e.z)); };
  bot.look = async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; };
  return bot;
}
// prismarine-physics twenty ticks a second, as the client moves the body;
// the lava's hurts one each half second in it, 1.92 each through full iron
// (25593's own, 13.02 to 11.1).
function simulate(bot) {
  const { Physics, PlayerState } = require('prismarine-physics');
  const { fixPlayerDimensions } = require('../src/compatibility');
  const { bodyInLava } = require('../src/terrain');
  const world = { getBlock: p => bot.blockAt(p) };
  const physics = Physics(registry, world); fixPlayerDimensions(physics);
  const run = { lavaTicks: 0, hurts: 0, sinceHurt: 10, trace: [], ticks: 0 };
  run.timer = setInterval(() => {
    if (run.ticks++ % 5 === 0) run.trace.push(`${(run.ticks / 20).toFixed(2)}s ${bot.entity.position.x.toFixed(2)},${bot.entity.position.y.toFixed(2)},${bot.entity.position.z.toFixed(2)} ${Object.keys(bot.controlState).filter(k => bot.controlState[k]).join('+')}`);
    const s = new PlayerState(bot, Object.fromEntries(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].map(k => [k, !!bot.controlState[k]])));
    physics.simulatePlayer(s, world); s.apply(bot);
    run.sinceHurt++;
    if (bodyInLava(bot)) {
      run.lavaTicks++;
      if (run.sinceHurt >= 10) { run.sinceHurt = 0; run.hurts++; bot.health = Math.max(0, bot.health - 1.92); }
    }
  }, 50);
  return run;
}

test('25593 in its lava pool at 13.9 health: the way out rises to the lava\'s top and presses on onto the ledge, not bobbing under it on jump alone (note 766 replay)', { timeout: 30000 }, async t => {
  const { Survival } = require('../src/survival');
  const { bodyInLava } = require('../src/terrain');
  const bot = fixtureBot(POOL, { at: new Vec3(140.3, -57.53, 62.3), health: 13.94 });
  const events = [];
  bot.on('lava_escape', f => events.push(f));
  const run = simulate(bot);
  try {
    assert(bodyInLava(bot), 'in the lava at the frame');
    const survival = new Survival(bot, { dig: async () => {} }, { state: { shelters: [], lastDry: { x: 141, y: -53, z: 63, dimension: 'overworld' } } });
    const began = Date.now();
    for (let pass = 0; pass < 6 && bodyInLava(bot) && bot.health > 0; pass++) {
      try { await survival.stepOnce(new Task('survival'), {}, () => {}, () => {}); }
      catch (err) { if (!['NeedsSafety', 'NeedsAir'].includes(err.name)) throw err; }
    }
    for (let i = 0; i < 10 && bodyInLava(bot); i++) await new Promise(r => setTimeout(r, 50));
    t.diagnostic(`out: ${!bodyInLava(bot)} after ${(Date.now() - began) / 1000} s, ${run.lavaTicks / 20} s in lava, ${run.hurts} hurts, health ${bot.health.toFixed(1)} at ${bot.entity.position}; took ${events.map(e => `${e.took} (${e.workedOutMs} ms)`).join(', ')}`);
    if (process.env.TRACE) t.diagnostic(run.trace.join('\n'));
    assert(events.length >= 1 && events[0].took === 'to_dry_ground', `the dry cell: ${events.map(e => e.took)}`);
    assert(!bodyInLava(bot), `out of the lava: ${bot.entity.position}`);
    assert(bot.health > 0, `alive: ${bot.health}`);
  } finally { clearInterval(run.timer); }
});

// 25584 (mid-244-ak, 2026-09-30 20:39:15Z): at 5.4 health, shot by a
// piglin's arrow off (8.2, 38, 48.4) into lava a block deep on a magma
// floor, at (7.84, 37.06, 49.33); the dry netherrack cell a block east,
// (8, 37, 49), had lava beside it, and the escape took the cell 3.8 blocks
// off by the way through (9.5 seconds said) and died 0.8 seconds later. The
// save's ground, read-only after the death (test/fixtures/lava-magma-25584.json).
const MAGMA = require('./fixtures/lava-magma-25584.json');
test('25584 on its magma floor at 4.9 health: out onto the cell a block east, lava beside it or not, and alive (note 766 replay)', { timeout: 30000 }, async t => {
  const { Survival, lavaExit } = require('../src/survival');
  const { bodyInLava } = require('../src/terrain');
  const at = new Vec3(7.84, 37.06, 49.33);
  const exit = lavaExit(fixtureBot(MAGMA, { at, health: 4.94, dimension: 'the_nether' }), 6, { water: true });
  assert.deepEqual({ x: exit.x, y: exit.y, z: exit.z }, { x: 8, y: 37, z: 49 }, `the cell a block east: ${exit}`);
  const bot = fixtureBot(MAGMA, { at, health: 4.94, dimension: 'the_nether' });
  const events = [];
  bot.on('lava_escape', f => events.push(f));
  const run = simulate(bot);
  try {
    const survival = new Survival(bot, { dig: async () => {} }, { state: { shelters: [], lastDry: { x: 8, y: 38, z: 48, dimension: 'the_nether' } } });
    for (let pass = 0; pass < 4 && bodyInLava(bot) && bot.health > 0; pass++) {
      try { await survival.stepOnce(new Task('survival'), {}, () => {}, () => {}); }
      catch (err) { if (!['NeedsSafety', 'NeedsAir'].includes(err.name)) throw err; }
    }
    for (let i = 0; i < 10 && bodyInLava(bot); i++) await new Promise(r => setTimeout(r, 50));
    t.diagnostic(`out: ${!bodyInLava(bot)}, ${run.lavaTicks / 20} s in lava, ${run.hurts} hurts, health ${bot.health.toFixed(1)} at ${bot.entity.position}; took ${events.map(e => `${e.took} of ${e.offered} (${e.workedOutMs} ms)`).join(', ')}`);
    assert.equal(events[0]?.took, 'to_dry_ground');
    assert(/1(\.\d)? blocks off by the way through at \(8, 37, 49\)/.test(events[0].says), events[0].says);
    assert(!bodyInLava(bot), `out of the lava: ${bot.entity.position}`);
    assert(bot.health > 0, `alive: ${bot.health}`);
  } finally { clearInterval(run.timer); }
});
