'use strict';
// Note 748: the Overworld portal rung's biggest time sinks, measured across
// the flight records since 2026-09-29T23:00Z (scripts/portal-time.js).
// (a) A lava fetch for a cast frame left a deep dig already real steps
// into it for a known pool only nominally shorter (both `carry(deep)` and
// the pool's own carry are recomputed from wherever the bot now stands, so
// noise flips the pick): 25581 (mid-243-if) left a dig 55 steps in at
// (93, -54, 54) for a pool at (104, -33, 25) on 2026-09-30 05:37:56Z,
// stalled 15-16 blocks short of it for 89 seconds, and came back to the
// same dig, about eleven minutes for one bucket. A dig with 8 or more
// steps in it now needs a pool to beat its carry by a third, not by any
// margin, before it is left (src/obsidian.js collectLava).
// (b) In a lava sea, back_the_way_came was the one way offered when no
// water, dry cell or pillar was within six blocks, even where its own cost
// said "death before it is out"; a straight rise to the lava's own top was
// never said beside it to weigh. 25583 (mid-242-re, 2026-09-30 03:21:34Z)
// and 25591 (mid-242-qh, 2026-09-30 04:27:56Z) each chose back_the_way_came
// 13-14 blocks off after a fall and died in four to five seconds.
// swim_up is now said with its own honest cost whenever no closer dry
// footing is already known, beside back_the_way_came, not only where
// nothing else at all is offered (src/survival.js lavaWays).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');

// --- (a) collectLava: a dig with real steps in it needs a real margin ---

function frameBot() {
  // No lava anywhere in sight, flat rock everywhere: poolSurface finds
  // nothing, so both the frame's own check and the no-diggable-surface
  // fallback are exercised.
  return {
    registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {},
    entity: { position: new Vec3(0.5, -56, 0.5) }, inventory: { items: () => [{ name: 'bucket', count: 2 }] }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < -56 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < -56 ? 'block' : 'empty' }),
    findBlocks: () => [], pathfinder: { movements: {}, getPathTo: async () => ({ status: 'noPath', path: [] }) },
  };
}
// A pool about 15 blocks off (past collectLava's own 12-block "arrived"
// cut, so a real walk is measured, not an instant arrival), carried on to
// a frame 50 blocks off: about 14.6 s in all. The deep lava, 24 blocks off
// at the bot's own depth and on to the same frame, costs about 18.4 s: the
// pool beats it, but not by a third.
function lavaCase() {
  const bot = frameBot();
  const frame = { origin: { x: 0, y: -56, z: 50 }, cast: true, axis: 'x', blocks: [] };
  const goal = { portalFrame: frame, landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 15, y: -56, z: 5 }] };
  const walked = [], dug = [];
  const actions = { navigate: async (b, t, g) => { walked.push(g); }, dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } };
  return { bot, goal, walked, dug, actions };
}

test('a lava fetch takes a pool only nominally shorter than the deep lava when no dig is under way (note 748)', async () => {
  const { collectLava } = require('../src/obsidian');
  const { bot, goal, walked, dug, actions } = lavaCase();
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, goal, () => {}, actions);
  assert.equal(dug.length, 0, `not dug toward: ${dug.map(String)}`);
  assert.equal(walked.length, 1, 'the pool was walked to');
});

test('the same pool is left for the deep lava once the dig has 8 or more steps already in it, so noise does not flip a committed dig back and forth (25581 mid-243-if, note 748)', async () => {
  const { collectLava } = require('../src/obsidian');
  const { bot, goal, walked, dug, actions } = lavaCase();
  goal.miningSites = { 'overworld:lava': { steps: 10, entrance: { x: 0, y: -56, z: 0 }, visited: {}, dimension: 'overworld', resource: 'lava' } };
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, goal, () => {}, actions);
  assert.equal(walked.length, 0, `not walked to the pool: ${walked.map(String)}`);
  assert.equal(dug.length, 1, 'dug toward the deep lava instead');
});

test('under 8 steps in, the dig is still left for the shorter pool (no false floor on a fresh dig, note 748)', async () => {
  const { collectLava } = require('../src/obsidian');
  const { bot, goal, walked, dug, actions } = lavaCase();
  goal.miningSites = { 'overworld:lava': { steps: 3, entrance: { x: 0, y: -56, z: 0 }, visited: {}, dimension: 'overworld', resource: 'lava' } };
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, goal, () => {}, actions);
  assert.equal(dug.length, 0, `not dug toward: ${dug.map(String)}`);
  assert.equal(walked.length, 1, 'still walked to the pool');
});

// --- (b) lavaWays: swim_up said beside back_the_way_came, with its cost ---

function seaBot({ health = 15 } = {}) {
  // Open above y 31 everywhere (no floor anywhere: no dry cell, no water,
  // and no scaffold carried, so neither to_dry_ground, to_water nor
  // pillar_out is on offer), lava at and below y 31: mid-243-af-nether-1's
  // shape (note 592), simplified.
  return Object.assign(new EventEmitter(), {
    game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health, food: 20, entities: {},
    entity: { position: new Vec3(0.5, 27, 0.5), onGround: false }, inventory: { items: () => [], slots: {} },
    // The netherrack the last dry footing stood on, far off (note 754b:
    // a footing with nothing under it is no way out).
    blockAt: p => p.x === -30 && p.y === 41 && p.z === -60 ? { position: p, name: 'netherrack', boundingBox: 'block' } : ({ position: p, name: p.y <= 31 ? 'lava' : 'air', boundingBox: 'empty' }),
    setControlState: () => {}, getControlState: () => false, lookAt: async () => {},
  });
}

test('in a lava sea with no dry cell, water or scaffold in reach, swim_up is said beside back_the_way_came with its own honest cost, not only where nothing else is offered (25583, 25591, note 748)', () => {
  const { Survival } = require('../src/survival');
  const bot = seaBot({ health: 15 });
  const survival = new Survival(bot, {}, { state: { shelters: [], lastDry: { x: -30, y: 42, z: -60, dimension: 'the_nether' } } });
  const ways = survival.lavaWays(new Task('lava'), {}, () => {});
  assert.equal(ways.to_water, undefined); assert.equal(ways.to_dry_ground, undefined); assert.equal(ways.pillar_out, undefined);
  assert(ways.back_the_way_came, 'the last dry footing is still offered');
  assert(ways.swim_up, 'swim_up is offered beside it, not suppressed by back_the_way_came existing');
  assert.match(ways.swim_up.description, /Swim straight up to the lava's own top \(y 32\)/);
  assert.match(ways.swim_up.description, /about [\d.]+ seconds? to reach it/);
  assert.match(ways.swim_up.description, /health in the lava/);
  // The old order's default (no client, no answer) still takes the last
  // dry footing first, as before: swim_up is a new fact for Jev to weigh,
  // not a new default.
  assert.equal(Object.keys(ways)[0], 'back_the_way_came');
});

test('a body already at the lava\'s top prices swimming up at about half a second, not the seconds a real rise would take (note 748)', () => {
  const { Survival } = require('../src/survival');
  const bot = seaBot({ health: 15 });
  bot.entity.position = new Vec3(0.5, 31.9, 0.5); // already at the sea's top
  const survival = new Survival(bot, {}, { state: { shelters: [] } }); // no lastDry: back_the_way_came is not offered either
  const ways = survival.lavaWays(new Task('lava'), {}, () => {});
  assert.equal(ways.back_the_way_came, undefined, 'no last dry footing known');
  assert(ways.swim_up, 'swim_up is still offered');
  assert.match(ways.swim_up.description, /about 0\.5 seconds? to reach it/);
});

test('with a dry cell within reach, swim_up is not offered: the known way out is enough (note 748)', () => {
  const { Survival } = require('../src/survival');
  const bot = seaBot({ health: 15 });
  // A dry floor two blocks over at the body's own depth, within lavaExit's
  // six-block, five-up search.
  const lavaBlock = p => p.y <= 31;
  bot.blockAt = p => {
    if (p.x === 2 && p.y === 26 && p.z === 0) return { position: p, name: 'netherrack', boundingBox: 'block' };
    if (p.x === 2 && (p.y === 27 || p.y === 28) && p.z === 0) return { position: p, name: 'air', boundingBox: 'empty' };
    return { position: p, name: lavaBlock(p) ? 'lava' : 'air', boundingBox: 'empty' };
  };
  const survival = new Survival(bot, {}, { state: { shelters: [] } });
  const ways = survival.lavaWays(new Task('lava'), {}, () => {});
  assert(ways.to_dry_ground, `a dry cell should be found: ${JSON.stringify(Object.keys(ways))}`);
  assert.equal(ways.swim_up, undefined, 'not offered once a real way out is known');
});
