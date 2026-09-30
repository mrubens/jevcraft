'use strict';
// What each layer given the turn at 6 health or under came to, from the
// played record (scripts/low-health-turns.js over the flight records of
// 2026-09-29 23:00Z to 2026-09-30 14:29Z, 735 files; note 752c). Counted
// from turn_priority's answers; a death is health at 0 within 60 seconds.
// Regenerate with the script and update these figures; they are said as
// the record, with their counts, not used as a threshold.
const MEASURED = { from: '2026-09-29T23:00Z', to: '2026-09-30T14:29Z' };
const AFTER_HIT = {
  work: { turns: 11, died: 3 },
  eat: { turns: 25, died: 3 },
  survival: { turns: 216, died: 90 },
};
const QUIET = {
  work: { turns: 25, died: 2 },
  eat: { turns: 8, died: 0 },
};

function says({ hit = true } = {}) {
  const t = hit ? AFTER_HIT : QUIET;
  const when = hit ? 'at 6 health or under within 20 seconds of a hit' : 'at 6 health or under with no hit in the 20 seconds before';
  return `In the played record (${MEASURED.from} to ${MEASURED.to}), ${when}, the work given the turn was followed by a death within a minute ${t.work.died} times in ${t.work.turns}, and a meal ${t.eat.died} in ${t.eat.turns}.`;
}

module.exports = { says, AFTER_HIT, QUIET, MEASURED };
