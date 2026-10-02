'use strict';
// Note 901: once a rod has been got in the trial, a loop is not its end,
// whether the rods are carried still or in a chest.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

function flightDir(frames, identity) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-901-'));
  const start = new Date(frames[0].t).toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(dir, `${identity}-${start}.jsonl`), frames.map(({ t, ...f }) => JSON.stringify({ ...f, at: new Date(t).toISOString() })).join('\n') + '\n');
  return dir;
}
// Ten minutes of play, then a step trading names in place for a minute.
function trial(rodsAt) {
  const t0 = Date.parse('2026-10-02T14:30:00Z'), frames = [];
  const inv = s => ({ cobblestone: 20, ...(rodsAt && s >= rodsAt[0] && s < rodsAt[1] ? { blaze_rod: 2 } : {}) });
  for (let s = 0; s < 600; s += 5) frames.push({ t: t0 + s * 1000, kind: 'observation', snapshot: { position: { x: s / 5, y: 64, z: 0 }, dimension: 'overworld', health: 20, inventory: inv(s), step: { action: 'mine', block: 'stone' } } });
  for (let k = 0; k < 16; k++) frames.push({ t: t0 + (600 + k * 3) * 1000, kind: 'observation', snapshot: { position: { x: 120, y: 64, z: 0 }, dimension: 'overworld', health: 20, inventory: inv(600 + k * 3), step: { action: k % 2 ? 'tunnel' : 'collect_nearby_resource' } } });
  return { t0, frames };
}

test('a flip in place: a loop where no rod was ever got; not the trial\'s end where two were carried and banked ten minutes before', () => {
  const { verdict } = require('../scripts/midgame');
  const identity = '127_0_0_1-25994-Jev';
  const none = trial(null), d1 = flightDir(none.frames, identity);
  const banked = trial([100, 540]), d2 = flightDir(banked.frames, identity);
  try {
    const a = verdict({ world: 'mid-243-zz-fortress-3', startedAt: new Date(none.t0).toISOString() }, { now: none.t0 + 650000, dir: d1, identity });
    assert.ok(a.reasons.some(r => /^loop: flipping/.test(r)), JSON.stringify(a.reasons));
    const b = verdict({ world: 'mid-243-zz-fortress-3', startedAt: new Date(banked.t0).toISOString() }, { now: banked.t0 + 650000, dir: d2, identity });
    assert.ok(!b.reasons.some(r => /^loop/.test(r)), JSON.stringify(b.reasons));
    assert.equal(b.loopsWithRodsCarried.got, 2);
    assert.equal(b.loopsWithRodsCarried.rods, 0);
  } finally { fs.rmSync(d1, { recursive: true, force: true }); fs.rmSync(d2, { recursive: true, force: true }); }
});
