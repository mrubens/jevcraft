'use strict';
// Note 780: the bots ran with 34+ of 36 slots in use 52% of the time from
// 2026-09-30 12Z; the tidy found nothing over a cap in half the minutes it
// was crowded, and every room question was asked with a stack no rung takes
// or blocks past what the crossing wants. Building blocks are one budget,
// kinds no rung takes are kept to none, the tidy's rule goes before the
// room question, and the question says what the tidy keeps.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const tidy = require('../src/inventory-tidy');

const stackOf = n => registry.itemsByName[n]?.stackSize || 64;
const it = (name, count = 1, slot) => ({ name, count, type: registry.itemsByName[name].id, stackSize: registry.itemsByName[name].stackSize, ...(slot !== undefined ? { slot } : {}) });
const counts = items => items.reduce((m, i) => (m[i.name] = (m[i.name] || 0) + i.count, m), {});

// 25595 (mid-226-*) at 04:31:03Z, 2026-10-01, as its flight record carried
// the pockets: 196 blocks of three kinds, redstone, saplings, moss and
// rotten flesh beside them, 30 slots by whole stacks (the server's count
// was higher: part stacks).
const POCKETS_25595 = { wooden_hoe: 1, raw_copper: 3, raw_gold: 3, golden_boots: 1, white_bed: 1, lapis_lazuli: 98, birch_sapling: 2, stone_axe: 1, chest: 1, iron_ingot: 1,
  birch_log: 7, cauldron: 1, brown_wool: 1, gray_wool: 1, bucket: 9, moss_block: 2, white_wool: 1, flint_and_steel: 1, coal: 128, wheat_seeds: 1, redstone: 5, water_bucket: 1,
  diamond_sword: 1, torch: 4, rotten_flesh: 2, iron_pickaxe: 1, cobblestone: 128, cobbled_deepslate: 60, dirt: 8 };

test('building blocks are one budget of 128: cobblestone kept first, dirt and the rest past it; the kinds no rung takes kept to none', () => {
  const over = Object.fromEntries(tidy.overCaps(POCKETS_25595, { dimension: 'overworld' }).map(d => [d.name, d.count]));
  assert.equal(over.cobblestone, undefined, 'the 128 cobblestone are the budget');
  assert.equal(over.cobbled_deepslate, 60); assert.equal(over.dirt, 8);
  for (const n of ['redstone', 'birch_sapling', 'moss_block', 'rotten_flesh']) assert.equal(over[n], POCKETS_25595[n], `${n} kept to none`);
  for (const n of ['coal', 'lapis_lazuli', 'white_wool', 'brown_wool', 'bucket', 'raw_gold', 'wheat_seeds', 'iron_pickaxe']) assert.equal(over[n], undefined, `${n} is not the tidy's`);
  // Tuff, the granites and terracotta lay as cobblestone does: in the budget,
  // kept after the kit's kinds.
  const mixed = Object.fromEntries(tidy.overCaps({ cobblestone: 64, granite: 40, white_terracotta: 30, netherrack: 20 }, { dimension: 'overworld' }).map(d => [d.name, d.count]));
  assert.deepEqual(mixed, { white_terracotta: 6, netherrack: 20 }, '154 against 128: netherrack goes first, then terracotta, granite kept');
  // In the Nether basalt counts as a block; in the Overworld it is no rung's.
  assert.deepEqual(tidy.overCaps({ netherrack: 100, basalt: 40 }, { dimension: 'the_nether' }).map(d => [d.name, d.count]), [['netherrack', 12]]);
  assert.deepEqual(tidy.overCaps({ basalt: 40 }, { dimension: 'overworld' }).map(d => [d.name, d.count]), [['basalt', 40]]);
});

test('what keeps blocks or kinds whatever the count: a shortfall (751d), the work in hand, a home chest for the oddities', () => {
  assert.deepEqual(tidy.overCaps({ netherrack: 179, cobblestone: 64 }, { dimension: 'the_nether', blocksShort: true }), [], 'blocks short for a way on: the budget is off');
  const kept = tidy.overCaps({ dirt: 200, cobblestone: 64 }, { dimension: 'overworld', keep: new Set(['dirt']) });
  assert.deepEqual(kept.map(d => [d.name, d.count]), [['cobblestone', 64]], 'the step\'s dirt counts in the budget and stays; the cobblestone past it goes');
  assert.deepEqual(tidy.overCaps({ redstone: 9, rabbit_hide: 2, pink_petals: 3 }, { homeChest: true }).map(d => d.name), ['pink_petals'], 'with a home chest the oddities are its keepers; no-use finds still go');
});

test('the plan drops only what frees a slot, kinds kept to none before a budget\'s last kind, and stops at four free', () => {
  const plan = tidy.tidyPlan(POCKETS_25595, { free: 0, dimension: 'overworld', stackOf });
  assert.deepEqual(plan.map(d => d.name).sort(), ['birch_sapling', 'moss_block', 'redstone', 'rotten_flesh'], 'four kinds no rung takes or with no use, a slot each, before the budget\'s dirt, and the headroom is back');
  assert.equal(tidy.tidyPlan(POCKETS_25595, { free: 4, dimension: 'overworld', stackOf }).length, 0, 'four free: nothing');
  // 100 cobblestone and 40 dirt against 128: the 12 dirt past it free no slot.
  assert.deepEqual(tidy.tidyPlan({ cobblestone: 100, dirt: 40 }, { free: 0, dimension: 'overworld', stackOf }), []);
  // Coal is never the tidy's to throw; on the room question it is said past two stacks.
  assert(!tidy.tidyPlan({ coal: 300 }, { free: 0, stackOf }).length);
  assert.equal(tidy.overCaps({ coal: 300 }, { sayCoal: true })[0].count, 172);
});

test('recorded pockets: the rule takes 25595 from full to the headroom', () => {
  const slots = inv => Object.entries(inv).reduce((n, [k, c]) => n + Math.ceil(c / stackOf(k)), 0);
  const inv = { ...POCKETS_25595, oak_planks: 4, stick: 3 };
  assert.equal(slots(inv), 34);
  const after = { ...inv };
  for (const d of tidy.tidyPlan(inv, { free: 36 - slots(inv), dimension: 'overworld', stackOf })) { after[d.name] -= d.count; if (!after[d.name]) delete after[d.name]; }
  assert.equal(slots(after), 32, 'four free');
});

test('the tidy merges part stacks before it drops, and drops whole stacks the smallest first', async () => {
  const slots = { 9: it('cobblestone', 40, 9), 10: it('cobblestone', 30, 10), 11: it('dirt', 20, 11), 12: it('dirt', 10, 12), 13: it('redstone', 4, 13) };
  let free = 2; const tossed = [], moves = [];
  const bot = { registry, game: { dimension: 'overworld' }, currentWindow: null,
    inventory: { items: () => Object.values(slots).filter(Boolean), emptySlotCount: () => free },
    moveSlotItem: async (a, b) => { moves.push([a, b]); const n = Math.min(64 - slots[b].count, slots[a].count); slots[b].count += n; slots[a].count -= n; if (!slots[a].count) { slots[a] = null; free++; } },
    tossStack: async s => { tossed.push(`${s.count} ${s.name}`); slots[s.slot] = null; free++; } };
  const dropped = await tidy.tidyInventory(bot, null, {});
  assert.deepEqual(moves, [[12, 11]], 'dirt 20+10 merged into one stack; cobblestone 40+30 is two stacks either way, left as it is');
  // The merges freed one slot (three free); the redstone goes for the fourth.
  assert.deepEqual(tossed, ['4 redstone']);
  assert.equal(dropped[0].why, 'nothing on the way to the dragon takes it');
});

test('making room: the tidy\'s rule first, with no question; the question, when asked, says what the tidy keeps', async () => {
  const { makeRoom } = tidy;
  let items = [it('redstone', 5), it('cobblestone', 64), it('crafting_table'), it('iron_pickaxe'), it('bread', 3)];
  while (items.length < 36) items.push(it('lapis_lazuli', 64));
  let asked = 0, state = null, offered = null;
  const client = { systemOne: async ({ questions, state: s }) => { asked++; state = s; offered = { ...questions.branch_0.criteria, ...(questions.branch_1?.criteria || {}) };
    return { answers: { branch_0: { choice: 'none', confidence: 0.7 }, branch_1: { choice: 'none', confidence: 0.7 } } }; } };
  const bot = { registry, game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) }, lookAt: async () => {},
    inventory: { items: () => items, emptySlotCount: () => 36 - items.length, slots: [] },
    tossStack: async s => { items = items.filter(i => i !== s); } };
  assert.equal(await makeRoom(bot, { check() {}, opportunityClient: client }, 'raw_iron'), true);
  assert.equal(asked, 0, 'the redstone went by the rule: 25595\'s room questions were all asked beside such a stack');
  assert(!items.some(i => i.name === 'redstone') && items.some(i => i.name === 'crafting_table'));
  // Full again with nothing past a cap: asked, and told what the tidy keeps.
  items.push(it('stick', 1));
  items.push(it('dirt', 30));
  while (items.length < 36) items.push(it('oak_fence', 1));
  await makeRoom(bot, { check() {}, opportunityClient: client }, 'raw_iron');
  assert.equal(asked, 1);
  assert.match(state.keptByTheTidy, /building blocks: 94 carried, 128 kept in all \(one budget across kinds for bridging and pillaring\)/);
  assert.match(state.keptByTheTidy, /by itself when fewer than 4 slots are free/);
});

test('a pick-up past its budget or cap is not wanted: it would only be the tidy\'s to drop again', () => {
  const bot = { game: { dimension: 'overworld' }, inventory: { items: () => [it('cobblestone', 64), it('cobblestone', 64)] } };
  assert.equal(tidy.atKeep(bot, 'dirt'), true, 'the budget is full');
  assert.equal(tidy.atKeep(bot, 'cobblestone'), true);
  assert.equal(tidy.atKeep(bot, 'raw_iron'), false);
  assert.equal(tidy.atKeep(bot, 'spider_eye'), true);
  assert.equal(tidy.atKeep({ game: {}, inventory: { items: () => [it('cobblestone', 60)] } }, 'dirt'), false);
});

test('the work loop tidies only at a safe moment: on the ground, out of water and lava, no threat in sight within eight blocks', () => {
  const { tidyMoment } = require('../src/work');
  const base = { entity: { onGround: true, isInWater: false, isInLava: false, position: new Vec3(0, 64, 0) }, entities: {} };
  assert.equal(tidyMoment(base), true);
  assert.equal(tidyMoment({ ...base, entity: { ...base.entity, onGround: false } }), false);
  assert.equal(tidyMoment({ ...base, entity: { ...base.entity, isInWater: true } }), false);
});
