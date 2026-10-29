'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');

test('the fight with the blazes here is said: begun, killed since and under what, about now (note 2540)', () => {
  const bf = require('../src/blaze-fight');
  const bot = new EventEmitter();
  const blaze = id => ({ id, name: 'blaze', position: new Vec3(5, 64, 0), isValid: true });
  Object.assign(bot, { entity: { position: new Vec3(0, 64, 0) }, game: { dimension: 'the_nether' }, entities: { 1: blaze(1), 2: blaze(2) }, _goal: { survivalAction: { action: 'close_in', stance: true } } });
  bf.install(bot);
  const now = Date.now();
  bf.look(bot, now - 6 * 60000);
  assert.match(bf.says(bot, now), /none killed since; 2 about within 24 now, the most at once 2/);
  bot.emit('entityDead', bot.entities[1]); delete bot.entities[1];
  const s = bf.says(bot);
  assert.match(s, /1 killed since \(1 under close in\)/);
  assert.match(s, /1 about within 24 now/);
  bot.emit('end');
});
