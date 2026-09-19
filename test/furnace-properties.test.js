'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { compatibilityPlugin } = require('../src/compatibility');

function fixture(initial = [[0, 100], [1, 300], [2, 80], [3, 200]]) {
  const bot = new EventEmitter(); bot._client = new EventEmitter();
  let id = 0;
  bot.openBlock = async () => {
    const window = new EventEmitter(); Object.assign(window, { id: ++id, type: 'minecraft:furnace', slots: [] });
    window.close = () => window.emit('close');
    // openBlock resolves from windowOpen, while initial properties can arrive
    // in the same socket read before openFurnace attaches its own listener.
    for (const [property, value] of initial) bot._client.emit('craft_progress_bar', { windowId: id, property, value });
    return window;
  };
  require('mineflayer/lib/plugins/furnace')(bot);
  compatibilityPlugin(bot);
  return bot;
}

test('reopening a burning furnace retains initial properties received before openFurnace resolves', async () => {
  const bot = fixture(), furnace = await bot.openFurnace({});
  try {
    assert.equal(furnace.fuelSeconds, 5, 'remaining burn is real fuel, not an empty slot');
    assert.equal(furnace.fuel, 1 / 3); assert.equal(furnace.totalFuel, 300);
    assert.equal(furnace.progress, .4); assert.equal(furnace.progressSeconds, 6);
  } finally { furnace.close(); }
});

test('fuel and progress properties stay correct regardless of packet order and unrelated windows', async () => {
  for (const initial of [[[0, 0], [1, 0], [2, 0], [3, 200]], [[3, 200], [2, 80], [1, 300], [0, 100]]]) {
    const bot = fixture(initial), furnace = await bot.openFurnace({});
    const property = (property, value, windowId = furnace.id) => bot._client.emit('craft_progress_bar', { windowId, property, value });
    try {
      property(0, 300); property(1, 300);
      assert.equal(furnace.fuel, 1); assert.equal(furnace.fuelSeconds, 15);
      property(1, 1600); assert.equal(furnace.fuel, 300 / 1600); assert.equal(furnace.fuelSeconds, 15);
      property(0, 0, furnace.id + 1); assert.equal(furnace.fuelSeconds, 15);
      property(0, 0); assert.equal(furnace.fuel, 0); assert.equal(furnace.fuelSeconds, 0);
      property(2, 100); property(3, 100); assert.equal(furnace.progress, 1); assert.equal(furnace.progressSeconds, 0);
    } finally { furnace.close(); }
  }
});

test('closing or failing to open a furnace removes observation and reopening never reuses old fuel', async () => {
  const bot = fixture(), before = bot._client.listenerCount('craft_progress_bar'), beforeEnd = bot.listenerCount('end');
  const furnace = await bot.openFurnace({});
  furnace.close(); assert.equal(bot._client.listenerCount('craft_progress_bar'), before);
  assert.equal(bot.listenerCount('end'), beforeEnd);
  bot.openBlock = async () => { throw new Error('cannot open'); };
  await assert.rejects(bot.openFurnace({}), /cannot open/);
  assert.equal(bot._client.listenerCount('craft_progress_bar'), before); assert.equal(bot.listenerCount('end'), beforeEnd);
  bot.openBlock = async () => {
    const window = new EventEmitter(); Object.assign(window, { id: furnace.id, type: 'minecraft:furnace', slots: [] });
    window.close = () => window.emit('close'); return window;
  };
  const next = await bot.openFurnace({});
  try { assert.equal(next.fuel, null); assert.equal(next.fuelSeconds, null); }
  finally { next.close(); }
});

test('disconnect during open cannot attach a new observer after its cleanup ran', async () => {
  const bot = fixture(), original = bot.openBlock, before = bot._client.listenerCount('craft_progress_bar'), beforeEnd = bot.listenerCount('end');
  bot.openBlock = async () => { const window = await original(); bot.emit('end'); return window; };
  await assert.rejects(bot.openFurnace({}), /Disconnected/);
  assert.equal(bot._client.listenerCount('craft_progress_bar'), before); assert.equal(bot.listenerCount('end'), beforeEnd);
});
