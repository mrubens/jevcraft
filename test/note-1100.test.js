'use strict';
// Note 1100: the first answer to a skeleton, priced from the record.
const test = require('node:test');
const assert = require('node:assert');
const { says, RECORD } = require('../src/skeleton-record');

test('the run from a skeleton says the arrows the record took after it, beside cover and the walk out of sight (note 1100)', () => {
  assert.match(says('retreat', false), /no shield carried\), the arrows a skeleton landed in the minute after the first answer to it: a run 1\.2 \(29 times\); against cover laid 0\.8 \(45 times\), a walk out of its sight 0\.3 \(20 times\)\./);
  assert.match(says('out_of_sight', true), /a shield carried\).*: a walk out of its sight 0\.4 \(29 times\); against a run 0\.5 \(19 times\), cover laid 0\.5 \(49 times\)\./);
  assert.equal(says('fight', false), '');
  assert(RECORD.retreat.bare[0] >= 20);
});
