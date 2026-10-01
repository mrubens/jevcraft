'use strict';
// Note 732: confirming and closing three items from artifacts/critic/
// critic-20260930T0733Z.md (25591 and 25589) and one from
// critic-20260930T0755Z.md (25588), each replayed from the flight records
// (scripts/trials/recent.js and .bot-state/flight/*.jsonl).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { EventEmitter } = require('node:events');
const registry = require('minecraft-data')('26.1');

// ---------------------------------------------------------------------------
// Item 2(a) — 25591 (mid-242-vd), 07:31:54Z: stand_by_spawner was offered
// ("no covered cell found near it") with no reachable cell of any kind, and
// its run tried the pathfinder's own walk there, which came back "no
// route" at once. src/empty-spawner.js now checks blaze-stand's spawnerReach
// (a plain reachability walk, dropping the covered-cell test) before
// wording the option: with neither a covered nor a plain reachable cell, it
// says so plainly (no cell of any kind found), rather than implying an open
// walk it does not know exists.
test('25591 07:31:54Z: with no cell of any kind reachable near the cage, stand_by_spawner says so plainly instead of implying an open walk', () => {
  const es = require('../src/empty-spawner');
  // Rock all round except a thin slit of open air the bot itself stands in:
  // no cell within four of the cage is standable at all (walkTo finds none).
  const cage = new Vec3(0, 80, 0), here = new Vec3(-13, 80, 0);
  const open = new Set([`${here.floored()}`]);
  const blockAt = p => { const f = p.floored(); const isOpen = open.has(`${f}`) || f.equals(cage.offset(0, 1, 0)); return { name: isOpen ? 'air' : 'nether_bricks', boundingBox: isOpen ? 'empty' : 'block', position: f, diggable: true }; };
  const bot = { registry, game: { dimension: 'the_nether' }, entity: { position: here.offset(0.5, 0, 0.5) }, entities: {}, health: 20, food: 20,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: [] }, blockAt, findBlocks: () => [] };
  const goal = { fortressSearch: { legs: 1, map: { spawners: [] } } };
  const known = { cage, off: 13, lull: null };
  const tree = es.options(bot, { check() {} }, goal, () => {}, {}, known);
  assert(tree.stand_by_spawner, 'still asked (Jev may choose it and be asked again on a real failure), not withheld');
  assert.match(tree.stand_by_spawner.description, /no covered cell found near it, and no plain one either: nothing standable was found on a walk there from here/);
  tree.stand_by_spawner.run();
  assert.equal(goal.fortressSearch.spawnerWait.cell, undefined, 'no verified cell to hand off: the wait falls back to the ordinary walk, asked again honestly if that finds no route');
});

test('25591-style: with a plain (uncovered) reachable cell but no covered one, stand_by_spawner is offered and says the walk is open, and the wait it sets carries that cell', () => {
  const es = require('../src/empty-spawner');
  const cage = new Vec3(0, 80, 0), here = new Vec3(-6, 80, 0);
  // A flat, open floor between the bot and the cage: reachable, but nothing
  // over any of the cells (no ceiling) and no rock at anyone's back either.
  const blockAt = p => {
    const f = p.floored();
    if (f.y === 79) return { name: 'nether_bricks', boundingBox: 'block', position: f, diggable: true };
    if (f.y === 80 && Math.abs(f.x) <= 6 && f.z === 0) return { name: 'air', boundingBox: 'empty', position: f, diggable: true };
    return { name: 'air', boundingBox: 'empty', position: f, diggable: true };
  };
  const bot = { registry, game: { dimension: 'the_nether' }, entity: { position: here.offset(0.5, 0, 0.5) }, entities: {}, health: 20, food: 20,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: [] }, blockAt, findBlocks: () => [] };
  const goal = { fortressSearch: { legs: 1, map: { spawners: [] } } };
  const known = { cage, off: 6, lull: null };
  const tree = es.options(bot, { check() {} }, goal, () => {}, {}, known);
  assert(tree.stand_by_spawner, 'a plain reachable cell exists, so the wait is offered');
  assert.match(tree.stand_by_spawner.description, /no covered cell found near it, but the walk there is open/);
  tree.stand_by_spawner.run();
  assert(goal.fortressSearch.spawnerWait.cell, 'the verified cell is carried into the wait, not left for the long GoalNear walk to rediscover');
});

// ---------------------------------------------------------------------------
// Item 2(b) — 25591, 07:31:57Z: after stand_by_spawner's walk found no
// route, the fallback set goal.step to find_fortress with no `found`, and
// narration read the stale, unrelated 10-minute shunned entry left from an
// actual leave 8 minutes earlier as meaning *this* leg was a leave too —
// "Leaving the fortress for now, searching on (leg 6...)" — even though
// Jev's own choice this leg (fortress_approach -> pillar_up) was to approach
// it, not leave it (note 721 rule 4: a failed walk is never a leave).
test('25591 07:31:57Z: a spawner wait ending with no route keeps the fortress found, so narration does not read it as leaving', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const { Task } = require('../src/skills');
  const cage = new Vec3(-152, 83, 168), here = new Vec3(-165, 80, 169);
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'the_nether', gameMode: 'survival' }, health: 20, food: 20, entities: {},
    entity: { position: here.offset(0.5, 0, 0.5), velocity: new Vec3(0, 0, 0) }, inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: [] },
    blockAt: p => ({ name: 'nether_bricks', boundingBox: 'block', position: p.floored() }), findBlocks: () => [], world: { raycast: () => null } });
  const goal = { fortressSearch: {
    legs: 6,
    // Already asked once for this spawner's wait (skips approachFortress,
    // the decision layer, and goes straight to the branch note 732 fixed).
    spawnerWait: { x: cage.x, y: cage.y, z: cage.z, until: Date.now() + 60000, chosen: 'empty_spawner', asked: true },
    // The fortress Jev is standing at, found on an earlier leg and never left.
    approach: { found: { x: -143, y: 69, z: 141 } },
    // A stale, unrelated leave from 8 minutes ago (still within its 10-minute
    // rest): this is what narration used to key "leaving" off, regardless of
    // this leg's own choice.
    shunned: [{ x: -70, z: -70, until: Date.now() + 480000, why: 'Jev chose to leave it and search on' }],
  } };
  const actions = { navigate: async () => { throw new Error('No path to the goal!'); } };
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, actions);
  assert.equal(goal.step.action, 'find_fortress');
  assert.deepEqual(goal.step.found, { x: -143, y: 69, z: 141 }, 'the fortress already found stays found: the walk that failed was to the spawner, not a leave');
  const narration = require('../src/narration');
  const text = narration.stepLine(goal, goal.step, null, null, bot);
  assert.match(text, /^A fortress! I'm heading for it\.$/, `should not read as leaving: ${text}`);
});

// ---------------------------------------------------------------------------
// Item 2(c) — leave_and_heal was chosen twice with no route to the same
// unreachable cell. healSite now excludes a cell noted failed
// (blaze-stand's siteFailedNear/noteSiteFailed, the same rule spawnerSite,
// wallSite and holeSite already keep to), and leaveAndHeal now records the
// failure before throwing, instead of letting the next asking pick the
// identical cell again.
test('leave_and_heal: a cell whose walk just failed is not offered again, and healSite finds another or none (note 732)', () => {
  const T = require('../src/blaze-tactics');
  const stand = require('../src/blaze-stand');
  const blaze = { id: 1, name: 'blaze', position: new Vec3(8, 64, 0.5), isValid: true };
  // A flat floor, and a wall at x=2 the whole width of z: everything on the
  // bot's side of it (x <= 1) is out of the blaze's line; the blaze's own
  // side (x >= 3) is not.
  const blockAt = p => { const f = p.floored();
    if (f.y === 63) return { name: 'netherrack', boundingBox: 'block', position: f };
    if (f.x === 2 && (f.y === 64 || f.y === 65)) return { name: 'netherrack', boundingBox: 'block', position: f };
    return { name: 'air', boundingBox: 'empty', position: f };
  };
  const bot = { registry, entity: { position: new Vec3(0.5, 64, 0.5) }, blockAt, world: { raycast: () => null }, inventory: { items: () => [] } };
  const first = T.healSite(bot, [blaze]);
  assert(first, 'a heal site is found');
  stand.noteSiteFailed(bot, first.cell, 'did not get there');
  const second = T.healSite(bot, [blaze]);
  assert(!second || `${second.cell}` !== `${first.cell}`, 'the same cell that just failed is not offered again');
});

test('leave_and_heal: a walk that does not arrive notes the cell failed (blaze-stand.siteFailedNear), matching spawnerSite/wallSite/holeSite', async () => {
  const T = require('../src/blaze-tactics');
  const stand = require('../src/blaze-stand');
  const cell = new Vec3(5, 64, 0);
  const bot = Object.assign(new EventEmitter(), { entity: { position: new Vec3(0.5, 64, 0.5) }, health: 20, food: 20, entities: {}, registry,
    blockAt: () => ({ name: 'air', boundingBox: 'empty' }), inventory: { items: () => [], slots: [] } });
  const site = { cell, build: [] };
  const navigate = async () => { /* never arrives */ };
  await assert.rejects(T.leaveAndHeal(bot, { check() {} }, {}, () => {}, site, { navigate, seconds: 1 }), err => err.name === 'StanceFailed');
  assert.equal(stand.siteFailedNear(bot, cell), true, 'the cell is remembered as failed, so healSite will not offer it again at once');
});

// ---------------------------------------------------------------------------
// Item 3(a) — 25589 (mid-242-va), 07:33:54Z: encounter_stance said "2 wither
// skeletons have no way to the bot" the same second the bot was "Preempted
// by reach: a wither_skeleton came within its reach". walk-reach.js now
// never calls a walker "no way" when it is already at its reach now
// (danger.js atItsReach, the same test the preemption answers on),
// whatever the cell search under it found or missed.
test('25589 07:33:54Z: a wither skeleton already at its reach is never "no way to the bot" (note 732)', () => {
  const { walkersApart } = require('../src/walk-reach');
  const skeleton = { id: 9, name: 'wither_skeleton', position: new Vec3(1.5, 64, 0.5), height: 2.4, width: 0.7, isValid: true };
  // The ground under the skeleton's own cell is magma (bunker.standable
  // explicitly refuses it): the cell search below would never call that
  // cell standable, and so would never find a way to it from the bot's
  // side either — the exact shape of the bug this closes.
  const blockAt = p => { const f = p.floored(); const under = f.offset(0, -1, 0);
    if (under.x === 1 && under.z === 0 && under.y === 63) return { name: 'magma_block', boundingBox: 'block', position: under };
    return { name: f.y < 64 ? 'stone' : 'air', boundingBox: f.y < 64 ? 'block' : 'empty', position: f };
  };
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, blockAt };
  const t = { entity: skeleton, distance: skeleton.position.distanceTo(bot.entity.position), visible: true };
  const apart = walkersApart(bot, [t]);
  assert.equal(apart.ids.size, 0, 'already at reach: never "no way to the bot"');
  // Without the fix, the magma-floored cell is never found "standable", so
  // the plain search below (no reach shortcut) does call it apart: proof
  // the shortcut, not a lucky cell search, is what clears it above.
  const { WALKERS } = require('../src/walk-reach');
  assert(WALKERS.has('wither_skeleton'), 'a wither skeleton is judged by this search at all');
});

// ---------------------------------------------------------------------------
// Item 3(b) — 25589, 07:33:something: pocket_next's tunnel_out estimated a
// 7-block (14-cell) passage at "about 18 seconds" (the pickaxe figure, 1.25
// s a block) with no pickaxe carried; digging netherrack or stone by hand
// takes several times longer (hand-dig.js). survival.js's outCells now
// sums the game's real hand-dig time over the actual cells when no pickaxe
// is carried.
test('tunnel_out: with no pickaxe carried, the passage\'s seconds are the hand-dig figure, not the pickaxe\'s 1.25 s a block', async () => {
  const { Survival } = require('../src/survival');
  const { Task } = require('../src/skills');
  const origin = new Vec3(0, 30, 0);
  const creeper = { id: 7, name: 'creeper', type: 'hostile', position: new Vec3(5.5, 30, 0.5), height: 1.7, width: 0.6, isValid: true };
  const open = new Set([`${origin}`, `${origin.offset(0, 1, 0)}`]);
  const bot = Object.assign(new EventEmitter(), { game: { dimension: 'overworld', gameMode: 'survival', difficulty: 'normal' }, entities: { 7: creeper }, health: 20, food: 20, registry,
    time: { timeOfDay: 6000 }, entity: { position: origin.offset(0.5, 0, 0.5), onGround: true, velocity: new Vec3(0, 0, 0) }, oxygenLevel: 20,
    // No pickaxe carried, unlike note 390's fixture: only the cobblestone.
    inventory: { items: () => [{ name: 'cobblestone', count: 32 }], emptySlotCount: () => 10, slots: [] },
    blockAt: p => ({ name: open.has(`${p}`) ? 'air' : 'stone', boundingBox: open.has(`${p}`) ? 'empty' : 'block', diggable: true, position: p }),
    world: { raycast: from => ({ intersect: from.offset(0.6, 0, 0) }) } });
  const refuge = { origin: { ...origin }, dimension: 'overworld' };
  const survival = new Survival(bot, { dig: async () => {}, navigate: async () => {} }, { state: { shelters: [refuge] }, client: { systemOne: async () => ({}) } });
  let tree;
  survival.decide = async (task, goal, save, { id, tree: t }) => { if (id === 'pocket_next') tree = t; return { path: ['stay'], stale: false }; };
  survival.wait = async () => {};
  await survival.step(new Task('day'), { kind: 'win' }, () => {});
  assert(tree?.tunnel_out, 'tunnel_out is offered');
  // 5 cells, one wide and two high: 10 blocks of stone, 7.5 s each by hand
  // (hardness 1.5 x 100 ticks, hand-dig.js), 75 seconds, not the pickaxe's 13.
  assert.match(tree.tunnel_out.description, /one wide and two high, 5 blocks, about 75 seconds by hand \(no pickaxe carried\)/, tree.tunnel_out.description);
});

// ---------------------------------------------------------------------------
// Item 3(c) — the fight option should state the leave's own damage estimate
// against the fight's, so the two are read against each other rather than
// the fight's number standing alone (25589's fight took it from 20 to 0 in
// three seconds while leave_and_heal's own estimate was never said beside
// it).
test('a blaze fight option states leave_and_heal\'s own damage estimate against its own (note 732)', () => {
  const { blazeStands } = require('../src/blaze-stand');
  const blaze = { id: 3, name: 'blaze', position: new Vec3(8, 64, 0.5), isValid: true };
  // Same shadow-wall shape as the healSite test above: a cell for
  // leave_and_heal to find out of the blaze's line.
  const blockAt = p => { const f = p.floored();
    if (f.y === 63) return { name: 'netherrack', boundingBox: 'block', position: f, diggable: true };
    // (Note 774: a wall the walk can go round, so the fight is reachable by
    // the one reachability every attack reads; a wall across the whole
    // floor left the blaze reachable only by the old greedy walk's one step.)
    if (f.x === 2 && (f.y === 64 || f.y === 65) && Math.abs(f.z) <= 3) return { name: 'netherrack', boundingBox: 'block', position: f, diggable: true };
    return { name: 'air', boundingBox: 'empty', position: f, diggable: true };
  };
  const bot = { registry, entity: { position: new Vec3(0.5, 64, 0.5) }, entities: {}, health: 12, food: 12, blockAt,
    inventory: { items: () => [{ name: 'iron_sword', count: 1 }], slots: {} }, world: { raycast: () => null }, findBlocks: () => [] };
  const danger = [{ entity: blaze, distance: blaze.position.distanceTo(bot.entity.position), visible: true }];
  const options = blazeStands(bot, danger, { need: 1, of: '1 wanted' });
  assert(options.leave_and_heal, 'leave_and_heal is offered (health under 20, a blaze about)');
  const fightKeys = Object.keys(options).filter(k => k !== 'leave_and_heal' && options[k].expects && ['spawner', 'wall', 'close', 'charge', 'break', 'hole', 'window'].includes(options[k].kind));
  assert(fightKeys.length, `at least one fight option (${Object.keys(options).join(', ')})`);
  for (const k of fightKeys) assert.match(options[k].description, /Going away to heal instead is estimated at about [\d.]+ damage.* against this fight's [\d.]+\./, `${k}: ${options[k].description}`);
});

// ---------------------------------------------------------------------------
// Coordinator addition — 25588 (rb-fortress-3), critic-20260930T0755Z item 2:
// 07:49:33Z chose fortress_approach -> keep_searching, "Leaving the fortress
// at (-70,53,140) for now, 24 blocks off", with nothing said of the rods
// still owed; then repeated "No measurable progress on find_fortress" with
// the fortress 1 block away. fortress-hold.reachSays now says rods owed
// with the distance, and stillness.stepWait now holds the generic stall
// watchdog off while the bot is standing at a fortress it already knows.
test('25588 07:49:33Z: leaving a known fortress says the rods still owed', () => {
  const hold = require('../src/fortress-hold');
  const bot = { registry, entity: { position: new Vec3(-46, 53, 140) }, inventory: { items: () => [] } };
  const goal = { fortressSearch: {}, mobHunt: { entity: 'blaze', targetCount: 4, item: 'blaze_rod' } };
  const says = hold.reachSays(bot, goal, { target: { x: -70, y: 53, z: 140 }, anchor: { x: -70, y: 53, z: 140 } });
  assert.match(says, /rod.* still needed; this fortress is what is known of where to find them\./i, says);
});

test('25588 07:49:something: find_fortress\'s stall does not fire while standing at a known fortress (note 732)', () => {
  const { stepWait } = require('../src/stillness');
  const bot = { entity: { position: new Vec3(-70.4, 53, 140.2) } };
  const goal = { step: { action: 'find_fortress', found: { x: -70, y: 53, z: 140 } } };
  assert.equal(stepWait(bot, goal), 'at a known fortress');
  // Far from any found fortress, the exemption does not apply: the ordinary
  // watchdog still catches a genuine stall.
  const far = { entity: { position: new Vec3(0, 53, 0) } };
  assert.equal(stepWait(far, goal), null);
});

// ---------------------------------------------------------------------------
// Coordinator addition — 25592 (mid-242-...), critic item 2, 08:11:00Z:
// "Leaving the fortress at (-175, 69, 45) for now, 6 blocks off. Searching
// on for another." said nothing of the 7 rods still needed, only the
// distance. fortress-hold.leave now says the rods owed in that same chat
// line, matching reachSays' facts for the question that offered it.
test('25592 08:11:00Z: the leave chat itself says the rods still owed, not only the distance', () => {
  const hold = require('../src/fortress-hold');
  const said = [];
  const bot = { entity: { position: new Vec3(-177, 69, 45) }, chat: m => said.push(m), inventory: { items: () => [] } };
  const goal = { mobHunt: { entity: 'blaze', targetCount: 7, item: 'blaze_rod' } };
  const state = {};
  hold.leave(bot, state, { anchor: { x: -175, y: 69, z: 45 }, left: ['pillar up'], save: () => {}, goal });
  assert.match(said.at(-1), /^Leaving the fortress at \(-175, 69, 45\) for now, \d+ blocks off\. Searching on for another\. 7 blaze rods still needed\.$/);
});
