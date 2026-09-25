'use strict';
// Where animals were seen, kept for when they are wanted. The bot sees a
// flock of sheep a hundred blocks off while it mines or walks, and until
// now forgot it the moment the flock was out of view: trial 60 came to its
// bed forty-five minutes in with fourteen sheep a hundred and some blocks
// away, and was told "none seen yet". Noted every fifteen seconds with the
// trail (stillness.js), a flock to a place, for half an hour.
const KINDS = ['sheep'];
const FLOCK = 24;
const KEEP_MS = 30 * 60000;
const EVERY_MS = 15000;
const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

function noteSightings(bot, goal, now = Date.now()) {
  if (!goal || !bot.entity?.position || now - (bot._sightedAt || 0) < EVERY_MS) return;
  bot._sightedAt = now;
  const dimension = String(bot.game?.dimension || 'overworld');
  const seen = goal.sightings ||= {};
  for (const kind of KINDS) {
    const list = (seen[kind] || []).filter(s => now - s.at < KEEP_MS);
    const here = Object.values(bot.entities || {}).filter(e => e.name === kind && e.isValid !== false && e.position);
    for (const e of here) {
      const p = e.position;
      const flock = list.find(s => s.dimension === dimension && Math.hypot(s.x - p.x, s.z - p.z) <= FLOCK);
      if (flock) {
        // Counted afresh each look: the flock is where most of it is now.
        if (flock.at !== now) Object.assign(flock, { at: now, count: 0, sx: 0, sy: 0, sz: 0 });
        flock.count++; flock.sx += p.x; flock.sy += p.y; flock.sz += p.z;
        Object.assign(flock, { x: Math.round(flock.sx / flock.count), y: Math.round(flock.sy / flock.count), z: Math.round(flock.sz / flock.count) });
      } else list.push({ x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z), count: 1, at: now, dimension, sx: p.x, sy: p.y, sz: p.z });
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
      says: `${s.count} ${kind} seen ${minutes ? `${minutes} minute${minutes === 1 ? '' : 's'} ago` : 'just now'}, ${distance} blocks ${direction} (${s.x}, ${s.z})` };
  }).sort((a, b) => a.distance - b.distance);
}

module.exports = { noteSightings, sighted, KINDS };
