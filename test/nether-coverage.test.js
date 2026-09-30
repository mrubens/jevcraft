'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { Task } = require('../src/skills');
const coverage = require('../src/nether-coverage');

// A Nether of netherrack with open air where `open` says, the bot standing
// at `position`, sixty-four netherrack carried.
function world(position, open) {
  const at = p => {
    const q = p.floored ? p.floored() : p;
    const name = open(q) ? 'air' : 'netherrack';
    return { name, boundingBox: name === 'air' ? 'empty' : 'block', diggable: true, position: q, digTime: () => 400 };
  };
  return { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entity: { position }, entities: {},
    world: { raycast: () => null }, inventory: { items: () => [{ name: 'netherrack', count: 64, type: 1 }] }, findBlocks: () => [], chat() {}, blockAt: at };
}
const seenAt = (state, x, z) => { const c = coverage.coverageOf(state, 'nether'), cx = Math.floor(x / 4), cz = Math.floor(z / 4);
  return !!((c.seen[`${cx >> 2},${cz >> 2}`] || 0) & (1 << ((cx & 3) + 4 * (cz & 3)))); };

test('the Nether is seen through open air at fortress heights, not through rock, and where the bot stood is kept', () => {
  // A gallery x 0 to 60, z -3 to 3, y 57 to 66; another past ten blocks of rock at x 71 to 100.
  const open = p => p.y >= 57 && p.y <= 66 && Math.abs(p.z) <= 3 && ((p.x >= 0 && p.x <= 60) || (p.x >= 71 && p.x <= 100));
  const bot = world(new Vec3(2.5, 57, 0.5), open);
  const state = {};
  coverage.look(bot, state);
  assert(seenAt(state, 40, 0), 'down the gallery, through open air');
  assert(!seenAt(state, 85, 0), 'the gallery past the rock is not seen through it');
  assert(!seenAt(state, 20, 20), 'nor the rock beside it');
  const c = coverage.coverageOf(state, 'nether');
  assert.equal(c.stood['0,0'] & 1, 1, 'the column stood in');
  // Below the fortress heights nothing is counted seen.
  const low = world(new Vec3(2.5, 20, 0.5), p => p.y >= 20 && p.y <= 29 && Math.abs(p.z) <= 3 && p.x >= 0 && p.x <= 60);
  const lowState = {};
  coverage.look(low, lowState);
  assert(!seenAt(lowState, 40, 0), 'a gallery at y 20 shows nothing of y 48 to 79');
});

test('each leg says the ground it would show that is unseen and what seen before lies that way, and the old order (the tests\' stand-in) takes the most unseen, not the compass (note 572)', async () => {
  // The design review of 2026-09-27: a leg into air already looked across was offered on the same terms as one into space never seen.
  const { chooseLeg } = require('../src/mob-hunt');
  const { TypeSafeError } = require('../src/typesafe');
  // A long gallery east to west at y 57 to 66, rock north and south.
  const open = p => p.y >= 57 && p.y <= 75 && ((Math.abs(p.z) <= 3 && Math.abs(p.x) <= 300) || (p.x >= 8 && p.x <= 240 && Math.abs(p.z) <= 150));
  const bot = world(new Vec3(0.5, 57, 0.5), open);
  // The last legs walked east and back: that way is seen and stood on.
  const state = { legs: 2, heading: 0, lastHeading: 2 };
  for (let x = 96; x >= 0; x -= 4) { bot.entity.position = new Vec3(x + 0.5, 57, 0.5); coverage.look(bot, state); }
  bot.entity.position = new Vec3(0.5, 57, 0.5);
  const goal = { fortressSearch: state, mobHunt: { entity: 'blaze', sightings: [{ x: -150, y: 60, z: 2, dimension: 'the_nether', at: Date.now(), seen: 5, inSight: 5 }] } };
  const asked = [];
  const client = { systemOne: async ({ state: facts, questions }) => { asked.push({ facts, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: 'leg_west', confidence: 0.9 } } }; } };
  await chooseLeg(bot, new Task('hunt'), goal, () => {}, { client, navigate: async () => {}, tunnel: async () => {} }, state);
  const { facts, options } = asked[0];
  // The ground a leg looks over leads its words (note 688).
  // Its open air all stood on, it opens nothing (note 751).
  assert.match(options.leg_east, /^Unseen ahead: about \d+ of \d+ chunks \(\d+%\), mostly seen already; it opens none of it: its \d+ blocks in open air have all been stood on, the looks from them taken as they were walked, and what they did not reach is behind walls from there\. The bot has stood on 9[0-9] of its 96 blocks before: it walks again ground already walked and looked from, and what is unseen that way lies off to its sides and past its end\. Its end is 96 blocks from where the search began \(the bot is 1 from there now\)\. Go east 96 blocks/);
  assert.match(options.leg_west, /^Unseen ahead: about \d+ of \d+ chunks \([4-9]\d%\)/);
  assert.doesNotMatch(options.leg_west, /mostly seen|has stood on/);
  assert.match(options.leg_west, /Seen before and lying this way: the blazes seen 5 times at \(-150, 60, 2\), 151 blocks off\./);
  assert.doesNotMatch(options.leg_east, /the blazes seen/);
  assert.match(options.leg_north, /past its first 8 blocks the line is rock or lava at this height, so none of it is seen from the leg itself/);
  assert.match(facts.seenSoFar, /seen at fortress heights \(y 48 to 79\) through open air: about \d+ chunks' worth of ground in all/);
  assert.match(options.go_to_blazes, /It lies west of here; the bot has not stood within 32 blocks of it, so whether it can be walked to is not known\./);
  assert.equal(state.heading, 2);
  // No client, no blazes seen: the tests' stand-in by the old order (go_to_blazes first there): the compass's own heading was east, as open as west; the most unseen is west.
  state.heading = 0; delete goal.mobHunt.sightings;
  await chooseLeg(bot, new Task('hunt'), goal, () => {}, { client: null, navigate: async () => {}, tunnel: async () => {} }, state);
  assert.equal(state.heading, 2, 'west, the ground not yet seen, not east back over the seen');
  // Saved with the goal: the sets are plain JSON and come back the same.
  const saved = JSON.parse(JSON.stringify(goal));
  assert.deepEqual(saved.fortressSearch.coverage.nether.seen, state.coverage.nether.seen);
  assert(Object.keys(saved.fortressSearch.coverage.nether.stood).length >= 6);
});

test('the fallback without Jev: most unseen beside the leg\'s open air, a leg over ground stood on after the rest, then the most open air', () => {
  const { legFallback } = require('./support/jev-stand-in');
  const children = { leg_east: {}, leg_south: {}, leg_west: {}, leg_north: {} };
  const open = { leg_east: 96, leg_south: 0, leg_west: 96, leg_north: 0 };
  assert.equal(legFallback(children, [], { current: 'leg_east', open, unseen: { leg_east: 20, leg_south: 900, leg_west: 600, leg_north: 30 } }), 'leg_south');
  assert.equal(legFallback(children, [], { current: 'leg_east', open, unseen: { leg_east: 600, leg_south: 0, leg_west: 600, leg_north: 0 } }), 'leg_east', 'a tie in chunks: the most open, the compass at a tie');
  assert.equal(legFallback(children, [], { current: 'leg_east', open, unseen: { leg_east: 900, leg_south: 0, leg_west: 600, leg_north: 0 }, stood: { leg_east: 90 } }), 'leg_west', 'east walks its own line again');
});

test('from a pocket over the lava sea, a leg closed at its first cell is said, not offered, and with none open the step says so (mid-244-ab-nether-2, note 572)', async () => {
  // Every leg offered from a pocket at y 32 to 35 ended at once: "lava or water behind the netherrack", "the way passes beside lava".
  const { chooseLeg } = require('../src/mob-hunt');
  const make = lava => {
    const name = p => {
      if (p.y <= 30 || lava.has(`${p.x},${p.y},${p.z}`)) return 'lava';
      if (p.z === 0 && p.x <= 0 && p.x >= -100 && (p.y === 32 || p.y === 33)) return null;
      return 'netherrack';
    };
    const at = p => { const q = p.floored(), n = name(q); return { name: n || 'air', boundingBox: n && n !== 'lava' ? 'block' : 'empty', diggable: true, position: q, digTime: () => 400 }; };
    return { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entity: { position: new Vec3(0.5, 32, 0.5) }, entities: {},
      world: { raycast: () => null }, inventory: { items: () => [{ name: 'netherrack', count: 64, type: 1 }] }, findBlocks: () => [], chat() {}, blockAt: at };
  };
  // Lava in the way south; north, netherrack with lava behind it; east, netherrack to dig; west, a gallery.
  const pocket = ['0,32,1', '0,33,1', '0,32,-2'];
  const bot = make(new Set(pocket));
  const asked = [];
  const client = { systemOne: async ({ state: facts, questions }) => { asked.push({ facts, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: 'leg_west', confidence: 0.9 } } }; } };
  const state = { legs: 8 };
  await chooseLeg(bot, new Task('hunt'), { fortressSearch: state }, () => {}, { client, navigate: async () => {} }, state);
  const { facts, options } = asked[0];
  assert.deepEqual(Object.keys(options).filter(k => k.startsWith('leg_')).sort(), ['leg_east', 'leg_west']);
  assert.match(facts.legsClosed.join('; '), /leg south: closed at the first cell at y 32, lava in the way/);
  assert.match(facts.legsClosed.join('; '), /leg north: closed at the first cell at y 32, netherrack with lava or water behind it \(not dug\)/);
  assert.match(options.leg_east, /rock to dig/);
  // Nothing open and nothing else to offer: the step says why each way is closed.
  const shut = make(new Set([...pocket, '1,32,0', '-1,32,0']));
  await assert.rejects(chooseLeg(shut, new Task('hunt'), { fortressSearch: { legs: 9 } }, () => {}, { client, navigate: async () => {} }, { legs: 9 }),
    /No leg from here can be walked, dug or bridged: leg east: closed at the first cell at y 32, lava in the way; leg south: .*; leg west: closed at the first cell at y 32, lava in the way; leg north: closed at the first cell at y 32, netherrack with lava or water behind it \(not dug\)/);
});

test('the bot\'s own span a block off the line is ground stood on, and a leg follows it a block up or down (note 680)', () => {
  // mid-242-gb (25593) walked one span of ninety blocks four times: from one end the leg read the span a block below as "no floor, 90 to lay" and "stood on 6 of 96".
  const { surveyLeg, legSays } = require('../src/nether-travel');
  // Open air over a void, a span at y 52 (feet at 53) from x 0 to 90 at z 0; the bot at the east end standing a block up, on a step at y 53 (feet 54).
  const open = p => !(p.z === 0 && p.y === 52 && p.x >= 0 && p.x <= 90) && !(p.z === 0 && p.y === 53 && p.x >= 91 && p.x <= 93) && p.y > 20;
  const bot = world(new Vec3(92.5, 54, 0.5), open);
  bot.inventory = { items: () => [{ name: 'netherrack', count: 9, type: 1 }] };
  const west = surveyLeg(bot, [-1, 0], { cells: 96 });
  assert.equal(west.stepped, 1, 'one step down onto the span');
  assert(west.open - west.lay >= 90, `the span is floor to walk: ${JSON.stringify(west)}`);
  assert.equal(west.runsOut, null, 'nothing to lay on the span itself');
  assert.match(legSays(west, { direction: 'west', length: 96, y: 54 }), /steps a block up or down 1 time where the ground does/);
  // From the west end at feet 53, one below a ledge at the far end: the span, not rock to dig.
  bot.entity.position = new Vec3(0.5, 53, 0.5);
  const east = surveyLeg(bot, [1, 0], { cells: 90 });
  assert.equal(east.rock, 0, JSON.stringify(east));
  // Stood on a line a block to the side: counted from either end.
  const state = {};
  for (let x = 0; x <= 90; x++) { bot.entity.position = new Vec3(x + 0.5, 53, 3.5); coverage.stand(bot, state); }
  const h = coverage.headingCoverage(state, 'nether', new Vec3(92.5, 54, 4.5), [-1, 0], { length: 96 });
  assert(h.stood >= 88, `stood on ${h.stood} of 96, the span a block beside the line`);
});
