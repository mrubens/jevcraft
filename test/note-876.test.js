'use strict';
// Note 876: a step that ends the window in a phase or at a block it had not
// named before in it has moved on, and is no flip; a cycle through the same
// phases still is (note 767's test keeps the plain case).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyse } = require('../scripts/lib/audit');

function run(phases) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-876-'));
  const t0 = Date.parse('2026-10-02T13:25:00Z');
  const lines = [];
  const at = s => new Date(t0 + s * 1000).toISOString();
  const obs = (s, step) => lines.push(JSON.stringify({ kind: 'observation', label: 'observation', snapshot: { position: { x: -165.3, y: 25, z: -693.5 }, step }, at: at(s) }));
  const label = { action: 'enter_nether', phase: 'reach_nether' };
  phases.forEach(([phase, where], k) => {
    const cast = { action: 'cast_portal', item: 'obsidian', slot: { x: -166, y: 25, z: -694 }, phase, ...(where ? { at: where } : {}) };
    obs(k * 4, cast); obs(k * 4 + 1, cast);
    obs(k * 4 + 2, label); obs(k * 4 + 3, label);
    lines.push(JSON.stringify({ kind: 'decision', label: 'here_pool_0', snapshot: { decision: { id: 'portal_plan', path: ['here_pool_0'] } }, at: at(k * 4 + 2.5) }));
  });
  fs.writeFileSync(path.join(dir, '127_0_0_1-25583-Jev-2026-10-02T13-22-00-000Z.jsonl'), lines.join('\n') + '\n');
  return analyse({ identity: '127_0_0_1-25583-Jev', from: t0 - 1000, to: t0 + 60000, dir }).flips.map(f => f.between);
}

test('mid-227-bm: the cast walked to its stand, then cleared one blocker and another, the crossing\'s label between: no flip (note 876)', () => {
  assert.deepEqual(run([['to_stand'], ['to_stand'], ['clear_blocker', { x: -166, y: 26, z: -695 }], ['clear_blocker', { x: -165, y: 27, z: -693 }]]), []);
});

test('a cast back at the stand it left, then the blocker it cleared: still a flip', () => {
  const A = { x: -166, y: 26, z: -695 };
  assert.deepEqual(run([['to_stand'], ['clear_blocker', A], ['to_stand'], ['clear_blocker', A]]), ['cast_portal <-> enter_nether (asking)']);
});
