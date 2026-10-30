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

// Note 2586: the walk ended a cell short of the drop; the bot steps onto its cell and takes it.
test('a drop the walk reached but stopped short of, within 2.5 blocks a block down, is stepped onto and taken (note 2586)', async () => {
  const skills = require('../src/skills'), dc = require('../src/drop-collection');
  const bot = fakeBot();
  const at = new Vec3(1.4, 63, 1.2);
  const e = { ...item(5, 'raw_iron', at), isValid: true };
  bot.entities = { 5: e };
  let carried = 0;
  bot.inventory = { items: () => carried ? [{ name: 'raw_iron', count: carried }] : [] };
  bot.blockAt = () => ({ name: 'stone', boundingBox: 'block' });
  dm.install(bot);
  bot.emit('entitySpawn', e);
  const real = Date.now, t0 = real(); Date.now = () => t0 + 4000;
  const walks = [];
  const origNav = skills.navigate, origCollect = dc.collectNearbyDrops;
  skills.navigate = async (b, t, goal) => { walks.push([goal.x, goal.y, goal.z]); if (goal.x === 1 && goal.y === 63 && goal.z === 1) carried = 1; };
  dc.collectNearbyDrops = async () => false;
  const log = console.log; console.log = () => {};
  try {
    const opt = dm.fetchOption(bot);
    assert.ok(opt, 'offered');
    const took = await opt.run(bot, { check() {} });
    assert.equal(took, true);
    assert.deepEqual(walks.at(-1), [1, 63, 1], 'stepped onto the drop\'s own cell');
  } finally { Date.now = real; skills.navigate = origNav; dc.collectNearbyDrops = origCollect; console.log = log; }
});

test('a drop walked to twice from about here and not taken is left out of the next walk and said; moved off, it is offered again with its tries (note 2586)', () => {
  const bot = fakeBot();
  const missed = item(6, 'raw_iron', new Vec3(5, 64, 0)), fresh = item(7, 'raw_gold', new Vec3(0, 64, 6));
  bot.entities = { 6: missed, 7: fresh };
  dm.install(bot);
  bot.emit('entitySpawn', missed); bot.emit('entitySpawn', fresh);
  const d = bot._dropMemory.drops.get(6); d.tries = 2; d.missFrom = { x: 0.5, z: 0.5 }; d.lastWhy = 'reached, not picked up (in water)';
  const real = Date.now, t0 = real(); Date.now = () => t0 + 4000;
  try {
    const here = dm.fetchOption(bot);
    assert.ok(here);
    assert.match(here.description, /^Go and pick up what of value was seen lying: 1 raw gold 6 blocks off/);
    assert.doesNotMatch(here.description, /1 raw iron 5 blocks off,/);
    assert.match(here.description, /Left out, walked to twice from about here and not taken: raw iron 5 blocks off\./);
    // Ten blocks on, the walk is from somewhere else: offered again, its tries said.
    bot.entity.position = new Vec3(12, 64, 0);
    const moved = dm.fetchOption(bot);
    assert.match(moved.description, /raw iron walked to 2 times, not taken \(reached, not picked up \(in water\)\)/);
    assert.doesNotMatch(moved.description, /Left out/);
  } finally { Date.now = real; }
});
