'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('minecraft-data')('26.1');
const { wantOf, describe, tradeOptions, spare } = require('../src/trading');

const bot = (stock = {}, worn = {}) => ({ registry, inventory: { items: () => Object.entries(stock).map(([name, count]) => ({ name, count })), slots: Object.assign([], worn) } });
const trade = (input, inCount, output, outCount, extra = {}) => ({ inputItem1: { name: input, count: inCount }, outputItem: { name: output, count: outCount }, nbTradeUses: 0, maximumNbTradeUses: 12, ...extra });

test('what the run wants to buy: pearls, arrows short of a stack, a bow, better armour; not what it has', () => {
  const b = bot({ arrow: 10, iron_sword: 1 }, { 6: { name: 'iron_chestplate' } });
  assert(wantOf(b, 'ender_pearl'));
  assert(wantOf(b, 'arrow'));
  assert(wantOf(b, 'bow'));
  assert(wantOf(b, 'diamond_chestplate'), 'better than the iron one worn');
  assert.equal(wantOf(b, 'iron_chestplate'), null, 'no better than the one worn');
  assert.equal(wantOf(b, 'stone_sword'), null);
  assert.equal(wantOf(bot({ arrow: 64 }), 'arrow'), null);
});

test('a sale is only of what is spare above what is kept back', () => {
  assert.equal(spare(bot({ coal: 200 }), 'coal'), 184);
  assert.equal(spare(bot({ stick: 8 }), 'stick'), 0);
  assert.equal(spare(bot({ diamond: 5 }), 'diamond'), 0, 'not on the sell list');
});

test('feasible trades, wanted buys first and pearls first among them; sales only while emeralds are short', () => {
  const b = bot({ emerald: 6, coal: 64, stick: 40 });
  const cleric = { id: 1, uuid: 'c' }, smith = { id: 2, uuid: 's' };
  const goal = { trading: { offers: {
    c: { trades: [trade('emerald', 5, 'ender_pearl', 1), trade('emerald', 20, 'ender_pearl', 1)] },
    s: { trades: [trade('coal', 15, 'emerald', 1), trade('emerald', 1, 'arrow', 16), trade('coal', 15, 'emerald', 1, { tradeDisabled: true })] } } } };
  const options = tradeOptions(b, goal, [cleric, smith]);
  assert.deepEqual(options.map(o => `${o.kind}:${o.output.name}`), ['buy:ender_pearl', 'buy:arrow', 'sell:emerald']);
  assert(!options.some(o => o.input.count === 20), 'twenty emeralds is not affordable');
  const rich = bot({ emerald: 64, coal: 64 });
  assert(!tradeOptions(rich, goal, [cleric, smith]).some(o => o.kind === 'sell'), 'no selling with emeralds to spare');
});

test('with a pearl on offer the emeralds cannot yet pay for, they are saved: no arrows, sales go on', () => {
  const b = bot({ emerald: 3, coal: 64, stick: 40 });
  const goal = { trading: { offers: {
    c: { trades: [trade('emerald', 5, 'ender_pearl', 1)] },
    f: { trades: [trade('stick', 32, 'emerald', 1), trade('emerald', 1, 'arrow', 16)] } } } };
  const options = tradeOptions(b, goal, [{ uuid: 'c' }, { uuid: 'f' }]);
  assert.deepEqual(options.map(o => `${o.kind}:${o.input.name}`), ['sell:stick']);
});
