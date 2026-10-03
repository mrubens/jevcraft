'use strict';
// Note 1126: the trial's hours are by what the bot holds, kept and carried.
// 25597 (2026-10-03): seven rods kept, six taken out to carry home, read as keeping one, ended "missing after 6 hours" eleven hours in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

test('six rods carried and one kept, seven hours in: the twelve hours, not six; nothing carried and one kept: ended', () => {
  const { verdict } = require('../scripts/midgame');
  const identity = '127_0_0_1-25993-Jev';
  const t0 = Date.parse('2026-10-03T08:00:00Z');
  const make = rods => {
    const frames = [];
    for (let s = 0; s < 600; s += 5) frames.push({ at: new Date(t0 + s * 1000).toISOString(), kind: 'observation', snapshot: { position: { x: s / 5, y: 64, z: 0 }, dimension: 'the_nether', health: 20, inventory: { netherrack: 20, ...(rods ? { blaze_rod: rods } : {}) }, step: { action: 'return_to_portal' } } });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-1126-'));
    fs.writeFileSync(path.join(dir, `${identity}-${new Date(t0).toISOString().replace(/[:.]/g, '-')}.jsonl`), frames.map(f => JSON.stringify(f)).join('\n') + '\n');
    return dir;
  };
  const at = { world: 'mid-242-zz-nether-1', startedAt: new Date(t0).toISOString() }, now = t0 + 7 * 3600000;
  const carrying = make(6), empty = make(0);
  try {
    const on = verdict(at, { now, dir: carrying, identity, kept: { rods: 1, pearls: 0 } });
    assert.ok(!on.reasons.some(r => /^missing after/.test(r)), JSON.stringify(on.reasons));
    const off = verdict(at, { now, dir: empty, identity, kept: { rods: 1, pearls: 0 } });
    assert.ok(off.reasons.some(r => /^missing after .*6 hours/.test(r)), JSON.stringify(off.reasons));
  } finally { fs.rmSync(carrying, { recursive: true, force: true }); fs.rmSync(empty, { recursive: true, force: true }); }
});
