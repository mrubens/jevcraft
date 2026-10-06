'use strict';
// What the rungs that are not needed to enter the Nether cost and bought,
// in the bot's own record (note 763). win_strategy offered the Nether with
// "Without nether food for now: the Nether is entered with the food
// carried", and each rung by what it is for, never by what it had cost in
// minutes or what the stays that had it came to. On the four hard source
// worlds (237, 239, 241, 244) 11 of 104 fresh trials reached the Nether in
// 2026-09-30 05:30Z-19:30Z, food, the bed's wool and the climbs for them a
// third of the minutes before it. Said with each rung and with the Nether
// now, the same facts either side: Jev weighs them.
//
// Minutes: scripts/portal-time.js over 2026-09-30 05:30Z-19:30Z, each
// win_strategy answer to the next, summed a trial, the median over the
// trials that chose it, by where it was chosen (under y 40, or at y 40 and
// up). Stays: scripts/portal-time.js --by-world kitRecord over 2026-09-29
// 00:00Z to 2026-09-30 19:30Z, 138 first Nether stays of fresh trials, by
// what was carried or worn at the crossing: whether the stay ended in a
// death, and whether the trial got a blaze rod.
const MINUTES = {
  window: '2026-09-30 05:30Z to 19:30Z',
  // [median minutes, trials] chosen under y 40, and at y 40 or above.
  nether_food: { deep: [4.3, 86], high: [6.5, 120] },
  bed: { deep: [4.4, 47], high: [3.3, 26] },
  home_bed: { deep: [2.5, 10] },
  iron_pickaxe: { deep: [2.3, 47], high: [1.2, 84] },
  stone_pickaxe: { deep: [1.5, 27], high: [0.9, 58] },
  nether_pickaxe: { deep: [0.9, 67], high: [0.4, 115] },
  nether_blocks: { deep: [0.8, 23], high: [0.6, 38] },
  iron_armour: { deep: [1.7, 4], high: [2, 11] },
  iron_leggings: { deep: [2.2, 10], high: [1.1, 17] },
  golden_boots: { deep: [1.4, 12] },
};
const STAYS = {
  window: '2026-09-29 00:00Z to 2026-09-30 19:30Z', stays: 138,
  food: [['under 24 points', 20, 9, 5], ['24 to 79 points', 53, 42, 21], ['80 points or more', 65, 41, 23]],
  bed: [['a bed carried', 67, 44, 20], ['no bed', 71, 48, 29]],
  armor: [['all four armor pieces worn', 36, 20, 9], ['fewer than four', 102, 72, 40]],
  pickaxes: [['two pickaxes or more', 100, 66, 36], ['one pickaxe', 38, 26, 13]],
};
const pct = (a, b) => `${Math.round(100 * a / b)}%`;
const rows = list => list.map(([label, n, died, rod]) => `${label}, ${n} stays: ${pct(died, n)} ended in a death, ${pct(rod, n)} got a blaze rod`).join('; ');
const STAY_OF = { nether_food: 'food', bed: 'bed', home_bed: 'bed', carry_bed: 'bed', iron_armour: 'armor', iron_helmet: 'armor', iron_chestplate: 'armor', iron_leggings: 'armor', iron_boots: 'armor', nether_pickaxe: 'pickaxes' };
const MINUTES_OF = { iron_helmet: 'iron_armour', iron_chestplate: 'iron_armour', iron_boots: 'iron_armour' };

// What a rung took the trials that chose it, from about where the bot is.
function minutesSays(phase, y = 64) {
  const m = MINUTES[phase] || MINUTES[MINUTES_OF[phase]];
  if (!m) return '';
  const side = y < 40 ? 'deep' : 'high', [med, n] = m[side] || m.deep || m.high;
  const where = (m[side] ? side : m.deep ? 'deep' : 'high') === 'deep' ? 'chosen under y 40' : 'chosen at y 40 or above';
  return `trials that chose it (${where}, ${MINUTES.window}) spent a median ${med} minutes on it until the next answer, ${n} trials`;
}
// What the stays that had it came to, against those that did not.
function staysSays(phase) {
  const k = STAY_OF[phase];
  if (!k) return '';
  return `first Nether stays by it (${STAYS.stays} fresh stays, ${STAYS.window}; the played record, not a forecast, and the trials that had it differ in other ways): ${rows(STAYS[k])}`;
}
// The rungs before the Nether, measured whole (note 776): Nether reach fell
// to 6 of 27 fresh trials after 00:41Z on 2026-10-01, 0 of 9 on the worlds
// that start underground, food 30 to 53% of the pre-Nether minutes on five
// worlds and the gear rungs 21 to 31% on three. Every rung that may wait was
// on the ladder by default, handed back after the Nether first's half hour,
// whatever the record said it bought.
//
// Per rung, scripts/portal-time.js --rungs over the fresh trials of
// RUNGS.window (107 trials, 3,731 pre-Nether minutes): [trials that worked
// on it before the Nether, the minutes they spent on it (its climbs
// counted; the night, fights and the survival layer's own food left out),
// the median minutes a trial, of the trials begun without what it makes how
// many had it at the Nether or the record's end, and how many were begun
// without it]. The first Nether stays of fresh trials over RUNG_STAYS.window,
// by whether what the rung makes was carried or worn at the crossing:
// [stays, ended in a death, the trial got a blaze rod], with and without.
const RUNGS = {
  window: '2026-09-30 20:00Z to 2026-10-01 03:00Z', trials: 107, preNetherMinutes: 3731,
  stone_pickaxe: [22, 123, 3.4, 3, 6], stone_sword: [1, 1, 1, 1, 1], bed: [39, 193, 2.7, 14, 39],
  iron_pickaxe: [37, 159, 2.5, 15, 22], bucket: [1, 1.7, 1.7, 0, 0], iron_armour: [24, 56, 1.4, 19, 24],
  golden_boots: [25, 79, 2.1, 12, 25], bow: [1, 3, 3, 0, 1], diamond_sword: [13, 23, 1.3, 2, 13],
  nether_pickaxe: [27, 68, 2.3, 9, 14], nether_blocks: [19, 113, 2, 6, 8], nether_food: [79, 848, 10.7, 20, 79],
  nether_chest: [6, 7.7, 1, 0, 1],
};
const RUNG_STAYS = {
  window: '2026-09-26 to 2026-10-01 03:00Z', stays: 113,
  bed: [[47, 25, 12], [66, 43, 27]], shield: [[108, 66, 38], [5, 2, 1]], iron_sword: [[102, 62, 38], [11, 6, 1]],
  bucket: [[108, 67, 38], [5, 1, 1]], iron_armour: [[47, 21, 11], [66, 47, 28]], golden_boots: [[31, 13, 10], [82, 55, 29]],
  bow: [[13, 5, 2], [100, 63, 37]], arrows: [[0, 0, 0], [113, 68, 39]], diamond_sword: [[5, 2, 2], [108, 66, 37]],
  nether_pickaxe: [[86, 56, 30], [27, 12, 9]], nether_blocks: [[79, 49, 28], [34, 19, 11]],
  nether_food: [[48, 32, 17], [65, 36, 22]], nether_chest: [[12, 5, 0], [101, 63, 39]],
};
// What a rung makes is a family: the armour pieces one set, the beds one bed.
const familyOf = phase => /^iron_(armour|helmet|chestplate|leggings|boots)$/.test(phase || '') ? 'iron_armour' : /^(bed|home_bed|carry_bed)$/.test(phase || '') ? 'bed' : phase;
// The rule, stated with every rung it touches: a rung that may wait is on
// the ladder before the Nether only where its stays show a benefit, at least
// BENEFIT_MIN stays on each side, and either a blaze rod got BENEFIT_POINTS
// points more often with it, or a death BENEFIT_POINTS points less often
// with a rod no more than ROD_SLACK points less often. Fewer stays than that
// on a side is no measure, and no measure is no benefit shown.
const BENEFIT_MIN = 10, BENEFIT_POINTS = 10, ROD_SLACK = 5;
const pctOf = (a, b) => b ? Math.round(100 * a / b) : 0;
// What a rung buys before the Nether, where that and not the first stay is
// its point (note 841): the bed's nights. scripts/night-time.js over the
// fresh trials from 2026-09-30 12:00Z to 2026-10-01 22:30Z: on the surface
// at night 1478 bot-minutes, 468 of them sealed in a pocket and 101 holding
// against mobs (7 deaths), 841 working (5 deaths), 15 asleep. A night slept
// passes in seconds; one awake is about eight and a half real minutes from
// bedtime. Judged by the first Nether stays alone (note 776), the bed was
// "no benefit" and made only if chosen, and from 18:53Z Fable's check-in
// found sealed waiting the largest waste (9.9 hours).
const BEFORE_NETHER = {
  bed: { says: 'its nights in the record (fresh trials 2026-09-30 12:00Z to 2026-10-01 22:30Z): on the surface at night 1478 bot-minutes awake, 468 of them sealed in a pocket waiting and 101 holding against mobs (7 deaths), 15 asleep; a night slept passes in seconds, one awake is about eight and a half real minutes from bedtime',
    verdict: 'a benefit before the Nether, in the nights it saves (the first Nether stays are not what it is for): made before the Nether unless set aside' },
  // Iron armour by what its blaze fights take (note 1020), not by the first
  // stays: those said "no benefit" (45% of stays with it ended in a death
  // against 71% without, a rod 19 points less often), the ladder left the
  // leggings and boots to be chosen, and with no leggings worn Jev took the
  // Nether first 47 times and the leggings 4 on 2026-10-03 (00:00 to
  // 08:40Z). 19 of 41 Nether entries were short of a piece, 130 of 184
  // blaze fights were fought in two, and those took three times the health.
  iron_armour: { says: 'its blaze fights in the record (scripts/blaze-record.js, fights begun over 16 health): 2026-10-03 04:00Z to 08:40Z, in a helmet and chestplate 130 fights took 12.9 health each, in three or four iron pieces 54 took 4.4; 2026-09-28 and 2026-09-29, 380 took 17.1 and 105 took 11.5',
    verdict: 'a benefit before the Nether, in the health a blaze fight takes (the first stays differ in other ways): each piece short is made before the Nether unless set aside' },
};
function benefitOf(phase) {
  const before = BEFORE_NETHER[familyOf(phase)];
  if (before) return { measured: true, benefit: true, before: before.says, verdict: before.verdict };
  const s = RUNG_STAYS[familyOf(phase)];
  if (!s) return { measured: false, benefit: false };
  const [[wn, wd, wr], [on, od, or]] = s;
  if (wn < BENEFIT_MIN || on < BENEFIT_MIN) return { measured: false, benefit: false, with: s[0], without: s[1] };
  const rodGain = pctOf(wr, wn) - pctOf(or, on), deathCut = pctOf(od, on) - pctOf(wd, wn);
  const benefit = rodGain >= BENEFIT_POINTS || (deathCut >= BENEFIT_POINTS && rodGain >= -ROD_SLACK);
  return { measured: true, benefit, rodGain, deathCut, with: s[0], without: s[1] };
}
// Whether a rung that may wait stays on the ladder before the Nether.
const needBeforeNether = phase => benefitOf(phase).benefit;
const ruleSays = `a rung that may wait is made before the Nether unasked only where the first Nether stays with what it makes did better than those without (at least ${BENEFIT_MIN} stays each side; a blaze rod got ${BENEFIT_POINTS} points more often, or a death ${BENEFIT_POINTS} points less often with a rod no more than ${ROD_SLACK} points less often); the bed by the nights it saves before the Nether (note 841), iron armour by the health its blaze fights take (note 1020)`;
// The record of a rung before the Nether: what it took, whether it was
// finished, and what the stays with and without it came to; then where the
// rule puts it. One sentence, the same wherever the rung is weighed.
function rungRecordSays(phase) {
  const fam = familyOf(phase), r = RUNGS[fam], s = RUNG_STAYS[fam];
  if (!r && !s) return '';
  const parts = [];
  if (r) parts.push(`fresh trials ${RUNGS.window}: ${r[0]} of ${RUNGS.trials} worked on it before the Nether, a median ${r[2]} minutes each (${r[1]} minutes in all, ${pctOf(r[1], RUNGS.preNetherMinutes)}% of every pre-Nether minute)${r[4] ? `, and ${r[3]} of the ${r[4]} begun without it had it by the Nether` : ''}`);
  if (s) parts.push(`first Nether stays (${RUNG_STAYS.stays}, ${RUNG_STAYS.window}; the played record, not a forecast, and the trials differ in other ways): with it ${s[0][0]}, ${pctOf(s[0][1], s[0][0])}% ended in a death, ${pctOf(s[0][2], s[0][0])}% got a blaze rod; without it ${s[1][0]}, ${pctOf(s[1][1], s[1][0])}% and ${pctOf(s[1][2], s[1][0])}%`);
  const b = benefitOf(phase);
  if (b.before) parts.push(b.before);
  const verdict = b.before ? b.verdict : b.benefit ? 'a benefit in the record: made before the Nether unless set aside' : b.measured ? 'no benefit in the record: optional before the Nether, made only if chosen' : 'too few stays on a side to measure: optional before the Nether, made only if chosen';
  return ` In the record: ${parts.join('; ')}. ${verdict[0].toUpperCase()}${verdict.slice(1)} (${ruleSays}).`;
}

// The same record, short, where several rungs are said in one option (the
// Nether now, each rung it leaves).
function rungRecordShort(phase) {
  const fam = familyOf(phase), r = RUNGS[fam], s = RUNG_STAYS[fam];
  if (!r && !s) return '';
  const b = benefitOf(phase);
  return ` Its record: ${r ? `${r[0]} of ${RUNGS.trials} trials worked on it before the Nether, a median ${r[2]} minutes each${r[4] ? `, ${r[3]} of ${r[4]} had it by the Nether` : ''}` : 'not worked on in the trials measured'}${s ? `; first Nether stays with it ${pctOf(s[0][1], s[0][0])}% ended in a death and ${pctOf(s[0][2], s[0][0])}% got a rod (${s[0][0]}), without it ${pctOf(s[1][1], s[1][0])}% and ${pctOf(s[1][2], s[1][0])}% (${s[1][0]})` : ''}; ${b.before ? `${b.before}: a benefit before the Nether` : b.benefit ? 'a benefit in the record' : b.measured ? 'no benefit in the record' : 'too few stays to measure'}.`;
}

// Deaths a bot-hour with no armour worn against some (note 1359), from the
// trials' flight records of 2026-10-05 07:00Z to 2026-10-06 07:00Z
// (artifacts/handoff-live/armour-rate.js): the time is the observations',
// each death credited to the last hurt frame before it.
const BARE_RECORD = Object.freeze({ window: '2026-10-05 07:00Z to 2026-10-06 07:00Z',
  overworld: { bare: [137, 137.9], armoured: [47, 112.4] }, nether: { bare: [71, 26.9], armoured: [55, 44.8] } });
function bareSays(dimension) {
  const r = BARE_RECORD[/nether/.test(String(dimension || '')) ? 'nether' : 'overworld'], where = /nether/.test(String(dimension || '')) ? 'the Nether' : 'the Overworld';
  const rate = ([d, h]) => (Math.round(d / h * 100) / 100).toFixed(2);
  return `In the trials' record (${BARE_RECORD.window}), in ${where} with no armour worn ${rate(r.bare)} deaths a bot-hour (${r.bare[0]} in ${Math.round(r.bare[1])} bot-hours), with any piece on ${rate(r.armoured)} (${r.armoured[0]} in ${Math.round(r.armoured[1])}).`;
}
module.exports = { BARE_RECORD, bareSays, BEFORE_NETHER, rungRecordShort, MINUTES, STAYS, RUNGS, RUNG_STAYS, BENEFIT_MIN, BENEFIT_POINTS, ROD_SLACK, familyOf, benefitOf, needBeforeNether, ruleSays, minutesSays, staysSays, rungRecordSays };
