'use strict';
// What came after a blaze rod was picked up (note 659), said to Jev once a rod
// has been picked up in this life: the choice after a rod is to stay at the
// blazes for the next or go away to heal first, and 25590's funnel (107 runs to
// a first rod, 10 to a third, 9 of those dead within 158 seconds of their last)
// said the bottleneck is living through what comes after a rod, not the rod.
// scripts/after-rod.js read the flight records from 2026-09-28T00:00Z to the
// last rod at 2026-09-29T04:11Z (the first table; see below): every rod gained in the Nether, what came
// first after it (the bot's death, another rod, out of the Nether, or the
// record's end, a restart mostly), and what the bot did first (its first
// answer to the stance or the hunt within the minute). Counts, with N; they
// are what followed each rod, not what the answer caused: the bots that went
// away to heal were not in the same fights as those that stayed.
// Refreshed for note 661 (the whole record to the last rod, 2026-09-29T11:39Z,
// 284 rods): the first table, of 109 rods, had those that went away at 5 deaths
// of 20, safer than those that stayed (42%), and that was said to Jev after
// every rod; the overnight rods that followed it (185) had those that went away
// at 24 of 43 dead and those that stayed at 33 of 107. The small first row had
// the wrong sign, so the rows are the whole record and each answer is also
// compared within its own health (BY_BAND).
const OF = { from: '2026-09-28T00:00Z', to: '2026-09-29T11:39Z' };
// [rods, died before another rod or leaving, of those within three minutes,
// median seconds to the death, another rod, left the Nether, record ended]
const ROWS = {
  all: [284, 101, 59, 108, 146, 5, 32],
  stayed: [157, 54, 31, 129, 89, 3, 11],
  away: [63, 29, 18, 40, 27, 0, 7],
  unasked: [62, 17, 10, 136, 29, 2, 14],
  stayedWithThreeOrMore: [55, 19, 10, 151, 35, 1, 0],
  underEight: [22, 18, 16, 13, 2, 0, 2],
  eightToSixteen: [93, 33, 15, 195, 43, 2, 15],
  overSixteen: [169, 50, 28, 129, 101, 3, 15],
};
// What the bot did first, within each health band (scripts/after-rod.js:
// byHealthAndWhatItDidFirst): the same rods, so the answer is compared with
// the others of its own health, not with a fitter or a weaker bot's.
const BY_BAND = {
  overSixteen: { stayed: [101, 33, 20, 99, 62, 2, 4], away: [33, 12, 6, 187, 17, 0, 4], unasked: [34, 5, 2, 253, 21, 1, 7] },
  eightToSixteen: { stayed: [48, 15, 6, 226, 26, 1, 6], away: [22, 11, 7, 29, 9, 0, 2], unasked: [22, 6, 2, 306, 8, 1, 7] },
  underEight: { stayed: [8, 6, 5, 60, 1, 0, 1], away: [8, 6, 5, 34, 1, 0, 1], unasked: [6, 6, 6, 1, 0, 0, 0] },
};
const row = r => ({ rods: r[0], died: r[1], diedWithin3: r[2], medianToDeath: r[3], anotherRod: r[4], left: r[5], ended: r[6] });
const pct = (k, n) => Math.round(100 * k / n);
const rowSays = (r, what) => { const x = row(r); return `${what} (${x.rods}): ${x.died} died before another rod or leaving the Nether (${pct(x.died, x.rods)}%; ${x.diedWithin3} within three minutes of the rod${x.died ? `, median ${x.medianToDeath} seconds after it` : ''}), ${x.anotherRod} took another rod first (${pct(x.anotherRod, x.rods)}%), ${x.left} left the Nether first, ${x.ended} were at a record's end (a restart) first`; };

const equivalent = bot => { let n = 0; try { for (const i of bot.inventory?.items?.() || []) { if (i.name === 'blaze_rod') n += i.count || 0; else if (i.name === 'blaze_powder') n += (i.count || 0) / 2; } } catch (_) { /* no inventory */ } return Math.floor(n); };
// The rods carried, looked at: a rise is a rod picked up (its time kept on the
// bot), a fall to fewer is the life's rods gone (a death, a chest), and the
// last rod's time goes with them.
function noteRods(bot, now = Date.now()) {
  if (!bot) return null;
  const n = equivalent(bot), seen = bot._rodsSeen;
  if (!seen) bot._rodsSeen = { n, lastGainAt: null, healthAt: null };
  else if (n > seen.n) Object.assign(seen, { n, lastGainAt: now, healthAt: bot.health ?? null });
  else if (n < seen.n) Object.assign(seen, { n, lastGainAt: n ? seen.lastGainAt : null });
  return bot._rodsSeen;
}
const inNether = bot => /nether/.test(String(bot?.game?.dimension || ''));
// Said while a rod picked up in this life is carried, in the Nether: the
// seconds since it, and what followed the rods of the trials. -> string or null
function says(bot, now = Date.now()) {
  const seen = noteRods(bot, now);
  if (!seen?.lastGainAt || !inNether(bot)) return null;
  const secs = Math.max(0, Math.round((now - seen.lastGainAt) / 1000));
  const h = bot.health ?? 20;
  const band = h > 16 ? ROWS.overSixteen : h > 8 ? ROWS.eightToSixteen : ROWS.underEight;
  const bandWord = h > 16 ? 'over 16' : h > 8 ? '8 to 16' : 'under 8';
  const inBand = h > 16 ? BY_BAND.overSixteen : h > 8 ? BY_BAND.eightToSixteen : BY_BAND.underEight;
  const within = ['stayed', 'away', 'unasked'].map(k => { const x = row(inBand[k]); return `${{ stayed: 'stayed at the blazes', away: 'went away first', unasked: 'no answer in the minute' }[k]} ${x.rods} rods, ${x.died} died (${pct(x.died, x.rods)}%)`; }).join('; ');
  return `The last blaze rod was picked up ${secs} seconds ago, ${seen.n} carried now. What came first after each rod the bots picked up in the Nether from ${OF.from} to ${OF.to} (from the flight records): ${rowSays(ROWS.all, 'all rods')}. By what the bot did first in the minute after the rod: ${rowSays(ROWS.stayed, 'stayed at the blazes (its first answer a strike, a fight, cover or the work)')}; ${rowSays(ROWS.away, 'went away to heal or ran (leave_and_heal, eat, retreat, leave_reach)')}; ${rowSays(ROWS.unasked, 'no stance or hunt answer in that minute')}. Staying with three or more rods carried: ${rowSays(ROWS.stayedWithThreeOrMore, 'those rods')}. By the health at the rod, ${bandWord} as now (${Math.round(h * 10) / 10}): ${rowSays(band, 'those rods')}. Within that health: ${within}. These are what followed, not what the answer caused: the bots that went away were not in the same fights as those that stayed.`;
}

module.exports = { says, noteRods, ROWS, BY_BAND, OF };
