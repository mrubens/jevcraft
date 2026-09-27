'use strict';
const { setAside, isSetAside } = require('./progress');
// Obsidian without a lucky find. Natural obsidian is rare in the Overworld,
// but a bucket of water emptied on the shore of a lava pool turns every lava
// source the flow reaches into obsidian. Code finds the pool, the dry block to
// pour from and the crust blocks that are safe to open; the diamond pickaxe
// and the water bucket come from the ordinary plan like any other tool.
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { countOf, surveyRoute } = require('./skills');
const { dryStanding } = require('./mining-access');
const { fillWaterBucket, fillBucket } = require('./water');
const { checkThreats, safeFromHostiles, threats } = require('./danger');
const { checkAir } = require('./vitals');
const { makeRoom } = require('./inventory-tidy');

const SIDES = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const UP = new Vec3(0, 1, 0), DOWN = new Vec3(0, -1, 0);
// Water spreads seven blocks over a level surface before it runs out.
const FLOW = 7;
// Below this the 1.18+ aquifers are lava: the depth to dig toward when no
// pool is loaded anywhere near.
const LAVA_DEPTH = -56;
const CONVERSION_MS = 3000;
// A survival player's block interaction range.
const REACH = 4.5;
const sourceLava = b => b?.name === 'lava' && Number(b.getProperties?.().level ?? b.metadata ?? 0) === 0;
const open = b => !b || ['air', 'cave_air', 'void_air'].includes(b.name);
const solid = b => b?.boundingBox === 'block';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const at = p => new Vec3(p.x, p.y, p.z);

// Lava sources with open air above them: the surface of a pool, where the
// flow from the shore can reach.
function poolSurface(bot, { distance = 48, count = 256 } = {}) {
  const id = bot.registry.blocksByName.lava?.id;
  if (id === undefined) return [];
  const { inQuietZone } = require('./sculk');
  return bot.findBlocks({ matching: id, maxDistance: distance, count,
    useExtraInfo: b => sourceLava(b) && open(bot.blockAt(b.position.plus(UP))) }).filter(p => !inQuietZone(bot._goal, p));
}

// Shore blocks: solid, at pool level, beside a surface source, with room to
// stand on. Ranked by how many sources a bucket emptied at the feet reaches.
function pourSpots(bot, surface, { limit = 8 } = {}) {
  const spots = new Map();
  for (const p of surface) for (const side of SIDES) {
    const shore = p.plus(side), feet = shore.plus(UP), key = `${shore}`;
    if (spots.has(key) || !solid(bot.blockAt(shore)) || !open(bot.blockAt(feet)) || !open(bot.blockAt(feet.plus(UP)))) continue;
    if (!dryStanding(bot, feet) || !safeFromHostiles(bot, feet.offset(0.5, 0, 0.5))) continue;
    const reach = surface.filter(q => q.y === p.y && Math.abs(q.x - shore.x) + Math.abs(q.z - shore.z) <= FLOW).length;
    spots.set(key, { shore, feet, reach });
  }
  const here = bot.entity.position;
  return [...spots.values()].sort((a, b) => b.reach - a.reach || a.feet.distanceTo(here) - b.feet.distanceTo(here)).slice(0, limit);
}

// Crust blocks safe to open: obsidian with nothing molten beside or beneath,
// so opening one lets no lava in and the drop lands on a floor.
function safeCrust(bot, origin, { distance = 12, count = 64 } = {}) {
  const id = bot.registry.blocksByName.obsidian?.id;
  if (id === undefined) return [];
  return bot.findBlocks({ matching: id, maxDistance: distance, count, point: origin, useExtraInfo: b => {
    const p = b.position;
    return open(bot.blockAt(p.plus(UP))) && solid(bot.blockAt(p.plus(DOWN))) &&
      !SIDES.some(s => bot.blockAt(p.plus(s))?.name === 'lava');
  } });
}

// A filled bucket's ray passes through liquids and empties onto the face it
// hits: aimed at the shore block underfoot, the water lands at the feet and
// spreads out over the pool from there.
async function pour(bot, task, spot, { navigate }) {
  const bucket = bot.inventory.items().find(i => i.name === 'water_bucket');
  if (!bucket) throw new Error('No water bucket to pour');
  const feet = at(spot.feet), shore = at(spot.shore);
  if (!bot.entity.position.floored().equals(feet)) await navigate(bot, task, new goals.GoalBlock(feet.x, feet.y, feet.z), { timeoutMs: 20000, stallMs: 5000 });
  if (!bot.entity.position.floored().equals(feet)) throw new Error('Did not reach the pouring spot');
  if (!SIDES.some(s => sourceLava(bot.blockAt(shore.plus(s))))) throw new Error('The lava beside the pouring spot is gone');
  await bot.equip(bucket, 'hand'); task.check();
  await bot.lookAt(shore.offset(0.5, 0.5, 0.5), true); task.check();
  const before = countOf(bot, 'bucket');
  bot.activateItem();
  try {
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      task.check();
      if (countOf(bot, 'bucket') > before) return;
      await sleep(25);
    }
    throw new Error('No water was poured');
  } finally { bot.deactivateItem(); }
}

async function makeObsidian(bot, task, step, goal, save, actions) {
  const { navigate, dig, approachDryMining, collectNearbyDrops, resourceTunnelStep, acquireStep } = actions;
  task.check(); checkAir(bot); checkThreats(bot);
  // Nothing at the lava's edge with a mob in view: one knockback is the end.
  if (threats(bot).some(t => t.visible && t.distance < 16)) { goal.step = { ...step, phase: 'wait_for_quiet' }; save(); await sleep(1000); return; }
  const works = goal.obsidianWorks ||= { pours: 0 };
  const target = countOf(bot, 'obsidian') + step.count;
  const wanted = () => Math.max(0, target - countOf(bot, 'obsidian'));
  if (!wanted()) return;
  const origin = works.lastPour ? at(works.lastPour) : bot.entity.position;
  // Crust that could not be stood beside is set aside for five minutes, or
  // the step stands at the shore repeating one error and never pours again.
  const crust = safeCrust(bot, origin, { distance: works.lastPour ? 12 : 32 }).filter(p => !isSetAside(goal, 'crust', p));
  if (crust.length) {
    for (const p of crust.slice(0, 8)) {
      if (!wanted()) return;
      task.check(); checkAir(bot); checkThreats(bot);
      const before = countOf(bot, 'obsidian');
      goal.step = { ...step, phase: 'mine', position: { ...p } }; save();
      try { await approachDryMining(bot, task, p, { navigate, dig }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; setAside(goal, 'crust', p, err, 300000); save(); continue; }
      // A dig refused (a pit it would open beside the feet, the ground
      // changed since the crust was chosen) sets that crust aside too: thrown,
      // it went back to the same crust every round, and mid-83-c's audit
      // called the loop at minute 67 (2026-09-25).
      try { await dig(bot, task, p, { done: () => countOf(bot, 'obsidian') > before, requiredTool: 'diamond_pickaxe' }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Blocked'].includes(err.name)) throw err; setAside(goal, 'crust', p, err, 300000); save(); continue; }
      await collectNearbyDrops(bot, task, 'obsidian', { before, origin: p, radius: 6, waitForSpawnMs: 1000, allowExcavation: true });
    }
    if (crust.some(p => !isSetAside(goal, 'crust', p))) return;
  }
  if (!countOf(bot, 'water_bucket')) { await acquireStep(bot, task, 'water_bucket', 1, goal, save); return; }
  const surface = poolSurface(bot);
  const spots = pourSpots(bot, surface);
  for (const spot of spots) {
    task.check();
    const destination = new goals.GoalBlock(spot.feet.x, spot.feet.y, spot.feet.z);
    const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, 500);
    if (route.status !== 'success') continue;
    goal.step = { ...step, phase: 'pour', position: { ...spot.feet }, reach: spot.reach }; save();
    await pour(bot, task, spot, { navigate });
    works.pours++; works.lastPour = { ...spot.feet }; save();
    await sleep(CONVERSION_MS);
    // The source stays at the feet; take it back for the next pool. The
    // outflow shoves the bot a few blocks over the new crust first, so walk
    // back. A bucket lost to a current is refilled by the plan; the crust is
    // what matters.
    try {
      const feet = at(spot.feet);
      if (bot.entity.position.distanceTo(feet.offset(0.5, 0, 0.5)) > 2) await navigate(bot, task, new goals.GoalBlock(feet.x, feet.y, feet.z), { timeoutMs: 10000, stallMs: 3000 });
      await fillWaterBucket(bot, task, feet, { guard: () => checkThreats(bot) });
    } catch (err) { task.check(); works.lastScoopError = err.message; save(); }
    return;
  }
  // Nothing here: a ruined portal remembered (its frame is obsidian to
  // mine, often with gold beside it) or a surface lava pool remembered
  // (exploration.js), before any shaft. A ruined portal only while there is
  // a pickaxe that can take obsidian.
  if (!surface.length) {
    const diamond = bot.inventory.items().some(i => /^(diamond|netherite)_pickaxe$/.test(i.name));
    const kinds = diamond ? ['ruined_portal', 'lava_pool'] : ['lava_pool'];
    const arrived = await require('./exploration').goToLandmark(bot, task, goal, save, kinds, { navigate, filter: l => l.kind === 'ruined_portal' ? (l.obsidian || 0) > 0 : !l.spent && !require('./tunneling').lavaResting(goal, new Vec3(l.x, l.y ?? LAVA_DEPTH, l.z)) });
    if (arrived !== null) {
      if (!arrived) return;
      goal.step = { ...step, phase: 'at_landmark', kind: arrived.kind }; save();
      // At a lava pool with no lava surface to pour on from here: it is
      // spent (poured over already, or its lava not a pool to stand beside),
      // or the step arrives at it again at once, every pass: mid-110-o "made
      // obsidian" twenty-one times a second there (2026-09-26).
      if (arrived.kind === 'lava_pool' && !poolSurface(bot).length) { arrived.spent = new Date().toISOString(); save(); return; }
      // At a ruined portal: its frame is the obsidian, mined where it
      // stands. Only crust was mined here before, and a frame is not crust
      // (air under it, often), so mid-79-d stood at one and "made obsidian"
      // 673 times in two minutes, none of it mined (2026-09-26).
      if (arrived.kind === 'ruined_portal') {
        const id = bot.registry.blocksByName.obsidian?.id;
        const frame = (id === undefined ? [] : bot.findBlocks({ matching: id, maxDistance: 16, count: 32 }))
          // Not the frame being finished: a ruin chosen for the portal is
          // not also the quarry for it.
          .filter(p => !isSetAside(goal, 'crust', p) && !require('./build-sites').reservedForConstruction(goal, p)).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
        if (!frame.length) { arrived.obsidian = 0; save(); return; }
        for (const p of frame.slice(0, 4)) {
          if (!wanted()) return;
          task.check(); checkAir(bot); checkThreats(bot);
          const before = countOf(bot, 'obsidian');
          goal.step = { ...step, phase: 'mine_portal', position: { ...p } }; save();
          try { await approachDryMining(bot, task, p, { navigate, dig }); await dig(bot, task, p, { done: () => countOf(bot, 'obsidian') > before, requiredTool: 'diamond_pickaxe' }); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled', 'Blocked'].includes(err.name)) throw err; setAside(goal, 'crust', p, err, 300000); save(); continue; }
          await collectNearbyDrops(bot, task, 'obsidian', { before, origin: p, radius: 6, waitForSpawnMs: 1000, allowExcavation: true });
        }
      }
      return;
    }
  }
  // No walkable way to a shore: dig toward one, or toward the nearest pool,
  // or down to where the lava lakes are. The staircase stops short of any
  // liquid it would expose and backs out to try another approach.
  // Not toward lava whose staircase is resting, as collectLava below:
  // mid-230-i dug for the same lava thirteen passes running, each refused
  // at once for the drop it would open, until the loop watch ended the
  // trial (2026-09-27).
  const { staircaseResting, lavaResting, lavaWay } = require('./tunneling');
  const open = p => !staircaseResting(goal, p);
  const here = bot.entity.position;
  const nearest = surface.filter(p => !lavaResting(goal, p)).sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
  // The lake already found comes before a new shaft: chased off by a
  // creeper, the bot stood at its base sixty blocks from its own crust.
  const remembered = works.lastPour && open(at(works.lastPour)) ? at(works.lastPour) : null;
  const deep = require('./tunneling').descentTargets(here.floored(), LAVA_DEPTH).find(open);
  const dest = spots.find(s => open(s.feet))?.feet || (nearest ? lavaWay(nearest) : remembered || deep);
  if (!dest) { goal.step = { ...step, phase: 'no_lava_way' }; save(); throw noLavaWay(bot, goal, surface); }
  goal.step = { ...step, phase: 'reach_lava', target: { ...dest } }; save();
  await resourceTunnelStep(bot, task, goal, save, dest, 'lava', { dig, navigate, within: goal.step });
}

// Where lava fetched now is carried: the frame being cast, in the Overworld
// where it stands; none otherwise.
function castTo(bot, goal) {
  const frame = goal?.portalFrame;
  if (!frame?.cast || frame.ruin || !frame.origin || /nether|end/.test(String(bot.game?.dimension || ''))) return null;
  return at(frame.origin);
}
// The seconds of a carry: the walk to the lava and on to where it goes, at
// a walk's four blocks a second, and a staircase of three seconds a block
// of height where a leg rises or falls more than eight (surface.js
// climbMinutes, portal-cast.js lavaTrip).
const legSeconds = (a, b) => a.distanceTo(b) / 4.3 + (Math.abs(a.y - b.y) > 8 ? Math.abs(a.y - b.y) * 3 : 0);
const carrySeconds = (here, lava, to) => legSeconds(here, lava) + (to ? legSeconds(lava, to) : 0);

// Lava in buckets, for a portal frame cast in place (portal-cast.js): from
// dry ground at a pool's edge, the same shore a pour of water is made from,
// an empty bucket used on each surface source in reach. The feet are a block
// above the pool, so no lava taken from beside them can flow up to them;
// the bot never steps into it. A pool the bot cannot stand beside is gone
// round as the obsidian step goes round it: a remembered lava pool, then a
// dig toward lava.
async function collectLava(bot, task, step, goal, save, { navigate, dig, resourceTunnelStep }) {
  task.check(); checkAir(bot); checkThreats(bot);
  if (threats(bot).some(t => t.visible && t.distance < 16)) { goal.step = { ...step, phase: 'wait_for_quiet' }; save(); await sleep(1000); return; }
  const target = countOf(bot, 'lava_bucket') + (step.count || 1);
  const surface = poolSurface(bot);
  const { staircaseResting, lavaResting, lavaWay, descentTargets } = require('./tunneling');
  // Lava for a cast frame is carried to the frame: the lava fetched is the
  // one whose carry is shortest, here to the lava and on to the frame, as
  // the trips Jev chose the cast by are measured (portal-cast.js lavaTrip).
  // By its distance from the bot alone, mid-230-u, back from a food trip
  // 130 blocks from its frame with a pool twenty blocks beside the frame,
  // went for pools 350 and 460 blocks off and then dug to the deep lava
  // below where it stood, 135 blocks down: forty minutes for one bucket
  // (note 524).
  const to = castTo(bot, goal), here = bot.entity.position;
  const carry = p => carrySeconds(here, p, to);
  const deep = descentTargets(here.floored(), LAVA_DEPTH).find(p => !staircaseResting(goal, p));
  const landmarkAt = l => new Vec3(l.x, l.y ?? LAVA_DEPTH, l.z);
  const pool = l => !l.spent && !lavaResting(goal, landmarkAt(l));
  if (to) {
    // Known lava that is a shorter carry than any in sight and the deep lava
    // below: walked to first, the nearest carry first. Not the pool in sight
    // itself, remembered: that one is scooped below.
    const bound = Math.min(surface.length ? Math.min(...surface.map(carry)) : Infinity, deep ? carry(deep) : Infinity);
    const shorter = l => pool(l) && carry(landmarkAt(l)) < bound && !surface.some(p => Math.hypot(p.x - l.x, p.z - l.z) <= 16);
    if ((goal.landmarks || []).some(l => l.kind === 'lava_pool' && shorter(l))) {
      const arrived = await require('./exploration').goToLandmark(bot, task, goal, save, ['lava_pool'], { navigate, filter: shorter, cost: l => carry(landmarkAt(l)) });
      if (arrived === false) return;
      // Arrived and no lava in sight there: that pool is spent.
      if (arrived && !poolSurface(bot).length) { arrived.spent = new Date().toISOString(); save(); return; }
    }
  }
  const spots = pourSpots(bot, surface);
  for (const spot of spots) {
    task.check();
    const destination = new goals.GoalBlock(spot.feet.x, spot.feet.y, spot.feet.z);
    const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, 500);
    if (route.status !== 'success') continue;
    goal.step = { ...step, phase: 'scoop', position: { ...spot.feet } }; save();
    if (!bot.entity.position.floored().equals(spot.feet)) await navigate(bot, task, destination, { timeoutMs: 20000, stallMs: 5000 });
    if (!bot.entity.position.floored().equals(spot.feet)) continue;
    const eye = bot.entity.position.offset(0, 1.62, 0);
    const inReach = surface.filter(p => sourceLava(bot.blockAt(p)) && eye.distanceTo(p.offset(0.5, 0.5, 0.5)) <= REACH)
      .sort((a, b) => eye.distanceTo(a) - eye.distanceTo(b));
    // A lava bucket does not stack: filled from a stack of empties with no
    // free slot, the game drops it at the feet, beside the lava. mid-244-v
    // filled nine with all thirty-six slots full and kept one (note 470).
    // Room is made before each fill (Jev choosing what goes, inventory-
    // tidy.js makeRoom), and no fill is made without it: the last empty
    // bucket of a stack fills in its own slot.
    const room = () => (bot.inventory.emptySlotCount?.() ?? 1) > 0 || bot.inventory.items().find(i => i.name === 'bucket')?.count === 1;
    let filled = 0, noRoom = false;
    for (const p of inReach) {
      if (countOf(bot, 'lava_bucket') >= target || !countOf(bot, 'bucket')) break;
      if (!room()) {
        const wanted = Math.min(target - countOf(bot, 'lava_bucket'), countOf(bot, 'bucket'));
        await makeRoom(bot, task, 'lava_bucket', { goal, away: p, keep: new Set(['bucket', 'lava_bucket', 'water_bucket']),
          purpose: `lava for the portal frame (${wanted} more bucket${wanted === 1 ? '' : 's'} to fill here, each a slot of its own)` });
        if (!room()) { noRoom = true; break; }
      }
      try { await fillBucket(bot, task, p, { fluid: 'lava', guard: () => checkThreats(bot) }); filled++; }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
    if (filled) return;
    if (noRoom) { goal.step = { ...step, phase: 'no_room' }; save(); throw new Error('No room in my pockets for a lava bucket: each takes a slot of its own, and nothing was dropped for one'); }
  }
  // Lava whose staircase is resting is not lava to dig toward: mid-215-f
  // saw a pool two blocks below it with no scooping spot a route reached,
  // and every pass dug toward the same resting staircase, was refused at
  // once and asked how to answer the stall; the loop ended the trial
  // (2026-09-27). Resting, it counts as no lava here, and the other pools
  // known (or the deep lava) are the way while it rests.
  const open = p => !staircaseResting(goal, p);
  const diggable = surface.filter(p => !lavaResting(goal, p));
  if (!diggable.length) {
    // For a cast, not a pool farther to carry from than the deep lava.
    const filter = to ? l => pool(l) && !(deep && carry(landmarkAt(l)) >= carry(deep)) : pool;
    const arrived = await require('./exploration').goToLandmark(bot, task, goal, save, ['lava_pool'], { navigate, filter, ...(to ? { cost: l => carry(landmarkAt(l)) } : {}) });
    // On the way, or at a pool found dry. At one still holding lava, whose
    // every way rests, it is not done: the other ways below are.
    if (arrived === false) return;
    if (arrived && !poolSurface(bot).length) { arrived.spent = new Date().toISOString(); save(); return; }
  }
  const nearest = diggable.sort((a, b) => to ? carry(a) - carry(b) : a.distanceTo(here) - b.distanceTo(here))[0];
  // The deep lava is the first heading whose staircase is not resting.
  const spot = spots.find(s => open(s.feet))?.feet;
  const dest = spot || (nearest ? lavaWay(nearest) : deep);
  if (!dest) { goal.step = { ...step, phase: 'no_lava_way' }; save(); throw noLavaWay(bot, goal, surface); }
  goal.step = { ...step, phase: 'reach_lava', target: { ...dest } }; save();
  await resourceTunnelStep(bot, task, goal, save, dest, 'lava', { dig, navigate, within: goal.step });
}

// Every way to lava resting, as the fact Jev is given: the lava known, how
// long until a way into it opens, and why it rests. A step that arrived
// and did nothing said none of this: mid-229-m (tunneling.js lavaResting).
function noLavaWay(bot, goal, surface = []) {
  const { lavaWay, staircaseUntil, staircaseWhy, WaysResting } = require('./tunneling');
  const here = bot.entity.position, now = Date.now();
  const pools = require('./exploration').knownLandmarks(bot, goal, 'lava_pool').filter(k => !k.landmark.spent)
    .map(k => new Vec3(k.landmark.x, k.landmark.y ?? LAVA_DEPTH, k.landmark.z));
  const seen = surface.slice().sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
  if (seen && !pools.some(p => p.distanceTo(seen) <= 16)) pools.unshift(seen);
  // A pool's ways are its own cell and those of the lava in sight about it.
  const ways = pool => [pool, ...surface.filter(p => p.distanceTo(pool) <= 16)].map(lavaWay);
  const soonest = targets => Math.min(...targets.map(t => staircaseUntil(goal, t)).filter(u => u > now));
  const minutes = until => Number.isFinite(until) ? Math.max(1, Math.ceil((until - now) / 60000)) : null;
  const at = p => `(${p.x}, ${p.y}, ${p.z})`;
  const poolUntil = pools.length ? soonest(pools.flatMap(ways)) : Infinity;
  const deepUntil = soonest(require('./tunneling').descentTargets(here.floored(), LAVA_DEPTH));
  const rests = until => minutes(until) ? `for ${minutes(until)} more minute${minutes(until) === 1 ? '' : 's'}` : 'for now';
  const known = !pools.length ? 'No lava pool is known here'
    : pools.length === 1 ? `The pool at ${at(pools[0])} is the only lava known; every way into it rests ${rests(poolUntil)} (${staircaseWhy(goal, lavaWay(pools[0]))})`
    : `The ${pools.length} pools known, at ${pools.slice(0, 4).map(at).join(', ')}, are the lava known; every way into them rests, the first to open ${rests(poolUntil)}`;
  return new WaysResting(`${known}, and the deep lava on all sixteen headings near and far rests ${rests(deepUntil)}`, Math.min(poolUntil, deepUntil));
}

module.exports = { makeObsidian, collectLava, poolSurface, pourSpots, safeCrust, pour, sourceLava, LAVA_DEPTH, CONVERSION_MS, REACH };
