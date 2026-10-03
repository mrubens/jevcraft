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

test('a running goal\'s chests are kept where the store has none yet, and a goal that knows none takes up the store\'s (note 1033)', () => {
  const chest = { position: { x: -113, y: 74, z: 158 }, dimension: 'nether', contents: { blaze_rod: 5 } };
  const running = wk.hydrate({ kind: 'win', rodStashes: [chest], portals: [{ x: 1, y: 2, z: 3 }] }, {});
  assert.deepEqual(running.rodStashes, [chest], 'not taken off for the store\'s not having them');
  assert.equal(running.portals, undefined, 'the world\'s other fields are the store\'s as before');
  const { known } = wk.harvest(running, {});
  assert.deepEqual(known.rodStashes, [chest]);
  const blank = wk.hydrate({ kind: 'win' }, {});
  const after = wk.harvest(blank, structuredClone(known));
  assert.deepEqual(after.known.rodStashes, [chest], 'not unlearned');
  assert.deepEqual(blank.rodStashes, [chest], 'taken up by the goal that knew none');
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
