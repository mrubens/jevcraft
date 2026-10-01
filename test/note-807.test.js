'use strict';
// Trial note 807: the route search reads each cell once a short while over
// mineflayer's own world; what a cell is to a walk (safe, physical) is
// worked out afresh with the rules in force; a cell the server changes is
// read again at once.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const Block = require('prismarine-block')(registry);
const { SurvivalMovements } = require('../src/movement');

test('a cell read once a short while, its facts fresh, a changed cell read again (note 807)', () => {
  let reads = 0;
  const names = new Map();
  const blockAt = function (p) { reads++; const n = names.get(`${p.x},${p.y},${p.z}`) || (p.y < 64 ? 'stone' : 'air'); const b = Block.fromStateId(registry.blocksByName[n].defaultState, 0); b.position = p; return b; };
  const bot = Object.assign(new EventEmitter(), { registry, version: '26.1', game: { dimension: 'overworld' }, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, inventory: { items: () => [] }, blockAt });
  bot._worldBlockAt = bot.blockAt;
  const m = new SurvivalMovements(bot);
  const node = { x: 0, y: 64, z: 0 };
  const a = m.getBlock(node, 0, -1, 0), b2 = m.getBlock(node, 0, -1, 0), c = m.getBlock({ x: 0, y: 63, z: 0 }, 0, 0, 0);
  assert.equal(reads, 1, 'one read for the cell, however it is asked');
  assert.equal(a.physical, true); assert.equal(b2.physical, true); assert.equal(c.height, 64);
  // The rules in force: a kind to avoid is not safe from the next ask on.
  const air = m.getBlock(node, 0, 0, 0);
  assert.equal(air.safe, true);
  m.blocksToAvoid.add(registry.blocksByName.air.id);
  assert.equal(m.getBlock(node, 0, 0, 0).safe, false);
  // A cell the server changes is read again.
  names.set('0,63,0', 'lava');
  bot.emit('blockUpdate', null, { position: new Vec3(0, 63, 0) });
  assert.equal(m.getBlock(node, 0, -1, 0).name, 'lava');
  assert.equal(reads, 3);
});
