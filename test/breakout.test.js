'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { breakOut } = require('../src/work');
const { Task } = require('../src/skills');

test('sealed in a pocket, the bot digs a doorway two high toward where it is going and steps out', async () => {
  // Trial 16: the night's pocket in the rock, an iron pickaxe, seven minutes of failed searches.
  const open = new Set(['0,64,0', '0,65,0']);
  const dug = [];
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, game: { gameMode: 'survival' }, inventory: { items: () => [] }, canDigBlock: () => true,
    blockAt: p => { const k = `${p.x},${p.y},${p.z}`; const name = open.has(k) ? 'air' : 'stone';
      return { position: p, name, type: name === 'air' ? 0 : 1, boundingBox: name === 'air' ? 'empty' : 'block', diggable: true, digTime: () => 100 }; },
    dig: async block => { open.add(`${block.position.x},${block.position.y},${block.position.z}`); dug.push(`${block.position}`); },
    pathfinder: { setGoal() {}, movements: {}, goto: async g => { bot.entity.position = new Vec3(g.x + 0.5, g.y, g.z + 0.5); } } };
  assert.equal(await breakOut(bot, new Task('out'), new Vec3(30, 64, 0)), true);
  assert.deepEqual(dug.sort(), ['(1, 64, 0)', '(1, 65, 0)'], 'toward the target, feet and head');
  assert.equal(bot.entity.position.floored().x, 1, 'and stepped into it');
  assert.equal(await breakOut(bot, new Task('out'), new Vec3(30, 64, 0)), false, 'not walled in any more: nothing to break');
});
