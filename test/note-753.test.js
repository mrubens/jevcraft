'use strict';
// Note 753: the Overworld portal rung's lava fetch, replayed from the flight
// records of 2026-09-30 (the live critic's report of 11:57Z, items 4 and 5;
// scripts/portal-time.js for the numbers).
// (a) 25581 (mid-243-jd, 11:44-11:51Z) went forty-five blocks toward a pool
// in sight a block a pass, each pass first searching the same eight
// scooping spots at half a second each: about six seconds a block, the
// tunnel's target turning between two cells of the one pool.
// (b) 25592 (mid-237-ad, 11:57:52Z) left a remembered pool at (96, 18, 64),
// 27 blocks off, when the walk to it came no nearer, and dug past it for
// the deep lava at y -56.
// (c) 25581 (11:53:49-11:54:26Z) set out from its frame at y 36 for a pool
// at (21, 67, -4); the walk's search ran out and the leg toward it went down
// a cave to (30, 10, 5), where the pickaxe wore out.
// (d) 25589 (mid-243-je, 11:49Z) reached a pool noted at (102, -29, 25),
// found nothing to scoop there, and with the lake at y -55 in sight the pool
// stayed on the books.
// (e) 25592 (11:55:40-51Z) chose craft_buckets and eleven seconds later
// cast_at_lava, the second ask saying nothing of why it came.
// (f) "Before the diamond sword, I'll leave the diamond sword for later."
// (g) The progress audit's dug/laid counted a frame taken mid-click as a
// stack dropped and picked back up: 25581 read about 3,400 dug and 3,400
// laid in fifteen minutes that dug a few hundred.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const { setAside } = require('../src/progress');

const LAVA = registry.blocksByName.lava.id;
const lavaBlock = p => ({ name: 'lava', position: p.clone(), boundingBox: 'empty', getProperties: () => ({ level: 0 }) });

// A pool at pool level on a stone floor (the obsidian tests' shape), the
// bot `east` blocks east of it; every route search from the bot runs out of
// time, as 25581's did across forty-five blocks.
function poolWorld({ east = 30 } = {}) {
  const blocks = new Map();
  const set = (x, y, z, name, extra = {}) => blocks.set(`${x},${y},${z}`, { name, position: new Vec3(x, y, z), boundingBox: ['air', 'lava'].includes(name) ? 'empty' : 'block', ...extra });
  for (let x = -3; x <= 5; x++) for (let z = -3; z <= 5; z++) { set(x, 9, z, 'stone'); set(x, 10, z, 'stone'); }
  for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) set(x, 10, z, 'lava', { getProperties: () => ({ level: 0 }) });
  const chat = [];
  let searches = 0;
  const bot = {
    registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {},
    entity: { position: new Vec3(east + 0.5, 11, 1.5) }, inventory: { items: () => [{ name: 'bucket', count: 1 }] }, world: { raycast: () => null },
    blockAt: p => blocks.get(`${p.x},${p.y},${p.z}`) || { name: 'air', position: p.clone(), boundingBox: 'empty' },
    findBlocks: ({ matching, maxDistance, count, point = bot.entity.position, useExtraInfo = () => true }) => [...blocks.values()]
      .filter(b => registry.blocksByName[b.name]?.id === matching && b.position.distanceTo(point) <= maxDistance && useExtraInfo(b))
      .sort((a, b) => a.position.distanceTo(point) - b.position.distanceTo(point)).slice(0, count).map(b => b.position.clone()),
    pathfinder: { movements: {}, getPathTo: async () => { searches++; return { status: 'timeout', path: [] }; } },
    chat: m => chat.push(m),
  };
  return { bot, chat, searches: () => searches };
}

test('the scooping spots searched from about here are not searched again every block of the dig toward them (25581 mid-243-jd, note 753)', async () => {
  const { collectLava } = require('../src/obsidian');
  const w = poolWorld();
  const goal = {};
  // The walk from here was tried and came no nearer (note 546): set aside.
  const area = p => ({ x: Math.floor(p.x / 16) * 16, y: Math.floor(p.y / 16) * 16, z: Math.floor(p.z / 16) * 16 });
  setAside(goal, 'lava_walk', area(w.bot.entity.position), 'the walk to the lava came no nearer', 600000);
  const dug = [];
  // Each pass digs one step west, as tunnelStep does.
  const actions = { navigate: async () => {}, dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); w.bot.entity.position = w.bot.entity.position.offset(-1, 0, 0); } };
  const perPass = [];
  for (let i = 0; i < 8; i++) {
    const before = w.searches();
    await collectLava(w.bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, goal, () => {}, actions);
    perPass.push(w.searches() - before);
  }
  assert.equal(dug.length, 8, 'a step of the dig each pass');
  assert(perPass[0] > 0, 'searched on the first pass');
  // Before: every pass searched as many as the first (the recorded four
  // seconds a block). After: only when the bot has moved more than six
  // blocks from where it last searched.
  assert.deepEqual(perPass.slice(1, 7), [0, 0, 0, 0, 0, 0], `searches per pass: ${perPass}`);
  assert(perPass[7] > 0, `searched again seven blocks on: ${perPass}`);
  const before = perPass[0] * 8, after = perPass.reduce((a, b) => a + b, 0);
  assert(after <= before / 3, `searches over eight passes: ${after}, against ${before} before`);
  // The dig is held and said once, with its distance.
  assert.equal(goal.lavaFetch.way, 'dig');
  assert.equal(w.chat.filter(m => /^Digging toward the lava at/.test(m)).length, 1, w.chat.join(' | '));
  assert.match(w.chat[0], /blocks off, about \d+ seconds/);
});

test('a remembered pool whose walk came no nearer is dug toward, not passed for the deep lava (25592 mid-237-ad, note 753)', async () => {
  const { collectLava, LAVA_DEPTH } = require('../src/obsidian');
  const chat = [];
  const bot = {
    registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {},
    entity: { position: new Vec3(91.5, 45, 64.5) }, inventory: { items: () => [{ name: 'bucket', count: 10 }] }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 45 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < 45 ? 'block' : 'empty' }),
    findBlocks: () => [], pathfinder: { movements: {}, getPathTo: async () => ({ status: 'noPath', path: [] }) }, chat: m => chat.push(m),
  };
  const pool = { kind: 'lava_pool', dimension: 'overworld', x: 96, y: 18, z: 64 };
  const goal = { landmarks: [pool] };
  // What the walk at 11:56:47-11:57:52Z left: the trip set aside, the walk no nearer.
  setAside(goal, 'landmark_trip', 'lava_pool:96,64', 'the walk there came no nearer than before (27 blocks off to 27)', 1800000);
  const dug = [];
  const actions = { navigate: async () => { throw new Error('should not walk'); }, dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } };
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, goal, () => {}, actions);
  assert.equal(dug.length, 1);
  assert.notEqual(dug[0].y, LAVA_DEPTH, `before: dug for the deep lava at ${dug[0]}`);
  assert.deepEqual([dug[0].x, dug[0].y, dug[0].z], [96, 19, 64], 'the staircase to the block over the pool');
  assert.match(chat[0], /^Digging toward the lava at \(96, 18, 64\), 5 blocks off, 27 blocks down, about \d+ (seconds|minutes), a pool known there whose walk did not get there\./);
  // A pool farther than the deep lava is not taken over it.
  const far = { landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 180, y: 18, z: 64 }] };
  dug.length = 0;
  await collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, far, () => {}, { ...actions, navigate: async () => {} });
  assert.equal(dug.at(-1)?.y ?? LAVA_DEPTH, LAVA_DEPTH);
});

test('the lava dug toward is held while it is there: a cell of another pool only nominally nearer does not turn the dig (25581, note 753)', async () => {
  const { collectLava } = require('../src/obsidian');
  // Two pools, floating in open air (no shore to scoop from, so the dig
  // goes to the lava itself): A at (16, 67, -11), B at (40, 67, -11).
  const cells = [new Vec3(16, 67, -11), new Vec3(40, 67, -11)];
  const bot = {
    registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {},
    entity: { position: new Vec3(27.5, 68, -11.5) }, inventory: { items: () => [{ name: 'bucket', count: 1 }] }, world: { raycast: () => null },
    blockAt: p => cells.some(c => c.equals(p.floored())) ? lavaBlock(p) : { name: 'air', position: p.clone(), boundingBox: 'empty' },
    findBlocks: ({ matching, maxDistance, count, useExtraInfo = () => true }) => matching !== LAVA ? [] : cells.filter(c => c.distanceTo(bot.entity.position) <= maxDistance && useExtraInfo(lavaBlock(c))).slice(0, count).map(c => c.clone()),
    pathfinder: { movements: {}, getPathTo: async () => ({ status: 'noPath', path: [] }) }, chat: () => {},
  };
  const goal = {};
  const dug = [];
  const actions = { navigate: async () => {}, dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest.clone()); } };
  const pass = () => collectLava(bot, new Task('lava'), { action: 'fill_bucket', item: 'lava_bucket', count: 1 }, goal, () => {}, actions);
  await pass();
  assert.equal(dug[0].x, 16, 'A, the nearer, first');
  // A step east: B is now a block nearer than A, not a third nearer.
  bot.entity.position = new Vec3(28.6, 68, -11.5);
  await pass();
  assert.equal(dug[1].x, 16, `before: turned to B at ${dug[1]}`);
  // Well past: B is more than a third nearer, and is taken.
  bot.entity.position = new Vec3(36.5, 68, -11.5);
  await pass();
  assert.equal(dug[2].x, 40);
  assert.equal(goal.lavaFetch.switches, 1);
});

test('a leg of the way toward a place at a known height does not end in a cave under it (25581, 11:53:49-11:54:26Z, note 753)', async () => {
  const { legGoal, goToLandmark } = require('../src/exploration');
  const g = legGoal(28, -1, 4, 67, 36);
  assert.equal(g.isEnd({ x: 28, y: 10, z: -1 }), false, 'y 10, under the pool at y 67, where the leg ended');
  assert.equal(g.isEnd({ x: 28, y: 60, z: -1 }), true);
  assert(g.heuristic({ x: 28, y: 10, z: -1 }) > g.heuristic({ x: 28, y: 60, z: -1 }));
  // Without a height, the old leg.
  assert.equal(legGoal(28, -1, 4, undefined, 36).isEnd({ x: 28, y: 10, z: -1 }), true);
  // goToLandmark's own leg, after a walk whose search ran out.
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(54.5, 36, 13.5) } };
  const goal = { landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 21, y: 67, z: -4 }] };
  const tried = [];
  const navigate = async (b, t, g2) => { tried.push(g2); if (tried.length === 1) throw new Error('Took to long to decide path to goal!'); };
  const heard = [];
  await goToLandmark(bot, new Task('lava'), goal, () => {}, ['lava_pool'], { navigate, onWalk: l => heard.push(l) });
  assert.equal(tried.length, 2, 'the walk, then a leg');
  assert.equal(tried[1].isEnd({ x: 30, y: 10, z: 5 }), false);
  assert.equal(heard.length, 1, 'the walk taken up is told to the caller');
});

test('a pool arrived at with no lava of its own is spent, whatever other lava is in sight (25589 mid-243-je, note 753)', () => {
  const { ownLava } = require('../src/obsidian');
  let lava = [new Vec3(94, -55, 54)];
  const bot = {
    registry, entity: { position: new Vec3(103.5, -30, 19.5) },
    blockAt: p => lava.some(c => c.equals(p.floored())) ? lavaBlock(p) : { name: 'air', position: p.clone(), boundingBox: 'empty' },
    findBlocks: ({ matching, useExtraInfo = () => true }) => matching !== LAVA ? [] : lava.filter(c => useExtraInfo(lavaBlock(c))).map(c => c.clone()),
  };
  assert.equal(ownLava(bot, { x: 102, y: -29, z: 25 }), false, 'only the lake 26 blocks down in sight');
  lava = [new Vec3(103, -29, 27)];
  assert.equal(ownLava(bot, { x: 102, y: -29, z: 25 }), true);
});

test('the nether_first chat says what it does, not "Before the diamond sword, I\'ll leave the diamond sword for later" (25592, note 753)', async () => {
  // The line is built from the option (strategy.js netherFirst): its chat.
  const src = require('fs').readFileSync(require.resolve('../src/strategy'), 'utf8');
  assert.match(src, /chat: `I'll leave the \$\{left\.map\(label\)\.join\(' and the '\)\} for later and go for the Nether now\.`/);
  assert.match(src, /bot\.chat\?\.\(options\[choice\]\.chat \? options\[choice\]\.chat :/);
});

test('the progress audit counts no blocks dug or laid for a stack that leaves the record and comes back within seconds (25581, 11:43-11:58Z, note 753)', () => {
  const { steady } = require('../scripts/trials/progress-audit');
  const t0 = Date.parse('2026-09-30T11:44:00Z');
  // The cobblestone carried, as the frames read it (10 s apart; 11:44:08 to 11:47:00).
  const raw = [266, 128, 269, 128, 275, 277, 280, 282, 128, 283, 129, 288, 129, 294, 128, 296, 129, 302, 128, 308];
  const times = raw.map((_, i) => t0 + i * 10000);
  const count = v => { let dug = 0, laid = 0; for (let i = 1; i < v.length; i++) { const d = v[i] - v[i - 1]; if (d > 0) dug += d; else laid -= d; } return { dug, laid }; };
  const before = count(raw), after = count(steady(raw, times));
  assert(before.dug > 1000 && before.laid > 1000, JSON.stringify(before));
  assert.deepEqual(after, { dug: 308 - 266, laid: 0 });
  // A real dig and a real pillar are counted as before.
  assert.deepEqual(count(steady([100, 110, 120, 60, 40], [0, 10000, 20000, 30000, 40000])), { dug: 20, laid: 80 });
});
