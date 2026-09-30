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
function met(bot, supply) {
  return (bot?.food ?? 20) >= HEALS_AT && supply > 0;
}

// Hunger against what health needs, and what the food carried covers of it
// (note 761): "Hunger 13 of 20: no hunger to meet" was said at 13, where
// health does not come back.
function hungerSays(bot, supply) {
  const hunger = bot?.food ?? 20;
  if (hunger >= HEALS_AT) return `Hunger ${hunger}${hunger >= 20 ? ', full' : ''}: health comes back${supply > 0 ? `; the ${supply} points carried are eaten as it falls` : '; nothing carried for when it falls'}.`;
  const gap = HEALS_AT - hunger;
  return `Hunger ${hunger}, under eighteen: health does not come back until it is eaten back to eighteen, ${plural(gap, 'point')} short; ${supply >= gap ? `the ${supply} food points carried cover that` : supply > 0 ? `the ${supply} food points carried cover ${supply} of them` : 'nothing carried covers any of it'}.`;
}

// The errand's record, kept on `holder` (the survival layer's state).
// `y` and `dimension`, where given, count the blocks climbed on it (note
// 761: 25588 climbed from y -9 to 103 on one).
// -> the record
function track(holder, { supply, desired, now = Date.now(), y = null, dimension = null }) {
  let e = holder.foodErrand;
  if (!e || now - e.lastAt > GAP_MS || e.desired !== desired) {
    e = holder.foodErrand = { since: now, start: supply, best: supply, asks: 0, desired, window: { since: now, start: supply }, climbed: 0 };
  }
  if (Number.isFinite(y)) {
    if (Number.isFinite(e.lastY) && e.lastDimension === dimension) e.climbed = (e.climbed || 0) + Math.max(0, Math.round(y - e.lastY));
    e.lastY = y; e.lastDimension = dimension;
  }
  e.asks++; e.lastAt = now;
  if (supply > e.best + EPS) e.best = supply;
  // Kept more since the window began: it got somewhere, measured again from here.
  if (supply > e.window.start + EPS) e.window = { since: now, start: supply };
  return e;
}
function end(holder) { delete holder.foodErrand; }
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

// The raw meat carried and what cooking it adds, in points.
function cookSays(bot) {
  let stock = null;
  try { stock = require('./nether-food').foodStock(bot); } catch (_) { stock = null; }
  if (!stock?.cookedGain) return '';
  return ` Cooking the raw meat carried (${stock.raw.map(m => `${m.n} ${m.item.replaceAll('_', ' ')}`).join(', ')}) adds ${stock.cookedGain} points.`;
}

// The option's words. `hungry` as the layer reads it.
function says(bot, goal, { supply, desired, hungry, errand = null, now = Date.now() }) {
  const hunger = bot?.food ?? 20;
  // Hunger against what health needs first, then what the errand is for:
  // below eighteen it is not "no hunger to meet" (note 761).
  const heals = hunger >= HEALS_AT;
  const gapCovered = supply >= HEALS_AT - hunger;
  const purpose = heals ? 'This tops up the reserve.'
    : gapCovered ? 'Eating what is carried meets that; this tops up the reserve.'
      : hungry ? 'This is for the hunger.' : 'This is for the hunger and the reserve.';
  const short = Math.max(0, Math.round(desired - supply));
  return `Get food. ${hungerSays(bot, supply)} ${purpose} ${supply} food points carried of the ${desired} kept for ${reserveFor(goal)}: ${short} short.${cookSays(bot)}${yieldSays(errand, supply, now)}`;
}

module.exports = { track, end, noYield, yieldSays, restWhy, says, fillsHunger, reserveFor, cookSays, met, hungerSays, costSays, HEALS_AT, NO_YIELD_MS, GAP_MS, REST_MS };
