'use strict';
// Note 731: 25598 (mid-242-uc), 3 of 4 blaze rods, stood at (-104, 77, 154)
// beside the spawner with 17 to 21 blazes about for over an hour, unable to
// finish. Three things fed the loop, replayed here without Minecraft:
//
//   (a) the work step's own guard (checkThreats, called from every dig and
//       walk) threw "Threat nearby: blaze at N blocks" on the very blaze the
//       box or slit was built to fight, cutting open_slit a second after it
//       was chosen, one dig into its own job (src/danger.js immediateThreat).
//   (b) hunt_target's defer said only that the situation was "unsuitable",
//       not what deferring cost at a capped, still-owed spawner, and the
//       open fight did not say a box or slit was offered too (src/mob-
//       hunt.js).
//   (c) turn_priority's ruling broke on "a newcomer within six blocks"
//       every 9 to 15 seconds as individual blazes of the one capped swarm
//       drifted across that ring, with nothing else changed (src/arbiter.js
//       observe, broken).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');

const CAGE = new Vec3(-100, 77, 154);
const HERE = new Vec3(-104, 77, 154); // 4 blocks from the cage, as 25598 stood

// A bare bot at a live spawner still owed rods: 3 of 4 blaze_rod carried,
// the cage known through fortressSearch's map (as empty-spawner.js
// knownSpawner reads it), found by findBlocks (as blaze-stand.js spawnerAt
// reads it, the hunt's own path to the cage) and standing as a spawner
// block; ground below the bot's feet, open air at and above it.
function spawnerBot({ position = HERE, rodsCarried = 3, targetCount = 4, blazes = [] } = {}) {
  const entities = {};
  blazes.forEach(([distance, id], i) => {
    entities[id ?? i + 1] = { id: id ?? i + 1, name: 'blaze', position: position.offset(distance, 0, 0), height: 1.8, width: 0.6, isValid: true };
  });
  const spawnerCell = p => p.x === CAGE.x && p.y === CAGE.y && p.z === CAGE.z;
  const bot = Object.assign(new EventEmitter(), {
    registry, version: '26.1',
    entity: { position: position.clone(), onGround: true }, health: 20, food: 19, oxygenLevel: 20,
    game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, time: { timeOfDay: 6000 },
    entities,
    inventory: { items: () => (rodsCarried ? [{ name: 'blaze_rod', count: rodsCarried }] : []) },
    blockAt: p => spawnerCell(p) ? { name: 'spawner', boundingBox: 'block' }
      : p.y < position.y ? { name: 'netherrack', boundingBox: 'block', diggable: true, hardness: 0.4 } : { name: 'air', boundingBox: 'empty' },
    findBlocks: ({ matching }) => (matching === registry.blocksByName.spawner.id ? [CAGE] : []),
    world: { raycast: () => null },
    pathfinder: { movements: { canDig: true, allow1by1towers: true, allowParkour: false, scafoldingBlocks: [1] }, setGoal: () => {}, getPathTo: () => ({ status: 'success', path: [] }) },
    clearControlStates: () => {}, lookAt: async () => {}, activateItem: () => {}, deactivateItem: () => {},
    attack: () => {}, dig: async () => {},
  });
  const goal = { kind: 'win', mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount },
    fortressSearch: { map: { spawners: [{ x: CAGE.x, y: CAGE.y, z: CAGE.z }] } } };
  bot._goal = goal;
  return { bot, goal };
}

test('cageFight reads 25598\'s scene as a live spawner one rod short', () => {
  const { cageFight } = require('../src/cage-hold');
  const { bot, goal } = spawnerBot();
  const f = cageFight(bot, goal);
  assert(f, 'at a live cage owed rods');
  assert.equal(f.need, 1);
  assert.equal(f.off, 5); // centre offset: 4 blocks to the cage's block, ~4.5 to its centre
});

test('(a) a blaze in reach at a live, still-owed spawner is the work, not a threat that ends it: checkThreats does not throw for it, but a real melee blaze still does', () => {
  const { checkThreats } = require('../src/danger');
  // The blaze at 4 blocks that cut 25598's open_slit a second in.
  const { bot } = spawnerBot({ blazes: [[4, 1]] });
  assert.doesNotThrow(() => checkThreats(bot), 'the spawner\'s own blaze, beyond arm\'s length, does not abort the work at its own cage');
  // Closed to arm's length, it is still the body's own danger.
  const { bot: close } = spawnerBot({ blazes: [[2, 1]] });
  assert.throws(() => checkThreats(close), { name: 'NeedsSafety' }, 'a blaze at arm\'s length still throws, cage or not');
  // The same blaze at 4 blocks with no rods owed (no live spawner fight) is
  // an ordinary threat again: the exemption is for the spawner job alone.
  const { bot: noJob } = spawnerBot({ blazes: [[4, 1]], rodsCarried: 4 });
  assert.throws(() => checkThreats(noJob), { name: 'NeedsSafety' }, 'nothing owed at this cage: the guard runs as it always did');
});

test('(c) turn_priority\'s ruling at a live, still-owed spawner is not broken by "a newcomer within six blocks" as the capped swarm\'s blazes drift in and out of it', async () => {
  const arbiter = require('../src/arbiter');
  const claim = (layer, extra = {}) => ({ layer, action: `${layer}_step`, urgency: 'routine', facts: {}, run: async () => true, ...extra });
  const mob = (distance, id) => ({ entity: { name: 'blaze', id }, distance, visible: true });
  const { bot, goal } = spawnerBot();
  const state = {};
  let asked = 0;
  const decide = async () => { asked++; return { path: ['work'] }; };
  const claims = () => [claim('hunt'), claim('work')];
  const at = (now, mobs) => arbiter.arbitrate(bot, claims(), { state, goal, decide, now, mobs });
  assert.equal((await at(0, [mob(4, 1), mob(5, 2)])).by, 'jev');
  assert.equal(asked, 1);
  // A different blaze of the same swarm wanders within six blocks: at an
  // ordinary scene this alone reads as "a newcomer within six blocks"
  // (arbiter.test.js), but at this capped, still-owed cage it is not news.
  const held = await at(1000, [mob(4, 1), mob(3, 3)]);
  assert.equal(held.by, 'held', `expected the ruling to hold, got broken: ${held.why}`);
  assert.equal(asked, 1);
  // Several passes of pure blaze churn within six blocks: still held.
  const churn = await at(9000, [mob(2, 9), mob(5, 10), mob(1, 11)]);
  assert.equal(churn.by, 'held');
  assert.equal(asked, 1);
  // A mob that is not part of the spawner's own kind is still news.
  const other = await at(10000, [mob(4, 1), { entity: { name: 'wither_skeleton', id: 99 }, distance: 5, visible: true }]);
  assert.equal(other.why, 'a newcomer within six blocks');
});

test('(b) hunt_target\'s defer says the cage\'s own cap and how many times running it was already chosen with nothing come of it; the open fight says a box or slit is offered too', async () => {
  const { huntObserved } = require('../src/mob-hunt');
  const { Task } = require('../src/skills');
  const { bot, goal } = spawnerBot({ blazes: [[4, 7]] });
  bot.entities[7].uuid = 'the-one-rod-short';
  const task = new Task('hunt');
  let asked = null;
  const client = { systemOne: async ({ state, questions }) => { asked = { state, options: questions.branch_0.criteria }; return { answers: { branch_0: { choice: 'defer', confidence: 0.9 } } }; } };
  await huntObserved(bot, task, goal, () => {}, { navigate: async () => {} }, client);
  assert(asked, 'asked');
  const hunt = Object.keys(asked.options).find(k => /^hunt_\d+$/.test(k));
  assert.match(asked.options.defer, /of the spawner's own kind/, 'the cage\'s own cap is said on defer');
  assert.doesNotMatch(asked.options.defer, /Chosen \d+ times? running/, 'the first defer has no streak yet');
  assert(hunt, 'the open fight is offered');
  assert.match(asked.options[hunt], /A box or a slit built at the cage is offered too/);
  assert.equal(goal.huntDeferStreak, 1, 'the streak counts the defer just chosen');

  // Asked again with the streak already at two: the cost is said, not
  // just "unsuitable" again (note 731: 25598 deferred at 07:25:18 and
  // 07:30:49 against the one blaze it needed for its last rod, each told
  // nothing of the one before it).
  goal.huntDeferStreak = 2;
  const { bot: bot2 } = spawnerBot({ blazes: [[4, 8]] });
  bot2.entities[8].uuid = 'the-one-rod-short-again';
  await huntObserved(bot2, new Task('hunt'), goal, () => {}, { navigate: async () => {} }, client);
  assert.match(asked.options.defer, /Chosen 2 times running against this cage: nothing has changed since/);
  assert.equal(goal.huntDeferStreak, 3);

  // A fight, not a defer, clears the streak: it did not change nothing.
  const target = Object.keys(asked.options).find(k => /^hunt_\d+$/.test(k));
  const fought = { systemOne: async ({ questions }) => ({ answers: { branch_0: { choice: Object.keys(questions.branch_0.criteria).find(k => /^hunt_\d+$/.test(k)) || target, confidence: 0.9 } } }) };
  const { bot: bot3 } = spawnerBot({ blazes: [[4, 9]] });
  bot3.entities[9].uuid = 'the-one-rod-short-fought';
  try { await huntObserved(bot3, new Task('hunt'), goal, () => {}, { navigate: async () => {} }, fought); } catch (_) { /* the fight itself is not this test's point */ }
  assert.equal(goal.huntDeferStreak, undefined, 'a fight, not a defer, clears the streak');
});
