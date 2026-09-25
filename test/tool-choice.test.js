'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { equipBestTool } = require('../src/skills');
const registry = require('minecraft-data')('26.1');

function fixture(names) {
  const items = names.map((name, i) => ({ name, type: registry.itemsByName[name].id, slot: 36 + i, durabilityUsed: 0 }));
  const bot = { registry, inventory: { items: () => items }, heldItem: null, equipped: null, equip: async item => { bot.equipped = item; bot.heldItem = item; } };
  return bot;
}
const stone = { harvestTools: Object.fromEntries(['wooden', 'stone', 'iron', 'diamond', 'netherite'].map(t => [registry.itemsByName[`${t}_pickaxe`].id, true])),
  canHarvest(type) { return !!this.harvestTools[type]; },
  digTime: type => type === null ? 7500 : { [registry.itemsByName.wooden_pickaxe.id]: 1150, [registry.itemsByName.stone_pickaxe.id]: 600, [registry.itemsByName.iron_pickaxe.id]: 400 }[type] ?? 7500 };
const ironOre = { harvestTools: Object.fromEntries(['stone', 'iron', 'diamond', 'netherite'].map(t => [registry.itemsByName[`${t}_pickaxe`].id, true])),
  canHarvest(type) { return !!this.harvestTools[type]; }, digTime: type => stone.digTime(type) };
const diamondOre = { harvestTools: Object.fromEntries(['iron', 'diamond', 'netherite'].map(t => [registry.itemsByName[`${t}_pickaxe`].id, true])),
  canHarvest(type) { return !!this.harvestTools[type]; }, digTime: type => stone.digTime(type) };
const dirt = { digTime: type => type === registry.itemsByName.iron_shovel.id ? 150 : type === registry.itemsByName.wooden_shovel.id ? 400 : 750 };

test('stone is dug with the cheapest pickaxe that harvests it; the iron pickaxe is kept for what needs it', async () => {
  let bot = fixture(['iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe']);
  await equipBestTool(bot, stone); assert.equal(bot.equipped.name, 'wooden_pickaxe');
  bot = fixture(['iron_pickaxe', 'stone_pickaxe']);
  await equipBestTool(bot, ironOre); assert.equal(bot.equipped.name, 'stone_pickaxe');
  await equipBestTool(bot, diamondOre); assert.equal(bot.equipped.name, 'iron_pickaxe');
});

test('when any tool will do, the fastest still wins, with the lower tier on a tie and the more worn tool after that', async () => {
  let bot = fixture(['wooden_shovel', 'iron_shovel']);
  await equipBestTool(bot, dirt); assert.equal(bot.equipped.name, 'iron_shovel');
  bot = fixture(['stone_pickaxe', 'stone_pickaxe']); bot.inventory.items()[0].durabilityUsed = 100;
  // Trial 43: the fresher was always taken, and five iron pickaxes piled up.
  await equipBestTool(bot, stone); assert.equal(bot.equipped.slot, 36, 'the more worn of two equal tools is used up first');
});

test('the pathfinder digs with the same policy: stone with the stone pickaxe, never the iron', async () => {
  const { installToolPolicy } = require('../src/movement');
  const bot = fixture(['iron_pickaxe', 'stone_pickaxe']); bot.pathfinder = {};
  installToolPolicy(bot);
  assert.equal(bot.pathfinder.bestHarvestTool(stone).name, 'stone_pickaxe');
  assert.equal(bot.pathfinder.bestHarvestTool(diamondOre).name, 'iron_pickaxe');
});
