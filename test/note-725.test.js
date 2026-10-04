'use strict';
// Note 725: the fight text and spawner offers at 25589's mid-242-nc-
// fortress-3 (critic 20260930T0543Z item 1, 20260930T0604Z item 1).
//
// (a) Every encounter_stance option opened with the "hardest hitter"
// lead-in naming a magma cube 9-15 blocks off out of sight ("... 4 blows
// end the bot") while a blaze 6.6 blocks off in sight had just hit, and its
// "out of sight,, the hardest hitter" had a typo'd double comma. The comma
// join is fixed here; narrowing which mob leads by distance or sight was
// tried and backed out (it broke build-reach.test.js's own, correct case
// of a far, unseen, fast piglin), so which-mob-leads is left as it was.
// (b) set_aside_rung offered while at a live spawner with rods needed, and
// keep_working saying "(open a door)" at the spawner from a stale hunt step.
// (d) chat "Ooh, a nether fortress at 118, 364!" used the bot's own
// position and announced a fortress already being used.
// (c) fortress_approach's target cell, off `bricks` alone with no floor
// seen yet, can be one buried in the fortress's own wall or roof with no
// open side to walk to; exposedBricks prefers one with open air beside it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');

// --- (a) blowsSay: the double-comma join, fixed without narrowing which
// mob leads (a distance/sight cutoff was tried and reverted: see the
// comment above blowsSay in src/survival.js and this note's trial-notes
// entry for why it broke build-reach.test.js's far, unseen, fast piglin).

function stanceBot() {
  const here = new Vec3(0, 64, 0);
  const cube = { id: 2, name: 'magma_cube', type: 'hostile', position: here.offset(-9, 0, 0), height: 1.8, width: 1.9975, isValid: true, metadata: [0, 0, 0] };
  const zombie = { id: 3, name: 'zombie', type: 'hostile', position: here.offset(-8, 0, 0), height: 1.95, width: 0.6, isValid: true, metadata: [0] };
  const entities = { 2: cube, 3: zombie };
  const items = [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 60 }];
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 19, oxygenLevel: 20,
    entity: { position: here, onGround: true, height: 1.8, width: 0.6, velocity: new Vec3(0, 0, 0), metadata: [0] }, entities, time: { timeOfDay: 0 },
    inventory: { items: () => items, slots: { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' }, 7: { name: 'iron_leggings' }, 8: { name: 'iron_boots' } } },
    world: { raycast: () => null }, blockAt: () => ({ name: 'netherrack', boundingBox: 'block' }), registry,
    pathfinder: { movements: {}, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) }, clearControlStates() {}, setControlState() {}, getControlState: () => false,
    activateItem() {}, deactivateItem() {}, lookAt: async () => {}, look: async () => {}, equip: async () => {}, attack: () => {}, findBlocks: () => [] });
  return { bot, cube, zombie };
}
const threat = (bot, entity, visible) => ({ entity, distance: entity.position.distanceTo(bot.entity.position), visible });

test('the stance\'s "hardest hitter" lead-in joins "out of sight" and "the hardest hitter of N" with one comma each, never two in a row (25589, 06:05:39-43Z, note 725)', () => {
  const { Survival } = require('../src/survival');
  const { bot, cube, zombie } = stanceBot();
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const danger = [threat(bot, cube, false), threat(bot, zombie, false)];
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, danger, false);
  const lead = options.fight?.description || options.charge_nearest?.description;
  assert.ok(lead, Object.keys(options).join(','));
  // The zombie's first blow comes more than a second before the cube's,
  // so it leads as the first (note 770); the clauses join the same way.
  assert.match(lead, /out of sight, the (?:hardest hitter|first) of the 2 here that can get to the bot,/, 'both clauses present, joined by one comma');
  assert.doesNotMatch(lead, /,,/, 'no double comma');
});

test('with only one biter out of sight, "out of sight" is said alone, still with a single comma', () => {
  const { Survival } = require('../src/survival');
  const { bot, cube } = stanceBot();
  const survival = new Survival(bot, { place: async () => {}, dig: async () => {}, navigate: async () => {} }, { state: { shelters: [] } });
  const danger = [threat(bot, cube, false)];
  const options = survival.stanceOptions(new Task('x'), {}, () => {}, danger, false);
  const lead = options.fight?.description || options.charge_nearest?.description;
  assert.ok(lead, Object.keys(options).join(','));
  assert.match(lead, /^The magma cube \d+(\.\d+)? blocks off, out of sight, hits for/);
  assert.doesNotMatch(lead, /,,/);
});

// --- (c) mob-hunt.js exposedBricks: prefers a brick with open air beside it

test('exposedBricks prefers a brick with open air on some side over one buried on every side, whatever its distance (note 725)', () => {
  const { exposedBricks, exposedBrick } = require('../src/mob-hunt');
  const solid = new Set(['0,64,0', '1,64,0', '-1,64,0', '0,64,1', '0,64,-1', '0,65,0', '0,63,0']);
  const bot = { blockAt: p => ({ name: solid.has(`${p.x},${p.y},${p.z}`) ? 'nether_bricks' : 'air', boundingBox: solid.has(`${p.x},${p.y},${p.z}`) ? 'block' : 'empty' }) };
  const buried = new Vec3(0, 64, 0);   // rock or brick on every side: no way to walk up to it
  const open = new Vec3(5, 64, 5);     // not in `solid`, so blockAt calls it air with open sides
  assert.equal(exposedBrick(bot, buried), false);
  assert.equal(exposedBrick(bot, open), true);
  const picked = exposedBricks(bot, [buried, open]);
  assert.deepEqual(picked, [open], 'the buried brick is left out while an exposed one exists');
  // With nothing exposed at all, every brick is still tried (never empty).
  assert.deepEqual(exposedBricks(bot, [buried]), [buried]);
});

// --- (d) exploration.js: a fortress already anchored by the search is not
// announced again as newly found ---------------------------------------

const world = (blocks = {}, dimension = 'overworld', position = new Vec3(10, 64, 10)) => {
  const said = [];
  const bot = { registry, game: { dimension }, entity: { position }, said, chat: m => said.push(m),
    blockAt: p => { const name = blocks[`${p.x},${p.y},${p.z}`] || (p.y < 64 ? 'stone' : 'air'); return { name, boundingBox: name === 'air' || name === 'lava' ? 'empty' : 'block', position: p }; },
    findBlocks: ({ matching, count = 64 }) => Object.entries(blocks).filter(([, name]) => matching.includes(registry.blocksByName[name]?.id))
      .map(([k]) => new Vec3(...k.split(',').map(Number))).slice(0, count) };
  return bot;
};

test('a fortress already anchored by the search (fortressSearch.fortressAt) is not announced again as a new find, even though the exploration landmark never saw it before (25589, 06:05:00Z, note 725)', () => {
  const { noticeLandmarks } = require('../src/exploration');
  const many = {};
  // A brick right at the bot's own position: the exact shape of 25589's
  // bug, where the "nearest" brick found coincided with where the bot
  // stood while tunnelling into the fortress's own wall.
  for (let i = 0; i < 30; i++) many[`${118 + (i % 3)},70,${360 + i}`] = 'nether_bricks';
  const bot = world(many, 'the_nether', new Vec3(118, 70, 364));
  const goal = { fortressSearch: { fortressAt: { x: 119, y: 71, z: 337, extent: 16 } } };
  noticeLandmarks(bot, goal, () => {}, { force: true });
  // One record (note 750b): the landmark is the search's own anchor, kept
  // silently, not a new find at the brick noticed.
  assert.equal(goal.landmarks.length, 1, 'the search\'s fortress is the one landmark');
  assert.deepEqual([goal.landmarks[0].x, goal.landmarks[0].y, goal.landmarks[0].z], [119, 71, 337]);
  assert.equal(goal.survivalAction, undefined, 'nothing is announced');
});

test('with no fortress anchored yet, the same bricks are still noticed and announced once (the dedupe only skips the one already in use)', () => {
  const { noticeLandmarks } = require('../src/exploration');
  const many = {};
  for (let i = 0; i < 30; i++) many[`${118 + (i % 3)},70,${360 + i}`] = 'nether_bricks';
  const bot = world(many, 'the_nether', new Vec3(118, 70, 364));
  const goal = {};
  noticeLandmarks(bot, goal, () => {}, { force: true });
  assert.equal(goal.landmarks.length, 1);
  assert.equal(goal.landmarks[0].kind, 'nether_fortress');
});

// --- (b) set_aside_rung is not offered at a live spawner with rods owed,
// and keep_working does not say a stale hunt step there -------------------

const HERE_725 = new Vec3(119, 70, 343);
function spawnerRecorded() {
  const items = [{ name: 'iron_sword', count: 1 }, { name: 'netherrack', count: 60 }];
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 20, food: 19, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: HERE_725.clone() }, time: { timeOfDay: 6000 }, entities: {},
    inventory: { items: () => items, slots: [] }, findBlocks: () => [], clearControlStates() {},
    blockAt: p => ({ position: p, name: p.y < 70 ? 'netherrack' : 'air', boundingBox: p.y < 70 ? 'block' : 'empty' }),
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
  const goal = { kind: 'win', request: 'beat the game', from: 'TestPlayer', survival: {}, rungTime: { phase: 'obtain_blaze_rods' },
    rungClocks: { obtain_blaze_rods: { activeMs: 60000, lastAt: Date.now() } }, landmarks: [] };
  return { bot, goal };
}
async function askStall(bot, goal, stall) {
  const { answerStall } = require('../src/work');
  const asked = [];
  const client = { model: 'jev', systemOne: async ({ state, questions }) => {
    const answers = {};
    for (const [b, q] of Object.entries(questions)) {
      const keys = Object.keys(q.criteria || {});
      asked.push({ state, options: q.criteria });
      answers[b] = { choice: keys.includes('keep_at_it') ? 'keep_at_it' : keys[0], confidence: 0.6 };
    }
    return { answers };
  } };
  await answerStall(bot, new Task('stall'), goal, () => {}, stall, { client }).catch(() => {});
  return asked;
}

test('set_aside_rung is not offered for the rods while at a live spawner that still owes them: the game is handing them over right there (25589, note 725)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const { bot, goal } = spawnerRecorded();
  const cageHold = require('../src/cage-hold');
  const realFight = cageHold.cageFight;
  cageHold.cageFight = (b, g) => ({ cage: new Vec3(116, 70, 334), off: 5, need: 7, sword: 'iron_sword', chosen: null, where: 'the spawner at (116, 70, 334)' });
  try {
    const stall = { key: 'step:rung:obtain_blaze_rods', work: 'step:rung:obtain_blaze_rods', layer: 'work', strikes: 1, escalated: { from: 'fortress_leg', to: 'rung_progress', says: 'stalled at the spawner' } };
    const asked = await askStall(bot, goal, stall);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].options.set_aside_rung, undefined, 'not offered while at the live spawner with rods owed');
  } finally { cageHold.cageFight = realFight; }
});

test('away from any spawner, set_aside_rung is offered as usual (the live-spawner guard does not withhold it generally)', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const { bot, goal } = spawnerRecorded();
  const cageHold = require('../src/cage-hold');
  const realFight = cageHold.cageFight;
  cageHold.cageFight = () => null;
  try {
    const stall = { key: 'step:rung:obtain_blaze_rods', work: 'step:rung:obtain_blaze_rods', layer: 'work', strikes: 1, escalated: { from: 'fortress_leg', to: 'rung_progress', says: 'stalled away from any spawner' } };
    const asked = await askStall(bot, goal, stall);
    assert.equal(asked.length, 1);
    assert.ok(asked[0].options.set_aside_rung, 'offered away from a live spawner');
  } finally { cageHold.cageFight = realFight; }
});

test('in a rung\'s first minute, brought to its question by a question below with nothing on the rung come to nothing, setting it aside is not offered; past the minute it is (note 1144)', async t => {
  // 25594 (2026-10-03 23:33:00 to 23:33:01Z): the bucket chosen at win_strategy, while_cooking's held answer escalated a second later, the bucket set aside thirty minutes at 0.44.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const cageHold = require('../src/cage-hold');
  const realFight = cageHold.cageFight;
  cageHold.cageFight = () => null;
  try {
    for (const [ago, offered] of [[1000, false], [120000, true]]) {
      const { bot, goal } = spawnerRecorded();
      const rung = goal.rungTime?.phase || goal.gameProgress?.phase;
      goal.tried = { ...(goal.tried || {}), entries: goal.tried?.entries || [], rung: { ...(goal.tried?.rung || {}), rung, since: Date.now() - ago, lastAt: Date.now(), bestAt: Date.now() - ago, idleMs: 0, asked: 0, best: { items: 0, milestones: 0, far: 0, target: {} } } };
      const stall = { key: 'step:rung:obtain_blaze_rods', work: 'step:rung:obtain_blaze_rods', layer: 'work', strikes: 1, escalated: { from: 'while_cooking', to: 'rung_progress', says: 'while cooking: the same answer held' } };
      const asked = await askStall(bot, goal, stall);
      assert.equal(asked.length, 1);
      assert.equal(!!asked[0].options.set_aside_rung, offered, `${ago} ms on the rung`);
      if (!offered) assert.match(asked[0].state.stalled.setAsideNotOffered || '', /is not offered: it was brought here by the while cooking, and nothing tried on the rung itself has come to nothing yet \(1 seconds on it\)$/);
    }
  } finally { cageHold.cageFight = realFight; }
});
