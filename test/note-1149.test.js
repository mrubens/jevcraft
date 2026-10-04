'use strict';
// Note 1149: a death earlier in the trial does not end it once its rods and
// pearls are taken out of the chests into the pack, nor once both were had.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

function flightDir(frames, identity) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-1149-'));
  const start = new Date(frames[0].t).toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(dir, `${identity}-${start}.jsonl`), frames.map(({ t, ...f }) => JSON.stringify({ ...f, at: new Date(t).toISOString() })).join('\n') + '\n');
  return dir;
}
// A death at a fortress with nothing in the pack (the rods in chests), then the rods and pearls taken out past the portal.
function trial(last) {
  const t0 = Date.parse('2026-10-03T22:34:51Z'), frames = [];
  const snap = (s, health, inventory, dimension = 'the_nether') => ({ position: { x: s / 5, y: 64, z: 0 }, dimension, health, inventory, step: { action: 'hunt_mob' } });
  for (let s = 0; s < 280; s += 5) frames.push({ t: t0 + s * 1000, kind: 'observation', snapshot: snap(s, 20, { netherrack: 20 }) });
  frames.push({ t: t0 + 283000, kind: 'death', label: 'death', detail: { message: 'Jev tried to swim in lava' }, snapshot: snap(280, 0, {}) });
  for (let s = 300; s < 900; s += 5) frames.push({ t: t0 + s * 1000, kind: 'observation', snapshot: snap(s, 20, { cobblestone: 40 }, 'overworld') });
  frames.push({ t: t0 + 900000, kind: 'observation', snapshot: snap(900, 20, last, 'overworld') });
  return { t0, frames };
}

test('the rods and pearls taken out of the chests into the pack: the earlier death still does not end the trial (25594)', () => {
  const { verdict } = require('../scripts/midgame');
  const identity = '127_0_0_1-25994-Jev';
  for (const [last, says] of [[{ blaze_rod: 7, ender_pearl: 13 }, /^died 1 time with 7 blaze rods and 13 ender pearls in its pack \(rods, powder, pearls and eyes counted\): played on$/],
    [{ blaze_powder: 14, ender_pearl: 13 }, /^died 1 time with 7 blaze rods and 13 ender pearls in its pack/],
    [{ blaze_powder: 1, ender_eye: 13 }, /^died 1 time with 7 blaze rods and 13 ender pearls in its pack/]]) {
    const t = trial(last), dir = flightDir(t.frames, identity);
    try {
      const v = verdict({ world: 'mid-242-zz-fortress-10-r1', startedAt: new Date(t.t0).toISOString() }, { now: t.t0 + 910000, dir, identity, kept: { rods: 0, pearls: 0 } });
      assert.equal(v.done, false, JSON.stringify(v.reasons));
      assert.equal(v.reasons.length, 1);
      assert.match(v.reasons[0], says);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('with nothing in the chests or the pack and the rods never had, the death ends it as before', () => {
  const { verdict } = require('../scripts/midgame');
  const identity = '127_0_0_1-25994-Jev';
  const t = trial({ cobblestone: 40 }), dir = flightDir(t.frames, identity);
  try {
    const v = verdict({ world: 'mid-242-zz-fortress-10-r1', startedAt: new Date(t.t0).toISOString() }, { now: t.t0 + 910000, dir, identity, kept: { rods: 0, pearls: 0 } });
    assert.equal(v.done, true);
    assert.ok(v.reasons.some(r => /^1 death\(s\)/.test(r)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
