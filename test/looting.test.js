'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const { lootableChests, lootNearby, lootStep, unlootedLandmarks, wanted, phraseTaken } = require('../src/looting');
const { WORLD_FIELDS } = require('../src/world-knowledge');
const { IDLE_OPTIONS } = require('../src/decisions/work');

const task = { check() {} };
const portal = { kind: 'ruined_portal', x: 20, y: 64, z: 20, dimension: 'overworld' };
const world = (blocks = {}, { dimension = 'overworld', position = new Vec3(10, 64, 10), pockets = [] } = {}) => {
  const said = [], items = pockets.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id }));
  const bot = { registry, game: { dimension, gameMode: 'survival' }, entity: { position }, entities: {}, health: 20, said, chat: m => said.push(m),
    inventory: { items: () => items, emptySlotCount: () => 30 - items.length, slots: [] },
    blockAt: p => { const name = blocks[`${p.x},${p.y},${p.z}`] || (p.y < 64 ? 'stone' : 'air'); return { name, boundingBox: name === 'air' ? 'empty' : 'block', position: p }; },
    findBlocks: ({ matching, count = 64 }) => Object.entries(blocks).filter(([, name]) => [].concat(matching).includes(registry.blocksByName[name]?.id))
      .map(([k]) => new Vec3(...k.split(',').map(Number))).slice(0, count) };
  return { bot, items };
};
// A chest window over the given contents; withdraw moves a stack to the pockets.
const chestActions = (items, contents, opened = []) => ({
  approach: async (bot, t, name, [p]) => ({ name, position: p }),
  open: async (bot, t, block) => { opened.push(block.position); return {
    containerItems: () => contents.map(([name, count]) => ({ name, count, type: registry.itemsByName[name].id })),
    withdraw: async (type, meta, count) => { const name = registry.items[type].name; const have = items.find(i => i.name === name); if (have) have.count += count; else items.push({ name, count, type }); },
    close() {} }; },
  makeRoom: false,
});

test('a chest at a remembered ruined portal is opened, the useful things taken and the rest left, once', async () => {
  const { bot, items } = world({ '22,64,21': 'chest' });
  const goal = { landmarks: [portal] }, opened = [];
  const actions = chestActions(items, [['gold_ingot', 5], ['obsidian', 2], ['flint_and_steel', 1], ['rotten_flesh', 3], ['golden_sword', 1]], opened);
  assert.equal(await lootNearby(bot, task, goal, () => {}, actions), true);
  assert.equal(items.find(i => i.name === 'gold_ingot').count, 5);
  assert.equal(items.find(i => i.name === 'obsidian').count, 2);
  assert(!items.some(i => i.name === 'rotten_flesh'), 'rotten flesh is left');
  const record = goal.looted['22,64,21'];
  assert.equal(record.structure, 'ruined_portal');
  assert.deepEqual(record.left, { rotten_flesh: 3, golden_sword: 1 });
  assert.match(bot.said[0], /Opened the ruined portal's chest: 5 gold ingot, 2 obsidian and 1 flint and steel/);
  assert.equal(await lootNearby(bot, task, goal, () => {}, actions), false, 'not opened twice');
  assert.equal(opened.length, 1);
});

test('only structure chests: not the stash, not a chest near home, not one far from any landmark', async () => {
  const blocks = { '22,64,21': 'chest', '60,64,60': 'chest' };
  const { bot } = world(blocks, { position: new Vec3(30, 64, 30) });
  assert.deepEqual(lootableChests(bot, { landmarks: [portal] }).map(p => p.toString()), ['(22, 64, 21)'], 'the chest by no landmark is someone\'s');
  assert.deepEqual(lootableChests(bot, { landmarks: [portal], survival: { home: { origin: { x: 25, z: 25 } } } }), [], 'a chest at home is not loot');
  assert.deepEqual(lootableChests(bot, { landmarks: [portal], survival: { home: { stash: { position: { x: 22, y: 64, z: 21 } } } } }), []);
  assert.deepEqual(lootableChests(bot, {}), [], 'no landmarks, no loot');
});

test('a chest with TNT beneath is a desert temple trap and is left, and nothing is opened in the Nether', () => {
  const temple = { kind: 'desert_temple', x: 20, y: 50, z: 20, dimension: 'overworld' };
  const { bot } = world({ '20,50,22': 'chest', '20,47,20': 'tnt' });
  assert.deepEqual(lootableChests(bot, { landmarks: [temple] }), []);
  const nether = world({ '22,64,21': 'chest' }, { dimension: 'the_nether' }).bot;
  assert.deepEqual(lootableChests(nether, { landmarks: [{ ...portal, dimension: 'the_nether' }] }), []);
});

test('a remembered structure with unopened chests is an idle option until it has been looted', async () => {
  assert(IDLE_OPTIONS.some(o => o.key === 'loot'));
  assert(WORLD_FIELDS.includes('looted'), 'what was looted is the world\'s, like the landmarks');
  const { bot, items } = world({ '22,64,21': 'chest' }, { position: new Vec3(-100, 64, -100) });
  const goal = { landmarks: [{ ...portal }] };
  assert.equal(unlootedLandmarks(bot, goal)[0].distance, 170);
  const navigate = async () => { bot.entity.position = new Vec3(18, 64, 18); };
  assert.equal(await lootStep(bot, task, goal, () => {}, { ...chestActions(items, [['iron_ingot', 3]]), navigate }), true);
  assert(goal.landmarks[0].lootedAt, 'done once its chests are open');
  assert.deepEqual(unlootedLandmarks(bot, goal), []);
});

test('a structure stood at with no chest is done too', async () => {
  const { bot, items } = world({}, { position: new Vec3(18, 64, 18) });
  const goal = { landmarks: [{ ...portal }] };
  assert.equal(await lootStep(bot, task, goal, () => {}, { ...chestActions(items, []), navigate: async () => {} }), false);
  assert(goal.landmarks[0].lootedAt);
});

test('what is worth taking', () => {
  const { bot } = world();
  for (const name of ['gold_ingot', 'gold_nugget', 'obsidian', 'flint_and_steel', 'golden_apple', 'golden_boots', 'iron_ingot', 'diamond', 'bread', 'string', 'gunpowder']) assert(wanted(bot, name), name);
  for (const name of ['rotten_flesh', 'golden_sword', 'light_weighted_pressure_plate']) assert(!wanted(bot, name), name);
  assert.equal(phraseTaken({ gold_ingot: 2 }), '2 gold ingot');
});

test('a mineshaft\'s chests ride in minecarts: opened as entities, one beside a spawner passed over', async () => {
  const { lootableMinecarts } = require('../src/looting');
  const shaft = { kind: 'mineshaft', x: 40, y: 30, z: 40, dimension: 'overworld' };
  const { bot, items } = world({}, { position: new Vec3(38, 30, 38) });
  const cart = { id: 5, uuid: 'cart-a', name: 'chest_minecart', position: new Vec3(41.5, 30, 42.5), isValid: true };
  bot.entities[5] = cart;
  const goal = { landmarks: [shaft] };
  assert.deepEqual(lootableMinecarts(bot, goal).map(e => e.id), [5]);
  const opened = [];
  const actions = { navigate: async () => { bot.entity.position = new Vec3(41, 30, 41); }, makeRoom: false,
    openEntity: async (b, t, e) => { opened.push(e.id); return { containerItems: () => [{ name: 'rail', count: 9, type: registry.itemsByName.rail.id }, { name: 'bread', count: 3, type: registry.itemsByName.bread.id }],
      withdraw: async (type, meta, count) => { items.push({ name: registry.items[type].name, count, type }); }, close() {} }; } };
  assert.equal(await lootNearby(bot, task, goal, () => {}, actions), true);
  assert.deepEqual(opened, [5]);
  assert(items.some(i => i.name === 'bread'));
  assert.deepEqual(goal.looted['cart:cart-a'].left, { rail: 9 });
  assert.deepEqual(lootableMinecarts(bot, goal), [], 'not opened twice');
  const guarded = world({ '41,31,45': 'spawner' }, { position: new Vec3(38, 30, 38) }).bot;
  guarded.entities[6] = { id: 6, uuid: 'cart-b', name: 'chest_minecart', position: new Vec3(41.5, 30, 42.5), isValid: true };
  assert.deepEqual(lootableMinecarts(guarded, { landmarks: [shaft] }), [], 'a cave spider spawner beside it');
});

test('a fortress chest is opened in the Nether only with no piglin in sight; a village chest in the Overworld', () => {
  const fortress = { kind: 'nether_fortress', x: 10, y: 70, z: 10, dimension: 'nether' };
  const { bot } = world({ '30,70,10': 'chest' }, { dimension: 'the_nether', position: new Vec3(25, 70, 10) });
  assert.equal(lootableChests(bot, { landmarks: [fortress] }).length, 1);
  bot.entities[9] = { id: 9, name: 'piglin', position: new Vec3(20, 70, 10), isValid: true };
  assert.equal(lootableChests(bot, { landmarks: [fortress] }).length, 0, 'a piglin looking on');
  const village = world({ '105,64,100': 'chest' }, { position: new Vec3(100, 64, 100) }).bot;
  assert.equal(lootableChests(village, { villages: [{ x: 100, y: 64, z: 100, dimension: 'overworld' }] }).length, 1);
});
