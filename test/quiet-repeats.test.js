'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { quietRepeats } = require('../src/speech');

test('an identical line inside the window is dropped, a different one is not, and the window expires', () => {
  const said = [], bot = { chat: line => said.push(line), _client: new EventEmitter() };
  quietRepeats(bot, { windowMs: 1000, replyMs: 100 });
  bot.chat('Cornered. Holding here and defending.');
  bot.chat('Cornered. Holding here and defending.');
  bot.chat('Getting 24 oak log.');
  assert.deepEqual(said, ['Cornered. Holding here and defending.', 'Getting 24 oak log.']);
  assert.equal(bot._quietRepeats.dropped, 1);
  const then = Date.now; Date.now = () => then() + 1500;
  try { bot.chat('Cornered. Holding here and defending.'); } finally { Date.now = then; }
  assert.equal(said.length, 3, 'news again once the window has passed');
});

test('a reply to a player who just spoke is never dropped, and the filter installs once', () => {
  const said = [], bot = { chat: line => said.push(line), _client: new EventEmitter() };
  quietRepeats(bot, { windowMs: 60000, replyMs: 5000 });
  quietRepeats(bot);
  bot.chat("I'm building a house."); bot.chat("I'm building a house.");
  assert.equal(said.length, 1);
  bot._client.emit('playerChat', {});
  bot.chat("I'm building a house.");
  assert.equal(said.length, 2, 'asked again, answered again');
});
