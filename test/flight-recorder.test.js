'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { flightRecorder } = require('../src/harness/flight');

test('the flight recorder writes every frame to disk, keeps terrain every half minute and on deaths, and keeps ten runs', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flight-'));
  for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(directory, `old-${String(i).padStart(2, '0')}.jsonl`), '');
  const recorder = flightRecorder(directory, 'jev');
  const world = { blocks: [[0, 0, 0, 0]] }, base = Date.parse('2026-09-22T20:00:00Z');
  const at = s => new Date(base + s * 1000).toISOString();
  recorder.record({ kind: 'observation', at: at(0), snapshot: { world, held: [] } });
  recorder.record({ kind: 'motion', at: at(1), snapshot: { world, held: ['forward'], controller: { name: 'bridge' } } });
  recorder.record({ kind: 'danger', at: at(2), snapshot: { world, health: 0 } });
  recorder.record({ kind: 'observation', at: at(40), snapshot: { world } });
  recorder.close();
  await new Promise(resolve => setTimeout(resolve, 50));
  const rows = fs.readFileSync(recorder.file, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 4, 'every frame');
  assert.deepEqual(rows.map(r => !!r.snapshot.world), [true, false, true, true], 'terrain at the start, on a death, and after thirty seconds');
  assert.equal(rows[1].snapshot.controller.name, 'bridge', 'who held the keys is kept');
  assert.equal(fs.readdirSync(directory).filter(f => f.endsWith('.jsonl')).length, 10, 'the newest ten runs');
  fs.rmSync(directory, { recursive: true, force: true });
});
