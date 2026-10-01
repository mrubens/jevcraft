'use strict';
// Note 706: the live critic's report artifacts/critic/critic-20260930T0057Z.md
// items 1 and 2.
//  - 25588 (mid-243-hf) at 0.2 to 1.2 health, hunger 7 to 9, nothing to eat,
//    in the Nether for over ten minutes: the trip home chosen eight times, each
//    ending "cannot be reached from here", going on without food offered, and
//    one fortress named at five places, its approach begun again each time.
//  - 25581 (mid-243-hg): block_creeper asked twelve times in 24 seconds behind
//    one block, and working free taking back a pillar four moves on.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { groundBot } = require('./fixtures/saved-ground');

const SPAN = require('./fixtures/nether-span-mid-242-af.json');
const at = new Vec3(-29.5, 72, 48.5);
function netherBot({ health = 0.2, food = 7, items = [['iron_sword', 1], ['wooden_pickaxe', 1], ['netherrack', 150]] } = {}) {
  return groundBot(SPAN, { at, items: items.map(i => [...i]), health, food, dimension: 'the_nether', indexed: true, worn: ['iron_helmet', 'iron_chestplate'] });
}
// The portal 421 blocks off, as 25588's at (3, 42, 8) was.
const PORTAL = { x: 391, y: 42, z: 48 };
function goalOf() {
  return { kind: 'win', request: 'beat the game', portals: [{ ...PORTAL, dimension: 'nether' }, { x: 3128, y: 64, z: 384, dimension: 'overworld' }], gameProgress: { phase: 'obtain_blaze_rods' } };
}
// Every way the walk back begins with, resting: the legs, the crossing, the staircase.
function waysResting(bot, goal) {
  const { setAside } = require('../src/progress');
  const p = new Vec3(PORTAL.x, PORTAL.y, PORTAL.z);
  setAside(goal, 'portal_leg', p, 'a walk toward it made no ground', 120000);
  const h = bot.entity.position;
  setAside(goal, 'crossing', `${Math.floor(h.x / 8)},${Math.floor(h.z / 8)}>${p.x},${p.z}`, 'came no nearer', 300000);
  const area = { x: Math.floor(p.x / 8) * 8, y: Math.floor(p.y / 8) * 8, z: Math.floor(p.z / 8) * 8 };
  setAside(goal, 'staircase', area, 'the staircase toward it is not gaining on it', 10 * 60000);
}

test('one hit ends the bot and no health comes back: said in the game\'s numbers, and not where food or health changes it (note 706)', () => {
  const { lastHit } = require('../src/last-hit');
  const h = lastHit(netherBot());
  assert(h, 'at 0.2 health, hunger 7, nothing to eat');
  assert.match(h.says, /^At 0\.2 health any hit ends the bot: the lightest blow of the Nether's mobs is about [\d.]+ through the armour worn \(a [a-z ]+'s\), and a drop of four blocks costs one\. Health does not come back: hunger 7, under 18, and nothing to eat carried\. Only food brings it back; a way that brings none risks the end and gains no health\.$/);
  assert.equal(lastHit(netherBot({ health: 12 })), null, 'a hit does not end it at 12');
  assert.equal(lastHit(netherBot({ food: 18 })), null, 'health comes back at 18');
  assert.equal(lastHit(netherBot({ items: [['cooked_beef', 2]] })), null, 'two steaks bring hunger to 18 or more');
});

test('the trip home whose ways all rest is not offered and is said as not reachable, not as seconds at a walk (25588, note 706)', () => {
  const mh = require('../src/mob-hunt');
  const bot = netherBot(), goal = goalOf();
  assert.equal(mh.tripHomeClosed(bot, goal), null, 'nothing resting: the trip can begin');
  waysResting(bot, goal);
  const closed = mh.tripHomeClosed(bot, goal);
  assert(closed, 'legs, crossing and staircase resting');
  assert.match(closed.says, /^The way back to the portal \(the nearest known \d+ blocks off at 391, 42, 48\) cannot be reached from here: a leg of 32 blocks on foot toward it made no ground a moment ago \(resting\); the crossing straight at it came no nearer \(resting\); the staircase toward it rests \(the staircase toward it is not gaining on it\), 10 more minutes\.$/);
  const trip = require('../src/game-progress').portalTrip(bot, goal);
  assert.equal(trip, closed.says);
  assert.doesNotMatch(trip, /seconds at a walk/);
  // The food question's ways: no trip, said among the ways not offered;
  // no going on without food at this health.
  const nf = require('../src/nether-food');
  const found = nf.foodRoutes(bot, new Task('work'), goal, () => {}, { actions: { returnOverworld: async () => {}, navigate: async () => {} } });
  assert.equal(found.routes.return_for_food, undefined);
  assert(found.notOffered.some(n => /^the trip back through the portal: The way back to the portal .* cannot be reached from here/.test(n)), found.notOffered.join('\n'));
});

test('going on without food is not offered where one hit ends the bot, and the questions say it first (25588, note 706)', async () => {
  const nf = require('../src/nether-food');
  const decisions = require('../src/decisions'), decide = decisions.decide;
  const bot = netherBot(), goal = goalOf();
  // A bastion within reach keeps a way to food on offer.
  goal.landmarks = [{ kind: 'bastion', x: -40, y: 70, z: 120, dimension: 'nether', firstAt: Date.now(), seenAt: Date.now(), gold: 3 }];
  const found = nf.foodRoutes(bot, new Task('work'), goal, () => {}, { actions: { navigate: async () => {} } });
  assert(found.routes.raid_bastion, 'the bastion is a way to food');
  found.routes.raid_bastion.run = async () => {};
  const asked = [];
  decisions.decide = async (id, q) => { asked.push(q); return { path: ['raid_bastion'] }; };
  try {
    await nf.askRestockFood(bot, new Task('work'), goal, () => {}, { client: {}, found });
    assert.equal(asked[0].tree.keep_on, undefined, 'no twenty minutes on without food at 0.2 health');
    assert(asked[0].state.waysNotOffered.some(n => /^going on without food: At 0\.2 health/.test(n)));
    await nf.askRestockFood(netherBot({ health: 12 }), new Task('work'), goal, () => {}, { client: {}, found });
    assert(asked[1].tree.keep_on, 'offered where a hit does not end it');
  } finally { decisions.decide = decide; }
  // Every gameplay question says it, first.
  const said = [];
  const client = { systemOne: async ({ state, questions }) => { said.push(state); return { answers: { branch_0: { choice: Object.keys(questions.branch_0.criteria)[0], confidence: 0.9 } } }; } };
  await decisions.decide('upkeep', { client, bot, task: new Task('work'), goal, save: () => {}, tree: { fetch_stems: { description: 'Fetch stems.' }, carry_on: { description: 'Carry on.' } }, state: { health: 0.2 } });
  assert.equal(Object.keys(said[0])[0], 'lastHit');
  assert.match(said[0].lastHit, /^At 0\.2 health any hit ends the bot/);
});

test('a creeper out of its line is asked again as it comes into its blast\'s reach and each block nearer, not as it mills within three (25581, note 706)', () => {
  const { Survival } = require('../src/survival');
  const sight = require('../src/creeper-sight'), line = sight.sightLine;
  sight.sightLine = () => ({ stoppedBy: { name: 'netherrack', cell: '(1, 64, 0)' } });
  try {
    const creeper = { id: 9, name: 'creeper', position: new Vec3(9.4, 64, 0.5), isValid: true };
    const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 9: creeper } };
    const held = d => ({ choice: 'block_creeper', blockCreeper: { id: 9, creeperAt: creeper.position.clone(), distance: d, at: Date.now() } });
    const ask = h => Survival.prototype.blockCreeperHeld.call({ bot }, h);
    // 9.4 to 7.0: nearer, but outside its blast's reach: held.
    let h = held(9.4); creeper.position = new Vec3(7.5, 64, 0.5);
    assert.equal(ask(h), null);
    // Into the reach of six and a block nearer: the stance keeps the
    // distance by backing (note 778b), no new question.
    creeper.position = new Vec3(6.2, 64, 0.5);
    assert.equal(ask(h), null);
    // With no backing (a drop or lava behind), its closing is asked.
    h.blockCreeper.cannotBack = true;
    assert.match(ask(h), /^the creeper is coming nearer, from 9\.4 to 5\.7 blocks off, and there is no backing from it here \(a drop or lava behind\)$/);
    // Within a step of where it lights: asked, backing or not.
    h = held(5.7); creeper.position = new Vec3(3.6, 64, 0.5);
    assert.match(ask(h), /^the creeper is 3\.1 blocks off, within a step of the 3 where it lights, backing did not keep it off; 5\.7 when its line was cut$/);
    // Milling within three, no nearer: held (was asked five times so).
    h = held(2.5); creeper.position = new Vec3(3.0, 64, 1.2);
    h.blockCreeper.creeperAt = new Vec3(2.9, 64, -0.3);
    assert.equal(ask(h), null);
  } finally { sight.sightLine = line; }
});

test('working free does not take back a move of the last minute, not only the move before (25581, note 706)', () => {
  const { localMoves, liveView } = require('../src/unstuck');
  const bot = netherBot({ health: 20, food: 20 });
  const feet = bot.entity.position.floored();
  const view = liveView(bot);
  const under = `${feet.offset(0, -1, 0)}`;
  // The block under the feet was laid by a pillar four moves ago, three
  // bridges since.
  const now = Date.now();
  const recent = [
    { move: 'pillar', from: under, cell: under, kind: 'pillar', at: now - 9000, reached: true },
    { move: 'bridge_west', from: `${feet}`, cell: `${feet.offset(-1, -1, 0)}`, kind: 'place', at: now - 6000, reached: true },
    { move: 'bridge_north', from: `${feet}`, cell: `${feet.offset(0, -1, -1)}`, kind: 'place', at: now - 4000, reached: true },
    { move: 'bridge_east', from: `${feet}`, cell: `${feet.offset(1, -1, 0)}`, kind: 'place', at: now - 2000, reached: true },
  ];
  const before = localMoves(view, feet, { goal: 'away', visits: {}, from: feet, breathS: 15, last: recent.at(-1) });
  const after = localMoves(view, feet, { goal: 'away', visits: {}, from: feet, breathS: 15, last: recent.at(-1), recent });
  const keys = r => r.moves.map(m => m.key);
  if (keys(before).includes('dig_down')) {
    assert(!keys(after).includes('dig_down'), keys(after).join(','));
    assert(after.here.notOffered.some(n => /^dig down: it takes back a move of the last minute \(pillar\), back where the bot was$/.test(n)), after.here.notOffered.join('\n'));
  }
  // Each bridge's cell, filled a moment ago, is not dug again.
  for (const m of after.moves) if (m.kind === 'dig') assert(!recent.some(r => r.cell === `${m.cell}`), m.key);
});

test('one fortress is one place: bricks joined to it keep its approach and what failed on it, and a stall keeps the fortress (25588, note 706)', () => {
  const mh = require('../src/mob-hunt');
  const state = {};
  // A fortress's bricks from (-340, -330) to (-260, -290), eight blocks a link.
  const bricks = [];
  for (let x = -340; x <= -260; x += 4) for (let z = -330; z <= -290; z += 8) bricks.push(new Vec3(x, 70, z));
  const first = mh.fortressAnchor(state, bricks, new Vec3(-328, 73, -293));
  assert.deepEqual([first.x, first.z], [-328, -293]);
  for (const [x, z] of [[-303, -294], [-340, -326], [-264, -308], [-296, -309]]) {
    const a = mh.fortressAnchor(state, bricks, new Vec3(x, 70, z));
    assert.deepEqual([a.x, a.z], [-328, -293], `(${x}, ${z}) is the same fortress`);
  }
  assert(mh.sameFortress(state, { x: -328, z: -293 }, { x: -264, z: -308 }));
  // Another fortress, 400 blocks off with no bricks between: a new place.
  const other = mh.fortressAnchor(state, [new Vec3(100, 70, 100)], new Vec3(100, 70, 100));
  assert.deepEqual([other.x, other.z], [100, 100]);
  // A stall on the way in keeps the fortress and records the way that stalled.
  const goal = { fortressSearch: { found: { x: -264, y: 70, z: -308 }, fortressAt: { x: -328, y: 73, z: -293, extent: 80, seenAt: Date.now() }, approach: { found: { x: -296, y: 70, z: -309 }, failed: [], choice: 'walk_route', until: Date.now() + 60000 }, shunned: [] } };
  require('../src/work').looseEnds(goal);
  assert(goal.fortressSearch.found, 'the fortress found is kept');
  assert.equal(goal.fortressSearch.shunned.length, 0, 'no patch of it set aside');
  assert.deepEqual(goal.fortressSearch.approach.failed.map(f => f.choice), ['walk_route']);
  assert.equal(goal.fortressSearch.approach.choice, undefined);
  // The stall's words name the fortress, not the brick aimed at.
  const { friendlyProblem } = require('../src/speech');
  assert.match(friendlyProblem(new Error('No measurable progress on {"action":"find_fortress","found":{"x":-296,"y":70,"z":-309},"fortress":{"x":-328,"y":73,"z":-293},"legs":73}')), /near -328, -293/);
});
