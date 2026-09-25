'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const { Task } = require('../src/skills');
const cache = require('../src/field-cache');
const { registry, establishedHome, LEVEL } = require('./fixtures/home-world');

const stack = (name, count) => ({ name, count, type: registry.itemsByName[name].id, stackSize: registry.itemsByName[name].stackSize });
// A chest the mock bot can open, whatever chest block is opened.
function chests(w) {
  const container = [];
  const window = {
    inventoryStart: 27, inventoryEnd: 63,
    items: () => w.bot.inventory.items().map(i => Object.assign(i, { slot: 27 + w.stacks.indexOf(i) })),
    containerItems: () => container.map((i, n) => Object.assign(i, { slot: n })),
    firstEmptyContainerSlot: () => container.length < 27 ? container.length : null,
    firstEmptyInventorySlot: () => 27 + w.stacks.length,
    get slots() { const all = Array(63).fill(null); container.forEach((c, n) => { all[n] = c; }); return all; },
    deposit: async (type, metadata, count) => { const name = registry.items[type].name; w.take(name, count); const c = container.find(i => i.name === name); if (c) c.count += count; else container.push(stack(name, count)); },
    withdraw: async (type, metadata, count) => { const name = registry.items[type].name; const c = container.find(i => i.name === name); c.count -= count; if (!c.count) container.splice(container.indexOf(c), 1); w.give(name, count); },
    close: () => {},
  };
  w.bot.openContainer = async block => { assert.equal(block.name, 'chest'); return window; };
  return container;
}

async function farFromHome(items) {
  const w = await establishedHome({ items });
  // Home, and its stash, five hundred blocks off.
  const h = w.goal.survival.home;
  h.origin = { ...h.origin, x: h.origin.x + 500 }; h.stash.position = { ...h.stash.position, x: h.stash.position.x + 500 };
  const said = []; w.bot.chat = line => said.push(line);
  const actions = { ...w.actions, acquireStep: async (b, t, item, count) => { w.give(item, count); } };
  return { ...w, said, actions };
}

test('five hundred blocks from home, the valuables go into a chest on the spot before the Nether', async () => {
  const w = await farFromHome([['diamond_pickaxe', 1], ['diamond', 3], ['raw_iron', 40], ['iron_ingot', 12], ['lapis_lazuli', 20], ['cooked_beef', 8], ['cobblestone', 64]]);
  const container = chests(w);
  assert.equal(await cache.cacheValuables(w.bot, new Task('win'), w.goal, w.save, w.actions), true);
  const stored = Object.fromEntries(container.map(i => [i.name, i.count]));
  assert.equal(stored.diamond, 3); assert.equal(stored.raw_iron, 40); assert.equal(stored.lapis_lazuli, 4, 'sixteen lapis stay for an enchant'); assert.equal(stored.iron_ingot, 4, 'eight ingots stay for a tool');
  assert(!stored.cooked_beef && !stored.cobblestone && !stored.diamond_pickaxe, 'food, stone and tools go with the bot');
  assert.equal(w.goal.caches.length, 1); assert.equal(w.goal.caches[0].contents.raw_iron, 40);
  assert.match(w.said[0], /in a chest here before the Nether/);
  assert.equal(w.nameAt(new Vec3(w.goal.caches[0].position.x, w.goal.caches[0].position.y, w.goal.caches[0].position.z)), 'chest');
});

test('with home in reach the home stash takes them and no chest is placed', async () => {
  const w = await establishedHome({ items: [['diamond', 3], ['raw_iron', 40]] });
  const placed = []; const actions = { ...w.actions, place: async (...a) => placed.push(a), acquireStep: async () => {} };
  assert.equal(await cache.cacheValuables(w.bot, new Task('win'), w.goal, w.save, actions), true);
  assert.deepEqual(placed, []); assert.equal(w.goal.caches, undefined);
});

test('on the way back the cache is emptied into the pockets', async () => {
  const w = await farFromHome([['diamond', 3], ['raw_iron', 40], ['iron_ingot', 8]]);
  const container = chests(w);
  await cache.cacheValuables(w.bot, new Task('win'), w.goal, w.save, w.actions);
  assert(!w.bot.inventory.items().some(i => i.name === 'raw_iron'));
  const near = cache.nearCache(w.bot, w.goal);
  assert(near, 'the cache is in reach');
  await cache.emptyCache(w.bot, new Task('win'), w.goal, w.save, w.actions, near.cache);
  assert.equal(w.bot.inventory.items().find(i => i.name === 'raw_iron')?.count, 40);
  assert.equal(w.bot.inventory.items().find(i => i.name === 'diamond')?.count, 3);
  assert.equal(container.length, 0);
  assert.equal(cache.nearCache(w.bot, w.goal), null, 'an empty cache is not visited again');
});

test('away from home, a chest here is on offer before any risk, when there is something to leave and the wood for a chest', async () => {
  const rich = await farFromHome([['gold_ingot', 3], ['raw_iron', 20], ['oak_planks', 8], ['cobblestone', 64]]);
  const offer = cache.cacheOffer(rich.bot, rich.goal);
  assert.match(offer.what, /3 gold ingot/); assert.match(offer.what, /20 raw iron/);
  assert.equal(offer.chest, 'a chest made from eight planks');
  const poor = await farFromHome([['diamond', 3], ['cobblestone', 64]]);
  assert.equal(cache.cacheOffer(poor.bot, poor.goal), null, 'no chest and no wood for one');
  const empty = await farFromHome([['oak_planks', 8], ['cobblestone', 64]]);
  assert.equal(cache.cacheOffer(empty.bot, empty.goal), null, 'nothing worth leaving');
  const home = await establishedHome({ items: [['diamond', 3], ['chest', 1]] });
  assert.equal(cache.cacheOffer(home.bot, home.goal), null, 'home\'s chest is in reach');
});
