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

test('every question about playing the game offers "none of these options are good": recorded, and the best listed option taken instead', async () => {
  // The user (2026-09-27): a way for Jev to say the move a player would make is missing, recorded for us to add.
  const fs = require('fs'), os = require('os'), path = require('path');
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jev-')), 'missing.jsonl');
  const env = { NONE: process.env.JEV_NONE_GOOD, LOG: process.env.JEV_MISSING_OPTIONS };
  process.env.JEV_NONE_GOOD = '1'; process.env.JEV_MISSING_OPTIONS = log;
  try {
    const { decide } = require('../src/decisions');
    let offered = null;
    const client = { systemOne: async ({ questions }) => { offered = Object.keys(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'none_good', confidence: 0.7, probabilities: { none_good: 0.6, leave_them: 0.3, go_back: 0.1 } } } }; } };
    const goal = {};
    const r = await decide('corpse_run', { client, bot: null, goal, tree: { go_back: { description: 'a' }, leave_them: { description: 'b' } }, state: { distance: 50 } });
    assert(offered.includes('none_good'), offered.join(','));
    assert.deepEqual(r.path, ['leave_them'], 'the best listed option taken instead');
    assert.equal(r.noneGood, true);
    const entry = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').at(-1));
    assert.equal(entry.question, 'corpse_run'); assert.deepEqual(entry.tookInstead, ['leave_them']); assert.equal(entry.options.go_back, 'a');
    assert.equal(goal.decisions.at(-1).noneGood, true);
    // A near flag: weighed a quarter or more, not taken, recorded all the same.
    const nearClient = { systemOne: async () => ({ answers: { branch_0: { choice: 'go_back', confidence: 0.4, probabilities: { go_back: 0.4, none_good: 0.33, leave_them: 0.27 } } } }) };
    const r2 = await decide('corpse_run', { client: nearClient, bot: null, goal: {}, tree: { go_back: { description: 'a' }, leave_them: { description: 'b' } }, state: {} });
    assert.deepEqual(r2.path, ['go_back']);
    const near = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').at(-1));
    assert.equal(near.near, true); assert.deepEqual(near.tookInstead, ['go_back']);
  } finally {
    if (env.NONE === undefined) delete process.env.JEV_NONE_GOOD; else process.env.JEV_NONE_GOOD = env.NONE;
    if (env.LOG === undefined) delete process.env.JEV_MISSING_OPTIONS; else process.env.JEV_MISSING_OPTIONS = env.LOG;
  }
});

test('the stance and the turn are told whether health comes back, the food carried by kind with rotten flesh\'s Hunger, the nearest food and the time to daylight (note 515)', async () => {
  // mid-231-o, mid-207-l, mid-211-x, mid-231-q: hurt, no healing under eighteen, told a bare hunger number; several carried rotten flesh.
  const { decide } = require('../src/decisions');
  const { Vec3 } = require('vec3');
  const registry = require('minecraft-data')('26.1');
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, game: { dimension: 'overworld', gameMode: 'survival' }, registry, health: 6, food: 14, time: { timeOfDay: 14000 },
    entities: { 7: { name: 'cow', position: new Vec3(12.5, 64, 0.5), isValid: true } }, inventory: { items: () => [{ name: 'rotten_flesh', count: 5 }, { name: 'cobblestone', count: 30 }] } };
  const asked = [];
  const answering = choice => ({ systemOne: async ({ state, questions }) => { asked.push({ state, said: JSON.stringify(questions) }); return { answers: { branch_0: { choice, confidence: 0.9 } } }; } });
  await decide('encounter_stance', { client: answering('eat'), bot, goal: {}, tree: { eat: { description: 'a' }, retreat: { description: 'b' } }, state: { health: 6 } });
  await decide('turn_priority', { client: answering('survival'), bot, goal: {}, tree: { survival: { description: 'a' }, work: { description: 'b' } }, state: { claims: ['survival', 'work'] } });
  assert.equal(asked.length, 2);
  for (const { state, said } of asked) {
    const h = state.healing;
    assert(h, 'the healing fact is on the state');
    assert.equal(h.health, 6); assert.equal(h.hunger, 14);
    assert.match(h.healthComesBack, /^no: hunger 14, under eighteen/);
    assert.match(h.foodCarried[0], /5 rotten flesh, 4 hunger each; each eaten has a 80% chance of Hunger for 30 seconds/);
    assert.match(h.eatingItAll, /brings hunger to 20, where health comes back/);
    assert.match(h.nearestFood[0], /a cow in view, 12 blocks off/);
    assert.match(h.daylight, /^night: dawn in about 8 real minutes/);
    assert.match(h.standingStill, /standing still spends no hunger/);
    assert.match(said, /healing is health, hunger, whether health comes back/);
  }
});

test('a decision records when it was asked beside when it was answered, and tells the flight at once', async () => {
  // note 530: the timeline read the answer's stamp as the asking and the
  // next step's frame as the answer.
  const { decide } = require('../src/decisions');
  const { EventEmitter } = require('node:events');
  const bot = new EventEmitter(); bot.entity = { position: { x: 0, y: 64, z: 0 } }; bot.game = { dimension: 'overworld' };
  const goal = {}, heard = [];
  bot.on('jev_decision', g => heard.push(g.decisions.at(-1)));
  const client = { systemOne: async () => { await new Promise(r => setTimeout(r, 30)); return { answers: { branch_0: { choice: 'go_back', confidence: 0.9 } } }; } };
  await decide('corpse_run', { client, bot, goal, tree: { go_back: { description: 'a' }, leave_them: { description: 'b' } }, state: {} });
  const entry = goal.decisions.at(-1);
  assert.ok(Date.parse(entry.askedAt) <= Date.parse(entry.at) - 25, `${entry.askedAt} then ${entry.at}`);
  assert.equal(heard.length, 1); assert.equal(heard[0], entry);
});

// Note 540: mid-243-q-nether-3's turn_priority said "asking Jev" for 5.6
// seconds while its task check threw at every look; whatever held the
// request under it, the question must end when it is stopped.
test('a question ends when its task check throws, even if the request under it never settles, and says so a second on', async () => {
  const { decide, endsWhenStopped } = require('../src/decisions');
  const { EventEmitter } = require('node:events');
  const bot = new EventEmitter(); bot.entity = { position: { x: 0, y: 64, z: 0 } }; bot.game = { dimension: 'overworld' };
  bot._turn = { holder: 'work', phase: 'mine', since: Date.now() };
  let stop = false, seen = null;
  const task = { check() { if (stop) { const e = new Error('Preempted by lava'); e.name = 'NeedsSafety'; throw e; } } };
  // A client that ignores the abort: the hang, whatever its cause.
  const client = { systemOne: ({ trace }) => { seen = trace; return new Promise(() => {}); } };
  setTimeout(() => { stop = true; }, 60).unref();
  const started = Date.now();
  const ended = decide('turn_priority', { client, bot, task, tree: { survival: { description: 'a' }, work: { description: 'b' } }, state: {}, watchMs: 20 });
  assert.equal(bot._asking?.id, 'turn_priority', 'the question out is on the bot for the flight frames');
  await assert.rejects(Promise.race([ended, new Promise((_, reject) => setTimeout(() => reject(new Error('still asking after two seconds')), 2000).unref())]),
    err => err.name === 'NeedsSafety');
  assert.ok(Date.now() - started < 1000);
  assert.equal(bot._turn.holder, 'work', 'the turn mark is given back');
  assert.equal(bot._asking, undefined);
  assert.deepEqual(seen.stages.map(s => s.stage), ['queued', 'asked', 'stopped']);
  assert.match(seen.stages[2].why, /Preempted by lava/);

  // Still out a second after the stop, it is said with its stages; settling
  // late, that is said too.
  const lines = [], controller = new AbortController();
  let settle;
  const trace = { id: 'q', t0: performance.now(), stages: [{ stage: 'queued', ms: 0 }, { stage: 'sent', ms: 3 }] };
  const asking = endsWhenStopped(new Promise(resolve => { settle = resolve; }), controller.signal, trace, line => lines.push(line));
  controller.abort(new Error('stopped'));
  await assert.rejects(asking, /stopped/);
  await new Promise(r => setTimeout(r, 1100));
  assert.match(lines[0], /^\[question\] q stopped 1s ago and its request is still out: queued 0, sent 3/);
  settle({ answers: {} });
  await new Promise(r => setImmediate(r));
  assert.match(lines[1], /^\[question\] q's request settled \d+ ms after it was stopped/);
  assert.equal(trace.stages.at(-1).stage, 'settled');
});

test('a question answered records the time of each stage, from queued through the request to its record', async t => {
  const { decide } = require('../src/decisions');
  t.mock.method(global, 'fetch', async () => ({ ok: true, status: 200, headers: { get: () => null },
    text: async () => JSON.stringify({ answers: { branch_0: { choice: 'go_back', confidence: 0.9 } } }) }));
  const goal = {};
  const decision = await decide('corpse_run', { client: new TypeSafe({ apiKey: 'unit-test' }), goal, tree: { go_back: { description: 'a' }, leave_them: { description: 'b' } }, state: {} });
  const entry = goal.decisions.at(-1);
  assert.deepEqual(entry.stages.map(s => s.stage), ['queued', 'asked', 'sent', 'headers', 'body', 'parsed', 'recorded']);
  assert.equal(decision.stages, entry.stages);
  assert.ok(entry.stages.every((s, i, all) => !i || s.ms >= all[i - 1].ms));
});

// Note 560: the progress audit found questions asked hundreds of times, the
// same answer to the same facts, each answer ending at once.
test('a question with one option is not asked: the one way is taken and said, not recorded as asked', async () => {
  const { decide } = require('../src/decisions');
  const bot = { entity: { position: { x: 0, y: 64, z: 0 } }, game: { dimension: 'the_nether' } };
  const goal = {};
  const client = { systemOne: () => assert.fail('one way needs no question') };
  const r = await decide('portal_method', { client, bot, goal, tree: { cast_frame: { description: 'the only way' } }, state: {} });
  assert.deepEqual(r.path, ['cast_frame']);
  assert.equal(r.only, true);
  assert.equal((goal.decisions || []).length, 0);
  assert.equal(bot._turn, undefined, 'no turn taken for a question not asked');
});

test('the same answer to the same facts, come back at once with nothing measurable, is said, then rests from here, and with nothing left the question above is asked (notes 560, 571)', async () => {
  // mid-242-ab: portal_method answered cast_frame 532 times in fifteen minutes, each pass ending at once
  // ("Nowhere to stand to pour into the frame slot at (18, 75, 58)").
  const { decide } = require('../src/decisions');
  const { Vec3 } = require('vec3');
  const bot = { entity: { position: new Vec3(16.5, 71, 60.5) }, game: { dimension: 'overworld' }, inventory: { items: () => [] } };
  const goal = { kind: 'win', step: { action: 'enter_nether', phase: 'reach_nether' } };
  const seen = [], asked = [];
  const client = { systemOne: async ({ state, questions }) => { seen.push(state); asked.push(questions); return { answers: { branch_0: { choice: 'cast_frame', confidence: 0.9 } } }; } };
  const tree = n => ({ cast_frame: { description: `Cast in place. The frame has failed at its site ${n} times: "Nowhere to stand".` }, build_new: { description: 'Build from ten obsidian.' } });
  const ask = n => decide('portal_method', { client, bot, goal, tree: tree(n), state: { obsidian: 0, minutesOnWay: 30 + n } });
  await ask(1);
  assert.equal(seen[0].sameAnswerAgain, undefined, 'the first asking says nothing of repeats');
  goal.lastFailure = { why: 'Nowhere to stand to pour into the frame slot at (18, 75, 58)', at: Date.now() };
  await ask(2);
  assert.match(seen[1].sameAnswerAgain, /^cast frame was chosen 1 time in the last \d+ seconds? with these same facts, and nothing measurable came of it .*: Nowhere to stand to pour/);
  assert.match(JSON.stringify(asked[1]), /Cast in place.*Tried once from here in the last \d+ seconds?, and it came to nothing: Nowhere to stand to pour/, 'the try said on its option');
  // Blocked twice from here, it rests (tried.js): not asked a third time, the one way left taken unasked.
  const third = await ask(3);
  assert.deepEqual(third.path, ['build_new']); assert.equal(third.only, true);
  assert.equal(seen.length, 2, 'not asked a third time');
  await ask(4);
  // Every way from here resting: the question above is asked (the rung's), with this one's failure said.
  await assert.rejects(ask(5), err => err.name === 'Stalled' && /^Stalled: portal method: every way it had from here rests: cast frame: Tried 2 times from here .* Nowhere to stand .*; build new: Tried 2 times from here/.test(err.message));
  assert.equal(seen.length, 2, 'Jev asked twice in all');
  assert.equal(bot._stalls.stall.key, 'step:enter_nether', 'the step\'s stall path takes it');
  assert.equal(bot._stalls.stall.escalated.to, 'rung_progress');
});

test('answers that come back at once with nothing coming of them are said and held whatever the facts, one answer or two in turn (note 570)', async () => {
  // mid-242-ac-nether-2-fortress-1: fortress_approach 351 times in ten minutes, other_way 345, each back within half a
  // second, the place asked about and its distance changing between, so the same facts were never met twice. And
  // portal_way (note 568): around_right and around_left in turn, each back within 0.3 of a second having moved nothing.
  const { decide } = require('../src/decisions');
  const { Vec3 } = require('vec3');
  const bot = { entity: { position: new Vec3(-167.5, 107, 60.1) }, game: { dimension: 'the_nether' }, inventory: { items: () => [] } };
  const goal = { kind: 'win', step: { action: 'find_fortress' } };
  const seen = [], picks = ['around_right', 'around_left', 'around_right', 'around_left'];
  const client = { systemOne: async ({ state }) => { seen.push(state); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } };
  const tree = n => ({ around_right: { description: `Round by the right, ${n} blocks.` }, around_left: { description: `Round by the left, ${n + 3} blocks.` } });
  const ask = n => decide('portal_way', { client, bot, goal, tree: tree(n), state: { target: `(${-187 + n * 20}, 74, ${162 - n * 13})`, facing: n % 2 ? 'east' : 'north' } });
  await ask(1);
  assert.equal(seen[0].lastAnswersCameToNothing, undefined);
  goal.lastFailure = { why: 'No path to the goal!', at: Date.now() };
  await ask(2);
  assert.equal(seen[1].sameAnswerAgain, undefined, 'the facts changed');
  assert.match(seen[1].lastAnswersCameToNothing, /^the last answer, around right, came back within a second and nothing measurable came of it \(no new ground, nothing gained, no block dug or placed\), whatever the facts said between; the last ended: No path to the goal!$/);
  await ask(3);
  assert.match(seen[2].lastAnswersCameToNothing, /^the last 2 answers to this question in a row \(around right 1 time, around left 1 time, in the last 1 second\) each came back within a second/);
  // Around right has come to nothing twice from here and rests; around left is the one way left.
  const fourth = await ask(4);
  assert.deepEqual(fourth.path, ['around_left']); assert.equal(fourth.only, true);
  await assert.rejects(ask(5), err => err.name === 'Stalled' && err.stall.escalated?.to === 'rung_progress' && /every way it had from here rests: around right: Tried 2 times/.test(err.message));
  assert.equal(seen.length, 3, 'not asked a fourth time');
  // The stance against mobs about is said, never held: mid-244-ad's out_of_sight, forty-one times in eleven seconds
  // under a crossbow piglin, health falling between each, the bot moving 1.4 blocks.
  const stance = h => decide('encounter_stance', { client: { systemOne: async ({ state }) => { seen.push(state); return { answers: { branch_0: { choice: 'out_of_sight', confidence: 0.6 } } }; } },
    bot, goal, tree: { out_of_sight: { description: 'Walk 6 blocks to a spot out of its line.' }, fight: { description: 'Fight here.' } }, state: { health: h, threats: [{ name: 'piglin', distance: 7, held: 'crossbow' }] } });
  delete bot._stalls.stall; goal.lastFailure = null;
  for (const h of [6.4, 5.1, 3.1, 1.2]) await stance(h);
  assert.match(seen.at(-1).lastAnswersCameToNothing, /^the last 3 answers to this question in a row \(out of sight 3 times, in the last 1 second\) each came back within a second and nothing measurable came of any of them/);
  // Something coming of an answer starts afresh.
  delete bot._stalls.stall;
  picks.push('around_left', 'around_left');
  bot.entity.position = new Vec3(-157.5, 107, 60.1); await ask(6); bot.entity.position = new Vec3(-150.5, 107, 60.1); await ask(7);
  assert.equal(seen.at(-1).lastAnswersCameToNothing, undefined, 'moved seven blocks: something came of it');
});

test('an answer that got somewhere, or new facts, starts afresh; a wait chosen is said, never held', async () => {
  const { decide } = require('../src/decisions');
  const { Vec3 } = require('vec3');
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, game: { dimension: 'overworld' }, inventory: { items: () => [] } };
  const goal = { step: { action: 'mine' } };
  const seen = [];
  const client = { systemOne: async ({ state }) => { seen.push(state); return { answers: { branch_0: { choice: 'ore_0', confidence: 0.9 } } }; } };
  const tree = { ore_0: { description: 'Iron ore 6 blocks off.' }, branch: { description: 'A branch tunnel.' } };
  const ask = (state = {}) => decide('night_mine_target', { client, bot, goal, tree, state });
  await ask(); bot.entity.position = new Vec3(5.5, 64, 0.5); await ask(); await ask();
  assert.equal(seen[1].sameAnswerAgain, undefined, 'walked five blocks: something came of it');
  assert.match(seen[2].sameAnswerAgain, /ore 0 was chosen 1 time/);
  // Ten minutes on, the ledger's tries from here have gone by; the repeat rule reads new facts afresh.
  for (const e of goal.tried.entries) e.at -= 11 * 60000;
  await ask({ ore: 'gold' });
  assert.equal(seen[3].sameAnswerAgain, undefined, 'new facts');
  // A pillar held up top: asked again with nothing new, and that is the point.
  const stance = { pillar: { description: 'Two up.' }, fight: { description: 'Fight.' } };
  const answering = { systemOne: async ({ state }) => { seen.push(state); return { answers: { branch_0: { choice: 'pillar', confidence: 0.6 } } }; } };
  goal.survivalAction = { action: 'pillar_hold', at: new Date().toISOString() };
  for (let i = 0; i < 4; i++) await decide('encounter_stance', { client: answering, bot, goal, tree: stance, state: { threats: [{ name: 'piglin', distance: 7.8 }] } });
  assert.match(seen.at(-1).sameAnswerAgain, /^pillar was chosen 3 times/);
});
