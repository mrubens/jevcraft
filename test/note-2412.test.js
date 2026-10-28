'use strict';
// Note 2412. full-24 (25588, 2026-10-28): 81 minutes on the pearls without one, hunt_enderman taken at 0.92 with its
// earlier hunts on the run having brought nothing (unsaid), and the warped forest's walk said with how the walks back
// to a portal ended.
const test = require('node:test');
const assert = require('node:assert/strict');
const { routeSays } = require('../src/pearl-record');
const { netherPaceSays } = require('../src/game-progress');

test("a way chosen on this run is said with its tally whether or not it brought a pearl (note 2412)", () => {
  const goal = { pearlLedger: { hunt_enderman: { chosen: 3, ms: 18 * 60000, pearls: 0, deaths: 0 } } };
  assert.match(routeSays('hunt_enderman', goal), /^This run: chosen 3 times, held 18 minutes, 0 pearls brought, 0 deaths in it\./);
  assert.doesNotMatch(routeSays('hunt_enderman', {}), /This run: chosen/);
});

test('a walk that is not to a portal is said with the pace alone (note 2412)', () => {
  const bot = { game: { dimension: 'the_nether' }, health: 20 };
  assert.match(netherPaceSays(bot, 78).says, /blocks a minute/);
  assert.match(netherPaceSays(bot, 78).says, /came out in the Overworld/);
  assert.doesNotMatch(netherPaceSays(bot, 78, { toPortal: false }).says, /came out in the Overworld/);
});
