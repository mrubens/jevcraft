'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const rodBank = require('../src/rod-bank');

const bot = carried => ({ entity: { position: new Vec3(10.5, 73, 90.5) }, game: { dimension: 'overworld', gameMode: 'survival' },
  inventory: { items: () => Object.entries(carried).map(([name, count]) => ({ name, count })), slots: {} } });

test('the bank by the portal stays shut while the pearls that make up the count lie in the Nether\'s chests (note 1262)', () => {
  const over = { position: { x: 11, y: 73, z: 90 }, dimension: 'overworld', contents: { blaze_rod: 7, ender_pearl: 5 } };
  const nether = { position: { x: -196, y: 74, z: 137 }, dimension: 'nether', contents: { ender_pearl: 8 } };
  const goal = { kind: 'win', rodStashes: [over, nether] };
  assert.equal(rodBank.collectHere(bot({}), goal), null, 'five pearls on this side of thirteen: the Nether\'s first');
  // The pearls brought out: now it is taken out.
  nether.contents = {};
  assert.equal(rodBank.collectHere(bot({ ender_pearl: 8 }), goal).action, 'collect_rod_stash');
});
