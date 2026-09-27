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
function standsFor(frame, p, w) {
  const axis = frame.axis || 'x', X = across(axis), A = AXES[axis];
  const give = (1 - WIDTH) / 2;
  const out = [];
  for (const side of [-1, 1]) for (const dist of [1, 2]) for (const du of [0, -1, 1]) for (const dy of [1, 0, 2]) {
    const feet = p.plus(X.scaled(side * dist)).plus(A.scaled(du)).offset(0, dy, 0), head = feet.plus(UP);
    if (!w.solidAt(feet.plus(DOWN)) || !w.openAt(feet) || !w.openAt(head)) continue;
    const eyes = [[0, 0], [-give, -give], [-give, give], [give, -give], [give, give]].map(([dx, dz]) => feet.offset(0.5 + dx, EYE, 0.5 + dz));
    const aims = eyes.map(eye => { const lava = pourAim(eye, p, w); return { lava, water: lava && waterAim(eye, p, w, [feet, head]) }; });
    if (aims.every(a => a.lava && a.water)) out.push({ feet, ...aims[0] });
  }
  return out;
}

// The portal_method option, said with what it needs against what is
// carried, the trips to lava it takes and how far the lava is.
function castSays({ obsidian = 0, waterBucket = false, buckets = 0, lavaBuckets = 0, iron = 0, walls, blocks = 0, lighter = false, lava = null }) {
  const cast = Math.max(0, 10 - obsidian);
  const carriers = buckets + lavaBuckets;
  const toFetch = Math.max(0, cast - lavaBuckets);
  const trips = carriers ? Math.ceil(toFetch / carriers) : toFetch;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // Each trip carries one lava per bucket held, and the iron in hand makes
  // more: mid-237-d cast with one bucket and eight ingots in its pockets.
  const more = Math.floor(iron / 3);
  const tripsSay = (carriers
    ? `Each block is one lava bucket and each trip carries one lava per bucket held, so with ${plural(carriers, 'bucket')} that is about ${plural(trips, 'trip')} to lava.`
    : `With no bucket carried one has to be made first; each block is one lava bucket, so with one that is ${plural(trips, 'trip')} to lava.`) +
    (more && toFetch ? ` The ${iron} iron ingots carried make ${plural(more, 'more bucket')}, about ${plural(Math.ceil(toFetch / (Math.max(1, carriers) + more)), 'trip')} with them.` : '');
  const round = lava && Math.round(lava.distance * 2 / 4.3);
  const lavaSay = lava ? `The nearest known lava is ${lava.distance} blocks away (${lava.how}): about ${round} seconds there and back a trip, ${round * trips} in all.`
    : 'No lava is known nearby: a pool has to be found first.';
  return `Build a portal frame of its own and cast each missing block in place, with no diamond pickaxe: the bot walls a frame slot round with temporary blocks, pours a lava bucket into it, pours water on top and takes the water back, and the lava source turns to obsidian. ${cast} of the ten to cast (${obsidian} obsidian carried, placed as it is). ` +
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

// Scoop back the water a cast left, when it is still a source.
async function takeWaterBack(bot, task, frame, save) {
  if (!frame.castWater) return;
  const w = at(frame.castWater);
  if (!bot.blockAt(w) || !sourceWater(bot.blockAt(w))) { delete frame.castWater; save(); return; }
  try { await fillWaterBucket(bot, task, w, { guard: () => checkThreats(bot) }); delete frame.castWater; save(); }
  catch (err) { task.check(); if (fatal(err)) throw err; frame.castWaterError = err.message; save(); }
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
  const stepIs = (p, phase, extra = {}) => { goal.step = { action: 'cast_portal', item: 'obsidian', slot: { x: p.x, y: p.y, z: p.z }, phase, ...extra }; save(); };
  const order = castOrder(frame);
  for (const p of order) {
    if (w.name(p) === 'obsidian') continue;
    if (!bot.blockAt(p)) return false;
    check();
    await takeWaterBack(bot, task, frame, save);
    if (!sourceLava(bot.blockAt(p))) {
      if (/water/.test(w.name(p) || '')) {
        // Water left from the slot below runs off once its source is gone.
        // A source never does: a block put in it takes it, and comes out
        // again below as any temporary block does.
        const material = portalSupports(bot).material;
        if (!sourceWater(bot.blockAt(p)) || !material) { stepIs(p, 'drain'); await sleep(500); return false; }
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
        stepIs(p, 'fetch_lava', { buckets: want, left }); await acquireStep(bot, task, 'lava_bucket', want, goal, save); return false;
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
    // Where to stand: beside the frame, where both pours can be made.
    const stands = standsFor(frame, p, w).sort((a, b) => a.feet.distanceTo(bot.entity.position) - b.feet.distanceTo(bot.entity.position));
    let stand = stands.find(s => s.feet.equals(bot.entity.position.floored()));
    for (const s of stand ? [] : stands.slice(0, 6)) {
      task.check();
      const destination = new goals.GoalBlock(s.feet.x, s.feet.y, s.feet.z);
      if ((await route(bot, task, bot.pathfinder.movements, destination, 500)).status !== 'success') continue;
      stepIs(p, 'to_stand', { stand: { x: s.feet.x, y: s.feet.y, z: s.feet.z } });
      try { await navigate(bot, task, destination, { timeoutMs: 30000, stallMs: 5000 }); }
      catch (err) { task.check(); if (fatal(err)) throw err; continue; }
      if (bot.entity.position.floored().equals(s.feet)) { stand = s; break; }
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
    if (!stand) throw new Error(`Nowhere to stand to pour into the frame slot at ${p}`);
    const eye = () => bot.entity.position.offset(0, EYE, 0);
    const exclude = () => { const f = bot.entity.position.floored(); return [f, f.plus(UP)]; };
    if (!sourceLava(bot.blockAt(p))) {
      // Nothing at the lava with a mob in view, as at a pool (obsidian.js).
      if (threats(bot).some(t => t.visible && t.distance < 16)) { stepIs(p, 'wait_for_quiet'); await sleep(1000); return false; }
      check();
      if (wallsOpen(p, w)) throw new Error(`The walls round the frame slot at ${p} are not whole`);
      const aim = pourAim(eye(), p, w);
      if (!aim) throw new Error(`No line into the frame slot at ${p} from where I stand`);
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
    await takeWaterBack(bot, task, frame, save);
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

module.exports = { castFrame, castOrder, containment, wallsFor, anchorPath, plannedWalls, firstHit, pourAim, waterAim, standsFor, castSays, view };
