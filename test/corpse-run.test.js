'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const { corpseRun, corpseRunStep, worth } = require('../src/corpse-run');

// Died 400 blocks from the bed with the iron kit, a sword, rods and junk.
function world({ deathAgoMs = 60000, dimension = 'overworld', deathDimension = 'overworld', at = new Vec3(0, 64, 0), status = 'finished' } = {}) {
  const deathAt = new Date(Date.now() - deathAgoMs).toISOString();
  const inventory = [], equipped = {}, said = [];
  const bot = { game: { dimension }, entity: { position: at.clone() }, chat: m => said.push(m), registry: require('minecraft-data')('26.1'), time: { timeOfDay: 1000 },
    inventory: { items: () => inventory, slots: {} },
    equip: async (item, slot) => { equipped[slot] = item.name; bot.inventory.slots[{ head: 5, torso: 6, legs: 7, feet: 8 }[slot]] = item; } };
  const goal = { survival: {
    deaths: [{ at: deathAt, position: { x: 400, y: 64, z: 0 }, dimension: deathDimension }],
    recovery: { at: deathAt, status, recovered: {}, inventoryBeforeDeath: { iron_chestplate: 1, diamond_sword: 1, blaze_rod: 8, dirt: 40, stone_pickaxe: 1, cobblestone: 64 } } } };
  const give = (name, count) => { const it = inventory.find(i => i.name === name); if (it) it.count += count; else inventory.push({ name, count }); };
  return { bot, goal, said, equipped, give };
}

function wearKit(bot) {
  const kit = { 5: 'iron_helmet', 6: 'iron_chestplate', 7: 'iron_leggings', 8: 'iron_boots', 45: 'shield' };
  for (const [slot, name] of Object.entries(kit)) bot.inventory.slots[slot] = { name, durabilityUsed: 0, type: bot.registry.itemsByName[name].id };
  const items = bot.inventory.items();
  bot.inventory.items = () => [...items, { name: 'iron_sword', count: 1, durabilityUsed: 0 }];
}

test('in the Overworld with no kit the run waits for daylight', () => {
  const { bot, goal } = world();
  bot.time.timeOfDay = 15000;
  assert.equal(corpseRun(bot, goal), null, 'no kit, at night');
  assert.equal(goal.corpseRun.status, 'open', 'still to do');
  bot.time.timeOfDay = 1000;
  assert(corpseRun(bot, goal), 'by day');
});

test('what is worth going back for: the kit and supplies, not blocks or stone tools', () => {
  assert.deepEqual(worth({ iron_chestplate: 1, diamond_sword: 1, blaze_rod: 8, dirt: 40, stone_pickaxe: 1, cobblestone: 64, ender_pearl: 2 }),
    { iron_chestplate: 1, diamond_sword: 1, blaze_rod: 8, ender_pearl: 2 });
});

test('a far death: the bot walks back, picks up its things and puts the armour back on', async () => {
  const { bot, goal, said, equipped, give } = world();
  const walks = [];
  const move = async (b, task, g) => { walks.push(g); bot.entity.position = new Vec3(398, 64, 1); };
  const collect = async (b, task, name, { origin }) => { assert.equal(origin.x, 400); give(name, { iron_chestplate: 1, diamond_sword: 1, blaze_rod: 8 }[name]); return true; };
  assert.equal(await corpseRunStep(bot, new Task('win'), goal, () => {}, { move, collect }), true);
  assert.equal(walks.length, 1);
  assert.equal(goal.corpseRun.status, 'done');
  assert.equal(equipped.torso, 'iron_chestplate');
  assert.match(said[0], /Going back.*iron chestplate.*diamond sword.*8 blaze rod/);
  assert.doesNotMatch(said[0], /dirt|stone pickaxe/);
  assert.equal(await corpseRunStep(bot, new Task('win'), goal, () => {}, { move, collect }), false, 'nothing more to do');
});

test('drops by the bed age from the death; after five minutes the run is not made', () => {
  const { bot, goal } = world({ deathAgoMs: 6 * 60000, at: new Vec3(380, 64, 0) });
  assert.equal(corpseRun(bot, goal), null);
  assert.equal(goal.corpseRun.status, 'despawned');
});

test('drops far from the respawn keep; the run is made an hour later', () => {
  const { bot, goal } = world({ deathAgoMs: 60 * 60000 });
  assert(corpseRun(bot, goal));
});

test('a Nether death waits for the next Nether trip; the End is not gone back to', () => {
  const nether = world({ deathDimension: 'the_nether' });
  assert.equal(corpseRun(nether.bot, nether.goal), null);
  assert.equal(nether.goal.corpseRun.status, 'open');
  nether.bot.game.dimension = 'the_nether';
  assert.equal(corpseRun(nether.bot, nether.goal), null, 'no kit on: not into the Nether for it');
  wearKit(nether.bot);
  assert(corpseRun(nether.bot, nether.goal), 'kit on: go');
  const end = world({ deathDimension: 'the_end', dimension: 'the_end' });
  assert.equal(corpseRun(end.bot, end.goal), null);
  assert.equal(end.goal.corpseRun.status, 'void');
});

test('the survival layer picks up close drops first', () => {
  const { bot, goal } = world({ status: 'pending' });
  assert.equal(corpseRun(bot, goal), null);
  assert.equal(goal.corpseRun, undefined);
});

test('three walks that make no ground and the things are given up', async () => {
  const { bot, goal, said } = world();
  const move = async () => {};
  for (let i = 0; i < 3; i++) assert.equal(await corpseRunStep(bot, new Task('win'), goal, () => {}, { move, collect: async () => false }), true);
  assert.equal(goal.corpseRun.status, 'unreachable');
  assert.match(said.at(-1), /can't get back/);
});

test('nothing lying at the spot: gone, said once', async () => {
  const { bot, goal, said } = world({ at: new Vec3(399, 64, 0) });
  assert.equal(await corpseRunStep(bot, new Task('win'), goal, () => {}, { move: async () => assert.fail('already there'), collect: async () => false }), true);
  assert.equal(goal.corpseRun.status, 'gone');
  assert.match(said.at(-1), /Nothing left/);
});

test('a death in lava is not gone back for: the drops burned', () => {
  const { bot, goal } = world();
  goal.survival.deaths[0].lava = true;
  assert.equal(corpseRun(bot, goal), null);
  assert.equal(goal.corpseRun.status, 'burned');
});
