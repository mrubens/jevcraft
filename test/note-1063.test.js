'use strict';
// Note 1063: a question of the survival step turned back for a creeper
// within its alert is followed, in the same step, by the creeper's own.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Survival } = require('../src/survival');

function stepper({ refuse }) {
  const calls = { flee: 0, steps: 0 };
  const self = { bot: { entity: null },
    stepOnce: async () => { if (refuse) self._creeperRefused = { id: 'pocket_next', facts: { creeper: 3 }, at: Date.now() }; return true; },
    flee: async () => { calls.flee++; } };
  return { self, calls, step: () => Survival.prototype.step.call(self, { check() {} }, {}, () => {}, () => { calls.steps++; }) };
}

test('pocket_next turned back for a creeper 3 blocks off: the stance is asked in the same step', async () => {
  const lines = [], log = console.log; console.log = l => lines.push(String(l));
  try {
    const { self, calls, step } = stepper({ refuse: true });
    assert.equal(await step(), true);
    assert.equal(calls.flee, 1);
    assert.equal(self._creeperRefused, undefined);
    assert(lines.some(l => /pocket_next was not asked for a creeper 3 blocks off: its stance is asked in the same step/.test(l)), lines.join('\n'));
    // Said once in ten seconds, asked each step.
    await step();
    assert.equal(calls.flee, 2);
    assert.equal(lines.filter(l => /its stance is asked/.test(l)).length, 1);
  } finally { console.log = log; }
});

test('no question turned back: the step is as it was, and a refusal left from an earlier step is not answered late', async () => {
  const { self, calls, step } = stepper({ refuse: false });
  self._creeperRefused = { id: 'pocket_next', facts: { creeper: 3 }, at: Date.now() - 60000 };
  assert.equal(await step(), true);
  assert.equal(calls.flee, 0);
});
