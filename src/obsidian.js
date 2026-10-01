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
const { makeRoom, tidyInventory, tidyContext } = require('./inventory-tidy');

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

// Where lava is scooped from: any dry place to stand a block or two above
// the pool with a surface source in a bucket's reach and nothing solid in
// the line to it, as a player scoops across the flowing lava at a pool's
// edge. Not only the shore beside a source, as a pour is: each bucket taken
// from the edge leaves flowing lava there, and mid-242-aa, ten trips into
// its pool, found no source beside any shore and dug round the pool's rim
// for four minutes toward the air over sources two blocks in (note 546).
// Ranked by the sources in reach, up to the buckets to fill, then nearness.
function scoopSpots(bot, surface, { want = 1, limit = 8 } = {}) {
  const here = bot.entity.position, spots = new Map();
  const visible = (eye, p) => {
    const aim = p.offset(0.5, 0.5, 0.5), delta = aim.minus(eye), d = delta.norm();
    if (d > REACH) return false;
    const hit = bot.world?.raycast?.(eye, delta.scaled(1 / d), d);
    return !hit || eye.distanceTo(hit.intersect || hit.position) >= d - 0.1;
  };
  for (const p of surface) for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (const dy of [1, 2]) {
    const feet = p.offset(dx, dy, dz), key = `${feet}`;
    if (spots.has(key)) continue;
    spots.set(key, null);
    const shore = feet.plus(DOWN);
    if (!solid(bot.blockAt(shore)) || !open(bot.blockAt(feet)) || !open(bot.blockAt(feet.plus(UP)))) continue;
    if (!dryStanding(bot, feet) || !safeFromHostiles(bot, feet.offset(0.5, 0, 0.5))) continue;
    const eye = feet.offset(0.5, 1.62, 0.5);
    const inReach = surface.filter(q => q.y < feet.y && visible(eye, q)).length;
    if (inReach) spots.set(key, { shore, feet, reach: inReach });
  }
  return [...spots.values()].filter(Boolean)
    .sort((a, b) => Math.min(b.reach, want) - Math.min(a.reach, want) || a.feet.distanceTo(here) - b.feet.distanceTo(here)).slice(0, limit);
}

// The surface sources a bucket can still take: those in reach from a
// scooping spot (scoopSpots). The rest are lava in sight that no fetch
// fills a bucket from, as a pool's middle is once its edge is taken.
function scoopable(bot, surface = poolSurface(bot)) {
  if (!surface.length) return [];
  const spots = scoopSpots(bot, surface, { want: 1, limit: 64 });
  return surface.filter(q => spots.some(s => s.feet.y > q.y && s.feet.offset(0.5, 1.62, 0.5).distanceTo(q.offset(0.5, 0.5, 0.5)) <= REACH));
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
    const arrived = await require('./exploration').goToLandmark(bot, task, goal, save, kinds, { navigate, filter: l => l.kind === 'ruined_portal' ? (l.obsidian || 0) > 0 : !poolSpent(l) && !require('./tunneling').lavaResting(goal, new Vec3(l.x, l.y ?? LAVA_DEPTH, l.z)) });
    if (arrived !== null) {
      if (!arrived) return;
      goal.step = { ...step, phase: 'at_landmark', kind: arrived.kind }; save();
      // At a lava pool with no lava surface to pour on from here: it is
      // spent (poured over already, or its lava not a pool to stand beside),
      // or the step arrives at it again at once, every pass: mid-110-o "made
      // obsidian" twenty-one times a second there (2026-09-26).
      if (arrived.kind === 'lava_pool' && !poolSurface(bot).length) { if (!(await arrivedAtPool(bot, task, goal, save, arrived, navigate))) return; }
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
  const deep = require('./tunneling').descentTargets(here.floored(), LAVA_DEPTH).find(p => open(p) && !isSetAside(goal, 'staircase_from', require('./tunneling').landingKey(here.floored(), p)));
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

// Where a walk to lava is judged from: one that came no nearer from here
// is not tried again from here to the next spot along the same shore.
const walkArea = p => ({ x: Math.floor(p.x / 16) * 16, y: Math.floor(p.y / 16) * 16, z: Math.floor(p.z / 16) * 16 });

// The lava a fetch is going for, held from one pass to the next until a
// bucket is filled there, its way fails or ten minutes pass (note 753):
// each pass chose afresh, from wherever the bot then stood, and the choice
// turned as the bot moved. 25581 (mid-243-jd, 2026-09-30 11:44-11:51Z)
// went a block a pass toward two cells of one pool, the tunnel's target
// turning between (16, 68, -11) and (21, 68, -15), every pass surveying
// the same eight scooping spots first; 25592 (mid-237-ad, 11:57:52Z) left
// a known pool at (96, 18, 64), 27 blocks off, whose walk came no nearer,
// and dug for the deep lava at y -56. A new lava is taken over the one held
// only when it beats the held one's carry by a third, the rule note 748
// gave a dig with real steps in it.
const HOLD_MS = 600000, HOLD_MARGIN = 1.5, SAME_LAVA = 8;
function heldLava(bot, goal) {
  const h = goal.lavaFetch;
  if (!h) return null;
  const dim = String(bot.game?.dimension || 'overworld');
  if (h.dimension !== dim || countOf(bot, 'lava_bucket') > (h.carried ?? 0) || Date.now() - h.since > HOLD_MS) {
    // The pool it fetched from, or the one Jev chose, stays the chosen
    // pool past the bucket (note 767d): the next trip goes back to it, and
    // another is a question, not the fetch's own pick.
    const pool = h.pick?.way === 'pool' ? h.pick.at : /^(pool|dig)$/.test(h.way) ? h.lava : null;
    if (pool && h.dimension === dim) goal.lavaChosen = { at: { x: pool.x, y: pool.y, z: pool.z }, by: h.pick ? 'Jev' : 'the fetch', since: Date.now(), dimension: dim };
    delete goal.lavaFetch; return null;
  }
  return h;
}
// The lava the portal plan holds (portal_plan, note 782): its way (a pool,
// the lava layer, or the lava in sight about the frame) and where, held as
// long as the plan is. Before the plan, lava_way's answer was held half an
// hour apart from the fetch (note 767f), and the fetch took its own pick of
// lava past it once the hold was gone.
function lavaPickNow(bot, goal) {
  const m = goal.portalMethod, dim = String(bot.game?.dimension || 'overworld');
  if (!m?.lava?.way || (m.facts?.dimension && m.facts.dimension !== dim.replace(/^minecraft:/, ''))) return null;
  return { way: m.lava.way, ...(m.lava.at ? { at: { ...m.lava.at } } : {}), chosenAt: m.chosenAt || 0 };
}
const sameLava = (a, b) => !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) <= SAME_LAVA;
// The seconds a way to lava takes from here: a walk at four blocks a
// second and a staircase of three seconds a block of height where it rises
// or falls more than eight (legSeconds); a dig is a stair for each block of
// height or across, whichever is more, at three seconds a stair
// (surface.js climbMinutes).
function waySeconds(here, at, way) {
  const across = Math.hypot(at.x - here.x, at.z - here.z), dy = Math.abs(at.y - here.y);
  return way === 'walk' ? legSeconds(here, at) : Math.max(across, dy) * 3;
}
const minutesSays = s => s < 90 ? `about ${Math.max(5, Math.round(s / 5) * 5)} seconds` : `about ${Math.round(s / 60)} minutes`;
// The lava taken up, held and said once: where, how far, the height to go
// and what that takes. "I'm fetching lava in a bucket" said none of it,
// and a trip sixty blocks down read the same as one across a field.
function holdLava(bot, goal, save, { way, lava, dest = lava, why = '' }) {
  const here = bot.entity.position, prev = goal.lavaFetch;
  const same = prev && prev.way === way && (way === 'deep' || sameLava(prev.lava, lava));
  const held = { way, lava: { x: lava.x, y: lava.y, z: lava.z }, dest: { x: dest.x, y: dest.y, z: dest.z }, since: same ? prev.since : Date.now(),
    carried: countOf(bot, 'lava_bucket'), dimension: String(bot.game?.dimension || 'overworld'), switches: (prev?.switches || 0) + (prev && !same ? 1 : 0),
    ...(prev?.pick ? { pick: prev.pick } : {}) };
  goal.lavaFetch = held; save();
  if (same) return held;
  const dy = Math.round(lava.y - here.y), across = Math.round(Math.hypot(lava.x - here.x, lava.z - here.z));
  const height = dy <= -4 ? `, ${-dy} blocks down` : dy >= 4 ? `, ${dy} blocks up` : '';
  // A walk said at the bot's measured pace (note 763): "147 blocks off, about
  // 35 seconds" at 4.3 blocks a second took three to nine minutes.
  const walking = way === 'pool' || way === 'to_lava';
  const takes = minutesSays(walking ? require('./levels').walkSeconds(Math.hypot(dest.x - here.x, dest.z - here.z)) + (Math.abs(dest.y - here.y) > 8 ? require('./levels').upSeconds(Math.abs(dest.y - here.y)) : 0) : waySeconds(here, dest, 'dig'));
  const at = `(${Math.round(lava.x)}, ${Math.round(lava.y)}, ${Math.round(lava.z)})`;
  const line = way === 'deep' ? `Digging down for the deep lava at y ${Math.round(lava.y)}${height}, ${takes} by staircase${why}.`
    : way === 'pool' ? `Walking to the lava pool at ${at}, ${across} blocks off${height}, ${takes}${why}.`
    : way === 'to_lava' ? `Walking to the lava at ${at}, ${across} blocks off${height}, ${takes}${why}.`
    : `Digging toward the lava at ${at}, ${across} blocks off${height}, ${takes}${why}.`;
  held.says = line;
  bot.chat?.(line);
  return held;
}
// A scooping spot's route search, remembered for a minute from where it
// was made: every pass searched up to eight spots at half a second each
// before its one step of the staircase, four seconds a step (25581,
// 11:44-11:51Z: forty-five blocks in seven minutes). A search that found no
// path, or ran out of time where the walk from here is already set aside,
// is not made again from within six blocks of where it was.
const SURVEY_MS = 60000, SURVEY_NEAR = 6;
function surveyMemo(goal, here) {
  const m = goal.lavaSurvey;
  if (m && Date.now() - m.at <= SURVEY_MS && Math.hypot(m.from.x - here.x, m.from.y - here.y, m.from.z - here.z) <= SURVEY_NEAR) return m;
  return (goal.lavaSurvey = { at: Date.now(), from: { x: here.x, y: here.y, z: here.z }, spots: {} });
}

// A way to lava from here, priced: the blocks across and the height, the
// dig there (three seconds a stair, up to three blocks dug a block of
// height), and a trip after it back and forth from `back` at the bot's
// measured pace. Asked as lava_way once (note 763b); the portal plan prices
// its routes with it (note 782).
function wayCosts(here, at, back, { deep = false } = {}) {
  const L = require('./levels');
  const across = Math.round(Math.hypot(at.x - here.x, at.z - here.z)), dy = Math.round(at.y - here.y), rise = Math.abs(dy);
  const there = deep ? Math.max(across, rise) * 3 : Math.max(across, rise) * 3;
  const from = back || here;
  const tripAcross = Math.round(Math.hypot(at.x - from.x, at.z - from.z)), tripRise = Math.abs(Math.round(at.y - from.y));
  const trip = L.walkSeconds(tripAcross * 2) + (tripRise > 8 ? L.upSeconds(tripRise) + L.downSeconds(tripRise) : 0);
  return { across, dy, there, trip, digs: across + 3 * rise };
}
const secsSays = s => s < 90 ? `about ${Math.max(5, Math.round(s / 5) * 5)} seconds` : `about ${Math.round(s / 60)} minutes`;
// A lava target's failure record, said on every option that goes to it
// (note 767, the reviewer's rule of the check-in of 23:39Z on 2026-09-30:
// "a lava target whose approach failed is a fact on the option"): the
// staircase toward it set aside, the walk there that came no nearer, a way
// Jev chose to it whose route failed, and a pool found spent. '' for none.
function lavaRecord(goal, l, from = null, now = Date.now()) {
  const { restingSays, lavaWay } = require('./tunneling');
  const p = new Vec3(l.x, l.y ?? LAVA_DEPTH, l.z);
  const out = [];
  if (l.spent) out.push(`found with no lava to take when last reached${Number.isFinite(Date.parse(l.spent)) ? `, ${Math.max(1, Math.round((now - Date.parse(l.spent)) / 60000))} minutes ago` : ''}${l.spentWhy ? ` (${l.spentWhy})` : ''}${poolSpent(l, now) ? ', passed over for now' : ''}`);
  const rest = restingSays(goal, lavaWay(p), from, now);
  if (rest) out.push(rest);
  const key = `lava_pool:${l.x},${l.z}`;
  if (isSetAside(goal, 'landmark_trip', key, now)) out.push(`the walk there set aside: ${require('./progress').attemptsFor(goal).why('landmark_trip', key) || 'it came no nearer'}`);
  else if (l.lastWalk && now - l.lastWalk.at < 30 * 60000) out.push(`the last walk there ended ${l.lastWalk.ended} blocks off (from ${l.lastWalk.began})${l.lastWalk.why ? `: ${l.lastWalk.why}` : ''}`);
  // The portal plan's routes to it that failed (note 782).
  for (const f of require('./portal-plan').failuresFor(goal, { lava: { x: p.x, y: p.y, z: p.z } }, now)) out.push(`a plan's route to it chosen ${Math.max(1, Math.round((now - f.at) / 60000))} minutes ago failed: ${f.why}`);
  return out.length ? ` Its record: ${out.join('; ')}.` : '';
}
// The plan's lava (portal_plan, note 782; lava_way's before) whose route
// has failed since: its pool's staircase set aside or the walk there no
// nearer, the pool spent, or the lava layer's headings failing from here.
// The plan's route has failed, and it is asked again with that said (the
// reviewer's rule, note 767: 112 digs toward a known pool on the hard
// worlds had their walk fail, and 763b's lava_way was held through it).
function pickFailed(goal, pick, { deepFailing = false, deep = null } = {}, now = Date.now()) {
  const { staircaseResting, staircaseWhy, lavaWay } = require('./tunneling');
  if (pick?.way === 'deep') return !deep ? 'no heading down is open from here' : deepFailing ? 'two or more headings down from about here are set aside' : null;
  if (pick?.way !== 'pool' || !pick.at) return null;
  const p = new Vec3(pick.at.x, pick.at.y, pick.at.z);
  const l = (goal.landmarks || []).find(x => x.kind === 'lava_pool' && sameLava({ x: x.x, y: x.y ?? p.y, z: x.z }, p));
  if (poolSpent(l, now) && Date.parse(l.spent) > (pick.chosenAt || 0)) return `the pool was found with no lava to take${l.spentWhy ? ` (${l.spentWhy})` : ''}`;
  if (staircaseResting(goal, lavaWay(p))) return `the staircase toward it is set aside (${staircaseWhy(goal, lavaWay(p))})`;
  // A walk set aside since it was chosen (one set aside before is why it
  // is dug to).
  const P = require('./progress'), walk = l && P.attemptsFor(goal).entries[P.keyOf('landmark_trip', `lava_pool:${l.x},${l.z}`)];
  // A route search out of time is not the pool's failure (note 767e): dug to instead.
  if (walk && walk.until > now && walk.at > (pick.chosenAt || 0) && !String(walk.why || '').startsWith(require('./exploration').ROUTE_TIMED_OUT)) return `the walk there came no nearer (${walk.why || 'set aside'})`;
  return null;
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
  // Lava in a bucket's reach from where the bot stands is scooped, open air
  // over it or not: a source under a ledge or in a wall is "no lava in
  // sight" to the pool's surface, and 25590 (mid-237-av, 2026-09-30
  // 23:58:25-00:01:09Z), two blocks from the pool Jev chose at (109, 5,
  // 132), dug a staircase toward the cell over it three times ("not closer
  // than 1 block") and then set off for the deep lava (note 767). Only
  // below the feet, or level with them with a solid block between, where a
  // taken source's flow cannot come to the body.
  {
    const feet = bot.entity.position.floored(), eye = bot.entity.position.offset(0, 1.62, 0);
    const room = () => (bot.inventory.emptySlotCount?.() ?? 1) > 0 || bot.inventory.items().find(i => i.name === 'bucket')?.count === 1;
    const id = bot.registry?.blocksByName?.lava?.id;
    const near = id === undefined || typeof bot.findBlocks !== 'function' ? [] : bot.findBlocks({ matching: id, maxDistance: 6, count: 32, useExtraInfo: b => sourceLava(b) });
    const safe = p => p.y < feet.y || (p.y === feet.y && Math.max(Math.abs(p.x - feet.x), Math.abs(p.z - feet.z)) >= 2 &&
      solid(bot.blockAt(p.offset(Math.sign(feet.x - p.x), 0, Math.sign(feet.z - p.z)))));
    const inReach = near.filter(p => eye.distanceTo(p.offset(0.5, 0.5, 0.5)) <= REACH - 0.3 && safe(p) && !surface.some(q => q.equals(p)))
      .sort((a, b) => eye.distanceTo(a) - eye.distanceTo(b));
    let took = 0;
    for (const p of surface.length ? [] : inReach) {
      if (countOf(bot, 'lava_bucket') >= target || !countOf(bot, 'bucket') || !room()) break;
      goal.step = { ...step, phase: 'scoop_in_reach', position: { x: p.x, y: p.y, z: p.z } }; save();
      try { await fillBucket(bot, task, p, { fluid: 'lava', guard: () => checkThreats(bot) }); took++; }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
    if (took) return;
  }
  const { staircaseResting, lavaResting, lavaWay, descentTargets } = require('./tunneling');
  // Lava for a cast frame is carried to the frame: the lava fetched is the
  // one whose carry is shortest, here to the lava and on to the frame, as
  // the trips Jev chose the cast by are measured (portal-cast.js lavaTrip).
  // By its distance from the bot alone, mid-230-u, back from a food trip
  // 130 blocks from its frame with a pool twenty blocks beside the frame,
  // went for pools 350 and 460 blocks off and then dug to the deep lava
  // below where it stood, 135 blocks down: forty minutes for one bucket
  // (note 524).
  // With no frame to carry to, the lava comes back to about where the fetch
  // is made from (a frame cast in place goes down where the bot stands):
  // the way back up counts (note 763). Carried one way only, a pool 28
  // blocks down and the deep lava 102 down read alike to a dig, and 25584
  // (mid-244-hf, 2026-09-30 19:18-19:28Z) dug for the deep lava at y -56,
  // "the pool known at (132, 18, 108) is passed: 107 blocks", pacing six
  // blocks for ten minutes as heading after heading was set aside.
  const to = castTo(bot, goal), here = bot.entity.position;
  const back = to || (goal.portalMethod?.near ? null : here);
  const carry = p => carrySeconds(here, p, back);
  // A dig's own seconds there and the carry back: the dig toward a pool
  // whose walk failed and the dig for the deep lava weighed alike.
  const digCarry = p => waySeconds(here, p, 'dig') + (back ? legSeconds(p, back) : 0);
  // A heading whose staircase from this landing rests is not the deep lava
  // either: read by the target's area alone, a heading resting from here was
  // chosen and thrown on at once, four in nine seconds on 25590 (mid-239-ce,
  // 2026-09-30 17:16:01-10Z, "paced the same few cells about (223, -1, 40)"
  // said of each), and the fetch was called stuck (note 753d).
  const headings = descentTargets(here.floored(), LAVA_DEPTH);
  const headingResting = p => staircaseResting(goal, p) || isSetAside(goal, 'staircase_from', require('./tunneling').landingKey(here.floored(), p));
  const deep = headings.find(p => !headingResting(p));
  // The deep lava failing from here (note 763): two or more of its headings
  // from about here set aside is the dig itself failing where the bot
  // stands, not one bad heading, and the next heading's staircase met the
  // same: 25584 set sixteen aside in ten minutes pacing the same cells. A
  // pool known is then taken before it, however its carry compares.
  const deepFailing = headings.filter(headingResting).length >= 2;
  const landmarkAt = l => new Vec3(l.x, l.y ?? LAVA_DEPTH, l.z);
  const poolOpen = l => !poolSpent(l) && !lavaResting(goal, landmarkAt(l));
  // A deep dig already real steps into (resourceTunnelStep's own site,
  // tunneling.js tunnelStep) is not left for a pool only nominally shorter:
  // `deep` (and so `carry(deep)`) is recomputed from wherever the bot now
  // stands on every call, so a dig that has moved forward can read as
  // barely beaten by a pool whose own carry has not moved at all, and the
  // pool can still fail to arrive. 25581 (mid-243-if) left a dig 55 steps
  // in at (93, -54, 54) for a pool at (104, -33, 25) on 2026-09-30
  // 05:37:56Z, stalled 15-16 blocks short of it for 89 seconds
  // (05:38:49-05:40:18Z), and came back to the same dig, the round trip
  // about eleven minutes for one bucket (note 748). Once the dig has 8 or
  // more steps in it, a pool has to beat its carry by a third, not by any
  // margin, so the next call's noise does not flip it back and forth.
  const site = goal.miningSites?.[`${bot.game?.dimension || 'overworld'}:lava`];
  const held = heldLava(bot, goal);
  // A dig held (note 753) is a dig under way however few its steps.
  const margin = (site?.steps || 0) >= 8 || (held && /^(deep|dig)$/.test(held.way)) ? HOLD_MARGIN : 1;
  // The pool walked to is held as the dig is: another is taken over it only
  // at a third less. 25588 (mid-242-zh, 15:23:23-15:24:16Z) turned between
  // the pools at (2, 86, 199) and (-5, 40, 233) each pass as it moved, the
  // carry from where it stood tipping one way and back (note 753c).
  const heldPoolAt = held && held.way === 'pool' ? at(held.lava) : null;
  const poolCost = l => (to ? carry(landmarkAt(l)) : landmarkAt(l).distanceTo(here)) / (heldPoolAt && sameLava(landmarkAt(l), heldPoolAt) ? HOLD_MARGIN : 1);
  // The lava the portal plan holds is the fetch's lava (note 782): its
  // pool walked or dug to alone, no other pool and no lava in sight more
  // than 24 blocks from it, the lava layer with no pool meanwhile; and when
  // the way to it fails, that is the plan's route failing, said and asked
  // again (portal_plan), not another lava taken here. Before the plan the
  // fetch held the pool it was going for (notes 753, 767d) and switched on
  // its own once that hold was gone: 199 of the 432 plan changes on 172
  // fresh portal rungs (2026-09-30T17:00Z to 2026-10-01T04:58Z) were the
  // fetch naming new lava with no answer in the minute before.
  // With no plan held (a fetch outside the portal's rung), the pool the
  // fetch held is kept as before.
  const lastChosen = goal.lavaChosen && goal.lavaChosen.dimension === String(bot.game?.dimension || 'overworld') && Date.now() - goal.lavaChosen.since < 30 * 60000 ? goal.lavaChosen.at : null;
  const pick = lavaPickNow(bot, goal);
  const chosenAt = pick ? (pick.way === 'pool' ? pick.at : null)
    : goal.portalMethod?.kind === 'cast' && goal.portalMethod.near && !goal.portalFrame ? goal.portalMethod.near
    : held && /^(pool|dig)$/.test(held.way) ? held.lava : lastChosen;
  // Since when it is chosen: a walk set aside before is why it was chosen
  // to dig to, not its failure.
  const chosenSince = pick ? pick.chosenAt || 0 : chosenAt === lastChosen && lastChosen ? goal.lavaChosen.since : held?.since || 0;
  const chosenPool = chosenAt ? (goal.landmarks || []).find(l => l.kind === 'lava_pool' && l.dimension === (bot.game?.dimension || 'overworld') && sameLava(landmarkAt(l), chosenAt)) : null;
  const tripKey = l => `lava_pool:${l.x},${l.z}`;
  const chosenFails = !chosenPool ? null : poolSpent(chosenPool) ? `it was found with no lava to take${chosenPool.spentWhy ? ` (${chosenPool.spentWhy})` : ''}`
    : lavaResting(goal, landmarkAt(chosenPool)) ? `the way into it rests (${require('./tunneling').staircaseWhy(goal, lavaWay(landmarkAt(chosenPool)))})`
    : (e => e && e.until > Date.now() && e.at > chosenSince && !String(e.why || '').startsWith(require('./exploration').ROUTE_TIMED_OUT))(require('./progress').attemptsFor(goal).entries[require('./progress').keyOf('landmark_trip', tripKey(chosenPool))]) ? `the walk there was set aside (${require('./progress').attemptsFor(goal).why('landmark_trip', tripKey(chosenPool)) || 'no nearer'})` : null;
  const keepTo = chosenPool && !chosenFails ? chosenPool : null;
  // The lava layer chosen: no pool is walked or dug to meanwhile, its
  // headings failing from here being its failure, asked again then. The
  // lava in sight chosen: no pool walked to either.
  const pool = l => poolOpen(l) && (keepTo ? l === keepTo : !pick);
  if (chosenPool && chosenFails && pick) {
    console.log(`[portal_plan] the pool the plan holds at (${chosenPool.x}, ${chosenPool.y}, ${chosenPool.z}) failed (${chosenFails}); the plan is asked again`);
    require('./portal-plan').planFailed(goal, `the pool at (${chosenPool.x}, ${chosenPool.y}, ${chosenPool.z}): ${chosenFails}`); save();
    return;
  }
  if (to) {
    // Known lava that is a shorter carry than any in sight and the deep lava
    // below: walked to first, the nearest carry first. Not the pool in sight
    // itself, remembered: that one is scooped below.
    const bound = Math.min(surface.length ? Math.min(...surface.map(carry)) : Infinity, deep ? carry(deep) : Infinity);
    // The plan's pool is walked to whatever lies nearer (note 782): the plan
    // priced it against the rest.
    const shorter = l => pool(l) && (pick?.way === 'pool' || carry(landmarkAt(l)) * margin < bound) && !surface.some(p => Math.hypot(p.x - l.x, p.z - l.z) <= 16);
    if ((goal.landmarks || []).some(l => l.kind === 'lava_pool' && shorter(l))) {
      const walkedFrom = bot.entity.position.clone();
      const arrived = await require('./exploration').goToLandmark(bot, task, goal, save, ['lava_pool'], { navigate, filter: shorter, cost: poolCost,
        onWalk: l => holdLava(bot, goal, save, { way: 'pool', lava: landmarkAt(l) }) });
      if (arrived === false) return;
      // Arrived and no lava of its own there: that pool is spent.
      if (arrived && !(await arrivedAtPool(bot, task, goal, save, arrived, navigate))) return;
      // Arrived after a walk: the pass ends, and the next reads the lava,
      // the spots and the pools from where the bot now stands. Read from
      // where the walk began, this pass went on with the lava in sight from
      // there (none, 118 blocks off) and the pool's distance from there:
      // 25583 (mid-244-gh, 2026-09-30 17:09:21Z) stood six blocks from the
      // pool at (392, 23, -47) and was told "no lava in sight; the pool
      // known ... is passed: 118 blocks off, too far to dig to", and dug for
      // the deep lava (note 753d).
      if (arrived && bot.entity.position.distanceTo(walkedFrom) > 2) return;
    }
  }
  // Lava in sight is scooped where it is the plan's: about its pool, the
  // lava in sight it named, none with the lava layer held (note 782); lava
  // found nearer is a fact the plan is asked again with.
  const planned = !pick ? surface : pick.way === 'deep' ? [] : surface.filter(p => pick.way === 'sight' && pick.at ? p.distanceTo(at(pick.at)) <= 24 : keepTo ? p.distanceTo(landmarkAt(keepTo)) <= 24 : false);
  const spots = scoopSpots(bot, planned, { want: step.count || 1 });
  let unsurveyed = null;
  const memo = surveyMemo(goal, here);
  for (const spot of spots) {
    task.check();
    const destination = new goals.GoalBlock(spot.feet.x, spot.feet.y, spot.feet.z);
    // Searched already from about here (surveyMemo): not again for a result
    // that cannot change what is done.
    const known = memo.spots[`${spot.feet}`];
    if (known === 'noPath' || (known === 'timeout' && isSetAside(goal, 'lava_walk', walkArea(here)))) continue;
    const route = await surveyRoute(bot, task, bot.pathfinder.movements, destination, 500);
    if (route.status !== 'success') memo.spots[`${spot.feet}`] = route.status;
    if (route.status !== 'success') {
      if (route.status === 'timeout' && !unsurveyed && !isSetAside(goal, 'lava_walk', walkArea(here))) unsurveyed = spot;
      continue;
    }
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
        // With lava in hand already, the trip goes to the frame with what it
        // carries, not on asking what else to drop at each fill: 25589
        // (mid-226-am, 2026-10-01 15:49-15:52Z) was asked nine times and
        // dropped its cobblestone and flint and steel (note 820). Room is
        // asked for only when not one lava bucket is carried.
        // The tidy first, which asks nothing and drops only what it keeps
        // none of or past its budgets (note 821).
        try { await tidyInventory(bot, task, { away: p, keep: new Set(['bucket', 'lava_bucket', 'water_bucket', 'flint_and_steel', 'fire_charge']), ctx: tidyContext(bot, goal) }); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
        if (!room() && countOf(bot, 'lava_bucket') > 0) { console.log(`[lava] no slot free for another lava bucket: the cast takes the ${countOf(bot, 'lava_bucket')} carried`); break; }
        const wanted = Math.min(target - countOf(bot, 'lava_bucket'), countOf(bot, 'bucket'));
        await makeRoom(bot, task, 'lava_bucket', { goal, away: p, keep: new Set(['bucket', 'lava_bucket', 'water_bucket']),
          purpose: `lava for the portal frame (${wanted} more bucket${wanted === 1 ? '' : 's'} to fill here, each a slot of its own)` });
        if (!room()) { noRoom = true; break; }
      }
      try { await fillBucket(bot, task, p, { fluid: 'lava', guard: () => checkThreats(bot) }); filled++; }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
    if (filled || (!noRoom && countOf(bot, 'lava_bucket') > 0 && !room())) return;
    if (noRoom) { goal.step = { ...step, phase: 'no_room' }; save(); throw new Error('No room in my pockets for a lava bucket: each takes a slot of its own, and nothing was dropped for one'); }
  }
  // A spot whose route search ran out of its half second is not a spot with
  // no way to it: the walk there is made, with a walk's own time to find it.
  // mid-242-aa's frame was forty blocks from its pool and eighteen below it;
  // every search from the frame ran out, and each of ten trips dug a
  // staircase up instead, about four minutes a trip, where the walk the
  // stall's detour took there was thirty-three seconds (note 546). A walk
  // that comes no nearer is set aside for ten minutes, and the staircase is
  // the way from here meanwhile.
  if (unsurveyed) {
    const feet = unsurveyed.feet, start = bot.entity.position.clone(), from = start.distanceTo(feet);
    if (from > 16) holdLava(bot, goal, save, { way: 'to_lava', lava: feet.offset(0, -1, 0), dest: feet });
    goal.step = { ...step, phase: 'to_lava', position: { ...feet } }; save();
    try { await navigate(bot, task, new goals.GoalBlock(feet.x, feet.y, feet.z), { timeoutMs: 60000, stallMs: 8000, sprint: true }); }
    catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    if (!bot.entity.position.floored().equals(feet) && from - bot.entity.position.distanceTo(feet) < 4) {
      setAside(goal, 'lava_walk', walkArea(start), 'the walk to the lava came no nearer', 600000); save();
    }
    return;
  }
  // Lava whose staircase is resting is not lava to dig toward: mid-215-f
  // saw a pool two blocks below it with no scooping spot a route reached,
  // and every pass dug toward the same resting staircase, was refused at
  // once and asked how to answer the stall; the loop ended the trial
  // (2026-09-27). Resting, it counts as no lava here, and the other pools
  // known (or the deep lava) are the way while it rests.
  const open = p => !staircaseResting(goal, p);
  // With a pool held, lava in sight elsewhere is not dug toward unasked
  // (note 767d): within 24 blocks of the pool held it is that pool's.
  const diggable = (pick ? planned : surface.filter(p => !keepTo || p.distanceTo(landmarkAt(keepTo)) <= 24)).filter(p => !lavaResting(goal, p));
  if (!diggable.length) {
    // For a cast, not a pool farther to carry from than the deep lava, the
    // same margin as above once the dig has real steps in it.
    const filter = to && pick?.way !== 'pool' ? l => pool(l) && !(deep && carry(landmarkAt(l)) * margin >= carry(deep)) : pool;
    const walkedFrom = bot.entity.position.clone();
    const arrived = await require('./exploration').goToLandmark(bot, task, goal, save, ['lava_pool'], { navigate, filter, cost: poolCost,
      onWalk: l => holdLava(bot, goal, save, { way: 'pool', lava: landmarkAt(l) }) });
    // On the way, or at a pool found dry. At one still holding lava, whose
    // every way rests, it is not done: the other ways below are.
    if (arrived === false) return;
    if (arrived && !(await arrivedAtPool(bot, task, goal, save, arrived, navigate))) return;
    if (arrived && bot.entity.position.distanceTo(walkedFrom) > 2) return;
  }
  const rank = (a, b) => to ? carry(a) - carry(b) : a.distanceTo(here) - b.distanceTo(here);
  let nearest = diggable.sort(rank)[0];
  // The lava held stays the lava dug for while it is still there to dig
  // for, unless the new nearest beats it by a third (note 753).
  const heldDig = held && held.way === 'dig' ? at(held.lava) : null;
  const heldCell = heldDig && diggable.filter(p => sameLava(p, heldDig)).sort((a, b) => a.distanceTo(heldDig) - b.distanceTo(heldDig))[0];
  if (nearest && heldCell && (sameLava(nearest, heldCell) || !(carry(nearest) * HOLD_MARGIN < carry(heldCell)))) nearest = heldCell;
  // With no lava in sight to dig to, a known pool before the deep lava: a
  // pool whose walk came no nearer is still lava at its depth, and the
  // staircase goes to it, not past it to y -56 (25592 mid-237-ad, 11:57:52Z:
  // a pool at (96, 18, 64) 27 blocks off, dug past for the deep lava). Not
  // one whose way into it rests, and only where its carry is shorter than
  // the deep lava's (note 753).
  // The pool held (walked or dug toward) keeps its place against the deep
  // lava until the deep lava beats it by a third, and from farther off: a
  // detour back toward the frame put it past 96 blocks and behind the deep
  // lava's carry from there, and 25589 (mid-243-kd, 15:16-15:25Z) walked
  // 130 blocks to it, dug toward it from nine short, went back east and set
  // off for the deep lava, three times round (note 753c).
  const heldPool = l => !!held && /^(dig|pool)$/.test(held.way) && sameLava(landmarkAt(l), held.lava);
  const candidates = (goal.landmarks || []).filter(l => l.kind === 'lava_pool' && l.dimension === (bot.game?.dimension || 'overworld') && pool(l) && l.y !== undefined);
  // A pool is passed for the deep lava only where the deep lava's dig and
  // carry back are shorter (note 763): the flat 96 blocks "too far to dig
  // to" passed 25584's pool 107 blocks off and 28 down for the deep lava
  // 102 down. With no deep heading open, or the deep dig failing from here,
  // no pool is passed for it.
  const passedWhy = l => !open(lavaWay(landmarkAt(l))) ? `its way rests (${require('./tunneling').staircaseWhy(goal, lavaWay(landmarkAt(l)))})`
    : deep && !deepFailing && digCarry(landmarkAt(l)) >= digCarry(deep) * (heldPool(l) ? HOLD_MARGIN : 1) ? `${Math.round(landmarkAt(l).distanceTo(here))} blocks off, a longer dig and carry back (about ${Math.round(digCarry(landmarkAt(l)))} seconds) than the deep lava's (about ${Math.round(digCarry(deep))})` : null;
  const knownPools = nearest ? [] : candidates.filter(l => !passedWhy(l)).sort((a, b) => digCarry(landmarkAt(a)) - digCarry(landmarkAt(b)));
  const poolDig = knownPools.find(heldPool) || knownPools[0];
  // The deep lava is the first heading whose staircase is not resting. A
  // scooping spot dug toward is held the same way as the lava.
  const openSpots = spots.filter(s => open(s.feet));
  let spot = openSpots[0]?.feet;
  const heldSpot = spot && held && held.way === 'dig' && openSpots.map(s => s.feet).filter(f => sameLava(f, at(held.dest))).sort((a, b) => a.distanceTo(at(held.dest)) - b.distanceTo(at(held.dest)))[0];
  if (heldSpot && (sameLava(spot, heldSpot) || !(spot.distanceTo(here) * HOLD_MARGIN < heldSpot.distanceTo(here)))) spot = heldSpot;
  // With no lava in sight or scooping spot, the known pools against the lava
  // layer are Jev's to choose between (note 763b), each with its dig, its
  // trips and the buckets: 25590 (about 20:35Z) dug toward a held pool 165
  // blocks off at its own depth, about eight minutes, with no way down to
  // the lava layer said beside it. Asked once, held with the fetch.
  let chosen = null;
  // The way the plan holds, its route failed since: the plan's failure,
  // said and asked again (note 782), not another way taken here.
  const failedWhy = pick && pick.way !== 'sight' && !spot && !nearest ? pickFailed(goal, pick, { deepFailing, deep }) : null;
  if (failedWhy) {
    console.log(`[portal_plan] the plan's lava failed (${failedWhy}); the plan is asked again`);
    require('./portal-plan').planFailed(goal, `${pick.way === 'deep' ? 'the lava layer' : `the pool at (${pick.at.x}, ${pick.at.y}, ${pick.at.z})`}: ${failedWhy}`); save();
    return;
  }
  // The pool chosen before the bucket, still good: dug to again (no plan).
  if (!spot && !nearest && keepTo && !pick && lastChosen && sameLava(landmarkAt(keepTo), lastChosen)) chosen = { dest: lavaWay(landmarkAt(keepTo)), pool: keepTo };
  // The plan's lava, with none in sight to scoop: dug to.
  if (!chosen && !spot && !nearest && pick) {
    if (pick.way === 'deep' && deep) chosen = { dest: deep };
    else if (pick.way === 'pool' && pick.at) { const l = candidates.find(c => sameLava(landmarkAt(c), pick.at)); chosen = l ? { dest: lavaWay(landmarkAt(l)), pool: l } : { dest: lavaWay(at(pick.at)), sight: at(pick.at) }; }
    else if (pick.way === 'sight' && pick.at) chosen = { dest: lavaWay(at(pick.at)), sight: at(pick.at) };
  }
  // Lava a few blocks off at or below the feet is dug to the shore beside
  // it, a block above its level, where a bucket reaches it (collectLava's
  // scoop in reach), not to the cell over it: 25595 (mid-237-ay, 2026-10-01
  // about 02:05Z) at (115, 39, 106), its pool at (111, 38, 109) five blocks
  // off, had its staircase toward (111, 39, 109) "not gaining", the pool's
  // way set aside, and chose the same pool again from y 79, 41 blocks down
  // (note 767d).
  const shoreOf = p => {
    if (!p || p.y > here.y + 0.5 || here.y - p.y > 3 || Math.hypot(p.x - here.x, p.z - here.z) > 8) return null;
    const dx = here.x - (p.x + 0.5), dz = here.z - (p.z + 0.5);
    const step = Math.abs(dx) >= Math.abs(dz) ? new Vec3(Math.sign(dx) || 1, 0, 0) : new Vec3(0, 0, Math.sign(dz) || 1);
    // A shore: ground at the lava's level beside it (or rock to stand on once dug).
    return solid(bot.blockAt(p.plus(step))) ? p.plus(step).offset(0, 1, 0) : null;
  };
  const near = nearest || (chosen?.pool ? landmarkAt(chosen.pool) : chosen?.sight ? chosen.sight : !chosen && poolDig ? landmarkAt(poolDig) : null);
  const shore = !spot && near && shoreOf(near);
  const dest = spot || shore || (nearest ? lavaWay(nearest) : chosen ? chosen.dest : poolDig ? lavaWay(landmarkAt(poolDig)) : deep);
  if (!dest) { goal.step = { ...step, phase: 'no_lava_way' }; save(); throw noLavaWay(bot, goal, surface); }
  if (chosen?.pool) holdLava(bot, goal, save, { way: 'dig', lava: landmarkAt(chosen.pool), dest, why: ', the pool the portal plan holds' });
  else if (chosen?.sight) holdLava(bot, goal, save, { way: 'dig', lava: chosen.sight, dest, why: ', the lava the portal plan holds' });
  else if (spot || nearest || (poolDig && !chosen)) holdLava(bot, goal, save, { way: 'dig', lava: spot ? spot.offset(0, -1, 0) : nearest || landmarkAt(poolDig), dest,
    why: poolDig && !spot && !nearest ? ', a pool known there whose walk did not get there' : '' });
  else {
    // Said with the pool known and why it is passed, not "no pool known".
    // A pool whose way rests is still a pool known, said with its rest:
    // 25590 two blocks from the pool it had chosen was told "no pool known"
    // once its staircase rested (note 767).
    const known = (goal.landmarks || []).filter(l => l.kind === 'lava_pool' && l.dimension === (bot.game?.dimension || 'overworld') && !poolSpent(l) && l.y !== undefined);
    const passed = known.slice().sort((a, b) => landmarkAt(a).distanceTo(here) - landmarkAt(b).distanceTo(here))[0];
    const failing = headings.filter(headingResting).length;
    const why = `${passed ? `, no lava in sight; the pool known at (${passed.x}, ${passed.y}, ${passed.z}) is passed: ${passedWhy(passed) || 'not dug to'}` : ', no lava in sight and no pool known'}${failing ? `; ${failing} of the ${headings.length} headings down from about here are set aside` : ''}`;
    holdLava(bot, goal, save, { way: 'deep', lava: dest, why });
  }
  goal.step = { ...step, phase: 'reach_lava', target: { ...dest } }; save();
  await resourceTunnelStep(bot, task, goal, save, dest, 'lava', { dig, navigate, within: goal.step });
}

// A pool arrived at still holds lava of its own: a source with open air
// over it within sixteen blocks of where it was seen. Any lava in sight at
// all had kept it: 25589 (mid-243-je, 2026-09-30 11:49Z) reached a pool
// noted at (102, -29, 25), found none to scoop there, and with the lake at
// y -55 in sight the pool stayed on the books to be walked to again
// (note 753).
function ownLava(bot, landmark) {
  const at = new Vec3(landmark.x, landmark.y ?? bot.entity.position.y, landmark.z);
  return poolSurface(bot).some(p => Math.hypot(p.x - at.x, p.z - at.z) <= 16 && (landmark.y === undefined || Math.abs(p.y - at.y) <= 16));
}

// A pool found with no lava to take is a fact with a rest, not forgotten
// (note 767b): "spent" is when it was last found so, and it is passed over
// for half an hour, then known again, its record said wherever it is
// offered. 25581 (mid-235-aa, 2026-10-01 00:37:48-00:39:48Z) found a pool
// 28 blocks off, stalled on the walk, came back within twelve blocks of it
// from the side, saw no source with open air over it and marked it spent
// for good: at 00:42:17 lava_way offered only pools 156 and 270 blocks off.
const POOL_REST_MS = 30 * 60000;
const poolSpent = (l, now = Date.now()) => !!l?.spent && !(now - Date.parse(l.spent) >= POOL_REST_MS);
// The lava a pool arrived at holds: sources with open air over them (its
// own surface), and sources within sixteen blocks under a ledge or in a
// wall, which a bucket takes from the side.
function poolLava(bot, landmark) {
  const at = new Vec3(landmark.x, landmark.y ?? bot.entity.position.y, landmark.z);
  if (ownLava(bot, landmark)) return { open: true, covered: [] };
  const id = bot.registry?.blocksByName?.lava?.id;
  const near = id === undefined || typeof bot.findBlocks !== 'function' ? [] : bot.findBlocks({ matching: id, maxDistance: 48, count: 256, useExtraInfo: b => sourceLava(b) });
  const covered = near.filter(p => Math.hypot(p.x - at.x, p.z - at.z) <= 16 && Math.abs(p.y - at.y) <= 16)
    .sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position));
  return { open: false, covered };
}
// Arrived at a pool with no open lava: its covered sources are gone to
// (within three blocks, where a bucket reaches from the side: collectLava's
// scoop in reach), twice; with none, or not reached, it is found spent for
// now, said with why.
async function arrivedAtPool(bot, task, goal, save, l, navigate) {
  const lava = poolLava(bot, l);
  if (lava.open) return true;
  const src = lava.covered[0];
  const tries = l.covered && Date.now() - l.covered.at < POOL_REST_MS ? l.covered.tries : 0;
  if (src && tries < 2) {
    l.covered = { at: Date.now(), n: lava.covered.length, tries: tries + 1, x: src.x, y: src.y, z: src.z }; save();
    if (bot.entity.position.distanceTo(src.offset(0.5, 0.5, 0.5)) > 3.5) {
      try { await navigate(bot, task, new goals.GoalNear(src.x, src.y, src.z, 3), { timeoutMs: 30000, stallMs: 8000 }); }
      catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
    }
    return false;
  }
  l.spent = new Date().toISOString();
  l.spentWhy = src ? `its ${lava.covered.length} lava source${lava.covered.length === 1 ? '' : 's'} lie covered and none was taken in two tries` : 'no lava source left within sixteen blocks of it';
  delete l.covered;
  save();
  return false;
}

// Every way to lava resting, as the fact Jev is given: the lava known, how
// long until a way into it opens, and why it rests. A step that arrived
// and did nothing said none of this: mid-229-m (tunneling.js lavaResting).
function noLavaWay(bot, goal, surface = []) {
  const { lavaWay, staircaseUntil, staircaseWhy, WaysResting } = require('./tunneling');
  const here = bot.entity.position, now = Date.now();
  const pools = require('./exploration').knownLandmarks(bot, goal, 'lava_pool').filter(k => !poolSpent(k.landmark))
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

module.exports = { wayCosts, poolSpent, poolLava, arrivedAtPool, POOL_REST_MS, lavaRecord, pickFailed, heldLava, holdLava, ownLava, makeObsidian, collectLava, poolSurface, pourSpots, scoopSpots, scoopable, safeCrust, pour, sourceLava, LAVA_DEPTH, CONVERSION_MS, REACH };
