'use strict';
// Trial note 798: the blaze gate (783) withholds nothing while walks from
// here are refused for failing (785): the way kept would not begin, and a
// question left with one option is taken without Jev, so no answer came to
// lift the refusal (25597, 2026-10-01 10:57-11:08Z).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const BG = require('../src/blaze-goal');
const FP = require('../src/failed-places');

function netherBot() {
  return { entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, game: { dimension: 'the_nether', gameMode: 'survival' }, entities: {}, players: {},
    registry: require('minecraft-data')('26.1'), inventory: { items: () => [{ name: 'iron_sword', count: 1 }] } };
}
const goal = () => ({ kind: 'win', request: 'beat the game', survival: {}, gameProgress: { phase: 'obtain_blaze_rods' },
  mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 7, sightings: [{ x: 10, y: 64, z: 10, dimension: 'the_nether', seen: 20, at: Date.now() - 60000 }] },
  fortressSearch: { map: { spawners: [] } } });
const tree = () => ({ leg_north: { description: 'Search north.' }, to_blazes: { description: 'Walk to the blazes.' }, carry_on: { description: 'Carry on.' } });

test('walks from here refused: the gate withholds nothing and says why', () => {
  const bot = netherBot(), g = goal();
  const gated = BG.gate(bot, g, 'fortress_leg', tree(), { area: 'travel' });
  assert.ok(!('leg_north' in gated.tree), 'gated while walks begin');
  const now = Date.now();
  for (let i = 0; i < 3; i++) FP.noteWalk(bot, { kind: 'no_route', goal: { x: 40 + i * 10, y: 64, z: 0 }, from: bot.entity.position, at: now - 1000 * (3 - i) });
  assert.ok(FP.pacingSays(bot, null), 'walks are refused from here');
  const open = BG.gate(bot, g, 'fortress_leg', tree(), { area: 'travel' });
  assert.deepEqual(Object.keys(open.tree), ['leg_north', 'to_blazes', 'carry_on']);
  assert.match(open.facts[0], /^7 blaze rods still needed and blazes are known, but walks from here are not begun: .*Every option is offered\.$/);
});

test('a walk refused once since the last failure: the next one begins; a new failure refuses again', () => {
  const bot = netherBot(), now = Date.now(), from = bot.entity.position;
  for (let i = 0; i < 3; i++) FP.noteWalk(bot, { kind: 'no_route', goal: { x: 40 + i * 10, y: 64, z: 0 }, from, at: now - 5000 + i * 1000 });
  assert.ok(FP.pacingSays(bot, { x: 90, y: 64, z: 0 }, { now }), 'refused');
  FP.noteWalk(bot, { kind: 'refused', goal: { x: 90, y: 64, z: 0 }, from, at: now + 1 });
  assert.equal(FP.pacingSays(bot, { x: 90, y: 64, z: 0 }, { now: now + 2 }), null, 'begins after one refusal');
  FP.noteWalk(bot, { kind: 'no_route', goal: { x: 90, y: 64, z: 0 }, from, at: now + 3 });
  assert.ok(FP.pacingSays(bot, { x: 100, y: 64, z: 0 }, { now: now + 4 }), 'refused again after a new failure');
});
