'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { pickaxeBudget } = require('../src/pickaxe-budget');
const { Task } = require('../src/skills');

// Stone below y 63, air above, the bot's own two cells open.
function mine({ y = 31, items, ores = [] } = {}) {
  const blocks = new Map();
  const bot = { game: { gameMode: 'survival', dimension: 'overworld', minY: -64, height: 384 }, time: { timeOfDay: 3000 }, registry,
    entity: { isInWater: false, position: new Vec3(0.5, y, 0.5) }, health: 20, food: 20, entities: {},
    pathfinder: { movements: {} }, inventory: { items: () => items, slots: [] }, findBlocks: () => ores.map(o => o.p) };
  for (const o of ores) blocks.set(`${o.p}`, o.name);
  blocks.set(`${new Vec3(0, y, 0)}`, 'air'); blocks.set(`${new Vec3(0, y + 1, 0)}`, 'air');
  bot.blockAt = p => {
    const name = blocks.get(`${p}`) || (p.y < 63 ? 'stone' : 'air');
    return { name, type: registry.blocksByName[name]?.id, position: p, diggable: true, digTime: () => 50, boundingBox: ['air', 'water', 'lava'].includes(name) ? 'empty' : 'block' };
  };
  return { bot, blocks };
}

test('the uses carried are said against the step in hand and the way home after it, with what the pockets make (mid-231-r, note 543)', () => {
  // mid-231-r at 22:19: 226 uses of iron pickaxe, no log, plank or stick, a staircase set toward lava 42 blocks
  // down; the step and the climb back were far more digs than that, and the last pickaxe broke on the way up.
  const { bot } = mine({ items: [{ name: 'iron_pickaxe', count: 1, durabilityUsed: 24 }, { name: 'cobblestone', count: 64 }] });
  const goal = { kind: 'win', step: { action: 'tunnel', target: { x: 27, y: -11, z: -23 }, toward: 'lava_for_portal' } };
  const b = pickaxeBudget(bot, goal);
  assert.equal(b.usesLeft, 226);
  assert.equal(b.up, 32, 'open sky 32 blocks over the bot');
  assert.equal(b.ahead.digs, 126, 'three a stair for 42 blocks down, the way across within the stairs');
  assert.equal(b.home.up, 74, 'home from the lava, not from here');
  assert(b.short);
  assert.match(b.says, /Pickaxes carried: iron pickaxe \(226 uses left\)\./);
  assert.match(b.says, /The step in hand digs up to about 126 blocks on the way to 27, -11, -23 \(lava for portal\) if it is all rock\./);
  assert.match(b.says, /The way home from there is 74 blocks up to open sky: about 74 digs straight up the column, 222 by stairs\./);
  assert.match(b.says, /That is 122 more digs than the uses carried: the last 122 by hand/);
  assert.match(b.says, /No other pickaxe can be made from the pockets: no sticks can be made/);
  assert.match(b.says, /No wood carried, and none known; open sky is 32 blocks up from here\./);
  // Wood remembered is said with where it is.
  goal.resourceMemory = { 'overworld:40,70,0': { name: 'birch_log', position: { x: 40, y: 70, z: 0 }, dimension: 'overworld', seenAt: Date.now() } };
  assert.match(pickaxeBudget(bot, goal).says, /No wood carried; the nearest wood known is birch log 56 blocks off, 39 up \(seen earlier\)\./);
});

test('with the uses short of the step and the way home, a spare is offered at upkeep though no pickaxe is nearly worn, and a carry-on from before does not hold it back (note 543)', async () => {
  const { upkeepStep } = require('../src/work');
  const asked = [];
  const client = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'carry_on', confidence: 0.7 } } }; } };
  const items = [{ name: 'iron_pickaxe', count: 1, durabilityUsed: 24 }, { name: 'cobblestone', count: 64 }, { name: 'stick', count: 2 }, { name: 'crafting_table', count: 1 }];
  const { bot } = mine({ items });
  // Carried on from the wood, not short then: held five minutes.
  const goal = { kind: 'win', step: { action: 'mine', block: 'iron_ore' }, upkeepHold: { keys: 'wood_reserve', until: Date.now() + 300000 } };
  assert.equal(await upkeepStep(bot, new Task('win'), goal, () => {}, client), false);
  assert.equal(asked.length, 0, 'the hold stands while the uses cover the work');
  goal.step = { action: 'tunnel', target: { x: 27, y: -11, z: -23 } };
  assert.equal(await upkeepStep(bot, new Task('win'), goal, () => {}, client), false);
  assert.equal(asked.length, 1, 'fallen short: asked anew');
  assert.deepEqual(Object.keys(asked[0]).sort(), ['carry_on', 'spare_pickaxe', 'wood_reserve']);
  assert.match(asked[0].spare_pickaxe, /^Make a stone pickaxe now, a spare, and one that breaks deep in a mine/);
  assert.match(asked[0].spare_pickaxe, /That is 122 more digs than the uses carried/);
  assert.match(asked[0].spare_pickaxe, /The pockets make 1 more pickaxe \(stone pickaxe\)\./);
  assert.match(asked[0].wood_reserve, /The way home from there is 74 blocks up/);
  assert.match(asked[0].carry_on, /The pickaxes carried then run 122 digs short of the step in hand and the way home, the rest dug by hand\./);
});

test('a climb nobody chose does not hold: with somewhere else to go it is asked (mid-220-h, note 543)', async () => {
  // A climb made because nothing else was on offer had been kept as "chosen" for as long as a surface return stood.
  const { explore } = require('../src/work');
  const items = [{ name: 'iron_pickaxe', count: 1, durabilityUsed: 201 }, { name: 'stone_pickaxe', count: 1 }, { name: 'iron_sword', count: 1 },
    { name: 'white_bed', count: 1 }, { name: 'cobblestone', count: 64 }, { name: 'iron_ingot', count: 15 }, { name: 'crafting_table', count: 1 }];
  const { bot } = mine({ y: 40, items });
  const goal = { kind: 'win', gameProgress: { phase: 'iron_pickaxe', milestones: {} },
    surfaceTrip: { need: 'wood (any log)', pick: 'climb', at: new Date().toISOString() }, surfaceReturn: { attempts: 0, visited: {} } };
  const task = new Task('win');
  const asked = [];
  task.opportunityClient = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'stay_below', confidence: 0.9 } } }; } };
  bot.chat = () => {};
  await explore(bot, task, goal, () => {}, 'spruce_log');
  assert.equal(asked.length, 1, 'asked, not climbed');
  assert(asked[0].stay_below);
  assert.equal(goal.step.action, 'stay_below');
});

test('underground with every rung after wanting the same climb, the ore in view is offered first with the uses the climb leaves spare (note 543)', async () => {
  const { explore } = require('../src/work');
  const items = [{ name: 'iron_pickaxe', count: 1, durabilityUsed: 201 }, { name: 'stone_pickaxe', count: 1 }, { name: 'iron_sword', count: 1 },
    { name: 'white_bed', count: 1 }, { name: 'cobblestone', count: 64 }, { name: 'iron_ingot', count: 15 }];
  const { bot, blocks } = mine({ y: 40, items, ores: [{ p: new Vec3(3, 40, 0), name: 'iron_ore' }] });
  const goal = { kind: 'win', gameProgress: { phase: 'iron_pickaxe', milestones: {} } };
  const task = new Task('win');
  const asked = [];
  task.opportunityClient = { systemOne: async ({ questions }) => { asked.push(questions.branch_0.criteria); return { answers: { branch_0: { choice: 'mine_first', confidence: 0.9 } } }; } };
  const dug = [];
  Object.assign(bot, { canDigBlock: () => true, dig: async b => { dug.push(`${b.position}`); blocks.set(`${b.position}`, 'air'); }, equip: async () => {}, heldItem: null, chat: () => {} });
  await explore(bot, task, goal, () => {}, 'spruce_log');
  assert.equal(asked.length, 1);
  assert.deepEqual(Object.keys(asked[0]).filter(k => k !== 'none_good').sort(), ['climb', 'mine_first'], 'no rung to stay below for: each wants a log first');
  assert.match(asked[0].mine_first, /^Dig the iron ore 3 blocks off first, then climb: the pickaxes have 180 uses and the climb's quicker way digs about 21, so 159 are spare for ore down here/);
  assert.deepEqual(dug, ['(3, 40, 0)'], 'the ore dug, no stair');
  assert.equal(goal.step.action, 'mine_first');
  assert.equal(goal.surfaceTrip.pick, 'mine_first');
});

test('a pickaxe rung with a pickaxe still carried is said as a spare, with what the uses carried cover (note 543)', () => {
  const { rungOption } = require('../src/strategy');
  const { bot } = mine({ items: [{ name: 'iron_pickaxe', count: 1, durabilityUsed: 238 }, { name: 'oak_planks', count: 1 }] });
  const o = rungOption({ phase: 'stone_pickaxe', action: 'acquire', item: 'stone_pickaxe', count: 1 }, true, bot, { kind: 'win' });
  assert.match(o.description, /A spare: the ladder counts a pickaxe under a fifth of its uses \(or 64\) as worn\. Pickaxes carried: iron pickaxe \(12 uses left\)\. The way home from here is 32 blocks up/);
});
