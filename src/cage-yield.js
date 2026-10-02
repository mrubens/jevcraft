'use strict';
// The time at a live blaze cage and what it has come to, said on the ways
// that hold the bot there (note 702).
//
// 25591 (mid-242-jb, 2026-09-29 23:41 to 23:49Z) stood at (160, 62, 356), 1.4
// blocks from the cage at (158, 64, 356), at 20 health with 6 rods still
// needed, and answered box_here, take_cover, stand_by_spawner and keep_at_it
// about 26 times with no kill; the blazes were 2 to 5 blocks off out of
// sight and never crossed the box's window, while close_in and
// charge_nearest said "nearest blaze 2.3 blocks off ... strike from (159, 62,
// 355)". Each hold was said as it was on the first asking: nothing in its
// words said it had been held for minutes and taken nothing.
//
// Here: one record of the stay at a cage (from the first asking within 16
// of it, until the bot has been away five minutes or the cage is another),
// its minutes, blazes killed near the bot, rods and health lost, said on
// each hold; after three minutes with no kill or rod (note 699's measure)
// with blazes within reach, that said plainly with their count; and on
// take_cover at full health with a strike on offer, what cover gives up.

const AWAY_MS = 5 * 60000;
const NO_YIELD_MS = 3 * 60000;
const REACH = 5;       // blazes this near: a step and a swing
// The ways that keep the bot where it is at the cage, waiting for blazes.
const HOLDS = new Set(['box_here', 'box_at_spawner', 'take_cover', 'stand_by_spawner', 'fight_at_spawner', 'seal', 'dig_down',
  'dig_in_at_spawner', 'dig_in_and_fight', 'stay_and_fight', 'open_slit', 'keep_at_it', 'back_to_wall', 'out_of_sight', 'nook', 'defer', 'hold_box']);
const STRIKES = ['close_in', 'charge_nearest'];
// A hold's rest (note 884), and what must be on offer beside it: a strike or a way out.
const HOLD_REST_MS = 10 * 60000, HOLD_REST_HEALTH = 12;
const ACTS = ['close_in', 'charge_nearest', 'fight', 'hunt_on', 'break_spawner', 'step_out', 'wait_far_off', 'go_back', 'leave_and_heal', 'retreat', 'bank_rods', 'pull_back'];
const r1 = n => Math.round(n * 10) / 10;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const minutes = ms => Math.max(1, Math.round(ms / 60000));

// Health lost, counted as it goes (a heal between askings does not hide it).
function watchHealth(bot) {
  if (!bot || typeof bot.on !== 'function' || bot.__healthLost) return;
  bot.__healthLost = true;
  bot._healthLost = 0;
  let last = bot.health;
  bot.on('health', () => {
    if (Number.isFinite(last) && Number.isFinite(bot.health) && bot.health < last) bot._healthLost += last - bot.health;
    last = bot.health;
  });
}
const kills = bot => bot?._kills?.blaze || 0;
const rods = bot => { try { return require('./skills').countOf(bot, 'blaze_rod'); } catch (_) { return 0; } };

// The stay's record, updated at an asking by the cage. -> the record or null
function update(bot, goal, now = Date.now()) {
  let fight = null;
  try { fight = require('./cage-hold').cageFight(bot, goal); } catch (_) { fight = null; }
  if (!fight) return null;
  try { require('./rung-measure').watchKills(bot); } catch (_) { /* no events */ }
  watchHealth(bot);
  const cage = { x: fight.cage.x, y: fight.cage.y, z: fight.cage.z };
  let rec = goal.cageYield;
  const same = rec && rec.cage.x === cage.x && rec.cage.y === cage.y && rec.cage.z === cage.z && now - rec.lastAt <= AWAY_MS;
  const health = bot.health ?? 20;
  if (!same) rec = goal.cageYield = { cage, since: now, lastAt: now, kills: kills(bot), rods: rods(bot), lost: bot._healthLost || 0, spent: 0, health, yieldAt: now };
  // Where no health event is heard, the drop between askings.
  if (!bot.__healthLost) rec.spent += Math.max(0, (rec.health ?? health) - health);
  rec.health = health;
  const k = kills(bot) - rec.kills, rd = rods(bot) - rec.rods;
  if (k > (rec.lastKills || 0) || rd > (rec.lastRods || 0)) rec.yieldAt = now;
  rec.lastKills = Math.max(0, k); rec.lastRods = Math.max(0, rd);
  rec.lastAt = now;
  return { rec, fight };
}

// The blazes within 16 and within reach, seen or not.
function blazesAbout(bot) {
  let list = [];
  try { list = require('./danger').threats(bot, 16).filter(t => t.entity.name === 'blaze'); } catch (_) { list = []; }
  const near = list.filter(t => t.distance <= REACH);
  return { all: list.length, near: near.length, unseen: near.filter(t => !t.visible).length, nearest: list.length ? r1(Math.min(...list.map(t => t.distance))) : null };
}

// -> { says, stalled, facts } for the stay now.
function said(bot, rec, now = Date.now()) {
  const spent = r1((bot.__healthLost ? (bot._healthLost || 0) - rec.lost : rec.spent));
  const held = minutes(now - rec.since);
  const says = ` At this cage ${plural(held, 'minute')} so far: ${plural(rec.lastKills || 0, 'blaze')} killed, ${plural(rec.lastRods || 0, 'rod')}, ${spent} health lost.`;
  const about = blazesAbout(bot);
  const idle = now - rec.yieldAt;
  const stalled = idle >= NO_YIELD_MS && about.near > 0;
  const plain = stalled ? ` Nothing has come of it for ${plural(minutes(idle), 'minute')} while ${plural(about.near, 'blaze')} ${about.near === 1 ? 'was' : 'were'} within ${REACH} blocks${about.unseen ? ` (${about.unseen} out of sight)` : ''}: held like this, ${about.near === 1 ? 'it stays' : 'they stay'} out of its line.` : '';
  return { says: says + plain, stalled, about, facts: { minutes: held, blazesKilled: rec.lastKills || 0, rods: rec.lastRods || 0, healthLost: spent, minutesSinceAKillOrRod: minutes(idle), blazesWithinReach: about.near } };
}

// Said on the holds in `options` (a map of { description }), and what cover
// gives up. -> the facts for the question's state, or null
function annotate(bot, goal, options, now = Date.now()) {
  if (!options || !goal) return null;
  const u = update(bot, goal, now);
  if (!u) return null;
  const s = said(bot, u.rec, now);
  for (const [k, o] of Object.entries(options)) {
    if (!HOLDS.has(k) || !o || typeof o.description !== 'string') continue;
    o.description += s.says;
  }
  // A hold that has brought nothing rests (note 884), as any answer that
  // came to nothing does (tried.js): ten minutes at this cage with no kill
  // and no rod, blazes within sixteen, the bot at twelve health or more, and
  // a strike or a way out on offer: the holds are withheld until a kill or
  // a rod, or the stay ends, and said so. 25590 (mid-242-we-fortress-3,
  // 2026-10-02 13:17 to 13:42Z) held boxes, bunkers and cover at its cage
  // for 25 minutes, the words "25 minutes so far: 0 blazes killed" on each,
  // while eleven blazes gathered, and died there; the trials' box holds
  // have killed no blaze. Under twelve health a hold is shelter, and stays.
  const idle = now - u.rec.yieldAt;
  if (idle >= HOLD_REST_MS && s.about.all > 0 && (bot.health ?? 20) >= HOLD_REST_HEALTH && ACTS.some(k => options[k])) {
    const rested = Object.keys(options).filter(k => HOLDS.has(k) && options[k]);
    for (const k of rested) delete options[k];
    if (rested.length) s.facts.holdsResting = `The holds here (${rested.map(k => k.replaceAll('_', ' ')).join(', ')}) rest: ${plural(minutes(idle), 'minute')} at this cage brought no kill and no rod. They are offered again after a kill or a rod, or under ${HOLD_REST_HEALTH} health.`;
    return s.facts;
  }
  // Cover at full health, a strike on offer: what it gives up.
  const strike = STRIKES.find(k => options[k]);
  if (options.take_cover && typeof options.take_cover.description === 'string' && (bot.health ?? 0) >= 20 && strike && s.about.nearest != null) {
    options.take_cover.description += ` At full health, cover gives up the strike ${strike.replace('_', ' ')} offers on the blaze ${s.about.nearest} blocks off: a blaze out of the bot's line brings no rod.`;
  }
  return s.facts;
}

module.exports = { annotate, update, said, blazesAbout, watchHealth, HOLDS, NO_YIELD_MS, AWAY_MS, REACH, HOLD_REST_MS, HOLD_REST_HEALTH };
