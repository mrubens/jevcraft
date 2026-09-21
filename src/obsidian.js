'use strict';
// Obsidian without a lucky find. Natural obsidian is rare in the Overworld,
// but a bucket of water emptied on the shore of a lava pool turns every lava
// source the flow reaches into obsidian. Code finds the pool, the dry block to
// pour from and the crust blocks that are safe to open; the diamond pickaxe
// and the water bucket come from the ordinary plan like any other tool.
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { countOf, surveyRoute } = require('./skills');
const { dryStanding } = require('./mining-access');
const { fillWaterBucket } = require('./water');
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
  works.unreachable ||= {};
  const crust = safeCrust(bot, origin, { distance: works.lastPour ? 12 : 32 }).filter(p => !(works.unreachable[`${p}`] > Date.now() - 300000));
  if (crust.length) {
    for (const p of crust.slice(0, 8)) {
      if (!wanted()) return;
      task.check(); checkAir(bot); checkThreats(bot);
      const before = countOf(bot, 'obsidian');
      goal.step = { ...step, phase: 'mine', position: { ...p } }; save();
      try { await approachDryMining(bot, task, p, { navigate, dig }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; works.unreachable[`${p}`] = Date.now(); save(); continue; }
      await dig(bot, task, p, { done: () => countOf(bot, 'obsidian') > before, requiredTool: 'diamond_pickaxe' });
      await collectNearbyDrops(bot, task, 'obsidian', { before, origin: p, radius: 6, waitForSpawnMs: 1000, allowExcavation: true });
    }
    if (crust.some(p => !(works.unreachable[`${p}`] > Date.now() - 300000))) return;
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
  // No walkable way to a shore: dig toward one, or toward the nearest pool,
  // or down to where the lava lakes are. The staircase stops short of any
  // liquid it would expose and backs out to try another approach.
  const here = bot.entity.position;
  const nearest = surface.sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
  // The lake already found comes before a new shaft: chased off by a
  // creeper, the bot stood at its base sixty blocks from its own crust.
  const remembered = works.lastPour && at(works.lastPour);
  const dest = spots[0]?.feet || (nearest ? nearest.plus(UP) : remembered || here.floored().offset(24, LAVA_DEPTH - here.floored().y, 0));
  goal.step = { ...step, phase: 'reach_lava', target: { ...dest } }; save();
  await resourceTunnelStep(bot, task, goal, save, dest, 'lava', { dig, navigate });
}

module.exports = { makeObsidian, poolSurface, pourSpots, safeCrust, pour, sourceLava, LAVA_DEPTH };
