'use strict';
// What fights with blazes came to when the bot played them (note 631): the
// flight records of the trials of 2026-09-28, to 19:50Z, read by
// scripts/blaze-record.js (`--to 2026-09-28T19:50:00Z`, and `--landings`,
// `--deaths` for the fire's ticks and the deaths). The arena's rows say what
// a stand did in a drill; this says what the bot's fights did in the
// fortresses, by the health and the hunger it began them at: 415 fights, and
// the ones begun hurt were mostly lost. A fight: a run of blazes in sight
// within 24 blocks, or hurting the bot, a gap of 30 seconds ending it.
const DAY = '2026-09-28';
const ALL = { fights: 415, died: 79, diedPct: 19, rodFights: 42, rodPct: 10, rods: 54 };
const HEALTH = [
  { over: 16, said: 'over 16 health', fights: 307, diedPct: 14, rodPct: 12 },
  { over: 8, said: '8 to 16 health', fights: 82, diedPct: 24, rodPct: 6 },
  { over: -1, said: 'under 8 health', fights: 26, diedPct: 58, rodPct: 0 },
];
const HUNGER = { fed: { fights: 255, diedPct: 16, rodPct: 13 }, hungry: { fights: 160, diedPct: 24, rodPct: 6 } };
const BLAZES = { few: { fights: 141, diedPct: 13, rodPct: 11 }, spawner: { fights: 198, diedPct: 21, rodPct: 9 } };
const IRON = { four: { fights: 88, diedPct: 18 }, some: { fights: 289, diedPct: 20 } };
// The deaths by a blaze or its fire (70): where the last minute's damage
// went, and how many took their last landing at 6.5 health or less (48 of
// the 63 with one in their last fifteen seconds), where one landing ends it.
const DEATHS = { deaths: 70, fireballPct: 49, firePct: 40, blowsPct: 7, otherPct: 4, lastLanding: 63, atSixAndAHalfOrLess: 48 };

const rodSays = pct => pct === 0 ? 'none brought a rod' : `${pct}% brought a rod`;
// The record said with the row the bot is in: its health, its hunger, and
// how many blazes are about it (three within sixteen blocks is a spawner's).
function says(bot, { day = DAY } = {}) {
  const health = bot?.health ?? 20, food = bot?.food ?? 20;
  const here = bot?.entity?.position;
  const within16 = here ? Object.values(bot.entities || {}).filter(e => e?.name === 'blaze' && e.position && e.isValid !== false && e.position.distanceTo(here) <= 16).length : 0;
  const band = HEALTH.find(h => health > h.over) || HEALTH.at(-1);
  const parts = [`In the trials of ${day}, ${ALL.fights} fights with blazes (a run of blazes in sight, or hurting the bot, ending after thirty seconds without): ${ALL.diedPct}% ended in the bot's death and ${ALL.rodPct}% in a blaze rod (${ALL.rods} rods, ${ALL.died} deaths).`];
  parts.push(` Begun at the health this bot has, ${Math.round(health * 10) / 10}, the row is ${band.said}: ${band.fights} fights, ${band.diedPct}% died, ${rodSays(band.rodPct)}; the other rows, over 16 health ${HEALTH[0].diedPct}% died and ${HEALTH[0].rodPct}% brought a rod, 8 to 16 ${HEALTH[1].diedPct}% and ${HEALTH[1].rodPct}%, under 8 ${HEALTH[2].diedPct}% and none.`);
  if (food < 18) parts.push(` With hunger under 18, as here (${food}), where health does not come back: ${HUNGER.hungry.fights} fights, ${HUNGER.hungry.diedPct}% died and ${HUNGER.hungry.rodPct}% brought a rod, against ${HUNGER.fed.diedPct}% and ${HUNGER.fed.rodPct}% at 18 or more.`);
  parts.push(` By the blazes about at most: with three or more within sixteen blocks (a spawner's) ${BLAZES.spawner.fights} fights, ${BLAZES.spawner.diedPct}% died and ${BLAZES.spawner.rodPct}% brought a rod; with one or none ${BLAZES.few.fights} fights, ${BLAZES.few.diedPct}% and ${BLAZES.few.rodPct}%${within16 >= 3 ? `; ${within16} are within sixteen now` : ''}. Iron armour made no difference: four pieces ${IRON.four.diedPct}% died, two or three ${IRON.some.diedPct}%.`);
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
  'none|0-1|*': { cover: [210, 15, 39], fight: [35, 1, 8], heal: [55, 7, 10], retreat: [70, 2, 17], strike: [63, 24, 13] },
  'none|0-1|8-16': { cover: [138, 11, 24], fight: [15, 0, 4], heal: [37, 5, 8], retreat: [32, 1, 6], strike: [34, 13, 9] },
  'none|0-1|<8': { cover: [63, 0, 25], fight: [6, 0, 5], heal: [9, 0, 2], retreat: [16, 0, 10], strike: [7, 0, 3] },
  'none|0-1|>16': { cover: [81, 5, 9], fight: [15, 1, 0], heal: [12, 2, 0], retreat: [30, 1, 6], strike: [34, 15, 4] },
  'none|2-3|*': { cover: [71, 6, 13], fight: [7, 0, 1], heal: [22, 3, 8], retreat: [22, 1, 4], strike: [18, 10, 3] },
  'none|2-3|8-16': { cover: [42, 4, 4], heal: [16, 3, 5], retreat: [8, 0, 3], strike: [7, 5, 1] },
  'none|2-3|<8': { cover: [15, 0, 8] },
  'none|2-3|>16': { cover: [36, 3, 6], retreat: [14, 1, 1], strike: [11, 5, 2] },
  'none|4+|*': { cover: [18, 0, 3], retreat: [5, 0, 0] },
  'none|4+|8-16': { cover: [8, 0, 1] },
  'none|4+|>16': { cover: [8, 0, 0] },
  'spawner|0-1|*': { cover: [21, 2, 9], fight: [6, 2, 4], heal: [9, 0, 5], retreat: [12, 1, 3], strike: [20, 5, 11] },
  'spawner|0-1|8-16': { cover: [13, 2, 4], fight: [5, 2, 3], heal: [7, 0, 4], retreat: [9, 1, 1], strike: [10, 2, 4] },
  'spawner|0-1|<8': { cover: [6, 1, 5] },
  'spawner|0-1|>16': { cover: [5, 0, 1], strike: [9, 2, 5] },
  'spawner|2-3|*': { cover: [65, 5, 20], fight: [12, 1, 4], heal: [26, 3, 6], retreat: [34, 3, 11], strike: [22, 10, 10] },
  'spawner|2-3|8-16': { cover: [33, 2, 7], fight: [5, 0, 1], heal: [18, 1, 4], retreat: [13, 1, 4], strike: [10, 3, 5] },
  'spawner|2-3|<8': { cover: [15, 1, 8], retreat: [5, 0, 5] },
  'spawner|2-3|>16': { cover: [33, 3, 8], fight: [5, 1, 2], heal: [7, 2, 1], retreat: [18, 2, 4], strike: [13, 7, 5] },
  'spawner|4+|*': { cover: [137, 2, 26], fight: [35, 0, 9], heal: [55, 2, 17], retreat: [61, 1, 17], strike: [29, 8, 8] },
  'spawner|4+|8-16': { cover: [77, 2, 15], fight: [16, 0, 5], heal: [45, 2, 12], retreat: [29, 1, 7], strike: [12, 2, 6] },
  'spawner|4+|<8': { cover: [28, 0, 15], heal: [12, 0, 10], retreat: [7, 0, 3] },
  'spawner|4+|>16': { cover: [75, 2, 11], fight: [17, 0, 3], heal: [14, 0, 4], retreat: [28, 0, 8], strike: [19, 6, 3] },
};
const ANSWERS_OF = { fights: 511, to: '2026-09-28T23:59Z' };

const bandOf = health => HEALTH.find(h => health > h.over) || HEALTH.at(-1);
// The row a fight begun at this health and hunger falls in, said as counts
// (note 638): the health rows and the hunger rows were counted apart, so
// there is no row for both at once, and each is what happened to bots that
// began there, not what getting to another row first would do.
function rowSays(health, food) {
  const band = bandOf(health), hungry = food < 18, h = hungry ? HUNGER.hungry : HUNGER.fed;
  return `at health ${Math.round(health * 10) / 10}: ${band.said}, ${band.fights} fights begun there, ${band.diedPct}% died, ${rodSays(band.rodPct)}; at hunger ${food}: ${hungry ? 'under 18' : '18 or more'}, ${h.fights} fights begun there, ${h.diedPct}% died, ${rodSays(h.rodPct)}`;
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
const pctOf = (k, n) => Math.round(100 * k / n);

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
  const sentence = `In this situation (${situationSays(s)}, health ${Math.round(s.health * 10) / 10}), what followed each kind of answer in the fights of ${DAY} to ${ANSWERS_OF.to} (${ANSWERS_OF.fights} fights, each counted once for a kind: what came after answers given in this situation, whatever was chosen next, not what an answer caused; the answers were chosen in states these rows do not hold alike): ${parts.length ? parts.join('; ') : `no kind has ${MIN_FIGHTS} fights here`}${left.length ? `. Fewer than ${MIN_FIGHTS} fights, so not said: ${left.join(', ')}` : ''}. `
    + `How the rods came, of the ${h.rodFights} fights that ended with a rod: ${h.struck} had a strike in them, ${h.toRodWithin15} of the ${h.toRodOf} with the time within 15 seconds of the first strike (median ${h.toRodMedian}); in the ${h.seenKill} where the kill was seen the blaze was 2 to 5 blocks off and the rod picked up within two seconds in ${h.seenKillQuick}; ${h.atSpawner} were at a live spawner (with the blazes it had made about), ${h.noSpawner} with none within 16, ${h.lone} with one blaze about. Fights with no strike took a rod in ${h.noStrike.rods} of ${h.noStrike.fights}, and ${h.deathsNoStrike} of the ${h.deathsNoRod} deaths with no rod were in them. A first strike within 15 seconds of the fight's start: ${h.early.fights} fights, ${h.early.rodPct}% took a rod and ${h.early.diedPct}% died; later: ${h.late.fights} fights, ${h.late.rodPct}% and ${h.late.diedPct}%. Over a span or by a drop (${h.span.fights} fights): ${h.span.rods} rods, ${h.span.diedPct}% died; with the blazes 4 or more blocks above the bot: ${h.above.rods} rods in ${h.above.fights} fights. No difference: the blazes out of sight for 3 seconds or more at some time (${h.sight.brokenRod}% took a rod and ${h.sight.brokenDied}% died, against ${h.sight.keptRod}% and ${h.sight.keptDied}%), or iron worn (playedRecord)${s.shield ? '' : `; this bot carries no shield, as 41 of the ${ANSWERS_OF.fights} fights did (${h.noShield.rods} rods, ${h.noShield.died} deaths), too few to say`}.`;
  return sentence;
}
// A kind of answer's own row, said on its option (a short sentence), or ''.
function optionSays(bot, key, opts = {}) {
  const kind = CLASS_OF[key];
  if (!kind) return '';
  const s = situationOf(bot, opts), row = rowOf(s, kind);
  return row ? ` In the fights of ${DAY} after an answer of this kind (${CLASS_SAYS[kind].short}) in a situation like this (${situationSays(s)}): ${answerRowSays(row, s)}.` : '';
}

module.exports = { situationOf, answersSay, optionSays, rowOf, HOW, CLASS_OF, CLASS_SAYS, MIN_FIGHTS, ANSWERS, ANSWERS_OF, BLAZES_ABOUT, HEALTH_BAND, cellKeys, DAY, ALL, HEALTH, HUNGER, BLAZES, IRON, DEATHS, says, bandOf, rowSays };
