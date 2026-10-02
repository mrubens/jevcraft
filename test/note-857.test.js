'use strict';
// Note 857: food left cooking in a furnace is among the food known. 25583
// left 4 mutton cooking and was told "nothing to eat" a hundred blocks on.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { foodSources, nearestFood } = require('../src/healing');

const bot = () => ({ registry: require('minecraft-data')('26.1'), game: { dimension: 'the_nether' }, entity: { position: new Vec3(148, 60, 59) }, entities: {} });

test('the batch left cooking is named with its distance, in its own dimension only (note 857)', () => {
  const goal = { smelting: { item: 'cooked_mutton', count: 4, position: { x: 44, y: 84, z: 124 }, dimension: 'the_nether', startedAt: Date.now() - 60000 } };
  const f = foodSources(bot(), goal).find(s => s.kind === 'furnace');
  assert(f, 'listed');
  assert.equal(f.points, 24);
  assert.match(nearestFood(bot(), goal).join(' '), /4 cooked mutton cooked and waiting in the furnace the bot left at \(44, 84, 124\), 125 blocks off \(24 hunger\)/);
  assert(!foodSources(bot(), { smelting: { ...goal.smelting, dimension: 'overworld' } }).some(s => s.kind === 'furnace'));
  assert(!foodSources(bot(), { smelting: { ...goal.smelting, item: 'iron_ingot' } }).some(s => s.kind === 'furnace'));
});
