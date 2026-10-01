'use strict';
// Trial note 819: the portal plan makes no more buckets than the pockets
// hold full (a lava bucket does not stack), and says so.
const test = require('node:test');
const assert = require('node:assert/strict');
const PP = require('../src/portal-plan');

test('buckets made first stop at the pockets\' room for lava buckets, and the price says it (25589 mid-226-am, note 819)', () => {
  const wide = PP.priceCast({ reach: 30, trip: 20, toFetch: 10, carriers: 4, ingots: 30, room: Infinity });
  assert.equal(wide.buckets, 10, 'with room, ten made for one trip');
  const tight = PP.priceCast({ reach: 30, trip: 20, toFetch: 10, carriers: 4, ingots: 30, room: 5 });
  assert.ok(tight.buckets <= 5, `${tight.buckets} buckets with room for 5`);
  assert.equal(tight.trips, 2);
  assert.match(PP.priceSays(tight), /the pockets hold 5 lava buckets at once \(a full one takes a slot of its own\), so no more are carried a trip/);
  assert.doesNotMatch(PP.priceSays(wide), /the pockets hold/);
});
