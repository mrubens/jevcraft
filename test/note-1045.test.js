'use strict';
// Note 1045: before the Nether, a spare pickaxe and sword left in the chest
// at home is an answer, said with what a death costs with the chest empty.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const stash = require('../src/home-stash');
const registry = require('minecraft-data')('26.1');

function bot(carried) {
  const items = Object.entries(carried).map(([name, count]) => ({ name, count, type: registry.itemsByName[name]?.id, durabilityUsed: 0 }));
  return { registry, game: { gameMode: 'survival', dimension: 'overworld' }, health: 20, food: 20, entity: { position: new Vec3(40.5, 64, 0.5) }, inventory: { items: () => items, slots: [] } };
}
const goalWith = contents => ({ kind: 'win', survival: { home: { origin: { x: 0, y: 64, z: 0 }, bed: { x: 1, y: 64, z: 0 }, stash: { position: { x: 2, y: 64, z: 0 }, contents } } } });

test('an empty chest forty blocks off, iron and sticks carried: a spare pickaxe and sword made and left, said with the day\'s record', () => {
  const b = bot({ iron_pickaxe: 1, iron_sword: 1, iron_ingot: 9, stick: 6, cooked_beef: 8 });
  const o = stash.spareKitOffer(b, goalWith({}));
  // The deaths that followed a death are said with it (note 1115).
  assert.match(o.says, /of 110 deaths 20 were followed by another of the same trial within ten minutes and 30 within twenty, the bot back with empty hands among the mobs by its bed: a sword and a pickaxe in the chest are in hand the moment it is back\.$/);
  assert.ok(o, 'offered');
  assert.deepEqual(o.makes.map(m => m.item), ['iron_pickaxe', 'iron_sword']);
  assert.match(o.says, /^Leave a spare kit in the stash chest at home first, \d+ blocks off, about \d+ seconds each way: make a spare iron pickaxe \(3 of the 9 iron ingots carried\) and a spare iron sword \(2 of the 9 iron ingots carried\), a few seconds at a crafting table, and leave them there \(the chest holds nothing yet\)\. A death in the Nether comes back to life at the bed with empty hands, and what is in the chest is taken up from there: on 2026-10-03 the 4 deaths in the Nether with the chest empty were back in the Nether 22 to 52 minutes later, a median 37, the kit mined and smelted again\./);
});

test('stone where no iron is spare; nothing where the chest holds both, the pockets make neither, or the chest is out of reach', () => {
  assert.deepEqual(stash.spareKitOffer(bot({ iron_pickaxe: 1, cobblestone: 20, stick: 4 }), goalWith({})).makes.map(m => m.item), ['stone_pickaxe', 'stone_sword']);
  assert.equal(stash.spareKitOffer(bot({ iron_pickaxe: 1, iron_ingot: 9, stick: 6 }), goalWith({ iron_pickaxe: 1, stone_sword: 1 })), null, 'the chest holds both');
  assert.equal(stash.spareKitOffer(bot({ iron_pickaxe: 1, iron_sword: 1 }), goalWith({})), null, 'nothing to make them from');
  const far = bot({ iron_ingot: 9, stick: 6 }); far.entity.position = new Vec3(400.5, 64, 0.5);
  assert.equal(stash.spareKitOffer(far, goalWith({})), null);
  const twoPicks = stash.spareKitOffer(bot({ iron_pickaxe: 1, stone_pickaxe: 1, iron_sword: 1 }), goalWith({ stone_sword: 1 }));
  assert.ok(twoPicks && twoPicks.makes.length === 0, 'a spare carried is left as it is');
  assert.match(twoPicks.says, /leave the spare pickaxe carried there/);
});

test('the spare kit is asked on its own by the chest: left when chosen, asked once for what the chest lacks, not asked with nothing to leave (note 1222)', async () => {
  const { Task } = require('../src/skills');
  const b = bot({ iron_pickaxe: 1, iron_sword: 1, iron_ingot: 9, stick: 6, cooked_beef: 8 });
  const goal = goalWith({});
  const asked = [];
  let answer = 'go_on';
  const client = { systemOne: async ({ questions }) => { asked.push(JSON.stringify(Object.values(questions)[0])); return { answers: Object.fromEntries(Object.keys(questions).map(k => [k, { choice: answer, confidence: 0.9 }])) }; } };
  const made = [];
  const actions = { acquireStep: async (bb, t, item) => { made.push(item); }, navigate: async () => {} };
  assert.equal(await stash.askSpareKit(b, new Task('t'), goal, () => {}, actions, client), false);
  assert.equal(asked.length, 1);
  assert.match(asked[0], /leave_spare_kit/);
  assert.match(asked[0], /Leave a spare kit in the stash chest at home first, \d+ blocks off/);
  assert.match(asked[0], /six of nineteen deaths were a bot's second/);
  assert.equal(await stash.askSpareKit(b, new Task('t'), goal, () => {}, actions, client), false);
  assert.equal(asked.length, 1, 'not asked again within half an hour for the same lack');
  // Half an hour on, and chosen: the kit is made (the storing is the chest's own code).
  answer = 'leave_spare_kit';
  assert.equal(await stash.askSpareKit(b, new Task('t'), goal, () => {}, actions, client, { now: Date.now() + 31 * 60000 }), true);
  assert.deepEqual(made, ['iron_pickaxe', 'iron_sword']);
  // The chest holding both: no question.
  const full = goalWith({ iron_pickaxe: 1, stone_sword: 1 });
  assert.equal(await stash.askSpareKit(b, new Task('t'), full, () => {}, actions, client), false);
  assert.equal(asked.length, 2);
});

test('a spare shield goes with the kit where one is worn: the one in the pack, or made of an ingot and six planks; and it is taken out again with none worn (note 1225)', () => {
  const worn = carried => { const b = bot(carried); b.inventory.slots[45] = { name: 'shield' }; return b; };
  // Worn and a second in the pack: left as it is.
  const a = stash.spareKitOffer(worn({ iron_pickaxe: 2, iron_sword: 2, shield: 1 }), goalWith({}));
  assert.ok(a.lacks.includes('shield'));
  assert.match(a.says, /spare pickaxe and sword and shield carried|shield/);
  // Worn, none spare, an ingot and two logs: made.
  const m = stash.spareKitOffer(worn({ iron_pickaxe: 2, iron_sword: 2, iron_ingot: 1, oak_log: 2 }), goalWith({ }));
  assert.deepEqual(m.makes.map(x => x.item), ['shield']);
  // None worn: the shield made is for the arm, not the chest.
  const none = stash.spareKitOffer(bot({ iron_pickaxe: 2, iron_sword: 2, iron_ingot: 1, oak_log: 2 }), goalWith({}));
  assert.ok(!none?.lacks.includes('shield'));
  // The chest holding one: nothing more of it.
  const held = stash.spareKitOffer(worn({ iron_pickaxe: 2, iron_sword: 2, shield: 1 }), goalWith({ shield: 1 }));
  assert.ok(!held?.lacks.includes('shield'));
});

test('a spare iron helmet in the pack with one worn is left in the chest, and comes out for a bot back with its head bare (note 1254)', () => {
  const b = bot({ iron_pickaxe: 1, iron_sword: 1, iron_helmet: 1 });
  b.inventory.slots[5] = { name: 'iron_helmet' };
  const o = stash.spareKitOffer(b, goalWith({ iron_pickaxe: 1, stone_sword: 1 }));
  assert.ok(o, 'offered for the helmet alone');
  assert.deepEqual(o.armour, ['iron_helmet']);
  assert.match(o.says, /iron helmet/);
  // With a helmet in the chest already, or none worn (the one carried is the bot's own), nothing.
  assert.equal(stash.spareKitOffer(b, goalWith({ iron_pickaxe: 1, stone_sword: 1, iron_helmet: 1 })), null);
  const bare = bot({ iron_pickaxe: 1, iron_sword: 1, iron_helmet: 1 });
  assert.equal(stash.spareKitOffer(bare, goalWith({ iron_pickaxe: 1, stone_sword: 1 })), null);
  // Back from a death: the pieces for the bare places come out, not the place worn.
  const back = bot({});
  back.inventory.slots[6] = { name: 'iron_chestplate' };
  const out = stash.stashWithdrawals(back, { stash: { position: { x: 2, y: 64, z: 0 }, contents: { iron_helmet: 1, iron_chestplate: 1, iron_boots: 1 } } }).filter(m => m.slot === 'armour').map(m => m.item).sort();
  assert.deepEqual(out, ['iron_boots', 'iron_helmet']);
});

test('back from a death with nothing worn and no iron spare: the leather in the chest comes out for a set (note 1310)', () => {
  const back = bot({});
  const out = stash.stashWithdrawals(back, { stash: { position: { x: 2, y: 64, z: 0 }, contents: { leather: 15 } } }).filter(m => m.slot === 'armour');
  assert.deepEqual(out.map(m => [m.item, m.count]), [['leather', 15]]);
  // An iron piece to take: that, and the leather stays.
  const iron = stash.stashWithdrawals(bot({}), { stash: { position: { x: 2, y: 64, z: 0 }, contents: { leather: 15, iron_helmet: 1 } } }).filter(m => m.slot === 'armour').map(m => m.item);
  assert.deepEqual(iron, ['iron_helmet']);
});
