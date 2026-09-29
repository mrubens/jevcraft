'use strict';
// Which of the mobs about can get at the bot on its way out of a pocket, and
// which are about but not in the way.
//
// mid-242-dc-fortress-22 (25589, note 679) sealed in at 12 health with
// nothing to eat against a skeleton 9 blocks off. Its leave was priced as
// "out among them, fighting them all ... 59.5 damage, more than the bot
// has": the skeleton 6 blocks off and a wither skeleton 12 blocks off heard
// behind the fortress wall, with the work 77 blocks the other way. Jev chose
// to stay three times and the wait brought nothing. On the way out:
//   - a mob that only walks (walk-reach.js WALKERS) is in the way while it
//     has a way to the door, seen or not (once the bot is out it can come
//     round into sight); one the search finds no way for is not;
//   - a shooter is in the way with a line to the door or the open ground on
//     the way on within its reach (it shoots only with a line), at the door
//     (within eight blocks), or, a blaze or a ghast, anywhere within sixteen
//     in the open (it drifts and turns on what it sees);
//   - the rest (spiders climb, endermen teleport, cubes leap) are not judged,
//     so in the way.
// The others are said as present, not priced as a fight.
//
// The way out is the door the leave opens (survival.js leaveExit), the cell
// the bot stands in outside it, and the open ground on the straight line
// from there toward where the work is, sampled every two blocks for
// sixteen: cells with a solid block at the feet or head are rock the bot
// would dig through, and no mob sees into rock.
const { Vec3 } = require('vec3');

const ALONG = 16, EVERY = 2;
// Near enough to be at the door as it opens, seen or not: the stance's own
// "within 8 blocks" (stance-scene.js NEAR).
const AT_THE_DOOR = 8;
// Flyers in the open: a blaze or a ghast drifts, and turns on what it sees
// within its reach; sixteen is the radius every pocket option counts.
const FLYERS = new Set(['blaze', 'ghast', 'phantom', 'vex']);
const FLYER_NEAR = 16;

const solidAt = (bot, c) => { const b = bot.blockAt?.(c); return !b || b.boundingBox === 'block'; };

// The points the bot stands at on its way out: the door (dug), the cell
// outside it, and the open cells on the line toward `target`.
function wayPoints(bot, { origin, exit, target = null }) {
  if (!exit?.door) return [];
  const o = origin, door = exit.door;
  const out = exit.outside || (exit.up ? null : door.plus(door.minus(o)));
  const pts = [door.offset(0.5, 0, 0.5)];
  if (out) pts.push(out.offset(0.5, 0, 0.5));
  const from = out || door;
  if (target && Number.isFinite(target.x) && Number.isFinite(target.z)) {
    const dx = target.x - from.x, dz = target.z - from.z, len = Math.hypot(dx, dz);
    if (len >= 1) for (let s = EVERY; s <= Math.min(ALONG, len); s += EVERY) {
      const c = new Vec3(Math.floor(from.x + 0.5 + dx / len * s), from.y, Math.floor(from.z + 0.5 + dz / len * s));
      if (!solidAt(bot, c) && !solidAt(bot, c.offset(0, 1, 0))) pts.push(c.offset(0.5, 0, 0.5));
    }
  }
  return pts;
}

// -> { inWay: [threat], apart: [{ t, why }], points }
// `mobs` in danger.js's threats shape; `dug` the door's cells (opened by the
// leave, so a line through them is clear); `sightOf(name)` how far a mob of
// that kind takes a player it sees as its target (combat-estimate
// followRange, a shooter's RANGE where longer).
function wayOut(bot, { origin, exit, target = null, mobs = [], sightOf = () => 16, noWayIds = null }) {
  const { lineClear } = require('./danger');
  const points = wayPoints(bot, { origin, exit, target });
  if (!points.length) return { inWay: mobs.slice(), apart: [], points };
  const door = points[0];
  const open = new Set();
  if (exit.door) for (const dy of [0, 1]) open.add(`${exit.door.offset(0, dy, 0)}`);
  // Walkers that have no way to where the bot stands outside the door
  // (walk-reach.js), the door's cells dug: unsure is "it reaches".
  let noWay = noWayIds;
  if (!noWay) {
    noWay = new Set();
    try {
      const at = points[1] || door;
      const dug = exit.door ? [exit.door, exit.door.offset(0, 1, 0)] : [];
      noWay = require('./walk-reach').walkersApart(bot, mobs, { at, dug }).ids;
    } catch (_) { noWay = new Set(); }
  }
  const { WALKERS } = require('./walk-reach');
  const { shooter } = require('./mob-policy');
  const inWay = [], apart = [];
  for (const t of mobs) {
    const p = t.entity?.position;
    if (!p) { inWay.push(t); continue; }
    const name = t.entity.name;
    // A mob that only walks: in the way while it has a way to the door (the
    // search judges its body and the ground; unsure is "it reaches"), seen
    // or not: once the bot is out it can come round into sight.
    if (WALKERS.has(name) && !shooter(t.entity)) {
      if (noWay.has(t.entity.id)) apart.push({ t, why: 'no way to the door' });
      else inWay.push(t);
      continue;
    }
    // A shooter: in the way with a line to the door or the open ground on
    // the way on, within its reach; one at the door, seen or not; a flyer
    // about in the open.
    if (shooter(t.entity) || FLYERS.has(name)) {
      const eye = p.offset(0, Math.min(t.entity.height || 1.6, 1.6), 0);
      const reach = sightOf(name);
      const sees = points.some(q => eye.distanceTo(q) <= reach && lineClear(bot, eye, q.offset(0, 1.5, 0), { open }));
      const atDoor = Math.min(t.distance, p.distanceTo(door)) <= AT_THE_DOOR;
      const flyer = FLYERS.has(name) && Math.min(t.distance, p.distanceTo(door)) <= FLYER_NEAR;
      if (sees || atDoor || flyer) inWay.push(t);
      else apart.push({ t, why: 'no line to the door or the way on' });
      continue;
    }
    // The rest (spiders climb, endermen teleport, cubes leap): not judged,
    // so in the way.
    inWay.push(t);
  }
  return { inWay, apart, points };
}

// The ones about but not in the way, said.
function apartSays(apart) {
  if (!apart.length) return '';
  const list = apart.slice(0, 4).map(({ t, why }) => `a ${String(t.entity.name).replaceAll('_', ' ')} ${Math.round(t.distance)} blocks off (${why})`);
  return ` Not in the way out: ${list.join(', ')}.`;
}

module.exports = { wayOut, wayPoints, apartSays, AT_THE_DOOR, FLYER_NEAR };
