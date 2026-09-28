'use strict';
// A portal frame cast in place: each missing block is a lava bucket poured
// into its slot and water poured on top, and the lava source turns to
// obsidian where it stands. No diamond pickaxe at all. mid-218-a chose a
// ruin with three of ten standing and spent three hours on the diamond route
// to make the other seven (2026-09-26, trial notes 229).
//
// Lava flows down and sideways, never up. Before it goes in, every side of
// the slot and the cell under it is solid, with temporary blocks where
// nothing is: the other slots not yet cast, the frame's inside and corners,
// the cells across the frame on both sides. Only the top is open, which is
// where the lava is poured through and where the water comes onto it.
//
// A filled bucket's ray passes through liquids and empties on the face it
// hits, into the cell on that side: lava is aimed at an inside face of the
// slot's walls, seen down through its open top. Water is never aimed into
// the slot itself (water poured on a lava source replaces it); it goes into
// the cell above, or beside that on solid ground, and runs onto the lava.
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { AXES, across } = require('./ruined-portal');
const { countOf, surveyRoute } = require('./skills');
const { sourceLava, CONVERSION_MS, REACH } = require('./obsidian');
const { fillWaterBucket, sourceWater } = require('./water');
const { checkThreats, threats } = require('./danger');
const { checkAir } = require('./vitals');
const { portalSupports } = require('./build-sites');

const UP = new Vec3(0, 1, 0), DOWN = new Vec3(0, -1, 0);
const SIDES = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
const EYE = 1.62;
// A bucket's use is confirmed by its count as in obsidian.js's pour.
const POUR_MS = 2500;
const AIR = /^(air|cave_air|void_air)$/;
const at = p => new Vec3(p.x, p.y, p.z);
const key = p => `${p.x},${p.y},${p.z}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// What the world looks like to the cast: solid (lava does not flow into
// it), open (nothing in the cell), and what stops a bucket's ray (anything
// but air and liquid; an unloaded cell too).
function view(bot) {
  const b = p => bot.blockAt(p);
  return {
    name: p => b(p)?.name,
    solidAt: p => b(p)?.boundingBox === 'block',
    openAt: p => !!b(p) && AIR.test(b(p).name),
    blocksRay: p => { const x = b(p); return !x || !(AIR.test(x.name) || /^(water|lava)$/.test(x.name)); },
  };
}

// Bottom row first, then the side columns bottom to top, then the top row:
// each slot is cast on something already there.
function castOrder(frame) {
  const o = frame.origin, A = AXES[frame.axis || 'x'];
  const u = p => (p.x - o.x) * A.x + (p.z - o.z) * A.z;
  const row = p => (p.y === o.y ? 0 : p.y === o.y + 4 ? 2 : 1);
  return frame.blocks.map(at).sort((a, b) => row(a) - row(b) || a.y - b.y || u(a) - u(b));
}

// The cells that hold the lava in: below first (a column stands on it),
// then the four sides.
const containment = p => [p.plus(DOWN), ...SIDES.map(s => p.plus(s))];

// Temporary blocks placed where there is nothing to place against: the
// nearest chain of cells from one beside something solid to the cell.
function anchorPath(target, solid, avoid = [], depth = 4) {
  const neighbours = c => [DOWN, ...SIDES, UP].map(d => c.plus(d));
  if (neighbours(target).some(solid)) return [];
  const parent = new Map([[key(target), null]]);
  let frontier = [target];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const c of frontier) for (const n of neighbours(c)) {
      if (parent.has(key(n)) || solid(n) || avoid.some(a => a.equals(n))) continue;
      parent.set(key(n), c);
      if (neighbours(n).some(solid)) {
        const chain = [];
        for (let x = n; x && !x.equals(target); x = parent.get(key(x))) chain.push(x);
        return chain;
      }
      next.push(n);
    }
    frontier = next;
  }
  return null;
}

// The temporary blocks a slot needs before lava goes in, in placing order.
// Never the slot itself or its open top.
function wallsFor(p, solidAt) {
  const placed = new Set(), plan = [];
  const solid = c => solidAt(c) || placed.has(key(c));
  const avoid = [p, p.plus(UP)];
  for (const c of containment(p)) {
    if (solid(c)) continue;
    const chain = anchorPath(c, solid, avoid);
    if (!chain) return null;
    for (const a of [...chain, c]) { placed.add(key(a)); plan.push(a); }
  }
  return plan;
}

// How many temporary blocks a new frame takes at most at once, cast slot
// by slot on flat open ground: the number the option gives Jev.
function plannedWalls(axis = 'x') {
  const origin = new Vec3(0, 0, 0);
  const frame = { origin, axis, blocks: [[1, 0], [2, 0], [1, 4], [2, 4], [0, 1], [0, 2], [0, 3], [3, 1], [3, 2], [3, 3]]
    .map(([u, y]) => origin.plus(AXES[axis].scaled(u)).offset(0, y, 0)) };
  const solid = new Set(), temp = new Set();
  const solidAt = c => c.y < 0 || solid.has(key(c));
  let peak = 0;
  for (const p of castOrder(frame)) {
    temp.delete(key(p));
    for (const c of wallsFor(p, solidAt) || []) { solid.add(key(c)); temp.add(key(c)); }
    peak = Math.max(peak, temp.size);
    solid.add(key(p));
  }
  return peak;
}

// The first cell a ray from `from` to `to` enters that stops it, and the
// face it enters by (pointing back toward `from`).
function firstHit(blocksRay, from, to) {
  const d = to.minus(from), len = d.norm();
  if (!len) return null;
  const o = [from.x, from.y, from.z], v = [d.x / len, d.y / len, d.z / len];
  const cell = o.map(Math.floor), step = v.map(Math.sign);
  const tMax = v.map((c, i) => (c === 0 ? Infinity : (cell[i] + (c > 0 ? 1 : 0) - o[i]) / c));
  const tDelta = v.map(c => (c === 0 ? Infinity : Math.abs(1 / c)));
  for (;;) {
    const i = tMax[0] <= tMax[1] && tMax[0] <= tMax[2] ? 0 : tMax[1] <= tMax[2] ? 1 : 2;
    if (tMax[i] > len) return null;
    cell[i] += step[i]; tMax[i] += tDelta[i];
    const c = new Vec3(cell[0], cell[1], cell[2]);
    if (blocksRay(c)) { const f = [0, 0, 0]; f[i] = -step[i]; return { cell: c, face: new Vec3(f[0], f[1], f[2]) }; }
  }
}

// Where to look to empty a bucket into `into`: a point on a face of a solid
// neighbor that faces it, which the ray from the eye reaches first and
// within the game's reach. The face's middle first.
const SAMPLES = [0.5, 0.25, 0.75];
function pourAim(eye, into, { solidAt, blocksRay }) {
  for (const f of [UP, ...SIDES, DOWN]) {
    const n = into.minus(f);
    if (!solidAt(n)) continue;
    const centre = into.offset(0.5, 0.5, 0.5).minus(f.scaled(0.5));
    const toEye = eye.minus(centre);
    if (toEye.x * f.x + toEye.y * f.y + toEye.z * f.z <= 0) continue;
    const [a1, a2] = ['x', 'y', 'z'].filter(k => f[k] === 0);
    for (const s of SAMPLES) for (const t of SAMPLES) {
      const point = centre.clone();
      point[a1] = into[a1] + s; point[a2] = into[a2] + t;
      const target = point.minus(f.scaled(0.02));
      if (eye.distanceTo(target) > REACH) continue;
      const hit = firstHit(blocksRay, eye, target);
      if (hit && hit.cell.equals(n) && hit.face.equals(f)) return { point: target, into, block: n, face: f };
    }
  }
  return null;
}

// Water onto the lava: into the cell above the slot, or beside that cell on
// solid ground (it runs into the cell above within a block's flow). Not
// where the bot stands.
function waterAim(eye, p, w, exclude = []) {
  const top = p.plus(UP);
  const targets = [top, ...SIDES.map(s => top.plus(s)).filter(c => w.solidAt(c.plus(DOWN)))];
  for (const c of targets) {
    if (!w.openAt(c) || exclude.some(e => e.equals(c))) continue;
    const aim = pourAim(eye, c, w);
    if (aim) return aim;
  }
  return null;
}

// Where the bot can stand to pour both: beside the frame across its axis,
// one or two out, level with the slot or up to two above it, on something
// solid. Never level beside the slot: those cells are its walls. Both
// pours must be there wherever in the block the walk stops (a player's
// half-width either way of the middle), not only from its middle: the
// aims are taken again from where the bot is.
const WIDTH = 0.6;
function standsFor(frame, p, w, { floorless = false } = {}) {
  const axis = frame.axis || 'x', X = across(axis), A = AXES[axis];
  const give = (1 - WIDTH) / 2;
  const out = [];
  for (const side of [-1, 1]) for (const dist of [1, 2]) for (const du of [0, -1, 1]) for (const dy of [1, 0, 2]) {
    const feet = p.plus(X.scaled(side * dist)).plus(A.scaled(du)).offset(0, dy, 0), head = feet.plus(UP);
    // floorless: the cells that would do with a block put under them.
    if ((floorless ? w.solidAt(feet.plus(DOWN)) || !w.openAt(feet.plus(DOWN)) : !w.solidAt(feet.plus(DOWN))) || !w.openAt(feet) || !w.openAt(head)) continue;
    const eyes = [[0, 0], [-give, -give], [-give, give], [give, -give], [give, give]].map(([dx, dz]) => feet.offset(0.5 + dx, EYE, 0.5 + dz));
    const aims = eyes.map(eye => { const lava = pourAim(eye, p, w); return { lava, water: lava && waterAim(eye, p, w, [feet, head]) }; });
    if (aims.every(a => a.lava && a.water)) out.push({ feet, ...aims[0] });
  }
  return out;
}

// The cells the cast works in at a slot: the slot and the cell over it,
// and every cell a stand beside it could take (feet, head and the floor
// under them). A body in one of them is in the cast's way for as long as it
// stays there (work.js buildPortalFrame, note 527).
function workCells(frame, p) {
  const axis = frame.axis || 'x', X = across(axis), A = AXES[axis];
  const cells = [p, p.plus(UP)];
  for (const side of [-1, 1]) for (const dist of [1, 2]) for (const du of [0, -1, 1]) for (const dy of [-1, 0, 1, 2, 3]) {
    cells.push(p.plus(X.scaled(side * dist)).plus(A.scaled(du)).offset(0, dy, 0));
  }
  return cells;
}

// A trip for lava, measured from where the frame stands, not from where
// the bot does: the walk there and back on the level, and the staircase
// back up (or up to it) when the lava is more than eight blocks off level
// (surface.js climbMinutes). mid-244-v stood at the lava, was told "about 5
// seconds there and back a trip" for a frame 122 blocks up, and its trips
// took 5 to 77 minutes, one climb 16 (note 470).
function lavaTrip(from, lava) {
  if (!from || !lava?.at) return null;
  const distance = Math.round(Math.hypot(lava.at.x - from.x, lava.at.y - from.y, lava.at.z - from.z));
  const rise = Math.round(Math.abs(from.y - lava.at.y)), below = Math.round(from.y - lava.at.y);
  const walk = Math.round(distance * 2 / 4.3), climb = rise > 8 ? require('./surface').climbMinutes(rise) * 60 : 0;
  return { distance, rise, below, walk, climb, seconds: walk + climb };
}
const duration = s => s < 120 ? `${s} seconds` : `${Math.round(s / 60)} minutes`;
// The trip said: the walk and the climb, what they come to.
function tripSays(trip) {
  if (!trip.climb) return `about ${duration(trip.seconds)} there and back a trip`;
  const way = trip.below > 0 ? `${trip.rise} blocks below` : `${trip.rise} blocks above`;
  return `about ${duration(trip.seconds)} there and back a trip: the walk ${duration(trip.walk)}, and the lava ${way}, a staircase of about ${duration(trip.climb)} each trip`;
}
// The trips so far, as worked: from leaving the frame for lava to back at
// it pouring (castFrame counts them in the way held).
function tripsSoFar(method) {
  const t = method?.lavaTrips;
  if (!t?.n) return '';
  const each = Math.round(t.ms / t.n / 1000);
  return ` So far ${t.n} trip${t.n === 1 ? '' : 's'} for lava ${t.n === 1 ? 'has' : 'have'} been made, about ${duration(each)} of working time each.`;
}
// The trip for lava, one measure for every way into the Nether: from the
// frame (or here, none begun) to the lava that serves the next bucket and
// back, the climb in it; and once trips have been made for this frame,
// their working time each, which is what a trip has cost, pouring,
// scooping and the ways round included. mid-242-aa was told a trip was "a
// few seconds" (the lava chosen before, no longer scooped from), eighty
// seconds (the pool that served, reckoned) and four minutes (measured) in
// one question, three prices for the same fetch (note 553).
function fetchTrip(from, lava, method = null) {
  if (!lava) return null;
  const walk = Math.round(lava.distance * 2 / 4.3);
  const trip = lavaTrip(from, lava) || { distance: lava.distance, rise: 0, below: 0, walk, climb: 0, seconds: walk };
  const t = method?.lavaTrips;
  if (!t?.n) return trip;
  return { ...trip, reckoned: trip.seconds, made: t.n, seconds: Math.max(1, Math.round(t.ms / t.n / 1000)) };
}
// The trip said, the same words wherever it is said.
function fetchSays(trip) {
  if (!trip.made) return tripSays(trip);
  return `about ${duration(trip.seconds)} a trip, as the ${trip.made} trip${trip.made === 1 ? '' : 's'} for lava made so far took in working time (from leaving the frame to pouring), against ${tripSays({ ...trip, seconds: trip.reckoned }).replace(' there and back a trip', ' there and back reckoned')}`;
}
// The trips' time together, at the trip's one price.
const tripsCost = (trip, n) => duration(n * trip.seconds);

// How many trips for lava the cast still takes.
function castTrips({ obsidian = 0, standing = 0, buckets = 0, lavaBuckets = 0 }) {
  const cast = Math.max(0, 10 - standing - obsidian), carriers = buckets + lavaBuckets, toFetch = Math.max(0, cast - lavaBuckets);
  return { cast, carriers, toFetch, trips: carriers ? Math.ceil(toFetch / carriers) : toFetch };
}

// The portal_method option, said with what it needs against what is
// carried, the trips to lava it takes and how far the lava is.
// The frame's blocks already standing are not cast again: mid-207-i was
// told "10 of the ten to cast" with 3 standing (2026-09-27).
// The lava's distance and each trip are from the frame (`from`), or from
// here when none is begun (note 470).
// The trip is the one every way says (fetchTrip), passed in when it is.
function castSays({ obsidian = 0, standing = 0, waterBucket = false, buckets = 0, lavaBuckets = 0, iron = 0, walls, blocks = 0, lighter = false, lava = null, from = null, frameBegun = false, method = null, trip = fetchTrip(from, lava, method) }) {
  const { cast, carriers, toFetch, trips } = castTrips({ obsidian, standing, buckets, lavaBuckets });
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // Each trip carries one lava per bucket held, and the iron in hand makes
  // more: mid-237-d cast with one bucket and eight ingots in its pockets.
  const more = Math.floor(iron / 3);
  const tripsSay = (carriers
    ? `Each block is one lava bucket and each trip carries one lava per bucket held, so with ${plural(carriers, 'bucket')} that is about ${plural(trips, 'trip')} to lava.`
    : `With no bucket carried one has to be made first; each block is one lava bucket, so with one that is ${plural(trips, 'trip')} to lava.`) +
    (more && toFetch ? ` The ${iron} iron ingots carried make ${plural(more, 'more bucket')}, about ${plural(Math.ceil(toFetch / (Math.max(1, carriers) + more)), 'trip')} with them.` : '');
  const lavaSay = lava && trip ? `The nearest known lava is ${trip.distance} blocks ${frameBegun ? 'from the frame' : 'away'} (${lava.how}): ${fetchSays(trip)}, ${tripsCost(trip, trips)} in all.`
    : 'No lava is known nearby: a pool has to be found first.';
  return `Build a portal frame of its own and cast each missing block in place, with no diamond pickaxe: the bot walls a frame slot round with temporary blocks, pours a lava bucket into it, pours water on top and takes the water back, and the lava source turns to obsidian. ${cast} of the ten to cast (${standing ? `${standing} standing, ` : ''}${obsidian} obsidian carried, placed as it is). ` +
    `Needs: a water bucket (${waterBucket ? 'one carried' : 'none carried'}); a lava bucket for each block (${plural(buckets, 'empty bucket')} and ${lavaBuckets} full of lava carried; a bucket is three iron ingots, ${iron} carried); ` +
    `about ${walls} ordinary blocks for the temporary walls, those inside the frame dug out before lighting (${blocks} carried); flint and steel or a fire charge (${lighter ? 'carried' : 'none carried'}). ${tripsSay} ${lavaSay}`;
}

async function waitUntil(task, done, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { task.check(); if (done()) return true; await sleep(25); }
  return done();
}

// Empty a filled bucket along an aim; done when the fluid is where it was
// aimed. A bucket emptied with the fluid somewhere else is said as such.
async function pourAlong(bot, task, item, aim, done) {
  const held = bot.inventory.items().find(i => i.name === item);
  if (!held) throw new Error(`No ${item.replaceAll('_', ' ')} to pour`);
  await bot.equip(held, 'hand'); task.check();
  await bot.lookAt(aim.point, true); task.check();
  const before = countOf(bot, item);
  bot.activateItem();
  try {
    if (await waitUntil(task, () => done() || countOf(bot, item) < before, POUR_MS) && done()) return;
    // The block update can trail the inventory's.
    if (countOf(bot, item) < before) {
      if (await waitUntil(task, done, POUR_MS)) return;
      throw new Error(`The ${item.replace('_bucket', '')} went somewhere other than ${aim.into}`);
    }
    throw new Error(`No ${item.replace('_bucket', '')} was poured`);
  } finally { bot.deactivateItem(); }
}

const fatal = err => ['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name);

// Scoop back the water a cast left, when it is still a source, walking
// back to it first: from out of reach the scoop failed every pass, quietly,
// and the water it left ran on into the next slot. mid-229-d waited on
// that slot to drain for twenty minutes while it wandered fifty blocks off
// (2026-09-27).
async function takeWaterBack(bot, task, frame, save, navigate) {
  if (!frame.castWater) return;
  const w = at(frame.castWater);
  if (!bot.blockAt(w) || !sourceWater(bot.blockAt(w))) { delete frame.castWater; save(); return; }
  await scoopSource(bot, task, w, navigate, err => { frame.castWaterError = err.message; save(); });
  if (!sourceWater(bot.blockAt(w))) { delete frame.castWater; save(); }
}
async function scoopSource(bot, task, w, navigate, failed) {
  try {
    const eye = bot.entity.position.offset(0, EYE, 0);
    if (navigate && eye.distanceTo(w.offset(0.5, 0.5, 0.5)) > REACH - 0.5) await navigate(bot, task, new goals.GoalNear(w.x, w.y, w.z, 2), { timeoutMs: 20000, stallMs: 5000 });
    await fillWaterBucket(bot, task, w, { guard: () => checkThreats(bot) });
  } catch (err) { task.check(); if (fatal(err)) throw err; failed(err); }
}
// The water sources that can run into a slot: at its level or above, within
// three blocks, the way flowing water comes (a source runs seven blocks, but
// the slot's walls leave only the top open).
function feedingSources(bot, p) {
  const out = [];
  for (let dy = 0; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
    const q = p.offset(dx, dy, dz), b = bot.blockAt(q);
    if (b && sourceWater(b)) out.push(q);
  }
  return out.sort((a, b) => a.distanceTo(p) - b.distanceTo(p));
}

// Cast the frame's missing slots in order. True when all ten are obsidian;
// false when a pass ends for a trip (lava, the water bucket, blocks for the
// walls) or a wait, and the loop comes back to it.
async function castFrame(bot, task, goal, save, actions) {
  const { navigate, place, dig, acquireStep } = actions;
  const route = actions.surveyRoute || surveyRoute;
  const frame = goal.portalFrame, w = view(bot);
  frame.castTemp ||= [];
  const check = () => { task.check(); checkAir(bot); checkThreats(bot); };
  const untrack = p => { frame.castTemp = frame.castTemp.filter(t => !at(t).equals(p)); };
  const track = (p, material) => { untrack(p); frame.castTemp.push({ x: p.x, y: p.y, z: p.z, material }); };
  const stepIs = (p, phase, extra = {}) => { delete frame.fetchingLava; goal.step = { action: 'cast_portal', item: 'obsidian', slot: { x: p.x, y: p.y, z: p.z }, phase, ...extra }; save(); };
  const order = castOrder(frame);
  for (const p of order) {
    if (w.name(p) === 'obsidian') continue;
    if (!bot.blockAt(p)) return false;
    check();
    await takeWaterBack(bot, task, frame, save, navigate);
    if (!sourceLava(bot.blockAt(p))) {
      if (/water/.test(w.name(p) || '')) {
        // Water left from the slot below runs off once its source is gone.
        // A source never does: a block put in it takes it, and comes out
        // again below as any temporary block does.
        const material = portalSupports(bot).material;
        if (!sourceWater(bot.blockAt(p)) || !material) {
          // Flowing water drains once nothing feeds it: a source that does
          // (the cast's own left behind, or one beside the frame) is scooped.
          const feeder = !sourceWater(bot.blockAt(p)) ? feedingSources(bot, p)[0] : null;
          // A feeder the bucket cannot reach (walled in by the cast's own
          // temporary blocks, no bucket, or a scoop that failed there) is
          // filled with a block instead, tracked like the others: mid-242-r
          // tried to scoop a source inside its own walls round after round
          // until the loop watch ended the trial (note 453).
          const scoopFailed = feeder && frame.castWaterFailedAt?.key === `${feeder}` && frame.castWaterFailedAt.n >= 1;
          if (feeder && material && (scoopFailed || !countOf(bot, 'bucket'))) {
            stepIs(p, 'fill_source', { source: { x: feeder.x, y: feeder.y, z: feeder.z } });
            try { await place(bot, task, feeder, material); track(feeder, material); delete frame.castWaterFailedAt; save(); }
            catch (err) { task.check(); if (fatal(err)) throw err; frame.castWaterError = err.message; save(); }
            return false;
          }
          if (feeder && countOf(bot, 'bucket')) {
            stepIs(p, 'stop_water', { source: { x: feeder.x, y: feeder.y, z: feeder.z } });
            const had = countOf(bot, 'water_bucket');
            await scoopSource(bot, task, feeder, navigate, err => { frame.castWaterError = err.message; save(); });
            if (countOf(bot, 'water_bucket') <= had && sourceWater(bot.blockAt(feeder))) {
              const prev = frame.castWaterFailedAt?.key === `${feeder}` ? frame.castWaterFailedAt.n : 0;
              frame.castWaterFailedAt = { key: `${feeder}`, n: prev + 1 }; save();
            }
            return false;
          }
          stepIs(p, 'drain'); await sleep(500); return false;
        }
        stepIs(p, 'displace_water'); await place(bot, task, p, material); track(p, material); save();
      }
      if (/lava/.test(w.name(p) || '')) throw new Error(`Flowing lava in the frame slot at ${p}: its walls are not whole`);
      // A temporary block in the slot comes out before it is cast.
      if (!w.openAt(p)) { stepIs(p, 'clear_slot', { block: w.name(p) }); await dig(bot, task, p, { requireDrops: false }); untrack(p); save(); }
      if (countOf(bot, 'obsidian')) {
        const chain = anchorPath(p, w.solidAt, [p.plus(UP)]) || [];
        for (const c of chain) {
          const material = portalSupports(bot).material;
          if (!material) break;
          stepIs(p, 'anchor'); await place(bot, task, c, material); track(c, material); save();
        }
        stepIs(p, 'place'); await place(bot, task, p, 'obsidian');
        continue;
      }
      if (!countOf(bot, 'water_bucket')) { stepIs(p, 'water_bucket'); await acquireStep(bot, task, 'water_bucket', 1, goal, save); return false; }
      if (!countOf(bot, 'lava_bucket')) {
        // As many as the empty buckets carried hold, up to what is left.
        const left = order.filter(q => w.name(q) !== 'obsidian').length;
        const want = Math.max(1, Math.min(left, countOf(bot, 'bucket')));
        // A trip begins here and ends at the next pour, timed by the way's
        // working clock: the pace so far, said beside the estimate (note 470).
        const m = goal.portalMethod;
        if (m && !Number.isFinite(m.tripFrom)) m.tripFrom = m.activeMs || 0;
        // Named once a fetch, not once a pass: the fetch's own steps (the
        // fill's staircase, a stair a pass) took the name back every pass,
        // two changes a stair, and mid-242-aa's stairs toward its pool,
        // four blocks in five seconds, were raised as a flip between the
        // cast and the fill without getting anywhere (note 546). Any other
        // phase of the cast names it afresh.
        if (!frame.fetchingLava) { stepIs(p, 'fetch_lava', { buckets: want, left }); frame.fetchingLava = true; }
        await acquireStep(bot, task, 'lava_bucket', want, goal, save); return false;
      }
      const walls = wallsFor(p, w.solidAt);
      if (!walls) throw new Error(`Nothing to build the walls round the frame slot at ${p} against`);
      const supplies = portalSupports(bot);
      if (supplies.count < walls.length) {
        const material = supplies.material || 'cobblestone';
        stepIs(p, 'wall_blocks', { needed: walls.length, carried: supplies.count });
        await acquireStep(bot, task, material, countOf(bot, material) + walls.length - supplies.count, goal, save);
        return false;
      }
      for (const c of walls) {
        check();
        const material = portalSupports(bot).material;
        if (!material) return false;
        stepIs(p, 'wall', { at: { x: c.x, y: c.y, z: c.z } });
        await place(bot, task, c, material); track(c, material); save();
      }
    }
    // The slot's top is the one way in for the lava and the water: a block
    // standing on it (a scaffold of the walk's, a stand's anchor) comes
    // out. mid-242-ab had a cobblestone on its last slot; no stand could
    // see into it, and "nowhere to stand to pour" came back 3,463 times
    // (note 560).
    const top = p.plus(UP);
    if (w.solidAt(top) && !/obsidian|bedrock/.test(w.name(top) || '')) {
      stepIs(p, 'clear_top', { block: w.name(top) });
      await dig(bot, task, top, { requireDrops: false }); untrack(top); save();
      return false;
    }
    // Where to stand: beside the frame, where both pours can be made.
    const stands = standsFor(frame, p, w).sort((a, b) => a.feet.distanceTo(bot.entity.position) - b.feet.distanceTo(bot.entity.position));
    let stand = stands.find(s => s.feet.equals(bot.entity.position.floored()));
    // Walked to if a walk reaches one; else built up to, a block at a time
    // with the blocks carried, as a player pillars beside a frame for its
    // top row. mid-244-r made a stand four blocks up for the top slot, no
    // walk reached it, the next round found no stand left to make, and
    // "nowhere to stand" flipped with the way in until the loop watch
    // ended the trial (note 425).
    const movements = bot.pathfinder.movements;
    const scaffold = portalSupports(bot).material;
    const scaffoldId = scaffold && bot.registry?.itemsByName?.[scaffold]?.id;
    for (const tower of scaffoldId === undefined ? [false] : [false, true]) {
      if (stand) break;
      const saved = { allow1by1towers: movements.allow1by1towers, scafoldingBlocks: movements.scafoldingBlocks };
      if (tower) Object.assign(movements, { allow1by1towers: true, scafoldingBlocks: [...new Set([...(movements.scafoldingBlocks || []), scaffoldId])] });
      try {
        for (const s of stands.slice(0, 6)) {
          task.check();
          const destination = new goals.GoalBlock(s.feet.x, s.feet.y, s.feet.z);
          if ((await route(bot, task, movements, destination, 500)).status !== 'success') continue;
          stepIs(p, 'to_stand', { stand: { x: s.feet.x, y: s.feet.y, z: s.feet.z }, ...(tower ? { built: true } : {}) });
          try { await navigate(bot, task, destination, { timeoutMs: 30000, stallMs: 5000 }); }
          catch (err) { task.check(); if (fatal(err)) throw err; continue; }
          if (bot.entity.position.floored().equals(s.feet)) { stand = s; break; }
        }
      } finally { if (tower) Object.assign(movements, saved); }
    }
    // From a lava trip the stands are too far off to survey a route to in
    // the time: to the frame first.
    if (!stand && bot.entity.position.offset(0, EYE, 0).distanceTo(p) > REACH) {
      stepIs(p, 'to_frame');
      await navigate(bot, task, new goals.GoalNear(p.x, p.y, p.z, 3), { timeoutMs: 60000, stallMs: 8000 });
      return false;
    }
    // Water still running off the last slot fills the cells to stand in
    // for a moment.
    if (!stand && wetAbout(bot, p)) { stepIs(p, 'drain'); await sleep(500); return false; }
    // No cell beside the slot has a floor: one is made, a temporary block
    // put under a cell that would do otherwise. mid-218-c's part-cast frame
    // had no floor beside its next slot, and "nowhere to stand" came back
    // two hundred times (2026-09-27).
    if (!stand) {
      const material = portalSupports(bot).material;
      const make = material && standsFor(frame, p, w, { floorless: true })
        .map(s => ({ s, chain: anchorPath(s.feet.plus(DOWN), w.solidAt, [p, top, s.feet, s.feet.plus(UP), ...frame.blocks.map(at)]) }))
        .filter(x => x.chain && x.chain.length <= 2)
        .sort((a, b) => a.chain.length - b.chain.length || a.s.feet.distanceTo(bot.entity.position) - b.s.feet.distanceTo(bot.entity.position))[0];
      if (make) {
        for (const c of [...make.chain, make.s.feet.plus(DOWN)]) {
          stepIs(p, 'make_stand', { at: { x: c.x, y: c.y, z: c.z } });
          await place(bot, task, c, material); track(c, material); save();
        }
        return false;
      }
      // Nor a cell with its floor that is open: the frame is in a hillside.
      // A stand is dug out beside the slot, feet and head, never a frame
      // cell, the slot's own walls or a temporary block (mid-242-i, a
      // hundred and seven times, 2026-09-27).
      const axis = frame.axis || 'x', X = across(axis), A = AXES[axis];
      const keep = new Set([...frame.blocks.map(at), ...wallsFor(p, w.solidAt), ...(frame.castTemp || []).map(at)].map(key));
      const diggable = c => { const b = bot.blockAt(c); return !!b && b.boundingBox === 'block' && b.diggable !== false && !/obsidian|bedrock/.test(b.name) && !keep.has(key(c)); };
      const cut = [];
      for (const side of [-1, 1]) for (const dist of [2, 1]) for (const dy of [0, 1]) {
        const feet = p.plus(X.scaled(side * dist)).offset(0, dy, 0), head = feet.plus(UP);
        if (!w.solidAt(feet.plus(DOWN)) || keep.has(key(feet)) || keep.has(key(head))) continue;
        const digs = [feet, head].filter(c => !w.openAt(c));
        if (digs.every(diggable)) cut.push({ feet, digs });
      }
      cut.sort((a, b) => a.digs.length - b.digs.length || a.feet.distanceTo(bot.entity.position) - b.feet.distanceTo(bot.entity.position));
      if (cut[0]?.digs.length) {
        for (const c of cut[0].digs) { stepIs(p, 'dig_stand', { at: { x: c.x, y: c.y, z: c.z } }); await dig(bot, task, c, { requireDrops: false }); }
        return false;
      }
      throw new Error(`Nowhere to stand to pour into the frame slot at ${p}`);
    }
    const eye = () => bot.entity.position.offset(0, EYE, 0);
    const exclude = () => { const f = bot.entity.position.floored(); return [f, f.plus(UP)]; };
    if (!sourceLava(bot.blockAt(p))) {
      // Nothing at the lava with a mob in view, as at a pool (obsidian.js).
      if (threats(bot).some(t => t.visible && t.distance < 16)) { stepIs(p, 'wait_for_quiet'); await sleep(1000); return false; }
      check();
      if (wallsOpen(p, w)) throw new Error(`The walls round the frame slot at ${p} are not whole`);
      const aim = pourAim(eye(), p, w);
      if (!aim) throw new Error(`No line into the frame slot at ${p} from where I stand`);
      const m = goal.portalMethod;
      if (m && Number.isFinite(m.tripFrom)) {
        const t = m.lavaTrips ||= { n: 0, ms: 0 };
        t.n++; t.ms += Math.max(0, (m.activeMs || 0) - m.tripFrom); delete m.tripFrom;
      }
      stepIs(p, 'lava');
      await pourAlong(bot, task, 'lava_bucket', aim, () => sourceLava(bot.blockAt(p)));
    }
    check();
    // Lava walled in keeps while the water bucket is fetched.
    if (!countOf(bot, 'water_bucket')) { stepIs(p, 'water_bucket'); await acquireStep(bot, task, 'water_bucket', 1, goal, save); return false; }
    const water = waterAim(eye(), p, w, exclude());
    if (!water) throw new Error(`No place to pour water onto the lava in the frame slot at ${p}`);
    stepIs(p, 'water', { water: { x: water.into.x, y: water.into.y, z: water.into.z } });
    await pourAlong(bot, task, 'water_bucket', water, () => /water/.test(w.name(water.into) || '') || w.name(p) === 'obsidian');
    frame.castWater = { x: water.into.x, y: water.into.y, z: water.into.z }; save();
    const cast = await waitUntil(task, () => w.name(p) === 'obsidian', CONVERSION_MS);
    await takeWaterBack(bot, task, frame, save, navigate);
    if (!cast) throw new Error(`The lava in the frame slot at ${p} did not turn to obsidian`);
  }
  return true;
}

// Any of the slot's walls missing (the pathfinder's own digging, a creeper).
const wallsOpen = (p, w) => containment(p).some(c => !w.solidAt(c));
// Running water (not a source, which never drains) anywhere a stand for
// the slot is looked for.
function wetAbout(bot, p) {
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy <= 3; dy++) {
    const b = bot.blockAt(p.offset(dx, dy, dz));
    if (b?.name === 'water' && !sourceWater(b)) return true;
  }
  return false;
}

module.exports = { castFrame, castOrder, workCells, containment, wallsFor, anchorPath, plannedWalls, firstHit, pourAim, waterAim, standsFor, castSays, lavaTrip, tripSays, tripsSoFar, fetchTrip, fetchSays, tripsCost, castTrips, duration, view };
