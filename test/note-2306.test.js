'use strict';
// The night said by night, and where the bot is against it (note 2306).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { nightAheadSays } = require('../src/night-ahead');

const botAt = (timeOfDay, skyY) => ({
  time: { timeOfDay }, game: { dimension: 'minecraft:overworld', minY: -64, height: 384 },
  entity: { position: new Vec3(146.5, 30, 283.5) }, inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }] },
  blockAt: p => ({ name: p.y >= skyY ? 'air' : 'stone', boundingBox: p.y >= skyY ? 'empty' : 'block', position: p }),
  _survivalState: { spawnBed: { foot: { x: 400, y: 70, z: 400 } } },
});

test('by night, underground: dawn, the depth, the night changing nothing down there, and the spawn point', () => {
  const says = nightAheadSays(botAt(15000, 84), {});
  assert.match(says, /^Night now: dawn in about 6\.7 real minutes\./);
  assert.match(says, /The bot is \d+ blocks under open sky: down here the night changes nothing/);
  assert.match(says, /the night costs time at the surface/);
  assert.match(says, /The spawn point is the bed slept in at \(400, 70, 400\), 279 blocks off/);
});

test('by night at the surface: no depth said', () => {
  const says = nightAheadSays(botAt(15000, 31), {});
  assert.match(says, /^Night now/);
  assert.doesNotMatch(says, /under open sky/);
});

test('by day underground the depth is said with the coming night, and after dawn dusk is a day ahead', () => {
  assert.match(nightAheadSays(botAt(2000, 84), {}), /^Dusk in about 6\.3 real minutes.*under open sky/);
  assert.match(nightAheadSays(botAt(23500, 84), {}), /^Dusk in about 8\.3 real minutes/);
});
