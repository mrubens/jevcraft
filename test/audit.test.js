'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { analyse } = require('../scripts/lib/audit');

test('a fall to nothing is a death however small the last step', () => {
  // mid-205-a died from 0.47 health; the step was under half a point and the verdict said no deaths.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
  const id = '127_0_0_1-1-Jev', t0 = Date.parse('2026-09-26T16:54:30Z');
  const frame = (s, health) => JSON.stringify({ kind: 'vitals', label: 'vitals', at: new Date(t0 + s * 1000).toISOString(), snapshot: { health, position: { x: 0, y: 64, z: 0 } } });
  fs.writeFileSync(path.join(dir, `${id}-2026-09-26T16-54-00-000Z.jsonl`), [frame(0, 2.9), frame(1, 1.7), frame(2, 0.47), frame(3, 0), frame(5, 20)].join('\n') + '\n');
  const a = analyse({ identity: id, from: t0 - 1000, to: t0 + 10000, dir });
  assert.equal(a.deaths.length, 1);
});

test('a bunker hold that steps out to strike a blaze and back is one hold, not a flip between hold_bunker and blaze_sortie (note 623)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
  const id = '127_0_0_1-2-Jev', t0 = Date.parse('2026-09-28T18:08:40Z');
  const obs = (s, action) => JSON.stringify({ kind: 'observation', label: 'observation', at: new Date(t0 + s * 1000).toISOString(), snapshot: { health: 20, position: { x: 0, y: 64, z: 0 }, goal: { step: { action } } } });
  const file = path.join(dir, `${id}-2026-09-28T18-08-00-000Z.jsonl`);
  const run = names => { fs.writeFileSync(file, names.map((n, i) => obs(i * 3, n)).join('\n') + '\n'); return analyse({ identity: id, from: t0 - 1000, to: t0 + 60000, dir }).flips; };
  assert.deepEqual(run(Array.from({ length: 16 }, (_, i) => (i % 2 ? 'blaze_sortie' : 'hold_bunker'))), []);
  assert.equal(run(Array.from({ length: 16 }, (_, i) => (i % 2 ? 'mine' : 'walk_to_ore'))).length > 0, true, 'two other steps trading names are still a flip');
});

test('two steps trading names while the bot climbs a tower are progress, not a flip (note 651)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'));
  const id = '127_0_0_1-3-Jev', t0 = Date.parse('2026-09-29T01:06:27Z');
  const obs = (s, action, y) => JSON.stringify({ kind: 'observation', label: 'observation', at: new Date(t0 + s * 1000).toISOString(), snapshot: { health: 20, position: { x: 0, y, z: 0 }, goal: { step: { action } } } });
  const file = path.join(dir, `${id}-2026-09-29T01-06-00-000Z.jsonl`);
  const run = ys => { fs.writeFileSync(file, ys.map((y, i) => obs(i * 3, i % 2 ? 'cast_portal' : 'enter_nether', y)).join('\n') + '\n'); return analyse({ identity: id, from: t0 - 1000, to: t0 + 60000, dir }).flips; };
  assert.deepEqual(run([74.4, 75, 75.2, 75, 76, 77, 77.4, 77.4]), [], 'a climb of three blocks is somewhere else');
  assert.equal(run(Array.from({ length: 16 }, () => 74.4)).length > 0, true, 'the same steps at one height are still a flip');
});
