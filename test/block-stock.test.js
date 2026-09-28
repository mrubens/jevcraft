'use strict';
// The stock of blocks as a finite thing (note 642): mid-243-ah-fortress-7
// (25589) began at a fortress with 90 blocks and no pickaxe, laid them all
// on two crossings of the lava sea and stood on its own 15-block span for
// three hours, told in each option only what it spent.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Vec3 } = require('vec3');
const registry = require('minecraft-data')('26.1');
const stock = require('../src/block-stock');

const botWith = (items, dimension = 'the_nether') => ({
  entity: { position: new Vec3(0.5, 57, 0.5) }, game: { dimension, gameMode: 'survival' }, registry, health: 17, food: 16,
  time: { timeOfDay: 6000 }, entities: {}, inventory: { items: () => items.map(([name, count]) => ({ name, count })) },
});

test('with no pickaxe in the Nether the standing fact says none comes back, and what making one takes against what is carried (25589 at 20:30Z: 31 iron, 3 sticks, 1 plank)', () => {
  const bot = botWith([['iron_ingot', 31], ['stick', 3], ['oak_planks', 1], ['coal', 148], ['gravel', 16], ['bucket', 6]]);
  const says = stock.stockSays(bot);
  assert.equal(says.canBeLaid, 0);
  assert.match(says.none, /no block that holds is carried and none can be had/);
  assert.match(says.none, /drop nothing/);
  assert.match(says.none, /stops at its first gap/);
  assert.match(says.makingAPickaxe, /Carried: 31 iron ingots; 3 sticks; 1 plank; no crafting table/);
  assert.match(says.makingAPickaxe, /wood is what is missing/);
});

test('the fact is left out where blocks can be dug or the Nether is not the place: a pickaxe carried, the Overworld', () => {
  assert.equal(stock.stockSays(botWith([['iron_pickaxe', 1]])), null);
  assert.equal(stock.stockSays(botWith([['cobblestone', 4]], 'overworld')), null);
});

test('blocks carried are counted as what can be laid, and still said not to come back', () => {
  const says = stock.stockSays(botWith([['basalt', 12], ['gravel', 16]]));
  assert.equal(says.canBeLaid, 12);
  assert.match(says.comesBack, /No pickaxe is carried, so no block comes back/);
  assert.equal(says.none, undefined);
});

test('a way that lays blocks says what is left is not renewed, and what none left closes (25589: "15 blocks carried, 0 left after")', () => {
  assert.equal(stock.afterSays({ noPickaxe: false, left: 0 }), '');
  assert.match(stock.afterSays({ noPickaxe: true, left: 20 }), /none of the 20 left comes back or can be dug/);
  const none = stock.afterSays({ noPickaxe: true, left: 0 });
  assert.match(none, /After it none is left to lay, and none can be had here/);
  assert.match(none, /every way from where it ends that lays a block/);
  assert.match(none, /the floor already laid or standing is all the floor there is/);
});

test('the crossing and the leg say it: the last blocks spent with no pickaxe', () => {
  const { crossingSays, legSays } = require('../src/nether-travel');
  const survey = { cells: 15, dig: 1, bridge: 15, overLava: 15, carried: 15, noPickaxe: true, gain: 15, from: 35, stoppedBy: null, digSeconds: 6 };
  assert.match(crossingSays(survey, 'the fortress'), /15 blocks carried, 0 left after\. No pickaxe is carried, so no block comes back.*After it none is left to lay/);
  assert.doesNotMatch(crossingSays({ ...survey, noPickaxe: false }, 'the fortress'), /pickaxe/);
  const leg = { cells: 96, open: 66, rock: 30, cavern: 66, lay: 66, carried: 0, noPickaxe: true, runsOut: 0, reach: 0, reachSeconds: 0, seconds: 270, stoppedBy: null, first: [] };
  assert.match(legSays(leg, { direction: 'east', length: 96, y: 57 }), /where the leg stops with none to lay\. No pickaxe is carried.*After it none is left to lay/);
});

test('every gameplay question in the Nether with no pickaxe carries the stock, and is told what it is', async () => {
  const { decide } = require('../src/decisions');
  const bot = botWith([['iron_ingot', 31], ['stick', 3]]);
  const asked = [];
  const client = { systemOne: async ({ state, questions }) => { asked.push({ state, said: JSON.stringify(questions) }); return { answers: { branch_0: { choice: 'go_in', confidence: 0.9 } } }; } };
  await decide('fortress_visit', { client, bot, goal: {}, tree: { go_in: { description: 'a' }, go_back: { description: 'b' } }, state: { visit: 'about to approach a Nether fortress' } });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].state.blockStock.canBeLaid, 0);
  assert.match(asked[0].said, /blockStock is what can be laid/);
  // With a pickaxe it is not on the state.
  const withPick = botWith([['iron_pickaxe', 1]]);
  await decide('fortress_visit', { client, bot: withPick, goal: {}, tree: { go_in: { description: 'a' }, go_back: { description: 'b' } }, state: { visit: 'about to approach a Nether fortress' } });
  assert.equal(asked[1].state.blockStock, undefined);
});
