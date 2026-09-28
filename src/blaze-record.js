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

module.exports = { DAY, ALL, HEALTH, HUNGER, BLAZES, IRON, DEATHS, says };
