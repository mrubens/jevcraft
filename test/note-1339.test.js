'use strict';
// Note 1339: a swim on a heading said with what one drowned's hit does at the
// bot's health, when that is 8 or less. 25592 (2026-10-06 01:23Z), at 2
// health and hunger 10, swam for food and a drowned killed it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { headingFacts } = require('../src/exploration');

const stretches = [{ biome: 'forest', from: 0, to: 20 }, { biome: 'cold_ocean', from: 20, to: 60 }, { biome: 'forest', from: 60, to: 128 }];
const ground = [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44].map(d => ({ d, x: d, z: 0, y: 62, water: d >= 8 && d <= 40 }));

test('the swim says the health and the drowned hit that ends it, at low health only', () => {
  assert.match(headingFacts(stretches, ground, { health: 2, food: 10 }), /a swim of about 36; drowned live in the water[^)]*; at 2 health now, none coming back at hunger 10, one blow from a drowned \(3\) ends it\)/);
  assert.match(headingFacts(stretches, ground, { health: 7, food: 20 }), /; at 7 health now, one thrown trident \(8\) ends it\)/);
  assert.doesNotMatch(headingFacts(stretches, ground, { health: 15, food: 20 }), /health now/);
  assert.doesNotMatch(headingFacts(stretches, ground), /health now/);
});
