'use strict';
// Note 1013: alight and out of the flames, the meal carried is a way.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const vitals = require('../src/vitals');

function burning({ food = 17, stock = [['cooked_beef', 3]] } = {}) {
  const registry = require('minecraft-data')('26.1'), Block = require('prismarine-block')(registry);
  const blockAt = p => { const f = p.floored(); const b = Block.fromStateId(registry.blocksByName[f.y <= 63 ? 'netherrack' : 'air'].defaultState); b.position = f; return b; };
  const items = stock.map(([name, count]) => ({ name, type: registry.itemsByName[name].id, count }));
  const bot = Object.assign(new EventEmitter(), { registry, game: { dimension: 'the_nether', gameMode: 'survival', difficulty: 'normal' }, health: 12.6, food, oxygenLevel: 20, entities: {},
    entity: { position: new Vec3(0.5, 64, 0.5), onGround: true, metadata: [], yaw: 0, pitch: 0, height: 1.8, isOnFire: true, velocity: new Vec3(0, 0, 0) }, time: { timeOfDay: 6000 },
    inventory: { items: () => items.filter(i => i.count > 0), slots: {} }, blockAt, world: { raycast: () => null },
    equip: async item => { bot.heldItem = item; }, deactivateItem() {}, clearControlStates() {},
    consume: async () => { items[0].count--; bot.food = Math.min(20, bot.food + 8); } });
  bot._burnUntil = Date.now() + 6000;
  return bot;
}

test('alight out of the fire with food carried and hunger 17, eating it is a way, said with what it brings; with none carried or hunger full it is not', async () => {
  const bot = burning();
  const ways = vitals.fireWays(bot, { check() {}, cancelled: false }, () => {});
  assert.ok(ways.eat_meal, `ways: ${Object.keys(ways)}`);
  assert.match(ways.eat_meal.description, /Eat the cooked beef now while the fire burns on: about 1\.6 seconds standing still, hunger 17 to 20; at hunger 20 with the meal's saturation a health comes back each half second, twice what the fire takes \(at 17 now nothing does\)\./);
  assert.equal(await ways.eat_meal.run(), true);
  assert.equal(bot.food, 20);
  assert.equal(vitals.fireWays(burning({ stock: [] }), { check() {} }, () => {}).eat_meal, undefined);
  assert.equal(vitals.fireWays(burning({ food: 20 }), { check() {} }, () => {}).eat_meal, undefined);
});
