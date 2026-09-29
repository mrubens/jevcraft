'use strict';
// What came after a blaze rod was picked up (note 659), said to Jev once a rod
// has been picked up in this life: the choice after a rod is to stay at the
// blazes for the next or go away to heal first, and 25590's funnel (107 runs to
// a first rod, 10 to a third, 9 of those dead within 158 seconds of their last)
// said the bottleneck is living through what comes after a rod, not the rod.
// scripts/after-rod.js read the flight records from 2026-09-28T00:00Z to the
// last rod at 2026-09-29T04:11Z: every rod gained in the Nether, what came
// first after it (the bot's death, another rod, out of the Nether, or the
// record's end, a restart mostly), and what the bot did first (its first
// answer to the stance or the hunt within the minute). Counts, with N; they
// are what followed each rod, not what the answer caused: the bots that went
// away to heal were not in the same fights as those that stayed.
const OF = { from: '2026-09-28T00:00Z', to: '2026-09-29T04:11Z' };
// [rods, died before another rod or leaving, of those within three minutes,
// median seconds to the death, another rod, left the Nether, record ended]
const ROWS = {
  all: [109, 43, 20, 224, 34, 3, 29],
  stayed: [53, 22, 15, 86, 17, 2, 12],
  away: [20, 5, 2, 224, 8, 0, 7],
  unasked: [34, 15, 3, 326, 8, 1, 10],
  stayedWithThreeOrMore: [11, 5, 3, 98, 6, 0, 0],
  underEight: [7, 5, 5, 2, 0, 0, 2],
  eightToSixteen: [52, 20, 6, 237, 16, 2, 14],
  overSixteen: [50, 18, 9, 253, 18, 1, 13],
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
  return `The last blaze rod was picked up ${secs} seconds ago, ${seen.n} carried now. What came first after each rod the bots picked up in the Nether from ${OF.from} to ${OF.to} (from the flight records): ${rowSays(ROWS.all, 'all rods')}. By what the bot did first in the minute after the rod: ${rowSays(ROWS.stayed, 'stayed at the blazes (its first answer a strike, a fight, cover or the work)')}; ${rowSays(ROWS.away, 'went away to heal or ran (leave_and_heal, eat, retreat, leave_reach)')}; ${rowSays(ROWS.unasked, 'no stance or hunt answer in that minute')}. Staying with three or more rods carried: ${rowSays(ROWS.stayedWithThreeOrMore, 'those rods')}. By the health at the rod, ${bandWord} as now (${Math.round(h * 10) / 10}): ${rowSays(band, 'those rods')}. These are what followed, not what the answer caused: the bots that went away were not in the same fights as those that stayed.`;
}

module.exports = { says, noteRods, ROWS, OF };
