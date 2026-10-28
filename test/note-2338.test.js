'use strict';
// A bed, wool, wood, raw meat and coal are worth a walk back to Jev's judgment (note 2338).
const test = require('node:test');
const assert = require('node:assert/strict');

test("full-14's drops are on the list: the bed, the mutton, the logs, the coal and the wool; the stone pickaxe is not", () => {
  const { worth } = require('../src/corpse-run');
  const w = worth({ spruce_log: 8, salmon: 1, black_bed: 1, coal: 8, gray_wool: 1, wooden_pickaxe: 1, crafting_table: 1, mutton: 9, feather: 2, dirt: 1, stone_pickaxe: 1 });
  for (const n of ['spruce_log', 'black_bed', 'coal', 'gray_wool', 'mutton', 'salmon', 'crafting_table']) assert.ok(w[n], n);
  for (const n of ['wooden_pickaxe', 'stone_pickaxe', 'dirt', 'feather']) assert.equal(w[n], undefined, n);
});
