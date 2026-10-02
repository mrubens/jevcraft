'use strict';
// Note 858: what each biome's facts say of the farm animals agrees with the
// 26.1.2 server jar's own spawn lists (test/fixtures/biome-creatures-26.1.2.json,
// read from data/minecraft/worldgen/biome). The badlands were said to have
// armadillos only; the jar spawns sheep, cows, pigs and chickens there.
const test = require('node:test');
const assert = require('node:assert/strict');
const { biomeFacts } = require('../src/biomes');
const JAR = require('./fixtures/biome-creatures-26.1.2.json');

test('every biome said, its sheep, cows, pigs and chickens as the jar spawns them (note 858)', () => {
  const bad = [];
  for (const [biome, creatures] of Object.entries(JAR)) {
    const says = biomeFacts(biome);
    if (says == null) continue;
    for (const a of ['sheep', 'cow', 'pig', 'chicken']) if (new RegExp(a).test(says) !== creatures.includes(a)) bad.push(`${biome} ${a}`);
  }
  assert.deepEqual(bad, []);
});
