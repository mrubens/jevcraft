'use strict';
// Note 731 (continued): 25588 (mid-242-rb-fortress-3), the same spawner loop
// as 25598 but its own shape (artifacts/critic/critic-20260930T0817Z.md item
// 1). At the cage (-108, 77, 155) for 17 minutes, 3 of 7 rods, 0 blazes
// killed: empty_spawner asked six times between 08:11 and 08:13, box_here
// whole and holding at 08:12:11 ("held from about here once in the last 46
// seconds") and abandoned for stand_by_spawner at 08:13:43 ("Nothing is
// built"), standing in the open with no shield. At 08:13:51 the hunt's own
// "too many blazes" fallback dug a fresh bunker at a different spot while
// the almost-finished box stood empty, and took the bot 20 to 0.8 health in
// three seconds. At 08:14:46, fortress_visit asked "Healing before going
// into the fortress" while standing at that very fortress's own spawner.
//
//   (a) a box (or hole, or slit) built and holding is carried on, not asked
//       over (src/empty-spawner.js atSpawner, src/cage-hold.js holding);
//       choosing one is also now a committed intention (src/intention.js
//       TIMED), so other gated questions do not silently drop it either.
//   (b) stand_by_spawner says plainly when no shield is carried, and the
//       trials' own comparison against a box at this health (src/empty-
//       spawner.js, src/blaze-record.js boxedSays).
//   (c) the hunt's "too many blazes" bunker fallback does not preempt a box
//       already building or holding at the cage (src/mob-hunt.js
//       prepareMobHunt).
//   (d) fortress_visit is not asked while already at a live spawner still
//       owed rods: the bot is already at that fortress, not approaching one
//       (src/mob-hunt.js huntObserved).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

const CAGE = new Vec3(-100, 77, 154);
const HERE = new Vec3(-104, 77, 154);

function spawnerBot({ position = HERE, rodsCarried = 3, targetCount = 4, shield = true, blazes = [], withCage = true, blocked = false } = {}) {
  const spawnerCell = p => p.x === CAGE.x && p.y === CAGE.y && p.z === CAGE.z;
  const entities = {};
  blazes.forEach(([distance, id], i) => { entities[id ?? i + 1] = { id: id ?? i + 1, name: 'blaze', position: position.offset(distance, 0, 0), height: 1.8, width: 0.6, isValid: true }; });
  const slots = Array(46).fill(null);
  slots[36] = { name: 'iron_sword', count: 1, slot: 36 };
  if (shield) slots[45] = { name: 'shield', count: 1, slot: 45 };
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1', entity: { position: position.clone(), onGround: true }, health: 20, food: 19, oxygenLevel: 20,
    game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 6000 },
    entities,
    inventory: { items: () => [...(rodsCarried ? [{ name: 'blaze_rod', count: rodsCarried }] : []), ...slots.filter(Boolean)], slots },
    blockAt: p => spawnerCell(p) ? { name: 'spawner', boundingBox: 'block' }
      : p.y < position.y ? { name: 'netherrack', boundingBox: 'block', diggable: true, hardness: 0.4 } : { name: 'air', boundingBox: 'empty' },
    findBlocks: () => [],
    world: { raycast: blocked ? (from, dir) => ({ position: from.plus(dir.scaled(2)), intersect: from.plus(dir.scaled(2)) }) : () => null },
    pathfinder: { movements: { canDig: true, allow1by1towers: true, allowParkour: false, scafoldingBlocks: [1] }, setGoal: () => {}, getPathTo: () => ({ status: 'success', path: [] }) },
    clearControlStates: () => {}, lookAt: async () => {}, activateItem: () => {}, deactivateItem: () => {}, attack: () => {}, dig: async () => {},
  });
  const goal = { kind: 'win', mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount },
    ...(withCage ? { fortressSearch: { map: { spawners: [{ x: CAGE.x, y: CAGE.y, z: CAGE.z }] } } } : {}) };
  bot._goal = goal;
  return { bot, goal };
}

test('(a) empty_spawner does not re-ask over a box already built and holding; it does ask normally with no hold', async () => {
  const es = require('../src/empty-spawner');
  const { bot, goal } = spawnerBot();
  goal.emptySpawner = { built: { key: 'box_here', at: Date.now() - 5000, from: { x: HERE.x, y: HERE.y, z: HERE.z } } };
  let asked = 0;
  const client = { systemOne: async () => { asked++; return { answers: { branch_0: { choice: 'stand_by_spawner', confidence: 0.9 } } }; } };
  const held = await es.atSpawner(bot, { check() {} }, goal, () => {}, { client });
  assert.equal(held, true, 'the hold is carried on');
  assert.equal(asked, 0, 'not asked over while the box holds');
  delete goal.emptySpawner;
  await es.atSpawner(bot, { check() {} }, goal, () => {}, { client });
  // No box held now: the question runs (a single option is taken unasked,
  // by the one-way rule, which is not this fix's concern).
  assert.equal(goal.step?.action, 'at_spawner', 'without a hold, the question is asked fresh');
});

test('(a) box_here (and the other builds) commit an intention, so a gated question elsewhere does not drop it silently', async () => {
  const intention = require('../src/intention');
  assert.equal(intention.committing('empty_spawner', 'box_here'), true);
  assert.equal(intention.committing('empty_spawner', 'box_in_line'), true);
  assert.equal(intention.committing('empty_spawner', 'box_at_spawner'), true);
  assert.equal(intention.committing('empty_spawner', 'dig_in_at_spawner'), true);
  assert.equal(intention.committing('empty_spawner', 'open_slit'), true);
  assert.equal(intention.committing('empty_spawner', 'stash_rods'), false, 'a pickup, not a build: not committed');
  const bot = { entity: { position: { x: 0, y: 64, z: 0 } }, game: { dimension: 'the_nether' }, health: 20 };
  const goal = {};
  intention.after(bot, goal, 'empty_spawner', ['box_here'], { target: { x: 20, y: 64, z: 0 } });
  assert.equal(goal.intention.choice, 'box_here');
  assert.equal(intention.holding(bot, goal).choice, 'box_here', 'holds a real change later, not gone the instant it is asked about');
  assert.match(intention.says(goal.intention), /box here \(empty spawner, to \(20, 64, 0\)\), chosen/);
  // Asked at an unrelated gated question (fortress_leg) whose options do
  // not carry the box on (no target near the cage, nothing that keeps it):
  // the intention ends cleanly, said so, rather than vanishing unremarked
  // or blocking a question that has nothing to do with it.
  const tree = { back_to_fortress: {}, seek_fortress_height: {} };
  const gated = intention.gate(bot, goal, 'fortress_leg', tree);
  assert.match(gated.ended, /box here \(empty spawner\) ended .* ago: set down: fortress leg was asked and none of its options carries it on/);
});

test('(b) stand_by_spawner says no shield is carried, and the trials\' own box-vs-open comparison at this health', () => {
  const es = require('../src/empty-spawner');
  const { bot, goal } = spawnerBot({ shield: false });
  const known = es.knownSpawner(bot, goal);
  const tree = es.options(bot, { check() {} }, goal, () => {}, {}, known);
  assert.match(tree.stand_by_spawner.description, /No shield is carried: every fireball that lands is taken in full\./);
  assert.match(tree.stand_by_spawner.description, /with a box held \d+ fights.*in the open \d+ fights/);
  const { bot: armed } = spawnerBot({ shield: true });
  const armedTree = es.options(armed, { check() {} }, goal, () => {}, {}, es.knownSpawner(armed, goal));
  assert.doesNotMatch(armedTree.stand_by_spawner.description, /No shield is carried/);
});

test('(c) the hunt\'s bunker fallback does not preempt a box that is building or holding at the cage', async () => {
  const { prepareMobHunt } = require('../src/mob-hunt');
  const { isSetAside } = require('../src/progress');
  const { Task } = require('../src/skills');
  // A minimal open-ground bot: two blazes in view, ranged, no wall nearby,
  // so the "cornered" fallback (raiseCover/bunkerFight) would otherwise run.
  function bunkerBot() {
    const here = new Vec3(0, 64, 0);
    const entities = { 1: { id: 1, name: 'blaze', position: here.offset(6, 0, 0), height: 1.8, width: 0.6, isValid: true },
      2: { id: 2, name: 'blaze', position: here.offset(-6, 0, 0), height: 1.8, width: 0.6, isValid: true } };
    const bot = Object.assign(new EventEmitter(), {
      registry, version: '26.1', entity: { position: here.clone(), onGround: true }, health: 20, food: 20, oxygenLevel: 20,
      game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 6000 }, entities,
      inventory: { slots: (() => { const s = Array(46).fill(null); s[36] = { name: 'iron_sword', count: 1, slot: 36 }; s[5] = { name: 'iron_helmet', slot: 5 }; s[6] = { name: 'iron_chestplate', slot: 6 }; s[7] = { name: 'iron_leggings', slot: 7 }; s[8] = { name: 'iron_boots', slot: 8 }; s[45] = { name: 'shield', slot: 45 }; return s; })(), items: function () { return this.slots.filter(Boolean); } },
      blockAt: () => ({ name: 'air', boundingBox: 'empty' }), findBlocks: () => [], world: { raycast: () => null },
      pathfinder: { movements: { canDig: true, allow1by1towers: true, allowParkour: false, scafoldingBlocks: [1] }, setGoal: () => {}, getPathTo: () => ({ status: 'success', path: [] }) },
      clearControlStates: () => {}, lookAt: async () => {}, activateItem: () => {}, deactivateItem: () => {}, attack: () => {}, dig: async () => {},
    });
    Object.defineProperty(bot, 'heldItem', { get: () => bot.inventory.slots[36] });
    const goal = { kind: 'win', mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 4 } };
    return { bot, goal };
  }
  const actions = { navigate: async () => {}, acquireStep: async () => {}, enterNether: async () => {} };

  const { bot, goal } = bunkerBot();
  await prepareMobHunt(bot, new Task('hunt'), { entity: 'blaze', item: 'blaze_rod', count: 1 }, goal, () => {}, actions);
  assert.equal(isSetAside(goal, 'hunt_cover', 'blaze'), true, 'baseline: cornered by two blazes in view, the cover/bunker fallback runs');

  const { bot: held, goal: heldGoal } = bunkerBot();
  heldGoal.intention = { q: 'empty_spawner', choice: 'box_here', path: 'empty_spawner/box_here', at: Date.now(), target: { x: 30, y: 64, z: 0 }, dimension: 'the_nether', health: 20 };
  await prepareMobHunt(held, new Task('hunt'), { entity: 'blaze', item: 'blaze_rod', count: 1 }, heldGoal, () => {}, actions);
  assert.equal(isSetAside(heldGoal, 'hunt_cover', 'blaze'), false, 'a box building or holding: not preempted for a fresh bunker');
});

test('(d) fortress_visit is not asked while already at a live spawner still owed rods, only when not', async () => {
  const { huntObserved } = require('../src/mob-hunt');
  const fortressVisit = require('../src/fortress-visit');
  const { Task } = require('../src/skills');
  const client = { systemOne: async ({ questions }) => { const opts = Object.keys(questions.branch_0.criteria); const pick = opts.includes('defer') ? 'defer' : opts.includes('heal_first') ? 'heal_first' : opts[0]; return { answers: { branch_0: { choice: pick, confidence: 0.9 } } }; } };
  let called = 0;
  const orig = fortressVisit.ask;
  fortressVisit.ask = async (...args) => { called++; return orig(...args); };
  try {
    const { bot, goal } = spawnerBot({ blazes: [[10, 7]], withCage: true, targetCount: 4, blocked: true });
    await huntObserved(bot, new Task('hunt'), goal, () => {}, { navigate: async () => {} }, client);
    assert.equal(called, 0, 'already at the fortress\'s own live spawner: not asked as if approaching one');
    called = 0;
    const { bot: away, goal: awayGoal } = spawnerBot({ blazes: [[10, 7]], withCage: false, rodsCarried: 0, targetCount: 20, blocked: true });
    await huntObserved(away, new Task('hunt'), awayGoal, () => {}, { navigate: async () => {} }, client);
    assert.equal(called, 1, 'no known live spawner here: the visit is asked as before');
  } finally { fortressVisit.ask = orig; }
});
