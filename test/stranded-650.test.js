'use strict';
// Note 650: 25598 stood on the tip of its own span from 23:22Z to past 01:00Z
// and no check said so (scripts/lib/stranded.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { strandedOf, strandedFromFrames } = require('../scripts/lib/stranded');

const T0 = Date.parse('2026-09-29T00:00:00Z'), MIN = 60000;
const at = (min, x = -109, z = 140, y = 52, dimension = 'the_nether') => ({ t: T0 + min * MIN, position: { x, y, z }, dimension });
const still = (from, to) => { const out = []; for (let m = from; m <= to; m += 0.5) out.push(at(m, -109 - (m % 3), 140 + (m % 2))); return out; };
const answers = (from, n, id = 'unstuck_move', noneGood = true) => Array.from({ length: n }, (_, i) => ({ id, at: T0 + (from + i * 0.5) * MIN, only: false, noneGood }));

test('half an hour in a few blocks with ten none_good answers in a row to one question is stranded, said with the place, the run and the times', () => {
  const r = strandedOf({ positions: still(0, 35), decs: answers(24, 12), now: T0 + 35 * MIN });
  assert.ok(r);
  assert.equal(r.question, 'unstuck_move');
  assert.equal(r.run, 12);
  assert.match(r.says, /^stranded: 30 minutes within 3 blocks of \(-110, 52, 141\), 12 none_good answers in a row to unstuck_move \(00:24:00Z to 00:29:30Z\); no death and no loop, and nothing else stops it$/);
});

test('not stranded: a bot that walks, one with a good answer among the run, a short run, or a record shorter than the half hour', () => {
  const now = T0 + 35 * MIN;
  const walking = [...still(0, 20), ...Array.from({ length: 30 }, (_, i) => at(20.5 + i * 0.5, -109 - i, 140))];
  assert.equal(strandedOf({ positions: walking, decs: answers(24, 12), now }), null, 'over 12 blocks');
  const broken = [...answers(24, 6), { id: 'unstuck_move', at: T0 + 27.5 * MIN, only: false, noneGood: false }, ...answers(28, 6)];
  assert.equal(strandedOf({ positions: still(0, 35), decs: broken, now }), null, 'no ten in a row');
  assert.equal(strandedOf({ positions: still(0, 35), decs: answers(24, 9), now }), null, 'nine is not ten');
  assert.equal(strandedOf({ positions: still(12, 35), decs: answers(24, 12), now }), null, 'up 23 minutes, not 30');
  assert.equal(strandedOf({ positions: still(0, 35), decs: answers(0, 12), now }), null, 'the run was not in the last quarter hour');
  assert.equal(strandedOf({ positions: still(0, 30), decs: answers(24, 12), now }), null, 'silent for five minutes: the bot is down, not stranded');
});

test('a run across two questions is not one none_good run, and a question answered only (no choice) is not counted', () => {
  const now = T0 + 35 * MIN;
  const two = [...answers(24, 6, 'unstuck_move'), ...answers(27, 6, 'rung_progress')];
  assert.equal(strandedOf({ positions: still(0, 35), decs: two, now }), null);
  const only = answers(24, 12).map(d => ({ ...d, only: true }));
  assert.equal(strandedOf({ positions: still(0, 35), decs: only, now }), null);
});

test('or none good in 40% of forty answers or more in the half hour, when other questions break the run (25585: 54 of 119)', () => {
  const now = T0 + 35 * MIN;
  const mixed = [];
  for (let i = 0; i < 60; i++) mixed.push({ id: i % 3 === 0 ? 'unstuck_move' : i % 3 === 1 ? 'rung_progress' : 'fortress_leg', at: T0 + (5.5 + i * 0.45) * MIN, only: false, noneGood: i % 5 < 3 });
  const r = strandedOf({ positions: still(0, 35), decs: mixed, now });
  assert.ok(r, 'stranded by the share');
  assert.equal(r.answers, 60);
  assert.match(r.says, /^stranded: 30 minutes within 3 blocks of \(-110, 52, 141\), none good in \d+ of \d+ answers in the half hour; no death and no loop, and nothing else stops it$/);
  assert.equal(strandedOf({ positions: still(0, 35), decs: mixed.slice(0, 30), now }), null, 'under forty answers');
  const few = mixed.map((d, i) => ({ ...d, noneGood: i % 5 === 0 }));
  assert.equal(strandedOf({ positions: still(0, 35), decs: few, now }), null, 'a fifth none good is not most');
});

test('the same from parsed flight frames: observations for the place, decisions once each for the run', () => {
  const frames = [];
  for (const p of still(0, 35)) frames.push({ t: p.t, kind: 'observation', snapshot: { position: p.position, dimension: p.dimension } });
  for (const d of answers(24, 12)) for (let k = 0; k < 2; k++) frames.push({ t: d.at + k, kind: 'decision', snapshot: { decision: { id: d.id, at: new Date(d.at).toISOString(), noneGood: true } } });
  frames.sort((a, b) => a.t - b.t);
  const r = strandedFromFrames(frames, { now: T0 + 35 * MIN });
  assert.equal(r.run, 12);
  assert.equal(strandedFromFrames(frames.filter(f => f.kind === 'observation'), { now: T0 + 35 * MIN }), null);
});
