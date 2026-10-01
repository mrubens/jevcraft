'use strict';
// What each way has done from within three blocks of a creeper, measured
// (note 772): every encounter_stance answered in the Overworld with a
// creeper within three blocks in the question's own state, from the flight
// records of 2026-09-29T23:00Z to 2026-10-01T00:41Z (554 answers), by the
// way answered: how many were caught by its blast within six seconds,
// before another stance was answered, the median seconds from the answer
// to the blast and the median health it took, and how many of those died
// (`node scripts/overworld-deaths.js --creepers`).
//
// The figures each way gives of itself did not agree with this. A run from
// a creeper at 1.5 to 2.9 blocks was priced "about 0" by its walk in time
// against the fuse (creeper-run.js), the creeper going off "with the bot
// about 5.8 blocks from it": 42 of the 124 runs answered so were caught, a
// median 0.7 seconds after the answer, the bot then a median 4.5 blocks
// off a second in, and 5 died (25598 mid-241-bb 12:44:57Z, 25597
// mid-241-de 18:26:34Z among them). Staying behind a block in its line was
// caught 13 times in 329, none died; the shield raised toward it 0 in 6.
// Said with each way that has a record of six answers or more, so the ways
// are weighed by what they have done as well as by what they say.
const WINDOW_SECONDS = 6;
const RECORD = Object.freeze({
  block_creeper: { answers: 329, blasted: 13, died: 0, seconds: 0.6, took: 1, meanTaken: 0.1 },
  retreat: { answers: 124, blasted: 42, died: 5, seconds: 0.7, took: 3.6, meanTaken: 2 },
  fight: { answers: 28, blasted: 10, died: 1, seconds: 0.9, took: 5.8, meanTaken: 2.4 },
  creeper_dance: { answers: 19, blasted: 7, died: 1, seconds: 0.9, took: 6.2, meanTaken: 3 },
  shield_guard: { answers: 19, blasted: 4, died: 1, seconds: 1, took: 5.7, meanTaken: 1.6 },
  fight_from_footing: { answers: 14, blasted: 4, died: 0, seconds: 3, took: 13.2, meanTaken: 3.1 },
  shield_the_blast: { answers: 6, blasted: 0, died: 0, seconds: null, took: null, meanTaken: 0 },
  seal: { answers: 5, blasted: 0, died: 0, seconds: null, took: null, meanTaken: 0 },
});
const MIN_ANSWERS = 6;
// Within this many blocks of a creeper the record is the one said.
const RECORD_WITHIN = 3;

function recordOf(stance) {
  const r = RECORD[stance];
  return r && r.answers >= MIN_ANSWERS ? r : null;
}

function recordSays(stance) {
  const r = recordOf(stance);
  if (!r) return '';
  return ` This way's record within ${RECORD_WITHIN} blocks of a creeper: answered ${r.answers} times, ${r.blasted ? `caught by its blast in ${WINDOW_SECONDS} seconds ${r.blasted} times, median ${r.seconds} seconds after, ${r.took} health; ${r.died} of those died` : `caught by its blast in ${WINDOW_SECONDS} seconds none of those times`}.`;
}

// Said on each way on offer with a record, the creeper nearest within
// RECORD_WITHIN blocks; a way priced below its record's mean taken per
// answer is priced at that mean. `options` is the stance tree's top level.
function sayOn(options, { distance } = {}) {
  if (!(distance <= RECORD_WITHIN)) return options;
  for (const [key, o] of Object.entries(options || {})) {
    const r = recordOf(key);
    if (!r || typeof o?.description !== 'string') continue;
    o.description += recordSays(key);
    if (o.expects && Number.isFinite(o.expects.damage) && o.expects.damage < r.meanTaken) o.expects = { ...o.expects, damage: r.meanTaken };
  }
  return options;
}

module.exports = { RECORD, RECORD_WITHIN, WINDOW_SECONDS, recordOf, recordSays, sayOn };
