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
