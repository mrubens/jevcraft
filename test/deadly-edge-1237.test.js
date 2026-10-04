'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { deadlyEdgeWalk } = require('../src/survival');

test('a walk beside lava with a shot likelier than not to land on the way is not a way on offer (note 1237)', () => {
  assert.equal(deadlyEdgeWalk({ beside: 2, chance: 75, drop: { into: 'lava', fall: 18 } }), true, '25597 at 16:12:54Z');
  assert.equal(deadlyEdgeWalk({ beside: 2, chance: 30, drop: { into: 'lava', fall: 18 } }), false, 'the shot unlikely: said and priced, Jev\'s');
  assert.equal(deadlyEdgeWalk({ beside: 0, chance: 90 }), false, 'no cell beside a drop');
  assert.equal(deadlyEdgeWalk({ beside: 1, chance: 80, drop: { into: 'ground', fall: 6 } }), false, 'a fall that costs half the health is priced, not barred');
  assert.equal(deadlyEdgeWalk({ beside: 4, chance: 100, drop: { into: 'lava', fall: 30 } }, true), false, 'on a ridge already: the walk is the way off it (note 610)');
  assert.equal(deadlyEdgeWalk(null), false);
});
