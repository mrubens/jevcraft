'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TypeSafe, choice, noul, withRequestSignal } = require('../src/typesafe');

test('OpenRouter Jev uses the Decisions endpoint and retains native typed questions', async t => {
  let sent;
  t.mock.method(global, 'fetch', async (url, options) => {
    sent = { url, options, body: JSON.parse(options.body) };
    return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ answers: { next: { choice: 'build' } } }) };
  });
  const client = new TypeSafe({ provider: 'openrouter', apiKey: 'test-key' });
  const questions = { next: choice('What next?', { build: 'Build' }), addressed: noul('Is the bot addressed?') };
  const result = await client.systemOne({ state: 'a house', questions });
  assert.equal(sent.url, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(sent.body.model, 'typesafe/jev-1.13');
  assert.deepEqual(sent.body.questions.next, questions.next);
  assert.deepEqual(sent.body.questions.addressed, { type: 'noul', instructions: 'Is the bot addressed?' });
  assert.equal(questions.addressed.criteria, null);
  assert.equal(sent.options.headers.Authorization, 'Bearer test-key');
  assert.equal(result.answers.next.choice, 'build');
});

test('TypeSafe remains independently selectable with its original endpoint', async t => {
  let url;
  t.mock.method(global, 'fetch', async target => {
    url = target;
    return { ok: true, headers: { get: () => null }, text: async () => '{"answers":{}}' };
  });
  await new TypeSafe({ provider: 'typesafe', apiKey: 'test-key' }).systemOne({ state: {}, questions: {} });
  assert(url.endsWith('/v1/systemone'));
  assert.throws(() => new TypeSafe({ provider: 'unknown', apiKey: 'test-key' }), /JEV_PROVIDER/);
});

test('interrupting a request aborts an outstanding classification without retries or blocking the next one', async t => {
  let calls = 0, started;
  const began = new Promise(resolve => { started = resolve; });
  t.mock.method(global, 'fetch', async (_url, { signal }) => {
    if (++calls > 1) return { ok: true, headers: { get: () => null }, text: async () => '{"answers":{}}' };
    started();
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  const client = new TypeSafe({ provider: 'typesafe', apiKey: 'test', timeout: 60000 });
  const lifetime = new AbortController(), bound = withRequestSignal(client, lifetime.signal);
  const pending = bound.systemOne({ state: 'old request', questions: {} });
  await began; lifetime.abort(new Error('Player request interrupted'));
  await assert.rejects(pending, /interrupted/); assert.equal(calls, 1);
  assert.throws(() => bound.systemOne({ state: 'stale nested catalog', questions: {} }), /interrupted/);
  const next = withRequestSignal(client, new AbortController().signal);
  assert.deepEqual(await next.systemOne({ state: 'new request', questions: {} }), { answers: {} });
});

test('request lifetime preserves cancellation from a nested classifier too', async () => {
  const parent = new AbortController(), nested = new AbortController(); let received;
  const client = withRequestSignal({ systemOne: async args => { received = args.signal; } }, parent.signal);
  await client.systemOne({ signal: nested.signal }); nested.abort(); assert(received.aborted);
  assert(!parent.signal.aborted);
});

test('a service that is down is asked again in a minute, not by every caller meanwhile', async t => {
  let calls = 0;
  t.mock.method(global, 'fetch', async () => { calls++; throw new Error('connect ETIMEDOUT'); });
  const client = new TypeSafe({ provider: 'typesafe', apiKey: 'test-key', maxRetries: 0 });
  await assert.rejects(client.systemOne({ state: {}, questions: {} }), /ETIMEDOUT/);
  assert.equal(calls, 1);
  await assert.rejects(client.systemOne({ state: {}, questions: {} }), /not answering/);
  assert.equal(calls, 1, 'the second caller fails at once and takes its fallback');
  client.openUntil = Date.now() - 1;
  t.mock.method(global, 'fetch', async () => ({ ok: true, headers: { get: () => null }, text: async () => '{"answers":{}}' }));
  await client.systemOne({ state: {}, questions: {} });
  assert.equal(client.openUntil, undefined, 'an answer closes it');
});

test('a choice is the option its distribution puts first: mid-242-bc-fortress-2 was served break_spawner at 0.26 beside leave_and_heal at 0.27 (note 623)', async t => {
  // The recorded answer, 2026-09-28 17:56:27Z on 25587.
  const probabilities = { retreat: 0.1, nook: 0, leave_and_heal: 0.27, fight_at_spawner: 0.03, back_to_wall: 0.01, eat: 0.01, dig_in_and_fight: 0, take_cover: 0.07, pillar: 0.02,
    charge_nearest: 0.09, seal: 0, keep_working: 0.01, break_spawner: 0.26, none_good: 0, out_of_sight: 0.01, close_in: 0.02, fight: 0.04, box_here: 0.02, dig_down: 0.01, corner_ambush: 0.03, bunker: 0 };
  const served = { answers: { branch_0: { type: 'choice', choice: 'break_spawner', confidence: 0.23, probabilities }, tied: { choice: 'a', probabilities: { a: 0.4, b: 0.4, c: 0.2 } }, yes: { probability: 0.7 } } };
  t.mock.method(global, 'fetch', async () => ({ ok: true, headers: { get: () => null }, text: async () => JSON.stringify(served) }));
  const result = await new TypeSafe({ provider: 'typesafe', apiKey: 'k' }).systemOne({ state: {}, questions: {} });
  assert.equal(result.answers.branch_0.choice, 'leave_and_heal');
  assert.deepEqual(result.answers.branch_0.served, { choice: 'break_spawner', probability: 0.26 });
  assert.equal(result.answers.tied.choice, 'a', 'a tie keeps the service\'s pick');
  assert.equal(result.answers.tied.served, undefined);
  assert.deepEqual(result.answers.yes, { probability: 0.7 }, 'a noul is left alone');
});

test('the decision tree takes the option the distribution puts first', async () => {
  const { decideTree } = require('../src/decisions/tree');
  const { pickByDistribution } = require('../src/typesafe');
  const client = { systemOne: async () => pickByDistribution({ answers: { branch_0: { choice: 'b', probabilities: { a: 0.27, b: 0.26, c: 0.21 } } } }) };
  const tree = { a: { description: 'A' }, b: { description: 'B' }, c: { description: 'C' } };
  const d = await decideTree(client, { state: {}, tree });
  assert.deepEqual(d.path, ['a']);
  assert.equal(d.judgments[0].served.choice, 'b');
});
