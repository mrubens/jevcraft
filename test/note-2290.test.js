'use strict';
// Note 2290: the shear offer says the live sheep known, what a shearing gives against a kill, and the beds wanted.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const shearing = require('../src/shearing');

test('the offer says sheep in view, flocks remembered, shears or their iron, and the beds', () => {
  const sheep = (id, x) => ({ id, name: 'sheep', isValid: true, position: new Vec3(x, 64, 0), metadata: [] });
  const bot = { game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) }, entities: { 1: sheep(1, 5), 2: sheep(2, 8) }, registry: { entitiesByName: { sheep: { metadataKeys: [] } } },
    inventory: { items: () => [{ name: 'iron_ingot', count: 3 }, { name: 'white_bed', count: 1 }, { name: 'white_wool', count: 2 }] } };
  const goal = { sightings: { sheep: [{ x: 100, z: 0, count: 4, dimension: 'overworld' }, { x: 900, z: 0, count: 9, dimension: 'overworld' }] } };
  const says = shearing.shearSays(bot, goal);
  assert.match(says, /^2 sheep in view \(2 with wool\), and 4 more remembered in 1 flock within 256 blocks, the nearest 4 at 100 blocks; no shears carried: a pair is 2 iron ingots/);
  assert.match(says, /1 bed and 2 wool carried now, against one to sleep in and four the End's fight blows up at the dragon\.$/);
  assert.equal(shearing.shearReady(bot, goal), true, 'offered with the iron for shears and none made');
});
