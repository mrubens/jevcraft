'use strict';
// Note 667: every bot-minute before the first blaze fight called progress,
// a crawl, upkeep or waste by a named pattern (scripts/wasted-minutes.js).
// The fixture is ten made-up minutes in the recorder's frame format, a
// minute a pattern, and a blaze in sight in the tenth that ends the window.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('../scripts/wasted-minutes');

const FIXTURE = path.join(__dirname, 'fixtures', 'wasted-minutes-flight.jsonl');
const START = Date.parse('2026-09-28T10:00:00Z');

function readFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wasted-minutes-'));
  fs.copyFileSync(FIXTURE, path.join(dir, '127_0_0_1-25999-Jev-2026-09-28T10-00-00-000Z.jsonl'));
  try { return W.readTrial({ port: 25999, start: START, end: START + 20 * 60000, dir }); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('the window ends at the first blaze in sight within 24 blocks in the Nether', () => {
  const { frames, fightAt } = readFixture();
  assert.equal(new Date(fightAt).toISOString(), '2026-09-28T10:09:30.100Z');
  assert.ok(frames.every(f => f.t < fightAt));
});

test('each minute of the fixture gets its pattern', () => {
  const { frames } = readFixture();
  const got = W.minutesOf(frames, { start: START }).map(b => { const v = W.classify(b.m); return `${v.cls}/${v.pattern}`; });
  assert.deepEqual(got, [
    'progress/rung',                 // 40 blocks toward the landmark over new ground
    'waste/pacing',                  // back and forth over the same 20 blocks
    'waste/waiting out a rest',      // standing in the until_rest_ends detour
    'waste/standing still',          // standing on a mine step
    'progress/item',                 // an iron pickaxe made
    'waste/failed route again',      // "no route" to one goal three times
    'waste/flipping',                // tunnel and craft trading every six seconds
    'slow/crawling (span)',          // a span laid a block every ten seconds
    'waste/died',
    'progress/milestone',            // the Nether entered
  ]);
});

test('a crawl is progress under ten blocks in the minute, told apart from pacing and a wait', () => {
  const base = { walked: 5, net: 5, dy: 0, newCols: 5, dug: 0, laid: 0, items: [], materials: [], foodGain: 0, hpRise: 0, eating: false,
    milestones: [], sighted: [], deaths: 0, doing: { cross_toward: 60000 }, steps: { cross_toward: 60000 }, decs: [], fails: [], stalls: 0,
    labels: {}, hurtBy: {}, said: [], ctl: { bridge_step: 6 }, stepFlips: 0, answerFlips: 0, failedAgain: 0, stillMs: 50000, movedMs: 10000 };
  const nearer = [{ key: 'step:x', what: 'the cross toward target', from: 60, to: 55 }];
  assert.equal(W.classify({ ...base, nearer }).pattern, 'crawling (span)');
  // Twenty blocks nearer in the minute is not a crawl.
  assert.equal(W.classify({ ...base, nearer: [{ ...nearer[0], to: 40 }], walked: 20, net: 20, newCols: 20 }).cls, 'progress');
  // Walked 60 for a sliver nearer and ended where it began: pacing.
  assert.equal(W.classify({ ...base, nearer, walked: 60, net: 2, dy: 0 }).pattern, 'pacing');
  // Mostly in the rest's detour, a few blocks crept first: the wait.
  assert.equal(W.classify({ ...base, nearer, steps: { 'detour:until_rest_ends': 50000, cross_toward: 10000 } }).pattern, 'waiting out a rest');
  // A descent of 13 blocks to its target is not pacing though the flat net is 3.
  assert.equal(W.classify({ ...base, nearer: [{ ...nearer[0], from: 15, to: 1 }], walked: 27, net: 3, dy: -13, newCols: 6, ctl: {} }).cls, 'progress');
});

test('a thing on the ladder counts up to what the ladder has a use for', () => {
  const frames = [
    { t: START, kind: 'observation', p: { x: 0, y: 64, z: 0 }, dim: 'overworld', hp: 20, inv: { flint: 1, iron_ingot: 3 } },
    { t: START + 10000, kind: 'observation', p: { x: 0, y: 64, z: 0 }, dim: 'overworld', hp: 20, inv: { flint: 2, iron_ingot: 5 } },
  ];
  const [b] = W.minutesOf(frames, { start: START });
  assert.deepEqual(b.m.items, ['iron_ingot 3→5']);
});

test('the report ranks waste and crawl buckets with example windows', () => {
  const { frames } = readFixture();
  const rows = W.minutesOf(frames, { start: START }).map(b => ({ port: 25999, world: 'fixture', kind: 'fresh', from: b.from, ms: b.botMs, ...W.classify(b.m), ...W.attribution(b.m), m: b.m }));
  const r = W.report({ rows, trials: [{ world: 'fixture', fightAt: START + 9.5 * 60000, minutesToFight: 9.5 }] }, { topN: 20, examples: 3 });
  assert.equal(r.trials, 1);
  assert.ok(r.wasteShare > 0.5 && r.wasteShare < 0.7, `waste share ${r.wasteShare}`);
  const pacing = r.buckets.find(b => b.pattern === 'pacing');
  assert.ok(pacing && pacing.examples.length === 1);
  assert.equal(pacing.examples[0].from, '2026-09-28T10:01:00Z');
  assert.match(pacing.step, /go to landmark/);
  assert.equal(pacing.question, 'turn priority → work');
  assert.ok(r.buckets.some(b => b.pattern === 'crawling (span)'));
  assert.match(W.table(r), /Waste and crawl buckets/);
});
