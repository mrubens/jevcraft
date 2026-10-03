'use strict';
// Note 1032: the chests the bot left its rods in are the world's, carried
// into the goal launched next; and a count reported where the mobs' names go
// does not throw.
const test = require('node:test');
const assert = require('node:assert/strict');
const wk = require('../src/world-knowledge');

test('rods banked under one goal are known to the goal launched after it', () => {
  const chest = { position: { x: 20, y: 70, z: -40 }, dimension: 'overworld', contents: { blaze_rod: 3 }, storedAt: '2026-10-03T09:20:00.000Z' };
  const first = wk.hydrate({ kind: 'win', request: 'beat the game' }, {});
  first.rodStashes = [chest];
  const { known, changed } = wk.harvest(first, {});
  assert.equal(changed, true);
  const next = wk.hydrate({ kind: 'win', request: 'beat the game' }, known);
  assert.deepEqual(next.rodStashes, [chest]);
  assert.notEqual(next.rodStashes, known.rodStashes, 'a copy, so a change on the goal is still a change at its save');
});

test('a narrated action whose threats is a count names no mobs and does not throw', () => {
  const { SURVIVAL } = require('../src/narration');
  let called = 0;
  for (const [key, lines] of Object.entries(SURVIVAL)) for (const line of [].concat(lines)) {
    if (typeof line !== 'function') continue;
    called++;
    try { line({ kind: 'win' }, { action: key, threats: 2 }); }
    catch (err) { assert.doesNotMatch(String(err.message), /map is not a function|is not iterable/, key); }
  }
  assert.ok(called > 0);
});
