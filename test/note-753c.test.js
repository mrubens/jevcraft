'use strict';
// Note 753c: after note 753b went live (15:24Z, 2026-09-30), the live
// critic's reports of 15:01Z (item 3) and 15:24Z (items 1, 4 and 7).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const { setAside } = require('../src/progress');

// Stone below y 68 except a pond: water at y 68 in x 12..17, z -11..-4 and
// its source at (13, 70, -5) on a stone step; the bot in the pond.
function pondBot() {
  const water = (x, y, z) => (y === 68 && x >= 12 && x <= 17 && z >= -11 && z <= -4) || (x === 13 && y === 70 && z === -5);
  const blockAt = p => {
    const { x, y, z } = p.floored ? p.floored() : p;
    if (water(x, y, z)) return { name: 'water', position: new Vec3(x, y, z), boundingBox: 'empty', getProperties: () => ({ level: 0 }) };
    const solid = y < 68 || (x === 13 && y === 69 && z === -5);
    return { name: solid ? 'stone' : 'air', position: new Vec3(x, y, z), boundingBox: solid ? 'block' : 'empty' };
  };
  return { registry, game: { dimension: 'overworld', minY: -64, height: 384 }, entity: { position: new Vec3(15.5, 68, -9.5) }, blockAt };
}

test('the cast\'s water source is scooped or filled from a dry place in reach, not from in the water it spreads (25589 mid-243-kd 14:56:44-15:03Z, note 753c)', async () => {
  const { dryReach, toDryReach } = require('../src/portal-cast');
  const bot = pondBot(), src = new Vec3(13, 70, -5);
  const stand = dryReach(bot, src);
  assert(stand && stand !== 'here', 'a dry place, the bot being in the water');
  assert.notEqual(bot.blockAt(stand).name, 'water'); assert.notEqual(bot.blockAt(stand.offset(0, 1, 0)).name, 'water');
  assert.equal(bot.blockAt(stand.offset(0, -1, 0)).boundingBox, 'block');
  assert(stand.offset(0.5, 1.62, 0.5).distanceTo(src.offset(0.5, 0.5, 0.5)) <= 4.2);
  // Before: the walk went for within two blocks of the source, into the pond.
  const walked = [];
  await toDryReach(bot, new Task('cast'), src, async (b, t, g) => { walked.push(g); bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); });
  assert.equal(walked.length, 1); assert.equal(walked[0].constructor.name, 'GoalBlock');
  // No dry place at all: said, not walked into.
  const wet = { ...pondBot(), blockAt: p => ({ name: 'water', position: p, boundingBox: 'empty' }) };
  await assert.rejects(toDryReach(wet, new Task('cast'), src, async () => {}), /No dry place to stand within reach of/);
  // After two tries at one source that came to nothing, the cast's failure there, said.
  const src2 = require('fs').readFileSync(require.resolve('../src/portal-cast'), 'utf8');
  assert.match(src2, /if \(fillFailed\?\.n >= 2\) \{ delete frame\.feederFailedAt; save\(\); throw new Error\(`The water source at \$\{feeder\} running into the frame slot at \$\{p\} could not be stopped/);
});

test('open water under open sky is not underground, and a night mine left behind is over (25589 14:56:27Z on, note 753c)', () => {
  const { openSkyOver } = require('../src/surface');
  const { surfaceObserver } = require('../src/surface');
  const { nightMineOn } = require('../src/survival');
  const bot = pondBot(); bot.entity.position = new Vec3(15.5, 68, -9.5);
  assert.equal(surfaceObserver(bot)(bot.entity.position), false, 'the old reading: a lake\'s top is its surface');
  assert.equal(openSkyOver(bot, bot.entity.position), true);
  // Under a roof, not.
  const roofed = { ...bot, blockAt: p => p.y === 80 ? { name: 'stone', position: p, boundingBox: 'block' } : bot.blockAt(p) };
  assert.equal(openSkyOver(roofed, roofed.entity.position), false);
  // The mine begun three minutes earlier under the rock, 40 blocks off: over.
  const mine = { startedAt: Date.now() - 180000, origin: { x: -20, y: 40, z: -30 }, mined: 3 };
  assert.equal(nightMineOn(bot, mine), false);
  assert.equal(nightMineOn(roofed, { ...mine, origin: { x: 15, y: 68, z: -9 } }), true, 'under a roof, about where it began: the mine goes on');
  assert.equal(nightMineOn(bot, { ...mine, origin: { x: 15, y: 68, z: -9 } }), false, 'under open sky it does not');
});

test('a pool dug toward is held against the deep lava from farther off, and the deep lava says the pool it passes (25589 15:16-15:25Z, note 753c)', async () => {
  const { collectLava, LAVA_DEPTH } = require('../src/obsidian');
  const chat = [];
  const bot = {
    registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {},
    entity: { position: new Vec3(0.5, 45, 0.5) }, inventory: { items: () => [{ name: 'bucket', count: 1 }] }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 45 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < 45 ? 'block' : 'empty' }),
    findBlocks: () => [], pathfinder: { movements: {}, getPathTo: async () => ({ status: 'noPath', path: [] }) }, chat: m => chat.push(m),
  };
  const pool = { kind: 'lava_pool', dimension: 'overworld', x: 120, y: 20, z: 0 };
  const dug = [], actions = { navigate: async () => {}, dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } };
  const fresh = { landmarks: [{ ...pool }] };
  setAside(fresh, 'landmark_trip', 'lava_pool:120,0', 'no nearer', 1800000);
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, fresh, () => {}, actions);
  // Note 763: no flat 96-block reach; 122 blocks across and 25 down is a
  // shorter dig and carry back than the deep lava 101 down and up again.
  assert.deepEqual([dug[0].x, dug[0].y, dug[0].z], [120, 21, 0], 'not held, and still the shorter way: dug toward the pool');
  const far = { ...pool, x: 320 }, farGoal = { landmarks: [far] };
  setAside(farGoal, 'landmark_trip', 'lava_pool:320,0', 'no nearer', 1800000);
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, farGoal, () => {}, actions);
  assert.equal(dug.at(-1).y, LAVA_DEPTH, 'not held: 320 blocks across is a longer dig and carry back than the deep lava');
  assert.match(chat.at(-1), /the pool known at \(320, 20, 0\) is passed: 320 blocks off, a longer dig and carry back \(about \d+ seconds\) than the deep lava's \(about \d+\)/);
  const held = { landmarks: [{ ...pool }], lavaFetch: { way: 'dig', lava: { x: 120, y: 20, z: 0 }, dest: { x: 120, y: 21, z: 0 }, since: Date.now(), carried: 0, dimension: 'overworld', switches: 0 } };
  setAside(held, 'landmark_trip', 'lava_pool:120,0', 'no nearer', 1800000);
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, held, () => {}, actions);
  assert.deepEqual([dug.at(-1).x, dug.at(-1).y, dug.at(-1).z], [120, 21, 0], 'held: dug on toward the pool');
});

test('a lava source just scooped is not stepped into on the walk away (25584 mid-244-gc 15:21:15-19Z, note 753c)', async () => {
  const { navigate, SCOOPED_COST } = require('../src/skills');
  const { goals } = require('mineflayer-pathfinder');
  const bot = { registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(162.5, 19, 95.5) }, food: 20,
    blockAt: p => ({ name: 'stone', position: p, boundingBox: 'block' }), clearControlStates: () => {}, getControlState: () => false, setControlState: () => {} };
  bot._scoopedLava = [{ x: 162, y: 18, z: 96, at: Date.now() }];
  let seen = null; const movements = {};
  bot.pathfinder = { movements, goto: async () => { seen = movements.exclusionAreasStep; }, setGoal: () => {}, isMoving: () => false };
  await navigate(bot, new Task('walk'), new goals.GoalNear(140, 64, 60, 3), { timeoutMs: 2000 }).catch(() => {});
  assert(seen?.length);
  const cost = seen.at(-1);
  assert.equal(cost({ position: new Vec3(162, 18, 96) }), SCOOPED_COST, 'the cell the lava comes back into');
  assert.equal(cost({ position: new Vec3(162, 18, 95) }), SCOOPED_COST, 'and beside it at the pool\'s level');
  assert.equal(cost({ position: new Vec3(162, 19, 95) }), 0, 'the shore a block above is walked');
  // A block with no place (a cell in a chunk not loaded) costs nothing and does not throw (note 1105).
  assert.equal(cost({ name: 'air' }), 0);
  assert.equal(cost(null), 0);
  assert.equal(movements.exclusionAreasStep, undefined);
});

test('at the rung\'s stall, the upkeep\'s mine is not the patch "differently" leaves (25589 15:24:11Z, note 753c)', () => {
  const src = require('fs').readFileSync(require.resolve('../src/work'), 'utf8');
  assert.match(src, /step\?\.action === 'mine' && step\.block && !\(\/\^rung:\/\.test\(String\(stall\.key \|\| ''\)\) && !String\(stall\.key\)\.includes\(step\.block\)\)/);
});
