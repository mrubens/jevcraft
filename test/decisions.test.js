'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideTree } = require('../src/decisions');
const { TypeSafe } = require('../src/typesafe');

const tree = () => ({
  build_house: { description: 'Build the requested house', children: {
    materials: { description: 'Gather wood', children: { near: { description: 'Nearby accessible tree' }, far: { description: 'Distant tree' } } },
    build: { description: 'Place carried materials', children: { place: { description: 'Place the next supported block' } } },
  } },
  eat: { description: 'Restore hunger', children: { carried: { description: 'Use safe food in inventory', children: { consume: { description: 'Eat the apple' } } } } },
});

test('nested decisions batch explicit conditional branches and follow only the chosen path', async () => {
  const result = await decideTree({ systemOne: async ({ questions }) => {
    assert.equal(Object.keys(questions).length, 3);
    assert.match(questions.branch_1.instructions.task, /Assuming.*build_house/);
    return { answers: { branch_0: { choice: 'eat', confidence: 0.9 }, branch_1: { choice: 'unavailable' }, branch_2: { choice: 'far' } } };
  } }, { state: { food: 8 }, tree: tree() });
  assert.deepEqual(result.path, ['eat', 'carried', 'consume']);
  assert.equal(result.judgments.length, 1);
});

test('a changed world discards a decision before it reaches an action', async () => {
  const result = await decideTree({ systemOne: async () => ({ answers: {} }) }, { state: {}, tree: tree(), isFresh: () => false });
  assert(result.stale);
  assert.equal(result.action, undefined);
});

test('a domain action question overrides only the root and retains independent conditional child questions', async () => {
  const rootInstructions = { task: 'Choose the next feasible combat action', mechanics: 'Flying targets can be hurt.' };
  await decideTree({ systemOne: async ({ questions }) => {
    assert.deepEqual(questions.branch_0.instructions, rootInstructions);
    assert.match(questions.branch_1.instructions.task, /Assuming.*build_house/);
    return { answers: { branch_0: { choice: 'eat' } } };
  } }, { state: {}, tree: tree(), rootInstructions });
});

test('unavailable selected options fail closed and singleton branches need no inference', async () => {
  await assert.rejects(decideTree({ systemOne: async () => ({ answers: { branch_0: { choice: 'invented' } } }) }, { state: {}, tree: tree() }), /unavailable/);
  const result = await decideTree({ systemOne: () => assert.fail('No choice needs inference') }, { state: {}, tree: { only: { description: 'One feasible action' } } });
  assert.deepEqual(result.path, ['only']);
});

test('cancelling an in-flight Jev call aborts fetch without retrying', async () => {
  const original = global.fetch;
  const controller = new AbortController();
  let calls = 0;
  global.fetch = async (_url, { signal }) => { calls++; return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    setTimeout(() => controller.abort(new Error('stopped by player')), 20);
  }); };
  try {
    await assert.rejects(new TypeSafe({ apiKey: 'unit-test', maxRetries: 2 }).systemOne({ state: {}, questions: {}, signal: controller.signal }), /stopped by player/);
    assert.equal(calls, 1);
  } finally { global.fetch = original; }
});

test('a Jev outage walks the tree with the fallback rule and says so, while cancellations and rejections still throw', async () => {
  const { TypeSafeError } = require('../src/typesafe');
  const down = { systemOne: async () => { throw new TypeSafeError('TypeSafe 503: no healthy upstream', { status: 503 }); } };
  const fallback = (children, path) => path.length ? Object.keys(children)[0] : 'eat';
  const result = await decideTree(down, { state: {}, tree: tree(), fallback });
  assert.deepEqual(result.path, ['eat', 'carried', 'consume']);
  assert.equal(result.fallback.status, 503); assert.deepEqual(result.judgments, []);
  assert.equal(result.asked.branch_0 !== undefined, true, 'the questions that would have been asked are still recorded');
  await assert.rejects(decideTree(down, { state: {}, tree: tree() }), /503/, 'no fallback rule, no fallback');
  const rejected = { systemOne: async () => { throw new TypeSafeError('TypeSafe 400: bad question', { status: 400 }); } };
  await assert.rejects(decideTree(rejected, { state: {}, tree: tree(), fallback }), /400/, 'a rejected request is a bug, not an outage');
  const controller = new AbortController(); const cancelled = new Error('Cancelled'); cancelled.name = 'Cancelled';
  const aborting = { systemOne: async () => { controller.abort(cancelled); throw new Error('aborted'); } };
  await assert.rejects(decideTree(aborting, { state: {}, tree: tree(), fallback, signal: controller.signal }), { name: 'Cancelled' });
});

test('the outage is announced once and its end once, and the first listed option is the default unless a node claims it', async () => {
  const { announceFallback, firstOption } = require('../src/decisions');
  const said = [], bot = { chat: line => said.push(line) }, goal = {};
  announceFallback(bot, goal, { fallback: { reason: 'TypeSafe 503' } });
  announceFallback(bot, goal, { fallback: { reason: 'TypeSafe 503' } });
  assert.equal(said.length, 1); assert.equal(goal.jevOutage.reason, 'TypeSafe 503');
  announceFallback(bot, goal, { judgments: [{}] });
  announceFallback(bot, goal, { judgments: [{}] });
  assert.deepEqual(said, ["Jev isn't answering right now, so I'm going with the safe default until it is.", 'Jev is back.']);
  assert.equal(goal.jevOutage, undefined);
  assert.equal(firstOption({ a: {}, b: {} }), 'a');
  assert.equal(firstOption({ a: {}, b: { fallback: true } }), 'b');
});

test('every question about playing the game is told how the bot died lately', async () => {
  // The user's suggestion (2026-09-26): it walked back to the drowned that had just killed it, told nothing.
  const { decide, recentDeaths } = require('../src/decisions');
  const { Vec3 } = require('vec3');
  const bot = { entity: { position: new Vec3(0, 64, 0) }, game: { dimension: 'overworld' } };
  const goal = { survival: { deaths: [{ at: new Date(Date.now() - 120000).toISOString(), position: { x: 30, y: 60, z: 40 }, dimension: 'overworld', cause: 'was impaled by Drowned',
    about: [{ name: 'drowned', distance: 13 }], worn: [], food: 12, lastChoice: { question: 'encounter_stance', choice: 'retreat', secondsBefore: 4 } }] } };
  const said = recentDeaths(bot, goal);
  assert.equal(said.length, 1);
  assert.equal(said[0].cause, 'was impaled by Drowned');
  assert.match(said[0].where, /^50 blocks from here/);
  assert.equal(said[0].lastChoice, 'retreat (encounter stance, 4 seconds before)');
  let seen = null;
  const client = { systemOne: async ({ state }) => { seen = state; return { answers: { branch_0: { choice: 'go_back', confidence: 0.9 } } }; } };
  await decide('corpse_run', { client, bot, goal, tree: { go_back: { description: 'a' }, leave_them: { description: 'b' } }, state: { distance: 50 } });
  assert.equal(seen.recentDeaths?.[0]?.cause, 'was impaled by Drowned');
});

test('every question about playing the game is told the nights without sleep and when phantoms come', async () => {
  // mid-231-e was killed by phantoms, told of them only in one option of one question.
  const { decide } = require('../src/decisions');
  const bot = { entity: { position: { x: 0, y: 64, z: 0 } }, game: { dimension: 'overworld' }, time: { age: 100000 } };
  const goal = { survival: { sleptAtAge: 100000 - 3 * 24000 - 100 } };
  let seen = null;
  const client = { systemOne: async ({ state }) => { seen = state; return { answers: { branch_0: { choice: 'go_back', confidence: 0.9 } } }; } };
  await decide('corpse_run', { client, bot, goal, tree: { go_back: { description: 'a' }, leave_them: { description: 'b' } }, state: {} });
  assert.equal(seen.nightsWithoutSleep, 3);
  assert.match(seen.phantoms, /phantoms are coming at night now/);
});

test('every question about playing the game is told the run clock: minutes played, milestones and where the minutes went', async () => {
  // mid-207-i kept a surface frame through three askings, seventy minutes on the way into the Nether, told only of the twenty just gone.
  const { decide } = require('../src/decisions');
  const { noteTrail } = require('../src/stillness');
  const t0 = Date.now() - 80 * 60000;
  const goal = { kind: 'win', gameProgress: { version: 1, startedAt: t0, milestones: {}, phase: 'enter_nether' }, rungTime: { phase: 'enter_nether' }, step: { action: 'collect_lava' } };
  const bot = { entity: { position: { x: 0, y: 64, z: 0 } }, game: { dimension: 'overworld' } };
  for (let t = t0; t < t0 + 70 * 60000; t += 15000) noteTrail(bot, goal, t);
  for (let t = t0 + 70 * 60000; t <= t0 + 80 * 60000; t += 15000) { goal.survivalAction = { action: 'seal_shelter', at: new Date(t).toISOString() }; noteTrail(bot, goal, t); }
  goal.gameProgress.milestones.nether_entered = { at: t0 + 79 * 60000 };
  let seen = null, said = null;
  const client = { systemOne: async ({ state, rootInstructions, instructions }) => { seen = state; said = rootInstructions || instructions; return { answers: { branch_0: { choice: 'go_back', confidence: 0.9 } } }; } };
  await decide('corpse_run', { client, bot, goal, tree: { go_back: { description: 'a' }, leave_them: { description: 'b' } }, state: {} });
  assert.equal(seen.runClock?.minutesPlayed, 80);
  assert.equal(seen.runClock.minutesBy['enter nether: collect lava'], 70);
  assert.equal(seen.runClock.lastHalfHourBy['seal shelter'], 10);
  assert.equal(seen.runClock.reached['nether entered'], '79 minutes in');
});

test('the portal way question, a work question, is told the run clock too', async () => {
  // It is the question mid-207-i kept answering with its surface frame, and it was left out of the time facts.
  const { decide } = require('../src/decisions');
  const goal = { gameProgress: { version: 1, startedAt: Date.now() - 60000, milestones: {}, clock: { startedAt: Date.now() - 60000, lastAt: Date.now(), playedMs: 60000, byDoing: { 'enter_nether: fill_bucket': 60000 } } } };
  let seen = null, said = null;
  const client = { systemOne: async ({ state, rootInstructions }) => { seen = state; said = rootInstructions; return { answers: { branch_0: { choice: 'cast_frame', confidence: 0.9 } } }; } };
  await decide('portal_method', { client, bot: null, goal, tree: { cast_frame: { description: 'a' }, build_new: { description: 'b' } }, state: {} });
  assert.equal(seen.runClock?.minutesPlayed, 1);
});
