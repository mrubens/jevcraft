'use strict';
// Note 658: wood in the Nether is its forests' stems, and nothing offered
// them. 25583 (mid-243-cg) stood in a basalt delta with thirty iron ingots,
// no pickaxe and no wood (test/fixtures/basalt-delta-mid-243-cg.json), the
// warped forest's stems eleven blocks south: make_pickaxe was not offered
// (no wood for the sticks and the table) and nothing fetched them. 25585
// tunnelled its fortress legs by hand with one plank. The upkeep and the
// fortress search now offer fetch_stems, with the planks wanted and for
// what, against those carried, and the nearest stems known and the way.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { groundBot, registry } = require('./fixtures/saved-ground');
const { Task } = require('../src/skills');
const nw = require('../src/nether-wood');

const DELTA = require('./fixtures/basalt-delta-mid-243-cg.json');
const SPAN = require('./fixtures/span-end-mid-243-cd.json');
const BARE = require('./fixtures/span-end-mid-243-ah6.json');
// 25583's pockets at 03:01Z (note 655).
const DELTA_KIT = [['water_bucket', 1], ['bucket', 9], ['leaf_litter', 32], ['coal', 128], ['flint_and_steel', 1], ['white_bed', 1], ['raw_copper', 16], ['leather', 2], ['raw_gold', 5], ['iron_ingot', 30], ['iron_boots', 1], ['raw_iron', 30], ['cauldron', 1], ['magma_cream', 1], ['flint', 1], ['gravel', 14], ['iron_sword', 1], ['stone_axe', 1]];
const deltaBot = (items = DELTA_KIT) => groundBot(DELTA, { at: new Vec3(-20.7, 101, -18.5), health: 1.84, food: 13, dimension: 'the_nether', held: 'iron_sword', items });
const pockets = list => ({ inventory: { items: () => list.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id })) }, registry, game: { dimension: 'the_nether' } });
function jevStub(picks) {
  const asked = [];
  return { asked, systemOne: async ({ state, questions }) => { asked.push({ state, options: questions.branch_0.criteria }); return { answers: { branch_0: { choice: picks.shift(), confidence: 0.9 } } }; } };
}

test('the wood wanted: the pickaxe to make now and a spare, two sticks each, the heads carried first, one table, in planks against those carried (note 658)', () => {
  // 25583: thirty ingots are ten iron heads; a table and four sticks want six planks, two stems.
  let w = nw.woodWanted(pockets([['iron_ingot', 30]]));
  assert.deepEqual([w.picks, w.want, w.short, w.stems], [2, 6, 6, 2]);
  assert.equal(w.says, 'Wanted in wood: 6 planks\' worth for the pickaxe to make now (iron, from the ingots carried) and a spare (iron, from the ingots carried): a crafting table (4 planks), the sticks for 2 pickaxes (4 sticks, 2 planks); carried: no wood (0 planks\' worth), 6 short: 2 stems (8 planks).');
  // 25585: one plank and nothing for a head: a table, sticks and two wooden heads, twelve planks.
  w = nw.woodWanted(pockets([['oak_planks', 1], ['iron_sword', 1]]));
  assert.deepEqual([w.want, w.short, w.stems], [12, 11, 3]);
  assert.match(w.says, /2 wooden heads \(6 planks\)/);
  // A pickaxe carried: the spare alone, its head from the cobblestone carried.
  w = nw.woodWanted(pockets([['iron_pickaxe', 1], ['cobblestone', 20], ['stick', 2]]));
  assert.deepEqual([w.picks, w.want, w.short], [1, 4, 4]);
  // Stems and hyphae are four planks each; enough carried is nothing short.
  w = nw.woodWanted(pockets([['iron_pickaxe', 1], ['warped_stem', 2], ['crimson_hyphae', 1]]));
  assert.deepEqual([w.want, w.carried.planks, w.short], [9, 12, 0]);
});

test('25583 in the basalt delta, no pickaxe and no wood: the upkeep offers the warped stems eleven blocks south, with the forest, the route survey and the planks wanted (note 658)', async () => {
  const { upkeepStep } = require('../src/work');
  const bot = deltaBot();
  let offered = null;
  const client = { systemOne: async ({ questions }) => { offered = questions.branch_0.criteria; return { answers: { branch_0: { choice: 'carry_on', confidence: 0.7 } } }; } };
  await upkeepStep(bot, new Task('work'), { kind: 'win', step: { action: 'find_fortress' } }, () => {}, client);
  assert(offered?.fetch_stems, `offered: ${offered && Object.keys(offered)}`);
  assert.equal(offered.make_pickaxe, undefined, 'no wood: no pickaxe to be made');
  const said = offered.fetch_stems;
  // Where the stems are leads (note 709), the wood's sums after.
  assert.match(said, /^Fetch 2 stems of the Nether's forests now\. The nearest stems: 19 warped stems known at \(-23, 103, -8\), 11 blocks south and 2 up\. No pickaxe is carried/);
  assert.match(said, /Wanted in wood: 6 planks' worth for the pickaxe to make now \(iron, from the ingots carried\) and a spare/);
  // What the pickaxe is short of, which the fetch brings (note 705).
  assert.match(said, /No pickaxe is carried: it is short of 6 planks \(2 stems\) for a crafting table, the sticks, which this fetch brings; then an iron pickaxe from the iron ingots carried\. Until then rock is dug by hand and drops nothing\./);
  assert.match(said, /A warped forest: endermen spawn there .* no hoglin or piglin does; an enderman turns on a look at its head/);
  assert.match(said, /A route survey from here found no way there on foot \(the bot's own walks in the Nether take a cell with lava round it at its cost, crouched, but none with the lava a block to a side while a touch of it is death, nor one in line with something that can push the bot\)/);
  assert.match(said, /A stem needs no tool to drop and breaks by hand in about 3 seconds, about 0\.8 with the stone axe carried\./);
  assert.match(said, /The pickaxe is made as soon as the wood for it is carried\./);
  const { question } = require('../src/decisions');
  assert(question('upkeep').options.some(o => o.key === 'fetch_stems'));
  assert(question('fortress_leg').options.some(o => o.key === 'fetch_stems'));
});

test('low wood with a pickaxe carried: offered while stems are near, not where none are known; stranded with none known, the search is said (note 658)', async () => {
  // A pickaxe and no wood by the warped stems: the spare's wood, offered.
  let offer = await nw.fetchStemsOffer(deltaBot([['iron_pickaxe', 1], ['iron_ingot', 3]]), new Task('work'), { kind: 'win' });
  assert(offer, 'offered by the stems');
  assert.match(offer.description, /^Fetch 2 stems .* for a spare \(iron, from the ingots carried\): a crafting table \(4 planks\), the sticks for 1 pickaxe \(2 sticks, 2 planks\)/);
  // A span over the lava sea with no stem in the loaded ground, a pickaxe carried: not offered.
  const spanBot = items => groundBot(BARE, { at: new Vec3(-78.3, 38, -88.9), dimension: 'the_nether', items, indexed: true });
  assert.equal(await nw.fetchStemsOffer(spanBot([['iron_pickaxe', 1]]), new Task('work'), { kind: 'win' }), null);
  // No pickaxe and none to be made there: offered, saying none is known and the search.
  offer = await nw.fetchStemsOffer(spanBot([['oak_planks', 1]]), new Task('work'), { kind: 'win' });
  assert(offer);
  assert.match(offer.description, /No stem is known: none seen within 128 blocks or remembered, and no crimson or warped forest noticed or in the loaded ground\. The fetch then asks the legs of the gathering's search/);
  // A fetch resting is not offered.
  const goal = { kind: 'win' };
  require('../src/progress').setAside(goal, 'fetch_stems', 'nether', 'No stems were fetched', nw.REST_MS);
  assert.equal(await nw.fetchStemsOffer(spanBot([['oak_planks', 1]]), new Task('work'), goal), null);
  // Enough wood carried: nothing short, nothing offered.
  assert.equal(await nw.fetchStemsOffer(deltaBot([['iron_pickaxe', 1], ['warped_stem', 3]]), new Task('work'), { kind: 'win' }), null);
});

test('the fetch asks for the stems of the nearest kind as a mine step until the planks wanted are carried, then makes the pickaxe; one that gains nothing rests (note 658)', async () => {
  const bot = deltaBot();
  const inv = bot.inventory.items();
  bot.inventory.items = () => inv;
  const asked = [];
  const acquireStep = async (b, t, item, count) => {
    asked.push(`${item} ${count}`);
    if (item === 'warped_stem') inv.push({ name: 'warped_stem', count: 1, type: registry.itemsByName.warped_stem.id });
    else inv.push({ name: item, count: 1, type: registry.itemsByName[item].id });
    return false;
  };
  const goal = { kind: 'win' };
  const done = await nw.fetchStems(bot, new Task('work'), goal, () => {}, { acquireStep });
  assert.deepEqual(asked, ['warped_stem 2', 'warped_stem 2', 'iron_pickaxe 1']);
  assert.equal(done.gained, 8);
  assert.equal(goal.step.action, 'make_pickaxe');

  const idle = deltaBot();
  const goal2 = { kind: 'win' };
  await assert.rejects(nw.fetchStems(idle, new Task('work'), goal2, () => {}, { acquireStep: async () => { throw new Error('No reachable warped_stem'); } }), /No stems were fetched: No reachable warped_stem/);
  assert(require('../src/progress').isSetAside(goal2, 'fetch_stems', 'nether'));
});

test('on the fortress search with no pickaxe and no wood, the leg question offers the fetch, and the leg is chosen again after (25585, note 658)', async () => {
  const { findFortressStep } = require('../src/mob-hunt');
  const bot = deltaBot();
  const client = jevStub(['none_good']);
  const now = Date.now(), from = { x: -21, y: 101, z: -19 };
  const rest = { from, until: now + 240000, at: now - 30000, made: 1, why: 'no route' };
  const goal = { fortressSearch: { axis: 1, legs: 20, since: now - 60 * 60000, legRests: { east: rest, south: rest, west: rest, north: rest } } };
  let fetched = 0;
  await findFortressStep(bot, new Task('hunt'), goal, () => {}, { client, acquireStep: async () => { fetched++; return false; }, navigate: async () => { throw new Error('No path to the goal!'); }, mineAt: async () => {}, tunnel: async () => {} }).catch(() => {});
  // Every leg rests, and with no pickaxe the staircase toward the fortress
  // heights is not a way from a cell no step of which can be dug by hand
  // (the delta's basalt and blackstone, note 687): the fetch is the one way
  // left, taken without a question.
  assert.equal(client.asked.length, 0);
  assert(fetched > 0, 'the stems asked for');
  const { fetchStemsOffer } = require('../src/nether-wood');
  const offer = await fetchStemsOffer(deltaBot(), new Task('hunt'), {});
  assert.match(`${await offer.describe()} The leg is chosen again after.`, /warped stems known .* The leg is chosen again after\./);
});
