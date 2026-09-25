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
function airRoute(bot) {
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
    if (open(bot.blockAt(p)) && open(bot.blockAt(p.offset(0, 1, 0))) && !water(p.offset(0, 1, 0)) &&
      (water(p) || bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block')) return path.length ? path : [p];
    for (const d of directions) {
      const next = p.plus(d);
      if (next.y - start.y > 20 || next.y < start.y - 4 || Math.abs(next.x - start.x) > 8 || Math.abs(next.z - start.z) > 8) continue;
      const feet = clear(next), head = clear(next.offset(0, 1, 0));
      if (feet == null || head == null) continue;
      // Through air only where there is water about or ground within three
      // below: a step into a cave is a short drop, off a cliff is not.
      const dug = feet > 0 || head > 0;
      const ground = [1, 2, 3].some(dy => bot.blockAt(next.offset(0, -dy, 0))?.boundingBox === 'block');
      if (!dug && !water(next) && !water(next.offset(0, 1, 0)) && !water(next.offset(0, -1, 0)) && !ground && d.y >= 0) continue;
      const total = cost + STEP_S + feet + head;
      if (total >= (best.get(`${next}`) ?? Infinity)) continue;
      best.set(`${next}`, total);
      const cell = next.clone();
      cell.digs = [feet > 0 && next, head > 0 && next.offset(0, 1, 0)].filter(Boolean);
      frontier.push({ p: next, path: [...path, cell], cost: total });
    }
  }
  return null;
}

async function surfaceForAir(bot, task, onAction = () => {}) {
  onAction({ action: 'surface', oxygen: bot.oxygenLevel });
  bot.pathfinder.setGoal(null); bot.stopDigging(); bot.clearControlStates();
  const route = airRoute(bot);
  if (!route) return straightUp(bot, task);
  const deadline = Date.now() + 15000;
  let index = 0;
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
        // Let go and sink onto the floor: a dig afloat takes five times as long.
        bot.clearControlStates();
        for (let i = 0; i < 12 && !bot.entity.onGround; i++) { task.check(); await sleep(50); }
        try { await require('./skills').equipBestTool(bot, block); } catch (_) { /* the hand, then */ }
        await bot.lookAt(cell.offset(0.5, 0.5, 0.5), true);
        try { await bot.dig(block, true); } catch (err) { if (err.name === 'Cancelled') throw err; }
        task.check();
      }
      const target = route[index].offset(0.5, 0, 0.5);
      const horizontal = Math.hypot(target.x - p.x, target.z - p.z);
      if (horizontal < 0.35 && p.y >= target.y - 0.2 && index < route.length - 1) { index++; continue; }
      if (horizontal > 0.2) await bot.lookAt(new Vec3(target.x, p.y + 1.62, target.z), true);
      bot.setControlState('forward', horizontal > 0.2);
      bot.setControlState('jump', bot.entity.isInWater || p.y < target.y);
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
  // Out of the block first: dug with the best tool carried, a few tries.
  for (let tries = 0; tries < 4 && headInBlock(bot); tries++) {
    const eye = bot.entity.position.offset(0, bot.entity.eyeHeight || 1.62, 0).floored(), block = bot.blockAt(eye);
    onAction({ action: 'dig_out_of_block', block: block.name, at: { ...eye } });
    try { await require('./skills').equipBestTool(bot, block); } catch (_) { /* the hand, then */ }
    try { await bot.dig(block, true); } catch (err) { if (err.name === 'Cancelled') throw err; }
    task.check();
  }
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

module.exports = { lastResortFood, chooseFood, safeFood, maintainVitals, needsAir, checkAir, headSubmerged, headInBlock, NeedsAir, digWithAirGuard, airRoute, surfaceForAir };
