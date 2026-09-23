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
    get slots() { const all = Array(63).fill(null); container.forEach((c, n) => { all[n] = c; }); return all; },
  };
  w.bot.openContainer = async block => { assert.equal(block.name, 'chest', 'only a chest opens'); window.opened++; return window; };
  w.bot.moveSlotItem = async (from, to) => {
    if (from >= 27) { const item = w.stacks.splice(from - 27, 1)[0]; assert(to < 27, 'a spare goes into the container'); container.push(item); }
    else { const item = container.splice(from, 1)[0]; assert(to >= 27, 'the kit comes into the pockets'); w.stacks.push(item); }
  };
  return { window, container, stored: () => Object.fromEntries(container.map(i => [i.name, (container.filter(j => j.name === i.name).reduce((n, j) => n + j.count, 0))])) };
}

test('the kit is a pickaxe, a sword, logs, stone, cooked food and workstations, with a water bucket only ever as a spare', () => {
  assert.deepEqual(stash.SPARE_KIT.map(s => s.slot), ['pickaxe', 'sword', 'logs', 'cobblestone', 'food', 'crafting_table', 'furnace', 'bed', 'water_bucket']);
  assert.deepEqual(stash.SPARE_KIT.map(s => s.count), [1, 1, 8, 64, 8, 1, 1, 1, 1]);
  assert(stash.SPARE_KIT.find(s => s.slot === 'water_bucket').optional);
  const bot = carrying([]), slot = name => stash.SPARE_KIT.find(s => s.slot === name);
  assert(stash.slotFits(bot, slot('bed'), 'red_bed') && !stash.slotFits(bot, slot('bed'), 'white_wool'), 'a bed of any colour for the road');
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
  assert.deepEqual(byItem(moves), { stone_pickaxe: 1, oak_log: 4, cobblestone: 36, cooked_beef: 3, bread: 1, crafting_table: 1, water_bucket: 1, iron_ingot: 2 });
  assert(moves.every(m => m.slot || m.keepsake), 'every move names its kit slot or its keepsake');
  assert.deepEqual(moves.find(m => m.item === 'iron_ingot'), { item: 'iron_ingot', count: 2, keepsake: 'iron' }, 'two ingots over the eight a tool needs are a keepsake');
  // Forty-two food points carried: three steaks and a loaf leave the twelve-point reserve; the iron pickaxe, the only sword and the only furnace stay.
  assert(!moves.some(m => ['iron_pickaxe', 'iron_sword', 'furnace', 'diamond'].includes(m.item)));
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
  assert.deepEqual(byItem(stash.stashDeposits(withPickaxe, holding({}))), { diamond: 3 }, 'the idle chore puts the diamonds away as a keepsake; the two ingots of gold stay for the boots');
  assert.deepEqual(stash.stashDeposits(withPickaxe, holding({})).filter(m => m.valuable), [], 'the idle chore marks no valuables trip');
});

test('keepsakes go in over what the pockets keep, never twice, and the surplus tidy leaves them alone', () => {
  const { SURPLUS } = require('../src/inventory-tidy');
  const bot = carrying([['white_wool', 5], ['black_wool', 2], ['string', 4], ['feather', 6], ['bone', 3], ['bone_meal', 2], ['gunpowder', 1], ['arrow', 40], ['leather', 2], ['flint', 10],
    ['iron_ingot', 8], ['raw_iron', 12], ['gold_ingot', 1], ['raw_gold', 5], ['diamond', 2], ['ender_pearl', 20], ['blaze_rod', 9], ['blaze_powder', 4], ['obsidian', 3],
    ['oak_log', 20], ['birch_log', 4], ['coal', 20], ['charcoal', 4], ['wheat_seeds', 70], ['wheat', 64], ['carrot', 65], ['potato', 10], ['cobblestone', 64], ['stone_pickaxe', 1]]);
  const moves = stash.stashDeposits(bot, holding({ oak_log: 8, cobblestone: 64, stone_pickaxe: 1, cooked_beef: 8 }));
  assert.deepEqual(byItem(moves), { white_wool: 4, string: 4, feather: 6, bone_meal: 2, gunpowder: 1, arrow: 8, leather: 2, flint: 2, raw_iron: 4, raw_gold: 2,
    ender_pearl: 4, blaze_rod: 1, oak_log: 16, coal: 8, wheat_seeds: 6, carrot: 1 }, 'three obsidian stay in the pockets: a portal is ten; bones stay for a wolf');
  assert(moves.every(m => m.keepsake), 'the kit is full, so every move is a keepsake');
  // Wool and logs are families: seven wool carried, three kept, the biggest pile spent first; twenty-four logs, eight kept, all from the oak pile.
  // Gold keeps what the boots need: one ingot plus three raw. Diamonds stay without the diamond pickaxe.
  assert(!moves.some(m => ['black_wool', 'gold_ingot', 'diamond', 'iron_ingot', 'blaze_powder', 'wheat', 'potato'].includes(m.item)));
  // With the chest short of logs, the kit takes its eight and the keepsake rule takes the rest over eight, once.
  const logs = stash.stashDeposits(carrying([['oak_log', 20]]), holding({}));
  assert.deepEqual(logs, [{ item: 'oak_log', count: 8, slot: 'logs' }, { item: 'oak_log', count: 4, keepsake: 'logs' }]);
  // Golden boots on: the gold has done its job.
  assert.deepEqual(byItem(stash.stashDeposits(carrying([['golden_boots', 1], ['gold_ingot', 3], ['raw_gold', 1]]), holding({}))), { gold_ingot: 3, raw_gold: 1 });
  // The valuables trip counts a keepsake of the same metal once, as both, and takes the rest the way it always did.
  const both = stash.stashDeposits(carrying([['raw_iron', 12], ['emerald', 2]]), holding({}), { valuables: true });
  assert.deepEqual(both, [{ item: 'raw_iron', count: 4, keepsake: 'raw iron', valuable: true }, { item: 'emerald', count: 2, valuable: true }, { item: 'raw_iron', count: 8, valuable: true }]);
  for (const name of ['white_wool', 'string', 'feather', 'bone', 'leather', 'iron_ingot', 'ender_pearl', 'oak_log', 'coal']) assert(!(name in SURPLUS), `${name} is never tossed as surplus`);
  assert(stash.isKeepsake('red_wool') && stash.isKeepsake('string') && !stash.isKeepsake('cobblestone') && !stash.isKeepsake('dirt'));
  assert(stash.isKitMaterial(bot, 'cobblestone') && stash.isKitMaterial(bot, 'spruce_log') && stash.isKitMaterial(bot, 'iron_sword') && stash.isKitMaterial(bot, 'cooked_beef'));
  assert(!stash.isKitMaterial(bot, 'wooden_pickaxe') && !stash.isKitMaterial(bot, 'dirt') && !stash.isKitMaterial(bot, 'rotten_flesh'));
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

test('the chest answers the wool for a bed and the ingredients of a plan, reading the plan backwards so a covered product skips the gathering beneath it', () => {
  // Wool: the carried colour's shortfall when the chest has it, else any whole bed's worth, else nothing.
  const two = carrying([['black_wool', 2]]);
  assert.deepEqual(stash.rungWants(two, { action: 'gather_wool', count: 1 }, { home: holding({ black_wool: 5, white_wool: 1 }) }), [{ item: 'black_wool', count: 1 }]);
  assert.deepEqual(stash.rungWants(two, { action: 'gather_wool', count: 1 }, { home: holding({ white_wool: 4 }) }), [{ item: 'white_wool', count: 3 }]);
  assert.deepEqual(stash.rungWants(two, { action: 'gather_wool', count: 1 }, { home: holding({ white_wool: 2 }) }), []);
  assert.deepEqual(stash.rungWants(two, { action: 'gather_wool', count: 1 }), [], 'without the home there is no chest to read');
  // A sword plan: mine raw iron, smelt it, craft. Ingots in the chest cover the craft, so the smelt and the mine beneath it are skipped and no raw iron is asked for.
  const plan = [
    { action: 'mine', drops: 'raw_iron', count: 2, consumes: {}, produces: { raw_iron: 2 } },
    { action: 'smelt', item: 'iron_ingot', count: 2, consumes: { raw_iron: 2, coal: 1 }, produces: { iron_ingot: 2 } },
    { action: 'craft', item: 'stick', count: 4, consumes: { oak_planks: 2 }, produces: { stick: 4 } },
    { action: 'craft', item: 'iron_sword', count: 1, consumes: { iron_ingot: 2, stick: 1 }, produces: { iron_sword: 1 } },
  ];
  assert.deepEqual(stash.planIngredients(carrying([]), { iron_ingot: 8, raw_iron: 8, coal: 4, stick: 2 }, plan), [{ item: 'iron_ingot', count: 2 }, { item: 'stick', count: 1 }]);
  // Without ingots the chest answers the smelt instead: raw iron and the coal to burn.
  assert.deepEqual(stash.planIngredients(carrying([]), { raw_iron: 8, coal: 4 }, plan), [{ item: 'raw_iron', count: 2 }, { item: 'coal', count: 1 }]);
  // What the pockets hold is spent first: one ingot carried, one from the chest.
  assert.deepEqual(stash.planIngredients(carrying([['iron_ingot', 1], ['stick', 4]]), { iron_ingot: 8, stick: 2 }, plan), [{ item: 'iron_ingot', count: 1 }]);
  // A chest short of the whole amount gives what it has.
  assert.deepEqual(stash.planIngredients(carrying([]), { iron_ingot: 1 }, plan), [{ item: 'iron_ingot', count: 1 }]);
  assert.deepEqual(stash.planIngredients(carrying([]), {}, plan), []);
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
  const chest = chestAt(w, [['iron_pickaxe', 1], ['stone_sword', 1], ['white_bed', 1], ['oak_log', 8], ['cobblestone', 64], ['bread', 4], ['crafting_table', 1], ['furnace', 1]]);
  assert.equal(preparationStage(bot, goal).phase, 'stone_pickaxe', 'a chest not yet looked in is not counted on');
  goal.survival.home.stash.contents = chest.stored();
  const stage = preparationStage(bot, goal);
  assert.equal(stage.phase, 'home_restock'); assert.equal(stage.action, 'home'); assert.equal(stage.home.action, 'restock');
  assert.deepEqual(stage.home.wants[0], { item: 'stone_pickaxe', count: 1 });
  assert.deepEqual(stage.home.wants.slice(1).map(w => w.item), ['cobblestone', 'oak_log'], 'and the plan for one: the stone and the wood the chest holds, in case the pickaxe is gone by the time the lid opens');
  assert.equal(nextGameStage(bot, goal).phase, 'home_restock');
  await gameStep(bot, new Task('win'), goal, save, { home: (b, t, g, s, st) => home.homeStep(b, t, g, s, st, actions) });
  assert.equal(goal.gameProgress.phase, 'home_restock');
  assert.deepEqual(Object.fromEntries(bot.inventory.items().map(i => [i.name, i.count])), { iron_pickaxe: 1, stone_sword: 1, white_bed: 1, oak_log: 8, cobblestone: 64, bread: 3, crafting_table: 1, furnace: 1 });
  assert.deepEqual(chest.stored(), { bread: 1 });
  assert.equal(preparationStage(bot, goal).phase, 'shield', 'the kit answered the first three rungs; the ladder goes on from the shield');
  // A recent failure at the chest waits ten minutes; beyond reach the chest is not a step at all.
  goal.survival.home.stash.contents = { shield: 1 };
  assert.equal(preparationStage(bot, goal).phase, 'home_restock', 'the shield rung is answered by the chest');
  require('../src/progress').setAside(goal, 'stash', 'chest', 'lid blocked', 600000);
  assert.equal(preparationStage(bot, goal).phase, 'shield');
  require('../src/progress').attemptsFor(goal).clear('stash', 'chest');
  bot.entity.position = new Vec3(400.5, LEVEL + 1, 0.5);
  assert.equal(preparationStage(bot, goal).phase, 'shield');
  // A failed open marks the chest for later rather than looping on it.
  bot.entity.position = new Vec3(20.5, LEVEL + 1, 0.5);
  bot.openContainer = async () => { throw new Error('lid blocked'); };
  await assert.rejects(home.homeStep(bot, task, goal, save, preparationStage(bot, goal).home, actions), /lid blocked/);
  assert(require('../src/progress').isSetAside(goal, 'stash', 'chest')); assert.equal(preparationStage(bot, goal).phase, 'shield');
});

test('before the Nether the valuables go home once, and the ladder moves on with lighter pockets', async () => {
  const gear = [['white_bed', 1], ['iron_pickaxe', 1], ['iron_sword', 1], ['shield', 1], ['water_bucket', 1], ['oak_log', 8], ['cobblestone', 64], ['cooked_beef', 4], ['crafting_table', 1], ['furnace', 1],
    ['iron_helmet', 1], ['iron_chestplate', 1], ['iron_leggings', 1], ['iron_boots', 1], ['golden_boots', 1], ['bow', 1], ['arrow', 16], ['diamond_sword', 1], ['diamond_pickaxe', 1], ['diamond', 3], ['iron_ingot', 12], ['gold_ingot', 2]];
  const w = await establishedHome({ items: gear });
  const { bot, goal, save, actions } = w;
  const chest = chestAt(w, []);
  assert.equal(nextGameStage(bot, goal).action, 'enter_nether');
  const ran = [];
  const handlers = { stash_valuables: (b, t, g, s) => stash.stashValuables(b, t, g, s, actions), prepare_combat: async () => { ran.push('prepare_combat'); return false; }, enter_nether: async () => { ran.push('enter_nether'); } };
  assert.equal(await gameStep(bot, new Task('win'), goal, save, handlers), false);
  assert.deepEqual(ran, [], 'the stash trip came before the combat check');
  assert.equal(goal.step.action, 'stash_valuables');
  assert.deepEqual(chest.stored(), { diamond: 3, iron_ingot: 4, gold_ingot: 2, iron_pickaxe: 1, iron_sword: 1, cooked_beef: 2 }, 'eight ingots stay for a tool; the rest, the diamonds, and the kit spares while there (the iron pickaxe behind the diamond one, the iron sword behind the diamond one, two steaks over the reserve) go in');
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
  assert.match(options.stock_stash.description, /kit: 1 stone pickaxe, 8 oak log, and to keep for later: 4 oak log/, 'the chest holds eight kit logs and the four over eight as a keepsake');
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

test('before the Nether a restock tops food up to the crossing reserve, not a day of work', () => {
  const { stashWithdrawals, KIT_FOOD_POINTS, NETHER_FOOD_POINTS } = require('../src/home-stash');
  const registry = require('minecraft-data')('26.1');
  const bot = { registry, inventory: { items: () => [] } };
  const home = { stash: { position: { x: 0, y: 64, z: 0 }, contents: { cooked_beef: 8 } } };
  const beef = moves => moves.filter(m => m.item === 'cooked_beef').reduce((n, m) => n + m.count, 0);
  const day = beef(stashWithdrawals(bot, home, [], { foodPoints: KIT_FOOD_POINTS }));
  const nether = beef(stashWithdrawals(bot, home, [], { foodPoints: NETHER_FOOD_POINTS }));
  assert.equal(day, 2, 'a day: two steaks, sixteen points');
  assert.equal(nether, 3, 'the Nether: three steaks, twenty-four points');
});

test('a restock item set aside after a restock that changed nothing is not planned again', () => {
  const { restockStage } = require('../src/home-stash');
  const { setAside } = require('../src/progress');
  const registry = require('minecraft-data')('26.1');
  const items = [];
  const bot = { registry, entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 2 } }, game: { dimension: 'overworld', difficulty: 'normal' }, inventory: { items: () => items, slots: [] }, health: 20, food: 20 };
  const home = { origin: { x: 0, y: 64, z: 0 }, dimension: 'overworld', stash: { position: { x: 1, y: 64, z: 0 }, contents: { furnace: 1 } } };
  const goal = { survival: { home } };
  const before = restockStage(bot, goal);
  assert(before?.items.some(m => m.item === 'furnace'), 'empty pockets want the furnace the chest holds');
  setAside(goal, 'restock_item', 'furnace', 'no measurable progress', 900000);
  const after = restockStage(bot, goal);
  assert(!after || !after.items.some(m => m.item === 'furnace'));
});

test('the chest holds a stack of the bulk things at most: 216 coal and 103 raw iron filled the dream run\'s chest', () => {
  const bot = carrying([['coal', 100], ['raw_iron', 40], ['lapis_lazuli', 30]]);
  const full = byItem(stash.stashDeposits(bot, holding({ coal: 216, raw_iron: 103, lapis_lazuli: 99 }), { valuables: true }));
  assert.equal(full.coal, undefined); assert.equal(full.raw_iron, undefined); assert.equal(full.lapis_lazuli, undefined);
  const some = byItem(stash.stashDeposits(bot, holding({ coal: 40, raw_iron: 50 }), { valuables: true }));
  assert.equal(some.coal, 24, 'up to a stack of coal in the chest'); assert.equal(some.raw_iron, 14); assert.equal(some.lapis_lazuli, 30);
});

test('a full chest does not hold up the Nether: nothing fits, no second chest can go, and the trip goes on', async () => {
  const gear = [['white_bed', 1], ['iron_pickaxe', 1], ['iron_sword', 1], ['shield', 1], ['water_bucket', 1], ['oak_log', 8], ['cobblestone', 64], ['cooked_beef', 4], ['crafting_table', 1], ['furnace', 1],
    ['iron_helmet', 1], ['iron_chestplate', 1], ['iron_leggings', 1], ['iron_boots', 1], ['golden_boots', 1], ['bow', 1], ['arrow', 16], ['diamond_sword', 1], ['diamond_pickaxe', 1], ['emerald', 5]];
  const w = await establishedHome({ items: gear });
  const { bot, goal, save, actions } = w;
  const kinds = ['stone', 'granite', 'diorite', 'andesite', 'dirt', 'sand', 'gravel', 'oak_planks', 'spruce_planks', 'birch_planks', 'glass', 'torch', 'stick', 'bone_meal', 'string', 'feather', 'leather', 'paper', 'book', 'bread', 'apple', 'wheat', 'flint', 'clay_ball', 'brick', 'bowl', 'snowball'];
  const chest = chestAt(w, kinds.map(k => [k, 1]));
  const stored = { ...chest.stored() };
  goal.survival.home.stash.contents = stored;
  const first = await stash.stashValuables(bot, new Task('win'), goal, save, actions);
  assert.equal(first, true, 'nothing fitted, so the ladder goes on');
  assert(goal.survival.home.stash.fullAt, 'the chest is known to be full');
  assert.deepEqual(chest.stored(), stored, 'nothing was forced in');
  assert.equal(await stash.stashValuables(bot, new Task('win'), goal, save, actions), true);
  assert.equal(chest.window.opened, 1, 'and it is not asked again at every step');
});

test('blaze rods, powder and pearls left in the stash are fetched before the portal', async () => {
  const gear = [['white_bed', 1], ['iron_pickaxe', 1], ['iron_sword', 1], ['shield', 1], ['water_bucket', 1], ['oak_log', 8], ['cobblestone', 64], ['cooked_beef', 12], ['crafting_table', 1], ['furnace', 1],
    ['iron_helmet', 1], ['iron_chestplate', 1], ['iron_leggings', 1], ['iron_boots', 1], ['golden_boots', 1], ['bow', 1], ['arrow', 16], ['diamond_sword', 1], ['diamond_pickaxe', 1]];
  const w = await establishedHome({ items: gear });
  w.goal.survival.home.stash.contents = { blaze_rod: 6, ender_pearl: 3 };
  const stage = nextGameStage(w.bot, w.goal);
  assert.equal(stage.phase, 'restock_supplies');
  assert.deepEqual(byItem(stage.home.items), { blaze_rod: 6, ender_pearl: 3 });
  w.goal.survival.home.stash.contents = {};
  assert.equal(nextGameStage(w.bot, w.goal).action, 'enter_nether', 'with nothing in the chest the portal is next');
});

test('a restock makes room before it opens the chest, and a restock that takes nothing is not planned again at once', async () => {
  const keepers = ['emerald', 'gold_nugget', 'redstone', 'quartz', 'glowstone_dust', 'amethyst_shard', 'copper_ingot', 'book', 'paper', 'compass', 'clock', 'map', 'name_tag', 'lead', 'saddle',
    'spyglass', 'brush', 'bowl', 'glass_bottle', 'honeycomb', 'slime_ball', 'magma_cream', 'ghast_tear', 'prismarine_shard', 'nautilus_shell', 'rabbit_hide', 'ink_sac', 'glow_ink_sac'];
  const gear = [['iron_sword', 1], ['oak_log', 8], ['cobblestone', 64], ['cooked_beef', 8], ['crafting_table', 1], ['furnace', 1], ['water_bucket', 1]];
  const w = await establishedHome({ items: [...gear, ['dirt', 18], ...keepers.map(k => [k, 1])] });
  const { bot, goal, save, actions } = w;
  assert.equal(w.stacks.length, 36, 'thirty-six slots taken');
  const chest = chestAt(w, [['iron_pickaxe', 1]]);
  chest.window.firstEmptyInventorySlot = () => w.stacks.length >= 36 ? null : 27 + w.stacks.length;
  bot.tossStack = async item => { w.stacks.splice(w.stacks.indexOf(item), 1); };
  const home = goal.survival.home;
  home.stash.contents = { iron_pickaxe: 1 };
  const taken = await stash.restockFromStash(bot, new Task('restock'), goal, save, home, actions);
  assert.deepEqual(taken.map(m => m.item), ['iron_pickaxe']);
  assert(!w.stacks.some(i => i.name === 'dirt'), 'the dirt made the room');
  assert(bot.inventory.items().some(i => i.name === 'iron_pickaxe'));

  // Full of keepers, nothing to drop: nothing comes out, and the pickaxe rests.
  const w2 = await establishedHome({ items: [...gear, ['emerald', 1], ...keepers.map(k => [k, 1]), ['diamond', 1]] });
  const chest2 = chestAt(w2, [['iron_pickaxe', 1]]);
  chest2.window.firstEmptyInventorySlot = () => w2.stacks.length >= 36 ? null : 27 + w2.stacks.length;
  w2.bot.tossStack = async item => { w2.stacks.splice(w2.stacks.indexOf(item), 1); };
  w2.goal.survival.home.stash.contents = { iron_pickaxe: 1 };
  assert.deepEqual(await stash.restockFromStash(w2.bot, new Task('restock'), w2.goal, w2.save, w2.goal.survival.home, w2.actions), []);
  assert(require('../src/progress').isSetAside(w2.goal, 'restock_item', 'iron_pickaxe'), 'the chest is not opened again for it at the next step');
});
