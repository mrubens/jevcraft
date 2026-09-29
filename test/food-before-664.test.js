'use strict';
// Note 664: food before the fortress, as facts with numbers (src/food-facts.js), put in the fortress
// visit's state and options and the crossing kit's food line. Nothing is gated: each is a fact or a way.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Vec3 } = require('vec3');
const ff = require('../src/food-facts');
const visit = require('../src/fortress-visit');
require('../src/decisions/travel');

const registry = require('minecraft-data')('26.1');
function bot({ health = 20, food = 20, items = [['iron_sword', 1]], nether = true } = {}) {
  const stock = items.map(([name, count]) => ({ name, type: registry.itemsByName[name].id, count, durabilityUsed: 0 }));
  const slots = { 45: { name: 'shield' }, 5: { name: 'iron_helmet' }, 6: { name: 'iron_chestplate' } };
  return Object.assign(new EventEmitter(), { game: { dimension: nether ? 'the_nether' : 'overworld', gameMode: 'survival', difficulty: 'normal' }, health, food, foodSaturation: 0, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, metadata: [], yaw: 0, pitch: 0, height: 1.8, width: 0.6 }, registry, time: { timeOfDay: 6000 },
    inventory: { items: () => stock, slots }, blockAt: () => ({ name: 'netherrack', boundingBox: 'block', position: new Vec3(0, 63, 0) }), world: { raycast: () => null } });
}
const goalOf = () => ({ portals: [{ dimension: 'nether', x: 0, y: 64, z: 300 }, { dimension: 'overworld', x: 0, y: 70, z: 37 }], survival: { deaths: [] } });
const fortress = { distance: 40, height: 0, at: { x: 40, y: 64, z: 0 } };
const actions = { navigate: async () => {}, returnOverworld: async () => {} };

test('the record adds up: the four food rows are the fights counted, and the two cells of nothing to eat are one row', () => {
  const R = ff.RECORD, b = R.byCarried;
  assert.equal(b.none.fights + b.few.fights + b.some.fights + b.many.fights, R.fights);
  assert.equal(R.hungryNothing.fights + R.fedNothing.fights, b.none.fights);
  assert.equal(R.hungryWithFood.fights + R.fedWithFood.fights, b.few.fights + b.some.fights + b.many.fights);
  const c = R.crossings; assert.equal(c.none + c.few + c.some + c.many, c.n);
});

test('hunger 20 with nothing to eat: health comes back now, under 18 in about three minutes of fighting, the record row for the hungry-nothing cell is not the bot\'s yet', () => {
  const b = bot({ food: 20 });
  assert.match(ff.regenSays(b), /only at hunger 18 or more.*not at all below 18; at hunger 6 or less the bot cannot sprint/);
  assert.match(ff.clockSays(b), /under 18 in about 3\.3 minutes of fighting with no eating and nothing is carried to eat/);
  assert.match(ff.clockSays(b), /0\.9 a minute of fighting/);
  assert.match(ff.recordSays(b), /nothing to eat carried at hunger 18 or more, the bot's own row: 22 fights, 23% died, 27% brought a rod/);
});

test('hunger 14 with nothing to eat: the cell that stands apart, 92 fights and 47% dead, said as the bot\'s own row; nothing heals until it eats', () => {
  const b = bot({ food: 14, health: 9 });
  assert.match(ff.regenSays(b), /no health comes back and nothing carried is food/);
  assert.match(ff.clockSays(b), /already 14, under 18: nothing here heals until it is eaten back up/);
  assert.match(ff.recordSays(b), /hunger under 18 and nothing to eat carried, the bot's own row: 92 fights, 47% died, 12% brought a rod/);
});

test('food carried: points, the minutes it holds at the measured spend as an upper bound, and the row it is in', () => {
  const b = bot({ food: 19, items: [['iron_sword', 1], ['cooked_beef', 3], ['beef', 2]] });
  const s = ff.beforeSays(b, goalOf());
  assert.match(s.foodCarried, /^30 hunger points/);
  assert.match(s.foodCarried, /the 2 raw meat carried would be 10 points more cooked/);
  // (19 - 17 + 30) / 0.9 = 35.6
  assert.match(s.minutesOfFighting, /at most about 35\.6 minutes if all 30 carried points are eaten as it falls \(the bar caps at 20, so this is an upper bound\)/);
  assert.match(s.playedRecord, /24 points or more: 310 fights, 22% died, 44% brought a rod/);
  assert.match(s.healthRegen, /hunger 19: health is full|hunger 19: health comes back now/);
});

test('the ways say the Overworld food without pigs or chickens, and that barter gives no food and a hoglin has forty health', () => {
  const nether = ff.waysSays(bot(), goalOf(), { trip: 'a trip of 300 blocks' });
  assert.match(nether, /Piglin barter gives no food at all/);
  assert.match(nether, /a hoglin drops 2 to 4 raw porkchops \(3 each raw, 8 cooked\) but has forty health/);
  assert.match(nether, /a trip of 300 blocks/);
  assert.match(nether, /cows \(1 to 3 raw beef, 3 each, 8 cooked\), sheep \(1 to 2 raw mutton, 2 each, 6 cooked\), rabbits/);
  assert.match(nether, /this bot never hurts pigs or chickens, so those are not on the list/);
  assert.doesNotMatch(nether, /pigs are|kill a pig|chicken \(/);
});

test('fortress_visit carries the food facts in its state and, with nothing carried, prices the way home and the ways to food here at any hunger', () => {
  const b = bot({ food: 20 });
  const { state } = visit.facts(b, goalOf(), { fortress });
  assert.match(state.foodBeforeTheFight.foodCarried, /^0 hunger points \(nothing to eat\)/);
  assert.match(state.foodBeforeTheFight.healthRegen, /not at all below 18/);
  assert.match(state.foodBeforeTheFight.ways, /Piglin barter gives no food/);
  const tree = visit.options(b, null, goalOf(), () => {}, actions, { fortress, leave: () => {} });
  assert.deepEqual(Object.keys(tree).sort(), ['get_food_here', 'go_back', 'go_in', 'leave_fortress']);
  assert.match(tree.go_in.description, /Food: .*under 18 in about 3\.3 minutes of fighting with no eating.* Health comes back only at hunger 18 or more\./);
  assert.match(tree.go_back.description, /cows \(1 to 3 raw beef.*never hurts pigs or chickens/);
  assert.match(tree.go_back.description, /nothing to eat carried at hunger 18 or more, the bot's own row: 22 fights/);
  assert.match(tree.get_food_here.description, /Get food here before going on/);
});

test('with the stay\'s food carried (no way home is priced for food, no ways here), and heal_first says the healing holds only while hunger does', () => {
  const b = bot({ health: 12, food: 18, items: [['iron_sword', 1], ['cooked_beef', 20]] });
  const tree = visit.options(b, null, goalOf(), () => {}, actions, { fortress, leave: () => {} });
  assert.deepEqual(Object.keys(tree).sort(), ['go_in', 'heal_first', 'leave_fortress']);
  assert.match(tree.heal_first.description, /What it heals to holds only while hunger stays at 18 or more: .*at most about/);
});

test('the crossing kit\'s food line says whether health comes back, the minutes food holds and the played row, and the trip home names no pigs', () => {
  const { kitItems } = require('../src/crossing-kit');
  const b = bot({ food: 15, nether: false });
  const food = kitItems(b).find(i => i.key === 'food');
  assert.match(food.says, /not at all below 18/);
  assert.match(food.says, /hunger 15: no health comes back and nothing carried is food/);
  assert.match(food.says, /hunger under 18 and nothing to eat carried, the bot's own row: 92 fights/);
  const goal = goalOf(); goal.portals.push({ dimension: 'overworld', x: 0, y: 70, z: 0 });
  assert.match(require('../src/healing').overworldFoodSays(b, { ...goal, portals: [{ dimension: 'overworld', x: 0, y: 70, z: 0 }] }), /cows, sheep and rabbits are common on grass \(the bot never hurts pigs or chickens\)/);
});
