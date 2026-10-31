'use strict';
// Note 2616: the record of the day's answers at the blazes is said at the bot's own health band too (16 or more, 10 to
// 15, under 10), and priced by the band where it holds ten picks. On 2026-10-31 00:20Z take cover under 10 health was a
// death within two minutes after 7 of 7, keep working 5 of 5, corner ambush 3 of 3, and leave and heal 2 of 18; the
// whole's rows read 20%, 48%, 15% and 25%.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const record = {
  from: '2026-10-30T00:20:00.000Z', to: '2026-10-31T00:20:00.000Z', logs: 3,
  questions: { encounter_stance: {
    take_cover: { n: 81, kill: 11, died: 16, lost: 1.3, bands: { high: { n: 69, kill: 10, died: 7 }, mid: { n: 5, kill: 1, died: 3 }, low: { n: 7, kill: 0, died: 7 } } },
    leave_and_heal: { n: 76, kill: 21, died: 19, lost: 1.3, bands: { high: { n: 26, kill: 5, died: 8 }, mid: { n: 32, kill: 10, died: 9 }, low: { n: 18, kill: 6, died: 2 } } },
    charge_nearest: { n: 133, kill: 64, died: 39, lost: 2.1, bands: { high: { n: 118, kill: 59, died: 33 }, low: { n: 4, kill: 1, died: 2 } } },
  } },
};

test('the own row, the table and the price carry the band of the health now where it holds enough picks', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bo-2616-')), 'blaze-outcomes.json');
  fs.writeFileSync(file, JSON.stringify(record));
  const prev = process.env.JEV_BLAZE_OUTCOMES;
  process.env.JEV_BLAZE_OUTCOMES = file;
  try {
    const bo = require('../src/blaze-outcomes');
    // At 8 health: the band's figures first, then the whole's.
    const low = bo.ownSays('encounter_stance', 'take_cover', undefined, 8);
    assert.match(low, /^ At under 10 health, as now: chosen 7 times, a blaze killed within two minutes after 0 \(0%\), a death within two minutes after 7 \(100%\)\. In the record of the full runs of the last day, read at 00:20Z, this way chosen here 81 times/);
    // At 20: the high band.
    assert.match(bo.ownSays('encounter_stance', 'charge_nearest', undefined, 20), /^ At 16 or more health, as now: chosen 118 times, a blaze killed within two minutes after 59 \(50%\), a death within two minutes after 33 \(28%\)\./);
    // Under five picks in the band, or no health given: the whole alone.
    assert.match(bo.ownSays('encounter_stance', 'charge_nearest', undefined, 8), /^ In the record of/);
    assert.match(bo.ownSays('encounter_stance', 'take_cover'), /^ In the record of/);
    // The table: each row's band figure in brackets where it holds five.
    const table = bo.tableSays('encounter_stance', ['take_cover', 'leave_and_heal', 'charge_nearest'], undefined, 8);
    assert.match(table, /take cover 81: a kill after 14%, a death after 20% \(at under 10 health, as now, 7: a kill after 0%, a death after 100%\)/);
    assert.match(table, /leave and heal 76: a kill after 28%, a death after 25% \(at under 10 health, as now, 18: a kill after 33%, a death after 11%\)/);
    assert.match(table, /charge nearest 133: a kill after 48%, a death after 29%;/, 'four picks in the band: no bracket');
    // The price: the band's rate from ten picks (leave and heal under 10: 2 of 18 at 8 health is 0.9), else the whole's
    // (take cover under 10 holds 7: the whole's 16 of 81 at 8 health, 1.6).
    assert.equal(bo.deathShare('encounter_stance', 'leave_and_heal', 8), 0.9);
    assert.equal(bo.deathShare('encounter_stance', 'take_cover', 8), 1.6);
    assert.equal(bo.deathShare('encounter_stance', 'charge_nearest', 20), 5.6);
  } finally { if (prev === undefined) delete process.env.JEV_BLAZE_OUTCOMES; else process.env.JEV_BLAZE_OUTCOMES = prev; }
});
