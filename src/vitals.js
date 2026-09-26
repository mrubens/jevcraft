'use strict';
const { Vec3 } = require('vec3');
const { swimmableWater, waterLevel } = require('./terrain');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const unsafeFoods = new Set(['pufferfish', 'poisonous_potato', 'spider_eye', 'rotten_flesh', 'chicken', 'suspicious_stew', 'chorus_fruit']);

class NeedsAir extends Error {
  constructor() { super('Low air: interrupt work and surface'); this.name = 'NeedsAir'; }
}

// The head in a solid block: suffocating, a point every half second. The
// clean run's night mine let gravel (or its own digging) close over its head
// at y 35 and died there in ten seconds, its steps failing around it
// (2026-09-24). Counted as needing air, so work stops, and the block is dug.
// Only while it is hurting (suffocation is a point every half second): a
// position read mid-step inside a block's corner is not suffocation.
function headInBlock(bot) {
  if (!(bot._recentHurtAt > Date.now() - 2000)) return false;
  const eye = bot.entity?.position?.offset(0, bot.entity.eyeHeight || 1.62, 0);
  const b = eye && bot.blockAt?.(eye.floored());
  return !!b && b.boundingBox === 'block' && !/_leaves$|glass|slab|stairs|fence|wall|door|trapdoor|scaffolding|chest|bed$/.test(b.name);
}
function needsAir(bot) { return bot.oxygenLevel <= 12 || headInBlock(bot); }
function checkAir(bot) { if (needsAir(bot)) throw new NeedsAir(); }
function headSubmerged(bot) {
  const eye = bot.entity?.position?.offset(0, bot.entity.eyeHeight || 1.62, 0);
  if (!eye) return false;
  const head = eye.floored(), block = bot.blockAt?.(head);
  if (!swimmableWater(block)) return false;
  const level = waterLevel(block);
  // Flowing water only fills part of a block. Its name alone cannot establish
  // that the player's eyes are below the fluid surface.
  const height = swimmableWater(bot.blockAt(head.offset(0, 1, 0))) ? 1 : (8 - (level >= 8 ? 0 : level)) / 9;
  return eye.y < head.y + height;
}

async function digWithAirGuard(bot, task, block) {
  task.check(); checkAir(bot);
  let interrupted;
  const watcher = setInterval(() => {
    try { task.check(); checkAir(bot); }
    catch (err) { interrupted ||= err; bot.stopDigging(); }
  }, 100);
  try { await bot.dig(block); }
  catch (err) { throw interrupted || err; }
  finally { clearInterval(watcher); }
  if (interrupted) throw interrupted;
  task.check(); checkAir(bot);
}

// Search body-sized spaces for breathable air, the quickest way there: a
// step through water or air is about 0.4 s, and a block in the way costs
// the time to dig it with the fastest tool carried, as the game reckons it
// under water. Trial 63 drowned a pointed dripstone's width from a dry cave:
// water and air alone found no way, and the straight dig up broke into the
// lake over its head. A block dug is named on the route cell (`digs`).
const STEP_S = 0.4, DIG_MAX_S = 4;
function digSeconds(bot, block) {
  if (!block || typeof block.digTime !== 'function' || block.diggable === false || /bedrock|lava|obsidian/.test(block.name)) return null;
  const tools = [null, ...new Set((bot.inventory?.items?.() || []).filter(i => /_(pickaxe|shovel|axe)$/.test(i.name)).map(i => i.type))];
  // A swimmer with a floor under it sinks to stand and dig: five times
  // quicker than digging afloat.
  const below = bot.entity?.position && bot.blockAt?.(bot.entity.position.floored().offset(0, -1, 0));
  const wet = !!bot.entity?.isInWater, floating = !bot.entity?.onGround && below?.boundingBox !== 'block';
  let best = Infinity;
  for (const type of tools) { try { best = Math.min(best, block.digTime(type, false, wet, floating, [], bot.entity?.effects || {})); } catch (_) { /* not for this tool */ } }
  return Number.isFinite(best) ? best / 1000 : null;
}
// `closed` names cells a swimmer was held out of on the way (see
// surfaceForAir): the search goes round them.
function airRoute(bot, closed = new Set()) {
  const start = bot.entity.position.floored();
  const open = b => swimmableWater(b) || b && ['air', 'cave_air', 'void_air'].includes(b.name);
  const water = p => swimmableWater(bot.blockAt(p));
  // Seconds to make a cell passable: 0 open, the dig time for a block that
  // comes away quickly and brings nothing down, null otherwise.
  const clear = p => {
    const b = bot.blockAt(p);
    if (open(b)) return 0;
    if (/sand|gravel|concrete_powder/.test(b?.name || '')) return null;
    const t = digSeconds(bot, b);
    return t != null && t <= DIG_MAX_S ? t : null;
  };
  const directions = [new Vec3(0, 1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, -1, 0)];
  const frontier = [{ p: start, path: [], cost: 0 }];
  const best = new Map([[`${start}`, 0]]);
  for (let n = 0; frontier.length && n < 4096; n++) {
    frontier.sort((a, b) => a.cost - b.cost);
    const { p, path, cost } = frontier.shift();
    if (cost > (best.get(`${p}`) ?? Infinity)) continue;
    if (!closed.has(`${p}`) && open(bot.blockAt(p)) && open(bot.blockAt(p.offset(0, 1, 0))) && !water(p.offset(0, 1, 0)) &&
      (water(p) || bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block')) return path.length ? path : [p];
    for (const d of directions) {
      const next = p.plus(d);
      if (next.y - start.y > 20 || next.y < start.y - 4 || Math.abs(next.x - start.x) > 8 || Math.abs(next.z - start.z) > 8) continue;
      if (closed.has(`${next}`)) continue;
      const feet = clear(next), head = clear(next.offset(0, 1, 0));
      if (feet == null || head == null) continue;
      // A block with a collision box is in the way however quickly it comes
      // away, and is named to be dug: mid-92-b's way to air went up through
      // a lily pad, which breaks at a touch and so cost nothing and was
      // named as nothing, and its underside held the head a tenth under the
      // surface until the bot drowned pressing jump into it (2026-09-25).
      const inWay = (q, t) => t > 0 || (!open(bot.blockAt(q)) && bot.blockAt(q)?.boundingBox === 'block');
      const feetDug = inWay(next, feet), headDug = inWay(next.offset(0, 1, 0), head);
      // Through air only where there is water about or ground within three
      // below: a step into a cave is a short drop, off a cliff is not.
      const dug = feetDug || headDug;
      const ground = [1, 2, 3].some(dy => bot.blockAt(next.offset(0, -dy, 0))?.boundingBox === 'block');
      if (!dug && !water(next) && !water(next.offset(0, 1, 0)) && !water(next.offset(0, -1, 0)) && !ground && d.y >= 0) continue;
      const total = cost + STEP_S + feet + head;
      if (total >= (best.get(`${next}`) ?? Infinity)) continue;
      best.set(`${next}`, total);
      const cell = next.clone();
      cell.digs = [feetDug && next, headDug && next.offset(0, 1, 0)].filter(Boolean);
      frontier.push({ p: next, path: [...path, cell], cost: total });
    }
  }
  return null;
}

async function surfaceForAir(bot, task, onAction = () => {}) {
  onAction({ action: 'surface', oxygen: bot.oxygenLevel });
  bot.pathfinder.setGoal(null); bot.stopDigging(); bot.clearControlStates();
  const closed = new Set();
  let route = airRoute(bot, closed);
  if (!route) return straightUp(bot, task);
  const deadline = Date.now() + 15000;
  let index = 0;
  // Air comes before anything, and a swimmer held still is spending it for
  // nothing: mid-92-b pressed jump into a lily pad the way to air went
  // through, not a hair of movement for thirteen seconds, and drowned
  // (2026-09-25). Whatever holds it (a block the search misread, a boat, a
  // current), a second with no ground gained and no air back closes the cell
  // it was making for, and the way is found again from where it is; with
  // none left, straight up, digging.
  const STILL_MS = 1000;
  const mark = () => ({ at: Date.now(), p: bot.entity.position.clone(), air: bot.oxygenLevel });
  let last = mark();
  try {
    // A reconnect starts with a full client air bar even when the saved player
    // is underwater. Require actual breathable headroom as well as full air.
    while (bot.oxygenLevel < 20 || headSubmerged(bot)) {
      task.check();
      if (Date.now() >= deadline) throw new Error('Could not reach breathable air along the observed swimming route');
      const p = bot.entity.position;
      // A block in the way on the route is dug when the bot is beside it.
      for (const cell of route[index].digs || []) {
        const block = bot.blockAt(cell);
        if (!block || block.boundingBox !== 'block') continue;
        // Let go and sink onto the floor: a dig afloat takes five times as
        // long. Not for one that comes away at a touch (a lily pad).
        bot.clearControlStates();
        if (!(digSeconds(bot, block) < 0.5)) for (let i = 0; i < 12 && !bot.entity.onGround; i++) { task.check(); await sleep(50); }
        try { await require('./skills').equipBestTool(bot, block); } catch (_) { /* the hand, then */ }
        await bot.lookAt(cell.offset(0.5, 0.5, 0.5), true);
        try { await bot.dig(block, true); } catch (err) { if (err.name === 'Cancelled') throw err; }
        task.check();
        last = mark();
      }
      // Still with the eyes out of the water is breathing, not stuck.
      if (p.distanceTo(last.p) > 0.15 || bot.oxygenLevel > last.air || !headSubmerged(bot)) last = mark();
      else if (Date.now() - last.at > STILL_MS) {
        closed.add(`${route[index]}`);
        onAction({ action: 'surface', oxygen: bot.oxygenLevel, heldOutOf: { x: route[index].x, y: route[index].y, z: route[index].z } });
        bot.clearControlStates();
        route = airRoute(bot, closed); index = 0; last = mark();
        if (!route) return await straightUp(bot, task);
        continue;
      }
      const target = route[index].offset(0.5, 0, 0.5);
      const horizontal = Math.hypot(target.x - p.x, target.z - p.z);
      // A cell lower than the swimmer is sunk to, not swum over: trial 87's
      // way to air went down a block under a low ceiling and up again, and
      // the swimmer, holding jump the whole time and counting the lower
      // cell reached from above it, floated against the ceiling and drowned.
      // The feet held at the cell's own height, within a tenth: under a
      // low ceiling a tenth too high is a head against the rock.
      const lower = target.y < p.y - 0.1;
      const reached = horizontal < 0.35 && Math.abs(p.y - target.y) <= 0.3;
      if (reached && index < route.length - 1) { index++; continue; }
      if (horizontal > 0.2) await bot.lookAt(new Vec3(target.x, p.y + 1.62, target.z), true);
      bot.setControlState('forward', horizontal > 0.2 && !(lower && p.y - target.y > 0.4));
      bot.setControlState('jump', !lower && p.y < target.y + 0.05 && (bot.entity.isInWater || p.y < target.y));
      bot.setControlState('sneak', lower && !!bot.entity.isInWater);
      await sleep(50);
    }
    task.check();
  } finally { bot.clearControlStates(); }
}

// No observed swimming route: straight up, as a player trapped under water
// goes, digging what is over the head (a fallen sand ceiling keeps coming,
// so it keeps being dug) and swimming through what is not. Trial 7's bot
// broke into a lakebed on its way up a staircase, the sand came down and the
// water after it, and "no observed swimming route" was thrown twenty times a
// second until it drowned (2026-09-24).
async function straightUp(bot, task, { maxMs = 8000 } = {}) {
  const deadline = Date.now() + maxMs;
  try {
    while ((bot.oxygenLevel ?? 20) < 20 || headSubmerged(bot)) {
      task.check();
      // Worded to match the minute's pause after a failed swim (maintainVitals
      // looks for "breathable air"): unmatched, it ran every tick with the air
      // bar full in trial 11's flooded shaft (2026-09-24).
      if (Date.now() >= deadline) throw new Error('No way up to breathable air found: dug and swam straight up for eight seconds');
      const above = bot.blockAt(bot.entity.position.offset(0, 2, 0).floored());
      if (above && above.boundingBox === 'block' && above.diggable && !/bedrock/.test(above.name)) {
        bot.clearControlStates();
        await bot.lookAt(above.position.offset(0.5, 0.5, 0.5), true);
        try { await bot.dig(above, true); } catch (_) { await sleep(100); }
        continue;
      }
      await require('./motion').move(bot, task, { label: 'swim_up', keys: ['jump'], sneak: false, why: 'no swimming route: straight up to air',
        maxMs: 300, tick: 50, until: () => !headSubmerged(bot) });
    }
  } finally { bot.clearControlStates(); }
}

// In powder snow: the bot sinks into it, and after seven seconds inside it
// freezes, a point every two seconds. Trial 89 spawned in a drift four deep,
// read the snow over its head as a roof, tried to dig out as from a mine,
// and froze to death in under a minute. The way out is the nearest cell
// with no powder snow at the feet or the head and a floor under it, the
// snow on the way dug (a hand takes it in a moment), then walked to.
const POWDER = 'powder_snow';
function inPowderSnow(bot) {
  const feet = bot.entity?.position?.floored();
  return !!feet && [0, 1].some(dy => bot.blockAt?.(feet.offset(0, dy, 0))?.name === POWDER);
}
function snowRoute(bot) {
  const start = bot.entity.position.floored();
  const clearOrSnow = b => b && (b.boundingBox === 'empty' || b.name === POWDER) && !/lava|water|fire/.test(b.name);
  const out = p => [0, 1].every(dy => { const b = bot.blockAt(p.offset(0, dy, 0)); return b && b.boundingBox === 'empty' && b.name !== POWDER && !/lava|water|fire/.test(b.name); }) &&
    bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block' && bot.blockAt(p.offset(0, -1, 0))?.name !== POWDER;
  const dirs = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)];
  const queue = [{ p: start, path: [] }], seen = new Set([`${start}`]);
  for (let i = 0; i < queue.length && i < 2048; i++) {
    const { p, path } = queue[i];
    if (path.length && out(p)) return path;
    for (const d of dirs) {
      const next = p.plus(d);
      if (seen.has(`${next}`) || next.distanceTo(start) > 8) continue;
      seen.add(`${next}`);
      if (!clearOrSnow(bot.blockAt(next)) || !clearOrSnow(bot.blockAt(next.offset(0, 1, 0)))) continue;
      // Down only onto something: a drift over a drop is not the way out.
      if (d.y === 0 && bot.blockAt(next.offset(0, -1, 0))?.boundingBox !== 'block' && bot.blockAt(next.offset(0, -1, 0))?.name !== POWDER) continue;
      queue.push({ p: next, path: [...path, next] });
    }
  }
  return null;
}
async function outOfPowderSnow(bot, task, onAction = () => {}) {
  const route = snowRoute(bot);
  onAction({ action: 'out_of_powder_snow', steps: route?.length ?? null });
  if (!route) return false;
  for (const cell of route) {
    for (const c of [cell, cell.offset(0, 1, 0)]) {
      task.check();
      const b = bot.blockAt(c);
      if (b?.name !== POWDER) continue;
      await bot.lookAt(c.offset(0.5, 0.5, 0.5), true);
      try { await bot.dig(b, true); } catch (err) { if (err.name === 'Cancelled') throw err; }
    }
  }
  // Also what the bot stands in now, feet and head.
  const feet = bot.entity.position.floored();
  for (const c of [feet, feet.offset(0, 1, 0)]) { const b = bot.blockAt(c); if (b?.name === POWDER) { try { await bot.dig(b, true); } catch (err) { if (err.name === 'Cancelled') throw err; } } }
  const end = route.at(-1);
  const { goals } = require('mineflayer-pathfinder');
  try { await bot.pathfinder.goto(new goals.GoalBlock(end.x, end.y, end.z)); } catch (err) { if (err.name === 'Cancelled') throw err; }
  return !inPowderSnow(bot);
}

// Fire: trial 101 walked to an oak by the lava pool it had found, the
// forest caught, and it stood in the burning grass from twenty health to
// nothing in twenty seconds, mining the tree, with nothing answering the
// hurt (2026-09-25). In fire, or burning with fire beside it, the bot gets
// to the nearest cell two blocks clear of any fire, or into water, which
// puts it out; burning with no fire near, it burns out in a few seconds.
const FIRE = new Set(['fire', 'soul_fire']);
const onFire = bot => !!(bot.entity?.metadata?.[0] & 1);
function fireNear(bot, p, r) {
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = -1; dy <= 2; dy++) if (FIRE.has(bot.blockAt?.(p.offset(dx, dy, dz))?.name)) return true;
  return false;
}
function inFire(bot) {
  const feet = bot.entity?.position?.floored();
  if (!feet) return false;
  if ([0, 1].some(dy => FIRE.has(bot.blockAt?.(feet.offset(0, dy, 0))?.name))) return true;
  return onFire(bot) && fireNear(bot, feet, 1);
}
// A way round the flames first; ringed by them, a way through (a player
// runs through a block of fire rather than stand in one).
function fireRoute(bot) { return fireRouteThrough(bot, false) || fireRouteThrough(bot, true); }
function fireRouteThrough(bot, throughFire) {
  const start = bot.entity.position.floored();
  const clear = b => b && b.boundingBox === 'empty' && (throughFire || !FIRE.has(b.name)) && b.name !== 'lava';
  const water = p => bot.blockAt(p)?.name === 'water';
  const floor = p => { const b = bot.blockAt(p.offset(0, -1, 0)); return b && (b.boundingBox === 'block' || b.name === 'water') && !['lava', 'magma_block'].includes(b.name); };
  const dirs = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
  const queue = [{ p: start, path: [] }], seen = new Set([`${start}`]);
  for (let i = 0; i < queue.length && i < 4096; i++) {
    const { p, path } = queue[i];
    if (path.length && (water(p) || !fireNear(bot, p, 2))) return path;
    for (const d of dirs) for (const dy of [0, 1, -1]) {
      const next = p.plus(d).offset(0, dy, 0);
      if (seen.has(`${next}`) || next.distanceTo(start) > 12) continue;
      if (!(clear(bot.blockAt(next)) || water(next)) || !clear(bot.blockAt(next.offset(0, 1, 0))) || !(water(next) || floor(next))) continue;
      // A step up needs the head room over the cell left.
      if (dy === 1 && !clear(bot.blockAt(p.offset(0, 2, 0)))) continue;
      seen.add(`${next}`);
      queue.push({ p: next, path: [...path, next] });
    }
  }
  return null;
}
async function outOfFire(bot, task, onAction = () => {}) {
  const route = fireRoute(bot);
  onAction({ action: 'out_of_fire', steps: route?.length ?? null, health: bot.health });
  if (!route) return false;
  // Walked cell by cell on the keys: the path search will not start from
  // a cell of fire or cross one, and handed the route it returned at once
  // (the arena: burned in place three times out of three).
  bot.pathfinder?.setGoal?.(null);
  const { move } = require('./motion');
  for (const [i, cell] of route.entries()) {
    const target = cell.offset(0.5, 0, 0.5);
    // At a sprint the cells on the way are passed through, not stood on:
    // held to a third of a block, each one overshot and was turned back to.
    const near = i === route.length - 1 ? 0.45 : 0.8;
    const there = () => { const here = bot.entity.position; return Math.hypot(target.x - here.x, target.z - here.z) < near && Math.abs(here.y - cell.y) < 0.6; };
    const up = cell.y > Math.floor(bot.entity.position.y + 0.01);
    await move(bot, task, { label: 'out_of_fire', keys: up ? ['forward', 'sprint', 'jump'] : ['forward', 'sprint'], sneak: false, why: 'running out of fire',
      look: target.offset(0, 1.6, 0), maxMs: 1500, tick: 50, until: there });
  }
  return !inFire(bot);
}

// Burning with no fire about (lava sets a body burning for a quarter of a
// minute after it is left): water puts it out, as a player pours the bucket
// at their feet and takes it back. mid-110-b stepped into the lava pool it
// was getting obsidian from, got out, and burned from thirteen health to two
// standing beside it with a water bucket in its pack (2026-09-25).
async function douse(bot, task, onAction = () => {}) {
  const bucket = bot.inventory.items().find(i => i.name === 'water_bucket');
  if (/nether/.test(String(bot.game?.dimension || ''))) return false;
  // No water carried: water within eight blocks is walked into, as a player
  // runs for the pond. mid-110-j came out of a lava pool with an empty bucket
  // and burned from sixteen health to nothing on the bank (2026-09-26).
  if (!bucket) {
    const here = bot.entity.position.floored();
    let pond = null;
    for (let r = 1; r <= 8 && !pond; r++) for (let dx = -r; dx <= r && !pond; dx++) for (let dz = -r; dz <= r && !pond; dz++) for (const dy of [0, -1, 1]) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const c = here.offset(dx, dy, dz);
      if (bot.blockAt(c)?.name === 'water' && !/lava|fire/.test(bot.blockAt(c.offset(0, 1, 0))?.name || '')) { pond = c; break; }
    }
    if (!pond) return false;
    onAction({ action: 'douse', health: bot.health, pond: { ...pond } });
    await require('./motion').move(bot, task, { label: 'into_water', keys: ['forward', 'sprint'], sneak: false, why: 'burning, into the water to put it out',
      look: pond.offset(0.5, 1, 0.5), maxMs: 4000, tick: 50, until: () => !onFire(bot) || !!bot.entity.isInWater });
    return !onFire(bot);
  }
  const feet = bot.entity.position.floored(), below = feet.offset(0, -1, 0);
  if (bot.blockAt(below)?.boundingBox !== 'block' || !['air', 'cave_air'].includes(bot.blockAt(feet)?.name)) return false;
  onAction({ action: 'douse', health: bot.health });
  await bot.equip(bucket, 'hand'); task.check();
  await bot.lookAt(below.offset(0.5, 1, 0.5), true);
  bot.activateItem();
  for (let n = 0; n < 20 && onFire(bot); n++) { await sleep(50); task.check(); }
  // The water back into the bucket, for the next time and the obsidian.
  const empty = bot.inventory.items().find(i => i.name === 'bucket');
  if (empty && bot.blockAt(feet)?.name === 'water') {
    await bot.equip(empty, 'hand'); task.check();
    await bot.lookAt(feet.offset(0.5, 0.9, 0.5), true);
    bot.activateItem();
    await sleep(150);
  }
  return !onFire(bot);
}

function safeFood(bot, item) { return !!bot.registry.foodsByName?.[item.name] && !unsafeFoods.has(item.name); }

// Food with a Hunger side effect and nothing worse. The effect costs well
// under one hunger point over its thirty seconds; the item gives several.
// With nothing else in the pockets it is the only way back to the eighteen
// that regeneration needs: the dream run sat sealed in a pocket beside a
// blaze spawner at ten health and seventeen hunger for ten minutes, two
// rotten flesh in its pack, healing nothing, because it would not eat them.
const lastResortFoods = new Set(['rotten_flesh', 'chicken']);
function lastResortFood(bot) {
  return bot.inventory.items().find(item => lastResortFoods.has(item.name) && bot.registry.foodsByName?.[item.name]);
}

const CLOSE = 5;
// Close and able to get at the bot: through a wall it is not. Sealed in a
// pocket at three health with a skeleton outside, the dream run would not
// eat, so could not heal, and the work walked it out to be shot (2026-09-24).
function closeHostile(bot) {
  const here = bot.entity?.position;
  if (!here) return false;
  const eye = here.offset(0, 1.62, 0);
  const reaches = e => {
    if (typeof bot.world?.raycast !== 'function') return true;
    const aim = e.position.offset(0, Math.min(e.height || 1.6, 1.6), 0), dir = aim.minus(eye), d = dir.norm();
    if (d < 1.2) return true;
    const hit = bot.world.raycast(eye, dir.scaled(1 / d), d);
    return !hit || eye.distanceTo(hit.intersect || hit.position) >= d - 0.5;
  };
  return Object.values(bot.entities || {}).some(e => e !== bot.entity && e.position && e.isValid !== false &&
    (bot.registry?.entitiesByName?.[e.name]?.type === 'hostile' || e.type === 'hostile') && e.position.distanceTo(here) <= CLOSE && reaches(e));
}

function chooseFood(bot) {
  return bot.inventory.items().filter(item => safeFood(bot, item))
    .sort((a, b) => {
      const value = item => bot.registry.foodsByName[item.name].effectiveQuality - (item.name.includes('golden') ? 100 : 0);
      return value(b) - value(a);
    })[0];
}

async function until(task, predicate, timeout, message) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    task.check();
    if (Date.now() >= deadline) throw new Error(message);
    await sleep(100);
  }
  task.check();
}

async function maintainVitals(bot, task, onAction = () => {}) {
  task.check();
  // A submerged head with the air bar full is a reason to swim up only while
  // swimming up works. Under a stone roof it never could: the replay run and
  // its drill tried every tick, and the way out (the shore search, which can
  // dig) never had a turn. After a failed swim, only low air sends it up
  // again for a minute.
  const lately = bot._surfaceFailedAt > Date.now() - 60000;
  // Out of the block first. A falling column refills the head's cell after
  // every dig, so a step aside into open air beside the feet comes first, as
  // a player steps out from under gravel; then the dig, as often as it takes.
  // Nothing but a cancellation stops it: a creeper ten blocks off and the
  // spare pickaxe each broke off the dig, four tries a time, while mid-79-c
  // suffocated under gravel from nineteen health (2026-09-26).
  if (headInBlock(bot)) {
    const feet = bot.entity.position.floored();
    const open = b => b && b.boundingBox === 'empty' && !/lava|fire|water/.test(b.name);
    const aside = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => feet.offset(dx, 0, dz))
      .find(c => open(bot.blockAt(c)) && open(bot.blockAt(c.offset(0, 1, 0))) && bot.blockAt(c.offset(0, -1, 0))?.boundingBox === 'block' &&
        !/^(sand|red_sand|gravel|suspicious_sand|suspicious_gravel)$/.test(bot.blockAt(c.offset(0, 2, 0))?.name || ''));
    if (aside) {
      onAction({ action: 'dig_out_of_block', block: bot.blockAt(feet.offset(0, 1, 0))?.name, stepAside: { ...aside } });
      try {
        // Only a cancellation stops the step: the threat check would end it
        // at the first creeper in view.
        const only = { get cancelled() { return task.cancelled; }, label: task.label, check() { if (task.cancelled) throw new (require('./skills').Cancelled)(task.label); } };
        await require('./motion').move(bot, only, { label: 'out_from_under', keys: ['forward'], sneak: false, why: 'stepping out from under a block over the head',
          look: aside.offset(0.5, 1.6, 0.5), maxMs: 1200, tick: 50, until: () => !headInBlock(bot) || bot.entity.position.floored().equals(aside) });
      } catch (err) { if (err.name === 'Cancelled') throw err; }
    }
  }
  for (let tries = 0; tries < 12 && headInBlock(bot); tries++) {
    if (task.cancelled) throw new (require('./skills').Cancelled)(task.label);
    const eye = bot.entity.position.offset(0, bot.entity.eyeHeight || 1.62, 0).floored(), block = bot.blockAt(eye);
    onAction({ action: 'dig_out_of_block', block: block.name, at: { ...eye } });
    try { await require('./skills').equipBestTool(bot, block); } catch (_) { /* the hand, then */ }
    try { await bot.dig(block, true); } catch (err) { if (err.name === 'Cancelled') throw err; }
    await sleep(150);
  }
  task.check();
  if (inPowderSnow(bot)) { await outOfPowderSnow(bot, task, onAction); task.check(); }
  if (inFire(bot)) { await outOfFire(bot, task, onAction); task.check(); }
  if (onFire(bot) && !inFire(bot) && !require('./terrain').bodyInLava(bot)) { await douse(bot, task, onAction); task.check(); }
  if (bot.oxygenLevel <= 12 || (headSubmerged(bot) && !lately)) {
    try { await surfaceForAir(bot, task, onAction); delete bot._surfaceFailedAt; }
    catch (err) { if (err.name !== 'Cancelled' && /breathable air/.test(err.message)) bot._surfaceFailedAt = Date.now(); throw err; }
  }
  // Natural regeneration needs at least 18 hunger points. A sheltered injured
  // player at 17 must not wait all night with carried food and no healing.
  if (!(bot.food <= 16 || (bot.health < 20 && bot.food < 18) || (bot.health <= 12 && bot.food < 20))) return false;
  // Not with a mob at arm's length. Eating is a second and a half standing
  // still with the hand busy, and the health it brings back comes over the
  // next minute: death nineteen ate twice at six health with a zombie
  // beside it. Starvation is the one reason to eat anyway.
  if (bot.food > 2 && closeHostile(bot)) return false;
  // In an encounter the meal is a stance, Jev's to choose with the others
  // (survival.js stanceOptions, eat): eaten here between two ticks of a
  // stance it stopped the run or the pocket chosen, a second and a half at
  // a time (mid-83-d ate at twelve health in the middle of its retreat).
  // Down to six hunger, where the bot can no longer sprint, it still eats.
  const held = require('./danger').stanceHeld(bot);
  if (bot.food > 6 && held && held.choice !== 'keep_working' && held.choice !== 'eat') return false;
  // Last resort only when it unlocks regeneration or holds off starvation;
  // a bot at full health does not eat rotten flesh for the fun of it.
  const food = chooseFood(bot) || ((bot.food < 18 && bot.health < 20) || bot.food <= 6 ? lastResortFood(bot) : null);
  if (!food) return false; // The higher-level survival planner must forage.
  onAction({ action: 'eat', item: food.name, food: bot.food, health: bot.health });
  await bot.equip(food, 'hand');
  if (bot._syncWindow) await bot._syncWindow(bot.inventory);
  task.check();
  const before = bot.food;
  let watcher;
  try {
    const cancelled = new Promise((_, reject) => {
      watcher = setInterval(() => {
        try { task.check(); }
        catch (err) { bot.deactivateItem(); reject(err); }
      }, 100);
    });
    // The hand can empty between the equip and the bite (a slot resync);
    // mineflayer's consume reads the held item's name without looking.
    if (bot.heldItem === null) throw new Error('The food was not in hand to eat');
    await Promise.race([bot.consume(), cancelled]);
    await until(task, () => bot.food > before, 3000, 'Eating did not restore hunger');
  } finally { clearInterval(watcher); bot.deactivateItem(); }
  return true;
}

module.exports = { douse, inFire, fireRoute, outOfFire, inPowderSnow, snowRoute, outOfPowderSnow, lastResortFood, chooseFood, safeFood, maintainVitals, needsAir, checkAir, headSubmerged, headInBlock, NeedsAir, digWithAirGuard, airRoute, surfaceForAir };
