'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { openRungs, gameStep } = require('../src/game-progress');
const { strategyStep, strategyOptions, HOLD_MS } = require('../src/strategy');
const { decide } = require('../src/decisions');

const GEAR = ['white_bed', 'diamond_pickaxe', 'iron_sword', 'diamond_sword', 'shield', 'water_bucket', 'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots', 'bow'].map(name => ({ name, count: 1 })).concat({ name: 'arrow', count: 16 });
function fixture(without = []) {
  const items = GEAR.filter(i => !without.includes(i.name));
  const bot = Object.assign(new EventEmitter(), { _client: new EventEmitter(), game: { dimension: 'overworld', gameMode: 'survival' },
    health: 20, food: 20, isAlive: true, entities: {}, time: { timeOfDay: 1000 }, entity: { position: new Vec3(.5, 64, .5) }, inventory: { items: () => items } });
  const goal = { version: 1, kind: 'win', request: 'beat the game' };
  return { bot, goal, task: new Task('win') };
}
const picking = choice => { const asked = []; return { asked, decide: async (id, args) => { asked.push({ id, keys: Object.keys(args.tree), state: args.state }); return { path: [choice] }; } }; };

test('the open rungs are the ladder\'s next and each one after it that may wait; armour closes the list', () => {
  let { bot, goal } = fixture(['golden_boots', 'diamond_sword']);
  assert.deepEqual(openRungs(bot, goal).map(r => r.phase), ['golden_boots', 'diamond_sword']);
  ({ bot, goal } = fixture(['iron_helmet', 'golden_boots']));
  assert.deepEqual(openRungs(bot, goal).map(r => r.phase), ['iron_helmet'], 'armour may not wait, so nothing after it is on offer');
});

test('Jev may put a later rung first; the choice holds for ten minutes, then is asked again', async () => {
  const { bot, goal, task } = fixture(['golden_boots', 'diamond_sword']);
  const said = []; bot.chat = line => said.push(line);
  const { asked, decide } = picking('rung_diamond_sword');
  let now = 1e12;
  const stage = { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 };
  const first = await strategyStep(bot, task, goal, () => {}, stage, { decide, now: () => now });
  assert.equal(first.stage.phase, 'diamond_sword');
  assert.deepEqual(asked[0].keys, ['rung_golden_boots', 'rung_diamond_sword', 'nether_first']);
  assert.equal(asked[0].id, 'win_strategy');
  assert.match(said[0], /diamond sword first, then the golden boots/);
  now += 60000;
  assert.equal((await strategyStep(bot, task, goal, () => {}, stage, { decide, now: () => now })).stage.phase, 'diamond_sword');
  assert.equal(asked.length, 1, 'held, not asked at every step');
  now += HOLD_MS;
  await strategyStep(bot, task, goal, () => {}, stage, { decide, now: () => now });
  assert.equal(asked.length, 2, 'asked again after ten minutes');
});

test('a side trip runs once, rests, and the next step asks without it', async () => {
  const { bot, goal, task } = fixture(['golden_boots']);
  let looted = 0;
  const sides = { loot: { description: 'Loot: walk 120 blocks to the ruined portal and open its chests.', says: 'I\'ll loot the ruined portal 120 blocks away', run: async () => { looted++; } } };
  const { asked, decide } = picking('loot');
  const stage = { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 };
  assert.deepEqual(await strategyStep(bot, task, goal, () => {}, stage, { decide, sides }), { ran: true });
  assert.equal(looted, 1);
  assert.deepEqual(Object.keys(strategyOptions(bot, goal, stage, sides)), ['rung_golden_boots', 'nether_first'], 'the portal rests; the rung and the Nether before it remain');
});

test('side trips are offered at night too (Jev weighs the dark), and a lone rung is taken without asking', async () => {
  const { bot, goal, task } = fixture(['golden_boots']);
  bot.time.timeOfDay = 14000;
  let looted = false;
  const sides = { loot: { description: 'Loot the ruined portal.', run: async () => { looted = true; } } };
  const night = picking('loot');
  await strategyStep(bot, task, goal, () => {}, { phase: 'golden_boots' }, { decide: night.decide, sides });
  assert.equal(night.asked.length, 1, 'asked, the trip among the options');
  assert(looted, 'and Jev\'s pick ran');
  // Armour may not wait: alone, it is no choice.
  const { bot: b2, goal: g2, task: t2 } = fixture(['iron_helmet']);
  b2.time.timeOfDay = 14000;
  const lone = picking('loot');
  assert.equal(await strategyStep(b2, t2, g2, () => {}, { phase: 'iron_helmet' }, { decide: lone.decide, sides: {} }), null);
  assert.equal(lone.asked.length, 0, 'a lone rung is not asked about');
});

test('with Jev unreachable the ladder\'s own order is kept, through the registry', async () => {
  const { bot, goal, task } = fixture(['golden_boots', 'diamond_sword']);
  const stage = { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 };
  const sides = { enchant: { description: 'Enchant the diamond sword.', run: async () => assert.fail('the fallback is the ladder') } };
  assert.equal(await strategyStep(bot, task, goal, () => {}, stage, { client: null, decide, sides }), null);
  assert.equal(goal.strategy.choice, 'rung_golden_boots'); assert.equal(goal.strategy.source, 'fallback');
});

test('the ladder step works the rung Jev chose', async () => {
  const { bot, goal, task } = fixture(['golden_boots', 'diamond_sword']);
  const acquired = [];
  const actions = { acquireStep: async (b, t, item, count) => { acquired.push(item); },
    strategy: (b, t, g, sv, stage) => strategyStep(b, t, g, sv, stage, picking('rung_diamond_sword')) };
  await gameStep(bot, task, goal, () => {}, actions);
  assert.deepEqual(acquired, ['diamond_sword']);
  assert.equal(goal.gameProgress.phase, 'diamond_sword');
});

test('a trip that does not fit in the daylight left is still offered: whether to go is Jev\'s (the user, 2026-09-26)', () => {
  const { bot, goal } = fixture(['golden_boots', 'diamond_sword']);
  const sides = { loot: { description: 'Loot the ruined portal 240 blocks away.', walkBlocks: 240, run: async () => {} } };
  const stage = { phase: 'golden_boots' };
  for (const t of [3000, 9000, 15000]) {
    bot.time.timeOfDay = t;
    assert(strategyOptions(bot, goal, stage, sides).loot, `offered at ${t}`);
  }
});

test('no side trip while the next step is a basic tool', () => {
  const { bot, goal } = fixture([]);
  bot.inventory.items = () => [{ name: 'wooden_pickaxe', count: 1 }, { name: 'stone_sword', count: 1 }];
  const sides = { loot: { description: 'Loot the dungeon.', run: async () => {} } };
  const options = strategyOptions(bot, goal, { phase: 'stone_pickaxe', action: 'acquire' }, sides);
  assert(!options || !options.loot, 'the pickaxe first');
});

test('a set is offered by its name and pieces, with what it takes from the pockets, and "no gathering" when the pockets hold it all', () => {
  // Trial 43: sixty-one raw iron carried, the armour offered as "get 4 iron helmet".
  const { rungOption } = require('../src/strategy');
  const armour = { phase: 'iron_armour', action: 'acquire_set', item: 'iron_helmet', items: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'], count: 4 };
  const planFor = (b, items) => [{ action: 'smelt', item: 'iron_ingot', count: 23 }, ...items.map(({ item }) => ({ action: 'craft', item, count: 1 }))];
  const d = rungOption(armour, false, { entity: { position: { x: 0, y: 0, z: 0 } } }, {}, planFor).description;
  assert.match(d, /get iron armour \(iron helmet, iron chestplate, iron leggings, iron boots\)/);
  assert.match(d, /twenty-four ingots/);
  assert.match(d, /smelt 23 iron ingot, craft 1 iron helmet/);
  assert.match(d, /no gathering/);
  const mining = rungOption(armour, false, { entity: { position: { x: 0, y: 0, z: 0 } } }, {}, () => [{ action: 'mine', item: 'raw_iron', count: 24 }]).description;
  assert.doesNotMatch(mining, /no gathering/);
});

test('a set is planned against the pockets once, not a piece at a time: eleven raw iron is not four pieces of armour', () => {
  // Trial 94: each piece fit in eleven raw iron, and the four were offered as "no gathering".
  const { rungOption } = require('../src/strategy');
  const { batchPlan } = require('../src/batch-plan');
  const registry = require('minecraft-data')('26.1');
  const armour = { phase: 'iron_armour', action: 'acquire_set', item: 'iron_helmet', items: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'], count: 4 };
  const stock = { raw_iron: 11, coal: 64, furnace: 1, crafting_table: 1, iron_pickaxe: 1 };
  const planFor = (b, item, count) => (Array.isArray(item) ? batchPlan(registry, item, stock, { nearby: ['iron_ore', 'stone'], tools: [{ name: 'iron_pickaxe', enchantments: [] }], equipment: [], dimension: 'overworld' }).steps : assert.fail('planned a piece at a time'));
  const d = rungOption(armour, false, { entity: { position: { x: 0, y: 0, z: 0 } } }, {}, planFor).description;
  assert.match(d, /mine 13 iron ore, smelt 24 iron ingot/);
  assert.doesNotMatch(d, /no gathering/);
});

test('the home steps say what a home is for, as the other steps do', () => {
  // Trial 72: "get home site" and nothing more, beside options that each said what they were worth.
  const { rungOption } = require('../src/strategy');
  const bot = { entity: { position: { x: 0, y: 0, z: 0 } } };
  for (const phase of ['home_site', 'home_level', 'home_stash', 'home_bed']) {
    const d = rungOption({ phase, action: phase }, true, bot, {}).description;
    assert.match(d, /\((the|a) /, `${phase}: ${d}`);
  }
});

test('a bed searched for with no sheep seen is offered with the other ways as they stand: string carried, spiders, cobwebs, a known igloo', () => {
  // Trial 113: "none seen yet" forty-three minutes running in snow, and the bed was never chosen.
  const { rungOption } = require('../src/strategy');
  const bot = { entity: { position: { x: 0, y: 64, z: 0 } }, game: { dimension: 'overworld' }, entities: {}, inventory: { items: () => [{ name: 'string', count: 5 }] } };
  const goal = { woolSearch: { since: Date.now() - 20 * 60000, from: { x: 0, z: 0 } }, landmarks: [{ kind: 'igloo', dimension: 'overworld', x: 60, y: 64, z: 80, beds: 1 }] };
  const d = rungOption({ phase: 'bed', action: 'gather_wool', count: 3 }, true, bot, goal).description;
  assert.match(d, /none seen yet\. Without sheep: 5 string carried of the twelve/);
  assert.match(d, /spiders drop up to two each/);
  assert.match(d, /an igloo with a bed 100 blocks away/);
});

// A cave at y -16 under a surface at y 54: stone above the bot, air below
// the sky line.
function caveBot(items) {
  const reg = require('minecraft-data')('26.1');
  return { registry: reg, game: { dimension: 'overworld', minY: -64, height: 384 }, entity: { position: new Vec3(0.5, -16, 0.5) }, entities: {},
    inventory: { items: () => items.map(([name, count, used]) => ({ name, count, ...(used ? { durabilityUsed: used } : {}) })) },
    blockAt: p => ({ name: p.y > 54 || (p.y >= -16 && p.y <= -15) ? 'air' : 'stone', boundingBox: p.y > 54 || (p.y >= -16 && p.y <= -15) ? 'empty' : 'block' }) };
}

test('a rung that spends the last wood says what it leaves for the next pickaxe, and a home step where it is done (mid-100-c)', () => {
  // mid-100-c: seventy blocks under home, the last three logs went on a
  // chest; the iron pickaxe broke twelve minutes later, and the climb was by hand.
  const { rungOption } = require('../src/strategy');
  const { batchPlan } = require('../src/batch-plan');
  const registry = require('minecraft-data')('26.1');
  const bot = caveBot([['oak_log', 3], ['iron_pickaxe', 1, 56], ['iron_ingot', 3]]);
  const home = { version: 1, dimension: 'overworld', origin: { x: 0, y: 54, z: 0 }, direction: { x: 1, z: 0 }, water: { x: -1, y: 54, z: 0 }, bed: {}, plot: {}, pen: {} };
  const planFor = (b, item, count) => batchPlan(registry, [{ item, count }], { oak_log: 3, iron_pickaxe: 1, iron_ingot: 3 }, { nearby: ['stone'], tools: [{ name: 'iron_pickaxe', enchantments: [] }], equipment: [], dimension: 'overworld' }).steps;
  const d = rungOption({ phase: 'home_stash', action: 'home', item: 'chest', count: 1, home: { phase: 'home_stash', action: 'acquire', item: 'chest' } }, true, bot, { survival: { home } }, planFor).description;
  assert.match(d, /It is done at the base, the chest going by the bed: \d+ blocks from here, 71 blocks up\./);
  assert.match(d, /The chest is made from the pockets where the bot stands, then carried there/);
  assert.match(d, /It leaves 0 logs, 0 planks, 0 sticks and 3 iron ingots/);
  assert.match(d, /and no sticks can be made from what is left\. Pickaxes carried: the iron pickaxe \(194 uses left\)/);
  assert.match(d, /about 71 blocks under the surface: when the last pickaxe breaks, none can be made down here, and the way up is dug by hand at about 2 blocks a minute \(about 36 minutes\)/);
});

test('a rung that spends the ingots and sticks says a pickaxe can no longer be made (mid-87-a)', () => {
  // mid-87-a: twenty-four ingots and the sticks on armour, the last iron pickaxe broke at y 17.
  const { rungOption, pickaxeLeft } = require('../src/strategy');
  const bot = caveBot([['iron_ingot', 24], ['stick', 3], ['oak_planks', 2], ['iron_pickaxe', 1, 209]]);
  const armour = { phase: 'iron_armour', action: 'acquire_set', item: 'iron_helmet', items: ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'], count: 4 };
  const planFor = () => [['iron_helmet', 5], ['iron_chestplate', 8], ['iron_leggings', 7], ['iron_boots', 4]].map(([item, n]) => ({ action: 'craft', item, count: 1, consumes: { iron_ingot: n }, produces: { [item]: 1 } }));
  const d = rungOption(armour, true, bot, {}, planFor).description;
  assert.match(d, /It leaves 0 logs, 2 planks, 3 sticks and 0 iron ingots/);
  assert.match(d, /no pickaxe head can be made \(3 ingots or 3 cobblestone\) from what is left\. Pickaxes carried: the iron pickaxe \(41 uses left\)/);
  assert.match(d, /the way up is dug by hand/);
  assert.equal(pickaxeLeft(bot, { cobblestone: 4 }), '', 'nothing a pickaxe needs spent: nothing said');
});

test('a rung that mines says where the ore lies and what going without costs; the pearls say what they are for (the decision audit)', () => {
  const { rungOption } = require('../src/strategy');
  const bot = { entity: { position: new Vec3(0, 64, 0) } };
  const d = rungOption({ phase: 'iron_pickaxe', action: 'acquire', item: 'iron_pickaxe', count: 1 }, true, bot, { rungClocks: { iron_pickaxe: { activeMs: 5 * 60000 } } },
    () => [{ action: 'mine', item: 'iron_ore', count: 3 }, { action: 'smelt', item: 'iron_ingot', count: 3 }]).description;
  assert.match(d, /Iron ore lies between y -24 and 56, most around y 16: 48 blocks below here/);
  assert.match(d, /Worked on for 5 minutes so far/);
  assert.match(d, /Until it is done, no diamond, gold or redstone can be mined/);
  assert.match(rungOption({ phase: 'stone_pickaxe', action: 'acquire', item: 'stone_pickaxe' }, true, bot, {}).description, /\(mines stone, coal and iron ore/);
  const { bot: b2, goal } = fixture([]);
  const options = strategyOptions(b2, goal, { phase: 'obtain_ender_pearls', action: 'pearl_patrol', item: 'ender_pearl', count: 12 }, { trade: { description: 'x', walkBlocks: 10 } });
  assert.match(options.stage_obtain_ender_pearls.description, /endermen drop the pearls/);
});

// Six midgame trials (2026-09-26): one of six carried a bed once the home's
// was claimed, and the climbs back up after nights underground were 110 of
// 408 minutes.
function homeFixture(without = [], { items = [] } = {}) {
  const f = fixture(['white_bed', ...without]);
  const carried = f.bot.inventory.items().concat(items);
  f.bot.inventory.items = () => carried;
  f.bot.blockAt = () => null; // home is out of view: its steps are not reopened
  f.goal.survival = { home: { version: 1, dimension: 'overworld', origin: { x: 400, y: 63, z: 0 }, direction: { x: 1, z: 0 }, water: { x: 399, y: 63, z: 0 },
    bed: { placedAt: 'then', claimedAt: 'then' }, plot: {}, pen: {}, completedAt: 'then' } };
  return f;
}

test('once the base\'s bed is claimed, a second bed to carry is Jev\'s option, with what it buys and what it costs', () => {
  const { setAside } = require('../src/progress');
  const { bot, goal } = homeFixture(['golden_boots', 'diamond_sword'], { items: [{ name: 'string', count: 5 }, { name: 'oak_planks', count: 8 }] });
  const stage = { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 };
  const options = strategyOptions(bot, goal, stage);
  assert.deepEqual(Object.keys(options), ['rung_golden_boots', 'rung_diamond_sword', 'nether_first', 'carry_bed']);
  const d = options.carry_bed.description;
  assert.match(d, /three wool and three planks; wool from sheep, or crafted from spiders' string, four string a wool and twelve a bed/);
  assert.match(d, /any night, anywhere: .*the night passes in seconds, instead of about seven real minutes in a pocket or a night mine and the climb out after/);
  assert.match(d, /In hand: 0 wool \(three of one colour make the bed\), 5 string, 8 planks and 0 logs; no sheep in view or remembered/);
  assert.equal(options.carry_bed.fallback, undefined, 'not the ladder\'s default');
  assert.deepEqual(options.carry_bed.rung, { phase: 'carry_bed', action: 'gather_wool', count: 3 }, 'the wool the way the bed rung gathers it');
  // Not with a bed in the pack, nor before the base's bed is claimed, nor with the wool search set aside.
  assert.equal(strategyOptions(homeFixture(['golden_boots', 'diamond_sword'], { items: [{ name: 'red_bed', count: 1 }] }).bot, goal, stage).carry_bed, undefined);
  const unclaimed = homeFixture(['golden_boots', 'diamond_sword']); delete unclaimed.goal.survival.home.bed.claimedAt;
  const first = openRungs(unclaimed.bot, unclaimed.goal)[0];
  assert.equal(first.phase, 'bed', 'the bed rung itself is the ladder\'s');
  assert.equal(strategyOptions(unclaimed.bot, unclaimed.goal, first).carry_bed, undefined);
  setAside(goal, 'bed_search', 'wool', 'ten minutes without finding a sheep', 20 * 60000);
  assert.equal(strategyOptions(bot, goal, stage).carry_bed, undefined);
});

test('the second bed chosen, the ladder step makes it: three wool is a craft, fewer is the wool gathered as for the first bed', async () => {
  const withWool = homeFixture(['golden_boots', 'diamond_sword'], { items: [{ name: 'white_wool', count: 3 }] });
  const said = []; withWool.bot.chat = line => said.push(line);
  const acquired = [];
  await gameStep(withWool.bot, withWool.task, withWool.goal, () => {}, { acquireStep: async (b, t, item, count) => { acquired.push([item, count]); },
    strategy: (b, t, g, sv, stage) => strategyStep(b, t, g, sv, stage, picking('carry_bed')) });
  assert.deepEqual(acquired, [['white_bed', 1]]);
  assert.equal(withWool.goal.gameProgress.phase, 'carry_bed');
  assert.match(said[0], /Before the golden boots, I'll make a second bed to carry\./);
  const without = homeFixture(['golden_boots', 'diamond_sword']);
  const gathered = [];
  await gameStep(without.bot, without.task, without.goal, () => {}, { acquireStep: async () => assert.fail('no wool yet'), gather_wool: async (b, t, g, sv, stage) => { gathered.push(stage.count); },
    strategy: (b, t, g, sv, stage) => strategyStep(b, t, g, sv, stage, picking('carry_bed')) });
  assert.deepEqual(gathered, [3]);
});

test('when every step left before the Nether may wait, going now is offered, and taken the steps are set aside', async () => {
  // mid-110-i: only the arrows left, chosen seventy-three times over three hours, and never the Nether.
  const { isSetAside } = require('../src/progress');
  const { bot, goal, task } = fixture(['arrow']);
  const stage = openRungs(bot, goal)[0];
  assert.equal(stage.phase, 'arrows');
  const options = strategyOptions(bot, goal, stage);
  assert(options.nether_first, 'on offer');
  assert.match(options.nether_first.description, /Leave .*for later and go for the Nether now/);
  assert.match(options.nether_first.description, /Without arrows for now: the bow cannot shoot/);
  assert.match(options.rung_arrows.description, /only from skeletons/);
  const { decide } = picking('nether_first');
  assert.deepEqual(await strategyStep(bot, task, goal, () => {}, stage, { decide }), { ran: true });
  assert(isSetAside(goal, 'rung', 'arrows'), 'the arrows wait');
  assert.equal(openRungs(bot, goal).length, 0, 'nothing on the ladder before the Nether now');
  // Armour may not wait: with it open, no Nether first.
  const armour = fixture(['iron_helmet']);
  assert.equal(strategyOptions(armour.bot, armour.goal, openRungs(armour.bot, armour.goal)[0])?.nether_first, undefined);
});

test('the question says what the Nether waits on, and never that every step comes first', async () => {
  // mid-207-a: told "every step is done before the Nether", it chose the arrows 196 times over three hours beside the Nether-first option.
  const { bot, goal, task } = fixture(['golden_boots', 'diamond_sword']);
  const { asked, decide } = picking('rung_golden_boots');
  await strategyStep(bot, task, goal, () => {}, { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 }, { decide, now: () => 1e12 });
  const state = asked[0].state;
  assert.match(state.beforeTheNether, /Nothing left is needed before the Nether/);
  assert.match(state.beforeTheNether, /May wait until after it: golden boots, diamond sword/);
  assert.doesNotMatch(state.note, /every step is done before the Nether/);
});

test('with the base bed claimed and none carried, taking it along is offered with what it buys and what it moves', () => {
  const { sideTrips } = require('../src/work');
  const { establishedHome } = require('./fixtures/home-world');
  return establishedHome().then(({ bot, goal }) => {
    const trips = sideTrips(bot, goal, null);
    assert(trips.take_home_bed, Object.keys(trips).join(','));
    assert.match(trips.take_home_bed.description, /any night passes in seconds wherever it comes/);
    assert.match(trips.take_home_bed.description, /a death sends it there, not to the base/);
  });
});
