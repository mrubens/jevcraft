'use strict';
// The night's shelter claim says the bed: carried, or placed and how far (note 2317).
const test = require('node:test');
const assert = require('node:assert/strict');
const { claimSays } = require('../src/arbiter');

const shelter = bed => ({ layer: 'survival', action: 'secure_shelter', urgency: 'pressing', facts: { health: 20, food: 20, night: true, underground: false, sealFor: 'for the night on the surface', bed } });

test('the shelter claim says the placed bed and its walk, the carried bed, or none', () => {
  assert.match(claimSays(shelter({ carried: false, placed: { at: { x: 210, y: 75, z: 227 }, blocks: 135, up: -27 } })),
    /A night slept through passes in seconds, where one awake is the minutes to dawn: no bed is carried; the bed slept in is at \(210, 75, 227\), 135 blocks off, 27 blocks down, about 30 seconds at a walk where the way is open\./);
  assert.match(claimSays(shelter({ carried: true })), /a bed is carried, set down here at bedtime\./);
  assert.match(claimSays(shelter({ carried: false })), /no bed is carried and none is placed\./);
  assert.doesNotMatch(claimSays({ ...shelter({ carried: true }), facts: { ...shelter({ carried: true }).facts, underground: true } }), /slept through/);
});
