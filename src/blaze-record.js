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

// The newest trials (note 712; scripts/blaze-record.js `--recent --from
// 2026-09-29T21:00:00Z --to 2026-09-30T01:50:00Z` wrote the rows): 156 fights
// after the deploys since 21:00Z (the rod stash of note 704, the spawner holds
// of notes 691/700/702, the low-health rules of note 701, angry piglin
// tracking of note 703), superseding note 661's rows above (that window's
// spawner fights died 49% and took a rod 45%; these, 20% and 18%: the deaths
// at a live spawner fell by more than half). `rods` are the rods gained in
// those fights, `lost` the mean health lost.
const RECENT = { from: '2026-09-29T21:00Z', to: '2026-09-30T01:50Z', fights: 156,
  spawner: { fights: 104, died: 21, rod: 19, rods: 33, lost: 14 },
  elsewhere: { fights: 52, died: 11, rod: 17, rods: 22, lost: 6.6 },
  few: { fights: 17, died: 3, rod: 4 }, some: { fights: 29, died: 7, rod: 13 } };
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
// Split at note 712 from the old single 'strike' class: charge_nearest and
// close_in are counted apart (charge kept the lowest deaths, close_in the
// most rods a minute, in the fights since the rod-stash and low-health
// deploys of 2026-09-29T21:00Z); box_here, box_at_spawner, fight_at_spawner
// and break_spawner (a stand held at the cage) are their own class, as is a
// hole (dig_in_and_fight, dig_in_at_spawner), so a stand at the cage and a
// hole are not folded into 'fight' or 'cover' any more.
const CLASS_OF = {
  close_in: 'close_in', charge_nearest: 'charge',
  fight: 'fight', fight_from_footing: 'fight', rail_and_fight: 'fight',
  box_here: 'box_stand', box_at_spawner: 'box_stand', fight_at_spawner: 'box_stand', break_spawner: 'box_stand',
  dig_in_and_fight: 'hole', dig_in_at_spawner: 'hole',
  take_cover: 'cover', back_to_wall: 'cover', out_of_sight: 'cover', corner_ambush: 'cover', seal: 'cover', shield_guard: 'cover', dig_down: 'cover', nook: 'cover', hold_on_span: 'cover', bunker: 'cover',
  retreat: 'retreat', leave_reach: 'retreat',
  leave_and_heal: 'heal', eat: 'heal',
  keep_working: 'work',
};
const CLASS_SAYS = {
  charge: { said: 'a charge (charge_nearest: running straight at the nearest blaze)', short: 'a charge' },
  close_in: { said: 'closing in (close_in: walking in on the blazes with the sword, picking a target)', short: 'closing in' },
  fight: { said: 'a fight where it stands or from a stand (fight, fight_from_footing, rail_and_fight)', short: 'a fight from a stand' },
  box_stand: { said: 'a stand at the cage (box_here, box_at_spawner, fight_at_spawner, break_spawner)', short: 'a stand at the cage' },
  hole: { said: 'a hole (dig_in_and_fight, dig_in_at_spawner: dug into the rock beside the cage)', short: 'a hole' },
  cover: { said: 'cover (take_cover, back_to_wall, out_of_sight, corner_ambush, seal, shield_guard, dig_down, nook)', short: 'cover' },
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
  'none|0-1|*': { charge: [6, 1, 0], close_in: [18, 7, 3], cover: [20, 1, 6], heal: [9, 0, 2] },
  'none|0-1|8-16': { close_in: [5, 1, 2] },
  'none|0-1|>16': { close_in: [15, 6, 2], cover: [16, 1, 4] },
  'none|2-3|*': { charge: [14, 7, 4], close_in: [5, 1, 3], cover: [9, 1, 4] },
  'none|2-3|>16': { charge: [12, 5, 2], cover: [8, 1, 3] },
  'none|4+|*': { heal: [6, 0, 4] },
  'spawner|0-1|*': { close_in: [9, 4, 4] },
  'spawner|0-1|>16': { close_in: [9, 4, 4] },
  'spawner|2-3|*': { charge: [8, 1, 5], cover: [11, 2, 6], heal: [9, 1, 2], retreat: [8, 3, 4] },
  'spawner|2-3|8-16': { cover: [6, 1, 2], heal: [8, 1, 2] },
  'spawner|2-3|<8': { cover: [5, 0, 4] },
  'spawner|2-3|>16': { charge: [8, 1, 5], retreat: [6, 3, 2] },
  'spawner|4+|*': { box_stand: [32, 1, 6], charge: [32, 3, 7], cover: [87, 3, 16], fight: [5, 0, 1], heal: [47, 4, 11], retreat: [16, 1, 7] },
  'spawner|4+|8-16': { box_stand: [8, 0, 3], cover: [30, 0, 9], heal: [38, 3, 10], retreat: [6, 0, 4] },
  'spawner|4+|<8': { box_stand: [5, 1, 2], cover: [8, 0, 4], heal: [9, 0, 1] },
  'spawner|4+|>16': { box_stand: [24, 0, 5], charge: [32, 3, 7], cover: [70, 3, 12], heal: [15, 1, 6], retreat: [8, 1, 2] },
};
// note 712: superseding the ANSWERS above (2026-09-28 to 2026-09-29T11:38Z,
// 624 fights, the old single 'strike' class), from the 156 fights of
// 2026-09-29T21:00Z to 2026-09-30T01:50Z, after the deploys since 21:00Z;
// 'strike' is now 'charge' and 'close_in' apart, and 'box_stand' (a held
// stand at the cage: box_here, box_at_spawner, fight_at_spawner,
// break_spawner) and 'hole' (dig_in_and_fight, dig_in_at_spawner) are their
// own class rather than folded into 'fight' or 'cover'; 'hole' has no row
// here because it was never chosen at MIN_FIGHTS or more (once, in the whole
// window: note 712). At a live spawner with four or more blazes within
// sixteen (the busiest cell, chosen 87, 32 and 32 times): box_stand was
// chosen almost as often as charge (32 times) but brought a rod after it
// only 3% of the time (1 of 32) against charge's 9% (3 of 32) and cover's 3%
// (3 of 87), and it died after just as often as the others (6 of 32, 19%,
// against charge's 7 of 32 and cover's 16 of 87): it is not safer and not
// more productive, just chosen as if it were a real option.
const ANSWERS_OF = { fights: 156, from: '2026-09-29T21:00Z', to: '2026-09-30T01:50Z' };
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


// The fights at a live blaze spawner by how many blazes were about (note 712;
// scripts/blaze-record.js `--counts`, 2026-09-29T21:00Z to 2026-09-30T01:50Z,
// 156 fights after the deploys since 21:00Z, superseding note 665's rows
// above). Counted by the MOST blazes within sixteen of the bot at once in the
// fight, which the bot's own stay within sixteen of the cage raised (the spawner
// tries up to four every ten to forty seconds while a player is within sixteen,
// until six are about): so a row is what a fight that got that many came to, not
// what entering with that many would do. [fights, died, brought a rod, rods, mean
// health lost]. Deaths at seven or more fell from 30% to 17%.
const COUNTS = {
  from: '2026-09-29T21:00Z', to: '2026-09-30T01:50Z', fights: 156,
  atSpawner: { 'three or fewer': [11, 4, 7, 10, 6.8], four: [8, 2, 3, 5, 12.6], 'five or six': [24, 7, 7, 13, 14.3], 'seven or more': [72, 12, 9, 15, 14] },
  noSpawner: { 'none or one': [16, 2, 4, 4, 3.1], 'two or three': [19, 4, 6, 8, 6.8], 'four or more': [6, 1, 0, 0, 15.1] },
  // Four or more at a live spawner, by the nearest the bot came to the cage.
  byNearest: { 'within 8 blocks': [81, 17, 18, 32, 15.2], '9 to 12 blocks': [18, 4, 1, 1, 11.8], '13 to 16 blocks': [5, 0, 0, 0, 1.6] },
  // The clock of a fight at a spawner: of the fights that began with one to three
  // blazes in sight, how many reached four within sixteen and when; the first rod
  // (of the fights that reached four) and the deaths, in seconds after the start.
  // A bow with arrows carried at the start of a fight: 10 of the 156 had one, none a snowball.
  ranged: { bow: [10, 2, 0, 0, 8.1], snowballs: 0 },
  clock: { began: 27, reached: 17, toFour: { median: 40, p90: 90 }, firstRod: { median: 28, n: 19 }, death: { p25: 80, median: 107, p75: 188 } },
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
