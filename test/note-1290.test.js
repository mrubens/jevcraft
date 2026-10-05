'use strict';
// Note 1290: eyes made count as the rods and pearls played through, wherever
// they lie. mid-243-ma-nether-1 (25597, 2026-10-05 08:08:44Z) drowned with its
// twelve eyes by its stronghold and was ended at its 24 hours three minutes later.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');

test('eyes made or a stronghold found: the End\'s hours, with nothing in the pack or the chests', () => {
  const { keptNow, limitFor } = require('../scripts/midgame');
  const identity = '127_0_0_1-25994-Jev', file = path.join(__dirname, '..', '.bot-state', `${identity}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify({ kind: 'win', rodStashes: [], gameProgress: { milestones: { nether_entered: {}, eyes_obtained: {}, stronghold_located: {} } } }));
    const kept = keptNow(identity);
    assert.equal(limitFor(kept), limitFor({ rods: 99, pearls: 99 }), 'the longest limit');
    fs.writeFileSync(file, JSON.stringify({ kind: 'win', rodStashes: [], gameProgress: { milestones: { nether_entered: {} } } }));
    assert.deepEqual(keptNow(identity), { rods: 0, pearls: 0 });
  } finally { fs.rmSync(file, { force: true }); }
});

test('a trial keeping its eyes is not cut for no Nether in its first hour (note 1291)', () => {
  const { verdict } = require('../scripts/midgame');
  const identity = '127_0_0_1-25995-Jev';
  const t0 = Date.parse('2026-10-05T08:27:00Z');
  const frames = [];
  for (let s = 0; s < 3900; s += 30) frames.push({ at: new Date(t0 + s * 1000).toISOString(), kind: 'observation', snapshot: { position: { x: s / 3, y: 64, z: 0 }, dimension: 'overworld', health: 20, inventory: { cobblestone: 20 }, step: { action: 'corpse_run' } } });
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'note-1291-'));
  fs.writeFileSync(path.join(dir, `${identity}-${new Date(t0).toISOString().replace(/[:.]/g, '-')}.jsonl`), frames.map(f => JSON.stringify(f)).join('\n') + '\n');
  try {
    const at = { world: 'mid-243-zz-end-1', startedAt: new Date(t0).toISOString() }, now = t0 + 65 * 60000;
    const kept = verdict(at, { now, dir, identity, kept: { rods: 6, pearls: 12 } });
    assert.ok(!kept.reasons.some(r => /^cut:/.test(r)), JSON.stringify(kept.reasons));
    const bare = verdict(at, { now, dir, identity, kept: { rods: 0, pearls: 0 } });
    assert.ok(bare.reasons.some(r => /^cut: no Nether/.test(r)), JSON.stringify(bare.reasons));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a trial past its eyes plays on a day past its latest milestone, past the 48 hours from its start (note 1308)', () => {
  const { progressAt } = require('../scripts/midgame');
  const identity = '127_0_0_1-25996-Jev', file = path.join(__dirname, '..', '.bot-state', `${identity}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const at = Date.parse('2026-10-05T15:00:00Z');
  try {
    fs.writeFileSync(file, JSON.stringify({ kind: 'win', gameProgress: { milestones: { nether_entered: { at: 1 }, eyes_obtained: { at: at - 3600000 }, stronghold_located: { at } } } }));
    assert.equal(progressAt(identity), at);
  } finally { fs.rmSync(file, { force: true }); }
});
