'use strict';
// Note 2392. full-25 (25587, 2026-10-28 15:5xZ) turned between mine and
// tunnel four times in 13 seconds 2.8 blocks from iron at (3, 32, 98): the
// tunnel stopped within four blocks, a block of stone in the line from the
// eyes, and the mine step found no stand and no line. The tunnel's end digs
// the rock on that line, none with lava or water behind it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { clearLineToOre } = require('../src/work');

const world = (solid, extra = {}) => ({ entity: { position: new Vec3(1.5, 32, 100.5), eyeHeight: 1.62 },
  blockAt: p => { const k = `${p.x},${p.y},${p.z}`; const name = extra[k] || (solid.has(k) ? 'stone' : 'air'); return { name, position: p, boundingBox: name === 'stone' || name === 'iron_ore' ? 'block' : 'empty' }; } });
const task = { check() {} };

test('within reach of the ore with stone in the line, the stone is dug and the ore is not (note 2392)', async () => {
  const solid = new Set(['2,32,99', '2,33,99', '3,33,99', '2,32,98', '2,33,98']);
  const bot = world(solid, { '3,32,98': 'iron_ore' });
  const dug = [];
  const n = await clearLineToOre(bot, task, new Vec3(3, 32, 98), { digBlock: async (b, t, c) => { dug.push(`${c}`); solid.delete(`${c.x},${c.y},${c.z}`); } });
  assert(n >= 1, `dug ${n}`);
  assert(!dug.includes('(3, 32, 98)'), 'not the ore itself');
});

test('lava behind the rock in the line stops the digging (note 2392)', async () => {
  const solid = new Set(['2,32,99', '2,33,99']);
  const bot = world(solid, { '3,32,98': 'iron_ore', '2,34,99': 'lava', '2,33,100': 'lava' });
  const dug = [];
  await clearLineToOre(bot, task, new Vec3(3, 32, 98), { digBlock: async (b, t, c) => { dug.push(`${c}`); } });
  assert.deepEqual(dug, []);
});

test('out of reach, nothing is dug (note 2392)', async () => {
  const bot = world(new Set(['5,32,95']), { '9,32,90': 'iron_ore' });
  assert.equal(await clearLineToOre(bot, task, new Vec3(9, 32, 90), { digBlock: async () => assert.fail('dug') }), 0);
});

test('the line open and the ore in reach, the ore itself is dug from the tunnel\'s end (note 2399)', async () => {
  const solid = new Set(['2,32,99', '2,33,99']);
  const bot = world(solid, { '3,32,98': 'iron_ore' });
  bot.canDigBlock = b => b.name === 'iron_ore';
  const dug = [];
  await clearLineToOre(bot, task, new Vec3(3, 32, 98), { digBlock: async (b, t, c) => { dug.push(`${c}`); solid.delete(`${c.x},${c.y},${c.z}`); } });
  assert.equal(dug.at(-1), '(3, 32, 98)', dug.join(' '));
});
