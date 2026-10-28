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
      if (countOf(bot, full) === before + 1 && countOf(bot, 'bucket') === emptyBefore - 1) {
        // A lava source just taken leaves a cell the flow round it fills
        // again: remembered a while, so the walk away does not step into it
        // (skills.js navigate, note 753c).
        if (fluid === 'lava') bot._scoopedLava = [...(bot._scoopedLava || []).filter(e => Date.now() - e.at < 20000), { x: position.x, y: position.y, z: position.z, at: Date.now() }].slice(-16);
        return;
      }
      await sleep(25);
    }
    throw new Error(`No ${fluid}-bucket inventory conversion was confirmed`);
  } finally { bot.deactivateItem(); }
}
const fillWaterBucket = (bot, task, position, options = {}) => fillBucket(bot, task, position, { ...options, fluid: 'water' });

async function collectWater(bot, task, goal, save, { navigate, explore, digTo = null }) {
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
  // In the water already: filled from a source in reach where the body is,
  // as a player fills a bucket swimming. 25593 (2026-10-01 01:22:58-
  // 01:24:21Z), casting in water, swam up for air, and climbed sixteen
  // blocks to look for water three times, down and up again each time; no
  // dry place was beside the water and it was too deep to wade (note 767c).
  const wetHere = ['feet', 'head'].some(k => /water/.test(bot.blockAt(bot.entity.position.floored().offset(0, k === 'head' ? 1 : 0, 0))?.name || ''));
  if (wetHere) {
    const eye = bot.entity.position.offset(0, 1.62, 0);
    for (const p of sources.filter(q => eye.distanceTo(q.offset(0.5, 0.5, 0.5)) <= 4.2).sort((a, b) => eye.distanceTo(a) - eye.distanceTo(b)).slice(0, 4)) {
      task.check();
      try {
        await fillWaterBucket(bot, task, p, { guard: () => checkThreats(bot) });
        goal.step = { action: 'fill_bucket', position: { ...p }, item: 'water_bucket', confirmed: true, swimming: true }; save(); return;
      } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
  }
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
        // A walk that stops short, or a source out of reach or sight from
        // where it stopped, is this place's failure, not the fetch's: the
        // next place or source is tried. Thrown out of the fetch, "Water
        // source is outside visible interaction reach" was the second cause
        // of the portal cast failing at its site (33 of 167 failures since
        // 15:24Z on 2026-09-30, note 767), with other sources in view.
        try {
          await navigate(bot, task, destination, { timeoutMs: 10000, stallMs: 3000 });
          await fillWaterBucket(bot, task, p, { guard: () => checkThreats(bot) });
        } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; continue; }
        if (goal.search?.water) goal.search.water.attempts = 0;
        goal.step = { action: 'fill_bucket', position: { ...p }, item: 'water_bucket', confirmed: true }; save(); return;
      }
    }
  } finally { movement.restore(); }
  // No dry place beside any: into the water, and the bucket filled from
  // there, as a player wades in. With only the dry shore allowed, 25595
  // (mid-243-md, 2026-09-30 17:56:15Z), its frame 4 of ten cast, climbed 21
  // blocks for water in view 5 blocks off (note 753e). Shallow water only:
  // a source with air or another water block over it and ground within
  // two under it, so the head stays out or a step gets it out; and the bot
  // leaves once it is filled, as the air check watches meanwhile.
  const wade = sources.filter(p => wadeable(bot, p)).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
  for (const p of wade.slice(0, 3)) {
    task.check(); checkThreats(bot);
    goal.step = { action: 'fill_bucket', position: { ...p }, item: 'water_bucket', wade: true }; save();
    try {
      if (bot.entity.position.offset(0, 1.62, 0).distanceTo(p.offset(0.5, 0.5, 0.5)) > 4) await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 2), { timeoutMs: 20000, stallMs: 6000 });
      await fillWaterBucket(bot, task, p, { guard: () => checkThreats(bot) });
      if (goal.search?.water) goal.search.water.attempts = 0;
      goal.step = { action: 'fill_bucket', position: { ...p }, item: 'water_bucket', confirmed: true, wade: true }; save(); return;
    } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
  }
  // Water in view that no walk reaches: dug to (note 2320), as the dig to water is, not a search of the surface from
  // inside the rock. full-11 (25588, 2026-10-27 20:36 to 20:47Z), in a pocket of a mountain at y 75 with water 8 below
  // and its frame beside it, met 'No route' on every wade and dry stand and an explore that went nowhere, and ran the
  // fetch several times a second for ten minutes; the user: '11 is taking forever'.
  // Water behind one block in reach: that block dug and the bucket filled from where the bot stands (note 2350). The
  // staircase does not open a cell with water behind it, so a dig to water a block off circled it. full-15 (25586,
  // 2026-10-28 06:18 to 06:21Z) tunnelled 47 steps round the water at (8, 23, -137), 1 to 4 blocks from it, 'No
  // measurable progress' four times, and left without the bucket; full-14 spent 9 minutes on a cast with no water.
  if (sources.length && dryStanding(bot, bot.entity.position)) {
    const eye = bot.entity.position.offset(0, 1.62, 0);
    for (const p of sources.filter(q => eye.distanceTo(q.offset(0.5, 0.5, 0.5)) <= 4.2).sort((a, b) => eye.distanceTo(a) - eye.distanceTo(b)).slice(0, 3)) {
      task.check(); checkThreats(bot);
      const to = p.offset(0.5, 0.5, 0.5), dir = to.minus(eye), hit = bot.world?.raycast?.(eye, dir.unit(), dir.norm());
      const wall = hit?.position && !hit.position.equals(p) ? bot.blockAt(hit.position) : null;
      if (!wall || !wall.diggable || /water|lava/.test(wall.name) || wall.position.distanceTo(p) > 1.5) continue;
      // Not where the wall holds back lava, nor under the bot's own feet.
      if ([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([x, y, z]) => /lava/.test(bot.blockAt(wall.position.offset(x, y, z))?.name || ''))) continue;
      if (wall.position.equals(bot.entity.position.floored().offset(0, -1, 0))) continue;
      try {
        console.log(`[water] the water at ${p} is behind the ${wall.name} at ${wall.position}: digging it and filling from here`);
        await require('./skills').digWithTool(bot, wall, true);
        // The wall's block is gone a moment after the dig on the bot's side, and the water runs into the cell (note 2383):
        // waited for, and every source then in reach and sight tried, the one aimed at first. full-20 (25588,
        // 2026-10-28 14:5xZ): 'Water source is outside visible interaction reach' after each wall dug.
        await sleep(400);
        const eye2 = bot.entity.position.offset(0, 1.62, 0);
        const inReach = [p, ...bot.findBlocks({ matching: bot.registry.blocksByName.water.id, maxDistance: 5, count: 12, useExtraInfo: sourceWater }).filter(q => !q.equals(p) && eye2.distanceTo(q.offset(0.5, 0.5, 0.5)) <= 4.5)];
        let filled = false, lastErr = null;
        for (const q of inReach) {
          try { await fillWaterBucket(bot, task, q, { guard: () => checkThreats(bot) }); filled = true; break; }
          catch (e) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(e.name)) throw e; lastErr = e; }
        }
        if (!filled) throw lastErr || new Error('no water source in reach after the wall was dug');
        if (goal.search?.water) goal.search.water.attempts = 0;
        goal.step = { action: 'fill_bucket', position: { ...p }, item: 'water_bucket', confirmed: true, throughWall: true }; save(); return;
      } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[water] through the wall to ${p}: ${String(err.message || err).slice(0, 120)}`); }
    }
  }
  // Water close above, out of an arm's reach: built up to, a block put under the feet at a time from what is carried,
  // then filled from there through the wall as above (note 2382). The staircase toward it does not open a cell with
  // water behind it, and the walk with no towering found none: full-23 (25592, 2026-10-28 14:4xZ) stood at y -30
  // under water at y -25, 'no walk reaches the water ... digging to it' a dozen times, 21 minutes on its portal.
  {
    const here = bot.entity.position, mv = bot.pathfinder?.movements;
    const above = sources.filter(q => q.y > here.y + 1 && q.distanceTo(here) <= 9).sort((a, b) => a.distanceTo(here) - b.distanceTo(here))[0];
    const scaffold = (mv?.scafoldingBlocks || []).length || bot.inventory.items().some(i => /^(cobblestone|cobbled_deepslate|dirt|netherrack|stone|andesite|diorite|granite)$/.test(i.name));
    if (above && mv && scaffold && !goal.waterClimbAt?.[`${above}`]) {
      (goal.waterClimbAt ||= {})[`${above}`] = Date.now(); save();
      const saved = { allow1by1towers: mv.allow1by1towers, canDig: mv.canDig, scafoldingBlocks: mv.scafoldingBlocks };
      const ids = bot.inventory.items().filter(i => /^(cobblestone|cobbled_deepslate|dirt|netherrack|stone|andesite|diorite|granite)$/.test(i.name)).map(i => i.type);
      Object.assign(mv, { allow1by1towers: true, canDig: true, scafoldingBlocks: [...new Set([...(mv.scafoldingBlocks || []), ...ids])] });
      try {
        console.log(`[water] the water at ${above} is ${Math.round(above.y - here.y)} above: building up toward it`);
        await navigate(bot, task, new goals.GoalNear(above.x, above.y - 1, above.z, 3), { timeoutMs: 30000, stallMs: 6000 });
      } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[water] the climb toward ${above}: ${String(err.message || err).slice(0, 120)}`); }
      finally { Object.assign(mv, saved); }
      return;
    }
  }
  if (sources.length && digTo) {
    const near = sources.slice().sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))[0];
    goal.step = { action: 'fill_bucket', position: { x: near.x, y: near.y, z: near.z }, item: 'water_bucket', dig: true }; save();
    console.log(`[water] no walk reaches the water at ${near}, ${Math.round(near.distanceTo(bot.entity.position))} blocks off: digging to it`);
    await digTo(near);
    return;
  }
  await explore(bot, task, goal, save, 'water', { surfaceOnly: true });
}
// A water source a body can wade to: its floor within two below and open
// air within two above, so the head is out or a step from it.
function wadeable(bot, p) {
  const at = dy => bot.blockAt(p.offset(0, dy, 0));
  const floor = [-1, -2].some(dy => at(dy)?.boundingBox === 'block');
  const air = [1, 2].some(dy => /^(air|cave_air)$/.test(at(dy)?.name || ''));
  return floor && air;
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
  if (source) return { kind: 'source', at: { x: source.x, y: source.y, z: source.z }, distance: Math.round(source.distanceTo(bot.entity.position)), says: `water in view ${Math.round(source.distanceTo(bot.entity.position))} blocks off` };
  let biome = null;
  try { biome = (require('./exploration').biomeView(bot)?.biomesNearby || []).find(holdsWater) || null; } catch (_) { biome = null; }
  if (biome) return { kind: 'biome', distance: biome.distance, says: `no water in view within 48 blocks; the nearest seen is the ${biome.biome.replaceAll('_', ' ')} ${biome.distance} blocks ${biome.direction} (${biome.has})` };
  return { kind: 'none', distance: null, says: 'no water is known: none in view within 48 blocks and no biome seen with water' };
}
module.exports = { wadeable, sourceWater, fillBucket, fillWaterBucket, collectWater, waterKnown, holdsWater };
