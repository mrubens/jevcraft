'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Ledger, withRun, summaryLine, appendSummary, duration, HEADER, TICKS_PER_DAY } = require('../src/ledger');
const { TypeSafe, choice } = require('../src/typesafe');
const { decideTree } = require('../src/decisions');
const { startHarness } = require('../src/harness/server');

const scratch = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-ledger-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const clock = start => { let now = start; return { now: () => now, tick: ms => { now += ms; } }; };

test('calls are tallied per run, per question kind and per in-game day, whichever names the tokens carry', t => {
  const dir = scratch(t), time = clock(Date.parse('2026-09-21T10:00:00Z'));
  let age = 1000;
  const ledger = new Ledger(path.join(dir, 'ledger.json'), { processId: 'a', now: time.now, age: () => age });
  const run = ledger.open({ kind: 'request', name: 'get me 8 birch stairs' });
  ledger.record({ run: run.id, kind: 'request', usage: { input_tokens: 3000, output_tokens: 500 }, latencyMs: 440.4 });
  ledger.record({ run: run.id, kind: 'source', usage: { prompt_tokens: 1200, completion_tokens: 100 }, latencyMs: 300 });
  age = TICKS_PER_DAY + 5;
  ledger.record({ run: run.id, kind: 'source', usage: null, latencyMs: 12000, ok: false });
  ledger.record({ run: run.id, kind: 'survival', usage: { input_tokens: 800, output_tokens: 40 } });
  time.tick(90 * 1000);
  const view = ledger.view(run.id).current;
  assert.deepEqual([view.calls, view.failed, view.inputTokens, view.outputTokens, view.tokens, view.latencyMs], [4, 1, 5000, 640, 5640, 12740]);
  assert.equal(view.elapsedMs, 90 * 1000); assert.equal(view.status, 'open'); assert.equal(view.restarts, 0);
  assert.deepEqual(view.byKind.map(k => [k.key, k.calls, k.tokens]), [['source', 2, 1300], ['request', 1, 3500], ['survival', 1, 840]], 'busiest kind first');
  assert.deepEqual(view.byDay.map(d => [d.key, d.calls, d.tokens]), [['0', 2, 4800], ['1', 2, 840]]);
  assert.equal(view.processId, undefined, 'the view is for people, not for the process bookkeeping');
  // A call nobody claimed goes to the standing bucket rather than nowhere.
  ledger.record({ kind: 'survival', usage: { input_tokens: 10, output_tokens: 1 } });
  ledger.record({ run: 'no-such-run', kind: 'survival', usage: { input_tokens: 10, output_tokens: 1 } });
  assert.equal(ledger.view().current.id, 'idle'); assert.equal(ledger.view().current.calls, 2);
});

test('the tally survives a restart, which is counted once per new process, and a resumed run keeps its id', t => {
  const dir = scratch(t), file = path.join(dir, 'ledger.json'), time = clock(Date.parse('2026-09-21T10:00:00Z'));
  const first = new Ledger(file, { processId: 'p1', now: time.now });
  const run = first.open({ kind: 'dream', name: 'dream · build a village', startedAt: '2026-09-21T09:00:00Z' });
  first.record({ run: run.id, kind: 'dream', usage: { input_tokens: 100, output_tokens: 10 } });
  first.record({ run: run.id, kind: 'survival', usage: { input_tokens: 50, output_tokens: 5 } });
  // Same process, new connection: not a restart.
  const reconnect = new Ledger(file, { processId: 'p1', now: time.now });
  reconnect.open({ id: run.id, kind: 'dream', name: 'dream · build a village' });
  assert.equal(reconnect.get(run.id).restarts, 0);
  time.tick(3600 * 1000);
  const second = new Ledger(file, { processId: 'p2', now: time.now });
  const resumed = second.open({ id: run.id, kind: 'dream', name: 'dream · build a village' });
  assert.equal(resumed.restarts, 1); assert.equal(resumed.calls, 2); assert.equal(resumed.startedAt, '2026-09-21T09:00:00Z');
  second.record({ run: run.id, kind: 'source', usage: { input_tokens: 1, output_tokens: 1 } });
  assert.equal(second.get(run.id).restarts, 1, 'recording in the same process does not count again');
  const third = new Ledger(file, { processId: 'p3', now: time.now });
  third.record({ run: run.id, kind: 'source', usage: { input_tokens: 1, output_tokens: 1 } });
  assert.equal(third.get(run.id).restarts, 2, 'a call from a new process notices the restart even without an explicit open');
  assert.equal(third.view(run.id).current.elapsedMs, 2 * 3600 * 1000);
  // A file that cannot be read starts a fresh ledger instead of stopping the bot.
  fs.writeFileSync(file, '{not json');
  const fresh = new Ledger(file, { processId: 'p4', now: time.now });
  assert.equal(fresh.view().current.calls, 0);
});

test('closing a run fixes its elapsed time, reports it, and keeps a short history; folding merges chat that started no work', t => {
  const dir = scratch(t), file = path.join(dir, 'ledger.json'), time = clock(Date.parse('2026-09-21T10:00:00Z'));
  const closed = [];
  const ledger = new Ledger(file, { processId: 'p1', now: time.now, onClose: run => closed.push(run) });
  const run = ledger.open({ kind: 'request', name: 'build a house' });
  ledger.record({ run: run.id, kind: 'source', usage: { input_tokens: 100, output_tokens: 10 }, latencyMs: 250 });
  time.tick(125 * 1000);
  const done = ledger.close(run.id, 'complete');
  assert.equal(done.status, 'complete'); assert.equal(done.elapsedMs, 125 * 1000); assert.equal(done.endedAt, '2026-09-21T10:02:05.000Z');
  assert.equal(closed.length, 1); assert.equal(ledger.close(run.id), null, 'closing twice is harmless');
  assert.equal(ledger.view().recent[0].id, run.id, 'the history is offered to the viewer');
  time.tick(60 * 1000);
  const again = ledger.open({ id: run.id, kind: 'request', name: 'build a house' });
  assert.equal(again.calls, 1); assert.equal(again.status, 'open'); assert.equal(again.endedAt, null);
  assert.equal(ledger.view(run.id).current.elapsedMs, 185 * 1000, 'a resumed run counts from its original start');
  const status = ledger.open({ kind: 'request', name: 'status' });
  ledger.record({ run: status.id, kind: 'request', usage: { input_tokens: 40, output_tokens: 4 } });
  ledger.fold(status.id);
  assert.equal(ledger.get(status.id), null);
  assert.deepEqual([ledger.view().current.calls, ledger.view().current.inputTokens, ledger.view().current.byKind[0].key], [1, 40, 'request']);
  assert.equal(closed.length, 1, 'a folded run is not reported');
  // A failing reporter cannot break accounting.
  const noisy = new Ledger(path.join(dir, 'noisy.json'), { onClose: () => { throw new Error('disk full'); } });
  const r = noisy.open({ kind: 'request', name: 'x' }); assert.equal(noisy.close(r.id, 'blocked').status, 'blocked');
});

test('the summary line is one table row, and the log gets its header once', t => {
  const dir = scratch(t), file = path.join(dir, 'docs', 'run-ledger.md');
  const run = { id: 'r', kind: 'request', name: 'get me | 8 birch\nstairs', status: 'complete', startedAt: '2026-09-21T10:00:00.000Z', endedAt: '2026-09-21T13:12:30.000Z',
    restarts: 2, calls: 412, failed: 3, inputTokens: 1234567, outputTokens: 89012 };
  assert.equal(summaryLine(run), '| 2026-09-21 10:00 | request · get me 8 birch stairs | complete | 3h 12m | 2 | 412 (3 failed) | 1,323,579 (1,234,567 in, 89,012 out) |');
  appendSummary(file, run); appendSummary(file, { ...run, status: 'blocked', elapsedMs: 42 * 1000, failed: 0 });
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  assert(fs.readFileSync(file, 'utf8').startsWith(HEADER));
  assert.equal(lines.filter(l => l.startsWith('| 2026-09-21')).length, 2);
  assert.match(lines.at(-2), /\| blocked \| 42s \| 2 \| 412 \|/);
  assert.equal(fs.readFileSync(file, 'utf8').split('# Run ledger').length, 2, 'the header is written once');
  assert.deepEqual([duration(0), duration(59 * 1000), duration(61 * 1000), duration(3 * 3600 * 1000 + 5 * 60 * 1000), duration(26 * 3600 * 1000), duration(NaN)],
    ['0s', '59s', '1m 1s', '3h 5m', '1d 2h 0m', '—']);
});

test('the TypeSafe client feeds the ledger on every call without putting the labels on the wire', async t => {
  let sent, answer = { answers: { next: { choice: 'build' } }, usage: { input_tokens: 2100, output_tokens: 300 } };
  t.mock.method(global, 'fetch', async (_url, options) => {
    sent = JSON.parse(options.body);
    if (answer instanceof Error) return { ok: false, status: 400, headers: { get: () => null }, text: async () => 'bad request' };
    return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(answer) };
  });
  const client = new TypeSafe({ provider: 'typesafe', apiKey: 'test-key', maxRetries: 0 });
  const records = [];
  client.ledger = { record: entry => records.push(entry) };
  const questions = { next: choice('What next?', { build: 'Build' }) };
  const charged = withRun(client, 'run-1');
  const result = await charged.systemOne({ state: 'a house', questions, kind: 'source' });
  assert.equal(result.answers.next.choice, 'build');
  assert.deepEqual(Object.keys(sent).sort(), ['model', 'questions', 'state'], 'run and kind stay local');
  assert.equal(records.length, 1);
  assert.deepEqual([records[0].run, records[0].kind, records[0].usage, records[0].ok], ['run-1', 'source', answer.usage, true]);
  assert(Number.isFinite(records[0].latencyMs));
  // The wrapper can defer to whatever is active, and an explicit run wins.
  let active = 'run-2';
  await withRun(client, () => active).systemOne({ state: {}, questions });
  await withRun(client, () => active).systemOne({ state: {}, questions, run: 'run-3' });
  assert.deepEqual(records.slice(1).map(r => [r.run, r.kind]), [['run-2', 'other'], ['run-3', 'other']].map(([run]) => [run, undefined]));
  // A rejected call is counted as a failure; a call the caller abandoned is not counted.
  answer = new Error('rejected');
  await assert.rejects(charged.systemOne({ state: {}, questions, kind: 'request' }), /400/);
  assert.deepEqual([records.at(-1).ok, records.at(-1).kind, records.at(-1).usage], [false, 'request', undefined]);
  const controller = new AbortController(); controller.abort(new Error('Player request interrupted'));
  await assert.rejects(charged.systemOne({ state: {}, questions, signal: controller.signal }), /interrupted/);
  assert.equal(records.length, 4);
  // A ledger that throws never fails the call.
  client.ledger = { record: () => { throw new Error('disk full'); } };
  answer = { answers: {} };
  assert.deepEqual(await client.systemOne({ state: {}, questions: {} }), { answers: {} });
});

test('tree decisions carry their kind to the client', async () => {
  let asked;
  const client = { systemOne: async args => { asked = args; return { answers: { branch_0: { choice: 'gather' } } }; } };
  const decision = await decideTree(client, { state: {}, kind: 'survival', tree: { gather: { description: 'Gather' }, rest: { description: 'Rest' } } });
  assert.equal(asked.kind, 'survival'); assert.deepEqual(decision.path, ['gather']);
});

test('the Observatory serves the attached ledger with the live view and hides it when it cannot be read', async t => {
  const dir = scratch(t);
  const harness = await startHarness({ port: 0, artifacts: path.join(dir, 'artifacts'), stateDirectory: path.join(dir, 'state') });
  t.after(() => harness.close());
  const bot = new EventEmitter(); bot.username = 'TestJev'; bot.entity = { id: 1, position: new Vec3(0, 64, 0), yaw: 0, pitch: 0 }; bot.entities = {};
  bot.health = 20; bot.food = 20; bot.game = { dimension: 'overworld' }; bot.inventory = { items: () => [] }; bot.blockAt = () => null;
  const ledger = new Ledger(path.join(dir, 'state', 'ledger.json'), { processId: 'p1' });
  const run = ledger.open({ kind: 'dream', name: 'dream · beat the game' });
  ledger.record({ run: run.id, kind: 'survival', usage: { input_tokens: 500, output_tokens: 20 }, latencyMs: 400 });
  let readable = true;
  harness.attach(bot, { getLedger: () => { if (!readable) throw new Error('unreadable'); return ledger.view(run.id); }, controls: {} });
  bot.emit('spawn');
  const get = async () => (await fetch(`${harness.url}/api/sessions/live`, { headers: { host: new URL(harness.url).host } })).json();
  const live = await get();
  assert.equal(live.ledger.current.name, 'dream · beat the game');
  assert.deepEqual([live.ledger.current.calls, live.ledger.current.tokens, live.ledger.current.byKind[0].key], [1, 520, 'survival']);
  readable = false;
  assert.equal((await get()).ledger, null);
});
