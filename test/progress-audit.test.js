'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { readFlight, readBotLog, measure } = require('../scripts/trials/progress-audit');

// A fortress trial busy but going nowhere, as mid-242-aa-nether-1-fortress-1
// was (2026-09-27): back and forth over the same few columns it already
// walked, digging, and asked the same leg question with the same answer.
const id = '127_0_0_1-1-Jev', t0 = Date.parse('2026-09-27T20:00:00Z'), min = 60000;
const iso = t => new Date(t).toISOString();
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-'));
  const obs = (t, x, z) => JSON.stringify({ kind: 'observation', label: 'observation', snapshot: { position: { x, y: 70, z }, dimension: 'the_nether', health: 20 }, id: 1, at: iso(t) });
  const history = [], window = [];
  // The half hour before: walked the corridor x 0 to 40.
  for (let s = 0; s < 30 * 60; s += 10) history.push(obs(t0 + s * 1000, (s / 10) % 41, 0));
  const from = t0 + 30 * min;
  // The window: back and forth over x 0 to 12, every two seconds, for fifteen minutes.
  for (let s = 0; s < 15 * 60; s += 2) window.push(obs(from + s * 1000, Math.abs(((s / 2) % 24) - 12), 0));
  // Netherrack dug, a block every ten seconds, carried in full frames.
  for (let s = 0; s < 15 * 60; s += 10) window.push(JSON.stringify({ kind: 'action', label: 'mine netherrack', snapshot: { position: { x: 3, y: 70, z: 0 }, dimension: 'the_nether',
    inventory: { netherrack: s / 10, iron_sword: 1 }, goal: { step: { action: 'find_fortress' } } }, id: 2, at: iso(from + s * 1000 + 1) }));
  // The run clock: find_fortress for most of it.
  const recent = [];
  for (let s = 0; s < 15 * 60; s += 15) recent.push([from + s * 1000, s < 13 * 60 ? 'obtain_blaze_rods: find_fortress' : 'eat', 15000]);
  window.push(JSON.stringify({ kind: 'action', label: 'find fortress', snapshot: { position: { x: 5, y: 70, z: 0 }, dimension: 'the_nether',
    goal: { gameProgress: { phase: 'obtain_blaze_rods', milestones: { nether_entered: { at: t0 - 50 * min } }, clock: { recent } } } }, id: 3, at: iso(from + 14 * min) }));
  // The same question twenty times with the same answer, one a frame written twice; four none-good.
  for (let i = 0; i < 20; i++) {
    const d = { id: 'fortress_leg', at: iso(from + i * 40000), path: ['stay_in_fortress'], judgments: [{}], ...(i < 4 ? { noneGood: true } : {}),
      state: { fortressInView: { passes: 10 + i, minutesThere: 14, blazesSeenNear: 0, lastPass: { stretches: 6, reached: 2 } } } };
    const line = JSON.stringify({ kind: 'decision', label: 'stay_in_fortress', snapshot: { position: { x: 1, y: 70, z: 0 }, dimension: 'the_nether', decision: d }, id: 4, at: d.at });
    window.push(line); if (i === 5) window.push(line);
  }
  fs.writeFileSync(path.join(dir, `${id}-2026-09-27T20-00-00-000Z.jsonl`), history.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, `${id}-2026-09-27T20-30-00-000Z.jsonl`), window.sort((a, b) => JSON.parse(a).at < JSON.parse(b).at ? -1 : 1).join('\n') + '\n');
  const log = path.join(dir, 'bot.log');
  fs.writeFileSync(log, [`{"step":{"action":"x"},"at":"${iso(from - 5 * min)}"}`, '[missing option] fortress_leg: none of the options was good; took leg_east instead', '[stall] before the window',
    `{"decision":{"askedAt":"${iso(from - 2000)}"}}`, '[missing option] fortress_leg: none of the options was good; took stay_in_fortress instead', '[stall] a strike', '[still] 45s on step:find_fortress', ''].join('\n'));
  return { dir, log, from, to: from + 15 * min, historyFrom: t0 };
}

test('a fortress trial walking the same ground is flagged, with what it did', () => {
  const { dir, log, from, to, historyFrom } = fixture();
  const { frames, history } = readFlight({ identity: id, from, to, historyFrom, dir });
  assert.equal(history.length, 180);
  const m = measure({ frames, history, from, to, trial: { startedAt: iso(t0) }, botLog: readBotLog(log, from), minutes: 15, historyMinutes: 30 });
  assert.equal(m.dimension, 'nether');
  assert.equal(m.lastMilestone.name, 'nether_entered');
  assert.equal(m.minutesSinceMilestone, 95);
  assert.equal(m.top[0], 'obtain_blaze_rods: find_fortress');
  assert.equal(m.top[1], 13);
  assert.equal(m.ground.newCells, 0);
  assert.equal(m.ground.cells, 4);
  assert.ok(m.ground.walked > 400 && m.ground.net < 16, `walked ${m.ground.walked}, net ${m.ground.net}`);
  assert.equal(m.ground.dug, 89);
  assert.deepEqual(m.questions.top[0], { id: 'fortress_leg', count: 20, answer: 'stay_in_fortress', same: 20, byJev: 20, noneGood: 4 });
  assert.equal(m.questions.noneGoodShare, 0.2);
  assert.equal(m.fortress.passes, 29);
  // The bot log from the window only.
  assert.deepEqual(m.botLog.missingOption, { fortress_leg: 1 });
  assert.equal(m.botLog.stall, 1);
  assert.equal(m.botLog.still, 1);
  const ids = m.flags.map(f => f.id);
  for (const f of ['fortress', 'newGround', 'pacing', 'digging', 'oneThing', 'milestone', 'sameAnswer', 'noneGood']) assert.ok(ids.includes(f), `${f} in ${ids}`);
  assert.match(m.verdict, /at the fortress 14 min \(as of 2 min ago\), 29 passes, 2 of 6 stretches reached, blazes seen near it 0, revisiting 100% of columns — not exploring/);
  assert.match(m.verdict, /fortress_leg 20× \(20× stay_in_fortress\)/);
  // Every flag says its threshold.
  for (const f of m.flags) assert.ok(f.threshold.length > 20);
});

test('a trial covering new ground and reaching a milestone is not flagged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'progress-'));
  const from = t0, to = t0 + 15 * min, lines = [];
  for (let s = 0; s < 15 * 60; s += 2) lines.push(JSON.stringify({ kind: 'observation', snapshot: { position: { x: s / 2, y: 64, z: 0 }, dimension: 'overworld', step: { action: s < 450 ? 'go_to_landmark' : 'mine' } }, id: 1, at: iso(from + s * 1000) }));
  lines.push(JSON.stringify({ kind: 'action', snapshot: { position: { x: 440, y: 64, z: 0 }, dimension: 'overworld', goal: { gameProgress: { milestones: { nether_entered: { at: from + 10 * min } } } } }, id: 2, at: iso(from + 14 * min) }));
  fs.writeFileSync(path.join(dir, `${id}-2026-09-27T20-00-00-000Z.jsonl`), lines.join('\n') + '\n');
  const { frames, history } = readFlight({ identity: id, from, to, historyFrom: from - 60 * min, dir });
  const m = measure({ frames, history, from, to, minutes: 15, historyMinutes: 60 });
  assert.equal(m.ground.newShare, 1);
  assert.deepEqual(m.flags, []);
  assert.match(m.verdict, /^moving: .*100% new ground, last milestone 5 min ago/);
});
