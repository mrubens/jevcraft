'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { wearBestArmour } = require('../src/mob-policy');

function kit(dimension, carried, worn = {}) {
  const registry = require('minecraft-data')('26.1');
  const slots = {}, SLOT = { head: 5, torso: 6, legs: 7, feet: 8, 'off-hand': 45 };
  let items = carried.map(name => ({ name, count: 1, durabilityUsed: 0 }));
  for (const [slot, name] of Object.entries(worn)) slots[SLOT[slot]] = { name, durabilityUsed: 0 };
  const bot = { registry, game: { dimension }, inventory: { slots, items: () => items },
    equip: async (item, slot) => { const old = slots[SLOT[slot]]; slots[SLOT[slot]] = item; items = items.filter(i => i !== item); if (old) items.push(old); } };
  return { bot, slots };
}

test('armour carried in the pockets is put on, the best piece in each slot', async () => {
  const { bot, slots } = kit('overworld', ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'golden_boots', 'shield', 'leather_helmet']);
  assert.equal(await wearBestArmour(bot), 5);
  assert.deepEqual([5, 6, 7, 8, 45].map(s => slots[s]?.name), ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'shield']);
  assert.equal(await wearBestArmour(bot), 0, 'nothing better left');
});

test('a better piece worn stays on; in the Nether the golden boots go on the feet', async () => {
  const worn = kit('overworld', ['iron_chestplate'], { torso: 'diamond_chestplate' });
  assert.equal(await wearBestArmour(worn.bot), 0);
  assert.equal(worn.slots[6].name, 'diamond_chestplate');
  const nether = kit('the_nether', ['golden_boots'], { feet: 'iron_boots' });
  await wearBestArmour(nether.bot);
  assert.equal(nether.slots[8].name, 'golden_boots');
});

test('a shield with twenty uses left goes on the arm when the arm is empty; of two, the one with more left (note 1259)', async () => {
  const { bot, slots } = kit('the_nether', []);
  const max = bot.registry.itemsByName.shield.maxDurability;
  const worn = { name: 'shield', count: 1, durabilityUsed: max - 20 }, fresher = { name: 'shield', count: 1, durabilityUsed: max - 200 };
  let items = [worn];
  bot.inventory.items = () => items;
  bot.equip = async (item, slot) => { slots[45] = item; items = items.filter(i => i !== item); };
  assert.equal(await wearBestArmour(bot), 1);
  assert.equal(slots[45], worn);
  delete slots[45]; items = [worn, fresher];
  await wearBestArmour(bot);
  assert.equal(slots[45], fresher);
});
