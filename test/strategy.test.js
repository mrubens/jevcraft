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
const picking = choice => { const asked = []; return { asked, decide: async (id, args) => { asked.push({ id, keys: Object.keys(args.tree), tree: args.tree, state: args.state }); return { path: [choice] }; } }; };

test('the open rungs are the ladder\'s next and each one after it that may wait; armour closes the list', () => {
  let { bot, goal } = fixture(['golden_boots', 'diamond_sword']);
  assert.deepEqual(openRungs(bot, goal).map(r => r.phase), ['golden_boots', 'diamond_sword']);
  ({ bot, goal } = fixture(['iron_helmet', 'golden_boots']));
  assert.deepEqual(openRungs(bot, goal).map(r => r.phase), ['iron_helmet', 'golden_boots'], 'armour may wait too, so the steps after it are on offer');
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
  // The Nether is not a ladder step: a stage past the preparation ladder
  // alone is no choice.
  const { bot: b2, goal: g2, task: t2 } = fixture([]);
  b2.time.timeOfDay = 14000;
  const lone = picking('loot');
  assert.equal(await strategyStep(b2, t2, g2, () => {}, { phase: 'enter_nether', action: 'enter_nether' }, { decide: lone.decide, sides: {} }), null);
  assert.equal(lone.asked.length, 0, 'a lone step is not asked about');
});

test('with no client the tests\' stand-in takes the ladder\'s next, through the registry', async () => {
  const { bot, goal, task } = fixture(['golden_boots', 'diamond_sword']);
  const stage = { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 };
  const sides = { enchant: { description: 'Enchant the diamond sword.', run: async () => assert.fail('the stand-in takes the ladder') } };
  assert.equal(await strategyStep(bot, task, goal, () => {}, stage, { client: null, decide, sides }), null);
  assert.equal(goal.strategy.choice, 'rung_golden_boots'); assert.equal(goal.strategy.source, 'stand-in');
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
  assert.match(d, /^Get iron armour \(iron helmet, iron chestplate, iron leggings, iron boots\)/);
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
  assert.match(d, /about 71 blocks under the surface: when the last pickaxe breaks, none can be made down here, and the way up is dug by hand \(stone comes away by hand at about 7\.5 s a block, dropping nothing: a staircase climbs about 2\.5 blocks a minute by hand, straight up about 7\.1\), about 28 minutes by stairs/);
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
  assert.match(d, /any night on the Overworld, anywhere there .*the night passes in seconds, instead of about eleven real minutes in a pocket or a night mine and the climb out after/);
  assert.match(d, /In hand: 0 wool \(three of one colour make the bed; wool of mixed colours is dyed white, a bone's bone meal for three\), 5 string, 8 planks and 0 logs; no sheep in view or remembered/);
  assert.equal(options.carry_bed.ladderNext, undefined, 'not the ladder\'s default');
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
  assert.deepEqual(await strategyStep(bot, task, goal, () => {}, stage, { decide }), { replan: true }, 'setting steps aside is not work: the ladder is read again at once');
  assert(isSetAside(goal, 'rung', 'arrows'), 'the arrows wait');
  assert.equal(openRungs(bot, goal).length, 0, 'nothing on the ladder before the Nether now');
  // mid-241-a: the arrows came straight back as the only step, and the Nether first never happened.
  const { nextGameStage } = require('../src/game-progress');
  assert.notEqual(nextGameStage(bot, goal)?.phase, 'arrows', 'the next stage is not the arrows again');
  // Armour may wait too (the scoreboard, 2026-09-26): with it open, the Nether first is offered.
  const armour = fixture(['iron_helmet']);
  assert(strategyOptions(armour.bot, armour.goal, openRungs(armour.bot, armour.goal)[0])?.nether_first);
});

test('the Nether first moves the ladder on to the Nether at once, and is not offered again while its steps rest', async () => {
  // mid-242-x: the kit's go-on left the iron boots resting for another reason, so the ladder handed back the bow and the
  // diamond sword it had just left; the Nether first was chosen five times a second as a strategy_side step that never
  // progressed, and failed on "no measurable progress" (note 498).
  const { setAside } = require('../src/progress');
  const { nextGameStage } = require('../src/game-progress');
  const { bot, goal, task } = fixture(['bow', 'diamond_sword']);
  bot.time.timeOfDay = 17617; // night: the bow is the ladder's next
  setAside(goal, 'rung', 'iron_boots', 'Jev chose to fight with what is carried', 1800000);
  assert.equal(nextGameStage(bot, goal).phase, 'bow');
  const entered = [], trees = [];
  const pick = choice => (b, t, g, sv, stage) => strategyStep(b, t, g, sv, stage, { decide: async (id, args) => { trees.push(args); return { path: [choice] }; } });
  const actions = { acquireStep: async (b, t, item) => assert.fail(`${item} was set aside for the Nether`), enter_nether: async () => { entered.push(goal.step.phase); } };
  assert.equal(await gameStep(bot, task, goal, () => {}, { ...actions, strategy: pick('nether_first') }), false);
  assert.deepEqual(entered, ['reach_nether'], 'on to the Nether in the same step');
  assert.deepEqual([goal.step.phase, goal.step.action], ['reach_nether', 'enter_nether'], 'the step is the Nether, not a strategy_side left to stall on');
  const stage = nextGameStage(bot, goal);
  assert.equal(stage.phase, 'reach_nether', 'the steps left for the Nether are not handed back');
  const options = strategyOptions(bot, goal, stage, {});
  assert.equal(options.nether_first, undefined, 'a Nether first that would set nothing aside is not offered');
  assert.deepEqual(Object.keys(options), ['stage_reach_nether', 'take_up_bow', 'take_up_diamond_sword'], 'each step set aside is a route of its own');
  assert.match(options.take_up_bow.description, /Take up the bow now after all, before the Nether: it was set aside to go without it, and would come back on its own in 30 minutes/);
  // The question says so as a fact, and a step taken up is the ladder's again.
  const acquired = [];
  await gameStep(bot, task, goal, () => {}, { ...actions, acquireStep: async (b, t, item) => { acquired.push(item); }, strategy: pick('take_up_bow') });
  assert.match(trees.at(-1).state.beforeTheNether, /Set aside by choice, to go without for now: bow \(30 minutes more\), diamond sword \(30 minutes more\)/);
  assert.deepEqual(acquired, ['bow']);
  assert.equal(nextGameStage(bot, goal).phase, 'bow');
});

test('the question says what the Nether waits on, and never that every step comes first', async () => {
  // mid-207-a: told "every step is done before the Nether", it chose the arrows 196 times over three hours beside the Nether-first option.
  const { bot, goal, task } = fixture(['golden_boots', 'diamond_sword']);
  bot.registry = require('minecraft-data')('26.1'); bot.game.difficulty = 'normal';
  const { asked, decide } = picking('rung_golden_boots');
  await strategyStep(bot, task, goal, () => {}, { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 }, { decide, now: () => 1e12 });
  const state = asked[0].state;
  assert.match(state.beforeTheNether, /Nothing left is needed before the Nether/);
  assert.match(state.beforeTheNether, /May wait until after it: golden boots, diamond sword/);
  // And the kit for the crossing, which had been gates at the portal said nowhere (the decision review, 2026-09-26).
  assert.match(state.beforeTheNether, /At the portal the kit is said and topping any of it up is a choice, not a wait: short now of 0 of 80 food points; 0 of 128 blocks; 1 of 2 pickaxes; a piece of gold to wear \(piglins go for a player with none\); 0 of 8 logs and no crafting table\./);
  // The kit is rungs last before the portal now, said as that and not as waiting until after the Nether (note 673).
  assert.match(state.beforeTheNether, /The crossing's kit, last before the portal, each of which may be gone without: a spare pickaxe for the Nether, blocks for bridging and pillaring in the Nether, food carried for the Nether stay, a chest to leave the blaze rods in at the fortress\./);
  assert.doesNotMatch(state.beforeTheNether, /May wait until after it: [^.]*nether/);
  assert.match(asked[0].tree.nether_first.description, /short now of 0 of 80 food points/);
  assert.doesNotMatch(state.note, /every step is done before the Nether/);
});

test('with the base bed claimed and none carried, taking it along is offered with what it buys and what it moves', () => {
  const { sideTrips } = require('../src/work');
  const { establishedHome } = require('./fixtures/home-world');
  return establishedHome().then(({ bot, goal }) => {
    const trips = sideTrips(bot, goal, null);
    assert(trips.take_home_bed, Object.keys(trips).join(','));
    assert.match(trips.take_home_bed.description, /a night on the Overworld passes in seconds wherever it comes/);
    assert.match(trips.take_home_bed.description, /a death sends it there, not to the base/);
  });
});

test('with only armour and other steps that may wait left, the Nether first is offered with what the Nether\'s mobs take without it', () => {
  // The scoreboard: twenty-four ingots of armour were a quarter of the time before the Nether.
  const { bot, goal } = fixture(['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']);
  bot.inventory.slots = {};
  const stage = { phase: 'iron_helmet', action: 'acquire', item: 'iron_helmet', count: 1 };
  const options = strategyOptions(bot, goal, stage, {});
  assert(options.nether_first, Object.keys(options).join(','));
  assert.match(options.nether_first.description, /Without iron armour for now: every hit lands on what is worn now \(nothing, 0 armour points\): a blaze's fireball about 5/);
  assert.match(options.nether_first.description, /full iron would take about \d/);
});

test('a step that may wait, back on the ladder after its time ran out, has the Nether first beside it', () => {
  // mid-237-c: handed the diamond sword alone forty-eight times, no way to the Nether before it.
  const { setAside } = require('../src/progress');
  const { bot, goal } = fixture(['diamond_sword']);
  setAside(goal, 'rung', 'diamond_sword', 'twenty minutes without finishing', 1800000);
  const stage = { phase: 'diamond_sword', action: 'acquire', item: 'diamond_sword', count: 1 };
  const options = strategyOptions(bot, goal, stage, {});
  assert(options.stage_diamond_sword, Object.keys(options).join(','));
  assert(options.nether_first, 'the Nether first beside it');
  assert.match(options.nether_first.description, /Leave diamond sword for later and go for the Nether now/);
});

test('taking the base bed along is not offered when no bed stands there', () => {
  // mid-244-b: offered with none there, chosen, and nothing found five times.
  const { sideTrips } = require('../src/work');
  const { establishedHome } = require('./fixtures/home-world');
  return establishedHome().then(w => {
    w.set(w.layout.bed.foot, 'air'); w.set(w.layout.bed.head, 'air');
    assert.equal(sideTrips(w.bot, w.goal, null).take_home_bed, undefined);
  });
});

// The critical review (2026-09-26): win_strategy was fifteen to twenty-five
// options in one list, the first labelled "the ladder's next step" and the
// rest "ahead of the ladder's order", re-asked whenever a biome came into
// view, with every description in the state a second time.
const trips = { loot: { description: 'Loot: walk 120 blocks to the ruined portal and open its chests.', says: 'I\'ll loot the ruined portal 120 blocks away', run: async () => {} },
  trade: { description: 'Trade at the remembered village 90 blocks away.', says: 'I\'ll go trade at the village', run: async () => {} } };
const treeOf = () => { const asked = []; return { asked, decide: async (id, args) => { asked.push(args); return { path: ['rung_golden_boots'] }; } }; };

test('the question\'s top level is the rungs, the Nether now and one side trip; the trips are its children, each with its facts', async () => {
  const { bot, goal, task } = fixture(['golden_boots', 'diamond_sword']);
  const { asked, decide } = treeOf();
  await strategyStep(bot, task, goal, () => {}, { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 }, { decide, sides: trips, now: () => 1e12 });
  const { tree } = asked[0];
  assert.deepEqual(Object.keys(tree), ['rung_golden_boots', 'rung_diamond_sword', 'nether_first', 'side_trip']);
  assert.deepEqual(Object.keys(tree.side_trip.children), ['loot', 'trade']);
  assert.equal(tree.side_trip.children.loot.description, trips.loot.description, 'the trip\'s facts on its own question');
  assert.match(tree.side_trip.description, /one of 2: loot the ruined portal 120 blocks away; go trade at the village/);
  // With one trip, the branch says all of it.
  const lone = treeOf();
  await strategyStep(bot, task, { ...goal, strategy: undefined }, () => {}, { phase: 'golden_boots' }, { decide: lone.decide, sides: { loot: trips.loot }, now: () => 1e12 });
  assert.match(lone.asked[0].tree.side_trip.description, /Loot: walk 120 blocks to the ruined portal and open its chests\./);
  // The registry takes the tree: every key is declared at its level.
  const { question } = require('../src/decisions');
  const levels = Object.fromEntries(question('win_strategy').options.map(o => [o.key || o.pattern, o.level]));
  assert.equal(levels.side_trip, 'root'); assert.equal(levels.loot, 'side_trip'); assert.equal(levels.home_base, 'side_trip'); assert.equal(levels.carry_bed, 'side_trip');
});

test('the rungs are said alike, none as the ladder\'s own; the first is still the fallback', () => {
  const { bot, goal } = fixture(['golden_boots', 'diamond_sword']);
  const options = strategyOptions(bot, goal, { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 });
  for (const key of ['rung_golden_boots', 'rung_diamond_sword']) {
    assert.match(options[key].description, /^Get /, key);
    assert.doesNotMatch(options[key].description, /ladder/, key);
  }
  assert.equal(options.rung_golden_boots.ladderNext, true);
  assert(!options.rung_diamond_sword.ladderNext);
  const f = fixture([]);
  const later = strategyOptions(f.bot, f.goal, { phase: 'obtain_ender_pearls', action: 'pearl_patrol', item: 'ender_pearl', count: 12 }, trips);
  assert.doesNotMatch(later.stage_obtain_ender_pearls.description, /ladder/);
});

test('a trip coming into view beside the others does not re-ask, nor one going that was not chosen; the state does not repeat the options', async () => {
  const { bot, goal, task } = fixture(['golden_boots', 'diamond_sword']);
  const { asked, decide } = treeOf();
  const stage = { phase: 'golden_boots', action: 'acquire', item: 'golden_boots', count: 1 };
  let now = 1e12;
  await strategyStep(bot, task, goal, () => {}, stage, { decide, sides: { loot: trips.loot }, now: () => now });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].state.options, undefined, 'each description is in its question once');
  assert.doesNotMatch(JSON.stringify(asked[0].state), /Loot: walk 120 blocks/);
  now += 60000;
  await strategyStep(bot, task, goal, () => {}, stage, { decide, sides: trips, now: () => now });
  assert.equal(asked.length, 1, 'the village came into view among the trips: held');
  now += 60000;
  await strategyStep(bot, task, goal, () => {}, stage, { decide, sides: {}, now: () => now });
  assert.equal(asked.length, 1, 'no side trip left: an option gone that was not chosen, the answer holds over fewer (note 709)');
});

test('a base begun in an older world is offered from where it stopped, and chosen it holds as a rung, a step at a time', async () => {
  const { bot, goal, task } = homeFixture(['golden_boots', 'diamond_sword']);
  const h = goal.survival.home; delete h.completedAt; delete h.bed.claimedAt;
  const stage = openRungs(bot, goal)[0];
  assert.equal(stage.phase, 'bed', 'the base\'s step is not on the ladder; the bed rung is');
  goal.rungClocks = { home_level: { activeMs: 7 * 60000, lastAt: 0 } };
  const options = strategyOptions(bot, goal, stage);
  assert(options.home_base, Object.keys(options).join(','));
  assert.match(options.home_base.description, /the base at 400, 0, begun; left, in order: a chest by the bed \(eight planks\); the bed placed there and slept in/);
  assert.match(options.home_base.description, /Worked on for 7 minutes so far/);
  assert.equal(options.home_base.rung.action, 'home');
  const { asked, decide } = picking('home_base');
  const said = []; bot.chat = line => said.push(line);
  const chosen = await strategyStep(bot, task, goal, () => {}, stage, { decide, now: () => 1e12 });
  assert.equal(chosen.stage.phase, options.home_base.rung.phase);
  assert.equal(chosen.stage.action, 'home');
  assert.match(said[0], /I'll work on the base/);
  await strategyStep(bot, task, goal, () => {}, stage, { decide, now: () => 1e12 + 60000 });
  assert.equal(asked.length, 1, 'held like a rung');
});

test('the bed is weighed with what a night costs without one', () => {
  // Nights were 62 of mid-211-o's 180 minutes and the most of mid-230-o's (2026-09-27).
  const { RUNG_WHY, WITHOUT } = require('../src/strategy');
  assert.match(RUNG_WHY.bed, /eight and a half real minutes .* an hour of play has three nights/);
  assert.match(WITHOUT.bed, /eight and a half to eleven real minutes a night and three nights to an hour of play/);
});

test('a wool search left off long ago is not said as one going on for hours', () => {
  // A search carried from the first days' world said "searching for sheep for 1033 minutes" to a run an hour old (2026-09-27).
  const { rungOption } = require('../src/strategy');
  const { Vec3 } = require('vec3');
  const bot = { entity: { position: new Vec3(0, 64, 0) }, inventory: { items: () => [] }, game: { dimension: 'overworld' } };
  const goal = { woolSearch: { since: Date.now() - 1033 * 60000, from: { x: 0, y: 64, z: 0 } }, sightings: [] };
  const says = JSON.stringify(rungOption({ phase: 'bed', action: 'gather_wool', item: 'white_bed' }, true, bot, goal, null));
  assert.doesNotMatch(says, /1033 minutes/);
});

// Note 644: eight of 2026-09-28's 23 deaths before the Nether were on the
// wool hunt, six in its first ten minutes, from saves 60 blocks under the
// surface. "Get bed" said what a bed is worth and nothing of the way to the
// sheep: how far, whether any was seen, the climb out, the night, and what
// the day's hunts from that depth came to.
test('the bed rung says the way to the wool: none seen, the climb from 71 blocks down, the night above, and what hunts from that depth came to (note 644)', () => {
  const { rungOption } = require('../src/strategy');
  const bot = caveBot([['iron_pickaxe', 1]]);
  bot.time = { timeOfDay: 14000 };
  const d = rungOption({ phase: 'bed', action: 'gather_wool', count: 3 }, true, bot, {}).description;
  assert.match(d, /The way to the wool: No sheep are in view or remembered: the hunt is a search over ground not yet seen\./);
  assert.match(d, /The bot is about 71 blocks under open sky: the climb out is about 4 minutes before any walk to sheep, through what the caves hold\./);
  assert.match(d, /It is night on the surface, about 8 real minutes to dawn: sheep stand on open ground, where zombies, skeletons, spiders and creepers spawn until then\./);
  assert.match(d, /Wool hunts begun below y 40, as this one is: 29 in 2026-09-28's 62 fresh worlds, 5 ended in a death, 8\.4 minutes each on average; begun at or above it: 20, 1 ended in a death, 3\.6 minutes\./);
});

test('on the surface the wool hunt names the nearest flock known and how long the walk is; no depth or night is said by day (note 644)', () => {
  const { rungOption } = require('../src/strategy');
  const bot = { entity: { position: new Vec3(0, 70, 0) }, game: { dimension: 'overworld' }, entities: {}, inventory: { items: () => [] }, time: { timeOfDay: 3000 } };
  const goal = { sightings: { sheep: [{ x: 100, y: 68, z: 0, count: 3, at: Date.now() - 2 * 60000, dimension: 'overworld' }] } };
  const d = rungOption({ phase: 'bed', action: 'gather_wool', count: 3 }, true, bot, goal).description;
  assert.match(d, /Nearest sheep known: 3 sheep seen 2 minutes ago, 100 blocks east \(100, 0\) \(about 25 seconds at a walk\)\./);
  assert.doesNotMatch(d, /under open sky|It is night/);
  assert.match(d, /Wool hunts begun at or above y 40, as this one is: 20 in 2026-09-28's 62 fresh worlds, 1 ended in a death, 3\.6 minutes each on average; begun below it: 29, 5 ended in a death, 8\.4 minutes\./);
  const view = { ...bot, entities: { 1: { id: 1, name: 'sheep', isValid: true, position: new Vec3(12, 70, 0) } } };
  assert.match(rungOption({ phase: 'bed', action: 'gather_wool', count: 3 }, true, view, goal).description, /Sheep are in view, 12 blocks off \(about 3 seconds at a walk\)\./);
});

test('the way to the wool is said for the wool hunt alone: not for another rung, not in the Nether, not for a bed already in wool (note 644)', () => {
  const { rungOption, woolTrip } = require('../src/strategy');
  const bot = { entity: { position: new Vec3(0, 70, 0) }, game: { dimension: 'overworld' }, entities: {}, inventory: { items: () => [] } };
  assert.doesNotMatch(rungOption({ phase: 'iron_pickaxe', action: 'acquire', item: 'iron_pickaxe', count: 1 }, true, bot, {}).description, /The way to the wool/);
  assert.doesNotMatch(rungOption({ phase: 'bed', action: 'acquire', item: 'white_bed', count: 1 }, true, bot, {}).description, /The way to the wool/);
  assert.equal(woolTrip({ ...bot, game: { dimension: 'the_nether' } }, {}, { action: 'gather_wool' }), '');
});
