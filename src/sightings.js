'use strict';
// Where animals were seen, kept for when they are wanted: sheep for the
// bed's wool, cows, pigs and chickens for food and the pen (the user,
// 2026-09-25: "remember the animals"). The bot sees a
// flock of sheep a hundred blocks off while it mines or walks, and until
// now forgot it the moment the flock was out of view: trial 60 came to its
// bed forty-five minutes in with fourteen sheep a hundred and some blocks
// away, and was told "none seen yet". Noted every fifteen seconds with the
// trail (stillness.js), a flock to a place, for half an hour.
// Chickens and pigs are never food (protected-animals.js), so not noted.
// And hoglins, the Nether's meat, for when food is short there
// (nether-travel.js).
// And wild wolves, for the bones carried (wolves.js, note 644): a tamed one
// beside the bot, or a pup, is not one to walk back to.
// Rabbits too: the food of snowy and desert ground, hunted there when no
// cow is about (mid-231-r ate one a minute before sealing in, and its
// pocket was told of no food for an hour; note 538).
// Pigs and chickens too (note 2484, Fable's audit of 2026-10-29): hunted since the user lifted the rule on 10-19, never
// remembered, so never offered as a walk back for food.
const KINDS = ['sheep', 'cow', 'rabbit', 'pig', 'chicken', 'hoglin', 'wolf'];
const FLOCK = 24;
const KEEP_MS = 30 * 60000;
const EVERY_MS = 15000;
const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

// Whether a sheep seen still has its wool, and the flock said by it (note 2343): full-14 (25588, 2026-10-28
// 05:17:54 to 05:21Z) walked back four times across its island to a sheep 'seen just now', the one it had sheared
// there, and came to 2 of 3 wool. A sheep sheared grows it back eating grass, a few minutes.
const woolly = (bot, e) => { try { return !require('./shearing').sheared(bot, e); } catch (_) { return true; } };
const woollySays = s => s.woolly == null ? '' : s.woolly === s.count ? '' : s.woolly === 0 ? ` (sheared, none with wool when seen)` : ` (${s.woolly} with wool when seen)`;

function noteSightings(bot, goal, now = Date.now()) {
  if (!goal || !bot.entity?.position || now - (bot._sightedAt || 0) < EVERY_MS) return;
  bot._sightedAt = now;
  const dimension = String(bot.game?.dimension || 'overworld');
  const seen = goal.sightings ||= {};
  for (const kind of KINDS) {
    const list = (seen[kind] || []).filter(s => now - s.at < KEEP_MS);
    const here = Object.values(bot.entities || {}).filter(e => e.name === kind && e.isValid !== false && e.position && (kind !== 'wolf' || require('./wolves').wild(bot, e)));
    for (const e of here) {
      const p = e.position;
      const flock = list.find(s => s.dimension === dimension && Math.hypot(s.x - p.x, s.z - p.z) <= FLOCK);
      if (flock) {
        // Counted afresh each look: the flock is where most of it is now.
        if (flock.at !== now) Object.assign(flock, { at: now, count: 0, sx: 0, sy: 0, sz: 0, woolly: kind === 'sheep' ? 0 : undefined });
        flock.count++;
        if (kind === 'sheep') flock.woolly = (flock.woolly || 0) + (woolly(bot, e) ? 1 : 0); flock.sx += p.x; flock.sy += p.y; flock.sz += p.z;
        Object.assign(flock, { x: Math.round(flock.sx / flock.count), y: Math.round(flock.sy / flock.count), z: Math.round(flock.sz / flock.count) });
      } else list.push({ x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), count: 1, at: now, dimension, sx: p.x, sy: p.y, sz: p.z, ...(kind === 'sheep' ? { woolly: woolly(bot, e) ? 1 : 0 } : {}) });
    }
    seen[kind] = list.sort((a, b) => b.at - a.at).slice(0, 8);
  }
}

// The flocks remembered, nearest first, as a player would say them.
function sighted(bot, goal, kind, now = Date.now()) {
  const p = bot.entity.position, dimension = String(bot.game?.dimension || 'overworld');
  return (goal?.sightings?.[kind] || []).filter(s => now - s.at < KEEP_MS && s.dimension === dimension).map(s => {
    const dx = s.x - p.x, dz = s.z - p.z, distance = Math.round(Math.hypot(dx, dz));
    const direction = distance ? COMPASS[((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8] : 'here';
    const minutes = Math.round((now - s.at) / 60000);
    return { x: s.x, y: s.y, z: s.z, count: s.count, distance, direction, minutesAgo: minutes,
      woolly: s.woolly, says: `${s.count} ${kind}${woollySays(s)} seen ${minutes ? `${minutes} minute${minutes === 1 ? '' : 's'} ago` : 'just now'}, ${distance} blocks ${direction}${require('./height-says').heightSays(bot, s)} (${s.x}, ${s.y ?? '?'}, ${s.z})${require('./height-says').wayFailedSays(bot, s)}` };
  }).sort((a, b) => a.distance - b.distance);
}

// How many of a kind the bot knows of within reach: in view now, and in
// flocks remembered and out of view. Said beside a hunt, so the last two
// cows are known to be the last two.
function known(bot, goal, kind, reach = 128) {
  const here = bot.entity.position;
  const inView = Object.values(bot.entities || {}).filter(e => e.name === kind && e.isValid !== false && e.position && e.position.distanceTo(here) <= reach).length;
  const away = sighted(bot, goal, kind).filter(s => s.distance > 48 && s.distance <= reach).reduce((n, s) => n + s.count, 0);
  return { inView, rememberedAway: away, total: inView + away };
}

// Walk back to a flock; one not reached, or reached and gone, is forgotten.
// `out` is told how it ended: out.walk 'failed' with the walk's own error,
// or 'arrived' (and out.why when none was there). The hunt's record had said
// "walked to where ... and none was within thirty-two blocks" of walks that
// found no way at all (note 682).
async function walkToSighting(bot, task, goal, save, kind, s, navigate, out = {}) {
  const { goals } = require('mineflayer-pathfinder');
  const forget = () => { if (goal.sightings?.[kind]) goal.sightings[kind] = goal.sightings[kind].filter(f => Math.hypot(f.x - s.x, f.z - s.z) > 24); save(); };
  try { await navigate(bot, task, new goals.GoalNear(s.x, s.y, s.z, 6), { timeoutMs: 90000, stallMs: 10000 }); }
  catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; forget(); out.walk = 'failed'; out.why = String(err?.message || err).slice(0, 160); return false; }
  const there = Object.values(bot.entities || {}).some(e => e.name === kind && e.isValid !== false && e.position?.distanceTo(bot.entity.position) < 32);
  out.walk = 'arrived';
  if (!there) { forget(); out.why = 'none was within thirty-two blocks'; }
  return there;
}

module.exports = { noteSightings, sighted, known, walkToSighting, KINDS };
