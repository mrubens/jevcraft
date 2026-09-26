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
