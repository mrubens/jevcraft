'use strict';
// Note 781. Jev down as its own state, in the bot and the harness. TypeSafe's
// credits ran out at 04:57:47Z on 2026-10-01 and every question came back
// 402. The bot read a 402 as a question rejected (thrown to its step), so it
// never held, never said '[jev down]', and note 778b's floor never came on;
// the steps failed into persist, the verdict read the persists as loops
// ("loop: 14× TypeSafe 402"), and the overnight loop restarted 53 worlds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const jevDown = require('../src/jev-down');
const { TypeSafe, TypeSafeError } = require('../src/typesafe');
const JD = require('../scripts/lib/jev-down');

const BILLING = 'TypeSafe 402: {"detail":{"error_type":"billing_error","message":"Your organization has no available TypeSafe API credits."}}';
const quiet = async fn => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

test('a 402, 401 or 403 is Jev down, with its kind; any other 4xx is still a question rejected (note 781)', () => {
  assert(jevDown.unreachable(new TypeSafeError(BILLING, { status: 402 })));
  assert(jevDown.unreachable(new TypeSafeError('TypeSafe 401', { status: 401 })));
  assert(jevDown.unreachable(new TypeSafeError('TypeSafe 403', { status: 403 })));
  assert(!jevDown.unreachable(new TypeSafeError('TypeSafe 400', { status: 400 })));
  assert(!jevDown.unreachable(new TypeSafeError('TypeSafe 422', { status: 422 })));
  assert.equal(jevDown.kindOf(new TypeSafeError(BILLING, { status: 402 })), 'billing');
  assert.equal(jevDown.kindOf(new TypeSafeError('x', { status: 401 })), 'auth');
  assert.equal(jevDown.kindOf(new TypeSafeError('x', { status: 429 })), 'rate_limit');
  assert.equal(jevDown.kindOf(new TypeSafeError('x', { status: 503 })), 'server');
  assert.equal(jevDown.kindOf(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })), 'connection');
  assert.equal(jevDown.kindOf(Object.assign(new Error('aborted'), { name: 'AbortError' })), 'timeout');
  assert.equal(jevDown.kindOf(new jevDown.JevDown('no Jev client is configured')), 'no_client');
});

test('a question answered 402 holds and comes back stale, not thrown to its step; the spell is emitted at its start and end (25598, 04:57:49Z)', async () => {
  const { decide } = require('../src/decisions');
  let calls = 0;
  const client = { systemOne: async ({ questions }) => {
    if (++calls <= 3) throw new TypeSafeError(BILLING, { status: 402 });
    return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: Object.keys(questions[k].criteria)[0], confidence: 0.9 }])) };
  } };
  const bot = Object.assign(new EventEmitter(), { chat() {}, setControlState() {}, pathfinder: { setGoal() {} } });
  const events = [];
  bot.on('jev_down', d => events.push(['down', d])); bot.on('jev_back', d => events.push(['back', d]));
  let during = null;
  bot.once('jev_down', () => { during = jevDown.spellNow(bot); });
  const decision = await quiet(() => decide('stillness_detour', { client, bot, goal: {}, task: new Task('t'), tree: { mine_nearby: { description: 'a' }, look_around: { description: 'b' } }, state: {} }));
  assert.equal(decision.stale, true, 'held, not thrown');
  assert.equal(calls, 4);
  assert.deepEqual(events.map(e => e[0]), ['down', 'back']);
  assert.equal(events[0][1].kind, 'billing'); assert.equal(events[0][1].status, 402); assert.equal(events[0][1].question, 'stillness_detour');
  assert.equal(events[1][1].kind, 'billing'); assert.ok(events[1][1].seconds >= 0);
  assert.equal(during.kind, 'billing', 'every frame meanwhile carries the spell');
  assert.equal(jevDown.spellNow(bot), null, 'and none once Jev answers');
});

test('the breaker opens on a 402 and keeps its status, so the next caller holds as Jev down too', async t => {
  let calls = 0;
  t.mock.method(global, 'fetch', async () => { calls++; return { ok: false, status: 402, headers: { get: () => null }, text: async () => BILLING.slice('TypeSafe 402: '.length) }; });
  const client = new TypeSafe({ provider: 'typesafe', apiKey: 'test-key', maxRetries: 0 });
  await assert.rejects(client.systemOne({ state: {}, questions: {} }), /402/);
  const second = await client.systemOne({ state: {}, questions: {} }).catch(e => e);
  assert.equal(calls, 1, 'not asked again for fifteen seconds');
  assert.equal(second.status, 402); assert.equal(second.breaker, true);
  assert(jevDown.unreachable(second)); assert.equal(jevDown.kindOf(second), 'billing');
  const rejected = new TypeSafe({ provider: 'typesafe', apiKey: 'test-key', maxRetries: 0 });
  t.mock.method(global, 'fetch', async () => ({ ok: false, status: 400, headers: { get: () => null }, text: async () => 'bad' }));
  await assert.rejects(rejected.systemOne({ state: {}, questions: {} }), /400/);
  assert.equal(rejected.openUntil, undefined, 'a question rejected opens nothing');
});

test('the flight record writes the spell on its slim frames too', () => {
  const { slim } = require('../src/recorder/flight');
  const row = slim({ kind: 'observation', snapshot: { position: { x: 1, y: 2, z: 3 }, jevDown: { since: '2026-10-01T04:57:49.000Z', kind: 'billing', seconds: 30 } } });
  assert.equal(row.snapshot.jevDown.kind, 'billing');
  assert.equal(slim({ kind: 'observation', snapshot: {} }).snapshot.jevDown, undefined);
});

test('while Jev is down the work is not given the turn with a fight standing: the survival step goes on (25595, 05:16Z)', async () => {
  const arbiter = require('../src/arbiter');
  const bot = { entity: { position: new Vec3(0, 64, 0) }, health: 17, food: 20, oxygenLevel: 20, entities: {} };
  const ran = [];
  const work = { layer: 'work', action: 'fill_bucket', urgency: 'routine', facts: {}, run: async () => { ran.push('work'); return true; } };
  const backstop = async () => { ran.push('survival'); return true; };
  await quiet(() => jevDown.down(bot, null, 'encounter_stance', new TypeSafeError(BILLING, { status: 402 }), { log: () => {} }));
  try {
    const turn = await quiet(() => arbiter.take(bot, [work], { state: bot._arbiter = {}, backstop, backstopFor: ['vitals'], mobs: [], pressing: { reach: true, push: false } }));
    assert.equal(turn.layer, 'survival'); assert.equal(turn.by, 'jev_down_fight'); assert.match(turn.fight, /at its reach/);
    assert.deepEqual(ran, ['survival'], 'the work did not run');
    // No fight: the work has its turn, Jev down or not.
    const calm = await quiet(() => arbiter.take(bot, [work], { state: bot._arbiter = {}, backstop: async () => false, backstopFor: ['vitals'], mobs: [], pressing: { reach: false, push: false } }));
    assert.equal(calm.layer, 'work');
  } finally { jevDown.back(bot, null, 'test', { log: () => {} }); }
  // Jev up, a mob at reach: as before, the turn is the ruling's.
  ran.length = 0;
  const up = await quiet(() => arbiter.take(bot, [work], { state: bot._arbiter = {}, backstop: async () => false, backstopFor: ['vitals'], mobs: [], pressing: { reach: true, push: false } }));
  assert.equal(up.layer, 'work');
});

test('the harness reads a spell from the bot\'s record and from the outage\'s own words before it', () => {
  const t0 = Date.parse('2026-10-01T04:57:00Z');
  const marked = [
    { t: t0, kind: 'observation', snapshot: {} },
    { t: t0 + 1000, kind: 'jev_down', detail: { kind: 'billing' }, snapshot: { jevDown: { kind: 'billing' } } },
    { t: t0 + 2000, kind: 'observation', snapshot: { jevDown: { kind: 'billing' } } },
    { t: t0 + 120000, kind: 'observation', snapshot: { jevDown: { kind: 'billing' } } },
    { t: t0 + 121000, kind: 'jev_back', detail: { seconds: 120 }, snapshot: {} },
    { t: t0 + 180000, kind: 'observation', snapshot: {} },
  ];
  assert.deepEqual(JD.spellsOf(marked).map(s => [s.from - t0, s.to - t0, s.kind, s.open]), [[1000, 121000, 'billing', false]]);
  const legacy = [
    { t: t0, kind: 'error', label: BILLING, snapshot: {} },
    { t: t0 + 30000, kind: 'observation', snapshot: { step: { action: 'persist', attempt: 2, problem: BILLING } } },
    { t: t0 + 60000, kind: 'error', label: 'No path to the goal!', snapshot: {} },
    { t: t0 + 80000, kind: 'error', label: 'The decision service is not answering (TypeSafe 402); asking again in 9s', snapshot: {} },
    { t: t0 + 400000, kind: 'error', label: BILLING, snapshot: {} },
  ];
  const spells = JD.spellsOf(legacy);
  assert.deepEqual(spells.map(s => [s.from - t0, s.to - t0, s.kind]), [[0, 80000, 'billing'], [400000, 400000, 'billing']], 'a gap over 90 s is two spells');
  assert.equal(spells[1].open, true, 'the record ends in it');
  const { entries, ms } = JD.offClock([[t0 + 60000, 'persist', 60000], [t0 + 120000, 'mine', 60000]], spells);
  assert.equal(ms, 80000); assert.deepEqual(entries, [[t0 + 120000, 'mine', 40000]]);
});

// A flight file the verdict reads, under its own identity.
function flightDir(frames, identity) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-781-'));
  const start = new Date(frames[0].t).toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(dir, `${identity}-${start}.jsonl`), frames.map(({ t, ...f }) => JSON.stringify({ ...f, at: new Date(t).toISOString() })).join('\n') + '\n');
  return dir;
}

test('the verdict: a 402 persist is not a loop, the spell is off the played clock and the cuts, and is said apart (25584 mid-229-an, 05:37 to 05:46Z)', () => {
  const { verdict } = require('../scripts/midgame');
  const identity = '127_0_0_1-25999-Jev', t0 = Date.parse('2026-10-01T05:00:00Z');
  const pos = { x: 0, y: 64, z: 0 };
  const frames = [];
  // Twenty minutes of play, then forty-five down: persists of the 402 every
  // twenty seconds, as the old bot wrote them.
  for (let s = 0; s < 20 * 60; s += 5) frames.push({ t: t0 + s * 1000, kind: 'observation', snapshot: { position: { x: s / 10, y: 64, z: 0 }, dimension: 'overworld', health: 20 } });
  for (let s = 20 * 60; s < 65 * 60; s += 5) {
    const step = { action: 'persist', attempt: Math.floor((s - 1200) / 20) + 1, problem: BILLING };
    frames.push({ t: t0 + s * 1000, kind: 'observation', snapshot: { position: pos, dimension: 'overworld', health: 20, step } });
    if (s % 20 === 0) frames.push({ t: t0 + s * 1000 + 1, kind: 'error', label: BILLING, snapshot: { goal: { step, lastError: BILLING }, position: pos } });
  }
  const dir = flightDir(frames, identity);
  try {
    const v = verdict({ world: 'mid-229-zz', startedAt: new Date(t0).toISOString() }, { now: t0 + 65 * 60000, dir, identity });
    assert.deepEqual(v.reasons, [], `no loop and no cut: ${JSON.stringify(v.reasons)}`);
    assert.ok(v.jevDownMinutes >= 44 && v.jevDownMinutes <= 45, `down ${v.jevDownMinutes}`);
    assert.equal(v.jevDownNow, true);
    assert.ok(v.playedMinutes >= 20 && v.playedMinutes <= 21, `played ${v.playedMinutes}`);
    assert.match(v.jevDown.says, /^Jev down 4\d(\.\d)? min \(billing\), down now$/);
    assert.equal(v.done, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  // The same record with no outage: the hour's cut and the loop stand as before.
  const plain = frames.map(f => f.kind === 'error' ? { ...f, label: 'No path to the goal!', snapshot: { position: pos } }
    : f.snapshot.step ? { ...f, snapshot: { ...f.snapshot, step: { ...f.snapshot.step, problem: 'No path to the goal!' } } } : f);
  const dir2 = flightDir(plain, identity);
  try {
    const v = verdict({ world: 'mid-229-zz', startedAt: new Date(t0).toISOString() }, { now: t0 + 65 * 60000, dir: dir2, identity });
    assert(v.reasons.some(r => /^loop: \d+× No path/.test(r)), JSON.stringify(v.reasons));
    assert(v.reasons.includes('cut: no Nether in 60 minutes played'));
    assert.equal(v.jevDownMinutes, 0); assert.equal(v.jevDownNow, false);
  } finally { fs.rmSync(dir2, { recursive: true, force: true }); }
});

test('the verdict reads the bot\'s own spell record; a death in it is still a death, said with it', () => {
  const { verdict } = require('../scripts/midgame');
  const identity = '127_0_0_1-25998-Jev', t0 = Date.parse('2026-10-01T05:00:00Z');
  const frames = [];
  for (let s = 0; s < 10 * 60; s += 5) frames.push({ t: t0 + s * 1000, kind: 'observation', snapshot: { position: { x: s / 10, y: 64, z: 0 }, dimension: 'overworld', health: 20 } });
  frames.push({ t: t0 + 600500, kind: 'jev_down', detail: { kind: 'billing' }, snapshot: { jevDown: { kind: 'billing' }, health: 20 } });
  for (let s = 601; s < 900; s += 1) frames.push({ t: t0 + s * 1000, kind: 'observation', snapshot: { position: { x: 60, y: 64, z: 0 }, dimension: 'overworld', health: s < 700 ? 20 : s < 701 ? 0 : 20, jevDown: { kind: 'billing' } } });
  frames.push({ t: t0 + 700000, kind: 'danger', snapshot: { health: 0, jevDown: { kind: 'billing' } } });
  frames.push({ t: t0 + 900500, kind: 'jev_back', detail: { seconds: 300 }, snapshot: {} });
  for (let s = 901; s < 960; s += 5) frames.push({ t: t0 + s * 1000, kind: 'observation', snapshot: { position: { x: 60 + s / 100, y: 64, z: 0 }, dimension: 'overworld', health: 20 } });
  const dir = flightDir(frames, identity);
  try {
    const v = verdict({ world: 'mid-241-zz', startedAt: new Date(t0).toISOString() }, { now: t0 + 960000, dir, identity });
    assert.equal(v.jevDownNow, false, 'Jev answered');
    assert.equal(v.jevDownMinutes, 5);
    assert.equal(v.jevDown.spells.length, 1); assert.equal(v.jevDown.spells[0].kind, 'billing');
    assert.equal(v.playedMinutes, 11);
    assert.deepEqual(v.reasons, ['1 death(s), 1 while Jev was down']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('wasted-minutes files a minute Jev was down under its own bucket, off the bot-hours', () => {
  const wm = require('../scripts/wasted-minutes');
  const t0 = Date.parse('2026-10-01T05:00:00Z');
  const frames = [];
  for (let s = 0; s < 180; s += 2) {
    const f = { t: t0 + s * 1000, kind: s % 10 ? 'observation' : 'error', snapshot: { position: { x: 0, y: 64, z: 0 }, dimension: 'overworld', health: 20, step: { action: 'persist', problem: BILLING } }, ...(s % 10 ? {} : { label: BILLING }) };
    frames.push(wm.slim(f, f.t));
  }
  const bins = wm.minutesOf(frames, { start: t0 });
  const v = wm.classify(bins[1].m);
  assert.equal(v.cls, 'jev_down'); assert.match(v.why, /billing/);
  const r = wm.report({ rows: bins.map(b => ({ port: 1, world: 'w', kind: 'fresh', from: b.from, ms: b.botMs, ...wm.classify(b.m), step: 's', question: 'q', m: b.m })), trials: [] });
  assert.equal(r.botHours, 0); assert.ok(r.jevDownHours > 0.04);
  assert(!r.patterns.some(p => /stuck/.test(p.pattern)), 'not stuck/unstuck');
});

test('progress-audit does not judge a window Jev was down for, and keeps the spell off its clock', () => {
  const audit = require('../scripts/trials/progress-audit');
  const t0 = Date.parse('2026-10-01T05:00:00Z');
  const frames = [];
  for (let s = 0; s < 900; s += 5) frames.push({ t: t0 + s * 1000, kind: 'observation', snapshot: { position: { x: 0, y: 64, z: 0 }, dimension: 'overworld', health: 20, step: { action: 'persist', problem: BILLING }, jevDown: { kind: 'billing' } } });
  const m = audit.measure({ frames, history: [], from: t0, to: t0 + 900000, trial: { startedAt: new Date(t0 - 3600000).toISOString() }, minutes: 15, historyMinutes: 60 });
  assert.deepEqual(m.flags, []);
  assert.match(m.verdict, /^not judged: Jev down 1[45](\.\d)? min \(billing\), down now/);
  assert.equal(m.clockedMinutes, 0);
  assert.ok(m.jevDown.clockedMinutes >= 14);
  assert.equal(m.minutesSinceMilestone, 60, 'the trial\'s hour before counted, not the spell');
});
