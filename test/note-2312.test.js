'use strict';
// An ore offered says what it drops and what the run makes of it (note 2312).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

test('diamond ore is said as the diamond pickaxe that mines obsidian', () => {
  const { oreUseSays } = require('../src/work');
  const registry = require('minecraft-data')('26.1');
  const bot = { registry, inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }] }, findBlocks: () => [new Vec3(1, -5, 1), new Vec3(2, -5, 1)], blockAt: () => ({ name: 'deepslate_diamond_ore' }), entity: { position: new Vec3(0, -5, 0) } };
  const says = oreUseSays(bot, 'deepslate_diamond_ore');
  assert.match(says, /^ It drops diamond \(0 carried\); 2 such blocks within 16 blocks\. Three diamonds make a diamond pickaxe, none carried: the only pickaxe that mines obsidian/);
  assert.equal(oreUseSays(bot, 'stone'), '');
});
