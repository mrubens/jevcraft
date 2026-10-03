'use strict';
// Note 1022: a death does not end the trial while rods or pearls are kept
// in the bot's chests; it fails it all the same.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

function flightDir(frames, identity) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-1022-'));
  const start = new Date(frames[0].t).toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(dir, `${identity}-${start}.jsonl`), frames.map(({ t, ...f }) => JSON.stringify({ ...f, at: new Date(t).toISOString() })).join('\n') + '\n');
  return dir;
}
// Ten minutes at a fortress, then a death.
function trial() {
  const t0 = Date.parse('2026-10-03T08:21:00Z'), frames = [];
  const snap = (s, health) => ({ position: { x: s / 5, y: 64, z: 0 }, dimension: 'the_nether', health, inventory: { netherrack: 20, blaze_rod: 5 }, step: { action: 'hunt_mob' } });
  for (let s = 0; s < 600; s += 5) frames.push({ t: t0 + s * 1000, kind: 'observation', snapshot: snap(s, 20) });
  frames.push({ t: t0 + 601000, kind: 'damage', label: 'hurt: mob attack by wither_skeleton', snapshot: snap(600, 0) });
  frames.push({ t: t0 + 602000, kind: 'death', label: 'death', detail: { message: 'Jev was slain by Wither Skeleton' }, snapshot: { ...snap(600, 0), inventory: {} } });
  frames.push({ t: t0 + 610000, kind: 'observation', snapshot: { position: { x: 0, y: 70, z: 0 }, dimension: 'overworld', health: 20, inventory: {}, step: { action: 'acquire' } } });
  return { t0, frames };
}

test('a death with rods kept in a chest fails the trial and does not end it; with none kept it ends it', () => {
  const { verdict } = require('../scripts/midgame');
  const identity = '127_0_0_1-25994-Jev';
  const t = trial(), dir = flightDir(t.frames, identity);
  try {
    const at = { world: 'mid-242-zz-fortress-9', startedAt: new Date(t.t0).toISOString() }, now = t.t0 + 650000;
    const bare = verdict(at, { now, dir, identity, kept: { rods: 0, pearls: 0 } });
    assert.deepEqual([bare.done, bare.pass], [true, false]);
    assert.ok(bare.reasons.some(r => /^1 death\(s\)/.test(r)), JSON.stringify(bare.reasons));
    const kept = verdict(at, { now, dir, identity, kept: { rods: 5, pearls: 0 } });
    assert.deepEqual([kept.done, kept.pass, kept.failedAlready], [false, false, true]);
    assert.deepEqual(kept.reasons, ['died 1 time with 5 blaze rods kept in its chests: played on']);
    assert.ok(!kept.reasons.some(r => /death|loop|stranded|^cut: /.test(r)), 'the watcher does not end it');
    assert.deepEqual(kept.playedOnAfterDeath, { deaths: 1, kept: { rods: 5, pearls: 0 } });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
