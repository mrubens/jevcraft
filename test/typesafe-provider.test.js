'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TypeSafe, choice, noul } = require('../src/typesafe');

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
