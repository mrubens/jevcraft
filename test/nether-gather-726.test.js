'use strict';
// Note 726: 25593 (mid-242-qg, 2026-09-30 03:31Z) had 168 warped stems
// confirmed at (-83, 36, 51) and no crimson stem confirmed anywhere, only a
// crimson forest merely noticed (a landmark, never a sighting) that sat a
// little nearer as a raw straight-line distance. knownPlaces put the guess
// into the same "one of each kind" slot as the confirmed cluster and then
// resorted the pick by that raw distance, so the guess came out first: the
// fetch asked for crimson stems ("I need some crimson stems") it could not
// reach, and the "No way to crimson stem from here" error had to name the
// real 168 warped stems itself just to say what was actually known.
//
// A confirmed sighting must never be crowded out of the nearest-3 by a
// landmark guess of a different kind, and a guess must never be placed
// ahead of a confirmed sighting merely for being closer on the map.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { knownPlaces } = require('../src/nether-gather');

const STEM_NAMES = ['crimson_stem', 'warped_stem', 'crimson_hyphae', 'warped_hyphae'];

// A minimal Nether bot: warped stems really seen far off, nothing crimson
// seen anywhere, and a crimson forest merely noticed a little nearer.
function fakeBot({ here = new Vec3(0, 40, 0), warpedAt = new Vec3(-83, 36, 51) } = {}) {
  const ids = Object.fromEntries(STEM_NAMES.map((n, i) => [n, i + 1]));
  const blocks = new Map([[`${warpedAt.x},${warpedAt.y},${warpedAt.z}`, 'warped_stem']]);
  // 167 more warped stems clustered round the same spot, as the recorded
  // trial had (168 known in all).
  for (let i = 1; i <= 167; i++) blocks.set(`${warpedAt.x + (i % 12)},${warpedAt.y},${warpedAt.z + Math.floor(i / 12)}`, 'warped_stem');
  return {
    entity: { position: here },
    game: { dimension: 'the_nether' },
    registry: { blocksByName: Object.fromEntries(STEM_NAMES.map(n => [n, { id: ids[n] }])) },
    blockAt: p => { const name = blocks.get(`${p.x},${p.y},${p.z}`); return name ? { name } : null; },
    findBlocks: ({ matching, count }) => {
      const wanted = new Set(matching);
      const out = [];
      for (const [key, name] of blocks) { if (!wanted.has(ids[name])) continue; const [x, y, z] = key.split(',').map(Number); out.push(new Vec3(x, y, z)); if (out.length >= count) break; }
      return out;
    },
  };
}

test('a confirmed cluster of one kind is not crowded out by a merely noticed forest of the other, nearer as it sits (note 726)', () => {
  const bot = fakeBot();
  // The crimson forest noticed sits closer (raw distance) than the
  // confirmed warped stems, exactly the case that flipped the pick before.
  const goal = { landmarks: [{ kind: 'crimson_forest', x: -20, y: 40, z: 20, dimension: 'nether', firstAt: 1, seenAt: 1 }] };
  const places = knownPlaces(bot, goal, STEM_NAMES);
  assert(places.length, 'expected at least one place');
  assert.equal(places[0].name, 'warped_stem', `expected the confirmed warped stems first, got ${JSON.stringify(places.map(p => ({ name: p.name, n: p.n })))}`);
  assert.equal(places[0].n, 168);
  // The guessed crimson forest still appears (there is room for a second
  // slot), but only after the confirmed sighting, and marked as a guess.
  const crimsonGuess = places.find(p => p.name === 'crimson_stem');
  assert(crimsonGuess, 'the noticed forest should still be offered when a slot is free');
  assert.equal(crimsonGuess.n, 0);
});

test('with three confirmed places already filling the slots, a guess of an unconfirmed kind is left out entirely', () => {
  const bot = fakeBot();
  // Two more confirmed clusters, both nearer than the noticed forest, so
  // there is no free slot left for the guess.
  const near1 = new Vec3(-2, 40, 2), near2 = new Vec3(2, 40, -2);
  const orig = bot.blockAt.bind(bot);
  const extra = new Map([[`${near1.x},${near1.y},${near1.z}`, 'warped_hyphae'], [`${near2.x},${near2.y},${near2.z}`, 'crimson_hyphae']]);
  bot.blockAt = p => extra.get(`${p.x},${p.y},${p.z}`) ? { name: extra.get(`${p.x},${p.y},${p.z}`) } : orig(p);
  const origFind = bot.findBlocks.bind(bot);
  bot.findBlocks = args => [...origFind(args), near1, near2].slice(0, args.count);
  const goal = { landmarks: [{ kind: 'crimson_forest', x: -20, y: 40, z: 20, dimension: 'nether', firstAt: 1, seenAt: 1 }] };
  const places = knownPlaces(bot, goal, STEM_NAMES);
  assert.equal(places.length, 3, JSON.stringify(places.map(p => p.name)));
  assert(places.every(p => p.n > 0), 'no guess should have displaced a confirmed sighting');
});
