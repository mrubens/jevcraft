'use strict';
// A food errand said as what it is, and what it has come to (note 702).
//
// 25595 (mid-242-mb, 2026-09-29 23:41 to 23:49Z) was asked survival_priority
// 38 times at hunger 17 to 20 with 64 to 79 food points carried against the
// 80 kept for the Nether, and 15 beef and 14 mutton raw in the pack. The
// option said only "Obtain safe food to restore hunger and maintain a
// reserve for healing and the coming night"; it went home for food, was
// pulled off by mobs, was asked again, and chatted "I'm hungry" at hunger
// 20. The reserve rose by a hunt and fell by what the healing ate: 76 at
// 23:41, 75 at 23:49.
//
// Here: the words (hunger, points carried, what the reserve is for and wants,
// what cooking the raw adds), and the errand's yield (note 699's rule for a
// walk): a stock-up that has kept nothing in three minutes rests, said.

const NO_YIELD_MS = 3 * 60000;   // note 699: a walk three minutes with nothing gained ends
const GAP_MS = 10 * 60000;       // asked again after this long, it is a new errand
const REST_MS = 20 * 60000;      // the stock search's own rest (survival.js)
const EPS = 0.5;
const HEALS_AT = 18;             // the game's own: health comes back at hunger eighteen or more
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const minutes = ms => Math.max(1, Math.round(ms / 60000));

// What the reserve is for, by what asked for it.
function reserveFor(goal) {
  if (goal?.preparingEnd) return 'the End';
  if (goal?.preparingNether) return 'the Nether stay (about 40 hunger an hour there, and health comes back only at hunger 18 or more)';
  if (goal?.preparingExpedition) return 'the trip';
  return 'healing and the night';
}

// Whether what is carried fills the hunger bar: then low hunger is met by
// eating, and a search tops up the reserve.
function fillsHunger(bot, supply) {
  const hunger = bot?.food ?? 20;
  return hunger >= 20 || supply >= 20 - hunger;
}

// Met (note 761): hunger back at eighteen or more, where health comes back,
// with safe food carried to eat when it falls. The survival layer's food
// errand ends there rather than being asked again for the reserve: 25588
// (mid-241-ce, 17:16:26Z) was back at hunger 18 with a beef carried and was
// still sent after a cow; 25592 went back and forth between cooking and the
// walk home at hunger 19 with 10 points carried. Of 2,188 obtain_food wins
// in the flight records from 2026-09-30T06:00Z to 17:30Z, 1,269 were at
// hunger 18 or more with food carried (scripts/food-errands.js). The reserve for a crossing is the work's own food
// step (kit_food), asked there with its trips and minutes.
// And at the reserve's floor where the game's ladder keeps one (note 796,
// food-reserve.js floorFor): hunger at eighteen with one beef carried is
// the last meal before none.
function met(bot, supply, floor = 1) {
  return (bot?.food ?? 20) >= HEALS_AT && supply > 0 && supply >= floor;
}

// Hunger met by what is carried (note 761b): under eighteen, with safe food
// carried that brings it back to eighteen when eaten. The hunger is then a
// meal of seconds, not a trip: 25593 (mid-237-cc, 19:47 to 19:50Z) at hunger
// 17, full health and 35 points carried chose go_home_for_food six times and
// walked from (89, 79, 80) to (66, 71, 56) and on to a hunt.
function covered(bot, supply) {
  const hunger = bot?.food ?? 20;
  return hunger < HEALS_AT && supply > 0 && supply >= HEALS_AT - hunger;
}

// Hunger against what health needs, and what the food carried covers of it
// (note 761): "Hunger 13 of 20: no hunger to meet" was said at 13, where
// health does not come back. At full health nothing waits on the healing,
// and it is not said as if it did (note 761b: 25593 at 20 health was told
// "health does not come back until it is eaten back to eighteen").
function hungerSays(bot, supply) {
  const hunger = bot?.food ?? 20;
  const full = (bot?.health ?? 20) >= 20;
  if (hunger >= HEALS_AT) return `Hunger ${hunger}${hunger >= 20 ? ', full' : ''}: health ${full ? 'is full' : 'comes back'}${supply > 0 ? `; the ${supply} points carried are eaten as it falls` : '; nothing carried for when it falls'}.`;
  const gap = HEALS_AT - hunger;
  if (full) return `Hunger ${hunger}, health full: nothing waits on the hunger now${supply >= gap ? `; the ${supply} food points carried bring it to eighteen or more when eaten, in seconds` : supply > 0 ? `; the ${supply} food points carried bring it ${supply} of the ${gap} to eighteen` : '; nothing carried to eat'}.`;
  return `Hunger ${hunger}, under eighteen: health does not come back until it is eaten back to eighteen, ${plural(gap, 'point')} short; ${supply >= gap ? `the ${supply} food points carried cover that, eaten in seconds` : supply > 0 ? `the ${supply} food points carried cover ${supply} of them` : 'nothing carried covers any of it'}.`;
}

// What this bot's own reserve errands came to before this one (note 761b):
// the record a top-up is priced by. Kept on `holder.foodErrandLog`, the last
// ten within three hours.
const LOG_MS = 3 * 3600000;
function logErrand(holder, e, now = Date.now()) {
  if (!e || e.asks < 1) return;
  const log = (holder.foodErrandLog ||= []);
  log.push({ at: now, minutes: Math.round((Math.max(e.lastAt || now, e.since) - e.since) / 6000) / 10, start: e.start, end: e.last ?? e.start, climbed: e.climbed || 0, asks: e.asks });
  holder.foodErrandLog = log.filter(x => now - x.at <= LOG_MS).slice(-10);
}
function recordSays(holder, now = Date.now()) {
  const log = (holder?.foodErrandLog || []).filter(x => now - x.at <= LOG_MS);
  if (!log.length) return 'No food errand of this bot ended in the last three hours to go by.';
  const mins = Math.round(log.reduce((n, x) => n + x.minutes, 0));
  const kept = log.reduce((n, x) => n + (x.end - x.start), 0);
  const climbed = log.reduce((n, x) => n + x.climbed, 0);
  return `This bot's last ${plural(log.length, 'food errand')} (three hours): ${plural(Math.max(1, mins), 'minute')} in all, ${kept >= 0 ? `${kept} points more carried at their ends than their starts` : `${-kept} points fewer carried at their ends than their starts`}${climbed ? `, ${plural(climbed, 'block')} climbed` : ''}.`;
}

// The errand's record, kept on `holder` (the survival layer's state).
// `y` and `dimension`, where given, count the blocks climbed on it (note
// 761: 25588 climbed from y -9 to 103 on one).
// -> the record
function track(holder, { supply, desired, now = Date.now(), y = null, dimension = null }) {
  let e = holder.foodErrand;
  if (!e || now - e.lastAt > GAP_MS || e.desired !== desired) {
    if (e) logErrand(holder, e, now);
    e = holder.foodErrand = { since: now, start: supply, best: supply, asks: 0, desired, window: { since: now, start: supply }, climbed: 0 };
  }
  if (Number.isFinite(y)) {
    if (Number.isFinite(e.lastY) && e.lastDimension === dimension) e.climbed = (e.climbed || 0) + Math.max(0, Math.round(y - e.lastY));
    e.lastY = y; e.lastDimension = dimension;
  }
  e.asks++; e.lastAt = now; e.last = supply;
  if (supply > e.best + EPS) e.best = supply;
  // Kept more since the window began: it got somewhere, measured again from here.
  if (supply > e.window.start + EPS) e.window = { since: now, start: supply };
  return e;
}
function end(holder, now = Date.now()) { logErrand(holder, holder.foodErrand, now); delete holder.foodErrand; }
// Three minutes and nothing kept: the points carried no more than at the
// window's start (a hunt's meat eaten again by the healing is not kept).
function noYield(e, supply, now = Date.now()) {
  return !!e && now - e.window.since >= NO_YIELD_MS && supply <= e.window.start + EPS;
}
function yieldSays(e, supply, now = Date.now()) {
  if (!e || e.asks < 2) return '';
  // How many different animals it has gone after, not only the points
  // (note 719): the 3-minute no-yield rest measures points kept, and a
  // small gain resets its clock every time one is found, whichever animal
  // it came from; a search that keeps switching targets without a kill
  // between gains is not caught by that alone, so it is said here, plainly.
  const chased = e.targetsChased > 1 ? `, ${plural(e.targetsChased, 'animal')} chased` : '';
  return ` This errand so far: ${plural(minutes(now - e.since), 'minute')}, asked ${plural(e.asks, 'time')}${chased}${e.climbed ? `, ${plural(e.climbed, 'block')} climbed` : ''}, ${e.start} points carried at its start and ${supply} now${e.best > Math.max(e.start, supply) + EPS ? ` (the most ${e.best})` : ''}.`;
}
// The errand's cost so far, for the claim: minutes, askings, blocks climbed.
function costSays(e, now = Date.now()) {
  if (!e || e.asks < 2) return '';
  return `the food errand so far: ${plural(minutes(now - e.since), 'minute')}, asked ${plural(e.asks, 'time')}${e.climbed ? `, ${plural(e.climbed, 'block')} climbed` : ''}, ${e.start} points carried at its start`;
}
function restWhy(e, supply, now = Date.now()) {
  return `${plural(minutes(now - e.window.since), 'minute')} of the food errand kept nothing: ${e.window.start} points carried then, ${supply} now`;
}

// For the reserve alone (note 771): hunger at eighteen or more, where
// health comes back, or under it with food carried that brings it there.
// Nothing about the body waits on such a trip; it is work, weighed beside
// the work in hand, not a need that outranks it.
function reserveOnly(bot, supply) {
  return (bot?.food ?? 20) >= HEALS_AT || covered(bot, supply);
}

// What reserve-only errands came to in the flight records (note 771:
// `node scripts/food-errands.js --since 2026-09-30T06:00Z --until
// 2026-10-01T00:00Z`, 666 records): the wins of obtain_food taken for the
// reserve alone, joined into errands three minutes apart, each with its
// minutes and the food points it gained (the most carried within a minute
// of its last win, less what it began with).
const RESERVE_RECORD = Object.freeze({
  window: '2026-09-30 06:00Z to 2026-10-01 00:00Z',
  all: { errands: 268, minutes: 605, nothing: 95, perMinute: 6.4 },
  underground: { errands: 90, minutes: 233, nothing: 59, perMinute: 3.0 },
  undergroundNight: { errands: 33, minutes: 91, nothing: 22, perMinute: 2.3 },
  overWorkFood: { errands: 131, minutes: 386 },
});
const pct = (a, b) => `${Math.round(100 * a / Math.max(1, b))}%`;
const recordRow = (r, where) => `${where}: ${r.errands} errands, ${r.minutes} minutes, ${pct(r.nothing, r.errands)} of them gained no food, ${r.perMinute} food points a minute in all`;
// The record that bears on the bot where it is: underground at night,
// underground, or all.
function reserveRecordSays({ underground = false, night = false } = {}) {
  const R = RESERVE_RECORD;
  const rows = [recordRow(R.all, 'all of them')];
  if (underground) rows.push(recordRow(R.underground, 'begun underground'));
  if (underground && night) rows.push(recordRow(R.undergroundNight, 'begun underground at night'));
  return `Food errands for the reserve alone in the flight records (${R.window}): ${rows.join('; ')}.`;
}
// Where the bot is, for a trip to the surface's animals: the rock over it
// with the climb at its own pace, and the light up there.
function whereSays(bot) {
  const { DAY } = require('./day');
  let depth = null;
  try { depth = require('./levels').depthHere(bot); } catch (_) { depth = null; }
  const t = bot?.time?.timeOfDay;
  const toDawn = Number.isFinite(t) ? Math.round(((DAY.DAWN - t + 24000) % 24000) / 1200) : null;
  const toNight = Number.isFinite(t) ? Math.round(((DAY.NIGHT - t + 24000) % 24000) / 1200) : null;
  const night = Number.isFinite(t) && t >= DAY.NIGHT && t < DAY.DAWN;
  const light = !Number.isFinite(t) ? '' : night ? `night at the surface until dawn, about ${toDawn} real minute${toDawn === 1 ? '' : 's'} off; the animals are found in the dark among its mobs` : `day at the surface for about ${toNight} more real minute${toNight === 1 ? '' : 's'}, night after that`;
  let climb = '';
  if (Number.isFinite(depth) && depth > 0) { try { climb = `the bot is ${require('./levels').climbSays(depth)}`; } catch (_) { climb = `the bot is ${depth} blocks under open sky`; } }
  const parts = [climb, light].filter(Boolean);
  return parts.length ? `Where: ${parts.join('; ')}.` : '';
}

// The work's own step is the food for the Nether (work.js kitFoodStep,
// gatherNetherFood): a reserve-only errand of the survival layer beside it
// is the same food taken from that step to a search of its own (note 771:
// 131 of the 268 reserve-only errands in the record, 386 minutes, were
// over the work's own food step; 25589 at 23:55:46Z, 2026-09-30).
const WORK_FOOD_STEPS = new Set(['nether_food', 'hunt_food_for_nether', 'food_near_frame', 'food_known', 'cook_for_nether', 'fetch_food_from_stash', 'harvest_for_nether']);
function workIsFood(goal) {
  return goal?.gameProgress?.phase === 'nether_food' || WORK_FOOD_STEPS.has(goal?.step?.action);
}
// The reserve wanted is the crossing's, on the game's ladder: its food rung
// (kit_food) asks for it with its trips and minutes, and sets it aside or
// goes without (note 761); the survival layer's own errand for it, the
// hunger met, is that rung taken off the work's hands (note 771: 25589 set
// its nether-food rung aside at 23:55:53Z, 2026-09-30, and chose the
// Nether first; the flags its food step had raised kept the survival layer
// after the 80 points, asked 18 times in four minutes).
function crossingReserve(goal) {
  return goal?.kind === 'win' && !!(goal.preparingNether || goal.preparingEnd);
}

// The raw meat carried and what cooking it adds, in points.
function cookSays(bot) {
  let stock = null;
  try { stock = require('./nether-food').foodStock(bot); } catch (_) { stock = null; }
  if (!stock?.cookedGain) return '';
  return ` Cooking the raw meat carried (${stock.raw.map(m => `${m.n} ${m.item.replaceAll('_', ' ')}`).join(', ')}) adds ${stock.cookedGain} points.`;
}

// The option's words. `hungry` as the layer reads it.
// `holder`, where given, is the layer's state, for the record of its errands.
function says(bot, goal, { supply, desired, hungry, errand = null, now = Date.now(), holder = null }) {
  const hunger = bot?.food ?? 20;
  // Hunger against what health needs first, then what the errand is for:
  // below eighteen it is not "no hunger to meet" (note 761). Hunger that
  // what is carried meets is a meal (eat_carried), and the trip is for the
  // reserve alone, said with this bot's record of such trips (note 761b).
  const reserveOnly = hunger >= HEALS_AT || covered(bot, supply);
  const purpose = reserveOnly ? `This trip is for the reserve alone${hunger < HEALS_AT ? ' (the hunger is a meal of what is carried)' : ''}.`
    : hungry ? 'This is for the hunger.' : 'This is for the hunger and the reserve.';
  const short = Math.max(0, Math.round(desired - supply));
  // For the reserve alone, priced (note 771): where the bot is (the rock
  // over it, the climb, the light up there) and what such errands came to
  // in the record, and for the Nether's reserve, what the first stays with
  // and without it came to (note 763's kit record).
  let priced = '';
  if (reserveOnly) {
    const { DAY } = require('./day'), t = bot?.time?.timeOfDay;
    let underground = false;
    try { underground = require('./levels').depthHere(bot) > 0; } catch (_) { underground = false; }
    const night = Number.isFinite(t) && t >= DAY.NIGHT && t < DAY.DAWN;
    const where = whereSays(bot);
    const stays = goal?.preparingNether ? require('./kit-record').staysSays('nether_food') : '';
    priced = `${where ? ` ${where}` : ''} ${reserveRecordSays({ underground, night })}${stays ? ` The Nether's ${stays}.` : ''}`;
  }
  // For the hunger, where the search is and what goes with it (note 1181):
  // the hour and the mobs it is made among, the health that does not come
  // back on the way, and that hunger above nothing does no harm by itself.
  // 25594 (2026-10-04 06:02:01Z), at health 5.3 and hunger 13 an hour into
  // the night with a creeper and two skeletons about, was told only 'this is
  // for the hunger', chose the search at 0.83 over sealing in, and was shot
  // dead forty-three seconds on with twelve eyes of ender in its pack.
  if (!reserveOnly) {
    const where = whereSays(bot), hp = Number(bot?.health);
    priced = `${where ? ` ${where}` : ''} Hunger ${hunger} does no harm by itself: it harms only at 0 and stops a sprint at 6.${Number.isFinite(hp) && hp < 20 ? ` Health ${Math.round(hp * 10) / 10} of 20 goes on the search as it is and does not come back until the food is found and eaten.` : ''}`;
  }
  // The reserve's record for what is carried (note 796).
  const fr = require('./food-reserve');
  const record = fr.keeps(bot, goal) ? ` ${fr.sayHere(bot, supply)}` : '';
  return `Get food. ${hungerSays(bot, supply)} ${purpose} ${supply} food points carried of the ${desired} kept for ${reserveFor(goal)}: ${short} short.${record}${cookSays(bot)}${yieldSays(errand, supply, now)}${reserveOnly && holder ? ` ${recordSays(holder, now)}` : ''}${priced}`;
}

module.exports = { crossingReserve, workIsFood, WORK_FOOD_STEPS, reserveOnly, RESERVE_RECORD, reserveRecordSays, whereSays, track, end, noYield, yieldSays, restWhy, says, fillsHunger, reserveFor, cookSays, met, covered, hungerSays, costSays, recordSays, logErrand, HEALS_AT, NO_YIELD_MS, GAP_MS, REST_MS };
