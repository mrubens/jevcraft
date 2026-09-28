'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureSupervisor, absences } = require('../scripts/lib/supervise');

test('a trial started on a port with no supervisor starts one, and leaves a running one alone', () => {
  const started = [];
  assert.equal(ensureSupervisor(25590, '/r', { has: () => false, start: (p, r) => started.push([p, r]) }), true);
  assert.deepEqual(started, [[25590, '/r']]);
  assert.equal(ensureSupervisor(25590, '/r', { has: () => true, start: () => started.push('again') }), false);
  assert.equal(started.length, 1);
});

test('absences: five minutes or more with no flight frame, and the tail once the window closed', () => {
  const m = 60000, f = t => ({ t: t * m });
  // mid-242-bd: frames for 33 minutes, then nothing to minute 180.
  const frames = [0, 1, 2, 10, 20, 33].map(f);
  assert.deepEqual(absences(frames, 0, 180 * m).map(g => [g.from / m, g.to / m]), [[2, 10], [10, 20], [20, 33], [33, 180]]);
  assert.deepEqual(absences(frames, 0, 180 * m, { closed: false }).map(g => [g.from / m, g.to / m]), [[2, 10], [10, 20], [20, 33]]);
  assert.deepEqual(absences([0, 1, 2, 3, 4, 5].map(f), 0, 5 * m), []);
});
