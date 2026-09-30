'use strict';
// Trial note 745 (critic-20260930T0945Z items 1 and 2; critic-20260930T1008Z
// item 3, below).
//
// 3. 25581 (mid-243-ig), 10:00-10:09Z: at 10:00:05 it chose fortress_approach's
//    pillar_up (172 blocks carried, no pickaxe); pillaring up 25 blocks
//    succeeded, but the short span onto the deck then failed twice with "no
//    route". At 10:00:35 it said "Walked what I can reach of this fortress"
//    having walked none of it, then in the same second answered
//    keep_searching (a leave), back_to_fortress and leg_east: three flips,
//    nothing carried out. Root cause: onFortressFloor's proximity test (six
//    blocks across, 1.5 up) does not distinguish the fortress's own floor
//    from the top of the bot's own pillar, which sat within that same
//    slack once the climb (but not the span) succeeded. It also asked
//    walk_route and return_for_blocks ahead of the two ways already fully
//    paid for by the 172 blocks carried (cross_level, pillar_up).
//
// 1. 25593 (mid-242-xd), 09:37-09:46Z: no pickaxe, 0 blocks, 7 rods owed, a
//    known fortress about 104 blocks off. fortress_leg's return_for_blocks
//    was chosen 7 times, and each time fortress_leg was asked again (its
//    own question) it was handed the whole leg menu with nothing held,
//    because intention.js's gate() let a question straight through
//    unfiltered whenever it was the intention's own question (`q === i.q`),
//    with no exception for an errand. 09:44:22 return_for_blocks ->
//    09:44:31 fortress_leg back_to_fortress undid it, then fortress_visit
//    go_in, fortress_approach's own return_for_blocks, walk_route, and
//    fortress_leg leg_south with "Leaving the fortress..." in 4 seconds:
//    in, then out.
//
// 2. 25590 (mid-242-yc), 09:39:33-09:43:10Z at (-23, 32, 44), holding a
//    pickaxe, in netherrack: blocks_then_cross chosen 4x, 0 blocks gained
//    each time, "no route" each time to a target a few blocks off.
//    blocks_then_cross was not held as an errand either (the same gap as
//    item 1), and the chat that followed a return_for_blocks right after
//    ("Going back through the portal for stone... a pickaxe, 0 blocks
//    carried") named the wrong material: kitLacks (block-stock.js) said
//    "stone" in the Nether whatever was carried, though note 729 had
//    already fixed the option's own words (returnForKitSays) to say
//    "netherrack" there. Separately, gatherSpanBlocks (bridging.js) always
//    walked to the source's own walk-cell before digging, even where the
//    block was already in reach without moving at all; near lava that walk
//    can find no route the BFS survey did not itself refuse.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const intention = require('../src/intention');

const opt = (d, target) => ({ description: d, ...(target ? { target } : {}) });
const portal = { x: 5, y: 50, z: 13 };
const fortress = { x: -136, y: 69, z: 157 };
const netherBot = (at) => ({ game: { dimension: 'the_nether' }, entity: { position: at }, health: 20, food: 19 });

test('blocks_then_cross joins the held errands, the existing ones stay (note 745)', () => {
  assert(intention.ERRANDS.test('blocks_then_cross'));
  for (const k of ['fetch_stems', 'return_for_blocks', 'return_for_food', 'restock_food', 'restock_blocks', 'go_back']) {
    assert(intention.ERRANDS.test(k), `${k} should still be an errand`);
  }
});

// The exact shape of the bug: fortress_leg's own question, asked again
// while its return_for_blocks holds, used to be handed the full menu
// (gate()'s `q === i.q` bypass had no exception for an errand) and
// back_to_fortress (or leg_south, or anything else on offer) tore the
// errand down within seconds of it starting.
test('fortress_leg re-asked while its own return_for_blocks holds keeps only the errand (note 745)', () => {
  const bot = netherBot(new Vec3(17, 57, 96));
  const goal = {};
  intention.after(bot, goal, 'fortress_leg', ['return_for_blocks'], { target: portal });
  assert.equal(goal.intention.choice, 'return_for_blocks');
  assert.equal(goal.intention.q, 'fortress_leg');
  const tree = { leg_south: opt('Go south.'), back_to_fortress: opt('Back to the fortress.', fortress), return_for_blocks: opt('Back through the portal.', portal), none_good: opt('None good.') };
  const g = intention.gate(bot, goal, 'fortress_leg', tree);
  assert.deepEqual(Object.keys(g.tree).sort(), ['none_good', 'return_for_blocks']);
  assert.deepEqual(g.withheld.sort(), ['back_to_fortress', 'leg_south']);
  // Offered only the errand, taking it again does not tear anything down.
  intention.after(bot, goal, 'fortress_leg', ['return_for_blocks'], { target: portal, chosen: false });
  assert.equal(goal.intention.choice, 'return_for_blocks');
});

test('fortress_approach re-asked while blocks_then_cross holds keeps only the errand (note 745)', () => {
  const bot = netherBot(new Vec3(0, 60, 0));
  const goal = {};
  intention.after(bot, goal, 'fortress_approach', ['blocks_then_cross'], { target: fortress });
  assert.equal(goal.intention.choice, 'blocks_then_cross');
  assert.equal(goal.intention.q, 'fortress_approach');
  const tree = { cross_level: opt('Go straight at it.', fortress), tunnel: opt('Dig a staircase.', fortress), blocks_then_cross: opt('Mine netherrack for blocks here first.', fortress), none_good: opt('None good.') };
  const g = intention.gate(bot, goal, 'fortress_approach', tree);
  assert.deepEqual(Object.keys(g.tree).sort(), ['blocks_then_cross', 'none_good']);
  assert.deepEqual(g.withheld.sort(), ['cross_level', 'tunnel']);
});

test('a non-errand intention at its own question still goes unfiltered (no regression, note 745)', () => {
  const bot = netherBot(new Vec3(17, 57, 96));
  const goal = {};
  intention.after(bot, goal, 'fortress_leg', ['leg_east'], { target: { x: 200, y: 57, z: 96 } });
  assert.equal(goal.intention.choice, 'leg_east');
  const tree = { leg_east: opt('Go east.'), leg_west: opt('Go west.'), none_good: opt('None good.') };
  const g = intention.gate(bot, goal, 'fortress_leg', tree);
  // leg_east is a walk, not an errand: the whole menu still goes to Jev.
  assert.deepEqual(Object.keys(g.tree).sort(), ['leg_east', 'leg_west', 'none_good']);
  assert.equal(g.withheld.length, 0);
});

// Item 3's own-second flip: keep_searching (a leave, correctly not held),
// then back_to_fortress, then leg_east, all inside one second with nothing
// carried out. back_to_fortress now holds against fortress_leg's own
// unfiltered re-ask the same way return_for_blocks does.
test('back_to_fortress re-asked at its own question keeps only itself (note 745 item 3)', () => {
  assert(intention.ERRANDS.test('back_to_fortress'));
  const bot = netherBot(new Vec3(343, 66, -254));
  const goal = {};
  intention.after(bot, goal, 'fortress_leg', ['back_to_fortress'], { target: fortress });
  assert.equal(goal.intention.choice, 'back_to_fortress');
  const tree = { leg_east: opt('Go east.'), leg_north: opt('Go north.'), back_to_fortress: opt('Go back into the fortress in view.', fortress), none_good: opt('None good.') };
  const g = intention.gate(bot, goal, 'fortress_leg', tree);
  assert.deepEqual(Object.keys(g.tree).sort(), ['back_to_fortress', 'none_good']);
});

// Item 2's text half: the chat that starts return_for_blocks named the
// wrong material in the Nether with a pickaxe carried (note 729 fixed only
// the option's own words, returnForKitSays).
test('kitLacks names netherrack, not stone, in the Nether with a pickaxe carried (note 745)', () => {
  const { kitLacks, listSays } = require('../src/block-stock');
  const netherBotWithPick = { game: { dimension: 'the_nether' }, inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }] } };
  assert.deepEqual(kitLacks(netherBotWithPick), ['netherrack to lay spans with']);
  const overworldBotWithPick = { game: { dimension: 'overworld' }, inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }] } };
  assert.deepEqual(kitLacks(overworldBotWithPick), ['stone to lay spans with']);
  assert.equal(listSays(kitLacks(netherBotWithPick)), 'netherrack to lay spans with');
});

// Item 2's gather half: blocks_then_cross (mineThenCross -> restockStep ->
// gatherSpanBlocks) gained nothing 4 times running at (-23, 32, 44), "no
// route" each time to a target a few blocks off. gatherSpanBlocks now digs
// a block already in mining reach in place, without first walking to the
// source's own walk-cell.
test('gatherSpanBlocks mines a block already in reach without navigating to its walk-cell first (note 745)', async () => {
  const { gatherSpanBlocks } = require('../src/bridging');
  const here = new Vec3(0.5, 65, 0.5);
  const netherrackAt = new Vec3(1, 65, 0);
  let carried = 0;
  const bot = {
    registry, game: { dimension: 'the_nether' }, entity: { position: here },
    inventory: { items: () => (carried ? [{ name: 'netherrack', count: carried }] : []) },
    findBlocks: ({ matching }) => [].concat(matching).includes(registry.blocksByName.netherrack.id) ? [netherrackAt] : [],
    blockAt: p => {
      if (p.equals(netherrackAt)) return { name: 'netherrack', position: p, boundingBox: 'block' };
      if (p.y === 64) return { name: 'netherrack', position: p, boundingBox: 'block' };
      return { name: 'air', position: p, boundingBox: 'empty' };
    },
    world: { raycast: () => null },
  };
  let navigated = false;
  const navigate = async () => { navigated = true; throw new Error('No route from here (noPath)'); };
  const mineAt = async () => { carried += 1; };
  const result = await gatherSpanBlocks(bot, { check() {} }, 1, { navigate, mineAt });
  assert.equal(result.gained, 1, `should have mined the block already in reach: ${JSON.stringify(result)}`);
  assert.equal(navigated, false, 'no walk is needed for a block already in mining reach');
});

// Item 3, root cause: onFortressFloor's proximity slack (six blocks across,
// 1.5 up) does not tell the fortress's own floor from the bot's own pillar
// standing within that same slack.
test('onFortressFloor is false atop the bot\'s own placed block, even within the usual proximity (note 745)', () => {
  const { onFortressFloor } = require('../src/mob-hunt');
  const { keyOf } = require('../src/own-blocks');
  const floors = [{ x: 342, y: 65, z: -256 }];
  const here = new Vec3(343.5, 66, -254.5);
  const foot = here.floored().offset(0, -1, 0);
  // Without a bot (or one with nothing recorded as its own), the plain
  // proximity test still runs exactly as before.
  assert.equal(onFortressFloor(here, floors), true, 'proximity alone: within six blocks across and 1.5 up');
  const laidBot = { blockAt: p => (`${p}` === `${foot}` ? { name: 'white_wool' } : { name: 'air' }), _laid: new Map([[keyOf(foot), { name: 'white_wool', at: Date.now() }]]) };
  assert.equal(onFortressFloor(here, floors, laidBot, null), false, 'stuck on the pillar\'s own top is not on the fortress\'s floor');
  // A real floor block under the feet (not the bot's own) still counts.
  const realFloorBot = { blockAt: () => ({ name: 'nether_bricks' }), _laid: new Map() };
  assert.equal(onFortressFloor(here, floors, realFloorBot, null), true, 'a real floor block underfoot still counts');
});

// Item 3, the ordering half: with 172 blocks carried and no pickaxe,
// cross_level and pillar_up (both already fully paid for) were offered
// behind walk_route and return_for_blocks. bridgeFirstOrder is the small,
// pure piece of fortressApproaches that decides the order; tested on its
// own rather than through the whole survey (real terrain, pathfinder
// geometry) that decides whether cross_level and pillar_up are offered at
// all, which is exercised elsewhere.
test('bridgeFirstOrder names a fully-carried bridge or pillar first, ahead of walk_route and return_for_blocks (note 745)', () => {
  const { bridgeFirstOrder } = require('../src/mob-hunt');
  const options = { walk_route: 'walk', cross_level: 'cross', pillar_up: 'pillar', return_for_blocks: 'home', keep_searching: 'leave' };
  // pillar_up is only ever offered already fully paid for (climbWays offers
  // blocks_then_pillar instead otherwise): named first regardless of
  // bridgeReady.
  assert.deepEqual(Object.keys(bridgeFirstOrder(options, { bridgeReady: false })), ['pillar_up', 'walk_route', 'cross_level', 'return_for_blocks', 'keep_searching']);
  // cross_level is offered whether or not the carried stock covers it in
  // full: named first only when bridgeReady says it does.
  assert.deepEqual(Object.keys(bridgeFirstOrder(options, { bridgeReady: true })), ['cross_level', 'pillar_up', 'walk_route', 'return_for_blocks', 'keep_searching']);
  assert.deepEqual(Object.keys(bridgeFirstOrder({ walk_route: 'walk', cross_level: 'cross' }, { bridgeReady: false })), ['walk_route', 'cross_level'], 'not ready: order unchanged');
  assert.deepEqual(Object.keys(bridgeFirstOrder({ walk_route: 'walk' }, { bridgeReady: true })), ['walk_route'], 'neither offered: order unchanged');
});
