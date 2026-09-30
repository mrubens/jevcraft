'use strict';
// Trial note 750: the time from a fortress first known to the first blaze
// fight, lost to approach thrash (scripts/fortress-arrival.js; the live
// critic's artifacts/critic/critic-20260930T1114Z.md item 2 and
// critic-20260930T1136Z.md items 2 and 5).
//
// 25590 (mid-242-yc), 11:12-11:15Z on 2026-09-30, 7 blocks from the floor of
// a fortress it had known for 54 minutes, no pickaxe, 16 health, a sword,
// 3 rods owed: fortress_approach went pillar_up, return_for_blocks,
// walk_route, cross_level, tunnel, fetch_stems in 90 seconds with no_route
// between; "A fortress! I'm heading for it." at 11:13:42 level with its
// floor; return_for_blocks said "every way on here needs one of them"
// beside a pillar offered with 121 blocks carried; fetch_stems took it for
// stems 173 blocks off; hunt_target was asked with no fight on offer and
// answered defer.
//
// Over every trial from 2026-09-29 23Z to 09-30 11:30Z the approach's own
// "came nearer" (1.5 blocks) read 94 of 96 staircase passes that moved the
// bot a block toward the bricks as "tunnel: came no nearer": the staircase
// digs one step a pass.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { groundBot, registry } = require('./fixtures/saved-ground');

// The ground under 25585's fortress (note 692's fixture): a floor 26 up.
const GROUND = require('./fixtures/fortress-under-25585.json');
const FOOD = [['cooked_mutton', 7], ['mutton', 7], ['beef', 2], ['porkchop', 4]];
const PORTALS = [{ x: -9, y: 72, z: 41, dimension: 'overworld' }, { x: 4, y: 50, z: 13, dimension: 'nether' }];
const FLOOR = new Vec3(944, 66, 74);
function underBot({ at = new Vec3(943.5, 41, 73.5), items = FOOD } = {}) {
  const bot = groundBot(GROUND, { at, items: items.map(i => [...i]), dimension: 'the_nether', indexed: true });
  bot.entities = {}; bot.players = {};
  return bot;
}
function jevStub(picks) {
  const asked = [];
  return { asked, systemOne: async ({ kind, state, questions }) => {
    const criteria = questions.branch_0.criteria;
    asked.push({ kind, state, options: criteria });
    const pick = picks.find(p => criteria[p]) || Object.keys(criteria).find(k => k !== 'none_good');
    return { answers: { branch_0: { choice: pick, confidence: 0.9 } } };
  } };
}
const noIntention = t => { process.env.JEV_INTENTION = '0'; t.after(() => { delete process.env.JEV_INTENTION; }); };
const noPath = async () => { throw new Error('No path to the goal!'); };
const approachGoal = () => ({ kind: 'win', portals: PORTALS, fortressSearch: { legs: 42, since: Date.now() - 60 * 60000 } });

test('a staircase step that gains a block toward the floor is the way under way, not a failure: held, nothing recorded failed (note 750)', async t => {
  noIntention(t);
  const { approachFortress } = require('../src/mob-hunt');
  const bot = underBot({ items: [...FOOD, ['stone_pickaxe', 1]] });
  const goal = approachGoal(), client = jevStub(['tunnel']);
  let steps = 0;
  // One step of the stair a pass, as tunneling.js tunnelStep digs it: up one.
  const tunnel = async () => { steps++; const p = bot.entity.position; bot.entity.position = new Vec3(p.x, p.y + 1, p.z); };
  const actions = { client, navigate: noPath, tunnel, dig: async () => {}, mineAt: async () => {}, acquireStep: async () => false, returnOverworld: async () => {} };
  await approachFortress(bot, new Task('hunt'), goal, () => {}, actions, goal.fortressSearch, FLOOR, []);
  const approach = goal.fortressSearch.approach;
  assert.equal(steps, 1);
  assert.deepEqual(approach.failed, [], 'a block gained is not "came no nearer"');
  assert.equal(approach.choice, 'tunnel', 'the staircase holds');
  assert(approach.until > Date.now(), 'held for the approach\'s hold');
});

test('a way that ended no nearer from where the bot still stands, with the same pockets, is said as tried and not offered again; from elsewhere, or with other pockets, it is (note 750)', async t => {
  noIntention(t);
  const { approachFortress } = require('../src/mob-hunt');
  const bot = underBot({ items: [...FOOD, ['stone_pickaxe', 1]] });
  const goal = approachGoal(), client = jevStub(['tunnel']);
  const actions = { client, navigate: noPath, tunnel: async () => { throw new Error('No route from here to (943, 42, 73) (noPath)'); }, dig: async () => {}, mineAt: async () => {}, acquireStep: async () => false, returnOverworld: async () => {} };
  await approachFortress(bot, new Task('hunt'), goal, () => {}, actions, goal.fortressSearch, FLOOR, []);
  const failed = goal.fortressSearch.approach.failed;
  assert.equal(failed.length, 1);
  assert.equal(failed[0].choice, 'tunnel');
  assert.deepEqual(failed[0].from, { x: 943.5, y: 41, z: 73.5 }, 'kept with where it was tried from');
  assert.deepEqual(failed[0].kit, { carried: 0, tier: 2 });
  // Asked again from the same spot.
  const again = jevStub(['keep_searching']);
  await approachFortress(bot, new Task('hunt'), goal, () => {}, { ...actions, client: again }, goal.fortressSearch, FLOOR, []);
  const asked = again.asked.at(-1);
  assert.equal(asked.options.tunnel, undefined, 'not offered as if it would work');
  assert.deepEqual(asked.state.triedFromHere, ['tunnel: tried from where the bot stands, with the same blocks and pickaxe, and ended no nearer (No route from here to (943, 42, 73) (noPath)); not offered again from here']);
  assert.match(asked.state.failed.join(' '), /^tunnel: No route/);
  // With a block more carried, the same spot is not the same attempt.
  const f = goal.fortressSearch.approach.failed;
  goal.fortressSearch.approach.failed = f.map(x => ({ ...x, kit: { ...x.kit, carried: 5 } }));
  const other = jevStub(['keep_searching']);
  await approachFortress(bot, new Task('hunt'), goal, () => {}, { ...actions, client: other }, goal.fortressSearch, FLOOR, []);
  assert(other.asked.at(-1).options.tunnel, 'offered again with other pockets');
});

test('a route the pathfinder surveys to no nearer is no way in: said, not offered (note 750)', async t => {
  noIntention(t);
  const { fortressApproaches } = require('../src/mob-hunt');
  const bot = underBot();
  // The survey's route: four cells that end where the bot already is.
  const here = bot.entity.position.floored();
  bot.pathfinder = { movements: {}, getPathFromTo: function* () { yield { result: { status: 'success', path: [0, 1, 0, -1].map(dx => ({ x: here.x + dx, y: here.y, z: here.z, toBreak: [], toPlace: [] })) } }; } };
  const goal = approachGoal();
  const { options, facts } = await fortressApproaches(bot, new Task('hunt'), goal, () => {}, { navigate: noPath }, goal.fortressSearch, FLOOR, [], { failed: [] });
  assert.equal(options.walk_route, undefined);
  assert.equal(facts.walkRoute, 'the pathfinder\'s route toward it from here (4 cells) ends no nearer to it');
});

test('the trip home for the kit says the ways offered beside it go with what is carried, not that every way needs the kit (25590 at 11:12:46Z, note 750)', async t => {
  noIntention(t);
  const { approachFortress } = require('../src/mob-hunt');
  // No pickaxe, blocks enough to pillar the 26 up: pillar_up is offered.
  const bot = underBot({ items: [...FOOD, ['netherrack', 40]] });
  const goal = approachGoal(), client = jevStub(['keep_searching']);
  await approachFortress(bot, new Task('hunt'), goal, () => {}, { client, navigate: noPath, tunnel: async () => {}, dig: async () => {}, mineAt: async () => {}, acquireStep: async () => false, returnOverworld: async () => {} }, goal.fortressSearch, FLOOR, []);
  const { options } = client.asked.at(-1);
  assert(options.pillar_up, Object.keys(options).join(', '));
  assert(options.return_for_blocks, Object.keys(options).join(', '));
  assert.doesNotMatch(options.return_for_blocks, /every way on here needs one of them/);
  assert.match(options.return_for_blocks, /: the [a-z ,]*pillar up[a-z ,]* offered beside it go(es)? with what is carried; the other ways on need one of them\./);
});

test('an errand from a known fortress says how far from it it goes, the rods owed and that the fortress is where they are (fortress-away.js, note 750)', () => {
  const fa = require('../src/fortress-away');
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(155.5, 60, 267.5) }, health: 15.6, food: 15, inventory: { items: () => [{ name: 'blaze_rod', count: 4 }] } };
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 7 }, fortressSearch: { found: { x: 157, y: 60, z: 267 } } };
  const says = fa.awaySays(bot, goal, new Vec3(113, 45, 99), { owed: true });
  assert.match(says, /^It takes the bot from the fortress 2 blocks off now to 174 blocks from it, and the way back after is as far\. 3 blaze rods still needed, and the fortress is where they are known to be\. It walks with 15\.6 health and hunger 15; /);
  // Without owed, as upkeep's fetch has said it (note 702), unchanged.
  assert.doesNotMatch(fa.awaySays(bot, goal, new Vec3(113, 45, 99)), /still needed/);
  // Measured from a point the caller names (the approach's own brick).
  assert.match(fa.awaySays(bot, goal, new Vec3(113, 45, 99), { from: new Vec3(160, 60, 260) }), /^It takes the bot from the fortress 9 blocks off now to 168 blocks from it/);
});

test('the Nether gathering\'s ways that take the bot farther from a known fortress say so on themselves (25590 at 11:14:36Z, note 750)', async () => {
  const { netherGather } = require('../src/nether-gather');
  const SPAN = require('./fixtures/nether-span-mid-242-af.json');
  const CARRIED = [['stone_sword', 1], ['coal', 17], ['stick', 1], ['crafting_table', 1], ['cobblestone', 64]];
  const bot = groundBot(SPAN, { at: new Vec3(-29.5, 72, 48.5), items: CARRIED, health: 15, food: 15, dimension: 'the_nether', indexed: true });
  const now = Date.now();
  const STEMS = [[26, 65, 26], [26, 59, 26], [25, 70, 12]];
  const goal = { kind: 'win', request: 'beat the game', gameProgress: { phase: 'obtain_blaze_rods' }, mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 7 },
    fortressSearch: { found: { x: -31, y: 72, z: 58 } },
    resourceMemory: Object.fromEntries(STEMS.map(([x, y, z]) => [`the_nether:${x},${y},${z}`, { name: 'crimson_stem', position: { x, y, z }, dimension: 'the_nether', seenAt: now - 60000 }])),
    portals: [{ x: 29, y: 71, z: 31, dimension: 'overworld' }, { x: 17, y: 58, z: 1, dimension: 'nether' }] };
  const asked = [];
  const client = { systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: 'none_good', confidence: 0.9 } } }; } };
  await netherGather(bot, new Task('work'), goal, () => {}, 'crimson_stem', { navigate: async () => { throw new Error('No path to the goal!'); }, client }).catch(() => {});
  const { options } = asked[0];
  const away = Object.entries(options).filter(([k, d]) => k !== 'none_good' && /It takes the bot from the fortress \d+ blocks off now to \d+ blocks from it/.test(d));
  assert(away.length, Object.keys(options).join(', '));
  for (const [, d] of away) assert.match(d, /7 blaze rods still needed, and the fortress is where they are known to be\./);
  // A leg toward the fortress (south, from z 48 to it at z 58 and past) says nothing of leaving it... unless its end is farther.
  if (options.leg_north) assert.match(options.leg_north, /It takes the bot from the fortress 10 blocks off now to 74 blocks from it/);
});

test('"A fortress! I\'m heading for it." is not said again of a fortress announced, when its anchor was re-made or the step names only a brick of it (25590 at 11:13:42Z, note 750)', () => {
  const narration = require('../src/narration');
  const said = [];
  const bot = { chat: m => said.push(m) };
  const goal = {};
  goal.step = { action: 'find_fortress', found: { x: 157, y: 60, z: 267 }, fortress: { x: 160, y: 60, z: 260, firstAt: 1790762368572 }, legs: 30 };
  narration.narrate(bot, goal, { now: 1 });
  assert.deepEqual(said, ["A fortress! I'm heading for it."]);
  // Something else in between.
  goal.step = { action: 'mine', block: 'crimson_stem', count: 2, drops: 'crimson_stem' };
  narration.narrate(bot, goal, { now: 20000 });
  // The same fortress re-anchored: a new firstAt, the same place.
  goal.step = { action: 'find_fortress', found: { x: 155, y: 60, z: 266 }, fortress: { x: 160, y: 60, z: 260, firstAt: 1790762380826 }, legs: 30 };
  narration.narrate(bot, goal, { now: 40000 });
  // A step naming only a brick of it (the spawner wait's fallback).
  goal.step = { action: 'mine', block: 'crimson_stem', count: 2, drops: 'crimson_stem' };
  narration.narrate(bot, goal, { now: 60000 });
  goal.step = { action: 'find_fortress', found: { x: 161, y: 61, z: 356 }, legs: 30 };
  narration.narrate(bot, goal, { now: 80000 });
  assert.equal(said.filter(s => s === "A fortress! I'm heading for it.").length, 1, JSON.stringify(said));
  // A fortress in another region, far off, is a new find.
  goal.step = { action: 'mine', block: 'crimson_stem', count: 2, drops: 'crimson_stem' };
  narration.narrate(bot, goal, { now: 100000 });
  goal.step = { action: 'find_fortress', found: { x: 700, y: 60, z: 900 }, fortress: { x: 700, y: 60, z: 900, firstAt: 5 }, legs: 31 };
  narration.narrate(bot, goal, { now: 120000 });
  assert.equal(said.filter(s => s === "A fortress! I'm heading for it.").length, 2, JSON.stringify(said));
});

test('leaving a fortress from its bricks is not said as "1 blocks off" (25588 at 11:34Z, note 750)', () => {
  const hold = require('../src/fortress-hold');
  const said = [];
  const bot = { entity: { position: new Vec3(-105.5, 66, 93.5) }, chat: m => said.push(m), inventory: { items: () => [] } };
  hold.leave(bot, {}, { anchor: { x: -106, y: 66, z: 93 }, target: { x: -106, y: 66, z: 94 }, left: [], save: () => {} });
  assert.equal(said.at(-1), 'Leaving the fortress at (-106, 66, 93) for now, at its bricks as I leave it. Searching on for another.');
  hold.leave(bot, {}, { anchor: { x: -106, y: 66, z: 93 }, target: { x: -106, y: 66, z: 120 }, left: [], save: () => {} });
  assert.match(said.at(-1), /^Leaving the fortress at \(-106, 66, 93\) for now, 27 blocks off\. Searching on for another\.$/);
});

test('scripts/fortress-arrival.js: one episode a fortress, from first known to the first blaze fight, its minutes by the work question, no_route counted, a false "A fortress!" counted (note 750)', () => {
  const { measureFrames } = require('../scripts/fortress-arrival');
  const T = 1_000_000;
  const obs = (s, step, extra = {}) => ({ t: T + s * 1000, kind: 'observation', label: 'observation', snapshot: { step, position: { x: 0, y: 60, z: 0 }, inventory: { blaze_rod: extra.rods ?? 0 }, mobs: extra.mobs || [] } });
  const dec = (s, id, answer) => ({ t: T + s * 1000, kind: 'decision', label: answer, snapshot: { decision: { id } } });
  const fort = { action: 'find_fortress', found: { x: 10, y: 60, z: 10 }, fortress: { x: 10, y: 60, z: 10, firstAt: 1 }, legs: 3 };
  const frames = [
    obs(0, { action: 'find_fortress', legs: 3 }),
    obs(10, fort),
    dec(11, 'fortress_approach', 'walk_route'),
    { t: T + 20000, kind: 'no_route', label: 'no route', snapshot: {} },
    dec(30, 'fortress_approach', 'tunnel'),
    { t: T + 45000, kind: 'chat', label: 'chat', detail: { message: "A fortress! I'm heading for it." }, snapshot: {} },
    obs(60, { ...fort, walking: fort.found }),
    obs(90, { action: 'hunt_mob', entity: 'blaze' }, { mobs: [{ name: 'blaze', d: 5 }] }),
    obs(120, { action: 'hunt_mob', entity: 'blaze' }, { rods: 1, mobs: [{ name: 'blaze', d: 5 }] }),
  ];
  const [e] = measureFrames(frames, { end: T + 200000 });
  assert.equal(e.sighted, T + 10000);
  assert.equal(e.onFloors, T + 60000);
  assert.equal(e.fight, T + 90000);
  assert.equal(e.rod, T + 120000);
  assert.equal(e.span.noRoute, 1);
  assert.equal(e.span.falseFind, 1);
  assert.deepEqual(Object.keys(e.span.byWork), ['fortress_approach tunnel', 'fortress_approach walk_route', 'before any question']);
  assert.equal(e.span.byWork['fortress_approach tunnel'], 1);
});

test('the leg question with a fortress known out of view says where it is, how long known and why it is left, each leg toward or away from it, and the way back to it (25590 at 11:57:43Z, critic-20260930T1157Z item 1, note 750)', async () => {
  const { chooseLeg } = require('../src/mob-hunt');
  const bot = underBot({ items: [...FOOD, ['netherrack', 64], ['stone_pickaxe', 1]] });
  const now = Date.now();
  const goal = { kind: 'win', gameProgress: { phase: 'obtain_blaze_rods' }, mobHunt: { entity: 'blaze', item: 'blaze_rod', targetCount: 7 }, portals: PORTALS };
  const fortressAt = { x: 1040, y: 60, z: 74, extent: 40, firstAt: now - 98 * 60000 };
  const state = { legs: 36, since: now - 120 * 60000, fortressAt,
    shunned: [{ x: 1040, z: 74, radius: 60, until: now + 6 * 60000, at: now - 4 * 60000, why: 'Jev chose to leave it and search on', from: { x: 1000, y: 60, z: 74 }, left: ['walk route', 'tunnel'] }] };
  const client = jevStub(['back_to_fortress']);
  const ran = await chooseLeg(bot, new Task('hunt'), goal, () => {}, { client, navigate: noPath, tunnel: async () => {}, mineAt: async () => {}, acquireStep: async () => false }, state);
  const { options, state: facts } = client.asked.at(-1);
  assert.match(facts.fortressKnown, /^The fortress at \(1040, 60, 74\), 97 blocks off and out of view, known 98 minutes; 7 blaze rods still needed, and it is where they are known to be\. It is set aside 6 minutes more: Jev chose to leave it and search on, from \(1000, 60, 74\), its ways in then: walk route, tunnel\. Every leg from here searches for another fortress\.$/);
  if (options.leg_east) assert.match(options.leg_east, /^Toward the fortress known at \(1040, 60, 74\), out of view: its end is 1 blocks from it \(97 now\)\. /);
  if (options.leg_west) assert.match(options.leg_west, /^Away from the fortress known at \(1040, 60, 74\)/);
  assert.match(options.back_to_fortress, /^Go back to the fortress known at \(1040, 60, 74\), 97 blocks off: 7 blaze rods still needed/);
  // Taken: the walk is the leg's own, to it, and it is no longer set aside.
  assert.equal(ran, 'fortress');
  assert.deepEqual(state.target, { x: 1040, y: 60, z: 74 });
  assert.equal(state.rememberedTarget, true);
  assert.equal(state.shunned.length, 0);
  const narration = require('../src/narration');
  assert.equal(narration.stepLine({ fortressSearch: state }, { action: 'find_fortress', target: state.target, legs: 36 }, null, null, bot), 'Going back to the fortress at 1040, 74.');
  assert.equal(narration.stepLine({ fortressSearch: { fortressAt } }, { action: 'find_fortress', target: { x: 900, y: 60, z: 0 }, legs: 37 }, null, null, bot), 'Searching past the fortress I know at 1040, 74 (leg 37).');
});

test('a fetch of stems that gained nothing, however it ended, is said with the next offer of it from about there (25590, 11:48-11:57Z, note 750)', async () => {
  const nw = require('../src/nether-wood');
  const bot = { game: { dimension: 'the_nether' }, entity: { position: new Vec3(280.5, 40, -30.5) }, inventory: { items: () => [] } };
  const goal = {};
  // A fetch cut by a question above it after a step with no way there.
  let threw = null;
  await nw.fetchStems(bot, new Task('work'), goal, () => {}, { acquireStep: async () => { throw new Error('No way to crimson stem from here: 2 crimson stems known at (288, 40, 45), 81 blocks south'); } }).catch(e => { threw = e; });
  assert(threw, 'no stem gained: it throws, as before');
  assert.equal(goal.fetchStemsTries.length, 1);
  assert.deepEqual(goal.fetchStemsTries[0].from, { x: 281, y: 40, z: -30 });
  assert.match(nw.triesSays(goal, bot.entity.position), /^ This fetch was chosen once in the last 1 minute from within 32 blocks of here, and no stem came of it; the last ended: No way to crimson stem from here: 2 crimson stems known at \(288, 40, 45\), 81 blocks south\.$/);
  // From elsewhere, nothing is said.
  assert.equal(nw.triesSays(goal, new Vec3(600, 40, 300)), '');
});
