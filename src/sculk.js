'use strict';
// Sculk: what hears the bot, and what it calls. mid-230-n ran from a
// creeper down into a patch of the deep dark it was never told of, mined and
// dug beside four sculk sensors and a shrieker four blocks under it, and the
// warden the shrieker called boomed it through its pocket's wall (notes 412,
// 414). Said as facts with every question about playing the game, and the
// retreat's footings kept out of the sensors' hearing where it can.
const SENSOR_HEARS = 8;
const LOOK = 16;
const SENSORS = ['sculk_sensor', 'calibrated_sculk_sensor'];

function ids(bot, names) {
  return names.map(n => bot.registry?.blocksByName?.[n]?.id).filter(id => id !== undefined);
}
// A shrieker set down by a player never calls a warden; the ones the world
// grows in the deep dark do (can_summon).
function summons(bot, p) {
  const b = bot.blockAt(p);
  const props = typeof b?.getProperties === 'function' ? b.getProperties() : b?._properties || {};
  return props.can_summon === undefined ? true : props.can_summon === true || props.can_summon === 'true';
}

function sculkAbout(bot, { radius = LOOK } = {}) {
  if (typeof bot.findBlocks !== 'function' || !bot.entity?.position) return null;
  const here = bot.entity.position;
  const find = names => { const m = ids(bot, names); return m.length ? bot.findBlocks({ matching: m, maxDistance: radius, count: 32 }) : []; };
  const sensors = find(SENSORS);
  const shriekers = find(['sculk_shrieker']).filter(p => summons(bot, p));
  if (!sensors.length && !shriekers.length) return null;
  const nearest = list => list.length ? Math.round(Math.min(...list.map(p => p.distanceTo(here)))) : null;
  const heard = sensors.some(p => p.distanceTo(here) <= SENSOR_HEARS);
  const warnings = (bot._shrieks || []).filter(t => Date.now() - t < 10 * 60000).length;
  return {
    sensors: sensors.length, nearestSensor: nearest(sensors), shriekers: shriekers.length, nearestShrieker: nearest(shriekers),
    withinHearing: heard, warnings,
    says: `Sculk about: ${sensors.length ? `${sensors.length} sculk sensor${sensors.length === 1 ? '' : 's'}, the nearest ${nearest(sensors)} blocks off${heard ? ' (within its hearing)' : ''}` : 'no sculk sensor'}` +
      `${shriekers.length ? `; ${shriekers.length} sculk shrieker${shriekers.length === 1 ? '' : 's'} that can call a warden, the nearest ${nearest(shriekers)} blocks off` : ''}.` +
      ` A sensor hears vibrations within ${SENSOR_HEARS} blocks: walking, landing, digging, placing, eating, opening a chest; walking crouched makes none.` +
      ` A sensor that hears sets off the shriekers wired to it, and a shrieker stepped on shrieks too; each shriek is a warning, and the fourth within about ten minutes calls a warden up out of the ground beside it.` +
      `${warnings ? ` The bot has been warned ${warnings === 1 ? 'once' : `${warnings} times`} in the last ten minutes (the darkness a shriek brings).` : ''}` +
      ' Away from the sensors, nothing hears.',
  };
}

// A test for footings within a sensor's hearing, for the retreat to leave
// last: the sensors found once, out to the footings' reach and their own.
function hearing(bot, reach = 40) {
  const m = ids(bot, SENSORS);
  if (!m.length || typeof bot.findBlocks !== 'function') return () => false;
  const sensors = bot.findBlocks({ matching: m, maxDistance: reach + SENSOR_HEARS, count: 64 });
  return p => sensors.some(s => s.distanceTo(p) <= SENSOR_HEARS);
}

// An area of sculk Jev chose to take the work out of: its lava and its
// landmarks are passed over while it rests.
const ZONE_REACH = 16, ZONE_REST_MS = 30 * 60000;
function inQuietZone(goal, p, now = Date.now()) {
  return (goal?.quietZones || []).some(z => z.until > now && Math.hypot(z.x - p.x, z.y - p.y, z.z - p.z) <= ZONE_REACH);
}

module.exports = { sculkAbout, hearing, inQuietZone, SENSOR_HEARS, ZONE_REACH, ZONE_REST_MS };
