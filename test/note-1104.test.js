'use strict';
// Note 1104: what several options of one kind say word for word is said once.
const test = require('node:test');
const assert = require('node:assert');
const { saidOnce } = require('../src/said-once');

test('three fights with an enderman: the record they share stays on the first, each keeps its own lines (note 1104)', () => {
  const record = 'The arena\'s record of the hunt\'s fight with one enderman, nothing else about: 28 runs, 29 kills, a median 4.1 damage for a kill.';
  const ways = 'It is 2.9 tall and cannot come into a space under three blocks high, so a two-high pocket or hole keeps it out.';
  const tree = {
    hunt_1: { description: `Fight the enderman 8 blocks off, 6 up, out of sight now. ${record} About 12.5 seconds and 6 damage from 20 health. ${ways}` },
    hunt_2: { description: `Fight the enderman 14 blocks off, 2 up, out of sight now. ${record} About 21.5 seconds and 6 damage from 20 health. ${ways}` },
    defer: { description: `Leave these targets alone for now. ${ways}` },
  };
  saidOnce(tree, ['hunt_1', 'hunt_2']);
  assert.match(tree.hunt_1.description, /The arena's record/);
  assert.equal(tree.hunt_2.description, 'Fight the enderman 14 blocks off, 2 up, out of sight now. About 21.5 seconds and 6 damage from 20 health. The rest is as said of the first of them (hunt_1).');
  assert.match(tree.defer.description, /2\.9 tall/, 'an option of another kind is left whole');
  // One option, or nothing shared: untouched.
  const one = { hunt_1: { description: `A. ${record}` } };
  assert.equal(saidOnce(one, ['hunt_1']).hunt_1.description, `A. ${record}`);
});
