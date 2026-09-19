'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { statusMessage } = require('../src/status');
const { completion, friendlyProblem } = require('../src/speech');
const bot = { health: 18, food: 16 };

test('chat explains a blocked request simply while preserving the detailed saved error', () => {
  const saved = { status: 'blocked', request: 'Jev get me one bedrock', lastError: 'No supported survival acquisition method for bedrock' };
  const before = JSON.stringify(saved);
  const text = statusMessage(bot, { idle: true, goal: { survivalAction: { action: 'cook_food' } } }, saved);
  assert.match(text, /don't know a way to get that in Survival/);
  assert.match(text, /cooking food/); assert.doesNotMatch(text, /acquisition|cook_food|Health 18/);
  assert.equal(JSON.stringify(saved), before);
});

test('active work is explained instead of showing an older request or raw decision paths', () => {
  const text = statusMessage(bot, { goal: { status: 'running', request: 'Jev come here', step: { action: 'come' }, decisions: [{ path: ['technical_node'] }] } },
    { status: 'blocked', request: 'old bedrock request' });
  assert.match(text, /coming to you/); assert.doesNotMatch(text, /bedrock|technical_node|running:/);
});

test('completion, cancellation and thinking have distinct simple messages', () => {
  assert.match(statusMessage(bot, null, { status: 'complete' }), /finished/);
  assert.match(statusMessage(bot, null, { status: 'cancelled' }), /stopped/);
  const text = statusMessage(bot, { goal: { status: 'running', recoveryAdvice: { active: true }, lastError: 'Fable diagnosis' } });
  assert.match(text, /need to think/); assert.doesNotMatch(text, /Fable/);
  assert.match(statusMessage(bot, null, null), /ready/);
});

test('combined progress tells the player how many things are done and what comes next', () => {
  const goal = { kind: 'bundle', status: 'running', tasks: [{ item: 'diamond_helmet', count: 1, status: 'complete' }, { item: 'white_bed', count: 1 }],
    step: { action: 'combined_request', detail: { action: 'craft', item: 'white_bed' } } };
  const text = statusMessage(bot, { goal });
  assert.match(text, /making white bed/); assert.match(text, /1 of 2 things done/); assert.doesNotMatch(text, /white_bed|combined_request/);
  assert.doesNotMatch(completion({ kind: 'obtain', item: 'diamond_helmet', count: 1, deliver: true }), /verified|inventory|pickup confirmed|_/);
  assert.doesNotMatch(friendlyProblem('TypeSafe 500 backend_error'), /TypeSafe|backend|500/);
});
