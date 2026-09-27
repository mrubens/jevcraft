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
  return bot.findBlocks({ matching: id, maxDistance: distance, count,
    useExtraInfo: b => sourceLava(b) && open(bot.blockAt(b.position.plus(UP))) });
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
    const arrived = await require('./exploration').goToLandmark(bot, task, goal, save, kinds, { navigate, filter: l => l.kind === 'ruined_portal' ? (l.obsidian || 0) > 0 : !l.spent });
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
  const { staircaseResting } = require('./tunneling');
  const open = p => !staircaseResting(goal, p);
  const here = bot.entity.position;
  const nearest = surface.filter(p => open(p.plus(UP))).sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
  // The lake already found comes before a new shaft: chased off by a
  // creeper, the bot stood at its base sixty blocks from its own crust.
  const remembered = works.lastPour && open(at(works.lastPour)) ? at(works.lastPour) : null;
  const deep = [[24, 0], [0, 24], [-24, 0], [0, -24]].map(([dx, dz]) => here.floored().offset(dx, LAVA_DEPTH - here.floored().y, dz)).find(open);
  const dest = spots.find(s => open(s.feet))?.feet || (nearest ? nearest.plus(UP) : remembered || deep);
  if (!dest) { goal.step = { ...step, phase: 'no_lava_way' }; save(); throw new Error('Every way to lava from here is resting: the pools here and the deep lava on all four headings'); }
  goal.step = { ...step, phase: 'reach_lava', target: { ...dest } }; save();
  await resourceTunnelStep(bot, task, goal, save, dest, 'lava', { dig, navigate, within: goal.step });
}

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
    let filled = 0;
    for (const p of inReach) {
      if (countOf(bot, 'lava_bucket') >= target || !countOf(bot, 'bucket')) break;
      try { await fillBucket(bot, task, p, { fluid: 'lava', guard: () => checkThreats(bot) }); filled++; }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
    if (filled) return;
  }
  // Lava whose staircase is resting is not lava to dig toward: mid-215-f
  // saw a pool two blocks below it with no scooping spot a route reached,
  // and every pass dug toward the same resting staircase, was refused at
  // once and asked how to answer the stall; the loop ended the trial
  // (2026-09-27). Resting, it counts as no lava here, and the other pools
  // known (or the deep lava) are the way while it rests.
  const { staircaseResting } = require('./tunneling');
  const open = p => !staircaseResting(goal, p);
  const diggable = surface.filter(p => open(p.plus(UP)));
  if (!diggable.length) {
    const arrived = await require('./exploration').goToLandmark(bot, task, goal, save, ['lava_pool'], { navigate, filter: l => !l.spent && open(new Vec3(l.x, l.y ?? LAVA_DEPTH, l.z)) });
    if (arrived !== null) {
      if (arrived && !poolSurface(bot).length) { arrived.spent = new Date().toISOString(); save(); }
      return;
    }
  }
  const here = bot.entity.position;
  const nearest = diggable.sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
  // The deep lava, the first heading whose staircase is not resting.
  const deep = [[24, 0], [0, 24], [-24, 0], [0, -24]].map(([dx, dz]) => here.floored().offset(dx, LAVA_DEPTH - here.floored().y, dz)).find(open);
  const spot = spots.find(s => open(s.feet))?.feet;
  const dest = spot || (nearest ? nearest.plus(UP) : deep);
  if (!dest) { goal.step = { ...step, phase: 'no_lava_way' }; save(); throw new Error('Every way to lava from here is resting: the pool here and the deep lava on all four headings'); }
  goal.step = { ...step, phase: 'reach_lava', target: { ...dest } }; save();
  await resourceTunnelStep(bot, task, goal, save, dest, 'lava', { dig, navigate, within: goal.step });
}

module.exports = { makeObsidian, collectLava, poolSurface, pourSpots, safeCrust, pour, sourceLava, LAVA_DEPTH, CONVERSION_MS, REACH };
