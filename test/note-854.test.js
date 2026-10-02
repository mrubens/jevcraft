'use strict';
// Note 854: a turn of the strategy to another rung or a side trip cuts the
// work's answers under way short; they are not tries that came to nothing.
// 25584 (mid-218-au, 2026-10-02 01:11:59Z) took a side trip a second into
// digging its portal site, and the dig was then offered as having come to
// nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const tried = require('../src/tried');

test('cut with `before` marks only the answers given before then (note 854)', () => {
  const now = Date.now();
  const goal = { tried: { entries: [
    { q: 'surface_trip', method: 'dig_site', outcome: 'pending', at: now - 2000 },
    { q: 'win_strategy', method: 'side_trip', outcome: 'pending', at: now - 100 },
  ] } };
  tried.cut(goal, 'left for side trip (win_strategy)', now, { before: now - 500 });
  assert.equal(goal.tried.entries[0].cut, 'left for side trip (win_strategy)');
  assert.equal(goal.tried.entries[1].cut, undefined);
  // Without it, as before: every pending answer.
  tried.cut(goal, 'cut short: x', now);
  assert.equal(goal.tried.entries[1].cut, 'cut short: x');
});
