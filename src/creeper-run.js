'use strict';
// A run from a creeper, by the game's rules (note 604). Read from the 26.1.2
// server jar: SwellGoal runs while the creeper is lit (swellDir above 0) or
// its target is within three blocks (distanceToSqr under 9, feet to feet),
// stops its navigation and holds the move, so within three, or lit, it
// stands where it is; each tick it burns the fuse on (+1) while the target is
// within seven (distanceToSqr at most 49) and in its sight (one ray from its
// eyes to the target's that any block with a collision shape stops), and
// burns it back down otherwise (-1, never below none); lit past seven and
// three, the goal ends and the melee goal walks it on at 2.7 blocks a second
// (movement 0.25, the chase modifier 1). Thirty ticks of burning and it goes
// off where it stands: the blast is measured from its feet to the target's
// (ServerExplosion.hurtEntities, radius twice the power of 3), nothing at six
// blocks or more.
//
// So a run from one within three blocks, or lit, opens the gap only if the
// way it takes is past seven blocks from where the creeper stands, or out of
// its sight, before thirty ticks of burning: a way that runs sideways, or
// comes back past it, or drops into its sight beside it, does not.
// mid-242-af-nether-3-fortress-1 (25586, 12:08:10 to 17) ran from a creeper
// under its bridge twice, each way told "passing none of them" with no word
// of the fuse: the first went along the bridge, down to the creeper's floor
// and back west past where it stood; the second dropped from the bridge to
// the floor 0.6 blocks from it, in its sight, and it went off three blocks
// off, 6.9 to none. mid-242-af-nether-2-fortress-2 (25583, 12:06:55) took a
// run with no way found yet, "the rest tried before it moves, up to about 3
// seconds standing still", while a creeper 6 blocks off walked up and went
// off 2.8 blocks off, 6.5 to none.
//
// Here the way is walked in time, a tick at a time, the bot at the pace its
// runs have kept and the creeper by the rules above, coming straight on while
// it walks: where and when the bot is past seven, or out of its sight, or
// where the creeper goes off and what that costs.
const { Vec3 } = require('vec3');
const { FUSE, FUSE_KEPT, LIGHTS_AT, BLAST_CLEAR, blocksPerSecond, creeperBlast, afterArmour } = require('./combat-estimate');
const { lineCells, eyeOf, EYE } = require('./creeper-sight');

// The pace of the bot's own runs in their first seconds: the median
// straight-line distance from where the retreat was answered, over 538 runs
// with a way found in the flight records of 2026-09-26 to 28, was 3.8 blocks
// at one second, 5.8 at one and a half and 8 at two (the quartiles 4.8 and
// 6.8 at one and a half); the price of a run takes 5.6, the sprint's top
// speed, which it does not reach from a standstill round turns and drops.
const RUN_PACE = 3.9, RUN_SLOW = 3.2;
const TICK = 0.05, SWELL_TICKS = Math.round(FUSE / TICK);
const r1 = n => Math.round(n * 10) / 10;

// Whether the creeper at `at` sees a player whose feet are at `feet`: one ray
// from its eyes to the player's, stopped by any block with a collision shape.
// `dug` is the cells (as `${Vec3}`) taken as open, dug by the time.
function seesAt(bot, creeper, at, feet, { dug = null } = {}) {
  const from = at.offset(0, eyeOf(creeper), 0), to = feet.offset(0, EYE.player, 0);
  return !lineCells(from, to).some(c => !dug?.has(`${c.cell}`) && bot.blockAt(c.cell)?.boundingBox === 'block');
}

// The way as the feet go along it, from `from` through each step's middle:
// [{ at, t }], at RUN_PACE along its length.
function timedWay(from, path, pace = RUN_PACE) {
  const middle = p => Number.isInteger(p.x) && Number.isInteger(p.z) ? new Vec3(p.x + 0.5, p.y, p.z + 0.5) : new Vec3(p.x, p.y, p.z);
  const points = [from.clone(), ...(path || []).map(middle)];
  const out = [{ at: points[0], t: 0 }];
  let t = 0;
  for (let i = 1; i < points.length; i++) { t += points[i].distanceTo(points[i - 1]) / pace; out.push({ at: points[i], t }); }
  return out;
}
function feetAt(way, t) {
  if (t >= way.at(-1).t) return way.at(-1).at;
  for (let i = 1; i < way.length; i++) {
    if (way[i].t < t) continue;
    const a = way[i - 1], b = way[i], k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 1;
    return a.at.plus(b.at.minus(a.at).scaled(k));
  }
  return way.at(-1).at;
}

// One creeper against the bot going along `way` (timedWay), from now until
// the fuse it could light before the way ends has burned out. `litFor` is
// the seconds it has been lit (undefined when not). The creeper while it
// walks comes straight at the bot's feet on its own level, at its speed.
// { goesOff, t, distance, blast, lights } when it goes off; otherwise
// { goesOff: false, lights, clearAt, why: 'seven' | 'sight' | null, nearest }.
function creeperOnWay(bot, creeper, way, { litFor, until = null } = {}) {
  const speed = blocksPerSecond('creeper') * TICK;
  let at = creeper.position.clone();
  let swell = Number.isFinite(litFor) ? Math.min(SWELL_TICKS - 1, Math.round(litFor / TICK)) : 0, burning = Number.isFinite(litFor);
  let lights = burning ? 0 : null, clearAt = null, why = null, nearest = Infinity;
  const end = (until ?? way.at(-1).t + FUSE) + TICK;
  for (let t = 0; t <= end; t += TICK) {
    const feet = feetAt(way, t), d = at.distanceTo(feet);
    nearest = Math.min(nearest, d);
    if (burning || d < LIGHTS_AT) {
      if (d <= FUSE_KEPT && seesAt(bot, creeper, at, feet)) {
        if (lights == null) lights = t;
        burning = true; swell++;
        clearAt = null; why = null;
        if (swell >= SWELL_TICKS) return { goesOff: true, t: r1(t), distance: r1(d), blast: creeperBlast(d), lights: r1(lights) };
      } else {
        if (burning && clearAt == null) { clearAt = t; why = d > FUSE_KEPT ? 'seven' : 'sight'; }
        burning = false; swell = Math.max(0, swell - 1);
      }
    } else {
      // Its walk: on its own level, straight at the bot's feet, sliding
      // along a wall as a body does (each way alone where both are shut).
      const flat = new Vec3(feet.x - at.x, 0, feet.z - at.z), len = flat.norm();
      if (len > 1e-6) {
        const step = flat.scaled(Math.min(speed, len) / len);
        const free = p => [0, 1].every(dy => bot.blockAt(p.offset(0, dy, 0))?.boundingBox !== 'block');
        at = [step, new Vec3(step.x, 0, 0), new Vec3(0, 0, step.z)].map(s => at.plus(s)).find(free) || at;
      }
    }
  }
  return { goesOff: false, lights: lights == null ? null : r1(lights), clearAt: clearAt == null ? null : r1(clearAt), why, nearest: r1(nearest) };
}

// Every creeper that matters to a run: within ten blocks, or lit.
function creepersFor(bot, danger, litForOf = () => undefined) {
  return (danger || []).filter(t => t.entity?.name === 'creeper' && t.entity.position && (t.distance <= FUSE_KEPT + 3 || Number.isFinite(litForOf(t.entity))))
    .map(t => ({ entity: t.entity, distance: t.distance, litFor: litForOf(t.entity) }));
}

// The way against each creeper; the worst first (one that goes off, the
// biggest blast; else the latest clear). { worst, each } or null.
// With `slow`, the same way at the slower quarter of the bot's runs.
function wayAgainstCreepers(bot, path, creepers, { from = bot.entity.position, pace = RUN_PACE, slow = true } = {}) {
  if (!creepers?.length) return null;
  const worstOf = pace => {
    const way = timedWay(from, path, pace);
    const each = creepers.map(c => ({ creeper: c, ...creeperOnWay(bot, c.entity, way, { litFor: c.litFor }) }));
    each.sort((a, b) => (b.goesOff - a.goesOff) || ((b.blast || 0) - (a.blast || 0)) || ((b.clearAt ?? -1) - (a.clearAt ?? -1)));
    return each;
  };
  const each = worstOf(pace);
  return { worst: each[0], each, ...(slow ? { slow: worstOf(RUN_SLOW)[0] } : {}) };
}

// Standing still `seconds` where the bot is (a route search made before
// the run moves): the first creeper that goes off meanwhile, or lights.
function standingAgainstCreepers(bot, creepers, seconds) {
  if (!creepers?.length) return null;
  const here = bot.entity.position.clone(), way = [{ at: here, t: 0 }, { at: here, t: seconds }];
  const each = creepers.map(c => ({ creeper: c, ...creeperOnWay(bot, c.entity, way, { litFor: c.litFor, until: seconds }) }));
  each.sort((a, b) => (b.goesOff - a.goesOff) || ((a.lights ?? Infinity) - (b.lights ?? Infinity)));
  return { worst: each[0], each };
}

// A way's creeper said, the rule with it, and what it costs after `worn`.
function creeperRunSays(result, { worn = { points: 0, toughness: 0 }, health = 20, standing = false } = {}) {
  if (!result) return { says: '', damage: 0 };
  const w = result.worst, c = w.creeper, name = `the creeper ${Math.round(c.distance)} blocks off`;
  const state = Number.isFinite(c.litFor) ? `${name}, lit now,` : c.distance < LIGHTS_AT ? `${name}, within three of the bot now,` : name;
  const rule = `A creeper within ${LIGHTS_AT} blocks, or lit, stands where it is, and its fuse burns while the bot is within ${FUSE_KEPT} blocks of it and in its sight, going off after ${FUSE} seconds of burning; past ${FUSE_KEPT} or out of its sight it burns back down, and past ${LIGHTS_AT} it walks after the bot at about ${r1(blocksPerSecond('creeper'))} blocks a second.`;
  const pace = `at the pace the bot's runs keep in their first seconds (about ${RUN_PACE} blocks a second along the way on the median; one run in four is slower than ${RUN_SLOW})`;
  if (w.goesOff) {
    const hit = r1(afterArmour(w.blast, worn));
    const where = w.distance >= BLAST_CLEAR ? `about ${w.distance} blocks from it, where the blast does nothing` : `about ${w.distance} blocks from it and in its sight, about ${Math.round(hit)} after the armour worn${hit >= health ? ', more than the bot has' : ''}`;
    const lit = w.lights > 0 ? ` lights about ${w.lights} seconds ${standing ? 'from now' : 'in'}, and` : '';
    const says = standing
      ? ` Standing still meanwhile, ${state}${lit} goes off about ${w.t} seconds from now with the bot ${where}.`
      : ` On this way, ${pace}, ${state}${lit} goes off about ${w.t} seconds in with the bot ${where}.${slowSays(result.slow, w, worn)} ${rule}`;
    return { says, damage: w.distance >= BLAST_CLEAR ? 0 : hit };
  }
  if (standing) return { says: w.lights != null ? ` Standing still meanwhile, ${state} lights about ${w.lights} seconds from now: from then the run has ${FUSE} seconds to be past ${FUSE_KEPT} blocks from it or out of its sight.` : '', damage: 0 };
  if (w.lights == null) return { says: w.nearest < LIGHTS_AT + 2 ? ` On this way, ${pace}, ${name} is ${w.nearest.toFixed(1)} blocks off at its nearest, or out of its sight while within ${LIGHTS_AT}, and does not light.` : '', damage: 0 };
  const clear = w.why === 'seven' ? `more than ${FUSE_KEPT} blocks from it` : 'out of its sight';
  return { says: ` On this way, ${pace}, ${state}${w.lights > 0 ? ` lights about ${w.lights} seconds in and` : ''} the bot is ${clear} about ${w.clearAt} seconds in, before its fuse ends: it burns back down.${slowSays(result.slow, w, worn)} ${rule}`, damage: 0 };
}
// The slower quarter of runs, said where it ends worse than the median.
function slowSays(slow, w, worn) {
  if (!slow?.goesOff || slow.distance >= BLAST_CLEAR || (w.goesOff && slow.blast <= w.blast) || Math.round(afterArmour(slow.blast, worn)) < 1) return '';
  return ` At the slower quarter's pace (${RUN_SLOW} blocks a second) it goes off with the bot about ${slow.distance} blocks from it, about ${Math.round(afterArmour(slow.blast, worn))} after the armour worn.`;
}

// A step's cost near a creeper, for the route search (the pathfinder's
// exclusionAreasStep): the nearer the cell to where it stands, inside seven
// blocks, the dearer, so a way out goes away from it before it goes round.
function creeperSteer(creepers) {
  const at = (creepers || []).map(c => c.entity.position.clone());
  if (!at.length) return null;
  return block => {
    const p = block?.position;
    if (!p) return 0;
    const middle = new Vec3(p.x + 0.5, p.y, p.z + 0.5);
    return at.reduce((cost, c) => { const d = c.distanceTo(middle); return cost + (d < FUSE_KEPT ? (FUSE_KEPT - d) * 2 : 0); }, 0);
  };
}

module.exports = { RUN_PACE, RUN_SLOW, seesAt, timedWay, creeperOnWay, creepersFor, wayAgainstCreepers, standingAgainstCreepers, creeperRunSays, creeperSteer };
