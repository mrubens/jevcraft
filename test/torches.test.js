'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { blockLight, darkCells, torchPlan, groundCells } = require('../src/torches');

const flat = (blocks = {}) => ({
  registry: require('minecraft-data')('26.1'),
  entity: { position: new Vec3(0, 64, 0) },
  findBlocks: () => Object.keys(blocks).map(k => new Vec3(...k.split(',').map(Number))),
  blockAt: p => {
    const name = blocks[`${p.x},${p.y},${p.z}`] || (p.y < 64 ? 'grass_block' : 'air');
    return { name, position: p, boundingBox: name === 'air' || name === 'torch' ? 'empty' : 'block', skyLight: 0 };
  },
});

test('a torch lights thirteen steps along the grid; the fourteenth is dark', () => {
  const sources = [{ position: new Vec3(0, 64, 0), emission: 14 }];
  assert.equal(blockLight(new Vec3(13, 64, 0), sources), 1);
  assert.equal(blockLight(new Vec3(7, 64, 7), sources), 0);
});

test('dark ground around a lone torch is found, and a plan of torches covers it', () => {
  const bot = flat({ '0,64,0': 'torch' });
  const cells = groundCells(bot, new Vec3(0, 64, 0), 12);
  const dark = darkCells(bot, cells);
  assert(dark.length > 0 && dark.every(c => Math.abs(c.x) + Math.abs(c.z) >= 14), 'only the corners are dark');
  const plan = torchPlan(dark);
  assert(plan.length >= 4 && plan.length <= 6, `${plan.length} torches`);
  assert(dark.every(d => plan.some(p => Math.abs(p.x - d.x) + Math.abs(p.y - d.y) + Math.abs(p.z - d.z) < 14)), 'every dark cell is covered');
});

test('farmland and a bed are not places a monster spawns', () => {
  const bot = flat({ '1,63,0': 'farmland', '2,63,0': 'white_bed' });
  assert.equal(darkCells(bot, [new Vec3(1, 64, 0), new Vec3(2, 64, 0), new Vec3(3, 64, 0)]).length, 1);
});
