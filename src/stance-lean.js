'use strict';
// The blaze fight's stance, asked short (note 2806). The middle batch of 2026-11-09 and 10 (37 trials on one build,
// 114 hours) asked encounter_stance 1,638 times with a blaze within sixteen: about 64,000 characters a time, each
// option a paragraph carrying four records from 2026-09-29 to 10-27, and the two ways that took rods (close in, 69
// in 100 answers with a rod within 45 seconds; charge nearest, 46) were 22 in 100 of the answers. Re-asked from the
// record (232 questions), a corrected fact moved nothing (walking far off 0.03 to 0.04 with its own rule no longer
// gainsaid); each option cut to its price and what the body does, with this batch's own count for it at the bot's
// health, and the state cut to the fight, moved the answers at 14 health or more from 46 to 61 in 100 for a way
// that kills, and left the heal at low health where it was (30 of 64 at 8 to 13 either way). Every option stays
// on offer. JEV_LEAN_STANCE=0 asks it whole.
// [answers, rods in 100, deaths in 100] within 45 seconds of the answer, by the health it was given at: the rows of
// ten answers or more.
const BATCH = {
  await_in_reach: { '14+': [147, 5, 1] },
  back_to_wall: { '14+': [46, 9, 7] },
  box_here: { '14+': [43, 0, 2] },
  charge_nearest: { '14+': [296, 47, 4], '8-13': [10, 20, 20] },
  close_in: { '14+': [47, 72, 0] },
  corner_ambush: { '14+': [131, 18, 3] },
  defer: { '14+': [53, 4, 0] },
  dig_down: { '14+': [18, 0, 6] },
  eat: { '14+': [21, 5, 5] },
  fight: { '14+': [58, 17, 2] },
  fight_from_footing: { '14+': [19, 5, 0] },
  leave_and_heal: { '14+': [112, 17, 4], '8-13': [54, 9, 7], '<8': [22, 5, 5] },
  low_ceiling: { '14+': [21, 5, 5] },
  nook: { '14+': [27, 0, 4] },
  out_of_sight: { '14+': [62, 10, 5] },
  pull_back: { '14+': [56, 4, 2] },
  retreat: { '14+': [54, 9, 2] },
  rise_to_strike: { '14+': [29, 21, 3] },
  seal: { '14+': [23, 9, 17] },
  shield_guard: { '14+': [77, 14, 4] },
};
const SAYS = { '14+': '14 health or more', '8-13': '8 to 13 health', '<8': 'under 8 health' };
const band = h => (h >= 14 ? '14+' : h >= 8 ? '8-13' : '<8');
// By the count within sixteen (the batch's charges at 14 health or more: 73 answers with five or more about, 223 with
// four or fewer), and what a death there came to (its 36 deaths in the Nether in a kit).
const CROWD = ' By the count within sixteen, the charges of the batch at 14 health or more: with five or more about, 41 rods and 8 deaths in 100 answers, a death for every 5 rods; with four or fewer, 49 rods and 3 deaths, a death for every 16. A death in the Nether cost a median 38 minutes before any kit was back on, and 17 of 36 died again bare first.';
// The state kept: the fight as it stands (the mobs, the health and how it comes back, the price of fighting here,
// what was just answered and what it came to). The records of earlier days and the run's long tallies are what is
// cut: re-asked with those kept (playedRecord, playedAnswers, blazeCounts, the scene's history and the rest, about
// 17,000 characters) the answers for a way that kills at 14 health or more were 48 in 100, with these alone 60.
const KEEP = new Set(['mobsHere', 'health', 'food', 'armour', 'weapon', 'shield', 'buildingBlocks', 'dropWithinThreeBlocks', 'threats', 'estimate', 'previousStance', 'hereSoFar', 'healing', 'riskNow', 'rodsNeedMet']);
const first = (d, n) => String(d).split(/(?<=[.!?])\s+(?=[A-Z])/).slice(0, n).join(' ');
const RULE = /The game's rule[\s\S]*?within sixteen of it\./;
// tree and state are changed in place. -> true when it was said short.
function apply(tree, state, { health = 20, within16 = 0, record = '' } = {}) {
  if (process.env.JEV_LEAN_STANCE === '0' || !(within16 >= 1) || !tree || !state) return false;
  const hb = band(health);
  for (const [k, o] of Object.entries(tree)) {
    if (!o || typeof o.description !== 'string') continue;
    const whole = o.description, row = BATCH[k]?.[hb];
    const rule = k === 'wait_far_off' ? (whole.match(RULE) || [''])[0] : '';
    const rec = row ? ` In the batch of 2026-11-09 and 10, this answer at ${SAYS[hb]} with a blaze within sixteen (${row[0]} answers): a rod within 45 seconds ${row[1]} times in 100, a death ${row[2]} in 100.`
      : BATCH[k] ? ` In the batch of 2026-11-09 and 10 this answer was given under ten times at ${SAYS[hb]}: not measured there.` : '';
    // With five or more about, a charge's row is the batch's at that count (73 answers at 14 health or more).
    const many = within16 >= 5 && hb === '14+' && (k === 'close_in' || k === 'charge_nearest');
    const crowd = many ? ` ${within16} are within sixteen now: in the batch the charges with five or more about (73 answers) had a rod within 45 seconds 41 times in 100, a death 8 in 100; with four or fewer (223), 49 and 3.`
      : within16 >= 5 && k === 'wait_far_off' ? ` ${within16} are within sixteen now; after the wait about one in ten of them is left, and the fight is the one with four or fewer.${CROWD}` : '';
    o.description = `${first(whole, 2)}${rule ? ` ${rule}` : ''}${rec}${crowd}`;
  }
  for (const k of Object.keys(state)) if (!KEEP.has(k)) delete state[k];
  state.blazesWithinSixteen = within16;
  if (record) state.blazeRecord = record;
  return true;
}
module.exports = { apply, BATCH, KEEP, CROWD, band };
