'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { flightRecorder } = require('../src/recorder/flight');

const settle = () => new Promise(resolve => setTimeout(resolve, 50));
const rows = file => fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);

test('heartbeats and steps are written slim, the whole goal once a minute or on a death, and terrain only on a death or a connection', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flight-'));
  const recorder = flightRecorder(directory, 'jev');
  const world = { blocks: [[0, 0, 0, 0]] }, goal = { request: 'beat the game', step: { action: 'tunnel' }, decisions: ['big'] };
  const at = s => new Date(Date.parse('2026-09-22T22:00:00Z') + s * 1000).toISOString();
  recorder.record({ kind: 'observation', at: at(0), snapshot: { world, goal, position: { x: 1, y: 2, z: 3 }, health: 20, held: ['forward'], controller: { name: 'bridge_step' } } });
  recorder.record({ kind: 'action', at: at(1), snapshot: { world, goal, position: { x: 1, y: 2, z: 3 } } });
  recorder.record({ kind: 'decision', at: at(2), snapshot: { world, goal, decision: { path: ['a'] } } });
  recorder.record({ kind: 'survival', at: at(3), snapshot: { world, goal, decision: { path: ['a'] } } });
  recorder.record({ kind: 'danger', at: at(4), snapshot: { world, goal, health: 0 } });
  recorder.record({ kind: 'error', at: at(70), snapshot: { world, goal } });
  recorder.close(); await settle();
  const [beat, step, decision, survival, death, late] = rows(recorder.file);
  assert.deepEqual(Object.keys(beat.snapshot).filter(k => beat.snapshot[k] !== undefined).sort(), ['controller', 'health', 'held', 'position', 'step'], 'a heartbeat is where, how, which keys, who, and the step');
  assert(!step.snapshot.goal && step.snapshot.step, 'a work step is written slim too');
  assert(decision.snapshot.goal.decisions, 'the first full frame carries the whole goal');
  assert(decision.snapshot.decision && !survival.snapshot.decision, 'the decision only on decision frames');
  assert.equal(survival.snapshot.goal.decisions, undefined, 'within the minute, a compact goal');
  assert.equal(survival.snapshot.goal.step.action, 'tunnel');
  assert(death.snapshot.goal.decisions && death.snapshot.world, 'a death carries everything');
  assert(late.snapshot.goal.decisions, 'a minute on, the whole goal again');
  assert.deepEqual([decision, survival, late].map(r => !!r.snapshot.world), [false, false, false], 'no terrain on ordinary frames');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('a full file starts the next part rather than going silent, and each bot keeps its own newest ten', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flight-'));
  // Another bot's file, older than everything: never touched by this bot's prune.
  const other = path.join(directory, 'localhost-25570-Jev-2020-01-01.jsonl');
  fs.writeFileSync(other, '');
  for (let i = 0; i < 12; i++) { const f = path.join(directory, `jev-old-${i}.jsonl`); fs.writeFileSync(f, ''); fs.utimesSync(f, new Date(2020, 0, 1 + i), new Date(2020, 0, 1 + i)); }
  const recorder = flightRecorder(directory, 'jev', { partBytes: 400 });
  for (let i = 0; i < 6; i++) recorder.record({ kind: 'chat', at: `t${i}`, snapshot: { note: 'x'.repeat(150) } });
  const last = recorder.file;
  recorder.close(); await settle();
  assert.match(last, /-part\d+\.jsonl$/, 'later frames went to a new part');
  assert.equal(rows(last).at(-1).at, 't5', 'and the newest frame is kept');
  const mine = fs.readdirSync(directory).filter(f => f.startsWith('jev-'));
  assert(mine.length <= 10, `this bot keeps ten (${mine.length})`);
  assert(fs.existsSync(other), 'another bot\'s file is left alone');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('a day of restarts is kept: files from the last day stay past the newest ten, older ones go', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flight-'));
  const now = Date.now();
  for (let i = 0; i < 20; i++) { const f = path.join(directory, `jev-recent-${i}.jsonl`); fs.writeFileSync(f, '{}\n'); const t = new Date(now - (i + 1) * 60000); fs.utimesSync(f, t, t); }
  for (let i = 0; i < 5; i++) { const f = path.join(directory, `jev-stale-${i}.jsonl`); fs.writeFileSync(f, '{}\n'); const t = new Date(now - (48 + i) * 3600000); fs.utimesSync(f, t, t); }
  const recorder = flightRecorder(directory, 'jev');
  recorder.record({ kind: 'chat', at: 't0', snapshot: {} });
  recorder.close(); await settle();
  const left = fs.readdirSync(directory);
  assert.equal(left.filter(f => f.startsWith('jev-recent-')).length, 20, 'twenty restarts in the last hour are all kept');
  assert.equal(left.filter(f => f.startsWith('jev-stale-')).length, 0, 'two-day-old files go');
  fs.rmSync(directory, { recursive: true, force: true });
});
