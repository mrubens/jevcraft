'use strict';
// The food reserve: one number, priced from the record (note 796).
//
// Of the played time in the flight records from 2026-09-30 06:00Z to
// 2026-10-01 04:57:47Z (scripts/food-stock.js, 658 records, 237 bot-hours,
// Jev up), 21.7% was spent with no food carried that heals, 27% of the time
// under y 56; 50 of the 177 moments health fell under 8 had none, 25 of
// those dying within the minute, and 39 of the 105 deaths. 259 of the
// spells with none began when the last food was eaten, 181 of them on the
// surface, and in 163 of them no food answer came while what was carried
// ran down from under twelve to none (a median 0.6 minutes). Nothing kept a reserve on the game's ladder before
// the crossing: the survival layer asked for food only once hunger fell
// (eighteen on the surface, twelve under rock) and called hunger at
// eighteen with one beef carried met (note 761); upkeep's food_reserve
// asked for twelve points only in the last minutes of daylight; the stash
// kept twelve in the pockets; the crossing wanted 80 in the survival layer
// and its own stay (crossing-kit.js netherStay) in kit_food.
//
// Here the reserve is read from the record: of the played minutes at each
// level of food carried, how many were followed within half an hour by
// health under 8 with nothing that heals carried. The reserve is the least
// food carried from which no level carried came to that more than one time
// in fifty (FLOOR: 12 in the Overworld, 36 in the Nether). Under it the
// survival layer asks for food on the game's ladder as for the reserve
// alone, priced with this record beside the work (note 771's words, note
// 784's held answer); the crossing's reserve is its stay, never less than
// the Nether's floor; the stash, the tidy and the held answer to food or
// the work read the same number.

// Played minutes by food points carried, and how many were followed within
// 30 minutes by a low-health moment (health falling under 8) with no
// healing food carried (scripts/food-stock.js aheadLowWithNone, fine rows).
const RECORD = Object.freeze({
  window: '2026-09-30 06:00Z to 2026-10-01 04:57Z',
  overworld: [[0, 0, 2735, 503], [1, 5, 722, 47], [6, 11, 1828, 71], [12, 17, 848, 9], [18, 23, 735, 11], [24, 35, 1021, 12], [36, 47, 493, 1], [48, 79, 1691, 17], [80, Infinity, 2415, 2]],
  nether: [[0, 0, 378, 74], [1, 5, 20, 14], [6, 11, 84, 37], [12, 17, 38, 15], [18, 23, 164, 13], [24, 35, 111, 32], [36, 47, 123, 0], [48, 79, 322, 0], [80, Infinity, 746, 7]],
});
const SHARE = 1 / 50;
const pct = (n, m) => Math.round(1000 * n / Math.max(1, m)) / 10;

// The least food carried from which no level in the record came to health
// under 8 with nothing to eat within half an hour more than `share` of the
// time.
function floorOf(rows, share = SHARE) {
  let floor = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const [lo, , m, hit] = rows[i];
    if (hit / Math.max(1, m) > share) break;
    floor = lo;
  }
  return floor ?? rows.at(-1)[0];
}
const FLOOR = Object.freeze({ overworld: floorOf(RECORD.overworld), nether: floorOf(RECORD.nether) });

const dimOf = bot => String(bot?.game?.dimension || 'overworld').replace(/^minecraft:/, '');
const whereOf = bot => /nether/.test(dimOf(bot)) ? 'nether' : 'overworld';
const rowOf = (points, where) => RECORD[where].find(([lo, hi]) => points >= lo && points <= hi);
const rangeSays = ([lo, hi]) => hi === Infinity ? `${lo} or more` : lo === hi ? (lo === 0 ? 'none' : `${lo}`) : `${lo} to ${hi}`;

// Whether the game's ladder keeps this reserve: a win goal (the trials'),
// not in peaceful.
const keeps = (bot, goal) => goal?.kind === 'win' && bot?.game?.difficulty !== 'peaceful';

// The floor here, for this goal: the record's, or 1 (any food carried)
// where the ladder keeps none.
function floorFor(bot, goal) {
  return keeps(bot, goal) ? FLOOR[whereOf(bot)] : 1;
}

// The crossing's want: its stay's food, never under the Nether's floor (a
// stay counted short at the end of the work still crosses into a place
// where under 36 points came to health under 8 with nothing to eat 7% to
// 70% of the time). Read by kit_food, the kit's rungs, the stash and the
// survival layer alike.
function crossingWant(bot, goal = null, stay = null) {
  let points = stay?.points ?? null;
  if (points == null) { try { points = require('./crossing-kit').netherStay(bot, goal).points; } catch (_) { points = 80; } }
  return Math.max(points, FLOOR.nether);
}

// What the reserve wants carried, and what for: the End's 64; the crossing's
// stay (crossing-kit.js netherStay), never under the Nether's floor; else
// the floor where the bot is.
function wanted(bot, goal) {
  if (goal?.preparingEnd) return { points: 64, for: 'the End', crossing: true };
  if (goal?.preparingNether) return { points: crossingWant(bot, goal), for: 'the Nether stay', crossing: true };
  return { points: keeps(bot, goal) ? FLOOR[whereOf(bot)] : 12, for: 'healing and the night', crossing: false };
}

// The record, said for what is carried: its own row, none, and the floor's.
function says(points, where = 'overworld') {
  const rows = RECORD[where], row = rowOf(Math.max(0, points), where), none = rows[0];
  const above = rows.filter(([lo]) => lo >= FLOOR[where]);
  const worst = above.reduce((a, r) => Math.max(a, pct(r[3], r[2])), 0);
  const place = where === 'nether' ? 'in the Nether' : 'in the Overworld';
  const own = row === none ? '' : `${pct(row[3], row[2])}% with ${rangeSays(row)} food points carried (${row[3]} of ${row[2]}), `;
  return `In the record (${RECORD.window}), the share of played minutes ${place} followed within half an hour by health under 8 with nothing that heals carried: ${own}${pct(none[3], none[2])}% with none (${none[3]} of ${none[2]}), at most ${worst}% at any level from ${FLOOR[where]} up. The reserve kept ${place} is ${FLOOR[where]} food points: the least from which no level carried came to that more than one time in fifty.`;
}
function sayHere(bot, points) { return says(points, whereOf(bot)); }
// The floor in a line: the record's range under it and the most at or over it.
function floorSays(where = 'overworld') {
  const rows = RECORD[where], under = rows.filter(([lo]) => lo < FLOOR[where]).map(r => pct(r[3], r[2])), over = rows.filter(([lo]) => lo >= FLOOR[where]).map(r => pct(r[3], r[2]));
  return `the ${FLOOR[where]} food points the reserve keeps ${where === 'nether' ? 'in the Nether' : 'in the Overworld'}: in the record, under it health fell under 8 with nothing that heals carried within half an hour ${Math.min(...under)}% to ${Math.max(...under)}% of the time, at it or more at most ${Math.max(...over)}%`;
}

// Under the floor where the ladder keeps it.
function short(bot, goal, supply) {
  return keeps(bot, goal) && supply < FLOOR[whereOf(bot)];
}

module.exports = { RECORD, FLOOR, SHARE, floorOf, floorFor, wanted, crossingWant, says, sayHere, floorSays, short, keeps, whereOf };
