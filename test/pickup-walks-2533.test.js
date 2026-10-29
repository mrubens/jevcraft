'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fp = require('../src/failed-places');

test("a pickup's failed walks are not walks from here failing; the work's are (note 2533)", () => {
  const bot = { entity: { position: { x: 0, y: 64, z: 0 } }, game: { dimension: 'the_nether' }, _walks: [] };
  const now = Date.now();
  for (let i = 0; i < 9; i++) fp.noteWalk(bot, { kind: 'no_route', goal: { x: 3, y: 64, z: 0 }, from: { x: 0, y: 64, z: 0 }, at: now - 1000 * (9 - i), walk: i + 1, pickup: true });
  assert.strictEqual(fp.failedWalks(bot, now).length, 0);
  assert.strictEqual(fp.pacingSays(bot, { x: 29, y: 64, z: 0 }, { now }), null);
  for (let i = 0; i < 9; i++) fp.noteWalk(bot, { kind: 'no_route', goal: { x: 3, y: 64, z: 0 }, from: { x: 0, y: 64, z: 0 }, at: now - 500 + i, walk: 20 + i });
  assert.strictEqual(fp.failedWalks(bot, now).length, 9);
});
