'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const stash = require('../src/home-stash');
const home = require('../src/home-base');
const { preparationStage, nextGameStage, gameStep } = require('../src/game-progress');
const { stepLine, narrate, MIN_GAP_MS } = require('../src/narration');
const { idleOptions } = require('../src/work');
const { LEVEL, registry, world, establishedHome } = require('./fixtures/home-world');

const stack = (name, count, durabilityUsed = 0) => ({ name, count, type: registry.itemsByName[name].id, stackSize: registry.itemsByName[name].stackSize, durabilityUsed });
const carrying = items => ({ registry, inventory: { items: () => items.map(([n, c, d]) => stack(n, c, d)) } });
const holding = contents => ({ stash: { position: { x: 0, y: 0, z: 0 }, contents } });
const byItem = moves => Object.fromEntries(moves.map(m => [m.item, m.count]));

// A chest the mock bot can open: the container is a list, the window's
// inventory half is the world's stacks, and a slot move is what the server
// would do with two clicks.
function chestAt(w, contents = []) {
  const container = contents.map(([name, count, d]) => stack(name, count, d));
  const window = {
    inventoryStart: 27, inventoryEnd: 63, opened: 0, closed: 0,
    items: () => w.bot.inventory.items().map(i => Object.assign(i, { slot: 27 + w.stacks.indexOf(i) })),
    containerItems: () => container.map((i, n) => Object.assign(i, { slot: n })),
    firstEmptyContainerSlot: () => container.length < 27 ? container.length : null,
    firstEmptyInventorySlot: () => 27 + w.stacks.length,
    deposit: async (type, metadata, count) => { const name = registry.items[type].name; assert(w.stacks.some(i => i.name === name && i.count >= count), `deposit ${count} ${name} carried`); w.take(name, count); const c = container.find(i => i.name === name); if (c) c.count += count; else container.push(stack(name, count)); },
    withdraw: async (type, metadata, count) => { const name = registry.items[type].name; const c = container.find(i => i.name === name); assert(c && c.count >= count, `withdraw ${count} ${name} stored`); c.count -= count; if (!c.count) container.splice(container.indexOf(c), 1); w.give(name, count); },
    close: () => window.closed++,
  };
  w.bot.openContainer = async block => { assert.equal(block.name, 'chest', 'only a chest opens'); window.opened++; return window; };
  w.bot.moveSlotItem = async (from, to) => {
    if (from >= 27) { const item = w.stacks.splice(from - 27, 1)[0]; assert(to < 27, 'a spare goes into the container'); container.push(item); }
    else { const item = container.splice(from, 1)[0]; assert(to >= 27, 'the kit comes into the pockets'); w.stacks.push(item); }
  };
  return { window, container, stored: () => Object.fromEntries(container.map(i => [i.name, (container.filter(j => j.name === i.name).reduce((n, j) => n + j.count, 0))])) };
}

test('the kit is a pickaxe, a sword, logs, stone, cooked food and workstations, with a water bucket only ever as a spare', () => {
  assert.deepEqual(stash.SPARE_KIT.map(s => s.slot), ['pickaxe', 'sword', 'logs', 'cobblestone', 'food', 'crafting_table', 'furnace', 'water_bucket']);
  assert.deepEqual(stash.SPARE_KIT.map(s => s.count), [1, 1, 8, 64, 8, 1, 1, 1]);
  assert(stash.SPARE_KIT.find(s => s.slot === 'water_bucket').optional);
  const bot = carrying([]), slot = name => stash.SPARE_KIT.find(s => s.slot === name);
  assert(stash.slotFits(bot, slot('pickaxe'), 'stone_pickaxe') && stash.slotFits(bot, slot('pickaxe'), 'iron_pickaxe'), 'stone or iron');
  assert(!stash.slotFits(bot, slot('pickaxe'), 'wooden_pickaxe') && !stash.slotFits(bot, slot('pickaxe'), 'iron_sword'), 'not a wooden one, not a sword');
  assert(stash.slotFits(bot, slot('food'), 'cooked_beef') && stash.slotFits(bot, slot('food'), 'bread') && !stash.slotFits(bot, slot('food'), 'rotten_flesh'));
  assert(stash.slotFits(bot, slot('logs'), 'birch_log') && !stash.slotFits(bot, slot('logs'), 'oak_planks'));
  assert(stash.slotFits(bot, slot('water_bucket'), 'water_bucket') && !stash.slotFits(bot, slot('water_bucket'), 'bucket'));
});

test('stocking puts in the spare of each tool, wood and stone beyond what the pockets keep, food beyond the reserve, and nothing the bot needs', () => {
  const bot = carrying([['iron_pickaxe', 1], ['stone_pickaxe', 1], ['iron_sword', 1], ['oak_log', 12], ['cobblestone', 100], ['cooked_beef', 4], ['bread', 2],
    ['crafting_table', 2], ['furnace', 1], ['water_bucket', 1], ['bucket', 1], ['diamond', 3], ['iron_ingot', 10]]);
  const moves = stash.stashDeposits(bot, holding({}));
  assert.deepEqual(byItem(moves), { stone_pickaxe: 1, oak_log: 4, cobblestone: 36, cooked_beef: 3, bread: 1, crafting_table: 1, water_bucket: 1 });
  assert(moves.every(m => m.slot), 'every move names its kit slot');
  // Forty-two food points carried: three steaks and a loaf leave the twelve-point reserve; the iron pickaxe, the only sword and the only furnace stay.
  assert(!moves.some(m => ['iron_pickaxe', 'iron_sword', 'furnace', 'diamond', 'iron_ingot'].includes(m.item)));
  // A chest that already holds a pickaxe wants no second one; a worn tool is not a spare.
  assert(!stash.stashDeposits(bot, holding({ stone_pickaxe: 1 })).some(m => m.item === 'stone_pickaxe'));
  const worn = carrying([['iron_pickaxe', 1, 240], ['stone_pickaxe', 1]]);
  assert.deepEqual(stash.stashDeposits(worn, holding({})), [], 'the iron pickaxe is nearly gone, so the stone one is the one kept');
  // Two sound iron pickaxes: the best is kept, the other goes in.
  assert.deepEqual(byItem(stash.stashDeposits(carrying([['iron_pickaxe', 1, 10], ['iron_pickaxe', 1, 100]]), holding({}))), { iron_pickaxe: 1 });
  // Before the Nether the valuables go in too, but diamonds only once the diamond pickaxe exists.
  const before = stash.stashDeposits(bot, holding({}), { valuables: true });
  assert.deepEqual(byItem(before.filter(m => m.valuable)), { iron_ingot: 2 });
  const withPickaxe = carrying([['diamond_pickaxe', 1], ['diamond', 3], ['gold_ingot', 2], ['iron_ingot', 4]]);
  assert.deepEqual(byItem(stash.stashDeposits(withPickaxe, holding({}), { valuables: true }).filter(m => m.valuable)), { diamond: 3, gold_ingot: 2 });
  assert.deepEqual(stash.stashDeposits(withPickaxe, holding({})).filter(m => m.valuable), [], 'the idle chore leaves the valuables in the pockets');
});

test('the kit comes out when the pockets are short of it, and the rung the chest can answer comes out with it', () => {
  const full = { iron_pickaxe: 1, stone_sword: 1, oak_log: 8, cobblestone: 64, cooked_beef: 8, crafting_table: 1, furnace: 1, water_bucket: 1, diamond: 3 };
  const empty = carrying([]);
  assert.deepEqual(byItem(stash.stashWithdrawals(empty, holding(full))), { iron_pickaxe: 1, stone_sword: 1, oak_log: 8, cobblestone: 64, cooked_beef: 2, crafting_table: 1, furnace: 1, water_bucket: 1 });
  assert(!stash.stashWithdrawals(empty, holding(full)).some(m => m.item === 'diamond'), 'the diamonds stay in the chest until something needs them');
  assert.deepEqual(byItem(stash.stashWithdrawals(empty, holding(full), [{ item: 'diamond', count: 2 }])).diamond, 2);
  // Pockets with thirty cobblestone are not short; ten are.
  assert(!stash.stashWithdrawals(carrying([['cobblestone', 30]]), holding(full)).some(m => m.item === 'cobblestone'));
  assert.equal(byItem(stash.stashWithdrawals(carrying([['cobblestone', 10]]), holding(full))).cobblestone, 54);
  // A rung for an iron pickaxe is answered by the iron pickaxe in the chest, once, and by nothing lesser.
  const stone = carrying([['stone_pickaxe', 1], ['stone_sword', 1], ['oak_log', 8], ['cobblestone', 64], ['cooked_beef', 2], ['crafting_table', 1], ['furnace', 1], ['bucket', 1]]);
  assert.deepEqual(byItem(stash.stashWithdrawals(stone, holding(full), [{ item: 'iron_pickaxe', count: 1 }])), { iron_pickaxe: 1 });
  assert.deepEqual(stash.stashWithdrawals(stone, holding({ stone_pickaxe: 1 }), [{ item: 'iron_pickaxe', count: 1 }]), []);
  assert.deepEqual(byItem(stash.stashWithdrawals(carrying([['oak_log', 8], ['cobblestone', 64], ['cooked_beef', 2], ['crafting_table', 1], ['furnace', 1]]), holding(full), [{ item: 'bucket', count: 1 }])), { iron_pickaxe: 1, stone_sword: 1, water_bucket: 1 });
  // Wants are read off a rung: a tool rung asks for one more than is carried, an armour set asks for each piece.
  assert.deepEqual(stash.rungWants(stone, { action: 'acquire', item: 'stone_pickaxe', count: 2 }), [{ item: 'stone_pickaxe', count: 1 }]);
  assert.deepEqual(stash.rungWants(stone, { action: 'acquire_set', items: ['iron_helmet', 'iron_boots'] }), [{ item: 'iron_helmet', count: 1 }, { item: 'iron_boots', count: 1 }]);
  assert.deepEqual(stash.rungWants(stone, null), []);
});

test('the chest is opened beside the bed, moves are made against its real contents by slot or by type, and the contents are remembered', async () => {
  const w = await establishedHome({ items: [['iron_pickaxe', 1, 50], ['stone_pickaxe', 1], ['oak_log', 12], ['cobblestone', 100], ['cooked_beef', 6], ['crafting_table', 2], ['furnace', 1]] });
  const { bot, goal, task, save, actions } = w;
  const chest = chestAt(w, [['cobblestone', 10]]);
  goal.survival.home.stash.contents = { cobblestone: 40 };  // stale memory: the chest has ten
  const chores = home.homeChores(bot, goal);
  assert.match(chores.stock_stash.description, /Put spares in the stash chest beside the bed \(\d+ blocks away\).*1 stone pickaxe, 4 oak log, 24 cobblestone/);
  assert.match(chores.stock_stash.description, /The chest holds 40 cobblestone/);
  const stored = await chores.stock_stash.run(bot, task, goal, save, actions);
  assert.deepEqual(chest.stored(), { cobblestone: 46, stone_pickaxe: 1, oak_log: 4, cooked_beef: 4, crafting_table: 1 }, 'the real contents decided the moves: all thirty-six spare cobblestone, not twenty-four');
  assert.deepEqual(byItem(stored), { stone_pickaxe: 1, oak_log: 4, cobblestone: 36, cooked_beef: 4, crafting_table: 1 });
  assert.equal(bot.inventory.items().find(i => i.name === 'cobblestone').count, 64, 'a stack of stone stays in the pockets');
  assert.equal(bot.inventory.items().find(i => i.name === 'iron_pickaxe').durabilityUsed, 50, 'the iron pickaxe stayed in hand; the spare went in by slot');
  assert(!bot.inventory.items().some(i => i.name === 'stone_pickaxe'));
  assert.deepEqual(goal.survival.home.stash.contents, chest.stored(), 'remembered as seen when the lid closed');
  assert(goal.survival.home.stash.stockedAt && goal.survival.home.stash.seenAt);
  assert.equal(chest.window.opened, 1); assert.equal(chest.window.closed, 1);
  assert(actions.calls.some(c => c[0] === 'navigate'), 'walked to the chest');
  assert.deepEqual(home.homeChores(bot, goal).stock_stash, undefined, 'nothing left to spare, no chore');
  // A respawn with empty pockets takes the kit back out, by slot for the tool and by type for the rest.
  w.stacks.length = 0;
  const taken = await stash.restockFromStash(bot, task, goal, save, goal.survival.home, actions);
  assert.deepEqual(byItem(taken), { stone_pickaxe: 1, oak_log: 4, cobblestone: 46, cooked_beef: 2, crafting_table: 1 }, 'everything the chest had of the kit, two steaks for the reserve');
  assert.deepEqual(chest.stored(), { cooked_beef: 2 });
  assert.equal(bot.inventory.items().find(i => i.name === 'stone_pickaxe').count, 1);
  assert.deepEqual(goal.survival.home.stash.contents, { cooked_beef: 2 });
  // A chest that is gone is forgotten, and the home rung asks for another.
  w.set(w.layout.chest, 'air');
  await assert.rejects(stash.restockFromStash(bot, task, goal, save, goal.survival.home, actions), /not where it was placed/);
  assert.equal(goal.survival.home.stash.position, undefined); assert.deepEqual(goal.survival.home.stash.contents, {});
  assert.deepEqual(home.homeStage(bot, goal), { phase: 'home_stash', action: 'acquire', item: 'chest', count: 1 });
  assert.equal(goal.survival.home.completedAt, undefined, 'the finished base reopened for the missing chest');
});

test('the ladder restocks from the stash ahead of its rungs, only within reach, and only while the chest has something to give', async () => {
  const w = await establishedHome({ items: [] });
  const { bot, goal, task, save, actions } = w;
  const chest = chestAt(w, [['iron_pickaxe', 1], ['stone_sword', 1], ['oak_log', 8], ['cobblestone', 64], ['bread', 4], ['crafting_table', 1], ['furnace', 1]]);
  assert.equal(preparationStage(bot, goal).phase, 'stone_pickaxe', 'a chest not yet looked in is not counted on');
  goal.survival.home.stash.contents = chest.stored();
  const stage = preparationStage(bot, goal);
  assert.equal(stage.phase, 'home_restock'); assert.equal(stage.action, 'home'); assert.equal(stage.home.action, 'restock');
  assert.deepEqual(stage.home.wants, [{ item: 'stone_pickaxe', count: 1 }]);
  assert.equal(nextGameStage(bot, goal).phase, 'home_restock');
  await gameStep(bot, new Task('win'), goal, save, { home: (b, t, g, s, st) => home.homeStep(b, t, g, s, st, actions) });
  assert.equal(goal.gameProgress.phase, 'home_restock');
  assert.deepEqual(Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count])), { iron_pickaxe: 1, stone_sword: 1, oak_log: 8, cobblestone: 64, bread: 3, crafting_table: 1, furnace: 1 });
  assert.deepEqual(chest.stored(), { bread: 1 });
  assert.equal(preparationStage(bot, goal).phase, 'shield', 'the kit answered the first three rungs; the ladder goes on from the shield');
  // A recent failure at the chest waits ten minutes; beyond reach the chest is not a step at all.
  goal.survival.home.stash.contents = { shield: 1 };
  assert.equal(preparationStage(bot, goal).phase, 'home_restock', 'the shield rung is answered by the chest');
  goal.survival.home.stash.failedAt = new Date().toISOString();
  assert.equal(preparationStage(bot, goal).phase, 'shield');
  delete goal.survival.home.stash.failedAt;
  bot.entity.position = new Vec3(400.5, LEVEL + 1, 0.5);
  assert.equal(preparationStage(bot, goal).phase, 'shield');
  // A failed open marks the chest for later rather than looping on it.
  bot.entity.position = new Vec3(20.5, LEVEL + 1, 0.5);
  bot.openContainer = async () => { throw new Error('lid blocked'); };
  await assert.rejects(home.homeStep(bot, task, goal, save, preparationStage(bot, goal).home, actions), /lid blocked/);
  assert(goal.survival.home.stash.failedAt); assert.equal(preparationStage(bot, goal).phase, 'shield');
});

test('before the Nether the valuables go home once, and the ladder moves on with lighter pockets', async () => {
  const gear = [['iron_pickaxe', 1], ['iron_sword', 1], ['shield', 1], ['water_bucket', 1], ['oak_log', 8], ['cobblestone', 64], ['cooked_beef', 4], ['crafting_table', 1], ['furnace', 1],
    ['iron_helmet', 1], ['iron_chestplate', 1], ['iron_leggings', 1], ['iron_boots', 1], ['golden_boots', 1], ['diamond_pickaxe', 1], ['diamond', 3], ['iron_ingot', 12], ['gold_ingot', 2]];
  const w = await establishedHome({ items: gear });
  const { bot, goal, save, actions } = w;
  const chest = chestAt(w, []);
  assert.equal(nextGameStage(bot, goal).action, 'enter_nether');
  const ran = [];
  const handlers = { stash_valuables: (b, t, g, s) => stash.stashValuables(b, t, g, s, actions), prepare_combat: async () => { ran.push('prepare_combat'); return false; }, enter_nether: async () => { ran.push('enter_nether'); } };
  assert.equal(await gameStep(bot, new Task('win'), goal, save, handlers), false);
  assert.deepEqual(ran, [], 'the stash trip came before the combat check');
  assert.equal(goal.step.action, 'stash_valuables');
  assert.deepEqual(chest.stored(), { diamond: 3, iron_ingot: 4, gold_ingot: 2, iron_pickaxe: 1, cooked_beef: 2 }, 'eight ingots stay for a tool; the rest, the diamonds, and the kit spares while there (the iron pickaxe behind the diamond one, two steaks over the reserve) go in');
  assert(bot.inventory.items().some(i => i.name === 'diamond_pickaxe'), 'the pickaxe is a tool, not a valuable');
  await gameStep(bot, new Task('win'), goal, save, handlers);
  assert.deepEqual(ran, ['prepare_combat'], 'nothing left to stash, the ladder went on');
  assert.equal(chest.window.opened, 1);
  // With no chest, or the base out of reach, the crossing is not delayed.
  bot.entity.position = new Vec3(400.5, LEVEL + 1, 0.5); w.give('diamond', 2);
  assert.equal(await stash.stashValuables(bot, new Task('win'), goal, save, actions), true);
  bot.entity.position = new Vec3(20.5, LEVEL + 1, 0.5);
  assert.equal(await stash.stashValuables(bot, new Task('win'), { ...goal, survival: { home: null } }, save, actions), true);
});

test('the idle loop offers stocking the stash beside the farm chores, and each stash phase has one line said once', async () => {
  const w = await establishedHome({ items: [['stone_pickaxe', 1], ['stone_pickaxe', 1], ['oak_log', 20]] });
  const options = idleOptions(w.bot, { ...w.goal, kind: 'survive' });
  assert.match(options.stock_stash.description, /1 stone pickaxe, 8 oak log/, 'the chest holds eight logs, whatever the pockets can spare');
  for (const [step, pattern] of [[{ action: 'place_chest' }, /chest beside the bed/], [{ action: 'stock_stash' }, /Stocking the stash chest/], [{ action: 'restock' }, /spare kit out of the stash/],
    [{ action: 'stash_valuables' }, /valuables in the stash chest before the Nether/], [{ action: 'idle', choice: 'stock_stash' }, /stock the stash chest/], [{ action: 'game_progression', phase: 'home_restock' }, /home restock/]]) {
    assert.match(stepLine({}, step), pattern);
  }
  const said = [], bot = { chat: line => said.push(line) };
  const goal = { kind: 'win', step: { action: 'restock', items: [{ item: 'iron_pickaxe', count: 1 }] } };
  let now = 1000;
  assert.equal(narrate(bot, goal, { now }), 'Taking my spare kit out of the stash chest.');
  goal.step = { action: 'restock', items: [{ item: 'oak_log', count: 8 }] };
  assert.equal(narrate(bot, goal, { now: now += MIN_GAP_MS }), null, 'the same phase with different items is not said again');
  goal.step = { action: 'stock_stash', items: [] };
  assert.equal(narrate(bot, goal, { now: now += MIN_GAP_MS }), 'Stocking the stash chest with spares.');
  goal.step = { action: 'stock_stash', items: [{ item: 'bread', count: 2 }] };
  assert.equal(narrate(bot, goal, { now: now += MIN_GAP_MS }), null);
  assert.equal(said.length, 2);
});
