'use strict';
// Note 1296: what hunger does from six down, said beside the work.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

test('hunger 3 and nothing to eat: no sprint, the drain at 0 and how fast hunger falls are said; at hunger 10 they are not', () => {
  const { workBodySays } = require('../src/arbiter');
  const bot = (food) => ({ health: 16, food, game: { difficulty: 'normal', dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) }, entities: {}, inventory: { items: () => [] }, registry: require('minecraft-data')('26.1') });
  const low = workBodySays(bot(3), []);
  assert.match(low, /At hunger 6 or less the bot cannot sprint; at 0 health falls a point every four seconds, to a single point; sprinting costs a point of hunger for about every 40 blocks\./);
  assert.doesNotMatch(workBodySays(bot(10), []), /cannot sprint/);
});

