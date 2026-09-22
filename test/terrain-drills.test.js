'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TERRAIN, buildCommands, placeCommands } = require('../scripts/lib/terrain');
const { ARENAS } = require('../scripts/lib/arena');

test('every terrain drill names what happened live, builds its own place, and stays clear of the combat arenas', () => {
  assert.equal(new Set(TERRAIN.map(d => d.name)).size, TERRAIN.length);
  for (const d of TERRAIN) {
    assert(d.why && d.seconds > 0 && d.start.length === 3, d.name);
    const build = buildCommands(d);
    assert(build[0].includes('forceload add'), `${d.name} holds its chunks`);
    assert(build.every(line => line.startsWith(`execute in minecraft:${d.dimension} run`)), `${d.name} builds in its own dimension`);
    const [x, , z] = d.start;
    for (const arena of Object.values(ARENAS)) {
      const [x1, , z1, x2, , z2] = arena.shell;
      assert(x < x1 - 50 || x > x2 + 50 || z < z1 - 50 || z > z2 + 50, `${d.name} is well away from the combat arenas`);
    }
    const place = placeCommands('T', d).join('\n');
    assert(place.includes('clear T') && place.includes(`tp T ${d.start.join(' ')}`));
  }
});
