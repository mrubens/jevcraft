'use strict';
// What each way has done from within three blocks of a creeper, measured
// (note 772) and conditioned (note 778): every encounter_stance answered in
// the Overworld with a creeper within three blocks in the question's own
// state, from the flight records of 2026-09-29T23:00Z to 2026-10-01T03:00Z
// (533 answers), by the way answered, the creeper's distance band (within
// 1.5 blocks, or 1.5 to 3) and whether another mob stood within four blocks
// of the bot: how many were caught by its blast within six seconds, before
// another stance was answered, the median seconds from the answer to the
// blast and the median health it took, and how many of those died
// (`node scripts/overworld-deaths.js --creepers --cells`).
//
// Note 772 said one record a way over all of these: "retreat caught 42 of
// 124, behind a block 13 of 329". The reviewer's check-in of 02:39Z: those
// compare different situations. A run from 1.2 blocks and a block put in
// the line from 2.8 are not the same choice, nor is either with a zombie at
// the bot's back. Said now only for the cell the bot is in, and only where
// six answers or more stand behind it: 10 cells of 25 (the rest too few).
const WINDOW_SECONDS = 6;
const CELLS = ['within 1.5', '1.5 to 3'];
const RECORD = Object.freeze({
  'within 1.5|alone': {
    retreat: { answers: 9, blasted: 5, died: 2, seconds: 0.7, took: 6.1, meanTaken: 4.3 },
  },
  '1.5 to 3|alone': {
    block_creeper: { answers: 298, blasted: 12, died: 0, seconds: 0.7, took: 1.2, meanTaken: 0.1 },
    retreat: { answers: 106, blasted: 36, died: 3, seconds: 0.8, took: 3.6, meanTaken: 1.9 },
    fight: { answers: 23, blasted: 9, died: 1, seconds: 0.9, took: 3.8, meanTaken: 2.3 },
    creeper_dance: { answers: 16, blasted: 8, died: 1, seconds: 0.9, took: 6.2, meanTaken: 3.6 },
    fight_from_footing: { answers: 13, blasted: 3, died: 0, seconds: 3, took: 13.2, meanTaken: 2.8 },
    shield_the_blast: { answers: 11, blasted: 0, died: 0, seconds: null, took: null, meanTaken: 0 },
    shield_guard: { answers: 7, blasted: 2, died: 0, seconds: 0.6, took: 5.7, meanTaken: 0.9 },
  },
  '1.5 to 3|with others': {
    shield_guard: { answers: 10, blasted: 1, died: 1, seconds: 2.5, took: 20, meanTaken: 2 },
    block_creeper: { answers: 9, blasted: 0, died: 0, seconds: null, took: null, meanTaken: 0 },
  },
});
const MIN_ANSWERS = 6;
// Within this many blocks of a creeper a record is the one said.
const RECORD_WITHIN = 3;

const cellOf = ({ distance, others = 0 }) => !(distance <= RECORD_WITHIN) ? null : `${distance <= 1.5 ? CELLS[0] : CELLS[1]}|${others > 0 ? 'with others' : 'alone'}`;

function recordOf(stance, where = {}) {
  const cell = cellOf(where), r = cell && RECORD[cell]?.[stance];
  return r && r.answers >= MIN_ANSWERS ? { cell, ...r } : null;
}

function recordSays(stance, where = {}) {
  const r = recordOf(stance, where);
  if (!r) return '';
  const [band, crowd] = r.cell.split('|');
  return ` This way's record ${band === CELLS[0] ? 'within 1.5 blocks' : 'from 1.5 to 3 blocks'} of a creeper, ${crowd === 'alone' ? 'no other mob' : 'another mob'} within 4: answered ${r.answers} times, ${r.blasted ? `caught by its blast in ${WINDOW_SECONDS} seconds ${r.blasted} times (a median ${r.took} health), ${r.died} died` : `caught by its blast in ${WINDOW_SECONDS} seconds none of those times`}.`;
}

// Said on each way on offer with a record for this cell (the creeper
// nearest within RECORD_WITHIN blocks, `others` the other mobs within four
// of the bot); a way priced below its cell's mean taken per answer is
// priced at that mean. `options` is the stance tree's top level.
function sayOn(options, { distance, others = 0 } = {}) {
  if (!(distance <= RECORD_WITHIN)) return options;
  for (const [key, o] of Object.entries(options || {})) {
    const r = recordOf(key, { distance, others });
    if (!r || typeof o?.description !== 'string') continue;
    o.description += recordSays(key, { distance, others });
    if (o.expects && Number.isFinite(o.expects.damage) && o.expects.damage < r.meanTaken) o.expects = { ...o.expects, damage: r.meanTaken };
  }
  return options;
}

module.exports = { RECORD, RECORD_WITHIN, WINDOW_SECONDS, MIN_ANSWERS, cellOf, recordOf, recordSays, sayOn };
