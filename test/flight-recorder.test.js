'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { flightRecorder } = require('../src/harness/flight');

const settle = () => new Promise(resolve => setTimeout(resolve, 50));
const rows = file => fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);

test('heartbeats are written slim, the goal only when it changes, and terrain only on a death or a connection', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flight-'));
  const recorder = flightRecorder(directory, 'jev');
  const world = { blocks: [[0, 0, 0, 0]] }, goal = { step: { action: 'tunnel' }, decisions: ['big'] };
  recorder.record({ kind: 'observation', at: 'a', snapshot: { world, goal, position: { x: 1, y: 2, z: 3 }, health: 20, held: ['forward'], controller: { name: 'bridge_step' } } });
  recorder.record({ kind: 'decision', at: 'b', snapshot: { world, goal } });
  recorder.record({ kind: 'survival', at: 'c', snapshot: { world, goal } });
  recorder.record({ kind: 'error', at: 'd', snapshot: { world, goal: { ...goal, step: { action: 'persist' } } } });
  recorder.record({ kind: 'danger', at: 'e', snapshot: { world, goal, health: 0 } });
  recorder.close(); await settle();
  const [beat, decision, survival, error, death] = rows(recorder.file);
  assert.deepEqual(Object.keys(beat.snapshot).filter(k => beat.snapshot[k] !== undefined).sort(), ['controller', 'health', 'held', 'position', 'step'], 'a heartbeat is where, how, which keys, who, and the step');
  assert(decision.snapshot.goal && !survival.snapshot.goal, 'the goal is written when it changes, not again');
  assert(error.snapshot.goal, 'a changed goal is written');
  assert.deepEqual([decision, survival, error].map(r => !!r.snapshot.world), [false, false, false], 'no terrain on ordinary frames');
  assert(death.snapshot.world, 'terrain on a death');
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
