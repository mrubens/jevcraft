'use strict';
// What a wait waits for (note 698, src/waits.js): every wait option names
// the event it waits for and when, and is not offered where that cannot come
// or its coming changes nothing, said as a fact (waitsForNothing). From
// 25591 (mid-242-jb, test/fixtures/waits-698.json): leave_nether wait_here
// chosen 32 times of 32, at 22:19:54Z said as "standing here idle about 30
// minutes" for a rods step set aside "to go on without the stone pickaxe
// this crimson stem is for".
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const waits = require('../src/waits');
const { decide } = require('../src/decisions');
const { Task } = require('../src/skills');
const fx = require('./fixtures/waits-698.json');

const nether = (extra = {}) => ({ game: { dimension: 'the_nether' }, health: 20, food: 19, ...extra });
const overworld = (t, extra = {}) => ({ game: { dimension: 'overworld' }, time: { timeOfDay: t }, health: 20, food: 20, ...extra });

test('a rest\'s end: named with when; idle for a cause standing still does not change, it waits for nothing', () => {
  const now = Date.parse('2026-09-29T22:19:54Z'), until = now + 30 * 60000;
  const idle = waits.restEnds(nether(), { what: 'the rods step\'s rest', until, cause: fx.windows[0].why, idle: true, now });
  assert.equal(idle.comes, false);
  assert.equal(idle.says, 'Nothing it waits for comes: the rods step\'s rest ends in about 30 minutes (at 22:49Z), but it rests for this: Jev chose to go on without the stone pickaxe this crimson stem is for, wanted for the stair to the portal, which ends here for now; standing here changes none of that, so the work meets the same when it ends.');
  // With work on offer meanwhile the wait is that work: named, offered.
  const work = waits.restEnds(nether(), { what: 'the rods step\'s rest', until, cause: fx.windows[0].why, idle: false, now });
  assert.equal(work.comes, true);
  assert.equal(work.says, 'It waits for the rods step\'s rest to end, in about 30 minutes (at 22:49Z).');
  // Mobs that see or shoot the bot move, and time can change that; a mob
  // named in an option's name ("go to blazes about") is not such a cause.
  assert.equal(waits.restEnds(nether(), { what: 'the span\'s rest', until, cause: 'Not bridging with a piglin 17 blocks off able to see me', idle: true, now }).comes, true);
  assert.equal(waits.restEnds(nether(), { what: 'the leg\'s rest', until, cause: 'go to blazes about: Tried 2 times ... and it came to nothing', idle: true, now }).comes, false);
  // Health comes back standing only at hunger eighteen or more.
  assert.equal(waits.restEnds(nether({ health: 8, food: 19 }), { what: 'x', until, cause: 'too little health for the walk', idle: true, now }).comes, true);
  assert.equal(waits.restEnds(nether({ health: 8, food: 12 }), { what: 'x', until, cause: 'too little health for the walk', idle: true, now }).comes, false);
  // A cause not known is not taken as nothing.
  assert.equal(waits.restEnds(nether(), { what: 'x', until, cause: '', idle: true, now }).comes, true);
});

test('daylight, health, a spawner, a timer: each said with its time, or why it does not come', () => {
  assert.equal(waits.daylight(nether()).comes, false);
  assert.match(waits.daylight(nether()).says, /no daylight comes here: the Nether has no day/);
  assert.equal(waits.daylight(overworld(6000)).comes, false, 'by day, daylight is what it has');
  const night = waits.daylight(overworld(17000));
  assert.equal(night.comes, true);
  assert.match(night.says, /^It waits for daylight, in about 5 minutes/);
  assert.equal(waits.heal(overworld(6000, { health: 12, food: 12 })).comes, false);
  assert.equal(waits.heal(overworld(6000, { health: 12, food: 19 })).says, 'It waits for health back to 20 from 12, in about 32 seconds.');
  assert.equal(waits.spawnerTry({}, null).says, 'It waits for the spawner\'s next blazes, in 0 to 40 seconds.');
  assert.equal(waits.timer('the furnace to finish the 3 beef', 30000).says, 'It waits for the furnace to finish the 3 beef, in about 30 seconds.');
  assert.equal(waits.mobsMoveOff('the mobs outside').says, 'It waits for the mobs outside to move off, at no set time.');
});

test('decide takes out a wait for nothing and says it in the facts; a question of waits only keeps them, each said; the stances keep theirs', async () => {
  const none = waits.event('daylight', { comes: false, why: 'no daylight comes here: the Nether has no day' });
  let asked = null;
  const client = { systemOne: async ({ state, questions }) => { asked = { state, criteria: questions.branch_0.criteria }; return { answers: { branch_0: { choice: Object.keys(questions.branch_0.criteria)[0], confidence: 0.9 } } }; } };
  const tree = { go_back: { description: 'Go back.' }, search_on: { description: 'Search on.' }, wait_here: { description: 'Wait here.', waits: none } };
  await decide('leave_nether', { client, bot: null, goal: {}, tree, state: { dimension: 'nether' } });
  assert.deepEqual(Object.keys(asked.criteria).sort(), ['go_back', 'search_on']);
  assert.deepEqual(asked.state.waitsForNothing, ['wait here: not offered. Nothing it waits for comes: no daylight comes here: the Nether has no day.']);
  // Only waits for nothing: kept, each saying so.
  const g = waits.gate('x', { a: { description: 'Stay.', waits: none } });
  assert.equal(g.tree.a.description, 'Stay. Nothing it waits for comes: no daylight comes here: the Nether has no day.');
  assert.deepEqual(g.facts, []);
  // Said, never left out (SAY_ONLY).
  assert.ok(waits.gate('encounter_stance', { a: { description: 'A', waits: none }, b: { description: 'B' } }, { sayOnly: true }).tree.a);
});

// 25591's body at 22:43:07Z, as recorded.
function recorded(w) {
  const items = Object.entries(w.inventory).map(([name, count], slot) => ({ name, count, type: registry.itemsByName[name]?.id ?? 0, slot: 9 + slot, durabilityUsed: 0 }));
  const here = new Vec3(w.position.x, w.position.y, w.position.z), floorY = Math.floor(here.y);
  const bot = { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: w.health, food: w.food, isAlive: true, chat() {}, emit() {},
    entity: { id: 1, position: here.clone(), onGround: true }, time: { timeOfDay: 6000 }, entities: {},
    inventory: { items: () => items, slots: [] }, findBlocks: () => [], clearControlStates() {},
    blockAt: p => ({ position: p, name: p.y < floorY ? 'netherrack' : 'air', boundingBox: p.y < floorY ? 'block' : 'empty' }),
    pathfinder: { movements: { blocksCantBreak: new Set() }, setGoal() {}, getPathTo: () => ({ status: 'noPath', path: [] }) } };
  const goal = { kind: 'win', request: 'beat the game', from: 'TestPlayer', survival: {}, rungTime: { phase: 'obtain_blaze_rods' }, portals: [{ x: 0, y: 70, z: 223, dimension: 'overworld' }] };
  require('../src/game-progress').observeProgress(bot, goal);
  return { bot, goal };
}

test('25591 mid-242-jb: leave_nether\'s idle wait for a rods step set aside for want of a pickaxe is not offered, the why said; with work on offer it is, its end named (note 698)', async t => {
  const { leaveNetherStep } = require('../src/game-progress');
  for (const w of fx.windows) {
    const T0 = Date.parse(w.at);
    t.mock.timers.enable({ apis: ['Date'], now: T0 });
    const stage = { phase: 'obtain_blaze_rods', action: 'rods_waiting', until: T0 + 30 * 60000, why: w.why };
    for (const idle of [true, false]) {
      const { bot, goal } = recorded(w);
      const asked = [], holds = [];
      const client = { systemOne: async ({ state, questions }) => { asked.push({ state, criteria: questions.branch_0.criteria }); const keys = Object.keys(questions.branch_0.criteria); return { answers: { branch_0: { choice: keys.includes('wait_here') ? 'wait_here' : keys[0], confidence: 0.8 } } }; } };
      const actions = { client, rest_work: async () => ({ idle, says: idle ? 'Nothing else is on offer from here meanwhile.' : 'Work on offer meanwhile from here: Fetch 2 stems of the Nether\'s forests now.' }),
        hold_for_rest: async (b, tk, g, sv, opts) => { holds.push(opts); return true; }, return_overworld: async () => {} };
      const logs = []; const log = console.log; console.log = (...a) => logs.push(a.join(' '));
      try { await leaveNetherStep(bot, new Task('rods'), goal, () => {}, stage, actions, T0); } finally { console.log = log; }
      if (idle) {
        assert.equal(asked[0].criteria.wait_here, undefined, w.at);
        assert.match(asked[0].state.waitsForNothing[0], new RegExp(`^wait here: not offered\\. Nothing it waits for comes: the rods step's rest ends in about 30 minutes .*, but it rests for this: ${w.why.slice(0, 40)}.*standing here changes none of that`));
        assert.equal(holds.length, 0, 'no idle hold');
        assert.ok(logs.some(l => /^\[waits\] leave_nether: wait here: not offered/.test(l)));
      } else {
        assert.match(asked[0].criteria.wait_here, /until the rods step's rest ends, taken up again in 30 minutes/);
        assert.equal(holds.length, 1);
      }
    }
    t.mock.timers.reset();
  }
});

test('25591: an idle wait_here held from before for such a rest is not held on, the question is asked again (note 698)', async t => {
  const { leaveNetherStep } = require('../src/game-progress');
  const w = fx.windows[0], T0 = Date.parse(w.at);
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const stage = { phase: 'obtain_blaze_rods', action: 'rods_waiting', until: T0 + 30 * 60000, why: w.why };
  const { bot, goal } = recorded(w);
  goal.leaveNether = { reason: 'obtain_blaze_rods', pick: 'wait_here', until: stage.until, at: T0 - 60000, idle: true };
  let asked = 0; const holds = [];
  const client = { systemOne: async ({ questions }) => { asked++; return { answers: { branch_0: { choice: Object.keys(questions.branch_0.criteria)[0], confidence: 0.8 } } }; } };
  const actions = { client, rest_work: async () => ({ idle: true, says: 'Nothing else is on offer from here meanwhile.' }), hold_for_rest: async (...a) => { holds.push(a); return true; }, return_overworld: async () => {} };
  const log = console.log; console.log = () => {};
  try { await leaveNetherStep(bot, new Task('rods'), goal, () => {}, stage, actions, T0); } finally { console.log = log; }
  assert.equal(holds.length, 0);
  assert.equal(asked, 1);
  assert.notEqual(goal.leaveNether.pick, 'wait_here');
});

test('a pocket off the Overworld with no mob within 16 or in sight and nothing to gain: the stay waits for nothing (notes 679, 698)', () => {
  const { pocketWaitSays } = require('../src/pocket-wait');
  const now = Date.now();
  const bot = { game: { dimension: 'the_nether' }, health: 20, food: 19, entity: { position: new Vec3(0, 60, 0) }, entities: {} };
  const state = { pocketWait: { since: now - 90000, mobs: {} } };
  const said = pocketWaitSays(bot, state, {}, { near: [], outside: [], now });
  assert.equal(said.waitsForNothing, true);
  assert.equal(said.waits.comes, false);
  assert.equal(said.waits.says, 'Nothing it waits for comes: no mob is within 16 blocks or in sight, no daylight comes here, and health is full.');
  // A mob in sight 30 blocks off is something to wait on.
  const seen = pocketWaitSays(bot, state, {}, { near: [{ entity: { id: 9, name: 'ghast' }, distance: 30, visible: true }], outside: [], now });
  assert.equal(seen.waitsForNothing, false);
  assert.equal(seen.waits, null);
});
