'use strict';
// Note 855: a column whose rock opens into water with open air over it is a
// rise and then a swim, said with the swim's seconds against a full breath.
// first-days-236: the bot starts on its own cobblestone at (210, 33, 423) in
// a cave, air at 34 to 36, stone at 37, water 38 to 62, air from 63.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { risePlan } = require('../src/unstuck');

const FEET = new Vec3(210, 34, 423);
const lake = (top = 62) => p => {
  if (p.y <= 33) return p.x === 210 && p.z === 423 && p.y === 33 ? 'cobblestone' : 'air';
  if (p.y <= 36) return 'air';
  if (p.y === 37) return 'stone';
  if (p.y <= top) return 'water';
  return 'air';
};
const view = name => ({ name, carried: { cobblestone: 64 }, pickaxe: 'iron_pickaxe', pickaxeUses: 200, health: 20 });

test('rock under a lake with air over it: rise_and_swim, its swim against a full breath (note 855)', () => {
  const r = risePlan(view(lake()), FEET);
  assert(r?.move, JSON.stringify(r));
  assert.equal(r.move.key, 'rise_and_swim');
  assert.equal(r.move.top, 36);
  assert.equal(r.move.swim.cells, 25);
  assert.match(r.move.does, /dig up into the water \(25 blocks of it, 0 more of rock or air dug or passed on the way\) and swim straight up to open air at y 63: about \d+ seconds of rising, then about 10 seconds of digging and swimming against 15 seconds of a full breath\./);
});

test('too deep a lake is said past the breath; lava over the rock is still refused (note 855)', () => {
  assert.match(risePlan(view(lake(80)), FEET).move.does, /past the breath, into the drowning/);
  const lava = p => (p.y === 38 ? 'lava' : lake()(p));
  assert.match(risePlan(view(lava), FEET).blocked, /lava in the column at y 38/);
});

test('water beside the column, rock over the head: no rise, the rock dug up into the water and the swim (note 855, 25597 at (204, 34, 425))', () => {
  const feet = new Vec3(204, 34, 425);
  const name = p => {
    if (p.y <= 33) return 'stone';
    if (p.x === 204 && p.z === 425) return p.y === 35 ? 'air' : p.y <= 38 ? 'stone' : p.y <= 62 ? 'water' : 'air';
    if (p.x === 203 && p.z === 425 && p.y >= 36) return p.y <= 62 ? 'water' : 'air';
    return p.y <= 35 ? 'air' : p.y <= 38 ? 'stone' : p.y <= 62 ? 'water' : 'air';
  };
  const r = risePlan(view(name), feet);
  assert(r?.move, JSON.stringify(r));
  assert.equal(r.move.rise, 0);
  assert.match(r.move.does, /^Dig up into the water \(24 blocks of it, 3 more of rock or air dug or passed on the way\) and swim straight up to open air at y 63/);
  assert.match(r.move.does, /the rock in it is dug from below as the swim goes/);
});

test('the rise and swim runs: the pillar to its top, then the swim; risen already, only the swim (note 855c: straightUp was not exported)', async t => {
  const { perform } = require('../src/unstuck');
  const vitals = require('../src/vitals');
  const pr = require('../src/pillar-recovery');
  const calls = [];
  t.mock.method(pr, 'pillarUp', async (bot, task, top) => { calls.push(['pillar', top]); bot.entity.position = new Vec3(206.5, top, 419.5); return true; });
  t.mock.method(vitals, 'straightUp', async (bot, task, { maxMs }) => { calls.push(['swim', maxMs]); });
  const bot = { entity: { position: new Vec3(206.5, 34, 419.5) }, blockAt: p => ({ name: 'water', boundingBox: 'empty', position: p }) };
  const m = { key: 'rise_and_swim', kind: 'rise_swim', top: 38, rise: 4, blocks: ['cobblestone'], swim: { cells: 23, water: 21, air: 63, seconds: 10.4 } };
  await perform(bot, { check() {} }, m, { dig: true });
  assert.deepEqual(calls, [['pillar', 38], ['swim', 16400]]);
  calls.length = 0;
  await perform(bot, { check() {} }, m, { dig: true });
  assert.deepEqual(calls, [['swim', 16400]]);
});
