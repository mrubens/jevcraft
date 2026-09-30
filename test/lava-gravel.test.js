'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);
const { Task } = require('../src/skills');

// The lava sea's gravel beach where mid-243-af-nether-1 went into the lava
// (note 592), from the region file saved after the death: x -238 to -226,
// y 28 to 34, z 48 to 62, the sea's top at y 31. The gravel under the feet
// at (-232, 32, 56), resting on the sea, fell with the body and is put back
// here, and the span's netherrack at (-232, 32, 57), the block laid against
// it, is taken out: the world as it was when the crossing began. The flight
// recorder's frame of 05:45:33.78 has that gravel under the feet.
const BEACH = require('./fixtures/lava-gravel-mid-243-af.json');
const FEET = new Vec3(-231.52, 33, 56.5);
function beachBot({ health = 20, at = FEET, set = {}, items = null } = {}) {
  const [ox, oy, oz] = BEACH.origin, cache = new Map();
  const nameAt = q => {
    const k = `${q.x},${q.y},${q.z}`;
    if (set[k]) return set[k];
    const inside = q.x >= ox && q.z >= oz && q.x - ox < BEACH.layers[0][0].length && q.z - oz < BEACH.layers[0].length;
    if (inside && q.y - oy >= BEACH.layers.length) return 'air';
    const ch = BEACH.layers[q.y - oy]?.[q.z - oz]?.[q.x - ox];
    return ch === undefined ? null : BEACH.palette[ch.charCodeAt(0) - 97];
  };
  const blockAt = p => {
    const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), k = `${q.x},${q.y},${q.z}`;
    if (set[k] || !cache.has(k)) {
      const name = nameAt(q);
      let b = null;
      if (name) {
        const [base, level] = name.split(':');
        const def = registry.blocksByName[base];
        b = level !== undefined ? Block.fromProperties(def.id, { level: Number(level) }, 0) : Block.fromStateId(def.defaultState, 0);
        b.position = q;
      }
      if (set[k]) return b;
      cache.set(k, b);
    }
    return cache.get(k);
  };
  const controls = {};
  // What mid-243-af-nether-1 carried: 82 blocks to lay spans with, the last netherrack first.
  const carried = items || [{ name: 'netherrack', count: 1 }, { name: 'cobbled_deepslate', count: 49 }, { name: 'dirt', count: 30 }, { name: 'blackstone', count: 2 }];
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food: 20, oxygenLevel: 20, game: { dimension: 'the_nether', gameMode: 'survival' },
    entity: { position: at.clone(), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0 }, entities: {},
    inventory: { items: () => carried.map(i => ({ ...i, type: registry.itemsByName[i.name].id })), slots: [] },
    controlState: controls, setControlState: (k, v) => { controls[k] = v; }, getControlState: k => !!controls[k], clearControlStates() { for (const k of Object.keys(controls)) controls[k] = false; },
    stopDigging() {}, lookAt: async () => {}, look: async () => {}, equip: async () => {}, blockAt,
    pathfinder: { setMovements(m) { this.movements = m; }, setGoal() {}, isMoving: () => true, goal: null },
  });
  return bot;
}
module.exports = { beachBot };

test('the gravel under the feet rests on the lava sea; the gravel beside it rests on netherrack (mid-243-af-nether-1, note 592)', () => {
  const { hangingFloor, floorDrops } = require('../src/terrain');
  const bot = beachBot(), at = p => bot.blockAt(new Vec3(p.x, p.y, p.z));
  const h = hangingFloor(at, { x: -232, y: 32, z: 56 });
  assert.equal(h?.into, 'lava');
  assert.equal(h.name, 'gravel'); assert.equal(h.under, 'lava');
  assert.equal(hangingFloor(at, { x: -232, y: 32, z: 55 }), null, 'held by the netherrack under it');
  // The block the crossing laid, south against its side, drops it; one laid a block off does not.
  assert.equal(floorDrops(at, { x: -232, y: 32, z: 56 }, { x: -232, y: 32, z: 57 })?.into, 'lava');
  assert.equal(floorDrops(at, { x: -232, y: 32, z: 56 }, { x: -232, y: 32, z: 58 }), null);
});

test('the crossing does not lay its first block against the gravel under the feet: the survey stops there and says why, and the span lays nothing (mid-243-af-nether-1, note 592)', async () => {
  const { surveyCrossing, bridgeTo } = require('../src/bridging');
  const { Task } = require('../src/skills');
  const bot = beachBot();
  // Toward the leg's target, south along x -232 over the sea.
  const target = new Vec3(-229, 43, 95);
  const survey = surveyCrossing(bot, target);
  assert.equal(survey.cells, 0);
  assert.match(survey.stoppedBy, /the gravel underfoot at \(-232, 32, 56\) rests on lava: a block laid or dug beside it drops it, and the body with it, into the lava/);
  const placed = [];
  bot.placeBlock = async (ref, face) => { placed.push(ref.position.plus(face)); };
  await assert.rejects(bridgeTo(bot, new Task('cross'), target, { maxBlocks: 32 }), /Not laid at \(-232, 32, 57\): the gravel underfoot/);
  assert.deepEqual(placed, [], 'nothing laid against the gravel');
  // From the gravel held by the netherrack a block north, a span laid from it is surveyed as before.
  const held = beachBot({ at: new Vec3(-231.5, 33, 55.5), set: { '-232,32,56': 'air' } });
  const on = surveyCrossing(held, new Vec3(-232, 33, 70));
  assert.doesNotMatch(String(on.stoppedBy), /underfoot/);
  assert.equal(on.bridge, 7, `laid over the sea to the edge of the saved ground: ${JSON.stringify(on)}`);
});

test('the pathfinder lays no block beside the lowest of a column of gravel resting on lava while the body stands on it (note 592)', () => {
  const { configureMovements } = require('../src/movement');
  // In the Overworld: the body on gravel at (0, 64, 0) over a lava pool,
  // stone walls west, north and south, and to the east a gap two deep
  // onto stone that the pathfinder bridges with a block at (1, 64, 0),
  // against the gravel's side.
  const cells = new Map();
  const put = (x, y, z, n) => cells.set(`${x},${y},${z}`, n);
  for (let x = -3; x <= 4; x++) for (let z = -3; z <= 3; z++) for (let y = 55; y <= 70; y++) put(x, y, z, y <= 63 ? (x === 0 && y === 63 && z === 0 ? 'lava' : 'stone') : y === 64 && x < 0 ? 'stone' : 'air');
  for (const [x, z] of [[-1, 0], [0, 1], [0, -1], [1, 1], [1, -1]]) for (const y of [65, 66]) put(x, y, z, 'stone');
  put(0, 64, 0, 'gravel'); put(0, 64, 1, 'stone'); put(0, 64, -1, 'stone');
  const blockAt = p => { const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); const n = cells.get(`${q.x},${q.y},${q.z}`); if (!n) return null; const b = Block.fromStateId(registry.blocksByName[n].defaultState, 0); b.position = q; return b; };
  const bot = Object.assign(new EventEmitter(), { registry, version: '26.1', health: 20, game: { dimension: 'overworld', gameMode: 'survival' }, entities: {},
    entity: { position: new Vec3(0.5, 65, 0.5), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) }, blockAt,
    inventory: { items: () => [{ name: 'cobblestone', count: 32, type: registry.itemsByName.cobblestone.id }], slots: [] },
    pathfinder: { setMovements(m) { this.movements = m; } } });
  const m = configureMovements(bot);
  const node = { x: 0, y: 65, z: 0, remainingBlocks: 32 };
  const lays = n => (n.toPlace || []).some(p => p.x + p.dx === 1 && p.y + p.dy === 64 && p.z + p.dz === 0);
  assert(!m.getNeighbors(node).some(lays), 'no block laid at (1, 64, 0) against the gravel resting on the lava');
  // With stone under the gravel the same bridge is laid.
  put(0, 63, 0, 'stone');
  assert(m.getNeighbors(node).some(lays), 'held up, the bridge east is a move');
});

// In the sea after the fall, as the region file has it: the gravel gone,
// the span's netherrack at (-232, 32, 57), the body where the first body_way
// asking found it (05:45:34.4, 17.9 health, sinking at y 30.1), its body
// moved by prismarine-physics, the physics the bot's own client moves it by,
// twenty ticks a second, a block put where the body's box is not.
const AFTER = { '-232,32,56': 'air', '-232,32,57': 'netherrack' };
function inTheSea({ health = 17.9 } = {}) {
  const { Physics, PlayerState } = require('prismarine-physics');
  const { fixPlayerDimensions } = require('../src/compatibility');
  const set = { ...AFTER };
  const bot = beachBot({ health, at: new Vec3(-231.52, 30.14, 56.67), set, items: [{ name: 'cobbled_deepslate', count: 49 }, { name: 'dirt', count: 30 }, { name: 'blackstone', count: 2 }] });
  Object.assign(bot.entity, { onGround: false, isInLava: true, velocity: new Vec3(0, -0.04, 0), effects: {}, attributes: {} });
  bot.inventory.slots = { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' } };
  bot.lookAt = async p => { const e = bot.entity.position.offset(0, 1.62, 0); bot.entity.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z)); bot.entity.pitch = Math.atan2(p.y - e.y, Math.hypot(p.x - e.x, p.z - e.z)); };
  bot.look = async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; };
  bot.placeBlock = async (ref, face) => {
    const c = ref.position.plus(face), p = bot.entity.position;
    const overlaps = c.x < p.x + 0.3 && c.x + 1 > p.x - 0.3 && c.z < p.z + 0.3 && c.z + 1 > p.z - 0.3 && c.y < p.y + 1.8 && c.y + 1 > p.y;
    if (overlaps) throw new Error('the body is in the way');
    set[`${c.x},${c.y},${c.z}`] = 'cobbled_deepslate';
  };
  const world = { getBlock: p => bot.blockAt(p) };
  const physics = Physics(registry, world); fixPlayerDimensions(physics);
  const run = { lavaTicks: 0, ticks: 0 };
  run.timer = setInterval(() => {
    const s = new PlayerState(bot, Object.fromEntries(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].map(k => [k, !!bot.controlState[k]])));
    physics.simulatePlayer(s, world); s.apply(bot);
    run.ticks++; if (require('../src/terrain').bodyInLava(bot)) run.lavaTicks++;
  }, 50);
  return { bot, run, set };
}

test('in the lava sea under the gravel beach, no cell out is one a swim reaches, and the ways say so and what the lava costs (mid-243-af-nether-1, note 592)', () => {
  const { Survival, lavaTop } = require('../src/survival');
  const { bot, run } = inTheSea();
  clearInterval(run.timer);
  assert.equal(lavaTop(bot), 31, 'the sea\'s top cell');
  const survival = new Survival(bot, { dig: async () => {} }, { state: { shelters: [], lastDry: { x: -232, y: 33, z: 56, dimension: 'the_nether' } } });
  const ways = survival.lavaWays(new Task('lava'), {}, () => {});
  // The beach's gravel stands a block over the lava's top: bobbing against it is not a way out.
  assert.equal(ways.to_dry_ground, undefined, `no swim onto the gravel: ${ways.to_dry_ground?.description}`);
  assert.match(ways.pillar_out.description, /^Press against the netherrack at \(-232, 31, 55\) holding jump, .* put a block into the lava under the feet at \(-232, 31, 56\) as they clear it: about [\d.]+ seconds in the lava, about [\d.]+ health in the lava at [\d.]+ a second, then up to 15 burning after it \(no water to put it out in the Nether\)/);
  assert.match(ways.pillar_out.description, /standing on it at the lava's top the body is out of the lava, and a step up from it is dry ground at \(-232, 33, 57\)/);
  // Its footing gone into the lava, the last dry cell is no way out, and is
  // not offered as one (note 754b; 25584 took it at 15:21:25Z).
  assert.equal(ways.back_the_way_came, undefined);
  assert.equal(Object.keys(ways)[0], 'pillar_out', 'the fallback takes the block');
});

test('in the lava sea under the gravel beach, the block into the lava gets the body out in about the seconds it is priced at, where the swim at the gravel never does (mid-243-af-nether-1, note 592)', { timeout: 15000 }, async t => {
  const { Survival } = require('../src/survival');
  const { bodyInLava } = require('../src/terrain');
  // The block: pressed against the netherrack north, jump held, it goes in under the feet.
  {
    const { bot, run, set } = inTheSea();
    try {
      const survival = new Survival(bot, { dig: async () => {} }, { state: { shelters: [], lastDry: { x: -232, y: 33, z: 56, dimension: 'the_nether' } } });
      const ways = survival.lavaWays(new Task('lava'), {}, () => {});
      const priced = Number(ways.pillar_out.description.match(/about ([\d.]+) seconds in the lava/)[1]);
      assert.equal(await ways.pillar_out.run(), true, 'out of the lava');
      assert.equal(set['-232,31,56'], 'cobbled_deepslate', 'the block went into the lava under the feet');
      for (let i = 0; i < 10 && !bot.entity.onGround; i++) await new Promise(r => setTimeout(r, 50));
      assert(bot.entity.onGround && Math.abs(bot.entity.position.y - 32) < 0.01, `standing on it at the lava's top: ${bot.entity.position}`);
      t.diagnostic(`the block: ${run.lavaTicks / 20} s in the lava, priced at ${priced}`);
      assert(run.lavaTicks / 20 <= priced + 0.5, `in the lava ${run.lavaTicks / 20} s, priced at ${priced}`);
    } finally { clearInterval(run.timer); }
  }
  // The swim at the gravel a block over the lava's top, as the old ways
  // walked it: four seconds and still not out.
  {
    const { bot, run } = inTheSea();
    try {
      const { move } = require('../src/motion');
      await move(bot, new Task('swim'), { label: 'out_of_lava', keys: ['forward', 'jump'], sneak: false, why: 'the old way', look: new Vec3(-233.5, 34, 54.5), maxMs: 4000, tick: 50,
        until: () => bot.entity.onGround && !bodyInLava(bot) });
      assert(!(bot.entity.onGround && bot.entity.position.y >= 33), `not onto the gravel: ${bot.entity.position}`);
      t.diagnostic(`the swim: ${run.lavaTicks / 20} s of four in the lava, ending at ${bot.entity.position}`);
      assert(run.lavaTicks >= 30, `${run.lavaTicks / 20} s of the four in the lava`);
    } finally { clearInterval(run.timer); }
  }
});
