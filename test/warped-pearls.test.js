'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const registry = require('minecraft-data')('26.1');
const { nextGameStage, observeProgress } = require('../src/game-progress');
const warped = require('../src/warped-pearls');
const { setAside } = require('../src/progress');

const KIT = ['white_bed', 'diamond_pickaxe', 'iron_sword', 'diamond_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots', 'bow']
  .map(name => ({ name, count: 1 })).concat({ name: 'arrow', count: 16 }, { name: 'blaze_rod', count: 8 });
function fixture(dimension) {
  const items = [...KIT];
  const bot = { registry, game: { dimension, gameMode: 'survival' }, health: 20, food: 20, isAlive: true, entities: {}, chat() {},
    entity: { position: new Vec3(0.5, 64, 0.5) }, inventory: { items: () => items } };
  const goal = { kind: 'win' }; observeProgress(bot, goal);
  return { bot, goal };
}

test('a warped forest is warped nylium and stems in the Nether', () => {
  const { DETECTORS } = require('../src/exploration');
  const detect = DETECTORS.find(d => d.kind === 'warped_forest').detect;
  const blocks = Array.from({ length: 30 }, (_, i) => new Vec3(i, 60, 0));
  const bot = { registry, findBlocks: ({ matching }) => matching.includes(registry.blocksByName.warped_nylium.id) ? blocks : [] };
  assert.equal(detect(bot).warped, 30);
});

test('a warped forest beyond the block search is found by the loaded chunks\' biome', () => {
  const { DETECTORS } = require('../src/exploration');
  const detect = DETECTORS.find(d => d.kind === 'warped_forest').detect;
  const warped = registry.biomesByName.warped_forest.id, wastes = registry.biomesByName.nether_wastes.id;
  const bot = { registry, entity: { position: new Vec3(0.5, 64, 0.5) }, findBlocks: () => [],
    blockAt: p => ({ position: p, name: 'netherrack', biome: { id: p.x >= 90 && p.z >= 30 ? warped : wastes } }) };
  const found = detect(bot);
  assert(found && found.biome, JSON.stringify(found));
  assert.equal(found.x, 96); assert.equal(found.z, 32);
  bot.blockAt = p => ({ position: p, name: 'netherrack', biome: { id: wastes } });
  assert.equal(detect(bot), null);
});

test('in the Nether with the rods in hand, the pearls come from the warped forest before the walk back', () => {
  const { bot, goal } = fixture('the_nether');
  assert.equal(nextGameStage(bot, goal).action, 'warped_pearls', 'none known: the sweep for one');
  setAside(goal, 'rung', 'warped_search', 'none found', 600000);
  assert.equal(nextGameStage(bot, goal).action, 'home_with_rods', 'the sweep rested and none known: home the old way, leaving held as an intention (note 711)');
  goal.landmarks = [{ kind: 'warped_forest', x: 300, y: 70, z: 40, dimension: 'nether' }];
  assert.equal(nextGameStage(bot, goal).action, 'warped_pearls', 'one remembered: go there');
});

test('in the Overworld, a remembered warped forest sends the bot back through the portal for pearls', () => {
  const { bot, goal } = fixture('overworld');
  // (The rods' bank on arrival, note 1050, is this trip's already.)
  setAside(goal, 'rod_bank', 'arrival', 'answered', 30 * 60000);
  assert.equal(nextGameStage(bot, goal).via, 'warped_forest', 'none known yet: back through the portal to look for one');
  setAside(goal, 'rung', 'warped_search', 'none found', 600000);
  assert.equal(nextGameStage(bot, goal).action, 'pearl_patrol', 'the search rested: endermen on sight, an expedition or exploring between');
  goal.landmarks = [{ kind: 'warped_forest', x: 300, y: 70, z: 40, dimension: 'nether' }];
  const stage = nextGameStage(bot, goal);
  assert.equal(stage.action, 'enter_nether'); assert.equal(stage.via, 'warped_forest', 'one remembered: go there');
});

test('the sweep walks legs of sixty-four and rests after eight without a forest', async () => {
  const { bot, goal } = fixture('the_nether');
  const legs = [];
  const actions = { navigate: async (b, t, g) => { legs.push([g.x, g.z]); b.entity.position = new Vec3(g.x, 64, g.z); }, acquireStep: async () => assert.fail('no hunt without a forest'), notice: () => {} };
  for (let i = 0; i < 9; i++) await warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 12 });
  assert.equal(legs.length, 8);
  assert(Math.hypot(legs[0][0], legs[0][1]) >= 60, 'a sixty-four-block leg');
  assert.equal(warped.warpedOpen(goal), false, 'eight legs and nothing: the search rests');
});

test('a walk that fails at once is not a leg: the sweep tunnels on and gives up only after real tries', async () => {
  const { bot, goal } = fixture('the_nether');
  let tunnels = 0;
  // Each staircase makes a little ground, so no spot has every heading come to nothing from it (note 588).
  const actions = { navigate: async () => {}, tunnel: async b => { tunnels++; b.entity.position = b.entity.position.offset(3, 0, 0); }, acquireStep: async () => {}, notice: () => {} };
  for (let i = 0; i < 10; i++) await warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 12 });
  assert.equal(tunnels, 10, 'each stuck walk goes on through the netherrack');
  assert.equal(goal.warpedSearch.legs, 0, 'and ten stuck tries are not ten legs');
  assert(warped.warpedOpen(goal), 'the search is still on');
  for (let i = 0; i < 30; i++) await warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 12 });
  assert(warped.warpedOpen(goal), 'forty quick tries are not a search spent');
  // The search kept at through the quarter hour (its last step a second before: note 1109 begins the clock again only after five minutes away).
  goal.warpedSearch.lastAt = Date.now() + 16 * 60000 - 1000;
  await warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 12 }, { now: () => Date.now() + 16 * 60000 });
  assert.equal(warped.warpedOpen(goal), false, 'a quarter of an hour without a forest: it rests');
});

test('the pearl patrol hunts an enderman in view, and otherwise explores the surface; the deep dark is not its to take unasked (note 1119)', () => {
  const { patrolChoice } = require('../src/work');
  const bot = { entity: { position: new Vec3(0, 64, 0) }, entities: {} };
  assert.equal(patrolChoice(bot, { explore: {}, deep_dark: {}, trial_chambers: {} }), 'explore');
  assert.equal(patrolChoice(bot, { deep_dark: {} }), 'search', 'the deep dark alone: the search, not the trip');
  assert.equal(patrolChoice(bot, { explore: {} }), 'explore');
  assert.equal(patrolChoice(bot, {}), 'search', 'nothing else to do: the search as before');
  bot.entities[4] = { name: 'enderman', position: new Vec3(30, 64, 0), isValid: true };
  assert.equal(patrolChoice(bot, { explore: {}, deep_dark: {} }), 'hunt', 'the fun part');
});

test('a warped forest whose walk came to nothing is not walked to again at once, twenty times a second: the sweep looks for another, and with the sweep resting the pearls go the old way (mid-244-ad-nether-3, note 583)', async () => {
  // mid-244-ad-nether-3 (and mid-242-ae-nether-2 and -3-fortress-1): a forest seen across the lava sea 127 blocks off,
  // the walk there came no nearer, the trip was set aside half an hour, and warped_pearls then returned at once on
  // every pass (the forest still counted as known, its walk refused), "No measurable progress" every two seconds.
  const { bot, goal } = fixture('the_nether');
  goal.landmarks = [{ kind: 'warped_forest', x: 153, y: 63, z: -217, dimension: 'nether' }];
  const walks = [];
  const actions = { navigate: async (b, t, g) => { walks.push([g.x, g.z]); throw new Error('No path to the goal!'); }, tunnel: async () => {}, acquireStep: async () => assert.fail('no hunt short of the forest'), notice: () => {} };
  await assert.rejects(warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 16 }),
    /^Error: The walk to the warped forest at \(153, -217\), 266 blocks off, came no nearer: No path to the goal!; that walk rests half an hour$/, 'the step\'s own failure, said');
  assert.equal(walks.length, 1, 'walked there once');
  assert.match(goal.tried.entries.find(e => e.q === 'step' && e.method === 'warped_pearls').why, /^The walk to the warped forest/, 'in the ledger');
  const forest = goal.landmarks[0];
  assert.equal(forest.lastWalk.why, 'No path to the goal!', 'how the walk ended is kept with the place');
  assert.equal(forest.lastWalk.began, 266);
  // The next pass: not the resting walk refused and returned, but the sweep for another forest.
  await warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 16 });
  assert.equal(goal.step.action, 'warped_search', 'the sweep for another forest, not the refused walk again');
  assert(warped.warpedOpen(goal));
  setAside(goal, 'rung', 'warped_search', 'none found', 600000);
  assert.equal(warped.warpedOpen(goal), false, 'the forest\'s walk resting and the sweep resting: not open');
  assert.equal(nextGameStage(bot, goal).action, 'home_with_rods', 'home the old way, not the pearl step spinning, leaving held as an intention (note 711)');
});

test('the sweep from a ledge where every walk and every staircase comes to nothing keeps one step\'s name, and once every heading has come to nothing from about here it rests and fails with each heading\'s why, not turning for a quarter of an hour (mid-242-ae-nether-2-fortress-2, note 588)', async () => {
  // 25600 at 05:22 to 05:25: at (-41.5, 35, 81.5) on a ledge of its own stairs, both warped forests known set aside
  // (their walks came no nearer), the sweep for a third: every walk "No path to the goal!", every staircase "no floor
  // to step onto", the step named warped_search and tunnel in turn, "turning between tunnel and warped search 4 times
  // in 8 seconds", 233 tries and no leg, for as long as the sweep's quarter of an hour ran.
  const { bot, goal } = fixture('the_nether');
  bot.entity.position = new Vec3(-41.5, 35, 81.5);
  goal.landmarks = [{ kind: 'warped_forest', x: -77, y: 58, z: -4, dimension: 'nether' }, { kind: 'warped_forest', x: -61, y: 62, z: -147, dimension: 'nether' }];
  for (const l of goal.landmarks) setAside(goal, 'landmark_trip', `warped_forest:${l.x},${l.z}`, 'the walk there came no nearer than before', 1800000);
  const withins = [];
  const actions = { navigate: async () => { throw new Error('No path to the goal!'); }, acquireStep: async () => assert.fail('no hunt'), notice: () => {},
    tunnel: async (b, t, g, sv, target, opts = {}) => { withins.push(opts.within); throw new Error(`The staircase toward (${target.x}, ${target.y}, ${target.z}) is set aside (no safe step toward it: no floor to step onto (a gap, for a span or a pillar))`); } };
  let failed = null, passes = 0;
  while (passes < 40 && !failed) {
    passes++;
    try { await warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 16 }); }
    catch (err) { failed = err; }
  }
  assert(withins.length && withins.every(w => w?.action === 'warped_search'), 'the staircase is the sweep\'s phase: it is handed the sweep\'s step to keep its name');
  assert.equal(passes, 12, 'three tries a heading, four headings, then done');
  assert.match(failed?.message || '', /^The sweep for a warped forest got nowhere from \(-41, 35, 82\): every heading came to nothing \(\w+: the walk failed \(No path to the goal!\), the staircase failed \(The staircase toward .* no floor to step onto/);
  assert.match(failed.message, /the sweep rests half an hour$/);
  assert.equal(warped.warpedOpen(goal), false, 'the sweep rests');
  assert.match(goal.tried.entries.find(e => e.q === 'step' && e.method === 'warped_pearls').why, /^The sweep for a warped forest got nowhere/, 'in the ledger');
  // Somewhere else is a sweep afresh: the headings spent from the ledge are not carried off it.
  require('../src/progress').attemptsFor(goal).clear('rung', 'warped_search');
  bot.entity.position = new Vec3(20.5, 60, 20.5);
  await warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 16 });
  assert.equal(goal.warpedSearch.spent, undefined);
});

test('a forest remembered past the walk\'s reach is not a leg found: the sweep counts ground, not a far memory (note 680)', async () => {
  // mid-242-gb (25593): eight legs "found" in under a second, and "Looking for a warped forest" and "No warped forest found" three times in a second each.
  const { bot, goal } = fixture('the_nether');
  goal.landmarks = [{ kind: 'warped_forest', x: 2000, y: 70, z: 40, dimension: 'nether' }];
  const said = [];
  bot.chat = m => said.push(m);
  const actions = { navigate: async () => {}, tunnel: async () => {}, acquireStep: async () => assert.fail('no hunt'), notice: () => {} };
  for (let i = 0; i < 10; i++) await warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 12 });
  assert.equal(goal.warpedSearch.legs, 0, 'standing still, no leg is counted');
  assert.equal(said.filter(m => /Looking for a warped forest/.test(m)).length, 1);
  assert.equal(said.filter(m => /No warped forest found/.test(m)).length, 0);
});

// Note 1056: every rod in the bot's chests and pearls still wanted, the Overworld's ladder is the pearls', not the Nether for rods.
test('in the Overworld with every rod kept in chests and none carried, the stage is the pearls\', not a crossing for rods (note 1056)', () => {
  const { bot, goal } = fixture('overworld');
  const items = bot.inventory.items();
  items.splice(items.findIndex(i => i.name === 'blaze_rod'), 1);
  setAside(goal, 'rod_bank', 'arrival', 'answered', 30 * 60000);
  setAside(goal, 'rung', 'warped_search', 'none found', 600000);
  // No chests known: short of rods, the Nether is next.
  assert.equal(nextGameStage(bot, goal).action, 'enter_nether');
  goal.rodStashes = [{ position: { x: -40, y: 94, z: 132 }, dimension: 'overworld', contents: { blaze_rod: 6 } }, { position: { x: -172, y: 66, z: 112 }, dimension: 'nether', contents: { blaze_rod: 2 } }];
  const stage = nextGameStage(bot, goal);
  assert.equal(stage.phase, 'obtain_ender_pearls', JSON.stringify(stage));
  assert.equal(stage.action, 'pearl_patrol');
});

test('from the Overworld a forest counts as it will on the far side, within the walk\'s reach of where the crossing comes out; the search\'s clock begins again after five minutes away (note 1109)', async () => {
  // 25591 (2026-10-03 20:42 to 20:46Z): nine rods and seven pearls in its chest, four crossings in four minutes: a forest remembered far off sent it through,
  // the search begun ninety minutes before rested twelve seconds in, and it came back.
  const { bot, goal } = fixture('overworld');
  setAside(goal, 'rod_bank', 'arrival', 'answered', 30 * 60000);
  setAside(goal, 'rung', 'warped_search', 'eight legs without reaching a warped forest', 600000);
  // The bot at (0, 0) here comes out near (0, 0) there: a forest 900 blocks off is out of the walk's reach.
  goal.landmarks = [{ kind: 'warped_forest', x: 900, y: 70, z: 40, dimension: 'nether' }];
  assert.equal(nextGameStage(bot, goal).action, 'pearl_patrol', 'far off and the search resting: the pearls on this side');
  goal.landmarks = [{ kind: 'warped_forest', x: 300, y: 70, z: 40, dimension: 'nether' }];
  assert.equal(nextGameStage(bot, goal).via, 'warped_forest', 'within reach: through the portal');
  // A portal known on the far side is where the crossing comes out.
  goal.portals = [{ dimension: 'nether', x: 60, y: 70, z: 0 }];
  goal.landmarks = [{ kind: 'warped_forest', x: 560, y: 70, z: 0, dimension: 'nether' }];
  assert.equal(nextGameStage(bot, goal).via, 'warped_forest', '500 from the portal there');
  // The search's clock: begun long ago and left, it begins again; it does not rest at its first step.
  const there = fixture('the_nether');
  there.goal.warpedSearch = { legs: 7, heading: 0, fails: 0, tries: 0, startedAt: Date.now() - 90 * 60000, lastAt: Date.now() - 80 * 60000 };
  const legs = [];
  const actions = { navigate: async (b, t, g) => { legs.push([g.x, g.z]); b.entity.position = new Vec3(g.x, 64, g.z); }, acquireStep: async () => assert.fail('no hunt without a forest'), notice: () => {} };
  await warped.warpedPearls(there.bot, new Task('pearls'), there.goal, () => {}, actions, { count: 12 });
  assert.equal(legs.length, 1, 'a leg is walked');
  assert.equal(there.goal.warpedSearch?.legs, 1, 'counted from none');
  assert.equal(warped.warpedOpen(there.goal), true, 'the search is not rested');
});

test('a forest whose walk rests is walked at again once the sweep has brought the bot 24 blocks nearer than where that walk failed; from the same spot it is not (note 1120)', async () => {
  // 25592 (2026-10-03 21:19 to 21:25Z): its forest 87 blocks off rested after a walk with no route; the sweep passed 52 blocks from it and never tried again.
  const { bot, goal } = fixture('the_nether');
  const forest = { kind: 'warped_forest', x: -82, y: 56, z: 13, dimension: 'nether', lastWalk: { at: Date.now(), from: { x: 5, y: 50, z: 13 }, began: 87, ended: 87, why: 'No route' } };
  goal.landmarks = [forest];
  setAside(goal, 'landmark_trip', 'warped_forest:-82,13', 'the walk came no nearer', 30 * 60000);
  const legs = [];
  const actions = { navigate: async (b, t, g) => { legs.push([g.x, g.z]); }, acquireStep: async () => {}, notice: () => {} };
  // From where it failed: the sweep, the rest kept.
  bot.entity.position = new Vec3(5.5, 50, 13.5);
  await warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 12 });
  assert.equal(require('../src/progress').isSetAside(goal, 'landmark_trip', 'warped_forest:-82,13'), true, 'still resting from there');
  // Fifty-two blocks from it: the rest is let go and the next pass walks at it.
  bot.entity.position = new Vec3(-82.5, 57, 65.5);
  assert.equal(await warped.warpedPearls(bot, new Task('pearls'), goal, () => {}, actions, { count: 12 }), true);
  assert.equal(require('../src/progress').isSetAside(goal, 'landmark_trip', 'warped_forest:-82,13'), false, 'asked again from nearer');
});
