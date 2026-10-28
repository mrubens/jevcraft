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

test('underground, the light where the bot stands and the armour worn are said (note 2323)', () => {
  const bot = botAt(15000, 84);
  bot.blockAt = p => ({ name: p.y >= 84 ? 'air' : (p.y === 30 ? 'cave_air' : 'stone'), boundingBox: p.y >= 84 || p.y === 30 ? 'empty' : 'block', position: p, light: 0 });
  bot.inventory.slots = [];
  assert.match(nightAheadSays(bot, {}), /The block light here is 0: monsters spawn here, by day as by night\. Nothing is worn: every hit lands whole\./);
  bot.blockAt = p => ({ name: p.y >= 84 ? 'air' : (p.y === 30 ? 'cave_air' : 'stone'), boundingBox: p.y >= 84 || p.y === 30 ? 'empty' : 'block', position: p, light: 12 });
  bot.inventory.slots = { 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' } };
  assert.match(nightAheadSays(bot, {}), /The block light here is 12: monsters spawn only where it is 0, in the dark about it\. 2 of 4 armour pieces worn\./);
});
