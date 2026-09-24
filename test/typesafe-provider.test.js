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
