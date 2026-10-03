'use strict';
// Food before the fortress, said as facts with their numbers (note 664).
//
// The overnight deaths (note 661 to 663): 68 of 115 at hunger under 18, 36 with
// no food carried. Health does not come back in the Nether below hunger 18, and
// the fortress questions said hunger and food carried but never what they buy:
// how many minutes of fighting the food covers, what fights begun with nothing
// to eat came to, or which ways to more food there are from where the bot
// stands and what each costs. Here they are, once, for every question that
// stands at the fortress or at the portal to say. Nothing here gates an answer:
// each is a fact or a priced way, and the choice is Jev's.
//
// The record is scripts/food-audit.js over the flight records of
// 2026-09-28T00:00Z to 2026-09-29T11:40Z (567 blaze fights, 185 Nether hours,
// 168 crossings from the Overworld).
const RECORD = {
  window: '2026-09-28 to 2026-09-29T11:40Z',
  fights: 567,
  // Fights by the food points carried when they began, and by hunger band.
  byCarried: { none: { fights: 114, diedPct: 42, rodPct: 15 }, few: { fights: 61, diedPct: 21, rodPct: 21 }, some: { fights: 82, diedPct: 24, rodPct: 22 }, many: { fights: 310, diedPct: 22, rodPct: 44 } },
  // The cell that stands apart: hunger under 18 and nothing to eat. With food
  // carried and hunger under 18, 45 fights, 4 deaths (the bot ate first).
  hungryNothing: { fights: 92, diedPct: 47, rodPct: 12 },
  fedNothing: { fights: 22, diedPct: 23, rodPct: 27 },
  hungryWithFood: { fights: 45, died: 4 },
  fedWithFood: { fights: 408, diedPct: 24, rodPct: 40 },
  // Hunger spent: 369 fights over twenty seconds, 433 minutes, 394 hunger points lost.
  hungerPerFightMinute: 0.9,
  fightMinutes: { median: 0.6, p75: 1.1, p90: 2 },
  beganFedEndedUnder18Pct: 37,
  // A whole stay: 185 Nether hours, the food bar lost 22.8 a hour and the
  // bot ate 33 points of food an hour (a bar point lost is more than a point of food:
  // eating past 20 wastes the rest, and saturation is spent first).
  hungerLostPerHour: 22.8, pointsEatenPerHour: 33,
  // At the crossing: 168 crossings from the Overworld.
  crossings: { n: 168, none: 42, few: 36, some: 44, many: 46, hungerUnder18: 50, medianPoints: 9, shortOfStay: 122 },
  // Where carried food went over the window: eaten, lost with a death, gone
  // some other way (cooked and raw meat dropped, stored, or out of the record's sight).
  wentEaten: 6254, wentDeath: 6216, wentOther: 6608, deaths: 150,
};

const round = n => Math.round(n * 10) / 10;
const words = s => String(s).replaceAll('_', ' ');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const inNether = bot => /nether/.test(String(bot?.game?.dimension || ''));
const registry = bot => bot?.registry || require('minecraft-data')('26.1');

// The food carried, from healing.js's list (safe food only), by points; raw
// meat with what cooking would make of it.
function carried(bot) {
  let list = []; try { list = require('./healing').foodCarried(bot); } catch (_) { list = []; }
  const points = list.reduce((n, f) => n + f.count * f.points, 0);
  let raw = 0, cookedGain = 0;
  try {
    const { foodStock } = require('./nether-food');
    const s = foodStock(bot);
    raw = s.raw.reduce((n, m) => n + m.n, 0); cookedGain = s.cookedGain;
  } catch (_) { /* none */ }
  return { list, points, items: list.reduce((n, f) => n + f.count, 0), raw, cookedGain };
}

// Whether health comes back and what changes that, in the bot's own numbers.
function regenSays(bot) {
  const hunger = bot.food ?? 20, health = bot.health ?? 20;
  const { points } = carried(bot);
  const eatenTo = Math.min(20, hunger + points);
  const rule = 'Natural health comes back only at hunger 18 or more (a point each four seconds, faster at 20 while saturation lasts) and not at all below 18; at hunger 6 or less the bot cannot sprint, and at 0 starvation takes health';
  const now = hunger >= 18 ? `hunger ${hunger}: health ${health >= 20 ? 'is full' : 'comes back now'}` : `hunger ${hunger}: no health comes back${points ? `; eating all that is carried brings hunger to ${eatenTo}${eatenTo >= 18 ? ', which turns it on' : ', still under 18, so it stays off'}` : ' and nothing carried is food'}`;
  return `${rule}. Now ${now}.`;
}

// How long hunger holds at 18 or more in a fight, at the measured spend.
function clock(bot) {
  const hunger = bot.food ?? 20, { points } = carried(bot);
  const rate = RECORD.hungerPerFightMinute;
  const noEating = hunger >= 18 ? round(Math.max(0.1, (hunger - 17) / rate)) : 0;
  const withFood = hunger >= 18 || points ? round(Math.max(0, Math.min(20, hunger) - 17 + points) / rate) : 0;
  return { rate, noEating, withFood, points, hunger };
}
function clockSays(bot) {
  const c = clock(bot);
  const p = RECORD.fightMinutes;
  const fights = `A blaze fight in the record lasted ${p.median} minutes at the median, ${p.p75} at three in four, ${p.p90} at nine in ten, and a visit is several fights; hunger fell ${c.rate} a minute of fighting (${RECORD.fights} fights, ${RECORD.window}) and ${RECORD.beganFedEndedUnder18Pct}% of the fights begun at 18 or more ended under 18`;
  if (c.hunger < 18) return `${fights}. Hunger is already ${c.hunger}, under 18: nothing here heals until it is eaten back up${c.points ? ` (${c.points} points carried)` : ''}.`;
  return `${fights}. From hunger ${c.hunger} it is under 18 in about ${c.noEating} minutes of fighting with no eating${c.points ? `, and at most about ${c.withFood} minutes if all ${c.points} carried points are eaten as it falls (the bar caps at 20, so this is an upper bound)` : ' and nothing is carried to eat'}.`;
}

// The Nether's deaths by the food carried at the time (note 1037): every
// flight frame in the Nether on 2026-10-03 (00:00Z to 10:00Z, 69 bot-hours)
// by the food points in the pack then: [hours, deaths, share of that time at
// 8 health or under]. With none carried, 6.1 deaths an hour against 0.8 with
// forty points or more; 21 of 80 deaths came in the 4.6 hours under twelve
// points. The fights' rows below say how fights begun with food went; none
// said what an hour in the Nether costs by the food in the pack.
const BY_FOOD = { from: '2026-10-03 00:00Z', to: '10:00Z', rows: [['none', 0, 2.1, 13, 17], ['1 to 11 points', 1, 2.5, 8, 2], ['12 to 39 points', 12, 9.0, 12, 1], ['40 points or more', 40, 55.6, 47, 1]] };
function byFoodSays(bot) {
  const { points } = carried(bot);
  const mine = [...BY_FOOD.rows].reverse().find(r => points >= r[1]);
  const rate = r => Math.round(r[3] / r[2] * 10) / 10;
  return ` In the Nether by the food carried at the time (the trials of ${BY_FOOD.from} to ${BY_FOOD.to}): ${BY_FOOD.rows.map(r => `${r[0]}, ${rate(r)} deaths an hour over ${r[2]} hours${r[4] >= 5 ? ` (${r[4]}% of that time at 8 health or under)` : ''}`).join('; ')}. ${points} points are carried now: the row "${mine[0]}".`;
}

// What fights began with, by the food carried at their start: the row the bot is in.
function recordSays(bot) {
  const { points } = carried(bot), hunger = bot.food ?? 20;
  const R = RECORD, b = R.byCarried;
  const row = points === 0 ? (hunger < 18 ? `hunger under 18 and nothing to eat carried, the bot's own row: ${R.hungryNothing.fights} fights, ${R.hungryNothing.diedPct}% died, ${R.hungryNothing.rodPct}% brought a rod` : `nothing to eat carried at hunger 18 or more, the bot's own row: ${R.fedNothing.fights} fights, ${R.fedNothing.diedPct}% died, ${R.fedNothing.rodPct}% brought a rod`)
    : `${points} points carried, the bot's own row is ${points < 8 ? `1 to 7 points: ${b.few.fights} fights, ${b.few.diedPct}% died, ${b.few.rodPct}% brought a rod` : points < 24 ? `8 to 23 points: ${b.some.fights} fights, ${b.some.diedPct}% died, ${b.some.rodPct}% brought a rod` : `24 points or more: ${b.many.fights} fights, ${b.many.diedPct}% died, ${b.many.rodPct}% brought a rod`}`;
  return `What fights begun with food to hand came to (${R.window}, the played record, not a forecast): ${row}. For comparison, with food carried and hunger under 18 ${R.hungryWithFood.fights} fights ended in ${R.hungryWithFood.died} deaths (the bot ate first), and every fight begun at 18 or more with food carried, ${R.fedWithFood.fights}, ${R.fedWithFood.diedPct}% died and ${R.fedWithFood.rodPct}% brought a rod. The record is of fights, not of carrying food; a bot that had food may differ in other ways.${byFoodSays(bot)}`;
}

// The Overworld's food, each way priced. Pigs and chickens are never hurt by this
// bot (protected), so its meat is cows, sheep and rabbits, fish, and crops.
function overworldWays(bot) {
  const f = registry(bot).foodsByName;
  const p = n => f[n]?.foodPoints;
  return `In the Overworld, food comes from cows (1 to 3 raw beef, ${p('beef')} each, ${p('cooked_beef')} cooked), sheep (1 to 2 raw mutton, ${p('mutton')} each, ${p('cooked_mutton')} cooked), rabbits (0 to 1 raw rabbit, ${p('rabbit')}, ${p('cooked_rabbit')} cooked), fish (cod ${p('cod')}, ${p('cooked_cod')} cooked; salmon ${p('salmon')}, ${p('cooked_salmon')} cooked) and crops (bread ${p('bread')}, baked potato ${p('baked_potato')}, carrot ${p('carrot')}); this bot never hurts pigs or chickens, so those are not on the list. Raw meat is eaten as it is or cooked at a furnace (about ten seconds an item, coal or charcoal burns eight items each); cooking makes a beef ${p('cooked_beef') - p('beef')} points more.`;
}

// What each way to food costs from here. `nether`: in the Nether; `trip`: the
// portal trip's text; `hoglin`: a hoglin known.
function waysSays(bot, goal, { trip = '' } = {}) {
  const nether = inNether(bot);
  const parts = [];
  if (nether) {
    parts.push(`In the Nether: a hoglin drops 2 to 4 raw porkchops (${registry(bot).foodsByName.porkchop.foodPoints} each raw, ${registry(bot).foodsByName.cooked_porkchop.foodPoints} cooked) but has forty health and hits for three to eight, and none of this bot's 66 hunts of one on 2026-09-28 brought meat (most ended at the sighting); mushroom stew is 6 a bowl where a red and a brown mushroom stand; a bastion's chests hold some food and piglins guard them; a fortress's chests hold none. Piglin barter gives no food at all (none of its 19 items is one), so gold buys no meal here`);
    parts.push(`Back through the portal is the Overworld's food${trip ? `: ${trip}` : ''}`);
  }
  parts.push(overworldWays(bot));
  return parts.join('. ').replace(/\.\./g, '.') + (parts.at(-1).endsWith('.') ? '' : '.');
}

// The whole statement, for a question's state: hunger and regen state, what
// is carried and what it covers, the record, and the ways.
function beforeSays(bot, goal, { trip = '' } = {}) {
  const c = carried(bot);
  let stay = null; try { stay = require('./nether-food').stayFacts(bot); } catch (_) { stay = null; }
  const list = c.list.length ? c.list.map(x => x.says).join('; ') : 'nothing to eat';
  return {
    hunger: bot.food ?? 20, health: round(bot.health ?? 20),
    foodCarried: `${c.points} hunger points (${list})${c.raw && c.cookedGain ? `; the ${c.raw} raw meat carried would be ${c.cookedGain} points more cooked` : ''}`,
    healthRegen: regenSays(bot),
    minutesOfFighting: clockSays(bot),
    ...(stay ? { theStay: `${stay.carried} points carried would last about ${stay.lasts} minutes of the Nether at ${require('./nether-food').HUNGER_AN_HOUR} an hour; the goal still wants about ${stay.minutes} minutes (${stay.short ? `${stay.short} points short` : 'not short'}); measured over the window: the bar fell ${RECORD.hungerLostPerHour} a hour and ${RECORD.pointsEatenPerHour} points of food were eaten a hour` } : {}),
    playedRecord: recordSays(bot),
    ways: waysSays(bot, goal, { trip }),
  };
}

// The way home, priced for a question whose bot stands in the Nether.
function tripSays(bot, goal) {
  try { return require('./game-progress').portalTrip(bot, goal).trim(); } catch (_) { return 'the way back to a portal is not known'; }
}

module.exports = { BY_FOOD, byFoodSays, RECORD, carried, regenSays, clock, clockSays, recordSays, overworldWays, waysSays, beforeSays, tripSays };
