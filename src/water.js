'use strict';
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { countOf, surveyRoute } = require('./skills');
const { dryMiningPositions, miningReach, miningMovement, dryStanding } = require('./mining-access');
const { checkThreats } = require('./danger');
const { checkAir } = require('./vitals');
const sourceOf = fluid => b => b?.name === fluid && Number(b.getProperties?.().level ?? b.metadata ?? 0) === 0;
const sourceWater = sourceOf('water');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// An empty bucket used on a source: water, or lava for a portal frame cast
// in place (portal-cast.js). The same aim and the same confirmation either
// way: the bucket count changes or nothing happened.
async function fillBucket(bot, task, position, { fluid = 'water', timeoutMs = 2500, guard = () => {} } = {}) {
  const check = () => { task.check(); checkAir(bot); guard(); };
  const source = sourceOf(fluid), full = `${fluid}_bucket`;
  check();
  if (!source(bot.blockAt(position))) throw new Error(`Bucket filling requires an observed ${fluid} source`);
  const bucket = bot.inventory.items().find(i => i.name === 'bucket');
  if (!bucket) throw new Error('No empty bucket to fill');
  const before = countOf(bot, full), emptyBefore = countOf(bot, 'bucket');
  await bot.equip(bucket, 'hand'); check();
  const checkReach = () => {
    const eye = bot.entity.position.offset(0, 1.62, 0), delta = position.offset(.5, .5, .5).minus(eye);
    const hit = bot.world.raycast(eye, delta.unit(), delta.norm());
    if (delta.norm() > 4.5 || hit && eye.distanceTo(hit.intersect || hit.position) < delta.norm() - .1) throw new Error(`${fluid[0].toUpperCase()}${fluid.slice(1)} source is outside visible interaction reach`);
  };
  checkReach();
  // Bucket use carries its rotation in use_item. Waiting for a smooth turn
  // lets a flowing current move the player away from the calculated aim.
  // Aim immediately from the current position, as in the falling placement.
  await bot.lookAt(position.offset(.5, .5, .5), true); check();
  checkReach();
  if (!source(bot.blockAt(position))) throw new Error(`${fluid[0].toUpperCase()}${fluid.slice(1)} source changed before filling the bucket`);
  bot.activateItem();
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      check();
      if (countOf(bot, full) === before + 1 && countOf(bot, 'bucket') === emptyBefore - 1) return;
      await sleep(25);
    }
    throw new Error(`No ${fluid}-bucket inventory conversion was confirmed`);
  } finally { bot.deactivateItem(); }
}
const fillWaterBucket = (bot, task, position, options = {}) => fillBucket(bot, task, position, { ...options, fluid: 'water' });

async function collectWater(bot, task, goal, save, { navigate, explore }) {
  task.check(); checkAir(bot); checkThreats(bot);
  // The base's pond first: it is a known source within reach, and a search
  // for any water walked the bot a hundred blocks from its bed at dusk.
  const home = goal.survival?.home;
  if (home?.water && !bot.findBlocks({ matching: bot.registry.blocksByName.water.id, maxDistance: 16, count: 1, useExtraInfo: sourceWater }).length) {
    const w = new Vec3(home.water.x, home.water.y, home.water.z);
    if (w.distanceTo(bot.entity.position) <= 128 && (!bot.blockAt(w) || sourceWater(bot.blockAt(w)))) {
      goal.step = { action: 'fill_bucket', position: { ...home.water }, item: 'water_bucket', home: true }; save();
      try { await navigate(bot, task, new goals.GoalNear(w.x, w.y + 1, w.z, 2), { timeoutMs: 60000, stallMs: 8000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
  }
  const sources = bot.findBlocks({ matching: bot.registry.blocksByName.water.id, maxDistance: 48, count: 24, useExtraInfo: sourceWater });
  const movement = miningMovement(bot);
  try {
    for (const p of sources) {
      const positions = dryStanding(bot, bot.entity.position) && miningReach(bot, bot.entity.position, p) ?
        [bot.entity.position.floored(), ...dryMiningPositions(bot, p)] : dryMiningPositions(bot, p);
      for (const q of positions.slice(0, 6)) {
        task.check(); checkThreats(bot);
        const destination = new goals.GoalBlock(q.x, q.y, q.z);
        const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, 250);
        if (route.status !== 'success') continue;
        await navigate(bot, task, destination, { timeoutMs: 10000, stallMs: 3000 });
        await fillWaterBucket(bot, task, p, { guard: () => checkThreats(bot) });
        if (goal.search?.water) goal.search.water.attempts = 0;
        goal.step = { action: 'fill_bucket', position: { ...p }, item: 'water_bucket', confirmed: true }; save(); return;
      }
    }
  } finally { movement.restore(); }
  await explore(bot, task, goal, save, 'water', { surfaceOnly: true });
}

// A biome seen that holds water to fill a bucket at (not a cave's, where it
// is only what the drowned swim in).
const holdsWater = b => !/^(dripstone_caves|lush_caves|deep_dark)$/.test(b.biome) && /^((open|iced) )?water\b|^shallow water|in shallow water/.test(b.has || '');
// Where water is known to be, said for whatever needs a bucket of it (the
// portal cast, portal-cast.js): a source in the loaded ground within
// forty-eight blocks (what collectWater goes to), else the nearest biome seen
// that holds water, else none. mid-243-bd stood an hour on a mountain top
// with lava in nine buckets and no water bucket, told only "none carried",
// with a river seventy-two blocks off in every state it was asked with
// (note 630).
function waterKnown(bot) {
  let source = null;
  try {
    source = bot.findBlocks({ matching: bot.registry.blocksByName.water.id, maxDistance: 48, count: 1, useExtraInfo: sourceWater })[0] || null;
  } catch (_) { source = null; }
  if (source) return { kind: 'source', distance: Math.round(source.distanceTo(bot.entity.position)), says: `water in view ${Math.round(source.distanceTo(bot.entity.position))} blocks off` };
  let biome = null;
  try { biome = (require('./exploration').biomeView(bot)?.biomesNearby || []).find(holdsWater) || null; } catch (_) { biome = null; }
  if (biome) return { kind: 'biome', distance: biome.distance, says: `no water in view within 48 blocks; the nearest seen is the ${biome.biome.replaceAll('_', ' ')} ${biome.distance} blocks ${biome.direction} (${biome.has})` };
  return { kind: 'none', distance: null, says: 'no water is known: none in view within 48 blocks and no biome seen with water' };
}
module.exports = { sourceWater, fillBucket, fillWaterBucket, collectWater, waterKnown, holdsWater };
