'use strict';
// A night slept through ends the hits before it (note 2314).
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const hitLog = require('../src/hit-log');

test('hits and falls of health before the bot woke are not recent after it', () => {
  const bot = Object.assign(new EventEmitter(), { health: 20, heldItem: null, entity: { position: { x: 0, y: 64, z: 0 } }, inventory: { slots: [] } });
  hitLog.install(bot);
  const t0 = Date.now() - 5000;
  for (let i = 0; i < 7; i++) hitLog.note(bot, { name: 'zombie', id: 3 }, t0 + i * 100);
  hitLog.noteDrop(bot, 20, 14, t0 + 700);
  assert.equal(hitLog.recent(bot, { ms: 30000 }).length, 7);
  assert.equal(hitLog.drops(bot, { ms: 30000 }).length, 1);
  bot.emit('wake');
  assert.equal(hitLog.recent(bot, { ms: 30000 }).length, 0, 'the fight before bed is over on waking');
  assert.equal(hitLog.drops(bot, { ms: 30000 }).length, 0);
  hitLog.note(bot, { name: 'skeleton', id: 4 });
  assert.equal(hitLog.recent(bot, { ms: 30000 }).length, 1, 'a hit after waking counts');
});
