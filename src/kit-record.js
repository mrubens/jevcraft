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
// Both, as one sentence for a rung's option.
function rungRecordSays(phase, y) {
  const parts = [minutesSays(phase, y), staysSays(phase)].filter(Boolean);
  return parts.length ? ` In the record: ${parts.join('; ')}.` : '';
}

module.exports = { MINUTES, STAYS, minutesSays, staysSays, rungRecordSays };
