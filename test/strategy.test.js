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
  assert.deepEqual(asked[0].keys, ['rung_golden_boots', 'rung_diamond_sword']);
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
  assert.equal(strategyOptions(bot, goal, stage, sides), null, 'the portal rests, and one rung alone is no choice');
  assert.equal(await strategyStep(bot, task, goal, () => {}, stage, { decide, sides }), null);
  assert.equal(asked.length, 1);
});

test('side trips are offered by day only, and a lone rung is taken without asking', async () => {
  const { bot, goal, task } = fixture(['golden_boots']);
  bot.time.timeOfDay = 14000;
  const sides = { loot: { description: 'Loot the ruined portal.', run: async () => assert.fail('not at night') } };
  const { asked, decide } = picking('loot');
  assert.equal(await strategyStep(bot, task, goal, () => {}, { phase: 'golden_boots' }, { decide, sides }), null);
  assert.equal(asked.length, 0);
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

test('a trip that does not fit in the daylight left is not offered', () => {
  const { bot, goal } = fixture(['golden_boots', 'diamond_sword']);
  const sides = { loot: { description: 'Loot the ruined portal 240 blocks away.', walkBlocks: 240, run: async () => {} } };
  const stage = { phase: 'golden_boots' };
  bot.time.timeOfDay = 3000;
  assert(strategyOptions(bot, goal, stage, sides).loot, 'by morning there is time');
  bot.time.timeOfDay = 9000;
  assert.equal(strategyOptions(bot, goal, stage, sides).loot, undefined, 'twenty-five seconds before dusk there is not');
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
  const planFor = (b, item) => [{ action: 'smelt', item: 'iron_ingot', count: item === 'iron_chestplate' ? 8 : 5 }, { action: 'craft', item, count: 1 }];
  const d = rungOption(armour, false, { entity: { position: { x: 0, y: 0, z: 0 } } }, {}, planFor).description;
  assert.match(d, /get iron armour \(iron helmet, iron chestplate, iron leggings, iron boots\)/);
  assert.match(d, /twenty-four ingots/);
  assert.match(d, /smelt 23 iron ingot, craft 1 iron helmet/);
  assert.match(d, /no gathering/);
  const mining = rungOption(armour, false, { entity: { position: { x: 0, y: 0, z: 0 } } }, {}, () => [{ action: 'mine', item: 'raw_iron', count: 24 }]).description;
  assert.doesNotMatch(mining, /no gathering/);
});
