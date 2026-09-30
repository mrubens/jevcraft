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

// The errand's record, kept on `holder` (the survival layer's state).
// -> the record
function track(holder, { supply, desired, now = Date.now() }) {
  let e = holder.foodErrand;
  if (!e || now - e.lastAt > GAP_MS || e.desired !== desired) {
    e = holder.foodErrand = { since: now, start: supply, best: supply, asks: 0, desired, window: { since: now, start: supply } };
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
  return ` This errand so far: ${plural(minutes(now - e.since), 'minute')}, asked ${plural(e.asks, 'time')}${chased}, ${e.start} points carried at its start and ${supply} now${e.best > Math.max(e.start, supply) + EPS ? ` (the most ${e.best})` : ''}.`;
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
  const fills = fillsHunger(bot, supply);
  const need = !hungry ? `Hunger ${hunger} of 20${hunger >= 20 ? ', full' : ''}: no hunger to meet, this tops up the reserve.`
    : fills ? `Hunger ${hunger}: what is carried fills it when eaten; this tops up the reserve.`
      : `Hunger ${hunger}, and what is carried does not fill it.`;
  const short = Math.max(0, Math.round(desired - supply));
  return `Get food. ${need} ${supply} food points carried of the ${desired} kept for ${reserveFor(goal)}: ${short} short.${cookSays(bot)}${yieldSays(errand, supply, now)}`;
}

module.exports = { track, end, noYield, yieldSays, restWhy, says, fillsHunger, reserveFor, cookSays, NO_YIELD_MS, GAP_MS, REST_MS };
