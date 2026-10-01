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
// Walks to a stand made for a slot in one pass, while each gets nearer (a tower's blocks).
const STAND_WALKS = 8;
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
// `pass`: stands passed over for this slot (the repair Jev chose at a
// failure there, note 767); `missed`: cells a pour of water aimed at here
// went elsewhere from, not aimed at again.
function standsFor(frame, p, w, { floorless = false, pass = [], missed = [] } = {}) {
  const axis = frame.axis || 'x', X = across(axis), A = AXES[axis];
  const give = (1 - WIDTH) / 2;
  const passed = new Set(pass.map(key));
  const out = [];
  for (const side of [-1, 1]) for (const dist of [1, 2]) for (const du of [0, -1, 1]) for (const dy of [1, 0, 2]) {
    const feet = p.plus(X.scaled(side * dist)).plus(A.scaled(du)).offset(0, dy, 0), head = feet.plus(UP);
    if (passed.has(key(feet))) continue;
    // floorless: the cells that would do with a block put under them.
    if ((floorless ? w.solidAt(feet.plus(DOWN)) || !w.openAt(feet.plus(DOWN)) : !w.solidAt(feet.plus(DOWN))) || !w.openAt(feet) || !w.openAt(head)) continue;
    const eyes = [[0, 0], [-give, -give], [-give, give], [give, -give], [give, give]].map(([dx, dz]) => feet.offset(0.5 + dx, EYE, 0.5 + dz));
    const aims = eyes.map(eye => { const lava = pourAim(eye, p, w); return { lava, water: lava && waterAim(eye, p, w, [feet, head, ...missed]) }; });
    if (aims.every(a => a.lava && a.water)) out.push({ feet, ...aims[0] });
  }
  return out;
}
// What the cast keeps of a slot's failures: the stands passed over (Jev's
// repair) and the cells a water pour went elsewhere from (note 767).
const slotPass = (frame, p) => (frame.passStands?.[key(p)] || []).map(at);
const slotMissed = (frame, p) => (frame.missedAims?.[key(p)] || []).map(at);
// What the walks to a slot's stands came to, in a few words.
function triesSays(tries) {
  if (!tries.length) return 'none tried';
  const n = {}, last = new Map();
  for (const t of tries) last.set(key(t.s.feet), t);
  for (const t of last.values()) {
    const k = t.status === 'noPath' ? 'the route search found no path to' : t.status === 'timeout' ? 'the route search ran out of its half second to'
      : t.status ? `the route search came back ${t.status} to` : t.whole ? `the whole walk ended (${t.walk}) to` : `the walk ended (${t.walk}) to`;
    n[k] = (n[k] || 0) + 1;
  }
  return `none reached: ${Object.entries(n).map(([k, c]) => `${k} ${c}`).join(', ')}`;
}

// The blocks that stand between the open cells beside a slot and its open
// top: the first block in each line of sight from where a body could stand,
// that can be dug (not the frame, the slot's walls or bedrock). What
// "clear the blocker" digs (note 767).
function blockersFor(bot, frame, p, w = view(bot)) {
  const axis = frame.axis || 'x', X = across(axis), A = AXES[axis];
  const keep = new Set([...frame.blocks.map(at), ...containment(p), ...(wallsFor(p, w.solidAt) || []), p, p.plus(UP)].map(key));
  const out = new Map();
  for (const side of [-1, 1]) for (const dist of [1, 2]) for (const du of [0, -1, 1]) for (const dy of [0, 1, 2]) {
    const feet = p.plus(X.scaled(side * dist)).plus(A.scaled(du)).offset(0, dy, 0), head = feet.plus(UP);
    if (!w.solidAt(feet.plus(DOWN)) || !w.openAt(feet) || !w.openAt(head) || keep.has(key(feet))) continue;
    const hit = firstHit(w.blocksRay, feet.offset(0.5, EYE, 0.5), p.offset(0.5, 0.98, 0.5));
    if (!hit || hit.cell.equals(p) || keep.has(key(hit.cell))) continue;
    const b = bot.blockAt(hit.cell);
    if (!b || b.diggable === false || /obsidian|bedrock|lava|water/.test(b.name)) continue;
    out.set(key(hit.cell), { at: hit.cell, name: b.name, from: feet });
  }
  return [...out.values()];
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
  // The walk at the bot's measured pace to lava (note 763: 38.5 blocks a
  // minute over 592 walks; at 4.3 blocks a second "147 blocks off, about 35
  // seconds" took three to nine minutes), the climb at its measured pace.
  const L = require('./levels');
  const walk = L.walkSeconds(distance * 2), climb = rise > 8 ? L.upSeconds(rise) : 0;
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
  const walk = require('./levels').walkSeconds(lava.distance * 2);
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

// What a cast asks for first at every slot is the water bucket (castFrame
// fetches it before the lava): with none carried and no obsidian to place
// as it is, nothing at the frame can go on, and no water of the cast's own
// stands there to be scooped back. The trip for it is made from wherever the
// bot is, not after a walk to the frame that the search for water then undoes
// at every pass: mid-243-bd walked back to a frame at y 110 at every
// pass between short legs toward a river seventy-two blocks off (note 630).
function castLacksWater(bot, frame) {
  if (!frame?.cast) return false;
  if (countOf(bot, 'obsidian') || countOf(bot, 'water_bucket')) return false;
  if (frame.castWater || frame.castWaterLeft?.length) return false;
  return true;
}

async function waitUntil(task, done, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { task.check(); if (done()) return true; await sleep(25); }
  return done();
}

// The sources of a fluid within four blocks of a cell, by key.
function sourcesAbout(bot, c, fluid) {
  const out = new Set();
  for (let dx = -4; dx <= 4; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -4; dz <= 4; dz++) {
    const q = c.offset(dx, dy, dz), b = bot.blockAt(q);
    if (b?.name === fluid && Number(b.getProperties?.().level ?? b.metadata ?? 0) === 0) out.add(key(q));
  }
  return out;
}
// Empty a filled bucket along an aim; done when the fluid is where it was
// aimed. A bucket emptied with the fluid somewhere else is said as such,
// with where it went: a new source of it near the aim (err.went). The block
// update can trail the inventory's by seconds on a loaded server (2-4 s
// stalls with twenty trials running), so the wait for it is five seconds.
async function pourAlong(bot, task, item, aim, done, pourMs = POUR_MS) {
  const held = bot.inventory.items().find(i => i.name === item);
  if (!held) throw new Error(`No ${item.replaceAll('_', ' ')} to pour`);
  await bot.equip(held, 'hand'); task.check();
  await bot.lookAt(aim.point, true); task.check();
  const fluid = item.replace('_bucket', '');
  const seen = sourcesAbout(bot, aim.into, fluid);
  const before = countOf(bot, item);
  bot.activateItem();
  try {
    if (await waitUntil(task, () => done() || countOf(bot, item) < before, pourMs) && done()) return;
    if (countOf(bot, item) < before) {
      if (await waitUntil(task, done, 2 * pourMs)) return;
      const went = [...sourcesAbout(bot, aim.into, fluid)].filter(k => !seen.has(k)).map(k => { const [x, y, z] = k.split(',').map(Number); return new Vec3(x, y, z); });
      throw Object.assign(new Error(`The ${fluid} went somewhere other than ${aim.into}${went.length ? `: it stands at ${went.join(', ')}` : ': no new source of it seen within four blocks'}`), { went, missed: aim.into });
    }
    throw new Error(`No ${fluid} was poured`);
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
// A dry place to stand within reach of a block: feet and head in air (not
// water), a floor under them, the eyes within reach. The walk to a water
// source the cast must scoop or fill went to within two blocks of it, into
// the water the source spreads, and stalled there: 25589 (mid-243-kd,
// 2026-09-30 14:56:44-15:03Z) walked for the source at (13, 70, -5) over its
// frame about 25 times, each a navigation stall in the flow at (15, 68, -9),
// was worked out of the water by unstuck_move 22 times, and walked straight
// back in (note 753c). Null when none; `here` when the bot stands in one.
function dryReach(bot, target, avoid = []) {
  const keys = new Set(avoid.map(key)), aim = target.offset(0.5, 0.5, 0.5);
  const air = c => { const b = bot.blockAt(c); return !!b && AIR.test(b.name); };
  const dry = c => air(c) && air(c.plus(UP)) && bot.blockAt(c.plus(DOWN))?.boundingBox === 'block' && !/water/.test(bot.blockAt(c.plus(DOWN))?.name || '') && !keys.has(key(c)) && !keys.has(key(c.plus(UP)));
  // In reach and in sight: the bucket's use is checked along the line from
  // the eyes, and a dry place behind the cast's own walls was walked to and
  // the scoop refused, "Water source is outside visible interaction reach":
  // 25597 (mid-236-af, 2026-10-01 04:16:53-04:17:34Z) lost the cast's water
  // so and walked 55 blocks for more, three times (note 767f).
  const w = view(bot);
  const reach = c => { const eye = c.offset(0.5, EYE, 0.5); return eye.distanceTo(aim) <= REACH - 0.3 && !firstHit(p => !(p.equals(c) || p.equals(c.plus(UP))) && w.blocksRay(p), eye, aim); };
  const feet = bot.entity.position.floored();
  if (dry(feet) && reach(feet)) return 'here';
  const out = [];
  for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let dy = -3; dy <= 2; dy++) {
    const c = target.offset(dx, dy, dz);
    if (dry(c) && reach(c)) out.push(c);
  }
  return out.sort((a, b) => a.distanceTo(feet) - b.distanceTo(feet))[0] || null;
}
// To a dry place in reach of `target`, walked; throws with why when there is
// none or the walk does not get there.
async function toDryReach(bot, task, target, navigate, avoid = []) {
  const stand = dryReach(bot, target, avoid);
  if (stand === 'here') return;
  // None dry: waded to where the water is shallow, as a player fills a
  // bucket standing in it (note 753e); dry ground first, the flow of the
  // cast's own water having held 25589 in it for six minutes (note 753c).
  if (!stand && require('./water').wadeable(bot, target)) {
    if (navigate) await navigate(bot, task, new goals.GoalNear(target.x, target.y, target.z, 2), { timeoutMs: 20000, stallMs: 5000 });
    return;
  }
  if (!stand) throw new Error(`No dry place to stand within reach of ${target}, and the water there is too deep to wade: every cell in reach is water or has no floor`);
  if (navigate) await navigate(bot, task, new goals.GoalBlock(stand.x, stand.y, stand.z), { timeoutMs: 20000, stallMs: 5000 });
  if (!bot.entity.position.floored().equals(stand)) throw new Error(`Did not reach the dry place at ${stand} beside ${target}`);
}
async function scoopSource(bot, task, w, navigate, failed, avoid = []) {
  try {
    const eye = bot.entity.position.offset(0, EYE, 0);
    const wet = /water/.test(bot.blockAt(bot.entity.position.floored())?.name || '');
    if (navigate && (wet || eye.distanceTo(w.offset(0.5, 0.5, 0.5)) > REACH - 0.5)) await toDryReach(bot, task, w, navigate, avoid);
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
// The ways to a stand for a slot, counted and said: stands a pour reaches
// the slot from, cells a block put under would make one (an anchor within
// two), cells to dig out beside it, and open cells with a floor whose line
// into the slot is blocked. For the failure's words, and the check made
// before a lava fetch (note 753b).
function standWays(bot, frame, p, w, opts = {}) {
  const stands = standsFor(frame, p, w, opts).length;
  const top = p.plus(UP);
  const make = portalSupports(bot).material ? standsFor(frame, p, w, { floorless: true })
    .filter(s => { const chain = anchorPath(s.feet.plus(DOWN), w.solidAt, [p, top, s.feet, s.feet.plus(UP), ...frame.blocks.map(at)]); return chain && chain.length <= 2; }).length : 0;
  const axis = frame.axis || 'x', X = across(axis);
  const keep = new Set([...frame.blocks.map(at), ...containment(p), ...(wallsFor(p, w.solidAt) || []), ...(frame.castTemp || []).map(at)].map(key));
  let cut = 0, blocked = 0;
  for (const side of [-1, 1]) for (const dist of [2, 1]) for (const dy of [0, 1]) {
    const feet = p.plus(X.scaled(side * dist)).offset(0, dy, 0), head = feet.plus(UP);
    if (!w.solidAt(feet.plus(DOWN)) || keep.has(key(feet)) || keep.has(key(head))) continue;
    const digs = [feet, head].filter(c => !w.openAt(c));
    if (!digs.length) blocked++;
    else if (digs.every(c => { const b = bot.blockAt(c); return !!b && b.boundingBox === 'block' && b.diggable !== false && !/obsidian|bedrock/.test(b.name); })) cut++;
  }
  const says = `${stands} stand${stands === 1 ? '' : 's'} beside it a pour reaches it from, ${make} to make with a block put under, ${cut} to dig out, and ${blocked} open cell${blocked === 1 ? '' : 's'} with a floor that ${blocked === 1 ? 'is' : 'are'} not yet a stand (the slot's walls not up, or the line into it blocked)`;
  return { stands, make, cut, blocked, says };
}

async function castFrame(bot, task, goal, save, actions) {
  const { navigate, place, dig } = actions;
  // A fetch the cast makes (the water bucket, lava, blocks for its walls)
  // that fails is the trip's failure, not the site's (work.js
  // buildPortalFrame, note 767): "Water source is outside visible
  // interaction reach" was the second reason the cast failed at its site
  // (33 of 167 failures since 15:24Z on 2026-09-30), each counted toward
  // leaving a frame the water could have been fetched to from anywhere.
  const acquireStep = async (...a) => {
    try { return await actions.acquireStep(...a); }
    catch (err) { if (err && typeof err === 'object' && !fatal(err)) err.castTrip = true; throw err; }
  };
  const route = actions.surveyRoute || surveyRoute;
  const frame = goal.portalFrame, w = view(bot);
  frame.castTemp ||= [];
  const check = () => { task.check(); checkAir(bot); checkThreats(bot); };
  const untrack = p => { frame.castTemp = frame.castTemp.filter(t => !at(t).equals(p)); };
  const track = (p, material) => { untrack(p); frame.castTemp.push({ x: p.x, y: p.y, z: p.z, material }); };
  const stepIs = (p, phase, extra = {}) => { delete frame.fetchingLava; goal.step = { action: 'cast_portal', item: 'obsidian', slot: { x: p.x, y: p.y, z: p.z }, phase, ...extra }; save(); };
  const order = castOrder(frame);
  // At a stand: in its cell across, and its height within half a block. A
  // walk that ends on a block a little under full height (a path, farmland,
  // soul sand, a slab) floors a cell below the stand and was taken for a
  // walk that did not get there: 25589 (2026-09-30 20:20:40Z) and 25595
  // (21:24:50Z) each failed "could not be walked to from" the cell right
  // under the stand made for the slot, and left the frame at 6 and 7 of
  // ten (note 767). The pours are aimed from the eyes where they are.
  const atStand = feet => { const q = bot.entity.position; return Math.floor(q.x) === feet.x && Math.floor(q.z) === feet.z && Math.abs(q.y - feet.y) < 0.6; };
  // The stands a slot's failures came at, for portal_method's other_stand
  // (note 767).
  const triedAt = (p, cells) => {
    const list = ((frame.standsTried ||= {})[key(p)] ||= []);
    for (const c of cells) if (c && !list.some(q => at(q).equals(c))) list.push({ x: c.x, y: c.y, z: c.z });
    frame.standsTried[key(p)] = list.slice(-8); save();
  };
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
          // Filled or scooped from a dry place in reach of it (toDryReach),
          // and after two tries that came to nothing there, the cast's failure
          // at its site, said, not a walk back into the water every pass.
          const avoid = [...frame.blocks.map(at), p, p.plus(UP)];
          const fillFailed = feeder && frame.feederFailedAt?.key === `${feeder}` ? frame.feederFailedAt : null;
          if (fillFailed?.n >= 2) { delete frame.feederFailedAt; save(); throw new Error(`The water source at ${feeder} running into the frame slot at ${p} could not be stopped: ${fillFailed.why}`); }
          const feederFailed = err => { frame.castWaterError = err.message; frame.feederFailedAt = { key: `${feeder}`, n: (fillFailed?.n || 0) + 1, why: String(err.message).slice(0, 120) }; save(); };
          if (feeder && material && (scoopFailed || !countOf(bot, 'bucket'))) {
            stepIs(p, 'fill_source', { source: { x: feeder.x, y: feeder.y, z: feeder.z } });
            try { await toDryReach(bot, task, feeder, navigate, avoid); await place(bot, task, feeder, material); track(feeder, material); delete frame.castWaterFailedAt; delete frame.feederFailedAt; save(); }
            catch (err) { task.check(); if (fatal(err)) throw err; feederFailed(err); }
            return false;
          }
          if (feeder && countOf(bot, 'bucket')) {
            stepIs(p, 'stop_water', { source: { x: feeder.x, y: feeder.y, z: feeder.z } });
            const had = countOf(bot, 'water_bucket');
            await scoopSource(bot, task, feeder, navigate, feederFailed, avoid);
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
        // The site is checked before the lava is fetched, not after: a frame
        // with nothing cast in it whose first slot has no stand, none to make
        // and none to dig out fails here, at the frame, not after a trip
        // down. 25593 (mid-237-ag, 2026-09-30) fetched lava 73 blocks down,
        // climbed back five minutes, and at 13:48:39Z left the site: "This
        // spot will not take the portal" (note 753b).
        if (!frame.standChecked && !order.some(q => w.name(q) === 'obsidian') && bot.entity.position.distanceTo(p) <= 8) {
          const ways = standWays(bot, frame, p, w);
          if (!ways.stands && !ways.make && !ways.cut && !ways.blocked) throw new Error(`Nowhere to stand to pour into the frame slot at ${p}, found before fetching lava: ${ways.says}`);
          frame.standChecked = true; save();
        }
        // As many as the empty buckets carried hold, up to what is left.
        const left = order.filter(q => w.name(q) !== 'obsidian').length;
        const want = Math.max(1, Math.min(left, countOf(bot, 'bucket')));
        // A trip begins here and ends at the next pour, timed by the way's
        // working clock: the pace so far, said beside the estimate (note 470).
        const m = goal.portalMethod;
        if (m && !Number.isFinite(m.tripFrom)) { m.tripFrom = m.activeMs || 0; m.tripHealth = bot.health; }
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
        const material = require('./work').supportMaterialHere(bot);
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
    // The blockers Jev chose to clear at this slot (portal_method's
    // clear_blocker, note 767): dug before a stand is looked for.
    const repair = frame.repair?.slot && key(frame.repair.slot) === key(p) && frame.repair.kind === 'clear' ? frame.repair : null;
    if (repair) {
      const left = (repair.cells || []).map(at).filter(c => { const b = bot.blockAt(c); return !!b && !AIR.test(b.name) && b.diggable !== false && !/obsidian|bedrock|lava|water/.test(b.name); });
      if (!left.length) { delete frame.repair; save(); }
      else {
        const c = left[0];
        stepIs(p, 'clear_blocker', { at: { x: c.x, y: c.y, z: c.z } });
        await dig(bot, task, c, { requireDrops: false });
        return false;
      }
    }
    // Where to stand: beside the frame, where both pours can be made; not a
    // stand passed over for this slot, nor an aim a pour went wrong from.
    const pass = slotPass(frame, p), missed = slotMissed(frame, p);
    const stands = standsFor(frame, p, w, { pass, missed }).sort((a, b) => a.feet.distanceTo(bot.entity.position) - b.feet.distanceTo(bot.entity.position));
    let stand = stands.find(s => atStand(s.feet));
    // What each stand's walk came to, said if none is reached (note 767).
    const tries = [];
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
          const status = (await route(bot, task, movements, destination, 500)).status;
          if (status !== 'success') { tries.push({ s, tower, status }); continue; }
          stepIs(p, 'to_stand', { stand: { x: s.feet.x, y: s.feet.y, z: s.feet.z }, ...(tower ? { built: true } : {}) });
          try { await navigate(bot, task, destination, { timeoutMs: 30000, stallMs: 5000 }); }
          catch (err) { task.check(); if (fatal(err)) throw err; tries.push({ s, tower, walk: String(err.message || err).slice(0, 80) }); continue; }
          if (atStand(s.feet)) { stand = s; break; }
          tries.push({ s, tower, walk: 'ended short of it' });
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
    const slotKey = key(p);
    const made = ((frame.standsMade ||= {})[slotKey] ||= []).map(at);
    // A stand whose route search ran out of its half second is not a stand
    // with no way to it: the whole walk is made to the nearest such, with
    // the blocks carried to build up by, as to a stand made (below). With
    // stands beside the slot and none reached in the half second, the
    // stand search threw "Nowhere to stand" with the stands counted in the
    // same breath: 14 of the site failures asked since 06:00Z on 2026-09-30
    // said "3 stands beside it a pour reaches it from" (or 2, or 4), and
    // 25595 (mid-243-ap, 21:14:47-21:15:10Z) left its frame at 6 of ten
    // on seven such failures in 23 seconds (note 767).
    if (!stand && stands.length && !made.length) {
      const slow = stands.find(s => tries.some(t => t.s === s && t.status && t.status !== 'noPath'));
      if (slow) {
        const saved = { allow1by1towers: movements.allow1by1towers, scafoldingBlocks: movements.scafoldingBlocks };
        if (scaffoldId !== undefined) Object.assign(movements, { allow1by1towers: true, scafoldingBlocks: [...new Set([...(movements.scafoldingBlocks || []), scaffoldId])] });
        let why = 'ended short of it';
        try {
          stepIs(p, 'to_stand', { stand: { x: slow.feet.x, y: slow.feet.y, z: slow.feet.z }, whole: true });
          await navigate(bot, task, new goals.GoalBlock(slow.feet.x, slow.feet.y, slow.feet.z), { timeoutMs: 30000, stallMs: 5000 });
        } catch (err) { task.check(); if (fatal(err)) throw err; why = String(err.message || err).slice(0, 80); }
        finally { Object.assign(movements, saved); }
        if (atStand(slow.feet)) stand = slow;
        else tries.push({ s: slow, whole: true, walk: why });
      }
    }
    // A stand made for this slot is gone to, the whole walk with the
    // blocks carried to build up by, not a half-second survey; and one
    // that is not reached is the cast's failure here, said, not a reason
    // to make another. mid-244-be and mid-244-bd, nine of ten cast, made a
    // stand for the last slot every pass and never stood on one: fourteen
    // stands in a minute and a half about (82, 27, 147), the pass handing
    // the turn back each time (note 603).
    if (!stand && made.length) {
      const standing = made.find(f => stands.some(s => s.feet.equals(f)));
      if (!standing) { delete frame.standsMade[slotKey]; save(); throw new Error(`Nowhere to stand to pour into the frame slot at ${p}: the stand made for it at ${made.at(-1)} is no longer one`); }
      const saved = { allow1by1towers: movements.allow1by1towers, scafoldingBlocks: movements.scafoldingBlocks };
      if (scaffoldId !== undefined) Object.assign(movements, { allow1by1towers: true, scafoldingBlocks: [...new Set([...(movements.scafoldingBlocks || []), scaffoldId])] });
      let why = null;
      // A walk up by towering ends after each block laid ("Navigation ended
      // before reaching the destination"), and every pass that threw at that
      // was a site failure asked about: mid-244-ce's stand four blocks up took
      // four passes of seven seconds, a block each (y 74 to 77), "turning
      // between cast portal and enter nether" until the trial was stopped
      // sixteen seconds before the pour (note 651). A walk that got nearer is
      // walked again in the same pass; one that gained nothing is the failure.
      const from = bot.entity.position.floored();
      const away = () => bot.entity.position.distanceTo(standing.offset(0.5, 0, 0.5));
      let best = away(), walks = 0;
      try {
        stepIs(p, 'to_stand', { stand: { x: standing.x, y: standing.y, z: standing.z }, made: true });
        while (walks < STAND_WALKS) {
          walks++; why = null;
          try { await navigate(bot, task, new goals.GoalBlock(standing.x, standing.y, standing.z), { timeoutMs: 30000, stallMs: 5000 }); }
          catch (err) { task.check(); if (fatal(err)) throw err; why = String(err.message || err).slice(0, 100); }
          if (atStand(standing)) break;
          const now = away();
          if (now > best - 0.5) break;
          best = now;
        }
      } finally { Object.assign(movements, saved); }
      if (!atStand(standing)) {
        triedAt(p, [standing]);
        throw new Error(`Nowhere to stand to pour into the frame slot at ${p}: the stand made for it at ${standing} could not be walked to from ${from} (${why || 'the walk ended short of it'}${walks > 1 ? `, ${walks} walks, ${Math.round(away())} blocks from it at the last` : ''})`);
      }
      stand = stands.find(s => s.feet.equals(standing));
    }
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
        frame.standsMade[slotKey] = [{ x: make.s.feet.x, y: make.s.feet.y, z: make.s.feet.z }];
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
      // The slot's walls are kept whatever stands in them: a natural block
      // that walls the slot (the frame in a hillside) is not tracked as a
      // temporary one, was dug out as a stand, and walled again the next
      // pass (note 767).
      const keep = new Set([...frame.blocks.map(at), ...containment(p), ...wallsFor(p, w.solidAt), ...(frame.castTemp || []).map(at)].map(key));
      const diggable = c => { const b = bot.blockAt(c); return !!b && b.boundingBox === 'block' && b.diggable !== false && !/obsidian|bedrock/.test(b.name) && !keep.has(key(c)); };
      const cut = [];
      for (const side of [-1, 1]) for (const dist of [2, 1]) for (const dy of [0, 1]) {
        const feet = p.plus(X.scaled(side * dist)).offset(0, dy, 0), head = feet.plus(UP);
        if (!w.solidAt(feet.plus(DOWN)) || keep.has(key(feet)) || keep.has(key(head))) continue;
        const digs = [feet, head].filter(c => !w.openAt(c));
        if (digs.every(diggable)) cut.push({ feet, digs });
      }
      cut.sort((a, b) => a.digs.length - b.digs.length || a.feet.distanceTo(bot.entity.position) - b.feet.distanceTo(bot.entity.position));
      const toCut = cut.find(c => c.digs.length);
      if (toCut) {
        for (const c of toCut.digs) { stepIs(p, 'dig_stand', { at: { x: c.x, y: c.y, z: c.z } }); await dig(bot, task, c, { requireDrops: false }); }
        return false;
      }
      // Cells beside it open, with a floor, from which the line into the slot
      // is blocked: the block in the line comes out, as a player clears the
      // view into the slot, a few times a slot at most. 25581 (mid-243-jh,
      // 2026-09-30 13:43:48-13:44:04Z), five of ten cast, failed "Nowhere to
      // stand" four times in twelve seconds, each an ask of the way, and left
      // the frame for a new site (note 753b).
      const cleared = ((frame.linesCleared ||= {})[slotKey] ||= 0);
      if (cleared < 4) {
        for (const c of cut.filter(c => !c.digs.length)) {
          const hit = firstHit(w.blocksRay, c.feet.offset(0.5, EYE, 0.5), p.offset(0.5, 0.98, 0.5));
          if (!hit || hit.cell.equals(p) || !diggable(hit.cell)) continue;
          frame.linesCleared[slotKey] = cleared + 1; save();
          stepIs(p, 'clear_line', { at: { x: hit.cell.x, y: hit.cell.y, z: hit.cell.z }, from: { x: c.feet.x, y: c.feet.y, z: c.feet.z } });
          await dig(bot, task, hit.cell, { requireDrops: false });
          return false;
        }
      }
      // Stands there were, and none reached: said as that, with what each
      // walk came to, not as nowhere to stand (note 767).
      if (stands.length) triedAt(p, tries.map(t => t.s.feet));
      if (stands.length) throw new Error(`No stand reached for the frame slot at ${p}: ${stands.length} beside it a pour reaches it from, ${triesSays(tries)}${pass.length ? `; ${pass.length} passed over as chosen` : ''}`);
      throw new Error(`Nowhere to stand to pour into the frame slot at ${p}: ${standWays(bot, frame, p, w, { pass, missed }).says}`);
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
        if (Number.isFinite(m.tripHealth) && Number.isFinite(bot.health)) t.hurt = Math.round(((t.hurt || 0) + Math.max(0, m.tripHealth - bot.health)) * 10) / 10;
        delete m.tripHealth;
        // Trips as they have been, long or hurtful: the way is asked again
        // with them (portalDue), once and then at each doubling. 25585
        // (mid-241-bi, 2026-09-30 23:4x-00:0xZ), its frame at (-118, -11,
        // -483) 54 blocks from its lava, made three one-bucket trips, each
        // through low air and pointed dripstone (20 health to 12), and left
        // the frame; a frame begun was never weighed again against one cast
        // beside the lava (note 767).
        const each = t.ms / t.n;
        if ((each >= 90000 || (t.hurt || 0) >= 4) && (!m.tripsAsked || each >= 2 * m.tripsAsked.each || (t.hurt || 0) >= m.tripsAsked.hurt + 4)) {
          m.tripsFar = { n: t.n, each: Math.round(each / 1000), hurt: t.hurt || 0, left: order.filter(q => w.name(q) !== 'obsidian').length };
          m.tripsAsked = { each, hurt: t.hurt || 0 };
        }
      }
      stepIs(p, 'lava');
      await pourAlong(bot, task, 'lava_bucket', aim, () => sourceLava(bot.blockAt(p)), actions.pourMs);
    }
    check();
    // Lava walled in keeps while the water bucket is fetched.
    if (!countOf(bot, 'water_bucket')) { stepIs(p, 'water_bucket'); await acquireStep(bot, task, 'water_bucket', 1, goal, save); return false; }
    const water = waterAim(eye(), p, w, [...exclude(), ...slotMissed(frame, p)]);
    if (!water) throw new Error(`No place to pour water onto the lava in the frame slot at ${p}${missed.length ? ` but the ${missed.length} the water went elsewhere from` : ''}`);
    stepIs(p, 'water', { water: { x: water.into.x, y: water.into.y, z: water.into.z } });
    // A pour that went elsewhere is taken back where it went and made
    // again at another aim, twice a slot, before it is the cast's failure:
    // 25591 (2026-09-30 16:07:45-16:15:04Z) poured at (9, 73,
    // 25) eleven times, "The water went somewhere other than" each time,
    // the same aim each time, and left the frame at 3 of ten (note 767).
    try { await pourAlong(bot, task, 'water_bucket', water, () => /water/.test(w.name(water.into) || '') || w.name(p) === 'obsidian', actions.pourMs); }
    catch (err) {
      task.check(); if (fatal(err) || !err.missed) throw err;
      triedAt(p, [bot.entity.position.floored()]);
      const list = ((frame.missedAims ||= {})[slotKey] ||= []);
      if (!list.some(c => at(c).equals(err.missed))) list.push({ x: err.missed.x, y: err.missed.y, z: err.missed.z });
      const went = (err.went || []).filter(c => sourceWater(bot.blockAt(c)));
      if (went.length) {
        const prior = frame.castWater;
        if (prior && sourceWater(bot.blockAt(at(prior)))) (frame.castWaterLeft ||= []).push(prior);
        frame.castWater = { x: went[0].x, y: went[0].y, z: went[0].z };
        for (const c of went.slice(1)) (frame.castWaterLeft ||= []).push({ x: c.x, y: c.y, z: c.z });
      }
      save();
      if (list.length <= 2) return false;
      throw new Error(`${err.message} (${list.length} pours of water here have gone elsewhere, from aims at ${list.map(c => `(${c.x}, ${c.y}, ${c.z})`).join(', ')})`);
    }
    // A source from an earlier pour that was not taken back is kept in
    // mind, not forgotten under this one.
    const before = frame.castWater;
    if (before && !at(before).equals(water.into) && sourceWater(bot.blockAt(at(before)))) (frame.castWaterLeft ||= []).push(before);
    frame.castWater = { x: water.into.x, y: water.into.y, z: water.into.z }; save();
    const cast = await waitUntil(task, () => w.name(p) === 'obsidian', CONVERSION_MS);
    await takeWaterBack(bot, task, frame, save, navigate);
    if (!cast) throw new Error(`The lava in the frame slot at ${p} did not turn to obsidian`);
  }
  // The frame whole, the water it was cast with goes too. The scoop at each
  // slot's start never comes after the last slot: mid-242-ab's last scoop
  // failed ("outside visible interaction reach"), the frame was whole at
  // the next pass, and the source stood on the frame's corner (19, 76, 58),
  // running down past the portal's face into the hole before it; the bot
  // swam in and out of that hole for half an hour (note 567).
  await leaveNoWater(bot, task, frame, save, actions);
  return true;
}

// Every source the cast poured and has not taken back: scooped, or where
// the scoop cannot be made, filled with a temporary block as a slot's
// feeder is. Tried on three passes, then left, kept with why
// (castWaterStanding).
async function leaveNoWater(bot, task, frame, save, { navigate, place }) {
  const all = [...(frame.castWaterLeft || []), ...(frame.castWater ? [frame.castWater] : [])];
  if (!all.length) return true;
  const standing = c => { const b = bot.blockAt(at(c)); return !!b && sourceWater(b); };
  const left = [];
  for (const c of all) {
    if (!standing(c)) continue;
    const p = at(c);
    if (countOf(bot, 'bucket')) await scoopSource(bot, task, p, navigate, err => { frame.castWaterError = err.message; save(); });
    const material = standing(c) && portalSupports(bot).material;
    if (material && place) {
      try {
        await place(bot, task, p, material);
        frame.castTemp = [...(frame.castTemp || []).filter(t => !at(t).equals(p)), { x: p.x, y: p.y, z: p.z, material }];
      } catch (err) { task.check(); if (fatal(err)) throw err; frame.castWaterError = err.message; }
    }
    if (standing(c)) left.push(c);
  }
  delete frame.castWaterLeft; delete frame.castWater;
  if (left.length) {
    frame.castWaterTries = (frame.castWaterTries || 0) + 1;
    if (frame.castWaterTries < 3) { frame.castWater = left.at(-1); if (left.length > 1) frame.castWaterLeft = left.slice(0, -1); }
    else frame.castWaterStanding = left.map(c => ({ ...c, why: frame.castWaterError || 'not taken back' }));
  } else delete frame.castWaterTries;
  save();
  return !left.length;
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

module.exports = { dryReach, toDryReach, scoopSource, standWays, blockersFor, triesSays, slotPass, slotMissed, sourcesAbout, pourAlong, castFrame, castLacksWater, leaveNoWater, castOrder, workCells, containment, wallsFor, anchorPath, plannedWalls, firstHit, pourAim, waterAim, standsFor, castSays, lavaTrip, tripSays, tripsSoFar, fetchTrip, fetchSays, tripsCost, castTrips, duration, view };
