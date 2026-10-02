'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { navigate, Task } = require('../src/skills');

// A bot whose pathfinder never arrives, moved by `step` every 100 ms.
const walker = (start, step) => {
  const bot = Object.assign(new EventEmitter(), { entity: { position: start.clone(), isInWater: false }, game: { dimension: 'overworld', gameMode: 'survival' }, oxygenLevel: 20,
    blockAt: () => ({ name: 'air', boundingBox: 'empty' }), clearControlStates() {}, getControlState() { return false; }, stopDigging() {} });
  let timer;
  bot.pathfinder = { movements: {}, setGoal: g => { if (!g) clearInterval(timer); }, goto: () => new Promise(() => { let i = 0; timer = setInterval(() => step(bot, i++), 100); }) };
  return bot;
};

test('bouncing about a shaft is no progress toward the goal: new cells alone do not keep a walk going', async () => {
  // first-days-206: a retreat bounced up and down its own shaft for fourteen seconds, every bounce a new cell, and was shot from 10.8 to 4.8.
  const cells = [];
  for (let y = 37; y <= 45; y++) for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) cells.push([x, (y - 37) % 2 ? 82 - y : y, z]);
  const bot = walker(new Vec3(0.5, 38, 0.5), (b, i) => { const [x, y, z] = cells[i % cells.length]; b.entity.position = new Vec3(x + 0.5, y, z + 0.5); });
  const started = Date.now();
  await assert.rejects(navigate(bot, new Task('run'), new goals.GoalBlock(30, 60, 30), { timeoutMs: 8000, stallMs: 1500 }), /without reaching new ground/);
  assert(Date.now() - started < 4000, `stalled in ${Date.now() - started} ms, not at the timeout`);
});

test('a walk toward a goal with no height that keeps getting nearer along the ground is progress, not a stall every few seconds (mid-243-ch, note 652)', async () => {
  // 25581's fortress legs (GoalNearXZ) walked straight north at their ends, 85 to 24 blocks off, each eight seconds of it called a stall.
  let on = true;
  const bot = walker(new Vec3(0.5, 64, 0.5), () => {});
  bot.pathfinder.setGoal = g => { if (!g) on = false; };
  bot.pathfinder.goto = () => new Promise(() => { let i = 0; bot.emit('path_update', { status: 'partial', path: [{ x: 0.5, y: 64, z: 0.5 }] });
    const t = setInterval(() => { if (!on) return clearInterval(t); bot.entity.position = new Vec3(0.5 + i++ * 0.5, 64, 0.5); }, 100); });
  await assert.rejects(navigate(bot, new Task('walk'), new goals.GoalNearXZ(200, 0, 6), { timeoutMs: 3000, stallMs: 1000 }), /navigation timed out/);
});

test('a route walked node by node is progress though it leads away from the goal first: a detour round a ravine is not broken off half-way (note 652)', async () => {
  // The route goes 20 blocks east, away from a goal to the west, then comes back past the start; searched once and walked.
  const path = [];
  for (let x = 0; x <= 20; x++) path.push({ x: x + 0.5, y: 64, z: 0.5 });
  for (let z = 1; z <= 10; z++) path.push({ x: 20.5, y: 64, z: z + 0.5 });
  for (let x = 19; x >= -30; x--) path.push({ x: x + 0.5, y: 64, z: 10.5 });
  let on = true;
  const bot = walker(new Vec3(0.5, 64, 0.5), () => {});
  bot.pathfinder.setGoal = g => { if (!g) on = false; };
  bot.pathfinder.goto = () => new Promise(resolve => { bot.emit('path_update', { status: 'success', path }); let i = 0;
    const t = setInterval(() => { if (!on) return clearInterval(t); const n = path[Math.min(i, path.length - 1)]; bot.entity.position = new Vec3(n.x, n.y, n.z); i++; if (i >= path.length) { clearInterval(t); resolve(); } }, 100); });
  // The walk arrives: no stall though its first seconds take it away from the goal.
  await navigate(bot, new Task('walk'), new goals.GoalNearXZ(-30, 10, 2), { timeoutMs: 15000, stallMs: 1500 });
  assert.equal(Math.round(bot.entity.position.x - 0.5), -30);
});

test('in the Nether a leg toward the portal back that comes no nearer than before gives way to a crossing straight at it', async () => {
  // mid-211-c: its legs on foot toward the portal 250 blocks off made no ground, and nothing else but a staircase was tried (note 241).
  const { walkToKnownPortal } = require('../src/work');
  const laid = new Set();
  let look = null;
  const bot = Object.assign(new EventEmitter(), { entity: { position: new Vec3(0.5, 39, 0.5), isInWater: false }, game: { dimension: 'the_nether', gameMode: 'survival' }, oxygenLevel: 20,
    health: 20, food: 20, entities: {}, world: { raycast: () => null }, inventory: { items: () => [{ name: 'netherrack', count: 64, type: 1 }] },
    blockAt: p => {
      const name = laid.has(`${p}`) ? 'netherrack' : p.y <= 31 ? 'lava' : p.y === 38 && p.x <= 32 ? 'netherrack' : 'air';
      return { name, boundingBox: name === 'netherrack' ? 'block' : 'empty', diggable: true, position: p };
    },
    clearControlStates() {}, getControlState() { return false; }, stopDigging() {}, equip: async () => {}, lookAt: async p => { look = p; },
    placeBlock: async (ref, face) => { laid.add(`${ref.position.plus(face)}`); },
    setControlState: (name, on) => { if (name === 'forward' && on && look) bot.entity.position = new Vec3(Math.floor(look.x) + 0.5, 39, Math.floor(look.z) + 0.5); } });
  // The walk goes thirty blocks in; earlier walks had come within two hundred.
  bot.pathfinder = { movements: {}, setGoal() {}, goto: async () => { bot.entity.position = new Vec3(30.5, 39, 0.5); } };
  const goal = { survival: {}, portals: [{ x: 250, y: 83, z: 0, dimension: 'nether' }], portalApproach: { '250,83,0': { best: 200 } } };
  assert.equal(await walkToKnownPortal(bot, new Task('back'), goal, () => {}, 'nether'), true);
  assert.equal(goal.step.action, 'cross_toward');
  assert.equal(laid.size, 30, 'thirty blocks laid over the lava sea, x 33 to 62');
  assert.equal(bot.entity.position.x, 62.5);
  assert.equal(Math.round(goal.portalApproach['250,83,0'].best), 188, 'a new nearest approach to the portal');
});

test('a walk that keeps getting nearer is progress, however long', async () => {
  const bot = walker(new Vec3(0.5, 64, 0.5), (b, i) => { b.entity.position = new Vec3(0.5 + i * 0.5, 64, 0.5); });
  await assert.rejects(navigate(bot, new Task('walk'), new goals.GoalBlock(200, 64, 0), { timeoutMs: 3000, stallMs: 1000 }), /navigation timed out/);
});

test('a crossing that ends no nearer rests from here toward that target, and is not offered again meanwhile', async () => {
  // mid-235-e took the crossing forty times in a few minutes on a lava-sea island, each run back within a second with nothing laid (2026-09-27).
  const { crossToward, netherAnswers } = require('../src/nether-travel');
  const bot = Object.assign(new EventEmitter(), { entity: { position: new Vec3(0.5, 39, 0.5), isInWater: false }, game: { dimension: 'the_nether', gameMode: 'survival' }, oxygenLevel: 20,
    health: 20, food: 20, entities: {}, world: { raycast: () => null }, inventory: { items: () => [{ name: 'netherrack', count: 64, type: 1 }] },
    blockAt: p => { const name = p.y <= 31 ? 'lava' : p.y === 38 && p.x <= 0 ? 'netherrack' : 'air'; return { name, boundingBox: name === 'netherrack' ? 'block' : 'empty', diggable: true, position: p }; },
    clearControlStates() {}, getControlState() { return false; }, setControlState() {}, stopDigging() {}, equip: async () => {}, lookAt: async () => {},
    // The block never lands.
    placeBlock: async () => {} });
  const goal = { survival: {}, fortressSearch: { target: { x: 60, y: 39, z: 0 } } };
  const target = new Vec3(60, 39, 0);
  assert(netherAnswers(bot, new Task('stall'), goal, () => {}).cross_toward, 'offered before it is tried');
  assert.equal((await crossToward(bot, new Task('cross'), goal, () => {}, target)).tried, true);
  assert.equal((await crossToward(bot, new Task('cross'), goal, () => {}, target)).tried, false, 'resting: not run again at once');
  assert.equal(netherAnswers(bot, new Task('stall'), goal, () => {}).cross_toward, undefined, 'nor offered');
});

test('a round of gathering blocks that gains none counts: twice in ten minutes and the reserve rests, said on the option', async () => {
  // mid-202-l chose "mine netherrack" sixteen times in seven minutes over the lava sea and never carried one (2026-09-27).
  const { gatherBlocks } = require('../src/work');
  const { isSetAside } = require('../src/progress');
  const bot = { game: { dimension: 'the_nether' }, inventory: { items: () => [] } };
  const goal = { kind: 'win' };
  let asked = 0;
  const acquire = async () => { asked++; };
  await gatherBlocks(bot, new Task('blocks'), goal, () => {}, { acquire });
  assert.equal(isSetAside(goal, 'block_reserve', 'gather'), false, 'once is not yet');
  await gatherBlocks(bot, new Task('blocks'), goal, () => {}, { acquire });
  assert.equal(asked, 2);
  assert.equal(isSetAside(goal, 'block_reserve', 'gather'), true, 'twice with none gained rests it');
  assert.deepEqual(goal.blockRounds.map(r => r.gained), [0, 0]);
});

test('a round of gathering blocks broken off by a threat is still a round, with what it gained, and rests the reserve as any two empty ones', async () => {
  // mid-227-r: a blaze's fireballs broke every round on a basalt bridge before it was counted, and upkeep asked again every eight seconds until one threw it off (2026-09-27).
  const { gatherBlocks } = require('../src/work');
  const { isSetAside } = require('../src/progress');
  const bot = { game: { dimension: 'the_nether' }, inventory: { items: () => [] } };
  const goal = { kind: 'win' };
  const acquire = async () => { throw Object.assign(new Error('a threat'), { name: 'NeedsSafety' }); };
  await assert.rejects(gatherBlocks(bot, new Task('blocks'), goal, () => {}, { acquire }), { name: 'NeedsSafety' });
  assert.equal(isSetAside(goal, 'block_reserve', 'gather'), false, 'once is not yet');
  await assert.rejects(gatherBlocks(bot, new Task('blocks'), goal, () => {}, { acquire }), { name: 'NeedsSafety' });
  assert.deepEqual(goal.blockRounds.map(r => r.gained), [0, 0]);
  assert.equal(isSetAside(goal, 'block_reserve', 'gather'), true, 'twice with none gained rests it');
});

test('the portal way held says its pace and where its minutes went', () => {
  // mid-235-l was told "2 obsidian in 40 minutes, about 20 a block", the minutes mostly climbs and a pickaxe (2026-09-27).
  const { methodSoFar } = require('../src/work');
  const { Vec3 } = require('vec3');
  const frame = { blocks: Array.from({ length: 10 }, (_, i) => ({ x: i, y: 64, z: 0 })) };
  const bot = { inventory: { items: () => [] }, blockAt: p => ({ name: p.x < 2 ? 'obsidian' : 'air', position: p }) };
  const method = { kind: 'cast', activeMs: 40 * 60000, from: { obsidian: 0, diamonds: 0 },
    byStep: { 'ascend to surface': 14 * 60000, 'fill bucket': 9 * 60000, 'cast: pour': 6 * 60000, 'mine': 11 * 60000 } };
  const says = methodSoFar(bot, { portalFrame: frame }, method, null);
  assert.match(says, /Its minutes went to: ascend to surface 14, mine 11, fill bucket 9, cast: pour 6\./);
  assert.match(says, /2 obsidian in 40 minutes \(about 20 a block\), the 8 still to come would take about 160 minutes more/);
});

test('blocks chosen for the reserve are gathered round after round until the reserve is met', async () => {
  // A mining round ends after one block of stone: sixteen upkeep questions for a reserve of sixteen (the Fable advice, 2026-09-27).
  const { gatherBlocks } = require('../src/work');
  const { BLOCK_RESERVE } = require('../src/inventory-tidy');
  let n = 0;
  const bot = { game: { dimension: 'the_nether' }, inventory: { items: () => (n ? [{ name: 'netherrack', count: n }] : []) } };
  const goal = { kind: 'win' };
  let rounds = 0;
  await gatherBlocks(bot, new Task('blocks'), goal, () => {}, { acquire: async () => { rounds++; n++; } });
  assert.equal(n, BLOCK_RESERVE, 'the reserve met in one choice');
  assert.equal(rounds, BLOCK_RESERVE);
});

test('the portal back in view, the walk in failed and the staircase resting: the way is Jev\'s with the climb among it, asked once from a place, not the staircase met again (mid-208-k-nether-3, note 556)', async () => {
  // mid-208-k-nether-3 stood on its own span over the lava sea at (-15, 35, 14), the portal back at (10, 73, -13) in view: the
  // walk in failed, the staircase was set aside ("no safe step ... (no floor 6)"), and each pass went into it again, the rest
  // thrown to the stall question seven times in a minute with only a detour and a crossing offered.
  const { returnFromNether } = require('../src/work');
  const { setAside } = require('../src/progress');
  const registry = require('minecraft-data')('26.1');
  const portal = new Vec3(10, 73, -13);
  const bot = Object.assign(new EventEmitter(), { registry, entity: { position: new Vec3(-14.5, 35, 14.5), isInWater: false }, game: { dimension: 'the_nether', gameMode: 'survival' }, oxygenLevel: 20,
    health: 8.6, food: 17, entities: {}, world: { raycast: () => null },
    inventory: { items: () => [{ name: 'netherrack', count: 64, type: 1 }, { name: 'iron_pickaxe', count: 1, type: registry.itemsByName.iron_pickaxe.id }] },
    findBlocks: ({ matching }) => matching.includes(registry.blocksByName.nether_portal.id) ? [portal] : [],
    blockAt: p => {
      const name = p.equals(portal) ? 'nether_portal' : p.y <= 31 ? 'lava' : p.y === 34 && p.z === 14 && p.x >= -40 && p.x <= -15 ? 'netherrack' : 'air';
      return { name, boundingBox: name === 'netherrack' ? 'block' : 'empty', diggable: true, position: p };
    },
    clearControlStates() {}, getControlState() { return false; }, setControlState() {}, stopDigging() {} });
  bot.pathfinder = { movements: {}, setGoal() {}, isMoving: () => false, goto: async () => { throw Object.assign(new Error('No path'), { name: 'NoPath' }); } };
  const task = new Task('back'), asked = [], picks = ['wait_rest'];
  task.opportunityClient = { systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } };
  const goal = { survival: {} };
  setAside(goal, 'staircase', { x: 8, y: 72, z: -16 }, 'no safe step toward it from (-15, 35, 14) (no floor to step onto (a gap, for a span or a pillar): 6 of the steps nearer)', 600000);
  // The crossing at this height was tried from here and rests.
  setAside(goal, 'crossing', '-2,1>10,-13', 'it laid nothing nearer', 300000);
  await assert.rejects(returnFromNether(bot, task, goal, () => {}), err => err.name === 'WaysResting' && /Jev chose other work until then/.test(err.message));
  assert.equal(asked.length, 1, 'the way is asked, not the staircase\'s rest thrown to the stall');
  const { options, state } = asked[0];
  assert.deepEqual(Object.keys(options).sort(), ['around_left', 'around_right', 'climb_here', 'tunnel_home', 'wait_rest']);
  assert.match(options.tunnel_home, /^Dig a tunnel straight at the portal through the rock, two high and one wide: a step up with each block until level with it \(\d+ above\), then level; a block laid where the floor is missing/);
  // Priced by the live pace (note 936).
  assert.match(options.tunnel_home, /about (1\.5|5) seconds a block (with the pickaxe carried|by hand \(no pickaxe carried\))/);
  assert.match(options.tunnel_home, /the pace is the live tunnels' of 2026-10-02: about 40 blocks a minute with a pickaxe, 12 by hand/);
  // The pickaxe uses it takes against those left (note 943).
  assert.match(options.tunnel_home, /This go digs about \d+ blocks, a pickaxe use each while one lasts; the pickaxes carried have 250 uses left \(iron pickaxe 250\)/);
  assert.match(options.climb_here, /^Pillar straight up 38 blocks to the portal's height \(jump and lay a block under the feet, 64 carried that can be laid, 26 left after\), from where the bot stands, with no lava or water in or beside it; the portal is then 37 blocks across at that height/);
  assert.match(options.climb_here, /On top a push is a fall of 41 blocks into lava\./);
  assert.equal(state.portalAbove, 38);
  assert.match(state.walk, /^the walk into it failed/);
  assert.match(state.staircase, /no floor to step onto \(a gap, for a span or a pillar\): 6 of the steps nearer/);
  // Met again from the same place in the same rest: every way resting, said, not asked again.
  await assert.rejects(returnFromNether(bot, task, goal, () => {}), err => err.name === 'WaysResting' && /asked from here with this, and other work chosen/.test(err.message));
  assert.equal(asked.length, 1);
});

test('a way to the portal back chosen from a place that came to nothing is not offered from there again, and said; with every way so tried it is not asked (mid-244-ad-nether-1, note 568)', async () => {
  // mid-244-ad-nether-1, on its span 186 blocks from its portal, was asked portal_way ninety-five times in ten minutes:
  // around_right, around_left, around_right ..., each leg back within a third of a second having moved nothing, "chosen
  // from here before" said on the last one only, so the facts and the answer changed at every asking.
  const { returnFromNether } = require('../src/work');
  const { setAside } = require('../src/progress');
  const registry = require('minecraft-data')('26.1');
  const portal = new Vec3(10, 73, -13);
  const bot = Object.assign(new EventEmitter(), { registry, entity: { position: new Vec3(-14.5, 35, 14.5), isInWater: false }, game: { dimension: 'the_nether', gameMode: 'survival' }, oxygenLevel: 20,
    health: 18, food: 17, entities: {}, world: { raycast: () => null },
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1, type: registry.itemsByName.iron_pickaxe.id }] },
    findBlocks: ({ matching }) => matching.includes(registry.blocksByName.nether_portal.id) ? [portal] : [],
    blockAt: p => {
      const name = p.equals(portal) ? 'nether_portal' : p.y <= 31 ? 'lava' : p.y === 34 && p.z === 14 && p.x >= -40 && p.x <= -15 ? 'netherrack' : 'air';
      return { name, boundingBox: name === 'netherrack' ? 'block' : 'empty', diggable: true, position: p };
    },
    clearControlStates() {}, getControlState() { return false; }, setControlState() {}, stopDigging() {} });
  bot.pathfinder = { movements: {}, setGoal() {}, isMoving: () => false, goto: async () => { throw Object.assign(new Error('No path'), { name: 'NoPath' }); } };
  const task = new Task('back'), asked = [], picks = ['around_right', 'around_left'];
  task.opportunityClient = { systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } };
  const goal = { survival: {} };
  setAside(goal, 'staircase', { x: 8, y: 72, z: -16 }, 'no safe step toward it from (-15, 35, 14) (no floor to step onto (a gap, for a span or a pillar): 6 of the steps nearer)', 600000);
  setAside(goal, 'crossing', '-2,1>10,-13', 'it laid nothing nearer', 300000);
  // The tunnel resting too (note 860), so the legs round are what is left.
  setAside(goal, 'tunnel_home', 'nether', 'lava on every side of its next cell', 300000);
  await returnFromNether(bot, task, goal, () => {});
  assert.deepEqual(Object.keys(asked[0].options).sort(), ['around_left', 'around_right', 'wait_rest']);
  // The leg round to the right found no path and moved nothing: from here it is not offered again, and it is said.
  await returnFromNether(bot, task, goal, () => {});
  assert.equal(asked.length, 2);
  assert.deepEqual(Object.keys(asked[1].options).sort(), ['around_left', 'wait_rest']);
  assert.match(asked[1].state.triedFromHereToNothing[0], /^around right: ended 0 blocks from here and no nearer, \d+ seconds? ago \(.*No path/);
  // The left too: the rest alone is left, taken as the one way (note 560), not asked; the way rests.
  await assert.rejects(returnFromNether(bot, task, goal, () => {}), err => err.name === 'WaysResting');
  assert.equal(asked.length, 2, 'not asked a third time');
  assert.deepEqual(Object.keys(goal.portalWay.tried).sort(), ['around_left', 'around_right']);
});

test('the way back to a portal from a span over a walkable floor offers going down and walking the floor, with the climb back up said (note 568)', async () => {
  // mid-244-ad-nether-1's span at y 63 over a crimson forest walkable at y 32 to 45: every way it was offered to its portal
  // was at the height it stood.
  const { returnFromNether } = require('../src/work');
  const { setAside } = require('../src/progress');
  const registry = require('minecraft-data')('26.1');
  const rock = p => {
    if (p.y <= 20) return 'lava';
    if (p.x <= 0 && p.y <= 73) return 'netherrack';
    if (p.y === 73 && p.z === 0 && p.x >= 1 && p.x <= 30) return 'cobblestone';
    if (p.z >= -3 && p.z <= -1 && p.x >= 1 && p.x <= 17 && p.y <= 73 - p.x) return 'netherrack';
    if (p.y <= 56 && p.x > -40 && p.x < 200 && p.z > -40 && p.z < 40) return 'netherrack';
    return null;
  };
  const bot = Object.assign(new EventEmitter(), { registry, entity: { position: new Vec3(30.5, 74, 0.5), isInWater: false }, game: { dimension: 'the_nether', gameMode: 'survival' }, oxygenLevel: 20,
    health: 20, food: 17, entities: {}, world: { raycast: () => null },
    inventory: { items: () => [{ name: 'cobblestone', count: 12, type: registry.itemsByName.cobblestone.id }] },
    findBlocks: () => [],
    blockAt: p => { const name = rock(p) || 'air'; return { name, boundingBox: name === 'air' || name === 'lava' ? 'empty' : 'block', diggable: true, position: p }; },
    clearControlStates() {}, getControlState() { return false; }, setControlState() {}, stopDigging() {} });
  bot.pathfinder = { movements: {}, setGoal() {}, isMoving: () => false, goto: async () => { throw Object.assign(new Error('No path'), { name: 'NoPath' }); } };
  const task = new Task('back'), asked = [], picks = ['wait_rest'];
  task.opportunityClient = { systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } };
  const goal = { survival: {}, portals: [{ x: 150, y: 76, z: 0, dimension: 'nether' }] };
  setAside(goal, 'portal_leg', { x: 150, y: 76, z: 0 }, 'a walk toward it made no ground', 120000);
  setAside(goal, 'crossing', '3,0>150,0', 'it laid nothing nearer', 300000);
  setAside(goal, 'staircase', { x: 144, y: 72, z: 0 }, 'no safe step toward it (no floor to step onto (a gap, for a span or a pillar): 4 of the steps nearer)', 600000);
  await assert.rejects(returnFromNether(bot, task, goal, () => {}), err => err.name === 'WaysResting');
  assert.equal(asked.length, 1);
  const said = asked[0].options.floor_way;
  assert.match(said, /^Go down to the floor and walk it toward the portal\. The way down to the floor 17 blocks below \(y 57/);
  assert.match(said, /On the floor, of the \d+ cells on the straight line toward it \(\d+ blocks from the foot of the way down(: the way down ends \d+ blocks farther from the portal than the bot stands now, \d+ off|, \d+ nearer than where the bot stands now)?\): \d+ of floor to walk/);
  assert.match(said, /The portal is 19 blocks above the floor: that height is climbed again at the end .*, 12 blocks carried\.$/);
});
