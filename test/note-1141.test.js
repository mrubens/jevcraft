'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { offerSays, PEARLS_LOST } = require('../src/rod-stash');

test('keeping pearls in a chest says what carrying them came to in the record (note 1141)', () => {
  const says = offerSays({ existing: { position: { x: -94, y: 67, z: 17 } }, steps: 0, what: [{ item: 'ender_pearl', count: 4 }], rods: 0, wanted: 7, seconds: 3, seenBy: [] });
  assert.match(says, /4 ender pearls carried and no rod\. A death drops them where the bot falls/);
  assert.match(says, /In the record \(2026-10-03, fourteen trials\), 16 deaths with pearls in the pack lost 47 of them, 1 to 6 at a time, of about 99 picked up in the Nether\./);
  assert.equal(PEARLS_LOST.pearls, 47);
});
