'use strict';
// What fights with blazes came to when the bot played them (note 631): the
// flight records of the trials, read by scripts/blaze-record.js (the headline
// rows, `--deaths` for the deaths). Counted first over 2026-09-28 (415 fights,
// 70 deaths by a blaze or its fire) and counted again for note 661 over
// 2026-09-28T00:00Z to 2026-09-29T11:40Z, the two days together: 624 fights,
// 145 of 343 deaths by a blaze or its fire. The arena's rows say what a stand
// did in a drill; this says what the bot's fights did in the fortresses, by the
// health and the hunger it began them at: the ones begun hurt were mostly lost.
// A fight: a run of blazes in sight within 24 blocks, or hurting the bot, a gap
// of 30 seconds ending it.
const DAY = '2026-09-28 to 2026-09-29T11:40Z';
const ALL = { fights: 624, died: 162, diedPct: 26, rodFights: 186, rodPct: 30, rods: 261 };
const HEALTH = [
  { over: 16, said: 'over 16 health', fights: 523, diedPct: 22, rodPct: 34 },
  { over: 8, said: '8 to 16 health', fights: 72, diedPct: 40, rodPct: 11 },
  { over: -1, said: 'under 8 health', fights: 29, diedPct: 62, rodPct: 3 },
];
const HUNGER = { fed: { fights: 462, diedPct: 23, rodPct: 35 }, hungry: { fights: 162, diedPct: 33, rodPct: 16 } };
const BLAZES = { few: { fights: 171, diedPct: 15, rodPct: 25 }, spawner: { fights: 357, diedPct: 34, rodPct: 30 } };
const IRON = { four: { fights: 55, diedPct: 24 }, some: { fights: 526, diedPct: 26 } };
// The deaths by a blaze or its fire (145): where the last minute's damage
// went, and how many took their last landing at 6.5 health or less (83 of
// the 128 with one in their last fifteen seconds), where one landing ends it.
const DEATHS = { deaths: 145, fireballPct: 48, firePct: 32, blowsPct: 16, otherPct: 4, lastLanding: 128, atSixAndAHalfOrLess: 83 };

// The newest trials (note 661; scripts/blaze-record.js `--recent --from 2026-09-29T04:49:00Z
// --to 2026-09-29T11:40:00Z` wrote the rows): 248 fights on the code of commit
// 3c1af18, every one begun in an iron helmet and chestplate and nothing more
// iron, and the part of the record above that a spawner's fights are in. On the
// first day's rows alone a spawner's fights ended in a death one time in five
// (21%) and a rod one in eleven; on these, at a live spawner with four or more
// blazes within sixteen, half ended in a death and about as many in a rod, and
// every other fight in a death one time in eight. `rods` are the rods gained
// in those fights, `lost` the mean health lost.
const RECENT = { from: '2026-09-29T04:49Z', to: '2026-09-29T11:37Z', fights: 248,
  spawner: { fights: 114, died: 56, rod: 51, rods: 79, lost: 24.2 },
  elsewhere: { fights: 134, died: 17, rod: 67, rods: 98, lost: 12.2 },
  few: { fights: 61, died: 6, rod: 25 }, some: { fights: 62, died: 8, rod: 38 } };
// The health lost per fight by iron worn, fights begun over 16 health of the two
// days (2026-09-28 to 2026-09-29T11:40Z): the death rates moved two points (24% with
// four pieces, 26% with two or three), the health lost a third.
const IRON_LOST = { two: { fights: 380, lost: 17.1 }, more: { fights: 105, lost: 11.5 } };

const pctOf = (k, n) => Math.round(100 * k / n);
const rodSays = pct => pct === 0 ? 'none brought a rod' : `${pct}% brought a rod`;
// What iron armour did, from the record: the deaths barely moved (four pieces
// 24% died, two or three 26%), but the health a fight took did,
// and the arithmetic of the game says why: armour takes part of a fireball's
// hit and none of the fire it sets.
function ironSays() {
  let hits = '';
  try {
    const ce = require('./combat-estimate'), hit = ce.MOBS.blaze.hit, through = names => Math.round(ce.afterArmour(hit, ce.armourOf(names)) * 10) / 10;
    hits = ` a fireball's ${hit} before armour is ${through(['iron_helmet', 'iron_chestplate'])} through a helmet and chestplate and ${through(['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'])} through all four iron pieces, and the fire it sets (a health a second for five seconds) is not reduced at all;`;
  } catch (_) { hits = ''; }
  return `Iron armour: the deaths barely moved (four pieces ${IRON.four.diedPct}% died, two or three ${IRON.some.diedPct}%), but what a fight took did:${hits} fights begun over 16 health took ${IRON_LOST.two.lost} health with a helmet and chestplate (${IRON_LOST.two.fights} fights of 2026-09-28 and 2026-09-29) and ${IRON_LOST.more.lost} with three or four iron pieces (${IRON_LOST.more.fights} fights).`;
}
// The newest trials' rows for a spawner's fights and the rest, with the rods
// each death cost (note 661).
function recentSays(within16 = 0) {
  const r = RECENT, sp = r.spawner, el = r.elsewhere, per = (rods, died) => died ? `${Math.round(rods / died * 10) / 10} rods for each death` : 'no death';
  return ` In the newest trials (${r.from} to ${r.to}, ${r.fights} fights on the current code, each begun in an iron helmet and chestplate and nothing more iron): at a live spawner with four or more blazes within sixteen, ${sp.fights} fights, ${pctOf(sp.died, sp.fights)}% died and ${pctOf(sp.rod, sp.fights)}% brought a rod (${sp.rods} rods, ${sp.died} deaths: ${per(sp.rods, sp.died)}; ${sp.lost} health lost a fight); every other fight, ${el.fights}, ${pctOf(el.died, el.fights)}% died and ${pctOf(el.rod, el.fights)}% brought a rod (${el.rods} rods, ${el.died} deaths: ${per(el.rods, el.died)}; ${el.lost} health lost a fight). With no more than one blaze within sixteen at once ${r.few.fights} fights, ${pctOf(r.few.died, r.few.fights)}% died and ${pctOf(r.few.rod, r.few.fights)}% brought a rod; two or three, ${r.some.fights} fights, ${pctOf(r.some.died, r.some.fights)}% died and ${pctOf(r.some.rod, r.some.fights)}% brought a rod. A fight brought a rod as often among four or more blazes as among fewer; what changed with their number is the deaths.${within16 >= 4 ? ` ${within16} are within sixteen now.` : ''}`;
}
// The record said with the row the bot is in: its health, its hunger, and
// how many blazes are about it (three within sixteen blocks is a spawner's).
function says(bot, { day = DAY } = {}) {
  const health = bot?.health ?? 20, food = bot?.food ?? 20;
  const here = bot?.entity?.position;
  const within16 = here ? Object.values(bot.entities || {}).filter(e => e?.name === 'blaze' && e.position && e.isValid !== false && e.position.distanceTo(here) <= 16).length : 0;
  const band = HEALTH.find(h => health > h.over) || HEALTH.at(-1);
  const parts = [`In the trials of ${day}, ${ALL.fights} fights with blazes (a run of blazes in sight, or hurting the bot, ending after thirty seconds without): ${ALL.diedPct}% ended in the bot's death and ${ALL.rodPct}% in a blaze rod (${ALL.rods} rods, ${ALL.died} deaths).`];
  parts.push(` Begun at the health this bot has, ${Math.round(health * 10) / 10}, the row is ${band.said}: ${band.fights} fights, ${band.diedPct}% died, ${rodSays(band.rodPct)}; the other rows, over 16 health ${HEALTH[0].diedPct}% died and ${HEALTH[0].rodPct}% brought a rod, 8 to 16 ${HEALTH[1].diedPct}% and ${HEALTH[1].rodPct}%, under 8 ${HEALTH[2].diedPct}% and ${HEALTH[2].rodPct ? `${HEALTH[2].rodPct}%` : 'none'}.`);
  if (food < 18) parts.push(` With hunger under 18, as here (${food}), where health does not come back: ${HUNGER.hungry.fights} fights, ${HUNGER.hungry.diedPct}% died and ${HUNGER.hungry.rodPct}% brought a rod, against ${HUNGER.fed.diedPct}% and ${HUNGER.fed.rodPct}% at 18 or more.`);
  parts.push(` By the blazes about at most: with three or more within sixteen blocks (a spawner's) ${BLAZES.spawner.fights} fights, ${BLAZES.spawner.diedPct}% died and ${BLAZES.spawner.rodPct}% brought a rod; with one or none ${BLAZES.few.fights} fights, ${BLAZES.few.diedPct}% and ${BLAZES.few.rodPct}%${within16 >= 3 ? `; ${within16} are within sixteen now` : ''}. ${ironSays()}`);
  parts.push(recentSays(within16));
  parts.push(` Of the ${DEATHS.deaths} deaths by a blaze or its fire the last minute's damage was ${DEATHS.fireballPct}% fireballs, ${DEATHS.firePct}% the fire they set, ${DEATHS.blowsPct}% blows from a blaze at arm's length; of the ${DEATHS.lastLanding} with a fireball landing in their last fifteen seconds, ${DEATHS.atSixAndAHalfOrLess} took it at 6.5 health or less, where one landing (its hit and four ticks of fire) ends the bot.`);
  return parts.join('');
}


// What came of each kind of answer, by the situation it was given in (note
// 645): every stance answer in a fight with blazes, in the trials of the day,
// is one of these kinds (a first pick of encounter_stance, by the class of the
// key), and the fight it was given in went on to a rod, a death, both or
// neither AFTER it, whatever was chosen next. A cell is the fights in which an
// answer of that kind was given in that situation (a fight counts once per
// cell and kind): how many, how many took a rod after it, how many died after
// it. The situation: a live blaze spawner within 16 blocks or not, the blazes
// within 16 at the answer (one or none, two or three, four or more), the
// health at the answer (over 16, 8 to 16, under 8). scripts/blaze-record.js
// --answers wrote the rows; a row is said only where at least MIN_FIGHTS
// fights are in it. They are what the bot did and how it went, chosen by Jev
// (or the fallback) for its own reasons in states these rows do not hold
// fixed: not a trial of the answer.
const CLASS_OF = {
  close_in: 'strike', charge_nearest: 'strike',
  fight: 'fight', fight_at_spawner: 'fight', fight_from_footing: 'fight', dig_in_and_fight: 'fight', break_spawner: 'fight', rail_and_fight: 'fight', dig_in_at_spawner: 'fight',
  take_cover: 'cover', back_to_wall: 'cover', out_of_sight: 'cover', corner_ambush: 'cover', box_here: 'cover', seal: 'cover', shield_guard: 'cover', dig_down: 'cover', nook: 'cover', hold_on_span: 'cover', bunker: 'cover',
  retreat: 'retreat', leave_reach: 'retreat',
  leave_and_heal: 'heal', eat: 'heal',
  keep_working: 'work',
};
const CLASS_SAYS = {
  strike: { said: 'a strike (close_in or charge_nearest: walking in on the blazes with the sword)', short: 'a strike' },
  fight: { said: 'a fight where it stands or from a stand (fight, fight_at_spawner, fight_from_footing, dig_in_and_fight, break_spawner, rail_and_fight)', short: 'a fight from a stand' },
  cover: { said: 'cover (take_cover, back_to_wall, out_of_sight, corner_ambush, box_here, seal, shield_guard, dig_down, nook)', short: 'cover' },
  retreat: { said: 'a retreat (retreat, leave_reach)', short: 'a retreat' },
  heal: { said: 'going away to heal or eating (leave_and_heal, eat)', short: 'going away to heal or eating' },
  work: { said: 'carrying on with the work (keep_working)', short: 'carrying on with the work' },
};
const MIN_FIGHTS = 5;
const BLAZES_ABOUT = n => n <= 1 ? '0-1' : n <= 3 ? '2-3' : '4+';
const HEALTH_BAND = h => h > 16 ? '>16' : h > 8 ? '8-16' : '<8';
// The keys of the cells an answer given here falls in: finest first.
const cellKeys = ({ spawner, blazes, health }) => [`${spawner ? 'spawner' : 'none'}|${BLAZES_ABOUT(blazes)}|${HEALTH_BAND(health)}`, `${spawner ? 'spawner' : 'none'}|${BLAZES_ABOUT(blazes)}|*`];
// The rows, by situation (spawner|blazes within 16|health, `*` for any
// health) and kind: [fights, took a rod after, died after]; only rows of
// MIN_FIGHTS or more (`node scripts/blaze-record.js --answers`).
const ANSWERS = {
  'none|0-1|*': { cover: [186, 27, 45], fight: [36, 2, 8], heal: [89, 13, 19], retreat: [49, 3, 8], strike: [130, 50, 27] },
  'none|0-1|8-16': { cover: [110, 17, 24], fight: [10, 0, 3], heal: [48, 8, 13], retreat: [23, 2, 3], strike: [60, 24, 12] },
  'none|0-1|<8': { cover: [58, 1, 28], fight: [7, 0, 6], heal: [27, 2, 7], retreat: [9, 0, 5], strike: [14, 5, 9] },
  'none|0-1|>16': { cover: [72, 11, 7], fight: [20, 2, 0], heal: [26, 3, 0], retreat: [21, 1, 2], strike: [77, 30, 10] },
  'none|2-3|*': { cover: [48, 9, 12], fight: [6, 0, 1], heal: [25, 5, 9], retreat: [22, 4, 5], strike: [65, 35, 13] },
  'none|2-3|8-16': { cover: [24, 6, 5], heal: [15, 5, 4], retreat: [7, 0, 3], strike: [27, 13, 6] },
  'none|2-3|<8': { cover: [10, 0, 8], heal: [8, 0, 5] },
  'none|2-3|>16': { cover: [26, 5, 4], retreat: [14, 3, 1], strike: [41, 22, 5] },
  'none|4+|*': { cover: [15, 1, 5], heal: [10, 1, 2], retreat: [11, 2, 3], strike: [5, 1, 3] },
  'none|4+|8-16': { cover: [8, 1, 2], heal: [6, 1, 0], retreat: [7, 2, 2] },
  'none|4+|>16': { cover: [5, 0, 1] },
  'spawner|0-1|*': { cover: [26, 4, 10], fight: [13, 3, 2], heal: [8, 0, 4], retreat: [19, 6, 3], strike: [51, 27, 15] },
  'spawner|0-1|8-16': { cover: [11, 1, 4], fight: [7, 2, 1], heal: [5, 0, 2], retreat: [11, 4, 0], strike: [22, 10, 5] },
  'spawner|0-1|<8': { cover: [6, 0, 4], retreat: [7, 1, 3] },
  'spawner|0-1|>16': { cover: [14, 3, 3], fight: [6, 1, 1], strike: [35, 17, 11] },
  'spawner|2-3|*': { cover: [65, 11, 31], fight: [18, 3, 7], heal: [69, 13, 26], retreat: [26, 5, 8], strike: [54, 27, 22] },
  'spawner|2-3|8-16': { cover: [30, 4, 17], fight: [10, 1, 4], heal: [43, 6, 13], retreat: [10, 1, 3], strike: [14, 3, 6] },
  'spawner|2-3|<8': { cover: [20, 2, 11], fight: [5, 0, 2], heal: [16, 0, 11] },
  'spawner|2-3|>16': { cover: [27, 6, 9], heal: [20, 7, 9], retreat: [13, 4, 2], strike: [43, 23, 17] },
  'spawner|4+|*': { cover: [167, 9, 55], fight: [24, 1, 8], heal: [116, 12, 40], retreat: [90, 3, 27], strike: [90, 26, 38] },
  'spawner|4+|8-16': { cover: [90, 5, 29], fight: [11, 0, 4], heal: [100, 11, 34], retreat: [39, 2, 11], strike: [11, 1, 5] },
  'spawner|4+|<8': { cover: [53, 0, 34], heal: [29, 0, 20], retreat: [28, 1, 11], strike: [10, 2, 10] },
  'spawner|4+|>16': { cover: [77, 5, 15], fight: [13, 1, 4], heal: [23, 2, 8], retreat: [29, 1, 8], strike: [78, 25, 31] },
};
const ANSWERS_OF = { fights: 624, from: '2026-09-28', to: '2026-09-29T11:38Z' };
// HOW below was counted on the day's fights only (note 645), not on the rows above.
const HOW_OF = { fights: 511, day: '2026-09-28' };

// What followed each way out of fire in a fight with blazes (note 661;
// scripts/blaze-record.js `--ways`, 2026-09-28T00:00Z to 2026-09-29T11:40Z, 427
// answers of body_way in the Nether with a blaze within 24 in sight and two or
// more ways offered): by the blazes within 16 at the answer (0 to 3, or 4 and
// more), [asked, died within thirty seconds, health lost in those thirty seconds
// in tenths, the mean]. A row is said only where WAYS_MIN answers are in it. With
// four or more blazes about, punching out the flame where the bot stood was
// followed by a death in 45% of 111 answers and running out of the fire in 26%
// of 97: the same question offered both. They are what followed, not what a way
// caused: the ways were chosen in states these rows do not hold alike.
const WAYS = {
  '4+': { burn_out: [11, 4, 40], out_of_fire: [97, 25, 51], put_out_flames: [111, 50, 76], rise_on_block: [13, 5, 58], strike_at_arm: [25, 13, 62] },
  '0-3': { out_of_fire: [68, 10, 57], put_out_flames: [69, 12, 58], rise_on_block: [8, 0, 91], strike_at_arm: [16, 6, 50] },
};
const WAYS_OF = { answers: 427, from: '2026-09-28', to: '2026-09-29T11:40Z' };
const WAYS_MIN = 8;
// The blazes about, as the record counts them: within 24 (a fight's) and within 16.
function blazesAbout(bot) {
  const here = bot?.entity?.position;
  if (!here) return { within24: 0, within16: 0 };
  const near = Object.values(bot.entities || {}).filter(e => e?.name === 'blaze' && e.position && e.isValid !== false).map(e => e.position.distanceTo(here));
  return { within24: near.filter(d => d <= 24).length, within16: near.filter(d => d <= 16).length };
}
// The way's row, said on the way (a sentence, or ''): only in the Nether with a
// blaze within 24, and only where the row has WAYS_MIN answers.
function waySays(bot, way) {
  if (!/nether/.test(String(bot?.game?.dimension || ''))) return '';
  const { within24, within16 } = blazesAbout(bot);
  if (!within24) return '';
  const bucket = within16 >= 4 ? '4+' : '0-3', row = WAYS[bucket]?.[way];
  if (!row || row[0] < WAYS_MIN) return '';
  return ` In the fights of ${WAYS_OF.from} to ${WAYS_OF.to}, with ${bucket === '4+' ? 'four or more blazes' : 'no more than three blazes'} within sixteen (${within16} now), after this way was chosen (${row[0]} answers): ${row[1]} died within thirty seconds (${pctOf(row[1], row[0])}%), ${row[2] / 10} health lost in those thirty seconds on average; what followed, not what the way caused: the ways were chosen in states these rows do not hold alike.`;
}

const bandOf = health => HEALTH.find(h => health > h.over) || HEALTH.at(-1);
// The row a fight begun at this health and hunger falls in, said as counts
// (note 638): the health rows and the hunger rows were counted apart, so
// there is no row for both at once, and each is what happened to bots that
// began there, not what getting to another row first would do.
function rowSays(health, food) {
  const band = bandOf(health), hungry = food < 18, h = hungry ? HUNGER.hungry : HUNGER.fed;
  return `at health ${Math.round(health * 10) / 10}: ${band.said}, ${band.fights} fights begun there, ${band.diedPct}% died, ${rodSays(band.rodPct)}; at hunger ${food}: ${hungry ? 'under 18' : '18 or more'}, ${h.fights} fights begun there, ${h.diedPct}% died, ${rodSays(h.rodPct)}`;
}


// The fights at a live blaze spawner by how many blazes were about (note 665;
// scripts/blaze-record.js `--counts`, 2026-09-28T00:00Z to 2026-09-29T11:40Z, 567
// fights). Counted by the MOST blazes within sixteen of the bot at once in the
// fight, which the bot's own stay within sixteen of the cage raised (the spawner
// tries up to four every ten to forty seconds while a player is within sixteen,
// until six are about): so a row is what a fight that got that many came to, not
// what entering with that many would do. [fights, died, brought a rod, rods, mean
// health lost].
const COUNTS = {
  from: '2026-09-28', to: '2026-09-29T11:40Z', fights: 567,
  atSpawner: { 'three or fewer': [85, 19, 45, 76, 13.7], four: [29, 15, 12, 16, 17.8], 'five or six': [85, 42, 34, 49, 23.7], 'seven or more': [130, 39, 29, 47, 18.9] },
  noSpawner: { 'none or one': [144, 19, 32, 34, 9.1], 'two or three': [75, 10, 27, 29, 11], 'four or more': [19, 6, 5, 7, 10.5] },
  // Four or more at a live spawner, by the nearest the bot came to the cage.
  byNearest: { 'within 8 blocks': [178, 74, 66, 102, 23.1], '9 to 12 blocks': [47, 16, 7, 8, 12.6], '13 to 16 blocks': [19, 6, 2, 2, 15.5] },
  // The clock of a fight at a spawner: of the fights that began with one to three
  // blazes in sight, how many reached four within sixteen and when; the first rod
  // (of the fights that reached four) and the deaths, in seconds after the start.
  // A bow with arrows, or snowballs, carried at the start of a fight: 8 of the 567 had a bow, none a snowball.
  ranged: { bow: [8, 2, 1, 1, 7.2], snowballs: 0 },
  clock: { began: 163, reached: 82, toFour: { median: 32, p90: 65 }, firstRod: { median: 16, n: 76 }, death: { p25: 32, median: 58, p75: 95 } },
};
// A box held against the open, and the lulls (note 691; the flight records of
// 2026-09-28T00:00Z to 2026-09-29T21:20Z, 952 records, a fight as fights()
// has it; "boxed" a fight in which the bot held a walled box, the step
// hold_box, at some time; by a live spawner within 16 in a decision's state
// and the health the fight began at). [fights, died, brought a rod]. Boxed
// fights are few: the rows are what they are, not a trial of the box.
// A lull: 8 seconds or more inside a fight at a spawner with no blaze in the
// bot's sight within 24.
const BOXED = { from: '2026-09-28', to: '2026-09-29T21:20Z',
  spawner: { '>16': { boxed: [15, 5, 4], open: [341, 116, 167] }, '8-16': { boxed: [3, 1, 0], open: [29, 15, 4] }, '<8': { boxed: [1, 0, 0], open: [15, 11, 2] } },
  none: { '>16': { boxed: [14, 1, 3], open: [276, 32, 82] } },
  // Minutes of fight time in the open and the health a minute it cost, by the health then.
  openPerMinute: { '>16': 17.4, '8-16': 20.6, '<8': 18.7 },
  lulls: { n: 346, medianSeconds: 14, begunFull: 115, healed: 159, boxBuilt: 11, inFightsThatDied: 122 } };
function boxedSays(health) {
  const b = BOXED, band = HEALTH_BAND(health), row = b.spawner[band];
  const r = ([n, died, rod]) => `${n} fights, ${pctOf(died, n)}% died, ${pctOf(rod, n)}% brought a rod`;
  return ` In the trials' fights at a live spawner begun at ${band === '>16' ? 'over 16' : band === '8-16' ? '8 to 16' : 'under 8'} health (${b.from} to ${b.to}): with a box held ${r(row.boxed)}; in the open ${r(row.open)}; too few boxed fights to tell them apart. In the open a minute of fight cost about ${b.openPerMinute[band]} health.`;
}
function lullsSay() {
  const l = BOXED.lulls;
  return ` In those fights ${l.n} spells of 8 seconds or more had no blaze in sight (median ${l.medianSeconds} seconds); ${l.begunFull} began at full health, health rose in ${l.healed}, and a box was built or held in ${l.boxBuilt}.`;
}
const pctN = (k, n) => `${Math.round(100 * k / n)}%`;
const countRow = ([n, died, rod, rods, lost]) => `${n} fights, ${pctN(died, n)} died, ${pctN(rod, n)} brought a rod, ${Math.round(rods / n * 10) / 10} rods a fight and ${died ? `${Math.round(rods / died * 10) / 10} rods for each death` : 'no death'}, ${lost} health lost on average`;
// The bot's stay within sixteen of a live cage, in seconds (a gap of a minute
// begins a new stay), for the clock said beside the counts.
function stayWithin(bot, cage, now = Date.now()) {
  if (!bot) return 0;
  const key = cage ? `${cage.x},${cage.y},${cage.z}` : null;
  const st = bot._spawnerStay;
  if (!key) { if (st && now - st.last > 60000) delete bot._spawnerStay; return st ? Math.round((now - st.since) / 1000) : 0; }
  if (!st || st.key !== key || now - st.last > 60000) bot._spawnerStay = { key, since: now, last: now };
  else st.last = now;
  return Math.round((now - bot._spawnerStay.since) / 1000);
}
// The facts at the entry to a fight at a spawner, in the bot's state now: the
// blazes in sight and within sixteen, how many have a line to the cell it
// stands in, the spawner's own rule and the measured rows by count, and what a
// fight that stayed at one to three got. `about` is the blaze entities in sight
// (danger.threats), `cage` the spawner's block or null. Returns { says, ...facts }.
function entryFacts(bot, { about = null, cage = null, now = Date.now() } = {}) {
  const here = bot?.entity?.position;
  const all = Object.values(bot?.entities || {}).filter(e => e?.name === 'blaze' && e.position && e.isValid !== false);
  const blazes = (about || all).filter(e => e?.position);
  const within16 = here ? Math.max(blazes.filter(e => e.position.distanceTo(here) <= 16).length, all.filter(e => e.position.distanceTo(here) <= 16).length) : 0;
  let sees = null;
  try { const T = require('./blaze-tactics'), { feetCell } = require('./terrain'); sees = here ? T.seeing(bot, blazes, feetCell(bot)).length : null; } catch (_) { sees = null; }
  const live = !!cage && !!here && cage.offset(0.5, 0.5, 0.5).distanceTo(here) <= 16;
  const away = live ? Math.round(cage.offset(0.5, 0.5, 0.5).distanceTo(here) * 10) / 10 : null;
  const stay = live ? stayWithin(bot, cage, now) : (stayWithin(bot, null, now), 0);
  const c = COUNTS, k = c.clock, at = c.atSpawner, no = c.noSpawner;
  const rows = live
    ? ` At a live spawner, by the most blazes within sixteen at once in the fight (${c.from} to ${c.to}, ${c.fights} fights with blazes): three or fewer, ${countRow(at['three or fewer'])}; four, ${countRow(at.four)}; five or six, ${countRow(at['five or six'])}; seven or more, ${countRow(at['seven or more'])}. With no spawner within sixteen: none or one, ${countRow(no['none or one'])}; two or three, ${countRow(no['two or three'])}; four or more, ${countRow(no['four or more'])}.`
      + ` Of the fights at a spawner with four or more about, by the nearest the bot came to the cage: within 8 blocks ${countRow(c.byNearest['within 8 blocks'])}; 9 to 12 blocks ${countRow(c.byNearest['9 to 12 blocks'])}; 13 to 16 blocks ${countRow(c.byNearest['13 to 16 blocks'])}.`
      + ` The clock: of the ${k.began} fights at a spawner that began with one to three blazes in sight, ${k.reached} reached four or more within sixteen, a median ${k.toFour.median} seconds after the start (nine in ten within ${k.toFour.p90}); the first rod came a median ${k.firstRod.median} seconds in (${k.firstRod.n} fights with four or more); a death at four or more came a median ${k.death.median} seconds in (a quarter within ${k.death.p25}, three quarters within ${k.death.p75}). These are the fights the bot played, chosen in states these rows do not hold alike: a row by count is what a fight that got that many came to, not what entering with that many would do.`
    : ` The spawner's rule (the server jar): while a player is within sixteen blocks of a live blaze spawner it tries up to four blazes every ten to forty seconds until six are about, and none beyond sixteen. In the fights of ${c.from} to ${c.to} at a live spawner, three or fewer at most, ${countRow(at['three or fewer'])}; four or more about (${at.four[0] + at['five or six'][0] + at['seven or more'][0]} fights), ${pctN(at.four[1] + at['five or six'][1] + at['seven or more'][1], at.four[0] + at['five or six'][0] + at['seven or more'][0])} died and ${pctN(at.four[2] + at['five or six'][2] + at['seven or more'][2], at.four[0] + at['five or six'][0] + at['seven or more'][0])} brought a rod; with no spawner within sixteen: none or one, ${countRow(no['none or one'])}; two or three, ${countRow(no['two or three'])}.`;
  // What can shoot from a distance, honestly: none is made in the Nether.
  const inv = (bot?.inventory?.items?.() || []), have = n => inv.filter(i => i.name === n).reduce((k, i) => k + i.count, 0);
  const arrows = have('arrow'), bow = have('bow') > 0, snow = have('snowball');
  const ranged = ` Ranged, carried now: ${bow ? 'a bow' : 'no bow'}, ${arrows} arrow${arrows === 1 ? '' : 's'}, ${snow} snowball${snow === 1 ? '' : 's'}. A bow is three sticks and three string; string comes from spiders (the Nether has none) and, in the Nether, only from a piglin's barter (about 4 in 100 of its rounds); a fortress's skeletons drop arrows and now and then a bow; a snowball (three damage to a blaze) is dug from snow, which the Nether has none of, and is carried in from the Overworld. In the fights of ${c.from} to ${c.to} ${c.ranged.bow[0]} of the ${c.fights} began with a bow and arrows carried (${c.ranged.bow[1]} died) and ${c.ranged.snowballs} with snowballs.`;
  const other = ' Another spawner, in this fortress or another, is the same rule: its first try is up to four blazes, ten to forty seconds after the bot is within sixteen of it.';
  const seesSays = sees == null ? '' : `, ${sees} of them with a line to the cell the bot stands in`;
  const now_ = `Blazes in sight now: ${blazes.length}${here ? `; ${within16} within sixteen blocks, in sight or not` : ''}${seesSays}.${live ? ` A live spawner is ${away} blocks off; the bot has been within sixteen of it ${stay} seconds${stay >= k.toFour.median ? `, past the median ${k.toFour.median} seconds at which a fight there had four or more about` : ''}.` : ''}`;
  return { blazesInSightNow: blazes.length, within16, withALineToTheCell: sees, spawnerBlocksAway: away, secondsWithinSixteen: stay, says: `${now_}${rows}${other}${ranged}` };
}

// How the rods came and how the deaths did, in one paragraph of counts (note
// 645; scripts/blaze-record.js --wins, --sequence). Of the fights that ended
// with a rod nearly all had a close_in or charge_nearest in them, and the
// blaze killed was a sword's reach off; most deaths never chose one.
const HOW = { rodFights: 61, struck: 56, toRodMedian: 9, toRodWithin15: 42, toRodOf: 55, seenKill: 37, seenKillQuick: 31, atSpawner: 32, noSpawner: 29, lone: 18,
  noStrike: { fights: 360, rods: 5 }, deathsNoRod: 96, deathsNoStrike: 60,
  early: { fights: 97, rodPct: 43, diedPct: 27 }, late: { fights: 54, rodPct: 26, diedPct: 37 },
  span: { fights: 101, rods: 3, diedPct: 27 }, above: { fights: 69, rods: 4 },
  sight: { keptRod: 12, keptDied: 20, brokenRod: 11, brokenDied: 21 }, noShield: { fights: 41, rods: 3, died: 9 } };

// The bot's situation now: a blaze spawner within 16 blocks (its cage, found
// as blaze-stand.js does), the blazes within 16, its health, a shield.
function situationOf(bot, { spawner } = {}) {
  const here = bot?.entity?.position;
  const blazes = here ? Object.values(bot.entities || {}).filter(e => e?.name === 'blaze' && e.position && e.isValid !== false && e.position.distanceTo(here) <= 16).length : 0;
  let near = spawner;
  if (near === undefined) {
    try { const cage = here && require('./blaze-stand').spawnerAt(bot); near = !!cage && cage.offset(0.5, 0.5, 0.5).distanceTo(here) <= 16; } catch (_) { near = false; }
  }
  return { spawner: !!near, blazes, health: bot?.health ?? 20, shield: bot?.inventory?.slots?.[45]?.name === 'shield' };
}
const situationSays = s => `${s.spawner ? 'a live blaze spawner within 16' : 'no spawner within 16'}, ${{ '0-1': 'one blaze or none', '2-3': 'two or three blazes', '4+': 'four or more blazes' }[BLAZES_ABOUT(s.blazes)]} within 16`;
// The row of a kind for a situation: the finest with the sample (health as
// well), else the one for any health, else none.
function rowOf(s, kind) {
  const [fine, wide] = cellKeys(s);
  const f = ANSWERS[fine]?.[kind], w = ANSWERS[wide]?.[kind];
  return f ? { n: f[0], rods: f[1], died: f[2], any: false } : w ? { n: w[0], rods: w[1], died: w[2], any: true } : null;
}
const answerRowSays = (row, s) => `${row.n} fights, ${row.rods} took a rod after it (${pctOf(row.rods, row.n)}%), ${row.died} died after it (${pctOf(row.died, row.n)}%)${row.any ? ` (at any health: the sample is under ${MIN_FIGHTS} at ${HEALTH_BAND(s.health) === '>16' ? 'over 16' : HEALTH_BAND(s.health) === '8-16' ? '8 to 16' : 'under 8'} health)` : ''}`;

// What was seen of the kinds of answer, in the bot's situation, one paragraph
// for the question's state: only the kinds with at least MIN_FIGHTS fights.
function answersSay(bot, opts = {}) {
  const s = situationOf(bot, opts), parts = [], left = [];
  for (const kind of Object.keys(CLASS_SAYS)) {
    const row = rowOf(s, kind);
    if (row) parts.push(`${CLASS_SAYS[kind].said}: ${answerRowSays(row, s)}`); else left.push(CLASS_SAYS[kind].short);
  }
  const h = HOW;
  const sentence = `In this situation (${situationSays(s)}, health ${Math.round(s.health * 10) / 10}), what followed each kind of answer in the fights of ${ANSWERS_OF.from} to ${ANSWERS_OF.to} (${ANSWERS_OF.fights} fights, each counted once for a kind: what came after answers given in this situation, whatever was chosen next, not what an answer caused; the answers were chosen in states these rows do not hold alike): ${parts.length ? parts.join('; ') : `no kind has ${MIN_FIGHTS} fights here`}${left.length ? `. Fewer than ${MIN_FIGHTS} fights, so not said: ${left.join(', ')}` : ''}. `
    + `How the rods came in the fights of ${HOW_OF.day} (${HOW_OF.fights} fights), of the ${h.rodFights} that ended with a rod: ${h.struck} had a strike in them, ${h.toRodWithin15} of the ${h.toRodOf} with the time within 15 seconds of the first strike (median ${h.toRodMedian}); in the ${h.seenKill} where the kill was seen the blaze was 2 to 5 blocks off and the rod picked up within two seconds in ${h.seenKillQuick}; ${h.atSpawner} were at a live spawner (with the blazes it had made about), ${h.noSpawner} with none within 16, ${h.lone} with one blaze about. Fights with no strike took a rod in ${h.noStrike.rods} of ${h.noStrike.fights}, and ${h.deathsNoStrike} of the ${h.deathsNoRod} deaths with no rod were in them. A first strike within 15 seconds of the fight's start: ${h.early.fights} fights, ${h.early.rodPct}% took a rod and ${h.early.diedPct}% died; later: ${h.late.fights} fights, ${h.late.rodPct}% and ${h.late.diedPct}%. Over a span or by a drop (${h.span.fights} fights): ${h.span.rods} rods, ${h.span.diedPct}% died; with the blazes 4 or more blocks above the bot: ${h.above.rods} rods in ${h.above.fights} fights. No difference: the blazes out of sight for 3 seconds or more at some time (${h.sight.brokenRod}% took a rod and ${h.sight.brokenDied}% died, against ${h.sight.keptRod}% and ${h.sight.keptDied}%), or iron worn (which took health off a fight but did not change who died: playedRecord)${s.shield ? '' : `; this bot carries no shield, as 41 of the ${HOW_OF.fights} fights did (${h.noShield.rods} rods, ${h.noShield.died} deaths), too few to say`}.`;
  return sentence;
}
// A kind of answer's own row, said on its option (a short sentence), or ''.
function optionSays(bot, key, opts = {}) {
  const kind = CLASS_OF[key];
  if (!kind) return '';
  const s = situationOf(bot, opts), row = rowOf(s, kind);
  return row ? ` In the fights of ${ANSWERS_OF.from} to ${ANSWERS_OF.to} after an answer of this kind (${CLASS_SAYS[kind].short}) in a situation like this (${situationSays(s)}): ${answerRowSays(row, s)}.` : '';
}

module.exports = { BOXED, boxedSays, lullsSay, COUNTS, countRow, stayWithin, entryFacts, WAYS, WAYS_OF, WAYS_MIN, waySays, blazesAbout, RECENT, IRON_LOST, ironSays, recentSays, situationOf, answersSay, optionSays, rowOf, HOW, CLASS_OF, CLASS_SAYS, MIN_FIGHTS, ANSWERS, ANSWERS_OF, BLAZES_ABOUT, HEALTH_BAND, cellKeys, DAY, ALL, HEALTH, HUNGER, BLAZES, IRON, DEATHS, says, bandOf, rowSays };
