'use strict';
// The start of every midgame trial from first-days-243 (mid-243-fg, -fh and
// -ga, 2026-09-29 15:47Z): 72 blocks under open sky beside its furnace, the
// only pickaxe an iron one at 171 uses, 3 oak planks (one short of a table
// and sticks), 5 iron ingots and 64 raw iron in the furnace. Jev chose to go
// up for wood; the saved batch was finished first, ten minutes of it, and
// the walks to ore meanwhile wore the pickaxe out in three minutes. The
// ladder then asked for a stone pickaxe with 69 ingots carried, the bot
// placed and dug the same block in a two-high tunnel, and climbed the last
// 60 blocks by hand at 7.5 seconds a block of stone (note 671).
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const fx = require('./fixtures/start-underground-mid-243-ga.json');

const registry = require('minecraft-data')('26.1');
const inBox = (x, y, z) => x >= fx.box.x[0] && x <= fx.box.x[1] && y >= fx.box.y[0] && y <= fx.box.y[1] && z >= fx.box.z[0] && z <= fx.box.z[1];
const inColumn = (x, y, z) => fx.columns.some(([cx, cz]) => cx === x && cz === z) && y <= fx.columnTop;
// The saved world as read: listed cells, the rest stone under the ground
// line (y 100 here) and air over it.
function nameAt(p) {
  const key = `${p.x},${p.y},${p.z}`;
  if (fx.cells[key]) return fx.cells[key];
  if (inBox(p.x, p.y, p.z) || inColumn(p.x, p.y, p.z)) return fx.fill;
  return p.y <= 99 ? 'stone' : 'air';
}
const EMPTY = /^(air|cave_air|leaf_litter|short_grass)$/;
function startBot({ inventory = fx.inventory, extra = [] } = {}) {
  const items = [...inventory, ...extra].map(([name, count, used]) => ({ name, count, type: registry.itemsByName[name].id, ...(used != null ? { durabilityUsed: used } : {}) }));
  const bot = {
    registry, game: { gameMode: 'survival', dimension: 'overworld', minY: -64, height: 384 }, health: 20, food: 19, time: { timeOfDay: 6000 },
    entity: { position: new Vec3(fx.position.x, fx.position.y, fx.position.z), onGround: true },
    inventory: { items: () => items, slots: [], emptySlotCount: () => 6 },
    blockAt: p => { const q = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); const name = nameAt(q), b = registry.blocksByName[name];
      return { name, position: q, boundingBox: EMPTY.test(name) ? 'empty' : 'block', harvestTools: b?.harvestTools, getProperties: () => ({}) }; },
    findBlocks: () => [], entities: {}, world: { raycast: () => null }, pathfinder: { movements: {} },
  };
  return { bot, items };
}

test('at the start the pickaxe is not worn: 171 uses of iron, 72 blocks under the sky, one plank short of another', () => {
  const { pickaxeBudget } = require('../src/pickaxe-budget');
  const { bot } = startBot();
  const b = pickaxeBudget(bot, { kind: 'win' });
  assert.equal(b.usesLeft, 171);
  assert.equal(b.up, 72, 'the column over (48, 8) is rock to the grass at y 99');
  assert.match(b.says, /Pickaxes carried: iron pickaxe \(171 uses left\)\./);
  assert.match(b.says, /72 blocks up to open sky: about 72 digs straight up the column, 216 by stairs/);
  assert.match(b.says, /no sticks can be made \(0 logs, 3 planks, 0 sticks, and no table or wood for one\): 3 planks short of a crafting table and two sticks, 1 log of any wood/);
  // A crafting table carried: only the sticks, and two of the planks make four.
  const withTable = pickaxeBudget(startBot({ extra: [['crafting_table', 1]] }).bot, { kind: 'win' });
  assert.match(withTable.says, /The pockets make 2 more pickaxes \(iron pickaxe or stone pickaxe\)/);
});

test('while the saved batch cooks, the walks are said in pickaxe uses against the way home, and leaving it to cook is offered', async () => {
  const { whileCooking } = require('../src/work');
  const { bot } = startBot();
  let offered, state;
  const task = { check() {}, opportunityClient: { systemOne: async ({ questions, state: s }) => { offered = questions.branch_0.criteria; state = s; return { answers: { branch_0: { choice: 'leave_cooking', confidence: 0.7 } } }; } } };
  const goal = { kind: 'win', step: { action: 'wood_reserve', item: 'oak_log' } };
  const ore = new Vec3(47, 27, 9), far = new Vec3(45, 27, 10);
  const leave = { work: 'the wood reserve (oak log)', carried: '5 iron ingots carried now, besides the batch.' };
  const pick = await whileCooking(bot, task, goal, () => {}, { cooking: 640000, oreInReach: () => ore, walkTarget: () => far, what: 'raw iron', count: 64, leave });
  assert.equal(pick, 'leave_cooking');
  assert(!offered.dig_stone, '216 cobblestone carried');
  for (const key of ['dig_in_reach', 'mine_nearby']) {
    assert.match(offered[key], /Each block dug, ore or the rock on the way to it, wears the pickaxe a use\. Pickaxes carried: iron pickaxe \(171 uses left\)\./, key);
    assert.match(offered[key], /72 blocks up to open sky/, key);
    assert.match(offered[key], /No other pickaxe can be made from the pockets/, key);
  }
  assert.match(offered.wait_here, /and wears no pickaxe\.$/);
  assert.match(offered.leave_cooking, /^Leave the 64 raw iron cooking and go on with the wood reserve \(oak log\) now: the furnace cooks on its own/);
  assert.match(offered.leave_cooking, /within 16 blocks of the furnace once it is done \(in about 11 minutes\), or in 20 minutes/);
  assert.match(state.pickaxeBudget, /171 uses left/);
  // Asked again after a walk, with what the walks wore.
  await whileCooking(bot, task, goal, () => {}, { cooking: 500000, oreInReach: () => null, walkTarget: () => far, what: 'raw iron', count: 50, leave, walks: 'The walks so far this batch: 3 out and back, 86 pickaxe uses worn.' });
  assert.match(offered.mine_nearby, /The walks so far this batch: 3 out and back, 86 pickaxe uses worn\.$/);
  // Not offered with no batch left over from before (leave null).
  await whileCooking(bot, task, goal, () => {}, { cooking: 640000, oreInReach: () => ore, walkTarget: () => far, what: 'raw iron', count: 64 });
  assert(!offered.leave_cooking);
});

test('a batch left to cook is not finished first until it is done and the bot is back by the furnace, or twenty minutes pass', () => {
  const { localBatch } = require('../src/work');
  const { bot } = startBot();
  const now = Date.now();
  const goal = { kind: 'win', smelting: { ...fx.smelting, left: { at: now - 60000, doneAt: now + 540000 } } };
  assert.equal(localBatch(bot, goal), null, 'by the furnace, still cooking: the work goes on');
  bot.entity.position = new Vec3(48.5, 100, 8.5);
  goal.smelting.left.doneAt = now - 1000;
  assert.equal(localBatch(bot, goal), null, 'done, but the bot is up top 72 blocks away');
  bot.entity.position = new Vec3(48.5, 28, 8.5);
  assert.equal(localBatch(bot, goal), goal.smelting, 'back by it and done: taken out');
  assert.equal(goal.smelting.left, undefined);
  goal.smelting.left = { at: now - 21 * 60000, doneAt: now + 60000 };
  bot.entity.position = new Vec3(48.5, 100, 8.5);
  assert.equal(localBatch(bot, goal), goal.smelting, 'twenty minutes on, wherever the bot is');
});

test('with the pickaxe worn out and ingots carried, the ladder asks for an iron pickaxe, not a stone one', () => {
  const { nextGameStage } = require('../src/game-progress');
  const noPick = fx.inventory.filter(([n]) => n !== 'iron_pickaxe' && n !== 'iron_ingot');
  const gear = [['iron_helmet', 1], ['iron_chestplate', 1], ['iron_leggings', 1], ['iron_boots', 1], ['shield', 1]];
  const goal = { version: 1, kind: 'win', request: 'beat the game' };
  const at = ingots => { const { bot } = startBot({ inventory: [...noPick, ...gear, ['iron_ingot', ingots]] }); return nextGameStage(bot, goal); };
  const rung = at(69);
  assert.equal(rung.phase, 'iron_pickaxe');
  assert.equal(rung.item, 'iron_pickaxe');
  assert.equal(at(2).phase, 'stone_pickaxe', 'two ingots make no head');
});

test('the pickaxe rung with none carried says what the pockets lack and the way to open sky', () => {
  const strategy = require('../src/strategy');
  const noPick = fx.inventory.filter(([n]) => n !== 'iron_pickaxe');
  const { bot } = startBot({ inventory: [...noPick, ['iron_ingot', 64]] });
  const option = strategy.rungOption({ phase: 'iron_pickaxe', action: 'acquire', item: 'iron_pickaxe', count: 1 }, true, bot, { kind: 'win' });
  assert.match(option.description, /Pickaxes carried: none\./);
  assert.match(option.description, /3 planks short of a crafting table and two sticks, 1 log of any wood/);
  assert.doesNotMatch(option.description, /A spare/);
});

// The two-high tunnel the bot stood in at 15:53Z (46, 26, 9): rock a block
// over the head, the tunnel running east and west and a cell south.
function tunnel({ high = 2 } = {}) {
  const open = new Set();
  for (let x = 43; x <= 49; x++) for (let dy = 0; dy < high; dy++) open.add(`${x},${26 + dy},9`);
  for (let dy = 0; dy < high; dy++) open.add(`46,${26 + dy},10`);
  const name = p => open.has(`${p.x},${p.y},${p.z}`) ? 'air' : p.y > 99 ? 'air' : 'andesite';
  return { name, laid: () => null, carried: { dirt: 64, cobblestone: 128, oak_planks: 3 }, pickaxe: null, health: 20 };
}

test('in a two-high tunnel no block is offered as a step up: there is no room to climb onto it', () => {
  const { localMoves } = require('../src/unstuck');
  const feet = new Vec3(fx.unstuckScene.feet.x, fx.unstuckScene.feet.y, fx.unstuckScene.feet.z);
  const { moves, here } = localMoves(tunnel(), feet, { goal: 'sky' });
  const keys = moves.map(m => m.key);
  assert(!keys.some(k => /^place_/.test(k)), `offered: ${keys.join(', ')}`);
  assert(here.notOffered.some(s => /^place east: no step it could climb onto \(no room over the head to jump\)/.test(s)));
  assert(keys.includes('step_east') && keys.includes('step_west'), 'the walks along the tunnel stay');
});

test('a move that takes back the move before is not offered', () => {
  const { localMoves } = require('../src/unstuck');
  const feet = new Vec3(46, 26, 9);
  // Room to climb: three high. The dirt put east is a step, and climbing
  // onto it is the next move; digging it up again is not.
  const view = tunnel({ high: 3 });
  const placed = new Vec3(47, 26, 9);
  const withDirt = { ...view, name: p => p.equals(placed) ? 'dirt' : view.name(p) };
  const last = { move: 'place_east', from: `${feet}`, cell: `${placed}`, kind: 'place' };
  const { moves, here } = localMoves(withDirt, feet, { goal: 'sky', last });
  const keys = moves.map(m => m.key);
  assert(!keys.includes('dig_east_feet'), 'the dirt just put there');
  assert(keys.includes('climb_east'), 'the step it was put there for');
  assert(here.notOffered.some(s => /^dig east feet: it takes back the move before \(place east\)/.test(s)));
  // Judged by the cell the move changes, wherever it was made from (note
  // 684: a pillar and the dig under it are a cell apart); after another
  // move, or a minute on, it is a dig like any.
  assert(!localMoves(withDirt, feet, { goal: 'sky', last: { ...last, from: '(45, 26, 9)' } }).moves.some(m => m.key === 'dig_east_feet'));
  assert(localMoves(withDirt, feet, { goal: 'sky', last: { ...last, at: Date.now() - 120000 } }).moves.some(m => m.key === 'dig_east_feet'));
  assert(localMoves(withDirt, feet, { goal: 'sky', last: { move: 'step_west', from: `${feet}` } }).moves.some(m => m.key === 'dig_east_feet'));
  // And a cell just dug is not filled again.
  const dug = { move: 'dig_east_feet', from: `${feet}`, cell: `${placed}`, kind: 'dig' };
  assert(!localMoves(view, feet, { goal: 'sky', last: dug }).moves.some(m => m.key === 'place_east'));
});
