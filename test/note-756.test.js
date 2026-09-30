'use strict';
// Note 756: lava by rule. 25597 (mid-241-bf, 2026-09-30 14:14:51-59Z) came
// back from a reconnect standing in the water it had poured over the lava it
// fetched, the water's flow carried it into a lava cell a block down, and the
// way out was a question asked 4.1 seconds after the first hurt, unanswered
// when it died. The ground here is that pool as the flight record has it: the
// obsidian cast at y -55 under a sheet of water at y -54, a lava cell two deep
// at (-147, -55/-56, -516) where the body burned, dry deepslate east of x -146
// and north of z -521, in a cave four high. The frames: the reconnect at
// (-148.02, -53.82, -516.8), in the water; the first lava hurt at
// (-146.76, -55.07, -515.53), 13.4 health, full iron.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);
const { Task } = require('../src/skills');

const POOL = { x0: -155, x1: -146, z0: -521, z1: -512 };
const inPool = (x, z) => x >= POOL.x0 && x <= POOL.x1 && z >= POOL.z0 && z <= POOL.z1;
function poolName(x, y, z, set) {
  const k = `${x},${y},${z}`;
  if (set[k] !== undefined) return set[k];
  if (x < -160 || x > -136 || z < -530 || z > -504 || y < -62 || y > -46) return null;
  if (x === -147 && z === -516 && (y === -55 || y === -56)) return 'lava';
  if (y <= -56 || y >= -50) return 'deepslate';
  if (y === -55) return inPool(x, z) ? 'obsidian' : 'deepslate';
  if (y === -54) return inPool(x, z) ? (x === -147 && z === -516 ? 'air' : 'water') : 'air';
  return 'air';
}
function poolBot({ at, health = 13.4, set = {}, items = null, inLava = false } = {}) {
  const cache = new Map();
  const blockAt = p => {
    const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)), k = `${q.x},${q.y},${q.z}`;
    if (set[k] !== undefined || !cache.has(k)) {
      const name = poolName(q.x, q.y, q.z, set);
      let b = null;
      if (name) { b = Block.fromStateId(registry.blocksByName[name].defaultState, 0); b.position = q; }
      if (set[k] !== undefined) return b;
      cache.set(k, b);
    }
    return cache.get(k);
  };
  const controls = {};
  const carried = items || [{ name: 'cobblestone', count: 99 }, { name: 'cobbled_deepslate', count: 64 }, { name: 'dirt', count: 15 }, { name: 'iron_pickaxe', count: 1 }, { name: 'water_bucket', count: 1 }, { name: 'bucket', count: 1 }];
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1', health, food: 19, oxygenLevel: 20, game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 6000, age: 100000 },
    username: 'Jev', players: {},
    entity: { position: at.clone(), onGround: false, isInLava: inLava, isInWater: false, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), yaw: 3.835, pitch: 0.144, effects: {}, attributes: {}, metadata: {} },
    entities: {},
    inventory: { items: () => carried.map(i => ({ ...i, type: registry.itemsByName[i.name].id })), slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' }, 45: { name: 'shield' } } },
    controlState: controls, setControlState: (k, v) => { controls[k] = v; }, getControlState: k => !!controls[k], clearControlStates() { for (const k of Object.keys(controls)) controls[k] = false; },
    stopDigging() {}, equip: async () => {}, blockAt, heldItem: null, chat() {}, activateItem() {}, deactivateItem() {},
    findBlocks: () => [],
    pathfinder: { setMovements(m) { this.movements = m; }, setGoal() {}, isMoving: () => false, goal: null, movements: {} },
  });
  bot.lookAt = async p => { const e = bot.entity.position.offset(0, 1.62, 0); bot.entity.yaw = Math.atan2(-(p.x - e.x), -(p.z - e.z)); bot.entity.pitch = Math.atan2(p.y - e.y, Math.hypot(p.x - e.x, p.z - e.z)); };
  bot.look = async (yaw, pitch) => { bot.entity.yaw = yaw; bot.entity.pitch = pitch; };
  bot.placeBlock = async (ref, face) => {
    const c = ref.position.plus(face), p = bot.entity.position;
    const overlaps = c.x < p.x + 0.3 && c.x + 1 > p.x - 0.3 && c.z < p.z + 0.3 && c.z + 1 > p.z - 0.3 && c.y < p.y + 1.8 && c.y + 1 > p.y;
    if (overlaps) throw new Error('the body is in the way');
    set[`${c.x},${c.y},${c.z}`] = 'cobblestone';
  };
  return bot;
}
// The body moved by prismarine-physics, twenty ticks a second, as the
// client moves it; the lava's hurts counted as the server gives them, one
// each half second in it, 1.9 each through full iron (25597's own).
function simulate(bot) {
  const { Physics, PlayerState } = require('prismarine-physics');
  const { fixPlayerDimensions } = require('../src/compatibility');
  const { bodyInLava } = require('../src/terrain');
  const world = { getBlock: p => bot.blockAt(p) };
  const physics = Physics(registry, world); fixPlayerDimensions(physics);
  const run = { lavaTicks: 0, ticks: 0, hurts: 0, sinceHurt: 10 };
  run.timer = setInterval(() => {
    const s = new PlayerState(bot, Object.fromEntries(['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'].map(k => [k, !!bot.controlState[k]])));
    physics.simulatePlayer(s, world); s.apply(bot);
    run.ticks++; run.sinceHurt++;
    if (bodyInLava(bot)) {
      run.lavaTicks++;
      if (run.sinceHurt >= 10) { run.sinceHurt = 0; run.hurts++; bot.health = Math.max(0, bot.health - 1.9); }
    }
  }, 50);
  return run;
}
const RECONNECT = new Vec3(-148.02, -53.82, -516.8);
const IN_LAVA = new Vec3(-146.76, -55.07, -515.53);

test('targetHot reads the cell, its head, its floor, the way to it and the cell past it for lava and fire (note 756)', () => {
  const { targetHot } = require('../src/lava-escape');
  const bot = poolBot({ at: new Vec3(-144.5, -54, -516.5) });
  // Dry ground east of the pool, clear.
  assert.equal(targetHot(bot, new Vec3(-143, -54, -516)), null);
  // The lava cell itself, and a cell whose floor is it.
  assert.deepEqual(targetHot(bot, new Vec3(-147, -55, -516)), { part: 'target', cell: { x: -147, y: -55, z: -516 }, name: 'lava' });
  assert.deepEqual(targetHot(bot, new Vec3(-147, -54, -516), { path: false }), { part: 'target floor', cell: { x: -147, y: -55, z: -516 }, name: 'lava' });
  // Across the lava's open cell from the east bank to the pool's far side: the way crosses it.
  const across = targetHot(bot, new Vec3(-150, -54, -516));
  assert.equal(across.part, 'path floor'); assert.deepEqual(across.cell, { x: -147, y: -55, z: -516 });
  // Onto the water beside the lava from the east: the cell is clear, the cell past it is over the lava.
  assert.equal(targetHot(bot, new Vec3(-146, -54, -516), { path: false }), null);
  assert.equal(targetHot(bot, new Vec3(-146, -54, -516), { past: true }).part, 'past the target');
  // Fire at the head, and a magma floor.
  const hot = poolBot({ at: new Vec3(-144.5, -54, -516.5), set: { '-142,-53,-516': 'fire', '-142,-55,-514': 'magma_block' } });
  assert.equal(targetHot(hot, new Vec3(-142, -54, -516), { path: false }).part, 'target head');
  assert.equal(targetHot(hot, new Vec3(-142, -54, -514), { path: false }).name, 'magma_block');
  // Water holds a body up: lava two under a water cell is no fall.
  assert.equal(targetHot(bot, new Vec3(-150, -54, -518), { from: new Vec3(-150.5, -53.8, -519.5) }), null);
});

test('step_out_of_water does not place its block where the climb onto it runs past into lava; it does where the way is clear (note 756)', async () => {
  const { stepOut } = require('../src/shore');
  // Treading water at (-149, -54, -516) with the lava's open cell two east:
  // the waterline cell east, (-148, -54, -516), has the lava one past it.
  const placed = [];
  const clear = { '-150,-54,-516': 'obsidian', '-149,-54,-517': 'obsidian', '-149,-54,-515': 'obsidian' };
  const bot = poolBot({ at: new Vec3(-148.5, -53.8, -515.5), set: { ...clear } });
  bot.entity.isInWater = true;
  const wasPlace = bot.placeBlock;
  bot.placeBlock = async (ref, face) => { placed.push(ref.position.plus(face)); return wasPlace(ref, face); };
  const goal = {};
  await stepOut(bot, new Task('shore'), goal, () => {});
  assert(!placed.some(c => c.x === -148 && c.z === -516), `no block placed to climb east toward the lava: ${placed.join(' ')}`);
  // With the lava filled in, the same waterline cell is used.
  const placed2 = [];
  const bot2 = poolBot({ at: new Vec3(-148.5, -53.8, -515.5), set: { ...clear, '-147,-55,-516': 'obsidian', '-147,-56,-516': 'deepslate', '-147,-54,-516': 'water' } });
  bot2.entity.isInWater = true;
  const wasPlace2 = bot2.placeBlock;
  bot2.placeBlock = async (ref, face) => { placed2.push(ref.position.plus(face)); return wasPlace2(ref, face); };
  await stepOut(bot2, new Task('shore'), {}, () => {});
  assert(placed2.some(c => c.x === -148 && c.z === -516), `the clear waterline cell is used: ${placed2.join(' ')}`);
});

test('no question is asked while the body is in lava without fire resistance; with it lasting, the question is asked (note 756)', async () => {
  const { decide } = require('../src/decisions');
  const bot = poolBot({ at: IN_LAVA, inLava: true });
  const tree = { a: { description: 'one' }, b: { description: 'two' } };
  await assert.rejects(decide('turn_priority', { bot, tree, state: {} }), err => err.name === 'NeedsSafety' && /lava/.test(err.message));
  await assert.rejects(decide('upkeep', { bot, tree, state: {} }), err => err.name === 'NeedsSafety');
  // Fire resistance with time left: the lava does not hurt, and questions are asked.
  const id = registry.effectsByName.fire_resistance?.id ?? registry.effectsByName.FireResistance?.id;
  // (its time not given by the server counts, body.js fireResistant)
  bot.entity.effects = { [id]: { id, amplifier: 0 } };
  const { mustEscape } = require('../src/lava-escape');
  assert.equal(mustEscape(bot), false, 'fire resistance lasting');
  const resisted = await decide('turn_priority', { bot, tree, state: {} }).catch(err => err);
  assert.notEqual(resisted?.name, 'NeedsSafety');
  // Out of the lava, asked as ever (here the made-up options are refused
  // by the question's own check, past the lava's).
  const dry = poolBot({ at: new Vec3(-143.5, -54, -516.5) });
  dry.entity.onGround = true;
  const r = await decide('turn_priority', { bot: dry, tree, state: {} }).catch(err => err);
  assert.notEqual(r?.name, 'NeedsSafety');
});

test('25597 in the lava at 13.4 health: the survival step takes the way out at once, no question asked, and the body is out before the lava ends it (note 756 replay)', { timeout: 20000 }, async t => {
  const { Survival } = require('../src/survival');
  const decisions = require('../src/decisions');
  const { bodyInLava } = require('../src/terrain');
  const bot = poolBot({ at: IN_LAVA, inLava: false, health: 13.4 });
  const asked = [], was = decisions.decide;
  decisions.decide = async (id, o) => { asked.push(id); return was(id, o); };
  const events = [];
  bot.on('lava_escape', f => events.push(f));
  const run = simulate(bot);
  try {
    assert(bodyInLava(bot), 'in the lava at the frame');
    const survival = new Survival(bot, { dig: async () => {} }, { state: { shelters: [], lastDry: { x: -148, y: -54, z: -517, dimension: 'overworld' } } });
    const began = Date.now();
    let acted = false;
    for (let pass = 0; pass < 4 && bodyInLava(bot) && bot.health > 0; pass++) {
      try { acted = await survival.stepOnce(new Task('survival'), {}, () => {}, () => {}) || acted; }
      catch (err) { if (!['NeedsSafety', 'NeedsAir'].includes(err.name)) throw err; }
    }
    for (let i = 0; i < 10 && bodyInLava(bot); i++) await new Promise(r => setTimeout(r, 50));
    t.diagnostic(`out: ${!bodyInLava(bot)} after ${(Date.now() - began) / 1000} s, ${run.lavaTicks / 20} s in lava, ${run.hurts} hurts, health ${bot.health.toFixed(1)}; took ${events.map(e => `${e.took} (${e.workedOutMs} ms)`).join(', ')}`);
    assert.deepEqual(asked.filter(id => id !== 'turn_priority'), [], `no question asked in the lava: ${asked.join(', ')}`);
    assert(events.length >= 1, 'the rule is logged with its facts');
    assert.equal(events[0].why, 'in lava');
    assert(events[0].took, 'a way was taken');
    assert(events[0].workedOutMs < 1000, `worked out in ${events[0].workedOutMs} ms`);
    assert.deepEqual(events[0].position, { x: -146.8, y: -55.1, z: -515.5 });
    assert(!bodyInLava(bot), `out of the lava: ${bot.entity.position}`);
    assert(bot.health > 0, `alive: ${bot.health}`);
    assert(!acted || acted === true);
  } finally { clearInterval(run.timer); decisions.decide = was; }
});

test('25597 on reconnect in its poured water, lava 2 blocks off: the ground is read again before anything resumes, and the body is walked onto dry ground clear of the lava (note 756 replay)', { timeout: 20000 }, async t => {
  const { settleAfterJoin } = require('../src/lava-escape');
  const { bodyInLava } = require('../src/terrain');
  const bot = poolBot({ at: RECONNECT, health: 15.3 });
  bot.entity.isInWater = true;
  const run = simulate(bot);
  const events = [];
  bot.on('join_survey', f => events.push(f));
  const lines = [];
  try {
    const survival = { state: {}, bot };
    const facts = await settleAfterJoin(bot, survival, { log: l => lines.push(l) });
    for (let i = 0; i < 10 && !bot.entity.onGround; i++) await new Promise(r => setTimeout(r, 50));
    t.diagnostic(lines.join(' | '));
    assert.equal(facts.inWater, true);
    assert.deepEqual(facts.lavaNear.cell, { x: -147, y: -55, z: -516 });
    assert.equal(facts.acted, 'out_of_water_by_lava');
    assert.equal(run.lavaTicks, 0, 'never in the lava');
    assert.equal(facts.out, true, `out onto dry ground: ${bot.entity.position} (${JSON.stringify(facts.exit)})`);
    assert(!bodyInLava(bot));
    assert.equal(survival.state.joinSurvey, facts);
    assert.equal(events.length, 1);
    // The dry cell and the way to it were clear of the lava.
    const { targetHot } = require('../src/lava-escape');
    assert.equal(targetHot(bot, new Vec3(facts.exit.x, facts.exit.y, facts.exit.z), { from: RECONNECT, path: false }), null);
  } finally { clearInterval(run.timer); }
});

test('on joining in lava the way out is taken before anything else; on dry ground far from lava nothing is done (note 756)', { timeout: 20000 }, async () => {
  const { settleAfterJoin } = require('../src/lava-escape');
  const { Survival } = require('../src/survival');
  const bot = poolBot({ at: IN_LAVA, health: 15.3 });
  const run = simulate(bot);
  try {
    const survival = new Survival(bot, { dig: async () => {} }, { state: { shelters: [] } });
    const lines = [];
    const facts = await settleAfterJoin(bot, survival, { log: l => lines.push(l) });
    assert.equal(facts.acted, 'lava_escape');
    assert.match(lines.join('\n'), /\[lava-escape\] in lava on joining at \(-146\.8, -55\.1, -515\.5\), 15\.3 health: took \w+ by the body's safety rule, no question asked/);
    assert.equal(survival.state.lavaEscapes.length, 1);
  } finally { clearInterval(run.timer); }
  const dry = poolBot({ at: new Vec3(-140.5, -54, -508.5) });
  dry.entity.onGround = true;
  const facts = await settleAfterJoin(dry, { state: {} }, { log: () => {} });
  assert.equal(facts.acted, null);
  assert.equal(facts.lavaNear, null);
});

test('the ways out of lava are worked out in a small part of the time they took (note 756)', () => {
  const { Survival } = require('../src/survival');
  const bot = poolBot({ at: IN_LAVA });
  const survival = new Survival(bot, { dig: async () => {} }, { state: { shelters: [], lastDry: { x: -148, y: -54, z: -517, dimension: 'overworld' } } });
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) survival.lavaWays(new Task('lava'), {}, () => {});
  const each = (performance.now() - t0) / 5;
  assert(each < 400, `about ${Math.round(each)} ms a working out`);
  const ways = survival.lavaWays(new Task('lava'), {}, () => {});
  assert.equal(Object.keys(ways)[0], 'to_dry_ground', Object.keys(ways).join(', '));
  assert.match(ways.to_dry_ground.description, /^Onto the dry cell [\d.]+ blocks off by the way through at \(-145, -54, -516\)/);
});
