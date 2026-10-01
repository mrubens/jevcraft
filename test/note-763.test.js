'use strict';
// Note 763: Nether reach collapsed on every source world but 242
// (artifacts/fable/checkin-20260930T1709Z.md problem 1; scripts/portal-time.js
// --by-world). The hard worlds start underground; before the Nether the bot
// went between the depth and the surface over and over, win_strategy turned
// mid-errand, and the lava picker dug for the deep lava past a pool 90
// blocks shallower. These replay the recorded shapes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { setAside } = require('../src/progress');
const registry = require('minecraft-data')('26.1');

// mid-237-bc at 14:53:53Z, 86 blocks under open sky at y -7: three iron
// pickaxes, 125 coal, 29 iron ingots, 5 raw mutton (10 food points), in full
// iron with a shield, golden boots and a bed carried; the diamond sword and
// the crossing's kit open. Stone below y 79, air above.
function deepBot(extra = {}) {
  const items = Object.entries({ iron_pickaxe: 3, coal: 125, iron_ingot: 29, cobblestone: 128, cobbled_deepslate: 33, mutton: 5, iron_sword: 1, shield: 1, bucket: 1, white_bed: 1,
    iron_helmet: 1, iron_chestplate: 1, iron_leggings: 1, iron_boots: 1, golden_boots: 1, furnace: 1, ...extra }).map(([name, count]) => ({ name, count }));
  return {
    registry, health: 20, food: 18, game: { gameMode: 'survival', dimension: 'overworld', difficulty: 'normal' }, time: { timeOfDay: 1000 },
    entity: { position: new Vec3(110.5, -7, 40.5), height: 1.8, width: 0.6, onGround: true }, entities: {},
    inventory: { items: () => items.filter(i => i.count > 0), slots: [], emptySlotCount: () => 10 },
    blockAt: p => { const q = p.floored(); const solid = q.y < 79 && !(q.x === 110 && q.z === 40 && q.y >= -7 && q.y <= -6); return { name: solid ? 'stone' : 'air', position: q, boundingBox: solid ? 'block' : 'empty', getProperties: () => ({}) }; },
    findBlocks: () => [], world: { raycast: () => null }, pathfinder: { movements: {} },
  };
}

// The diamond sword and the crossing's kit chosen: optional before the
// Nether since note 776 (no benefit in the record), on the ladder once chosen.
const chosen = () => ({ rungOptIn: Object.fromEntries(['diamond_sword', 'nether_food', 'nether_pickaxe', 'nether_blocks', 'nether_chest'].map(f => [f, Date.now()])) });

test('what is owed at each level is said with the climb at the bot\'s own measured pace (mid-237-bc, 86 blocks down)', () => {
  const levels = require('../src/levels');
  const bot = deepBot(), goal = chosen();
  assert.equal(levels.depthHere(bot), 86);
  const { up, down } = levels.owed(bot, goal);
  assert.match(up.join(' | '), /food for the Nether \(10 of 80 points carried, 20 more once the raw food carried is cooked; animals and crops are at the surface\)/);
  assert.match(up.join(' | '), /wood \(0 logs' worth carried; the diamond sword, nether pickaxe, nether chest want sticks or planks; trees grow at the surface\)/);
  assert.match(down.join(' | '), /diamonds for the diamond sword \(0 of 2 carried; diamond ore lies between y -64 and 16, most around y -59: at this depth\)/);
  assert.match(down.join(' | '), /lava for the portal \(10 buckets still to fetch; no lava is known; the deep lava lies at y -56\)/);
  const says = levels.levelsSays(bot, goal, { going: 'up' });
  assert.match(says, /The bot is 86 blocks up to open sky: about 7 minutes at the bot's own pace \(4\.9 seconds a block risen over its 240 climbs of 20 blocks or more before the Nether/);
  assert.match(says, /and about 5 minutes to come back down to this depth/);
  assert.match(says, /Each level's needs done in one visit is one climb between them/);
  // At the surface a portal already known owes no lava.
  assert.equal(levels.portalLava(bot, { portals: [{ dimension: 'overworld', x: 0, y: 70, z: 0 }] }), null);
});

test('the food trip from 86 blocks down is priced with the climb and the way back down, not as a walk of a minute (mid-237-bc 14:54:49Z)', async () => {
  const { kitFoodStep } = require('../src/work');
  const bot = deepBot();
  // 1 sheep seen just now, 50 blocks south-west at the surface.
  const goal = { sightings: { sheep: [{ x: 75, y: 80, z: 76, count: 1, at: Date.now(), dimension: 'overworld' }] } };
  const log = {};
  const client = { systemOne: async ({ questions }) => { log.offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'go_without', confidence: 0.6 } } }; } };
  await kitFoodStep(bot, new Task('win'), goal, () => {}, { wants: 80 }, client);
  assert.match(log.offered.top_up_food_near, /about 1\d minutes in all \(the climb to open sky first, 86 blocks up, about 7 minutes at the bot's own pace, and about 5 minutes back down to this depth after, the walk there about \d+ seconds/);
  assert.match(log.offered.top_up_food, /about 1\d minutes in all \(the climb to open sky first/);
});

test('win_strategy says each rung\'s level and record, and the Nether now prices each rung it leaves (mid-237-bc 14:53:53Z)', () => {
  const { strategyOptions } = require('../src/strategy');
  const bot = deepBot(), goal = chosen();
  // Ordered by level (note 776): 86 blocks down with the lava below, the
  // surface's rungs first (wood, food), the sword's diamonds with the lava.
  const order = require('../src/game-progress').openRungs(bot, goal).map(r => r.phase);
  assert.deepEqual(order, ['nether_pickaxe', 'nether_food', 'nether_chest', 'diamond_sword']);
  const stage = require('../src/game-progress').openRungs(bot, goal)[0];
  const options = strategyOptions(bot, goal, stage, {});
  assert(options.rung_nether_food && options.nether_first, Object.keys(options).join(','));
  const food = options.rung_nether_food.description;
  assert.match(food, /Its gathering is at the surface: the bot is 86 blocks up to open sky: about 7 minutes/);
  assert.match(food, /Still owed at depth, a way back down after it: diamonds for the diamond sword/);
  // The record as note 776 measured it: minutes, finished, stays with and without.
  assert.match(food, /In the record: fresh trials 2026-09-30 20:00Z to 2026-10-01 03:00Z: 79 of 107 worked on it before the Nether, a median 10\.7 minutes each/);
  assert.match(food, /with it 48, 67% ended in a death, 35% got a blaze rod; without it 65, 55% and 34%\. No benefit in the record: optional before the Nether, made only if chosen/);
  // The sword's gathering is here: no climb said with it.
  assert.doesNotMatch(options.rung_diamond_sword.description, /Its gathering is at the surface/);
  const now = options.nether_first.description;
  assert.match(now, /go for the Nether now, with the kit carried now/);
  assert.match(now, /Without nether food for now: [^.]*\. Its gathering from here is at the surface: the bot is 86 blocks up/);
  assert.match(now, /Its record: 79 of 107 trials worked on it before the Nether, a median 10\.7 minutes each, 20 of 79 had it by the Nether; first Nether stays with it 67% ended in a death and 35% got a rod \(48\), without it 55% and 34% \(65\); no benefit in the record\./);
});

test('win_strategy is not asked again mid-errand: a lava fetch held goes on through a rung its own dig opened (25583, 25590)', async () => {
  const { strategyStep, errandUnderWay } = require('../src/strategy');
  const bot = deepBot({ iron_pickaxe: 1 }), goal = chosen();
  const now = 1e12;
  goal.strategy = { choice: 'stage_reach_nether', rungPhase: null, ladderNext: 'reach_nether', keys: 'stage_reach_nether', at: now - 60000, openPhases: [] };
  goal.lavaFetch = { way: 'deep', lava: { x: 110, y: -56, z: 40 }, dest: { x: 110, y: -56, z: 40 }, since: Date.now(), carried: 0, dimension: 'overworld', switches: 0 };
  assert.equal(errandUnderWay(bot, goal), 'the lava fetch under way');
  const asked = [];
  const decide = async (id, args) => { asked.push(args); return { path: ['rung_nether_pickaxe'] }; };
  const stage = require('../src/game-progress').openRungs(bot, goal)[0];
  const held = await strategyStep(bot, new Task('win'), goal, () => {}, stage, { decide, now: () => now });
  assert.deepEqual(held, { stage: { phase: 'reach_nether', action: 'enter_nether' } }, 'the Nether goes on');
  assert.equal(asked.length, 0, 'not asked mid-errand');
  // The bucket filled, the errand over: the diamond sword may wait, and going
  // to the Nether holds through it (note 777: keyed to the Nether, not to
  // what is carried); its time up, asked, with what opened.
  delete goal.lavaFetch;
  const still = await strategyStep(bot, new Task('win'), goal, () => {}, stage, { decide, now: () => now });
  assert.deepEqual(still, { stage: { phase: 'reach_nether', action: 'enter_nether' } }, 'still held');
  assert.equal(asked.length, 0);
  const after = await strategyStep(bot, new Task('win'), goal, () => {}, stage, { decide, now: () => now + require('../src/strategy').HOLD_MS });
  assert.equal(asked.length, 1);
  assert.equal(after, null, 'the rung chosen is the ladder\'s own stage');
});

test('the Nether now is held: not asked again at once as the ladder\'s reach-nether stage (with note 764)', async () => {
  const { strategyStep } = require('../src/strategy');
  const bot = deepBot({ diamond_sword: 1 }), goal = chosen();
  let now = 1e12;
  const asked = [];
  const answers = ['nether_first', 'stage_reach_nether'];
  const decide = async (id, args) => { asked.push(Object.keys(args.tree)); return { path: [answers[asked.length - 1]] }; };
  const first = openRungsPhase(bot, goal);
  const r = await strategyStep(bot, new Task('win'), goal, () => {}, { phase: first, action: 'nether_food' }, { decide, now: () => now });
  assert.deepEqual(r, { replan: true });
  assert.equal(goal.strategy.choice, 'nether_first', 'held (note 764\'s hold for the Nether)');
  now += 5000;
  const again = await strategyStep(bot, new Task('win'), goal, () => {}, { phase: 'reach_nether', action: 'enter_nether' }, { decide, now: () => now });
  assert.equal(asked.length, 1, 'held');
  assert.equal(again, null, 'the ladder\'s stage goes on');
});
function openRungsPhase(bot, goal) { return require('../src/game-progress').openRungs(bot, goal)[0].phase; }

// 25584 mid-244-hf, 19:18-19:28Z: at (37, 46, 64), no lava in sight, the pool
// known at (132, 18, 108) its walk set aside; "Digging down for the deep lava
// at y -56, 102 blocks down ... the pool known at (132, 18, 108) is passed:
// 107 blocks", then heading after heading set aside.
function lavaBot() {
  const chat = [];
  const bot = {
    registry, game: { gameMode: 'survival', difficulty: 'normal', dimension: 'overworld' }, entities: {},
    entity: { position: new Vec3(37.5, 46, 64.5) }, inventory: { items: () => [{ name: 'bucket', count: 1 }] }, world: { raycast: () => null },
    blockAt: p => ({ name: p.y < 46 ? 'stone' : 'air', position: p.clone(), boundingBox: p.y < 46 ? 'block' : 'empty' }),
    findBlocks: () => [], pathfinder: { movements: {}, getPathTo: async () => ({ status: 'noPath', path: [] }) }, chat: m => chat.push(m),
  };
  return { bot, chat };
}
test('the lava picker weighs a pool 28 down against the deep lava 102 down with the carry back, and a deep dig failing from here gives way to a pool (25584 mid-244-hf)', async () => {
  const { collectLava, LAVA_DEPTH } = require('../src/obsidian');
  const { descentTargets, landingKey } = require('../src/tunneling');
  const dug = [], actions = { navigate: async () => {}, dig: async () => {}, resourceTunnelStep: async (b, t, g, s, dest) => { dug.push(dest); } };
  const step = { action: 'fill_bucket', item: 'lava_bucket', count: 1 };
  let { bot, chat } = lavaBot();
  const pool = { kind: 'lava_pool', dimension: 'overworld', x: 132, y: 18, z: 108 };
  const goal = { landmarks: [{ ...pool }] };
  setAside(goal, 'landmark_trip', 'lava_pool:132,108', 'no nearer', 1800000);
  await collectLava(bot, new Task('lava'), step, goal, () => {}, actions);
  assert.deepEqual([dug[0].x, dug[0].y, dug[0].z], [132, 19, 108], 'dug toward the pool, not the deep lava');
  assert.match(chat.at(-1), /^Digging toward the lava at \(132, 18, 108\), \d+ blocks off, 28 blocks down/);
  // A pool 400 blocks off: the deep lava is the shorter way while its dig
  // holds from here; two headings set aside from here, the pool is taken.
  ({ bot, chat } = lavaBot());
  const far = { ...pool, x: 437, z: 64 }, g2 = { landmarks: [far] };
  setAside(g2, 'landmark_trip', 'lava_pool:437,64', 'no nearer', 1800000);
  await collectLava(bot, new Task('lava'), step, g2, () => {}, actions);
  assert.equal(dug.at(-1).y, LAVA_DEPTH, 'the deep lava while it holds');
  const here = bot.entity.position.floored();
  for (const p of descentTargets(here, LAVA_DEPTH).slice(0, 2)) setAside(g2, 'staircase_from', landingKey(here, p), 'paced the same few cells', 600000);
  delete g2.lavaFetch;
  await collectLava(bot, new Task('lava'), step, g2, () => {}, actions);
  assert.deepEqual([dug.at(-1).x, dug.at(-1).z], [437, 64], 'the deep dig failing from here: the pool known');
});

test('lava found nearer than the plan\'s, not known when it was chosen, asks the plan again; known since, it does not (25581 mid-243-mg, 250 blocks; note 782)', () => {
  const { planDueNow } = require('../src/work');
  const PP = require('../src/portal-plan');
  const bot = { registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(215.5, 64, 166.5) }, inventory: { items: () => [] },
    findBlocks: () => [], blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', position: p, boundingBox: p.y < 64 ? 'block' : 'empty' }) };
  const goal = { landmarks: [{ kind: 'lava_pool', dimension: 'overworld', x: 21, y: 67, z: -4 }],
    portalMethod: { kind: 'cast', key: 'beside_pool_0', near: { x: 21, y: 67, z: -4 }, lava: { way: 'pool', at: { x: 21, y: 67, z: -4 } }, minutes: 60, activeMs: 0, reasked: 0 } };
  goal.portalMethod.facts = PP.planFacts(bot, goal, { lavaKnown: [{ x: 21, y: 67, z: -4 }] });
  assert.equal(planDueNow(bot, goal), null);
  // A pool found 28 blocks off, the plan's 259 off.
  goal.landmarks.push({ kind: 'lava_pool', dimension: 'overworld', x: 240, y: 60, z: 180 });
  const due = planDueNow(bot, goal);
  assert.equal(due.kind, 'lava');
  assert.match(due.why, /^lava found at \(240, 60, 180\) \(pool\), 28 blocks off, nearer than the plan's lava \(259\)$/);
  // Said once: known now, it is not a new fact again.
  assert.equal(planDueNow(bot, goal), null);
  // Farther than the plan's lava, a pool found is not asked about.
  const near = { ...goal, landmarks: [goal.landmarks[0]], portalMethod: { ...goal.portalMethod } };
  near.portalMethod.facts = PP.planFacts(bot, near, { lavaKnown: [{ x: 21, y: 67, z: -4 }] });
  bot.entity.position = new Vec3(30.5, 67, 0.5);
  near.landmarks.push({ kind: 'lava_pool', dimension: 'overworld', x: 240, y: 60, z: 180 });
  assert.equal(planDueNow(bot, near), null);
});

test('the watcher\'s hour is a reason in the verdict, not an empty list', () => {
  const { cutReasons } = require('../scripts/midgame');
  assert.deepEqual(cutReasons('mid-244-hf', 61, {}), ['cut: no Nether in 60 minutes played']);
  assert.deepEqual(cutReasons('mid-244-hf', 59, {}), []);
  assert.deepEqual(cutReasons('mid-242-zz', 95, { nether: 30 }), ['cut: no fortress in 60 minutes after the Nether']);
  assert.deepEqual(cutReasons('mid-242-zz', 95, { nether: 30, fortress: 50 }), []);
  assert.deepEqual(cutReasons('mid-242-zz-fortress-1', 200, {}), []);
  const watch = require('fs').readFileSync(require.resolve('../scripts/trials/watch.sh'), 'utf8');
  assert.match(watch, /death\|loop\|stranded\|\^cut: /);
});

test('the per-world measure: win_strategy turns count the Nether now and the reach-nether stage as one answer, and trips between the levels', () => {
  const pt = require('../scripts/portal-time');
  const d = (t, answer) => ({ t, decision: { id: 'win_strategy', answer } });
  const s = pt.strategyFlips([{ t: 0, action: 'fill_bucket' }, d(1000, 'nether_first'), d(5000, 'stage_reach_nether'), { t: 6000, action: 'fill_bucket' }, d(20000, 'rung_nether_pickaxe'), d(200000, 'stage_reach_nether')]);
  assert.deepEqual([s.asks, s.flips, s.quick], [4, 2, 1]);
  assert.equal(s.abandoned.fill_bucket, 2);
  const at = (t, y, action = 'mine') => ({ t, pos: { x: 0, y, z: 0 }, dim: 'overworld', action });
  const h = pt.heightTrips([at(0, 10), at(1000, 20, 'ascend_to_surface'), at(20000, 66, 'ascend_to_surface'), at(30000, 67), at(40000, 12, 'tunnel'), at(50000, 70)]);
  assert.deepEqual([h.ups, h.downs, h.climbs.length, h.climbs[0].rose], [2, 1, 1, 46]);
  assert.equal(pt.workOf({ action: 'ascend_to_surface' }), 'climb up');
  assert.equal(pt.workOf({ action: 'smelt' }, 'nether_food'), 'food');
  assert.equal(pt.sourceOf({ source: '.trial-sources/first-days-244' }), '244');
});

// 25583 mid-242-ai, 19:40-19:49Z: the frame at (-1, 70, 122), 5 of 10 cast, 3
// blocks off, a lava and a water bucket carried; the cast slowed by two
// navigation stalls was raised as "cast portal and enter nether" and rested.
function watched(at, carried) {
  const { EventEmitter } = require('node:events');
  const stillness = require('../src/stillness');
  const bot = new EventEmitter();
  Object.assign(bot, { registry, entity: { position: at.clone() }, inventory: { items: () => carried }, game: { gameMode: 'survival', dimension: 'overworld' }, placeBlock: async () => {}, findBlocks: () => [] });
  stillness.watchStalls(bot, () => null);
  return { bot, stop: () => stillness.unwatchStalls(bot) };
}
function trade(bot, goal, steps, t0) {
  const { flipWatch } = require('../src/stillness');
  let t = t0, raised = null;
  for (const s of steps) { t += 9000; goal.step = typeof s === 'string' ? { action: s } : { ...s }; raised = flipWatch(bot, goal, t) || raised; }
  return { raised, t };
}
test('the ladder\'s label claims no turn without a portal lit: a cast traded with enter_nether is not rested as a flip, with lava in hand or none (25583 mid-242-ai; 25594)', () => {
  const pairs = require('../src/flip-pairs');
  const carried = [{ name: 'lava_bucket', count: 1 }, { name: 'water_bucket', count: 1 }];
  const { bot, stop } = watched(new Vec3(1.5, 70, 123.5), carried);
  try {
    const frame = { origin: { x: -1, y: 70, z: 122 }, cast: true, blocks: [] };
    const goal = { kind: 'win', rungTime: { phase: 'reach_nether' }, survival: {}, portalFrame: frame, portalMethod: { kind: 'cast', activeMs: 0, reasked: 0 } };
    const slot = { x: -1, y: 71, z: 122 };
    const steps = ['enter_nether', { action: 'cast_portal', item: 'obsidian', slot }, 'enter_nether', { action: 'cast_portal', item: 'obsidian', slot }, 'enter_nether'];
    let r = trade(bot, goal, steps, 7_000_000);
    assert.equal(r.raised, null, r.raised?.why);
    assert.equal(pairs.resting(goal, ['cast_portal', 'enter_nether'], bot.entity.position, r.t), null);
    assert.equal(goal.portalMethod.flipped, undefined, 'nor a question: one step\'s work under two names');
    carried.length = 0;
    r = trade(bot, goal, steps, r.t);
    assert.equal(r.raised, null, 'no lava either: the label still claims nothing');
  } finally { stop(); }
});

test('two portal steps each holding its claim that trade the turn are Jev\'s question about the portal, the flip named, not a rest', () => {
  const pairs = require('../src/flip-pairs');
  const carried = [{ name: 'bucket', count: 2 }];
  const { bot, stop } = watched(new Vec3(1.5, 70, 123.5), carried);
  try {
    const goal = { kind: 'win', rungTime: { phase: 'reach_nether' }, survival: {}, portalFrame: { origin: { x: -1, y: 70, z: 122 }, cast: true, blocks: [] }, portalMethod: { kind: 'cast', activeMs: 0, reasked: 0 } };
    const lava = { x: 30, y: 40, z: 122 };
    const steps = [{ action: 'fill_bucket', target: lava }, { action: 'cast_portal', item: 'obsidian', slot: { x: -1, y: 71, z: 122 } }, { action: 'fill_bucket', target: lava }, { action: 'cast_portal', item: 'obsidian', slot: { x: -1, y: 71, z: 122 } }, { action: 'fill_bucket', target: lava }];
    const r = trade(bot, goal, steps, 9_000_000);
    assert.equal(r.raised, null, 'no stall raised, no rest');
    assert.deepEqual([...goal.portalMethod.flipped?.pair || []].sort(), ['cast_portal', 'fill_bucket']);
    assert.match(goal.portalMethod.flipped.why, /^turning between (fill bucket and cast portal|cast portal and fill bucket) 4 times in \d+ seconds/);
    assert.match(goal.portalMethod.flipped.fact, /No portal is lit here\. The frame begun at \(-1, 70, 122\), \d+ blocks off: some of 10 standing, cast in place\. In hand: 0 lava, 0 water and 2 empty buckets, 0 obsidian; 10 lava still to fetch\./);
    assert.match(require('../src/portal-plan').planDue(bot, goal).why, /^the route failed: the portal's own steps were turning between/, 'the portal plan is asked');
    assert.equal(pairs.resting(goal, ['cast_portal', 'fill_bucket'], bot.entity.position, r.t), null);
  } finally { stop(); }
  // The walk back to a frame whose cast rests there (an older rest) is not offered.
  const { portalJobs } = require('../src/work');
  const far = { registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(40.5, 70, 122.5) }, inventory: { items: () => [] },
    blockAt: p => ({ name: p.y < 70 ? 'stone' : 'air', position: p, boundingBox: p.y < 70 ? 'block' : 'empty' }) };
  const goal = { rungTime: { phase: 'reach_nether' }, portalFrame: { origin: { x: -1, y: 70, z: 122 }, cast: true, blocks: [{ x: -1, y: 69, z: 122 }] } };
  assert.deepEqual(portalJobs(far, goal).map(j => j.key), ['to_portal_frame']);
  pairs.note(goal, { names: ['cast_portal', 'enter_nether'], trades: 4, seconds: 36, where: { x: -1, y: 70, z: 122 }, now: Date.now() });
  assert.deepEqual(portalJobs(far, goal).map(j => j.key), [], 'the cast rests there: no walk to it');
});

test('the portal fact and each step\'s claim (portal-state.js; 25583 at nine of ten, 20:08Z)', () => {
  const { portalFact, claimHolds } = require('../src/portal-state');
  const blocks = Array.from({ length: 10 }, (_, i) => ({ x: -15 + (i % 4), y: 85 + Math.floor(i / 4), z: 106 }));
  const standing = new Set(blocks.slice(0, 9).map(b => `${b.x},${b.y},${b.z}`));
  const bot = { entity: { position: new Vec3(-12.5, 90, 108.5) }, inventory: { items: () => [{ name: 'water_bucket', count: 1 }] }, findBlocks: () => [], registry,
    blockAt: p => ({ name: standing.has(`${p.x},${p.y},${p.z}`) ? 'obsidian' : 'air' }) };
  const fact = portalFact(bot, { portalFrame: { origin: { x: -15, y: 85, z: 106 }, cast: true, blocks } });
  assert.equal(fact.frame.standing, 9);
  assert.equal(fact.owed, 1);
  assert.equal(claimHolds('enter_nether', fact), false, 'nothing lit to enter');
  assert.equal(claimHolds('cast_portal', fact), true);
  assert.equal(claimHolds('fill_bucket', fact), false, 'no bucket to carry lava in');
  assert.equal(claimHolds('enter_nether', { ...fact, lit: true }), true);
});

// 25590 (mid-239-da, ~20:00Z): under seven blocks of sand at y 56, no pickaxe,
// "oak log 8 blocks off, 7 up" at the surface; wood_first chosen four times,
// each back at once with nothing.
test('climb_out does not offer a pickaxe made from wood at the surface the climb reaches, nor again at once after a fetch came back with none (25590)', () => {
  const { climbOptions, straightUpColumn } = require('../src/surface');
  const log = new Vec3(125, 63, 45);
  const blockAt = p => {
    const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const name = q.equals(log) ? 'oak_log' : q.y >= 63 ? 'air' : q.y >= 57 ? 'sand' : q.y >= 56 && q.x === 120 && q.z === 45 ? 'air' : 'stone';
    return { name, type: registry.blocksByName[name].id, position: q, boundingBox: name === 'air' ? 'empty' : 'block', diggable: name !== 'air' };
  };
  const items = [['cobblestone', 20]].map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id }));
  const bot = { registry, game: { dimension: 'overworld', gameMode: 'survival', minY: -64, height: 384 }, entity: { position: new Vec3(120.5, 56, 45.5) },
    inventory: { items: () => items }, blockAt, findBlocks: ({ matching }) => [log].filter(p => [].concat(matching).includes(blockAt(p).type)), entities: {} };
  const feet = bot.entity.position.floored();
  assert.equal(require('../src/pickaxe-budget').nearestWood(bot, {}).up, 7);
  assert.equal(climbOptions(bot, feet.offset(0, 8, 0), straightUpColumn(bot, feet), { goal: {} }).options.wood_first, undefined, 'the log is up top: the climb reaches it');
  // Wood down here is offered, but not in the ten minutes after a fetch that came back with no pickaxe.
  log.y = 56; log.x = 124;
  assert(climbOptions(bot, feet.offset(0, 8, 0), straightUpColumn(bot, feet), { goal: {} }).options.wood_first);
  assert.equal(climbOptions(bot, feet.offset(0, 8, 0), straightUpColumn(bot, feet), { goal: {}, woodFirstFailed: { at: Date.now() } }).options.wood_first, undefined);
});

test('out of the Nether for food, the food rung is handed on arrival whatever rest it had, until met or left by choice (25584 mid-244-ak 20:36Z)', async () => {
  const { gameStep, nextGameStage } = require('../src/game-progress');
  const bot = deepBot({ diamond_sword: 1, cooked_beef: 3 });
  bot.entity.position = new Vec3(56.5, 70, 117.5);
  bot.blockAt = p => ({ name: p.y < 70 ? 'stone' : 'air', position: p, boundingBox: p.y < 70 ? 'block' : 'empty' });
  bot.inventory.slots = [];
  bot.on = () => {}; bot._client = { on: () => {} };
  const goal = { kind: 'win', gameProgress: { version: 1, startedAt: Date.now(), milestones: {} } };
  for (const p of ['nether_pickaxe', 'nether_blocks', 'nether_chest']) setAside(goal, 'rung', p, 'Jev chose the Nether first', 1800000);
  setAside(goal, 'rung', 'nether_food', 'Jev chose the Nether first, without more food', 1800000);
  assert.equal(nextGameStage(bot, goal).phase, 'reach_nether', 'resting: the ladder goes on to the Nether');
  goal.step = { action: 'return_for_food', health: 20, food: 18 };
  const seen = [];
  await gameStep(bot, new Task('win'), goal, () => {}, { acquireStep: async () => {}, nether_food: async (b, t, g, s, stage) => { seen.push(stage.phase); }, enter_nether: async () => { seen.push('reach_nether'); } });
  assert(goal.foodTrip, 'the food trip is kept');
  assert.deepEqual(seen, ['nether_food'], 'the food rung, not straight back in');
  // Left by choice: the food question's go_without ends the trip.
  const { kitFoodStep } = require('../src/work');
  const client = { systemOne: async () => ({ answers: { branch_0: { choice: 'go_without', confidence: 0.6 } } }) };
  await kitFoodStep(bot, new Task('win'), goal, () => {}, { wants: 80 }, client);
  assert.equal(goal.foodTrip, undefined);
  assert.equal(nextGameStage(bot, goal).phase, 'reach_nether');
});

test('a frame site dug out of the rock is offered only by the lava a cast beside was chosen for (25588: 65 blocks from it)', () => {
  const { siteByLava } = require('../src/work');
  const lava = { x: 127, y: 12, z: 128 };
  assert.equal(siteByLava({ origin: { x: 62, y: 13, z: 128 } }, lava), false, '65 blocks off');
  assert.equal(siteByLava({ origin: { x: 120, y: 13, z: 130 } }, lava), true, 'within its reach');
  assert.equal(siteByLava({ origin: { x: 62, y: 13, z: 128 } }, null), true, 'no lava chosen: anywhere');
});

test('the lava trips are priced at the bot\'s measured walking pace, and the fetch says a walk at it (critic 21:00Z: "147 blocks off, about 35 seconds")', () => {
  const { lavaTrip } = require('../src/portal-cast');
  const trip = lavaTrip({ x: 91, y: 68, z: 87 }, { at: { x: 166, y: 68, z: 99 } });
  assert.equal(trip.walk, Math.round(76 * 2 / 38.5 * 60));
  const { holdLava } = require('../src/obsidian');
  const said = [];
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, game: { dimension: 'overworld' }, inventory: { items: () => [] }, chat: m => said.push(m) };
  holdLava(bot, {}, () => {}, { way: 'pool', lava: new Vec3(147, 64, 0) });
  assert.match(said[0], /^Walking to the lava pool at \(147, 64, 0\), 147 blocks off, about 4 minutes\./);
});
