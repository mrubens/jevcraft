'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { statusMessage } = require('../src/status');
const bot = { health: 18, food: 16 };

test('idle survival does not hide a blocked player request or erase its error', () => {
  const saved = { status: 'blocked', request: 'Jev get me one bedrock', lastError: 'No supported survival acquisition method for bedrock' };
  const before = JSON.stringify(saved);
  const text = statusMessage(bot, { idle: true, goal: { survivalAction: { action: 'cook_food' } } }, saved);
  assert.match(text, /blocked: Jev get me one bedrock/);
  assert.match(text, /No supported survival acquisition method/);
  assert.match(text, /Between requests: cook_food. Health 18, food 16/);
  assert.equal(JSON.stringify(saved), before);
});

test('active work takes precedence over an older retained request', () => {
  const text = statusMessage(bot, { goal: { status: 'running', request: 'Jev come here', step: { action: 'come' } } },
    { status: 'blocked', request: 'old bedrock request' });
  assert.match(text, /running: Jev come here/); assert.doesNotMatch(text, /bedrock|Between requests/);
});

test('status retains completion and cancellation while idle, and keeps recovery in Jevs voice', () => {
  for (const status of ['complete', 'cancelled']) {
    assert.match(statusMessage(bot, { idle: true, goal: {} }, { status, request: 'get one diamond' }), new RegExp(`${status}: get one diamond`));
  }
  const text = statusMessage(bot, { goal: { status: 'running', request: 'build a house', recoveryAdvice: { active: true }, lastError: 'Fable diagnosis' } });
  assert.match(text, /Trying a different approach/); assert.doesNotMatch(text, /Fable/);
});

test('status without a player request distinguishes idle survival from no saved task', () => {
  assert.match(statusMessage(bot, { idle: true, goal: {} }), /Between requests: watching survival needs/);
  assert.equal(statusMessage(bot, null, null), 'No saved task.');
});
