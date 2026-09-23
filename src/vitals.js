'use strict';
const { Vec3 } = require('vec3');
const { swimmableWater, waterLevel } = require('./terrain');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const unsafeFoods = new Set(['pufferfish', 'poisonous_potato', 'spider_eye', 'rotten_flesh', 'chicken', 'suspicious_stew', 'chorus_fruit']);

class NeedsAir extends Error {
  constructor() { super('Low air: interrupt work and surface'); this.name = 'NeedsAir'; }
}

function needsAir(bot) { return bot.oxygenLevel <= 12; }
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

// Search body-sized spaces for breathable air. Unlike jumping in place, this
// can leave an underwater overhang. No excavation or block placement is used.
function airRoute(bot) {
  const start = bot.entity.position.floored();
  const passable = p => {
    const b = bot.blockAt(p);
    return swimmableWater(b) || b && ['air', 'cave_air', 'void_air'].includes(b.name);
  };
  const water = p => swimmableWater(bot.blockAt(p));
  const queue = [{ p: start, path: [] }];
  const seen = new Set([`${start}`]);
  const directions = [new Vec3(0, 1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
  for (let i = 0; i < queue.length && i < 4096; i++) {
    const { p, path } = queue[i];
    if (passable(p.offset(0, 1, 0)) && !water(p.offset(0, 1, 0)) &&
      (water(p) || bot.blockAt(p.offset(0, -1, 0))?.boundingBox === 'block')) return path.length ? path : [p];
    for (const d of directions) {
      const next = p.plus(d);
      if (seen.has(`${next}`) || next.y - start.y > 20 || Math.abs(next.x - start.x) > 8 || Math.abs(next.z - start.z) > 8) continue;
      seen.add(`${next}`);
      if (!passable(next) || !passable(next.offset(0, 1, 0))) continue;
      if (!water(next) && !water(next.offset(0, 1, 0)) && !water(next.offset(0, -1, 0)) &&
        bot.blockAt(next.offset(0, -1, 0))?.boundingBox !== 'block') continue;
      queue.push({ p: next, path: [...path, next] });
    }
  }
  return null;
}

async function surfaceForAir(bot, task, onAction = () => {}) {
  onAction({ action: 'surface', oxygen: bot.oxygenLevel });
  bot.pathfinder.setGoal(null); bot.stopDigging(); bot.clearControlStates();
  const route = airRoute(bot);
  if (!route) throw new Error('No observed swimming route to breathable air');
  const deadline = Date.now() + 15000;
  let index = 0;
  try {
    // A reconnect starts with a full client air bar even when the saved player
    // is underwater. Require actual breathable headroom as well as full air.
    while (bot.oxygenLevel < 20 || headSubmerged(bot)) {
      task.check();
      if (Date.now() >= deadline) throw new Error('Could not reach breathable air along the observed swimming route');
      const p = bot.entity.position;
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
function closeHostile(bot) {
  const here = bot.entity?.position;
  if (!here) return false;
  return Object.values(bot.entities || {}).some(e => e !== bot.entity && e.position && e.isValid !== false &&
    (bot.registry?.entitiesByName?.[e.name]?.type === 'hostile' || e.type === 'hostile') && e.position.distanceTo(here) <= CLOSE);
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
  if (needsAir(bot) || headSubmerged(bot)) await surfaceForAir(bot, task, onAction);
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
    await Promise.race([bot.consume(), cancelled]);
    await until(task, () => bot.food > before, 3000, 'Eating did not restore hunger');
  } finally { clearInterval(watcher); bot.deactivateItem(); }
  return true;
}

module.exports = { lastResortFood, chooseFood, safeFood, maintainVitals, needsAir, checkAir, headSubmerged, NeedsAir, digWithAirGuard, airRoute, surfaceForAir };
