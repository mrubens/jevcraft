'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { place } = require('../src/work');

test('placement refreshes a depleted stack before another construction material is selected', async () => {
  const target = new Vec3(2, 64, 0), items = [{ name: 'andesite', count: 1 }];
  let placed = false, synced = false;
  const bot = { game: { gameMode: 'survival' }, entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => items },
    equip: async () => {}, blockAt: p => ({ name: p.y === 63 ? 'stone' : placed && p.equals(target) ? 'andesite' : 'air',
      boundingBox: p.y === 63 || placed && p.equals(target) ? 'block' : 'empty', position: p }),
    placeBlock: async () => { placed = true; }, _syncWindow: async () => { items.length = 0; synced = true; } };
  await place(bot, new Task('last anchor'), target, 'andesite');
  assert(placed); assert(synced); assert.equal(items.length, 0);
});

test('stop interrupts a missing inventory acknowledgement after the world confirms placement', async () => {
  const task = new Task('cancel placement'), target = new Vec3(2, 64, 0);
  let placed = false;
  const bot = { game: { gameMode: 'survival' }, entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => [{ name: 'dirt', count: 1 }] },
    equip: async () => {}, blockAt: p => ({ name: p.y === 63 ? 'stone' : placed && p.equals(target) ? 'dirt' : 'air',
      boundingBox: p.y === 63 ? 'block' : 'empty', position: p }),
    placeBlock: async () => { placed = true; }, _syncWindow: () => { setTimeout(() => task.cancel(), 10); return new Promise(() => {}); } };
  await assert.rejects(place(bot, task, target, 'dirt'), { name: 'Cancelled' });
  assert(placed);
});
