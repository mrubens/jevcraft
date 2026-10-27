'use strict';
// Note 2301: a flock seen is said with its height against the bot's and the walks toward it that failed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { sighted } = require('../src/sightings');

test('a flock on the summit says how far up it is', () => {
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(90, 84, 9) } };
  const goal = { sightings: { sheep: [{ x: 91, y: 120, z: 40, count: 2, at: Date.now(), dimension: 'overworld' }] } };
  const [s] = sighted(bot, goal, 'sheep');
  assert.match(s.says, /^2 sheep seen just now, 31 blocks [a-z-]+, 36 blocks up \(91, 120, 40\)$/);
});
