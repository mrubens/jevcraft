'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { Vec3 } = require('vec3');
const dm = require('../src/drop-memory');

const fakeBot = () => {
  const bot = new EventEmitter();
  bot.entity = { position: new Vec3(0, 64, 0) };
  bot.game = { dimension: 'overworld' };
  bot.registry = { entitiesByName: { item: { id: 1 } } };
  bot.inventory = { items: () => [] };
  return bot;
};
const item = (id, name, at, count = 1) => ({ id, name: 'item', position: at, getDroppedItem: () => ({ name, count }) });

test('a valuable drop seen is remembered and offered with its distance and time left; dirt is not (note 2495)', () => {
  const bot = fakeBot(); dm.install(bot);
  bot.emit('entitySpawn', item(7, 'diamond', new Vec3(30, 64, 0), 2));
  bot.emit('entitySpawn', item(8, 'dirt', new Vec3(3, 64, 0)));
  const r = dm.remembered(bot);
  assert.deepEqual(r.map(d => [d.name, d.count, d.distance]), [['diamond', 2, 30]]);
  for (const d of bot._dropMemory.drops.values()) d.seenAt -= 5000; // a few seconds old (note 2532)
  const o = dm.fetchOption(bot);
  assert.match(o.description, /2 diamond 30 blocks off, about 5 minutes before it vanishes/);
});

test('gone from near the bot it is forgotten; gone from far off it is still lying (note 2495)', () => {
  const bot = fakeBot(); dm.install(bot);
  const near = item(1, 'raw_iron', new Vec3(5, 64, 0)), far = item(2, 'ender_pearl', new Vec3(60, 64, 0));
  bot.emit('entitySpawn', near); bot.emit('entitySpawn', far);
  bot.emit('entityGone', near); bot.emit('entityGone', far);
  assert.deepEqual(dm.remembered(bot).map(d => d.name), ['ender_pearl']);
});

test('a drop past its five minutes is not offered (note 2495)', () => {
  const bot = fakeBot(); dm.install(bot);
  bot.emit('entitySpawn', item(3, 'blaze_rod', new Vec3(10, 64, 0)));
  assert.equal(dm.remembered(bot, Date.now() + 5 * 60000 + 1).length, 0);
  assert.equal(dm.fetchOption(bot), null);
});

test('drops lying where the bot died are left to the corpse run even once its record is gone (note 2536)', () => {
  const { EventEmitter } = require('events');
  const { Vec3 } = require('vec3');
  const dm = require('../src/drop-memory');
  const bot = new EventEmitter();
  Object.assign(bot, { entity: { position: new Vec3(0, -13, 0) }, game: { dimension: 'overworld' }, entities: {}, registry: { entitiesByName: { item: { id: 1 } }, items: {} }, inventory: { items: () => [] } });
  dm.install(bot);
  bot.emit('death');
  const e = { id: 7, name: 'item', position: new Vec3(1, -13, 1), getDroppedItem: () => ({ name: 'diamond', count: 1 }) };
  bot.entities[7] = e; bot.emit('entitySpawn', e);
  for (const d of bot._dropMemory.drops.values()) d.seenAt -= 5000;
  bot.entity.position = new Vec3(0, 62, 0);
  assert.strictEqual(dm.fetchOption(bot), null);
});
