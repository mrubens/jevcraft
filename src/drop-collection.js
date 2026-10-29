'use strict';
// The key-press helper, by its module: collectNearbyDrops takes a `move`
// option (the pathfinder's navigate) that shadowed it, and the straight walk
// at a drop handed a motion spec to the pathfinder as its goal, which
// crashed the process (2026-09-23, four times).
const motion = require('./motion');
const { Vec3 } = require('vec3');
const { goals } = require('mineflayer-pathfinder');
const { navigate, surveyRoute, countOf } = require('./skills');
const { miningMovement, dryStanding } = require('./mining-access');
const { damagingTerrain, supportCell } = require('./terrain');
const { safeFromHostiles } = require('./danger');
const { checkAir } = require('./vitals');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const failures = new WeakMap();
const key = (bot, entity) => `${bot.game?.dimension}:${entity.uuid || entity.id}:${entity.position.floored()}`;

// Entity IDs are connection-local. Retry a blocked stack after it moves, or
// after a short cooldown; neither persist stale IDs nor let one stack monopolize work.
function nearbyDrops(bot, item, origin, radius, { hostilesOk = false } = {}) {
  const failed = failures.get(bot);
  if (failed) for (const [id, until] of failed) if (until <= Date.now()) failed.delete(id);
  return Object.values(bot.entities || {}).filter(e => e.isValid !== false && e.position &&
    e.getDroppedItem?.()?.name === item && e.position.distanceTo(origin) <= radius &&
    !failed?.has(key(bot, e)) && (hostilesOk || safeFromHostiles(bot, e.position)))
    .sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position)).slice(0, 8);
}

const WATERY = /^(water|bubble_column|seagrass|tall_seagrass|kelp|kelp_plant)$/;
// In water: the block at the drop, or the one just under where it bobs.
function floatsInWater(bot, drop) {
  const at = n => WATERY.test(bot.blockAt(n)?.name || '') || bot.blockAt(n)?.getProperties?.()?.waterlogged === true;
  return at(drop.position.floored()) || at(drop.position.offset(0, -0.4, 0).floored());
}
// Swims at the surface to a floating drop: faced, forward, jump held so the body rises to the air and bobs there.
// Ends when `done` says so, the drop is gone, or `until` passes.
async function swimTo(bot, task, drop, { until, done = () => false }) {
  const { move } = require('./motion');
  const gone = () => bot.entities[drop.id] !== drop || drop.isValid === false;
  const flat = () => Math.hypot(drop.position.x - bot.entity.position.x, drop.position.z - bot.entity.position.z);
  while (Date.now() < until && !done() && !gone()) {
    task.check();
    await move(bot, task, { label: 'swim_to_drop', keys: flat() > 0.4 ? ['forward', 'jump'] : ['jump'], sneak: false,
      why: 'swimming at the surface to a drop floating in the water, jump held to keep the head in the air (note 2394)',
      look: drop.position.offset(0, 0.3, 0), until: () => done() || gone(), maxMs: 1200 });
  }
}

// `hostilesOk`: the walk back's own drops (note 2287) are taken beside the mob about them; a spot near a hostile is
// not passed over there (note 2415): full-26 (25586, 2026-10-28 18:52Z) stood 5 to 11 blocks from four of its drops on
// crimson nylium, hoglins about, and every one was '0 spots ... 0 walked to', the hostile filter here unsaid.
function pickupPositions(bot, drop, { hostilesOk = false } = {}) {
  const positions = [], p = drop.position.floored();
  for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    for (let dy = 0; dy >= -2; dy--) {
      const floor = bot.blockAt(p.offset(dx, dy, dz));
      if (floor?.boundingBox !== 'block' || damagingTerrain.has(floor.name)) continue;
      const height = floor.shapes?.length ? Math.max(...floor.shapes.map(shape => shape[4])) : 1;
      const standing = new Vec3(p.x + dx + .5, p.y + dy + height, p.z + dz + .5);
      if (Math.hypot(standing.x - drop.position.x, standing.z - drop.position.z) > 1.25 ||
          drop.position.y < standing.y - .1 || drop.position.y > standing.y + 1.8) continue;
      if (dryStanding(bot, standing) && (hostilesOk || safeFromHostiles(bot, standing))) positions.push(standing);
    }
  }
  return positions.sort((a, b) => a.distanceTo(drop.position) - b.distanceTo(drop.position));
}

// Where a drop lies with no body's room about it, its own cell stood in once the cell over it is dug (note 2347):
// ore mined from a tunnel's wall drops into the one-high hole it leaves, and no pickup spot is two high there, so
// neither a walk nor the passage was tried. full-15 (25586, 2026-10-28 06:0xZ) mined iron at (-39, 32, -140) from
// its tunnel at y 31 and left 2 raw iron 2.5 blocks off, 'spots passed over: 0' of every kind; full-13 left raw iron
// 4 blocks off the same way.
function dugStand(bot, drop) {
  const p = drop.position.floored(), floor = bot.blockAt(p.offset(0, -1, 0));
  if (floor?.boundingBox !== 'block' || damagingTerrain.has(floor.name)) return [];
  if (!safeFromHostiles(bot, new Vec3(p.x + .5, p.y, p.z + .5))) return [];
  return [new Vec3(p.x + .5, p.y, p.z + .5)];
}

// A hot floor the straight walk at a drop would bring the body to rest on:
// the walk is crouched, which a magma block does not hurt, but it ends
// where the keys are let go. mid-242-aa-nether-3 walked so at a netherrack
// it had dug, onto a magma block at the edge of a hole into the lava, was
// held there by the crouch, and stood up on it (note 579). Read along the
// line as the game reads the floor (the nearest block under the box), up
// to where the floor ends: a crouched body stops at an edge.
function hotOnTheWay(bot, to, from = bot.entity.position) {
  const { restingCell, hotFloor } = require('./terrain');
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.25));
  for (let i = 0; i <= steps; i++) {
    const p = new Vec3(from.x + (to.x - from.x) * i / steps, from.y, from.z + (to.z - from.z) * i / steps);
    const cell = restingCell(bot, p);
    if (!cell) return null;
    const floor = bot.blockAt(cell.offset(0, -1, 0));
    if (hotFloor(floor)) return { name: floor.name, x: floor.position?.x ?? cell.x, y: cell.y - 1, z: floor.position?.z ?? cell.z };
  }
  return null;
}

// A drop of more than three blocks on the straight line to `to` or within
// `past` blocks beyond it, at the bot's level: the jumping walk at a drop
// above goes uncrouched, and a jump carries the body on past where it was
// aimed. 25592 (2026-10-03 19:08:14Z), mining netherrack on a ledge twenty
// blocks over the lava sea at 20 health, jumped at a block's drop lying a
// step up and went on over the ledge's edge into the lava (note 1102).
// -> { x, y, z, fall } of the first such column, or null.
function edgeOnTheWay(bot, to, { from = bot.entity.position, past = 2 } = {}) {
  const flat = Math.hypot(to.x - from.x, to.z - from.z);
  if (flat < 1e-3) return null;
  const ux = (to.x - from.x) / flat, uz = (to.z - from.z) / flat, feet = Math.floor(from.y);
  const solid = (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.boundingBox === 'block';
  for (let d = 0.5; d <= flat + past; d += 0.5) {
    const x = Math.floor(from.x + ux * d), z = Math.floor(from.z + uz * d);
    if (x === Math.floor(from.x) && z === Math.floor(from.z)) continue;
    // A wall across the way stops the body there: nothing past it counts.
    if (solid(x, feet + 1, z) && solid(x, feet + 2, z)) return null;
    let floored = false;
    for (let y = feet + 1; y >= feet - 4; y--) if (solid(x, y, z)) { floored = true; break; }
    if (!floored) return { x, y: feet, z, fall: 4 };
  }
  return null;
}

class PickupGoal extends goals.GoalBlock {
  constructor(point) { super(point.x, point.y, point.z); this.standingY = point.y; }
  // The graph uses integer cells; smoothing uses the surface height. Accept
  // both representations of the same slab/path floor, not the floor beneath it.
  isEnd(node) { return node.x === this.x && node.z === this.z && Math.abs(node.y - this.standingY) < 1; }
}

async function collectNearbyDrops(bot, task, item, { before = countOf(bot, item), origin = bot.entity.position.clone(),
  radius = 16, timeoutMs = 6500, waitForSpawnMs = 0, onTarget = () => {}, move = navigate, allowExcavation = false,
  // The bot's own drops after a death (note 2287): they lie where it died, beside what killed it, and with hostiles
  // about filtering every drop and pickup spot out no walk back of 27 on the fresh runs got anything. Going there is
  // Jev's choice, priced; the survival layer still takes over at a hit. The approach is sprinted.
  hostilesOk = false } = {}) {
  task.check(); checkAir(bot);
  const gained = () => countOf(bot, item) > before;
  if (gained()) return true;
  if (!waitForSpawnMs && !nearbyDrops(bot, item, origin, radius, { hostilesOk }).length) return false;
  // No room in the pockets, none is taken up however near (note 2403): room is made first, the tidy's own rule and then
  // Jev's, as the walk back does at its spot; only for what is worth carrying (corpse-run.js worth), not a block of dirt. full-22 (25590, 2026-10-28) had no free slot for an hour, 'raw iron not
  // taken ... the nearest 0.2 from the bot' at its own mining, and stood among 29 of its kit's drops taking none.
  try {
    const tidy = require('./inventory-tidy');
    const worthIt = Object.keys(require('./corpse-run').worth({ [item]: 1 })).length > 0;
    if (worthIt && typeof tidy.roomFor === 'function' && !tidy.roomFor(bot, item, 1)) {
      const worthOf = require('./corpse-run').worth;
      const keep = new Set([item, ...(bot.inventory?.items?.() || []).map(i => i.name).filter(n => Object.keys(worthOf({ [n]: 1 })).length)]);
      const made = await tidy.makeRoom(bot, task, item, { keep, purpose: `the ${item.replaceAll('_', ' ')} lying here`, goal: bot._goal || null });
      if (!made) console.log(`[drops] no room in the pockets for the ${item.replaceAll('_', ' ')} lying here, and none made`);
    }
  } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err?.name)) throw err; }
  let deadline = Date.now() + timeoutMs; const spawnDeadline = Date.now() + waitForSpawnMs;
  const movement = bot.pathfinder.movements, policy = miningMovement(bot), start = bot.entity.position.clone();
  const previous = { allow1by1towers: movement.allow1by1towers, scafoldingBlocks: movement.scafoldingBlocks, allowSprinting: movement.allowSprinting, hostilesOk: movement.hostilesOk,
    allowParkour: movement.allowParkour, maxDropDown: movement.maxDropDown };
  const allowed = point => {
    const p = new Vec3(point.x, point.y, point.z);
    return p.distanceTo(start) <= radius + 1 && p.y >= start.y - 8 && policy.allowed(point) &&
      !damagingTerrain.has(bot.blockAt(supportCell(p))?.name) && (hostilesOk || safeFromHostiles(bot, p));
  };
  Object.assign(movement, { allow1by1towers: false, scafoldingBlocks: [], allowParkour: false, ...(hostilesOk ? { allowSprinting: true, hostilesOk: true } : {}),
    // Three down: a fall of three blocks hurts nothing (the game counts the fall past three), and drops lie as often
    // a ledge below the bot as beside it (note 2371). full-14 (25588, 2026-10-28 11:5xZ) stood 3 above its own kit on a
    // fortress's bricks, a diamond, its shield and an iron pickaxe 3 to 4 blocks off, and every spot was 'no short
    // clear route' at a drop of two.
    maxDropDown: Math.min(previous.maxDropDown ?? 3, 3), allowedPosition: allowed });
  const attempted = new Set();
  // Why a pickup spot was passed over, counted for the line said when nothing was taken (note 2285).
  const why = { hostile: 0, bounds: 0, route: 0, moved: 0, walked: 0 };
  const allowedWhy = point => { const p = new Vec3(point.x, point.y, point.z); if (!(p.distanceTo(start) <= radius + 1 && p.y >= start.y - 8 && policy.allowed(point) && !damagingTerrain.has(bot.blockAt(supportCell(p))?.name))) return 'bounds'; if (!hostilesOk && !safeFromHostiles(bot, p)) return 'hostile'; return null; };
  let seen = false, passageTried = false, extended = false;
  try {
    // Once more, four seconds, where the time ran out with the drop known only at its end and no spot yet tried (note
    // 2479): its stack is read after the entity under load, and the pickup waited for it to the deadline. full-84
    // (25592, 2026-10-29 11:1xZ) dug iron in passing and left the raw iron 4 blocks off, '1 spots', every count 0.
    for (;;) {
    while (Date.now() < deadline && !gained()) {
      task.check(); checkAir(bot);
      const drops = nearbyDrops(bot, item, origin, radius, { hostilesOk });
      seen ||= drops.length > 0;
      // An item lying near whose stack is not yet known (its metadata comes after the entity under load) is waited
      // for to the deadline, not taken for none (note 2359): full-15 and full-16 (2026-10-28 06:2x to 08:2xZ) left
      // raw iron 1.6 blocks off with every count at 0, no spot tried, the drop known by the line written after.
      const unread = !drops.length && !seen && Object.values(bot.entities || {}).some(e => e.name === 'item' && e.isValid !== false && e.position && e.position.distanceTo(origin) <= radius && !e.getDroppedItem?.());
      if (!drops.length && (seen || (Date.now() >= spawnDeadline && !unread))) break;
      // A drop floating in water is swum to at the surface, where the air is, not walked to along the floor (note
      // 2394): full-23 (25592, 2026-10-28 15:50 to 15:53Z) came back to 39 of its drops floating on a pool 5 to 10
      // blocks about it and took none; in the arena the walk to them went along the pool's floor, ran low on air, and
      // gave up every drop at 'Low air: interrupt work and surface', 4 of 19 taken.
      const floating = drops.find(d => !attempted.has(`swim:${key(bot, d)}`) && floatsInWater(bot, d));
      if (floating) {
        attempted.add(`swim:${key(bot, floating)}`); why.walked++;
        onTarget({ item, position: { ...floating.position.floored() } });
        await swimTo(bot, task, floating, { until: Math.min(deadline, Date.now() + 15000), done: gained });
        continue;
      }
      for (const drop of drops) {
        for (const point of pickupPositions(bot, drop, { hostilesOk }).slice(0, 5)) {
          task.check();
          if (Date.now() >= deadline || gained()) break;
          const attempt = `${key(bot, drop)}:${point}`;
          if (attempted.has(attempt)) continue;
          if (!allowed(point)) { why[allowedWhy(point) || 'bounds']++; continue; }
          attempted.add(attempt);
          const target = new PickupGoal(point), observed = drop.position.clone();
          const changed = () => bot.entities[drop.id] !== drop || drop.isValid === false || drop.position.distanceTo(observed) > .65;
          // A drop two blocks or more over the bot may be climbed to, a block or two put under the feet from what is
          // carried (note 2379): full-18 (25586, 2026-10-28 14:2xZ) left an ender pearl on warped nylium 4 above it, every
          // pickup spot 'no short clear route' with towering not allowed.
          const climb = drop.position.y - bot.entity.position.y >= 2 && (previous.scafoldingBlocks || []).length > 0;
          if (climb) Object.assign(movement, { allow1by1towers: true, scafoldingBlocks: previous.scafoldingBlocks });
          let route;
          try { route = await surveyRoute(bot, task, movement, target, Math.min(250, deadline - Date.now())); }
          finally { if (climb) Object.assign(movement, { allow1by1towers: false, scafoldingBlocks: [] }); }
          if (changed()) { why.moved++; continue; }
          if (route.status !== 'success' || (route.path || []).length > 32 ||
              !(route.path || []).every(p => allowed(p) && !p.toBreak?.length && (climb || !p.toPlace?.some(p => !p.useOne)))) { why.route++; continue; }
          if (climb) Object.assign(movement, { allow1by1towers: true, scafoldingBlocks: previous.scafoldingBlocks });
          why.walked++;
          onTarget({ item, position: { ...drop.position.floored() } });
          try {
            await move(bot, task, target, { timeoutMs: Math.min(4000, deadline - Date.now()), stallMs: 1500,
              stopWhen: () => gained() || changed() });
          } catch (error) {
            task.check(); if (['NeedsAir', 'NeedsSafety'].includes(error.name)) throw error;
          }
          if (climb) Object.assign(movement, { allow1by1towers: false, scafoldingBlocks: [] });
          // Arrival or entity disappearance is not proof that we received it.
          const pickupDeadline = Math.min(deadline, Date.now() + 450);
          while (!gained() && !changed() && Date.now() < pickupDeadline) { task.check(); await sleep(50); }
          if (gained() || changed()) break;
        }
        if (gained()) break;
      }
      if (!gained() && allowExcavation && !passageTried) {
        const targets = drops.flatMap(drop => { const at = pickupPositions(bot, drop, { hostilesOk }); return at.length ? at : dugStand(bot, drop); });
        if (targets.length) {
          passageTried = true;
          const pickupPolicy = { canDig: movement.canDig, allowedPosition: movement.allowedPosition, ...Object.fromEntries(Object.keys(previous).map(k => [k, movement[k]])) };
          // Remove only this collector's restrictions. The caller's no-dig and
          // construction boundaries still apply to the fallback survey.
          policy.restore(); Object.assign(movement, previous);
          const observed = drops.map(drop => ({ drop, position: drop.position.clone() }));
          const changed = () => observed.every(({ drop, position }) => bot.entities[drop.id] !== drop ||
            drop.isValid === false || drop.position.distanceTo(position) > .65);
          try {
            await require('./mining-passage').openMiningPassage(bot, task, targets, { navigate: move,
              stopWhen: () => gained() || changed() });
            const pickupDeadline = Date.now() + 450;
            while (!gained() && !changed() && Date.now() < pickupDeadline) { task.check(); checkAir(bot); await sleep(50); }
          } catch (error) {
            task.check(); if (['NeedsAir', 'NeedsSafety'].includes(error.name)) throw error;
            console.log(`[drops] the passage to the ${item.replaceAll('_', ' ')} came to nothing: ${String(error.message || error).slice(0, 160)}`);
          } finally { Object.assign(movement, pickupPolicy); }
        }
      }
      if (!gained()) await sleep(Math.max(0, Math.min(100, deadline - Date.now())));
    }
    if (!gained() && !extended && Object.values(why).every(v => !v) && nearbyDrops(bot, item, origin, radius, { hostilesOk }).length) { extended = true; deadline = Date.now() + 4000; continue; }
    break;
    }
    task.check();
    // A drop in a gap one high within reach, the passage not opened to it: the block over it dug from where the bot
    // stands, so the walk straight at it below fits the body (note 2354). full-13 (25587, 2026-10-28 07:00Z) left 2
    // gold nuggets 3.2 blocks off in the Nether, each in air over netherrack under netherrack, '1 dug' stand and no
    // walk or passage tried.
    if (!gained() && allowExcavation) {
      const eye = bot.entity.position.offset(0, 1.62, 0);
      // Out to eight, a walk within reach first (note 2468): the ore dug beside the ore dug drops into pockets a few
      // blocks off. full-80 (25587, 2026-10-29 09:5xZ) left 4 raw iron 7.6 blocks off and full-79 (25588) 2 at 4.4, each
      // 'in air over stone under stone, 0 spots, 1 dug', every count 0.
      for (const drop of nearbyDrops(bot, item, origin, radius, { hostilesOk }).filter(d => d.position.distanceTo(bot.entity.position) <= 8).slice(0, 3)) {
        task.check(); checkAir(bot);
        if (!dugStand(bot, drop).length) continue;
        const over = bot.blockAt(drop.position.floored().offset(0, 1, 0));
        if (!over || !over.diggable || over.boundingBox !== 'block') continue;
        if (bot.entity.position.offset(0, 1.62, 0).distanceTo(over.position.offset(0.5, 0.5, 0.5)) > 4.5) {
          const c = over.position;
          try { await move(bot, task, new goals.GoalNear(c.x, c.y, c.z, 3), { timeoutMs: 8000, stallMs: 3000, hostilesOk }); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; continue; }
        }
        if (bot.entity.position.offset(0, 1.62, 0).distanceTo(over.position.offset(0.5, 0.5, 0.5)) > 4.5) continue;
        if ([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]].some(([x, y, z]) => /lava|water/.test(bot.blockAt(over.position.offset(x, y, z))?.name || ''))) continue;
        try { await require('./skills').digWithTool(bot, over, true); } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[drops] the ${over.name} over the ${item.replaceAll('_', ' ')} not dug: ${String(err.message || err).slice(0, 120)}`); }
      }
    }
    // A drop lying in a fence, a wall, bars or a pane (note 2456): no stand is offered in its cell, and one beside it is
    // more than a pickup's reach from where it lies at the far side of the post. The block it lies in is dug, and the
    // one over it where that is of the same kind, from within reach, a walk there first, and the straight walk below
    // takes it up. full-63 (25586, 2026-10-29 06:42Z), its first blaze rod lying in a nether brick fence at a fortress
    // 6.4 blocks off, '0 spots, 1 dug', left it.
    if (!gained() && allowExcavation) {
      const THIN = /(_fence|_wall|_bars|_pane)$/;
      for (const drop of nearbyDrops(bot, item, origin, radius, { hostilesOk }).filter(d => d.position.distanceTo(bot.entity.position) <= 10).slice(0, 2)) {
        task.check(); checkAir(bot);
        const cell = drop.position.floored(), inIt = bot.blockAt(cell);
        if (!inIt || !THIN.test(inIt.name) || !inIt.diggable) continue;
        if ([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]].some(([x, y, z]) => /lava|water/.test(bot.blockAt(cell.offset(x, y, z))?.name || ''))) continue;
        try {
          if (bot.entity.position.offset(0, 1.62, 0).distanceTo(cell.offset(0.5, 0.5, 0.5)) > 4) await move(bot, task, new goals.GoalNear(cell.x, cell.y, cell.z, 2), { timeoutMs: 10000, stallMs: 4000, hostilesOk });
          for (const c of [cell, cell.offset(0, 1, 0)]) {
            const b = bot.blockAt(c);
            if (b && THIN.test(b.name) && b.diggable && bot.entity.position.offset(0, 1.62, 0).distanceTo(c.offset(0.5, 0.5, 0.5)) <= 4.5) await require('./vitals').digWithAirGuard(bot, task, b);
          }
          console.log(`[drops] the ${inIt.name.replaceAll('_', ' ')} the ${item.replaceAll('_', ' ')} lay in at ${cell} dug`);
        } catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; console.log(`[drops] the ${inIt.name.replaceAll('_', ' ')} the ${item.replaceAll('_', ' ')} lay in not dug: ${String(err.message || err).slice(0, 120)}`); }
      }
    }
    // A drop within arm's reach that no routed pickup spot could claim: walk
    // straight at it. Pickup is proximity, not a path. Four raw iron lay a
    // block from the bot while the router turned every spot down.
    if (!gained() && typeof bot.setControlState === 'function') {
      for (const drop of nearbyDrops(bot, item, origin, radius, { hostilesOk }).filter(d => d.position.distanceTo(bot.entity.position) <= 3.5).slice(0, 3)) {
        task.check(); checkAir(bot);
        const hot = hotOnTheWay(bot, drop.position);
        if (hot) { console.log(`[drops] the straight walk at the ${item.replaceAll('_', ' ')} would stand on the ${hot.name.replaceAll('_', ' ')} at (${hot.x}, ${hot.y}, ${hot.z}); not walked`); continue; }
        // Crouched: a drop lying past an edge (a rod off a fortress roof) is
        // not worth the fall the walk straight at it would be. A sneaking
        // player cannot walk off an edge, so the walk is slower and longer.
        const up = drop.position.y > bot.entity.position.y + 0.6;
        const edge = up ? edgeOnTheWay(bot, drop.position) : null;
        if (edge) { console.log(`[drops] the jump at the ${item.replaceAll('_', ' ')} a step up goes on over a drop of four blocks or more at (${edge.x}, ${edge.y}, ${edge.z}); not jumped at`); continue; }
        try {
          await motion.move(bot, task, { label: 'walk_to_drop', keys: up ? ['forward', 'jump'] : ['forward'], sneak: !up,
            why: up ? 'jumping up to a drop above: a step up, not over an edge' : undefined,
            look: drop.position.offset(0, 0.2, 0), maxMs: up ? 900 : 2500, tick: 50, until: gained });
        } catch (_) { task.check(); }
        if (gained()) break;
      }
    }
    // A drop sunk in water under the bot, swum down to (note 2465): the walk at it floats over it, and no pickup spot is
    // offered in water. Crouched in water the body sinks; the dive ends at half the air. full-71 (25592, 2026-10-29
    // 08:3xZ), no flint carried and its portal still to light, dug gravel at a pond's edge and its one flint sank to the
    // bottom 3 blocks under the bot, 'in water over water under water, 0 spots', and was left.
    if (!gained() && typeof bot.setControlState === 'function') {
      const wet = c => /water/.test(bot.blockAt(c)?.name || '');
      for (const drop of nearbyDrops(bot, item, origin, radius, { hostilesOk }).filter(d => d.position.distanceTo(bot.entity.position) <= 6 && d.position.y < bot.entity.position.y - 0.5 && wet(d.position.floored())).slice(0, 2)) {
        task.check(); checkAir(bot);
        if ((bot.oxygenLevel ?? 20) < 15) break;
        console.log(`[drops] the ${item.replaceAll('_', ' ')} lies in water ${Math.round(bot.entity.position.y - drop.position.y)} under the bot: swum down to`);
        try {
          await motion.move(bot, task, { label: 'swim_down_to_drop', keys: ['forward'], sneak: true, why: 'down through the water to a drop lying in it',
            look: drop.position.offset(0, 0.1, 0), maxMs: 5000, tick: 50, until: () => gained() || (bot.oxygenLevel ?? 20) < 10 });
        } catch (_) { task.check(); }
        if (gained()) break;
      }
    }
    // Last, as a player does: walk over to it, out to six blocks, the walk free to dig its way (note 2486). The spots, the
    // passage and the straight walk had each a reason to pass it by: full-83 (25586, 2026-10-29 11:3xZ) left 2 raw gold
    // 4 blocks off at y -2 after making room for them, '1 spots, 1 dug', every count 0; full-86 and full-88 raw iron at
    // 2.2 and 2.6.
    if (!gained() && allowExcavation) {
      // The collector's own restrictions off for this walk, as the passage above has them off; the caller's kept.
      const keep = { canDig: movement.canDig, allowedPosition: movement.allowedPosition, ...Object.fromEntries(Object.keys(previous).map(k => [k, movement[k]])) };
      policy.restore(); Object.assign(movement, previous);
      try {
      for (const drop of nearbyDrops(bot, item, origin, radius, { hostilesOk }).filter(d => d.position.distanceTo(bot.entity.position) <= 6 && Math.abs(d.position.y - bot.entity.position.y) <= 3).slice(0, 2)) {
        task.check(); checkAir(bot);
        const c = drop.position.floored();
        let failedWalk = null;
        // Fifteen seconds (note 2493): with the event loop held 2 to 5 s at a time on every run, six timed out on a dig of a
        // few blocks: full-90 (25586, 2026-10-29 13:0xZ), the raw gold 3.6 off, 'navigation timed out (dig true, towers true)'.
        // Into the drop's own cell, not beside it (note 2508): a cell off is the edge of a player's pickup reach, and full-98
        // (25589, 2026-10-29 15:2xZ) 'arrived, not picked up' 1.4 blocks from two raw iron, the walk done one cell short.
        try { await move(bot, task, new goals.GoalNear(c.x, c.y, c.z, 0), { timeoutMs: 15000, stallMs: 5000, hostilesOk, stopWhen: () => gained() }); }
        catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; failedWalk = err; }
        for (const until = Date.now() + 500; !gained() && Date.now() < until;) { task.check(); await sleep(50); }
        if (gained()) { console.log(`[drops] the ${item.replaceAll('_', ' ')} at ${c} taken by a walk over to it`); break; }
        // In water a step or two off, where the route search finds no way into the water's cell (note 2513): stepped
        // toward straight, as a player does. full-100 (25590, 2026-10-29 15:5xZ) left flint 1 block off in water, 'No
        // route from here to (-208, 40, 94) (partial)'.
        if (failedWalk && /water/.test(bot.blockAt(c)?.name || '') && drop.position.distanceTo(bot.entity.position) <= 2.5) {
          try { await require('./motion').move(bot, task, { label: 'into_water_for_drop', keys: ['forward'], sneak: false, why: `the ${item.replaceAll('_', ' ')} lying in the water beside the bot`, look: drop.position.clone(), maxMs: 1500, tick: 50, until: () => gained() }); }
          catch (err) { task.check(); if (['NeedsAir', 'NeedsSafety', 'Cancelled'].includes(err.name)) throw err; }
          for (const until = Date.now() + 500; !gained() && Date.now() < until;) { task.check(); await sleep(50); }
          if (gained()) { console.log(`[drops] the ${item.replaceAll('_', ' ')} at ${c} taken by a step into the water`); break; }
        }
        // Why the walk over came to nothing (note 2492): full-90 (25586, 2026-10-29 12:41Z) left raw iron 2.9 off, 2 up on
        // gravel from a tunnel, with no word of the walk.
        console.log(`[drops] the walk over to the ${item.replaceAll('_', ' ')} at ${c} from ${bot.entity.position.floored()}: ${failedWalk ? String(failedWalk.message || failedWalk).slice(0, 140) : 'arrived, not picked up'} (dig ${movement.canDig !== false}, towers ${!!movement.allow1by1towers})`);
      }
      } finally { Object.assign(movement, keep); }
    }
    if (!gained()) {
      const lyingNow = nearbyDrops(bot, item, origin, radius, { hostilesOk });
      if (lyingNow.length) {
        const nearest = Math.min(...lyingNow.map(d => d.position.distanceTo(bot.entity.position)));
        // Where each lies, for a pickup with no spot of any kind (note 2349): full-16 (25591, 2026-10-28 06:2xZ) left
        // raw iron 1.6 blocks off with every count at 0, after 2347, and the line said nothing of where it lay.
        const cells = lyingNow.slice(0, 3).map(d => { const c = d.position.floored(); return `(${c.x}, ${c.y}, ${c.z}) in ${bot.blockAt(c)?.name || '?'} over ${bot.blockAt(c.offset(0, -1, 0))?.name || '?'} under ${bot.blockAt(c.offset(0, 1, 0))?.name || '?'}, ${pickupPositions(bot, d, { hostilesOk }).length} spots, ${dugStand(bot, d).length} dug`; }).join('; ');
        console.log(`[drops] lying at ${cells}; the bot at ${bot.entity.position.floored()} ${bot.entity.onGround ? 'on the ground' : 'in the air'}`);
        console.log(`[drops] ${item.replaceAll('_', ' ')} not taken: ${lyingNow.length} lying within ${radius} of the search's origin, the nearest ${Math.round(nearest * 10) / 10} from the bot; spots passed over: ${why.hostile} by a hostile about, ${why.bounds} out of bounds or on damaging ground, ${why.route} with no short clear route, ${why.moved} the drop moving; ${why.walked} walked to without the pickup`);
      }
      let failed = failures.get(bot);
      if (!failed) failures.set(bot, failed = new Map());
      for (const drop of nearbyDrops(bot, item, origin, radius, { hostilesOk })) failed.set(key(bot, drop), Date.now() + 30000);
      while (failed.size > 64) failed.delete(failed.keys().next().value);
    }
    return gained();
  } finally {
    policy.restore();
    for (const [name, value] of Object.entries(previous)) if (value === undefined) delete movement[name]; else movement[name] = value;
  }
}

module.exports = { dugStand, nearbyDrops, collectNearbyDrops, pickupPositions, hotOnTheWay, edgeOnTheWay };
