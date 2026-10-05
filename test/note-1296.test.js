'use strict';
// Note 1296: what hunger does from six down, said beside the work.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');

test('hunger 3 and nothing to eat: no sprint, the drain at 0 and how fast hunger falls are said; at hunger 10 they are not', () => {
  const { workBodySays } = require('../src/arbiter');
  const bot = (food) => ({ health: 16, food, game: { difficulty: 'normal', dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) }, entities: {}, inventory: { items: () => [] }, registry: require('minecraft-data')('26.1') });
  const low = workBodySays(bot(3), []);
  assert.match(low, /At hunger 6 or less the bot cannot sprint; at 0 health falls a point every four seconds, to a single point; sprinting costs a point of hunger for about every 40 blocks\./);
  assert.doesNotMatch(workBodySays(bot(10), []), /cannot sprint/);
});


test('by night in the Overworld, next to bare: the night\'s record is said beside the work (note 1302)', () => {
  const { workBodySays } = require('../src/arbiter');
  const bot = t => ({ health: 20, food: 20, time: { timeOfDay: t }, game: { difficulty: 'normal', dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) }, entities: {}, inventory: { items: () => [], slots: [] }, registry: require('minecraft-data')('26.1') });
  assert.match(workBodySays(bot(16000), []), /With next to no armour on at night in the Overworld, the record .*: staying up at the work was followed by a death within five minutes 2 times in 21/);
  assert.doesNotMatch(workBodySays(bot(6000), []), /next to no armour/);
});

test('a hunt is said with how the bot\'s own hunts of that mob went (note 1309)', () => {
  const src = require('fs').readFileSync(require.resolve('../src/mob-hunt'), 'utf8');
  assert.match(src, /spider: \{ n: 86, died5: 15 \}/);
  assert.match(src, /were followed by a death within five minutes/);
});

test('cooking the raw meat carried is said in points, raw and cooked (note 1312)', () => {
  const { idleOptions } = require('../src/work');
  const reg = require('minecraft-data')('26.1');
  const items = [{ name: 'beef', count: 18, type: reg.itemsByName.beef.id }];
  const bot = { registry: reg, version: '26.1', game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 64, 0) }, inventory: { items: () => items, slots: [] }, findBlocks: () => [], blockAt: () => null };
  const o = idleOptions(bot, {});
  assert.match(o.cook_food.description, /Cook the 18 raw beef being carried: 54 food points eaten raw, 144 cooked \(\+90\)/);
});

test('a heading with a swim says the drowned with it (note 1320)', () => {
  const { headingFacts } = require('../src/exploration');
  const ground = [{ d: 4, water: false }, { d: 8, water: true }, { d: 20, water: true }, { d: 24, water: false, x: 24, z: 0 }];
  const s = headingFacts([{ biome: 'beach', from: 0, to: 30, has: 'no trees' }], ground);
  assert.match(s, /a swim of about 16; drowned live in the water and come up after a swimmer, 9 of the 41 Overworld deaths/);
});

test('raw meat carried with fuel and a furnace: cooking it now is an upkeep offer, said in points (note 1323)', async () => {
  const { upkeepOffers } = require('../src/work');
  const reg = require('minecraft-data')('26.1');
  const items = [['beef', 6], ['coal', 4], ['furnace', 1], ['stone_pickaxe', 1]].map(([name, count], i) => ({ name, count, type: reg.itemsByName[name].id, slot: 9 + i, durabilityUsed: 0 }));
  const bot = { registry: reg, version: '26.1', game: { dimension: 'overworld', gameMode: 'survival' }, time: { timeOfDay: 6000 }, health: 20, food: 15, entity: { position: new Vec3(0, 64, 0) }, entities: {},
    inventory: { items: () => items, slots: [], emptySlotCount: () => 20 }, findBlocks: () => [], blockAt: p => ({ name: p.y < 64 ? 'stone' : 'air', boundingBox: p.y < 64 ? 'block' : 'empty', position: p }) };
  const { options } = await upkeepOffers(bot, { check() {} }, { kind: 'win' }, () => {});
  assert.ok(options.cook_meat, Object.keys(options).join(','));
  assert.match(options.cook_meat.description, /Cook the raw meat carried now: 6 beef, 18 food points as carried and 48 cooked \(\+30\); the furnace carried put down here, coal for fuel/);
});
