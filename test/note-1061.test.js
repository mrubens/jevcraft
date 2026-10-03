'use strict';
// Note 1061: every kind of food known has a way in the step that goes for
// it, and a batch in a furnace that could not be had rests as a source.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Vec3 } = require('vec3');
const { foodSources } = require('../src/healing');
const { setAside } = require('../src/progress');

const bot = () => ({ registry: require('minecraft-data')('26.1'), game: { dimension: 'overworld' }, entity: { position: new Vec3(0, 87, -146) }, entities: {} });
const batch = () => ({ item: 'cooked_mutton', count: 2, position: { x: -19, y: 87, z: -146 }, dimension: 'overworld', startedAt: Date.now() - 60000 });

test('each kind of food source healing.js names has its branch in the step that goes for the food known', () => {
  const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  const kinds = [...new Set([...read('healing.js').matchAll(/found\.push\(\{ kind: '([a-z_]+)'/g)].map(m => m[1]))];
  assert(kinds.includes('furnace') && kinds.length >= 5, kinds.join(','));
  const work = read('work.js');
  const from = work.indexOf('async function gatherNetherFood'), body = work.slice(from, work.indexOf('const survivalState', from));
  for (const k of kinds) assert(body.includes(`src.kind === '${k}'`), `no way for the ${k} in gatherNetherFood: the step comes back with nothing done`);
});

test('the batch in the furnace is not named as food once gone for and not had, or left for good', () => {
  const goal = { smelting: batch() };
  assert(foodSources(bot(), goal).some(s => s.kind === 'furnace'));
  setAside(goal, 'food_source', 'furnace', 'no route', 600000);
  assert(!foodSources(bot(), goal).some(s => s.kind === 'furnace'));
  const left = { smelting: { ...batch(), left: { at: Date.now(), forgone: Date.now() } } };
  assert(!foodSources(bot(), left).some(s => s.kind === 'furnace'));
});
