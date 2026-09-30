'use strict';
// Note 723: three loops caught asking a question whose answer either could
// not be carried out again yet, or contradicted one just given by another
// loop a second before.
//
// (1) 25590 (mid-242-sd, 2026-09-30 04:45-04:53Z): sealed against a piglin
// 15 blocks off, out of sight, turn_priority chose survival at 04:51:32 and
// 04:52:32 with the claim's own text promising "whether to stay, leave or
// do something else there is asked next", and no pocket_next followed
// either time: the pocket's own leave threw NoRoute, which unwound past the
// cleanup that clears the held plan and falls back to stay, leaving "leave"
// held for the rest of its ninety seconds while it kept failing the same
// way every pass.
// (2) 25594 and 25585 (mid-242-tb, mid-242-sg, 2026-09-30 04:50-04:51Z):
// already sealed, survival_priority asked secure_shelter 38 and 45 times in
// seven and eight seconds; refugeStep had already found no way to shelter
// here and rested it (`refuge`, `anywhere`, 180 seconds), but the tree kept
// offering secure_shelter anyway, each run declining at once.
// (3) 25597 (mid-242-t, 2026-09-30 04:59:17-56Z): hunt_target answered
// defer at 04:59:27, and one second later encounter_stance answered
// charge_nearest against the same blazes, not told defer had just been
// chosen; fireballs landed, it burned, and out_of_fire kept losing to
// shot_answer's own behind_cover walking it back toward the fire.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const { Survival } = require('../src/survival');
const { pocketWaitSays, watchPocket } = require('../src/pocket-wait');
const danger = require('../src/danger');
const reflex = require('../src/shot-reflex');
const progress = require('../src/progress');

// --- (1) pocket_next: a leave that throws NoRoute is not left held --------

function netherPocket({ piglinAt = new Vec3(13.5, 30, 0.5) } = {}) {
  const origin = new Vec3(0, 30, 0);
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  const piglin = { id: 7, name: 'piglin', type: 'hostile', position: piglinAt, height: 1.95, width: 0.6, isValid: true, heldItem: { name: 'crossbow' } };
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, entities: { 7: piglin }, health: 20, food: 18,
    registry: require('minecraft-data')('26.1'), time: { timeOfDay: 6000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }, { name: 'iron_sword', count: 1 }, { name: 'cobblestone', count: 43 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: open.has(`${p}`) ? 'air' : 'netherrack', boundingBox: open.has(`${p}`) ? 'empty' : 'block', position: p }),
    world: { raycast: from => ({ intersect: from.offset(0.6, 0, 0) }) } });
  return { bot, origin, piglin };
}

test('a pocket_next choice whose run throws NoRoute is cleaned up the same as one that returns false: the plan is not left held, and the next pass asks pocket_next fresh rather than retrying the same failing way in silence (note 723)', async () => {
  const { bot, origin } = netherPocket();
  const t0 = 1_800_000_000_000;
  const goal = { kind: 'win', request: 'beat the game' };
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'the_nether' }] }, client: { systemOne: async () => ({}) } });
  survival.leave = async () => { throw Object.assign(new Error('No route'), { name: 'NoRoute' }); };
  survival.wait = async () => {};
  const asked = [];
  survival.decide = async (task, g, save, { id, tree }) => { asked.push({ id, keys: Object.keys(tree).sort() }); return { path: [tree.leave ? 'leave' : 'stay'], stale: false }; };
  const real = Date.now;
  Date.now = () => t0;
  try { await survival.step(new Task('x'), goal, () => {}); } finally { Date.now = real; }
  // leave was chosen and thrown; the plan it was held under must not
  // survive the throw uncleaned.
  assert.equal(survival.state.pocketPlan, undefined, 'a plan whose run threw is not left held');
  // The very next pass, still sealed, asks pocket_next again rather than
  // silently retrying the held "leave" (which options[held] would do
  // without ever calling decide again).
  Date.now = () => t0 + 200;
  try { await survival.step(new Task('x'), goal, () => {}); } finally { Date.now = real; }
  assert.equal(asked.length, 2, 'pocket_next was asked again on the very next pass');
  assert.equal(asked[1].id, 'pocket_next');
});

// --- (1b) pocket-wait.js: a threat within sixteen but held off out of sight

async function askAt(survival, goal, now) {
  const real = Date.now;
  let tree;
  survival.decide = async (task, g, save, { id, tree: t }) => { if (id === 'pocket_next') tree = t; return { path: ['stay'], stale: false }; };
  survival.wait = async () => {};
  Date.now = () => now;
  try { await survival.step(new Task('wait'), goal, () => {}); } finally { Date.now = real; }
  delete survival.state.pocketPlan;
  return { tree };
}

test('a piglin fifteen blocks off, out of sight, never coming nearer or seeing the bot, is read as waiting for nothing once it has been so a while, even though it never passed sixteen blocks off (note 723, extending note 698)', async () => {
  const { bot, origin } = netherPocket();
  const t0 = 1_800_000_000_000;
  const goal = { kind: 'win', request: 'beat the game' };
  const survival = new Survival(bot, {}, { state: { shelters: [{ origin: { ...origin }, dimension: 'the_nether' }],
    stance: { choice: 'seal', kinds: ['piglin'], ids: [7], mobs: [{ name: 'piglin', distance: 13, visible: false }], at: t0 - 5000, health: 20 } }, client: { systemOne: async () => ({}) } });
  await askAt(survival, goal, t0);
  // Right after sealing, seen too recently to call it held off yet.
  let { tree } = await askAt(survival, goal, t0 + 30000);
  assert.doesNotMatch(tree.stay.description, /Nothing this wait could wait for is coming/);
  // A full minute (HELD_MS) of it never seen and never nearer: waits for nothing.
  ({ tree } = await askAt(survival, goal, t0 + 90000));
  assert.match(tree.stay.description, /Nothing this wait could wait for is coming: the piglin it was sealed against has not been seen since the seal, 1\.5 minutes ago, no daylight comes here, and health is full\. Staying is standing idle\./);
});

// --- (2) survival_priority: secure_shelter is not offered while sealed, or
//         while refugeStep's own "no way to shelter here" rest stands ----

function nightBot({ time = 13000 } = {}) {
  const origin = new Vec3(0, 30, 0);
  // Open straight up from the bot's column, on the surface, not underground
  // (underground would make nightFree true and needsShelter false whatever
  // refugeStep does): the fixture used at survival.test.js:2877.
  const air = p => p.x === 0 && p.z === 0 && p.y >= 30;
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: {}, health: 20, food: 20,
    registry: require('minecraft-data')('26.1'), time: { timeOfDay: time }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    inventory: { items: () => [{ name: 'cobblestone', count: 32 }], emptySlotCount: () => 10, slots: [] }, heldItem: null, isSleeping: false,
    equip: async () => {}, lookAt: async () => {},
    blockAt: p => ({ name: air(p) ? 'air' : 'stone', boundingBox: air(p) ? 'empty' : 'block', diggable: true, position: p }),
    world: { raycast: () => null }, findBlocks: () => [], chat() {} });
  return { bot, origin };
}

test('survival_priority does not offer secure_shelter again while refugeStep\'s own "no way to shelter here" rest stands: it declines to Jev instead of asking secure_shelter to fail at once, over and over (note 723)', async () => {
  const { oldOrder } = require('./support/jev-stand-in');
  const { bot } = nightBot();
  const survival = new Survival(bot, { navigate: async () => {}, dig: async () => {}, place: async () => {} }, { client: { systemOne: async () => { throw new Error('offline'); } } });
  survival.refugeStep = async () => { progress.setAside(survival, 'refuge', 'anywhere', 'no way to shelter here', 180000); return false; };
  const seen = [];
  survival.decide = async (task, goal, save, { id, tree, state }) => { seen.push({ id, keys: Object.keys(tree).sort(), notNow: state.notNow });
    const key = tree.secure_shelter ? 'secure_shelter' : oldOrder(id)(tree, []); return { path: [key], action: tree[key], stale: false }; };
  const goal = { kind: 'win', request: 'beat the game' };
  await survival.step(new Task('night'), goal, () => {});
  // Once secure_shelter's own run has rested refugeStep's `refuge`/
  // `anywhere`, it is excluded from the tree on every later pass while
  // that rest stands, whether or not anything is left to ask about (a
  // tree of one way is run without a question, note "One option is not a
  // question" above tree.secure_shelter's own build): decide is not asked
  // again with secure_shelter among its options.
  await survival.step(new Task('night'), goal, () => {});
  await survival.step(new Task('night'), goal, () => {});
  assert(seen[0].keys.includes('secure_shelter'), 'offered the first time');
  assert(seen.every((s, i) => i === 0 || !s.keys.includes('secure_shelter')), 'not offered again while refugeStep\'s own rest stands');
});

// --- (3a) hunt_target's defer is heard by encounter_stance a moment later -

test('danger.huntAnswerJustNow: a defer near here and recent is read; far off, long ago, or none, is not', () => {
  const bot = { entity: { position: new Vec3(0, 70, 0) } };
  const goal = { lastHuntDefer: { at: 1000, position: { x: 1, y: 70, z: 1 } } };
  assert.equal(danger.huntAnswerJustNow(goal, bot, 5000).secondsAgo, 4);
  assert.equal(danger.huntAnswerJustNow({}, bot, 5000), null, 'nothing recorded');
  assert.equal(danger.huntAnswerJustNow(goal, bot, 40000), null, 'too long ago');
  assert.equal(danger.huntAnswerJustNow({ lastHuntDefer: { at: 1000, position: { x: 40, y: 70, z: 0 } } }, bot, 5000), null, 'too far off');
});

test('encounter_stance says a closing option reverses a defer hunt_target chose a moment ago from about here (note 723)', async () => {
  const blaze = { id: 1, name: 'blaze', type: 'hostile', position: new Vec3(6.5, 70, 0.5), height: 1.8, width: 0.6, isValid: true };
  const bot = Object.assign(new EventEmitter(), {
    game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 19, oxygenLevel: 20,
    entities: { 1: blaze }, time: { timeOfDay: 0 }, registry: require('minecraft-data')('26.1'),
    entity: { position: new Vec3(0.5, 70, 0.5), onGround: true, width: 0.6, height: 1.8, velocity: new Vec3(0, 0, 0) },
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: { 45: { name: 'shield' } }, emptySlotCount: () => 20 },
    blockAt: p => ({ position: p.floored(), name: p.y < 70 ? 'netherrack' : 'air', boundingBox: p.y < 70 ? 'block' : 'empty', diggable: true, shapes: p.y < 70 ? [[0, 0, 0, 1, 1, 1]] : [] }),
    world: { raycast: () => null }, findBlocks: () => [], lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack() {}, _hurtBy: {},
  });
  const survival = new Survival(bot, { navigate: async () => {} }, { state: { shelters: [] }, client: { systemOne: async () => ({}) } });
  // The clock held still: under load the step itself took over half a
  // second and "1 second ago" read "2 seconds ago".
  const t0 = Date.now(), real = Date.now;
  const goal = { lastHuntDefer: { at: t0 - 1000, position: { x: 0.5, y: 70, z: 0.5 } } };
  let seen = null;
  survival.decide = async (task, g, save, q) => { seen = q; return { path: [Object.keys(q.tree)[0]] }; };
  Date.now = () => t0;
  try { await survival.stanceStep(new Task('x'), goal, () => {}, [{ entity: blaze, distance: 6, visible: true }], false); } finally { Date.now = real; }
  assert.equal(seen.state.huntAnswerJustNow, 'defer (hunt target), chosen 1 second ago from about here: the observed situation was unsuitable to hunt.');
  const closing = [...reflex.STANCE_SHOTS.closing].find(k => seen.tree[k]);
  assert(closing, `no closing option offered: ${Object.keys(seen.tree).join(',')}`);
  assert.match(seen.tree[closing].description, /This reverses defer \(hunt target\), chosen 1 second ago from about here: the hunt read the situation as unsuitable then\./);
});

// --- (3b) out_of_fire is not undone by shot_answer's own behind_cover ----

test('shot-reflex.stanceAnswer: while a body_way run out of fire is in flight, a warning is answered by the shield, never behind_cover, which would walk the body off the route (note 723)', () => {
  const bot = { _bodyWayRunning: { action: 'out_of_fire', at: Date.now() } };
  const withCover = reflex.stanceAnswer(bot, { shield_up: {}, behind_cover: {}, keep_on: {} });
  assert.deepEqual(withCover, { choice: 'shield_up', stance: 'out_of_fire', how: 'closing', closing: true });
  const noShield = reflex.stanceAnswer(bot, { behind_cover: {}, keep_on: {} });
  assert.deepEqual(noShield, { choice: 'reflex', stance: 'out_of_fire', how: 'closing' });
  // Gone stale (more than BODY_WAY_MS since the last step): not held any more.
  const stale = { _bodyWayRunning: { action: 'out_of_fire', at: Date.now() - 5000 } };
  assert.equal(reflex.stanceAnswer(stale, { shield_up: {} }), null);
  // No run in flight: unaffected.
  assert.equal(reflex.stanceAnswer({}, { shield_up: {} }), null);
});

test('vitals.outOfFire holds bot._bodyWayRunning only while its own walk is in flight, cleared whether it finishes, stops at a fall, or throws', async () => {
  const vitals = require('../src/vitals');
  const origin = new Vec3(0, 70, 0);
  const fire = new Set([`${origin}`]);
  const seenWhileRunning = [];
  const bot = Object.assign(new EventEmitter(), {
    entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0) },
    health: 18, food: 19, registry: require('minecraft-data')('26.1'),
    blockAt: p => ({ name: fire.has(`${p.floored()}`) ? 'fire' : 'air', boundingBox: 'empty', position: p.floored() }),
    pathfinder: { setGoal: () => {} }, clearControlStates: () => {}, world: { raycast: () => null }, findBlocks: () => [],
  });
  // Stand in with a fast, deterministic move(): one step, records whether
  // the flag was up while it ran, then lands the body outside the fire.
  const motion = require('../src/motion');
  const realMove = motion.move;
  motion.move = async (b, task, opts) => { seenWhileRunning.push(!!b._bodyWayRunning); b.entity.position = origin.offset(1.5, 0, 0.5); };
  try {
    const ok = await vitals.outOfFire(bot, new Task('x'), () => {}, [origin.offset(1, 0, 0)]);
    assert.equal(ok, true);
  } finally { motion.move = realMove; }
  assert.deepEqual(seenWhileRunning, [true], 'the flag was up for the one step the walk took');
  assert.equal(bot._bodyWayRunning, undefined, 'cleared once the run out of fire is done');
});
