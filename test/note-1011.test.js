'use strict';
// Note 1011: once a pearl has been got in the trial, a loop is not its end:
// the hunt for them is a stalk and a fight in turn.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

function flightDir(frames, identity) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-1011-'));
  const start = new Date(frames[0].t).toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(dir, `${identity}-${start}.jsonl`), frames.map(({ t, ...f }) => JSON.stringify({ ...f, at: new Date(t).toISOString() })).join('\n') + '\n');
  return dir;
}
// Ten minutes of play, then the hunt's two steps trading names in place for a minute.
function trial(pearlsFrom) {
  const t0 = Date.parse('2026-10-03T07:20:00Z'), frames = [];
  const inv = s => ({ netherrack: 20, ...(pearlsFrom != null && s >= pearlsFrom ? { ender_pearl: 1 } : {}) });
  for (let s = 0; s < 600; s += 5) frames.push({ t: t0 + s * 1000, kind: 'observation', snapshot: { position: { x: s / 5, y: 64, z: 0 }, dimension: 'the_nether', health: 20, inventory: inv(s), step: { action: 'find_fortress' } } });
  for (let k = 0; k < 16; k++) frames.push({ t: t0 + (600 + k * 3) * 1000, kind: 'observation', snapshot: { position: { x: 120, y: 64, z: 0 }, dimension: 'the_nether', health: 20, inventory: inv(600 + k * 3), step: { action: k % 2 ? 'acquire' : 'stalk_mob' } } });
  return { t0, frames };
}

test('the stalk and the fight trading places: a loop where no pearl was ever got; not the trial\'s end where one was', () => {
  const { verdict } = require('../scripts/midgame');
  const identity = '127_0_0_1-25994-Jev';
  const none = trial(null), d1 = flightDir(none.frames, identity);
  const got = trial(300), d2 = flightDir(got.frames, identity);
  try {
    const a = verdict({ world: 'mid-242-zz-nether-1', startedAt: new Date(none.t0).toISOString() }, { now: none.t0 + 650000, dir: d1, identity });
    assert.ok(a.reasons.some(r => /^loop: flipping stalk_mob <-> acquire|^loop: flipping acquire <-> stalk_mob/.test(r)), JSON.stringify(a.reasons));
    const b = verdict({ world: 'mid-242-zz-nether-1', startedAt: new Date(got.t0).toISOString() }, { now: got.t0 + 650000, dir: d2, identity });
    assert.ok(!b.reasons.some(r => /^loop/.test(r)), JSON.stringify(b.reasons));
  } finally { fs.rmSync(d1, { recursive: true, force: true }); fs.rmSync(d2, { recursive: true, force: true }); }
});
